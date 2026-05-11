var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// Route planning sets these flags once. No later terrain or placement stage
// can repair a missing route-side site, so stop before those expensive stages.
MapGen.Layout.PreflightRoutePlan = function(c, rules) {
    if(MapGen.Context.IsMultiplayer(c) || !rules || !rules.RequireCampaignRouteSites)
        return;
    var report = MapGen.Validate.CreateReport();
    MapGen.Validate.CampaignRoutePlan(c, report, rules, false);
    if(!report.ok)
        c.EarlyRejection = {reason: report.reasons[0], reasons: report.reasons};
};

// Validate the completed gameplay placement plan before terrain cover/render.
// The late layout preflight repeats this after encounter planning. Live
// validation separately checks the actual materialized building positions.
MapGen.Layout.ValidatePlannedStructures = function(c, report) {
    var plan = c.GameplayPlan;
    if(!plan || !plan.ok)
        return true;
    var placements = [];
    for(var i = 0; i < plan.entries.length; ++i) {
        var e = plan.entries[i], site = e.candidate;
        var region = MapGen.Encounters.NearestEncounterRegion(c, site.clearing, false);
        placements.push({rect : site.rect, spec : e.spec, regionId : region ? region.id : ""});
    }
    report.counts = report.counts || {};
    var probe = {
        Width : c.Width, Height : c.Height, Profile : c.Profile,
        LiveStructurePlacements : placements
    };
    MapGen.Integration.ValidateLiveStructureSpacing(report, probe);
    MapGen.Integration.ValidateLiveStructureMapUse(report, probe, plan.required);
    return report.ok;
};

// Layout failures cannot be repaired by rendering the same terrain again.
MapGen.Layout.Preflight = function(c, rules) {
    if(MapGen.Context.IsMultiplayer(c))
        return;
    var report = MapGen.Validate.CreateReport();
    if(rules && rules.RequireCampaignRouteSites) {
        MapGen.Validate.CampaignRouteSites(c, report, rules);
        MapGen.Validate.CampaignRouteFlow(c, report, rules);
    }
    MapGen.Layout.ValidatePlannedStructures(c, report);
    if(!report.ok)
        c.EarlyRejection = {reason : report.reasons[0], reasons : report.reasons};
};
