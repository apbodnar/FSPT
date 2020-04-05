#version 300 es
//#define ENV_BINS 0
//#define NUM_LIGHT_RANGES 0

precision highp float;
precision highp int;
precision highp sampler2DArray;

const int NUM_BOUNCES = 3;
const float MAX_T = 100000.0;
const float EPSILON = 0.000001;
const float M_PI = 3.14159265;
const float M_TAU = M_PI * 2.0;
const float INV_PI = 1.0 / M_PI;
const uint FROM_PARENT = uint(0);
const uint FROM_SIBLING = uint(1);
const uint FROM_CHILD = uint(2);
const float EXPLICIT_COS_THRESHOLD = -0.1;

float seed;

uniform uint tick;
uniform float numLights;
uniform float randBase;
uniform float envTheta;
uniform uvec2 lightRanges[NUM_LIGHT_RANGES];
uniform uvec4 radianceBins[ENV_BINS];
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

struct Normals {
  vec3 n1;
  vec3 n2;
  vec3 n3;
  vec3 t1;
  vec3 t2;
  vec3 t3;
  vec3 bt1;
  vec3 bt2;
  vec3 bt3;
};

struct MapIndices {
  float diffuse;
  float specular;
  float normal;
  float roughness;
  float metallic;
};

struct Material {
  MapIndices mapIndices;
  vec3 emissivity;
  float ior;
  float dielectric;
};

struct Ray {
  vec3 origin;
  vec3 dir;
};

struct Node {
  int index;
  int parent;
  int sibling;
  int split;
  int left;
  int right;
  int triangles;
  vec3 boxMin;
  vec3 boxMax;
};

struct TexCoords {
  vec2 uv1;
  vec2 uv2;
  vec2 uv3;
};

struct Hit {
  float t;
  int index;
};


ivec2 indexToCoords(sampler2D tex, int index, int perElement){
  ivec2 dims = textureSize(tex, 0);
  return ivec2((index * perElement) % dims.x,(index * perElement)/ dims.x);
}

Material createMaterial(int index){
  ivec2 base = indexToCoords(matTex, index, 4);
  vec4 first = texelFetch(matTex, base, 0);
  vec4 second = texelFetch(matTex, base + ivec2(1,0), 0);
  vec4 third = texelFetch(matTex, base + ivec2(2,0), 0);
  vec4 fourth = texelFetch(matTex, base + ivec2(3,0), 0);
  return Material(
    MapIndices(first.x, first.y, first.z, second.x, second.y),
    third.rgb,
    fourth.r,
    fourth.g
  );
}

Triangle createTriangle(int index){
  ivec2 base = indexToCoords(triTex, index, 3);
  return Triangle(
    texelFetch(triTex, base, 0).rgb,
    texelFetch(triTex, base + ivec2(1,0), 0).rgb,
    texelFetch(triTex, base + ivec2(2,0), 0).rgb
  );
}

Triangle createLight(int index){
  ivec2 base = indexToCoords(lightTex, index, 3);
  return Triangle(
    texelFetch(lightTex, base, 0).rgb,
    texelFetch(lightTex, base + ivec2(1,0), 0).rgb,
    texelFetch(lightTex, base + ivec2(2,0), 0).rgb
  );
}

Normals createNormals(int index){
  ivec2 base = indexToCoords(normTex, index, 9);
  return Normals(
    texelFetch(normTex, base, 0).rgb,
    texelFetch(normTex, base + ivec2(3,0), 0).rgb,
    texelFetch(normTex, base + ivec2(6,0), 0).rgb,
    texelFetch(normTex, base + ivec2(1,0), 0).rgb,
    texelFetch(normTex, base + ivec2(4,0), 0).rgb,
    texelFetch(normTex, base + ivec2(7,0), 0).rgb,
    texelFetch(normTex, base + ivec2(2,0), 0).rgb,
    texelFetch(normTex, base + ivec2(5,0), 0).rgb,
    texelFetch(normTex, base + ivec2(8,0), 0).rgb
  );
}

TexCoords createTexCoords(int index){
  ivec2 base = indexToCoords(uvTex, index, 3);
  return TexCoords(
    texelFetch(uvTex, base, 0).rg,
    texelFetch(uvTex, base + ivec2(1,0), 0).rg,
    texelFetch(uvTex, base + ivec2(2,0), 0).rg
  );
}

Node createNode(int index){
  ivec2 nodeCoords = indexToCoords(bvhTex, index, 4);
  vec3 first = texelFetch(bvhTex, nodeCoords, 0).rgb;
  vec3 second = texelFetch(bvhTex, nodeCoords + ivec2(1,0), 0).rgb;
  vec3 bbMin = texelFetch(bvhTex, nodeCoords + ivec2(2,0), 0).rgb;
  vec3 bbMax = texelFetch(bvhTex, nodeCoords + ivec2(3,0), 0).rgb;
  return Node(index, 
    floatBitsToInt(first.x), 
    floatBitsToInt(first.y), 
    floatBitsToInt(first.z), 
    floatBitsToInt(second.x), 
    floatBitsToInt(second.y), 
    floatBitsToInt(second.z), 
    bbMin, 
    bbMax
  );
}

