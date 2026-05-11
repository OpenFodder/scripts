var MatchObjectives = {

    PlaceRescuePrisoner: function(pSpawns) {
        var prisoner = (typeof MapGen !== "undefined" && MapGen.Integration) ?
            MapGen.Integration.MultiplayerObjectivePosition(pSpawns) :
            Teams.PositionOnTeamPath(pSpawns, 0.5);

        Session.ObjectivePositions = [prisoner];
        Map.SpriteAdd(SpriteTypes.Hostage, prisoner.x, prisoner.y);

        this.PlaceExtractionZones(pSpawns);
    },

    PlaceExtractionZones: function(pSpawns) {
        var planned = (typeof MapGen !== "undefined" && MapGen.Integration) ?
            MapGen.Integration.MultiplayerExtractionZones(pSpawns) :
            [];

        Session.ExtractionZones = [];
        for(var teamIndex = 0; teamIndex < pSpawns.length; ++teamIndex) {
            var zone = planned[teamIndex] || Teams.FindNearbyWalkable(pSpawns[teamIndex], teamIndex);
            Session.ExtractionZones[teamIndex] = zone;
            Map.SpriteAdd(SpriteTypes.Hostage_Rescue_Tent, zone.x, zone.y);
        }
    }
};
