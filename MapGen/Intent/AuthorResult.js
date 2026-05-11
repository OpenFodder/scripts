// MapGen v3 Intent — AuthorResult.
//
// Per OpenFodder_Map_Generator_Rewrite_Design_v3.4.md §3.5. A Concept's
// authoring function returns one of:
//   - AuthorResult.Ok(diagnostics?)    on successful authoring
//   - AuthorResult.Fail(reason, ...)   when the Concept cannot author this seed
//
// `reason` MUST be a key from MapGen.Intent.AuthorReason. Passing a string
// outside the enum is a programmer bug (typo, stale string, missing import)
// and Fail() throws a real Error to surface it loudly. This is what makes
// the enum stable across the codebase: silent typos can't accumulate.

var MapGen = MapGen || {};
MapGen.Intent = MapGen.Intent || {};

MapGen.Intent.AuthorReason = {
    NoValidTransit:                 'NoValidTransit',
    ClaimConflict:                  'ClaimConflict',
    InsufficientOpenArea:           'InsufficientOpenArea',
    RendererUnsupportedIntent:      'RendererUnsupportedIntent',
    NoValidObjectivePlacement:      'NoValidObjectivePlacement',
    ProfileConstraintUnsatisfied:   'ProfileConstraintUnsatisfied',
    UnknownAuthoringFailure:        'UnknownAuthoringFailure'
};

MapGen.Intent.AuthorResult = {

    Ok: function(diagnostics) {
        return {
            ok:          true,
            diagnostics: diagnostics ? diagnostics : []
        };
    },

    Fail: function(reason, diagnostics) {
        if(!isValidReason(reason)) {
            // Programmer bug: surface with a real Error rather than returning
            // a silently-malformed result. Caller stack trace tells you which
            // Concept used the bad reason string.
            throw new Error(
                'MapGen.Intent.AuthorResult.Fail: invalid reason "' + reason +
                '". Must be a key from MapGen.Intent.AuthorReason.'
            );
        }
        return {
            ok:          false,
            kind:        'ConceptUnauthorable',
            reason:      reason,
            diagnostics: diagnostics ? diagnostics : []
        };
    },

    // Diagnostic factory. Concepts emit these to explain why a particular
    // authoring step succeeded with caveats or failed; validators consume
    // them to surface regression candidates.
    //
    // opts:
    //   cells        : array of {x,y} the diagnostic refers to (default [])
    //   severity     : 'info' | 'warn' | 'error'                (default 'info')
    //   memorySlugs  : array of project_*.md slugs              (default [])
    Diagnostic: function(site, message, opts) {
        var o = opts || {};
        return {
            site:        site,
            message:     message,
            cells:       o.cells       ? o.cells       : [],
            severity:    o.severity    ? o.severity    : 'info',
            memorySlugs: o.memorySlugs ? o.memorySlugs : []
        };
    }

};

function isValidReason(reason) {
    if(typeof reason !== 'string') {
        return false;
    }
    var reasons = MapGen.Intent.AuthorReason;
    for(var k in reasons) {
        if(reasons.hasOwnProperty(k) && reasons[k] === reason) {
            return true;
        }
    }
    return false;
}
