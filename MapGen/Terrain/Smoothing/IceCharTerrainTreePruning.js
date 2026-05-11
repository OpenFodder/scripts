var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};
MapGen.Terrain.Smoothing.Ice = MapGen.Terrain.Smoothing.Ice || {};

(function(pIce) {
    pIce.CompleteNarrowLowerTreeBottoms = function(pContext, pChars) {
        var src = MapGen.Layers.Clone(pChars);
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var layers = pContext.Layers || {};
        var changed = 0;
        var pending = {};

        function key(x, y) {
            return x + "," + y;
        }

        function charAt(x, y) {
            return MapGen.Layers.Get(src, x, y, self.Chars.ground);
        }

        function isTree(x, y) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return false;
            return self.IsTreeCharValue(charAt(x, y));
        }

        function isTrimmedCell(x, y) {
            return MapGen.Layers.Get(layers.trimmedTreeProtrusion, x, y, 0) ||
                MapGen.Layers.Get(layers.trimmedTreeTopSideTab, x, y, 0) ||
                MapGen.Layers.Get(layers.trimmedTreeLowerSideTail, x, y, 0);
        }

        function canFill(x, y) {
            var occupied = MapGen.Layers.Get(layers.occupied, x, y, 0);
            if(x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1)
                return false;
            if(charAt(x, y) !== self.Chars.ground)
                return false;
            if(isTrimmedCell(x, y))
                return false;
            if(MapGen.Layers.Get(layers.path, x, y, 0) ||
                MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                MapGen.Layers.Get(layers.water, x, y, 0) ||
                MapGen.Layers.Get(layers.coast, x, y, 0) ||
                MapGen.Layers.Get(layers.riverBank, x, y, 0) ||
                occupied)
                return false;
            if(self.HasNearbyStructureArt(pContext, x, y, 2) ||
                self.IsCliffCell(pContext, x, y) ||
                self.IsCliffTopApronCell(pContext, x, y) ||
                self.IsCliffFootApronCell(pContext, x, y))
                return false;
            return true;
        }

        function runAt(x, y) {
            if(!isTree(x, y))
                return null;
            var start = x;
            while(start > 0 && isTree(start - 1, y))
                --start;
            var end = x;
            while(end < width - 1 && isTree(end + 1, y))
                ++end;
            return { start: start, end: end, length: end - start + 1 };
        }

        function terminalRun(run, y) {
            for(var bx = run.start; bx <= run.end; ++bx) {
                if(isTree(bx, y + 1))
                    return false;
            }
            return true;
        }

        function hasWiderCanopyAbove(run, y) {
            var center = Math.floor((run.start + run.end) / 2);
            for(var lookback = 1; lookback <= 3 && y - lookback > 0; ++lookback) {
                var support = runAt(center, y - lookback);
                if(support && support.length >= run.length + 2)
                    return true;
            }
            return false;
        }

        function queueBottomFill(run, y) {
            if(run.length < 3 || run.length > 12)
                return;
            if(!terminalRun(run, y))
                return;
            if(!hasWiderCanopyAbove(run, y))
                return;

            for(var bx = run.start; bx <= run.end; ++bx) {
                if(!canFill(bx, y + 1))
                    return;
            }
            for(var fx = run.start; fx <= run.end; ++fx) {
                var role = "M";
                if(fx === run.start)
                    role = "L";
                else if(fx === run.end)
                    role = "R";
                pending[key(fx, y + 1)] = [fx, y + 1, role];
            }
        }

        for(var y = 2; y < height - 2; ++y) {
            var lastEnd = -1;
            for(var x = 1; x < width - 1; ++x) {
                if(x <= lastEnd || !isTree(x, y))
                    continue;
                var run = runAt(x, y);
                if(!run)
                    continue;
                lastEnd = run.end;
                queueBottomFill(run, y);
            }
        }

        for(var itemKey in pending) {
            if(!pending.hasOwnProperty(itemKey))
                continue;
            var cell = pending[itemKey];
            if(MapGen.Layers.Set(pChars, cell[0], cell[1], cell[2])) {
                self.ClearTrimmedTreeMarkers(pContext, cell[0], cell[1]);
                ++changed;
            }
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Completed narrow ice lower tree bottoms: " + changed);

        return changed;
    };

    pIce.PruneUnsupportedSmallTreeClusters = function(pContext, pChars) {
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var visited = new Uint8Array(width * height);
        var pending = [];
        var dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];

        function cellKey(x, y) {
            return y * width + x;
        }

        function charAt(x, y) {
            return MapGen.Layers.Get(pChars, x, y, self.Chars.ground);
        }

        function isTree(x, y) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return false;
            return self.IsTreeCharValue(charAt(x, y));
        }

        function clearGeneratedTreeMarkers(x, y) {
            self.ClearTrimmedTreeMarkers(pContext, x, y);
        }

        function contiguousRunLength(values) {
            if(!values.length)
                return 0;
            values.sort(function(a, b) { return a - b; });
            var best = 1;
            var current = 1;
            for(var index = 1; index < values.length; ++index) {
                if(values[index] === values[index - 1] + 1) {
                    ++current;
                    if(current > best)
                        best = current;
                }
                else if(values[index] !== values[index - 1]) {
                    current = 1;
                }
            }
            return best;
        }

        function collectComponent(startX, startY) {
            var stack = [[startX, startY]];
            var cells = [];
            var minX = startX;
            var maxX = startX;
            var minY = startY;
            var maxY = startY;
            var protectedCount = 0;

            visited[cellKey(startX, startY)] = true;

            while(stack.length) {
                var cell = stack.pop();
                var x = cell[0];
                var y = cell[1];
                cells.push(cell);
                if(!protectedCount && self.IsStructureContextCoverCell(pContext, x, y))
                    ++protectedCount;
                if(x < minX) minX = x;
                if(x > maxX) maxX = x;
                if(y < minY) minY = y;
                if(y > maxY) maxY = y;
                for(var dir = 0; dir < dirs.length; ++dir) {
                    var nx = x + dirs[dir][0];
                    var ny = y + dirs[dir][1];
                    var key = cellKey(nx, ny);
                    if(!isTree(nx, ny) || visited[key])
                        continue;
                    visited[key] = true;
                    stack.push([nx, ny]);
                }
            }

            // Row-run guards only apply to components of at most 18 cells.
            // Large forests need neither row sorting nor column inventories.
            var maxRowRun = 4;
            if(cells.length <= 18) {
                var byRow = {};
                for(var ci = 0; ci < cells.length; ++ci) {
                    var rowY = cells[ci][1];
                    if(!byRow[rowY]) byRow[rowY] = [];
                    byRow[rowY].push(cells[ci][0]);
                }
                maxRowRun = 0;
                for(var rowKey in byRow) {
                    if(byRow.hasOwnProperty(rowKey)) {
                        var rowRun = contiguousRunLength(byRow[rowKey]);
                        if(rowRun > maxRowRun) maxRowRun = rowRun;
                    }
                }
            }

            return {
                cells: cells,
                count: cells.length,
                minX: minX,
                maxX: maxX,
                minY: minY,
                maxY: maxY,
                width: maxX - minX + 1,
                height: maxY - minY + 1,
                maxRowRun: maxRowRun,
                protectedCount: protectedCount
            };
        }

        function shouldPrune(component) {
            // Pruning thresholds relaxed 2026-06-13. Original kept the renderer
            // safe by killing every component <=5 cells unconditionally, but
            // shipped CF ice maps contain 45 components <=10 cells across 16
            // maps — including 3 single-cell singletons (mapm10/mapm3 use
            // tile 211/170/171), 7 of size 2, and 11 of size 4. The wang
            // atlas DOES support these tiles in isolation; the prune was
            // over-defensive about render legality and was the dominant
            // contributor to ice maps having only ~4 surviving forest blobs
            // per map (vs. shipped median ~7) and tree fraction 7-11% (vs.
            // shipped 12.7%). RCA 2026-06-13 (visual sparsity follow-up).
            //
            // Kept guards: snake-shape limits (single-row/column blobs of
            // 4+ cells still trip the wang matcher because a row of N tree
            // chars needs cardinal-neighbor sequences the atlas can't
            // terminate). The width<=2 / height<=2 dimension caps stay; only
            // the unconditional small-count kill is removed.
            // Structure-context cover is a placement hint, not permission to
            // leave an atlas-poor fragment behind.  Preserve substantial
            // context groves, but let the normal shape guards remove the
            // tiny caps/shelves produced when the rest of a context lobe is
            // cut away by route and apron repair.
            if(component.count <= 4)
                return true;

            // Final route/apron cuts occasionally leave a small diagonal
            // constellation rather than a coherent grove. Across all 15
            // shipped ice maps, no <=24-cell tree component occupies less
            // than 64% of its bounding box; keep a small margin below that
            // corpus floor and remove the visibly truncated generated shards.
            var boxArea = component.width * component.height;
            if(component.count <= 24 && boxArea > 0 &&
                (component.count / boxArea) < 0.625)
                return true;

            // Small shallow components that terminate on the literal map
            // boundary expose clipped canopy stacks and cannot carry a full
            // snow-shadow contour. Preserve substantial perimeter forests,
            // but discard these isolated border fragments before projection.
            var touchesHorizontalEdge = component.minY === 0 ||
                component.maxY === height - 1;
            var touchesVerticalEdge = component.minX === 0 ||
                component.maxX === width - 1;
            if(component.count <= 16 &&
                ((touchesHorizontalEdge && component.height <= 3) ||
                 (touchesVerticalEdge && component.width <= 3)))
                return true;

            if(component.protectedCount > 0 && component.count >= 12)
                return false;
            if(component.maxRowRun <= 1 && component.count >= 4 && component.count <= 18)
                return true;
            if(component.maxRowRun <= 2 && component.count >= 6 && component.count <= 14)
                return true;
            if(component.maxRowRun <= 3 && component.count >= 7 && component.count <= 10)
                return true;
            if(component.width <= 1 && component.count >= 4)
                return true;
            if(component.height <= 1 && component.count >= 4)
                return true;
            return false;
        }

        for(var y = 0; y < height; ++y) {
            for(var x = 0; x < width; ++x) {
                var key = cellKey(x, y);
                if(visited[key] || !isTree(x, y))
                    continue;

                var component = collectComponent(x, y);
                if(!shouldPrune(component))
                    continue;
                for(var ci = 0; ci < component.cells.length; ++ci)
                    pending.push(component.cells[ci]);
            }
        }

        var changed = 0;
        for(var index = 0; index < pending.length; ++index) {
            var item = pending[index];
            if(MapGen.Layers.Set(pChars, item[0], item[1], self.Chars.ground)) {
                clearGeneratedTreeMarkers(item[0], item[1]);
                ++changed;
            }
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Pruned unsupported small ice tree clusters: " + changed);

        return changed;
    };

    pIce.PruneUnsupportedNarrowTerminalTreeRows = function(pContext, pChars) {
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var layers = pContext.Layers || {};
        var total = 0;

        function charAt(x, y) {
            return MapGen.Layers.Get(pChars, x, y, self.Chars.ground);
        }

        function isTree(x, y) {
            if(x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1)
                return false;
            return self.IsTreeCharValue(charAt(x, y));
        }

        function protectedCell(x, y) {
            return (MapGen.Layers.Get(layers.perimeterCover, x, y, 0) &&
                (x <= 1 || y <= 1 || x >= width - 2 || y >= height - 2)) ||
                self.IsStructureContextCoverCell(pContext, x, y);
        }

        function runAt(x, y) {
            if(!isTree(x, y))
                return null;
            var start = x;
            while(start > 0 && isTree(start - 1, y))
                --start;
            var end = x;
            while(end < width - 1 && isTree(end + 1, y))
                ++end;
            return { start: start, end: end, length: end - start + 1 };
        }

        function terminalRun(run, y) {
            for(var x = run.start; x <= run.end; ++x) {
                if(isTree(x, y + 1))
                    return false;
                if(protectedCell(x, y))
                    return false;
            }
            return true;
        }

        function widerCanopyAbove(run, y) {
            for(var dy = 1; dy <= 4 && y - dy > 0; ++dy) {
                var seen = {};
                for(var px = Math.max(1, run.start - 4); px <= Math.min(width - 2, run.end + 4); ++px) {
                    var probe = runAt(px, y - dy);
                    if(!probe)
                        continue;
                    var key = probe.start + "," + probe.end + "," + (y - dy);
                    if(seen[key])
                        continue;
                    seen[key] = true;
                    if(probe.length >= 4 && probe.length >= run.length + 2)
                        return true;
                }
            }
            return false;
        }

        for(var pass = 0; pass < 4; ++pass) {
            var pending = {};
            for(var y = height - 2; y > 1; --y) {
                var lastEnd = -1;
                for(var x = 1; x < width - 1; ++x) {
                    if(x <= lastEnd || !isTree(x, y))
                        continue;
                    var run = runAt(x, y);
                    if(!run)
                        continue;
                    lastEnd = run.end;
                    if(run.length > 2)
                        continue;
                    if(!terminalRun(run, y) || !widerCanopyAbove(run, y))
                        continue;
                    for(var px = run.start; px <= run.end; ++px)
                        pending[px + "," + y] = [px, y];
                }
            }

            var changed = 0;
            for(var key in pending) {
                if(!pending.hasOwnProperty(key))
                    continue;
                var cell = pending[key];
                if(MapGen.Layers.Set(pChars, cell[0], cell[1], self.Chars.ground)) {
                    self.ClearTrimmedTreeMarkers(pContext, cell[0], cell[1]);
                    ++changed;
                }
            }
            if(!changed)
                break;
            total += changed;
        }

        if(total && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Pruned unsupported narrow ice tree terminal rows: " + total);

        return total;
    };

    pIce.PruneUnsupportedFlatTerminalTreeShelves = function(pContext, pChars) {
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var layers = pContext.Layers || {};
        var pending = {};

        function charAt(x, y) {
            return MapGen.Layers.Get(pChars, x, y, self.Chars.ground);
        }

        function isTree(x, y) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return false;
            return self.IsTreeCharValue(charAt(x, y));
        }

        function protectedCell(x, y) {
            var occupied = MapGen.Layers.Get(layers.occupied, x, y, 0);
            return x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1 ||
                MapGen.Layers.Get(layers.water, x, y, 0) ||
                MapGen.Layers.Get(layers.coast, x, y, 0) ||
                MapGen.Layers.Get(layers.riverBank, x, y, 0) ||
                self.IsStructureContextCoverCell(pContext, x, y) ||
                occupied === "live_structure" ||
                occupied === "live_structure_clearance" ||
                occupied === "structure_cluster" ||
                occupied === "objective_structure" ||
                self.HasNearbyStructureArt(pContext, x, y, 2) ||
                self.IsCliffCell(pContext, x, y) ||
                self.IsCliffTopApronCell(pContext, x, y) ||
                self.IsCliffFootApronCell(pContext, x, y);
        }

        function canPrune(x, y) {
            if(!isTree(x, y))
                return false;
            if(isTree(x, y - 1) || isTree(x, y + 1))
                return false;
            if(!isTree(x - 1, y) && !isTree(x + 1, y))
                return false;
            return !protectedCell(x, y);
        }

        for(var y = 1; y < height - 1; ++y) {
            for(var x = 1; x < width - 1; ++x) {
                if(canPrune(x, y))
                    pending[x + "," + y] = [x, y];
            }
        }

        var changed = 0;
        for(var key in pending) {
            if(!pending.hasOwnProperty(key))
                continue;
            var cell = pending[key];
            if(MapGen.Layers.Set(pChars, cell[0], cell[1], self.Chars.ground)) {
                self.ClearTrimmedTreeMarkers(pContext, cell[0], cell[1]);
                ++changed;
            }
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Pruned unsupported flat terminal ice tree shelves: " + changed);

        return changed;
    };

    pIce.PruneUnsupportedSparseTreeFragments = function(pContext, pChars) {
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var layers = pContext.Layers || {};
        var pending = {};

        function charAt(x, y) {
            return MapGen.Layers.Get(pChars, x, y, self.Chars.ground);
        }

        function isTree(x, y) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return false;
            return self.IsTreeCharValue(charAt(x, y));
        }

        function protectedCell(x, y) {
            var occupied = MapGen.Layers.Get(layers.occupied, x, y, 0);
            return x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1 ||
                MapGen.Layers.Get(layers.water, x, y, 0) ||
                MapGen.Layers.Get(layers.coast, x, y, 0) ||
                MapGen.Layers.Get(layers.riverBank, x, y, 0) ||
                self.IsStructureContextCoverCell(pContext, x, y) ||
                occupied === "live_structure" ||
                occupied === "live_structure_clearance" ||
                occupied === "structure_cluster" ||
                occupied === "objective_structure" ||
                self.HasNearbyStructureArt(pContext, x, y, 2) ||
                self.IsCliffCell(pContext, x, y) ||
                self.IsCliffTopApronCell(pContext, x, y) ||
                self.IsCliffFootApronCell(pContext, x, y);
        }

        function verticalRunLength(x, y) {
            var top = y;
            while(top > 0 && isTree(x, top - 1))
                --top;
            var bottom = y;
            while(bottom < height - 1 && isTree(x, bottom + 1))
                ++bottom;
            return bottom - top + 1;
        }

        function treeNeighbourCount(x, y) {
            var count = 0;
            for(var dy = -1; dy <= 1; ++dy) {
                for(var dx = -1; dx <= 1; ++dx) {
                    if(dx === 0 && dy === 0)
                        continue;
                    if(isTree(x + dx, y + dy))
                        ++count;
                }
            }
            return count;
        }

        function queue(x, y) {
            if(protectedCell(x, y))
                return;
            pending[x + "," + y] = [x, y];
        }

        for(var y = 1; y < height - 1; ++y) {
            for(var x = 1; x < width - 1; ++x) {
                if(charAt(x, y) !== self.Chars.tree)
                    continue;

                var n = isTree(x, y - 1);
                var e = isTree(x + 1, y);
                var s = isTree(x, y + 1);
                var w = isTree(x - 1, y);
                var cardinal = (n ? 1 : 0) + (e ? 1 : 0) + (s ? 1 : 0) + (w ? 1 : 0);

                if(!n && !e && !w && s && (isTree(x - 1, y + 1) || isTree(x + 1, y + 1))) {
                    queue(x, y);
                    continue;
                }

                if(cardinal <= 1 && treeNeighbourCount(x, y) <= 3) {
                    queue(x, y);
                    continue;
                }

                if(!e && !w && n && s && verticalRunLength(x, y) <= 3 && treeNeighbourCount(x, y) <= 4)
                    queue(x, y);
            }
        }

        var changed = 0;
        for(var key in pending) {
            if(!pending.hasOwnProperty(key))
                continue;
            var cell = pending[key];
            if(MapGen.Layers.Set(pChars, cell[0], cell[1], self.Chars.ground)) {
                self.ClearTrimmedTreeMarkers(pContext, cell[0], cell[1]);
                ++changed;
            }
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Pruned unsupported sparse ice tree fragments: " + changed);

        return changed;
    };

    pIce.PruneUnsupportedNarrowTreeBridges = function(pContext, pChars) {
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var layers = pContext.Layers || {};
        var pending = {};

        function charAt(x, y) {
            return MapGen.Layers.Get(pChars, x, y, self.Chars.ground);
        }

        function isTree(x, y) {
            if(x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1)
                return false;
            return self.IsTreeCharValue(charAt(x, y));
        }

        function protectedCell(x, y) {
            return MapGen.Layers.Get(layers.perimeterCover, x, y, 0) ||
                self.IsStructureContextCoverCell(pContext, x, y) ||
                MapGen.Layers.Get(layers.occupied, x, y, 0) ||
                self.IsCliffCell(pContext, x, y) ||
                self.IsCliffTopApronCell(pContext, x, y);
        }

        function isSingleColumnCell(x, y) {
            return isTree(x, y) && !isTree(x - 1, y) && !isTree(x + 1, y);
        }

        function hasNearbyWideCanopy(x, y, dy) {
            var yy = y + dy;
            if(yy <= 0 || yy >= height - 1)
                return false;
            for(var px = Math.max(1, x - 4); px <= Math.min(width - 2, x + 4); ++px) {
                if(!isTree(px, yy))
                    continue;
                var start = px;
                while(start > 0 && isTree(start - 1, yy))
                    --start;
                var end = px;
                while(end < width - 1 && isTree(end + 1, yy))
                    ++end;
                if(end - start + 1 >= 4)
                    return true;
                px = end;
            }
            return false;
        }

        for(var x = 1; x < width - 1; ++x) {
            var y = 1;
            while(y < height - 1) {
                if(!isSingleColumnCell(x, y)) {
                    ++y;
                    continue;
                }

                var start = y;
                var blocked = false;
                while(y < height - 1 && isSingleColumnCell(x, y)) {
                    if(protectedCell(x, y))
                        blocked = true;
                    ++y;
                }
                var end = y - 1;
                var len = end - start + 1;
                if(blocked || len < 4)
                    continue;
                if(!hasNearbyWideCanopy(x, start, -1) && !hasNearbyWideCanopy(x, end, 1))
                    continue;

                for(var py = start; py <= end; ++py)
                    pending[x + "," + py] = [x, py];
            }
        }

        var changed = 0;
        for(var key in pending) {
            if(!pending.hasOwnProperty(key))
                continue;
            var cell = pending[key];
            if(MapGen.Layers.Set(pChars, cell[0], cell[1], self.Chars.ground)) {
                self.ClearTrimmedTreeMarkers(pContext, cell[0], cell[1]);
                ++changed;
            }
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Pruned unsupported narrow ice tree bridges: " + changed);

        return changed;
    };

    pIce.PruneUnsupportedTopEdgeTreeShoulders = function(pContext, pChars) {
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var layers = pContext.Layers || {};

        if(height < 3)
            return 0;

        function charAt(x, y) {
            return MapGen.Layers.Get(pChars, x, y, self.Chars.ground);
        }

        function isTree(x, y) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return false;
            return self.IsTreeCharValue(charAt(x, y));
        }

        function protectedCell(x) {
            var occupied = MapGen.Layers.Get(layers.occupied, x, 0, 0);
            return MapGen.Layers.Get(layers.keepClear, x, 0, 0) ||
                MapGen.Layers.Get(layers.path, x, 0, 0) ||
                MapGen.Layers.Get(layers.crossing, x, 0, 0) ||
                MapGen.Layers.Get(layers.water, x, 0, 0) ||
                MapGen.Layers.Get(layers.coast, x, 0, 0) ||
                MapGen.Layers.Get(layers.riverBank, x, 0, 0) ||
                MapGen.Layers.Get(layers.structureGround, x, 0, 0) ||
                self.IsStructureContextCoverCell(pContext, x, 0) ||
                occupied ||
                self.IsCliffCell(pContext, x, 0) ||
                self.IsCliffTopApronCell(pContext, x, 0) ||
                self.IsCliffFootApronCell(pContext, x, 0);
        }

        function queue(pending, x) {
            if(protectedCell(x))
                return;
            pending[x + ",0"] = [x, 0];
        }

        var changed = 0;
        for(var pass = 0; pass < 4; ++pass) {
            var pending = {};
            var x = 1;
            while(x < width - 1) {
                if(!isTree(x, 0)) {
                    ++x;
                    continue;
                }

                var start = x;
                while(x < width - 1 && isTree(x, 0))
                    ++x;
                var end = x - 1;
                if(end - start + 1 < 4)
                    continue;

                if(isTree(start, 1) && !isTree(start, 2) && isTree(start + 1, 1) && isTree(start + 1, 2))
                    queue(pending, start);
                if(isTree(start, 1) && isTree(start, 2) && !isTree(start, 3) &&
                    isTree(start + 1, 2) && isTree(start + 1, 3))
                    queue(pending, start);
                if(isTree(end, 1) && !isTree(end, 2) && isTree(end - 1, 1) && isTree(end - 1, 2))
                    queue(pending, end);
                if(isTree(end, 1) && isTree(end, 2) && !isTree(end, 3) &&
                    isTree(end - 1, 2) && isTree(end - 1, 3))
                    queue(pending, end);
            }

            var passChanged = 0;
            for(var key in pending) {
                if(!pending.hasOwnProperty(key))
                    continue;
                var cell = pending[key];
                if(MapGen.Layers.Set(pChars, cell[0], cell[1], self.Chars.ground)) {
                    self.ClearTrimmedTreeMarkers(pContext, cell[0], cell[1]);
                    ++passChanged;
                }
            }
            changed += passChanged;
            if(!passChanged)
                break;
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Pruned unsupported ice top-edge tree shoulders: " + changed);

        return changed;
    };
})(MapGen.Terrain.Smoothing.Ice);
