(function(exports){
  exports.BVH = function(triangles, maxTris) {
    var leaves = 0;
    this.root = buildTree(triangles);

    function buildTree(triangles) {
      var root = new Node(triangles);
      var split = root.getSplittingAxis();
      root.sortOnAxis(split);
      if(root.triangles.length <= maxTris){
        leaves++;
        root.leaf = true;
        return root;
      }
      var l = root.triangles.length;
      root.left = buildTree(root.triangles.slice(0, l/2));
      root.right = buildTree(root.triangles.slice(l/2, l));
      return root;
    }


    this.serializeTree = function(){
      var nodes = [],
          tris = [];
      function traverseTree(root, prev){
        var parent = nodes.length;
        nodes.push([root, prev]);
        if(root.leaf){
          return
        }
        traverseTree(root.left, parent);
        traverseTree(root.right, parent);

      }
      traverseTree(this.root, -1);
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
    this.sortOnAxis = function(axis){
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

  function Triangle(v1, v2, v3) {
    this.v1 = v1;
    this.v2 = v2;
    this.v3 = v3;
    this.boundingBox = new BoundingBox(this)
  }

  exports.parseMesh = function(objText) {
    var lines = objText.split('\n');
    var vertices = [];
    var triangles = [];
    for(var i = 0; i < lines.length; i++) {
      var array = lines[i].split(/[ ]+/);
      var vals = array.slice(1, 4).map(parseFloat);
      if (array[0] == 'v') {
        vertices.push(vals)
      } else if (array[0] == 'f') {
        var tri = new Triangle(
          vertices[vals[0] - 1],
          vertices[vals[1] - 1],
          vertices[vals[2] - 1]
        );
        triangles.push(tri);
      }
    }
    return triangles;
  }

  exports.Triangle = Triangle;
})(this);
