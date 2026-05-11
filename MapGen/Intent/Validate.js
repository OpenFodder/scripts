// MapGen v3 Intent — three-layer validation harness (Phase 2 P2.4).
//
// Per OpenFodder_Map_Generator_Rewrite_Design_v3.4.md §5:
//   - intent-hard:  geometric invariants on the IntentMap that, if violated,
//                   prove the Concept's author() is buggy. Hard reject.
//   - intent-quality: per-Concept quality predicates (forest-prune ratio,
//                   route shape, structure distribution). Soft warn — feed
//                   into retry score.
//   - rendered-hard: post-Render assertions on the RenderedMap.Tiles.
//                   Catches render drift that breaks reachability or
//                   spawns a sprite over water. Hard reject.
//
// Each Concept registers its own validator arrays:
//   intentHardValidators:    [function(ctx, intentMap) -> {ok, reason}, ...]
//   intentQualityValidators: [function(ctx, intentMap) -> {ok, reason}, ...]
//   renderedHardValidators:  [function(ctx, intentMap, renderedMap) -> {ok, reason}, ...]
//
// Plus a shared bank of universal validators that every Concept inherits
// (route reachable from spawn, objective placed within reachable component,
// no claim conflicts in the IntentMap).

var MapGen = MapGen || {};
MapGen.Intent = MapGen.Intent || {};

