#version 300 es
precision highp float;
uniform sampler2D fbTex;

out vec4 fragColor;

void main(void) {
  vec2 size = vec2(textureSize(fbTex, 0));
  fragColor = texture(fbTex,gl_FragCoord.xy/size);
}
