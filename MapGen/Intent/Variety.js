var MapGen = MapGen || {};
MapGen.Intent = MapGen.Intent || {};

// MapGen.Intent.Variety — Concept-shared variety primitives (Phase 4 P4.0).
//
// Phase 3 closed with playable maps, but the Concepts produced literal
// rectangles (forest above + below corridor, cliff in vertical strip,
// compound box). Phase 4's job is per-Concept variety — every seed should
// produce a recognizably different layout while staying within the
// Concept's identity.
//
// Primitives provided:
//   PerSeedRange(rng, min, max)   — uniform random in [min, max]
//   PerSeedInt(rng, min, max)     — random integer in [min, max] inclusive
//   PerSeedChoice(rng, list)      — random pick from list
//   PerSeedJitter(rng, base, max) — base ± uniform jitter up to max
//
//   StampOutcropCluster(intentMap, cx, cy, size, rng)
//                                 — stamp an irregular outcrop blob (FOREST
//                                   terrain + BLOCKED) — use for tactical
//                                   cover scattering
//   StampClearing(intentMap, cx, cy, radius)
//                                 — punch open RESERVED+WALKABLE clearing,
//                                   removing any FOREST/BLOCKED in the disc
//   StampSCurve(intentMap, x0, y0, x1, y1, halfWidth, rng)
//                                 — S-curved corridor between two points,
//                                   stamping ROUTE_PRIMARY along the curve
//   StampZigzag(intentMap, x0, y0, x1, y1, halfWidth, rng)
//                                 — zigzag corridor
//
//   ScatterOutcrops(intentMap, region, count, rng)
//                                 — sprinkle N small outcrops within a
//                                   rectangular region, avoiding route +
//                                   spawn cells
//
// Concepts pass their per-channel RNG (typically pRngs.terrain or
// pRngs.decor) so variety is reproducible per (seed, channel) pair —
// adding a new variety dimension to one Concept doesn't shift other
// Concepts' RNG draws (§3.5 frozen substream contract).

