var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};
MapGen.Terrain.Smoothing.Ice = MapGen.Terrain.Smoothing.Ice || {};

(function(pIce) {
    pIce.StructureTileChar = function(pTileId) {
        var tileId = pTileId & 0x1FF;

        if((tileId >= 241 && tileId <= 247) ||
            (tileId >= 260 && tileId <= 267) ||
            (tileId >= 280 && tileId <= 287) ||
            (tileId >= 307 && tileId <= 310) ||
            (tileId >= 327 && tileId <= 330) ||
            (tileId >= 347 && tileId <= 350) ||
            (tileId >= 367 && tileId <= 370))
            return this.Chars.ground;

        return "";
    };

    pIce.StructureTileEdgeChar = function(pTileId, pDirection) {
        var tileId = pTileId & 0x1FF;

        // The barracks front art sits on snow. Keep the immediate south
        // apron snow-centered, then let edge matching blend it into nearby ice.
        if(pDirection === "S" && tileId >= 284 && tileId <= 287)
            return this.Chars.ground;

        return "";
    };

    pIce.StructureTileEdgeHintChar = function(pTileId, pDirection) {
        return this.StructureTileChar(pTileId);
    };

    pIce.StructureEdgeHintGlyph = function(pChar) {
        if(pChar === this.Chars.wet)
            return "I";
        if(pChar === this.Chars.ground)
            return "S";
        return null;
    };

    pIce.OppositeDirection = function(pDirection) {
        if(pDirection === "N") return "S";
        if(pDirection === "S") return "N";
        if(pDirection === "E") return "W";
        if(pDirection === "W") return "E";
        return "";
    };

    pIce.StructureMaterialForChar = function(pChar) {
        if(pChar === this.Chars.wet)
            return "ice";
        if(pChar === this.Chars.ground)
            return "snow";
        return "";
    };

    pIce.EnsureStructureGroundMaterialLayer = function(pContext) {
        if(!pContext || !pContext.Layers)
            return null;

        if(!pContext.Layers.structureGroundMaterial)
            pContext.Layers.structureGroundMaterial = MapGen.Layers.Create(pContext.Width, pContext.Height, "");

        return pContext.Layers.structureGroundMaterial;
    };

    pIce.SetStructureGroundMaterial = function(pContext, pX, pY, pChar) {
        var material = this.StructureMaterialForChar(pChar);
        if(!material)
            return false;

        var layer = this.EnsureStructureGroundMaterialLayer(pContext);
        if(!layer)
            return false;

        return MapGen.Layers.Set(layer, pX, pY, material);
    };

    pIce.StructureGroundMaterialChar = function(pContext, pX, pY) {
        if(!pContext || !pContext.Layers || !pContext.Layers.structureGroundMaterial)
            return "";

        var material = MapGen.Layers.Get(pContext.Layers.structureGroundMaterial, pX, pY, "");
        if(material === "ice")
            return this.Chars.wet;
        if(material === "snow")
            return this.Chars.ground;
        return "";
    };

    pIce.SyncStructureGroundMaterials = function(pContext, pChars) {
        if(!pContext || !pContext.Layers || !pContext.Layers.structureGroundMaterial || !pChars)
            return 0;

        var layer = pContext.Layers.structureGroundMaterial;
        var changed = 0;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                var current = MapGen.Layers.Get(layer, x, y, "");
                if(!current)
                    continue;

                var ch = MapGen.Layers.Get(pChars, x, y, this.Chars.ground);
                var desired = "";
                if(ch === this.Chars.ground)
                    desired = "snow";
                else if(ch === this.Chars.wet)
                    desired = "ice";

                if(current === desired)
                    continue;

                MapGen.Layers.Set(layer, x, y, desired);
                ++changed;
            }
        }

        return changed;
    };

    pIce.EnsureStructurePlainGroundLayer = function(pContext) {
        if(!pContext || !pContext.Layers)
            return null;

        if(!pContext.Layers.structurePlainGround)
            pContext.Layers.structurePlainGround = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);

        return pContext.Layers.structurePlainGround;
    };

    pIce.SetStructurePlainGround = function(pContext, pX, pY) {
        var layer = this.EnsureStructurePlainGroundLayer(pContext);
        if(!layer)
            return false;

        return MapGen.Layers.Set(layer, pX, pY, 1);
    };

    pIce.IsStructurePlainGround = function(pContext, pX, pY) {
        return pContext && pContext.Layers && pContext.Layers.structurePlainGround ?
            MapGen.Layers.Get(pContext.Layers.structurePlainGround, pX, pY, 0) :
            0;
    };

    // PERF: StructureApronDistanceSq and HasNearbyStructureArt are called up to 2x
    // per cell inside the Wang matcher PLUS across ~12 full-grid smoothing passes,
    // recomputing an answer that is CONSTANT for the whole Render (structure
    // placements + committed structure art don't change mid-Render). We materialize
    // both as per-cell grids ONCE at the start of pIce.Render via
    // BuildStructureProximityCache, then the functions below read the grid (O(1))
    // instead of rescanning placements/the engine map per call. The grid values are
    // exactly what the original per-cell logic returned, so output is byte-identical;
    // the cache is cleared at Render end so it never leaks across renders/attempts.
    pIce.BuildStructureProximityCache = function(pContext) {
        var W = pContext.Width;
        var H = pContext.Height;

        // --- Apron distance-sq grid: replicate StructureApronDistanceSq exactly. ---
        // For each placement, precompute its footprint set + bounding box once
        // (instead of per cell), then stamp the box-distance into every cell that is
        // NOT inside that placement's footprint, keeping the per-cell minimum.
        var dist = new Array(W * H);
        var i;
        for(i = 0; i < dist.length; ++i)
            dist[i] = -1;

        var placements = pContext.LiveStructurePlacements || [];
        for(var pIndex = 0; pIndex < placements.length; ++pIndex) {
            var placement = placements[pIndex];
            var struct = this.StructurePlacementStruct(placement);
            if(!struct)
                continue;

            var footprint = new Uint8Array(W * H);
            var minX = W, minY = H, maxX = -1, maxY = -1;
            for(var tileIndex = 0; tileIndex < struct.length; ++tileIndex) {
                var sx = placement.tileX + struct[tileIndex][0];
                var sy = placement.tileY + struct[tileIndex][1];
                if(sx >= 0 && sy >= 0 && sx < W && sy < H)
                    footprint[sy * W + sx] = 1;
                if(sx < minX) minX = sx;
                if(sy < minY) minY = sy;
                if(sx > maxX) maxX = sx;
                if(sy > maxY) maxY = sy;
            }
            if(maxX < minX || maxY < minY)
                continue;

            for(var y = 0; y < H; ++y) {
                var row = y * W;
                var dy = y < minY ? minY - y : (y > maxY ? y - maxY : 0);
                var dySq = dy * dy;
                for(var x = 0; x < W; ++x) {
                    var idx = row + x;
                    if(footprint[idx])
                        continue;
                    var dx = 0;
                    if(x < minX) dx = minX - x;
                    else if(x > maxX) dx = x - maxX;
                    var distSq = (dx * dx) + dySq;
                    if(dist[idx] < 0 || distSq < dist[idx])
                        dist[idx] = distSq;
                }
            }
        }

        // --- Structure-art proximity grids: replicate HasNearbyStructureArt for the
        // only radii used in the smoother (2 and 3). Mark every art cell, then dilate
        // by Chebyshev radius. ---
        var near2 = new Uint8Array(W * H);
        var near3 = new Uint8Array(W * H);
        if(typeof Map !== "undefined" && Map.TileGet) {
            var artX = [];
            var artY = [];
            for(var ay = 0; ay < H; ++ay) {
                for(var ax = 0; ax < W; ++ax) {
                    if(this.StructureTileChar(Map.TileGet(ax, ay) & 0x1FF)) {
                        artX.push(ax);
                        artY.push(ay);
                    }
                }
            }
            for(var a = 0; a < artX.length; ++a) {
                var cx = artX[a], cy = artY[a];
                for(var ddy = -3; ddy <= 3; ++ddy) {
                    var ny = cy + ddy;
                    if(ny < 0 || ny >= H) continue;
                    for(var ddx = -3; ddx <= 3; ++ddx) {
                        var nx = cx + ddx;
                        if(nx < 0 || nx >= W) continue;
                        var cheb = Math.max(Math.abs(ddx), Math.abs(ddy));
                        var nidx = ny * W + nx;
                        near3[nidx] = 1;
                        if(cheb <= 2)
                            near2[nidx] = 1;
                    }
                }
            }
        }

        pContext._iceStructProximity = {
            W: W, H: H,
            dist: dist,
            near2: near2,
            near3: near3
        };
    };

    pIce.ClearStructureProximityCache = function(pContext) {
        if(pContext)
            pContext._iceStructProximity = null;
    };

    pIce.StructureApronDistanceSq = function(pContext, pX, pY) {
        var cache = pContext && pContext._iceStructProximity;
        if(cache && pX >= 0 && pY >= 0 && pX < cache.W && pY < cache.H)
            return cache.dist[pY * cache.W + pX];

        var placements = (pContext && pContext.LiveStructurePlacements) || [];
        var best = -1;

        for(var placementIndex = 0; placementIndex < placements.length; ++placementIndex) {
            var placement = placements[placementIndex];
            var struct = this.StructurePlacementStruct(placement);
            if(!struct)
                continue;

            var footprint = this.StructureFootprintMap(placement, struct);
            if(footprint[pX + "," + pY])
                continue;

            var minX = pContext.Width;
            var minY = pContext.Height;
            var maxX = -1;
            var maxY = -1;
            for(var tileIndex = 0; tileIndex < struct.length; ++tileIndex) {
                var sx = placement.tileX + struct[tileIndex][0];
                var sy = placement.tileY + struct[tileIndex][1];
                if(sx < minX) minX = sx;
                if(sy < minY) minY = sy;
                if(sx > maxX) maxX = sx;
                if(sy > maxY) maxY = sy;
            }

            if(maxX < minX || maxY < minY)
                continue;

            var dx = 0;
            if(pX < minX) dx = minX - pX;
            else if(pX > maxX) dx = pX - maxX;

            var dy = 0;
            if(pY < minY) dy = minY - pY;
            else if(pY > maxY) dy = pY - maxY;

            var distSq = (dx * dx) + (dy * dy);
            if(best < 0 || distSq < best)
                best = distSq;
        }

        return best;
    };

    pIce.IsStructurePlainPadCell = function(pContext, pX, pY) {
        if(this.HasNearbyStructureArt(pContext, pX, pY, 2))
            return true;

        var distSq = this.StructureApronDistanceSq(pContext, pX, pY);
        if(distSq >= 0 && distSq <= 4)
            return true;

        var structures = pContext && pContext.Placements ? (pContext.Placements.structures || []) : [];
        for(var index = 0; index < structures.length; ++index) {
            var structure = structures[index];
            if(!structure || structure.kind !== "live_structure" || !structure.point)
                continue;

            var dx = Math.abs(pX - structure.point.x);
            var dy = Math.abs(pY - structure.point.y);
            if(dx <= 3 && dy <= 3)
                return true;
        }

        return false;
    };

    pIce.NeedsCardinalTerrainTransition = function(pChars, pX, pY) {
        if(!pChars)
            return false;

        var charToClass = this.CharToClass();
        var current = MapGen.Layers.Get(pChars, pX, pY, this.Chars.ground);
        var currentClass = charToClass[current] || charToClass["__default__"] || "snow";
        var dirs = [
            [0, -1],
            [1, 0],
            [0, 1],
            [-1, 0]
        ];

        for(var i = 0; i < dirs.length; ++i) {
            var n = MapGen.Layers.Get(pChars, pX + dirs[i][0], pY + dirs[i][1], current);
            var nclass = charToClass[n] || charToClass["__default__"] || "snow";
            if(nclass !== currentClass)
                return true;
        }

        return false;
    };

    pIce.HasNearbyStructureArt = function(pContext, pX, pY, pRadius) {
        var cache = pContext && pContext._iceStructProximity;
        if(cache && (pRadius === 2 || pRadius === 3) &&
            pX >= 0 && pY >= 0 && pX < cache.W && pY < cache.H)
            return !!(pRadius === 3 ? cache.near3 : cache.near2)[pY * cache.W + pX];

        if(typeof Map === "undefined" || !Map.TileGet)
            return false;

        for(var dx = -pRadius; dx <= pRadius; ++dx) {
            for(var dy = -pRadius; dy <= pRadius; ++dy) {
                if(Math.max(Math.abs(dx), Math.abs(dy)) > pRadius)
                    continue;

                var x = pX + dx;
                var y = pY + dy;
                if(x < 0 || y < 0 || x >= pContext.Width || y >= pContext.Height)
                    continue;

                var tile = Map.TileGet(x, y) & 0x1FF;
                if(this.StructureTileChar(tile))
                    return true;
            }
        }

        return false;
    };

    pIce.StructurePlacementStruct = function(pPlacement) {
        if(!pPlacement || !pPlacement.spec || typeof Structures === "undefined" || !Structures.GetStructInfo)
            return null;

        var info = Structures.GetStructInfo(pPlacement.spec.building);
        if(!info || !info.Struct || !info.Struct.length)
            return null;

        return info.Struct[0];
    };

    pIce.StructureFootprintMap = function(pPlacement, pStruct) {
        var footprint = {};

        for(var index = 0; index < pStruct.length; ++index) {
            var tileX = pPlacement.tileX + pStruct[index][0];
            var tileY = pPlacement.tileY + pStruct[index][1];
            footprint[tileX + "," + tileY] = true;
        }

        return footprint;
    };

    pIce.EnsureStructureEdgeHintLayer = function(pContext) {
        if(!pContext || !pContext.Layers)
            return null;

        if(!pContext.Layers.structureEdgeHints)
            pContext.Layers.structureEdgeHints = MapGen.Layers.Create(pContext.Width, pContext.Height, null);

        return pContext.Layers.structureEdgeHints;
    };

    pIce.SetStructureEdgeHint = function(pContext, pX, pY, pDirection, pGlyph) {
        if(!pGlyph)
            return false;

        var layer = this.EnsureStructureEdgeHintLayer(pContext);
        if(!layer || pX < 0 || pY < 0 || pX >= pContext.Width || pY >= pContext.Height)
            return false;

        var existing = MapGen.Layers.Get(layer, pX, pY, null);
        if(!existing)
            existing = {};

        existing[pDirection] = pGlyph;
        return MapGen.Layers.Set(layer, pX, pY, existing);
    };

    pIce.BuildStructureEdgeHints = function(pContext) {
        if(!pContext || !pContext.Layers)
            return 0;

        pContext.Layers.structureEdgeHints = MapGen.Layers.Create(pContext.Width, pContext.Height, null);

        var placements = pContext.LiveStructurePlacements || [];
        var dirs = [
            { name: "N", x: 0, y: -1 },
            { name: "E", x: 1, y: 0 },
            { name: "S", x: 0, y: 1 },
            { name: "W", x: -1, y: 0 }
        ];
        var applied = 0;

        for(var placementIndex = 0; placementIndex < placements.length; ++placementIndex) {
            var placement = placements[placementIndex];
            var struct = this.StructurePlacementStruct(placement);
            if(!struct)
                continue;

            var footprint = this.StructureFootprintMap(placement, struct);
            for(var tileIndex = 0; tileIndex < struct.length; ++tileIndex) {
                var tile = struct[tileIndex];
                var x = placement.tileX + tile[0];
                var y = placement.tileY + tile[1];

                for(var dirIndex = 0; dirIndex < dirs.length; ++dirIndex) {
                    var dir = dirs[dirIndex];
                    var nx = x + dir.x;
                    var ny = y + dir.y;
                    if(footprint[nx + "," + ny])
                        continue;

                    var ch = this.StructureTileEdgeHintChar(tile[2], dir.name);
                    var glyph = this.StructureEdgeHintGlyph(ch);
                    var opposite = this.OppositeDirection(dir.name);
                    if(this.CanApplyStructureEdgeChar(pContext, nx, ny) &&
                        this.SetStructureEdgeHint(pContext, nx, ny, opposite, glyph))
                        ++applied;
                }
            }
        }

        return applied;
    };

    pIce.CanApplyStructureEdgeChar = function(pContext, pX, pY) {
        if(!pContext || !pContext.Layers)
            return false;
        if(pX < 0 || pY < 0 || pX >= pContext.Width || pY >= pContext.Height)
            return false;

        var layers = pContext.Layers;
        if(MapGen.Layers.Get(layers.water, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(layers.riverBank, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(layers.crossing, pX, pY, 0))
            return false;
        if(this.IsCliffCell(pContext, pX, pY))
            return false;

        var occupied = MapGen.Layers.Get(layers.occupied, pX, pY, 0);
        return !occupied ||
            occupied === "structure_cluster" ||
            occupied === "objective_structure" ||
            occupied === "live_structure_clearance";
    };

    pIce.ApplyStructureArtChars = function(pContext, pChars) {
        var placements = (pContext && pContext.LiveStructurePlacements) || [];
        var applied = 0;

        for(var placementIndex = 0; placementIndex < placements.length; ++placementIndex) {
            var placement = placements[placementIndex];
            var struct = this.StructurePlacementStruct(placement);
            if(!struct)
                continue;

            for(var tileIndex = 0; tileIndex < struct.length; ++tileIndex) {
                var tile = struct[tileIndex];
                var ch = this.StructureTileChar(tile[2]);
                if(!ch)
                    continue;

                var x = placement.tileX + tile[0];
                var y = placement.tileY + tile[1];
                if(MapGen.Layers.Set(pChars, x, y, ch)) {
                    this.SetStructureGroundMaterial(pContext, x, y, ch);
                    ++applied;
                }
            }
        }

        return applied;
    };

    pIce.CanApplyStructureApronChar = function(pContext, pX, pY) {
        if(!pContext || !pContext.Layers)
            return false;
        if(pX < 0 || pY < 0 || pX >= pContext.Width || pY >= pContext.Height)
            return false;

        var layers = pContext.Layers;
        if(MapGen.Layers.Get(layers.water, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(layers.riverBank, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(layers.crossing, pX, pY, 0))
            return false;
        if(this.IsCliffCell(pContext, pX, pY))
            return false;

        var occupied = MapGen.Layers.Get(layers.occupied, pX, pY, 0);
        return !occupied ||
            occupied === "structure_cluster" ||
            occupied === "objective_structure" ||
            occupied === "live_structure_clearance" ||
            occupied === "live_structure";
    };

    pIce.ClearStructureApronCell = function(pContext, pX, pY) {
        var layers = pContext.Layers;
        MapGen.Layers.Set(layers.blocked, pX, pY, 0);
        MapGen.Layers.Set(layers.outcrop, pX, pY, 0);
        MapGen.Layers.Set(layers.terrainEdge, pX, pY, 0);
        MapGen.Layers.Set(layers.coast, pX, pY, 0);
        MapGen.Layers.Set(layers.forcedBank, pX, pY, 0);
        MapGen.Layers.Set(layers.lakeShore, pX, pY, 0);
        MapGen.Layers.Set(layers.keepClear, pX, pY, 1);
    };

    pIce.ApplyStructureApronChars = function(pContext, pChars) {
        var placements = (pContext && pContext.LiveStructurePlacements) || [];
        var applied = 0;

        for(var placementIndex = 0; placementIndex < placements.length; ++placementIndex) {
            var placement = placements[placementIndex];
            var struct = this.StructurePlacementStruct(placement);
            if(!struct)
                continue;

            var footprint = this.StructureFootprintMap(placement, struct);
            var minX = pContext.Width;
            var minY = pContext.Height;
            var maxX = -1;
            var maxY = -1;
            for(var tileIndex = 0; tileIndex < struct.length; ++tileIndex) {
                var sx = placement.tileX + struct[tileIndex][0];
                var sy = placement.tileY + struct[tileIndex][1];
                if(sx < minX) minX = sx;
                if(sy < minY) minY = sy;
                if(sx > maxX) maxX = sx;
                if(sy > maxY) maxY = sy;
            }

            if(maxX < minX || maxY < minY)
                continue;

            // Rounded snow pad: keep transitions away from the structure art.
            // The smoother still owns the outer snow/ice boundary, but the
            // building-adjacent cells remain plain snow instead of boundary
            // triangles pressed against walls.
            var radius = 3;
            var plainRadius = 2;
            var radiusSq = radius * radius;
            var plainRadiusSq = plainRadius * plainRadius;
            for(var x = minX - radius; x <= maxX + radius; ++x) {
                for(var y = minY - radius; y <= maxY + radius; ++y) {
                    if(footprint[x + "," + y])
                        continue;

                    var dx = 0;
                    if(x < minX) dx = minX - x;
                    else if(x > maxX) dx = x - maxX;

                    var dy = 0;
                    if(y < minY) dy = minY - y;
                    else if(y > maxY) dy = y - maxY;

                    if((dx * dx) + (dy * dy) > radiusSq)
                        continue;
                    if(!this.CanApplyStructureApronChar(pContext, x, y))
                        continue;

                    this.ClearStructureApronCell(pContext, x, y);
                    if(MapGen.Layers.Set(pChars, x, y, this.Chars.ground)) {
                        this.SetStructureGroundMaterial(pContext, x, y, this.Chars.ground);
                        if((dx * dx) + (dy * dy) <= plainRadiusSq)
                            this.SetStructurePlainGround(pContext, x, y);
                        ++applied;
                    }
                }
            }
        }

        return applied;
    };

    pIce.ApplyStructureEdgeInfluence = function(pContext, pChars) {
        var placements = (pContext && pContext.LiveStructurePlacements) || [];
        var dirs = [
            { name: "N", x: 0, y: -1 },
            { name: "E", x: 1, y: 0 },
            { name: "S", x: 0, y: 1 },
            { name: "W", x: -1, y: 0 }
        ];
        var applied = 0;

        for(var placementIndex = 0; placementIndex < placements.length; ++placementIndex) {
            var placement = placements[placementIndex];
            var struct = this.StructurePlacementStruct(placement);
            if(!struct)
                continue;

            var footprint = this.StructureFootprintMap(placement, struct);
            for(var tileIndex = 0; tileIndex < struct.length; ++tileIndex) {
                var tile = struct[tileIndex];
                var x = placement.tileX + tile[0];
                var y = placement.tileY + tile[1];

                for(var dirIndex = 0; dirIndex < dirs.length; ++dirIndex) {
                    var dir = dirs[dirIndex];
                    var nx = x + dir.x;
                    var ny = y + dir.y;
                    if(footprint[nx + "," + ny])
                        continue;

                    var ch = this.StructureTileEdgeChar(tile[2], dir.name);
                    if(!ch || !this.CanApplyStructureEdgeChar(pContext, nx, ny))
                        continue;

                    if(MapGen.Layers.Set(pChars, nx, ny, ch)) {
                        this.SetStructureGroundMaterial(pContext, nx, ny, ch);
                        ++applied;
                    }
                }
            }
        }

        return applied;
    };
})(MapGen.Terrain.Smoothing.Ice);
