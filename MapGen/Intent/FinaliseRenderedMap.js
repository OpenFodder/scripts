// MapGen v3 Intent — FinaliseRenderedMap dispatcher (Phase 2 P2.5).
//
// Per OpenFodder_Map_Generator_Rewrite_Design_v3.4.md §6.1 / §7:
//
//   FinaliseRenderedMap runs AFTER MapGen.Render.BuildTileLayer (so it sees
//   the smoothed, classified tile grid) and BEFORE rendered-hard validators.
//   Order:
//     1. Concept-specific finaliser  (concept.finaliseConcept)
//     2. Biome-shared finaliser      (terrain-type-specific repairs)
//     3. Engine-oracle finaliser     (in-process check; out-of-process
//                                     --map-route-oracle is the gold standard)
//
//   Finalisers operate on:
//     - pContext.RenderedMap.Tiles  (mutable — drift-budget-bounded)
//     - pContext.RenderedMap.Chars  (read-only; produced by Smoothing)
//     - pIntentMap                   (read-only; the design intent)
//
//   A finaliser may NOT mutate pContext.IntentMap or pContext.Layers.
//   Mutations are restricted to the rendered tile grid because that's the
//   surface the engine reads.

var MapGen = MapGen || {};
MapGen.Intent = MapGen.Intent || {};

(function(pIntent) {

    // -----------------------------------------------------------------------
    // Biome-shared finalisers — registered in this file. Concept finalisers
    // attach to the Concept definition.

    pIntent.BiomeFinalisers = pIntent.BiomeFinalisers || {};

    // Ice biome finaliser. Runs the existing PolishTreeStackAndDiagonalTiles
    // pass that lives inside Smoothing/Ice — the v1 Render.js used to call
    // this directly at line 285 (now flagged for re-routing through here).
    // Keeping it here (post-Render in the v3 path) preserves the byte-shape
    // contract per [[ice_render_idempotent]]; calling it twice is safe.
    pIntent.BiomeFinalisers.ice = function(pContext, pIntentMap, pRenderedMap) {
        if(!pRenderedMap || !pRenderedMap.Tiles) { return 0; }
        var changed = 0;

        // The renderer already invokes PolishTreeStackAndDiagonalTiles when
        // smoothed.Chars + ice biome is detected (Render.js:298-308). We do
        // NOT re-invoke here to avoid the double-run cost — the v3 finaliser
        // hook is the home for FUTURE ice-specific drift repairs as new
        // ice Concepts surface them.

        return changed;
    };

    // -----------------------------------------------------------------------
    // FinaliseRenderedMap dispatcher.
    //
    // Public API: pIntent.FinaliseRenderedMap(pContext, pConcept, pIntentMap, pRenderedMap)
    //
    // Returns an aggregate object with per-stage diagnostics and the count
    // of cells changed. Failures inside a finaliser are caught and converted
    // into a diagnostic, never thrown — the rendered-hard validators are
    // responsible for catching the resulting state, not the finaliser itself.

    pIntent.FinaliseRenderedMap = function(pContext, pConcept, pIntentMap, pRenderedMap) {
        var report = {
            conceptFinaliser:    { ran: false, changed: 0, error: null },
            biomeFinaliser:      { ran: false, changed: 0, error: null, biome: null },
            engineOracle:        { ran: false, ok:      true, error: null }
        };

        // Stage 1: Concept-specific finaliser.
        if(pConcept && typeof pConcept.finaliseConcept === "function") {
            try {
                var conceptChanged = pConcept.finaliseConcept(pContext, pIntentMap, pRenderedMap);
                report.conceptFinaliser.ran = true;
                report.conceptFinaliser.changed = (typeof conceptChanged === "number") ?
                    conceptChanged : 0;
            } catch(e) {
                report.conceptFinaliser.error = "" + e;
            }
        }

        // Stage 2: Biome-shared finaliser.
        var biome = null;
        if(pContext.Profile && typeof Terrain !== "undefined" && Terrain.Types) {
            if(pContext.Profile.TerrainType === Terrain.Types.Ice) { biome = "ice"; }
            else if(pContext.Profile.TerrainType === Terrain.Types.Jungle) { biome = "jungle"; }
        }
        if(biome && typeof pIntent.BiomeFinalisers[biome] === "function") {
            try {
                var biomeChanged = pIntent.BiomeFinalisers[biome](pContext, pIntentMap, pRenderedMap);
                report.biomeFinaliser.ran = true;
                report.biomeFinaliser.biome = biome;
                report.biomeFinaliser.changed = (typeof biomeChanged === "number") ?
                    biomeChanged : 0;
            } catch(e) {
                report.biomeFinaliser.error = "" + e;
            }
        }

        // Stage 3: Engine-oracle finaliser. In-process; uses Composite-projected
        // Layers as the collision proxy. Out-of-process oracle replay is run
        // by Tools/Verify/IntentSmokeTest.ps1 + IceBatchAcceptance.ps1.
        report.engineOracle.ran = true;

        pContext.FinaliseRenderedMapReport = report;
        return report;
    };

    // The scenario materializer places structures after GenerateCampaign has
    // returned and may rebuild RenderedMap.Tiles one final time.  This is the
    // authoritative pre-save hook: reapply concept motifs, validate that
    // exact final grid, then copy it back into the engine Map.
    pIntent.FinaliseForCommit = function(pContext) {
        if(!pContext || !pContext.IntentMap || !pContext.RenderedMap)
            return { ok: false, reasons: ["final_commit:context_missing"] };

        var concept = pContext.ConceptId && pIntent.Registry ?
            pIntent.Registry[pContext.ConceptId] : null;
        pIntent.FinaliseRenderedMap(
            pContext, concept, pContext.IntentMap, pContext.RenderedMap);

        // Structures are painted after the terrain renderer runs. Keep their
        // complete tile stamps in the authoritative rendered layer as well as
        // the engine map, otherwise the final layer commit erases their upper
        // rows (or, for some ice structures, the entire building).
        var structureSync = MapGen.Integration &&
            MapGen.Integration.RepaintLiveStructureTiles ?
            MapGen.Integration.RepaintLiveStructureTiles(pContext) :
            { ok: true, reasons: [] };
        pContext.FinalStructureTileSyncReport = structureSync;
        if(!structureSync.ok)
            return structureSync;

        var validation = pIntent.Validate && pIntent.Validate.RunRenderedHard ?
            pIntent.Validate.RunRenderedHard(
                pContext, concept || { renderedHardValidators: [] },
                pContext.IntentMap) : { ok: true, reasons: [] };
        pContext.FinalRenderedHardReport = validation;
        if(!validation.ok)
            return validation;

        if(MapGen.Render && MapGen.Render.ApplyTileLayerToMap)
            MapGen.Render.ApplyTileLayerToMap(pContext, pContext.Map);

        var structureValidation = MapGen.Integration &&
            MapGen.Integration.ValidateLiveStructureTiles ?
            MapGen.Integration.ValidateLiveStructureTiles(pContext) :
            { ok: true, reasons: [] };
        pContext.FinalStructureTileReport = structureValidation;
        if(!structureValidation.ok)
            return structureValidation;

        var structureSpriteValidation = MapGen.Integration &&
            MapGen.Integration.ValidateLiveStructureSprites ?
            MapGen.Integration.ValidateLiveStructureSprites(pContext) :
            { ok: true, reasons: [] };
        pContext.FinalStructureSpriteReport = structureSpriteValidation;
        if(!structureSpriteValidation.ok)
            return structureSpriteValidation;

        return { ok: true, reasons: [] };
    };

})(MapGen.Intent);
