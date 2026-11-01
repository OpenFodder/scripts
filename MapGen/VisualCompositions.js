var MapGen = MapGen || {};

// A composition owns terrain proportions as well as shapes. Keep its settings
// through late mission tuning, while explicit caller overrides still win.
MapGen.VisualCompositions = {
    Choose: function(name, seed, landscape, overrides) {
        if(["grammar_jungle", "grammar_beach", "grammar_ice"].indexOf(name) < 0 ||
            overrides && (overrides.VisualComposition === false || overrides.RegionalComposition === false ||
                overrides.ForcedIceLayoutStyle && !overrides.VisualComposition)) return;
        var ice = name === "grammar_ice", beach = name === "grammar_beach";
        var choices = ["forest_clearings", "open_woods", "forest_bank", "broken_woods",
            "branching_woods", "forest_heartland"];
        if(ice) choices.push("coastal_shelf", "cliff_country", "forest_maze", "coastal_shelf", "cliff_country");
        else if(beach) choices.push("coastal_shelf");
        else if(landscape === "inland_trails") choices.push("cliff_country", "cliff_country");
        var kind = overrides && typeof overrides.VisualComposition === "string" ?
            overrides.VisualComposition : choices[Math.floor(MapGen.Random.HashTile(seed,83,47,19601)/4294967296 * choices.length)];
        if(choices.indexOf(kind) < 0) throw new Error("Unsupported visual composition: " + kind);
        if(landscape === "forest_labyrinth" && !(overrides && overrides.VisualComposition)) kind = "forest_clearings";
        return kind;
    },

    Configure: function(p, name, seed, landscape, overrides, selected) {
        var kind=selected || this.Choose(name,seed,landscape,overrides);
        if(!kind) return;
        function unit(salt) { return MapGen.Random.HashTile(seed, 83, 47, salt) / 4294967296; }
        var ice=name==="grammar_ice", beach=name==="grammar_beach";
        var settings = {PreserveForestOpenSpace:true, PerimeterCover:false,
            ForestPatchAndGrow:false, CarvedForestFill:false, CarvedForestSectorFill:false,
            ForestCoverageWholeMap:true, GrassNoiseScale:0.04 + unit(19603) * 0.12};
        settings.SceneForests = !(overrides && (overrides.ForestBodyCount !== undefined || overrides.ForestShape !== undefined));
        var waterKinds={forest_clearings:["lakes","lake_chain"],open_woods:["long_basin","inlets","lake_chain"],
            forest_bank:["meander","tributaries"],broken_woods:["lakes","crescent","lake_chain"],
            branching_woods:["tributaries","meander"],forest_heartland:["crescent","lakes"],
            coastal_shelf:["inlets"],cliff_country:["lakes","long_basin"]};
        if(waterKinds[kind]) {
            var styleIndex=["forest_clearings","open_woods","forest_bank","broken_woods","branching_woods",
                "forest_heartland","coastal_shelf","cliff_country"].indexOf(kind);
            settings.WaterVariation=styleIndex+1;
            settings.WaterSeed=MapGen.Random.HashTile(seed,styleIndex+1,41,24701);
            var options=waterKinds[kind];
            if(!(overrides && overrides.RegionalIceTerrain !== undefined))
                settings.WaterBodyKind=options[MapGen.Random.HashTile(seed,styleIndex+1,47,24703)%options.length];
        }
        var cover;
        if(kind === "forest_clearings") {
            settings.ForestShape = "clearings";
            cover = (ice ? 0.30 : 0.51) + unit(19607) * 0.12;
            settings.GrassPaletteRareWeight = 0.12;
        } else if(kind === "branching_woods") {
            settings.ForestShape = "branches";
            cover = (ice ? 0.15 : 0.27) + unit(19607) * 0.13;
            settings.GrassPaletteRareWeight = 0.40;
        } else if(kind === "forest_heartland") {
            settings.ForestShape = "heartwood";
            settings.ForestBodyCount = 1;
            cover = (ice ? 0.20 : 0.38) + unit(19607) * 0.12;
            settings.GrassPaletteRareWeight = 0.30;
        } else if(kind === "open_woods" || kind === "coastal_shelf" || kind === "cliff_country") {
            settings.ForestShape = "groves";
            settings.ForestBodyCount = 2;
            cover = !ice ? 0.10 + unit(19607) * 0.07 :
                kind === "cliff_country" ? 0.12 + unit(19607) * 0.06 :
                kind === "open_woods" ? 0.06 + unit(19607) * 0.08 : 0.03 + unit(19607) * 0.06;
            settings.GrassPaletteRareWeight = 0.45;
        } else if(kind === "forest_bank") {
            settings.ForestShape = "bank";
            cover = ice ? 0.16 + unit(19607) * 0.12 : 0.32 + unit(19607) * 0.13;
            settings.GrassPaletteRareWeight = 0.25;
        } else {
            settings.ForestShape = "groves";
            settings.ForestBodyCount = 6;
            cover = (ice ? 0.10 : 0.24) + unit(19607) * 0.10;
            settings.GrassPaletteRareWeight = 0.65;
        }
        settings.TreeCoverage = cover;
        settings.MinTreeCoverage = cover * 0.60;
        settings.MaxTreeCoverage = Math.min(0.82, cover + 0.15);
        if(!ice) {
            settings.NaturalJungleGround = true;
            // Original sub0 maps average about six detail tiles per thousand
            // map cells, including their base palette. Keep the extra pass
            // sparse; broad terrain shapes provide the visual variation.
            settings.GrassPaletteRareWeight *= 0.08;
            settings.SurfaceDetailCoverage = 0.001 + unit(19613) * 0.002;
            settings.SurfaceDetailStyle = ["meadow", "scrub", "mixed"][Math.floor(unit(19617) * 3)];
        }
        if(beach) {
            settings.RegionalBeachForestCoverage = cover;
            if(kind === "coastal_shelf") settings.MaxWaterCoverage = 0.48;
        }
        if(ice) {
            settings.SurfaceDetailCoverage = 0.002 + unit(19613) * 0.003;
            settings.SurfaceDetailStyle = "rock_fields";
            settings.ForcedIceLayoutStyle = kind === "forest_maze" ? "ice_tree_maze" : "ice_outpost";
            settings.RegionalIceCliff = kind === "cliff_country";
            if(kind === "cliff_country")
                settings.RegionalIceCliffShape = ["flat", "rising", "falling", "ridge", "valley"][Math.floor(unit(19619) * 5)];
            settings.RegionalIceTerrain = kind === "coastal_shelf" ? "inlets" :
                kind === "forest_bank" ? "river_loop" : "lakes";
            settings.RegionalIceWaterCoverage = kind === "coastal_shelf" ? 0.42 + unit(19611) * 0.04 :
                kind === "open_woods" ? 0.32 + unit(19611) * 0.12 :
                kind === "broken_woods" ? 0.24 + unit(19611) * 0.14 :
                kind === "forest_bank" ? 0.18 + unit(19611) * 0.14 :
                kind === "cliff_country" ? 0.08 + unit(19611) * 0.10 :
                kind === "branching_woods" ? 0.08 + unit(19611) * 0.14 :
                kind === "forest_heartland" ? 0.03 + unit(19611) * 0.09 :
                kind === "forest_clearings" ? 0.06 + unit(19611) * 0.08 : 0;
            settings.MaxWaterCoverage = Math.min(0.60,
                Math.max(0.12, settings.RegionalIceWaterCoverage / 0.78 + 0.04));
            // The maze's authored barriers retain their own coverage tuning.
            if(kind === "forest_maze") {
                delete settings.TreeCoverage; delete settings.MinTreeCoverage;
                delete settings.MaxTreeCoverage;
            } else {
                settings.MaxRenderedTreeTileCoverage = Math.min(0.82, cover + 0.20);
                settings.MinRenderedTreeTileCoverage = kind === "forest_clearings" ||
                    kind === "forest_bank" || kind === "broken_woods" ||
                    kind === "branching_woods" || kind === "forest_heartland" ? cover * 0.15 : 0;
                // Validation derives the floor from coverage. Do not retain
                // the old outpost's cached absolute minimum from late tuning.
                settings.MinRenderedTreeTiles = 0;
                // Regional terrain already budgets its forest around water,
                // cliffs and sites. Generic late screens erase sparse styles.
                settings.FinalOpenFieldCover = false;
                settings.FinalRouteEdgeCover = false;
            }
        } else if(kind === "cliff_country") {
            settings.CliffChance = 1; settings.PlateauChance = 1;
            settings.CurvedJungleCliffs = true;
        }
        p.VisualComposition = kind;
        p.VisualCompositionSettings = {};
        for(var key in settings) if(settings.hasOwnProperty(key)) {
            // Do not reapply a default over an explicit caller setting.
            if(overrides && overrides.IceLayoutRuntimeOverrides &&
                overrides.IceLayoutRuntimeOverrides.hasOwnProperty(key)) continue;
            if(!(overrides && overrides.hasOwnProperty(key))) p[key] = settings[key];
            p.VisualCompositionSettings[key] = settings[key];
        }
    },

    ApplyRuntime: function(c) {
        var p = c.Profile, settings = p.VisualCompositionSettings;
        if(!settings || MapGen.Context.IsMultiplayer(c)) return;
        for(var key in settings) if(settings.hasOwnProperty(key)) p[key] = settings[key];
    }
};
