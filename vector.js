/**
 * Created by adam on 4/21/17.
 */

function magnitude(v){
  return Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2])
}

function normalize(v){
  var m = magnitude(v);
  return scale(v, 1/m);
}

function scale(v, s){
  return [v[0]*s, v[1]*s, v[2]*s];
}

function add(v1, v2){
  return [v1[0]+v2[0],v1[1]+v2[1],v1[2]+v2[2]];
}

function sub(v1, v2){
  return [v1[0]-v2[0],v1[1]-v2[1],v1[2]-v2[2]];
}

function inverse(v){
  return [1.0/v[0], 1.0/v[1], 1.0/v[2]];
}

function dot(v1, v2){
  return v1[0]*v2[0]+v1[1]*v2[1]+v1[2]*v2[2];
}

function rotateX(v, a){
  var x = v[0],
    y = v[1],
    z = v[2];
  var x1 = x,
    y1 = z*Math.sin(a) + y*Math.cos(a),
    z1 = z*Math.cos(a) - y*Math.sin(a);
  return [x1,y1,z1];
}

function rotateY(v, a){
  var x = v[0],
    y = v[1],
    z = v[2];
  var y1 = y,
    x1 = z*Math.sin(a) + x*Math.cos(a),
    z1 = z*Math.cos(a) - x*Math.sin(a);
  return [x1,y1,z1];
}

function rotateZ(v, a){
  var x = v[0],
    y = v[1],
    z = v[2];
  var z1 = z,
    x1 = y*Math.sin(a) + x*Math.cos(a),
    y1 = y*Math.cos(a) - x*Math.sin(a);
  return [x1,y1,z1];
}

function rotateArbitrary(v, axis, angle){

}

function matVecMultiply(vec, mat){
  var res = [];
  for(var i=0; i<3; i++){
    var row = [mat[3*i], mat[3*i+1], mat[3*i+2]];
    res.push(dot(row, vec));
  }
  return res;
}

function cross(v1, v2){
  var x = v1[1] * v2[2] - v1[2] * v2[1],
    y = -(v1[0] * v2[2] - v1[2] * v2[0]),
    z = v1[0] * v2[1] - v1[1] * v2[0];
  return [x, y, z];
}