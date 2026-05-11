// Cliff data shape — consumed by MapGen/Features/PlateauCliffs.js.
//
// Two schema versions are supported. Placer dispatches on SchemaVersion:
//
//   v1 (default, used by Jungle/Desert):
//     Strips:       array of N vertical strips, each [tile_row0, ...].
//                   Placer picks one per output column, deterministically.
//     TopEdge:      flat palette of single tiles above the cliff body.
//     Stairs:       2D [row][col] stamp for a walkway. Tiles walkable.
//     StampHeight:  rows per body strip.
//
//   v2 (Ice — adjacency-aware Wang walker):
//     SchemaVersion: 2
//     Strips:        OBJECT keyed by stable id. Each entry =
//                    { tiles, role, deltaY, weight }.
//                    role ∈ body | leftCap | rightCap | stepDown | stepUp.
//                    deltaY: column-to-column drop applied AFTER stamping
//                    this strip (next column starts at currentTopY+deltaY).
//     Adjacency:     map of stripId -> list of allowed right-neighbour ids.
//     Stairs/etc.:   identical to v1.
//
// Source-of-truth tile data is authored in TileTagger and exported to
// Documentation/Exported/Terrain.<Biome>.Amiga_sub0.js — the values below are
// hand-mirrored from that export. Run Tools/ExportTileGroups.py after editing
// TileGroups.json and reflect any deltas here.

