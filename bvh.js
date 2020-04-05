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
    if (root.indices.length <= this.maxTriangles) {
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

    function traverseTree(root, prev) {
      let parent = ++i;
      let node = { node: root, parent: prev };
      nodes.push(node);
      if (!root.leaf) {
        node.left = traverseTree(root.left, parent);
        node.right = traverseTree(root.right, parent);
        nodes[node.left].sibling = node.right;
        nodes[node.right].sibling = node.left;
      }
      return parent
    }

    traverseTree(this.root, i);
    return nodes;
  }

  _constructCachedIndexList(indices, axis, index) {
    // Avoid re sorting by plucking from pre sorted buffers
    let leftIndices = [[], [], []];
    leftIndices[axis] = indices[axis].slice(0, index);
    let rightIndices = [[], [], []];
    rightIndices[axis] = indices[axis].slice(index, indices[axis].length);
    let setLeft = new Set(leftIndices[axis]);
    let remainingAxes = [0, 1, 2].filter((e) => { return e !== axis });

    for (let i = 0; i < remainingAxes.length; i++) {
      for (let j = 0; j < indices[remainingAxes[i]].length; j++) {
        let idx = indices[remainingAxes[i]][j];
        if (setLeft.has(idx)) {
          leftIndices[remainingAxes[i]].push(idx);
        } else {
          rightIndices[remainingAxes[i]].push(idx);
        }
      }
    }
    return { left: leftIndices, right: rightIndices };
  }

  _sortIndices(indices, axis) {
    indices.sort((i1, i2) => {
      let c1 = this.triangles[i1].boundingBox.getCenter(axis);
      let c2 = this.triangles[i2].boundingBox.getCenter(axis);
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
  constructor(triangles, indices = null) {
    this._box = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
    let numTris = indices ? indices.length : triangles.length;
    for (let i = 0; i < numTris; i++) {
      let idx = indices ? indices[i] : i;
      for (let j = 0; j < triangles[idx].verts.length; j++) {
        let vert = triangles[idx].verts[j];
        for (let k = 0; k < vert.length; k++) {
          this._box[k * 2] = Math.min(vert[k], this._box[k * 2]);
          this._box[k * 2 + 1] = Math.max(vert[k], this._box[k * 2 + 1]);
        }
      }
    }
    this._centroid = [
      (this._box[0] + this._box[1]) / 2,
      (this._box[2] + this._box[3]) / 2,
      (this._box[4] + this._box[5]) / 2
    ];
  }

  addTriangle(triangle) {
    this._box[0] = Math.min(this._box[0], triangle.boundingBox.getBounds()[0]);
    this._box[2] = Math.min(this._box[2], triangle.boundingBox.getBounds()[2]);
    this._box[4] = Math.min(this._box[4], triangle.boundingBox.getBounds()[4]);

    this._box[1] = Math.max(this._box[1], triangle.boundingBox.getBounds()[1]);
    this._box[3] = Math.max(this._box[3], triangle.boundingBox.getBounds()[3]);
    this._box[5] = Math.max(this._box[5], triangle.boundingBox.getBounds()[5]);
  }

  getBounds() {
    return this._box;
  }

  getCenter(axis) {
    return this._centroid[axis];
  }

  getSurfaceArea() {
    let xl = this._box[1] - this._box[0];
    let yl = this._box[3] - this._box[2];
    let zl = this._box[5] - this._box[4];

    return (xl * yl + xl * zl + yl * zl) * 2;
  }
}

export class Node {
  constructor(triangles, indices) {
    this._triangles = triangles;
    this._indices = indices;
    this.boundingBox = new BoundingBox(triangles, indices[0]);
    this.leaf = false;
    this.left = null;
    this.right = null;
    this.splitAxis = this.getSplittingAxis();
    this.splitIndex = this.getSplittingIndex();
  }

  get indices() {
    return this.splitAxis ? this._indices[this.splitAxis] : this._indices[0];
  }

  getTriangles() {
    // Avoid using this until final export
    return this.indices.map((v) => {
      return this._triangles[v];
    });
  }

  clearTempBuffers() {
    this._indices = null;
    this._triangles = null;
  }

  getSplittingAxis() {
    let box = this.boundingBox.getBounds();
    let bestIndex = 0;
    let bestSpan = 0;
    for (let i = 0; i < box.length / 2; i++) {
      let span = Math.abs(box[i * 2] - box[i * 2 + 1]);
      if (span > bestSpan) {
        bestSpan = span;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  getSplittingIndex() {
    let bbFront = new BoundingBox([]);
    let bbBack = new BoundingBox([]);
    let idxCache = this.indices;
    let surfacesFront = [];
    let surfacesBack = [];
    let parentSurfaceArea = this.boundingBox.getSurfaceArea();
    let bestIndex;
    let bestCost = Infinity;
    for (let i = 0; i < idxCache.length; i++) {
      let tri = this._triangles[idxCache[i]];
      bbFront.addTriangle(tri);
      bbBack.addTriangle(this._triangles[idxCache[idxCache.length - 1 - i]]);
      surfacesFront.push(bbFront.getSurfaceArea());
      surfacesBack.push(bbBack.getSurfaceArea());
    }

    for (let i = 0; i < idxCache.length; i++) {
      let sAf = surfacesFront[i];
      let sAb = surfacesBack[surfacesBack.length - 1 - i];
      let cost = 2 + (sAf / parentSurfaceArea) * 2 * (i + 1) + (sAb / parentSurfaceArea) * 2 * (idxCache.length - 1 - i);
      if (cost < bestCost) {
        bestCost = cost;
        bestIndex = i + 1;
      }
    }
    return bestIndex
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
    this.boundingBox = new BoundingBox([this]);
    this.transforms = transforms;
    this.material = {};
  }

  setNormals(normals) {
    this.normals = normals;
  }
}

