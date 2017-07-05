#version 300 es
precision highp float;
const int NUM_BOUNCES = 8;
const float max_t = 100000.0;
const float n1 = 1.0;
const float n2 = 1.458;
const float EPSILON = 0.000001;
const float sr = n1/n2;
const float r0 = ((n1 - n2)/(n1 + n2))*((n1 - n2)/(n1 + n2));
const float M_PI = 3.14159265;
const float gamma = 1.0/2.2;

const uint FROM_PARENT = uint(0);
const uint FROM_SIBLING = uint(1);
const uint FROM_CHILD = uint(2);

in vec2 coords;
out vec4 fragColor;

uniform float scale;
uniform int tick;
uniform float numLights;
uniform vec3 eye;
uniform vec3 skybox;
uniform vec3 rightMax;
uniform vec3 rightMin;
uniform vec3 leftMax;
uniform vec3 leftMin;
uniform vec2 lightRanges[20];
uniform vec2 randoms[32];
uniform sampler2D fbTex;
uniform sampler2D triTex;
uniform sampler2D bvhTex;
uniform sampler2D matTex;
uniform sampler2D normTex;
uniform sampler2D lightTex;
uniform sampler2D uvTex;
uniform sampler2D atlasTex;

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
  vec3 emittance;
  float specular;
  float albedo;
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

float rand(vec2 co){
  float a = 12.9898;
  float b = 78.233;
  float c = 43758.5453;
  float dt= dot(co ,vec2(a,b) + float(tick) * 0.0194161103);
  float sn= mod(dt,M_PI);
  return fract(sin(sn) * c);
}

float getAngle(vec3 a){
  vec3 b = vec3(0.0,0.0,1.0);
  return atan(length(cross(a,b)),a.z);
}

mat3 rotationMatrix(vec3 axis, float angle){
  axis = normalize(axis);
  float s = sin(angle);
  float c = cos(angle);
  float oc = 1.0 - c;
  return mat3(oc * axis.x * axis.x + c,    oc * axis.x * axis.y - axis.z * s, oc * axis.z * axis.x + axis.y * s,
        oc * axis.x * axis.y + axis.z * s, oc * axis.y * axis.y + c,          oc * axis.y * axis.z - axis.x * s,
        oc * axis.z * axis.x - axis.y * s, oc * axis.y * axis.z + axis.x * s, oc * axis.z * axis.z + c);
}

// GGX importance-sampled microfacet
vec3 randomNormal(vec3 oNormal, float a, vec3 seed){
  vec2 xi = vec2(rand(seed.xy), rand(seed.zx));
  float phi = 2.0f * M_PI * xi.x;
  float theta = acos(sqrt((1.0f - xi.y)/((a*a - 1.0f) * xi.y + 1.0f)));
  float sinTheta = sin(theta);
  vec3 facet = vec3(cos(phi) * sinTheta, sinTheta * sin(phi), cos(theta));
  float trans = getAngle(oNormal);
  return rotationMatrix(cross(oNormal,vec3(0.0,0.0,1.0)),trans) * facet;
}

// GGX PDF
float directLightWeight(vec3 normal, vec3 incidentDir, vec3 lightDir, float a){
  vec3 facetNormal = normalize(lightDir - incidentDir);
  float a2 = a*a;
  float ndm = dot(normal, facetNormal);
  float ndm2 = ndm*ndm;
  float denom = ndm2 * a2 + (1.0 - ndm2);
  return ceil(ndm) * a2 / (M_PI * denom * denom);
}

//vec3 randomVec(vec3 normal, vec3 seed){
//  float r = sqrt(rand(seed.xy));
//  float theta = 2.0 * M_PI * rand(seed.zx);
//  float x = r * cos(theta);
//  float y = r * sin(theta);
//  vec3 rv = vec3(x, y, sqrt(1.0 - r*r));
//  float phi = getAngle(normal);
//  return rotationMatrix(cross(normal,vec3(0.0,0.0,1.0)),phi) * rv;
//}

// Moller-Trumbore
float rayTriangleIntersect(Ray ray, Triangle tri){
  float epsilon= 0.0000001;
  vec3 e1 = tri.v2 - tri.v1;
  vec3 e2 = tri.v3 - tri.v1;
  vec3 p = cross(ray.dir, e2);
  float det = dot(e1, p);
  if(abs(det) < epsilon){return max_t;}
  float invDet = 1.0 / det;
  vec3 t = ray.origin - tri.v1;
  float u = dot(t, p) * invDet;
  if(u < 0.0 || u > 1.0){return max_t;}
  vec3 q = cross(t, e1);
  float v = dot(ray.dir, q) * invDet;
  if(v < 0.0 || u + v > 1.0){return max_t;}
  float dist = dot(e2, q) * invDet;
  return dist > epsilon ? dist : max_t;
}

