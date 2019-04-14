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
     * @var {string}
     */
    TerrainAlgorithm: "islands",

    /**
     * @var {object}
     */
    TerrainSettings: {},

    /**
     * @var {number} seed The initial seed
     */
    Seed: 0,

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
        Map = Engine.getMap();

        Session.Reset();

        this.Seed = Engine.getMap().seed;
        this.Random();
    },

    /**
     * Randomize all settings
     */
    Random: function() {

        print("Starting Seed: " + Map.seed);

        this.Width = Map.getRandomInt(40, 150);
        this.Height = Map.getRandomInt(40, 150);

        this.Aggression.Min = Map.getRandomInt(2, 4);
        this.Aggression.Max = Map.getRandomInt(this.Aggression.Min, 8);

        // TODO: Random this
        this.TerrainAlgorithm = "islands";
        this.TerrainType = Map.getRandomInt(Terrain.Types.Jungle, Terrain.Types.Interior);

        this.TerrainAlgorithm = "islands";
        this.TerrainType = Terrain.Types.Jungle;

        this.RandomObjectives();

        // Randomise the terrain algorithm settings
        this.RandomNoise();
    },

    /**
     * Set random objectives
     */
    RandomObjectives: function() {
        this.Objectives = [];

        this.addObjective(Objectives.KillAllEnemy);
	    this.addObjective(Objectives.DestroyEnemyBuildings);
        this.addObjective(Objectives.RescueHostages);
        //this.addObjective(Objectives.GetCivilianHome);
    },

    /**
     * St the phase objectives
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
     * @param {number} pObjective
     */
    hasObjective: function(pObjective) {
        return this.Objectives.indexOf(pObjective.ID) != -1;
    },

    setPhaseObjectives: function() {

        Objectives.AddSet( this.Objectives );
    },

    /**
     * Create random terrain island settings
     */
    RandomTerrainIsland: function() {

        this.TerrainSettings = {
            lev_limits: [0.20, 0.23, 0.55, 0.65, 1.00],
            //lev_limits: [0.17, 0.25, 0.35, 0.45, 1.00],   //Old values

            Octaves: 4,
            Roughness: Map.getRandomFloat(0.01, 0.3),
            Scale: Map.getRandomFloat(0.02, 0.04),
            Seed: Map.getRandomInt(0, 255),
            EdgeFade: Map.getRandomFloat(0.00, 0.2),
            RadialEnabled: Map.getRandomInt(0,1) == 0 ? false : true
        };
    },

    /**
     * Create random terrain simplex noise settings
     */
    RandomTerrainSimplex: function() {

        this.TerrainSettings = {
            lev_limits: [0.20, 0.23, 0.55, 0.65, 1.00],

            Octaves: 4,
            Scale: Map.getRandomFloat(0.02, 0.04),
            Lacunarity:  Map.getRandomFloat(0.01, 0.5),
            Persistance: Map.getRandomFloat(0.01, 1.)
        };
    },

    /**
     * Create noise settings based on set algorithm
     */
    RandomNoise: function() {

        switch(this.TerrainAlgorithm) {
            case "islands":
                return this.RandomTerrainIsland()

            case "simplex":
                return this.RandomTerrainSimplex();

            case "diamondsquare":
            default:
                break;
        }

    },

    /**
     * Get noise for the terrain algorithm
     */
    GetNoise: function() {

        switch(this.TerrainAlgorithm) {
            case "islands":
                return this.GetIslandNoise();

            case "simplex":
                return this.GetSimplexNoise();

            case "diamondsquare":
                return this.GetDiamondSquare();

            default:
                break;
        }

    },

    /**
     * Generate Simplex Island
     */
    GetIslandNoise: function() {

        print('>> SimplexIslands parameters:');
        print('>>   pOctaves = ' + this.TerrainSettings.Octaves);
        print('>>   pRoughness = ' + this.TerrainSettings.Roughness.toFixed(2));
        print('>>   pScale = ' + this.TerrainSettings.Scale.toFixed(2));
        print('>>   pSeed = ' + this.TerrainSettings.Seed);
        print('>>   pRadialEnabled = ' + this.TerrainSettings.RadialEnabled);
        print('>>   pEdgeFade = ' + this.TerrainSettings.EdgeFade.toFixed(2));

        return Map.SimplexIslands(this.TerrainSettings.Octaves,
                                    this.TerrainSettings.Roughness,
                                    this.TerrainSettings.Scale,
                                    this.TerrainSettings.Seed,
                                    this.TerrainSettings.RadialEnabled,
                                    this.TerrainSettings.EdgeFade);

    },

    /**
     *Generate Simplex Noise
     */
    GetSimplexNoise: function() {

        return Map.SimplexNoise(this.TerrainSettings.Octaves, this.TerrainSettings.Scale, this.TerrainSettings.Lacunarity, this.TerrainSettings.Persistance);
    },

    /**
     * Generate Diamond Square heightmap
     */
    GetDiamondSquare: function() {
        return Map.DiamondSquare();
    },

    /**
     * Number of players
     */
    GetPlayerCount: function() {
        return Map.getRandomInt(1,8);
    },

    /**
     * Return the background item count
     */
    GetBackgroundObjectCount: function() {

        return {
            Palms: 10,
            Bushes1: 10,
            Blooms: 5
        };
    },
    /**
     * Calculate the number of hostages to create
     */
    GetHostageCount: function() {

        // TODO: Algorithm to decide number of hostage group
        return 4;
    },

    /**
     * Number of hostages per placement
     */
    GetHostageGroupSize: function() {
        // TODO: Algorithm to decide number of hostages per group
        return 1;
    },

    /**
     * Number of enemies which should be placed
     */
    GetEnemyCount: function() {
        // TODO: Algorithm to decide number of enemys
        return 10;

    },

    /**
     * Number of enemy buildings to be placed
     */
    GetEnemyBuildingCount: function() {
        // TODO: Algorithm to decide number of buildings
        return {
                    "barracks": {"soldier": 2},
                    "bnker": {"soldier": 1}
                };
    },

    /**
     * Minimum number of grenades required for this mission
     */
    GetMinimumGrenades: function() {
        return 1 + (Session.TotalStructures() / 4);
    },

    GetMinimumRockets: function() {
        return 1 + (Session.TotalStructures() / 4);
    }
};
