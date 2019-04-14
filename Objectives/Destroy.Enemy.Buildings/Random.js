
/**
 * 
 */
Objectives.DestroyEnemyBuildings.Random = function(pEnemyBuildings) {
	print("Placing enemy buildings");

	for (var building in pEnemyBuildings) {

		for(var sprite in pEnemyBuildings[building]) {

			Structures.PlaceRandom(building, sprite, pEnemyBuildings[building][sprite]);
		};
	};

};
