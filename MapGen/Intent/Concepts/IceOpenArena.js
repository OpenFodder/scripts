var MapGen = MapGen || {};
MapGen.Intent = MapGen.Intent || {};
MapGen.Intent.Concepts = MapGen.Intent.Concepts || {};

// MapGen.Intent.Concepts.IceOpenArena — ice fallback Concept (Phase 2 P2.2).
//
// Per OpenFodder_Map_Generator_Rewrite_Design_v3.4.md §9.1, ice_open_arena
// is the universal fallback for ice profiles when no other Concept's
// appliesTo() matches. Phase 2 acceptance (§11 line 1051) requires this
// Concept to render without crash and the player/squad start + objective +
// route to land on walkable rendered terrain.
//
// Author strategy:
//   - Keep a LAND interior region with safe margin from the perimeter
//     so the ice atlas's perimeter water band doesn't overlap anchor cells.
//   - Stamp a 3-cell-thick ROUTE_PRIMARY band along midY through that
//     interior, with KEEP_CLEAR and WALKABLE bits set.
//   - Place SPAWN at near edge of interior, OBJECTIVE at far edge of
//     interior, both with SPAWN_SAFE / OBJECTIVE claims and a 5x5
//     KEEP_CLEAR halo so the ice perimeterCover smoothing pass (which
//     reads keepClear) does not paint trees over the spawn pads.
//   - Reserve only the route and anchor pads; the surrounding arena remains
//     eligible for sparse, renderable cover.
//
// This is intentionally minimal — Phase 2 acceptance is "renders without
// crash, anchors walkable, route reachable", NOT shipped-corpus parity.
// Concept-specific shape calibration lands in Phase 3.

