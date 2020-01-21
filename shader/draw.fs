#version 300 es

#define INV_SQRT_OF_2PI 0.39894228040143267793994605993439  // 1.0/SQRT_OF_2PI
#define INV_PI 0.31830988618379067153776752674503

precision highp float;
uniform sampler2D fbTex;
uniform float exposure;
uniform float saturation;
uniform bool denoise;

out vec4 fragColor;

const vec3 lumaCoefs = vec3(0.2126, 0.7152, 0.0722);

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

vec3 smartDeNoise(float sigma, float kSigma, float threshold)
{
    vec2 uv = gl_FragCoord.xy / vec2(textureSize(fbTex, 0));
    float radius = round(kSigma*sigma);
    float radQ = radius * radius;
    
    float invSigmaQx2 = .5 / (sigma * sigma);      // 1.0 / (sigma^2 * 2.0)
    float invSigmaQx2PI = INV_PI * invSigmaQx2;    // 1.0 / (sqrt(PI) * sigma)
    
    float invThresholdSqx2 = .5 / (threshold * threshold);     // 1.0 / (sigma^2 * 2.0)
    float invThresholdSqrt2PI = INV_SQRT_OF_2PI / threshold;   // 1.0 / (sqrt(2*PI) * sigma)
    
    vec3 centrPx = texture(fbTex,uv).rgb * exposure; 
    
    float zBuff = 0.0;
    vec3 aBuff = vec3(0.0);
    vec2 size = vec2(textureSize(fbTex, 0));
    
    for(float x=-radius; x <= radius; x++) {
        float pt = sqrt(radQ-x*x);  // pt = yRadius: have circular trend
        for(float y=-pt; y <= pt; y++) {
            vec2 d = vec2(x,y)/size;

            float blurFactor = exp( -dot(d , d) * invSigmaQx2 ) * invSigmaQx2;
            
            vec3 walkPx =  texture(fbTex,uv+d).rgb * exposure;

            vec3 dC = walkPx-centrPx;
            float deltaFactor = exp( -dot(dC, dC) * invThresholdSqx2) * invThresholdSqrt2PI * blurFactor;
                                 
            zBuff += deltaFactor;
            aBuff += deltaFactor*walkPx;
        }
    }
    return aBuff/zBuff;
}

void main(void) {
  vec3 texColor = vec3(0);
  if(denoise) {
    texColor = smartDeNoise(5.0, 2.0, .100).rgb;
  } else {
    texColor = texelFetch(fbTex, ivec2(gl_FragCoord), 0).rgb * exposure;
  }
  vec3 mapped = ACESFitted(texColor);
  mapped = mix( vec3(dot(mapped, lumaCoefs)), mapped, saturation);
  fragColor = vec4(mapped, 1);
}
