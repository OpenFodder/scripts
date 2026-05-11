

/**
 * Create a civilian
 *
 * @return cPosition
 */
Objectives.GetCivilianHome.CreateCivilian = function() {
	print("Placing civilian");

	// Place a 'groups' of hostages
	var CivilianPosition = Map.getRandomXYByFeatures(Terrain.Features.FlatGround(), 2, true);
	Session.CivilianPositions.push(CivilianPosition);

	Map.SpriteAdd( SpriteTypes.Civilian_Spear, CivilianPosition.x, CivilianPosition.y );

	return CivilianPosition;
}

/**
 * Create the home for a civilian to return to
 *
 * @return cPosition
 */
Objectives.GetCivilianHome.CreateHome = function() {

	var found = false;
	var position = new cPosition(-1, -1);

	do {
		found = true;

		position = Map.getRandomXYByFeatures(Terrain.Features.FlatGround(), 3, false);
		for( var count = 0; count < Session.CivilianPositions.length; ++count) {

			if( Map.getDistanceBetweenPositions( Session.CivilianPositions[count], position) < Settings.GetMinimumDistance("civilian", "rescue") ) {
				found = false;
				break;
			}

		}

		if(!Reachability.VerifyReachable(SpriteTypes.Civilian, position, Session.HumanPosition)) {
			found = false;
		}

	} while( found == false );

	Structures.PlaceHut( position, "Civilian_Rescue" );
}

Objectives.GetCivilianHome.Random = function(pCount) {

	for( var count = 0; count < pCount; ++count)
		this.CreateCivilian();

	this.CreateHome();
};
