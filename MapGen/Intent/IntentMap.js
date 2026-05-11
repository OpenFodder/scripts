// MapGen v3 Intent — multi-plane IntentMap data model.
//
// Per OpenFodder_Map_Generator_Rewrite_Design_v3.4.md §3.2 (multi-plane schema),
// §3.3 (Claim API), §3.4 (conflict policy).
//
// Pure data model: no engine binding, no v1 imports. Constructed empty by
// MapGen.Intent.Map.Create(width, height); mutated in place by Concept
// authoring functions; read by validators and the (future) Composite stage.
//
// Conflict policy summary (§3.4):
//   - terrain / owner are ENUM planes — single value per cell, conflicts
//     resolved by request priority. Equal priority = FIRST_WRITER_WINS.
//   - movement / claim are FLAGS planes — multiple bits per cell, conflicts
//     resolved by OR-merging when requested priority >= existing priority,
//     otherwise dropped.
//   - All ClaimCell calls return a ClaimResult (never throw on conflict);
//     out-of-bounds returns ok:false with a sentinel conflict reason.

var MapGen = MapGen || {};
MapGen.Intent = MapGen.Intent || {};
MapGen.Intent.Map = MapGen.Intent.Map || {};

(function() {

    function inBounds(map, x, y) {
        return x >= 0 && y >= 0 && x < map.width && y < map.height;
    }

    function idx(map, x, y) {
        return (y * map.width) + x;
    }

    // -----------------------------------------------------------------------
    // Construction

    MapGen.Intent.Map.Create = function(width, height) {
        var w = width | 0;
        var h = height | 0;
        var n = w * h;

        var map = {
            width:    w,
            height:   h,
            terrain:  new Uint8Array(n),   // default LAND (0)
            movement: new Uint16Array(n),  // default 0 (no flags)
            claim:    new Uint16Array(n),  // default 0
            owner:    new Uint16Array(n),  // default NONE (0)

            // Per-plane priority shadow grids. Each cell tracks the highest
            // priority value that has written to that plane, so subsequent
            // ClaimCell requests can be resolved per §3.4.
            _terrainPriority:  new Uint16Array(n),
            _movementPriority: new Uint16Array(n),
            _claimPriority:    new Uint16Array(n),
            _ownerPriority:    new Uint16Array(n),

            regions: [],   // populated by Concepts via MP primitives etc.
            routes:  [],   // RouteGraph entries (Phase 5)
            objects: []    // structure / objective placements
        };

        return map;
    };

    // -----------------------------------------------------------------------
    // Terrain plane (ENUM)

    MapGen.Intent.Map.GetTerrain = function(map, x, y) {
        if(!inBounds(map, x, y)) {
            return MapGen.Intent.Terrain.LAND;
        }
        return map.terrain[idx(map, x, y)];
    };

    MapGen.Intent.Map.SetTerrain = function(map, x, y, value) {
        if(!inBounds(map, x, y)) {
            return false;
        }
        map.terrain[idx(map, x, y)] = value & 0xFF;
        return true;
    };

    // -----------------------------------------------------------------------
    // Movement plane (FLAGS)

    MapGen.Intent.Map.GetMovement = function(map, x, y) {
        if(!inBounds(map, x, y)) {
            return 0;
        }
        return map.movement[idx(map, x, y)];
    };

    MapGen.Intent.Map.AddMovement = function(map, x, y, flags) {
        if(!inBounds(map, x, y)) {
            return false;
        }
        var i = idx(map, x, y);
        map.movement[i] = (map.movement[i] | flags) & 0xFFFF;
        return true;
    };

    MapGen.Intent.Map.ClearMovement = function(map, x, y, flags) {
        if(!inBounds(map, x, y)) {
            return false;
        }
        var i = idx(map, x, y);
        map.movement[i] = (map.movement[i] & (~flags)) & 0xFFFF;
        return true;
    };

    MapGen.Intent.Map.HasMovement = function(map, x, y, flags) {
        if(!inBounds(map, x, y)) {
            return false;
        }
        return (map.movement[idx(map, x, y)] & flags) !== 0;
    };

    // -----------------------------------------------------------------------
    // Claim plane (FLAGS)

    MapGen.Intent.Map.GetClaim = function(map, x, y) {
        if(!inBounds(map, x, y)) {
            return 0;
        }
        return map.claim[idx(map, x, y)];
    };

    MapGen.Intent.Map.AddClaim = function(map, x, y, flags) {
        if(!inBounds(map, x, y)) {
            return false;
        }
        var i = idx(map, x, y);
        map.claim[i] = (map.claim[i] | flags) & 0xFFFF;
        return true;
    };

    MapGen.Intent.Map.ClearClaim = function(map, x, y, flags) {
        if(!inBounds(map, x, y)) {
            return false;
        }
        var i = idx(map, x, y);
        map.claim[i] = (map.claim[i] & (~flags)) & 0xFFFF;
        return true;
    };

    MapGen.Intent.Map.HasClaim = function(map, x, y, flags) {
        if(!inBounds(map, x, y)) {
            return false;
        }
        return (map.claim[idx(map, x, y)] & flags) !== 0;
    };

    // -----------------------------------------------------------------------
    // Owner plane (ENUM)

    MapGen.Intent.Map.GetOwner = function(map, x, y) {
        if(!inBounds(map, x, y)) {
            return MapGen.Intent.Owner.NONE;
        }
        return map.owner[idx(map, x, y)];
    };

    MapGen.Intent.Map.SetOwner = function(map, x, y, value) {
        if(!inBounds(map, x, y)) {
            return false;
        }
        map.owner[idx(map, x, y)] = value & 0xFFFF;
        return true;
    };

    // -----------------------------------------------------------------------
    // Unified ClaimCell — applies §3.4 conflict policy.

    function makeResult(ok, conflict, existing, requested) {
        return {
            ok:        ok,
            conflict:  conflict,
            existing:  existing,
            requested: requested
        };
    }

    MapGen.Intent.Map.ClaimCell = function(map, x, y, request) {
        if(!inBounds(map, x, y)) {
            return makeResult(false, 'oob', null, request ? request.value : null);
        }
        if(!request || !request.plane) {
            return makeResult(false, 'badrequest', null, null);
        }

        var i = idx(map, x, y);
        var plane = request.plane;
        var value = request.value | 0;
        var priority = (request.priority | 0);

        if(plane === 'terrain') {
            var cur = map.terrain[i];
            var curPri = map._terrainPriority[i];
            if(priority > curPri) {
                map.terrain[i] = value & 0xFF;
                map._terrainPriority[i] = priority & 0xFFFF;
                return makeResult(true, null, cur, value);
            }
            if(priority === curPri && cur === 0 && map._terrainPriority[i] === 0) {
                // FIRST_WRITER_WINS: never written before — accept.
                map.terrain[i] = value & 0xFF;
                map._terrainPriority[i] = priority & 0xFFFF;
                return makeResult(true, null, cur, value);
            }
            return makeResult(false, 'terrain', cur, value);
        }

        if(plane === 'owner') {
            var ocur = map.owner[i];
            var ocurPri = map._ownerPriority[i];
            if(priority > ocurPri) {
                map.owner[i] = value & 0xFFFF;
                map._ownerPriority[i] = priority & 0xFFFF;
                return makeResult(true, null, ocur, value);
            }
            if(priority === ocurPri && ocur === 0 && map._ownerPriority[i] === 0) {
                map.owner[i] = value & 0xFFFF;
                map._ownerPriority[i] = priority & 0xFFFF;
                return makeResult(true, null, ocur, value);
            }
            return makeResult(false, 'owner', ocur, value);
        }

        if(plane === 'movement') {
            var mcur = map.movement[i];
            var mcurPri = map._movementPriority[i];
            if(priority >= mcurPri) {
                map.movement[i] = (mcur | value) & 0xFFFF;
                if(priority > mcurPri) {
                    map._movementPriority[i] = priority & 0xFFFF;
                }
                return makeResult(true, null, mcur, value);
            }
            return makeResult(false, 'movement', mcur, value);
        }

        if(plane === 'claim') {
            var ccur = map.claim[i];
            var ccurPri = map._claimPriority[i];
            if(priority >= ccurPri) {
                map.claim[i] = (ccur | value) & 0xFFFF;
                if(priority > ccurPri) {
                    map._claimPriority[i] = priority & 0xFFFF;
                }
                return makeResult(true, null, ccur, value);
            }
            return makeResult(false, 'claim', ccur, value);
        }

        return makeResult(false, 'badplane', null, value);
    };

    // -----------------------------------------------------------------------
    // Iterators (typed — replace v1 reflective reads. P1.13/14/15 plug in here.)

    MapGen.Intent.Map.IterCells = function(map, predicate, callback) {
        var w = map.width;
        var h = map.height;
        for(var y = 0; y < h; ++y) {
            for(var x = 0; x < w; ++x) {
                if(!predicate || predicate(map, x, y)) {
                    callback(map, x, y);
                }
            }
        }
    };

    MapGen.Intent.Map.IterBlocked = function(map, callback) {
        var BLOCKED = MapGen.Intent.Movement.BLOCKED;
        var w = map.width;
        var h = map.height;
        for(var y = 0; y < h; ++y) {
            var row = y * w;
            for(var x = 0; x < w; ++x) {
                if((map.movement[row + x] & BLOCKED) !== 0) {
                    callback(map, x, y);
                }
            }
        }
    };

    // 4-connected flood fill. predicate(map, x, y) decides membership;
    // callback(map, x, y) is invoked once per visited member cell. Bounded
    // by map dimensions; visit set is local so concurrent floods don't
    // collide.
    MapGen.Intent.Map.Flood = function(map, startX, startY, predicate, callback) {
        if(!inBounds(map, startX, startY)) {
            return 0;
        }
        if(predicate && !predicate(map, startX, startY)) {
            return 0;
        }

        var w = map.width;
        var h = map.height;
        var visited = new Uint8Array(w * h);
        var stack = [];
        stack.push(startX);
        stack.push(startY);
        var visitCount = 0;

        while(stack.length > 0) {
            var py = stack.pop();
            var px = stack.pop();
            if(px < 0 || py < 0 || px >= w || py >= h) {
                continue;
            }
            var vi = (py * w) + px;
            if(visited[vi]) {
                continue;
            }
            if(predicate && !predicate(map, px, py)) {
                continue;
            }
            visited[vi] = 1;
            ++visitCount;
            if(callback) {
                callback(map, px, py);
            }
            stack.push(px + 1); stack.push(py);
            stack.push(px - 1); stack.push(py);
            stack.push(px);     stack.push(py + 1);
            stack.push(px);     stack.push(py - 1);
        }
        return visitCount;
    };
})();
