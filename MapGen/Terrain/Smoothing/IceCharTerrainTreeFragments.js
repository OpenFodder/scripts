var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};
MapGen.Terrain.Smoothing.Ice = MapGen.Terrain.Smoothing.Ice || {};

(function(pIce) {
    pIce.PruneUnsupportedShortTreeSideColumns = function(pContext, pChars) {
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var layers = pContext.Layers || {};
        var src = MapGen.Layers.Clone(pChars);
        var pending = {};
        var pendingReplacement = {};

        if(!layers.trimmedTreeProtrusion)
            layers.trimmedTreeProtrusion = MapGen.Layers.Create(width, height, 0);
        if(!layers.trimmedTreeLowerSideTail)
            layers.trimmedTreeLowerSideTail = MapGen.Layers.Create(width, height, 0);

        function key(x, y) {
            return x + "," + y;
        }

        function charAt(x, y) {
            return MapGen.Layers.Get(src, x, y, self.Chars.ground);
        }

        function isTree(x, y) {
            return x >= 0 && y >= 0 && x < width && y < height &&
                self.IsTreeCharValue(charAt(x, y));
        }

        function perimeterCoverProtected(x, y) {
            return MapGen.Layers.Get(layers.perimeterCover, x, y, 0) &&
                (x <= 1 || y <= 1 || x >= width - 2 || y >= height - 2);
        }

        function protectedCell(x, y) {
            var occupied = MapGen.Layers.Get(layers.occupied, x, y, 0);
            return x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1 ||
                MapGen.Layers.Get(layers.path, x, y, 0) ||
                MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                MapGen.Layers.Get(layers.water, x, y, 0) ||
                MapGen.Layers.Get(layers.coast, x, y, 0) ||
                MapGen.Layers.Get(layers.riverBank, x, y, 0) ||
                perimeterCoverProtected(x, y) ||
                self.IsStructureContextCoverCell(pContext, x, y) ||
                (occupied &&
                    occupied !== 1 &&
                    occupied !== "structure_cluster" &&
                    occupied !== "objective_structure" &&
                    occupied !== "live_structure_clearance") ||
                self.HasNearbyStructureArt(pContext, x, y, 2) ||
                self.IsCliffCell(pContext, x, y) ||
                self.IsCliffTopApronCell(pContext, x, y);
        }

        function inwardBodyWidth(x, y, dx) {
            var count = 0;
            var cx = x + dx;
            while(cx > 0 && cx < width - 1 && isTree(cx, y)) {
                ++count;
                cx += dx;
            }
            return count;
        }

        function columnTop(x, y) {
            while(y > 0 && isTree(x, y - 1))
                --y;
            return y;
        }

        function queueRun(x, topY, bottomY) {
            for(var y = topY; y <= bottomY; ++y) {
                if(!protectedCell(x, y))
                    pending[key(x, y)] = [x, y];
            }
        }

        for(var y = 1; y < height - 1; ++y) {
            for(var x = 1; x < width - 1; ++x) {
                var kind = self.ExplicitTreeBottomKind(charAt(x, y));
                if(kind !== "leftedge" && kind !== "rightedge")
                    continue;
                if(isTree(x, y + 1) || !isTree(x, y - 1))
                    continue;

                var inwardDx = kind === "leftedge" ? 1 : -1;
                var outwardDx = -inwardDx;
                if(!isTree(x + inwardDx, y) || isTree(x + outwardDx, y))
                    continue;
                if(isTree(x + outwardDx, y - 1) || isTree(x + outwardDx, y + 1))
                    continue;

                var topY = columnTop(x, y);
                var length = y - topY + 1;
                if(length > 3)
                    continue;
                if(inwardBodyWidth(x, y, inwardDx) < 3)
                    continue;
                if(inwardBodyWidth(x, topY, inwardDx) < 2)
                    continue;

                queueRun(x, topY, y);
            }
        }

        function genericRunProtected(x, y) {
            return x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1 ||
                self.IsCliffCell(pContext, x, y) ||
                self.IsCliffTopApronCell(pContext, x, y);
        }

        function queueGenericCell(x, y) {
            var replacement = self.CellChar(pContext, x, y);
            if(self.IsTreeCharValue(replacement))
                replacement = self.Chars.ground;
            pending[key(x, y)] = [x, y];
            pendingReplacement[key(x, y)] = replacement;
        }

        // Route/clearing cuts can leave a one-cell-thick shelf, tail, or waist
        // attached to an otherwise broad canopy. The scoped retail ice corpus
        // contains no horizontal or vertical runs with this topology, while
        // generated maps produced them frequently. Remove only short, fully
        // unprotected runs attached to a wider row/column at either end.
        var maxUnsupportedThinRun = Math.max(1, Math.floor(Number(
            (pContext.Profile || {}).IceTreeMaxUnsupportedThinRun || 8
        )));
        var thinRunAudit = {
            candidates: 0,
            horizontalCandidates: 0,
            verticalCandidates: 0,
            queuedRuns: 0,
            queuedCells: 0,
            tooLong: 0,
            protected: 0,
            maxLength: 0
        };

        function recordRun(axis, cells) {
            var runLength = cells.length;
            ++thinRunAudit.candidates;
            if(axis === "horizontal")
                ++thinRunAudit.horizontalCandidates;
            else
                ++thinRunAudit.verticalCandidates;
            thinRunAudit.maxLength = Math.max(thinRunAudit.maxLength, runLength);
            if(runLength > maxUnsupportedThinRun) {
                ++thinRunAudit.tooLong;
                return;
            }
            for(var cellIndex = 0; cellIndex < cells.length; ++cellIndex) {
                if(genericRunProtected(cells[cellIndex][0], cells[cellIndex][1])) {
                    ++thinRunAudit.protected;
                    return;
                }
            }
            ++thinRunAudit.queuedRuns;
            thinRunAudit.queuedCells += runLength;
            for(var queueIndex = 0; queueIndex < cells.length; ++queueIndex)
                queueGenericCell(cells[queueIndex][0], cells[queueIndex][1]);
        }

        for(var runY = 1; runY < height - 1; ++runY) {
            var runX = 1;
            while(runX < width - 1) {
                if(!isTree(runX, runY) || isTree(runX, runY - 1) || isTree(runX, runY + 1)) {
                    ++runX;
                    continue;
                }
                var startX = runX;
                var horizontalCells = [];
                while(runX < width - 1 && isTree(runX, runY) &&
                    !isTree(runX, runY - 1) && !isTree(runX, runY + 1)) {
                    horizontalCells.push([runX, runY]);
                    ++runX;
                }
                var leftAttached = isTree(startX - 1, runY) &&
                    (isTree(startX - 1, runY - 1) || isTree(startX - 1, runY + 1));
                var rightAttached = isTree(runX, runY) &&
                    (isTree(runX, runY - 1) || isTree(runX, runY + 1));
                if(leftAttached || rightAttached)
                    recordRun("horizontal", horizontalCells);
            }
        }

        for(var columnX = 1; columnX < width - 1; ++columnX) {
            var columnY = 1;
            while(columnY < height - 1) {
                if(!isTree(columnX, columnY) || isTree(columnX - 1, columnY) || isTree(columnX + 1, columnY)) {
                    ++columnY;
                    continue;
                }
                var startY = columnY;
                var verticalCells = [];
                while(columnY < height - 1 && isTree(columnX, columnY) &&
                    !isTree(columnX - 1, columnY) && !isTree(columnX + 1, columnY)) {
                    verticalCells.push([columnX, columnY]);
                    ++columnY;
                }
                var topAttached = isTree(columnX, startY - 1) &&
                    (isTree(columnX - 1, startY - 1) || isTree(columnX + 1, startY - 1));
                var bottomAttached = isTree(columnX, columnY) &&
                    (isTree(columnX - 1, columnY) || isTree(columnX + 1, columnY));
                if(topAttached || bottomAttached)
                    recordRun("vertical", verticalCells);
            }
        }
        if(pContext._iceThinRunAuditChars !== pChars) {
            pContext._iceThinRunAuditChars = pChars;
            pContext.IceTreeThinRunPrune = {
                passes: 0,
                candidates: 0,
                horizontalCandidates: 0,
                verticalCandidates: 0,
                queuedRuns: 0,
                queuedCells: 0,
                tooLong: 0,
                protected: 0,
                maxLength: 0
            };
        }
        var aggregateThinRunAudit = pContext.IceTreeThinRunPrune;
        ++aggregateThinRunAudit.passes;
        aggregateThinRunAudit.candidates += thinRunAudit.candidates;
        aggregateThinRunAudit.horizontalCandidates += thinRunAudit.horizontalCandidates;
        aggregateThinRunAudit.verticalCandidates += thinRunAudit.verticalCandidates;
        aggregateThinRunAudit.queuedRuns += thinRunAudit.queuedRuns;
        aggregateThinRunAudit.queuedCells += thinRunAudit.queuedCells;
        aggregateThinRunAudit.tooLong += thinRunAudit.tooLong;
        aggregateThinRunAudit.protected += thinRunAudit.protected;
        aggregateThinRunAudit.maxLength = Math.max(
            aggregateThinRunAudit.maxLength,
            thinRunAudit.maxLength
        );

        var changed = 0;
        for(var itemKey in pending) {
            if(!pending.hasOwnProperty(itemKey))
                continue;
            var cell = pending[itemKey];
            var replacement = pendingReplacement.hasOwnProperty(itemKey) ?
                pendingReplacement[itemKey] : self.Chars.ground;
            if(MapGen.Layers.Set(pChars, cell[0], cell[1], replacement)) {
                MapGen.Layers.Set(layers.trimmedTreeProtrusion, cell[0], cell[1], 1);
                MapGen.Layers.Set(layers.trimmedTreeLowerSideTail, cell[0], cell[1], 1);
                ++changed;
            }
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Pruned unsupported thin ice tree runs: " + changed);

        return changed;
    };

    pIce.TrimDetachedTopEdgeTreeBaseChars = function(pContext, pChars) {
        // A tree cell on row 0 with no tree directly below can only project
        // as a lower/root edge (not as a canopy continuing off-map). That is
        // the truncated top-border tree seen on large terrace maps. Retail
        // top-edge forests always continue inward on row 1; remove only the
        // detached boundary shelf and leave proper edge-connected canopies.
        if(!pContext || !pChars || pContext.Height < 2)
            return 0;

        var changed = 0;
        for(var x = 0; x < pContext.Width; ++x) {
            var edgeChar = MapGen.Layers.Get(
                pChars, x, 0, this.Chars.ground);
            var inwardChar = MapGen.Layers.Get(
                pChars, x, 1, this.Chars.ground);
            if(this.IsTreeCharValue(edgeChar) &&
                !this.IsTreeCharValue(inwardChar) &&
                MapGen.Layers.Set(pChars, x, 0, this.Chars.ground))
                ++changed;
        }
        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext,
                "Trimmed detached top-edge ice tree bases: " + changed);
        return changed;
    };

    pIce.PruneExcessSlenderTreeIslands = function(pContext, pChars) {
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var layers = pContext.Layers || {};
        var profile = pContext.Profile || {};
        var styleName = String(profile.Name || profile.RequestedName || "") + " " +
            String(profile.RouteArchetype || "") + " " +
            String(profile.ForcedIceLayoutStyle || profile.GrammarIceLayoutStyle || "");

        // Thin, disconnected walls are part of the authored maze grammar.
        // Ordinary ice layouts use isolated groves instead, so only those
        // layouts should receive the retail-corpus island budget below.
        if(styleName.toLowerCase().indexOf("maze") >= 0)
            return 0;

        var src = MapGen.Layers.Clone(pChars);
        var visited = {};
        var candidates = [];
        var protectedCount = 0;

        function key(x, y) {
            return x + "," + y;
        }

        function charAt(x, y) {
            return MapGen.Layers.Get(src, x, y, self.Chars.ground);
        }

        function isTree(x, y) {
            return x >= 0 && y >= 0 && x < width && y < height &&
                self.IsTreeCharValue(charAt(x, y));
        }

        function isHardProtected(x, y) {
            var occupied = MapGen.Layers.Get(layers.occupied, x, y, 0);
            return x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1 ||
                MapGen.Layers.Get(layers.openFieldScreen, x, y, 0) ||
                occupied === "live_structure" ||
                occupied === "live_structure_clearance" ||
                occupied === "structure_cluster" ||
                occupied === "objective_structure" ||
                self.HasNearbyStructureArt(pContext, x, y, 2) ||
                self.IsCliffCell(pContext, x, y) ||
                self.IsCliffTopApronCell(pContext, x, y) ||
                self.IsCliffFootApronCell(pContext, x, y);
        }

        function collectComponent(startX, startY) {
            var stack = [[startX, startY]];
            var cells = [];
            var minX = startX;
            var maxX = startX;
            var minY = startY;
            var maxY = startY;
            var hardProtected = false;
            visited[key(startX, startY)] = true;

            while(stack.length) {
                var cell = stack.pop();
                var x = cell[0];
                var y = cell[1];
                cells.push(cell);
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
                if(isHardProtected(x, y))
                    hardProtected = true;
                var dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
                for(var dir = 0; dir < dirs.length; ++dir) {
                    var nx = x + dirs[dir][0];
                    var ny = y + dirs[dir][1];
                    var nextKey = key(nx, ny);
                    if(visited[nextKey] || !isTree(nx, ny))
                        continue;
                    visited[nextKey] = true;
                    stack.push([nx, ny]);
                }
            }

            var componentWidth = maxX - minX + 1;
            var componentHeight = maxY - minY + 1;
            var shortSide = Math.min(componentWidth, componentHeight);
            var longSide = Math.max(componentWidth, componentHeight);
            return {
                cells: cells,
                count: cells.length,
                shortSide: shortSide,
                longSide: longSide,
                aspect: longSide / Math.max(1, shortSide),
                protectedCell: hardProtected,
                minX: minX,
                minY: minY
            };
        }

        for(var y = 0; y < height; ++y) {
            for(var x = 0; x < width; ++x) {
                var cellKey = key(x, y);
                if(visited[cellKey] || !isTree(x, y))
                    continue;
                var component = collectComponent(x, y);
                var standardSliver = component.shortSide <= 4 && component.aspect >= 1.6;
                var broadSliver = component.shortSide <= 5 && component.aspect >= 2.2;
                if(component.count < 8 || component.count > 96 ||
                    component.longSide < 5 || (!standardSliver && !broadSliver))
                    continue;
                if(component.protectedCell) {
                    ++protectedCount;
                    continue;
                }
                candidates.push(component);
            }
        }

        // The scoped retail ice corpus normally has zero to two such islands
        // per map, including its larger authored maps. Keep the most
        // substantial/rounded examples and remove only the surplus slivers.
        var allowed = 2;
        candidates.sort(function(left, right) {
            if(left.aspect !== right.aspect)
                return left.aspect - right.aspect;
            if(left.shortSide !== right.shortSide)
                return right.shortSide - left.shortSide;
            if(left.count !== right.count)
                return right.count - left.count;
            if(left.minY !== right.minY)
                return left.minY - right.minY;
            return left.minX - right.minX;
        });

        var changed = 0;
        var prunedComponents = 0;
        for(var candidateIndex = allowed; candidateIndex < candidates.length; ++candidateIndex) {
            var prune = candidates[candidateIndex];
            ++prunedComponents;
            for(var cellIndex = 0; cellIndex < prune.cells.length; ++cellIndex) {
                var pruneCell = prune.cells[cellIndex];
                var replacement = self.CellChar(pContext, pruneCell[0], pruneCell[1]);
                if(self.IsTreeCharValue(replacement))
                    replacement = self.Chars.ground;
                if(MapGen.Layers.Set(pChars, pruneCell[0], pruneCell[1], replacement)) {
                    self.ClearTrimmedTreeMarkers(pContext, pruneCell[0], pruneCell[1]);
                    ++changed;
                }
            }
        }

        pContext.IceTreeSlenderIslandPrune = {
            candidates: candidates.length,
            allowed: allowed,
            protectedComponents: protectedCount,
            prunedComponents: prunedComponents,
            prunedCells: changed
        };

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext,
                "Pruned excess slender ice tree islands: " + prunedComponents +
                " components / " + changed + " cells");

        return changed;
    };

    pIce.PruneExcessSlenderTreeFingers = function(pContext, pChars) {
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var layers = pContext.Layers || {};
        var profile = pContext.Profile || {};
        var styleName = String(profile.Name || profile.RequestedName || "") + " " +
            String(profile.RouteArchetype || "") + " " +
            String(profile.ForcedIceLayoutStyle || profile.GrammarIceLayoutStyle || "");
        if(styleName.toLowerCase().indexOf("maze") >= 0)
            return 0;

        var src = MapGen.Layers.Clone(pChars);
        var raw = [];

        function key(x, y) {
            return x + "," + y;
        }

        function isTree(x, y) {
            return x >= 0 && y >= 0 && x < width && y < height &&
                self.IsTreeCharValue(MapGen.Layers.Get(src, x, y, self.Chars.ground));
        }

        function horizontalRun(x, y) {
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

        function verticalRun(x, y) {
            if(!isTree(x, y))
                return null;
            var start = y;
            while(start > 0 && isTree(x, start - 1))
                --start;
            var end = y;
            while(end < height - 1 && isTree(x, end + 1))
                ++end;
            return { start: start, end: end, length: end - start + 1 };
        }

        function collectVerticalFinger(run, y, outwardDy) {
            var cells = [];
            var minX = run.start;
            var maxX = run.end;
            var traceY = y;
            var rows = 0;
            var anchored = false;
            for(var depth = 0; depth < 14; ++depth) {
                var probeX = -1;
                for(var x = Math.max(0, minX - 1); x <= Math.min(width - 1, maxX + 1); ++x) {
                    if(isTree(x, traceY)) {
                        probeX = x;
                        break;
                    }
                }
                if(probeX < 0)
                    break;
                var row = horizontalRun(probeX, traceY);
                if(!row)
                    break;
                if(row.length > 4) {
                    anchored = true;
                    break;
                }
                for(var cellX = row.start; cellX <= row.end; ++cellX)
                    cells.push([cellX, traceY]);
                minX = row.start;
                maxX = row.end;
                ++rows;
                traceY -= outwardDy;
                if(traceY < 0 || traceY >= height)
                    break;
            }
            if(!anchored || rows < 5)
                return null;
            return { axis: "vertical", length: rows, cells: cells };
        }

        function collectHorizontalFinger(run, x, outwardDx) {
            var cells = [];
            var minY = run.start;
            var maxY = run.end;
            var traceX = x;
            var columns = 0;
            var anchored = false;
            for(var depth = 0; depth < 14; ++depth) {
                var probeY = -1;
                for(var y = Math.max(0, minY - 1); y <= Math.min(height - 1, maxY + 1); ++y) {
                    if(isTree(traceX, y)) {
                        probeY = y;
                        break;
                    }
                }
                if(probeY < 0)
                    break;
                var column = verticalRun(traceX, probeY);
                if(!column)
                    break;
                if(column.length > 4) {
                    anchored = true;
                    break;
                }
                for(var cellY = column.start; cellY <= column.end; ++cellY)
                    cells.push([traceX, cellY]);
                minY = column.start;
                maxY = column.end;
                ++columns;
                traceX -= outwardDx;
                if(traceX < 0 || traceX >= width)
                    break;
            }
            if(!anchored || columns < 5)
                return null;
            return { axis: "horizontal", length: columns, cells: cells };
        }

        for(var outwardDy = -1; outwardDy <= 1; outwardDy += 2) {
            for(var y = 0; y < height; ++y) {
                var x = 0;
                while(x < width) {
                    if(!isTree(x, y)) {
                        ++x;
                        continue;
                    }
                    var row = horizontalRun(x, y);
                    x = row.end + 1;
                    if(row.length > 4)
                        continue;
                    var tipY = y + outwardDy;
                    var terminal = true;
                    for(var rowX = row.start; rowX <= row.end; ++rowX) {
                        if(isTree(rowX, tipY)) {
                            terminal = false;
                            break;
                        }
                    }
                    if(terminal) {
                        var verticalFinger = collectVerticalFinger(row, y, outwardDy);
                        if(verticalFinger)
                            raw.push(verticalFinger);
                    }
                }
            }
        }

        for(var outwardDx = -1; outwardDx <= 1; outwardDx += 2) {
            for(var x = 0; x < width; ++x) {
                var y = 0;
                while(y < height) {
                    if(!isTree(x, y)) {
                        ++y;
                        continue;
                    }
                    var column = verticalRun(x, y);
                    y = column.end + 1;
                    if(column.length > 4)
                        continue;
                    var tipX = x + outwardDx;
                    var terminal = true;
                    for(var columnY = column.start; columnY <= column.end; ++columnY) {
                        if(isTree(tipX, columnY)) {
                            terminal = false;
                            break;
                        }
                    }
                    if(terminal) {
                        var horizontalFinger = collectHorizontalFinger(column, x, outwardDx);
                        if(horizontalFinger)
                            raw.push(horizontalFinger);
                    }
                }
            }
        }

        raw.sort(function(left, right) { return right.cells.length - left.cells.length; });
        var candidates = [];
        for(var rawIndex = 0; rawIndex < raw.length; ++rawIndex) {
            var item = raw[rawIndex];
            var itemSet = {};
            for(var itemCell = 0; itemCell < item.cells.length; ++itemCell)
                itemSet[key(item.cells[itemCell][0], item.cells[itemCell][1])] = true;
            var duplicate = false;
            for(var existingIndex = 0; existingIndex < candidates.length; ++existingIndex) {
                var existing = candidates[existingIndex];
                var overlap = 0;
                for(var overlapKey in itemSet) {
                    if(itemSet.hasOwnProperty(overlapKey) && existing.cellSet[overlapKey])
                        ++overlap;
                }
                if(overlap >= Math.ceil(Math.min(item.cells.length, existing.cells.length) * 0.6)) {
                    duplicate = true;
                    break;
                }
            }
            if(duplicate)
                continue;
            item.cellSet = itemSet;
            candidates.push(item);
        }

        var protectedCount = 0;
        var removable = [];
        for(var candidateIndex = 0; candidateIndex < candidates.length; ++candidateIndex) {
            var candidate = candidates[candidateIndex];
            var hardProtected = false;
            for(var candidateCell = 0; candidateCell < candidate.cells.length; ++candidateCell) {
                var cell = candidate.cells[candidateCell];
                var cellX = cell[0];
                var cellY = cell[1];
                var occupied = MapGen.Layers.Get(layers.occupied, cellX, cellY, 0);
                if(cellX <= 0 || cellY <= 0 || cellX >= width - 1 || cellY >= height - 1 ||
                    MapGen.Layers.Get(layers.openFieldScreen, cellX, cellY, 0) ||
                    occupied === "live_structure" ||
                    occupied === "live_structure_clearance" ||
                    occupied === "structure_cluster" ||
                    occupied === "objective_structure" ||
                    self.HasNearbyStructureArt(pContext, cellX, cellY, 2) ||
                    self.IsCliffCell(pContext, cellX, cellY) ||
                    self.IsCliffTopApronCell(pContext, cellX, cellY) ||
                    self.IsCliffFootApronCell(pContext, cellX, cellY))
                    hardProtected = true;
            }
            if(hardProtected) {
                ++protectedCount;
                continue;
            }
            removable.push(candidate);
        }

        // Authored ice maps contain at most two attached narrow fingers in the
        // scoped corpus. Keep the shorter/thicker examples and remove surplus
        // spikes, independent of canvas size.
        var allowed = 2;
        removable.sort(function(left, right) {
            if(left.length !== right.length)
                return left.length - right.length;
            var leftThickness = left.cells.length / left.length;
            var rightThickness = right.cells.length / right.length;
            if(leftThickness !== rightThickness)
                return rightThickness - leftThickness;
            return right.cells.length - left.cells.length;
        });

        var changed = 0;
        var prunedFingers = 0;
        for(var pruneIndex = allowed; pruneIndex < removable.length; ++pruneIndex) {
            var prune = removable[pruneIndex];
            ++prunedFingers;
            for(var pruneCellIndex = 0; pruneCellIndex < prune.cells.length; ++pruneCellIndex) {
                var pruneCell = prune.cells[pruneCellIndex];
                var replacement = self.CellChar(pContext, pruneCell[0], pruneCell[1]);
                if(self.IsTreeCharValue(replacement))
                    replacement = self.Chars.ground;
                if(MapGen.Layers.Set(pChars, pruneCell[0], pruneCell[1], replacement)) {
                    self.ClearTrimmedTreeMarkers(pContext, pruneCell[0], pruneCell[1]);
                    ++changed;
                }
            }
        }

        pContext.IceTreeSlenderFingerPrune = {
            candidates: candidates.length,
            removable: removable.length,
            allowed: allowed,
            protectedFingers: protectedCount,
            prunedFingers: prunedFingers,
            prunedCells: changed
        };
        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext,
                "Pruned excess slender ice tree fingers: " + prunedFingers +
                " fingers / " + changed + " cells");

        return changed;
    };
})(MapGen.Terrain.Smoothing.Ice);
