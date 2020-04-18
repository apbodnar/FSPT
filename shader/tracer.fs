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
    float a2 = a*a;
    float b2 = b*b;
    float a2b2 = a2 + b2;
    return vec2(a2, b2) / a2b2;
}

//-----------------------------------------------------------------------
vec3 CosineSampleHemisphere(float u1, float u2)
//-----------------------------------------------------------------------
{
	vec3 dir;
	float r = sqrt(u1);
	float phi = M_TAU * u2;
	dir.x = r * cos(phi);
	dir.y = r * sin(phi);
	dir.z = sqrt(max(0.0, 1.0 - dir.x*dir.x - dir.y*dir.y));

	return dir;
}

//-----------------------------------------------------------------------
float SchlickFresnel(float u)
//-----------------------------------------------------------------------
{
	float m = clamp(1.0 - u, 0.0, 1.0);
	float m2 = m * m;
	return m2 * m2*m; // pow(m,5)
}

//-----------------------------------------------------------------------
float GTR2(float NDotH, float a)
//-----------------------------------------------------------------------
{
	float a2 = a * a;
	float t = 1.0 + (a2 - 1.0)*NDotH*NDotH;
	return a2 / (M_PI * t*t);
}

//-----------------------------------------------------------------------
float SmithG_GGX(float NDotv, float alphaG)
//-----------------------------------------------------------------------
{
	float a = alphaG * alphaG;
	float b = NDotv * NDotv;
	return 1.0 / (NDotv + sqrt(a + b - a * b));
}

//-----------------------------------------------------------------------
float UE4Pdf(vec3 incident, vec3 normal, vec2 matParams, in vec3 bsdfDir)
//-----------------------------------------------------------------------
{
	vec3 n = normal;
	vec3 V = -incident;
	vec3 L = bsdfDir;

	float specularAlpha = max(0.001, matParams.y);

	float diffuseRatio = 0.5 * (1.0 - matParams.x);
	float specularRatio = 1.0 - diffuseRatio;

	vec3 halfVec = normalize(L + V);

	float cosTheta = abs(dot(halfVec, n));
	float pdfGTR2 = GTR2(cosTheta, specularAlpha) * cosTheta;

	// calculate diffuse and specular pdfs and mix ratio
	float pdfSpec = pdfGTR2 / (4.0 * abs(dot(L, halfVec)));
	float pdfDiff = abs(dot(L, n)) * INV_PI;

	// weight pdfs according to ratios
	return diffuseRatio * pdfDiff + specularRatio * pdfSpec;
}

//-----------------------------------------------------------------------
vec3 UE4Sample(vec3 incident, vec3 normal, vec2 matParams)
//-----------------------------------------------------------------------
{
	vec3 N = normal;
	vec3 V = -incident;

	vec3 dir;

	float probability = rnd();
	float diffuseRatio = 0.5 * (1.0 - matParams.x);

	float r1 = rnd();
	float r2 = rnd();

	vec3 UpVector = abs(N.z) < 0.999 ? vec3(0, 0, 1) : vec3(1, 0, 0);
	vec3 TangentX = normalize(cross(UpVector, N));
	vec3 TangentY = cross(N, TangentX);

	if (probability < diffuseRatio) // sample diffuse
	{
		dir = CosineSampleHemisphere(r1, r2);
		dir = TangentX * dir.x + TangentY * dir.y + N * dir.z;
	}
	else
	{
		float a = max(0.001, matParams.y);

		float phi = r1 * M_TAU;

		float cosTheta = sqrt((1.0 - r2) / (1.0 + (a*a - 1.0) *r2));
		float sinTheta = clamp(sqrt(1.0 - (cosTheta * cosTheta)), 0.0, 1.0);
		float sinPhi = sin(phi);
		float cosPhi = cos(phi);

		vec3 halfVec = vec3(sinTheta*cosPhi, sinTheta*sinPhi, cosTheta);
		halfVec = TangentX * halfVec.x + TangentY * halfVec.y + N * halfVec.z;

		dir = 2.0*dot(V, halfVec)*halfVec - V;
	}
	return dir;
}

//-----------------------------------------------------------------------
vec3 UE4Eval(vec3 incident, vec3 normal, vec3 diffuseColor, vec2 matParams, in vec3 bsdfDir)
//-----------------------------------------------------------------------
{
	vec3 N = normal;
	vec3 V = -incident;
	vec3 L = bsdfDir;

	float NDotL = dot(N, L);
	float NDotV = dot(N, V);
	if (NDotL <= 0.0 || NDotV <= 0.0)
		return vec3(0.0);

	vec3 H = normalize(L + V);
	float NDotH = dot(N, H);
	float LDotH = dot(L, H);

	// specular	
	vec3 specularCol = mix(vec3(0.04), diffuseColor, matParams.x);
	float a = max(0.001, matParams.y);
	float Ds = GTR2(NDotH, a);
	float FH = SchlickFresnel(LDotH);
	vec3 Fs = mix(specularCol, vec3(1.0), FH);
	float roughg = (matParams.y*0.5 + 0.5);
	roughg = roughg * roughg;
	float Gs = SmithG_GGX(NDotL, roughg) * SmithG_GGX(NDotV, roughg);

	return diffuseColor * INV_PI * (1.0 - matParams.x) + Gs * Fs*Ds;
}

