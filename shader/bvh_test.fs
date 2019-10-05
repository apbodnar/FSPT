#version 300 es

precision highp float;
precision highp sampler2DArray;

const int NUM_BOUNCES = 5;
const float MAX_T = 100000.0;
const float EPSILON = 0.00001;
const float M_PI = 3.14159265;
const float INV_PI = 1.0 / M_PI;
const uint FROM_PARENT = uint(0);
const uint FROM_SIBLING = uint(1);
const uint FROM_CHILD = uint(2);
const float EXPLICIT_COS_THRESHOLD = -0.1;

float seed;

uniform int tick;
uniform float numLights;
uniform float randBase;
uniform float envTheta;
uniform vec2 lightRanges[20];
uniform sampler2D fbTex;
uniform sampler2D triTex;
uniform sampler2D normTex;
uniform sampler2D bvhTex;
uniform sampler2D matTex;
uniform sampler2D lightTex;
uniform sampler2D uvTex;
uniform sampler2D envTex;
uniform sampler2D cameraPosTex;
uniform sampler2D cameraDirTex;
uniform sampler2DArray texArray;

in vec2 coords;
out vec4 fragColor;

struct Triangle {
  vec3 v1;
  vec3 v2;
  vec3 v3;
};

struct Ray {
  vec3 origin;
  vec3 dir;
};

struct Node {
  float index;
  float parent;
  float sibling;
  float split;
  float left;
  float right;
  float triangles;
  vec3 boxMin;
  vec3 boxMax;
};

struct Hit {
  float t;
  float index;
};

// Moller-Trumbore
float rayTriangleIntersect(Ray ray, Triangle tri){
  float epsilon= 0.0000001;
  vec3 e1 = tri.v2 - tri.v1;
  vec3 e2 = tri.v3 - tri.v1;
  vec3 p = cross(ray.dir, e2);
  float det = dot(e1, p);
  if(abs(det) < epsilon){return MAX_T;}
  float invDet = 1.0 / det;
  vec3 t = ray.origin - tri.v1;
  float u = dot(t, p) * invDet;
  if(u < 0.0 || u > 1.0){return MAX_T;}
  vec3 q = cross(t, e1);
  float v = dot(ray.dir, q) * invDet;
  if(v < 0.0 || u + v > 1.0){return MAX_T;}
  float dist = dot(e2, q) * invDet;
  return dist > epsilon ? dist : MAX_T;
}

ivec2 indexToCoords(sampler2D tex, float index, float perElement){
  ivec2 dims = textureSize(tex, 0);
	float compensated = (index+0.1); // Hack to handle floaty errors
  return ivec2(mod(compensated * perElement, float(dims.x)), floor((compensated * perElement)/ float(dims.x)));
}

Triangle createTriangle(float index){
  ivec2 base = indexToCoords(triTex, index, 3.0);
  return Triangle(
    texelFetch(triTex, base, 0).rgb,
    texelFetch(triTex, base + ivec2(1,0), 0).rgb,
    texelFetch(triTex, base + ivec2(2,0), 0).rgb
  );
}

Node createNode(float index){
  ivec2 nodeCoords = indexToCoords(bvhTex, index, 4.0);
  vec3 first = texelFetch(bvhTex, nodeCoords, 0).rgb;
  vec3 second = texelFetch(bvhTex, nodeCoords + ivec2(1,0), 0).rgb;
  vec3 bbMin = texelFetch(bvhTex, nodeCoords + ivec2(2,0), 0).rgb;
  vec3 bbMax = texelFetch(bvhTex, nodeCoords + ivec2(3,0), 0).rgb;
  return Node(index, first.x, first.y, first.z, second.x, second.y, second.z, bbMin, bbMax);
}

float rayBoxIntersect(Node node, Ray ray){
  vec3 inverse = 1.0 / ray.dir;
  vec3 t1 = (node.boxMin - ray.origin) * inverse;
  vec3 t2 = (node.boxMax - ray.origin) * inverse;
  vec3 minT = min(t1, t2);
  vec3 maxT = max(t1, t2);
  float tMax = min(min(maxT.x, maxT.y),maxT.z);
  float tMin = max(max(minT.x, minT.y),minT.z);
  return tMax >= tMin && tMax > 0.0 ? tMin : MAX_T;
}

//float nearChildIndex(Node node, Ray ray){
//  Node left = createNode(node.left);
//  Node right = createNode(node.right);
//  uint axis = uint(node.split);
//  float s = -sign(ray.dir[axis]);
//  float nearestLeft = ray.dir[axis] < 0.0 ? left.boxMax[axis] : left.boxMin[axis];
//  float nearestRight = ray.dir[axis] < 0.0 ? right.boxMax[axis] : right.boxMin[axis];
//  float index = s * nearestLeft < s * nearestRight ? node.left : node.right;
//  return index;
//}

float nearChildIndex(Node node, Ray ray){
  uint axis = uint(node.split);
  float index = ray.dir[axis] > 0.0 ? node.left : node.right;
  return index;
}

