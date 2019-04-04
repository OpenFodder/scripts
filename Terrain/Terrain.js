
/**
 * @var {object} {object} Terrain related functions
 */
var Terrain = {
	
	/**
	 * @var {object} {number} Types of available 
	 */
	Types: {
		Jungle: 0,
		Desert: 1,
		Ice: 2,
		Moors: 3,
		Interior: 4,
		AmigaFormat: 5
	},

	/**
	 * @var {object} {number} Terrain Features
	 */
	Features: {
		Land: 		0,
		Rocky:	 	1,
		Rocky2: 	2,
		BounceOff: 	3,
		QuickSand: 	4,
		WaterEdge: 	5,
		Water: 		6,
		Snow: 		7,
		QuickSandEdge: 8,
		Drop: 	9,
		Drop2: 	0x0A,
		Sink: 	0x0B,
		C: 		0x0C,
		D: 		0x0D,
		Jump: 	0x0E,

		FlatGround: function() { return [Terrain.Features.Land , Terrain.Features.Snow]; }
	},

	Jungle: {
		Tiles: {
			Water: 326,
			QuickSand: 167,
			Land: 123,
			Tree: 82
		}
	},

	Desert: {
		Tiles: {
			Water: 180,
			Land: 0,
			Tree: 220
		}
	},
	
	Ice: {
		Tiles: {
			Water: 100,
			Land: 0,
			Tree: 170
		}
	},

	Moors: {
		
		Tiles: {
			Water: 193,
			Land: 0,
			Tree: 2
		}
	},
	
	Interior: {
		Tiles: {
			Water: 242,
			Land: 4,
			Tree: 275
		}
	},
	
	AmigaFormat: {
		Tiles: {
			Water: 100,
			Land: 0,
			Tree: 240
		}
	},
	
	/**
	 * Get basic titles for the current Map Tile Type
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
	},
	
	/**
	 * Create a random map layout
	 */
	Randomize: function() {

		// TODO: Rotate through available random functions
		//pScale = Map.getRandomFloat(0.01, 0.1);
		//pLacunarity = Map.getRandomFloat(0.1, 0.5);
		//pPersistance = Map.getRandomFloat(0.1, 1.);	// higher produces more trees
		//return this.RandomSimplexNoise(pScale, pLacunarity, pPersistance, 5 );
		pOctaves = 4;
		pRoughness = Map.getRandomFloat(0.00, 0.5);
		pScale = Map.getRandomFloat(0.001, 0.03);
		pSeed = Map.getRandomInt(0, 500);
		pEdgeFade = Map.getRandomFloat(0.1, 0.2);
		if (Map.getRandomInt(0,1) == 0)
			pRadialEnabled = false;
		else
			pRadialEnabled = true;

		if(Map.getTileType() == this.Types.Jungle) {
			var lev_limits = [0.17, 0.25, 0.35, 0.45, 1.00];
			noises = Map.SimplexIslands(pOctaves, pRoughness, pScale, pSeed, pRadialEnabled, pEdgeFade);

			var st = new CSmoothTerrain();
			st.run('cf1', 'jungle', 'level', Map.getWidth(), Map.getHeight(), noises, lev_limits);

			for (var y = 0; y < Map.getHeight() ; y++) {
				for (var x = 0; x < Map.getWidth(); x++) {

					Map.TileSet( x, y, st.getMapTile(x, y) );	  
				}
			}

			return;
		}

		this.RandomSimplexIslands(pRoughness, pScale, pSeed, 4, pRadialEnabled, pEdgeFade);
	},
	
	/**
	 * Create random simplex islands, with basic tiles
	 * 
	 * @param {number} pRoughness 
	 * @param {number} pScale 
	 * @param {number} pSeed 
	 * @param {number} pOctaves 
	 * @param {boolean} pRadialEnabled 
	 * @param {number} pEdgeFade
	 */
	RandomSimplexIslands: function(pRoughness, pScale, pSeed, pOctaves, pRadialEnabled, pEdgeFade) {
		Tiles = this.GetTiles();
		noises = Map.SimplexIslands(pOctaves, pRoughness, pScale, pSeed, pRadialEnabled, pEdgeFade);
		
		for( x = 0; x < Map.getWidth(); ++x ) {
			for( y = 0; y < Map.getHeight(); ++y) {
	
				noise =  noises[x][y];
				TileID = 0;

				if (noise <= 0.21) {
					TileID = Tiles.Water;
				}
				else if (noise < 0.6) {
					TileID = Tiles.Land;
				}
				else if (noise > 0.6) {
					TileID = Tiles.Tree;
				}

				Map.TileSet( x, y, TileID );
			}
		}
	},

	/**
	 * Create a random simplex noise map, with basic tiles
	 * 
	 * @param {number} pFrequency 
	 * @param {number} pLacunarity 
	 * @param {number} pPersistance 
	 * @param {number} pOctaves 
	 */
	RandomSimplexNoise: function(pFrequency, pLacunarity, pPersistance, pOctaves ) {
		Tiles = this.GetTiles();

		print("SimplexNoise. frequency: " + pFrequency + " lac: " + pLacunarity + " per: " + pPersistance + " octaves:" + pOctaves);
		noises = Map.SimplexNoise(pOctaves, pFrequency, pLacunarity, pPersistance);
		
		for( y = 0; y < Map.getHeight(); ++y) {
			for( x = 0; x < Map.getWidth(); ++x ) {
				noise = noises[x][y];
				TileID = 0;

				if (noise < -0.500) {
					TileID = Tiles.Water;
				}
				else if (noise < -0.020) {
					TileID = Tiles.Water;
				}
				else if (noise < -0.000) {
					TileID = Tiles.Land;
				}
				else if (noise < 0.005) {
					TileID = Tiles.Land;
				}
				else if (noise > 0.300 && noise < 0.400) {
					TileID = Tiles.Land;// TileQuickSand;
				}
				else if (noise < 0.500) {
					TileID = Tiles.Land;
				}
				else if (noise < 0.700) {
					TileID = Tiles.Land;
				}
				else if (noise < 0.900) {
					TileID = Tiles.Tree;
				}
				else {
					TileID = Tiles.Tree;
				}

				Map.TileSet( x, y, TileID );
			}
		}
	}
	
};
