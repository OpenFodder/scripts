var MapGen = MapGen || {};
MapGen.Integration = MapGen.Integration || {};

// Door approaches and terrain preparation for objective fallback sites.
(function(pIntegration) {
    pIntegration.StructureAccessCellClear = function(pContext, pX, pY) {
        if(!pContext || !pContext.Layers)
            return false;
        if(pX < 0 || pY < 0 || pX >= pContext.Width || pY >= pContext.Height)
            return false;
        if(MapGen.Layers.Get(pContext.Layers.occupied, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(pContext.Layers.water, pX, pY, 0))
            return false;
        if(this.IsStructureCliffProtectedCell(pContext, pX, pY))
            return false;

        return true;
    };

    pIntegration.BestStructureAccessPoint = function(pRect, pTarget, pContext) {
        var center = this.StructureRectCenter(pRect);
        var target = pTarget || center;
        var best = null;
        var bestScore = 0x7FFFFFFF;

        for(var x = pRect.minX - 1; x <= pRect.maxX + 1; ++x) {
            for(var y = pRect.minY - 1; y <= pRect.maxY + 1; ++y) {
                var insideX = x >= pRect.minX && x <= pRect.maxX;
                var insideY = y >= pRect.minY && y <= pRect.maxY;
                if(insideX && insideY)
                    continue;
                if(!this.StructureAccessCellClear(pContext, x, y))
                    continue;

                var dx = x - target.x;
                var dy = y - target.y;
                var centerDx = x - center.x;
                var centerDy = y - center.y;
                var diagonal = (x === pRect.minX - 1 || x === pRect.maxX + 1) &&
                    (y === pRect.minY - 1 || y === pRect.maxY + 1);
                var score = (dx * dx) + (dy * dy);

                // Prefer cardinal edge cells over diagonals; they read better
                // as approach points and avoid corner clipping in the runtime.
                if(diagonal)
                    score += 8;
                else
                    score -= 4;
                score += Math.abs(centerDx) + Math.abs(centerDy);

                if(score < bestScore) {
                    bestScore = score;
                    best = { x: x, y: y };
                }
            }
        }

        return best;
    };

    pIntegration.StructureAccessPoint = function(pRect, pTarget, pContext) {
        var best = this.BestStructureAccessPoint(pRect, pTarget, pContext);
        if(best)
            return best;

        var center = this.StructureRectCenter(pRect);
        var dx = pTarget ? (pTarget.x - center.x) : 0;
        var dy = pTarget ? (pTarget.y - center.y) : 1;
        var access;

        if(Math.abs(dx) > Math.abs(dy)) {
            access = {
                x: dx < 0 ? pRect.minX - 1 : pRect.maxX + 1,
                y: this.ClampTile(pTarget.y, pRect.minY, pRect.maxY)
            };
        } else {
            access = {
                x: this.ClampTile(pTarget.x, pRect.minX, pRect.maxX),
                y: dy < 0 ? pRect.minY - 1 : pRect.maxY + 1
            };
        }

        access.x = this.ClampTile(access.x, 0, pContext.Width - 1);
        access.y = this.ClampTile(access.y, 0, pContext.Height - 1);
        return access;
    };

    pIntegration.NearestStructureRoutePoint = function(pContext, pRect) {
        var targets = this.StructureRouteTargets(pContext, pRect, 1);
        return targets.length ? targets[0] : null;
    };

    pIntegration.StructureRouteTargets = function(pContext, pRect, pLimit) {
        var center = this.StructureRectCenter(pRect);
        var targets = [];
        var seen = {};
        var paths = pContext.Paths || [];

        var addTarget = function(point) {
            if(!point)
                return;
            var key = point.x + "," + point.y;
            if(seen[key])
                return;
            seen[key] = true;

            var dx = point.x - center.x;
            var dy = point.y - center.y;
            targets.push({
                x: point.x,
                y: point.y,
                distance: (dx * dx) + (dy * dy)
            });
        };

        for(var pathIndex = 0; pathIndex < paths.length; ++pathIndex) {
            var path = paths[pathIndex];
            if(!path || !path.points || !path.points.length)
                continue;

            for(var pointIndex = 0; pointIndex < path.points.length; ++pointIndex)
                addTarget(path.points[pointIndex]);
        }

        var anchors = pContext.Anchors || {};
        var keys = ["start", "support", "objective", "teamA", "teamB"];
        for(var index = 0; index < keys.length; ++index) {
            if(anchors[keys[index]])
                addTarget(anchors[keys[index]]);
        }

        targets.sort(function(pLeft, pRight) {
            if(pLeft.distance !== pRight.distance)
                return pLeft.distance - pRight.distance;
            // Total-order tiebreak on the (unique) target coordinates so two
            // equidistant route points cannot swap the chosen access point
            // between launches under the engine's unstable sort.
            if(pLeft.x !== pRight.x)
                return pLeft.x - pRight.x;
            return pLeft.y - pRight.y;
        });

        var limit = pLimit || targets.length;
        var result = [];
        for(var targetIndex = 0; targetIndex < targets.length && result.length < limit; ++targetIndex)
            result.push({ x: targets[targetIndex].x, y: targets[targetIndex].y });

        return result;
    };

    pIntegration.CarveDirectStructureDoorConnector = function(pContext, pSpec, pPlacement, pTarget) {
        var denseAuthoredRoute = !!(pContext && pContext.Profile &&
            (pContext.Profile.JungleMazeRouteTopology === true ||
                String(pContext.Profile.Name || "") ===
                    "grammar_jungle_neck"));
        if(!pContext || !pContext.Profile || !pTarget ||
            (!denseAuthoredRoute &&
                !pContext.OriginalTerrainTemplate && !pPlacement.fallback))
            return null;

        var access = this.StructureAccessPoint(pPlacement.rect, pTarget, pContext);
        if(!access)
            return null;

        var buildPoints = function(pHorizontalFirst) {
            var points = [];
            var x = access.x;
            var y = access.y;
            points.push({ x: x, y: y });
            if(pHorizontalFirst) {
                while(x !== pTarget.x) {
                    x += pTarget.x > x ? 1 : -1;
                    points.push({ x: x, y: y });
                }
                while(y !== pTarget.y) {
                    y += pTarget.y > y ? 1 : -1;
                    points.push({ x: x, y: y });
                }
            } else {
                while(y !== pTarget.y) {
                    y += pTarget.y > y ? 1 : -1;
                    points.push({ x: x, y: y });
                }
                while(x !== pTarget.x) {
                    x += pTarget.x > x ? 1 : -1;
                    points.push({ x: x, y: y });
                }
            }
            return points;
        };
        var candidates = [buildPoints(true), buildPoints(false)];
        var best = null;
        var bestScore = Infinity;

        for(var candidateIndex = 0; candidateIndex < candidates.length; ++candidateIndex) {
            var points = candidates[candidateIndex];
            var score = points.length;
            var valid = true;
            for(var pointIndex = 0; pointIndex < points.length; ++pointIndex) {
                var point = points[pointIndex];
                if(!this.StructureAccessCellClear(pContext, point.x, point.y)) {
                    valid = false;
                    break;
                }
                if(MapGen.Layers.Get(pContext.Layers.blocked, point.x, point.y, 0))
                    score += 3;
            }
            if(valid && score < bestScore) {
                best = points;
                bestScore = score;
            }
        }

        // Maze structures authored beside a route/branch use a short doorway
        // so they cannot create major shortcuts. A structure that had to use a
        // generic clearing has no such authored corridor guarantee; treat it
        // like a whole-map fallback and build a real branch rather than later
        // recording a one-cell doorway to a route many tiles away.
        var clearingRole = pPlacement.clearing ? String(pPlacement.clearing.role || "") : "";
        var routeAuthoredClearing = clearingRole === "maze_branch" ||
            clearingRole === "route_structure";
        var needsFallbackSpur = !!pPlacement.fallback ||
            !!pContext.OriginalTerrainTemplate ||
            (denseAuthoredRoute && !routeAuthoredClearing);
        var maxLength = needsFallbackSpur ?
            Number(pContext.Profile.StructureFallbackAccessMaxLength || 48) :
            Number(pContext.Profile.JungleMazeStructureDoorMaxLength || 10);
        if(!best || best.length > Math.max(3, Math.floor(maxLength)))
            return null;

        var painted = 0;
        for(var index = 0; index < best.length; ++index) {
            var cell = best[index];
            if(this.PaintStructureGroundCell(pContext, cell.x, cell.y, pSpec, "route"))
                ++painted;
            MapGen.Layers.Set(pContext.Layers.path, cell.x, cell.y, 1);
            if(pContext.Layers.owner)
                MapGen.Layers.ClaimCell(
                    pContext.Layers.owner,
                    cell.x,
                    cell.y,
                    MapGen.Layers.Owner.ROUTE
                );
        }

        pPlacement.accessPoint = access;
        pPlacement.accessTarget = { x: pTarget.x, y: pTarget.y };
        pPlacement.accessRouteLength = best.length;
        MapGen.Context.AddLog(
            pContext,
            "Opened " + (needsFallbackSpur ? "fallback structure access spur" : "local maze structure doorway connector") +
                " (" + best.length + " cells)"
        );
        return {
            routed: true,
            painted: painted,
            localMazeConnector: !needsFallbackSpur,
            fallbackAccessSpur: needsFallbackSpur
        };
    };

    pIntegration.CarveStructureAccess = function(pContext, pSpec, pPlacement) {
        if(!MapGen.Connectivity || !MapGen.Connectivity.BuildWalkCost)
            return { routed: false, painted: 0 };

        var targets = this.StructureRouteTargets(pContext, pPlacement.rect, 12);
        if(!targets.length)
            return { routed: false, painted: 0 };

        var walkCost = null;
        for(var targetIndex = 0; targetIndex < targets.length; ++targetIndex) {
            var target = targets[targetIndex];
            var access = this.StructureAccessPoint(pPlacement.rect, target, pContext);
            var paintedAccess = this.PaintStructureGroundCell(pContext, access.x, access.y, pSpec, "route");

            if(access.x === target.x && access.y === target.y) {
                pPlacement.accessPoint = access;
                pPlacement.accessTarget = target;
                pPlacement.accessRouteLength = 1;
                return { routed: true, painted: 1 };
            }

            if(!walkCost) {
                walkCost = MapGen.Connectivity.BuildWalkCost(pContext);
            }
            else if(paintedAccess && MapGen.Connectivity.WalkCostAt) {
                MapGen.Connectivity.SetWalkCostCell(
                    pContext,
                    walkCost,
                    access.x,
                    access.y,
                    MapGen.Connectivity.WalkCostAt(pContext, access.x, access.y)
                );
            }

            var result = MapGen.Connectivity.RouteBetween(pContext, walkCost, access, target, "live_structure_access", 1);
            var painted = 0;

            if(result && result.Path) {
                for(var index = 0; index < result.Path.length; ++index) {
                    if(this.PaintStructureGroundCell(pContext, result.Path[index].x, result.Path[index].y, pSpec, "route"))
                        ++painted;
                }

                pPlacement.accessPoint = access;
                pPlacement.accessTarget = target;
                pPlacement.accessRouteLength = result.Path.length;
                return { routed: true, painted: painted };
            }

            // RouteBetween may carve and rebuild internally before failing.
            // Discard the stale caller-held grid so the next target sees the
            // carved cells and any access cells already painted in previous
            // attempts.
            walkCost = null;
        }

        for(var fallbackTargetIndex = 0;
            fallbackTargetIndex < targets.length;
            ++fallbackTargetIndex) {
            var mazeFallback = this.CarveDirectStructureDoorConnector(
                pContext,
                pSpec,
                pPlacement,
                targets[fallbackTargetIndex]
            );
            if(mazeFallback)
                return mazeFallback;
        }
        return { routed: false, painted: 0 };
    };

    pIntegration.PrepareStructureSite = function(pContext, pSpec, pPlacement) {
        if(!pContext || !pPlacement || !pPlacement.rect)
            return;

        var apronTiles = this.PaintStructureClearance(pContext, pSpec, pPlacement);
        var route = this.CarveStructureAccess(pContext, pSpec, pPlacement);
        // In a dense maze the access cell painted above can already touch a
        // walkable corridor, yet A* may refuse to cross the still-reserved
        // routing-wall bookkeeping around the building. That is still a real
        // doorway and is sufficient for runtime objective validation; retain
        // it as the building access point instead of dropping the placement's
        // access metadata and rejecting an otherwise reachable bunker.
        if(!route.routed && pContext.Profile &&
            (pContext.Profile.JungleMazeRouteTopology === true ||
                String(pContext.Profile.Name || "") ===
                    "grammar_jungle_neck")) {
            var target = this.NearestStructureRoutePoint(pContext, pPlacement.rect);
            var localAccess = this.StructureAccessPoint(pPlacement.rect, target, pContext);
            var touchesRoute = false;
            if(localAccess && target) {
                touchesRoute = Math.abs(localAccess.x - target.x) +
                    Math.abs(localAccess.y - target.y) <= 1;
                for(var neighbourIndex = 0;
                    !touchesRoute && neighbourIndex < 4;
                    ++neighbourIndex) {
                    var neighbourX = localAccess.x + [1, -1, 0, 0][neighbourIndex];
                    var neighbourY = localAccess.y + [0, 0, 1, -1][neighbourIndex];
                    touchesRoute = !!(
                        MapGen.Layers.Get(pContext.Layers.path, neighbourX, neighbourY, 0) ||
                        MapGen.Layers.Get(pContext.Layers.keepClear, neighbourX, neighbourY, 0)
                    );
                }
            }
            if(localAccess && touchesRoute && this.PaintStructureGroundCell(
                pContext, localAccess.x, localAccess.y, pSpec, "route")) {
                MapGen.Layers.Set(pContext.Layers.path, localAccess.x, localAccess.y, 1);
                pPlacement.accessPoint = localAccess;
                pPlacement.accessTarget = target || localAccess;
                pPlacement.accessRouteLength = 1;
                route = { routed: true, painted: 1, localMazeDoorway: true };
            }
        }
        // A placement can already be reachable even when the synthetic A*
        // connector cannot reconstruct an approach through reservation or
        // bridge bookkeeping. Always retain a clear painted cardinal doorway
        // as the placement access point. Live validation separately checks
        // that every recorded doorway is reachable, so genuinely isolated
        // buildings still fail instead of being hidden by this fallback.
        if(!route.routed) {
            var sourceTarget = this.NearestStructureRoutePoint(
                pContext, pPlacement.rect);
            var sourceAccess = this.StructureAccessPoint(
                pPlacement.rect, sourceTarget, pContext);
            if(sourceAccess && this.PaintStructureGroundCell(
                pContext, sourceAccess.x, sourceAccess.y, pSpec, "route")) {
                MapGen.Layers.Set(pContext.Layers.path,
                    sourceAccess.x, sourceAccess.y, 1);
                pPlacement.accessPoint = sourceAccess;
                pPlacement.accessTarget = sourceTarget || sourceAccess;
                pPlacement.accessRouteLength = 1;
                route = { routed: true, painted: 1, retainedCardinalDoorway: true };
            }
        }
        var contextCover = this.ApplyStructureContextCover(pContext, pSpec, pPlacement);

        if(pContext && MapGen.Context && MapGen.Context.AddLog) {
            MapGen.Context.AddLog(
                pContext,
                "Prepared structure site " + (pSpec.building || "structure") +
                    " apron " + apronTiles +
                    " access " + (route.routed ? route.painted : "failed") +
                    " cover " + contextCover
            );
        }
    };
})(MapGen.Integration);
