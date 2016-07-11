precision highp float;
uniform vec2 dims;
uniform sampler2D fbTex;

void main(void) {
  gl_FragColor = texture2D(fbTex,gl_FragCoord.xy/dims);
}