// Moller-Trumbore
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

vec3 barycentricNormal(vec3 weights, Normals normals, vec3 texNormal, out vec3 unmappedNormal){
  unmappedNormal =  weights.x * normals.n1 + weights.y * normals.n2 + weights.z * normals.n3;
  vec3 tangent = weights.x * normals.t1 + weights.y * normals.t2 + weights.z * normals.t3;
  vec3 bitangent = weights.x * normals.bt1 + weights.y * normals.bt2 + weights.z * normals.bt3;
  return normalize(texNormal.x * tangent + texNormal.y * bitangent + texNormal.z * unmappedNormal);
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
	float leftHit = 0.0;
	float rightHit = 0.0;
  Node current;
	while (idx > -1)
	{
    current = createNode(idx);
		int leftIndex = current.left;
		int rightIndex = current.right;
    leftHit = rayBoxIntersect(createBoundingBox(leftIndex), ray);
    rightHit = rayBoxIntersect(createBoundingBox(rightIndex), ray);

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


	return result;
}

vec3 getIndirectEmission(Ray ray, out Hit result, inout Material mat){
  result = intersectScene(ray);
  if(result.index < 0){ return vec3(0); }
  mat = createMaterial(result.index);
  return mat.emissivity;
}

float albedo(vec3 color){
  return dot(vec3(0.2126, 0.7152, 0.0722), color);
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

vec4 sampleEnvImportance(vec3 incident, vec3 origin, vec3 normal, vec3 diffuse, vec2 matParams) {
  vec4 colorPdf = vec4(0);
  int idx = int(float(ENV_BINS) * rnd());
  vec4 bin = vec4(radianceBins[idx]);
  vec2 dims = vec2(textureSize(envTex, 0));
  float nominal = (dims.x * dims.y) / float(ENV_BINS);
  colorPdf.a = nominal / ((bin.z - bin.x) * (bin.w - bin.y));
  vec2 uv = vec2(-envTheta, 0) + vec2((bin.z - bin.x) * rnd() + bin.x, (bin.w - bin.y) * rnd() + bin.y) / dims;
  //uv.y = 1.0 - uv.y; 
  float theta = (uv.x) * M_TAU;
  float phi = M_PI * uv.y;
  float x = cos(theta) * sin(phi);
  float y = cos(phi);
  float z = sin(theta) * sin(phi);
  vec3 dir = vec3(x, y, z);
  float ddn = dot(dir, normal);
  if (ddn > EXPLICIT_COS_THRESHOLD) {
    Hit shadow = intersectScene(Ray(origin, dir));
    if (shadow.index == -1 && colorPdf.a > EPSILON) {
      colorPdf.rgb = UE4Eval(incident, normal, diffuse, matParams, dir) * abs(dot(normal, dir)) / colorPdf.a;
      colorPdf.rgb *= envSample(dir) * M_TAU * 4.0 * cos(asin(y));
      colorPdf.rgb *= clamp(ddn, 0.0, 1.0);
    }
  }
  colorPdf.a *= UE4Pdf(incident, normal, matParams, dir);
  return colorPdf;
}

#ifdef USE_EXPLICIT
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
  int index = int(range.x + rnd() * ((range.y - range.x) + 1.0));
  return createLight(index);
}

float triangleArea(Triangle tri){
  vec3 e1 = tri.v2 - tri.v1;
  vec3 e2 = tri.v3 - tri.v1;
  vec3 n = cross(e1, e2);
  return length(n) * 0.5;
}

float solidAngle(Ray ray, Triangle tri, vec3 p, vec3 lightNormal, float t){
  float a = triangleArea(tri);
  return abs((a / (t * t)) * dot(lightNormal, -ray.dir));
}

vec3 getDirectEmission(vec3 origin, vec3 normal, inout vec3 lightDir){
  vec3 intensity = vec3(0);
  vec2 range = lightRanges[uint(rnd() * numLights)];
  Triangle light = randomLight(range);
  vec3 lightPoint = randomPointOnTriangle(light);
  lightDir = normalize(lightPoint - origin);
  if( dot(lightDir, normal) < EXPLICIT_COS_THRESHOLD ){
    return intensity;
  }
  Ray ray = Ray(origin, lightDir);
  Hit shadow = intersectScene(ray);
  // Gross float equality hack
  if(createTriangle(shadow.index).v1 == light.v1){
    Material mat = createMaterial(shadow.index);
    vec3 p = ray.origin + ray.dir * shadow.t;
    vec3 lightNormal = createNormals(shadow.index).n1; // don't use smooth normals for lights
    intensity += max(mat.emissivity * solidAngle(ray, light, p, lightNormal, shadow.t) * numLights, vec3(0));
  }
  return intensity;
}
#endif

void main(void) {
  vec2 dims = vec2(textureSize(fbTex, 0));
  seed = randBase + gl_FragCoord.x + gl_FragCoord.y * dims.x;
  Ray ray = Ray(texelFetch(cameraPosTex, ivec2(gl_FragCoord), 0).xyz, texelFetch(cameraDirTex, ivec2(gl_FragCoord), 0).xyz);
  vec3 tcolor = texelFetch(fbTex, ivec2(gl_FragCoord), 0).rgb;
  Material mat;
  vec3 weights;
  Hit result = intersectScene(ray);
  vec3 color = vec3(0);
  if(result.index < 0){
    color += envSample(ray.dir);
  } else {
    mat = createMaterial(result.index);
    vec3 accumulatedReflectance = vec3(1);
    for(int i=0; i < NUM_BOUNCES; ++i){
      vec3 origin = ray.origin + ray.dir * result.t;
      Triangle tri = createTriangle(result.index);
      #ifndef USE_ALPHA
      weights = barycentricWeights(tri, origin);
      #endif
      TexCoords texCoords = createTexCoords(result.index);
      vec2 texCoord = barycentricTexCoord(weights, texCoords);
      vec4 texRaw = texture(texArray, vec3(texCoord, mat.mapIndices.diffuse));
      vec3 texEmmissive = texture(texArray, vec3(texCoord, mat.mapIndices.specular)).rgb;
      vec3 texDiffuse = texRaw.rgb;
      vec4 texMetallicRoughness = texture(texArray, vec3(texCoord, mat.mapIndices.roughness));
      float texEmmissiveScale = texMetallicRoughness.b;
      vec3 texNormal = (texture(texArray, vec3(texCoord, mat.mapIndices.normal)).rgb - vec3(0.5, 0.5, 0.0)) * vec3(2.0, 2.0, 1.0);
      texMetallicRoughness.g *= texMetallicRoughness.g;
      seed = origin.x * randBase * origin.y * 1.396529836 + origin.z * 4761.52835;
      vec3 baryNormal;
      vec3 macroNormal = barycentricNormal(weights, createNormals(result.index), texNormal, baryNormal);
      vec3 lightDir;
      ray.origin = origin + baryNormal * EPSILON * 2.0;

      // TODO: make this configurable in the materials
      color += accumulatedReflectance * texEmmissive * 10.0;

      #ifdef USE_EXPLICIT
      vec3 direct = getDirectEmission(ray.origin, macroNormal, lightDir);
      #else
      vec3 direct = vec3(0);
      #endif
      vec3 incident = ray.dir;
      float directWeight = 0.0;
      float indirectWeight = 1.0;

      vec2 matParams = texMetallicRoughness.rg;
      vec4 envImp =  sampleEnvImportance(incident, ray.origin, macroNormal, texDiffuse, matParams);
      ray.dir = UE4Sample(incident, macroNormal, matParams);
      float bsdfPdf = UE4Pdf(incident, macroNormal, matParams, ray.dir);
      vec3 throughput;
      if(bsdfPdf > 0.0) { 
        throughput = UE4Eval(incident, macroNormal, texDiffuse, matParams, ray.dir) * abs(dot(macroNormal, ray.dir)) / bsdfPdf;
      } else {
        throughput = vec3(0.0);
      }
      
      // clamp albedo to avoid some precision issues
      // float colorAlbedo = i > 0 ? 0.5 : 1.0;
      // if( rnd() > colorAlbedo ){ break; }

      vec3 indirect = getIndirectEmission(ray, result, mat);
      vec2 weights = bsdfPdf + envImp.a > 0.0 ? misWeights(envImp.a, bsdfPdf) : vec2(1, 0);
      color += accumulatedReflectance * envImp.rgb * weights.x;
      accumulatedReflectance *= (throughput);
      if(result.index < 0){
        color += accumulatedReflectance * envSample(ray.dir) * weights.y;
        break;
      }
    }
  }
  color = clamp(color, vec3(0), vec3(128));
  fragColor = vec4((color + (tcolor * float(tick)))/(float(tick)+1.0),1.0);
}
