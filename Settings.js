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
        this.Aggression.Max = Map.getRandomInt(4, 8);

        this.TerrainAlgorithm = "islands";
        this.TerrainType = Map.getRandomInt(Terrain.Types.Jungle, Terrain.Types.Interior);

        this.TerrainAlgorithm = "islands";
        this.TerrainType = Terrain.Types.Jungle;

        this.RandomNoise();
    },

    /**
     * Create random terrain island settings
     */
    RandomTerrainIsland: function() {

        this.TerrainSettings = {
            lev_limits: [0.20, 0.23, 0.55, 0.65, 1.00],
            //lev_limits: [0.17, 0.25, 0.35, 0.45, 1.00],   Old values

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
};