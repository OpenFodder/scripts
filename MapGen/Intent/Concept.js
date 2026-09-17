// MapGen v3 Intent — Concept registry + picker plumbing.
//
// Per OpenFodder_Map_Generator_Rewrite_Design_v3.4.md §4.1 (Concept contract)
// and §4.3 (picker), with the Grammar boundary in §3.6.
//
// A Concept definition is a plain object:
//   {
//     id:                     'ice_open_arena',
//     biome:                  'ice' | 'jungle',
//     appliesTo:              function(profile, dimensions) -> bool,
//     author:                 function(plan, intentMap, rngs) -> AuthorResult,
//     intentHardValidators:   [...],
//     intentQualityValidators:[...],
//     driftBudget:            { ... },
//     finaliseConcept:        function(intentMap, renderedMap) -> void
//   }
//
// This file does NOT register any actual Concepts — those land as separate
// work items (P1.6+: ice_open_arena minimal Concept first, then ice variants
// then jungle). It only holds the registry, RegisterConcept(), PickConcept(),
// and ListConcepts().

var MapGen = MapGen || {};
MapGen.Intent = MapGen.Intent || {};
MapGen.Intent.Registry = MapGen.Intent.Registry || {};

(function() {

    // -----------------------------------------------------------------------
    // Definition validation. Loud failure on missing required fields — every
    // Concept author should hit this exactly once during local dev and never
    // again, so it's a thrown Error rather than a soft AuthorResult.

    function validateDefinition(def) {
        if(!def || typeof def !== 'object') {
            throw new Error('MapGen.Intent.RegisterConcept: definition must be an object');
        }
        if(typeof def.id !== 'string' || def.id.length === 0) {
            throw new Error('MapGen.Intent.RegisterConcept: definition.id must be a non-empty string');
        }
        if(def.biome !== 'ice' && def.biome !== 'jungle') {
            throw new Error('MapGen.Intent.RegisterConcept[' + def.id + ']: biome must be "ice" or "jungle"');
        }
        if(typeof def.appliesTo !== 'function') {
            throw new Error('MapGen.Intent.RegisterConcept[' + def.id + ']: appliesTo must be a function');
        }
        if(typeof def.author !== 'function') {
            throw new Error('MapGen.Intent.RegisterConcept[' + def.id + ']: author must be a function');
        }
    }

    // -----------------------------------------------------------------------
    // RegisterConcept

    MapGen.Intent.RegisterConcept = function(definition) {
        validateDefinition(definition);

        if(MapGen.Intent.Registry[definition.id]) {
            throw new Error(
                'MapGen.Intent.RegisterConcept: concept "' + definition.id +
                '" already registered'
            );
        }

        // Defensive defaults so PickConcept callers can iterate the optional
        // arrays/objects without null checks.
        if(!definition.intentHardValidators) {
            definition.intentHardValidators = [];
        }
        if(!definition.intentQualityValidators) {
            definition.intentQualityValidators = [];
        }
        if(!definition.driftBudget) {
            definition.driftBudget = {};
        }
        if(typeof definition.finaliseConcept !== 'function') {
            definition.finaliseConcept = function() { /* default no-op */ };
        }

        var budgetErrors = MapGen.Intent.Drift.ValidateBudget(definition.driftBudget);
        if(budgetErrors.length) throw new Error(budgetErrors.join(", "));
        MapGen.Intent.Registry[definition.id] = definition;
        return definition;
    };

    // -----------------------------------------------------------------------
    // PickConcept
    //
    // Per §3.6 the Grammar layer (Grammar/Intent.Select) IS the upstream
    // picker — by the time we get here the plan already carries strings like
    // plan.intent.iceLayoutStyle / archetype / objectiveLabel. This function
    // dispatches off those strings: it walks every Concept registered for the
    // plan's biome and returns the first whose appliesTo() accepts.
    //
    // Returns null if nothing matches. The caller is expected to fall back to
    // the profile's fallbackConcept; that fallback hand-off is policy and
    // does not belong here.

    MapGen.Intent.PickConcept = function(profile, plan, dimensions) {
        if(!profile || !plan) {
            return null;
        }
        var biome = profile.biome || (plan.intent ? plan.intent.biome : null);
        var fallbackId = biome === "ice" ? "ice_open_arena" :
            (biome === "jungle" ? "jungle_open_arena" : "");

        // Regional ice composes ordinary styles; named maze, neck and cliff
        // contracts continue through their specialised authors below.
        var regional = MapGen.Intent.Registry.ice_regional;
        if(biome === "ice" && regional && regional.appliesTo(profile, dimensions, plan))
            return regional;

        for(var id in MapGen.Intent.Registry) {
            if(!MapGen.Intent.Registry.hasOwnProperty(id)) {
                continue;
            }
            // Open-arena Concepts are fallbacks, not ordinary candidates.
            // Folder load order is alphabetical, so allowing an always-true
            // fallback through this loop made later specific Concepts (most
            // notably ice_river_fork) permanently unreachable.
            if(id === fallbackId) {
                continue;
            }
            var concept = MapGen.Intent.Registry[id];
            if(biome && concept.biome !== biome) {
                continue;
            }
            try {
                if(concept.appliesTo(profile, dimensions, plan)) {
                    return concept;
                }
            } catch(e) {
                // A Concept's appliesTo throwing is a programmer bug — surface
                // by skipping rather than nuking the whole pick. Real diagnostic
                // wiring lands in P1.13+ (telemetry slice).
                continue;
            }
        }
        return null;
    };

    // -----------------------------------------------------------------------
    // ListConcepts — diagnostics / introspection.

    MapGen.Intent.ListConcepts = function(biome) {
        var ids = [];
        for(var id in MapGen.Intent.Registry) {
            if(!MapGen.Intent.Registry.hasOwnProperty(id)) {
                continue;
            }
            if(biome && MapGen.Intent.Registry[id].biome !== biome) {
                continue;
            }
            ids.push(id);
        }
        return ids;
    };

})();
