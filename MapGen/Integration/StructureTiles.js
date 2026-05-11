var MapGen = MapGen || {};
MapGen.Integration = MapGen.Integration || {};

// Structure tile painting, sprite checks and ice apron rendering.
(function(pIntegration) {
    pIntegration.StructureTileStruct = function(pSpec) {
        var info = Structures.GetStructInfo(pSpec.building);

        if(!info || !info.Struct || !info.Struct.length)
            return null;

        return info.Struct[0];
    };

    pIntegration.PaintStructureTilesOnly = function(pSpec, pTileX, pTileY, pMap) {
        var map = pMap || (typeof Map !== "undefined" ? Map : null);
        if(!map || !map.TileSet)
            return false;

        var struct = this.StructureTileStruct(pSpec);
        if(!struct)
            return false;

        for(var index = 0; index < struct.length; ++index)
            map.TileSet(pTileX + struct[index][0], pTileY + struct[index][1], struct[index][2]);

        return true;
    };

    pIntegration.PaintStructureTilesToRenderedMap = function(pContext, pSpec, pTileX, pTileY) {
        if(!pContext || !pContext.RenderedMap || !pContext.RenderedMap.Tiles ||
            !MapGen.Layers || !MapGen.Layers.Set)
            return false;

        var struct = this.StructureTileStruct(pSpec);
        if(!struct)
            return false;

        for(var index = 0; index < struct.length; ++index) {
            if(!MapGen.Layers.Set(
                pContext.RenderedMap.Tiles,
                pTileX + struct[index][0],
                pTileY + struct[index][1],
                struct[index][2]))
                return false;
        }

        return true;
    };

    pIntegration.RepaintLiveStructureTiles = function(pContext) {
        var placements = pContext && pContext.LiveStructurePlacements ?
            pContext.LiveStructurePlacements : [];
        var map = pContext && pContext.Map ?
            pContext.Map : (typeof Map !== "undefined" ? Map : null);
        var report = { ok: true, placements: placements.length, cells: 0, reasons: [] };

        for(var index = 0; index < placements.length; ++index) {
            var placement = placements[index];
            var struct = placement ? this.StructureTileStruct(placement.spec) : null;
            if(!placement || !struct) {
                report.ok = false;
                report.reasons.push("live_structure_stamp_missing:" + index);
                continue;
            }

            if(!this.PaintStructureTilesToRenderedMap(
                pContext, placement.spec, placement.tileX, placement.tileY)) {
                report.ok = false;
                report.reasons.push("live_structure_stamp_out_of_bounds:" + index);
                continue;
            }
            if(!this.PaintStructureTilesOnly(
                placement.spec, placement.tileX, placement.tileY, map)) {
                report.ok = false;
                report.reasons.push("live_structure_map_unavailable:" + index);
                continue;
            }
            report.cells += struct.length;
        }

        return report;
    };

    pIntegration.ValidateLiveStructureTiles = function(pContext) {
        var placements = pContext && pContext.LiveStructurePlacements ?
            pContext.LiveStructurePlacements : [];
        var map = pContext && pContext.Map ?
            pContext.Map : (typeof Map !== "undefined" ? Map : null);
        var renderedTiles = pContext && pContext.RenderedMap ?
            pContext.RenderedMap.Tiles : null;
        var report = { ok: true, placements: placements.length, cells: 0, reasons: [] };

        if(placements.length && (!map || !map.TileGet || !renderedTiles))
            return { ok: false, placements: placements.length, cells: 0,
                reasons: ["live_structure_tile_validation_unavailable"] };

        for(var index = 0; index < placements.length; ++index) {
            var placement = placements[index];
            var struct = placement ? this.StructureTileStruct(placement.spec) : null;
            if(!placement || !struct) {
                report.ok = false;
                report.reasons.push("live_structure_stamp_missing:" + index);
                continue;
            }

            for(var tileIndex = 0; tileIndex < struct.length; ++tileIndex) {
                var x = placement.tileX + struct[tileIndex][0];
                var y = placement.tileY + struct[tileIndex][1];
                var expected = struct[tileIndex][2] & 0x1FF;
                var rendered = MapGen.Layers.Get(renderedTiles, x, y, -1);
                var committed = map.TileGet(x, y);
                ++report.cells;

                if((rendered & 0x1FF) !== expected || (committed & 0x1FF) !== expected) {
                    report.ok = false;
                    report.reasons.push(
                        "live_structure_tile_mismatch:" + index + ":" + x + "," + y +
                        ":" + expected + "/" + rendered + "/" + committed);
                    return report;
                }
            }
        }

        return report;
    };

    pIntegration.StructureSpriteSlots = function(pSpec) {
        var info = pSpec ? Structures.GetStructInfo(pSpec.building) : null;
        var spriteSet = pSpec && pSpec.sprite ? pSpec.sprite.toLowerCase() : "";

        if(!info || !info.Types || !Object.prototype.hasOwnProperty.call(info.Types, spriteSet))
            return null;

        return info.Types[spriteSet];
    };

    // Structure tiles and sprites are committed through different engine paths.
    // Verify the live sprite anchors before saving so an authored-offset drift
    // cannot silently produce a door or roof detached from its tile stamp.
    pIntegration.ValidateLiveStructureSprites = function(pContext) {
        var placements = pContext && pContext.LiveStructurePlacements ?
            pContext.LiveStructurePlacements : [];
        var map = pContext && pContext.Map ?
            pContext.Map : (typeof Map !== "undefined" ? Map : null);
        var report = { ok: true, placements: placements.length, sprites: 0, reasons: [] };

        if(placements.length && (!map || !map.getSpritesByType ||
            !Structures || !Structures.SpritePosition)) {
            return { ok: false, placements: placements.length, sprites: 0,
                reasons: ["live_structure_sprite_validation_unavailable"] };
        }

        var spritesByType = {};
        var usedByType = {};

        for(var placementIndex = 0; placementIndex < placements.length; ++placementIndex) {
            var placement = placements[placementIndex];
            var slots = placement ? this.StructureSpriteSlots(placement.spec) : null;
            if(!placement || !slots) {
                report.ok = false;
                report.reasons.push("live_structure_sprite_slots_missing:" + placementIndex);
                continue;
            }

            for(var slotIndex = 0; slotIndex < slots.length; ++slotIndex) {
                var slot = slots[slotIndex];
                var type = slot[2];
                var expected = Structures.SpritePosition(placement.tileX, placement.tileY, slot);
                var key = String(type);
                if(!Object.prototype.hasOwnProperty.call(spritesByType, key)) {
                    spritesByType[key] = map.getSpritesByType(type);
                    usedByType[key] = [];
                }

                var sprites = spritesByType[key];
                var matched = -1;
                var nearest = null;
                var nearestDistance = null;
                for(var spriteIndex = 0; spriteIndex < sprites.length; ++spriteIndex) {
                    if(usedByType[key][spriteIndex])
                        continue;

                    var position = sprites[spriteIndex].getPosition();
                    var distance = Math.abs(position.x - expected.x) +
                        Math.abs(position.y - expected.y);
                    if(nearestDistance === null || distance < nearestDistance) {
                        nearestDistance = distance;
                        nearest = position;
                    }
                    if(distance === 0) {
                        matched = spriteIndex;
                        break;
                    }
                }

                ++report.sprites;
                if(matched >= 0) {
                    usedByType[key][matched] = true;
                    continue;
                }

                report.ok = false;
                report.reasons.push(
                    "live_structure_sprite_mismatch:" + placementIndex + ":" + slotIndex +
                    ":" + type + ":" + expected.x + "," + expected.y +
                    (nearest ? ":nearest=" + nearest.x + "," + nearest.y : ":missing")
                );
                return report;
            }
        }

        return report;
    };

    pIntegration.IsIceStructureArtTile = function(pTileId) {
        var tileId = pTileId & 0x1FF;

        return (tileId >= 241 && tileId <= 247) ||
            (tileId >= 260 && tileId <= 267) ||
            (tileId >= 280 && tileId <= 287) ||
            (tileId >= 307 && tileId <= 310) ||
            (tileId >= 327 && tileId <= 330) ||
            (tileId >= 347 && tileId <= 350) ||
            (tileId >= 367 && tileId <= 370);
    };

    pIntegration.IsIceTreeArtTile = function(pTileId) {
        var tileId = pTileId & 0x1FF;

        return (tileId >= 152 && tileId <= 155) ||
            (tileId >= 170 && tileId <= 175) ||
            (tileId >= 190 && tileId <= 199) ||
            (tileId >= 210 && tileId <= 219) ||
            (tileId >= 230 && tileId <= 239) ||
            tileId === 251 ||
            tileId === 360 ||
            tileId === 380;
    };

    pIntegration.PaintIceStructurePlainAprons = function(pContext) {
        if(!pContext || !pContext.Profile || pContext.Profile.TerrainType !== Terrain.Types.Ice)
            return 0;
        if(typeof Map === "undefined" || !Map.TileGet || !Map.TileSet)
            return 0;
        if(!MapGen.Terrain || !MapGen.Terrain.Smoothing ||
            !MapGen.Terrain.Smoothing.Ice || !MapGen.Terrain.Smoothing.Ice.Data ||
            !MapGen.Terrain.Smoothing.Core || !MapGen.Terrain.Smoothing.Core.ApplyEdgeRule)
            return 0;

        var ice = MapGen.Terrain.Smoothing.Ice;
        var data = ice.Data();
        if(!data || !data.edges || !data.charToClass)
            return 0;

        var structureCells = [];
        var structureMask = {};
        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(this.IsIceStructureArtTile(Map.TileGet(x, y))) {
                    structureCells.push({ x: x, y: y });
                    structureMask[x + "," + y] = true;
                }
            }
        }

        if(!structureCells.length)
            return 0;

        var plainMask = {};
        var smoothMask = {};
        var self = this;
        var smoothRadiusSq = pContext.Profile && typeof pContext.Profile.IceStructureSmoothApronRadiusSq === "number" ?
            Math.max(0, pContext.Profile.IceStructureSmoothApronRadiusSq) :
            9;
        var plainRadiusSq = pContext.Profile && typeof pContext.Profile.IceStructurePlainApronRadiusSq === "number" ?
            Math.max(0, pContext.Profile.IceStructurePlainApronRadiusSq) :
            4;
        var scanRadius = Math.max(0, Math.ceil(Math.sqrt(smoothRadiusSq)));
        var canPaint = function(px, py) {
            if(px < 0 || py < 0 || px >= pContext.Width || py >= pContext.Height)
                return false;
            if(structureMask[px + "," + py])
                return false;
            if(pContext.Layers && (
                MapGen.Layers.Get(pContext.Layers.water, px, py, 0) ||
                MapGen.Layers.Get(pContext.Layers.riverBank, px, py, 0) ||
                MapGen.Layers.Get(pContext.Layers.crossing, px, py, 0)))
                return false;
            if(self.IsStructureCliffProtectedCell(pContext, px, py))
                return false;
            if(ice.IsWetGroundCell && ice.IsWetGroundCell(pContext, px, py))
                return false;
            if(self.IsIceTreeArtTile(Map.TileGet(px, py)))
                return false;
            return true;
        };

        var componentBounds = [];
        var visited = {};
        for(var seedIndex = 0; seedIndex < structureCells.length; ++seedIndex) {
            var seed = structureCells[seedIndex];
            var seedKey = seed.x + "," + seed.y;
            if(visited[seedKey])
                continue;

            var bounds = {
                minX: seed.x,
                minY: seed.y,
                maxX: seed.x,
                maxY: seed.y
            };
            var queue = [seed];
            visited[seedKey] = true;

            for(var queueIndex = 0; queueIndex < queue.length; ++queueIndex) {
                var q = queue[queueIndex];
                if(q.x < bounds.minX) bounds.minX = q.x;
                if(q.y < bounds.minY) bounds.minY = q.y;
                if(q.x > bounds.maxX) bounds.maxX = q.x;
                if(q.y > bounds.maxY) bounds.maxY = q.y;

                for(var nxOff = -1; nxOff <= 1; ++nxOff) {
                    for(var nyOff = -1; nyOff <= 1; ++nyOff) {
                        if(nxOff === 0 && nyOff === 0)
                            continue;
                        var nx = q.x + nxOff;
                        var ny = q.y + nyOff;
                        var nextKey = nx + "," + ny;
                        if(visited[nextKey] || !structureMask[nextKey])
                            continue;

                        visited[nextKey] = true;
                        queue.push({ x: nx, y: ny });
                    }
                }
            }

            componentBounds.push(bounds);
        }

        var distanceSqFromRect = function(px, py, bounds) {
            var dx = 0;
            if(px < bounds.minX) dx = bounds.minX - px;
            else if(px > bounds.maxX) dx = px - bounds.maxX;

            var dy = 0;
            if(py < bounds.minY) dy = bounds.minY - py;
            else if(py > bounds.maxY) dy = py - bounds.maxY;

            return (dx * dx) + (dy * dy);
        };

        for(var boundsIndex = 0; boundsIndex < componentBounds.length; ++boundsIndex) {
            var component = componentBounds[boundsIndex];
            for(var tx = component.minX - scanRadius; tx <= component.maxX + scanRadius; ++tx) {
                for(var ty = component.minY - scanRadius; ty <= component.maxY + scanRadius; ++ty) {
                    if(!canPaint(tx, ty))
                        continue;

                    var distSq = distanceSqFromRect(tx, ty, component);
                    if(distSq > smoothRadiusSq)
                        continue;

                    var key = tx + "," + ty;
                    smoothMask[key] = { x: tx, y: ty };
                    if(distSq <= plainRadiusSq)
                        plainMask[key] = { x: tx, y: ty };
                }
            }
        }

        var centerClassForTile = function(tileId) {
            var rec = data.edges.tiles[String(tileId & 0x1FF)];
            return rec && rec.center ? rec.center : "snow";
        };
        var glyphForClass = function(center) {
            return center === "snow" ? "S" : "I";
        };
        var hasContents = function(rec, content) {
            if(!rec || !rec.contents)
                return false;
            for(var i = 0; i < rec.contents.length; ++i) {
                if(rec.contents[i] === content)
                    return true;
            }
            return false;
        };
        var pickBlendTile = function(px, py) {
            var dirs = [
                { name: "N", x: 0, y: -1 },
                { name: "E", x: 1, y: 0 },
                { name: "S", x: 0, y: 1 },
                { name: "W", x: -1, y: 0 }
            ];
            var desired = {};
            var hasIceEdge = false;

            for(var dirIndex = 0; dirIndex < dirs.length; ++dirIndex) {
                var dir = dirs[dirIndex];
                var nx = px + dir.x;
                var ny = py + dir.y;
                var key = nx + "," + ny;

                if(nx < 0 || ny < 0 || nx >= pContext.Width || ny >= pContext.Height ||
                    smoothMask[key] || structureMask[key]) {
                    desired[dir.name] = "S";
                    continue;
                }

                var glyph = glyphForClass(centerClassForTile(Map.TileGet(nx, ny)));
                desired[dir.name] = glyph;
                if(glyph === "I")
                    hasIceEdge = true;
            }

            if(!hasIceEdge)
                return MapGen.Render.PickTile([0, 1], pContext, px, py, 913);

            var candidates = data.edges.byCenter && data.edges.byCenter.snow ? data.edges.byCenter.snow : [0, 1];
            var bestTile = candidates[0];
            var bestScore = -1e9;
            for(var candIndex = 0; candIndex < candidates.length; ++candIndex) {
                var candidate = candidates[candIndex];
                var rec = data.edges.tiles[String(candidate)];
                if(!rec || rec.center !== "snow" || !hasContents(rec, "ice"))
                    continue;

                var score = 0;
                score += MapGen.Terrain.Smoothing.Core.ScoreEdgeMatch(rec.edges.N, null, desired.N);
                score += MapGen.Terrain.Smoothing.Core.ScoreEdgeMatch(rec.edges.E, null, desired.E);
                score += MapGen.Terrain.Smoothing.Core.ScoreEdgeMatch(rec.edges.S, null, desired.S);
                score += MapGen.Terrain.Smoothing.Core.ScoreEdgeMatch(rec.edges.W, null, desired.W);
                score += (MapGen.Random.HashTile(pContext.Seed || 0, px, py, 914 + candidate) & 7) * 0.001;

                if(score > bestScore) {
                    bestScore = score;
                    bestTile = candidate;
                }
            }

            return bestTile;
        };

        var changed = 0;
        for(var applyKey in smoothMask) {
            if(!Object.prototype.hasOwnProperty.call(smoothMask, applyKey))
                continue;
            var point = smoothMask[applyKey];
            var tile = plainMask[applyKey] ?
                MapGen.Render.PickTile([0, 1], pContext, point.x, point.y, 913) :
                pickBlendTile(point.x, point.y);
            if(Map.TileGet(point.x, point.y) === tile)
                continue;

            Map.TileSet(point.x, point.y, tile);
            if(pContext.RenderedMap && pContext.RenderedMap.Tiles)
                MapGen.Layers.Set(pContext.RenderedMap.Tiles, point.x, point.y, tile);
            ++changed;
        }

        return changed;
    };
})(MapGen.Integration);
