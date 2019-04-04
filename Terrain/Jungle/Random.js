
Terrain.Jungle.RandomSimplexIslands = function() {
	
	pOctaves = 5;
	pRadialEnabled = true;
	pRoughness = Map.getRandomFloat(0.01, 0.3);
	pScale = Map.getRandomFloat(0.01, 0.1);
	pSeed = Map.getRandomInt(1, 500);
	
	pOctaves = pOctaves + Math.log(pScale);
	print("scale: " + pScale + " rough: " + pRoughness + " seed: " + pSeed + " octaves:" + pOctaves);
	
	noises = Map.SimplexIslands(pOctaves, pRoughness, pScale, pSeed, pRadialEnabled);

	for( y = 0; y < Map.getHeight(); ++y) {
		for( x = 0; x < Map.getWidth(); ++x ) {
			
			noise =  noises[x][y];
			TileID = 0;

			if (noise < 0.100) {
				TileID = Terrain.Jungle.Tiles.Water;
			}
			else if (noise < 0.500) {
				TileID = Terrain.Jungle.Tiles.Land;
			}
			else {
				TileID = Terrain.Jungle.Tiles.Tree;
			}

			Map.TileSet( x, y, TileID );
		}
	}
};

Terrain.Jungle.RandomSimplexNoise = function() {

	scale = Map.getRandomFloat(0.01, 0.1);
	lacunarity = Map.getRandomFloat(0.1, 0.5);
	persistance = Map.getRandomFloat(0.1, 1.);	// higher produces more trees
	octaves = 5 + Math.log(scale);
	print("scale: " + scale + " lac: " + lacunarity + " per: " + persistance + " octaves:" + octaves);
	noises = Map.SimplexNoise(octaves, scale, lacunarity, persistance);

	for( y = 0; y < Map.getHeight(); ++y) {
		for( x = 0; x < Map.getWidth(); ++x ) {
			noise = noises[x][y];
			TileID = 0;

			if (noise < -0.500) {
				TileID = Terrain.Jungle.Tiles.Water;
			}
			else if (noise < -0.020) {
				TileID = Terrain.Jungle.Tiles.Water;
			}
			else if (noise < -0.000) {
				TileID = Terrain.Jungle.Tiles.Land;
			}
			else if (noise < 0.005) {
				TileID = Terrain.Jungle.Tiles.Land;
			}
			else if (noise > 0.300 && noise < 0.400) {
				TileID = Terrain.Jungle.Tiles.Land;// TileQuickSand;
			}
			else if (noise < 0.500) {
				TileID = Terrain.Jungle.Tiles.Land;
			}
			else if (noise < 0.700) {
				TileID = Terrain.Jungle.Tiles.Land;
			}
			else if (noise < 0.900) {
				TileID = Terrain.Jungle.Tiles.Tree;;
			}
			else {
				TileID = Terrain.Jungle.Tiles.Tree;;
			}

			Map.TileSet( x, y, TileID );
		}
	}
};
