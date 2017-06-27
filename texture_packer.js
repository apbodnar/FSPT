/**
 * Created by adam on 6/26/17.
 * Make a texture atlas with a quadtree to track available space
 */

(function(exports){
  exports.TexturePacker = class{
    constructor(atlasRes){
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.canvas.height = atlasRes;
      this.ctx = this.canvas.getContext('2d');
      this.root = new Quadrant(atlasRes, 0, 0);
    }

    addTexture(image){
      let bestDim = this.resizedDims(image);
      let quad = this.findQuad(bestDim, this.root);
      this.resizeAndPaste(image, quad.x, quad.y, bestDim, bestDim);
      return {
        offset: [quad.x / this.root.dim, quad.y / this.root.dim],
        scale: bestDim / this.root.dim
      }
    }

    findQuad(size, quad){
      if(size == quad.dim && quad.empty){
        return quad;
      }
      if(quad.empty){
        quad.spawnChildren();
        quad.empty = false;
      }
      let best = null;
      for(let i=0; i<quad.children.length; i++){
        let child = quad.children[i];
        if(best){
          return best;
        }
        if(child.dim >= size){
          best = this.findQuad(size, child);
          if(best){
            child.empty = false;
          }
        }

      }
      return best;
    }

    resizedDims(image){
      let area = image.naturalHeight * image.naturalWidth;
      let bestDim = 1;
      for(let i=0; Math.pow(2,i) <= Math.sqrt(area); i++){
        bestDim = Math.pow(2,i);
      }
      return bestDim;
    }

    flipImage(image, size){
      let scratch = document.createElement('canvas');
      scratch.width = scratch.height = size;
      let sctx = scratch.getContext('2d');
      sctx.scale(1,-1);
      sctx.drawImage(image, 0, 0, size, -size);
      return scratch;
    }

    resizeAndPaste(image, offsetX, offsetY, size){
      this.ctx.drawImage(this.flipImage(image, size), offsetX, offsetY);
    }
  };

  class Quadrant {
    constructor(size, x, y){
      this.x = x;
      this.y = y;
      this.dim = size;
      this.empty = true;
      this.children = [];
    }
    spawnChildren(){
      let half = this.dim / 2;
      this.children = [
        new Quadrant(half, this.x, this.y),
        new Quadrant(half, this.x + half, this.y),
        new Quadrant(half, this.x, this.y + half),
        new Quadrant(half, this.x + half, this.y + half)
      ]
    }
  }
})(this);