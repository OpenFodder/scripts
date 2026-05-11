var MapGen = MapGen || {};
MapGen.Grammar = MapGen.Grammar || {};

MapGen.Grammar.Terrain = {

    HasOwn: function(pObject, pKey) { return MapGen.Grammar.Util.HasOwn(pObject, pKey); },

    NumberOrNull: function(pValue) { return MapGen.Grammar.Util.NumberOrNull(pValue); },

    Clamp: function(pValue, pMin, pMax) { return MapGen.Grammar.Util.Clamp(pValue, pMin, pMax); },

    Round: function(pValue, pPlaces) { return MapGen.Grammar.Util.Round(pValue, pPlaces); },

    StatRange: function(pStats, pPreferWide) { return MapGen.Grammar.Util.StatRange(pStats, pPreferWide); },

    PickStatNumber: function(pRandom, pStats, pInteger, pFallback) {
        return MapGen.Grammar.Util.PickStatNumber(pRandom, pStats, pInteger, pFallback);
    },

    RangeSummary: function(pStats) { return MapGen.Grammar.Util.RangeSummary(pStats); },

    PickMetric: function(pContext, pStats, pInteger, pFallback) {
        return MapGen.Grammar.Util.PickMetric(pContext, pStats, pInteger, pFallback);
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
            { x: pPoint.x + dir.x * distance, y: pPoint.y + dir.y * distance },
            1
        );
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

        return { x: Math.floor(pRoutePlan.Width || 8), y: Math.floor(pRoutePlan.Height || 8) };
    },

    MetricsForKeys: function(pContext, pSource, pKeys, pFallback) {
        var result = {};
        for(var index = 0; index < pKeys.length; ++index) {
            var key = pKeys[index];
            result[key] = this.PickMetric(pContext, pSource ? pSource[key] : null, false, pFallback || 0);
        }
        return result;
    },

    CompositionTargets: function(pContext, pComposition) {
        var terrain = pComposition ? pComposition.terrainComposition || {} : {};
        return {
            visualFractions: this.MetricsForKeys(
                pContext,
                terrain.visualFractions || {},
                ["land", "water", "tree", "decor", "building", "cliff", "other"],
                0
            ),
            passabilityFractions: this.MetricsForKeys(
                pContext,
                terrain.passabilityFractions || {},
                [
                    "blocked",
                    "drop",
                    "ground",
                    "mixed_block",
                    "mixed_drop",
                    "mixed_hazard",
                    "mixed_water",
                    "rough",
                    "sinking_ground",
                    "slow_ground",
                    "soft_hazard",
                    "water",
                    "jump_ramp"
                ],
                0
            ),
            dryPassableFraction: this.PickMetric(pContext, terrain.dryPassableFraction, false, 0.45),
            engineWalkableFraction: this.PickMetric(pContext, terrain.engineWalkableFraction, false, 0.75),
            plainGroundRunLength: this.PickMetric(pContext, pComposition ? pComposition.plainGroundRunLength : null, false, 12)
        };
    },

    OpenGroundTargets: function(pContext, pSpatialGrammar) {
        var open = pSpatialGrammar ? pSpatialGrammar.openGround || {} : {};
        return {
            plainComponentCount: this.PickMetric(pContext, open.plainComponentCount, true, 8),
            clearingCount: this.PickMetric(pContext, open.clearingCount, true, 4),
            clearingArea: this.PickMetric(pContext, open.clearingArea, true, 64),
            corridorWidth: this.PickMetric(pContext, open.corridorWidth, false, 4),
            clearingGap: this.PickMetric(pContext, open.clearingGap, false, 32),
            routePlainSegments: this.PickMetric(pContext, open.routePlainSegments, false, 2),
            routePlainInterruptionRate: this.PickMetric(pContext, open.routePlainInterruptionRate, false, 0.22)
        };
    },

    RouteCorridors: function(pContext, pPlan, pOpenTargets) {
        var routePlan = pPlan.routePlan || {};
        var legs = routePlan.legs || [];
        var corridorTargets = routePlan.subcellValidation ? routePlan.subcellValidation.corridorTargets || {} : {};
        var width = corridorTargets.routeCorridorWidthTiles ?
            corridorTargets.routeCorridorWidthTiles.selected :
            pOpenTargets.corridorWidth.selected;
        var engineWidth = corridorTargets.engineOnlyCorridorWidthTiles ?
            corridorTargets.engineOnlyCorridorWidthTiles.selected :
            width + 2;
        var result = [];

        for(var index = 0; index < legs.length; ++index) {
            var leg = legs[index];
            result.push({
                id: "route_corridor_" + index,
                legId: leg.id,
                fromBeatId: leg.fromBeatId,
                toBeatId: leg.toBeatId,
                mode: leg.mode || "foot",
                path: leg.path || [],
                widthTiles: width,
                engineOnlyWidthTiles: engineWidth,
                keepDry: leg.mode !== "swim_or_wade" && leg.mode !== "helicopter",
                allowWaterCrossing: leg.mode === "swim_or_wade" || leg.mode === "vehicle_or_swim",
                allowJumpRamp: String(leg.mode || "").indexOf("jump") >= 0,
                routePhase: leg.routePhase || "",
                subcellTarget: leg.subcellTarget || null
            });
        }

        return result;
    },

    ScreenTerrainPlans: function(pPlan) {
        var screenPlan = pPlan.screenPlan || {};
        var sequence = screenPlan.sequence || screenPlan.routeBeats || [];
        var result = [];

        for(var index = 0; index < sequence.length; ++index) {
            var screen = sequence[index];
            result.push({
                id: "screen_terrain_" + index,
                screenId: screen.id || ("screen_" + index),
                screenType: screen.screenType || "",
                routePhase: screen.routePhase || "",
                viewport: screen.viewport || null,
                terrainBalance: screen.terrainBalance || screen.screenTarget || null,
                intendedEnemyPressure: screen.intendedEnemyPressure || 0,
                supportObjectCount: screen.supportObjectCount || 0,
                quietScreen: screen.screenType === "quiet_screen" || screen.screenType === "quiet_context_screen",
                objectiveScreen: screen.screenType === "objective_arena" || screen.screenType === "objective_combat_screen"
            });
        }

        return result;
    },

    ClearingRadius: function(pArea) {
        return Math.max(2, Math.round(Math.sqrt(Math.max(1, pArea) / Math.PI)));
    },

    AddClearingsForObjectives: function(pContext, pPlan, pSpatialGrammar, pOpenTargets) {
        var structureArenas = pSpatialGrammar ? pSpatialGrammar.structureArenas || {} : {};
        var objectivePlan = pPlan.objectivePlan || {};
        var structures = objectivePlan.structures || [];
        var objectives = objectivePlan.objectives || [];
        var firing = objectivePlan.firingPositions || [];
        var clearings = [];
        var areaMetric = this.PickMetric(pContext, structureArenas.clearingCells, true, pOpenTargets.clearingArea.selected);
        var arenaCount = this.PickMetric(pContext, structureArenas.arenaCount, true, structures.length ? structures.length : 1);
        var radius = this.ClearingRadius(areaMetric.selected);
        var index;

        for(index = 0; index < structures.length && clearings.length < Math.max(1, arenaCount.selected); ++index) {
            var footprint = structures[index].footprint;
            clearings.push({
                id: "clearing_" + clearings.length,
                role: "structure_arena",
                point: this.ClampPoint(pContext, {
                    x: footprint.x + footprint.width / 2,
                    y: footprint.y + footprint.height / 2
                }, 1),
                radiusTiles: radius,
                targetAreaCells: areaMetric,
                structureId: structures[index].id,
                nearestTreeTarget: this.PickMetric(pContext, structureArenas.nearestTree, false, 6),
                nearestWaterTarget: this.PickMetric(pContext, structureArenas.nearestWater, false, 6),
                nearestCliffTarget: this.PickMetric(pContext, structureArenas.nearestCliff, false, 12)
            });
        }

        for(index = 0; index < objectives.length && clearings.length < Math.max(1, pOpenTargets.clearingCount.selected); ++index) {
            clearings.push({
                id: "clearing_" + clearings.length,
                role: "objective_arena",
                point: this.ClampPoint(pContext, objectives[index].point, 1),
                radiusTiles: Math.max(2, radius - 1),
                targetAreaCells: areaMetric,
                objectiveId: objectives[index].id
            });
        }

        for(index = 0; index < firing.length && clearings.length < Math.max(2, pOpenTargets.clearingCount.selected); ++index) {
            clearings.push({
                id: "clearing_" + clearings.length,
                role: "firing_position",
                point: this.ClampPoint(pContext, firing[index].point, 1),
                radiusTiles: 2,
                targetAreaCells: this.PickMetric(pContext, null, true, 12),
                objectiveId: firing[index].objectiveId
            });
        }

        return clearings;
    },

    AddClearingsForSprites: function(pContext, pPlan, pOpenTargets) {
        var spritePlan = pPlan.spritePlan || {};
        var support = spritePlan.support || [];
        var civilians = spritePlan.civilians || [];
        var hostages = spritePlan.hostages || [];
        var extraction = spritePlan.extraction || [];
        var groups = [
            { role: "support_object", items: support, radius: 2 },
            { role: "civilian_route_node", items: civilians, radius: 2 },
            { role: "hostage_group", items: hostages, radius: 2 },
            { role: "extraction_zone", items: extraction, radius: 3 }
        ];
        var result = [];

        for(var groupIndex = 0; groupIndex < groups.length; ++groupIndex) {
            var group = groups[groupIndex];
            for(var index = 0; index < group.items.length && result.length < Math.max(2, pOpenTargets.clearingCount.selected); ++index) {
                result.push({
                    id: "sprite_clearing_" + result.length,
                    role: group.role,
                    point: this.ClampPoint(pContext, group.items[index].point, 1),
                    radiusTiles: group.radius,
                    sourcePlacementId: group.items[index].id
                });
            }
        }

        return result;
    },

    CoverBands: function(pContext, pPlan, pComposition) {
        var routeCover = pComposition ? pComposition.routeAdjacentCover || {} : {};
        var bands = [];
        var radii = ["1", "3", "5", "8"];

        for(var index = 0; index < radii.length; ++index) {
            var radius = radii[index];
            var band = routeCover[radius] || {};
            bands.push({
                id: "route_cover_" + radius,
                radiusTiles: Number(radius),
                visualFractions: this.MetricsForKeys(
                    pContext,
                    band.visualFractions || {},
                    ["tree", "water", "cliff", "building", "decor", "land", "other"],
                    0
                ),
                passabilityFractions: this.MetricsForKeys(
                    pContext,
                    band.passabilityFractions || {},
                    ["blocked", "ground", "mixed_block", "water", "mixed_water", "drop", "soft_hazard"],
                    0
                )
            });
        }

        return bands;
    },

    MorphologyPlanFor: function(pContext, pSpatialGrammar, pFeature, pRoutePlan, pObjectivePlan) {
        var morphology = pSpatialGrammar ? pSpatialGrammar.terrainMorphology || {} : {};
        var feature = morphology[pFeature] || {};
        var count = this.PickMetric(pContext, feature.componentCount, true, pFeature === "water" ? 2 : 3);
        var area = this.PickMetric(pContext, feature.area, true, pFeature === "water" ? 80 : 60);
        var result = [];
        var maxCount = Math.max(0, Math.min(10, count.selected));

        for(var index = 0; index < maxCount; ++index) {
            var anchor = index % 2 === 0 ?
                this.RoutePoint(pRoutePlan, index, Math.max(1, maxCount)) :
                (this.ObjectivePoint(pObjectivePlan, index) || this.RoutePoint(pRoutePlan, index, Math.max(1, maxCount)));
            var distance = this.PickStatNumber(
                pContext.Random,
                index % 2 === 0 ? feature.nearestRoute : feature.nearestObjective,
                false,
                pFeature === "water" ? 6 : 5
            );
            var point = this.OffsetPoint(pContext, anchor, distance, index);
            result.push({
                id: pFeature + "_blob_" + index,
                feature: pFeature,
                point: point,
                targetAreaCells: area,
                perimeterToArea: this.PickMetric(pContext, feature.perimeterToArea, false, 0.5),
                neckFraction: this.PickMetric(pContext, feature.neckFraction, false, 0.05),
                holesPerBlob: this.PickMetric(pContext, feature.holesPerBlob, false, 0),
                nearestRouteTarget: this.RangeSummary(feature.nearestRoute),
                nearestObjectiveTarget: this.RangeSummary(feature.nearestObjective)
            });
        }

        return result;
    },

    ObjectivePoint: function(pObjectivePlan, pIndex) {
        var objectives = pObjectivePlan && pObjectivePlan.objectives ? pObjectivePlan.objectives : [];
        var structures = pObjectivePlan && pObjectivePlan.structures ? pObjectivePlan.structures : [];

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

    BeachHazardBands: function(pContext, pPlan, pComposition) {
        var terrain = pComposition ? pComposition.terrainComposition || {} : {};
        var passability = terrain.passabilityFractions || {};
        var variant = pPlan.terrainVariant || "";
        var enabled = variant === "jun_sub1" ||
            this.NumberOrNull(passability.sinking_ground ? passability.sinking_ground.mean : null) !== null ||
            this.NumberOrNull(passability.soft_hazard ? passability.soft_hazard.mean : null) !== null;
        var routePlan = pPlan.routePlan || {};
        var result = [];

        if(!enabled)
            return result;

        var count = variant === "jun_sub1" ? 3 : 1;
        for(var index = 0; index < count; ++index) {
            var anchor = this.RoutePoint(routePlan, index, count);
            result.push({
                id: "beach_hazard_" + index,
                role: variant === "jun_sub1" ? "beach_quicksand_pressure" : "soft_hazard_patch",
                point: this.OffsetPoint(pContext, anchor, 4 + index, index),
                radiusTiles: 3 + index,
                sinkingGroundTarget: this.PickMetric(pContext, passability.sinking_ground, false, 0),
                softHazardTarget: this.PickMetric(pContext, passability.soft_hazard, false, 0)
            });
        }

        return result;
    },

    HazardPlans: function(pContext, pPlan, pComposition) {
        var hazards = [];
        var dynamicTerrain = pPlan.dynamicTerrainPlan || {};
        var spritePlan = pPlan.spritePlan || {};
        var spriteHazards = spritePlan.hazards || [];
        var dynamicPairs = dynamicTerrain.swapPairs || [];
        var index;

        for(index = 0; index < spriteHazards.length; ++index) {
            hazards.push({
                id: "sprite_hazard_" + index,
                role: "sprite_hazard_clearance",
                point: spriteHazards[index].point,
                radiusTiles: 2,
                spritePlacementId: spriteHazards[index].id
            });
        }

        for(index = 0; index < dynamicPairs.length; ++index) {
            if(dynamicPairs[index].targetPassability === "soft_hazard" ||
                dynamicPairs[index].sourcePassability === "soft_hazard" ||
                dynamicPairs[index].targetPassability === "mixed_hazard") {
                hazards.push({
                    id: "dynamic_hazard_" + index,
                    role: "dynamic_state_hazard_context",
                    point: dynamicPairs[index].point,
                    radiusTiles: Math.max(2, Math.round(Math.sqrt(dynamicPairs[index].tileCount || 1))),
                    dynamicPairId: dynamicPairs[index].id
                });
            }
        }

        return hazards;
    },

    QuietScreens: function(pScreenPlans) {
        var quiet = [];
        for(var index = 0; index < pScreenPlans.length; ++index) {
            if(pScreenPlans[index].quietScreen) {
                quiet.push({
                    id: "quiet_screen_" + quiet.length,
                    screenId: pScreenPlans[index].screenId,
                    viewport: pScreenPlans[index].viewport,
                    terrainBalance: pScreenPlans[index].terrainBalance,
                    allowSparseSprites: true,
                    preserveLowPressure: true
                });
            }
        }
        return quiet;
    },

    Plan: function(pContext, pPlan) {
        var self = MapGen.Grammar.Terrain;
        var profile = pContext.Profile || {};
        var target = profile.TargetPack || {};
        var targets = target.targets || {};
        var composition = targets.composition || {};
        var spatialGrammar = targets.spatialGrammar || {};
        var outlierReasons = [];
        var notes = [];

        if(!targets.composition)
            outlierReasons.push("terrain_composition_out_of_range:missing_composition_targets");
        if(!targets.spatialGrammar)
            outlierReasons.push("blob_shape_mismatch:missing_spatial_grammar_targets");

        var compositionTargets = self.CompositionTargets(pContext, composition);
        var openTargets = self.OpenGroundTargets(pContext, spatialGrammar);
        var routeCorridors = self.RouteCorridors(pContext, pPlan, openTargets);
        var screenPlans = self.ScreenTerrainPlans(pPlan);
        var objectiveClearings = self.AddClearingsForObjectives(pContext, pPlan, spatialGrammar, openTargets);
        var spriteClearings = self.AddClearingsForSprites(pContext, pPlan, openTargets);
        var coverBands = self.CoverBands(pContext, pPlan, composition);
        var waterBodies = self.MorphologyPlanFor(pContext, spatialGrammar, "water", pPlan.routePlan || {}, pPlan.objectivePlan || {});
        var treeBlobs = self.MorphologyPlanFor(pContext, spatialGrammar, "tree", pPlan.routePlan || {}, pPlan.objectivePlan || {});
        var cliffBands = self.MorphologyPlanFor(pContext, spatialGrammar, "cliff", pPlan.routePlan || {}, pPlan.objectivePlan || {});
        var beachHazards = self.BeachHazardBands(pContext, pPlan, composition);
        var hazards = self.HazardPlans(pContext, pPlan, composition);
        var quietScreens = self.QuietScreens(screenPlans);

        if(!routeCorridors.length)
            outlierReasons.push("cover_route_gap");
        if(!quietScreens.length && screenPlans.length)
            notes.push("no_quiet_screens_selected_for_seed");
        if(compositionTargets.plainGroundRunLength.selected > 32)
            outlierReasons.push("plain_run_too_long");

        return {
            name: "semanticTerrain",
            status: "ready",
            // layers.ground (composition/openGround targets, read by the Python
            // doc generator) and the cover composition scalars are kept. The
            // per-blob geometry arrays (water/trees/cliffs/beach/hazards/
            // routeCorridors/clearings/quietScreens/screenTerrain) were
            // write-only telemetry — only their LENGTHS are consumed, via the
            // counts block below (computed from the local arrays, not from
            // these fields). Emptied to drop the unread geometry. Verified via
            // ContextPlanFingerprint that every consumed field is unchanged.
            layers: {
                ground: {
                    compositionTargets: compositionTargets,
                    openGroundTargets: openTargets,
                    baseClass: pPlan.terrainVariant === "ice_sub0" ? "snow_ice_ground" :
                        (pPlan.terrainVariant === "jun_sub1" ? "beach_jungle_ground" : "jungle_ground")
                },
                cover: {
                    routePlainSegments: openTargets.routePlainSegments,
                    routePlainInterruptionRate: openTargets.routePlainInterruptionRate
                }
            },
            targetFamilies: [
                "composition",
                "spatialGrammar",
                "viewportPacing",
                "subtileTacticalTerrain",
                "dynamicTerrain",
                "spriteRolePlacement",
                "objectiveInteraction"
            ],
            profileRules: {
                terrainVariant: pPlan.terrainVariant || profile.TerrainVariant || "",
                keepBeachOutOfJungle: pPlan.intent && pPlan.intent.guardrails ?
                    pPlan.intent.guardrails.keepBeachAssumptionsOutOfJungle : false,
                beachPressureEnabled: (pPlan.terrainVariant || profile.TerrainVariant || "") === "jun_sub1",
                iceSlowSlipperyEnabled: (pPlan.terrainVariant || profile.TerrainVariant || "") === "ice_sub0"
            },
            counts: {
                routeCorridors: routeCorridors.length,
                clearings: objectiveClearings.length + spriteClearings.length,
                waterBodies: waterBodies.length,
                treeBlobs: treeBlobs.length,
                cliffBands: cliffBands.length,
                beachHazards: beachHazards.length,
                hazards: hazards.length,
                quietScreens: quietScreens.length,
                screenPlans: screenPlans.length
            },
            targetRefs: [
                "profiles." + (pPlan.targetPackProfileName || profile.TargetPackProfile || "") + ".targets.composition",
                "profiles." + (pPlan.targetPackProfileName || profile.TargetPackProfile || "") + ".targets.spatialGrammar",
                "profiles." + (pPlan.targetPackProfileName || profile.TargetPackProfile || "") + ".targets.viewportPacing",
                "profiles." + (pPlan.targetPackProfileName || profile.TargetPackProfile || "") + ".targets.subtileTacticalTerrain",
                "routePlan",
                "objectivePlan",
                "spritePlan",
                "dynamicTerrainPlan"
            ],
            notes: notes,
            outlierReasons: outlierReasons
        };
    }
};
