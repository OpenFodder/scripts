
/**
 * Create a helicopter, if required, to rescue hostages
 *
 * This will only create a helicopter if a hostage requires one to reach the rescue tent
 * 
 * @return {cPosition} Position of Helicopter
 */
Objectives.RescueHostages.CreateHelicopter = function() {
	needHelicopter = false;

	if(Session.RescueHelicopter !== null)
		return Session.RescueHelicopter;

	// Check if a walkable path between the humans and the tent
	Distance = Map.calculatePathBetweenPositions(SpriteTypes.Player, Session.RescueTentPosition, Session.HumanPosition);
	if(Distance.length == 0)
		needHelicopter = true;
	
	// Check if any of the hostage groups cant walk to the rescue tent
	if(!needHelicopter) {
		for( x = 0; x < Session.HostageGroupPositions.length; ++x) {
			Distance = Map.calculatePathBetweenPositions(SpriteTypes.Hostage, Session.RescueTentPosition, Session.HostageGroupPositions[x]);
			if(Distance.length == 0) {
				needHelicopter = true;
				break;
			}
		}
	}

	if(needHelicopter)
		Session.RescueHelicopter = Helicopters.Human.RandomHoming();
	
	return Session.RescueHelicopter;
};

/**
 * Create a hostage rescue tent
 * 
 * @return {cPosition} Position of tent
 */
Objectives.RescueHostages.CreateTent = function() {

	TentSprites = Map.getSpritesByType(SpriteTypes.Hostage_Rescue_Tent);
	if(TentSprites.length == 0) {
		Attempts = 0;

		print("Placing rescue tent");
		// TODO: Loop all known groups
		// Find a position for the tent which is more than 50 away from the first hostage group
		do {
			Position = Map.getRandomXYByFeatures(Terrain.Features.FlatGround(), 1);
			++Attempts;
		} while( Map.getDistanceBetweenPositions(Session.HostageGroupPositions[0], Position) < 50 && Attempts < 10);
		
		if(Attempts == 10)
			print("Failed finding location for rescue tent, placing anyway");

		Session.RescueTentPosition = Position;
		Map.SpriteAdd( SpriteTypes.Hostage_Rescue_Tent, Position.x, Position.y );
	} else {
		Session.RescueTentPosition = TentSprites[0].getPosition();
	}

	return Session.RescueTentPosition;
};

/**
 * Create a group of hostages
 *
 * @param {number} pHostageCount Number of hostages to be placed
 * @param {boolean} pHasEnemyGuard Place an enemy soldier with each hostage
 *
 * @return cPosition
 */
Objectives.RescueHostages.CreateHostages = function(pHostageCount, pHasEnemyGuard) {
	print("Placing hostages");

	if(pHostageCount == 0)
		++pHostageCount;

	if(pHasEnemyGuard == undefined)
	pHasEnemyGuard = true;

	// Place a 'groups' of hostages
	HostagePosition = Map.getRandomXYByFeatures(Terrain.Features.FlatGround(), 2);
	Session.HostageGroupPositions.push(HostagePosition);

	// Place an amount of hostages near this group
	for(var count = 0; count < pHostageCount; ++count) {
		
		position = new cPosition();
		position.x = HostagePosition.x + (16 * count);
		position.y = HostagePosition.y;

		Map.SpriteAdd( SpriteTypes.Hostage, position.x, position.y );
		if(pHasEnemyGuard)
			Map.SpriteAdd( SpriteTypes.Enemy, position.x + 8, position.y );
	}	

	return HostagePosition;
}

/**
 * Add a random hostage, rescue tent and helicopter (if needed) to the map
 * 
 * @param {number} pHostageCount How many hostages to place
 */
Objectives.RescueHostages.Random = function(pHostageCount) {

	this.CreateHostages(pHostageCount, true);
	this.CreateTent();
	this.CreateHelicopter();
};
