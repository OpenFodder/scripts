var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};

MapGen.Terrain.Build = function(pContext) {
    // Terrain.Water.Build (bank marking, crossings, step-bank widening) was
    // hoisted into Layout.Build on 2026-06-15 ([[mapgen_cliff_edge_to_edge]]
    // Slice 1A) so Plateau/PlateauCliffs and Connectivity see riverBank/
    // forcedBank/crossing populated. No call here.

    // Plateau and cliffs sit between Water (so they can read water/riverBank
    // to avoid coastlines) and Jungle (so they can claim a tree-free
    // footprint via keepClear before tree placement runs). Without this
    // order, Jungle.ApplyTreeMask paints trees over the south plateau edge
    // and PlateauCliffs.cellBlocksStamp rejects every candidate fit. See
    // T0.7.6.findings in RandomMapGenerator_Tasks.md.
    //
    // Ice profiles and explicit pre-site cliff profiles are hoisted into
    // Layout.Build so uninterrupted cliffs are planned before clearings and
    // occupied footprints can perforate them. Everything else retains the
    // terrain-time path.
    var profile = pContext && pContext.Profile;
    MapGen.Layout.Reservations.Paths(pContext);
    if(MapGen.Layout.GameplayPlan.Policy(pContext) === "open") {
        var openPlan = MapGen.Context.Time(pContext, "Layout.GameplayPlan", function() {
            return MapGen.Layout.GameplayPlan.Build(pContext);
        });
        if(openPlan && !openPlan.ok) {
            pContext.EarlyRejection = {reason:openPlan.reason};
            return pContext;
        }
    }
    if(pContext.DeferredGameplayRivers) {
        MapGen.Layout.Rivers.Build(pContext);
        MapGen.Layout.Reservations.Apply(pContext);
        MapGen.Terrain.RefreshDerivedLayers(pContext);
        pContext.DeferredGameplayRivers = false;
    }
    if(profile && profile.TerrainType !== Terrain.Types.Ice &&
        profile.CliffLayoutPhase !== true) {
        if(MapGen.Features && MapGen.Features.Plateau)
            MapGen.Features.Plateau.Build(pContext);
        if(MapGen.Features && MapGen.Features.PlateauCliffs)
            MapGen.Features.PlateauCliffs.Build(pContext);
    }

    // Bridges run after Plateau/Cliffs (so cliff footprints are reserved)
    // and before Jungle.Build (so the keepClear bridge stamps survive the
    // tree pass). Bridges only stamp where pContext.Crossings already
    // recorded a vertical-axis crossing — biomes/profiles without crossings
    // or without bridge data fall through cleanly.
    if(MapGen.Features && MapGen.Features.Bridges)
        MapGen.Features.Bridges.Build(pContext);

    var gameplay = MapGen.Context.Time(pContext, "Layout.GameplayPlan", function() {
        return MapGen.Layout.GameplayPlan.Build(pContext);
    });
    if(gameplay && !gameplay.ok) {
        pContext.EarlyRejection = {reason: gameplay.reason};
        return pContext;
    }
    MapGen.Terrain.Cover.Build(pContext);
    MapGen.Layout.GameplayPlan.FinishTerrain(pContext);

    // Architecture v3: the cliff footprint no longer needs re-stamping after the
    // cover pass. SmoothBlockedMaskPass is now owner-aware (keeps blocked where
    // owner==CLIFF && blocked==1), and the tree wipe/IsExcluded already skip
    // owner==CLIFF — so cliff body cells survive Cover.Build intact. The legacy
    // PlateauCliffs.ReassertFootprint hack was removed.

    if(MapGen.Layout && MapGen.Layout.Outcrops)
        MapGen.Layout.Outcrops.ApplyToBlocked(pContext);
    return pContext;
};

MapGen.Terrain.EnforceSoftHazardPolicy = function(pContext) {
    if(MapGen.Terrain.Water && MapGen.Terrain.Water.EnforceSoftHazardPolicy)
        return MapGen.Terrain.Water.EnforceSoftHazardPolicy(pContext);

    return 0;
};

MapGen.Terrain.ResetDerivedLayers = function(pContext) {
    pContext.Layers.riverBank = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
    pContext.Layers.crossing = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
    pContext.Layers.terrainEdge = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
    // forcedBank is set by Water.WidenStepBanks based on neighbour-water state.
    // Repair.TrimWaterCoverage may erase water cells AFTER the first build,
    // leaving stale forcedBank flags whose triggering water no longer exists —
    // these render as phantom ~ banks in pure ground areas. Reset before
    // Water.Build re-runs so widening only fires on the current water layer.
    pContext.Layers.forcedBank = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
};

MapGen.Terrain.RefreshDerivedLayers = function(pContext) {
    this.ResetDerivedLayers(pContext);
    MapGen.Terrain.Water.Build(pContext);
    MapGen.Terrain.Cover.MarkSoftEdges(pContext);
    // SmoothBlockedMask is owner-aware and preserves owner==CLIFF body cells, so
    // no ReassertFootprint is needed after it in the repair loop either.
    MapGen.Terrain.Cover.SmoothBlockedMask(pContext);
    if(MapGen.Layout && MapGen.Layout.Outcrops)
        MapGen.Layout.Outcrops.ApplyToBlocked(pContext);
    this.EnforceSoftHazardPolicy(pContext);
    MapGen.Layout.Reservations.Apply(pContext);
    MapGen.Layout.TerrainSpace.Apply(pContext);
    // Smoothing can regrow cells removed by the preceding repair. Apply the
    // ceiling after that mutation so a repair does not undo its own result.
    if(MapGen.Repair && MapGen.Repair.ThinTreesToTarget)
        MapGen.Repair.ThinTreesToTarget(pContext);
    MapGen.Context.AddLog(pContext, "Refreshed derived terrain layers");
    return pContext;
};
