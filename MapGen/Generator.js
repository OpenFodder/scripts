var MapGen = MapGen || {};

// Phase 2 production dispatch. v3 is now the default for ice profiles;
// jungle/beach continue to flow through v1 (BuildBestCampaignPlan) until the
// jungle/beach Concepts land in Phase 4/5 per v3.4 §11. The MAPGEN_USE_V1
// emergency-rollback flag forces v1 even for ice — see
// MapGen.Intent.Pipeline.ShouldRouteV3.
//
// Phase 1's mapgen_intent_smoke.flag diagnostic gate has been retired. The
// IntentSmokeTest.ps1 harness moves to running the v3 path directly via
// pContext.Profile = grammar_ice (no flag required).

MapGen.GenerateCampaign = function(pOptions) {
    var options = pOptions || {};

    // Resolve a probe context to decide v3 vs v1 routing. The probe is
    // discarded; BuildBestCampaignPlan / BuildBestV3Campaign will Create
    // their own attempt contexts inside the retry harness.
    var probe = MapGen.Context.Create(options);
    probe.GameMode = probe.GameMode || MapGen.Context.GameModes.Campaign();

    if(MapGen.Intent && MapGen.Intent.Pipeline &&
        MapGen.Intent.Pipeline.ShouldRouteV3(probe)) {
        return MapGen.BuildBestV3Campaign(options, probe.GameMode);
    }

    var context = MapGen.BuildBestCampaignPlan(options);

    if(context.Validation && !context.Validation.ok && !options.RenderInvalid)
        return context;

    if(!options.CompleteAttempt)
        MapGen.Render.CreateMap(context, options.Map);
    return context;
};

// Phase 2 v3 retry harness. Mirrors BuildBest's structure but each attempt
// runs the Intent.Pipeline.RunCampaignAttempt path. Retry budget honours the
// profile's ValidationRetries; final attempt sets IsLastAttempt so the v3
// pipeline can suppress fatal early-rejection on the last try.
MapGen.BuildBestV3Campaign = function(pOptions, pGameMode) {
    var options = pOptions || {};
    var profileRetries = 0;

    if(!options.ValidationRetries && MapGen.Profiles && MapGen.Profiles.Resolve) {
        var probeRandom = MapGen.Random.CreateSeeded(options.Seed || 0);
        var profile = MapGen.Profiles.Resolve(options.ProfileName, options.Overrides, probeRandom);
        profileRetries = profile && profile.ValidationRetries ? profile.ValidationRetries : 0;
    }
    var attempts = options.Attempts || options.ValidationRetries ||
        profileRetries || MapGen.Profiles.Defaults.ValidationRetries;

    var lastContext = MapGen.Retry.Run({ Attempts: attempts, CompleteAttempt: options.CompleteAttempt }, function(pAttempt) {
        var attemptOptions = MapGen.CopyAttemptOptions(options, pAttempt);
        attemptOptions.IsLastAttempt = (pAttempt === attempts - 1);

        var attemptContext = MapGen.Context.Create(attemptOptions);
        attemptContext.GameMode = pGameMode || attemptContext.GameMode ||
            MapGen.Context.GameModes.Campaign();

        if(attemptContext.Profile && attemptContext.Profile.Validation &&
            !attemptContext.Profile.Validation.ok) {
            return MapGen.RejectCampaignPlan(
                attemptContext,
                MapGen.ProfileValidationReasons(attemptContext.Profile),
                "v3 generation rejected invalid profile"
            );
        }

        return MapGen.Intent.Pipeline.RunCampaignAttempt(attemptContext);
    });

    if(!lastContext) {
        return null;
    }
    if(lastContext.Validation && !lastContext.Validation.ok && !options.RenderInvalid) {
        return lastContext;
    }

    if(!options.CompleteAttempt)
        MapGen.Render.CreateMap(lastContext, options.Map);

    return lastContext;
};

