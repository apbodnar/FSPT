/**********************************************************************
Copyright (c) 2016 Advanced Micro Devices, Inc. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
********************************************************************/
import {
    Vec3
} from './vector.js'
import {
    BBox
} from './bounding_box.js'

const maxPrimsPerLeaf = 1;
const traversalCost = 1.5;

class Node {
    constructor() {
        // Node bounds in world space
        this.bounds;
        // Type of the node
        this.leaf = false;
        // Node index in a complete tree
        this.index;
        this.lc;
        this.rc;
        this.startidx;
        this.numprims;
    }
};

// Bin has bbox and occurence count
class Bin {
    constructor() {
        this.bounds = new BBox();
        this.count = 0;
    }
};

class SplitRequest {
    constructor(startidx, numprims, ptr, bounds, centroid_bounds, level, index) {
        // Starting index of a request
        this.startidx = startidx;
        // Number of primitives
        this.numprims = numprims;
        // Root node
        this.ptr = ptr;
        // Bounding box
        this.bounds = bounds;
        // Centroid bounds
        this.centroid_bounds = centroid_bounds;
        // Level
        this.level = level;
        // Node index
        this.index = index;
    }
};

class SahSplit {
    constructor() {
        this.dim = 0;
        this.split = 0;
        this.sah = 0;
        this.overlap = 0;
    }
}

export class BVH3 {

    constructor(bounds) {
        this.root = null;
        this.numBins = 64;
        this.height = 0;
        // Bvh nodes
        this.nodes = null;
        // Identifiers of leaf primitives
        this.indices = null;
        // Node allocator counter, atomic for thread safety
        this.nodeCount;
        // Identifiers of leaf primitives
        this.packedIndices = [];
        // Bounding box containing all primitives
        this.rootBBox = new BBox();
        this.bounds = bounds;
        for (let i = 0; i < bounds.length; ++i) {
            // Calc bbox
            this.rootBBox.grow(bounds[i]);
        }
        this.buildImpl();
    }

    initNodeAllocator(maxNum) {
        this.nodeCount = 0;
        this.nodes = Array(maxNum).fill(null).map(() => { return new Node() });
    }

    allocateNode() {
        return this.nodes[this.nodeCount++];
    }

    swap(list, first, second) {
        let tmp = list[first];
        list[first] = list[second];
        list[second] = tmp;
    }

