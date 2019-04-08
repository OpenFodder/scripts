
function createRandom() {
	Session.Reset();

	Human.RandomXY(3);

	Objectives.KillAllEnemy.Random(10);

	Objectives.DestroyEnemyBuildings.Random(2);

	Objectives.RescueHostages.Random(1);
	Objectives.RescueHostages.Random(1);
	Objectives.RescueHostages.Random(1);
	Objectives.RescueHostages.Random(1);

	Phase.SetMinAggression(4);
	Phase.SetMaxAggression(8);

	Objectives.AddRequired(Objectives.KillAllEnemy);
	Objectives.AddRequired(Objectives.DestroyEnemyBuildings);
	Objectives.AddRequired(Objectives.RescueHostages);

	Weapons.RandomGrenades(Session.RequiredMinimumGrenades());
	Weapons.RandomRockets(Session.RequiredMinimumRockets() / 2);

	Validation.ValidateMap();
}

function createPhases(pCount) {

	for(var count = 0; count < pCount; ++count) {

		print("Creating phase: " + count);
		var Phase = OpenFodder.getNextPhase();

		Phase.map = "phase" + count;
		Map.Create(80, 50, Terrain.Types.Jungle, 0);
		Terrain.Randomize();
		createRandom();
	}
}

function createMissions(pMissions, pPhases) {

	for(var count = 0; count < pMissions; ++count) {
		print("Creating mission: " + count);
		var Mission = OpenFodder.getNextMission();

		createPhases(pPhases[count]);
	}
}

// Reset the map session
Session.Reset();

var Map = Engine.getMap();

createMissions(2, [1, 2]);

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

print("Starting X: " + Session.HumanPosition.x + " Y: " + Session.HumanPosition.y);
print("Tent Starting X: " + Session.RescueTentPosition.x + " Y: " + Session.RescueTentPosition.y);


/*
for(count = 0; count < Session.HostageGroupPositions.length; ++count) {

	//Strange.PlaceSpritesOnPath(SpriteTypes.Enemy, Session.HostageGroupPositions[count], Session.HumanPosition);
	Strange.PlaceSpritesOnPath(SpriteTypes.GrenadeBox, Session.HostageGroupPositions[count], Session.HumanPosition);

	//Strange.PlaceSpritesOnPath(SpriteTypes.Enemy, Session.HostageGroupPositions[count], Session.RescueTentPosition);
	Strange.PlaceSpritesOnPath(SpriteTypes.GrenadeBox, Session.HostageGroupPositions[count], Session.RescueTentPosition);
}

if(Session.RescueHelicopter !== null)
	Strange.PlaceSpritesOnPath(SpriteTypes.GrenadeBox, Session.RescueHelicopter, Session.HumanPosition);
}
*/