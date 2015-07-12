var gl;
var program;
var squareBuffer;
var textures = []
var noiseTex;
var framebuffers = [];
var numSpheres = 13;
var spheres = [];
var sphereAttrs = [];
var colors = [];
var materials = [];
var eye = new Float32Array([0,0,-2]);
var pingpong = 0;
var clear = 0;

function initGL(canvas) {
  gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
  gl.viewportWidth = canvas.width = window.innerHeight;
  gl.viewportHeight = canvas.height = window.innerHeight;
  gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
  gl.disable(gl.DEPTH_TEST);
}

function getShader(gl, id) {
  var str = document.getElementById(id).innerText;
  var shader = gl.createShader(gl[id]);
  gl.shaderSource(shader, str);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    alert(gl.getShaderInfoLog(shader));
    return null;
  }
  return shader;
}

function normalize(arr){
  var m = Math.sqrt(arr[0]*arr[0]+arr[1]*arr[1]+arr[2]*arr[2])
  return [arr[0]/m,arr[1]/m,arr[2]/m]
}

function initPrimitives(){
  for(var i=0; i< numSpheres-8; i++){
    var r = 0.25;
    spheres = spheres.concat([(2*Math.random()-1)*(1-r),(2*Math.random()-1)*(1-r),(2-r*2)*Math.random()+r]);
    sphereAttrs = sphereAttrs.concat([r,0.85,0.0]);
    colors = colors.concat([Math.random()*0.25+0.75,Math.random()*0.25+0.75,Math.random()*0.25+0.75]);
    materials = materials.concat([1.0,Math.random()*4,Math.random()*2]);
  }
  spheres = spheres.concat([0,11,1]);
  //spheres = spheres.concat([2*Math.random()-1,2*Math.random()-1,1.7*Math.random()+0.3]);
  sphereAttrs = sphereAttrs.concat([10.010,0.0,12.0]);
  colors = colors.concat([1,1,1]);
  materials = materials.concat([5.0,0,0]);

  spheres = spheres.concat([0,1e3+1,0]);
  sphereAttrs = sphereAttrs.concat([1e3,1,0.0]);
  colors = colors.concat([1,1,1]);
  materials = materials.concat([1.0,0,0]);

  spheres = spheres.concat([0,0,1e3+2]);
  sphereAttrs = sphereAttrs.concat([1e3,1,0.0]);
  colors = colors.concat([0.1,1,0.1]);
  materials = materials.concat([1.0,0,0]);

  spheres = spheres.concat([0,-1e3-1,0]);
  sphereAttrs = sphereAttrs.concat([1e3,1,0.0]);
  colors = colors.concat([1,1,1]);
  materials = materials.concat([1.0,0,0]);

  spheres = spheres.concat([1e3+1,0,0]);
  sphereAttrs = sphereAttrs.concat([1e3,1,0.0]);
  colors = colors.concat([1,0.1,0.1]);
  materials = materials.concat([1.0,0,0]);

  spheres = spheres.concat([-1e3-1,0,0]);
  sphereAttrs = sphereAttrs.concat([1e3,1,0.0]);
  colors = colors.concat([0.1,0.1,1]);
  materials = materials.concat([1.0,0,0]);

  spheres = spheres.concat([-1e3-1,0,0]);
  sphereAttrs = sphereAttrs.concat([1e3,1,0.0]);
  colors = colors.concat([1,1,1]);
  materials = materials.concat([1.0,0,0]);

  spheres = spheres.concat([0,0,-1e3]);
  sphereAttrs = sphereAttrs.concat([1e3,1,0.0]);
  colors = colors.concat([1,1,1]);
  materials = materials.concat([1.0,0,0]);

  spheres = new Float32Array(spheres);
  sphereAttrs = new Float32Array(sphereAttrs);
  colors = new Float32Array(colors);
  materials = new Float32Array(materials);
}

function createTexture() {
  var t = gl.createTexture () ;
  gl.getExtension('OES_texture_float');
  gl.getExtension('OES_texture_float_linear');
  gl.bindTexture( gl.TEXTURE_2D, t ) ;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR ) ;
  gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR ) ;
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.viewportWidth, gl.viewportHeight, 0, gl.RGB, gl.FLOAT, null);
  return t;
}

function createFramebuffer(tex){
  var fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return fbo;
}

