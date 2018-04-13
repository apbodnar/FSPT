#version 300 es
precision highp float;
uniform sampler2D fbTex;

out vec4 fragColor;

void main(void) {
  fragColor = pow(pow(texelFetch(fbTex, ivec2(gl_FragCoord), 0), vec4(0.4545454)), vec4(0.8,0.85,0.9, 1.0));
}
