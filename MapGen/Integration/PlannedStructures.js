var MapGen = MapGen || {};
MapGen.Integration = MapGen.Integration || {};

(function(I) {
    // Campaign buildings must have exact sites before terrain is rendered.
    // Civilian delivery uses its separate civilian_home plan entry.
    I.PlaceCampaignBuildings = function(buildings, purpose) {
        var specs = I.FlattenBuildings(buildings);
        if(!specs.length)
            return true;
        var context = Session.MapGenContext;
        if(!context || !context.GameplayPlan || purpose !== "enemy")
            return false;
        return I.CommitPlannedBuildings(context, specs);
    };
    I.CommitPlannedBuildings = function(c, specs) {
        var plan = c.GameplayPlan;
        var entries = plan ? plan.entries.filter(function(e) { return e.purpose === "enemy"; }) : [];
        if(!plan || !plan.ok || plan.committed || entries.length !== specs.length)
            return false;
        // Validate the complete request before publishing any structure.
        for(var s = 0; s < specs.length; ++s) {
            var expected = entries[s].spec;
            if(expected.building !== specs[s].building || expected.sprite !== specs[s].sprite)
                return false;
        }
        for(var i = 0; i < entries.length; ++i)
            if(!I.CommitPlannedStructure(c, entries[i]))
                return false;
        plan.committed = true;
        return true;
    };
    I.CommitPlannedStructure = function(c, entry) {
        var site = entry.candidate;
        if(entry.committed || !I.PlaceStructureSpec(entry.spec, site.tileX, site.tileY))
            return false;
        var dirty = c.StructureTerrainDirty;
        I.ReserveStructureSite(c, entry.spec, site);
        c.StructureTerrainDirty = dirty;
        I.RecordLiveStructurePlacement(c, entry.spec, site, entry.purpose);
        if(!I.PaintStructureTilesToRenderedMap(c, entry.spec, site.tileX, site.tileY))
            return false;
        entry.committed = true;
        return true;
    };
})(MapGen.Integration);
