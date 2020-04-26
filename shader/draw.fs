#version 300 es

#define INV_SQRT_OF_2PI 0.39894228040143267793994605993439  // 1.0/SQRT_OF_2PI
#define INV_PI 0.31830988618379067153776752674503

precision highp float;
uniform sampler2D fbTex;
uniform float exposure;
uniform float saturation;
uniform float scale;
uniform float maxSigma;
uniform bool denoise;

out vec4 fragColor;

const vec3 lumaCoefs = vec3(0.2126, 0.7152, 0.0722);
const int KERNEL_SIZE = 5;

const mat3 ACESInputMat = mat3(
  0.59719, 0.35458, 0.04823,
  0.07600, 0.90834, 0.01566,
  0.02840, 0.13383, 0.83777
);

// ODT_SAT => XYZ => D60_2_D65 => sRGB
const mat3 ACESOutputMat = mat3(
  1.60475, -0.53108, -0.07367,
  -0.10208,  1.10813, -0.00605,
  -0.00327, -0.07276,  1.07602
);

vec3 RRTAndODTFit(vec3 v)
{
    vec3 a = v * (v + 0.0245786f) - 0.000090537f;
    vec3 b = v * (0.983729f * v + 0.4329510f) + 0.238081f;
    return a / b;
}

vec3 ACESFitted(vec3 color)
{
    color = color * ACESInputMat;
    // Apply RRT and ODT
    color = RRTAndODTFit(color);
    color = color * ACESOutputMat;
    // Clamp to [0, 1]
    color = clamp(color, 0.0, 1.0);
    return color;
}

vec3 filterFireflies() {
  float sum = 0.0;
  float sq_sum = 0.0;
  vec3 middle;
  float middleLuma;
  float samples = float(KERNEL_SIZE * KERNEL_SIZE) - 1.0;
  for (int i = 0; i < KERNEL_SIZE; i++) {
    for (int j = 0; j < KERNEL_SIZE; j++) {
      ivec2 os = ivec2(i - KERNEL_SIZE / 2, j - KERNEL_SIZE / 2);
      ivec2 c = ivec2(gl_FragCoord * scale) + os;
      //vec3 color = clamp(texelFetch(fbTex, c, 0).rgb, vec3(0), vec3(1000));
      vec3 color = texelFetch(fbTex, c, 0).rgb;
      float luma = dot(color, lumaCoefs);
      if(os.x == 0 && os.y == 0){
        middle = color;
        middleLuma = luma;
        continue;
      }
      sum += luma;
      sq_sum += luma * luma;
    }
  }
  float mean = sum / samples;
  float variance = sq_sum / samples - mean * mean;
  float sigma = sqrt(variance);

  if (abs(middleLuma - mean) > maxSigma * sigma) {
    middle *= (mean / middleLuma);
  }
  return middle;
}

void main(void) {
  vec3 texColor = vec3(0);
  if(denoise) {
    texColor = filterFireflies() * exposure;
  } else {
    texColor = texelFetch(fbTex, ivec2(gl_FragCoord * scale), 0).rgb * exposure;
  }
  vec3 mapped = ACESFitted(texColor);
  mapped = mix( vec3(dot(mapped, lumaCoefs)), mapped, saturation);
  mapped = pow(mapped, vec3(0.454545));
  fragColor = vec4(mapped, 1);
}
