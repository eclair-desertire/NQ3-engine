#version 450

layout(set = 0, binding = 0) uniform sampler2D texture0;

layout(location = 0) in vec2 frag_tex_coord;

layout(location = 0) out vec4 out_color;

layout(constant_id = 0) const float gamma = 1.0;
layout(constant_id = 1) const float obScale = 2.0;
layout(constant_id = 2) const float greyscale = 0.0;
//
layout(constant_id = 7) const int ditherMode = 0; // 0 - disabled, 1 - ordered
layout(constant_id = 8) const int depth_r = 255;
layout(constant_id = 9) const int depth_g = 255;
layout(constant_id = 10) const int depth_b = 255;
layout(constant_id = 11) const int tonemap = 0;		// 0 - off, 1 - ACES, 2 - AgX
layout(constant_id = 12) const float exposure = 1.0;

const vec3 sRGB = { 0.2126, 0.7152, 0.0722 };

const int bayerSize = 8;
const float bayerMatrix[bayerSize * bayerSize] = {
	0,  32, 8,  40, 2,  34, 10, 42,
	48, 16, 56, 24, 50, 18, 58, 26,
	12, 44, 4,  36, 14, 46, 6,  38,
	60, 28, 52, 20, 62, 30, 54, 22,
	3,  35, 11, 43, 1,  33, 9,  41,
	51, 19, 59, 27, 49, 17, 57, 25,
	15, 47, 7,  39, 13, 45, 5,  37,
	63, 31, 55, 23, 61, 29, 53, 21
};

float threshold() {
	ivec2 coordDenormalized = ivec2(gl_FragCoord.xy);
	ivec2 bayerCoord = coordDenormalized % bayerSize;
	float bayerSample = bayerMatrix[bayerCoord.x + bayerCoord.y * bayerSize];
	float threshold = (bayerSample + 0.5) / float(bayerSize * bayerSize);
	return threshold;
}

vec3 dither(vec3 color) {
	ivec3 depth = ivec3(depth_r, depth_g, depth_b);
	vec3 cDenormalized = color * depth;
	vec3 cLow = floor(cDenormalized);
	vec3 cFractional = cDenormalized - cLow;
	vec3 cDithered = cLow + step(threshold(), cFractional);
	return cDithered / depth;
}

// ACES filmic curve, Krzysztof Narkowicz's fit; linear in, display-referred out
vec3 tonemap_aces( vec3 x ) {
	return clamp( ( x * ( 2.51 * x + 0.03 ) ) / ( x * ( 2.43 * x + 0.59 ) + 0.14 ), 0.0, 1.0 );
}

// AgX, Benjamin Wrensch's minimal fit of Troy Sobotka's transform; linear in,
// display-referred out. Bright saturated lights drift towards white instead of
// skewing hue, which keeps neon looking like neon
vec3 agx_contrast( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

vec3 tonemap_agx( vec3 x ) {
	const mat3 inset = mat3(
		0.842479062253094, 0.0423282422610123, 0.0423756549057051,
		0.0784335999999992, 0.878468636469772, 0.0784336,
		0.0792237451477643, 0.0791661274605434, 0.879142973793104 );
	const mat3 outset = mat3(
		1.19687900512017, -0.0528968517574562, -0.0529716355144438,
		-0.0980208811401368, 1.15190312990417, -0.0980434501171241,
		-0.0990297440797205, -0.0989611768448433, 1.15107367264116 );
	const float min_ev = -12.47393;
	const float max_ev = 4.026069;

	x = inset * x;
	x = clamp( log2( max( x, vec3( 1e-10 ) ) ), min_ev, max_ev );
	x = ( x - min_ev ) / ( max_ev - min_ev );
	x = agx_contrast( x );
	return clamp( outset * x, 0.0, 1.0 );
}

void main() {
	vec3 base = texture(texture0, frag_tex_coord).rgb;

	if ( tonemap != 0 )
	{
		// The scene is drawn in Quake's display-referred space (scaled down by the
		// overbright bits). Bring it to linear light, expose, then let the curve
		// compress highlights; r_gamma is applied to the result as usual.
		vec3 lin = pow( max( base * obScale, vec3( 0.0 ) ), vec3( 2.2 ) ) * exposure;
		vec3 mapped = ( tonemap == 1 ) ? pow( tonemap_aces( lin ), vec3( 1.0 / 2.2 ) ) : tonemap_agx( lin );

		if ( greyscale != 0 )
		{
			mapped = mix( mapped, vec3( dot( mapped, sRGB ) ), abs( greyscale ) );
		}
		out_color = vec4( gamma != 1.0 ? pow( mapped, vec3( gamma ) ) : mapped, 1 );
		if ( ditherMode == 1 ) {
			out_color.rgb = dither( out_color.rgb );
		}
		return;
	}

	if ( greyscale == 1 )
	{
		base = vec3(dot(base, sRGB));
	}
	else if ( greyscale != 0 )
	{
		vec3 luma = vec3(dot(base, sRGB));
		base = mix(base, luma, greyscale);
	}

	if ( gamma != 1.0 )
	{
		out_color = vec4(pow(base, vec3(gamma)) * obScale, 1);
	}
	else
	{
		out_color = vec4(base * obScale, 1);
	}

	if ( ditherMode == 1 ) {
		out_color.rgb = dither(out_color.rgb);
	}
}
