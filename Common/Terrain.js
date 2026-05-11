
/**
 * @var {object} Shared terrain enums and basic per-tileset metadata.
 */
var Terrain = {
	
	/**
	 * @var {object} {number} Available tile sets.
	 */
	Types: {
		Jungle: 0,
		Desert: 1,
		Ice: 2,
		Moors: 3,
		Interior: 4,
		Hid: 5,
		AmigaFormat: 6
	},

	/**
	 * @var {object} {number} Terrain Features
	 */
	Features: {
		Ground: 			0,
		RoughGround: 		1,
		RaisedRoughGround: 	2,
		SolidObstacle: 		3,
		SoftHazard: 		4,
		ShallowWater: 		5,
		DeepWater: 			6,
		SlowGround: 		7,
		SlipperyGround: 	8,
		LedgeDrop: 			9,
		PitDrop: 			0x0A,
		SinkingGround: 		0x0B,
		NoFlyObstacle: 		0x0C,
		DirectionalSlope: 	0x0D,
		JumpRamp: 			0x0E,

		FlatGround: function() { return [Terrain.Features.Ground, Terrain.Features.SlowGround]; }
	},

	Jungle: {
		Tiles: {
			Water: 326,
			QuickSand: 167,
			Land: 123,
			Tree: 82
		},
		Mainland: [0, 20, 40, 18, 19],
		Borderland: [123, 124, 68, 240, 365]
		// Sub0/Sub1 palettes are generated from Documentation/TileGroups.json
		// by Tools/ExportTileGroups.py into Run/Scripts/Common/Generated/Terrain.Jungle.Sub0.js.
	},

	Desert: {
		Tiles: {
			Water: 180,
			Land: 0,
			Tree: 220
		},
		Mainland: [0, 20, 40, 18, 19],
		Borderland: [123, 124, 68, 240, 365]
	},
	
	Ice: {
		Tiles: {
			Water: 100,
			Land: 0,
			Tree: 170
		},
		Mainland: [0, 20, 40, 18, 19],
		Borderland: [123, 124, 68, 240, 365]
		// Sub0 is generated from Documentation/TileGroups.json by
		// Tools/ExportTileGroups.py into Run/Scripts/Common/Generated/Terrain.Ice.Sub0.js.
	},

	Moors: {
		
		Tiles: {
			Water: 193,
			Land: 0,
			Tree: 2
		},
		Mainland: [0, 20, 40, 18, 19],
		Borderland: [123, 124, 68, 240, 365]
	},
	
	Interior: {
		Tiles: {
			Water: 242,
			Land: 4,
			Tree: 275
		},
		Mainland: [0, 20, 40, 18, 19],
		Borderland: [123, 124, 68, 240, 365]
	},
	
	AmigaFormat: {
		Tiles: {
			Water: 100,
			Land: 0,
			Tree: 240
		},
		Mainland: [0, 20, 40, 18, 19],
		Borderland: [123, 124, 68, 240, 365]
	},
	
	/**
	 * Get basic tiles for the current map tile type.
	 */
	GetCurrent: function() {
		switch(Map.getTileType()) {
			
			case this.Types.Jungle:
				return Terrain.Jungle;
			case this.Types.Desert:
				return Terrain.Desert;
			case this.Types.Ice:
				return Terrain.Ice;
			case this.Types.Moors:
				return Terrain.Moors;
			case this.Types.Interior:
				return Terrain.Interior;
			case this.Types.AmigaFormat:
				return Terrain.AmigaFormat;
				
			default:
				return Terrain.Jungle;
		}
	},

	/**
	 * Get the basic tile ids for the current map tileType
	 * 
	 * @return object
	 */
	GetTiles: function() {

		return this.GetCurrent().Tiles;
	}
};
