#define PIXEL_SAMPLES 		1		//samples per pixel. Increase for better image quality
#define DL_SAMPLES			1		//direct light samples
#define MAX_DEPTH			4		//GI depth
#define LENS_SIZE			0.3		//depth of field
#define CLAMP_VALUE			16.0		//biased rendering
//#define CLAMP_CAUSTICS				//biased rendering
#define TEXTURES			//uncomment to enable textures
#define NORMAL_MAPS		//uncomment to enable normal mapping(textures are necessery for normal mapping)

#define SPHERE_LIGHT
//#define CONCENTRIC_DISK

const vec3 backgroundColor = vec3( 0.0 );

//pos in uv space where we store various data
const vec2 acc_start_uv = vec2(0.0); //accumulation start frame
const vec2 camera_pos_uv = vec2(1.0, 0.0); //camera pos
const vec2 camera_dir_uv = vec2(2.0, 0.0); //camera pos

int getAccStart() {
	if( iMouse.z > 0.0 ) {
        return iFrame;
    } else {
        return int(texture( iChannel3, (acc_start_uv + vec2(0.5, 0.5))/iResolution.xy ).x);
    }
}

vec4 LoadVec4(vec2 uv) { return texture( iChannel3, (uv + vec2(0.5, 0.5))/iResolution.xy ); }

//used macros and constants
#define PI 					3.1415926
#define TWO_PI 				6.2831852
#define FOUR_PI 			12.566370
#define INV_PI 				0.3183099
#define INV_TWO_PI 			0.1591549
#define INV_FOUR_PI 		0.0795775
#define EPSILON 			0.0001 
#define EQUAL_FLT(a,b,eps)	(((a)>((b)-(eps))) && ((a)<((b)+(eps))))
#define IS_ZERO(a) 			EQUAL_FLT(a,0.0,EPSILON)
//********************************************
    
bool is_inf(float val) {
	return val != val;
    //return isinf(val);	//webGL 2.0 is required
}

// random number generator **********
// taken from iq :)
float seed;	//seed initialized in main
float rnd() { return fract(sin(seed++)*43758.5453123); }
//***********************************

//////////////////////////////////////////////////////////////////////////
// From smallVCM
// Converting PDF from Solid angle to Area
float PdfWtoA( float aPdfW, float aDist2, float aCosThere ){
    if( aDist2 < EPSILON )
        return 0.0;
    return aPdfW * abs(aCosThere) / aDist2;
}

// Converting PDF between from Area to Solid angle
float PdfAtoW( float aPdfA, float aDist2, float aCosThere ){
    float absCosTheta = abs(aCosThere);
    if( absCosTheta < EPSILON )
        return 0.0;
    
    return aPdfA * aDist2 / absCosTheta;
}

float misWeight( in float a, in float b ) {
    float a2 = a*a;
    float b2 = b*b;
    float a2b2 = a2 + b2;
    return a2 / a2b2;
}
//////////////////////////////////////////////////////////////////////////

vec3 toVec3( vec4 v ) {
    if( IS_ZERO( v.w ) ) {
        return v.xyz;
    }
    
    return v.xyz*(1.0/v.w);
}

mat3 mat3Inverse( in mat3 m ) {
    return mat3(	vec3( m[0][0], m[1][0], m[2][0] ),
					vec3( m[0][1], m[1][1], m[2][1] ),
                    vec3( m[0][2], m[1][2], m[2][2] ) );
}

//fast inverse for orthogonal matrices
mat4 mat4Inverse( in mat4 m ) {
    mat3 rotate_inv = mat3(	vec3( m[0][0], m[1][0], m[2][0] ),
                          	vec3( m[0][1], m[1][1], m[2][1] ),
                          	vec3( m[0][2], m[1][2], m[2][2] ) );
    
    return mat4(	vec4( rotate_inv[0], 0.0 ),
                	vec4( rotate_inv[1], 0.0 ),
                	vec4( rotate_inv[2], 0.0 ),
              		vec4( (-rotate_inv)*m[3].xyz, 1.0 ) );
}
      
struct SurfaceHitInfo {
    vec3 position_;
	vec3 normal_;
    vec3 tangent_;
    vec2 uv_;
    int mtl_id_;
};
    
#define SURFACE_ID_BASE	0
#define LIGHT_ID_BASE	64

#define MTL_LIGHT 		0
#define MTL_DIFFUSE		1
    

#define OBJ_PLANE		0
#define OBJ_SPHERE		1
#define OBJ_CYLINDER	2
#define OBJ_AABB		3
#define OBJ_DISK		4
#define OBJ_TORUS		5
    
struct Object {
    int type_;
    int mtl_id_;
    mat4 transform_;
    mat4 transform_inv_;
    
    float params_[6];
};

//Weighted sum of Lambertian and Blinn brdfs
struct Material {
    vec3 diffuse_color_;
    int diffuse_color_tex_;
    vec3 specular_color_;
    float specular_roughness_;
    int specular_roughness_tex_;
    float specular_weight_;
    int specular_weight_tex_;
    int normal_map_;
    float tex_scale_;
};
    
struct Light {
    vec3 color_;
    float intensity_;
};
    
struct Ray {
    vec3 origin;
    vec3 dir;
};
    
struct Camera {
    mat3 rotate;
    vec3 pos;
    float fovV;
    float lensSize;
    float focusDist;
    vec2 iPlaneSize;
};
    
struct LightSamplingRecord {
    vec3 w;
    float d;
    float pdf;
};
    
// ************ SCENE ***************
Light lights[2];
Material materials[7];
Object objects[8];
Camera camera;
Camera cameraOld;
//***********************************
#if __VERSION__ < 300
Material getMaterial(int i) {
    if(i==0) return materials[0]; else
        if(i==1) return materials[1]; else
            if(i==2) return materials[2]; else
                if(i==3) return materials[3]; else
                    if(i==4) return materials[4]; else
                        if(i==5) return materials[5]; else
                            return materials[6];
}

Light getLight(int i) {
    if(i==0) return lights[0]; else
        return lights[1];
    //return lights[i];
}
#else
Material getMaterial(int i) { return materials[i]; }
Light getLight(int i) { return lights[i]; }
#endif


vec3 getColor(vec2 uv, int tex) {
#ifdef TEXTURES
    if(tex==0)	return /*(int(mod((uv.x+uv.y)*10.0,2.0)) == 1)? vec3(0.05) : vec3(1.0);//*/texture( iChannel0, uv).xyz; else
    if(tex==1)	return texture( iChannel1, uv).xyz; else
    			return texture( iChannel2, uv).xyz;
#else
    if(tex==0)	return vec3(0.8, 0.5, 0.3);
    if(tex==1)	return vec3(0.5, 0.5, 0.6);
				return vec3(0.7, 0.7, 0.7);
#endif
}

#define GET_COLORS(smplr, idx) duv = vec2(1.0) / iChannelResolution[idx].xy; c = getColor(uv , smplr); c1 = getColor( uv + vec2(duv.x, 0.0), smplr); c2 = getColor(uv - vec2(duv.x, 0.0),  smplr); c3 = getColor(uv + vec2(0.0, duv.y), smplr); c4 = getColor(uv - vec2(0.0, duv.y), smplr);
vec3 getNormal(vec2 uv, int tex ) {
#ifdef NORMAL_MAPS
    float heightScale = 0.004;
    float dHdU, dHdV;
    
    float hpx, hmx, hpy, hmy, h0;
    vec3 c, c1, c2, c3, c4;
    vec2 duv;
    
#if __VERSION__ < 300
    if(tex==0){
        GET_COLORS(0, 0);
    } else if(tex==1) {
        GET_COLORS(1, 1);
    } else {
        GET_COLORS(2, 2);
    }
#else
    switch(tex){
        case 0: {GET_COLORS(0, 0);}
        case 1: {GET_COLORS(1, 1);}
        case 2: {GET_COLORS(2, 2);}
    }
#endif
    
    h0	= heightScale * dot(c , vec3(1.0/3.0));
    hpx = heightScale * dot(c1, vec3(1.0/3.0));
    hmx = heightScale * dot(c2, vec3(1.0/3.0));
    hpy = heightScale * dot(c3, vec3(1.0/3.0));
    hmy = heightScale * dot(c4, vec3(1.0/3.0));
    dHdU = (hmx - hpx) / (2.0 * duv.x);
    dHdV = (hmy - hpy) / (2.0 * duv.y);
    
    return normalize(vec3(dHdU, dHdV, 1.0));
#else
    return vec3(0.0, 0.0, 1.0);
#endif
}

