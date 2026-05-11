var SETTINGS_DEFAULT_MINIMUM_DISTANCE = 100;
var SETTINGS_OBJECT_MINIMUM_DISTANCE = {
    barracks: {
        soldier: 100
    },
    hut: {
        civilian: 100,
        civilian_rescue: 150
    },
    civilian: {
        rescue: 150
    },
    hostage: {
        tent: 150
    }
};

var Settings = {

    /**
     * @var {number}
     */
    Width: 0,

    /**
     * @var {number}
     */
    Height: 0,

    /**
     * @var {number}
     */
    TerrainType: Terrain.Types.Jungle,

    /**
     * @var {number}
     */
    TerrainTypeSub: 0,

    /**
     * @var {object}
     */
    Aggression: {
        Min: 4,
        Max: 8
    },

    /**
     * @var {Array<number>} Objectives
     */
    Objectives: [],

    /**
     * @var {number} seed The initial seed
     */
    Seed: 0,

    /**
     * Multiplayer match settings copied from the synced C++ lobby state.
     */
    Multiplayer: {
        Enabled: false,
        Mode: 0,
        MapSeed: 0,
        PlayerCount: 1,
        TeamCount: 1,
        TeamSize: 1,
        SquadTroopsPerTeam: 4,
        KillLimit: 0,
        TimeLimitSeconds: 0,
        FriendlyFire: false,
        MapSize: NetworkMapSizes.Medium,
        Terrain: NetworkMapTerrains.Jungle,
        VehicleSet: NetworkVehicleSets.None,
        PickupDensity: NetworkPickupDensities.Normal,
        CoverDensity: NetworkCoverDensities.Normal,
        TerrainSub: 0,
        ObjectiveType: "none",
        PickupSets: 2
    },

    /**
     * Campaign random-map settings copied from the C++ options screen.
     */
    RandomMap: {
        Enabled: false,
        Seed: 0,
        MapSize: NetworkMapSizes.Medium,
        MapSizeExplicit: false,
        Terrain: NetworkMapTerrains.Jungle,
        VehicleSet: NetworkVehicleSets.None,
        PickupDensity: NetworkPickupDensities.Normal,
        CoverDensity: NetworkCoverDensities.Normal,
        TerrainSub: 0,
        Profile: NetworkMapProfiles.Jungle,
        ProfileName: ""
    },

    /**
     * Randomise a settings with a specific seed
     *
     * @param {number} pSeed
     */
    FromSeed: function(pSeed) {
        Engine.getMap().seed = pSeed;

        this.Reset();
    },

    /**
     * Reset settings using current seed
     */
    Reset: function() {

        this.Seed = Engine.getMap().seed;

        print("Starting Seed: " + this.Seed);
    },

    /**
     * Copy network match settings into the script layer.
     */
    ConfigureMultiplayerFromEngine: function() {
        this.Multiplayer.Enabled = Engine.networkEnabled();
        this.Multiplayer.Mode = Engine.networkGameMode();
        this.Multiplayer.MapSeed = Engine.networkMapSeed();
        this.Multiplayer.PlayerCount = Engine.networkPlayerCount();
        this.Multiplayer.TeamCount = Engine.networkTeamCount();
        this.Multiplayer.TeamSize = Engine.networkTeamSize();
        this.Multiplayer.KillLimit = Engine.networkKillLimit();
        this.Multiplayer.TimeLimitSeconds = Engine.networkTimeLimitSeconds();
        this.Multiplayer.FriendlyFire = Engine.networkFriendlyFire();
        this.Multiplayer.MapSize = Engine.networkMapSize();
        this.Multiplayer.Terrain = Engine.networkMapTerrain();
        this.Multiplayer.TerrainSub = Engine.networkMapTerrainSub ? Engine.networkMapTerrainSub() : 0;
        this.Multiplayer.VehicleSet = Engine.networkVehicleSet();
        this.Multiplayer.PickupDensity = Engine.networkPickupDensity();
        this.Multiplayer.CoverDensity = Engine.networkCoverDensity();
        this.Multiplayer.SquadTroopsPerTeam = 4;

        if(this.Multiplayer.Mode == NetworkModes.RescuePrisoner)
            this.Multiplayer.ObjectiveType = "rescue_prisoner";
        else
            this.Multiplayer.ObjectiveType = "none";

        if(this.Multiplayer.MapSeed)
            Engine.getMap().seed = this.Multiplayer.MapSeed;

        this.Seed = Engine.getMap().seed;
    },

    /**
     * Copy campaign random-map settings into the script layer.
     */
    ConfigureRandomMapFromEngine: function() {
        this.RandomMap.Enabled = Engine.randomMapOptionsEnabled();
        this.RandomMap.Seed = Engine.randomMapSeed();
        this.RandomMap.MapSize = Engine.randomMapSize();
        this.RandomMap.MapSizeExplicit = Engine.randomMapSizeExplicit ? Engine.randomMapSizeExplicit() : false;
        this.RandomMap.Terrain = Engine.randomMapTerrain();
        this.RandomMap.TerrainSub = Engine.randomMapTerrainSub ? Engine.randomMapTerrainSub() : 0;
        this.RandomMap.VehicleSet = Engine.randomMapVehicleSet();
        this.RandomMap.PickupDensity = Engine.randomMapPickupDensity();
        this.RandomMap.CoverDensity = Engine.randomMapCoverDensity();
        this.RandomMap.Profile = Engine.randomMapProfile();
        this.RandomMap.ProfileName = Engine.randomMapProfileName ? Engine.randomMapProfileName() : "";

        if(this.RandomMap.Enabled && this.RandomMap.Seed)
            Engine.getMap().seed = this.RandomMap.Seed;

        this.Seed = Engine.getMap().seed;
    },

    /**
     * Apply one of the network/random-map size presets to Settings.Width/Height.
     */
    ApplyMapSize: function(pMapSize) {
        switch(pMapSize) {
            case NetworkMapSizes.Small:
                this.Width = 56;
                this.Height = 44;
                break;

            case NetworkMapSizes.Large:
                this.Width = 96;
                this.Height = 72;
                break;

            case NetworkMapSizes.ExtraLarge:
                this.Width = 128;
                this.Height = 96;
                break;

            default:
                this.Width = 72;
                this.Height = 56;
                break;
        }
    },

    /**
     * Convert engine/menu terrain selection into script terrain type.
     */
    TerrainTypeForNetworkTerrain: function(pTerrain) {
        switch(pTerrain) {
            case NetworkMapTerrains.Random:
                return Map.getRandomInt(Terrain.Types.Jungle, Terrain.Types.Moors);

            case NetworkMapTerrains.Desert:
                return Terrain.Types.Desert;

            case NetworkMapTerrains.Ice:
                return Terrain.Types.Ice;

            case NetworkMapTerrains.Moors:
                return Terrain.Types.Moors;

            default:
                return Terrain.Types.Jungle;
        }
    },

    /**
     * Apply terrain and terrain-sub selection. TerrainSub is meaningful only
     * for jungle/beach maps.
     */
    ApplyTerrainSelection: function(pTerrain, pTerrainSub) {
        this.TerrainType = this.TerrainTypeForNetworkTerrain(pTerrain);
        this.TerrainTypeSub = this.TerrainType == Terrain.Types.Jungle ? (pTerrainSub || 0) : 0;
    },

    /**
     * Apply campaign random-map menu settings after the profile has chosen
     * its base values.
     */
    ApplyRandomMapOptions: function() {
        if(!this.RandomMap.Enabled)
            return;

        this.ApplyMapSize(this.RandomMap.MapSize);
        this.ApplyTerrainSelection(this.RandomMap.Terrain, this.RandomMap.TerrainSub);
    },

    /**
     * Apply deterministic defaults for generated multiplayer maps.
     */
    ApplyMultiplayerDefaults: function() {
        this.ApplyMapSize(this.Multiplayer.MapSize);
        this.ApplyTerrainSelection(this.Multiplayer.Terrain, this.Multiplayer.TerrainSub);
        this.SetAggressionRange(0, 0);
        this.setObjectives([]);

        switch(this.Multiplayer.PickupDensity) {
            case NetworkPickupDensities.Low:
                this.Multiplayer.PickupSets = Math.max(1, Math.floor(this.Multiplayer.TeamCount / 2));
                break;

            case NetworkPickupDensities.High:
                this.Multiplayer.PickupSets = Math.max(4, this.Multiplayer.TeamCount * 2);
                break;

            default:
                this.Multiplayer.PickupSets = Math.max(2, this.Multiplayer.TeamCount);
                break;
        }
    },

    SetAggressionRange: function(pMin, pMax) {
        var min = Math.max(0, Math.min(8, Math.floor(pMin || 0)));
        var max = Math.max(0, Math.min(8, Math.floor(pMax || 0)));

        if(max < min)
            max = min;

        this.Aggression.Min = min;
        this.Aggression.Max = max;
    },

    ApplyCampaignDefaults: function() {
        this.ApplyMapSize(NetworkMapSizes.Medium);
        this.ApplyTerrainSelection(NetworkMapTerrains.Jungle, 0);
        this.SetAggressionRange(3, 7);
        this.setObjectives([]);
    },

    MapGenAggressionRange: function(pContext) {
        var profile = pContext && pContext.Profile ? pContext.Profile : {};
        var plan = pContext && pContext.GrammarPlan ? pContext.GrammarPlan : {};
        var intent = plan.intent || {};
        var routeShape = intent.routeShape || {};
        var campaignBand = intent.campaignBand || {};
        var bandName = String(campaignBand.name || "");
        var objectiveLabel = String(intent.objectiveLabel || profile.GrammarObjectiveLabel || "");
        var pressureGoals = Math.max(0, Math.floor(routeShape.pressureGoalCountTarget || 0));
        var supportGoals = Math.max(0, Math.floor(routeShape.supportGoalCountTarget || 0));
        var min = 3;
        var max = 7;

        if(bandName === "early") {
            min = 2;
            max = 5;
        }
        else if(bandName === "late") {
            min = 4;
            max = 8;
        }

        if(objectiveLabel === "enemy_heavy") {
            min += 1;
            max += 1;
        }
        else if(objectiveLabel === "rescue_hostages" || objectiveLabel === "civilian_delivery") {
            min -= 1;
        }
        else if(objectiveLabel === "destroy_buildings") {
            max += 1;
        }

        if(pressureGoals >= 8)
            min += 1;
        if(pressureGoals >= 12 || supportGoals >= 4)
            max += 1;

        if(typeof profile.AggressionMin === "number")
            min = profile.AggressionMin;
        if(typeof profile.AggressionMax === "number")
            max = profile.AggressionMax;

        min = Math.max(0, Math.min(8, Math.floor(min)));
        max = Math.max(min, Math.min(8, Math.floor(max)));

        return {
            Min: min,
            Max: max
        };
    },

    ApplyMapGenAggression: function(pContext) {
        if(this.Multiplayer.Enabled) {
            this.SetAggressionRange(0, 0);
            return;
        }

        var range = this.MapGenAggressionRange(pContext);
        this.SetAggressionRange(range.Min, range.Max);
    },

    /**
     * Randomize generic scenario settings using supported fixed map sizes.
     */
    Random: function() {
        var sizes = [
            NetworkMapSizes.Small,
            NetworkMapSizes.Medium,
            NetworkMapSizes.Large
        ];

        this.ApplyCampaignDefaults();
        this.ApplyMapSize(sizes[Map.getRandomInt(0, sizes.length - 1)]);
    },

	RandomEditor: function() {
		this.Width = Map.getWidth();
		this.Height = Map.getHeight();
		
        this.TerrainType = Map.getTileType();
	},

    /**
     * Total number of tiles the map will have
     */
    getCalculatedArea: function() {
        return Settings.Width * Settings.Height;
    },

    /**
     * Set the phase objectives
     *
     * @param {Array<object>} pObjectives
     */
    setObjectives: function(pObjectives) {
        this.Objectives = [];

        for(var x = 0; x < pObjectives.length; ++x) {
            this.addObjective(pObjectives[x]);
        }
    },

    /**
     * Add an objective
     *
     * @param {object} pObjective
     */
    addObjective: function(pObjective) {
        this.Objectives.push(pObjective.ID);
    },

    /**
     * Do we have this objective
     *
     * @param {object} pObjective
     */
    hasObjective: function(pObjective) {
        return this.Objectives.indexOf(pObjective.ID) != -1;
    },

    GetActiveCoverDensity: function() {
        if(this.Multiplayer.Enabled)
            return this.Multiplayer.CoverDensity;

        if(this.RandomMap.Enabled)
            return this.RandomMap.CoverDensity;

        return null;
    },

    /**
     * Number of players
     */
    GetPlayerCount: function() {
        if(this.Multiplayer.Enabled)
            return this.Multiplayer.PlayerCount;

        return Map.getRandomInt(1,8);
    },

    /**
     * Return the background item count
     */
    GetBackgroundObjectCount: function() {
        if(this.Multiplayer.Enabled || this.RandomMap.Enabled) {
            var areaScale = Math.max(0.6, this.getCalculatedArea() / (96 * 72));
            var densityScale = 1.0;
            var coverDensity = this.GetActiveCoverDensity();

            switch(coverDensity) {
                case NetworkCoverDensities.Sparse:
                    densityScale = 0.45;
                    break;

                case NetworkCoverDensities.Dense:
                    densityScale = 1.75;
                    break;

                case NetworkCoverDensities.Heavy:
                    densityScale = 2.6;
                    break;

                default:
                    densityScale = 1.0;
                    break;
            }

            var terrainScale = {
                Palms: 1.0,
                Bushes1: 1.0,
                Blooms: 1.0
            };

            switch(this.TerrainType) {
                case Terrain.Types.Desert:
                    terrainScale.Palms = 0.35;
                    terrainScale.Bushes1 = 0.65;
                    terrainScale.Blooms = 0.25;
                    break;

                case Terrain.Types.Ice:
                    terrainScale.Palms = 0.2;
                    terrainScale.Bushes1 = 0.45;
                    terrainScale.Blooms = 0.15;
                    break;

                case Terrain.Types.Moors:
                    terrainScale.Palms = 0.55;
                    terrainScale.Bushes1 = 1.25;
                    terrainScale.Blooms = 0.45;
                    break;

                default:
                    terrainScale.Palms = 1.25;
                    terrainScale.Bushes1 = 1.1;
                    terrainScale.Blooms = 1.0;
                    break;
            }

            return {
                Palms: Math.round(20 * areaScale * densityScale * terrainScale.Palms),
                Bushes1: Math.round(16 * areaScale * densityScale * terrainScale.Bushes1),
                Blooms: Math.round(8 * areaScale * densityScale * terrainScale.Blooms)
            };
        }

        return {
            Palms: 10,
            Bushes1: 10,
            Blooms: 5
        };
    },

    /**
     * Get the minimum distance between two same type structures
     *
     * @param {string} pObjectName
     * @param {string} pTargetName
     */
    GetMinimumDistance: function(pObjectName, pTargetName) {
        var Obj = SETTINGS_OBJECT_MINIMUM_DISTANCE[pObjectName.toLowerCase()];
        if( Obj === undefined )
            return SETTINGS_DEFAULT_MINIMUM_DISTANCE;

        var Target = Obj[pTargetName.toLowerCase()];
        if( Target === undefined)
            return SETTINGS_DEFAULT_MINIMUM_DISTANCE;

        return Target;
    }
};
