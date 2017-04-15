loadAll(['mesh/bunny.obj'], function(hash){
  var bvh = new BVH(hash['mesh/bunny.obj'])
  runTest(bvh.root)
  console.log(bvh)
});

function runTest(root){
  var canvas = document.getElementById('trace')
  canvas.width = canvas.height = 800;
  var ctx = canvas.getContext('2d')
  var t1;
  // t1 = performance.now();
  // naiveTrace(canvas, ctx, root);
  // console.log(performance.now() - t1);
  t1 = performance.now();
  treeTrace(canvas, ctx, root);
  console.log(performance.now() - t1);
}

function drawPixels(canvas, ctx, algorithm){
  for(var i=0; i<canvas.width; i++){
    for(var j=0; j<canvas.height; j++){
      var origin = [0,0,-0.2];
      var dir = normalize(sub([(i - canvas.width/2)/(canvas.width * 2), -(j - canvas.height/2)/(canvas.height * 2), 0], origin));
      var ray = new Ray(origin, dir);
      var res = algorithm(ray);
      if(res[0] < Infinity && res[0] > 0){
        var color = getColor(res[1]);
        ctx.fillStyle = "rgb("+color[0]+","+color[1]+","+color[2]+")";
      } else {
        ctx.fillStyle = "#111111";
      }
      ctx.fillRect( i, j, 1, 1 );
      ctx.fill()
    }
  }
}

function naiveTrace(canvas, ctx, root){
  var algorithm = function(ray){
    var hit = Infinity,
        tri = null;
    for(var k=0; k<root.triangles.length; k++){
      var res = rayTriangleIntersect(ray, root.triangles[k]);
      if(res[0] < hit){
        hit = res[0];
        tri = res[1];
      }
    }
    return [hit, tri]
  };

  drawPixels(canvas, ctx, algorithm)
}

function treeTrace(canvas, ctx, root){

  var algorithm = function(ray){
    return findTriangles(ray, root);
  };

  drawPixels(canvas, ctx, algorithm)
}

function findTriangles(ray, root){
  if(root.leaf){
    return rayTriangleIntersect(ray, root.triangles[0])
  }
  var tLeft = rayBoxIntersect(ray, root.left.boundingBox);
  var tRight = rayBoxIntersect(ray, root.right.boundingBox);
  var closest = [Infinity, null];
  if(tLeft < tRight){
    closest = findTriangles(ray, root.left);
    if(closest[0] == Infinity){
      closest = findTriangles(ray, root.right);
    }
  }
  if(tRight <= tLeft && tRight != Infinity){
    closest = findTriangles(ray, root.right);
    if(closest[0] == Infinity){
      closest = findTriangles(ray, root.left);
    }
  }
  return closest;
}

function getColor(tri){
  var norm = normalize(cross(sub(tri.v2, tri.v1), sub(tri.v3, tri.v1)));
  var shade = dot([-.707, -.707, -.707], norm);
  var c = scale([255,0,0], shade);
  //console.log(c);
  return c.map(Math.floor)
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

function rayBoxIntersect(ray, bbox){
  var invDir = inverse(ray.dir),
      tmin = -Infinity,
      tmax = Infinity,
      box = bbox.getBounds(),
      tx1 = (box[0] - ray.origin[0]) * invDir[0],
      tx2 = (box[1] - ray.origin[0]) * invDir[0],
      ty1 = (box[2] - ray.origin[1]) * invDir[1],
      ty2 = (box[3] - ray.origin[1]) * invDir[1],
      tz1 = (box[4] - ray.origin[2]) * invDir[2],
      tz2 = (box[5] - ray.origin[2]) * invDir[2];

  tmin = Math.max(tmin, Math.min(tx1, tx2));
  tmax = Math.min(tmax, Math.max(tx1, tx2));
  tmin = Math.max(tmin, Math.min(ty1, ty2));
  tmax = Math.min(tmax, Math.max(ty1, ty2));
  tmin = Math.max(tmin, Math.min(tz1, tz2));
  tmax = Math.min(tmax, Math.max(tz1, tz2));

  if (tmax >= tmin){
    return tmin;
  } else {
    return Infinity;
  }
}

function rayTriangleIntersect(ray, tri){
  var epsilon = 0.0000001;
  var e1 = sub(tri.v2, tri.v1);
  var e2 = sub(tri.v3, tri.v1);
  var p = cross(ray.dir, e2);
  var det = dot(e1, p);
  if(det > -epsilon && det < epsilon){return [Infinity, null]}
  var invDet = 1.0 / det;
  var t = sub(ray.origin, tri.v1);
  var u = dot(t, p) * invDet;
  if(u < 0 || u > 1){return [Infinity, null]}
  var q = cross(t, e1);
  var v = dot(ray.dir, q) * invDet;
  if(v < 0 || u + v > 1){return [Infinity, null]}
  t = dot(e2, q) * invDet;
  if(t > epsilon){
    //debugger;
    return [t, tri];
  }
  return [Infinity, null];
}