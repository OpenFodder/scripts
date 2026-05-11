var MapGen = MapGen || {};
MapGen.Grammar = MapGen.Grammar || {};

MapGen.Grammar.PostpassPolicy = {
    Recipe: function(pContext, pId) {
        var recipes = pContext &&
            pContext.GrammarPlan &&
            pContext.GrammarPlan.materialization &&
            pContext.GrammarPlan.materialization.postpassRecipes ?
            pContext.GrammarPlan.materialization.postpassRecipes :
            [];

        for(var index = 0; index < recipes.length; ++index) {
            if(recipes[index] && recipes[index].id === pId)
                return recipes[index];
        }

        return null;
    },

    Allows: function(pContext, pId) {
        var recipe = this.Recipe(pContext, pId);
        return !!(recipe &&
            recipe.enabled === true &&
            recipe.quarantine === "profile_scoped");
    },

    Record: function(pContext, pId, pChanged) {
        if(!pContext || !pChanged)
            return;

        var recipe = this.Recipe(pContext, pId) || {};

        var live = MapGen.Grammar.LiveMaterialization.Ensure(pContext);
        live.quarantinedPostpasses = live.quarantinedPostpasses || [];

        live.quarantinedPostpasses.push({
            id: pId,
            changed: pChanged,
            source: recipe.source || "",
            semanticSource: recipe.semanticSource || "",
            quarantine: recipe.quarantine || "profile_scoped"
        });
    }
};
