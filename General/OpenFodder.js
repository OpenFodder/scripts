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
    }
    
};
