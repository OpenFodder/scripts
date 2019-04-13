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
        for( var count = 0; count < Struct.length; ++count ) {
            Map.TileSet(TileX + Struct[count][0], TileY + Struct[count][1], Struct[count][2]);
        }

        // Now add the sprites
        for( var count = 0; count < Sprites.length; ++count ) {
            Map.SpriteAdd(Sprites[count][2], (TileX * 16) + Sprites[count][0], (TileY * 16) + Sprites[count][1]);
        }
    },

    /**
     * Place a civilian hut
     * 
     * @param {cPosition} pPosition
     * @param {string} pHutType
     */
    PlaceHut: function(pPosition, pHutType) {
        Struct = this.GetCurrent();
        this.Place(pPosition, Struct.Hut, pHutType);
    },

    /**
     * Place a civlian hut randomly
     * 
     * @param {string} pHutType 
     */
    PlaceHutRandom: function(pHutType) {

        position = Positioning.PositionAwayFrom(Terrain.Features.FlatGround(), 3, Session.HutPositions, 250);
        if(position.x != -1 && position.y != -1) {

            Session.HutPositions.push(position);
            this.PlaceHut(position, pHutType);
        }
    },

    PlaceHuts: function(pHutType, pCount) {
        print("Placing Random Huts");
        
        for(var x = 0; x < 10; x+=1) {
            Structures.PlaceHutRandom(pHutType);
        }
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
