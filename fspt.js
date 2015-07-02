var gl;
var program;
var squareBuffer;
var textures = []
var noiseTex;
var framebuffers = [];

function initGL(canvas) {
  gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
  gl.viewportWidth = canvas.width = window.innerWidth;
  gl.viewportHeight = canvas.height = window.innerHeight;
}

function getShader(gl, id) {
  var shaderScript = document.getElementById(id);
  if (!shaderScript) {
    return null;
  }
  var str = "";
  var k = shaderScript.firstChild;
  while (k) {
    if (k.nodeType == 3) {
      str += k.textContent;
    }
    k = k.nextSibling;
  }
  var shader;
  if (shaderScript.type == "x-shader/x-fragment") {
    shader = gl.createShader(gl.FRAGMENT_SHADER);
  } else if (shaderScript.type == "x-shader/x-vertex") {
    shader = gl.createShader(gl.VERTEX_SHADER);
  } else {
    return null;
  }
  gl.shaderSource(shader, str);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    alert(gl.getShaderInfoLog(shader));
    return null;
  }
  return shader;
}

function initTexture(){
  var b = new ArrayBuffer(gl.viewportWidth*gl.viewportHeight*4*4);
  var v1 = new Float32Array(b);

  for ( var i=0; i<gl.viewportWidth*gl.viewportHeight*4; i+=4 ){
    v1[i] =   Math.random();
    v1[i+1] = Math.random();
    v1[i+2] = Math.random();
    v1[i+3] = 1;
  }

  noiseTex = createTexture();
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.viewportWidth, gl.viewportHeight, 0, gl.RGBA, gl.FLOAT, v1);
}

function createTexture() {
  var t = gl.createTexture () ;
  gl.getExtension('OES_texture_float');
  //gl.getExtension('OES_texture_float_linear');
  gl.bindTexture( gl.TEXTURE_2D, t ) ;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST ) ;
  gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST ) ;
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA, gl.viewportWidth, gl.viewportHeight, 0,
    gl.RGBA, gl.UNSIGNED_BYTE, null);
  return t;
}

function createFramebuffer(tex){
  var fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return fbo;
}

function initShaders() {
  var fs = getShader(gl, "shader-fs");
  var vs = getShader(gl, "shader-vs");

  program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    alert("you broke it");
  }

  gl.useProgram(program);
  program.vertexAttribute = gl.getAttribLocation(program, "corner");
  gl.enableVertexAttribArray(program.vertexAttribute);
  program.texUniform = gl.getUniformLocation(program, "tex")
  program.modeLocation = gl.getUniformLocation(program, "mode");
}

function initBuffers(){
  squareBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, squareBuffer);
  vertices = [
    1.0,  1.0,  0.0,
   -1.0,  1.0,  0.0,
   1.0, -1.0,  0.0,
   -1.0, -1.0,  0.0
  ];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  gl.vertexAttribPointer(program.vertexAttribute, 3, gl.FLOAT, false, 0, 0);

  var tex = createTexture();
  textures.push(createTexture());
  textures.push(createTexture());
  framebuffers.push(createFramebuffer(textures[0]));
  framebuffers.push(createFramebuffer(textures[1]));
}

function drawScene() {
  gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
  gl.bindTexture(gl.TEXTURE_2D, noiseTex);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[0]);
  gl.uniform1i(program.modeLocation, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, textures[0]);
  gl.uniform1i(program.modeLocation, 1);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function tick() {
  requestAnimationFrame(tick);
  drawScene();
}

function webGLStart() {
  var canvas = document.getElementById("trace");
  initGL(canvas);
  initShaders();
  initBuffers();
  initTexture();

  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.disable(gl.BLEND);

  tick();
}
