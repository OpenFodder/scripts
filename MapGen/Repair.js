var MapGen = MapGen || {};

MapGen.Repair = {

    HasKey: function(pKeys, pPrefix) {
        for(var index = 0; index < pKeys.length; ++index) {
            if(pKeys[index] === pPrefix || pKeys[index].indexOf(pPrefix + ":") === 0)
                return true;
        }

        return false;
    },

    DistanceSq: function(pA, pB) {
        var dx = pA.x - pB.x;
        var dy = pA.y - pB.y;
        return (dx * dx) + (dy * dy);
    },

    ClearDisc: function(pLayer, pPoint, pRadius) {
        var radiusSq = pRadius * pRadius;

        for(var x = pPoint.x - pRadius; x <= pPoint.x + pRadius; ++x) {
            for(var y = pPoint.y - pRadius; y <= pPoint.y + pRadius; ++y) {
                var dx = x - pPoint.x;
                var dy = y - pPoint.y;

                if((dx * dx) + (dy * dy) <= radiusSq)
                    MapGen.Layers.Set(pLayer, x, y, 0);
            }
        }
    },

    SupportsCrossings: function(pContext) {
        var catalog = MapGen.Terrain && MapGen.Terrain.TileCatalog;
        if(!catalog || !catalog.SupportsWaterFeature)
            return true;

        return catalog.SupportsWaterFeature(pContext.Profile.TerrainType, "crossings");
    },

    StampRouteDisc: function(pContext, pCenterX, pCenterY, pRadius) {
        var supportsCrossings = this.SupportsCrossings(pContext);
        var radiusSq = pRadius * pRadius;

        MapGen.Layers.StampDisc(pContext.Layers.keepClear, pCenterX, pCenterY, pRadius, 1);

        for(var x = pCenterX - pRadius; x <= pCenterX + pRadius; ++x) {
            for(var y = pCenterY - pRadius; y <= pCenterY + pRadius; ++y) {
                var dx = x - pCenterX;
                var dy = y - pCenterY;
                if((dx * dx) + (dy * dy) > radiusSq)
                    continue;
                if(MapGen.Layers.Get(pContext.Layers.water, x, y, 0) > 0 && !supportsCrossings)
                    continue;

                MapGen.Layers.Set(pContext.Layers.path, x, y, 1);
            }
        }
    },

    ConnectCriticalPoints: function(pContext) {
        if(!pContext.CriticalPoints || pContext.CriticalPoints.length < 2)
            return false;
        if(!MapGen.Connectivity || !MapGen.Connectivity.Repair)
            return false;

        var repaired = MapGen.Connectivity.Repair(pContext);
        if(repaired)
            MapGen.Context.AddLog(pContext, "Repair connected critical points");

        return repaired;
    },

    EnsureRiverCrossings: function(pContext) {
        for(var riverIndex = 0; riverIndex < pContext.Rivers.length; ++riverIndex) {
            var river = pContext.Rivers[riverIndex];
            if(river.requiresCrossing === false)
                continue;
            if(!river.points || !river.points.length)
                continue;

            var hasCrossing = false;
            for(var crossingIndex = 0; crossingIndex < pContext.Crossings.length; ++crossingIndex) {
                if(this.DistanceSq(pContext.Crossings[crossingIndex], river.points[Math.floor(river.points.length / 2)]) < 64) {
                    hasCrossing = true;
                    break;
                }
            }

            if(hasCrossing)
                continue;

            var point = river.points[Math.floor(river.points.length / 2)];
            // Authored beach rivers may carry only their point chain.
            var start = river.start || river.points[0];
            var end = river.end || river.points[river.points.length - 1];
            var crossing = {
                x: point.x,
                y: point.y,
                radius: (river.width || 1) + 1,
                length: Math.max(3, ((river.width || 1) * 2) + 2),
                halfWidth: 1,
                axis: Math.abs(end.x - start.x) >
                    Math.abs(end.y - start.y) ?
                    "vertical" : "horizontal",
                role: "river_crossing_repair",
                surface: "ford"
            };

            pContext.Crossings.push(crossing);
            MapGen.Layers.StampDisc(pContext.Layers.keepClear, crossing.x, crossing.y, crossing.radius, 1);
            if(this.SupportsCrossings(pContext)) {
                MapGen.Layers.StampDisc(pContext.Layers.crossing, crossing.x, crossing.y,
                    Math.max(1, Math.floor(crossing.radius * 0.75)), 1);
            }
        }

        MapGen.Context.AddLog(pContext, "Repair ensured river crossings");
    },

    MoveCrossingsOntoRoutes: function(pContext) {
        if(!pContext.Crossings.length || !pContext.Paths.length)
            return;

        var path = pContext.Paths[0];
        if(!path.points.length)
            return;

        for(var index = 0; index < pContext.Crossings.length; ++index) {
            var crossing = pContext.Crossings[index];
            var best = null;
            var bestScore = 0x7FFFFFFF;

            for(var pointIndex = 0; pointIndex < path.points.length; ++pointIndex) {
                var point = path.points[pointIndex];
                var waterScore = MapGen.Layers.Get(pContext.Layers.water, point.x, point.y, 0) ? 0 : 250;
                var score = this.DistanceSq(crossing, point) + waterScore;

                if(score < bestScore) {
                    best = point;
                    bestScore = score;
                }
            }

            if(best) {
                crossing.x = best.x;
                crossing.y = best.y;
                crossing.surface = crossing.surface || "ford";
                this.StampRouteDisc(pContext, crossing.x, crossing.y, crossing.radius);
                if(this.SupportsCrossings(pContext)) {
                    MapGen.Layers.StampDisc(pContext.Layers.crossing, crossing.x, crossing.y,
                        Math.max(1, Math.floor(crossing.radius * 0.75)), 1);
                }
            }
        }

        MapGen.Context.AddLog(pContext, "Repair moved river crossings onto routes");
    },

    CountWaterNeighbours: function(pContext, pX, pY, pIncludeDiagonals) {
        var count = 0;

        for(var dx = -1; dx <= 1; ++dx) {
            for(var dy = -1; dy <= 1; ++dy) {
                if(dx === 0 && dy === 0)
                    continue;
                if(!pIncludeDiagonals && dx !== 0 && dy !== 0)
                    continue;
                if(MapGen.Layers.Get(pContext.Layers.water, pX + dx, pY + dy, 0))
                    ++count;
            }
        }

        return count;
    },

    NearestRiverPointDistanceSq: function(pContext, pX, pY) {
        var best = 0x7FFFFFFF;

        for(var riverIndex = 0; riverIndex < pContext.Rivers.length; ++riverIndex) {
            var points = pContext.Rivers[riverIndex].points || [];

            for(var pointIndex = 0; pointIndex < points.length; ++pointIndex) {
                var dx = pX - points[pointIndex].x;
                var dy = pY - points[pointIndex].y;
                var distanceSq = (dx * dx) + (dy * dy);

                if(distanceSq < best)
                    best = distanceSq;
            }
        }

        return best;
    },

    // Bridge artwork removes water under its own footprint, but the channel
    // must remain visible immediately to both sides of every middle row. These
    // cells are deliberately protected from TrimWaterCoverage; the repair can
    // take the same small number of cells from less important shoreline instead.
    IsBridgeWaterApproach: function(pContext, pX, pY) {
        var bridges = pContext.Bridges || [];

        for(var index = 0; index < bridges.length; ++index) {
            var bridge = bridges[index];
            if(!bridge || bridge.axis !== "vertical" || !bridge.bounds ||
                typeof bridge.waterTop !== "number" || typeof bridge.waterBottom !== "number")
                continue;
            if(pY < bridge.waterTop || pY > bridge.waterBottom)
                continue;

            var leftDistance = bridge.bounds.minX - pX;
            var rightDistance = pX - bridge.bounds.maxX;
            if((leftDistance >= 1 && leftDistance <= 2) ||
                (rightDistance >= 1 && rightDistance <= 2))
                return true;
        }

        return false;
    },

    WaterTrimCandidates: function(pContext) {
        var candidates = [];
        var preserveChannels = pContext.Profile.TerrainType === Terrain.Types.Jungle &&
            !Number(pContext.Profile.TerrainTypeSub || 0);

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(!MapGen.Layers.Get(pContext.Layers.water, x, y, 0))
                    continue;
                if(MapGen.Layers.Get(pContext.Layers.crossing, x, y, 0))
                    continue;
                if(this.IsBridgeWaterApproach(pContext, x, y))
                    continue;

                var cardinal = this.CountWaterNeighbours(pContext, x, y, false);
                var around = this.CountWaterNeighbours(pContext, x, y, true);
                var routePenalty = (MapGen.Layers.Get(pContext.Layers.keepClear, x, y, 0) || MapGen.Layers.Get(pContext.Layers.path, x, y, 0)) ? 2 : 0;
                var riverDistance = this.NearestRiverPointDistanceSq(pContext, x, y);
                // Retain enough width for a continuous, renderable channel.
                // Thin rivers otherwise lose every cell before the surrounding
                // ocean is trimmed, leaving only protected bridge-side pools.
                var channelBonus = preserveChannels && riverDistance <= 4 ? 10000 : 0;
                // Map-edge water is the river mouth - trimming it produces a
                // "rounded off" river that doesn't reach the perimeter. Push
                // border cells to the bottom of the trim list so they're only
                // removed once interior water can no longer satisfy the cap.
                var edgeBonus = (x === 0 || y === 0 || x === pContext.Width - 1 || y === pContext.Height - 1) ? 100000 : 0;

                candidates.push({
                    x: x,
                    y: y,
                    score: (cardinal * 1000) + (around * 100) + routePenalty + Math.min(99, riverDistance) + edgeBonus + channelBonus
                });
            }
        }

        candidates.sort(function(pA, pB) {
            if(pA.score !== pB.score)
                return pA.score - pB.score;
            // Total-order tiebreak on unique cell coords: equal scores must not
            // reorder between launches (the engine's Array.sort is unstable).
            if(pA.x !== pB.x)
                return pA.x - pB.x;
            return pA.y - pB.y;
        });

        return candidates;
    },

    TrimWaterCoverage: function(pContext) {
        var profile = pContext.Profile;
        var maxCoverage = profile.MaxWaterCoverage;

        if(MapGen.Terrain && MapGen.Terrain.TileCatalog && MapGen.Terrain.TileCatalog.MaxWaterCoverage)
            maxCoverage = MapGen.Terrain.TileCatalog.MaxWaterCoverage(profile.TerrainType, profile.MaxWaterCoverage);

        if(maxCoverage === undefined)
            return false;

        var area = pContext.Width * pContext.Height;
        var maxWater = Math.floor(area * maxCoverage);
        var water = MapGen.Layers.Count(pContext.Layers.water, function(pValue) { return !!pValue; });

        if(water <= maxWater)
            return false;

        var candidates = this.WaterTrimCandidates(pContext);

        for(var index = 0; index < candidates.length && water > maxWater; ++index) {
            var candidate = candidates[index];

            if(!MapGen.Layers.Get(pContext.Layers.water, candidate.x, candidate.y, 0))
                continue;

            MapGen.Layers.Set(pContext.Layers.water, candidate.x, candidate.y, 0);
            --water;
        }

        MapGen.Context.AddLog(pContext, "Repair trimmed water coverage");
        return true;
    },

    RouteCoverBonusGrid: function(pContext) {
        var width = pContext.Width, height = pContext.Height;
        var scores = new Float64Array(width * height);
        var paths = pContext.Paths || [];
        // Preserve path/sample accumulation order, but visit only the radius
        // that can contribute. Previously every tree scanned every route.
        for(var p = 0; p < paths.length; ++p) {
            var points = paths[p] && paths[p].points || [];
            for(var i = 0; i < points.length; i += 3) {
                var point = points[i];
                for(var y = Math.max(0, Math.ceil(point.y - 6)); y <= Math.min(height - 1, Math.floor(point.y + 6)); ++y) {
                    for(var x = Math.max(0, Math.ceil(point.x - 6)); x <= Math.min(width - 1, Math.floor(point.x + 6)); ++x) {
                        var index = y * width + x;
                        if(scores[index] >= 1.6) continue;
                        var dx = x - point.x, dy = y - point.y;
                        var distance = dx * dx + dy * dy;
                        if(distance <= 36)
                            scores[index] = Math.min(1.6, scores[index] + (distance <= 4 ? 0.35 : 0.85));
                    }
                }
            }
        }
        return scores;
    },

    ThinTreesToTarget: function(pContext, pPrecomputedBlocked) {
        var profile = pContext.Profile;
        var target = profile.MaxTreeCoverage !== undefined ? profile.MaxTreeCoverage : Math.min(0.90, (profile.TreeCoverage || 0) * 1.15);
        var area = pContext.Width * pContext.Height;
        var maxBlocked = Math.floor(area * target);
        // v3 cover budgeting already counted the current blocked cells for
        // its diagnostic payload. Reuse that exact count when supplied;
        // callers without it retain the original scan behavior. Check for
        // undefined explicitly so a valid precomputed zero is preserved.
        var blocked = pPrecomputedBlocked === undefined ?
            MapGen.Metrics.TreeBlockedCount(pContext) : pPrecomputedBlocked;
        var candidates = [];


        if(blocked <= maxBlocked)
            return;

        var routeCoverScores = this.RouteCoverBonusGrid(pContext);
        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(!MapGen.Metrics.IsTreeBlocked(pContext, x, y))
                    continue;

                var routeCoverBonus = routeCoverScores[y * pContext.Width + x];

                candidates.push({
                    x: x,
                    y: y,
                    score: MapGen.Terrain.Cover.TreeScore(pContext, x, y) + Math.min(1.6, routeCoverBonus)
                });
            }
        }

        candidates.sort(function(pA, pB) {
            if(pA.score !== pB.score)
                return pA.score - pB.score;
            // Total-order tiebreak on unique cell coords: equal scores must not
            // reorder between launches (the engine's Array.sort is unstable).
            if(pA.x !== pB.x)
                return pA.x - pB.x;
            return pA.y - pB.y;
        });

        for(var index = 0; index < candidates.length && blocked > maxBlocked; ++index) {
            MapGen.Layers.Set(pContext.Layers.blocked, candidates[index].x, candidates[index].y, 0);
            if(pContext.Layers.treeTrimmed)
                MapGen.Layers.Set(pContext.Layers.treeTrimmed, candidates[index].x, candidates[index].y, 1);
            --blocked;
        }

        MapGen.Context.AddLog(pContext, "Repair thinned tree coverage");
    },

    CanGrowTreeAt: function(c, x, y) {
        var L = MapGen.Layers, layers = c.Layers;
        return !L.Get(layers.blocked, x, y, 0) &&
            !MapGen.Terrain.Cover.IsExcluded(c, x, y) &&
            !L.Get(layers.water, x, y, 0) && !L.Get(layers.keepClear, x, y, 0) &&
            !L.Get(layers.path, x, y, 0) && !L.Get(layers.occupied, x, y, 0);
    },

    TreeGrowthCapacity: function(c) {
        var capacity = MapGen.Metrics.TreeBlockedCount(c);
        for(var x = 0; x < c.Width; ++x)
            for(var y = 0; y < c.Height; ++y)
                if(this.CanGrowTreeAt(c, x, y)) ++capacity;
        return capacity;
    },

    GrowTreesToTarget: function(pContext) {
        var profile = pContext.Profile;
        var target = profile.MinTreeCoverage !== undefined ? profile.MinTreeCoverage : (profile.TreeCoverage || 0) * 0.75;
        var area = pContext.Width * pContext.Height;
        // Validation compares the fraction directly; rounding down can leave
        // a fractional target one tree short even after a successful repair.
        var minBlocked = Math.ceil(area * target);
        var blocked = MapGen.Metrics.TreeBlockedCount(pContext);
        var candidates = [];

        if(blocked >= minBlocked)
            return;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(!this.CanGrowTreeAt(pContext, x, y))
                    continue;
                candidates.push({
                    x: x,
                    y: y,
                    score: MapGen.Terrain.Cover.TreeScore(pContext, x, y)
                });
            }
        }

        candidates.sort(function(pA, pB) {
            if(pA.score !== pB.score)
                return pB.score - pA.score;
            // Total-order tiebreak on unique cell coords: equal scores must not
            // reorder between launches (the engine's Array.sort is unstable).
            if(pA.x !== pB.x)
                return pA.x - pB.x;
            return pA.y - pB.y;
        });

        for(var index = 0; index < candidates.length && blocked < minBlocked; ++index) {
            MapGen.Layers.Set(pContext.Layers.blocked, candidates[index].x, candidates[index].y, 1);
            if(pContext.Layers.treeTrimmed)
                MapGen.Layers.Set(pContext.Layers.treeTrimmed, candidates[index].x, candidates[index].y, 0);
            if(pContext.Layers.owner)
                MapGen.Layers.ClaimCell(pContext.Layers.owner, candidates[index].x, candidates[index].y, MapGen.Layers.Owner.TREE);
            ++blocked;
        }

        MapGen.Context.AddLog(pContext, "Repair grew tree coverage");
    },

    ClearCriticalPoints: function(pContext) {
        var groups = [
            pContext.CriticalPoints || [],
            pContext.Placements.players || [],
            pContext.Placements.teams || [],
            pContext.Placements.objectives || []
        ];

        for(var groupIndex = 0; groupIndex < groups.length; ++groupIndex) {
            var group = groups[groupIndex];

            for(var index = 0; index < group.length; ++index) {
                var point = group[index].point || group[index];
                if(!point)
                    continue;

                this.ClearDisc(pContext.Layers.water, point, 2);
                this.ClearDisc(pContext.Layers.blocked, point, 2);
                this.StampRouteDisc(pContext, point.x, point.y, 2);
            }
        }

        MapGen.Context.AddLog(pContext, "Repair cleared critical points");
    },

    // T3.17 — land cohesion. Spec asks for a separate Repair/Cohesion.js but
    // the engine's scriptsLoadFolder list doesn't include MapGen/Repair/, so
    // these methods live inline on MapGen.Repair to avoid a C++ rebuild +
    // smoke-harness churn. All are called from Run() when walkable_space_split
    // or land_too_fragmented fires.
    LandComponents: function(pContext) {
        var visited = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
        var components = [];
        var directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];

        for(var sx = 0; sx < pContext.Width; ++sx) {
            for(var sy = 0; sy < pContext.Height; ++sy) {
                if(visited[sx][sy])
                    continue;
                if(!MapGen.Metrics.IsWalkable(pContext, sx, sy)) {
                    visited[sx][sy] = 1;
                    continue;
                }

                var cells = [];
                var queue = [[sx, sy]];
                var head = 0;
                visited[sx][sy] = 1;

                while(head < queue.length) {
                    var c = queue[head++];
                    cells.push(c);

                    for(var d = 0; d < directions.length; ++d) {
                        var nx = c[0] + directions[d][0];
                        var ny = c[1] + directions[d][1];

                        if(nx < 0 || ny < 0 || nx >= pContext.Width || ny >= pContext.Height)
                            continue;
                        if(visited[nx][ny])
                            continue;
                        visited[nx][ny] = 1;
                        if(MapGen.Metrics.IsWalkable(pContext, nx, ny))
                            queue.push([nx, ny]);
                    }
                }

                components.push({ cells: cells, size: cells.length });
            }
        }

        components.sort(function(pA, pB) {
            if(pA.size !== pB.size)
                return pB.size - pA.size;
            // Total-order tiebreak on the (unique, row-major-discovered) seed
            // cell so equal-size fragments keep a deterministic order under the
            // engine's unstable Array.sort.
            var a = pA.cells[0];
            var b = pB.cells[0];
            if(a[0] !== b[0])
                return a[0] - b[0];
            return a[1] - b[1];
        });
        return components;
    },

    FragmentDominantBorder: function(pContext, pFragment) {
        var waterBorder = 0;
        var blockedBorder = 0;
        var directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];

        for(var i = 0; i < pFragment.cells.length; ++i) {
            var c = pFragment.cells[i];
            for(var d = 0; d < directions.length; ++d) {
                var nx = c[0] + directions[d][0];
                var ny = c[1] + directions[d][1];

                if(nx < 0 || ny < 0 || nx >= pContext.Width || ny >= pContext.Height)
                    continue;
                if(MapGen.Layers.Get(pContext.Layers.water, nx, ny, 0))
                    ++waterBorder;
                else if(MapGen.Layers.Get(pContext.Layers.blocked, nx, ny, 0))
                    ++blockedBorder;
            }
        }

        return waterBorder >= blockedBorder ? "water" : "blocked";
    },

    FillFragment: function(pContext, pFragment, pFillType) {
        for(var i = 0; i < pFragment.cells.length; ++i) {
            var x = pFragment.cells[i][0];
            var y = pFragment.cells[i][1];

            // Routes/critical clearings stay walkable — never paint over them
            // (would orphan the very anchor we're trying to preserve).
            if(MapGen.Layers.Get(pContext.Layers.keepClear, x, y, 0) || MapGen.Layers.Get(pContext.Layers.path, x, y, 0))
                continue;

            // Cliff body guard ([[mapgen_cliff_edge_to_edge]] Slice 1C). The
            // 'water' branch below clears blocked=1 on cliff body cells
            // (visual demolition) AND sets water=1 (would render water on
            // top of the cliff). Skip cliff cells in both branches.
            if(pContext.Layers.owner &&
                MapGen.Layers.Get(pContext.Layers.owner, x, y, 0) === MapGen.Layers.Owner.CLIFF)
                continue;

            if(pFillType === "water") {
                MapGen.Layers.Set(pContext.Layers.water, x, y, 1);
                MapGen.Layers.Set(pContext.Layers.blocked, x, y, 0);
            } else {
                MapGen.Layers.Set(pContext.Layers.blocked, x, y, 1);
            }
        }
    },

    ContainsAnchor: function(pContext, pComponent) {
        if((!pContext.Regions || !pContext.Regions.length) && !pContext.Anchors)
            return false;

        var lookup = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
        for(var i = 0; i < pComponent.cells.length; ++i)
            lookup[pComponent.cells[i][0]][pComponent.cells[i][1]] = 1;

        if(pContext.Regions) {
            for(var r = 0; r < pContext.Regions.length; ++r) {
                var p = pContext.Regions[r].point;
                if(!p) continue;
                if(p.x < 0 || p.y < 0 || p.x >= pContext.Width || p.y >= pContext.Height) continue;
                if(lookup[p.x][p.y])
                    return true;
            }
        }

        if(pContext.Anchors) {
            for(var key in pContext.Anchors) {
                if(!pContext.Anchors.hasOwnProperty(key))
                    continue;
                var anchor = pContext.Anchors[key];
                if(!anchor) continue;
                if(anchor.x < 0 || anchor.y < 0 || anchor.x >= pContext.Width || anchor.y >= pContext.Height) continue;
                if(lookup[anchor.x][anchor.y])
                    return true;
            }
        }

        return false;
    },

    ComponentContainsPoint: function(pComponent, pPoint) {
        if(!pComponent || !pComponent.cells || !pPoint)
            return false;

        for(var i = 0; i < pComponent.cells.length; ++i) {
            if(pComponent.cells[i][0] === pPoint.x && pComponent.cells[i][1] === pPoint.y)
                return true;
        }

        return false;
    },

    ComponentContainsGameplay: function(pContext, pComponent) {
        if(this.ContainsAnchor(pContext, pComponent))
            return true;

        var groups = ["players", "teams", "enemies", "objectives", "structures", "pickups", "vehicles"];
        for(var groupIndex = 0; groupIndex < groups.length; ++groupIndex) {
            var group = (pContext.Placements && pContext.Placements[groups[groupIndex]]) || [];
            for(var placementIndex = 0; placementIndex < group.length; ++placementIndex) {
                if(this.ComponentContainsPoint(pComponent, group[placementIndex].point))
                    return true;
            }
        }

        var occupied = pContext.Layers && pContext.Layers.occupied;
        if(occupied) {
            for(var cellIndex = 0; cellIndex < pComponent.cells.length; ++cellIndex) {
                if(MapGen.Layers.Get(occupied, pComponent.cells[cellIndex][0], pComponent.cells[cellIndex][1], 0))
                    return true;
            }
        }

        return false;
    },

    RouteComponentScore: function(pContext, pComponent) {
        var score = 0;
        var route = pContext.RouteCorridor || {};
        var layers = pContext.Layers || {};

        for(var i = 0; i < pComponent.cells.length; ++i) {
            var x = pComponent.cells[i][0];
            var y = pComponent.cells[i][1];
            if(route.center && MapGen.Layers.Get(route.center, x, y, 0))
                score += 8;
            if(route.core && MapGen.Layers.Get(route.core, x, y, 0))
                score += 4;
            if(layers.path && MapGen.Layers.Get(layers.path, x, y, 0))
                score += 2;
            if(layers.keepClear && MapGen.Layers.Get(layers.keepClear, x, y, 0))
                score += 1;
        }

        return score;
    },

    PrimaryRouteComponentIndex: function(pContext, pComponents) {
        var bestIndex = -1;
        var bestScore = -1;

        if(pContext.Anchors && pContext.Anchors.start) {
            for(var anchorIndex = 0; anchorIndex < pComponents.length; ++anchorIndex) {
                if(this.ComponentContainsPoint(pComponents[anchorIndex], pContext.Anchors.start))
                    return anchorIndex;
            }
        }

        for(var index = 0; index < pComponents.length; ++index) {
            var score = this.RouteComponentScore(pContext, pComponents[index]);
            if(score > bestScore) {
                bestScore = score;
                bestIndex = index;
            }
        }

        return bestIndex >= 0 ? bestIndex : 0;
    },

    ShouldSealOffRouteFragments: function(pContext) {
        var profile = pContext.Profile || {};
        if(profile.RouteSealOffRouteFragments !== undefined)
            return profile.RouteSealOffRouteFragments === true;
        if(!MapGen.Layout || !MapGen.Layout.RouteArchetypes || !MapGen.Layout.RouteArchetypes.Resolve)
            return false;

        var resolved = MapGen.Layout.RouteArchetypes.Resolve(pContext);
        return !!(resolved && resolved.definition && resolved.definition.sealOffRouteFragments);
    },

    SealFragmentAsCover: function(pContext, pFragment) {
        var layers = pContext.Layers || {};
        var sealed = 0;

        for(var i = 0; i < pFragment.cells.length; ++i) {
            var x = pFragment.cells[i][0];
            var y = pFragment.cells[i][1];

            if(MapGen.Layers.Get(layers.occupied, x, y, 0))
                continue;
            if(MapGen.Layers.Get(layers.water, x, y, 0))
                continue;

            MapGen.Layers.Set(layers.path, x, y, 0);
            MapGen.Layers.Set(layers.keepClear, x, y, 0);
            MapGen.Layers.Set(layers.blocked, x, y, 1);
            if(layers.outcrop)
                MapGen.Layers.Set(layers.outcrop, x, y, 0);
            if(layers.owner) {
                var owner = MapGen.Layers.Get(layers.owner, x, y, 0);
                if(owner < MapGen.Layers.Owner.STRUCTURE && owner !== MapGen.Layers.Owner.WATER && owner !== MapGen.Layers.Owner.CLIFF)
                    MapGen.Layers.Set(layers.owner, x, y, MapGen.Layers.Owner.TREE);
            }
            ++sealed;
        }

        return sealed;
    },

    SealOffRouteFragments: function(pContext) {
        if(!this.ShouldSealOffRouteFragments(pContext))
            return false;

        var components = this.LandComponents(pContext);
        if(components.length <= 1)
            return false;

        var mainIndex = this.PrimaryRouteComponentIndex(pContext, components);
        var main = components[mainIndex] || components[0];
        var sealedCells = 0;
        var bridgedFragments = 0;

        for(var index = 0; index < components.length; ++index) {
            if(index === mainIndex)
                continue;

            var component = components[index];
            if(this.ComponentContainsGameplay(pContext, component)) {
                var pair = this.NearestPair(main, component);
                if(pair.from && pair.to) {
                    this.CarveBridge(pContext, pair.from, pair.to);
                    ++bridgedFragments;
                }
                continue;
            }

            sealedCells += this.SealFragmentAsCover(pContext, component);
        }

        if(sealedCells > 0 || bridgedFragments > 0) {
            MapGen.Context.AddLog(
                pContext,
                "Repair sealed off-route fragments: cells " + sealedCells +
                    " bridges " + bridgedFragments
            );
            return true;
        }

        return false;
    },

    NearestPair: function(pComponentA, pComponentB) {
        var bestA = null;
        var bestB = null;
        var bestDistSq = 0x7FFFFFFF;

        for(var i = 0; i < pComponentA.cells.length; ++i) {
            var a = pComponentA.cells[i];
            for(var j = 0; j < pComponentB.cells.length; ++j) {
                var b = pComponentB.cells[j];
                var dx = a[0] - b[0];
                var dy = a[1] - b[1];
                var distSq = (dx * dx) + (dy * dy);
                if(distSq < bestDistSq) {
                    bestDistSq = distSq;
                    bestA = a;
                    bestB = b;
                }
            }
        }

        return { from: bestA, to: bestB, distSq: bestDistSq };
    },

    CarveBridge: function(pContext, pFrom, pTo) {
        // Stamp a 2-tile-wide corridor: clear water + blocked along the line,
        // mark `path` so the cells are walkable, and `keepClear` so subsequent
        // smoothing passes won't refill them.
        var x0 = pFrom[0], y0 = pFrom[1];
        var x1 = pTo[0], y1 = pTo[1];
        var dx = Math.abs(x1 - x0);
        var dy = Math.abs(y1 - y0);
        var sx = x0 < x1 ? 1 : -1;
        var sy = y0 < y1 ? 1 : -1;
        var err = dx - dy;
        var radius = 1;

        while(true) {
            for(var ox = -radius; ox <= radius; ++ox) {
                for(var oy = -radius; oy <= radius; ++oy) {
                    var px = x0 + ox;
                    var py = y0 + oy;
                    if(px < 0 || py < 0 || px >= pContext.Width || py >= pContext.Height) continue;
                    // Cliff body guard ([[mapgen_cliff_edge_to_edge]] Slice 1C).
                    // CarveBridge is the EnforceLandCohesion last-resort bridge
                    // — it would silently demolish a cliff cell if one lay on
                    // its 2-wide swath. Cliff cells stay land; the bridge
                    // routes around them in the next walkability re-validate.
                    if(pContext.Layers.owner &&
                        MapGen.Layers.Get(pContext.Layers.owner, px, py, 0) === MapGen.Layers.Owner.CLIFF)
                        continue;
                    MapGen.Layers.Set(pContext.Layers.water, px, py, 0);
                    MapGen.Layers.Set(pContext.Layers.blocked, px, py, 0);
                    MapGen.Layers.Set(pContext.Layers.path, px, py, 1);
                    MapGen.Layers.Set(pContext.Layers.keepClear, px, py, 1);
                }
            }

            if(x0 === x1 && y0 === y1) break;
            var e2 = 2 * err;
            if(e2 > -dy) { err -= dy; x0 += sx; }
            if(e2 < dx) { err += dx; y0 += sy; }
        }
    },

    EnforceLandCohesion: function(pContext) {
        var profile = pContext.Profile;
        var minFragment = (profile.MinFragmentTiles !== undefined) ? profile.MinFragmentTiles : 12;
        var minMainMass = (profile.MinMainMassFraction !== undefined) ? profile.MinMainMassFraction : 0.55;

        var components = this.LandComponents(pContext);
        if(components.length === 0)
            return false;

        var changed = false;

        // Pass 1: drop fragments under MinFragmentTiles. The biggest component
        // (sorted first) is always kept regardless of size — there's no main
        // mass to compare it against if we removed it.
        for(var i = 1; i < components.length; ++i) {
            var comp = components[i];
            if(comp.size >= minFragment)
                continue;
            // Don't delete a fragment that contains an anchor; bridge to it
            // instead.
            if(this.ContainsAnchor(pContext, comp))
                continue;
            this.FillFragment(pContext, comp, this.FragmentDominantBorder(pContext, comp));
            changed = true;
        }

        // Pass 2: re-flood; if main mass still under threshold OR any anchor
        // sits outside main, carve bridges to absorb fragments until the
        // condition is satisfied. Cap iterations to avoid degenerate loops on
        // pathological maps.
        var iterations = 0;
        while(iterations++ < 8) {
            components = this.LandComponents(pContext);
            if(components.length <= 1)
                break;

            var totalLand = 0;
            for(var c = 0; c < components.length; ++c) totalLand += components[c].size;
            var main = components[0];
            var mainOk = (main.size / totalLand) >= minMainMass;

            // Find first non-main component that either contains an anchor or
            // is needed to push main over the threshold.
            var target = null;
            for(var k = 1; k < components.length; ++k) {
                if(this.ContainsAnchor(pContext, components[k])) { target = components[k]; break; }
            }
            if(!target && !mainOk)
                target = components[1];
            if(!target)
                break;

            var pair = this.NearestPair(main, target);
            if(!pair.from || !pair.to)
                break;
            this.CarveBridge(pContext, pair.from, pair.to);
            changed = true;
        }

        if(changed)
            MapGen.Context.AddLog(pContext, "Repair enforced land cohesion");

        return changed;
    },

    ClearPlacementApproaches: function(pContext) {
        var groups = [
            pContext.Placements.players || [],
            pContext.Placements.teams || [],
            pContext.Placements.enemies || [],
            pContext.Placements.objectives || [],
            pContext.Placements.structures || [],
            pContext.Placements.pickups || []
        ];

        for(var groupIndex = 0; groupIndex < groups.length; ++groupIndex) {
            var group = groups[groupIndex];

            for(var index = 0; index < group.length; ++index) {
                var placement = group[index];
                if(!placement.point)
                    continue;

                var radius = (placement.radius || 1) + (placement.approach || 1);
                this.ClearDisc(pContext.Layers.blocked, placement.point, radius);
                this.StampRouteDisc(pContext, placement.point.x, placement.point.y, radius);
            }
        }

        MapGen.Context.AddLog(pContext, "Repair cleared placement approaches");
    },

    NeedsRouteConstrictionRepair: function(pReport) {
        var reasons = pReport ? pReport.reasons || [] : [];

        return this.HasKey(reasons, "route_neck_fraction_too_low") ||
            this.HasKey(reasons, "route_neck_run_too_short") ||
            this.HasKey(reasons, "route_median_width_too_high") ||
            this.HasKey(reasons, "final_route_neck_fraction_too_low") ||
            this.HasKey(reasons, "final_route_neck_run_too_short") ||
            this.HasKey(reasons, "final_route_median_width_too_high");
    },

    ConstrictActualRoute: function(pContext) {
        if(!MapGen.Layout || !MapGen.Layout.RouteArchetypes ||
            !MapGen.Layout.RouteArchetypes.ApplyActualRouteGateCover)
            return false;

        var resolved = MapGen.Layout.RouteArchetypes.Resolve(pContext);
        if(!resolved || resolved.name !== "neck")
            return false;

        var result = MapGen.Layout.RouteArchetypes.ApplyActualRouteGateCover(
            pContext,
            pContext.TacticalRoutePath || []
        );
        if(!result || (!result.stamped && !result.sideStamped && !result.protectedCells))
            return false;

        MapGen.Context.AddLog(
            pContext,
            "Repair constricted actual route: cover " + (result.stamped || 0) +
                " side " + (result.sideStamped || 0) +
                " gates " + (result.gates || 0)
        );
        return true;
    },

    RequestPlacementConnectivityRepair: function(pContext) {
        if(!MapGen.Connectivity || !MapGen.Connectivity.BuildPlacementNodes)
            return false;

        MapGen.Context.AddLog(pContext, "Repair rerouted placement connectivity");
        return true;
    },

    Run: function(pContext, pReport) {
        var report = pReport || pContext.Validation;
        var repaired = false;

        if(!report || report.ok)
            return false;
        pContext.RepairCoverOnly = false;
        if(MapGen.Context.Time(pContext, "Repair.PlacementConnections", function() {
            return MapGen.Layout.RepairPlacementConnections(pContext, report);
        })) repaired = true;

        if(this.HasKey(report.reasons, "critical_points_disconnected") ||
            this.HasKey(report.reasons, "walkable_space_split") ||
            this.HasKey(report.warnings, "largest_walkable_component_low") ||
            this.HasKey(report.reasons, "land_too_fragmented")) {
            var fragmented = this.HasKey(report.reasons, "walkable_space_split") ||
                this.HasKey(report.reasons, "land_too_fragmented");
            if(fragmented && !this.SealOffRouteFragments(pContext))
                this.EnforceLandCohesion(pContext);
            this.ConnectCriticalPoints(pContext);
            repaired = true;
        }

        if(this.HasKey(report.reasons, "river_without_crossing")) {
            this.EnsureRiverCrossings(pContext);
            repaired = true;
        }

        if(this.HasKey(report.reasons, "river_crossing_bridge_missing")) {
            this.EnsureRiverCrossings(pContext);
            if(MapGen.Terrain && MapGen.Terrain.RefreshDerivedLayers)
                MapGen.Terrain.RefreshDerivedLayers(pContext);
            if(MapGen.Features && MapGen.Features.Bridges &&
                MapGen.Features.Bridges.Build)
                MapGen.Features.Bridges.Build(pContext);
            repaired = true;
        }

        if(this.HasKey(report.reasons, "crossing_not_near_route")) {
            this.MoveCrossingsOntoRoutes(pContext);
            repaired = true;
        }

        if(this.HasKey(report.reasons, "water_coverage_too_high") ||
            this.HasKey(report.reasons, "small_map_water_too_high")) {
            this.TrimWaterCoverage(pContext);
            repaired = true;
        }

        if(this.HasKey(report.reasons, "placement_not_walkable") ||
            this.HasKey(report.reasons, "critical_points_disconnected")) {
            this.ClearCriticalPoints(pContext);
            repaired = true;
        }

        if(this.HasKey(report.reasons, "placement_approach_blocked")) {
            this.ClearPlacementApproaches(pContext);
            repaired = true;
        }

        if(this.HasKey(report.reasons, "connectivity_node_unreachable") ||
            this.HasKey(report.reasons, "connectivity_node_no_access") ||
            this.HasKey(report.reasons, "connectivity_nodes_missing")) {
            if(this.RequestPlacementConnectivityRepair(pContext))
                repaired = true;
        }

        if(this.NeedsRouteConstrictionRepair(report)) {
            if(this.ConstrictActualRoute(pContext))
                repaired = true;
        }

        if(this.HasKey(report.reasons, "tree_coverage_too_high")) {
            this.ThinTreesToTarget(pContext);
            repaired = true;
        }

        if(this.HasKey(report.reasons, "tree_coverage_too_low")) {
            // Adding cover changes no water or placement-derived state. A
            // global refresh would smooth away the repair before rendering.
            pContext.RepairCoverOnly = !repaired;
            this.GrowTreesToTarget(pContext);
            repaired = true;
        }

        if(MapGen.Context.Time(pContext, "Repair.RouteCover", function() {
            return MapGen.Terrain.RouteCoverRepair.Run(pContext, report);
        })) {
            pContext.RepairCoverOnly = pContext.RepairCoverOnly || !repaired;
            repaired = true;
        }

        return repaired;
    }
};
