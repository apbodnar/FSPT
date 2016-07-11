  precision highp float;
  attribute vec3 corner;
  varying vec2 coords;
  void main(void) {
    coords = corner.xy;
    gl_Position = vec4(corner, 1.0);
  }
