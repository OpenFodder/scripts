var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// Architecture v3.5 — region-intent reservation hook.
//
// Per [[mapgen_quality_ceiling]]: per-cell dial tuning hit a ceiling because
// shipped maps were authored with MACRO intent ("this region is a compound",
// "this region is a forest mass") and the generator had no primitive that
// represented region intent at that scale. Layout templates only place 3-5
// anchors and let everything between them be statistical fill, which is what
// produces the "boring" feature_cell_fraction gap (gen p50=0.42 vs shipped
// p50=0.71 measured across 16 ice seeds 2026-06-14).
//
// This module runs between Anchors and Skeleton. If the active layout template
// defines BuildRegionIntents(pContext), the template is given a chance to
// reserve macro regions as STRUCTURE / TREE / WATER ownership BEFORE the
// gameplay skeleton is laid down — so the route, water carving, tree growth
// and structure placement passes all compose around the macro intent instead
// of producing scatter.
//
// Slice 1 (this file): orchestrator only. With no template defining
// BuildRegionIntents yet, this is byte-identical no-op (RegressionGate stays
// GREEN). Slice 2 will add the first concrete template.
//
// The hook lives BEFORE Skeleton and AFTER Anchors so a template can:
//   - Read pContext.Anchors to know start/objective/support positions,
//   - Claim STRUCTURE / TREE / WATER cells on the owner grid with ClaimCell,
//   - Push a Regions entry recording the reserved rect for downstream code,
// and Skeleton's corridor reservation (which only claims OPEN cells) will
// route AROUND those claims instead of through them — same mechanism as the
// route avoiding pre-claimed water bodies today.
MapGen.Layout.RegionIntents = {

    Build: function(pContext) {
        if(!MapGen.Layout.Templates || !MapGen.Layout.Templates.Resolve)
            return pContext;

        var template = MapGen.Layout.Templates.Resolve(pContext);
        if(!template || typeof template.BuildRegionIntents !== "function")
            return pContext;

        template.BuildRegionIntents(pContext);
        return pContext;
    }
};