vec3 getRadiance(vec2 uv) {
    return /*getColor(uv, 2)*lights[0].color_**/vec3(1.0, 1.0, 1.0)*lights[0].intensity_;
}

void createMaterial(vec3 diff,
                    int diff_tex,
                    vec3 spec,
                    float roughness,
                    int roughness_tex,
                   	float weight,
                    int weight_tex,
                    int normal_map,
                    float tex_scale,
                    out Material mtl) {
    mtl.diffuse_color_ = diff;
    mtl.diffuse_color_tex_ = diff_tex;
    mtl.specular_color_ = spec;
    mtl.specular_roughness_ = roughness;
    mtl.specular_roughness_tex_ = roughness_tex;
    mtl.specular_weight_ = weight;
    mtl.specular_weight_tex_ = weight_tex;
    mtl.normal_map_ = normal_map;
    mtl.tex_scale_ = tex_scale;
}

void createLight(vec3 color, float intensity, out Light light) {
    light.color_ = color;
    light.intensity_ = intensity;
}

void createAABB( mat4 transform, vec3 bound_min, vec3 bound_max, int mtl, out Object obj) {
    vec3 xAcis = normalize( vec3( 0.9, 0.0, 0.2 ) );
    vec3 yAcis = vec3( 0.0, 1.0, 0.0 );
    obj.type_ = OBJ_AABB;
    obj.mtl_id_ = mtl;
    obj.transform_ = transform;
    obj.transform_inv_ = mat4Inverse( obj.transform_ );
    obj.params_[0] = bound_min.x;
    obj.params_[1] = bound_min.y;
    obj.params_[2] = bound_min.z;
    obj.params_[3] = bound_max.x;
    obj.params_[4] = bound_max.y;
    obj.params_[5] = bound_max.z;
}

void createTorus( mat4 transform, float R, float r, int mtl, out Object obj) {
    vec3 xAcis = normalize( vec3( 0.9, 0.0, 0.2 ) );
    vec3 yAcis = vec3( 0.0, 1.0, 0.0 );
    obj.type_ = OBJ_TORUS;
    obj.mtl_id_ = mtl;
    obj.transform_ = transform;
    obj.transform_inv_ = mat4Inverse( obj.transform_ );
    obj.params_[0] = R*R;
    obj.params_[1] = r*r;
}

void createPlane(mat4 transform, float minX, float minY, float maxX, float maxY, int mtl, out Object obj) {
    obj.type_ = OBJ_PLANE;
    obj.mtl_id_ = mtl;
    obj.transform_ = transform;
    obj.transform_inv_ = mat4Inverse( obj.transform_ );
    obj.params_[0] = minX;			//min x
    obj.params_[1] = minY;			//min y
    obj.params_[2] = maxX;			//max x
    obj.params_[3] = maxY;			//max y
    obj.params_[4] = 0.0;		//not used
    obj.params_[5] = 0.0;		//not used
}

void createDisk(mat4 transform, float r, float R, int mtl, out Object obj) {
    obj.type_ = OBJ_DISK;
    obj.mtl_id_ = mtl;
    obj.transform_ = transform;
    obj.transform_inv_ = mat4Inverse( obj.transform_ );
    obj.params_[0] = r*r;
    obj.params_[1] = R*R;
}

void createSphere(mat4 transform, float r, int mtl, out Object obj) {
    obj.type_ = OBJ_SPHERE;
    obj.mtl_id_ = mtl;
    obj.transform_ = transform;
    obj.transform_inv_ = mat4Inverse( obj.transform_ );
    obj.params_[0] = r;			//radius
    obj.params_[1] = r*r;		//radius^2
    obj.params_[2] = 0.0;		//not used
    obj.params_[3] = 0.0;		//not used
    obj.params_[4] = 0.0;		//not used 
    obj.params_[5] = 0.0;		//not used
}

void createCylinder(mat4 transform, float r, float minZ, float maxZ, float maxTheta, int mtl, out Object obj) {
    obj.type_ = OBJ_CYLINDER;
    obj.mtl_id_ = mtl;
    obj.transform_ = transform;
    obj.transform_inv_ = mat4Inverse( obj.transform_ );
    obj.params_[0] = r;			//radius
    obj.params_[1] = minZ;		//min z
    obj.params_[2] = maxZ;		//max z
    obj.params_[3] = maxTheta;	//max phi
    obj.params_[4] = 0.0;		//not used
    obj.params_[5] = 0.0;		//not used
}

mat4 createCS(vec3 p, vec3 z, vec3 x) {
    z = normalize(z);
    vec3 y = normalize(cross(z,x));
    x = cross(y,z);
    
    return mat4(	vec4( x, 0.0 ), 
    			 	vec4( y, 0.0 ),
    				vec4( z, 0.0 ),
    				vec4( p, 1.0 ));
}

// Geometry functions ***********************************************************
vec2 radialSampleDisk(in vec2 xi) {
    float r = sqrt(1.0 - xi.x);
    float theta = xi.y*TWO_PI;
	return vec2(cos(theta), sin(theta))*r;
}

//https://pdfs.semanticscholar.org/4322/6a3916a85025acbb3a58c17f6dc0756b35ac.pdf
//https://github.com/mmp/pbrt-v3/blob/9f717d847a807793fa966cf0eaa366852efef167/src/core/sampling.cpp#L113
vec2 concentricSampleDisk(in vec2 xi) {
    // Map uniform random numbers to $[-1,1]^2$
    vec2 uOffset = 2. * xi - vec2(1, 1);

    // Handle degeneracy at the origin
    if (uOffset.x == 0.0 && uOffset.y == 0.0) return vec2(.0);

    // Apply concentric mapping to point
    float theta, r;
    if (abs(uOffset.x) > abs(uOffset.y)) {
        r = uOffset.x;
        theta = (PI/4.0) * (uOffset.y / uOffset.x);
    } else {
        r = uOffset.y;
        theta = (PI/2.0) - (PI/4.0) * (uOffset.x / uOffset.y);
    }
    return r * vec2(cos(theta), sin(theta));
}

vec2 uniformPointWithinCircle( in float radius, in vec2 xi ) {
    vec2 p;
#ifdef CONCENTRIC_DISK
    p = concentricSampleDisk(xi);
#else
    p = radialSampleDisk(xi);
#endif
    p *= radius;
    return p;
}

vec3 uniformDirectionWithinCone( in vec3 d, in float phi, in float sina, in float cosa ) {    
	vec3 w = normalize(d);
    vec3 u = normalize(cross(w.yzx, w));
    vec3 v = cross(w, u);
	return (u*cos(phi) + v*sin(phi)) * sina + w * cosa;
}

//taken from: https://www.shadertoy.com/view/4sSSW3
void basis(in vec3 n, out vec3 f, out vec3 r) {
    if(n.z < -0.999999) {
        f = vec3(0 , -1, 0);
        r = vec3(-1, 0, 0);
    } else {
    	float a = 1./(1. + n.z);
    	float b = -n.x*n.y*a;
    	f = vec3(1. - n.x*n.x*a, b, -n.x);
    	r = vec3(b, 1. - n.y*n.y*a , -n.y);
    }
}

