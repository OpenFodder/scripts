var MapGen = MapGen || {};
MapGen.Integration = MapGen.Integration || {};

(function(pIntegration) {
    pIntegration.TileToPosition = function(pPoint) {
        return new cPosition(pPoint.x * 16, pPoint.y * 16);
    };

    pIntegration.PositionDistance = function(pLeft, pRight) {
        var dx = pLeft.x - pRight.x;
        var dy = pLeft.y - pRight.y;

        return Math.sqrt((dx * dx) + (dy * dy));
    };

    pIntegration.TooCloseToPositions = function(pPosition, pPositions, pDistance) {
        if(!pPositions || !pDistance)
            return false;

        for(var index = 0; index < pPositions.length; ++index) {
            if(this.PositionDistance(pPosition, pPositions[index]) < pDistance)
                return true;
        }

        return false;
    };

    pIntegration.CoverTreeRange = function(pCoverDensity) {
        switch(pCoverDensity) {
            case NetworkCoverDensities.Sparse:
                return [0.28, 0.42];
            case NetworkCoverDensities.Dense:
                return [0.55, 0.70];
            case NetworkCoverDensities.Heavy:
                return [0.65, 0.80];
            default:
                return null;
        }
    };

    pIntegration.CoverDecorDensity = function(pCoverDensity) {
        switch(pCoverDensity) {
            case NetworkCoverDensities.Sparse:
                return [0.45, 0.65];
            case NetworkCoverDensities.Dense:
                return [1.4, 1.8];
            case NetworkCoverDensities.Heavy:
                return [2.0, 2.6];
            default:
                return null;
        }
    };

    pIntegration.PickupDensityScale = function(pPickupDensity) {
        switch(pPickupDensity) {
            case NetworkPickupDensities.Low:
                return 0.5;
            case NetworkPickupDensities.High:
                return 2.0;
            default:
                return 1.0;
        }
    };

    pIntegration.SizeOverrides = function() {
        return {
            Width: Math.max(32, Settings.Width || 96),
            Height: Math.max(32, Settings.Height || 72),
            AspectRatioPalette: []
        };
    };

    pIntegration.CommonOverrides = function() {
        var overrides = this.SizeOverrides();

        overrides.TerrainType = Settings.TerrainType !== undefined ? Settings.TerrainType : Terrain.Types.Jungle;
        overrides.TerrainTypeSub = Settings.TerrainTypeSub || 0;

        return overrides;
    };

    pIntegration.IsJungleBeach = function() {
        return Settings.TerrainType === Terrain.Types.Jungle &&
            Number(Settings.TerrainTypeSub || 0) === 1;
    };

    pIntegration.CampaignVehicleCount = function() {
        if(typeof NetworkVehicleSets === "undefined" || !Settings.RandomMap)
            return 0;
        if(!Settings.RandomMap.Enabled || Settings.RandomMap.VehicleSet == NetworkVehicleSets.None)
            return 0;

        return Settings.RandomMap.VehicleSet == NetworkVehicleSets.Mixed ? 2 : 1;
    };

    pIntegration.CampaignTerrainProfileName = function() {
        switch(Settings.TerrainType) {
            case Terrain.Types.Desert:
                return "unsupported_desert_terrain";

            case Terrain.Types.Ice:
                return "grammar_ice";

            case Terrain.Types.Moors:
                return "unsupported_moors_terrain";

            case Terrain.Types.Interior:
                return "unsupported_interior_terrain";

            case Terrain.Types.AmigaFormat:
                return "unsupported_afx_terrain";

            default:
                return "";
        }
    };

    pIntegration.CampaignSeed = function() {
        if(Settings.RandomMap && Settings.RandomMap.Enabled && Settings.RandomMap.Seed !== undefined)
            return Settings.RandomMap.Seed;
        if(Settings.Seed !== undefined)
            return Settings.Seed;
        if(typeof Map !== "undefined" && Map.seed !== undefined)
            return Map.seed;

        return 0;
    };

    pIntegration.SeededProfileName = function(pProfiles, pSalt) {
        var seed = this.CampaignSeed();
        var profileHash = MapGen.Random && MapGen.Random.HashTile ?
            MapGen.Random.HashTile(seed, 73, 19, pSalt || 4517) :
            ((Number(seed || 0) * 2654435761) >>> 0);

        return pProfiles[profileHash % pProfiles.length];
    };

    pIntegration.CampaignProfileName = function() {
        if(!Settings.RandomMap || !Settings.RandomMap.Enabled || typeof NetworkMapProfiles === "undefined")
            return "grammar_jungle";

        if(Settings.RandomMap.ProfileName)
            return Settings.RandomMap.ProfileName;

        switch(Settings.RandomMap.Profile) {
            case NetworkMapProfiles.Jungle:
                return this.SeededProfileName([
                    "grammar_jungle",
                    "grammar_jungle_forest_corridor",
                    "grammar_jungle_river_crossing",
                    "grammar_river_crossing",
                    "grammar_jungle_maze",
                    "grammar_jungle_neck",
                    "grammar_beach"
                ], 4517);

            case NetworkMapProfiles.JungleMaze:
                return "grammar_jungle_maze";

            case NetworkMapProfiles.JungleNeck:
                return "grammar_jungle_neck";

            case NetworkMapProfiles.Ice:
                return this.SeededProfileName([
                    "grammar_ice",
                    "grammar_ice_maze",
                    "grammar_ice_neck",
                    "grammar_ice_skidoo_jump"
                ], 8111);

            case NetworkMapProfiles.IceMaze:
                return "grammar_ice_maze";

            case NetworkMapProfiles.IceMazeXL:
                return "grammar_ice_maze_xl";

            case NetworkMapProfiles.IceNeck:
                return "grammar_ice_neck";

            case NetworkMapProfiles.IceSkidooJump:
                return "grammar_ice_skidoo_jump";

            case NetworkMapProfiles.Beach:
                return "grammar_beach";

            case NetworkMapProfiles.Random: {
                var profiles = [
                    "grammar_jungle",
                    "grammar_jungle_forest_corridor",
                    "grammar_jungle_river_crossing",
                    "grammar_river_crossing",
                    "grammar_jungle_maze",
                    "grammar_jungle_neck",
                    "grammar_beach",
                    "grammar_ice",
                    "grammar_ice_maze",
                    "grammar_ice_neck",
                    "grammar_ice_skidoo_jump"
                ];
                return this.SeededProfileName(profiles, 12043);
            }
        }

        var terrainProfile = this.CampaignTerrainProfileName();
        if(terrainProfile)
            return terrainProfile;

        if(this.IsJungleBeach())
            return "grammar_beach";

        switch(Settings.RandomMap.Profile) {
            case NetworkMapProfiles.Custom:
            default:
                return "grammar_jungle";
        }
    };

    pIntegration.CampaignProfileOwnsMapSize = function(pProfileName) {
        var profileName = String(pProfileName || "");
        return profileName.indexOf("_xl") >= 0 ||
            profileName === "grammar_jungle_forest_corridor" ||
            profileName === "grammar_jungle_river_crossing";
    };

    pIntegration.ApplyCampaignProfileTerrainOverrides = function(pOverrides, pProfileName) {
        var profileName = String(pProfileName || "");

        if(profileName === "grammar_beach" || profileName === "grammar_river_crossing") {
            pOverrides.TerrainType = Terrain.Types.Jungle;
            pOverrides.TerrainTypeSub = 1;
        }
        else if(profileName === "grammar_ice" || profileName.indexOf("grammar_ice_") === 0) {
            pOverrides.TerrainType = Terrain.Types.Ice;
            pOverrides.TerrainTypeSub = 0;
        }
        else if(profileName === "grammar_jungle" || profileName.indexOf("grammar_jungle_") === 0) {
            pOverrides.TerrainType = Terrain.Types.Jungle;
            pOverrides.TerrainTypeSub = 0;
        }
    };

    pIntegration.FastTileIterationEnabled = function() {
        if(typeof FileIO === "undefined")
            return false;

        try {
            var flag = new FileIO("mapgen_fast_tile_iteration.flag", true);
            var enabled = flag.isOpen();
            if(enabled)
                flag.close();
            return enabled;
        } catch(e) {
            return false;
        }
    };

    // Profiling-only flag (mirrors the fast-tile-iteration flag mechanism): when the
    // file mapgen_profile_timings.flag exists in Run/, per-stage timings are recorded
    // into the context dump. Observability only — Context.Time just wraps stage calls
    // with a Date()-based stopwatch and does not change generation output.
    pIntegration.ProfileTimingsEnabled = function() {
        if(typeof FileIO === "undefined")
            return false;
        try {
            var flag = new FileIO("mapgen_profile_timings.flag", true);
            var enabled = flag.isOpen();
            if(enabled)
                flag.close();
            return enabled;
        } catch(e) {
            return false;
        }
    };

    pIntegration.NativePathingDisabled = function() {
        if(typeof FileIO === "undefined")
            return false;
        try {
            var flag = new FileIO("mapgen_disable_native_pathing.flag", true);
            var disabled = flag.isOpen();
            if(disabled)
                flag.close();
            return disabled;
        } catch(e) {
            return false;
        }
    };

    pIntegration.NativePathingParityCheckEnabled = function() {
        if(typeof FileIO === "undefined")
            return false;
        try {
            var flag = new FileIO("mapgen_native_pathing_parity.flag", true);
            var enabled = flag.isOpen();
            if(enabled)
                flag.close();
            return enabled;
        } catch(e) {
            return false;
        }
    };

    pIntegration.CampaignOptions = function() {
        var profileName = this.CampaignProfileName();
        var overrides = this.CommonOverrides();
        var coverRange = this.CoverTreeRange(Settings.RandomMap.CoverDensity);
        var decorRange = this.CoverDecorDensity(Settings.RandomMap.CoverDensity);
        var fastTileIteration = this.FastTileIterationEnabled();
        var disableNativePathing = this.NativePathingDisabled();
        var nativePathingParityCheck = this.NativePathingParityCheckEnabled();

        this.ApplyCampaignProfileTerrainOverrides(overrides, profileName);
        if(this.CampaignProfileOwnsMapSize(profileName) && !Settings.RandomMap.MapSizeExplicit) {
            delete overrides.Width;
            delete overrides.Height;
            delete overrides.AspectRatioPalette;
        }
        if(coverRange)
            overrides.TreeCoverage = coverRange;
        if(decorRange)
            overrides.DecorDensity = decorRange;
        if(fastTileIteration)
            overrides.MaxRepairPasses = 0;
        overrides.VehicleCount = this.CampaignVehicleCount();
        overrides.VehicleSet = Settings.RandomMap.VehicleSet;
        overrides.PickupDensityScale = this.PickupDensityScale(Settings.RandomMap.PickupDensity);

        var options = {
            Map: Map,
            Seed: this.CampaignSeed(),
            ProfileName: profileName,
            Overrides: overrides,
            RenderInvalid: true,
            FastTileIteration: fastTileIteration,
            ProfileTimings: this.ProfileTimingsEnabled(),
            DisableNativePathing: disableNativePathing,
            NativePathingParityCheck: nativePathingParityCheck
        };

        if(fastTileIteration) {
            options.Attempts = 1;
            options.ValidationRetries = 1;
        }

        return options;
    };

    pIntegration.MultiplayerOptions = function() {
        var overrides = this.CommonOverrides();
        var coverRange = this.CoverTreeRange(Settings.Multiplayer.CoverDensity);
        var decorRange = this.CoverDecorDensity(Settings.Multiplayer.CoverDensity);
        var profileName = this.IsJungleBeach() ? "pvp_beach_jungle" :
            (Settings.TerrainType === Terrain.Types.Ice ? "pvp_balanced_ice" : "pvp_balanced_jungle");
        var disableNativePathing = this.NativePathingDisabled();
        var nativePathingParityCheck = this.NativePathingParityCheckEnabled();

        if(coverRange)
            overrides.TreeCoverage = coverRange;
        if(decorRange)
            overrides.DecorDensity = decorRange;

        overrides.ObjectiveTemplates = ["pvp"];
        overrides.ObjectiveType = Settings.Multiplayer.ObjectiveType || "none";

        return {
            Map: Map,
            Seed: Settings.Multiplayer.MapSeed !== undefined ? Settings.Multiplayer.MapSeed :
                (Settings.Seed !== undefined ? Settings.Seed : Map.seed),
            ProfileName: profileName,
            Overrides: overrides,
            RenderInvalid: true,
            DisableNativePathing: disableNativePathing,
            NativePathingParityCheck: nativePathingParityCheck
        };
    };
})(MapGen.Integration);
