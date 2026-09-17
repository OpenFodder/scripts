
Scenario.Random = {

    SyncGeneratedObjectives: true,

    CreateMap: function() {
        MapGen.Integration.GenerateCampaignMap();
    },

    RecordFailure: function(pMessage) {
        if(typeof FileIO === "undefined")
            return;

        try {
            var context = (typeof Session !== "undefined") ? Session.MapGenContext : null;
            var diagnostics = MapGen.Integration.DiagnosticsEnabled(context);
            var requestedSeed = context && context.RequestedSeed !== undefined ? context.RequestedSeed :
                (typeof Settings !== "undefined" && Settings.RandomMap && Settings.RandomMap.Enabled &&
                    Settings.RandomMap.Seed !== undefined ? Settings.RandomMap.Seed :
                    (typeof Settings !== "undefined" && Settings.Seed !== undefined ? Settings.Seed :
                        ((typeof Map !== "undefined" && Map.seed !== undefined) ? Map.seed : 0)));
            var selectedSeed = context && context.Seed !== undefined ? context.Seed :
                ((typeof Map !== "undefined" && Map.seed !== undefined) ? Map.seed : requestedSeed);
            var validation = context && context.Validation ? context.Validation : null;
            var retrySource = context && context.Retry ? context.Retry : null;
            var reasons = validation && validation.reasons ? validation.reasons.slice(0) : [pMessage];
            var compactAttempts = [];
            if(retrySource && retrySource.attempts) {
                for(var attemptIndex = 0; attemptIndex < retrySource.attempts.length; ++attemptIndex) {
                    var attempt = retrySource.attempts[attemptIndex] || {};
                    compactAttempts.push({ seed: attempt.seed, attempt: attempt.attempt,
                        stage: attempt.stage, reasons: attempt.reasons || [] });
                }
            }
            var retry = context && context.Retry ? {
                totalAttempts: context.Retry.totalAttempts,
                selectedAttempt: context.Retry.selectedAttempt,
                selectedSeed: context.Retry.selectedSeed,
                selectedScore: context.Retry.selectedScore
            } : null;
            if(retry) retry.attempts = diagnostics ? context.Retry.attempts : compactAttempts;
            var payload = {
                message: pMessage,
                // Failure envelopes are deliberately written during normal
                // gameplay so an exhausted map can always be replayed.
                seed: requestedSeed,
                requestedSeed: requestedSeed,
                selectedSeed: selectedSeed,
                profile: context && context.Profile ? context.Profile.Name : "",
                width: context && context.Width !== undefined ? context.Width : 0,
                height: context && context.Height !== undefined ? context.Height : 0,
                reasons: reasons,
                retry: retry
            };
            if(diagnostics) {
                payload.validation = validation ? {
                    ok: validation.ok,
                    fatal: validation.fatal,
                    reasons: validation.reasons,
                    warnings: validation.warnings,
                    tactical: validation.tactical,
                    metrics: validation.metrics ? {
                        counts: validation.metrics.Counts,
                        coverage: validation.metrics.Coverage,
                        placements: validation.metrics.Placements
                    } : null
                } : null;
                payload.liveValidation = context && context.LiveValidation ? context.LiveValidation : null;
            }
            var file = new FileIO("mapgen_failure_" + requestedSeed + ".json", false);
            if(file.isOpen()) {
                file.writeLine(JSON.stringify(payload));
                file.close();
            }
        } catch(e) {
        }
    },

    RequirePlacement: function(pPlaced, pMessage) {
        if(!pPlaced) {
            if(!Session.MapGenContext || !Session.MapGenContext.InAttempt)
                Scenario.Random.RecordFailure(pMessage);
            throw new Error(pMessage);
        }
    },

    LiveTime: function(pContext, pLabel, pFn) {
        if(pContext && MapGen.Context && MapGen.Context.Time)
            return MapGen.Context.Time(pContext, "Live." + pLabel, pFn);

        return pFn();
    },

    RequireTimedPlacement: function(pContext, pLabel, pFn, pMessage) {
        Scenario.Random.RequirePlacement(
            Scenario.Random.LiveTime(pContext, pLabel, pFn),
            pMessage
        );
    },

    GrammarContext: function() {
        if(typeof Session === "undefined")
            return null;

        var context = Session.MapGenContext;
        if(!context || !context.Profile || context.Profile.GeneratorCore !== "official_grammar")
            return null;

        return context;
    },

    GrammarPlan: function() {
        var context = Scenario.Random.GrammarContext();
        return context ? context.GrammarPlan || null : null;
    },

    GrammarSpritePlan: function() {
        var plan = Scenario.Random.GrammarPlan();
        return plan ? plan.spritePlan || null : null;
    },

    GrammarGroupCount: function(pGroup, pFallback) {
        var spritePlan = Scenario.Random.GrammarSpritePlan();
        var group = spritePlan ? spritePlan[pGroup] || [] : [];

        if(group.length)
            return group.length;

        return Math.max(0, Math.round(pFallback || 0));
    },

    GrammarRoleCount: function(pRole, pFallback) {
        var spritePlan = Scenario.Random.GrammarSpritePlan();
        var roleCounts = spritePlan ? spritePlan.roleCounts || {} : {};
        var value = roleCounts[pRole];

        if(typeof value === "number" && isFinite(value))
            return Math.max(0, Math.round(value));

        return Math.max(0, Math.round(pFallback || 0));
    },

    GrammarTargetRoleCount: function(pRole, pFallback, pContext) {
        var context = pContext || Scenario.Random.GrammarContext();
        var targets = context && context.Profile && context.Profile.TargetPack ?
            context.Profile.TargetPack.targets || {} : {};
        var styleRoles = targets.styleSpriteRoles ? targets.styleSpriteRoles.roleCounts || {} : {};
        var placementRoles = targets.spriteRolePlacement ? targets.spriteRolePlacement.roles || {} : {};
        var stats = styleRoles[pRole] || (placementRoles[pRole] ? placementRoles[pRole].count : null);
        var range = stats ? stats.targetRange || stats.wideRange || null : null;
        var low = range && range.length > 1 ? Number(range[0]) : NaN;
        var high = range && range.length > 1 ? Number(range[1]) : NaN;

        if(isFinite(low) && isFinite(high))
            return Math.max(0, Math.round((low + high) / 2));

        return Math.max(0, Math.round(pFallback || 0));
    },

    GrammarObjectiveLabel: function() {
        var plan = Scenario.Random.GrammarPlan();
        return plan && plan.intent ? String(plan.intent.objectiveLabel || "") : "";
    },

    GrammarCountBuildingSpecs: function(pSpecs) {
        var total = 0;
        var building;
        var sprite;

        for(building in (pSpecs || {})) {
            if(!pSpecs.hasOwnProperty(building))
                continue;
            for(sprite in (pSpecs[building] || {})) {
                if(pSpecs[building].hasOwnProperty(sprite))
                    total += Math.max(0, Math.floor(pSpecs[building][sprite] || 0));
            }
        }

        return total;
    },

    GrammarEnemyBuildings: function() {
        return MapGen.Integration.CampaignBuildingRequirements(Scenario.Random.GrammarContext());
    },


    GrammarPickupCounts: function() {
        var spritePlan = Scenario.Random.GrammarSpritePlan();
        var pickups = spritePlan ? spritePlan.pickups || [] : [];
        var grenades = 0;
        var rockets = 0;

        for(var index = 0; index < pickups.length; ++index) {
            if(pickups[index].spriteType === 38)
                ++rockets;
            else
                ++grenades;
        }

        if(!grenades && !rockets) {
            var total = Scenario.Random.GrammarTargetRoleCount("pickups", 1);
            rockets = total > 1 ? 1 : 0;
            grenades = Math.max(0, total - rockets);
        }

        return {
            grenades: grenades,
            rockets: rockets
        };
    },

    GrammarHostageGroupSizes: function() {
        var plan = Scenario.Random.GrammarPlan();
        var spritePlan = Scenario.Random.GrammarSpritePlan();
        var hostages = spritePlan ? spritePlan.hostages || [] : [];
        var objectivePlan = plan ? plan.objectivePlan || {} : {};
        var objectives = objectivePlan.objectives || [];
        var clusterCount = 0;
        var hostageCount = hostages.length ||
            Scenario.Random.GrammarRoleCount("hostages", 0) ||
            Scenario.Random.GrammarTargetRoleCount("hostages", 1);
        var groupCount;
        var groups = [];
        var remaining;
        var index;

        for(index = 0; index < objectives.length; ++index) {
            if(objectives[index].kind === "hostage_cluster")
                ++clusterCount;
        }

        hostageCount = Math.max(1, Math.min(6, Math.round(hostageCount)));
        groupCount = Math.max(clusterCount, Math.ceil(hostageCount / 3));
        groupCount = Math.max(1, Math.min(groupCount, hostageCount));
        remaining = hostageCount;

        for(index = 0; index < groupCount; ++index) {
            var groupsLeft = groupCount - index;
            var size = Math.max(1, Math.min(3, Math.ceil(remaining / groupsLeft)));

            groups.push(size);
            remaining -= size;
        }

        return groups;
    },

    GrammarValidationExpected: function(pPlayerCount, pEnemyBuildings, pPickupCounts, pHostageCount, pCivilianCount, pContext) {
        var enemyBuildingTarget = Scenario.Random.GrammarCountBuildingSpecs(pEnemyBuildings);
        var spritePlan = pContext && pContext.GrammarPlan ?
            pContext.GrammarPlan.spritePlan : null;
        var plannedEnemies = spritePlan && spritePlan.enemies ?
            spritePlan.enemies : [];
        var plannedInfantry = 0;
        for(var enemyIndex = 0; enemyIndex < plannedEnemies.length; ++enemyIndex) {
            if(plannedEnemies[enemyIndex].kind === "enemy_patrol")
                ++plannedInfantry;
        }

        return {
            players: pPlayerCount,
            enemies: 0,
            enemyInfantry: plannedInfantry,
            // Validate the complete composition request. The old boolean
            // minimum accepted a one-building map even when the selected
            // beach/ice/jungle plan requested two or more landmarks.
            enemyBuildings: enemyBuildingTarget,
            totalStructures: enemyBuildingTarget,
            liveStructures: enemyBuildingTarget,
            hostages: Settings.hasObjective(Objectives.RescueHostages) ? Math.max(1, Math.round(pHostageCount || 1)) : 0,
            civilians: Settings.hasObjective(Objectives.GetCivilianHome) ? Math.max(1, Math.round(pCivilianCount || 1)) : 0,
            grenadeBoxes: pPickupCounts.grenades,
            rocketBoxes: pPickupCounts.rockets
        };
    },

    // GenerateCampaignMap completes placement and validation inside retries.
    // OpenFodder owns the single scenario save after phase objectives sync.
    Start: function() {
        var context = Scenario.Random.GrammarContext();
        Scenario.Random.RequirePlacement(context && context.Materialized,
            "Campaign generation did not produce an accepted materialized map");
    },

    Settings: function(pMissionNumber, pPhaseNumber) {
        Settings.ConfigureRandomMapFromEngine();
        Settings.ApplyCampaignDefaults();
        if(Settings.RandomMap.Enabled)
            Settings.ApplyRandomMapOptions();
    }
};