mat3 mat3FromNormal(in vec3 n) {
    vec3 x;
    vec3 y;
    basis(n, x, y);
    return mat3(x,y,n);
}

vec3 l2w( in vec3 localDir, in vec3 normal ) {
    vec3 a,b;
    basis( normal, a, b );
	return localDir.x*a + localDir.y*b + localDir.z*normal;
}

void cartesianToSpherical( 	in vec3 xyz,
                         	out float rho,
                          	out float phi,
                          	out float theta ) {
    rho = sqrt((xyz.x * xyz.x) + (xyz.y * xyz.y) + (xyz.z * xyz.z));
    phi = asin(xyz.y / rho);
	theta = atan( xyz.z, xyz.x );
}

vec3 sphericalToCartesian( in float rho, in float phi, in float theta ) {
    float sinTheta = sin(theta);
    return vec3( sinTheta*cos(phi), sinTheta*sin(phi), cos(theta) )*rho;
}

vec3 sampleHemisphereCosWeighted(in vec2 xi) {
#ifdef CONCENTRIC_DISK
    vec2 xy = concentricSampleDisk(xi);
    float r2 = xy.x*xy.x + xy.y*xy.y;
    return vec3(xy, sqrt(max(0.0, 1.0 - r2)));
#else
    float theta = acos(sqrt(1.0-xi.x));
    float phi = TWO_PI * xi.y;
    return sphericalToCartesian( 1.0, phi, theta );
#endif
}

vec3 sampleHemisphereCosWeighted( in vec3 n, in vec2 xi ) {
    return l2w( sampleHemisphereCosWeighted( xi ), n );
}

vec3 randomDirection( in float Xi1, in float Xi2 ) {
    float theta = acos(1.0 - 2.0*Xi1);
    float phi = TWO_PI * Xi2;
    
    return sphericalToCartesian( 1.0, phi, theta );
}
//*****************************************************************************

// ************************   Scattering functions  *************************
bool sameHemisphere(in vec3 n, in vec3 a, in vec3 b){
	return ((dot(n,a)*dot(n,b))>0.0);
}

bool sameHemisphere(in vec3 a, in vec3 b){
	return (a.z*b.z>0.0);
}

float cosTheta(vec3 w) { return w.z; }
float cosTheta2(vec3 w) { return cosTheta(w)*cosTheta(w); }
float absCosTheta(vec3 w) { return abs(w.z); }
float sinTheta2(vec3 w) { return max(0.0, 1.0 - cosTheta2(w)); }
float sinTheta(vec3 w) { return sqrt(sinTheta2(w)); }
float tanTheta2(vec3 w) { return sinTheta2(w) / cosTheta2(w); }
float tanTheta(vec3 w) { return sinTheta(w) / cosTheta(w); }

float cosPhi(vec3 w) { float sin_Theta = sinTheta(w); return (sin_Theta == 0.0) ? 1.0 : clamp(w.x / sin_Theta, -1.0, 1.0); }
float sinPhi(vec3 w) { float sin_Theta = sinTheta(w); return (sin_Theta == 0.0) ? 0.0 : clamp(w.y / sin_Theta, -1.0, 1.0); }
float cosPhi2(vec3 w) { return cosPhi(w) * cosPhi(w); }
float sinPhi2(vec3 w) { return sinPhi(w) * sinPhi(w); }

float ggx_eval(vec3 wh, float alphax, float alphay) {
    float tan2Theta = tanTheta2(wh);
    if (is_inf(tan2Theta)) return 0.;
    float cos4Theta = cosTheta2(wh) * cosTheta2(wh);
    float e = ((cosPhi2(wh) + sinPhi2(wh)) / (alphax * alphay)) * tan2Theta;
    return 1.0 / (PI * (alphax * alphay) * cos4Theta * (1.0 + e) * (1.0 + e));
}

//Here we sample only visible normals, so it takes view direction wi
//Visible normal sampling was first presented here: https://hal.archives-ouvertes.fr/hal-01509746
//We use method which first converts everything is space where alpha is 1 
//does uniform sampling of visible hemisphere and converts sample back
//https://hal.archives-ouvertes.fr/hal-01509746
vec3 ggx_sample(vec3 wi, float alphax, float alphay, vec2 xi) {
    //stretch view
    vec3 v = normalize(vec3(wi.x * alphax, wi.y * alphay, wi.z));

    //orthonormal basis
    vec3 t1 = (v.z < 0.9999) ? normalize(cross(v, vec3(0.0, 0.0, 1.0))) : vec3(1.0, 0.0, 0.0);
    vec3 t2 = cross(t1, v);

    //sample point with polar coordinates
    float a = 1.0 / (1.0 + v.z);
    float r = sqrt(xi.x);
    float phi = (xi.y < a) ? xi.y / a*PI : PI + (xi.y - a) / (1.0 - a) * PI;
    float p1 = r*cos(phi);
    float p2 = r*sin(phi)*((xi.y < a) ? 1.0 : v.z);

    //compute normal
    vec3 n = p1*t1 + p2*t2 + v*sqrt(1.0 - p1*p1 - p2*p2);

    //unstretch
    return normalize(vec3(n.x * alphax, n.y * alphay, n.z));
}


float ggx_lambda(vec3 w, float alphax, float alphay) {
    float absTanTheta = abs(tanTheta(w));
    if (is_inf(absTanTheta)) return 0.;
    // Compute _alpha_ for direction _w_
    float alpha_ = sqrt((cosPhi2(w) + sinPhi2(w)) * (alphax * alphay));
    float alpha2Tan2Theta = (alpha_ * absTanTheta) * (alpha_ * absTanTheta);
    return (-1.0 + sqrt(1.0 + alpha2Tan2Theta)) / 2.0;
}

float ggx_g1(vec3 w, float alphax, float alphay) {
    return 1.0 / (1.0 + ggx_lambda(w, alphax, alphay));
}

float ggx_g(vec3 wo, vec3 wi, float alphax, float alphay) {
    return 1.0 / (1.0 + ggx_lambda(wo, alphax, alphay) + ggx_lambda(wi, alphax, alphay));
}

float ggx_pdf(vec3 wi, vec3 wh, float alphax, float alphay) {
    return ggx_eval(wh, alphax, alphay) * ggx_g1(wi, alphax, alphay) * abs(dot(wi, wh)) / abs(wi.z);
}

float SchlickFresnel(in float Rs, float cosTheta) {
    return Rs + pow(1.0 - cosTheta, 5.) * (1. - Rs);
}

vec3 mtlEval(Material mtl, in vec3 Ng, in vec3 Ns, in vec3 E, in vec3 L) {
    mat3 trans = mat3FromNormal(Ns);
    mat3 inv_trans = mat3Inverse( trans );
    
    vec3 E_local = inv_trans * E;
    vec3 L_local = inv_trans * L;
    
    float alpha = mtl.specular_roughness_;
    
    if(!sameHemisphere(E_local, L_local)) {
        return vec3(0.0);
    }
    
    //Specular reflection ***********************************
    float cosThetaO = abs(E_local.z), cosThetaI = abs(L_local.z);
    vec3 wh = L_local + E_local;
    // Handle degenerate cases for microfacet reflection
    if (cosThetaI == 0.0 || cosThetaO == 0.0) return vec3(0.);
    if (wh.x == 0.0 && wh.y == 0.0 && wh.z == 0.0) return vec3(0.);
    
    wh = normalize(wh);
    
    float F = SchlickFresnel(0.1, dot(L_local, wh));
    vec3 spec_Refl = 	mtl.specular_color_ * 
        				ggx_eval(wh, alpha, alpha) *
        				ggx_g(E_local, L_local, alpha, alpha) *
        				F / (4.0 * cosThetaI * cosThetaO);
    
    vec3 diff_refl = 	vec3(INV_PI) * 
        				mtl.diffuse_color_ * 
        				(vec3(1.0) - F);
    
    return 	mix(diff_refl, spec_Refl, mtl.specular_weight_);
}