MapGen.GenerateMultiplayer = function(pOptions) {
    var options = pOptions || {};
    var context = MapGen.BuildBestMultiplayerPlan(options);

    if(context.Validation && !context.Validation.ok && !options.RenderInvalid)
        return context;

    if(!options.CompleteAttempt)
        MapGen.Render.CreateMap(context, options.Map);
    return context;
};

MapGen.CopyAttemptOptions = function(pOptions, pAttempt) {
    var options = pOptions || {};
    var copy = {};
    var seed = options.Seed;

    for(var key in options) {
        if(options.hasOwnProperty(key))
            copy[key] = options[key];
    }

    copy.Attempt = pAttempt;

    if(seed === undefined && options.Map)
        seed = options.Map.seed;
    else if(seed === undefined && typeof Map !== "undefined")
        seed = Map.seed;
    if(seed === undefined)
        seed = 0;

    // Keep intent that should survive validation retries (notably the beach
    // terrain family) tied to the seed the caller actually requested. The
    // derived attempt seed can still vary course, placement and composition.
    copy.RequestedSeed = options.RequestedSeed !== undefined ?
        options.RequestedSeed : seed;
    copy.Seed = MapGen.Random.DeriveSeed(seed, pAttempt);

    return copy;
};

MapGen.ProfileValidationReasons = function(pProfile) {
    var validation = pProfile && pProfile.Validation;
    var errors = validation ? (validation.errors || []) : [];
    var reasons = [];
    var error;
    var index;

    for(index = 0; index < errors.length; ++index) {
        error = errors[index];
        if(typeof error === "string")
            reasons.push("profile_validation_failed:" + error);
        else
            reasons.push("profile_validation_failed:" + (error.key || "Profile") + ":" + (error.message || "invalid"));
    }

    if(!reasons.length)
        reasons.push("profile_validation_failed");

    return reasons;
};

MapGen.RejectCampaignPlan = function(pContext, pReasons, pLogMessage) {
    var context = pContext;

    context.Validation = {
        ok: false,
        fatal: true,
        seed: context.Seed,
        profile: context.Profile ? context.Profile.Name : "",
        attempt: context.Attempt || 0,
        reasons: pReasons || [],
        warnings: [],
        metrics: null,
        tactical: null,
        repairActions: [],
        log: context.Log.slice(0),
        debug: null
    };

    if(context.Profile && context.Profile.Validation)
        context.Validation.profileValidation = context.Profile.Validation;

    if(pLogMessage)
        MapGen.Context.AddLog(context, pLogMessage);

    return context;
};

// Each repair iteration costs a full Render.BuildTileLayer (~1.4s on ice) +
// re-validate. If the iteration didn't change the failure set, the next one
// won't either — repair is deterministic given fixed inputs and the inputs to
// the repair operations only change if the previous iteration actually fixed
// something. Compare the sorted reason list before/after; if identical, bail
// instead of burning more renders. Saves ~1.4s per stuck iteration on the
// failed attempts the retry framework has to grind through.
MapGen.ReportReasonsKey = function(pReport) {
    if(!pReport || !pReport.reasons)
        return "";
    var sorted = pReport.reasons.slice(0).sort();
    return sorted.join("\n");
};

