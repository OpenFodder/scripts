var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// Architecture v3 — gameplay skeleton reservation.
//
// Runs BEFORE water/cliffs/trees and reserves the corridor(s) connecting the
// map's anchors (campaign: start -> objective[s]; multiplayer: teamA <-> teamB)
// as ROUTE ownership on the owner grid. Macro water then carves AROUND this
// reserved spine instead of fragmenting the critical path — fixing the
// "drowned map / 8% playable" class of failure at the source rather than via
// downstream Repair carving.
//
// This is intentionally a COARSE straight-line corridor reservation: the
// precise wandering route is still drawn later by Connectivity, which claims
// its own (wider, exact) ROUTE cells. The skeleton only guarantees the macro
// terrain passes leave a connected land bridge between anchors.
MapGen.Layout.Skeleton = {

    CorridorHalfWidth: function(pContext) {
        var profile = pContext.Profile || {};
        // Reserve at least the main path width so the later route fits.
        var w = Number(profile.MainPathWidth);
        if(isNaN(w) || w < 1)
            w = 2;
        return Math.max(1, Math.floor(w));
    },

    // Collect the ordered anchor points that must stay connected over land.
    AnchorChain: function(pContext) {
        var a = pContext.Anchors || {};
        var chain = [];

        if(a.start) {
            chain.push(a.start);
            if(a.objective) chain.push(a.objective);
            else if(a.objectiveB) chain.push(a.objectiveB);
        }
        else if(a.teamA && a.teamB) {
            chain.push(a.teamA);
            chain.push(a.teamB);
        }

        return chain;
    },

    // Reserve a thick line between two points as ROUTE ownership. Uses a
    // deterministic Bresenham walk (no RNG) stamped with a square brush.
    ReserveCorridor: function(pContext, pA, pB, pHalfWidth) {
        var owner = pContext.Layers.owner;
        var cliffReserve = pContext.Layers.cliffReserve;
        var x0 = pA.x | 0, y0 = pA.y | 0;
        var x1 = pB.x | 0, y1 = pB.y | 0;
        var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
        var sx = x0 < x1 ? 1 : -1;
        var sy = y0 < y1 ? 1 : -1;
        var err = dx - dy;
        var guard = (dx + dy) * 2 + 8;

        while(guard-- > 0) {
            for(var bx = -pHalfWidth; bx <= pHalfWidth; ++bx) {
                for(var by = -pHalfWidth; by <= pHalfWidth; ++by) {
                    // Only reserve cells that are currently OPEN land. Claiming
                    // SEA/WATER cells would force ProtectReservedRoute to punch a
                    // dry strip through a water body, distorting the landmass and
                    // (on tight maps) fragmenting the area the structure/site
                    // planner needs — which starved campaign weapon-box sites and
                    // failed live objective validation. The corridor still keeps
                    // the land route clear; water bodies route around it naturally.
                    //
                    // Also skip cliffReserve cells (Option A,
                    // [[mapgen_cliff_option_a_staged]]). cliffReserve=0 on
                    // non-ice profiles (CliffReservation never wrote to it),
                    // so the guard is a byte-identical no-op for jungle/
                    // beach/desert.
                    var cx = x0 + bx, cy = y0 + by;
                    if(MapGen.Layers.Get(owner, cx, cy, 0) === MapGen.Layers.Owner.OPEN &&
                        !MapGen.Layers.Get(cliffReserve, cx, cy, 0))
                        MapGen.Layers.ClaimCell(owner, cx, cy, MapGen.Layers.Owner.ROUTE);
                }
            }
            if(x0 === x1 && y0 === y1)
                break;
            var e2 = 2 * err;
            if(e2 > -dy) { err -= dy; x0 += sx; }
            if(e2 < dx) { err += dx; y0 += sy; }
        }
    },

    Build: function(pContext) {
        if(!pContext.Layers || !pContext.Layers.owner)
            return pContext;

        if(MapGen.Layout.RouteArchetypes &&
            MapGen.Layout.RouteArchetypes.Build &&
            MapGen.Layout.RouteArchetypes.Build(pContext))
            return pContext;

        var chain = this.AnchorChain(pContext);
        if(chain.length < 2)
            return pContext;

        var halfWidth = this.CorridorHalfWidth(pContext);
        var reserved = 0;

        for(var i = 0; i + 1 < chain.length; ++i) {
            this.ReserveCorridor(pContext, chain[i], chain[i + 1], halfWidth);
            ++reserved;
        }

        MapGen.Context.AddLog(pContext, "Skeleton reserved " + reserved + " anchor corridor(s) before water");
        return pContext;
    }
};