    buildNode(req) {
        this.height = Math.max(this.height, req.level);

        let node = this.allocateNode();
        node.bounds = req.bounds;
        node.index = req.index;

        // Create leaf node if we have enough prims
        if (req.numprims < 2) {
            node.leaf = true;
            node.startidx = this.packedIndices.length;
            node.numprims = req.numprims;

            for (let i = 0; i < req.numprims; ++i) {
                this.packedIndices.push(this.indices[req.startidx + i]);
            }
        }
        else {
            // Choose the maximum extent
            let axis = req.centroid_bounds.maxdim();
            let border = req.centroid_bounds.center()[axis];

            let ss = this.findSahSplit(req);
            if (!Number.isNaN(ss.split)) {
                axis = ss.dim;
                border = ss.split;

                if (req.numprims < ss.sah && req.numprims < maxPrimsPerLeaf) {
                    node.leaf = true;
                    node.startidx = this.packedIndices.length;
                    node.numprims = req.numprims;

                    for (let i = 0; i < req.numprims; ++i) {
                        this.packedIndices.push(this.indices[req.startidx + i]);
                    }

                    if (req.ptr) {
                        req.ptr = node;
                    }
                    return;
                }
            }


            node.type = false;

            // Start partitioning and updating extents for children at the same time
            let leftbounds = new BBox(),
                rightbounds = new BBox(), 
                leftcentroid_bounds = new BBox(), 
                rightcentroid_bounds = new BBox();
            let splitidx = req.startidx;

            let near2far = (req.numprims + req.startidx) & 0x1;
            if (req.centroid_bounds.extents()[axis] > 0.0) {
                let first = req.startidx;
                let last = req.startidx + req.numprims;

                if (near2far) {
                    while (true) {
                        while ((first != last) &&
                            this.centroids[this.indices[first]][axis] < border) {
                            leftbounds.grow(this.bounds[this.indices[first]]);
                            leftcentroid_bounds.grow(this.centroids[this.indices[first]]);
                            ++first;
                        }

                        if (first === last--) {
                            break;
                        }
                        rightbounds.grow(this.bounds[this.indices[first]]);
                        rightcentroid_bounds.grow(this.centroids[this.indices[first]]);

                        while ((first != last) &&
                            this.centroids[this.indices[last]][axis] >= border) {
                            rightbounds.grow(this.bounds[this.indices[last]]);
                            rightcentroid_bounds.grow(this.centroids[this.indices[last]]);
                            --last;
                        }

                        if (first === last) {
                            break;
                        }
                        leftbounds.grow(this.bounds[this.indices[last]]);
                        leftcentroid_bounds.grow(this.centroids[this.indices[last]]);

                        this.swap(this.indices, first++, last);
                    }
                }
                else {
                    while (true) {
                        while ((first != last) &&
                            this.centroids[this.indices[first]][axis] >= border) {
                            leftbounds.grow(this.bounds[this.indices[first]]);
                            leftcentroid_bounds.grow(this.centroids[this.indices[first]]);
                            ++first;
                        }

                        if (first === last--) {
                            break;
                        }
                        rightbounds.grow(this.bounds[this.indices[first]]);
                        rightcentroid_bounds.grow(this.centroids[this.indices[first]]);

                        while ((first != last) &&
                            this.centroids[this.indices[last]][axis] < border) {
                            rightbounds.grow(this.bounds[this.indices[last]]);
                            rightcentroid_bounds.grow(this.centroids[this.indices[last]]);
                            --last;
                        }

                        if (first === last) {
                            break;
                        }
                        leftbounds.grow(this.bounds[this.indices[last]]);
                        leftcentroid_bounds.grow(this.centroids[this.indices[last]]);

                        this.swap(this.indices, first++, last);
                    }
                }

                splitidx = first;
            }

            if (splitidx === req.startidx || splitidx === req.startidx + req.numprims) {
                splitidx = req.startidx + (req.numprims >> 1);

                for (let i = req.startidx; i < splitidx; ++i) {
                    leftbounds.grow(this.bounds[this.indices[i]]);
                    leftcentroid_bounds.grow(this.centroids[this.indices[i]]);
                }

                for (let i = splitidx; i < req.startidx + req.numprims; ++i) {
                    rightbounds.grow(this.bounds[this.indices[i]]);
                    rightcentroid_bounds.grow(this.centroids[this.indices[i]]);
                }
            }

            // Left request
            let leftrequest = new SplitRequest(req.startidx, 
                splitidx - req.startidx, 
                node.lc, 
                leftbounds, 
                leftcentroid_bounds, 
                req.level + 1, 
                (req.index << 1));
            // Right request
            let rightrequest = new SplitRequest(splitidx, 
                req.numprims - (splitidx - req.startidx), 
                node.rc, 
                rightbounds, 
                rightcentroid_bounds, 
                req.level + 1, 
                (req.index << 1) + 1);

            // Put those to stack
            this.buildNode(leftrequest);
            this.buildNode(rightrequest);
        }

        // Set parent ptr if any
        if (req.ptr) {
            req.ptr = node;
        }
    }