MapGen.ValidateAndRepair = function(pContext, pRules) {
    // Early-rejection short-circuit: the EarlyValidateCoverage stage flagged
    // the attempt as doomed before Render. Emit a minimal Validation report
    // with the early reason; Retry.Score reads only Validation, so the attempt
    // still ranks comparably to a fully-validated reject (one big -100 reason
    // penalty, no metrics-based score bump). Skips Validate.Run + Metrics.Compute
    // + repair loop + final ProtectTacticalRoute, saving ~1-2s extra on top of
    // the Render skip.
    if(pContext.EarlyRejection) {
        var earlyReport = {
            ok: false,
            reasons: pContext.EarlyRejection.reasons || [pContext.EarlyRejection.reason],
            warnings: [],
            metrics: null
        };
        pContext.Validation = earlyReport;
        return earlyReport;
    }
    function validateProtected() {
        var result = MapGen.Validate.Run(pContext, pRules);
        if(result.ok && MapGen.Validate.ProtectTacticalRoute(pContext, result)) {
            MapGen.Render.BuildTileLayer(pContext);
            result = MapGen.Validate.Run(pContext, pRules);
        }
        return result;
    }
    // Route protection can change the rendered canopy. Its resulting coverage
    // failures must enter the same bounded repair loop as other failures.
    var report = validateProtected();
    var maxRepairPasses = pContext.Profile.MaxRepairPasses || 0;
    var repairPass = 0;
    var stalled = false;

    while(!report.ok && repairPass < maxRepairPasses && MapGen.Repair.Run(pContext, report)) {
        var reasonsBefore = MapGen.ReportReasonsKey(report);
        ++repairPass;
        pContext.RepairPasses = repairPass;
        if(!pContext.RepairCoverOnly && pRules && pRules.RequireConnectivityNodes && MapGen.Connectivity && MapGen.Connectivity.BuildPlacementNodes)
            MapGen.Connectivity.BuildPlacementNodes(pContext);
        if(!pContext.RepairCoverOnly)
            MapGen.Terrain.RefreshDerivedLayers(pContext);
        MapGen.Render.BuildTileLayer(pContext);
        report = validateProtected();
        if(pContext.RepairCoverOnly && pContext.RouteCoverRepair) {
            pContext.RouteCoverRepair.validation = {
                ok: report.ok,
                reasons: report.reasons.slice(0),
                exposure: pContext.Tactical ? pContext.Tactical.routeExposure : null
            };
        }
        if(MapGen.ReportReasonsKey(report) === reasonsBefore) {
            // Repair iteration produced an identical failure set — further
            // iterations will produce the same result. Skip the rest of the
            // budget; the retry framework will reseed and try again.
            MapGen.Context.AddLog(pContext, "Repair stalled (reasons unchanged) at pass " + repairPass);
            stalled = true;
            break;
        }
    }

    if(!report.ok && (stalled || repairPass >= maxRepairPasses) && maxRepairPasses > 0) {
        MapGen.Context.AddLog(pContext, stalled ? "Repair stopped (stalled)" : "Repair stopped after max passes");
        pContext.RepairStopped = true;
        // The trailing Validate.Run after exhausting the repair budget would
        // re-validate identical state — its output matches the report we
        // already have. Skip it.
    }


    return report;
};

// Shared validation thresholds applied to every materialized map. The
// campaign and multiplayer pipelines layer one extra mode-specific flag on top
// (RequireCampaignRouteSites vs RequireMultiplayerFairness).
MapGen.BaseValidationRules = function(pExtra) {
    var rules = {
        RequireReservedWalkable: true,
        MinimumLargestWalkableComponent: 0.25,
        RequireConnectivityNodes: true,
        RequireTacticalFlow: true,
        MinimumLanes: 1,
        MinimumChokepoints: 0,
        // Architecture v3 (P6): per-viewport interest pacing. Warn (Retry-score
        // penalty), not hard-fail, so big maps prefer livelier layouts. Originals
        // have ~0% empty screens; allow a little slack overall, none on-route.
        MaxDeadScreenFraction: 0.05,
        MaxRouteDeadScreenFraction: 0.0
    };
    if(pExtra) {
        for(var key in pExtra) {
            if(pExtra.hasOwnProperty(key))
                rules[key] = pExtra[key];
        }
    }
    return rules;
};

