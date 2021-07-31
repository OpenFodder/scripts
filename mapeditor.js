
Scenario.MapEditor = {

    Start: function(pMissionNumber, pPhaseNumber) {

		Scenario.Random.Start(pMissionNumber, pPhaseNumber);
    },

    Settings: function(pMissionNumber, pPhaseNumber) {
	   Settings.RandomEditor();
	   return;
    }
}

OpenFodder.start();
OpenFodder.createPhases(1, Scenario.MapEditor);