float pdfDiffuse(in vec3 L_local) {
    return INV_PI * L_local.z;
}

float pdfSpecular(in float alphau, in float alphav, in vec3 E_local, in vec3 L_local) {
    vec3 wh = normalize(E_local + L_local);
    return ggx_pdf(E_local, wh, alphau, alphav) / (4.0 * dot(E_local, wh));
}

vec3 mtlSample(Material mtl, in vec3 Ng, in vec3 Ns, in vec3 E, in vec2 xi, out vec3 L, out float pdf, out float spec) {
    float alpha = mtl.specular_roughness_;
    mat3 trans = mat3FromNormal(Ns);
    mat3 inv_trans = mat3Inverse( trans );
    
    //convert directions to local space
    vec3 E_local = inv_trans * E;
    vec3 L_local;
    
    if (E_local.z == 0.0) return vec3(0.);
    
    //Sample specular or diffuse lobe based on fresnel
    if(rnd() < mtl.specular_weight_) {
    	vec3 wh = ggx_sample(E_local, alpha, alpha, xi);
        L_local = reflect(-E_local, wh);
        pdf = pdfSpecular(alpha, alpha, E_local, L_local);
    } else {
        L_local = sampleHemisphereCosWeighted( xi );
        pdf = pdfDiffuse(L_local);
    }
    
    //convert directions to global space
    L = trans*L_local;
    
    if(!sameHemisphere(Ns, E, L) || !sameHemisphere(Ng, E, L)) {
        pdf = 0.0;
    }
    
    return mtlEval(mtl, Ng, Ns, E, L);
}

float mtlPdf(Material mtl, in vec3 Ng, in vec3 Ns, in vec3 E, in vec3 L) {
    mat3 trans = mat3FromNormal(Ns);
    mat3 inv_trans = mat3Inverse( trans );
    float alpha = mtl.specular_roughness_;
    
    vec3 E_local = inv_trans * E;
    vec3 L_local = inv_trans * L;
    
    if(!sameHemisphere(Ng, E_local, L_local)) {
        return 0.0;
    }
    float diff_pdf = abs(L_local.z)*INV_PI;
    
    if (!sameHemisphere(E_local, L_local)) return 0.0;
    vec3 wh = normalize(E_local + L_local);
    float spec_pdf = ggx_pdf(E_local, wh, alpha, alpha) / (4.0 * dot(E_local, wh));
    
    return mix(diff_pdf, spec_pdf, mtl.specular_weight_);
}


// ************************  INTERSECTION FUNCTIONS **************************
bool solveQuadratic(float A, float B, float C, out float t0, out float t1) {
	float discrim = B*B-4.0*A*C;
    
	if ( discrim <= 0.0 )
        return false;
    
	float rootDiscrim = sqrt( discrim );
    
    float t_0 = (-B-rootDiscrim)/(2.0*A);
    float t_1 = (-B+rootDiscrim)/(2.0*A);
    
    t0 = min( t_0, t_1 );
    t1 = max( t_0, t_1 );
    
	return true;
}

bool rayAABBIntersection( in Ray ray, vec3 boxMin, vec3 boxMax, in bool forShadowTest, out float t, out SurfaceHitInfo isect ) {
    vec3 OMIN = ( boxMin - ray.origin ) / ray.dir;
    vec3 OMAX = ( boxMax - ray.origin ) / ray.dir;
    vec3 MAX = max ( OMAX, OMIN );
    vec3 MIN = min ( OMAX, OMIN );
    float t1 = min ( MAX.x, min ( MAX.y, MAX.z ) );
    t = max ( max ( MIN.x, 0.0 ), max ( MIN.y, MIN.z ) );
    
    if ( t1 <= t )
        return false;
    
    if( !forShadowTest ) {
        isect.position_ = ray.origin + ray.dir*t;
        
        if( EQUAL_FLT( isect.position_.x, boxMin.x, EPSILON ) ) {
            isect.normal_ =  vec3( -1.0, 0.0, 0.0 );
            isect.tangent_ 		= vec3( 0.0, 1.0, 0.0 );
            isect.uv_ = (isect.position_.yz - boxMin.yz)/(boxMax.yz - boxMin.yz);
        } else if( EQUAL_FLT( isect.position_.x, boxMax.x, EPSILON ) ) {
            isect.normal_ =  vec3( 1.0, 0.0, 0.0 );
            isect.tangent_ = vec3( 0.0, 1.0, 0.0 );
            isect.uv_ = (isect.position_.yz - boxMin.yz)/(boxMax.yz - boxMin.yz);
        } else if( EQUAL_FLT( isect.position_.y, boxMin.y, EPSILON ) ) {
            isect.normal_ =  vec3( 0.0, -1.0, 0.0 );
            isect.tangent_ = vec3( 1.0, 0.0, 0.0 );
            isect.uv_ = (isect.position_.xz - boxMin.xz)/(boxMax.xz - boxMin.xz);
        } else if( EQUAL_FLT( isect.position_.y, boxMax.y, EPSILON ) ) {
            isect.normal_ =  vec3( 0.0, 1.0, 0.0 );
            isect.tangent_ = vec3( 1.0, 0.0, 0.0 );
            isect.uv_ = (isect.position_.xz - boxMin.xz)/(boxMax.xz - boxMin.xz);
        } else if( EQUAL_FLT( isect.position_.z, boxMin.z, EPSILON ) ) {
            isect.normal_ =  vec3( 0.0, 0.0, -1.0 );
            isect.tangent_ = vec3( 1.0, 0.0, 0.0 );
            isect.uv_ = (isect.position_.xy - boxMin.xy)/(boxMax.xy - boxMin.xy);
        } else if( EQUAL_FLT( isect.position_.z, boxMax.z, EPSILON ) ) {
            isect.normal_ =  vec3( 0.0, 0.0, 1.0 );
            isect.tangent_ = vec3( 1.0, 0.0, 0.0 );
            isect.uv_ = (isect.position_.xy - boxMin.xy)/(boxMax.xy - boxMin.xy);
        }
        
        isect.uv_ /= 2.0;
    }
    
    return true;
}

bool raySphereIntersection( in Ray ray, in float radiusSquared, in bool forShadowTest, out float t, out SurfaceHitInfo isect ) {
    float t0, t1;
    vec3 L = ray.origin;
    float a = dot( ray.dir, ray.dir );
    float b = 2.0 * dot( ray.dir, L );
    float c = dot( L, L ) - radiusSquared;
    
    if (!solveQuadratic( a, b, c, t0, t1))
		return false;
    
    if( t0 > 0.0 ) {
    	t = t0;
    } else {
        if ( t1 > 0.0 ) {
            t = t1;
        } else {
            return false;
        }
    }
    
    if( !forShadowTest ) {
        isect.position_ = ray.origin + ray.dir*t;
        isect.normal_ = normalize( isect.position_ );

        float rho, phi, theta;
        cartesianToSpherical( isect.normal_, rho, phi, theta );
        isect.uv_.x = phi/PI;
        isect.uv_.y = theta/TWO_PI;

        isect.tangent_ = vec3( 0.0, 1.0, 0.0 );
        vec3 tmp = cross( isect.normal_, isect.tangent_ );
        isect.tangent_ = normalize( cross( tmp, isect.normal_ ) );
    }
	
	return true;
}

