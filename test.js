
/**
 * Create random map objectives
 */
function createRandom() {
	Session.Reset();

	Human.RandomXY(3);
	Background.RandomPalms(10);
	Background.RandomBushes1(10);
	Background.RandomBlooms(5);

	Objectives.KillAllEnemy.Random(10);

	Objectives.DestroyEnemyBuildings.Random(2);

	Objectives.RescueHostages.Random(1);
	Objectives.RescueHostages.Random(1);
	Objectives.RescueHostages.Random(1);
	Objectives.RescueHostages.Random(1);
	Objectives.GetCivilianHome.Random();

	Objectives.AddRequired(Objectives.KillAllEnemy);
	Objectives.AddRequired(Objectives.DestroyEnemyBuildings);
	Objectives.AddRequired(Objectives.RescueHostages);
	//Objectives.AddRequired(Objectives.ProtectCivilians);

	Weapons.RandomGrenades(Session.RequiredMinimumGrenades());
	Weapons.RandomRockets(Session.RequiredMinimumRockets() / 2);

	Validation.ValidateMap();
}

/**
 * Create a number of phases in the current mission
 * 
 * @param {number} pCount 
 * @param {number} pTileType 
 */
function createPhases(pCount, pTileType) {

	var Campaign = Engine.getCampaign();
	
	mapname = "m" + Campaign.getMissions().length;

	for(var count = 0; count < pCount; ++count) {

		Map.Create( Map.getRandomInt(40, 150), Map.getRandomInt(40, 150), pTileType, 0);

		var Phase = OpenFodder.getNextPhase();

		Phase.map = mapname + "p" + count;
		Phase.SetAggression(4, 8);

		Terrain.Randomize();
		createRandom();
	}
}

/**
 * Create a number of missions
 * 
 * @param {number} pMissions 
 * @param {Array<number>} pPhases Number of phases per mission to create
 */
function createMissions(pMissions, pPhases) {

	for(var count = 0; count < pMissions; ++count) {
		var Mission = OpenFodder.getNextMission();
		Terrain.Types.Jungle

		createPhases(pPhases[count], Map.getRandomInt(0, 4));
	}
}

function createSmallMap() {
	var Phase = OpenFodder.getNextPhase();
	Map.Create( 40,30 , Terrain.Types.Jungle, 0);
	Terrain.Randomize();

	Human.RandomXY(3);
	Objectives.KillAllEnemy.Random(2);
	Objectives.DestroyEnemyBuildings.Random(2);
	//Objectives.RescueHostages.Random(1);
	Objectives.GetCivilianHome.Random();

	Objectives.AddRequired(Objectives.KillAllEnemy);
	//Objectives.AddRequired(Objectives.DestroyEnemyBuildings);
	//Objectives.AddRequired(Objectives.RescueHostages);
	//Objectives.AddRequired(Objectives.GetCivilianHome);

	Weapons.RandomGrenades(Session.RequiredMinimumGrenades());

	Validation.ValidateMap();
}

// Reset the map session
Session.Reset();

var Map = Engine.getMap();

//createMissions(2, [1, 2]);

OpenFodder.printLarge("PLEASE WAIT", 0, 15);
var Mission = OpenFodder.getNextMission();
OpenFodder.printSmall("Creating Phases", 0, 45);
createPhases(1, Terrain.Types.Jungle );
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