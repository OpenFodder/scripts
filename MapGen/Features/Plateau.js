var MapGen = MapGen || {};
MapGen.Features = MapGen.Features || {};

// Horizontal terrace pass. Picks one east-west band Y for the cliff edge and
// (for ice) plans the entire cliff path before any tile is stamped. The
// PlateauCliffs tiler is fed an immutable per-column topRowY array and just
// emits adjacency-respecting strips along it.
//
// Anchor-aware band selection: jungle has no transit (no helicopter wired up
// yet), so the cliff bisects walkable space. The band must therefore land
// either entirely above or entirely below all anchors. If neither side fits
// the valid band range, the pass skips (logged so the smoke test can spot it).
// Ice cliffs include an in-stamp stair transit, so their band search can use
// the full eligible range; the planner's per-column fit gate and live
// CliffsTraversable validation reject bands that would actually strand routes.
//
// Ice (Cliff.SchemaVersion === 2) planning rules:
//   - At each candidate bandY, find the longest contiguous run of columns
//     whose body footprint is clear of water/bank.
//   - If the run spans both map edges, the cliff is a flat band crossing the
//     entire map.
//   - If a run-end is mid-map (river-blocked), drift the cliff body off the
//     top or bottom edge over a few columns so the cliff fades out instead
//     of hard-capping at the river. Drift direction is whichever edge has
//     more headroom from baseTopY.
//   - Drift columns honour the same fit constraint at their drifted topY.
//   - Score = total path length (run + drift).
// Other biomes use the legacy water-free run scorer (no drift, flat only).
MapGen.Features.Plateau = (function() {

    var STAMP_HEIGHT = {};
    STAMP_HEIGHT[Terrain.Types.Ice] = 5;
    STAMP_HEIGHT[Terrain.Types.Jungle] = 7;
    STAMP_HEIGHT[Terrain.Types.Desert] = 7;

    var TOP_MARGIN = 4;
    var BOTTOM_MARGIN = 8;
    var ANCHOR_CLEARANCE = 4;
    // Minimum committed column count required to place a cliff. Below this,
    // the cliff is so chopped up that it doesn't read visually — better to
    // skip the cliff entirely.
    //
    // NOTE (2026-06-15): lowering this to 8 was tried as a fire-rate lever
    // and was a NO-OP — the same 3 seeds fired the same 348-351 cell cliffs,
    // gate byte-identical. Cliff firing is BINARY: a seed either has a clear
    // full-width edge-to-edge horizontal band (→ a big ~350-cell cliff) or it
    // has none. There is no population of marginal 8-9 column bands to admit.
    // The fire-rate ceiling is the availability of clear horizontal bands,
    // not this threshold. See [[mapgen_cliff_edge_to_edge]].
    var MIN_CLIFF_RUN = 10;

    function isBiomeSupported(pTerrainType) {
        return STAMP_HEIGHT[pTerrainType] !== undefined;
    }

    function biomeName(pTerrainType) {
        return MapGen.Terrain.BiomeStrategy.CliffBiomeName(pTerrainType);
    }

    function cliffData(pContext) {
        var name = biomeName(pContext.Profile.TerrainType);
        if(!name) return null;
        if(!Structures[name] || !Structures[name].Cliff) return null;
        return Structures[name].Cliff;
    }

    function plateauBottomMargin(pProfile) {
        var value = pProfile ? pProfile.PlateauBottomMargin : undefined;
        if(typeof value !== "number")
            return BOTTOM_MARGIN;
        return Math.max(0, Math.floor(value));
    }

    function collectAnchorYs(pContext) {
        var ys = [];
        var anchors = pContext.Anchors || {};
        for(var key in anchors) {
            if(!anchors.hasOwnProperty(key)) continue;
            var a = anchors[key];
            if(a && typeof a.y === "number")
                ys.push(a.y);
        }
        return ys;
    }

    // BandY clearance pre-score (2026-06-16, [[mapgen_cliff_edge_to_edge]]
    // Option C). Walks the stampHeight strip at a candidate bandY and
    // returns the longest contiguous run of columns clear of the FOUR
    // hard horizontal blockers visible at Plateau time post-Slice-1B
    // hoist: water (Coast/Rivers), riverBank (Water.MarkBanks), coast,
    // and owner-claimed rank — both ROUTE (Skeleton corridor) and
    // STRUCTURE (RegionIntents compound halos).
    //
    // Why this matters: post-hoist Plateau is invoked BEFORE Connectivity,
    // Clearings, Outcrops — so keepClear/path/occupied don't yet exist
    // for Plateau to see. The dominant cliff-blocker at this stage is
    // the Skeleton ROUTE corridor (Bresenham-line, ~5 cells wide
    // including halfWidth) which sweeps roughly horizontally between
    // anchors. EVERY bandY whose stampHeight strip overlaps the route's
    // Y range gets bisected, collapsing the maximal contiguous run to
    // below MIN_CLIFF_RUN. The current bestBandYInPlanner sweeps all
    // bandYs and lets the first matching topology win — which on a
    // route-bisected bandY is usually a SHORT path that fails MIN_CLIFF_RUN,
    // even when a higher-clearance bandY exists elsewhere on the map.
    //
    // This pre-score lets the planner concentrate on bandYs with a
    // chance of producing a long admissible path. Cheap (O(W*stampHeight)
    // per bandY, no RNG), deterministic.
    function summariseBandYClearance(pContext, pBandY, pStampHeight) {
        var topRowY = pBandY - (pStampHeight - 1);
        if(topRowY < 0 || pBandY >= pContext.Height) return { clearCols: 0, clearRunLongest: 0 };
        var W = pContext.Width;
        var layers = pContext.Layers;
        var water = layers.water, bank = layers.riverBank, coast = layers.coast;
        var owner = layers.owner;
        var ROUTE = MapGen.Layers.Owner.ROUTE;
        var STRUCTURE = MapGen.Layers.Owner.STRUCTURE;
        var clearCols = 0, run = 0, bestRun = 0;
        for(var x = 0; x < W; ++x) {
            var blocked = false;
            for(var r = 0; r < pStampHeight; ++r) {
                var y = topRowY + r;
                if(MapGen.Layers.Get(water, x, y, 0) ||
                   MapGen.Layers.Get(bank, x, y, 0) ||
                   MapGen.Layers.Get(coast, x, y, 0)) {
                    blocked = true; break;
                }
                if(owner) {
                    var ov = MapGen.Layers.Get(owner, x, y, 0);
                    if(ov === ROUTE || ov === STRUCTURE) {
                        blocked = true; break;
                    }
                }
            }
            if(blocked) {
                if(run > bestRun) bestRun = run;
                run = 0;
            } else {
                ++clearCols;
                ++run;
            }
        }
        if(run > bestRun) bestRun = run;
        return { clearCols: clearCols, clearRunLongest: bestRun };
    }

    // Legacy v1 scorer: longest contiguous run of x where the cliff strip
    // footprint is free of water/riverBank. Used by jungle/desert.
    function scoreBandYLegacy(pContext, pBandY, pStampHeight) {
        var topRowY = pBandY - (pStampHeight - 1);
        if(topRowY < 0 || pBandY >= pContext.Height) return 0;
        var water = pContext.Layers.water;
        var bank = pContext.Layers.riverBank;
        var bestRun = 0;
        var run = 0;
        for(var x = 0; x < pContext.Width; ++x) {
            var blocked = false;
            for(var r = 0; r < pStampHeight; ++r) {
                var y = topRowY + r;
                if(MapGen.Layers.Get(water, x, y, 0) ||
                   MapGen.Layers.Get(bank, x, y, 0)) {
                    blocked = true; break;
                }
            }
            if(blocked) {
                if(run > bestRun) bestRun = run;
                run = 0;
            } else {
                ++run;
            }
        }
        if(run > bestRun) bestRun = run;
        return bestRun;
    }

    // v2 planner. At a candidate bandY:
    //   1. Find every maximal run of columns whose body footprint fits at
    //      baseTopY.
    //   2. For each run, build path candidates by combining each viable
    //      LEFT-end resolution with each viable RIGHT-end resolution.
    //   3. End-resolution options per side: "edge" (run already touches
    //      x=0 / x=W-1), or drift-up that ends in a topFade or by reaching
    //      the map edge, or drift-down ending in a bottomFade or edge.
    //      Drift attempts that interior-dead-end (river-blocked) are
    //      discarded.
    //   4. The path is tagged with a topology (leftEndType, rightEndType)
    //      drawn from {edge, topFade, bottomFade}. The topology selector
    //      in bestBandYInPlanner picks one of the 9 valid pairs at random
    //      and falls back through the others if no path matches.
    //
    // Returns array of all qualifying paths at this bandY (possibly empty).
    function planAllCliffPathsAtBandY(pContext, pCliff, pBandY, pStampHeight) {
        var W = pContext.Width;
        var H = pContext.Height;
        var baseTopY = pBandY - (pStampHeight - 1);
        if(baseTopY < 0 || pBandY >= H) return [];

        var ColumnFits = MapGen.Features.PlateauCliffs.ColumnFits;
        var fitOptions = (pCliff && pCliff.Stairs && pCliff.StairsWidth && pCliff.StairsHeight) ?
            { allowRouteTransit: true } :
            null;

        var fits = new Array(W);
        for(var fx = 0; fx < W; ++fx)
            fits[fx] = ColumnFits(pContext, fx, baseTopY, pStampHeight, pCliff, fitOptions);

        var runs = [];
        var rs = -1;
        for(var sx = 0; sx <= W; ++sx) {
            var inRun = (sx < W) && fits[sx];
            if(inRun) {
                if(rs < 0) rs = sx;
            } else if(rs >= 0) {
                runs.push({ start: rs, end: sx - 1 });
                rs = -1;
            }
        }
        if(!runs.length) return [];

        function tryDrift(pStartX, pStepX, pDelta) {
            // Non-monotonic drift — bunches steps so the cliff goes flat for
            // 1..4 columns then drops/rises one row, instead of stepping
            // every single column. Measured against mapm4 (the longest
            // shipped diagonal): step rate ~0.36 per column, max flat run
            // length 4. We sample at 40% per column with a forced step after
            // 4 consecutive flats so drift always makes progress toward
            // fade-off or column-fit termination.
            //
            // Per-column decision is hashed on (seed, x, bandY, pStepX,
            // pDelta) so the resulting shape is deterministic per seed.
            //
            // BINDING CONSTRAINT (user, 2026-06-15): "cliffs must extend
            // from one edge to another edge". Shipped ice cliff data
            // (Tools/Probes/ShippedCliffBboxEdges.py): 87.5% of clusters
            // touch 2 map edges, 12.5% touch 3, 0% interior. The drift
            // is REQUIRED to reach a map edge (left/right via x<0/x>=W)
            // or fade off the top/bottom (via y<0/y>=H) — interior dead
            // ends are rejected. Water/riverBank/coast are HARD blockers
            // here, same as keepClear/route/occupied: a cliff body cannot
            // cross or skip over water; it must physically stamp every
            // column from its anchor to its terminus. See
            // [[mapgen_cliff_water_passthrough]] for the abandoned
            // water-skip approach (produced fragmented clusters).
            var cy = baseTopY;
            var fadeOff = false;
            var cols = [];
            var x = pStartX;
            var consecutiveFlat = 0;
            var saltBase = 4421 +
                (pStepX < 0 ? 0 : 1) +
                (pDelta < 0 ? 0 : 2);
            while(x >= 0 && x < W) {
                var roll = MapGen.Random.HashTile(pContext.Seed, x, pBandY, saltBase) % 100;
                var doStep = (roll < 40) || (consecutiveFlat >= 4);
                var ny = doStep ? (cy + pDelta) : cy;
                if(doStep) {
                    if(ny + pStampHeight - 1 < 0) { fadeOff = true; break; }
                    if(ny >= H) { fadeOff = true; break; }
                }
                if(!ColumnFits(pContext, x, ny, pStampHeight, pCliff, fitOptions))
                    break;
                cols.push({ x: x, topY: ny });
                cy = ny;
                x += pStepX;
                consecutiveFlat = doStep ? 0 : (consecutiveFlat + 1);
            }
            return {
                cols: cols,
                fadeOff: fadeOff,
                delta: pDelta
            };
        }

        // Classify a drift result. Returns the end-type tag, or null when
        // the drift dead-ends in the map interior (gameplay-blocked or
        // water-blocked without reaching a map edge). Only fadeOff drifts
        // and drifts whose last STAMPED column is at the map edge classify
        // as edge — there is no synthetic "reached edge" fallback.
        function classifyDrift(pDrift, pStepX) {
            if(pDrift.fadeOff) return pDrift.delta < 0 ? "topFade" : "bottomFade";
            if(pDrift.cols.length === 0) return null;
            var lastX = pDrift.cols[pDrift.cols.length - 1].x;
            if(pStepX < 0 && lastX === 0) return "edge";
            if(pStepX > 0 && lastX === W - 1) return "edge";
            return null;
        }

        function buildSideOptions(pStartX, pStepX) {
            var opts = [];
            var up = tryDrift(pStartX, pStepX, -1);
            var dn = tryDrift(pStartX, pStepX, +1);
            var upType = classifyDrift(up, pStepX);
            var dnType = classifyDrift(dn, pStepX);
            if(upType) opts.push({ type: upType, cols: up.cols, fadeOff: up.fadeOff, delta: -1 });
            if(dnType) opts.push({ type: dnType, cols: dn.cols, fadeOff: dn.fadeOff, delta: +1 });
            return opts;
        }

        function applyRunWobble(pTopRowYByColumn, pRunStart, pRunEnd) {
            // Within the at-baseTopY run, apply the same mapm4-style
            // bunched stepping used by tryDrift — but bounded to ±1 row from
            // baseTopY so the cliff still reads as a horizontal terrace
            // rather than another diagonal. mapm4's top run swings ±2 over
            // its length; we use ±1 here so the diff with the surrounding
            // drift extensions (which start at baseTopY ± 1) stays ≤ 1 and
            // the determineRequiredRole stepUp/stepDown inference always
            // resolves cleanly.
            //
            // Per-column decision is hashed on (seed, x, bandY) so the
            // shape is deterministic per seed. A column that fails
            // ColumnFits at the wobbled y stays at the previous y.
            var cy = baseTopY;
            var deviation = 0;
            var consecutiveFlat = 0;
            var maxDeviation = 1;
            for(var wx = pRunStart; wx <= pRunEnd; ++wx) {
                var hash = MapGen.Random.HashTile(pContext.Seed, wx, pBandY, 5519);
                var doStep = ((hash % 100) < 35) || (consecutiveFlat >= 4);
                if(doStep) {
                    var dir;
                    if(deviation >= maxDeviation) dir = -1;
                    else if(deviation <= -maxDeviation) dir = 1;
                    else dir = ((hash >>> 7) & 1) ? 1 : -1;
                    var ny = cy + dir;
                    if(ColumnFits(pContext, wx, ny, pStampHeight, pCliff, fitOptions)) {
                        cy = ny;
                        deviation += dir;
                        consecutiveFlat = 0;
                    } else {
                        consecutiveFlat = consecutiveFlat + 1;
                    }
                } else {
                    consecutiveFlat = consecutiveFlat + 1;
                }
                pTopRowYByColumn[wx] = cy;
            }
        }

        function buildPath(pRun, pLeftOpt, pRightOpt) {
            var topRowYByColumn = new Array(W);
            for(var ix = 0; ix < W; ++ix) topRowYByColumn[ix] = baseTopY;

            var cliffStartX = pRun.start;
            var cliffEndX = pRun.end;

            // Pin the run-edge column at baseTopY whenever there's drift on
            // that side — otherwise the wobble's ±1 swing can collide with
            // drift's ±1 first step to produce a 2-row boundary jump that
            // determineRequiredRole can't infer (only ±1 maps to step roles).
            // With pinning, drift→run transitions are always exactly ±1 row.
            var wobbleStart = (pLeftOpt.cols.length > 0)  ? pRun.start + 1 : pRun.start;
            var wobbleEnd   = (pRightOpt.cols.length > 0) ? pRun.end - 1   : pRun.end;
            if(wobbleEnd >= wobbleStart)
                applyRunWobble(topRowYByColumn, wobbleStart, wobbleEnd);

            for(var li = 0; li < pLeftOpt.cols.length; ++li) {
                var lc = pLeftOpt.cols[li];
                topRowYByColumn[lc.x] = lc.topY;
                cliffStartX = lc.x;
            }
            for(var rri = 0; rri < pRightOpt.cols.length; ++rri) {
                var rc = pRightOpt.cols[rri];
                topRowYByColumn[rc.x] = rc.topY;
                cliffEndX = rc.x;
            }

            // Both ends are pre-classified clean, so extrapolation is
            // unambiguous: x=0/W-1 edge → 0 (no plateau past edge); fadeOff
            // → 0 if drift went up, H if drift went down.
            if(cliffStartX > 0) {
                var leftExtrapVal = pLeftOpt.fadeOff ? (pLeftOpt.delta < 0 ? 0 : H) : 0;
                for(var le = 0; le < cliffStartX; ++le) topRowYByColumn[le] = leftExtrapVal;
            }
            if(cliffEndX < W - 1) {
                var rightExtrapVal = pRightOpt.fadeOff ? (pRightOpt.delta < 0 ? 0 : H) : 0;
                for(var re = cliffEndX + 1; re < W; ++re) topRowYByColumn[re] = rightExtrapVal;
            }

            return {
                startX: cliffStartX,
                endX: cliffEndX,
                runStart: pRun.start,
                runEnd: pRun.end,
                baseTopY: baseTopY,
                bandY: pBandY,
                topRowYByColumn: topRowYByColumn,
                columnsCount: cliffEndX - cliffStartX + 1,
                leftFadeOffMap: pLeftOpt.fadeOff,
                rightFadeOffMap: pRightOpt.fadeOff,
                leftDelta: pLeftOpt.delta,
                rightDelta: pRightOpt.delta,
                driftDelta: pRightOpt.delta || pLeftOpt.delta || 0,
                leftEndType: pLeftOpt.type,
                rightEndType: pRightOpt.type
            };
        }

        var paths = [];
        for(var ri = 0; ri < runs.length; ++ri) {
            var run = runs[ri];

            var leftOptions = (run.start === 0)
                ? [{ type: "edge", cols: [], fadeOff: false, delta: 0 }]
                : buildSideOptions(run.start - 1, -1);

            var rightOptions = (run.end === W - 1)
                ? [{ type: "edge", cols: [], fadeOff: false, delta: 0 }]
                : buildSideOptions(run.end + 1, +1);

            for(var lo = 0; lo < leftOptions.length; ++lo) {
                for(var ro = 0; ro < rightOptions.length; ++ro)
                    paths.push(buildPath(run, leftOptions[lo], rightOptions[ro]));
            }
        }
        return paths;
    }

    function bestBandYInLegacy(pContext, pMinY, pMaxY, pStampHeight, pPreferredY) {
        var bestScore = -1;
        var ties = [];
        for(var y = pMinY; y <= pMaxY; ++y) {
            var s = scoreBandYLegacy(pContext, y, pStampHeight);
            if(s > bestScore) {
                bestScore = s;
                ties = [y];
            } else if(s === bestScore) {
                ties.push(y);
            }
        }
        if(!ties.length) return { y: -1, score: 0 };
        var pick = ties[0];
        if(pPreferredY === undefined)
            pick = ties[pContext.Random.Int(0, ties.length - 1)];
        else for(var t = 1; t < ties.length; ++t)
            if(Math.abs(ties[t] - pPreferredY) < Math.abs(pick - pPreferredY)) pick = ties[t];
        return { y: pick, score: bestScore };
    }

    // The 9 valid edge-pair topologies a cliff can take. Each is
    // (leftEndType, rightEndType) where end-types are drawn from
    // {edge, topFade, bottomFade}. Same-edge "snake" topologies (left↔left,
    // right↔right) aren't representable with one topRowY per column.
    // Interior-stop topologies were tried and rolled back (2026-06-15) —
    // cliffs that terminate in flat walkable snow are visually broken.
    var TOPOLOGIES = [
        ["edge",       "edge"      ],
        ["edge",       "topFade"   ],
        ["edge",       "bottomFade"],
        ["topFade",    "edge"      ],
        ["bottomFade", "edge"      ],
        ["topFade",    "topFade"   ],
        ["bottomFade", "bottomFade"],
        ["topFade",    "bottomFade"],
        ["bottomFade", "topFade"   ]
    ];

    function shuffledTopologies(pContext) {
        var t = TOPOLOGIES.slice();
        for(var i = t.length - 1; i > 0; --i) {
            var j = pContext.Random.Int(0, i);
            var tmp = t[i]; t[i] = t[j]; t[j] = tmp;
        }
        return t;
    }

    // Topology-first selection: collect every qualifying path across all
    // bandYs, shuffle the 9 valid topologies, and try them in order. The
    // first topology that has at least one matching path of length
    // ≥ MIN_CLIFF_RUN wins (longest path picked, with random tiebreak).
    // Falls back through all 9 topologies before giving up.
    //
    // Option C bandY pre-filter (2026-06-16): rather than sweep every
    // bandY in [pMinY..pMaxY], pre-rank by summariseBandYClearance and
    // take the top K=8 (or all bandYs with clearRunLongest >= MIN_CLIFF_RUN
    // if more than 8 qualify). Falls back to the full sweep if zero
    // bandYs reach MIN_CLIFF_RUN — preserves current behaviour on truly
    // hopeless seeds rather than silently flipping them. RNG-neutral:
    // the pre-score is deterministic; topology shuffle and tiebreak draws
    // fire the same number of times per inspected bandY.
    function bestBandYInPlanner(pContext, pCliff, pMinY, pMaxY, pStampHeight) {
        // Option A short-circuit ([[mapgen_cliff_option_a_staged]]): if
        // CliffReservation pre-reserved a band whose bandY falls in our
        // search range, inspect ONLY that band. The reservation guarantees
        // the run is OPEN-owned, so its clearRunLongest is the runLen the
        // module computed; downstream topology + drift logic still runs
        // and can still reject. Falls through to the K=8 sweep if the
        // reservation is out of range (rare — CliffReservation uses the
        // same TOP_MARGIN/BOTTOM_MARGIN as Plateau). Ice-only in practice
        // because CliffReservation only writes for ice profiles.
        var reservation = pContext.CliffReserve;
        if(reservation && reservation.bandY >= pMinY && reservation.bandY <= pMaxY) {
            var inspectList = [{
                y: reservation.bandY,
                clearRunLongest: reservation.runLen
            }];
            MapGen.Context.AddLog(pContext, "Plateau bandY reservation hit at y=" +
                reservation.bandY + " runLen=" + reservation.runLen +
                " (Option A short-circuit)");
            var allPaths = [];
            for(var rii = 0; rii < inspectList.length; ++rii) {
                var rpy = inspectList[rii].y;
                var rpaths = planAllCliffPathsAtBandY(pContext, pCliff, rpy, pStampHeight);
                for(var rpi = 0; rpi < rpaths.length; ++rpi) allPaths.push(rpaths[rpi]);
            }
            if(allPaths.length) {
                var rTopologies = shuffledTopologies(pContext);
                for(var rti = 0; rti < rTopologies.length; ++rti) {
                    var rt = rTopologies[rti];
                    var rMatching = [];
                    var rBestLen = 0;
                    for(var rpi2 = 0; rpi2 < allPaths.length; ++rpi2) {
                        var rp = allPaths[rpi2];
                        if(rp.leftEndType !== rt[0] || rp.rightEndType !== rt[1]) continue;
                        rMatching.push(rp);
                        if(rp.columnsCount > rBestLen) rBestLen = rp.columnsCount;
                    }
                    if(!rMatching.length || rBestLen < MIN_CLIFF_RUN) continue;
                    var rTies = [];
                    for(var rmi = 0; rmi < rMatching.length; ++rmi)
                        if(rMatching[rmi].columnsCount === rBestLen) rTies.push(rMatching[rmi]);
                    var rPick = rTies[pContext.Random.Int(0, rTies.length - 1)];
                    return {
                        y: rPick.bandY,
                        score: rPick.columnsCount,
                        path: rPick,
                        topology: rt[0] + "-" + rt[1]
                    };
                }
            }
            // Reservation in-range but no path emerged from that bandY —
            // fall through to the legacy K=8 sweep so we don't drop a
            // seed that had a viable cliff at a different bandY.
            MapGen.Context.AddLog(pContext, "Plateau reservation in-range but yielded no path; falling back to K=8 sweep");
        } else if(reservation) {
            MapGen.Context.AddLog(pContext, "Plateau reservation bandY=" + reservation.bandY +
                " out of range [" + pMinY + ".." + pMaxY + "]; falling back to K=8 sweep");
        }

        var scored = [];
        for(var y = pMinY; y <= pMaxY; ++y) {
            var sc = summariseBandYClearance(pContext, y, pStampHeight);
            scored.push({ y: y, clearRunLongest: sc.clearRunLongest });
        }
        // Stable sort: clearRunLongest desc, then y asc as deterministic tiebreak.
        scored.sort(function(a, b) {
            if(a.clearRunLongest !== b.clearRunLongest) return b.clearRunLongest - a.clearRunLongest;
            return a.y - b.y;
        });
        var qualifying = [];
        for(var qi = 0; qi < scored.length; ++qi) {
            if(scored[qi].clearRunLongest >= MIN_CLIFF_RUN) qualifying.push(scored[qi]);
        }
        // Top-K filter: inspect K=8 highest-clearance bandYs, OR all
        // qualifying (clearRunLongest >= MIN_CLIFF_RUN) if more than 8
        // qualify. If zero qualify, sweep the full range — preserves
        // current behaviour on hopeless seeds rather than silently
        // flipping them to no-cliff.
        var K = 8;
        var inspectList;
        if(qualifying.length === 0) {
            inspectList = scored;
        } else if(qualifying.length > K) {
            inspectList = qualifying;
        } else {
            inspectList = scored.slice(0, K);
        }

        // Diagnostic: log the top clearRunLongest distribution so post-batch
        // audit can distinguish "lever fired" from "lever fired but topology
        // rejected" from "truly hopeless seed" (per Option C review must-fix).
        var topRuns = scored.slice(0, 12).map(function(s){ return s.clearRunLongest; });
        MapGen.Context.AddLog(pContext, "Plateau bandY scan (top 12 clearRuns): [" +
            topRuns.join(",") + "] qualifying=" + qualifying.length);

        var allPaths = [];
        for(var ii = 0; ii < inspectList.length; ++ii) {
            var py = inspectList[ii].y;
            var paths = planAllCliffPathsAtBandY(pContext, pCliff, py, pStampHeight);
            for(var pi = 0; pi < paths.length; ++pi) allPaths.push(paths[pi]);
        }
        if(!allPaths.length) return { y: -1, score: 0 };

        var topologies = shuffledTopologies(pContext);
        for(var ti = 0; ti < topologies.length; ++ti) {
            var t = topologies[ti];
            var matching = [];
            var bestLen = 0;
            for(var pi2 = 0; pi2 < allPaths.length; ++pi2) {
                var p = allPaths[pi2];
                if(p.leftEndType !== t[0] || p.rightEndType !== t[1]) continue;
                matching.push(p);
                if(p.columnsCount > bestLen) bestLen = p.columnsCount;
            }
            if(!matching.length || bestLen < MIN_CLIFF_RUN) continue;
            var ties = [];
            for(var mi = 0; mi < matching.length; ++mi)
                if(matching[mi].columnsCount === bestLen) ties.push(matching[mi]);
            var pick = ties[pContext.Random.Int(0, ties.length - 1)];
            return {
                y: pick.bandY,
                score: pick.columnsCount,
                path: pick,
                topology: t[0] + "-" + t[1]
            };
        }
        return { y: -1, score: 0 };
    }

    function pickBandY(pContext, pCliff, pMinBandY, pMaxBandY, pStampHeight) {
        var anchorYs = collectAnchorYs(pContext);
        var ranges = [];
        var hasCliffTransit = (pCliff && pCliff.Stairs && pCliff.StairsWidth && pCliff.StairsHeight) ||
            (pContext.Profile && pContext.Profile.HelicopterTransit === true);

        if(anchorYs.length === 0 || hasCliffTransit) {
            ranges.push([pMinBandY, pMaxBandY]);
        } else {
            var minAnchor = anchorYs[0];
            var maxAnchor = anchorYs[0];
            for(var i = 1; i < anchorYs.length; ++i) {
                if(anchorYs[i] < minAnchor) minAnchor = anchorYs[i];
                if(anchorYs[i] > maxAnchor) maxAnchor = anchorYs[i];
            }
            var maxAbove = Math.min(pMaxBandY, minAnchor - ANCHOR_CLEARANCE);
            if(maxAbove >= pMinBandY) ranges.push([pMinBandY, maxAbove]);
            var minBelow = Math.max(pMinBandY, maxAnchor + ANCHOR_CLEARANCE);
            if(pMaxBandY >= minBelow) ranges.push([minBelow, pMaxBandY]);
        }

        if(!ranges.length) return { y: -1, score: 0, reason: "anchors" };

        var usePlanner = pCliff && pCliff.SchemaVersion === 2;
        var best = { y: -1, score: -1 };
        for(var r = 0; r < ranges.length; ++r) {
            var pick = usePlanner
                ? bestBandYInPlanner(pContext, pCliff, ranges[r][0], ranges[r][1], pStampHeight)
                : bestBandYInLegacy(pContext, ranges[r][0], ranges[r][1], pStampHeight);
            if(pick.score > best.score) best = pick;
        }
        if(pContext.Profile && pContext.Profile.RequireFullWidthCliffs === true &&
            best.score < pContext.Width)
            return { y: -1, score: best.score, reason: "notFullWidth" };
        if(best.score < MIN_CLIFF_RUN)
            return { y: -1, score: best.score, reason: "shortRun" };
        best.reason = "ok";
        return best;
    }

    function build(pContext) {
        if(!pContext || !pContext.Profile)
            return pContext;

        var profile = pContext.Profile;

        if(!isBiomeSupported(profile.TerrainType)) {
            MapGen.Context.AddLog(pContext, "Plateau pass skipped (biome unsupported)");
            return pContext;
        }

        var plateauChance = profile.PlateauChance;
        var cliffChance = profile.CliffChance;

        if(typeof plateauChance !== "number" || plateauChance <= 0) {
            MapGen.Context.AddLog(pContext, "Plateau pass skipped (PlateauChance=0)");
            return pContext;
        }
        if(typeof cliffChance !== "number" || cliffChance <= 0) {
            MapGen.Context.AddLog(pContext, "Plateau pass skipped (CliffChance=0 — terrace is meaningless without cliff)");
            return pContext;
        }

        if(!pContext.Random.Chance(plateauChance)) {
            MapGen.Context.AddLog(pContext, "Plateau roll missed (chance=" + plateauChance.toFixed(2) + ")");
            return pContext;
        }

        var stampHeight = STAMP_HEIGHT[profile.TerrainType];
        var minBandY = TOP_MARGIN + (stampHeight - 1);
        var maxBandY = pContext.Height - 1 - plateauBottomMargin(profile);

        if(maxBandY <= minBandY) {
            MapGen.Context.AddLog(pContext, "Plateau placement skipped (map too small for terrace band)");
            return pContext;
        }

        var cliff = cliffData(pContext);
        var picked = pickBandY(pContext, cliff, minBandY, maxBandY, stampHeight);
        // Building approaches are walking routes, even on helicopter maps.
        // Keep room in all three sector rows on the start's side of a solid
        // band. Preserve the original choice whenever it already leaves room.
        var hasStairs = cliff && cliff.Stairs && cliff.StairsWidth && cliff.StairsHeight;
        var requiresStructureRows = Number(profile.MapScaleStructureFloor || 0) >= 5 &&
            pContext.Width * pContext.Height >= 10000;
        var start = pContext.Anchors && pContext.Anchors.start;
        if(picked.y >= 0 && start && profile.RequireFullWidthCliffs === true &&
            !hasStairs && (!cliff || cliff.SchemaVersion !== 2) && requiresStructureRows &&
            !MapGen.Context.IsMultiplayer(pContext)) {
            var originalBand = picked;
            // Two cells for cliff art, four for the largest apron, two for
            // half a building, and two for the three-cell candidate lattice.
            var clearance = typeof profile.StructureCliffClearance === "number" ?
                Math.max(0, Math.floor(profile.StructureCliffClearance)) : 2;
            var rowMargin = 10 + clearance;
            var above = Math.floor(pContext.Height / 3) - rowMargin;
            var below = Math.ceil(pContext.Height * 2 / 3) + rowMargin + stampHeight - 1;
            var anchorYs = collectAnchorYs(pContext);
            var allBelow = true, allAbove = true;
            for(var ai = 0; ai < anchorYs.length; ++ai) {
                if(anchorYs[ai] <= picked.y) allBelow = false;
                if(anchorYs[ai] >= picked.y - stampHeight + 1) allAbove = false;
            }
            // A layout that already spans both sides has its own transit
            // plan. Only adjust a cliff that cuts off rows from every anchor.
            if(allBelow && picked.y > above)
                picked = bestBandYInLegacy(pContext, minBandY, Math.min(maxBandY, above), stampHeight, picked.y);
            else if(allAbove && picked.y < below)
                picked = bestBandYInLegacy(pContext, Math.max(minBandY, below), maxBandY, stampHeight, picked.y);
            // Water may leave no full-width alternative. Retain the authored
            // terrace and normal cliff roll instead of deleting the feature
            // and shifting every later random choice.
            if(picked.score < pContext.Width) picked = originalBand;
        }
        if(picked.y < 0) {
            var why = (picked.reason === "shortRun")
                ? ("planner run too short — best=" + picked.score + " < " + MIN_CLIFF_RUN)
                : (picked.reason === "notFullWidth")
                    ? ("no uninterrupted full-width dry band — best=" + picked.score + "/" + pContext.Width)
                : "anchors span vertical centre — no safe band";
            MapGen.Context.AddLog(pContext, "Plateau placement skipped (" + why + ")");
            return pContext;
        }
        var bandY = picked.y;
        var topRowY = bandY - (stampHeight - 1);

        // For the legacy (jungle/desert) path no cliffPath is produced; build
        // a flat topRowYByColumn at baseTopY so downstream consumers still
        // have a per-column array to read.
        var topRowYByColumn;
        if(picked.path) {
            topRowYByColumn = picked.path.topRowYByColumn;
        } else {
            topRowYByColumn = new Array(pContext.Width);
            for(var ti = 0; ti < pContext.Width; ++ti) topRowYByColumn[ti] = topRowY;
        }

        // Per-column elevation: y < topRowYByColumn[x] is plateau.
        var plateauCells = 0;
        for(var x = 0; x < pContext.Width; ++x) {
            var colTop = topRowYByColumn[x];
            if(colTop > pContext.Height) colTop = pContext.Height;
            if(colTop < 0) colTop = 0;
            for(var y = 0; y < colTop; ++y) {
                MapGen.Layers.Set(pContext.Layers.elevation, x, y, 1);
                ++plateauCells;
            }
        }

        pContext.Plateau = {
            mode: "terrace",
            bandY: bandY,
            topRowY: topRowY,
            cliffPath: picked.path || null,
            topRowYByColumn: topRowYByColumn,
            stampHeight: stampHeight,
            area: plateauCells,
            boundaryLength: pContext.Width,
            bounds: {
                minX: 0,
                maxX: pContext.Width - 1,
                minY: 0,
                maxY: topRowY - 1
            }
        };

        var pathLog = "";
        if(picked.path) {
            var p = picked.path;
            function deltaName(d) { return d < 0 ? "up" : (d > 0 ? "down" : "none"); }
            pathLog = " topo=" + (picked.topology || "?") +
                " cliff=[" + p.startX + ".." + p.endX + "]" +
                " run=[" + p.runStart + ".." + p.runEnd + "]" +
                " leftDrift=" + deltaName(p.leftDelta || 0) +
                " rightDrift=" + deltaName(p.rightDelta || 0) +
                (p.leftFadeOffMap ? " leftFade" : "") +
                (p.rightFadeOffMap ? " rightFade" : "");
        }
        MapGen.Context.AddLog(pContext, "Plateau terrace bandY=" + bandY +
            " topRow=" + topRowY + " plateauCells=" + plateauCells +
            " pathCols=" + picked.score + pathLog);
        return pContext;
    }

    return {
        Build: build
    };
})();