bool rayAAPlaneIntersection( in Ray ray, in float min_x, in float min_y, in float max_x, in float max_y, in bool forShadowTest, out float t, out SurfaceHitInfo isect ) {
    if ( IS_ZERO( ray.dir.z ) )
    	return false;
    
    t = ( -ray.origin.z ) / ray.dir.z;
    
    isect.position_ = ray.origin + ray.dir*t;
    
    if( (isect.position_.x < min_x) ||
       	(isect.position_.x > max_x) ||
      	(isect.position_.y < min_y) ||
      	(isect.position_.y > max_y) )
        return false;
    
    if( !forShadowTest ) {
        isect.uv_.x 		= (isect.position_.x - min_x)/(max_x - min_x);
        isect.uv_.y 		= (isect.position_.y - min_y)/(max_y - min_y);
        isect.normal_ 		= vec3( 0.0, 0.0, 1.0 );
        isect.tangent_ 		= vec3( 1.0, 0.0, 0.0 );
    }
    
    return true;
}

bool rayDiskIntersection( in Ray ray, in float r2, in float R2, in bool forShadowTest, out float t, out SurfaceHitInfo isect ) {
    if ( IS_ZERO( ray.dir.z ) )
    	return false;
    
    t = ( -ray.origin.z ) / ray.dir.z;
    
    isect.position_ = ray.origin + ray.dir*t;
    
    float d2 = dot(isect.position_, isect.position_);
    
    if( d2 < r2 || d2 > R2 )
        return false;
    
    if( !forShadowTest ) {
        float R = sqrt(R2);
        isect.uv_.x 		= (isect.position_.x - R)/(2.0*R);
        isect.uv_.y 		= (isect.position_.y - R)/(2.0*R);
        isect.normal_ 		= vec3( 0.0, 0.0, 1.0 );
        isect.tangent_ 		= vec3( 1.0, 0.0, 0.0 );
    }
    
    return true;
}

bool rayCylinderIntersection( in Ray r, in float radius, in float minZ, in float maxZ, in float maxPhi, in bool forShadowTest, out float t, out SurfaceHitInfo isect ) {
	float phi;
	vec3 phit;
    
	// Compute quadratic cylinder coefficients
	float a = r.dir.x*r.dir.x + r.dir.y*r.dir.y;
	float b = 2.0 * (r.dir.x*r.origin.x + r.dir.y*r.origin.y);
	float c = r.origin.x*r.origin.x + r.origin.y*r.origin.y - radius*radius;
 
	// Solve quadratic equation for _t_ values
	float t0, t1;
	if (!solveQuadratic( a, b, c, t0, t1))
		return false;

    if ( t1 < 0.0 )
        return false;
    
	t = t0;
    
	if (t0 < 0.0)
		t = t1;

	// Compute cylinder hit point and $\phi$
	phit = r.origin + r.dir*t;
	phi = atan(phit.y,phit.x);
    phi += PI;
    
	if (phi < 0.0)
        phi += TWO_PI;
 
	// Test cylinder intersection against clipping parameters
	if ( (phit.z < minZ) || (phit.z > maxZ) || (phi > maxPhi) ) {
		if (t == t1)
            return false;
		t = t1;
		// Compute cylinder hit point and $\phi$
		phit = r.origin + r.dir*t;
		phi = atan(phit.y,phit.x);
        phi += PI;

		if ( (phit.z < minZ) || (phit.z > maxZ) || (phi > maxPhi) )
			return false;
	}
    
    if( !forShadowTest ) {
        isect.position_ = phit;
        isect.uv_.x = (phit.z - minZ)/(maxZ - minZ);
        isect.uv_.y = phi/maxPhi;
        isect.normal_ = normalize( vec3( phit.xy, 0.0 ) );
        isect.tangent_ = vec3( 0.0, 0.0, 1.0 );
    }
    
	return true;
}

bool rayObjectIntersect( in Ray ray, in Object obj, in float distMin, in float distMax, in bool forShadowTest, out SurfaceHitInfo hit, out float dist ) {
    bool hitResult = false;
    float t;
    SurfaceHitInfo currentHit;

    //Convert ray to object space
    Ray rayLocal;
    rayLocal.origin = toVec3( obj.transform_inv_*vec4( ray.origin, 1.0 ) );
    rayLocal.dir 	= toVec3( obj.transform_inv_*vec4( ray.dir   , 0.0 ) );

    if( obj.type_ == OBJ_PLANE ) {
        hitResult = rayAAPlaneIntersection( rayLocal, obj.params_[0], obj.params_[1], obj.params_[2], obj.params_[3], forShadowTest, t, currentHit );
    } else if( obj.type_ == OBJ_SPHERE ) {
        hitResult = raySphereIntersection( 	rayLocal, obj.params_[1], forShadowTest, t, currentHit );
    } else if( obj.type_ == OBJ_CYLINDER ) {
        hitResult = rayCylinderIntersection(rayLocal, obj.params_[0], obj.params_[1], obj.params_[2], obj.params_[3], forShadowTest, t, currentHit );
    } else if( obj.type_ == OBJ_AABB ) {
        hitResult = rayAABBIntersection( rayLocal, vec3(obj.params_[0], obj.params_[1], obj.params_[2]), vec3(obj.params_[3], obj.params_[4], obj.params_[5]), forShadowTest, t, currentHit );
    } else if( obj.type_ == OBJ_DISK ) {
        hitResult = rayDiskIntersection( rayLocal, obj.params_[0], obj.params_[1], forShadowTest, t, currentHit );
    }

    if( hitResult && ( t > distMin ) && ( t < distMax ) ) {
        //Convert results to world space
        currentHit.position_ = toVec3( obj.transform_*vec4( currentHit.position_, 1.0 ) );
        currentHit.normal_   = toVec3( obj.transform_*vec4( currentHit.normal_  , 0.0 ) );
        currentHit.tangent_  = toVec3( obj.transform_*vec4( currentHit.tangent_ , 0.0 ) );

        dist = t;
        hit = currentHit;
        hit.mtl_id_ = obj.mtl_id_;
        
        return true;
    } else {
    	return false;
    }
}

#define CHECK_OBJ( obj ) { SurfaceHitInfo currentHit; float currDist; if( rayObjectIntersect( ray, obj, distMin, nearestDist, forShadowTest, currentHit, currDist ) && ( currDist < nearestDist ) ) { nearestDist = currDist; hit = currentHit; } }
bool raySceneIntersection( in Ray ray, in float distMin, in bool forShadowTest, out SurfaceHitInfo hit, out float nearestDist ) {
    nearestDist = 10000.0;
    
    for(int i=0; i<8; i++ ) {
        CHECK_OBJ( objects[i] );
    }
    return ( nearestDist < 1000.0 );
}
// ***************************************************************************


