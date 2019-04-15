var OpenFodder = {

    /**
     * Reset the session, and create a map and prepare terrain
     */
    createMap: function() {

        Session.Reset();
        Map.Create( Settings.Width, Settings.Height, Settings.TerrainType, Settings.TerrainTypeSub);
        Terrain.RandomSmooth();
    },

    /**
     * Create a number of phases in the current mission
     *
     * @param {number} pCount
     * @param {function} pCreateContent
     */
    createPhases: function(pCount, pCreateContent) {
        var Campaign = Engine.getCampaign();

        mapname = "m" + Campaign.getMissions().length;
    
        for(var count = 0; count < pCount; ++count) {
    
            this.createMap();
            var Phase = OpenFodder.getNextPhase();
            Phase.map = mapname + "p" + count;
            Phase.SetAggression(Settings.Aggression.Min, Settings.Aggression.Max);

            Objectives.AddSet( Settings.Objectives );

            pCreateContent();

	        Validation.ValidateMap();
        }
    },

    /**
     * Create a number of missions
     *
     * @param {number} pMissions
     * @param {Array<number>} pPhases Number of phases per mission to create
     * @param {function} pCreateContent Callback to create the content of the map
     */
    createMissions: function(pMissions, pPhases, pCreateContent) {

        for(var count = 0; count < pMissions; ++count) {
            var Mission = OpenFodder.getNextMission();

            Settings.TerrainType = Map.getRandomInt(0, 4);
            createPhases(pPhases[count], pCreateContent);
        }
    },

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
