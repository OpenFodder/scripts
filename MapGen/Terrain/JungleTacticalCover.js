var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Cover = MapGen.Terrain.Cover || {};

(function(pJungle) {
    pJungle.SupportsTacticalCover = function(pContext) {
        if(!pContext.Profile || pContext.Profile.TacticalCoverShaping === false)
            return false;

        return pContext.Profile.TerrainType === Terrain.Types.Jungle ||
            pContext.Profile.TerrainType === Terrain.Types.Ice;
    };

    pJungle.TacticalCoverDensity = function(pContext) {
        var value = pContext.Profile.TacticalCoverDensity;
        if(value === undefined || value === null)
            return 1.0;

        value = Number(value);
        if(isNaN(value))
            return 1.0;

        return Math.max(0, Math.min(2.5, value));
    };

    // PostPlacementCover calls CriticalNearby / PlacementNearby millions of times
    // through CanStampTacticalCover and ProtectedNearby — once per cell of every
    // BFS step and every disc/screen stamp. The original implementations re-walked
    // pContext.CriticalPoints + every Anchor (for CriticalNearby) and 7 placement
    // groups (for PlacementNearby) on every call, so the cost was O(N) per cell
    // — and N grows with map size and live-structure count.
    //
    // Switching to the same pattern PathCenterProtectionLayer already uses: stamp
    // the points onto a per-radius 2D layer once, then a single Layers.Get takes
    // O(1) per cell. The Placements / Anchors / CriticalPoints sets do not change
    // during PostPlacementCover (the only stage that calls these in tight loops),
    // and IceCharMap calls them after placements are likewise frozen, so a lazy
    // cache is safe. We tag a cheap version key off the cardinality of each
    // source — if anything mutates between calls the key changes and we rebuild.
    pJungle.CriticalProtectionVersion = function(pContext) {
        var critical = (pContext.CriticalPoints || []).length;
        var anchors = pContext.Anchors || {};
        var anchorCount = 0;
        for(var anchorKey in anchors) {
            if(anchors.hasOwnProperty(anchorKey) && anchors[anchorKey])
                ++anchorCount;
        }
        return critical + ":" + anchorCount;
    };

    pJungle.CriticalProtectionLayer = function(pContext, pRadius) {
        var radius = Math.max(1, Math.floor(pRadius || 1));
        var version = this.CriticalProtectionVersion(pContext);
        var key = version + "|" + String(radius);

        if(!pContext._criticalProtection)
            pContext._criticalProtection = {};
        if(pContext._criticalProtection[key])
            return pContext._criticalProtection[key];

        var layer = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
        var points = pContext.CriticalPoints || [];
        for(var index = 0; index < points.length; ++index) {
            var point = points[index].point || points[index];
            if(!point)
                continue;
            MapGen.Layers.StampDisc(layer, point.x, point.y, radius, 1);
        }

        var anchors = pContext.Anchors || {};
        for(var anchorKey in anchors) {
            if(!anchors.hasOwnProperty(anchorKey) || !anchors[anchorKey])
                continue;
            MapGen.Layers.StampDisc(layer, anchors[anchorKey].x, anchors[anchorKey].y, radius, 1);
        }

        pContext._criticalProtection[key] = layer;
        return layer;
    };

    pJungle.CriticalNearby = function(pContext, pX, pY, pRadius) {
        return !!MapGen.Layers.Get(this.CriticalProtectionLayer(pContext, pRadius), pX, pY, 0);
    };

    pJungle.PlacementProtectionGroups = ["players", "teams", "objectives", "structures", "pickups", "vehicles", "enemies"];

    pJungle.PlacementProtectionVersion = function(pContext) {
        var placements = pContext.Placements || {};
        var groups = this.PlacementProtectionGroups;
        var version = "";
        for(var groupIndex = 0; groupIndex < groups.length; ++groupIndex) {
            var group = placements[groups[groupIndex]] || [];
            version += group.length + ",";
        }
        return version;
    };

    pJungle.PlacementProtectionLayer = function(pContext, pRadius) {
        var radius = Math.max(1, Math.floor(pRadius || 1));
        var version = this.PlacementProtectionVersion(pContext);
        var key = version + "|" + String(radius);

        if(!pContext._placementProtection)
            pContext._placementProtection = {};
        if(pContext._placementProtection[key])
            return pContext._placementProtection[key];

        var layer = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
        var placements = pContext.Placements || {};
        var groups = this.PlacementProtectionGroups;
        for(var groupIndex = 0; groupIndex < groups.length; ++groupIndex) {
            var group = placements[groups[groupIndex]] || [];
            for(var index = 0; index < group.length; ++index) {
                var point = group[index].point || group[index];
                if(!point)
                    continue;
                MapGen.Layers.StampDisc(layer, point.x, point.y, radius, 1);
            }
        }

        pContext._placementProtection[key] = layer;
        return layer;
    };

    pJungle.PlacementNearby = function(pContext, pX, pY, pRadius) {
        return !!MapGen.Layers.Get(this.PlacementProtectionLayer(pContext, pRadius), pX, pY, 0);
    };

    pJungle.PathCenterProtectionLayer = function(pContext, pRadius) {
        var radius = Math.max(0, Math.floor(pRadius || 0));
        var key = String(radius);
        var paths = pContext.Paths || [];

        if(!pContext._pathCenterProtection)
            pContext._pathCenterProtection = {};
        if(pContext._pathCenterProtection[key])
            return pContext._pathCenterProtection[key];

        var layer = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
        for(var pathIndex = 0; pathIndex < paths.length; ++pathIndex) {
            var path = paths[pathIndex];
            if(!path.points)
                continue;

            for(var pointIndex = 0; pointIndex < path.points.length; ++pointIndex)
                MapGen.Layers.StampDisc(layer, path.points[pointIndex].x, path.points[pointIndex].y, radius, 1);
        }

        pContext._pathCenterProtection[key] = layer;
        return layer;
    };

    pJungle.PathCenterNearby = function(pContext, pX, pY, pRadius) {
        return !!MapGen.Layers.Get(this.PathCenterProtectionLayer(pContext, pRadius), pX, pY, 0);
    };

    pJungle.CanStampTacticalCover = function(pContext, pX, pY, pOptions) {
        var options = pOptions || {};
        var allowKeepClear = !!options.allowKeepClear;
        var allowPath = !!options.allowPath;
        var allowCoast = !!options.allowCoast;
        var allowRiverBank = !!options.allowRiverBank;
        var allowOccupied = !!options.allowOccupied;

        if(!MapGen.Layers.InBounds(pContext.Layers.blocked, pX, pY))
            return false;
        if(MapGen.Layout.Reservations.BlocksCover(pContext, pX, pY))
            return false;
        var safeFrame = Math.max(0, Math.floor(Number(
            (pContext.Profile || {}).CoverSafeFrame || 0)));
        if(safeFrame > 0 &&
            (pX < safeFrame || pY < safeFrame ||
             pX >= pContext.Width - safeFrame ||
             pY >= pContext.Height - safeFrame))
            return false;
        if(this.IsOuterCoverBuffer(pContext, pX, pY))
            return false;
        if(MapGen.Layers.Get(pContext.Layers.path, pX, pY, 0) && !allowPath)
            return false;
        if(allowPath && this.PathCenterNearby(pContext, pX, pY, options.pathCenterClearance || 2))
            return false;
        if(MapGen.Layers.Get(pContext.Layers.occupied, pX, pY, 0) && !allowOccupied)
            return false;
        if(MapGen.Layers.Get(pContext.Layers.keepClear, pX, pY, 0) && !allowKeepClear)
            return false;
        if(allowKeepClear && this.CriticalNearby(pContext, pX, pY, options.criticalClearance || 3))
            return false;
        if(allowKeepClear && this.PlacementNearby(pContext, pX, pY, options.placementClearance || 3))
            return false;
        if(MapGen.Layers.Get(pContext.Layers.water, pX, pY, 0) ||
            (MapGen.Layers.Get(pContext.Layers.coast, pX, pY, 0) && !allowCoast && !this.TreesMayUseCoast(pContext)) ||
            (MapGen.Layers.Get(pContext.Layers.riverBank, pX, pY, 0) && !allowRiverBank) ||
            MapGen.Layers.Get(pContext.Layers.crossing, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.causeway, pX, pY, 0))
            return false;

        return true;
    };

    pJungle.StampTacticalCoverDisc = function(pContext, pCenter, pRadius, pSalt, pOptions) {
        var radius = Math.max(1, Math.floor(pRadius || 1));
        var radiusSq = radius * radius;
        var stamped = 0;

        for(var x = pCenter.x - radius; x <= pCenter.x + radius; ++x) {
            for(var y = pCenter.y - radius; y <= pCenter.y + radius; ++y) {
                var dx = x - pCenter.x;
                var dy = y - pCenter.y;
                var distanceSq = (dx * dx) + (dy * dy);
                if(distanceSq > radiusSq)
                    continue;
                if(MapGen.Layers.Get(pContext.Layers.blocked, x, y, 0))
                    continue;
                if(!this.CanStampTacticalCover(pContext, x, y, pOptions))
                    continue;

                // Feather the edge so cover reads as a natural mass instead
                // of a stamped coin. The core is guaranteed, outer cells are
                // deterministic per seed/cell.
                if(distanceSq > Math.max(1, radiusSq * 0.45)) {
                    var roll = this.HashUnit(pContext, x, y, 690 + (pSalt || 0));
                    if(roll < 0.28)
                        continue;
                }

                this.MarkTreeCell(pContext, x, y);
                if(pOptions && pOptions.markerLayer) {
                    MapGen.Layers.Set(pOptions.markerLayer, x, y,
                        pOptions.markerValue || 1);
                }
                ++stamped;
            }
        }

        return stamped;
    };

    pJungle.StampTacticalCoverScreen = function(pContext, pCenter, pAngle, pLength, pThickness, pSalt, pOptions) {
        var length = Math.max(4, Math.floor(pLength || 8));
        var half = Math.floor(length / 2);
        var thickness = Math.max(1, Math.floor(pThickness || 1));
        var dx = Math.cos(pAngle);
        var dy = Math.sin(pAngle);
        var px = -dy;
        var py = dx;
        var stamped = 0;

        for(var step = -half; step <= half; ++step) {
            var taper = half > 0 ? Math.abs(step) / half : 0;

            for(var side = -thickness; side <= thickness; ++side) {
                var x = Math.round(pCenter.x + (dx * step) + (px * side));
                var y = Math.round(pCenter.y + (dy * step) + (py * side));
                var edge = Math.abs(side) === thickness;

                if(MapGen.Layers.Get(pContext.Layers.blocked, x, y, 0))
                    continue;
                if(!this.CanStampTacticalCover(pContext, x, y, pOptions))
                    continue;
                if(this.ProtectedNearby(pContext, x, y, 1, pOptions))
                    continue;
                if(taper > 0.72 && this.HashUnit(pContext, x, y, 853 + (pSalt || 0)) < 0.45)
                    continue;
                if(edge && this.HashUnit(pContext, x, y, 859 + (pSalt || 0)) < 0.30)
                    continue;

                this.MarkTreeCell(pContext, x, y);
                if(pOptions && pOptions.markerLayer) {
                    MapGen.Layers.Set(pOptions.markerLayer, x, y,
                        pOptions.markerValue || 1);
                }
                ++stamped;
            }
        }

        return stamped;
    };

    pJungle.PathCoverPoint = function(pContext, pPath, pPointIndex, pSide, pOffset) {
        var previous = pPath.points[Math.max(0, pPointIndex - 3)];
        var next = pPath.points[Math.min(pPath.points.length - 1, pPointIndex + 3)];
        var base = pPath.points[pPointIndex];
        var dx = next.x - previous.x;
        var dy = next.y - previous.y;
        var length = Math.max(1, Math.sqrt((dx * dx) + (dy * dy)));
        var offset = Math.max(2, Math.floor(pOffset || 3));

        return {
            x: Math.max(1, Math.min(pContext.Width - 2, Math.round(base.x + ((-dy / length) * offset * pSide)))),
            y: Math.max(1, Math.min(pContext.Height - 2, Math.round(base.y + ((dx / length) * offset * pSide))))
        };
    };

    pJungle.PathTangentAngle = function(pPath, pPointIndex) {
        var previous = pPath.points[Math.max(0, pPointIndex - 3)];
        var next = pPath.points[Math.min(pPath.points.length - 1, pPointIndex + 3)];
        var dx = next.x - previous.x;
        var dy = next.y - previous.y;

        if(dx === 0 && dy === 0)
            return 0;

        return Math.atan2(dy, dx);
    };

    pJungle.RouteCoverSpacing = function(pContext) {
        var spacing = Number((pContext.Profile || {}).RouteTacticalCoverSpacing || 16);

        if(isNaN(spacing) || spacing <= 0)
            spacing = 16;

        return Math.max(8, spacing);
    };

    pJungle.RouteCoverScreenChance = function(pContext) {
        var value = (pContext.Profile || {}).RouteTacticalCoverScreenChance;

        if(value === undefined || value === null)
            return 0.65;

        value = Number(value);
        if(isNaN(value))
            return 0.65;

        return Math.max(0, Math.min(1, value));
    };

    pJungle.RangeValue = function(pContext, pName, pDefaultMin, pDefaultMax, pX, pY, pSalt) {
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

        return Math.round(min + ((max - min) * this.HashUnit(pContext, pX, pY, pSalt || 0)));
    };

    pJungle.RangeFloatValue = function(pContext, pName, pDefaultMin, pDefaultMax, pX, pY, pSalt) {
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

        return min + ((max - min) * this.HashUnit(pContext, pX, pY, pSalt || 0));
    };

    pJungle.RouteCoverOffsetPadding = function(pContext) {
        var value = Number((pContext.Profile || {}).RouteTacticalCoverOffsetPadding);

        if(isNaN(value) || value <= 0)
            return 1;

        return Math.max(1, Math.floor(value));
    };

    pJungle.RouteEdgeCoverSpacing = function(pContext) {
        var spacing = Number((pContext.Profile || {}).RouteEdgeCoverSpacing || 5);

        if(isNaN(spacing) || spacing <= 0)
            spacing = 5;

        return Math.max(3, Math.floor(spacing));
    };

    pJungle.RouteEdgeCoverChance = function(pContext) {
        var value = (pContext.Profile || {}).RouteEdgeCoverChance;

        if(value === undefined || value === null)
            return 0.45;

        value = Number(value);
        if(isNaN(value))
            return 0.45;

        return Math.max(0, Math.min(1, value));
    };

    pJungle.RouteEdgeCoverDistance = function(pContext) {
        var value = Number((pContext.Profile || {}).RouteEdgeCoverDistance || 3);

        if(isNaN(value) || value <= 0)
            value = 3;

        return Math.max(2, Math.floor(value));
    };

    pJungle.ApplyRouteTacticalCover = function(pContext, pDensity) {
        var shaped = { clusters: 0, stamped: 0 };
        var paths = pContext.Paths || [];
        var spacing = this.RouteCoverSpacing(pContext);
        var screenChance = this.RouteCoverScreenChance(pContext);
        var offsetPadding = this.RouteCoverOffsetPadding(pContext);
        var coverOptions = { criticalClearance: 4 };
        if(!paths.length || pDensity <= 0)
            return shaped;

        for(var pathIndex = 0; pathIndex < paths.length; ++pathIndex) {
            var path = paths[pathIndex];
            if(!path.points || path.points.length < 12)
                continue;

            var routeWeight = (path.role === "primary" || path.role === "placement_objectives" || path.role === "placement_teams") ? 1.15 : 0.65;
            var clusters = Math.max(1, Math.round((path.points.length / spacing) * pDensity * routeWeight));

            for(var index = 0; index < clusters; ++index) {
                var fraction = (index + 1) / (clusters + 1);
                var pointIndex = Math.max(2, Math.min(path.points.length - 3, Math.floor(path.points.length * fraction)));
                var side = ((index + pathIndex) % 2) ? 1 : -1;
                var radius = 1 + ((MapGen.Random.HashTile(pContext.Seed, pointIndex, pathIndex, 701) % 2));
                var offset = Math.max(3, (path.radius || 1) + radius + offsetPadding);
                var point = this.PathCoverPoint(pContext, path, pointIndex, side, offset);
                var stamped = this.StampTacticalCoverDisc(pContext, point, radius, 17 + index + pathIndex * 11, coverOptions);

                if(stamped) {
                    ++shaped.clusters;
                    shaped.stamped += stamped;
                }

                if(screenChance > 0 &&
                    this.HashUnit(pContext, point.x, point.y, 887 + index + pathIndex * 17) <= screenChance) {
                    var length = 5 + (MapGen.Random.HashTile(pContext.Seed, point.x, point.y, 891) % 5);
                    var screen = this.StampTacticalCoverScreen(
                        pContext,
                        point,
                        this.PathTangentAngle(path, pointIndex),
                        length,
                        1,
                        19 + index + pathIndex * 11,
                        coverOptions
                    );

                    if(screen) {
                        ++shaped.clusters;
                        shaped.stamped += screen;
                    }
                }
            }
        }

        return shaped;
    };

    pJungle.ApplyRouteEdgeCover = function(pContext, pDensity, pCoverOptions, pChanceScale) {
        var shaped = { ribbons: 0, stamped: 0 };
        var profile = pContext.Profile || {};
        var paths = pContext.Paths || [];

        if(profile.RouteEdgeCover === false || !paths.length || pDensity <= 0)
            return shaped;

        var spacing = this.RouteEdgeCoverSpacing(pContext);
        var baseChance = this.RouteEdgeCoverChance(pContext);
        var distance = this.RouteEdgeCoverDistance(pContext);
        var coverOptions = pCoverOptions || { criticalClearance: 4 };
        var chanceScale = (pChanceScale === undefined || pChanceScale === null) ? 1.0 : Number(pChanceScale);
        if(isNaN(chanceScale) || chanceScale < 0)
            chanceScale = 1.0;

        for(var pathIndex = 0; pathIndex < paths.length; ++pathIndex) {
            var path = paths[pathIndex];
            if(!path.points || path.points.length < spacing * 3)
                continue;

            var role = path.role || "path";
            var routeWeight = (role === "primary" || role === "placement_objectives" || role === "placement_teams") ? 1.0 : 0.55;
            var chance = Math.max(0, Math.min(1, baseChance * pDensity * routeWeight * chanceScale));

            for(var pointIndex = spacing; pointIndex < path.points.length - spacing; pointIndex += spacing) {
                var mainSide = (((pointIndex / spacing) + pathIndex) % 2) ? 1 : -1;

                for(var pass = 0; pass < 2; ++pass) {
                    var side = pass === 0 ? mainSide : -mainSide;
                    var sideChance = pass === 0 ? chance : chance * 0.45;
                    var base = path.points[pointIndex];

                    if(this.HashUnit(pContext, base.x + pass, base.y, 911 + pathIndex) > sideChance)
                        continue;

                    var point = this.PathCoverPoint(pContext, path, pointIndex, side, (path.radius || 1) + distance);
                    var length = Math.max(4, this.RangeValue(pContext, "RouteEdgeCoverLength", 6, 12, point.x, point.y, 917 + pass));
                    var thickness = Math.max(1, this.RangeValue(pContext, "RouteEdgeCoverThickness", 1, 1, point.x, point.y, 919 + pass));
                    var jitter = (this.HashUnit(pContext, point.x, point.y, 923 + pass) - 0.5) * 0.35;
                    var stamped = this.StampTacticalCoverScreen(
                        pContext,
                        point,
                        this.PathTangentAngle(path, pointIndex) + jitter,
                        length,
                        thickness,
                        23 + pointIndex + pass + pathIndex * 19,
                        coverOptions
                    );

                    if(stamped) {
                        ++shaped.ribbons;
                        shaped.stamped += stamped;
                    }
                }
            }
        }

        return shaped;
    };

    pJungle.CountTacticalCoverAround = function(pContext, pPoint, pRadius) {
        var layers = pContext.Layers;
        var count = 0;
        var radiusSq = pRadius * pRadius;

        for(var x = pPoint.x - pRadius; x <= pPoint.x + pRadius; ++x) {
            for(var y = pPoint.y - pRadius; y <= pPoint.y + pRadius; ++y) {
                var dx = x - pPoint.x;
                var dy = y - pPoint.y;

                if((dx * dx) + (dy * dy) > radiusSq)
                    continue;
                if(x < 0 || y < 0 || x >= pContext.Width || y >= pContext.Height) {
                    ++count;
                    continue;
                }
                if(MapGen.Layers.Get(layers.blocked, x, y, 0) ||
                    MapGen.Layers.Get(layers.water, x, y, 0) ||
                    MapGen.Layers.Get(layers.coast, x, y, 0) ||
                    MapGen.Layers.Get(layers.riverBank, x, y, 0) ||
                    MapGen.Layers.Get(layers.causeway, x, y, 0)) {
                    ++count;
                }
            }
        }

        return count;
    };

    pJungle.RouteExposureBreakupSettings = function(pContext) {
        var profile = pContext.Profile || {};
        var radius = Math.max(2, Math.floor(profile.RouteExposureBreakupRadius || profile.RouteExposureRadius || 5));
        var minCover = profile.RouteExposureBreakupMinCover;
        var step = Math.max(2, Math.floor(profile.RouteExposureBreakupStep || profile.RouteExposureSampleStep || 4));
        var minRun = Math.max(step * 2, Math.floor(profile.RouteExposureBreakupMinRunTiles || 14));
        var runChunk = Math.max(minRun, Math.floor(profile.RouteExposureBreakupRunChunkTiles || 20));
        var maxScreens = profile.MaxRouteExposureBreakupScreens;

        if(minCover === undefined || minCover === null)
            minCover = profile.RouteExposureMinCover;
        minCover = Math.max(1, Math.floor(Number(minCover) || 8));
        if(maxScreens === undefined || maxScreens === null)
            maxScreens = 18;

        return {
            radius: radius,
            minCover: minCover,
            step: step,
            minRun: minRun,
            runChunk: runChunk,
            maxScreens: Math.max(0, Math.floor(Number(maxScreens) || 0))
        };
    };

    pJungle.AddRouteExposureCandidates = function(pContext, pPath, pPathIndex, pRunStart, pRunEnd, pRunCover, pSettings, pCandidates) {
        if(pRunStart < 0 || pRunEnd < pRunStart)
            return;

        var runTiles = pRunEnd - pRunStart + 1;
        if(runTiles < pSettings.minRun)
            return;

        var count = Math.max(1, Math.ceil(runTiles / pSettings.runChunk));
        var spacing = runTiles / (count + 1);

        for(var index = 0; index < count; ++index) {
            var pointIndex = Math.max(2, Math.min(pPath.points.length - 3, Math.round(pRunStart + spacing * (index + 1))));
            var point = pPath.points[pointIndex];
            var averageCover = pRunCover.samples ? pRunCover.total / pRunCover.samples : 0;

            pCandidates.push({
                path: pPath,
                pathIndex: pPathIndex,
                pointIndex: pointIndex,
                point: point,
                runTiles: runTiles,
                deficit: pSettings.minCover - averageCover
            });
        }
    };

    pJungle.RouteExposureBreakupLength = function(pContext, pCenter) {
        var profile = pContext.Profile || {};
        var value = profile.RouteExposureBreakupScreenLength || profile.RouteEdgeCoverLength || [8, 14];
        var min = 8;
        var max = 14;

        if(value instanceof Array && value.length >= 2) {
            min = Number(value[0]);
            max = Number(value[1]);
        } else if(value !== undefined && value !== null) {
            min = Number(value);
            max = min;
        }

        if(isNaN(min) || min <= 0)
            min = 8;
        if(isNaN(max) || max < min)
            max = min;

        return Math.max(4, Math.round(min + ((max - min) * this.HashUnit(pContext, pCenter.x, pCenter.y, 967))));
    };

    pJungle.RouteExposureBreakupThickness = function(pContext, pCenter) {
        var value = (pContext.Profile || {}).RouteExposureBreakupScreenThickness || 1;
        var min = 1;
        var max = 1;

        if(value instanceof Array && value.length >= 2) {
            min = Number(value[0]);
            max = Number(value[1]);
        } else if(value !== undefined && value !== null) {
            min = Number(value);
            max = min;
        }

        if(isNaN(min) || min <= 0)
            min = 1;
        if(isNaN(max) || max < min)
            max = min;

        return Math.max(1, Math.round(min + ((max - min) * this.HashUnit(pContext, pCenter.x, pCenter.y, 971))));
    };

    pJungle.ApplyRouteExposureBreakup = function(pContext, pDensity) {
        var profile = pContext.Profile || {};
        var shaped = {
            samples: 0,
            exposedSamples: 0,
            exposedRuns: 0,
            screens: 0,
            islands: 0,
            stamped: 0
        };

        if(profile.RouteExposureBreakup === false || pDensity <= 0)
            return shaped;

        var paths = pContext.Paths || [];
        if(!paths.length)
            return shaped;

        var settings = this.RouteExposureBreakupSettings(pContext);
        var candidates = [];

        for(var pathIndex = 0; pathIndex < paths.length; ++pathIndex) {
            var path = paths[pathIndex];
            if(!path.points || path.points.length < settings.minRun)
                continue;

            var runStart = -1;
            var runEnd = -1;
            var runCover = { total: 0, samples: 0 };

            for(var pointIndex = 0; pointIndex < path.points.length; pointIndex += settings.step) {
                var point = path.points[pointIndex];
                var cover = this.CountTacticalCoverAround(pContext, point, settings.radius);
                ++shaped.samples;

                if(cover < settings.minCover) {
                    ++shaped.exposedSamples;
                    if(runStart < 0)
                        runStart = pointIndex;
                    runEnd = pointIndex;
                    runCover.total += cover;
                    ++runCover.samples;
                    continue;
                }

                this.AddRouteExposureCandidates(pContext, path, pathIndex, runStart, runEnd, runCover, settings, candidates);
                runStart = -1;
                runEnd = -1;
                runCover = { total: 0, samples: 0 };
            }

            this.AddRouteExposureCandidates(pContext, path, pathIndex, runStart, runEnd, runCover, settings, candidates);
        }

        candidates.sort(function(pLeft, pRight) {
            if(pRight.deficit !== pLeft.deficit)
                return pRight.deficit - pLeft.deficit;
            if(pRight.runTiles !== pLeft.runTiles)
                return pRight.runTiles - pLeft.runTiles;
            // Total-order tiebreak on the (unique) route position so equal
            // deficit+runTiles candidates keep a deterministic order under the
            // engine's unstable Array.sort.
            if(pLeft.pathIndex !== pRight.pathIndex)
                return pLeft.pathIndex - pRight.pathIndex;
            return pLeft.pointIndex - pRight.pointIndex;
        });

        // A global deficit sort lets a long primary route consume the whole
        // screen budget while exposed side routes receive nothing. On large
        // campaign maps those side routes are exactly where optional
        // structures and pickups live. Interleave each path's best remaining
        // candidate before taking its next one, preserving the per-path
        // deficit ordering established above.
        if(profile.RouteExposureBreakupDistributePaths === true &&
            candidates.length > 1) {
            var candidatesByPath = {};
            var pathOrder = [];
            for(var candidateIndex = 0;
                candidateIndex < candidates.length; ++candidateIndex) {
                var candidatePathKey = String(candidates[candidateIndex].pathIndex);
                if(!candidatesByPath[candidatePathKey]) {
                    candidatesByPath[candidatePathKey] = [];
                    pathOrder.push(candidatePathKey);
                }
                candidatesByPath[candidatePathKey].push(candidates[candidateIndex]);
            }
            var distributedCandidates = [];
            var distributedRound = 0;
            var addedInRound = true;
            while(addedInRound) {
                addedInRound = false;
                for(var pathOrderIndex = 0;
                    pathOrderIndex < pathOrder.length; ++pathOrderIndex) {
                    var pathCandidates = candidatesByPath[pathOrder[pathOrderIndex]];
                    if(distributedRound >= pathCandidates.length)
                        continue;
                    distributedCandidates.push(pathCandidates[distributedRound]);
                    addedInRound = true;
                }
                ++distributedRound;
            }
            candidates = distributedCandidates;
        }

        var maxScreens = Math.max(1, Math.floor(settings.maxScreens * Math.max(0.35, Math.min(1.75, pDensity))));
        var minSpacingSq = 81;
        var used = [];
        var options = {
            allowKeepClear: true,
            allowPath: true,
            allowNearPath: true,
            pathCenterClearance: profile.RouteExposureBreakupPathCenterClearance || 2,
            criticalClearance: profile.RouteExposureBreakupCriticalClearance || 5,
            placementClearance: profile.RouteExposureBreakupPlacementClearance || 4
        };

        for(var index = 0; index < candidates.length && shaped.screens + shaped.islands < maxScreens; ++index) {
            var candidate = candidates[index];
            var ok = true;

            for(var usedIndex = 0; usedIndex < used.length; ++usedIndex) {
                var ux = used[usedIndex].x - candidate.point.x;
                var uy = used[usedIndex].y - candidate.point.y;
                if((ux * ux) + (uy * uy) < minSpacingSq) {
                    ok = false;
                    break;
                }
            }
            if(!ok)
                continue;

            var side = (this.HashUnit(pContext, candidate.point.x, candidate.point.y, 977 + candidate.pathIndex) < 0.5) ? -1 : 1;
            var offset = Math.max(3, (candidate.path.radius || 1) + this.RouteEdgeCoverDistance(pContext) + 1);
            var coverPoint = this.PathCoverPoint(pContext, candidate.path, candidate.pointIndex, side, offset);
            var length = this.RouteExposureBreakupLength(pContext, coverPoint);
            var thickness = this.RouteExposureBreakupThickness(pContext, coverPoint);
            var angle = this.PathTangentAngle(candidate.path, candidate.pointIndex) +
                ((this.HashUnit(pContext, coverPoint.x, coverPoint.y, 981) - 0.5) * 0.45);
            var stamped = this.StampTacticalCoverScreen(
                pContext,
                coverPoint,
                angle,
                length,
                thickness,
                173 + index + candidate.pathIndex * 31,
                options
            );

            if(stamped) {
                ++shaped.screens;
                shaped.stamped += stamped;
                used.push({ x: candidate.point.x, y: candidate.point.y });
                continue;
            }

            stamped = this.StampTacticalCoverDisc(
                pContext,
                coverPoint,
                2,
                181 + index + candidate.pathIndex * 31,
                options
            );

            if(stamped) {
                ++shaped.islands;
                shaped.stamped += stamped;
                used.push({ x: candidate.point.x, y: candidate.point.y });
            }
        }

        shaped.exposedRuns = candidates.length;

        if(shaped.stamped) {
            MapGen.Context.AddLog(
                pContext,
                "Applied route-exposure breakup (" + shaped.screens + " screens, " +
                    shaped.islands + " islands, " + shaped.stamped + " tiles)"
            );
        }

        return shaped;
    };

    // Close the gap between route-point sampling and viewport pacing. Long
    // diagonal/side routes can pass through several overlapping 17x13 windows
    // even when the point sampler sees only one exposed run. Stamp compact
    // blobs beside route cells in the windows that are still genuinely empty
    // after the normal route-exposure pass.
    pJungle.ApplyRouteViewportCover = function(pContext) {
        var profile = pContext.Profile || {};
        var shaped = {
            before: 0,
            after: 0,
            clusters: 0,
            stamped: 0,
            placements: []
        };
        if(profile.RouteViewportCover !== true ||
            !MapGen.Metrics || !MapGen.Metrics.ScreenPacing)
            return shaped;

        var previousDetailLimit = pContext.ScreenPacingDetailLimit;
        // Repair must see the complete failure set. Final metadata returns to
        // the normal compact 12-window diagnostic cap below.
        pContext.ScreenPacingDetailLimit = 512;
        var pacing = MapGen.Metrics.ScreenPacing(pContext);
        var windows = (pacing.routeDeadWindows || []).slice(0), seenWindows = {};
        for(var wi = 0; wi < windows.length; ++wi) seenWindows[windows[wi].x + "," + windows[wi].y] = true;
        var quietWindows = pacing.routeQuietWindows || [];
        for(var qi = 0; qi < quietWindows.length; ++qi) {
            var windowKey = quietWindows[qi].x + "," + quietWindows[qi].y;
            if(!seenWindows[windowKey]) windows.push(quietWindows[qi]);
        }
        shaped.before = Math.max(pacing.routeDeadScreens || 0, pacing.routeQuietScreens || 0);
        if(!windows.length) {
            if(previousDetailLimit === undefined)
                delete pContext.ScreenPacingDetailLimit;
            else
                pContext.ScreenPacingDetailLimit = previousDetailLimit;
            return shaped;
        }

        var paths = pContext.Paths || [];
        var radius = Math.max(2, Math.floor(Number(
            profile.RouteViewportCoverRadius || 3)));
        var maxClusters = Math.max(1, Math.floor(Number(
            profile.MaxRouteViewportCoverClusters || 8)));
        var used = [];
        var minSpacingSq = Math.max(36, radius * radius * 4);
        var options = {
            allowKeepClear: true,
            allowPath: true,
            allowNearPath: true,
            pathCenterClearance: 2,
            criticalClearance: 4,
            placementClearance: 3
        };

        for(var windowIndex = 0;
            windowIndex < windows.length && shaped.clusters < maxClusters;
            ++windowIndex) {
            var window = windows[windowIndex];
            var centerX = window.x + 8;
            var centerY = window.y + 6;
            var best = null;
            var bestDistance = null;

            for(var pathIndex = 0; pathIndex < paths.length; ++pathIndex) {
                var path = paths[pathIndex];
                var points = path.points || [];
                for(var pointIndex = 1; pointIndex < points.length - 1; ++pointIndex) {
                    var point = points[pointIndex];
                    if(point.x < window.x || point.x >= window.x + 17 ||
                        point.y < window.y || point.y >= window.y + 13)
                        continue;
                    var cdx = point.x - centerX;
                    var cdy = point.y - centerY;
                    var centerDistance = (cdx * cdx) + (cdy * cdy);
                    if(bestDistance === null || centerDistance < bestDistance) {
                        bestDistance = centerDistance;
                        best = {
                            path: path,
                            pathIndex: pathIndex,
                            pointIndex: pointIndex,
                            point: point
                        };
                    }
                }
            }
            // Structure-access and late connectivity routes may exist only in
            // the final path/keepClear layers, not pContext.Paths. Fall back to
            // the nearest such cell so those playable spurs receive the same
            // viewport treatment as authored topology paths.
            if(!best) {
                for(var layerX = window.x;
                    layerX < Math.min(pContext.Width, window.x + 17); ++layerX) {
                    for(var layerY = window.y;
                        layerY < Math.min(pContext.Height, window.y + 13); ++layerY) {
                        if(!MapGen.Layers.Get(pContext.Layers.path,
                            layerX, layerY, 0) &&
                            !MapGen.Layers.Get(pContext.Layers.keepClear,
                                layerX, layerY, 0))
                            continue;
                        var ldx = layerX - centerX;
                        var ldy = layerY - centerY;
                        var layerDistance = (ldx * ldx) + (ldy * ldy);
                        if(bestDistance === null || layerDistance < bestDistance) {
                            bestDistance = layerDistance;
                            best = {
                                path: null,
                                pathIndex: -1,
                                pointIndex: -1,
                                point: { x: layerX, y: layerY }
                            };
                        }
                    }
                }
            }
            if(!best)
                continue;

            var tooClose = false;
            for(var usedIndex = 0; usedIndex < used.length; ++usedIndex) {
                var udx = used[usedIndex].x - best.point.x;
                var udy = used[usedIndex].y - best.point.y;
                if((udx * udx) + (udy * udy) < minSpacingSq) {
                    tooClose = true;
                    break;
                }
            }
            if(tooClose)
                continue;

            var firstSide = this.HashUnit(pContext,
                best.point.x, best.point.y, 1481 + best.pathIndex) < 0.5 ? -1 : 1;
            var stamped = 0;
            var placedPoint = null;
            var sideAttempts = best.path ? 2 : 4;
            var minimumUsefulStamp = Math.max(6, radius * 2);
            for(var sideAttempt = 0;
                sideAttempt < sideAttempts && stamped < minimumUsefulStamp;
                ++sideAttempt) {
                var side = sideAttempt ? -firstSide : firstSide;
                var coverPoint;
                if(best.path) {
                    coverPoint = this.PathCoverPoint(pContext,
                        best.path, best.pointIndex, side,
                        Math.max(4, (best.path.radius || 1) + radius));
                }
                else {
                    var fallbackDirections = firstSide > 0 ?
                        [[1, 0], [-1, 0], [0, 1], [0, -1]] :
                        [[-1, 0], [1, 0], [0, -1], [0, 1]];
                    var direction = fallbackDirections[sideAttempt];
                    var fallbackOffset = Math.max(4, radius + 1);
                    coverPoint = {
                        x: best.point.x + direction[0] * fallbackOffset,
                        y: best.point.y + direction[1] * fallbackOffset
                    };
                }
                var attemptStamped = this.StampTacticalCoverDisc(pContext,
                    coverPoint, radius,
                    1493 + windowIndex * 7 + sideAttempt,
                    options);
                stamped += attemptStamped;
                if(attemptStamped)
                    placedPoint = coverPoint;
            }

            // PathCoverPoint follows the route normal and may put the whole
            // disc just outside this viewport (especially at a screen edge).
            // Count the actual target window, then make a small deterministic
            // set of in-window attempts when the normal side stamps did not
            // provide the route cover floor. Keep the same stamp options so
            // path, keep-clear, critical, placement, water, and safe-frame
            // protections remain authoritative.
            var windowCells = 0;
            var windowBlocked = 0;
            var windowMinX = Math.max(0, window.x);
            var windowMinY = Math.max(0, window.y);
            var windowMaxX = Math.min(pContext.Width - 1, window.x + 16);
            var windowMaxY = Math.min(pContext.Height - 1, window.y + 12);
            for(var countX = windowMinX; countX <= windowMaxX; ++countX) {
                for(var countY = windowMinY; countY <= windowMaxY; ++countY) {
                    ++windowCells;
                    if(MapGen.Layers.Get(pContext.Layers.blocked, countX, countY, 0))
                        ++windowBlocked;
                }
            }
            var routeCoverFloor = pacing.routeCoverFloor;
            var targetWindowCover = Math.ceil(windowCells * routeCoverFloor);
            var fallbackAttempts = 0;
            var fallbackPoints = [
                { x: best.point.x + radius + 1, y: best.point.y },
                { x: best.point.x - radius - 1, y: best.point.y },
                { x: best.point.x, y: best.point.y + radius + 1 },
                { x: best.point.x, y: best.point.y - radius - 1 },
                { x: centerX, y: centerY }
            ];
            while(windowBlocked < targetWindowCover &&
                fallbackAttempts < fallbackPoints.length) {
                var fallback = fallbackPoints[fallbackAttempts++];
                fallback.x = Math.max(windowMinX + 1,
                    Math.min(windowMaxX - 1, fallback.x));
                fallback.y = Math.max(windowMinY + 1,
                    Math.min(windowMaxY - 1, fallback.y));
                var fallbackStamped = this.StampTacticalCoverDisc(
                    pContext, fallback, radius,
                    1511 + windowIndex * 11 + fallbackAttempts, options);
                if(fallbackStamped) {
                    stamped += fallbackStamped;
                    placedPoint = fallback;
                    // Recount rather than assuming every stamped tile landed
                    // inside the viewport.
                    windowBlocked = 0;
                    for(var verifyX = windowMinX; verifyX <= windowMaxX; ++verifyX) {
                        for(var verifyY = windowMinY; verifyY <= windowMaxY; ++verifyY) {
                            if(MapGen.Layers.Get(pContext.Layers.blocked, verifyX, verifyY, 0))
                                ++windowBlocked;
                        }
                    }
                }
            }
            if(!stamped)
                continue;

            ++shaped.clusters;
            shaped.stamped += stamped;
            used.push(best.point);
            shaped.placements.push({
                pathIndex: best.pathIndex,
                routePoint: { x: best.point.x, y: best.point.y },
                coverPoint: placedPoint,
                window: { x: window.x, y: window.y },
                stamped: stamped
            });
        }

        var afterPacing = MapGen.Metrics.ScreenPacing(pContext);
        shaped.after = Math.max(afterPacing.routeDeadScreens || 0, afterPacing.routeQuietScreens || 0);
        if(previousDetailLimit === undefined)
            delete pContext.ScreenPacingDetailLimit;
        else
            pContext.ScreenPacingDetailLimit = previousDetailLimit;
        if(shaped.stamped) {
            MapGen.Context.AddLog(pContext,
                "Applied route viewport cover (" + shaped.before + " -> " +
                    shaped.after + ", " + shaped.clusters + " clusters, " +
                    shaped.stamped + " tiles)");
        }
        return shaped;
    };

    pJungle.AnchorCoverRole = function(pKey) {
        if(pKey === "objective" || pKey === "contested")
            return "objective";
        if(pKey === "teamA" || pKey === "teamB")
            return "team";
        if(pKey === "support")
            return "support";
        return "";
    };

    pJungle.ApplyAnchorTacticalCover = function(pContext, pDensity) {
        var shaped = { clusters: 0, stamped: 0 };
        var anchors = pContext.Anchors || {};
        var keys = ["objective", "contested", "support", "teamA", "teamB"];

        if(pDensity <= 0)
            return shaped;

        for(var keyIndex = 0; keyIndex < keys.length; ++keyIndex) {
            var key = keys[keyIndex];
            var anchor = anchors[key];
            var role = this.AnchorCoverRole(key);
            if(!anchor || !role)
                continue;

            var clearingRadius = MapGen.Layout && MapGen.Layout.Clearings ?
                MapGen.Layout.Clearings.RadiusForRole(pContext, anchor.role || role) :
                pContext.Profile.ClearingRadius || 5;
            var ring = Math.max(4, clearingRadius + 2);
            var count = Math.max(1, Math.round((role === "objective" ? 3 : 2) * pDensity));

            for(var index = 0; index < count; ++index) {
                var hash = MapGen.Random.HashTile(pContext.Seed, anchor.x + index, anchor.y, 719 + keyIndex);
                var angle = ((hash % 6283) / 1000) + (index * 2.399963229728653);
                var point = {
                    x: Math.round(anchor.x + Math.cos(angle) * ring),
                    y: Math.round(anchor.y + Math.sin(angle) * ring)
                };
                var stamped = this.StampTacticalCoverDisc(
                    pContext,
                    point,
                    2,
                    41 + index + keyIndex * 13,
                    { criticalClearance: 4 }
                );

                if(stamped) {
                    ++shaped.clusters;
                    shaped.stamped += stamped;
                }
            }
        }

        return shaped;
    };

    pJungle.ApplyAmbushTacticalCover = function(pContext, pDensity) {
        var shaped = { clusters: 0, stamped: 0 };
        var clearings = pContext.Clearings || [];
        if(pDensity <= 0)
            return shaped;

        for(var index = 0; index < clearings.length; ++index) {
            var clearing = clearings[index];
            if(clearing.role !== "ambush_pocket" && clearing.role !== "flank" && clearing.role !== "enemy_camp")
                continue;

            var radius = Math.max(1, Math.floor(clearing.radius * 0.35));
            var ring = Math.max(3, clearing.radius + 1);
            var angle = ((MapGen.Random.HashTile(pContext.Seed, clearing.x, clearing.y, 733) % 6283) / 1000);
            var point = {
                x: Math.round(clearing.x + Math.cos(angle) * ring),
                y: Math.round(clearing.y + Math.sin(angle) * ring)
            };
            var stamped = this.StampTacticalCoverDisc(
                pContext,
                point,
                radius,
                83 + index,
                { criticalClearance: 4 }
            );

            if(stamped) {
                ++shaped.clusters;
                shaped.stamped += stamped;
            }
        }

        return shaped;
    };

    pJungle.ApplyTacticalCover = function(pContext) {
        if(!this.SupportsTacticalCover(pContext))
            return;

        var density = this.TacticalCoverDensity(pContext);
        var route = this.ApplyRouteTacticalCover(pContext, density);
        var routeEdges = this.ApplyRouteEdgeCover(pContext, density);
        var anchors = this.ApplyAnchorTacticalCover(pContext, density);
        var ambush = this.ApplyAmbushTacticalCover(pContext, density);
        var stamped = route.stamped + routeEdges.stamped + anchors.stamped + ambush.stamped;

        pContext.TacticalCover = {
            routeClusters: route.clusters,
            routeEdgeRibbons: routeEdges.ribbons,
            anchorClusters: anchors.clusters,
            ambushClusters: ambush.clusters,
            stamped: stamped
        };

        MapGen.Context.AddLog(
            pContext,
            "Applied tactical cover shaping (" +
                (route.clusters + routeEdges.ribbons + anchors.clusters + ambush.clusters) +
                " clusters, " + stamped + " tiles)"
        );
    };
})(MapGen.Terrain.Cover);
