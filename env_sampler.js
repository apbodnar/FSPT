export function ProcessEnvRadiance(img) {
    function luma(c) {
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    }

    function pixelAt(data, width, px, py) {
        let color = [0, 0, 0, 0];
        for (let i = 0; i < 4; i++) {
            color[i] = data[((py * (width * 4)) + (px * 4)) + i];
        }
        return color;
    }

    function getRadiance(data, width, x, y) {
        let normalized = [0, 0, 0]
        let color = pixelAt(data, img.width, x, y);
        let power = Math.pow(2.0, color[3] - 128);
        normalized[0] = power * color[0] / 255.0;
        normalized[1] = power * color[1] / 255.0;
        normalized[2] = power * color[2] / 255.0;
        return luma(normalized);
    }

    function biTreeSplitting(data, imgWidth, totalRadiance, minRadiance, xmin, ymin, xmax, ymax) {
        let boxes = []
        function biSplit(radiance, x0, y0, x1, y1) {
            if (radiance <= minRadiance || (y1 - y0) * (x1 - x0) < 2) {
                boxes = boxes.concat([x0, y0, x1, y1]);
                return
            }
            let subRadiance = 0;
            let vertSplit = x1 - x0 > y1 - y0
            let xs = x1;
            let ys = (y1 - y0) / 2 + y0;
            if (vertSplit) {
                xs = (x1 - x0) / 2 + x0;
                ys = y1;
            }
            for (let x = x0; x < xs; x++) {
                for (let y = y0; y < ys; y++) {
                    subRadiance += getRadiance(data, imgWidth, x, y);
                }
            }
            biSplit(subRadiance, x0, y0, xs, ys);
            if (vertSplit) {
                biSplit(radiance - subRadiance, xs, y0, x1, y1);
            } else {
                biSplit(radiance - subRadiance, x0, ys, x1, y1);
            }
        }
        biSplit(totalRadiance, xmin, ymin, xmax, ymax);
        return boxes;
    }

    let canvas = document.createElement('canvas')
    canvas.width = img.width;
    canvas.height = img.height;
    let ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, img.width, img.height);
    let pixels = ctx.getImageData(0, 0, img.width, img.height);
    let data = pixels.data;
    let totalRadiance = 0;
    let brightestTexel = 0;
    for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
            let rad = getRadiance(data, img.width, x, y);
            brightestTexel = Math.max(rad, brightestTexel)
            totalRadiance += rad;
        }
    }
    let minRadiance = Math.max(totalRadiance / 64, brightestTexel)
    console.log(minRadiance, brightestTexel)
    let boxes = biTreeSplitting(data, img.width, totalRadiance, minRadiance, 0, 0, img.width, img.height);
    return new Uint16Array(boxes)
}
