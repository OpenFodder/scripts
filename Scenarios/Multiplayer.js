Scenario.Multiplayer = {
    CreateMap: function() {
        MapGen.Integration.GenerateMultiplayerMap();
    },
    Start: function() {
        if(!Session.MapGenContext || !Session.MapGenContext.Materialized)
            throw new Error("Multiplayer generation did not produce an accepted map");
    },
    Settings: function() {
        Settings.ConfigureMultiplayerFromEngine();
        Settings.ApplyMultiplayerDefaults();
    }
};
