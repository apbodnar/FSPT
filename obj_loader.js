import {Triangle} from './primitive_tree.js'
import {Vec3} from './vector.js'

export function parseMesh(objText, transforms, worldTransforms) {
  let lines = objText.split('\n');
  let vertices = [];
  let triangles = [];
  let vertNormals = [];
  let meshNormals = [];
  let uvs = [];

  function transformUV(uv, trans){
    uv[0] *= trans.scale;
    uv[1] *= trans.scale;
    uv[0] += trans.offset[0];
    uv[1] += trans.offset[1];
    return uv;
  }

  function applyRotations(vert){
    transforms.rotate.forEach((r) => {vert = Vec3.rotateArbitrary(vert, r.axis, r.angle)});
    return vert;
  }

  function applyVectorTransforms(vert, rotationOnly=false) {
    let modelTransformed =  Vec3.add(Vec3.scale(applyRotations(vert), rotationOnly ? 1 : transforms.scale), rotationOnly ? [0, 0, 0] : transforms.translate);
    if(worldTransforms){
      worldTransforms.forEach(function(transform){
        if(transform.rotate){
          transform.rotate.forEach(function(rotation){
            modelTransformed = Vec3.rotateArbitrary(modelTransformed, rotation.axis, rotation.angle);
          });
        } else if(transform.translate && !rotationOnly) {
          modelTransformed = Vec3.add(modelTransformed, transform.translate);
        }
      });
    }
    return modelTransformed;
  }

  function getNormal(tri) {
    let e1 = Vec3.sub(tri.verts[1], tri.verts[0]);
    let e2 = Vec3.sub(tri.verts[2], tri.verts[0]);
    return Vec3.normalize(Vec3.cross(e1, e2));
  }

  function averageNormals(normArray) {
    let total = [0, 0, 0];
    for (let i = 0; i < normArray.length; i++) {
      total = Vec3.add(total, normArray[i]);
    }
    return Vec3.scale(total, 1.0 / normArray.length);
  }

  function parseFace(quad_indices){
    let triList = [];
    for(let i=0; i < quad_indices.length - 2; i++){
      triList.push([quad_indices[0], quad_indices[i+1], quad_indices[i+2]])
    }
    triList.forEach(parseTriangle);
  }

  function parseTriangle(indices){
    for(let i=0; i<indices.length; i++){
      for(let j=0; j<indices[i].length; j++){
        switch (j) {
          case 0:
            indices[i][j] = indices[i][j] < 1 ? vertices.length + indices[i][j] + 1 : indices[i][j];
            break;
          case 1:
            break;
          case 2:
            indices[i][j] = indices[i][j] < 1 ? meshNormals.length + indices[i][j] + 1 : indices[i][j];
        }
      }
    }
    let tri = new Triangle(
      applyVectorTransforms(vertices[indices[0][0] - 1]),
      applyVectorTransforms(vertices[indices[1][0] - 1]),
      applyVectorTransforms(vertices[indices[2][0] - 1]),
      indices[0][0] - 1, indices[1][0] - 1, indices[2][0] - 1,
      uvs[(indices[0][1] - 1) || 0], uvs[(indices[1][1] - 1) || 0], uvs[(indices[2][1] - 1 || 0)],
      transforms
    );

    // Use mesh normals or calculate them
    if(transforms.normals === "mesh"){
      tri.normals = [
        applyVectorTransforms(meshNormals[indices[0][2] - 1], true),
        applyVectorTransforms(meshNormals[indices[1][2] - 1], true),
        applyVectorTransforms(meshNormals[indices[2][2] - 1], true)
      ]
    } else {
      let normal = getNormal(tri);
      tri.normals =  [normal, normal, normal];
      for (let j = 0; j < indices.length; j++) {
        if (!vertNormals[indices[j][0] - 1]) {
          vertNormals[indices[j][0] - 1] = [];
        }
        vertNormals[indices[j][0] - 1].push(normal);
      }
    }
    triangles.push(tri);

  }

  for (let i = 0; i < lines.length; i++) {
    let array = lines[i].trim().split(/[ ]+/);
    let vals = array.slice(1, array.length);
    if (array[0] === 'v') {
      vertices.push(vals.map(parseFloat))
    } else if (array[0] === 'f') {
      //debugger;
      vals = vals.map(function(s){return s.split('/').map(parseFloat)})
      parseFace(vals);
    } else if(array[0] === 'vt'){
      let uv = vals.map(function(coord){return parseFloat(coord) || 0});
      let tuv = transformUV(uv, transforms.uvTransforms);
      uvs.push(tuv);
    } else if(array[0] === 'vn'){
      meshNormals.push(vals.map(parseFloat))
    }
  }
  //for the mesh to have a vt attribute for atlas reads
  if(uvs.length === 0){
    uvs.push([0, 0]);
  }
  let original = triangles.length;
  if (transforms.normals === "smooth") {
    for (let i = 0; i < triangles.length; i++) {
      for (let j = 0; j < 3; j++){
        triangles[i].normals[j] = averageNormals(vertNormals[triangles[i].indices[j]]);
      }
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
  console.log(transforms.path, original, "triangles");
  return triangles;
}
