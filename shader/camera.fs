#version 300 es
precision highp float;

uniform float randBase;
uniform float scale;
uniform vec2 resolution;
uniform vec2 lensFeatures; // x: focal depth y: aperture size
uniform vec3 P;
uniform vec3 I;

const float M_PI = 3.14159265;

float seed;

in vec2 uv;

out vec4 fragColor[2];

float rnd() { return fract(sin(seed += 0.211324865405187)*43758.5453123); }

vec3 getScreen(vec3 basisX, vec3 basisY){
  vec2 inCam = uv * vec2(resolution.x / resolution.y, 1);
  return inCam.x * basisX * scale + inCam.y * basisY * scale + I + P;
}

vec3 getAA(vec3 basisX, vec3 basisY){
  float theta = rnd() * M_PI * 2.0;
  float r = sqrt(rnd()) * 1.414;
  return r * (basisX * cos(theta) / resolution.x + basisY * sin(theta) / resolution.y);
}

vec3 getDOF(vec3 basisX, vec3 basisY){
  float theta = rnd() * M_PI * 2.0;
  return (cos(theta) * basisX + sin(theta) * basisY) * lensFeatures.y * sqrt(rnd());
}

void main(void) {
  seed = randBase + gl_FragCoord.x * resolution.y + gl_FragCoord.y;
  vec3 basisX = normalize(cross(I, vec3(0,1,0)));
  vec3 basisY = normalize(cross(basisX, I));
  vec3 screen = getScreen(basisX, basisY);
  vec3 aa = getAA(basisX, basisY) * scale;
  vec3 dof = getDOF(basisX, basisY);
  fragColor[0] = vec4(P + dof, 1);
  fragColor[1] = vec4(normalize((screen + aa + dof * lensFeatures.x) - (P + dof)), 1);
}