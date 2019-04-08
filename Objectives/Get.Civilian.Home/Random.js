

/**
 * Create a civilian
 *
 * @return cPosition
 */
Objectives.GetCivilianHome.CreateCivilian = function() {
	print("Placing civilian");

	if(pHostageCount == 0)
		++pHostageCount;

	if(pHasEnemyGuard == undefined)
	pHasEnemyGuard = true;

	// Place a 'groups' of hostages
	var CivilianPosition = Map.getRandomXYByFeatures(Terrain.Features.FlatGround(), 2, true);
	Session.CivilianPositions.push(CivilianPosition);

	Map.SpriteAdd( SpriteTypes.Civilian, position.x, position.y );

	return CivilianPosition;
}

/**
 * Create the home for a civilian to return to
 * 
 * @return cPosition
 */
Objectives.GetCivilianHome.CreateHome = function() {

}

Objectives.GetCivilianHome.Random = function(pCount) {
	
	this.CreateCivilian();
	this.CreateHome();

	// TODO
};
