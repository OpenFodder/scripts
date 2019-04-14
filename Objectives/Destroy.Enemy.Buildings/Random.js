
/**
 * 
 */
Objectives.DestroyEnemyBuildings.Random = function(pCount) {
	print("Placing enemy buildings");

	Structures.PlaceRandom("Barracks", "soldier", pCount);
	Structures.PlaceRandom("Bunker", "soldier", pCount / 2);
};
