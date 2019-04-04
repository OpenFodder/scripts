
/**
 * @param {number} pCount Number of Enemy troops to place
 */
Objectives.KillAllEnemy.CreateEnemyTroop = function(pCount) {
	
	for(var count = 0; count < pCount; ++count) {
		position = Map.getRandomXYByFeatures(Terrain.Features.FlatGround(), 1);
		Map.SpriteAdd( SpriteTypes.Enemy, position.x, position.y );
	}
}

/**
 * 
 */
Objectives.KillAllEnemy.Random = function(pCount) {

	this.CreateEnemyTroop(pCount);

};
