var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};

// Only Jungle and Ice are reachable: those are the only TerrainTypes any
// shipped profile selects (Profiles.js). Unsupported TerrainTypes should fail
// loudly instead of being silently rendered as Jungle.
MapGen.Terrain.Smoothing.Render = function(pContext, pOptions) {
    var smoothing = MapGen.Terrain.Smoothing;
    var dispatch = {};

    dispatch[Terrain.Types.Jungle] = smoothing.Jungle;
    dispatch[Terrain.Types.Ice] = smoothing.Ice;

    var terrainType = pContext && pContext.Profile ? pContext.Profile.TerrainType : null;
    var smoother = dispatch[terrainType];
    if(!smoother)
        // P1.3 (v3 author contract): tagged with RendererUnsupportedIntent enum
        // string per v3.4 §3.5 + AuthorReason.RendererUnsupportedIntent. v3
        // Concept.appliesTo() prevents this dispatch from being reached with an
        // unsupported TerrainType, so this remains a programmer-bug-guard, not
        // an expected candidate failure. See Documentation/Future/Phase0/D7_author_contract.md.
        throw "RendererUnsupportedIntent: Unsupported terrain smoothing TerrainType: " + terrainType;

    // RENDER-COUNT PROFILER (flag-gated, dev only). Counts EVERY render across all
    // retry attempts + repair re-renders + the structure flush (the per-context
    // Timings only see the winning attempt). Appends one line per render to
    // mapgen_render_log.txt so we can measure how many renders fire/map and how many
    // are wasted on rejected attempts. Enable: Run/mapgen_render_log.flag.
    var renderLog = smoothing.RenderLogEnabled && smoothing.RenderLogEnabled();
    var startMs = renderLog ? (new Date()).getTime() : 0;

    var result = smoother.Render(pContext, pOptions || {});

    if(renderLog) {
        var elapsed = (new Date()).getTime() - startMs;
        var biome = pContext && pContext.Profile ? pContext.Profile.TerrainType : "?";
        var seed = pContext ? pContext.Seed : "?";
        var attempt = (pContext && typeof pContext.Attempt === "number") ? pContext.Attempt : "?";
        var ok = pContext && pContext.Validation ? (pContext.Validation.ok ? 1 : 0) : "?";
        smoothing._renderRecords = smoothing._renderRecords || [];
        smoothing._renderRecords.push("biome=" + biome + ",seed=" + seed + ",attempt=" + attempt + ",valid=" + ok + ",ms=" + elapsed);
        try {
            var f = new FileIO("mapgen_render_log.txt", false);
            if(f.isOpen()) {
                f.writeLine("renders=" + smoothing._renderRecords.length);
                for(var ri = 0; ri < smoothing._renderRecords.length; ++ri)
                    f.writeLine(smoothing._renderRecords[ri]);
                f.close();
            }
        } catch(e) {}
    }

    // Idempotency self-check (flag-gated, dev only). Proves the render is a pure
    // function of its committed input: render once, snapshot blocked + Tiles, render
    // AGAIN on that same committed state, and assert nothing changed. Before the
    // injected-cover reclaim this failed (cover compounded across renders); it must
    // now report idem_diff=0. Enable with Run/mapgen_idempotency_check.flag; the
    // result is logged and written to the context dump (IdempotencyCheck).
    if(result && MapGen.Terrain.Smoothing.IdempotencyCheckEnabled &&
        MapGen.Terrain.Smoothing.IdempotencyCheckEnabled(pContext)) {
        MapGen.Terrain.Smoothing.RunIdempotencyCheck(pContext, smoother, result, pOptions || {});
    }

    return result;
};

MapGen.Terrain.Smoothing.RenderLogEnabled = function() {
    if(typeof FileIO === "undefined")
        return false;
    try {
        var flag = new FileIO("mapgen_render_log.flag", true);
        var enabled = flag.isOpen();
        if(enabled)
            flag.close();
        return enabled;
    } catch(e) {
        return false;
    }
};

MapGen.Terrain.Smoothing.IdempotencyCheckEnabled = function(pContext) {
    if(pContext && pContext.IdempotencyCheck)
        return true;
    if(typeof Settings !== "undefined" && Settings.MapGenIdempotencyCheck)
        return true;
    if(typeof FileIO === "undefined")
        return false;
    try {
        var flag = new FileIO("mapgen_idempotency_check.flag", true);
        var enabled = flag.isOpen();
        if(enabled)
            flag.close();
        return enabled;
    } catch(e) {
        return false;
    }
};

MapGen.Terrain.Smoothing.RunIdempotencyCheck = function(pContext, pSmoother, pFirst, pOptions) {
    var layers = pContext.Layers || {};
    var blockedBefore = layers.blocked ? MapGen.Layers.Clone(layers.blocked) : null;
    var firstTiles = pFirst.Tiles;

    // Negative control: when the negative-control flag is set, the SECOND render
    // skips the reclaim, so cover compounds and the diff must come back NONZERO.
    // This proves the probe actually detects compounding (guards against a probe
    // that is silently always-zero). Normal runs leave the flag unset.
    var negative = false;
    if(typeof FileIO !== "undefined") {
        try {
            var nf = new FileIO("mapgen_idempotency_negative.flag", true);
            if(nf.isOpen()) { negative = true; nf.close(); }
        } catch(e) {}
    }
    pContext._idemNegativeControl = negative;

    var second = pSmoother.Render(pContext, pOptions || {});
    pContext._idemNegativeControl = false;
    var blockedDiff = 0;
    var tileDiff = 0;
    var samples = [];

    for(var x = 0; x < pContext.Width; ++x) {
        for(var y = 0; y < pContext.Height; ++y) {
            if(blockedBefore &&
                MapGen.Layers.Get(blockedBefore, x, y, 0) !== MapGen.Layers.Get(layers.blocked, x, y, 0))
                ++blockedDiff;
            if(firstTiles && second && second.Tiles) {
                var t1 = MapGen.Layers.Get(firstTiles, x, y, 0);
                var t2 = MapGen.Layers.Get(second.Tiles, x, y, 0);
                if(t1 !== t2) {
                    ++tileDiff;
                    if(samples.length < 12)
                        samples.push({ x: x, y: y, first: t1, second: t2, firstId: t1 & 0x1FF, secondId: t2 & 0x1FF });
                }
            }
        }
    }

    pContext.IdempotencyResult = {
        blockedDiff: blockedDiff,
        tileDiff: tileDiff,
        samples: samples
    };
    if(MapGen.Context && MapGen.Context.AddLog)
        MapGen.Context.AddLog(pContext, "Idempotency check: blockedDiff=" + blockedDiff + ", tileDiff=" + tileDiff);

    return pContext.IdempotencyResult;
};