(function(pIntent) {

    var T = pIntent.Terrain;
    var M = pIntent.Movement;
    var C = pIntent.Claim;
    var O = pIntent.Owner;

    // Ice perimeter water band is up to 4 cells thick on shipped maps; reserve
    // a 5-cell safe margin so the spawn pads + route never overlap the
    // wang-atlas water/snow seam. Calibration: shipped grammar_ice 72x56
    // maps in MapDumps_Originals show a 3..4 cell water rim.
    var PERIMETER_MARGIN = 5;

    // Spawn pad halo radius. The ice perimeterCover pass paints shoulder
    // trees within ~3 cells of perimeter; reserving 2 cells around the
    // spawn keeps the pad clean per [[ice_render_idempotent]].
    var SPAWN_HALO = 2;

    function authorIceOpenArena(pPlan, pIntentMap, pRngs) {
        var W = pIntentMap.width;
        var H = pIntentMap.height;

        if(W < (PERIMETER_MARGIN * 2 + 8) || H < (PERIMETER_MARGIN * 2 + 6)) {
            return pIntent.AuthorResult.Fail(
                pIntent.AuthorReason.InsufficientOpenArea,
                [pIntent.AuthorResult.Diagnostic(
                    "ice_open_arena.author",
                    "IntentMap too small after PERIMETER_MARGIN=" + PERIMETER_MARGIN +
                    ": " + W + "x" + H
                )]
            );
        }

        var interiorMinX = PERIMETER_MARGIN;
        var interiorMaxX = W - 1 - PERIMETER_MARGIN;
        var interiorMinY = PERIMETER_MARGIN;
        var interiorMaxY = H - 1 - PERIMETER_MARGIN;
        var midY = Math.floor((interiorMinY + interiorMaxY) / 2);

        // 1. Mark the interior walkable without blanket-reserving it.
        // RESERVED projects to keepClear, so claiming every cell here would
        // force the fallback map to be a featureless rectangle.
        var interiorCells = 0;
        for(var y = interiorMinY; y <= interiorMaxY; ++y) {
            for(var x = interiorMinX; x <= interiorMaxX; ++x) {
                pIntent.Map.AddMovement(pIntentMap, x, y, M.WALKABLE);
                ++interiorCells;
            }
        }

        // 2. Route: stamp a 3-cell-thick ROUTE_PRIMARY band across midY.
        var stamped = 0;
        for(var rx = interiorMinX; rx <= interiorMaxX; ++rx) {
            for(var dy = -1; dy <= 1; ++dy) {
                var ry = midY + dy;
                if(ry < interiorMinY || ry > interiorMaxY) { continue; }
                pIntent.Map.AddMovement(pIntentMap, rx, ry,
                    M.ROUTE_PRIMARY | M.WALKABLE | M.KEEP_CLEAR);
                ++stamped;
            }
        }
        if(stamped < ((interiorMaxX - interiorMinX) * 3 / 2)) {
            return pIntent.AuthorResult.Fail(
                pIntent.AuthorReason.NoValidTransit,
                [pIntent.AuthorResult.Diagnostic(
                    "ice_open_arena.author",
                    "route stamp produced only " + stamped + " cells"
                )]
            );
        }

        // 3. Spawn pads with SPAWN_HALO (5x5 by default at radius=2).
        function stampAnchor(cx, cy, ownerVal, anchorClaim) {
            for(var dx = -SPAWN_HALO; dx <= SPAWN_HALO; ++dx) {
                for(var dy = -SPAWN_HALO; dy <= SPAWN_HALO; ++dy) {
                    var ax = cx + dx;
                    var ay = cy + dy;
                    pIntent.Map.AddClaim(pIntentMap, ax, ay, C.SPAWN_SAFE);
                    pIntent.Map.AddMovement(pIntentMap, ax, ay,
                        M.WALKABLE | M.KEEP_CLEAR);
                }
            }
            // Centre cell carries the actual anchor claim + owner.
            pIntent.Map.AddClaim(pIntentMap, cx, cy, anchorClaim);
            pIntent.Map.SetOwner(pIntentMap, cx, cy, ownerVal);
        }
        var startX = interiorMinX + SPAWN_HALO;
        var endX   = interiorMaxX - SPAWN_HALO;
        stampAnchor(startX, midY, O.PLAYER_SPAWN, C.SPAWN_SAFE);
        // Phase 3 P3.8: don't stamp C.OBJECTIVE — see IceForestCorridor note.
        stampAnchor(endX,   midY, O.STRUCTURE,   C.SPAWN_SAFE);

        // 4. Region log.
        pIntentMap.regions = pIntentMap.regions || [];
        pIntentMap.regions.push({
            id: "open_arena.interior",
            kind: "interior",
            cells: interiorCells
        });
        pIntentMap.regions.push({
            id: "open_arena.center_route",
            kind: "route",
            cells: stamped
        });

        // 5. Anchor side-channel for Encounters / sprite emission.
        pIntentMap.anchors = pIntentMap.anchors || {};
        pIntentMap.anchors.start     = { x: startX, y: midY };
        pIntentMap.anchors.objective = { x: endX,   y: midY };

        return pIntent.AuthorResult.Ok([
            pIntent.AuthorResult.Diagnostic(
                "ice_open_arena.author",
                "interior=" + interiorCells + " cells, route=" + stamped + " cells, " +
                "start=(" + startX + "," + midY + "), " +
                "objective=(" + endX + "," + midY + ")"
            )
        ]);
    }

    if(pIntent.RegisterConcept) {
        pIntent.RegisterConcept({
            id: "ice_open_arena",
            biome: "ice",
            appliesTo: function(pProfile, pDimensions) {
                if(!pProfile) { return false; }
                if(pProfile.TerrainType !== undefined && (typeof Terrain !== "undefined")) {
                    if(pProfile.TerrainType !== Terrain.Types.Ice) { return false; }
                }
                return true;
            },
            author: authorIceOpenArena,
            intentHardValidators: [],
            intentQualityValidators: [],
            renderedHardValidators: [],
            driftBudget: {
                landIntentSolidMaxFraction: 0.10
            },
            finaliseConcept: function(pContext, pIntentMap, pRenderedMap) { return 0; }
        });
    }

    pIntent.Concepts.IceOpenArena = {
        author: authorIceOpenArena
    };

})(MapGen.Intent);
