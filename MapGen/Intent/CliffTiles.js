var MapGen = MapGen || {};
MapGen.Intent = MapGen.Intent || {};

// MapGen.Intent.CliffTiles — Phase 5 P5.1.
//
// Synthesizes `pContext.Cliffs[]` records from IntentMap CLIFF_BODY/CLIFF_TOP
// cells so the existing v1 cliff-tile painter (Features.PlateauCliffs.OverlayTiles
// at Render.js:265) stamps actual cliff art onto the rendered tile grid.
//
// What v1 does (PlateauCliffs.buildModern):
//   1. Walks columns of the cliff band.
//   2. For each column, picks a body strip via deterministic hash —
//      Structures.<Biome>.Cliff.Strips[stripIdx].
//   3. Stamps the strip's vertical 4-tile sequence at the column.
//   4. Emits a triplet { x, y, tileId } per stamped cell into
//      record.triplets.
//   5. OverlayTiles later iterates pContext.Cliffs[*].triplets[] and
//      writes each tileId into the rendered tile grid.
//
// What we do here:
//   v3 has already authored the IntentMap with CLIFF_BODY/CLIFF_TOP cells
//   forming a horizontal band. Walk those cells column by column, find each
//   column's [topY, bottomY] cliff range, choose strips through the shipped
//   adjacency table, and emit triplets. A movement.CROSSING punch is replaced
//   by the real cliff stair stamp; it must never remain an empty hole.
//
// The actual tile data (Structures.Ice.Cliff.Strips) and the tile-stamping
// loop (PlateauCliffs.OverlayTiles + OverlayCliffTop + OverlayFootShadow)
// are preserved unchanged — this module just bridges from IntentMap shape
// to v1 record shape.

