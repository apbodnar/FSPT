(function(exports){
  exports.BVH = function(triangles, maxTris) {
    this.root = buildTree(triangles);

    function buildTree(triangles) {
      var root = new Node(triangles);
      var split = root.getSplittingAxis();
      root.sortOnAxis(split);
      if(root.triangles.length <= maxTris){
        root.leaf = true;
        return root;
      }
      var l = root.triangles.length;
      var i = root.getSplittingIndex(split);
      root.left = buildTree(triangles.slice(0, i));
      root.right = buildTree(triangles.slice(i, l));
      root.triangles = null;
      return root;
    }

    this.serializeTree = function(){
      var nodes = [],
          tris = [],
          i = -1;
      function traverseTree(root, prev){
        var parent = ++i;
        var node = {node: root, parent: prev};
        nodes.push(node);
        if(!root.leaf){
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
  };

  class BoundingBox {
    constructor(triangles) {
      var tris  = Array.isArray(triangles) ? triangles : [triangles];
      this._box = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
      for(var j=0; j<tris.length; j++){
        var vals = tris[j].v1.concat(tris[j].v2, tris[j].v3);
        for(var i = 0; i < vals.length; i++){
          this._box[(i % 3) * 2] = Math.min(vals[i], this._box[(i % 3) * 2]);
          this._box[(i % 3) * 2 + 1] = Math.max(vals[i], this._box[(i % 3) * 2 + 1]);
        }
      }
      this._centroid = [
        (this._box[0]+this._box[1])/2,
        (this._box[2]+this._box[3])/2,
        (this._box[4]+this._box[5])/2
      ];
    }

    getBounds() {
      return this._box;
    }

    getCenter(axis) {
      return this._centroid[axis];
    }
  }

  function Node(triangles){
    this.triangles = triangles;
    this.boundingBox = new BoundingBox(triangles);
    this.leaf = false;
    this.left = null;
    this.right = null;
    this.split = null;
    this.getSplittingAxis = function(){
      var box = this.boundingBox.getBounds();
      var bestIndex = 0;
      var bestSpan = 0;
      for(var i=0; i < box.length / 2 ; i++){
        var span = Math.abs(box[i*2] - box[i*2 + 1]);
        if(span > bestSpan){
          bestSpan = span;
          bestIndex = i;
        }
      }
      return bestIndex;
    };
    this.getSplittingIndex = function(axis){
      var median = this.boundingBox.getCenter(axis);
      for(var i=0; i<this.triangles.length; i++){
        var point = this.triangles[i].boundingBox.getCenter(axis)
        if(point > median){
          return i;
        }
      }
      return this.triangles.length/2;
    };
    this.sortOnAxis = function(axis){
      this.split = axis;
      this.triangles.sort(function(t1, t2){
        var c1 = t1.boundingBox.getCenter(axis);
        var c2 = t2.boundingBox.getCenter(axis);
        if(c1 < c2){
          return -1;
        }
        if(c1 > c2){
          return 1;
        }
        return 0;
      });
    };
  }

  function Triangle(v1, v2, v3, i1, i2, i3, transforms) {
    this.v1 = v1;
    this.v2 = v2;
    this.v3 = v3;
    this.i1 = i1;
    this.i2 = i2;
    this.i3 = i3;
    this.normals = null;
    this.boundingBox = new BoundingBox(this);
    this.transforms = transforms;
  }

  function splitTriangle(triangle, threshold){
    var bb = triangle.boundingBox.getBounds();
    var span = 0;
    for(var i = 0; i< bb.length/2; i++){
      span = Math.max(bb[i*2+1] - bb[i*2], span)
    }
    if(span < threshold){
      return [triangle]
    }

    var verts = [triangle.v1, triangle.v2, triangle.v3];
    var idx;
    var scalar = 1;
    for(var i=0; i<verts.length; i++){
      var left = verts[(i+2) % verts.length];
      var right = verts[(i+1) % verts.length];
      var e1 = normalize(sub(left, verts[i]));
      var e2 = normalize(sub(right, verts[i]));
      var tempScalar = dot(e1, e2);
      if(tempScalar < scalar){
        idx = i;
        scalar = tempScalar;
      }
    }

    var opposite = scale(add(verts[(idx+2) % verts.length], verts[(idx+1) % verts.length]),0.5);
    var t1 = new Triangle(verts[idx],verts[(idx+1) % verts.length], opposite, triangle.transforms);
    var t2 = new Triangle(verts[idx], opposite, verts[(idx+2) % verts.length], triangle.transforms);
    return splitTriangle(t1, threshold).concat(splitTriangle(t2, threshold));
  }

  exports.parseMesh = function(objText, transforms) {
    var lines = objText.split('\n');
    var vertices = [];
    var triangles = [];
    var vertNormals = [];
    function applyTransforms(vert){
      return rotateArbitrary(add(scale(vert, transforms.scale), transforms.translate),transforms.rotate.axis, transforms.rotate.angle);
    }
    function getNormal(tri){
      var e1 = sub(tri.v2, tri.v1);
      var e1 = sub(tri.v3, tri.v1);
      return normaliz(cross(e1, e2));
    }
    function averageNormals(normArray){
      var total;
      for(var i=0; i<normArray.lenght; i++){
        total = add(total,normArray[i]);
      }
      return scale(total, 1.0/normArray.length);
    }
    for(var i = 0; i < lines.length; i++) {
      var array = lines[i].split(/[ ]+/);
      var vals = array.slice(1, 4).map(parseFloat);
      if (array[0] == 'v') {
        vertices.push(vals)
      } else if (array[0] == 'f') {
        var tri = new Triangle(
          applyTransforms(vertices[vals[0] - 1]),
          applyTransforms(vertices[vals[1] - 1]),
          applyTransforms(vertices[vals[2] - 1]),
          vals[0] - 1, vals[1] - 1, vals[2] - 1,
          transforms
        );
        var normal = getNormal(tri);
        tri.normals = [normal, normal, normal];
        triangles.push(tri);
        for(var j=0; j<vals.length; j++){
          vertNormals[vals[j] - 1] = (vertNormals[vals[j]] || []).push(normal);
        }
      }
    }
    var bb = new BoundingBox(triangles).getBounds();
    var span = 0;
    for(var i = 0; i< bb.length/2; i++){
      span = Math.max(bb[i*2+1] - bb[i*2], span)
    }
    var original = triangles.length;
    if(transforms.normals == "smooth"){
      for(var i=0; i<triangles.length; i++){
        triangles[i].normal[0] = averageNormals(normArray[triangles[i].i1])
        triangles[i].normal[1] = averageNormals(normArray[triangles[i].i2])
        triangles[i].normal[2] = averageNormals(normArray[triangles[i].i3])
      }
    }
    // for(var i = 0; i < triangles.length; i++) {
    //   var subTriangles = splitTriangle(triangles[i], span/1);
    //   if(subTriangles.length > 1){
    //
    //     triangles.splice(i,1)
    //     subTriangles.forEach(function(e){triangles.push(e)});
    //   }
    // }
    console.log(transforms.path, "original:", original,"split:", triangles.length);
    return triangles;
  }

  exports.Triangle = Triangle;
})(this);
