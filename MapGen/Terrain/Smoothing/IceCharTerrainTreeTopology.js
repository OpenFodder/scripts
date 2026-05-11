var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};
MapGen.Terrain.Smoothing.Ice = MapGen.Terrain.Smoothing.Ice || {};

(function(pIce) {
    pIce.BuildIceTreeTopology = function(pContext, pChars, pTreeRuntime) {
        var runtime = (pTreeRuntime && pTreeRuntime.candidates) ? pTreeRuntime : this.TreeRuntimeData();
        if(!runtime)
            return null;

        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var size = width * height;
        var tree = new Uint8Array(size);
        var chars = new Array(size);
        var topY = new Array(size);
        var bottomY = new Array(size);
        var verticalLength = new Array(size);
        var bottomRunStart = new Array(size);
        var bottomRunEnd = new Array(size);
        var bottomRunIndex = new Array(size);
        var bottomRunLength = new Array(size);
        var stackHeights = {};

        for(var init = 0; init < size; ++init) {
            topY[init] = -1;
            bottomY[init] = -1;
            verticalLength[init] = 0;
            bottomRunStart[init] = -1;
            bottomRunEnd[init] = -1;
            bottomRunIndex[init] = -1;
            bottomRunLength[init] = 0;
        }

        function indexOf(x, y) {
            return (y * width) + x;
        }

        function inBounds(x, y) {
            return x >= 0 && y >= 0 && x < width && y < height;
        }

        function charAt(x, y) {
            if(!inBounds(x, y))
                return self.Chars.ground;
            return chars[indexOf(x, y)];
        }

        function isTree(x, y) {
            if(!inBounds(x, y))
                return false;
            return tree[indexOf(x, y)] !== 0;
        }

        function isTreeClamped(x, y) {
            if(width <= 0 || height <= 0)
                return false;
            if(x < 0) x = 0;
            else if(x >= width) x = width - 1;
            if(y < 0) y = 0;
            else if(y >= height) y = height - 1;
            return tree[indexOf(x, y)] !== 0;
        }

        function computeStackHeight(kind) {
            var stacks = runtime.stacks && runtime.stacks[kind] ? runtime.stacks[kind] : null;
            var longest = 0;
            if(!stacks)
                return 0;
            for(var si = 0; si < stacks.length; ++si) {
                var stack = self.FlattenTreeStack(stacks[si]);
                if(stack && stack.length > longest)
                    longest = stack.length;
            }
            return longest;
        }

        stackHeights.middle = computeStackHeight("middle");
        stackHeights.leftedge = computeStackHeight("leftedge");
        stackHeights.rightedge = computeStackHeight("rightedge");

        for(var y = 0; y < height; ++y) {
            for(var x = 0; x < width; ++x) {
                var cellIndex = indexOf(x, y);
                var ch = MapGen.Layers.Get(pChars, x, y, self.Chars.ground);
                chars[cellIndex] = ch;
                if(self.IsTreeCharValue(ch))
                    tree[cellIndex] = 1;
            }
        }

        for(var vx = 0; vx < width; ++vx) {
            var vy = 0;
            while(vy < height) {
                if(!isTree(vx, vy)) {
                    ++vy;
                    continue;
                }

                var startY = vy;
                while(vy < height && isTree(vx, vy))
                    ++vy;
                var endY = vy - 1;
                var lenY = endY - startY + 1;
                for(var sy = startY; sy <= endY; ++sy) {
                    var vIndex = indexOf(vx, sy);
                    topY[vIndex] = startY;
                    bottomY[vIndex] = endY;
                    verticalLength[vIndex] = lenY;
                }
            }
        }

        for(var by = 0; by < height; ++by) {
            var bx = 0;
            while(bx < width) {
                if(!isTree(bx, by) || isTree(bx, by + 1)) {
                    ++bx;
                    continue;
                }

                var startX = bx;
                while(bx < width && isTree(bx, by) && !isTree(bx, by + 1))
                    ++bx;
                var endX = bx - 1;
                var lenX = endX - startX + 1;
                for(var rx = startX; rx <= endX; ++rx) {
                    var rIndex = indexOf(rx, by);
                    bottomRunStart[rIndex] = startX;
                    bottomRunEnd[rIndex] = endX;
                    bottomRunIndex[rIndex] = rx - startX;
                    bottomRunLength[rIndex] = lenX;
                }
            }
        }

        function stackFits(x, y, kind) {
            if(!isTree(x, y))
                return false;
            var len = stackHeights[kind] || 0;
            if(len <= 0)
                return false;
            var topY = y - len + 1;
            if(topY < 0)
                return false;
            for(var sy = topY; sy <= y; ++sy) {
                if(!isTree(x, sy))
                    return false;
            }
            return true;
        }

        return {
            Runtime: runtime,
            Width: width,
            Height: height,
            IndexOf: indexOf,
            IsTree: isTree,
            IsTreeClamped: isTreeClamped,
            CharAt: charAt,
            StackHeight: function(kind) { return stackHeights[kind] || 0; },
            StackFits: stackFits,
            TopY: topY,
            BottomY: bottomY,
            VerticalLength: verticalLength,
            BottomRunStart: bottomRunStart,
            BottomRunEnd: bottomRunEnd,
            BottomRunIndex: bottomRunIndex,
            BottomRunLength: bottomRunLength,
            BottomKind: function(x, y) {
                return self.TreeBottomKind(runtime, isTreeClamped, x, y, width, height);
            }
        };
    };

    pIce.NormalizeIceTreeTopology = function(pContext, pChars, pTreeRuntime) {
        var topology = this.BuildIceTreeTopology(pContext, pChars, pTreeRuntime);
        if(!topology)
            return 0;

        var width = topology.Width;
        var height = topology.Height;
        var self = this;
        var pending = {};

        function key(x, y) {
            return x + "," + y;
        }

        function queue(x, y, value, kind) {
            pending[key(x, y)] = { x: x, y: y, value: value, kind: kind || "" };
        }

        function sidePairFits(kind, x, y) {
            return self.TreeExplicitSideStackFits(topology.IsTreeClamped, kind, x, y);
        }

        function middlePairFits(x, y) {
            var runtime = topology.Runtime || {};
            return self.TreeExplicitMiddleStackFits(runtime, topology.IsTreeClamped, x, y, width, height);
        }

        function explicitRoleFits(kind, x, y) {
            if(kind === "leftedge" || kind === "rightedge")
                return sidePairFits(kind, x, y);
            if(kind === "middle")
                return middlePairFits(x, y);
            return false;
        }

        function desiredKind(x, y, index, length) {
            if(length <= 1) {
                if(sidePairFits("leftedge", x, y))
                    return "leftedge";
                if(sidePairFits("rightedge", x, y))
                    return "rightedge";
                if(middlePairFits(x, y))
                    return "middle";

                var inferred = topology.BottomKind(x, y);
                if(inferred && topology.StackFits(x, y, inferred))
                    return inferred;

                var explicit = self.ExplicitTreeBottomKind(topology.CharAt(x, y));
                if(explicit && topology.StackFits(x, y, explicit))
                    return explicit;

                var west = topology.IsTree(x - 1, y);
                var east = topology.IsTree(x + 1, y);
                if(east && !west)
                    return "leftedge";
                if(west && !east)
                    return "rightedge";
                return "middle";
            }
            if(index === 0) {
                if(sidePairFits("leftedge", x, y))
                    return "leftedge";
                if(middlePairFits(x, y))
                    return "middle";
                return "leftedge";
            }
            if(index === length - 1) {
                if(sidePairFits("rightedge", x, y))
                    return "rightedge";
                if(middlePairFits(x, y))
                    return "middle";
                return "rightedge";
            }
            return "middle";
        }

        for(var y = 1; y < height - 1; ++y) {
            var x = 1;
            while(x < width - 1) {
                if(!topology.IsTree(x, y) || topology.IsTree(x, y + 1)) {
                    ++x;
                    continue;
                }

                var start = x;
                while(x < width - 1 && topology.IsTree(x, y) && !topology.IsTree(x, y + 1))
                    ++x;
                var end = x - 1;
                var len = end - start + 1;

                for(var bx = start; bx <= end; ++bx) {
                    var kind = desiredKind(bx, y, bx - start, len);
                    var role = self.ExplicitTreeBottomChar(kind);
                    if(!role || !topology.StackFits(bx, y, kind) || !explicitRoleFits(kind, bx, y)) {
                        role = self.Chars.tree;
                        kind = "";
                    }
                    queue(bx, y, role, kind);
                }
            }
        }

        for(var cy = 1; cy < height - 1; ++cy) {
            for(var cx = 1; cx < width - 1; ++cx) {
                var current = topology.CharAt(cx, cy);
                if(!self.ExplicitTreeBottomKind(current) || !topology.IsTree(cx, cy + 1))
                    continue;
                queue(cx, cy, self.Chars.tree, "");
            }
        }

        var changed = 0;
        for(var itemKey in pending) {
            if(!pending.hasOwnProperty(itemKey))
                continue;
            var cell = pending[itemKey];
            var previous = MapGen.Layers.Get(pChars, cell.x, cell.y, self.Chars.ground);
            if(previous !== cell.value) {
                MapGen.Layers.Set(pChars, cell.x, cell.y, cell.value);
                ++changed;
            }

            var clearLen = cell.kind ? topology.StackHeight(cell.kind) : 1;
            for(var clearY = cell.y - clearLen + 1; clearY <= cell.y; ++clearY)
                self.ClearTrimmedTreeMarkers(pContext, cell.x, clearY);
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Normalized ice tree topology roles: " + changed);

        return changed;
    };
})(MapGen.Terrain.Smoothing.Ice);
