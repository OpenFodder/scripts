var Structures = {

    Jungle: {
        Hut: {

        },

        Barracks: {

        }
    },

    Desert: {

    },

    Ice: {

    },

    Moors: {

    },

    Interior: {

    },

    /**
     * 
     */
	GetCurrent: function() {
		switch(Map.getTileType()) {
			
			case Terrain.Types.Jungle:
				return Structures.Jungle;
			case Terrain.Types.Desert:
				return Structures.Desert;
			case Terrain.Types.Ice:
				return Structures.Ice;
			case Terrain.Types.Moors:
				return Structures.Moors;
			case Terrain.Types.Interior:
				return Structures.Interior;
			case Terrain.Types.AmigaFormat:
				return Structures.AmigaFormat;
				
			default:
				return Structures.Jungle;
		}
	},

    /**
     * 
     * @param {cPosition} pPosition 
     * @param {sStructure} pStructure 
     * @param {string} pSpriteSet
     */
    Place: function(pPosition, pStructure, pSpriteSet) {
        TileX = Math.floor(pPosition.x / 16);
        TileY = Math.floor(pPosition.y / 16);

        Struct = pStructure.Struct;
        Sprites = pStructure.Types[pSpriteSet];

        if(Sprites === undefined && pSpriteSet !== "") {
            print("Structure does not have sprite-set: " + pSpriteSet);
            return;
        }

        // Set the terrain tiles
        for( x = 0; x < Struct.length; ++x ) {
            Map.TileSet(TileX + Struct[x][0], TileY + Struct[x][1], Struct[x][2]);
        }

        // Now add the sprites
        for( x = 0; x < Sprites.length; ++x ) {
            Map.SpriteAdd(Sprites[x][2], (TileX * 16) + Sprites[x][0], (TileY * 16) + Sprites[x][1]);
        }
    },

    /**
     * Place a civilian hut
     * 
     * @param {cPosition} pPosition
     * @param {string} pSpriteSet
     */
    PlaceHut: function(pPosition, pSpriteSet) {
        Struct = this.GetCurrent();
        this.Place(pPosition, Struct.Hut, pSpriteSet);
    },

    /**
     * Place a barracks
     * 
     * @param {cPosition} pPosition
     * @param {string} pSpriteSet
     */
    PlaceBarracks: function(pPosition, pSpriteSet) {
        Struct = this.GetCurrent();
        this.Place(pPosition, Struct.Barracks, pSpriteSet);
    }
};
