
/**
 * 
 */
Objectives.DestroyEnemyBuildings.Random = function(pCount) {
	
	for(var count = 0; count < pCount; ++count) {
		
		position = Map.getRandomXYByFeatures(Terrain.Features.FlatGround(), 1);

		Map.addBarracks( position.x, position.y );
	}
};
