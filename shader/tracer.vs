#version 300 es
precision highp float;
in vec3 corner;
out vec2 coords;
void main(void) {
  coords = corner.xy;
  gl_Position = vec4(corner, 1.0);
}
