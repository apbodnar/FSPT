#version 300 es
precision highp float;
uniform sampler2D fbTex;
uniform float exposure;
uniform float saturation;
uniform float whitePoint;

out vec4 fragColor;

const vec3 lumaCoefs = vec3(0.2126, 0.7152, 0.0722);

vec3 whitePreservingLumaBasedReinhardToneMapping(vec3 color)
{
	float white = 2.;
	float luma = dot(color, lumaCoefs);
	float toneMappedLuma = luma * (1. + luma / (white*white)) / (1. + luma);
	color *= toneMappedLuma / luma;
	//color = pow(color, vec3(0.45454545));
	return color;
}

vec3 Uncharted2ToneMapping(vec3 color)
{
	float A = 0.15;
	float B = 0.50;
	float C = 0.10;
	float D = 0.20;
	float E = 0.02;
	float F = 0.30;
	float W = whitePoint;
	color = ((color * (A * color + C * B) + D * E) / (color * (A * color + B) + D * F)) - E / F;
	float white = ((W * (A * W + C * B) + D * E) / (W * (A * W + B) + D * F)) - E / F;
	color /= white;
	//color = pow(color, vec3(0.45454545));
	return color;
}

// https://github.com/TheRealMJP/BakingLab/blob/master/BakingLab/ACES.hlsl

vec3 acesFilm(const vec3 x) {
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d ) + e), 0.0, 1.0);
}

vec3 tonemapReinhard(const vec3 color) {
	vec3 intensity = vec3(dot(color, lumaCoefs));
	return color / (intensity + vec3(1.0));
}

void main(void) {
  vec3 texColor = texelFetch(fbTex, ivec2(gl_FragCoord), 0).rgb * exposure;
  vec3 mapped = Uncharted2ToneMapping(texColor);
  mapped = mix( vec3(dot(mapped, lumaCoefs)), mapped, saturation);
  fragColor = vec4(mapped, 1);
}
