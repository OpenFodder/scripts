var MapGen = MapGen || {};

MapGen.Validate = {

    PathStats: function(pContext) {
        if(!pContext || !pContext.ProfileTimings)
            return null;

        if(!pContext.ValidationPathStats) {
            pContext.ValidationPathStats = {
                shortestCalls: 0,
                shortestSuccess: 0,
                shortestFailure: 0,
                shortestMs: 0,
                shortestExpanded: 0,
                shortestPushed: 0,
                shortestMaxQueue: 0,
                shortestPathCells: 0,
                canReachCalls: 0,
                canReachSuccess: 0,
                canReachFailure: 0,
                canReachMs: 0,
                canReachExpanded: 0,
                canReachPushed: 0,
                canReachMaxQueue: 0,
                nativeShortestCalls: 0,
                nativeCanReachCalls: 0,
                nativeFailures: 0
            };
        }

        return pContext.ValidationPathStats;
    },

    RecordShortestStats: function(pContext, pSucceeded, pPathCells, pExpanded, pPushed, pMaxQueue, pStartMs) {
        var stats = this.PathStats(pContext);
        if(!stats)
            return;

        ++stats.shortestCalls;
        stats.shortestMs += (new Date()).getTime() - pStartMs;
        stats.shortestExpanded += pExpanded || 0;
        stats.shortestPushed += pPushed || 0;
        stats.shortestPathCells += pPathCells || 0;
        if((pMaxQueue || 0) > stats.shortestMaxQueue)
            stats.shortestMaxQueue = pMaxQueue || 0;

        if(pSucceeded)
            ++stats.shortestSuccess;
        else
            ++stats.shortestFailure;
    },

    RecordCanReachStats: function(pContext, pSucceeded, pExpanded, pPushed, pMaxQueue, pStartMs) {
        var stats = this.PathStats(pContext);
        if(!stats)
            return;

        ++stats.canReachCalls;
        stats.canReachMs += (new Date()).getTime() - pStartMs;
        stats.canReachExpanded += pExpanded || 0;
        stats.canReachPushed += pPushed || 0;
        if((pMaxQueue || 0) > stats.canReachMaxQueue)
            stats.canReachMaxQueue = pMaxQueue || 0;

        if(pSucceeded)
            ++stats.canReachSuccess;
        else
            ++stats.canReachFailure;
    },

    NativeMap: function(pContext) {
        if(!pContext || pContext.NativeValidationDisabled)
            return null;
        var map = pContext.Map || (typeof Map !== "undefined" ? Map : null);
        if(!map)
            return null;
        return map;
    },

    NativeWalkabilityAvailable: function(pContext) {
        var map = this.NativeMap(pContext);
        return !!(map &&
            map.SetMapGenWalkabilityGrid &&
            map.MapGenShortestPath &&
            map.MapGenCanReach);
    },

    NativeWalkableAt: function(pContext, pMode, pX, pY) {
        if(pMode === "dry")
            return this.IsDryWalkable(pContext, pX, pY);
        if(pMode === "finalRoute")
            return this.FinalRouteCharWalkable(pContext, pX, pY);
        return MapGen.Metrics.IsWalkable(pContext, pX, pY);
    },

    InstallNativeWalkability: function(pContext, pMode) {
        if(!this.NativeWalkabilityAvailable(pContext))
            return false;

        var mode = pMode || "default";
        if(pContext._nativeWalkability &&
            pContext._nativeWalkability.mode === mode &&
            pContext._nativeWalkability.width === pContext.Width &&
            pContext._nativeWalkability.height === pContext.Height)
            return true;

        var map = this.NativeMap(pContext);
        var mask = [];
        var width = pContext.Width;
        var height = pContext.Height;

        for(var y = 0; y < height; ++y) {
            for(var x = 0; x < width; ++x)
                mask.push(this.NativeWalkableAt(pContext, mode, x, y) ? "1" : "0");
        }

        try {
            map.SetMapGenWalkabilityGrid(width, height, mask.join(""));
            pContext._nativeWalkability = {
                mode: mode,
                width: width,
                height: height
            };
            return true;
        } catch(e) {
            pContext.NativeValidationDisabled = true;
            MapGen.Context.AddLog(pContext, "Native validation pathing disabled: " + e);
            return false;
        }
    },

    NativeBlockedIndices: function(pContext, pBlocked) {
        var result = [];
        if(!pBlocked)
            return result;

        for(var key in pBlocked) {
            if(!pBlocked.hasOwnProperty(key) || !pBlocked[key])
                continue;

            var comma = key.indexOf(",");
            if(comma < 0)
                continue;
            var x = Number(key.substring(0, comma));
            var y = Number(key.substring(comma + 1));
            if(isNaN(x) || isNaN(y))
                continue;
            x = Math.floor(x);
            y = Math.floor(y);
            if(x < 0 || y < 0 || x >= pContext.Width || y >= pContext.Height)
                continue;
            result.push((y * pContext.Width) + x);
        }

        return result;
    },

    PathFromNativeResult: function(pResult) {
        var pathLength = pResult && pResult.length >= 5 ? Number(pResult[4]) || 0 : 0;
        var path = [];

        if(!pResult || !pResult.length || !pResult[0] || pathLength <= 0)
            return null;

        for(var index = 0; index < pathLength; ++index) {
            var base = 5 + (index * 2);
            path.push({ x: pResult[base], y: pResult[base + 1] });
        }

        return path;
    },

    TryNativeShortestPath: function(pContext, pStart, pEnd, pBlocked, pMode) {
        if(!pContext || !pStart || !pEnd)
            return { handled: false, path: null };
        if(!this.InstallNativeWalkability(pContext, pMode || "default"))
            return { handled: false, path: null };

        var map = this.NativeMap(pContext);
        var stats = this.PathStats(pContext);
        var statsStart = stats ? (new Date()).getTime() : 0;
        var result = null;

        try {
            result = map.MapGenShortestPath(
                pStart.x,
                pStart.y,
                pEnd.x,
                pEnd.y,
                this.NativeBlockedIndices(pContext, pBlocked)
            );
        } catch(e) {
            pContext.NativeValidationDisabled = true;
            if(stats)
                ++stats.nativeFailures;
            MapGen.Context.AddLog(pContext, "Native shortest path disabled: " + e);
            return { handled: false, path: null };
        }

        if(!result || result.length < 5)
            return { handled: false, path: null };

        if(stats) {
            ++stats.nativeShortestCalls;
            this.RecordShortestStats(
                pContext,
                !!result[0],
                Number(result[4]) || 0,
                Number(result[1]) || 0,
                Number(result[2]) || 0,
                Number(result[3]) || 0,
                statsStart
            );
        }

        return { handled: true, path: this.PathFromNativeResult(result) };
    },

    TryNativeCanReach: function(pContext, pStart, pEnd) {
        if(!pContext || !pStart || !pEnd)
            return { handled: false, reached: false };
        if(!this.InstallNativeWalkability(pContext, "default"))
            return { handled: false, reached: false };

        var map = this.NativeMap(pContext);
        var stats = this.PathStats(pContext);
        var statsStart = stats ? (new Date()).getTime() : 0;
        var result = null;

        try {
            result = map.MapGenCanReach(pStart.x, pStart.y, pEnd.x, pEnd.y);
        } catch(e) {
            pContext.NativeValidationDisabled = true;
            if(stats)
                ++stats.nativeFailures;
            MapGen.Context.AddLog(pContext, "Native reachability disabled: " + e);
            return { handled: false, reached: false };
        }

        if(!result || result.length < 5)
            return { handled: false, reached: false };

        if(stats) {
            ++stats.nativeCanReachCalls;
            this.RecordCanReachStats(
                pContext,
                !!result[0],
                Number(result[1]) || 0,
                Number(result[2]) || 0,
                Number(result[3]) || 0,
                statsStart
            );
        }

        return { handled: true, reached: !!result[0] };
    },

    CreateReport: function() {
        return {
            ok: true,
            fatal: false,
            seed: null,
            profile: "",
            attempt: 0,
            reasons: [],
            warnings: [],
            metrics: null,
            tactical: null,
            repairActions: [],
            log: [],
            debug: null
        };
    },

    Fail: function(pReport, pReason, pFatal) {
        pReport.ok = false;
        pReport.reasons.push(pReason);
        if(pFatal)
            pReport.fatal = true;
    },

    Warn: function(pReport, pReason) {
        pReport.warnings.push(pReason);
    },

    Run: function(pContext, pRules) {
        var rules = pRules || {};
        var self = this;
        var timed = function(pLabel, pFn) {
            return MapGen.Context.Time(pContext, "Validate." + pLabel, pFn);
        };
        var report = this.CreateReport();
        var profile = pContext.Profile;
        pContext._nativeWalkability = null;
        var metrics = timed("Metrics", function() {
            return MapGen.Metrics.Compute(pContext);
        });

        report.seed = pContext.Seed;
        report.profile = profile.Name;
        report.attempt = pContext.Attempt;
        report.metrics = metrics;

        timed("CoverageTargets", function() {
            self.ProfileValid(pContext, report);

            if(pContext.Width <= 0 || pContext.Height <= 0)
                self.Fail(report, "invalid_map_size", true);

            var maxWaterCoverage = profile.MaxWaterCoverage;
            if(MapGen.Terrain && MapGen.Terrain.TileCatalog && MapGen.Terrain.TileCatalog.MaxWaterCoverage)
                maxWaterCoverage = MapGen.Terrain.TileCatalog.MaxWaterCoverage(profile.TerrainType, profile.MaxWaterCoverage);

            if(maxWaterCoverage !== undefined && metrics.Coverage.water > maxWaterCoverage)
                self.Fail(report, "water_coverage_too_high", false);

            self.CoverageTargets(pContext, report);
            self.RenderedTreeTargets(pContext, report);
            self.LandShapeTargets(pContext, report);
            self.WaterCompositionTargets(pContext, report);
            self.ProfileSemanticTargets(pContext, report);

            if(rules.RequireReservedWalkable && metrics.Counts.keepClear <= 0)
                self.Fail(report, "no_keep_clear_space", true);

            if(metrics.Coverage.largestWalkableComponent < (rules.MinimumLargestWalkableComponent || 0.25))
                self.Warn(report, "largest_walkable_component_low");

            // T3.17 — fragmentation soft-fail. Trips when the largest walkable
            // component is under MinMainMassFraction of total walkable area, even
            // if the rest of the map satisfies hard rules. Repair.EnforceLandCohesion
            // handles the fix.
            var minMainMass = (profile.MinMainMassFraction !== undefined) ? profile.MinMainMassFraction : 0.55;
            if(metrics.Counts.walkableComponents > 1 && metrics.Counts.totalWalkable > 0) {
                if((metrics.LargestWalkableComponent / metrics.Counts.totalWalkable) < minMainMass)
                    self.Fail(report, "land_too_fragmented", false);
            }

            if(MapGen.Terrain.Water.HasCrossableRiver(pContext) && !pContext.Crossings.length)
                self.Fail(report, "river_without_crossing", true);
        });

        timed("Hazards", function() {
            self.RiversControlled(pContext, report);
            self.SoftHazardsControlled(pContext, report);
            self.BridgesSupportedByWater(pContext, report);
        });

        timed("Placements", function() {
            if(profile.RequireConnectedCriticalPath && !self.CriticalPointsConnected(pContext))
                self.Fail(report, "critical_points_disconnected", true);

            self.PlacementsWalkable(pContext, report);
            self.PlacementsHaveApproach(pContext, report);
        });
        if(rules.RequireConnectivityNodes)
            timed("ConnectivityNodes", function() { self.AllConnectivityNodesReachable(pContext, report, rules); });
        if(rules.RequireCampaignRouteSites) {
            timed("CampaignRouteSites", function() {
                self.CampaignRouteSites(pContext, report, rules);
                self.CampaignRouteFlow(pContext, report, rules);
            });
        }
        if(rules.RequireTacticalFlow)
            timed("TacticalFlow", function() { self.TacticalFlow(pContext, report, rules); });
        timed("TerrainConnectivity", function() {
            self.PlateauContiguous(pContext, report);
            self.CliffsTraversable(pContext, report);
        });
        timed("Structures", function() {
            self.StructuresAvoidCliffs(pContext, report);
            self.StructuresSeparated(pContext, report);
            self.StructuresAvoidWater(pContext, report);
            self.StructuresHaveContext(pContext, report);
        });
        timed("ScreenPacing", function() { self.ScreenPacing(pContext, report, rules); });
        timed("GameplayUtilization", function() {
            self.GameplayUtilization(pContext, report);
        });
        if(rules.RequireMultiplayerFairness)
            timed("MultiplayerFairness", function() { self.MultiplayerFairness(pContext, report, rules); });

        report.log = pContext.Log.slice(0);
        timed("DebugDump", function() {
            report.repairActions = self.RepairActions(pContext);
            report.debug = self.DebugDump(pContext, report);
        });

        pContext.Validation = report;
        return report;
    },

    ProfileValid: function(pContext, pReport) {
        var validation = pContext.Profile.Validation;

        if(!validation)
            return;

        for(var warningIndex = 0; warningIndex < validation.warnings.length; ++warningIndex)
            this.Warn(pReport, "profile_warning:" + validation.warnings[warningIndex].key);

        for(var errorIndex = 0; errorIndex < validation.errors.length; ++errorIndex)
            this.Fail(pReport, "profile_error:" + validation.errors[errorIndex].key, true);
    },

    CoverageTargets: function(pContext, pReport) {
        var profile = pContext.Profile;
        var metrics = pReport.metrics;
        var treeTarget = profile.TreeCoverage || 0;
        var minTree = profile.MinTreeCoverage !== undefined ? profile.MinTreeCoverage : treeTarget * 0.60;
        var maxTree = profile.MaxTreeCoverage !== undefined ? profile.MaxTreeCoverage : Math.min(0.90, treeTarget * 1.35);
        var pathTarget = profile.PathCoverage || 0;
        var minPath = profile.MinPathCoverage !== undefined ? profile.MinPathCoverage : pathTarget * 0.65;
        var maxPath = profile.MaxPathCoverage !== undefined ? profile.MaxPathCoverage : Math.min(0.55, Math.max(pathTarget * 2.0, pathTarget + 0.10));

        var treeCoverage = metrics.Coverage.treeBlocked !== undefined ? metrics.Coverage.treeBlocked : metrics.Coverage.blocked;

        if(treeCoverage < minTree)
            this.Fail(pReport, "tree_coverage_too_low", false);
        if(treeCoverage > maxTree)
            this.Fail(pReport, "tree_coverage_too_high", false);
        if(metrics.Coverage.keepClear < minPath)
            this.Fail(pReport, "path_coverage_too_low", false);
        if(metrics.Coverage.routeWalkable > maxPath)
            this.Warn(pReport, "route_coverage_too_high");
    },

    RenderedTreeTargets: function(pContext, pReport) {
        var profile = pContext.Profile || {};
        var rendered = pContext.RenderedMap || null;
        var smoothing = rendered ? rendered.Smoothing || {} : {};
        var minTiles = profile.MinRenderedTreeTiles;
        var minCoverage = profile.MinRenderedTreeTileCoverage;
        var treeTiles = Number(smoothing.treeTiles || 0);
        var area = Math.max(1, pContext.Width * pContext.Height);

        if(minCoverage !== undefined && minCoverage !== null && !isNaN(Number(minCoverage)))
            minTiles = Math.max(Number(minTiles || 0), Math.round(Number(minCoverage) * area));

        if(minTiles === undefined || minTiles === null || isNaN(Number(minTiles)))
            return;

        minTiles = Math.max(0, Math.floor(Number(minTiles)));
        if(minTiles > 0 && treeTiles < minTiles)
            this.Fail(pReport, "rendered_tree_tiles_too_low:" + treeTiles + "/" + minTiles, false);
    },

    // Named composition profiles are promises about the visible map, not just
    // requests made to an authoring pass. Validate the resulting semantic
    // layers so a planned river that was mostly erased by route protection is
    // retried instead of being saved as a "river-crossing" map with no river.
    ProfileSemanticTargets: function(pContext, pReport) {
        var profile = pContext.Profile || {};
        var name = String(profile.Name || "");

        if(name !== "grammar_jungle_river_crossing")
            return;

        var W = pContext.Width;
        var H = pContext.Height;
        var layers = pContext.Layers || {};
        var seen = {};
        var bestCells = 0;
        var bestSpanX = 0;

        function belongs(x, y) {
            if(MapGen.Layers.Get(layers.water, x, y, 0))
                return true;
            // A bridge/ford deliberately replaces the water cell at the route.
            // Treat it as part of the same hydrological component for this
            // continuity check, while still requiring substantial real water.
            return !!MapGen.Layers.Get(layers.crossing, x, y, 0);
        }

        for(var y = 0; y < H; ++y) {
            for(var x = 0; x < W; ++x) {
                var startKey = x + "," + y;
                if(seen[startKey] || !belongs(x, y))
                    continue;

                var queue = [x, y];
                var head = 0;
                var cells = 0;
                var minX = x;
                var maxX = x;
                seen[startKey] = true;

                while(head < queue.length) {
                    var px = queue[head++];
                    var py = queue[head++];
                    ++cells;
                    if(px < minX) minX = px;
                    if(px > maxX) maxX = px;

                    for(var dy = -1; dy <= 1; ++dy) {
                        for(var dx = -1; dx <= 1; ++dx) {
                            if(dx === 0 && dy === 0) continue;
                            var nx = px + dx;
                            var ny = py + dy;
                            if(nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                            var key = nx + "," + ny;
                            if(seen[key] || !belongs(nx, ny)) continue;
                            seen[key] = true;
                            queue.push(nx, ny);
                        }
                    }
                }

                if(cells > bestCells) {
                    bestCells = cells;
                    bestSpanX = maxX - minX + 1;
                }
            }
        }

        var realWater = MapGen.Layers.Count(layers.water, function(pValue) {
            return !!pValue;
        });
        var minCells = Math.max(36, W * 2);
        var minSpanX = Math.max(12, W - 6);
        if(realWater < minCells)
            this.Fail(pReport, "river_crossing_water_too_low:" + realWater + "/" + minCells, false);
        if(bestCells < minCells || bestSpanX < minSpanX)
            this.Fail(pReport, "river_crossing_not_spanning:" + bestSpanX + "/" + minSpanX, false);
        if(!pContext.Bridges || !pContext.Bridges.length) {
            var rejects = pContext.BridgeRejectStats || {};
            var rejectParts = [];
            for(var rejectKey in rejects) {
                if(rejects.hasOwnProperty(rejectKey))
                    rejectParts.push(rejectKey + "=" + rejects[rejectKey]);
            }
            if(!rejectParts.length) {
                rejectParts.push("module=" +
                    (!!(MapGen.Features && MapGen.Features.Bridges) ? "yes" : "no"));
                rejectParts.push("build=" +
                    (MapGen.Features && MapGen.Features.Bridges ?
                        typeof MapGen.Features.Bridges.Build : "missing"));
                rejectParts.push("data=" +
                    (!!(typeof Structures !== "undefined" && Structures.Jungle &&
                        Structures.Jungle.Bridge) ? "yes" : "no"));
                rejectParts.push("crossings=" +
                    Number((pContext.Crossings || []).length));
                rejectParts.push("minWidth=" + String(profile.BridgeMinRiverWidth));
                if(pContext.BridgeBuildDebug) {
                    rejectParts.push("eligible=" + pContext.BridgeBuildDebug.eligible);
                    rejectParts.push("attempted=" + pContext.BridgeBuildDebug.attempted);
                    rejectParts.push("placed=" + pContext.BridgeBuildDebug.placed);
                }
            }
            this.Fail(pReport, "river_crossing_bridge_missing" +
                (rejectParts.length ? ":" + rejectParts.join("+") : ""), false);
        }
    },

    // Architecture v3 (P6): per-viewport interest gate. Penalises maps with too
    // many "dead" screens (no cover/water/cliff/route/object) or "quiet"
    // screens (only token interest in a mostly flat viewport) — the empty
    // pockets that make a big map feel boring even when global composition is
    // on target.
    // Ambient failures remain WARNINGS so intentional open combat arenas are
    // legal. Profiles may make route failures hard: a screen the player must
    // traverse is empty acreage rather than optional breathing room.
    // Defaults bracket the originals' near-zero empty-screen fraction with slack.
    ScreenPacing: function(pContext, pReport, pRules) {
        var rules = pRules || {};
        var profile = pContext.Profile || {};
        var sp = pReport.metrics && pReport.metrics.ScreenPacing;
        if(!sp || !sp.screens)
            return;

        var maxDead = rules.MaxDeadScreenFraction !== undefined ? rules.MaxDeadScreenFraction : 0.05;
        var maxRouteDead = rules.MaxRouteDeadScreenFraction !== undefined ?
            rules.MaxRouteDeadScreenFraction :
            (profile.MaxRouteDeadScreenFraction !== undefined ?
                profile.MaxRouteDeadScreenFraction : 0.0);
        var maxQuiet = rules.MaxQuietScreenFraction !== undefined ? rules.MaxQuietScreenFraction :
            profile.MaxQuietScreenFraction;
        var maxRouteQuiet = rules.MaxRouteQuietScreenFraction !== undefined ? rules.MaxRouteQuietScreenFraction :
            profile.MaxRouteQuietScreenFraction;

        if(sp.deadFraction > maxDead)
            this.Warn(pReport, "screens_too_empty");
        if(maxQuiet !== undefined && sp.quietFraction > maxQuiet)
            this.Warn(pReport, "screens_too_quiet:" +
                Math.round(sp.quietFraction * 100) + "/" + Math.round(maxQuiet * 100));
        // Dead screens ON the route are worse — those are the ones the player
        // crosses. Warn separately so they cost an extra Retry-score penalty.
        if(sp.routeDeadFraction > maxRouteDead) {
            if(profile.RouteScreenPacingHardFail)
                this.Fail(pReport, "route_screens_too_empty", false);
            else
                this.Warn(pReport, "route_screens_too_empty");
        }
        if(maxRouteQuiet !== undefined && sp.routeQuietFraction > maxRouteQuiet) {
            var routeQuietReason = "route_screens_too_quiet:" +
                Math.round(sp.routeQuietFraction * 100) + "/" + Math.round(maxRouteQuiet * 100);
            if(profile.RouteScreenPacingHardFail)
                this.Fail(pReport, routeQuietReason, false);
            else
                this.Warn(pReport, routeQuietReason);
        }
    },

    LandShapeTargets: function(pContext, pReport) {
        var profile = pContext.Profile || {};
        var metrics = pReport.metrics || {};
        var counts = metrics.Counts || {};
        var landComponents = counts.landComponents || 0;

        if(profile.MinLandBlobCountWarning !== undefined && landComponents < profile.MinLandBlobCountWarning)
            this.Warn(pReport, "land_blob_count_low:" + landComponents + "/" + profile.MinLandBlobCountWarning);

        if(profile.MaxLandBlobCountWarning !== undefined && landComponents > profile.MaxLandBlobCountWarning)
            this.Warn(pReport, "land_blob_count_high:" + landComponents + "/" + profile.MaxLandBlobCountWarning);
    },

    // Water composition gate. Generated ice maps frequently produce a
    // "perimeter frame" silhouette — water concentrated on 1-2 sides
    // with the other sides as long unbroken land runs — while shipped
    // CF ice maps reliably distribute water around all 4 perimeter
    // edges with many small segments. Probes:
    //   Tools/Analysis/PerimeterDistribution.py (calibration data)
    // Calibrated 2026-06-14 against 16 shipped + 5 generated ice maps:
    //   shipped p50 longestLandRunFraction = 0.146 (p75 = 0.220)
    //   shipped p25 edgesWithWater = 4 (only mapm31 uses 1 edge)
    //   shipped p50 perimeterSegments = 11
    //
    // Composite gate (passes 12/16 shipped, fails 5/5 current gen ice):
    //   PASS if longestLandRunFraction <= MaxLongestLandRunFraction
    //   OR if edgesWithWater >= MinPerimeterEdgesWithWater
    //          AND perimeterSegments >= MinPerimeterSegments
    //
    // Profile-keyed: only fires when MaxLongestLandRunFraction is set
    // (currently grammar_ice). Failure is a non-fatal `Fail` so the
    // retry framework re-attempts; if all attempts fail, framework
    // returns the best-score attempt (no missing map).
    WaterCompositionTargets: function(pContext, pReport) {
        var profile = pContext.Profile || {};
        if(typeof profile.MaxLongestLandRunFraction !== "number")
            return; // gate is profile-opt-in (currently grammar_ice only)

        var metrics = pReport.metrics || {};
        var perim = metrics.PerimeterDistribution;
        if(!perim || perim.perimeterCells <= 0)
            return;

        var landRunOk = perim.longestLandRunFraction <= profile.MaxLongestLandRunFraction;
        var minEdges = (typeof profile.MinPerimeterEdgesWithWater === "number") ?
            profile.MinPerimeterEdgesWithWater : 4;
        var minSegments = (typeof profile.MinPerimeterSegments === "number") ?
            profile.MinPerimeterSegments : 5;
        var distributionOk = (perim.edgesWithWater >= minEdges) &&
            (perim.perimeterSegments >= minSegments);

        if(landRunOk || distributionOk)
            return; // composite gate: either path is acceptable

        // Both criteria failed: water sits as a frame with one big
        // unbroken land side AND fewer than the required water segments
        // distributed around the perimeter. Hard fail (non-fatal) so the
        // retry framework picks a different attempt.
        this.Fail(
            pReport,
            "water_composition_frame_silhouette:" +
                "landRun=" + perim.longestLandRunFraction.toFixed(3) +
                "(max " + profile.MaxLongestLandRunFraction.toFixed(3) + ")" +
                ",edges=" + perim.edgesWithWater + "/" + minEdges +
                ",segments=" + perim.perimeterSegments + "/" + minSegments,
            false
        );
    },

    PlateauContiguous: function(pContext, pReport) {
        var layer = pContext.Layers && pContext.Layers.elevation;
        if(!layer)
            return;

        // Terrace mode paints a single rectangle 0..topRowY-1 × 0..Width-1,
        // which is contiguous by construction. Skip the BFS.
        if(pContext.Plateau && pContext.Plateau.mode === "terrace")
            return;

        var visited = {};
        var components = 0;
        var key = function(pX, pY) { return pX + "," + pY; };

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(!MapGen.Layers.IsPlateau(layer, x, y))
                    continue;
                if(visited[key(x, y)])
                    continue;

                ++components;
                if(components > 1)
                    break;

                var stack = [{ x: x, y: y }];
                visited[key(x, y)] = true;

                while(stack.length) {
                    var current = stack.pop();
                    var neighbours = [
                        { x: current.x + 1, y: current.y },
                        { x: current.x - 1, y: current.y },
                        { x: current.x, y: current.y + 1 },
                        { x: current.x, y: current.y - 1 }
                    ];

                    for(var n = 0; n < neighbours.length; ++n) {
                        var nx = neighbours[n].x;
                        var ny = neighbours[n].y;
                        if(visited[key(nx, ny)])
                            continue;
                        if(!MapGen.Layers.IsPlateau(layer, nx, ny))
                            continue;
                        visited[key(nx, ny)] = true;
                        stack.push(neighbours[n]);
                    }
                }
            }

            if(components > 1)
                break;
        }

        if(components > 1)
            this.Fail(pReport, "plateau_disconnected", false);
    },

    // A horizontal cliff terrace splits the map north/south. Validate that a
    // walkable path still exists from one side to the other — either through
    // an ice walkway tile (HIT dual flag) or through a gap left by a rejected
    // stamp (water/path/keepClear). If the cliff strands the plateau, the
    // generator either picked a band that fully separates the map, or the
    // walkway tiles aren't actually walkable in this build.
    //
    // Jungle (HelicopterTransit) inverts this: cliff stamps ARE supposed to
    // be a barrier — the squad flies over via a helicopter pickup. Strand-test
    // is wrong; instead verify the helicopter is reachable from spawn.
    CliffsTraversable: function(pContext, pReport) {
        if(!pContext.Cliffs || !pContext.Cliffs.length)
            return;

        if(pContext.Profile && pContext.Profile.RequireFullWidthCliffs === true) {
            for(var fullIndex = 0; fullIndex < pContext.Cliffs.length; ++fullIndex) {
                var fullCliff = pContext.Cliffs[fullIndex];
                var columns = fullCliff && fullCliff.columns ? fullCliff.columns : [];
                var seen = {};
                for(var columnIndex = 0; columnIndex < columns.length; ++columnIndex)
                    seen[columns[columnIndex].x] = true;
                for(var requiredX = 0; requiredX < pContext.Width; ++requiredX) {
                    if(!seen[requiredX]) {
                        this.Fail(pReport, "cliff_not_full_width:" + requiredX, true);
                        break;
                    }
                }
            }
        }
        if(!pContext.Plateau || pContext.Plateau.mode !== "terrace")
            return;

        if(pContext.Profile && pContext.Profile.HelicopterTransit) {
            this.CliffHasReachableHelicopter(pContext, pReport);
            return;
        }

        var bandY = pContext.Plateau.bandY;
        var topRowY = pContext.Plateau.topRowY;

        var northTest = this.FindWalkableInRow(pContext, topRowY - 1);
        var southTest = this.FindWalkableInRow(pContext, bandY + 1);

        if(!northTest || !southTest) {
            this.Warn(pReport, "cliff_side_no_walkable_test_cell");
            return;
        }

        if(!this.CanReach(pContext, northTest, southTest))
            this.Fail(pReport, "cliff_strands_plateau", true);
    },

    StructuresAvoidCliffs: function(pContext, pReport) {
        if(!pContext.Cliffs || !pContext.Cliffs.length)
            return;
        if(!MapGen.Integration || !MapGen.Integration.IsStructureCliffProtectedCell)
            return;

        var placements = pContext.LiveStructurePlacements || [];
        for(var index = 0; index < placements.length; ++index) {
            var placement = placements[index];
            if(!placement || !placement.rect)
                continue;

            var spec = placement.spec || {};
            var clearance = MapGen.Integration.StructureClearance ?
                MapGen.Integration.StructureClearance(spec) :
                { left: 0, right: 0, top: 0, bottom: 0 };
            var cliffClearance = MapGen.Integration.StructureCliffClearance ?
                MapGen.Integration.StructureCliffClearance(pContext, spec) :
                0;
            var rect = placement.rect;
            var minX = rect.minX - clearance.left - cliffClearance;
            var maxX = rect.maxX + clearance.right + cliffClearance;
            var minY = rect.minY - clearance.top - cliffClearance;
            var maxY = rect.maxY + clearance.bottom + cliffClearance;

            for(var x = minX; x <= maxX; ++x) {
                for(var y = minY; y <= maxY; ++y) {
                    if(MapGen.Integration.IsStructureCliffProtectedCell(pContext, x, y)) {
                        this.Fail(pReport, "structure_cliff_clearance_overlap:" + index + ":" + x + "," + y, false);
                        return;
                    }
                }
            }
        }
    },

    StructuresSeparated: function(pContext, pReport) {
        if(!MapGen.Integration || !MapGen.Integration.RectDistance)
            return;

        var placements = pContext.LiveStructurePlacements || [];
        for(var leftIndex = 0; leftIndex < placements.length; ++leftIndex) {
            var left = placements[leftIndex];
            if(!left || !left.rect)
                continue;

            for(var rightIndex = leftIndex + 1; rightIndex < placements.length; ++rightIndex) {
                var right = placements[rightIndex];
                if(!right || !right.rect)
                    continue;

                var minSpacing = 0;
                if(MapGen.Integration.StructureSpacing) {
                    minSpacing = Math.max(
                        minSpacing,
                        MapGen.Integration.StructureSpacing(left.spec || {}, pContext),
                        MapGen.Integration.StructureSpacing(right.spec || {}, pContext)
                    );
                }
                if(pContext.Profile && typeof pContext.Profile.LiveStructureMinSpacing === "number")
                    minSpacing = Math.max(minSpacing, Math.floor(pContext.Profile.LiveStructureMinSpacing));
                if(typeof left.spacingOverride === "number")
                    minSpacing = Math.min(minSpacing, left.spacingOverride);
                if(typeof right.spacingOverride === "number")
                    minSpacing = Math.min(minSpacing, right.spacingOverride);

                if(minSpacing <= 0)
                    continue;

                var distance = MapGen.Integration.RectDistance(left.rect, right.rect);
                if(distance < minSpacing) {
                    this.Fail(
                        pReport,
                        "live_structure_spacing_too_close:" +
                            leftIndex + "/" + rightIndex + ":" +
                            Math.round(distance) + "/" + minSpacing,
                        false
                    );
                    return;
                }
            }
        }
    },

    StructuresAvoidWater: function(pContext, pReport) {
        if(!MapGen.Integration || !MapGen.Integration.StructureWaterClearanceConflict)
            return;

        var placements = pContext.LiveStructurePlacements || [];
        for(var index = 0; index < placements.length; ++index) {
            var placement = placements[index];
            if(!placement || !placement.rect)
                continue;

            var clearance = typeof placement.waterClearance === "number" ?
                placement.waterClearance :
                (MapGen.Integration.StructureWaterClearance ?
                    MapGen.Integration.StructureWaterClearance(pContext, placement.spec || {}) :
                    0);

            if(clearance > 0 &&
                MapGen.Integration.StructureWaterClearanceConflict(pContext, placement.rect, clearance)) {
                this.Fail(pReport, "live_structure_water_clearance_overlap:" + index + "/" + clearance, false);
                return;
            }
        }
    },

    StructuresHaveContext: function(pContext, pReport) {
        if(!MapGen.Integration || !MapGen.Integration.StructureContextStats)
            return;

        var radius = MapGen.Integration.StructureContextRadius ?
            MapGen.Integration.StructureContextRadius(pContext) :
            0;
        var minCover = MapGen.Integration.StructureMinContextCoverFraction ?
            MapGen.Integration.StructureMinContextCoverFraction(pContext) :
            0;

        if(radius <= 0 || minCover <= 0)
            return;

        var placements = pContext.LiveStructurePlacements || [];
        for(var index = 0; index < placements.length; ++index) {
            var placement = placements[index];
            if(!placement || !placement.rect)
                continue;

            var stats = MapGen.Integration.StructureContextStats(pContext, placement.rect, radius);
            if(stats.coverFraction < minCover) {
                this.Fail(
                    pReport,
                    "live_structure_context_too_open:" +
                        index + ":" +
                        Math.round(stats.coverFraction * 100) + "/" +
                        Math.round(minCover * 100),
                    false
                );
                return;
            }
        }
    },

    CliffHasReachableHelicopter: function(pContext, pReport) {
        var anchors = pContext.Anchors || {};
        var anchor = anchors.start || anchors.teamA || anchors.teamB;
        if(!anchor) {
            this.Warn(pReport, "cliff_helicopter_no_anchor");
            return;
        }

        var pickups = (pContext.Placements && pContext.Placements.pickups) || [];
        var helicopter = null;
        for(var index = 0; index < pickups.length; ++index) {
            if(pickups[index].kind === "helicopter") {
                helicopter = pickups[index];
                break;
            }
        }

        if(!helicopter || !helicopter.point) {
            this.Fail(pReport, "cliff_helicopter_missing", true);
            return;
        }

        if(!this.CanReach(pContext, anchor, helicopter.point))
            this.Fail(pReport, "cliff_helicopter_unreachable", true);
    },

    FindWalkableInRow: function(pContext, pY) {
        if(pY < 0 || pY >= pContext.Height)
            return null;

        var width = pContext.Width;
        var mid = Math.floor(width / 2);

        for(var offset = 0; offset <= mid; ++offset) {
            var candidates = offset === 0 ? [mid] : [mid - offset, mid + offset];
            for(var c = 0; c < candidates.length; ++c) {
                var x = candidates[c];
                if(x < 0 || x >= width)
                    continue;
                if(MapGen.Metrics.IsWalkable(pContext, x, pY))
                    return { x: x, y: pY };
            }
        }
        return null;
    },

    RiversControlled: function(pContext, pReport) {
        if(!pContext.Rivers.length)
            return;

        var maxRouteDistance = pContext.Profile.CrossingMaxRouteDistance || 8;
        var maxRouteDistanceSq = maxRouteDistance * maxRouteDistance;

        for(var index = 0; index < pContext.Crossings.length; ++index) {
            var crossing = pContext.Crossings[index];
            if(!this.PointNearAnyPath(pContext, crossing, maxRouteDistanceSq))
                this.Fail(pReport, "crossing_not_near_route", false);
        }

        if(pContext.Width * pContext.Height < 2400 && pReport.metrics.Coverage.water > 0.22)
            this.Fail(pReport, "small_map_water_too_high", false);
    },

    GameplayUtilization: function(pContext, pReport) {
        var use = pReport.metrics && pReport.metrics.GameplayUtilization;
        if(!use || !use.enabled)
            return;

        for(var index = 0; index < use.misses.length; ++index)
            this.Warn(pReport, "gameplay_utilization_low:" + use.misses[index]);
        for(index = 0; index < use.hardReasons.length; ++index)
            this.Fail(pReport, use.hardReasons[index], false);
    },

    BridgesSupportedByWater: function(pContext, pReport) {
        var bridges = pContext.Bridges || [];
        var water = pContext.Layers ? pContext.Layers.water : null;

        for(var index = 0; index < bridges.length; ++index) {
            var bridge = bridges[index];
            if(!bridge || bridge.axis !== "vertical" || !bridge.bounds ||
                typeof bridge.waterTop !== "number" || typeof bridge.waterBottom !== "number")
                continue;

            var leftX = bridge.bounds.minX - 1;
            var rightX = bridge.bounds.maxX + 1;
            for(var y = bridge.waterTop; y <= bridge.waterBottom; ++y) {
                if(!MapGen.Layers.Get(water, leftX, y, 0) ||
                    !MapGen.Layers.Get(water, rightX, y, 0)) {
                    this.Fail(pReport, "bridge_without_water_approach:" + index + ":" + y, true);
                    break;
                }
            }
        }
    },

    SoftHazardsControlled: function(pContext, pReport) {
        var layers = pContext.Layers;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(!MapGen.Layers.Get(layers.riverBank, x, y, 0))
                    continue;

                if(MapGen.Layers.Get(layers.keepClear, x, y, 0) ||
                    MapGen.Layers.Get(layers.path, x, y, 0) ||
                    MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                    MapGen.Layers.Get(layers.occupied, x, y, 0) ||
                    MapGen.Layers.Get(layers.coast, x, y, 0)) {
                    this.Fail(pReport, "soft_hazard_on_protected_cell:" + x + "," + y, true);
                    return;
                }
            }
        }

        this.QuicksandEdgesRendered(pContext, pReport);
    },

    QuicksandEdgesRendered: function(pContext, pReport) {
        var profile = pContext.Profile || {};
        var layers = pContext.Layers || {};
        var rendered = pContext.RenderedMap || {};
        var tiles = rendered.Tiles;
        var visited;
        var directions = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        var authoredExpected = {};

        var live = pContext.GrammarLiveTerrain || {};
        var authored = live.quicksand && live.quicksand.authoredTemplates === true ?
            live.quicksand.patches || [] : [];
        var beachData = MapGen.Terrain && MapGen.Terrain.Smoothing ?
            MapGen.Terrain.Smoothing.JungleBeach : null;
        var templates = beachData && beachData.QuicksandPatchTemplates ?
            beachData.QuicksandPatchTemplates() : [];
        var templateById = {};

        for(var templateIndex = 0; templateIndex < templates.length; ++templateIndex)
            templateById[templates[templateIndex].id] = templates[templateIndex];
        for(var patchIndex = 0; patchIndex < authored.length; ++patchIndex) {
            var patch = authored[patchIndex];
            var template = templateById[patch.template];
            if(!template || !patch.origin)
                continue;
            for(var row = 0; row < template.rows.length; ++row) {
                for(var column = 0; column < template.rows[row].length; ++column) {
                    var expected = template.rows[row][column];
                    if(expected === null)
                        continue;
                    authoredExpected[(patch.origin.x + column) + "," + (patch.origin.y + row)] = expected;
                }
            }
        }

        if(profile.TargetPackProfile !== "grammar_beach" || !layers.riverBank)
            return;

        visited = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
        for(var startX = 0; startX < pContext.Width; ++startX) {
            for(var startY = 0; startY < pContext.Height; ++startY) {
                if(MapGen.Layers.Get(visited, startX, startY, 0) ||
                    !MapGen.Layers.Get(layers.riverBank, startX, startY, 0))
                    continue;

                var queue = [{ x: startX, y: startY }];
                var componentSize = 0;
                MapGen.Layers.Set(visited, startX, startY, 1);

                for(var queueIndex = 0; queueIndex < queue.length; ++queueIndex) {
                    var point = queue[queueIndex];
                    var boundary = false;
                    ++componentSize;

                    for(var directionIndex = 0; directionIndex < directions.length; ++directionIndex) {
                        var nx = point.x + directions[directionIndex][0];
                        var ny = point.y + directions[directionIndex][1];
                        if(nx < 0 || ny < 0 || nx >= pContext.Width || ny >= pContext.Height ||
                            !MapGen.Layers.Get(layers.riverBank, nx, ny, 0)) {
                            boundary = true;
                            continue;
                        }
                        if(MapGen.Layers.Get(visited, nx, ny, 0))
                            continue;

                        MapGen.Layers.Set(visited, nx, ny, 1);
                        queue.push({ x: nx, y: ny });
                    }

                    if(boundary && tiles) {
                        var tileId = MapGen.Layers.Get(tiles, point.x, point.y, 0) & 0x1FF;
                        // Complete shipped motifs legitimately use 107/167 on
                        // their logical boundary; the neighbouring support
                        // tiles continue the painted curve. The square-edge
                        // rule applies only to procedurally selected cells.
                        var authoredTile = authoredExpected[point.x + "," + point.y];
                        if((tileId === 107 || tileId === 167) && authoredTile !== tileId) {
                            this.Fail(
                                pReport,
                                "quicksand_square_boundary_tile:" + point.x + "," + point.y + ":" + tileId,
                                false
                            );
                            return;
                        }
                    }
                }

                if(componentSize < 8) {
                    this.Fail(pReport, "quicksand_component_too_small:" + componentSize, false);
                    return;
                }
            }
        }
    },

    PointNearAnyPath: function(pContext, pPoint, pMaxDistanceSq) {
        for(var pathIndex = 0; pathIndex < pContext.Paths.length; ++pathIndex) {
            var path = pContext.Paths[pathIndex];

            for(var pointIndex = 0; pointIndex < path.points.length; ++pointIndex) {
                var dx = path.points[pointIndex].x - pPoint.x;
                var dy = path.points[pointIndex].y - pPoint.y;

                if((dx * dx) + (dy * dy) <= pMaxDistanceSq)
                    return true;
            }
        }

        return false;
    },

    PlacementsWalkable: function(pContext, pReport) {
        var groups = ["players", "teams", "enemies", "objectives", "structures", "pickups", "vehicles"];

        for(var groupIndex = 0; groupIndex < groups.length; ++groupIndex) {
            var groupName = groups[groupIndex];
            var group = pContext.Placements[groupName] || [];

            for(var index = 0; index < group.length; ++index) {
                var placement = group[index];
                if(!placement.point)
                    continue;

                if(!MapGen.Metrics.IsWalkable(pContext, placement.point.x, placement.point.y)) {
                    this.Fail(pReport, "placement_not_walkable:" + groupName + ":" + (placement.kind || index), false);
                }
            }
        }
    },

    PlacementsHaveApproach: function(pContext, pReport) {
        var groups = ["players", "teams", "enemies", "objectives", "structures", "pickups", "vehicles"];

        for(var groupIndex = 0; groupIndex < groups.length; ++groupIndex) {
            var groupName = groups[groupIndex];
            var group = pContext.Placements[groupName] || [];

            for(var index = 0; index < group.length; ++index) {
                var placement = group[index];
                if(!placement.point)
                    continue;

                var radius = (placement.radius || 1) + (placement.approach || 1);
                var walkable = this.CountWalkableAround(pContext, placement.point, radius);
                if(walkable < 4)
                    this.Fail(pReport, "placement_approach_blocked:" + groupName + ":" + (placement.kind || index), false);
            }
        }
    },

    CountWalkableAround: function(pContext, pPoint, pRadius) {
        var count = 0;

        for(var x = pPoint.x - pRadius; x <= pPoint.x + pRadius; ++x) {
            for(var y = pPoint.y - pRadius; y <= pPoint.y + pRadius; ++y) {
                if(x === pPoint.x && y === pPoint.y)
                    continue;
                if(MapGen.Metrics.IsWalkable(pContext, x, y))
                    ++count;
            }
        }

        return count;
    },

    ConnectivityRootNode: function(pContext) {
        var nodes = pContext.ConnectivityNodes || [];
        var order = ["players", "teams"];

        for(var orderIndex = 0; orderIndex < order.length; ++orderIndex) {
            for(var index = 0; index < nodes.length; ++index) {
                if(nodes[index].group === order[orderIndex])
                    return nodes[index];
            }
        }

        return nodes.length ? nodes[0] : null;
    },

    NodeAccessPoint: function(pNode) {
        if(!pNode)
            return null;
        return pNode.access || pNode.point || null;
    },

    ConnectivityReachable: function(pContext, pStart, pEnd) {
        var profile = pContext.Profile || {};
        var rendered = pContext.RenderedMap || null;
        var useRendered = profile.ConnectivityUsesRenderedWalkability === true ||
            (profile.TerrainType === Terrain.Types.Ice && rendered && rendered.Chars);

        if(useRendered) {
            var nativeResult = this.TryNativeShortestPath(pContext, pStart, pEnd, null, "finalRoute");
            if(nativeResult.handled)
                return !!nativeResult.path;

            var self = this;
            return !!this.ShortestPathWithWalkable(pContext, pStart, pEnd, null, function(pCtx, pX, pY) {
                return self.FinalRouteCharWalkable(pCtx, pX, pY);
            });
        }

        return this.CanReach(pContext, pStart, pEnd);
    },

    AllConnectivityNodesReachable: function(pContext, pReport, pRules) {
        var nodes = pContext.ConnectivityNodes || [];
        if(!nodes.length) {
            this.Fail(pReport, "connectivity_nodes_missing", true);
            return;
        }

        var root = this.ConnectivityRootNode(pContext);
        var rootPoint = this.NodeAccessPoint(root);
        if(!rootPoint) {
            this.Fail(pReport, "connectivity_root_missing", true);
            return;
        }

        for(var index = 0; index < nodes.length; ++index) {
            var node = nodes[index];
            if(!node.mustReach)
                continue;

            var point = this.NodeAccessPoint(node);
            if(!point) {
                this.Fail(pReport, "connectivity_node_no_access:" + node.group + ":" + node.kind, true);
                continue;
            }

            if(!this.ConnectivityReachable(pContext, rootPoint, point)) {
                var suffix = ":" + point.x + "," + point.y;
                if(node.point)
                    suffix += ":placement_" + node.point.x + "," + node.point.y;
                if(node.routeFailed)
                    suffix += ":route_failed";
                if(node.routeFailedReason)
                    suffix += ":" + node.routeFailedReason;
                this.Fail(pReport, "connectivity_node_unreachable:" + node.group + ":" + node.kind + suffix, true);
            }
        }
    },

    IsCampaignRouteSite: function(pContext, pSite) {
        if(!pSite || !pSite.point || !pSite.requireSpur)
            return false;
        if(!(pContext.Anchors && pContext.Anchors.start && pContext.Anchors.objective))
            return false;

        return pSite.kind === "structure" || pSite.kind === "pickup";
    },

    PlacementGroupForSite: function(pSite) {
        if(pSite.kind === "structure")
            return "structures";
        if(pSite.kind === "pickup")
            return "pickups";
        return "";
    },

    PlacementMatchesSite: function(pPlacement, pSite, pMaxDistanceSq) {
        if(!pPlacement || !pPlacement.point || !pSite || !pSite.point)
            return false;
        if(pSite.template && pPlacement.template && pSite.template !== pPlacement.template)
            return false;
        if(pSite.role && pPlacement.role && pSite.role !== pPlacement.role)
            return false;

        var dx = pPlacement.point.x - pSite.point.x;
        var dy = pPlacement.point.y - pSite.point.y;
        return (dx * dx) + (dy * dy) <= pMaxDistanceSq;
    },

    PlannedSiteMaterialized: function(pContext, pSite) {
        var groupName = this.PlacementGroupForSite(pSite);
        if(!groupName)
            return true;

        var placements = pContext.Placements[groupName] || [];
        var maxDistance = pSite.kind === "structure" ? 8 : 4;
        var maxDistanceSq = maxDistance * maxDistance;

        for(var index = 0; index < placements.length; ++index) {
            if(this.PlacementMatchesSite(placements[index], pSite, maxDistanceSq))
                return true;
        }

        return false;
    },

    // Validate the route-site plan independently from materialized sprites.
    // This is safe before Terrain/Render because route planning is complete in
    // Layout; callers that run after placement can request the final
    // PlannedSiteMaterialized check through pIncludeMaterialization.
    CampaignRoutePlan: function(pContext, pReport, pRules, pIncludeMaterialization) {
        var sites = pContext.PlannedSites || [];
        var routeSites = [];

        for(var index = 0; index < sites.length; ++index) {
            if(this.IsCampaignRouteSite(pContext, sites[index]))
                routeSites.push(sites[index]);
        }

        if(!routeSites.length)
            return;

        if(!pContext.RouteSitePlan)
            this.Fail(pReport, "campaign_route_site_plan_missing", false);

        var maxOffset = pContext.Profile && pContext.Profile.MaxRouteSideSiteDistance !== undefined ?
            pContext.Profile.MaxRouteSideSiteDistance : 18;
        maxOffset = Math.max(1, Number(maxOffset) || 18);
        var minQuality = pContext.Profile && pContext.Profile.MinRouteSiteQualityWarning !== undefined ?
            Number(pContext.Profile.MinRouteSiteQualityWarning) : 35;

        for(var siteIndex = 0; siteIndex < routeSites.length; ++siteIndex) {
            var site = routeSites[siteIndex];
            var label = site.kind + ":" + (site.template || site.id || siteIndex);

            if(site.routePlanFailed)
                this.Fail(pReport, "campaign_route_site_plan_failed:" + label, false);
            if(!site.routePlanned)
                this.Fail(pReport, "campaign_route_site_not_route_planned:" + label, false);
            if(!site.routeAnchor)
                this.Fail(pReport, "campaign_route_site_anchor_missing:" + label, false);
            else if(Math.abs(Number(site.routeOffset || 0)) > maxOffset)
                this.Fail(pReport, "campaign_route_site_too_far:" + label, false);
            if(site.routePlanned && site.routeQuality === undefined)
                this.Warn(pReport, "campaign_route_site_quality_missing:" + label);
            else if(site.routePlanned && site.routeQuality < minQuality)
                this.Warn(pReport, "campaign_route_site_quality_low:" + label + ":" + site.routeQuality + "/" + minQuality);

            if(pIncludeMaterialization && !this.PlannedSiteMaterialized(pContext, site))
                this.Fail(pReport, "campaign_route_site_not_materialized:" + label, false);
        }
    },

    CampaignRouteSites: function(pContext, pReport, pRules) {
        this.CampaignRoutePlan(pContext, pReport, pRules, true);
    },

    RouteSitePhase: function(pFraction) {
        if(pFraction < 0.34)
            return "early";
        if(pFraction < 0.68)
            return "mid";
        return "late";
    },

    CampaignRouteSiteFraction: function(pSite) {
        var value = Number(pSite.routeFraction);
        if(!isNaN(value))
            return Math.max(0, Math.min(1, value));

        return null;
    },

    MinimumFractionSpacing: function(pFractions) {
        if(!pFractions || pFractions.length < 2)
            return null;

        pFractions.sort(function(a, b) { return a - b; });
        var min = 1;
        for(var index = 1; index < pFractions.length; ++index) {
            var gap = pFractions[index] - pFractions[index - 1];
            if(gap < min)
                min = gap;
        }

        return Math.round(min * 1000) / 1000;
    },

    CampaignRouteFlow: function(pContext, pReport, pRules) {
        if(!(pContext.Anchors && pContext.Anchors.start && pContext.Anchors.objective))
            return;
        if(!(MapGen.Layout && MapGen.Layout.CriticalSites && MapGen.Layout.CriticalSites.CampaignObjectiveRoute))
            return;

        var route = MapGen.Layout.CriticalSites.CampaignObjectiveRoute(pContext);
        var sites = pContext.PlannedSites || [];
        var phaseCounts = {
            early: { structures: 0, pickups: 0, total: 0 },
            mid: { structures: 0, pickups: 0, total: 0 },
            late: { structures: 0, pickups: 0, total: 0 }
        };
        var structureFractions = [];
        var pickupFractions = [];
        var routeSites = 0;

        if(!route || !route.points || route.points.length < 2) {
            this.Fail(pReport, "campaign_objective_route_missing", true);
            return;
        }

        for(var index = 0; index < sites.length; ++index) {
            var site = sites[index];
            if(!this.IsCampaignRouteSite(pContext, site))
                continue;

            var fraction = this.CampaignRouteSiteFraction(site);
            if(fraction === null)
                continue;

            var phase = this.RouteSitePhase(fraction);
            ++routeSites;
            ++phaseCounts[phase].total;

            if(site.kind === "structure") {
                ++phaseCounts[phase].structures;
                structureFractions.push(fraction);
            }
            else if(site.kind === "pickup") {
                ++phaseCounts[phase].pickups;
                pickupFractions.push(fraction);
            }
        }

        var populatedPhases = 0;
        if(phaseCounts.early.total > 0) ++populatedPhases;
        if(phaseCounts.mid.total > 0) ++populatedPhases;
        if(phaseCounts.late.total > 0) ++populatedPhases;

        var minStructureSpacing = this.MinimumFractionSpacing(structureFractions);
        var minPickupSpacing = this.MinimumFractionSpacing(pickupFractions);
        var minAnySpacing = this.MinimumFractionSpacing(structureFractions.concat(pickupFractions));

        pContext.CampaignFlowPlan = {
            routeRole: route.role || "route",
            routeLength: route.points.length,
            routeSiteCount: routeSites,
            phaseCounts: phaseCounts,
            populatedPhases: populatedPhases,
            structureCount: structureFractions.length,
            pickupCount: pickupFractions.length,
            minStructureSpacing: minStructureSpacing,
            minPickupSpacing: minPickupSpacing,
            minAnySiteSpacing: minAnySpacing
        };

        var minPhases = pContext.Profile && pContext.Profile.MinCampaignFlowPhases !== undefined ?
            Number(pContext.Profile.MinCampaignFlowPhases) : 2;
        if(routeSites >= 3 && populatedPhases < minPhases)
            this.Warn(pReport, "campaign_route_sites_phase_clumped:" + populatedPhases + "/" + minPhases);

        var minStructureSpacingTarget = pContext.Profile && pContext.Profile.MinStructureRouteSpacingWarning !== undefined ?
            Number(pContext.Profile.MinStructureRouteSpacingWarning) : 0.07;
        if(minStructureSpacing !== null && minStructureSpacing < minStructureSpacingTarget)
            this.Warn(pReport, "campaign_structures_too_close:" + minStructureSpacing + "/" + minStructureSpacingTarget);

        var minPickupSpacingTarget = pContext.Profile && pContext.Profile.MinPickupRouteSpacingWarning !== undefined ?
            Number(pContext.Profile.MinPickupRouteSpacingWarning) : 0.08;
        if(minPickupSpacing !== null && minPickupSpacing < minPickupSpacingTarget)
            this.Warn(pReport, "campaign_pickups_too_close:" + minPickupSpacing + "/" + minPickupSpacingTarget);
    },

    TacticalEndpoints: function(pContext) {
        var nodes = pContext.ConnectivityNodes || [];
        var root = this.ConnectivityRootNode(pContext);
        var start = this.NodeAccessPoint(root);
        var teams = this.TeamSpawns(pContext);

        if(teams.length >= 2)
            return { start: teams[0], end: teams[1], mode: "multiplayer" };

        if(!start && pContext.Anchors)
            start = pContext.Anchors.start || null;

        var bestNode = null;
        var bestDistance = -1;
        var preferred = ["objectives", "structures", "enemies", "vehicles", "pickups"];

        for(var groupIndex = 0; groupIndex < preferred.length; ++groupIndex) {
            for(var index = 0; index < nodes.length; ++index) {
                var node = nodes[index];
                if(node.group !== preferred[groupIndex])
                    continue;
                var point = this.NodeAccessPoint(node);
                if(!point || !start)
                    continue;
                var distance = MapGen.Metrics.Distance(start, point);
                if(distance > bestDistance) {
                    bestDistance = distance;
                    bestNode = node;
                }
            }

            if(bestNode)
                break;
        }

        if(bestNode)
            return { start: start, end: this.NodeAccessPoint(bestNode), mode: "campaign", target: bestNode.id };

        if(pContext.Anchors && start && pContext.Anchors.objective)
            return { start: start, end: pContext.Anchors.objective, mode: "campaign", target: "objective_anchor" };

        return { start: start, end: null, mode: "unknown" };
    },

    PointKey: function(pX, pY) {
        return pX + "," + pY;
    },

    IsDryWalkable: function(pContext, pX, pY) {
        var layers = pContext.Layers;

        if(pX < 0 || pY < 0 || pX >= pContext.Width || pY >= pContext.Height)
            return false;
        if(MapGen.Layers.Get(layers.crossing, pX, pY, 0))
            return true;
        if(MapGen.Layers.Get(layers.water, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(layers.riverBank, pX, pY, 0))
            return false;
        if(this.RenderedTileBlocksDryRoute(pContext, pX, pY))
            return false;
        if(MapGen.Layers.Get(layers.path, pX, pY, 0))
            return true;
        // Slot 6 (after path, before blocked) — ORDER-SENSITIVE. Ice riverBank
        // ground cells block the dry route; non-ice biomes return false here.
        if(MapGen.Terrain.BiomeStrategy.For(pContext).bankBlocksDryRoute(pContext, pX, pY))
            return false;
        if(MapGen.Layers.Get(layers.blocked, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(layers.keepClear, pX, pY, 0))
            return true;

        return true;
    },

    RenderedTileBlocksDryRoute: function(pContext, pX, pY) {
        if(!pContext)
            return false;

        // Ice-only: a rendered deep/shallow water tile blocks the dry route.
        // The biome strategy returns false for every non-ice biome.
        return MapGen.Terrain.BiomeStrategy.For(pContext).renderedTileBlocksDryRoute(pContext, pX, pY);
    },

    // Reusable BFS scratch buffers. TacticalFlow/CountLanes/CutGroups call
    // ShortestPathWithWalkable dozens of times per validate pass; allocating
    // three fresh W*H arrays per call was the dominant validation cost in
    // profiling (the LCG/output is unaffected — this is pure scratch). We keep
    // one buffer set per (context,width,height) and use an incrementing visit
    // STAMP so a cell counts as visited only when visited[x][y] === stamp,
    // making the per-call reset O(1) instead of O(W*H). cameFrom* are only read
    // for cells with the current stamp, so they need no clearing. Calls are
    // sequential (never nested), so a single shared buffer set is safe.
    PathScratch: function(pContext) {
        var s = pContext._pathScratch;
        if(!s || s.width !== pContext.Width || s.height !== pContext.Height) {
            s = {
                width: pContext.Width,
                height: pContext.Height,
                stamp: 0,
                visited: MapGen.Layers.Create(pContext.Width, pContext.Height, 0),
                cameFromX: MapGen.Layers.Create(pContext.Width, pContext.Height, -1),
                cameFromY: MapGen.Layers.Create(pContext.Width, pContext.Height, -1)
            };
            pContext._pathScratch = s;
        }
        return s;
    },

    ShortestPathWithWalkable: function(pContext, pStart, pEnd, pBlocked, pWalkable) {
        if(!pWalkable) {
            var nativeResult = this.TryNativeShortestPath(pContext, pStart, pEnd, pBlocked, "default");
            if(nativeResult.handled)
                return nativeResult.path;
        }

        var walkable = pWalkable || function(pCtx, pX, pY) {
            return MapGen.Metrics.IsWalkable(pCtx, pX, pY);
        };
        var stats = this.PathStats(pContext);
        var statsStart = stats ? (new Date()).getTime() : 0;
        var expanded = 0;
        var pushed = 0;
        var maxQueue = 0;

        if(!pStart || !pEnd) {
            if(stats) this.RecordShortestStats(pContext, false, 0, expanded, pushed, maxQueue, statsStart);
            return null;
        }
        if(!walkable(pContext, pStart.x, pStart.y)) {
            if(stats) this.RecordShortestStats(pContext, false, 0, expanded, pushed, maxQueue, statsStart);
            return null;
        }
        if(!walkable(pContext, pEnd.x, pEnd.y)) {
            if(stats) this.RecordShortestStats(pContext, false, 0, expanded, pushed, maxQueue, statsStart);
            return null;
        }

        var blocked = pBlocked || {};
        if(blocked[this.PointKey(pStart.x, pStart.y)] || blocked[this.PointKey(pEnd.x, pEnd.y)]) {
            if(stats) this.RecordShortestStats(pContext, false, 0, expanded, pushed, maxQueue, statsStart);
            return null;
        }

        var scratch = this.PathScratch(pContext);
        var visited = scratch.visited;
        var cameFromX = scratch.cameFromX;
        var cameFromY = scratch.cameFromY;
        var stamp = ++scratch.stamp;
        var queue = [{ x: pStart.x, y: pStart.y }];
        var queueHead = 0;
        var directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        pushed = 1;
        maxQueue = 1;

        visited[pStart.x][pStart.y] = stamp;
        // The start has no parent. Buffers are reused across calls, so its
        // cameFrom may hold a stale value — force -1 so reconstruction stops here.
        cameFromX[pStart.x][pStart.y] = -1;
        cameFromY[pStart.x][pStart.y] = -1;

        while(queueHead < queue.length) {
            var current = queue[queueHead++];
            ++expanded;
            if(current.x === pEnd.x && current.y === pEnd.y) {
                var path = [];
                var cx = current.x;
                var cy = current.y;

                while(cx !== -1 && cy !== -1) {
                    path.push({ x: cx, y: cy });
                    var px = cameFromX[cx][cy];
                    var py = cameFromY[cx][cy];
                    cx = px;
                    cy = py;
                }

                path.reverse();
                if(stats) this.RecordShortestStats(pContext, true, path.length, expanded, pushed, maxQueue, statsStart);
                return path;
            }

            for(var index = 0; index < directions.length; ++index) {
                var nx = current.x + directions[index][0];
                var ny = current.y + directions[index][1];
                var key = this.PointKey(nx, ny);

                if(nx < 0 || ny < 0 || nx >= pContext.Width || ny >= pContext.Height)
                    continue;
                if(visited[nx][ny] === stamp)
                    continue;
                if(blocked[key])
                    continue;
                if(!walkable(pContext, nx, ny))
                    continue;

                visited[nx][ny] = stamp;
                cameFromX[nx][ny] = current.x;
                cameFromY[nx][ny] = current.y;
                queue.push({ x: nx, y: ny });
                ++pushed;
                if(queue.length - queueHead > maxQueue)
                    maxQueue = queue.length - queueHead;
            }
        }

        if(stats) this.RecordShortestStats(pContext, false, 0, expanded, pushed, maxQueue, statsStart);
        return null;
    },

    ShortestPath: function(pContext, pStart, pEnd, pBlocked) {
        return this.ShortestPathWithWalkable(pContext, pStart, pEnd, pBlocked, null);
    },

    ShortestDryPath: function(pContext, pStart, pEnd, pBlocked) {
        var nativeResult = this.TryNativeShortestPath(pContext, pStart, pEnd, pBlocked, "dry");
        if(nativeResult.handled)
            return nativeResult.path;

        var self = this;
        return this.ShortestPathWithWalkable(pContext, pStart, pEnd, pBlocked, function(pCtx, pX, pY) {
            return self.IsDryWalkable(pCtx, pX, pY);
        });
    },

    CountLanesWithWalkable: function(pContext, pStart, pEnd, pMaxLanes, pWalkable) {
        var maxLanes = pMaxLanes || 4;
        var blocked = {};
        var lanes = 0;

        while(lanes < maxLanes) {
            var path = this.ShortestPathWithWalkable(pContext, pStart, pEnd, blocked, pWalkable);
            if(!path)
                break;

            ++lanes;
            for(var index = 1; index < path.length - 1; ++index)
                blocked[this.PointKey(path[index].x, path[index].y)] = true;
        }

        return lanes;
    },

    GroupCells: function(pContext, pCells) {
        var pending = {};
        var groups = [];
        var directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];

        for(var index = 0; index < pCells.length; ++index)
            pending[this.PointKey(pCells[index].x, pCells[index].y)] = pCells[index];

        for(var key in pending) {
            if(!pending.hasOwnProperty(key))
                continue;

            var seed = pending[key];
            delete pending[key];
            var stack = [seed];
            var cells = [];
            var minX = seed.x, maxX = seed.x, minY = seed.y, maxY = seed.y;

            while(stack.length) {
                var current = stack.pop();
                cells.push(current);
                if(current.x < minX) minX = current.x;
                if(current.x > maxX) maxX = current.x;
                if(current.y < minY) minY = current.y;
                if(current.y > maxY) maxY = current.y;

                for(var directionIndex = 0; directionIndex < directions.length; ++directionIndex) {
                    var nx = current.x + directions[directionIndex][0];
                    var ny = current.y + directions[directionIndex][1];
                    var nextKey = this.PointKey(nx, ny);
                    if(!pending[nextKey])
                        continue;
                    stack.push(pending[nextKey]);
                    delete pending[nextKey];
                }
            }

            groups.push({
                size: cells.length,
                bounds: { minX: minX, minY: minY, maxX: maxX, maxY: maxY },
                center: {
                    x: Math.round(((minX + maxX) / 2) * 10) / 10,
                    y: Math.round(((minY + maxY) / 2) * 10) / 10
                }
            });
        }

        return groups;
    },

    CutGroupsOnPathWithWalkable: function(pContext, pStart, pEnd, pPath, pWalkable) {
        if(!pPath || pPath.length < 3)
            return [];

        var cutCells = [];
        for(var index = 1; index < pPath.length - 1; ++index) {
            var blocked = {};
            blocked[this.PointKey(pPath[index].x, pPath[index].y)] = true;
            if(!this.ShortestPathWithWalkable(pContext, pStart, pEnd, blocked, pWalkable))
                cutCells.push(pPath[index]);
        }

        return this.GroupCells(pContext, cutCells);
    },

    CountRouteCoverAround: function(pContext, pPoint, pRadius) {
        var layers = pContext.Layers;
        var count = 0;
        var radiusSq = pRadius * pRadius;

        for(var x = pPoint.x - pRadius; x <= pPoint.x + pRadius; ++x) {
            for(var y = pPoint.y - pRadius; y <= pPoint.y + pRadius; ++y) {
                var dx = x - pPoint.x;
                var dy = y - pPoint.y;

                if((dx * dx) + (dy * dy) > radiusSq)
                    continue;
                if(x < 0 || y < 0 || x >= pContext.Width || y >= pContext.Height) {
                    ++count;
                    continue;
                }
                if(MapGen.Layers.Get(layers.blocked, x, y, 0) ||
                    MapGen.Layers.Get(layers.water, x, y, 0) ||
                    MapGen.Layers.Get(layers.coast, x, y, 0) ||
                    MapGen.Layers.Get(layers.riverBank, x, y, 0)) {
                    ++count;
                }
            }
        }

        return count;
    },

    RouteExposure: function(pContext, pPath) {
        var profile = pContext.Profile || {};
        var radius = Math.max(2, Math.floor(profile.RouteExposureRadius || 5));
        var step = Math.max(1, Math.floor(profile.RouteExposureSampleStep || 3));
        var minCover = profile.RouteExposureMinCover;
        var samples = 0;
        var exposed = 0;
        var totalCover = 0;
        var run = 0;
        var longestRun = 0;

        if(minCover === undefined || minCover === null)
            minCover = 8;
        minCover = Math.max(1, Math.floor(Number(minCover) || 8));

        if(!pPath || !pPath.length) {
            return {
                radius: radius,
                minCover: minCover,
                sampleCount: 0,
                exposedSamples: 0,
                exposureFraction: 0,
                longestExposedRunTiles: 0,
                averageCoverTiles: 0
            };
        }

        for(var index = 0; index < pPath.length; index += step) {
            var cover = this.CountRouteCoverAround(pContext, pPath[index], radius);
            ++samples;
            totalCover += cover;

            if(cover < minCover) {
                ++exposed;
                run += step;
                if(run > longestRun)
                    longestRun = run;
            } else {
                run = 0;
            }
        }

        return {
            radius: radius,
            minCover: minCover,
            sampleCount: samples,
            exposedSamples: exposed,
            exposureFraction: samples ? exposed / samples : 0,
            longestExposedRunTiles: longestRun,
            averageCoverTiles: samples ? totalCover / samples : 0
        };
    },

    Percentile: function(pValues, pPercent) {
        if(!pValues || !pValues.length)
            return 0;

        var values = pValues.slice(0).sort(function(a, b) { return a - b; });
        if(values.length === 1)
            return values[0];

        var pos = (values.length - 1) * pPercent;
        var lo = Math.floor(pos);
        var hi = Math.ceil(pos);
        if(lo === hi)
            return values[lo];

        var weight = pos - lo;
        return (values[lo] * (1.0 - weight)) + (values[hi] * weight);
    },

    RouteCrossWidth: function(pContext, pPath, pIndex, pWalkable) {
        var walkable = pWalkable || function(pCtx, pX, pY) {
            return MapGen.Metrics.IsWalkable(pCtx, pX, pY);
        };
        var point = pPath[pIndex];
        var previous = pPath[Math.max(0, pIndex - 1)] || point;
        var next = pPath[Math.min(pPath.length - 1, pIndex + 1)] || point;
        var dx = next.x - previous.x;
        var dy = next.y - previous.y;
        var px = Math.abs(dx) >= Math.abs(dy) ? 0 : 1;
        var py = Math.abs(dx) >= Math.abs(dy) ? 1 : 0;
        var count = walkable(pContext, point.x, point.y) ? 1 : 0;

        for(var side = -1; side <= 1; side += 2) {
            var x = point.x + (px * side);
            var y = point.y + (py * side);
            while(walkable(pContext, x, y)) {
                ++count;
                x += px * side;
                y += py * side;
            }
        }

        return count;
    },

    RouteWidth: function(pContext, pPath, pWalkable) {
        if(!pPath || !pPath.length)
            return {
                sampleCount: 0,
                min: 0,
                p25: 0,
                median: 0,
                p75: 0,
                max: 0,
                narrowFractionAtMost3: 0,
                narrowFractionAtMost5: 0,
                narrowFractionAtMost7: 0,
                longestNarrowRunAtMost3: 0,
                longestNarrowRunAtMost7: 0
            };

        var step = Math.max(1, Math.floor(pPath.length / 48));
        var widths = [];
        var narrow3 = 0;
        var narrow5 = 0;
        var narrow7 = 0;
        var run3 = 0;
        var run7 = 0;
        var longestRun3 = 0;
        var longestRun7 = 0;
        var wideSamples = [];

        for(var index = 0; index < pPath.length; index += step) {
            var width = this.RouteCrossWidth(pContext, pPath, index, pWalkable);
            if(width <= 0)
                continue;
            widths.push(width);
            wideSamples.push({
                index: index,
                x: pPath[index].x,
                y: pPath[index].y,
                width: width
            });
            if(width <= 3) {
                ++narrow3;
                ++run3;
                if(run3 > longestRun3)
                    longestRun3 = run3;
            } else {
                run3 = 0;
            }
            if(width <= 5)
                ++narrow5;
            if(width <= 7) {
                ++narrow7;
                ++run7;
                if(run7 > longestRun7)
                    longestRun7 = run7;
            } else {
                run7 = 0;
            }
        }

        if(!widths.length)
            return {
                sampleCount: 0,
                min: 0,
                p25: 0,
                median: 0,
                p75: 0,
                max: 0,
                narrowFractionAtMost3: 0,
                narrowFractionAtMost5: 0,
                narrowFractionAtMost7: 0,
                longestNarrowRunAtMost3: 0,
                longestNarrowRunAtMost7: 0
            };

        wideSamples.sort(function(a, b) {
            if(a.width !== b.width)
                return b.width - a.width;
            return a.index - b.index;
        });

        return {
            sampleCount: widths.length,
            min: this.Percentile(widths, 0),
            p25: Math.round(this.Percentile(widths, 0.25) * 10) / 10,
            median: Math.round(this.Percentile(widths, 0.50) * 10) / 10,
            p75: Math.round(this.Percentile(widths, 0.75) * 10) / 10,
            max: this.Percentile(widths, 1),
            narrowFractionAtMost3: widths.length ? narrow3 / widths.length : 0,
            narrowFractionAtMost5: widths.length ? narrow5 / widths.length : 0,
            narrowFractionAtMost7: widths.length ? narrow7 / widths.length : 0,
            longestNarrowRunAtMost3: longestRun3 * step,
            longestNarrowRunAtMost7: longestRun7 * step,
            wideSamples: wideSamples.slice(0, 8)
        };
    },

    FinalRouteCharWalkable: function(pContext, pX, pY) {
        if(pX < 0 || pY < 0 || pX >= pContext.Width || pY >= pContext.Height)
            return false;

        if(this.RenderedTileBlocksDryRoute(pContext, pX, pY))
            return false;

        var rendered = pContext.RenderedMap || {};
        var chars = rendered.Chars || null;
        if(!chars)
            return this.IsDryWalkable(pContext, pX, pY);

        var ch = MapGen.Layers.Get(chars, pX, pY, ".");
        if(ch === "." || ch === "T")
            return false;

        var layers = pContext.Layers || {};
        var occupied = MapGen.Layers.Get(layers.occupied, pX, pY, 0);
        if(this.OccupiedBlocksRoute(occupied))
            return false;

        return true;
    },

    OccupiedBlocksRoute: function(pOccupied) {
        if(!pOccupied || pOccupied === "live_structure_clearance")
            return false;
        // Outcrops (DefensiveLines / EdgeBiomes / Outcrops modules) set
        // occupied=1 alongside outcrop=1 + blocked=1 to mark "this cell holds
        // a decorative rock cluster, no placement here". Several smoother
        // passes already special-case occupied===1 ("not a real placement,
        // just outcrop"). The validator's dry-route walkability did NOT — so
        // an outcrop chain rendering as plain ground char (which happens when
        // the smoother's outcrop chars get demoted) would block the route
        // even though the cell is otherwise walkable. Real outcrops are
        // already blocked by Layers.blocked → tree char, so dropping the
        // occupied=1 case from the route blocker only changes verdicts on
        // outcrop cells the renderer DEMOTED to plain ground — which is the
        // bug behind connectivity_node_unreachable on the gate seed (233
        // such cells walling off pickups from the route root).
        if(pOccupied === 1)
            return false;
        if(typeof pOccupied === "string") {
            if(pOccupied === "player_start" ||
                pOccupied === "vehicle_spawn" ||
                pOccupied.indexOf("enemy_") === 0)
                return false;
        }

        return true;
    },

    FinalRouteWidth: function(pContext, pPath) {
        var self = this;
        return this.RouteWidth(pContext, pPath, function(pCtx, pX, pY) {
            return self.FinalRouteCharWalkable(pCtx, pX, pY);
        });
    },

    TacticalUsesDryRoutes: function(pContext, pRules, pEndpoints) {
        if(pContext.Profile && pContext.Profile.TacticalFlowDryRoutes)
            return true;
        return pEndpoints && pEndpoints.mode === "multiplayer";
    },

    TacticalFlow: function(pContext, pReport, pRules) {
        var endpoints = this.TacticalEndpoints(pContext);
        if(!endpoints.start || !endpoints.end) {
            this.Warn(pReport, "tactical_endpoints_missing");
            return;
        }

        var useDryRoutes = this.TacticalUsesDryRoutes(pContext, pRules, endpoints);
        var dryWalkable = null;
        var path;

        if(useDryRoutes) {
            var self = this;
            dryWalkable = function(pCtx, pX, pY) {
                return self.IsDryWalkable(pCtx, pX, pY);
            };
        }

        path = useDryRoutes ?
            this.ShortestPathWithWalkable(pContext, endpoints.start, endpoints.end, null, dryWalkable) :
            this.ShortestPath(pContext, endpoints.start, endpoints.end, null);
        if(!path) {
            this.Fail(pReport, useDryRoutes ? "tactical_dry_route_missing" : "tactical_route_missing", true);
            return;
        }

        var lanes = this.CountLanesWithWalkable(pContext, endpoints.start, endpoints.end, pRules.MaximumLaneProbe || 4, dryWalkable);
        var cutGroups = this.CutGroupsOnPathWithWalkable(pContext, endpoints.start, endpoints.end, path, dryWalkable);
        var exposure = this.RouteExposure(pContext, path);
        var width = this.RouteWidth(pContext, path, dryWalkable);
        var finalWidth = this.FinalRouteWidth(pContext, path);
        var minLanes = pRules.MinimumLanes !== undefined ? pRules.MinimumLanes :
            (pContext.Profile.MinimumTacticalLanes !== undefined ? pContext.Profile.MinimumTacticalLanes : 1);
        var minChokepoints = pRules.MinimumChokepoints !== undefined ? pRules.MinimumChokepoints :
            (pContext.Profile.MinimumChokepoints !== undefined ? pContext.Profile.MinimumChokepoints : 0);
        var maxChokepoints = pRules.MaximumChokepoints !== undefined ? pRules.MaximumChokepoints :
            pContext.Profile.MaximumChokepoints;
        var maxExposure = pContext.Profile.MaxRouteExposureFraction;
        var maxExposedRun = pContext.Profile.MaxRouteExposedRunTiles;
        var minNarrowFraction = pContext.Profile.MinRouteNarrowFractionAtMost3;
        var maxMedianWidth = pContext.Profile.MaxRouteMedianWidth;
        var minNarrowRun = pContext.Profile.MinRouteNarrowRunAtMost3;
        var routeWidthHardFail = pContext.Profile.RouteWidthHardFail !== false;
        var minFinalNarrowFraction = pContext.Profile.MinFinalRouteNarrowFractionAtMost3 !== undefined ?
            pContext.Profile.MinFinalRouteNarrowFractionAtMost3 : minNarrowFraction;
        var maxFinalMedianWidth = pContext.Profile.MaxFinalRouteMedianWidth !== undefined ?
            pContext.Profile.MaxFinalRouteMedianWidth : maxMedianWidth;
        var minFinalNarrowRun = pContext.Profile.MinFinalRouteNarrowRunAtMost3 !== undefined ?
            pContext.Profile.MinFinalRouteNarrowRunAtMost3 : minNarrowRun;
        var minFinalNarrowFraction7 =
            pContext.Profile.MinFinalRouteNarrowFractionAtMost7;
        var minFinalNarrowRun7 =
            pContext.Profile.MinFinalRouteNarrowRunAtMost7;
        var finalRouteWidthHardFail = pContext.Profile.FinalRouteWidthHardFail !== undefined ?
            pContext.Profile.FinalRouteWidthHardFail !== false : routeWidthHardFail;

        pContext.Tactical = {
            mode: endpoints.mode,
            target: endpoints.target || "",
            dryRoutes: !!useDryRoutes,
            routeLength: path.length,
            laneEstimate: lanes,
            chokepointCount: cutGroups.length,
            chokepoints: cutGroups.slice(0, 12),
            routeExposure: exposure,
            routeWidth: width,
            finalRouteWidth: finalWidth
        };
        pContext.TacticalRoutePath = path.slice(0);
        pReport.tactical = pContext.Tactical;

        if(lanes < minLanes)
            this.Fail(pReport, "tactical_lanes_too_low:" + lanes + "/" + minLanes, false);
        if(cutGroups.length < minChokepoints)
            this.Fail(pReport, "tactical_chokepoints_too_low:" + cutGroups.length + "/" + minChokepoints, false);
        if(maxChokepoints !== undefined && cutGroups.length > maxChokepoints)
            this.Fail(pReport, "tactical_chokepoints_too_high:" + cutGroups.length + "/" + maxChokepoints, false);
        if(maxExposure !== undefined && exposure.exposureFraction > maxExposure) {
            var exposureReason = "route_exposure_too_high:" + Math.round(exposure.exposureFraction * 100) + "/" + Math.round(maxExposure * 100);
            if(pRules.RouteExposureFatal || pContext.Profile.RouteExposureHardFail)
                this.Fail(pReport, exposureReason, false);
            else
                this.Warn(pReport, exposureReason);
        }
        if(maxExposedRun !== undefined && exposure.longestExposedRunTiles > maxExposedRun) {
            var runReason = "route_exposed_run_too_long:" + exposure.longestExposedRunTiles + "/" + maxExposedRun;
            if(pRules.RouteExposureFatal || pContext.Profile.RouteExposureHardFail)
                this.Fail(pReport, runReason, false);
            else
                this.Warn(pReport, runReason);
        }
        if(minNarrowFraction !== undefined && width.narrowFractionAtMost3 < minNarrowFraction) {
            var narrowReason = "route_neck_fraction_too_low:" +
                Math.round(width.narrowFractionAtMost3 * 100) + "/" + Math.round(Number(minNarrowFraction) * 100);
            if(routeWidthHardFail)
                this.Fail(pReport, narrowReason, false);
            else
                this.Warn(pReport, narrowReason);
        }
        if(maxMedianWidth !== undefined && width.median > maxMedianWidth) {
            var widthReason = "route_median_width_too_high:" + width.median + "/" + maxMedianWidth;
            if(routeWidthHardFail)
                this.Fail(pReport, widthReason, false);
            else
                this.Warn(pReport, widthReason);
        }
        if(minNarrowRun !== undefined && width.longestNarrowRunAtMost3 < minNarrowRun) {
            var runWidthReason = "route_neck_run_too_short:" + width.longestNarrowRunAtMost3 + "/" + minNarrowRun;
            if(routeWidthHardFail)
                this.Fail(pReport, runWidthReason, false);
            else
                this.Warn(pReport, runWidthReason);
        }
        if(minFinalNarrowFraction !== undefined && finalWidth.sampleCount && finalWidth.narrowFractionAtMost3 < minFinalNarrowFraction) {
            var finalNarrowReason = "final_route_neck_fraction_too_low:" +
                Math.round(finalWidth.narrowFractionAtMost3 * 100) + "/" + Math.round(Number(minFinalNarrowFraction) * 100);
            if(finalRouteWidthHardFail)
                this.Fail(pReport, finalNarrowReason, false);
            else
                this.Warn(pReport, finalNarrowReason);
        }
        if(maxFinalMedianWidth !== undefined && finalWidth.sampleCount && finalWidth.median > maxFinalMedianWidth) {
            var finalWidthReason = "final_route_median_width_too_high:" + finalWidth.median + "/" + maxFinalMedianWidth;
            if(finalRouteWidthHardFail)
                this.Fail(pReport, finalWidthReason, false);
            else
                this.Warn(pReport, finalWidthReason);
        }
        if(minFinalNarrowRun !== undefined && finalWidth.sampleCount && finalWidth.longestNarrowRunAtMost3 < minFinalNarrowRun) {
            var finalRunWidthReason = "final_route_neck_run_too_short:" + finalWidth.longestNarrowRunAtMost3 + "/" + minFinalNarrowRun;
            if(finalRouteWidthHardFail)
                this.Fail(pReport, finalRunWidthReason, false);
            else
                this.Warn(pReport, finalRunWidthReason);
        }
        if(minFinalNarrowFraction7 !== undefined && finalWidth.sampleCount &&
            finalWidth.narrowFractionAtMost7 < minFinalNarrowFraction7) {
            var finalNarrow7Reason = "final_route_visible_neck_fraction_too_low:" +
                Math.round(finalWidth.narrowFractionAtMost7 * 100) + "/" +
                Math.round(Number(minFinalNarrowFraction7) * 100);
            if(finalRouteWidthHardFail)
                this.Fail(pReport, finalNarrow7Reason, false);
            else
                this.Warn(pReport, finalNarrow7Reason);
        }
        if(minFinalNarrowRun7 !== undefined && finalWidth.sampleCount &&
            finalWidth.longestNarrowRunAtMost7 < minFinalNarrowRun7) {
            var finalRun7Reason = "final_route_visible_neck_run_too_short:" +
                finalWidth.longestNarrowRunAtMost7 + "/" +
                minFinalNarrowRun7;
            if(finalRouteWidthHardFail)
                this.Fail(pReport, finalRun7Reason, false);
            else
                this.Warn(pReport, finalRun7Reason);
        }
    },

    PrepareTacticalRouteProtection: function(pContext, pRules) {
        if(!pContext || !pContext.Layers)
            return 0;
        if(pContext.Profile && pContext.Profile.PreserveDryTacticalRoutes === false)
            return 0;

        var endpoints = this.TacticalEndpoints(pContext);
        if(!endpoints.start || !endpoints.end)
            return 0;
        if(!this.TacticalUsesDryRoutes(pContext, pRules || {}, endpoints))
            return 0;

        var self = this;
        var path = this.ShortestPathWithWalkable(
            pContext,
            endpoints.start,
            endpoints.end,
            null,
            function(pCtx, pX, pY) { return self.IsDryWalkable(pCtx, pX, pY); }
        );
        if(!path || !path.length)
            return 0;

        pContext.PreRenderTacticalRoutePath = path.slice(0);
        pContext.TacticalRoutePath = path.slice(0);

        var changed = this.ProtectTacticalRoutePath(
            pContext,
            path,
            null,
            "Pre-render protected dry tactical route cells"
        );
        if(changed)
            pContext.PreRenderTacticalRouteProtectedTiles = changed;

        return changed;
    },

    ProtectTacticalRoutePath: function(pContext, pPath, pReport, pLogMessage) {
        if(!pContext || !pContext.Layers)
            return 0;

        var path = pPath || [];
        if(!path.length)
            return 0;

        var layers = pContext.Layers;
        var changed = 0;
        for(var index = 0; index < path.length; ++index) {
            var point = path[index];
            if(!point)
                continue;
            if(point.x < 0 || point.y < 0 || point.x >= pContext.Width || point.y >= pContext.Height)
                continue;
            if(MapGen.Layers.Get(layers.water, point.x, point.y, 0))
                continue;
            if(MapGen.Layers.Get(layers.riverBank, point.x, point.y, 0))
                continue;
            if(MapGen.Layers.Get(layers.blocked, point.x, point.y, 0))
                continue;

            if(!MapGen.Layers.Get(layers.path, point.x, point.y, 0)) {
                MapGen.Layers.Set(layers.path, point.x, point.y, 1);
                ++changed;
            }
            MapGen.Layers.Set(layers.keepClear, point.x, point.y, 1);
        }

        if(changed) {
            if(pContext.Tactical)
                pContext.Tactical.routeProtectedTiles = changed;
            if(pReport && pReport.tactical)
                pReport.tactical.routeProtectedTiles = changed;
            MapGen.Context.AddLog(pContext, (pLogMessage || "Protected dry tactical route cells") + ": " + changed);
        }

        return changed;
    },

    ProtectTacticalRoute: function(pContext, pReport) {
        if(!pContext || !pContext.Tactical || !pContext.Tactical.dryRoutes)
            return 0;
        if(pContext.Profile && pContext.Profile.PreserveDryTacticalRoutes === false)
            return 0;

        return this.ProtectTacticalRoutePath(pContext, pContext.TacticalRoutePath || [], pReport, null);
    },

    TeamSpawns: function(pContext) {
        var teams = [];
        var placements = pContext.Placements.teams || [];

        for(var index = 0; index < placements.length; ++index) {
            if(placements[index].point)
                teams.push(placements[index].point);
        }

        if(teams.length >= 2)
            return teams;

        placements = pContext.Placements.players || [];
        for(var playerIndex = 0; playerIndex < placements.length; ++playerIndex) {
            if(placements[playerIndex].point)
                teams.push(placements[playerIndex].point);
        }

        return teams;
    },

    DistanceToNearestPoint: function(pPoint, pPoints) {
        var best = null;

        for(var index = 0; index < pPoints.length; ++index) {
            var distance = MapGen.Metrics.Distance(pPoint, pPoints[index]);
            if(best === null || distance < best)
                best = distance;
        }

        return best === null ? 0 : best;
    },

    DistanceSpreadAcceptable: function(pLeft, pRight, pMaxDelta, pMaxRatio) {
        var delta = Math.abs(pLeft - pRight);
        var average = (pLeft + pRight) / 2;

        if(delta <= pMaxDelta)
            return true;
        if(average <= 0)
            return delta <= pMaxDelta;

        return (delta / average) <= pMaxRatio;
    },

    MultiplayerFairness: function(pContext, pReport, pRules) {
        var teams = this.TeamSpawns(pContext);

        if(teams.length < 2) {
            this.Fail(pReport, "multiplayer_missing_team_spawns", true);
            return;
        }

        var teamA = teams[0];
        var teamB = teams[1];
        var spawnDistance = MapGen.Metrics.Distance(teamA, teamB);
        var minDistance = pRules.MinimumTeamDistance || pContext.Profile.MinimumTeamDistance ||
            Math.max(18, Math.floor(Math.min(pContext.Width, pContext.Height) * 0.36));
        var maxDistance = pRules.MaximumTeamDistance || pContext.Profile.MaximumTeamDistance ||
            Math.floor(Math.sqrt((pContext.Width * pContext.Width) + (pContext.Height * pContext.Height)) * 0.88);

        if(spawnDistance < minDistance)
            this.Fail(pReport, "multiplayer_team_spawns_too_close", true);
        if(spawnDistance > maxDistance)
            this.Fail(pReport, "multiplayer_team_spawns_too_far", false);
        if(!this.CanReach(pContext, teamA, teamB))
            this.Fail(pReport, "multiplayer_team_spawns_disconnected", true);
        if(!this.ShortestDryPath(pContext, teamA, teamB, null))
            this.Fail(pReport, "multiplayer_team_spawns_no_dry_route", false);

        this.MultiplayerTeamSpawnPadsDry(pContext, pReport, teams);
        this.MultiplayerPickupFairness(pContext, pReport, teamA, teamB);
        this.MultiplayerObjectiveFairness(pContext, pReport, teamA, teamB);
        this.MultiplayerCrossingFairness(pContext, pReport, teamA, teamB);
    },

    MultiplayerTeamSpawnOffsets: [
        { x: -1, y: -1 },
        { x: 0, y: -1 },
        { x: 1, y: -1 },
        { x: -1, y: 0 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: -1, y: 1 },
        { x: 0, y: 1 },
        { x: 1, y: 1 }
    ],

    MultiplayerTeamSpawnPadsDry: function(pContext, pReport, pTeams) {
        var teams = pTeams || [];
        for(var teamIndex = 0; teamIndex < teams.length; ++teamIndex) {
            var team = teams[teamIndex];
            if(!team)
                continue;

            for(var offsetIndex = 0; offsetIndex < this.MultiplayerTeamSpawnOffsets.length; ++offsetIndex) {
                var offset = this.MultiplayerTeamSpawnOffsets[offsetIndex];
                var point = { x: team.x + offset.x, y: team.y + offset.y };
                if(!this.IsDryWalkable(pContext, point.x, point.y)) {
                    this.Fail(
                        pReport,
                        "multiplayer_team_spawn_pad_not_dry:" + teamIndex + ":" + point.x + "," + point.y,
                        true
                    );
                    break;
                }
            }
        }
    },

    RouteDistanceDry: function(pContext, pStart, pEnd) {
        var path = this.ShortestDryPath(pContext, pStart, pEnd, null);
        return path ? Math.max(0, path.length - 1) : 0x7FFFFFFF;
    },

    MultiplayerPickupFairness: function(pContext, pReport, pTeamA, pTeamB) {
        var pickups = pContext.Placements.pickups || [];
        var maxDelta = pContext.Profile.PickupFairnessMaxDelta || 10;
        var maxRatio = pContext.Profile.PickupFairnessMaxRatio || 0.35;

        for(var index = 0; index < pickups.length; ++index) {
            var pickup = pickups[index];
            if(!pickup.point)
                continue;
            if(pickup.role !== "contested")
                continue;

            var distanceA = this.RouteDistanceDry(pContext, pTeamA, pickup.point);
            var distanceB = this.RouteDistanceDry(pContext, pTeamB, pickup.point);

            if(distanceA >= 0x7FFFFFFF || distanceB >= 0x7FFFFFFF) {
                this.Fail(pReport, "multiplayer_pickup_unreachable:" + (pickup.role || index), true);
                continue;
            }

            if(!this.DistanceSpreadAcceptable(distanceA, distanceB, maxDelta, maxRatio))
                this.Fail(pReport, "multiplayer_pickup_unfair:" + (pickup.role || index), false);
        }
    },

    MultiplayerObjectiveFairness: function(pContext, pReport, pTeamA, pTeamB) {
        var objectives = pContext.Placements.objectives || [];
        var prisoner = null;
        var extractionA = null;
        var extractionB = null;
        var maxDelta = pContext.Profile.ObjectiveFairnessMaxDelta || 14;
        var maxRatio = pContext.Profile.ObjectiveFairnessMaxRatio || 0.40;

        for(var index = 0; index < objectives.length; ++index) {
            var objective = objectives[index];
            if(!objective.point)
                continue;
            if(objective.template === "prisoner")
                prisoner = objective.point;
            else if(objective.role === "team_a_extraction")
                extractionA = objective.point;
            else if(objective.role === "team_b_extraction")
                extractionB = objective.point;
        }

        if(!prisoner)
            return;

        var teamAToPrisoner = this.RouteDistanceDry(pContext, pTeamA, prisoner);
        var teamBToPrisoner = this.RouteDistanceDry(pContext, pTeamB, prisoner);

        if(teamAToPrisoner >= 0x7FFFFFFF || teamBToPrisoner >= 0x7FFFFFFF) {
            this.Fail(pReport, "multiplayer_prisoner_unreachable", true);
            return;
        }

        if(!this.DistanceSpreadAcceptable(teamAToPrisoner, teamBToPrisoner, maxDelta, maxRatio))
            this.Fail(pReport, "multiplayer_prisoner_route_unfair", false);

        if(extractionA && extractionB) {
            var prisonerToA = this.RouteDistanceDry(pContext, prisoner, extractionA);
            var prisonerToB = this.RouteDistanceDry(pContext, prisoner, extractionB);

            if(prisonerToA >= 0x7FFFFFFF || prisonerToB >= 0x7FFFFFFF) {
                this.Fail(pReport, "multiplayer_extraction_unreachable", true);
                return;
            }

            if(!this.DistanceSpreadAcceptable(prisonerToA, prisonerToB, maxDelta, maxRatio))
                this.Fail(pReport, "multiplayer_extraction_route_unfair", false);
        }
    },

    MultiplayerCrossingFairness: function(pContext, pReport, pTeamA, pTeamB) {
        if(!MapGen.Terrain.Water.HasCrossableRiver(pContext))
            return;
        if(!pContext.Crossings.length) {
            this.Fail(pReport, "multiplayer_river_without_crossing", true);
            return;
        }

        var distanceA = this.DistanceToNearestPoint(pTeamA, pContext.Crossings);
        var distanceB = this.DistanceToNearestPoint(pTeamB, pContext.Crossings);
        var maxDelta = pContext.Profile.CrossingFairnessMaxDelta || 12;
        var maxRatio = pContext.Profile.CrossingFairnessMaxRatio || 0.35;

        if(!this.DistanceSpreadAcceptable(distanceA, distanceB, maxDelta, maxRatio))
            this.Fail(pReport, "multiplayer_crossing_distance_unfair", false);
    },

    RepairActions: function(pContext) {
        var actions = [];

        for(var index = 0; index < pContext.Log.length; ++index) {
            if(pContext.Log[index].indexOf("Repair ") === 0)
                actions.push(pContext.Log[index]);
        }

        return actions;
    },

    DebugDump: function(pContext, pReport) {
        return {
            seed: pContext.Seed,
            attempt: pContext.Attempt,
            profile: pContext.Profile.Name,
            replay: {
                mode: pContext.Placements.teams && pContext.Placements.teams.length ? "multiplayer" : "campaign",
                seed: pContext.Seed,
                profileName: pContext.Profile.Name,
                attempt: pContext.Attempt
            },
            size: {
                width: pContext.Width,
                height: pContext.Height
            },
            ok: pReport.ok,
            fatal: pReport.fatal,
            reasons: pReport.reasons.slice(0),
            warnings: pReport.warnings.slice(0),
            repairPasses: pContext.RepairPasses || 0,
            repairStopped: !!pContext.RepairStopped,
            criticalPoints: (pContext.CriticalPoints || []).slice(0),
            routeSitePlan: pContext.RouteSitePlan || null,
            campaignFlowPlan: pContext.CampaignFlowPlan || null,
            connectivityNodes: pContext.ConnectivityNodes ? pContext.ConnectivityNodes.length : 0,
            encounterPlan: pContext.EncounterPlan || null,
            tactical: pReport.tactical || pContext.Tactical || null,
            tacticalCover: pContext.TacticalCover || null,
            openAreaBreakup: pContext.OpenAreaBreakup || null,
            landMasses: pReport.metrics ? pReport.metrics.LandMasses : null,
            waterShape: pReport.metrics ? pReport.metrics.WaterShape : null,
            counts: pReport.metrics ? pReport.metrics.Counts : {},
            coverage: pReport.metrics ? pReport.metrics.Coverage : {},
            placements: pReport.metrics ? pReport.metrics.Placements.counts : {}
        };
    },

    CriticalPointsConnected: function(pContext) {
        if(!pContext.CriticalPoints || pContext.CriticalPoints.length < 2)
            return true;

        for(var index = 1; index < pContext.CriticalPoints.length; ++index) {
            if(!this.CanReach(pContext, pContext.CriticalPoints[0], pContext.CriticalPoints[index]))
                return false;
        }

        return true;
    },

    CanReach: function(pContext, pStart, pEnd) {
        if(!pContext || !pStart || !pEnd)
            return false;

        var nativeResult = this.TryNativeCanReach(pContext, pStart, pEnd);
        if(nativeResult.handled)
            return nativeResult.reached;

        var stats = this.PathStats(pContext);
        var statsStart = stats ? (new Date()).getTime() : 0;
        var expanded = 0;
        var pushed = 0;
        var maxQueue = 0;
        var visited = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
        var queue = [{ x: pStart.x, y: pStart.y }];
        var queueHead = 0;
        var directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        pushed = 1;
        maxQueue = 1;

        if(!MapGen.Metrics.IsWalkable(pContext, pStart.x, pStart.y)) {
            if(stats) this.RecordCanReachStats(pContext, false, expanded, pushed, maxQueue, statsStart);
            return false;
        }
        if(!MapGen.Metrics.IsWalkable(pContext, pEnd.x, pEnd.y)) {
            if(stats) this.RecordCanReachStats(pContext, false, expanded, pushed, maxQueue, statsStart);
            return false;
        }

        visited[pStart.x][pStart.y] = 1;

        while(queueHead < queue.length) {
            var current = queue[queueHead++];
            ++expanded;
            if(current.x == pEnd.x && current.y == pEnd.y) {
                if(stats) this.RecordCanReachStats(pContext, true, expanded, pushed, maxQueue, statsStart);
                return true;
            }

            for(var index = 0; index < directions.length; ++index) {
                var nx = current.x + directions[index][0];
                var ny = current.y + directions[index][1];

                if(nx < 0 || ny < 0 || nx >= pContext.Width || ny >= pContext.Height)
                    continue;
                if(visited[nx][ny])
                    continue;
                if(!MapGen.Metrics.IsWalkable(pContext, nx, ny))
                    continue;

                visited[nx][ny] = 1;
                queue.push({ x: nx, y: ny });
                ++pushed;
                if(queue.length - queueHead > maxQueue)
                    maxQueue = queue.length - queueHead;
            }
        }

        if(stats) this.RecordCanReachStats(pContext, false, expanded, pushed, maxQueue, statsStart);
        return false;
    }
};
