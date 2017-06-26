(function (exports) {
  exports.parseMesh = function (objText, transforms) {
    let lines = objText.split('\n');
    let vertices = [];
    let triangles = [];
    let vertNormals = [];
    let uvs = [];

    function applyTransforms(vert) {
      return Vec3.rotateArbitrary(Vec3.add(Vec3.scale(vert, transforms.scale), transforms.translate), transforms.rotate.axis, transforms.rotate.angle);
    }

    function getNormal(tri) {
      let e1 = Vec3.sub(tri.v2, tri.v1);
      let e2 = Vec3.sub(tri.v3, tri.v1);
      return Vec3.normalize(Vec3.cross(e1, e2));
    }

    function averageNormals(normArray) {
      let total = [0, 0, 0];
      for (let i = 0; i < normArray.length; i++) {
        total = Vec3.add(total, normArray[i]);
      }
      return Vec3.scale(total, 1.0 / normArray.length);
    }
    
    function parseQuad(quad_indices){
      [
        [quad_indices[0], quad_indices[1], quad_indices[2]], 
        [quad_indices[0], quad_indices[2], quad_indices[3]]
      ].forEach(parseTriangle);
    }
    
    function parseTriangle(indices){
      let i1 = transforms.invert_faces ? 1 : 0;
      let i2 = transforms.invert_faces ? 0 : 1;
      let tri = new Triangle(
        applyTransforms(vertices[indices[i1][0] - 1]),
        applyTransforms(vertices[indices[i2][0] - 1]),
        applyTransforms(vertices[indices[2][0] - 1]),
        indices[i1][0] - 1, indices[i2][0] - 1, indices[2][0] - 1,
        uvs[indices[i1][1] - 1], uvs[indices[i2][1] - 1], uvs[indices[2][1] - 1],
        transforms
      );
      let normal = getNormal(tri);
      tri.normals = [normal, normal, normal];
      triangles.push(tri);
      for (let j = 0; j < indices.length; j++) {
        if (!vertNormals[indices[j][0] - 1]) {
          vertNormals[indices[j][0] - 1] = [];
        }
        vertNormals[indices[j][0] - 1].push(normal);
      }
    }

    for (let i = 0; i < lines.length; i++) {
      let array = lines[i].split(/[ ]+/);
      let vals = array.slice(1, 5);
      if (array[0] == 'v') {
        vertices.push(vals.map(parseFloat))
      } else if (array[0] == 'f') {
        debugger;
        vals = vals.map(function(s){return s.split('/').map(parseFloat)})
        if(vals.length == 3){
          parseTriangle(vals);
        } else {
          parseQuad(vals);
        }
      } else if(array[0] == 'vt'){
        uvs.push(vals.map(parseFloat));
      }
    }
    let original = triangles.length;
    if (transforms.normals == "smooth") {
      for (let i = 0; i < triangles.length; i++) {
        triangles[i].normals[0] = averageNormals(vertNormals[triangles[i].i1])
        triangles[i].normals[1] = averageNormals(vertNormals[triangles[i].i2])
        triangles[i].normals[2] = averageNormals(vertNormals[triangles[i].i3])
      }
    }
    // for(let i = 0; i < triangles.length; i++) {
    //   let subTriangles = splitTriangle(triangles[i], span/1);
    //   if(subTriangles.length > 1){
    //
    //     triangles.splice(i,1)
    //     subTriangles.forEach(function(e){triangles.push(e)});
    //   }
    // }
    console.log(transforms.path, "original:", original, "split:", triangles.length);
    return triangles;
  }
})(this)