// Moller-Trumbore
float rayTriangleIntersect(Ray ray, Triangle tri){
  vec3 e1 = tri.v2 - tri.v1;
  vec3 e2 = tri.v3 - tri.v1;
  vec3 p = cross(ray.dir, e2);
  float det = dot(e1, p);
  if(abs(det) < EPSILON){return MAX_T;}
  float invDet = 1.0 / det;
  vec3 t = ray.origin - tri.v1;
  float u = dot(t, p) * invDet;
  if(u < 0.0 || u > 1.0){return MAX_T;}
  vec3 q = cross(t, e1);
  float v = dot(ray.dir, q) * invDet;
  if(v < 0.0 || u + v > 1.0){return MAX_T;}
  float dist = dot(e2, q) * invDet;
  return dist > EPSILON ? dist : MAX_T;
}

float rayBoxIntersect(Node node, Ray ray) {
  vec3 inverse = 1.0 / ray.dir;
  vec3 t1 = (node.boxMin - ray.origin) * inverse;
  vec3 t2 = (node.boxMax - ray.origin) * inverse;
  vec3 minT = min(t1, t2);
  vec3 maxT = max(t1, t2);
  float tMax = min(min(maxT.x, maxT.y),maxT.z);
  float tMin = max(max(minT.x, minT.y),minT.z);
  return tMax >= tMin && tMax > 0.0 ? tMin : MAX_T;
}

int nearChildIndex(Node node, Ray ray) {
  uint axis = uint(node.split);
  return ray.dir[axis] > 0.0 ? node.left : node.right;
}

Node nearChild(Node node, Ray ray) {
  return createNode(nearChildIndex(node, ray));
}

int farChildIndex(Node node, Ray ray) {
  uint axis = uint(node.split);
  return ray.dir[axis] <= 0.0 ? node.left : node.right;
}

Node farChild(Node node, Ray ray){
  return createNode(farChildIndex(node, ray));
}

void processLeaf(Node leaf, Ray ray, inout Hit result){
  for(int i=0; i<LEAF_SIZE; ++i){
    Triangle tri = createTriangle(leaf.triangles + i);
    float res = rayTriangleIntersect(ray, tri);
    if(res < result.t){
      result.index = leaf.triangles + i;
      result.t = res;
    }
  }
}

Hit intersectScene(Ray ray, inout int count){
	int stack[64];
	int ptr = 0;
	stack[ptr++] = -1;
  Hit result = Hit(MAX_T, -1);
	int idx = 0;
	float leftHit = 0.0;
	float rightHit = 0.0;
  Node current;
	while (idx > -1)
	{
    count++;
    current = createNode(idx);

		int leftIndex = current.left;
		int rightIndex = current.right;

    leftHit = rayBoxIntersect(createNode(leftIndex), ray);
    rightHit = rayBoxIntersect(createNode(rightIndex), ray);

    if (current.triangles > -1) {
      processLeaf(current, ray, result);
    } else {
      if (leftHit < result.t && rightHit < result.t) {
        int deferred = -1;
        if (leftHit > rightHit) {
          idx = rightIndex;
          deferred = leftIndex;
        }
        else {
          idx = leftIndex;
          deferred = rightIndex;
        }

        stack[ptr++] = deferred;
        continue;
      }
      else if (leftHit < result.t) {
        idx = leftIndex;
        continue;
      }
      else if (rightHit < result.t) {
        idx = rightIndex;
        continue;
      }
    }
		idx = stack[--ptr];
	}

	//state.hitDist = t;
	return result;
}

// Hit intersectScene(Ray ray, inout int count){
//   uint state = FROM_PARENT;
//   Hit result = Hit(MAX_T, -1);
//   Node current = nearChild(createNode(0), ray);
//   while(true){
//     count++;
//     if(state == FROM_CHILD){
//       if(current.index == 0){
//         return result;
//       }
//       int parentNear = nearChildIndex(createNode(current.parent), ray);
//       bool atNear = current.index == parentNear;
//       current = createNode(atNear ? current.sibling : current.parent);
//       state = atNear ? FROM_SIBLING : FROM_CHILD;
//     } else {
//       bool fromParent = state == FROM_PARENT;
//       uint nextState = fromParent ? FROM_SIBLING : FROM_CHILD;
//       int nextIndex = fromParent ? current.sibling : current.parent;
//       if(rayBoxIntersect(current, ray) < result.t){
//         if (current.triangles > -1) {
//           processLeaf(current, ray, result);
//         } else {
//           nextIndex = nearChildIndex(current, ray);
//           nextState = FROM_PARENT;
//         }
//       }
//       current = createNode(nextIndex);
//       state = nextState;
//     }
//   }
// }

void main(void) {
  seed = randBase + gl_FragCoord.x * 1000.0 + gl_FragCoord.y;
  Ray ray = Ray(texelFetch(cameraPosTex, ivec2(gl_FragCoord), 0).xyz, texelFetch(cameraDirTex, ivec2(gl_FragCoord), 0).xyz);
  vec3 tcolor = texelFetch(fbTex, ivec2(gl_FragCoord), 0).rgb;
  int count = 0;
  Hit result = intersectScene(ray, count);
  vec3 color = vec3(float(1.0 / result.t));
  fragColor = vec4((color + (tcolor * float(tick)))/(float(tick)+1.0),1.0);
}
