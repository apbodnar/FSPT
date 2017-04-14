loadAll(['mesh/bunny.obj'], function(hash){
  bvh = new BVH(hash['mesh/bunny.obj'])
  runTest(bvh.root)
  console.log(bvh)
});

function runTest(root){
  var canvas = document.getElementById('trace')
  canvas.width = canvas.height = 100;
  var ctx = canvas.getContext('2d')
  for(var i=0; i<canvas.width; i++){
    for(var j=0; j<canvas.height; j++){
      var hit = Infinity;
      var origin = [0,0,-0.2]
      var dir = normalize(sub([(i - canvas.width/2)/100, (j - canvas.height/2)/100, 0], origin));
      var ray = new Ray(origin, dir);
      for(var k=0; k<root.triangles.length; k++){
        hit = Math.min(hit, rayTriangleIntersect(ray, root.triangles[k]))
      }
      if(hit < Infinity && hit > 0){
        ctx.fillStyle = "#FF0000";
      } else {
        ctx.fillStyle = "#00FF00";
      }

      ctx.fillRect( i, j, 1, 1 );
      ctx.fill()
    }
  }
}

function magnitude(v){
  return Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2])
}

function normalize(v){
  var m = magnitude(v)
  return scale(v, 1/m);
}

function scale(v, s){
  return [v[0]*s, v[1]*s, v[2]*s]
}

function add(v1, v2){
  return [v1[0]+v2[0],v1[1]+v2[1],v1[2]+v2[2]]
}

function sub(v1, v2){
  return [v1[0]-v2[0],v1[1]-v2[1],v1[2]-v2[2]]
}

function inverse(v){
  return [1.0/v[0], 1.0/v[1], 1.0/v[2]]
}

function dot(v1, v2){
  return v1[0]*v2[0]+v1[1]*v2[1]+v1[2]*v2[2]
}

function cross(v1, v2){
  var x = v1[1] * v2[2] - v1[2] * v2[1],
      y = -(v1[0] * v2[2] - v1[2] * v2[0]),
      z = v1[0] * v2[1] - v1[1] * v2[0];
  return [x, y, z]
}

function Ray(origin, dir){
  this.origin = origin;
  this.dir = dir
}

function rayTriangleIntersect(ray, tri){
  var epsilon = 0.00001;
  //debugger;
  var e1 = sub(tri.v2, tri.v1);
  var e2 = sub(tri.v3, tri.v1);
  var p = cross(ray.dir, e2);
  var det = dot(e1, p);
  if(det > -epsilon && det < epsilon){return Infinity}
  var invDet = 1.0 / det;
  var t = sub(ray.origin, tri.v1);
  var u = dot(t, p) * invDet;
  if(u < 0 || u > 1){return Infinity}
  var q = cross(t, e1);
  var v = dot(ray.dir, q) * invDet;
  if(v < 0 || u + v > 1){return Infinity}
  t = dot(e2, q) * invDet;
  if(t > epsilon){
    debugger;
    return t;
  }
  return Infinity;
}