(function(pIntent) {

    pIntent.CliffTiles = pIntent.CliffTiles || {};

    function pickStripIndex(pSeed, pX, pSalt, pStripCount) {
        // Mirror PlateauCliffs.pickIndex: deterministic per-column.
        if(MapGen.Random && MapGen.Random.HashTile) {
            return MapGen.Random.HashTile(pSeed, pX, 0, pSalt) % pStripCount;
        }
        return 0;
    }

    function stripKeysByRole(pCliff, pKeys) {
        var result = { body: [], stepUp: [], stepDown: [] };
        for(var i = 0; i < pKeys.length; ++i) {
            var entry = pCliff.Strips[pKeys[i]];
            if(entry && result[entry.role])
                result[entry.role].push(pKeys[i]);
        }
        return result;
    }

    function pickWeightedKey(pSeed, pX, pSalt, pCliff, pKeys) {
        if(!pKeys || !pKeys.length)
            return null;

        var total = 0;
        for(var i = 0; i < pKeys.length; ++i)
            total += Math.max(1, pCliff.Strips[pKeys[i]].weight | 0);

        var hash = MapGen.Random.HashTile(pSeed, pX, 0, pSalt);
        var cursor = hash % total;
        for(var k = 0; k < pKeys.length; ++k) {
            cursor -= Math.max(1, pCliff.Strips[pKeys[k]].weight | 0);
            if(cursor < 0)
                return pKeys[k];
        }
        return pKeys[pKeys.length - 1];
    }

    function requiredRole(pPrevTopY, pTopY, pNextTopY) {
        if(pPrevTopY !== null && pTopY === pPrevTopY - 1)
            return "stepUp";
        if(pNextTopY !== null && pNextTopY === pTopY + 1)
            return "stepDown";
        return "body";
    }

    function pickAdjacentRoleKey(pSeed, pX, pSeq, pCliff, pByRole,
                                 pRole, pPrevKey, pViableKeys) {
        var allowed = (pByRole[pRole] || []).slice();
        if(pPrevKey && pCliff.Adjacency && pCliff.Adjacency[pPrevKey]) {
            var adjacent = [];
            var neighbours = pCliff.Adjacency[pPrevKey];
            for(var i = 0; i < neighbours.length; ++i) {
                var key = neighbours[i];
                var entry = pCliff.Strips[key];
                if(entry && entry.role === pRole)
                    adjacent.push(key);
            }
            allowed = adjacent;
        }
        // Fail closed when the requested role cannot follow the previous
        // strip. Substituting a body tile changes neither the authored height
        // nor the validator's expected role, so it only hides the defect until
        // rendered-hard validation (and can leave visibly broken cliff art).
        if(!allowed.length)
            return null;

        if(pViableKeys !== null && typeof pViableKeys !== "undefined") {
            if(!pViableKeys.length)
                return null;
            var viableSet = {};
            for(var viableIndex = 0; viableIndex < pViableKeys.length; ++viableIndex)
                viableSet[pViableKeys[viableIndex]] = true;
            var viableAllowed = [];
            for(var allowedIndex = 0; allowedIndex < allowed.length; ++allowedIndex) {
                if(viableSet[allowed[allowedIndex]])
                    viableAllowed.push(allowed[allowedIndex]);
            }
            allowed = viableAllowed;
        }
        if(!allowed.length)
            return null;
        return pickWeightedKey(pSeed, pX, 7001 + pSeq, pCliff, allowed);
    }

    function horizontalRegionGeometry(pIntentMap, pStampHeight) {
        var regions = pIntentMap.regions || [];
        for(var i = 0; i < regions.length; ++i) {
            var region = regions[i] || {};
            if(region.kind !== "cliff" || region.axis !== "horizontal" ||
                typeof region.bandY !== "number") {
                continue;
            }
            var height = region.stampHeight || pStampHeight;
            var topY = typeof region.topRowY === "number" ?
                region.topRowY : region.bandY - height + 1;
            if(height < 1 || topY < 0 || region.bandY >= pIntentMap.height)
                continue;
            return {
                minX: 0,
                maxX: pIntentMap.width - 1,
                topY: topY,
                bottomY: topY + height - 1,
                waterClearance: region.waterClearance || 2,
                terminalLandingWidth: region.terminalLandingWidth || 0,
                terminalMaxClearance: region.terminalMaxClearance ||
                    region.waterClearance || 2
            };
        }
        return null;
    }

    function crossingStairOrigin(pIntentMap, pGeometry, pCliff, pColumnCells) {
        if(!pCliff.Stairs || !pCliff.StairsWidth ||
            !pCliff.StairsHeight) {
            return null;
        }

        var width = pCliff.StairsWidth;
        var regions = pIntentMap.regions || [];
        var candidates = [];
        for(var i = 0; i < regions.length; ++i) {
            var region = regions[i] || {};
            if(region.kind !== "crossing" || !region.at ||
                typeof region.at.x !== "number" ||
                typeof region.at.y !== "number") {
                continue;
            }
            // Strict bisecting-cliff regions store the left edge of the
            // crossing; older regions store a centre point.
            var originX = region.width === width ?
                region.at.x : region.at.x - Math.floor(width / 2);
            candidates.push(originX);
        }

        if(pIntentMap.anchors && pIntentMap.anchors.crossing) {
            var anchor = pIntentMap.anchors.crossing;
            candidates.push(anchor.x - Math.floor(width / 2));
        }

        var M = pIntent.Movement;
        var best = null;
        var bestHits = -1;
        for(var c = 0; c < candidates.length; ++c) {
            var ox = candidates[c] | 0;
            var minX = pGeometry ? pGeometry.minX : 0;
            var maxX = pGeometry ? pGeometry.maxX : pIntentMap.width - 1;
            if(ox <= minX || ox + width - 1 >= maxX)
                continue;
            var hits = 0;
            var topY = null;
            var fits = true;
            for(var dx = 0; dx < width; ++dx) {
                var column = pColumnCells[ox + dx];
                if(!column || column.maxY - column.minY + 1 < pCliff.StairsHeight) {
                    fits = false;
                    break;
                }
                if(topY === null)
                    topY = column.minY;
                else if(column.minY !== topY) {
                    fits = false;
                    break;
                }
                for(var y = column.minY; y <= column.maxY; ++y) {
                    var index = (y * pIntentMap.width) + ox + dx;
                    if(pIntentMap.movement[index] & (M.CROSSING | M.BRIDGE))
                        ++hits;
                }
            }
            if(fits && hits > bestHits) {
                bestHits = hits;
                best = { x: ox, topY: topY };
            }
        }

        // Require at least one complete crossing row. This prevents an
        // unrelated nearby route anchor from cutting stairs into the band.
        return bestHits >= width ? best : null;
    }

    // -----------------------------------------------------------------------
    // SynthesizeCliffsFromIntent
    //
    // Reads pContext.IntentMap and pContext.Profile, emits pContext.Cliffs
    // suitable for Features.PlateauCliffs.OverlayTiles. No-op if no cliff
    // cells found, or if no Structures.<Biome>.Cliff data is registered.

    pIntent.CliffTiles.SynthesizeCliffsFromIntent = function(pContext) {
        if(!pContext || !pContext.IntentMap) { return 0; }
        if(typeof Structures === "undefined" || typeof Terrain === "undefined") {
            return 0;
        }
        var im = pContext.IntentMap;
        var W = im.width;
        var H = im.height;
        var T = pIntent.Terrain;
        var M = pIntent.Movement;

        // Resolve cliff data for the active biome.
        var biomeName = null;
        if(MapGen.Terrain && MapGen.Terrain.BiomeStrategy &&
            MapGen.Terrain.BiomeStrategy.CliffBiomeName) {
            biomeName = MapGen.Terrain.BiomeStrategy.CliffBiomeName(
                pContext.Profile.TerrainType);
        }
        if(!biomeName || !Structures[biomeName] || !Structures[biomeName].Cliff) {
            return 0;
        }
        var cliff = Structures[biomeName].Cliff;
        if(!cliff.Strips) { return 0; }

        var schemaV2 = (cliff.SchemaVersion === 2);
        var stripKeys = null;
        if(schemaV2) {
            stripKeys = [];
            for(var k in cliff.Strips) {
                if(cliff.Strips.hasOwnProperty(k)) {
                    stripKeys.push(k);
                }
            }
            if(!stripKeys.length) { return 0; }
        }

        var seed = pContext.Seed | 0;
        var SALT_BODY = 7001;
        var stampHeight = cliff.StampHeight || 4;
        var geometry = horizontalRegionGeometry(im, stampHeight);
        // Collect cliff cells per column. For each column, find the
        // top-most cliff cell (topY) and bottom-most (bottomY). v1 strips
        // run top-to-bottom so topY = row of strip[0], bottomY = row of
        // strip[len-1].
        var columnCells = {}; // x -> { minY, maxY }
        for(var y = 0; y < H; ++y) {
            for(var x = 0; x < W; ++x) {
                var i = (y * W) + x;
                var t = im.terrain[i];
                if(t !== T.CLIFF_BODY && t !== T.CLIFF_TOP) { continue; }
                if(im.movement[i] & (M.CROSSING | M.BRIDGE)) { continue; }
                var entry = columnCells[x];
                if(!entry) {
                    columnCells[x] = { minY: y, maxY: y };
                } else {
                    if(y < entry.minY) { entry.minY = y; }
                    if(y > entry.maxY) { entry.maxY = y; }
                }
            }
        }

        // The authored region is the geometric contract for a strict
        // edge-to-edge cliff. Later semantic passes may legitimately replace
        // individual IntentMap cells (for example a wet apron or a crossing),
        // but that must not turn into a hole in the rendered wall.
        if(geometry) {
            for(var gx = geometry.minX; gx <= geometry.maxX; ++gx) {
                columnCells[gx] = {
                    minY: geometry.topY,
                    maxY: geometry.bottomY
                };
            }
        }

        // Irregular corner terraces publish their intended per-column tops.
        // Restore the stair-punched columns here just as the strict geometry
        // restores its full band, while retaining each column's stepped Y.
        var regions = im.regions || [];
        for(var regionIndex = 0; regionIndex < regions.length; ++regionIndex) {
            var authoredRegion = regions[regionIndex] || {};
            if(authoredRegion.kind !== "cliff" ||
                !(authoredRegion.columns instanceof Array))
                continue;
            for(var authoredIndex = 0;
                authoredIndex < authoredRegion.columns.length;
                ++authoredIndex) {
                var authoredColumn = authoredRegion.columns[authoredIndex];
                if(!authoredColumn || typeof authoredColumn.x !== "number" ||
                    typeof authoredColumn.topY !== "number")
                    continue;
                columnCells[authoredColumn.x] = {
                    minY: authoredColumn.topY,
                    maxY: authoredColumn.topY + stampHeight - 1
                };
            }
            break;
        }

        var stairOrigin = crossingStairOrigin(
            im, geometry, cliff, columnCells);

        // Walk columns in order; build triplets per column. Skip columns
        // whose cliff segment is shorter than StampHeight rows (e.g. the
        // crossing punch ate too many rows of this column — paint nothing
        // there rather than misaligning the strip).
        var record = {
            kind: "cliff_band",
            bandY: 0,
            topRowY: 0,
            stampHeight: stampHeight,
            columns: [],
            triplets: [],
            stairs: null,
            // Every synthesized ice cliff owns its lip and foot apron. This
            // is especially important for diagonal corner terraces: without
            // it, late coast smoothing can cut water/bank tiles directly
            // against individual stepped columns and suppress their shadow.
            requireDryApron: true,
            waterClearance: geometry ? geometry.waterClearance : 3,
            terminalLandingWidth: geometry ? geometry.terminalLandingWidth : 0,
            terminalMaxClearance: geometry ? geometry.terminalMaxClearance : 2
        };
        var representativeBandY = 0;
        var representativeTopRowY = 0;

        var colXs = [];
        for(var cx in columnCells) {
            if(columnCells.hasOwnProperty(cx)) { colXs.push(cx | 0); }
        }
        colXs.sort(function(a, b) { return a - b; });

        var byRole = schemaV2 ? stripKeysByRole(cliff, stripKeys) : null;
        var roleByColumnIndex = [];
        var viableByColumnIndex = [];
        function stairColumn(pX) {
            return stairOrigin !== null &&
                pX >= stairOrigin.x && pX < stairOrigin.x + cliff.StairsWidth;
        }
        if(schemaV2) {
            for(var roleIndex = 0; roleIndex < colXs.length; ++roleIndex) {
                var roleX = colXs[roleIndex];
                if(stairColumn(roleX)) {
                    roleByColumnIndex[roleIndex] = null;
                    continue;
                }
                var rolePrevTop = roleIndex > 0 &&
                    colXs[roleIndex - 1] === roleX - 1 &&
                    !stairColumn(colXs[roleIndex - 1]) ?
                    columnCells[colXs[roleIndex - 1]].minY : null;
                var roleNextTop = roleIndex + 1 < colXs.length &&
                    colXs[roleIndex + 1] === roleX + 1 &&
                    !stairColumn(colXs[roleIndex + 1]) ?
                    columnCells[colXs[roleIndex + 1]].minY : null;
                roleByColumnIndex[roleIndex] = requiredRole(
                    rolePrevTop, columnCells[roleX].minY, roleNextTop);
            }

            // Work backwards inside each contiguous body segment. A strip is
            // viable only when it has a shipped adjacency edge to at least
            // one viable strip in the following column. Stairs and gaps reset
            // the grammar walk, matching rendered-hard validation.
            for(var viableIndex = colXs.length - 1; viableIndex >= 0; --viableIndex) {
                var viableX = colXs[viableIndex];
                var viableRole = roleByColumnIndex[viableIndex];
                if(!viableRole) {
                    viableByColumnIndex[viableIndex] = [];
                    continue;
                }
                var viableKeys = (byRole[viableRole] || []).slice();
                var continues = viableIndex + 1 < colXs.length &&
                    colXs[viableIndex + 1] === viableX + 1 &&
                    roleByColumnIndex[viableIndex + 1] !== null;
                if(continues) {
                    var nextViable = viableByColumnIndex[viableIndex + 1] || [];
                    var nextSet = {};
                    for(var nextIndex = 0; nextIndex < nextViable.length; ++nextIndex)
                        nextSet[nextViable[nextIndex]] = true;
                    var compatible = [];
                    for(var viableKeyIndex = 0; viableKeyIndex < viableKeys.length; ++viableKeyIndex) {
                        var viableKey = viableKeys[viableKeyIndex];
                        var outgoing = cliff.Adjacency[viableKey] || [];
                        for(var outgoingIndex = 0; outgoingIndex < outgoing.length; ++outgoingIndex) {
                            if(nextSet[outgoing[outgoingIndex]]) {
                                compatible.push(viableKey);
                                break;
                            }
                        }
                    }
                    viableKeys = compatible;
                }
                viableByColumnIndex[viableIndex] = viableKeys;
            }
        }

        var prevKey = null;
        var prevX = null;
        for(var cIdx = 0; cIdx < colXs.length; ++cIdx) {
            var colX = colXs[cIdx];
            var range = columnCells[colX];
            var height = range.maxY - range.minY + 1;
            if(height < stampHeight) { continue; }

            var inStairs = stairOrigin !== null &&
                colX >= stairOrigin.x && colX < stairOrigin.x + cliff.StairsWidth;
            if(inStairs) {
                record.columns.push({
                    x: colX,
                    stripKey: null,
                    stripIndex: null,
                    topRowY: range.minY,
                    deltaY: 0,
                    isStairs: true,
                    triplets: []
                });
                prevKey = null;
                prevX = colX;
                continue;
            }

            if(prevX === null || colX !== prevX + 1)
                prevKey = null;

            // Pick a strip
            var stripTiles;
            if(schemaV2) {
                var prevTopY = cIdx > 0 &&
                    colXs[cIdx - 1] === colX - 1 ?
                    columnCells[colXs[cIdx - 1]].minY : null;
                var nextTopY = cIdx + 1 < colXs.length &&
                    colXs[cIdx + 1] === colX + 1 ?
                    columnCells[colXs[cIdx + 1]].minY : null;
                var role = roleByColumnIndex[cIdx] ||
                    requiredRole(prevTopY, range.minY, nextTopY);
                var key = pickAdjacentRoleKey(seed, colX, cIdx, cliff,
                    byRole, role, prevKey, viableByColumnIndex[cIdx]);
                if(!key) {
                    pContext.IntentCliffSynthesis = {
                        columns: 0,
                        triplets: 0,
                        stairs: null,
                        error: "no_legal_strip_path:" + colX + ":" + role +
                            ":prev=" + (prevKey || "none") +
                            ":viable=" +
                            (viableByColumnIndex[cIdx] || []).join(",")
                    };
                    return 0;
                }
                var stripEntry = cliff.Strips[key];
                if(!stripEntry || !stripEntry.tiles) {
                    pContext.IntentCliffSynthesis = {
                        columns: 0,
                        triplets: 0,
                        stairs: null,
                        error: "missing_strip_tiles:" + key
                    };
                    return 0;
                }
                stripTiles = stripEntry.tiles;
            } else {
                var stripIdx = pickStripIndex(seed, colX, SALT_BODY, cliff.Strips.length);
                stripTiles = cliff.Strips[stripIdx];
            }
            if(!stripTiles || !stripTiles.length) { continue; }

            // Top of the strip aligns with the top of this column's cliff
            // segment. Stamp stripTiles[0..min(stampHeight, segment-height)]
            // at rows topY..topY+stampHeight-1.
            var topY = range.minY;
            if(representativeBandY === 0) {
                representativeTopRowY = topY;
                representativeBandY = topY + stampHeight - 1;
            }
            var colTriplets = [];
            for(var r = 0; r < stripTiles.length && r < stampHeight; ++r) {
                var ty = topY + r;
                if(ty < 0 || ty >= H) { continue; }
                colTriplets.push({ x: colX, y: ty, tileId: stripTiles[r] });
            }
            record.columns.push({
                x: colX,
                stripKey: schemaV2 ? key : null,
                stripIndex: schemaV2 ? null : pickStripIndex(seed, colX, SALT_BODY, cliff.Strips.length),
                topRowY: topY,
                deltaY: schemaV2 ? (stripEntry.deltaY | 0) : 0,
                triplets: colTriplets
            });
            for(var ti = 0; ti < colTriplets.length; ++ti) {
                record.triplets.push(colTriplets[ti]);
            }
            if(schemaV2)
                prevKey = key;
            prevX = colX;
        }

        if(stairOrigin !== null) {
            var stairTriplets = [];
            var stairTopY = stairOrigin.topY;
            for(var sr = 0; sr < cliff.StairsHeight; ++sr) {
                var stairRow = cliff.Stairs[sr] || [];
                for(var sc = 0; sc < cliff.StairsWidth; ++sc) {
                    if(stairRow[sc] === undefined)
                        continue;
                    var sx = stairOrigin.x + sc;
                    var sy = stairTopY + sr;
                    var stairTriplet = { x: sx, y: sy, tileId: stairRow[sc] };
                    stairTriplets.push(stairTriplet);
                    record.triplets.push(stairTriplet);
                    if(pContext.Layers) {
                        MapGen.Layers.Set(pContext.Layers.blocked, sx, sy, 0);
                        MapGen.Layers.Set(pContext.Layers.path, sx, sy, 1);
                        MapGen.Layers.Set(pContext.Layers.keepClear, sx, sy, 1);
                        MapGen.Layers.Set(pContext.Layers.crossing, sx, sy, 1);
                    }
                }
            }
            record.stairs = {
                originX: stairOrigin.x,
                originY: stairTopY,
                width: cliff.StairsWidth,
                height: cliff.StairsHeight,
                triplets: stairTriplets
            };
        }

        if(!record.triplets.length) { return 0; }

        record.bandY = representativeBandY;
        record.topRowY = representativeTopRowY;
        record.bounds = {
            minX: colXs[0] || 0,
            maxX: colXs[colXs.length - 1] || (W - 1),
            minY: representativeTopRowY,
            maxY: representativeBandY
        };

        pContext.Cliffs = pContext.Cliffs || [];
        pContext.Cliffs.push(record);

        pContext.IntentCliffSynthesis = {
            columns: record.columns.length,
            triplets: record.triplets.length,
            stairs: record.stairs ? {
                x: record.stairs.originX,
                y: record.stairs.originY,
                width: record.stairs.width,
                height: record.stairs.height
            } : null
        };
        if(MapGen.Context && MapGen.Context.AddLog) {
            MapGen.Context.AddLog(pContext,
                "Intent cliff tiles columns=" + record.columns.length +
                " triplets=" + record.triplets.length +
                (record.stairs ? " stairs@" + record.stairs.originX +
                    "," + record.stairs.originY : " stairs=none"));
        }

        return record.triplets.length;
    };

})(MapGen.Intent);
