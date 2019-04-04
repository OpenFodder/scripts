
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
    RescueHelicopter: null,

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
        this.RescueHelicopter = null;
        this.HumanPosition = new cPosition(0, 0);
    }
};
