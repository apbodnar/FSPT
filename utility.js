(function (exports) {
  exports.loadAll = function (urls, callback) {
    let counter = urls.length;
    let resHash = {};
    urls.forEach(function (url) {
      if (url.match(/^texture\//)) {
        let img = new Image();
        img.onload = function () {
          counter--;
          resHash[url] = img;
          if (counter === 0) {
            callback.apply(null, [resHash]);
          }
        };
        img.src = url;
      } else {
        let req = new XMLHttpRequest();
        req.addEventListener("load", function (res) {
          counter--;
          resHash[url] = res.target.responseText;
          if (counter === 0) {
            callback.apply(null, [resHash]);
          }
        });
        req.addEventListener("error", function () {
          counter = -1;
        });
        req.open("GET", url, true);
        req.send();
      }
    });
  };

  exports.getText = function (path, callback) {
    let req = new XMLHttpRequest();
    req.addEventListener("load", function (res) {
      callback.apply(null, [res.target.responseText]);
    });
    req.open("GET", path, true);
    req.send();
  };

  exports.uploadDataUrl = function(path, blob, callback){
    let req = new XMLHttpRequest();
    req.addEventListener("load", function (res) {
      callback.apply(null, [res]);
    });
    req.open("POST", path, true);
    req.send(blob);
  }
})(this);