(function() {

    Structures.Jungle.Cliff = {
        StructFindTile: [
            Terrain.Jungle.Mainland.concat(Terrain.Jungle.Borderland),
        ],
        SubVariantsAllowed: ['sub0', 'sub1'],
        Strips: [
            [109, 129, 149, 169, 189],
            [110, 130, 150, 170, 190],
            [111, 131, 151, 171, 191],
            [112, 132, 152, 172, 192],
            [133, 153, 173, 193, 213],
            [134, 154, 174, 194, 214]
        ],
        // The remaining four strips above are authored slope transitions.
        // The v1 jungle placer emits a level, full-width band, so choosing
        // those transition columns at a fixed y produces broken lips and
        // feet. Shipped mapm20 level runs use only A/B, with A -> A/B and
        // B -> A. Keep the complete corpus palette in Strips for future
        // sloped-cliff work and give the flat placer its legal grammar here.
        FlatStrips: [
            [109, 129, 149, 169, 189],
            [110, 130, 150, 170, 190]
        ],
        FlatAdjacency: {
            0: [0, 1],
            1: [0]
        },
        FlatTopEdge: [89, 90],
        TopEdge: [89, 90, 91, 92, 113, 114],
        StampHeight: 5
    };

    // Ice schema v2 — strip palette, weights, and adjacency rules derived
    // from Tools/AnalyzeIceCliffAdjacency.py over shipped maps mapm10/11/14/
    // 15/16/21/22/31/32/33/34/35/36/4/9. Shipped Terrain.Ice.Sub0.CliffBody
    // is 4 rows tall (120/140/160/180 + variants); tile slots 200-204 are
    // the foot-shadow row stamped one cell below each cliff column by
    // PlateauCliffs.OverlayFootShadow (see FootShadow below). StampHeight
    // matches StairsHeight (4) so stair stamps cover the full cliff
    // footprint.
    Structures.Ice.Cliff = {
        StructFindTile: [
            Terrain.Ice.Mainland,
        ],
        SchemaVersion: 2,
        StampHeight: 4,
        Strips: {
            // Body strips only — cap roles are inferred by *position* (first
            // and last column of a segment). Earlier we had separate
            // left_cap/right_cap entries with tile sequences identical to
            // body_v1/body_v2 respectively; that produced visible 2-column
            // dupes at segment edges (e.g. cols 0,1 both showing 120 on
            // seed 3194003987). Shipped analysis confirms the same: there
            // are no visually-distinct cap strips, only inferred roles.
            //
            // Weights chosen to match shipped-map relative frequencies
            // (Tools/Generated/ice-cliff-adjacency.json; body_v0 occurs in
            // 35 columns, body_v1/v2 ~30 each, body_v3 ~25, step_down ~40).
            body_v0:   { tiles: [122, 142, 162, 182], role: "body",     deltaY: 0,  weight: 5 },
            body_v1:   { tiles: [120, 140, 160, 180], role: "body",     deltaY: 0,  weight: 1 },
            body_v2:   { tiles: [123, 143, 163, 183], role: "body",     deltaY: 0,  weight: 3 },
            body_v3:   { tiles: [121, 141, 161, 181], role: "body",     deltaY: 0,  weight: 1 },
            step_down: { tiles: [124, 144, 164, 184], role: "stepDown", deltaY: 1,  weight: 2 },
            // Step-up reuses the body_v1 tile family with deltaY=-1 so each
            // column shifts the band one row up. Verified against mapm15
            // cluster 0 cols 21-26: a clean run of [120,140,160,180]
            // columns each one row higher than the last. mapm15 also shows
            // step_up alternating with deltaY=0 "pause" cols (body_v0/v2/v3);
            // adjacency keeps those edges live so the band can climb
            // gradually instead of strictly monotonically.
            step_up:   { tiles: [120, 140, 160, 180], role: "stepUp",   deltaY: -1, weight: 2 }
        },
        Adjacency: {
            // Shipped adjacency (mapm10/11/14/15/16/21/22/31-36/4/9) with
            // step_up re-enabled so the band can undulate. Tools/Generated/
            // ice-cliff-adjacency.md frequency tables — pairs with non-zero
            // shipped count:
            //
            // dY=0 right-neighbour pairs:
            //   body_v0 -> body_v2     24
            //   body_v3 -> body_v0     19
            //   body_v1 -> body_v3     10
            //   body_v2 -> step_down    6
            //   body_v2 -> body_v3      5
            //   body_v0 -> step_down    5
            //   body_v1 -> body_v0      4
            // dY=+1 (step_down) pairs:
            //   step_down -> step_down 18
            //   step_down -> body_v3    4
            // dY=-1 (step_up) right-neighbour observations from the strip
            // role table (step_up follows body, and chains with itself):
            //   body_v1 -> step_up     12
            //   body_v2 -> step_up      9
            //   body_v3 -> step_up      3
            //   body_v0 -> step_up      2
            //   step_up -> step_up      8
            //   step_up -> body_v1      ~  (post-step_up landing strip)
            //
            // Without step_up, the drift cap (±4) freezes the band flat
            // after the first step_down cascade. With step_up, the band
            // can climb back up and re-fire step_downs — produces visible
            // curves matching shipped.
            body_v0:   ["body_v2", "step_down", "step_up"],
            body_v1:   ["body_v3", "body_v0", "step_up"],
            body_v2:   ["step_down", "body_v3", "step_up"],
            body_v3:   ["body_v0", "step_up"],
            step_down: ["step_down", "body_v3"],
            // step_up shares its tile family with body_v1, so step_up->body_v1
            // would visibly repeat. Pauses use body_v3/v0/v2 instead, matching
            // the alternation observed in mapm15 (col 26->27 step_up->body_v3,
            // 31->32 body_v0->step_up, 35->36 body_v2->step_up).
            step_up:   ["step_up", "body_v3", "body_v0", "body_v2"]
        },
        // No cliff-foot-on-river variants: shipped ice maps never overlap
        // cliffs with water (verified across all 15 ice maps,
        // Tools/Mapm15WaterCliffOverlap.py — zero overlap). Cliff segments
        // route around rivers via per-cell fit rejection in
        // PlateauCliffs.js#columnFitsRiverAware.
        Stairs: [
            [145, 146, 147],
            [165, 166, 167],
            [185, 186, 187],
            [205, 206, 207]
        ],
        StairsWidth: 3,
        StairsHeight: 4,
        // Foot-shadow tiles 200..204 are stamped one cell below each cliff
        // column by PlateauCliffs.OverlayFootShadow. The mapping is
        // deterministic — foot tile = bodyBottomTile + 20 (180→200, 181→201,
        // 182→202, 183→203, 184→204) — verified at 97.8% diagonal correlation
        // across 468 foot occurrences in 15 shipped Amiga ice maps via
        // Tools/Analysis/AnalyzeIceFootShadow.py. The curved step-up/
        // step-down bottoms 228/229 map to 200/204 respectively. No
        // FootShadow palette needed since the
        // selection is fully determined by the strip table above.
        //
        // TopEdge palette: stamp only true plain-snow tiles on the row
        // directly above each cliff-top cell. The broader smoother can still
        // blend snow/ice outside the lip, but cliff caps themselves should not
        // expose ice fragments that read as broken cliff art.
        TopEdge: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]
    };

    // Desert cliff still uses the old monolithic stamp shape. The placer
    // detects this via the absence of `Strips` and falls back to legacy
    // multi-row stamping. Slated for the desert pass alongside the jungle/ice
    // rewrite; biome-specific because desert tiles haven't been re-tagged.
    Structures.Desert.Cliff = {
        StructFindTile: [
            Terrain.Desert.Mainland,
        ],
        Variants: [(function() {
            var rows = [
                [80, 81, 82, 83, 84, 85],
                [100, 101, 102, 103, 104, 105],
                [120, 121, 122, 123, 124, 125],
                [140, 141, 142, 143, 144, 145],
                [160, 161, 162, 163, 164, 165],
                [180, 181, 182, 183, 184, 185],
                [200, 201, 202, 203, 204, 205]
            ];
            var triplets = [];
            for(var r = 0; r < rows.length; ++r)
                for(var c = 0; c < rows[r].length; ++c)
                    triplets.push([c, r, rows[r][c]]);
            return triplets;
        })()]
    };

})();
