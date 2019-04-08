
/**
 * 
 */
Objectives.DestroyEnemyBuildings.Random = function(pCount) {
	print("Placing enemy buildings");

	for(var count = 0; count < pCount; ++count) {
		
		position = Map.getRandomXYByFeatures(Terrain.Features.FlatGround(), 2, false);

		Session.BuildingPositions.push(position);

		Structures.PlaceBarracks( position.x, position.y );
	}
};
