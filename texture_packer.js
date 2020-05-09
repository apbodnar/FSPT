/**
 * Created by adam on 6/26/17.
 */

export class TexturePacker {
  constructor(atlasRes) {
    this.res = atlasRes;
    this.imageSet = [];
    this.imageKeys = {};
    this.maxRes = 0;
  }

  addTexture(image, corrected) {
    if (this.imageKeys[image.currentSrc]) {
      return this.imageKeys[image.currentSrc]
    } else {
      this.maxRes = Math.max(this.maxRes, image.height);
      image.corrected = corrected;
      this.imageSet.push(image);
      this.imageKeys[image.currentSrc] = this.imageSet.length - 1;
      return this.imageKeys[image.currentSrc];
    }
  }

  addColor(color) {
    let key = color.join(' ');
    if (this.imageKeys[key]) {
      return this.imageKeys[key]
    } else {
      this.imageSet.push(color);
      this.imageKeys[key] = this.imageSet.length - 1;
      return this.imageKeys[key];
    }
  }

  setAndGetResolution() {
    if (this.maxRes < this.res) {
      console.log("Using texture dimensions of " + this.maxRes + "px instead of specified " + this.res + "px.")
      this.res = this.maxRes;
    }
    return this.res;
  }

  getPixels() {
    let time = new Date().getTime();
    let glWriter = new WebGLTextureWriter(this.res);
    let pixels = new Uint8Array(this.res * this.res * 4 * this.imageSet.length);
    for (let i = 0; i < this.imageSet.length; i++) {
      let img = this.imageSet[i];
      if (Array.isArray(img)) {
        glWriter.setAndDrawColor(img);
      } else {
        glWriter.setAndDrawTexture(img);
      }

      let pixBuffer = glWriter.getPixels();
      let offset = i * this.res * this.res * 4;
      pixels.set(pixBuffer, offset)
    }
    console.log("Textures packed in ", (new Date().getTime() - time) / 1000.0, " seconds");
    return pixels;
  }
}


class WebGLTextureWriter {
  constructor(atlasRes) {
    this.res = atlasRes;
    this.canvasElement = document.createElement('canvas');
    this.canvasElement.width = atlasRes;
    this.canvasElement.height = atlasRes;
    let gl = this.gl = this.canvasElement.getContext("webgl2", {
        preserveDrawingBuffer: true,
        antialias: false,
        powerPreference: "high-performance"
    });

    function getShader(str, id) {
        let shader = gl.createShader(gl[id]);
        gl.shaderSource(shader, str);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.log(id + gl.getShaderInfoLog(shader));
            return null;
        }
        return shader;
    }

    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    let vsStr = `#version 300 es
    precision highp float;
    in vec3 corner;
    void main(void) {
        gl_Position = vec4(corner, 1.0);
    }
    `;
    let fsStr = `#version 300 es
    precision highp float;
    uniform vec2 dims;
    uniform uvec4 swizzle;
    uniform sampler2D tex;
    
    out vec4 fragColor;
    
    void main(void) {
      vec2 uv = gl_FragCoord.xy / dims;
      uv.y = 1.0 - uv.y;
      vec4 c = texture(tex, uv);
      vec4 copy = c;
      c[0] = copy[swizzle[0]];
      c[1] = copy[swizzle[1]];
      c[2] = copy[swizzle[2]];
      c[3] = copy[swizzle[3]];
      fragColor = vec4(c.rgb * c.a, 1.0);
    }`;
    let fs = getShader(fsStr, "FRAGMENT_SHADER");
    let vs = getShader(vsStr, "VERTEX_SHADER");
    this.program = gl.createProgram();
    let uniforms = ["tex", "swizzle", "dims"];
    let attributes = ["corner"]
    this.program.uniforms = {};
    this.program.attributes = {};
    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);
    gl.useProgram(this.program);
    uniforms.forEach((name) => {
      this.program.uniforms[name] = gl.getUniformLocation(this.program, name);
    });
    attributes.forEach((name) => {
      this.program.attributes[name] = gl.getAttribLocation(this.program, name);
    });

    let squareBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, squareBuffer);
    let vertices = [
        -1.0, 3.0, 0.0,
        3.0, -1.0, 0.0,
        -1.0, -1.0, 0.0
    ];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.vertexAttribPointer(this.program, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(this.program.attributes.corner);
  }

  setAndDrawColor(color) {
    let gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(color[0], color[1], color[2], 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  setAndDrawTexture(img) {
    let gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    if (img.corrected) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(0, 0, this.canvasElement.width, this.canvasElement.height);
    gl.uniform1i(this.program.uniforms.tex, 0);
    gl.uniform2f(this.program.uniforms.dims, this.res, this.res);
    gl.uniform4uiv(this.program.uniforms.swizzle, img.swizzle || [0, 1, 2, 3])
    gl.activeTexture(gl.TEXTURE0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  getPixels() {
    let gl = this.gl;
    let pixels = new Uint8Array( this.canvasElement.width * this.canvasElement.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, this.canvasElement.width, this.canvasElement.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels, 0);
    return pixels; 
  }
}