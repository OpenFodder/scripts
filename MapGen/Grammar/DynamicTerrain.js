var MapGen = MapGen || {};
MapGen.Grammar = MapGen.Grammar || {};

MapGen.Grammar.DynamicTerrain = {

    HasOwn: function(pObject, pKey) { return MapGen.Grammar.Util.HasOwn(pObject, pKey); },

    NumberOrNull: function(pValue) { return MapGen.Grammar.Util.NumberOrNull(pValue); },

    Clamp: function(pValue, pMin, pMax) { return MapGen.Grammar.Util.Clamp(pValue, pMin, pMax); },

    Round: function(pValue, pPlaces) { return MapGen.Grammar.Util.Round(pValue, pPlaces); },

    StatRange: function(pStats, pPreferWide) { return MapGen.Grammar.Util.StatRange(pStats, pPreferWide); },

    PickStatNumber: function(pRandom, pStats, pInteger, pFallback) {
        return MapGen.Grammar.Util.PickStatNumberOuter(pRandom, pStats, pInteger, pFallback);
    },

    RangeSummary: function(pStats) { return MapGen.Grammar.Util.RangeSummary(pStats); },

    WeightedPick: function(pRandom, pEntries) {
        var total = 0;
        var index;

        for(index = 0; index < pEntries.length; ++index)
            total += Math.max(0, Number(pEntries[index].weight || 0));

        if(!pEntries.length || total <= 0)
            return null;

        var roll = pRandom.Float(0, total);
        var cumulative = 0;

        for(index = 0; index < pEntries.length; ++index) {
            cumulative += Math.max(0, Number(pEntries[index].weight || 0));
            if(roll <= cumulative)
                return pEntries[index].entry;
        }

        return pEntries[pEntries.length - 1].entry;
    },

    EntryWeight: function(pEntry, pPreferredUsage, pPreferredKind) {
        var weight = Math.max(1, Number(pEntry.count || 1)) + Math.max(0, Number(pEntry.mapCount || 0)) * 2;
        var kind = String(pEntry.kind || "");
        var usage = String(pEntry.usage || "");

        if(pPreferredUsage && usage === pPreferredUsage)
            weight *= 2.5;
        if(pPreferredKind && kind === pPreferredKind)
            weight *= 2.5;
        if(Number(pEntry.breakableRouteMapCount || 0) > 0)
            weight *= 1.4;

        return weight;
    },

    FilterEntries: function(pEntries, pUsage, pKind, pAllowFallback) {
        var result = [];
        var index;

        for(index = 0; index < pEntries.length; ++index) {
            var entry = pEntries[index];
            if(pUsage && entry.usage !== pUsage)
                continue;
            if(pKind && entry.kind !== pKind)
                continue;
            result.push(entry);
        }

        if(!result.length && pAllowFallback) {
            for(index = 0; index < pEntries.length; ++index) {
                var fallback = pEntries[index];
                if(pUsage && fallback.usage === pUsage)
                    result.push(fallback);
                else if(pKind && fallback.kind === pKind)
                    result.push(fallback);
            }
        }

        if(!result.length && pAllowFallback)
            result = pEntries;

        return result;
    },

    PickEntry: function(pContext, pEntries, pUsage, pKind) {
        var candidates = this.FilterEntries(pEntries, pUsage, pKind, true);
        var weighted = [];

        for(var index = 0; index < candidates.length; ++index) {
            weighted.push({
                entry: candidates[index],
                weight: this.EntryWeight(candidates[index], pUsage, pKind)
            });
        }

        return this.WeightedPick(pContext.Random, weighted);
    },

    ClampPoint: function(pContext, pPoint, pMargin) {
        var margin = pMargin || 1;
        return {
            x: this.Clamp(Math.round(pPoint.x), margin, Math.max(margin, pContext.Width - 1 - margin)),
            y: this.Clamp(Math.round(pPoint.y), margin, Math.max(margin, pContext.Height - 1 - margin))
        };
    },

    OffsetPoint: function(pContext, pPoint, pDistance, pIndex) {
        var directions = [
            { x: 1, y: 0 },
            { x: 0, y: 1 },
            { x: -1, y: 0 },
            { x: 0, y: -1 },
            { x: 1, y: 1 },
            { x: -1, y: 1 },
            { x: -1, y: -1 },
            { x: 1, y: -1 }
        ];
        var dir = directions[pIndex % directions.length];
        var distance = Math.max(0, Math.round(pDistance || 0));

        return this.ClampPoint(
            pContext,
            {
                x: pPoint.x + (dir.x * distance),
                y: pPoint.y + (dir.y * distance)
            },
            1
        );
    },

    DistanceForAnchor: function(pContext, pEntry, pAnchorKind, pFallback) {
        var stats = null;

        if(pAnchorKind === "route")
            stats = pEntry.nearestRoute;
        else if(pAnchorKind === "objective")
            stats = pEntry.nearestObjective;
        else if(pAnchorKind === "structure")
            stats = pEntry.nearestStructure;

        return this.PickStatNumber(pContext.Random, stats, false, pFallback || 2);
    },

    RoutePoint: function(pRoutePlan, pIndex, pCount) {
        var path = pRoutePlan && pRoutePlan.routePath ? pRoutePlan.routePath : [];
        var beats = pRoutePlan && pRoutePlan.routeBeats ? pRoutePlan.routeBeats : [];
        var fraction = pCount <= 1 ? 0.5 : (pIndex + 1) / (pCount + 1);
        var index;

        if(path.length) {
            index = Math.max(0, Math.min(path.length - 1, Math.round((path.length - 1) * fraction)));
            return path[index];
        }
        if(beats.length) {
            index = Math.max(0, Math.min(beats.length - 1, Math.round((beats.length - 1) * fraction)));
            return beats[index].point;
        }

        return null;
    },

    ObjectivePoint: function(pObjectivePlan, pIndex) {
        var doors = pObjectivePlan && pObjectivePlan.doors ? pObjectivePlan.doors : [];
        var objectives = pObjectivePlan && pObjectivePlan.objectives ? pObjectivePlan.objectives : [];
        var structures = pObjectivePlan && pObjectivePlan.structures ? pObjectivePlan.structures : [];

        if(doors.length)
            return doors[pIndex % doors.length].point;
        if(objectives.length)
            return objectives[pIndex % objectives.length].point;
        if(structures.length) {
            var footprint = structures[pIndex % structures.length].footprint;
            return {
                x: Math.round(footprint.x + footprint.width / 2),
                y: Math.round(footprint.y + footprint.height / 2)
            };
        }

        return null;
    },

    StructurePoint: function(pObjectivePlan, pIndex) {
        var structures = pObjectivePlan && pObjectivePlan.structures ? pObjectivePlan.structures : [];
        if(!structures.length)
            return this.ObjectivePoint(pObjectivePlan, pIndex);

        var footprint = structures[pIndex % structures.length].footprint;
        return {
            x: Math.round(footprint.x + footprint.width / 2),
            y: Math.round(footprint.y + footprint.height / 2)
        };
    },

    MobilityAssetPoint: function(pPlan, pKind) {
        var routePlan = pPlan.routePlan || {};
        var mobilityPlan = pPlan.mobilityPlan || routePlan.mobilityPlan || {};
        var assets = mobilityPlan.requiredAssets || mobilityPlan.assetOrdering || [];

        for(var index = 0; index < assets.length; ++index) {
            if((pKind && (assets[index].kind === pKind || assets[index].name === pKind)) ||
                (!pKind && assets[index].point))
                return assets[index].point;
        }

        return null;
    },

    TargetTileCount: function(pContext, pPlan, pDynamicTargets) {
        var intentDynamic = pPlan.intent ? pPlan.intent.dynamicTerrain || {} : {};
        var target = this.NumberOrNull(intentDynamic.swapTileTarget);

        if(target === null)
            target = this.PickStatNumber(pContext.Random, pDynamicTargets ? pDynamicTargets.swapTileCount : null, true, 0);

        return Math.max(0, Math.round(target || 0));
    },

    ElementTileCount: function(pRemaining, pElementCount, pIndex, pEntry) {
        var remainingElements = Math.max(1, pElementCount - pIndex);
        var target = Math.max(1, Math.round(pRemaining / remainingElements));
        var observed = Math.max(1, Math.round(Number(pEntry.count || target)));

        return Math.max(1, Math.min(observed, target));
    },

    StateValidationFor: function(pPlacementKind, pPlan, pEntry) {
        var unlock = pPlacementKind === "route_gate" || pPlacementKind === "lowering_terrain";
        var objectiveGate = pPlacementKind === "objective_gate";

        return {
            preStateRouteMayBeBlocked: unlock,
            postStateRouteMustConnect: unlock,
            objectiveCompletionStateMustExist: objectiveGate || unlock,
            sourcePassability: pEntry.sourcePassability || "",
            targetPassability: pEntry.targetPassability || "",
            sourceVisual: pEntry.sourceVisual || "",
            targetVisual: pEntry.targetVisual || "",
            requiresRuntimeSwpPair: true,
            hardGate: unlock || objectiveGate || (pPlan.intent && pPlan.intent.dynamicTerrainMode === "route_breakable_or_lowering")
        };
    },

    MakeElement: function(pContext, pPlan, pEntry, pAnchor, pAnchorKind, pPlacementKind, pTileCount, pIndex, pAnchorId) {
        var distance = this.DistanceForAnchor(pContext, pEntry, pAnchorKind, pPlacementKind === "route_gate" ? 1 : 2);
        var point = this.OffsetPoint(pContext, pAnchor, distance, pIndex);

        return {
            id: "dynamic_" + pIndex,
            placementKind: pPlacementKind,
            kind: pEntry.kind || "dynamic_pair",
            usage: pEntry.usage || "",
            sourceTileId: pEntry.sourceTileId,
            targetTileId: pEntry.targetTileId,
            sourceVisual: pEntry.sourceVisual || "",
            targetVisual: pEntry.targetVisual || "",
            sourcePassability: pEntry.sourcePassability || "",
            targetPassability: pEntry.targetPassability || "",
            anchorKind: pAnchorKind,
            anchorId: pAnchorId || null,
            anchorPoint: { x: pAnchor.x, y: pAnchor.y },
            point: point,
            tileCount: Math.max(1, Math.round(pTileCount || 1)),
            shape: this.ShapeFor(pPlacementKind, pEntry),
            originalCount: pEntry.count || 0,
            originalMapCount: pEntry.mapCount || 0,
            breakableRouteMapCount: pEntry.breakableRouteMapCount || 0,
            nearestRouteTarget: this.RangeSummary(pEntry.nearestRoute),
            nearestObjectiveTarget: this.RangeSummary(pEntry.nearestObjective),
            nearestStructureTarget: this.RangeSummary(pEntry.nearestStructure),
            stateValidation: this.StateValidationFor(pPlacementKind, pPlan, pEntry),
            targetRefs: ["targets.dynamicTerrain.dynamicPairGrammar"]
        };
    },

    ShapeByPlacementKind: {
        route_gate: "gate_band_across_route",
        objective_gate: "structure_or_objective_state_cluster",
        destructible_cover: "cover_cluster_near_route_or_objective",
        lowering_terrain: "breakable_or_lowering_route_patch"
    },

    ShapeFor: function(pPlacementKind, pEntry) {
        var shape = this.ShapeByPlacementKind[pPlacementKind];
        if(shape)
            return shape;
        if(pEntry.kind === "water_or_bridge_state")
            return "bridge_or_water_state_patch";
        return "ambient_state_cluster";
    },

    PushElement: function(pOut, pElement) {
        pOut.swapPairs.push(pElement);

        if(pElement.placementKind === "route_gate")
            pOut.routeGates.push(pElement);
        else if(pElement.placementKind === "objective_gate")
            pOut.objectiveGates.push(pElement);
        else if(pElement.placementKind === "destructible_cover")
            pOut.destructibleCover.push(pElement);
        else if(pElement.placementKind === "lowering_terrain")
            pOut.loweringTerrain.push(pElement);
        else if(pElement.kind === "water_or_bridge_state")
            pOut.waterBridgeStates.push(pElement);
        else
            pOut.ambientStateSwaps.push(pElement);
    },

    AddObjectiveGates: function(pContext, pPlan, pEntries, pOut, pBudget) {
        var objectivePlan = pPlan.objectivePlan || {};
        var structures = objectivePlan.structures || [];
        var objectives = objectivePlan.objectives || [];
        var desired = Math.min(
            Math.max(structures.length ? 1 : 0, objectives.length ? 1 : 0),
            Math.max(1, Math.min(4, Math.ceil(pBudget.target / 18)))
        );

        if(!desired || pBudget.remaining <= 0)
            return;

        for(var index = 0; index < desired && pBudget.remaining > 0; ++index) {
            var entry = this.PickEntry(pContext, pEntries, "objective_structure_gate", null);
            if(!entry)
                return;

            var anchor = this.StructurePoint(objectivePlan, index) ||
                this.ObjectivePoint(objectivePlan, index) ||
                this.RoutePoint(pPlan.routePlan || {}, index, desired) ||
                { x: Math.floor(pContext.Width / 2), y: Math.floor(pContext.Height / 2) };
            var count = this.ElementTileCount(pBudget.remaining, desired, index, entry);
            var element = this.MakeElement(
                pContext,
                pPlan,
                entry,
                anchor,
                structures.length ? "structure" : "objective",
                "objective_gate",
                count,
                pOut.swapPairs.length,
                structures[index % Math.max(1, structures.length)] ? structures[index % structures.length].id : null
            );

            this.PushElement(pOut, element);
            pBudget.remaining -= count;
        }
    },

    AddRouteGate: function(pContext, pPlan, pEntries, pOut, pBudget, pRequired) {
        if(!pRequired && pBudget.remaining <= 12)
            return;

        var entry = this.PickEntry(pContext, pEntries, "route_unlock_candidate", null);
        if(!entry)
            entry = this.PickEntry(pContext, pEntries, null, "terrain_state_change");
        if(!entry)
            return;

        var anchor = this.MobilityAssetPoint(pPlan, "breakable_or_lowering_terrain") ||
            this.MobilityAssetPoint(pPlan, "dynamic_unlock") ||
            this.RoutePoint(pPlan.routePlan || {}, 1, 3) ||
            { x: Math.floor(pContext.Width / 2), y: Math.floor(pContext.Height / 2) };
        var count = Math.max(1, Math.min(pBudget.remaining, this.ElementTileCount(pBudget.remaining, 3, 0, entry)));
        var placementKind = pRequired || pPlan.intent.dynamicTerrainMode === "route_breakable_or_lowering" ?
            "lowering_terrain" :
            "route_gate";
        var element = this.MakeElement(
            pContext,
            pPlan,
            entry,
            anchor,
            "route",
            placementKind,
            count,
            pOut.swapPairs.length,
            "mobility_dynamic_unlock"
        );

        this.PushElement(pOut, element);
        pBudget.remaining -= count;
    },

    AddDestructibleCover: function(pContext, pPlan, pEntries, pOut, pBudget) {
        if(pBudget.remaining <= 0)
            return;

        var candidates = this.FilterEntries(pEntries, null, "destructible_cover_to_ground", false);
        if(!candidates.length)
            return;

        var desired = Math.max(1, Math.min(3, Math.ceil(pBudget.remaining / 14)));

        for(var index = 0; index < desired && pBudget.remaining > 0; ++index) {
            var entry = this.PickEntry(pContext, candidates, null, "destructible_cover_to_ground");
            if(!entry)
                return;

            var objectiveAnchor = this.ObjectivePoint(pPlan.objectivePlan || {}, index);
            var routeAnchor = this.RoutePoint(pPlan.routePlan || {}, index, desired);
            var anchor = (index % 2 === 0 && objectiveAnchor) ? objectiveAnchor : (routeAnchor || objectiveAnchor);
            if(!anchor)
                anchor = { x: Math.floor(pContext.Width / 2), y: Math.floor(pContext.Height / 2) };

            var count = this.ElementTileCount(pBudget.remaining, desired, index, entry);
            var element = this.MakeElement(
                pContext,
                pPlan,
                entry,
                anchor,
                objectiveAnchor ? "objective" : "route",
                "destructible_cover",
                count,
                pOut.swapPairs.length,
                null
            );

            this.PushElement(pOut, element);
            pBudget.remaining -= count;
        }
    },

    AddAmbientStates: function(pContext, pPlan, pEntries, pOut, pBudget) {
        var desired = Math.min(8, Math.max(0, Math.ceil(pBudget.remaining / 8)));

        for(var index = 0; index < desired && pBudget.remaining > 0; ++index) {
            var preferredKind = index % 3 === 0 ? "water_or_bridge_state" :
                (index % 3 === 1 ? "terrain_state_change" : null);
            var entry = this.PickEntry(pContext, pEntries, null, preferredKind);
            if(!entry)
                return;

            var routeAnchor = this.RoutePoint(pPlan.routePlan || {}, index + 1, desired + 1) ||
                { x: Math.floor(pContext.Width / 2), y: Math.floor(pContext.Height / 2) };
            var count = this.ElementTileCount(pBudget.remaining, desired, index, entry);
            var element = this.MakeElement(
                pContext,
                pPlan,
                entry,
                routeAnchor,
                "route",
                "ambient_state",
                count,
                pOut.swapPairs.length,
                null
            );

            this.PushElement(pOut, element);
            pBudget.remaining -= count;
        }
    },

    ValidateElements: function(pElements) {
        var reasons = [];

        for(var index = 0; index < pElements.length; ++index) {
            var element = pElements[index];
            if(element.sourceTileId === undefined || element.targetTileId === undefined)
                reasons.push("swp_state_invalid:" + element.id);
            if(!element.usage || !element.kind)
                reasons.push("dynamic_pair_context_mismatch:" + element.id);
        }

        return reasons;
    },

    PlannedTileCount: function(pElements) {
        var total = 0;
        for(var index = 0; index < pElements.length; ++index)
            total += Math.max(0, Number(pElements[index].tileCount || 0));
        return total;
    },

    Plan: function(pContext, pPlan) {
        var self = MapGen.Grammar.DynamicTerrain;
        var profile = pContext.Profile || {};
        var target = profile.TargetPack || {};
        var targets = target.targets || {};
        var dynamicTargets = targets.dynamicTerrain || {};
        var entries = dynamicTargets.dynamicPairGrammar || [];
        var intent = pPlan.intent || {};
        var outlierReasons = [];
        var notes = [];
        var targetTileCount = self.TargetTileCount(pContext, pPlan, dynamicTargets);
        var requiresUnlock = !!(intent.guardrails && intent.guardrails.requiresDynamicUnlock) ||
            intent.dynamicTerrainMode === "route_breakable_or_lowering";
        var out = {
            swapPairs: [],
            routeGates: [],
            objectiveGates: [],
            destructibleCover: [],
            loweringTerrain: [],
            waterBridgeStates: [],
            ambientStateSwaps: []
        };
        var budget = {
            target: targetTileCount,
            remaining: targetTileCount
        };

        if(!entries.length)
            outlierReasons.push("dynamic_pair_unknown");

        if(entries.length && targetTileCount > 0) {
            self.AddObjectiveGates(pContext, pPlan, entries, out, budget);
            self.AddRouteGate(pContext, pPlan, entries, out, budget, requiresUnlock);
            self.AddDestructibleCover(pContext, pPlan, entries, out, budget);
            self.AddAmbientStates(pContext, pPlan, entries, out, budget);
        }

        if(requiresUnlock && !out.routeGates.length && !out.loweringTerrain.length)
            outlierReasons.push("dynamic_unlock_dead_end");

        var validationReasons = self.ValidateElements(out.swapPairs);
        for(var index = 0; index < validationReasons.length; ++index)
            outlierReasons.push(validationReasons[index]);

        if(target.officialDataConfidence === "limited")
            notes.push("profile_limited_dynamic_source_maps");

        return {
            name: "dynamicTerrainPlan",
            status: "ready",
            dynamicTerrainMode: intent.dynamicTerrainMode || "none",
            swapTileTarget: targetTileCount,
            plannedSwapTileCount: self.PlannedTileCount(out.swapPairs),
            swapPairs: out.swapPairs,
            routeGates: out.routeGates,
            objectiveGates: out.objectiveGates,
            destructibleCover: out.destructibleCover,
            loweringTerrain: out.loweringTerrain,
            waterBridgeStates: out.waterBridgeStates,
            ambientStateSwaps: out.ambientStateSwaps,
            stateValidation: {
                required: true,
                status: "ready",
                validatePreAndPostRoutes: out.routeGates.length > 0 || out.loweringTerrain.length > 0,
                validateObjectiveCompletionState: out.objectiveGates.length > 0 || out.loweringTerrain.length > 0,
                validateRuntimeSwpPairs: out.swapPairs.length > 0,
                source: "targets.dynamicTerrain.dynamicPairGrammar"
            },
            targetRefs: [
                "profiles." + (pPlan.targetPackProfileName || profile.TargetPackProfile || "") + ".targets.dynamicTerrain",
                "intent.dynamicTerrain",
                "routePlan.mobilityPlan",
                "objectivePlan"
            ],
            notes: notes,
            outlierReasons: outlierReasons
        };
    }
};
