var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};
MapGen.Terrain.Smoothing.Ice = MapGen.Terrain.Smoothing.Ice || {};

(function(pIce) {
    pIce.TrimUnsupportedTreeProtrusionChars = function(pContext, pChars, pOptions) {
        var src = MapGen.Layers.Clone(pChars);
        var pending = {};
        var self = this;
        var layers = pContext.Layers || {};
        var preserveMarkers = !!(pOptions && pOptions.PreserveMarkers);
        if(layers) {
            if(!preserveMarkers || !layers.trimmedTreeProtrusion)
                layers.trimmedTreeProtrusion = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
            if(!preserveMarkers || !layers.trimmedTreeLowerSideTail)
                layers.trimmedTreeLowerSideTail = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
            if(!preserveMarkers || !layers.trimmedTreeTopSideTab)
                layers.trimmedTreeTopSideTab = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
        }

        function key(x, y) {
            return x + "," + y;
        }

        function charAt(x, y) {
            return MapGen.Layers.Get(src, x, y, self.Chars.ground);
        }

        function isTree(x, y) {
            return self.IsTreeCharValue(charAt(x, y));
        }

        function perimeterCoverProtected(x, y) {
            return MapGen.Layers.Get(layers.perimeterCover, x, y, 0) &&
                (x <= 1 || y <= 1 || x >= pContext.Width - 2 || y >= pContext.Height - 2);
        }

        function hardProtected(x, y) {
            return x <= 0 || y <= 0 || x >= pContext.Width - 1 || y >= pContext.Height - 1 ||
                MapGen.Layers.Get(layers.path, x, y, 0) ||
                MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                MapGen.Layers.Get(layers.water, x, y, 0) ||
                perimeterCoverProtected(x, y) ||
                self.IsStructureContextCoverCell(pContext, x, y) ||
                MapGen.Layers.Get(layers.coast, x, y, 0) ||
                MapGen.Layers.Get(layers.riverBank, x, y, 0) ||
                MapGen.Layers.Get(layers.occupied, x, y, 0) ||
                self.IsCliffCell(pContext, x, y) ||
                self.IsCliffTopApronCell(pContext, x, y);
        }

        function hardProtectedForTailTrim(x, y) {
            return x <= 0 || y <= 0 || x >= pContext.Width - 1 || y >= pContext.Height - 1 ||
                perimeterCoverProtected(x, y) ||
                self.IsStructureContextCoverCell(pContext, x, y);
        }

        function queue(x, y) {
            if(!hardProtected(x, y))
                pending[key(x, y)] = [x, y];
        }

        var lowerTailPending = {};
        var topSideTabPending = {};

        function queueLowerTailTrim(x, y) {
            if(!hardProtectedForTailTrim(x, y)) {
                var cellKey = key(x, y);
                pending[cellKey] = [x, y];
                lowerTailPending[cellKey] = true;
            }
        }

        function queueTopSideTabTrim(x, y) {
            if(!hardProtectedForTailTrim(x, y)) {
                var cellKey = key(x, y);
                pending[cellKey] = [x, y];
                topSideTabPending[cellKey] = true;
            }
        }

        function inwardBodyWidth(x, y, dx) {
            var count = 0;
            var cx = x + dx;
            while(cx > 0 && cx < pContext.Width - 1 && isTree(cx, y)) {
                ++count;
                cx += dx;
            }
            return count;
        }

        function sameColumnRunLengthEndingAt(x, y) {
            var top = y;
            while(top > 0 && isTree(x, top - 1))
                --top;
            var bottom = y;
            while(bottom < pContext.Height - 1 && isTree(x, bottom + 1))
                ++bottom;
            return bottom - top + 1;
        }

        for(var x = 1; x < pContext.Width - 1; ++x) {
            for(var y = 1; y < pContext.Height - 1; ++y) {
                if(!isTree(x, y))
                    continue;

                var n = isTree(x, y - 1);
                var e = isTree(x + 1, y);
                var s = isTree(x, y + 1);
                var w = isTree(x - 1, y);

                // Pointed one-cell tree tips render as a loose top tile above
                // the actual canopy. Keep only tips that have horizontal body.
                if(!n && !e && !w && s && (isTree(x - 1, y + 1) || isTree(x + 1, y + 1))) {
                    queue(x, y);
                    continue;
                }

                // A one-cell horizontal tab with no vertical support reads as
                // a loose canopy flap. Keep only side tabs that have either
                // tree above/below or a wider vertical body.
                if(!n && !s && e !== w) {
                    var sideInwardDx = e ? 1 : -1;
                    if(inwardBodyWidth(x, y, sideInwardDx) >= 3) {
                        queueTopSideTabTrim(x, y);
                        continue;
                    }
                }

                // A two-cell side tab near the top of a wider canopy renders
                // as a detached trunk pair. It is the top-edge equivalent of
                // the lower side-tail trim below.
                if(!n && s && !e && w && !isTree(x, y + 2) &&
                    inwardBodyWidth(x, y, -1) >= 3 &&
                    inwardBodyWidth(x, y + 1, -1) >= 3 &&
                    !hardProtectedForTailTrim(x, y) &&
                    !hardProtectedForTailTrim(x, y + 1)) {
                    queueTopSideTabTrim(x, y);
                    queueTopSideTabTrim(x, y + 1);
                    continue;
                }
                if(!n && s && e && !w && !isTree(x, y + 2) &&
                    inwardBodyWidth(x, y, 1) >= 3 &&
                    inwardBodyWidth(x, y + 1, 1) >= 3 &&
                    !hardProtectedForTailTrim(x, y) &&
                    !hardProtectedForTailTrim(x, y + 1)) {
                    queueTopSideTabTrim(x, y);
                    queueTopSideTabTrim(x, y + 1);
                    continue;
                }

                // Trim a two-cell lower shelf hanging under a wider canopy
                // shoulder. These shelves generate short right/left edge
                // stacks that look like detached trunks even after the top
                // side-tab pass has run.
                if(!s && !isTree(x + 1, y + 1) &&
                    e && !w &&
                    n && isTree(x + 1, y - 1) &&
                    !isTree(x + 2, y) &&
                    inwardBodyWidth(x + 1, y - 1, -1) >= 3) {
                    queueLowerTailTrim(x, y);
                    queueLowerTailTrim(x + 1, y);
                    continue;
                }
                if(!s && !isTree(x - 1, y + 1) &&
                    w && !e &&
                    n && isTree(x - 1, y - 1) &&
                    !isTree(x - 2, y) &&
                    inwardBodyWidth(x - 1, y - 1, 1) >= 3) {
                    queueLowerTailTrim(x, y);
                    queueLowerTailTrim(x - 1, y);
                    continue;
                }

                // Shave at most two cells from a lower left/right tree edge
                // when a one-column side tail hangs below a wider canopy body.
                if(s || !n || e === w)
                    continue;

                var inwardDx = w ? -1 : 1;
                var outwardDx = -inwardDx;
                if(isTree(x + outwardDx, y) || isTree(x + outwardDx, y - 1) || isTree(x + outwardDx, y + 1))
                    continue;
                if(inwardBodyWidth(x, y, inwardDx) < 3 || inwardBodyWidth(x, y - 1, inwardDx) < 3)
                    continue;
                if(sameColumnRunLengthEndingAt(x, y) > 5)
                    continue;

                queueLowerTailTrim(x, y);

                var y2 = y - 1;
                if(isTree(x, y2) &&
                    isTree(x + inwardDx, y2) &&
                    !isTree(x + outwardDx, y2) &&
                    inwardBodyWidth(x, y2, inwardDx) >= 3)
                    queueLowerTailTrim(x, y2);
            }
        }

        var changed = 0;
        for(var itemKey in pending) {
            if(!pending.hasOwnProperty(itemKey))
                continue;
            var cell = pending[itemKey];
            if(MapGen.Layers.Set(pChars, cell[0], cell[1], this.Chars.ground)) {
                MapGen.Layers.Set(layers.trimmedTreeProtrusion, cell[0], cell[1], 1);
                if(lowerTailPending[itemKey])
                    MapGen.Layers.Set(layers.trimmedTreeLowerSideTail, cell[0], cell[1], 1);
                if(topSideTabPending[itemKey])
                    MapGen.Layers.Set(layers.trimmedTreeTopSideTab, cell[0], cell[1], 1);
                ++changed;
            }
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Trimmed unsupported ice tree protrusions: " + changed);

        return changed;
    };

    pIce.TrimUnsupportedTreeTopSideTabs = function(pContext, pChars, pOptions) {
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var layers = pContext.Layers || {};
        var options = pOptions || {};
        var iterateLowerSideColumns = !!options.IterateLowerSideColumns;
        var maxLowerSideColumnPasses = options.MaxLowerSideColumnPasses || 3;
        var Get = MapGen.Layers.Get;
        var Set = MapGen.Layers.Set;
        var GROUND = this.Chars.ground;
        var TREE = this.Chars.tree;
        if(layers && !layers.trimmedTreeProtrusion)
            layers.trimmedTreeProtrusion = MapGen.Layers.Create(width, height, 0);
        if(layers && !layers.trimmedTreeTopSideTab)
            layers.trimmedTreeTopSideTab = MapGen.Layers.Create(width, height, 0);
        if(layers && !layers.trimmedTreeLowerSideTail)
            layers.trimmedTreeLowerSideTail = MapGen.Layers.Create(width, height, 0);

        function isTree(x, y) {
            if(x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1)
                return false;
            var value = Get(pChars, x, y, GROUND);
            return value === TREE || value === "M" || value === "L" || value === "R";
        }

        function perimeterCoverProtected(x, y) {
            return Get(layers.perimeterCover, x, y, 0) &&
                (x <= 1 || y <= 1 || x >= width - 2 || y >= height - 2);
        }

        function protectedCell(x, y) {
            return x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1 ||
                Get(layers.path, x, y, 0) ||
                Get(layers.crossing, x, y, 0) ||
                Get(layers.water, x, y, 0) ||
                perimeterCoverProtected(x, y) ||
                self.IsStructureContextCoverCell(pContext, x, y) ||
                Get(layers.coast, x, y, 0) ||
                Get(layers.riverBank, x, y, 0) ||
                self.HasNearbyStructureArt(pContext, x, y, 2) ||
                self.IsCliffCell(pContext, x, y) ||
                self.IsCliffTopApronCell(pContext, x, y);
        }

        function protectedShapeCleanupCell(x, y) {
            var occupied = Get(layers.occupied, x, y, 0);
            return x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1 ||
                Get(layers.crossing, x, y, 0) ||
                Get(layers.water, x, y, 0) ||
                Get(layers.coast, x, y, 0) ||
                Get(layers.riverBank, x, y, 0) ||
                self.IsStructureContextCoverCell(pContext, x, y) ||
                occupied === "live_structure" ||
                occupied === "live_structure_clearance" ||
                occupied === "structure_cluster" ||
                occupied === "objective_structure" ||
                occupied === "team_spawn" ||
                self.HasNearbyStructureArt(pContext, x, y, 2) ||
                self.IsCliffCell(pContext, x, y) ||
                self.IsCliffTopApronCell(pContext, x, y);
        }

        function protectedTopSideTabCell(x, y) {
            // structureContextCover is a density hint, not authored terrain.
            // It must not preserve a visibly detached two-cell canopy shelf.
            // Keep every hard gameplay/terrain constraint protected instead.
            return x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1 ||
                Get(layers.path, x, y, 0) ||
                Get(layers.crossing, x, y, 0) ||
                Get(layers.water, x, y, 0) ||
                perimeterCoverProtected(x, y) ||
                Get(layers.coast, x, y, 0) ||
                Get(layers.riverBank, x, y, 0) ||
                Get(layers.occupied, x, y, 0) ||
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

        function sameColumnRunLength(x, y) {
            var top = y;
            while(top > 0 && isTree(x, top - 1))
                --top;
            var bottom = y;
            while(bottom < height - 1 && isTree(x, bottom + 1))
                ++bottom;
            return bottom - top + 1;
        }

        function cellKey(x, y) {
            return x + "," + y;
        }

        function queueTopSideTab(pending, topSidePending, x, y) {
            if(protectedTopSideTabCell(x, y))
                return;
            var key = cellKey(x, y);
            pending[key] = [x, y];
            topSidePending[key] = true;
        }

        function queueLowerTail(pending, lowerTailPending, x, y) {
            if(protectedCell(x, y))
                return;
            var key = cellKey(x, y);
            pending[key] = [x, y];
            lowerTailPending[key] = true;
        }

        function queueLowerSideColumnTail(pending, lowerTailPending, x, y) {
            if(protectedShapeCleanupCell(x, y))
                return;
            var key = cellKey(x, y);
            pending[key] = [x, y];
            lowerTailPending[key] = true;
        }

        function queueIfSingleSideFlap(pending, topSidePending, x, y) {
            if(!isTree(x, y))
                return;
            if(isTree(x, y - 1) || isTree(x, y + 1))
                return;

            var e = isTree(x + 1, y);
            var w = isTree(x - 1, y);
            if(e === w)
                return;

            var inwardDx = e ? 1 : -1;
            var outwardDx = -inwardDx;
            if(isTree(x + outwardDx, y))
                return;
            if(inwardBodyWidth(x, y, inwardDx) < 3)
                return;

            queueTopSideTab(pending, topSidePending, x, y);
        }

        function queueIfStaggeredTopSideFlap(pending, topSidePending, x, y) {
            if(!isTree(x, y))
                return;
            if(isTree(x, y - 1) || isTree(x, y + 1))
                return;

            var e = isTree(x + 1, y);
            var w = isTree(x - 1, y);
            if(e === w)
                return;

            var inwardDx = e ? 1 : -1;
            var outwardDx = -inwardDx;
            if(isTree(x + outwardDx, y) || isTree(x + outwardDx, y + 1))
                return;

            if(inwardBodyWidth(x, y, inwardDx) < 2)
                return;
            if(inwardBodyWidth(x, y + 1, inwardDx) < 2)
                return;
            if(!isTree(x + inwardDx, y + 1))
                return;

            queueTopSideTab(pending, topSidePending, x, y);
        }

        function queueIfLowerShelf(pending, lowerTailPending, x, y) {
            if(isTree(x, y) && isTree(x + 1, y) &&
                !isTree(x - 1, y) && !isTree(x + 2, y) &&
                !isTree(x, y + 1) && !isTree(x + 1, y + 1) &&
                isTree(x, y - 1) && isTree(x + 1, y - 1) &&
                inwardBodyWidth(x + 1, y - 1, -1) >= 3) {
                queueLowerTail(pending, lowerTailPending, x, y);
                queueLowerTail(pending, lowerTailPending, x + 1, y);
                return;
            }

            if(isTree(x, y) && isTree(x - 1, y) &&
                !isTree(x + 1, y) && !isTree(x - 2, y) &&
                !isTree(x, y + 1) && !isTree(x - 1, y + 1) &&
                isTree(x, y - 1) && isTree(x - 1, y - 1) &&
                inwardBodyWidth(x - 1, y - 1, 1) >= 3) {
                queueLowerTail(pending, lowerTailPending, x, y);
                queueLowerTail(pending, lowerTailPending, x - 1, y);
            }
        }

        function queueIfShortLowerSideTail(pending, lowerTailPending, x, y) {
            if(!isTree(x, y) || isTree(x, y + 1) || !isTree(x, y - 1))
                return;

            var e = isTree(x + 1, y);
            var w = isTree(x - 1, y);
            if(e === w)
                return;

            var inwardDx = w ? -1 : 1;
            var outwardDx = -inwardDx;
            if(isTree(x + outwardDx, y) ||
                isTree(x + outwardDx, y - 1) ||
                isTree(x + outwardDx, y + 1))
                return;

            var lowerWidth = inwardBodyWidth(x, y, inwardDx);
            var upperWidth = inwardBodyWidth(x, y - 1, inwardDx);
            if(upperWidth < 3 || lowerWidth < 2)
                return;
            if(sameColumnRunLength(x, y) > 6)
                return;

            queueLowerTail(pending, lowerTailPending, x, y);

            if(isTree(x, y - 1) &&
                isTree(x + inwardDx, y - 1) &&
                !isTree(x + outwardDx, y - 1) &&
                inwardBodyWidth(x, y - 1, inwardDx) >= 3)
                queueLowerTail(pending, lowerTailPending, x, y - 1);
        }

        function queueIfLowerSideColumnEnd(pending, lowerTailPending, x, y, pMinWidth) {
            if(y <= 2 || y >= height - 2)
                return;
            if(!isTree(x, y) || isTree(x, y + 1) || !isTree(x, y - 1))
                return;

            var e = isTree(x + 1, y);
            var w = isTree(x - 1, y);
            if(e === w)
                return;

            var inwardDx = w ? -1 : 1;
            var outwardDx = -inwardDx;
            if(isTree(x + outwardDx, y) ||
                isTree(x + outwardDx, y - 1) ||
                isTree(x + outwardDx, y + 1))
                return;

            var lowerWidth = inwardBodyWidth(x, y, inwardDx);
            var upperWidth = inwardBodyWidth(x, y - 1, inwardDx);
            var minWidth = pMinWidth || 1;
            if(lowerWidth < minWidth || upperWidth < minWidth)
                return;

            queueLowerSideColumnTail(pending, lowerTailPending, x, y);

            var verticalMinWidth = minWidth > 1 ? minWidth : 3;
            if(lowerWidth >= verticalMinWidth && upperWidth >= verticalMinWidth &&
                isTree(x, y - 1) &&
                isTree(x + inwardDx, y - 1) &&
                !isTree(x + outwardDx, y - 1)) {
                queueLowerSideColumnTail(pending, lowerTailPending, x, y - 1);
            }
        }

        function applyPending(pending, lowerTailPending, topSidePending) {
            var applied = 0;
            for(var itemKey in pending) {
                if(!pending.hasOwnProperty(itemKey))
                    continue;
                var cell = pending[itemKey];
                if(Set(pChars, cell[0], cell[1], GROUND)) {
                    Set(layers.trimmedTreeProtrusion, cell[0], cell[1], 1);
                    if(lowerTailPending[itemKey])
                        Set(layers.trimmedTreeLowerSideTail, cell[0], cell[1], 1);
                    if(topSidePending[itemKey])
                        Set(layers.trimmedTreeTopSideTab, cell[0], cell[1], 1);
                    ++applied;
                }
            }
            return applied;
        }

        function queueIfSideTab(pending, topSidePending, x, y, inwardDx) {
            var outwardDx = -inwardDx;
            if(!isTree(x, y) || !isTree(x, y + 1))
                return;
            if(isTree(x, y - 1) || isTree(x, y + 2))
                return;
            if(isTree(x + outwardDx, y) || isTree(x + outwardDx, y + 1))
                return;
            if(!isTree(x + inwardDx, y) || !isTree(x + inwardDx, y + 1))
                return;
            var upperWidth = inwardBodyWidth(x, y, inwardDx);
            var lowerWidth = inwardBodyWidth(x, y + 1, inwardDx);
            if(upperWidth < 2 || lowerWidth < 2)
                return;
            // Accept a 2-over-3 tapered shoulder as well as the broad 3/3
            // case. Keeping its outer two-cell column creates a detached
            // brown trunk stack; removing it leaves a normal tapered grove.
            if(upperWidth < 3 && lowerWidth < 3)
                return;
            if(lowerWidth < 3 && upperWidth < 4)
                return;
            if(protectedTopSideTabCell(x, y) ||
                protectedTopSideTabCell(x, y + 1))
                return;

            queueTopSideTab(pending, topSidePending, x, y);
            queueTopSideTab(pending, topSidePending, x, y + 1);
        }

        var scanBounds = this.LocalRenderBounds(pContext, 12);
        var scanMinX = Math.max(1, scanBounds.minX);
        var scanMinY = Math.max(1, scanBounds.minY);
        var scanMaxX = Math.min(width - 2, scanBounds.maxX);
        var scanMaxY = Math.min(height - 3, scanBounds.maxY);

        var pending = {};
        var topSidePending = {};
        var lowerTailPending = {};
        for(var x = scanMinX; x <= scanMaxX; ++x) {
            for(var y = scanMinY; y <= scanMaxY; ++y) {
                // Every rule below requires a tree at the current cell.
                if(!isTree(x, y))
                    continue;
                queueIfSingleSideFlap(pending, topSidePending, x, y);
                queueIfStaggeredTopSideFlap(pending, topSidePending, x, y);
                queueIfLowerShelf(pending, lowerTailPending, x, y);
                queueIfShortLowerSideTail(pending, lowerTailPending, x, y);
                queueIfLowerSideColumnEnd(pending, lowerTailPending, x, y);
                queueIfSideTab(pending, topSidePending, x, y, -1);
                queueIfSideTab(pending, topSidePending, x, y, 1);
            }
        }

        var changed = applyPending(pending, lowerTailPending, topSidePending);

        if(changed) {
            if(iterateLowerSideColumns) {
                for(var pass = 0; pass < maxLowerSideColumnPasses; ++pass) {
                    var lowerColumnPending = {};
                    var lowerColumnTailPending = {};
                    var lowerColumnTopSidePending = {};
                    for(var lx = scanMinX; lx <= scanMaxX; ++lx) {
                        for(var ly = scanMinY; ly <= scanMaxY; ++ly)
                            queueIfLowerSideColumnEnd(lowerColumnPending, lowerColumnTailPending, lx, ly, 4);
                    }

                    var lowerColumnChanged = applyPending(lowerColumnPending, lowerColumnTailPending, lowerColumnTopSidePending);
                    if(!lowerColumnChanged)
                        break;
                    changed += lowerColumnChanged;
                }
            }

            // Removing an outer flap can expose another unsupported shelf one
            // cell inward. Iterate a small, bounded number of times so the
            // final canopy edge is stable before it is projected to tiles.
            for(var exposedPass = 0; exposedPass < 3; ++exposedPass) {
                var exposedPending = {};
                var exposedTopSidePending = {};
                var exposedLowerTailPending = {};
                for(var ex = scanMinX; ex <= scanMaxX; ++ex) {
                    for(var ey = scanMinY; ey <= scanMaxY; ++ey) {
                        if(!isTree(ex, ey))
                            continue;
                        queueIfSingleSideFlap(exposedPending, exposedTopSidePending, ex, ey);
                        queueIfStaggeredTopSideFlap(exposedPending, exposedTopSidePending, ex, ey);
                        queueIfSideTab(exposedPending, exposedTopSidePending, ex, ey, -1);
                        queueIfSideTab(exposedPending, exposedTopSidePending, ex, ey, 1);
                    }
                }

                var exposedChanged = applyPending(exposedPending, exposedLowerTailPending, exposedTopSidePending);
                if(!exposedChanged)
                    break;
                changed += exposedChanged;
            }
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Trimmed unsupported ice tree top side tabs: " + changed);

        return changed;
    };

    pIce.RepairUnsupportedTreeConcavityChars = function(pContext, pChars) {
        var src = MapGen.Layers.Clone(pChars);
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var layers = pContext.Layers || {};
        var pending = {};
        var runtime = this.TreeRuntimeData ? this.TreeRuntimeData() : null;

        function cellKey(x, y) {
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

        function canFill(x, y) {
            if(x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1)
                return false;
            if(charAt(x, y) !== self.Chars.ground)
                return false;
            if(MapGen.Layers.Get(layers.path, x, y, 0) ||
                MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                MapGen.Layers.Get(layers.water, x, y, 0) ||
                MapGen.Layers.Get(layers.coast, x, y, 0) ||
                MapGen.Layers.Get(layers.riverBank, x, y, 0) ||
                MapGen.Layers.Get(layers.occupied, x, y, 0))
                return false;
            if(self.HasNearbyStructureArt(pContext, x, y, 2) ||
                self.IsCliffCell(pContext, x, y) ||
                self.IsCliffTopApronCell(pContext, x, y) ||
                self.IsCliffFootApronCell(pContext, x, y))
                return false;
            return true;
        }

        function prospectiveTreeShapeHasCandidates(x, y) {
            if(!runtime || !self.TreeCandidatesForShape)
                return false;
            var shapeKey = self.TreeShapeKey(isTree, x, y);
            var connectKey = self.TreeConnectKey(isTree, x, y);
            var candidates = self.TreeCandidatesForShape(runtime, shapeKey, connectKey);
            return !!(candidates && candidates.length);
        }

        for(var y = 1; y < height - 2; ++y) {
            for(var x = 1; x < width - 2; ++x) {
                if(!isTree(x, y))
                    continue;

                // Unsupported one-cell bites out of dense tree bodies. These
                // appear as local shapes with a single missing north/south or
                // south-east neighbour, and originals solve them by making the
                // canopy continuous before stack roles are assigned.
                var shape = this.TreeShapeKey(isTree, x, y);
                var fx = -1;
                var fy = -1;
                if(shape === ".TTTTTT.") {
                    fx = x + 1; fy = y + 1;
                } else if(shape === "T.TTTTTT") {
                    fx = x; fy = y - 1;
                } else if(shape === "TTTTTT.T") {
                    fx = x; fy = y + 1;
                } else if(shape === "TT.TT.TT") {
                    fx = x + 1; fy = y - 1;
                    if(!canFill(fx, fy)) { fx = x - 1; fy = y + 1; }
                } else if(shape === "TTTTT.T.") {
                    fx = x - 1; fy = y + 1;
                    if(!canFill(fx, fy)) { fx = x + 1; fy = y + 1; }
                } else if(shape === ".TT.T.T.") {
                    fx = x - 1; fy = y;
                    if(!canFill(fx, fy)) { fx = x - 1; fy = y + 1; }
                } else {
                    continue;
                }

                if(canFill(fx, fy) && !prospectiveTreeShapeHasCandidates(fx, fy))
                    pending[cellKey(fx, fy)] = [fx, fy];
            }
        }

        var changed = 0;
        for(var key in pending) {
            if(!pending.hasOwnProperty(key))
                continue;
            var cell = pending[key];
            if(MapGen.Layers.Set(pChars, cell[0], cell[1], self.Chars.tree)) {
                self.ClearTrimmedTreeMarkers(pContext, cell[0], cell[1]);
                ++changed;
            }
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Repaired unsupported ice tree concavities: " + changed);

        return changed;
    };

    pIce.RepairDiagonalTreeEdgeStairChars = function(pContext, pChars, pOptions) {
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var layers = pContext.Layers || {};
        var src = null;
        var runCache = null;
        var runtime = this.TreeRuntimeData ? this.TreeRuntimeData() : null;
        var options = pOptions || {};

        function cellKey(x, y) {
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

        function shapeAt(x, y) {
            return self.TreeShapeKey(isTree, x, y);
        }

        function canFill(x, y) {
            if(x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1)
                return false;
            if(charAt(x, y) !== self.Chars.ground)
                return false;
            var occupied = MapGen.Layers.Get(layers.occupied, x, y, 0);
            if(MapGen.Layers.Get(layers.path, x, y, 0) ||
                MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                MapGen.Layers.Get(layers.water, x, y, 0) ||
                MapGen.Layers.Get(layers.coast, x, y, 0) ||
                MapGen.Layers.Get(layers.riverBank, x, y, 0))
                return false;
            if(occupied &&
                occupied !== 1 &&
                occupied !== "structure_cluster" &&
                occupied !== "objective_structure" &&
                occupied !== "live_structure_clearance")
                return false;
            if(self.HasNearbyStructureArt(pContext, x, y, 2) ||
                self.IsCliffCell(pContext, x, y) ||
                self.IsCliffTopApronCell(pContext, x, y) ||
                self.IsCliffFootApronCell(pContext, x, y))
                return false;
            return true;
        }

        function prospectiveTreeShapeHasCandidates(x, y) {
            if(!runtime || !self.TreeCandidatesForShape)
                return false;
            var shapeKey = self.TreeShapeKey(isTree, x, y);
            var connectKey = self.TreeConnectKey(isTree, x, y);
            var candidates = self.TreeCandidatesForShape(runtime, shapeKey, connectKey);
            return !!(candidates && candidates.length);
        }

        function buildRunCache() {
            var cache = [];

            for(var y = 0; y < height; ++y) {
                var row = [];
                var x = 0;
                while(x < width) {
                    if(!isTree(x, y)) {
                        row[x] = null;
                        ++x;
                        continue;
                    }

                    var start = x;
                    while(x + 1 < width && isTree(x + 1, y))
                        ++x;
                    var end = x;
                    var run = { start: start, end: end, length: end - start + 1 };
                    for(var fill = start; fill <= end; ++fill)
                        row[fill] = run;
                    ++x;
                }
                cache[y] = row;
            }

            return cache;
        }

        function runAt(x, y) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return null;
            if(runCache && runCache[y])
                return runCache[y][x] || null;
            return null;
        }

        function canFillRibbonCell(x, y) {
            if(!canFill(x, y))
                return false;
            if(self.IsOuterCoverBuffer(pContext, x, y) ||
                MapGen.Layers.Get(layers.keepClear, x, y, 0) ||
                MapGen.Layers.Get(layers.structureGround, x, y, 0))
                return false;
            if(layers.owner) {
                var owner = MapGen.Layers.Get(layers.owner, x, y, 0);
                if(owner > MapGen.Layers.Owner.TREE)
                    return false;
            }
            return true;
        }

        function canFillTopEdgeCell(x) {
            if(x <= 0 || x >= width - 1 || height < 2)
                return false;
            if(charAt(x, 0) !== self.Chars.ground)
                return false;
            var occupied = MapGen.Layers.Get(layers.occupied, x, 0, 0);
            if(MapGen.Layers.Get(layers.keepClear, x, 0, 0) ||
                MapGen.Layers.Get(layers.path, x, 0, 0) ||
                MapGen.Layers.Get(layers.crossing, x, 0, 0) ||
                MapGen.Layers.Get(layers.water, x, 0, 0) ||
                MapGen.Layers.Get(layers.coast, x, 0, 0) ||
                MapGen.Layers.Get(layers.riverBank, x, 0, 0) ||
                MapGen.Layers.Get(layers.structureGround, x, 0, 0) ||
                occupied)
                return false;
            if(layers.owner) {
                var owner = MapGen.Layers.Get(layers.owner, x, 0, 0);
                if(owner > MapGen.Layers.Owner.TREE)
                    return false;
            }
            if(self.HasNearbyStructureArt(pContext, x, 0, 2) ||
                self.IsCliffCell(pContext, x, 0) ||
                self.IsCliffTopApronCell(pContext, x, 0) ||
                self.IsCliffFootApronCell(pContext, x, 0))
                return false;
            return true;
        }

        function queueThinDiagonalRibbonFill(pending, x, y) {
            var run = runAt(x, y);
            if(!run || x !== run.start || run.length < 2 || run.length > 3)
                return;

            var leftFill = run.start - 1;
            if(leftFill > 0 && canFillRibbonCell(leftFill, y)) {
                var leftSupported =
                    (isTree(leftFill, y - 1) && isTree(run.start, y - 1)) ||
                    (isTree(leftFill, y + 1) && isTree(run.start, y + 1));
                if(leftSupported)
                    pending[cellKey(leftFill, y)] = [leftFill, y];
            }

            var rightFill = run.end + 1;
            if(rightFill < width - 1 && canFillRibbonCell(rightFill, y)) {
                var rightSupported =
                    (isTree(rightFill, y - 1) && isTree(run.end, y - 1)) ||
                    (isTree(rightFill, y + 1) && isTree(run.end, y + 1));
                if(rightSupported)
                    pending[cellKey(rightFill, y)] = [rightFill, y];
            }
        }

        function queueSupportedDiagonalEdgeStairFills(pending) {
            for(var y = scanMinY; y <= scanMaxY; ++y) {
                for(var x = scanMinX; x <= scanMaxX; ++x) {
                    var run = runAt(x, y);
                    if(!run || run.length < 4)
                        continue;

                    if(x === run.end) {
                        var rightFill = x + 1;
                        if(rightFill < width - 1 &&
                            !isTree(rightFill, y) &&
                            canFillRibbonCell(rightFill, y) &&
                            isTree(x, y + 1) &&
                            isTree(rightFill, y + 1)) {
                            var lowerRightRun = runAt(rightFill, y + 1);
                            if(lowerRightRun && lowerRightRun.length >= 4 && lowerRightRun.end > run.end)
                                pending[cellKey(rightFill, y)] = [rightFill, y];
                        }
                    }

                    if(x === run.start) {
                        var leftFill = x - 1;
                        if(leftFill > 0 &&
                            !isTree(leftFill, y) &&
                            canFillRibbonCell(leftFill, y) &&
                            isTree(x, y + 1) &&
                            isTree(leftFill, y + 1)) {
                            var lowerLeftRun = runAt(leftFill, y + 1);
                            if(lowerLeftRun && lowerLeftRun.length >= 4 && lowerLeftRun.start < run.start)
                                pending[cellKey(leftFill, y)] = [leftFill, y];
                        }
                    }
                }
            }
        }

        function queueDenseTreeHoleFills(pending) {
            for(var y = scanMinY; y <= scanMaxY; ++y) {
                for(var x = scanMinX; x <= scanMaxX; ++x) {
                    if(isTree(x, y) || !canFillRibbonCell(x, y))
                        continue;
                    if(!isTree(x, y - 1) || !isTree(x + 1, y) ||
                        !isTree(x, y + 1) || !isTree(x - 1, y))
                        continue;

                    var diagonalSupport = 0;
                    if(isTree(x - 1, y - 1))
                        ++diagonalSupport;
                    if(isTree(x + 1, y - 1))
                        ++diagonalSupport;
                    if(isTree(x - 1, y + 1))
                        ++diagonalSupport;
                    if(isTree(x + 1, y + 1))
                        ++diagonalSupport;
                    if(diagonalSupport < 2)
                        continue;

                    pending[cellKey(x, y)] = [x, y];
                }
            }
        }

        function canPruneUnsupportedTopShelfCell(x, y) {
            var occupied = MapGen.Layers.Get(layers.occupied, x, y, 0);
            if(charAt(x, y) !== self.Chars.tree)
                return false;
            if(!isTree(x, y) || !isTree(x, y + 1))
                return false;
            if(self.IsOuterCoverBuffer(pContext, x, y) ||
                MapGen.Layers.Get(layers.path, x, y, 0) ||
                MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                MapGen.Layers.Get(layers.water, x, y, 0) ||
                MapGen.Layers.Get(layers.coast, x, y, 0) ||
                MapGen.Layers.Get(layers.riverBank, x, y, 0) ||
                MapGen.Layers.Get(layers.structureGround, x, y, 0) ||
                (MapGen.Layers.Get(layers.perimeterCover, x, y, 0) &&
                    (x <= 1 || y <= 1 || x >= width - 2 || y >= height - 2)) ||
                self.IsStructureContextCoverCell(pContext, x, y) ||
                (occupied &&
                    occupied !== 1 &&
                    occupied !== "structure_cluster" &&
                    occupied !== "objective_structure" &&
                    occupied !== "live_structure_clearance"))
                return false;
            if(layers.owner) {
                var owner = MapGen.Layers.Get(layers.owner, x, y, 0);
                if(owner > MapGen.Layers.Owner.TREE)
                    return false;
            }
            if(self.HasNearbyStructureArt(pContext, x, y, 2) ||
                self.IsCliffCell(pContext, x, y) ||
                self.IsCliffTopApronCell(pContext, x, y) ||
                self.IsCliffFootApronCell(pContext, x, y))
                return false;
            return true;
        }

        function queueUnsupportedTopShelfPrunes(pending) {
            for(var y = scanMinY + 1; y <= scanMaxY; ++y) {
                var x = scanMinX;
                while(x <= scanMaxX) {
                    if(!isTree(x, y)) {
                        ++x;
                        continue;
                    }

                    var run = runAt(x, y);
                    if(!run || run.length < 4) {
                        ++x;
                        continue;
                    }
                    x = run.end + 1;

                    var supportStart = -1;
                    var supportEnd = -1;
                    for(var sx = run.start; sx <= run.end; ++sx) {
                        if(!isTree(sx, y - 1))
                            continue;
                        if(supportStart < 0)
                            supportStart = sx;
                        supportEnd = sx;
                    }
                    if(supportStart < 0)
                        continue;

                    var rightSupportGap = supportEnd + 1;
                    if(run.end > rightSupportGap &&
                        rightSupportGap < width - 1 &&
                        !isTree(rightSupportGap, y - 1) &&
                        !canFillRibbonCell(rightSupportGap, y - 1)) {
                        for(var rx = rightSupportGap + 1; rx <= run.end; ++rx) {
                            if(canPruneUnsupportedTopShelfCell(rx, y))
                                pending[pending.length] = [rx, y];
                        }
                    }

                    var leftSupportGap = supportStart - 1;
                    if(run.start < leftSupportGap &&
                        leftSupportGap > 0 &&
                        !isTree(leftSupportGap, y - 1) &&
                        !canFillRibbonCell(leftSupportGap, y - 1)) {
                        for(var lx = run.start; lx < leftSupportGap; ++lx) {
                            if(canPruneUnsupportedTopShelfCell(lx, y))
                                pending[pending.length] = [lx, y];
                        }
                    }
                }
            }
        }

        function queueSupportedTopEdgeCapFills(pending) {
            if(height < 3)
                return;

            var x = 1;
            while(x < width - 1) {
                if(!isTree(x, 1)) {
                    ++x;
                    continue;
                }

                var start = x;
                while(x < width - 1 && isTree(x, 1))
                    ++x;
                var end = x - 1;
                var length = end - start + 1;
                if(length < 4)
                    continue;

                var topCount = 0;
                for(var tx = start; tx <= end; ++tx) {
                    if(isTree(tx, 0))
                        ++topCount;
                }
                if(topCount <= 0 || topCount >= length)
                    continue;

                for(var fx = start; fx <= end; ++fx) {
                    if(isTree(fx, 0) || !canFillTopEdgeCell(fx))
                        continue;
                    if(!isTree(fx, 2) && !isTree(fx - 1, 1) && !isTree(fx + 1, 1))
                        continue;
                    pending[cellKey(fx, 0)] = [fx, 0];
                }

                if(isTree(start, 0) && isTree(start, 1) && !isTree(start, 2) &&
                    isTree(start + 1, 1) && isTree(start + 1, 2) && canFill(start, 2))
                    pending[cellKey(start, 2)] = [start, 2];

                if(isTree(end, 0) && isTree(end, 1) && !isTree(end, 2) &&
                    isTree(end - 1, 1) && isTree(end - 1, 2) && canFill(end, 2))
                    pending[cellKey(end, 2)] = [end, 2];
            }
        }

        function canFillTopEdgeNotchCell(x, y) {
            return y === 0 ? canFillTopEdgeCell(x) : canFillRibbonCell(x, y);
        }

        function queueTopEdgeTreeNotchFills(pending) {
            if(height < 4)
                return;

            for(var x = 1; x < width - 1; ++x) {
                if(isTree(x, 0) || !isTree(x - 1, 0) || !isTree(x + 1, 0))
                    continue;

                var y = 0;
                var blocked = false;
                while(y < height - 1 && !isTree(x, y) && isTree(x - 1, y) && isTree(x + 1, y)) {
                    if(!canFillTopEdgeNotchCell(x, y)) {
                        blocked = true;
                        break;
                    }
                    ++y;
                }

                if(blocked || y <= 0 || y > 4 || !isTree(x, y))
                    continue;

                var closingRun = runAt(x, y);
                if(!closingRun || closingRun.length < 4)
                    continue;

                for(var fy = 0; fy < y; ++fy)
                    pending[cellKey(x, fy)] = [x, fy];
            }
        }

        function clearSoftFillLayers(x, y) {
            self.BackupCoverCell(pContext, x, y);
            if(layers.occupied)
                MapGen.Layers.Set(layers.occupied, x, y, 0);
            if(layers.keepClear)
                MapGen.Layers.Set(layers.keepClear, x, y, 0);
            if(layers.blocked)
                MapGen.Layers.Set(layers.blocked, x, y, 1);
            // Tag as render-injected so ReclaimInjectedCover un-injects it at the
            // top of the next render (keeps the render idempotent — see Layers.js).
            if(!layers.softFillCover)
                layers.softFillCover = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
            MapGen.Layers.Set(layers.softFillCover, x, y, 1);
            if(layers.outcrop)
                MapGen.Layers.Set(layers.outcrop, x, y, 0);
            if(layers.terrainEdge)
                MapGen.Layers.Set(layers.terrainEdge, x, y, 0);
            if(layers.structureGroundMaterial)
                MapGen.Layers.Set(layers.structureGroundMaterial, x, y, "");
            if(layers.structurePlainGround)
                MapGen.Layers.Set(layers.structurePlainGround, x, y, 0);
        }

        var changed = 0;
        var scanBounds = options.IgnoreLocalBounds ?
            { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 } :
            this.LocalRenderBounds(pContext, 12);
        var scanMinX = Math.max(1, scanBounds.minX);
        var scanMinY = Math.max(1, scanBounds.minY);
        var scanMaxX = Math.min(width - 3, scanBounds.maxX);
        var scanMaxY = Math.min(height - 3, scanBounds.maxY);
        for(var pass = 0; pass < 2; ++pass) {
            src = MapGen.Layers.Clone(pChars);
            runCache = buildRunCache();
            var pending = {};
            var pendingPrune = [];

            for(var y = scanMinY; y <= scanMaxY; ++y) {
                for(var x = scanMinX; x <= scanMaxX; ++x) {
                    if(!isTree(x, y))
                        continue;

                    // The missing southeast neighbour is the rare part of
                    // this shape; avoid constructing eight-neighbour strings
                    // for the interior of every forest.
                    if(isTree(x + 1, y + 1) || shapeAt(x, y) !== "TTTTTTT.")
                        continue;
                    if(shapeAt(x - 1, y + 1) !== "TTTTTTT." &&
                        shapeAt(x + 1, y - 1) !== "TTTTTTT.")
                        continue;

                    var fx = x + 1;
                    var fy = y + 1;
                    if(canFill(fx, fy) && !prospectiveTreeShapeHasCandidates(fx, fy))
                        pending[cellKey(fx, fy)] = [fx, fy];
                }
            }

            for(var ry = scanMinY; ry <= scanMaxY; ++ry) {
                for(var rx = scanMinX; rx <= scanMaxX; ++rx)
                    queueThinDiagonalRibbonFill(pending, rx, ry);
            }
            if(pass === 0)
                queueSupportedDiagonalEdgeStairFills(pending);
            queueDenseTreeHoleFills(pending);
            queueSupportedTopEdgeCapFills(pending);
            queueTopEdgeTreeNotchFills(pending);
            queueUnsupportedTopShelfPrunes(pendingPrune);

            var passChanged = 0;
            for(var key in pending) {
                if(!pending.hasOwnProperty(key))
                    continue;
                var cell = pending[key];
                if(MapGen.Layers.Set(pChars, cell[0], cell[1], self.Chars.tree)) {
                    clearSoftFillLayers(cell[0], cell[1]);
                    self.ClearTrimmedTreeMarkers(pContext, cell[0], cell[1]);
                    ++passChanged;
                }
            }
            for(var pruneIndex = 0; pruneIndex < pendingPrune.length; ++pruneIndex) {
                var pruneCell = pendingPrune[pruneIndex];
                if(MapGen.Layers.Set(pChars, pruneCell[0], pruneCell[1], self.Chars.ground)) {
                    self.ClearTrimmedTreeMarkers(pContext, pruneCell[0], pruneCell[1]);
                    ++passChanged;
                }
            }

            changed += passChanged;
            if(!passChanged)
                break;
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Repaired diagonal ice tree edge stairs: " + changed);

        return changed;
    };
})(MapGen.Terrain.Smoothing.Ice);
