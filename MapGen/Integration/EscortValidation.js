var MapGen = MapGen || {};
MapGen.Integration = MapGen.Integration || {};

(function(pIntegration) {
    pIntegration.ValidateEscortObjectives = function(report) {
        var self = this;
        function actorRoutes(type, target, label) {
            var actors = Map.getSpritesByType(type);
            if(!target) {
                self.LiveFail(report, label + "_destination_missing");
                return;
            }
            self.ValidateReachablePosition(report, label + "_destination_access",
                SpriteTypes.Player, Session.HumanPosition, target);
            for(var i = 0; i < actors.length; ++i) {
                var position = actors[i].getPosition();
                self.ValidateReachablePosition(report, label + "_player_access:" + i,
                    SpriteTypes.Player, Session.HumanPosition, position);
                self.ValidateReachablePosition(report, label + "_escort_route:" + i,
                    type, position, target);
            }
            report.counts[label + "RoutesChecked"] = actors.length;
        }
        if(Settings.hasObjective(Objectives.RescueHostages) ||
            Settings.hasObjective(Objectives.RescueHostage)) {
            actorRoutes(SpriteTypes.Hostage,
                Session.isRescueTentPlaced() ? Session.RescueTentPosition : null, "hostage");
        }
        if(Settings.hasObjective(Objectives.GetCivilianHome)) {
            var homes = Map.getSpritesByType(SpriteTypes.Door_Civilian_Rescue);
            if(!homes.length) this.LiveFail(report, "civilian_home_door_missing");
            actorRoutes(SpriteTypes.Civilian_Spear, Session.CivilianHomePosition, "civilian_home");
        }
    };
})(MapGen.Integration);
