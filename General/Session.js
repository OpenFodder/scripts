
var Session = {

    /**
     * @var array[cPosition]
     */
    HostageGroupPositions: [],
    
    /**
     * @var cPosition
     */
    RescueTentPosition: new cPosition(0, 0),

    /** 
     * @var sSprite 
     */
    Helicopter: null,

    /**
     * @var cPosition
     */
    HumanPosition: new cPosition(0, 0),

    /**
     * Reset all properties
     */
    Reset: function() {
        this.HostageGroupPositions = [];
        this.RescueTentPosition = new cPosition(0, 0);
        this.Helicopter = null;
        this.HumanPosition = new cPosition(0, 0);
    },

    /**
     * Has the rescue tent been placed?
     */
    isRescueTentPlaced: function() {
        return this.RescueTentPosition.x != 0 && this.RescueTentPosition.y != 0;
    }
};
