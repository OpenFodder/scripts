var MapGen = MapGen || {};
MapGen.Intent = MapGen.Intent || {};

// Macro terrain and transit share one intent map. The native pathfinder fits
// routes after terrain, leaving water intact except at bounded crossings.
(function(I) {
    I.RegionalTerrain = {
        PlanIceCliff: function(c) {
            var W = c.Width, H = c.Height;
            var hash = MapGen.Random.HashTile(c.Seed, 31, 67, 19501);
            if(W < 56 || H < 72 || (hash >>> 8) % 3 === 0) return null;
            var top = Math.max(22, Math.min(H - 26, Math.round(H * (hash % 2 ? 0.32 : 0.64))));
            var cross = Math.max(8, Math.min(W - 11, Math.round(W * (0.25 + (hash % 501) / 1000))));
            // Partition settlements around the reserved face, so forest
            // fields, anchors and building targets agree from the outset.
            return {top:top, crossing:{x:cross + 1,y:top + 2}, regions:[
                {x:2,y:2,w:W - 4,h:top - 6},
                {x:2,y:top + 8,w:W - 4,h:H - top - 10}]};
        },

        IceCliff: function(map, plan) {
            if(!plan) return null;
            var W = map.width, H = map.height, T = I.Terrain, M = I.Movement;
            var top = plan.top, cross = plan.crossing.x - 1;
            for(var x = 0; x < W; ++x) {
                var apron = Math.min(x, W - 1 - x) < 5 ? 7 : 3;
                for(var y = Math.max(0, top - apron); y <= Math.min(H - 1, top + 3 + apron); ++y) {
                    var at = y * W + x, face = y >= top && y <= top + 3;
                    var stair = face && x >= cross && x < cross + 3;
                    map.terrain[at] = face && !stair ? (y === top + 3 ? T.CLIFF_BODY : T.CLIFF_TOP) : T.LAND;
                    map.movement[at] = face && !stair ? M.BLOCKED : M.WALKABLE | M.KEEP_CLEAR;
                    if(stair) map.movement[at] |= M.CROSSING | M.ROUTE_PRIMARY;
                    map.owner[at] = face && !stair ? I.Owner.CLIFF : I.Owner.OPEN;
                }
            }
            map.regions.push({id:"regional.cliff", kind:"cliff", axis:"horizontal",
                topRowY:top, bandY:top + 3, stampHeight:4, waterClearance:3,
                terminalLandingWidth:5, terminalMaxClearance:7, cells:W * 4 - 12});
            map.regions.push({id:"regional.stairs", kind:"crossing", at:{x:cross,y:top + 2}, width:3, cells:12});
            return {top:top, crossing:{x:cross + 1,y:top + 2}};
        },

        IceRoutes: function(c, map) {
            var W = map.width, H = map.height, T = I.Terrain, M = I.Movement;
            var links = c.RegionalPlan.links, regions = c.RegionalPlan.regions;
            var finder = MapGen.Connectivity, costs = [], cells = 0, crossings = 0;
            function install(allowWater) {
                var flat = [], shore = new Uint8Array(W * H);
                // Build the bank clearance once per terrain change rather
                // than probing 25 neighbours for every cost-grid cell.
                for(var wy = 0; wy < H; ++wy) for(var wx = 0; wx < W; ++wx) {
                    if(map.terrain[wy * W + wx] !== T.WATER) continue;
                    for(var sy = Math.max(0, wy - 2); sy <= Math.min(H - 1, wy + 2); ++sy)
                        for(var sx = Math.max(0, wx - 2); sx <= Math.min(W - 1, wx + 2); ++sx)
                            shore[sy * W + sx] = 1;
                }
                for(var x = 0; x < W; ++x) {
                    costs[x] = [];
                    for(var y = 0; y < H; ++y) {
                        var at = y * W + x, terrain = map.terrain[at];
                        var cost = x < 2 || y < 2 || x >= W - 2 || y >= H - 2 ? Infinity : 1;
                        if(cost === Infinity || terrain === T.CLIFF_BODY || terrain === T.CLIFF_TOP) cost = Infinity;
                        else if(terrain === T.WATER) cost = allowWater ? 30 : Infinity;
                        else if(shore[at] && !(map.movement[at] & M.CROSSING))
                            cost = allowWater ? Math.max(cost, 4) : Infinity;
                        if(cost !== Infinity && cost === 1 && !(map.movement[at] & M.ROUTE_PRIMARY))
                            cost += (MapGen.Random.HashTile(c.Seed, Math.floor(x / 5), Math.floor(y / 5), 19511) % 101) / 100;
                        costs[x][y] = cost; flat[at] = cost;
                    }
                }
                finder.InstallNativeWalkCost(c, costs, flat);
            }
            install(false);
            for(var li = 0; li < links.length; ++li) {
                var link = links[li], from = regions[link.a].point, to = regions[link.b].point;
                var path = finder.FindPath(c, costs, from, to, "regional_terrain_route");
                var crossing = false, relaxed = false;
                if(!path) {
                    relaxed = true;
                    install(true);
                    path = finder.FindPath(c, costs, from, to, "regional_water_crossing");
                    if(!path) return null;
                    var run = 0, longest = 0;
                    for(var pi = 0; pi < path.length; ++pi) {
                        run = map.terrain[path[pi].y * W + path[pi].x] === T.WATER ? run + 1 : 0;
                        longest = Math.max(longest, run);
                    }
                    if(longest > 14) return null;
                    crossing = longest > 0;
                    if(crossing) ++crossings;
                }
                for(var p = 0; p < path.length; ++p) {
                    var point = path[p], wet = map.terrain[point.y * W + point.x] === T.WATER;
                    for(var oy = -1; oy <= 1; ++oy) for(var ox = -1; ox <= 1; ++ox) {
                        var px = point.x + ox, py = point.y + oy, index = py * W + px;
                        if(px < 0 || py < 0 || px >= W || py >= H) continue;
                        if(map.terrain[index] === T.CLIFF_BODY || map.terrain[index] === T.CLIFF_TOP) continue;
                        if(!crossing && map.terrain[index] === T.WATER) continue;
                        var bridge = wet || map.terrain[index] === T.WATER;
                        if(!(map.movement[index] & M.ROUTE_PRIMARY)) ++cells;
                        map.terrain[index] = T.LAND;
                        map.movement[index] = M.WALKABLE | M.KEEP_CLEAR | M.ROUTE_PRIMARY |
                            (map.movement[index] & (M.CROSSING | M.BRIDGE));
                        if(bridge) map.movement[index] |= M.CROSSING | M.BRIDGE;
                    }
                }
                // Restore dry costs after a crossing; subsequent links reuse
                // its narrow corridor instead of opening another wide gap.
                if(relaxed) install(false);
            }
            return {cells:cells, crossings:crossings};
        }
    };
})(MapGen.Intent);
