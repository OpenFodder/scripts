var MapGen = MapGen || {};
MapGen.Grammar = MapGen.Grammar || {};

MapGen.Grammar.Profile = {

    Resolve: function(pContext, pPlan) {
        var profile = pContext.Profile || {};
        var target = profile.TargetPack || null;
        var report = {
            name: "profile",
            status: target ? "ready" : "missing_target_pack",
            profileName: profile.Name || "",
            targetPackProfileName: profile.TargetPackProfile || "",
            terrainVariant: profile.TerrainVariant || "",
            confidence: target ? target.officialDataConfidence || "" : "",
            sourceMaps: target ? target.sourceMaps || [] : [],
            dataCoverage: target ? target.dataCoverage || {} : {},
            caveats: target ? target.caveats || [] : [],
            outlierReasons: []
        };

        if(!target) {
            report.outlierReasons.push("target_pack_profile_missing");
            pPlan.outlierReasons.push("target_pack_profile_missing");
        }

        return report;
    }
};
