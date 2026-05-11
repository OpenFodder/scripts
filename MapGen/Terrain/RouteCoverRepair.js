var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};

// One deterministic, bounded pass beside the measured tactical route. Small
// 2x2 clusters survive normal cover smoothing; all gameplay reservations win.
(function(R) {
    function satisfies(c, samples, minimum, step) {
        var exposed = 0, run = 0, longest = 0;
        for(var i = 0; i < samples.length; ++i) {
            if(samples[i].cover < minimum) {
                ++exposed;
                run += step;
                longest = Math.max(longest, run);
            } else run = 0;
        }
        var p = c.Profile;
        return (p.MaxRouteExposureFraction === undefined || exposed <= samples.length * p.MaxRouteExposureFraction) &&
            (p.MaxRouteExposedRunTiles === undefined || longest <= p.MaxRouteExposedRunTiles);
    }

    R.Run = function(c, report) {
        var repair = MapGen.Repair, V = MapGen.Validate, L = MapGen.Layers;
        if(c.RouteCoverRepair || !report || report.ok || MapGen.Context.IsMultiplayer(c) ||
            (!repair.HasKey(report.reasons, "route_exposure_too_high") &&
             !repair.HasKey(report.reasons, "route_exposed_run_too_long"))) return false;
        var path = c.TacticalRoutePath || [], p = c.Profile, W = c.Width, H = c.Height;
        if(!path.length) return false;
        var radius = Math.max(2, Math.floor(p.RouteExposureRadius || 5));
        var step = Math.max(1, Math.floor(p.RouteExposureSampleStep || 3));
        var stats = {kind: "route_cover", tiles: 0, patches: 0, candidates: 0};
        c.RouteCoverRepair = stats;
        c.LocalRepairs = c.LocalRepairs || [];
        c.LocalRepairs.push(stats);
        // Explicit work bounds also cover custom profiles with extreme dials.
        if(radius > 8 || path.length > W * H) {
            stats.stopped = "probe_limit";
            return false;
        }
        var before = V.RouteExposure(c, path), minimum = before.minCover;
        stats.before = before;
        var ceiling = p.MaxTreeCoverage !== undefined ? p.MaxTreeCoverage : Math.min(.90, (p.TreeCoverage || 0) * 1.15);
        var budget = Math.min(128, Math.floor(W * H * .03),
            Math.floor(W * H * ceiling) - MapGen.Metrics.TreeBlockedCount(c));
        stats.budget = Math.max(0, budget);
        if(budget < 4) {
            stats.stopped = "cover_budget";
            return false;
        }
        var protectedCells = new Uint8Array(W * H), samples = [], candidates = [], seen = {}, changed = [];
        // Protect the actual route as well as the planned routes. The measured
        // shortest path can take a shortcut outside the original corridor.
        for(var i = 0; i < path.length; ++i) {
            var point = path[i];
            for(var dy = -1; dy <= 1; ++dy)
                for(var dx = -1; dx <= 1; ++dx) {
                    var x = point.x + dx, y = point.y + dy;
                    if(x >= 0 && x < W && y >= 0 && y < H) protectedCells[y * W + x] = 1;
                }
            if(i % step === 0)
                samples.push({x: point.x, y: point.y, cover: V.CountRouteCoverAround(c, point, radius)});
        }
        // Decorative clearing rings are soft space. Use the same safety rules
        // as post-placement cover, retaining hard reservations and actor gaps.
        var coverOptions = {allowKeepClear: true, criticalClearance: 3, placementClearance: 3};
        function allowed(x, y) {
            var layers = c.Layers, reservations = MapGen.Layout.Reservations;
            return x > 0 && y > 0 && x < W - 1 && y < H - 1 &&
                !protectedCells[y * W + x] && !L.Get(layers.blocked, x, y, 0) &&
                !L.Get(layers.path, x, y, 0) && !L.Get(layers.occupied, x, y, 0) &&
                !L.Get(layers.outcrop, x, y, 0) && !reservations.IsWater(c, x, y) &&
                !reservations.IsHardTerrain(c, x, y) && !MapGen.Terrain.Cover.IsExcluded(c, x, y, true) &&
                MapGen.Terrain.Cover.CanStampTacticalCover(c, x, y, coverOptions);
        }
        function patchCells(x, y) {
            var cells = [];
            for(var oy = 0; oy < 2; ++oy)
                for(var ox = 0; ox < 2; ++ox) {
                    var px = x + ox, py = y + oy;
                    if(MapGen.Metrics.IsTreeBlocked(c, px, py)) continue;
                    if(!allowed(px, py)) return null;
                    cells.push({x: px, y: py});
                }
            return cells.length ? cells : null;
        }
        function available(candidate) {
            // Adjacent patches may share cells already added by this pass.
            // Keep their remaining contribution instead of discarding the
            // whole patch and incorrectly reporting no safe cover.
            var remaining = [];
            for(var i = 0; i < candidate.cells.length; ++i) {
                var cell = candidate.cells[i];
                if(MapGen.Metrics.IsTreeBlocked(c, cell.x, cell.y)) continue;
                if(!allowed(cell.x, cell.y)) return false;
                remaining.push(cell);
            }
            if(remaining.length !== candidate.cells.length) {
                candidate.cells = remaining;
                for(var h = 0; h < candidate.hits.length; ++h) {
                    var hit = candidate.hits[h], sample = samples[hit.sample];
                    hit.count = 0;
                    for(var j = 0; j < remaining.length; ++j) {
                        var dx = remaining[j].x - sample.x, dy = remaining[j].y - sample.y;
                        if(dx * dx + dy * dy <= radiusSq) ++hit.count;
                    }
                }
            }
            return remaining.length > 0;
        }
        var radiusSq = radius * radius;
        for(var si = 0; si < samples.length; ++si) {
            var sample = samples[si];
            if(sample.cover >= minimum) continue;
            for(var cy = Math.max(1, sample.y - radius); cy <= Math.min(H - 3, sample.y + radius); ++cy) {
                for(var cx = Math.max(1, sample.x - radius); cx <= Math.min(W - 3, sample.x + radius); ++cx) {
                    var key = cy * W + cx;
                    if(seen[key]) continue;
                    seen[key] = true;
                    var cells = patchCells(cx, cy);
                    if(!cells) continue;
                    var hits = [];
                    for(var j = 0; j < samples.length; ++j) {
                        var s = samples[j], count = 0;
                        if(s.cover >= minimum || Math.abs(cx - s.x) > radius + 1 || Math.abs(cy - s.y) > radius + 1) continue;
                        for(var ci = 0; ci < cells.length; ++ci) {
                            var ax = cells[ci].x - s.x, ay = cells[ci].y - s.y;
                            if(ax * ax + ay * ay <= radiusSq) ++count;
                        }
                        if(count) hits.push({sample: j, count: count});
                    }
                    if(hits.length) candidates.push({cells: cells, hits: hits});
                }
            }
        }
        stats.candidates = candidates.length;
        // Reject an impossible repair before spending its patch budget. The
        // union is an optimistic upper bound: it even ignores patch conflicts
        // and the tile budget, while counting each possible cover cell once.
        var possible = [], capacityCells = new Uint8Array(W * H);
        for(var sampleIndex = 0; sampleIndex < samples.length; ++sampleIndex)
            possible.push({cover: samples[sampleIndex].cover});
        for(var candidateIndex = 0; candidateIndex < candidates.length; ++candidateIndex) {
            var capacity = candidates[candidateIndex].cells;
            for(var ci = 0; ci < capacity.length; ++ci) {
                var cell = capacity[ci], cellIndex = cell.y * W + cell.x;
                if(capacityCells[cellIndex]) continue;
                capacityCells[cellIndex] = 1;
                for(var sj = 0; sj < samples.length; ++sj) {
                    var dx = cell.x - samples[sj].x, dy = cell.y - samples[sj].y;
                    if(dx * dx + dy * dy <= radiusSq) ++possible[sj].cover;
                }
            }
        }
        if(!satisfies(c, possible, minimum, step)) {
            stats.stopped = "insufficient_safe_cover";
            return false;
        }
        while(stats.tiles < budget && stats.patches < 32 && !satisfies(c, samples, minimum, step)) {
            var best = null, bestScore = 0;
            for(var k = 0; k < candidates.length; ++k) {
                var candidate = candidates[k];
                if(candidate.used) continue;
                if(!available(candidate)) { candidate.used = true; continue; }
                if(stats.tiles + candidate.cells.length > budget) continue;
                var score = 0;
                for(var h = 0; h < candidate.hits.length; ++h) {
                    var hit = candidate.hits[h], deficit = minimum - samples[hit.sample].cover;
                    if(deficit > 0) score += Math.min(deficit, hit.count) + (hit.count >= deficit ? minimum : 0);
                }
                score /= candidate.cells.length;
                // Candidate order is deterministic, so equal scores need no sort.
                if(score > bestScore) {
                    best = candidate;
                    bestScore = score;
                }
            }
            if(!best) break;
            best.used = true;
            for(var bc = 0; bc < best.cells.length; ++bc) {
                var cell = best.cells[bc];
                changed.push({x: cell.x, y: cell.y, owner: L.Get(c.Layers.owner, cell.x, cell.y, 0),
                    trimmed: L.Get(c.Layers.treeTrimmed, cell.x, cell.y, 0)});
                MapGen.Terrain.Cover.MarkTreeCell(c, cell.x, cell.y);
            }
            for(var bi = 0; bi < best.hits.length; ++bi) {
                var affected = best.hits[bi];
                samples[affected.sample].cover += affected.count;
            }
            stats.tiles += best.cells.length;
            ++stats.patches;
        }
        stats.after = V.RouteExposure(c, path);
        stats.stopped = satisfies(c, samples, minimum, step) ? "target_met" :
            (stats.tiles >= budget || stats.patches >= 32 ? "cover_budget" : "no_safe_patch");
        // An incomplete patch set cannot rescue this attempt. Undo it without
        // paying for another full render/validation, or disturbing other repairs.
        if(stats.stopped !== "target_met") {
            for(var undo = 0; undo < changed.length; ++undo) {
                var old = changed[undo];
                L.Set(c.Layers.blocked, old.x, old.y, 0);
                if(c.Layers.owner) L.Set(c.Layers.owner, old.x, old.y, old.owner);
                if(c.Layers.treeTrimmed) L.Set(c.Layers.treeTrimmed, old.x, old.y, old.trimmed);
            }
            stats.rolledBack = true;
        }
        MapGen.Context.AddLog(c, "Repair route cover: " + stats.tiles + " tiles, " + stats.stopped);
        return stats.tiles > 0 && !stats.rolledBack;
    };
})(MapGen.Terrain.RouteCoverRepair = MapGen.Terrain.RouteCoverRepair || {});
