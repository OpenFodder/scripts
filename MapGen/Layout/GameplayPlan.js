var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// Exact building geometry and approaches are settled before terrain detail.
(function(P) {
    function expanded(r, n) {
        return {minX : r.minX - n, minY : r.minY - n, maxX : r.maxX + n, maxY : r.maxY + n};
    }
    P.Policy = function(c) {
        var p = c.Profile || {}, name = String(p.Name || "") + " " + String(p.GrammarIceLayoutStyle || "");
        if(p.JungleMazeRouteTopology || p.JungleMazeForestFill || name.indexOf("maze") >= 0)
            return "maze";
        if(p.CliffLayoutPhase || name.indexOf("cliff") >= 0 || name.indexOf("terrace") >= 0)
            return "cliffs";
        if(name.indexOf("river") >= 0 || name.indexOf("beach") >= 0 || name.indexOf("island") >= 0)
            return "water";
        return "open";
    };
    P.Build = function(c, waterBudgeted) {
        if(c.GameplayPlan)
            return c.GameplayPlan;
        var I = MapGen.Integration, R = MapGen.Layout.Reservations;
        R.Paths(c);
        if(MapGen.Context.IsMultiplayer(c)) {
            R.Apply(c);
            return null;
        }
        var specs = I.FlattenBuildings(I.CampaignBuildingRequirements(c));
        var enemyCount = specs.length;
        var label = String(c.Profile.GrammarLiveObjectiveLabel ||
                           (c.GrammarPlan && c.GrammarPlan.intent && c.GrammarPlan.intent.objectiveLabel) || "");
        if(label === "civilian_delivery")
            specs.push({building : "hut", sprite : "civilian_rescue"});
        var plan = {version : 1, policy : P.Policy(c), entries : [], required : specs.length, ok : true};
        c.GameplayPlan = plan;
        MapGen.Encounters.BuildCampaignRegions(c);
        var g = MapGen.Layout.BuildingSites.Prepare(c);
        function snapshot() {
            var r = R.Ensure(c);
            return {mask: new Uint8Array(r.mask), cells: r.cells.slice(0),
                path: MapGen.Layers.Clone(c.Layers.path), paths: c.Paths.length};
        }
        function restore(s) {
            c.GameplayReservations = {mask: new Uint8Array(s.mask), cells: s.cells.slice(0)};
            c.Layers.path = MapGen.Layers.Clone(s.path);
            c.Paths.length = s.paths;
        }
        function reserve(candidate, i) {
            plan.entries.push(
                {spec : specs[i], purpose : i < enemyCount ? "enemy" : "civilian_home", candidate : candidate});
            R.Rect(c, expanded(candidate.clearance, 2), R.FLEX);
            R.Rect(c, expanded(candidate.rect, Math.max(2, candidate.waterClearance)), R.BUFFER);
            R.Rect(c, candidate.clearance, R.CLEAR);
            R.Rect(c, candidate.rect, R.CLEAR | R.FLOOR);
            c.Paths.push({role : "planned_structure_access", radius : 0, points : candidate.accessPath});
            for(var pi = 0; pi < candidate.accessPath.length; ++pi) {
                var p = candidate.accessPath[pi];
                R.Rect(c, {minX : p.x, minY : p.y, maxX : p.x, maxY : p.y}, R.CLEAR | R.ROUTE);
                MapGen.Layers.Set(c.Layers.path, p.x, p.y, 1);
            }
        }
        var initial = snapshot(), deepest = 0;
        for(var i = 0; i < specs.length; ++i) {
            var candidate = MapGen.Layout.BuildingSites.Find(c, g, plan.entries, specs[i], plan.policy);
            if(!candidate) break;
            reserve(candidate, i);
            deepest = plan.entries.length;
        }
        if(plan.entries.length < specs.length) {
            restore(initial);
            plan.entries = [];
            var probes = 0, limit = 32;
            // Retry a few earlier decisions, not the whole terrain. Dense
            // sampling finds narrow sites the normal three-cell grid misses.
            function search(i, diverse) {
                if(i === specs.length) return true;
                var state = snapshot();
                for(var rank = 0; rank < 3 && probes < limit; ++rank) {
                    ++probes;
                    var options = {skip: rank, dense: plan.policy === "maze" || diverse, diverse: diverse};
                    var next = MapGen.Layout.BuildingSites.Find(c, g, plan.entries, specs[i], plan.policy, options);
                    // The normal three-cell lattice is sufficient for large
                    // maps, but can jump over the only legal apron on a
                    // compact map. Retry the same ranked alternative on the
                    // one-cell lattice as a separate bounded probe; Find
                    // still applies every footprint, spacing, reservation,
                    // and approach check.
                    if(!next && !options.dense && probes < limit) {
                        ++probes;
                        next = MapGen.Layout.BuildingSites.Find(c, g, plan.entries, specs[i], plan.policy,
                            {skip: rank, dense: true, diverse: diverse});
                    }
                    if(!next) break;
                    reserve(next, i);
                    deepest = Math.max(deepest, plan.entries.length);
                    if(search(i + 1, diverse)) return true;
                    plan.entries.length = i;
                    restore(state);
                }
                return false;
            }
            plan.ok = search(0, false);
            if(!plan.ok) {
                // Preserve the established search first, then spend at most
                // 32 more probes on geographically distinct alternatives.
                limit = probes + 32;
                restore(initial);
                plan.entries = [];
                plan.ok = search(0, true);
            }
            plan.search = {probes: probes, limit: limit, repaired: plan.ok};
            if(!plan.ok) {
                restore(initial);
                plan.entries = [];
                plan.reason = "building_site_missing:" + deepest + "/" + specs.length;
            }
        }
        if(plan.ok) {
            var report = MapGen.Validate.CreateReport();
            MapGen.Layout.ValidatePlannedStructures(c, report);
            if(!report.ok) {
                // A complete plan can still miss the required spread. Try
                // replacing one site, keeping the other buildings and access
                // routes fixed, before discarding the whole layout.
                var originals = plan.entries.slice(0), repaired = false, candidates = 0, missingRows = null;
                var missingRegion = MapGen.Repair.HasKey(report.reasons, "live_structure_regions_too_low");
                if(MapGen.Repair.HasKey(report.reasons, "live_structure_rows_too_low")) {
                    missingRows = {0: true, 1: true, 2: true};
                    for(var rowIndex = 0; rowIndex < originals.length; ++rowIndex) {
                        var rowRect = originals[rowIndex].candidate.rect;
                        delete missingRows[Math.min(2, Math.floor((rowRect.minY + rowRect.maxY) * 1.5 / c.Height))];
                    }
                }
                function rebuild(excluded) {
                    restore(initial);
                    plan.entries = [];
                    for(var j = 0; j < originals.length; ++j)
                        if(j !== excluded) reserve(originals[j].candidate, j);
                }
                for(var replacement = originals.length - 1; replacement >= 0; --replacement) {
                    rebuild(replacement);
                    var next = MapGen.Layout.BuildingSites.Find(c, g, plan.entries, specs[replacement], plan.policy, {
                        candidateLimit: 128,
                        dense: !!missingRows || missingRegion,
                        requiredRows: missingRows,
                        unusedRegion: missingRegion,
                        accept: function(site) {
                            ++candidates;
                            plan.entries.push({spec: specs[replacement], candidate: site});
                            var probe = MapGen.Validate.CreateReport();
                            MapGen.Layout.ValidatePlannedStructures(c, probe);
                            plan.entries.pop();
                            return probe.ok;
                        }
                    });
                    if(!next) continue;
                    reserve(next, replacement);
                    plan.entries.splice(replacement, 0, plan.entries.pop());
                    repaired = true;
                    break;
                }
                plan.distributionRepair = {candidates: candidates, replacement: replacement, repaired: repaired};
                if(!repaired) {
                    rebuild(-1);
                    plan.ok = false;
                    plan.reason = report.reasons[0];
                }
            }
        }
        if(!plan.ok) {
            // An oversized coast can hide needed sites or an entire building
            // row. Settle the existing water budget and replan once, after
            // removing every tentative building reservation. Successful plans
            // keep their established terrain order.
            restore(initial);
            if(!waterBudgeted && MapGen.Repair.TrimWaterCoverage(c)) {
                MapGen.Features.Bridges.PruneShortChannels(c);
                MapGen.Terrain.RefreshDerivedLayers(c);
                c.GameplayPlan = null;
                var budgetPlan = P.Build(c, true);
                budgetPlan.waterBudgetRepair = true;
                return budgetPlan;
            }
            return plan;
        }
        R.Apply(c);
        R.AuthorIntent(c);
        MapGen.Layout.TerrainSpace.Build(c);
        return plan;
    };
    P.FinishTerrain = function(c) {
        var entries = c.GameplayPlan ? c.GameplayPlan.entries : [];
        for(var i = 0; i < entries.length; ++i) {
            MapGen.Integration.PaintStructureClearance(c, entries[i].spec, entries[i].candidate);
            MapGen.Integration.ApplyStructureContextCover(c, entries[i].spec, entries[i].candidate);
        }
        MapGen.Layout.Reservations.Apply(c);
        MapGen.Layout.TerrainSpace.Apply(c);
        // Everything above is consumed by the first render, so no live flush is needed.
        c.StructureTerrainDirty = false;
    };
})(MapGen.Layout.GameplayPlan = MapGen.Layout.GameplayPlan || {});
