/**
 * Created by adam on 6/26/17.
 */

export class TexturePacker {
  constructor(atlasRes, numTextures){
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = atlasRes;
    this.ctx = this.canvas.getContext('2d');
    this.res = atlasRes;
    this.imageSet = [];
    this.imageKeys = {};
    this.ctx.scale(1,-1);
    this.ctx.fillStyle = "rgba(0,0,0,0)";
    this.maxRes = 0;
  }

  addTexture(image){
    if (this.imageKeys[image.currentSrc]){
      return this.imageKeys[image.currentSrc]
    } else {
      this.maxRes = Math.max(this.maxRes, image.height);
      this.imageSet.push(image);
      this.imageKeys[image.currentSrc] = this.imageSet.length - 1;
      return this.imageKeys[image.currentSrc];
    }
  }
  
  resizeAndPaste(image){
    this.ctx.globalAlpha = 0.0;
    this.ctx.clearRect(0, 0, this.res, -this.res);
    this.ctx.globalAlpha = 1.0;
    this.ctx.drawImage(image, 0, 0, this.res, -this.res);
  }
  
  setAndGetResolution() {
    if(this.maxRes < this.res) {
      console.log("Using texture dimensions of " + this.maxRes + "px instead of specified " + this.res + "px.")
      this.res = this.maxRes;
    }
    return this.res;
  }

  getPixels() {
    let time = new Date().getTime();
    let pixels = new Uint8Array(this.res * this.res * 4 * this.imageSet.length);
    for (let i=0; i < this.imageSet.length; i++){
      this.resizeAndPaste(this.imageSet[i]);
      let pixBuffer = new Uint8Array(this.ctx.getImageData(0, 0, this.res, this.res).data.buffer);
      let offset = i * this.res * this.res * 4;
      pixels.set(pixBuffer, offset)
    }
    console.log("Textures packed in ", (new Date().getTime() - time) / 1000.0, " seconds");
    return pixels;
  }
}
