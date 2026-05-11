
var Weapons = {

    
    /**
     * 
     * @param {number}  pCount      
     * @param {boolean} pWalkable   
     */
    RandomGrenades: function(pCount, pWalkable) {
        if(pWalkable === undefined)
            pWalkable = false;

        for(var count = 0; count < pCount; ++count ) {
            var Position = null;
            if(pWalkable)
                Position = Positioning.RandomWalkable(SpriteTypes.Player, Session.HumanPosition);
            else
                Position = Map.getRandomXYByFeatures(Terrain.Features.FlatGround(), 1, true);
                
            Map.SpriteAdd( SpriteTypes.GrenadeBox, Position.x, Position.y );
        }
    },

    /**
     * 
     * @param {number} pCount 
     * @param {boolean} pWalkable 
     */
    RandomRockets: function(pCount, pWalkable) {
        if(pWalkable === undefined)
            pWalkable = false;

        for(var count = 0; count < pCount; ++count ) {
            var Position = null;
            if(pWalkable)
                Position = Positioning.RandomWalkable(SpriteTypes.Player, Session.HumanPosition);
            else
                Position = Map.getRandomXYByFeatures(Terrain.Features.FlatGround(), 1, true);
                
            Map.SpriteAdd( SpriteTypes.RocketBox, Position.x, Position.y );
        }
    },

    PlaceMultiplayerPickups: function(pSpawns) {
        if(typeof MapGen !== "undefined" && MapGen.Integration &&
            MapGen.Integration.PlaceMultiplayerPickups(pSpawns)) {
            return;
        }

        var path = Teams.PathBetweenTeams(pSpawns);

        if(path.length > 8) {
            var center = path[Math.floor(path.length / 2)];
            var left = path[Math.floor(path.length / 3)];
            var right = path[Math.floor((path.length * 2) / 3)];

            Map.SpriteAdd(SpriteTypes.GrenadeBox, center.x, center.y);
            Map.SpriteAdd(SpriteTypes.RocketBox, left.x, left.y);
            Map.SpriteAdd(SpriteTypes.GrenadeBox, right.x, right.y);
            return;
        }

        this.RandomGrenades(Settings.Multiplayer.PickupSets, true);
        this.RandomRockets(Math.max(1, Math.floor(Settings.Multiplayer.PickupSets / 2)), true);
    }
};
