Structures.Jungle.Barracks = {
    StructFindTile: [
        Terrain.Jungle.Mainland.concat(Terrain.Jungle.Borderland),
    ],

    // The same barracks stamp is present in both Jungle atlases.  Sub1 beach
    // maps deliberately omit compound layouts, but still use standalone
    // barracks/objective buildings (see the exported Amiga_sub1 tile group).
    SubVariantsAllowed: ['sub0', 'sub1'],

    // Frameless 12-tile core building (matches Source/Structures/Barracks.cpp
    // and TileGroups Jungle/Amiga_sub0::Barracks stamp[0]). The prior version
    // baked in a 6x6 decorative jungle frame the original engine never had.
    // The Struct geometry is also emitted by the generated runtime leg
    // (Common/Generated/Structures.Jungle.Sub0.js), which overrides this at
    // load time; kept here in sync so the hand file is not misleading.
    Struct: [
        [
            [ 1, 0, 333 ],
            [ 2, 0, 334 ],

            [ 0, 1, 352 ],
            [ 1, 1, 353 ],
            [ 2, 1, 354 ],

            [ 0, 2, 372 ],
            [ 1, 2, 373 ],
            [ 2, 2, 374 ],
            [ 3, 2, 375 ],

            [ 0, 3, 392 ],
            [ 1, 3, 393 ],
            [ 2, 3, 394 ]
        ]
    ],

    // Sprite offsets recalibrated to the frameless core (canonical C++ values).
    Types: {
        "soldier": [
            [ 13, 18, SpriteTypes.BuildingRoof ],
            [ 9, 50, SpriteTypes.BuildingDoor ]
        ]
    }

};

Structures.Desert.Barracks = {
    StructFindTile: [
        Terrain.Desert.Mainland,
    ],

    Struct: [
        [
            [0, 0, 196],
            [1, 0, 197],
            [2, 0, 198],

            [0, 1, 216],
            [1, 1, 217],
            [2, 1, 218],
            
            [0, 2, 236],
            [1, 2, 237],
            [2, 2, 238]
        ]
    ],

    
    Types: {
        "soldier": [
            [ 12, -15, SpriteTypes.BuildingRoof ],
            [ 7, 16, SpriteTypes.BuildingDoor ]
        ]
    }

};

Structures.Ice.Barracks = {
    StructFindTile: [
        Terrain.Ice.Mainland,
    ],
    Struct: [
        [
            [1, 0, 245],
            [2, 0, 246],
            [3, 0, 247],

            [0, 1, 264],
            [1, 1, 265],
            [2, 1, 266],
            [3, 1, 267],

            [0, 2, 284],
            [1, 2, 285],
            [2, 2, 286],
            [3, 2, 287]
        ]
    ],

    
    Types: {
        "soldier": [
            // Canonical Source/Structures/Barracks.cpp anchors. The previous
            // door was one pixel left and one pixel high.
            [ 23, 11, SpriteTypes.BuildingRoof ],
            [ 20, 43, SpriteTypes.BuildingDoor ]
        ]
    }

};


Structures.Moors.Barracks = {
    StructFindTile: [
        Terrain.Moors.Mainland,
    ],
    Struct: [
        [
            [1, 0, 335],
            [2, 0, 336],

            [0, 1, 354],
            [1, 1, 355],
            [2, 1, 356],

            [0, 2, 374],
            [1, 2, 375],
            [2, 2, 376],
            
            [0, 3, 394],
            [1, 3, 395],
            [2, 3, 396]
        ]
    ],

    
    Types: {
        "soldier": [
            [ 15, 1, SpriteTypes.BuildingRoof ],
            [ 7, 33, SpriteTypes.BuildingDoor ]
        ]
    }

};

Structures.Interior.Barracks = {
    StructFindTile: [
        Terrain.Interior.Mainland,
    ],

    Struct: [
        [
            [0, 0, 246],
            [0, 1, 266]
        ]
    ],

    
    Types: {
        "soldier": [
            [ 3, 5, SpriteTypes.BuildingDoor ]
        ]
    }

};
