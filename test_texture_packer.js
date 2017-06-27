/**
 * Created by adam on 6/26/17.
 */

let urlList = ["texture/wood.png", "texture/wood.jpg"];

loadAll(urlList, function(assets){
  let canvas = document.getElementById('trace');
  canvas.width = canvas.height = 4096;
  let ctx = canvas.getContext('2d');
  let packer = new TexturePacker(4096);
  console.log(packer.addTexture(assets["texture/wood.png"]),
  packer.addTexture(assets["texture/wood.png"]),
  packer.addTexture(assets["texture/wood.png"]),
  packer.addTexture(assets["texture/wood.png"]),
  packer.addTexture(assets["texture/wood.png"]),
  packer.addTexture(assets["texture/wood.jpg"]));
  ctx.drawImage(packer.canvas, 0 ,0);
});