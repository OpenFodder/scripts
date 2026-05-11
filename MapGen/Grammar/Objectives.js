var MapGen = MapGen || {};
MapGen.Grammar = MapGen.Grammar || {};

MapGen.Grammar.Objectives = {

    HasOwn: function(pObject, pKey) { return MapGen.Grammar.Util.HasOwn(pObject, pKey); },

    NumberOrNull: function(pValue) { return MapGen.Grammar.Util.NumberOrNull(pValue); },

    Clamp: function(pValue, pMin, pMax) { return MapGen.Grammar.Util.Clamp(pValue, pMin, pMax); },

    Round: function(pValue, pPlaces) { return MapGen.Grammar.Util.Round(pValue, pPlaces); },

    StatRange: function(pStats, pPreferWide) { return MapGen.Grammar.Util.StatRange(pStats, pPreferWide); },

    PickStatNumber: function(pRandom, pStats, pInteger, pFallback) {
        return MapGen.Grammar.Util.PickStatNumberOuter(pRandom, pStats, pInteger, pFallback);
    },

    RangeSummary: function(pStats) { return MapGen.Grammar.Util.RangeSummary(pStats); },

    PickMetric: function(pContext, pStats, pInteger, pFallback) {
        return MapGen.Grammar.Util.PickMetricOuter(pContext, pStats, pInteger, pFallback);
    },

    WeightedPick: function(pRandom, pWeights, pFallback) {
        var entries = [];
        var total = 0;
        var key;

        for(key in (pWeights || {})) {
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

    TemplateWeight: function(pTemplate, pIntent) {
        var weight = Math.max(1, Number(pTemplate.occurrenceCount || pTemplate.mapCount || 1));
        var category = String(pTemplate.primaryCategory || "");
        var objective = pIntent ? String(pIntent.objectiveLabel || "") : "";

        if(objective === "destroy_buildings" &&
            (category.indexOf("barracks") >= 0 ||
                category.indexOf("bunker") >= 0 ||
                category.indexOf("structure") >= 0))
            weight *= 2.0;
        if(objective === "civilian_delivery" && category.indexOf("hut") >= 0)
            weight *= 1.7;
        if(objective === "rescue_hostages" && category.indexOf("bunker") >= 0)
            weight *= 1.6;

        return weight;
    },

    PickTemplate: function(pContext, pTemplates, pIntent, pMaxWidth, pMaxHeight) {
        var weights = {};
        var byId = {};

        for(var index = 0; index < (pTemplates || []).length; ++index) {
            var template = pTemplates[index];
            if(!template || !template.layoutTemplateId)
                continue;

            var size = this.TemplateSize(template);
            if(size.width > pMaxWidth || size.height > pMaxHeight)
                continue;

            weights[template.layoutTemplateId] = this.TemplateWeight(template, pIntent);
            byId[template.layoutTemplateId] = template;
        }

        var picked = this.WeightedPick(pContext.Random, weights, null);
        return picked ? byId[picked] : null;
    },

    TemplateSize: function(pTemplate) {
        var widthRange = this.StatRange(pTemplate ? pTemplate.width : null, false) ||
            this.StatRange(pTemplate ? pTemplate.width : null, true);
        var heightRange = this.StatRange(pTemplate ? pTemplate.height : null, false) ||
            this.StatRange(pTemplate ? pTemplate.height : null, true);
        var width = widthRange ? Math.ceil(widthRange[1]) : 0;
        var height = heightRange ? Math.ceil(heightRange[1]) : 0;
        var layout = pTemplate && pTemplate.structureLayout ? pTemplate.structureLayout : [];

        for(var index = 0; index < layout.length; ++index) {
            var item = layout[index];
            var offset = item.offset || [0, 0];
            var size = item.size || [1, 1];
            width = Math.max(width, Number(offset[0] || 0) + Number(size[0] || 1));
            height = Math.max(height, Number(offset[1] || 0) + Number(size[1] || 1));
        }

        return {
            width: Math.max(1, width),
            height: Math.max(1, height)
        };
    },

    RectIntersects: function(pA, pB, pPadding) {
        var pad = pPadding || 0;
        return !(
            pA.x + pA.width + pad <= pB.x ||
            pB.x + pB.width + pad <= pA.x ||
            pA.y + pA.height + pad <= pB.y ||
            pB.y + pB.height + pad <= pA.y
        );
    },

    ClampRectOrigin: function(pContext, pX, pY, pWidth, pHeight) {
        return {
            x: this.Clamp(Math.round(pX), 1, Math.max(1, pContext.Width - pWidth - 2)),
            y: this.Clamp(Math.round(pY), 1, Math.max(1, pContext.Height - pHeight - 2))
        };
    },

    ObjectiveBeats: function(pRoutePlan) {
        var beats = pRoutePlan && pRoutePlan.routeBeats ? pRoutePlan.routeBeats : [];
        var result = [];

        for(var index = 0; index < beats.length; ++index) {
            var beat = beats[index];
            if(beat.screenType === "objective_arena" ||
                beat.screenType === "objective_combat_screen" ||
                beat.routePhase === "objective_push" ||
                beat.intendedEnemyPressure > 0)
                result.push(beat);
        }

        if(!result.length && beats.length)
            result.push(beats[beats.length - 1]);

        return result;
    },

    CompoundCountTarget: function(pContext, pIntent, pStructureTargets, pObjectiveBeats) {
        var guardrails = pIntent ? pIntent.guardrails || {} : {};
        var ranges = pStructureTargets ? pStructureTargets.ranges || {} : {};
        var iceLayout = String(guardrails.iceLayoutStyle || "");
        var profile = pContext ? pContext.Profile || {} : {};
        var progressionFloor = Math.max(0, Math.floor(Number(profile.MapScaleCompoundFloor || 0)));
        var count = this.PickStatNumber(
            pContext.Random,
            ranges.compoundsPerMap,
            true,
            0
        );

        if(guardrails.allowStructureCompounds === false)
            return 0;
        if(pIntent && pIntent.objectiveLabel === "destroy_buildings") {
            count = Math.max(1, count);
            count = Math.max(count, progressionFloor);
        }

        if(iceLayout) {
            var maxIceCompounds = (iceLayout === "ice_outpost" || iceLayout === "ice_compound_raid") ? 2 : 1;
            maxIceCompounds = Math.max(maxIceCompounds, progressionFloor);
            count = Math.min(count, maxIceCompounds);
            if(pIntent && pIntent.objectiveLabel === "destroy_buildings")
                count = Math.max(1, count);
        }

        return Math.max(0, Math.min(count, Math.max(0, pObjectiveBeats.length)));
    },

    PlaceCompounds: function(pContext, pPlan, pStructureTargets, pObjectiveBeats, pOutlierReasons) {
        var intent = pPlan.intent || {};
        var guardrails = intent.guardrails || {};
        var iceLayout = String(guardrails.iceLayoutStyle || "");
        var isIce = !!iceLayout;
        var templates = pStructureTargets && pStructureTargets.layoutTemplates ? pStructureTargets.layoutTemplates : [];
        var count = this.CompoundCountTarget(pContext, intent, pStructureTargets, pObjectiveBeats);
        var compounds = [];
        var occupied = [];
        var maxWidth = Math.max(3, pContext.Width - 4);
        var maxHeight = Math.max(3, pContext.Height - 4);
        var templateMaxWidth = isIce ? Math.min(maxWidth, iceLayout === "ice_outpost" ? 18 : 12) : maxWidth;
        var templateMaxHeight = isIce ? Math.min(maxHeight, iceLayout === "ice_outpost" ? 14 : 10) : maxHeight;
        var overlapPadding = isIce ? 8 : 3;
        var attemptLimit = isIce ? 18 : 8;
        var initialJitter = isIce ? 5 : 3;
        var shiftJitter = isIce ? 12 : 8;

        if(count > 0 && !templates.length) {
            pOutlierReasons.push("compound_template_mismatch");
            return compounds;
        }

        for(var index = 0; index < count; ++index) {
            var beat = pObjectiveBeats[Math.min(pObjectiveBeats.length - 1, Math.floor((index + 0.5) * pObjectiveBeats.length / count))];
            var template = this.PickTemplate(pContext, templates, intent, templateMaxWidth, templateMaxHeight) ||
                this.PickTemplate(pContext, templates, intent, maxWidth, maxHeight);
            if(!template) {
                pOutlierReasons.push("compound_template_mismatch");
                continue;
            }

            var size = this.TemplateSize(template);
            var origin = this.ClampRectOrigin(
                pContext,
                beat.point.x - (size.width / 2) + pContext.Random.Int(-initialJitter, initialJitter),
                beat.point.y - (size.height / 2) + pContext.Random.Int(-initialJitter, initialJitter),
                size.width,
                size.height
            );
            var rect = { x: origin.x, y: origin.y, width: size.width, height: size.height };
            var attempts = 0;
            var overlaps = false;

            while(attempts < attemptLimit) {
                overlaps = false;
                for(var r = 0; r < occupied.length; ++r) {
                    if(this.RectIntersects(rect, occupied[r], overlapPadding)) {
                        overlaps = true;
                        break;
                    }
                }
                if(!overlaps)
                    break;

                origin = this.ClampRectOrigin(
                    pContext,
                    origin.x + pContext.Random.Int(-shiftJitter, shiftJitter),
                    origin.y + pContext.Random.Int(-shiftJitter, shiftJitter),
                    size.width,
                    size.height
                );
                rect = { x: origin.x, y: origin.y, width: size.width, height: size.height };
                ++attempts;
            }

            if(overlaps && isIce) {
                pOutlierReasons.push("compound_spacing_mismatch");
                continue;
            }

            occupied.push(rect);
            compounds.push({
                id: "compound_" + compounds.length,
                index: compounds.length,
                routeBeatId: beat.id,
                routeBeatIndex: beat.index,
                layoutTemplateId: template.layoutTemplateId,
                primaryCategory: template.primaryCategory || "",
                categoryTags: template.categoryTags || [],
                anchor: { x: origin.x, y: origin.y },
                bounds: rect,
                structureLayout: template.structureLayout || [],
                terrainContext: template.terrainContext || null,
                roleOffsetTargets: template.roleOffsetTargets || {},
                sourceOccurrenceCount: template.occurrenceCount || 0
            });
        }

        return compounds;
    },

    BuildStructures: function(pCompounds) {
        var structures = [];

        for(var c = 0; c < pCompounds.length; ++c) {
            var compound = pCompounds[c];
            var layout = compound.structureLayout || [];

            for(var index = 0; index < layout.length; ++index) {
                var item = layout[index];
                var offset = item.offset || [0, 0];
                var size = item.size || [1, 1];
                structures.push({
                    id: "structure_" + structures.length,
                    compoundId: compound.id,
                    compoundIndex: compound.index,
                    name: item.name || "Structure",
                    templateId: item.templateId || "",
                    source: item.source || "",
                    stampRole: item.stampRole || null,
                    stampDestroyed: item.stampDestroyed || null,
                    footprint: {
                        x: compound.anchor.x + Number(offset[0] || 0),
                        y: compound.anchor.y + Number(offset[1] || 0),
                        width: Number(size[0] || 1),
                        height: Number(size[1] || 1)
                    },
                    objectiveEligible: true
                });
            }
        }

        return structures;
    },

    OffsetPoint: function(pContext, pOrigin, pOffset, pFallback) {
        var offset = pOffset || [0, 0];
        var x = pOrigin.x + Number(offset[0] || 0);
        var y = pOrigin.y + Number(offset[1] || 0);

        if(pOffset === null && pFallback)
        {
            x = pFallback.x;
            y = pFallback.y;
        }

        return {
            x: this.Clamp(Math.round(x), 1, pContext.Width - 2),
            y: this.Clamp(Math.round(y), 1, pContext.Height - 2)
        };
    },

    RoleOffsets: function(pRoleTargets, pRoleName) {
        var role = pRoleTargets ? pRoleTargets[pRoleName] : null;
        return role && role.topOffsets ? role.topOffsets : [];
    },

    BuildDoorAndRoofPlans: function(pContext, pCompounds, pStructures) {
        var doors = [];
        var roofs = [];

        for(var c = 0; c < pCompounds.length; ++c) {
            var compound = pCompounds[c];
            var roleTargets = compound.roleOffsetTargets || {};
            var doorOffsets = this.RoleOffsets(roleTargets, "objective_doors");
            var civilianDoorOffsets = this.RoleOffsets(roleTargets, "civilian_doors");
            var roofOffsets = this.RoleOffsets(roleTargets, "building_roofs");
            var offsets;
            var index;

            offsets = doorOffsets.length ? doorOffsets : [];
            for(index = 0; index < offsets.length; ++index) {
                doors.push({
                    id: "door_" + doors.length,
                    compoundId: compound.id,
                    role: "objective_door",
                    spriteType: offsets[index].type || null,
                    spriteName: offsets[index].name || "objective_door",
                    point: this.OffsetPoint(pContext, compound.anchor, offsets[index].offset || [0, 0], null),
                    source: "structureCompound.roleOffsetTargets.objective_doors"
                });
            }

            offsets = civilianDoorOffsets.length ? civilianDoorOffsets : [];
            for(index = 0; index < offsets.length; ++index) {
                doors.push({
                    id: "door_" + doors.length,
                    compoundId: compound.id,
                    role: "civilian_door",
                    spriteType: offsets[index].type || null,
                    spriteName: offsets[index].name || "civilian_door",
                    point: this.OffsetPoint(pContext, compound.anchor, offsets[index].offset || [0, 0], null),
                    source: "structureCompound.roleOffsetTargets.civilian_doors"
                });
            }

            offsets = roofOffsets.length ? roofOffsets : [];
            for(index = 0; index < offsets.length; ++index) {
                roofs.push({
                    id: "roof_" + roofs.length,
                    compoundId: compound.id,
                    role: "building_roof",
                    spriteType: offsets[index].type || null,
                    spriteName: offsets[index].name || "building_roof",
                    point: this.OffsetPoint(pContext, compound.anchor, offsets[index].offset || [0, 0], null),
                    source: "structureCompound.roleOffsetTargets.building_roofs"
                });
            }
        }

        for(var s = 0; s < pStructures.length && doors.length < pStructures.length; ++s) {
            var structure = pStructures[s];
            doors.push({
                id: "door_" + doors.length,
                compoundId: structure.compoundId,
                role: "objective_door",
                spriteType: null,
                spriteName: "objective_door_fallback",
                point: {
                    x: Math.round(structure.footprint.x + (structure.footprint.width / 2)),
                    y: Math.round(structure.footprint.y + structure.footprint.height)
                },
                source: "structure_footprint_fallback"
            });
        }

        return {
            doors: doors,
            roofs: roofs
        };
    },

    StandaloneDoorPoint: function(pContext, pObjectiveBeats, pIndex, pCount) {
        var beat = pObjectiveBeats.length ?
            pObjectiveBeats[Math.min(pObjectiveBeats.length - 1, Math.floor((pIndex + 0.5) * pObjectiveBeats.length / Math.max(1, pCount)))] :
            null;
        var anchor = beat ? beat.point : {
            x: Math.floor(pContext.Width / 2),
            y: Math.floor(pContext.Height / 2)
        };
        var offsets = [
            { x: 0, y: 0 },
            { x: 7, y: 2 },
            { x: -7, y: 2 },
            { x: 3, y: -5 }
        ];
        var offset = offsets[pIndex % offsets.length];

        return {
            x: this.Clamp(anchor.x + offset.x, 2, pContext.Width - 3),
            y: this.Clamp(anchor.y + offset.y, 2, pContext.Height - 3)
        };
    },

    BuildStandaloneDoorAndRoofPlans: function(pContext, pTargets, pObjectiveBeats, pOutlierReasons) {
        var roleCounts = pTargets && pTargets.styleSpriteRoles ? pTargets.styleSpriteRoles.roleCounts || {} : {};
        var placementRoles = pTargets && pTargets.spriteRolePlacement ? pTargets.spriteRolePlacement.roles || {} : {};
        var doorStats = placementRoles.objective_doors && placementRoles.objective_doors.count ?
            placementRoles.objective_doors.count :
            roleCounts.objective_doors;
        var roofStats = placementRoles.building_roofs && placementRoles.building_roofs.count ?
            placementRoles.building_roofs.count :
            roleCounts.building_roofs;
        var doorCount = this.PickStatNumber(pContext.Random, doorStats, true, 1);
        var roofCount = this.PickStatNumber(pContext.Random, roofStats, true, Math.max(0, doorCount - 1));
        var doors = [];
        var roofs = [];
        var index;
        var beachBuildingTarget = Number(
            pContext.Profile && pContext.Profile.GrammarBeachBuildingTarget
        );
        var standaloneLimit = Math.max(4, Math.min(
            8,
            Math.floor(Number(
                pContext.Profile && pContext.Profile.StructureMaxClearings || 4
            ))
        ));

        doorCount = Math.max(1, Math.min(standaloneLimit, doorCount));
        roofCount = Math.max(0, Math.min(standaloneLimit, roofCount));

        if(pContext.Profile &&
            pContext.Profile.TargetPackProfile === "grammar_beach" &&
            isFinite(beachBuildingTarget)) {
            doorCount = Math.max(1, Math.min(standaloneLimit, Math.floor(beachBuildingTarget)));
            roofCount = doorCount;
        }

        for(index = 0; index < doorCount; ++index) {
            var point = this.StandaloneDoorPoint(pContext, pObjectiveBeats, index, doorCount);
            doors.push({
                id: "door_" + doors.length,
                compoundId: null,
                role: "objective_door",
                spriteType: 20,
                spriteName: "BuildingDoor",
                point: point,
                source: "standalone_beach_objective_doors"
            });
        }

        for(index = 0; index < roofCount; ++index) {
            var door = doors[index % doors.length];
            roofs.push({
                id: "roof_" + roofs.length,
                compoundId: null,
                role: "building_roof",
                spriteType: 15,
                spriteName: "BuildingRoof",
                point: {
                    x: this.Clamp(door.point.x + ((index % 2) ? 2 : -2), 2, pContext.Width - 3),
                    y: this.Clamp(door.point.y - 2, 2, pContext.Height - 3)
                },
                source: "standalone_beach_building_roofs"
            });
        }

        if(!doors.length)
            pOutlierReasons.push("objective_support_missing");

        return {
            doors: doors,
            roofs: roofs
        };
    },

    InteractionClassWeights: function(pObjectiveInteraction, pIntent) {
        var source = pObjectiveInteraction ? pObjectiveInteraction.interactionClassCounts || {} : {};
        var objective = pIntent ? String(pIntent.objectiveLabel || "") : "";
        var weights = {};
        var key;

        for(key in source) {
            if(this.HasOwn(source, key))
                weights[key] = Number(source[key]);
        }

        if(objective === "destroy_buildings") {
            weights.ranged_fire_structure = Number(weights.ranged_fire_structure || 0) * 2.0 + 1;
            weights.explosive_supported_structure = Number(weights.explosive_supported_structure || 0) * 1.6;
        }
        else if(objective === "enemy_heavy") {
            weights.ranged_enemy_engagement = Number(weights.ranged_enemy_engagement || 0) * 2.0 + 1;
        }
        else if(objective === "civilian_delivery") {
            weights.civilian_home_interaction = Number(weights.civilian_home_interaction || 0) * 3.0 + 1;
        }
        else if(objective === "rescue_hostages") {
            weights.generic_reachable_interaction = Number(weights.generic_reachable_interaction || 0) + 1;
        }

        return weights;
    },

    BuildObjectiveTargets: function(pContext, pPlan, pObjectiveInteraction, pCompounds, pStructures, pDoorPlans, pObjectiveBeats) {
        var intent = pPlan.intent || {};
        var routeShape = intent.routeShape || {};
        var targetCount = Math.max(
            Number(routeShape.primaryGoalCountTarget || 1),
            this.PickStatNumber(pContext.Random, pObjectiveInteraction ? pObjectiveInteraction.objectiveCount : null, true, 1)
        );
        var weights = this.InteractionClassWeights(pObjectiveInteraction, intent);
        var objectives = [];
        var doors = pDoorPlans.doors || [];
        var index;
        var countRange;

        if(pContext &&
            pContext.Profile &&
            pContext.Profile.TargetPackProfile === "grammar_beach") {
            countRange = this.StatRange(pObjectiveInteraction ? pObjectiveInteraction.objectiveCount : null, false) ||
                this.StatRange(pObjectiveInteraction ? pObjectiveInteraction.objectiveCount : null, true);
            if(countRange)
                targetCount = this.Clamp(Math.round(targetCount), Math.ceil(countRange[0]), Math.floor(countRange[1]));
        }

        function pointCopy(pPoint) {
            return pPoint ? { x: pPoint.x, y: pPoint.y } : null;
        }

        if(intent.objectiveLabel === "destroy_buildings") {
            for(index = 0; index < doors.length && objectives.length < targetCount; ++index) {
                objectives.push({
                    id: "objective_" + objectives.length,
                    kind: doors[index].role === "civilian_door" ? "civilian_home_door" : "destroyable_structure_door",
                    interactionClass: "ranged_fire_structure",
                    point: pointCopy(doors[index].point),
                    sourceId: doors[index].id,
                    compoundId: doors[index].compoundId || null,
                    completableBy: ["ranged_fire", "explosive_support"],
                    runtimeCompletable: true
                });
            }

            for(index = 0; index < pStructures.length && objectives.length < targetCount; ++index) {
                var structure = pStructures[index];
                objectives.push({
                    id: "objective_" + objectives.length,
                    kind: "destroyable_structure",
                    interactionClass: this.WeightedPick(pContext.Random, weights, "ranged_fire_structure"),
                    point: {
                        x: Math.round(structure.footprint.x + (structure.footprint.width / 2)),
                        y: Math.round(structure.footprint.y + (structure.footprint.height / 2))
                    },
                    sourceId: structure.id,
                    compoundId: structure.compoundId,
                    completableBy: ["ranged_fire", "explosive_support"],
                    runtimeCompletable: true
                });
            }
        }

        if(intent.objectiveLabel === "civilian_delivery" && objectives.length < targetCount) {
            var homeBeat = pObjectiveBeats.length ? pObjectiveBeats[pObjectiveBeats.length - 1] : null;
            objectives.push({
                id: "objective_" + objectives.length,
                kind: "civilian_home",
                interactionClass: "civilian_home_interaction",
                point: homeBeat ? pointCopy(homeBeat.point) : { x: Math.floor(pContext.Width / 2), y: Math.floor(pContext.Height / 2) },
                sourceId: homeBeat ? homeBeat.id : null,
                compoundId: pCompounds.length ? pCompounds[pCompounds.length - 1].id : null,
                completableBy: ["civilian_delivery_route"],
                runtimeCompletable: true
            });
        }

        if(intent.objectiveLabel === "rescue_hostages" && objectives.length < targetCount) {
            var hostageBeat = pObjectiveBeats.length ? pObjectiveBeats[Math.max(0, pObjectiveBeats.length - 2)] : null;
            objectives.push({
                id: "objective_" + objectives.length,
                kind: "hostage_cluster",
                interactionClass: "generic_reachable_interaction",
                point: hostageBeat ? pointCopy(hostageBeat.point) : { x: Math.floor(pContext.Width / 2), y: Math.floor(pContext.Height / 2) },
                sourceId: hostageBeat ? hostageBeat.id : null,
                compoundId: pCompounds.length ? pCompounds[pCompounds.length - 1].id : null,
                completableBy: ["reach_and_extract"],
                runtimeCompletable: true
            });
        }

        index = 0;
        while(objectives.length < targetCount && pObjectiveBeats.length && index < targetCount * 2) {
            var beat = pObjectiveBeats[index % pObjectiveBeats.length];
            objectives.push({
                id: "objective_" + objectives.length,
                kind: "enemy_pressure_goal",
                interactionClass: this.WeightedPick(pContext.Random, weights, "ranged_enemy_engagement"),
                point: pointCopy(beat.point),
                sourceId: beat.id,
                compoundId: null,
                completableBy: ["ranged_enemy_engagement"],
                runtimeCompletable: true
            });
            ++index;
        }

        return {
            targetCount: targetCount,
            objectives: objectives
        };
    },

    FiringPointAround: function(pContext, pPoint, pIndex, pRadius) {
        var angle = (Math.PI * 2 * (pIndex / 8)) + (pIndex * 0.31);
        return {
            x: this.Clamp(Math.round(pPoint.x + Math.cos(angle) * pRadius), 1, pContext.Width - 2),
            y: this.Clamp(Math.round(pPoint.y + Math.sin(angle) * pRadius), 1, pContext.Height - 2)
        };
    },

    BuildFiringPositions: function(pContext, pObjectiveInteraction, pObjectives) {
        var target = this.PickStatNumber(
            pContext.Random,
            pObjectiveInteraction ? pObjectiveInteraction.meanSafeFiringPositionsRadius6 : null,
            true,
            Math.max(2, pObjectives.length * 2)
        );
        var count = Math.max(0, Math.min(Math.max(2, target), Math.max(2, pObjectives.length * 4)));
        var positions = [];
        var objectiveIndex = 0;

        while(positions.length < count && pObjectives.length) {
            var objective = pObjectives[objectiveIndex % pObjectives.length];
            var point = this.FiringPointAround(pContext, objective.point, positions.length, 6);
            positions.push({
                id: "firing_" + positions.length,
                objectiveId: objective.id,
                point: point,
                radiusTiles: 6,
                supportClass: objective.interactionClass,
                intendedLineOfFire: true,
                source: "objectiveInteraction.meanSafeFiringPositionsRadius6"
            });
            ++objectiveIndex;
        }

        return {
            target: target,
            positions: positions
        };
    },

    BuildSupportRoutes: function(pContext, pRoutePlan, pObjectives, pFiringPositions) {
        var routes = [];
        var route = MapGen.Grammar.Route;

        for(var index = 0; index < pFiringPositions.length; ++index) {
            var firing = pFiringPositions[index];
            var objective = null;
            for(var oi = 0; oi < pObjectives.length; ++oi) {
                if(pObjectives[oi].id === firing.objectiveId) {
                    objective = pObjectives[oi];
                    break;
                }
            }

            if(!objective)
                continue;

            routes.push({
                id: "support_route_" + routes.length,
                objectiveId: objective.id,
                firingPositionId: firing.id,
                mode: "foot",
                path: route && route.LinePoints ? route.LinePoints(firing.point, objective.point, false) : [firing.point, objective.point],
                purpose: "safe_firing_position_to_objective"
            });
        }

        return routes;
    },

    ObjectiveKinds: function(pObjectives) {
        var kinds = [];

        for(var index = 0; index < pObjectives.length; ++index) {
            var kind = String(pObjectives[index].kind || "unknown");
            var exists = false;

            for(var existing = 0; existing < kinds.length; ++existing) {
                if(kinds[existing] === kind) {
                    exists = true;
                    break;
                }
            }

            if(!exists)
                kinds.push(kind);
        }

        return kinds;
    },

    Plan: function(pContext, pPlan) {
        var self = MapGen.Grammar.Objectives;
        var profile = pContext.Profile || {};
        var target = profile.TargetPack || {};
        var targets = target.targets || {};
        var intent = pPlan.intent || {};
        var routePlan = pPlan.routePlan || {};
        var structureTargets = targets.structureCompounds || {};
        var objectiveInteraction = targets.objectiveInteraction || {};
        var outlierReasons = [];
        var notes = [];
        var objectiveBeats = self.ObjectiveBeats(routePlan);
        var allowCompounds = !(intent.guardrails && intent.guardrails.allowStructureCompounds === false);

        if(!targets.objectiveInteraction)
            outlierReasons.push("objective_truth_missing");
        if(!allowCompounds)
            notes.push("profile_intentionally_disables_structure_compounds");
        if(allowCompounds && !structureTargets.layoutTemplates)
            outlierReasons.push("compound_template_mismatch");

        var compounds = allowCompounds ?
            self.PlaceCompounds(pContext, pPlan, structureTargets, objectiveBeats, outlierReasons) :
            [];
        var structures = self.BuildStructures(compounds);
        var structureTargetMax = Math.floor(Number(profile.GrammarStructureTargetMax));
        var structureCapacity = Math.floor(Number(profile.StructureMaxClearings));
        var buildingsPerClearing = Math.max(1, Math.floor(Number(profile.StructureBuildingsPerClearing || 1)));

        // Compound templates describe every structure observed inside a
        // shipped-map compound; that corpus inventory is not automatically a
        // feasible live-building request for this generated map. Profiles
        // already declare their live clearing capacity, so use it as the
        // default contract unless a style explicitly supplies a different
        // GrammarStructureTargetMax (for example, a maze with one fallback
        // structure beyond its authored clearings).
        if(!(isFinite(structureTargetMax) && structureTargetMax > 0) &&
            isFinite(structureCapacity) && structureCapacity > 0) {
            structureTargetMax = structureCapacity * buildingsPerClearing;
            notes.push("profile_derives_structure_landmarks_from_live_capacity:" + structureTargetMax);
        }
        profile.GrammarResolvedStructureTargetMax =
            isFinite(structureTargetMax) && structureTargetMax > 0 ? structureTargetMax : 0;

        // Composition profiles with constrained terrain (notably a spanning
        // river) may intentionally support fewer landmarks than the broad
        // corpus target. Cap the semantic plan before route sites and live
        // placements are derived, so validation does not demand five distinct
        // compounds from a layout designed around two or three river banks.
        if(profile.GrammarResolvedStructureTargetMax > 0 &&
            structures.length > structureTargetMax) {
            // Preserve map progression when a compound template contributes
            // several buildings: take one building from each distant compound
            // before taking a second from any compound. A simple prefix slice
            // retained every building from the first compound and discarded
            // later route regions, recreating the visual clustering this plan
            // was meant to prevent.
            var structuresByCompound = {};
            var compoundOrder = [];
            var limitedStructures = [];
            var round = 0;
            var added = true;

            for(var sourceIndex = 0; sourceIndex < structures.length; ++sourceIndex) {
                var sourceStructure = structures[sourceIndex];
                if(!structuresByCompound[sourceStructure.compoundId]) {
                    structuresByCompound[sourceStructure.compoundId] = [];
                    compoundOrder.push(sourceStructure.compoundId);
                }
                structuresByCompound[sourceStructure.compoundId].push(sourceStructure);
            }

            while(limitedStructures.length < structureTargetMax && added) {
                added = false;
                for(var orderIndex = 0;
                    orderIndex < compoundOrder.length && limitedStructures.length < structureTargetMax;
                    ++orderIndex) {
                    var compoundStructures = structuresByCompound[compoundOrder[orderIndex]];
                    if(round < compoundStructures.length) {
                        limitedStructures.push(compoundStructures[round]);
                        added = true;
                    }
                }
                ++round;
            }
            structures = limitedStructures;

            var retainedCompounds = {};
            for(var retainedIndex = 0; retainedIndex < structures.length; ++retainedIndex)
                retainedCompounds[structures[retainedIndex].compoundId] = true;

            var limitedCompounds = [];
            for(var compoundIndex = 0; compoundIndex < compounds.length; ++compoundIndex) {
                if(retainedCompounds[compounds[compoundIndex].id])
                    limitedCompounds.push(compounds[compoundIndex]);
            }
            compounds = limitedCompounds;
            notes.push("profile_caps_structure_landmarks:" + structureTargetMax);
        }
        var doorPlans = self.BuildDoorAndRoofPlans(pContext, compounds, structures);
        if(!allowCompounds && intent.objectiveLabel === "destroy_buildings")
            doorPlans = self.BuildStandaloneDoorAndRoofPlans(pContext, targets, objectiveBeats, outlierReasons);
        if(isFinite(structureTargetMax) && structureTargetMax > 0) {
            doorPlans.doors = doorPlans.doors.slice(0, structureTargetMax);
            doorPlans.roofs = doorPlans.roofs.slice(0, structureTargetMax);
        }
        var objectiveBuild = self.BuildObjectiveTargets(
            pContext,
            pPlan,
            objectiveInteraction,
            compounds,
            structures,
            doorPlans,
            objectiveBeats
        );
        var firingBuild = self.BuildFiringPositions(
            pContext,
            objectiveInteraction,
            objectiveBuild.objectives
        );
        var supportRoutes = self.BuildSupportRoutes(
            pContext,
            routePlan,
            objectiveBuild.objectives,
            firingBuild.positions
        );

        if(!objectiveBuild.objectives.length)
            outlierReasons.push("objective_truth_missing");
        if(intent.objectiveLabel === "destroy_buildings" && allowCompounds && !structures.length)
            outlierReasons.push("compound_template_mismatch");
        if(intent.objectiveLabel === "destroy_buildings" && !doorPlans.doors.length && structures.length)
            outlierReasons.push("objective_support_missing");
        if(firingBuild.positions.length < Math.min(2, objectiveBuild.objectives.length))
            outlierReasons.push("objective_line_of_fire_missing");

        return {
            name: "objectivePlan",
            status: "ready",
            objectiveType: intent.objectiveLabel || "objective_unknown",
            objectiveTemplate: intent.objectiveTemplate || "",
            objectiveBeats: objectiveBeats,
            compounds: compounds,
            structures: structures,
            doors: doorPlans.doors,
            roofs: doorPlans.roofs,
            objectives: objectiveBuild.objectives,
            objectiveCountTarget: objectiveBuild.targetCount,
            firingPositions: firingBuild.positions,
            safeFiringPositionsRadius6Target: firingBuild.target,
            supportRoutes: supportRoutes,
            objectiveTruth: {
                required: true,
                status: "ready",
                runtimeCompletableTargetCount: objectiveBuild.objectives.length,
                targetKinds: self.ObjectiveKinds(objectiveBuild.objectives),
                excludedFromDestroyTargets: [
                    "building_roofs",
                    "passive_decor",
                    "helper_sprites",
                    "civilian_home_doors_unless_civilian_delivery"
                ],
                source: "objectiveInteraction plus structureCompound role offsets"
            },
            profileCompoundPolicy: {
                allowStructureCompounds: allowCompounds,
                compoundMode: intent.guardrails ? intent.guardrails.compoundMode : "",
                beachCompoundForbidden: !allowCompounds
            },
            targetRefs: [
                "profiles." + (pPlan.targetPackProfileName || profile.TargetPackProfile || "") + ".targets.structureCompounds",
                "profiles." + (pPlan.targetPackProfileName || profile.TargetPackProfile || "") + ".targets.objectiveInteraction",
                "routePlan.routeBeats",
                "intent.guardrails"
            ],
            notes: notes,
            outlierReasons: outlierReasons
        };
    }
};
