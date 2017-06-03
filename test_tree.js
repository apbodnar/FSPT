loadAll(['mesh/bunny.obj'], function(hash){
  var t1 = performance.now();
  var triangles = parseMesh(hash['mesh/bunny.obj']);
  //triangles = triangles.concat(parseMesh(hash['mesh/bunny.obj']));
  var bvh = new BVH(triangles, 4);
  console.log(bvh.serializeTree());
  console.log(performance.now() - t1);

  runTest(bvh);
  console.log(bvh)
});

function runTest(bvh){
  var canvas = document.getElementById('trace');
  canvas.width = canvas.height = 400;
  var ctx = canvas.getContext('2d');
  var t1;
  // t1 = performance.now();
  // naiveTrace(canvas, ctx, root);
  // console.log(performance.now() - t1);
  t1 = performance.now();
  //treeTrace(canvas, ctx, bvh.root);
  //arrayTreeTrace(canvas, ctx, bvh.serializeTree());
  stacklessTreeTrace(canvas, ctx, bvh.serializeTree());
  console.log(performance.now() - t1);
}

function drawPixels(canvas, ctx, algorithm){
  for(var i=0; i<canvas.width; i++){
    for(var j=0; j<canvas.height; j++){
      var shift = [0, 0.25, 0.75];
      var origin = [0, 0, -1];
      var halfWidth = canvas.width/2;
      var halfHeight = canvas.height/2;
      var light = [0, 1, -1];
      var dir = normalize(sub([ (i/halfWidth-1), -(j/halfHeight - 1), 0], origin));
      origin = add(origin, shift);
      var ray = new Ray(origin, dir);
      var res = algorithm(ray);
      if(res[0] < Infinity && res[0] > 0){
        origin = add(origin, scale(dir, res[0]));
        dir = normalize(sub(light, origin));
        ray = new Ray(origin, dir);
        var shadow = algorithm(ray);
        var color = getColor(res[1], shadow, dir, light, origin);
        ctx.fillStyle = "rgb("+color[0]+","+color[1]+","+color[2]+")";
      } else {
        ctx.fillStyle = "#ffffff";
      }
      ctx.fillRect( i, j, 1, 1 );
      ctx.fill()
    }
  }
}

function stacklessTreeTrace(canvas, ctx, array){
  var fromSibling = 0,
      fromChild = 1,
      fromParent = 2;
  var rootIdx = 0;
  var res = [Infinity, null];

  function orderedChildren(ray, nodeIdx){
    var node = array[nodeIdx].node,
        left = array[nodeIdx].left,
        right = array[nodeIdx].right;

    if(ray.dir[node.split] > 0){
      return {near: left, far: right}
    } else {
      return {near: right, far: left}
    }
  }

  function traverse(ray){
    var res = [Infinity, null];
    var state = fromParent;
    var current = orderedChildren(ray, rootIdx).near;
    while(true){
      var fromArray = array[current]
      var node = fromArray.node;
      var ordered = orderedChildren(ray, current);
      switch(state){
        case fromChild:
          if(current == rootIdx){
            return res;
          }
          var parentOrdered = orderedChildren(ray, fromArray.parent)
          if(current == parentOrdered.near){
            current = fromArray.sibling;
            state = fromSibling;
          } else {
            current = fromArray.parent
            state = fromChild;
          }
          break;
        case fromSibling:
          var test = rayBoxIntersect(ray, node.boundingBox)
          if(test == Infinity){
            current = fromArray.parent;
            state = fromChild;
          } else if (node.leaf) {
            processed = processLeaf(ray, node);
            if(processed[0] < res[0]){
              res = processed;
            }
            current = fromArray.parent;
            state = fromChild;
          } else {
            current = ordered.near
            state = fromParent;
          }
          break;
        case fromParent:
          var test = rayBoxIntersect(ray, node.boundingBox)
          if(test == Infinity){
            current = fromArray.sibling;
            state = fromSibling;
          } else if(node.leaf){
            processed = processLeaf(ray, node);
            if(processed[0] < res[0]){
              res = processed;
            }
            current = fromArray.sibling;
            state = fromSibling;
          } else {
            current = ordered.near;
            state = fromParent;
          }
          break;
      }
    }
  }
  drawPixels(canvas, ctx, traverse)
}

function arrayTreeTrace(canvas, ctx, array){
  var algorithm = function (ray) {
    return findTrianglesFlat(ray, array, 0)
  };
  drawPixels(canvas, ctx, algorithm)
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

function closestNode(ray, nLeft, nRight){
  var tLeft = rayBoxIntersect(ray, nLeft.boundingBox);
  var tRight = rayBoxIntersect(ray, nRight.boundingBox);
  var left = tLeft < Infinity ? nLeft : null;
  var right = tRight < Infinity ? nRight : null;
  if(tLeft < tRight){
    return [left, right, tLeft, tRight]
  }
  return [right, left, tRight, tLeft]
}

function findTrianglesFlat(ray, array, i){
  var root = array[i].node;
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
  var left = array[array[i].left].node;
  var right = array[array[i].right].node;
  left.idx = array[i].left;
  right.idx = array[i].right;
  var ord = closestNode(ray, left, right);
  var closest = [Infinity, null];
  for(var i=0 ; i<ord.length; i++){
    if(ord[i] && ord[i+2] < closest[0]){
      var res = findTrianglesFlat(ray, array, ord[i].idx);
      if(res[0] < closest[0]){
        closest = res;
      }
    }
  }
  return closest;
}

function findTriangles(ray, root){
  if(root.leaf){
    return processLeaf(ray, root);
  }
  var ord = closestNode(ray, root.left, root.right);
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

function getColor(tri, shadow, dir, light, origin){
  var norm = normalize(cross(sub(tri.v2, tri.v1), sub(tri.v3, tri.v1)));
  var shade = Math.max(dot(dir, norm),0.2);
  if(shadow[0] < magnitude(sub(light, origin))){
    shade = 0.2;
  }
  var c = scale([255,255,255], shade);
  return c.map(Math.floor)
}

function Ray(origin, dir){
  this.origin = origin;
  this.dir = dir
}

function rayBoxIntersect(ray, bbox){
  var invDir = inverse(ray.dir),
      box = bbox.getBounds(),
      tx1 = (box[0] - ray.origin[0]) * invDir[0],
      tx2 = (box[1] - ray.origin[0]) * invDir[0],
      ty1 = (box[2] - ray.origin[1]) * invDir[1],
      ty2 = (box[3] - ray.origin[1]) * invDir[1],
      tz1 = (box[4] - ray.origin[2]) * invDir[2],
      tz2 = (box[5] - ray.origin[2]) * invDir[2];

  var tmin = Math.min(tx1, tx2);
  var tmax = Math.max(tx1, tx2);
  tmin = Math.max(tmin, Math.min(ty1, ty2));
  tmax = Math.min(tmax, Math.max(ty1, ty2));
  tmin = Math.max(tmin, Math.min(tz1, tz2));
  tmax = Math.min(tmax, Math.max(tz1, tz2));

  return tmax >= tmin && tmax >= 0 ? tmin : Infinity;
}

function processLeaf(ray, root){
  var res = [Infinity, null];
  for(var i=0; i<root.triangles.length; i++){
    var tmp = rayTriangleIntersect(ray, root.triangles[i])
    if(tmp[0] < res[0]){
      res = tmp;
    }
  }
  return res;
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
    return [t, tri];
  }
  return [Infinity, null];
}
