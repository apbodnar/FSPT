#version 300 es
precision highp float;
in vec3 corner;
void main(void) {
  gl_Position = vec4(corner, 1.0);
}
