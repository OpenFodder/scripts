var MapGen = MapGen || {};
MapGen.Intent = MapGen.Intent || {};
MapGen.Intent.Concepts = MapGen.Intent.Concepts || {};

// MapGen.Intent.Concepts.IceBisectingCliff — primary ice Concept (Phase 2 P2.3).
//
// Per OpenFodder_Map_Generator_Rewrite_Design_v3.4.md §9.1, after the v3.4
// W3 amendment 1, the original `ice_bisecting_cliff` is split into:
//   - `ice_bisecting_cliff_strict`  : opposite-edge anchored, full bisection
//   - `ice_bisecting_cliff_terrace` : corner-anchored terrace bands
// This file ships the _strict variant; _terrace lands in Phase 3 alongside
// the corner-anchor calibration data.
//
// Binding constraint (from [[mapgen_cliff_edge_to_edge]] + [[mapgen_cliff_terminus_art]]):
//   "Cliffs must extend from one map edge to another edge."
//   Shipped distribution: 0% interior cliff clusters; 87.5% touch 2 edges;
//   12.5% touch 3 edges.
//
// Author strategy:
//   - Choose an axis (vertical|horizontal) and a band X/Y.
//   - Keep interior LAND on both sides of the band with safe perimeter
//     margin (same SPAWN_HALO logic as ice_open_arena).
//   - Stamp CLIFF_BODY along the bisecting band, terminating cleanly at
//     both perimeter edges (TerminalEdgeArt — left for Phase 3 cliff art).
//   - Place SPAWN on one side, OBJECTIVE on the other, with a single
//     CROSSING cell on the route midline so the path crosses the cliff.
//   - The cliff becomes a route obstacle; the v1 cliff transit (helicopter,
//     skidoo, walkway) is Phase 5 work — Phase 2 treats the crossing cell
//     as a movement-plane gap and lets the engine's terrain feature decide
//     walkability post-render. Per v3.4 §11 Phase 2 acceptance the
//     player+objective+route gate is the only criterion; cliff transit
//     fidelity is Phase 3.