void initScene() {
    float time = 100.0;//iTime;
    
    //create lights
    createLight(vec3(1.0, 1.0, 0.9), 40.0, lights[0]);
    
    //Create materials
    createMaterial(vec3(0.6, 1.0, 0.6), -1, vec3(0.5, 1.0, 0.5), 0.15, -1, 0.6, -1, 2, 1.0, materials[0]);
    createMaterial(vec3(1.0, 1.0, 1.0), 0, vec3(1.0, 1.0, 1.0), 0.0, 0, 0.2, -1, 0, 2.0, materials[1]);
    createMaterial(vec3(0.3, 0.5, 1.0), 1, vec3(1.0, 1.0, 1.0), 0.0, 1, 0.4, 1, 1, 1.0, materials[2]);
    createMaterial(vec3(0.5, 0.5, 0.5), -1, vec3(0.9, 0.9, 1.0), 0.03, 2, 1.0, -1, -1, 1.0, materials[3]);
    createMaterial(vec3(1.0, 1.0, 1.0), 2, vec3(1.0, 1.0, 1.0), 0.0, 2, 0.4, 2, 2, 1.0, materials[4]);
    
    //init lights
    float r = 1.0;
    float xFactor = (iMouse.x==0.0)?0.0:2.0*(iMouse.x/iResolution.x) - 1.0;
    float yFactor = (iMouse.y==0.0)?0.0:2.0*(iMouse.y/iResolution.y) - 1.0;
    float x = xFactor*7.0;
    float z = -3.0-yFactor*5.0;
    float a = -1.2+sin(time*0.23);
    mat4 trans = createCS(	vec3(x, 5.0+sin(time), z),
                          	vec3(0.0, sin(a), cos(a)),
                  			vec3(1.0, 0.0, 0.0));
#ifdef SPHERE_LIGHT
    createSphere(trans, r, LIGHT_ID_BASE+0, objects[0] );
#else
    createPlane(trans, -2.0, -1.0, 2.0, 1.0, LIGHT_ID_BASE+0, objects[0]);
#endif
    
    
    //plane 1
    trans = mat4(	vec4( 1.0, 0.0, 0.0, 0.0 ),
                    vec4( 0.0, 1.0, 0.0, 0.0 ),
                    vec4( 0.0, 0.0, 1.0, 0.0 ),
                    vec4( 0.0, 5.0, -10.0, 1.0 ));
    createPlane(trans, -10.0, -2.0, 10.0, 4.0, SURFACE_ID_BASE+1, objects[1]);
   
    //plane 2
    trans = mat4(	vec4( 1.0, 0.0, 0.0, 0.0 ),
                    vec4( 0.0, 0.0, -1.0, 0.0 ),
                    vec4( 0.0, -1.0, 0.0, 0.0 ),
                    vec4( 0.0, -1.0, -4.0, 1.0 ));
    createPlane(trans, -10.0, -4.0, 10.0, 2.0, SURFACE_ID_BASE+1, objects[2]);
 
    //Cylinder
    trans = mat4(	vec4( 0.0, 1.0, 0.0, 0.0 ),
                    vec4( 0.0, 0.0, 1.0, 0.0 ),
                    vec4( 1.0, 0.0, 0.0, 0.0 ),
                    vec4( -0.0, 3.0, -6.0, 1.0 ));
    createCylinder(trans, 4.0, -10.0, 10.0, PI/2.0, SURFACE_ID_BASE+1, objects[3] );
    
    //sphere 1
    trans = mat4( 	vec4( 1.0, 0.0, 0.0, 0.0 ),
                    vec4( 0.0, 1.0, 0.0, 0.0 ),
                    vec4( 0.0, 0.0, 1.0, 0.0 ),
                    vec4( 1.5, -0.3, -2.0, 1.0 ));

    createSphere(trans, 0.7, SURFACE_ID_BASE+2, objects[4] );
    
    //sphere 2
    trans = mat4( 	vec4( 1.0, 0.0, 0.0, 0.0 ),
                    vec4( 0.0, 1.0, 0.0, 0.0 ),
                    vec4( 0.0, 0.0, 1.0, 0.0 ),
                    vec4( 0.0, 0.0, -4.5, 1.0 ));

    createSphere(trans, 1.0, SURFACE_ID_BASE+3, objects[5] );
    
    //box
    trans = createCS(	vec3(-1.5, -1.0, -3.0),
                     	vec3(0.0, 1.0, 0.0),
                     	vec3(0.2, 0.0, -0.7));
    createAABB( trans, -vec3(0.5, 0.5, 0.0), vec3(0.5, 0.5, 2.5), SURFACE_ID_BASE+0, objects[6]);
    
    trans = mat4( 	vec4( 1.0, 0.0, 0.0, 0.0 ),
                    vec4( 0.0, 1.0, 0.0, 0.0 ),
                    vec4( 0.0, 0.0, 1.0, 0.0 ),
                    vec4( 3.5, 0.5, -4.2, 1.0 ));

    createSphere(trans, 1.5, SURFACE_ID_BASE+4, objects[7] );
    /*
    //torus
    trans = createCS(	vec3(3.0, 1.0, -4.0),
                        vec3(-0.5, 0.0, 0.5),
                  	    vec3(1.0, 0.0, 0.0));
    createTorus(trans, 1.5, 0.3, SURFACE_ID_BASE+4, objects[7]);*/
}

///////////////////////////////////////////////////////////////////////
void initCamera( 	in vec3 pos,
                	in vec3 target,
                	in float fovV,
                	in float radius,
                	in float focus_dist,
                	out Camera c
               ) {
    const vec3 upDir = vec3( 0.0, 1.0, 0.0 );
    c.rotate[2] = normalize( pos-target ); //back
	c.rotate[0] = normalize( cross( upDir, c.rotate[2] ) ); //right
	c.rotate[1] = cross( c.rotate[2], c.rotate[0] ); //up
    c.fovV = fovV;
    c.pos = pos;
    c.focusDist = focus_dist;
    c.lensSize = radius;
    c.iPlaneSize = 2.*tan(0.5*c.fovV)*vec2(iResolution.x/iResolution.y,1.);
}


Ray genRay( in Camera c, in vec2 uv, in vec2 xi ) {
    Ray ray;
    
    vec2 ixy = (uv-0.5)*c.iPlaneSize;
	vec3 dirLocal = normalize(vec3(ixy, -1.0));
    vec3 posGlobal = c.pos;//cs_.posToGlobal(vec3(0.0));
	vec3 dirGlobal = c.rotate*dirLocal;
	return Ray(posGlobal, dirGlobal);

    /*
	vec2 ixy = (uv - 0.5) * c.iPlaneSize;
    
    if( c.lensSize > EPSILON ) {
        vec2 uv = uniformPointWithinCircle( c.lensSize, xi );
        vec3 newPos = c.pos + c.rotate[0]*uv.x*c.lensSize + c.rotate[1]*uv.y*c.lensSize;
        vec3 focusPoint = c.pos - c.focusDist*c.rotate[2];
        vec3 newBack = normalize(newPos - focusPoint);
        vec3 newRight = normalize( cross( c.rotate[1], newBack ) );
        vec3 newUp = cross( newBack, newRight );
        mat3 newRotate;
        newRotate[0] = newRight;
        newRotate[1] = newUp;
        newRotate[2] = newBack;


        ray.origin = newPos;
        ray.dir = newRotate*normalize(vec3(ixy.x,ixy.y,-1.0));
    } else {
        ray.origin = c.pos;
        ray.dir = c.rotate*normalize(vec3(ixy.x,ixy.y,-1.0));
    }

	return ray;*/
}

vec2 getPixel(in Camera c, in vec3 pos) {
    vec3 posLocal = inverse(c.rotate) * (pos - c.pos);
    vec3 dirLocal = normalize(posLocal);

    vec2 uv = -vec2(dirLocal.x / dirLocal.z, dirLocal.y / dirLocal.z);

    //convert uv from [-iPlaneSize*0.5, iPlaneSize.x*0.5) range to [0.0, 1.0)
    uv = (uv + c.iPlaneSize*0.5) / c.iPlaneSize;
    uv -= vec2(0.5) / iResolution.xy;//fix for half pixel shift 
    return uv;
}

#ifdef SPHERE_LIGHT
vec3 sampleLightSource( 	in vec3 x,
                          	float Xi1, float Xi2,
                          	out LightSamplingRecord sampleRec ) {
    float sph_r2 = objects[0].params_[1];
    vec3 sph_p = toVec3( objects[0].transform_*vec4(vec3(0.0,0.0,0.0), 1.0) );
    
    vec3 w = sph_p - x;			//direction to light center
	float dc_2 = dot(w, w);		//squared distance to light center
    float dc = sqrt(dc_2);		//distance to light center
    
    
    float sin_theta_max_2 = sph_r2 / dc_2;
	float cos_theta_max = sqrt( 1.0 - clamp( sin_theta_max_2, 0.0, 1.0 ) );
    float cos_theta = mix( cos_theta_max, 1.0, Xi1 );
    float sin_theta_2 = 1.0 - cos_theta*cos_theta;
    float sin_theta = sqrt(sin_theta_2);
    sampleRec.w = uniformDirectionWithinCone( w, TWO_PI*Xi2, sin_theta, cos_theta );
    sampleRec.pdf = 1.0/( TWO_PI * (1.0 - cos_theta_max) );
        
    //Calculate intersection distance
	//http://ompf2.com/viewtopic.php?f=3&t=1914
    sampleRec.d = dc*cos_theta - sqrt(sph_r2 - dc_2*sin_theta_2);
    
    return lights[0].color_*lights[0].intensity_;
}

