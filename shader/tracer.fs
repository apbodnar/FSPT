#version 300 es
precision highp float;
const int sphereCount = 14;
const int NUM_BOUNCES = 10;
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
uniform vec3 eye;
uniform vec3 rightMax;
uniform vec3 rightMin;
uniform vec3 leftMax;
uniform vec3 leftMin;
uniform sampler2D fbTex;
uniform sampler2D triTex;
uniform sampler2D bvhTex;
uniform sampler2D randTex;

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
  float r1 = rand(origin.xy)-EPSILON;
  float r = pow(r1,exp);
  float theta = 2.0 * M_PI * r2;
  float x = r * cos(theta);
  float y = r * sin(theta);
  vec3 rv = vec3(x, y, sqrt(1.0 - r*r));
  float phi = getAngle(normal);
  return rotationMatrix(cross(normal,vec3(0.0,0.0,1.0)),phi) * rv;
}

float rayTriangleIntersect(Ray ray, Triangle tri){
  vec3 e1 = tri.v2 - tri.v1;
  vec3 e2 = tri.v3 - tri.v1;
  vec3 p = cross(ray.dir, e2);
  float det = dot(e1, p);
  if(abs(det) < EPSILON){return max_t;}
  float invDet = 1.0 / det;
  vec3 t = ray.origin - tri.v1;
  float u = dot(t, p) * invDet;
  if(u < 0.0 || u > 1.0){return max_t;}
  vec3 q = cross(t, e1);
  float v = dot(ray.dir, q) * invDet;
  if(v < 0.0 || u + v > 1.0){return max_t;}
  float dist = dot(e2, q) * invDet;
  if(dist > EPSILON){
    return dist;
  }
  return max_t;
}

vec2 getDOF(){
  float theta = rand(coords) * M_PI * 2.0;
  float sqrt_r = sqrt(rand(coords.yx));
  return vec2(sqrt_r * cos(theta), sqrt_r * sin(theta));
}


ivec2 indexToCoords(sampler2D tex, float index, float perElement){
    ivec2 dims = textureSize(tex, 0);
    return ivec2(mod(index * perElement, float(dims.x)), floor((index * perElement)/ float(dims.x)));
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

vec3 normal(Triangle tri){
  vec3 e1 = tri.v2 - tri.v1;
  vec3 e2 = tri.v3 - tri.v1;
  return normalize(cross(e1, e2));
}

bool rayBoxIntersect(Node node, Ray ray){
  vec3 inverse = 1.0 / ray.dir;//1.0 / (max(abs(ray.dir), vec3(0.0001)) * sign(ray.dir));
  vec3 t1 = (node.boxMin - ray.origin) * inverse;
  vec3 t2 = (node.boxMax - ray.origin) * inverse;
  vec3 minT = min(t1, t2);
  vec3 maxT = max(t1, t2);
  float tMax = min(min(maxT.x, maxT.y),maxT.z);
  float tMin = max(max(minT.x, minT.y),minT.z);
  return tMax >= tMin && tMax > 0.0;
}

Hit gpuTraverseTree(Ray ray){
	Hit result = Hit(max_t, -1.0);
	Hit temp;
	Node last = createNode(0.0);
    Node current = nearChild(createNode(0.0), ray);
    while(true){
		Node near = nearChild(current, ray);
		Node far = farChild(current, ray);
		if(current.index == 0.0){
			return result;
		}
		if(last.index == far.index){
			last = current;
			current = createNode(current.parent);
			continue;
		}
		float tryChild = last.index == current.parent ? near.index : far.index;
		if(rayBoxIntersect(current, ray)){
			last = current;
			current = createNode(tryChild);
		} else {
			if(current.triangles > -1.0){
				temp = processLeaf(current, ray);
				if (temp.t < result.t){
					result = temp;
				}
			}
			if(tryChild == near.index){
				last = near;
			} else {
				last = current;
				current = createNode(current.parent);
			}
		}
    }
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
		} else if (state == FROM_SIBLING){
			if(!rayBoxIntersect(current, ray)){
				current = createNode(current.parent);
				state = FROM_CHILD;
			} else if (current.triangles > -1.0) {
				temp = processLeaf(current, ray);
				if (temp.t < result.t){
					result = temp;
				}
				current = createNode(current.parent);
				state = FROM_CHILD;
			} else {
				current = nearChild(current, ray);
				state = FROM_PARENT;
			}
		} else if (state == FROM_PARENT){
			if(!rayBoxIntersect(current, ray)){
				current = createNode(current.sibling);
				state = FROM_SIBLING;
			} else if(current.triangles > -1.0){
				temp = processLeaf(current, ray);
				if (temp.t < result.t){
					result = temp;
				}
				current = createNode(current.sibling);
				state = FROM_SIBLING;
			} else {
				current = nearChild(current, ray);
				state = FROM_PARENT;
			}
		}
    }
}

vec3 getScreen(){
	vec2 size = vec2(textureSize(fbTex, 0));
	vec2 pct = gl_FragCoord.xy / size;
	vec3 top =  pct.x * (rightMax - leftMax) + leftMax;
	vec3 bottom =  pct.x * (rightMin - leftMin) + leftMin;
	return pct.y * (top - bottom) + bottom;
	
}

vec3 getEmmittance(vec3 dir){
	return dot(dir, normalize(vec3(-1, 1, 1))) > 0.99 ? vec3(50.0) : vec3(0);
}

void main(void) {
  vec3 screen = getScreen() * scale ;
  vec3 dof = (vec3(getDOF(), 0.0)/ vec2(textureSize(fbTex, 0)).x) * scale;
  Ray ray = Ray(eye + dof, normalize(screen - eye));
  vec3 tcolor = texelFetch(fbTex, ivec2(gl_FragCoord), 0).rgb;
  vec3 emmittance[NUM_BOUNCES];
  vec3 reflectance[NUM_BOUNCES];
  Hit result = Hit(max_t, -1.0);
  vec3 color = vec3(0);
  for(int i=0; i < NUM_BOUNCES; i++){
	result = traverseTree(ray);
	vec3 origin = ray.origin + ray.dir * result.t;
    emmittance[i] = result.t == max_t ? getEmmittance(ray.dir) : vec3(0);
    reflectance[i] = result.t == max_t ? vec3(0) : vec3(1);
	
	vec3 dir = randomVec(normal(createTriangle(result.index)), origin , 0.5);
	ray = Ray(origin + EPSILON * dir, dir);
  }
  for(int i=NUM_BOUNCES-1; i>=0; i--){
    color = reflectance[i]*color + emmittance[i];
  }
  fragColor = clamp(vec4((color + (tcolor * float(tick)))/(float(tick)+1.0),1.0),vec4(0), vec4(1));
}

