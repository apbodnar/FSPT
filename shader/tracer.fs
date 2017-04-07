#version 300 es
precision highp float;
const int sphereCount = 14;
const int NUM_BOUNCES = 7;
const float max_t = 100000.0;
const float n1 = 1.0;
const float n2 = 1.458;
const float sr = n1/n2;
const float r0 = ((n1 - n2)/(n1 + n2))*((n1 - n2)/(n1 + n2));
const float M_PI = 3.1415926535897932384626433832795;
const float epsilon = 0.00001; //not really epsilon
const float gamma = 1.0/2.2;

in vec2 coords;
out vec4 fragColor;

uniform int tick;
uniform vec3 eye;
uniform vec3 spherePositions[sphereCount];
uniform vec3 sphereAttrs[sphereCount];
uniform vec3 sphereMats[sphereCount];
uniform vec3 sphereColors[sphereCount];
uniform sampler2D fbTex;

struct Sphere {
  vec3 origin;
  vec3 attrs;
  vec3 color;
  vec3 material;
};

struct Ray{
  vec3 origin;
  vec3 dir;
};

struct Hit{
  Ray ray;
  vec3 emmittance;
  vec3 reflectance;
  int index;
};

float rand(vec2 co){
  float a = 12.9898;
  float b = 78.233;
  float c = 43758.5453;
  float dt= dot(co ,vec2(a,b) + float(tick) * 0.0194161103873);
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

vec3 randomVec(vec3 normal, vec3 origin, float exp){
  float r2 = rand(origin.xz);
  float r1 = rand(origin.xy)-epsilon;
  float r = pow(r1,exp);
  float theta = 2.0 * M_PI * r2;
  float x = r * cos(theta);
  float y = r * sin(theta);
  vec3 rv = vec3(x, y, sqrt(1.0 - r*r));
  float phi = getAngle(normal);
  return rotationMatrix(cross(normal,vec3(0.0,0.0,1.0)),phi) * rv;
}

float checkSphereCollision(Ray ray,Sphere s){
  float scalar = dot(ray.dir,ray.origin - s.origin);
  float dist = distance(ray.origin, s.origin);
  float squared = (scalar * scalar) - (dist * dist) + (s.attrs.r * s.attrs.r);
  return squared < 0.0 ? max_t : -scalar - sqrt(squared);
}

vec2 getDOF(){
    float theta = rand(coords) * M_PI * 2.0;
    float sqrt_r = sqrt(rand(coords.yx));
    return vec2(sqrt_r * cos(theta), sqrt_r * sin(theta));
}

Hit getSpecular(int i, float t, Ray ray, Sphere s){
  Hit result;
  result.ray.origin = ray.dir*t + ray.origin;
  vec3 normal = normalize(result.ray.origin - s.origin);
  result.index = i;
  normal = randomVec(normal, result.ray.origin, s.material.y);
  result.ray.dir = reflect(ray.dir,normal);
  result.reflectance = vec3(1);
  if(dot(result.ray.dir,normal) < 0.0){
    result.ray.dir = -result.ray.dir;
  }
  return result;
}

Hit getLambertian(int i, float t, Ray ray, Sphere s){
  Hit result;
  result.ray.origin = ray.dir*t + ray.origin;
  vec3 normal = normalize(result.ray.origin - s.origin);
  result.emmittance = s.attrs.z * s.color;
  result.index = i;
  result.ray.dir = randomVec(normal, result.ray.origin, 0.5);
  result.reflectance = s.color;
  return result;
}

Hit getTransmissive(int i, float t, Ray ray, Sphere s){
  Hit result;
  result.ray.origin = ray.dir*t + ray.origin;
  vec3 normal = normalize(result.ray.origin - s.origin);
  result.index = i;
  float dh = 1.0 - dot(-ray.dir,normal);
  float re = r0 + (1.0 - r0)*dh*dh*dh*dh*dh;
  if(rand(result.ray.origin.xy) < re){
    result.ray.dir = reflect(ray.dir, normal);
  }else{
    float c = dot(ray.dir,-normal);
    vec3 ref = normalize(sr*ray.dir + (sr*c - sqrt(1.0 - sr*sr*(1.0 - c*c)))*normal);
    result.ray.origin = ref*dot(ref,-normal)*s.attrs.r*2.0 + result.ray.origin;
    result.ray.dir = reflect(-ray.dir,ref);
  }
  result.reflectance = vec3(1);
  return result;
}

Hit getCollision(Ray ray, int current){
  float t = max_t;
  int mat = -1;
  Hit result;
  for(int i=0; i<sphereCount; i++){
    Sphere s = Sphere(spherePositions[i],sphereAttrs[i],sphereColors[i],sphereMats[i]);
    float nt = checkSphereCollision(ray,s);
    if(nt < t && nt > 0.0 && current != i){
      t = nt;
      mat = int(s.material.z);
      if( int(s.material.z) == 0 ){ //diffuse
        result = getLambertian(i, t, ray,s);
      } else if( int(s.material.z) == 1 ){ //specular
        result = getSpecular(i, t, ray,s);
      } else if( int(s.material.z) == 2 ){ //transmissive
        result = getTransmissive(i, t, ray, s);
      }
    }
  }
  return result;
}

void main(void) {
  vec2 size = vec2(textureSize(fbTex, 0));
  vec3 tcolor = texelFetch(fbTex, ivec2(gl_FragCoord), 0).rgb;
  vec3 dof = 60.0 * vec3(getDOF(), 0.0) / size.x;
  vec3 origin = vec3(coords.x, coords.y, 0) + dof * 1.5;
  //No recursion in GLSL
  vec3 emmittance[NUM_BOUNCES];
  vec3 reflectance[NUM_BOUNCES];
  Hit current = Hit(Ray(origin, normalize(origin - (eye + 4.0 * dof))), vec3(0), vec3(0), -1);
  for(int i=0; i < NUM_BOUNCES; i++){
    current = getCollision(current.ray, current.index);
    emmittance[i] = current.emmittance;
    reflectance[i] = current.reflectance;
  }
  vec3 color = vec3(0);
  for(int i=NUM_BOUNCES-1; i>=0; i--){
    color = reflectance[i]*color + emmittance[i];
  }
  color = pow(color,vec3(gamma));
  fragColor = clamp(vec4((color + (tcolor * float(tick)))/(float(tick)+1.0),1.0),vec4(0), vec4(1));
}
