
var Helicopters = {
	
	Human: {
		
		/**
		 *  Add a homing missile helicopter at a random X/Y
		 *   in a path which is accessible on foot to the player
		 */
		RandomHoming: function() {
			Attempts = 0;
			Distance = [];
			
			print("Placing helicopter");

			// Find a position which can be accessed by walking
			do {
				Position = Map.getRandomXYByFeatures(Terrain.Features.FlatGround(), 1);
				Distance = Map.calculatePathBetweenPositions(SpriteTypes.Player, Position, Session.HumanPosition);
				++Attempts;
			} while(Distance.length < 10 && Attempts < 10);

			if(Attempts >= 10)
				print("Failed finding location for helicopter, placing anyway");
			
			Map.SpriteAdd( SpriteTypes.Helicopter_Homing_Human, Position.x, Position.y );

			return Position;
		},
			
		/**
		 * Add a random helicopter
		 */
		Random: function() {
			Position = Map.getRandomXYByFeatures(Terrain.Features.FlatGround(), 1);

			// TODO
		}
	}
	

};
