var MapGen = MapGen || {};
MapGen.Features = MapGen.Features || {};

// Cliff stamper — per-column placement.
//
// For each output column along the plateau band, the placer:
//   1. Picks one body strip from Structures.<Biome>.Cliff.Strips (deterministic
//      hash on column).
//   2. Optionally picks a top-edge tile for the row above the body (jungle
//      only — ice strips already include the top row).
//   3. Verifies every cell in the column footprint is free of water/river/
//      coast/crossing/path/keepClear/occupied. A single conflict skips that
//      column only — neighbouring columns still place. This is the fix for
//      the old "all-or-nothing 6-wide stamp" that left ~5-column gaps every
//      time a river or path crossed the band.
//
// Ice cliffs additionally stamp a 3×4 stairs piece once per band at a random
// valid column, giving units a walkable transit through the cliff. Stairs
// override blocked/keepClear → walkable + path.
//
// Two-phase design preserved:
//   1. Build(pContext)            — decides placement, marks layers (incl.
//                                   owner==CLIFF on body cells), records
//                                   triplets in pContext.Cliffs.
//   2. OverlayTiles(pContext, t)  — writes triplets into the rendered tile
//                                   grid post-smoothing.
// (The old phase 3, ReassertFootprint, is gone — SmoothBlockedMaskPass is now
//  owner-aware and preserves owner==CLIFF body cells, so the footprint survives
//  the cover pass and repair loop without a re-stamp.)
//
// Legacy fallback: biomes whose cliff data still uses the old `Variants`
// (monolithic-stamp) shape — i.e. Desert until it gets retagged — fall
// through to the original block-stamp pass at the bottom of build().
MapGen.Features.PlateauCliffs = (function() {

    function biomeName(pTerrainType) {
        return MapGen.Terrain.BiomeStrategy.CliffBiomeName(pTerrainType);
    }

    function cliffData(pContext) {
        var name = biomeName(pContext.Profile.TerrainType);
        if(!name) return null;
        if(!Structures[name] || !Structures[name].Cliff) return null;
        return Structures[name].Cliff;
    }

    function invalidateCliffCharmapCaches(pContext) {
        if(!pContext)
            return;
        pContext._cliffFootprint = undefined;
        pContext._cliffTopApron = undefined;
        pContext._cliffFootApron = undefined;
    }

    // Reserve the visible landing immediately below every cliff column.
    //
    // Cliff art is overlaid after terrain smoothing.  Protecting only the
    // body therefore lets the cover pass author trees directly underneath
    // it; the late overlay hides part of those trees while neighbouring tree
    // tiles still render as connected canopy.  The result is the ragged,
    // apparently truncated lower edge seen on generated cliff maps.
    //
    // Shipped jungle and ice cliffs leave a short, walkable landing below the
    // face.  Keep two rows clear and expose the cells as a small lookup set so
    // decor templates which deliberately allow keepClear (shrubs) also avoid
    // painting into the landing.  The second row bleeds one cell sideways to
    // keep stepped ice feet and edge exits from acquiring diagonal tree nubs.
    function reserveCliffFootApron(pContext) {
        if(!pContext || !pContext.Cliffs || !pContext.Cliffs.length)
            return 0;

        var layers = pContext.Layers;
        var apron = pContext.CliffFootApron = {};
        var reserved = 0;

        for(var i = 0; i < pContext.Cliffs.length; ++i) {
            var triplets = pContext.Cliffs[i].triplets || [];
            var bottomByX = {};

            for(var t = 0; t < triplets.length; ++t) {
                var trip = triplets[t];
                var key = String(trip.x);
                if(!bottomByX[key] || trip.y > bottomByX[key])
                    bottomByX[key] = trip.y;
            }

            for(var xKey in bottomByX) {
                if(!bottomByX.hasOwnProperty(xKey))
                    continue;
                var baseX = Number(xKey);
                for(var dy = 1; dy <= 2; ++dy) {
                    var y = bottomByX[xKey] + dy;
                    var bleed = dy === 2 ? 1 : 0;
                    for(var dx = -bleed; dx <= bleed; ++dx) {
                        var x = baseX + dx;
                        if(!MapGen.Layers.InBounds(layers.blocked, x, y))
                            continue;
                        if(MapGen.Layers.Get(layers.water, x, y, 0) ||
                            MapGen.Layers.Get(layers.riverBank, x, y, 0) ||
                            MapGen.Layers.Get(layers.coast, x, y, 0))
                            continue;

                        var apronKey = x + "," + y;
                        if(!apron[apronKey]) {
                            apron[apronKey] = true;
                            ++reserved;
                        }
                        MapGen.Layers.Set(layers.keepClear, x, y, 1);

                        // A pre-authored/template tree may already occupy the
                        // landing when the cliff runs in the layout phase.
                        // Only erase ordinary open/tree cover; never demolish
                        // a route, structure, object, or another feature.
                        var owner = layers.owner ?
                            MapGen.Layers.Get(layers.owner, x, y, 0) : 0;
                        if(owner <= MapGen.Layers.Owner.TREE)
                            MapGen.Layers.Set(layers.blocked, x, y, 0);
                    }
                }
            }
        }

        if(reserved)
            MapGen.Context.AddLog(pContext,
                "Reserved cliff foot apron: " + reserved + " cell(s)");
        return reserved;
    }

    function bumpReject(pContext, pReason) {
        if(!pContext.CliffRejectStats)
            pContext.CliffRejectStats = {};
        pContext.CliffRejectStats[pReason] = (pContext.CliffRejectStats[pReason] || 0) + 1;
    }

    // Cliff-reservation revert ([[mapgen_cliff_option_a_staged]]).
    //
    // Walk the reservation bbox; for each cell where cliffReserve=1 AND the
    // owner did NOT end up CLIFF (= Plateau didn't actually stamp a cliff
    // body there), clear cliffReserve=0. Two failure modes need this:
    //   (a) build() returned early (CliffChance=0, no cliff data, dice
    //       missed) — the entire strip stays reserved with no cliff to
    //       justify it.
    //   (b) build() ran but the planner emerged with a path that doesn't
    //       fully cover the reserved strip (drift fade, partial run, or
    //       the reservation bandY fell through to a different K=8 winner).
    //
    // Without this revert, leaked reservation cells continue ghost-protecting
    // against later passes (Clearings, Outcrops, decor, anything that reads
    // the bool), starving structures and trees on hopeless seeds.
    //
    // No-op on non-ice (no reservation written) and on success cases where
    // every cell flips to owner==CLIFF.
    function revertUnusedCliffReservation(pContext) {
        if(!pContext || !pContext.CliffReserve || !pContext.Layers)
            return 0;
        var layers = pContext.Layers;
        var cliffReserve = layers.cliffReserve;
        var owner = layers.owner;
        if(!cliffReserve || !owner)
            return 0;
        var reservation = pContext.CliffReserve;
        var x0 = reservation.runStart;
        var x1 = reservation.runEnd;
        var y0 = reservation.topRowY;
        var y1 = reservation.topRowY + (reservation.bandY - reservation.topRowY);
        var CLIFF = MapGen.Layers.Owner.CLIFF;
        var cleared = 0;
        for(var x = x0; x <= x1; ++x) {
            for(var y = y0; y <= y1; ++y) {
                if(!MapGen.Layers.Get(cliffReserve, x, y, 0))
                    continue;
                if(MapGen.Layers.Get(owner, x, y, 0) === CLIFF)
                    continue;
                MapGen.Layers.Set(cliffReserve, x, y, 0);
                ++cleared;
            }
        }
        if(cleared)
            MapGen.Context.AddLog(pContext, "Reverted unused cliff reservation: " + cleared + " cell(s)");
        return cleared;
    }

    function cellBlocksStamp(pContext, pX, pY, pOptions) {
        var options = pOptions || {};
        var layers = pContext.Layers;
        if(!MapGen.Layers.InBounds(layers.blocked, pX, pY)) { bumpReject(pContext, "oob"); return true; }

        var ownerValue = layers.owner ? MapGen.Layers.Get(layers.owner, pX, pY, 0) : 0;
        var routeCell = ownerValue === MapGen.Layers.Owner.ROUTE ||
            MapGen.Layers.Get(layers.path, pX, pY, 0);

        // Architecture v3: never wall off the reserved ROUTE corridor (Skeleton
        // claims it before water/cliffs). The real route also sets keepClear by
        // the time cliffs run, but the owner check is the authoritative guard.
        if(ownerValue === MapGen.Layers.Owner.ROUTE && !options.allowRouteTransit) { bumpReject(pContext, "route"); return true; }
        if(MapGen.Layers.Get(layers.water, pX, pY, 0)) { bumpReject(pContext, "water"); return true; }
        if(MapGen.Layers.Get(layers.riverBank, pX, pY, 0)) { bumpReject(pContext, "riverBank"); return true; }
        if(MapGen.Layers.Get(layers.coast, pX, pY, 0)) { bumpReject(pContext, "coast"); return true; }
        if(MapGen.Layers.Get(layers.crossing, pX, pY, 0)) { bumpReject(pContext, "crossing"); return true; }
        if(MapGen.Layers.Get(layers.path, pX, pY, 0) && !options.allowRouteTransit) { bumpReject(pContext, "path"); return true; }
        if(MapGen.Layers.Get(layers.keepClear, pX, pY, 0) &&
            !(options.allowRouteTransit && routeCell)) { bumpReject(pContext, "keepClear"); return true; }
        if(MapGen.Layers.Get(layers.occupied, pX, pY, 0)) { bumpReject(pContext, "occupied"); return true; }
        return false;
    }

    function columnFits(pContext, pX, pTopRowY, pHeight, pOptions) {
        for(var r = 0; r < pHeight; ++r) {
            if(cellBlocksStamp(pContext, pX, pTopRowY + r, pOptions))
                return false;
        }
        return true;
    }

    function pickIndex(pContext, pColumn, pSalt, pCount) {
        var hash = MapGen.Random.HashTile(pContext.Seed, pColumn, pSalt, 0);
        return hash % pCount;
    }

    function pickWeighted(pContext, pColumn, pSalt, pCandidates) {
        // pCandidates: [{ weight, ...payload }]. Returns one candidate or null.
        var totalWeight = 0;
        for(var i = 0; i < pCandidates.length; ++i)
            totalWeight += (pCandidates[i].weight || 1);
        if(totalWeight <= 0)
            return null;
        var hash = MapGen.Random.HashTile(pContext.Seed, pColumn, pSalt, 0);
        var roll = hash % totalWeight;
        for(var j = 0; j < pCandidates.length; ++j) {
            roll -= (pCandidates[j].weight || 1);
            if(roll < 0) return pCandidates[j];
        }
        return pCandidates[pCandidates.length - 1];
    }

    function columnFitsRiverAware(pContext, pX, pTopRowY, pHeight, pCliff, pOptions) {
        // In-bounds-only fit gate for the bending v2 walker. Off-map rows
        // (y<0 or y>=Height) are not stamped — they're the visual fade — so
        // they're not checked. At least one row must be in-bounds.
        var mapH = pContext.Height;
        var inBoundsCount = 0;
        for(var r = 0; r < pHeight; ++r) {
            var y = pTopRowY + r;
            if(y < 0 || y >= mapH) continue;
            if(cellBlocksStamp(pContext, pX, y, pOptions))
                return false;
            ++inBoundsCount;
        }
        return inBoundsCount > 0;
    }

    function commitColumnRiverAware(pContext, pX, pTopRowY, pStripTiles) {
        // Skip rows whose y is off-map: those rows are the cliff visually
        // fading off the top/bottom edge. Triplets only emitted for in-bounds
        // rows; layer flags only set for in-bounds rows.
        var triplets = [];
        var height = pStripTiles.length;
        var mapH = pContext.Height;
        for(var r = 0; r < height; ++r) {
            var ty = pTopRowY + r;
            if(ty < 0 || ty >= mapH) continue;
            triplets.push({ x: pX, y: ty, tileId: pStripTiles[r] });
            MapGen.Layers.Set(pContext.Layers.blocked, pX, ty, 1);
            MapGen.Layers.Set(pContext.Layers.keepClear, pX, ty, 1);
            // Architecture v3: cliff body claims CLIFF ownership so later tree
            // fill (which reads owner) cannot paint over the cliff footprint —
            // this is what makes the legacy ReassertFootprint hack redundant.
            MapGen.Layers.ClaimCell(pContext.Layers.owner, pX, ty, MapGen.Layers.Owner.CLIFF);
        }
        return { triplets: triplets };
    }

    // Phase G river-foot machinery (applyRiverFootRoles, pickRiverBaseTile,
    // paintSegmentEdges, columnCrossesWater) was removed: shipped ice maps
    // never overlap cliffs with water, so the cliff just routes around the
    // river via per-cell fit rejection. See memory project_cliff_no_water_overlap.

    function commitColumn(pContext, pX, pTopRowY, pStrip, pTopEdgeTile) {
        var triplets = [];

        for(var r = 0; r < pStrip.length; ++r) {
            var ty = pTopRowY + r;
            triplets.push({ x: pX, y: ty, tileId: pStrip[r] });
            MapGen.Layers.Set(pContext.Layers.blocked, pX, ty, 1);
            MapGen.Layers.Set(pContext.Layers.keepClear, pX, ty, 1);
            // Architecture v3: claim CLIFF ownership (see commitColumnRiverAware).
            MapGen.Layers.ClaimCell(pContext.Layers.owner, pX, ty, MapGen.Layers.Owner.CLIFF);
        }

        if(pTopEdgeTile !== null && pTopEdgeTile !== undefined && pTopRowY > 0) {
            var edgeY = pTopRowY - 1;
            triplets.push({ x: pX, y: edgeY, tileId: pTopEdgeTile });
            // Top edge is plateau ground (walkable on top), but mark keepClear
            // so trees/decor don't paint over the visible cliff lip.
            MapGen.Layers.Set(pContext.Layers.keepClear, pX, edgeY, 1);
        }

        return triplets;
    }

    function commitStairs(pContext, pCliff, pOriginX, pOriginY) {
        var triplets = [];
        for(var r = 0; r < pCliff.StairsHeight; ++r) {
            for(var c = 0; c < pCliff.StairsWidth; ++c) {
                var tx = pOriginX + c;
                var ty = pOriginY + r;
                triplets.push({ x: tx, y: ty, tileId: pCliff.Stairs[r][c] });
                // Stairs are walkable transit — clear blocked, set path so
                // Metrics.IsWalkable lights up; keep keepClear set so decor
                // passes don't paint over the artwork.
                MapGen.Layers.Set(pContext.Layers.blocked, tx, ty, 0);
                MapGen.Layers.Set(pContext.Layers.path, tx, ty, 1);
                MapGen.Layers.Set(pContext.Layers.keepClear, tx, ty, 1);
            }
        }
        return triplets;
    }

    function placeStairs(pContext, pCliff, pTopRowY, pColumns) {
        // Legacy v1 stair placer (jungle/desert) — single shared topRowY,
        // pre-walk pick. Ice schema v2 uses placeStairsPostWalk which honours
        // per-column drift.
        if(!pCliff.Stairs || !pCliff.StairsWidth || !pCliff.StairsHeight)
            return null;
        if(!pColumns.length)
            return null;
        var originY = pTopRowY + pCliff.StampHeight - pCliff.StairsHeight;
        if(originY < 0) originY = pTopRowY;
        var placedCols = {};
        for(var i = 0; i < pColumns.length; ++i)
            placedCols[pColumns[i].x] = true;
        var candidates = [];
        for(var c = 0; c < pColumns.length; ++c) {
            var ox = pColumns[c].x;
            var spans = true;
            for(var d = 0; d < pCliff.StairsWidth; ++d) {
                if(!placedCols[ox + d]) { spans = false; break; }
            }
            if(spans) candidates.push(ox);
        }
        if(!candidates.length) return null;
        var pick = candidates[pickIndex(pContext, 0, 9991, candidates.length)];
        var triplets = commitStairs(pContext, pCliff, pick, originY);
        return {
            originX: pick,
            originY: originY,
            width: pCliff.StairsWidth,
            height: pCliff.StairsHeight,
            triplets: triplets
        };
    }

    function placeStairsPostWalk(pContext, pCliff, pRecord) {
        // Stairs are placed after the Wang walk so each cliff column's actual
        // topRowY is known. Find the longest interior run of columns sharing
        // a single topRowY (no step_down drift inside the run, no wet cells
        // inside the stair footprint), and overwrite that run's triplets with
        // the stair stamp. Without this, stairs sit at the segment's base
        // topRowY while step_down has drifted the surrounding cliff body to
        // a deeper row — visually offset by the drift count.
        if(!pCliff.Stairs || !pCliff.StairsWidth || !pCliff.StairsHeight)
            return null;
        var w = pCliff.StairsWidth;
        var h = pCliff.StairsHeight;
        var sh = pCliff.StampHeight;
        var cols = pRecord.columns;
        if(cols.length < w) return null;

        // Index columns by x for adjacency lookup.
        var byX = {};
        for(var i = 0; i < cols.length; ++i) byX[cols[i].x] = cols[i];

        // Candidate windows: w consecutive cols, all same topRowY, all
        // committed body strips. Both flanks must also be committed body at
        // the same topRowY so the stair stamp sits flush with the surrounding
        // cliff — without this constraint the stair window can straddle a
        // segment boundary or step transition.
        var candidates = [];
        for(var k = 0; k < cols.length - (w - 1); ++k) {
            var c0 = cols[k];
            var ok = true;
            var ty0 = c0.topRowY;
            var routeHits = 0;
            for(var d = 1; d < w; ++d) {
                var cd = byX[c0.x + d];
                if(!cd || cd.topRowY !== ty0) { ok = false; break; }
            }
            if(!ok) continue;
            var prev = byX[c0.x - 1];
            var next = byX[c0.x + w];
            if(!prev || prev.topRowY !== ty0) continue;
            if(!next || next.topRowY !== ty0) continue;

            for(var rd = 0; rd < w; ++rd) {
                for(var rr = 0; rr < h; ++rr) {
                    var rx = c0.x + rd;
                    var ry = ty0 + rr;
                    if(MapGen.Layers.Get(pContext.Layers.path, rx, ry, 0))
                        ++routeHits;
                    else if(pContext.Layers.owner &&
                        MapGen.Layers.Get(pContext.Layers.owner, rx, ry, 0) === MapGen.Layers.Owner.ROUTE)
                        ++routeHits;
                }
            }
            candidates.push({ x: c0.x, topRowY: ty0, routeHits: routeHits });
        }
        if(!candidates.length) return null;

        candidates.sort(function(pA, pB) {
            if(pA.routeHits !== pB.routeHits)
                return pB.routeHits - pA.routeHits;
            var ah = MapGen.Random.HashTile(pContext.Seed, pA.x, pA.topRowY, 9991);
            var bh = MapGen.Random.HashTile(pContext.Seed, pB.x, pB.topRowY, 9991);
            if(ah !== bh)
                return ah - bh;
            return pA.x - pB.x;
        });
        var pick = candidates[0];
        var originX = pick.x;
        // Shipped (mapm14 cluster #2 cols 3-5): stair TOP aligns with cliff
        // body top, stair bottom aligns with cliff bottom. With
        // StairsHeight=4 and StampHeight=4 stairs cover the full cliff
        // footprint, replacing the body triplets in the stair window.
        var originY = pick.topRowY;

        // Replace the committed body triplets in the chosen w columns with
        // the stair stamp, and clear blocked / set path on stair cells so
        // they're walkable.
        var stairTriplets = [];
        for(var dx = 0; dx < w; ++dx) {
            var col = byX[originX + dx];
            // Drop any cliff body triplets at the stair footprint rows.
            for(var ty = originY; ty < originY + h; ++ty) {
                for(var ti = col.triplets.length - 1; ti >= 0; --ti) {
                    if(col.triplets[ti].y === ty && col.triplets[ti].x === col.x) {
                        col.triplets.splice(ti, 1);
                    }
                }
                for(var rj = pRecord.triplets.length - 1; rj >= 0; --rj) {
                    if(pRecord.triplets[rj].y === ty && pRecord.triplets[rj].x === col.x) {
                        pRecord.triplets.splice(rj, 1);
                    }
                }
            }
        }
        for(var r = 0; r < h; ++r) {
            for(var c = 0; c < w; ++c) {
                var tx = originX + c;
                var tyy = originY + r;
                var trip = { x: tx, y: tyy, tileId: pCliff.Stairs[r][c] };
                stairTriplets.push(trip);
                pRecord.triplets.push(trip);
                MapGen.Layers.Set(pContext.Layers.blocked, tx, tyy, 0);
                MapGen.Layers.Set(pContext.Layers.path, tx, tyy, 1);
                MapGen.Layers.Set(pContext.Layers.keepClear, tx, tyy, 1);
            }
        }
        return {
            originX: originX,
            originY: originY,
            width: w,
            height: h,
            triplets: stairTriplets
        };
    }

    function indexStripsByRole(pCliff) {
        var byRole = { body: [], leftCap: [], rightCap: [], stepDown: [], stepUp: [] };
        var bodyZeroDelta = [];
        for(var key in pCliff.Strips) {
            if(!pCliff.Strips.hasOwnProperty(key)) continue;
            var s = pCliff.Strips[key];
            if(byRole[s.role]) byRole[s.role].push(key);
            if(s.role === "body" && (s.deltaY | 0) === 0) bodyZeroDelta.push(key);
        }
        return { byRole: byRole, bodyZeroDelta: bodyZeroDelta };
    }

    function determineRequiredRole(pPrevTopY, pThisTopY, pNextTopY) {
        // Role of column x as a function of look-back and look-ahead in the
        // pre-planned topRowYByColumn[]:
        //   - this drops 1 row higher than prev → stepUp at this col (stamps
        //     at the new -1 row).
        //   - next col is 1 row lower than this → stepDown at this col (this
        //     col stamps at thisTopY; advances currentTopY for the next col).
        //   - else → body.
        if(pPrevTopY !== null && pThisTopY === pPrevTopY - 1) return "stepUp";
        if(pNextTopY !== null && pNextTopY === pThisTopY + 1) return "stepDown";
        return "body";
    }

    function pickStripForRole(pContext, pCliff, pX, pSeq, pRole, pPrevKey,
                              pByRole, pAdjacency) {
        var strips = pCliff.Strips;
        var allowed;
        if(pPrevKey === null) {
            allowed = (pByRole[pRole] || []).slice();
        } else {
            var fromAdj = pAdjacency[pPrevKey] || [];
            allowed = [];
            for(var ai = 0; ai < fromAdj.length; ++ai) {
                var s = strips[fromAdj[ai]];
                if(s && s.role === pRole) allowed.push(fromAdj[ai]);
            }
            if(!allowed.length) {
                // Adjacency closure fallback. Breaks the canonical cycle but
                // keeps the planner's per-column row commitments honoured.
                bumpReject(pContext, "adjClosure");
                allowed = (pByRole[pRole] || []).slice();
            }
        }
        if(!allowed.length) return null;

        var pool = [];
        for(var pi = 0; pi < allowed.length; ++pi) {
            pool.push({ key: allowed[pi], weight: strips[allowed[pi]].weight || 1 });
        }
        var pick = pickWeighted(pContext, pX, 7101 + pSeq, pool);
        return pick ? pick.key : null;
    }

    function buildModernAdjacency(pContext, pCliff) {
        // Tiler — walks the immutable cliffPath produced by Plateau.js and
        // stamps strips per-column. Path semantics:
        //   topRowYByColumn[x] is the row at which column x's strip stamps.
        //   - prev → this diff = -1 means this col is stepUp (stamps at the
        //     new lower-Y row, advances currentTopY to that row).
        //   - this → next diff = +1 means this col is stepDown (stamps at
        //     thisTopY; the +1 advance happens at the boundary).
        //   - all other diffs are body.
        // Off-map rows in a column footprint are skipped by commitColumn-
        // RiverAware so the cliff fades naturally as the path drifts off
        // the top/bottom edge.
        var path = pContext.Plateau && pContext.Plateau.cliffPath;
        if(!path) {
            MapGen.Context.AddLog(pContext, "Cliff terrace v2 skipped (no cliffPath)");
            return pContext;
        }

        pContext.Cliffs = pContext.Cliffs || [];
        pContext.CliffRejectStats = pContext.CliffRejectStats || {};

        var stampHeight = pCliff.StampHeight;
        var startX = path.startX;
        var endX = path.endX;
        var topY = path.topRowYByColumn;
        var strips = pCliff.Strips;
        var roleIdx = indexStripsByRole(pCliff);
        var byRole = roleIdx.byRole;
        var adjacency = pCliff.Adjacency || {};

        var record = {
            kind: "cliff_band_v2",
            bandY: path.bandY,
            topRowY: path.baseTopY,
            stampHeight: stampHeight,
            startSide: "left",
            columns: [],
            triplets: [],
            stairs: null
        };

        var prevKey = null;
        for(var x = startX; x <= endX; ++x) {
            var thisTopY = topY[x];
            var prevTopY = (x > startX) ? topY[x - 1] : null;
            var nextTopY = (x < endX) ? topY[x + 1] : null;
            var role = determineRequiredRole(prevTopY, thisTopY, nextTopY);

            var seq = x - startX;
            var stripKey = pickStripForRole(pContext, pCliff, x, seq, role,
                prevKey, byRole, adjacency);

            if(!stripKey && role !== "body") {
                // Palette has no strip for the role at this adjacency (e.g.
                // stepDown out of an unusual prevKey with all-empty closure).
                // Fall back to body so the path still places — visually a
                // small kink but better than dropping the column entirely.
                bumpReject(pContext, "roleMissing");
                stripKey = pickStripForRole(pContext, pCliff, x, seq, "body",
                    prevKey, byRole, adjacency);
            }
            if(!stripKey) {
                bumpReject(pContext, "noStrip");
                continue;
            }

            var strip = strips[stripKey];
            var commit = commitColumnRiverAware(pContext, x, thisTopY, strip.tiles);
            record.columns.push({
                x: x,
                stripKey: stripKey,
                topRowY: thisTopY,
                deltaY: strip.deltaY | 0,
                triplets: commit.triplets
            });
            for(var ti = 0; ti < commit.triplets.length; ++ti)
                record.triplets.push(commit.triplets[ti]);

            prevKey = stripKey;
        }

        var stairsRecord = placeStairsPostWalk(pContext, pCliff, record);
        record.stairs = stairsRecord;

        record.bounds = {
            minX: 0,
            maxX: pContext.Width - 1,
            minY: path.baseTopY,
            maxY: path.bandY
        };

        pContext.Cliffs.push(record);

        var stairLog = stairsRecord ? (" stairs@" + stairsRecord.originX) : " stairs=skipped";
        var fadeLog = (path.leftFadeOffMap ? " leftFade" : "") +
                      (path.rightFadeOffMap ? " rightFade" : "");
        MapGen.Context.AddLog(pContext, "Cliff terrace v2 columns=" + record.columns.length +
            "/" + pContext.Width +
            " path=[" + startX + ".." + endX + "]" +
            " bandY=" + path.bandY + fadeLog + stairLog);

        return pContext;
    }

    function buildModern(pContext, pCliff) {
        var stampHeight = pCliff.StampHeight;
        var bandY = pContext.Plateau.bandY;
        var topRowY = bandY - (stampHeight - 1);
        var flatStrips = pCliff.FlatStrips || pCliff.Strips;

        pContext.Cliffs = pContext.Cliffs || [];
        pContext.CliffRejectStats = pContext.CliffRejectStats || {};

        // Phase 1: discover which columns can host the body. We DON'T commit
        // yet — stairs needs to claim its footprint first so the body stamp
        // doesn't lock keepClear on cells stairs wants.
        var fitting = [];
        var fitOptions = pContext.Profile && pContext.Profile.HelicopterTransit === true ?
            { allowRouteTransit: true } : null;
        for(var x = 0; x < pContext.Width; ++x) {
            if(columnFits(pContext, x, topRowY, stampHeight, fitOptions))
                fitting.push({ x: x });
        }

        if(pContext.Profile && pContext.Profile.RequireFullWidthCliffs === true &&
            fitting.length !== pContext.Width) {
            MapGen.Context.AddLog(pContext, "Cliff terrace skipped: uninterrupted full-width fit=" +
                fitting.length + "/" + pContext.Width + " bandY=" + bandY);
            return pContext;
        }

        if(!fitting.length) {
            MapGen.Context.AddLog(pContext, "Cliff terrace placed=0/" + pContext.Width +
                " bandY=" + bandY + " (no fitting columns)");
            return pContext;
        }

        // Phase 2: stairs first (ice).
        var stairsRecord = placeStairs(pContext, pCliff, topRowY, fitting);
        var stairsCols = {};
        if(stairsRecord) {
            for(var sx = stairsRecord.originX; sx < stairsRecord.originX + stairsRecord.width; ++sx)
                stairsCols[sx] = true;
        }

        // Phase 3: body. Skip columns claimed by the stairs piece.
        var record = {
            kind: "cliff_band",
            bandY: bandY,
            topRowY: topRowY,
            stampHeight: stampHeight,
            columns: [],
            triplets: [],
            stairs: stairsRecord
        };

        var previousStripIndex = null;
        var previousStripX = -2;
        for(var i = 0; i < fitting.length; ++i) {
            var ox = fitting[i].x;
            if(stairsCols[ox]) continue;

            var stripIdx;
            var allowed = previousStripX === ox - 1 &&
                pCliff.FlatAdjacency && previousStripIndex !== null ?
                pCliff.FlatAdjacency[previousStripIndex] : null;
            if(allowed && allowed.length) {
                stripIdx = allowed[pickIndex(
                    pContext, ox, 7001, allowed.length)];
            }
            else {
                stripIdx = pickIndex(pContext, ox, 7001,
                    flatStrips.length);
            }
            var strip = flatStrips[stripIdx];

            var topEdgeTile = null;
            if(pCliff.FlatTopEdge &&
                stripIdx < pCliff.FlatTopEdge.length) {
                topEdgeTile = pCliff.FlatTopEdge[stripIdx];
            }
            else if(pCliff.TopEdge && pCliff.TopEdge.length) {
                var edgeIdx = pickIndex(pContext, ox, 7011, pCliff.TopEdge.length);
                topEdgeTile = pCliff.TopEdge[edgeIdx];
            }

            var triplets = commitColumn(pContext, ox, topRowY, strip, topEdgeTile);
            record.columns.push({
                x: ox,
                stripIndex: stripIdx,
                topEdgeTile: topEdgeTile,
                triplets: triplets
            });
            for(var t = 0; t < triplets.length; ++t)
                record.triplets.push(triplets[t]);
            previousStripIndex = stripIdx;
            previousStripX = ox;
        }

        if(stairsRecord) {
            for(var st = 0; st < stairsRecord.triplets.length; ++st)
                record.triplets.push(stairsRecord.triplets[st]);
        }

        record.bounds = {
            minX: 0,
            maxX: pContext.Width - 1,
            minY: topRowY - (pCliff.TopEdge ? 1 : 0),
            maxY: bandY
        };

        pContext.Cliffs.push(record);

        var stairLog = stairsRecord ? (" stairs@" + stairsRecord.originX) : "";
        MapGen.Context.AddLog(pContext, "Cliff terrace columns placed=" + record.columns.length +
            "/" + pContext.Width + " bandY=" + bandY + stairLog);

        return pContext;
    }

    function buildLegacy(pContext, pCliff) {
        // Old monolithic-stamp path — Desert.
        var variants = pCliff.Variants || [];
        if(!variants.length || !variants[0] || !variants[0].length) {
            MapGen.Context.AddLog(pContext, "Cliff pass skipped (no variants)");
            return pContext;
        }

        var mainVariant = variants[0];
        var bounds = Structures.StructureBounds(mainVariant);
        var stampW = (bounds.maxX - bounds.minX) + 1;
        var topRowY = pContext.Plateau.topRowY;
        var originY = topRowY - bounds.minY;

        pContext.Cliffs = pContext.Cliffs || [];
        pContext.CliffRejectStats = pContext.CliffRejectStats || {};

        var attempted = 0;
        var placed = 0;

        for(var originX = -bounds.minX; originX + stampW - 1 < pContext.Width; originX += stampW) {
            ++attempted;
            var fits = true;
            for(var i = 0; i < mainVariant.length; ++i) {
                var t = mainVariant[i];
                if(cellBlocksStamp(pContext, originX + t[0], originY + t[1])) { fits = false; break; }
            }
            if(!fits) continue;

            var triplets = [];
            var minX = pContext.Width, maxX = -1, minY = pContext.Height, maxY = -1;
            for(var j = 0; j < mainVariant.length; ++j) {
                var triplet = mainVariant[j];
                var tx = originX + triplet[0];
                var ty = originY + triplet[1];
                triplets.push({ x: tx, y: ty, tileId: triplet[2] });
                MapGen.Layers.Set(pContext.Layers.blocked, tx, ty, 1);
                MapGen.Layers.Set(pContext.Layers.keepClear, tx, ty, 1);
                // Architecture v3: legacy (desert) cliffs join the owner model
                // so the owner-aware blocked smoother preserves their footprint
                // (replacing ReassertFootprint). Modern cliff paths already claim.
                MapGen.Layers.ClaimCell(pContext.Layers.owner, tx, ty, MapGen.Layers.Owner.CLIFF);
                if(tx < minX) minX = tx;
                if(tx > maxX) maxX = tx;
                if(ty < minY) minY = ty;
                if(ty > maxY) maxY = ty;
            }
            pContext.Cliffs.push({
                kind: "cliff_legacy",
                variantIndex: 0,
                originX: originX,
                originY: originY,
                segmentY: pContext.Plateau ? pContext.Plateau.bandY : originY,
                triplets: triplets,
                bounds: { minX: minX, maxX: maxX, minY: minY, maxY: maxY }
            });
            ++placed;
        }

        MapGen.Context.AddLog(pContext, "Cliff terrace stamps placed=" + placed +
            "/" + attempted + " bandY=" + pContext.Plateau.bandY + " (legacy)");
        return pContext;
    }

    function build(pContext) {
        if(!pContext || !pContext.Profile) return pContext;
        if(!pContext.Plateau) return pContext;
        invalidateCliffCharmapCaches(pContext);

        var profile = pContext.Profile;
        var chance = profile.CliffChance;

        if(typeof chance !== "number" || chance <= 0) {
            MapGen.Context.AddLog(pContext, "Cliff pass skipped (CliffChance=0)");
            // Failure-mode revert ([[mapgen_cliff_option_a_staged]]):
            // any reserved strip stays cliffReserve=1 forever otherwise.
            revertUnusedCliffReservation(pContext);
            return pContext;
        }

        var cliff = cliffData(pContext);
        if(!cliff) {
            MapGen.Context.AddLog(pContext, "Cliff pass skipped (no cliff data for biome)");
            revertUnusedCliffReservation(pContext);
            return pContext;
        }

        if(!pContext.Random.Chance(chance)) {
            MapGen.Context.AddLog(pContext, "Cliff roll missed (chance=" + chance.toFixed(2) + ")");
            revertUnusedCliffReservation(pContext);
            return pContext;
        }

        if(cliff.SchemaVersion === 2)
            buildModernAdjacency(pContext, cliff);
        else if(cliff.Strips && cliff.Strips.length)
            buildModern(pContext, cliff);
        else
            buildLegacy(pContext, cliff);

        clearWaterNearCliffs(pContext);
        smoothWaterNearCliffs(pContext);
        reserveCliffFootApron(pContext);
        invalidateCliffCharmapCaches(pContext);
        // Final revert (success path): planner may have stamped a cliff
        // narrower than the reservation, or shifted bandY; drop the bool
        // for cells that didn't end up CLIFF so downstream Clearings/
        // Outcrops/decor see clean ground there.
        revertUnusedCliffReservation(pContext);
        return pContext;
    }

    // reassertFootprint removed (architecture v3): cliff body cells claim
    // owner==CLIFF at commit time and SmoothBlockedMaskPass now preserves
    // blocked where owner==CLIFF && blocked==1, so the footprint survives the
    // cover pass and the repair loop without a re-stamp. Stairs/crossing/
    // top-edge are owner==CLIFF but blocked==0, so they stay walkable.

    function cliffWaterClearance(pContext) {
        var profile = pContext.Profile || {};
        var value = profile.CliffWaterClearance;

        if(value === undefined || value === null)
            value = profile.TerrainType === Terrain.Types.Ice ? 2 : 0;

        value = Number(value);
        if(isNaN(value) || value <= 0)
            return 0;

        return Math.max(0, Math.min(4, Math.floor(value)));
    }

    function clearWaterNearCliffs(pContext) {
        if(!pContext || !pContext.Cliffs || !pContext.Cliffs.length)
            return 0;

        var clearance = cliffWaterClearance(pContext);
        if(clearance <= 0)
            return 0;

        var layers = pContext.Layers;
        var radiusSq = clearance * clearance;
        var cleared = 0;
        var seen = {};

        for(var index = 0; index < pContext.Cliffs.length; ++index) {
            var triplets = pContext.Cliffs[index].triplets || [];

            for(var t = 0; t < triplets.length; ++t) {
                var triplet = triplets[t];

                for(var dx = -clearance; dx <= clearance; ++dx) {
                    for(var dy = -clearance; dy <= clearance; ++dy) {
                        if((dx * dx) + (dy * dy) > radiusSq)
                            continue;

                        var x = triplet.x + dx;
                        var y = triplet.y + dy;
                        var key = x + "," + y;

                        if(seen[key])
                            continue;
                        seen[key] = true;

                        if(!MapGen.Layers.InBounds(layers.water, x, y))
                            continue;
                        if(MapGen.Layers.Get(layers.crossing, x, y, 0))
                            continue;

                        if(MapGen.Layers.Get(layers.water, x, y, 0)) {
                            MapGen.Layers.Set(layers.water, x, y, 0);
                            ++cleared;
                        }
                        if(MapGen.Layers.Get(layers.riverBank, x, y, 0))
                            MapGen.Layers.Set(layers.riverBank, x, y, 0);
                        if(layers.forcedBank && MapGen.Layers.Get(layers.forcedBank, x, y, 0))
                            MapGen.Layers.Set(layers.forcedBank, x, y, 0);
                        if(layers.lakeShore && MapGen.Layers.Get(layers.lakeShore, x, y, 0))
                            MapGen.Layers.Set(layers.lakeShore, x, y, 0);
                    }
                }
            }
        }

        if(cleared)
            MapGen.Context.AddLog(pContext, "Cleared water near cliff footprint: " + cleared + " tiles");

        return cleared;
    }

    function clearWaterHints(pContext, pX, pY) {
        var layers = pContext.Layers;

        if(MapGen.Layers.Get(layers.riverBank, pX, pY, 0))
            MapGen.Layers.Set(layers.riverBank, pX, pY, 0);
        if(layers.forcedBank && MapGen.Layers.Get(layers.forcedBank, pX, pY, 0))
            MapGen.Layers.Set(layers.forcedBank, pX, pY, 0);
        if(layers.lakeShore && MapGen.Layers.Get(layers.lakeShore, pX, pY, 0))
            MapGen.Layers.Set(layers.lakeShore, pX, pY, 0);
    }

    function waterKey(pX, pY) {
        return pX + "," + pY;
    }

    function parseWaterKey(pKey) {
        var comma = pKey.indexOf(",");
        return {
            x: Number(pKey.substring(0, comma)),
            y: Number(pKey.substring(comma + 1))
        };
    }

    function markCliffWaterZone(pContext, pHardNoWater, pSmoothZone, pHardRadius, pSmoothRadius) {
        var hardSq = pHardRadius * pHardRadius;
        var smoothSq = pSmoothRadius * pSmoothRadius;

        for(var index = 0; index < pContext.Cliffs.length; ++index) {
            var triplets = pContext.Cliffs[index].triplets || [];

            for(var t = 0; t < triplets.length; ++t) {
                var triplet = triplets[t];

                for(var dx = -pSmoothRadius; dx <= pSmoothRadius; ++dx) {
                    for(var dy = -pSmoothRadius; dy <= pSmoothRadius; ++dy) {
                        var distSq = (dx * dx) + (dy * dy);
                        if(distSq > smoothSq)
                            continue;

                        var x = triplet.x + dx;
                        var y = triplet.y + dy;
                        if(!MapGen.Layers.InBounds(pContext.Layers.water, x, y))
                            continue;

                        var key = waterKey(x, y);
                        pSmoothZone[key] = true;

                        if(distSq <= hardSq)
                            pHardNoWater[key] = true;
                    }
                }
            }
        }
    }

    function canDemoteCliffWaterCell(pContext, pX, pY) {
        var layers = pContext.Layers;
        if(!MapGen.Layers.InBounds(layers.water, pX, pY))
            return false;
        if(!MapGen.Layers.Get(layers.water, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(layers.crossing, pX, pY, 0))
            return false;
        if(layers.causeway && MapGen.Layers.Get(layers.causeway, pX, pY, 0))
            return false;

        return true;
    }

    function waterNeighbourInfo(pContext, pX, pY) {
        var water = pContext.Layers.water;
        var n = MapGen.Layers.Get(water, pX, pY - 1, 0);
        var s = MapGen.Layers.Get(water, pX, pY + 1, 0);
        var w = MapGen.Layers.Get(water, pX - 1, pY, 0);
        var e = MapGen.Layers.Get(water, pX + 1, pY, 0);
        var nw = MapGen.Layers.Get(water, pX - 1, pY - 1, 0);
        var ne = MapGen.Layers.Get(water, pX + 1, pY - 1, 0);
        var sw = MapGen.Layers.Get(water, pX - 1, pY + 1, 0);
        var se = MapGen.Layers.Get(water, pX + 1, pY + 1, 0);

        return {
            n: n, s: s, w: w, e: e,
            nw: nw, ne: ne, sw: sw, se: se,
            cardinals: (n ? 1 : 0) + (s ? 1 : 0) + (w ? 1 : 0) + (e ? 1 : 0)
        };
    }

    function hasHardNoWaterNeighbour(pHardNoWater, pX, pY) {
        for(var dx = -1; dx <= 1; ++dx) {
            for(var dy = -1; dy <= 1; ++dy) {
                if(dx === 0 && dy === 0)
                    continue;
                if(pHardNoWater[waterKey(pX + dx, pY + dy)])
                    return true;
            }
        }

        return false;
    }

    function shouldTrimCliffWaterBump(pInfo) {
        if(pInfo.cardinals <= 1)
            return true;

        if(pInfo.cardinals !== 2)
            return false;

        return (pInfo.n && pInfo.w && !pInfo.nw) ||
            (pInfo.n && pInfo.e && !pInfo.ne) ||
            (pInfo.s && pInfo.w && !pInfo.sw) ||
            (pInfo.s && pInfo.e && !pInfo.se);
    }

    function smoothWaterNearCliffs(pContext) {
        if(!pContext || !pContext.Cliffs || !pContext.Cliffs.length)
            return 0;

        var clearance = cliffWaterClearance(pContext);
        if(clearance <= 0)
            return 0;

        var hardNoWater = {};
        var smoothZone = {};
        var hardRadius = Math.min(5, clearance + 1);
        var smoothRadius = Math.min(7, hardRadius + 2);
        markCliffWaterZone(pContext, hardNoWater, smoothZone, hardRadius, smoothRadius);

        var demoted = 0;

        for(var pass = 0; pass < 2; ++pass) {
            var toLand = [];

            for(var key in smoothZone) {
                if(!smoothZone.hasOwnProperty(key))
                    continue;

                var point = parseWaterKey(key);
                var x = point.x;
                var y = point.y;

                if(hardNoWater[key]) {
                    if(canDemoteCliffWaterCell(pContext, x, y))
                        toLand.push([x, y]);
                    continue;
                }

                var info = waterNeighbourInfo(pContext, x, y);
                if(canDemoteCliffWaterCell(pContext, x, y)) {
                    if(shouldTrimCliffWaterBump(info) ||
                        (hasHardNoWaterNeighbour(hardNoWater, x, y) && info.cardinals <= 2))
                        toLand.push([x, y]);
                }
            }

            if(!toLand.length)
                break;

            for(var li = 0; li < toLand.length; ++li) {
                MapGen.Layers.Set(pContext.Layers.water, toLand[li][0], toLand[li][1], 0);
                clearWaterHints(pContext, toLand[li][0], toLand[li][1]);
            }

            demoted += toLand.length;
        }

        if(demoted)
            MapGen.Context.AddLog(pContext, "Smoothed cliff water edge: demoted=" + demoted);

        return demoted;
    }

    function overlayTiles(pContext, pTiles) {
        if(!pContext || !pTiles) return 0;
        if(!pContext.Cliffs || !pContext.Cliffs.length) return 0;

        var stamped = 0;
        for(var index = 0; index < pContext.Cliffs.length; ++index) {
            var triplets = pContext.Cliffs[index].triplets || [];
            for(var t = 0; t < triplets.length; ++t) {
                var triplet = triplets[t];
                if(MapGen.Layers.Set(pTiles, triplet.x, triplet.y, triplet.tileId))
                    ++stamped;
            }
        }
        return stamped;
    }

    function footShadowFor(pBodyBottom) {
        // Derived from Tools/Analysis/AnalyzeIceFootShadow.py: across 468
        // foot-shadow occurrences in the 15 shipped Amiga ice maps, the
        // foot tile slot (id - 200) matches the body bottom slot 97.8% of
        // the time. Bottom-row body tiles 180..184 → foot 200..204. The two
        // cap bottoms map to the matching foot edge: 228 (leftCap row 3) →
        // 200; 229 (rightCap row 3) → 204.
        if(pBodyBottom >= 180 && pBodyBottom <= 184)
            return pBodyBottom + 20;
        if(pBodyBottom === 228) return 200;
        if(pBodyBottom === 229) return 204;
        return null;
    }

    function footShadow2For(pRow1Tile) {
        // Second foot-shadow row — derived from
        // Tools/Analysis/AnalyzeIceFootShadow2.py over the same 15 shipped
        // ice maps. Distinct from the row-1 mapping: row 2 only fills the
        // EDGE slots (0 and 4) of the cliff body and the stair bottom row.
        // Middle body slots (201/202/203) almost never get a second-row
        // shadow (1 occurrence each across all shipped maps), so the rule
        // returns null for them and the placer leaves the cell as plain
        // snow. Mapping:
        //   200 → 220  (body_v1 / step_up edge, n=38)
        //   204 → 224  (step_down edge,         n=70)
        //   205 → 225  (stair col 0 bottom)
        //   206 → 226  (stair col 1 bottom)
        //   207 → 227  (stair col 2 bottom)
        if(pRow1Tile === 200) return 220;
        if(pRow1Tile === 204) return 224;
        if(pRow1Tile === 205) return 225;
        if(pRow1Tile === 206) return 226;
        if(pRow1Tile === 207) return 227;
        return null;
    }

    function footCellClear(pContext, pX, pY) {
        var layers = pContext.Layers;
        if(MapGen.Layers.Get(layers.water, pX, pY, 0)) return false;
        if(MapGen.Layers.Get(layers.riverBank, pX, pY, 0)) return false;
        // The foot shadow is walkable snow and owns the visual tile even when
        // a semantic route approaches the stairs across it. Suppressing the
        // shadow for `path` produced holes in south-facing faces; route
        // connectivity remains in the layer underneath the overlay.
        if(MapGen.Layers.Get(layers.crossing, pX, pY, 0)) return false;
        if(MapGen.Layers.Get(layers.coast, pX, pY, 0)) return false;
        // Actor occupancy is transient and must not change the terrain
        // materialized underneath it. During the post-scenario rebuild an
        // enemy standing on the dry cliff apron used to suppress a lip/foot
        // tile, making the exact same terrain fail only at final commit.
        return true;
    }

    function stairFootCellClear(pContext, pX, pY) {
        // Stair continuation tiles 225..227 are part of the route art, so a
        // path/crossing flag is expected here and must not suppress them.
        // Temporary actor/route occupancy must not suppress them either: the
        // crossing is reserved terrain and no structure may legally claim it.
        // Water and coast still win so a malformed crossing cannot paste a
        // stair continuation into the sea.
        var layers = pContext.Layers;
        if(MapGen.Layers.Get(layers.water, pX, pY, 0)) return false;
        if(MapGen.Layers.Get(layers.riverBank, pX, pY, 0)) return false;
        if(MapGen.Layers.Get(layers.coast, pX, pY, 0)) return false;
        return true;
    }

    function inStairFootprint(pStairs, pX, pY) {
        if(!pStairs) return false;
        return pX >= pStairs.originX && pX < pStairs.originX + pStairs.width &&
               pY >= pStairs.originY && pY < pStairs.originY + pStairs.height;
    }

    function tryStampFootShadow(pContext, pTiles, pStairs, pX, pY, pTile) {
        if(!MapGen.Layers.InBounds(pTiles, pX, pY)) return false;
        if(!footCellClear(pContext, pX, pY)) return false;
        if(inStairFootprint(pStairs, pX, pY)) return false;
        return MapGen.Layers.Set(pTiles, pX, pY, pTile);
    }

    function overlayCliffTop(pContext, pTiles) {
        // Stamp a plain-snow tile on the row directly above each cliff-top
        // cell. Without this the terrain smoother paints transition tiles
        // (5/9 in ice) right above the cliff lip — those tiles never appear
        // there in shipped Amiga maps (Tools/Analysis/AnalyzeIceCliffTop.py
        // — n=580). Palette is read from Cliff.TopEdge; weighting comes from
        // duplicate entries. Skipped per-cell when the cell already carries
        // a layer feature (water/bank/path/crossing/coast/occupied) so the
        // overlay never paints over rivers, paths, or other features that
        // the surrounding terrain rendered above the cliff.
        if(!pContext || !pTiles) return 0;
        if(!pContext.Cliffs || !pContext.Cliffs.length) return 0;

        var cliff = cliffData(pContext);
        if(!cliff) return 0;
        // Schema-v1 jungle columns already include their linked lip tile in
        // commitColumn. Running this ice apron pass as well stamped a second
        // random cliff row above them and severed the visual column grammar.
        if(cliff.SchemaVersion !== 2) return 0;
        var palette = cliff.TopEdge;
        if(!palette || !palette.length) return 0;

        var stamped = 0;
        for(var index = 0; index < pContext.Cliffs.length; ++index) {
            var record = pContext.Cliffs[index];
            var cols = record.columns || [];

            for(var c = 0; c < cols.length; ++c) {
                var col = cols[c];
                var trips = col.triplets || [];
                if(!trips.length) continue;

                // Top of the column footprint — smallest y in the triplets.
                var top = trips[0];
                for(var ti = 1; ti < trips.length; ++ti) {
                    if(trips[ti].y < top.y) top = trips[ti];
                }

                var ex = col.x;
                var ey = top.y - 1;
                if(ey < 0) continue;
                if(!MapGen.Layers.InBounds(pTiles, ex, ey)) continue;
                if(!footCellClear(pContext, ex, ey)) continue;

                var hash = MapGen.Random.HashTile(pContext.Seed, ex, ey, 6203);
                var tile = palette[hash % palette.length];
                if(MapGen.Layers.Set(pTiles, ex, ey, tile))
                    ++stamped;
            }
        }
        return stamped;
    }

    function overlayFootShadow(pContext, pTiles) {
        // Stamp foot-shadow tiles below each cliff body column AND below the
        // stair bottom row. Two rows are placed where the data warrants it:
        //   row 1 (200..207) under any cliff/stair column,
        //   row 2 (220, 224, 225, 226, 227) under the row-1 EDGE slots and
        //          under stair bottoms.
        // Skipped per-cell when the foot cell already carries a layer
        // feature (water/bank/path/crossing/coast/occupied) or is part of
        // the stair footprint.
        if(!pContext || !pTiles) return 0;
        if(!pContext.Cliffs || !pContext.Cliffs.length) return 0;

        var cliff = cliffData(pContext);
        if(!cliff) return 0;

        var stamped = 0;

        for(var index = 0; index < pContext.Cliffs.length; ++index) {
            var record = pContext.Cliffs[index];
            var cols = record.columns || [];
            var stairs = record.stairs;

            // Per-body-column foot shadow (row 1 + row 2).
            for(var c = 0; c < cols.length; ++c) {
                var col = cols[c];
                var trips = col.triplets || [];
                if(!trips.length) continue;

                // Stair-replaced columns have no body triplets left
                // (placeStairsPostWalk drops them) — they're handled below
                // in the stair pass.
                var bottom = trips[0];
                for(var ti = 1; ti < trips.length; ++ti) {
                    if(trips[ti].y > bottom.y) bottom = trips[ti];
                }

                var footTile = footShadowFor(bottom.tileId);
                if(footTile === null) continue;

                var fx = col.x;
                var fy1 = bottom.y + 1;
                if(!tryStampFootShadow(pContext, pTiles, stairs, fx, fy1, footTile))
                    continue;
                ++stamped;

                var foot2 = footShadow2For(footTile);
                if(foot2 === null) continue;

                if(tryStampFootShadow(pContext, pTiles, stairs, fx, fy1 + 1, foot2))
                    ++stamped;
            }

            // Stair second-row foot shadow. The stair stamp's bottom row
            // (StairsHeight-1) holds tiles 205/206/207; row 2 maps those to
            // 225/226/227 placed one cell below.
            if(stairs && cliff.Stairs && cliff.StairsHeight) {
                var bottomRowIdx = cliff.StairsHeight - 1;
                var bottomRow = cliff.Stairs[bottomRowIdx] || [];
                var sy = stairs.originY + stairs.height; // one below the stair stamp
                for(var sx = 0; sx < bottomRow.length; ++sx) {
                    var foot1Stair = bottomRow[sx];
                    var foot2Stair = footShadow2For(foot1Stair);
                    if(foot2Stair === null) continue;
                    var stx = stairs.originX + sx;
                    if(MapGen.Layers.InBounds(pTiles, stx, sy) &&
                        stairFootCellClear(pContext, stx, sy) &&
                        MapGen.Layers.Set(pTiles, stx, sy, foot2Stair))
                        ++stamped;
                }
            }
        }
        return stamped;
    }

    return {
        Build: build,
        OverlayTiles: overlayTiles,
        OverlayCliffTop: overlayCliffTop,
        OverlayFootShadow: overlayFootShadow,
        // Exposed for the Plateau.js cliff-path planner: returns true iff the
        // cliff-body footprint at (pX, pTopRowY) is clear of water/bank/etc.
        // for every in-bounds row, with at least one in-bounds row. Off-map
        // rows aren't checked (they're the visual fade).
        ColumnFits: columnFitsRiverAware
    };
})();
