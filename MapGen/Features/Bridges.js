var MapGen = MapGen || {};
MapGen.Features = MapGen.Features || {};

// Bridge stamper. Walks pContext.Crossings for vertical-axis crossings (rivers
// running east-west, bridge spans north-south) and stamps a Start/Middle/End
// recipe from Structures.<Biome>.Bridge.SubVariants[subVariant].vertical so the
// bridge artwork covers the water span at the crossing column. Sets
// Layers.crossing/path to mark the footprint walkable and clears Layers.water
// so connectivity treats the cells as land.
//
// Two-phase design mirrors PlateauCliffs:
//   1. Build(pContext)         - decides where each stamp lands, updates the
//                                navigation layers, records triplets in
//                                pContext.Bridges.
//   2. OverlayTiles(pContext)  - called from Render.BuildTileLayer after
//                                smoothing; writes the bridge tile IDs into
//                                the rendered tile grid so they survive
//                                repair re-renders.
//
// First-cut limits (T0.5):
//   - Vertical-axis crossings only. No horizontal bridge variant exists in
//     Bridge.js yet; horizontal-axis crossings get logged and skipped.
//   - Jungle only. Structures.Jungle.Bridge is the only biome with bridge
//     data today.
//   - Sub-variant: whatever Structures.GetActiveSubVariant() returns (sub0
//     today). When sub-variant selection lands, sub1 picks up automatically.
MapGen.Features.Bridges = (function() {

    function biomeName(pTerrainType) {
        return MapGen.Terrain.BiomeStrategy.CliffBiomeName(pTerrainType);
    }

    function bridgeData(pContext) {
        var name = biomeName(pContext.Profile.TerrainType);
        if(!name)
            return null;
        if(!Structures[name] || !Structures[name].Bridge)
            return null;
        return Structures[name].Bridge;
    }

    function activeSubVariant(pContext) {
        // During random generation the new map header has not yet replaced
        // Map.getTileSub(), so that legacy binding can still report sub0.
        // The resolved profile is authoritative for the map being built.
        if(pContext && pContext.Profile && Number(pContext.Profile.TerrainTypeSub || 0) === 1)
            return "sub1";
        return Structures.GetActiveSubVariant ? Structures.GetActiveSubVariant() : "sub0";
    }

    function bumpReject(pContext, pReason) {
        if(!pContext.BridgeRejectStats)
            pContext.BridgeRejectStats = {};
        pContext.BridgeRejectStats[pReason] = (pContext.BridgeRejectStats[pReason] || 0) + 1;
    }

    // Read max-(col, row) offset across a triplet list. Used to derive the
    // bridge width/height from authored Start/End triplets so the stamper
    // works with both 2-wide jungle bridges and 3-wide desert bridges.
    function tripletExtent(pTriplets) {
        var maxX = -1;
        var maxY = -1;
        for(var i = 0; i < pTriplets.length; ++i) {
            if(pTriplets[i][0] > maxX) maxX = pTriplets[i][0];
            if(pTriplets[i][1] > maxY) maxY = pTriplets[i][1];
        }
        return { width: maxX + 1, height: maxY + 1 };
    }

    function rowHasWater(pContext, pX, pWidth, pY) {
        for(var i = 0; i < pWidth; ++i) {
            if(MapGen.Layers.Get(pContext.Layers.water, pX + i, pY, 0))
                return true;
        }
        return false;
    }

    // Walk the water column at columns [pX, pX+pWidth-1] starting from pSeedY
    // in both directions. Returns { top, bottom } row indices of the
    // contiguous water span containing pSeedY, or null if no water touches
    // pSeedY (allowing one row of slack — crossings are placed by row index
    // along the spine and smoothing can leave the recorded y a row outside
    // the actual stamped water).
    function findWaterSpan(pContext, pX, pSeedY, pWidth) {
        var rows = pContext.Height;

        var seed = pSeedY;
        if(!rowHasWater(pContext, pX, pWidth, seed)) {
            if(rowHasWater(pContext, pX, pWidth, seed - 1))
                seed = seed - 1;
            else if(rowHasWater(pContext, pX, pWidth, seed + 1))
                seed = seed + 1;
            else
                return null;
        }

        var top = seed;
        while(top - 1 >= 0 && rowHasWater(pContext, pX, pWidth, top - 1))
            --top;

        var bottom = seed;
        while(bottom + 1 < rows && rowHasWater(pContext, pX, pWidth, bottom + 1))
            ++bottom;

        return { top: top, bottom: bottom };
    }

    // Reject if the cell can't host a bridge tile. Bridges legitimately
    // overwrite water/riverBank, so those checks are skipped here (compare to
    // PlateauCliffs.cellBlocksStamp). keepClear is allowed too: the stream
    // crossing reservation flags its own footprint as keepClear, and the
    // bridge sits inside that footprint by design.
    function cellBlocksStamp(pContext, pX, pY) {
        var layers = pContext.Layers;

        if(!MapGen.Layers.InBounds(layers.blocked, pX, pY)) {
            bumpReject(pContext, "oob");
            return true;
        }
        if(MapGen.Layers.Get(layers.blocked, pX, pY, 0)) { bumpReject(pContext, "blocked"); return true; }
        if(MapGen.Layers.Get(layers.occupied, pX, pY, 0)) { bumpReject(pContext, "occupied"); return true; }

        return false;
    }

    function rowFitsAt(pContext, pRowTriplets, pOriginX, pOriginY) {
        for(var index = 0; index < pRowTriplets.length; ++index) {
            var triplet = pRowTriplets[index];
            if(cellBlocksStamp(pContext, pOriginX + triplet[0], pOriginY + triplet[1]))
                return false;
        }
        return true;
    }

    function commitRow(pContext, pBridge, pRowTriplets, pOriginX, pOriginY) {
        var layers = pContext.Layers;

        for(var index = 0; index < pRowTriplets.length; ++index) {
            var triplet = pRowTriplets[index];
            var tx = pOriginX + triplet[0];
            var ty = pOriginY + triplet[1];

            pBridge.triplets.push({ x: tx, y: ty, tileId: triplet[2] });
            // Bridge replaces water with walkable surface.
            MapGen.Layers.Set(layers.water, tx, ty, 0);
            MapGen.Layers.Set(layers.riverBank, tx, ty, 0);
            // crossing + path: Metrics.IsWalkable treats either as walkable.
            // Setting both keeps semantics legible for downstream tooling.
            MapGen.Layers.Set(layers.crossing, tx, ty, 1);
            MapGen.Layers.Set(layers.path, tx, ty, 1);
            // keepClear so Jungle/Decor don't paint trees onto the bridge.
            MapGen.Layers.Set(layers.keepClear, tx, ty, 1);

            if(tx < pBridge.bounds.minX) pBridge.bounds.minX = tx;
            if(tx > pBridge.bounds.maxX) pBridge.bounds.maxX = tx;
            if(ty < pBridge.bounds.minY) pBridge.bounds.minY = ty;
            if(ty > pBridge.bounds.maxY) pBridge.bounds.maxY = ty;
        }
    }

    // Protect water cells immediately flanking the bridge in every middle
    // row from being eroded by Jungle smoothing. Without this, Smoothing's
    // water rule sees the bridge '+' chars as non-water bits and treats
    // adjacent water cells as tongues, converting them to ground (which
    // renders as grass). The crossing reservation already keepClears
    // crossing.x ± halfWidth (=1), but for a 2-wide jungle bridge that
    // only reaches originX+1 — the cell at originX+width is unprotected.
    function protectBridgeFlanks(pContext, pBridge, pWidth) {
        var layers = pContext.Layers;
        var leftX = pBridge.originX - 1;
        var rightX = pBridge.originX + pWidth;

        for(var y = pBridge.waterTop; y <= pBridge.waterBottom; ++y) {
            // The bridge was fitted against water beneath its own two columns.
            // At a narrow/diagonal throat that can still leave dry cells on a
            // side after the footprint is replaced. Extend the river one cell
            // to each side so the bridge always visibly crosses a continuous
            // channel, then protect those cells from later water erosion.
            if(MapGen.Layers.InBounds(layers.water, leftX, y)) {
                MapGen.Layers.Set(layers.water, leftX, y, 1);
                MapGen.Layers.Set(layers.crossing, leftX, y, 0);
                MapGen.Layers.Set(layers.riverBank, leftX, y, 0);
                MapGen.Layers.Set(layers.keepClear, leftX, y, 1);
            }
            if(MapGen.Layers.InBounds(layers.water, rightX, y)) {
                MapGen.Layers.Set(layers.water, rightX, y, 1);
                MapGen.Layers.Set(layers.crossing, rightX, y, 0);
                MapGen.Layers.Set(layers.riverBank, rightX, y, 0);
                MapGen.Layers.Set(layers.keepClear, rightX, y, 1);
            }
        }
    }

    // Water.Build initially represents every planned river crossing as a broad
    // ford strip. Once bridge artwork wins that crossing, only the bridge's
    // actual footprint may remain a crossing tile. Leaving the old strip set
    // paints tile 20 well onto the dry approaches (the isolated blue square in
    // seed 1474480535), and RefreshDerivedLayers would otherwise recreate it
    // after a water-coverage repair.
    function clearFordCrossingStrip(pContext, pCrossing) {
        var length = Math.max(2, Math.floor(
            pCrossing.length || ((pCrossing.radius || 1) * 2)
        ));
        var halfWidth = Math.max(1, Math.floor(pCrossing.halfWidth || 1));

        for(var offset = -length; offset <= length; ++offset) {
            for(var side = -halfWidth; side <= halfWidth; ++side) {
                var x = pCrossing.x + (pCrossing.axis === "horizontal" ? offset : side);
                var y = pCrossing.y + (pCrossing.axis === "vertical" ? offset : side);
                MapGen.Layers.Set(pContext.Layers.crossing, x, y, 0);
            }
        }
    }

    function placeAtCrossing(pContext, pBridgeStruct, pCrossing) {
        if(pCrossing.axis !== "vertical") {
            bumpReject(pContext, "noHorizontalVariant");
            return null;
        }

        var subVariantName = activeSubVariant(pContext);
        var subVariants = pBridgeStruct.SubVariants || {};
        var subVariant = subVariants[subVariantName];
        if(!subVariant || !subVariant.vertical) {
            bumpReject(pContext, "noSubVariant");
            return null;
        }

        var recipe = subVariant.vertical;
        if(!recipe.Start || !recipe.End || !recipe.Middle || !recipe.Middle.length) {
            bumpReject(pContext, "incompleteRecipe");
            return null;
        }

        var width = tripletExtent(recipe.Start).width;
        var span = findWaterSpan(pContext, pCrossing.x, pCrossing.y, width);
        if(!span) {
            bumpReject(pContext, "noWater");
            return null;
        }

        var minWaterRows = Math.max(1, (pContext.Profile.BridgeMinRiverWidth || 3) - 2);
        var waterRows = span.bottom - span.top + 1;
        if(waterRows < minWaterRows) {
            bumpReject(pContext, "tooNarrow");
            return null;
        }

        var startRow = span.top - 1;
        var endRow = span.bottom + 1;

        // Build the row plan: Start, Middle×waterRows, End. Origin x is the
        // crossing column; row offsets are passed via originY so each row's
        // triplets land at the correct y.
        var plan = [];
        plan.push({ row: startRow, triplets: recipe.Start });
        for(var middleRow = span.top; middleRow <= span.bottom; ++middleRow) {
            var pickHash = MapGen.Random.HashTile(pContext.Seed, pCrossing.x, middleRow, 4711);
            var middleIndex = pickHash % recipe.Middle.length;
            plan.push({ row: middleRow, triplets: recipe.Middle[middleIndex] });
        }
        plan.push({ row: endRow, triplets: recipe.End });

        // The named river-crossing composition reserves this as its mandatory
        // route transit. Forest shaping can still leave a blocked/tree bit on
        // the dry Start/End rows even though the crossing itself is keepClear;
        // clear that stale cover before the all-or-nothing fit check.
        if(String((pContext.Profile || {}).Name || "") ===
            "grammar_jungle_river_crossing") {
            for(var prep = 0; prep < plan.length; ++prep) {
                var prepTrips = plan[prep].triplets;
                for(var pti = 0; pti < prepTrips.length; ++pti) {
                    var prepX = pCrossing.x + prepTrips[pti][0];
                    var prepY = plan[prep].row + prepTrips[pti][1];
                    MapGen.Layers.Set(pContext.Layers.blocked, prepX, prepY, 0);
                    MapGen.Layers.Set(pContext.Layers.outcrop, prepX, prepY, 0);
                    if(pContext.Layers.owner &&
                        MapGen.Layers.Get(pContext.Layers.owner,
                            prepX, prepY, 0) === MapGen.Layers.Owner.TREE) {
                        MapGen.Layers.Set(pContext.Layers.owner,
                            prepX, prepY, MapGen.Layers.Owner.OPEN);
                    }
                }
            }
        }

        // Verify every cell first; reject the whole stamp on any blocker so
        // we don't half-place a bridge.
        for(var p = 0; p < plan.length; ++p) {
            if(!rowFitsAt(pContext, plan[p].triplets, pCrossing.x, plan[p].row))
                return null;
        }

        var bridge = {
            originX: pCrossing.x,
            startRow: startRow,
            endRow: endRow,
            waterTop: span.top,
            waterBottom: span.bottom,
            axis: pCrossing.axis,
            subVariant: subVariantName,
            triplets: [],
            bounds: { minX: pContext.Width, maxX: -1, minY: pContext.Height, maxY: -1 }
        };

        clearFordCrossingStrip(pContext, pCrossing);
        for(var c = 0; c < plan.length; ++c)
            commitRow(pContext, bridge, plan[c].triplets, pCrossing.x, plan[c].row);

        protectBridgeFlanks(pContext, bridge, width);

        // Persist the selected surface and exact footprint on the crossing.
        // Terrain.RefreshDerivedLayers rebuilds the crossing layer after water
        // repairs, so Water.StampCrossingStrip needs this to restore the bridge
        // cells without restoring the obsolete full-length ford strip.
        pCrossing.surface = "bridge";
        pCrossing.bridgeBounds = {
            minX: bridge.bounds.minX,
            minY: bridge.bounds.minY,
            maxX: bridge.bounds.maxX,
            maxY: bridge.bounds.maxY
        };
        pCrossing.bridgeWaterTop = bridge.waterTop;
        pCrossing.bridgeWaterBottom = bridge.waterBottom;

        return bridge;
    }

    // Cliff-transit blocker check. Allows overwriting cliff cells (which are
    // both blocked + keepClear from PlateauCliffs) but still rejects water,
    // out-of-bounds, occupied, or path conflicts.
    function cellBlocksCliffBridge(pContext, pX, pY) {
        var layers = pContext.Layers;

        if(!MapGen.Layers.InBounds(layers.blocked, pX, pY)) {
            bumpReject(pContext, "cliffOob");
            return true;
        }
        if(MapGen.Layers.Get(layers.water, pX, pY, 0)) { bumpReject(pContext, "cliffWater"); return true; }
        if(MapGen.Layers.Get(layers.riverBank, pX, pY, 0)) { bumpReject(pContext, "cliffRiverBank"); return true; }
        if(MapGen.Layers.Get(layers.occupied, pX, pY, 0)) { bumpReject(pContext, "cliffOccupied"); return true; }

        return false;
    }

    function rowFitsCliffBridge(pContext, pRowTriplets, pOriginX, pOriginY) {
        for(var index = 0; index < pRowTriplets.length; ++index) {
            var triplet = pRowTriplets[index];
            if(cellBlocksCliffBridge(pContext, pOriginX + triplet[0], pOriginY + triplet[1]))
                return false;
        }
        return true;
    }

    function commitCliffRow(pContext, pBridge, pRowTriplets, pOriginX, pOriginY) {
        var layers = pContext.Layers;

        for(var index = 0; index < pRowTriplets.length; ++index) {
            var triplet = pRowTriplets[index];
            var tx = pOriginX + triplet[0];
            var ty = pOriginY + triplet[1];

            pBridge.triplets.push({ x: tx, y: ty, tileId: triplet[2] });
            // Cliff bridge replaces the cliff barrier with walkable surface.
            // Clearing blocked is the load-bearing change vs commitRow — cliff
            // cells are blocked + keepClear from PlateauCliffs.
            MapGen.Layers.Set(layers.blocked, tx, ty, 0);
            MapGen.Layers.Set(layers.crossing, tx, ty, 1);
            MapGen.Layers.Set(layers.path, tx, ty, 1);
            MapGen.Layers.Set(layers.keepClear, tx, ty, 1);

            if(tx < pBridge.bounds.minX) pBridge.bounds.minX = tx;
            if(tx > pBridge.bounds.maxX) pBridge.bounds.maxX = tx;
            if(ty < pBridge.bounds.minY) pBridge.bounds.minY = ty;
            if(ty > pBridge.bounds.maxY) pBridge.bounds.maxY = ty;
        }
    }

    // Pick the bridge column for a cliff-transit stamp: average of all cliff
    // stamp originX values, snapped to the playable map and clamped so the
    // bridge's full width stays in-bounds.
    function pickCliffBridgeColumn(pContext, pWidth) {
        var cliffs = pContext.Cliffs;
        if(!cliffs || !cliffs.length)
            return -1;

        var sum = 0;
        for(var i = 0; i < cliffs.length; ++i)
            sum += cliffs[i].originX;
        var avg = Math.floor(sum / cliffs.length);

        var maxX = pContext.Width - pWidth;
        if(avg < 0) avg = 0;
        if(avg > maxX) avg = maxX;
        return avg;
    }

    function placeAtCliff(pContext, pBridgeStruct) {
        if(!pContext.Cliffs || !pContext.Cliffs.length)
            return null;
        if(!pContext.Plateau || pContext.Plateau.mode !== "terrace")
            return null;

        var subVariantName = activeSubVariant(pContext);
        var subVariants = pBridgeStruct.SubVariants || {};
        var subVariant = subVariants[subVariantName];
        if(!subVariant || !subVariant.vertical) {
            bumpReject(pContext, "cliffNoSubVariant");
            return null;
        }

        var recipe = subVariant.vertical;
        if(!recipe.Start || !recipe.End || !recipe.Middle || !recipe.Middle.length) {
            bumpReject(pContext, "cliffIncompleteRecipe");
            return null;
        }

        var startExtent = tripletExtent(recipe.Start);
        var endExtent = tripletExtent(recipe.End);
        var width = startExtent.width;

        var topRowY = pContext.Plateau.topRowY;
        var bandY = pContext.Plateau.bandY;
        var middleCount = (bandY - topRowY) + 1;
        if(middleCount <= 0) {
            bumpReject(pContext, "cliffNoBand");
            return null;
        }

        var originX = pickCliffBridgeColumn(pContext, width);
        if(originX < 0) {
            bumpReject(pContext, "cliffNoColumn");
            return null;
        }

        var startRow = topRowY - startExtent.height;
        var endRow = bandY + 1;

        var plan = [];
        plan.push({ row: startRow, triplets: recipe.Start });
        for(var middleRow = topRowY; middleRow <= bandY; ++middleRow) {
            var pickHash = MapGen.Random.HashTile(pContext.Seed, originX, middleRow, 9173);
            var middleIndex = pickHash % recipe.Middle.length;
            plan.push({ row: middleRow, triplets: recipe.Middle[middleIndex] });
        }
        plan.push({ row: endRow, triplets: recipe.End });

        for(var p = 0; p < plan.length; ++p) {
            if(!rowFitsCliffBridge(pContext, plan[p].triplets, originX, plan[p].row))
                return null;
        }

        var bridge = {
            originX: originX,
            startRow: startRow,
            endRow: endRow,
            axis: "cliff",
            subVariant: subVariantName,
            triplets: [],
            bounds: { minX: pContext.Width, maxX: -1, minY: pContext.Height, maxY: -1 }
        };

        for(var c = 0; c < plan.length; ++c)
            commitCliffRow(pContext, bridge, plan[c].triplets, originX, plan[c].row);

        return bridge;
    }

    function build(pContext) {
        if(!pContext || !pContext.Profile)
            return pContext;

        var bridgeStruct = bridgeData(pContext);
        if(!bridgeStruct) {
            MapGen.Context.AddLog(pContext, "Bridge pass skipped (no bridge data for biome)");
            return pContext;
        }

        pContext.Bridges = pContext.Bridges || [];
        pContext.BridgeRejectStats = pContext.BridgeRejectStats || {};

        // Resolved profile values may arrive through the runtime settings
        // bridge as numeric strings. Treat this as a numeric knob rather than
        // silently disabling every bridge because typeof "3" !== "number".
        var minWidth = Number(pContext.Profile.BridgeMinRiverWidth);
        var crossingsAttempted = 0;
        var crossingsPlaced = 0;
        pContext.BridgeBuildDebug = {
            minWidth: minWidth,
            crossings: pContext.Crossings ? pContext.Crossings.length : -1,
            eligible: !isNaN(minWidth) && minWidth > 0 &&
                !!(pContext.Crossings && pContext.Crossings.length)
        };

        if(!isNaN(minWidth) && minWidth > 0 &&
            pContext.Crossings && pContext.Crossings.length) {
            for(var index = 0; index < pContext.Crossings.length; ++index) {
                ++crossingsAttempted;
                var bridge = placeAtCrossing(pContext, bridgeStruct, pContext.Crossings[index]);
                if(bridge) {
                    pContext.Bridges.push(bridge);
                    ++crossingsPlaced;
                }
            }
        }

        // Cliff-transit bridge — only relevant if the biome rolled a cliff
        // band that the cliff stamps actually populated. Currently used for
        // desert (jungle uses helicopter transit, ice uses in-stamp walkway).
        var cliffBridgePlaced = false;
        if(pContext.Profile.CliffBridgeTransit && pContext.Cliffs && pContext.Cliffs.length) {
            var cliffBridge = placeAtCliff(pContext, bridgeStruct);
            if(cliffBridge) {
                pContext.Bridges.push(cliffBridge);
                cliffBridgePlaced = true;
            }
        }

        MapGen.Context.AddLog(pContext, "Bridge stamps placed=" + crossingsPlaced +
            "/" + crossingsAttempted + " crossings=" + (pContext.Crossings ? pContext.Crossings.length : 0) +
            " cliffBridge=" + (cliffBridgePlaced ? "yes" : "no"));
        pContext.BridgeBuildDebug.attempted = crossingsAttempted;
        pContext.BridgeBuildDebug.placed = crossingsPlaced;

        return pContext;
    }

    // A surviving channel must extend beyond the small pocket protected by
    // the bridge itself. Search each flank locally, without crossing the deck.
    function hasChannelFlank(c, bridge, side) {
        var edgeX = side < 0 ? bridge.bounds.minX - 1 : bridge.bounds.maxX + 1;
        var queue = [], seen = {}, head = 0;
        for(var y = bridge.waterTop; y <= bridge.waterBottom; ++y)
            queue.push({x:edgeX, y:y});
        while(head < queue.length) {
            var p = queue[head++], key = p.x + "," + p.y;
            if(seen[key] || (p.x - edgeX) * side < 0 ||
                !MapGen.Layers.Get(c.Layers.water, p.x, p.y, 0))
                continue;
            seen[key] = true;
            if((p.x - edgeX) * side >= 3 || p.y <= bridge.waterTop - 3 ||
                p.y >= bridge.waterBottom + 3 || p.x === 0 || p.y === 0 ||
                p.x === c.Width - 1 || p.y === c.Height - 1)
                return true;
            queue.push({x:p.x-1,y:p.y}, {x:p.x+1,y:p.y}, {x:p.x,y:p.y-1}, {x:p.x,y:p.y+1});
        }
        return false;
    }

    function pruneShortChannels(c) {
        if(c.Profile.TerrainType !== Terrain.Types.Jungle || Number(c.Profile.TerrainTypeSub || 0))
            return 0;
        var bridges = c.Bridges || [], kept = [], removed = 0;
        for(var i = 0; i < bridges.length; ++i) {
            var b = bridges[i];
            if(typeof b.waterTop !== "number" ||
                (hasChannelFlank(c,b,-1) && hasChannelFlank(c,b,1))) {
                kept.push(b);
                continue;
            }
            // The dry deck remains traversable ground. Remove its crossing
            // record too, so derived-layer refreshes cannot recreate ford art.
            for(var t = 0; t < b.triplets.length; ++t) {
                var p = b.triplets[t];
                MapGen.Layers.Set(c.Layers.crossing,p.x,p.y,0);
            }
            c.Crossings = (c.Crossings || []).filter(function(crossing) {
                var r = crossing.bridgeBounds;
                return !r || r.minX !== b.bounds.minX || r.minY !== b.bounds.minY;
            });
            for(var side = -1; side <= 1; side += 2) {
                var x = side < 0 ? b.bounds.minX - 1 : b.bounds.maxX + 1;
                for(var y = b.waterTop; y <= b.waterBottom; ++y)
                    if(!MapGen.Layout.Reservations.At(c,x,y) &&
                        !MapGen.Layers.Get(c.Layers.path,x,y,0))
                        MapGen.Layers.Set(c.Layers.keepClear,x,y,0);
            }
            ++removed;
        }
        c.Bridges = kept;
        if(removed) MapGen.Context.AddLog(c,"Removed bridges on truncated channels: " + removed);
        return removed;
    }

    function overlayTiles(pContext, pTiles, pChars) {
        if(!pContext || !pTiles)
            return 0;
        if(!pContext.Bridges || !pContext.Bridges.length)
            return 0;

        var stamped = 0;

        for(var index = 0; index < pContext.Bridges.length; ++index) {
            var triplets = pContext.Bridges[index].triplets;
            for(var t = 0; t < triplets.length; ++t) {
                var triplet = triplets[t];
                if(MapGen.Layers.Set(pTiles, triplet.x, triplet.y, triplet.tileId)) {
                    ++stamped;
                    // Smoothing may close water over a narrow deck. Restore
                    // its walkable surface alongside the authoritative art.
                    var layers = pContext.Layers, x = triplet.x, y = triplet.y;
                    MapGen.Layers.Set(layers.water, x, y, 0);
                    MapGen.Layers.Set(layers.riverBank, x, y, 0);
                    MapGen.Layers.Set(layers.blocked, x, y, 0);
                    MapGen.Layers.Set(layers.crossing, x, y, 1);
                    MapGen.Layers.Set(layers.path, x, y, 1);
                    MapGen.Layers.Set(layers.keepClear, x, y, 1);
                    if(pChars) MapGen.Layers.Set(pChars, x, y, "+");
                }
            }
        }

        return stamped;
    }

    return {
        Build: build,
        PruneShortChannels: pruneShortChannels,
        OverlayTiles: overlayTiles
    };
})();
