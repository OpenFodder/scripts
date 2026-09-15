var MapGen = MapGen || {};
MapGen.Integration = MapGen.Integration || {};

(function(pIntegration) {
    pIntegration.ApplyContextToSettings = function(pContext) {
        if(!pContext)
            return;

        Settings.Width = pContext.Width;
        Settings.Height = pContext.Height;
        Settings.TerrainType = pContext.Profile.TerrainType;
        Settings.TerrainTypeSub = pContext.Profile.TerrainTypeSub;
        if(Settings.ApplyMapGenAggression)
            Settings.ApplyMapGenAggression(pContext);

        if(pContext.Profile && pContext.Profile.GeneratorCore === "official_grammar" &&
            typeof Objectives !== "undefined" && Settings.setObjectives) {
            var intent = pContext.GrammarPlan && pContext.GrammarPlan.intent ?
                pContext.GrammarPlan.intent : {};
            var liveLabel = String(pContext.Profile.GrammarLiveObjectiveLabel ||
                intent.objectiveLabel || pContext.Profile.GrammarObjectiveLabel || "");

            switch(liveLabel) {
                case "enemy_heavy":
                    Settings.setObjectives([Objectives.KillAllEnemy]);
                    break;

                case "civilian_delivery":
                    Settings.setObjectives([Objectives.GetCivilianHome]);
                    break;

                case "rescue_hostages":
                    Settings.setObjectives([Objectives.RescueHostages]);
                    break;

                case "destroy_buildings":
                case "objective_unknown":
                default:
                    Settings.setObjectives([Objectives.DestroyEnemyBuildings]);
                    break;
            }
        }
    };

    pIntegration.StoreContext = function(pContext) {
        Session.MapGenContext = pContext || null;
        return pContext;
    };

    // Architecture v3: per-owner cell counts from the ownership grid, so the
    // reserve-then-fill model is observable in the context dump (verification +
    // tracking through later phases). Returns null pre-grid for safety.
    pIntegration.OwnershipSummary = function(pContext) {
        if(!pContext || !pContext.Layers || !pContext.Layers.owner)
            return null;
        // This summarizes pContext.Layers.owner, so always decode with the
        // Layers enum. Intent.Owner has different values (for example TREE=6
        // versus Layers.Owner.TREE=2) and is explicitly translated by
        // Intent.Composite before reaching this grid.
        var O = (MapGen.Layers && MapGen.Layers.Owner) || {};
        // Build the names array from the live Owner enum so it stays correct
        // when the enum is renumbered (e.g. Slice 0 of [[mapgen_cliff_edge_to_edge]]
        // promoted CLIFF rank 5→8 and shuffled CLEARING/ROUTE/STRUCTURE
        // accordingly). Hard-coding the names array — as this function did
        // before 2026-06-16 — silently mislabels every sidecar after a
        // renumber. The bug surfaced when CliffOwnerVsRenderAudit.py read
        // ownership.cliff on every ice seed and saw values 84..565 even when
        // the seed rendered ZERO cliff tiles — because index 5 had become
        // CLEARING but the names array still said "cliff". Verdict was wrong;
        // false-positive INVESTIGATE_FURTHER on render-leak hypothesis.
        var names = [];
        for(var key in O) {
            if(!O.hasOwnProperty(key)) continue;
            var rank = O[key] | 0;
            // Lower-case the enum key to match the prior wire format ("cliff"
            // not "CLIFF"). Sidecar consumers expect the lowercase form.
            names[rank] = key.toLowerCase();
        }
        var counts = [];
        for(var n = 0; n < names.length; ++n) counts.push(0);
        MapGen.Layers.ForEach(pContext.Layers.owner, function(pValue) {
            var v = pValue | 0;
            if(v >= 0 && v < counts.length)
                ++counts[v];
        });
        var summary = {};
        for(var i = 0; i < names.length; ++i) {
            if(names[i]) summary[names[i]] = counts[i];
        }
        return summary;
    };

    pIntegration.SummarizePathRoles = function(pPaths) {
        var summary = {};
        var paths = pPaths || [];

        for(var index = 0; index < paths.length; ++index) {
            var path = paths[index] || {};
            var role = path.role || "path";
            if(!summary[role])
                summary[role] = { count: 0, points: 0 };
            ++summary[role].count;
            summary[role].points += path.points ? path.points.length : 0;
        }

        return summary;
    };

    pIntegration.SummarizeValidationItems = function(pItems) {
        var items = pItems || [];
        var summary = [];

        for(var index = 0; index < items.length; ++index) {
            var item = items[index] || {};
            summary.push({
                id: item.id || "",
                status: item.status || "",
                severity: item.severity || "",
                reason: item.reason || "",
                source: item.source || "",
                details: item.details || {}
            });
        }

        return summary;
    };

    pIntegration.SummarizeFailures = function(pItems) {
        var items = pItems || [];
        var failures = [];

        for(var index = 0; index < items.length; ++index) {
            var item = items[index] || {};
            if(item.status !== "fail" && item.status !== "outlier")
                continue;

            failures.push({
                id: item.id || "",
                status: item.status || "",
                reason: item.reason || item.id || "",
                source: item.source || "",
                details: item.details || {}
            });
        }

        return failures;
    };

    pIntegration.GrammarValidationSummary = function(pPlan) {
        var validation = pPlan && pPlan.validation ? pPlan.validation : null;
        if(!validation)
            return null;

        return {
            status: validation.status || "",
            validationMode: validation.validationMode || "",
            counts: validation.counts || {},
            targetFamilies: validation.targetFamilies || [],
            hardGates: this.SummarizeValidationItems(validation.hardGates),
            failingHardGates: this.SummarizeFailures(validation.hardGates),
            targetPackStyleScores: this.SummarizeValidationItems(validation.styleScores),
            outlierStyleScores: this.SummarizeFailures(validation.styleScores),
            stageOutliers: validation.stageOutliers || [],
            outlierReasons: validation.outlierReasons || []
        };
    };

    pIntegration.ReachabilitySummary = function(pContext, pValidation) {
        var metrics = pValidation && pValidation.metrics ? pValidation.metrics : pContext.Metrics;
        var counts = metrics && metrics.Counts ? metrics.Counts : {};
        var coverage = metrics && metrics.Coverage ? metrics.Coverage : {};
        var plan = pContext.GrammarPlan || {};
        var routePlan = plan.routePlan || {};
        var subcell = routePlan.subcellValidation || {};

        return {
            walkableComponents: counts.walkableComponents || 0,
            totalWalkable: counts.totalWalkable || 0,
            largestWalkableComponent: coverage.largestWalkableComponent || 0,
            criticalPointCount: pContext.CriticalPoints ? pContext.CriticalPoints.length : 0,
            connectivityNodeCount: pContext.ConnectivityNodes ? pContext.ConnectivityNodes.length : 0,
            routePathCells: routePlan.routePath ? routePlan.routePath.length : 0,
            routeLegs: routePlan.legs ? routePlan.legs.length : 0,
            subcellValidation: subcell,
            tactical: pValidation ? pValidation.tactical || pContext.Tactical || null : pContext.Tactical || null
        };
    };

    pIntegration.MaterializationSummary = function(pContext) {
        var plan = pContext.GrammarPlan || {};
        var materialization = plan.materialization || {};
        var live = pContext.LiveMaterialization || {};

        return {
            mode: live.materializationMode || materialization.materializationMode || "",
            terrainMode: live.terrainMode || materialization.terrainMode || "",
            source: live.source || materialization.source || "",
            liveConstructionOwner: live.liveConstructionOwner || "",
            spriteCount: live.spriteCount || 0,
            spriteGroups: live.spriteGroups || null,
            featureRecipeCount: materialization.featureRecipes ? materialization.featureRecipes.length : 0,
            transitionRecipeCount: materialization.transitionRecipes ? materialization.transitionRecipes.length : 0,
            routePhaseRecipeCount: materialization.routePhaseRecipes ? materialization.routePhaseRecipes.length : 0,
            postpassRecipes: materialization.postpassRecipes || [],
            quarantinedPostpasses: live.quarantinedPostpasses || []
        };
    };

    pIntegration.RenderedArtifactSummary = function(pContext) {
        var rendered = pContext.RenderedMap || null;
        if(!rendered)
            return null;

        return {
            backend: rendered.Backend || "",
            terrainType: rendered.TerrainType,
            terrainTypeSub: rendered.TerrainTypeSub,
            smoothing: rendered.Smoothing || null,
            counts: rendered.Counts || null
        };
    };

    pIntegration.LiveValidationSummary = function(pLiveValidation) {
        var live = pLiveValidation || null;
        if(!live)
            return null;

        return {
            ok: !!live.ok,
            skipped: !!live.skipped,
            mode: live.mode || "",
            reason: live.reason || "",
            reasons: live.reasons || [],
            warnings: live.warnings || [],
            counts: live.counts || {},
            objectiveSupport: live.objectiveSupport || null
        };
    };

    pIntegration.AcceptedSeedReport = function(pContext, pRequestedSeed) {
        var requestedSeed = pRequestedSeed !== undefined ? pRequestedSeed : pContext.Seed;
        var validation = pContext.Validation || null;
        var retry = pContext.Retry || null;

        return {
            schema: "mapgen_accepted_seed_report_v1",
            requestedSeed: requestedSeed,
            selectedSeed: pContext.Seed,
            selectedAttempt: pContext.Attempt || 0,
            profile: pContext.Profile ? pContext.Profile.Name : "",
            compositionVariant: pContext.Profile ? pContext.Profile.CompositionVariant || "" : "",
            terraceCover: pContext.TerraceCover || null,
            layoutTemplate: pContext.Profile ? pContext.Profile.LayoutTemplate || "" : "",
            terrainType: pContext.Profile ? pContext.Profile.TerrainType : null,
            terrainTypeSub: pContext.Profile ? pContext.Profile.TerrainTypeSub : null,
            planValidation: validation ? {
                ok: !!validation.ok,
                fatal: !!validation.fatal,
                score: retry ? retry.selectedScore : null,
                reasons: validation.reasons || [],
                warnings: validation.warnings || [],
                screenPacing: validation.metrics ? validation.metrics.ScreenPacing || null : null,
                gameplayUtilization: validation.metrics ?
                    validation.metrics.GameplayUtilization || null : null
            } : null,
            reachability: this.ReachabilitySummary(pContext, validation),
            grammarValidation: this.GrammarValidationSummary(pContext.GrammarPlan),
            materialization: this.MaterializationSummary(pContext),
            liveMapSptValidation: this.LiveValidationSummary(pContext.LiveValidation),
            renderedArtifact: this.RenderedArtifactSummary(pContext),
            retry: retry ? {
                totalAttempts: retry.totalAttempts,
                selectedAttempt: retry.selectedAttempt,
                selectedSeed: retry.selectedSeed,
                selectedScore: retry.selectedScore,
                selectedFingerprintKey: retry.selectedFingerprintKey
            } : null
        };
    };

    pIntegration.WriteContextMetadata = function(pContext, pRequestedSeed) {
        if(typeof FileIO === "undefined" || !pContext || !this.DiagnosticsEnabled(pContext))
            return;

        try {
            var requestedSeed = pRequestedSeed !== undefined ? pRequestedSeed : pContext.Seed;
            var retry = pContext.Retry || null;
            // P1.18 (D6 + W1.5 Metadata.js KWC): consolidate the dual metrics
            // fallback into a single resolved-metrics local. Prior code had
            // `pContext.Validation.metrics || pContext.Metrics` here at line 283
            // and `pContext.Metrics.ScreenPacing` at line 339 — two paths could
            // diverge if v3 moved ScreenPacing under Validation.
            var metrics = pContext.Validation && pContext.Validation.metrics ? pContext.Validation.metrics : pContext.Metrics;
            // P1.18 PHASE 2 PORT TARGET: payload is the v1 sidecar shape. v3
            // adds a schema version field at the top (when MapGen.Intent is
            // loaded, payload.schema = 2 indicates v3 IntentMap-shape ownership;
            // legacy schema = 1 indicates v1 Owner-grid shape). Downstream
            // Python probes (CliffOwnerVsRenderAudit.py et al) read
            // payload.ownership.* keys; v3 reshape changes the key set.
            // For Phase 1 we keep the schema implicit (v1 shape; absent
            // schema field reads as 1). Phase 2 promotes schema = 2 once
            // Concept-stamp authoring lands.
            // Phase 2 v3 trace block. Present iff Pipeline.RunCampaignAttempt
            // populated pContext.ConceptId (i.e. v3 path was the producer).
            // Per v3.4 §11 Phase 2 acceptance "concept distribution", consumers
            // (IceBatchAcceptance.ps1, telemetry probes) read payload.concept
            // to slice runs by Concept fired.
            var v3Trace = pContext.ConceptId ? {
                concept: pContext.ConceptId,
                fallback: !!pContext.ConceptIsFallback,
                authorReason: pContext.AuthorResult && !pContext.AuthorResult.ok ?
                    pContext.AuthorResult.reason : null,
                drift: pContext.RenderDrift || null,
                // Phase 3 P3.2: post-commit drift queries Map.TileTerrainFeature
                // (engine collision oracle) and is the authoritative report.
                driftCommitted: pContext.RenderDriftCommitted || null,
                renderedHard: pContext.RenderedHardReport || null,
                finalRenderedHard: pContext.FinalRenderedHardReport || null,
                intentStyleContract: pContext.IntentStyleContract || null,
                terraceCover: pContext.TerraceCover || null,
                jumpRamps: pContext.IntentJumpRamps || null,
                finaliseRenderedMap: pContext.FinaliseRenderedMapReport || null
            } : null;
            var payload = {
                schema: 3,
                generatorVersion: "accepted-materialization-v1",
                scriptRuntime: typeof Engine !== "undefined" && Engine.scriptRuntime ?
                    Engine.scriptRuntime() : "duktape",
                scriptRuntimeLibrary: typeof Engine !== "undefined" && Engine.scriptRuntimeLibrary ?
                    Engine.scriptRuntimeLibrary() : "",
                materialized: !!pContext.Materialized,
                attemptStage: pContext.AttemptStage || "plan",
                runtimeValidation: pContext.RuntimeValidation || null,
                planValidationBeforeMaterialization: pContext.PlanValidation || null,
                driftValidation: pContext.DriftValidation || null,
                structureRender: pContext.StructureRenderStats || null,
                concept:    v3Trace ? v3Trace.concept : null,
                conceptFallback: v3Trace ? v3Trace.fallback : null,
                v3:         v3Trace,
                requestedSeed: requestedSeed,
                selectedSeed: pContext.Seed,
                selectedAttempt: pContext.Attempt || 0,
                width: pContext.Width,
                height: pContext.Height,
                profile: pContext.Profile ? pContext.Profile.Name : "",
                compositionVariant: pContext.Profile ? pContext.Profile.CompositionVariant || "" : "",
                terraceCover: pContext.TerraceCover || null,
                layoutTemplate: pContext.Profile ? pContext.Profile.LayoutTemplate || "" : "",
                profileKnobOwnership: pContext.Profile ? pContext.Profile.ProfileKnobOwnership || null : null,
                terrainType: pContext.Profile ? pContext.Profile.TerrainType : null,
                terrainTypeSub: pContext.Profile ? pContext.Profile.TerrainTypeSub : null,
                runtimeSettings: {
                    width: Settings.Width,
                    height: Settings.Height,
                    terrainType: Settings.TerrainType,
                    terrainTypeSub: Settings.TerrainTypeSub,
                    aggression: {
                        min: Settings.Aggression ? Settings.Aggression.Min : 0,
                        max: Settings.Aggression ? Settings.Aggression.Max : 0
                    },
                    objectives: Settings.Objectives ? Settings.Objectives.slice(0) : []
                },
                anchors: pContext.Anchors || {},
                metrics: metrics ? {
                    counts: metrics.Counts || null,
                    coverage: metrics.Coverage || null,
                    clearings: metrics.Clearings || null,
                    paths: metrics.Paths || null,
                    landMasses: metrics.LandMasses || null,
                    screenPacing: metrics.ScreenPacing || null,
                    gameplayUtilization: metrics.GameplayUtilization || null
                } : null,
                pathRoles: this.SummarizePathRoles(pContext.Paths),
                gameplayTopology: pContext.IntentTopologyPlan || null,
                gameplayPlan: pContext.GameplayPlan || null,
                actorRelocations: pContext.ActorRelocations || 0,
                gameplayReservations: MapGen.Layout.Reservations.Summary(pContext),
                terrainSpace: pContext.TerrainSpace ? {
                    landCells: pContext.TerrainSpace.landCells,
                    shoreCells: pContext.TerrainSpace.shoreCells,
                    optionalCoverCells: pContext.TerrainSpace.optionalCoverCells
                } : null,
                plannedSites: pContext.PlannedSites || [],
                routeSitePlan: pContext.RouteSitePlan || null,
                routeArchetype: MapGen.Layout && MapGen.Layout.RouteArchetypes &&
                    MapGen.Layout.RouteArchetypes.Summary ?
                        MapGen.Layout.RouteArchetypes.Summary(pContext) :
                        null,
                continent: pContext.Continent || null,
                campaignFlowPlan: pContext.CampaignFlowPlan || null,
                encounterPlan: pContext.EncounterPlan || null,
                encounterRegionPlan: pContext.EncounterRegionPlan || null,
                objectiveSupport: pContext.ObjectiveSupport || null,
                grammarPlan: pContext.GrammarPlan || null,
                acceptedSeedReport: this.AcceptedSeedReport(pContext, requestedSeed),
                liveValidation: pContext.LiveValidation || null,
                structurePolicy: pContext.LiveValidation &&
                    pContext.LiveValidation.counts ?
                        pContext.LiveValidation.counts.structurePolicy || null :
                        null,
                intentProjection: pContext.IntentProjection || null,
                liveStructurePlacements: pContext.LiveStructurePlacements || null,
                liveEnemyPlacements: pContext.LiveEnemyPlacements || null,
                livePickupPlacements: pContext.LivePickupPlacements || null,
                finalStructureTileReport: pContext.FinalStructureTileReport || null,
                finalStructureSpriteReport: pContext.FinalStructureSpriteReport || null,
                regionIntents: pContext.RegionIntents || null,
                iceTreeStyle: pContext.IceTreeStyle || null,
                clearings: pContext.Clearings || [],
                forest: {
                    coverBuildError: pContext.IntentCoverBuildError || null,
                    renderedCeilingRepair: pContext.IntentRenderedTreeCeilingRepair || null,
                    thinRunPrune: pContext.IceTreeThinRunPrune || null,
                    slenderFingerPrune: pContext.IceTreeSlenderFingerPrune || null,
                    slenderIslandPrune: pContext.IceTreeSlenderIslandPrune || null,
                    runtimeProfile: pContext.Profile ? {
                        style: pContext.Profile.GrammarIceLayoutStyle ||
                            pContext.Profile.ForcedIceLayoutStyle || "",
                        patchAndGrow: pContext.Profile.ForestPatchAndGrow,
                        jungleMazeFill: pContext.Profile.JungleMazeForestFill,
                        treeCoverage: pContext.Profile.TreeCoverage,
                        minTreeCoverage: pContext.Profile.MinTreeCoverage,
                        maxTreeCoverage: pContext.Profile.MaxTreeCoverage,
                        forestSeedDensity: pContext.Profile.ForestSeedDensity,
                        forestSeedEdgeClearance:
                            pContext.Profile.ForestSeedEdgeClearance,
                        forestSeedWaterClearance:
                            pContext.Profile.ForestSeedWaterClearance
                    } : null,
                    patches: pContext._forestPatches || null,
                    sectorFill: pContext._sectorForestFill || null,
                    carvedFill: pContext._carvedForestFill || null,
                    mazeFill: pContext._mazeForestFill || null,
                    coverBudget: pContext.IntentCoverBudget || null,
                    mapScaleTuning: pContext.IceMapScaleTuning || null,
                    postPlacementCover: pContext.PostPlacementCover || null,
                    routeExposureBreakup: pContext.IntentRouteExposureBreakup || null,
                    routeViewportCover: pContext.IntentRouteViewportCover || null,
                    openFieldScreens: pContext.IntentOpenFieldScreens || null,
                    openAreaBreakup: pContext.OpenAreaBreakup || null
                },
                perimeterCover: {
                    generated: pContext._perimeterCover || null,
                    runBreakup: pContext._perimeterWalkableRunBreakup || null
                },
                ownership: this.OwnershipSummary(pContext),
                screenPacing: (pContext.Metrics && pContext.Metrics.ScreenPacing) || null,
                gameplayUtilization: (pContext.Metrics &&
                    pContext.Metrics.GameplayUtilization) || null,
                idempotency: pContext.IdempotencyResult || null,
                pathStats: pContext.PathStats || null,
                validationPathStats: pContext.ValidationPathStats || null,
                timings: (pContext.ProfileTimings && pContext.Timings) ? pContext.Timings : null,
                retry: retry ? {
                    totalAttempts: retry.totalAttempts,
                    selectedAttempt: retry.selectedAttempt,
                    selectedSeed: retry.selectedSeed,
                    selectedScore: retry.selectedScore,
                    selectedFingerprintKey: retry.selectedFingerprintKey,
                    attempts: retry.attempts
                } : null
            };
            var file = new FileIO("mapgen_context_" + requestedSeed + ".json", false);
            if(file.isOpen()) {
                file.writeLine(JSON.stringify(payload));
                file.close();
            }
        } catch(e) {
            MapGen.Context.AddLog(pContext, "Failed to write mapgen context metadata: " + e);
        }
    };

    pIntegration.RenderSummaryLine = function(pRendered, pSmoothing) {
        var details = [];
        var showFullSmoothingBreakdown = pRendered.Backend === "ice_bitmask" ||
            pRendered.Backend === "ice_profiled";

        if(showFullSmoothingBreakdown || pSmoothing.terrainTransitionTiles)
            details.push("terrain=" + pSmoothing.terrainTransitionTiles);
        if(showFullSmoothingBreakdown || pSmoothing.profiledTileCorrections)
            details.push("profiled=" + pSmoothing.profiledTileCorrections);
        if(showFullSmoothingBreakdown || pSmoothing.coverShapeTiles)
            details.push("cover=" + pSmoothing.coverShapeTiles);
        if(pSmoothing.finalRouteEdgeCover && pSmoothing.finalRouteEdgeCover.stamped)
            details.push("routeCover=" + pSmoothing.finalRouteEdgeCover.stamped);
        if(showFullSmoothingBreakdown || pSmoothing.featureShapeTiles)
            details.push("features=" + pSmoothing.featureShapeTiles);

        return "MapGen render " + pRendered.Backend +
            " char=" + pSmoothing.charSmoothChanges +
            " fixes=" + pSmoothing.charFixes +
            " transitions=" + pSmoothing.transitionTiles +
            (details.length ? " [" + details.join(" ") + "]" : "") +
            " trees=" + pSmoothing.treeTiles +
            " protected=" + pSmoothing.protectedTiles +
            " polish=" + pSmoothing.polishTiles;
    };

    pIntegration.PrintValidation = function(pContext) {
        if(!pContext || !pContext.Validation)
            return;

        var validation = pContext.Validation;
        var prefix = "MapGen " + pContext.Profile.Name + " seed " + pContext.Seed + " attempt " + pContext.Attempt;
        var rendered = pContext.RenderedMap;
        var smoothing = rendered && rendered.Smoothing ? rendered.Smoothing : null;

        if(validation.ok) {
            print(prefix + " passed validation");
            if(rendered && smoothing)
                print(this.RenderSummaryLine(rendered, smoothing));
            return;
        }

        print(prefix + " validation issues: " + validation.reasons.join(", "));
        if(rendered && smoothing)
            print(this.RenderSummaryLine(rendered, smoothing));
    };
})(MapGen.Integration);
