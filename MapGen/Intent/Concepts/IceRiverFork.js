var MapGen = MapGen || {};
MapGen.Intent = MapGen.Intent || {};
MapGen.Intent.Concepts = MapGen.Intent.Concepts || {};

// MapGen.Intent.Concepts.IceRiverFork — Phase 3 ice river Concept.
//
// Per OpenFodder_Map_Generator_Rewrite_Design_v3.4.md §9.1:
//   "Y-shaped river, authored bridge/crossing and bank routes."
//
// Author strategy:
//   - Mark the perimeter-margined interior as walkable.
//   - Stamp a WATER trunk running vertically through the interior, with
//     two short branch arms on the EAST half forking off the trunk
//     (forming the Y-shape with the trunk as the stem and the two arms
//     branching east).
//   - Punch a CROSSING through the trunk (1-cell-wide bridge) at midY
//     so the route can cross from the spawn (west bank) to the objective
//     (east, between the arms).
//   - RIVERBANK terrain on cells adjacent to the river — Composite
//     projects to layers.riverBank=1 which the renderer paints as bank
//     transition tiles.
//   - Spawn pad on the west bank; OBJECTIVE between the two arms on the
//     east bank.
//
// appliesTo: ice_edge_patrol when mobility is water-based (swim_or_wade /
// vehicle_or_swim). Falls back to ice_compound_siege otherwise. Ships
// alongside the other ice Concepts; registry insertion order means
// ice_river_fork is checked BEFORE ice_compound_siege so the more
// specific water-mobility match wins.

