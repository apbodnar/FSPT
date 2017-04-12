function BVH(objText) {
  this.tree = Node(triangles)

  function build(parent) {
    var triangles = parseMesh()
    var xSorted = [...Array(triangles.length).keys()]
    console.log(triangles)
  }.bind(this)

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
        var tri = new Triangle(vertices[vals[0]], vertices[vals[1]], vertices[vals[2]])
        triangles.push(tri)
      }
    }
    return triangles;
  }
  build(this.tree)
}

function Node(triangles){
  this.leaf = false;
  this.left = null;
  this.right = null;
}

function Triangle(v1, v2, v3) {
  this.v1 = v1;
  this.v2 = v2;
  this.v3 = v3;
  this.boundingBox = function(){
    var vals = v1.concat(v2, v3);
    var box = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]
    for(var i = 0; i < vals.length; i++){
      var axis = vals[i]
      box[(i % 3) * 2] = Math.min(axis, box[(i % 3) * 2])
      box[(i % 3) * 2 + 1] = Math.max(axis, box[(i % 3) * 2 + 1])
    }
    return {x: [box[0],box[1]], y: [box[2],box[3]], z: [box[4],box[5]]};
  }.call(this)
  this.centroid = function(){
    var box = this.boundingBox;
    return {x: (box.x[0]+box.x[1])/2,
            y: (box.y[0]+box.y[1])/2,
            z: (box.z[0]+box.z[1])/2}
  }.call(this)
}

var bvh;

loadAll(['mesh/bunny.obj'], function(hash){
  bvh = new BVH(hash['mesh/bunny.obj'])
})
