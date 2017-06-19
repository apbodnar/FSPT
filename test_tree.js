loadAll(['mesh/cube.obj'], function(hash){
  let t1 = performance.now();
  let triangles = parseMesh(hash['mesh/cube.obj']);
  //triangles = triangles.concat(parseMesh(hash['mesh/bunny.obj']));
  let bvh = new BVH(triangles, 4);
  console.log(bvh.serializeTree());
  console.log(performance.now() - t1);

  runTest(bvh);
  console.log(bvh)
});

function runTest(bvh){
  let canvas = document.getElementById('trace');
  canvas.width = canvas.height = 400;
  let ctx = canvas.getContext('2d');
  let t1;
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
  for(let i=0; i<canvas.width; i++){
    for(let j=0; j<canvas.height; j++){
      let shift = [0, 0, 0];
      let origin = [0, 0, -2];
      let halfWidth = canvas.width/2;
      let halfHeight = canvas.height/2;
      let light = [0, 1, -1];
      let dir = normalize(sub([ (i/halfWidth-1), -(j/halfHeight - 1), 0], origin));
      origin = add(origin, shift);
      let ray = new Ray(origin, dir);
      let res = algorithm(ray);
      if(res[0] < Infinity && res[0] > 0){
        origin = add(origin, scale(dir, res[0]));
        dir = normalize(sub(light, origin));
        ray = new Ray(origin, dir);
        let shadow = algorithm(ray);
        let color = getColor(res[1], shadow, dir, light, origin);
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
  let fromSibling = 0,
      fromChild = 1,
      fromParent = 2;
  let rootIdx = 0;
  let res = [Infinity, null];

  function orderedChildren(ray, nodeIdx){
    let node = array[nodeIdx].node,
        left = array[nodeIdx].left,
        right = array[nodeIdx].right;

    if(ray.dir[node.split] > 0){
      return {near: left, far: right}
    } else {
      return {near: right, far: left}
    }
  }

  function traverse(ray){
    let res = [Infinity, null];
    let state = fromParent;
    let current = orderedChildren(ray, rootIdx).near;
    while(true){
      let fromArray = array[current]
      let node = fromArray.node;
      let ordered = orderedChildren(ray, current);
      switch(state){
        case fromChild:
          if(current == rootIdx){
            return res;
          }
          let parentOrdered = orderedChildren(ray, fromArray.parent)
          if(current == parentOrdered.near){
            current = fromArray.sibling;
            state = fromSibling;
          } else {
            current = fromArray.parent
            state = fromChild;
          }
          break;
        case fromSibling:
          let test = rayBoxIntersect(ray, node.boundingBox)
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
          let test = rayBoxIntersect(ray, node.boundingBox)
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
  let algorithm = function (ray) {
    return findTrianglesFlat(ray, array, 0)
  };
  drawPixels(canvas, ctx, algorithm)
}

function naiveTrace(canvas, ctx, root){
  let algorithm = function(ray){
    let hit = Infinity,
        tri = null;
    for(let k=0; k<root.triangles.length; k++){
      let res = rayTriangleIntersect(ray, root.triangles[k]);
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
  let algorithm = function(ray){
    return findTriangles(ray, root);
  };
  drawPixels(canvas, ctx, algorithm)
}

function closestNode(ray, nLeft, nRight){
  let tLeft = rayBoxIntersect(ray, nLeft.boundingBox);
  let tRight = rayBoxIntersect(ray, nRight.boundingBox);
  let left = tLeft < Infinity ? nLeft : null;
  let right = tRight < Infinity ? nRight : null;
  if(tLeft < tRight){
    return [left, right, tLeft, tRight]
  }
  return [right, left, tRight, tLeft]
}

function findTrianglesFlat(ray, array, i){
  let root = array[i].node;
  if(root.leaf){
    let res = [Infinity, null]
    for(let i=0; i<root.triangles.length; i++){
      let tmp = rayTriangleIntersect(ray, root.triangles[i])
      if(tmp[0] < res[0]){
        res = tmp;
      }
    }
    return res;
  }
  let left = array[array[i].left].node;
  let right = array[array[i].right].node;
  left.idx = array[i].left;
  right.idx = array[i].right;
  let ord = closestNode(ray, left, right);
  let closest = [Infinity, null];
  for(let i=0 ; i<ord.length; i++){
    if(ord[i] && ord[i+2] < closest[0]){
      let res = findTrianglesFlat(ray, array, ord[i].idx);
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
  let ord = closestNode(ray, root.left, root.right);
  let closest = [Infinity, null];
  for(let i=0 ; i<ord.length; i++){
    if(ord[i] && ord[i+2] < closest[0]){
      let res = findTriangles(ray, ord[i]);
      if(res[0] < closest[0]){
        closest = res;
      }
    }
  }
  return closest;
}

function getColor(tri, shadow, dir, light, origin){
  let norm = normalize(cross(sub(tri.v2, tri.v1), sub(tri.v3, tri.v1)));
  let shade = Math.max(dot(dir, norm),0.2);
  if(shadow[0] < magnitude(sub(light, origin))){
    shade = 0.2;
  }
  let c = scale([255,255,255], shade);
  return c.map(Math.floor)
}

function Ray(origin, dir){
  this.origin = origin;
  this.dir = dir
}

function rayBoxIntersect(ray, bbox){
  let invDir = inverse(ray.dir),
      box = bbox.getBounds(),
      tx1 = (box[0] - ray.origin[0]) * invDir[0],
      tx2 = (box[1] - ray.origin[0]) * invDir[0],
      ty1 = (box[2] - ray.origin[1]) * invDir[1],
      ty2 = (box[3] - ray.origin[1]) * invDir[1],
      tz1 = (box[4] - ray.origin[2]) * invDir[2],
      tz2 = (box[5] - ray.origin[2]) * invDir[2];

  let tmin = Math.min(tx1, tx2);
  let tmax = Math.max(tx1, tx2);
  tmin = Math.max(tmin, Math.min(ty1, ty2));
  tmax = Math.min(tmax, Math.max(ty1, ty2));
  tmin = Math.max(tmin, Math.min(tz1, tz2));
  tmax = Math.min(tmax, Math.max(tz1, tz2));

  return tmax >= tmin && tmax >= 0 ? tmin : Infinity;
}

function processLeaf(ray, root){
  let res = [Infinity, null];
  for(let i=0; i<root.triangles.length; i++){
    let tmp = rayTriangleIntersect(ray, root.triangles[i])
    if(tmp[0] < res[0]){
      res = tmp;
    }
  }
  return res;
}

function rayTriangleIntersect(ray, tri){
  let epsilon = 0.000000000001;
  let e1 = sub(tri.v2, tri.v1);
  let e2 = sub(tri.v3, tri.v1);
  let p = cross(ray.dir, e2);
  let det = dot(e1, p);
  if(det > -epsilon && det < epsilon){return [Infinity, null]}
  let invDet = 1.0 / det;
  let t = sub(ray.origin, tri.v1);
  let u = dot(t, p) * invDet;
  if(u < 0 || u > 1){return [Infinity, null]}
  let q = cross(t, e1);
  let v = dot(ray.dir, q) * invDet;
  if(v < 0 || u + v > 1){return [Infinity, null]}
  t = dot(e2, q) * invDet;
  if(t > epsilon){
    return [t, tri];
  }
  return [Infinity, null];
}
