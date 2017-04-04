function PathTracer(){
  "use strict";
  var gl;
  var programs = {};
  var squareBuffer;
  var textures = []
  var noiseTex;
  var framebuffers = [];
  var numSpheres = 5;
  var spheres = [];
  var spherePositions = [];
  var sphereAttrs = [];
  var colors = [];
  var materials = [];
  var eye = new Float32Array([0,0.0,-2]);
  var pingpong = 0;
  var clear = 0;
  var max_t = 1000000;
  var assets;

  var paths = [
    "shader/tracer.vs",
    "shader/tracer.fs",
    "shader/draw.vs",
    "shader/draw.fs"
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

  function length(v){
    return Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]);
  }

  function normalize(v){
    var m = length(v);
    return [v[0]/m,v[1]/m,v[2]/m];
  }

  function dot(v1,v2){
    return v1[0]*v2[0]+v1[1]*v2[1]+v1[2]*v2[2];
  }

  function add(v1,v2){
    return [v1[0]+v2[0],v1[1]+v2[1],v1[2]+v2[2]];
  }

  function sub(v1,v2){
    return [v1[0]-v2[0],v1[1]-v2[1],v1[2]-v2[2]];
  }

  function checkSphereCollision(origin,dir,r,pos){
    var scalar = dot(dir,sub(origin, pos));
    var dist = length(sub(origin, pos));
    var squared = (scalar * scalar) - (dist * dist) + (r * r);
    return squared < 0.0 ? max_t : -scalar - Math.sqrt(squared);
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
      ["tick","dims","eye","spherePositions","sphereAttrs","sphereMats","sphereColors","fbTex"],
      ["corner"]
    );
    programs.draw = initProgram(
      "shader/draw",
      ["fbTex","imageTex","dims"],
      ["corner"]
    );
  }

  function initPrimitives(){
    var rn = Math.random;
    //walls
    spheres.push( new Sphere([0,1e3+1,0] ,[1e3,0.9,0.0],[1.0,1.0,1.0],[1.0,0,0]));
    spheres.push( new Sphere([0,0,1e3+2] ,[1e3,0.9,0.0],[1.0,1.0,1.0],[1.0,0,0]));
    spheres.push( new Sphere([0,-1e3-1,0],[1e3,0.9,0.0],[1.0,1.0,1.0],[1.0,0,0]));
    spheres.push( new Sphere([1e3+1,0,0] ,[1e3,0.9,0.0],[1.0,0.2,0.2],[1.0,0,0]));
    spheres.push( new Sphere([-1e3-1,0,0],[1e3,0.9,0.0],[0.2,1.0,0.2],[1.0,0,0]));
    spheres.push( new Sphere([0,0,-1e3]  ,[1e3,0.9,0.0],[1.0,1.0,1.0],[1.0,0,0]));
    //lights
    spheres.push( new Sphere([0,10.998,1],[10,0.0,1000.0],[1,1,1],[5.0,0,0]));
    staticCount = spheres.length;
    //spheres.push( new Sphere([0,-1,1],[0.25,1.0,8.0],[0.9,0.5,0.1],[5.0,0,0]));
    //spheres.push( new Sphere([0,1,1],[0.25,1.0,8.0],[0.1,0.5,0.9],[5.0,0,0]));
    //objects
    for(var i=0; i< numSpheres; i++){
      var r = Math.random()*0.30+0.15;
      spheres.push(new Sphere([(2*rn()-1)*(1-r),(2*rn()-1)*(1-r),(2-r*2)*rn()+r],
                              [r,0.85,0.0],
                              [rn(),rn(),rn()],
                              [1.0,rn()*20,rn()*3]));
    }

    for(var i=0; i< spheres.length; i++){
      spherePositions = spherePositions.concat(spheres[i].pos);
      sphereAttrs = sphereAttrs.concat(spheres[i].attrs);
      colors = colors.concat(spheres[i].color);
      materials = materials.concat(spheres[i].mat);
    }

    spherePositions = new Float32Array(spherePositions);
    sphereAttrs = new Float32Array(sphereAttrs);
    colors = new Float32Array(colors);
    materials = new Float32Array(materials);
  }

  function createTexture() {
    var t = gl.createTexture () ;
    gl.getExtension('EXT_color_buffer_float');
    //gl.getExtension('OES_texture_float_linear');
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
      clear = 1;
      xi = e.layerX;
      yi = e.layerY;
      for(var i=staticCount; i<spheres.length; i++){
        var pos = [spherePositions[i*3],spherePositions[i*3+1],spherePositions[i*3+2]];
        var r = sphereAttrs[i*3];
        var sp = [2*xi/gl.viewportWidth-1,-2*yi/gl.viewportHeight+1,0]
        var dir = normalize(sub(sp,eye));
        var t = checkSphereCollision(eye,dir,r,pos);
        if(t < max_t){
          index= i;
        }
      }
    }, false);
    element.addEventListener("mousemove", function(e){
      if(clear){
        if(index != -1){
          spherePositions[index*3] = 2*e.layerX/gl.viewportWidth-1;
          spherePositions[index*3+1] = -2*e.layerY/gl.viewportHeight+1;
        } else {
          for(var i=0; i<spheres.length; i++){
            var p0 = [spherePositions[i*3],spherePositions[i*3+1],spherePositions[i*3+2]];
            var p1 = rotateX(p0,(e.layerY - yi) / 90.0);
            var p2 = rotateY(p1,-(e.layerX - xi) / 90.0);
            spherePositions[i*3] = p2[0];
            spherePositions[i*3+1] = p2[1];
            spherePositions[i*3+2] = p2[2];
          }
        }
        var p = pingpong;
        gl.bindTexture(gl.TEXTURE_2D, textures[p%2]);
        pingpong = 0;
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      xi = e.layerX;
      yi = e.layerY;
    }, false);
    element.addEventListener("mouseup", function(){
      clear = 0;
      index = -1;
    }, false);
  }

  function drawTracer(i){
    var program = programs.tracer;
    //console.log(program)
    gl.useProgram(program);
    gl.vertexAttribPointer(program.attributes.corner, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(program.attributes.corner);
    gl.uniform1i(program.uniforms.fbTex, 0);
    gl.uniform1i(program.uniforms.tick, i);
    gl.uniform2f(program.uniforms.dims, gl.viewportWidth, gl.viewportHeight);
    gl.uniform3f(program.uniforms.eye, eye[0],eye[1],eye[2]);
    gl.uniform3fv(program.uniforms.spherePositions, spherePositions);
    gl.uniform3fv(program.uniforms.sphereAttrs, sphereAttrs);
    gl.uniform3fv(program.uniforms.sphereMats, materials);
    gl.uniform3fv(program.uniforms.sphereColors, colors);
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
    pingpong++;
    drawTracer(pingpong);
    drawQuad(pingpong);
    pingpong++;
    drawTracer(pingpong);
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
    initPrimitives();
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
