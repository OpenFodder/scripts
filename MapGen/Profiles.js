var MapGen = MapGen || {};

MapGen.Profiles = (function() {

    function clone(pValue) {
        var key;
        var result;

        if(pValue === null || typeof pValue !== "object")
            return pValue;

        if(pValue instanceof Array) {
            result = [];
            for(var index = 0; index < pValue.length; ++index)
                result[index] = clone(pValue[index]);
            return result;
        }

        result = {};
        for(key in pValue) {
            if(pValue.hasOwnProperty(key))
                result[key] = clone(pValue[key]);
        }
        return result;
    }

    function merge(pBase, pOverride) {
        var result = clone(pBase || {});
        var key;

        if(!pOverride)
            return result;

        for(key in pOverride) {
            if(!pOverride.hasOwnProperty(key))
                continue;

            if(key === "LayoutTemplates" || key === "PathStyles") {
                result[key] = clone(pOverride[key]);
                continue;
            }

            if(result[key] && typeof result[key] === "object" && !(result[key] instanceof Array) &&
                pOverride[key] && typeof pOverride[key] === "object" && !(pOverride[key] instanceof Array)) {
                result[key] = merge(result[key], pOverride[key]);
            }
            else {
                result[key] = clone(pOverride[key]);
            }
        }

        return result;
    }

    function resolveCompositionVariant(pRandom, pVariants) {
        if(!(pVariants instanceof Array) || !pVariants.length)
            return null;

        var choices = [];
        var total = 0;
        for(var index = 0; index < pVariants.length; ++index) {
            var variant = pVariants[index] || {};
            var weight = Number(variant.weight);
            if(!isFinite(weight) || weight <= 0)
                continue;
            total += weight;
            choices.push({
                name: String(variant.name || ("variant_" + index)),
                weight: weight,
                overrides: variant.overrides || {}
            });
        }
        if(!choices.length || total <= 0)
            return null;

        var roll;
        if(typeof pRandom.InitialSeed === "number" && MapGen.Random && MapGen.Random.HashTile) {
            var mixed = MapGen.Random.HashTile(pRandom.InitialSeed, 97, 53, 8123);
            roll = (mixed / 4294967296) * total;
        }
        else {
            roll = pRandom.Float(0, total);
        }
        var cumulative = 0;
        for(var choiceIndex = 0; choiceIndex < choices.length; ++choiceIndex) {
            cumulative += choices[choiceIndex].weight;
            if(roll <= cumulative)
                return choices[choiceIndex];
        }
        return choices[choices.length - 1];
    }

    var REFERENCE_AREA_TILES = 2048;

    function resolveRange(pRandom, pValue, pInteger, pExtreme) {
        if(!(pValue instanceof Array))
            return pValue;

        if(pValue.length < 2)
            return pValue[0];

        var min = Number(pValue[0]);
        var max = Number(pValue[1]);

        if(isNaN(min) || isNaN(max))
            return pValue[0];

        if(max < min) {
            var swap = min;
            min = max;
            max = swap;
        }

        if(pExtreme && pRandom.Extreme)
            return pRandom.Extreme(min, max, pInteger);

        if(pInteger)
            return pRandom.Int(Math.floor(min), Math.floor(max));

        return pRandom.Float(min, max);
    }

    function resolveScaledCount(pRandom, pValue, pAreaTiles, pExtreme) {
        var rate = resolveRange(pRandom, pValue, false, pExtreme);

        if(typeof rate !== "number" || isNaN(rate))
            return 0;

        var scaled = Math.round(rate * pAreaTiles / REFERENCE_AREA_TILES);
        return scaled < 0 ? 0 : scaled;
    }

    function resolvePerAreaCount(pRandom, pRateValue, pCountValue, pAreaTiles, pExtreme) {
        if(pRateValue !== undefined)
            return resolveScaledCount(pRandom, pRateValue, pAreaTiles, pExtreme);

        return resolveRange(pRandom, pCountValue, true, pExtreme);
    }

    function isNumber(pValue) {
        return typeof pValue === "number" && !isNaN(pValue) && isFinite(pValue);
    }

    function addIssue(pValidation, pType, pKey, pMessage) {
        pValidation[pType].push({
            key: pKey,
            message: pMessage
        });
    }

    function validateNumber(pValidation, pProfile, pKey) {
        if(!isNumber(pProfile[pKey]))
            addIssue(pValidation, "errors", pKey, "must be a number");
    }

    function validateRange(pValidation, pProfile, pKey, pMin, pMax) {
        validateNumber(pValidation, pProfile, pKey);

        if(!isNumber(pProfile[pKey]))
            return;

        if(pProfile[pKey] < pMin || pProfile[pKey] > pMax)
            addIssue(pValidation, "errors", pKey, "must be between " + pMin + " and " + pMax);
    }

    function validateMinimum(pValidation, pProfile, pKey, pMin) {
        validateNumber(pValidation, pProfile, pKey);

        if(!isNumber(pProfile[pKey]))
            return;

        if(pProfile[pKey] < pMin)
            addIssue(pValidation, "errors", pKey, "must be at least " + pMin);
    }

    function validate(pProfile) {
        var validation = {
            ok: true,
            errors: [],
            warnings: []
        };

        validateMinimum(validation, pProfile, "Width", 16);
        validateMinimum(validation, pProfile, "Height", 16);
        validateRange(validation, pProfile, "TreeCoverage", 0, 0.9);
        if(pProfile.ForestShape && ["groves", "belts", "heartwood", "rim"].indexOf(pProfile.ForestShape) < 0)
            addIssue(validation, "errors", "ForestShape", "unknown forest shape");
        if(pProfile.JungleLandform && ["basin", "islands"].indexOf(pProfile.JungleLandform) < 0)
            addIssue(validation, "errors", "JungleLandform", "unknown jungle landform");
        if(pProfile.RegionalIceTerrain && ["lakes", "inlets", "river_loop", "woodland"].indexOf(pProfile.RegionalIceTerrain) < 0)
            addIssue(validation, "errors", "RegionalIceTerrain", "unknown regional ice terrain");
        validateRange(validation, pProfile, "PathCoverage", 0.01, 0.45);
        validateMinimum(validation, pProfile, "MainPathWidth", 1);
        validateMinimum(validation, pProfile, "SidePathWidth", 1);
        validateMinimum(validation, pProfile, "ClearingCount", 0);
        validateMinimum(validation, pProfile, "ClearingRadius", 1);
        validateMinimum(validation, pProfile, "WildernessClearingCount", 0);
        validateRange(validation, pProfile, "LoopChance", 0, 1);
        validateRange(validation, pProfile, "RiverChance", 0, 1);
        validateMinimum(validation, pProfile, "MaxRiverCount", 0);
        validateMinimum(validation, pProfile, "RiverWidth", 1);
        validateRange(validation, pProfile, "RiverMeander", 0, 1);
        validateMinimum(validation, pProfile, "RiverMeanderPrimary", 0);
        validateMinimum(validation, pProfile, "RiverMeanderSecondary", 0);
        validateMinimum(validation, pProfile, "RiverMeanderJitter", 0);
        validateMinimum(validation, pProfile, "RiverDeltaWidth", 1);
        validateRange(validation, pProfile, "RiverBisectChance", 0, 1);
        if(pProfile.StraightShoreRunLimit !== undefined)
            validateMinimum(validation, pProfile, "StraightShoreRunLimit", 4);
        if(pProfile.ShorelineWobbleStride !== undefined)
            validateMinimum(validation, pProfile, "ShorelineWobbleStride", 3);
        if(pProfile.MaxShorelineWobbleCells !== undefined)
            validateMinimum(validation, pProfile, "MaxShorelineWobbleCells", 0);
        validateMinimum(validation, pProfile, "MaxBranchDepth", 0);
        validateRange(validation, pProfile, "StreamChance", 0, 1);
        validateMinimum(validation, pProfile, "MaxStreamCount", 0);
        validateMinimum(validation, pProfile, "CrossingCount", 0);
        validateMinimum(validation, pProfile, "CrossingMaxRouteDistance", 1);
        validateRange(validation, pProfile, "PondChance", 0, 1);
        validateMinimum(validation, pProfile, "MaxPondCount", 0);
        validateRange(validation, pProfile, "CoastChance", 0, 1);
        validateMinimum(validation, pProfile, "CoastWaterWidth", 1);
        validateMinimum(validation, pProfile, "BeachWidth", 1);
        if(pProfile.CoastBayChance !== undefined)
            validateRange(validation, pProfile, "CoastBayChance", 0, 1);
        if(pProfile.CoastBayDepth !== undefined)
            validateMinimum(validation, pProfile, "CoastBayDepth", 0);
        if(pProfile.CoastBayWindow !== undefined)
            validateMinimum(validation, pProfile, "CoastBayWindow", 1);
        validateRange(validation, pProfile, "MaxWaterCoverage", 0, 0.6);
        validateMinimum(validation, pProfile, "EnemyDensity", 0);
        validateMinimum(validation, pProfile, "StructureClusters", 0);
        validateMinimum(validation, pProfile, "DecorDensity", 0);
        validateMinimum(validation, pProfile, "MicroStampDensity", 0);
        validateRange(validation, pProfile, "DesertDropChunkChance", 0, 1);
        validateMinimum(validation, pProfile, "DesertDropChunkMaxPer3072Tiles", 0);
        validateRange(validation, pProfile, "OutcropChance", 0, 1);
        validateMinimum(validation, pProfile, "MaxOutcropCount", 0);
        validateMinimum(validation, pProfile, "OutcropRadius", 1);
        validateMinimum(validation, pProfile, "ValidationRetries", 1);
        validateMinimum(validation, pProfile, "MaxRepairPasses", 0);
        if(pProfile.PlateauChance !== undefined)
            validateRange(validation, pProfile, "PlateauChance", 0, 1);
        if(pProfile.LandFraction !== undefined)
            validateRange(validation, pProfile, "LandFraction", 0.3, 1);

        if(pProfile.ContinentStyles !== undefined) {
            var stylesArr = pProfile.ContinentStyles;
            if(!stylesArr || typeof stylesArr.length !== "number" || stylesArr.length === 0) {
                validation.warnings.push("ContinentStyles must be a non-empty array");
            } else {
                var totalWeight = 0;
                for(var styleIndex = 0; styleIndex < pProfile.ContinentStyles.length; ++styleIndex) {
                    var style = pProfile.ContinentStyles[styleIndex];
                    if(!style || typeof style.name !== "string" || !(style.weight > 0)) {
                        validation.warnings.push("ContinentStyles[" + styleIndex + "] must have name + positive weight");
                        continue;
                    }
                    if(style.landFraction !== undefined && (style.landFraction < 0.3 || style.landFraction > 1))
                        validation.warnings.push("ContinentStyles[" + styleIndex + "].landFraction out of [0.3, 1]");
                    totalWeight += style.weight;
                }
                if(!(totalWeight > 0))
                    validation.warnings.push("ContinentStyles weights must sum > 0");
            }
        }

        // A forest maze gets its topology entirely from tree walls and the
        // authored corridor graph. Re-enabling a broad terrain producer here
        // silently punches holes through that graph. Keep this as a profile
        // invariant so a later duplicate/stale override fails loudly instead
        // of occasionally changing the map for only some seeds.
        if(pProfile.JungleMazeForestFill === true) {
            var mazeDisabledChances = [
                "CoastChance", "EdgeBiomeChance", "RiverChance",
                "StreamChance", "PondChance", "LakeChance"
            ];
            for(var mazeIndex = 0; mazeIndex < mazeDisabledChances.length; ++mazeIndex) {
                var mazeKey = mazeDisabledChances[mazeIndex];
                if(Number(pProfile[mazeKey] || 0) !== 0) {
                    addIssue(
                        validation,
                        "errors",
                        mazeKey,
                        "must be 0 when JungleMazeForestFill is enabled"
                    );
                }
            }
        }

        if(isNumber(pProfile.Width) && pProfile.Width < 32)
            addIssue(validation, "warnings", "Width", "very small maps will have limited route and river quality");
        if(isNumber(pProfile.Height) && pProfile.Height < 32)
            addIssue(validation, "warnings", "Height", "very small maps will have limited route and river quality");
        if(isNumber(pProfile.RiverWidth) && isNumber(pProfile.Width) && isNumber(pProfile.Height) &&
            pProfile.RiverWidth * 4 >= Math.min(pProfile.Width, pProfile.Height)) {
            addIssue(validation, "warnings", "RiverWidth", "river is wide relative to the selected map size");
        }

        validation.ok = validation.errors.length === 0;
        return validation;
    }

    var defaults = {
        Name: "grammar_jungle",
        TerrainType: Terrain.Types.Jungle,
        TerrainTypeSub: 0,
        MainPathWidth: [2, 4],
        SidePathWidth: [1, 2],
        CrossingMaxRouteDistance: 8,
        MicroStampDensity: 1.0,
        // River-meander dials are validated unconditionally for every profile,
        // so they must be defined here (not only on the jungle terrain block)
        // or non-jungle terrains fail validation fatally on every retry.
        RiverMeanderPrimary: 1.0,
        RiverMeanderSecondary: 0.45,
        RiverMeanderJitter: 0.2,
        RiverDeltaWidth: 1,
        RiverBisectChance: 0.7,
        StraightShoreRunLimit: 8,
        ShorelineWobbleStride: 5,
        MaxShorelineWobbleCells: 48,
        // T2.11: maximum tributary recursion depth. Each level halves the
        // chance and shrinks width by 1; 2 keeps Y-junctions visible without
        // turning every river into a delta.
        MaxBranchDepth: 2,
        ObjectiveTemplates: ["kill_enemies", "destroy_buildings"],
        ExtremeFields: ["TreeCoverage", "ClearingsPer2048Tiles", "EnemyDensity", "DecorDensity", "MaxWaterCoverage"],
        LayoutTemplates: {
            classic: 0.30, localised_zone: 0.20,
            corner_to_corner: 0.10, siege: 0.08, peninsula: 0.05,
            crossroads: 0.10, valley: 0.07, linear_gauntlet: 0.04,
            hub_and_spoke: 0.04, parallel_lanes: 0.02
        },
        PathStyles: {
            bezier: 0.55, smooth_s: 0.20, meander: 0.10,
            zigzag: 0.08, staircase: 0.04, direct: 0.03
        },
        ValidationRetries: 12,
        MaxRepairPasses: 2,
        RequireConnectedCriticalPath: true,
        // T3.17 — land cohesion. Fragments below MinFragmentTiles get filled
        // back into water/blocked; the main land mass must be ≥ MinMainMassFraction
        // of total walkable area or Repair carves bridges to absorb fragments.
        MinFragmentTiles: 12,
        MinMainMassFraction: 0.55,
        // T1.6: weighted aspect ratio palette. The longer of the resolved
        // Width/Height becomes the long side; orthogonal side = long/ratio.
        // Ratios <1 flip orientation so portrait maps appear too.
        AspectRatioPalette: [
            { ratio: 1.0,   weight: 1.0 },
            { ratio: 1.6,   weight: 0.6 },
            { ratio: 0.625, weight: 0.6 },
            { ratio: 2.0,   weight: 0.3 },
            { ratio: 0.5,   weight: 0.3 }
        ],
        MinSide: 24,
        MaxSide: 96
    };

    var terrainDefaults = {};

    terrainDefaults[Terrain.Types.Jungle] = {
        Width: [40, 70],
        Height: [36, 52],
        MainPathWidth: [2, 3],
        SidePathWidth: [1, 2],
        TreeCoverage: [0.52, 0.68],
        MaxTreeCoverage: 0.82,
        TreeCoverOnCoast: true,
        // T2.13: patch-and-grow forest. Pareto-distributed patch sizes give
        // discrete blobs instead of the value-noise carpet that previously
        // read as uniform texture.
        ForestPatchAndGrow: true,
        ForestSeedDensity: 0.0065,
        ForestPatchAlpha: 1.4,
        ForestPatchMinSize: 8,
        ForestPatchMaxSize: 80,
        CarvedForestFill: true,
        CarvedForestCoverage: [0.58, 0.70],
        CarvedForestSectorFill: true,
        CarvedForestSectorSize: [12, 18],
        CarvedForestSectorCoverage: [0.40, 0.52],
        AllowOuterEdgeCover: true,
        PerimeterCover: true,
        PerimeterCoverWidth: [2, 4],
        PerimeterCoverChance: [0.72, 0.88],
        MaxWalkablePerimeterRun: [6, 10],
        AnchorBorderInset: 4,
        RouteBorderInset: 4,
        RouteBorderHardInset: 1,
        RouteBorderPenalty: 30,
        DeadEndSpursPer2048Tiles: [1.0, 2.2],
        DeadEndSpurLength: [8, 18],
        RouteWanderCost: [0.40, 1.10],
        RouteWanderScale: [6, 11],
        TacticalCoverShaping: true,
        PostPlacementRouteCarving: false,
        ExtraStructureSitesRequireConnected: false,
        ExtraStructureSitesRequireSpur: true,
        TacticalCoverDensity: 1.30,
        RouteTacticalCoverSpacing: 8,
        RouteTacticalCoverScreenChance: 0.95,
        RouteTacticalCoverOffsetPadding: 1,
        PostPlacementCoverDensity: 0.85,
        RouteEdgeCover: true,
        RouteEdgeCoverSpacing: 3,
        RouteEdgeCoverChance: 0.82,
        RouteEdgeCoverDistance: 2,
        RouteEdgeCoverLength: [8, 16],
        RouteEdgeCoverThickness: [1, 2],
        RouteExposureRadius: 5,
        RouteExposureMinCover: 8,
        MaxRouteExposureFraction: 0.48,
        MaxRouteExposedRunTiles: 26,
        RouteExposureHardFail: true,
        RouteExposureBreakup: true,
        RouteExposureBreakupMinCover: 8,
        RouteExposureBreakupMinRunTiles: 14,
        RouteExposureBreakupRunChunkTiles: 20,
        RouteExposureBreakupScreenLength: [8, 14],
        RouteExposureBreakupScreenThickness: [1, 2],
        RouteExposureBreakupPathCenterClearance: 1,
        MaxRouteExposureBreakupScreens: 22,
        OpenFieldScreens: true,
        OpenFieldScreenSectorSize: [14, 18],
        OpenFieldScreenMinOpenFraction: 0.68,
        OpenFieldScreenMinOpenTiles: 80,
        OpenFieldScreenLength: [9, 16],
        OpenFieldScreenThickness: [1, 2],
        OpenFieldScreenPathCenterClearance: 1,
        PostOpenAreaPathCenterClearance: 1,
        MaxOpenFieldScreens: 14,
        OpenAreaBreakup: true,
        MaxOpenAreaFraction: 0.020,
        MinOpenAreaTiles: 72,
        OpenAreaBreakupChunkTiles: 40,
        MaxOpenAreaBreakupIslands: 55,
        MaxOpenAreaBreakupScreens: 18,
        OpenAreaBreakupPasses: 3,
        OpenAreaBreakupScreenLength: [9, 18],
        OpenAreaBreakupScreenThickness: [1, 2],
        PostMaxOpenAreaFraction: 0.014,
        PostMinOpenAreaTiles: 64,
        PostOpenAreaBreakupChunkTiles: 32,
        PostOpenAreaBreakupPasses: 2,
        PathCoverage: [0.08, 0.14],
        ClearingsPer2048Tiles: [2, 4],
        ClearingRadius: [3, 7],
        TeamClearingRadiusScale: 1.0,
        ObjectiveClearingRadiusScale: 1.05,
        RouteClearingRadiusScale: 0.45,
        RouteRestClearingRadiusScale: 0.42,
        AmbushClearingRadiusScale: 0.45,
        FlankClearingRadiusScale: 0.42,
        WildernessClearingsPer2048Tiles: [1, 3],
        LoopChance: 0.25,
        RiverChance: 0.20,
        MaxRiverCount: 1,
        // Architecture v3: area-scale jungle water features. Jungle water target
        // is low (~6%), so rates are conservative — 1 river/pond at the 2048
        // reference, scaling only modestly on the larger jungle map sizes.
        RiversPer2048Tiles: 1.0,
        PondsPer2048Tiles: [1, 1],
        RiverBranchChance: 0.10,
        RiverWidth: [2, 4],
        RiverMeander: [0.20, 0.45],
        StraightShoreRunLimit: 7,
        ShorelineWobbleStride: 5,
        MaxShorelineWobbleCells: 54,
        StreamChance: 0.40,
        StreamsPer2048Tiles: 0.6,
        CrossingsPer2048Tiles: [1, 2],
        // Minimum total bridge length (Start + water rows + End) before the
        // bridge stamper will commit to a crossing. 3 = 1 water row spanning
        // a small stream; the stamper handles longer rivers automatically.
        // Set to 0 (or omit) to disable bridge placement for a profile.
        BridgeMinRiverWidth: 3,
        PondChance: 0.15,
        MaxPondCount: 1,
        CoastChance: 0,
        CoastWaterWidth: [3, 5],
        BeachWidth: [2, 4],
        CoastBayChance: 0.35,
        CoastBayDepth: 14,
        CoastBayWindow: 11,
        MaxWaterCoverage: 0.16,
        LandFraction: 0.78,
        ContinentStyles: [
            { name: "island",    weight: 0.30 },
            { name: "edge",      weight: 0.40 },
            { name: "rectangle", weight: 0.30 }
        ],
        EnemyDensity: [0.30, 0.55],
        StructureClustersPer2048Tiles: [1, 4],
        DecorDensity: [0.8, 1.1],
        EncounterClearingRadius: 3,
        // Jungle cliffs are pure barriers (no walkway in the stamp art).
        // The CliffHelicopter feature pass places a helicopter pickup on the
        // player-accessible side; Validate.CliffsTraversable verifies the
        // squad can reach it. See [[cliff-transit-coupling]] memory.
        CliffChance: 0.4,
        PlateauChance: 0.4,
        HelicopterTransit: true,
        DesertDropChunkChance: 0,
        DesertDropChunkMaxPer3072Tiles: 0,
        OutcropChance: 0.50,
        OutcropsPer2048Tiles: [0.3, 0.9],
        OutcropRadius: [3, 6],
        OutcropKind: "trees",
        EdgeBiomeChance: 0.20,
        EdgeBiomeKinds: { swamp: 0.55, ridge: 0.45 },
        EdgeBiomeAxisCoverage: [0.30, 0.60],
        EdgeBiomeWaterWidth: [2, 4],
        EdgeBiomeBeachWidth: [1, 3],
        EdgeBiomeBandWidth: [2, 4],
        DefensiveLineChance: 0.10,
        DefensiveLineCount: 1,
        DefensiveLineFraction: [0.40, 0.60],
        DefensiveLineThickness: [2, 3],
        DefensiveLineAxisCoverage: [0.45, 0.70],
        LayoutTemplates: {
            classic: 0.30, localised_zone: 0.25,
            hub_and_spoke: 0.12, crossroads: 0.10, siege: 0.08,
            corner_to_corner: 0.06, valley: 0.05, peninsula: 0.04
        },
        PathStyles: {
            bezier: 0.45, meander: 0.25, smooth_s: 0.20,
            zigzag: 0.05, direct: 0.05
        }
    };

    terrainDefaults[Terrain.Types.Desert] = {
        Width: [36, 56],
        Height: [34, 48],
        TreeCoverage: [0.15, 0.30],
        PathCoverage: [0.10, 0.18],
        ClearingsPer2048Tiles: [2, 4],
        ClearingRadius: [4, 8],
        TeamClearingRadiusScale: 1.0,
        ObjectiveClearingRadiusScale: 1.0,
        RouteClearingRadiusScale: 0.45,
        RouteRestClearingRadiusScale: 0.42,
        AmbushClearingRadiusScale: 0.45,
        FlankClearingRadiusScale: 0.42,
        WildernessClearingsPer2048Tiles: [1, 2],
        LoopChance: 0.30,
        RiverChance: 0,
        MaxRiverCount: 0,
        RiverBranchChance: 0,
        RiverWidth: [1, 1],
        RiverMeander: [0, 0],
        StreamChance: 0,
        StreamsPer2048Tiles: 0,
        CrossingsPer2048Tiles: [0, 0],
        PondChance: 0,
        MaxPondCount: 0,
        CoastChance: 0,
        CoastWaterWidth: [3, 5],
        BeachWidth: [2, 4],
        MaxWaterCoverage: 0,
        LandFraction: 0.92,
        ContinentStyles: [
            { name: "island",    weight: 0.10 },
            { name: "edge",      weight: 0.30 },
            { name: "rectangle", weight: 0.60 }
        ],
        EnemyDensity: [0.10, 0.22],
        StructureClustersPer2048Tiles: [1.0, 2.4],
        DecorDensity: [0.35, 0.65],
        DesertDropChunkChance: [0.20, 0.36],
        DesertDropChunkMaxPer3072Tiles: [1, 2],
        OutcropChance: 0.55,
        OutcropsPer2048Tiles: [0.3, 0.9],
        OutcropRadius: [3, 6],
        OutcropKind: "rocks",
        // Desert cliffs use a vertical bridge for vertical traversal — cliff
        // stamps are pure barriers (no walkway in the art), so the bridge
        // pass stamps a vertical bridge across the cliff band whenever a
        // plateau rolls. See [[cliff-transit-coupling]] memory and T0.8b in
        // tasks doc.
        CliffChance: 1.0,
        PlateauChance: 0.4,
        CliffBridgeTransit: true,
        EdgeBiomeChance: 0.22,
        EdgeBiomeKinds: { ridge: 1.0 },
        EdgeBiomeAxisCoverage: [0.30, 0.65],
        EdgeBiomeWaterWidth: [2, 4],
        EdgeBiomeBeachWidth: [1, 3],
        EdgeBiomeBandWidth: [2, 4],
        DefensiveLineChance: 0.18,
        DefensiveLineCount: 1,
        DefensiveLineFraction: [0.40, 0.60],
        DefensiveLineThickness: [2, 4],
        DefensiveLineAxisCoverage: [0.50, 0.80],
        LayoutTemplates: {
            classic: 0.18, localised_zone: 0.20,
            corner_to_corner: 0.18, valley: 0.14, peninsula: 0.10,
            parallel_lanes: 0.08, crossroads: 0.07, siege: 0.05
        },
        PathStyles: {
            bezier: 0.40, smooth_s: 0.30, direct: 0.15,
            meander: 0.10, zigzag: 0.05
        }
    };

    terrainDefaults[Terrain.Types.Ice] = {
        Width: [40, 60],
        Height: [36, 52],
        MainPathWidth: [2, 3],
        SidePathWidth: [1, 2],
        TreeCoverage: [0.36, 0.54],
        MaxTreeCoverage: 0.68,
        ForestPatchAndGrow: true,
        ForestSeedDensity: 0.0045,
        ForestPatchAlpha: 1.35,
        ForestPatchMinSize: 6,
        ForestPatchMaxSize: 60,
        CarvedForestFill: true,
        CarvedForestCoverage: [0.44, 0.58],
        CarvedForestSectorFill: true,
        CarvedForestSectorSize: [10, 14],
        CarvedForestSectorCoverage: [0.40, 0.52],
        AllowOuterEdgeCover: true,
        PerimeterCover: true,
        PerimeterCoverWidth: [2, 3],
        PerimeterCoverChance: [0.45, 0.70],
        MaxWalkablePerimeterRun: [8, 12],
        AnchorBorderInset: 4,
        RouteBorderInset: 5,
        RouteBorderHardInset: 2,
        RouteBorderPenalty: 36,
        DeadEndSpursPer2048Tiles: [0.5, 1.4],
        DeadEndSpurLength: [7, 15],
        RouteWanderCost: [0.25, 0.80],
        RouteWanderScale: [7, 12],
        TacticalCoverShaping: true,
        PostPlacementRouteCarving: false,
        ExtraStructureSitesRequireConnected: false,
        ExtraStructureSitesRequireSpur: true,
        TacticalCoverDensity: 1.15,
        RouteTacticalCoverSpacing: 9,
        RouteTacticalCoverScreenChance: 0.88,
        RouteTacticalCoverOffsetPadding: 1,
        PostPlacementCoverDensity: 1.05,
        RouteEdgeCover: true,
        RouteEdgeCoverSpacing: 4,
        RouteEdgeCoverChance: 0.72,
        RouteEdgeCoverDistance: 2,
        RouteEdgeCoverLength: [8, 15],
        RouteEdgeCoverThickness: [1, 2],
        RouteExposureRadius: 5,
        RouteExposureMinCover: 7,
        MaxRouteExposureFraction: 0.52,
        MaxRouteExposedRunTiles: 30,
        RouteExposureHardFail: true,
        RouteExposureBreakup: true,
        RouteExposureBreakupMinCover: 8,
        RouteExposureBreakupMinRunTiles: 12,
        RouteExposureBreakupRunChunkTiles: 18,
        RouteExposureBreakupScreenLength: [8, 15],
        RouteExposureBreakupScreenThickness: 1,
        RouteExposureBreakupPathCenterClearance: 1,
        MaxRouteExposureBreakupScreens: 26,
        OpenFieldScreens: true,
        OpenFieldScreenSectorSize: [14, 18],
        OpenFieldScreenMinOpenFraction: 0.56,
        OpenFieldScreenMinOpenTiles: 48,
        OpenFieldScreenLength: [14, 24],
        OpenFieldScreenThickness: [1, 2],
        OpenFieldScreenPathCenterClearance: 1,
        PostOpenAreaPathCenterClearance: 1,
        MaxOpenFieldScreens: 36,
        OpenAreaBreakup: true,
        MaxOpenAreaFraction: 0.025,
        MinOpenAreaTiles: 96,
        OpenAreaBreakupChunkTiles: 42,
        MaxOpenAreaBreakupIslands: 60,
        MaxOpenAreaBreakupScreens: 24,
        OpenAreaBreakupPasses: 3,
        OpenAreaBreakupScreenLength: [10, 18],
        OpenAreaBreakupScreenThickness: 1,
        PostMaxOpenAreaFraction: 0.010,
        PostMinOpenAreaTiles: 56,
        PostOpenAreaBreakupChunkTiles: 24,
        PostOpenAreaBreakupPasses: 4,
        FinalOpenFieldCover: true,
        FinalOpenFieldCoverSectorSize: [10, 12],
        FinalOpenFieldCoverMinOpenFraction: 0.50,
        FinalOpenFieldCoverMinOpenTiles: 42,
        FinalOpenFieldCoverLength: [16, 26],
        FinalOpenFieldCoverThickness: [1, 2],
        FinalOpenFieldCoverPathCenterClearance: 2,
        FinalOpenFieldCoverHardEdgeClearance: 3,
        MaxFinalOpenFieldCoverScreens: 42,
        PathCoverage: [0.09, 0.16],
        ClearingsPer2048Tiles: [2, 5],
        ClearingRadius: [4, 8],
        TeamClearingRadiusScale: 1.0,
        ObjectiveClearingRadiusScale: 1.05,
        SupportClearingRadiusScale: 0.65,
        RouteClearingRadiusScale: 0.45,
        RouteRestClearingRadiusScale: 0.42,
        AmbushClearingRadiusScale: 0.45,
        FlankClearingRadiusScale: 0.42,
        OpenSpaceClearingRadiusScale: 0.45,
        SmallClearingRadiusScale: 0.40,
        WildernessClearingsPer2048Tiles: [1, 2],
        LoopChance: 0.20,
        RiverChance: 0.12,
        MaxRiverCount: 1,
        // Architecture v3: rates scale water-feature counts with map area so
        // big ice maps are not sparse. At the 2048 reference (~45x45) these
        // reproduce today's counts (1 river, 1 pond); a 60x60 map (~1.75x)
        // yields ~2 rivers / 1-2 ponds. Lake rate lives on the ice profiles
        // (grammar_ice/pvp) where LakeChance/MaxLakeCount are defined.
        RiversPer2048Tiles: 1.0,
        PondsPer2048Tiles: [1, 1],
        RiverBranchChance: 0.05,
        RiverWidth: [2, 3],
        RiverMeander: [0.20, 0.40],
        StraightShoreRunLimit: 6,
        ShorelineWobbleStride: 4,
        MaxShorelineWobbleCells: 72,
        StreamChance: 0.30,
        StreamsPer2048Tiles: 0.3,
        CrossingsPer2048Tiles: [1, 2],
        PondChance: 0.18,
        MaxPondCount: 1,
        CoastChance: 0,
        CoastWaterWidth: [3, 5],
        BeachWidth: [2, 4],
        // Cap is permissive because the archipelago style fills ~45% of the map
        // with water; non-archipelago ice rolls target ~0.65 land = 0.35 water
        // and never approach this ceiling.
        MaxWaterCoverage: 0.50,
        // 2026-06-15 (Stream B): tried MinMainMassFraction: 0.62 (override
        // of default 0.55) to reject water-dominated "geometry plain" seeds
        // like 7005. NO-OP — across a 92-attempt batch, ZERO attempts
        // failed `land_too_fragmented`. The main-mass fraction was already
        // > 0.62 on every seed; the geometry-plain class is actually caught
        // by `water_composition_frame_silhouette` and `rendered_tree_tiles_
        // too_low`, not by the main-mass gate. Reverted to default. The two
        // failing validators are doing their job; what they DON'T do is
        // distinguish "frame silhouette but renderable" from "frame
        // silhouette + thin land strips that won't render forest." That's
        // a separate, more targeted validator if ever needed. See
        // [[ice_forest_render_ratio]] for the two-classes-of-plain finding.
        MinLandBlobCountWarning: 3,
        MaxLandBlobCountWarning: 9,
        LandFraction: 0.65,
        ContinentStyles: [
            { name: "archipelago", weight: 0.35, landFraction: 0.55 },
            { name: "island",      weight: 0.40 },
            { name: "edge",        weight: 0.15 },
            { name: "rectangle",   weight: 0.10 }
        ],
        EnemyDensity: [0.08, 0.18],
        StructureClustersPer2048Tiles: [3, 7],
        DecorDensity: [0.45, 0.80],
        // Ice is the only biome with stairs through the cliff (see
        // Structures.Ice.Cliff.Stairs in Cliff.js). Plateau is rolled first;
        // if it fires, the cliff is always stamped along the band.
        CliffChance: 1.0,
        CliffWaterClearance: 1,
        PlateauChance: 0.6,
        // ForestSeedJitter — left at default 0.40 (no override).
        // 2026-06-16: tried 0.80 to break the largeScale-noise lobe
        // dominance documented in [[ice_forest_seed_quadrant_bias]].
        // Result: BACKFIRED. Pooled quadrant-bias chi-square WORSENED
        // (median p 1e-31 → 1e-36); outpost/neck_route render-ratio
        // collapsed (33%→11%) because high jitter scatters patches into
        // small clusters that the ice renderer's prune passes discard.
        // Hypothesis "more jitter = less clumping" was wrong: jitter
        // creates LOCAL high-score peaks rather than smoothing the
        // landscape. Reverted. Real fix for the quadrant bias would
        // need to either lower the largeScale weight in TreeScore (cross-
        // biome blast radius) OR add a multi-seed force-spread pass
        // that places one seed per quadrant if any quadrant is empty.
        DesertDropChunkChance: 0,
        DesertDropChunkMaxPer3072Tiles: 0,
        OutcropChance: 0.40,
        OutcropsPer2048Tiles: [0.3, 0.6],
        OutcropRadius: [3, 5],
        OutcropKind: "rocks",
        EdgeBiomeChance: 0.22,
        EdgeBiomeKinds: { coast: 0.40, ridge: 0.60 },
        EdgeBiomeAxisCoverage: [0.30, 0.60],
        EdgeBiomeWaterWidth: [2, 4],
        EdgeBiomeBeachWidth: [1, 3],
        EdgeBiomeBandWidth: [2, 4],
        DefensiveLineChance: 0.20,
        DefensiveLineCount: 1,
        DefensiveLineFraction: [0.40, 0.65],
        DefensiveLineThickness: [2, 3],
        DefensiveLineAxisCoverage: [0.45, 0.75],
        LayoutTemplates: {
            classic: 0.22, localised_zone: 0.22,
            siege: 0.18, hub_and_spoke: 0.12, crossroads: 0.10,
            corner_to_corner: 0.08, valley: 0.05, linear_gauntlet: 0.03
        },
        PathStyles: {
            bezier: 0.45, zigzag: 0.20, smooth_s: 0.15,
            meander: 0.10, staircase: 0.05, direct: 0.05
        }
    };

    terrainDefaults[Terrain.Types.Interior] = {
        Width: [38, 58],
        Height: [28, 42],
        TreeCoverage: [0.25, 0.45],
        PathCoverage: [0.12, 0.22],
        ClearingsPer2048Tiles: [4, 8],
        ClearingRadius: [4, 9],
        WildernessClearingsPer2048Tiles: [0, 2],
        LoopChance: 0.40,
        RiverChance: 0,
        MaxRiverCount: 0,
        RiverBranchChance: 0,
        RiverWidth: [1, 1],
        RiverMeander: [0, 0],
        StreamChance: 0,
        StreamsPer2048Tiles: 0,
        CrossingsPer2048Tiles: [0, 0],
        PondChance: 0.08,
        MaxPondCount: 1,
        CoastChance: 0,
        CoastWaterWidth: [3, 5],
        BeachWidth: [2, 4],
        MaxWaterCoverage: 0.05,
        EnemyDensity: [0.07, 0.16],
        StructureClustersPer2048Tiles: [2, 5],
        DecorDensity: [0.45, 0.80],
        DesertDropChunkChance: 0,
        DesertDropChunkMaxPer3072Tiles: 0,
        OutcropChance: 0.15,
        OutcropsPer2048Tiles: [0, 0.3],
        OutcropRadius: [2, 4],
        OutcropKind: "rocks",
        EdgeBiomeChance: 0.10,
        EdgeBiomeKinds: { ridge: 1.0 },
        EdgeBiomeAxisCoverage: [0.30, 0.55],
        EdgeBiomeWaterWidth: [2, 3],
        EdgeBiomeBeachWidth: [1, 2],
        EdgeBiomeBandWidth: [2, 3],
        DefensiveLineChance: 0.30,
        DefensiveLineCount: [1, 2],
        DefensiveLineFraction: [0.30, 0.70],
        DefensiveLineThickness: [2, 4],
        DefensiveLineAxisCoverage: [0.55, 0.85],
        LayoutTemplates: {
            classic: 0.18, localised_zone: 0.25,
            siege: 0.20, hub_and_spoke: 0.15, crossroads: 0.10,
            corner_to_corner: 0.05, parallel_lanes: 0.04, linear_gauntlet: 0.03
        },
        PathStyles: {
            staircase: 0.40, zigzag: 0.25, bezier: 0.20,
            direct: 0.10, smooth_s: 0.05
        }
    };

    terrainDefaults[Terrain.Types.Moors] = {
        Width: [44, 72],
        Height: [40, 60],
        TreeCoverage: [0.30, 0.50],
        PathCoverage: [0.08, 0.15],
        ClearingsPer2048Tiles: [3, 7],
        ClearingRadius: [5, 11],
        WildernessClearingsPer2048Tiles: [2, 4],
        LoopChance: 0.28,
        RiverChance: 0.22,
        MaxRiverCount: 1,
        RiverBranchChance: 0.10,
        RiverWidth: [2, 3],
        RiverMeander: [0.20, 0.45],
        StreamChance: 0.50,
        StreamsPer2048Tiles: 0.6,
        CrossingsPer2048Tiles: [1, 2],
        PondChance: 0.30,
        MaxPondCount: 2,
        CoastChance: 0,
        CoastWaterWidth: [3, 5],
        BeachWidth: [2, 4],
        MaxWaterCoverage: 0.18,
        EnemyDensity: [0.05, 0.12],
        StructureClustersPer2048Tiles: [2, 5],
        DecorDensity: [0.55, 0.95],
        DesertDropChunkChance: 0,
        DesertDropChunkMaxPer3072Tiles: 0,
        OutcropChance: 0.45,
        OutcropsPer2048Tiles: [0.3, 0.9],
        OutcropRadius: [3, 6],
        OutcropKind: "trees",
        EdgeBiomeChance: 0.30,
        EdgeBiomeKinds: { swamp: 0.55, coast: 0.20, ridge: 0.25 },
        EdgeBiomeAxisCoverage: [0.35, 0.65],
        EdgeBiomeWaterWidth: [2, 4],
        EdgeBiomeBeachWidth: [1, 3],
        EdgeBiomeBandWidth: [2, 4],
        DefensiveLineChance: 0.08,
        DefensiveLineCount: 1,
        DefensiveLineFraction: [0.40, 0.60],
        DefensiveLineThickness: [2, 3],
        DefensiveLineAxisCoverage: [0.40, 0.65],
        LayoutTemplates: {
            classic: 0.30, localised_zone: 0.18,
            corner_to_corner: 0.15, valley: 0.12, peninsula: 0.08,
            hub_and_spoke: 0.07, crossroads: 0.06, siege: 0.04
        },
        PathStyles: {
            meander: 0.40, bezier: 0.30, smooth_s: 0.15,
            zigzag: 0.10, direct: 0.05
        }
    };

    terrainDefaults[Terrain.Types.AmigaFormat] = {
        Width: [40, 60],
        Height: [36, 52],
        TreeCoverage: [0.22, 0.40],
        PathCoverage: [0.09, 0.16],
        ClearingsPer2048Tiles: [3, 7],
        ClearingRadius: [5, 11],
        WildernessClearingsPer2048Tiles: [1, 2],
        LoopChance: 0.20,
        RiverChance: 0.10,
        MaxRiverCount: 1,
        RiverBranchChance: 0.05,
        RiverWidth: [2, 3],
        RiverMeander: [0.20, 0.40],
        StreamChance: 0.25,
        StreamsPer2048Tiles: 0.3,
        CrossingsPer2048Tiles: [1, 2],
        PondChance: 0.16,
        MaxPondCount: 1,
        CoastChance: 0,
        CoastWaterWidth: [3, 5],
        BeachWidth: [2, 4],
        MaxWaterCoverage: 0.10,
        EnemyDensity: [0.08, 0.18],
        StructureClustersPer2048Tiles: [2, 5],
        DecorDensity: [0.40, 0.70],
        DesertDropChunkChance: 0,
        DesertDropChunkMaxPer3072Tiles: 0,
        OutcropChance: 0.35,
        OutcropsPer2048Tiles: [0.3, 0.6],
        OutcropRadius: [3, 5],
        OutcropKind: "rocks",
        EdgeBiomeChance: 0.18,
        EdgeBiomeKinds: { coast: 0.40, ridge: 0.60 },
        EdgeBiomeAxisCoverage: [0.30, 0.60],
        EdgeBiomeWaterWidth: [2, 4],
        EdgeBiomeBeachWidth: [1, 3],
        EdgeBiomeBandWidth: [2, 4],
        DefensiveLineChance: 0.18,
        DefensiveLineCount: 1,
        DefensiveLineFraction: [0.40, 0.65],
        DefensiveLineThickness: [2, 3],
        DefensiveLineAxisCoverage: [0.45, 0.75],
        LayoutTemplates: {
            classic: 0.22, localised_zone: 0.22,
            siege: 0.18, hub_and_spoke: 0.12, crossroads: 0.10,
            corner_to_corner: 0.08, valley: 0.05, linear_gauntlet: 0.03
        },
        PathStyles: {
            bezier: 0.45, smooth_s: 0.20, zigzag: 0.15,
            meander: 0.10, direct: 0.05, staircase: 0.05
        }
    };

    var profiles = {
        grammar_jungle: {
            GeneratorCore: "official_grammar",
            TargetPackProfile: "grammar_jungle",
            TerrainVariant: "jun_sub0",
            TerrainTypeSub: 0,
            // Generic jungle chooses a procedural route/archetype for each
            // seed. Applying a shipped-map terrain raster afterward erased
            // that choice and made unrelated seeds share the same macro
            // silhouette. Keep the corpus-derived weights and constraints,
            // but let the selected procedural style own the live terrain.
            UseOriginalTerrainTemplate: false,
            AllowJungleBeachTiles: false,
            DeadEndSpursPer2048Tiles: [0.2, 1.0],
            LoopChance: 0.12,
            DecorDensity: [1.35, 1.8],
            MicroStampDensity: 1.6,
            CliffChance: 0.75,
            PlateauChance: 0.55,
            // Shipped jungle cliffs (mapm2/mapm20) are single continuous
            // formations which span the map from left edge to right edge.
            // Plan/stamp them before gameplay sites can punch column gaps in
            // the band, and skip the feature when no full-width dry band is
            // available instead of emitting disconnected cliff blocks.
            RequireFullWidthCliffs: true,
            CliffLayoutPhase: true,
            // Keep the terrain planner's normal structure count, but require
            // the live 4x4 building footprints to occupy distinct map areas.
            StructureMinSpacing: 10,
            LiveStructureMinSpacing: 16,
            StructureBuildingsPerClearing: 1,
            StructureMaxClearings: 8,
            // Shoreline tiles cannot form readable ponds from smaller,
            // disconnected water fragments; fold those flecks back to grass.
            JungleMaxInteriorWaterFragmentTiles: 10,
            JunglePruneUnrenderableNarrowWater: true,
            // Macro variety for the general-purpose profile. Explicit maze and
            // neck profiles still win through their singular RouteArchetype.
            // Mainland starts dry but can receive normal rivers/ponds later,
            // avoiding the repeated island-with-water-frame silhouette.
            RouteArchetypes: {
                outpost: 0.28,
                compound_route: 0.20,
                winding_route: 0.24,
                open_route: 0.16,
                broken_trail: 0.12
            },
            ContinentStyles: [
                { name: "mainland",  weight: 0.24 },
                { name: "island",    weight: 0.20 },
                { name: "edge",      weight: 0.30 },
                { name: "rectangle", weight: 0.26 }
            ],
            ObjectiveTemplates: ["kill_enemies", "destroy_buildings", "destroy_base", "rescue_hostages", "civilian_home"]
        },

        grammar_beach: {
            GeneratorCore: "official_grammar",
            RequireSandyCoastline: true,
            TargetPackProfile: "grammar_beach",
            TerrainVariant: "jun_sub1",
            TerrainTypeSub: 1,
            AllowJungleBeachTiles: true,
            TreeCoverOnCoast: false,
            TreeCoverage: [0.16, 0.24],
            MinTreeCoverage: 0.12,
            MaxTreeCoverage: 0.289,
            CarvedForestCoverage: [0.16, 0.24],
            CarvedForestSectorCoverage: [0.04, 0.10],
            PerimeterCoverWidth: [1, 2],
            PerimeterCoverChance: [0.06, 0.16],
            MaxWalkablePerimeterRun: [12, 18],
            TacticalCoverDensity: 0.58,
            PostPlacementCoverDensity: 0.62,
            RouteTacticalCoverSpacing: 10,
            RouteTacticalCoverScreenChance: 0.46,
            RouteEdgeCoverSpacing: 5,
            RouteEdgeCoverChance: 0.46,
            RouteEdgeCoverDistance: 2,
            RouteEdgeCoverLength: [5, 10],
            RouteExposureMinCover: 8,
            MaxRouteExposureFraction: 0.56,
            MaxRouteExposedRunTiles: 30,
            RouteExposureBreakup: true,
            RouteExposureBreakupMinCover: 8,
            RouteExposureBreakupMinRunTiles: 10,
            RouteExposureBreakupRunChunkTiles: 15,
            RouteExposureBreakupScreenLength: [6, 11],
            RouteExposureBreakupScreenThickness: 1,
            RouteExposureBreakupPathCenterClearance: 1,
            MaxRouteExposureBreakupScreens: 18,
            DeadEndSpurs: false,
            DeadEndSpursPer2048Tiles: [0.0, 0.0],
            DeadEndSpurLength: [6, 12],
            LoopChance: 0.10,
            // Beach used to inherit no route weights and therefore resolved
            // every seed to `outpost`. Pair the three official terrain
            // families with the same broad route vocabulary used by jungle.
            RouteArchetypes: {
                outpost: 0.18,
                compound_route: 0.14,
                winding_route: 0.30,
                open_route: 0.20,
                broken_trail: 0.18
            },
            LayoutTemplates: {
                classic: 0.16,
                localised_zone: 0.16,
                corner_to_corner: 0.18,
                valley: 0.16,
                peninsula: 0.12,
                hub_and_spoke: 0.12,
                crossroads: 0.10
            },
            PathStyles: {
                bezier: 0.28,
                smooth_s: 0.24,
                meander: 0.24,
                zigzag: 0.14,
                direct: 0.10
            },
            StructureClustersPer2048Tiles: [0, 0],
            // Beach structures are sparse landmarks, not compounds. Keep
            // separate placements far enough apart that two-building missions
            // cannot collapse into one bunker clump.
            StructureMinSpacing: 14,
            LiveStructureMinSpacing: 14,
            StructureBuildingsPerClearing: 1,
            StructureMaxClearings: 4,
            ObjectiveTemplates: ["kill_enemies", "destroy_buildings", "destroy_base", "rescue_hostages"],
            CoastChance: 0,
            CoastAxisCoverage: [0.38, 0.58],
            CoastAxisMargin: 4,
            CoastWaterBeachEdgeRadius: 2,
            CoastBeachWaterRadius: 4,
            LocalBeachRadius: [14, 22],
            AllowBeachPondPocket: false,
            AllowQuicksandBeachAnchors: false,
            QuicksandBeachMinDistance: 4,
            QuicksandBeachCenterMinDistance: 8,
            QuicksandCoastAffinityDistance: 18,
            CoastWaterWidth: [3, 5],
            BeachWidth: [4, 7],
            CoastBayChance: 0.25,
            CoastBayDepth: 6,
            CoastBayWindow: 9,
            MaxWaterCoverage: 0.16,
            LandFraction: 0.82,
            GrassPaletteRareWeight: 0.005,
            GrassEdgeMatchPasses: 1,
            DecorDensity: [1.2, 1.6],
            MicroStampDensity: 1.5,
            EdgeBiomeChance: 0,
            CliffChance: 0,
            PlateauChance: 0,
            HelicopterTransit: false,
            AllowCampaignHelicopterFallback: false
        },

        pvp_balanced_jungle: {
            AspectRatioPalette: [
                { ratio: 1.0,   weight: 1.0 },
                { ratio: 1.25,  weight: 0.35 },
                { ratio: 0.80,  weight: 0.35 },
                { ratio: 1.5,   weight: 0.12 },
                { ratio: 0.667, weight: 0.12 }
            ],
            MinSide: 48,
            TreeCoverage: [0.50, 0.64],
            MaxTreeCoverage: 0.78,
            CarvedForestCoverage: [0.56, 0.68],
            CarvedForestSectorCoverage: [0.38, 0.50],
            PerimeterCoverChance: [0.60, 0.78],
            MaxWalkablePerimeterRun: [6, 10],
            DeadEndSpursPer2048Tiles: [1.2, 2.4],
            DeadEndSpurLength: [7, 16],
            RouteWanderCost: [0.25, 0.70],
            MainPathWidth: [2, 3],
            SidePathWidth: [1, 1],
            MinimumTacticalLanes: 2,
            PathCoverage: [0.12, 0.20],
            ClearingsPer2048Tiles: [3, 5],
            ClearingRadius: [4, 7],
            RouteClearingRadiusScale: 0.42,
            RouteRestClearingRadiusScale: 0.40,
            AmbushClearingRadiusScale: 0.42,
            FlankClearingRadiusScale: 0.40,
            ContestedClearingRadiusScale: 0.85,
            CrossingsPer2048Tiles: [2, 3],
            TacticalCoverDensity: 0.95,
            PostPlacementCoverDensity: 0.80,
            RouteTacticalCoverSpacing: 12,
            RouteTacticalCoverScreenChance: 0.75,
            RouteEdgeCoverSpacing: 4,
            RouteEdgeCoverChance: 0.62,
            MaxRouteExposureFraction: 0.52,
            MaxRouteExposedRunTiles: 28,
            RouteExposureBreakupMinRunTiles: 16,
            RouteExposureBreakupRunChunkTiles: 24,
            RouteExposureBreakupScreenLength: [7, 12],
            RouteExposureBreakupScreenThickness: 1,
            MaxRouteExposureBreakupScreens: 14,
            OpenFieldScreenMinOpenFraction: 0.72,
            OpenFieldScreenMinOpenTiles: 96,
            OpenFieldScreenLength: [7, 12],
            OpenFieldScreenThickness: 1,
            MaxOpenFieldScreens: 8,
            MaxOpenAreaFraction: 0.030,
            MinOpenAreaTiles: 96,
            OpenAreaBreakupChunkTiles: 80,
            MaxOpenAreaBreakupScreens: 9,
            OpenAreaBreakupScreenLength: [7, 13],
            OpenAreaBreakupScreenThickness: 1,
            DecorDensity: [0.35, 0.65],
            MicroStampDensity: 0.7,
            EdgeBiomeChance: 0,
            ObjectiveTemplates: ["pvp"],
            LayoutTemplates: {
                classic: 0.40, parallel_lanes: 0.25,
                crossroads: 0.15, valley: 0.10, linear_gauntlet: 0.10
            }
        },

        pvp_balanced_ice: {
            TerrainType: Terrain.Types.Ice,
            AspectRatioPalette: [
                { ratio: 1.0,   weight: 1.0 },
                { ratio: 1.25,  weight: 0.35 },
                { ratio: 0.80,  weight: 0.35 },
                { ratio: 1.5,   weight: 0.10 },
                { ratio: 0.667, weight: 0.10 }
            ],
            MinSide: 48,
            TreeCoverage: [0.42, 0.58],
            MaxTreeCoverage: 0.72,
            CarvedForestCoverage: [0.48, 0.62],
            CarvedForestSectorCoverage: [0.28, 0.42],
            PerimeterCoverChance: [0.48, 0.72],
            MaxWalkablePerimeterRun: [8, 12],
            DeadEndSpursPer2048Tiles: [0.8, 1.8],
            DeadEndSpurLength: [7, 15],
            RouteWanderCost: [0.25, 0.75],
            MainPathWidth: [2, 3],
            SidePathWidth: [1, 1],
            MinimumTacticalLanes: 2,
            PathCoverage: [0.12, 0.20],
            ClearingsPer2048Tiles: [3, 5],
            ClearingRadius: [4, 7],
            RouteClearingRadiusScale: 0.42,
            RouteRestClearingRadiusScale: 0.40,
            AmbushClearingRadiusScale: 0.42,
            FlankClearingRadiusScale: 0.40,
            ContestedClearingRadiusScale: 0.85,
            CrossingsPer2048Tiles: [2, 3],
            TacticalCoverDensity: 0.95,
            PostPlacementCoverDensity: 0.90,
            RouteTacticalCoverSpacing: 11,
            RouteTacticalCoverScreenChance: 0.80,
            RouteEdgeCoverSpacing: 4,
            RouteEdgeCoverChance: 0.68,
            MaxRouteExposureFraction: 0.50,
            MaxRouteExposedRunTiles: 26,
            RouteExposureBreakupMinRunTiles: 15,
            RouteExposureBreakupRunChunkTiles: 22,
            RouteExposureBreakupScreenLength: [7, 12],
            RouteExposureBreakupScreenThickness: 1,
            MaxRouteExposureBreakupScreens: 16,
            OpenFieldScreenMinOpenFraction: 0.62,
            OpenFieldScreenMinOpenTiles: 72,
            OpenFieldScreenLength: [8, 13],
            OpenFieldScreenThickness: 1,
            MaxOpenFieldScreens: 12,
            MaxOpenAreaFraction: 0.030,
            MinOpenAreaTiles: 96,
            OpenAreaBreakupChunkTiles: 70,
            MaxOpenAreaBreakupScreens: 10,
            OpenAreaBreakupScreenLength: [8, 14],
            OpenAreaBreakupScreenThickness: 1,
            LakeChance: 0.65,
            MaxLakeCount: 2,
            LakesPer2048Tiles: [1, 2],
            LakeRadius: [4, 6],
            MaxWaterCoverage: 0.34,
            MinLandBlobCountWarning: 3,
            MaxLandBlobCountWarning: 9,
            LandFraction: 0.70,
            ContinentStyles: [
                { name: "archipelago", weight: 0.45, landFraction: 0.66 },
                { name: "island",      weight: 0.30 },
                { name: "rectangle",   weight: 0.15 },
                { name: "edge",        weight: 0.10 }
            ],
            CliffChance: 0.75,
            PlateauChance: 0.45,
            StructureClustersPer2048Tiles: [0, 0],
            EnemyDensity: [0, 0],
            DecorDensity: [0.35, 0.65],
            MicroStampDensity: 0.7,
            EdgeBiomeChance: 0,
            ObjectiveTemplates: ["pvp"],
            LayoutTemplates: {
                classic: 0.35, parallel_lanes: 0.30,
                crossroads: 0.18, valley: 0.10, linear_gauntlet: 0.07
            }
        },

        pvp_beach_jungle: {
            AspectRatioPalette: [
                { ratio: 1.0,   weight: 1.0 },
                { ratio: 1.25,  weight: 0.35 },
                { ratio: 0.80,  weight: 0.35 },
                { ratio: 1.5,   weight: 0.10 },
                { ratio: 0.667, weight: 0.10 }
            ],
            MinSide: 48,
            TerrainTypeSub: 1,
            AllowJungleBeachTiles: true,
            TreeCoverOnCoast: false,
            TreeCoverage: [0.26, 0.42],
            CarvedForestCoverage: [0.32, 0.48],
            CarvedForestSectorCoverage: [0.16, 0.26],
            PerimeterCoverWidth: [1, 2],
            PerimeterCoverChance: [0.22, 0.42],
            MaxWalkablePerimeterRun: [10, 14],
            DeadEndSpursPer2048Tiles: [0.6, 1.4],
            DeadEndSpurLength: [6, 13],
            RouteWanderCost: [0.15, 0.45],
            MinimumTacticalLanes: 2,
            TacticalCoverDensity: 0.65,
            PostPlacementCoverDensity: 0.42,
            RouteTacticalCoverSpacing: 15,
            RouteTacticalCoverScreenChance: 0.55,
            RouteEdgeCoverSpacing: 7,
            RouteEdgeCoverChance: 0.38,
            RouteExposureBreakupMinRunTiles: 18,
            RouteExposureBreakupRunChunkTiles: 28,
            RouteExposureBreakupScreenLength: [6, 10],
            RouteExposureBreakupScreenThickness: 1,
            MaxRouteExposureBreakupScreens: 8,
            OpenFieldScreenMinOpenFraction: 0.78,
            OpenFieldScreenMinOpenTiles: 128,
            OpenFieldScreenLength: [6, 10],
            OpenFieldScreenThickness: 1,
            MaxOpenFieldScreens: 4,
            MaxOpenAreaFraction: 0.070,
            MinOpenAreaTiles: 160,
            OpenAreaBreakupChunkTiles: 190,
            MaxOpenAreaBreakupScreens: 3,
            OpenAreaBreakupScreenThickness: 1,
            PostMaxOpenAreaFraction: 0.055,
            PostMinOpenAreaTiles: 144,
            PostOpenAreaBreakupChunkTiles: 145,
            PathCoverage: [0.13, 0.21],
            ClearingsPer2048Tiles: [3, 5],
            ClearingRadius: [4, 8],
            LoopChance: 0.40,
            RiverChance: 0.08,
            MaxRiverCount: 1,
            StreamChance: 0.18,
            CrossingsPer2048Tiles: [1, 2],
            PondChance: 0.06,
            MaxPondCount: 1,
            CoastChance: 0.75,
            CoastWaterWidth: [3, 6],
            BeachWidth: [2, 4],
            CoastBayChance: 0.30,
            CoastBayDepth: 12,
            CoastBayWindow: 11,
            MaxWaterCoverage: 0.24,
            LandFraction: 0.72,
            StructureClustersPer2048Tiles: [0, 0],
            DecorDensity: [0.30, 0.55],
            MicroStampDensity: 0.7,
            EdgeBiomeChance: 0,
            ObjectiveTemplates: ["pvp"],
            LayoutTemplates: {
                parallel_lanes: 0.30, crossroads: 0.25,
                classic: 0.20, peninsula: 0.15, valley: 0.10
            },
            PathStyles: {
                smooth_s: 0.40, bezier: 0.30,
                direct: 0.15, meander: 0.10, zigzag: 0.05
            }
        },

        grammar_ice: {
            GeneratorCore: "official_grammar",
            TargetPackProfile: "grammar_ice",
            TerrainVariant: "ice_sub0",
            TerrainType: Terrain.Types.Ice,
            // The random profile still selects a concrete ice layout style
            // (tree blob, edge patrol, cliff terrace, etc.). Replacing that
            // authored terrain afterward with an unrelated shipped-map raster
            // erased the selected contract and recreated near-duplicate maps.
            // Corpus data continues to drive the style tunings and targets;
            // the live procedural author now owns the actual terrain.
            UseOriginalTerrainTemplate: false,
            StructureClustersPer2048Tiles: [2.5, 4.0],
            EnemyDensity: [0.15, 0.30],
            MicroStampDensity: 1.0,
            LakeChance: 0.38,
            MaxLakeCount: 2,
            LakesPer2048Tiles: [1, 2],
            LakeRadius: [4, 6],
            MaxWaterCoverage: 0.24,
            LandFraction: 0.86,
            ContinentStyles: [
                { name: "mainland",    weight: 0.32, landFraction: 1.00 },
                { name: "rectangle",   weight: 0.30, landFraction: 0.90 },
                { name: "edge",        weight: 0.24, landFraction: 0.88 },
                { name: "island",      weight: 0.10, landFraction: 0.84 },
                { name: "archipelago", weight: 0.04, landFraction: 0.76 }
            ],
            CliffChance: 1.0,
            PlateauChance: 0.85,
            DecorDensity: [0.65, 0.95],
            DeadEndSpursPer2048Tiles: [0.3, 1.0],
            LoopChance: 0.12,
            ObjectiveTemplates: ["destroy_base", "kill_enemies"],
            // Ice bunker/hut tree halo was reading "thick green border": the
            // planner's per-structure target dominated by the validator-tied
            // term ceil(cells * minCover * 0.60 / 0.45) on a radius-8 annulus
            // (cells ~= 384 around a 4x4 bunker) drove ~28+ stamps. Lowering
            // MinStructureContextCoverFraction here pulls down BOTH the
            // planner term `cells * minCover` AND the rendered-cover floor
            // (LiveValidation.js:380 reads this same knob via *0.60), so the
            // validator tightens in lockstep — no validator gap, no retry-
            // rate regression. RCA 2026-06-13 (border-shrink follow-up to
            // wave-4). Grammar.js:1277 reapplies a stricter 0.22 for tight
            // ice styles (ice_compound_raid/ice_tree_maze/ice_tree_blob/
            // ice_neck_route/ice_cliff_checkpoint) — that conditional only
            // fires when the value is undefined, so this base setting is
            // honored by the open ice styles (ice_outpost, ice_edge_patrol,
            // ice_skidoo_jump, etc.) where the user-reported wide halo lives.
            MinStructureContextCoverFraction: 0.12,
            // Water is a composition option, not a mandatory map frame.
            // Mainland, one-sided coasts and corner water are all deliberate
            // ice silhouettes now, so do not retry them merely because dry
            // land reaches a map edge.
            MaxLongestLandRunFraction: 1.0,
            MinPerimeterEdgesWithWater: 0,
            MinPerimeterSegments: 0
        }
    };

    // The sub1 bridge channel is a river composition, not a sandy coast.
    profiles.grammar_river_crossing = merge(profiles.grammar_beach, {
        RequireSandyCoastline: false,
        GrammarBeachChannel: true
    });

    profiles.grammar_jungle_maze = merge(profiles.grammar_jungle, {
        UseOriginalTerrainTemplate: false,
        ForcedCampaignBand: "late",
        ForcedObjectiveLabel: "destroy_buildings",
        ForcedMobilityMode: "foot",
        ForcedArchetype: "long_route",
        RouteArchetype: "maze",
        RouteCorridorHalfWidth: 1,
        RouteNarrowHalfWidth: 0,
        RouteCorridorEdgeWidth: 4,
        RoutePocketRadius: 2,
        RouteArchetypeBends: 5,
        RouteArchetypeEdgeCoverChance: 1.00,
        RouteArchetypeEdgeCoverPasses: 2,
        RouteArchetypeOutsideCoverChance: 0.34,
        RouteArchetypeOutsideCoverPasses: 2,
        RouteArchetypeSideCoverChance: 0.82,
        RouteArchetypeSideCoverDistance: 6,
        RouteArchetypeSideCoverThickness: 0,
        RouteArchetypeSideCoverTangentDepth: 1,
        RouteArchetypeOutsideRoutePenalty: 8,
        ForcedRouteLengthTarget: [175, 275],
        ForcedPrimaryGoalCountTarget: [9, 13],
        ForcedPressureGoalCountTarget: [5, 9],
        ForcedSupportGoalCountTarget: [0, 1],
        ForcedPickupDensityScale: 0.65,
        ValidationRetries: 6,
        Width: [62, 82],
        Height: [52, 74],
        AspectRatioPalette: [
            { ratio: 1.0, weight: 0.56 },
            { ratio: 1.25, weight: 0.28 },
            { ratio: 0.80, weight: 0.16 }
        ],
        MinSide: 50,
        MaxSide: 96,
        // mapm19/mapm28/mapm30 topology: reserve the route graph first, then
        // fill the remaining land as one forest wall instead of scattered
        // noise-ranked patches. Existing spur/dead_end paths become real cuts.
        JungleMazeForestFill: true,
        JungleMazeRouteTopology: true,
        JungleMazeGridSpacing: [8, 10],
        JungleMazeGridMargin: [4, 6],
        JungleMazeNodeJitter: [2, 3],
        JungleMazeEdgeBend: [1, 2],
        // Keep most branches one cell wide, with occasional exact two-cell
        // runs like the variable-width passages in mapm19/mapm28/mapm30.
        JungleMazeWideEdgeChance: [0.24, 0.36],
        // Render smoothing opens one tile of canopy on either side, so a
        // one-cell logical cut becomes an authored-looking ~3-cell passage.
        // A radius-1 cut became a five-cell lawn and erased the maze read.
        JungleMazeCorridorRadius: 0,
        JungleMazeStraightBias: [0.42, 0.62],
        // Maze navigation is expressed by the forest walls. Bright path
        // characters make Jungle.FixCharMap demote adjacent tree cells and
        // cascade a one-cell route into a broad lawn, so render it as grass.
        JungleMazePathOvergrowthChance: 0.0,
        JungleMazeDisablePathClearings: true,
        JungleMazeStructureDoorMaxLength: 10,
        // The generic decor pass opens a radius around every enemy, pickup,
        // objective and player. Those discs overlap along a maze route and
        // turn its narrow passages into one continuous lawn. Original jungle
        // mazes place encounters directly in the corridors; live structures
        // still reserve and paint their own required footprint separately.
        EncounterClearingRadius: 0,
        LandFraction: 0.98,
        ContinentStyles: [
            { name: "rectangle", weight: 1.0, landFraction: 0.98 }
        ],
        CoastChance: 0,
        EdgeBiomeChance: 0,
        // Inland water replaces several maze walls at once and sub-0 has no
        // clean tiles for the resulting tiny fragments. The shipped maze
        // references use forest as the topology; keep water at the boundary.
        RiverChance: 0,
        MaxRiverCount: 0,
        RiversPer2048Tiles: 0,
        StreamChance: 0,
        MaxStreamCount: 0,
        StreamsPer2048Tiles: 0,
        PondChance: 0,
        MaxPondCount: 0,
        PondsPer2048Tiles: [0, 0],
        LakeChance: 0,
        MaxLakeCount: 0,
        LakesPer2048Tiles: [0, 0],
        TreeCoverage: [0.58, 0.70],
        MinTreeCoverage: 0.48,
        MaxTreeCoverage: 0.82,
        ForestSeedDensity: 0.0072,
        ForestPatchMinSize: 12,
        ForestPatchMaxSize: 110,
        CarvedForestCoverage: [0.64, 0.74],
        CarvedForestSectorCoverage: [0.48, 0.62],
        PerimeterCoverChance: [0.78, 0.94],
        MaxWalkablePerimeterRun: [5, 8],
        MainPathWidth: [1, 2],
        SidePathWidth: [1, 1],
        RouteBorderInset: 5,
        RouteBorderHardInset: 2,
        RouteBorderPenalty: 42,
        PostPlacementRouteCarving: true,
        // Structures need explicit access routes. Pickups and enemies are
        // already placed beside the authored route; routing each one back to
        // the spawn turns their helper paths into a giant protected lawn.
        PlacementRouteGroups: { objectives: false, structures: true, pickups: false, enemies: false },
        MaxPlacementEnemyRoutes: 4,
        // The spanning-tree maze already supplies genuine dead ends. Generic
        // radial spurs would either fail against its hard walls or punch
        // decorative shortcuts through the topology.
        DeadEndSpurs: false,
        DeadEndSpursPer2048Tiles: [0.0, 0.0],
        DeadEndSpurLength: [12, 24],
        CampaignSpurCount: 4,
        RouteWanderCost: [0.35, 0.95],
        RouteWanderScale: [5, 10],
        LoopChance: 0.18,
        LayoutTemplates: { linear_gauntlet: 0.48, valley: 0.24, hub_and_spoke: 0.18, corner_to_corner: 0.10 },
        PathStyles: { meander: 0.36, smooth_s: 0.26, zigzag: 0.18, bezier: 0.14, staircase: 0.06 },
        ClearingCountPer2048Tiles: [2.8, 4.0],
        WildernessClearingsPer2048Tiles: [0.0, 0.4],
        ClearingsPer2048Tiles: [1.4, 2.2],
        ClearingRadius: [2, 3],
        TeamClearingRadiusScale: 1.0,
        ObjectiveClearingRadiusScale: 1.0,
        SupportClearingRadiusScale: 1.0,
        StructureClustersPer2048Tiles: [0.45, 0.85],
        StructureMinSpacing: 16,
        LiveStructureMinSpacing: 18,
        StructureBuildingsPerClearing: 1,
        StructureMaxClearings: 3,
        StructureWaterClearance: 3,
        StructureContextRadius: 8,
        MinStructureContextCoverFraction: 0.18,
        LiveStructureMapMargin: 8,
        RouteStructurePhaseBands: [[0.36, 0.48], [0.68, 0.84]],
        RoutePickupPhaseBands: [[0.18, 0.30], [0.44, 0.56], [0.66, 0.80], [0.82, 0.92]],
        RouteStructureTemplateWeights: { bunker: 0.28, hut_cluster: 0.38, supply_hut: 0.34 },
        RoutePickupTemplates: ["grenades", "ammo", "rockets", "ammo"],
        RouteStructureSideDistance: [7, 12],
        RoutePickupSideDistance: [0, 3],
        MaxRouteSideSiteDistance: 14,
        MinRouteStructureAnchorDistance: 10,
        MinRouteStructureSiteDistance: 12,
        MinRoutePickupAnchorDistance: 4,
        MinRoutePickupSiteDistance: 4,
        RouteStructureAlternateSides: true,
        RouteStructureCoverTarget: 20,
        LiveStructureCoverTarget: 24,
        RoutePickupCoverTarget: 6,
        RoutePickupMaxCover: 22,
        TacticalCoverDensity: 1.35,
        PostPlacementCoverDensity: 1.10,
        RouteTacticalCoverSpacing: 7,
        RouteTacticalCoverScreenChance: 0.98,
        RouteEdgeCoverChance: 0.88,
        RouteEdgeCoverSpacing: 3,
        RouteEdgeCoverLength: [9, 16],
        RouteExposureMinCover: 10,
        MaxRouteExposureFraction: 0.42,
        MaxRouteExposedRunTiles: 20,
        RouteExposureBreakupMinRunTiles: 10,
        RouteExposureBreakupRunChunkTiles: 16,
        OpenAreaBreakupChunkTiles: 34,
        MaxOpenAreaBreakupIslands: 46,
        MaxOpenAreaBreakupScreens: 22,
        PostOpenAreaBreakupChunkTiles: 26,
        PostMaxOpenAreaBreakupIslands: 40,
        PostMaxOpenAreaBreakupScreens: 20,
        MinimumChokepoints: 2,
        MinRouteNarrowFractionAtMost3: 0.05,
        MaxRouteMedianWidth: 14,
        MinRouteNarrowRunAtMost3: 3,
        RouteWidthHardFail: false,
        MinFinalRouteNarrowFractionAtMost3: 0.05,
        MaxFinalRouteMedianWidth: 14,
        MinFinalRouteNarrowRunAtMost3: 3,
        FinalRouteWidthHardFail: false,
        RouteEnemyBaseCount: 9,
        RouteEnemyMinCount: 4,
        RouteEnemyDensityScale: 1.15,
        RouteEnemyFractions: [0.24, 0.42, 0.60, 0.78, 0.90],
        RouteEnemyPhaseBands: [[0.18, 0.30], [0.36, 0.50], [0.54, 0.68], [0.72, 0.86], [0.84, 0.94]],
        EssentialRouteFractions: [0.28, 0.62, 0.84],
        RouteEnemyMinOffsetTiles: 0,
        RouteEnemyOffsetTiles: 1,
        SideRouteEnemyOffsetTiles: 1,
        SideRouteEnemyScale: 0.45,
        EnemyDensity: [0.18, 0.32],
        CliffChance: 0.30,
        PlateauChance: 0.18,
        MaxWaterCoverage: 0.12,
        MaxQuietScreenFraction: 0.14,
        MaxRouteQuietScreenFraction: 0.07,
        QuietScreenCoverFloor: 0.10,
        QuietScreenInterestFloor: 0.12
    });

    profiles.grammar_jungle_neck = merge(profiles.grammar_jungle, {
        UseOriginalTerrainTemplate: false,
        ForcedCampaignBand: "mid",
        ForcedObjectiveLabel: "destroy_buildings",
        ForcedMobilityMode: "foot",
        ForcedArchetype: "long_route",
        RouteArchetype: "neck",
        RouteCorridorHalfWidth: 1,
        RouteNarrowHalfWidth: 0,
        RouteNarrowBands: [[0.28, 0.42], [0.52, 0.70], [0.76, 0.90]],
        RouteCorridorEdgeWidth: 5,
        RoutePocketRadius: 2,
        RouteArchetypeBends: 3,
        RouteArchetypeEdgeCoverChance: 1.00,
        RouteArchetypeEdgeCoverPasses: 2,
        RouteArchetypeOutsideCoverChance: 0.88,
        RouteArchetypeOutsideCoverPasses: 4,
        RouteArchetypeSideCoverChance: 0.98,
        RouteArchetypeSideCoverDistance: 5,
        RouteArchetypeSideCoverThickness: 1,
        RouteArchetypeSideCoverTangentDepth: 1,
        RouteArchetypeSideCoverSpacing: 1,
        RouteArchetypeGateHalfLength: 10,
        RouteArchetypeGateSpacing: 3,
        RouteArchetypeActualGateRepairChance: 1.00,
        RouteArchetypeActualGateRepairSpacing: 5,
        RouteArchetypeActualGateRepairHalfLength: 14,
        RouteArchetypeActualGateRepairThickness: 3,
        RouteArchetypeActualGateRepairGap: 0,
        RouteArchetypeActualGateRepairEndpointTrim: 0.14,
        RouteArchetypeActualGateRepairMaxGates: 14,
        RouteArchetypeActualSideRepairChance: 1.00,
        RouteArchetypeActualSideRepairDistance: 5,
        RouteArchetypeActualSideRepairThickness: 1,
        RouteArchetypeActualSideRepairTangentDepth: 1,
        RouteArchetypeActualSideRepairSpacing: 1,
        RouteArchetypeOutsideRoutePenalty: 9,
        ForcedRouteLengthTarget: [145, 235],
        ForcedPrimaryGoalCountTarget: [8, 12],
        ForcedPressureGoalCountTarget: [8, 13],
        ForcedSupportGoalCountTarget: [1, 2],
        ValidationRetries: 6,
        Width: [58, 78],
        Height: [46, 66],
        AspectRatioPalette: [
            { ratio: 1.35, weight: 0.44 },
            { ratio: 1.0, weight: 0.30 },
            { ratio: 1.6, weight: 0.16 },
            { ratio: 0.75, weight: 0.10 }
        ],
        MinSide: 46,
        MaxSide: 96,
        // A neck is authored by forest walls around the route. Incidental
        // coast/lake/river rolls made the silhouette read as generic open
        // terrain, especially on large canvases, so keep this composition dry.
        LandFraction: 1.0,
        ContinentStyles: [
            { name: "mainland", weight: 1.0, landFraction: 1.0 }
        ],
        CoastChance: 0,
        RiverChance: 0,
        MaxRiverCount: 0,
        StreamChance: 0,
        MaxStreamCount: 0,
        PondChance: 0,
        MaxPondCount: 0,
        LakeChance: 0,
        MaxLakeCount: 0,
        TreeCoverage: [0.52, 0.66],
        MinTreeCoverage: 0.36,
        MaxTreeCoverage: 0.78,
        MinRenderedTreeTileCoverage: 0.22,
        ForestSeedDensity: 0.0070,
        ForestPatchMinSize: 10,
        ForestPatchMaxSize: 96,
        CarvedForestCoverage: [0.58, 0.70],
        CarvedForestSectorCoverage: [0.44, 0.58],
        PerimeterCoverChance: [0.78, 0.94],
        MaxWalkablePerimeterRun: [5, 9],
        MainPathWidth: [1, 1],
        SidePathWidth: [1, 1],
        RouteBorderInset: 5,
        RouteBorderHardInset: 2,
        RouteBorderPenalty: 44,
        PostPlacementRouteCarving: true,
        PlacementRouteGroups: { objectives: false, structures: true, pickups: true, enemies: true },
        MaxPlacementEnemyRoutes: 4,
        DeadEndSpursPer2048Tiles: [1.0, 2.0],
        DeadEndSpurLength: [8, 18],
        CampaignSpurCount: 3,
        RouteWanderCost: [0.24, 0.75],
        RouteWanderScale: [6, 11],
        LoopChance: 0.08,
        LayoutTemplates: { valley: 0.46, linear_gauntlet: 0.34, peninsula: 0.12, corner_to_corner: 0.08 },
        PathStyles: { smooth_s: 0.34, bezier: 0.26, meander: 0.20, zigzag: 0.12, direct: 0.08 },
        ClearingCountPer2048Tiles: [2.0, 3.0],
        WildernessClearingsPer2048Tiles: [0.2, 0.8],
        ClearingsPer2048Tiles: [2.0, 3.0],
        ClearingRadius: [3, 5],
        ObjectiveClearingRadiusScale: 0.85,
        RouteClearingRadiusScale: 0.35,
        RouteRestClearingRadiusScale: 0.34,
        AmbushClearingRadiusScale: 0.36,
        FlankClearingRadiusScale: 0.34,
        StructureClustersPer2048Tiles: [0.70, 1.10],
        StructureMinSpacing: 18,
        LiveStructureMinSpacing: 18,
        StructureBuildingsPerClearing: 1,
        StructureMaxClearings: 3,
        StructureWaterClearance: 3,
        StructureContextRadius: 8,
        MinStructureContextCoverFraction: 0.20,
        MinRenderedStructureContextCoverFraction: 0.08,
        LiveStructureMapMargin: 8,
        RouteStructurePhaseBands: [[0.44, 0.58], [0.72, 0.88]],
        RoutePickupPhaseBands: [[0.24, 0.36], [0.54, 0.68], [0.76, 0.90]],
        RouteStructureTemplateWeights: { bunker: 0.34, hut_cluster: 0.30, supply_hut: 0.36 },
        RoutePickupTemplates: ["grenades", "ammo", "rockets"],
        RouteStructureSideDistance: [9, 14],
        RoutePickupSideDistance: [0, 3],
        MaxRouteSideSiteDistance: 16,
        MinRouteStructureAnchorDistance: 10,
        MinRouteStructureSiteDistance: 13,
        MinRoutePickupAnchorDistance: 4,
        MinRoutePickupSiteDistance: 4,
        RouteStructureAlternateSides: true,
        RouteStructureCoverTarget: 22,
        LiveStructureCoverTarget: 26,
        RoutePickupCoverTarget: 7,
        RoutePickupMaxCover: 24,
        TacticalCoverDensity: 1.40,
        PostPlacementCoverDensity: 1.25,
        RouteTacticalCoverSpacing: 7,
        RouteTacticalCoverScreenChance: 0.98,
        RouteEdgeCoverChance: 0.94,
        RouteEdgeCoverSpacing: 3,
        RouteEdgeCoverLength: [8, 15],
        RouteExposureMinCover: 10,
        MaxRouteExposureFraction: 0.44,
        MaxRouteExposedRunTiles: 22,
        RouteExposureBreakupMinRunTiles: 9,
        RouteExposureBreakupRunChunkTiles: 14,
        OpenAreaBreakupChunkTiles: 38,
        MaxOpenAreaBreakupIslands: 40,
        MaxOpenAreaBreakupScreens: 18,
        PostOpenAreaBreakupChunkTiles: 28,
        PostMaxOpenAreaBreakupIslands: 34,
        PostMaxOpenAreaBreakupScreens: 16,
        MinimumChokepoints: 3,
        MinRouteNarrowFractionAtMost3: 0.05,
        MaxRouteMedianWidth: 14,
        MinRouteNarrowRunAtMost3: 2,
        RouteWidthHardFail: true,
        // Jungle tree edge smoothing widens a semantic one-cell gate into a
        // visible throat about 5-7 tiles across. Keep the strict semantic
        // <=3 contract above and validate the rendered vocabulary at its real
        // scale instead of requiring a tile shape it cannot preserve.
        MinFinalRouteNarrowFractionAtMost3: 0,
        MaxFinalRouteMedianWidth: 14,
        MinFinalRouteNarrowRunAtMost3: 0,
        MinFinalRouteNarrowFractionAtMost7: 0.06,
        MinFinalRouteNarrowRunAtMost7: 2,
        FinalRouteWidthHardFail: true,
        RouteEnemyBaseCount: 11,
        RouteEnemyMinCount: 5,
        RouteEnemyDensityScale: 1.30,
        RouteEnemyFractions: [0.22, 0.38, 0.54, 0.70, 0.86],
        RouteEnemyPhaseBands: [[0.18, 0.30], [0.34, 0.48], [0.50, 0.64], [0.66, 0.80], [0.80, 0.92]],
        EssentialRouteFractions: [0.30, 0.58, 0.82],
        RouteEnemyMinOffsetTiles: 0,
        RouteEnemyOffsetTiles: 1,
        SideRouteEnemyOffsetTiles: 1,
        SideRouteEnemyScale: 0.55,
        EnemyDensity: [0.22, 0.38],
        CliffChance: 0.35,
        PlateauChance: 0.25,
        EdgeBiomeChance: 0.28,
        EdgeBiomeKinds: { swamp: 0.45, ridge: 0.55 },
        DefensiveLineChance: 0.24,
        MaxWaterCoverage: 0.02,
        MaxQuietScreenFraction: 0.15,
        MaxRouteQuietScreenFraction: 0.08,
        QuietScreenCoverFloor: 0.10,
        QuietScreenInterestFloor: 0.12
    });

    // Dense forest walls around a broad, readable through-route. This is
    // deliberately not another maze or neck: the route meanders and branches,
    // but it has no repeated hard gates and retains occasional open ambush
    // pockets. It expands the jungle palette without involving beach tiles.
    profiles.grammar_jungle_forest_corridor = merge(profiles.grammar_jungle, {
        UseOriginalTerrainTemplate: false,
        ForcedCampaignBand: "mid",
        ForcedObjectiveLabel: "destroy_buildings",
        ForcedMobilityMode: "foot",
        ForcedArchetype: "long_route",
        RouteArchetype: "broken_trail",
        ForcedRouteLengthTarget: [150, 235],
        ForcedPrimaryGoalCountTarget: [8, 12],
        ForcedPressureGoalCountTarget: [6, 10],
        ForcedSupportGoalCountTarget: [1, 2],
        ValidationRetries: 6,
        Width: [62, 84],
        Height: [46, 66],
        AspectRatioPalette: [
            { ratio: 1.35, weight: 0.42 },
            { ratio: 1.0, weight: 0.30 },
            { ratio: 1.6, weight: 0.18 },
            { ratio: 0.75, weight: 0.10 }
        ],
        MinSide: 46,
        MaxSide: 96,
        LandFraction: 0.98,
        ContinentStyles: [
            { name: "mainland", weight: 1.0, landFraction: 1.0 }
        ],
        CoastChance: 0,
        RiverChance: 0,
        MaxRiverCount: 0,
        RiversPer2048Tiles: 0,
        StreamChance: 0,
        MaxStreamCount: 0,
        StreamsPer2048Tiles: 0,
        PondChance: 0,
        MaxPondCount: 0,
        PondsPer2048Tiles: [0, 0],
        LakeChance: 0,
        MaxLakeCount: 0,
        LakesPer2048Tiles: [0, 0],
        TreeCoverage: [0.56, 0.68],
        MinTreeCoverage: 0.46,
        MaxTreeCoverage: 0.78,
        MinRenderedTreeTileCoverage: 0.20,
        ForestSeedDensity: 0.0070,
        ForestPatchAlpha: 1.28,
        ForestPatchMinSize: 24,
        ForestPatchMaxSize: 150,
        CarvedForestCoverage: [0.60, 0.72],
        CarvedForestSectorCoverage: [0.44, 0.58],
        PerimeterCoverChance: [0.76, 0.92],
        MaxWalkablePerimeterRun: [6, 10],
        MainPathWidth: [2, 2],
        SidePathWidth: [1, 1],
        RouteCorridorHalfWidth: 1,
        RoutePocketRadius: 2,
        RouteArchetypeBends: 4,
        RouteArchetypeEdgeCoverChance: 0.92,
        RouteArchetypeOutsideCoverChance: 0.34,
        RouteArchetypeOutsideCoverPasses: 3,
        RouteArchetypeSideCoverChance: 0.78,
        RouteArchetypeSideCoverDistance: 6,
        RouteArchetypeSideCoverThickness: 1,
        DeadEndSpurs: true,
        DeadEndSpursPer2048Tiles: [1.2, 2.2],
        DeadEndSpurLength: [8, 18],
        LoopChance: 0.16,
        CompositionVariants: [
            {
                name: "serpentine_run",
                weight: 0.28,
                overrides: {
                    LayoutTemplates: { linear_gauntlet: 0.55, corner_to_corner: 0.45 },
                    TreeCoverage: [0.60, 0.70],
                    DeadEndSpursPer2048Tiles: [1.0, 1.8]
                }
            },
            {
                name: "branching_trails",
                weight: 0.27,
                overrides: {
                    LayoutTemplates: { hub_and_spoke: 0.68, crossroads: 0.32 },
                    TreeCoverage: [0.52, 0.64],
                    DeadEndSpursPer2048Tiles: [2.0, 3.0],
                    LoopChance: 0.22
                }
            },
            {
                name: "diagonal_cut",
                weight: 0.25,
                overrides: {
                    LayoutTemplates: { corner_to_corner: 0.74, valley: 0.26 },
                    TreeCoverage: [0.56, 0.67],
                    DeadEndSpursPer2048Tiles: [1.4, 2.4]
                }
            },
            {
                name: "valley_forks",
                weight: 0.20,
                overrides: {
                    LayoutTemplates: { valley: 0.70, hub_and_spoke: 0.30 },
                    TreeCoverage: [0.50, 0.62],
                    DeadEndSpursPer2048Tiles: [1.8, 2.8],
                    LoopChance: 0.12
                }
            }
        ],
        PathStyles: {
            meander: 0.34,
            smooth_s: 0.30,
            bezier: 0.22,
            zigzag: 0.10,
            direct: 0.04
        },
        // Keep clearings small, but retain them: removing route clearings
        // entirely stranded valid structure/guard sites behind the dense
        // forest on seed 2103.
        JungleMazeDisablePathClearings: false,
        EncounterClearingRadius: 1,
        ClearingCountPer2048Tiles: [1.4, 2.0],
        WildernessClearingsPer2048Tiles: [0.2, 0.6],
        ClearingsPer2048Tiles: [1.4, 2.0],
        ClearingRadius: [2, 4],
        RouteClearingRadiusScale: 0.42,
        RouteRestClearingRadiusScale: 0.38,
        AmbushClearingRadiusScale: 0.46,
        StructureMinSpacing: 18,
        LiveStructureMinSpacing: 20,
        GrammarStructureTargetMax: 4,
        StructureBuildingsPerClearing: 1,
        StructureMaxClearings: 4,
        PostPlacementRouteCarving: true,
        PlacementRouteGroups: {
            objectives: false,
            structures: true,
            pickups: true,
            enemies: true
        },
        MaxPlacementEnemyRoutes: 4,
        TacticalCoverDensity: 1.42,
        PostPlacementCoverDensity: 1.18,
        RouteTacticalCoverSpacing: 7,
        RouteTacticalCoverScreenChance: 0.96,
        RouteEdgeCoverSpacing: 3,
        RouteEdgeCoverChance: 0.90,
        RouteEdgeCoverLength: [8, 15],
        CliffChance: 0,
        PlateauChance: 0,
        EdgeBiomeChance: 0.12,
        EdgeBiomeKinds: { ridge: 1.0 },
        MaxWaterCoverage: 0.06
    });

    // A route-crossing river composition rather than incidental ponds or a
    // water frame. The single full river is forced to bisect the campaign
    // route and receives one or two authored crossings; moderate forest mass
    // leaves the river silhouette visible across the whole map.
    profiles.grammar_jungle_river_crossing = merge(profiles.grammar_jungle, {
        UseOriginalTerrainTemplate: false,
        ForcedCampaignBand: "mid",
        ForcedObjectiveLabel: "destroy_buildings",
        ForcedMobilityMode: "foot",
        ForcedArchetype: "long_route",
        RouteArchetype: "broken_trail",
        ForcedRouteLengthTarget: [130, 215],
        ForcedPrimaryGoalCountTarget: [7, 11],
        ForcedPressureGoalCountTarget: [6, 10],
        ForcedSupportGoalCountTarget: [1, 2],
        ValidationRetries: 6,
        Width: [60, 82],
        Height: [46, 66],
        AspectRatioPalette: [
            { ratio: 1.35, weight: 0.36 },
            { ratio: 1.0, weight: 0.30 },
            { ratio: 1.6, weight: 0.18 },
            { ratio: 0.75, weight: 0.16 }
        ],
        MinSide: 46,
        MaxSide: 96,
        LandFraction: 0.96,
        ContinentStyles: [
            { name: "mainland", weight: 1.0, landFraction: 1.0 }
        ],
        CoastChance: 0,
        RiverChance: 1.0,
        MaxRiverCount: 1,
        MinRiverCount: 1,
        RiversPer2048Tiles: 0.22,
        RiverBisectChance: 1.0,
        // jun_sub0 only has a reliable vertical bridge composition. Keep the
        // river running left-to-right and vary the route topology around it;
        // a top-to-bottom river requires a horizontal bridge and otherwise
        // materialises as an obvious grass plug.
        RiverAxis: "horizontal",
        // The campaign route must cross the river rather than run along it;
        // otherwise ProtectReservedRoute legally erases most of the water.
        LinearGauntletAxis: "vertical",
        RiverBranchChance: 0,
        MaxBranchDepth: 0,
        RiverWidth: [3, 3],
        RiverMeander: [0.28, 0.52],
        RiverUseHeightmapFlow: false,
        RiverSpineMargin: 5,
        RiverCrossingPreferRoute: true,
        CrossingsPer2048Tiles: [0.45, 0.75],
        BridgeMinRiverWidth: 3,
        StreamChance: 0,
        MaxStreamCount: 0,
        StreamsPer2048Tiles: 0,
        PondChance: 0,
        MaxPondCount: 0,
        PondsPer2048Tiles: [0, 0],
        LakeChance: 0,
        MaxLakeCount: 0,
        LakesPer2048Tiles: [0, 0],
        TreeCoverage: [0.30, 0.46],
        MinTreeCoverage: 0.22,
        MaxTreeCoverage: 0.58,
        ForestSeedDensity: 0.0058,
        ForestPatchAlpha: 1.42,
        ForestPatchMinSize: 12,
        ForestPatchMaxSize: 88,
        CarvedForestCoverage: [0.34, 0.50],
        CarvedForestSectorCoverage: [0.18, 0.30],
        PerimeterCoverChance: [0.34, 0.56],
        MaxWalkablePerimeterRun: [10, 16],
        MainPathWidth: [2, 3],
        SidePathWidth: [1, 2],
        DeadEndSpurs: true,
        DeadEndSpursPer2048Tiles: [0.8, 1.6],
        DeadEndSpurLength: [7, 15],
        LoopChance: 0.10,
        CompositionVariants: [
            {
                name: "north_south_crossing",
                weight: 0.25,
                overrides: {
                    LayoutTemplates: { linear_gauntlet: 1.0 },
                    LinearGauntletAxis: "vertical",
                    RiverSpineMargin: 5
                }
            },
            {
                name: "slalom_crossing",
                weight: 0.25,
                overrides: {
                    LayoutTemplates: { linear_gauntlet: 1.0 },
                    LinearGauntletAxis: "vertical",
                    LinearGauntletLateralDrift: [0.10, 0.16],
                    RiverSpineMargin: 4,
                    CrossingsPer2048Tiles: [0.55, 0.85]
                }
            },
            {
                name: "diagonal_crossing",
                weight: 0.27,
                overrides: {
                    LayoutTemplates: { corner_to_corner: 0.72, valley: 0.28 },
                    RiverSpineMargin: 5,
                    CrossingsPer2048Tiles: [0.45, 0.75]
                }
            },
            {
                name: "branching_crossing",
                weight: 0.23,
                overrides: {
                    LayoutTemplates: { hub_and_spoke: 0.64, crossroads: 0.36 },
                    RiverSpineMargin: 5,
                    CrossingsPer2048Tiles: [0.55, 0.75],
                    DeadEndSpursPer2048Tiles: [1.4, 2.2]
                }
            }
        ],
        PathStyles: {
            smooth_s: 0.32,
            bezier: 0.28,
            meander: 0.24,
            zigzag: 0.12,
            direct: 0.04
        },
        StructureMinSpacing: 17,
        LiveStructureMinSpacing: 18,
        GrammarStructureTargetMax: 2,
        StructureBuildingsPerClearing: 1,
        StructureMaxClearings: 4,
        StructureWaterClearance: 4,
        TacticalCoverDensity: 0.92,
        PostPlacementCoverDensity: 0.84,
        RouteTacticalCoverSpacing: 9,
        RouteTacticalCoverScreenChance: 0.84,
        RouteEdgeCoverSpacing: 4,
        RouteEdgeCoverChance: 0.70,
        RouteEdgeCoverLength: [6, 12],
        CliffChance: 0,
        PlateauChance: 0,
        EdgeBiomeChance: 0,
        MaxWaterCoverage: 0.24
    });

    profiles.grammar_ice_maze = merge(profiles.grammar_ice, {
        UseOriginalTerrainTemplate: false,
        ForcedCampaignBand: "late",
        ForcedObjectiveLabel: "destroy_buildings",
        ForcedMobilityMode: "foot",
        ForcedArchetype: "long_route",
        ForcedIceLayoutStyle: "ice_tree_maze",
        RequireRenderedHardValidation: true,
        MinIntentOpenFraction: 0.10,
        RouteArchetype: "maze",
        RouteCorridorHalfWidth: 1,
        RouteNarrowHalfWidth: 0,
        RouteCorridorEdgeWidth: 3,
        RoutePocketRadius: 2,
        RouteArchetypeBends: 5,
        RouteArchetypeEdgeCoverChance: 0.90,
        RouteArchetypeOutsideCoverChance: 0.18,
        RouteArchetypeOutsideCoverPasses: 2,
        RouteArchetypeSideCoverChance: 0.68,
        RouteArchetypeSideCoverDistance: 5,
        RouteArchetypeSideCoverThickness: 0,
        RouteArchetypeSideCoverTangentDepth: 1,
        RouteArchetypeOutsideRoutePenalty: 7,
        ForcedRouteLengthTarget: [170, 260],
        ForcedPrimaryGoalCountTarget: [9, 12],
        ForcedPressureGoalCountTarget: [4, 7],
        ForcedSupportGoalCountTarget: [0, 1],
        ForcedPickupDensityScale: 0.55,
        ValidationRetries: 6,
        MaxRepairPasses: 4,
        Width: [60, 78],
        Height: [52, 70],
        AspectRatioPalette: [
            { ratio: 1.0, weight: 0.60 },
            { ratio: 1.25, weight: 0.25 },
            { ratio: 0.80, weight: 0.15 }
        ],
        MinSide: 48,
        MaxSide: 96,
        MainPathWidth: [1, 2],
        SidePathWidth: [1, 1],
        PostPlacementRouteCarving: true,
        PlacementRouteGroups: { objectives: false, structures: true, pickups: true, enemies: true },
        MaxPlacementEnemyRoutes: 4,
        RouteStructureSideDistance: [6, 10],
        RoutePickupSideDistance: [0, 2],
        MaxRouteSideSiteDistance: 12,
        MinRoutePickupAnchorDistance: 4,
        MinRoutePickupSiteDistance: 4,
        RoutePickupCoverTarget: 2,
        RoutePickupMaxCover: 14,
        LiveStructureMapMargin: 8,
        RouteEnemyMinOffsetTiles: 0,
        RouteEnemyOffsetTiles: 1,
        SideRouteEnemyOffsetTiles: 1,
        DeadEndSpursPer2048Tiles: [1.8, 3.2],
        DeadEndSpurLength: [10, 22],
        RouteWanderCost: [0.35, 1.00],
        RouteWanderScale: [5, 10],
        LoopChance: 0.18,
        IceMazeExactForestFill: true,
        JungleMazeForestFill: true,
        JungleMazeGridSpacing: [8, 10],
        JungleMazeGridMargin: [4, 6],
        JungleMazeCorridorRadius: 0,
        LandFraction: 1.0,
        ContinentStyles: [
            { name: "mainland", weight: 1.0, landFraction: 1.0 }
        ],
        CoastChance: 0,
        EdgeBiomeChance: 0,
        LakeChance: 0,
        MaxLakeCount: 0,
        RiverChance: 0,
        MaxRiverCount: 0,
        StreamChance: 0,
        MaxStreamCount: 0,
        PondChance: 0,
        MaxPondCount: 0,
        IceLayoutRuntimeOverrides: {
            IceMazeExactForestFill: true,
            JungleMazeForestFill: true,
            TreeCoverage: 0.72,
            MinTreeCoverage: 0.48,
            MaxTreeCoverage: 0.86,
            MinRenderedTreeTileCoverage: 0.28,
            ForestSeedDensity: 0.0042,
            ForestPatchMinSize: 30,
            ForestPatchMaxSize: 140,
            CarvedForestCoverage: [0.64, 0.76],
            CarvedForestSectorCoverage: [0.50, 0.64],
            LandFraction: 1.0,
            ContinentStyles: [
                { name: "mainland", weight: 1.0, landFraction: 1.0 }
            ],
            CoastChance: 0,
            EdgeBiomeChance: 0,
            LakeChance: 0,
            MaxLakeCount: 0,
            RiverChance: 0,
            MaxRiverCount: 0,
            StreamChance: 0,
            MaxStreamCount: 0,
            PondChance: 0,
            MaxPondCount: 0,
            OpenAreaBreakupChunkTiles: 48,
            MaxOpenAreaBreakupIslands: 16,
            MaxOpenAreaBreakupScreens: 14,
            OpenAreaBreakupPasses: 3,
            PostOpenAreaBreakupChunkTiles: 36,
            PostMaxOpenAreaBreakupIslands: 14,
            PostMaxOpenAreaBreakupScreens: 13,
            PostOpenAreaBreakupPasses: 3,
            RouteEdgeCoverChance: 0.78,
            FinalRouteEdgeCoverChance: 0.94,
            RouteTacticalCoverScreenChance: 0.90,
            TacticalCoverDensity: 0.98,
            PostPlacementCoverDensity: 1.05,
            CampaignSpurCount: 3,
            RouteStructureSideDistance: [6, 10],
            RoutePickupSideDistance: [0, 2],
            MaxRouteSideSiteDistance: 12,
            MinRoutePickupAnchorDistance: 4,
            MinRoutePickupSiteDistance: 4,
            RoutePickupCoverTarget: 2,
            RoutePickupMaxCover: 14,
            LiveStructureMapMargin: 8,
            LayoutTemplates: { linear_gauntlet: 0.46, valley: 0.24, hub_and_spoke: 0.18, corner_to_corner: 0.12 },
            ClearingCountPer2048Tiles: [3.6, 5.2],
            WildernessClearingsPer2048Tiles: [1.8, 2.8],
            RoutePickupPhaseBands: [[0.24, 0.36], [0.58, 0.74]],
            MinimumChokepoints: 2,
            MinRouteNarrowFractionAtMost3: 0.05,
            MaxRouteMedianWidth: 16,
            MinRouteNarrowRunAtMost3: 3,
            RouteWidthHardFail: false,
            MinFinalRouteNarrowFractionAtMost3: 0.04,
            MaxFinalRouteMedianWidth: 16,
            MinFinalRouteNarrowRunAtMost3: 3,
            FinalRouteWidthHardFail: false,
            RouteEnemyBaseCount: 8,
            RouteEnemyMinCount: 4,
            RouteEnemyDensityScale: 1.1,
            SideRouteEnemyScale: 0.30,
            StructureClusters: 1
        }
    });

    profiles.grammar_ice_maze_xl = merge(profiles.grammar_ice_maze, {
        ForcedRouteLengthTarget: [300, 460],
        ForcedPrimaryGoalCountTarget: [14, 20],
        ForcedPressureGoalCountTarget: [8, 14],
        ForcedSupportGoalCountTarget: [1, 3],
        RouteArchetypeBends: 8,
        RouteArchetypeOutsideRoutePenalty: 9,
        ValidationRetries: 4,
        Width: 128,
        Height: 96,
        MaxSide: 160,
        AspectRatioPalette: [],
        DeadEndSpursPer2048Tiles: [2.4, 4.0],
        DeadEndSpurLength: [14, 30],
        RouteEnemyBaseCount: 12,
        RouteEnemyMinCount: 6,
        RouteEnemyFractions: [0.18, 0.30, 0.42, 0.54, 0.66, 0.78, 0.88, 0.95],
        RoutePickupPhaseBands: [[0.14, 0.24], [0.34, 0.46], [0.56, 0.68], [0.76, 0.90]],
        IceLayoutRuntimeOverrides: merge(profiles.grammar_ice_maze.IceLayoutRuntimeOverrides, {
            TreeCoverage: 0.34,
            MaxTreeCoverage: 0.66,
            MinStructureContextCoverFraction: 0,
            MinRenderedStructureContextCoverFraction: 0,
            RouteStructureCoverTarget: 0,
            LiveStructureCoverTarget: 0,
            LiveStructureCoverMaxStamp: 0,
            LiveStructureCoverMinStamp: 0,
            CampaignSpurCount: 5,
            StructureClusters: 2,
            StructureMaxClearings: 4,
            // The exact maze fill already supplies continuous forest walls.
            // Generic route-edge cover adds one-cell shelves afterward, which
            // render as truncated canopy strips on the large maze canvas.
            RouteEdgeCoverChance: 0,
            FinalRouteEdgeCoverChance: 0,
            RoutePickupPhaseBands: [[0.14, 0.24], [0.34, 0.46], [0.56, 0.68], [0.76, 0.90]],
            RouteEnemyBaseCount: 12,
            RouteEnemyMinCount: 6,
            OpenAreaBreakupChunkTiles: 64,
            MaxOpenAreaBreakupIslands: 24,
            MaxOpenAreaBreakupScreens: 22,
            PostOpenAreaBreakupChunkTiles: 48,
            PostMaxOpenAreaBreakupIslands: 20,
            PostMaxOpenAreaBreakupScreens: 18
        })
    });

    profiles.grammar_ice_neck = merge(profiles.grammar_ice, {
        UseOriginalTerrainTemplate: false,
        ForcedCampaignBand: "mid",
        ForcedObjectiveLabel: "destroy_buildings",
        ForcedArchetype: "long_route",
        ForcedIceLayoutStyle: "ice_neck_route",
        RequireRenderedHardValidation: true,
        RouteArchetype: "neck",
        RouteCorridorHalfWidth: 1,
        RouteNarrowHalfWidth: 0,
        RouteCorridorEdgeWidth: 4,
        RoutePocketRadius: 2,
        RouteArchetypeBends: 3,
        RouteArchetypeEdgeCoverChance: 0.94,
        RouteArchetypeOutsideCoverChance: 0.16,
        RouteArchetypeOutsideCoverPasses: 2,
        RouteArchetypeSideCoverChance: 0.92,
        RouteArchetypeSideCoverDistance: 5,
        RouteArchetypeSideCoverThickness: 1,
        RouteArchetypeSideCoverTangentDepth: 1,
        RouteArchetypeActualGateRepairChance: 1.00,
        RouteArchetypeActualGateRepairSpacing: 6,
        RouteArchetypeActualGateRepairHalfLength: 14,
        RouteArchetypeActualGateRepairThickness: 2,
        RouteArchetypeActualGateRepairGap: 0,
        RouteArchetypeActualGateRepairEndpointTrim: 0.14,
        RouteArchetypeActualGateRepairMaxGates: 12,
        RouteArchetypeActualSideRepairChance: 1.00,
        RouteArchetypeActualSideRepairDistance: 5,
        RouteArchetypeActualSideRepairThickness: 1,
        RouteArchetypeActualSideRepairTangentDepth: 1,
        RouteArchetypeActualSideRepairSpacing: 1,
        RouteArchetypeOutsideRoutePenalty: 8,
        ForcedRouteLengthTarget: [145, 230],
        ForcedPrimaryGoalCountTarget: [10, 14],
        ForcedPressureGoalCountTarget: [8, 12],
        ForcedSupportGoalCountTarget: [1, 2],
        ValidationRetries: 6,
        MaxRepairPasses: 4,
        Width: [56, 76],
        Height: [44, 64],
        AspectRatioPalette: [
            { ratio: 1.25, weight: 0.45 },
            { ratio: 1.0, weight: 0.30 },
            { ratio: 1.5, weight: 0.15 },
            { ratio: 0.80, weight: 0.10 }
        ],
        MinSide: 44,
        MaxSide: 96,
        MainPathWidth: [1, 2],
        SidePathWidth: [1, 1],
        PostPlacementRouteCarving: true,
        PlacementRouteGroups: { objectives: false, structures: true, pickups: true, enemies: true },
        MaxPlacementEnemyRoutes: 4,
        RouteStructureSideDistance: [8, 13],
        RoutePickupSideDistance: [0, 3],
        MaxRouteSideSiteDistance: 15,
        MinRoutePickupAnchorDistance: 4,
        MinRoutePickupSiteDistance: 4,
        RoutePickupCoverTarget: 3,
        RoutePickupMaxCover: 16,
        RouteStructureCoverTarget: 24,
        LiveStructureCoverTarget: 28,
        PostPlacementCoverDensity: 1.15,
        LiveStructureMapMargin: 8,
        RouteEnemyMinOffsetTiles: 0,
        RouteEnemyOffsetTiles: 1,
        SideRouteEnemyOffsetTiles: 1,
        DeadEndSpursPer2048Tiles: [0.8, 1.8],
        DeadEndSpurLength: [8, 18],
        RouteWanderCost: [0.30, 0.85],
        RouteWanderScale: [6, 11],
        LoopChance: 0.10,
        IceLayoutRuntimeOverrides: {
            TreeCoverage: 0.52,
            MinTreeCoverage: 0.32,
            MaxTreeCoverage: 0.72,
            // Dense neck walls deliberately receive late route-edge screens.
            // The semantic mask remains capped at 72%, while the connected
            // ice canopy representation occupies about 80% of visible cells.
            MaxRenderedTreeTileCoverage: 0.82,
            MinRenderedTreeTileCoverage: 0.20,
            CarvedForestCoverage: [0.48, 0.60],
            LandFraction: 1.0,
            ContinentStyles: [
                { name: "mainland", weight: 1.0, landFraction: 1.0 }
            ],
            CoastChance: 0,
            LakeChance: 0,
            MaxWaterCoverage: 0.02,
            EdgeBiomeChance: 0.72,
            EdgeBiomeKinds: { ridge: 1.0 },
            // Neck composition comes from forest walls and a winding route.
            // A mandatory cross-map cliff was replacing that grammar.
            PlateauChance: 0,
            CliffChance: 0,
            CampaignSpurCount: 3,
            RouteStructureSideDistance: [8, 13],
            RoutePickupSideDistance: [0, 3],
            MaxRouteSideSiteDistance: 15,
            MinRoutePickupAnchorDistance: 4,
            MinRoutePickupSiteDistance: 4,
            RoutePickupCoverTarget: 3,
            RoutePickupMaxCover: 16,
            RouteStructureCoverTarget: 24,
            LiveStructureCoverTarget: 28,
            PostPlacementCoverDensity: 1.15,
            LiveStructureMapMargin: 8,
            LayoutTemplates: { valley: 0.44, linear_gauntlet: 0.34, peninsula: 0.14, siege: 0.08 },
            ClearingCountPer2048Tiles: [3.0, 4.4],
            WildernessClearingsPer2048Tiles: [0.5, 1.0],
            MinimumChokepoints: 3,
            MinRouteNarrowFractionAtMost3: 0.07,
            MaxRouteMedianWidth: 12,
            MinRouteNarrowRunAtMost3: 2,
            RouteWidthHardFail: true,
            MinFinalRouteNarrowFractionAtMost3: 0.03,
            MaxFinalRouteMedianWidth: 10,
            MinFinalRouteNarrowRunAtMost3: 3,
            FinalRouteWidthHardFail: true,
            StructureClusters: 2
        }
    });

    profiles.grammar_ice_skidoo_jump = merge(profiles.grammar_ice, {
        UseOriginalTerrainTemplate: false,
        ForcedCampaignBand: "mid",
        ForcedObjectiveLabel: "destroy_buildings",
        ForcedMobilityMode: "skidoo_jump",
        ForcedArchetype: "long_route",
        ForcedIceLayoutStyle: "ice_cliff_checkpoint",
        RequireRenderedHardValidation: true,
        RouteArchetype: "vehicle_jump_route",
        RouteCorridorHalfWidth: 2,
        RouteNarrowHalfWidth: 1,
        RouteCorridorEdgeWidth: 3,
        RoutePocketRadius: 3,
        RouteArchetypeBends: 2,
        RouteArchetypeEdgeCoverChance: 0.42,
        RouteArchetypeOutsideCoverChance: 0.05,
        RouteArchetypeOutsideRoutePenalty: 4,
        ForcedRouteLengthTarget: [130, 210],
        ForcedPrimaryGoalCountTarget: [9, 13],
        ForcedPressureGoalCountTarget: [7, 11],
        ForcedSupportGoalCountTarget: [1, 2],
        ForcedVehicleCount: 1,
        ForcedVehicleSet: 1,
        ValidationRetries: 6,
        MaxRepairPasses: 3,
        Width: [56, 72],
        Height: [44, 60],
        AspectRatioPalette: [
            { ratio: 1.35, weight: 0.45 },
            { ratio: 1.0, weight: 0.30 },
            { ratio: 1.6, weight: 0.15 },
            { ratio: 0.75, weight: 0.10 }
        ],
        MinSide: 44,
        MaxSide: 92,
        MainPathWidth: [2, 3],
        SidePathWidth: [1, 1],
        PostPlacementRouteCarving: true,
        PlacementRouteGroups: { objectives: false, structures: true, pickups: true, enemies: true, vehicles: true },
        MaxPlacementEnemyRoutes: 4,
        RoutePickupSideDistance: [1, 3],
        MaxRouteSideSiteDistance: 5,
        MinRoutePickupAnchorDistance: 5,
        MinRoutePickupSiteDistance: 5,
        RoutePickupCoverTarget: 2,
        RoutePickupMaxCover: 14,
        LiveStructureMapMargin: 8,
        MinRenderedStructureContextCoverFraction: 0.12,
        RouteStructureCoverTarget: 20,
        LiveStructureCoverTarget: 24,
        PostPlacementCoverDensity: 0.95,
        RouteEnemyMinOffsetTiles: 1,
        RouteEnemyOffsetTiles: 2,
        SideRouteEnemyOffsetTiles: 2,
        DeadEndSpursPer2048Tiles: [0.5, 1.2],
        DeadEndSpurLength: [6, 14],
        RouteWanderCost: [0.22, 0.70],
        RouteWanderScale: [7, 12],
        LoopChance: 0.08,
        IceLayoutRuntimeOverrides: {
            TreeCoverage: 0.18,
            MinTreeCoverage: 0.06,
            MaxTreeCoverage: 0.28,
            // Jump routes add approach screens around both ramps after the
            // base 28% semantic budget. Their measured pre-placement canopy
            // reaches about 33%, so validate that rendered representation
            // independently while retaining the sparse authored mask.
            MaxRenderedTreeTileCoverage: 0.34,
            CarvedForestCoverage: [0.06, 0.12],
            EdgeBiomeChance: 0.88,
            EdgeBiomeKinds: { ridge: 1.0 },
            PlateauChance: 1.0,
            CliffChance: 1.0,
            CampaignSpurCount: 2,
            RoutePickupSideDistance: [1, 3],
            MaxRouteSideSiteDistance: 5,
            MinRoutePickupAnchorDistance: 5,
            MinRoutePickupSiteDistance: 5,
            RoutePickupCoverTarget: 2,
            RoutePickupMaxCover: 14,
            LiveStructureMapMargin: 8,
            MinRenderedStructureContextCoverFraction: 0.12,
            RouteStructureCoverTarget: 20,
            LiveStructureCoverTarget: 24,
            PostPlacementCoverDensity: 0.95,
            LayoutTemplates: { valley: 0.40, linear_gauntlet: 0.34, peninsula: 0.16, corner_to_corner: 0.10 },
            ClearingCountPer2048Tiles: [3.2, 4.8],
            WildernessClearingsPer2048Tiles: [0.3, 0.8],
            MinimumChokepoints: 1,
            MinRouteNarrowFractionAtMost3: 0.03,
            MaxRouteMedianWidth: 18,
            MinRouteNarrowRunAtMost3: 2,
            RouteWidthHardFail: true,
            MinFinalRouteNarrowFractionAtMost3: 0.0,
            MaxFinalRouteMedianWidth: 26,
            MinFinalRouteNarrowRunAtMost3: 0,
            FinalRouteWidthHardFail: true,
            StructureClusters: 2
        }
    });

    // Diagnostic/curated corner-cliff profile. The normal grammar_ice style
    // picker also selects this geometry, but an explicit profile keeps the
    // real executable pipeline easy to smoke-test and regenerate by seed.
    profiles.grammar_ice_cliff_terrace = merge(
        profiles.grammar_ice_skidoo_jump,
        {
            ForcedMobilityMode: "foot",
            ForcedIceLayoutStyle: "ice_cliff_terrace",
            RouteArchetype: "long_route",
            // Declare the constrained corner-cliff capacity before grammar
            // objective planning. Runtime ice-style tuning repeats these
            // values, but that stage runs after the semantic compound plan;
            // without the profile-level contract XL derived five required
            // landmarks and then rejected valid four-building placements.
            LockGrammarStructureTarget: true,
            GrammarStructureTargetMax: 3,
            StructureMaxClearings: 3,
            // The terrace Concept deliberately uses a dry mainland so its
            // cliff silhouette is not cut by shore smoothing. Calibrate the
            // rendered building-context floor to that open-snow composition
            // instead of inheriting the denser skidoo-jump 12% gate.
            MinRenderedStructureContextCoverFraction: 0.08,
            IceLayoutRuntimeOverrides: merge(
                profiles.grammar_ice_skidoo_jump.IceLayoutRuntimeOverrides,
                { MinRenderedStructureContextCoverFraction: 0.08 }
            )
        }
    );

    // The base ice profile normally selects these layouts by weight. Expose
    // narrow diagnostic aliases as well so executable-backed style matrices
    // and regressions can exercise every layout directly instead of relying
    // on a lucky seed. The aliases inherit all production tuning unchanged;
    // only the layout selector is pinned.
    profiles.grammar_ice_outpost = merge(profiles.grammar_ice, {
        ForcedIceLayoutStyle: "ice_outpost"
    });
    profiles.grammar_ice_edge_patrol = merge(profiles.grammar_ice, {
        ForcedIceLayoutStyle: "ice_edge_patrol"
    });
    profiles.grammar_ice_forest_route = merge(profiles.grammar_ice, {
        ForcedIceLayoutStyle: "ice_forest_route"
    });
    profiles.grammar_ice_tree_blob = merge(profiles.grammar_ice, {
        ForcedIceLayoutStyle: "ice_tree_blob"
    });
    profiles.grammar_ice_compound_raid = merge(profiles.grammar_ice, {
        ForcedIceLayoutStyle: "ice_compound_raid"
    });

    var unsupportedProfiles = {
        desert_patrol: "desert terrain does not have an official grammar profile yet",
        unsupported_desert_terrain: "desert terrain does not have an official grammar profile yet",
        moors_wetlands: "moors terrain does not have an official grammar profile yet",
        unsupported_moors_terrain: "moors terrain does not have an official grammar profile yet",
        interior_compound: "interior terrain does not have an official grammar profile yet",
        unsupported_interior_terrain: "interior terrain does not have an official grammar profile yet",
        afx_snowfield: "AmigaFormat terrain does not have an official grammar profile yet",
        unsupported_afx_terrain: "AmigaFormat terrain does not have an official grammar profile yet"
    };

    function unsupportedProfileReason(pName) {
        if(unsupportedProfiles.hasOwnProperty(pName))
            return unsupportedProfiles[pName];
        return "";
    }

    function resolve(pName, pOverrides, pRandom) {
        var requestedName = pName || defaults.Name;
        var resolvedName = requestedName;
        var random = pRandom || MapGen.Random.CreateSeeded(0);
        var unsupportedReason = unsupportedProfileReason(requestedName) || unsupportedProfileReason(resolvedName);
        var knownProfile = !!profiles[resolvedName];
        var base = profiles[resolvedName] || profiles[defaults.Name];
        var terrainKey = (base && base.TerrainType !== undefined) ? base.TerrainType : defaults.TerrainType;
        var terrainBase = terrainDefaults[terrainKey] || terrainDefaults[Terrain.Types.Jungle];
        var raw = merge(merge(defaults, terrainBase), base);
        var extremeFields;
        var isExtreme;
        var area;
        var resolved;
        var compositionVariant;

        // Look up general-purpose compositions after inheritance, so a named
        // maze/neck/crossing retains its own terrain contract.
        MapGen.Variation.ConfigureProfile(raw, resolvedName, random);
        compositionVariant = resolveCompositionVariant(random, raw.CompositionVariants ||
            (MapGen.ProfileCompositions && MapGen.ProfileCompositions[resolvedName]));
        if(compositionVariant)
            raw = merge(raw, compositionVariant.overrides);
        raw = merge(raw, pOverrides || {});
        extremeFields = (raw.ExtremeFields instanceof Array) ? raw.ExtremeFields : [];
        isExtreme = function(pField) {
            for(var i = 0; i < extremeFields.length; ++i)
                if(extremeFields[i] === pField)
                    return true;
            return false;
        };

        resolved = clone(raw);
        resolved.Name = resolvedName;
        resolved.RequestedName = requestedName;
        resolved.CompositionVariant = compositionVariant ? compositionVariant.name : "";
        resolved.UnsupportedProfileReason = unsupportedReason;
        resolved.Width = resolveRange(random, raw.Width, true);
        resolved.Height = resolveRange(random, raw.Height, true);

        // T1.6: when an AspectRatioPalette is declared on the profile, treat
        // the resolved Width as the longer side and pick the orthogonal side
        // from the palette. Range-resolution above gives the "natural" base
        // size; the palette then reshapes it.
        if(raw.AspectRatioPalette instanceof Array && raw.AspectRatioPalette.length) {
            var longSide = Math.max(resolved.Width, resolved.Height);
            var aspect = applyAspectRatio(random, raw, longSide);
            if(aspect) {
                resolved.Width = aspect.Width;
                resolved.Height = aspect.Height;
                resolved.AspectRatio = aspect.AspectRatio;
            }
        }

        area = resolved.Width * resolved.Height;
        resolved.TreeCoverage = resolveRange(random, raw.TreeCoverage, false, isExtreme("TreeCoverage"));
        resolved.MinTreeCoverage = raw.MinTreeCoverage !== undefined ?
            resolveRange(random, raw.MinTreeCoverage, false, isExtreme("TreeCoverage")) :
            undefined;
        resolved.MaxTreeCoverage = raw.MaxTreeCoverage !== undefined ?
            resolveRange(random, raw.MaxTreeCoverage, false, isExtreme("TreeCoverage")) :
            undefined;
        resolved.PathCoverage = resolveRange(random, raw.PathCoverage, false, isExtreme("PathCoverage"));
        resolved.MainPathWidth = resolveRange(random, raw.MainPathWidth, true);
        resolved.SidePathWidth = resolveRange(random, raw.SidePathWidth, true);
        resolved.ClearingCount = resolvePerAreaCount(random, raw.ClearingsPer2048Tiles, raw.ClearingCount, area, isExtreme("ClearingsPer2048Tiles"));
        resolved.ClearingRadius = resolveRange(random, raw.ClearingRadius, true);
        resolved.WildernessClearingCount = resolvePerAreaCount(random, raw.WildernessClearingsPer2048Tiles, raw.WildernessClearingCount, area, isExtreme("WildernessClearingsPer2048Tiles"));
        resolved.LoopChance = resolveRange(random, raw.LoopChance, false);
        resolved.RiverChance = resolveRange(random, raw.RiverChance, false);
        // Architecture v3: water/feature counts scale with map area like
        // clearings/structures already do. The XPer2048Tiles rate, when present,
        // drives the count; the fixed MaxXCount stays as fallback (small maps
        // unchanged) and as the policy ceiling. Big maps thus get proportionally
        // more rivers/ponds/lakes so a large canvas is not sparse.
        resolved.MaxRiverCount = Math.max(
            Math.max(0, Math.floor(Number(raw.MinRiverCount) || 0)),
            resolvePerAreaCount(random, raw.RiversPer2048Tiles, raw.MaxRiverCount, area, isExtreme("RiversPer2048Tiles"))
        );
        resolved.RiverBranchChance = resolveRange(random, raw.RiverBranchChance, false);
        resolved.MaxBranchDepth = resolveRange(random, raw.MaxBranchDepth, true);
        resolved.RiverWidth = resolveRange(random, raw.RiverWidth, true);
        resolved.RiverMeander = resolveRange(random, raw.RiverMeander, false);
        resolved.StreamChance = resolveRange(random, raw.StreamChance, false);
        resolved.MaxStreamCount = resolvePerAreaCount(random, raw.StreamsPer2048Tiles, raw.MaxStreamCount, area, isExtreme("StreamsPer2048Tiles"));
        resolved.CrossingCount = resolvePerAreaCount(random, raw.CrossingsPer2048Tiles, raw.CrossingCount, area, isExtreme("CrossingsPer2048Tiles"));
        resolved.CrossingMaxRouteDistance = resolveRange(random, raw.CrossingMaxRouteDistance, true);
        resolved.PondChance = resolveRange(random, raw.PondChance, false);
        resolved.MaxPondCount = resolvePerAreaCount(random, raw.PondsPer2048Tiles, raw.MaxPondCount, area, isExtreme("PondsPer2048Tiles"));
        resolved.MaxLakeCount = resolvePerAreaCount(random, raw.LakesPer2048Tiles, raw.MaxLakeCount, area, isExtreme("LakesPer2048Tiles"));
        resolved.CoastChance = resolveRange(random, raw.CoastChance, false);
        resolved.CoastAxisCoverage = raw.CoastAxisCoverage || null;
        resolved.CoastAxisMargin = raw.CoastAxisMargin || null;
        resolved.CoastWaterBeachEdgeRadius = raw.CoastWaterBeachEdgeRadius || null;
        resolved.CoastBeachWaterRadius = raw.CoastBeachWaterRadius || null;
        resolved.LocalBeachRadius = resolveRange(random, raw.LocalBeachRadius, true);
        resolved.CoastWaterWidth = resolveRange(random, raw.CoastWaterWidth, true);
        resolved.BeachWidth = resolveRange(random, raw.BeachWidth, true);
        resolved.MaxWaterCoverage = resolveRange(random, raw.MaxWaterCoverage, false, isExtreme("MaxWaterCoverage"));
        resolved.EnemyDensity = resolveRange(random, raw.EnemyDensity, false, isExtreme("EnemyDensity"));
        resolved.StructureClusters = resolvePerAreaCount(random, raw.StructureClustersPer2048Tiles, raw.StructureClusters, area, isExtreme("StructureClustersPer2048Tiles"));
        resolved.DecorDensity = resolveRange(random, raw.DecorDensity, false, isExtreme("DecorDensity"));
        resolved.MicroStampDensity = resolveRange(random, raw.MicroStampDensity, false);
        resolved.DesertDropChunkChance = resolveRange(random, raw.DesertDropChunkChance, false);
        resolved.DesertDropChunkMaxPer3072Tiles = resolveRange(random, raw.DesertDropChunkMaxPer3072Tiles, true);
        resolved.OutcropChance = resolveRange(random, raw.OutcropChance, false);
        resolved.MaxOutcropCount = resolvePerAreaCount(random, raw.OutcropsPer2048Tiles, raw.MaxOutcropCount, area, isExtreme("OutcropsPer2048Tiles"));
        resolved.OutcropRadius = resolveRange(random, raw.OutcropRadius, true);
        resolved.OutcropKind = raw.OutcropKind || "rocks";
        resolved.EdgeBiomeChance = resolveRange(random, raw.EdgeBiomeChance, false);
        resolved.EdgeBiomeKinds = raw.EdgeBiomeKinds || null;
        resolved.EdgeBiomeAxisCoverage = raw.EdgeBiomeAxisCoverage || null;
        resolved.EdgeBiomeWaterWidth = raw.EdgeBiomeWaterWidth || null;
        resolved.EdgeBiomeBeachWidth = raw.EdgeBiomeBeachWidth || null;
        resolved.EdgeBiomeBandWidth = raw.EdgeBiomeBandWidth || null;
        resolved.DefensiveLineChance = resolveRange(random, raw.DefensiveLineChance, false);
        resolved.DefensiveLineCount = resolveRange(random, raw.DefensiveLineCount, true);
        resolved.DefensiveLineFraction = raw.DefensiveLineFraction || null;
        resolved.DefensiveLineThickness = raw.DefensiveLineThickness || null;
        resolved.DefensiveLineAxisCoverage = raw.DefensiveLineAxisCoverage || null;
        resolved.CliffChance = resolveRange(random, raw.CliffChance, false);
        resolved.PlateauChance = resolveRange(random, raw.PlateauChance, false);
        resolved.MaxRepairPasses = resolveRange(random, raw.MaxRepairPasses, true);
        resolved.LayoutTemplate = resolveLayoutTemplate(random, raw.LayoutTemplates);
        resolved.Validation = validate(resolved);
        if(unsupportedReason) {
            addIssue(
                resolved.Validation,
                "errors",
                "ProfileName",
                "unsupported profile: " + requestedName + " (" + unsupportedReason + ")"
            );
            resolved.Validation.ok = false;
        }
        else if(!knownProfile) {
            addIssue(
                resolved.Validation,
                "errors",
                "ProfileName",
                "profile not found: " + requestedName
            );
            resolved.Validation.ok = false;
        }
        if(resolved.TargetPackProfile) {
            if(!MapGen.TargetPack || !MapGen.TargetPack.Profile) {
                addIssue(resolved.Validation, "errors", "TargetPackProfile", "runtime target pack is not loaded");
            }
            else {
                resolved.TargetPack = MapGen.TargetPack.Profile(resolved.TargetPackProfile);
                if(!resolved.TargetPack)
                    addIssue(resolved.Validation, "errors", "TargetPackProfile", "target pack profile not found: " + resolved.TargetPackProfile);
                else if(resolved.TargetPack.terrainVariant && resolved.TerrainVariant &&
                    resolved.TargetPack.terrainVariant !== resolved.TerrainVariant) {
                    addIssue(
                        resolved.Validation,
                        "errors",
                        "TargetPackProfile",
                        "target pack terrain variant mismatch: " + resolved.TargetPack.terrainVariant + " vs " + resolved.TerrainVariant
                    );
                }
            }
            resolved.Validation.ok = resolved.Validation.errors.length === 0;
        }

        if(MapGen.ProfileOwnership && MapGen.ProfileOwnership.Apply)
            MapGen.ProfileOwnership.Apply(resolved, raw, requestedName, resolvedName);

        return resolved;
    }

    // Pick a target aspect ratio from a weighted palette and return Width/Height
    // for the longer side specified in pLongSide. The shorter side is
    // pLongSide / ratio; both clamped to MinSide/MaxSide if those dials exist.
    function applyAspectRatio(pRandom, pRaw, pLongSideValue) {
        var palette = pRaw.AspectRatioPalette;
        if(!(palette instanceof Array) || !palette.length)
            return null;

        var total = 0;
        for(var i = 0; i < palette.length; ++i) {
            var w = Number(palette[i] && palette[i].weight);
            if(isFinite(w) && w > 0) total += w;
        }
        if(total <= 0) return null;

        var roll = pRandom.Float(0, total);
        var cumulative = 0;
        var pick = palette[0];
        for(var j = 0; j < palette.length; ++j) {
            var weight = Number(palette[j].weight);
            if(!(isFinite(weight) && weight > 0)) continue;
            cumulative += weight;
            if(roll <= cumulative) { pick = palette[j]; break; }
        }

        var ratio = Number(pick && pick.ratio);
        if(!isFinite(ratio) || ratio <= 0) return null;

        var minSide = isNumber(pRaw.MinSide) ? pRaw.MinSide : 16;
        var maxSide = isNumber(pRaw.MaxSide) ? pRaw.MaxSide : Math.max(pLongSideValue, 96);

        var longSide = Math.max(minSide, Math.min(maxSide, pLongSideValue | 0));
        var shortSide = Math.round(longSide / ratio);
        if(shortSide < minSide) shortSide = minSide;
        if(shortSide > maxSide) shortSide = maxSide;

        // ratio < 1 means the long side is the *short axis* of W vs H, so flip
        // to keep Width as horizontal extent. Coin-flip orientation otherwise.
        var widthIsLong = ratio >= 1 ? pRandom.Chance(0.6) : !pRandom.Chance(0.6);
        return widthIsLong ?
            { Width: longSide, Height: shortSide, AspectRatio: ratio } :
            { Width: shortSide, Height: longSide, AspectRatio: ratio };
    }

    function resolveLayoutTemplate(pRandom, pWeights) {
        if(MapGen.Layout && MapGen.Layout.Templates && MapGen.Layout.Templates.PickName)
            return MapGen.Layout.Templates.PickName(pRandom, pWeights, "classic");

        if(!pWeights)
            return "classic";

        var keys = [];
        var total = 0;
        var key;
        for(key in pWeights) {
            if(!pWeights.hasOwnProperty(key))
                continue;
            var weight = Number(pWeights[key]);
            if(!isFinite(weight) || weight <= 0)
                continue;
            keys.push({ name: key, weight: weight });
            total += weight;
        }
        if(!keys.length)
            return "classic";

        var roll = pRandom.Float(0, total);
        var cumulative = 0;
        for(var index = 0; index < keys.length; ++index) {
            cumulative += keys[index].weight;
            if(roll <= cumulative)
                return keys[index].name;
        }
        return keys[keys.length - 1].name;
    }

    return {
        Defaults: defaults,
        TerrainDefaults: terrainDefaults,
        Profiles: profiles,
        ReferenceAreaTiles: REFERENCE_AREA_TILES,
        Clone: clone,
        Merge: merge,
        Validate: validate,
        Resolve: resolve
    };
})();