// Single table-driven pipeline runner shared by campaign and multiplayer. Each
// stage is { label, fn }; stages run in order wrapped in Context.Time, then the
// map is validated/repaired against pRules. The campaign and multiplayer
// divergence (one extra TerrainIntent stage, the Build* variant, and one
// validation flag) lives entirely in the two stage-list builders below — the
// load-bearing asymmetry (multiplayer must NOT run the grammar terrain pass)
// stays explicit.
MapGen.RunPipeline = function(pContext, pStages, pRules) {
    for(var index = 0; index < pStages.length; ++index) {
        (function(stage) {
            MapGen.Context.Time(pContext, stage.label, function() { stage.fn(pContext, pRules); });
        })(pStages[index]);
        if(pContext.EarlyRejection) break;
    }

    MapGen.Context.Time(pContext, pStages.ValidateLabel || "Validate", function() {
        MapGen.ValidateAndRepair(pContext, pRules);
    });

    return pContext;
};

// Architecture v3: ONE generation pipeline shared by campaign and multiplayer.
// Layout/terrain stages are mode-agnostic and defined once here; the ONLY
// mode-aware stages are Features and Encounters (sprite/objective placement),
// which dispatch on context.GameMode. The TerrainIntent stage owns jun_sub1
// beach (LiveBeachTerrain): its contour-shaped sand band is what the limited
// directional sub1 beach tiles can actually smooth — a generic Coast band
// cannot, so beach legitimately needs this bespoke pre-terrain pass. It no-ops
// for every non-beach profile, so it is safe in the shared list for both modes.
MapGen.PipelineStages = function() {
    return [
        { label: "Layout",        fn: function(c) { MapGen.Layout.Build(c); } },
        { label: "TerrainIntent", fn: function(c) { MapGen.Grammar.ApplyLiveTerrain(c); } },
        { label: "Connectivity",  fn: function(c) { MapGen.Connectivity.Build(c); } },
        { label: "TerrainFill",   fn: function(c) { MapGen.Grammar.FillBeachInteriorWater(c); } },
        { label: "RoutePlanPreflight", fn: function(c, rules) { MapGen.Layout.PreflightRoutePlan(c, rules); } },
        { label: "Terrain",       fn: function(c) {
            if(MapGen.Layout && MapGen.Layout.Rivers &&
                MapGen.Layout.Rivers.RestoreProfileRiver &&
                MapGen.Layout.Rivers.RestoreProfileRiver(c) > 0 &&
                MapGen.Terrain.RefreshDerivedLayers)
                MapGen.Terrain.RefreshDerivedLayers(c);
            if(c.Profile && c.Profile.Name === "grammar_jungle_river_crossing" &&
                (!c.Crossings || !c.Crossings.length) && MapGen.Repair &&
                MapGen.Repair.EnsureRiverCrossings) {
                MapGen.Repair.EnsureRiverCrossings(c);
                if(MapGen.Terrain.RefreshDerivedLayers)
                    MapGen.Terrain.RefreshDerivedLayers(c);
            }
            // Bridge fitting happens inside Terrain.Build, so the named river
            // spine and its rebuilt crossing layer must exist before this call.
            MapGen.Terrain.Build(c);
            // Keep the profile contract local to the shared pipeline as well:
            // custom/older Terrain.Build implementations may not dispatch the
            // bridge module. The builder is idempotent once a bridge exists.
            if(c.Profile && c.Profile.Name === "grammar_jungle_river_crossing" &&
                (!c.Bridges || !c.Bridges.length) && MapGen.Features &&
                MapGen.Features.Bridges && MapGen.Features.Bridges.Build)
                MapGen.Features.Bridges.Build(c);
        } },
        { label: "Features",      fn: function(c) {
            if(MapGen.Context.IsMultiplayer(c)) MapGen.Features.BuildMultiplayer(c);
            else MapGen.Features.BuildCampaign(c);
        } },
        { label: "Encounters",    fn: function(c) {
            if(MapGen.Context.IsMultiplayer(c)) MapGen.Encounters.BuildMultiplayer(c);
            else MapGen.Encounters.BuildCampaign(c);
        } },
        { label: "PreRenderRepair", fn: function(c) {
            var repaired = false;
            if(MapGen.Repair && MapGen.Repair.SealOffRouteFragments && MapGen.Repair.SealOffRouteFragments(c))
                repaired = true;
            if(MapGen.Repair && MapGen.Repair.TrimWaterCoverage && MapGen.Repair.TrimWaterCoverage(c))
                repaired = true;
            if(MapGen.Features.Bridges.PruneShortChannels(c))
                repaired = true;
            if(repaired) {
                if(MapGen.Terrain.RefreshDerivedLayers)
                    MapGen.Terrain.RefreshDerivedLayers(c);
            }
        } },
        { label: "PlacementConnectivity", fn: function(c) { MapGen.Connectivity.BuildPlacementNodes(c); } },
        { label: "PreRenderTacticalRoute", fn: function(c, rules) {
            if(MapGen.Validate.PrepareTacticalRouteProtection)
                MapGen.Validate.PrepareTacticalRouteProtection(c, rules);
        } },
        { label: "Decor",         fn: function(c) { MapGen.Decor.Build(c); } },
        { label: "PostPlacementCover", fn: function(c) {
            if(MapGen.Terrain.Cover.ApplyPostPlacementCover)
                MapGen.Terrain.Cover.ApplyPostPlacementCover(c);
        } },
        { label: "LayoutPreflight", fn: function(c,rules) { MapGen.Layout.Preflight(c,rules); } },
        // Early tree-coverage check. layers.blocked is finalized after Decor +
        // PostPlacementCover; tree coverage is a layer count, no Render needed.
        // Repair excessive cover before deciding to reject.  The normal
        // post-validation repair already knows how to thin trees, but this
        // early gate used to bypass it entirely.  On grammar_beach that made
        // almost every mapm5-style attempt fail cheaply and biased accepted
        // retries toward the final mapm8 attempt.
        { label: "EarlyValidateCoverage", fn: function(c) {
            if(!c || !c.Profile)
                return;
            // The last attempt MUST produce a renderable map even if doomed,
            // so the engine has something to write. Skip the early-reject
            // path on the final attempt.
            if(c.IsLastAttempt)
                return;
            var profile = c.Profile;
            var treeTarget = profile.TreeCoverage || 0;
            var maxTree = profile.MaxTreeCoverage !== undefined ?
                profile.MaxTreeCoverage : Math.min(0.90, treeTarget * 1.35);
            var area = Math.max(1, c.Width * c.Height);
            var treeBlocked = MapGen.Metrics.TreeBlockedCount(c);
            var treeCoverage = treeBlocked / area;
            var minTree = profile.MinTreeCoverage !== undefined ? profile.MinTreeCoverage : treeTarget * 0.60;
            if(treeCoverage < minTree) {
                var capacity = MapGen.Repair.TreeGrowthCapacity(c);
                if(capacity < Math.ceil(area * minTree)) {
                    c.EarlyRejection = {reason: "tree_coverage_too_low", capacity: capacity,
                        required: Math.ceil(area * minTree)};
                    MapGen.Context.AddLog(c, "Tree coverage cannot fit in legal growth sites: " +
                        capacity + "/" + Math.ceil(area * minTree));
                    return;
                }
            }
            if(treeCoverage > maxTree && MapGen.Repair && MapGen.Repair.ThinTreesToTarget) {
                MapGen.Repair.ThinTreesToTarget(c);
                treeBlocked = MapGen.Metrics.TreeBlockedCount(c);
                treeCoverage = treeBlocked / area;
            }
            if(treeCoverage > maxTree) {
                c.EarlyRejection = {
                    reason: "tree_coverage_too_high",
                    treeCoverage: treeCoverage,
                    maxTree: maxTree
                };
                MapGen.Context.AddLog(c, "Early-rejected (tree_coverage_too_high " +
                    treeCoverage.toFixed(3) + " > " + maxTree.toFixed(3) +
                    ") — skipping Render to save ~3-4s");
            }
        } },
        { label: "PlacementPreRenderRepair", fn: function(c, rules) {
            MapGen.Layout.RepairBeforeRender(c, rules);
        } },
        { label: "Render",        fn: function(c) {
            if(c.EarlyRejection)
                return;
            MapGen.Render.BuildTileLayer(c);
        } }
    ];
};

