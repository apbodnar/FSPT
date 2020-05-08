import { Triangle } from './bvh.js'
import { Vec3 } from './vector.js'
import { ParseMaterials } from './mtl_loader.js'
import * as Utility from './utility.js'

export async function parseMesh(objText, transforms, worldTransforms, basePath) {
  let lines = objText.split('\n');
  let vertices = [];
  let vertNormals = [];
  let meshNormals = [];
  let uvs = [];
  let currentGroup = "FSPT_DEFAULT_GROUP";
  let groups = {};
  let materials = {};
  let skips = new Set(transforms.skips);
  let urls = null;
  let bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };

  function applyRotations(vert) {
    transforms.rotate.forEach((r) => { vert = Vec3.rotateArbitrary(vert, r.axis, r.angle) });
    return vert;
  }

  function applyVectorTransforms(vert, rotationOnly = false) {
    let modelTransformed = Vec3.add(Vec3.scale(applyRotations(vert), rotationOnly ? 1 : transforms.scale), rotationOnly ? [0, 0, 0] : transforms.translate);
    if (worldTransforms) {
      worldTransforms.forEach(function (transform) {
        if (transform.rotate) {
          transform.rotate.forEach(function (rotation) {
            modelTransformed = Vec3.rotateArbitrary(modelTransformed, rotation.axis, rotation.angle);
          });
        } else if (transform.translate && !rotationOnly) {
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

  function parseFace(quad_indices) {
    let triList = [];
    for (let i = 0; i < quad_indices.length - 2; i++) {
      triList.push([quad_indices[0], quad_indices[i + 1], quad_indices[i + 2]])
    }
    triList.forEach(parseTriangle);
  }

  function calcTangents(triangle) {
    if (!triangle.uvs[0]) {
      triangle.verts.forEach((vert, i) => {
        let dir = Vec3.normalize(vert);
        let u = Math.atan2(dir[2], dir[0]) / (Math.PI * 2);
        let v = Math.asin(-dir[1]) / Math.PI + 0.5;
        triangle.uvs[i] = [u, v];
      });
    }

    for (let i = 0; i < triangle.uvs.length; i++) {
      triangle.uvs[i] = Array.from(triangle.uvs[i]);
      triangle.uvs[i][0] += Number.EPSILON * (i + 1);
      triangle.uvs[i][1] += Number.EPSILON * (i + 1);
    }

    let deltaPos0 = Vec3.sub(triangle.verts[1], triangle.verts[0]);
    let deltaPos1 = Vec3.sub(triangle.verts[2], triangle.verts[0]);

    let deltaUv0 = Vec3.sub(triangle.uvs[1], triangle.uvs[0]);
    let deltaUv1 = Vec3.sub(triangle.uvs[2], triangle.uvs[0]);

    let r = 1.0 / ((deltaUv0[0] * deltaUv1[1]) - (deltaUv0[1] * deltaUv1[0]));
    let preTangent = Vec3.normalize(Vec3.scale(Vec3.sub(Vec3.scale(deltaPos0, deltaUv1[1]), Vec3.scale(deltaPos1, deltaUv0[1])), r));
    //let bt = Vec3.normalize(Vec3.scale(Vec3.sub(Vec3.scale(deltaPos1, deltaUv0[0]), Vec3.scale(deltaPos0, deltaUv1[0])), r));
    for (let i = 0; i < 3; i++) {
      let normal = triangle.normals[i];
      let preBitangent = Vec3.normalize(Vec3.cross(normal, preTangent));
      let tangent = Vec3.normalize(Vec3.cross(preBitangent, normal));
      let bitangent = Vec3.normalize(Vec3.cross(normal, tangent));

      if (isNaN(Vec3.dot(tangent, bitangent))) {
        let t = Vec3.cross(triangle.normals[i], [0, 1, 0]);
        triangle.tangents[i] = t;
        triangle.bitangents[i] = Vec3.cross(t, triangle.normals[i]);
      }
      triangle.tangents.push(tangent);
      triangle.bitangents.push(bitangent);
    }
  }

  function parseTriangle(indices) {
    for (let i = 0; i < indices.length; i++) {
      for (let j = 0; j < indices[i].length; j++) {
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
      [
        applyVectorTransforms(vertices[indices[0][0] - 1]),
        applyVectorTransforms(vertices[indices[1][0] - 1]),
        applyVectorTransforms(vertices[indices[2][0] - 1])
      ],
      [
        indices[0][0] - 1,
        indices[1][0] - 1,
        indices[2][0] - 1
      ],
      [
        uvs[(indices[0][1] - 1)],
        uvs[(indices[1][1] - 1)],
        uvs[(indices[2][1] - 1)]
      ],
      transforms
    );

    for (let i = 0; i < tri.verts.length; i++) {
      for (let j = 0; j < tri.verts[i].length; j++) {
        bounds.max = Vec3.max(bounds.max, tri.verts[i]);
        bounds.min = Vec3.min(bounds.min, tri.verts[i]);
      }
    }

    // Use mesh normals or calculate them
    if (transforms.normals === "mesh") {
      tri.setNormals([
        Vec3.normalize(applyVectorTransforms(meshNormals[indices[0][2] - 1], true)),
        Vec3.normalize(applyVectorTransforms(meshNormals[indices[1][2] - 1], true)),
        Vec3.normalize(applyVectorTransforms(meshNormals[indices[2][2] - 1], true))
      ]);
    } else {
      let normal = getNormal(tri);
      tri.normals = [normal, normal, normal];
      for (let j = 0; j < indices.length; j++) {
        if (!vertNormals[indices[j][0] - 1]) {
          vertNormals[indices[j][0] - 1] = [];
        }
        vertNormals[indices[j][0] - 1].push(normal);
      }
    }

    groups[currentGroup].triangles.push(tri);
  }

  for (let i = 0; i < lines.length; i++) {
    let array = lines[i].trim().split(/[ ]+/);
    let vals = array.slice(1, array.length);

    if (array[0] === 'v') {
      vertices.push(vals.splice(0, 3).map(parseFloat))
    } else if (array[0] === 'f' && !skips.has(currentGroup)) {
      if (!groups[currentGroup]) {
        groups[currentGroup] = { triangles: [], material: materials[currentGroup] || {} };
      }
      vals = vals.map(function (s) { return s.split('/').map(parseFloat) });
      parseFace(vals);
    } else if (array[0] === 'vt') {
      let uv = vals.map(function (coord) { return parseFloat(coord) || 0 });
      // Don't support 3D textures
      let tuv = uv.splice(0, 2);
      uvs.push(tuv);
    } else if (array[0] === 'vn') {
      meshNormals.push(vals.map(parseFloat))
    } else if (array[0] === 'usemtl') {
      currentGroup = array.splice(1, Infinity).join(' ');
    } else if (array[0] === 'mtllib') {
      let mtlUrl = basePath + '/' + array.splice(1, Infinity).join(' ');
      let text = await Utility.getText(mtlUrl);
      let parsedMats = ParseMaterials(text, basePath);
      materials = parsedMats.materials;
      urls = parsedMats.urls;
    }
  }

  Object.entries(groups).forEach((pair) => {
    let group = pair[1];
    if (transforms.normals === "smooth") {
      for (let i = 0; i < group.triangles.length; i++) {
        for (let j = 0; j < 3; j++) {
          group.triangles[i].normals[j] = averageNormals(vertNormals[group.triangles[i].indices[j]]);
        }
      }
    }
  });

  Object.entries(groups).forEach((pair) => {
    let key = pair[0];
    let group = pair[1];
    console.log(transforms.path, key, group.triangles.length, "triangles");
    group.triangles.forEach((tri) => {
      calcTangents(tri);
    });
  });

  return new Promise(resolve => { resolve({ groups: groups, urls: urls, bounds: bounds }) });
}
