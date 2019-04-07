
var Session = {

    /**
     * @var {array[cPosition]}
     */
    HostageGroupPositions: [],

    /**
     * @var {array[cPosition]} BuildingPositions
     */
    BuildingPositions: [],

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
        this.BuildingPositions = [];
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
        if(this.HelicopterMinimum < pType)
            this.HelicopterMinimum = pType;
    },

    /**
     * Number of grenade crates required
     */
    RequiredMinimumGrenades: function() {
        return (this.BuildingPositions.length / 4) + 1;
    },

    /**
     * Number of rocket barrels required
     */
    RequiredMinimumRockets: function() {
        return (this.BuildingPositions.length / 4) + 1;
    },

    /**
     * Has the rescue tent been placed?
     */
    isRescueTentPlaced: function() {
        return this.RescueTentPosition.x != 0 && this.RescueTentPosition.y != 0;
    }
};