function initShaders() {
  var fs = getShader(gl, "FRAGMENT_SHADER");
  var vs = getShader(gl, "VERTEX_SHADER");

  program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.log("you broke it");
  }

  gl.useProgram(program);
  program.vertexAttribute = gl.getAttribLocation(program, "corner");
  gl.enableVertexAttribArray(program.vertexAttribute);
  program.noiseTexLocation = gl.getUniformLocation(program, "noiseTex");
  program.fbTexLocation = gl.getUniformLocation(program, "fbTex");
  program.modeLocation = gl.getUniformLocation(program, "mode");
  program.sphereLocations = gl.getUniformLocation(program, "spherePositions");
  program.attrLocations = gl.getUniformLocation(program, "sphereAttrs");
  program.colorLocations = gl.getUniformLocation(program, "sphereColors");
  program.matLocation = gl.getUniformLocation(program, "sphereMats");
  program.countLocation = gl.getUniformLocation(program, "sphereCount");
  program.eyeLocation = gl.getUniformLocation(program, "eye");
  program.dimensionLocation = gl.getUniformLocation(program, "dims");
  program.tickLocation = gl.getUniformLocation(program, "tick");
}

function initNoise(){
  var b = new ArrayBuffer(gl.viewportWidth*gl.viewportHeight*3*4);
  var v1 = new Float32Array(b);

  for ( var i=0; i<gl.viewportWidth*gl.viewportHeight*4; i+=4 ){
    //var tv = vec3.normalize([0,0,0],[Math.random(),Math.random(),Math.random()])
    v1[i] =   Math.random();
    v1[i+1] = Math.random();
    v1[i+2] = Math.random();
  }
  gl.activeTexture(gl.TEXTURE0);
  noiseTex = createTexture();
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.viewportWidth, gl.viewportHeight, 0, gl.RGB, gl.FLOAT, v1);
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

function rotateX(vec, a){
  var x = vec[0],
      y = vec[1],
      z = vec[2] - 1;
  var x1 = x,
      y1 = z*Math.sin(a) + y*Math.cos(a),
      z1 = z*Math.cos(a) - y*Math.sin(a) + 1;
  return [x1,y1,z1];
}

function rotateY(vec, a){
  var x = vec[0],
      y = vec[1],
      z = vec[2] - 1;
  var y1 = y,
      x1 = z*Math.sin(a) + x*Math.cos(a),
      z1 = z*Math.cos(a) - x*Math.sin(a) + 1;
  return [x1,y1,z1];
}

function initEvents(){

  var element = document.getElementById("trace");
  var xi, yi;
  element.addEventListener("mousedown", function(e){
    clear = 1;
    xi = e.layerX;
    yi = e.layerY;
  }, false);
  element.addEventListener("mousemove", function(e){
    if(clear){
      for(var i=0; i< numSpheres; i++){
        var p0 = [spheres[i*3],spheres[i*3+1],spheres[i*3+2]];
        var p1 = rotateX(p0,(e.layerY - yi) / 90.0);
        var p2 = rotateY(p1,-(e.layerX - xi) / 90.0);
        spheres[i*3] = p2[0];
        spheres[i*3+1] = p2[1];
        spheres[i*3+2] = p2[2];
      }
      //gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[i+1%2]);
      gl.clear(gl.COLOR_BUFFER_BIT);
      pingpong = 0;
    }
    xi = e.layerX;
    yi = e.layerY;
  }, false);
  element.addEventListener("mouseup", function(){
    clear = 0;
  }, false);
}

function drawScene(i){
  gl.uniform1i(program.modeLocation, 0);
  gl.uniform1i(program.noiseTexLocation, 0);
  gl.uniform1i(program.fbTexLocation, 1);
  gl.uniform1i(program.tickLocation, i);
  gl.uniform2f(program.dimensionLocation, gl.viewportWidth, gl.viewportHeight);
  gl.uniform3fv(program.sphereLocations, spheres);
  gl.uniform3f(program.eyeLocation, eye[0],eye[1],eye[2]);
  gl.uniform3fv(program.sphereLocations, spheres);
  gl.uniform3fv(program.attrLocations, sphereAttrs);
  gl.uniform3fv(program.matLocation, materials);
  gl.uniform3fv(program.colorLocations, colors);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, noiseTex);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[i%2]);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.uniform1i(program.modeLocation, 1);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, textures[i%2]);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function tick() {
  requestAnimationFrame(tick);
  pingpong++;
  drawScene(pingpong);
  if(!(pingpong % 1000)){
    console.log(pingpong);
  }
}

function webGLStart() {
  var canvas = document.getElementById("trace");
  initGL(canvas);
  initShaders();
  initPrimitives();
  initBuffers();
  initNoise();
  initEvents();

  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.disable(gl.BLEND);

  tick();
}
