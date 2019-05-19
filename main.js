import * as Utility from './utility.js'
import * as ObjLoader from './obj_loader.js'
import {TexturePacker} from './texture_packer.js'
import {BVH} from './bvh.js'
import {Vec3} from './vector.js'

async function PathTracer(scenePath, sceneName, resolution, frameNumber, mode) {
  "use strict";
  let gl;
  let programs = {};
  let textures = {};
  let framebuffers = [];
  let bvh;
  let pingpong = 0;
  let scale;
  let envTheta;
  let exposure;
  let dir;
  let eye;
  let focalDepthElement;
  let apertureSizeElement;
  let expElement;
  let satElement;
  let lensFeatures;
  let sampleInput;
  let sampleOutput;
  let whitePointSlider;
  let saturation;
  let whitePoint;
  let lightRanges = [];
  let indirectClamp = 128;
  let atlasRes = 2048;
  let moving = false;
  let isFramed = !!window.frameElement;
  let active = !isFramed;
  const maxT = 1e6;

  function writeBanner(message) {
    document.getElementById("banner").textContent = message;
  }
  
  function initGlobals(scene) {
	focalDepthElement = document.getElementById("focal-depth");
	apertureSizeElement = document.getElementById("aperture-size");
	sampleInput = document.getElementById('max-samples');
	sampleOutput = document.getElementById("counter");
	whitePointSlider = document.getElementById("white-point");
	expElement = document.getElementById("exposure");
	satElement = document.getElementById("saturation");
	
	
	saturation = satElement.value;
	whitePoint = whitePointSlider.value;
	
	sampleInput.value = scene.samples || 2000;
	
	scale = scene.fovScale || 0.5;
	envTheta = scene.environmentTheta || 0;;
	exposure = scene.exposure || 1.0;
	dir = scene.cameraDir || [0,0,-1];
	eye = scene.cameraPos || [0, 0, 2];
	lensFeatures = [1 - 1 / focalDepthElement.value, apertureSizeElement.value];
  }

  function initGL(canvas) {
    gl = canvas.getContext("webgl2", {
      preserveDrawingBuffer: true,
      antialias: false,
      powerPreference: "high-performance"
    });
    gl.viewportWidth = canvas.width = resolution[0]; // square render target
    gl.viewportHeight = canvas.height = resolution[1];
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
        "tick", "randBase", "dims", "eye", "envTex", "indirectClamp", "lensFeatures",
        "fbTex", "triTex", "bvhTex", "matTex", "normTex", "lightTex", "uvTex", "texArray", "envTheta",
        "scale", "cameraDir", "lightRanges", "numLights"
      ],
      ["corner"],
      assets
    );
    programs.draw = initProgram(
      "shader/draw",
      ["fbTex", "exposure", "whitePoint", "saturation"],
      ["corner"],
      assets
    );
  }

  function padBuffer(buffer, perElement, channels) {
    let num_pixels = buffer.length / channels;
    let root = Math.sqrt(num_pixels);
    let width = Math.ceil(root / perElement) * perElement;
    let height = Math.ceil(num_pixels / width);
    let numToPad = channels * width * height - buffer.length;
    console.assert(numToPad >= 0);
    for (let i = 0; i < numToPad; i++) {
      buffer.push(-1);
    }
    return [width, height];
  }

  function createFlatTexture(color) {
    let canvas = document.createElement('canvas');
    canvas.naturalWidth = canvas.naturalHeight = canvas.width = canvas.height = 1;
    let ctx = canvas.getContext('2d');
    ctx.fillStyle = "rgba("+
      parseInt(color[0]*255)+","+
      parseInt(color[1]*255)+","+
      parseInt(color[2]*255)+",1)";
    ctx.fillRect( 0, 0, 1, 1 );
    return canvas
  }

  function createEnvironmentMapImg(image) {
    gl.getExtension('OES_texture_float_linear');
    textures.env = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, textures.env);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  }

  function createEnvironmentMapPixels(stops) {
    const height = 2048;
    let pixelsTmp = [];

    for(let i = 0; i < height; i++) {
      let stopIdx = Math.floor(i / (height / (stops.length - 1)));
      let rangePixels = height / (stops.length - 1);
      let sigma = (i % rangePixels) / rangePixels;
      let color = Vec3.lerp(stops[stopIdx], stops[stopIdx + 1], sigma);
      pixelsTmp.push(color[0]);
      pixelsTmp.push(color[1]);
      pixelsTmp.push(color[2]);
    }

    let pixels = new Float32Array(pixelsTmp);
    gl.getExtension('OES_texture_float_linear');
    textures.env = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, textures.env);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, 1, height, 0, gl.RGB, gl.FLOAT, pixels);
  }

  function getMaterial(transforms, group, texturePacker, assets, basePath) {
    let material = {};
    let diffuseIndex = null;
    let roughnessIndex = null;
    let normalIndex = null;
	let specularIndex = null;
    if (group.material["map_kd"]) {
      let assetUrl = basePath + "/" + group.material["map_kd"];
      diffuseIndex = texturePacker.addTexture(assets[assetUrl]);
    } else if (group.material["kd"]) {
      diffuseIndex = texturePacker.addTexture(createFlatTexture(group.material["kd"]));
    } else if (typeof transforms.diffuse === 'string') {
      diffuseIndex = texturePacker.addTexture(assets[transforms.diffuse]);
    } else if(typeof transforms.diffuse === 'object'){
      diffuseIndex = texturePacker.addTexture(createFlatTexture(transforms.diffuse));
    } else {
      diffuseIndex = texturePacker.addTexture(createFlatTexture([0.5,0.5,0.5]));
	  }

    if (group.material["map_pmr"]) {
	  let assetUrl = basePath + "/" + group.material["map_pmr"];
      roughnessIndex = texturePacker.addTexture(assets[assetUrl]);
    } else if (group.material["pmr"]) {
      roughnessIndex = texturePacker.addTexture(createFlatTexture(group.material["pmr"]));
    } else if (typeof transforms.roughness === 'string') {
      roughnessIndex = texturePacker.addTexture(assets[transforms.roughness]);
    } else {
      roughnessIndex = texturePacker.addTexture(createFlatTexture([0, transforms.roughness, 0]));
    }
	
	 if (group.material["map_kem"]) {
	   let assetUrl = basePath + "/" + group.material["map_kem"];
       specularIndex = texturePacker.addTexture(assets[assetUrl]);
    } else if (group.material["kem"]) {
      specularIndex = texturePacker.addTexture(createFlatTexture(group.material["kem"]));
    } else {
       specularIndex = texturePacker.addTexture(createFlatTexture([0, 0, 0]));
    }

    if (group.material["map_bump"]) {
	  let assetUrl = basePath + "/" + group.material["map_bump"];
      normalIndex = texturePacker.addTexture(assets[assetUrl]);
    } else if (transforms.normal) {
      normalIndex = texturePacker.addTexture(assets[transforms.normal]);
    } else {
      normalIndex = texturePacker.addTexture(createFlatTexture([0.5,0.5,1]));
    }
    material.diffuseIndex = diffuseIndex;
    material.roughnessIndex = roughnessIndex;
    material.normalIndex = normalIndex;
	material.specularIndex = specularIndex;
    material.ior = transforms.ior || 1.3;
    material.dielectric = transforms.dielectric;
    material.emittance = transforms.emittance;
    return material;
  }

  async function initBVH(assets) {
    let scene = JSON.parse(assets[scenePath]);
    //writeBanner("Compiling scene");
    let geometry = [];
    let lights = [];
    if(scene.environment){
      if(Array.isArray(scene.environment)){
        createEnvironmentMapPixels(scene.environment);
      } else {
        createEnvironmentMapImg(assets[scene.environment]);
      }
    } else {
      createEnvironmentMapPixels([[0,0,0], [0,0,0]]);
    }

    let props = mergeSceneProps(scene);
    let texturePacker = new TexturePacker(atlasRes, props.length);
    for (let i = 0; i < props.length; i++) {
      let prop = props[i];
      let basePath = prop.path.split('/').slice(0,-1).join('/');
	    console.log("Parsing:", prop.path);
      let parsed = await ObjLoader.parseMesh(assets[prop.path], prop, scene.worldTransforms, basePath);
      let groups = parsed.groups;

	  if(parsed.urls && parsed.urls.size > 0){
		console.log("Downloading: \n", Array.from(parsed.urls).join('\n'));
	    let newTextures = await Utility.loadAll(Array.from(parsed.urls));
	    assets = Object.assign(assets, newTextures);
	  }
	  Object.values(groups).forEach((group) => {
        if(Vec3.dot(prop.emittance, [1,1,1]) > 0){
          lights.push(group.triangles);
        }
        let material = getMaterial(prop, group, texturePacker, assets, basePath);
        group.triangles.forEach((t) => {
          t.material = material;
          geometry.push(t)
        });
      });
    }

    let time = new Date().getTime();
    let maxTris = 4;
	console.log("Building BVH:",geometry.length,"triangles");
    bvh = new BVH(geometry, maxTris);
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
      let reordered = [box[0], box[2], box[4], box[1], box[3], box[5]];
      let bufferNode = [e.parent, e.sibling, node.splitAxis, e.left, e.right, triIndex].concat(reordered);
      if (node.leaf) {
        let tris = node.getTriangles();
        for (let j = 0; j < tris.length; j++) {
          let subBuffer = [].concat(tris[j].verts[0], tris[j].verts[1], tris[j].verts[2]);
          subBuffer.forEach(function (el) {
            trianglesBuffer.push(el);
          });
        }
        for (let j = 0; j < tris.length; j++) {
          let material = tris[j].material;
          let subBuffer = [].concat(
            [material.diffuseIndex, material.specularIndex, material.normalIndex],
			      [material.roughnessIndex, 0, 0],
            material.emittance,
            [material.ior, material.dielectric, 0]
          );
          subBuffer.forEach(function (el) {
            materialBuffer.push(el);
          });
        }
        for (let j = 0; j < tris.length; j++) {
          let subBuffer = [];
          for (let k = 0; k < 3; k++) {
            subBuffer = subBuffer.concat(tris[j].normals[k], tris[j].tangents[k], tris[j].bitangents[k]);
          }
          subBuffer.forEach(function (el) {
            normalBuffer.push(el);
          });
        }
        for (let j = 0; j < tris.length; j++) {
          let subBuffer = [].concat(tris[j].uvs[0], tris[j].uvs[1], tris[j].uvs[2]);
          subBuffer.forEach(function (el) {
            uvBuffer.push(el);
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
    let res = padBuffer(materialBuffer, 4, 3);
    gl.bindTexture(gl.TEXTURE_2D, textures.materials);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, res[0], res[1], 0, gl.RGB, gl.FLOAT, new Float32Array(materialBuffer));

    textures.bvh = createTexture();
    res = padBuffer(bvhBuffer, 4, 3);
    gl.bindTexture(gl.TEXTURE_2D, textures.bvh);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, res[0], res[1], 0, gl.RGB, gl.FLOAT, new Float32Array(bvhBuffer));

    textures.triangles = createTexture();
    res = padBuffer(trianglesBuffer, 3, 3);
    gl.bindTexture(gl.TEXTURE_2D, textures.triangles);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, res[0], res[1], 0, gl.RGB, gl.FLOAT, new Float32Array(trianglesBuffer));

    textures.normals = createTexture();
    res = padBuffer(normalBuffer, 9, 3);
    gl.bindTexture(gl.TEXTURE_2D, textures.normals);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, res[0], res[1], 0, gl.RGB, gl.FLOAT, new Float32Array(normalBuffer));

    textures.lights = createTexture();
    res = padBuffer(lightBuffer, 3, 3);
    gl.bindTexture(gl.TEXTURE_2D, textures.lights);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, res[0], res[1], 0, gl.RGB, gl.FLOAT, new Float32Array(lightBuffer));

    textures.uvs = createTexture();
    res = padBuffer(uvBuffer, 3, 2);
    gl.bindTexture(gl.TEXTURE_2D, textures.uvs);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, res[0], res[1], 0, gl.RG, gl.FLOAT, new Float32Array(uvBuffer));
    writeBanner("");

    initAtlas(assets, texturePacker);

    return new Promise(resolve => {resolve(true)});
  }
  
  function shootAutoFocusRay() {
    function rayTriangleIntersect(tri){
      let epsilon = 0.000000000001;
      let e1 = Vec3.sub(tri.verts[1], tri.verts[0]);
      let e2 = Vec3.sub(tri.verts[2], tri.verts[0]);
      let p = Vec3.cross(dir, e2);
      let det = Vec3.dot(e1, p);
      if(det > -epsilon && det < epsilon){return maxT}
      let invDet = 1.0 / det;
      let t = Vec3.sub(eye, tri.verts[0]);
      let u = Vec3.dot(t, p) * invDet;
      if(u < 0 || u > 1){return maxT}
      let q = Vec3.cross(t, e1);
      let v = Vec3.dot(dir, q) * invDet;
      if(v < 0 || u + v > 1){return maxT}
      t = Vec3.dot(e2, q) * invDet;
      if(t > epsilon){
        return t;
      }
      return maxT;
    }
	
    function processLeaf(root){
      let res = maxT;
	  let tris = root.getTriangles();
      for(let i=0; i<tris.length; i++){
        let tmp = rayTriangleIntersect(tris[i])
        if(tmp < res){
          res = tmp;
        }
      }
      return res;
    }
    
    function rayBoxIntersect(bbox){
      let invDir = Vec3.inverse(dir),
          box = bbox.getBounds(),
          tx1 = (box[0] - eye[0]) * invDir[0],
          tx2 = (box[1] - eye[0]) * invDir[0],
          ty1 = (box[2] - eye[1]) * invDir[1],
          ty2 = (box[3] - eye[1]) * invDir[1],
          tz1 = (box[4] - eye[2]) * invDir[2],
          tz2 = (box[5] - eye[2]) * invDir[2];

      let tmin = Math.min(tx1, tx2);
      let tmax = Math.max(tx1, tx2);
      tmin = Math.max(tmin, Math.min(ty1, ty2));
      tmax = Math.min(tmax, Math.max(ty1, ty2));
      tmin = Math.max(tmin, Math.min(tz1, tz2));
      tmax = Math.min(tmax, Math.max(tz1, tz2));
      
      return tmax >= tmin && tmax >= 0 ? tmin : maxT;
    }
    
    function closestNode(nLeft, nRight){
      let tLeft = rayBoxIntersect(nLeft.boundingBox);
      let tRight = rayBoxIntersect(nRight.boundingBox);
      let left = tLeft < maxT ? nLeft : null;
      let right = tRight < maxT ? nRight : null;
      if(tLeft < tRight){
        return [{node: left, t: tLeft}, {node: right, t: tRight}]
      }
      return [{node: right, t: tRight}, {node: left, t: tLeft}]
    }
    function findTriangles(root, closest){
      if(root.leaf){
        return processLeaf(root);
      }
      let ord = closestNode(root.left, root.right);
      for(let i=0 ; i < ord.length; i++){
        if(ord[i].node && ord[i].t < closest){
          let res = findTriangles(ord[i].node, closest);
          closest = Math.min(res, closest);
        }
      }
      return closest;
    }
	
    let dist = findTriangles(bvh.root, maxT);
    lensFeatures[0] = 1 - 1 / dist;
	focalDepthElement.value = dist.toFixed(3);
  }

  function initAtlas(assets, texturePacker){
    textures.array = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D_ARRAY, textures.array);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA, atlasRes, atlasRes, texturePacker.imageSet.length, 0, gl.RGBA,
      gl.UNSIGNED_BYTE, texturePacker.getPixels()
    );
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
    let canvasElement = document.getElementById("trace");
    let cameraDirElement = document.getElementById("camera-dir");
    let eyePosElement = document.getElementById("eye-pos");
	let thetaElement = document.getElementById("env-theta");
    let xi, yi;
    let mode = false;

    function addTranslation(shift) {
      eye = Vec3.add(eye, shift);
    }
	
    canvasElement.addEventListener("mousedown", function (e) {
      mode = e.which === 1;
      xi = e.layerX;
      yi = e.layerY;
    }, false);
    canvasElement.addEventListener("mousemove", function (e) {
      if (mode) {
        moving = true;
        pingpong = 0;
        let rx = (xi - e.layerX) / 180.0;
        let ry = (yi - e.layerY) / 180.0;
        dir = Vec3.normalize(Vec3.rotateY(dir, rx));
        let axis = Vec3.normalize(Vec3.cross(dir, [0,1,0]));
        dir = Vec3.normalize(Vec3.rotateArbitrary(dir, axis, ry));
        xi = e.layerX;
        yi = e.layerY;
        cameraDirElement.value = String(dir.map((comp) => { return comp.toFixed(3) }));
      }
    }, false);
    canvasElement.addEventListener("mouseup", function (e) {
      mode = false;
      moving = false;
      if(e.which === 1){
        pingpong = 0;
      }
	  shootAutoFocusRay();
    }, false);
    canvasElement.addEventListener('mousewheel', function (e) {
      scale -= e.wheelDelta / 1200 * scale;
      pingpong = 0;
    }, false);
	
	thetaElement.addEventListener('input', function (e) {
      envTheta = parseFloat(e.target.value);
	    pingpong = 0;
    }, false);

    expElement.addEventListener('input', function (e) {
      exposure = parseFloat(e.target.value);
    }, false);
	
	whitePointSlider.addEventListener('input', function (e) {
      whitePoint = parseFloat(e.target.value);
    }, false);
	
	satElement.addEventListener('input', function (e) {
      saturation = parseFloat(e.target.value);
    }, false);


    focalDepthElement.addEventListener("input", function(e) {
      lensFeatures[0] = 1 - (1 / parseFloat(e.target.value));
      pingpong = 0;
    }, false);

    apertureSizeElement.addEventListener("input", function(e) {
      lensFeatures[1] = parseFloat(e.target.value);
      pingpong = 0;
    }, false);

    document.addEventListener("keypress", function (e) {
      let strafe = Vec3.normalize(Vec3.cross(dir, [0,1,0]));
      switch (e.key) {
        case 'w':
          addTranslation(Vec3.scale(dir, 0.1));
          pingpong = 0;
          break;
        case 'a':
          addTranslation(Vec3.scale(strafe, -0.1));
          pingpong = 0;
          break;
        case 's':
          addTranslation(Vec3.scale(dir, -0.1));
          pingpong = 0;
          break;
        case 'd':
          addTranslation(Vec3.scale(strafe, 0.1));
          pingpong = 0;
          break;
        case 'r':
          addTranslation(Vec3.scale(Vec3.normalize(Vec3.cross(dir, strafe)), -0.1));
          pingpong = 0;
          break;
        case 'f':
          addTranslation(Vec3.scale(Vec3.normalize(Vec3.cross(dir, strafe)), 0.1));
          pingpong = 0;
          break;
      }
	  eyePosElement.value = String(eye.map((comp) => { return comp.toFixed(3) }));
	  shootAutoFocusRay();
    }, false);
  }

  function drawTracer(i) {
    let program = programs.tracer;
    gl.useProgram(program);
    //gl.viewport(offsetX, offsetY, height, width);
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
    gl.uniform1i(program.uniforms.texArray, 7);
    gl.uniform1i(program.uniforms.envTex, 8);
    gl.uniform1i(program.uniforms.tick, i);
    gl.uniform1f(program.uniforms.numLights, lightRanges.length / 2);
    gl.uniform1f(program.uniforms.indirectClamp, indirectClamp);
    gl.uniform1f(program.uniforms.randBase, Math.random() * 10000);
    gl.uniform1f(program.uniforms.envTheta, envTheta);
    gl.uniform2fv(program.uniforms.lensFeatures, lensFeatures);
    gl.uniform2fv(program.uniforms.lightRanges, lightRanges);
    gl.uniform3fv(program.uniforms.eye, eye);
    gl.uniform3fv(program.uniforms.cameraDir, dir);
    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_2D, textures.env);
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, textures.array);
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
    gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
    gl.vertexAttribPointer(program.attributes.corner, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(program.attributes.corner);
	gl.uniform1f(program.uniforms.saturation, saturation);
    gl.uniform1f(program.uniforms.exposure, exposure);
	gl.uniform1f(program.uniforms.whitePoint, whitePoint);
    gl.uniform1i(program.uniforms.fbTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, textures.screen[i % 2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  let currentTile = 0;

  function tick() {
    let max = parseInt(sampleInput.value);
    if(pingpong >= max && frameNumber >= 0){
      uploadOutput();
      return
    } else {
      requestAnimationFrame(tick);
    }

    if(max && pingpong < max && active) {
      drawTracer(moving ? 0 : pingpong);
      pingpong++;
      drawTracer(moving ? 0 : pingpong);
      pingpong++;
      sampleOutput.value = pingpong;
    }
	drawQuad(moving ? 0 : pingpong);
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

  function mergeSceneProps(scene) {
    return [].concat((scene.props || []), (scene.static_props || []), Object.values(scene.animated_props || []))
  }

  async function start(res) {
    let preprocDirs = [];
    let modeSet = new Set(mode.split('_').map(e => e.toLowerCase()));
    if(mode === 'test'){
      res["shader/tracer.fs"] = res["shader/bvh_test.fs"];
    } else {
      if (modeSet.has('nee')) {
        console.log('Using next event estimation');
        preprocDirs.push('#define USE_EXPLICIT');
      }
      if (modeSet.has('alpha')) {
        console.log('Using alpha textures');
        preprocDirs.push('#define USE_ALPHA');
      }

      let shaderLines = res["shader/tracer.fs"].split('\n');
      shaderLines.splice(1, 0, ...preprocDirs);
      res["shader/tracer.fs"] = shaderLines.join('\n');
    }
    window.addEventListener("mouseover",function(){ active = true; });
    window.addEventListener("mouseout",function(){ active = !isFramed; });
    let canvas = document.getElementById("trace");
    initGL(canvas);
    initPrograms(res);
    await initBVH(res);
    initBuffers();
    initEvents();

    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.disable(gl.BLEND);
    tick();
  }

  let sceneRes = await Utility.getText(scenePath);
    // Use a set to prevent multiple requests
  let pathSet = new Set([
    "shader/tracer.vs",
    "shader/tracer.fs",
    "shader/bvh_test.fs",
    "shader/draw.vs",
    "shader/draw.fs",
    scenePath
  ]);
  let scene = JSON.parse(sceneRes);
  initGlobals(scene);
  mergeSceneProps(scene).forEach(function (e) {
    pathSet.add(e.path);
    if(typeof e.diffuse === 'string'){
      pathSet.add(e.diffuse);
    }
    if(typeof e.roughness === 'string'){
      pathSet.add(e.roughness);
    }
    if(e.normal){
      pathSet.add(e.normal);
    }
  });
  if(typeof scene.environment === 'string'){
    pathSet.add(scene.environment);
  }
  writeBanner("Compiling scene");
  atlasRes = scene.atlasRes || atlasRes;
  let assetRes = await Utility.loadAll(Array.from(pathSet));
  start(assetRes);
}

function getResolution(){
  let resolutionMatch = window.location.search.match(/res=(\d+)(x*)(\d+)?/);
  console.log(resolutionMatch);
  if(Array.isArray(resolutionMatch) && resolutionMatch[1] && resolutionMatch[3]){
    return [resolutionMatch[1], resolutionMatch[3]];
  } else if(Array.isArray(resolutionMatch) && resolutionMatch[1] && resolutionMatch[2]) {
    return [window.innerWidth / resolutionMatch[1], window.innerHeight / resolutionMatch[1]];
  } else if(Array.isArray(resolutionMatch) && resolutionMatch[1]) {
    return [resolutionMatch[1], resolutionMatch[1]];
  } else {
    return [window.innerWidth, window.innerHeight];
  }
}

let frameNumberMatch = window.location.search.match(/frame=(\d+)/);
let frameNumber = Array.isArray(frameNumberMatch) ? parseFloat(frameNumberMatch[1]) : -1;
let sceneMatch = window.location.search.match(/scene=([a-zA-Z_]+)/);
let scenePath = Array.isArray(sceneMatch) ? 'scene/' + sceneMatch[1] + '.json?frame=' + frameNumber : 'scene/bunny.json?frame=0';
let sceneName = Array.isArray(sceneMatch) ? sceneMatch[1] : 'bunny';
let modeMatch = window.location.search.match(/mode=([a-zA-Z_]+)/);
let mode = Array.isArray(modeMatch) && modeMatch.length > 0 ? modeMatch[1] : null;
let resolution = getResolution();

PathTracer(scenePath, sceneName, resolution, frameNumber, mode);
