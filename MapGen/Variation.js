var MapGen = MapGen || {};

// Independent seeded choices for geometry, forest shape and safe building sites.
// These change proposals, never footprint, access or acceptance requirements.
MapGen.Variation = {
    ConfigureProfile: function(profile, name, random) {
        if(name !== "grammar_jungle" && name !== "grammar_ice" && name !== "grammar_beach") return;
        profile.RegionalComposition = true;
        var seed = random.InitialSeed;
        function unit(index) {
            return MapGen.Random.HashTile(seed, index, 43, 19001) / 4294967296;
        }
        profile.ForestShape = ["groves", "belts", "heartwood", "rim"][Math.floor(unit(11) * 4)];
        profile.ForestShapeAngle = unit(12) * Math.PI;
        profile.ForestShapePhase = unit(13) * Math.PI * 2;
        profile.ForestShapeBands = 1 + Math.floor(unit(14) * 3);
        profile.PreserveForestOpenSpace = profile.ForestShape !== "groves";
        if(name === "grammar_ice") {
            profile.RegionalIceTerrain = ["lakes", "inlets", "river_loop", "woodland"][Math.floor(unit(15) * 4)];
            var waterRanges = {lakes: [0.12, 0.30], inlets: [0.18, 0.32],
                river_loop: [0.08, 0.18], woodland: [0.02, 0.07]};
            var range = waterRanges[profile.RegionalIceTerrain];
            profile.RegionalIceWaterCoverage = range[0] + unit(17) * (range[1] - range[0]);
            return; // Ice's intent styles own their cover and route budgets.
        }
        if(name === "grammar_beach") {
            profile.AllowBeachInteriorWater = unit(16) < 0.75;
            profile.RegionalBeachForestCoverage = 0.14 + unit(18) * 0.42;
            // Full-edge shores need a coastal budget; the former 16% cap
            // rejected them in favour of the same shallow corner every time.
            profile.MaxWaterCoverage = 0.36;
        }
        // The landscape determines water, not a fixed route/forest recipe.
        profile.SpatialAnchorVariation = true;
        profile.StructureCountVariation = true;
        profile.LayoutTemplates = {corner_to_corner: 0.17, siege: 0.10,
            peninsula: 0.09, crossroads: 0.13, valley: 0.13,
            linear_gauntlet: 0.13, hub_and_spoke: 0.15, parallel_lanes: 0.10};
        profile.TreeCoverage = 0.34 + unit(1) * 0.20;
        profile.ForestLargeScaleFraction = 0.12 + unit(2) * 0.26;
        profile.ForestMediumScaleFraction = 0.05 + unit(3) * 0.09;
        profile.ForestSeedDensity = 0.0035 + unit(4) * 0.0055;
        profile.ForestPatchMaxSize = Math.round(40 + unit(5) * 120);
        profile.ForestPatchAlpha = 1.15 + unit(6) * 0.75;
        profile.CarvedForestFill = false;
        profile.ForestPatchAndGrow = false;
        profile.CarvedForestSectorFill = false;
        profile.CarvedForestCoverage = 0.42 + unit(8) * 0.32;
        profile.PerimeterCoverWidth = [1, 3];
        profile.PerimeterCoverChance = 0.20 + unit(9) * 0.65;
        // Regional anchors and building aprons already supply encounter space.
        // Keep filler clearings small enough to leave interior terrain visible.
        profile.ClearingRadius = [3, 4];
        profile.ClearingsPer2048Tiles = [0.6, 1.4];
        profile.WildernessClearingsPer2048Tiles = [0, 0.6];
        profile.MainPathWidth = 1;
        profile.SidePathWidth = 1;
        profile.RouteCorridorHalfWidth = 1;
        profile.RoutePocketRadius = 2;
        profile.DeadEndSpursPer2048Tiles = 0.2 + unit(10) * 1.3;
        profile.RouteArchetypeBends = [1, 2];
        profile.RouteArchetypeBendAmplitude = 0.07;
        profile.StructureMinSpacing = 6;
        profile.LiveStructureMinSpacing = 6;
        profile.StructureBuildingsPerClearing = 2;
        profile.LinearGauntletLateralDrift = [0.05, 0.24];
        // Spatial fields change the forest's large shape, not merely its noise
        // frequency. Reserve routes/buildings first, then rank the remaining
        // eligible forest cells against this field.
    },

    ForestScore: function(c, x, y, noise) {
        if(c.RegionalPlan) return MapGen.Layout.RegionIntents.ForestScore(c, x, y, noise);
        var p = c.Profile, shape = p.ForestShape;
        if(shape !== "belts" && shape !== "heartwood" && shape !== "rim") return noise;
        // Cache one small field per context: repairs can ask for the same
        // score repeatedly, and none of its inputs depend on mutable layers.
        if(!c._forestShapeField) {
            var field = new Float32Array(c.Width * c.Height);
            var co = Math.cos(p.ForestShapeAngle), si = Math.sin(p.ForestShapeAngle);
            for(var fy = 0; fy < c.Height; ++fy) {
                for(var fx = 0; fx < c.Width; ++fx) {
                    var nx = fx / c.Width - 0.5, ny = fy / c.Height - 0.5;
                    var u = nx * co + ny * si, v = ny * co - nx * si;
                    var bend = 0.07 * Math.sin(v * 8 + p.ForestShapePhase);
                    var value;
                    if(shape === "belts")
                        value = Math.cos((u + bend) * p.ForestShapeBands * Math.PI * 2 + p.ForestShapePhase);
                    else {
                        var radius = Math.sqrt((u + bend) * (u + bend) + v * v * 1.8);
                        value = shape === "rim" ? radius * 3 - 1 : 1 - radius * 3;
                    }
                    field[fy * c.Width + fx] = value;
                }
            }
            c._forestShapeField = field;
        }
        return noise * 0.30 + c._forestShapeField[y * c.Width + x] * 0.70;
    },

    MoveAnchors: function(c) {
        if(c.RegionalPlan || !c.Profile.SpatialAnchorVariation || MapGen.Context.IsMultiplayer(c)) return;
        var seen = [], anchors = MapGen.Layout.Anchors;
        function move(point) {
            if(!point || seen.indexOf(point) >= 0) return;
            seen.push(point);
            var x = point.x, y = point.y;
            var moved = anchors.SnapToLand(c, anchors.MakePoint(c,
                x + (MapGen.Random.HashTile(c.Seed, x, y, 19009) / 4294967296 - 0.5) * c.Width * 0.22,
                y + (MapGen.Random.HashTile(c.Seed, x, y, 19013) / 4294967296 - 0.5) * c.Height * 0.26,
                point.role));
            point.x = moved.x;
            point.y = moved.y;
        }
        for(var key in c.Anchors)
            if(c.Anchors.hasOwnProperty(key)) move(c.Anchors[key]);
        for(var i = 0; i < c.Regions.length; ++i) move(c.Regions[i].point);
    },

    BuildingBias: function(c, x, y, slot) {
        // Jump routes have narrow, authored cliff/ramp reservations. Preserve
        // their proximity-first placement: moving a valid footprint can leave
        // later buildings without space or without enough rendered cover.
        var intent = c.GrammarPlan && c.GrammarPlan.intent;
        if(intent && intent.guardrails && intent.guardrails.requiresJumpRoute)
            return (MapGen.Random.HashTile(c.Seed, x, y, 7319) % 1000) / 1000;
        // The original <1-point jitter was swamped by 500-point distribution
        // bonuses. A smooth preference field moves sites within safe sectors;
        // coverage/span bonuses and all geometric rejection checks still win.
        var scale = Math.max(6, Math.min(c.Width, c.Height) * 0.24);
        return MapGen.Layout.RegionIntents.BuildingScore(c, x, y, slot) +
            MapGen.Terrain.Cover.ValueNoise(c, x, y, scale, 19031 + slot * 37) * 240 +
            (MapGen.Random.HashTile(c.Seed, x, y, 19037 + slot * 41) / 4294967296) * 36;
    }
};
