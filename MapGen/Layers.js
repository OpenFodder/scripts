var MapGen = MapGen || {};

MapGen.Layers = {

    // Ownership model (architecture v3, reserve-then-fill). A single `owner`
    // grid records which pass claims each cell. ClaimCell writes only when the
    // new owner OUTRANKS the current one, so the gameplay skeleton (route,
    // clearings, structures, objects) — claimed high — can never be painted
    // over by terrain fill claimed low.
    //
    // Two distinct mechanisms, do not conflate:
    //  - WRITE priority (this enum's order) resolves conflicting claims on the
    //    same cell. CLIFF (8) wins over STRUCTURE/ROUTE/CLEARING because the
    //    cliff body is a non-passable terrain feature that gameplay layers
    //    must route around — once a cliff is claimed, no later Layout pass
    //    can ClaimCell over it.
    //  - AVOIDANCE rules (e.g. "cliffs must not sit on water") are enforced by
    //    READING owner before claiming (the cliff pass skips owner==WATER cells)
    //    — NOT by enum order. WATER's rank is only its write-conflict precedence.
    //
    // Legacy boolean layers (water/blocked/keepClear/...) are projected FROM
    // owner so the smoother's input is unchanged. OPEN = walkable land awaiting
    // fill; WATER = sea/lake/river body (canvas default for non-land).
    //
    // CLIFF rank promoted 5 → 8 on 2026-06-15 ([[mapgen_cliff_edge_to_edge]]
    // Slice 0): with Plateau hoisted into Layout.Build (Slice 1), cliff
    // body cells are claimed BEFORE Clearings/CriticalSites/DefensiveLines/
    // Outcrops run. The pre-promotion CLIFF=5 was below CLEARING (6) and
    // STRUCTURE (8), which meant ClaimCell happily clobbered the cliff;
    // CLIFF=8 makes the rank actually load-bearing. OBJECT (9) is the only
    // claim that can override CLIFF.
    Owner: {
        NONE: 0,
        OPEN: 1,
        TREE: 2,
        WATER: 3,
        BEACH: 4,
        CLEARING: 5,
        ROUTE: 6,
        STRUCTURE: 7,
        CLIFF: 8,
        OBJECT: 9
    },

    Create: function(pWidth, pHeight, pDefaultValue) {
        var layer = [];

        for(var x = 0; x < pWidth; ++x) {
            layer[x] = [];
            for(var y = 0; y < pHeight; ++y)
                layer[x][y] = pDefaultValue;
        }

        return layer;
    },

    CreateSet: function(pWidth, pHeight) {
        return {
            water: this.Create(pWidth, pHeight, 0),
            riverBank: this.Create(pWidth, pHeight, 0),
            forcedBank: this.Create(pWidth, pHeight, 0),
            lakeShore: this.Create(pWidth, pHeight, 0),
            coast: this.Create(pWidth, pHeight, 0),
            crossing: this.Create(pWidth, pHeight, 0),
            causeway: this.Create(pWidth, pHeight, 0),
            keepClear: this.Create(pWidth, pHeight, 0),
            path: this.Create(pWidth, pHeight, 0),
            blocked: this.Create(pWidth, pHeight, 0),
            outcrop: this.Create(pWidth, pHeight, 0),
            terrainEdge: this.Create(pWidth, pHeight, 0),
            structureGround: this.Create(pWidth, pHeight, 0),
            occupied: this.Create(pWidth, pHeight, 0),
            elevation: this.Create(pWidth, pHeight, 0),
            // Render-injected cover markers (ice). The ice render ADDS tree cover
            // on top of the authored mask while it runs (perimeter runs, anti-empty
            // open-field sectors, diagonal tree-edge fill), writing blocked=1. Each
            // injector tags its cells in one of these marker layers so the next
            // render can reclaim (un-inject) them first — keeping the render
            // idempotent (render-once == render-twice) instead of compounding cover
            // across the >=2 renders per attempt. perimeterCover is created lazily
            // by MarkPerimeterCharCover; these two mirror it for the other injectors.
            finalFieldCover: this.Create(pWidth, pHeight, 0),
            finalRouteCover: this.Create(pWidth, pHeight, 0),
            softFillCover: this.Create(pWidth, pHeight, 0),
            treeTrimmed: this.Create(pWidth, pHeight, 0),
            // Architecture v3 ownership grid (see Owner enum). Defaults to NONE;
            // the canvas pass seeds OPEN/SEA, later passes claim upward.
            owner: this.Create(pWidth, pHeight, 0),
            // Cliff reservation marker (Option A, 2026-06-16). The ice-only
            // CliffReservation pass writes 1 on a horizontal stampHeight strip
            // BEFORE Skeleton/Coast/Rivers/Water claim the cells, so those
            // passes can skip-on-cliffReserve and Plateau later finds a
            // guaranteed-clear band. PlateauCliffs.build clears the marker
            // for cells where Plateau didn't actually stamp a cliff body.
            // Default 0 means the layer is a no-op for any biome that
            // doesn't run CliffReservation (jungle/beach/desert byte-
            // identical preserved). See [[mapgen_cliff_option_a_staged]].
            cliffReserve: this.Create(pWidth, pHeight, 0)
        };
    },

    // Claim a cell for pOwner only if it outranks the current owner. Returns
    // true if the claim was applied. This is the single write path for the
    // ownership grid — passes call it instead of Set so priority is enforced
    // in one place and the "claimed-once, never overwritten" invariant holds.
    ClaimCell: function(pLayer, pX, pY, pOwner) {
        // InBounds inlined (hot path; avoids a call frame on the no-JIT interpreter).
        var col;
        if(pX < 0 || pY < 0 || !pLayer || pX >= pLayer.length || !(col = pLayer[pX]) || pY >= col.length)
            return false;
        if(col[pY] >= pOwner)
            return false;
        col[pY] = pOwner;
        return true;
    },

    IsPlateau: function(pLayer, pX, pY) {
        return this.Get(pLayer, pX, pY, 0) > 0;
    },

    InBounds: function(pLayer, pX, pY) {
        return pX >= 0 && pY >= 0 && pLayer && pX < pLayer.length && pY < pLayer[pX].length;
    },

    Get: function(pLayer, pX, pY, pDefaultValue) {
        // InBounds inlined: Get/Set are called tens of millions of times per
        // smoothing run, so the saved call frame is a real win on Duktape (no JIT).
        // Behaviour is identical to InBounds() — returns the default on any OOB.
        var col;
        if(pX < 0 || pY < 0 || !pLayer || pX >= pLayer.length || !(col = pLayer[pX]) || pY >= col.length)
            return pDefaultValue;

        return col[pY];
    },

    Set: function(pLayer, pX, pY, pValue) {
        var col;
        if(pX < 0 || pY < 0 || !pLayer || pX >= pLayer.length || !(col = pLayer[pX]) || pY >= col.length)
            return false;

        col[pY] = pValue;
        return true;
    },

    Count: function(pLayer, pPredicate) {
        var count = 0;

        this.ForEach(pLayer, function(pValue, pX, pY) {
            if(pPredicate(pValue, pX, pY))
                ++count;
        });

        return count;
    },

    ForEach: function(pLayer, pCallback) {
        if(!pLayer)
            return;

        for(var x = 0; x < pLayer.length; ++x) {
            for(var y = 0; y < pLayer[x].length; ++y)
                pCallback(pLayer[x][y], x, y);
        }
    },

    Clone: function(pLayer) {
        var copy = [];

        for(var x = 0; x < pLayer.length; ++x) {
            copy[x] = [];
            for(var y = 0; y < pLayer[x].length; ++y)
                copy[x][y] = pLayer[x][y];
        }

        return copy;
    },

    StampDisc: function(pLayer, pCenterX, pCenterY, pRadius, pValue) {
        var radiusSq = pRadius * pRadius;

        for(var x = pCenterX - pRadius; x <= pCenterX + pRadius; ++x) {
            for(var y = pCenterY - pRadius; y <= pCenterY + pRadius; ++y) {
                var dx = x - pCenterX;
                var dy = y - pCenterY;
                if((dx * dx) + (dy * dy) <= radiusSq)
                    this.Set(pLayer, x, y, pValue);
            }
        }
    }
};
