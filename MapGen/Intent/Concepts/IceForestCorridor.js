var MapGen = MapGen || {};
MapGen.Intent = MapGen.Intent || {};
MapGen.Intent.Concepts = MapGen.Intent.Concepts || {};

// MapGen.Intent.Concepts.IceForestCorridor — Phase 4 P4.1 with variety.
//
// Per OpenFodder_Map_Generator_Rewrite_Design_v3.4.md §9.1:
//   "Linear ROUTE_PRIMARY edge-to-edge with high authored FOREST density
//    (≥0.30) flanking the corridor; outpost-archetype STRUCTURE distribution
//    (3+ structures along the gauntlet)."
//
// Phase 4 variety pass (was Phase 2 stub):
//   - Per-seed forest density 0.20–0.45 (was constant ~0.95)
//   - Per-seed route shape: straight / s-curve / zigzag
//   - 2–5 outcrop clusters scattered in the forest bands
//   - 1–3 tactical clearings ("ambush pockets") inside forest
//   - Spawn anchor jitter ±2 cells
//
// appliesTo: Grammar styles ice_forest_route + ice_tree_maze + ice_tree_blob.

(function(pIntent) {

    var T = pIntent.Terrain;
    var M = pIntent.Movement;
    var C = pIntent.Claim;
    var O = pIntent.Owner;
    var V = pIntent.Variety;

    var PERIMETER_MARGIN = 5;
    var SPAWN_HALO = 2;
    // Phase 4 P4.1: was 2 (5-cell-wide corridor). Now 1 (3-cell). Narrower
    // corridor = more visible tree density flanking the route.
    var CORRIDOR_HALF_WIDTH = 1;

    function resolvedIceStyle(pPlan, pContext) {
        var profile = pContext ? pContext.Profile || {} : {};
        var intent = pPlan && pPlan.intent ? pPlan.intent : {};

        // ForcedIceLayoutStyle is only present on the named diagnostic
        // profiles. Normal grammar_ice writes its selected style to
        // GrammarIceLayoutStyle before Concept authoring. Reading only the
        // forced knob silently collapsed forest-route, maze, tree-blob and
        // neck selections back to ice_forest_route.
        return String(
            profile.ForcedIceLayoutStyle ||
            profile.GrammarIceLayoutStyle ||
            (intent.iceLayout ? intent.iceLayout.name : "") ||
            (intent.guardrails ? intent.guardrails.iceLayoutStyle : "") ||
            "ice_forest_route"
        );
    }

    function authorIceForestCorridor(pPlan, pIntentMap, pRngs, pContext) {
        var W = pIntentMap.width;
        var H = pIntentMap.height;
        var profile = pContext ? pContext.Profile || {} : {};
        var style = resolvedIceStyle(pPlan, pContext);
        var isMaze = style === "ice_tree_maze";
        var isBlob = style === "ice_tree_blob";
        var isNeck = style === "ice_neck_route";

        if(W < (PERIMETER_MARGIN * 2 + 12) || H < (PERIMETER_MARGIN * 2 + 8)) {
            return pIntent.AuthorResult.Fail(
                pIntent.AuthorReason.InsufficientOpenArea,
                [pIntent.AuthorResult.Diagnostic(
                    "ice_forest_corridor.author",
                    "IntentMap too small: " + W + "x" + H
                )]
            );
        }

        var interiorMinX = PERIMETER_MARGIN;
        var interiorMaxX = W - 1 - PERIMETER_MARGIN;
        var interiorMinY = PERIMETER_MARGIN;
        var interiorMaxY = H - 1 - PERIMETER_MARGIN;
        var midY = Math.floor((interiorMinY + interiorMaxY) / 2);
        var interiorHeight = interiorMaxY - interiorMinY;

        var terrainRng = (pRngs && pRngs.terrain) || pRngs;
        var routeRng = (pRngs && pRngs.route) || pRngs;
        var decorRng = (pRngs && pRngs.decor) || pRngs;

        // P4.1 variety: per-seed forest density target. Higher density = denser
        // tree cover, sparser tactical pockets. Bumped to 0.78-0.95 because
        // the renderer's IceTree prune passes ([[ice_forest_render_ratio]])
        // discard ~70% of stamped forest cells; we need this much to land
        // visually-distinct dense forest masses.
        var forestDensity = V ? V.PerSeedRange(terrainRng, 0.78, 0.95) : 0.85;

        // P4.1 variety: per-seed spawn anchor jitter so the start/objective
        // aren't always at the exact corner.
        var spawnYJitter = V ? V.PerSeedInt(terrainRng, -2, 2) : 0;
        var objYJitter = V ? V.PerSeedInt(terrainRng, -2, 2) : 0;

        var routeFrameChoices;
        if(isMaze) {
            // Original ice/jungle mazes read as diagonal cuts through a
            // mostly solid canopy, not the same horizontal belt every seed.
            routeFrameChoices = ["rising", "falling"];
        } else if(isBlob) {
            routeFrameChoices = ["upper_sweep", "lower_sweep", "rising", "falling"];
        } else if(isNeck) {
            routeFrameChoices = ["upper_sweep", "lower_sweep", "rising", "falling"];
        } else {
            routeFrameChoices = ["central", "upper_sweep", "lower_sweep", "rising", "falling"];
        }
        var routeFrame = routeFrameChoices[V ?
            V.PerSeedInt(routeRng, 0, routeFrameChoices.length - 1) : 0];
        var upperY = interiorMinY + Math.max(4, Math.round(interiorHeight * 0.27));
        var lowerY = interiorMaxY - Math.max(4, Math.round(interiorHeight * 0.27));
        var frameStartY = midY;
        var frameEndY = midY;
        if(routeFrame === "upper_sweep") {
            frameStartY = upperY;
            frameEndY = upperY + Math.max(2, Math.round(interiorHeight * 0.10));
        } else if(routeFrame === "lower_sweep") {
            frameStartY = lowerY;
            frameEndY = lowerY - Math.max(2, Math.round(interiorHeight * 0.10));
        } else if(routeFrame === "rising") {
            frameStartY = lowerY;
            frameEndY = upperY;
        } else if(routeFrame === "falling") {
            frameStartY = upperY;
            frameEndY = lowerY;
        }

        var rawStartX = interiorMinX + SPAWN_HALO;
        var rawStartY = frameStartY + spawnYJitter;
        var rawEndX = interiorMaxX - SPAWN_HALO;
        var rawEndY = frameEndY + objYJitter;
        // SnapToLand walks outward from the proposed anchor until we find a
        // LAND cell — needed when the continent carved water near our
        // intended spawn/objective position.
        var startPt = (V && V.SnapToLand)
            ? V.SnapToLand(pIntentMap, rawStartX, rawStartY)
            : { x: rawStartX, y: rawStartY };
        var endPt = (V && V.SnapToLand)
            ? V.SnapToLand(pIntentMap, rawEndX, rawEndY)
            : { x: rawEndX, y: rawEndY };
        var startX = startPt.x;
        var startY = startPt.y;
        var endX = endPt.x;
        var endY = endPt.y;

        // 0. P3f.5 continent shape (port of v1 Layout/Continent.Build).
        //    Per-seed pick island/edge/rectangle, frontier-walk an organic
        //    land mass, leave the rest as water. Stamps BEFORE anchors are
        //    set so the route is reserved post-continent (anchor placement
        //    snaps to land).
        if(V && V.StampContinent) {
            var continentOption = (isMaze || isNeck) ?
                V.ContinentOptionForStyle(profile, "mainland", 1.0) :
                V.SelectContinentOption(profile, terrainRng, [
                    { name: "island", weight: 0.40 },
                    { name: "edge", weight: 0.25 },
                    { name: "rectangle", weight: 0.35 }
                ]);
            var continentResult = V.StampContinent(
                pIntentMap, continentOption, terrainRng);
            if(pContext) {
                pContext.Continent = continentResult;
                pContext.IntentStyleContract = pContext.IntentStyleContract || {};
                pContext.IntentStyleContract.style = style;
                pContext.IntentStyleContract.routeFrame = routeFrame;
                pContext.IntentStyleContract.continent = continentResult;
            }

            // The initial proposals were calculated before continent carving.
            // Re-snap afterward so edge/rectangle variants cannot leave the
            // route anchors pointing at cells that have just become water.
            if(V.SnapToLand) {
                startPt = V.SnapToLand(pIntentMap, rawStartX, rawStartY);
                endPt = V.SnapToLand(pIntentMap, rawEndX, rawEndY);
                startX = startPt.x;
                startY = startPt.y;
                endX = endPt.x;
                endY = endPt.y;
            }
        }

        // Reserve the actual route before growing forest. The old version
        // always protected a straight horizontal belt, then overlaid an
        // S/zigzag later; neck maps therefore still read as broad straight
        // corridors regardless of their visible route shape.
        var routeShape = V ? V.PickRouteShape(routeRng) : "straight";
        if(isMaze)
            routeShape = "zigzag";
        else if(isBlob && routeShape === "straight")
            routeShape = "s_curve";
        else if(isNeck && routeShape === "straight")
            routeShape = "s_curve";
        var corridorCells = V ? V.StampRouteByShape(
            pIntentMap, routeShape,
            startX, startY, endX, endY,
            CORRIDOR_HALF_WIDTH, routeRng
        ) : 0;

        // 0.5. P3d.5 water: per-seed lake using the selected style's
        //     LakeChance + per-seed coast (35% chance). Stamped BEFORE
        //     forest so forest density bernoulli won't overlap water cells
        //     (water is BLOCKED → already excluded from "no protected" check).
        //     Lake position is in one of the forest bands (above or below
        //     corridor) so it doesn't break the route.
        if(V && !isMaze && !isNeck) {
            var lakeRoll = decorRng && decorRng.Float ? decorRng.Float(0, 1) : 0.5;
            var lakeChance = typeof profile.LakeChance === "number" ?
                profile.LakeChance : 0.58;
            if(lakeRoll < lakeChance) {
                var lakeRadius = typeof profile.LakeRadius === "number" ?
                    Math.max(2, Math.floor(profile.LakeRadius)) :
                    V.PerSeedInt(decorRng, 4, 6);
                var lakeBandTop = decorRng && decorRng.Float ? decorRng.Float(0, 1) < 0.5 : true;
                var lakeCx = V.PerSeedInt(decorRng,
                    interiorMinX + lakeRadius + 4,
                    interiorMaxX - lakeRadius - 4);
                var lakeCy = lakeBandTop
                    ? V.PerSeedInt(decorRng, interiorMinY + lakeRadius + 1,
                        midY - 4 - lakeRadius)
                    : V.PerSeedInt(decorRng, midY + 4 + lakeRadius,
                        interiorMaxY - lakeRadius - 1);
                if(lakeCy >= interiorMinY + lakeRadius && lakeCy <= interiorMaxY - lakeRadius) {
                    V.StampLake(pIntentMap, lakeCx, lakeCy, lakeRadius, decorRng);
                }
            }
            var coastRoll = decorRng && decorRng.Float ? decorRng.Float(0, 1) : 0.5;
            var coastChance = typeof profile.CoastChance === "number" ?
                profile.CoastChance : 0.35;
            if(coastRoll < coastChance) {
                // Coast on north or south edge (not east/west — those are
                // where spawn/objective live).
                var coastEdge = (decorRng && decorRng.Float && decorRng.Float(0, 1) < 0.5)
                    ? "north" : "south";
                var coastWidth = V.PerSeedInt(decorRng, 3, 6);
                V.StampCoast(pIntentMap, coastEdge, coastWidth, 1, decorRng);
            }
        }

        // 1. P3f.1 organic forest via cellular automata. Bernoulli per-cell
        //    fill produces scattered noise that v1's tree-prune passes
        //    shred to scattered dots. CA converges from random seed to
        //    organic blob shapes that survive prune (no thin spurs, no
        //    singletons). Dramatic visual improvement vs bernoulli.
        var corridorMinY = midY - CORRIDOR_HALF_WIDTH;
        var corridorMaxY = midY + CORRIDOR_HALF_WIDTH;

        function routeYAtColumn(pX, pFallback) {
            var totalY = 0;
            var found = 0;
            for(var scanRouteY = interiorMinY; scanRouteY <= interiorMaxY; ++scanRouteY) {
                var routeIndex = (scanRouteY * W) + pX;
                if(pIntentMap.movement[routeIndex] & M.ROUTE_PRIMARY) {
                    totalY += scanRouteY;
                    ++found;
                }
            }
            return found ? Math.round(totalY / found) : pFallback;
        }

        // Three smoothing passes retain substantial canopy masses. Forest
        // routes materialize this mask directly within their 34% cover budget;
        // mazes and necks need denser walls and retain their own fill policy.
        var caSeedDensity = 0.68 + (forestDensity - 0.78) * 0.50;
        if(style === "ice_forest_route") caSeedDensity = 0.46;
        if(isMaze) caSeedDensity = 0.82;
        if(isNeck) caSeedDensity = 0.68;
        var forestCells = V ? V.StampForestCellularAutomata(pIntentMap, {
            minX: interiorMinX, maxX: interiorMaxX,
            minY: interiorMinY, maxY: interiorMaxY
        }, {
            iterations: 3,
            seedDensity: caSeedDensity
        }, decorRng) : 0;
        var openPocketCells = 0; // CA produces this naturally (cells that
                                 // converge to 0 are open pockets).

        // A shipped-style maze is forest first: thin diagonal routes and dead
        // ends are cut out of a continuous canopy. The generic CA author left
        // large open fields, which made "maze" merely a mildly wooded route.
        if(isMaze) {
            for(var fillY = interiorMinY; fillY <= interiorMaxY; ++fillY) {
                for(var fillX = interiorMinX; fillX <= interiorMaxX; ++fillX) {
                    var fillIndex = (fillY * W) + fillX;
                    if(pIntentMap.movement[fillIndex] &
                        (M.ROUTE_PRIMARY | M.ROUTE_SECONDARY | M.CROSSING |
                         M.BRIDGE | M.KEEP_CLEAR)) continue;
                    if(pIntentMap.claim[fillIndex] &
                        (C.SPAWN_SAFE | C.STRUCT_WALL | C.STRUCT_FLOOR |
                         C.OBJECTIVE)) continue;
                    if(pIntentMap.terrain[fillIndex] !== T.FOREST)
                        ++forestCells;
                    pIntent.Map.SetTerrain(pIntentMap, fillX, fillY, T.FOREST);
                    pIntent.Map.AddMovement(pIntentMap, fillX, fillY, M.BLOCKED);
                    pIntent.Map.SetOwner(pIntentMap, fillX, fillY, O.TREE);
                }
            }
        }

        // Cut several narrow, diagonal dead-end branches after the forest fill.
        // They connect to the primary route but terminate inside the canopy.
        var mazeDeadEnds = 0;
        if(isMaze && V) {
            var deadEndCount = V.PerSeedInt(decorRng, 4, 7);
            for(var de = 0; de < deadEndCount; ++de) {
                var branchX = Math.floor(startX +
                    ((de + 1) / (deadEndCount + 1)) * (endX - startX));
                var branchY = midY;
                var bestDistance = H + 1;
                for(var scanY = interiorMinY; scanY <= interiorMaxY; ++scanY) {
                    var scanIndex = (scanY * W) + branchX;
                    if(pIntentMap.movement[scanIndex] & M.ROUTE_PRIMARY) {
                        var distance = Math.abs(scanY - midY);
                        if(distance < bestDistance) {
                            bestDistance = distance;
                            branchY = scanY;
                        }
                    }
                }
                var towardTop = (de % 2) === 0;
                var targetY = towardTop ?
                    V.PerSeedInt(decorRng, interiorMinY + 3,
                        Math.max(interiorMinY + 3, midY - 7)) :
                    V.PerSeedInt(decorRng, Math.min(interiorMaxY - 3, midY + 7),
                        interiorMaxY - 3);
                var targetX = Math.max(interiorMinX + 3,
                    Math.min(interiorMaxX - 3,
                        branchX + V.PerSeedInt(decorRng, -8, 8)));
                var branchShape = (de % 3 === 0) ? "s_curve" : "zigzag";
                V.StampRouteByShape(pIntentMap, branchShape,
                    branchX, branchY, targetX, targetY,
                    de % 3 === 0 ? 1 : 0, decorRng);
                ++mazeDeadEnds;
            }
        }

        // 2/3. The selected corridor was stamped before CA so it remains the
        // only main route cut through the forest.

        // 3.5 P3d.1 defensive lines: 1-2 vertical bands crossing the corridor
        //     midway. Player encounters them as chokepoints — walls of forest
        //     cells perpendicular to the route, with a 1-cell gap to squeeze
        //     through. Mirrors v1 grammar_ice's DefensiveLineChance=1.0
        //     DefensiveLineCount=[1,2].
        var neckGates = 0;
        var neckGateRecords = [];
        if(V && V.StampDefensiveLine) {
            var lineCount = isNeck ? V.PerSeedInt(decorRng, 4, 6) :
                (isMaze ? 0 : V.PerSeedInt(decorRng, 1, 2));
            for(var lIdx = 0; lIdx < lineCount; ++lIdx) {
                // Place at fraction 0.30-0.70 of route. If two, space them.
                var fraction;
                if(lineCount === 2) {
                    fraction = (lIdx === 0) ? V.PerSeedRange(decorRng, 0.30, 0.45)
                                             : V.PerSeedRange(decorRng, 0.55, 0.70);
                } else if(isNeck) {
                    // Spread necks across the whole journey.  Independent
                    // 0.35..0.65 rolls clustered all of them around the map
                    // centre, leaving most XL maps as unused open terrain.
                    fraction = ((lIdx + 1) / (lineCount + 1)) +
                        V.PerSeedRange(decorRng, -0.025, 0.025);
                } else {
                    fraction = V.PerSeedRange(decorRng, 0.35, 0.65);
                }
                var lineX = Math.floor(startX + fraction * (endX - startX));
                if(lineX < interiorMinX + 3) { lineX = interiorMinX + 3; }
                if(lineX > interiorMaxX - 3) { lineX = interiorMaxX - 3; }
                // Gap at midY (so the route still passes through). Half-gap
                // 1 = 3-cell pass-through (matches the corridor width).
                var lineThickness = isNeck ? V.PerSeedInt(decorRng, 3, 5) :
                    V.PerSeedInt(decorRng, 2, 3);
                var lineCells = V.StampDefensiveLine(pIntentMap, {
                    axis: "vertical",
                    columnX: lineX,
                    yStart: interiorMinY + 1,
                    yEnd: interiorMaxY - 1,
                    gapAt: routeYAtColumn(lineX, midY + spawnYJitter),
                    halfGap: 1,
                    thickness: lineThickness
                }, decorRng);
                if(isNeck) {
                    ++neckGates;
                    neckGateRecords.push({
                        x: lineX,
                        thickness: lineThickness,
                        cells: lineCells,
                        yStart: interiorMinY + 1,
                        yEnd: interiorMaxY - 1
                    });
                }
            }
        }

        if(pContext && isNeck) {
            pContext.IntentStyleContract = pContext.IntentStyleContract || {};
            pContext.IntentStyleContract.gates = neckGateRecords;
        }

        // 4. P4.1 variety: scatter outcrop clusters in the forest bands +
        //    P3f.4 outcrops on the route shoulder (1-2 cells perpendicular
        //    to the corridor, where the player walks past them).
        var outcropCount = V ? V.PerSeedInt(decorRng, 4, 7) : 5;
        if(V) {
            // Route-shoulder outcrops (the new ones — visible to walking
            // player). Place in a 4-cell-deep band immediately above + below
            // the corridor band. ScatterOutcrops skips KEEP_CLEAR cells so
            // the corridor itself is safe.
            V.ScatterOutcrops(pIntentMap, {
                minX: interiorMinX + SPAWN_HALO + 4,
                maxX: interiorMaxX - SPAWN_HALO - 4,
                minY: corridorMinY - 4, maxY: corridorMinY - 1
            }, V.PerSeedInt(decorRng, 2, 3), decorRng);
            V.ScatterOutcrops(pIntentMap, {
                minX: interiorMinX + SPAWN_HALO + 4,
                maxX: interiorMaxX - SPAWN_HALO - 4,
                minY: corridorMaxY + 1, maxY: corridorMaxY + 4
            }, V.PerSeedInt(decorRng, 2, 3), decorRng);
            // Far-band outcrops (existing) — visible at periphery
            V.ScatterOutcrops(pIntentMap, {
                minX: interiorMinX + 2, maxX: interiorMaxX - 2,
                minY: interiorMinY + 1, maxY: corridorMinY - 5
            }, Math.ceil(outcropCount / 2), decorRng);
            V.ScatterOutcrops(pIntentMap, {
                minX: interiorMinX + 2, maxX: interiorMaxX - 2,
                minY: corridorMaxY + 5, maxY: interiorMaxY - 1
            }, Math.floor(outcropCount / 2), decorRng);
        }

        // 5. P4.1 variety: 2-5 tactical clearings inside the forest bands —
        //    "ambush pockets" the player can engage from. More clearings now
        //    that forest density is high (clearings cut visible breaks in
        //    the dense forest).
        var clearingCount = V ? V.PerSeedInt(decorRng, 2, 5) : 3;
        var clearings = [];
        for(var k = 0; k < clearingCount && V; ++k) {
            // Alternate north/south
            var cKx = V.PerSeedInt(decorRng,
                interiorMinX + 8, interiorMaxX - 8);
            var cKy = (k % 2 === 0)
                ? V.PerSeedInt(decorRng, interiorMinY + 2, corridorMinY - 3)
                : V.PerSeedInt(decorRng, corridorMaxY + 3, interiorMaxY - 2);
            var cKr = V.PerSeedInt(decorRng, 2, 3);
            var cleared = V.StampClearing(pIntentMap, cKx, cKy, cKr);
            if(cleared > 0) {
                clearings.push({ x: cKx, y: cKy, r: cKr });
            }
        }

        // 6. Spawn pads (start + objective). Anchor cell carries OWNER + claim.
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
        stampAnchor(startX, startY, O.PLAYER_SPAWN, C.SPAWN_SAFE);
        stampAnchor(endX, endY, O.STRUCTURE, C.SPAWN_SAFE);

        var totalCells = corridorCells + forestCells + openPocketCells;
        var actualForestFraction = totalCells > 0 ?
            (forestCells / totalCells) : 0;

        pIntentMap.regions = pIntentMap.regions || [];
        pIntentMap.regions.push({
            id: "forest_corridor.corridor",
            kind: "route", cells: corridorCells, shape: routeShape
        });
        if(isMaze) {
            pIntentMap.regions.push({
                id: "forest_corridor.maze_dead_ends",
                kind: "maze_dead_ends", count: mazeDeadEnds
            });
        }
        if(isNeck) {
            pIntentMap.regions.push({
                id: "forest_corridor.neck_gates",
                kind: "neck_gates", count: neckGates
            });
        }
        pIntentMap.regions.push({
            id: "forest_corridor.forest",
            kind: "forest", cells: forestCells,
            forestFraction: actualForestFraction,
            targetDensity: forestDensity
        });
        for(var ci = 0; ci < clearings.length; ++ci) {
            pIntentMap.regions.push({
                id: "forest_corridor.pocket_" + ci,
                kind: "tactical_pocket",
                at: { x: clearings[ci].x, y: clearings[ci].y },
                radius: clearings[ci].r
            });
        }

        pIntentMap.anchors = pIntentMap.anchors || {};
        pIntentMap.anchors.start     = { x: startX, y: startY };
        pIntentMap.anchors.objective = { x: endX,   y: endY };

        return pIntent.AuthorResult.Ok([
            pIntent.AuthorResult.Diagnostic(
                "ice_forest_corridor.author",
                "shape=" + routeShape +
                " frame=" + routeFrame +
                " style=" + style +
                " density=" + forestDensity.toFixed(2) +
                " forest=" + forestCells +
                " openPockets=" + openPocketCells +
                " outcrops=" + outcropCount +
                " clearings=" + clearings.length
            )
        ]);
    }

    if(pIntent.RegisterConcept) {
        pIntent.RegisterConcept({
            id: "ice_forest_corridor",
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
                return style === "ice_forest_route" ||
                    style === "ice_tree_maze" ||
                    style === "ice_tree_blob" ||
                    style === "ice_neck_route";
            },
            author: authorIceForestCorridor,
            intentHardValidators: [
                {
                    id: "forest_density_floor",
                    fn: function(pContext, pIntentMap) {
                        // Forest density floor relaxed to 0.15 (was 0.25) to
                        // accommodate per-seed density variation 0.45–0.85
                        // multiplied by the cells outside the corridor band
                        // and minus tactical clearings.
                        var Tlocal = pIntent.Terrain;
                        var W = pIntentMap.width;
                        var H = pIntentMap.height;
                        var forest = 0;
                        var interior = 0;
                        for(var y = PERIMETER_MARGIN; y <= H - 1 - PERIMETER_MARGIN; ++y) {
                            for(var x = PERIMETER_MARGIN; x <= W - 1 - PERIMETER_MARGIN; ++x) {
                                ++interior;
                                if(pIntentMap.terrain[(y * W) + x] === Tlocal.FOREST) {
                                    ++forest;
                                }
                            }
                        }
                        var f = interior > 0 ? (forest / interior) : 0;
                        var style = resolvedIceStyle(pContext.GrammarPlan, pContext);
                        var floor = style === "ice_tree_maze" ? 0.62 :
                            (style === "ice_neck_route" ? 0.42 : 0.15);
                        if(f < floor) {
                            return { ok: false,
                                reason: "intent_hard:forest_density_below_floor:" +
                                    f.toFixed(3) + "/" + floor.toFixed(3) };
                        }
                        return { ok: true };
                    }
                },
                {
                    id: "named_style_contract",
                    fn: function(pContext, pIntentMap) {
                        var style = resolvedIceStyle(pContext.GrammarPlan, pContext);
                        var regions = pIntentMap.regions || [];
                        var kind = style === "ice_tree_maze" ? "maze_dead_ends" :
                            (style === "ice_neck_route" ? "neck_gates" : "");
                        if(!kind) return { ok: true };
                        var minimum = kind === "maze_dead_ends" ? 4 : 4;
                        for(var i = 0; i < regions.length; ++i) {
                            if(regions[i] && regions[i].kind === kind &&
                                Number(regions[i].count || 0) >= minimum)
                                return { ok: true };
                        }
                        return { ok: false, reason: "intent_hard:" + kind +
                            "_below_floor" };
                    }
                }
            ],
            intentQualityValidators: [],
            renderedHardValidators: [
                {
                    id: "named_forest_style_survives_render",
                    fn: function(pContext, pIntentMap, pRenderedMap) {
                        var style = resolvedIceStyle(pContext.GrammarPlan, pContext);
                        if(style !== "ice_tree_maze" && style !== "ice_neck_route")
                            return { ok: true };

                        var counts = pRenderedMap ? pRenderedMap.Counts || {} : {};
                        var area = Math.max(1, pIntentMap.width * pIntentMap.height);
                        var waterFraction = Number(counts.water || 0) / area;
                        if(waterFraction > 0.025) {
                            return { ok: false, reason:
                                "rendered_named_forest_water_too_high:" +
                                waterFraction.toFixed(3) + "/0.025" };
                        }

                        if(style === "ice_neck_route") {
                            var contract = pContext.IntentStyleContract || {};
                            var gates = contract.gates || [];
                            var surviving = 0;
                            for(var g = 0; g < gates.length; ++g) {
                                var gate = gates[g];
                                var treeCells = 0;
                                var tested = 0;
                                for(var gx = gate.x;
                                    gx < gate.x + gate.thickness; ++gx) {
                                    for(var gy = gate.yStart; gy <= gate.yEnd; ++gy) {
                                        var ii = (gy * pIntentMap.width) + gx;
                                        if(pIntentMap.movement[ii] &
                                            (M.ROUTE_PRIMARY | M.ROUTE_SECONDARY |
                                             M.KEEP_CLEAR)) continue;
                                        ++tested;
                                        if(MapGen.Metrics && MapGen.Metrics.IsTreeBlocked &&
                                            MapGen.Metrics.IsTreeBlocked(pContext, gx, gy))
                                            ++treeCells;
                                    }
                                }
                                if(tested > 0 && (treeCells / tested) >= 0.55)
                                    ++surviving;
                            }
                            if(surviving < 4) {
                                return { ok: false, reason:
                                    "rendered_neck_gates_too_low:" + surviving + "/4" };
                            }
                        }
                        return { ok: true };
                    }
                }
            ],
            driftBudget: {
                landIntentSolidMaxFraction: 0.20,
                forestPruneRatioMax: 0.55
            },
            finaliseConcept: function(pContext, pIntentMap, pRenderedMap) { return 0; }
        });
    }

    pIntent.Concepts.IceForestCorridor = {
        author: authorIceForestCorridor
    };

})(MapGen.Intent);
