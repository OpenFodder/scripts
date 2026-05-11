// MapGen v3 Intent — render drift report (Phase 2 P2.6).
//
// Per OpenFodder_Map_Generator_Rewrite_Design_v3.4.md §7 "Renderer bridge
// and drift": every Concept declares a driftBudget; the rendered map is
// compared cell-by-cell against the IntentMap and divergence is reported.
// If divergence exceeds budget, the v1 calibration wall reappears in v3
// guise — surfacing it loudly is the lesson from
// [[mapgen_validator_calibration_wall]].
//
// This file produces a NUMERIC report; the consumer policy (kill seed vs
// warn vs proceed) is encoded in the Concept's driftBudget structure and
// decided by the Pipeline.RunCampaignAttempt step. Phase 2 reports drift
// for evidence collection but does not yet hard-reject on it; that gate
// activates in Phase 3 when concept-specific budgets are calibrated.
//
// Drift dimensions reported:
//   - terrain class drift: cells where IntentMap.terrain says LAND but
//     RenderedMap.Tiles classified as water/forest/etc., and vice versa.
//   - route corridor drift: ROUTE_PRIMARY cells that ended up rendered as
//     something the engine treats as solid.
//   - claim violation drift: SPAWN_SAFE / OBJECTIVE cells that the
//     Composite + Render pass painted as solid.

var MapGen = MapGen || {};
MapGen.Intent = MapGen.Intent || {};

