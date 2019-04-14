
var Objectives = {
	
	KillAllEnemy: {
		ID: 1
	},
	DestroyEnemyBuildings: {
		ID: 2
	},
	RescueHostages: {
		ID: 3
	},
	ProtectCivilians: {
		ID: 4
	},
	KidnapLeader: {
		ID: 5
	},
	DestroyFactory: {
		ID: 6
	},
	DestroyComputer: {
		ID: 7
	},
	GetCivilianHome: {
		ID: 8
	},

	// CF2 Only
	ActivateSwitches: {
		ID: 9
	},
	RescueHostage: {
		ID: 10
	},

	/**
	 * Set an objective as required to be completed
	 * 
	 * @param {object} pObjective 
	 */
	Add: function(pObjective) {
		Engine.getPhase().ObjectiveAdd(pObjective);
	},

	/**
	 *
	 * @param {Array<Number>} pObjectives
	 */
	AddSet: function(pObjectives) {
		Engine.getPhase().ObjectivesClear();

		for( var x = 0; x < pObjectives.length; ++x) {
			this.Add(pObjectives[x]);
		}
	}

};
