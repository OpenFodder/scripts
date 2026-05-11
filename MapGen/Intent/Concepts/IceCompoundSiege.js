var MapGen = MapGen || {};
MapGen.Intent = MapGen.Intent || {};
MapGen.Intent.Concepts = MapGen.Intent.Concepts || {};

// MapGen.Intent.Concepts.IceCompoundSiege — Phase 4 P4.2 with variety.
//
// Per OpenFodder_Map_Generator_Rewrite_Design_v3.4.md §9.1:
//   "Large compound, perimeter approach, defensive cover."
//
// Phase 5 P5.2: dropped STRUCT_WALL stamping entirely — v1 has no wall-only
// art (only BUILDINGS: bunker/hut/barracks). The compound is now a
// "destination clearing" with role=objective that v1's PlaceCampaignBuildings
// finds and stamps a real bunker inside (using shipped 4×4 tile sets from
// Common/Structures/Bunker.js).
//
// Phase 4 variety pass:
//   - Per-seed compound clearing size 10×6 to 16×10
//   - Per-seed compound position (north / center / south jitter)
//   - CA-shaped forest cover around the compound approach and clearing
//   - Per-seed approach route shape (straight / s-curve / zigzag)
//   - 1-2 defensive forest bands across the approach
//   - 2-4 outcrop clusters between spawn and compound
//   - 1-2 tactical clearings ("ambush pockets") flanking the route
//   - Spawn anchor jitter ±2 cells

