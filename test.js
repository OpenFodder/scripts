
// Reset the map session
Session.Reset();

var Map = Engine.getMap();
var Mission = OpenFodder.getNextMission();
var Phase = OpenFodder.getNextPhase();

Map.Create(80, 50, Terrain.Types.Jungle, 0);
Terrain.Randomize();

/*
Phase.map = "map1";
Map.Create(80, 50, Terrain.Types.Jungle, 0);
Terrain.Randomize();
Human.RandomXY(3);
Objectives.KillAllEnemy.Random(10);
Objectives.AddRequired(Objectives.KillAllEnemy);

Phase.SetMinAggression(4);
Phase.SetMaxAggression(8);
*/

// Map2
/*
var Phase = Engine.phaseCreate();
Phase.map = "map2";
Phase.name = PhaseName.Generate();
*/

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