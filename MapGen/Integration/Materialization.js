var MapGen = MapGen || {};
MapGen.Integration = MapGen.Integration || {};

(function(pIntegration) {
    pIntegration.MaterializeCampaign = function(grammarContext) {
        if(grammarContext.IntentMap && MapGen.Intent.Composite.OverlayAuthoredTerrain) {
            Scenario.Random.LiveTime(grammarContext, "RestoreIntentReservations", function() {
                return MapGen.Intent.Composite.OverlayAuthoredTerrain(
                    grammarContext, grammarContext.IntentMap, grammarContext.Layers);
            });
        }
        var playerCount = Scenario.Random.GrammarGroupCount("players", 4);
        var enemyBuildingCount = Scenario.Random.GrammarEnemyBuildings();
        var pickupCounts = Scenario.Random.GrammarPickupCounts();
        var hostageGroupSizes = Settings.hasObjective(Objectives.RescueHostages) ?
            Scenario.Random.GrammarHostageGroupSizes() : [];
        var hostageCount = 0;
        var civilianCount = Settings.hasObjective(Objectives.GetCivilianHome) ?
            Math.max(1, Scenario.Random.GrammarRoleCount("civilians", 1)) : 0;
        var countIndex;

        for(countIndex = 0; countIndex < hostageGroupSizes.length; ++countIndex)
            hostageCount += hostageGroupSizes[countIndex];

        Scenario.Random.RequireTimedPlacement(
            grammarContext,
            "PlaceCampaignPlayers",
            function() { return MapGen.Integration.PlaceCampaignPlayers(playerCount); },
            "MapGen failed to place campaign players"
        );

        // Batch terrain changes from structure/objective placement and flush
        // once after all structures/objectives are placed,
        // before pickups/decor/sprite groups read the committed map.
        Scenario.Random.LiveTime(grammarContext, "BeginDeferredStructureTerrain", function() {
            MapGen.Integration.BeginDeferredStructureTerrain(grammarContext);
            return true;
        });
    
        if(Scenario.Random.GrammarCountBuildingSpecs(enemyBuildingCount) > 0) {
            Scenario.Random.RequireTimedPlacement(
                grammarContext,
                "PlaceCampaignBuildings.enemy",
                function() { return MapGen.Integration.PlaceCampaignBuildings(enemyBuildingCount, "enemy"); },
                "MapGen failed to place enemy buildings"
            );
        }

        // Random Rescue Hostages
        if(Settings.hasObjective(Objectives.RescueHostages)) {
            Scenario.Random.RequireTimedPlacement(
                grammarContext,
                "PlaceCampaignRescueHostages",
                function() { return MapGen.Integration.PlaceCampaignRescueHostages(hostageGroupSizes); },
                "MapGen failed to place rescue-hostage objective"
            );
        }
    
        // Random Get Civilian home
        if(Settings.hasObjective(Objectives.GetCivilianHome)) {
            Scenario.Random.RequireTimedPlacement(
                grammarContext,
                "PlaceCampaignCivilianHome",
                function() {
                    return MapGen.Integration.PlaceCampaignCivilianHome(civilianCount);
                },
                "MapGen failed to place civilian-home objective"
            );
        }


        if(!grammarContext.FastTileIteration) {
            // These checks depend only on the completed placement rectangles.
            // Reject a doomed layout before paying for the terrain flush. The
            // final live validator still runs every check on surviving maps.
            grammarContext.AttemptStage = "structure_layout_validation";
            var layoutReport = { ok: true, reasons: [], counts: {} };
            Scenario.Random.LiveTime(grammarContext, "ValidateStructureLayout", function() {
                MapGen.Integration.ValidateLiveStructureSpacing(layoutReport, grammarContext);
                MapGen.Integration.ValidateLiveStructureMapUse(layoutReport, grammarContext,
                    Scenario.Random.GrammarCountBuildingSpecs(enemyBuildingCount));
            });
            Scenario.Random.RequirePlacement(layoutReport.ok,
                "Structure layout failed: " + layoutReport.reasons.join(", "));
            grammarContext.AttemptStage = "placement";
        }

        // All structures/objectives placed: do the single deferred render now, before
        // pickups + grammar sprite groups consult the committed map (decor footprint
        // checks; turret/enemy clearance via Map.TileTerrainFeature).
        Scenario.Random.LiveTime(grammarContext, "FlushStructureTerrain", function() {
            MapGen.Integration.FlushStructureTerrain(grammarContext);
            return true;
        });

        Scenario.Random.RequireTimedPlacement(
            grammarContext,
            "PlaceCampaignPickups",
            function() { return MapGen.Integration.PlaceCampaignPickups(pickupCounts.grenades, pickupCounts.rockets); },
            "MapGen failed to place campaign pickups"
        );

        Scenario.Random.RequireTimedPlacement(
            grammarContext,
            "PlaceGrammarSpriteGroups",
            function() {
                return MapGen.Integration.PlaceGrammarSpriteGroups(["structureSprites", "enemies", "vehicles", "callpads", "hazards", "decor"]);
            },
            "MapGen failed to place grammar planned sprites"
        );

        Scenario.Random.LiveTime(grammarContext, "PolishFinalIceMap", function() {
            return MapGen.Integration.PolishFinalIceMap ?
                MapGen.Integration.PolishFinalIceMap(grammarContext) :
                0;
        });

        if(grammarContext.IntentMap && MapGen.Intent.FinaliseForCommit) {
            var commit = Scenario.Random.LiveTime(grammarContext, "FinaliseTerrainForCommit", function() {
                return MapGen.Intent.FinaliseForCommit(grammarContext);
            });
            Scenario.Random.RequirePlacement(commit && commit.ok,
                "Final terrain contract failed: " + ((commit && commit.reasons) || []).join(", "));
        }

        grammarContext.AttemptStage = "live_validation";
        if(grammarContext.FastTileIteration) {
            grammarContext.LiveValidation = {
                ok: true,
                skipped: true,
                mode: "campaign",
                reason: "fast_tile_iteration",
                reasons: [],
                warnings: [],
                counts: {}
            };
            MapGen.Integration.WriteContextMetadata(
                grammarContext,
                MapGen.Integration.LiveValidationRequestedSeed(grammarContext)
            );
        }
        else {
            var liveValidation = Scenario.Random.LiveTime(grammarContext, "ValidateMaterializedCampaign", function() {
                return MapGen.Integration.ValidateMaterializedCampaign(
                    Scenario.Random.GrammarValidationExpected(
                        playerCount,
                        enemyBuildingCount,
                        pickupCounts,
                        hostageCount,
                        civilianCount,
                        grammarContext
                    )
                );
            });

            Scenario.Random.RequirePlacement(
                liveValidation.ok,
                "MapGen materialized campaign map failed: " + liveValidation.reasons.join(", ")
            );
        }

        if(!grammarContext.FastTileIteration) {
            // The legacy validator consumes live explosive-support results.
            // Its optional transport addition must also be validated before acceptance.
            grammarContext.AttemptStage = "runtime_validation";
            var beforeHelicopter = Session.Helicopter;
            Scenario.Random.LiveTime(grammarContext, "ValidateRuntime", function() {
                return Validation.ValidateMap();
            });
            if(Session.Helicopter !== beforeHelicopter) {
                grammarContext.AttemptStage = "live_validation_after_transport";
                var afterTransport = MapGen.Integration.ValidateMaterializedCampaign(
                    Scenario.Random.GrammarValidationExpected(playerCount, enemyBuildingCount,
                        pickupCounts, hostageCount, civilianCount, grammarContext));
                Scenario.Random.RequirePlacement(afterTransport.ok,
                    "Transport validation failed: " + afterTransport.reasons.join(", "));
            }
        }

    };
})(MapGen.Integration);