    findSahSplit(req) {
        // SAH implementation
        // calc centroids histogram
        // int const kNumBins = 128;
        // moving split bin index
        let splitidx = -1;
        // Set SAH to maximum float value as a start
        let sah = Infinity;
        let split = new SahSplit();
        split.dim = 0;
        split.split = NaN;

        // if we cannot apply histogram algorithm
        // put NAN sentinel as split border
        // PerformObjectSplit simply splits in half
        // in this case
        let centroid_extents = req.centroid_bounds.extents();
        if (Vec3.dot(centroid_extents, centroid_extents) === 0.0) {
            return split;
        }

        // Keep bins for each dimension
        let bins = Array(3);
        bins[0] = Array(this.numBins).fill(null).map(() => { return new Bin() });
        bins[1] = Array(this.numBins).fill(null).map(() => { return new Bin() });
        bins[2] = Array(this.numBins).fill(null).map(() => { return new Bin() });

        // Precompute inverse parent area
        let invarea = 1.0 / req.bounds.surface_area();
        // Precompute min point
        let rootmin = req.centroid_bounds.pmin;

        // Evaluate all dimensions
        for (let axis = 0; axis < 3; ++axis) {
            let rootminc = rootmin[axis];
            // Range for histogram
            let centroid_rng = centroid_extents[axis];
            let invcentroid_rng = 1.0 / centroid_rng;

            // If the box is degenerate in that dimension skip it
            if (centroid_rng === 0.0) {
                continue;
            }

            // Initialize bins
            for (let i = 0; i < this.numBins; ++i) {
                bins[axis][i].count = 0;
                bins[axis][i].bounds = new BBox();
            }

            // Calc primitive refs histogram
            for (let i = req.startidx; i < req.startidx + req.numprims; ++i) {
                let idx = this.indices[i];
                //int binidx = (int)std::min<float>((m_num_bins) * ((centroids[idx][axis] - rootminc) * invcentroid_rng), (m_num_bins - 1));
                let binidx = Math.floor(Math.min(this.numBins * ((this.centroids[idx][axis] - rootminc) * invcentroid_rng), this.numBins - 1));
                ++bins[axis][binidx].count;
                bins[axis][binidx].bounds.grow(this.bounds[idx]);
            }

            let rightbounds = Array(this.numBins - 1);

            // Start with 1-bin right box
            let rightbox = new BBox();
            for (let i = this.numBins - 1; i > 0; --i) {
                rightbox.grow(bins[axis][i].bounds);
                rightbounds[i - 1] = rightbox;
            }

            let leftbox = new BBox();
            let leftcount = 0;
            let rightcount = req.numprims;

            // Start best SAH search
            // i is current split candidate (split between i and i + 1)
            let sahtmp = 0.0;
            for (let i = 0; i < this.numBins - 1; ++i) {
                leftbox.grow(bins[axis][i].bounds);
                leftcount += bins[axis][i].count;
                rightcount -= bins[axis][i].count;

                // Compute SAH
                sahtmp = traversalCost + (leftcount * leftbox.surface_area() + rightcount * rightbounds[i].surface_area()) * invarea;

                // Check if it is better than what we found so far
                if (sahtmp < sah) {
                    split.dim = axis;
                    splitidx = i;
                    split.sah = sah = sahtmp;
                }
            }
        }

        // Choose split plane
        if (splitidx != -1) {
            split.split = rootmin[split.dim] + (splitidx + 1) * (centroid_extents[split.dim] / this.numBins);
        }

        return split;
    }

    buildImpl() {
        // Structure describing split request
        let numbounds = this.bounds.length;
        this.initNodeAllocator(2 * numbounds - 1);

        // Cache some stuff to have faster partitioning
        this.centroids = Array(numbounds);
        this.indices = Array(numbounds).fill(0).map((_, v) => { return v });

        // Calc bbox
        let centroid_bounds = new BBox();
        for (let i = 0; i < numbounds; ++i) {
            let c = this.bounds[i].center();
            centroid_bounds.grow(c);
            this.centroids[i] = c;
        }

        let init = new SplitRequest(0, numbounds, null, this.rootBBox, centroid_bounds, 0, 1);
        this.buildNode(init);

        // Set root_ pointer
        this.root = this.nodes[0];
    }

    printStatistics() {
        console.log("SAH bins: ", this.numBins);
        console.log("Number of triangles: ", this.indices.length);
        console.log("Number of nodes: ", this.nodeCount);
        console.log("Tree height: ", this.height);
    }

}