(function(pIntent) {

    pIntent.Variety = pIntent.Variety || {};

    var T = pIntent.Terrain;
    var M = pIntent.Movement;
    var C = pIntent.Claim;
    var O = pIntent.Owner;

    function unitFloat(rng) {
        // MapGen.Random.CreateSeeded() returns an object with .Int(min, max)
        // (inclusive) and .Float(min, max), no .NextInt. unitFloat samples a
        // uniform float in [0, 1).
        if(!rng) { return 0.5; }
        if(rng.Float) { return rng.Float(0, 1); }
        if(rng.Int) { return rng.Int(0, 0xFFFF) / 0xFFFF; }
        return 0.5;
    }

    // Cover and clearing primitives operate on plain land/forest only. They
    // must never erase authored terrain features: doing so used to let late
    // tactical cover consume whole lakes and break the bank ring that the
    // tile smoother relies on.
    function isProtectedTerrain(pIntentMap, index) {
        var terrain = pIntentMap.terrain[index];
        return terrain === T.WATER || terrain === T.RIVER ||
            terrain === T.RIVERBANK || terrain === T.CLIFF_BODY ||
            terrain === T.CLIFF_TOP || terrain === T.COAST ||
            terrain === T.OUTCROP;
    }

    pIntent.Variety.PerSeedRange = function(rng, min, max) {
        return min + (max - min) * unitFloat(rng);
    };

    // -----------------------------------------------------------------------
    // SnapToLand — if (cx, cy) is on a water/forest/cliff cell, walk
    // outward to the nearest cell with terrain.LAND and return its
    // coordinates. Used to keep spawn/objective anchors on walkable land
    // even after the continent shape carved water around them.
    pIntent.Variety.SnapToLand = function(pIntentMap, cx, cy, maxRadius) {
        var W = pIntentMap.width;
        var H = pIntentMap.height;
        function isLand(x, y) {
            if(x < 0 || y < 0 || x >= W || y >= H) { return false; }
            var i = (y * W) + x;
            var t = pIntentMap.terrain[i];
            return t === T.LAND;
        }
        if(isLand(cx, cy)) { return { x: cx, y: cy }; }
        var maxR = maxRadius || Math.max(W, H);
        for(var r = 1; r <= maxR; ++r) {
            for(var dy = -r; dy <= r; ++dy) {
                for(var dx = -r; dx <= r; ++dx) {
                    if(Math.max(Math.abs(dx), Math.abs(dy)) !== r) { continue; }
                    var nx = cx + dx;
                    var ny = cy + dy;
                    if(isLand(nx, ny)) { return { x: nx, y: ny }; }
                }
            }
        }
        return { x: cx, y: cy }; // fallback unchanged
    };

    pIntent.Variety.PerSeedInt = function(rng, min, max) {
        if(!rng) { return Math.floor((min + max) / 2); }
        if(rng.Int) { return rng.Int(min, max); }
        return Math.floor(min + unitFloat(rng) * ((max - min) + 1));
    };

    pIntent.Variety.PerSeedChoice = function(rng, list) {
        if(!list || !list.length) { return null; }
        var i = pIntent.Variety.PerSeedInt(rng, 0, list.length - 1);
        return list[i];
    };

    pIntent.Variety.PerSeedJitter = function(rng, base, maxAmplitude) {
        return base + (unitFloat(rng) * 2 - 1) * maxAmplitude;
    };

    // Select the continent recipe from the resolved runtime profile. The
    // Grammar style owns both the weights and per-style land fractions; v3
    // Concepts must not replace them with a second hard-coded distribution.
    pIntent.Variety.SelectContinentOption = function(profile, rng, fallback) {
        var options = profile && profile.ContinentStyles instanceof Array &&
            profile.ContinentStyles.length ? profile.ContinentStyles : fallback;
        if(!options || !options.length)
            return { style: "island" };

        var total = 0;
        for(var i = 0; i < options.length; ++i) {
            var weight = Number(options[i].weight);
            if(isFinite(weight) && weight > 0)
                total += weight;
        }

        var selected = options[0];
        if(total > 0) {
            var pick = unitFloat(rng) * total;
            var cursor = 0;
            for(var o = 0; o < options.length; ++o) {
                var optionWeight = Number(options[o].weight);
                if(!isFinite(optionWeight) || optionWeight <= 0)
                    continue;
                cursor += optionWeight;
                if(pick <= cursor) {
                    selected = options[o];
                    break;
                }
            }
        }

        var result = { style: selected.name || selected.style || "island" };
        var landFraction = Number(selected.landFraction);
        if(!isFinite(landFraction) && profile)
            landFraction = Number(profile.LandFraction);
        if(isFinite(landFraction))
            result.landFraction = Math.max(0.50, Math.min(0.98, landFraction));
        return result;
    };

    pIntent.Variety.ContinentOptionForStyle = function(
        profile, style, fallbackLandFraction) {
        var selected = null;
        var options = profile && profile.ContinentStyles instanceof Array ?
            profile.ContinentStyles : [];
        for(var i = 0; i < options.length; ++i) {
            if((options[i].name || options[i].style) === style) {
                selected = options[i];
                break;
            }
        }

        var landFraction = selected ? Number(selected.landFraction) : NaN;
        if(!isFinite(landFraction) && profile)
            landFraction = Number(profile.LandFraction);
        if(!isFinite(landFraction))
            landFraction = fallbackLandFraction;

        return {
            style: style,
            landFraction: Math.max(0.50, Math.min(0.98, landFraction))
        };
    };

    // -----------------------------------------------------------------------
    // StampClearing — punch open RESERVED+WALKABLE in a disc, removing any
    // FOREST/BLOCKED that may already be there. Used to inject tactical
    // pockets into an otherwise dense forest.
    pIntent.Variety.StampClearing = function(pIntentMap, cx, cy, radius) {
        var W = pIntentMap.width;
        var H = pIntentMap.height;
        var r2 = radius * radius;
        var cleared = 0;
        for(var dy = -radius; dy <= radius; ++dy) {
            for(var dx = -radius; dx <= radius; ++dx) {
                if((dx * dx) + (dy * dy) > r2) { continue; }
                var x = cx + dx;
                var y = cy + dy;
                if(x < 0 || x >= W || y < 0 || y >= H) { continue; }
                var i = (y * W) + x;
                if(isProtectedTerrain(pIntentMap, i)) { continue; }
                pIntent.Map.SetTerrain(pIntentMap, x, y, T.LAND);
                pIntent.Map.ClearMovement(pIntentMap, x, y, M.BLOCKED);
                pIntent.Map.AddMovement(pIntentMap, x, y, M.WALKABLE | M.KEEP_CLEAR);
                pIntent.Map.AddClaim(pIntentMap, x, y, C.RESERVED);
                pIntent.Map.SetOwner(pIntentMap, x, y, O.OPEN);
                ++cleared;
            }
        }
        return cleared;
    };

    // -----------------------------------------------------------------------
    // StampOutcropCluster — irregular FOREST blob centered at (cx, cy) with
    // approximate radius `size`. Per-cell membership uses a hash-based
    // noise so the cluster has a natural irregular boundary (not a perfect
    // disc). Renderer treats FOREST as ice trees.
    pIntent.Variety.StampOutcropCluster = function(pIntentMap, cx, cy, size, rng) {
        var W = pIntentMap.width;
        var H = pIntentMap.height;
        var stamped = 0;
        var jitterSeed = unitFloat(rng) * 1024;
        for(var dy = -size; dy <= size; ++dy) {
            for(var dx = -size; dx <= size; ++dx) {
                var d2 = (dx * dx) + (dy * dy);
                if(d2 > size * size) { continue; }
                var x = cx + dx;
                var y = cy + dy;
                if(x < 0 || x >= W || y < 0 || y >= H) { continue; }
                // Don't stamp over walkable/route/clearing cells. KEEP_CLEAR
                // is the universal "this should stay open" flag (set on
                // routes, spawn pads, compound clearings, tactical pockets).
                var i = (y * W) + x;
                if(isProtectedTerrain(pIntentMap, i)) { continue; }
                if(pIntentMap.movement[i] & (M.ROUTE_PRIMARY | M.ROUTE_SECONDARY |
                                              M.CROSSING | M.BRIDGE | M.KEEP_CLEAR)) { continue; }
                if(pIntentMap.claim[i] & (C.SPAWN_SAFE | C.STRUCT_WALL |
                                          C.STRUCT_FLOOR | C.OBJECTIVE)) { continue; }
                // Irregular boundary: probability falls off with distance
                // and per-cell hash perturbation.
                var dist = Math.sqrt(d2);
                var falloff = 1 - (dist / size);
                var hash = ((x * 0x9E3779B1) ^ (y * 0x85EBCA77) ^ (jitterSeed | 0)) >>> 0;
                var jitter = (hash & 0xFF) / 255;
                if((falloff + 0.30) - (jitter * 0.55) <= 0) { continue; }
                pIntent.Map.SetTerrain(pIntentMap, x, y, T.FOREST);
                pIntent.Map.AddMovement(pIntentMap, x, y, M.BLOCKED);
                pIntent.Map.ClearMovement(pIntentMap, x, y, M.WALKABLE);
                pIntent.Map.SetOwner(pIntentMap, x, y, O.TREE);
                ++stamped;
            }
        }
        return stamped;
    };

    // -----------------------------------------------------------------------
    // ScatterOutcrops — sprinkle small (radius 1-3) outcrop clusters within
    // the bounding region. Avoids cells already claimed (route, spawn,
    // structure). Returns the actual stamp count.
    pIntent.Variety.ScatterOutcrops = function(pIntentMap, region, count, rng) {
        var stamped = 0;
        var attempts = count * 3;
        var minX = region.minX;
        var maxX = region.maxX;
        var minY = region.minY;
        var maxY = region.maxY;
        for(var i = 0; i < attempts && stamped < count; ++i) {
            var cx = pIntent.Variety.PerSeedInt(rng, minX, maxX);
            var cy = pIntent.Variety.PerSeedInt(rng, minY, maxY);
            // Bumped from 1-3 to 2-4 so outcrops are visible (1-cell rocks
            // get pruned by IceTree.Trim*; 2-3 cell clusters survive).
            var size = pIntent.Variety.PerSeedInt(rng, 2, 4);
            // Skip if center cell is claimed
            if(cx < 0 || cx >= pIntentMap.width || cy < 0 || cy >= pIntentMap.height) {
                continue;
            }
            var idx = (cy * pIntentMap.width) + cx;
            if(pIntentMap.movement[idx] & (M.ROUTE_PRIMARY | M.ROUTE_SECONDARY |
                                            M.CROSSING | M.BRIDGE | M.KEEP_CLEAR)) { continue; }
            if(pIntentMap.claim[idx] & (C.SPAWN_SAFE | C.STRUCT_WALL |
                                        C.STRUCT_FLOOR | C.OBJECTIVE)) { continue; }
            var addedThis = pIntent.Variety.StampOutcropCluster(pIntentMap, cx, cy, size, rng);
            if(addedThis > 0) { stamped += 1; }
        }
        return stamped;
    };

    // -----------------------------------------------------------------------
    // StampRouteLine — Bresenham route stamp with a half-width band.
    // Internal helper used by StampSCurve / StampZigzag.
    function stampRouteSegment(pIntentMap, x0, y0, x1, y1, halfWidth) {
        var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
        var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        var err = dx - dy;
        var x = x0, y = y0;
        var safety = 0;
        var stamped = 0;
        while(safety++ < 500) {
            for(var bdy = -halfWidth; bdy <= halfWidth; ++bdy) {
                for(var bdx = -halfWidth; bdx <= halfWidth; ++bdx) {
                    var bx = x + bdx;
                    var by = y + bdy;
                    if(bx < 0 || bx >= pIntentMap.width ||
                        by < 0 || by >= pIntentMap.height) { continue; }
                    pIntent.Map.SetTerrain(pIntentMap, bx, by, T.LAND);
                    pIntent.Map.ClearMovement(pIntentMap, bx, by, M.BLOCKED);
                    pIntent.Map.AddMovement(pIntentMap, bx, by,
                        M.ROUTE_PRIMARY | M.WALKABLE | M.KEEP_CLEAR);
                    pIntent.Map.AddClaim(pIntentMap, bx, by, C.RESERVED);
                    ++stamped;
                }
            }
            if(x === x1 && y === y1) { break; }
            var e2 = 2 * err;
            if(e2 > -dy) { err -= dy; x += sx; }
            if(e2 < dx) { err += dx; y += sy; }
        }
        return stamped;
    }

    // -----------------------------------------------------------------------
    // StampSCurve — S-shaped corridor between (x0,y0) and (x1,y1). Picks
    // 2 random control points perpendicular-ish to the straight line.
    pIntent.Variety.StampSCurve = function(pIntentMap, x0, y0, x1, y1, halfWidth, rng) {
        var midDx = (x1 - x0);
        var midDy = (y1 - y0);
        var len = Math.sqrt(midDx * midDx + midDy * midDy);
        var amp = pIntent.Variety.PerSeedRange(rng, 4, 8);
        // Two control points at 1/3 and 2/3 along, offset perpendicular ±amp
        var ctrl1x = Math.floor(x0 + midDx / 3 + (-midDy / Math.max(len, 1)) * amp);
        var ctrl1y = Math.floor(y0 + midDy / 3 + ( midDx / Math.max(len, 1)) * amp);
        var ctrl2x = Math.floor(x0 + 2 * midDx / 3 + ( midDy / Math.max(len, 1)) * amp);
        var ctrl2y = Math.floor(y0 + 2 * midDy / 3 + (-midDx / Math.max(len, 1)) * amp);
        var stamped = 0;
        stamped += stampRouteSegment(pIntentMap, x0, y0, ctrl1x, ctrl1y, halfWidth);
        stamped += stampRouteSegment(pIntentMap, ctrl1x, ctrl1y, ctrl2x, ctrl2y, halfWidth);
        stamped += stampRouteSegment(pIntentMap, ctrl2x, ctrl2y, x1, y1, halfWidth);
        return stamped;
    };

    // -----------------------------------------------------------------------
    // StampZigzag — N-segment zigzag between (x0,y0) and (x1,y1).
    pIntent.Variety.StampZigzag = function(pIntentMap, x0, y0, x1, y1, halfWidth, rng) {
        var segments = pIntent.Variety.PerSeedInt(rng, 2, 4);
        var dx = (x1 - x0) / segments;
        var dy = (y1 - y0) / segments;
        var amp = pIntent.Variety.PerSeedRange(rng, 3, 6);
        var stamped = 0;
        var px = x0, py = y0;
        for(var i = 1; i <= segments; ++i) {
            var tx = Math.floor(x0 + dx * i);
            var ty = Math.floor(y0 + dy * i);
            // Alternate perpendicular offset
            var perpSign = (i % 2 === 0) ? 1 : -1;
            var len = Math.sqrt(dx * dx + dy * dy);
            tx = Math.floor(tx + perpSign * (-dy / Math.max(len, 1)) * amp);
            ty = Math.floor(ty + perpSign * ( dx / Math.max(len, 1)) * amp);
            if(i === segments) { tx = x1; ty = y1; }
            stamped += stampRouteSegment(pIntentMap, px, py, tx, ty, halfWidth);
            px = tx;
            py = ty;
        }
        return stamped;
    };

    // -----------------------------------------------------------------------
    // StampStraightCorridor — 3-cell-thick straight horizontal corridor at
    // midY between x0 and x1. Used by Concepts that don't want an S/zigzag.
    pIntent.Variety.StampStraightCorridor = function(pIntentMap, x0, y0, x1, y1, halfWidth) {
        return stampRouteSegment(pIntentMap, x0, y0, x1, y1, halfWidth);
    };

    // -----------------------------------------------------------------------
    // StampForestCellularAutomata — organic forest shaping using cellular
    // automata, replacing per-cell bernoulli with shaped blobs.
    //
    // Algorithm (4-5-rule on 8-neighbours, classic CA cave generator):
    //   1. Initialize a binary grid with bernoulli fill at `seedDensity`.
    //   2. For each iteration:
    //      - For each cell, count forest neighbours in 3x3 (excluding self).
    //      - If count >= 5 OR cell is already forest with count >= 4 → forest.
    //      - Otherwise → empty.
    //   3. After N iterations the grid converges to organic blobs that
    //      survive v1's tree-prune passes (no thin spurs, no singletons).
    //
    // Constraints:
    //   - Region is the bounding rect to fill (skips cells already protected).
    //   - bias allows tuning toward open (lower seedDensity) or dense forest.
    //   - skipPredicate(x, y) lets the caller protect specific zones (route
    //     band, compound footprint, spawn pads) — those cells are NEVER
    //     forest at any iteration.
    //
    // Returns the count of forest cells stamped after CA convergence.

    // -----------------------------------------------------------------------
    // StampContinent — port of v1's Layout/Continent.Build algorithm.
    // Produces an irregular land mass with water naturally surrounding it,
    // using a curvature-weighted frontier walk + cellular smoothing.
    //
    // styles: "island" (centred, 0.74 land), "edge" (anchored on one side,
    //         0.86 land), "rectangle" (centred, 0.92 land — minimal water).
    //
    // The result: every cell on the IntentMap that's NOT inside the grown
    // land mass becomes terrain.WATER. Cells inside the land mass stay as
    // their existing terrain (LAND default). Bank ring is added afterward
    // so the smoother produces real shore tiles.
    //
    // Concepts call this FIRST in their author() so the rectangular interior
    // becomes an organic continent, then stamp features (forest, structures,
    // route) on the LAND cells only.
    pIntent.Variety.StampContinent = function(pIntentMap, opts, rng) {
        opts = opts || {};
        var W = pIntentMap.width;
        var H = pIntentMap.height;
        var style = opts.style || "island";

        // A mainland is an intentionally dry canvas. Previously ice styles
        // could only ask for a 92-98% "rectangle", which still wrapped most
        // maps in a visually repetitive ocean frame. Returning before the
        // frontier walk also avoids consuming thousands of terrain RNG draws
        // for a result whose contract is simply "keep the default LAND".
        if(style === "mainland") {
            return {
                style: style,
                seedX: Math.floor(W * 0.5),
                seedY: Math.floor(H * 0.5),
                landCount: W * H,
                waterStamped: 0,
                landFraction: 1
            };
        }

        var landFraction = opts.landFraction;
        if(landFraction === undefined) {
            landFraction = (style === "rectangle") ? 0.92 :
                           (style === "edge")      ? 0.86 :
                                                     0.74;
        }

        // Allocate land mask (1=land, 0=sea).
        var land = new Uint8Array(W * H);
        function L(x, y) { return land[(y * W) + x]; }
        function setL(x, y, v) { land[(y * W) + x] = v; }

        // Pick seed.
        var jitter = (style === "rectangle") ? 0.10 : 0.15;
        var cx, cy;
        if(style === "edge") {
            var side = pIntent.Variety.PerSeedInt(rng, 0, 3);
            if(side === 0) { cx = pIntent.Variety.PerSeedRange(rng, 0.10, 0.25) * W;
                             cy = pIntent.Variety.PerSeedRange(rng, 0.30, 0.70) * H; }
            else if(side === 1) { cx = pIntent.Variety.PerSeedRange(rng, 0.75, 0.90) * W;
                                  cy = pIntent.Variety.PerSeedRange(rng, 0.30, 0.70) * H; }
            else if(side === 2) { cx = pIntent.Variety.PerSeedRange(rng, 0.30, 0.70) * W;
                                  cy = pIntent.Variety.PerSeedRange(rng, 0.10, 0.25) * H; }
            else { cx = pIntent.Variety.PerSeedRange(rng, 0.30, 0.70) * W;
                   cy = pIntent.Variety.PerSeedRange(rng, 0.75, 0.90) * H; }
        } else {
            cx = W * 0.5 + (unitFloat(rng) * 2 - 1) * jitter * W;
            cy = H * 0.5 + (unitFloat(rng) * 2 - 1) * jitter * H;
        }
        cx = Math.floor(cx);
        cy = Math.floor(cy);
        if(cx < 2) { cx = 2; }
        if(cx > W - 3) { cx = W - 3; }
        if(cy < 2) { cy = 2; }
        if(cy > H - 3) { cy = H - 3; }

        setL(cx, cy, 1);
        var landCount = 1;
        var targetLand = Math.max(1, Math.round(W * H * landFraction));

        // Frontier walk: each step picks a frontier cell weighted by
        // (1 + landNeighbours)^2. Biases growth toward concavities → organic
        // shape. Build frontier as an array of {x,y} objects.
        var frontier = [];
        var inFrontier = new Uint8Array(W * H);
        function pushNeighbours(px, py) {
            var dxs = [1, -1, 0, 0];
            var dys = [0, 0, 1, -1];
            for(var i = 0; i < 4; ++i) {
                var nx = px + dxs[i];
                var ny = py + dys[i];
                if(nx < 0 || ny < 0 || nx >= W || ny >= H) { continue; }
                if(land[(ny * W) + nx]) { continue; }
                if(inFrontier[(ny * W) + nx]) { continue; }
                inFrontier[(ny * W) + nx] = 1;
                frontier.push({ x: nx, y: ny, w: 0 });
            }
        }
        function landNeighbourCount(px, py) {
            var n = 0;
            if(px > 0 && land[(py * W) + px - 1]) { ++n; }
            if(px < W - 1 && land[(py * W) + px + 1]) { ++n; }
            if(py > 0 && land[((py - 1) * W) + px]) { ++n; }
            if(py < H - 1 && land[((py + 1) * W) + px]) { ++n; }
            return n;
        }
        pushNeighbours(cx, cy);

        var iterCap = W * H * 2;
        var iters = 0;
        while(landCount < targetLand && frontier.length > 0 && iters < iterCap) {
            ++iters;
            var totalWeight = 0;
            for(var i = 0; i < frontier.length; ++i) {
                var n = landNeighbourCount(frontier[i].x, frontier[i].y);
                frontier[i].w = (1 + n) * (1 + n);
                totalWeight += frontier[i].w;
            }
            if(totalWeight <= 0) { break; }
            var pick = unitFloat(rng) * totalWeight;
            var pickIdx = 0;
            var acc = 0;
            for(var p = 0; p < frontier.length; ++p) {
                acc += frontier[p].w;
                if(acc >= pick) { pickIdx = p; break; }
            }
            var picked = frontier[pickIdx];
            setL(picked.x, picked.y, 1);
            ++landCount;
            inFrontier[(picked.y * W) + picked.x] = 0;
            // Swap-remove for O(1)
            frontier[pickIdx] = frontier[frontier.length - 1];
            frontier.pop();
            pushNeighbours(picked.x, picked.y);
        }

        // Smoothing passes (5/4 rule, reflective boundary).
        function smoothMask() {
            var nextMask = new Uint8Array(W * H);
            for(var y = 0; y < H; ++y) {
                for(var x = 0; x < W; ++x) {
                    var ncount = 0;
                    var inB = 0;
                    for(var dy = -1; dy <= 1; ++dy) {
                        for(var dx = -1; dx <= 1; ++dx) {
                            if(dx === 0 && dy === 0) { continue; }
                            var nx2 = x + dx;
                            var ny2 = y + dy;
                            if(nx2 < 0 || ny2 < 0 || nx2 >= W || ny2 >= H) { continue; }
                            ++inB;
                            if(land[(ny2 * W) + nx2]) { ++ncount; }
                        }
                    }
                    var here = land[(y * W) + x] ? 1 : 0;
                    var oob = 8 - inB;
                    var nMirrored = ncount + (here ? oob : 0);
                    var alive = (nMirrored >= 5) || (here && nMirrored >= 4);
                    nextMask[(y * W) + x] = alive ? 1 : 0;
                }
            }
            for(var i = 0; i < W * H; ++i) { land[i] = nextMask[i]; }
        }
        smoothMask();
        smoothMask();

        // Trim slivers (7×7 ≥18 threshold)
        function trimSlivers() {
            var nextMask = new Uint8Array(W * H);
            var radius = 3;
            var threshold = 18;
            for(var y = 0; y < H; ++y) {
                for(var x = 0; x < W; ++x) {
                    if(!land[(y * W) + x]) { nextMask[(y * W) + x] = 0; continue; }
                    var ncount = 0;
                    var inB = 0;
                    for(var dy = -radius; dy <= radius; ++dy) {
                        for(var dx = -radius; dx <= radius; ++dx) {
                            if(dx === 0 && dy === 0) { continue; }
                            var nx2 = x + dx;
                            var ny2 = y + dy;
                            if(nx2 < 0 || ny2 < 0 || nx2 >= W || ny2 >= H) { continue; }
                            ++inB;
                            if(land[(ny2 * W) + nx2]) { ++ncount; }
                        }
                    }
                    var totalArea = (radius * 2 + 1) * (radius * 2 + 1) - 1;
                    var oob = totalArea - inB;
                    var nMirrored = ncount + oob;
                    nextMask[(y * W) + x] = (nMirrored >= threshold) ? 1 : 0;
                }
            }
            for(var i = 0; i < W * H; ++i) { land[i] = nextMask[i]; }
        }
        trimSlivers();
        smoothMask();

        // Stamp WATER on every cell that ISN'T land. Skip cells already
        // protected (route/spawn/structure claims) — Concept anchors stay
        // on land regardless of where the frontier walk decided water sits.
        var waterStamped = 0;
        for(var fy = 0; fy < H; ++fy) {
            for(var fx = 0; fx < W; ++fx) {
                if(land[(fy * W) + fx]) { continue; }
                var fi = (fy * W) + fx;
                if(pIntentMap.movement[fi] & (M.ROUTE_PRIMARY | M.ROUTE_SECONDARY |
                                                M.CROSSING | M.BRIDGE | M.KEEP_CLEAR)) {
                    continue;
                }
                if(pIntentMap.claim[fi] & (C.SPAWN_SAFE | C.STRUCT_WALL |
                                            C.STRUCT_FLOOR | C.OBJECTIVE)) {
                    continue;
                }
                pIntent.Map.SetTerrain(pIntentMap, fx, fy, T.WATER);
                pIntent.Map.AddMovement(pIntentMap, fx, fy, M.BLOCKED);
                pIntent.Map.ClearMovement(pIntentMap, fx, fy, M.WALKABLE);
                ++waterStamped;
            }
        }

        return {
            style: style,
            seedX: cx, seedY: cy,
            landCount: landCount,
            waterStamped: waterStamped,
            landFraction: landCount / (W * H)
        };
    };

    // Specialised ice routes keep their authored graph and clearances while
    // sharing the regional forest field. A separate cover plan must not replace
    // the maze/neck/cliff's gameplay anchors or enable regional route carving.
    pIntent.Variety.RegionalForestDensity = function(c, density, strength) {
        if(!c || c.Profile.Name !== "grammar_ice" || !c.Profile.RegionalComposition ||
            MapGen.Context.IsMultiplayer(c)) return null;
        var cover = {Width:c.Width, Height:c.Height, Seed:c.Seed,
            Profile:c.Profile, GameMode:c.GameMode};
        MapGen.Layout.RegionIntents.Prepare(cover);
        if(!cover.RegionalPlan) return null;
        var field = MapGen.Layout.RegionIntents.ForestField(cover);
        var mean = 0, low = Infinity, high = -Infinity;
        for(var i = 0; i < field.length; ++i) {
            mean += field[i]; low = Math.min(low,field[i]); high = Math.max(high,field[i]);
        }
        mean /= field.length;
        var range = Math.max(0.01, high - low);
        for(var j = 0; j < field.length; ++j)
            field[j] = Math.max(0.05, Math.min(0.95,
                density + (field[j] - mean) / range * strength * 2));
        c.IntentStyleContract = c.IntentStyleContract || {};
        c.IntentStyleContract.regionalCover = {shape:cover.RegionalPlan.forestShape,
            regions:cover.RegionalPlan.regions.length, density:density, strength:strength};
        return field;
    };

    pIntent.Variety.StampForestCellularAutomata = function(pIntentMap, region, opts, rng) {
        opts = opts || {};
        var iterations = opts.iterations || 4;
        var seedDensity = opts.seedDensity !== undefined ? opts.seedDensity : 0.50;
        var densityField = opts.seedDensityField || null;
        var skipPredicate = opts.skipPredicate || null;
        var minX = region.minX, maxX = region.maxX;
        var minY = region.minY, maxY = region.maxY;
        var w = maxX - minX + 1;
        var h = maxY - minY + 1;
        if(w <= 2 || h <= 2) { return 0; }

        // Allocate two binary grids (current + next).
        var current = new Uint8Array(w * h);
        var next = new Uint8Array(w * h);

        function cellSkippedAtAbs(ax, ay) {
            if(ax < 0 || ax >= pIntentMap.width || ay < 0 || ay >= pIntentMap.height) {
                return true;
            }
            var i = (ay * pIntentMap.width) + ax;
            // Don't grow forest over claimed/route/spawn cells.
            if(pIntentMap.movement[i] & (M.ROUTE_PRIMARY | M.ROUTE_SECONDARY |
                                          M.CROSSING | M.BRIDGE | M.KEEP_CLEAR)) {
                return true;
            }
            if(pIntentMap.claim[i] & (C.SPAWN_SAFE | C.STRUCT_WALL |
                                       C.STRUCT_FLOOR | C.OBJECTIVE)) {
                return true;
            }
            // Don't grow forest over water/cliff/coast already authored.
            var t = pIntentMap.terrain[i];
            if(t === T.WATER || t === T.RIVER || t === T.RIVERBANK ||
                t === T.CLIFF_BODY || t === T.CLIFF_TOP || t === T.COAST ||
                t === T.OUTCROP) {
                return true;
            }
            if(skipPredicate && skipPredicate(ax, ay)) {
                return true;
            }
            return false;
        }

        // Step 1: bernoulli initialization within the region. Cells that
        // are skipped become permanent open (0) and are never re-evaluated
        // in CA passes (we re-check skip every pass for safety).
        for(var y = 0; y < h; ++y) {
            for(var x = 0; x < w; ++x) {
                var ax = x + minX;
                var ay = y + minY;
                if(cellSkippedAtAbs(ax, ay)) {
                    current[(y * w) + x] = 0;
                    continue;
                }
                var u = unitFloat(rng);
                var density = densityField ? densityField[ay * pIntentMap.width + ax] : seedDensity;
                current[(y * w) + x] = (u < density) ? 1 : 0;
            }
        }

        // Step 2: N CA smoothing passes. Each cell's next state is decided
        // by its current state + neighbour count (Moore neighbourhood,
        // 3x3 minus self).
        for(var iter = 0; iter < iterations; ++iter) {
            for(var py = 0; py < h; ++py) {
                for(var px = 0; px < w; ++px) {
                    var pax = px + minX;
                    var pay = py + minY;
                    if(cellSkippedAtAbs(pax, pay)) {
                        next[(py * w) + px] = 0;
                        continue;
                    }
                    var count = 0;
                    for(var ny = -1; ny <= 1; ++ny) {
                        for(var nx = -1; nx <= 1; ++nx) {
                            if(nx === 0 && ny === 0) { continue; }
                            var qx = px + nx;
                            var qy = py + ny;
                            // Treat out-of-region neighbours as forest so the
                            // boundary stays solid (not eroded by outside-empty
                            // cells). This produces a thicker forest at the
                            // map perimeter, matching v1 grammar_ice's
                            // perimeter cover behaviour.
                            if(qx < 0 || qx >= w || qy < 0 || qy >= h) {
                                ++count;
                                continue;
                            }
                            if(current[(qy * w) + qx]) { ++count; }
                        }
                    }
                    var was = current[(py * w) + px];
                    var becomes;
                    if(was) {
                        becomes = (count >= 4) ? 1 : 0;
                    } else {
                        becomes = (count >= 5) ? 1 : 0;
                    }
                    next[(py * w) + px] = becomes;
                }
            }
            // Swap current <-> next
            var swap = current;
            current = next;
            next = swap;
        }

        // Step 2.5: Thickening pass. The engine's PruneUnsupportedSparseTreeFragments
        // (and the 10 sibling trim/prune passes) remove tree cells with cardinal ≤ 1
        // and total ≤ 3 neighbours — exactly the edge cells of CA blobs. Without
        // thickening, ~80% of authored forest is pruned in render. The fix is one
        // round of conservative dilation: any cell adjacent to ≥ 2 cardinal forest
        // neighbours becomes forest. Fills concavities + thickens curved edges
        // without exploding total area (~30% growth typical).
        var thickened = new Uint8Array(w * h);
        for(var ty = 0; ty < h; ++ty) {
            for(var tx = 0; tx < w; ++tx) {
                var ti = (ty * w) + tx;
                if(current[ti]) { thickened[ti] = 1; continue; }
                var tax = tx + minX;
                var tay = ty + minY;
                if(cellSkippedAtAbs(tax, tay)) { continue; }
                var cardCount = 0;
                if(tx > 0 && current[ti - 1]) { ++cardCount; }
                if(tx < w - 1 && current[ti + 1]) { ++cardCount; }
                if(ty > 0 && current[ti - w]) { ++cardCount; }
                if(ty < h - 1 && current[ti + w]) { ++cardCount; }
                if(cardCount >= 2) { thickened[ti] = 1; }
            }
        }

        // Step 3: stamp final result into IntentMap as FOREST + BLOCKED + TREE owner.
        var stamped = 0;
        for(var fy2 = 0; fy2 < h; ++fy2) {
            for(var fx2 = 0; fx2 < w; ++fx2) {
                if(!thickened[(fy2 * w) + fx2]) { continue; }
                var fax = fx2 + minX;
                var fay = fy2 + minY;
                pIntent.Map.SetTerrain(pIntentMap, fax, fay, T.FOREST);
                pIntent.Map.AddMovement(pIntentMap, fax, fay, M.BLOCKED);
                pIntent.Map.SetOwner(pIntentMap, fax, fay, O.TREE);
                ++stamped;
            }
        }
        return stamped;
    };

    // -----------------------------------------------------------------------
    // StampLake — irregular WATER disc + RIVERBANK ring on adjacent land
    // cells. The bank ring is critical: v1's IceCharMap reads layers.riverBank
    // (which Composite emits from terrain.RIVERBANK) to pick shore transition
    // tiles. Without the ring, the renderer paints hard-edged water blobs
    // instead of gradual shore transitions.
    pIntent.Variety.StampLake = function(pIntentMap, cx, cy, radius, rng) {
        var W = pIntentMap.width;
        var H = pIntentMap.height;
        var stamped = 0;
        var jitterSeed = unitFloat(rng) * 1024;

        // Require the complete disc and its one-cell bank halo to fit. The old
        // per-cell skip could clip a lake against authored route/clearance
        // cells, leaving an incomplete shoreline for later smoothing.
        function protectedCell(x, y) {
            if(x < 0 || x >= W || y < 0 || y >= H)
                return true;
            var i = (y * W) + x;
            return !!(pIntentMap.movement[i] & (M.ROUTE_PRIMARY |
                M.ROUTE_SECONDARY | M.KEEP_CLEAR | M.CROSSING | M.BRIDGE)) ||
                !!(pIntentMap.claim[i] & (C.SPAWN_SAFE | C.STRUCT_WALL |
                    C.STRUCT_FLOOR | C.OBJECTIVE | C.RESERVED | C.COMPOUND));
        }

        function jitterAccepts(x, y, radius) {
            var dx = x - cx, dy = y - cy;
            var dist = Math.sqrt((dx * dx) + (dy * dy));
            var falloff = 1 - (dist / radius);
            var hash = ((x * 0x9E3779B1) ^ (y * 0x85EBCA77) ^
                (jitterSeed | 0)) >>> 0;
            var jitter = (hash & 0xFF) / 255;
            return (falloff + 0.30) - (jitter * 0.55) > 0;
        }

        function fits(candidateX, candidateY, candidateRadius) {
            var footprint = [];
            var footprintSet = {};
            for(var dy = -candidateRadius; dy <= candidateRadius; ++dy) {
                for(var dx = -candidateRadius; dx <= candidateRadius; ++dx) {
                    if((dx * dx) + (dy * dy) > candidateRadius * candidateRadius)
                        continue;
                    var x = candidateX + dx, y = candidateY + dy;
                    if(x < 0 || x >= W || y < 0 || y >= H)
                        return null;
                    if(protectedCell(x, y) ||
                        pIntentMap.terrain[(y * W) + x] !== T.LAND)
                        return null;
                    footprintSet[(y * W) + x] = true;
                    footprint.push({x: x, y: y});
                }
            }

            // The halo is deliberately checked independently of jitter: a
            // skipped edge pixel still participates in the bank-ring shape.
            for(var fi = 0; fi < footprint.length; ++fi) {
                var cell = footprint[fi];
                for(var hy = cell.y - 1; hy <= cell.y + 1; ++hy) {
                    for(var hx = cell.x - 1; hx <= cell.x + 1; ++hx) {
                        if(hx < 0 || hx >= W || hy < 0 || hy >= H)
                            return null;
                        if(footprintSet[(hy * W) + hx])
                            continue;
                        if(protectedCell(hx, hy) ||
                            pIntentMap.terrain[(hy * W) + hx] !== T.LAND)
                            return null;
                    }
                }
            }
            return footprint;
        }

        // Search a small deterministic neighbourhood, retaining the requested
        // center first. This keeps the feature stable while allowing a route
        // crossing to move the lake a few cells rather than clip its shore.
        var candidate = null;
        var maxShift = Math.max(2, Math.min(6, radius));
        var radii = [];
        for(var tryRadius = radius; tryRadius >= 2; --tryRadius)
            radii.push(tryRadius);
        for(var radiusIndex = 0; radiusIndex < radii.length && !candidate; ++radiusIndex) {
            var tryR = radii[radiusIndex];
            for(var shiftR = 0; shiftR <= maxShift && !candidate; ++shiftR) {
                for(var sy = -shiftR; sy <= shiftR && !candidate; ++sy) {
                    for(var sx = -shiftR; sx <= shiftR && !candidate; ++sx) {
                        if(Math.max(Math.abs(sx), Math.abs(sy)) !== shiftR)
                            continue;
                        var testX = cx + sx, testY = cy + sy;
                        var testFootprint = fits(testX, testY, tryR);
                        if(testFootprint)
                            candidate = {x: testX, y: testY, radius: tryR,
                                footprint: testFootprint};
                    }
                }
            }
        }
        if(!candidate)
            return 0;

        cx = candidate.x;
        cy = candidate.y;
        radius = candidate.radius;
        // Pass 1: water disc.
        for(var footprintIndex = 0; footprintIndex < candidate.footprint.length; ++footprintIndex) {
            var x = candidate.footprint[footprintIndex].x;
            var y = candidate.footprint[footprintIndex].y;
            if(!jitterAccepts(x, y, radius)) { continue; }
            pIntent.Map.SetTerrain(pIntentMap, x, y, T.WATER);
            pIntent.Map.AddMovement(pIntentMap, x, y, M.BLOCKED);
            pIntent.Map.ClearMovement(pIntentMap, x, y, M.WALKABLE);
            ++stamped;
        }
        // Pass 2: stamp RIVERBANK on land cells adjacent to any water cell.
        // 8-connected check so corners get banks too. The smoother reads
        // layers.riverBank (via Composite) to produce shore transition art.
        bankRingFromWater(pIntentMap);
        return stamped;
    };

    // Internal helper used by StampLake + StampCoast: find every land cell
    // adjacent to a WATER cell and stamp it RIVERBANK terrain (unless it's
    // already water/route/spawn/structure-claimed).
    function bankRingFromWater(pIntentMap) {
        var W = pIntentMap.width;
        var H = pIntentMap.height;
        var ringStamped = 0;
        for(var ry = 0; ry < H; ++ry) {
            for(var rx = 0; rx < W; ++rx) {
                var ri = (ry * W) + rx;
                // Only land cells become banks.
                if(pIntentMap.terrain[ri] === T.WATER || pIntentMap.terrain[ri] === T.RIVER ||
                    pIntentMap.terrain[ri] === T.RIVERBANK) { continue; }
                // Don't overwrite forest/cliff/outcrop/coast — those have higher
                // visual priority. Bank is for plain LAND adjacent to water.
                if(pIntentMap.terrain[ri] !== T.LAND) { continue; }
                // Don't bank route cells (water-bridge transitions handled
                // separately).
                if(pIntentMap.movement[ri] & (M.ROUTE_PRIMARY | M.ROUTE_SECONDARY |
                                                M.CROSSING | M.BRIDGE)) { continue; }
                if(pIntentMap.claim[ri] & (C.SPAWN_SAFE | C.STRUCT_WALL |
                                            C.STRUCT_FLOOR | C.OBJECTIVE)) { continue; }
                // Check 8-neighbor adjacency to water.
                var hasWaterNeighbour = false;
                for(var ny = ry - 1; ny <= ry + 1 && !hasWaterNeighbour; ++ny) {
                    for(var nx = rx - 1; nx <= rx + 1 && !hasWaterNeighbour; ++nx) {
                        if(nx === rx && ny === ry) { continue; }
                        if(nx < 0 || nx >= W || ny < 0 || ny >= H) { continue; }
                        var ni = (ny * W) + nx;
                        if(pIntentMap.terrain[ni] === T.WATER ||
                            pIntentMap.terrain[ni] === T.RIVER) {
                            hasWaterNeighbour = true;
                        }
                    }
                }
                if(hasWaterNeighbour) {
                    pIntent.Map.SetTerrain(pIntentMap, rx, ry, T.RIVERBANK);
                    ++ringStamped;
                }
            }
        }
        return ringStamped;
    }

    // -----------------------------------------------------------------------
    // StampCoast — stamps WATER along one edge of the interior, falloff
    // shape produces a coastline rather than a perfect rectangle. `edge`
    // is one of "north"/"south"/"east"/"west". Width is the band thickness
    // (3-7 cells typical for ice).
    pIntent.Variety.StampCoast = function(pIntentMap, edge, width, perimeterMargin, rng) {
        var W = pIntentMap.width;
        var H = pIntentMap.height;
        var stamped = 0;
        var pm = perimeterMargin || 0;
        var jitterSeed = unitFloat(rng) * 1024;

        function maybeStampWater(x, y, intoLand) {
            if(x < 0 || x >= W || y < 0 || y >= H) { return; }
            var i = (y * W) + x;
            if(pIntentMap.movement[i] & (M.ROUTE_PRIMARY | M.ROUTE_SECONDARY |
                                          M.CROSSING | M.BRIDGE | M.KEEP_CLEAR)) { return; }
            if(pIntentMap.claim[i] & (C.SPAWN_SAFE | C.STRUCT_WALL |
                                      C.STRUCT_FLOOR | C.OBJECTIVE)) { return; }
            // Falloff: base depth taper + per-cell hash jitter for irregular
            // coastline. intoLand is 0 at the edge, increasing as we move
            // inward; coast probability decreases as we go deeper.
            var falloff = 1 - (intoLand / Math.max(1, width));
            var hash = ((x * 0x9E3779B1) ^ (y * 0x85EBCA77) ^ (jitterSeed | 0)) >>> 0;
            var jitter = (hash & 0xFF) / 255;
            if((falloff + 0.20) - (jitter * 0.50) <= 0) { return; }
            pIntent.Map.SetTerrain(pIntentMap, x, y, T.WATER);
            pIntent.Map.AddMovement(pIntentMap, x, y, M.BLOCKED);
            pIntent.Map.ClearMovement(pIntentMap, x, y, M.WALKABLE);
            ++stamped;
        }

        if(edge === "north") {
            for(var nx = pm; nx < W - pm; ++nx) {
                for(var ny = 0; ny < width; ++ny) {
                    maybeStampWater(nx, ny + pm, ny);
                }
            }
        } else if(edge === "south") {
            for(var sx = pm; sx < W - pm; ++sx) {
                for(var sy = 0; sy < width; ++sy) {
                    maybeStampWater(sx, H - 1 - pm - sy, sy);
                }
            }
        } else if(edge === "east") {
            for(var ey = pm; ey < H - pm; ++ey) {
                for(var ex = 0; ex < width; ++ex) {
                    maybeStampWater(W - 1 - pm - ex, ey, ex);
                }
            }
        } else if(edge === "west") {
            for(var wy = pm; wy < H - pm; ++wy) {
                for(var wx = 0; wx < width; ++wx) {
                    maybeStampWater(wx + pm, wy, wx);
                }
            }
        }
        // Stamp RIVERBANK on land cells adjacent to the new water — see
        // StampLake's pass-2 comment for why this matters for smoothing.
        bankRingFromWater(pIntentMap);
        return stamped;
    };

    // -----------------------------------------------------------------------
    // StampDefensiveLine — mirrors v1's Layout/DefensiveLines.js: a
    // perpendicular-to-route band of forest cells the player has to navigate
    // around or push through. Creates a tactical chokepoint.
    //
    // For an east-west route at midY, this stamps a VERTICAL band at column
    // (route fraction) — thickness 2-3 cells, height covering most of the
    // map's Y axis, with a 3-cell gap somewhere the player can pass through.
    //
    // Args:
    //   axis: "vertical" → vertical band at columnX, gap at gapY±halfGap
    //         "horizontal" → horizontal band at rowY, gap at gapX±halfGap
    //   columnX/rowY: where the band sits
    //   yStart/yEnd or xStart/xEnd: how far the band extends
    //   gapAt: cell index where the gap is centered (the "way through")
    //   thickness: cells perpendicular to the band axis
    //   halfGap: gap is (halfGap*2 + 1) cells wide
    //   rng: variety RNG for any per-cell jitter
    pIntent.Variety.StampDefensiveLine = function(pIntentMap, opts, rng) {
        opts = opts || {};
        var axis = opts.axis || "vertical";
        var thickness = opts.thickness || 2;
        var halfGap = opts.halfGap !== undefined ? opts.halfGap : 1;
        var stamped = 0;
        if(axis === "vertical") {
            var columnX = opts.columnX | 0;
            var yStart = opts.yStart | 0;
            var yEnd = opts.yEnd | 0;
            var gapAt = opts.gapAt | 0;
            for(var y = yStart; y <= yEnd; ++y) {
                if(y >= gapAt - halfGap && y <= gapAt + halfGap) { continue; }
                for(var dx = 0; dx < thickness; ++dx) {
                    var x = columnX + dx;
                    if(x < 0 || x >= pIntentMap.width) { continue; }
                    if(y < 0 || y >= pIntentMap.height) { continue; }
                    var i = (y * pIntentMap.width) + x;
                    // Don't stamp on protected cells
                    if(isProtectedTerrain(pIntentMap, i)) { continue; }
                    if(pIntentMap.movement[i] & (M.ROUTE_PRIMARY | M.ROUTE_SECONDARY |
                                                  M.CROSSING | M.BRIDGE | M.KEEP_CLEAR)) { continue; }
                    if(pIntentMap.claim[i] & (C.SPAWN_SAFE | C.STRUCT_WALL |
                                              C.STRUCT_FLOOR | C.OBJECTIVE)) { continue; }
                    pIntent.Map.SetTerrain(pIntentMap, x, y, T.FOREST);
                    pIntent.Map.AddMovement(pIntentMap, x, y, M.BLOCKED);
                    pIntent.Map.SetOwner(pIntentMap, x, y, O.TREE);
                    ++stamped;
                }
            }
        } else if(axis === "horizontal") {
            var rowY = opts.rowY | 0;
            var xStart = opts.xStart | 0;
            var xEnd = opts.xEnd | 0;
            var hGapAt = opts.gapAt | 0;
            for(var hx = xStart; hx <= xEnd; ++hx) {
                if(hx >= hGapAt - halfGap && hx <= hGapAt + halfGap) { continue; }
                for(var dy = 0; dy < thickness; ++dy) {
                    var hy = rowY + dy;
                    if(hx < 0 || hx >= pIntentMap.width) { continue; }
                    if(hy < 0 || hy >= pIntentMap.height) { continue; }
                    var hi = (hy * pIntentMap.width) + hx;
                    if(isProtectedTerrain(pIntentMap, hi)) { continue; }
                    if(pIntentMap.movement[hi] & (M.ROUTE_PRIMARY | M.ROUTE_SECONDARY |
                                                    M.CROSSING | M.BRIDGE | M.KEEP_CLEAR)) { continue; }
                    if(pIntentMap.claim[hi] & (C.SPAWN_SAFE | C.STRUCT_WALL |
                                               C.STRUCT_FLOOR | C.OBJECTIVE)) { continue; }
                    pIntent.Map.SetTerrain(pIntentMap, hx, hy, T.FOREST);
                    pIntent.Map.AddMovement(pIntentMap, hx, hy, M.BLOCKED);
                    pIntent.Map.SetOwner(pIntentMap, hx, hy, O.TREE);
                    ++stamped;
                }
            }
        }
        return stamped;
    };

    // -----------------------------------------------------------------------
    // PickRouteShape — picks one of "straight" / "s_curve" / "zigzag" based
    // on per-seed RNG. Concepts use this to vary corridor shape between
    // seeds.
    pIntent.Variety.PickRouteShape = function(rng) {
        return pIntent.Variety.PerSeedChoice(rng,
            ["straight", "straight", "s_curve", "zigzag"]);
        // weighted: 50% straight, 25% s_curve, 25% zigzag
    };

    pIntent.Variety.StampRouteByShape = function(pIntentMap, shape, x0, y0, x1, y1,
                                                  halfWidth, rng) {
        if(shape === "s_curve") {
            return pIntent.Variety.StampSCurve(pIntentMap, x0, y0, x1, y1, halfWidth, rng);
        }
        if(shape === "zigzag") {
            return pIntent.Variety.StampZigzag(pIntentMap, x0, y0, x1, y1, halfWidth, rng);
        }
        return pIntent.Variety.StampStraightCorridor(pIntentMap, x0, y0, x1, y1, halfWidth);
    };

})(MapGen.Intent);
