var gl;
var squareBuffer;
var noiseTex;
var program;

function initGL(canvas) {
  gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
  gl.viewportWidth = canvas.width = 512;//window.innerWidth;
  gl.viewportHeight = canvas.height = 512;//window.innerHeight;
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

function initTexture() {
  var b = new ArrayBuffer(gl.viewportWidth*gl.viewportHeight*4);
  var v1 = new Uint8Array(b);
  
  for ( var i=0; i<gl.viewportWidth*gl.viewportHeight*4; i+=4 ){
    v1[i] = Math.floor((Math.random()*255)+1);
    v1[i+1] = Math.floor((Math.random()*255)+1);
    v1[i+2] = Math.floor((Math.random()*255)+1);
    v1[i+3] = 255;
  }
  noiseTex = gl.createTexture () ;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture( gl.TEXTURE_2D, noiseTex ) ;
  gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR ) ;
  gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR ) ;
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.viewportWidth, gl.viewportHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, v1);
  gl.generateMipmap( gl.TEXTURE_2D ) ;
  gl.uniform1i(program.texUniform, 0);
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
  gl.getUniformLocation(program, "tex")
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
}

function drawScene() {
  gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
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
  gl.enable(gl.DEPTH_TEST);
  
  tick();
}