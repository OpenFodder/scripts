var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// Authoritative reservations survive terrain layers being rebuilt.
(function(R) {
    R.CLEAR = 1;
    R.FLOOR = 2;
    R.ROUTE = 4;
    R.BUFFER = 8;
    R.FLEX = 16;

    R.Ensure = function(c) {
        if(!c.GameplayReservations)
            c.GameplayReservations = {mask : new Uint8Array(c.Width * c.Height), cells : []};
        return c.GameplayReservations;
    };
    R.At = function(c, x, y) {
        return c && c.GameplayReservations && x >= 0 && y >= 0 && x < c.Width && y < c.Height
                   ? c.GameplayReservations.mask[y * c.Width + x]
                   : 0;
    };
    R.BlocksCover = function(c, x, y) { return !!(R.At(c, x, y) & (R.CLEAR | R.BUFFER)); };
    R.IsHardTerrain = function(c, x, y) {
        if(MapGen.Layers.Get(c.Layers.owner, x, y, 0) === MapGen.Layers.Owner.CLIFF)
            return true;
        var m = c.IntentMap, E = MapGen.Intent, i = y * c.Width + x;
        return !!(m && (m.owner[i] === E.Owner.CLIFF ||
            (m.claim[i] & E.Claim.STRUCT_WALL) || m.terrain[i] === E.Terrain.OUTCROP));
    };
    R.PreservesWater = function(c, x, y, flags) {
        if(MapGen.Repair.IsBridgeWaterApproach(c, x, y))
            return true;
        if(!(flags & R.ROUTE))
            return false;
        if(R.IsWater(c, x, y))
            return true;
        // Smoothing can temporarily clear the derived bank layer. Retain
        // authored shores when restoring route clearance to the final chars.
        var m = c.IntentMap, T = MapGen.Intent.Terrain;
        var terrain = m && m.terrain[y * c.Width + x];
        return terrain === T.WATER || terrain === T.RIVER ||
            terrain === T.RIVERBANK || terrain === T.COAST;
    };
    R.IsWater = function(c, x, y) {
        var l = c.Layers, g = MapGen.Layers.Get;
        return g(l.water, x, y, 0) || g(l.riverBank, x, y, 0) || g(l.forcedBank, x, y, 0) ||
               g(l.crossing, x, y, 0) || g(l.causeway, x, y, 0) || g(l.coast, x, y, 0);
    };
    R.Rect = function(c, rect, flags) {
        var r = R.Ensure(c);
        for(var y = Math.max(0, rect.minY); y <= Math.min(c.Height - 1, rect.maxY); ++y) {
            for(var x = Math.max(0, rect.minX); x <= Math.min(c.Width - 1, rect.maxX); ++x) {
                var i = y * c.Width + x;
                if((flags & R.ROUTE) && (r.mask[i] & R.FLOOR))
                    continue;
                if(!r.mask[i])
                    r.cells.push(i);
                r.mask[i] |= flags;
            }
        }
    };
    R.Paths = function(c) {
        var paths = c.Paths || [];
        for(var p = 0; p < paths.length; ++p) {
            var points = paths[p].points || [];
            var radius = Math.max(0, Math.min(2, Number(paths[p].radius) || 0));
            for(var j = 0; j < points.length; ++j) {
                var pt = points[j];
                R.Rect(c, {
                    minX : pt.x - radius - 1,
                    minY : pt.y - radius - 1,
                    maxX : pt.x + radius + 1,
                    maxY : pt.y + radius + 1
                },
                       R.FLEX);
                R.Rect(c,
                       {minX : pt.x - radius, minY : pt.y - radius, maxX : pt.x + radius, maxY : pt.y + radius},
                       R.CLEAR | R.ROUTE);
            }
        }
        // Open layouts reserve the coarse corridor before exact paths exist.
        if(!paths.length && c.Layers.owner) {
            for(var sy = 0; sy < c.Height; ++sy)
                for(var sx = 0; sx < c.Width; ++sx)
                    if(c.Layers.owner[sx][sy] === MapGen.Layers.Owner.ROUTE)
                        R.Rect(c, {minX : sx, minY : sy, maxX : sx, maxY : sy}, R.CLEAR | R.ROUTE);
        }
        var spawn = c.Anchors && (c.Anchors.start || c.Anchors.teamA);
        if(spawn)
            R.Rect(c, {minX : spawn.x - 3, minY : spawn.y - 3, maxX : spawn.x + 3, maxY : spawn.y + 3}, R.CLEAR);
        var other = c.Anchors && c.Anchors.teamB;
        if(other)
            R.Rect(c, {minX : other.x - 3, minY : other.y - 3, maxX : other.x + 3, maxY : other.y + 3}, R.CLEAR);
        if(c.IntentMap) {
            var m = c.IntentMap, E = MapGen.Intent;
            for(var i = 0; i < m.claim.length; ++i)
                if(m.claim[i] & E.Claim.SPAWN_SAFE) {
                    var x = i % c.Width, y = Math.floor(i / c.Width);
                    R.Rect(c, {minX : x - 2, minY : y - 2, maxX : x + 2, maxY : y + 2}, R.CLEAR);
                }
        }
    };
    R.Apply = function(c) {
        var r = c.GameplayReservations;
        if(!r)
            return 0;
        var l = c.Layers, get = MapGen.Layers.Get;
        var clear = [
            "blocked", "perimeterCover", "finalFieldCover", "finalRouteCover", "softFillCover",
            "structureContextCover"
        ];
        var dry = [ "water", "riverBank", "forcedBank", "lakeShore", "coast", "outcrop" ];
        for(var k = 0; k < r.cells.length; ++k) {
            var i = r.cells[k], flags = r.mask[i];
            if(!(flags & (R.CLEAR | R.BUFFER)))
                continue;
            var x = i % c.Width, y = Math.floor(i / c.Width);
            // Existing river crossings retain their water/bridge semantics.
            var crossing = R.PreservesWater(c, x, y, flags);
            if(R.IsHardTerrain(c, x, y))
                continue;
            for(var n = 0; n < clear.length; ++n)
                if(l[clear[n]])
                    l[clear[n]][x][y] = 0;
            if(!crossing)
                for(var d = 0; d < dry.length; ++d)
                    if(l[dry[d]])
                        l[dry[d]][x][y] = 0;
            if(l.keepClear)
                l.keepClear[x][y] = 1;
            if(flags & R.FLOOR && l.structureGround)
                l.structureGround[x][y] = 1;
        }
        return r.cells.length;
    };
    R.ApplyChars = function(c, chars) {
        var r = c.GameplayReservations;
        if(!r)
            return 0;
        var changed = 0, get = MapGen.Layers.Get;
        var ice = MapGen.Terrain.Smoothing.Ice;
        for(var k = 0; k < r.cells.length; ++k) {
            var i = r.cells[k], flags = r.mask[i];
            if(!(flags & (R.CLEAR | R.BUFFER)))
                continue;
            var x = i % c.Width, y = Math.floor(i / c.Width);
            if(R.PreservesWater(c, x, y, flags) || R.IsHardTerrain(c, x, y))
                continue;
            var value = chars[x][y];
            // Wet ice is walkable clearance, including spawn and buffer cells.
            // Only a building floor needs to replace its shoreline apron.
            if(!(flags & R.FLOOR) && value === ice.Chars.wet)
                continue;
            if(value !== ice.Chars.ground) {
                chars[x][y] = ice.Chars.ground;
                ++changed;
            }
        }
        return changed;
    };
    // Publish the plan before rendering; drift validation can then distinguish
    // deliberate structure walls from terrain that intrudes on walkable ground.
    R.AuthorIntent = function(c) {
        var r = c.GameplayReservations, m = c.IntentMap, E = MapGen.Intent;
        if(!r || !m)
            return;
        for(var k = 0; k < r.cells.length; ++k) {
            var i = r.cells[k], f = r.mask[i];
            if(!(f & (R.CLEAR | R.BUFFER)))
                continue;
            if(R.IsHardTerrain(c, i % c.Width, Math.floor(i / c.Width)) ||
               m.movement[i] & (E.Movement.CROSSING | E.Movement.BRIDGE) ||
               R.PreservesWater(c, i % c.Width, Math.floor(i / c.Width), f))
                continue;
            m.terrain[i] = E.Terrain.LAND;
            m.movement[i] = (m.movement[i] & ~E.Movement.BLOCKED) | E.Movement.WALKABLE | E.Movement.KEEP_CLEAR;
            m.claim[i] |= E.Claim.RESERVED;
            if(f & R.FLOOR) {
                m.owner[i] = E.Owner.STRUCTURE;
                m.claim[i] |= E.Claim.STRUCT_FLOOR;
            }
            if(f & R.ROUTE)
                m.movement[i] |= E.Movement.ROUTE_SECONDARY;
        }
    };
    R.Summary = function(c) {
        var r = c.GameplayReservations, counts = {clear : 0, floor : 0, route : 0, buffer : 0, flexible : 0};
        if(!r)
            return counts;
        for(var i = 0; i < r.cells.length; ++i) {
            var f = r.mask[r.cells[i]];
            if(f & R.CLEAR)
                ++counts.clear;
            if(f & R.FLOOR)
                ++counts.floor;
            if(f & R.ROUTE)
                ++counts.route;
            if(f & R.BUFFER)
                ++counts.buffer;
            if(f & R.FLEX)
                ++counts.flexible;
        }
        return counts;
    };
})(MapGen.Layout.Reservations = MapGen.Layout.Reservations || {});
