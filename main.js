import * as Utility from '/utility.js'
import * as ObjLoader from '/obj_loader.js'
import {TexturePacker} from '/texture_packer.js'
import {BVH} from '/primitive_tree.js'
import {Vec3} from '/vector.js'

function PathTracer(scenePath, sceneName, resolution, frameNumber) {
  "use strict";
  let gl;
  let programs = {};
  let textures = {};
  let framebuffers = [];
  let scale = 1;
  let corners = {rightMax: [1, 1, 0], leftMin: [-1, -1, 0], leftMax: [-1, 1, 0], rightMin: [1, -1, 0]};
  let eye = new Float32Array([0, 0, 2 * scale]);
  let pingpong = 0;
  let clear = false;
  let sampleInput = document.getElementById('max-samples');
  let sampleOutput = document.getElementById("counter");
  let lightRanges = [];
  let atlasRes = 2048;
  let envTrans = [0,0,1];
  let moving = false;

  function writeBanner(message) {
    document.getElementById("banner").textContent = message;
  }

  function writeCounter(message) {
    sampleOutput.value = parseInt(message);
  }

  function initGL(canvas) {
    gl = canvas.getContext("webgl2", {preserveDrawingBuffer: true});
    gl.viewportWidth = canvas.width = resolution; // square render target
    gl.viewportHeight = canvas.height = resolution;
    gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
  }

  function getShader(gl, str, id) {
    let shader = gl.createShader(gl[id]);
    gl.shaderSource(shader, str);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.log(id + gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  }

  function initProgram(path, uniforms, attributes, assets) {
    let fs = getShader(gl, assets[path + ".fs"], "FRAGMENT_SHADER");
    let vs = getShader(gl, assets[path + ".vs"], "VERTEX_SHADER");
    let program = gl.createProgram();
    program.uniforms = {};
    program.attributes = {};
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);
    uniforms.forEach(function (name) {
      program.uniforms[name] = gl.getUniformLocation(program, name);
    });
    attributes.forEach(function (name) {
      program.attributes[name] = gl.getAttribLocation(program, name);
    });

    return program;
  }

  function initPrograms(assets) {
    programs.tracer = initProgram(
      "shader/tracer",
      [
        "tick", "dims", "eye", "envTex",
        "fbTex", "triTex", "bvhTex", "matTex", "normTex", "lightTex", "uvTex", "atlasTex",
        "scale", "rightMax", "rightMin", "leftMax", "leftMin", "lightRanges", "numLights"
      ],
      ["corner"],
      assets
    );
    programs.draw = initProgram(
      "shader/draw",
      ["fbTex", "imageTex", "dims"],
      ["corner"],
      assets
    );
  }

  function requiredRes(num_elements, per_element, per_pixel) {
    let num_pixels = num_elements / per_pixel;
    let root = Math.sqrt(num_pixels);
    let width = Math.ceil(root / per_element) * per_element;
    let height = Math.ceil(num_pixels / width);
    return [width, height]
  }

  function padBuffer(buffer, width, height, channels) {
    let numToPad = channels * width * height - buffer.length;
    console.assert(numToPad >= 0);
    for (let i = 0; i < numToPad; i++) {
      buffer.push(-1);
    }
  }

  function createFlatTexture(color){
    let canvas = document.createElement('canvas');
    canvas.naturalWidth = canvas.naturalHeight = canvas.width = canvas.height = 1;
    let ctx = canvas.getContext('2d');
    ctx.fillStyle = "rgb("+
      parseInt(color[0]*255)+","+
      parseInt(color[1]*255)+","+
      parseInt(color[2]*255)+")";
    ctx.fillRect( 0, 0, 1, 1 );
    return canvas
  }

  function createGradientTexture(start, stop){
    function colorString(rgb){
      return "rgb("+Math.floor(rgb[0] * 255)+","+Math.floor(rgb[1] * 255)+","+Math.floor(rgb[2] * 255)+")"
    }
    let canvas = document.createElement('canvas');
    let height = 1024;
    canvas.height = height;
    canvas.width = 1;
    let ctx = canvas.getContext('2d');
    let grad = ctx.createLinearGradient(0,0, 0, height);
    grad.addColorStop(1, colorString(start));
    grad.addColorStop(0, colorString(stop));
    ctx.fillStyle = grad;
    ctx.fillRect(0,0, 1, height);
    return canvas;
  }

  function createEnvironmentMap(image){
    textures.env = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, textures.env);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  }

  function initBVH(assets) {
    let scene = JSON.parse(assets[scenePath]);
    //writeBanner("Compiling scene");
    let geometry = [];
    let texturePacker = new TexturePacker(scene.atlasRes || atlasRes);
    let lights = [];
    if(scene.environment){
      if(Array.isArray(scene.environment)){
        createEnvironmentMap(createGradientTexture(scene.environment[0], scene.environment[1]));
      } else {
        createEnvironmentMap(assets[scene.environment]);
      }
    } else {
      createEnvironmentMap(createGradientTexture([0,0,0], [0,0,0]));
    }
    let props = mergeSceneProps(scene);
    for (let i = 0; i < props.length; i++) {
      let prop = props[i];
      let uvTransforms = null;
      if(prop.texture){
        uvTransforms = texturePacker.addTexture(assets[prop.texture])
      } else {
        uvTransforms = texturePacker.addTexture(createFlatTexture(prop.reflectance));
      }
      prop.uvTransforms = uvTransforms;
      let parsed = ObjLoader.parseMesh(assets[prop.path], prop, scene.worldTransforms);
      if(Vec3.dot(prop.emittance, [1,1,1]) > 0){
        lights.push(parsed);
      }
      geometry = geometry.concat(parsed);
    }
    let time = new Date().getTime();
    let bvh = new BVH(geometry, 4);
    console.log("BVH built in ", (new Date().getTime() - time) / 1000.0, " seconds");
    time = new Date().getTime();
    let bvhArray = bvh.serializeTree();
    console.log("BVH serialized in", (new Date().getTime() - time) / 1000.0, " seconds");
    let bvhBuffer = [];
    let trianglesBuffer = [];
    let materialBuffer = [];
    let normalBuffer = [];
    let lightBuffer = [];
    let uvBuffer = [];
    for (let i = 0; i < bvhArray.length; i++) {
      let e = bvhArray[i];
      let node = e.node;
      let box = node.boundingBox.getBounds();
      let triIndex = node.leaf ? trianglesBuffer.length / 3 / 3 : -1;
      // 4 pixels
      let reordered = [box[0], box[2], box[4], box[1], box[3], box[5]];
      let bufferNode = [e.parent, e.sibling, node.split, e.left, e.right, triIndex].concat(reordered);
      if (node.leaf) {
        let tris = node.getTriangles();
        for (let j = 0; j < tris.length; j++) {
          let subBuffer = [].concat(tris[j].verts[0], tris[j].verts[1], tris[j].verts[2]);
          subBuffer.forEach(function (el) {
            trianglesBuffer.push(el)
          });
        }
        for (let j = 0; j < tris.length; j++) {
          let transforms = tris[j].transforms;
          let subBuffer = [].concat(transforms.emittance, transforms.reflectance, [Math.pow(transforms.roughness, 2), transforms.metal, transforms.diffuse]);
          subBuffer.forEach(function (el) {
            materialBuffer.push(el)
          });
        }
        for (let j = 0; j < tris.length; j++) {
          let subBuffer = [];
          for (let k = 0; k < 3; k++) {
            subBuffer = subBuffer.concat(tris[j].normals[k]);
          }
          subBuffer.forEach(function (el) {
            normalBuffer.push(el)
          });
        }
        for (let j = 0; j < tris.length; j++) {
          let subBuffer = [].concat(tris[j].uvs[0], tris[j].uvs[1], tris[j].uvs[2]);
          subBuffer.forEach(function (el) {
            uvBuffer.push(el)
          });
        }
      }
      for (let j = 0; j < bufferNode.length; j++) {
        bvhBuffer.push(bufferNode[j]);
      }
    }
    for(let i=0; i<lights.length; i++){
      lightRanges.push(lightBuffer.length / 9);
      for(let j=0; j<lights[i].length; j++){
        let t = lights[i][j];
        [].concat(t.verts[0], t.verts[1], t.verts[2]).forEach(function(e){
          lightBuffer.push(e);
        });
      }
      lightRanges.push(lightBuffer.length / 9 - 1);
    }

    textures.materials = createTexture();
    let res = requiredRes(materialBuffer.length, 3, 3);
    padBuffer(materialBuffer, res[0], res[1], 3);
    gl.bindTexture(gl.TEXTURE_2D, textures.materials);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, res[0], res[1], 0, gl.RGB, gl.FLOAT, new Float32Array(materialBuffer));

    textures.bvh = createTexture();
    res = requiredRes(bvhBuffer.length, 4, 3);
    padBuffer(bvhBuffer, res[0], res[1], 3);
    gl.bindTexture(gl.TEXTURE_2D, textures.bvh);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, res[0], res[1], 0, gl.RGB, gl.FLOAT, new Float32Array(bvhBuffer));

    textures.triangles = createTexture();
    res = requiredRes(trianglesBuffer.length, 3, 3);
    padBuffer(trianglesBuffer, res[0], res[1], 3);
    gl.bindTexture(gl.TEXTURE_2D, textures.triangles);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, res[0], res[1], 0, gl.RGB, gl.FLOAT, new Float32Array(trianglesBuffer));

    textures.normals = createTexture();
    res = requiredRes(normalBuffer.length, 3, 3);
    padBuffer(normalBuffer, res[0], res[1], 3);
    gl.bindTexture(gl.TEXTURE_2D, textures.normals);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, res[0], res[1], 0, gl.RGB, gl.FLOAT, new Float32Array(normalBuffer));

    textures.lights = createTexture();
    res = requiredRes(lightBuffer.length, 3, 3);
    padBuffer(lightBuffer, res[0], res[1], 3);
    gl.bindTexture(gl.TEXTURE_2D, textures.lights);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, res[0], res[1], 0, gl.RGB, gl.FLOAT, new Float32Array(lightBuffer));

    textures.uvs = createTexture();
    res = requiredRes(uvBuffer.length, 3, 2);
    padBuffer(uvBuffer, res[0], res[1], 2);
    gl.bindTexture(gl.TEXTURE_2D, textures.uvs);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, res[0], res[1], 0, gl.RG, gl.FLOAT, new Float32Array(uvBuffer));
    writeBanner("");

    initAtlas(assets, texturePacker.canvas);
  }

  function initAtlas(assets, atlas){
    textures.atlas = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, textures.atlas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
  }

  function createTexture() {
    let t = gl.createTexture();
    let ext = gl.getExtension('EXT_color_buffer_float');
    if (!ext) {
      let message = "Sorry, your your device doesn't support 'EXT_color_buffer_float'";
      writeBanner(message);
      throw message;
    }
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, gl.viewportWidth, gl.viewportHeight, 0, gl.RGBA, gl.FLOAT, null);
    return t;
  }

  function createFramebuffer(tex) {
    let fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return fbo;
  }

  function initBuffers() {
    let squareBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, squareBuffer);
    let vertices = [
      1.0, 1.0, 0.0,
      -1.0, 1.0, 0.0,
      1.0, -1.0, 0.0,
      -1.0, -1.0, 0.0
    ];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.vertexAttribPointer(programs.tracer.corner, 3, gl.FLOAT, false, 0, 0);
    textures.screen = [];
    textures.screen.push(createTexture());
    textures.screen.push(createTexture());
    framebuffers.push(createFramebuffer(textures.screen[0]));
    framebuffers.push(createFramebuffer(textures.screen[1]));
  }

  function initEvents() {
    let element = document.getElementById("trace");
    let xi, yi;
    let mode = false;

    function addTranslation(shift) {
      eye = Vec3.add(eye, shift);
      corners.rightMax = Vec3.add(corners.rightMax, shift);
      corners.rightMin = Vec3.add(corners.rightMin, shift);
      corners.leftMax = Vec3.add(corners.leftMax, shift);
      corners.leftMin = Vec3.add(corners.leftMin, shift);
    }

    element.addEventListener("mousedown", function (e) {
      mode = e.which == 1;
      xi = e.layerX;
      yi = e.layerY;
    }, false);
    element.addEventListener("mousemove", function (e) {
      if (mode) {
        moving = true;
        pingpong = 0;
        let copy = eye;
        let rx = (xi - e.layerX) / 180.0;
        let ry = (e.layerY - yi) / 180.0;
        addTranslation(Vec3.scale(copy, -1));
        eye = Vec3.rotateY(eye, rx);
        corners.rightMax = Vec3.rotateY(corners.rightMax, rx);
        corners.rightMin = Vec3.rotateY(corners.rightMin, rx);
        corners.leftMax = Vec3.rotateY(corners.leftMax, rx);
        corners.leftMin = Vec3.rotateY(corners.leftMin, rx);
        let axis = Vec3.normalize(Vec3.sub(corners.leftMax, corners.rightMax));
        eye = Vec3.rotateArbitrary(eye, axis, ry);
        corners.rightMax = Vec3.rotateArbitrary(corners.rightMax, axis, ry);
        corners.rightMin = Vec3.rotateArbitrary(corners.rightMin, axis, ry);
        corners.leftMax = Vec3.rotateArbitrary(corners.leftMax, axis, ry);
        corners.leftMin = Vec3.rotateArbitrary(corners.leftMin, axis, ry);
        addTranslation(copy);
        xi = e.layerX;
        yi = e.layerY;
        clear = true;
      }
    }, false);
    element.addEventListener("mouseup", function (e) {
      mode = false;
      clear = false;
      moving = false;
      if(e.which == 1){
        pingpong = 0;
      }
    }, false);
    element.addEventListener('mousewheel', function (e) {
      scale -= e.wheelDelta / 2400 * scale;
      pingpong = 0;
      clear = true;
    }, false);
    document.addEventListener("keypress", function (e) {
      let center = Vec3.add(corners.leftMin, Vec3.scale(Vec3.sub(corners.rightMax, corners.leftMin), 0.5));
      let dir = Vec3.normalize(Vec3.sub(center, eye));
      let strafe = Vec3.normalize(Vec3.sub(corners.rightMax, corners.leftMax));
      switch (e.key) {
        case 'w':
          addTranslation(Vec3.scale(dir, 0.1 * scale));
          pingpong = 0;
          break;
        case 'a':
          addTranslation(Vec3.scale(strafe, -0.1 * scale));
          pingpong = 0;
          break;
        case 's':
          addTranslation(Vec3.scale(dir, -0.1 * scale));
          pingpong = 0;
          break;
        case 'd':
          addTranslation(Vec3.scale(strafe, 0.1 * scale));
          pingpong = 0;
          break;
        case 'r':
          addTranslation(Vec3.scale(Vec3.normalize(Vec3.cross(dir, strafe)), -0.1 * scale));
          pingpong = 0;
          break;
        case 'f':
          addTranslation(Vec3.scale(Vec3.normalize(Vec3.cross(dir, strafe)), 0.1 * scale));
          pingpong = 0;
          break;
      }
    }, false);
  }

  function drawTracer(i) {
    let program = programs.tracer;
    gl.useProgram(program);
    gl.vertexAttribPointer(program.attributes.corner, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(program.attributes.corner);
    gl.uniform1f(program.uniforms.scale, scale);
    gl.uniform1i(program.uniforms.fbTex, 0);
    gl.uniform1i(program.uniforms.triTex, 1);
    gl.uniform1i(program.uniforms.bvhTex, 2);
    gl.uniform1i(program.uniforms.matTex, 3);
    gl.uniform1i(program.uniforms.normTex, 4);
    gl.uniform1i(program.uniforms.lightTex, 5);
    gl.uniform1i(program.uniforms.uvTex, 6);
    gl.uniform1i(program.uniforms.atlasTex, 7);
    gl.uniform1i(program.uniforms.envTex, 8);
    gl.uniform1i(program.uniforms.tick, i);
    gl.uniform1f(program.uniforms.numLights, lightRanges.length / 2);
    gl.uniform2f(program.uniforms.dims, gl.viewportWidth, gl.viewportHeight);
    gl.uniform3fv(program.uniforms.envTrans, envTrans);
    gl.uniform2fv(program.uniforms.lightRanges, lightRanges);
    gl.uniform3fv(program.uniforms.eye, eye);
    gl.uniform3fv(program.uniforms.rightMax, corners.rightMax);
    gl.uniform3fv(program.uniforms.leftMin, corners.leftMin);
    gl.uniform3fv(program.uniforms.leftMax, corners.leftMax);
    gl.uniform3fv(program.uniforms.rightMin, corners.rightMin);
    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_2D, textures.env);
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, textures.atlas);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, textures.uvs);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, textures.lights);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, textures.normals);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, textures.materials);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, textures.bvh);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textures.triangles);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures.screen[(i + 1) % 2]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[i % 2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function drawQuad(i) {
    let program = programs.draw;
    gl.useProgram(program);
    gl.vertexAttribPointer(program.attributes.corner, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(program.attributes.corner);
    gl.uniform2f(program.uniforms.dims, gl.viewportWidth, gl.viewportHeight);
    gl.uniform1i(program.uniforms.fbTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, textures.screen[i % 2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }


  function tick() {
    let max = parseInt(sampleInput.value);
    if(pingpong >= max && frameNumber >= 0){
      uploadOutput();
      return
    } else {
      requestAnimationFrame(tick);
    }

    if(max && pingpong < max) {
      for (let i = 0; i < 1; i++) {
        drawTracer(moving ? 0 : pingpong);
        pingpong++;
        writeCounter(pingpong);
      }
      drawQuad(moving ? 0 : pingpong);
    }
  }

  function uploadOutput(){
    let canvas = document.getElementById('trace');
    canvas.toBlob(function(blob){
      uploadDataUrl('/upload/' + sceneName + '/' + frameNumber, blob, (res) => {
        let newFrame = frameNumber + 1;
        window.location.href = window.location.href.replace(/frame=\d+/, 'frame=' + newFrame)
      });
    });
  }

  function mergeSceneProps(scene){
    return [].concat((scene.props || []), (scene.static_props || []), Object.values(scene.animated_props || []))
  }

  function start(res) {
    let canvas = document.getElementById("trace");
    initGL(canvas);
    initPrograms(res);
    initBVH(res);
    initBuffers();
    initEvents();

    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.disable(gl.BLEND);

    tick();
  }

  Utility.getText(scenePath, function (res) {
    // Use a set to prevent multiple requests
    let pathSet = new Set([
      "shader/tracer.vs",
      "shader/tracer.fs",
      "shader/draw.vs",
      "shader/draw.fs",
      scenePath
    ]);
    let scene = JSON.parse(res);
    sampleInput.value = scene.samples || 2000;
    mergeSceneProps(scene).forEach(function (e) {
      pathSet.add(e.path);
      if(e.texture){
        pathSet.add(e.texture);
      }
    });
    if(typeof scene.environment === 'string'){
      pathSet.add(scene.environment);
    }
    writeBanner("Compiling scene");
    Utility.loadAll(Array.from(pathSet), start);
  });
}

let frameNumberMatch = window.location.search.match(/frame=(\d+)/);
let frameNumber = Array.isArray(frameNumberMatch) ? parseFloat(frameNumberMatch[1]) : -1;
let sceneMatch = window.location.search.match(/scene=([a-zA-Z_]+)/);
let scenePath = Array.isArray(sceneMatch) ? 'scene/' + sceneMatch[1] + '.json?frame=' + frameNumber : 'scene/bunny.json?frame=0';
let sceneName = Array.isArray(sceneMatch) ? sceneMatch[1] : 'bunny';
let resolutionMatch = window.location.search.match(/res=(\d+)/);
let resolution = Array.isArray(resolutionMatch) ? parseFloat(resolutionMatch[1]) : window.innerHeight;
new PathTracer(scenePath, sceneName, resolution, frameNumber);
