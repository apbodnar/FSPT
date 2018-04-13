#version 300 es
precision highp float;
const int NUM_BOUNCES = 4;
const float MAX_T = 100000.0;
const float n1 = 1.0;
const float n2 = 1.4;
const float EPSILON = 0.000001;
const float sr = n1/n2;
const float r0 = ((n1 - n2)/(n1 + n2))*((n1 - n2)/(n1 + n2));
const float M_PI = 3.14159265;
const float INV_PI = 1.0 / M_PI;
const uint FROM_PARENT = uint(0);
const uint FROM_SIBLING = uint(1);
const uint FROM_CHILD = uint(2);

float seed;

uniform int tick;
uniform float scale;
uniform float numLights;
uniform float randBase;
uniform vec3 eye;
uniform vec3 rightMax;
uniform vec3 rightMin;
uniform vec3 leftMax;
uniform vec3 leftMin;
uniform vec2 lightRanges[20];
uniform sampler2D fbTex;
uniform sampler2D triTex;
uniform sampler2D bvhTex;
uniform sampler2D matTex;
uniform sampler2D normTex;
uniform sampler2D lightTex;
uniform sampler2D uvTex;
uniform sampler2D atlasTex;
uniform sampler2D envTex;

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
};

struct Material {
  vec3 reflectance;
  vec3 emissivity;
  float roughness;
  float metal;
  float diffuse;
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

struct TexCoords {
  vec2 uv1;
  vec2 uv2;
  vec2 uv3;
};

struct Hit {
  float t;
  float index;
};


float rnd() { return fract(sin(seed += 0.312489)*43758.5453123); }

float rand(vec2 co){
  float a = 12.9898;
  float b = 78.233;
  float c = 43758.5453;
  float dt= dot(co ,vec2(a,b) + float(tick) * 0.0194161103);
  float sn= mod(dt,M_PI);
  return fract(sin(sn) * c);
}

// GGX importance-sampled microfacet
vec3 ggxRandomImportantNormal(vec3 oNormal, float a){
  vec2 xi = vec2(rnd(), rnd());
  float phi = 2.0f * M_PI * xi.x;
  float theta = acos(sqrt((1.0f - xi.y)/((a*a - 1.0f) * xi.y + 1.0f)));
  float sinTheta = sin(theta);
  vec3 u = normalize(cross(oNormal,vec3(0.0,0.0,1.0)));
  vec3 v = normalize(cross(u, oNormal));
  vec3 facet = cos(phi) * sinTheta * u + sinTheta * sin(phi) * v + cos(theta) * oNormal;
  return facet;
}

// GGX PDF
float ggPdf(vec3 normal, vec3 incidentDir, vec3 lightDir, float a){
  vec3 facetNormal = normalize(lightDir - incidentDir); // half angle
  float a2 = a*a;
  float ndh = dot(normal, facetNormal);
  float ndh2 = ndh*ndh;
  float denom = ndh2 * (a2 - 1.0) + 1.0;
  return max(a2 / (M_PI * denom * denom), 0.0);
}

float misWeight(float a, float b ) {
    float a2 = a*a;
    float b2 = b*b;
    float a2b2 = a2 + b2;
    return a2 / a2b2;
}

float schlick(vec3 dir, vec3 normal){
  float dh = 1.0 - dot(-dir,normal);
  return r0 + (1.0 - r0)*dh*dh*dh*dh*dh;
}

vec3 cosineWeightedRandomVec(vec3 normal){
 float r = sqrt(rnd());
 float theta = 2.0 * M_PI * rnd();
 float x = r * cos(theta);
 float y = r * sin(theta);
 vec3 u = normalize(cross(normal,vec3(0.0,0.0,1.0)));
 vec3 v = normalize(cross(u, normal));
 return x*u + y*v + sqrt(1.0 - r*r)*normal;
}

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

vec2 getAA(){
  float theta = rnd() * M_PI * 2.0;
  float sqrt_r = sqrt(rnd());
  return vec2(sqrt_r * cos(theta), sqrt_r * sin(theta));
}

ivec2 indexToCoords(sampler2D tex, float index, float perElement){
  ivec2 dims = textureSize(tex, 0);
	float compensated = (index+0.1); // Hack to handle floaty errors
  return ivec2(mod(compensated * perElement, float(dims.x)), floor((compensated * perElement)/ float(dims.x)));
}

Material createMaterial(float index){
  ivec2 base = indexToCoords(matTex, index, 3.0);
  vec4 third = texelFetch(matTex, base + ivec2(2,0), 0);
  return Material(
    texelFetch(matTex, base + ivec2(1,0), 0).rgb,
    texelFetch(matTex, base, 0).rgb,
	  third.r,
    third.g,
    third.b
  );
}

Triangle createTriangle(float index){
  ivec2 base = indexToCoords(triTex, index, 3.0);
  return Triangle(
    texelFetch(triTex, base, 0).rgb,
    texelFetch(triTex, base + ivec2(1,0), 0).rgb,
    texelFetch(triTex, base + ivec2(2,0), 0).rgb
  );
}

Triangle createLight(float index){
  ivec2 base = indexToCoords(lightTex, index, 3.0);
  return Triangle(
    texelFetch(lightTex, base, 0).rgb,
    texelFetch(lightTex, base + ivec2(1,0), 0).rgb,
    texelFetch(lightTex, base + ivec2(2,0), 0).rgb
  );
}

Normals createNormals(float index){
  ivec2 base = indexToCoords(normTex, index, 3.0);
  return Normals(
    texelFetch(normTex, base, 0).rgb,
    texelFetch(normTex, base + ivec2(1,0), 0).rgb,
    texelFetch(normTex, base + ivec2(2,0), 0).rgb
  );
}

TexCoords createTexCoords(float index){
  ivec2 base = indexToCoords(uvTex, index, 3.0);
  return TexCoords(
    texelFetch(uvTex, base, 0).rg,
    texelFetch(uvTex, base + ivec2(1,0), 0).rg,
    texelFetch(uvTex, base + ivec2(2,0), 0).rg
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

Node nearChild(Node node, Ray ray){
  uint axis = uint(node.split);
  float index = ray.dir[axis] > 0.0 ? node.left : node.right;
  return createNode(index);
}

float nearChildIndex(Node node, Ray ray){
  uint axis = uint(node.split);
  float index = ray.dir[axis] > 0.0 ? node.left : node.right;
  return index;
}

Node farChild(Node node, Ray ray){
  uint axis = uint(node.split);
  float index = ray.dir[axis] <= 0.0 ? node.left : node.right;
  return createNode(index);
}

float farChildIndex(Node node, Ray ray){
  uint axis = uint(node.split);
  float index = ray.dir[axis] <= 0.0 ? node.left : node.right;
  return index;
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

Node siblingNode(Node node){
  return createNode(node.sibling);
}

vec3 normal(Triangle tri, Normals normals, vec3 p){
  return normals.n3;
}

float rayBoxIntersect(Node node, Ray ray){
  vec3 inverse = 1.0 / ray.dir;//1.0 / (max(abs(ray.dir), vec3(0.0001)) * sign(ray.dir));
  vec3 t1 = (node.boxMin - ray.origin) * inverse;
  vec3 t2 = (node.boxMax - ray.origin) * inverse;
  vec3 minT = min(t1, t2);
  vec3 maxT = max(t1, t2);
  float tMax = min(min(maxT.x, maxT.y),maxT.z);
  float tMin = max(max(minT.x, minT.y),minT.z);
  return tMax >= tMin && tMax > 0.0 ? tMin : MAX_T;
}

vec3 barycentricWeights(Triangle tri, vec3 p){
  vec3 v0 = tri.v2 - tri.v1;
  vec3 v1 = tri.v3 - tri.v1;
  vec3 v2 = p - tri.v1;
  float d00 = dot(v0, v0);
  float d01 = dot(v0, v1);
  float d11 = dot(v1, v1);
  float d20 = dot(v2, v0);
  float d21 = dot(v2, v1);
  float invDenom = 1.0 / (d00 * d11 - d01 * d01);
  float v = (d11 * d20 - d01 * d21) * invDenom;
  float w = (d00 * d21 - d01 * d20) * invDenom;
  float u = 1.0 - v - w;
  return vec3(u, v, w);
}

vec2 barycentricTexCoord(vec3 weights, TexCoords texCoords){
	return weights.x * texCoords.uv1 + weights.y * texCoords.uv2 + weights.z * texCoords.uv3;
}

vec3 barycentricNormal(vec3 weights, Normals normals){
	return weights.x * normals.n1 + weights.y * normals.n2 + weights.z * normals.n3;
}

Hit traverseTree(Ray ray){
  uint state = FROM_PARENT;
	Hit result = Hit(MAX_T, -1.0);
  Node current = nearChild(createNode(0.0), ray);
  while(true){
    if(state == FROM_CHILD){
      if(current.index == 0.0){
        return result;
      }
      Node parentNear = nearChild(createNode(current.parent), ray);
      bool atNear = current.index == parentNear.index;
      current = createNode(atNear ? current.sibling : current.parent);
      state = atNear ? FROM_SIBLING : FROM_CHILD;
    } else {
      bool fromParent = state == FROM_PARENT;
      uint nextState = fromParent ? FROM_SIBLING : FROM_CHILD;
      float nextIndex = fromParent ? current.sibling : current.parent;
      if(rayBoxIntersect(current, ray) >= result.t){
        // missed box
      } else if (current.triangles > -1.0) {
        // at leaf
        processLeaf(current, ray, result);
      } else {
        nextIndex = nearChildIndex(current, ray);
        nextState = FROM_PARENT;
      }
      current = createNode(nextIndex);
      state = nextState;
    }
  }
}

vec3 randomPointOnTriangle(Triangle tri){
  vec3 e1 = tri.v2 - tri.v1;
  vec3 e2 = tri.v3 - tri.v1;
  float u = rnd();
  float v = rnd();
  bool over = u + v > 1.0;
  u = over ? 1.0 - u : u;
  v = over ? 1.0 - v : v;
  return tri.v1 + e1 * v + e2 * u;
}

Triangle randomLight(vec2 range){
  float index = floor(range.x + rnd() * ((range.y - range.x) + 1.0));
  return createLight(index);
}

vec3 getScreen(){
	vec2 size = vec2(textureSize(fbTex, 0));
	vec2 pct = gl_FragCoord.xy / size;
	vec3 top =  pct.x * (rightMax - leftMax) + leftMax;
	vec3 bottom =  pct.x * (rightMin - leftMin) + leftMin;
	return pct.y * (top - bottom) + bottom;
}

float triangleArea(Triangle tri){
  vec3 e1 = tri.v2 - tri.v1;
  vec3 e2 = tri.v3 - tri.v1;
  vec3 n = cross(e1, e2);
  return length(n) * 0.5;
}

float attenuationFactor(Ray ray, Triangle tri, vec3 p, vec3 lightNormal, float t){
  float a = triangleArea(tri);
  return (a / (t * t)) * dot(lightNormal, -ray.dir) * INV_PI;
}

float albedo(vec3 color){
  return sqrt(dot(vec3(0.299, 0.587, 0.114) * color*color, vec3(1)));
}

vec3 applyGamma(vec3 color) {
  return pow(color, vec3(2.2));
}

vec3 envColor(vec3 dir){
  vec2 c = vec2(atan(dir.z, dir.x) / 6.283185, dir.y * - 0.5 + 0.5);
  return applyGamma(texture(envTex, c).rgb);
}

vec3 getDirectEmission(vec3 origin, vec3 normal, inout vec3 lightDir){
  vec3 intensity = vec3(0);
  vec2 range = lightRanges[uint(rnd() * numLights)];
  Triangle light = randomLight(range);
  vec3 lightPoint = randomPointOnTriangle(light);
  lightDir = normalize(lightPoint - origin);
  Ray ray = Ray(origin, lightDir);
  Hit shadow = traverseTree(ray);
  // Gross float equality hack
  if(createTriangle(shadow.index).v1 == light.v1){
    Material mat = createMaterial(shadow.index);
    vec3 p = ray.origin + ray.dir * shadow.t;
    vec3 lightNormal = createNormals(shadow.index).n1; // don't use smooth normals for lights
    intensity += max(mat.emissivity * attenuationFactor(ray, light, p, lightNormal, shadow.t) * numLights, vec3(0));
  }
  return intensity;
}

vec3 getIndirectEmission(Ray ray, out Hit result){
  result = traverseTree(ray);
  if(result.index < 0.0){ return vec3(0); }
  return createMaterial(result.index).emissivity;
}

void main(void) {
  vec2 res = vec2(textureSize(fbTex, 0));
  seed = randBase + gl_FragCoord.x + res.x * gl_FragCoord.y;
  vec3 screen = getScreen() * scale;
  vec3 aa = vec3(getAA(), 0.0) / res.x * scale;
  Ray ray = Ray(eye + aa, normalize(screen - eye));
  vec3 tcolor = texelFetch(fbTex, ivec2(gl_FragCoord), 0).rgb;
  vec3 indirectSamples[NUM_BOUNCES];
  vec3 directSamples[NUM_BOUNCES];
  vec3 reflectance[NUM_BOUNCES];
  Hit result = traverseTree(ray);
  vec3 color = vec3(0);
  int bounces = 0;
  for(int i=0; i < NUM_BOUNCES; ++i){
    if(result.index < 0.0){
      reflectance[i] = vec3(1);
      directSamples[i] = envColor(ray.dir);
      indirectSamples[i] = vec3(0);
      break;
    }
    bounces++;
    vec3 origin = ray.origin + ray.dir * result.t;
    Triangle tri = createTriangle(result.index);
    Material mat = createMaterial(result.index);
    vec3 weights = barycentricWeights(tri, origin);
    vec2 texCoord = barycentricTexCoord(weights, createTexCoords(result.index)) + 0.5 / vec2(textureSize(atlasTex, 0));
    vec3 macroNormal = barycentricNormal(weights, createNormals(result.index));
    vec3 microNormal = ggxRandomImportantNormal(macroNormal, mat.roughness);
    ray.origin = origin + macroNormal * EPSILON;
    vec3 lightDir;
    vec3 direct = getDirectEmission(ray.origin, macroNormal, lightDir);
    bool specular = mat.metal > 0.0 ? true : schlick(ray.dir, microNormal) > rnd();
    vec3 incident = ray.dir;
    ray.dir = specular ? reflect(ray.dir, microNormal) : cosineWeightedRandomVec(macroNormal);
    vec3 indirect = getIndirectEmission(ray, result);
    float directPdf;
    float indirectPdf;
    if (specular) {
      directPdf = ggPdf(macroNormal, incident, lightDir, mat.roughness);
      indirectPdf = max(dot(ray.dir, macroNormal), 0.0);
    } else {
      directPdf = max(dot(lightDir, macroNormal), 0.0);
      indirectPdf = 0.0;
    }
    vec3 textureColor = applyGamma(texture(atlasTex, texCoord).rgb);
    directSamples[i] = direct * directPdf;
    indirectSamples[i] = indirect * indirectPdf;
    reflectance[i] = textureColor;
    if(dot(mat.emissivity, vec3(1)) > 0.0 || rnd() > albedo(textureColor)){break;}
  }

  for(int i=bounces; i>=0; --i){
    color = reflectance[i]*(directSamples[i] + color + indirectSamples[i]);
  }

  fragColor = vec4((color + (tcolor * float(tick)))/(float(tick)+1.0),1.0);
}