float farChildIndex(Node node, Ray ray){
  uint axis = uint(node.split);
  float index = ray.dir[axis] >= 0.0 ? node.left : node.right;
  return index;
}

//float nearChildIndex(Node node, Ray ray){
//  float t1 = rayBoxIntersect(createNode(node.left), ray);
//  float t2 = rayBoxIntersect(createNode(node.right), ray);
//  uint axis = uint(node.split);
//  float index = t1 < t2 ? node.left : node.right;
//  return index;
//}


Node nearChild(Node node, Ray ray){
  return createNode(nearChildIndex(node, ray));
}

Node farChild(Node node, Ray ray){
  return createNode(farChildIndex(node, ray));
}

void processLeaf(Node leaf, Ray ray, inout Hit result){
  float t = MAX_T;
  float index = -1.0;
  for(int i=0; i<4; ++i){
    Triangle tri = createTriangle(leaf.triangles + float(i));
    float res = rayTriangleIntersect(ray, tri);
    if(res < result.t){
      result.t = res;
      result.index = leaf.triangles + float(i);
    }
  }
}

Node siblingNode(Node node) {
  return createNode(node.sibling);
}

//Hit traverseTree(Ray ray, inout int count){
//  Hit result = Hit(MAX_T, -1.0);
//  Node current;
//  float last = -1.0;
//  bool fromParent = true;
//  float nextIndex = 0.0;
//  while(true){
//    count++;
//    current = createNode(nextIndex);
//    if(last == current.left || last == current.right){
//      if(current.index == 0.0){
//        return result;
//      }
//      float parentNear = nearChildIndex(createNode(current.parent), ray);
//      bool atNear = current.index == parentNear;
//      nextIndex = atNear ? current.sibling : current.parent;
//    } else {
//      nextIndex = fromParent ? current.sibling : current.parent;
//      fromParent = false;
//      if(rayBoxIntersect(current, ray) < result.t){
//        if (current.triangles > -1.0) {
//          processLeaf(current, ray, result);
//        } else {
//          nextIndex = nearChildIndex(current, ray);
//          fromParent = true;
//        }
//      }
//    }
//    last = current.index;
//  }
//}

//Hit traverseTree(Ray ray, inout int count){
//  Hit result = Hit(MAX_T, -1.0);
//  Node current = nearChild(createNode(0.0), ray);
//  float near, far;
//  float last = 0.0;
//  while(true){
//    if(count > 1000){
//        break;
//    }
//
//    count++;
//    near = nearChildIndex(current, ray);
//    far = nearChildIndex(current, ray);
//    if (last == far) {
//      if(current.index == 0.0){
//        break;
//      }
//      last = current.index;
//      current = createNode(current.parent);
//      continue;
//    }
//
//    float tryChild = (last == current.parent ? near : far);
//    if (rayBoxIntersect(current, ray) < result.t) {
//      last = current.index;
//      if (current.triangles > -1.0) {
//        // at leaf
//        processLeaf(current, ray, result);
//      }
//      current = createNode(tryChild);
//    } else {
//      if(tryChild == near) {
//        last = near;
//      } else {
//        last = current.index;
//        current = createNode(current.parent);
//      }
//    }
//  }
//  return result;
//}


Hit traverseTree(Ray ray, inout int count){
  uint state = FROM_PARENT;
  Hit result = Hit(MAX_T, -1.0);
  Node current;
  float nextIndex = nearChildIndex(createNode(0.0), ray);
  while(true){
    count++;
    current = createNode(nextIndex);
    if(state == FROM_CHILD){
      if(current.index == 0.0){
        return result;
      }
      Node parentNear = nearChild(createNode(current.parent), ray);
      bool atNear = current.index == parentNear.index;
      nextIndex = atNear ? current.sibling : current.parent;
      state = atNear ? FROM_SIBLING : FROM_CHILD;
    } else {
      bool fromParent = state == FROM_PARENT;
      uint nextState = fromParent ? FROM_SIBLING : FROM_CHILD;
      nextIndex = fromParent ? current.sibling : current.parent;
      if(rayBoxIntersect(current, ray) < result.t){
        if (current.triangles > -1.0) {
          // at leaf
          processLeaf(current, ray, result);
        } else {
          nextIndex = nearChildIndex(current, ray);
          nextState = FROM_PARENT;
        }
      }
      state = nextState;
    }
  }
}

void main(void) {
  int count;
  vec2 res = vec2(textureSize(fbTex, 0));;
  Ray ray = Ray(texelFetch(cameraPosTex, ivec2(gl_FragCoord), 0).xyz, texelFetch(cameraDirTex, ivec2(gl_FragCoord), 0).xyz);
  Hit result = traverseTree(ray, count);

  if(length((gl_FragCoord.xy/res - 0.5) * 2.0) < 0.003) {
    fragColor = vec4(1,0,0,1);
  } else {
    fragColor = vec4(vec3(float(count - 1) * 0.001),1.0);
  }
}
