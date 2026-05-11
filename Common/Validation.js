/**
 * OpenFodder
 *
 * Map objective verification
 */

var Validation = {

    CreateReport: function(pMode) {
        return {
            ok: true,
            mode: pMode || "campaign",
            reasons: []
        };
    },

    Fail: function(pReport, pReason) {
        pReport.ok = false;
        pReport.reasons.push(pReason);
        print("Validation failed: " + pReason);
    },

    FinishReport: function(pReport) {
        Session.RuntimeValidation = pReport;
        if(pReport.ok)
            print("Validation passed: " + pReport.mode);
        return pReport;
    },

    /**
     * Ensure a path exists between human sprites and sprites of type pSpriteType.
     *
     * @param {number} pSpriteType Type of sprites to ensure a path exists between
     */
    WalkToSprites: function(pSpriteType) {
        var Sprites = Map.getSpritesByType(pSpriteType);

        for(var x = 0; x < Sprites.length; ++x) {
            if(!Reachability.VerifyReachable(SpriteTypes.Player, Sprites[x].getPosition(), Session.HumanPosition))
                return false;
        }
        return true;
    },

    CountReachableSprites: function(pSpriteType, pFrom) {
        var Sprites = Map.getSpritesByType(pSpriteType);
        var count = 0;

        for(var index = 0; index < Sprites.length; ++index) {
            if(Reachability.VerifyReachable(SpriteTypes.Player, Sprites[index].getPosition(), pFrom))
                ++count;
        }

        return count;
    },

    CanWalkBetween: function(pSpriteType, pFrom, pTo) {
        return Reachability.VerifyReachable(pSpriteType, pFrom, pTo);
    },

    ValidateMap: function() {
        var report;

        if(Settings.Multiplayer.Enabled)
            report = this.ValidateMultiplayerMap();
        else
            report = this.ValidateCampaignMap();

        if(!report.ok)
            throw new Error("Map validation failed: " + report.reasons.join(", "));

        return report;
    },

    /**
     * Ensure the campaign/random-map objectives can be completed.
     */
    ValidateCampaignMap: function() {
        print("Validating objectives");

        var report = this.CreateReport("campaign");

        this.canKillAllEnemy(report);
        this.canDestroyEnemyBuilding(report);
        this.canHostageRescue(report);
        this.canAccessWeapons(report);

        if(Session.HelicopterMinimum >= 0 && this.AllowCampaignHelicopterFallback()) {
            var type = SpriteTypes.Helicopter_Grenade_Human + Session.HelicopterMinimum;
            Session.Helicopter = Helicopters.Human.Random(type);

            if(!Session.Helicopter || !Reachability.VerifyReachable(SpriteTypes.Player, Session.Helicopter, Session.HumanPosition))
                this.Fail(report, "campaign_helicopter_fallback_unreachable");
            if(!Helicopters.Human.HaveAny())
                this.Fail(report, "campaign_helicopter_fallback_missing");
        }

        return this.FinishReport(report);
    },

    AllowCampaignHelicopterFallback: function() {
        var context = Session.MapGenContext || null;
        var profile = context && context.Profile ? context.Profile : null;

        if(profile &&
            profile.GeneratorCore === "official_grammar" &&
            profile.TargetPackProfile === "grammar_beach" &&
            profile.AllowCampaignHelicopterFallback !== true) {
            print("Skipping campaign helicopter fallback for grammar beach profile");
            return false;
        }

        return true;
    },

    /**
     * Validate multiplayer spawn, pickup, and objective reachability.
     */
    ValidateMultiplayerMap: function() {
        print("Validating multiplayer map");

        var report = this.CreateReport("multiplayer");

        if(!Session.TeamSpawns || !Session.TeamSpawns.length) {
            this.Fail(report, "multiplayer_team_spawns_missing");
            return this.FinishReport(report);
        }

        for(var teamIndex = 0; teamIndex < Session.TeamSpawns.length; ++teamIndex) {
            var teamSpawn = Session.TeamSpawns[teamIndex];

            for(var enemyIndex = 0; enemyIndex < Session.TeamSpawns.length; ++enemyIndex) {
                if(enemyIndex == teamIndex)
                    continue;

                if(!this.CanWalkBetween(SpriteTypes.Player, teamSpawn, Session.TeamSpawns[enemyIndex]))
                    this.Fail(report, "multiplayer_team_spawn_path:" + teamIndex + ":" + enemyIndex);
            }

            for(var objectiveIndex = 0; objectiveIndex < Session.ObjectivePositions.length; ++objectiveIndex) {
                if(!this.CanWalkBetween(SpriteTypes.Player, teamSpawn, Session.ObjectivePositions[objectiveIndex]))
                    this.Fail(report, "multiplayer_objective_path:" + teamIndex + ":" + objectiveIndex);
            }

            for(var zoneIndex = 0; zoneIndex < Session.ExtractionZones.length; ++zoneIndex) {
                if(!this.CanWalkBetween(SpriteTypes.Player, teamSpawn, Session.ExtractionZones[zoneIndex]))
                    this.Fail(report, "multiplayer_extraction_path:" + teamIndex + ":" + zoneIndex);
            }
        }

        this.canAccessMultiplayerPickups(report);
        return this.FinishReport(report);
    },

    canAccessMultiplayerPickups: function(pReport) {
        var pickupTypes = [SpriteTypes.GrenadeBox, SpriteTypes.RocketBox];

        for(var typeIndex = 0; typeIndex < pickupTypes.length; ++typeIndex) {
            var Pickups = Map.getSpritesByType(pickupTypes[typeIndex]);
            for(var pickupIndex = 0; pickupIndex < Pickups.length; ++pickupIndex) {
                var pickupPosition = Pickups[pickupIndex].getPosition();
                var reachable = false;

                for(var teamIndex = 0; teamIndex < Session.TeamSpawns.length; ++teamIndex) {
                    if(this.CanWalkBetween(SpriteTypes.Player, Session.TeamSpawns[teamIndex], pickupPosition)) {
                        reachable = true;
                        break;
                    }
                }

                if(!reachable)
                    this.Fail(pReport, "multiplayer_pickup_path:" + pickupTypes[typeIndex] + ":" + pickupIndex);
            }
        }
    },

    /**
     * Can we access enough weapons to complete the map.
     */
    canAccessWeapons: function(pReport) {
        print("Validate weapons access");

        if(!Settings.hasObjective(Objectives.DestroyEnemyBuildings))
            return;
        if(Session.MapGenContext &&
            Session.MapGenContext.Profile &&
            Session.MapGenContext.Profile.GeneratorCore === "official_grammar" &&
            Session.MapGenContext.Profile.GrammarLiveObjectiveLabel !== "destroy_buildings")
            return;

        // Official grammar already validates reachable explosive support
        // against the actual enemy-building count. The legacy check below is
        // grenade-only and used to append RandomWalkable boxes after MapGen had
        // finished, producing unplanned caches in empty fields.
        var context = Session.MapGenContext || null;
        var profile = context && context.Profile ? context.Profile : null;
        if(profile && profile.GeneratorCore === "official_grammar") {
            if(!context.LiveValidation || !context.LiveValidation.ok) {
                this.Fail(pReport, "campaign_grammar_weapon_support_unvalidated");
            }
            return;
        }

        var required = Session.RequiredMinimumGrenades();
        var canWalkTo = this.CountReachableSprites(SpriteTypes.GrenadeBox, Session.HumanPosition);

        if(canWalkTo >= required)
            return;

        if(Session.HelicopterMinimum >= 0)
            return;

        Weapons.RandomGrenades(required - canWalkTo, true);
        canWalkTo = this.CountReachableSprites(SpriteTypes.GrenadeBox, Session.HumanPosition);

        if(canWalkTo < required)
            Session.RequireHelicopter(0);
    },

    /**
     * Can we walk to all enemy sprites.
     */
    canKillAllEnemy: function(pReport) {
        if(!Settings.hasObjective(Objectives.KillAllEnemy))
            return;

        print("Validate kill all enemy");
        if(!this.WalkToSprites(SpriteTypes.Enemy))
            Session.RequireHelicopter(0);
    },

    /**
     * Can we destroy all enemy buildings.
     */
    canDestroyEnemyBuilding: function(pReport) {
        if(!Settings.hasObjective(Objectives.DestroyEnemyBuildings))
            return;

        print("Validate destroy enemy buildings");
        if(Helicopters.Human.HaveAny())
            return;

        var Buildings = Session.getEnemyBuildings();

        for(var count = 0; count < Buildings.length; ++count) {
            if(!Reachability.VerifyReachable(SpriteTypes.Player, Buildings[count], Session.HumanPosition)) {
                Session.RequireHelicopter(0);
                return;
            }
        }
    },

    /**
     * Ensure a path exists between the rescue tent, the humans, and each placed hostage.
     */
    canHostageRescue: function(pReport) {
        if(!Settings.hasObjective(Objectives.RescueHostages) && !Settings.hasObjective(Objectives.RescueHostage))
            return;

        if(!Session.isRescueTentPlaced()) {
            this.Fail(pReport, "rescue_tent_missing");
            return;
        }

        print("Validate hostages rescue");
        if(!Reachability.VerifyReachable(SpriteTypes.Player, Session.RescueTentPosition, Session.HumanPosition))
            this.Fail(pReport, "rescue_tent_unreachable");

        for(var x = 0; x < Session.HostageGroupPositions.length; ++x) {
            if(!Reachability.VerifyReachable(SpriteTypes.Hostage, Session.RescueTentPosition, Session.HostageGroupPositions[x]))
                this.Fail(pReport, "hostage_group_unreachable:" + x);
        }
    }
};
