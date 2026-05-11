var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};
MapGen.Terrain.Smoothing.Ice = MapGen.Terrain.Smoothing.Ice || {};

(function(pIce) {
    pIce.BlendShorelinePathChars = function(pContext, pChars) {
        var src = MapGen.Layers.Clone(pChars);
        var self = this;
        var layers = pContext.Layers || {};
        var pending = [];

        function charAt(x, y) {
            return MapGen.Layers.Get(src, x, y, self.Chars.ground);
        }

        function isShoreMaterial(x, y) {
            var ch = charAt(x, y);
            return ch === self.Chars.wet || ch === self.Chars.bank || ch === self.Chars.water;
        }

        function isAquaticMaterial(x, y) {
            var ch = charAt(x, y);
            return ch === self.Chars.bank || ch === self.Chars.water;
        }

        function hasCardinalShoreMaterial(x, y) {
            return isShoreMaterial(x, y - 1) ||
                isShoreMaterial(x + 1, y) ||
                isShoreMaterial(x, y + 1) ||
                isShoreMaterial(x - 1, y);
        }

        function hasNearbyAquaticMaterial(x, y) {
            for(var dy = -3; dy <= 3; ++dy) {
                for(var dx = -3; dx <= 3; ++dx) {
                    if((dx * dx) + (dy * dy) > 9)
                        continue;
                    if(isAquaticMaterial(x + dx, y + dy))
                        return true;
                }
            }
            return false;
        }

        function protectedPath(x, y) {
            return MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                self.HasNearbyStructureArt(pContext, x, y, 2) ||
                self.IsCliffCell(pContext, x, y) ||
                self.IsCliffTopApronCell(pContext, x, y);
        }

        for(var x = 1; x < pContext.Width - 1; ++x) {
            for(var y = 1; y < pContext.Height - 1; ++y) {
                if(charAt(x, y) !== this.Chars.path)
                    continue;
                if(protectedPath(x, y))
                    continue;
                if(!hasCardinalShoreMaterial(x, y))
                    continue;
                if(!hasNearbyAquaticMaterial(x, y))
                    continue;

                pending.push([x, y]);
            }
        }

        var changed = 0;
        for(var index = 0; index < pending.length; ++index) {
            if(MapGen.Layers.Set(pChars, pending[index][0], pending[index][1], this.Chars.wet))
                ++changed;
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Blended shoreline path chars into wet ice: " + changed);

        return changed;
    };

    pIce.RoundShorelineIceSnowDiagonalChars = function(pContext, pChars) {
        var src = MapGen.Layers.Clone(pChars);
        var self = this;
        var layers = pContext.Layers || {};
        var pending = {};

        function key(x, y) {
            return x + "," + y;
        }

        function charAt(x, y) {
            return MapGen.Layers.Get(src, x, y, self.Chars.ground);
        }

        function isIce(x, y) {
            return charAt(x, y) === self.Chars.wet;
        }

        function isSnowLike(x, y) {
            var ch = charAt(x, y);
            return ch === self.Chars.ground || ch === self.Chars.path;
        }

        function isAquaticMaterial(x, y) {
            var ch = charAt(x, y);
            return ch === self.Chars.bank || ch === self.Chars.water;
        }

        function hasNearbyAquaticMaterial(x, y) {
            for(var dy = -4; dy <= 4; ++dy) {
                for(var dx = -4; dx <= 4; ++dx) {
                    if((dx * dx) + (dy * dy) > 16)
                        continue;
                    if(isAquaticMaterial(x + dx, y + dy))
                        return true;
                }
            }
            return false;
        }

        function isSouthEastDiagonalEdge(x, y) {
            return isIce(x, y) &&
                isSnowLike(x, y - 1) &&
                isSnowLike(x + 1, y) &&
                isIce(x, y + 1) &&
                isIce(x - 1, y) &&
                hasNearbyAquaticMaterial(x, y);
        }

        function canPromote(x, y) {
            if(x <= 0 || y <= 0 || x >= pContext.Width - 1 || y >= pContext.Height - 1)
                return false;
            if(!isSnowLike(x, y))
                return false;
            if(MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                MapGen.Layers.Get(layers.water, x, y, 0) ||
                MapGen.Layers.Get(layers.coast, x, y, 0) ||
                MapGen.Layers.Get(layers.riverBank, x, y, 0) ||
                MapGen.Layers.Get(layers.forcedBank, x, y, 0) ||
                MapGen.Layers.Get(layers.occupied, x, y, 0))
                return false;
            if(self.HasNearbyStructureArt(pContext, x, y, 2) ||
                self.IsCliffCell(pContext, x, y) ||
                self.IsCliffTopApronCell(pContext, x, y))
                return false;
            return true;
        }

        function queuePromote(x, y) {
            if(canPromote(x, y))
                pending[key(x, y)] = [x, y];
        }

        function roundRun(run) {
            if(run.length < 5)
                return;

            for(var index = 1; index < run.length - 1; ++index) {
                var cell = run[index];
                var x = cell[0];
                var y = cell[1];
                var phase = index % 3;

                if(phase === 1)
                    queuePromote(x + 1, y);
                else if(phase === 2)
                    queuePromote(x, y - 1);
            }
        }

        for(var startY = 1; startY < pContext.Height - 1; ++startY) {
            for(var startX = 1; startX < pContext.Width - 1; ++startX) {
                if(isSouthEastDiagonalEdge(startX - 1, startY - 1))
                    continue;
                if(!isSouthEastDiagonalEdge(startX, startY))
                    continue;

                var run = [];
                var x = startX;
                var y = startY;
                while(x < pContext.Width - 1 && y < pContext.Height - 1 && isSouthEastDiagonalEdge(x, y)) {
                    run.push([x, y]);
                    ++x;
                    ++y;
                }

                roundRun(run);
            }
        }

        var changed = 0;
        for(var itemKey in pending) {
            if(!pending.hasOwnProperty(itemKey))
                continue;
            var cell = pending[itemKey];
            if(MapGen.Layers.Set(pChars, cell[0], cell[1], this.Chars.wet))
                ++changed;
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Rounded shoreline ice/snow diagonal chars: " + changed);

        return changed;
    };

    pIce.RoundShorelineIceBankDiagonalChars = function(pContext, pChars) {
        var src = MapGen.Layers.Clone(pChars);
        var self = this;
        var layers = pContext.Layers || {};
        var pending = {};

        function key(x, y) {
            return x + "," + y;
        }

        function charAt(x, y) {
            return MapGen.Layers.Get(src, x, y, self.Chars.water);
        }

        function isWet(x, y) {
            return charAt(x, y) === self.Chars.wet;
        }

        function isBank(x, y) {
            return charAt(x, y) === self.Chars.bank;
        }

        function isAquatic(x, y) {
            var ch = charAt(x, y);
            return ch === self.Chars.bank || ch === self.Chars.water;
        }

        function canPromote(x, y) {
            if(x <= 0 || y <= 0 || x >= pContext.Width - 1 || y >= pContext.Height - 1)
                return false;
            if(!isBank(x, y))
                return false;
            var occupied = MapGen.Layers.Get(layers.occupied, x, y, 0);
            // keepClear reserves gameplay/placement space, but it should not
            // pin a bank material cell that is visually enclosed by wet ice.
            if(MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                MapGen.Layers.Get(layers.path, x, y, 0) ||
                (occupied && occupied !== 1 && occupied !== "live_structure_clearance"))
                return false;
            // Structure-art proximity is a radius halo, not a footprint. These
            // cells are still protected by actual occupancy/path checks above.
            if(self.IsCliffCell(pContext, x, y) ||
                self.IsCliffTopApronCell(pContext, x, y))
                return false;
            return true;
        }

        function queueIfConvexBankCorner(x, y, wetA, wetB, wetCorner, aquaticA, aquaticB, aquaticCorner) {
            if(!canPromote(x, y))
                return;
            if(!isWet(x + wetA[0], y + wetA[1]) ||
                !isWet(x + wetB[0], y + wetB[1]) ||
                !isWet(x + wetCorner[0], y + wetCorner[1]))
                return;
            if(!isAquatic(x + aquaticA[0], y + aquaticA[1]) ||
                !isAquatic(x + aquaticB[0], y + aquaticB[1]) ||
                !isAquatic(x + aquaticCorner[0], y + aquaticCorner[1]))
                return;
            pending[key(x, y)] = [x, y];
        }

        for(var y = 1; y < pContext.Height - 1; ++y) {
            for(var x = 1; x < pContext.Width - 1; ++x) {
                queueIfConvexBankCorner(x, y, [0, -1], [1, 0], [1, -1], [0, 1], [-1, 0], [-1, 1]);
                queueIfConvexBankCorner(x, y, [0, -1], [-1, 0], [-1, -1], [0, 1], [1, 0], [1, 1]);
                queueIfConvexBankCorner(x, y, [0, 1], [1, 0], [1, 1], [0, -1], [-1, 0], [-1, -1]);
                queueIfConvexBankCorner(x, y, [0, 1], [-1, 0], [-1, 1], [0, -1], [1, 0], [1, -1]);
            }
        }

        var changed = 0;
        for(var itemKey in pending) {
            if(!pending.hasOwnProperty(itemKey))
                continue;
            var cell = pending[itemKey];
            if(MapGen.Layers.Set(pChars, cell[0], cell[1], this.Chars.wet))
                ++changed;
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Rounded shoreline ice/bank diagonal chars: " + changed);

        return changed;
    };

    pIce.PromoteEnclosedIceBankNotches = function(pContext, pChars) {
        var src = MapGen.Layers.Clone(pChars);
        var self = this;
        var layers = pContext.Layers || {};
        var pending = [];
        var dirs = [
            [0, -1],
            [1, 0],
            [0, 1],
            [-1, 0]
        ];

        function charAt(x, y) {
            return MapGen.Layers.Get(src, x, y, self.Chars.water);
        }

        function canPromote(x, y) {
            if(x <= 0 || y <= 0 || x >= pContext.Width - 1 || y >= pContext.Height - 1)
                return false;
            if(charAt(x, y) !== self.Chars.bank)
                return false;
            var occupied = MapGen.Layers.Get(layers.occupied, x, y, 0);
            // keepClear reserves gameplay/placement space, but it should not
            // pin a bank material cell that is visually enclosed by wet ice.
            if(MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                MapGen.Layers.Get(layers.path, x, y, 0) ||
                (occupied && occupied !== 1 && occupied !== "live_structure_clearance"))
                return false;
            // Structure-art proximity is a radius halo, not a footprint. These
            // cells are still protected by actual occupancy/path checks above.
            if(self.IsCliffCell(pContext, x, y) ||
                self.IsCliffTopApronCell(pContext, x, y))
                return false;
            return true;
        }

        function canPromoteMaterialNotch(x, y) {
            if(x <= 0 || y <= 0 || x >= pContext.Width - 1 || y >= pContext.Height - 1)
                return false;
            if(charAt(x, y) !== self.Chars.bank)
                return false;
            if(self.IsCliffCell(pContext, x, y) || self.IsCliffTopApronCell(pContext, x, y))
                return false;
            return true;
        }

        for(var y = 1; y < pContext.Height - 1; ++y) {
            for(var x = 1; x < pContext.Width - 1; ++x) {
                if(!canPromoteMaterialNotch(x, y))
                    continue;

                var wetCount = 0;
                var supported = true;
                for(var d = 0; d < dirs.length; ++d) {
                    var dir = dirs[d];
                    var ch = charAt(x + dir[0], y + dir[1]);
                    if(ch === self.Chars.wet)
                        ++wetCount;
                    else if(ch !== self.Chars.bank) {
                        supported = false;
                        break;
                    }
                }

                if(!supported)
                    continue;

                if(wetCount >= 3 && canPromote(x, y))
                    pending.push([x, y]);
                else if(wetCount >= 2)
                    pending.push([x, y]);
            }
        }

        var changed = 0;
        for(var index = 0; index < pending.length; ++index) {
            var cell = pending[index];
            if(MapGen.Layers.Set(pChars, cell[0], cell[1], this.Chars.wet))
                ++changed;
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Promoted enclosed ice-bank notches: " + changed);

        return changed;
    };

    pIce.WidenUnsupportedIceWaterSnowBands = function(pContext, pChars, pOptions) {
        var src = MapGen.Layers.Clone(pChars);
        var pending = {};
        var self = this;
        var width = pContext.Width;
        var height = pContext.Height;
        var dirtyMask = (pOptions || {}).DirtyMask || null;
        var dirs = [
            { x: 0, y: -1 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
            { x: -1, y: 0 }
        ];

        function dirty(x, y) {
            return !dirtyMask || (x >= 0 && y >= 0 && x < width && y < height &&
                dirtyMask.charAt((y * width) + x) === "1");
        }

        function charAt(x, y) {
            return MapGen.Layers.Get(src, x, y, self.Chars.ground);
        }

        function isAquatic(x, y) {
            var ch = charAt(x, y);
            return ch === self.Chars.water || ch === self.Chars.bank;
        }

        function canPromote(x, y) {
            if(!dirty(x, y))
                return false;
            if(x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1)
                return false;

            var ch = charAt(x, y);
            if(ch !== self.Chars.ground && ch !== self.Chars.path)
                return false;

            var layers = pContext.Layers || {};
            if(MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                MapGen.Layers.Get(layers.water, x, y, 0) ||
                MapGen.Layers.Get(layers.coast, x, y, 0) ||
                MapGen.Layers.Get(layers.riverBank, x, y, 0) ||
                MapGen.Layers.Get(layers.forcedBank, x, y, 0) ||
                MapGen.Layers.Get(layers.occupied, x, y, 0))
                return false;

            if(self.IsCliffCell(pContext, x, y) || self.IsCliffTopApronCell(pContext, x, y))
                return false;
            if(self.StructureGroundMaterialChar(pContext, x, y))
                return false;
            if(self.IsStructurePlainPadCell(pContext, x, y) || self.HasNearbyStructureArt(pContext, x, y, 2))
                return false;

            return true;
        }

        for(var x = 1; x < width - 1; ++x) {
            for(var y = 1; y < height - 1; ++y) {
                if(charAt(x, y) !== this.Chars.wet)
                    continue;

                for(var d = 0; d < dirs.length; ++d) {
                    var dir = dirs[d];
                    var aquaticX = x - dir.x;
                    var aquaticY = y - dir.y;
                    var landX = x + dir.x;
                    var landY = y + dir.y;

                    if(!isAquatic(aquaticX, aquaticY) || !canPromote(landX, landY))
                        continue;

                    pending[landX + "," + landY] = [landX, landY];
                }
            }
        }

        var changed = 0;
        for(var key in pending) {
            if(!pending.hasOwnProperty(key))
                continue;
            var cell = pending[key];
            if(MapGen.Layers.Set(pChars, cell[0], cell[1], this.Chars.wet))
                ++changed;
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Widened unsupported ice-water-snow bands: " + changed);

        return changed;
    };

    pIce.RepairSupportedTreeTopGaps = function(pContext, pChars) {
        var src = MapGen.Layers.Clone(pChars);
        var changed = 0;
        var pending = [];
        var self = this;
        var layers = pContext.Layers || {};
        var runtime = this.TreeRuntimeData ? this.TreeRuntimeData() : null;

        function charAt(x, y) {
            return MapGen.Layers.Get(src, x, y, self.Chars.ground);
        }

        function isTree(x, y) {
            return self.IsTreeCharValue(charAt(x, y));
        }

        function isProtected(x, y) {
            if(x <= 0 || y <= 0 || x >= pContext.Width - 1 || y >= pContext.Height - 1)
                return true;
            return MapGen.Layers.Get(layers.water, x, y, 0) ||
                MapGen.Layers.Get(layers.riverBank, x, y, 0) ||
                MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                MapGen.Layers.Get(layers.path, x, y, 0) ||
                MapGen.Layers.Get(layers.occupied, x, y, 0) ||
                MapGen.Layers.Get(layers.outcrop, x, y, 0) ||
                self.IsCliffCell(pContext, x, y) ||
                self.IsCliffTopApronCell(pContext, x, y);
        }

        function canPromote(x, y) {
            if(charAt(x, y) !== self.Chars.ground)
                return false;
            return !isProtected(x, y);
        }

        function prospectiveTreeShapeHasCandidates(x, y) {
            if(!runtime || !self.TreeCandidatesForShape)
                return false;
            var shapeKey = self.TreeShapeKey(isTree, x, y);
            var connectKey = self.TreeConnectKey(isTree, x, y);
            var candidates = self.TreeCandidatesForShape(runtime, shapeKey, connectKey);
            return !!(candidates && candidates.length);
        }

        function hasTopAnchor(startX, endX, y, x) {
            for(var tx = startX; tx <= endX; ++tx) {
                if(!isTree(tx, y))
                    continue;
                if(Math.abs(tx - x) <= 4)
                    return true;
            }

            return false;
        }

        for(var y = 1; y < pContext.Height - 1; ++y) {
            var x = 1;
            while(x < pContext.Width - 1) {
                if(!isTree(x, y)) {
                    ++x;
                    continue;
                }

                var start = x;
                while(x < pContext.Width - 1 && isTree(x, y))
                    ++x;
                var end = x - 1;
                var runLength = end - start + 1;
                if(runLength < 5)
                    continue;

                for(var px = start + 1; px <= end - 1; ++px) {
                    var topY = y - 1;
                    if(isTree(px, topY))
                        continue;
                    if(!isTree(px, y + 1))
                        continue;
                    if(!hasTopAnchor(start, end, topY, px))
                        continue;
                    if(prospectiveTreeShapeHasCandidates(px, topY))
                        continue;
                    if(canPromote(px, topY))
                        pending.push([px, topY]);
                }
            }
        }

        for(var index = 0; index < pending.length; ++index) {
            if(MapGen.Layers.Set(pChars, pending[index][0], pending[index][1], this.Chars.tree))
                ++changed;
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Repaired supported ice tree-top gaps: " + changed);

        return changed;
    };

    pIce.BreakRepeatingWetShoreBands = function(pContext, pChars) {
        var changed = 0;
        var pending = {};
        var self = this;
        var width = pContext.Width;
        var height = pContext.Height;
        var layers = pContext.Layers;
        var Get = MapGen.Layers.Get;
        var Set = MapGen.Layers.Set;
        var GROUND = this.Chars.ground;
        var WATER = this.Chars.water;
        var WET = this.Chars.wet;
        var BANK = this.Chars.bank;
        var breakable = new Uint8Array(width * height);

        function protectedCell(x, y) {
            return Get(layers.water, x, y, 0) ||
                Get(layers.keepClear, x, y, 0) ||
                Get(layers.crossing, x, y, 0) ||
                Get(layers.path, x, y, 0) ||
                Get(layers.occupied, x, y, 0) ||
                Get(layers.coast, x, y, 0) ||
                self.IsCliffCell(pContext, x, y) ||
                self.IsCliffTopApronCell(pContext, x, y);
        }

        function charAt(x, y) {
            return Get(pChars, x, y, GROUND);
        }

        function hasNearbyWaterChar(x, y, radius) {
            var radiusSq = radius * radius;
            for(var dy = -radius; dy <= radius; ++dy) {
                for(var dx = -radius; dx <= radius; ++dx) {
                    if(dx === 0 && dy === 0)
                        continue;
                    if((dx * dx) + (dy * dy) > radiusSq)
                        continue;
                    if(charAt(x + dx, y + dy) === WATER)
                        return true;
                }
            }

            return false;
        }

        function replacementAt(x, y) {
            if(x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1)
                return "";
            if(protectedCell(x, y))
                return "";

            var current = charAt(x, y);
            if(current !== WET)
                return "";

            var n = charAt(x, y - 1);
            var s = charAt(x, y + 1);
            var w = charAt(x - 1, y);
            var e = charAt(x + 1, y);
            var hasCardinalBank = n === BANK || s === BANK || w === BANK || e === BANK;

            if(n === WATER || s === WATER || w === WATER || e === WATER)
                return "";

            if(!hasNearbyWaterChar(x, y, 4))
                return "";

            // Do not cut snow notches directly under/next to a bank shelf:
            // that makes the lake edge look bitten out. Only thin the outer
            // wet apron where it is already buffered away from the water.
            return hasCardinalBank ? "" : GROUND;
        }

        for(var by = 1; by < height - 1; ++by) {
            for(var bx = 1; bx < width - 1; ++bx) {
                if(replacementAt(bx, by))
                    breakable[(by * width) + bx] = 1;
            }
        }

        function canBreak(x, y) {
            return breakable[(y * width) + x] !== 0;
        }

        function queueRun(pAxis, pFixed, pStart, pEnd) {
            var len = pEnd - pStart;
            if(len < 7)
                return;

            var salt = pAxis === "h" ? 4333 : 4334;
            var chance = 22;
            var minGap = 4;
            var lastQueued = pStart - minGap - 1;

            for(var ri = pStart + 1; ri < pEnd - 1; ++ri) {
                if(ri - lastQueued < minGap)
                    continue;

                var x = pAxis === "h" ? ri : pFixed;
                var y = pAxis === "h" ? pFixed : ri;
                if(!canBreak(x, y))
                    continue;

                var roll = MapGen.Random.HashTile(pContext.Seed || 0, x, y, salt) % 100;
                if(roll < chance) {
                    pending[x + "," + y] = { x: x, y: y, value: GROUND };
                    lastQueued = ri;
                }
            }
        }

        function scanHorizontal(y) {
            var start = -1;
            var runChar = "";
            for(var x = 0; x <= width; ++x) {
                var current = x < width ? charAt(x, y) : "";
                var inRun = x < width && canBreak(x, y);
                if(inRun) {
                    if(start < 0) {
                        start = x;
                        runChar = current;
                    } else if(current !== runChar) {
                        queueRun("h", y, start, x);
                        start = x;
                        runChar = current;
                    }
                    continue;
                }

                if(start >= 0) {
                    queueRun("h", y, start, x);
                    start = -1;
                    runChar = "";
                }
            }
        }

        function scanVertical(x) {
            var start = -1;
            var runChar = "";
            for(var y = 0; y <= height; ++y) {
                var current = y < height ? charAt(x, y) : "";
                var inRun = y < height && canBreak(x, y);
                if(inRun) {
                    if(start < 0) {
                        start = y;
                        runChar = current;
                    } else if(current !== runChar) {
                        queueRun("v", x, start, y);
                        start = y;
                        runChar = current;
                    }
                    continue;
                }

                if(start >= 0) {
                    queueRun("v", x, start, y);
                    start = -1;
                    runChar = "";
                }
            }
        }

        for(var y = 1; y < height - 1; ++y)
            scanHorizontal(y);
        for(var x = 1; x < width - 1; ++x)
            scanVertical(x);

        for(var key in pending) {
            if(!pending.hasOwnProperty(key))
                continue;
            var item = pending[key];
            if(charAt(item.x, item.y) !== item.value && Set(pChars, item.x, item.y, item.value))
                ++changed;
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Broke repeating ice shore bands: " + changed);

        return changed;
    };

    pIce.NormalizeOpenWaterIceStrips = function(pContext, pChars) {
        var changed = 0;
        var pending = {};
        var self = this;
        var width = pContext.Width;
        var height = pContext.Height;
        var layers = pContext.Layers;
        var Get = MapGen.Layers.Get;
        var Set = MapGen.Layers.Set;
        var GROUND = this.Chars.ground;
        var WATER = this.Chars.water;
        var WET = this.Chars.wet;
        var BANK = this.Chars.bank;
        var PATH = this.Chars.path;
        var TREE = this.Chars.tree;

        function charAt(x, y) {
            return Get(pChars, x, y, WATER);
        }

        function isWaterLike(ch) {
            return ch === WATER || ch === BANK;
        }

        function isLandLike(ch) {
            return ch === GROUND || ch === PATH || ch === TREE;
        }

        function protectedCell(x, y) {
            return Get(layers.keepClear, x, y, 0) ||
                Get(layers.crossing, x, y, 0) ||
                Get(layers.path, x, y, 0) ||
                Get(layers.occupied, x, y, 0) ||
                self.IsCliffCell(pContext, x, y) ||
                self.IsCliffTopApronCell(pContext, x, y);
        }

        function runProtected(y, start, end) {
            for(var x = start; x < end; ++x) {
                if(protectedCell(x, y))
                    return true;
            }
            return false;
        }

        function hasLandNearRun(y, start, end) {
            for(var yy = y - 1; yy <= y + 1; ++yy) {
                for(var xx = start - 1; xx <= end; ++xx) {
                    if(xx < 0 || yy < 0 || xx >= width || yy >= height)
                        continue;
                    if(isLandLike(charAt(xx, yy)))
                        return true;
                }
            }
            return false;
        }

        function bankNearRun(y, start, end) {
            for(var yy = y - 1; yy <= y + 1; ++yy) {
                for(var xx = start - 1; xx <= end; ++xx) {
                    if(xx < 0 || yy < 0 || xx >= width || yy >= height)
                        continue;
                    if(charAt(xx, yy) === BANK)
                        return true;
                }
            }
            return false;
        }

        for(var y = 0; y < height; ++y) {
            var x = 0;
            while(x < width) {
                if(charAt(x, y) !== WET) {
                    ++x;
                    continue;
                }

                var start = x;
                while(x < width && charAt(x, y) === WET)
                    ++x;
                var end = x;
                var len = end - start;
                if(len > 2)
                    continue;

                var left = start > 0 ? charAt(start - 1, y) : WATER;
                var right = end < width ? charAt(end, y) : WATER;
                if(!isWaterLike(left) || !isWaterLike(right))
                    continue;
                if(runProtected(y, start, end) || hasLandNearRun(y, start, end))
                    continue;

                var replacement = bankNearRun(y, start, end) ? BANK : WATER;
                for(var rx = start; rx < end; ++rx)
                    pending[rx + "," + y] = { x: rx, y: y, value: replacement };
            }
        }

        for(var key in pending) {
            if(!pending.hasOwnProperty(key))
                continue;
            var item = pending[key];
            if(charAt(item.x, item.y) !== item.value && Set(pChars, item.x, item.y, item.value))
                ++changed;
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Normalized open-water ice strips: " + changed);

        return changed;
    };
})(MapGen.Terrain.Smoothing.Ice);
