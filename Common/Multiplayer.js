var NetworkModes = {
    CoopCampaign: 0,
    Deathmatch: 1,
    SquadDeathmatch: 2,
    RescuePrisoner: 3,
    AvatarDeathmatch: 4,
    TeamAvatar: 5
};

var NetworkMapSizes = {
    Small: 0,
    Medium: 1,
    Large: 2,
    ExtraLarge: 3
};

var NetworkMapTerrains = {
    Random: 0,
    Jungle: 1,
    Desert: 2,
    Ice: 3,
    Moors: 4
};

var NetworkVehicleSets = {
    None: 0,
    Light: 1,
    Armed: 2,
    Tanks: 3,
    Mixed: 4
};

var NetworkPickupDensities = {
    Low: 0,
    Normal: 1,
    High: 2
};

var NetworkCoverDensities = {
    Sparse: 0,
    Normal: 1,
    Dense: 2,
    Heavy: 3
};

var NetworkMapProfiles = {
    Jungle: 0,
    Beach: 1,
    Ice: 2,
    Random: 3,
    Custom: 4,
    IceMaze: 5,
    IceNeck: 6,
    IceSkidooJump: 7,
    JungleMaze: 8,
    JungleNeck: 9,
    IceMazeXL: 10
};

var Multiplayer = {

    IsRescuePrisoner: function() {
        return Settings.Multiplayer.Mode == NetworkModes.RescuePrisoner;
    },

    VehicleTypeForTeam: function(pTeamIndex) {
        switch(Settings.Multiplayer.VehicleSet) {
            case NetworkVehicleSets.Light:
                return SpriteTypes.VehicleNoGun_Human;

            case NetworkVehicleSets.Armed:
                return SpriteTypes.VehicleGun_Human;

            case NetworkVehicleSets.Tanks:
                return SpriteTypes.Tank_Human;

            case NetworkVehicleSets.Mixed:
                var types = [
                    SpriteTypes.VehicleNoGun_Human,
                    SpriteTypes.VehicleGun_Human,
                    SpriteTypes.Tank_Human
                ];
                return types[(Map.getRandomInt(0, types.length - 1) + pTeamIndex) % types.length];

            default:
                return -1;
        }
    },

    VehiclePositionForTeam: function(pSpawn, pTeamIndex) {
        var offsets = [
            [40, 0],
            [-40, 0],
            [0, 40],
            [0, -40],
            [32, 32],
            [-32, -32]
        ];

        for(var index = 0; index < offsets.length; ++index) {
            var offset = offsets[(index + pTeamIndex) % offsets.length];
            var position = new cPosition(pSpawn.x + offset[0], pSpawn.y + offset[1]);
            if(Reachability.VerifyReachable(SpriteTypes.Player, pSpawn, position))
                return position;
        }

        return new cPosition(pSpawn.x + 32, pSpawn.y);
    },

    PlaceVehicles: function(pSpawns) {
        if(Settings.Multiplayer.VehicleSet == NetworkVehicleSets.None)
            return;

        for(var teamIndex = 0; teamIndex < pSpawns.length; ++teamIndex) {
            var type = this.VehicleTypeForTeam(teamIndex);
            if(type < 0)
                continue;

            var position = this.VehiclePositionForTeam(pSpawns[teamIndex], teamIndex);
            Map.SpriteAdd(type, position.x, position.y);
        }
    },

    CreateMatch: function() {
        var spawns = [];

        if(typeof MapGen !== "undefined" && MapGen.Integration)
            spawns = MapGen.Integration.MultiplayerTeamSpawns(Settings.Multiplayer.TeamCount);

        if(!spawns.length)
            spawns = Teams.FindTeamSpawns(Settings.Multiplayer.TeamCount);

        Teams.PlaceTeams(spawns);
        this.PlaceVehicles(spawns);

        if(this.IsRescuePrisoner())
            MatchObjectives.PlaceRescuePrisoner(spawns);

        Weapons.PlaceMultiplayerPickups(spawns);

        if(typeof MapGen !== "undefined" && MapGen.Integration)
            MapGen.Integration.PlaceMapDecor(Settings.GetBackgroundObjectCount());
    }
};
