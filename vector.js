/**
 * Created by adam on 4/21/17.
 */

function magnitude(v){
  return Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2])
}

function normalize(v){
  var m = magnitude(v)
  return scale(v, 1/m);
}

function scale(v, s){
  return [v[0]*s, v[1]*s, v[2]*s]
}

function add(v1, v2){
  return [v1[0]+v2[0],v1[1]+v2[1],v1[2]+v2[2]]
}

function sub(v1, v2){
  return [v1[0]-v2[0],v1[1]-v2[1],v1[2]-v2[2]]
}

function inverse(v){
  return [1.0/v[0], 1.0/v[1], 1.0/v[2]]
}

function dot(v1, v2){
  return v1[0]*v2[0]+v1[1]*v2[1]+v1[2]*v2[2]
}

function cross(v1, v2){
  var x = v1[1] * v2[2] - v1[2] * v2[1],
    y = -(v1[0] * v2[2] - v1[2] * v2[0]),
    z = v1[0] * v2[1] - v1[1] * v2[0];
  return [x, y, z]
}