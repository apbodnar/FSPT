(function(exports){
  exports.loadAll = function(urls, callback){
    var counter = urls.length;
    var resHash = {};
    urls.forEach(function(url){
      if(url.match(/^texture\//)){
        img = new Image();
        img.onload = function(){
          counter--;
          resHash[url] = img;
          if(counter === 0){
            callback.apply(null,[resHash]);
          }
        }
        img.src = url;
      } else{
        var req = new XMLHttpRequest();
        req.addEventListener("load", function(res){
          counter--;
          resHash[url] = res.target.responseText;
          if(counter === 0){
            callback.apply(null,[resHash]);
          }
        });
        req.addEventListener("error", function(){ counter = -1; });
        req.open("GET", url, true);
        req.send();
      }
    });

  }
})(this);
