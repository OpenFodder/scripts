var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// Failure-only dense search fills gaps in the fast route-index/distance ladder.
// Record the actual route fraction and retain all footprint/spacing/path checks.
MapGen.Layout.RouteSiteSearch = {
    Find: function(c, route, site, order, count, sites, budget) {
        var planner = MapGen.Layout.CriticalSites;
        var points = route.points || [], last = points.length - 1;
        if(last < 7)
            return null;
        var fraction = planner.RouteSiteFraction(c, site, order, count);
        var base = planner.RoutePointIndex(route, fraction);
        var profile = c.Profile || {};
        var limit = Number(profile.MaxRouteSideSiteDistance === undefined ? 18 : profile.MaxRouteSideSiteDistance);
        if(!isFinite(limit) || limit < 2)
            return null;
        var maxDistance = Math.min(32, Math.floor(limit));
        var preferred = planner.PreferredRouteSiteSide(c, site, order);
        var checks = 0, probes = 0, seen = {}, candidates = [];
        var checkLimit = budget && budget.checksLeft !== undefined ?
            Math.max(0, Math.floor(Number(budget.checksLeft))) : 4096;
        var probeLimit = budget && budget.probesLeft !== undefined ?
            Math.max(0, Math.floor(Number(budget.probesLeft))) : 32;
        if(checkLimit <= 0 || probeLimit <= 0) return null;
        var ladderLimit = Math.max(1, Math.floor(checkLimit * 0.5));
        for(var delta = 0; delta < last && checks < ladderLimit; ++delta) {
            for(var direction = 0; direction < (delta ? 2 : 1) && checks < ladderLimit; ++direction) {
                var index = base + (direction ? -delta : delta);
                if(index < 2 || index > last - 2)
                    continue;
                for(var distance = 2; distance <= maxDistance && checks < ladderLimit; ++distance) {
                    for(var side = 0; side < 2 && checks < ladderLimit; ++side) {
                        ++checks;
                        var sign = side ? -preferred : preferred;
                        var point = planner.RouteSidePoint(c, route, index, sign, distance, site.role);
                        var key = point.x + "," + point.y;
                        if(seen[key])
                            continue;
                        seen[key] = true;
                        var anchor = points[index], dx = point.x - anchor.x, dy = point.y - anchor.y;
                        if(dx * dx + dy * dy > maxDistance * maxDistance ||
                            !planner.IsRouteSideCandidate(c, point, site, sites, true))
                            continue;
                        point.routeAnchor = {x: anchor.x, y: anchor.y};
                        point.routeIndex = index;
                        point.routeOffset = distance * sign;
                        planner.RouteSiteQuality(c, point, site, anchor, distance, index / last, order);
                        candidates.push(point);
                    }
                }
            }
        }
        // The normal ladder can miss legal diagonal/off-normal cells. Spend
        // the remaining bounded checks on a coarse whole-map lattice. A
        // nearest route vertex supplies the concrete anchor and tangent.
        if(!candidates.length) {
            var gridChecks = Math.max(1, checkLimit - checks);
            var stride = Math.max(1, Math.ceil(Math.sqrt((c.Width * c.Height) / gridChecks)));
            for(var gridX = 2; gridX < c.Width - 2 && checks < checkLimit; gridX += stride) {
                for(var gridY = 2; gridY < c.Height - 2 && checks < checkLimit; gridY += stride) {
                    ++checks;
                    var gridPoint = {x: gridX, y: gridY, role: site.role};
                    var gridKey = gridX + "," + gridY;
                    if(seen[gridKey] || !planner.IsRouteSideCandidate(c, gridPoint, site, sites, true))
                        continue;
                    var nearestIndex = -1, nearestDistance = maxDistance * maxDistance + 1;
                    for(var routeIndex = 2; routeIndex <= last - 2; ++routeIndex) {
                        var routePoint = points[routeIndex];
                        var dx = gridX - routePoint.x, dy = gridY - routePoint.y;
                        var distanceSq = dx * dx + dy * dy;
                        if(distanceSq < nearestDistance) {
                            nearestDistance = distanceSq;
                            nearestIndex = routeIndex;
                        }
                    }
                    if(nearestIndex < 0 || nearestDistance > maxDistance * maxDistance)
                        continue;
                    seen[gridKey] = true;
                    var nearest = points[nearestIndex];
                    var tangent = planner.RouteTangent(route, nearestIndex);
                    gridPoint.routeAnchor = {x: nearest.x, y: nearest.y};
                    gridPoint.routeIndex = nearestIndex;
                    gridPoint.routeOffset = Math.round((-
                        tangent.y * (gridX - nearest.x) + tangent.x * (gridY - nearest.y)) * 10) / 10;
                    planner.RouteSiteQuality(c, gridPoint, site, nearest,
                        Math.sqrt(nearestDistance), nearestIndex / last, order);
                    candidates.push(gridPoint);
                }
            }
        }
        candidates.sort(function(a, b) {
            return b.routeQuality - a.routeQuality ||
                Math.abs(a.routeIndex - base) - Math.abs(b.routeIndex - base) ||
                a.routeIndex - b.routeIndex || a.x - b.x || a.y - b.y;
        });
        var selected = null;
        for(var i = 0; i < candidates.length && probes < probeLimit; ++i) {
            ++probes;
            if(planner.RouteSiteConnectable(c, candidates[i], site)) {
                selected = candidates[i];
                break;
            }
        }
        var stats = c.RouteSiteSearch || (c.RouteSiteSearch = {calls: 0, checks: 0, probes: 0, recovered: 0});
        ++stats.calls;
        stats.checks += checks;
        stats.probes += probes;
        if(budget) {
            budget.checksLeft = Math.max(0, (Number(budget.checksLeft) || 0) - checks);
            budget.probesLeft = Math.max(0, (Number(budget.probesLeft) || 0) - probes);
        }
        if(selected)
            ++stats.recovered;
        return selected;
    }
};
