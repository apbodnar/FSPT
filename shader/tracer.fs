#version 300 es
//#define ENV_BINS 0
//#define NUM_LIGHT_RANGES 0

precision highp float;
precision highp int;
precision highp sampler2DArray;

const int NUM_BOUNCES = 4;
const float MAX_T = 100000.0;
const float EPSILON = 0.000001;
const float M_PI = 3.14159265;
const float M_TAU = M_PI * 2.0;
const float INV_PI = 1.0 / M_PI;
const float EXPLICIT_COS_THRESHOLD = -0.1;

uniform uint tick;
uniform float numLights;
uniform float randBase;
uniform float envTheta;
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

float seed;

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

struct BoundingBox {
  vec3 bMin;
  vec3 bMax;
};

struct Node {
  int index;
  int left;
  int right;
  int triangles;
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
  return ivec2((index * perElement) % dims.x, (index * perElement) / dims.x);
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

BoundingBox createBoundingBox(int index) {
  ivec2 nodeCoords = indexToCoords(bvhTex, index, 3);
  vec3 bbMin = texelFetch(bvhTex, nodeCoords + ivec2(1,0), 0).rgb;
  vec3 bbMax = texelFetch(bvhTex, nodeCoords + ivec2(2,0), 0).rgb;
  return BoundingBox(
    bbMin, 
    bbMax
  );
}

Node createNode(int index){
  ivec2 nodeCoords = indexToCoords(bvhTex, index, 3);
  vec3 first = texelFetch(bvhTex, nodeCoords, 0).rgb;
  return Node(index,
    floatBitsToInt(first.x),
    floatBitsToInt(first.y), 
    floatBitsToInt(first.z)
  );
}

float rnd() { return fract(sin(seed += 0.211324865405187)*43758.5453123); }

vec2 misWeights(float a, float b ) {
    if (a > EPSILON && b > EPSILON) {
      float a2 = a * a;
      float b2 = b * b;
      float a2b2 = a2 + b2;
      return vec2(a2, b2) / a2b2;
    } else if (a > EPSILON) {
      return vec2(1, 0);
    } else {
      return vec2(0, 1);
    }
}

vec3 cosineSampleHemisphere(float u1, float u2) {
	vec3 dir;
	float r = sqrt(u1);
	float phi = M_TAU * u2;
	dir.x = r * cos(phi);
	dir.y = r * sin(phi);
	dir.z = sqrt(max(0.0, 1.0 - dir.x*dir.x - dir.y*dir.y));
	return dir;
}

float gtr2(float ndh, float a) {
	float a2 = a * a;
	float t = 1.0 + (a2 - 1.0) * ndh * ndh;
	return a2 / (M_PI * t * t);
}

float smithG(float NDotv, float alphaG) {
	float a = alphaG * alphaG;
	float b = NDotv * NDotv;
	return 1.0 / (NDotv + sqrt(a + b - a * b));
}

float gtr2Pdf(vec3 incident, vec3 normal, vec2 metallicRoughness, vec3 bsdfDir) {
	float specularAlpha = max(0.001, metallicRoughness.y);
	vec3 halfVec = normalize(bsdfDir + incident);
  float cosTheta = abs(dot(halfVec, normal));
  float pdfgtr2 = gtr2(cosTheta, specularAlpha) * cosTheta;
  return pdfgtr2 / (4.0 * abs(dot(bsdfDir, halfVec)));
}

float lambertPdf(vec3 normal, vec2 metallicRoughness, vec3 bsdfDir) {
  return abs(dot(bsdfDir, normal)) * INV_PI;
}

float schlick(vec3 incident, vec3 normal, vec2 ns){
  float r0 = (ns.x - ns.y) / (ns.x + ns.y);
  r0 *= r0;
  float cosTheta = dot(normal, incident);
  if (ns.x > ns.y)
  {
      float n = ns.x / ns.y;
      float sinTheta2 = n * n * (1.0 - cosTheta * cosTheta);
      // Total internal reflection
      if (sinTheta2 > 1.0)
          return 1.0;
      cosTheta = sqrt(1.0 - sinTheta2);
  }
  float x = 1.0 - cosTheta;
  return r0 + (1.0 - r0)*x*x*x*x*x;
}

vec3 sampleMicrofacet(vec3 normal, vec2 metallicRoughness) {
    float r1 = rnd();
    float r2 = rnd();
    vec3 up = abs(normal.z) < 0.999 ? vec3(0, 0, 1) : vec3(1, 0, 0);
    vec3 tangent = normalize(cross(up, normal));
    vec3 bitangent = cross(normal, tangent);
		float a = max(0.001, metallicRoughness.y);
		float phi = r1 * M_TAU;
		float cosTheta = sqrt((1.0 - r2) / (1.0 + (a*a - 1.0) *r2));
		float sinTheta = clamp(sqrt(1.0 - (cosTheta * cosTheta)), 0.0, 1.0);
		float sinPhi = sin(phi);
		float cosPhi = cos(phi);
		vec3 halfVec = vec3(sinTheta*cosPhi, sinTheta*sinPhi, cosTheta);
		return tangent * halfVec.x + bitangent * halfVec.y + normal * halfVec.z;
}

vec3 sampleLambert(vec3 normal) {
    float r1 = rnd();
    float r2 = rnd();
    vec3 up = abs(normal.z) < 0.999 ? vec3(0, 0, 1) : vec3(1, 0, 0);
    vec3 tangent = normalize(cross(up, normal));
    vec3 bitangent = cross(normal, tangent);
    vec3 dir = cosineSampleHemisphere(r1, r2);
    return tangent * dir.x + bitangent * dir.y + normal * dir.z;
}

vec3 evalSpecular(vec3 incident, vec3 normal, vec3 diffuseColor, vec2 metallicRoughness, in vec3 bsdfDir) {
  float ndl = dot(normal, bsdfDir);
  float ndv = dot(normal, incident);
  vec3 H = normalize(bsdfDir + incident);
  float ndh = dot(normal, H);
  float a = max(0.001, metallicRoughness.y);
  float Ds = gtr2(ndh, a);
  vec3 Fs = mix(vec3(1.0), diffuseColor, metallicRoughness.x);
  float roughg = (metallicRoughness.y * 0.5 + 0.5);
  roughg = roughg * roughg;
  float Gs = smithG(ndl, roughg) * smithG(ndv, roughg);
  return Gs * Fs * Ds;
}

float rayTriangleIntersect(in Ray ray, in Triangle tri){
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

float rayBoxIntersect(in BoundingBox box, in Ray ray) {
  vec3 inverse = 1.0 / ray.dir;
  vec3 t1 = (box.bMin - ray.origin) * inverse;
  vec3 t2 = (box.bMax - ray.origin) * inverse;
  vec3 minT = min(t1, t2);
  vec3 maxT = max(t1, t2);
  float tMax = min(min(maxT.x, maxT.y),maxT.z);
  float tMin = max(max(minT.x, minT.y),minT.z);
  return tMax >= tMin && tMax > 0.0 ? tMin : MAX_T;
}

vec2 barycentricTexCoord(vec3 weights, TexCoords texCoords){
  return weights.x * texCoords.uv1 + weights.y * texCoords.uv2 + weights.z * texCoords.uv3;
}

vec3 barycentricNormal(vec3 weights, Normals normals, vec3 texNormal, out vec3 baryNormal){
  baryNormal = weights.x * normals.n1 + weights.y * normals.n2 + weights.z * normals.n3;
  vec3 baryTangent = weights.x * normals.t1 + weights.y * normals.t2 + weights.z * normals.t3;
  vec3 baryBiTangent = weights.x * normals.bt1 + weights.y * normals.bt2 + weights.z * normals.bt3;
  return normalize(texNormal.x * baryTangent + texNormal.y * baryBiTangent + texNormal.z * baryNormal);
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

void processLeaf(in Node leaf, in Ray ray, inout Hit result){
  for(int i=0; i<LEAF_SIZE; ++i){
    Triangle tri = createTriangle(leaf.triangles + i);
    float res = rayTriangleIntersect(ray, tri);
    if(res < result.t){
      result.index = leaf.triangles + i;
      result.t = res;
    }
  }
}

Hit intersectScene(Ray ray){
  Hit result = Hit(MAX_T, -1);
	int stack[64];
	int ptr = 0;
	stack[ptr++] = -1;
	int idx = 0;
  Node current;
	while (idx > -1) {
    current = createNode(idx);
		int leftIndex = current.left;
		int rightIndex = current.right;
    float leftHit = rayBoxIntersect(createBoundingBox(leftIndex), ray);
    float rightHit = rayBoxIntersect(createBoundingBox(rightIndex), ray);
    if (current.triangles > -1) {
      processLeaf(current, ray, result);
    } else {
      if (leftHit < result.t && rightHit < result.t) {
        int deferred = -1;
        if (leftHit > rightHit) {
          idx = rightIndex;
          deferred = leftIndex;
        } else {
          idx = leftIndex;
          deferred = rightIndex;
        }
        stack[ptr++] = deferred;
        continue;
      } else if (leftHit < result.t) {
        idx = leftIndex;
        continue;
      } else if (rightHit < result.t) {
        idx = rightIndex;
        continue;
      }
    }
		idx = stack[--ptr];
	}
	return result;
}

float albedo(vec3 color){
  return clamp(dot(vec3(0.2126, 0.7152, 0.0722), color), 0.1, 1.0);
}

vec3 envColor(vec2 c) {
  vec4 rgbe = texture(envTex, c);
  rgbe.rgb *= pow(2.0,rgbe.a*255.0-128.0);
  return rgbe.rgb;
}

vec3 envSample(vec3 dir){
  vec2 c = vec2(envTheta + atan(dir.z, dir.x) / M_TAU, asin(-dir.y) * INV_PI + 0.5);
  return envColor(c);
}

vec4 sampleEnvImportance(vec3 origin, vec3 normal, out vec3 envDir) {
  vec4 colorPdf = vec4(0);
  int idx = int(float(ENV_BINS) * rnd());
  vec4 bin = vec4(radianceBins[idx]);
  vec2 dims = vec2(textureSize(envTex, 0));
  float nominal = (dims.x * dims.y) / float(ENV_BINS);
  vec2 uv = vec2(-envTheta, 0) + vec2((bin.z - bin.x) * rnd() + bin.x, (bin.w - bin.y) * rnd() + bin.y) / dims;
  float theta = uv.x * M_TAU;
  float phi = uv.y * M_PI;
  float sinPhi = sin(phi);
  float x = cos(theta) * sinPhi;
  float y = cos(phi);
  float z = sin(theta) * sinPhi;
  envDir = vec3(x, y, z);
  float ddn = dot(envDir, normal);
  colorPdf.a = nominal / ((bin.z - bin.x) * (bin.w - bin.y) * M_TAU * M_PI * cos(asin(y)));
  if (ddn > EXPLICIT_COS_THRESHOLD) {
    Hit shadow = intersectScene(Ray(origin, envDir));
    if (shadow.index == -1 && colorPdf.a > EPSILON) {
      colorPdf.rgb = envSample(envDir) / colorPdf.a;
      colorPdf.rgb *= clamp(ddn, 0.0, 1.0);
    }
  }
  //colorPdf.a *= ue4pdf(incident, normal, metallicRoughness, dir);
  return colorPdf;
}

void main(void) {
  vec2 dims = vec2(textureSize(fbTex, 0));
  seed = randBase + gl_FragCoord.x + gl_FragCoord.y * dims.x;
  Ray ray = Ray(texelFetch(cameraPosTex, ivec2(gl_FragCoord), 0).xyz, texelFetch(cameraDirTex, ivec2(gl_FragCoord), 0).xyz);
  Hit result = intersectScene(ray);
  vec3 color = vec3(0);
  if(result.index < 0){
    color += envSample(ray.dir);
  } else {
    vec3 accumulatedReflectance = vec3(1);
    for(int i=0; i < NUM_BOUNCES; ++i){
      Material mat = createMaterial(result.index);
      Triangle tri = createTriangle(result.index);
      TexCoords texCoords = createTexCoords(result.index);
      vec3 origin = ray.origin + ray.dir * result.t;
      vec3 baryWeights = barycentricWeights(tri, origin);
      vec2 texCoord = barycentricTexCoord(baryWeights, texCoords);
      vec3 texDiffuse = texture(texArray, vec3(texCoord, mat.mapIndices.diffuse)).rgb;
      vec3 texEmmissive = texture(texArray, vec3(texCoord, mat.mapIndices.specular)).rgb;
      vec2 texMetallicRoughness = texture(texArray, vec3(texCoord, mat.mapIndices.roughness)).rg;
      vec3 texNormal = (texture(texArray, vec3(texCoord, mat.mapIndices.normal)).rgb - vec3(0.5, 0.5, 0.0)) * vec3(2.0, 2.0, 1.0);
      texMetallicRoughness.g *= texMetallicRoughness.g;
      seed = origin.x * randBase * origin.y * 1.396529836 + origin.z * 4761.52835;
      vec3 baryNormal;
      vec3 macroNormal = barycentricNormal(baryWeights, createNormals(result.index), texNormal, baryNormal);
      bool inside = dot(-ray.dir, baryNormal) < 0.0;
      vec2 ns = inside ? vec2(mat.ior, 1.0) : vec2(1.0, mat.ior);
      macroNormal = inside ? -macroNormal : macroNormal;
      ray.origin = origin + macroNormal * EPSILON * 2.0;

      // TODO: make this configurable in the materials
      color += accumulatedReflectance * texEmmissive * texDiffuse * 10.0;
      vec3 incident = -ray.dir;
      vec3 envDir;
      vec3 throughput;
      float bsdfPdf;
      vec4 envColorPdf = mat.dielectric >= 0.0 ? vec4(0) : sampleEnvImportance( ray.origin, macroNormal, envDir);
      vec3 microNormal = sampleMicrofacet(macroNormal, texMetallicRoughness);
      bool specular =  mix(schlick(incident, microNormal, ns), 1.0, texMetallicRoughness.x) > rnd();
      if (specular) {
        ray.dir = reflect(-incident, microNormal);
        bsdfPdf = gtr2Pdf(incident, macroNormal, texMetallicRoughness, ray.dir);
        throughput = evalSpecular(incident, macroNormal, texDiffuse, texMetallicRoughness, ray.dir) * clamp(dot(macroNormal, ray.dir), 0.0, 1.0) / bsdfPdf;
        envColorPdf.rgb *= evalSpecular(incident, macroNormal, texDiffuse, texMetallicRoughness, envDir);
      } else if (mat.dielectric >= 0.0) {
        bsdfPdf = 1.0;
        throughput = vec3(1);
        ray.origin = origin - macroNormal * EPSILON * 2.0;
        ray.dir = refract(-incident, microNormal, ns.x / ns.y);
        // This should be safe since total internal reflection will go through the specular path
        i--;
      } else {
        ray.dir = sampleLambert(macroNormal);
        bsdfPdf = lambertPdf(macroNormal, texMetallicRoughness, ray.dir);
        throughput = texDiffuse * INV_PI * clamp(dot(macroNormal, ray.dir), 0.0, 1.0) / bsdfPdf;
        envColorPdf.rgb *= throughput;
      }

      // Apply some bad approximation of beers law if refracting
      throughput = inside ? max(vec3(1) - ((vec3(1) - texDiffuse) * result.t * mat.dielectric), vec3(0)) : throughput;
      result = intersectScene(ray);

      vec2 weights = misWeights(envColorPdf.a, bsdfPdf);
      color += accumulatedReflectance * envColorPdf.rgb * weights.x;
      accumulatedReflectance *= throughput;
      if(result.index < 0){
        color += accumulatedReflectance * envSample(ray.dir) * weights.y;
        break;
      }
    }
  }
  color = clamp(color, 0.0, 1024.0);
  vec3 tcolor = texelFetch(fbTex, ivec2(gl_FragCoord), 0).rgb;
  fragColor = vec4((color + (tcolor * float(tick)))/(float(tick)+1.0), 1.0);
}