MapGen.BuildGrammarCampaignPlanFromContext = function(pContext) {
    var context = pContext;

    // The grammar core owns campaign live materialization (SetOwner pre/post).
    MapGen.Grammar.LiveMaterialization.SetOwner(context, "official_grammar");

    MapGen.RunPipeline(context, MapGen.PipelineStages(),
        MapGen.BaseValidationRules({ RequireCampaignRouteSites: true }));

    MapGen.Grammar.LiveMaterialization.SetOwner(context, "official_grammar");

    return context;
};

MapGen.BuildCampaignPlan = function(pOptions) {
    var context = MapGen.Context.Create(pOptions || {});
    context.GameMode = context.GameMode || MapGen.Context.GameModes.Campaign();

    if(context.Profile && context.Profile.Validation && !context.Profile.Validation.ok) {
        return MapGen.RejectCampaignPlan(
            context,
            MapGen.ProfileValidationReasons(context.Profile),
            "Campaign generation rejected invalid profile"
        );
    }

    if(context.Profile && context.Profile.GeneratorCore === "official_grammar" &&
        MapGen.Grammar && MapGen.Grammar.BuildCampaignPlan) {
        return MapGen.Grammar.BuildCampaignPlan(pOptions || {}, context);
    }

    return MapGen.RejectCampaignPlan(
        context,
        ["campaign_profile_requires_official_grammar"],
        "Campaign generation rejected non-grammar profile"
    );
};

