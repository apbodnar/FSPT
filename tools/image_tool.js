let canvasElement = document.getElementById("trace");
let loaded = 0;

let img1 = document.getElementById("first-image");
let img2 = document.getElementById("second-image");
let input1 = document.getElementById("first-input");
let input2 = document.getElementById("second-input");
let vertexElement = document.getElementById("vertex");
let fragmentElement = document.getElementById("fragment");
let button = document.getElementById("start");

input1.addEventListener("change", (e) => {
    let selectedFile = event.target.files[0];
    let reader = new FileReader();
    img1.title = selectedFile.name;
    reader.onload = function (event) {
        img1.src = event.target.result;
    };
    reader.readAsDataURL(selectedFile);
});

input2.addEventListener("change", (e) => {
    let selectedFile = event.target.files[0];
    let reader = new FileReader();
    img2.title = selectedFile.name;
    reader.onload = function (event) {
        img2.src = event.target.result;
    };
    reader.readAsDataURL(selectedFile);
});

img1.addEventListener("load", (e) => {
    loaded++;
});

img2.addEventListener("load", (e) => {
    loaded++;
});

button.addEventListener("click", (e) => {
    if (loaded === 2) {
        start();
    }
});

function start() {
    canvasElement.width = Math.max(img1.naturalWidth, img2.naturalWidth);
    canvasElement.height = Math.max(img1.naturalHeight, img2.naturalHeight);
    let gl = canvasElement.getContext("webgl2", {
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

    let tex1 = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img1);

    let tex2 = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex2);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img2);

    let fs = getShader(fragmentElement.textContent, "FRAGMENT_SHADER");
    let vs = getShader(vertexElement.textContent, "VERTEX_SHADER");
    let program = gl.createProgram();
    let uniforms = ["tex1", "tex2"];
    let attributes = ["corner"]
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

    let squareBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, squareBuffer);
    let vertices = [
        -1.0, 3.0, 0.0,
        3.0, -1.0, 0.0,
        -1.0, -1.0, 0.0
    ];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.vertexAttribPointer(program, 3, gl.FLOAT, false, 0, 0);
    gl.viewport(0, 0, canvasElement.width, canvasElement.height);
    gl.enableVertexAttribArray(program.attributes.corner);
    gl.uniform1i(program.uniforms.tex1, 0);
    gl.uniform1i(program.uniforms.tex2, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
}

