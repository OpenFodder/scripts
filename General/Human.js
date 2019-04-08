
var Human = {

	/**
	 * Randomize the human starting  position
	 * 
	 * @param {number} pCount 
	 */
	RandomXY: function(pCount) {
		print("Placing human players");

		Session.HumanPosition = Map.getRandomXYByFeatures(Terrain.Features.FlatGround(), 3, false);
		// TODO: Check for enemy within X range

		var Position = new cPosition();
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
