
var Session = {

    /**
     * @var {object}
     */
    Background: {

        /**
         * @var {Array<cPosition>} TreePositions
         */
        TreePositions: [],

        /**
         * @var {Array<cPosition>} Bush1Positions
         */
        Bush1Positions: [],

        /**
         * @var {Array<cPosition>} Bush2Positions
         */
        Bush2Positions: [],

        /**
         * @var {Array<cPosition>} BloomPositions
         */
        BloomPositions: [],

        /**
         * @var {Array<cPosition>} LittleShrub1Positions
         */
        LittleShrub1Positions: [],

        /**
         * @var {Array<cPosition>} LittleShrub2Positions
         */
        LittleShrub2Positions: [],

        /**
         * Reset to defaults
         */
        Reset: function() {
            this.BloomPositions = [];
            this.Bush1Positions = [];
            this.Bush2Positions = [];
            this.LittleShrub1Positions = [];
            this.LittleShrub2Positions = [];
            this.TreePositions = [];
        }
    },

    /**
     * @var {array<cPosition>} HostageGroupPositions 
     */
    HostageGroupPositions: [],

    /**
     * @var {cPosition[]}
     */
    CivilianPositions: [],

    /**
     * @var {Array<cPosition>} BarracksPositions
     */
    BarracksPositions: [],

    /**
     * @var {Array<cPosition>} BunkerPositions
     */
    BunkerPositions: [],

    /**
     * @var {Array<cPosition>} HutPositions
     */
    HutPositions: [],
    
    /**
     * @var {cPosition}
     */
    RescueTentPosition: new cPosition(0, 0),

    /** 
     * @var {sSprite} 
     */
    Helicopter: null,

    /**
     * @var {number} NeedHelicopter Type of helicopter required. -1 = Not Required
     */
    HelicopterMinimum: -1,

    /**
     * @var {cPosition}
     */
    HumanPosition: new cPosition(0, 0),

    /**
     * Multiplayer team spawn centers, indexed by team.
     */
    TeamSpawns: [],

    /**
     * Multiplayer player spawn positions, indexed by player/team owner.
     */
    PlayerSpawns: [],

    /**
     * Multiplayer neutral objective positions.
     */
    ObjectivePositions: [],

    /**
     * Multiplayer team extraction zones.
     */
    ExtractionZones: [],

    /**
     * Multiplayer selected character classes, indexed by player.
     */
    SelectedClasses: [],

    /**
     * Last generated MapGen context for debug/testing and planned placements.
     */
    MapGenContext: null,

    /**
     * Reset all properties
     */
    Reset: function() {
        this.BarracksPositions = [];
        this.BunkerPositions = [];
        this.HutPositions = [];

        this.HostageGroupPositions = [];
        this.CivilianPositions = [];
        this.CivilianHomePosition = null;
        this.RuntimeValidation = null;
        this.RescueTentPosition = new cPosition(0, 0);
        this.Helicopter = null;
        this.HelicopterMinimum = -1;
        this.HumanPosition = new cPosition(0, 0);
        this.TeamSpawns = [];
        this.PlayerSpawns = [];
        this.ObjectivePositions = [];
        this.ExtractionZones = [];
        this.SelectedClasses = [];
        this.MapGenContext = null;

        this.Background.Reset();
    },

    getEnemyBuildings: function() {

        return this.BunkerPositions.concat(this.BarracksPositions);
    },

    /**
     * Total number of structures which have been placed
     */
    TotalStructures: function() {

        return (this.BunkerPositions.length + this.BarracksPositions.length + this.HutPositions.length);
    },

    /**
     * Require a helicopter of atleast pType (0 = Grenade, 1 = Missile, 2 = Homing)
     * 
     * @param {nunber} pType 
     */
    RequireHelicopter: function(pType) {
        print("Require Helicopter");
        
        if(this.HelicopterMinimum < pType)
            this.HelicopterMinimum = pType;
    },

    /**
     * Number of grenade crates required
     */
    RequiredMinimumGrenades: function() {
        if(!this.TotalStructures())
            return 0;

            // 4 Grenades per case
        return (this.TotalStructures() / 4) + 1;
    },

    /**
     * Number of rocket barrels required
     */
    RequiredMinimumRockets: function() {
        if(!this.TotalStructures())
            return 0;

            // 4 Rockets per barrel
        return (this.TotalStructures() / 4) + 1;
    },

    /**
     * Has the rescue tent been placed?
     */
    isRescueTentPlaced: function() {
        return this.RescueTentPosition.x != 0 && this.RescueTentPosition.y != 0;
    }
};
