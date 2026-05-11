var Teams = {

    MinimumSpawnDistance: 560,

    ClonePosition: function(pPosition) {
        return new cPosition(pPosition.x, pPosition.y);
    },

    FindTeamSpawns: function(pTeamCount) {
        if(pTeamCount === undefined)
            pTeamCount = Settings.Multiplayer.TeamCount;

        var first = new cPosition(-1, -1);
        var second = new cPosition(-1, -1);
        var path = [];
        var found = false;

        for(var attempt = 0; attempt < 120; ++attempt) {
            first = Map.getRandomXYByFeatures(Terrain.Features.FlatGround(), 3, false);
            second = Map.getRandomXYByFeatures(Terrain.Features.FlatGround(), 3, false);

            if(first.x < 0 || second.x < 0)
                continue;

            if(Map.getDistanceBetweenPositions(first, second) < this.MinimumSpawnDistance)
                continue;

            path = Map.calculatePathBetweenPositions(SpriteTypes.Player, first, second);
            if(path.length > 12) {
                found = true;
                break;
            }
        }

        if(!found) {
            first = Map.getRandomXYByFeatures(Terrain.Features.FlatGround(), 2, false);
            if(first.x < 0)
                first = Map.getRandomXYByFeatures(Terrain.Features.FlatGround(), 1, true);

            second = Positioning.RandomWalkable(SpriteTypes.Player, first, 80);
        }

        Session.HumanPosition = first;
        Session.TeamSpawns = [first, second];
        return Session.TeamSpawns.slice(0, Math.max(1, Math.min(pTeamCount, 2)));
    },

    FindNearbyWalkable: function(pCenter, pTeamIndex) {
        var offsets = [
            [-48, 0],
            [48, 0],
            [0, -48],
            [0, 48],
            [-32, -32],
            [32, -32],
            [-32, 32],
            [32, 32]
        ];

        for(var index = 0; index < offsets.length; ++index) {
            var offsetIndex = (index + pTeamIndex) % offsets.length;
            var candidate = new cPosition(
                pCenter.x + offsets[offsetIndex][0],
                pCenter.y + offsets[offsetIndex][1]
            );
            if(Reachability.VerifyReachable(SpriteTypes.Player, pCenter, candidate))
                return candidate;
        }

        return this.ClonePosition(pCenter);
    },

    PlaceTeam: function(pTeamIndex, pCenter, pCount) {
        var offsets = [
            [-16, -8],
            [0, -8],
            [-16, 8],
            [0, 8],
            [16, -8],
            [16, 8]
        ];

        Session.PlayerSpawns[pTeamIndex] = [];

        for(var index = 0; index < pCount; ++index) {
            var offset = offsets[index % offsets.length];
            var position = new cPosition(pCenter.x + offset[0], pCenter.y + offset[1]);
            if(typeof MapGen !== "undefined" &&
                MapGen.Integration &&
                MapGen.Integration.AdjustMultiplayerPlayerSpawnPosition &&
                typeof Session !== "undefined" &&
                Session.MapGenContext) {
                position = MapGen.Integration.AdjustMultiplayerPlayerSpawnPosition(
                    Session.MapGenContext,
                    pCenter,
                    position,
                    Session.PlayerSpawns[pTeamIndex]
                );
            }
            Session.PlayerSpawns[pTeamIndex].push(position);
            Map.SpriteAdd(SpriteTypes.Player, position.x, position.y);
        }
    },

    PlaceTeams: function(pSpawns) {
        var teamCount = Math.min(pSpawns.length, Settings.Multiplayer.TeamCount);
        for(var teamIndex = 0; teamIndex < teamCount; ++teamIndex) {
            this.PlaceTeam(teamIndex, pSpawns[teamIndex], Settings.Multiplayer.SquadTroopsPerTeam);
        }
    },

    PathBetweenTeams: function(pSpawns) {
        if(pSpawns.length < 2)
            return [];

        return Map.calculatePathBetweenPositions(SpriteTypes.Player, pSpawns[0], pSpawns[1]);
    },

    PositionOnTeamPath: function(pSpawns, pFraction) {
        var path = this.PathBetweenTeams(pSpawns);
        if(path.length > 8)
            return path[Math.floor(path.length * pFraction)];

        if(pSpawns.length < 2)
            return this.ClonePosition(pSpawns[0]);

        return new cPosition(
            Math.floor((pSpawns[0].x + pSpawns[1].x) / 2),
            Math.floor((pSpawns[0].y + pSpawns[1].y) / 2)
        );
    }
};
