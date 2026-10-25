# Builds the engine with both renderers baked in as separate executables:
#   quake3e.x64.exe         - OpenGL renderer
#   quake3e-vulkan.x64.exe  - Vulkan renderer
#   quake3e.ded.x64.exe     - dedicated server
# Both renderer projects write the same .lib, so they are built one after another.

$ErrorActionPreference = 'Stop'

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -property installationPath
$msbuild = Join-Path $vs 'MSBuild\Current\Bin\amd64\MSBuild.exe'

$dir = Join-Path $PSScriptRoot 'code\win32\msvc2017'
$out = Join-Path $dir 'output'
$common = @('/p:Configuration=Release', '/p:Platform=x64', '/m', '/v:minimal', '/nologo')

function Invoke-MSBuild([string[]]$arguments) {
    & $msbuild @arguments @common
    if ($LASTEXITCODE -ne 0) { throw "MSBuild failed: $arguments" }
}

# GLSL -> SPIR-V (shader_data.c); skipped when glslang or Python is missing,
# the committed shader_data.c is then used as is
$py = Get-Command python -ErrorAction SilentlyContinue
if ($py) {
    & $py.Source (Join-Path $PSScriptRoot 'tools\build_shaders.py')
    if ($LASTEXITCODE -ne 0) { throw 'shader build failed' }
}

Push-Location $dir
try {
    Invoke-MSBuild @('quake3e-ded.vcxproj')

    Invoke-MSBuild @('renderer.vcxproj', '/t:Rebuild')
    Remove-Item -ErrorAction SilentlyContinue (Join-Path $out 'quake3e.x64.exe')
    Invoke-MSBuild @('quake3e.vcxproj')

    Invoke-MSBuild @('renderervk.vcxproj', '/t:Rebuild')
    Remove-Item -ErrorAction SilentlyContinue (Join-Path $out 'quake3e-vulkan.x64.exe')
    Invoke-MSBuild @('quake3e.vcxproj', '/p:TargetName=quake3e-vulkan.x64')
}
finally {
    Pop-Location
}

Get-ChildItem (Join-Path $out '*.exe') | Select-Object Name, Length
