
var Human = {

	/**
	 * Randomize the human starting  position
	 * 
	 * @param {number} pCount 
	 */
	RandomXY: function(pCount) {
		
		Session.HumanPosition = Map.getRandomXYByFeatures(Terrain.Features.FlatGround(), 3);
		// TODO: Check for enemy within X range

		Position = new cPosition();
		Position.x = Session.HumanPosition.x;
		Position.y = Session.HumanPosition.y;

		for(var count = 0; count < pCount; ++count) {

			Map.SpriteAdd( SpriteTypes.Player, Position.x, Position.y );

			if(count / 1)
				Position.x += 16;
			else
				Position.y += 16;
		}
	}
};