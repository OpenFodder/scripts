var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// Allocate optional tree growth before smoothing, leaving room in the drift
// budget for shoreline transitions and the final structure art.
(function(S) {
    S.Build = function(c) {
        var m = c.IntentMap, E = MapGen.Intent;
        if(!m || c.TerrainSpace)
            return;
        var W = c.Width, H = c.Height, N = W * H, allowed = new Uint8Array(N), candidates = [];
        var land = 0, shore = 0, g = MapGen.Layers.Get, R = MapGen.Layout.Reservations;
        for(var i = 0; i < N; ++i) {
            var t = m.terrain[i], x = i % W, y = Math.floor(i / W);
            if(t === E.Terrain.FOREST || t === E.Terrain.OUTCROP || (m.claim[i] & E.Claim.STRUCT_WALL))
                allowed[i] = 1;
            var solid = t === E.Terrain.FOREST || t === E.Terrain.WATER || t === E.Terrain.RIVER ||
                        t === E.Terrain.CLIFF_BODY || t === E.Terrain.CLIFF_TOP || t === E.Terrain.OUTCROP ||
                        m.movement[i] & E.Movement.BLOCKED;
            if(solid)
                continue;
            ++land;
            if(MapGen.Integration.StructureCellIsWaterLike(c, x, y)) {
                ++shore;
                continue;
            }
            if(R.BlocksCover(c, x, y))
                continue;
            var distance = 9;
            for(var dy = -2; dy <= 2; ++dy)
                for(var dx = -2; dx <= 2; ++dx) {
                    if(x + dx < 0 || x + dx >= W || y + dy < 0 || y + dy >= H)
                        continue;
                    if(m.terrain[i + dy * W + dx] === E.Terrain.FOREST)
                        distance = Math.min(distance, Math.abs(dx) + Math.abs(dy));
                }
            if(distance <= 2)
                candidates.push({
                    i : i,
                    d : distance,
                    order : MapGen.Random.HashTile(c.Seed, Math.floor(x / 6), Math.floor(y / 6), 7431)
                });
        }
        var concept = E.Registry[c.ConceptId], budget = concept && concept.driftBudget || {};
        var limit = budget.landIntentSolidMaxFraction;
        if(typeof limit !== "number")
            limit = E.Drift.BudgetDefaults.landIntentSolidMaxFraction;
        var capacity = Math.max(0, Math.floor(land * limit * 0.65) - shore);
        candidates.sort(function(a, b) { return a.d - b.d || a.order - b.order || a.i - b.i; });
        for(var k = 0; k < Math.min(capacity, candidates.length); ++k)
            allowed[candidates[k].i] = 1;
        c.TerrainSpace = {
            cover : allowed,
            landCells : land,
            shoreCells : shore,
            capacity : capacity,
            optionalCoverCells : Math.min(capacity, candidates.length),
            selectedCounts : null
        };
    };
    S.AllowsCover = function(c, x, y) { return !c.TerrainSpace || !!c.TerrainSpace.cover[y * c.Width + x]; };
    // Reconcile the budget against the cover that actually survived the
    // tactical passes.  Build() runs before those passes and therefore cannot
    // know which optional proposals will be useful (in particular, an
    // authored open-field screen may be allocated to a different patch).
    S.FitCover = function(c) {
        var space = c.TerrainSpace;
        if(!space)
            return null;
        var m = c.IntentMap, E = MapGen.Intent, R = MapGen.Layout.Reservations;
        var W = c.Width, H = c.Height, N = W * H, l = c.Layers;
        var next = new Uint8Array(N), candidates = [];
        var mandatory = 0, currentAllowed = 0, marked = 0;
        for(var i = 0; i < N; ++i) {
            var x = i % W, y = Math.floor(i / W);
            var terrain = m && m.terrain ? m.terrain[i] : null;
            var claim = m && m.claim ? m.claim[i] : 0;
            var isMandatory = terrain === E.Terrain.FOREST ||
                terrain === E.Terrain.OUTCROP || !!(claim & E.Claim.STRUCT_WALL);
            if(isMandatory) {
                next[i] = 1;
                ++mandatory;
                continue;
            }
            if(!MapGen.Layers.Get(l.blocked, x, y, 0) ||
                terrain !== E.Terrain.LAND || R.BlocksCover(c, x, y) ||
                R.IsWater(c, x, y) ||
                MapGen.Layers.Get(l.owner, x, y, 0) === MapGen.Layers.Owner.CLIFF)
                continue;
            var isMarked = !!(l.openFieldScreen &&
                MapGen.Layers.Get(l.openFieldScreen, x, y, 0));
            var wasAllowed = !!space.cover[i];
            if(isMarked) ++marked;
            if(wasAllowed) ++currentAllowed;
            candidates.push({
                i : i,
                required : isMarked ? 1 : 0,
                existing : wasAllowed ? 1 : 0,
                hash : MapGen.Random.HashTile(c.Seed, Math.floor(x / 6),
                                               Math.floor(y / 6), 7447)
            });
        }
        candidates.sort(function(a, b) {
            return b.required - a.required || b.existing - a.existing ||
                a.hash - b.hash || a.i - b.i;
        });
        var limit = Math.max(0, Math.floor(Number(space.capacity) || 0));
        var selected = 0, selectedMarked = 0, selectedExisting = 0;
        for(var k = 0; k < candidates.length && selected < limit; ++k) {
            var candidate = candidates[k];
            next[candidate.i] = 1;
            ++selected;
            if(candidate.required) ++selectedMarked;
            else if(candidate.existing) ++selectedExisting;
        }
        space.cover = next;
        space.optionalCoverCells = selected;
        space.selectedCounts = {
            mandatory : mandatory,
            candidates : candidates.length,
            markedCandidates : marked,
            existingCandidates : currentAllowed,
            selected : selected,
            selectedMarked : selectedMarked,
            selectedExisting : selectedExisting,
            dropped : Math.max(0, candidates.length - selected)
        };
        S.Apply(c);
        return space.selectedCounts;
    };
    S.Apply = function(c) {
        if(!c.TerrainSpace)
            return;
        var l = c.Layers, E = MapGen.Layers.Owner;
        for(var y = 0; y < c.Height; ++y)
            for(var x = 0; x < c.Width; ++x) {
                if(!S.AllowsCover(c, x, y) && MapGen.Layers.Get(l.owner, x, y, 0) !== E.CLIFF)
                    l.blocked[x][y] = 0;
            }
    };
    S.ApplyChars = function(c, chars) {
        if(!c.TerrainSpace)
            return 0;
        var ice = MapGen.Terrain.Smoothing.Ice, changed = 0;
        for(var y = 0; y < c.Height; ++y)
            for(var x = 0; x < c.Width; ++x) {
                if(chars[x][y] === ice.Chars.tree && !S.AllowsCover(c, x, y)) {
                    chars[x][y] = ice.Chars.ground;
                    ++changed;
                }
            }
        return changed;
    };
})(MapGen.Layout.TerrainSpace = MapGen.Layout.TerrainSpace || {});
