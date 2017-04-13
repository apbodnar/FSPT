function BVH(objText) {
  var triangles = parseMesh()
  this.tree = new Node(triangles)

  function build(parent) {
    var xSorted = [...Array(triangles.length).keys()]
  }

  function splitNode(){}

  function parseMesh() {
    var lines = objText.split('\n');
    var vertices = [];
    var triangles = [];
    for(var i = 0; i < lines.length; i++){
      var array = lines[i].split(' ')
      var type = array[0];
      var vals = array.slice(1,4).map(parseFloat)
      if(array[0] == 'v'){
        vertices.push(vals)
      } else if (array[0] == 'f') {
        var tri = new Triangle (
          vertices[vals[0]-1],
          vertices[vals[1]-1],
          vertices[vals[2]-1]
        )
        triangles.push(tri)
      }
    }
    return triangles;
  }
  build(this.tree)
}

class BoundingBox {
  constructor(triangles) {
    var tris  = Array.isArray(triangles) ? triangles : [triangles]
    this._box = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]
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
    ]
  }

  getBounds() {
    return this._box;
  }

  getCenter() {
    return this._centroid;
  }
}

function Node(triangles){
  this.triangles = triangles
  this.boundingBox = new BoundingBox(triangles)
  this.leaf = false;
  this.left = null;
  this.right = null;
  function getSplitingAxis(){
    var box = this.boundingBox.getBounds()
    var bestIndex = 0;
    var bestSpan = 0;
    for(var i=0; i < box.length / 2 ; i++){
      if(box[i*2])
    }
  }
}

function Triangle(v1, v2, v3) {
  this.v1 = v1;
  this.v2 = v2;
  this.v3 = v3;
  this.boundingBox = new BoundingBox(this)
}

var bvh;

loadAll(['mesh/bunny.obj'], function(hash){
  bvh = new BVH(hash['mesh/bunny.obj'])
  console.log(bvh)
})
