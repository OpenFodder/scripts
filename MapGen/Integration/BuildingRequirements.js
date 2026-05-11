var MapGen = MapGen || {};
MapGen.Integration = MapGen.Integration || {};

(function(pIntegration) {
    pIntegration.CampaignBuildingRequirements = function(context) {
        var plan = context && context.GrammarPlan;
        var objectivePlan = plan ? plan.objectivePlan || {} : {};
        var doors = objectivePlan.doors || [];
        var structures = objectivePlan.structures || [];
        var objectiveLabel = plan && plan.intent ? String(plan.intent.objectiveLabel || "") : "";
        var profile = context && context.Profile || {};
        var liveObjectiveLabel = String((profile && profile.GrammarLiveObjectiveLabel) || objectiveLabel || "");
        var destroyBuildingObjective = liveObjectiveLabel === "destroy_buildings";
        var beachTarget =
            profile.TargetPackProfile === "grammar_beach" ? Number(profile.GrammarBeachBuildingTarget) : 0;
        var count = 0;
        var targetDoors = 0;

        // Beach compositions use standalone buildings as terrain landmarks
        // even when the mission objective is enemies or hostages.
        // Previously those objectives returned early and silently discarded
        // the composition's building target, leaving half the generated maps
        // empty.
        if(liveObjectiveLabel !== "destroy_buildings" && !(isFinite(beachTarget) && beachTarget > 0)) {
            return {
                barracks : {soldier : 0},
                bunker : {soldier_heavy_explosion_only : 0},
                hut : {soldier : 0}
            };
        }

        for(var index = 0; index < doors.length; ++index) {
            if(doors[index].role !== "civilian_door")
                ++count;
        }

        count = Math.max(count, structures.length);
        // objective_doors is a corpus distribution, not a per-map request.
        // Only use its midpoint as a defensive fallback when the semantic
        // objective plan produced no doors or structures of its own.
        if(objectiveLabel === "destroy_buildings" && count === 0)
            targetDoors = Scenario.Random.GrammarTargetRoleCount("objective_doors", 0, context);
        count = Math.max(count, targetDoors);
        if(isFinite(beachTarget))
            count = Math.max(count, Math.max(0, Math.floor(beachTarget)));

        // The semantic compound plan can legally yield fewer buildings than
        // the route/clearing plan (for example two one-building compounds on
        // a large jungle map). Keep the live mission target aligned with the
        // map-scale progression contract so authored route regions do not end
        // up as empty scenery.
        var progressionFloor = Math.max(0, Math.floor(Number(profile.MapScaleStructureFloor || 0)));
        count = Math.max(count, progressionFloor);

        var structureTargetMax =
            Math.floor(Number(profile.GrammarResolvedStructureTargetMax || profile.GrammarStructureTargetMax));
        if(isFinite(structureTargetMax) && structureTargetMax > 0)
            count = Math.min(count, structureTargetMax);

        // The scoped sub1 originals use separated green barracks/hut landmarks
        // (mapm5 has four). Fortified compositions may request a bunker only
        // when that structure is supported by the resolved tileset.
        var beachLandmarks = profile.TargetPackProfile === "grammar_beach";
        var beachComposition = String(profile.GrammarBeachComposition || "");
        var fortifiedBeach =
            beachLandmarks && (beachComposition === "fortified_beach" || beachComposition === "twin_outposts");
        var barracks =
            beachLandmarks ? Math.max(1, count - (fortifiedBeach ? 1 : 0)) : Math.max(0, Math.min(2, count));
        var bunkers = beachLandmarks ? 0 : Math.max(0, count - barracks);
        if(fortifiedBeach)
            bunkers = Math.max(0, count - barracks);

        // Type 88/100 bunker doors ignore the ordinary Explosion damage made
        // by squad grenades and rockets. A RocketBox therefore cannot make a
        // destroy-buildings mission containing bunkers completable. Keep those
        // bunkers for non-objective landmarks, but use standard-explosive
        // barracks for every generated destroy-buildings target.
        if(destroyBuildingObjective) {
            barracks = count;
            bunkers = 0;
        }

        if(bunkers && !this.StructureInfo({building: "bunker", sprite: "soldier_heavy_explosion_only"}, context)) {
            barracks += bunkers;
            bunkers = 0;
        }

        return {
            barracks : {soldier : barracks},
            bunker : {soldier_heavy_explosion_only : bunkers},
            hut : {soldier : 0}
        };
    };
})(MapGen.Integration);