(function(pIntent) {

    var T = pIntent.Terrain;
    var M = pIntent.Movement;
    var C = pIntent.Claim;
    var O = pIntent.Owner;
    var V = pIntent.Variety;

    var PERIMETER_MARGIN = 5;
    var SPAWN_HALO = 2;

    function authorIceCompoundSiege(pPlan, pIntentMap, pRngs, pContext) {
        var W = pIntentMap.width;
        var H = pIntentMap.height;
        var profile = pContext ? pContext.Profile || {} : {};

        // Per-seed compound size + position. Compound footprint must fit
        // east of the spawn pad with margin for perimeter cover.
        var terrainRng = (pRngs && pRngs.terrain) || pRngs;
        var routeRng = (pRngs && pRngs.route) || pRngs;
        var decorRng = (pRngs && pRngs.decor) || pRngs;
        var structRng = (pRngs && pRngs.structures) || pRngs;

        var compoundW = V ? V.PerSeedInt(structRng, 10, 16) : 12;
        var compoundH = V ? V.PerSeedInt(structRng, 6, 10) : 8;

        if(W < (PERIMETER_MARGIN * 2 + compoundW + 16) ||
           H < (PERIMETER_MARGIN * 2 + compoundH + 6)) {
            return pIntent.AuthorResult.Fail(
                pIntent.AuthorReason.InsufficientOpenArea,
                [pIntent.AuthorResult.Diagnostic(
                    "ice_compound_siege.author",
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
        var mapArea = W * H;

        // A siege mission must use both map axes. The old author kept start
        // and objective within five rows of the centre regardless of size;
        // structures then formed a horizontal band across XL snowfields.
        // Give every map a rising or falling campaign frame and scale its
        // vertical reach with the available height.
        var missionDirection = V && V.PerSeedInt(routeRng, 0, 1) ? 1 : -1;
        var missionVerticalSpan = Math.max(10, Math.round(
            interiorHeight * (mapArea >= 10000 ? 0.36 :
                (mapArea >= 6000 ? 0.32 : 0.28))
        ));
        var missionHalfSpan = Math.max(5,
            Math.floor(missionVerticalSpan / 2));
        var compoundCenterY = midY + (missionDirection * missionHalfSpan) +
            (V ? V.PerSeedInt(structRng, -2, 2) : 0);
        var compoundCenterMin = interiorMinY +
            Math.ceil(compoundH / 2) + 1;
        var compoundCenterMax = interiorMaxY -
            Math.ceil(compoundH / 2) - 1;
        if(compoundCenterY < compoundCenterMin)
            compoundCenterY = compoundCenterMin;
        if(compoundCenterY > compoundCenterMax)
            compoundCenterY = compoundCenterMax;

        // 0. P3f.5 continent shape: organic land mass with water surrounding.
        if(V && V.StampContinent) {
            var continentOption = V.SelectContinentOption(profile, terrainRng, [
                { name: "island", weight: 0.40 },
                { name: "edge", weight: 0.25 },
                { name: "rectangle", weight: 0.35 }
            ]);
            V.StampContinent(pIntentMap, continentOption, terrainRng);
        }

        // 0.5. P3d.5 water: profile-selected lake chance + coast (35%).
        //     Stamped BEFORE the interior reserve so water cells stay
        //     water (interior reserve only sets WALKABLE on land cells).
        if(V) {
            var lakeRoll = decorRng && decorRng.Float ? decorRng.Float(0, 1) : 0.5;
            var lakeChance = typeof profile.LakeChance === "number" ?
                profile.LakeChance : 0.58;
            // An XL siege map needs at least one interior terrain decision.
            // A perimeter coast alone does not shape the journey and produced
            // a vast featureless snowfield. Keep smaller maps probabilistic,
            // but guarantee one scale-appropriate inland lake on XL.
            if(mapArea >= 10000)
                lakeChance = 1.0;
            else if(mapArea >= 6000)
                lakeChance = Math.max(lakeChance, 0.35);
            if(lakeRoll < lakeChance) {
                var lakeRadius = typeof profile.LakeRadius === "number" ?
                    Math.max(2, Math.floor(profile.LakeRadius)) :
                    V.PerSeedInt(decorRng,
                        mapArea >= 10000 ? 7 : (mapArea >= 6000 ? 5 : 4),
                        mapArea >= 10000 ? 11 : (mapArea >= 6000 ? 8 : 6));
                // Keep the lake in a north/south approach-side pocket. A
                // centre-band lake was routinely cut in half when the route
                // was authored immediately afterward.
                var lakeCx = V.PerSeedInt(decorRng,
                    interiorMinX + lakeRadius + 4,
                    interiorMinX + Math.floor((interiorMaxX - interiorMinX) * 0.50));
                var lakeOnTop = decorRng && decorRng.Float ?
                    decorRng.Float(0, 1) < 0.5 : true;
                var lakeMinY = lakeOnTop ?
                    interiorMinY + lakeRadius + 2 :
                    midY + lakeRadius + 4;
                var lakeMaxY = lakeOnTop ?
                    midY - lakeRadius - 4 :
                    interiorMaxY - lakeRadius - 2;
                if(lakeMaxY < lakeMinY) {
                    lakeMinY = interiorMinY + lakeRadius + 2;
                    lakeMaxY = interiorMaxY - lakeRadius - 2;
                }
                var lakeCy = V.PerSeedInt(decorRng, lakeMinY, lakeMaxY);
                V.StampLake(pIntentMap, lakeCx, lakeCy, lakeRadius, decorRng);
            }
            var coastRoll = decorRng && decorRng.Float ? decorRng.Float(0, 1) : 0.5;
            if(coastRoll < 0.35) {
                var coastEdge = (decorRng && decorRng.Float && decorRng.Float(0, 1) < 0.5)
                    ? "north" : "south";
                var coastWidth = V.PerSeedInt(decorRng, 3, 6);
                V.StampCoast(pIntentMap, coastEdge, coastWidth, 1, decorRng);
            }
        }

        // 1. Mark dry interior as walkable. Do NOT claim the whole interior
        //    RESERVED: Composite maps that claim to keepClear, which would
        //    forbid Cover.Build from materializing the forest authored below.
        //    Routes, anchors, clearings and the compound reserve themselves.
        for(var iy = interiorMinY; iy <= interiorMaxY; ++iy) {
            for(var ix = interiorMinX; ix <= interiorMaxX; ++ix) {
                var ridx = (iy * W) + ix;
                if(pIntentMap.terrain[ridx] === T.WATER) { continue; }
                pIntent.Map.AddMovement(pIntentMap, ix, iy, M.WALKABLE);
            }
        }

        // 2. Compound clearing footprint on the east half. No walls —
        //    just a kept-clear walkable rectangle that v1's
        //    PlaceCampaignBuildings will find via the "objective" clearing
        //    (Pipeline emits that). v1 stamps a real bunker (4×4 tile set
        //    from Common/Structures/Bunker.js) somewhere in this rectangle.
        //    The dense forest cover stamped in step 6 surrounds the
        //    rectangle, giving the "defensible compound surrounded by
        //    forest" silhouette.
        var compoundInsetX = V ? V.PerSeedInt(structRng, 5, 9) : 6;
        var compoundMinX = interiorMaxX - compoundW - SPAWN_HALO - compoundInsetX;
        var compoundMaxX = compoundMinX + compoundW - 1;
        var compoundMinY = compoundCenterY - Math.floor(compoundH / 2);
        var compoundMaxY = compoundMinY + compoundH - 1;
        if(compoundMinY < interiorMinY + 1) { compoundMinY = interiorMinY + 1; }
        if(compoundMaxY > interiorMaxY - 1) { compoundMaxY = interiorMaxY - 1; }

        var compoundFloorCells = 0;
        for(var cy = compoundMinY; cy <= compoundMaxY; ++cy) {
            for(var cx = compoundMinX; cx <= compoundMaxX; ++cx) {
                // Plain walkable + keepClear so the bunker placer treats
                // this rectangle as a clean clearing.
                pIntent.Map.AddMovement(pIntentMap, cx, cy,
                    M.WALKABLE | M.KEEP_CLEAR);
                pIntent.Map.AddClaim(pIntentMap, cx, cy, C.RESERVED);
                ++compoundFloorCells;
            }
        }

        // 3. (No entrance punch — there's no wall to punch through.)

        // 4. Anchors: spawn west, objective at compound centre. Snap to land
        //    in case the continent carved water under the proposed positions.
        var rawSpawnX = interiorMinX + SPAWN_HALO;
        var rawSpawnY = midY - (missionDirection * missionHalfSpan) +
            (V ? V.PerSeedInt(terrainRng, -2, 2) : 0);
        rawSpawnY = Math.max(interiorMinY + SPAWN_HALO,
            Math.min(interiorMaxY - SPAWN_HALO, rawSpawnY));
        var rawObjX = Math.floor((compoundMinX + compoundMaxX) / 2);
        var rawObjY = Math.floor((compoundMinY + compoundMaxY) / 2);
        var spawnPt = (V && V.SnapToLand)
            ? V.SnapToLand(pIntentMap, rawSpawnX, rawSpawnY)
            : { x: rawSpawnX, y: rawSpawnY };
        var objPt = (V && V.SnapToLand)
            ? V.SnapToLand(pIntentMap, rawObjX, rawObjY)
            : { x: rawObjX, y: rawObjY };
        var spawnX = spawnPt.x;
        var spawnY = spawnPt.y;
        var objX = objPt.x;
        var objY = objPt.y;

        // 5. P4.2 variety: approach route shape (straight / s_curve / zigzag).
        //    Routes spawn -> compound centre directly through forest cover.
        var routeShape = V ? V.PickRouteShape(routeRng) : "straight";
        if(V && routeShape === "straight") {
            routeShape = (routeRng && routeRng.Float && routeRng.Float(0, 1) < 0.5) ?
                "s_curve" : "zigzag";
        }
        if(V) {
            V.StampRouteByShape(pIntentMap, routeShape,
                spawnX, spawnY, objX, objY, 1, routeRng);
        } else {
            for(var rx = spawnX; rx <= objX; ++rx) {
                for(var dy = -1; dy <= 1; ++dy) {
                    var ry = midY + dy;
                    if(ry < interiorMinY || ry > interiorMaxY) { continue; }
                    pIntent.Map.AddMovement(pIntentMap, rx, ry,
                        M.ROUTE_PRIMARY | M.WALKABLE | M.KEEP_CLEAR);
                }
            }
        }

        // 6. Forest cover: use the shared CA primitive so the compound gets
        // chunky cover masses instead of Bernoulli singletons that IceTree
        // pruning removes. The CA helper already protects route/KEEP_CLEAR,
        // water, cliffs, and claims; the predicate below also reserves a
        // spawn halo and a one-cell compound apron.
        var coverDensity = V ? V.PerSeedRange(decorRng, 0.62, 0.72) : 0.67;
        if(mapArea >= 6000)
            coverDensity = Math.min(0.78, coverDensity + 0.04);
        var forestCells = 0;
        function compoundCoverSkip(fx, fy) {
            if(fx >= compoundMinX - 1 && fx <= compoundMaxX + 1 &&
               fy >= compoundMinY - 1 && fy <= compoundMaxY + 1) {
                return true;
            }
            return Math.abs(fx - spawnX) <= SPAWN_HALO + 1 &&
                Math.abs(fy - spawnY) <= SPAWN_HALO + 1;
        }
        if(V && V.StampForestCellularAutomata) {
            forestCells = V.StampForestCellularAutomata(pIntentMap, {
                minX: interiorMinX, maxX: interiorMaxX,
                minY: interiorMinY, maxY: interiorMaxY
            }, {
                iterations: 3,
                seedDensity: coverDensity,
                skipPredicate: compoundCoverSkip
            }, decorRng);
        } else {
            for(var fy = interiorMinY; fy <= interiorMaxY; ++fy) {
                for(var fx = interiorMinX; fx <= interiorMaxX; ++fx) {
                    var idx = (fy * W) + fx;
                    if(compoundCoverSkip(fx, fy)) { continue; }
                    if(pIntentMap.claim[idx] & (C.SPAWN_SAFE | C.OBJECTIVE)) { continue; }
                    if(pIntentMap.movement[idx] & (M.ROUTE_PRIMARY | M.ROUTE_SECONDARY |
                                                    M.CROSSING | M.BRIDGE | M.KEEP_CLEAR)) { continue; }
                    var rand = decorRng && decorRng.Float ?
                        decorRng.Float(0, 1) : 0.5;
                    if(rand < coverDensity) {
                        pIntent.Map.SetTerrain(pIntentMap, fx, fy, T.FOREST);
                        pIntent.Map.AddMovement(pIntentMap, fx, fy, M.BLOCKED);
                        pIntent.Map.SetOwner(pIntentMap, fx, fy, O.TREE);
                        ++forestCells;
                    }
                }
            }
        }

        // 6.5. Defensive bands across the approach. They are authored after
        // CA so the line remains readable, while route/KEEP_CLEAR cells keep
        // the real path open.
        var defensiveLines = 0;
        function routeGapYAt(columnX) {
            var bestY = midY;
            var bestDist = H + 1;
            for(var gy = interiorMinY; gy <= interiorMaxY; ++gy) {
                var gi = (gy * W) + columnX;
                if(pIntentMap.movement[gi] & M.ROUTE_PRIMARY) {
                    var dist = Math.abs(gy - midY);
                    if(dist < bestDist) {
                        bestDist = dist;
                        bestY = gy;
                    }
                }
            }
            return bestY;
        }
        if(V && V.StampDefensiveLine) {
            var lineCount = V.PerSeedInt(decorRng, 2, 3);
            for(var dl = 0; dl < lineCount; ++dl) {
                var fraction = (dl + 1) / (lineCount + 1);
                fraction += V.PerSeedRange(decorRng, -0.06, 0.06);
                var lineX = Math.floor(spawnX + fraction * (compoundMinX - spawnX));
                if(lineX < spawnX + SPAWN_HALO + 4) { lineX = spawnX + SPAWN_HALO + 4; }
                if(lineX > compoundMinX - 4) { lineX = compoundMinX - 4; }
                defensiveLines += V.StampDefensiveLine(pIntentMap, {
                    axis: "vertical",
                    columnX: lineX,
                    yStart: interiorMinY + 1,
                    yEnd: interiorMaxY - 1,
                    gapAt: routeGapYAt(lineX),
                    halfGap: 1,
                    thickness: V.PerSeedInt(decorRng, 2, 3)
                }, decorRng);
            }
        }

        // 6.75. Route-side thickets. The CA forest often collapses into one
        // perimeter mass, leaving the route's middle third as a flat snow
        // runway. Add clustered shoulder cover at fixed fractions along the
        // approach so every siege map has readable tactical beats.
        var routePocketClusters = 0;
        var routePocketCells = 0;
        if(V && V.StampOutcropCluster) {
            var pocketCount = mapArea >= 10000 ?
                V.PerSeedInt(decorRng, 8, 11) :
                (mapArea >= 6000 ? V.PerSeedInt(decorRng, 6, 8) :
                    V.PerSeedInt(decorRng, 4, 6));
            var pocketMinX = spawnX + SPAWN_HALO + 5;
            var pocketMaxX = compoundMinX - 5;
            for(var pc = 0; pc < pocketCount; ++pc) {
                if(pocketMaxX <= pocketMinX) { break; }
                var pocketFraction = (pc + 1) / (pocketCount + 1);
                var pocketX = Math.floor(pocketMinX + pocketFraction * (pocketMaxX - pocketMinX));
                pocketX += V.PerSeedInt(decorRng, -2, 2);
                if(pocketX < pocketMinX) { pocketX = pocketMinX; }
                if(pocketX > pocketMaxX) { pocketX = pocketMaxX; }

                var routeY = routeGapYAt(pocketX);
                var side = (pc % 2 === 0) ? -1 : 1;
                if(decorRng && decorRng.Float && decorRng.Float(0, 1) < 0.35) {
                    side = -side;
                }
                var offset = V.PerSeedInt(decorRng, 4, 7) * side;
                var pocketY = routeY + offset;
                if(pocketY < interiorMinY + 2) { pocketY = interiorMinY + 2; }
                if(pocketY > interiorMaxY - 2) { pocketY = interiorMaxY - 2; }

                var pocketSize = V.PerSeedInt(decorRng, 5, 7);
                var pocketCells = V.StampOutcropCluster(
                    pIntentMap, pocketX, pocketY, pocketSize, decorRng);
                if(pocketCells > 0) {
                    ++routePocketClusters;
                    routePocketCells += pocketCells;
                }
            }
        }

        // 7. P4.2 + P3f.4: outcrops along the approach route shoulders so
        //    the player encounters them as tactical cover walking toward
        //    the compound. Total 4-7 outcrops between spawn and compound.
        var outcropCount = V ? V.PerSeedInt(decorRng, 6, 9) : 7;
        if(V) {
            // Route shoulder (3 cells perpendicular to midY route line)
            V.ScatterOutcrops(pIntentMap, {
                minX: spawnX + SPAWN_HALO + 4,
                maxX: compoundMinX - 4,
                minY: midY - 4, maxY: midY - 1
            }, Math.ceil(outcropCount / 2), decorRng);
            V.ScatterOutcrops(pIntentMap, {
                minX: spawnX + SPAWN_HALO + 4,
                maxX: compoundMinX - 4,
                minY: midY + 1, maxY: midY + 4
            }, Math.floor(outcropCount / 2), decorRng);
        }

        // 8. P4.2 variety: 2-3 tactical clearings flanking the route — open
        //    pockets the player can use to maneuver around forest cover.
        var clearingCount = V ? V.PerSeedInt(decorRng, 2, 3) : 2;
        var clearings = [];
        for(var k = 0; k < clearingCount && V; ++k) {
            var cKx = V.PerSeedInt(decorRng,
                spawnX + 6, compoundMinX - 6);
            var cKy = (k % 2 === 0)
                ? V.PerSeedInt(decorRng, interiorMinY + 1, midY - 4)
                : V.PerSeedInt(decorRng, midY + 4, interiorMaxY - 1);
            var cKr = V.PerSeedInt(decorRng, 2, 3);
            var cleared = V.StampClearing(pIntentMap, cKx, cKy, cKr);
            if(cleared > 0) {
                clearings.push({ x: cKx, y: cKy, r: cKr });
            }
        }

        // 9. Spawn pad with halo at spawn position.
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
            pIntent.Map.SetOwner(pIntentMap, cx, cy, ownerVal);
            pIntent.Map.AddClaim(pIntentMap, cx, cy, anchorClaim);
        }
        stampAnchor(spawnX, spawnY, O.PLAYER_SPAWN, C.SPAWN_SAFE);

        pIntentMap.regions = pIntentMap.regions || [];
        pIntentMap.regions.push({
            id: "compound_siege.compound",
            kind: "compound",
            cells: compoundFloorCells,
            size: { w: compoundW, h: compoundH },
            centre: { x: objX, y: objY }
        });
        pIntentMap.regions.push({
            id: "compound_siege.approach_route",
            kind: "route", shape: routeShape
        });
        pIntentMap.regions.push({
            id: "compound_siege.perimeter_cover",
            kind: "forest_cover", cells: forestCells,
            density: coverDensity,
            defensiveLineCells: defensiveLines,
            routePocketClusters: routePocketClusters,
            routePocketCells: routePocketCells
        });

        pIntentMap.anchors = pIntentMap.anchors || {};
        pIntentMap.anchors.start     = { x: spawnX, y: spawnY };
        pIntentMap.anchors.objective = { x: objX,   y: objY };
        if(pContext) {
            pContext.IntentStyleContract = pContext.IntentStyleContract || {};
            pContext.IntentStyleContract.routeFrame =
                missionDirection > 0 ? "falling" : "rising";
            pContext.IntentStyleContract.routeVerticalSpan =
                Math.abs(objY - spawnY);
        }

        return pIntent.AuthorResult.Ok([
            pIntent.AuthorResult.Diagnostic(
                "ice_compound_siege.author",
                "compound=" + compoundW + "x" + compoundH +
                " forest=" + forestCells +
                " (" + coverDensity.toFixed(2) + ") " +
                "defLines=" + defensiveLines +
                " pockets=" + routePocketClusters + "/" + routePocketCells +
                "outcrops=" + outcropCount +
                " clearings=" + clearings.length +
                " route=" + routeShape +
                " frame=" + (missionDirection > 0 ? "falling" : "rising") +
                " verticalSpan=" + Math.abs(objY - spawnY)
            )
        ]);
    }

    if(pIntent.RegisterConcept) {
        pIntent.RegisterConcept({
            id: "ice_compound_siege",
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
                // Water-heavy intent now selects among several compatible
                // procedural styles. The dedicated river Concept owns only
                // edge-patrol plus water mobility; outpost/compound styles
                // remain here and author their guaranteed lake variant.
                return style === "ice_outpost" ||
                    style === "ice_edge_patrol" ||
                    style === "ice_compound_raid";
            },
            author: authorIceCompoundSiege,
            intentHardValidators: [
                {
                    id: "compound_clearing_size",
                    fn: function(pContext, pIntentMap) {
                        // Count cells with KEEP_CLEAR + RESERVED + not BLOCKED
                        // — these are the cells where v1's PlaceCampaignBuildings
                        // can place a 4×4 bunker. ROUTE_PRIMARY counts (the
                        // route can pass through the compound clearing). Floor
                        // is 24 cells (6×4 minimum bunker footprint).
                        var Mlocal = pIntent.Movement;
                        var Clocal = pIntent.Claim;
                        var W = pIntentMap.width;
                        var H = pIntentMap.height;
                        var clearCells = 0;
                        for(var i = 0; i < W * H; ++i) {
                            var m = pIntentMap.movement[i];
                            var c = pIntentMap.claim[i];
                            if((m & Mlocal.KEEP_CLEAR) &&
                                (c & Clocal.RESERVED) &&
                                !(c & (Clocal.SPAWN_SAFE | Clocal.OBJECTIVE)) &&
                                !(m & Mlocal.BLOCKED)) {
                                ++clearCells;
                            }
                        }
                        if(clearCells < 24) {
                            return { ok: false,
                                reason: "intent_hard:compound_clearing_too_small:" + clearCells };
                        }
                        return { ok: true };
                    }
                }
            ],
            intentQualityValidators: [],
            renderedHardValidators: [],
            driftBudget: {
                landIntentSolidMaxFraction: 0.20
            },
            finaliseConcept: function(pContext, pIntentMap, pRenderedMap) { return 0; }
        });
    }

    pIntent.Concepts.IceCompoundSiege = {
        author: authorIceCompoundSiege
    };

})(MapGen.Intent);
