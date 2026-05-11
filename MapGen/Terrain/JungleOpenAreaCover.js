var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Cover = MapGen.Terrain.Cover || {};

(function(pJungle) {
    pJungle.SupportsOpenAreaBreakup = function(pContext) {
        if(!this.SupportsTacticalCover(pContext))
            return false;
        if(pContext.Profile.OpenAreaBreakup === false)
            return false;

        return true;
    };

    pJungle.OpenAreaMaxTiles = function(pContext) {
        var profile = pContext.Profile || {};
        var area = pContext.Width * pContext.Height;
        var explicitTiles = Number(profile.MaxOpenAreaTiles || 0);
        var fraction = Number(profile.MaxOpenAreaFraction);

        if(isNaN(fraction) || fraction <= 0)
            fraction = 0.05;

        var minTiles = Number(profile.MinOpenAreaTiles || 96);
        if(isNaN(minTiles) || minTiles <= 0)
            minTiles = 96;

        return Math.max(Math.floor(minTiles), Math.floor(explicitTiles > 0 ? explicitTiles : area * fraction));
    };

    pJungle.OpenAreaChunkTiles = function(pContext) {
        var chunk = Number((pContext.Profile || {}).OpenAreaBreakupChunkTiles || 0);

        if(isNaN(chunk) || chunk <= 0)
            chunk = Math.max(120, Math.floor(this.OpenAreaMaxTiles(pContext) * 0.35));

        return chunk;
    };

    pJungle.OpenAreaCell = function(pContext, pX, pY, pOptions) {
        if(!this.CanStampTacticalCover(pContext, pX, pY, pOptions))
            return false;
        if(MapGen.Layers.Get(pContext.Layers.blocked, pX, pY, 0))
            return false;

        return true;
    };

    // Per-cell bitmap of `CanStampTacticalCover` (ignoring the blocked layer,
    // which mutates during a stamping pass). Inputs to CanStampTacticalCover
    // are otherwise stable during ApplyPostPlacementOpenAreaBreakup's loop, so
    // we can compute this bitmap once at the start and AND it with the current
    // `blocked` state in CollectOpenAreas instead of re-running the ~10
    // Layer.Get predicate stack per cell per pass.
    //
    // Caller is expected to pass the SAME pOptions reference across calls in a
    // single breakup loop; the cache is keyed by reference so each new options
    // object rebuilds. Invalidated lazily — callers either rebuild via reference
    // change or reset pContext._canStampStaticBitmap to drop it.
    pJungle.CanStampStaticBitmap = function(pContext, pOptions) {
        var cache = pContext._canStampStaticBitmap;
        if(cache && cache.options === pOptions)
            return cache.map;

        var width = pContext.Width;
        var height = pContext.Height;
        var map = new Array(height);
        for(var y = 0; y < height; ++y) {
            var row = new Array(width);
            for(var x = 0; x < width; ++x)
                row[x] = this.CanStampTacticalCover(pContext, x, y, pOptions) ? 1 : 0;
            map[y] = row;
        }

        pContext._canStampStaticBitmap = { options: pOptions, map: map };
        return map;
    };

    pJungle.CollectOpenAreas = function(pContext, pOptions) {
        var width = pContext.Width;
        var height = pContext.Height;
        // Precompute a per-cell "is open" bitmap so the BFS expansion below
        // does single-array reads instead of running OpenAreaCell ->
        // CanStampTacticalCover's ~10 Layer.Gets PER cell tested. CollectOpen
        // Areas runs up to 3x per ApplyPostPlacementOpenAreaBreakup call and
        // the BFS visits every cell, so an upfront W*H pass that flattens the
        // predicate stack is a clear win even before the BFS savings.
        //
        // CanStampTacticalCover's inputs are STATIC across the open-area-
        // breakup loop (paths, critical points, placements, keepClear / water
        // / coast / riverBank etc. don't mutate). Only `blocked` mutates as
        // BreakOpenArea stamps trees. So we cache the heavy predicate by an
        // identity key derived from pOptions, and per-pass we just AND in the
        // current `blocked` layer per cell. If the caller passes a custom
        // pOptions object that's reference-different per call, we fall back to
        // recomputing — no semantic change.
        var staticMap = this.CanStampStaticBitmap(pContext, pOptions);
        var blockedLayer = pContext.Layers.blocked;
        var openMap = new Array(height);
        for(var py = 0; py < height; ++py) {
            var openRow = new Array(width);
            var staticRow = staticMap ? staticMap[py] : null;
            // Layers are column-major (Layers.Create allocates [x][y]); read
            // each cell's blocked value directly rather than slicing a row.
            for(var px = 0; px < width; ++px) {
                if(staticRow) {
                    if(!staticRow[px])
                        openRow[px] = 0;
                    else
                        openRow[px] = MapGen.Layers.Get(blockedLayer, px, py, 0) ? 0 : 1;
                } else {
                    openRow[px] = this.OpenAreaCell(pContext, px, py, pOptions) ? 1 : 0;
                }
            }
            openMap[py] = openRow;
        }

        var visited = MapGen.Layers.Create(width, height, 0);
        var areas = [];
        var directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];

        for(var startX = 0; startX < width; ++startX) {
            for(var startY = 0; startY < height; ++startY) {
                if(visited[startX][startY])
                    continue;
                if(!openMap[startY][startX]) {
                    visited[startX][startY] = 1;
                    continue;
                }

                var queue = [{ x: startX, y: startY }];
                var queueHead = 0;
                var cells = [];
                var minX = startX;
                var maxX = startX;
                var minY = startY;
                var maxY = startY;

                visited[startX][startY] = 1;
                while(queueHead < queue.length) {
                    var current = queue[queueHead++];
                    cells.push(current);
                    if(current.x < minX) minX = current.x;
                    if(current.x > maxX) maxX = current.x;
                    if(current.y < minY) minY = current.y;
                    if(current.y > maxY) maxY = current.y;

                    for(var directionIndex = 0; directionIndex < directions.length; ++directionIndex) {
                        var nx = current.x + directions[directionIndex][0];
                        var ny = current.y + directions[directionIndex][1];
                        if(nx < 0 || ny < 0 || nx >= width || ny >= height)
                            continue;
                        if(visited[nx][ny])
                            continue;
                        visited[nx][ny] = 1;
                        if(openMap[ny][nx])
                            queue.push({ x: nx, y: ny });
                    }
                }

                areas.push({
                    cells: cells,
                    size: cells.length,
                    bounds: { minX: minX, minY: minY, maxX: maxX, maxY: maxY },
                    center: {
                        x: Math.round((minX + maxX) / 2),
                        y: Math.round((minY + maxY) / 2)
                    }
                });
            }
        }

        areas.sort(function(pLeft, pRight) {
            if(pLeft.size !== pRight.size)
                return pRight.size - pLeft.size;
            // Total-order tiebreak on the (unique) area center so equal-size
            // open areas keep a deterministic order (engine sort is unstable).
            if(pLeft.center.x !== pRight.center.x)
                return pLeft.center.x - pRight.center.x;
            return pLeft.center.y - pRight.center.y;
        });
        // Stash the openMap bitmap on the context so OpenAreaCandidateScore's
        // radius-4 neighborhood scan can SAT-query it instead of re-running
        // OpenAreaCell -> CanStampTacticalCover ~80 times per scored cell. The
        // bitmap is valid until the next CollectOpenAreas / stamping pass
        // mutates `blocked`; SelectOpenAreaCenters runs to completion before
        // any stamping in BreakOpenArea, so the map is consistent throughout
        // a single scoring sweep.
        pContext._postOpenAreaOpenMap = openMap;
        pContext._postOpenAreaOpenMapSAT = null;
        return areas;
    };

    pJungle.RefreshPostOpenAreaOpenMap = function(pContext, pOptions) {
        var width = pContext.Width;
        var height = pContext.Height;
        var staticMap = this.CanStampStaticBitmap(pContext, pOptions);
        var blockedLayer = pContext.Layers.blocked;
        var openMap = new Array(height);
        for(var y = 0; y < height; ++y) {
            var row = new Array(width);
            var staticRow = staticMap ? staticMap[y] : null;
            for(var x = 0; x < width; ++x) {
                if(staticRow) {
                    if(!staticRow[x])
                        row[x] = 0;
                    else
                        row[x] = MapGen.Layers.Get(blockedLayer, x, y, 0) ? 0 : 1;
                } else {
                    row[x] = this.OpenAreaCell(pContext, x, y, pOptions) ? 1 : 0;
                }
            }
            openMap[y] = row;
        }
        pContext._postOpenAreaOpenMap = openMap;
        pContext._postOpenAreaOpenMapSAT = null;
    };

    pJungle.PostOpenAreaOpenMapSAT = function(pContext) {
        if(pContext._postOpenAreaOpenMapSAT)
            return pContext._postOpenAreaOpenMapSAT;
        var openMap = pContext._postOpenAreaOpenMap;
        if(!openMap)
            return null;
        var width = pContext.Width;
        var height = pContext.Height;
        var sat = new Array(height + 1);
        sat[0] = new Array(width + 1);
        for(var fillX = 0; fillX <= width; ++fillX)
            sat[0][fillX] = 0;
        for(var y = 1; y <= height; ++y) {
            var row = new Array(width + 1);
            row[0] = 0;
            var prevRow = sat[y - 1];
            var openRow = openMap[y - 1];
            var rowSum = 0;
            for(var x = 1; x <= width; ++x) {
                rowSum += openRow[x - 1];
                row[x] = prevRow[x] + rowSum;
            }
            sat[y] = row;
        }
        pContext._postOpenAreaOpenMapSAT = sat;
        return sat;
    };

    pJungle.PostOpenAreaOpenMapSATSum = function(pContext, pMinX, pMinY, pMaxX, pMaxY) {
        var sat = this.PostOpenAreaOpenMapSAT(pContext);
        if(!sat)
            return -1;
        var width = pContext.Width;
        var height = pContext.Height;
        // Match OpenAreaCandidateScore's original behaviour for OOB cells: the
        // legacy code called OpenAreaCell out of bounds, which falls through
        // to InBounds=false in CanStampTacticalCover and returns false (i.e.
        // not counted as open). Clamp the SAT range to the map and treat
        // OOB cells as zeros — same total.
        var x0 = pMinX < 0 ? 0 : pMinX;
        var y0 = pMinY < 0 ? 0 : pMinY;
        var x1 = pMaxX >= width ? width - 1 : pMaxX;
        var y1 = pMaxY >= height ? height - 1 : pMaxY;
        if(x1 < x0 || y1 < y0)
            return 0;
        return sat[y1 + 1][x1 + 1] - sat[y0][x1 + 1] - sat[y1 + 1][x0] + sat[y0][x0];
    };

    pJungle.ProtectedNearby = function(pContext, pX, pY, pRadius, pOptions) {
        var options = pOptions || {};
        var allowKeepClear = !!options.allowKeepClear;

        for(var x = pX - pRadius; x <= pX + pRadius; ++x) {
            for(var y = pY - pRadius; y <= pY + pRadius; ++y) {
                if(!MapGen.Layers.InBounds(pContext.Layers.blocked, x, y))
                    return true;
                if(MapGen.Layers.Get(pContext.Layers.path, x, y, 0) && !options.allowNearPath)
                    return true;
                if(options.allowPath && this.PathCenterNearby(pContext, x, y, options.pathCenterClearance || 2))
                    return true;
                if(MapGen.Layers.Get(pContext.Layers.occupied, x, y, 0) ||
                    MapGen.Layers.Get(pContext.Layers.water, x, y, 0) ||
                    MapGen.Layers.Get(pContext.Layers.coast, x, y, 0) ||
                    MapGen.Layers.Get(pContext.Layers.riverBank, x, y, 0) ||
                    MapGen.Layers.Get(pContext.Layers.crossing, x, y, 0) ||
                    MapGen.Layers.Get(pContext.Layers.causeway, x, y, 0)) {
                    return true;
                }
                if(MapGen.Layers.Get(pContext.Layers.keepClear, x, y, 0) && !allowKeepClear)
                    return true;
                if(allowKeepClear && this.CriticalNearby(pContext, x, y, options.criticalClearance || 3))
                    return true;
                if(allowKeepClear && this.PlacementNearby(pContext, x, y, options.placementClearance || 3))
                    return true;
            }
        }

        return false;
    };

    pJungle.PostCoverClearingRole = function(pRole) {
        return pRole === "route_rest" ||
            pRole === "route_clearing" ||
            pRole === "flank" ||
            pRole === "ambush_pocket" ||
            pRole === "open_space" ||
            pRole === "objective" ||
            pRole === "contested" ||
            pRole === "support";
    };

    pJungle.PostCoverClearingBaseCount = function(pRole) {
        if(pRole === "contested" || pRole === "objective")
            return 4;
        if(pRole === "ambush_pocket" || pRole === "flank")
            return 2;
        if(pRole === "route_clearing" || pRole === "support")
            return 2;
        return 1;
    };

    pJungle.ApplyClearingPostPlacementCover = function(pContext, pDensity) {
        var shaped = { clusters: 0, stamped: 0 };
        var clearings = pContext.Clearings || [];
        var options = { allowKeepClear: true, criticalClearance: 4, placementClearance: 3 };

        if(pDensity <= 0)
            return shaped;

        for(var index = 0; index < clearings.length; ++index) {
            var clearing = clearings[index];
            if(!this.PostCoverClearingRole(clearing.role || ""))
                continue;

            var role = clearing.role || "";
            var count = Math.max(1, Math.round(this.PostCoverClearingBaseCount(role) * pDensity));
            var ring = Math.max(3, Math.floor((clearing.radius || 3) * (role === "contested" || role === "objective" ? 0.65 : 0.55)));

            for(var coverIndex = 0; coverIndex < count; ++coverIndex) {
                var angle = ((MapGen.Random.HashTile(pContext.Seed, clearing.x + coverIndex, clearing.y, 941 + index) % 6283) / 1000);
                var point = {
                    x: Math.round(clearing.x + Math.cos(angle) * ring),
                    y: Math.round(clearing.y + Math.sin(angle) * ring)
                };
                var useScreen = this.HashUnit(pContext, point.x, point.y, 947 + coverIndex) < 0.65;
                var stamped = 0;

                if(useScreen) {
                    var length = Math.max(4, Math.min((clearing.radius || 3) * 2, this.RangeValue(pContext, "PostPlacementCoverLength", 5, 10, point.x, point.y, 953 + coverIndex)));
                    stamped = this.StampTacticalCoverScreen(
                        pContext,
                        point,
                        angle + (Math.PI * 0.5),
                        length,
                        1,
                        149 + index + coverIndex,
                        options
                    );
                } else {
                    stamped = this.StampTacticalCoverDisc(
                        pContext,
                        point,
                        1 + (MapGen.Random.HashTile(pContext.Seed, point.x, point.y, 957) % 2),
                        151 + index + coverIndex,
                        options
                    );
                }

                if(stamped) {
                    ++shaped.clusters;
                    shaped.stamped += stamped;
                }
            }
        }

        return shaped;
    };

    pJungle.RouteSiteCoverTarget = function(pContext, pSite) {
        var profile = pContext.Profile || {};
        var key = pSite.kind === "structure" ?
            "RouteStructureCoverTarget" :
            "RoutePickupCoverTarget";
        var fallback = pSite.kind === "structure" ? 16 : 0;
        var value = Number(profile[key]);

        if(isNaN(value))
            value = fallback;

        return Math.max(0, Math.floor(value));
    };

    pJungle.RouteSiteCoverRadius = function(pSite) {
        return pSite.kind === "structure" ? 6 : 4;
    };

    pJungle.RouteSiteCoverPoint = function(pContext, pSite, pIndex, pCluster) {
        var point = pSite.point;
        var anchor = pSite.routeAnchor || point;
        var dx = point.x - anchor.x;
        var dy = point.y - anchor.y;
        var length = Math.max(1, Math.sqrt((dx * dx) + (dy * dy)));
        var sideX = dx / length;
        var sideY = dy / length;
        var perpX = -sideY;
        var perpY = sideX;
        var baseDistance = pSite.kind === "structure" ? 5 : 3;
        var side = (pCluster % 2) === 0 ? 1 : -1;
        var jitter = (this.HashUnit(pContext, point.x + pCluster, point.y, 967 + pIndex) - 0.5) * 1.8;

        return {
            x: Math.round(point.x + (sideX * baseDistance) + (perpX * side * (2 + pCluster)) + jitter),
            y: Math.round(point.y + (sideY * baseDistance) + (perpY * side * (2 + pCluster)) - jitter)
        };
    };

    pJungle.RouteSiteCoverAngle = function(pSite) {
        var point = pSite.point;
        var anchor = pSite.routeAnchor || point;
        var dx = point.x - anchor.x;
        var dy = point.y - anchor.y;

        return Math.atan2(dy, dx) + (Math.PI * 0.5);
    };

    pJungle.ApplyRouteSitePostPlacementCover = function(pContext, pDensity) {
        var shaped = { sites: 0, clusters: 0, stamped: 0, lowCoverSites: 0 };
        var sites = pContext.PlannedSites || [];

        if(pDensity <= 0)
            return shaped;

        for(var index = 0; index < sites.length; ++index) {
            var site = sites[index];
            if(!site || !site.routePlanned || !site.point)
                continue;
            if(site.kind !== "structure" && site.kind !== "pickup")
                continue;

            ++shaped.sites;

            var radius = this.RouteSiteCoverRadius(site);
            var cover = this.CountTacticalCoverAround(pContext, site.point, radius);
            var target = Math.round(this.RouteSiteCoverTarget(pContext, site) * pDensity);

            if(cover >= target)
                continue;

            ++shaped.lowCoverSites;
            var deficit = target - cover;
            var clusters = Math.min(site.kind === "structure" ? 3 : 2, Math.max(1, Math.ceil(deficit / 7)));
            var options = {
                allowKeepClear: true,
                criticalClearance: 5,
                placementClearance: site.kind === "structure" ? 3 : 2
            };

            for(var cluster = 0; cluster < clusters; ++cluster) {
                var center = this.RouteSiteCoverPoint(pContext, site, index, cluster);
                var angle = this.RouteSiteCoverAngle(site) +
                    ((this.HashUnit(pContext, center.x, center.y, 971 + cluster) - 0.5) * 0.65);
                var stamped = 0;

                if(site.kind === "structure") {
                    stamped = this.StampTacticalCoverScreen(
                        pContext,
                        center,
                        angle,
                        6 + (MapGen.Random.HashTile(pContext.Seed, center.x, center.y, 977 + cluster) % 4),
                        1,
                        163 + index + cluster,
                        options
                    );
                } else {
                    stamped = this.StampTacticalCoverDisc(
                        pContext,
                        center,
                        1 + (MapGen.Random.HashTile(pContext.Seed, center.x, center.y, 981 + cluster) % 2),
                        167 + index + cluster,
                        options
                    );
                }

                if(stamped) {
                    ++shaped.clusters;
                    shaped.stamped += stamped;
                }
            }
        }

        return shaped;
    };

    pJungle.ApplyPostPlacementCover = function(pContext) {
        // The source template already contains the authored relationship
        // between corridors, clearings and dense cover. Adding the generic
        // post-placement scatter here erases that relationship and makes
        // different originals converge on the same generated silhouette.
        if(pContext && pContext.OriginalTerrainTemplate)
            return;
        if(!this.SupportsTacticalCover(pContext))
            return;
        if((pContext.Profile || {}).PostPlacementCover === false)
            return;

        var scale = Number((pContext.Profile || {}).PostPlacementCoverDensity);
        if(isNaN(scale) || scale <= 0)
            scale = 0.65;

        var self = this;
        var profileTime = pContext && pContext.ProfileTimings && MapGen.Context && MapGen.Context.Time;
        var subTime = function(label, fn) {
            return profileTime ? MapGen.Context.Time(pContext, label, fn) : fn();
        };

        var density = this.TacticalCoverDensity(pContext) * scale;
        var routeEdges = subTime("PostPlacementCover.RouteEdges", function() {
            return self.ApplyRouteEdgeCover(
                pContext,
                density,
                { allowKeepClear: true, criticalClearance: 5, placementClearance: 4 },
                0.70
            );
        });
        var routeExposure = subTime("PostPlacementCover.RouteExposure", function() {
            return self.ApplyRouteExposureBreakup(pContext, density);
        });
        var clearings = subTime("PostPlacementCover.Clearings", function() {
            return self.ApplyClearingPostPlacementCover(pContext, density);
        });
        var routeSites = subTime("PostPlacementCover.RouteSites", function() {
            return self.ApplyRouteSitePostPlacementCover(pContext, density);
        });
        var openAreas = subTime("PostPlacementCover.OpenAreas", function() {
            return self.ApplyPostPlacementOpenAreaBreakup(pContext, density);
        });
        var fieldScreens = subTime("PostPlacementCover.FieldScreens", function() {
            return self.ApplyOpenFieldScreens(pContext, density);
        });
        var stamped = routeEdges.stamped + routeExposure.stamped + clearings.stamped +
            routeSites.stamped + openAreas.stamped + fieldScreens.stamped;

        pContext.PostPlacementCover = {
            routeEdgeRibbons: routeEdges.ribbons,
            routeExposureBreakup: routeExposure,
            clearingClusters: clearings.clusters,
            routeSiteCover: routeSites,
            openAreaBreakup: openAreas,
            openFieldScreens: fieldScreens,
            stamped: stamped
        };

        if(stamped) {
            MapGen.Context.AddLog(
                pContext,
                "Applied post-placement tactical cover (" +
                    (routeEdges.ribbons + routeExposure.screens + routeExposure.islands +
                        clearings.clusters + routeSites.clusters +
                        openAreas.islands + openAreas.screens +
                        fieldScreens.screens + fieldScreens.islands) +
                    " clusters, " + stamped + " tiles)"
            );
        }
    };

    pJungle.OpenAreaCandidateScore = function(pContext, pCell, pAreaIndex, pOptions, pProtected) {
        var radius = 4;

        var protectedNearby = pProtected ?
            (pCell.x < 2 || pCell.y < 2 || pCell.x >= pContext.Width - 2 ||
                pCell.y >= pContext.Height - 2 || MapGen.Integration.StructureSATSum(
                    pProtected, pContext.Width, pContext.Height,
                    pCell.x - 2, pCell.y - 2, pCell.x + 2, pCell.y + 2) > 0) :
            this.ProtectedNearby(pContext, pCell.x, pCell.y, 2, pOptions);
        if(protectedNearby)
            return -1;

        // Hot path: the radius-4 box (81 cells) was being scored cell-by-cell
        // through OpenAreaCell -> CanStampTacticalCover (~10 layer reads each).
        // CollectOpenAreas already built the openMap bitmap with identical
        // predicates; SAT-query it for an O(1) sum. The cell-loop fallback
        // stays for ad-hoc callers outside the breakup pass.
        var sat = this.PostOpenAreaOpenMapSAT(pContext);
        var open;
        if(sat) {
            open = this.PostOpenAreaOpenMapSATSum(pContext, pCell.x - radius, pCell.y - radius, pCell.x + radius, pCell.y + radius);
        } else {
            open = 0;
            for(var x = pCell.x - radius; x <= pCell.x + radius; ++x) {
                for(var y = pCell.y - radius; y <= pCell.y + radius; ++y) {
                    if(this.OpenAreaCell(pContext, x, y, pOptions))
                        ++open;
                }
            }
        }

        return open + (this.HashUnit(pContext, pCell.x, pCell.y, 811 + pAreaIndex) * 12);
    };

    pJungle.SelectOpenAreaCenters = function(pContext, pArea, pAreaIndex, pCount, pOptions) {
        var candidates = [];
        var centers = [];
        var minSpacingSq = 49;

        // Protection is immutable while selecting centers. Evaluate each cell
        // once, then query the same 5x5 neighbourhood with a summed-area table.
        // Small areas retain the direct scan to avoid a whole-map setup cost.
        var protectedSAT = null;
        if(pArea.cells.length * 25 > pContext.Width * pContext.Height) {
            var protectedRows = [];
            for(var y = 0; y < pContext.Height; ++y) {
                var row = [];
                for(var x = 0; x < pContext.Width; ++x)
                    row.push(this.ProtectedNearby(pContext, x, y, 0, pOptions) ? 1 : 0);
                protectedRows.push(row);
            }
            protectedSAT = MapGen.Integration.BuildStructureSAT(
                protectedRows, pContext.Width, pContext.Height);
        }

        for(var index = 0; index < pArea.cells.length; ++index) {
            var cell = pArea.cells[index];
            var score = this.OpenAreaCandidateScore(pContext, cell, pAreaIndex, pOptions, protectedSAT);
            if(score < 0)
                continue;

            candidates.push({
                point: cell,
                score: score
            });
        }

        candidates.sort(function(pLeft, pRight) {
            if(pLeft.score !== pRight.score)
                return pRight.score - pLeft.score;
            // Total-order tiebreak on the (unique) candidate cell so equal
            // scores keep a deterministic order (engine sort is unstable).
            if(pLeft.point.x !== pRight.point.x)
                return pLeft.point.x - pRight.point.x;
            return pLeft.point.y - pRight.point.y;
        });

        for(var candidateIndex = 0; candidateIndex < candidates.length && centers.length < pCount; ++candidateIndex) {
            var point = candidates[candidateIndex].point;
            var ok = true;

            for(var centerIndex = 0; centerIndex < centers.length; ++centerIndex) {
                var dx = centers[centerIndex].x - point.x;
                var dy = centers[centerIndex].y - point.y;
                if((dx * dx) + (dy * dy) < minSpacingSq) {
                    ok = false;
                    break;
                }
            }

            if(ok)
                centers.push({ x: point.x, y: point.y });
        }

        return centers;
    };

    pJungle.OpenAreaScreenAngle = function(pContext, pArea, pAreaIndex, pCenter) {
        var width = pArea.bounds.maxX - pArea.bounds.minX + 1;
        var height = pArea.bounds.maxY - pArea.bounds.minY + 1;
        var base = width >= height ? Math.PI / 2 : 0;
        var jitter = (this.HashUnit(pContext, pCenter.x, pCenter.y, 863 + pAreaIndex) - 0.5) * 0.75;

        return base + jitter;
    };

    pJungle.OpenAreaScreenLength = function(pContext, pArea, pAreaIndex, pCenter, pAngle) {
        var value = (pContext.Profile || {}).OpenAreaBreakupScreenLength || [8, 16];
        var min = 8;
        var max = 16;
        var width = pArea.bounds.maxX - pArea.bounds.minX + 1;
        var height = pArea.bounds.maxY - pArea.bounds.minY + 1;
        var axisLimit = Math.abs(Math.cos(pAngle)) >= Math.abs(Math.sin(pAngle)) ? width : height;
        var limit = Math.max(4, axisLimit - 4);

        if(value instanceof Array && value.length >= 2) {
            min = Number(value[0]);
            max = Number(value[1]);
        } else {
            min = Number(value);
            max = min;
        }

        if(isNaN(min) || min <= 0)
            min = 8;
        if(isNaN(max) || max < min)
            max = min;

        var roll = this.HashUnit(pContext, pCenter.x, pCenter.y, 877 + pAreaIndex);
        var length = Math.round(min + ((max - min) * roll));

        return Math.max(4, Math.min(limit, length));
    };

    pJungle.OpenAreaScreenThickness = function(pContext, pAreaIndex, pCenter) {
        var value = (pContext.Profile || {}).OpenAreaBreakupScreenThickness || 1;
        var min = 1;
        var max = 1;

        if(value instanceof Array && value.length >= 2) {
            min = Number(value[0]);
            max = Number(value[1]);
        } else {
            min = Number(value);
            max = min;
        }

        if(isNaN(min) || min <= 0)
            min = 1;
        if(isNaN(max) || max < min)
            max = min;

        return Math.max(1, Math.round(min + ((max - min) * this.HashUnit(pContext, pCenter.x, pCenter.y, 881 + pAreaIndex))));
    };

    pJungle.BreakOpenArea = function(pContext, pArea, pAreaIndex, pMaxTiles, pChunkTiles, pOptions, pReuseFreshOpenMap) {
        var options = pOptions || {};
        var profile = pContext.Profile || {};
        var excess = Math.max(0, pArea.size - pMaxTiles);
        var maxIslands = Math.max(1, Math.floor(options.maxIslands !== undefined ? options.maxIslands : (profile.MaxOpenAreaBreakupIslands || 18)));
        var maxScreens = Math.max(0, Math.floor(options.maxScreens !== undefined ? options.maxScreens : (profile.MaxOpenAreaBreakupScreens || 4)));
        var islandCount = Math.min(maxIslands, Math.max(1, Math.ceil(excess / pChunkTiles)));
        var screenCount = Math.min(maxScreens, Math.max(0, Math.floor(excess / Math.max(1, pChunkTiles * 2))));
        // The first oversized area in a post-placement sweep can reuse the
        // fresh open map produced by CollectOpenAreas. Later areas refresh
        // after an earlier stamp may have changed blocked cells outside that
        // earlier component. The legacy breakup path does not pass the reuse
        // flag and retains its original refresh behavior.
        if(!pReuseFreshOpenMap)
            this.RefreshPostOpenAreaOpenMap(pContext, options);
        var centers = this.SelectOpenAreaCenters(pContext, pArea, pAreaIndex, islandCount + screenCount, pOptions);
        var result = { islands: 0, screens: 0, stamped: 0 };

        for(var index = 0; index < centers.length; ++index) {
            var stamped;

            if(index < screenCount) {
                var angle = this.OpenAreaScreenAngle(pContext, pArea, pAreaIndex, centers[index]);
                var length = this.OpenAreaScreenLength(pContext, pArea, pAreaIndex, centers[index], angle);
                var thickness = this.OpenAreaScreenThickness(pContext, pAreaIndex, centers[index]);
                stamped = this.StampTacticalCoverScreen(pContext, centers[index], angle, length, thickness, 103 + pAreaIndex + index, pOptions);

                if(stamped) {
                    ++result.screens;
                    result.stamped += stamped;
                }
                continue;
            }

            var radius = 2 + (MapGen.Random.HashTile(pContext.Seed, centers[index].x, centers[index].y, 827) % 3);
            stamped = this.StampTacticalCoverDisc(pContext, centers[index], radius, 101 + pAreaIndex + index, pOptions);

            if(stamped) {
                ++result.islands;
                result.stamped += stamped;
            }
        }

        return result;
    };

    pJungle.PostOpenAreaMaxTiles = function(pContext) {
        var profile = pContext.Profile || {};
        var area = pContext.Width * pContext.Height;
        var explicitTiles = Number(profile.PostMaxOpenAreaTiles || 0);
        var fraction = Number(profile.PostMaxOpenAreaFraction);

        if(isNaN(fraction) || fraction <= 0)
            fraction = Math.max(0.012, Number(profile.MaxOpenAreaFraction || 0.02) * 0.70);

        var minTiles = Number(profile.PostMinOpenAreaTiles || 0);
        if(isNaN(minTiles) || minTiles <= 0)
            minTiles = Math.max(48, Math.floor(this.OpenAreaMaxTiles(pContext) * 0.65));

        return Math.max(Math.floor(minTiles), Math.floor(explicitTiles > 0 ? explicitTiles : area * fraction));
    };

    pJungle.PostOpenAreaChunkTiles = function(pContext) {
        var chunk = Number((pContext.Profile || {}).PostOpenAreaBreakupChunkTiles || 0);

        if(isNaN(chunk) || chunk <= 0)
            chunk = Math.max(28, Math.floor(this.OpenAreaChunkTiles(pContext) * 0.65));

        return chunk;
    };

    pJungle.ApplyPostPlacementOpenAreaBreakup = function(pContext, pDensity) {
        if(!this.SupportsOpenAreaBreakup(pContext))
            return { passes: 0, largestBefore: 0, largestAfter: 0, regionsOverLimit: 0, islands: 0, screens: 0, stamped: 0 };
        if((pContext.Profile || {}).PostPlacementOpenAreaBreakup === false)
            return { passes: 0, largestBefore: 0, largestAfter: 0, regionsOverLimit: 0, islands: 0, screens: 0, stamped: 0 };

        var profile = pContext.Profile || {};
        var density = Math.max(0.75, Math.min(1.5, Number(pDensity) || 1.0));
        var maxTiles = this.PostOpenAreaMaxTiles(pContext);
        var chunkTiles = this.PostOpenAreaChunkTiles(pContext);
        var passes = Math.max(1, Math.floor(profile.PostOpenAreaBreakupPasses || 2));
        var baseIslands = profile.PostMaxOpenAreaBreakupIslands !== undefined ?
            profile.PostMaxOpenAreaBreakupIslands :
            Math.floor((profile.MaxOpenAreaBreakupIslands || 18) * 0.85);
        var baseScreens = profile.PostMaxOpenAreaBreakupScreens !== undefined ?
            profile.PostMaxOpenAreaBreakupScreens :
            Math.floor((profile.MaxOpenAreaBreakupScreens || 4) * 0.85);
        var options = {
            allowKeepClear: true,
            allowPath: true,
            allowNearPath: true,
            pathCenterClearance: profile.PostOpenAreaPathCenterClearance || 2,
            criticalClearance: profile.PostOpenAreaCriticalClearance || 5,
            placementClearance: profile.PostOpenAreaPlacementClearance || 3,
            maxIslands: Math.max(1, Math.floor(baseIslands * density)),
            maxScreens: Math.max(0, Math.floor(baseScreens * density))
        };
        var areas = [];
        var largestBefore = 0;
        var largestAfter = 0;
        var overLimit = 0;
        var islands = 0;
        var screens = 0;
        var stamped = 0;

        for(var pass = 0; pass < passes; ++pass) {
            areas = this.CollectOpenAreas(pContext, options);
            if(pass === 0)
                largestBefore = areas.length ? areas[0].size : 0;

            var passStamped = 0;
            var areaMapFresh = true;
            for(var index = 0; index < areas.length; ++index) {
                if(areas[index].size <= maxTiles)
                    break;

                ++overLimit;
                var result = this.BreakOpenArea(pContext, areas[index], 300 + index + pass * 29, maxTiles, chunkTiles, options, areaMapFresh);
                islands += result.islands;
                screens += result.screens;
                stamped += result.stamped;
                passStamped += result.stamped;
                areaMapFresh = result.stamped === 0;
            }

            if(!passStamped)
                break;
        }

        areas = stamped ? this.CollectOpenAreas(pContext, options) : areas;
        largestAfter = areas.length ? areas[0].size : 0;

        return {
            maxOpenAreaTiles: maxTiles,
            passes: passes,
            largestBefore: largestBefore,
            largestAfter: largestAfter,
            regionsOverLimit: overLimit,
            islands: islands,
            screens: screens,
            stamped: stamped
        };
    };

    pJungle.OpenFieldScreensSettings = function(pContext, pDensity) {
        var profile = pContext.Profile || {};
        var sectorSize = Math.max(10, this.RangeValue(pContext, "OpenFieldScreenSectorSize", 14, 18, 0, 0, 991));
        var minOpenFraction = Number(profile.OpenFieldScreenMinOpenFraction);
        var minOpenTiles = Number(profile.OpenFieldScreenMinOpenTiles);
        var maxScreens = Number(profile.MaxOpenFieldScreens);
        var lengthValue = profile.OpenFieldScreenLength || [9, 16];
        var thicknessValue = profile.OpenFieldScreenThickness || 1;
        var minLength = 9;
        var maxLength = 16;
        var minThickness = 1;
        var maxThickness = 1;

        if(isNaN(minOpenFraction) || minOpenFraction <= 0)
            minOpenFraction = 0.68;
        if(isNaN(minOpenTiles) || minOpenTiles <= 0)
            minOpenTiles = Math.floor(sectorSize * sectorSize * 0.46);
        if(isNaN(maxScreens))
            maxScreens = 12;

        if(lengthValue instanceof Array && lengthValue.length >= 2) {
            minLength = Number(lengthValue[0]);
            maxLength = Number(lengthValue[1]);
        } else if(lengthValue !== undefined && lengthValue !== null) {
            minLength = Number(lengthValue);
            maxLength = minLength;
        }
        if(isNaN(minLength) || minLength <= 0)
            minLength = 9;
        if(isNaN(maxLength) || maxLength < minLength)
            maxLength = minLength;

        if(thicknessValue instanceof Array && thicknessValue.length >= 2) {
            minThickness = Number(thicknessValue[0]);
            maxThickness = Number(thicknessValue[1]);
        } else if(thicknessValue !== undefined && thicknessValue !== null) {
            minThickness = Number(thicknessValue);
            maxThickness = minThickness;
        }
        if(isNaN(minThickness) || minThickness <= 0)
            minThickness = 1;
        if(isNaN(maxThickness) || maxThickness < minThickness)
            maxThickness = minThickness;

        return {
            sectorSize: sectorSize,
            minOpenFraction: Math.max(0.30, Math.min(0.95, minOpenFraction)),
            minOpenTiles: Math.max(16, Math.floor(minOpenTiles)),
            maxScreens: Math.max(0, Math.floor(maxScreens * Math.max(0.35, Math.min(1.75, pDensity || 1)))),
            minLength: Math.max(4, Math.floor(minLength)),
            maxLength: Math.max(4, Math.floor(maxLength)),
            minThickness: Math.max(1, Math.floor(minThickness)),
            maxThickness: Math.max(1, Math.floor(maxThickness))
        };
    };

    pJungle.SelectOpenFieldScreenCenter = function(pContext, pBounds, pSectorIndex, pOptions) {
        var best = null;
        var centerX = (pBounds.minX + pBounds.maxX) / 2;
        var centerY = (pBounds.minY + pBounds.maxY) / 2;

        for(var x = pBounds.minX; x <= pBounds.maxX; ++x) {
            for(var y = pBounds.minY; y <= pBounds.maxY; ++y) {
                if(!this.OpenAreaCell(pContext, x, y, pOptions))
                    continue;

                var dx = x - centerX;
                var dy = y - centerY;
                var centerScore = 8 - (Math.sqrt((dx * dx) + (dy * dy)) * 0.35);
                var score = this.OpenAreaCandidateScore(pContext, { x: x, y: y }, 700 + pSectorIndex, pOptions) +
                    centerScore;

                if(!best || score > best.score)
                    best = { x: x, y: y, score: score };
            }
        }

        return best;
    };

    pJungle.ApplyOpenFieldScreens = function(pContext, pDensity) {
        var profile = pContext.Profile || {};
        var shaped = {
            sectors: 0,
            candidates: 0,
            screens: 0,
            islands: 0,
            stamped: 0,
            placements: []
        };

        if((profile.OpenFieldScreens === false && profile.V3OpenFieldScreens !== true) ||
            pDensity <= 0)
            return shaped;

        var settings = this.OpenFieldScreensSettings(pContext, pDensity);
        if(settings.maxScreens <= 0)
            return shaped;

        var options = {
            allowKeepClear: true,
            allowPath: true,
            allowNearPath: true,
            pathCenterClearance: profile.OpenFieldScreenPathCenterClearance || 2,
            criticalClearance: profile.OpenFieldScreenCriticalClearance || 5,
            placementClearance: profile.OpenFieldScreenPlacementClearance || 4
        };
        if(profile.AuditRenderedOpenFieldScreens === true) {
            pContext.Layers.openFieldScreen = MapGen.Layers.Create(
                pContext.Width, pContext.Height, 0);
            options.markerLayer = pContext.Layers.openFieldScreen;
        }
        var clearance = this.OuterCoverClearance(pContext);
        var sectorIndex = 0;
        var sectors = [];
        var used = [];
        var minSpacingSq = Math.max(64, Math.floor(settings.sectorSize * settings.sectorSize * 0.45));

        // Build the complete sector list first. The old row-major loop stopped
        // as soon as it hit maxScreens, so capped large maps consistently put
        // cover in their upper half and never evaluated the remainder.
        for(var buildY = clearance; buildY < pContext.Height - clearance; buildY += settings.sectorSize) {
            for(var buildX = clearance; buildX < pContext.Width - clearance; buildX += settings.sectorSize) {
                sectors.push({
                    x: buildX,
                    y: buildY,
                    ordinal: sectors.length + 1,
                    priority: this.HashUnit(pContext, buildX, buildY, 1987)
                });
            }
        }

        // Authored large-map concepts can spend their small screen budget on
        // the acreage that is measurably empty. The default remains purely
        // seed-random for older callers; dead-viewport overlap is only a
        // primary sort key when the profile explicitly requests it.
        if(profile.OpenFieldScreenPrioritizeDeadViewports === true &&
            MapGen.Metrics && MapGen.Metrics.ScreenPacing) {
            var previousDetailLimit = pContext.ScreenPacingDetailLimit;
            pContext.ScreenPacingDetailLimit = 512;
            var pacing = MapGen.Metrics.ScreenPacing(pContext);
            if(previousDetailLimit === undefined)
                delete pContext.ScreenPacingDetailLimit;
            else
                pContext.ScreenPacingDetailLimit = previousDetailLimit;

            var deadWindows = pacing.deadWindows || [];
            var viewport = pacing.viewport || { width: 17, height: 13 };
            for(var scoreIndex = 0; scoreIndex < sectors.length; ++scoreIndex) {
                var scoredSector = sectors[scoreIndex];
                var scoredMaxX = Math.min(
                    pContext.Width - clearance - 1,
                    scoredSector.x + settings.sectorSize - 1);
                var scoredMaxY = Math.min(
                    pContext.Height - clearance - 1,
                    scoredSector.y + settings.sectorSize - 1);
                var overlap = 0;
                for(var deadIndex = 0; deadIndex < deadWindows.length; ++deadIndex) {
                    var dead = deadWindows[deadIndex];
                    var deadMaxX = dead.x + viewport.width - 1;
                    var deadMaxY = dead.y + viewport.height - 1;
                    if(scoredMaxX >= dead.x && scoredSector.x <= deadMaxX &&
                        scoredMaxY >= dead.y && scoredSector.y <= deadMaxY)
                        ++overlap;
                }
                scoredSector.deadViewportOverlap = overlap;
            }
        }
        sectors.sort(function(pLeft, pRight) {
            var leftDead = pLeft.deadViewportOverlap || 0;
            var rightDead = pRight.deadViewportOverlap || 0;
            if(leftDead !== rightDead)
                return rightDead - leftDead;
            if(pLeft.priority !== pRight.priority)
                return pLeft.priority - pRight.priority;
            return pLeft.ordinal - pRight.ordinal;
        });

        for(var sectorListIndex = 0;
            sectorListIndex < sectors.length && shaped.screens + shaped.islands < settings.maxScreens;
            ++sectorListIndex) {
                var sector = sectors[sectorListIndex];
                var sx = sector.x;
                var sy = sector.y;
                var maxX = Math.min(pContext.Width - clearance - 1, sx + settings.sectorSize - 1);
                var maxY = Math.min(pContext.Height - clearance - 1, sy + settings.sectorSize - 1);
                var total = 0;
                var open = 0;

                ++sectorIndex;
                for(var x = sx; x <= maxX; ++x) {
                    for(var y = sy; y <= maxY; ++y) {
                        ++total;
                        if(this.OpenAreaCell(pContext, x, y, options))
                            ++open;
                    }
                }

                if(total <= 0 || open < settings.minOpenTiles || (open / total) < settings.minOpenFraction)
                    continue;

                ++shaped.candidates;
                var center = this.SelectOpenFieldScreenCenter(
                    pContext,
                    { minX: sx, minY: sy, maxX: maxX, maxY: maxY },
                    sector.ordinal,
                    options
                );
                if(!center)
                    continue;

                var spaced = true;
                for(var usedIndex = 0; usedIndex < used.length; ++usedIndex) {
                    var ux = used[usedIndex].x - center.x;
                    var uy = used[usedIndex].y - center.y;
                    if((ux * ux) + (uy * uy) < minSpacingSq) {
                        spaced = false;
                        break;
                    }
                }
                if(!spaced)
                    continue;

                var axis = this.HashUnit(pContext, sx, sy, 997) < 0.5 ? 0 : Math.PI / 2;
                var jitter = (this.HashUnit(pContext, center.x, center.y, 1001) - 0.5) * 0.55;
                var lengthRoll = this.HashUnit(pContext, center.x, center.y, 1003);
                var thickRoll = this.HashUnit(pContext, center.x, center.y, 1005);
                var length = Math.round(settings.minLength + ((settings.maxLength - settings.minLength) * lengthRoll));
                var thickness = Math.round(settings.minThickness + ((settings.maxThickness - settings.minThickness) * thickRoll));
                length = Math.min(length, Math.max(4, settings.sectorSize - 2));
                var screenId = shaped.screens + shaped.islands + 1;
                options.markerValue = screenId;

                var stamped = this.StampTacticalCoverScreen(
                    pContext,
                    center,
                    axis + jitter,
                    length,
                    thickness,
                    211 + sector.ordinal,
                    options
                );

                if(stamped) {
                    ++shaped.screens;
                    shaped.stamped += stamped;
                    shaped.placements.push({
                        id: screenId,
                        kind: "screen",
                        x: center.x,
                        y: center.y,
                        length: length,
                        thickness: thickness,
                        stamped: stamped
                    });
                    used.push({ x: center.x, y: center.y });
                    continue;
                }

                stamped = this.StampTacticalCoverDisc(
                    pContext,
                    center,
                    2,
                    223 + sector.ordinal,
                    options
                );

                if(stamped) {
                    ++shaped.islands;
                    shaped.stamped += stamped;
                    shaped.placements.push({
                        id: screenId,
                        kind: "island",
                        x: center.x,
                        y: center.y,
                        radius: 2,
                        stamped: stamped
                    });
                    used.push({ x: center.x, y: center.y });
                }
        }

        shaped.sectors = sectorIndex;

        if(shaped.stamped) {
            MapGen.Context.AddLog(
                pContext,
                "Applied open-field screens (" + shaped.screens + " screens, " +
                    shaped.islands + " islands, " + shaped.stamped + " tiles)"
            );
        }

        return shaped;
    };

    pJungle.ApplyOpenAreaBreakup = function(pContext) {
        if(!this.SupportsOpenAreaBreakup(pContext))
            return;

        var profile = pContext.Profile || {};
        var maxTiles = this.OpenAreaMaxTiles(pContext);
        var chunkTiles = this.OpenAreaChunkTiles(pContext);
        var passes = Math.max(1, Math.floor(profile.OpenAreaBreakupPasses || 2));
        var areas = [];
        var largestBefore = 0;
        var largestAfter = 0;
        var overLimit = 0;
        var islands = 0;
        var screens = 0;
        var stamped = 0;

        for(var pass = 0; pass < passes; ++pass) {
            areas = this.CollectOpenAreas(pContext);
            if(pass === 0)
                largestBefore = areas.length ? areas[0].size : 0;

            var passStamped = 0;
            for(var index = 0; index < areas.length; ++index) {
                if(areas[index].size <= maxTiles)
                    break;

                ++overLimit;
                var result = this.BreakOpenArea(pContext, areas[index], index + pass * 17, maxTiles, chunkTiles);
                islands += result.islands;
                screens += result.screens;
                stamped += result.stamped;
                passStamped += result.stamped;
            }

            if(!passStamped)
                break;
        }

        areas = stamped ? this.CollectOpenAreas(pContext) : areas;
        largestAfter = areas.length ? areas[0].size : 0;

        pContext.OpenAreaBreakup = {
            maxOpenAreaTiles: maxTiles,
            passes: passes,
            largestBefore: largestBefore,
            largestAfter: largestAfter,
            regionsOverLimit: overLimit,
            islands: islands,
            screens: screens,
            stamped: stamped
        };

        MapGen.Context.AddLog(
            pContext,
            "Applied open-area breakup (" + islands + " islands, " + screens + " screens, " + stamped +
                " tiles, largest " + largestBefore + " -> " + largestAfter + ")"
        );
    };

    // T2.13 — Pareto-distributed patch sizes. α=1.4 produces a heavy tail:
    // most patches small (~13 cells median) with occasional outliers up to
    // the clamp. Inverse-CDF transform: x = xmin / (1 - u)^(1/α).;
})(MapGen.Terrain.Cover);
