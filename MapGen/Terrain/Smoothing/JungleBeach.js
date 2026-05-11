var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};

MapGen.Terrain.Smoothing.JungleBeach = {

    ReferenceProfiles: {
        // Mapm5 is the longest shipped sub1 jungle beach bank. Its bank-width
        // profile lets generated beaches follow the original taper without
        // copying absolute map coordinates.
        mapm5: {
            source: "Run/Data/Amiga/mapm5.map",
            rows: [
                [252, 257, 256, 256, 258, 278],
                [292, 256, 257, 293],
                [255, 257, 257, 256, 295],
                [275, 277, 257, 256, 258, 278],
                [252, 257, 257, 257, 293],
                [272, 257, 257, 257, 294],
                [292, 257, 257, 257, 295],
                [255, 257, 256, 257, 279],
                [255, 257, 257, 257, 293],
                [275, 276, 277, 257, 256, 257, 257, 294],
                [252, 257, 257, 257, 257, 257, 256, 257, 295],
                [272, 257, 257, 324, 256, 257, 258, 278],
                [292, 257, 256, 256, 257, 279],
                [252, 257, 256, 257, 257, 279],
                [272, 256, 257, 258, 278],
                [272, 256, 279],
                [292, 279],
                [279]
            ],
            bankWidths: [4, 4, 4, 4, 4, 4, 5, 4, 4, 6, 8, 6, 6, 5, 3, 2, 2, 1]
        }
    },

    BankWidthProfile: function() {
        return this.ReferenceProfiles.mapm5.bankWidths;
    },

    WaterEdgeTemplates: function() {
        return [
            { offset: 0, sand: [275, 276, 313, 314], water: [243, 317, 317] },
            { offset: 0, sand: [275, 276, 277, 257, 324, 279, 315], water: [317, 317, 316] },
            { offset: -2, sand: [255, 257, 257, 257, 257, 293], water: [297, 297, 317] },
            { offset: -2, sand: [275, 277, 257, 257, 256, 257, 257, 295], water: [317, 317, 316] },
            { offset: -3, sand: [255, 256, 257, 256, 257, 258, 259, 278], water: [317, 298, 298] },
            { offset: -6, sand: [252, 257, 257, 257, 293], water: [297, 298, 297] },
            { offset: -6, sand: [272, 257, 257, 257, 294], water: [297, 297, 297] },
            { offset: -6, sand: [292, 257, 257, 257, 295], water: [297, 297, 298] },
            { offset: -7, sand: [255, 257, 256, 257, 279], water: [297, 297, 298] },
            { offset: -8, sand: [255, 257, 257, 257, 293], water: [297, 298, 298] },
            { offset: -8, sand: [275, 276, 277, 257, 256, 257, 257, 294], water: [297, 297, 297] },
            { offset: -8, sand: [252, 257, 257, 257, 257, 257, 256, 257, 295], water: [297, 298, 298] },
            { offset: -9, sand: [272, 257, 257, 324, 256, 257, 258, 278], water: [297, 298, 297] },
            { offset: -11, sand: [292, 257, 256, 256, 257, 279], water: [297, 298, 298] },
            { offset: -12, sand: [252, 257, 256, 257, 257, 279], water: [297, 297, 297] },
            { offset: -13, sand: [272, 256, 257, 258, 278], water: [297, 297, 298] },
            { offset: -15, sand: [272, 256, 279], water: [297, 297, 298] },
            { offset: -16, sand: [292, 279], water: [297, 297, 298] },
            { offset: -17, sand: [335, 279], water: [297, 297, 298] }
        ];
    },

    // Top-entry beach/river bank from shipped mapm5, normalized from source
    // x=11..37. Only the active sand/water seam and one supporting grass cell
    // on either side are retained, so the motif can move horizontally.
    Mapm5TopBankTileTemplate: function() {
        return {
            rows: [
                { x: 12, classes: "GSSSSWWWWWWG", tiles: [252, 257, 256, 256, 258, 278, 297, 297, 297, 298, 298, 362] },
                { x: 11, classes: "GSSSSWWWWWWWG", tiles: [124, 292, 256, 257, 293, 297, 297, 297, 298, 297, 297, 297, 382] },
                { x: 11, classes: "GSSSSWWWWWWG", tiles: [255, 257, 257, 256, 295, 298, 298, 298, 298, 298, 298, 362] },
                { x: 9, classes: "GSSSSWWWWWWWWG", tiles: [275, 277, 257, 256, 258, 278, 297, 298, 298, 297, 298, 297, 297, 381] },
                { x: 8, classes: "GSSSSWWWWWWWWWG", tiles: [252, 257, 257, 257, 293, 297, 298, 297, 297, 297, 297, 298, 298, 297, 380] },
                { x: 8, classes: "GSSSSWWWWWWWWWG", tiles: [272, 257, 257, 257, 294, 297, 297, 297, 298, 297, 298, 297, 297, 297, 382] },
                { x: 7, classes: "GSSSSSWWWWWWG", tiles: [124, 292, 257, 257, 257, 295, 297, 297, 298, 297, 297, 297, 360] },
                { x: 7, classes: "GSSSSWWWWWWG", tiles: [255, 257, 256, 257, 279, 297, 297, 298, 297, 298, 298, 341] },
                { x: 6, classes: "GSSSSWWWWWWG", tiles: [255, 257, 257, 257, 293, 297, 298, 298, 298, 298, 297, 362] },
                { x: 4, classes: "GSSSSSSWWWWWWG", tiles: [276, 277, 257, 256, 257, 257, 294, 297, 297, 297, 298, 298, 297, 382] },
                { x: 2, classes: "GSSSSSSSSWWWWWG", tiles: [252, 257, 257, 257, 257, 257, 256, 257, 295, 297, 298, 298, 297, 297, 362] },
                { x: 2, classes: "GSSGSSSWWWWWWWG", tiles: [272, 257, 257, 324, 256, 257, 258, 278, 297, 298, 297, 297, 298, 297, 382] },
                { x: 1, classes: "GSSSSSSWWWWWWG", tiles: [85, 292, 257, 256, 256, 257, 279, 297, 298, 298, 297, 297, 298, 360] },
                { x: 1, classes: "GSSSSSWWWWWWG", tiles: [252, 257, 256, 257, 257, 279, 297, 297, 297, 298, 297, 298, 340] },
                { x: 1, classes: "GSSSWWWWWWG", tiles: [272, 256, 257, 258, 278, 297, 297, 298, 297, 297, 360] },
                { x: 1, classes: "GSSWWWWWWG", tiles: [272, 256, 279, 297, 297, 298, 298, 297, 297, 362] },
                { x: 0, classes: "GSSWWWWWWWG", tiles: [123, 292, 279, 297, 297, 298, 297, 298, 298, 297, 384] },
                { x: 0, classes: "GSWWWWWWG", tiles: [335, 279, 297, 297, 298, 298, 297, 298, 360] },
                { x: 0, classes: "GWWWWWWWG", tiles: [355, 297, 298, 298, 298, 297, 297, 297, 323] }
            ]
        };
    },

    // Shipped mapm5 rows immediately following Mapm5TopBankTileTemplate.
    // These are the legal river continuation pieces used after the sand has
    // tapered away. `x` remains relative to the same template origin.
    Mapm5RiverContinuationTileTemplate: function() {
        return { rows: [
            { x: 0, classes: "GWWWWWWWWG", tiles: [280, 297, 297, 297, 298, 298, 298, 297, 297, 360] },
            { x: 0, classes: "GWWWWWWWG", tiles: [301, 297, 297, 297, 298, 297, 298, 297, 341] },
            { x: 0, classes: "GWWWWWWG", tiles: [302, 297, 298, 298, 297, 297, 297, 340] },
            { x: 0, classes: "GWWWWWWG", tiles: [283, 297, 297, 298, 297, 298, 298, 364] },
            { x: 1, classes: "GWWWWWG", tiles: [342, 297, 297, 297, 297, 297, 284] },
            { x: 2, classes: "GWWWWG", tiles: [282, 297, 298, 298, 297, 384] },
            { x: 2, classes: "GWWWWG", tiles: [283, 297, 297, 297, 298, 362] },
            { x: 3, classes: "GWWWG", tiles: [282, 297, 297, 298, 384] },
            { x: 3, classes: "GWWWWG", tiles: [280, 297, 298, 297, 297, 323] },
            { x: 3, classes: "GWWWWWG", tiles: [301, 297, 298, 297, 297, 297, 322] },
            { x: 3, classes: "GWWWWWWG", tiles: [302, 297, 298, 298, 297, 297, 297, 364] },
            { x: 3, classes: "GWWWWWWG", tiles: [280, 297, 297, 298, 298, 297, 297, 381] },
            { x: 3, classes: "GWWWWWWG", tiles: [300, 297, 297, 297, 297, 298, 297, 384] },
            { x: 2, classes: "GWWWWWWWWG", tiles: [264, 297, 298, 298, 298, 297, 298, 298, 297, 364] },
            { x: 1, classes: "GWWWWWWWWWG", tiles: [260, 297, 297, 297, 297, 298, 298, 297, 297, 297, 384] },
            { x: 1, classes: "GWWWWWWWWWWG", tiles: [302, 297, 297, 298, 298, 298, 298, 298, 297, 297, 297, 323] },
            { x: 1, classes: "GWWWWWWWWWWWG", tiles: [300, 297, 298, 297, 298, 297, 297, 298, 298, 297, 298, 297, 320] },
            // A vertical bridge obscures three source columns in these rows.
            // Restore plain water beneath that object and retain the observed
            // far bank, so terrain stamping cannot copy an orphan bridge edge.
            { x: 0, classes: "GWWWWWWWWWWWWWWWWWWWWWG", tiles: [244, 297, 297, 297, 297, 298, 297, 298, 298, 297, 297, 298, 297, 297, 297, 297, 297, 297, 298, 297, 298, 297, 320] },
            { x: 1, classes: "GWWWWWWWWWWWWWWWWWWWWWWWG", tiles: [342, 297, 298, 298, 297, 297, 298, 298, 298, 298, 298, 298, 297, 297, 297, 297, 297, 297, 298, 297, 297, 298, 298, 297, 364] },
            { x: 2, classes: "GWWWWWWWWWWWWWWWWWWWWWWG", tiles: [282, 297, 297, 298, 297, 297, 298, 297, 298, 297, 297, 297, 298, 297, 297, 298, 298, 297, 298, 297, 297, 298, 297, 382] },
            { x: 2, classes: "GWWWWWWWWWWWWWWWWWWWWWWG", tiles: [280, 297, 297, 298, 298, 297, 297, 297, 297, 297, 298, 297, 297, 297, 298, 297, 297, 298, 297, 298, 297, 297, 297, 323] },
            { x: 2, classes: "GWWWWWWWWWWWWWWWWWWWWWWWG", tiles: [300, 297, 297, 298, 298, 297, 297, 297, 298, 298, 298, 298, 297, 298, 298, 297, 298, 297, 298, 297, 297, 297, 297, 297, 320] },
            { x: 3, classes: "GWWWWWWWWWWWWWWWWWWWWWWWWWWG", tiles: [263, 297, 298, 298, 297, 297, 297, 298, 297, 297, 297, 297, 298, 297, 297, 297, 298, 297, 298, 298, 297, 297, 297, 297, 297, 297, 297, 364] },
            { x: 4, classes: "GWWWWWWWWWWWWWWWWWWWWWWWWWG", tiles: [282, 298, 297, 298, 297, 298, 298, 297, 297, 297, 297, 297, 297, 297, 298, 297, 298, 298, 298, 298, 297, 297, 297, 297, 298, 297, 382] },
            { x: 4, classes: "GWWWWWWWWWWWWWWWWWWWWWWWWG", tiles: [283, 297, 297, 297, 297, 297, 298, 298, 297, 297, 297, 297, 297, 298, 297, 297, 298, 297, 298, 298, 298, 297, 298, 297, 297, 362] },
            { x: 5, classes: "GWWWWWWWWWWWWWWWWWWWWWWWG", tiles: [263, 297, 297, 297, 297, 297, 297, 297, 297, 297, 297, 297, 298, 298, 297, 297, 297, 297, 298, 297, 297, 298, 298, 297, 384] },
            { x: 11, classes: "GWWWWWWWWWWWWWWWWWWG", tiles: [282, 297, 297, 297, 297, 298, 298, 297, 298, 297, 297, 297, 297, 297, 297, 297, 298, 297, 297, 322] },
            { x: 11, classes: "GWWWWWWWWWWWWWWWWWWWG", tiles: [283, 297, 297, 298, 297, 297, 298, 297, 297, 297, 298, 298, 297, 298, 298, 298, 298, 297, 297, 297, 320] },
            { x: 12, classes: "GWWWWWWWWWWWWWWWWWWWWWWG", tiles: [263, 297, 297, 297, 297, 297, 297, 298, 297, 297, 298, 297, 297, 297, 297, 297, 297, 298, 297, 297, 298, 297, 297, 320] },
            { x: 16, classes: "GWWWWWWWWWWWWWWWWWWWWG", tiles: [344, 297, 297, 297, 297, 298, 298, 298, 297, 298, 298, 297, 297, 298, 297, 297, 297, 297, 297, 297, 297, 322] },
            { x: 18, classes: "GWWWWWWWWWWWWWWWWWWWG", tiles: [344, 297, 297, 297, 297, 297, 298, 297, 297, 297, 298, 298, 297, 298, 298, 297, 298, 297, 297, 297, 364] },
            { x: 19, classes: "GWWWWWWWWWWWWWWWWWWG", tiles: [282, 297, 298, 297, 297, 297, 297, 297, 297, 297, 298, 297, 297, 297, 298, 297, 297, 297, 297, 384] },
            { x: 19, classes: "GWWWWWWWWWWWWWWWWWWWG", tiles: [283, 297, 297, 297, 297, 298, 297, 297, 297, 298, 297, 297, 298, 297, 297, 298, 297, 298, 297, 297, 323] }
        ] };
    },

    // Exact mapm8 bottom-right cove rows (source x=34..49, y=30..44).
    // `starts` excludes unrelated grass decoration while retaining the mixed
    // grass/sand/water tiles that actually form each side of the seam.
    Mapm8CornerCoveTileTemplate: function() {
        return {
            starts: [14, 13, 13, 14, 14, 14, 13, 13, 9, 6, 5, 3, 2, 1, 0],
            rows: [
                [0, 19, 0, 19, 0, 19, 67, 68, 68, 75, 67, 68, 75, 225, 275, 277],
                [40, 38, 0, 19, 8, 19, 19, 18, 0, 38, 19, 38, 19, 252, 257, 324],
                [225, 229, 18, 19, 40, 0, 38, 18, 19, 18, 38, 0, 225, 337, 257, 257],
                [140, 69, 20, 38, 18, 225, 229, 0, 40, 10, 18, 19, 124, 88, 336, 279],
                [68, 20, 38, 20, 0, 58, 68, 40, 18, 19, 229, 185, 124, 123, 355, 362],
                [69, 0, 40, 10, 18, 67, 20, 19, 38, 225, 124, 225, 124, 124, 300, 381],
                [205, 128, 229, 20, 0, 40, 38, 225, 124, 124, 124, 124, 123, 260, 317, 382],
                [124, 124, 68, 0, 40, 0, 229, 124, 124, 87, 123, 124, 88, 283, 317, 323],
                [68, 48, 124, 229, 229, 225, 124, 124, 123, 275, 276, 313, 314, 243, 317, 317],
                [229, 20, 48, 48, 87, 124, 275, 276, 277, 257, 324, 279, 315, 317, 317, 316],
                [124, 229, 20, 225, 124, 255, 257, 257, 257, 257, 293, 297, 297, 317, 297, 298],
                [58, 124, 124, 275, 277, 257, 257, 256, 257, 257, 295, 317, 317, 316, 317, 298],
                [124, 124, 255, 256, 257, 256, 257, 258, 259, 278, 317, 298, 298, 298, 298, 298],
                [228, 255, 256, 257, 256, 257, 279, 315, 316, 317, 298, 298, 298, 298, 298, 298],
                [255, 256, 257, 258, 259, 278, 296, 297, 298, 298, 298, 298, 298, 298, 298, 298]
            ]
        };
    },

    // Complete quicksand contours copied from shipped mapm8.  These are kept
    // as multi-row motifs: choosing a legal-looking quicksand edge one cell at
    // a time produced torn outlines because the neighbouring rows did not
    // continue the same curve. `null` cells are intentional holes/background.
    QuicksandPatchTemplates: function() {
        return [
            {
                id: "mapm8_small_slant",
                rows: [
                    [null, null, null, null, null, null, null, 146, 148],
                    [null, null, null, null, null, null, 146, 167, 168],
                    [null, null, null, 146, 147, 147, 167, 227, 188],
                    [null, 226, 147, 167, 227, 187, 207, null, null],
                    [146, 167, 167, 207, null, null, null, null, null],
                    [186, 187, 188, null, null, null, null, null, null]
                ]
            },
            {
                id: "mapm8_round_patch",
                rows: [
                    [null, null, null, null, 146, 147, 148],
                    [null, null, null, null, 166, 107, 188],
                    [null, null, null, 226, 107, 188, null],
                    [null, null, 146, 107, 168, null, null],
                    [null, 226, 167, 107, 207, null, null],
                    [146, 107, 107, 167, 148, null, null],
                    [166, 107, 167, 107, 107, 148, null],
                    [186, 167, 107, 107, 167, 207, null],
                    [null, 206, 227, 187, 207, null, null]
                ]
            },
            {
                id: "mapm8_broad_patch",
                rows: [
                    [null, null, null, null, null, null, 146, 147, 147, 148, null, null, null],
                    [null, null, null, null, null, 226, 107, 167, 107, 107, 208, null, null],
                    [null, null, null, 146, 147, 107, 107, 107, 107, 167, 168, null, null],
                    [null, null, 146, 107, 107, 107, 227, 188, 186, 107, 107, 148, null],
                    [226, 148, 226, 167, 107, 188, null, null, null, 166, 107, 168, null],
                    [186, 207, 166, 107, 207, null, null, null, null, 186, 167, 107, 208],
                    [null, null, 206, 207, null, null, null, null, null, null, 166, 107, 207],
                    [null, null, null, null, null, null, null, null, null, null, 206, 188, null]
                ]
            }
        ];
    }
};
