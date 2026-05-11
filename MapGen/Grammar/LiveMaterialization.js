var MapGen = MapGen || {};
MapGen.Grammar = MapGen.Grammar || {};

MapGen.Grammar.LiveMaterialization = {

    // Architecture v3 cleanup: live materialization is RUNTIME state produced by
    // the live pipeline, not a GrammarPlan scaffold stage. It now lives on its
    // own context field (pContext.LiveMaterialization) so it survives scaffold
    // removal. This Ensure() is the single owner; other modules call it.
    Ensure: function(pContext) {
        pContext.LiveMaterialization = pContext.LiveMaterialization || {};
        return pContext.LiveMaterialization;
    },

    SetOwner: function(pContext, pOwner) {
        var live = this.Ensure(pContext);

        pContext.GrammarLiveMaterializationOwner = pOwner;
        live.liveConstructionOwner = pOwner;
        return live;
    },

    SetMode: function(pContext, pMaterializationMode, pTerrainMode, pFields) {
        var live = this.Ensure(pContext);
        var key;

        // Store the materialization mode on the live state object itself; the
        // metadata reader consumes live.materializationMode.
        if(pMaterializationMode)
            live.materializationMode = pMaterializationMode;
        if(pTerrainMode)
            live.terrainMode = pTerrainMode;

        if(pFields) {
            for(key in pFields) {
                if(pFields.hasOwnProperty(key))
                    live[key] = pFields[key];
            }
        }

        return live;
    }
};