(function(pIntent) {

    pIntent.Drift = pIntent.Drift || {};

    pIntent.Drift.Report = function(pContext, pIntentMap, pRenderedMap) {
        if(!pIntentMap || !pRenderedMap || !pRenderedMap.Tiles) {
            return { ok: false, reason: "drift:no_inputs" };
        }

        var T = pIntent.Terrain;
        var M = pIntent.Movement;
        var C = pIntent.Claim;
        var W = pIntentMap.width;
        var H = pIntentMap.height;
        var layers = pContext.Layers || {};

        var counters = {
            // Terrain plane counters
            intent_LAND:      0, intent_WATER:    0, intent_FOREST:    0,
            intent_CLIFF:     0, intent_OUTCROP:  0,
            // Composite-derived "rendered solid" — proxy for engine collision
            rendered_solid:   0,
            // Mismatches
            land_intent_solid_render:   0,   // intent says LAND, renderer painted solid
            water_intent_clear_render:  0,   // intent says WATER, renderer painted clear
            route_solid:                0,   // ROUTE_PRIMARY cell painted solid
            spawn_safe_solid:           0,   // SPAWN_SAFE claim cell painted solid
            objective_solid:            0,   // OBJECTIVE claim cell painted solid
            cliff_render_clear:         0    // CLIFF intent but renderer painted clear
        };

        function isSolid(x, y) {
            return MapGen.Layers.Get(layers.water, x, y, 0) ||
                MapGen.Layers.Get(layers.blocked, x, y, 0);
        }

        for(var y = 0; y < H; ++y) {
            var row = y * W;
            for(var x = 0; x < W; ++x) {
                var i = row + x;
                var t = pIntentMap.terrain[i];
                var move = pIntentMap.movement[i];
                var claim = pIntentMap.claim[i];

                if(t === T.LAND)    { counters.intent_LAND++;    }
                if(t === T.WATER)   { counters.intent_WATER++;   }
                if(t === T.FOREST)  { counters.intent_FOREST++;  }
                if(t === T.CLIFF_BODY || t === T.CLIFF_TOP) { counters.intent_CLIFF++; }
                if(t === T.OUTCROP) { counters.intent_OUTCROP++; }

                var solid = isSolid(x, y);
                if(solid) { counters.rendered_solid++; }

                var intentSolid = (t === T.WATER || t === T.RIVER ||
                    t === T.CLIFF_BODY || t === T.CLIFF_TOP ||
                    t === T.FOREST || t === T.OUTCROP) ||
                    !!(move & M.BLOCKED);

                if(!intentSolid && solid) {
                    counters.land_intent_solid_render++;
                }
                if(t === T.WATER && !solid) {
                    counters.water_intent_clear_render++;
                }
                if((move & M.ROUTE_PRIMARY) && solid) {
                    counters.route_solid++;
                }
                if((claim & C.SPAWN_SAFE) && solid) {
                    counters.spawn_safe_solid++;
                }
                if((claim & C.OBJECTIVE) && solid) {
                    counters.objective_solid++;
                }
                if((t === T.CLIFF_BODY || t === T.CLIFF_TOP) && !solid) {
                    counters.cliff_render_clear++;
                }
            }
        }

        var total = W * H;
        var routeFraction = total > 0 ? (counters.route_solid / total) : 0;
        var spawnFraction = total > 0 ? (counters.spawn_safe_solid / total) : 0;
        var landDriftFraction = total > 0 ?
            (counters.land_intent_solid_render / total) : 0;

        return {
            ok: true,
            counters: counters,
            fractions: {
                routeSolid:       routeFraction,
                spawnSafeSolid:   spawnFraction,
                landIntentSolid:  landDriftFraction
            },
            // Phase 2 advisory thresholds. Concept-specific calibration in P3.
            warnings: buildWarnings(counters, routeFraction, spawnFraction)
        };
    };

    // -----------------------------------------------------------------------
    // PostCommitReport — Phase 3 P3.2 authoritative drift report.
    //
    // Runs AFTER Render.CreateMap has committed RenderedMap.Tiles to the
    // engine Map. Queries Map.TileTerrainFeature(x, y) — the same engine
    // collision oracle that decides sprite walkability — instead of the
    // mutable pContext.Layers that the pre-commit Drift.Report has to
    // read. This is the definitive drift verdict per v3.4 §7.
    //
    // Phase 3 acceptance per v3.4 §11 line 1069 ("rendered hard validation
    // pass rate meets threshold") consumes PostCommitReport, not the
    // pre-commit Drift.Report.

    pIntent.Drift.PostCommitReport = function(pContext, pIntentMap) {
        if(typeof Map === "undefined" || !Map.TileTerrainFeature) {
            return null;
        }
        if(!pIntentMap) { return null; }

        var T = pIntent.Terrain;
        var M = pIntent.Movement;
        var C = pIntent.Claim;
        var W = pIntentMap.width;
        var H = pIntentMap.height;
        var Features = (typeof Terrain !== "undefined" && Terrain.Features) ?
            Terrain.Features : null;
        if(!Features) { return null; }

        function featureAt(x, y) {
            return Map.TileTerrainFeature(x, y);
        }

        function isSolidFeature(f) {
            if(f < 0) { return true; } // out of bounds
            return f === Features.SolidObstacle ||
                   f === Features.NoFlyObstacle ||
                   f === Features.DeepWater ||
                   f === Features.ShallowWater ||
                   f === Features.SoftHazard ||
                   f === Features.PitDrop;
        }

        var counters = {
            tiles_total: W * H,
            route_total: 0, spawn_safe_total: 0, objective_total: 0,
            land_intent_total: 0, forest_intent_total: 0, forest_pruned: 0,
            rendered_solid: 0,
            land_intent_solid_render: 0,
            water_intent_clear_render: 0,
            route_solid: 0,
            spawn_safe_solid: 0,
            objective_solid: 0,
            cliff_render_clear: 0
        };
        var samples = {
            route_solid: [],
            spawn_safe_solid: [],
            objective_solid: []
        };
        var landSolidFeatures = {};

        function sample(listName, x, y, feature) {
            var list = samples[listName];
            if(!list || list.length >= 16) { return; }
            var tile = null;
            if(typeof Map.TileGet === "function") {
                tile = Map.TileGet(x, y);
            }
            list.push({ x: x, y: y, feature: feature, tile: tile });
        }

        for(var y = 0; y < H; ++y) {
            var row = y * W;
            for(var x = 0; x < W; ++x) {
                var i = row + x;
                var t = pIntentMap.terrain[i];
                var move = pIntentMap.movement[i];
                var claim = pIntentMap.claim[i];

                var feature = featureAt(x, y);
                var solid = isSolidFeature(feature);
                if(solid) { counters.rendered_solid++; }

                var intentSolid = (t === T.WATER || t === T.RIVER ||
                    t === T.CLIFF_BODY || t === T.CLIFF_TOP ||
                    t === T.FOREST || t === T.OUTCROP) ||
                    !!(move & M.BLOCKED);

                if(!intentSolid) counters.land_intent_total++;
                if(move & M.ROUTE_PRIMARY) counters.route_total++;
                if(claim & C.SPAWN_SAFE) counters.spawn_safe_total++;
                if(claim & C.OBJECTIVE) counters.objective_total++;
                if(t === T.FOREST) {
                    counters.forest_intent_total++;
                    if(!MapGen.Metrics.IsTreeBlocked(pContext, x, y)) counters.forest_pruned++;
                }
                if(!intentSolid && solid) {
                    counters.land_intent_solid_render++;
                    landSolidFeatures[feature] = (landSolidFeatures[feature] || 0) + 1;
                }
                if(t === T.WATER && !solid) {
                    counters.water_intent_clear_render++;
                }
                if((move & M.ROUTE_PRIMARY) && solid) {
                    counters.route_solid++;
                    sample("route_solid", x, y, feature);
                }
                if((claim & C.SPAWN_SAFE) && solid) {
                    counters.spawn_safe_solid++;
                    sample("spawn_safe_solid", x, y, feature);
                }
                if((claim & C.OBJECTIVE) && solid) {
                    counters.objective_solid++;
                    sample("objective_solid", x, y, feature);
                }
                if((t === T.CLIFF_BODY || t === T.CLIFF_TOP) && !solid) {
                    counters.cliff_render_clear++;
                }
            }
        }

        return {
            ok: true,
            source: "engine_oracle",
            counters: counters,
            landSolidFeatures: landSolidFeatures,
            fractions: {
                renderedSolid: counters.rendered_solid / counters.tiles_total,
                landIntentSolid: counters.land_intent_solid_render / Math.max(1, counters.land_intent_total),
                routeSolid: counters.route_solid / Math.max(1, counters.route_total),
                spawnSafeSolid: counters.spawn_safe_solid / Math.max(1, counters.spawn_safe_total),
                forestPruneRatio: counters.forest_pruned / Math.max(1, counters.forest_intent_total)
            },
            samples: samples,
            warnings: buildWarnings(counters, 0, 0)
        };
    };

    pIntent.Drift.BudgetDefaults = {
        landIntentSolidMaxFraction: 0.20,
        routeSolidMaxFraction: 0.05,
        spawnSolidMaxFraction: 0.02,
        objectiveSolidMaxFraction: 0,
        forestPruneRatioMax: 1
    };

    pIntent.Drift.ValidateBudget = function(budget) {
        var reasons = [];
        for(var key in budget) {
            if(!Object.prototype.hasOwnProperty.call(budget, key)) continue;
            if(!Object.prototype.hasOwnProperty.call(this.BudgetDefaults, key) ||
                typeof budget[key] !== "number" || !isFinite(budget[key]) ||
                budget[key] < 0 || budget[key] > 1)
                reasons.push("invalid_drift_budget:" + key);
        }
        return reasons;
    };

    pIntent.Drift.ValidateCommitted = function(context) {
        var concept = pIntent.Registry[context.ConceptId];
        var budget = concept ? concept.driftBudget || {} : {};
        var reasons = this.ValidateBudget(budget);
        var report = this.PostCommitReport(context, context.IntentMap);
        context.RenderDriftCommitted = report;
        if(!report) reasons.push("drift_oracle_missing");
        if(report) {
            var counters = report.counters;
            var values = {
                landIntentSolidMaxFraction: report.fractions.landIntentSolid,
                routeSolidMaxFraction: report.fractions.routeSolid,
                spawnSolidMaxFraction: report.fractions.spawnSafeSolid,
                objectiveSolidMaxFraction: counters.objective_solid / Math.max(1, counters.objective_total),
                forestPruneRatioMax: report.fractions.forestPruneRatio
            };
            for(var key in values) {
                var limit = budget[key] !== undefined ? budget[key] : this.BudgetDefaults[key];
                if(values[key] > limit)
                    reasons.push("drift_budget:" + key + ":" + values[key].toFixed(4) + ">" + limit);
            }
        }
        context.RenderDriftViolations = reasons;
        context.DriftValidation = { ok: reasons.length === 0, reasons: reasons, budget: budget,
            source: "final_engine_map", fractions: report ? report.fractions : null,
            counters: report ? report.counters : null, samples: report ? report.samples : null,
            landSolidFeatures: report ? report.landSolidFeatures : null };
        return context.DriftValidation;
    };

    function buildWarnings(c, routeFraction, spawnFraction) {
        var warnings = [];
        // ROUTE cells should never be solid post-render. Even one is a bug.
        if(c.route_solid > 0) {
            warnings.push("route_solid:" + c.route_solid);
        }
        // SPAWN_SAFE cells should never be solid post-render.
        if(c.spawn_safe_solid > 0) {
            warnings.push("spawn_safe_solid:" + c.spawn_safe_solid);
        }
        // OBJECTIVE cells should never be solid post-render.
        if(c.objective_solid > 0) {
            warnings.push("objective_solid:" + c.objective_solid);
        }
        // LAND intent painted solid is a render-overlay leak (Composite slot
        // not stamped, Render's perimeterCover added a tree, etc). The 5%
        // ceiling is the v3.4 §8.5 row 7 tolerance band's lower bound.
        if(c.intent_LAND > 0 && (c.land_intent_solid_render / c.intent_LAND) > 0.05) {
            warnings.push("land_intent_solid_render:" +
                c.land_intent_solid_render + "/" + c.intent_LAND);
        }
        return warnings;
    }

})(MapGen.Intent);