(function(pIntent) {

    var T = pIntent.Terrain;
    var M = pIntent.Movement;
    var C = pIntent.Claim;
    var O = pIntent.Owner;

    var PERIMETER_MARGIN = 5;
    var SPAWN_HALO = 2;
    var OBJECTIVE_STRUCTURE_HALO = 7;
    // Phase 5 P5.1: cliff thickness matches v1 StampHeight (4 rows for ice).
    // Was 2 (vertical bisecting); now 4 to align with shipped Structures.Ice.Cliff
    // strip data. The cliff is HORIZONTAL — 4 rows × full map width.
    var CLIFF_THICKNESS = 4;
    // The ice cliff atlas owns two rows outside the four-row face: a plain-
    // snow lip above it and up to two rows of foot-shadow below it. Keeping
    // both rows dry also matches the shipped-map no-water-overlap rule and
    // prevents coastline smoothing from drawing individual snow fingers into
    // the body where an edge-anchored cliff meets the sea.
    var CLIFF_WATER_CLEARANCE = 2;
    var CLIFF_TERMINAL_LANDING_WIDTH = 10;
    var CLIFF_TERMINAL_MAX_CLEARANCE = 10;
    // Shipped ice cliffs meet a perpendicular map edge with a clipped face,
    // normally four or five cells wide. The diagonal continues off-map so
    // its final visible columns taper from a full strip down to one row.
    var CLIFF_EDGE_EXIT_WIDTH = 4;

    function cliffClearanceAtX(pX, pWidth) {
        var edgeDistance = Math.min(pX, pWidth - 1 - pX);
        if(edgeDistance >= CLIFF_TERMINAL_LANDING_WIDTH)
            return CLIFF_WATER_CLEARANCE;

        var extraMax = CLIFF_TERMINAL_MAX_CLEARANCE -
            CLIFF_WATER_CLEARANCE;
        var extra = Math.floor(
            (CLIFF_TERMINAL_LANDING_WIDTH - edgeDistance) * extraMax /
            CLIFF_TERMINAL_LANDING_WIDTH);
        return CLIFF_WATER_CLEARANCE + extra;
    }

    function stampCliffDryApron(pIntentMap, pTopY, pBottomY) {
        var W = pIntentMap.width;
        var H = pIntentMap.height;
        var stamped = 0;

        for(var x = 0; x < W; ++x) {
            var clearance = cliffClearanceAtX(x, W);
            for(var side = -1; side <= 1; side += 2) {
                for(var distance = 1; distance <= clearance; ++distance) {
                    var y = side < 0 ? pTopY - distance : pBottomY + distance;
                    if(y < 0 || y >= H) { continue; }
                    pIntent.Map.SetTerrain(pIntentMap, x, y, T.LAND);
                    pIntent.Map.ClearMovement(pIntentMap, x, y, M.BLOCKED);
                    pIntent.Map.AddMovement(pIntentMap, x, y,
                        M.WALKABLE | M.KEEP_CLEAR);
                    pIntent.Map.SetOwner(pIntentMap, x, y, O.OPEN);
                    ++stamped;
                }
            }
        }
        return stamped;
    }

    // A skidoo-jump profile needs actual HIT feature-14 ramp art, not merely a
    // walkable stairs punch through a cliff. These are the two 2x2 motifs used
    // by the shipped ice maps for north/south approaches.
    function finaliseSkidooJumpRamps(pContext, pIntentMap, pRenderedMap) {
        var profile = pContext ? pContext.Profile || {} : {};
        if(String(profile.ForcedMobilityMode || "") !== "skidoo_jump")
            return 0;
        if(!pRenderedMap || !pRenderedMap.Tiles)
            return 0;

        var regions = pIntentMap.regions || [];
        var cliffRegion = null;
        for(var i = 0; i < regions.length; ++i) {
            if(regions[i] && regions[i].kind === "cliff" &&
                regions[i].axis === "horizontal") {
                cliffRegion = regions[i];
                break;
            }
        }
        var crossing = pIntentMap.anchors && pIntentMap.anchors.crossing;
        if(!cliffRegion || !crossing)
            return 0;

        var originX = Math.max(1, Math.min(pIntentMap.width - 3,
            crossing.x - 1));
        var northY = Math.max(1, cliffRegion.topRowY - 4);
        var southY = Math.min(pIntentMap.height - 3, cliffRegion.bandY + 3);
        var motifs = [
            { x: originX, y: northY, tiles: [[35, 36], [55, 56]] },
            { x: originX, y: southY, tiles: [[74, 75], [76, 77]] }
        ];
        var changed = 0;
        var stamped = [];
        for(var m = 0; m < motifs.length; ++m) {
            var motif = motifs[m];
            for(var my = 0; my < 2; ++my) {
                for(var mx = 0; mx < 2; ++mx) {
                    var tileId = motif.tiles[my][mx];
                    MapGen.Layers.Set(pRenderedMap.Tiles,
                        motif.x + mx, motif.y + my, tileId);
                    stamped.push({
                        x: motif.x + mx,
                        y: motif.y + my,
                        tileId: tileId
                    });
                    ++changed;
                }
            }
        }
        pContext.IntentJumpRamps = {
            count: motifs.length,
            cells: stamped
        };
        return changed;
    }

    function validateSkidooJumpRamps(pContext, pIntentMap, pRenderedMap) {
        var profile = pContext ? pContext.Profile || {} : {};
        if(String(profile.ForcedMobilityMode || "") !== "skidoo_jump")
            return { ok: true };
        var ramps = pContext.IntentJumpRamps;
        if(!ramps || ramps.count < 2 || !ramps.cells || ramps.cells.length < 8)
            return { ok: false, reason: "rendered_hard:skidoo_jump_ramps_missing" };
        for(var i = 0; i < ramps.cells.length; ++i) {
            var cell = ramps.cells[i];
            var actual = MapGen.Layers.Get(
                pRenderedMap.Tiles, cell.x, cell.y, -1) & 0x1FF;
            if(actual !== cell.tileId) {
                return {
                    ok: false,
                    reason: "rendered_hard:skidoo_jump_ramp_mismatch:" +
                        cell.x + "," + cell.y + ":" + actual + "!=" +
                        cell.tileId
                };
            }
        }
        return { ok: true, ramps: ramps.count };
    }

    function authorIceBisectingCliffStrict(pPlan, pIntentMap, pRngs, pContext) {
        var W = pIntentMap.width;
        var H = pIntentMap.height;
        var profile = pContext ? pContext.Profile || {} : {};

        if(W < (PERIMETER_MARGIN * 2 + CLIFF_THICKNESS + 12) ||
           H < (PERIMETER_MARGIN * 2 + 6)) {
            return pIntent.AuthorResult.Fail(
                pIntent.AuthorReason.InsufficientOpenArea,
                [pIntent.AuthorResult.Diagnostic(
                    "ice_bisecting_cliff.author",
                    "IntentMap too small: " + W + "x" + H
                )]
            );
        }

        var interiorMinX = PERIMETER_MARGIN;
        var interiorMaxX = W - 1 - PERIMETER_MARGIN;
        var interiorMinY = PERIMETER_MARGIN;
        var interiorMaxY = H - 1 - PERIMETER_MARGIN;
        var midY = Math.floor((interiorMinY + interiorMaxY) / 2);

        // Phase 5 P5.1: HORIZONTAL bisecting cliff. Aligns with shipped
        // ice cliff art (Structures.Ice.Cliff: 4-row strips placed per
        // column, terrace runs east-west across map). The cliff bisects
        // the map north-south; spawn lives north of cliff, objective south,
        // route runs north→south through a stairs punch in the cliff band.
        var rng = (pRngs && pRngs.terrain) || pRngs;
        var V0 = pIntent.Variety;

        // P3f.5 continent shape: prefer a dry mainland, with an occasional
        // high-land rectangle for shoreline variety. Island/edge would carve
        // through the full-width cliff contract.
        if(V0 && V0.StampContinent) {
            var strictContinentStyle = rng && rng.Chance && rng.Chance(0.68) ?
                "mainland" : "rectangle";
            V0.StampContinent(pIntentMap,
                V0.ContinentOptionForStyle(
                    profile, strictContinentStyle,
                    strictContinentStyle === "mainland" ? 1.0 : 0.94), rng);
        }

        // Deliberately mix top-edge, middle and bottom-edge terraces. The old
        // ±3-only jitter made every checkpoint the same central horizontal
        // divider even when the surrounding terrain changed.
        var placementRoll = rng && rng.Int ? rng.Int(0, 99) : 50;
        var placementStyle = placementRoll < 34 ? "upper_edge" :
            (placementRoll < 68 ? "lower_edge" : "middle");
        var targetBandY = placementStyle === "upper_edge" ?
            Math.floor(H * 0.27) :
            (placementStyle === "lower_edge" ?
                Math.floor(H * 0.73) : midY);
        var bandJitter = rng && rng.Int ? rng.Int(-2, 2) : 0;
        var bandY = targetBandY + bandJitter;
        // Cliff band rows: bandY-(CLIFF_THICKNESS-1) .. bandY (4 rows).
        var topRowY = bandY - (CLIFF_THICKNESS - 1);
        if(topRowY < interiorMinY + 2) {
            bandY += (interiorMinY + 2 - topRowY);
            topRowY = interiorMinY + 2;
        }
        if(bandY > interiorMaxY - 4) {
            bandY = interiorMaxY - 4;
            topRowY = bandY - (CLIFF_THICKNESS - 1);
        }

        // 1. Mark interior walkable. A blanket RESERVED claim becomes
        // keepClear in Composite and incorrectly suppresses all cover on
        // both sides of the cliff.
        for(var y = interiorMinY; y <= interiorMaxY; ++y) {
            for(var x = interiorMinX; x <= interiorMaxX; ++x) {
                pIntent.Map.AddMovement(pIntentMap, x, y, M.WALKABLE);
            }
        }

        // 2. Cliff stamp. LEFT edge -> RIGHT edge (full map width), 4 rows
        //    tall starting at topRowY. CLIFF_BODY on bandY (bottom row),
        //    CLIFF_TOP on the 3 rows above. Per shipped ice cliff data
        //    (Structures.Ice.Cliff) the renderer's PlateauCliffs.OverlayTiles
        //    will paint per-column 4-tile strips when pContext.Cliffs is
        //    populated (Pipeline.SynthesizeCliffsFromIntent post-author).
        var cliffStamped = 0;
        for(var cx = 0; cx < W; ++cx) {
            for(var rIdx = 0; rIdx < CLIFF_THICKNESS; ++rIdx) {
                var cy = topRowY + rIdx;
                if(cy < 0 || cy >= H) { continue; }
                // Bottom row = CLIFF_BODY (the actual wall face); rows above
                // = CLIFF_TOP (the plateau lip).
                var isBottomRow = (rIdx === CLIFF_THICKNESS - 1);
                pIntent.Map.SetTerrain(pIntentMap, cx, cy,
                    isBottomRow ? T.CLIFF_BODY : T.CLIFF_TOP);
                pIntent.Map.AddMovement(pIntentMap, cx, cy, M.BLOCKED);
                pIntent.Map.ClearMovement(pIntentMap, cx, cy, M.WALKABLE);
                pIntent.Map.SetOwner(pIntentMap, cx, cy, O.CLIFF);
                ++cliffStamped;
            }
        }

        // 3. Crossing — punch a 3-cell-wide stairs through the cliff band
        //    so the v3 route can pass north→south. Crossing X jitters
        //    per-seed (within the middle 60% of the map width).
        var crossWidth = 3;
        var crossXMin = Math.max(interiorMinX + 4,
            Math.floor(W * 0.20));
        var crossXMax = Math.min(interiorMaxX - 4 - crossWidth,
            Math.floor(W * 0.80) - crossWidth);
        var crossX = rng && rng.Int ?
            rng.Int(crossXMin, crossXMax) :
            Math.floor((crossXMin + crossXMax) / 2);
        for(var dxr = 0; dxr < crossWidth; ++dxr) {
            for(var rIdx2 = 0; rIdx2 < CLIFF_THICKNESS; ++rIdx2) {
                var cry = topRowY + rIdx2;
                var crx = crossX + dxr;
                if(crx < 0 || crx >= W || cry < 0 || cry >= H) { continue; }
                pIntent.Map.SetTerrain(pIntentMap, crx, cry, T.LAND);
                pIntent.Map.ClearMovement(pIntentMap, crx, cry, M.BLOCKED);
                pIntent.Map.AddMovement(pIntentMap, crx, cry,
                    M.WALKABLE | M.ROUTE_PRIMARY | M.CROSSING | M.KEEP_CLEAR);
                pIntent.Map.SetOwner(pIntentMap, crx, cry, O.OPEN);
            }
        }

        // 4. Route stamp: spawn (north) → crossing → objective (south).
        //    3-cell-wide route band running through the crossing.
        var routeStamped = 0;
        var routeCenterX = crossX + Math.floor(crossWidth / 2);
        // North leg: spawn -> crossing
        for(var ryN = interiorMinY; ryN < topRowY; ++ryN) {
            for(var dxN = -1; dxN <= 1; ++dxN) {
                var rxN = routeCenterX + dxN;
                if(rxN < interiorMinX || rxN > interiorMaxX) { continue; }
                pIntent.Map.SetTerrain(pIntentMap, rxN, ryN, T.LAND);
                pIntent.Map.ClearMovement(pIntentMap, rxN, ryN, M.BLOCKED);
                pIntent.Map.AddMovement(pIntentMap, rxN, ryN,
                    M.ROUTE_PRIMARY | M.WALKABLE | M.KEEP_CLEAR);
                pIntent.Map.SetOwner(pIntentMap, rxN, ryN, O.OPEN);
                ++routeStamped;
            }
        }
        // South leg: crossing -> objective
        for(var ryS = bandY + 1; ryS <= interiorMaxY; ++ryS) {
            for(var dxS = -1; dxS <= 1; ++dxS) {
                var rxS = routeCenterX + dxS;
                if(rxS < interiorMinX || rxS > interiorMaxX) { continue; }
                pIntent.Map.SetTerrain(pIntentMap, rxS, ryS, T.LAND);
                pIntent.Map.ClearMovement(pIntentMap, rxS, ryS, M.BLOCKED);
                pIntent.Map.AddMovement(pIntentMap, rxS, ryS,
                    M.ROUTE_PRIMARY | M.WALKABLE | M.KEEP_CLEAR);
                pIntent.Map.SetOwner(pIntentMap, rxS, ryS, O.OPEN);
                ++routeStamped;
            }
        }
        if(routeStamped < 4) {
            return pIntent.AuthorResult.Fail(
                pIntent.AuthorReason.NoValidTransit,
                [pIntent.AuthorResult.Diagnostic(
                    "ice_bisecting_cliff.author",
                    "route stamp produced only " + routeStamped + " cells"
                )]
            );
        }

        // 5. Spawn pads with halo. Spawn north of cliff, objective south.
        function stampAnchor(cx, cy, ownerVal, anchorClaim, halo) {
            var anchorHalo = halo === undefined ? SPAWN_HALO : halo;
            for(var dx = -anchorHalo; dx <= anchorHalo; ++dx) {
                for(var dy = -anchorHalo; dy <= anchorHalo; ++dy) {
                    var ax = cx + dx;
                    var ay = cy + dy;
                    pIntent.Map.SetTerrain(pIntentMap, ax, ay, T.LAND);
                    pIntent.Map.ClearMovement(pIntentMap, ax, ay, M.BLOCKED);
                    pIntent.Map.AddClaim(pIntentMap, ax, ay, C.SPAWN_SAFE);
                    if(ownerVal === O.STRUCTURE)
                        pIntent.Map.AddClaim(pIntentMap, ax, ay, C.STRUCT_FLOOR);
                    pIntent.Map.AddMovement(pIntentMap, ax, ay,
                        M.WALKABLE | M.KEEP_CLEAR);
                    pIntent.Map.SetOwner(pIntentMap, ax, ay, O.OPEN);
                }
            }
            pIntent.Map.AddClaim(pIntentMap, cx, cy, anchorClaim);
            pIntent.Map.SetOwner(pIntentMap, cx, cy, ownerVal);
        }
        var startX = routeCenterX;
        var startY = placementStyle === "lower_edge" ?
            interiorMaxY - SPAWN_HALO : interiorMinY + SPAWN_HALO;
        var endX = routeCenterX;
        // Keep the objective arena far enough from the southern water edge
        // for its dry centre to survive the renderer's wet-ice proximity
        // apron. A spawn-sized offset leaves the whole building footprint
        // classified as wet even after authoring a larger land pad.
        var endY = placementStyle === "lower_edge" ?
            interiorMinY + OBJECTIVE_STRUCTURE_HALO :
            interiorMaxY - OBJECTIVE_STRUCTURE_HALO;
        stampAnchor(startX, startY, O.PLAYER_SPAWN, C.SPAWN_SAFE, SPAWN_HALO);
        // Phase 3 P3.8: drop OBJECTIVE claim — see IceForestCorridor note.
        // A 7-cell radius leaves a dry core for the 4x3 barracks footprint,
        // its live-placement clearance and an access apron. The old 5x5 pad
        // left every candidate inside the surrounding wet-ice field.
        stampAnchor(endX, endY, O.STRUCTURE, C.SPAWN_SAFE,
            OBJECTIVE_STRUCTURE_HALO);

        // 5.5 P4.3 variety: forest cover + outcrops on each side of the
        // (now-horizontal) cliff. This used a hard-coded 0.45-0.70 density,
        // ignoring low-cover cliff/skidoo profiles whose visible ceiling can
        // be 0.28. Derive the authoring density from the resolved profile so
        // the concept cannot be accepted and then fail at final commit.
        var V = pIntent.Variety;
        var decorRng = (pRngs && pRngs.decor) || pRngs;
        var requestedCover = Number(profile.TreeCoverage);
        if(!isFinite(requestedCover)) requestedCover = 0.42;
        var maximumCover = Number(profile.MaxTreeCoverage);
        if(!isFinite(maximumCover)) maximumCover = 0.68;
        var coverLow = Math.max(0.06,
            Math.min(maximumCover * 0.72, requestedCover * 0.72));
        var coverHigh = Math.max(coverLow,
            Math.min(maximumCover * 0.88, requestedCover * 1.08));
        // Skidoo gets a modestly fuller authored band because cliff, route,
        // and anchor reservations reduce the cover that reaches structures.
        if(profile.ForcedMobilityMode === "skidoo_jump") {
            coverLow = Math.max(coverLow,
                Math.min(maximumCover * 0.82, requestedCover * 0.95));
            coverHigh = Math.max(coverLow,
                Math.min(maximumCover * 0.96, requestedCover * 1.45));
        }
        var coverDensity = V ?
            V.PerSeedRange(decorRng, coverLow, coverHigh) :
            (coverLow + coverHigh) * 0.5;
        // The renderer keeps supported tree components and prunes isolated
        // cells. Use the CA+dilation helper for skidoo so its authored cover
        // arrives as connected masses; other cliff styles retain scatter.
        if(profile.ForcedMobilityMode === "skidoo_jump" && V &&
           V.StampForestCellularAutomata) {
            var xlSkidoo = (W * H) >= 10000;
            // XL maps use one pass with a denser initial field to preserve
            // large, low-frequency components. The runtime cover budget still
            // enforces the profile's MaxTreeCoverage cap.
            var skidooSeedDensity = xlSkidoo ?
                Math.min(0.56, Math.max(coverDensity, maximumCover * 2.0)) :
                coverDensity;
            V.StampForestCellularAutomata(pIntentMap, {
                minX: interiorMinX, maxX: interiorMaxX,
                minY: interiorMinY, maxY: interiorMaxY
            }, {
                iterations: xlSkidoo ? 1 : 3,
                seedDensity: skidooSeedDensity,
                skipPredicate: function(fx, fy) {
                    return fx >= routeCenterX - 2 && fx <= routeCenterX + 2;
                }
            }, decorRng);
        } else {
            for(var fy = interiorMinY; fy <= interiorMaxY; ++fy) {
                for(var fx = interiorMinX; fx <= interiorMaxX; ++fx) {
                    var idx = (fy * W) + fx;
                    if(pIntentMap.terrain[idx] === T.CLIFF_BODY ||
                       pIntentMap.terrain[idx] === T.CLIFF_TOP) { continue; }
                    if(pIntentMap.movement[idx] & (M.ROUTE_PRIMARY | M.ROUTE_SECONDARY |
                                                    M.CROSSING | M.BRIDGE)) { continue; }
                    if(pIntentMap.claim[idx] & (C.SPAWN_SAFE | C.OBJECTIVE)) { continue; }
                    // Skip cells along the route band (routeCenterX ± 2)
                    if(fx >= routeCenterX - 2 && fx <= routeCenterX + 2) { continue; }
                    var rand = decorRng && decorRng.Float ?
                        decorRng.Float(0, 1) : 0.5;
                    if(rand < coverDensity) {
                        pIntent.Map.SetTerrain(pIntentMap, fx, fy, T.FOREST);
                        pIntent.Map.AddMovement(pIntentMap, fx, fy, M.BLOCKED);
                        pIntent.Map.SetOwner(pIntentMap, fx, fy, O.TREE);
                    }
                }
            }
        }
        // 2-4 outcrop clusters in each half (north + south of the cliff)
        if(V) {
            V.ScatterOutcrops(pIntentMap, {
                minX: interiorMinX + 2, maxX: interiorMaxX - 2,
                minY: interiorMinY + 1, maxY: topRowY - 2
            }, V.PerSeedInt(decorRng, 1, 3), decorRng);
            V.ScatterOutcrops(pIntentMap, {
                minX: interiorMinX + 2, maxX: interiorMaxX - 2,
                minY: bandY + 2, maxY: interiorMaxY - 1
            }, V.PerSeedInt(decorRng, 1, 3), decorRng);
        }

        // Reserve the complete visual footprint after decorative authoring so
        // forest/outcrop scatter cannot reclaim it. The two-row apron widens
        // into tapered ten-row landing wedges over the outer ten columns;
        // this gives shoreline smoothing enough room to turn away from each
        // map-border terminus without creating a hard rectangular snow shelf.
        var apronStamped = stampCliffDryApron(
            pIntentMap, topRowY, bandY);

        // 6. Region log + anchors.
        pIntentMap.regions = pIntentMap.regions || [];
        pIntentMap.regions.push({
            id: "bisecting_cliff.cliff",
            kind: "cliff", axis: "horizontal",
            edgeAnchored: ["left","right"],
            cells: cliffStamped,
            bandY: bandY,
            topRowY: topRowY,
            stampHeight: CLIFF_THICKNESS,
            waterClearance: CLIFF_WATER_CLEARANCE,
            terminalLandingWidth: CLIFF_TERMINAL_LANDING_WIDTH,
            terminalMaxClearance: CLIFF_TERMINAL_MAX_CLEARANCE,
            placementStyle: placementStyle
        });
        pIntentMap.regions.push({
            id: "bisecting_cliff.crossing",
            kind: "crossing",
            at: { x: crossX, y: bandY },
            width: crossWidth,
            cells: crossWidth * CLIFF_THICKNESS
        });

        pIntentMap.anchors = pIntentMap.anchors || {};
        pIntentMap.anchors.start     = { x: startX, y: startY };
        pIntentMap.anchors.objective = { x: endX,   y: endY };
        pIntentMap.anchors.crossing  = { x: routeCenterX, y: bandY };

        return pIntent.AuthorResult.Ok([
            pIntent.AuthorResult.Diagnostic(
                "ice_bisecting_cliff.author",
                "placement=" + placementStyle +
                " bandY=" + bandY + " cliff=" + cliffStamped +
                " apron=" + apronStamped +
                " route=" + routeStamped + " crossX=" + crossX
            )
        ]);
    }

    if(pIntent.RegisterConcept) {
        pIntent.RegisterConcept({
            id: "ice_bisecting_cliff_strict",
            biome: "ice",
            // Phase 2 routing: pick this Concept when the Grammar plan's
            // intent.iceLayoutStyle equals "ice_bisecting_cliff" (the v1
            // grammar dispatch string covers both _strict and _terrace
            // variants until Phase 3 splits them in Grammar/Intent.js).
            // Falls back to ice_open_arena via the Pipeline fallback if
            // appliesTo returns false.
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
                // Phase 2: the v1 Grammar/Intent.IceLayoutStyle picker emits
                // names like ice_cliff_checkpoint (8-style weighted pick); we
                // map cliff_checkpoint and explicit bisecting_cliff onto this
                // Concept until Phase 3 adds the _strict / _terrace split into
                // Grammar/Intent.js.
                return style === "ice_cliff_checkpoint" ||
                    style.indexOf("bisecting_cliff_strict") === 0;
            },
            author: authorIceBisectingCliffStrict,
            intentHardValidators: [
                {
                    id: "cliff_edge_to_edge",
                    fn: function(pContext, pIntentMap) {
                        // Phase 5 P5.1: cliff is now HORIZONTAL — must touch
                        // LEFT (column 0) AND RIGHT (column W-1) edges.
                        var Tlocal = pIntent.Terrain;
                        var W = pIntentMap.width;
                        var H = pIntentMap.height;
                        var leftHas = false, rightHas = false;
                        for(var y = 0; y < H; ++y) {
                            var li = (y * W);
                            var ri = (y * W) + (W - 1);
                            if(pIntentMap.terrain[li] === Tlocal.CLIFF_BODY ||
                                pIntentMap.terrain[li] === Tlocal.CLIFF_TOP) {
                                leftHas = true;
                            }
                            if(pIntentMap.terrain[ri] === Tlocal.CLIFF_BODY ||
                                pIntentMap.terrain[ri] === Tlocal.CLIFF_TOP) {
                                rightHas = true;
                            }
                        }
                        if(!leftHas || !rightHas) {
                            return { ok: false,
                                reason: "intent_hard:cliff_not_edge_to_edge:left=" +
                                    leftHas + ":right=" + rightHas };
                        }
                        return { ok: true };
                    }
                },
                {
                    id: "cliff_dry_render_apron",
                    fn: function(pContext, pIntentMap) {
                        var Tlocal = pIntent.Terrain;
                        var Mlocal = pIntent.Movement;
                        var regions = pIntentMap.regions || [];
                        var cliffRegion = null;
                        for(var r = 0; r < regions.length; ++r) {
                            if(regions[r] && regions[r].kind === "cliff" &&
                                regions[r].axis === "horizontal") {
                                cliffRegion = regions[r];
                                break;
                            }
                        }
                        if(!cliffRegion)
                            return { ok: false,
                                reason: "intent_hard:cliff_region_missing" };

                        var topY = cliffRegion.topRowY;
                        var bottomY = cliffRegion.bandY;
                        for(var x = 0; x < pIntentMap.width; ++x) {
                            var clearance = cliffClearanceAtX(
                                x, pIntentMap.width);
                            for(var side = -1; side <= 1; side += 2) {
                                for(var d = 1; d <= clearance; ++d) {
                                    var y = side < 0 ? topY - d : bottomY + d;
                                    if(y < 0 || y >= pIntentMap.height) { continue; }
                                    var index = (y * pIntentMap.width) + x;
                                    if(pIntentMap.terrain[index] !== Tlocal.LAND ||
                                        (pIntentMap.movement[index] & Mlocal.BLOCKED)) {
                                        return {
                                            ok: false,
                                            reason: "intent_hard:cliff_apron_not_dry:" +
                                                x + "," + y
                                        };
                                    }
                                }
                            }
                        }
                        return { ok: true };
                    }
                }
            ],
            intentQualityValidators: [],
            renderedHardValidators: [
                { id: "skidoo_jump_ramps", fn: validateSkidooJumpRamps }
            ],
            driftBudget: {
                landIntentSolidMaxFraction: 0.15
            },
            finaliseConcept: finaliseSkidooJumpRamps
        });
    }

    pIntent.Concepts.IceBisectingCliffStrict = {
        author: authorIceBisectingCliffStrict
    };

    // -----------------------------------------------------------------------
    // ice_bisecting_cliff_terrace — corner-anchored variant (Phase 2/3).
    //
    // Per v3.4 §9.1: "corner-anchor cliff terrace touching ≥1 map edge, with
    // cliff body cardinally cell-disjoint from water per [[cliff_no_water_overlap]].
    // Transit optional. Calibrated against shipped corpus (87.5% of shipped
    // ice cliffs are this variant per [[mapgen_cliff_terminus_art]])."
    //
    // Author strategy:
    //   - Keep interior terrain open for materialized cover.
    //   - Pick a CORNER (NE / NW / SE / SW) per per-seed deterministic jitter.
    //   - Stamp a cliff terrace anchored at that corner, extending inward
    //     for ~1/3 of the map dimension on each axis.
    //   - Single CROSSING through the cliff so route can pass.
    //   - Spawn pad on the opposite side of the cliff from the corner;
    //     OBJECTIVE inside the corner-bounded area.

    var TERRACE_SHAPES = [
        // Short, shallow shelf; useful on broad maps where the balanced
        // terrace otherwise occupies the same large corner every time.
        { name: "compact_shelf", reachX: 0.34, sideInset: 4,
            flatFraction: 0.36, stairFraction: 0.42 },
        // Calibrated acceptance shape retained as the middle of the family.
        { name: "balanced_diagonal", reachX: 0.40, sideInset: 8,
            flatFraction: 0.28, stairFraction: 0.45 },
        // Longer, steeper corner cut resembling the extended diagonals in
        // the shipped ice maps, while retaining legal one-row atlas steps.
        { name: "extended_cut", reachX: 0.50, sideInset: 12,
            flatFraction: 0.22, stairFraction: 0.55 }
    ];

    // The generic grammar_ice profile has no authored terrace contract. Give
    // it one additional mid-length phrase while leaving named mobility and
    // terrace profiles on their established three-shape distribution.
    var GENERIC_TERRACE_SHAPE =
        { name: "staggered_shelf", reachX: 0.44, sideInset: 6,
            flatFraction: 0.30, stairFraction: 0.48 };

    // Build a one-cell-at-a-time cliff slope which the shipped ice atlas can
    // actually join.  Its step strips may repeat, but two separate step runs
    // need at least two body columns between them (step -> body_v3 ->
    // body_v0 -> step).  Linear rounding frequently produced step/body/step,
    // for which no legal strip sequence exists.
    function terraceSlopeOffsets(pDelta, pEdgeCount, pSequenceSeed) {
        var offsets = [0];
        var direction = pDelta < 0 ? -1 : 1;
        var changes = Math.abs(pDelta) | 0;
        if(changes === 0 || pEdgeCount <= 0) {
            while(offsets.length <= pEdgeCount)
                offsets.push(0);
            return offsets;
        }

        // A cliff column may move by at most one row.  Callers gate out maps
        // too narrow to fit the complete edge-to-edge terrace phrase.
        if(changes > pEdgeCount)
            return null;

        var flatEdges = pEdgeCount - changes;
        var clusterCount = Math.min(4, changes,
            1 + Math.floor(flatEdges / 2));
        if(pSequenceSeed !== undefined)
            clusterCount = 1 + MapGen.Random.HashTile(pSequenceSeed, 271, 277, 4237) % clusterCount;
        var clusterSizes = [];
        var clusterBase = Math.floor(changes / clusterCount);
        var clusterExtra = changes % clusterCount;
        for(var clusterIndex = 0; clusterIndex < clusterCount; ++clusterIndex) {
            clusterSizes.push(clusterBase +
                (clusterIndex < clusterExtra ? 1 : 0));
        }

        var gapSizes = [];
        for(var gapIndex = 0; gapIndex <= clusterCount; ++gapIndex)
            gapSizes.push(gapIndex > 0 && gapIndex < clusterCount ? 2 : 0);
        var spareFlats = flatEdges - ((clusterCount - 1) * 2);
        // Spread spare flats across the phrase rather than leaving one long,
        // conspicuously straight landing at either end.
        var spreadIndex = 0;
        while(spareFlats-- > 0) {
            var gap = pSequenceSeed === undefined ? spreadIndex % gapSizes.length :
                MapGen.Random.HashTile(pSequenceSeed, spreadIndex, 281, 4241) % gapSizes.length;
            gapSizes[gap]++;
            ++spreadIndex;
        }
        // The perpendicular edge owns exactly the atlas face plus its three
        // off-map exit columns. Any optional pause at the end of the slope
        // lengthens row 0/H-1 into the XL 7-8-cell flat wall. Move all such
        // flats to the broad side landing; a zero-pause terminal is also the
        // clean adjacency phrase (one continuous step run into the clip).
        gapSizes[0] += gapSizes[clusterCount];
        gapSizes[clusterCount] = 0;

        // Between descending runs the atlas requires v3 -> v0 -> v2,
        // with only v0/v2 able to start the next descent. A landing of
        // 1 mod 3 columns strands the grammar on v3. Move its spare flat
        // edge to the broad landing, preserving total width and elevation.
        for(var landing = 1; landing < clusterCount; ++landing) {
            if(gapSizes[landing] % 3 === 1) {
                --gapSizes[landing];
                ++gapSizes[0];
            }
        }

        var current = 0;
        function appendEdges(pCount, pChangesHeight) {
            for(var edgeIndex = 0; edgeIndex < pCount; ++edgeIndex) {
                if(pChangesHeight)
                    current += direction;
                offsets.push(current);
            }
        }
        appendEdges(gapSizes[0], false);
        for(var phraseIndex = 0; phraseIndex < clusterCount; ++phraseIndex) {
            appendEdges(clusterSizes[phraseIndex], true);
            appendEdges(gapSizes[phraseIndex + 1], false);
        }
        return offsets;
    }

    function authorIceBisectingCliffTerrace(pPlan, pIntentMap, pRngs, pContext) {
        var W = pIntentMap.width;
        var H = pIntentMap.height;
        var profile = pContext ? pContext.Profile || {} : {};

        if(W < (PERIMETER_MARGIN * 2 + 14) || H < (PERIMETER_MARGIN * 2 + 8)) {
            return pIntent.AuthorResult.Fail(
                pIntent.AuthorReason.InsufficientOpenArea,
                [pIntent.AuthorResult.Diagnostic(
                    "ice_bisecting_cliff_terrace.author",
                    "IntentMap too small: " + W + "x" + H
                )]
            );
        }

        var interiorMinX = PERIMETER_MARGIN;
        var interiorMaxX = W - 1 - PERIMETER_MARGIN;
        var interiorMinY = PERIMETER_MARGIN;
        var interiorMaxY = H - 1 - PERIMETER_MARGIN;

        // Pick a corner based on seed-derived jitter (4 options).
        var rng = (pRngs && pRngs.terrain) || pRngs;
        var Vt = pIntent.Variety;
        if(Vt && Vt.StampContinent) {
            // A diagonal corner cliff already supplies the strong perimeter
            // silhouette. Combining it with an edge/island continent lets
            // coast smoothing run into the stepped face and produces broken
            // water fingers above and below the cliff. Keep this particular
            // composition on a dry mainland; water-bearing ice layouts are
            // still supplied by the river and non-cliff Concepts.
            // Still draw one weighted choice so changing the terrain recipe
            // does not shift every later per-seed choice (notably corner).
            var dryContinent = Vt.SelectContinentOption({
                ContinentStyles: [
                    { name: "mainland", weight: 1.0, landFraction: 1.0 }
                ]
            }, rng, null);
            Vt.StampContinent(pIntentMap, dryContinent, rng);
        }
        // Corner orientation is structural, so derive it directly from the
        // requested seed rather than from the current RNG cursor. Terrain
        // recipes may consume a different number of random values; letting
        // that silently rotate an existing seed made visual fixes impossible
        // to compare and made profile tuning reshuffle all four orientations.
        var cornerSeed = pContext && pContext.Seed !== undefined ?
            (pContext.Seed >>> 0) : 0;
        // Low seed bits are a poor structural selector: a batch of odd seeds
        // all chose NE because `seed % 4` never mixed those bits. Use the
        // generator's established integer hash for both orientation and a
        // separately salted shape family.
        var cornerHash = MapGen.Random.HashTile(
            cornerSeed, 251, 257, 4229);
        var shapeHash = MapGen.Random.HashTile(
            cornerSeed, 263, 269, 4231);
        var cornerPick = cornerHash % 4;
        var shapePool = String(profile.Name || "") === "grammar_ice" ?
            TERRACE_SHAPES.concat([GENERIC_TERRACE_SHAPE]) : TERRACE_SHAPES;
        var terraceShape = shapePool[shapeHash % shapePool.length];
        // 0 = NW, 1 = NE, 2 = SW, 3 = SE
        var cornerNorth = (cornerPick === 0 || cornerPick === 1);
        var cornerWest  = (cornerPick === 0 || cornerPick === 2);

        var baseReachX = Math.floor(
            (interiorMaxX - interiorMinX) * terraceShape.reachX);
        // Reserve three extra columns after the diagonal first reaches the
        // edge. They continue beyond the map rather than flattening there;
        // clipping produces the same 4/3/2/1 termination as shipped cliffs.
        var edgeExitColumns = CLIFF_EDGE_EXIT_WIDTH - 1;
        var reachX = baseReachX + edgeExitColumns;
        // Mark interior walkable; reserve only actual routes/anchors.
        for(var iy = interiorMinY; iy <= interiorMaxY; ++iy) {
            for(var ix = interiorMinX; ix <= interiorMaxX; ++ix) {
                pIntent.Map.AddMovement(pIntentMap, ix, iy, M.WALKABLE);
            }
        }

        // Stamp a renderable diagonal terrace between adjacent map edges.
        // Ice cliff art is a vertical strip selected per X column, so a
        // literal vertical arm cannot use the atlas. Instead the terrace is
        // flat near the left/right edge (room for stairs), then climbs in
        // one-row authored steps until it fades through the north/south edge.
        // This gives the requested corner composition while preserving the
        // real cliff adjacency grammar.
        var cliffStamped = 0;
        var sideTopY = cornerNorth ?
            interiorMinY + terraceShape.sideInset :
            interiorMaxY - terraceShape.sideInset -
                (CLIFF_THICKNESS - 1);
        // Finish with the four-row atlas face itself on the perpendicular map
        // edge. Shipped ice cliffs clip their off-map snow lip/foot shadow;
        // keeping those overlays in-bounds instead left a visible snow row
        // between the cliff face and the edge.
        var fadeTopY = cornerNorth ? 0 : (H - CLIFF_THICKNESS);
        var flatColumns = Math.max(7, Math.floor(
            baseReachX * terraceShape.flatFraction));
        var driftColumns = Math.max(
            1, reachX - flatColumns - edgeExitColumns);
        var requiredDrift = Math.abs(fadeTopY - sideTopY);
        // Narrow generic maps still need a complete face and a five-column
        // stair landing. Extend the terrace before rejecting a legal slope.
        if(profile.Name === "grammar_ice" && driftColumns < requiredDrift) {
            reachX = Math.min(W - 1, Math.max(reachX, requiredDrift + 5 + edgeExitColumns));
            driftColumns = Math.max(1, reachX - flatColumns - edgeExitColumns);
        }
        // The 56-wide Small preset initially has fewer drift edges than
        // vertical height changes. Borrow columns from its still-safe stair
        // landing so every rendered cliff column moves by at most one row.
        if(driftColumns < requiredDrift &&
            reachX - edgeExitColumns - requiredDrift >= 5) {
            flatColumns = reachX - edgeExitColumns - requiredDrift;
            driftColumns = requiredDrift;
        }
        var slopeOffsets = terraceSlopeOffsets(
            fadeTopY - sideTopY, driftColumns,
            profile.RegionalComposition ? cornerSeed : undefined);
        if(!slopeOffsets)
            return pIntent.AuthorResult.Fail(pIntent.AuthorReason.InsufficientOpenArea,
                [pIntent.AuthorResult.Diagnostic("ice_bisecting_cliff_terrace.slope",
                    "Cliff requires " + requiredDrift + " height steps across " + driftColumns + " columns")]);
        var cliffColumns = [];
        for(var step = 0; step <= reachX; ++step) {
            var cliffX = cornerWest ? step : (W - 1 - step);
            var cliffTopY = sideTopY;
            if(step > flatColumns) {
                var distanceAfterFlat = step - flatColumns;
                if(distanceAfterFlat <= driftColumns) {
                    cliffTopY = sideTopY +
                        slopeOffsets[distanceAfterFlat];
                }
                else {
                    var exitStep = distanceAfterFlat - driftColumns;
                    cliffTopY = fadeTopY +
                        (cornerNorth ? -exitStep : exitStep);
                }
            }
            cliffColumns.push({ x: cliffX, topY: cliffTopY });
            for(var cliffRow = 0; cliffRow < CLIFF_THICKNESS; ++cliffRow) {
                var cliffY = cliffTopY + cliffRow;
                if(cliffY < 0 || cliffY >= H)
                    continue;
                pIntent.Map.SetTerrain(pIntentMap, cliffX, cliffY,
                    cliffRow === CLIFF_THICKNESS - 1 ?
                        T.CLIFF_BODY : T.CLIFF_TOP);
                pIntent.Map.AddMovement(pIntentMap, cliffX, cliffY, M.BLOCKED);
                pIntent.Map.ClearMovement(pIntentMap, cliffX, cliffY, M.WALKABLE);
                pIntent.Map.SetOwner(pIntentMap, cliffX, cliffY, O.CLIFF);
                ++cliffStamped;
            }
        }

        // Punch the atlas's real three-column stairs into the flat segment.
        var stairStep = Math.max(2, Math.min(flatColumns - 4,
            Math.floor(flatColumns * terraceShape.stairFraction)));
        var crossingX = cornerWest ? stairStep :
            (W - 1 - stairStep - 2);
        var crossingTopY = sideTopY;
        for(var crossingDx = 0; crossingDx < 3; ++crossingDx) {
            for(var crossingRow = 0;
                crossingRow < CLIFF_THICKNESS;
                ++crossingRow) {
                var crossingCellX = crossingX + crossingDx;
                var crossingCellY = crossingTopY + crossingRow;
                pIntent.Map.SetTerrain(
                    pIntentMap, crossingCellX, crossingCellY, T.LAND);
                pIntent.Map.ClearMovement(
                    pIntentMap, crossingCellX, crossingCellY, M.BLOCKED);
                pIntent.Map.AddMovement(
                    pIntentMap, crossingCellX, crossingCellY,
                    M.WALKABLE | M.ROUTE_PRIMARY | M.CROSSING | M.KEEP_CLEAR);
                pIntent.Map.SetOwner(
                    pIntentMap, crossingCellX, crossingCellY, O.OPEN);
            }
        }

        // Anchors are also the axis for the terrace's cover composition.
        // Resolve them before forest authoring so different seeds can change
        // the macro placement of cover, rather than merely changing noise
        // inside the same full-map forest mask.
        var spawnX = cornerWest ? (interiorMaxX - SPAWN_HALO) : (interiorMinX + SPAWN_HALO);
        var spawnY = cornerNorth ? (interiorMaxY - SPAWN_HALO) : (interiorMinY + SPAWN_HALO);
        var objX = cornerWest ? (interiorMinX + SPAWN_HALO + 2) : (interiorMaxX - SPAWN_HALO - 2);
        var objY = cornerNorth ? (interiorMinY + SPAWN_HALO + 2) : (interiorMaxY - SPAWN_HALO - 2);

        var terraceCoverHash = MapGen.Random.HashTile(
            cornerSeed, 281, 283, 4261);
        var terraceCoverStyles = [
            "dispersed_groves",
            "crossing_belts",
            "serpentine_banks"
        ];
        var terraceCoverStyle = terraceCoverStyles[
            terraceCoverHash % terraceCoverStyles.length];

        // Preserve the style on the context for executable-side metadata and
        // batch auditing. The IntentMap region below is the authoritative
        // authored record used during this attempt.
        if(pContext) {
            pContext.TerraceCover = {
                style: terraceCoverStyle,
                selector: terraceCoverHash >>> 0
            };
        }

        // This Concept owns the macro forest layout. Do not let the generic
        // open-field and exposure repairs replace it with the same islands
        // and ribbons used by every other ice style. The authored masks below
        // already provide route-shaping cover, and the rendered hard contract
        // rejects any seed that ends up too open after tile pruning.
        profile.ForestRespectIntentMask = true;
        profile.OpenAreaBreakup = false;
        profile.PostPlacementOpenAreaBreakup = false;
        profile.RouteExposureBreakup = false;
        profile.OpenFieldScreens = false;
        profile.FinalOpenFieldCover = false;
        // Preserve the authored macro composition, but do not preserve empty
        // travel viewports. This focused pass only reinforces 17x13 windows
        // containing a real route that still have no cliff, water, activity,
        // or viable cover; unlike the generic open-area passes above it cannot
        // homogenise the whole terrace with globally scattered islands.
        profile.RouteViewportCover = W * H >= 6000;
        profile.RouteViewportCoverRadius = W * H >= 10000 ? 4 : 3;
        profile.MaxRouteViewportCoverClusters = W * H >= 10000 ? 20 : 10;
        // XL terraces also need a handful of authored-scale barriers away
        // from the route. Keep this separate from OpenFieldScreens: that
        // generic post-placement pass is deliberately disabled above, while
        // the v3 pass is capped tightly and only considers very open sectors.
        profile.V3OpenFieldScreens = W * H >= 10000;
        profile.OpenFieldScreenSectorSize = [16, 20];
        profile.OpenFieldScreenMinOpenFraction = 0.74;
        profile.OpenFieldScreenMinOpenTiles = 128;
        profile.OpenFieldScreenPathCenterClearance = 2;
        profile.OpenFieldScreenCriticalClearance = 6;
        profile.OpenFieldScreenPlacementClearance = 5;
        profile.OpenFieldScreenPrioritizeDeadViewports = true;
        profile.AuditRenderedOpenFieldScreens = profile.V3OpenFieldScreens;
        profile.MinRenderedOpenFieldScreenSurvivalFraction = 0.22;
        profile.MinRenderedOpenFieldScreenMajorSpan = 6;
        profile.MinRenderedOpenFieldScreenMinorSpan = 2;
        profile.MinRenderedOpenFieldScreenLargestComponent = 8;
        profile.MaxOpenFieldScreens = terraceCoverStyle === "dispersed_groves" ? 6 :
            (terraceCoverStyle === "serpentine_banks" ? 4 : 5);
        profile.MinSubstantialRenderedOpenFieldScreens =
            terraceCoverStyle === "serpentine_banks" ? 2 : 3;
        // Leave room for clearance and canopy taper while retaining a
        // substantial barrier after rendering.
        profile.OpenFieldScreenLength = [13, 18];
        profile.OpenFieldScreenThickness = [3, 3];

        // Route viewports are a generation contract; broad ambient openness
        // remains a soft pacing signal because intentional snow arenas are
        // valid. This distinction rejects empty travel without rejecting a
        // useful open combat space merely for being open.
        profile.MaxRouteDeadScreenFraction = 0.02;
        profile.MaxRouteQuietScreenFraction = 0.05;
        profile.RouteScreenPacingHardFail = W * H >= 10000;
        profile.FinalRouteEdgeCover = true;
        profile.FinalRouteEdgeCoverEdgeClearance = 8;
        profile.CoverSafeFrame = 8;
        profile.PerimeterCover = false;
        profile.PerimeterCoverChance = 0;
        profile.RouteArchetypeEdgeCoverChance = 0;
        profile.RouteArchetypeOutsideCoverChance = 0;
        profile.RouteArchetypeGateCoverChance = 0;
        profile.RouteArchetypeSideCoverChance = 0;

        // The materializer still applies its legal ice-tree patch grammar.
        // Give each macro composition a matching patch scale so a belt does
        // not get resampled into the same small-grove texture as every other
        // terrace.
        if(terraceCoverStyle === "crossing_belts") {
            profile.TreeCoverage = Math.max(0.28,
                Number(profile.TreeCoverage || 0));
            profile.ForestPatchAlpha = 1.18;
            profile.ForestPatchMinSize = 88;
            profile.ForestPatchMaxSize = 250;
            profile.ForestSeedDensity = 0.0045;
            profile.TacticalCoverDensity = 0.22;
            profile.PostPlacementCoverDensity = 0.28;
            profile.RouteEdgeCoverChance = 0.24;
            profile.FinalRouteEdgeCoverSpacing = 4;
            profile.FinalRouteEdgeCoverChance = 1.0;
            profile.FinalRouteEdgeCoverOppositeSideScale = 0.85;
            profile.FinalRouteEdgeCoverLength = [10, 16];
            profile.FinalRouteEdgeCoverThickness = [2, 2];
            profile.MaxFinalRouteEdgeCoverScreens = 24;
        }
        else if(terraceCoverStyle === "serpentine_banks") {
            profile.TreeCoverage = Math.max(0.30,
                Number(profile.TreeCoverage || 0));
            profile.ForestPatchAlpha = 1.16;
            profile.ForestPatchMinSize = 96;
            profile.ForestPatchMaxSize = 270;
            profile.ForestSeedDensity = 0.0052;
            profile.TacticalCoverDensity = 0.42;
            profile.PostPlacementCoverDensity = 0.46;
            profile.RouteEdgeCoverChance = 0.62;
            profile.FinalRouteEdgeCoverSpacing = 4;
            profile.FinalRouteEdgeCoverChance = 1.0;
            profile.FinalRouteEdgeCoverOppositeSideScale = 1.0;
            profile.FinalRouteEdgeCoverLength = [12, 18];
            profile.FinalRouteEdgeCoverThickness = [2, 3];
            profile.MaxFinalRouteEdgeCoverScreens = 32;
            profile.MaxFinalRouteMedianWidth = 30;
        }
        else {
            profile.TreeCoverage = Math.max(0.26,
                Number(profile.TreeCoverage || 0));
            profile.ForestPatchAlpha = 1.34;
            profile.ForestPatchMinSize = 64;
            profile.ForestPatchMaxSize = 190;
            profile.ForestSeedDensity = 0.0042;
            profile.TacticalCoverDensity = 0.30;
            profile.PostPlacementCoverDensity = 0.36;
            profile.RouteEdgeCoverChance = 0;
            profile.MinRenderedStructureContextCoverFraction = 0.07;
            // Open-field screens now target ambient dead acreage instead of
            // incidentally narrowing the main route. Give the dispersed style
            // enough dedicated route-edge ribbons to meet its width contract
            // independently of where those ambient screens land.
            profile.FinalRouteEdgeCoverChance = 1.0;
            profile.FinalRouteEdgeCoverSpacing = 4;
            profile.FinalRouteEdgeCoverThickness = [2, 2];
            profile.MaxFinalRouteEdgeCoverScreens = 24;
        }

        // A corner terrace is relatively open, but the cliff cannot be the
        // only route-shaping terrain on a large canvas.  The old author left
        // every non-cliff interior cell as WALKABLE, producing accepted maps
        // with 43-50-tile route widths and no tactical decisions.  Grow a few
        // substantial, organic forest masses before carving the route.  Keep
        // a two-cell apron around the cliff so canopy/shadow projection never
        // collides with the stepped face.
        var terraceForestCells = 0;
        var terraceDecorRng = (pRngs && pRngs.decor) || pRngs;
        if(Vt && Vt.StampForestCellularAutomata) {
            var terraceDensityHash = MapGen.Random.HashTile(
                cornerSeed, 271, 277, 4253);
            var terraceForestDensity;
            if(terraceCoverStyle === "crossing_belts") {
                terraceForestDensity = 0.69 +
                    ((terraceDensityHash % 6001) / 100000);
            }
            else if(terraceCoverStyle === "serpentine_banks") {
                terraceForestDensity = 0.70 +
                    ((terraceDensityHash % 6001) / 100000);
            }
            else {
                terraceForestDensity = 0.58 +
                    ((terraceDensityHash % 8001) / 100000);
            }

            var routeVectorX = objX - spawnX;
            var routeVectorY = objY - spawnY;
            var routeLengthSquared = Math.max(1,
                routeVectorX * routeVectorX + routeVectorY * routeVectorY);
            var routeLength = Math.sqrt(routeLengthSquared);
            var bankFlip = ((terraceCoverHash >>> 4) & 1) ? 1 : -1;
            var terraceForestEdgeClearance = 8;

            function terraceForestSkip(pX, pY) {
                if(pX < terraceForestEdgeClearance ||
                    pY < terraceForestEdgeClearance ||
                    pX >= W - terraceForestEdgeClearance ||
                    pY >= H - terraceForestEdgeClearance)
                    return true;
                for(var apronY = pY - 2; apronY <= pY + 2; ++apronY) {
                    for(var apronX = pX - 2; apronX <= pX + 2; ++apronX) {
                        if(apronX < 0 || apronY < 0 || apronX >= W || apronY >= H)
                            return true;
                        var apronTerrain = pIntentMap.terrain[(apronY * W) + apronX];
                        if(apronTerrain === T.CLIFF_BODY || apronTerrain === T.CLIFF_TOP)
                            return true;
                    }
                }

                var relativeX = pX - spawnX;
                var relativeY = pY - spawnY;
                var phase = (relativeX * routeVectorX +
                    relativeY * routeVectorY) / routeLengthSquared;
                var lateral = (relativeX * -routeVectorY +
                    relativeY * routeVectorX) / routeLength;

                if(terraceCoverStyle === "crossing_belts") {
                    // Two obstacle fronts cross the start-to-objective axis.
                    // Hashing coarse lateral slices makes their boundaries
                    // uneven without producing noisy single-tile teeth.
                    var beltSlice = Math.floor((lateral + routeLength) / 5);
                    var beltWobble =
                        ((MapGen.Random.HashTile(
                            cornerSeed, beltSlice, 293, 4271) % 1001) /
                            1000 - 0.5) * 0.10;
                    var beltPhase = phase + beltWobble;
                    var insideFirstBelt =
                        beltPhase >= 0.13 && beltPhase <= 0.39;
                    var insideSecondBelt =
                        beltPhase >= 0.57 && beltPhase <= 0.84;
                    if(!insideFirstBelt && !insideSecondBelt)
                        return true;
                }
                else if(terraceCoverStyle === "serpentine_banks") {
                    // Keep an irregular S-shaped channel open and grow forest
                    // on both sides. The authored route subsequently cuts a
                    // legal three-cell passage through those banks, so this
                    // composition has sustained corridor play rather than a
                    // single obstacle followed by another broad snowfield.
                    var bankSlice = Math.floor(phase * 18);
                    var bankWobble =
                        ((MapGen.Random.HashTile(
                            cornerSeed, bankSlice, 307, 4273) % 1001) /
                            1000 - 0.5) * 3;
                    var channelOffset = bankFlip *
                        Math.sin((phase - 0.5) * Math.PI) *
                        Math.min(4, routeLength * 0.045);
                    var channelHalfWidth = Math.max(5,
                        Math.min(7, routeLength * 0.065));
                    var gatePhase =
                        (phase >= 0.20 && phase <= 0.31) ||
                        (phase >= 0.62 && phase <= 0.74);
                    if(!gatePhase &&
                        Math.abs(lateral - channelOffset - bankWobble) <
                            channelHalfWidth)
                        return true;
                }
                return false;
            }
            terraceForestCells = Vt.StampForestCellularAutomata(
                pIntentMap,
                {
                    minX: interiorMinX + 2,
                    maxX: interiorMaxX - 2,
                    minY: interiorMinY + 2,
                    maxY: interiorMaxY - 2
                },
                {
                    iterations: 3,
                    seedDensity: terraceForestDensity,
                    seedDensityField: Vt.RegionalForestDensity(pContext, terraceForestDensity, 0.12),
                    skipPredicate: terraceForestSkip
                },
                terraceDecorRng
            );
        }

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
        stampAnchor(spawnX, spawnY, O.PLAYER_SPAWN, C.SPAWN_SAFE);
        // Phase 3 P3.8: drop OBJECTIVE claim — see IceForestCorridor note.
        stampAnchor(objX, objY, O.STRUCTURE, C.SPAWN_SAFE);

        // Route each side to the stairs through cells that are actually
        // walkable. A straight Bresenham line can intersect the diagonal
        // terrace twice, leaving a semantic route mark on blocked cliff art
        // and making anchors or weapon pickups unreachable.
        function routeStamp(x0, y0, x1, y1) {
            var queue = [{ x: x0, y: y0 }];
            var head = 0;
            var seen = {};
            var previous = {};
            var startKey = x0 + "," + y0;
            var endKey = x1 + "," + y1;
            seen[startKey] = true;
            var dirs = [[1,0], [0,1], [-1,0], [0,-1]];

            while(head < queue.length && !seen[endKey]) {
                var point = queue[head++];
                for(var dirIndex = 0; dirIndex < dirs.length; ++dirIndex) {
                    var nx = point.x + dirs[dirIndex][0];
                    var ny = point.y + dirs[dirIndex][1];
                    if(nx < 0 || ny < 0 || nx >= W || ny >= H)
                        continue;
                    var key = nx + "," + ny;
                    if(seen[key])
                        continue;
                    var index = (ny * W) + nx;
                    var terrain = pIntentMap.terrain[index];
                    // The route may reclaim water left by a selected
                    // continent mask, but it must never tunnel through the
                    // terrace somewhere other than the authored stairs.
                    if((terrain === T.CLIFF_BODY || terrain === T.CLIFF_TOP) &&
                        key !== endKey)
                        continue;
                    seen[key] = true;
                    previous[key] = point.x + "," + point.y;
                    queue.push({ x: nx, y: ny });
                }
            }
            if(!seen[endKey])
                return 0;

            var path = [];
            var cursor = endKey;
            while(cursor) {
                var comma = cursor.indexOf(",");
                path.push({
                    x: Number(cursor.substring(0, comma)),
                    y: Number(cursor.substring(comma + 1))
                });
                if(cursor === startKey)
                    break;
                cursor = previous[cursor];
            }
            for(var pathIndex = path.length - 1; pathIndex >= 0; --pathIndex) {
                var cell = path[pathIndex];
                // Carve a three-cell route through the forest.  Mark only the
                // centreline ROUTE_PRIMARY so path extraction stays stable;
                // its radius-1 apron remains WALKABLE/KEEP_CLEAR and gives the
                // ice tree renderer enough room for legal canopy endings.
                for(var routeDy = -1; routeDy <= 1; ++routeDy) {
                    for(var routeDx = -1; routeDx <= 1; ++routeDx) {
                        var routeX = cell.x + routeDx;
                        var routeY = cell.y + routeDy;
                        if(routeX < 0 || routeY < 0 || routeX >= W || routeY >= H)
                            continue;
                        var routeIndex = (routeY * W) + routeX;
                        var routeTerrain = pIntentMap.terrain[routeIndex];
                        if(routeTerrain === T.CLIFF_BODY || routeTerrain === T.CLIFF_TOP)
                            continue;
                        pIntent.Map.SetTerrain(pIntentMap, routeX, routeY, T.LAND);
                        pIntent.Map.ClearMovement(pIntentMap, routeX, routeY, M.BLOCKED);
                        pIntent.Map.AddMovement(pIntentMap, routeX, routeY,
                            M.WALKABLE | M.KEEP_CLEAR);
                        if(routeDx === 0 && routeDy === 0)
                            pIntent.Map.AddMovement(pIntentMap, routeX, routeY,
                                M.ROUTE_PRIMARY);
                        pIntent.Map.SetOwner(pIntentMap, routeX, routeY, O.OPEN);
                    }
                }
            }
            return path.length;
        }
        var crossingCenterX = crossingX + 1;
        var crossingCenterY = crossingTopY + Math.floor(CLIFF_THICKNESS / 2);
        var outsideRouteStamped = routeStamp(
            spawnX, spawnY, crossingCenterX, crossingCenterY);
        var pocketRouteStamped = routeStamp(
            crossingCenterX, crossingCenterY, objX, objY);
        if(outsideRouteStamped <= 1 || pocketRouteStamped <= 1) {
            return pIntent.AuthorResult.Fail(
                pIntent.AuthorReason.NoValidTransit,
                [pIntent.AuthorResult.Diagnostic(
                    "ice_bisecting_cliff_terrace.author",
                    "no walkable route through corner stairs"
                )]
            );
        }

        pIntentMap.regions = pIntentMap.regions || [];
        pIntentMap.regions.push({
            id: "bisecting_cliff_terrace.cliff",
            kind: "cliff", axis: "corner_diagonal",
            corner: cornerPick,
            shape: terraceShape.name,
            edgeAnchored: [cornerWest ? "left" : "right",
                cornerNorth ? "top" : "bottom"],
            stampHeight: CLIFF_THICKNESS,
            columns: cliffColumns,
            cells: cliffStamped
        });
        pIntentMap.regions.push({
            id: "bisecting_cliff_terrace.crossing",
            kind: "crossing",
            at: { x: crossingX, y: crossingCenterY },
            width: 3,
            cells: 3 * CLIFF_THICKNESS
        });
        pIntentMap.regions.push({
            id: "bisecting_cliff_terrace.forest",
            kind: "forest",
            coverStyle: terraceCoverStyle,
            cells: terraceForestCells
        });

        pIntentMap.anchors = pIntentMap.anchors || {};
        pIntentMap.anchors.start     = { x: spawnX, y: spawnY };
        pIntentMap.anchors.objective = { x: objX,   y: objY };
        pIntentMap.anchors.crossing  = {
            x: crossingCenterX, y: crossingCenterY
        };

        return pIntent.AuthorResult.Ok([
            pIntent.AuthorResult.Diagnostic(
                "ice_bisecting_cliff_terrace.author",
                "corner=" + cornerPick + " shape=" + terraceShape.name +
                " cover=" + terraceCoverStyle +
                " cliff=" + cliffStamped +
                " forest=" + terraceForestCells +
                " route=" + (outsideRouteStamped + pocketRouteStamped)
            )
        ]);
    }

    if(pIntent.RegisterConcept) {
        pIntent.RegisterConcept({
            id: "ice_bisecting_cliff_terrace",
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
                return style === "ice_cliff_terrace" ||
                    style.indexOf("bisecting_cliff_terrace") === 0;
            },
            author: authorIceBisectingCliffTerrace,
            intentHardValidators: [
                {
                    id: "cliff_touches_one_edge",
                    fn: function(pContext, pIntentMap) {
                        // §9.1 binding constraint: ≥1 map edge.
                        var Tlocal = pIntent.Terrain;
                        var Wm = pIntentMap.width;
                        var Hm = pIntentMap.height;
                        function isCliff(pX, pY) {
                            var terrain = pIntentMap.terrain[(pY * Wm) + pX];
                            return terrain === Tlocal.CLIFF_BODY ||
                                terrain === Tlocal.CLIFF_TOP;
                        }

                        var hits = 0;
                        for(var x = 0; x < Wm; ++x) {
                            if(isCliff(x, 0) || isCliff(x, Hm - 1)) {
                                ++hits;
                                break;
                            }
                        }
                        if(hits === 0) {
                            for(var y = 0; y < Hm; ++y) {
                                if(isCliff(0, y) || isCliff(Wm - 1, y)) {
                                    ++hits;
                                    break;
                                }
                            }
                        }
                        if(hits === 0) {
                            return { ok: false,
                                reason: "intent_hard:cliff_terrace_no_edge_anchor" };
                        }
                        return { ok: true };
                    }
                }
            ],
            intentQualityValidators: [],
            renderedHardValidators: [
                {
                    id: "terrace_open_field_screen_survival",
                    fn: function(pContext, pIntentMap, pRenderedMap) {
                        var profile = pContext.Profile || {};
                        if(profile.AuditRenderedOpenFieldScreens !== true)
                            return { ok: true };

                        var audit = pRenderedMap && pRenderedMap.Smoothing ?
                            pRenderedMap.Smoothing.openFieldScreenAudit : null;
                        if(!audit) {
                            return { ok: false,
                                reason: "rendered_terrace_screen_audit_missing" };
                        }

                        var required = Math.max(1, Math.floor(Number(
                            profile.MinSubstantialRenderedOpenFieldScreens || 1)));
                        if(audit.substantialScreens < required) {
                            return { ok: false,
                                reason: "rendered_terrace_screens_too_weak:" +
                                    audit.substantialScreens + "/" + required +
                                    ":surviving=" + audit.survivingScreens +
                                    ":marked=" + audit.markedScreens };
                        }
                        return { ok: true };
                    }
                },
                {
                    id: "terrace_uses_route_field",
                    fn: function(pContext, pIntentMap, pRenderedMap) {
                        var chars = pRenderedMap && pRenderedMap.Chars;
                        var ice = MapGen.Terrain && MapGen.Terrain.Smoothing ?
                            MapGen.Terrain.Smoothing.Ice : null;
                        if(!chars || !ice || !ice.IsTreeCharValue) {
                            return { ok: false,
                                reason: "rendered_terrace_tree_audit_missing" };
                        }

                        var treeChars = 0;
                        for(var treeY = 0; treeY < pContext.Height; ++treeY) {
                            for(var treeX = 0; treeX < pContext.Width; ++treeX) {
                                if(ice.IsTreeCharValue(MapGen.Layers.Get(
                                    chars, treeX, treeY, ice.Chars.ground)))
                                    ++treeChars;
                            }
                        }

                        // Structure placement deliberately clears the forest
                        // beneath each building before the final re-render.
                        // Count the exact, unique structure footprint as
                        // cover-equivalent for this composition floor; without
                        // it a valid wooded terrace can pass before encounters
                        // and then fail solely because required buildings
                        // replaced the trees at their own occupied cells.
                        var structureEquivalentChars = 0;
                        var structureMask = {};
                        var placements = pContext.LiveStructurePlacements || [];
                        if(MapGen.Integration &&
                            MapGen.Integration.StructureTileStruct) {
                            for(var placementIndex = 0;
                                placementIndex < placements.length;
                                ++placementIndex) {
                                var placement = placements[placementIndex];
                                var struct = placement ?
                                    MapGen.Integration.StructureTileStruct(
                                        placement.spec) : null;
                                if(!placement || !struct)
                                    continue;

                                for(var structIndex = 0;
                                    structIndex < struct.length;
                                    ++structIndex) {
                                    var structureX = placement.tileX +
                                        struct[structIndex][0];
                                    var structureY = placement.tileY +
                                        struct[structIndex][1];
                                    var structureKey = structureX + "," +
                                        structureY;
                                    if(structureMask[structureKey] ||
                                        structureX < 0 || structureY < 0 ||
                                        structureX >= pContext.Width ||
                                        structureY >= pContext.Height)
                                        continue;
                                    structureMask[structureKey] = true;

                                    if(!ice.IsTreeCharValue(MapGen.Layers.Get(
                                        chars, structureX, structureY,
                                        ice.Chars.ground)))
                                        ++structureEquivalentChars;
                                }
                            }
                        }

                        // The reservation layer also includes the immediate
                        // doorway/access apron cleared specifically for the
                        // structure. Count those intentional encounter cells
                        // once as well; they are the rest of the forest loss
                        // introduced between the pre-encounter and final
                        // rendered-hard checks.
                        var structureGround = pContext.Layers ?
                            pContext.Layers.structureGround : null;
                        if(structureGround) {
                            for(var groundY = 0;
                                groundY < pContext.Height; ++groundY) {
                                for(var groundX = 0;
                                    groundX < pContext.Width; ++groundX) {
                                    if(!MapGen.Layers.Get(
                                        structureGround, groundX, groundY, 0))
                                        continue;
                                    var groundKey = groundX + "," + groundY;
                                    if(structureMask[groundKey])
                                        continue;
                                    structureMask[groundKey] = true;
                                    if(!ice.IsTreeCharValue(MapGen.Layers.Get(
                                        chars, groundX, groundY,
                                        ice.Chars.ground)))
                                        ++structureEquivalentChars;
                                }
                            }
                        }

                        var area = Math.max(1,
                            pContext.Width * pContext.Height);
                        var effectiveTreeChars = treeChars +
                            structureEquivalentChars;
                        var treeFraction = effectiveTreeChars / area;
                        var treeFloor = Number(
                            (pContext.Profile || {}).MinTerraceRenderedTreeCharFraction
                        );
                        if(!isFinite(treeFloor)) treeFloor = 0.14;
                        if(pContext.TerraceCover) {
                            pContext.TerraceCover.renderedTreeAudit = {
                                treeChars: treeChars,
                                structureEquivalentChars:
                                    structureEquivalentChars,
                                effectiveFraction: treeFraction,
                                floor: treeFloor
                            };
                        }
                        if(treeFraction < treeFloor) {
                            return { ok: false,
                                reason: "rendered_terrace_too_open:" +
                                    treeFraction.toFixed(3) + "/" +
                                    treeFloor.toFixed(3) + ":trees=" +
                                    treeChars + ":structures=" +
                                    structureEquivalentChars };
                        }

                        if(!MapGen.Validate || !MapGen.Validate.TacticalEndpoints ||
                            !MapGen.Validate.ShortestPath || !MapGen.Validate.FinalRouteWidth) {
                            return { ok: false,
                                reason: "rendered_terrace_route_audit_missing" };
                        }
                        var endpoints = MapGen.Validate.TacticalEndpoints(pContext);
                        var path = endpoints && endpoints.start && endpoints.end ?
                            MapGen.Validate.ShortestPath(
                                pContext, endpoints.start, endpoints.end, null
                            ) : null;
                        if(!path || !path.length) {
                            return { ok: false,
                                reason: "rendered_terrace_route_missing" };
                        }
                        var width = MapGen.Validate.FinalRouteWidth(pContext, path);
                        var widthCap = Number(
                            (pContext.Profile || {}).MaxFinalRouteMedianWidth
                        );
                        if(!isFinite(widthCap)) widthCap = 28;
                        if(!width || !width.sampleCount || width.median > widthCap) {
                            return { ok: false,
                                reason: "rendered_terrace_route_too_open:" +
                                    (width && width.median !== undefined ?
                                        width.median : "missing") + "/" + widthCap };
                        }
                        return { ok: true };
                    }
                }
            ],
            driftBudget: {
                landIntentSolidMaxFraction: 0.18
            },
            finaliseConcept: function(pContext, pIntentMap, pRenderedMap) { return 0; }
        });
    }

    pIntent.Concepts.IceBisectingCliffTerrace = {
        author: authorIceBisectingCliffTerrace
    };

})(MapGen.Intent);
