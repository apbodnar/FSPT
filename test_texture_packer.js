/**
 * Created by adam on 6/26/17.
 */

let urlList = ["texture/wood.png", "texture/wood.jpg", "texture/stone.jpg", "texture/hand.png"];

function createFlatTexture(color){
  let canvas = document.createElement('canvas');
  canvas.naturalWidth = canvas.naturalHeight = canvas.width = canvas.height = 1;
  let ctx = canvas.getContext('2d');
  ctx.fillStyle = "rgb("+
    parseInt(color[0]*255)+","+
    parseInt(color[1]*255)+","+
    parseInt(color[2]*255)+")";
  ctx.fillRect( 0, 0, 1, 1 );
  return canvas;
}


loadAll(urlList, function(assets){
  let canvas = document.getElementById('trace');
  canvas.width = canvas.height = 2048;
  let ctx = canvas.getContext('2d');
  let packer = new TexturePacker(2048);
  console.log(packer.addTexture(assets["texture/wood.png"]),
  packer.addTexture(assets["texture/wood.png"]),
  packer.addTexture(assets["texture/wood.png"]),
  packer.addTexture(assets["texture/hand.png"]),
  packer.addTexture(createFlatTexture([1,0,0])),
  packer.addTexture(assets["texture/stone.jpg"]));
  ctx.drawImage(packer.canvas, 0 ,0);
});