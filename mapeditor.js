
Scenario.MapEditor = {

    Start: function(pMissionNumber, pPhaseNumber) {

    },

    Settings: function(pMissionNumber, pPhaseNumber) {
	   Settings.RandomEditor();
	   return;
    }
}

OpenFodder.start();

Settings.RandomEditor();
OpenFodder.createMap();
Settings.RandomNoise();