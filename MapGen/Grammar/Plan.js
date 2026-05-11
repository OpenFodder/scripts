var MapGen = MapGen || {};
MapGen.Grammar = MapGen.Grammar || {};

MapGen.Grammar.Plan = {

    EmptyStage: function(pName) {
        return {
            name: pName,
            status: "pending",
            source: "",
            notes: [],
            outlierReasons: []
        };
    },

    Create: function(pContext) {
        var profile = pContext.Profile || {};
        var targetPackProfile = profile.TargetPack || null;

        return {
            schema: 1,
            generatorCore: "official_grammar",
            scaffoldOnly: true,
            materializationMode: "grammar_plan_pending_live_materialization",
            profileName: profile.Name || "",
            targetPackProfileName: profile.TargetPackProfile || "",
            terrainVariant: profile.TerrainVariant || "",
            terrainType: profile.TerrainType,
            terrainTypeSub: profile.TerrainTypeSub || 0,
            sourceMaps: targetPackProfile ? targetPackProfile.sourceMaps || [] : [],
            confidence: targetPackProfile ? targetPackProfile.officialDataConfidence || "" : "",
            caveats: targetPackProfile ? targetPackProfile.caveats || [] : [],
            dataCoverage: targetPackProfile ? targetPackProfile.dataCoverage || {} : {},
            profile: this.EmptyStage("profile"),
            intent: this.EmptyStage("intent"),
            screenPlan: this.EmptyStage("screenPlan"),
            routePlan: this.EmptyStage("routePlan"),
            mobilityPlan: this.EmptyStage("mobilityPlan"),
            objectivePlan: this.EmptyStage("objectivePlan"),
            spritePlan: this.EmptyStage("spritePlan"),
            dynamicTerrainPlan: this.EmptyStage("dynamicTerrainPlan"),
            semanticTerrain: this.EmptyStage("semanticTerrain"),
            materialization: this.EmptyStage("materialization"),
            // compoundPlan/supportPlan/civilianPlan/validation stages removed in
            // the architecture v3 scaffold cleanup — no live consumers.
            outlierReasons: []
        };
    }
};
