// Bridge structure data is sub-tileset specific. Each variant has either a
// `Single` stamp (one-piece footprint) or a growable `Start` / `Middle[] /
// `End` recipe that the consumer (T0.6.5) tiles to span an arbitrary-length
// river. Source-of-truth tile data lives in Documentation/TileGroups.json
// and is exported to Documentation/Exported/Structures.Jungle.Amiga_sub<N>.js.
//
// Shape note: the exporter (T0.6.4) emits a flat `Variants:` block per
// sub-tileset file. This runtime file is a hand-merge of those two outputs
// keyed by sub-tileset (`SubVariants.subN.<variant>`) so a single
// `Structures.GetActiveSubVariant()` lookup picks the right recipe at
// stamp time. When T0.6.5 lands a `PickBridgeVariant` helper, decide there
// whether to keep the merged shape or rebuild around per-file `Variants:`.

Structures.Jungle.Bridge = {
    StructFindTile: [
        Terrain.Jungle.Mainland.concat(Terrain.Jungle.Borderland),
    ],

    SubVariants: {
        sub0: {
            angle: {
                Single: [
                    [0, 0, 302], [1, 0, 303],
                    [0, 1, 322], [1, 1, 323], [2, 1, 325],
                    [0, 2, 342], [1, 2, 343], [2, 2, 345]
                ]
            },
            vertical: {
                Start: [[0, 0, 300], [1, 0, 301]],
                Middle: [
                    [[0, 0, 338], [1, 0, 339]],
                    [[0, 0, 320], [1, 0, 321]]
                ],
                End: [[0, 0, 340], [1, 0, 341]]
            }
        },
        sub1: {
            vertical: {
                Start: [[0, 0, 245], [1, 0, 246]],
                Middle: [
                    [[0, 0, 265], [1, 0, 266]],
                    [[0, 0, 285], [1, 0, 286]],
                    [[0, 0, 305], [1, 0, 306]]
                ],
                End: [[0, 0, 325], [1, 0, 326]]
            }
        }
    }
};

// Desert bridge — 3-wide vertical recipe with a 2-row End (the wider footing
// reads as a stone pier in the desert tileset). Source: Documentation/
// TileGroups.json [Desert/Amiga_sub0 :: Bridge], translated by hand from the
// generated Documentation/Exported/Structures.Desert.Amiga_sub0.js.
Structures.Desert.Bridge = {
    StructFindTile: [
        Terrain.Desert.Mainland.concat(Terrain.Desert.Borderland),
    ],

    SubVariants: {
        sub0: {
            vertical: {
                Start: [[0, 0, 88], [1, 0, 89], [2, 0, 90]],
                Middle: [
                    [[0, 0, 108], [1, 0, 109], [2, 0, 110]],
                    [[0, 0, 128], [1, 0, 129], [2, 0, 130]]
                ],
                End: [
                    [0, 0, 148], [1, 0, 149], [2, 0, 150],
                    [0, 1, 168], [1, 1, 169], [2, 1, 170]
                ]
            }
        }
    }
};
