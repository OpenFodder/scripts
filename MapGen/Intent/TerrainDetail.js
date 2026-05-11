var MapGen = MapGen || {};
MapGen.Intent = MapGen.Intent || {};
MapGen.Intent.Pipeline = MapGen.Intent.Pipeline || {};

(function(pIntent) {
    pIntent.Pipeline.BuildTerrainDetail = function(pContext, intentMap) {
        // Materialize authored forest or grow renderable patches, then add
        // tactical cover. Reservations and the cover budget remain authoritative
        // before the atlas renderer shapes the final canopy.
        if(MapGen.Terrain && MapGen.Terrain.Cover && MapGen.Terrain.Cover.Build) {
            try {
                MapGen.Context.Time(pContext, "Intent.CoverBuild",
                                    function() { MapGen.Terrain.Cover.Build(pContext); });
                MapGen.Context.AddLog(pContext, "v3 ran Cover.Build");

                // v1 runs route-exposure shaping in its later
                // PostPlacementCover stage. The v3 ice path does not use that
                // stage, so RouteExposureBreakup profile settings previously
                // had no effect here. Run the focused route pass now, after
                // Paths/Clearings exist and before the cover ceiling is
                // enforced. It only stamps beside genuinely exposed path runs.
                if(MapGen.Terrain.Cover.ApplyRouteExposureBreakup &&
                   pContext.Profile.RouteExposureBreakup !== false) {
                    var exposureDensity = MapGen.Terrain.Cover.TacticalCoverDensity
                                              ? MapGen.Terrain.Cover.TacticalCoverDensity(pContext)
                                              : 1.0;
                    pContext.IntentRouteExposureBreakup =
                        MapGen.Terrain.Cover.ApplyRouteExposureBreakup(pContext, exposureDensity);
                }
                // Authored v3 concepts can opt into a few substantial
                // off-route barriers without enabling the generic global
                // open-area breakup pipeline. An explicit density of 1 keeps
                // MaxOpenFieldScreens an actual cap instead of scaling it by
                // the concept's low tactical-cover density.
                if(pContext.Profile.V3OpenFieldScreens === true && MapGen.Terrain.Cover.ApplyOpenFieldScreens) {
                    pContext.IntentOpenFieldScreens = MapGen.Terrain.Cover.ApplyOpenFieldScreens(pContext, 1.0);
                }

                if(MapGen.Terrain.Cover.ApplyRouteViewportCover) {
                    var viewportPasses = [];
                    var viewportClusters = 0;
                    var viewportStamped = 0;
                    var viewportBefore = null;
                    var viewportAfter = null;
                    // One reinforcement pass is enough for a blob that lands
                    // partly in protected terrain or is weakened by ice-tree
                    // shaping. Bound this at two so it cannot become a global
                    // density loop.
                    for(var viewportPass = 0; viewportPass < 2; ++viewportPass) {
                        var viewportResult = MapGen.Terrain.Cover.ApplyRouteViewportCover(pContext);
                        viewportPasses.push(viewportResult);
                        if(viewportBefore === null)
                            viewportBefore = viewportResult.before;
                        viewportAfter = viewportResult.after;
                        viewportClusters += viewportResult.clusters || 0;
                        viewportStamped += viewportResult.stamped || 0;
                        if(!viewportResult.after || !viewportResult.stamped)
                            break;
                    }
                    pContext.IntentRouteViewportCover = {
                        before : viewportBefore || 0,
                        after : viewportAfter || 0,
                        clusters : viewportClusters,
                        stamped : viewportStamped,
                        passes : viewportPasses
                    };
                }

                MapGen.Layout.TerrainSpace.FitCover(pContext);

                // v1 normally reaches Repair.ThinTreesToTarget through its
                // validation/repair loop. The v3 path renders immediately
                // after Cover.Build, so reconnect that profile-owned ceiling
                // here. Without it, correctly translated TREE ownership can
                // materialize 40%+ cover even for a style capped at 34%.
                if(MapGen.Repair && MapGen.Repair.ThinTreesToTarget && MapGen.Metrics &&
                   MapGen.Metrics.TreeBlockedCount) {
                    var coverBeforeBudget = MapGen.Metrics.TreeBlockedCount(pContext);
                    MapGen.Repair.ThinTreesToTarget(pContext, coverBeforeBudget);
                    var coverAfterBudget = MapGen.Metrics.TreeBlockedCount(pContext);
                    pContext.IntentCoverBudget = {
                        before : coverBeforeBudget,
                        after : coverAfterBudget,
                        maxCoverage : pContext.Profile.MaxTreeCoverage
                    };
                }
            } catch(eCov) {
                pContext.IntentCoverBuildError = "" + eCov;
                MapGen.Context.AddLog(pContext, "v1 cover Build threw: " + eCov);
            }
        }
        if(pIntent.Composite && pIntent.Composite.OverlayAuthoredTerrain) {
            try {
                var overlayCells = MapGen.Context.Time(pContext, "Intent.OverlayAuthoredTerrain", function() {
                    return pIntent.Composite.OverlayAuthoredTerrain(pContext, intentMap, pContext.Layers);
                });
                MapGen.Context.AddLog(pContext, "v3 re-applied authored hard terrain after Cover.Build (" +
                                                    overlayCells + " cells)");
            } catch(eOverlay) {
                MapGen.Context.AddLog(pContext, "v3 authored terrain overlay threw: " + eOverlay);
            }
        }

        MapGen.Layout.GameplayPlan.FinishTerrain(pContext);
    };

    // Ice smoothing can expand a legal semantic tree mask into a denser final
    // canopy and writes that result back into Layers.blocked. Enforce the
    // profile ceiling at that materialized boundary, then rerender from the
    // thinned semantic mask. This is deterministic and only removes cells
    // classified as tree by Metrics.IsTreeBlocked (never cliffs/outcrops).
    pIntent.Pipeline.RepairRenderedTreeCeiling = function(pContext) {
        if(!pContext || !pContext.Profile || !pContext.RenderedMap || !MapGen.Repair ||
           !MapGen.Repair.ThinTreesToTarget || !MapGen.Metrics || !MapGen.Metrics.TreeBlockedCount)
            return;
        var profile = pContext.Profile;
        var maxCoverage = Number(profile.MaxRenderedTreeTileCoverage);
        if(isNaN(maxCoverage)) {
            maxCoverage = Number(profile.MaxTreeCoverage);
            if(isNaN(maxCoverage)) {
                return;
            }
            maxCoverage += 0.03;
        }
        var area = Math.max(1, pContext.Width * pContext.Height);
        var maxTiles = Math.floor(maxCoverage * area);
        var originalMax = profile.MaxTreeCoverage;
        var repair = {
            maxTiles : maxTiles,
            before : Number((pContext.RenderedMap.Counts || {}).tree || 0),
            after : 0,
            passes : 0,
            semanticTargets : []
        };
        for(var pass = 0; pass < 5; ++pass) {
            var renderedTrees = Number((pContext.RenderedMap.Counts || {}).tree || 0);
            if(renderedTrees <= maxTiles) {
                break;
            }
            var semanticTrees = MapGen.Metrics.TreeBlockedCount(pContext);
            var ratio = maxTiles / Math.max(1, renderedTrees);
            // Atlas smoothing can preserve a small protected canopy fringe even
            // after the semantic mask reaches the same target repeatedly. Make
            // each retry progressively more conservative so a repair cannot
            // stall a handful of rendered tiles above the hard contract.
            var safety = Math.max(0.82, 0.96 - (pass * 0.035));
            var targetTiles = Math.max(0, Math.floor(semanticTrees * ratio * safety));
            if(repair.semanticTargets.length &&
               targetTiles >= repair.semanticTargets[repair.semanticTargets.length - 1]) {
                targetTiles = Math.max(0, repair.semanticTargets[repair.semanticTargets.length - 1] -
                                              Math.max(4, Math.ceil((renderedTrees - maxTiles) * 1.5)));
            }
            repair.semanticTargets.push(targetTiles);
            profile.MaxTreeCoverage = targetTiles / area;
            MapGen.Repair.ThinTreesToTarget(pContext);
            MapGen.Render.BuildTileLayer(pContext);
            repair.passes += 1;
        }
        profile.MaxTreeCoverage = originalMax;
        repair.after = Number((pContext.RenderedMap.Counts || {}).tree || 0);
        if(repair.passes > 0) {
            pContext.IntentRenderedTreeCeilingRepair = repair;
            MapGen.Context.AddLog(pContext, "v3 repaired rendered tree ceiling: " + repair.before + " -> " +
                                                repair.after + "/" + maxTiles + " passes=" + repair.passes);
        }
    };
})(MapGen.Intent);