float sampleLightSourcePdf( in vec3 x,
                            in vec3 wi,
                           	in float d,
                            in float cosAtLight ) {
    float sph_r2 = objects[0].params_[1];
    vec3 sph_p = toVec3( objects[0].transform_*vec4(vec3(0.0,0.0,0.0), 1.0) );
    float solidangle;
    vec3 w = sph_p - x;			//direction to light center
	float dc_2 = dot(w, w);		//squared distance to light center
    float dc = sqrt(dc_2);		//distance to light center
    
    if( dc_2 > sph_r2 ) {
    	float sin_theta_max_2 = clamp( sph_r2 / dc_2, 0.0, 1.0);
		float cos_theta_max = sqrt( 1.0 - sin_theta_max_2 );
    	solidangle = TWO_PI * (1.0 - cos_theta_max);
    } else { 
    	solidangle = FOUR_PI;
    }
    
    return 1.0/solidangle;
}
#else
vec3 sampleLightSource(		in vec3 x,
                          	float Xi1, float Xi2,
                       out LightSamplingRecord sampleRec) {
    float min_x = objects[0].params_[0];			//min x
    float min_y = objects[0].params_[1];			//min y
    float max_x = objects[0].params_[2];			//max x
    float max_y = objects[0].params_[3];			//max y
    float dim_x = max_x - min_x;
    float dim_y = max_y - min_y;
    vec3 p_local = vec3(min_x + dim_x*Xi1, min_y + dim_y*Xi2, 0.0);
    vec3 n_local = vec3(0.0, 0.0, 1.0);
    vec3 p_global = toVec3( objects[0].transform_*vec4(p_local, 1.0) );
    vec3 n_global = toVec3( objects[0].transform_*vec4(n_local, 0.0) );
    
    float pdfA = 1.0 / (dim_x*dim_y);
    sampleRec.w = p_global - x;
    sampleRec.d = length(sampleRec.w);
    sampleRec.w = normalize(sampleRec.w);
    float cosAtLight = dot(n_global, -sampleRec.w);
    vec3 L = cosAtLight>0.0?getRadiance(vec2(Xi1,Xi2)):vec3(0.0);
    sampleRec.pdf = PdfAtoW(pdfA, sampleRec.d*sampleRec.d, cosAtLight);
    
	return L;
}

float sampleLightSourcePdf( in vec3 x,
                               in vec3 wi,
                             	float d,
                              	float cosAtLight
                             ) {
    float min_x = objects[0].params_[0];			//min x
    float min_y = objects[0].params_[1];			//min y
    float max_x = objects[0].params_[2];			//max x
    float max_y = objects[0].params_[3];			//max y
    float dim_x = max_x - min_x;
    float dim_y = max_y - min_y;
    float pdfA = 1.0 / (dim_x*dim_y);
    return PdfAtoW(pdfA, d*d, cosAtLight);
}
#endif

bool isLightVisible( Ray shadowRay ) {
    float distToHit;
    SurfaceHitInfo tmpHit;
    
    raySceneIntersection( shadowRay, EPSILON, true, tmpHit, distToHit );
    
    return ( tmpHit.mtl_id_ >= LIGHT_ID_BASE );
}

bool isVisible(in vec3 from, in vec3 to) {
    vec3 d = to - from;
    float l = length(d);
    d /= l;
    
    float distToHit;
    SurfaceHitInfo tmpHit;
    
    bool hit = raySceneIntersection( Ray(from, d), EPSILON, true, tmpHit, distToHit );
    
    return (!hit || distToHit > l);
}

Light pickOneLight(out float lightPickingPdf) {
    lightPickingPdf = 1.0;
    return lights[0];
}

void fixMtl(inout Material mtl, vec2 uv, out vec3 ns) {
    uv *= mtl.tex_scale_;
    if(mtl.diffuse_color_tex_!=-1){
        mtl.diffuse_color_ = getColor(uv, mtl.diffuse_color_tex_);
    }
    
    if(mtl.specular_roughness_tex_!=-1){
        mtl.specular_roughness_ = (1.0 - sqrt(getColor(uv, mtl.specular_roughness_tex_).x))*0.8;
    } else {
        mtl.specular_roughness_ = sqrt(mtl.specular_roughness_);
    }
    
    if(mtl.specular_weight_tex_!=-1){
        mtl.specular_weight_ = (getColor(uv, mtl.specular_weight_tex_).x)*0.6;
    }
    if(mtl.normal_map_!=-1){
        ns = getNormal(uv, mtl.normal_map_ );
    } else {
        ns = vec3(0.0, 0.0, 1.0);
    }
}

vec3 sampleBSDF(	in vec3 x,
                  	in vec3 ng,
                  	in vec3 ns,
                	in vec3 wi,
                  	in Material mtl,
                  	in bool useMIS,
                  	in int strataCount,
                  	in int strataIndex,
                	out vec3 wo,
                	out float brdfPdfW,
                	out vec3 fr,
                	out bool hitRes,
                	out SurfaceHitInfo hit,
               		out float spec) {
    float strataSize = 1.0 / float(strataCount);
    vec3 Lo = vec3(0.0);
    for(int i=0; i<DL_SAMPLES; i++){
        vec2 xi = vec2(rnd(), strataSize * (float(strataIndex) + rnd()));
        fr = mtlSample(mtl, ng, ns, wi, xi, wo, brdfPdfW, spec);
        
        //fr = eval(mtl, ng, ns, wi, wo);

        float dotNWo = dot(wo, ns);
        //Continue if sampled direction is under surface
        if ((dot(fr,fr)>0.0) && (brdfPdfW > EPSILON)) {
            Ray shadowRay = Ray(x, wo);

            //abstractLight* pLight = 0;
            float cosAtLight = 1.0;
            float distanceToLight = -1.0;
            vec3 Li = vec3(0.0);

            {
                float distToHit;

                if(raySceneIntersection( shadowRay, EPSILON, false, hit, distToHit )) {
                    if(hit.mtl_id_>=LIGHT_ID_BASE) {
                        distanceToLight = distToHit;
                        cosAtLight = dot(hit.normal_, -wo);
                        if(cosAtLight > 0.0) {
                            Li = getRadiance(hit.uv_);
                            //Li = lights[0].color_*lights[0].intensity_;
                        }
                    } else {
                        hitRes = true;
                    }
                } else {
                    hitRes = false;
                    //TODO check for infinite lights
                }
            }

            if (distanceToLight>0.0) {
                if (cosAtLight > 0.0) {
                    vec3 contribution = (Li * fr * dotNWo) / brdfPdfW;

                    if (useMIS/* && !(mtl->isSingular())*/) {
                        float lightPickPdf = 1.0;//lightPickingPdf(x, n);
                        float lightPdfW = sampleLightSourcePdf( x, wi, distanceToLight, cosAtLight );
                        //float lightPdfW = sphericalLightSamplingPdf( x, wi );//pLight->pdfIlluminate(x, wo, distanceToLight, cosAtLight) * lightPickPdf;

                        contribution *= misWeight(brdfPdfW, lightPdfW);
                    }

                    Lo += contribution;
                }
            }
        }
    }

    return Lo*(1.0/float(DL_SAMPLES));
}

