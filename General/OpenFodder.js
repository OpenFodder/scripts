var OpenFodder = {

    /**
     * Reset/Randomize settings
     *
     * @param {number} pPhaseNumber Current phase number
     */
    prepareMapSettings: function( pPhaseNumber ) {
        Settings.Random();

    },

    /**
     * 
     * @param {Array<number>} pObjectives
     */
    preparePhaseObjectives: function( pObjectives ) {

		Engine.getPhase().ObjectivesClear();

		for( var x = 0; x < pObjectives.length; ++x) {
			Engine.getPhase().ObjectiveAdd(pObjectives[x]);
		}
    },

    /**
     * Reset the session, and create a map and prepare terrain
     */
    createMap: function() {
        Session.Reset();

        Map.Create( Settings.Width, Settings.Height, Settings.TerrainType, Settings.TerrainTypeSub);
        Terrain.RandomSmooth();

        this.preparePhaseObjectives( Settings.Objectives );
    },

    /**
     *
     * @param {function} pCreateContent
     */
    createPhase: function(pPhaseNumber, pCreateContent) {

        var Phase = this.getNextPhase();
        Phase.map = mapname + "p" + pPhaseNumber;
        Phase.SetAggression(Settings.Aggression.Min, Settings.Aggression.Max);

        this.createMap();
        pCreateContent(pPhaseNumber);
        Validation.ValidateMap();
    },

    /**
     * Create a number of phases in the current mission
     *
     * @param {number} pCount
     * @param {function} pCreateContent
     * @param {function} pPrepareMapSettings
     *
     */
    createPhases: function(pCount, pCreateContent, pPrepareMapSettings) {
        var Campaign = Engine.getCampaign();
        OpenFodder.printSmall("Creating Phases", 0, 55);
        mapname = "m" + Campaign.getMissions().length;

        if(pPrepareMapSettings === undefined)
            pPrepareMapSettings = this.prepareMapSettings;

        for(var count = 0; count < pCount; ++count) {

            pPrepareMapSettings(count);
            this.createPhase(count, pCreateContent);
        }
    },

    /**
     * Create a number of missions
     *
     * @param {number} pMissions
     * @param {Array<number>} pPhases Number of phases per mission to create
     * @param {function} pCreateContent Callback to create the content of the map
     * @param {function} pPrepareMapSettings Callback to configure the settings of the next map
     *
     */
    createMissions: function(pMissions, pPhases, pCreateContent, pPrepareMapSettings) {
        OpenFodder.printSmall("Creating " + pMissions + " Missions", 0, 25);
        for(var count = 0; count < pMissions; ++count) {
            var Mission = OpenFodder.getNextMission();

            Settings.TerrainType = Map.getRandomInt(0, 4);
            createPhases(pPhases[count], pCreateContent, pPrepareMapSettings);
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
    },

    /**
     *
     */
    start: function() {
        this.printLarge("PLEASE WAIT", 0, 15);

        // Global Map object
        Map = Engine.getMap();

        // Global Mission
        Mission = this.getNextMission();

        // Reset the map session
        Settings.Reset();
    }
};
