var PhaseName = {

	Jungle: {

	},

	Desert: {

	},

	Ice: {

	},

	/**
	 * Genereate a random phase name
	 */
	Generate: function() {

		switch(Map.getTileType()) {

			case Terrain.Types.Jungle:
				return this.Jungle.Random();
			case Terrain.Types.Desert:
				return this.Desert.Random();
			case Terrain.Types.Ice:
				return this.Ice.Random();

			case Terrain.Types.Moors:
			case Terrain.Types.Interior:
			case Terrain.Types.AmigaFormat:

			default:
				return this.Jungle.Random();
		}
	}
}
