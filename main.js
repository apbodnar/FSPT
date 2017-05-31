function PathTracer(){
  "use strict";
  var gl;
  var programs = {};
  var squareBuffer;
  var textures = []
  var noiseTex;
  var framebuffers = [];
  var eye = new Float32Array([0,0.0,-2.1]);
  var pingpong = 0;
  var clear = 0;
  var max_t = 1000000;
  var assets;
  var triangleTexture;
  var bvhTexture;

  var paths = [
    "shader/tracer.vs",
    "shader/tracer.fs",
    "shader/draw.vs",
    "shader/draw.fs",
    "mesh/bunny.obj"
  ];

  var staticCount;

  var assets = {};

  function initGL(canvas) {
    gl = canvas.getContext("webgl2");
    gl.viewportWidth = canvas.width = window.innerHeight;
    gl.viewportHeight = canvas.height = window.innerHeight;
    gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
  }

  function getShader(gl, str, id) {
    var shader = gl.createShader(gl[id]);
    gl.shaderSource(shader, str);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      alert(id + gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  }

  function initProgram(path, uniforms, attributes) {
    var fs = getShader(gl, assets[path+".fs"],"FRAGMENT_SHADER");
    var vs = getShader(gl, assets[path+".vs"],"VERTEX_SHADER");
    var program = gl.createProgram();
    program.uniforms = {};
    program.attributes = {};
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);
    uniforms.forEach(function(name){
      program.uniforms[name] = gl.getUniformLocation(program, name);
    });
    attributes.forEach(function(name){
      program.attributes[name] = gl.getAttribLocation(program, name);
    });

    return program;
  }

  function initPrograms(){
    programs.tracer = initProgram(
      "shader/tracer",
      ["tick","dims","eye","fbTex", "triTex", "bvhTex"],
      ["corner"]
    );
    programs.draw = initProgram(
      "shader/draw",
      ["fbTex","imageTex","dims"],
      ["corner"]
    );
  }

  function requiredRes(num_elements, per_element){
    var root = Math.sqrt(num_elements * per_element);
    var width = Math.ceil(root/per_element) * per_element;
    var height = Math.ceil(num_elements * per_element / width);
    return [width, height]
  }

  function padBuffer(buffer, width, height){
    var numToPad = width * height - buffer.length;
    console.assert(numToPad >= 0);
    for(var i=0; i< numToPad; i++){
      buffer.push(-1);
    }
  }

  function initBVH(){
    var geometry = parseMesh(assets['mesh/bunny.obj']);
    var bvhArray = new BVH(geometry, 4).serializeTree();
    var bvhBuffer = [];
    var trianglesBuffer = [];
    for(var i=0; i< bvhArray.length; i++){
      var e = bvhArray[i];
      var node = e.node;
      var box = node.boundingBox;
      var triIndex = node.leaf ? trianglesBuffer.length/3 : -1;
      // 4 pixels
      var reordered = [box[0], box[2], box[4], box[1], box[3], box[5]];
      var bufferNode = [e.parent, e.sibling, node.split, e.left, e.right, triIndex].concat(reordered);
      if(node.leaf){
        var tris = node.triangles;
        for(var j=0; j<tris.length; j++){
          trianglesBuffer = trianglesBuffer.concat(tris[j].v1, tris[j].v2, tris[j].v3)
        }
      }
      for(var j=0; j<bufferNode.length; j++){
        bvhBuffer.push(bufferNode[j])
      }
    }

    bvhTexture = createTexture();
    var res = requiredRes(bvhBuffer.length, 4);
    padBuffer(bvhBuffer, res[0], res[1]);
    gl.bindTexture(gl.TEXTURE_2D, bvhTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, res[0], res[1], 0, gl.RGB, gl.FLOAT, new Float32Array(bvhBuffer));

    triangleTexture = createTexture();
    res = requiredRes(trianglesBuffer.length, 3);
    padBuffer(trianglesBuffer, res[0], res[1]);
    gl.bindTexture(gl.TEXTURE_2D, triangleTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, res[0], res[1], 0, gl.RGB, gl.FLOAT, new Float32Array(trianglesBuffer));
  }

  function createTexture() {
    var t = gl.createTexture () ;
    gl.getExtension('EXT_color_buffer_float');
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, gl.viewportWidth, gl.viewportHeight, 0, gl.RGBA, gl.FLOAT, null);
    return t;
  }

  function createFramebuffer(tex){
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return fbo;
  }

  function initBuffers(){
    squareBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, squareBuffer);
    var vertices = [
      1.0,  1.0,  0.0,
     -1.0,  1.0,  0.0,
      1.0, -1.0,  0.0,
     -1.0, -1.0,  0.0
    ];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.vertexAttribPointer(programs.tracer.corner, 3, gl.FLOAT, false, 0, 0);

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
    var mode = 0;
    var t = max_t;
    var index = -1;
    element.addEventListener("mousedown", function(e){
      mode = 1
    }, false);
    element.addEventListener("mousemove", function(e){
      if(mode){
        eye = rotateY(eye, 0.1);
        pingpong = 0;
      }
    }, false);
    element.addEventListener("mouseup", function(){
      mode = 0;
    }, false);
  }

  function drawTracer(i){
    var program = programs.tracer;
    //console.log(program)
    gl.useProgram(program);
    gl.vertexAttribPointer(program.attributes.corner, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(program.attributes.corner);
    gl.uniform1i(program.uniforms.fbTex, 0);
    gl.uniform1i(program.uniforms.triTex, 1);
    gl.uniform1i(program.uniforms.bvhTex, 2);
    gl.uniform1i(program.uniforms.tick, i);
    gl.uniform2f(program.uniforms.dims, gl.viewportWidth, gl.viewportHeight);
    gl.uniform3f(program.uniforms.eye, eye[0],eye[1],eye[2]);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, bvhTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, triangleTexture);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures[(i+1)%2]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[i%2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function drawQuad(i){
    var program = programs.draw;
    gl.useProgram(program);
    gl.vertexAttribPointer(program.attributes.corner, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(program.attributes.corner);
    gl.uniform2f(program.uniforms.dims, gl.viewportWidth, gl.viewportHeight);
    gl.uniform1i(program.uniforms.fbTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, textures[i%2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function tick() {
    requestAnimationFrame(tick);
    for (var i = 0; i < 4; i++){
      pingpong++;
      drawTracer(pingpong);
    }
    drawQuad(pingpong);
    if(!(pingpong % 1000)){
      console.log(pingpong);
    }
  }

  function start(res) {
    assets = res;
    var canvas = document.getElementById("trace");
    initGL(canvas);
    initPrograms();
    initBVH();
    initBuffers();
    initEvents();

    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.disable(gl.BLEND);

    tick();
  }

  function Sphere(pos,attrs,color,mat){
    this.pos = pos;
    this.attrs = attrs;
    this.color = color;
    this.mat = mat;
  }

  loadAll(paths,start);
}

new PathTracer();
