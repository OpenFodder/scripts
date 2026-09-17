var MapGen = MapGen || {};
MapGen.Intent = MapGen.Intent || {};

// Regional ice uses the shared graph and forest fields. Intent reservations
// remain authoritative, and the existing ice renderer owns all shore art.
(function(I) {
    var T = I.Terrain, M = I.Movement, C = I.Claim, O = I.Owner;

    function author(plan, map, rngs, c) {
        var cliffPlan = I.RegionalTerrain.PlanIceCliff(c);
        MapGen.Layout.RegionIntents.Prepare(c, cliffPlan ? cliffPlan.regions : null);
        var regional = c.RegionalPlan, W = map.width, H = map.height;
        if(!regional) return I.AuthorResult.Fail(I.AuthorReason.InsufficientOpenArea);
        var random = rngs.terrain, regions = regional.regions, spine = regional.spine;
        var mode = c.Profile.RegionalIceTerrain;
        regional.landscape = mode;
        map.regions = [];
        var cliff = I.RegionalTerrain.IceCliff(map, cliffPlan);
        function anchor(point, owner) {
            for(var y = point.y - 2; y <= point.y + 2; ++y)
                for(var x = point.x - 2; x <= point.x + 2; ++x) {
                    I.Map.AddClaim(map, x, y, C.SPAWN_SAFE);
                    I.Map.AddMovement(map, x, y, M.WALKABLE | M.KEEP_CLEAR);
                }
            I.Map.SetOwner(map, point.x, point.y, owner);
        }
        map.anchors = {start: regions[spine[0]].point,
            objective: regions[spine[spine.length - 1]].point,
            support: regions[spine[Math.floor(spine.length / 2)]].point};
        anchor(map.anchors.start, O.PLAYER_SPAWN);
        anchor(map.anchors.objective, O.STRUCTURE);

        // Dilated reservations leave room for complete snow/shallow banks.
        // Small isolated proposals are removed before any tile fitting runs.
        var protectedCells = new Uint8Array(W * H), water = new Uint8Array(W * H);
        for(var py = 0; py < H; ++py) for(var px = 0; px < W; ++px) {
            if(!(map.movement[py * W + px] & M.KEEP_CLEAR)) continue;
            for(var dy = -2; dy <= 2; ++dy) for(var dx = -2; dx <= 2; ++dx) {
                var ax = px + dx, ay = py + dy;
                if(ax >= 0 && ay >= 0 && ax < W && ay < H) protectedCells[ay * W + ax] = 1;
            }
        }
        for(var ri = 0; ri < regions.length; ++ri) {
            var point = regions[ri].point;
            for(var sy = Math.max(0, point.y - 7); sy <= Math.min(H - 1, point.y + 7); ++sy)
                for(var sx = Math.max(0, point.x - 7); sx <= Math.min(W - 1, point.x + 7); ++sx)
                    if((sx - point.x) * (sx - point.x) + (sy - point.y) * (sy - point.y) <= 49)
                        protectedCells[sy * W + sx] = 1;
        }
        var angle = random.Float(0, Math.PI), co = Math.cos(angle), si = Math.sin(angle);
        var phase = random.Float(0, Math.PI * 2), edge = random.Int(0, 3);
        var basin = MapGen.Layout.WaterGeography.Plan(random);
        if(mode === "lakes" || mode === "woodland") regional.waterGeography = basin;
        var proposals = [];
        for(var wy = 0; wy < H; ++wy) for(var wx = 0; wx < W; ++wx) {
            if(protectedCells[wy * W + wx]) continue;
            var nx = wx / (W - 1), ny = wy / (H - 1), score = -10;
            var u = (nx - 0.5) * co + (ny - 0.5) * si;
            var v = (ny - 0.5) * co - (nx - 0.5) * si;
            if(mode === "inlets") {
                var along = edge < 2 ? nx : ny;
                var inward = edge === 0 ? ny : edge === 1 ? 1 - ny : edge === 2 ? nx : 1 - nx;
                var coast = 0.10 + 0.12 * (1 + Math.sin(along * Math.PI * 3 + phase));
                score = (coast - inward) * 5;
            } else if(mode === "river_loop") {
                var bend = 0.08 * Math.sin(v * 8 + phase);
                var fork = Math.max(0, 1 - Math.abs(v) * 2.8) * 0.15;
                score = (0.065 - Math.min(Math.abs(u - bend - fork), Math.abs(u - bend + fork))) * 10;
            } else {
                score = MapGen.Layout.WaterGeography.Score(basin, nx, ny);
            }
            proposals.push({i: wy * W + wx, score: score});
        }
        proposals.sort(function(a, b) { return b.score - a.score || a.i - b.i; });
        // Leave headroom for the renderer's wider shallow-water transitions.
        var budget = Math.floor(W * H * Math.min(c.Profile.RegionalIceWaterCoverage,
            c.Profile.MaxWaterCoverage * 0.78));
        regional.waterCoverageTarget = budget / (W * H);
        for(var wi = 0; wi < Math.min(budget, proposals.length); ++wi) water[proposals[wi].i] = 1;
        var seen = new Uint8Array(W * H), waterCells = 0;
        for(var start = 0; start < water.length; ++start) {
            if(!water[start] || seen[start]) continue;
            var queue = [start]; seen[start] = 1;
            for(var qi = 0; qi < queue.length; ++qi) {
                var at = queue[qi], qx = at % W, qy = Math.floor(at / W);
                var neighbours = [qx > 0 ? at - 1 : -1, qx + 1 < W ? at + 1 : -1,
                    qy > 0 ? at - W : -1, qy + 1 < H ? at + W : -1];
                for(var ni = 0; ni < 4; ++ni) {
                    var next = neighbours[ni];
                    if(next >= 0 && water[next] && !seen[next]) { seen[next] = 1; queue.push(next); }
                }
            }
            if(queue.length < 18) { for(var rm = 0; rm < queue.length; ++rm) water[queue[rm]] = 0; }
            else waterCells += queue.length;
        }
        for(var yy = 0; yy < H; ++yy) for(var xx = 0; xx < W; ++xx) {
            var index = yy * W + xx;
            if(map.terrain[index] === T.CLIFF_BODY || map.terrain[index] === T.CLIFF_TOP) continue;
            if(water[index]) {
                I.Map.SetTerrain(map, xx, yy, T.WATER);
                I.Map.AddMovement(map, xx, yy, M.BLOCKED);
            } else {
                I.Map.AddMovement(map, xx, yy, M.WALKABLE);
                if(map.movement[index] & M.KEEP_CLEAR) continue;
                var bank = false;
                for(var by = Math.max(0, yy - 1); by <= Math.min(H - 1, yy + 1); ++by)
                    for(var bx = Math.max(0, xx - 1); bx <= Math.min(W - 1, xx + 1); ++bx)
                        if(water[by * W + bx]) bank = true;
                if(bank) I.Map.SetTerrain(map, xx, yy, T.RIVERBANK);
            }
        }
        var route = I.RegionalTerrain.IceRoutes(c, map);
        if(!route) return I.AuthorResult.Fail(I.AuthorReason.NoValidTransit,
            [I.AuthorResult.Diagnostic("ice_regional.routes", "No dry route or bounded crossing fits the terrain")]);
        // Smooth spatial fields grow substantial bodies, avoiding per-cell
        // scatter which is mostly discarded by the ice tree tile grammar.
        var field = MapGen.Layout.RegionIntents.ForestField(c), scores = [];
        for(var fy = 3; fy < H - 3; ++fy) for(var fx = 3; fx < W - 3; ++fx) {
            var fi = fy * W + fx;
            if(map.terrain[fi] !== T.LAND || map.movement[fi] & M.KEEP_CLEAR) continue;
            var noise = Math.sin(fx * 0.19 + phase) * Math.cos(fy * 0.17 - phase) * 0.12;
            scores.push({i: fi, score: field[fi] + noise});
        }
        scores.sort(function(a, b) { return b.score - a.score || a.i - b.i; });
        // Small maps lose a larger share of canopy to routes and building
        // clearings, and water introduces additional shore pruning. Grow
        // complete bodies with headroom for both sources of lost canopy.
        var forestCoverage = c.Profile.TreeCoverage + (W * H < 3200 ? 0.05 : 0) +
            waterCells / (W * H) * 0.15;
        var target = Math.min(scores.length, Math.floor(W * H * forestCoverage));
        for(var ti = 0; ti < target; ++ti) {
            var cell = scores[ti].i;
            I.Map.SetTerrain(map, cell % W, Math.floor(cell / W), T.FOREST);
            I.Map.ClearMovement(map, cell % W, Math.floor(cell / W), M.WALKABLE);
            I.Map.AddMovement(map, cell % W, Math.floor(cell / W), M.BLOCKED);
            I.Map.SetOwner(map, cell % W, Math.floor(cell / W), O.TREE);
        }
        // This concept already ranks a complete, coherent forest mask. A
        // second patch-and-grow allocation thins it into unrelated fragments
        // and can discard most of a small map's authored cover budget.
        if(c.Profile.ForestUseAuthoredMask === undefined)
            c.Profile.ForestUseAuthoredMask = true;
        map.regions = map.regions.concat([{id: "regional.routes", kind: "route", cells: route.cells},
            {id: "regional.water", kind: mode, cells: waterCells},
            {id: "regional.forest", kind: "forest", cells: target}]);
        c.IntentStyleContract = {style: c.Profile.GrammarIceLayoutStyle, landscape: mode,
            topology: regional.topology, waterCells: waterCells,
            cliff:cliff, waterCrossings:route.crossings};
        return I.AuthorResult.Ok([]);
    }

    I.RegisterConcept({id: "ice_regional", biome: "ice",
        appliesTo: function(profile, dimensions, plan) {
            var p = profile._wrapped || profile;
            var style = p.GrammarIceLayoutStyle || "";
            return !!p.RegionalComposition && !dimensions.multiplayer && p.Name === "grammar_ice" &&
                style !== "ice_tree_maze" && style !== "ice_neck_route" &&
                style !== "ice_cliff_checkpoint" && style !== "ice_cliff_terrace";
        }, author: author,
        driftBudget: {landIntentSolidMaxFraction: 0.20, forestPruneRatioMax: 0.55}
    });
})(MapGen.Intent);
