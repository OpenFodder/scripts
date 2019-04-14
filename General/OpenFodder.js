var OpenFodder = {

    /**
     * Create the next mission
     * 
     * @return {cMission}
     */
    getNextMission: function() {
        Mission = Engine.getMission();
        if(Mission.name != "") {
            print("Creating new mission");
            Mission = Engine.missionCreate();
        }
        Mission.name = PhaseName.Generate();
        return Mission;
    },
    
    /**
     * Create the next phase
     * 
     * @return {cPhase}
     */
    getNextPhase: function() {
        Phase = Engine.getPhase();
        if(Phase.name != "") {
            print("Creating new phase");
            Phase = Engine.phaseCreate();
        }

        Phase.name = PhaseName.Generate();
        return Phase;
    },

    /**
     * Print a string using the large font
     * 
     * @param {string} pText 
     * @param {number} pX X location to draw (0 will centre)
     * @param {number} pY Y location to draw
     * @param {boolean} pUnderline Print with an underline
     */
    printLarge: function(pText, pX, pY, pUnderline) {

        if(pUnderline === undefined)
            pUnderline = false;
        Engine.guiPrintString(pText, pX, pY, true, pUnderline);
    },
    
    /**
     * Print a string using the small font
     * 
     * @param {string} pText 
     * @param {number} pX X location to draw (0 will centre)
     * @param {number} pY Y location to draw
     */
    printSmall: function(pText, pX, pY) {
        Engine.guiPrintString(pText, pX, pY, false, false);
    }
    
};
