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

    Place: function(pX, pY, pStructure) {
        TileX = pX / 16;
        TileY = pY / 16;

        // Set the terrain tiles
        Struct = pStructure.Struct;
        for( x = 0; x < Struct.length; ++x ) {
            Map.TileSet(TileX + Struct[x][0], TileY + Struct[x][1], Struct[x][2]);
        }

        // Now add the sprites
        Sprites = pStructure.Sprites;
        for( x = 0; x < Sprites.length; ++x ) {
            Map.SpriteAdd(Sprites[x][2], pX + Sprites[x][0], pY + Sprites[x][1]);
        }
    },

    /**
     * Place a civilian hut
     * 
     * @param {number} pX 
     * @param {number} pY 
     */
    PlaceHut: function(pX, pY) {
        Struct = this.GetCurrent();
        this.Place(pX, pY, Struct.Hut);
    },

    /**
     * Place a barracks
     * 
     * @param {number} pX 
     * @param {number} pY 
     */
    PlaceBarracks: function(pX, pY) {
        Struct = this.GetCurrent();
        this.Place(pX, pY, Struct.Barracks);
    }
};
