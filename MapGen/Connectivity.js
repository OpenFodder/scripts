var MapGen = MapGen || {};

// Replaces the old cosmetic Bezier path stamper. We compute a deterministic
// A* corridor between every required connectivity node, carve through any
// hard-blocked land (never water — that needs an explicit crossing), then
// stamp a thin corridor into Layers.path so downstream walkability checks,
// soft-hazard guards and grass-variant smoothing keep working unchanged.
//
// Layers.path semantics shift from "fat decorative trail (drawn by Bezier
// disc-stamp)" to "1-cell-wide guaranteed corridor". The Render.js path
// classification has been removed, so the layer is no longer a tile, only a
// routing/placement-bias mask.
MapGen.Connectivity = {

    // Cost weights. Infinity = impassable.
    Costs: {
        Free:        1,        // grass / unmarked ground
        KeepClear:   1,        // already-reserved corridor or clearing
        Existing:    1,        // already on Layers.path (re-use)
        TerrainEdge: 2,        // crossing a biome edge is fine but slightly costly
        Crossing:    1,        // bridge tile — preferred when the route needs to cross water
        RiverBank:   6,        // soft-hazard, prefer to skirt
        Coast:       4,        // beach edge
        Outcrop:     8,        // rocky cluster, expensive
        Blocked:     12,       // tree / cliff cell, carveable
        Occupied:    Infinity, // structure footprint, never route through
        Water:       Infinity  // water without crossing — bridges must be explicit
    },

    IsMazeRoutingWall: function(pContext, pX, pY) {
        var profile = (pContext && pContext.Profile) || {};
        var layers = pContext && pContext.Layers;
        if(profile.JungleMazeRouteTopology !== true ||
            !pContext.RouteCorridor || !pContext.RouteCorridor.mazeNetwork ||
            !layers)
            return false;

        // The route archetype reserves the complement of its perfect-maze
        // graph as TREE before Connectivity runs.  Those cells are topology,
        // not ordinary forest that A* may trade a short carve against a long
        // walk around the maze.  Explicit route cells always win so the
        // planned corridors and their anchor connectors remain walkable.
        if(MapGen.Layers.Get(layers.path, pX, pY, 0))
            return false;

        // Deliberate later openings (structure aprons/access cells) clear the
        // blocked bit but retain TREE ownership for precedence bookkeeping.
        // Treat those cleared cells as doors into the maze, not as walls.
        return layers.owner && MapGen.Layers.Get(layers.blocked, pX, pY, 0) &&
            MapGen.Layers.Get(layers.owner, pX, pY, MapGen.Layers.Owner.NONE) ===
                MapGen.Layers.Owner.TREE;
    },

    PathStats: function(pContext) {
        if(!pContext || !pContext.ProfileTimings)
            return null;

        if(!pContext.PathStats) {
            pContext.PathStats = {
                walkCostBuilds: 0,
                walkCostMs: 0,
                walkCostCells: 0,
                walkCostPartialBuilds: 0,
                pathCalls: 0,
                pathSuccess: 0,
                pathFailure: 0,
                pathMs: 0,
                pathExpanded: 0,
                pathPushed: 0,
                pathMaxOpen: 0,
                pathCells: 0,
                pathByRole: {},
                placement: {
                    calls: 0,
                    nodes: 0,
                    lastNodes: 0,
                    routed: 0,
                    failed: 0,
                    skipped: 0,
                    skippedByGroup: {},
                    attemptedByGroup: {},
                    routedByGroup: {},
                    failedByGroup: {},
                    routeLimits: {}
                }
            };
        }

        return pContext.PathStats;
    },

    AddGroupCount: function(pObject, pGroup, pAmount) {
        var group = pGroup || "unknown";
        pObject[group] = (pObject[group] || 0) + (pAmount || 1);
    },

    RoleStats: function(pStats, pRole) {
        var role = pRole || "direct";
        var roles = pStats.pathByRole;
        if(!roles[role]) {
            roles[role] = {
                calls: 0,
                success: 0,
                failure: 0,
                ms: 0,
                expanded: 0,
                pushed: 0,
                maxOpen: 0,
                pathCells: 0
            };
        }
        return roles[role];
    },

    RecordWalkCostStats: function(pContext, pStartMs) {
        var stats = this.PathStats(pContext);
        if(!stats)
            return;

        ++stats.walkCostBuilds;
        stats.walkCostMs += (new Date()).getTime() - pStartMs;
    },

    RecordPathStats: function(pContext, pSucceeded, pPathCells, pExpanded, pPushed, pMaxOpen, pStartMs) {
        var stats = this.PathStats(pContext);
        if(!stats)
            return;

        var role = pContext._connectivityPathRole || "direct";
        var ms = (new Date()).getTime() - pStartMs;
        var roleStats = this.RoleStats(stats, role);

        ++stats.pathCalls;
        stats.pathMs += ms;
        stats.pathExpanded += pExpanded || 0;
        stats.pathPushed += pPushed || 0;
        stats.pathCells += pPathCells || 0;
        if((pMaxOpen || 0) > stats.pathMaxOpen)
            stats.pathMaxOpen = pMaxOpen || 0;

        ++roleStats.calls;
        roleStats.ms += ms;
        roleStats.expanded += pExpanded || 0;
        roleStats.pushed += pPushed || 0;
        roleStats.pathCells += pPathCells || 0;
        if((pMaxOpen || 0) > roleStats.maxOpen)
            roleStats.maxOpen = pMaxOpen || 0;

        if(pSucceeded) {
            ++stats.pathSuccess;
            ++roleStats.success;
        } else {
            ++stats.pathFailure;
            ++roleStats.failure;
        }
    },

    NativeMap: function(pContext) {
        var map = (pContext && pContext.Map) || (typeof Map !== "undefined" ? Map : null);
        if(!map)
            throw "Native pathing map is unavailable";
        return map;
    },

    PointArrayFromNativeResult: function(pResult) {
        var pathLength = pResult && pResult.length >= 5 ? Number(pResult[4]) || 0 : 0;
        var points = [];

        if(!pResult || !pResult.length || !pResult[0] || pathLength <= 0)
            return null;

        for(var index = 0; index < pathLength; ++index) {
            var base = 5 + (index * 2);
            points.push({ x: pResult[base], y: pResult[base + 1] });
        }

        return points;
    },

    FindPath: function(pContext, pWalkCost, pStart, pEnd, pRole) {
        var previous = pContext ? pContext._connectivityPathRole : null;
        if(pContext)
            pContext._connectivityPathRole = pRole || "route";
        try {
            var stats = this.PathStats(pContext);
            var statsStart = stats ? (new Date()).getTime() : 0;

            if(!pWalkCost || !pWalkCost._nativeMapGenPath)
                throw "Native path search called without an installed walk-cost grid";

            if(!pStart || !pEnd) {
                if(stats) this.RecordPathStats(pContext, false, 0, 0, 0, 0, statsStart);
                return null;
            }

            var map = pWalkCost._nativeMap || this.NativeMap(pContext);
            var result = map.MapGenAstar(pStart.x, pStart.y, pEnd.x, pEnd.y);
            if(!result || result.length < 5)
                throw "Native A* returned an invalid result";

            if(stats) {
                this.RecordPathStats(
                    pContext,
                    !!result[0],
                    Number(result[4]) || 0,
                    Number(result[1]) || 0,
                    Number(result[2]) || 0,
                    Number(result[3]) || 0,
                    statsStart
                );
            }

            return this.PointArrayFromNativeResult(result);
        } finally {
            if(pContext)
                pContext._connectivityPathRole = previous;
        }
    },

    Clamp: function(pValue, pMin, pMax) {
        if(isNaN(pValue))
            return pMin;
        if(pValue < pMin)
            return pMin;
        if(pValue > pMax)
            return pMax;
        return pValue;
    },

    HashUnit: function(pContext, pX, pY, pSalt) {
        return MapGen.Random.HashTile(pContext.Seed, pX, pY, pSalt || 0) / 4294967295;
    },

    RangeValue: function(pContext, pName, pDefaultMin, pDefaultMax, pInteger, pX, pY, pSalt) {
        var value = (pContext.Profile || {})[pName];
        var min = pDefaultMin;
        var max = pDefaultMax;

        if(value instanceof Array && value.length >= 2) {
            min = Number(value[0]);
            max = Number(value[1]);
        } else if(value !== undefined && value !== null) {
            min = Number(value);
            max = min;
        }

        if(isNaN(min))
            min = pDefaultMin;
        if(isNaN(max) || max < min)
            max = min;

        var result = min + ((max - min) * this.HashUnit(pContext, pX || 0, pY || 0, pSalt || 0));
        return pInteger ? Math.round(result) : result;
    },

    RouteWanderCost: function(pContext) {
        var value = this.RangeValue(pContext, "RouteWanderCost", 0, 0, false, 0, 0, 2201);
        return this.Clamp(value, 0, 6);
    },

    RouteWanderScale: function(pContext) {
        var value = this.RangeValue(pContext, "RouteWanderScale", 7, 7, true, 0, 0, 2203);
        return Math.max(3, Math.min(18, value));
    },

    RouteWanderPenalty: function(pContext, pX, pY, pCost, pScale) {
        if(pCost <= 0)
            return 0;

        var gx = Math.floor(pX / pScale);
        var gy = Math.floor(pY / pScale);
        var coarse = this.HashUnit(pContext, gx, gy, 2211);
        var medium = this.HashUnit(pContext, Math.floor(pX / Math.max(3, Math.floor(pScale / 2))), Math.floor(pY / Math.max(3, Math.floor(pScale / 2))), 2213);
        var fine = this.HashUnit(pContext, pX, pY, 2217);

        return ((coarse * 0.60) + (medium * 0.30) + (fine * 0.10)) * pCost;
    },

    RouteWanderPenaltyGrid: function(pContext, pCost, pScale) {
        if(pCost <= 0)
            return null;

        var width = pContext.Width;
        var height = pContext.Height;
        var scale = Math.max(3, Math.floor(pScale || 3));
        var mediumScale = Math.max(3, Math.floor(scale / 2));
        var key = [
            pContext.Seed || 0,
            width,
            height,
            pCost,
            scale
        ].join("|");
        var cache = pContext._routeWanderPenaltyGrid;
        if(cache && cache.key === key)
            return cache.grid;

        var grid = [];
        var invMax = 1 / 4294967295;
        for(var x = 0; x < width; ++x) {
            var col = [];
            grid[x] = col;
            var gx = Math.floor(x / scale);
            var mx = Math.floor(x / mediumScale);
            for(var y = 0; y < height; ++y) {
                var coarse = MapGen.Random.HashTile(pContext.Seed, gx, Math.floor(y / scale), 2211) * invMax;
                var medium = MapGen.Random.HashTile(pContext.Seed, mx, Math.floor(y / mediumScale), 2213) * invMax;
                var fine = MapGen.Random.HashTile(pContext.Seed, x, y, 2217) * invMax;
                col[y] = ((coarse * 0.60) + (medium * 0.30) + (fine * 0.10)) * pCost;
            }
        }

        pContext._routeWanderPenaltyGrid = {
            key: key,
            grid: grid
        };
        return grid;
    },

    RouteBorderInset: function(pContext) {
        var value = Number((pContext.Profile || {}).RouteBorderInset);
        if(isNaN(value))
            value = 3;

        var minSide = Math.min(pContext.Width || 0, pContext.Height || 0);
        var maxInset = Math.max(1, Math.floor((minSide - 3) / 2));
        return Math.max(0, Math.min(maxInset, Math.floor(value)));
    },

    RouteBorderHardInset: function(pContext) {
        var value = Number((pContext.Profile || {}).RouteBorderHardInset);
        if(isNaN(value))
            value = 0;

        var minSide = Math.min(pContext.Width || 0, pContext.Height || 0);
        var maxInset = Math.max(0, Math.floor((minSide - 3) / 2));
        return Math.max(0, Math.min(maxInset, Math.floor(value)));
    },

    RouteBorderPenalty: function(pContext) {
        var value = Number((pContext.Profile || {}).RouteBorderPenalty);
        if(isNaN(value))
            value = 12;

        return Math.max(0, Math.min(64, value));
    },

    RouteArchetypeOutsidePenalty: function(pContext) {
        var value = Number((pContext.Profile || {}).RouteArchetypeOutsideRoutePenalty);
        if(isNaN(value))
            value = 0;

        return Math.max(0, Math.min(32, value));
    },

    RouteBorderPenaltyAt: function(pContext, pX, pY, pInset, pPenalty) {
        if(pInset <= 0 || pPenalty <= 0)
            return 0;

        var left = pX;
        var top = pY;
        var right = pContext.Width - 1 - pX;
        var bottom = pContext.Height - 1 - pY;
        var distance = Math.min(Math.min(left, right), Math.min(top, bottom));

        if(distance >= pInset)
            return 0;

        return (pInset - distance) * pPenalty;
    },

    InstallNativeWalkCost: function(pContext, pWalkCost, pNativeCosts) {
        if(!pNativeCosts)
            return;

        var map = this.NativeMap(pContext);
        map.SetMapGenPathCostGrid(pContext.Width, pContext.Height, pNativeCosts);
        pWalkCost._nativeMapGenPath = true;
        pWalkCost._nativeMap = map;
        pWalkCost._nativeWidth = pContext.Width;
        pWalkCost._nativeHeight = pContext.Height;
    },

    SetWalkCostCell: function(pContext, pWalkCost, pX, pY, pCost) {
        if(!pWalkCost || pX < 0 || pY < 0 || pX >= pWalkCost.length || !pWalkCost[pX] || pY >= pWalkCost[pX].length)
            return false;

        pWalkCost[pX][pY] = pCost;

        if(pWalkCost._nativeMapGenPath && pWalkCost._nativeMap && pWalkCost._nativeMap.SetMapGenPathCost)
            pWalkCost._nativeMap.SetMapGenPathCost(pX, pY, pCost);

        return true;
    },

    WalkCostAt: function(pContext, pX, pY) {
        var layers = pContext.Layers;
        var costs = this.Costs;
        var supportsCrossings = MapGen.Repair && MapGen.Repair.SupportsCrossings ?
            MapGen.Repair.SupportsCrossings(pContext) : true;
        var wanderCost = this.RouteWanderCost(pContext);
        var wanderScale = this.RouteWanderScale(pContext);
        var borderInset = this.RouteBorderInset(pContext);
        var borderHardInset = this.RouteBorderHardInset(pContext);
        var borderPenalty = this.RouteBorderPenalty(pContext);
        var routeCorridor = pContext.RouteCorridor || null;
        var outsideRoutePenalty = this.RouteArchetypeOutsidePenalty(pContext);
        var wanderPenaltyGrid = this.RouteWanderPenaltyGrid(pContext, wanderCost, wanderScale);
        var routedCell = false;
        var archetypeCell = false;
        var cost = costs.Free;

        if(pX < 0 || pY < 0 || pX >= pContext.Width || pY >= pContext.Height)
            return costs.Water;

        if(routeCorridor) {
            archetypeCell =
                (routeCorridor.core && MapGen.Layers.Get(routeCorridor.core, pX, pY, 0)) ||
                (routeCorridor.center && MapGen.Layers.Get(routeCorridor.center, pX, pY, 0)) ||
                (routeCorridor.pocket && MapGen.Layers.Get(routeCorridor.pocket, pX, pY, 0));
        }

        // Cliff body cells set BOTH blocked=1 AND keepClear=1, and the
        // keepClear branch below fires before the blocked branch — so a
        // cliff body cell would register as cost.KeepClear=1 (a corridor!)
        // instead of cost.Blocked=12. With Plateau hoisted into Layout.Build
        // (Slice 1B), Connectivity now sees committed cliff bodies; this
        // guard makes A* treat them as expensive carveable terrain so the
        // pathfinder routes around cliffs the way it routes around trees.
        // See [[mapgen_cliff_edge_to_edge]].
        if(layers.owner &&
            MapGen.Layers.Get(layers.owner, pX, pY, 0) === MapGen.Layers.Owner.CLIFF) {
            cost = costs.Blocked;
        }
        else if((MapGen.Layout.Reservations.At(pContext,pX,pY) & MapGen.Layout.Reservations.FLOOR) ||
            MapGen.Layers.Get(layers.occupied, pX, pY, 0))
            cost = costs.Occupied;
        else if(MapGen.Layers.Get(layers.water, pX, pY, 0)) {
            if(MapGen.Layers.Get(layers.crossing, pX, pY, 0) && supportsCrossings) {
                cost = costs.Crossing;
                routedCell = true;
            }
            else
                cost = costs.Water;
        }
        else if(MapGen.Layers.Get(layers.path, pX, pY, 0)) {
            cost = costs.Existing;
            routedCell = true;
        }
        else if(this.IsMazeRoutingWall(pContext, pX, pY))
            cost = costs.Water;
        else if(MapGen.Layers.Get(layers.keepClear, pX, pY, 0)) {
            cost = costs.KeepClear;
            routedCell = !routeCorridor;
        }
        else if(MapGen.Layers.Get(layers.crossing, pX, pY, 0)) {
            cost = costs.Crossing;
            routedCell = true;
        }
        else if(MapGen.Layers.Get(layers.blocked, pX, pY, 0))
            cost = costs.Blocked;
        else if(MapGen.Layers.Get(layers.outcrop, pX, pY, 0))
            cost = costs.Outcrop;
        else if(MapGen.Layers.Get(layers.riverBank, pX, pY, 0))
            cost = costs.RiverBank;
        else if(MapGen.Layers.Get(layers.coast, pX, pY, 0))
            cost = costs.Coast;
        else if(MapGen.Layers.Get(layers.terrainEdge, pX, pY, 0))
            cost = costs.TerrainEdge;

        if(archetypeCell && cost !== Infinity) {
            cost = Math.min(cost, costs.Existing);
            routedCell = true;
        }
        if(cost !== Infinity && borderHardInset > 0 &&
            this.RouteBorderPenaltyAt(pContext, pX, pY, borderHardInset, 1) > 0)
            cost = costs.Water;
        if(outsideRoutePenalty > 0 && routeCorridor && cost !== Infinity && !routedCell)
            cost += outsideRoutePenalty;
        if(wanderCost > 0 && cost !== Infinity && !routedCell)
            cost += wanderPenaltyGrid ? wanderPenaltyGrid[pX][pY] :
                this.RouteWanderPenalty(pContext, pX, pY, wanderCost, wanderScale);
        if(cost !== Infinity)
            cost += this.RouteBorderPenaltyAt(pContext, pX, pY, borderInset, borderPenalty);

        return cost;
    },

    // A corridor stamp only mutates cells within its points/radius. Other
    // terrain writers must keep using a full rebuild without these arguments.
    BuildWalkCost: function(pContext, pPrevious, pCorridor) {
        var width = pContext.Width;
        var height = pContext.Height;
        var layers = pContext.Layers;
        var costs = this.Costs;
        var stats = this.PathStats(pContext);
        var statsStart = stats ? (new Date()).getTime() : 0;
        var partial = !!(pPrevious && pCorridor);
        var walkCost = partial ? pPrevious : MapGen.Layers.Create(width, height, costs.Free);
        var nativeCosts = partial ? null : [];
        var spans = partial ? this.CorridorCostSpans(pContext, pCorridor) : null;
        var visited = 0;
        var supportsCrossings = MapGen.Repair && MapGen.Repair.SupportsCrossings ?
            MapGen.Repair.SupportsCrossings(pContext) : true;
        var wanderCost = this.RouteWanderCost(pContext);
        var wanderScale = this.RouteWanderScale(pContext);
        var borderInset = this.RouteBorderInset(pContext);
        var borderHardInset = this.RouteBorderHardInset(pContext);
        var borderPenalty = this.RouteBorderPenalty(pContext);
        var routeCorridor = pContext.RouteCorridor || null;
        var outsideRoutePenalty = this.RouteArchetypeOutsidePenalty(pContext);
        var wanderPenaltyGrid = this.RouteWanderPenaltyGrid(pContext, wanderCost, wanderScale);

        // All coordinates below are in bounds. Resolve optional columns once
        // per x instead of repeating generic layer lookups for every cell.
        var mazeWalls = (pContext.Profile || {}).JungleMazeRouteTopology === true &&
            pContext.RouteCorridor && pContext.RouteCorridor.mazeNetwork;
        var reservations = pContext.GameplayReservations;
        for(var x = 0; x < width; ++x) {
            if(spans && !spans[x]) continue;
            var blocked = layers.blocked && layers.blocked[x],
                coast = layers.coast && layers.coast[x],
                crossing = layers.crossing && layers.crossing[x],
                keepClear = layers.keepClear && layers.keepClear[x],
                occupied = layers.occupied && layers.occupied[x],
                outcrop = layers.outcrop && layers.outcrop[x],
                owner = layers.owner && layers.owner[x],
                path = layers.path && layers.path[x],
                riverBank = layers.riverBank && layers.riverBank[x],
                terrainEdge = layers.terrainEdge && layers.terrainEdge[x],
                water = layers.water && layers.water[x];
            var minY = spans ? spans[x].min : 0;
            var maxY = spans ? spans[x].max : height - 1;
            for(var y = minY; y <= maxY; ++y) {
                ++visited;
                var cost = costs.Free;
                var routedCell = false;
                var archetypeCell = false;

                if(routeCorridor) {
                    archetypeCell =
                        (routeCorridor.core && MapGen.Layers.Get(routeCorridor.core, x, y, 0)) ||
                        (routeCorridor.center && MapGen.Layers.Get(routeCorridor.center, x, y, 0)) ||
                        (routeCorridor.pocket && MapGen.Layers.Get(routeCorridor.pocket, x, y, 0));
                }

                // Cliff body guard — see WalkCostAt for full rationale.
                // Cliff cells set blocked=1 + keepClear=1; without this guard
                // the keepClear branch below makes A* treat cliffs as a free
                // corridor (cost 1) instead of expensive carveable terrain.
                if(owner && owner[y] === MapGen.Layers.Owner.CLIFF) {
                    cost = costs.Blocked;
                }
                else if((reservations && (reservations.mask[y * width + x] & MapGen.Layout.Reservations.FLOOR)) ||
                    (occupied && occupied[y]))
                    cost = costs.Occupied;
                else if(water && water[y]) {
                    if((crossing && crossing[y]) && supportsCrossings)
                    {
                        cost = costs.Crossing;
                        routedCell = true;
                    }
                    else
                        cost = costs.Water;
                }
                else if(path && path[y]) {
                    cost = costs.Existing;
                    routedCell = true;
                }
                else if(mazeWalls && blocked && blocked[y] && owner && owner[y] === MapGen.Layers.Owner.TREE)
                    cost = costs.Water;
                else if(keepClear && keepClear[y]) {
                    cost = costs.KeepClear;
                    routedCell = !routeCorridor;
                }
                else if(crossing && crossing[y]) {
                    cost = costs.Crossing;
                    routedCell = true;
                }
                else if(blocked && blocked[y])
                    cost = costs.Blocked;
                else if(outcrop && outcrop[y])
                    cost = costs.Outcrop;
                else if(riverBank && riverBank[y])
                    cost = costs.RiverBank;
                else if(coast && coast[y])
                    cost = costs.Coast;
                else if(terrainEdge && terrainEdge[y])
                    cost = costs.TerrainEdge;

                if(archetypeCell && cost !== Infinity) {
                    cost = Math.min(cost, costs.Existing);
                    routedCell = true;
                }
                if(cost !== Infinity && borderHardInset > 0 &&
                    this.RouteBorderPenaltyAt(pContext, x, y, borderHardInset, 1) > 0)
                    cost = costs.Water;
                if(outsideRoutePenalty > 0 && routeCorridor && cost !== Infinity && !routedCell)
                    cost += outsideRoutePenalty;
                if(wanderCost > 0 && cost !== Infinity && !routedCell)
                    cost += wanderPenaltyGrid ? wanderPenaltyGrid[x][y] :
                        this.RouteWanderPenalty(pContext, x, y, wanderCost, wanderScale);
                if(cost !== Infinity)
                    cost += this.RouteBorderPenaltyAt(pContext, x, y, borderInset, borderPenalty);

                if(partial) {
                    if(cost !== walkCost[x][y])
                        this.SetWalkCostCell(pContext, walkCost, x, y, cost);
                } else {
                    walkCost[x][y] = cost;
                    nativeCosts[(y * width) + x] = cost;
                }
            }
        }

        this.InstallNativeWalkCost(pContext, walkCost, nativeCosts);
        if(stats) {
            stats.walkCostCells += visited;
            if(partial) ++stats.walkCostPartialBuilds;
            this.RecordWalkCostStats(pContext, statsStart);
        }
        return walkCost;
    },

    CorridorCostSpans: function(pContext, pCorridor) {
        var spans = [], radius = pCorridor.radius;
        for(var index = 0; index < pCorridor.points.length; ++index) {
            var point = pCorridor.points[index];
            var minY = Math.max(0, point.y - radius);
            var maxY = Math.min(pContext.Height - 1, point.y + radius);
            for(var x = Math.max(0, point.x - radius);
                x <= Math.min(pContext.Width - 1, point.x + radius); ++x) {
                var span = spans[x];
                if(span) {
                    span.min = Math.min(span.min, minY);
                    span.max = Math.max(span.max, maxY);
                } else spans[x] = {min: minY, max: maxY};
            }
        }
        return spans;
    },

    // Bresenham line carving — used as a fallback when A* finds no route at
    // all (typical when player_start was placed on an isolated island that
    // only opens up via a future structure footprint). Clears blocked/coast/
    // riverBank along the line so a re-run of A* succeeds. Never clears water
    // (rivers must be bridged via Layers.crossing, which Features/Bridges
    // populates separately) and never clears occupied (would corrupt a
    // structure's footprint).
    Carve: function(pContext, pStart, pEnd) {
        var x0 = pStart.x, y0 = pStart.y;
        var x1 = pEnd.x,   y1 = pEnd.y;
        var dx = x1 - x0 < 0 ? -(x1 - x0) : (x1 - x0);
        var dy = y1 - y0 < 0 ? -(y1 - y0) : (y1 - y0);
        var sx = x0 < x1 ? 1 : -1;
        var sy = y0 < y1 ? 1 : -1;
        var err = dx - dy;
        var layers = pContext.Layers;

        while(true) {
            if(x0 >= 0 && y0 >= 0 && x0 < pContext.Width && y0 < pContext.Height) {
                // Cliff body guard ([[mapgen_cliff_edge_to_edge]] Slice 1C).
                // Carve unconditionally clears blocked/coast/riverBank, which
                // would silently demolish a cliff body cell that lies on the
                // Bresenham line. With Plateau hoisted before Connectivity,
                // cliffs CAN sit on a fallback-carve path; treat them as
                // immovable terrain — the next BuildWalkCost re-grade will
                // route A* around them.
                var cliffCell = layers.owner &&
                    MapGen.Layers.Get(layers.owner, x0, y0, 0) === MapGen.Layers.Owner.CLIFF;
                var mazeWall = this.IsMazeRoutingWall(pContext, x0, y0);
                if(!cliffCell && !mazeWall &&
                    !MapGen.Layers.Get(layers.occupied, x0, y0, 0) &&
                    !MapGen.Layers.Get(layers.water, x0, y0, 0)) {
                    MapGen.Layers.Set(layers.blocked, x0, y0, 0);
                    MapGen.Layers.Set(layers.coast, x0, y0, 0);
                    MapGen.Layers.Set(layers.riverBank, x0, y0, 0);
                }
            }

            if(x0 === x1 && y0 === y1) break;
            var e2 = 2 * err;
            if(e2 > -dy) { err -= dy; x0 += sx; }
            if(e2 <  dx) { err += dx; y0 += sy; }
        }
    },

    CorridorRadius: function(pContext, pRole) {
        var profile = pContext.Profile || {};
        var role = pRole || "primary";
        var radius = profile.SideCorridorRadius;

        if(role === "primary" ||
            role === "secondary" ||
            role === "repair_critical" ||
            role.indexOf("placement_") === 0)
            radius = profile.MainCorridorRadius;

        if(radius === undefined || radius === null)
            radius = profile.CorridorRadius;
        if(radius === undefined || radius === null)
            return 0;

        radius = Number(radius);
        if(isNaN(radius) || radius < 0)
            radius = 0;

        return Math.floor(radius);
    },

    CorridorCanStamp: function(pContext, pX, pY, pSupportsCrossings) {
        var layers = pContext.Layers;
        if(MapGen.Layout.Reservations.At(pContext,pX,pY) & MapGen.Layout.Reservations.FLOOR)
            return false;

        if(!MapGen.Layers.InBounds(layers.path, pX, pY))
            return false;
        if(MapGen.Layers.Get(layers.occupied, pX, pY, 0))
            return false;
        // Cliff body guard ([[mapgen_cliff_edge_to_edge]] Slice 1C). With
        // Plateau hoisted before Connectivity, the corridor planner can
        // attempt to stamp a route through a cliff body. Reject — A*'s
        // walk-cost guard above (CLIFF → costs.Blocked) makes the planner
        // route around cliffs in the first place; this is the write-side
        // backstop for any stamp that slips past the cost grid.
        if(layers.owner &&
            MapGen.Layers.Get(layers.owner, pX, pY, 0) === MapGen.Layers.Owner.CLIFF)
            return false;
        if(this.IsMazeRoutingWall(pContext, pX, pY))
            return false;
        if(MapGen.Layers.Get(layers.water, pX, pY, 0) &&
            !(pSupportsCrossings && MapGen.Layers.Get(layers.crossing, pX, pY, 0)))
            return false;

        return true;
    },

    StampCorridorCell: function(pContext, pX, pY, pRadius, pSupportsCrossings) {
        var layers = pContext.Layers;
        var profile = pContext.Profile || {};
        var radius = Math.max(0, Math.floor(pRadius || 0));
        var radiusSq = radius * radius;
        var stamped = 0;
        var fullPath = profile.PathLayerCoversCorridor === true;
        var fullKeepClear = profile.KeepClearCoversCorridor === true;
        var fullCarve = profile.CorridorClearsFullRadius === true;

        for(var dx = -radius; dx <= radius; ++dx) {
            for(var dy = -radius; dy <= radius; ++dy) {
                if((dx * dx) + (dy * dy) > radiusSq)
                    continue;

                var x = pX + dx;
                var y = pY + dy;
                if(!this.CorridorCanStamp(pContext, x, y, pSupportsCrossings))
                    continue;

                var center = dx === 0 && dy === 0;
                if(center || fullPath) {
                    if(!MapGen.Layers.Get(layers.path, x, y, 0))
                        ++stamped;
                    MapGen.Layers.Set(layers.path, x, y, 1);
                    // Architecture v3: the route corridor claims ROUTE ownership
                    // so later terrain fill (trees/cliffs) cannot paint over it.
                    MapGen.Layers.ClaimCell(layers.owner, x, y, MapGen.Layers.Owner.ROUTE);
                }
                if(center || fullKeepClear)
                    MapGen.Layers.Set(layers.keepClear, x, y, 1);
                if(center || fullCarve) {
                    MapGen.Layers.Set(layers.blocked, x, y, 0);
                    MapGen.Layers.Set(layers.coast, x, y, 0);
                    MapGen.Layers.Set(layers.riverBank, x, y, 0);
                    MapGen.Layers.Set(layers.forcedBank, x, y, 0);
                }
            }
        }

        return stamped;
    },

    CorridorBridgePoint: function(pContext, pPrev, pNext, pSupportsCrossings) {
        if(!pPrev || !pNext)
            return null;

        var dx = pNext.x - pPrev.x;
        var dy = pNext.y - pPrev.y;
        if(dx === 0 || dy === 0)
            return null;
        if((dx < -1 || dx > 1) || (dy < -1 || dy > 1))
            return null;

        var candidates = [
            { x: pPrev.x, y: pNext.y },
            { x: pNext.x, y: pPrev.y }
        ];

        for(var index = 0; index < candidates.length; ++index) {
            if(this.CorridorCanStamp(pContext, candidates[index].x, candidates[index].y, pSupportsCrossings))
                return candidates[index];
        }

        return null;
    },

    StampCorridor: function(pContext, pPath, pRole) {
        if(!pPath || !pPath.length) return null;
        var supportsCrossings = MapGen.Repair && MapGen.Repair.SupportsCrossings ?
            MapGen.Repair.SupportsCrossings(pContext) : true;
        var radius = this.CorridorRadius(pContext, pRole);
        var points = [];

        for(var index = 0; index < pPath.length; ++index) {
            var p = pPath[index];
            var prev = index > 0 ? pPath[index - 1] : null;
            var bridge = this.CorridorBridgePoint(pContext, prev, p, supportsCrossings);

            if(bridge)
                points.push(bridge);
            points.push(p);
        }

        for(var pointIndex = 0; pointIndex < points.length; ++pointIndex)
            this.StampCorridorCell(pContext, points[pointIndex].x, points[pointIndex].y, radius, supportsCrossings);

        return {
            role: pRole || "primary",
            radius: radius,
            points: points
        };
    },

    AppendRouteMetadata: function(pContext, pSpec) {
        if(!pSpec) return;
        if(!pContext.Paths) pContext.Paths = [];
        pContext.Paths.push(pSpec);
    },

    SamePoint: function(pA, pB) {
        if(!pA || !pB) return false;
        return pA.x === pB.x && pA.y === pB.y;
    },

    DirectLinePoints: function(pStart, pEnd) {
        var points = [];
        var x0 = pStart.x, y0 = pStart.y;
        var x1 = pEnd.x, y1 = pEnd.y;
        var dx = Math.abs(x1 - x0);
        var dy = Math.abs(y1 - y0);
        var sx = x0 < x1 ? 1 : -1;
        var sy = y0 < y1 ? 1 : -1;
        var err = dx - dy;
        var guard = (dx + dy) * 2 + 8;

        while(guard-- > 0) {
            points.push({ x: x0, y: y0 });
            if(x0 === x1 && y0 === y1)
                break;
            var e2 = 2 * err;
            if(e2 > -dy) { err -= dy; x0 += sx; }
            if(e2 < dx) { err += dx; y0 += sy; }
        }

        return points;
    },

    DirectBridgePoints: function(pContext, pStart, pEnd) {
        var supportsCrossings = MapGen.Repair && MapGen.Repair.SupportsCrossings ?
            MapGen.Repair.SupportsCrossings(pContext) : true;
        var points = this.DirectLinePoints(pStart, pEnd);

        for(var index = 0; index < points.length; ++index) {
            if(!this.CorridorCanStamp(pContext, points[index].x, points[index].y, supportsCrossings))
                return null;
        }

        return points;
    },

    ExistingRouteCell: function(pContext, pX, pY) {
        var layers = pContext.Layers || {};
        var route = pContext.RouteCorridor || {};

        return !!(MapGen.Layers.Get(layers.path, pX, pY, 0) ||
            MapGen.Layers.Get(layers.keepClear, pX, pY, 0) ||
            (route.center && MapGen.Layers.Get(route.center, pX, pY, 0)) ||
            (route.core && MapGen.Layers.Get(route.core, pX, pY, 0)));
    },

    RouteViaNearbyEndpoint: function(pContext, pWalkCost, pStart, pEnd, pRole) {
        var maxRadius = Math.max(2, Math.floor((pContext.Profile || {}).PlacementEndpointBridgeRadius || 6));
        var best = null;

        for(var radius = 1; radius <= maxRadius; ++radius) {
            for(var x = pEnd.x - radius; x <= pEnd.x + radius; ++x) {
                for(var y = pEnd.y - radius; y <= pEnd.y + radius; ++y) {
                    if(x < 0 || y < 0 || x >= pContext.Width || y >= pContext.Height)
                        continue;
                    if(Math.max(Math.abs(x - pEnd.x), Math.abs(y - pEnd.y)) !== radius)
                        continue;
                    if(!this.ExistingRouteCell(pContext, x, y))
                        continue;
                    if(pWalkCost[x][y] === Infinity)
                        continue;

                    var routePoint = { x: x, y: y };
                    var bridge = this.DirectBridgePoints(pContext, routePoint, pEnd);
                    if(!bridge)
                        continue;

                    var path = this.FindPath(pContext, pWalkCost, pStart, routePoint, pRole || "endpoint_bridge");
                    if(!path)
                        continue;

                    best = {
                        path: path.concat(bridge.slice(1)),
                        radius: radius
                    };
                    break;
                }
                if(best) break;
            }
            if(best) break;
        }

        if(!best)
            return null;

        var spec = this.StampCorridor(pContext, best.path, pRole);
        if(spec) {
            spec.endpointBridgeRadius = best.radius;
            this.AppendRouteMetadata(pContext, spec);
        }

        return { Path: best.path, WalkCost: pWalkCost, Spec: spec };
    },

    RouteBetween: function(pContext, pWalkCost, pStart, pEnd, pRole, pCarveAttempts) {
        if(!pStart || !pEnd) return null;
        if(this.SamePoint(pStart, pEnd)) return null;

        var path = this.FindPath(pContext, pWalkCost, pStart, pEnd, pRole || "route");
        var carves = pCarveAttempts === undefined ? 2 : pCarveAttempts;

        while(!path && carves-- > 0) {
            this.Carve(pContext, pStart, pEnd);
            // Re-grade walkCost after the carve since blocked/coast/riverBank
            // along the line are now clear.
            pWalkCost = this.BuildWalkCost(pContext);
            path = this.FindPath(pContext, pWalkCost, pStart, pEnd, pRole || "route");
        }

        if(!path) {
            MapGen.Context.AddLog(pContext, "Connectivity failed " + pStart.x + "," + pStart.y + " -> " + pEnd.x + "," + pEnd.y);
            return null;
        }

        var spec = this.StampCorridor(pContext, path, pRole);
        this.AppendRouteMetadata(pContext, spec);
        return { Path: path, WalkCost: pWalkCost, Spec: spec };
    },

    PlacementNodeGroups: function() {
        return ["players", "teams", "objectives", "structures", "pickups", "vehicles", "enemies"];
    },

    NodeForPlacement: function(pContext, pGroupName, pPlacement, pIndex) {
        if(!pPlacement || !pPlacement.point)
            return null;

        var node = {
            id: pGroupName + "_" + pIndex,
            group: pGroupName,
            kind: pPlacement.kind || pPlacement.template || pGroupName,
            role: pPlacement.role || "",
            point: { x: pPlacement.point.x, y: pPlacement.point.y },
            radius: pPlacement.radius || 1,
            approach: pPlacement.approach || 1,
            mustReach: pPlacement.mustReach === false ? false : true,
            placementIndex: pIndex,
            access: null,
            routeFailed: false
        };

        node.access = this.FindAccessPoint(pContext, node);
        return node;
    },

    FindAccessPoint: function(pContext, pNode) {
        if(!pNode || !pNode.point)
            return null;

        var layers = pContext.Layers;
        var point = pNode.point;
        var searchRadius = Math.max(2, (pNode.radius || 1) + (pNode.approach || 1) + 3);
        var best = null;
        var bestScore = Infinity;

        for(var x = point.x - searchRadius; x <= point.x + searchRadius; ++x) {
            for(var y = point.y - searchRadius; y <= point.y + searchRadius; ++y) {
                if(x < 0 || y < 0 || x >= pContext.Width || y >= pContext.Height)
                    continue;
                if(MapGen.Layers.Get(layers.occupied, x, y, 0))
                    continue;
                if(!MapGen.Metrics.IsWalkable(pContext, x, y))
                    continue;

                var dx = x - point.x;
                var dy = y - point.y;
                var score = (dx * dx) + (dy * dy);
                if(MapGen.Layers.Get(layers.path, x, y, 0) || MapGen.Layers.Get(layers.keepClear, x, y, 0))
                    score -= 0.25;

                if(score < bestScore) {
                    bestScore = score;
                    best = { x: x, y: y };
                }
            }
        }

        // Last resort: return the placement tile itself. Validation will flag
        // it if no usable approach exists, but this keeps node reporting stable.
        if(!best && MapGen.Metrics.IsWalkable(pContext, point.x, point.y))
            best = { x: point.x, y: point.y };

        return best;
    },

    ProtectNodeAccess: function(pContext, pNode, pSupportsCrossings) {
        var point = pNode && (pNode.access || pNode.point);
        if(!point)
            return 0;

        var layers = pContext.Layers;
        var radius = Math.max(1, Math.min(2, Math.floor(pNode.approach || 1)));
        var radiusSq = radius * radius;
        var stamped = 0;

        for(var dx = -radius; dx <= radius; ++dx) {
            for(var dy = -radius; dy <= radius; ++dy) {
                if((dx * dx) + (dy * dy) > radiusSq)
                    continue;

                var x = point.x + dx;
                var y = point.y + dy;
                if(!MapGen.Layers.InBounds(layers.path, x, y))
                    continue;
                if(MapGen.Layers.Get(layers.occupied, x, y, 0))
                    continue;
                if(MapGen.Layers.Get(layers.water, x, y, 0) &&
                    !(pSupportsCrossings && MapGen.Layers.Get(layers.crossing, x, y, 0)))
                    continue;

                if(!MapGen.Layers.Get(layers.path, x, y, 0))
                    ++stamped;
                MapGen.Layers.Set(layers.path, x, y, 1);
                MapGen.Layers.Set(layers.keepClear, x, y, 1);
                MapGen.Layers.Set(layers.blocked, x, y, 0);
                MapGen.Layers.Set(layers.coast, x, y, 0);
                MapGen.Layers.Set(layers.riverBank, x, y, 0);
                MapGen.Layers.Set(layers.forcedBank, x, y, 0);
                MapGen.Layers.ClaimCell(layers.owner, x, y, MapGen.Layers.Owner.ROUTE);
            }
        }

        return stamped;
    },

    ProtectPlacementNodeAccess: function(pContext, pNodes) {
        var supportsCrossings = MapGen.Repair && MapGen.Repair.SupportsCrossings ?
            MapGen.Repair.SupportsCrossings(pContext) : true;
        var stamped = 0;

        for(var index = 0; index < pNodes.length; ++index) {
            if(!pNodes[index].mustReach)
                continue;
            stamped += this.ProtectNodeAccess(pContext, pNodes[index], supportsCrossings);
        }

        if(stamped > 0)
            MapGen.Context.AddLog(pContext, "Placement connectivity protected access " + stamped);
    },

    BuildConnectivityNodes: function(pContext) {
        var nodes = [];
        var groups = this.PlacementNodeGroups();

        for(var groupIndex = 0; groupIndex < groups.length; ++groupIndex) {
            var groupName = groups[groupIndex];
            var group = pContext.Placements[groupName] || [];

            for(var index = 0; index < group.length; ++index) {
                var node = this.NodeForPlacement(pContext, groupName, group[index], index);
                if(node)
                    nodes.push(node);
            }
        }

        // The final building planner can place buildings away from the
        // grammar's structure markers. Validate their actual doors as well,
        // so a disconnected approach enters terrain repair before commit.
        var entries = pContext.GameplayPlan ? pContext.GameplayPlan.entries : [];
        for(var entryIndex = 0; entryIndex < entries.length; ++entryIndex) {
            var entry = entries[entryIndex], access = entry.candidate.accessPoint;
            if(access) nodes.push({
                id: "planned_building_" + entryIndex,
                group: "planned_buildings", kind: entry.spec.building,
                point: access, access: access, approach: 1, mustReach: true
            });
        }
        pContext.ConnectivityNodes = nodes;
        return nodes;
    },

    ApplyNodeAccessOverrides: function(pContext, pWalkCost, pNodes) {
        if(!pWalkCost || !pNodes)
            return;

        for(var index = 0; index < pNodes.length; ++index) {
            var node = pNodes[index];
            var point = node && (node.access || node.point);
            if(!point)
                continue;
            if(point.x < 0 || point.y < 0 || point.x >= pWalkCost.length || point.y >= pWalkCost[point.x].length)
                continue;
            this.SetWalkCostCell(pContext, pWalkCost, point.x, point.y, this.Costs.KeepClear);
        }
    },

    ShouldRoutePlacementNode: function(pContext, pNode) {
        if(!pNode)
            return false;

        var profile = pContext.Profile || {};
        var groups = profile.PlacementRouteGroups || null;
        if(groups && groups[pNode.group] !== undefined)
            return !!groups[pNode.group];

        // Enemies must be reachable, but carving a dedicated visible route to
        // every patrol/base guard turns the map into protected open land.
        // Let validation reject unreachable enemy placements instead.
        if(pNode.group === "enemies")
            return false;

        return true;
    },

    PlacementRouteLimit: function(pContext, pGroup) {
        var profile = pContext.Profile || {};
        var limits = profile.PlacementRouteLimits || profile.MaxPlacementRoutesPerGroup || null;
        var value = null;

        if(limits && limits[pGroup] !== undefined)
            value = limits[pGroup];
        else if(pGroup === "enemies" && profile.MaxPlacementEnemyRoutes !== undefined)
            value = profile.MaxPlacementEnemyRoutes;

        if(value === null || value === undefined)
            return Infinity;

        value = Number(value);
        if(isNaN(value) || value < 0)
            return Infinity;

        return Math.floor(value);
    },

    RootConnectivityNode: function(pContext, pNodes) {
        var order = ["players", "teams"];

        for(var orderIndex = 0; orderIndex < order.length; ++orderIndex) {
            for(var index = 0; index < pNodes.length; ++index) {
                if(pNodes[index].group === order[orderIndex] && (pNodes[index].access || pNodes[index].point))
                    return pNodes[index];
            }
        }

        if(pContext.CriticalPoints && pContext.CriticalPoints.length) {
            return {
                id: "critical_0",
                group: "critical",
                kind: "critical_point",
                role: "root",
                point: { x: pContext.CriticalPoints[0].x, y: pContext.CriticalPoints[0].y },
                access: { x: pContext.CriticalPoints[0].x, y: pContext.CriticalPoints[0].y },
                mustReach: true
            };
        }

        return null;
    },

    RouteNodeBetween: function(pContext, pWalkCost, pStartNode, pEndNode, pRole, pCarveAttempts, pAllNodes) {
        if(!pStartNode || !pEndNode)
            return null;

        var start = pStartNode.access || pStartNode.point;
        var end = pEndNode.access || pEndNode.point;
        if(!start || !end)
            return null;
        if(this.SamePoint(start, end))
            return { Path: [start], WalkCost: pWalkCost, Spec: null };

        this.ApplyNodeAccessOverrides(pContext, pWalkCost, pAllNodes || [pStartNode, pEndNode]);
        var path = this.FindPath(pContext, pWalkCost, start, end, pRole || "placement");
        var carves = pCarveAttempts === undefined ? 1 : pCarveAttempts;

        while(!path && carves-- > 0) {
            this.Carve(pContext, start, end);
            pWalkCost = this.BuildWalkCost(pContext);
            this.ApplyNodeAccessOverrides(pContext, pWalkCost, pAllNodes || [pStartNode, pEndNode]);
            path = this.FindPath(pContext, pWalkCost, start, end, pRole || "placement");
        }

        if(!path) {
            var recovered = this.RouteViaNearbyEndpoint(pContext, pWalkCost, start, end, pRole);
            if(recovered)
                return recovered;
            pEndNode.routeFailedReason = "no_path";
            MapGen.Context.AddLog(
                pContext,
                "Placement connectivity failed " + pStartNode.id + " -> " + pEndNode.id
            );
            return null;
        }

        var spec = this.StampCorridor(pContext, path, pRole);
        if(spec) {
            spec.fromNode = pStartNode.id;
            spec.toNode = pEndNode.id;
            this.AppendRouteMetadata(pContext, spec);
        }

        return { Path: path, WalkCost: pWalkCost, Spec: spec };
    },

    BuildPlacementNodes: function(pContext) {
        if(pContext.Paths) {
            var kept = [];
            for(var pathIndex = 0; pathIndex < pContext.Paths.length; ++pathIndex) {
                var path = pContext.Paths[pathIndex];
                if(!path || !path.role || path.role.indexOf("placement_") !== 0)
                    kept.push(path);
            }
            pContext.Paths = kept;
        }

        var nodes = this.BuildConnectivityNodes(pContext);
        if(!nodes.length) {
            MapGen.Context.AddLog(pContext, "Placement connectivity skipped: no nodes");
            return;
        }

        var root = this.RootConnectivityNode(pContext, nodes);
        if(!root) {
            MapGen.Context.AddLog(pContext, "Placement connectivity skipped: no root node");
            return;
        }

        if((pContext.Profile || {}).PostPlacementRouteCarving === false) {
            MapGen.Context.AddLog(
                pContext,
                "Placement connectivity nodes " + nodes.length + " validation-only"
            );
            return;
        }

        this.ProtectPlacementNodeAccess(pContext, nodes);
        var walkCost = this.BuildWalkCost(pContext);
        this.ApplyNodeAccessOverrides(pContext, walkCost, nodes);

        var stats = this.PathStats(pContext);
        if(stats) {
            ++stats.placement.calls;
            stats.placement.nodes += nodes.length;
            stats.placement.lastNodes = nodes.length;
        }
        var routed = 0;
        var failed = 0;
        var skipped = 0;
        var attemptedByGroup = {};
        var routedByGroup = {};

        for(var index = 0; index < nodes.length; ++index) {
            var node = nodes[index];
            if(node === root || !node.mustReach)
                continue;
            if(!this.ShouldRoutePlacementNode(pContext, node)) {
                ++skipped;
                if(stats) {
                    ++stats.placement.skipped;
                    this.AddGroupCount(stats.placement.skippedByGroup, node.group, 1);
                }
                continue;
            }
            var routeLimit = this.PlacementRouteLimit(pContext, node.group);
            if((attemptedByGroup[node.group] || 0) >= routeLimit) {
                ++skipped;
                if(stats) {
                    ++stats.placement.skipped;
                    this.AddGroupCount(stats.placement.skippedByGroup, node.group, 1);
                    stats.placement.routeLimits[node.group] = routeLimit;
                }
                continue;
            }
            if(!node.access && !node.point) {
                node.routeFailed = true;
                ++failed;
                if(stats) {
                    ++stats.placement.failed;
                    this.AddGroupCount(stats.placement.failedByGroup, node.group, 1);
                }
                continue;
            }

            attemptedByGroup[node.group] = (attemptedByGroup[node.group] || 0) + 1;
            if(stats)
                this.AddGroupCount(stats.placement.attemptedByGroup, node.group, 1);

            var result = this.RouteNodeBetween(
                pContext,
                walkCost,
                root,
                node,
                "placement_" + node.group,
                1,
                nodes
            );

            if(result) {
                ++routed;
                routedByGroup[node.group] = (routedByGroup[node.group] || 0) + 1;
                if(stats) {
                    ++stats.placement.routed;
                    this.AddGroupCount(stats.placement.routedByGroup, node.group, 1);
                }
                walkCost = this.BuildWalkCost(pContext, result.WalkCost, result.Spec);
                this.ApplyNodeAccessOverrides(pContext, walkCost, nodes);
            }
            else {
                node.routeFailed = true;
                ++failed;
                if(stats) {
                    ++stats.placement.failed;
                    this.AddGroupCount(stats.placement.failedByGroup, node.group, 1);
                }
            }
        }

        MapGen.Context.AddLog(
            pContext,
            "Placement connectivity nodes " + nodes.length + " routed " + routed + " failed " + failed + " skipped " + skipped
        );
        this.ProtectPlacementNodeAccess(pContext, nodes);
    },

    SpurSites: function(pContext) {
        var sites = pContext.PlannedSites || [];
        var spurs = [];

        for(var index = 0; index < sites.length; ++index) {
            var site = sites[index];
            if(!site || !site.point) continue;
            if(pContext.Profile && pContext.Profile.GeneratorCore === "official_grammar" &&
                site.kind === "structure")
                continue;
            if(site.requireConnected) continue;
            if(!site.requireSpur) continue;
            spurs.push(site.point);
        }

        return spurs;
    },

    DeadEndSpurCount: function(pContext) {
        var profile = pContext.Profile || {};
        if(profile.DeadEndSpurs === false)
            return 0;

        if(profile.DeadEndSpurCount !== undefined)
            return Math.max(0, Math.min(12, this.RangeValue(pContext, "DeadEndSpurCount", 0, 0, true, 0, 0, 2301)));

        var rate = this.RangeValue(pContext, "DeadEndSpursPer2048Tiles", 0, 0, false, 0, 0, 2303);
        var count = Math.round(rate * (pContext.Width * pContext.Height) / 2048);

        return Math.max(0, Math.min(12, count));
    },

    DeadEndSpurLength: function(pContext, pIndex, pAnchor) {
        return Math.max(5, this.RangeValue(
            pContext,
            "DeadEndSpurLength",
            8,
            16,
            true,
            (pAnchor ? pAnchor.x : 0) + pIndex,
            pAnchor ? pAnchor.y : 0,
            2311 + pIndex
        ));
    },

    RouteAnchorCandidates: function(pContext) {
        var anchors = [];
        var paths = pContext.Paths || [];

        for(var pathIndex = 0; pathIndex < paths.length; ++pathIndex) {
            var path = paths[pathIndex];
            if(!path || !path.points || path.points.length < 12)
                continue;
            if(path.role === "dead_end" || path.role === "repair_critical")
                continue;

            var step = Math.max(5, Math.floor(path.points.length / 6));
            for(var pointIndex = 4; pointIndex < path.points.length - 4; pointIndex += step) {
                var point = path.points[pointIndex];
                anchors.push({
                    x: point.x,
                    y: point.y,
                    pathIndex: pathIndex,
                    pointIndex: pointIndex
                });
            }
        }

        return anchors;
    },

    IsDeadEndSpurTarget: function(pContext, pX, pY, pAnchor) {
        var layers = pContext.Layers;
        var margin = 3;

        if(pX < margin || pY < margin || pX >= pContext.Width - margin || pY >= pContext.Height - margin)
            return false;
        if(MapGen.Layers.Get(layers.path, pX, pY, 0) ||
            MapGen.Layers.Get(layers.keepClear, pX, pY, 0) ||
            MapGen.Layers.Get(layers.occupied, pX, pY, 0) ||
            MapGen.Layers.Get(layers.water, pX, pY, 0) ||
            MapGen.Layers.Get(layers.coast, pX, pY, 0) ||
            MapGen.Layers.Get(layers.crossing, pX, pY, 0) ||
            MapGen.Layers.Get(layers.causeway, pX, pY, 0))
            return false;

        if(pAnchor) {
            var dx = pAnchor.x - pX;
            var dy = pAnchor.y - pY;
            if((dx * dx) + (dy * dy) < 36)
                return false;
        }

        return true;
    },

    BuildDeadEndSpurs: function(pContext, pWalkCost) {
        var count = this.DeadEndSpurCount(pContext);
        if(count <= 0)
            return pWalkCost;

        var anchors = this.RouteAnchorCandidates(pContext);
        if(!anchors.length)
            return pWalkCost;

        var built = 0;
        var attempts = 0;

        for(var index = 0; index < count; ++index) {
            var anchorIndex = MapGen.Random.HashTile(pContext.Seed, index, anchors.length, 2321) % anchors.length;
            var anchor = anchors[anchorIndex];
            var baseLength = this.DeadEndSpurLength(pContext, index, anchor);

            for(var attempt = 0; attempt < 12; ++attempt) {
                ++attempts;
                var angleUnit = this.HashUnit(pContext, anchor.x + index, anchor.y + attempt, 2331);
                var angle = angleUnit * Math.PI * 2.0;
                var lengthScale = 1.0 - (attempt * 0.04);
                var length = Math.max(5, Math.round(baseLength * lengthScale));
                var end = {
                    x: Math.round(anchor.x + Math.cos(angle) * length),
                    y: Math.round(anchor.y + Math.sin(angle) * length)
                };

                if(!this.IsDeadEndSpurTarget(pContext, end.x, end.y, anchor))
                    continue;

                var result = this.RouteBetween(pContext, pWalkCost, anchor, end, "dead_end", 0);
                if(result && result.Path && result.Path.length >= 5) {
                    ++built;
                    pWalkCost = this.BuildWalkCost(pContext, result.WalkCost, result.Spec);
                    break;
                }
            }
        }

        if(built)
            MapGen.Context.AddLog(pContext, "Connectivity carved " + built + " dead-end spurs (" + attempts + " attempts)");

        return pWalkCost;
    },

    Build: function(pContext) {
        if(!pContext.CriticalPoints) pContext.CriticalPoints = [];
        if(!pContext.Paths) pContext.Paths = [];

        var walkCost = this.BuildWalkCost(pContext);

        // Connect every critical point to the first. Later legs can reuse
        // existing corridors, forming the objective route and support branches.
        for(var index = 1; index < pContext.CriticalPoints.length; ++index) {
            var start = pContext.CriticalPoints[0];
            var end = pContext.CriticalPoints[index];
            var role = index === 1 ? "primary" : "secondary";
            var result = this.RouteBetween(pContext, walkCost, start, end, role, 2);
            // Carving can change terrain even when a route fails. Refresh so
            // subsequent searches see the current terrain and stamped corridors.
            walkCost = this.BuildWalkCost(pContext, result && result.WalkCost, result && result.Spec);
        }

        if(MapGen.Layout && MapGen.Layout.CriticalSites &&
            MapGen.Layout.CriticalSites.RepositionRouteSpurSites) {
            MapGen.Layout.CriticalSites.RepositionRouteSpurSites(pContext);
            walkCost = this.BuildWalkCost(pContext);
        }

        // Spurs — connect each requireSpur site to the nearest already-routed
        // cell. Same A* call; the existing corridor cells now register as
        // cheapest in walkCost so the spur naturally docks onto the spine.
        var spurs = this.SpurSites(pContext);
        for(var spurIndex = 0; spurIndex < spurs.length; ++spurIndex) {
            var spurEnd = spurs[spurIndex];
            var anchor = this.NearestCorridorPoint(pContext, spurEnd);
            if(!anchor) anchor = pContext.CriticalPoints[0];
            var spurResult = this.RouteBetween(pContext, walkCost, anchor, spurEnd, "spur", 1);
            walkCost = this.BuildWalkCost(pContext, spurResult && spurResult.WalkCost, spurResult && spurResult.Spec);
        }

        walkCost = this.BuildDeadEndSpurs(pContext, walkCost);

        MapGen.Context.AddLog(pContext, "Connectivity built " + pContext.Paths.length + " routes");
    },

    NearestCorridorPoint: function(pContext, pTo) {
        var layers = pContext.Layers;
        var bestDist = Infinity;
        var best = null;

        // Iterate stamped path metadata first (cheap) before falling back to
        // a layer scan.
        for(var pi = 0; pi < pContext.Paths.length; ++pi) {
            var path = pContext.Paths[pi];
            if(!path || !path.points) continue;
            for(var ppi = 0; ppi < path.points.length; ++ppi) {
                var pt = path.points[ppi];
                var dx = pt.x - pTo.x;
                var dy = pt.y - pTo.y;
                var d = (dx * dx) + (dy * dy);
                if(d < bestDist) {
                    bestDist = d;
                    best = pt;
                }
            }
        }

        if(best) return best;

        // Fallback: scan Layers.path (covers the case where pContext.Paths
        // is empty but the layer was pre-seeded by some other system).
        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(!MapGen.Layers.Get(layers.path, x, y, 0)) continue;
                var ddx = x - pTo.x;
                var ddy = y - pTo.y;
                var dd = (ddx * ddx) + (ddy * ddy);
                if(dd < bestDist) {
                    bestDist = dd;
                    best = { x: x, y: y };
                }
            }
        }

        return best;
    },

    Repair: function(pContext) {
        // Called from MapGen.Repair when the validator reports
        // critical_points_disconnected. Re-runs A* with carving enabled for
        // any pair the validator says is disconnected.
        var walkCost = this.BuildWalkCost(pContext);
        var start = pContext.CriticalPoints[0];
        var repaired = false;

        for(var index = 1; index < pContext.CriticalPoints.length; ++index) {
            var end = pContext.CriticalPoints[index];
            var path = this.FindPath(pContext, walkCost, start, end, "repair_probe");
            if(path) continue;

            var result = this.RouteBetween(pContext, walkCost, start, end, "repair_critical", 4);
            if(result) {
                walkCost = this.BuildWalkCost(pContext, result.WalkCost, result.Spec);
                repaired = true;
            }
        }

        return repaired;
    }
};