MapGen.BuildMultiplayerPlan = function(pOptions) {
    var context = MapGen.Context.Create(pOptions || {});
    context.GameMode = context.GameMode || MapGen.Context.GameModes.Multiplayer();

    return MapGen.RunPipeline(context, MapGen.PipelineStages(),
        MapGen.BaseValidationRules({ RequireMultiplayerFairness: true }));
};

MapGen.BuildBest = function(pOptions, pBuildFn) {
    var options = pOptions || {};
    var profileRetries = 0;
    if(!options.ValidationRetries && MapGen.Profiles && MapGen.Profiles.Resolve) {
        var profileRandom = MapGen.Random.CreateSeeded(options.Seed || 0);
        var profile = MapGen.Profiles.Resolve(options.ProfileName, options.Overrides, profileRandom);
        profileRetries = profile && profile.ValidationRetries ? profile.ValidationRetries : 0;
    }
    var attempts = options.Attempts || options.ValidationRetries || profileRetries || MapGen.Profiles.Defaults.ValidationRetries;

    return MapGen.Retry.Run({ Attempts: attempts, CompleteAttempt: options.CompleteAttempt }, function(pAttempt) {
        var attemptOptions = MapGen.CopyAttemptOptions(options, pAttempt);
        // The last attempt MUST produce a renderable map — the engine writes
        // RenderedMap.Tiles to random.map regardless of validation status. If
        // we early-reject the last attempt, there is nothing to write. Disable
        // the early-reject path on the final attempt so we always have a
        // fallback render. RCA 2026-06-13.
        attemptOptions.IsLastAttempt = (pAttempt === attempts - 1);
        return pBuildFn(attemptOptions);
    });
};

MapGen.BuildBestCampaignPlan = function(pOptions) {
    return MapGen.BuildBest(pOptions, MapGen.BuildCampaignPlan);
};

MapGen.BuildBestMultiplayerPlan = function(pOptions) {
    return MapGen.BuildBest(pOptions, MapGen.BuildMultiplayerPlan);
};
