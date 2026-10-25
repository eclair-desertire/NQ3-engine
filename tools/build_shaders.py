"""
Compiles the Vulkan renderer's GLSL shaders into code/renderervk/shaders/spirv/shader_data.c.

The list of shaders and their variants is read from shaders/compile.bat, which stays the
single source of truth (and keeps merges with upstream Quake3e simple). Output matches
the format of shaders/bin2hex.c byte for byte.

glslang is looked up in tools/glslang/bin, then in $VULKAN_SDK/Bin, then on PATH.

Usage: python tools/build_shaders.py [--check]
  --check   compile everything but don't write shader_data.c; exit 1 if it would change
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHADERS = os.path.join(ROOT, 'code', 'renderervk', 'shaders')
OUTPUT = os.path.join(SHADERS, 'spirv', 'shader_data.c')


def find_glslang():
    candidates = [os.path.join(ROOT, 'tools', 'glslang', 'bin', 'glslang.exe'),
                  os.path.join(ROOT, 'tools', 'glslang', 'bin', 'glslangValidator.exe')]
    sdk = os.environ.get('VULKAN_SDK')
    if sdk:
        candidates.append(os.path.join(sdk, 'Bin', 'glslangValidator.exe'))
    for c in candidates:
        if os.path.isfile(c):
            return c
    for name in ('glslangValidator', 'glslang'):
        found = shutil.which(name)
        if found:
            return found
    sys.exit('glslang not found: put it in tools/glslang/bin or install the Vulkan SDK')


def parse_jobs():
    """Returns [(glslang args, array name)] in compile.bat order."""
    jobs = []
    pending = None
    with open(os.path.join(SHADERS, 'compile.bat'), encoding='latin-1') as f:
        lines = [l.strip() for l in f]

    for line in lines:
        if line.lower().startswith('@rem') or not line:
            continue
        # for %%f in (*.vert) do ( ... ) loops: every file with that extension
        m = re.match(r'for %%f in \(\*\.(vert|frag)\) do', line, re.I)
        if m:
            ext = m.group(1)
            for name in sorted(os.listdir(SHADERS)):
                if name.endswith('.' + ext):
                    base = name[:-len(ext) - 1]
                    jobs.append((['-S', ext, '-V', name], '%s_%s_spv' % (base, ext)))
            continue
        m = re.match(r'"%cl%" (.*) -o "%tmpf%" (.*)$', line)
        if m and '%%f' not in line:
            pending = m.group(1).split() + m.group(2).split()
            continue
        m = re.match(r'"%bh%" "%tmpf%" %outf% (\w+)$', line)
        if m and pending is not None:
            jobs.append((pending, m.group(1)))
            pending = None
    return jobs


def to_c_array(name, data):
    out = ['const unsigned char %s[%d] = {\n\t' % (name, len(data))]
    for i, b in enumerate(data):
        out.append('0x%02X' % b)
        if i + 1 < len(data):
            out.append(', ' if (i + 1) % 16 else ',\n\t')
    out.append('\n};\n')
    return ''.join(out)


def main():
    check = '--check' in sys.argv
    glslang = find_glslang()
    jobs = parse_jobs()
    if not jobs:
        sys.exit('no shaders found in compile.bat')

    chunks = []
    with tempfile.TemporaryDirectory() as tmp:
        spv = os.path.join(tmp, 'out.spv')
        for args, name in jobs:
            cmd = [glslang] + args[:args.index('-V') + 1] + ['-o', spv] + args[args.index('-V') + 1:]
            r = subprocess.run(cmd, cwd=SHADERS, capture_output=True, text=True)
            if r.returncode != 0:
                print(r.stdout + r.stderr)
                sys.exit('failed: %s' % name)
            with open(spv, 'rb') as f:
                chunks.append(to_c_array(name, f.read()))

    text = ''.join(chunks)
    old = open(OUTPUT, 'rb').read().decode('latin-1') if os.path.exists(OUTPUT) else ''
    changed = old.replace('\r\n', '\n') != text
    print('%d shaders, %s' % (len(jobs), 'changed' if changed else 'unchanged'))
    if check:
        sys.exit(1 if changed else 0)
    if changed:
        with open(OUTPUT, 'w', newline='\r\n' if '\r\n' in old else '\n') as f:
            f.write(text)
        print('wrote', os.path.relpath(OUTPUT, ROOT))


if __name__ == '__main__':
    main()
