
/**
 * 
 */
Objectives.DestroyEnemyBuildings.Random = function(pBuildingCount) {
	print("Placing enemy buildings");

	for (var building in pBuildingCount) {

		for(var sprite in pBuildingCount[building]) {

			Structures.PlaceRandom(building, sprite, pBuildingCount[building][sprite]);
		};
	};

};
