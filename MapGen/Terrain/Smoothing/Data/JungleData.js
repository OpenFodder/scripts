var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};

MapGen.Terrain.Smoothing.JungleData = {
    bitmasks: {
    bm_cf1_jungle_water_darkgrass: {
        bitmask: [
            { bm: "00000011", tiles: [{ tile: "380" }] },
            { bm: "00000111", tiles: [{ tile: "304" }, { tile: "305" }] },
            { bm: "00000110", tiles: [{ tile: "363" }] },
            { bm: "00001001", tiles: [{ tile: "242" }] },
            { bm: "00010100", tiles: [{ tile: "243" }] },
            { bm: "00101001", tiles: [{ tile: "364" }, { tile: "384" }] },
            { bm: "10010100", tiles: [{ tile: "266" }, { tile: "286" }, { tile: "306" }] },
            { bm: "00101000", tiles: [{ tile: "264" }] },
            { bm: "10010000", tiles: [{ tile: "261" }] },
            { bm: "01100000", tiles: [{ tile: "382" }] },
            { bm: "11100000", tiles: [{ tile: "365" }, { tile: "366" }, { tile: "386" }] },
            { bm: "11000000", tiles: [{ tile: "361" }] },

            { bm: "11110000", tiles: [{ tile: "360" }] },
            { bm: "11100000", tiles: [{ tile: "365" }, { tile: "366" }, { tile: "386" }] },
            { bm: "11101000", tiles: [{ tile: "383" }] },
            { bm: "11010100", tiles: [{ tile: "241" }] },
            { bm: "01101001", tiles: [{ tile: "244" }] },
            { bm: "10010100", tiles: [{ tile: "266" }, { tile: "286" }, { tile: "306" }] },
            { bm: "00101001", tiles: [{ tile: "364" }, { tile: "384" }] },
            { bm: "10010110", tiles: [{ tile: "263" }] },
            { bm: "00101011", tiles: [{ tile: "262" }] },
            { bm: "00010111", tiles: [{ tile: "362" }] },
            { bm: "00000111", tiles: [{ tile: "304" }, { tile: "305" }] },
            { bm: "00001111", tiles: [{ tile: "381" }] },

            { bm: "00001011", tiles: [{ tile: "284" }, { tile: "285" }] },
            { bm: "00010110", tiles: [{ tile: "280" }, { tile: "281" }] },
            { bm: "01101000", tiles: [{ tile: "282" }, { tile: "283" }] },
            { bm: "11010000", tiles: [{ tile: "245" }, { tile: "265" }] }
        ]
    },

    bm_cf1_jungle_lightgrass_darkgrass: {
        bitmask: [
            { bm: "00000011", tiles: [{ tile: "228" }] },
            { bm: "00000111", tiles: [{ tile: "127" }, { tile: "128" }] },
            { bm: "00000110", tiles: [{ tile: "229" }] },
            { bm: "00001001", tiles: [{ tile: "228" }] },
            { bm: "00010100", tiles: [{ tile: "229" }] },
            { bm: "00101001", tiles: [{ tile: "165" }, { tile: "185" }] },
            { bm: "10010100", tiles: [{ tile: "49" }, { tile: "69" }] },
            { bm: "00101000", tiles: [{ tile: "209" }] },
            { bm: "10010000", tiles: [{ tile: "210" }] },
            { bm: "01100000", tiles: [{ tile: "209" }] },
            { bm: "11100000", tiles: [{ tile: "47" }, { tile: "48" }] },
            { bm: "11000000", tiles: [{ tile: "210" }] },

            { bm: "11110000", tiles: [{ tile: "68" }] },
            { bm: "11100000", tiles: [{ tile: "47" }, { tile: "48" }] },
            { bm: "11101000", tiles: [{ tile: "67" }] },
            { bm: "11010100", tiles: [{ tile: "68" }] },
            { bm: "01101001", tiles: [{ tile: "67" }] },
            { bm: "10010100", tiles: [{ tile: "49" }, { tile: "69" }] },
            { bm: "00101001", tiles: [{ tile: "165" }, { tile: "185" }] },
            { bm: "10010110", tiles: [{ tile: "205" }] },
            { bm: "00101011", tiles: [{ tile: "225" }] },
            { bm: "00010111", tiles: [{ tile: "205" }] },
            { bm: "00000111", tiles: [{ tile: "127" }, { tile: "128" }] },
            { bm: "00001111", tiles: [{ tile: "225" }] },

            { bm: "00001011", tiles: [{ tile: "225" }] },
            { bm: "00010110", tiles: [{ tile: "205" }] },
            { bm: "01101000", tiles: [{ tile: "67" }] },
            { bm: "11010000", tiles: [{ tile: "68" }] }
        ]
    },

    bm_cf1_jungle_swamp_darkgrass: {
        bitmask: [
            { bm: "00000011", tiles: [{ tile: "227" }] },
            { bm: "00000111", tiles: [{ tile: "227" }] },
            { bm: "00000110", tiles: [{ tile: "227" }] },

            { bm: "00001001", tiles: [{ tile: "207" }] },
            { bm: "00010100", tiles: [{ tile: "206" }] },

            { bm: "00101001", tiles: [{ tile: "168" }] },
            { bm: "10010100", tiles: [{ tile: "186" }] },

            { bm: "00101000", tiles: [{ tile: "148" }] },
            { bm: "10010000", tiles: [{ tile: "226" }] },

            { bm: "01100000", tiles: [{ tile: "147" }] },
            { bm: "11100000", tiles: [{ tile: "147" }] },
            { bm: "11000000", tiles: [{ tile: "147" }] },

            { bm: "11110000", tiles: [{ tile: "226" }] },
            { bm: "11100000", tiles: [{ tile: "147" }] },
            { bm: "11101000", tiles: [{ tile: "148" }] },

            { bm: "11010100", tiles: [{ tile: "146" }] },
            { bm: "01101001", tiles: [{ tile: "148" }] },

            { bm: "10010100", tiles: [{ tile: "166" }] },
            { bm: "00101001", tiles: [{ tile: "168" }] },

            { bm: "10010110", tiles: [{ tile: "206" }] },
            { bm: "00101011", tiles: [{ tile: "188" }] },

            { bm: "00010111", tiles: [{ tile: "206" }] },
            { bm: "00000111", tiles: [{ tile: "227" }] },
            { bm: "00001111", tiles: [{ tile: "207" }] },

            { bm: "00001011", tiles: [{ tile: "207" }] },
            { bm: "00010110", tiles: [{ tile: "206" }] },
            { bm: "01101000", tiles: [{ tile: "148" }] },
            { bm: "11010000", tiles: [{ tile: "226" }] }
        ]
    },

    bm_cf1_jungle_tree: {
        bitmask:
            [
                {
                    group: "BOTTOM",
                    detect: [{ vector: "11111000" }],
                    change_to: [
                        { matrix: [[1, 21, 41], [2, 22, 42], [3, 23, 43], [4, 24, 44]] },
                        { matrix: [] },
                        { matrix: [] }
                    ],
                    change_to_cur: [{ row: "0" }, { row: "0" }, { row: "0" }]
                },

                {
                    group: "BOTTOM",
                    detect: [{ vector: "11101000" }],
                    change_to: [
                        { matrix: [[202, 222, 86]] },
                        { matrix: [] },
                        { matrix: [] }
                    ],
                    change_to_cur: [{ row: "0" }, { row: "0" }, { row: "0" }]
                },

                {
                    group: "BOTTOM",
                    detect: [{ vector: "11110000" }],
                    change_to: [
                        { matrix: [[3, 23, 43]] },
                        { matrix: [] },
                        { matrix: [] }
                    ],
                    change_to_cur: [{ row: "0" }, { row: "0" }, { row: "0" }]
                },

                {
                    group: "BOTTOM",
                    detect: [{ vector: "11101001" }, { vector: "11111001" }, { vector: "11001001" }, { vector: "11011001" }],
                    change_to: [
                        { matrix: [[144, 184, 204, 224]] },
                        { matrix: [] },
                        { matrix: [] }
                    ],
                    change_to_cur: [{ row: "0" }, { row: "0" }, { row: "0" }]
                },

                {
                    group: "BOTTOM",
                    detect: [{ vector: "11110100" }, { vector: "11111100" }, { vector: "01110100" }, { vector: "01111100" }],
                    change_to: [
                        { matrix: [[163, 183, 203, 223]] },
                        { matrix: [] },
                        { matrix: [] }
                    ],
                    change_to_cur: [{ row: "0" }, { row: "0" }, { row: "0" }]
                },

                {
                    group: "BOTTOM",
                    detect: [{ vector: "01101000" }, { vector: "01101001" }],
                    change_to: [
                        { matrix: [[46, 66, 86]] },
                        { matrix: [[35, 35]] },
                        { matrix: [] }
                    ],
                    change_to_cur: [{ row: "0" }, { row: "0" }, { row: "0" }]
                },

                {
                    group: "BOTTOM",
                    detect: [{ vector: "11010000" }, { vector: "11010100" }],
                    change_to: [
                        { matrix: [[45, 65, 85]] },
                        { matrix: [] },
                        { matrix: [[104, 104]] }
                    ],
                    change_to_cur: [{ row: "0" }, { row: "0" }, { row: "0" }]
                },

                {
                    group: "MIDDLE",
                    detect: [{ vector: "11111111" }, { vector: "11111011" }, { vector: "11111110" }, { vector: "01111111" }, { vector: "11011111" }, { vector: "11011011" }, { vector: "01111110" }, { vector: "11110110" }, { vector: "11010111" }, { vector: "11101011" }, { vector: "01101111" }],
                    change_to: [
                        { matrix: [[1], [2], [83], [102], [121], [122], [141], [142], [163]] },
                        { matrix: [] },
                        { matrix: [] }
                    ],
                    change_to_cur: [{ row: "0" }, { row: "0" }, { row: "0" }]
                },

                {
                    group: "MIDDLE",
                    detect: [{ vector: "01001011" }, { vector: "01101010" }, { vector: "01101011" }],
                    change_to: [
                        { matrix: [[46], [83]] },
                        { matrix: [[35]] },
                        { matrix: [] }
                    ],
                    change_to_cur: [{ row: "0" }, { row: "0" }, { row: "0" }]
                },

                {
                    group: "MIDDLE",
                    detect: [{ vector: "01010110" }, { vector: "11010010" }, { vector: "11010110" }],
                    change_to: [
                        { matrix: [[45], [25]] },
                        { matrix: [] },
                        { matrix: [[104]] }
                    ],
                    change_to_cur: [{ row: "0" }, { row: "0" }, { row: "0" }]
                },

                {
                    group: "TOP",
                    detect: [{ vector: "00011111" }],
                    change_to: [
                        { matrix: [[62], [102], [144], [145]] },
                        { matrix: [] },
                        { matrix: [] }
                    ],
                    change_to_cur: [{ row: "0" }, { row: "0" }, { row: "0" }]
                },

                {
                    group: "TOP",
                    detect: [{ vector: "00001111" }],
                    change_to: [
                        { matrix: [[61], [100]] },
                        { matrix: [] },
                        { matrix: [] }
                    ],
                    change_to_cur: [{ row: "0" }, { row: "0" }, { row: "0" }]
                },

                {
                    group: "TOP",
                    detect: [{ vector: "00010111" }],
                    change_to: [
                        { matrix: [[63], [120]] },
                        { matrix: [] },
                        { matrix: [] }
                    ],
                    change_to_cur: [{ row: "0" }, { row: "0" }, { row: "0" }]
                },

                {
                    group: "TOP",
                    detect: [{ vector: "00101111" }],
                    change_to: [
                        { matrix: [[100]] },
                        { matrix: [] },
                        { matrix: [] }
                    ],
                    change_to_cur: [{ row: "0" }, { row: "0" }, { row: "0" }]
                },

                {
                    group: "TOP",
                    detect: [{ vector: "00111111" }],
                    change_to: [
                        { matrix: [[144]] },
                        { matrix: [] },
                        { matrix: [] }
                    ],
                    change_to_cur: [{ row: "0" }, { row: "0" }, { row: "0" }]
                },

                {
                    group: "TOP",
                    detect: [{ vector: "10010111" }],
                    change_to: [
                        { matrix: [[63]] },
                        { matrix: [] },
                        { matrix: [] }
                    ],
                    change_to_cur: [{ row: "0" }, { row: "0" }, { row: "0" }]
                },

                {
                    group: "TOP",
                    detect: [{ vector: "10011111" }],
                    change_to: [
                        { matrix: [[102]] },
                        { matrix: [] },
                        { matrix: [] }
                    ],
                    change_to_cur: [{ row: "0" }, { row: "0" }, { row: "0" }]
                },

                {
                    group: "TOP",
                    detect: [{ vector: "00001011" }, { vector: "00101011" }],
                    change_to: [
                        { matrix: [[61], [100]] },
                        { matrix: [] },
                        { matrix: [] }
                    ],
                    change_to_cur: [{ row: "0" }, { row: "0" }, { row: "0" }]
                },

                {
                    group: "TOP",
                    detect: [{ vector: "00010110" }, { vector: "10010110" }],
                    change_to: [
                        { matrix: [[63], [120]] },
                        { matrix: [] },
                        { matrix: [] }
                    ],
                    change_to_cur: [{ row: "0" }, { row: "0" }, { row: "0" }]
                }

            ]
    }
    }
};
