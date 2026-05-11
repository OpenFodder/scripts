var MapGen = MapGen || {};
MapGen.Grammar = MapGen.Grammar || {};

MapGen.Grammar.Viewport = {

    HasOwn: function(pObject, pKey) { return MapGen.Grammar.Util.HasOwn(pObject, pKey); },

    NumberOrNull: function(pValue) { return MapGen.Grammar.Util.NumberOrNull(pValue); },

    Clamp: function(pValue, pMin, pMax) { return MapGen.Grammar.Util.Clamp(pValue, pMin, pMax); },

    Round: function(pValue, pPlaces) { return MapGen.Grammar.Util.Round(pValue, pPlaces); },

    StatRange: function(pStats, pPreferWide) { return MapGen.Grammar.Util.StatRange(pStats, pPreferWide); },

    PickStatNumber: function(pRandom, pStats, pInteger, pFallback) {
        return MapGen.Grammar.Util.PickStatNumber(pRandom, pStats, pInteger, pFallback);
    },

    RangeSummary: function(pStats) { return MapGen.Grammar.Util.RangeSummary(pStats); },

    WeightedPick: function(pRandom, pWeights, pFallback) {
        var entries = [];
        var total = 0;
        var key;

        if(!pWeights)
            return pFallback || null;

        for(key in pWeights) {
            if(!this.HasOwn(pWeights, key))
                continue;

            var weight = Number(pWeights[key]);
            if(!isFinite(weight) || weight <= 0)
                continue;

            entries.push({ name: key, weight: weight });
            total += weight;
        }

        if(!entries.length || total <= 0)
            return pFallback || null;

        var roll = pRandom.Float(0, total);
        var cumulative = 0;

        for(var index = 0; index < entries.length; ++index) {
            cumulative += entries[index].weight;
            if(roll <= cumulative)
                return entries[index].name;
        }

        return entries[entries.length - 1].name;
    },

    GlobalViewport: function() {
        if(MapGen.TargetPack && MapGen.TargetPack.GlobalTarget)
            return MapGen.TargetPack.GlobalTarget("viewport");

        if(MapGen.TargetPack && MapGen.TargetPack.Data &&
            MapGen.TargetPack.Data.globalTargets)
            return MapGen.TargetPack.Clone(MapGen.TargetPack.Data.globalTargets.viewport || {});

        return {
            viewportSizeTiles: [17, 13],
            gridStrideTiles: [8, 6],
            screenTypes: [
                "start_screen",
                "extraction_screen",
                "objective_combat_screen",
                "objective_arena",
                "combat_screen",
                "light_contact_screen",
                "support_screen",
                "route_transition",
                "quiet_screen",
                "quiet_context_screen",
                "empty_failure_candidate"
            ]
        };
    },

    ViewportCapacity: function(pContext, pViewport, pStride) {
        var width = pViewport[0];
        var height = pViewport[1];
        var strideX = pStride[0];
        var strideY = pStride[1];
        var columns = Math.max(1, Math.floor((pContext.Width - width) / strideX) + 1);
        var rows = Math.max(1, Math.floor((pContext.Height - height) / strideY) + 1);

        return {
            columns: columns,
            rows: rows,
            count: columns * rows
        };
    },

    CloneWeights: function(pWeights) {
        var result = {};
        var key;

        for(key in (pWeights || {})) {
            if(this.HasOwn(pWeights, key))
                result[key] = Number(pWeights[key]);
        }

        return result;
    },

    BuildRouteWeights: function(pViewportTargets, pIntent, pRouteFraction) {
        var weights = this.CloneWeights(pViewportTargets.routeScreenTypeCounts || pViewportTargets.screenTypeCounts || {});

        delete weights.start_screen;
        delete weights.quiet_screen;
        delete weights.quiet_context_screen;
        delete weights.empty_failure_candidate;

        var supportTarget = pIntent && pIntent.routeShape ?
            Number(pIntent.routeShape.supportGoalCountTarget || 0) : 0;
        var pressureTarget = pIntent && pIntent.routeShape ?
            Number(pIntent.routeShape.pressureGoalCountTarget || 0) : 0;
        var requiresExtraction = !!(pIntent && pIntent.guardrails &&
            (pIntent.guardrails.requiresHostageExtraction || pIntent.guardrails.requiresCivilianDelivery));

        if(!requiresExtraction)
            delete weights.extraction_screen;
        if(supportTarget <= 0)
            weights.support_screen = Number(weights.support_screen || 0) * 0.25;
        if(pressureTarget <= 0) {
            weights.combat_screen = Number(weights.combat_screen || 0) * 0.25;
            weights.light_contact_screen = Number(weights.light_contact_screen || 0) * 0.35;
            weights.objective_combat_screen = Number(weights.objective_combat_screen || 0) * 0.70;
        }

        if(pRouteFraction < 0.22) {
            weights.route_transition = Number(weights.route_transition || 0) * 1.65;
            weights.light_contact_screen = Number(weights.light_contact_screen || 0) * 1.50;
            weights.objective_arena = Number(weights.objective_arena || 0) * 0.75;
        }
        else if(pRouteFraction > 0.68) {
            weights.objective_arena = Number(weights.objective_arena || 0) * 1.55;
            weights.objective_combat_screen = Number(weights.objective_combat_screen || 0) * 1.30;
            weights.route_transition = Number(weights.route_transition || 0) * 0.70;
        }

        if(!weights.objective_arena && !weights.objective_combat_screen) {
            weights.objective_arena = 1;
            weights.objective_combat_screen = 1;
        }
        if(!weights.route_transition)
            weights.route_transition = 1;

        return weights;
    },

    AlternateRouteType: function(pWeights, pPrevious) {
        var bestName = "route_transition";
        var bestWeight = -1;
        var key;

        for(key in (pWeights || {})) {
            if(!this.HasOwn(pWeights, key) || key === pPrevious)
                continue;

            var weight = Number(pWeights[key]);
            if(isFinite(weight) && weight > bestWeight) {
                bestName = key;
                bestWeight = weight;
            }
        }

        return bestName;
    },

    CompatibleAlternateType: function(pCurrent, pWeights) {
        switch(pCurrent) {
            case "objective_arena":
                return "objective_combat_screen";
            case "objective_combat_screen":
                return pWeights && pWeights.objective_arena ? "objective_arena" : "route_transition";
            case "combat_screen":
                return "light_contact_screen";
            case "light_contact_screen":
                return "route_transition";
            case "support_screen":
                return "route_transition";
            case "route_transition":
                return pWeights && pWeights.light_contact_screen ? "light_contact_screen" : "objective_arena";
            default:
                return "route_transition";
        }
    },

    BreakUniformRuns: function(pSpecs, pViewportTargets) {
        var previous = null;
        var runLength = 0;
        var weights = pViewportTargets ? pViewportTargets.routeScreenTypeCounts || pViewportTargets.screenTypeCounts || {} : {};

        for(var index = 0; index < pSpecs.length; ++index) {
            var spec = pSpecs[index];
            if(!spec)
                continue;

            if(spec.screenType === previous)
                ++runLength;
            else {
                previous = spec.screenType;
                runLength = 1;
            }

            if(runLength <= 3 || spec.screenType === "start_screen" || spec.screenType === "extraction_screen")
                continue;

            spec.screenType = this.CompatibleAlternateType(spec.screenType, weights);
            spec.role = this.RoleForType(spec.screenType);
            previous = spec.screenType;
            runLength = 1;
        }
    },

    StepScreenType: function(pStep, pRandom) {
        switch(String(pStep || "")) {
            case "enemy_cluster":
                return "objective_combat_screen";

            case "civilian_cluster":
            case "civilian_home":
            case "civilian_protect":
                return "support_screen";

            case "hostage_cluster":
                return "objective_arena";

            case "extraction_zone":
                return "extraction_screen";

            case "structure_cluster":
                return pRandom.Chance(0.55) ? "objective_arena" : "objective_combat_screen";

            default:
                return "objective_arena";
        }
    },

    RoleForType: function(pType) {
        switch(pType) {
            case "start_screen":
                return "start";
            case "extraction_screen":
                return "extraction";
            case "objective_combat_screen":
                return "objective_combat";
            case "objective_arena":
                return "objective_arena";
            case "combat_screen":
            case "light_contact_screen":
                return "contact";
            case "support_screen":
                return "support";
            case "quiet_screen":
            case "quiet_context_screen":
                return "quiet";
            case "empty_failure_candidate":
                return "empty_uniform_allowance";
            case "route_transition":
            default:
                return "route_transition";
        }
    },

    PhaseForIndex: function(pIndex, pCount, pType) {
        if(pIndex <= 0)
            return "start_zone";
        if(pType === "extraction_screen")
            return "extraction_or_exit";

        var fraction = pCount <= 1 ? 1 : pIndex / (pCount - 1);
        if(fraction < 0.22)
            return "first_contact";
        if(fraction < 0.48)
            return "route_build";
        if(fraction < 0.74)
            return "mid_route_pressure";
        return "objective_push";
    },

    PlaceRequiredSpec: function(pSpecs, pPreferredIndex, pType, pRole, pOrderStep) {
        var count = pSpecs.length;
        var best = -1;
        var distance;
        var offset;
        var left;
        var right;

        pPreferredIndex = this.Clamp(Math.round(pPreferredIndex), 0, count - 1);

        if(!pSpecs[pPreferredIndex])
            best = pPreferredIndex;

        for(distance = 1; best < 0 && distance < count; ++distance) {
            left = pPreferredIndex - distance;
            right = pPreferredIndex + distance;
            if(left >= 0 && !pSpecs[left])
                best = left;
            else if(right < count && !pSpecs[right])
                best = right;
        }

        if(best < 0)
            return false;

        pSpecs[best] = {
            screenType: pType,
            role: pRole || this.RoleForType(pType),
            orderStep: pOrderStep || null,
            required: true
        };
        return true;
    },

    BuildRouteSpecs: function(pContext, pViewportTargets, pIntent, pRouteScreenCount, pOutlierReasons) {
        var specs = [];
        var orderSteps = pIntent && pIntent.routeShape && pIntent.routeShape.steps ?
            pIntent.routeShape.steps : [];
        var supportTarget = pIntent && pIntent.routeShape ?
            Number(pIntent.routeShape.supportGoalCountTarget || 0) : 0;
        var pressureTarget = pIntent && pIntent.routeShape ?
            Number(pIntent.routeShape.pressureGoalCountTarget || 0) : 0;
        var requiresExtraction = !!(pIntent && pIntent.guardrails &&
            (pIntent.guardrails.requiresHostageExtraction || pIntent.guardrails.requiresCivilianDelivery));
        var i;

        for(i = 0; i < pRouteScreenCount; ++i)
            specs.push(null);

        this.PlaceRequiredSpec(specs, 0, "start_screen", "start", null);

        if(requiresExtraction)
            this.PlaceRequiredSpec(specs, pRouteScreenCount - 1, "extraction_screen", "extraction", "extraction_zone");

        if(pressureTarget > 0 && pRouteScreenCount > 3) {
            var firstContactType = pViewportTargets.screenTypeTargets &&
                pViewportTargets.screenTypeTargets.light_contact_screen ?
                "light_contact_screen" : "objective_combat_screen";
            this.PlaceRequiredSpec(specs, Math.max(1, Math.round(pRouteScreenCount * 0.18)), firstContactType, "first_contact", "enemy_cluster");
        }

        if(supportTarget > 0 && pRouteScreenCount > 4)
            this.PlaceRequiredSpec(specs, Math.max(1, Math.round(pRouteScreenCount * 0.35)), "support_screen", "support", "support_pickup");

        for(i = 0; i < orderSteps.length; ++i) {
            var fraction = (i + 1) / (orderSteps.length + 1);
            var slot = Math.round(fraction * (pRouteScreenCount - 1));
            var step = orderSteps[i];
            this.PlaceRequiredSpec(
                specs,
                Math.max(1, slot),
                this.StepScreenType(step, pContext.Random),
                "order_step",
                step
            );
        }

        for(i = 0; i < pRouteScreenCount; ++i) {
            if(specs[i])
                continue;

            var routeFraction = pRouteScreenCount <= 1 ? 1 : i / (pRouteScreenCount - 1);
            var weights = this.BuildRouteWeights(pViewportTargets, pIntent, routeFraction);
            var picked = this.WeightedPick(pContext.Random, weights, "route_transition");

            if(i >= 2 && specs[i - 1] && specs[i - 2] &&
                specs[i - 1].screenType === picked &&
                specs[i - 2].screenType === picked) {
                picked = this.AlternateRouteType(weights, picked);
            }

            specs[i] = {
                screenType: picked,
                role: this.RoleForType(picked),
                orderStep: null,
                required: false
            };
        }

        this.BreakUniformRuns(specs, pViewportTargets);

        if(!this.HasObjectiveScreen(specs))
            this.PlaceRequiredSpec(
                specs,
                Math.max(1, Math.round(pRouteScreenCount * 0.62)),
                "objective_arena",
                "objective_arena",
                "objective_required"
            );

        if(!this.HasObjectiveScreen(specs))
            pOutlierReasons.push("objective_screen_missing");

        return specs;
    },

    HasObjectiveScreen: function(pSpecs) {
        for(var index = 0; index < pSpecs.length; ++index) {
            if(!pSpecs[index])
                continue;
            if(pSpecs[index].screenType === "objective_arena" ||
                pSpecs[index].screenType === "objective_combat_screen")
                return true;
        }
        return false;
    },

    CountScreenTypes: function(pScreens) {
        var counts = {};

        for(var index = 0; index < pScreens.length; ++index) {
            var type = pScreens[index].screenType;
            counts[type] = (counts[type] || 0) + 1;
        }

        return counts;
    },

    UniqueScreenTypeCount: function(pScreens) {
        var counts = this.CountScreenTypes(pScreens);
        var total = 0;
        var key;

        for(key in counts) {
            if(this.HasOwn(counts, key))
                ++total;
        }

        return total;
    },

    LongestRun: function(pScreens) {
        var longest = 0;
        var current = 0;
        var previous = null;

        for(var index = 0; index < pScreens.length; ++index) {
            var type = pScreens[index].screenType;
            if(type === previous)
                ++current;
            else {
                previous = type;
                current = 1;
            }
            if(current > longest)
                longest = current;
        }

        return longest;
    },

    PickTargetMetrics: function(pContext, pTypeTarget) {
        var visualFractions = {};
        var sourceVisual = pTypeTarget && pTypeTarget.visualFractions ?
            pTypeTarget.visualFractions : {};
        var key;

        for(key in sourceVisual) {
            if(!this.HasOwn(sourceVisual, key))
                continue;

            visualFractions[key] = {
                selected: this.Round(this.PickStatNumber(pContext.Random, sourceVisual[key], false, 0), 4),
                range: this.RangeSummary(sourceVisual[key])
            };
        }

        return {
            intendedEnemyPressure: this.PickStatNumber(pContext.Random, pTypeTarget ? pTypeTarget.enemyPressure : null, true, 0),
            supportObjectCount: this.PickStatNumber(pContext.Random, pTypeTarget ? pTypeTarget.supportCount : null, true, 0),
            tacticalObjectCount: this.PickStatNumber(pContext.Random, pTypeTarget ? pTypeTarget.tacticalObjectCount : null, true, 0),
            coverFraction: this.Round(this.PickStatNumber(pContext.Random, pTypeTarget ? pTypeTarget.coverFraction : null, false, 0), 4),
            routeCoverageFraction: this.Round(this.PickStatNumber(pContext.Random, pTypeTarget ? pTypeTarget.routeCoverageFraction : null, false, 0), 4),
            dryPassableFraction: this.Round(this.PickStatNumber(pContext.Random, pTypeTarget ? pTypeTarget.dryPassableFraction : null, false, 0), 4),
            visualFractions: visualFractions
        };
    },

    ScreenTargetSummary: function(pType, pViewportTargets) {
        var target = pViewportTargets && pViewportTargets.screenTypeTargets ?
            pViewportTargets.screenTypeTargets[pType] : null;

        return {
            screenType: pType,
            observedScreenCount: pViewportTargets && pViewportTargets.screenTypeCounts ?
                Number(pViewportTargets.screenTypeCounts[pType] || 0) : 0,
            observedRouteScreenCount: pViewportTargets && pViewportTargets.routeScreenTypeCounts ?
                Number(pViewportTargets.routeScreenTypeCounts[pType] || 0) : 0,
            ranges: {
                enemyPressure: this.RangeSummary(target ? target.enemyPressure : null),
                supportCount: this.RangeSummary(target ? target.supportCount : null),
                tacticalObjectCount: this.RangeSummary(target ? target.tacticalObjectCount : null),
                coverFraction: this.RangeSummary(target ? target.coverFraction : null),
                routeCoverageFraction: this.RangeSummary(target ? target.routeCoverageFraction : null),
                dryPassableFraction: this.RangeSummary(target ? target.dryPassableFraction : null)
            }
        };
    },

    BuildScreenTargets: function(pViewport, pViewportTargets) {
        var types = pViewport.screenTypes || [];
        var result = [];

        for(var index = 0; index < types.length; ++index)
            result.push(this.ScreenTargetSummary(types[index], pViewportTargets));

        return result;
    },

    BuildBeat: function(pContext, pViewportTargets, pSpec, pIndex, pCount) {
        var typeTarget = pViewportTargets && pViewportTargets.screenTypeTargets ?
            pViewportTargets.screenTypeTargets[pSpec.screenType] : null;
        var routeFraction = pCount <= 1 ? 0 : pIndex / (pCount - 1);
        var phase = this.PhaseForIndex(pIndex, pCount, pSpec.screenType);

        return {
            index: pIndex,
            routeFraction: this.Round(routeFraction, 4),
            screenType: pSpec.screenType,
            routePhase: phase,
            role: pSpec.role || this.RoleForType(pSpec.screenType),
            orderStep: pSpec.orderStep || null,
            required: !!pSpec.required,
            intendedEnemyPressure: 0,
            supportObjectCount: 0,
            tacticalObjectCount: 0,
            terrainBalance: this.PickTargetMetrics(pContext, typeTarget),
            targetSource: "viewportPacing.screenTypeTargets." + pSpec.screenType
        };
    },

    FinalizeBeatMetrics: function(pBeat) {
        pBeat.intendedEnemyPressure = pBeat.terrainBalance.intendedEnemyPressure;
        pBeat.supportObjectCount = pBeat.terrainBalance.supportObjectCount;
        pBeat.tacticalObjectCount = pBeat.terrainBalance.tacticalObjectCount;
        return pBeat;
    },

    BuildAmbientContextWeights: function(pViewportTargets) {
        var weights = this.CloneWeights(pViewportTargets.screenTypeCounts || {});

        delete weights.start_screen;
        delete weights.extraction_screen;
        delete weights.empty_failure_candidate;
        delete weights.quiet_screen;
        delete weights.quiet_context_screen;

        if(!weights.objective_arena && !weights.objective_combat_screen &&
            !weights.route_transition)
            weights.route_transition = 1;

        return weights;
    },

    BuildAmbientScreens: function(pContext, pViewportTargets, pQuietCount, pEmptyCount, pTotalAmbientCount) {
        var result = [];
        var index;
        var totalAmbient = Math.max(0, pTotalAmbientCount || (pQuietCount + pEmptyCount));

        for(index = 0; index < pQuietCount; ++index) {
            var type = (index % 5 === 4 && pViewportTargets.screenTypeTargets &&
                pViewportTargets.screenTypeTargets.quiet_context_screen) ?
                "quiet_context_screen" : "quiet_screen";
            var spec = {
                screenType: type,
                role: this.RoleForType(type),
                orderStep: null,
                required: false
            };
            var beat = this.BuildBeat(pContext, pViewportTargets, spec, index, Math.max(1, pQuietCount));
            beat.index = index;
            beat.routeFraction = null;
            beat.routePhase = "off_route_context";
            result.push(this.FinalizeBeatMetrics(beat));
        }

        for(index = 0; index < pEmptyCount; ++index) {
            var emptySpec = {
                screenType: "empty_failure_candidate",
                role: "empty_uniform_allowance",
                orderStep: null,
                required: false
            };
            var emptyBeat = this.BuildBeat(pContext, pViewportTargets, emptySpec, result.length, Math.max(1, result.length + 1));
            emptyBeat.index = result.length;
            emptyBeat.routeFraction = null;
            emptyBeat.routePhase = "off_route_empty_allowance";
            result.push(this.FinalizeBeatMetrics(emptyBeat));
        }

        var contextWeights = this.BuildAmbientContextWeights(pViewportTargets);
        while(result.length < totalAmbient) {
            var picked = this.WeightedPick(pContext.Random, contextWeights, "route_transition");
            var contextSpec = {
                screenType: picked,
                role: "off_route_context",
                orderStep: null,
                required: false
            };
            var contextBeat = this.BuildBeat(
                pContext,
                pViewportTargets,
                contextSpec,
                result.length,
                Math.max(1, totalAmbient)
            );
            contextBeat.index = result.length;
            contextBeat.routeFraction = null;
            contextBeat.routePhase = "off_route_context";
            result.push(this.FinalizeBeatMetrics(contextBeat));
        }

        return result;
    },

    Plan: function(pContext, pPlan) {
        var self = MapGen.Grammar.Viewport;
        var profile = pContext.Profile || {};
        var target = profile.TargetPack || {};
        var targets = target.targets || {};
        var viewportTargets = targets.viewportPacing || {};
        var viewport = self.GlobalViewport();
        var viewportTiles = viewport.viewportSizeTiles || [17, 13];
        var gridStride = viewport.gridStrideTiles || [8, 6];
        var capacity = self.ViewportCapacity(pContext, viewportTiles, gridStride);
        var intent = pPlan.intent || {};
        var routeShape = intent.routeShape || {};
        var outlierReasons = [];
        var notes = [];
        var officialTarget = self.PickStatNumber(
            pContext.Random,
            viewportTargets.screensPerMap,
            true,
            capacity.count
        );
        var routeLengthTarget = Number(routeShape.routeLengthTarget || 0);
        var orderSteps = routeShape.steps || [];
        var minimumRouteScreens = Math.max(2, (orderSteps.length * 2) + 1);
        var routeByLength = Math.ceil(routeLengthTarget / Math.max(8, Number(viewportTiles[0] || 17) * 0.75));

        if(intent.guardrails && (intent.guardrails.requiresHostageExtraction ||
            intent.guardrails.requiresCivilianDelivery))
            minimumRouteScreens += 1;
        if(Number(routeShape.supportGoalCountTarget || 0) > 0)
            minimumRouteScreens += 1;

        if(!viewportTargets.screenTypeTargets)
            outlierReasons.push("viewport_targets_missing");

        if(officialTarget > capacity.count) {
            notes.push("official_screen_sample_count_exceeds_generated_viewport_grid_capacity");
        }

        var routeScreenCount = self.Clamp(
            Math.max(minimumRouteScreens, routeByLength),
            2,
            Math.max(2, capacity.count)
        );
        var plannedTotal = self.Clamp(
            officialTarget,
            routeScreenCount,
            Math.max(routeScreenCount, capacity.count)
        );
        var quietRatio = self.PickStatNumber(
            pContext.Random,
            viewportTargets.quietToCombatRatio,
            false,
            0
        );
        var emptyFraction = self.PickStatNumber(
            pContext.Random,
            viewportTargets.emptyFailureCandidateFraction,
            false,
            0
        );
        var ambientCapacity = Math.max(0, plannedTotal - routeScreenCount);
        var quietScreenTarget = self.Clamp(
            Math.round(routeScreenCount * quietRatio),
            0,
            ambientCapacity
        );
        var emptyFailureAllowance = self.Clamp(
            Math.round(plannedTotal * emptyFraction),
            0,
            Math.max(0, ambientCapacity - quietScreenTarget)
        );
        var ambientScreenTarget = Math.max(
            quietScreenTarget + emptyFailureAllowance,
            plannedTotal - routeScreenCount
        );
        var routeSpecs = self.BuildRouteSpecs(
            pContext,
            viewportTargets,
            intent,
            routeScreenCount,
            outlierReasons
        );
        var sequence = [];

        for(var index = 0; index < routeSpecs.length; ++index)
            sequence.push(self.FinalizeBeatMetrics(
                self.BuildBeat(pContext, viewportTargets, routeSpecs[index], index, routeSpecs.length)
            ));

        var uniqueTypes = self.UniqueScreenTypeCount(sequence);
        var longestRun = self.LongestRun(sequence);

        if(routeScreenCount >= 6 && uniqueTypes < 3)
            outlierReasons.push("viewport_mix_low");
        if(longestRun > 3)
            outlierReasons.push("too_many_uniform_screens");
        if(routeScreenCount < minimumRouteScreens)
            outlierReasons.push("route_screen_sequence_gap");

        var ambientScreens = self.BuildAmbientScreens(
            pContext,
            viewportTargets,
            quietScreenTarget,
            emptyFailureAllowance,
            ambientScreenTarget
        );
        var routeMix = self.CountScreenTypes(sequence);
        var ambientMix = self.CountScreenTypes(ambientScreens);

        return {
            name: "screenPlan",
            status: "ready",
            viewportTiles: { width: viewportTiles[0], height: viewportTiles[1] },
            gridStrideTiles: { x: gridStride[0], y: gridStride[1] },
            gridCapacity: capacity,
            screenBudget: {
                officialScreensPerMapTarget: officialTarget,
                plannedTotalScreens: sequence.length + ambientScreens.length,
                routeScreenTarget: routeScreenCount,
                ambientScreenTarget: ambientScreenTarget,
                quietScreenTarget: quietScreenTarget,
                emptyFailureCandidateAllowance: emptyFailureAllowance,
                uniformScreenAllowance: quietScreenTarget + emptyFailureAllowance,
                routeLengthTarget: routeLengthTarget,
                routeScreenSource: "route_length_target_divided_by_viewport_stride"
            },
            routeBeatCounts: {
                minimumRequired: minimumRouteScreens,
                routeLengthDerived: routeByLength,
                selected: routeScreenCount
            },
            routeMix: routeMix,
            ambientMix: ambientMix,
            sequence: sequence,
            routeBeats: sequence,
            ambientScreens: ambientScreens,
            screenTargets: self.BuildScreenTargets(viewport, viewportTargets),
            targetRefs: [
                "profiles." + (pPlan.targetPackProfileName || profile.TargetPackProfile || "") + ".targets.viewportPacing",
                "globalTargets.viewport"
            ],
            notes: notes,
            outlierReasons: outlierReasons
        };
    }
};
