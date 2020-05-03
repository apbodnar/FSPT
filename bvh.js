import {
  Vec3
} from './vector.js'

export class BVH {
  constructor(triangles, maxTris) {
    let xIndices = triangles.map((_, i) => { return i });
    let yIndices = Array.from(xIndices);
    let zIndices = Array.from(yIndices);
    this.maxTriangles = maxTris;
    this.triangles = triangles;
    this.depth = 0;
    this._sortIndices(xIndices, 0);
    this._sortIndices(yIndices, 1);
    this._sortIndices(zIndices, 2);
    this.root = this.buildTree([xIndices, yIndices, zIndices], this.depth);
  }

  buildTree(indices, depth) {
    this.depth = Math.max(depth, this.depth);
    let root = new Node(this.triangles, indices);
    if (root.indices[root.splitAxis || 0].length <= this.maxTriangles) {
      root.leaf = true;
      return root;
    }
    let splitIndices = this._constructCachedIndexList(indices, root.splitAxis, root.splitIndex);
    root.left = this.buildTree(splitIndices.left, depth + 1);
    root.right = this.buildTree(splitIndices.right, depth + 1);
    root.clearTempBuffers();
    return root;
  }

  serializeTree() {
    let nodes = [],
      i = -1;

    function traverseTree(root) {
      let parent = ++i;
      let node = { node: root };
      nodes.push(node);
      if (!root.leaf) {
        node.left = traverseTree(root.left, parent);
        node.right = traverseTree(root.right, parent);
      }
      return parent
    }

    traverseTree(this.root, i);
    return nodes;
  }

  _constructCachedIndexList(indices, splitAxis, splitIndex) {
    // Avoid re sorting by plucking from pre sorted buffers
    let leftIndices = [null, null, null];
    leftIndices[splitAxis] = indices[splitAxis].slice(0, splitIndex);
    let rightIndices = [null, null, null];
    rightIndices[splitAxis] = indices[splitAxis].slice(splitIndex, indices[splitAxis].length);
    let setLeft = new Set(leftIndices[splitAxis]);
    let remainingAxes = [0, 1, 2].filter((e) => { return e !== splitAxis });

    for (let i = 0; i < remainingAxes.length; i++) {
      let axis = remainingAxes[i];
      leftIndices[axis] = Array(leftIndices[splitAxis].length)
      rightIndices[axis] = Array(rightIndices[splitAxis].length)
      let li = 0, ri = 0;
      for (let j = 0; j < indices[axis].length; j++) {
        let idx = indices[axis][j];
        if (setLeft.has(idx)) {
          leftIndices[axis][li++] = idx;
        } else {
          rightIndices[axis][ri++] = idx;
        }
      }
    }
    return { left: leftIndices, right: rightIndices };
  }

  _sortIndices(indices, axis) {
    indices.sort((i1, i2) => {
      let c1 = this.triangles[i1].boundingBox.centroid[axis];
      let c2 = this.triangles[i2].boundingBox.centroid[axis];
      if (c1 < c2) {
        return -1;
      }
      if (c1 > c2) {
        return 1;
      }
      return 0;
    });
  }
}

export class BoundingBox {
  // if indices are passed, assume triangles is ALL triangles
  constructor() {
    this.min = [Infinity, Infinity, Infinity];
    this.max = [-Infinity, -Infinity, -Infinity];
  }

  static forTriangle(tri) {
    let box = new BoundingBox();
    for (let i = 0; i < tri.verts.length; i++) {
      box.addVertex(tri.verts[i])
    }
    return box;
  }

  static forNode(node) {
    let box = new BoundingBox();
    for (let i = 0; i < node.indices[0].length; i++) {
      box.addTriangle(node.triangles[node.indices[0][i]]);
    }
    return box;
  }

  addVertex(vert) {
    this.min = Vec3.min(vert, this.min);
    this.max = Vec3.max(vert, this.max);
  }

  addTriangle(triangle) {
    this.min = Vec3.min(this.min, triangle.boundingBox.min);
    this.max = Vec3.max(this.max, triangle.boundingBox.max);
  }

  containsTriangle(triangle) {
    let minDiff = Vec3.sub(this.min, triangle.boundingBox.min);
    for (let i = 0; i < 3; i++) {
      if (minDiff[i] > 0) {
        return false;
      }
    }
    let maxDiff = Vec3.sub(this.max, triangle.boundingBox.max);
    for (let i = 0; i < 3; i++) {
      if (maxDiff[i] < 0) {
        return false;
      }
    }
    return true;
  }

  get centroid() {
    return Vec3.scale(Vec3.add(this.min, this.max), 0.5);
  }

  getSurfaceArea() {
    let xl = this.max[0] - this.min[0];
    let yl = this.max[1] - this.min[1];
    let zl = this.max[2] - this.min[2];
    return (xl * yl + xl * zl + yl * zl) * 2;
  }
}

export class Node {
  constructor(triangles, indices) {
    this.triangles = triangles;
    this.indices = indices;
    this.boundingBox = BoundingBox.forNode(this);
    this.leaf = false;
    this.left = null;
    this.right = null;
    this.setSplit()
  }

  getTriangles() {
    // Avoid using this until final export
    return this.indices[0].map((v) => {
      return this.triangles[v];
    });
  }

  clearTempBuffers() {
    this.indices = null;
    this.triangles = null;
  }

  setSplit() {
    let bestCost = Infinity;
    for (let axis = 0; axis < 3; axis++) {
      let bbFront = new BoundingBox();
      let bbBack = new BoundingBox();
      let idxCache = this.indices[axis];
      let surfacesFront = Array(idxCache.length);
      let surfacesBack = Array(idxCache.length);
      let parentSurfaceArea = this.boundingBox.getSurfaceArea();
      for (let i = 0; i < idxCache.length; i++) {
        bbFront.addTriangle(this.triangles[idxCache[i]]);
        bbBack.addTriangle(this.triangles[idxCache[idxCache.length - 1 - i]]);
        surfacesFront[i] = bbFront.getSurfaceArea();
        surfacesBack[i] = bbBack.getSurfaceArea();
      }

      for (let i = 0; i < idxCache.length; i++) {
        let sAf = surfacesFront[i];
        let sAb = surfacesBack[surfacesBack.length - 1 - i];
        let cost = 1 + (sAf / parentSurfaceArea) * 1 * (i + 1) + (sAb / parentSurfaceArea) * 1 * (idxCache.length - 1 - i);
        if (cost < bestCost) {
          bestCost = cost;
          this.splitIndex = i + 1;
          this.splitAxis = axis;
        }
      }
    }
  }
}

export class Triangle {
  constructor(verts, indices, uvs, transforms) {
    this.verts = verts;
    this.indices = indices;
    this.uvs = uvs;
    this.tangents = [];
    this.bitangents = [];
    this.normals = null;
    this.boundingBox = BoundingBox.forTriangle(this);
    this.transforms = transforms;
    this.material = {};
  }

  setNormals(normals) {
    this.normals = normals;
  }
}