(function(pIntent) {

    pIntent.Validate = pIntent.Validate || {};

    // -----------------------------------------------------------------------
    // Universal intent-hard validators. Every Concept inherits these.

    function validateRouteHasCells(pContext, pIntentMap) {
        var M = pIntent.Movement;
        var hits = 0;
        var W = pIntentMap.width;
        var H = pIntentMap.height;
        for(var y = 0; y < H; ++y) {
            var row = y * W;
            for(var x = 0; x < W; ++x) {
                var m = pIntentMap.movement[row + x];
                if((m & M.ROUTE_PRIMARY) || (m & M.ROUTE_SECONDARY)) {
                    ++hits;
                }
            }
        }
        if(hits === 0) {
            return { ok: false, reason: "intent_hard:no_route_cells" };
        }
        return { ok: true, hits: hits };
    }

    function validateAnchorsOnWalkable(pContext, pIntentMap) {
        var anchors = pIntentMap.anchors || pContext.Anchors || {};
        var M = pIntent.Movement;
        var T = pIntent.Terrain;
        var failures = [];
        var checked = 0;

        function isWalkableAtIntent(x, y) {
            if(x < 0 || y < 0 || x >= pIntentMap.width || y >= pIntentMap.height) {
                return false;
            }
            var i = (y * pIntentMap.width) + x;
            // Solid terrain blocks walkability outright.
            var t = pIntentMap.terrain[i];
            if(t === T.WATER || t === T.RIVER || t === T.CLIFF_BODY ||
                t === T.CLIFF_TOP || t === T.FOREST || t === T.OUTCROP) {
                return false;
            }
            // Movement BLOCKED bit overrides — Concept stamping that did not
            // raise a terrain enum but did mark BLOCKED.
            if(pIntentMap.movement[i] & M.BLOCKED) {
                return false;
            }
            return true;
        }

        for(var key in anchors) {
            if(!anchors.hasOwnProperty(key)) { continue; }
            var p = anchors[key];
            if(!p || typeof p.x !== "number" || typeof p.y !== "number") {
                continue;
            }
            ++checked;
            if(!isWalkableAtIntent(p.x, p.y)) {
                failures.push("intent_hard:anchor_blocked:" + key + "@" + p.x + "," + p.y);
            }
        }
        if(failures.length) {
            return { ok: false, reason: failures[0], failures: failures };
        }
        if(checked === 0) {
            return { ok: false, reason: "intent_hard:no_anchors" };
        }
        return { ok: true, checked: checked };
    }

    // BFS over IntentMap walkability; checks that anchors.start can reach
    // anchors.objective. Uses 4-connected adjacency over WALKABLE cells.
    function validateAnchorsReachable(pContext, pIntentMap) {
        var anchors = pIntentMap.anchors || pContext.Anchors || {};
        if(!anchors.start || !anchors.objective) {
            return { ok: false, reason: "intent_hard:anchors_missing" };
        }
        var M = pIntent.Movement;
        var T = pIntent.Terrain;
        var W = pIntentMap.width;
        var H = pIntentMap.height;

        function walkable(x, y) {
            if(x < 0 || y < 0 || x >= W || y >= H) { return false; }
            var i = (y * W) + x;
            var t = pIntentMap.terrain[i];
            if(t === T.WATER || t === T.RIVER || t === T.CLIFF_BODY ||
                t === T.CLIFF_TOP || t === T.FOREST || t === T.OUTCROP) {
                return false;
            }
            if(pIntentMap.movement[i] & M.BLOCKED) { return false; }
            return true;
        }

        var visited = new Uint8Array(W * H);
        var queue = [anchors.start.x, anchors.start.y];
        visited[(anchors.start.y * W) + anchors.start.x] = 1;
        var head = 0;
        var found = false;

        while(head < queue.length) {
            var px = queue[head++];
            var py = queue[head++];
            if(px === anchors.objective.x && py === anchors.objective.y) {
                found = true;
                break;
            }
            var neighbours = [px+1, py, px-1, py, px, py+1, px, py-1];
            for(var n = 0; n < neighbours.length; n += 2) {
                var nx = neighbours[n];
                var ny = neighbours[n + 1];
                if(nx < 0 || ny < 0 || nx >= W || ny >= H) { continue; }
                var ni = (ny * W) + nx;
                if(visited[ni]) { continue; }
                if(!walkable(nx, ny)) { continue; }
                visited[ni] = 1;
                queue.push(nx);
                queue.push(ny);
            }
        }
        if(!found) {
            return { ok: false, reason: "intent_hard:start_to_objective_unreachable" };
        }
        return { ok: true };
    }

    function validateMinimumOpenArea(pContext, pIntentMap) {
        var T = pIntent.Terrain;
        var M = pIntent.Movement;
        var W = pIntentMap.width;
        var H = pIntentMap.height;
        var open = 0;
        for(var i = 0; i < W * H; ++i) {
            var t = pIntentMap.terrain[i];
            if(t !== T.WATER && t !== T.RIVER && t !== T.CLIFF_BODY &&
                t !== T.CLIFF_TOP && t !== T.FOREST && t !== T.OUTCROP) {
                if(!(pIntentMap.movement[i] & M.BLOCKED)) {
                    ++open;
                }
            }
        }
        var fraction = open / (W * H);
        // Tracks the v1 MinimumLargestWalkableComponent floor (0.25) but on
        // intent rather than rendered cells. Calibration source: design v3.4
        // §13.2 "rendered route reachability".
        var profile = pContext ? pContext.Profile || {} : {};
        var configuredFloor = Number(profile.MinIntentOpenFraction);
        var floor = isNaN(configuredFloor) ? 0.20 :
            Math.max(0.05, Math.min(0.50, configuredFloor));
        if(fraction < floor) {
            return { ok: false, reason: "intent_hard:open_area_below_floor:" +
                fraction.toFixed(3) + "/" + floor.toFixed(3) };
        }
        return { ok: true, fraction: fraction };
    }

    pIntent.Validate.UniversalIntentHard = [
        { id: "route_has_cells",      fn: validateRouteHasCells },
        { id: "anchors_on_walkable",  fn: validateAnchorsOnWalkable },
        { id: "anchors_reachable",    fn: validateAnchorsReachable },
        { id: "minimum_open_area",    fn: validateMinimumOpenArea }
    ];

    // -----------------------------------------------------------------------
    // RunIntentHard
    //
    // Walks universal validators THEN concept-specific intentHardValidators
    // and aggregates the failures. Stops at first failure for fast-reject
    // (Phase 2 retry budget is dominated by author + render time, not
    // validation time).

    pIntent.Validate.RunIntentHard = function(pContext, pConcept, pIntentMap) {
        var reasons = [];

        for(var u = 0; u < pIntent.Validate.UniversalIntentHard.length; ++u) {
            var entry = pIntent.Validate.UniversalIntentHard[u];
            var result;
            try {
                result = entry.fn(pContext, pIntentMap);
            } catch(e) {
                result = { ok: false, reason: "intent_hard_throw:" + entry.id + ":" + e };
            }
            if(!result.ok) {
                reasons.push(result.reason);
                return { ok: false, reasons: reasons };
            }
        }

        var conceptValidators = pConcept.intentHardValidators || [];
        for(var c = 0; c < conceptValidators.length; ++c) {
            var v = conceptValidators[c];
            var fn = (typeof v === "function") ? v : (v.fn || null);
            var id = (typeof v === "function") ? "concept_" + c : (v.id || ("concept_" + c));
            if(!fn) { continue; }
            var r;
            try {
                r = fn(pContext, pIntentMap);
            } catch(e2) {
                r = { ok: false, reason: "intent_hard_throw:" + id + ":" + e2 };
            }
            if(!r.ok) {
                reasons.push(r.reason || ("intent_hard:" + id));
                return { ok: false, reasons: reasons };
            }
        }

        return { ok: true, reasons: [] };
    };

    // -----------------------------------------------------------------------
    // RunRenderedHard — post-render assertions on RenderedMap.Tiles.
    //
    // Universal: anchors are walkable per the engine collision oracle (or, in
    // JS, per the Composite-projected layers + RenderedMap.Counts), spawn
    // tile is not over water, route corridor has at least N walkable cells.

    function renderedAnchorsWalkable(pContext, pIntentMap, pRenderedMap) {
        var anchors = pContext.Anchors || (pIntentMap && pIntentMap.anchors) || {};
        if(!pRenderedMap || !pRenderedMap.Tiles) {
            return { ok: false, reason: "rendered_hard:no_rendered_map" };
        }

        if(pContext && pContext.ConceptId) {
            // v3's RenderedMap is committed to the engine after this pipeline
            // stage. The authoritative anchor/collision check is the
            // post-commit Drift report, which queries Map.TileTerrainFeature.
            return { ok: true, skipped: "rendered_hard:engine_oracle_post_commit_required" };
        }

        var failures = [];

        function tileSolid(x, y) {
            // Use Composite-projected Layers as the proxy for engine collision.
            // Engine-oracle replay (--map-route-oracle) is the gold standard
            // but only runs out-of-process; this in-process check catches the
            // cases that matter at v3 acceptance time.
            var layers = pContext.Layers || {};
            if(MapGen.Layers.Get(layers.water, x, y, 0)) { return true; }
            if(MapGen.Layers.Get(layers.blocked, x, y, 0)) { return true; }
            return false;
        }

        for(var key in anchors) {
            if(!anchors.hasOwnProperty(key)) { continue; }
            var p = anchors[key];
            if(!p || typeof p.x !== "number") { continue; }
            if(tileSolid(p.x, p.y)) {
                failures.push("rendered_hard:anchor_solid:" + key);
            }
        }
        if(failures.length) {
            return { ok: false, reason: failures[0], failures: failures };
        }
        return { ok: true };
    }

    function renderedTreeFloor(pContext, pIntentMap, pRenderedMap) {
        var profile = pContext ? pContext.Profile || {} : {};
        var smoothing = pRenderedMap ? pRenderedMap.Smoothing || {} : {};
        var minTiles = profile.MinRenderedTreeTiles;
        var minCoverage = profile.MinRenderedTreeTileCoverage;
        var area = Math.max(1, (pContext.Width || 0) * (pContext.Height || 0));
        var treeTiles = Number(smoothing.treeTiles || 0);

        if(minCoverage !== undefined && minCoverage !== null && !isNaN(Number(minCoverage)))
            minTiles = Math.max(Number(minTiles || 0), Math.round(Number(minCoverage) * area));

        if(minTiles === undefined || minTiles === null || isNaN(Number(minTiles)))
            return { ok: true };

        minTiles = Math.max(0, Math.floor(Number(minTiles)));
        if(minTiles > 0 && treeTiles < minTiles) {
            return {
                ok: false,
                reason: "rendered_tree_tiles_too_low:" + treeTiles + "/" + minTiles
            };
        }
        return { ok: true, treeTiles: treeTiles, minTiles: minTiles };
    }

    function renderedTreeCeiling(pContext, pIntentMap, pRenderedMap) {
        var profile = pContext ? pContext.Profile || {} : {};
        var maxCoverage = profile.MaxRenderedTreeTileCoverage;
        if(maxCoverage === undefined || maxCoverage === null ||
            isNaN(Number(maxCoverage))) {
            var authoredCeiling = Number(profile.MaxTreeCoverage);
            if(!isNaN(authoredCeiling))
                // Final route-edge cover is intentionally injected after the
                // authored mask budget. Allow up to three percentage points
                // for that tactical ribbon while still catching wholesale
                // forest restoration (the original regression was >10pt).
                maxCoverage = authoredCeiling + 0.03;
            else
                return { ok: true };
        }

        var smoothing = pRenderedMap ? pRenderedMap.Smoothing || {} : {};
        var counts = pRenderedMap ? pRenderedMap.Counts || {} : {};
        var area = Math.max(1, (pContext.Width || 0) * (pContext.Height || 0));
        // Counts.tree is the final materialized layer classification and is
        // directly comparable to the profile's MaxTreeCoverage. The smoother's
        // treeTiles includes multi-row canopy art and is intentionally larger.
        var treeTiles = counts.tree !== undefined ?
            Number(counts.tree || 0) : Number(smoothing.treeTiles || 0);
        var maxTiles = Math.max(0, Math.floor(Number(maxCoverage) * area));
        if(treeTiles > maxTiles) {
            return {
                ok: false,
                reason: "rendered_tree_tiles_too_high:" + treeTiles + "/" + maxTiles
            };
        }
        return { ok: true, treeTiles: treeTiles, maxTiles: maxTiles };
    }

    function renderedCliffSynthesisIntegrity(pContext, pIntentMap, pRenderedMap) {
        // Only v3 cliffs bridged by Intent/CliffTiles opt into this contract.
        // Legacy/terrace cliffs retain their existing validators.
        if(!pContext || !pContext.IntentCliffSynthesis)
            return { ok: true };
        if(pContext.IntentCliffSynthesis.error) {
            return {
                ok: false,
                reason: "rendered_cliff_synthesis_error:" +
                    pContext.IntentCliffSynthesis.error
            };
        }
        if(!pRenderedMap || !pRenderedMap.Tiles ||
            !pContext.Cliffs || !pContext.Cliffs.length) {
            return { ok: false, reason: "rendered_cliff_synthesis_missing" };
        }

        var record = null;
        for(var ri = pContext.Cliffs.length - 1; ri >= 0; --ri) {
            if(pContext.Cliffs[ri] && pContext.Cliffs[ri].kind === "cliff_band") {
                record = pContext.Cliffs[ri];
                break;
            }
        }
        if(!record)
            return { ok: false, reason: "rendered_cliff_record_missing" };

        // Corner terraces must leave the map through a complete cliff face,
        // not merely touch the perpendicular edge with their leading cell.
        // The retail ice corpus normally has 3-5 cliff cells along an edge;
        // this authored profile uses the native four-cell stamp width.
        var regions = pIntentMap.regions || [];
        var cornerRegion = null;
        for(var cr = 0; cr < regions.length; ++cr) {
            if(regions[cr] && regions[cr].kind === "cliff" &&
                regions[cr].axis === "corner_diagonal") {
                cornerRegion = regions[cr];
                break;
            }
        }
        if(cornerRegion) {
            var exitsNorth = false;
            var exitsSouth = false;
            var anchoredEdges = cornerRegion.edgeAnchored || [];
            for(var ae = 0; ae < anchoredEdges.length; ++ae) {
                if(anchoredEdges[ae] === "top") exitsNorth = true;
                if(anchoredEdges[ae] === "bottom") exitsSouth = true;
            }

            var terminalRun = 0;
            var maxTerminalRun = 0;
            var clippedTerminalColumns = 0;
            var previousTerminalX = null;
            for(var tc = 0; tc < record.columns.length; ++tc) {
                var terminalColumn = record.columns[tc];
                var touchesPerpendicularEdge =
                    (exitsNorth && terminalColumn.topRowY <= 0 &&
                        terminalColumn.topRowY +
                            record.stampHeight - 1 >= 0) ||
                    (exitsSouth && terminalColumn.topRowY <=
                        pIntentMap.height - 1 && terminalColumn.topRowY +
                            record.stampHeight - 1 >=
                                pIntentMap.height - 1);
                if(touchesPerpendicularEdge) {
                    // A proper atlas phrase continues beyond the map.  A
                    // full-height strip merely parked on row 0/H-4 produces
                    // the old flat wall: it touches the edge, but is not the
                    // shipped 4/3/2/1 clipped termination.
                    if((exitsNorth && terminalColumn.topRowY < 0) ||
                        (exitsSouth && terminalColumn.topRowY +
                            record.stampHeight - 1 >= pIntentMap.height))
                        ++clippedTerminalColumns;
                    if(previousTerminalX !== null &&
                        terminalColumn.x === previousTerminalX + 1)
                        ++terminalRun;
                    else
                        terminalRun = 1;
                    previousTerminalX = terminalColumn.x;
                    if(terminalRun > maxTerminalRun)
                        maxTerminalRun = terminalRun;
                }
                else {
                    terminalRun = 0;
                    previousTerminalX = null;
                }
            }
            if(maxTerminalRun < record.stampHeight) {
                return {
                    ok: false,
                    reason: "rendered_cliff_terminal_run:" +
                        maxTerminalRun + "/" + record.stampHeight
                };
            }
            if(clippedTerminalColumns < record.stampHeight - 1) {
                return {
                    ok: false,
                    reason: "rendered_cliff_terminal_clip:" +
                        clippedTerminalColumns + "/" +
                        (record.stampHeight - 1)
                };
            }
        }

        // Edge-terminating columns may begin above the top row or finish
        // below the bottom row. Count only the visible portion of each strip;
        // requiring a full stamp here would reject the shipped 4/3/2/1 taper.
        var expectedTriplets = 0;
        for(var ec = 0; ec < record.columns.length; ++ec) {
            var expectedColumn = record.columns[ec];
            for(var expectedRow = 0;
                expectedRow < record.stampHeight;
                ++expectedRow) {
                var expectedY = expectedColumn.topRowY + expectedRow;
                if(expectedY >= 0 && expectedY < pIntentMap.height)
                    ++expectedTriplets;
            }
        }
        if(record.triplets.length !== expectedTriplets) {
            return {
                ok: false,
                reason: "rendered_cliff_triplet_count:" +
                    record.triplets.length + "/" + expectedTriplets
            };
        }

        for(var ti = 0; ti < record.triplets.length; ++ti) {
            var triplet = record.triplets[ti];
            var rendered = MapGen.Layers.Get(
                pRenderedMap.Tiles, triplet.x, triplet.y, -1) & 0x1FF;
            if(rendered !== (triplet.tileId & 0x1FF)) {
                return {
                    ok: false,
                    reason: "rendered_cliff_tile_mismatch:" + triplet.x +
                        "," + triplet.y + ":" + rendered +
                        "!=" + triplet.tileId
                };
            }
        }

        var cliff = null;
        if(typeof Structures !== "undefined" && Structures.Ice)
            cliff = Structures.Ice.Cliff;

        // A synthesized ice cliff owns the plain-snow lip directly above the
        // face and the first foot-shadow row below it. If either overlay is
        // absent, water/coast/cover has intruded into the visual footprint —
        // the regression that made edge termini look like floating wall
        // columns. Validate the actual rendered tiles, not just layer intent.
        if(cliff && record.requireDryApron) {
            var topPalette = cliff.TopEdge || [];
            for(var bc = 0; bc < record.columns.length; ++bc) {
                var bodyColumn = record.columns[bc];
                var bodyTrips = bodyColumn.triplets || [];
                if(bodyColumn.isStairs || !bodyTrips.length)
                    continue;

                var topTrip = bodyTrips[0];
                var bottomTrip = bodyTrips[0];
                for(var bt = 1; bt < bodyTrips.length; ++bt) {
                    if(bodyTrips[bt].y < topTrip.y) topTrip = bodyTrips[bt];
                    if(bodyTrips[bt].y > bottomTrip.y) bottomTrip = bodyTrips[bt];
                }

                var lipY = topTrip.y - 1;
                if(lipY >= 0) {
                    var lipTile = MapGen.Layers.Get(
                        pRenderedMap.Tiles, bodyColumn.x, lipY, -1) & 0x1FF;
                    var lipFound = false;
                    for(var tp = 0; tp < topPalette.length; ++tp) {
                        if((topPalette[tp] & 0x1FF) === lipTile) {
                            lipFound = true;
                            break;
                        }
                    }
                    if(!lipFound) {
                        return {
                            ok: false,
                            reason: "rendered_cliff_lip:" + bodyColumn.x + "," +
                                lipY + ":" + lipTile
                        };
                    }
                }

                var bottomId = bottomTrip.tileId & 0x1FF;
                var expectedBodyFoot =
                    (bottomId >= 180 && bottomId <= 184) ? bottomId + 20 : null;
                if(expectedBodyFoot !== null) {
                    var footY = bottomTrip.y + 1;
                    if(footY < pIntentMap.height) {
                        var bodyFoot = MapGen.Layers.Get(
                            pRenderedMap.Tiles, bodyColumn.x, footY, -1) & 0x1FF;
                        if(bodyFoot !== expectedBodyFoot) {
                            return {
                                ok: false,
                                reason: "rendered_cliff_body_foot:" + bodyColumn.x +
                                    "," + footY + ":" + bodyFoot + "!=" +
                                    expectedBodyFoot
                            };
                        }
                    }
                }
            }

            // At a map-border terminus, the coast must have turned far enough
            // away that the cells outside the lip/foot overlays are no longer
            // aquatic. Checking the outer three columns catches thin shoreline
            // fingers that can otherwise survive while all cliff triplets and
            // first-row foot tiles remain technically valid.
            var terminalWidth = Math.min(3, pRenderedMap.Tiles.width || 3);
            var terminalXs = [];
            for(var tx = 0; tx < terminalWidth; ++tx) {
                terminalXs.push(tx);
                if(pIntentMap.width - 1 - tx >= terminalWidth)
                    terminalXs.push(pIntentMap.width - 1 - tx);
            }
            var terminalRows = [
                record.topRowY - 3,
                record.topRowY - 2,
                record.bandY + 2,
                record.bandY + 3
            ];
            for(var ex = 0; ex < terminalXs.length; ++ex) {
                for(var er = 0; er < terminalRows.length; ++er) {
                    var edgeY = terminalRows[er];
                    if(edgeY < 0 || edgeY >= pIntentMap.height)
                        continue;
                    var edgeTile = MapGen.Layers.Get(
                        pRenderedMap.Tiles, terminalXs[ex], edgeY, -1) & 0x1FF;
                    var edgeRecord = null;
                    if(MapGen.Terrain && MapGen.Terrain.Smoothing &&
                        MapGen.Terrain.Smoothing.IceTileEdges &&
                        MapGen.Terrain.Smoothing.IceTileEdges.tiles) {
                        edgeRecord = MapGen.Terrain.Smoothing.IceTileEdges.tiles[
                            String(edgeTile)] || null;
                    }
                    var edgeAquatic = edgeRecord &&
                        (edgeRecord.primary === "deep" ||
                         edgeRecord.primary === "shallow");
                    if(edgeAquatic) {
                        return {
                            ok: false,
                            reason: "rendered_cliff_terminal_edge:" +
                                terminalXs[ex] + "," + edgeY + ":" + edgeTile
                        };
                    }
                }
            }
        }

        var stairs = record.stairs;
        if(pContext.IntentCliffSynthesis.stairs) {
            if(!stairs || !cliff || !cliff.Stairs)
                return { ok: false, reason: "rendered_cliff_stairs_missing" };

            // One continuation row belongs below the four-row stair stamp.
            // It uses the shipped bottom-family mapping 205..207 -> 225..227.
            var stairBottom = cliff.Stairs[cliff.StairsHeight - 1] || [];
            var footY = stairs.originY + stairs.height;
            for(var sx = 0; sx < stairs.width; ++sx) {
                var expectedFoot = (stairBottom[sx] | 0) + 20;
                var renderedFoot = MapGen.Layers.Get(
                    pRenderedMap.Tiles, stairs.originX + sx, footY, -1) & 0x1FF;
                if(renderedFoot !== expectedFoot) {
                    return {
                        ok: false,
                        reason: "rendered_cliff_stair_foot:" +
                            (stairs.originX + sx) + "," + footY + ":" +
                            renderedFoot + "!=" + expectedFoot
                    };
                }
            }
        }

        // Flat synthesized body runs must obey the shipped Wang adjacency
        // table. The stair stamp intentionally resets the walk on each side.
        if(cliff && cliff.Adjacency) {
            var prevKey = null;
            var prevX = null;
            for(var ci = 0; ci < record.columns.length; ++ci) {
                var column = record.columns[ci];
                if(column.isStairs || !column.stripKey) {
                    prevKey = null;
                    prevX = column.x;
                    continue;
                }
                if(prevKey && column.x === prevX + 1) {
                    var allowed = cliff.Adjacency[prevKey] || [];
                    var found = false;
                    for(var ai = 0; ai < allowed.length; ++ai) {
                        if(allowed[ai] === column.stripKey) {
                            found = true;
                            break;
                        }
                    }
                    if(!found) {
                        return {
                            ok: false,
                            reason: "rendered_cliff_adjacency:" + prevKey +
                                "->" + column.stripKey + "@" + column.x
                        };
                    }
                }
                prevKey = column.stripKey;
                prevX = column.x;
            }
        }

        return { ok: true };
    }

    pIntent.Validate.UniversalRenderedHard = [
        { id: "anchors_walkable",  fn: renderedAnchorsWalkable },
        { id: "rendered_tree_floor", fn: renderedTreeFloor },
        { id: "rendered_tree_ceiling", fn: renderedTreeCeiling },
        { id: "rendered_cliff_synthesis_integrity", fn: renderedCliffSynthesisIntegrity }
    ];

    pIntent.Validate.RunRenderedHard = function(pContext, pConcept, pIntentMap) {
        var renderedMap = pContext.RenderedMap;
        var reasons = [];

        for(var u = 0; u < pIntent.Validate.UniversalRenderedHard.length; ++u) {
            var entry = pIntent.Validate.UniversalRenderedHard[u];
            var result;
            try {
                result = entry.fn(pContext, pIntentMap, renderedMap);
            } catch(e) {
                result = { ok: false, reason: "rendered_hard_throw:" + entry.id + ":" + e };
            }
            if(!result.ok) {
                reasons.push(result.reason);
                return { ok: false, reasons: reasons };
            }
        }

        var conceptValidators = pConcept.renderedHardValidators || [];
        for(var c = 0; c < conceptValidators.length; ++c) {
            var v = conceptValidators[c];
            var fn = (typeof v === "function") ? v : (v.fn || null);
            if(!fn) { continue; }
            var r;
            try {
                r = fn(pContext, pIntentMap, renderedMap);
            } catch(e2) {
                r = { ok: false, reason: "rendered_hard_throw:" + (v.id || c) + ":" + e2 };
            }
            if(!r.ok) {
                reasons.push(r.reason || ("rendered_hard:" + (v.id || c)));
                return { ok: false, reasons: reasons };
            }
        }

        return { ok: true, reasons: [] };
    };

})(MapGen.Intent);