vec2 getAA(){
  float theta = rand(coords + randoms[1]) * M_PI * 2.0;
  float sqrt_r = sqrt(rand(coords.yx + randoms[0]));
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
    third.g
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

Node farChild(Node node, Ray ray){
  uint axis = uint(node.split);
  float index = ray.dir[axis] <= 0.0 ? node.left : node.right;
  return createNode(index);
}


Hit processLeaf(Node leaf, Ray ray){
	float t = max_t;
	float index = -1.0;
	for(int i=0; i<4; i++){
		Triangle tri = createTriangle(leaf.triangles + float(i));
		float res = rayTriangleIntersect(ray, tri);
		if(res < t){
			t = res;
			index = leaf.triangles + float(i);
		}
	}
	return Hit(t, index);
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
  return tMax >= tMin && tMax > 0.0 ? tMin : max_t;
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
	Hit result = Hit(max_t, -1.0);
	Hit temp;
  Node current = nearChild(createNode(0.0), ray);
  while(true){
    if(state == FROM_CHILD){
      if(current.index == 0.0){
        return result;
      }
      Node parentNear = nearChild(createNode(current.parent), ray);
      if(current.index == parentNear.index){
        current = createNode(current.sibling);
        state = FROM_SIBLING;
      } else {
        current = createNode(current.parent);
        state = FROM_CHILD;
      }
    } else {
      bool fromParent = state == FROM_PARENT;
      uint nextState = fromParent ? FROM_SIBLING : FROM_CHILD;
      float nextIndex = fromParent ? current.sibling : current.parent;
      if(rayBoxIntersect(current, ray) >= result.t){
        current = createNode(nextIndex);
        state = nextState;
      } else if (current.triangles > -1.0) {
        temp = processLeaf(current, ray);
        if (temp.t < result.t){
          result = temp;
        }
        current = createNode(nextIndex);
        state = nextState;
      } else {
        current = nearChild(current, ray);
        state = FROM_PARENT;
      }
    }
  }
}

vec3 randomPointOnTriangle(Triangle tri, vec3 seed){
  vec3 e1 = tri.v2 - tri.v1;
  vec3 e2 = tri.v3 - tri.v1;
  float u = rand(seed.xz);
  float v = rand(seed.zy);
  bool over = u + v > 1.0;
  u = over ? 1.0 - u : u;
  v = over ? 1.0 - v : v;
  return tri.v1 + e1 * v + e2 * u;
}

Triangle randomLight(vec2 seed, vec2 range){
  float index = floor(range.x + rand(coords.yx + seed.yx) * ((range.y - range.x) + 1.0));
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

float attenuationFactor(Ray ray, Triangle tri, vec3 p, vec3 normal){
  float a = triangleArea(tri);
  vec3 span = ray.origin - p;
  float rr = dot(span, span);
  //magic number is 1 / Tau, the solid angle of a hemisphere
  return (a/rr) * dot(normal, normalize(ray.origin - p)) * 0.1591549;
}

float albedo(vec3 color){
  return sqrt(dot(vec3(0.299, 0.587, 0.114) * color*color, vec3(1)));
}

vec3 getDirectEmmission(vec3 origin, vec3 normal, vec3 incident, float specular){
  vec3 color = vec3(0);
  vec2 range = lightRanges[uint(rand(coords.xy + origin.xy) * numLights)];
  Triangle light = randomLight(origin.xz, range);
  vec3 lightPoint = randomPointOnTriangle(light, origin);
  vec3 dir = normalize(lightPoint - origin);
  Ray ray = Ray(origin, dir);
  Hit shadow = traverseTree(ray);
  vec3 tspan = ray.dir * shadow.t;
  vec3 span = lightPoint - ray.origin;
  float weight = directLightWeight(normal, incident, normalize(span), specular);
  if(abs(shadow.t - length(span)) < EPSILON * 10.0){
    Material mat = createMaterial(shadow.index);
    vec3 lightNormal = barycentricNormal(barycentricWeights(createTriangle(shadow.index), origin), createNormals(shadow.index));
    vec3 p = ray.origin + ray.dir * shadow.t;
    color += max(weight * dot(ray.dir, normal) * mat.emittance * attenuationFactor(ray, light, p, lightNormal) * numLights * ((range.y - range.x) + 1.0), vec3(0));
  }
  return color;
}

void main(void) {
  vec3 screen = getScreen() * scale ;
  vec3 aa = (vec3(getAA(), 0.0)/ vec2(textureSize(fbTex, 0)).x) * scale;
  Ray ray = Ray(eye + aa, normalize(screen - eye));
  vec3 tcolor = texelFetch(fbTex, ivec2(gl_FragCoord), 0).rgb;
  vec3 emittance[NUM_BOUNCES];
  vec3 reflectance[NUM_BOUNCES];
  Hit result = Hit(max_t, -1.0);
  vec3 color = vec3(0);
  int bounces = 0;
  for(int i=0; i < NUM_BOUNCES; i++){
    result = traverseTree(ray);
    vec3 origin = ray.origin + ray.dir * result.t;
    bounces++;
    if(result.index < 0.0){ emittance[i] = skybox; break; }
    Triangle tri = createTriangle(result.index);
    vec3 weights = barycentricWeights(tri, origin);
    vec2 texCoord = barycentricTexCoord(weights, createTexCoords(result.index)) + 0.5 / vec2(textureSize(atlasTex, 0));
    Material mat = createMaterial(result.index);
    vec3 oNormal = barycentricNormal(weights, createNormals(result.index));
    vec3 incident = ray.dir;
    vec3 normal = randomNormal(oNormal, mat.specular, origin);
    vec3 dir = reflect(ray.dir, normal);
    ray = Ray(origin + normal * EPSILON, dir);
    vec3 texRef =  texture(atlasTex, texCoord).rgb;
    emittance[i] = texRef * getDirectEmmission(ray.origin, oNormal, incident, mat.specular);
    reflectance[i] = texRef;
    if(dot(mat.emittance, vec3(1)) > 0.0 || rand(origin.zy) > albedo(texRef)){break;}
  }
  for(int i=bounces-1; i>=0; i--){
    color = reflectance[i]*color + emittance[i];
  }
  //color = pow(color,vec3(gamma));

  fragColor = clamp(vec4((color + (tcolor * float(tick)))/(float(tick)+1.0),1.0),vec4(0), vec4(1));
}
