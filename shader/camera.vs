#version 300 es
precision highp float;
in vec3 corner;

out vec2 uv;

void main(void) {
  uv = corner.xy;
  gl_Position = vec4(corner, 1.0);
}
