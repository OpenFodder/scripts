Structures.Jungle.Hut = {

    Struct: [
        [0, 0, 255],
        [1, 0, 256],
        [2, 0, 257],

        [0, 1, 275],
        [1, 1, 276],
        [2, 1, 277],

        [0, 2, 295],
        [1, 2, 296],
        [2, 2, 297],
    ],

    Types: {
        "Soldier": [
            [20, 27, SpriteTypes.BuildingDoor2]
        ],
        "Civilian": [
            [20, 27, SpriteTypes.Door_Civilian]
        ],
        "Civilian_Spear": [
            [20, 27, SpriteTypes.Door_Civilian_Spear]
        ],
        "Civilian_Rescue": [
            [20, 43, SpriteTypes.Door_Civilian_Rescue]
        ]
    }

};

Structures.Desert.Hut = {
    Structs: [
       [0, 0, 12],
       [1, 0, 15],
       [2, 0, 16],
       [3, 0, 18],
       [0, 1, 32],
       [1, 1, 35],
       [2, 1, 36],
       [3, 1, 38],

       [0, 2, 52],
       [1, 2, 98],
       [2, 2, 99],
       [3, 2, 58],

       [0, 3, 72],
       [1, 3, 118],
       [2, 3, 119],
       [3, 3, 78]
    ],

    Types: {
        "Soldier": [
            [35, 40, SpriteTypes.BuildingDoor2]
        ],
        "Civilian": [
            [35, 40, SpriteTypes.Door_Civilian]
        ],
        "Civilian_Spear": [
            [35, 40, SpriteTypes.Door_Civilian_Spear]
        ],
        "Civilian_Rescue": [
            [35, 40, SpriteTypes.Door_Civilian_Rescue]
        ]
    }
};

Structures.Ice.Hut = {

    Structs: [
        [ 1, 0, 241],
        [ 2, 0, 242],
        [ 3, 0, 243],

        [ 0, 1, 260],
        [ 1, 1, 261],
        [ 2, 1, 262],
        [ 3, 1, 263],

        [ 0, 2, 280],
        [ 1, 2, 281],
        [ 2, 2, 282],
        [ 3, 2, 283]
    ],

    Types: {
        "Soldier": [
            [20, 1, SpriteTypes.Shrub], // In this case 'Shrub' is roof
            [12, 23, SpriteTypes.BuildingDoor2]    
        ],
        "Civilian": [
            [20, 1, SpriteTypes.Shrub], // In this case 'Shrub' is roof
            [12, 23, SpriteTypes.Door_Civilian]  
        ],
        "Civilian_Spear": [
            [20, 1, SpriteTypes.Shrub], // In this case 'Shrub' is roof
            [12, 23, SpriteTypes.Door_Civilian_Spear]  
        ],
        "Civilian_Rescue": [
            [20, 1, SpriteTypes.Shrub], // In this case 'Shrub' is roof
            [12, 23, SpriteTypes.Door_Civilian_Rescue]  
        ]
    }
};

Structures.Moors.Hut = {

    Structs: [
       [0, 0, 240],
       [1, 0, 241],
       [2, 0, 242],
       [3, 0, 243],

       [0, 1, 260],
       [1, 1, 261],
       [2, 1, 262],
       [3, 1, 263],

       [0, 2, 280],
       [1, 2, 281],
       [2, 2, 282],
       [3, 2, 283],

       [0, 3, 300],
       [1, 3, 301],
       [2, 3, 302],
       [3, 3, 303],

       [0, 4, 320],
       [1, 4, 321],
       [2, 4, 322],
       [3, 4, 323]
        
    ],

    Types: {
        "Soldier": [
            [28, 65, SpriteTypes.BuildingDoor2]   
        ],
        "Civilian": [
            [28, 65, SpriteTypes.Door_Civilian]   
        ],
        "Civilian_Spear": [
            [28, 65, SpriteTypes.Door_Civilian_Spear]    
        ],
        "Civilian_Rescue": [
            [28, 65, SpriteTypes.Door_Civilian_Rescue]   
        ]
    }
};

Structures.Interior.Hut = {
    
    Structs: [
        [0, 0, 246],
        [0, 1, 266]
    ],

    Types: {
        "Soldier": [
            [3, 5, SpriteTypes.BuildingDoor2]     
        ],
        "Civilian": [
            [3, 5, SpriteTypes.Door_Civilian]   
        ],
        "Civilian_Spear": [
            [3, 5, SpriteTypes.Door_Civilian_Spear]    
        ],
        "Civilian_Rescue": [
            [3, 5, SpriteTypes.Door_Civilian_Rescue]   
        ]
    }
};