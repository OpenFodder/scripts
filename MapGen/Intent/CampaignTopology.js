var MapGen = MapGen || {};
MapGen.Intent = MapGen.Intent || {};
MapGen.Intent.Pipeline = MapGen.Intent.Pipeline || {};

// Secondary routes and geographic distribution, independent of materialization.
(function(pIntent) {
    function intentIndex(pMap, pX, pY) {
        return (pY * pMap.width) + pX;
    }

    function intentInBounds(pMap, pX, pY, pMargin) {
        var margin = pMargin || 0;
        return pX >= margin && pY >= margin &&
            pX < pMap.width - margin && pY < pMap.height - margin;
    }

    function topologyHardCell(pMap, pX, pY) {
        if(!intentInBounds(pMap, pX, pY, 2)) { return true; }
        var T = pIntent.Terrain;
        var C = pIntent.Claim;
        var terrain = pMap.terrain[intentIndex(pMap, pX, pY)];
        if(terrain === T.WATER || terrain === T.COAST ||
            terrain === T.BEACH || terrain === T.RIVER ||
            terrain === T.RIVERBANK || terrain === T.CLIFF_BODY ||
            terrain === T.CLIFF_TOP || terrain === T.OUTCROP) {
            return true;
        }
        var claim = pMap.claim[intentIndex(pMap, pX, pY)];
        return (claim & (C.STRUCT_FLOOR | C.STRUCT_WALL | C.COMPOUND |
            C.OBJECTIVE | C.SPAWN_SAFE)) !== 0;
    }

    function topologyDistanceSquared(pA, pB) {
        var dx = pA.x - pB.x;
        var dy = pA.y - pB.y;
        return (dx * dx) + (dy * dy);
    }

    function topologyDistanceToRoute(pPoint, pRoute) {
        var best = 0x7fffffff;
        for(var i = 0; i < pRoute.length; ++i) {
            var d2 = topologyDistanceSquared(pPoint, pRoute[i]);
            if(d2 < best) { best = d2; }
        }
        return Math.sqrt(best);
    }

    // Eight-neighbour search yields diagonal legs. The stamped radius below
    // still guarantees orthogonal connectivity for engine movement.
    function findTopologyPath(pMap, pStart, pEnd, pPrimaryMask, pUsedMask,
        pAllowUsedEnd) {
        var W = pMap.width;
        var H = pMap.height;
        var total = W * H;
        var startIndex = intentIndex(pMap, pStart.x, pStart.y);
        var endIndex = intentIndex(pMap, pEnd.x, pEnd.y);
        var sx = pEnd.x >= pStart.x ? 1 : -1;
        var sy = pEnd.y >= pStart.y ? 1 : -1;
        // Candidates sharing an anchor and direction quadrant use the exact
        // same BFS ordering. Resume that search instead of exploring the same
        // terrain for every candidate. Endpoints with special entry permission
        // retain a separate search, since they change the traversable graph.
        var cache = null;
        var cacheKey = startIndex + ":" + sx + ":" + sy;
        if(pUsedMask && !pPrimaryMask[endIndex] && !pUsedMask[endIndex]) {
            cache = pUsedMask._topologyPathCache || {};
            pUsedMask._topologyPathCache = cache;
        }
        var search = cache ? cache[cacheKey] : null;
        if(!search) {
            var initialPred = new Int32Array(total);
            for(var pi = 0; pi < total; ++pi) { initialPred[pi] = -2; }
            initialPred[startIndex] = startIndex;
            search = { pred: initialPred, queueX: [pStart.x], queueY: [pStart.y], head: 0 };
            if(cache) cache[cacheKey] = search;
        }
        var pred = search.pred;
        var queueX = search.queueX;
        var queueY = search.queueY;
        var head = search.head;
        var dirs = [
            sx, sy, sx, 0, 0, sy, -sx, sy,
            sx, -sy, -sx, 0, 0, -sy, -sx, -sy
        ];
        while(pred[endIndex] === -2 && head < queueX.length) {
            var x = queueX[head];
            var y = queueY[head++];
            for(var di = 0; di < dirs.length; di += 2) {
                var nx = x + dirs[di];
                var ny = y + dirs[di + 1];
                if(!intentInBounds(pMap, nx, ny, 2)) { continue; }
                var ni = (ny * W) + nx;
                if(pred[ni] !== -2 || topologyHardCell(pMap, nx, ny)) { continue; }
                if(ni !== endIndex && pPrimaryMask[ni]) { continue; }
                if(pUsedMask && pUsedMask[ni] &&
                    !(pAllowUsedEnd && ni === endIndex)) { continue; }
                pred[ni] = (y * W) + x;
                queueX.push(nx);
                queueY.push(ny);
            }
        }
        search.head = head;
        if(pred[endIndex] === -2) { return null; }
        var path = [];
        var cursor = endIndex;
        while(cursor !== pred[cursor]) {
            path.push({ x: cursor % W, y: Math.floor(cursor / W) });
            cursor = pred[cursor];
        }
        path.push({ x: pStart.x, y: pStart.y });
        path.reverse();
        var direct = Math.max(Math.abs(pEnd.x - pStart.x),
            Math.abs(pEnd.y - pStart.y));
        if(path.length > (direct * 2.75) + 18) { return null; }
        return path;
    }

    function stampTopologyCell(pMap, pX, pY) {
        if(!intentInBounds(pMap, pX, pY, 2) ||
            topologyHardCell(pMap, pX, pY)) { return; }
        var M = pIntent.Movement;
        pIntent.Map.SetTerrain(pMap, pX, pY, pIntent.Terrain.LAND);
        pIntent.Map.ClearMovement(pMap, pX, pY, M.BLOCKED);
        pIntent.Map.AddMovement(pMap, pX, pY,
            M.WALKABLE | M.ROUTE_SECONDARY | M.KEEP_CLEAR);
        pIntent.Map.SetOwner(pMap, pX, pY, pIntent.Owner.OPEN);
    }

    function stampTopologyPath(pMap, pPoints, pRadius, pUsedMask) {
        // Stamping changes both used cells and terrain reservations.
        pUsedMask._topologyPathCache = null;
        var radius = Math.max(0, pRadius | 0);
        for(var i = 0; i < pPoints.length; ++i) {
            for(var oy = -radius; oy <= radius; ++oy) {
                for(var ox = -radius; ox <= radius; ++ox) {
                    if((ox * ox) + (oy * oy) > (radius * radius) + 1) { continue; }
                    var x = pPoints[i].x + ox;
                    var y = pPoints[i].y + oy;
                    stampTopologyCell(pMap, x, y);
                    if(intentInBounds(pMap, x, y, 0)) {
                        pUsedMask[intentIndex(pMap, x, y)] = 1;
                    }
                }
            }
        }
    }

    function clearTopologySite(pMap, pPoint, pRadius) {
        var radius = Math.max(2, pRadius | 0);
        for(var oy = -radius; oy <= radius; ++oy) {
            for(var ox = -radius; ox <= radius; ++ox) {
                if((ox * ox) + (oy * oy) > radius * radius) { continue; }
                stampTopologyCell(pMap, pPoint.x + ox, pPoint.y + oy);
            }
        }
    }

    function topologyDesiredCount(pContext, pPrimaryLength) {
        var minSide = Math.min(pContext.Width, pContext.Height);
        var area = pContext.Width * pContext.Height;
        var capacity = minSide < 38 ? 1 :
            (area < 3200 ? 2 : (area < 5600 ? 3 : 4));
        var sizeFloor = area >= 5600 ? 3 : (area >= 3200 ? 2 : 1);
        var configured = Number(pContext.Profile &&
            pContext.Profile.CampaignSpurCount);
        if(!isFinite(configured) || configured < 1) { configured = capacity; }
        var desired = Math.max(1, Math.min(capacity,
            Math.max(sizeFloor, Math.round(configured))));
        if(pPrimaryLength < 32) { desired = Math.min(desired, 1); }
        return desired;
    }

    function topologyRoutePhase(pFraction) {
        if(pFraction < 0.34) { return "early"; }
        if(pFraction < 0.68) { return "mid"; }
        return "late";
    }

    // Side routes are mission beats, not decoration. Spread their attachment
    // points across progression phases so a medium/large map cannot put every
    // optional destination in the middle third of the same journey.
    function topologySpurFraction(pIndex, pCount) {
        if(pCount <= 1) { return 0.50; }
        if(pCount === 2) { return pIndex === 0 ? 0.24 : 0.76; }
        return 0.18 + ((pIndex / (pCount - 1)) * 0.64);
    }

    function topologyCandidate(pMap, pRoute, pRouteIndex, pSide,
        pDistance, pAlong, pSites) {
        var before = pRoute[Math.max(0, pRouteIndex - 4)];
        var after = pRoute[Math.min(pRoute.length - 1, pRouteIndex + 4)];
        var tx = after.x - before.x;
        var ty = after.y - before.y;
        var length = Math.sqrt((tx * tx) + (ty * ty));
        if(length < 0.5) { tx = 1; ty = 0; length = 1; }
        tx /= length;
        ty /= length;
        var nx = -ty * pSide;
        var ny = tx * pSide;
        var anchor = pRoute[pRouteIndex];
        var candidate = {
            x: Math.round(anchor.x + (nx * pDistance) + (tx * pAlong)),
            y: Math.round(anchor.y + (ny * pDistance) + (ty * pAlong))
        };
        if(!intentInBounds(pMap, candidate.x, candidate.y, 6) ||
            topologyHardCell(pMap, candidate.x, candidate.y) ||
            topologyDistanceToRoute(candidate, pRoute) < 6) {
            return null;
        }
        for(var i = 0; i < pSites.length; ++i) {
            if(topologyDistanceSquared(candidate, pSites[i]) < 100) { return null; }
        }
        return candidate;
    }

    function topologySector(pMap, pPoint) {
        return {
            x: Math.max(0, Math.min(2,
                Math.floor(pPoint.x * 3 / Math.max(1, pMap.width)))),
            y: Math.max(0, Math.min(2,
                Math.floor(pPoint.y * 3 / Math.max(1, pMap.height))))
        };
    }

    // A viable detour is not automatically a useful detour. Score all viable
    // candidates so large maps claim different geographic sectors instead of
    // accepting the first side of the trunk that happens to path successfully.
    function topologyCandidateScore(pMap, pCandidate, pSites, pTargetRow,
        pTargetColumn) {
        var sector = topologySector(pMap, pCandidate);
        var occupied = false;
        var nearestSite = 0x7fffffff;
        for(var i = 0; i < pSites.length; ++i) {
            var siteSector = topologySector(pMap, pSites[i]);
            if(siteSector.x === sector.x && siteSector.y === sector.y)
                occupied = true;
            nearestSite = Math.min(nearestSite,
                Math.sqrt(topologyDistanceSquared(pCandidate, pSites[i])));
        }
        var score = occupied ? -240 : 180;
        if(pTargetRow !== null && pTargetRow !== undefined)
            score += 360 - (Math.abs(sector.y - pTargetRow) * 300);
        if(pTargetColumn !== null && pTargetColumn !== undefined)
            score += 120 - (Math.abs(sector.x - pTargetColumn) * 90);
        if(nearestSite < 0x7fffffff)
            score += Math.min(80, nearestSite * 2);
        return score;
    }

    // A perpendicular offset cannot reach north/south sectors when the local
    // trunk is nearly vertical. XL maps therefore get a bounded geographic
    // fallback: sample the requested sector band and route the best reachable
    // point back to the same progression anchor.
    function topologyTargetedSpur(pMap, pRoute, pRouteIndex, pTargetRow,
        pTargetColumn, pSites, pPrimaryMask, pUsedMask) {
        var rowMin = Math.max(7,
            Math.floor((pMap.height * pTargetRow) / 3) + 6);
        var rowMax = Math.min(pMap.height - 8,
            Math.floor((pMap.height * (pTargetRow + 1)) / 3) - 6);
        if(rowMax < rowMin) { return null; }
        var columnOrder = [pTargetColumn];
        for(var column = 0; column < 3; ++column) {
            if(column !== pTargetColumn) { columnOrder.push(column); }
        }
        var samples = [0.50, 0.25, 0.75, 0.10, 0.90];
        var anchor = pRoute[pRouteIndex];
        var best = null;
        var bestScore = -999999;
        for(var ci = 0; ci < columnOrder.length; ++ci) {
            var targetColumn = columnOrder[ci];
            var columnMin = Math.max(7,
                Math.floor((pMap.width * targetColumn) / 3) + 6);
            var columnMax = Math.min(pMap.width - 8,
                Math.floor((pMap.width * (targetColumn + 1)) / 3) - 6);
            if(columnMax < columnMin) { continue; }
            for(var yi = 0; yi < samples.length; ++yi) {
                for(var xi = 0; xi < samples.length; ++xi) {
                    var candidate = {
                        x: Math.round(columnMin +
                            ((columnMax - columnMin) * samples[xi])),
                        y: Math.round(rowMin +
                            ((rowMax - rowMin) * samples[yi]))
                    };
                    if(topologyHardCell(pMap, candidate.x, candidate.y) ||
                        topologyDistanceToRoute(candidate, pRoute) < 6) {
                        continue;
                    }
                    var overlapsSite = false;
                    for(var siteIndex = 0; siteIndex < pSites.length;
                        ++siteIndex) {
                        if(topologyDistanceSquared(candidate,
                            pSites[siteIndex]) < 100) {
                            overlapsSite = true;
                            break;
                        }
                    }
                    if(overlapsSite) { continue; }
                    var path = findTopologyPath(pMap, anchor, candidate,
                        pPrimaryMask, pUsedMask, false);
                    if(!path || path.length < 7) { continue; }
                    var score = topologyCandidateScore(pMap, candidate,
                        pSites, pTargetRow, pTargetColumn) - path.length -
                        (ci * 35);
                    if(score > bestScore) {
                        best = { candidate: candidate, path: path };
                        bestScore = score;
                    }
                }
            }
        }
        return best;
    }

    pIntent.Pipeline.AuthorCampaignTopology = function(pContext, pIntentMap,
        pRng) {
        var anchors = pIntentMap && pIntentMap.anchors;
        var plan = {
            required: 0,
            desired: 0,
            routes: [],
            sites: [],
            failed: 0,
            phaseTargets: { early: 0, mid: 0, late: 0 },
            phaseAuthored: { early: 0, mid: 0, late: 0 },
            sectorTargets: [],
            sectorAuthored: []
        };
        pContext.IntentTopologyPlan = plan;
        if(!anchors || !anchors.start || !anchors.objective) { return plan; }
        var primary = pIntent.Pipeline.ExtractRoutePoints(pIntentMap,
            anchors.start, anchors.objective);
        if(!primary || primary.length < 16) { return plan; }
        var desired = topologyDesiredCount(pContext, primary.length);
        plan.desired = desired;
        // Three legs are desirable on a large map, but two genuinely useful
        // detours are the hard gameplay floor. XL maps must fit three.
        plan.required = desired >= 4 ? 3 : desired;
        plan.primaryLength = primary.length;
        var total = pIntentMap.width * pIntentMap.height;
        var primaryMask = new Uint8Array(total);
        var usedMask = new Uint8Array(total);
        for(var pm = 0; pm < primary.length; ++pm) {
            primaryMask[intentIndex(pIntentMap, primary[pm].x, primary[pm].y)] = 1;
        }
        var minSide = Math.min(pContext.Width, pContext.Height);
        var topologyArea = pContext.Width * pContext.Height;
        var isXLTopology = topologyArea >= 10000;
        var topologyDistanceScale = topologyArea >= 10000 ? 0.30 :
            (topologyArea >= 6000 ? 0.27 : 0.23);
        var topologyDistanceCeiling = topologyArea >= 10000 ? 34 :
            (topologyArea >= 6000 ? 28 : 20);
        var baseDistance = Math.max(9, Math.min(
            topologyDistanceCeiling,
            Math.round(minSide * topologyDistanceScale)
        ));
        var initialSide = pRng && pRng.Chance && pRng.Chance(0.5) ? 1 : -1;
        var wantsLoop = desired >= 3 && primary.length >= 44 && minSide >= 46;
        var spurCount = desired - (wantsLoop ? 1 : 0);
        for(var si = 0; si < spurCount; ++si) {
            var fraction = topologySpurFraction(si, spurCount);
            var routePhase = topologyRoutePhase(fraction);
            plan.phaseTargets[routePhase] += 1;
            var routeIndex = Math.max(4, Math.min(primary.length - 5,
                Math.floor((primary.length - 1) * fraction)));
            var anchor = primary[routeIndex];
            var accepted = null;
            var acceptedPath = null;
            var acceptedScore = -999999;
            // XL campaigns deliberately use north, south and middle sectors.
            // This makes the space away from the trunk hold real destinations,
            // not merely decorative cover.
            var targetRow = isXLTopology ? [0, 2, 1][si % 3] : null;
            var targetColumn = null;
            if(isXLTopology) {
                if(targetRow === 0)
                    targetColumn = 2 - topologySector(pIntentMap,
                        anchors.objective).x;
                else if(targetRow === 2)
                    targetColumn = 2 - topologySector(pIntentMap,
                        anchors.start).x;
                else
                    targetColumn = Math.max(0, Math.min(2,
                        Math.floor(fraction * 3)));
            }
            if(isXLTopology)
                plan.sectorTargets.push(targetColumn + "," + targetRow);
            for(var attempt = 0; attempt < 24; ++attempt) {
                var side = initialSide * (((si + attempt) % 2) ? -1 : 1);
                var distJitter = pRng && pRng.Int ? pRng.Int(-4, 6) :
                    (attempt % 6) - 2;
                var along = pRng && pRng.Int ? pRng.Int(-5, 5) : attempt - 5;
                var candidate = topologyCandidate(pIntentMap, primary,
                    routeIndex, side, Math.max(7, baseDistance + distJitter),
                    along, plan.sites);
                if(!candidate) { continue; }
                var path = findTopologyPath(pIntentMap, anchor, candidate,
                    primaryMask, usedMask, false);
                if(!path || path.length < 7) { continue; }
                var candidateScore = topologyCandidateScore(pIntentMap,
                    candidate, plan.sites, targetRow, targetColumn);
                candidateScore += (Math.abs(Number(candidate.x * 31 +
                    candidate.y * 17 + attempt)) % 100) / 100;
                if(candidateScore > acceptedScore) {
                    accepted = candidate;
                    acceptedPath = path;
                    acceptedScore = candidateScore;
                }
            }
            if(isXLTopology && (!accepted ||
                topologySector(pIntentMap, accepted).y !== targetRow)) {
                var targeted = topologyTargetedSpur(pIntentMap, primary,
                    routeIndex, targetRow, targetColumn, plan.sites,
                    primaryMask, usedMask);
                if(targeted) {
                    accepted = targeted.candidate;
                    acceptedPath = targeted.path;
                }
            }
            if(!accepted) { plan.failed += 1; continue; }
            accepted.routeFraction = fraction;
            accepted.routePhase = routePhase;
            accepted.topologyPurpose = si % 2 === 0 ?
                "pickup_detour" : "structure_detour";
            var acceptedSector = topologySector(pIntentMap, accepted);
            accepted.sector = acceptedSector.x + "," + acceptedSector.y;
            plan.sectorAuthored.push(accepted.sector);
            plan.phaseAuthored[routePhase] += 1;
            stampTopologyPath(pIntentMap, acceptedPath, 1, usedMask);
            clearTopologySite(pIntentMap, accepted, 6);
            plan.sites.push(accepted);
            plan.routes.push({
                role: "spur",
                purpose: accepted.topologyPurpose,
                routeFraction: fraction,
                routePhase: routePhase,
                radius: 1,
                anchor: { x: anchor.x, y: anchor.y },
                site: { x: accepted.x, y: accepted.y },
                points: acceptedPath
            });
        }
        if(wantsLoop) {
            var aIndex = Math.max(4, Math.floor(primary.length * 0.35));
            var bIndex = Math.min(primary.length - 5,
                Math.floor(primary.length * 0.66));
            var loopFraction = ((aIndex + bIndex) / 2) /
                Math.max(1, primary.length - 1);
            var loopPhase = topologyRoutePhase(loopFraction);
            plan.phaseTargets[loopPhase] += 1;
            var loopMade = false;
            var loopAccepted = null;
            var loopAcceptedPathA = null;
            var loopAcceptedPathB = null;
            var loopAcceptedScore = -999999;
            var loopTargetRow = isXLTopology ? 1 : null;
            var loopTargetColumn = isXLTopology ? 1 : null;
            if(isXLTopology)
                plan.sectorTargets.push(loopTargetColumn + "," + loopTargetRow);
            for(var loopAttempt = 0; loopAttempt < 24; ++loopAttempt) {
                var loopSide = -initialSide * (loopAttempt % 2 ? -1 : 1);
                var loopCandidate = topologyCandidate(pIntentMap, primary,
                    Math.floor((aIndex + bIndex) / 2), loopSide,
                    baseDistance + 2 + (loopAttempt % 4),
                    (loopAttempt % 5) - 2, plan.sites);
                if(!loopCandidate) { continue; }
                var pathA = findTopologyPath(pIntentMap, primary[aIndex],
                    loopCandidate, primaryMask, usedMask, false);
                if(!pathA || pathA.length < 7) { continue; }
                var combinedUsed = new Uint8Array(total);
                for(var ui = 0; ui < total; ++ui) { combinedUsed[ui] = usedMask[ui]; }
                for(var pa = 1; pa < pathA.length - 1; ++pa) {
                    combinedUsed[intentIndex(pIntentMap, pathA[pa].x,
                        pathA[pa].y)] = 1;
                }
                var pathB = findTopologyPath(pIntentMap, primary[bIndex],
                    loopCandidate, primaryMask, combinedUsed, true);
                if(!pathB || pathB.length < 7) { continue; }
                var loopScore = topologyCandidateScore(pIntentMap,
                    loopCandidate, plan.sites, loopTargetRow,
                    loopTargetColumn);
                if(loopScore > loopAcceptedScore) {
                    loopAccepted = loopCandidate;
                    loopAcceptedPathA = pathA;
                    loopAcceptedPathB = pathB;
                    loopAcceptedScore = loopScore;
                }
            }
            if(loopAccepted) {
                var loopCandidate = loopAccepted;
                var pathA = loopAcceptedPathA;
                var pathB = loopAcceptedPathB;
                pathB.reverse();
                var loopPoints = pathA.concat(pathB.slice(1));
                stampTopologyPath(pIntentMap, loopPoints, 1, usedMask);
                loopCandidate.routeFraction = loopFraction;
                loopCandidate.routePhase = loopPhase;
                loopCandidate.topologyPurpose = "flank_site";
                var loopSector = topologySector(pIntentMap, loopCandidate);
                loopCandidate.sector = loopSector.x + "," + loopSector.y;
                plan.sectorAuthored.push(loopCandidate.sector);
                plan.phaseAuthored[loopPhase] += 1;
                clearTopologySite(pIntentMap, loopCandidate, 6);
                plan.sites.push(loopCandidate);
                plan.routes.push({
                    role: "flank_loop",
                    purpose: "flank_site",
                    routeFraction: loopFraction,
                    routePhase: loopPhase,
                    radius: 1,
                    anchor: { x: primary[aIndex].x, y: primary[aIndex].y },
                    rejoin: { x: primary[bIndex].x, y: primary[bIndex].y },
                    site: { x: loopCandidate.x, y: loopCandidate.y },
                    points: loopPoints
                });
                loopMade = true;
            }
            if(!loopMade) { plan.failed += 1; }
        }
        // A water/cliff pocket can defeat the preferred loop geometry. Fill
        // any missing hard-contract slots with independently routed detours so
        // one unlucky macro feature does not make an otherwise playable seed
        // unsaveable.
        var fillFractions = [];
        if(plan.phaseTargets.early > 0 && plan.phaseAuthored.early === 0)
            fillFractions.push(0.27);
        if(plan.phaseTargets.mid > 0 && plan.phaseAuthored.mid === 0)
            fillFractions.push(0.50);
        if(plan.phaseTargets.late > 0 && plan.phaseAuthored.late === 0)
            fillFractions.push(0.73);
        fillFractions = fillFractions.concat([0.27, 0.48, 0.73, 0.61]);
        var missingTargetPhase = function() {
            return (plan.phaseTargets.early > 0 && plan.phaseAuthored.early === 0) ||
                (plan.phaseTargets.mid > 0 && plan.phaseAuthored.mid === 0) ||
                (plan.phaseTargets.late > 0 && plan.phaseAuthored.late === 0);
        };
        for(var fillSlot = 0;
            (plan.routes.length < plan.required || missingTargetPhase()) &&
                fillSlot < fillFractions.length;
            ++fillSlot) {
            var fillIndex = Math.max(4, Math.min(primary.length - 5,
                Math.floor((primary.length - 1) * fillFractions[fillSlot])));
            var fillFraction = fillIndex / Math.max(1, primary.length - 1);
            var fillPhase = topologyRoutePhase(fillFraction);
            var fillAnchor = primary[fillIndex];
            var fillSite = null;
            var fillPath = null;
            for(var fillAttempt = 0; fillAttempt < 16 && !fillSite; ++fillAttempt) {
                var fillSide = initialSide *
                    ((fillSlot + fillAttempt) % 2 ? -1 : 1);
                var fillCandidate = topologyCandidate(pIntentMap, primary,
                    fillIndex, fillSide,
                    baseDistance + (fillAttempt % 5),
                    ((fillAttempt * 3) % 11) - 5, plan.sites);
                if(!fillCandidate) { continue; }
                var candidatePath = findTopologyPath(pIntentMap, fillAnchor,
                    fillCandidate, primaryMask, usedMask, false);
                if(!candidatePath || candidatePath.length < 7) { continue; }
                fillSite = fillCandidate;
                fillPath = candidatePath;
            }
            if(!fillSite) { continue; }
            fillSite.routeFraction = fillFraction;
            fillSite.routePhase = fillPhase;
            fillSite.topologyPurpose = "fallback_detour";
            plan.phaseAuthored[fillPhase] += 1;
            stampTopologyPath(pIntentMap, fillPath, 1, usedMask);
            clearTopologySite(pIntentMap, fillSite, 6);
            plan.sites.push(fillSite);
            plan.routes.push({
                role: "spur",
                purpose: "fallback_detour",
                routeFraction: fillFraction,
                routePhase: fillPhase,
                radius: 1,
                anchor: { x: fillAnchor.x, y: fillAnchor.y },
                site: { x: fillSite.x, y: fillSite.y },
                points: fillPath
            });
        }
        pIntentMap.routes = pIntentMap.routes || [];
        for(var ri = 0; ri < plan.routes.length; ++ri) {
            pIntentMap.routes.push(plan.routes[ri]);
        }
        MapGen.Context.AddLog(pContext, "intent topology: routes=" +
            plan.routes.length + "/" + plan.desired + " sites=" +
            plan.sites.length + " failed=" + plan.failed);
        return plan;
    };

    pIntent.Pipeline.topologyRoutePhase = topologyRoutePhase;
})(MapGen.Intent);
