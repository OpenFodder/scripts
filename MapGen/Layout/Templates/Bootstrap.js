var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};
MapGen.Layout.Templates = MapGen.Layout.Templates || {};

(function() {

    var registry = {};

    function ensureRegistry() {
        return registry;
    }

    function pickWeighted(pRandom, pWeights) {
        var keys = [];
        var total = 0;
        var key;

        if(pWeights) {
            for(key in pWeights) {
                if(!pWeights.hasOwnProperty(key))
                    continue;
                var weight = Number(pWeights[key]);
                if(!isFinite(weight) || weight <= 0)
                    continue;
                if(!registry[key])
                    continue;
                keys.push({ name: key, weight: weight });
                total += weight;
            }
        }

        if(!keys.length || total <= 0)
            return null;

        if(keys.length === 1)
            return keys[0].name;

        var roll = pRandom.Float(0, total);
        var cumulative = 0;
        for(var index = 0; index < keys.length; ++index) {
            cumulative += keys[index].weight;
            if(roll <= cumulative)
                return keys[index].name;
        }

        return keys[keys.length - 1].name;
    }

    MapGen.Layout.Templates.Register = function(pTemplate) {
        if(!pTemplate || typeof pTemplate.Name !== "string")
            return;
        registry[pTemplate.Name] = pTemplate;
    };

    MapGen.Layout.Templates.Get = function(pName) {
        return registry[pName] || null;
    };

    MapGen.Layout.Templates.Names = function() {
        var out = [];
        for(var key in registry)
            if(registry.hasOwnProperty(key))
                out.push(key);
        out.sort();
        return out;
    };

    MapGen.Layout.Templates.PickName = function(pRandom, pWeights, pFallback) {
        var picked = pickWeighted(pRandom, pWeights);
        if(picked)
            return picked;
        if(pFallback && registry[pFallback])
            return pFallback;
        return "classic";
    };

    MapGen.Layout.Templates.Resolve = function(pContext) {
        var name = pContext && pContext.Profile ? pContext.Profile.LayoutTemplate : null;
        if(name && registry[name])
            return registry[name];
        return registry.classic || null;
    };

    MapGen.Layout.Templates.Registry = ensureRegistry;
})();
