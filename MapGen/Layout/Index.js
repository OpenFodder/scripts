var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

(function() {

    function callTemplate(pContext, pMethod) {
        var templates = MapGen.Layout.Templates;
        var template = templates ? templates.Resolve(pContext) : null;
        var classic = templates ? templates.Get("classic") : null;

        if(template && typeof template[pMethod] === "function") {
            template[pMethod](pContext);
            return;
        }

        if(classic && typeof classic[pMethod] === "function")
            classic[pMethod](pContext);
    }

    function planSites(pContext) {
        if(MapGen.Layout.CriticalSites)
            MapGen.Layout.CriticalSites.Build(pContext);
    }

    function applyGrammarBeachAnchors(pContext) {
        if(MapGen.Layout.Anchors &&
            MapGen.Layout.Anchors.IsGrammarBeachCampaign &&
            MapGen.Layout.Anchors.IsGrammarBeachCampaign(pContext) &&
            MapGen.Layout.Anchors.BuildGrammarBeachCampaign)
            MapGen.Layout.Anchors.BuildGrammarBeachCampaign(pContext);
    }

    // Architecture v3: ONE layout pipeline. Layout/terrain are mode-agnostic;
    // the only campaign/MP difference is which ANCHORS get placed (and the
    // campaign-only beach-anchor + coast-landing nudge, both internally gated).
    // Everything else — continent, skeleton route reserve, coast water, rivers,
    // edge biomes, clearings, outcrops — is identical and defined once here.
    MapGen.Layout.Build = function(pContext) {
        var multiplayer = MapGen.Context.IsMultiplayer(pContext);
        MapGen.Layout.RegionIntents.Prepare(pContext);

        if(MapGen.Layout.Archipelago)
            MapGen.Layout.Archipelago.Build(pContext);
        if(MapGen.Layout.Continent)
            MapGen.Layout.Continent.Build(pContext);

        if(!MapGen.Layout.RegionIntents.PlaceAnchors(pContext))
            callTemplate(pContext, multiplayer ? "BuildAnchorsMultiplayer" : "BuildAnchorsCampaign");
        // grammar_beach campaign anchors (internally gated; no-op otherwise).
        if(!multiplayer)
            applyGrammarBeachAnchors(pContext);

        MapGen.Variation.MoveAnchors(pContext);

        // Keep authored campaign clearings apart before the skeleton route
        // consumes their neighborhoods. Jungle anchors may collapse onto one
        // another after land snapping; ice and grammar-beach layouts retain
        // their authored geometry and are excluded by the repair itself.
        if(!multiplayer && MapGen.Layout.Anchors &&
            MapGen.Layout.Anchors.RepairCampaignSpacing)
            MapGen.Layout.Anchors.RepairCampaignSpacing(pContext);

        // Region-intent reservation: a layout template may now claim macro
        // STRUCTURE / TREE / WATER regions on the owner grid based on the
        // anchors it just placed. Skeleton then routes around those claims the
        // same way it routes around pre-claimed water bodies. No-op unless the
        // active template defines BuildRegionIntents.
        if(MapGen.Layout.RegionIntents)
            MapGen.Layout.RegionIntents.Build(pContext);

        // Reserve the anchor corridor as ROUTE ownership BEFORE any water is
        // placed, so macro water carves around the critical spine.
        if(MapGen.Layout.Skeleton)
            MapGen.Layout.Skeleton.Build(pContext);

        // Coast water edge; campaign additionally nudges the start onto the
        // landing (the sole terrain-level mode difference, anchor-driven).
        if(MapGen.Layout.Coast)
            MapGen.Layout.Coast.Build(pContext, { multiplayer: multiplayer });

        if(MapGen.Layout.EdgeBiomes)
            MapGen.Layout.EdgeBiomes.Build(pContext);
        if(MapGen.Layout.GameplayPlan.Policy(pContext) === "open" && !multiplayer)
            pContext.DeferredGameplayRivers = true;
        else
            MapGen.Layout.Rivers.Build(pContext);
        if(MapGen.Layout.Continent && MapGen.Layout.Continent.Finalise)
            MapGen.Layout.Continent.Finalise(pContext);

        if(!multiplayer)
            applyGrammarBeachAnchors(pContext);

        // Bank marking + crossings + step-bank widening run here (was in
        // Terrain.Water.Build). Hoisted 2026-06-15 ([[mapgen_cliff_edge_to_edge]]
        // Slice 1A) so riverBank/forcedBank are populated before Connectivity
        // (which reads them at Connectivity.js:423,508) and before the ice-
        // only Plateau hoist (Slice 1B) which needs riverBank to avoid
        // coastlines.
        if(MapGen.Terrain && MapGen.Terrain.Water)
            MapGen.Terrain.Water.Build(pContext);

        // Plateau + PlateauCliffs run here for ICE profiles and profiles whose
        // cliff grammar explicitly requires an uninterrupted pre-site band.
        // Jungle's shipped cliff formations span the full map width, so the
        // old terrain-time pass (after paths/clearings) could only emit the
        // broken rectangular fragments seen in generated classic maps.
        //
        // Ice profiles use this phase for their edge-to-edge drifting cliffs;
        // full-width jungle cliffs use it for one flat uninterrupted band.
        // (Slice 1B,
        // 2026-06-15 [[mapgen_cliff_edge_to_edge]]). Ice's binding constraint
        // is that cliffs span edge-to-edge; achieving that requires Plateau
        // to see only water + Skeleton ROUTE corridor as blockers (not
        // keepClear/path/occupied from gameplay infra). For non-ice profiles
        // (jungle, desert, beach), Plateau runs from its original Terrain.
        // Build call site — the binding constraint doesn't apply there and
        // hoisting destabilises tree-coverage budgets.
        if(pContext.Profile &&
            (pContext.Profile.TerrainType === Terrain.Types.Ice ||
                pContext.Profile.CliffLayoutPhase === true)) {
            // Cliff reservation (Option A, ice-only): pick a bandY whose
            // stampHeight strip is ALREADY clear of all 8 cellBlocksStamp
            // reject layers (water/riverBank/forcedBank/coast/lakeShore/
            // keepClear/crossing/path), AFTER all water passes have laid
            // their hazards. Plateau then short-circuits to that bandY
            // ([[mapgen_cliff_option_a_staged]]).
            //
            // Why post-water (not pre-water): an early reservation forces
            // water to route around the strip, which pushes water toward
            // fewer perimeter edges and fails Validate.WaterCompositionTargets
            // on ~62% of seeds (frame_silhouette landRun > 0.30). Selecting
            // the bandY post-water is non-disruptive — water is unchanged,
            // and we're picking the LEAST-CLAIMED row rather than carving.
            //
            // Skeleton/Coast/Water guards still consult cliffReserve (no-op
            // here since reservation is empty during their passes) and the
            // ProtectReservedCliff cleanup remains a defence-in-depth pass
            // for any future reordering. The bool layer existing but being
            // empty during those passes is harmless — Get returns 0.
            if(MapGen.Layout.CliffReservation)
                MapGen.Layout.CliffReservation.Build(pContext);
            if(MapGen.Features && MapGen.Features.Plateau)
                MapGen.Features.Plateau.Build(pContext);
            if(MapGen.Features && MapGen.Features.PlateauCliffs)
                MapGen.Features.PlateauCliffs.Build(pContext);
        }

        planSites(pContext);
        if(MapGen.Layout.DefensiveLines)
            MapGen.Layout.DefensiveLines.Build(pContext);
        MapGen.Layout.Clearings.Build(pContext);
        if(MapGen.Layout.Outcrops)
            MapGen.Layout.Outcrops.Build(pContext);
        return pContext;
    };
})();
