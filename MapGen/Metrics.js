var MapGen = MapGen || {};

MapGen.Metrics = {

    Compute: function(pContext) {
        var layers = pContext.Layers;
        var area = pContext.Width * pContext.Height;
        var water = MapGen.Layers.Count(layers.water, function(pValue) { return !!pValue; });
        var riverBank = MapGen.Layers.Count(layers.riverBank, function(pValue) { return !!pValue; });
        var coast = MapGen.Layers.Count(layers.coast, function(pValue) { return !!pValue; });
        var crossing = MapGen.Layers.Count(layers.crossing, function(pValue) { return !!pValue; });
        var blocked = MapGen.Layers.Count(layers.blocked, function(pValue) { return !!pValue; });
        var treeBlocked = this.TreeBlockedCount(pContext);
        var terrainEdge = MapGen.Layers.Count(layers.terrainEdge, function(pValue) { return !!pValue; });
        var keepClear = this.KeepClearCount(pContext);
        var path = MapGen.Layers.Count(layers.path, function(pValue) { return !!pValue; });
        var routeWalkable = this.RouteWalkableCount(pContext);
        var occupied = MapGen.Layers.Count(layers.occupied, function(pValue) { return !!pValue; });
        var components = this.WalkableComponents(pContext);
        var landMasses = this.LandComponents(pContext);
        var pathMetrics = this.PathMetrics(pContext);
        var clearingMetrics = this.ClearingMetrics(pContext);
        var riverMetrics = this.RiverMetrics(pContext);
        var waterShapeMetrics = this.WaterShapeMetrics(pContext);
        var perimeterDistributionMetrics = this.PerimeterDistributionMetrics(pContext);
        var placementMetrics = this.PlacementMetrics(pContext);
        var screenPacing = this.ScreenPacing(pContext);
        var gameplayUtilization = this.GameplayUtilization(pContext);

        pContext.Metrics = {
            Area: area,
            Counts: {
                water: water,
                riverBank: riverBank,
                coast: coast,
                crossing: crossing,
                blocked: blocked,
                treeBlocked: treeBlocked,
                terrainEdge: terrainEdge,
                keepClear: keepClear,
                path: path,
                routeWalkable: routeWalkable,
                occupied: occupied,
                paths: pContext.Paths.length,
                clearings: pContext.Clearings.length,
                rivers: pContext.Rivers.length,
                ponds: pContext.Ponds.length,
                lakes: pContext.Lakes.length,
                beaches: pContext.Beaches.length,
                crossings: pContext.Crossings.length,
                walkableComponents: components.Count,
                totalWalkable: components.TotalWalkable,
                landComponents: landMasses.Count,
                totalLand: landMasses.TotalLand
            },
            Coverage: {
                water: area ? water / area : 0,
                riverBank: area ? riverBank / area : 0,
                coast: area ? coast / area : 0,
                crossing: area ? crossing / area : 0,
                blocked: area ? blocked / area : 0,
                treeBlocked: area ? treeBlocked / area : 0,
                terrainEdge: area ? terrainEdge / area : 0,
                keepClear: area ? keepClear / area : 0,
                path: area ? path / area : 0,
                routeWalkable: area ? routeWalkable / area : 0,
                occupied: area ? occupied / area : 0,
                largestWalkableComponent: area ? components.Largest / area : 0,
                largestLandComponent: area ? landMasses.Largest / area : 0
            },
            LargestWalkableComponent: components.Largest,
            LargestLandComponent: landMasses.Largest,
            LandMasses: landMasses,
            Paths: pathMetrics,
            Clearings: clearingMetrics,
            Rivers: riverMetrics,
            WaterShape: waterShapeMetrics,
            PerimeterDistribution: perimeterDistributionMetrics,
            Placements: placementMetrics,
            ScreenPacing: screenPacing,
            GameplayUtilization: gameplayUtilization
        };

        return pContext.Metrics;
    },

    // Architecture v3 (P6): per-viewport interest pacing. The original CF1 maps
    // are big but almost never have a dead screen (ViewportPacingAudit:
    // ice empty-screen fraction p75 ~0.5%, jungle 0.0). We tile the map into the
    // audit's 17x13 viewport grid (8x6 stride) and score each screen for
    // interest — cover (trees/blocked), water, cliff, route, or any placed
    // object. A screen with none of those is "dead". This is the runtime
    // enforcement the screen_scale_pacing readiness gate always lacked, and it
    // is what scales interest with map SIZE (more screens => more must stay live)
    // rather than with global fractions. Pure grid iteration: deterministic.
    ScreenPacing: function(pContext) {
        var VIEW_W = 17, VIEW_H = 13, STRIDE_X = 8, STRIDE_Y = 6;
        var layers = pContext.Layers;
        var W = pContext.Width, H = pContext.Height;
        // Per-screen cover floor below which trees don't, on their own, make the
        // screen "interesting" — biome-specific, from the audit overallScreenTargets
        // coverFraction p25 (ice ~0.10, jungle ~0.52). A screen still counts as
        // alive on water/cliff/route/object even below this.
        var jungle = pContext.Profile && pContext.Profile.TerrainType === Terrain.Types.Jungle;
        var coverFloor = jungle ? 0.10 : 0.04;

        var screens = 0, dead = 0, quiet = 0, routeScreens = 0, routeDead = 0, routeQuiet = 0;
        var deadWindows = [], quietWindows = [];
        var routeDeadWindows = [], routeQuietWindows = [];
        var detailLimit = Math.max(1, Math.floor(Number(
            pContext.ScreenPacingDetailLimit || 12)));
        var occupied = layers.occupied, owner = layers.owner;
        var profile = pContext.Profile || {};
        // Live campaign placements are not guaranteed to remain mirrored in
        // Layers.occupied after a local terrain flush. Count their authored
        // tile positions directly so an objective compound, patrol, or pickup
        // cannot be reported as an empty route viewport.
        var pacingActivity = [];
        function addPacingPoint(pPoint) {
            if(!pPoint || !isFinite(Number(pPoint.x)) ||
                !isFinite(Number(pPoint.y)))
                return;
            pacingActivity.push({
                x: Number(pPoint.x),
                y: Number(pPoint.y)
            });
        }
        var liveStructures = pContext.LiveStructurePlacements || [];
        for(var structureIndex = 0;
            structureIndex < liveStructures.length; ++structureIndex) {
            var liveStructure = liveStructures[structureIndex] || {};
            addPacingPoint({
                x: liveStructure.tileX,
                y: liveStructure.tileY
            });
        }
        var liveEnemies = pContext.LiveEnemyPlacements || [];
        for(var enemyIndex = 0; enemyIndex < liveEnemies.length; ++enemyIndex)
            addPacingPoint((liveEnemies[enemyIndex] || {}).point);
        var livePickups = pContext.LivePickupPlacements || [];
        for(var pickupIndex = 0; pickupIndex < livePickups.length; ++pickupIndex)
            addPacingPoint((livePickups[pickupIndex] || {}).point);
        // Metrics run before the engine-side live sprite integration on the v3
        // path, but mission anchors are already final. They identify the start
        // and objective arenas that tactical cover deliberately protects from
        // tree stamping and that later receive players/objective activity.
        var pacingAnchors = pContext.Anchors || {};
        addPacingPoint(pacingAnchors.start);
        addPacingPoint(pacingAnchors.objective);
        // Topology clearings are authored destinations before live sprite
        // integration. Count only semantic route/encounter sites; incidental
        // wilderness openings remain terrain and do not excuse an empty screen.
        var pacingClearings = pContext.Clearings || [];
        for(var clearingIndex = 0;
            clearingIndex < pacingClearings.length; ++clearingIndex) {
            var pacingClearing = pacingClearings[clearingIndex] || {};
            if(pacingClearing.topologySite || pacingClearing.regionId ||
                pacingClearing.routeFraction !== undefined)
                addPacingPoint(pacingClearing);
        }
        var routeCoverFloor = pContext.Profile && pContext.Profile.RouteScreenCoverFloor !== undefined ?
            Number(pContext.Profile.RouteScreenCoverFloor) :
            Math.max(coverFloor, jungle ? 0.12 : 0.08);
        if(isNaN(routeCoverFloor) || routeCoverFloor < 0)
            routeCoverFloor = Math.max(coverFloor, jungle ? 0.12 : 0.08);
        var quietCoverFloor = profile.QuietScreenCoverFloor !== undefined ?
            Number(profile.QuietScreenCoverFloor) :
            (jungle ? 0.18 : 0.09);
        var quietWaterFloor = profile.QuietScreenWaterFloor !== undefined ?
            Number(profile.QuietScreenWaterFloor) :
            0.08;
        var quietCliffFloor = profile.QuietScreenCliffFloor !== undefined ?
            Number(profile.QuietScreenCliffFloor) :
            0.04;
        var quietObjectFloor = profile.QuietScreenObjectFloor !== undefined ?
            Number(profile.QuietScreenObjectFloor) :
            0.06;
        var quietInterestFloor = profile.QuietScreenInterestFloor !== undefined ?
            Number(profile.QuietScreenInterestFloor) :
            (jungle ? 0.18 : 0.11);
        var routeInterestFloor = profile.RouteScreenInterestFloor !== undefined ?
            Number(profile.RouteScreenInterestFloor) :
            Math.max(routeCoverFloor, jungle ? 0.18 : 0.12);

        if(isNaN(quietCoverFloor) || quietCoverFloor < 0)
            quietCoverFloor = jungle ? 0.18 : 0.09;
        if(isNaN(quietWaterFloor) || quietWaterFloor < 0)
            quietWaterFloor = 0.08;
        if(isNaN(quietCliffFloor) || quietCliffFloor < 0)
            quietCliffFloor = 0.04;
        if(isNaN(quietObjectFloor) || quietObjectFloor < 0)
            quietObjectFloor = 0.06;
        if(isNaN(quietInterestFloor) || quietInterestFloor < 0)
            quietInterestFloor = jungle ? 0.18 : 0.11;
        if(isNaN(routeInterestFloor) || routeInterestFloor < 0)
            routeInterestFloor = Math.max(routeCoverFloor, jungle ? 0.18 : 0.12);

        // The camera sees a complete viewport at map edges. Truncated slivers
        // inside the cover-free border are not playable screens.
        function origins(length, view, stride) {
            var last = Math.max(0, length - view), result = [];
            for(var start = 0; start < last; start += stride) result.push(start);
            result.push(last);
            return result;
        }
        var screenX = origins(W, VIEW_W, STRIDE_X), screenY = origins(H, VIEW_H, STRIDE_Y);
        for(var yi = 0; yi < screenY.length; ++yi) {
            var sy = screenY[yi];
            for(var xi = 0; xi < screenX.length; ++xi) {
                var sx = screenX[xi];
                var maxX = Math.min(W, sx + VIEW_W);
                var maxY = Math.min(H, sy + VIEW_H);
                var cells = 0, cover = 0, water = 0, cliff = 0, route = 0, objects = 0;

                for(var x = sx; x < maxX; ++x) {
                    for(var y = sy; y < maxY; ++y) {
                        ++cells;
                        if(MapGen.Layers.Get(layers.water, x, y, 0)) ++water;
                        if(MapGen.Layers.Get(layers.blocked, x, y, 0)) ++cover;
                        if(MapGen.Layers.Get(layers.path, x, y, 0) ||
                            MapGen.Layers.Get(layers.keepClear, x, y, 0)) ++route;
                        if(occupied && MapGen.Layers.Get(occupied, x, y, 0)) ++objects;
                        if(owner && MapGen.Layers.Get(owner, x, y, 0) === MapGen.Layers.Owner.CLIFF) ++cliff;
                    }
                }

                if(cells < 24)
                    continue;

                ++screens;
                var hasRoute = route > 0;
                if(hasRoute) ++routeScreens;
                var liveObjects = 0;
                for(var liveIndex = 0; liveIndex < pacingActivity.length; ++liveIndex) {
                    var livePoint = pacingActivity[liveIndex];
                    if(livePoint.x >= sx && livePoint.x < maxX &&
                        livePoint.y >= sy && livePoint.y < maxY)
                        ++liveObjects;
                }
                var hasLiveActivity = liveObjects > 0;

                var coverFraction = cover / cells;
                var waterFraction = water / cells;
                var cliffFraction = cliff / cells;
                var objectFraction = objects / cells;
                var interestFraction = coverFraction + waterFraction + cliffFraction + objectFraction;
                var hasScreenInterest = hasLiveActivity ||
                    waterFraction >= quietWaterFloor ||
                    cliffFraction >= quietCliffFloor ||
                    coverFraction >= quietCoverFloor ||
                    objectFraction >= quietObjectFloor ||
                    interestFraction >= quietInterestFloor;
                var hasRouteInterest = hasLiveActivity ||
                    waterFraction >= quietWaterFloor ||
                    cliffFraction >= quietCliffFloor ||
                    coverFraction >= routeCoverFloor ||
                    objectFraction >= quietObjectFloor ||
                    interestFraction >= routeInterestFloor;
                var alive = water > 0 || cliff > 0 || objects > 0 ||
                    hasLiveActivity || hasRoute ||
                    coverFraction >= coverFloor;
                var windowDetail = {
                    x: sx,
                    y: sy,
                    cover: Math.round(coverFraction * 1000) / 1000,
                    water: Math.round(waterFraction * 1000) / 1000,
                    cliff: Math.round(cliffFraction * 1000) / 1000,
                    objects: Math.round(objectFraction * 1000) / 1000,
                    liveActivity: liveObjects
                };
                if(!alive) {
                    ++dead;
                    if(deadWindows.length < detailLimit)
                        deadWindows.push(windowDetail);
                }
                if(!hasScreenInterest) {
                    ++quiet;
                    if(quietWindows.length < detailLimit)
                        quietWindows.push(windowDetail);
                }
                if(hasRoute && !(water > 0 || cliff > 0 || objects > 0 ||
                    hasLiveActivity || coverFraction >= routeCoverFloor)) {
                    ++routeDead;
                    if(routeDeadWindows.length < detailLimit)
                        routeDeadWindows.push(windowDetail);
                }
                if(hasRoute && !hasRouteInterest) {
                    ++routeQuiet;
                    if(routeQuietWindows.length < detailLimit)
                        routeQuietWindows.push(windowDetail);
                }
            }
        }

        return {
            screens: screens,
            deadScreens: dead,
            deadFraction: screens ? dead / screens : 0,
            quietScreens: quiet,
            quietFraction: screens ? quiet / screens : 0,
            routeScreens: routeScreens,
            routeDeadScreens: routeDead,
            routeDeadFraction: routeScreens ? routeDead / routeScreens : 0,
            routeQuietScreens: routeQuiet,
            routeQuietFraction: routeScreens ? routeQuiet / routeScreens : 0,
            deadWindows: deadWindows,
            quietWindows: quietWindows,
            routeDeadWindows: routeDeadWindows,
            routeQuietWindows: routeQuietWindows,
            activityPoints: pacingActivity.length,
            viewport: { width: VIEW_W, height: VIEW_H, strideX: STRIDE_X, strideY: STRIDE_Y },
            coverFloor: coverFloor,
            routeCoverFloor: routeCoverFloor,
            quietCoverFloor: quietCoverFloor,
            quietWaterFloor: quietWaterFloor,
            quietCliffFloor: quietCliffFloor,
            quietObjectFloor: quietObjectFloor,
            quietInterestFloor: quietInterestFloor,
            routeInterestFloor: routeInterestFloor
        };
    },

    // A large canvas is only useful when the mission makes the player use it.
    // Pairwise structure distance cannot detect the common bad case where all
    // goals sit on one straight corridor. Measure the authored journey instead:
    // distinct viewport-sized regions, coarse map sectors, route-network reach,
    // route phases, and side routes which genuinely leave the primary path.
    GameplayUtilization: function(pContext) {
        var W = Math.max(1, pContext.Width || 0);
        var H = Math.max(1, pContext.Height || 0);
        var area = W * H;
        var isCampaign = !(MapGen.Context && MapGen.Context.IsMultiplayer &&
            MapGen.Context.IsMultiplayer(pContext));
        var paths = pContext.Paths || [];
        var primary = null;
        var primaryLength = 0;
        var sideRoles = {
            secondary: true,
            flank_loop: true,
            spur: true,
            dead_end: true
        };
        var routeScreens = {};
        var routeScreenCount = 0;
        var SCREEN_W = 17, SCREEN_H = 13;
        var screenCols = Math.max(1, Math.ceil(W / SCREEN_W));
        var screenRows = Math.max(1, Math.ceil(H / SCREEN_H));
        var totalScreens = screenCols * screenRows;
        var index;

        function addScreen(pSet, pPoint) {
            if(!pPoint || typeof pPoint.x !== "number" ||
                typeof pPoint.y !== "number")
                return false;
            var sx = Math.max(0, Math.min(screenCols - 1,
                Math.floor(pPoint.x / SCREEN_W)));
            var sy = Math.max(0, Math.min(screenRows - 1,
                Math.floor(pPoint.y / SCREEN_H)));
            var key = sx + "," + sy;
            if(pSet[key])
                return false;
            pSet[key] = true;
            return true;
        }

        function distanceSquared(pLeft, pRight) {
            var dx = pLeft.x - pRight.x;
            var dy = pLeft.y - pRight.y;
            return (dx * dx) + (dy * dy);
        }

        function nearestPrimary(pPoint) {
            var nearest = { distance: 0, index: 0 };
            if(!primary || !primary.points || !primary.points.length)
                return nearest;
            var best = null;
            for(var pi = 0; pi < primary.points.length; ++pi) {
                var candidate = distanceSquared(pPoint, primary.points[pi]);
                if(best === null || candidate < best) {
                    best = candidate;
                    nearest.index = pi;
                }
            }
            nearest.distance = Math.sqrt(best || 0);
            return nearest;
        }

        for(index = 0; index < paths.length; ++index) {
            var path = paths[index];
            var pointCount = path && path.points ? path.points.length : 0;
            if(path && path.role === "primary" && pointCount > primaryLength) {
                primary = path;
                primaryLength = pointCount;
            }
        }
        if(!primary) {
            for(index = 0; index < paths.length; ++index) {
                var fallbackPath = paths[index];
                var fallbackLength = fallbackPath && fallbackPath.points ?
                    fallbackPath.points.length : 0;
                if(fallbackLength > primaryLength &&
                    fallbackPath.role !== "live_structure_access") {
                    primary = fallbackPath;
                    primaryLength = fallbackLength;
                }
            }
        }

        for(index = 0; index < paths.length; ++index) {
            var routePoints = paths[index] && paths[index].points ?
                paths[index].points : [];
            for(var routePoint = 0; routePoint < routePoints.length; ++routePoint) {
                if(addScreen(routeScreens, routePoints[routePoint]))
                    ++routeScreenCount;
            }
        }

        var focusPoints = [];
        var activityPoints = [];
        function addFocus(pPoint, pKind, pActivity) {
            if(!pPoint || typeof pPoint.x !== "number" ||
                typeof pPoint.y !== "number")
                return;
            var entry = { x: pPoint.x, y: pPoint.y, kind: pKind };
            var hasExplicitFraction = pPoint.routeFraction !== null &&
                pPoint.routeFraction !== undefined && pPoint.routeFraction !== "";
            var explicitFraction = Number(pPoint.routeFraction);
            if(hasExplicitFraction && !isNaN(explicitFraction))
                entry.routeFraction = Math.max(0, Math.min(1, explicitFraction));
            focusPoints.push(entry);
            if(pActivity)
                activityPoints.push(entry);
        }

        var anchors = pContext.Anchors || {};
        addFocus(anchors.start, "start", false);
        addFocus(anchors.objective, "objective", false);

        var structures = pContext.LiveStructurePlacements || [];
        // InAttempt marks native placement/validation before Materialized is
        // set. Even empty live output is authoritative during that phase.
        var usePlan = !pContext.InAttempt && !pContext.Materialized && !structures.length &&
            !(pContext.LivePickupPlacements || []).length && !(pContext.LiveEnemyPlacements || []).length;
        // Before materialization the exact building plan is the authoritative
        // placement proxy. Old clearing centres can lie in entirely different
        // route phases and incorrectly reject an already distributed plan.
        if(usePlan && pContext.GameplayPlan && pContext.GameplayPlan.ok) {
            var planned = pContext.GameplayPlan.entries || [];
            structures = [];
            for(index = 0; index < planned.length; ++index)
                structures.push({rect: planned[index].candidate.rect,
                    routeFraction: planned[index].candidate.clearing.routeFraction});
        }
        for(index = 0; index < structures.length; ++index) {
            var rect = structures[index] ? structures[index].rect : null;
            if(rect) {
                addFocus({
                    x: (rect.minX + rect.maxX) / 2,
                    y: (rect.minY + rect.maxY) / 2,
                    routeFraction: structures[index].routeFraction
                }, "structure", true);
            }
        }

        // Weapon caches are deliberate reasons to traverse a branch or an
        // otherwise optional sector. Count the materialized positions, not the
        // older feature-plan anchors, so map-use validation reflects what the
        // player can actually collect in the saved map.
        var livePickups = pContext.LivePickupPlacements || [];
        for(index = 0; index < livePickups.length; ++index) {
            var pickup = livePickups[index];
            if(!pickup || !pickup.point)
                continue;
            addFocus({
                x: pickup.point.x,
                y: pickup.point.y,
                routeFraction: pickup.routeFraction
            }, "pickup", true);
        }

        // Hostile actors are part of the final mission-space spend. Count the
        // materialized positions so a guarded detour is visible to utilization
        // even when it has no building or weapon box.
        var liveEnemies = pContext.LiveEnemyPlacements || [];
        for(index = 0; index < liveEnemies.length; ++index) {
            var liveEnemy = liveEnemies[index];
            if(!liveEnemy || liveEnemy.dropped || !liveEnemy.point)
                continue;
            addFocus({
                x: liveEnemy.point.x,
                y: liveEnemy.point.y,
                routeFraction: liveEnemy.routeFraction
            }, "enemy", true);
        }

        // Before materialization, exact encounter/pickup positions are the
        // activity plan. Ignoring them rejects guarded routes before their
        // actors can be placed. Once any live output exists, use only that
        // output so failed or dropped placements cannot inflate final use.
        if(usePlan) {
            var placements = pContext.Placements || {};
            var plannedActivity = (placements.enemies || []).concat(placements.pickups || []);
            for(index = 0; index < plannedActivity.length; ++index) {
                var activity = plannedActivity[index];
                if(activity && activity.point)
                    addFocus({x: activity.point.x, y: activity.point.y,
                        routeFraction: activity.routeFraction}, "planned_activity", true);
            }
        }

        var topology = pContext.IntentTopologyPlan || null;
        var topologySites = topology && topology.sites ? topology.sites : [];
        // Topology sites are a plan-time proxy only. Once live actors or
        // structures exist, counting every authored site would let an empty
        // detour inflate final map-use validation.
        if(usePlan && !structures.length) {
            for(index = 0; index < topologySites.length; ++index)
                addFocus(topologySites[index], "topology_site", true);
        }

        // v1 plans do not have live placements during retry selection. Their
        // route/compound clearings are the intended major encounters, so use
        // those as the plan-time equivalent without counting decorative open
        // space or the already-recorded start/objective anchors.
        if(usePlan && !structures.length) {
            var clearings = pContext.Clearings || [];
            for(index = 0; index < clearings.length; ++index) {
                var clearing = clearings[index];
                var role = clearing ? String(clearing.role || "") : "";
                if(!clearing || role === "start" || role === "objective" ||
                    role === "wilderness" || role === "open_space" ||
                    role === "small")
                    continue;
                addFocus(clearing, "clearing", true);
            }
        }

        var focusScreens = {};
        var focusRegionCount = 0;
        var sectors = {};
        var sectorCount = 0;
        for(index = 0; index < focusPoints.length; ++index) {
            var focus = focusPoints[index];
            if(addScreen(focusScreens, focus))
                ++focusRegionCount;
            var sectorX = Math.max(0, Math.min(2, Math.floor(focus.x * 3 / W)));
            var sectorY = Math.max(0, Math.min(2, Math.floor(focus.y * 3 / H)));
            var sectorKey = sectorX + "," + sectorY;
            if(!sectors[sectorKey]) {
                sectors[sectorKey] = true;
                ++sectorCount;
            }
        }

        var departureFloor = Math.max(7, Math.round(Math.min(W, H) * 0.11));
        var meaningfulSideRoutes = 0;
        var sideRouteCount = 0;
        var sideRouteMaxDeparture = 0;
        for(index = 0; index < paths.length; ++index) {
            var sidePath = paths[index];
            if(!sidePath || !sideRoles[sidePath.role] || !sidePath.points)
                continue;
            ++sideRouteCount;
            var maxDeparture = 0;
            for(var sidePoint = 0; sidePoint < sidePath.points.length; ++sidePoint)
                maxDeparture = Math.max(maxDeparture,
                    nearestPrimary(sidePath.points[sidePoint]).distance);
            sideRouteMaxDeparture = Math.max(sideRouteMaxDeparture, maxDeparture);
            if(sidePath.points.length >= 7 && maxDeparture >= departureFloor)
                ++meaningfulSideRoutes;
        }

        var activityPhases = {};
        var activityPhaseCount = 0;
        var offPrimaryScreens = {};
        var offPrimaryRegionCount = 0;
        for(index = 0; index < activityPoints.length; ++index) {
            var nearest = nearestPrimary(activityPoints[index]);
            if(primaryLength > 1) {
                var fraction = typeof activityPoints[index].routeFraction === "number" ?
                    activityPoints[index].routeFraction :
                    nearest.index / (primaryLength - 1);
                var phase = fraction < 0.34 ? "early" :
                    (fraction < 0.67 ? "mid" : "late");
                if(!activityPhases[phase]) {
                    activityPhases[phase] = true;
                    ++activityPhaseCount;
                }
            }
            if(nearest.distance >= departureFloor &&
                addScreen(offPrimaryScreens, activityPoints[index]))
                ++offPrimaryRegionCount;
        }

        var targets;
        if(area >= 10000) {
            targets = { focusRegions: 6, sectors: 5, activityPhases: 3,
                meaningfulSideRoutes: 3, offPrimaryRegions: 2,
                routeScreenFraction: 0.15 };
        } else if(area >= 6000) {
            targets = { focusRegions: 5, sectors: 4, activityPhases: 3,
                meaningfulSideRoutes: 2, offPrimaryRegions: 2,
                routeScreenFraction: 0.16 };
        } else if(area >= 3200) {
            targets = { focusRegions: 4, sectors: 3, activityPhases: 2,
                meaningfulSideRoutes: 2, offPrimaryRegions: 1,
                routeScreenFraction: 0.16 };
        } else {
            targets = { focusRegions: 3, sectors: 2, activityPhases: 1,
                meaningfulSideRoutes: 1, offPrimaryRegions: 0,
                routeScreenFraction: 0.12 };
        }

        var routeScreenFraction = totalScreens ? routeScreenCount / totalScreens : 0;
        var misses = [];
        function below(pName, pActual, pTarget) {
            if(pActual < pTarget)
                misses.push(pName + ":" + pActual + "/" + pTarget);
        }
        below("regions", focusRegionCount, targets.focusRegions);
        below("sectors", sectorCount, targets.sectors);
        below("phases", activityPhaseCount, targets.activityPhases);
        below("side_routes", meaningfulSideRoutes, targets.meaningfulSideRoutes);
        below("off_route_regions", offPrimaryRegionCount, targets.offPrimaryRegions);
        if(routeScreenFraction + 0.00001 < targets.routeScreenFraction)
            misses.push("route_screens:" +
                Math.round(routeScreenFraction * 1000) / 1000 + "/" +
                targets.routeScreenFraction);

        // A single marginal miss is diagnostic. Two independent misses on a
        // large/XL campaign mean the extra canvas is not being spent on play
        // and must be retried. Smaller maps remain advisory because one screen
        // represents a much larger fraction of their total space.
        var hardReasons = [];
        if(isCampaign && primaryLength >= 2 && area >= 6000 && misses.length >= 2)
            hardReasons.push("gameplay_map_underused:" + misses.join("+"));

        return {
            enabled: isCampaign && primaryLength >= 2,
            ok: hardReasons.length === 0,
            area: area,
            primaryRoutePoints: primaryLength,
            routeScreens: routeScreenCount,
            totalScreens: totalScreens,
            routeScreenFraction: Math.round(routeScreenFraction * 1000) / 1000,
            focusPoints: focusPoints.length,
            activityPoints: activityPoints.length,
            focusRegions: focusRegionCount,
            sectors: sectorCount,
            activityPhases: activityPhaseCount,
            phaseUse: {
                early: !!activityPhases.early,
                mid: !!activityPhases.mid,
                late: !!activityPhases.late
            },
            sideRoutes: sideRouteCount,
            meaningfulSideRoutes: meaningfulSideRoutes,
            sideRouteMaxDeparture: Math.round(sideRouteMaxDeparture * 10) / 10,
            departureFloor: departureFloor,
            offPrimaryRegions: offPrimaryRegionCount,
            targets: targets,
            misses: misses,
            hardReasons: hardReasons
        };
    },

    KeepClearCount: function(pContext) {
        var layers = pContext.Layers;
        var count = 0;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(MapGen.Layers.Get(layers.keepClear, x, y, 0) || MapGen.Layers.Get(layers.path, x, y, 0))
                    ++count;
            }
        }

        return count;
    },

    IsTreeBlocked: function(pContext, pX, pY) {
        var layers = pContext.Layers;

        if(!MapGen.Layers.Get(layers.blocked, pX, pY, 0))
            return false;
        if(layers.outcrop && MapGen.Layers.Get(layers.outcrop, pX, pY, 0))
            return false;
        if(layers.owner && MapGen.Layers.Get(layers.owner, pX, pY, 0) > MapGen.Layers.Owner.TREE)
            return false;

        return true;
    },

    TreeBlockedCount: function(pContext) {
        var count = 0;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(this.IsTreeBlocked(pContext, x, y))
                    ++count;
            }
        }

        return count;
    },

    RouteWalkableCount: function(pContext) {
        var routeLayer = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);

        for(var pathIndex = 0; pathIndex < pContext.Paths.length; ++pathIndex) {
            var path = pContext.Paths[pathIndex];
            var radius = Math.max(1, path.radius || 1);

            for(var pointIndex = 0; pointIndex < path.points.length; ++pointIndex) {
                MapGen.Layers.StampDisc(
                    routeLayer,
                    path.points[pointIndex].x,
                    path.points[pointIndex].y,
                    radius,
                    1
                );
            }
        }

        return MapGen.Layers.Count(routeLayer, function(pValue) { return !!pValue; });
    },

    IsWalkable: function(pContext, pX, pY) {
        var layers = pContext.Layers;

        if(pX < 0 || pY < 0 || pX >= pContext.Width || pY >= pContext.Height)
            return false;

        if(MapGen.Layers.Get(layers.keepClear, pX, pY, 0) || MapGen.Layers.Get(layers.path, pX, pY, 0))
            return true;

        if(MapGen.Layers.Get(layers.blocked, pX, pY, 0))
            return false;

        if(MapGen.Layers.Get(layers.water, pX, pY, 0))
            return false;

        return true;
    },

    Distance: function(pA, pB) {
        var dx = pA.x - pB.x;
        var dy = pA.y - pB.y;
        return Math.sqrt((dx * dx) + (dy * dy));
    },

    PathMetrics: function(pContext) {
        var totalLength = 0;
        var totalRadius = 0;
        var minimumRadius = 0;
        var routeRoles = {};

        for(var pathIndex = 0; pathIndex < pContext.Paths.length; ++pathIndex) {
            var path = pContext.Paths[pathIndex];
            var pathLength = 0;

            totalRadius += path.radius || 0;
            if(!minimumRadius || (path.radius || 0) < minimumRadius)
                minimumRadius = path.radius || 0;

            routeRoles[path.role || "path"] = (routeRoles[path.role || "path"] || 0) + 1;

            for(var pointIndex = 1; pointIndex < path.points.length; ++pointIndex)
                pathLength += this.Distance(path.points[pointIndex - 1], path.points[pointIndex]);

            path.length = pathLength;
            totalLength += pathLength;
        }

        return {
            count: pContext.Paths.length,
            totalLength: totalLength,
            averageLength: pContext.Paths.length ? totalLength / pContext.Paths.length : 0,
            averageRadius: pContext.Paths.length ? totalRadius / pContext.Paths.length : 0,
            minimumRadius: minimumRadius,
            roles: routeRoles
        };
    },

    ClearingMetrics: function(pContext) {
        var totalRadius = 0;
        var roles = {};

        for(var index = 0; index < pContext.Clearings.length; ++index) {
            var clearing = pContext.Clearings[index];
            totalRadius += clearing.radius || 0;
            roles[clearing.role || "clearing"] = (roles[clearing.role || "clearing"] || 0) + 1;
        }

        return {
            count: pContext.Clearings.length,
            averageRadius: pContext.Clearings.length ? totalRadius / pContext.Clearings.length : 0,
            roles: roles
        };
    },

    RiverMetrics: function(pContext) {
        var totalLength = 0;
        var totalWidth = 0;

        for(var riverIndex = 0; riverIndex < pContext.Rivers.length; ++riverIndex) {
            var river = pContext.Rivers[riverIndex];
            var riverLength = 0;

            totalWidth += river.width || 0;

            for(var pointIndex = 1; pointIndex < river.points.length; ++pointIndex)
                riverLength += this.Distance(river.points[pointIndex - 1], river.points[pointIndex]);

            river.length = riverLength;
            totalLength += riverLength;
        }

        return {
            count: pContext.Rivers.length,
            ponds: pContext.Ponds.length,
            lakes: pContext.Lakes.length,
            beaches: pContext.Beaches.length,
            totalLength: totalLength,
            averageLength: pContext.Rivers.length ? totalLength / pContext.Rivers.length : 0,
            averageWidth: pContext.Rivers.length ? totalWidth / pContext.Rivers.length : 0,
            crossings: pContext.Crossings.length
        };
    },

    WaterShapeMetrics: function(pContext) {
        var layers = pContext.Layers;
        var width = pContext.Width;
        var height = pContext.Height;
        var best = {
            length: 0,
            side: "",
            axis: "",
            line: 0,
            start: 0,
            end: 0
        };
        var runCount = 0;

        var isWater = function(pX, pY) {
            if(pX < 0 || pY < 0 || pX >= width || pY >= height)
                return false;
            return !!MapGen.Layers.Get(layers.water, pX, pY, 0);
        };

        var signature = function(pX, pY) {
            if(!isWater(pX, pY))
                return 0;
            if(pX <= 0 || pY <= 0 || pX >= width - 1 || pY >= height - 1)
                return 0;

            var sig = 0;
            if(!isWater(pX, pY - 1)) sig |= 1;
            if(!isWater(pX + 1, pY)) sig |= 2;
            if(!isWater(pX, pY + 1)) sig |= 4;
            if(!isWater(pX - 1, pY)) sig |= 8;
            return sig;
        };

        var record = function(pLength, pSide, pAxis, pLine, pStart, pEnd) {
            if(pLength < 4)
                return;
            ++runCount;
            if(pLength > best.length) {
                best.length = pLength;
                best.side = pSide;
                best.axis = pAxis;
                best.line = pLine;
                best.start = pStart;
                best.end = pEnd;
            }
        };

        var sweep = function(pLandBit, pSide, pAxis) {
            var outerLen = (pAxis === "h") ? height : width;
            var innerLen = (pAxis === "h") ? width : height;

            for(var outer = 0; outer < outerLen; ++outer) {
                var runStart = -1;
                for(var inner = 0; inner <= innerLen; ++inner) {
                    var x = (pAxis === "h") ? inner : outer;
                    var y = (pAxis === "h") ? outer : inner;
                    var inRun = (inner < innerLen) && (signature(x, y) === pLandBit);

                    if(inRun) {
                        if(runStart < 0)
                            runStart = inner;
                    }
                    else {
                        if(runStart >= 0)
                            record(inner - runStart, pSide, pAxis, outer, runStart, inner - 1);
                        runStart = -1;
                    }
                }
            }
        };

        sweep(1, "north", "h");
        sweep(4, "south", "h");
        sweep(8, "west", "v");
        sweep(2, "east", "v");

        return {
            longestStraightShoreRun: best.length,
            straightShoreRunCount: runCount,
            longestStraightShore: best
        };
    },

    // Perimeter distribution — measures how water is laid out along the
    // 1-cell map perimeter. Distinguishes "spine" maps (water touches all
    // 4 edges in many small segments — shipped CF style) from "frame" maps
    // (water concentrated on 1-2 sides, leaving long unbroken-land
    // perimeter runs — current generator artefact).
    //
    // Calibrated 2026-06-14 against shipped/gen ice corpus
    // (Tools/Analysis/PerimeterDistribution.py): shipped p50
    // longestLandRunFraction = 0.146 (75% percentile = 0.220), gen p50 =
    // 0.385. Shipped maps reliably touch water on 4 edges (p25=4 edges),
    // gen p50 = 3 edges with one side fully dry. WaterCompositionTargets
    // in Validate.js gates on these values when the profile sets the
    // MaxLongestLandRunFraction / MinPerimeterEdgesWithWater fields.
    PerimeterDistributionMetrics: function(pContext) {
        var layers = pContext.Layers;
        var width = pContext.Width;
        var height = pContext.Height;

        if(width <= 0 || height <= 0) {
            return {
                perimeterCells: 0,
                perimeterWaterCells: 0,
                perimeterWaterFraction: 0,
                longestLandRun: 0,
                longestLandRunFraction: 0,
                edgesWithWater: 0,
                perimeterSegments: 0,
                sideWaterFraction: { N: 0, E: 0, S: 0, W: 0 }
            };
        }

        // "Visual water" = any cell that the renderer paints as water-side
        // tile (deep water, shallow water, shore, bank). The gen-time
        // `water` layer alone undercounts because Coast/Rivers paint
        // shallow-ice transitions via `coast`/`riverBank` layers that
        // produce visually water-side tiles. Shipped corpus calibration
        // (Tools/Analysis/PerimeterDistribution.py) uses tile-id ranges
        // {0..19, 80..99} which include those shore tiles, so the gate
        // must use the same definition. Include `forcedBank` too — it's
        // the synthesised bank ring around step rows that paints shore
        // tiles even where riverBank/coast aren't set.
        var isWater = function(pX, pY) {
            if(MapGen.Layers.Get(layers.water, pX, pY, 0))
                return true;
            if(MapGen.Layers.Get(layers.coast, pX, pY, 0))
                return true;
            if(MapGen.Layers.Get(layers.riverBank, pX, pY, 0))
                return true;
            if(layers.forcedBank && MapGen.Layers.Get(layers.forcedBank, pX, pY, 0))
                return true;
            return false;
        };

        // Walk the perimeter clockwise from (0, 0). Each entry is the
        // (x, y, side) of a perimeter cell; the loop wraps to form a
        // closed circular sequence so a contiguous-land run can span
        // the start/end boundary (e.g. a corner-spanning land run).
        var perim = [];
        var sideCounts = { N: 0, E: 0, S: 0, W: 0 };
        var sideWater = { N: 0, E: 0, S: 0, W: 0 };
        var x;
        var y;

        for(x = 0; x < width; ++x) {
            perim.push({ x: x, y: 0 });
            ++sideCounts.N;
            if(isWater(x, 0)) ++sideWater.N;
        }
        for(y = 1; y < height; ++y) {
            perim.push({ x: width - 1, y: y });
            ++sideCounts.E;
            if(isWater(width - 1, y)) ++sideWater.E;
        }
        for(x = width - 2; x >= 0; --x) {
            perim.push({ x: x, y: height - 1 });
            ++sideCounts.S;
            if(isWater(x, height - 1)) ++sideWater.S;
        }
        for(y = height - 2; y > 0; --y) {
            perim.push({ x: 0, y: y });
            ++sideCounts.W;
            if(isWater(0, y)) ++sideWater.W;
        }

        var perimCells = perim.length;
        if(perimCells === 0) {
            return {
                perimeterCells: 0,
                perimeterWaterCells: 0,
                perimeterWaterFraction: 0,
                longestLandRun: 0,
                longestLandRunFraction: 0,
                edgesWithWater: 0,
                perimeterSegments: 0,
                sideWaterFraction: { N: 0, E: 0, S: 0, W: 0 }
            };
        }

        // Mark each perimeter cell water/land.
        var land = new Array(perimCells);
        var waterCellCount = 0;
        for(var i = 0; i < perimCells; ++i) {
            var lw = isWater(perim[i].x, perim[i].y);
            land[i] = !lw;
            if(lw) ++waterCellCount;
        }

        // Longest contiguous land run, with wrap-around (scan twice).
        var longestLandRun = 0;
        if(waterCellCount === 0) {
            longestLandRun = perimCells;
        }
        else {
            var run = 0;
            for(var s = 0; s < 2 * perimCells; ++s) {
                if(land[s % perimCells]) {
                    ++run;
                    if(run > longestLandRun)
                        longestLandRun = run;
                }
                else {
                    run = 0;
                }
            }
            if(longestLandRun > perimCells)
                longestLandRun = perimCells;
        }

        // Count distinct water segments along the (closed-loop) perimeter.
        // Segment count = land→water transitions on the circular array.
        var segments = 0;
        if(waterCellCount === 0) {
            segments = 0;
        }
        else if(waterCellCount === perimCells) {
            segments = 1;
        }
        else {
            for(var t = 0; t < perimCells; ++t) {
                if(!land[t] && land[(t - 1 + perimCells) % perimCells])
                    ++segments;
            }
        }

        var edgesWithWater = 0;
        var sideFrac = { N: 0, E: 0, S: 0, W: 0 };
        var sides = ["N", "E", "S", "W"];
        for(var si = 0; si < sides.length; ++si) {
            var sk = sides[si];
            sideFrac[sk] = sideCounts[sk] ? sideWater[sk] / sideCounts[sk] : 0;
            if(sideWater[sk] > 0)
                ++edgesWithWater;
        }

        return {
            perimeterCells: perimCells,
            perimeterWaterCells: waterCellCount,
            perimeterWaterFraction: waterCellCount / perimCells,
            longestLandRun: longestLandRun,
            longestLandRunFraction: longestLandRun / perimCells,
            edgesWithWater: edgesWithWater,
            perimeterSegments: segments,
            sideWaterFraction: sideFrac
        };
    },

    PlacementMetrics: function(pContext) {
        var groups = ["players", "teams", "enemies", "objectives", "structures", "pickups", "vehicles", "decor"];
        var points = [];
        var counts = {};

        for(var groupIndex = 0; groupIndex < groups.length; ++groupIndex) {
            var groupName = groups[groupIndex];
            var group = pContext.Placements[groupName] || [];
            counts[groupName] = group.length;

            for(var index = 0; index < group.length; ++index) {
                if(group[index].point)
                    points.push(group[index].point);
            }
        }

        return {
            counts: counts,
            total: points.length
        };
    },

    // Shared 4-connected flood-fill component counter. pPredicate(pContext,x,y)
    // selects member cells (e.g. IsWalkable, IsLand). Returns the component
    // count, the largest component size, and the total member-cell count.
    // Iteration order is fixed (row-major scan + fixed direction order) to keep
    // the result deterministic for a given map.
    FloodComponents: function(pContext, pPredicate) {
        var visited = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
        var largest = 0;
        var count = 0;
        var total = 0;
        var directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];

        for(var startX = 0; startX < pContext.Width; ++startX) {
            for(var startY = 0; startY < pContext.Height; ++startY) {
                if(visited[startX][startY])
                    continue;
                if(!pPredicate(pContext, startX, startY)) {
                    visited[startX][startY] = 1;
                    continue;
                }

                var queue = [[startX, startY]];
                var queueHead = 0;
                var size = 0;
                visited[startX][startY] = 1;
                ++count;

                while(queueHead < queue.length) {
                    var current = queue[queueHead++];
                    ++size;
                    ++total;

                    for(var index = 0; index < directions.length; ++index) {
                        var nx = current[0] + directions[index][0];
                        var ny = current[1] + directions[index][1];

                        if(nx < 0 || ny < 0 || nx >= pContext.Width || ny >= pContext.Height)
                            continue;
                        if(visited[nx][ny])
                            continue;

                        visited[nx][ny] = 1;
                        if(pPredicate(pContext, nx, ny))
                            queue.push([nx, ny]);
                    }
                }

                if(size > largest)
                    largest = size;
            }
        }

        return { Count: count, Largest: largest, Total: total };
    },

    WalkableComponents: function(pContext) {
        var self = this;
        var result = this.FloodComponents(pContext, function(c, x, y) { return self.IsWalkable(c, x, y); });
        return { Count: result.Count, Largest: result.Largest, TotalWalkable: result.Total };
    },

    IsLand: function(pContext, pX, pY) {
        var layers = pContext.Layers;

        if(pX < 0 || pY < 0 || pX >= pContext.Width || pY >= pContext.Height)
            return false;

        return !MapGen.Layers.Get(layers.water, pX, pY, 0);
    },

    LandComponents: function(pContext) {
        var self = this;
        var result = this.FloodComponents(pContext, function(c, x, y) { return self.IsLand(c, x, y); });
        return { Count: result.Count, Largest: result.Largest, TotalLand: result.Total };
    }
};
