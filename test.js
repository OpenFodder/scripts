
/**
 * Randomize the map contents
 */
function createMapContent() {

	Human.RandomXY(Settings.GetPlayerCount());
	Background.Random( Settings.GetBackgroundObjectCount() );

	// Randomize kill all enemy?
	if(Settings.hasObjective(Objectives.KillAllEnemy))
		Objectives.KillAllEnemy.Random(Settings.GetEnemyCount());

	// Randomsize Destroy enemy buildings
	if(Settings.hasObjective(Objectives.DestroyEnemyBuildings))
		Objectives.DestroyEnemyBuildings.Random(Settings.GetEnemyBuildingCount());

	// Random Rescue Hostages
	if(Settings.hasObjective(Objectives.RescueHostages)) {
		for(var x = 0; x < Settings.GetHostageCount(); ++x) {
			Objectives.RescueHostages.Random(Settings.GetHostageGroupSize());
		}
	}

	// Random Get Civilian home
	if(Settings.hasObjective(Objectives.GetCivilianHome)) {
		Objectives.GetCivilianHome.Random();
	}

	Structures.PlaceBuildings(Settings.GetCivilianBuildingCount());

	Weapons.RandomGrenades(Settings.GetMinimumGrenades());
	Weapons.RandomRockets(Settings.GetMinimumRockets() / 2);
}

function createSmallMap() {
	var Phase = OpenFodder.getNextPhase();

	Settings.Width = 40;
	Settings.Height = 30;
	Settings.Terrain =Terrain.Types.Ice;

	Settings.Objectives = [];
	Settings.setObjectives( [Objectives.KillAllEnemy, Objectives.DestroyEnemyBuildings, Objectives.GetCivilianHome] );

	createPhases(1);
}

// Reset the map session
Settings.Reset();

OpenFodder.printLarge("PLEASE WAIT", 0, 15);
var Mission = OpenFodder.getNextMission();
OpenFodder.printSmall("Creating Phases", 0, 45);

OpenFodder.createPhases(1, createMapContent);

//OpenFodder.createMissions(2, [1, 2], createMapContent);
//createSmallMap();
// Random Terrain
//createPhases(1, Map.getRandomInt(0, 4) );

// Some Fun
/*
RandomLast = null;

for(count = 0; count < 5; ++count) {
	Random = Map.getRandomXYByFeatures(Terrain.Features.FlatGround(), 1, false);

	if(RandomLast != null)
		Strange.PlaceSpritesOnPath(SpriteTypes.GrenadeBox,Random, RandomLast);

	Strange.PlaceSpritesOnPath(SpriteTypes.GrenadeBox, Random, Session.HumanPosition);
	RandomLast = Random;
}*/

/*
for(count = 0; count < Session.HostageGroupPositions.length; ++count) {

	//Strange.PlaceSpritesOnPath(SpriteTypes.Enemy, Session.HostageGroupPositions[count], Session.HumanPosition);
	Strange.PlaceSpritesOnPath(SpriteTypes.GrenadeBox, Session.HostageGroupPositions[count], Session.HumanPosition);

	//Strange.PlaceSpritesOnPath(SpriteTypes.Enemy, Session.HostageGroupPositions[count], Session.RescueTentPosition);
	Strange.PlaceSpritesOnPath(SpriteTypes.GrenadeBox, Session.HostageGroupPositions[count], Session.RescueTentPosition);
}
Map.SpriteAdd(SpriteTypes.Helicopter_Missile_Human,  Session.HumanPosition.x,  Session.HumanPosition.y);

if(Session.RescueHelicopter !== null)
	Strange.PlaceSpritesOnPath(SpriteTypes.GrenadeBox, Session.RescueHelicopter, Session.HumanPosition);

*/