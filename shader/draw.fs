#version 300 es
precision highp float;
uniform sampler2D fbTex;

out vec4 fragColor;

void main(void) {
  fragColor = pow(texelFetch(fbTex, ivec2(gl_FragCoord), 0), vec4(0.4545454));
}
