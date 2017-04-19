loadAll(['mesh/huge.obj', 'mesh/bunny.obj'], function(hash){
  var t1 = performance.now();
  var triangles = parseMesh(hash['mesh/huge.obj']);
  addTriangles(triangles)
  //triangles = triangles.concat(parseMesh(hash['mesh/bunny.obj']));
  var bvh = new BVH(triangles, 4);
  console.log(performance.now() - t1);

  runTest(bvh.root);
  console.log(bvh)
});

function runTest(root){
  var canvas = document.getElementById('trace');
  canvas.width = canvas.height = 800;
  var ctx = canvas.getContext('2d');
  var t1;
  // t1 = performance.now();
  // naiveTrace(canvas, ctx, root);
  // console.log(performance.now() - t1);
  t1 = performance.now();
  treeTrace(canvas, ctx, root);
  console.log(performance.now() - t1);
}

function addTriangles(triangles) {
  triangles.push(new Triangle(
    [0.55,0.0527,0.55],
    [-0.55,0.0527,-0.55],
    [-0.55,0.0527,0.55])
  );
  triangles.push(new Triangle(
    [0.55,0.0527,0.55],
    [0.55,0.0527,-0.55],
    [-0.55,0.0527,-0.55])
  );
}

function drawPixels(canvas, ctx, algorithm){
  for(var i=0; i<canvas.width; i++){
    for(var j=0; j<canvas.height; j++){
      var shift = [0, 0.1, 0];
      var origin = [0, 0, 1];
      var light = [0, 10, 1];
      var dir = normalize(sub([(i - canvas.width/2)/3000, -(j - canvas.height/2)/3000, 0], origin));
      origin = add(origin, shift);
      var ray = new Ray(origin, dir);
      var res = algorithm(ray);
      if(res[0] < Infinity && res[0] > 0){
        origin = add(origin, scale(dir, res[0]));
        dir = normalize(sub(light, origin));
        ray = new Ray(origin, dir);
        var shadow = algorithm(ray);
        var color = getColor(res[1], shadow, dir);
        ctx.fillStyle = "rgb("+color[0]+","+color[1]+","+color[2]+")";
      } else {
        ctx.fillStyle = "#ffffff";
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

function closestNode(ray, root){
  var tLeft = rayBoxIntersect(ray, root.left.boundingBox);
  var tRight = rayBoxIntersect(ray, root.right.boundingBox);
  var left = tLeft < Infinity ? root.left : null;
  var right = tRight < Infinity ? root.right : null;
  if(tLeft < tRight){
    return [left, right, tLeft, tRight]
  }
  return [right, left, tRight, tLeft]
}

function findTriangles(ray, root){
  if(root.leaf){
    var res = [Infinity, null]
    for(var i=0; i<root.triangles.length; i++){
      var tmp = rayTriangleIntersect(ray, root.triangles[i])
      if(tmp[0] < res[0]){
        res = tmp;
      }
    }
    return res;
  }
  var ord = closestNode(ray, root)
  var closest = [Infinity, null];
  for(var i=0 ; i<ord.length; i++){
    if(ord[i] && ord[i+2] < closest[0]){
      var res = findTriangles(ray, ord[i]);
      if(res[0] < closest[0]){
        closest = res;
      }
    }
  }
  return closest;
}

function getColor(tri, shadow, dir){
  var norm = normalize(cross(sub(tri.v2, tri.v1), sub(tri.v3, tri.v1)));
  var shade = Math.max(dot(dir, norm),0.1);
  if(shadow[0] < Infinity){
    shade = 0.1;
  }
  var c = scale([255,255,255], shade);
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
  var epsilon = 0.000000000001;
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
