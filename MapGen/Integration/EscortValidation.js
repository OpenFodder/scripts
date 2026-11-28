var MapGen = MapGen || {};
MapGen.Integration = MapGen.Integration || {};

(function(pIntegration) {
    pIntegration.ValidateEscortObjectives = function(report) {
        var self = this;
        function actorRoutes(types, target, label) {
            if(!target) {
                self.LiveFail(report, label + "_destination_missing");
                return;
            }
            self.ValidateReachablePosition(report, label + "_destination_access",
                SpriteTypes.Player, Session.HumanPosition, target);
            var checked = 0;
            for(var typeIndex = 0; typeIndex < types.length; ++typeIndex) {
                var type = types[typeIndex];
                var actors = Map.getSpritesByType(type);
                for(var i = 0; i < actors.length; ++i, ++checked) {
                    var position = actors[i].getPosition();
                    self.ValidateReachablePosition(report, label + "_player_access:" + checked,
                        SpriteTypes.Player, Session.HumanPosition, position);
                    self.ValidateReachablePosition(report, label + "_escort_route:" + checked,
                        type, position, target);
                }
            }
            report.counts[label + "RoutesChecked"] = checked;
        }
        if(Settings.hasObjective(Objectives.RescueHostages) ||
            Settings.hasObjective(Objectives.RescueHostage)) {
            actorRoutes([SpriteTypes.Hostage],
                Session.isRescueTentPlaced() ? Session.RescueTentPosition : null, "hostage");
        }
        if(Settings.hasObjective(Objectives.GetCivilianHome)) {
            var homes = Map.getSpritesByType(SpriteTypes.Door_Civilian_Rescue);
            if(!homes.length) this.LiveFail(report, "civilian_home_door_missing");
            actorRoutes(this.CivilianHomeSpriteTypes(), Session.CivilianHomePosition, "civilian_home");
        }
    };
})(MapGen.Integration);
