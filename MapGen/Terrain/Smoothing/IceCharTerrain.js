var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};
MapGen.Terrain.Smoothing.Ice = MapGen.Terrain.Smoothing.Ice || {};

(function(pIce) {
    pIce.CharToClass = function() {
        var c = this.Chars;
        var map = {};
        map[c.water]  = "deep";
        map[c.bank]   = "shallow";
        map[c.wet]    = "ice";
        map[c.ground] = "snow";
        map[c.path]   = "snow";
        map[c.tree]   = "snow";
        map["__default__"] = "snow";
        return map;
    };

    pIce.HasLayerNeighbourSq = function(pLayer, pX, pY, pRadiusSq) {
        var radius = Math.ceil(Math.sqrt(pRadiusSq));

        for(var dy = -radius; dy <= radius; ++dy) {
            for(var dx = -radius; dx <= radius; ++dx) {
                if(dx === 0 && dy === 0)
                    continue;
                if((dx * dx) + (dy * dy) > pRadiusSq)
                    continue;
                if(MapGen.Layers.Get(pLayer, pX + dx, pY + dy, 0))
                    return true;
            }
        }

        return false;
    };

    pIce.HasLayerNeighbour = function(pLayer, pX, pY, pRadius) {
        var radius = pRadius || 1;
        return this.HasLayerNeighbourSq(pLayer, pX, pY, radius * radius);
    };

    pIce.BuildTerrainProximityCache = function(pContext) {
        if(!pContext || !pContext.Layers) {
            if(pContext)
                pContext._iceTerrainProximity = null;
            return;
        }

        var W = pContext.Width;
        var H = pContext.Height;
        var water = pContext.Layers.water;
        var riverBank = pContext.Layers.riverBank;
        var bankWater = new Uint8Array(W * H);
        var wetWater = new Uint8Array(W * H);
        var nearRiverBank = new Uint8Array(W * H);
        var Get = MapGen.Layers.Get;

        // Ring radii (sqDist) tuned to match shipped ice-map shore widths.
        // Measured shipped maps (audit 2026-06-11): shallow band avg 1.0-1.7
        // cells, ice band avg 1.2-3.4 cells. Previous radii (bank≤5, wet≤10)
        // produced 3.3-cell shallow / 7.5-cell ice — 2-3× too thick — which
        // gave EdgeRule too many shore cells to place coherent tiles across,
        // creating the visible 'ice pieces sticking out' artifact along
        // diagonal shores.
        for(var wy = 0; wy < H; ++wy) {
            for(var wx = 0; wx < W; ++wx) {
                if(!Get(water, wx, wy, 0))
                    continue;

                for(var dy = -3; dy <= 3; ++dy) {
                    var y = wy + dy;
                    if(y < 0 || y >= H)
                        continue;
                    for(var dx = -3; dx <= 3; ++dx) {
                        if(dx === 0 && dy === 0)
                            continue;
                        var distSq = (dx * dx) + (dy * dy);
                        if(distSq > 5)
                            continue;
                        var x = wx + dx;
                        if(x < 0 || x >= W)
                            continue;
                        var index = y * W + x;
                        wetWater[index] = 1;
                        if(distSq <= 2)
                            bankWater[index] = 1;
                    }
                }
            }
        }

        for(var ry = 0; ry < H; ++ry) {
            for(var rx = 0; rx < W; ++rx) {
                if(!Get(riverBank, rx, ry, 0))
                    continue;

                if(ry > 0) nearRiverBank[(ry - 1) * W + rx] = 1;
                if(rx > 0) nearRiverBank[ry * W + (rx - 1)] = 1;
                if(rx < W - 1) nearRiverBank[ry * W + (rx + 1)] = 1;
                if(ry < H - 1) nearRiverBank[(ry + 1) * W + rx] = 1;
            }
        }

        pContext._iceTerrainProximity = {
            W: W,
            H: H,
            bankWater: bankWater,
            wetWater: wetWater,
            nearRiverBank: nearRiverBank
        };
    };

    pIce.ClearTerrainProximityCache = function(pContext) {
        if(pContext)
            pContext._iceTerrainProximity = null;
    };

    pIce.IsBankGroundCell = function(pContext, pX, pY) {
        // sqDist <= 2 is the full Moore neighbourhood (8 cells around): one
        // cell ring around any water cell. Matches shipped ice-map shore
        // shape (avg 1.0-1.7 cells thick across all 15 shipped ice maps).
        // Wider rings produce too many shore cells for EdgeRule to place
        // coherent tile sequences along diagonal shores.
        var cache = pContext && pContext._iceTerrainProximity;
        if(cache && pX >= 0 && pY >= 0 && pX < cache.W && pY < cache.H)
            return cache.bankWater[pY * cache.W + pX] !== 0;

        return this.HasLayerNeighbourSq(pContext.Layers.water, pX, pY, 2);
    };

    pIce.IsWetGroundCell = function(pContext, pX, pY) {
        // sqDist <= 5 = Chebyshev-2 minus diagonal corners: 2-cell-thick ring
        // on cardinals tapering to 1-cell on diagonals. Combined with the
        // 1-cell bank ring, total shore = 1 shallow + 2 ice ≈ shipped
        // average (1.4 shallow + 2.0 ice across all shipped ice maps).
        var cache = pContext && pContext._iceTerrainProximity;
        if(cache && pX >= 0 && pY >= 0 && pX < cache.W && pY < cache.H) {
            var index = pY * cache.W + pX;
            return cache.wetWater[index] !== 0 || cache.nearRiverBank[index] !== 0;
        }

        return this.HasLayerNeighbourSq(pContext.Layers.water, pX, pY, 5) ||
            this.HasLayerNeighbour(pContext.Layers.riverBank, pX, pY);
    };

    pIce.IsPathIceEdgeCell = function(pContext, pX, pY) {
        var layers = pContext.Layers;

        if(!MapGen.Layers.Get(layers.path, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(layers.crossing, pX, pY, 0))
            return false;

        return MapGen.Layers.Get(layers.riverBank, pX, pY, 0) ||
            MapGen.Layers.Get(layers.forcedBank, pX, pY, 0) ||
            MapGen.Layers.Get(layers.water, pX, pY, 0) ||
            this.IsBankGroundCell(pContext, pX, pY) ||
            this.IsWetGroundCell(pContext, pX, pY);
    };

    pIce.BuildCliffFootprint = function(pContext) {
        // Cliff body tiles are stomped over the smoothed tile grid by
        // PlateauCliffs.OverlayTiles AFTER the smoother runs. If we leave
        // those cells as ~/W (which they otherwise become because they're
        // near water), neighbouring water cells pick "water continues here"
        // shore tiles — and then the cliff art gets pasted over what looks
        // like a half-rendered shoreline. Treating the cells as solid snow
        // (#) up-front makes the matcher pick shore tiles that face a wall,
        // which is what the cliff art actually is.
        if(pContext._cliffFootprint !== undefined)
            return pContext._cliffFootprint;

        var set = null;
        if(pContext.Cliffs && pContext.Cliffs.length) {
            set = {};
            for(var i = 0; i < pContext.Cliffs.length; ++i) {
                var triplets = pContext.Cliffs[i].triplets || [];
                for(var t = 0; t < triplets.length; ++t)
                    set[triplets[t].x + "," + triplets[t].y] = true;

                var cols = pContext.Cliffs[i].columns || [];
                for(var c = 0; c < cols.length; ++c) {
                    var colTrips = cols[c].triplets || [];
                    if(!colTrips.length)
                        continue;

                    var top = colTrips[0];
                    for(var ti = 1; ti < colTrips.length; ++ti) {
                        if(colTrips[ti].y < top.y)
                            top = colTrips[ti];
                    }

                    var topY = top.y - 1;
                    if(topY >= 0)
                        set[cols[c].x + "," + topY] = true;
                }
            }
        }
        pContext._cliffFootprint = set;
        return set;
    };

    pIce.IsCliffCell = function(pContext, pX, pY) {
        var set = this.BuildCliffFootprint(pContext);
        return set ? set[pX + "," + pY] === true : false;
    };

    function cliffApronClearance(pRecord, pX, pWidth) {
        var base = Math.max(1, Number(pRecord.waterClearance || 2) | 0);
        var landingWidth = Math.max(0,
            Number(pRecord.terminalLandingWidth || 0) | 0);
        var maxClearance = Math.max(base,
            Number(pRecord.terminalMaxClearance || base) | 0);
        if(landingWidth <= 0)
            return base;

        var edgeDistance = Math.min(pX, pWidth - 1 - pX);
        if(edgeDistance >= landingWidth)
            return base;

        var extra = Math.floor(
            (landingWidth - edgeDistance) * (maxClearance - base) /
            landingWidth);
        return base + extra;
    }

    pIce.BuildCliffTopApron = function(pContext) {
        if(pContext._cliffTopApron !== undefined)
            return pContext._cliffTopApron;

        var set = null;
        if(pContext.Cliffs && pContext.Cliffs.length) {
            set = {};
            for(var i = 0; i < pContext.Cliffs.length; ++i) {
                var cols = pContext.Cliffs[i].columns || [];
                for(var c = 0; c < cols.length; ++c) {
                    var trips = cols[c].triplets || [];
                    if(!trips.length)
                        continue;

                    var top = trips[0];
                    for(var ti = 1; ti < trips.length; ++ti) {
                        if(trips[ti].y < top.y)
                            top = trips[ti];
                    }

                    // Normal cliffs own two rows above the body. Strict edge-
                    // anchored records widen that ownership into the same
                    // tapered terminal wedge authored in IntentMap, ensuring
                    // late char repairs cannot turn its border cells back into
                    // shoreline material.
                    var clearance = cliffApronClearance(
                        pContext.Cliffs[i], cols[c].x, pContext.Width);
                    for(var dy = -clearance; dy <= -1; ++dy) {
                        var y = top.y + dy;
                        if(y < 0 || y >= pContext.Height)
                            continue;
                        for(var dx = -1; dx <= 1; ++dx) {
                            var x = cols[c].x + dx;
                            if(x < 0 || x >= pContext.Width)
                                continue;
                            set[x + "," + y] = true;
                        }
                    }
                }
            }
        }

        pContext._cliffTopApron = set;
        return set;
    };

    pIce.IsCliffTopApronCell = function(pContext, pX, pY) {
        var set = this.BuildCliffTopApron(pContext);
        return set ? set[pX + "," + pY] === true : false;
    };

    pIce.BuildCliffFootApron = function(pContext) {
        if(pContext._cliffFootApron !== undefined)
            return pContext._cliffFootApron;

        var set = null;
        if(pContext.Cliffs && pContext.Cliffs.length) {
            set = {};
            for(var i = 0; i < pContext.Cliffs.length; ++i) {
                var cols = pContext.Cliffs[i].columns || [];
                if(cols.length) {
                    for(var c = 0; c < cols.length; ++c) {
                        var trips = cols[c].triplets || [];
                        if(!trips.length)
                            continue;

                        var bottom = trips[0];
                        for(var ti = 1; ti < trips.length; ++ti) {
                            if(trips[ti].y > bottom.y)
                                bottom = trips[ti];
                        }

                        var clearance = cliffApronClearance(
                            pContext.Cliffs[i], cols[c].x, pContext.Width);
                        for(var dy = 1; dy <= clearance; ++dy) {
                            var y = bottom.y + dy;
                            if(y < 0 || y >= pContext.Height)
                                continue;
                            var bleed = dy === clearance ? 1 : 0;
                            for(var dx = -bleed; dx <= bleed; ++dx) {
                                var x = cols[c].x + dx;
                                if(x < 0 || x >= pContext.Width)
                                    continue;
                                set[x + "," + y] = true;
                            }
                        }
                    }
                    continue;
                }

                var triplets = pContext.Cliffs[i].triplets || [];
                var bottomByX = {};
                for(var t = 0; t < triplets.length; ++t) {
                    var trip = triplets[t];
                    var key = String(trip.x);
                    if(!bottomByX[key] || trip.y > bottomByX[key].y)
                        bottomByX[key] = trip;
                }
                for(var xKey in bottomByX) {
                    if(!bottomByX.hasOwnProperty(xKey))
                        continue;
                    var bot = bottomByX[xKey];
                    for(var row = 1; row <= 2; ++row) {
                        var fy = bot.y + row;
                        if(fy < 0 || fy >= pContext.Height)
                            continue;
                        var xBleed = row === 2 ? 1 : 0;
                        for(var xOffset = -xBleed; xOffset <= xBleed; ++xOffset) {
                            var fx = bot.x + xOffset;
                            if(fx < 0 || fx >= pContext.Width)
                                continue;
                            set[fx + "," + fy] = true;
                        }
                    }
                }
            }
        }

        pContext._cliffFootApron = set;
        return set;
    };

    pIce.IsCliffFootApronCell = function(pContext, pX, pY) {
        var set = this.BuildCliffFootApron(pContext);
        return set ? set[pX + "," + pY] === true : false;
    };

    pIce.IsTreeLayerCell = function(pContext, pX, pY) {
        if(!pContext || !pContext.Layers)
            return false;
        if(pX < 0 || pY < 0 || pX >= pContext.Width || pY >= pContext.Height)
            return false;

        var layers = pContext.Layers;
        if(!MapGen.Layers.Get(layers.blocked, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(layers.keepClear, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(layers.occupied, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(layers.outcrop, pX, pY, 0))
            return false;
        if(this.IsCliffCell(pContext, pX, pY))
            return false;
        if(this.IsCliffFootApronCell(pContext, pX, pY))
            return false;

        return true;
    };

    pIce.IsStructureContextCoverCell = function(pContext, pX, pY) {
        var layers = pContext && pContext.Layers;
        return !!(layers && layers.structureContextCover &&
            MapGen.Layers.Get(layers.structureContextCover, pX, pY, 0));
    };

    pIce.HasCardinalTreeLayerNeighbour = function(pContext, pX, pY) {
        return this.IsTreeLayerCell(pContext, pX, pY - 1) ||
            this.IsTreeLayerCell(pContext, pX - 1, pY) ||
            this.IsTreeLayerCell(pContext, pX + 1, pY) ||
            this.IsTreeLayerCell(pContext, pX, pY + 1);
    };

    pIce.IsTreeApronGroundCell = function(pContext, pX, pY) {
        var layers = pContext.Layers;
        if(MapGen.Layers.Get(layers.water, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(layers.riverBank, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(layers.crossing, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(layers.path, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(layers.coast, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(layers.occupied, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(layers.blocked, pX, pY, 0))
            return false;
        if(this.IsCliffCell(pContext, pX, pY))
            return false;
        if(this.IsCliffFootApronCell(pContext, pX, pY))
            return false;

        return this.HasCardinalTreeLayerNeighbour(pContext, pX, pY);
    };

    pIce.HasCardinalTreeCharNeighbour = function(pChars, pX, pY) {
        return this.IsTreeCharValue(MapGen.Layers.Get(pChars, pX, pY - 1, "")) ||
            this.IsTreeCharValue(MapGen.Layers.Get(pChars, pX - 1, pY, "")) ||
            this.IsTreeCharValue(MapGen.Layers.Get(pChars, pX + 1, pY, "")) ||
            this.IsTreeCharValue(MapGen.Layers.Get(pChars, pX, pY + 1, ""));
    };

    pIce.IsTreeApronCharCell = function(pChars, pX, pY) {
        if(MapGen.Layers.Get(pChars, pX, pY, "") !== this.Chars.ground)
            return false;

        return this.HasCardinalTreeCharNeighbour(pChars, pX, pY);
    };

    pIce.ApplyTreeSnowApronChars = function(pContext, pChars) {
        var src = MapGen.Layers.Clone(pChars);
        var changed = 0;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                var current = MapGen.Layers.Get(src, x, y, this.Chars.ground);
                if(current !== this.Chars.wet && current !== this.Chars.ground)
                    continue;
                if(current === this.Chars.wet && (
                    this.IsBankGroundCell(pContext, x, y) ||
                    this.IsWetGroundCell(pContext, x, y)))
                    continue;
                if(!this.HasCardinalTreeCharNeighbour(src, x, y))
                    continue;
                if(MapGen.Layers.Set(pChars, x, y, this.Chars.ground))
                    ++changed;
            }
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Applied ice tree snow apron chars: " + changed);

        return changed;
    };

    pIce.PruneUnsupportedTreeTailChars = function(pContext, pChars) {
        var self = this;
        var total = 0;

        for(var pass = 0; pass < 4; ++pass) {
            var src = MapGen.Layers.Clone(pChars);
            var pending = [];

            function charAt(x, y) {
                return MapGen.Layers.Get(src, x, y, self.Chars.ground);
            }

            function isTree(x, y) {
                return self.IsTreeCharValue(charAt(x, y));
            }

            function canPrune(x, y) {
                if(!isTree(x, y))
                    return false;
                if(MapGen.Layers.Get((pContext.Layers || {}).perimeterCover, x, y, 0))
                    return false;
                if(self.IsStructureContextCoverCell(pContext, x, y))
                    return false;
                if(!isTree(x, y - 1))
                    return false;
                if(isTree(x - 1, y) || isTree(x + 1, y) || isTree(x, y + 1))
                    return false;
                if(self.IsCliffCell(pContext, x, y) || self.IsCliffTopApronCell(pContext, x, y))
                    return false;
                return true;
            }

            for(var x = 1; x < pContext.Width - 1; ++x) {
                for(var y = 1; y < pContext.Height - 1; ++y) {
                    if(canPrune(x, y))
                        pending.push([x, y]);
                }
            }

            if(!pending.length)
                break;

            for(var index = 0; index < pending.length; ++index) {
                MapGen.Layers.Set(pChars, pending[index][0], pending[index][1], this.Chars.ground);
                self.ClearTrimmedTreeMarkers(pContext, pending[index][0], pending[index][1]);
            }
            total += pending.length;
        }

        if(total && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Pruned unsupported ice tree tails: " + total);

        return total;
    };

    pIce.PruneProtectedTreeChars = function(pContext, pChars) {
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var layers = pContext.Layers || {};
        var pending = [];

        function isTreeChar(x, y) {
            return self.IsTreeCharValue(MapGen.Layers.Get(pChars, x, y, self.Chars.ground));
        }

        function protectedByOwner(x, y) {
            if(!layers.owner || !MapGen.Layers.Owner)
                return false;
            var owner = MapGen.Layers.Get(layers.owner, x, y, 0);
            return owner > MapGen.Layers.Owner.TREE;
        }

        function blocksTreeChar(x, y) {
            var occupied = MapGen.Layers.Get(layers.occupied, x, y, 0);
            return self.IsOuterCoverBuffer(pContext, x, y) ||
                MapGen.Layers.Get(layers.keepClear, x, y, 0) ||
                MapGen.Layers.Get(layers.path, x, y, 0) ||
                MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                MapGen.Layers.Get(layers.water, x, y, 0) ||
                MapGen.Layers.Get(layers.coast, x, y, 0) ||
                MapGen.Layers.Get(layers.riverBank, x, y, 0) ||
                MapGen.Layers.Get(layers.structureGround, x, y, 0) ||
                (occupied && occupied !== "live_structure_clearance") ||
                protectedByOwner(x, y) ||
                self.IsCliffCell(pContext, x, y) ||
                self.IsCliffTopApronCell(pContext, x, y) ||
                self.IsCliffFootApronCell(pContext, x, y);
        }

        for(var x = 0; x < width; ++x) {
            for(var y = 0; y < height; ++y) {
                if(isTreeChar(x, y) && blocksTreeChar(x, y))
                    pending.push([x, y]);
            }
        }

        var changed = 0;
        for(var index = 0; index < pending.length; ++index) {
            var cell = pending[index];
            var replacement = self.CellChar(pContext, cell[0], cell[1]);
            if(self.IsTreeCharValue(replacement))
                replacement = self.Chars.ground;
            if(MapGen.Layers.Set(pChars, cell[0], cell[1], replacement)) {
                self.ClearTrimmedTreeMarkers(pContext, cell[0], cell[1]);
                ++changed;
            }
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Pruned protected ice tree chars: " + changed);

        return changed;
    };

})(MapGen.Terrain.Smoothing.Ice);
