
var Session = {

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
     * Reset all properties
     */
    Reset: function() {
        this.BarracksPositions = [];
        this.HutPositions = [];
        this.HostageGroupPositions = [];
        this.RescueTentPosition = new cPosition(0, 0);
        this.Helicopter = null;
        this.HelicopterMinimum = -1;
        this.HumanPosition = new cPosition(0, 0);
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
        if(!this.BarracksPositions.length)
            return 0;

        return (this.BarracksPositions.length / 4) + 1;
    },

    /**
     * Number of rocket barrels required
     */
    RequiredMinimumRockets: function() {
        if(!this.BarracksPositions.length)
            return 0;
            
        return (this.BarracksPositions.length / 4) + 1;
    },

    /**
     * Has the rescue tent been placed?
     */
    isRescueTentPlaced: function() {
        return this.RescueTentPosition.x != 0 && this.RescueTentPosition.y != 0;
    }
};
