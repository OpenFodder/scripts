var MapGen = MapGen || {};

MapGen.Context = {

    // Architecture v3 game-mode presets. The ONLY legitimate campaign/MP seam:
    // which anchors get placed (layout) and which sprite/objective builders run.
    // Terrain/layout never branch on this. Extend with mission/game-type rules
    // when those features land — this is their designated home.
    GameModes: {
        Campaign: function() {
            return {
                kind: "campaign",
                anchors: "campaign",
                placement: "campaign",
                // P1.12 (v3.4 §4.4 line 359): when true, the v3 picker forbids
                // fallback to non-MP Concepts on candidate failure. Campaign is
                // the default false — fallback to ${biome}_open_arena is allowed.
                // Per D12-Q2 + D13 §3 fallback ceiling table.
                requiresMpFairness: false
            };
        },
        Multiplayer: function() {
            return {
                kind: "multiplayer",
                anchors: "teams",
                placement: "multiplayer",
                // P1.12 (v3.4 §4.4): MP profiles forbid fallback for symmetry-
                // required Concepts. The picker uses this flag to suppress
                // non-MP Concept fallback when an mp_* Concept's appliesTo()
                // rejects the seed; instead the seed is rejected and retried
                // with a different MP Concept. Per D12 §6 D12-Q2.
                requiresMpFairness: true
            };
        }
    },

    IsMultiplayer: function(pContext) {
        return !!(pContext && pContext.GameMode && pContext.GameMode.kind === "multiplayer");
    },

    SafeDimension: function(pValue) {
        var value = Math.floor(Number(pValue));

        if(isNaN(value) || value < 1)
            return 1;

        return value;
    },

    Create: function(pOptions) {
        var options = pOptions || {};
        var profile = options.Profile;
        var seed = options.Seed;
        var profileTimings = !!options.ProfileTimings;
        var map = options.Map || (typeof Map !== "undefined" ? Map : null);

        if(seed === undefined && options.Map)
            seed = options.Map.seed;
        else if(seed === undefined && map)
            seed = map.seed;
        if(seed === undefined)
            seed = 0;

        var random = options.Random || MapGen.Random.CreateSeeded(seed);

        if(!profile)
            profile = MapGen.Profiles.Resolve(options.ProfileName, options.Overrides, random);

        var width = this.SafeDimension(profile.Width);
        var height = this.SafeDimension(profile.Height);

        return {
            Version: 1,
            Seed: seed,
            RequestedSeed: options.RequestedSeed !== undefined ?
                options.RequestedSeed : seed,
            Attempt: options.Attempt || 0,
            Map: map,
            Random: random,
            Profile: profile,
            // Architecture v3: the single carrier of game-mode intent. Layout/
            // terrain are mode-AGNOSTIC; only anchor placement and sprite/
            // objective stages read this. Set by the entry point (campaign vs
            // multiplayer). Future home for allowed objectives / mission filters
            // (campaign) and team count / game type (multiplayer).
            GameMode: options.GameMode || null,
            FastTileIteration: !!options.FastTileIteration,
            DebugDumps: !!options.DebugDumps,
            IceDebugDumps: !!options.IceDebugDumps,
            // The retry framework sets this on the LAST attempt only. The
            // EarlyValidateCoverage stage skips itself when this is true so
            // that the doomed-but-final attempt still produces a renderable
            // map (the engine needs RenderedMap.Tiles regardless of validation
            // status). RCA 2026-06-13.
            IsLastAttempt: !!options.IsLastAttempt,
            Width: width,
            Height: height,
            Layers: MapGen.Layers.CreateSet(width, height),
            Anchors: {},
            Regions: [],
            Paths: [],
            Rivers: [],
            Ponds: [],
            Lakes: [],
            Beaches: [],
            Outcrops: [],
            Crossings: [],
            Clearings: [],
            CriticalPoints: [],
            ConnectivityNodes: [],
            Tactical: null,
            Placements: {
                players: [],
                teams: [],
                enemies: [],
                objectives: [],
                structures: [],
                pickups: [],
                vehicles: [],
                decor: []
            },
            RenderedMap: null,
            Metrics: null,
            Validation: null,
            RepairPasses: 0,
            Retry: null,
            Log: [],
            ProfileTimings: profileTimings,
            Timings: profileTimings ? [] : null
        };
    },

    AddLog: function(pContext, pMessage) {
        pContext.Log.push(pMessage);
    },

    // Optional pass-timing instrumentation. Off by default — set
    // pOptions.ProfileTimings on Context.Create (or override on the context
    // directly) to record { label, ms } entries into pContext.Timings. Each
    // wrapped pass adds one entry; nested wraps stack via dotted labels.
    Time: function(pContext, pLabel, pFn) {
        if(!pContext || !pContext.ProfileTimings)
            return pFn();
        if(!pContext.Timings)
            pContext.Timings = [];
        var start = (new Date()).getTime();
        var parent = pContext._timingFrame || null;
        var frame = { children: 0 };
        pContext._timingFrame = frame;
        var result;
        try {
            result = pFn();
        } finally {
            var ms = (new Date()).getTime() - start;
            pContext._timingFrame = parent;
            if(parent) parent.children += ms;
            pContext.Timings.push({ label: pLabel, ms: ms,
                selfMs: Math.max(0, ms - frame.children), root: !parent });
        }
        return result;
    },

    TimingsReport: function(pContext) {
        if(!pContext || !pContext.Timings || !pContext.Timings.length)
            return "(no timings — set ProfileTimings:true on the context)";

        var totals = {};
        var order = [];
        var grand = 0;
        for(var i = 0; i < pContext.Timings.length; ++i) {
            var entry = pContext.Timings[i];
            if(totals[entry.label] === undefined) {
                totals[entry.label] = 0;
                order.push(entry.label);
            }
            totals[entry.label] += entry.ms;
            if(entry.root) grand += entry.ms;
        }

        var lines = [];
        for(var j = 0; j < order.length; ++j) {
            var label = order[j];
            var ms = totals[label];
            var pct = grand > 0 ? Math.round((ms / grand) * 1000) / 10 : 0;
            lines.push("  " + label + " : " + ms + " ms (" + pct + "%)");
        }
        lines.push("  ROOT TIMERS : " + grand + " ms (nested timers excluded)");
        return lines.join("\n");
    }
};