(function(pIntent) {

    var T = pIntent.Terrain;
    var M = pIntent.Movement;
    var C = pIntent.Claim;
    var O = pIntent.Owner;

    var PERIMETER_MARGIN = 5;
    var SPAWN_HALO = 2;
    var TRUNK_THICKNESS = 2;
    var ARM_LENGTH_FRACTION = 0.30;

    function authorIceRiverFork(pPlan, pIntentMap, pRngs) {
        var W = pIntentMap.width;
        var H = pIntentMap.height;

        if(W < (PERIMETER_MARGIN * 2 + 16) || H < (PERIMETER_MARGIN * 2 + 8)) {
            return pIntent.AuthorResult.Fail(
                pIntent.AuthorReason.InsufficientOpenArea,
                [pIntent.AuthorResult.Diagnostic(
                    "ice_river_fork.author",
                    "IntentMap too small: " + W + "x" + H
                )]
            );
        }

        var interiorMinX = PERIMETER_MARGIN;
        var interiorMaxX = W - 1 - PERIMETER_MARGIN;
        var interiorMinY = PERIMETER_MARGIN;
        var interiorMaxY = H - 1 - PERIMETER_MARGIN;
        var midY = Math.floor((interiorMinY + interiorMaxY) / 2);

        // Trunk runs vertically through the centre of the interior; arms
        // branch east-northeast and east-southeast from the fork point.
        var rng = (pRngs && pRngs.terrain) || pRngs;
        var trunkCenterX = Math.floor((interiorMinX + interiorMaxX) / 2);
        // Small per-seed jitter so the fork doesn't land in the same column
        var jitter = rng && rng.Int ? rng.Int(-2, 2) : 0;
        trunkCenterX += jitter;
        if(trunkCenterX < interiorMinX + 8) { trunkCenterX = interiorMinX + 8; }
        if(trunkCenterX > interiorMaxX - 8) { trunkCenterX = interiorMaxX - 8; }
        var trunkLeftX = trunkCenterX;
        var trunkRightX = trunkCenterX + TRUNK_THICKNESS - 1;

        // 1. Mark interior walkable. Blanket RESERVED would project to
        // keepClear and suppress every materialized cover patch.
        for(var iy = interiorMinY; iy <= interiorMaxY; ++iy) {
            for(var ix = interiorMinX; ix <= interiorMaxX; ++ix) {
                pIntent.Map.AddMovement(pIntentMap, ix, iy, M.WALKABLE);
            }
        }

        // 2. Trunk: vertical river from top map edge to bottom map edge.
        var trunkCells = 0;
        for(var ty = 0; ty < H; ++ty) {
            for(var tdx = 0; tdx < TRUNK_THICKNESS; ++tdx) {
                var tx = trunkCenterX + tdx;
                pIntent.Map.SetTerrain(pIntentMap, tx, ty, T.WATER);
                pIntent.Map.AddMovement(pIntentMap, tx, ty, M.BLOCKED);
                pIntent.Map.ClearMovement(pIntentMap, tx, ty, M.WALKABLE);
                ++trunkCells;
            }
        }

        // 3. Arms: branch east-northeast and east-southeast from midY.
        // Each arm is a short 1-cell-thick water strip at ±2 cells from midY.
        var armLength = Math.floor((interiorMaxX - trunkRightX) * ARM_LENGTH_FRACTION) + 4;
        var northArmY = midY - 4;
        var southArmY = midY + 4;
        var armCells = 0;
        for(var ax = trunkRightX + 1; ax < trunkRightX + 1 + armLength; ++ax) {
            if(ax > interiorMaxX) { break; }
            // Stagger arm: stays at northArmY for first half, then bends
            // back toward midY/southArmY for the second half (Y-shape).
            var northY = (ax < trunkRightX + 1 + armLength / 2) ? northArmY : northArmY + 1;
            var southY = (ax < trunkRightX + 1 + armLength / 2) ? southArmY : southArmY - 1;
            pIntent.Map.SetTerrain(pIntentMap, ax, northY, T.WATER);
            pIntent.Map.AddMovement(pIntentMap, ax, northY, M.BLOCKED);
            pIntent.Map.ClearMovement(pIntentMap, ax, northY, M.WALKABLE);
            pIntent.Map.SetTerrain(pIntentMap, ax, southY, T.WATER);
            pIntent.Map.AddMovement(pIntentMap, ax, southY, M.BLOCKED);
            pIntent.Map.ClearMovement(pIntentMap, ax, southY, M.WALKABLE);
            armCells += 2;
        }

        // 4. Riverbank stamping: cells immediately east-of-trunk-left and
        //    west-of-trunk-right that aren't water themselves get RIVERBANK.
        function stampBankIfDry(bx, by) {
            if(bx < 0 || bx >= W || by < 0 || by >= H) { return; }
            if(pIntentMap.terrain[(by * W) + bx] === T.WATER) { return; }
            pIntent.Map.SetTerrain(pIntentMap, bx, by, T.RIVERBANK);
        }
        for(var by = 0; by < H; ++by) {
            stampBankIfDry(trunkCenterX - 1, by);          // west bank
            stampBankIfDry(trunkRightX + 1, by);            // east bank (between trunk + arms)
        }

        // 5. Crossing: punch a 1-cell bridge through the trunk at midY.
        //    Renderer projects movement.CROSSING + movement.BRIDGE → causeway
        //    + crossing layers, which the smoothing pass paints as a bridge
        //    transit tile.
        for(var bdx = 0; bdx < TRUNK_THICKNESS; ++bdx) {
            var bx = trunkCenterX + bdx;
            pIntent.Map.SetTerrain(pIntentMap, bx, midY, T.LAND);
            pIntent.Map.ClearMovement(pIntentMap, bx, midY, M.BLOCKED);
            pIntent.Map.AddMovement(pIntentMap, bx, midY,
                M.WALKABLE | M.ROUTE_PRIMARY | M.CROSSING | M.BRIDGE | M.KEEP_CLEAR);
            pIntent.Map.SetOwner(pIntentMap, bx, midY, O.OPEN);
        }

        // 6. Bank routes: spawn → bridge on west bank, bridge → objective
        //    on east bank (between the two arms).
        var startX = interiorMinX + SPAWN_HALO;
        var routeCells = 0;
        for(var rxL = startX; rxL < trunkCenterX; ++rxL) {
            for(var dy = -1; dy <= 1; ++dy) {
                var ry = midY + dy;
                if(ry < interiorMinY || ry > interiorMaxY) { continue; }
                pIntent.Map.AddMovement(pIntentMap, rxL, ry,
                    M.ROUTE_PRIMARY | M.WALKABLE | M.KEEP_CLEAR);
                ++routeCells;
            }
        }
        var endX = interiorMaxX - SPAWN_HALO;
        for(var rxR = trunkRightX + 1; rxR <= endX; ++rxR) {
            for(var dy2 = -1; dy2 <= 1; ++dy2) {
                var ry2 = midY + dy2;
                if(ry2 < interiorMinY || ry2 > interiorMaxY) { continue; }
                // Don't stamp ROUTE on water arm cells.
                if(pIntentMap.terrain[(ry2 * W) + rxR] === T.WATER) { continue; }
                pIntent.Map.AddMovement(pIntentMap, rxR, ry2,
                    M.ROUTE_PRIMARY | M.WALKABLE | M.KEEP_CLEAR);
                ++routeCells;
            }
        }

        // 7. Spawn + objective. Spawn west of trunk (clean LAND); objective
        //    between the two arms on the east bank — with a halo to clear
        //    any water/bank cells inside the spawn pad.
        function stampAnchor(cx, cy, ownerVal, anchorClaim) {
            for(var dx = -SPAWN_HALO; dx <= SPAWN_HALO; ++dx) {
                for(var dy = -SPAWN_HALO; dy <= SPAWN_HALO; ++dy) {
                    var ax = cx + dx;
                    var ay = cy + dy;
                    pIntent.Map.SetTerrain(pIntentMap, ax, ay, T.LAND);
                    pIntent.Map.ClearMovement(pIntentMap, ax, ay, M.BLOCKED);
                    pIntent.Map.AddClaim(pIntentMap, ax, ay, C.SPAWN_SAFE);
                    pIntent.Map.AddMovement(pIntentMap, ax, ay,
                        M.WALKABLE | M.KEEP_CLEAR);
                    pIntent.Map.SetOwner(pIntentMap, ax, ay, O.OPEN);
                }
            }
            pIntent.Map.AddClaim(pIntentMap, cx, cy, anchorClaim);
            pIntent.Map.SetOwner(pIntentMap, cx, cy, ownerVal);
        }
        stampAnchor(startX, midY, O.PLAYER_SPAWN, C.SPAWN_SAFE);
        // Phase 3 P3.8: drop OBJECTIVE claim — see IceForestCorridor note.
        stampAnchor(endX,   midY, O.STRUCTURE,   C.SPAWN_SAFE);

        pIntentMap.regions = pIntentMap.regions || [];
        pIntentMap.regions.push({
            id: "river_fork.trunk",
            kind: "river", axis: "vertical", cells: trunkCells,
            edgeAnchored: ["top","bottom"]
        });
        pIntentMap.regions.push({
            id: "river_fork.arms",
            kind: "river_arms", cells: armCells
        });
        pIntentMap.regions.push({
            id: "river_fork.bridge",
            kind: "crossing", at: { x: trunkCenterX, y: midY },
            cells: TRUNK_THICKNESS
        });
        pIntentMap.regions.push({
            id: "river_fork.approach_route",
            kind: "route", cells: routeCells
        });

        pIntentMap.anchors = pIntentMap.anchors || {};
        pIntentMap.anchors.start     = { x: startX, y: midY };
        pIntentMap.anchors.objective = { x: endX,   y: midY };
        pIntentMap.anchors.crossing  = { x: trunkCenterX, y: midY };

        return pIntent.AuthorResult.Ok([
            pIntent.AuthorResult.Diagnostic(
                "ice_river_fork.author",
                "trunk=" + trunkCells + " arms=" + armCells +
                " bridge@(" + trunkCenterX + "," + midY + ") " +
                "route=" + routeCells
            )
        ]);
    }

    if(pIntent.RegisterConcept) {
        pIntent.RegisterConcept({
            id: "ice_river_fork",
            biome: "ice",
            appliesTo: function(pProfile, pDimensions, pPlan) {
                if(!pProfile) { return false; }
                if(pProfile.TerrainType !== undefined && (typeof Terrain !== "undefined")) {
                    if(pProfile.TerrainType !== Terrain.Types.Ice) { return false; }
                }
                if(!pPlan || !pPlan.intent) { return false; }
                var style = String(
                    pPlan.intent.iceLayoutStyle ||
                    (pPlan.intent.guardrails ? pPlan.intent.guardrails.iceLayoutStyle : "") ||
                    ""
                );
                var mobility = String(pPlan.intent.mobilityMode || "");
                // Catches ice_edge_patrol when mobility is water-based
                // (swim_or_wade or vehicle_or_swim per Grammar/Intent.js
                // mobility weights). Also catches an explicit ice_river_fork
                // style if Phase 4+ Grammar dispatch adds one.
                if(style === "ice_river_fork") { return true; }
                if(style === "ice_edge_patrol" &&
                    (mobility === "swim_or_wade" ||
                     mobility === "vehicle_or_swim")) {
                    return true;
                }
                return false;
            },
            author: authorIceRiverFork,
            intentHardValidators: [
                {
                    id: "river_trunk_edge_to_edge",
                    fn: function(pContext, pIntentMap) {
                        // The trunk runs through the full vertical extent of
                        // the map. Verify both top and bottom rows have at
                        // least one WATER cell.
                        var Tlocal = pIntent.Terrain;
                        var Wm = pIntentMap.width;
                        var Hm = pIntentMap.height;
                        var topHas = false, botHas = false;
                        for(var x = 0; x < Wm; ++x) {
                            if(pIntentMap.terrain[x] === Tlocal.WATER) { topHas = true; }
                            var bi = ((Hm - 1) * Wm) + x;
                            if(pIntentMap.terrain[bi] === Tlocal.WATER) { botHas = true; }
                        }
                        if(!topHas || !botHas) {
                            return { ok: false,
                                reason: "intent_hard:river_trunk_not_edge_to_edge:top=" +
                                    topHas + ":bot=" + botHas };
                        }
                        return { ok: true };
                    }
                }
            ],
            intentQualityValidators: [],
            renderedHardValidators: [],
            driftBudget: {
                landIntentSolidMaxFraction: 0.18
            },
            finaliseConcept: function(pContext, pIntentMap, pRenderedMap) { return 0; }
        });
    }

    pIntent.Concepts.IceRiverFork = {
        author: authorIceRiverFork
    };

})(MapGen.Intent);