vec3 salmpleLight(	in vec3 x,
                  	in vec3 ng,
                  	in vec3 ns,
                  	in vec3 wi,
                  	in Material mtl,
                  	in bool useMIS,
                  	in int strataCount,
                  	in int strataIndex ) {
    vec3 Lo = vec3(0.0);	//outgoing radiance

    for(int i=0; i<DL_SAMPLES; i++) {
        float lightPickingPdf;
        Light light = pickOneLight(lightPickingPdf);

        vec3 wo;
        float lightPdfW, lightDist;

        LightSamplingRecord rec;
        float Xi1 = rnd();
        float Xi2 = rnd();
        float strataSize = 1.0 / float(strataCount);
        Xi2 = strataSize * (float(strataIndex) + Xi2);

        vec3 Li = sampleLightSource( x, Xi1, Xi2, rec );
        //vec3 Li = sampleSphericalLight( x, Xi1, Xi2, rec );
        wo = rec.w;
        lightPdfW = rec.pdf;
        lightDist = rec.d;
        lightPdfW *= lightPickingPdf;

        float dotNWo = dot(wo, ns);

        if ((dot(wo, ng) > 0.0) && (dotNWo > 0.0) && (lightPdfW > EPSILON)) {
            vec3 fr = mtlEval(mtl, ng, ns, wi, wo);
            if(dot(fr,fr)>0.0) {
                Ray shadowRay = Ray(x, wo);
                if (isLightVisible( shadowRay )) {
                    vec3 contribution = (Li * fr * dotNWo) / lightPdfW;

                    if (useMIS /*&& !(light->isSingular())*/) {
                        float brdfPdfW = mtlPdf(mtl, ng, ns, wi, wo);
                        contribution *= misWeight(lightPdfW, brdfPdfW);
                    }

                    Lo += contribution;
                }
            }
        }
    }

    return Lo*(1.0/float(DL_SAMPLES));
}

vec3 Radiance( in Ray r, int strataCount, int strataIndex ) {
    vec3 Lo = vec3(0.0), fr, directLight, pathWeight = vec3(1.0, 1.0, 1.0);
    vec3 wo;
    float woPdf;
    float dotWoN;
    bool hitResult;

    //Calculate first intersections to determine first scattering event
    Ray ray = r;
    SurfaceHitInfo event;
    SurfaceHitInfo nextEvent;
    float dist = -1.0;
    if(!raySceneIntersection( ray, 0.0, false, event, dist )) {
        return Lo;
    } else {
        //We have to add emmision component on first hit
        if( event.mtl_id_ >= LIGHT_ID_BASE ) {
            Light light = getLight(event.mtl_id_ - LIGHT_ID_BASE);
            float cosAtLight = dot(event.normal_, -ray.dir);
            if(cosAtLight > 0.0) {
                Lo = getRadiance(event.uv_);
                //Lo = light.color_*light.intensity_;
            }
        }
    }
    
    float prev_spec;

    for (int i = 0; i < MAX_DEPTH; i++) {
        if(event.mtl_id_>=LIGHT_ID_BASE){
        	break;
    	}
        
        vec3 x = event.position_;
        vec3 wi = -ray.dir;
        if(dot(wi, event.normal_) < 0.0) {
            event.normal_ *= -1.0;
        }
        
        Material mtl = getMaterial(event.mtl_id_);
    	vec3 ng = event.normal_, ns;
    	fixMtl(mtl, event.uv_, ns);
    
        mat3 frame;
        frame[0] = event.tangent_;
        frame[1] = cross( ng, event.tangent_ );
        frame[2] = ng;
        ns = frame*ns;
        
        if (dot(wi,ns) < 0.0) { break; }
        
        if(i!=0) {
            strataCount = 1; strataIndex = 0;
        }
        
        float spec;

        //Calculate direct light with 'Light sampling' and 'BSDF sampling' techniques
        //Both techniques are weighted with MIS.
        //see page 252 "glossy highlights from area light sources" in Eric Veachs thesis
		//https://graphics.stanford.edu/papers/veach_thesis/thesis-bw.pdf
        //In addition BSDF sampling determines next hit event where we want to continue path
       	directLight  = salmpleLight (x, ng, ns, wi, mtl, true, strataCount, strataIndex);
        directLight += sampleBSDF   (x, ng, ns, wi, mtl, true, strataCount, strataIndex, wo, woPdf, fr, hitResult, nextEvent, spec);
       
#ifdef CLAMP_CAUSTICS
        if(i!=0) {
            if(prev_spec < spec) {
                break;
            }
        }
        prev_spec = spec;
#endif
        if(pathWeight.x > 1.0 || pathWeight.y > 1.0 || pathWeight.z > 1.0)
            break;
        
        Lo += directLight*pathWeight; 

        if (!hitResult || (dotWoN = dot(event.normal_, wo))<0.0) { break; }
        if (woPdf == 0.0) { break; }
        pathWeight *= fr*dotWoN / woPdf;

        //Update values for next iteration
        ray = Ray(event.position_, wo);
        event = nextEvent;
    }

    return Lo;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    seed = iTime + iResolution.y * fragCoord.x / iResolution.x + fragCoord.y / iResolution.y;
    float fov = radians(40.0);
    
    vec3 camera_pos = (iFrame == 0)? vec3( 0.3, 3.0,  4.8 ) : LoadVec4(camera_pos_uv).xyz;
    vec3 camera_dir = (iFrame == 0)? vec3( 1.0, 0.4, -5.0 ) : LoadVec4(camera_dir_uv).xyz;
    
    initCamera(camera_pos, camera_dir, fov, LENS_SIZE, 9.2, cameraOld);
    
    
    if(iMouse.w > 0.0) {
        //slider
        const vec2 slider_pos = vec2(30.0, 30.0);
        const float slider_size = 200.0;
    	const float slider_width = 8.0;
        
        if (iMouse.x > slider_pos.x &&
            iMouse.x < slider_pos.x + slider_size &&
            iMouse.y > slider_pos.y - slider_width &&
            iMouse.y < slider_pos.y + slider_width ) {
        	float slider = (iMouse.x - slider_pos.x) / slider_size;
            
            slider -= 0.5; //(-0.5, 0.5)
            
            camera_pos += vec3(1.0, 0.0, 0.0) * slider * 0.3;
        }
    }
    
    initCamera(camera_pos, camera_dir, fov, LENS_SIZE, 9.2, camera);
    initScene();

    vec3 accumulatedColor = vec3( 0.0 );
    float oneOverSPP = 1.0/float(PIXEL_SAMPLES);
    float strataSize = oneOverSPP;

    for( int si=0; si<PIXEL_SAMPLES; ++si ){
        vec2 uv = (fragCoord.xy + vec2( strataSize*( float(si) + rnd() ), rnd() )) / iResolution.xy;
        Ray ray = genRay( camera, uv, vec2(rnd(), rnd()) );

        vec3 Li = Radiance( ray, PIXEL_SAMPLES, si );
        accumulatedColor += clamp(Li, vec3(.0), vec3(CLAMP_VALUE));
    }
    accumulatedColor = accumulatedColor*oneOverSPP;

    vec3 col_acc;
    vec2 coord = floor(fragCoord.xy);
    if(all(equal(coord.xy, acc_start_uv))) {
        col_acc = vec3(getAccStart());
    } else if(all(equal(coord.xy, camera_pos_uv))) {//camera_pos_uv
        col_acc = camera_pos;
    } else if(all(equal(coord.xy, camera_dir_uv))) {//camera_pos_uv
        col_acc = camera_dir;
    } else {
        if(iFrame == 0) {
            col_acc = accumulatedColor;
        } else {
            int frame_start = getAccStart();//int(texture( iChannel3, vec2(0.5, 0.5) / iResolution.xy ).x);
            int spp1 = iMouse.z > 0.0 ? 0 : iFrame - frame_start;
            int spp2 = 1;
            vec3 col_new = accumulatedColor;
            col_acc = texture( iChannel3, fragCoord/iResolution.xy ).xyz;
            col_acc = mix(col_acc, col_new, float(spp2)/float(spp1+spp2));
        }
    }
    
    fragColor = vec4( col_acc, 1.0 );
}