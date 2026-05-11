// MapGen v3 Intent — MP foundation primitives.
//
// Per OpenFodder_Map_Generator_Rewrite_Design_v3.4.md §9.4 and
// Documentation/Future/Phase0/D12_mp_feasibility.md §4. v3.4 threshold T15
// requires these implemented (not just scheduled) at the end of P1.2:
//
//   1. ClaimMirroredRegion  — atomic pair-claim across an axis. Either both
//      halves succeed or neither half is written. The atomicity is what makes
//      coop-symmetric Concepts safe to author: a partial mirror would desync
//      replicas across hosts.
//
//   2. DeclarePairedRegions — mark two regions as a paired pair, optionally
//      with a strict mirror axis. Read by validators and the (future)
//      symmetry-aware picker.
//
// Helper: MirrorCell — single source of truth for mirror geometry. Three
// supported axes per v3.4 §9.4:
//   'x'     : flip X around width/2
//   'y'     : flip Y around height/2
//   'point' : 180-degree rotation around the map centre

var MapGen = MapGen || {};
MapGen.Intent = MapGen.Intent || {};

(function() {

    // -----------------------------------------------------------------------
    // Mirror geometry. Returns {x, y} (or null on bad axis). Coordinates are
    // not bounds-checked here — callers pass cells already known to be inside
    // the map; out-of-bounds writes are caught by Map.ClaimCell anyway.

    MapGen.Intent.MirrorCell = function(cell, axis, width, height) {
        if(!cell) {
            return null;
        }
        var x = cell.x | 0;
        var y = cell.y | 0;
        var w = width | 0;
        var h = height | 0;

        if(axis === 'x') {
            return { x: (w - 1) - x, y: y };
        }
        if(axis === 'y') {
            return { x: x, y: (h - 1) - y };
        }
        if(axis === 'point') {
            return { x: (w - 1) - x, y: (h - 1) - y };
        }
        return null;
    };

    // -----------------------------------------------------------------------
    // Snapshot the four planes at a single cell so we can roll back atomically
    // if any half of a mirrored claim fails.

    function snapshotCell(map, x, y) {
        var i = (y * map.width) + x;
        return {
            x:                x,
            y:                y,
            terrain:          map.terrain[i],
            movement:         map.movement[i],
            claim:            map.claim[i],
            owner:            map.owner[i],
            terrainPriority:  map._terrainPriority[i],
            movementPriority: map._movementPriority[i],
            claimPriority:    map._claimPriority[i],
            ownerPriority:    map._ownerPriority[i]
        };
    }

    function restoreCell(map, snap) {
        var i = (snap.y * map.width) + snap.x;
        map.terrain[i]           = snap.terrain;
        map.movement[i]          = snap.movement;
        map.claim[i]             = snap.claim;
        map.owner[i]             = snap.owner;
        map._terrainPriority[i]  = snap.terrainPriority;
        map._movementPriority[i] = snap.movementPriority;
        map._claimPriority[i]    = snap.claimPriority;
        map._ownerPriority[i]    = snap.ownerPriority;
    }

    // -----------------------------------------------------------------------
    // ClaimMirroredRegion — atomic. options:
    //   region:    { cells: [{x,y}, ...], pairId: string }
    //   axis:      'x' | 'y' | 'point'
    //   plane:     'terrain' | 'movement' | 'claim' | 'owner'
    //   value:     int
    //   priority:  int
    //   conceptId: string
    //
    // Returns:
    //   { ok: bool,
    //     conflict: 'terrain'|'movement'|'claim'|'owner'|'oob'|'badaxis'|null,
    //     mirrorMismatch: bool,
    //     cells: [{x, y, mirrorX, mirrorY, result, mirrorResult}, ...] }

    MapGen.Intent.ClaimMirroredRegion = function(map, options) {
        var report = {
            ok:             false,
            conflict:       null,
            mirrorMismatch: false,
            cells:          []
        };

        if(!map || !options || !options.region || !options.region.cells) {
            report.conflict = 'badrequest';
            return report;
        }
        if(options.axis !== 'x' && options.axis !== 'y' && options.axis !== 'point') {
            report.conflict = 'badaxis';
            return report;
        }

        var cells = options.region.cells;
        var axis = options.axis;
        var w = map.width;
        var h = map.height;

        var request = {
            plane:     options.plane,
            value:     options.value,
            priority:  options.priority,
            conceptId: options.conceptId
        };

        // Two-phase: collect snapshots first so we can roll back on any
        // failure. Phase 1 writes, phase 2 commits or rolls back.
        var snaps = [];
        var entries = [];

        var i;
        for(i = 0; i < cells.length; ++i) {
            var c = cells[i];
            if(!c || c.x < 0 || c.y < 0 || c.x >= w || c.y >= h) {
                report.conflict = 'oob';
                rollback(map, snaps);
                return report;
            }
            var m = MapGen.Intent.MirrorCell(c, axis, w, h);
            if(!m) {
                report.conflict = 'badaxis';
                rollback(map, snaps);
                return report;
            }
            if(m.x < 0 || m.y < 0 || m.x >= w || m.y >= h) {
                report.conflict = 'oob';
                rollback(map, snaps);
                return report;
            }

            // Snapshot both halves before writing either, in case the mirror
            // collapses to the same cell on the axis line (paranoia: write
            // once, snapshot once).
            snaps.push(snapshotCell(map, c.x, c.y));
            if(m.x !== c.x || m.y !== c.y) {
                snaps.push(snapshotCell(map, m.x, m.y));
            }

            var rA = MapGen.Intent.Map.ClaimCell(map, c.x, c.y, request);
            if(!rA.ok) {
                report.conflict = rA.conflict;
                report.cells.push({ x: c.x, y: c.y, mirrorX: m.x, mirrorY: m.y, result: rA, mirrorResult: null });
                rollback(map, snaps);
                return report;
            }

            var rB;
            if(m.x === c.x && m.y === c.y) {
                // On-axis cell: claim already applied above.
                rB = rA;
            } else {
                rB = MapGen.Intent.Map.ClaimCell(map, m.x, m.y, request);
                if(!rB.ok) {
                    report.conflict = rB.conflict;
                    report.mirrorMismatch = true;
                    report.cells.push({ x: c.x, y: c.y, mirrorX: m.x, mirrorY: m.y, result: rA, mirrorResult: rB });
                    rollback(map, snaps);
                    return report;
                }
            }

            entries.push({ x: c.x, y: c.y, mirrorX: m.x, mirrorY: m.y, result: rA, mirrorResult: rB });
        }

        report.ok = true;
        report.cells = entries;
        return report;
    };

    function rollback(map, snaps) {
        // Iterate in reverse so the most-recently-written cell is restored first
        // (defensive — restore is per-cell idempotent so order is not strictly
        // load-bearing, but consistent ordering is easier to reason about).
        for(var k = snaps.length - 1; k >= 0; --k) {
            restoreCell(map, snaps[k]);
        }
    }

    // -----------------------------------------------------------------------
    // DeclarePairedRegions — mutate two region records to point at each other.
    //
    // axis === 'x' | 'y' | 'point' : strict mirror; regionB.mirrorOf = regionA.id
    // axis === null                : paired but not mirror-symmetric
    //                                (e.g. asymmetric coop objectives that still
    //                                need to ship as a pair).

    MapGen.Intent.DeclarePairedRegions = function(map, regionA, regionB, axis) {
        if(!map || !regionA || !regionB) {
            return;
        }

        regionA.pair = { regionId: regionB.id, axis: axis };
        regionB.pair = { regionId: regionA.id, axis: axis };

        if(axis === 'x' || axis === 'y' || axis === 'point') {
            regionA.mirrorOf = null;       // canonical anchor of the pair
            regionB.mirrorOf = regionA.id; // the mirrored half
        } else {
            regionA.mirrorOf = null;
            regionB.mirrorOf = null;
        }

        if(!map.regions) {
            map.regions = [];
        }
        if(!containsRegion(map.regions, regionA)) {
            map.regions.push(regionA);
        }
        if(!containsRegion(map.regions, regionB)) {
            map.regions.push(regionB);
        }
    };

    function containsRegion(arr, region) {
        for(var i = 0; i < arr.length; ++i) {
            if(arr[i] === region) {
                return true;
            }
            if(region.id !== undefined && arr[i].id === region.id) {
                return true;
            }
        }
        return false;
    }

})();
