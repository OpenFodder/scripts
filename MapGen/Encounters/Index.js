var MapGen = MapGen || {};
MapGen.Encounters = MapGen.Encounters || {};

// Encounters places dynamic actors (players, enemies, vehicles) on top of the
// completed Layout + Features pass. Path-aware route pressure comes from the
// path graph; structure guards read guardCount off each Features placement;
// ambush patrols come from the layout's PlannedSites flagged as ambush_pocket.
MapGen.Encounters = {

    DistanceSq: function(pA, pB) {
        var dx = pA.x - pB.x;
        var dy = pA.y - pB.y;
        return (dx * dx) + (dy * dy);
    },

    PathsByRole: function(pContext, pRole) {
        var matches = [];

        for(var index = 0; index < pContext.Paths.length; ++index) {
            if(pContext.Paths[index].role === pRole)
                matches.push(pContext.Paths[index]);
        }

        return matches;
    },

    PathByRole: function(pContext, pRole) {
        var matches = this.PathsByRole(pContext, pRole);
        return matches.length ? matches[0] : null;
    },

    CampaignMainRoute: function(pContext) {
        if(MapGen.Layout &&
            MapGen.Layout.CriticalSites &&
            MapGen.Layout.CriticalSites.CampaignObjectiveRoute) {
            var route = MapGen.Layout.CriticalSites.CampaignObjectiveRoute(pContext);
            if(route)
                return route;
        }

        return this.PathByRole(pContext, "primary");
    },

    RouteRoleForFraction: function(pFraction) {
        if(pFraction < 0.34)
            return "early_route";
        if(pFraction < 0.68)
            return "mid_route";
        return "objective_route";
    },

    ProgressPhase: function(pFraction, pFallbackRole) {
        var fraction = Number(pFraction);
        if(isFinite(fraction)) {
            if(fraction < 0.34)
                return "early";
            if(fraction < 0.68)
                return "mid";
            return "late";
        }
        var role = String(pFallbackRole || "");
        if(role.indexOf("early") >= 0)
            return "early";
        if(role.indexOf("mid") >= 0 || role.indexOf("support") >= 0 ||
            role.indexOf("flank") >= 0 || role.indexOf("ambush") >= 0 ||
            role.indexOf("base") >= 0)
            return "mid";
        if(role.indexOf("objective") >= 0)
            return "late";
        return "unassigned";
    },

    RoutePointAtFraction: function(pRoute, pFraction) {
        var points = pRoute && pRoute.points ? pRoute.points : [];
        if(!points.length)
            return null;
        var fraction = Math.max(0, Math.min(1, Number(pFraction) || 0));
        var index = Math.max(0, Math.min(points.length - 1,
            Math.round((points.length - 1) * fraction)));
        return { x: points[index].x, y: points[index].y };
    },

    // One shared mission-space plan owns the places in which structures,
    // enemies and rewards should meet.  The older code spread each group by
    // early/mid/late independently; those scalar phases could all still land
    // in the same small part of a large map.  Regions are concrete points on
    // the primary route or at the end of an authored detour.
    BuildCampaignRegions: function(pContext, pMainRoute) {
        if(pContext.EncounterRegionPlan)
            return pContext.EncounterRegionPlan;

        var route = pMainRoute || this.CampaignMainRoute(pContext);
        if(!route || !route.points || route.points.length < 2)
            return null;

        var self = this;
        var regions = [];
        function addRouteRegion(pId, pKind, pFraction, pRequired, pTargets) {
            var point = self.RoutePointAtFraction(route, pFraction);
            if(!point)
                return null;
            var region = {
                id: pId,
                kind: pKind,
                required: !!pRequired,
                optional: !pRequired,
                routeFraction: pFraction,
                routePhase: self.ProgressPhase(pFraction, pKind),
                point: point,
                pathRole: "primary",
                branchId: null,
                topologyPurpose: "",
                detourLength: 0,
                targets: pTargets,
                assignments: { structures: 0, enemies: 0, pickups: 0 }
            };
            regions.push(region);
            return region;
        }

        addRouteRegion("start_safe", "start_safe", 0.04, true,
            { structures: 0, enemies: 0, pickups: 0 });
        addRouteRegion("early_contact", "early_contact", 0.22, true,
            { structures: 0, enemies: 1, pickups: 0 });
        addRouteRegion("mid_pressure", "mid_pressure", 0.50, true,
            { structures: 0, enemies: 1, pickups: 0 });
        addRouteRegion("objective_approach", "objective_approach", 0.78, true,
            { structures: 0, enemies: 1, pickups: 0 });
        var objective = addRouteRegion("objective_compound",
            "objective_compound", 0.96, true,
            { structures: 1, enemies: 1, pickups: 0 });
        if(objective && pContext.Anchors && pContext.Anchors.objective) {
            objective.point = {
                x: pContext.Anchors.objective.x,
                y: pContext.Anchors.objective.y
            };
        }

        var topology = pContext.IntentTopologyPlan || null;
        var routes = topology && topology.routes ? topology.routes : [];
        for(var index = 0; index < routes.length; ++index) {
            var sideRoute = routes[index];
            if(!sideRoute || !sideRoute.site)
                continue;
            var purpose = sideRoute.purpose || "detour";
            var wantsStructure = purpose === "structure_detour" ||
                purpose === "flank_site" ||
                (purpose === "fallback_detour" && index % 2 === 1);
            var wantsPickup = purpose === "pickup_detour" ||
                purpose === "fallback_detour" || !wantsStructure;
            var region = {
                id: "detour_" + index,
                kind: wantsStructure ? "optional_outpost" : "optional_reward",
                required: false,
                optional: true,
                routeFraction: Number(sideRoute.routeFraction),
                routePhase: sideRoute.routePhase ||
                    self.ProgressPhase(sideRoute.routeFraction, sideRoute.role),
                point: { x: sideRoute.site.x, y: sideRoute.site.y },
                pathRole: sideRoute.role || "spur",
                branchId: "topology_" + index,
                topologyPurpose: purpose,
                detourLength: sideRoute.points ? sideRoute.points.length : 0,
                targets: {
                    structures: wantsStructure ? 1 : 0,
                    enemies: 1,
                    pickups: wantsPickup ? 1 : 0
                },
                assignments: { structures: 0, enemies: 0, pickups: 0 }
            };
            regions.push(region);
            sideRoute.regionId = region.id;
            sideRoute.branchId = region.branchId;
            if(topology.sites && topology.sites[index]) {
                topology.sites[index].regionId = region.id;
                topology.sites[index].branchId = region.branchId;
            }
        }

        // Classic/v1 terrain profiles author side routes directly in Paths and
        // do not have IntentTopologyPlan. They are just as real to the player,
        // so promote their deep endpoints to optional encounter regions too.
        var contextPaths = pContext.Paths || [];
        var sideRoles = {
            secondary: true,
            flank_loop: true,
            spur: true,
            dead_end: true,
            support_route: true,
            flank_route: true
        };
        for(var contextPathIndex = 0;
            contextPathIndex < contextPaths.length; ++contextPathIndex) {
            var contextPath = contextPaths[contextPathIndex];
            if(!contextPath || !sideRoles[contextPath.role] ||
                !contextPath.points || contextPath.points.length < 3 ||
                contextPath.regionId)
                continue;
            var endpoint = contextPath.site ||
                contextPath.points[contextPath.points.length - 1];
            var existingRegion = null;
            for(var existingIndex = 0;
                existingIndex < regions.length; ++existingIndex) {
                if(regions[existingIndex].optional &&
                    regions[existingIndex].point.x === endpoint.x &&
                    regions[existingIndex].point.y === endpoint.y) {
                    existingRegion = regions[existingIndex];
                    break;
                }
            }
            if(existingRegion) {
                contextPath.regionId = existingRegion.id;
                contextPath.branchId = existingRegion.branchId;
                continue;
            }
            var routeFraction = Number(contextPath.routeFraction);
            if(!isFinite(routeFraction)) {
                var closestIndex = 0;
                var closestDistance = 0x7fffffff;
                for(var primaryIndex = 0;
                    primaryIndex < route.points.length; ++primaryIndex) {
                    var distance = this.DistanceSq(
                        endpoint, route.points[primaryIndex]);
                    if(distance < closestDistance) {
                        closestDistance = distance;
                        closestIndex = primaryIndex;
                    }
                }
                routeFraction = closestIndex /
                    Math.max(1, route.points.length - 1);
            }
            var pathPurpose = contextPath.purpose || contextPath.role;
            var pathWantsStructure = contextPathIndex % 2 === 1 ||
                pathPurpose.indexOf("structure") >= 0 ||
                pathPurpose.indexOf("flank") >= 0;
            var pathRegion = {
                id: "detour_" + (regions.length - 5),
                kind: pathWantsStructure ?
                    "optional_outpost" : "optional_reward",
                required: false,
                optional: true,
                routeFraction: routeFraction,
                routePhase: contextPath.routePhase ||
                    this.ProgressPhase(routeFraction, contextPath.role),
                point: { x: endpoint.x, y: endpoint.y },
                pathRole: contextPath.role,
                branchId: contextPath.branchId ||
                    ("path_" + contextPathIndex),
                topologyPurpose: pathPurpose,
                detourLength: contextPath.points.length,
                targets: {
                    structures: pathWantsStructure ? 1 : 0,
                    enemies: 1,
                    pickups: pathWantsStructure ? 0 : 1
                },
                assignments: { structures: 0, enemies: 0, pickups: 0 }
            };
            regions.push(pathRegion);
            contextPath.regionId = pathRegion.id;
            contextPath.branchId = pathRegion.branchId;
        }

        // Carry ownership onto the materialized path records.  Match by the
        // concrete side-route endpoint because pContext.Paths contains copies.
        var paths = pContext.Paths || [];
        for(var pathIndex = 0; pathIndex < paths.length; ++pathIndex) {
            var path = paths[pathIndex];
            if(!path || !path.site)
                continue;
            for(var regionIndex = 0; regionIndex < regions.length; ++regionIndex) {
                var candidate = regions[regionIndex];
                if(!candidate.optional || candidate.point.x !== path.site.x ||
                    candidate.point.y !== path.site.y)
                    continue;
                path.regionId = candidate.id;
                path.branchId = candidate.branchId;
                break;
            }
        }

        pContext.EncounterRegionPlan = {
            version: 1,
            mainRouteRole: route.role || "primary",
            mainRouteLength: route.points.length,
            requiredRegionCount: 5,
            optionalRegionCount: regions.length - 5,
            regions: regions
        };
        return pContext.EncounterRegionPlan;
    },

    EncounterRegionById: function(pContext, pId) {
        var plan = pContext ? pContext.EncounterRegionPlan : null;
        var regions = plan && plan.regions ? plan.regions : [];
        for(var index = 0; index < regions.length; ++index) {
            if(regions[index].id === pId)
                return regions[index];
        }
        return null;
    },

    NearestEncounterRegion: function(pContext, pPoint, pIncludeStart) {
        var plan = pContext ? pContext.EncounterRegionPlan : null;
        var regions = plan && plan.regions ? plan.regions : [];
        var best = null;
        var bestDistance = 0x7fffffff;
        for(var index = 0; index < regions.length; ++index) {
            if(!pIncludeStart && regions[index].kind === "start_safe")
                continue;
            var distance = this.DistanceSq(pPoint, regions[index].point);
            if(distance < bestDistance) {
                best = regions[index];
                bestDistance = distance;
            }
        }
        return best;
    },

    SetGrammarSpriteRegion: function(pContext, pSprite, pRegion, pPoint) {
        if(!pSprite || !pRegion)
            return;
        var point = pPoint || pRegion.point;
        pSprite.point = { x: point.x, y: point.y };
        pSprite.routeFraction = pRegion.routeFraction;
        pSprite.routePhase = pRegion.routePhase;
        pSprite.regionId = pRegion.id;
        pSprite.branchId = pRegion.branchId;
        pSprite.topologyPurpose = pRegion.topologyPurpose;
        pSprite.runtimePosition = { x: (point.x * 16) + 8, y: (point.y * 16) + 8 };
        if(pSprite.spt) {
            pSprite.spt.runtimeX = pSprite.runtimePosition.x;
            pSprite.spt.runtimeY = pSprite.runtimePosition.y;
            pSprite.spt.storedX = point.x * 16;
        }
    },

    // Project the grammar actors into the shared regions.  Encounters are
    // clustered around meaningful route beats and detour destinations, while
    // small deterministic offsets keep squads from becoming a single stack.
    AssignGrammarPlanToRegions: function(pContext) {
        var plan = this.BuildCampaignRegions(pContext);
        var sprites = pContext.GrammarPlan && pContext.GrammarPlan.spritePlan ?
            pContext.GrammarPlan.spritePlan : null;
        if(!plan || !sprites)
            return;

        var activity = [];
        var objective = this.EncounterRegionById(pContext, "objective_compound");
        for(var index = 0; index < plan.regions.length; ++index) {
            var region = plan.regions[index];
            if(region.kind !== "start_safe" && region.kind !== "objective_compound")
                activity.push(region);
        }
        if(objective)
            activity.push(objective);

        var enemies = sprites.enemies || [];
        var mobileCount = 0;
        var mobileIndex = 0;
        var optionalActivity = [];
        for(index = 0; index < enemies.length; ++index) {
            if(enemies[index].kind !== "enemy_turret" &&
                String(enemies[index].role || "").indexOf("guard") < 0)
                ++mobileCount;
        }
        for(index = 0; index < activity.length; ++index) {
            if(activity[index].optional)
                optionalActivity.push(activity[index]);
        }
        var compulsoryActivity = [];
        var optionalOutposts = [];
        var optionalRewards = [];
        for(index = 0; index < activity.length; ++index) {
            if(!activity[index].optional)
                compulsoryActivity.push(activity[index]);
            else if(activity[index].kind === "optional_outpost")
                optionalOutposts.push(activity[index]);
            else
                optionalRewards.push(activity[index]);
        }

        // Some terrain grammars expose many more side routes than the mobile
        // enemy budget can cover. Select a geographically useful subset of
        // outposts and defend those properly instead of disabling the whole
        // policy unless every optional endpoint can receive an actor.
        var optionalBudget = Math.max(0,
            mobileCount - compulsoryActivity.length);
        var rewardReserve = optionalRewards.length > 0 &&
            optionalBudget >= 3 ? 1 : 0;
        var outpostTargetCount = Math.min(optionalOutposts.length,
            Math.floor((optionalBudget - rewardReserve) / 2));
        var selectedOutposts = [];
        var outpostPool = optionalOutposts.slice(0);
        while(selectedOutposts.length < outpostTargetCount &&
            outpostPool.length) {
            var bestOutpostIndex = 0;
            var bestOutpostScore = -1;
            for(var poolIndex = 0; poolIndex < outpostPool.length;
                ++poolIndex) {
                var candidateOutpost = outpostPool[poolIndex];
                var candidateLength = Math.max(1,
                    Number(candidateOutpost.detourLength) || 1);
                var candidateScore = candidateLength * candidateLength;
                if(selectedOutposts.length) {
                    var nearestSelected = 0x7fffffff;
                    for(var selectedIndex = 0;
                        selectedIndex < selectedOutposts.length;
                        ++selectedIndex) {
                        nearestSelected = Math.min(nearestSelected,
                            this.DistanceSq(candidateOutpost.point,
                                selectedOutposts[selectedIndex].point));
                    }
                    candidateScore += nearestSelected;
                }
                if(candidateScore > bestOutpostScore) {
                    bestOutpostScore = candidateScore;
                    bestOutpostIndex = poolIndex;
                }
            }
            selectedOutposts.push(outpostPool[bestOutpostIndex]);
            outpostPool.splice(bestOutpostIndex, 1);
        }

        var deepSchedule = compulsoryActivity.slice(0);
        for(index = 0; index < selectedOutposts.length; ++index) {
            deepSchedule.push(selectedOutposts[index]);
            deepSchedule.push(selectedOutposts[index]);
        }
        var remainingSlots = Math.max(0, mobileCount - deepSchedule.length);
        var selectedRewards = optionalRewards.slice(0);
        selectedRewards.sort(function(pLeft, pRight) {
            var lengthOrder = (Number(pRight.detourLength) || 0) -
                (Number(pLeft.detourLength) || 0);
            // Equal detours keep their authored order on both JS backends.
            return lengthOrder || optionalRewards.indexOf(pLeft) - optionalRewards.indexOf(pRight);
        });
        if(selectedRewards.length > remainingSlots)
            selectedRewards.length = remainingSlots;
        for(index = 0; index < selectedRewards.length; ++index)
            deepSchedule.push(selectedRewards[index]);
        while(deepSchedule.length < mobileCount && activity.length) {
            var extraIndex = deepSchedule.length -
                compulsoryActivity.length - (selectedOutposts.length * 2) -
                selectedRewards.length;
            deepSchedule.push(activity[Math.max(0, extraIndex) %
                activity.length]);
        }

        var deepOptionalRequired = compulsoryActivity.length +
            (selectedOutposts.length * 2) + selectedRewards.length;
        var deepOptional = pContext.Width * pContext.Height >= 10000 &&
            selectedOutposts.length > 0 &&
            mobileCount >= deepOptionalRequired;
        pContext.DeepOptionalEncounterPlan = {
            enabled: deepOptional,
            mobileEnemies: mobileCount,
            requiredMobileEnemies: deepOptionalRequired,
            minimumEnemiesPerOutpost: deepOptional ? 2 : 1,
            outpostRegionIds: [],
            rewardRegionIds: []
        };
        for(index = 0; index < selectedOutposts.length; ++index)
            pContext.DeepOptionalEncounterPlan.outpostRegionIds.push(
                selectedOutposts[index].id);
        for(index = 0; index < selectedRewards.length; ++index)
            pContext.DeepOptionalEncounterPlan.rewardRegionIds.push(
                selectedRewards[index].id);
        var offsets = [
            { x: -2, y: 0 }, { x: 2, y: 1 }, { x: 0, y: -2 },
            { x: -1, y: 2 }, { x: 3, y: -1 }, { x: -3, y: 1 }
        ];
        for(index = 0; index < enemies.length && activity.length; ++index) {
            var enemy = enemies[index];
            var selected;
            if(enemy.kind === "enemy_turret" ||
                String(enemy.role || "").indexOf("guard") >= 0) {
                selected = objective || activity[activity.length - 1];
            }
            else {
                if(deepOptional) {
                    selected = deepSchedule[mobileIndex %
                        deepSchedule.length];
                }
                // Every other mobile squad claims an optional destination.
                // The remaining squads span the compulsory route beats. This
                // means even a sparse three-patrol ice mission has a reason to
                // leave the trunk instead of reserving all detours for scenery.
                else if(optionalActivity.length && mobileCount >= 2 &&
                    mobileIndex % 2 === 1) {
                    selected = optionalActivity[
                        Math.floor(mobileIndex / 2) % optionalActivity.length];
                }
                else {
                    var distributed = mobileCount <= 1 ?
                        Math.floor(compulsoryActivity.length / 2) :
                        Math.round(mobileIndex * (compulsoryActivity.length - 1) /
                            Math.max(1, mobileCount - 1));
                    selected = compulsoryActivity[Math.min(
                        compulsoryActivity.length - 1, distributed)] ||
                        activity[0];
                }
                ++mobileIndex;
            }
            var offset = offsets[index % offsets.length];
            var point = {
                x: Math.max(1, Math.min(pContext.Width - 2,
                    selected.point.x + offset.x)),
                y: Math.max(1, Math.min(pContext.Height - 2,
                    selected.point.y + offset.y))
            };
            this.SetGrammarSpriteRegion(pContext, enemy, selected, point);
            selected.assignments.enemies += 1;
        }

        var pickups = sprites.pickups || [];
        var rewardRegions = [];
        for(index = 0; index < plan.regions.length; ++index) {
            if(plan.regions[index].targets.pickups > 0)
                rewardRegions.push(plan.regions[index]);
        }
        if(!rewardRegions.length)
            rewardRegions = activity;
        for(index = 0; index < pickups.length && rewardRegions.length; ++index) {
            var reward = rewardRegions[index % rewardRegions.length];
            this.SetGrammarSpriteRegion(pContext, pickups[index], reward,
                reward.point);
            reward.assignments.pickups += 1;
        }
    },

    AnnotateEncounterClearings: function(pContext) {
        var plan = this.BuildCampaignRegions(pContext);
        var clearings = pContext.Clearings || [];
        if(!plan)
            return;
        for(var index = 0; index < clearings.length; ++index) {
            var clearing = clearings[index];
            var region = clearing.regionId ?
                this.EncounterRegionById(pContext, clearing.regionId) : null;
            if(!region && clearing.role === "start")
                region = this.EncounterRegionById(pContext, "start_safe");
            if(!region && clearing.role === "compound_objective")
                region = this.EncounterRegionById(pContext, "objective_compound");
            if(!region)
                region = this.NearestEncounterRegion(pContext, clearing, false);
            if(region) {
                clearing.regionId = region.id;
                clearing.encounterKind = region.kind;
            }
        }
    },

    EnemyTemplateByRole: {
        objective_guard: "objective_guard",
        base_guard: "objective_guard",
        ambush: "ambush_patrol",
        flank_ambush: "ambush_patrol",
        flank_route: "side_patrol",
        support_route: "side_patrol",
        objective_route: "heavy_patrol"
    },

    TemplateForRole: function(pRole) {
        return this.EnemyTemplateByRole[pRole] || "light_patrol";
    },

    ProfileNumber: function(pContext, pName, pFallback) {
        var value = pContext.Profile ? Number(pContext.Profile[pName]) : NaN;
        if(isNaN(value))
            return pFallback;
        return value;
    },

    RouteEnemyOffsetBase: function(pContext, pName, pFallback) {
        var value = Math.floor(this.ProfileNumber(pContext, pName, pFallback));
        var minimum = Math.floor(this.ProfileNumber(pContext, "RouteEnemyMinOffsetTiles", 2));

        if(minimum < 0)
            minimum = 0;
        if(value < minimum)
            value = minimum;

        return value;
    },

    HashUnit: function(pContext, pA, pB, pSalt) {
        return MapGen.Random.HashTile(pContext.Seed || 0, pA || 0, pB || 0, pSalt || 0) / 4294967295;
    },

    PathNormal: function(pPath, pIndex) {
        var points = pPath && pPath.points ? pPath.points : [];
        var previous = points[Math.max(0, pIndex - 3)] || points[pIndex];
        var next = points[Math.min(points.length - 1, pIndex + 3)] || points[pIndex];
        var dx = next.x - previous.x;
        var dy = next.y - previous.y;
        var length = Math.max(1, Math.sqrt((dx * dx) + (dy * dy)));

        return {
            x: -dy / length,
            y: dx / length
        };
    },

    LocalRouteWalkable: function(pContext, pPoint) {
        if(!pPoint)
            return false;
        if(pPoint.x < 0 || pPoint.y < 0 || pPoint.x >= pContext.Width || pPoint.y >= pContext.Height)
            return false;
        if(MapGen.Metrics.IsWalkable(pContext, pPoint.x, pPoint.y))
            return true;

        var layers = pContext.Layers || {};
        return !!(MapGen.Layers.Get(layers.path, pPoint.x, pPoint.y, 0) ||
            MapGen.Layers.Get(layers.keepClear, pPoint.x, pPoint.y, 0));
    },

    LocallyConnectedToRoute: function(pContext, pStart, pEnd, pRadius) {
        if(!pStart || !pEnd)
            return false;
        if(pStart.x === pEnd.x && pStart.y === pEnd.y)
            return true;

        var radius = Math.max(2, Math.floor(pRadius || 2));
        var minX = Math.max(0, Math.min(pStart.x, pEnd.x) - radius);
        var maxX = Math.min(pContext.Width - 1, Math.max(pStart.x, pEnd.x) + radius);
        var minY = Math.max(0, Math.min(pStart.y, pEnd.y) - radius);
        var maxY = Math.min(pContext.Height - 1, Math.max(pStart.y, pEnd.y) + radius);
        var queue = [{ x: pStart.x, y: pStart.y }];
        var head = 0;
        var visited = {};
        var directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];

        visited[pStart.x + "," + pStart.y] = true;
        while(head < queue.length) {
            var current = queue[head++];
            for(var index = 0; index < directions.length; ++index) {
                var next = {
                    x: current.x + directions[index][0],
                    y: current.y + directions[index][1]
                };
                if(next.x < minX || next.y < minY || next.x > maxX || next.y > maxY)
                    continue;
                var key = next.x + "," + next.y;
                if(visited[key])
                    continue;
                if(!this.LocalRouteWalkable(pContext, next))
                    continue;
                if(next.x === pEnd.x && next.y === pEnd.y)
                    return true;
                visited[key] = true;
                queue.push(next);
            }
        }

        return false;
    },

    LandReachabilitySeed: function(pContext) {
        if(pContext.Anchors && pContext.Anchors.start)
            return pContext.Anchors.start;
        if(pContext.Placements && pContext.Placements.players && pContext.Placements.players.length)
            return pContext.Placements.players[0].point;
        return null;
    },

    LandReachablePassable: function(pContext, pX, pY) {
        if(pX < 0 || pY < 0 || pX >= pContext.Width || pY >= pContext.Height)
            return false;

        var layers = pContext.Layers || {};
        if(MapGen.Layers.Get(layers.water, pX, pY, 0) &&
            !MapGen.Layers.Get(layers.crossing, pX, pY, 0))
            return false;

        return true;
    },

    LandReachability: function(pContext) {
        if(pContext._encounterLandReachable)
            return pContext._encounterLandReachable;

        var reachable = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
        var seed = this.LandReachabilitySeed(pContext);
        if(!seed || !this.LandReachablePassable(pContext, seed.x, seed.y)) {
            pContext._encounterLandReachable = reachable;
            return reachable;
        }

        var queue = [{ x: seed.x, y: seed.y }];
        var head = 0;
        var directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        reachable[seed.x][seed.y] = 1;

        while(head < queue.length) {
            var current = queue[head++];
            for(var index = 0; index < directions.length; ++index) {
                var x = current.x + directions[index][0];
                var y = current.y + directions[index][1];
                if(!this.LandReachablePassable(pContext, x, y))
                    continue;
                if(reachable[x][y])
                    continue;
                reachable[x][y] = 1;
                queue.push({ x: x, y: y });
            }
        }

        pContext._encounterLandReachable = reachable;
        return reachable;
    },

    IsStartLandReachable: function(pContext, pPoint) {
        if(!pPoint)
            return false;
        var reachable = this.LandReachability(pContext);
        return !!MapGen.Layers.Get(reachable, pPoint.x, pPoint.y, 0);
    },

    StartAccessPoint: function(pContext) {
        if(pContext._encounterStartAccess)
            return pContext._encounterStartAccess;
        if(!MapGen.Connectivity || !MapGen.Connectivity.FindAccessPoint)
            return null;

        var seed = this.LandReachabilitySeed(pContext);
        if(!seed)
            return null;

        var node = {
            point: { x: seed.x, y: seed.y },
            radius: 2,
            approach: 2
        };
        pContext._encounterStartAccess = MapGen.Connectivity.FindAccessPoint(pContext, node) || node.point;
        return pContext._encounterStartAccess;
    },

    StartWalkCost: function(pContext) {
        if(pContext._encounterStartWalkCost)
            return pContext._encounterStartWalkCost;
        if(!MapGen.Connectivity || !MapGen.Connectivity.BuildWalkCost)
            return null;

        pContext._encounterStartWalkCost = MapGen.Connectivity.BuildWalkCost(pContext);
        var start = this.StartAccessPoint(pContext);
        if(start && MapGen.Layers.InBounds(pContext._encounterStartWalkCost, start.x, start.y)) {
            if(MapGen.Connectivity.SetWalkCostCell)
                MapGen.Connectivity.SetWalkCostCell(
                    pContext,
                    pContext._encounterStartWalkCost,
                    start.x,
                    start.y,
                    MapGen.Connectivity.Costs.KeepClear
                );
            else
                pContext._encounterStartWalkCost[start.x][start.y] = MapGen.Connectivity.Costs.KeepClear;
        }
        return pContext._encounterStartWalkCost;
    },

    StartConnectivityReachable: function(pContext, pPoint) {
        if(!pPoint)
            return false;
        if(!MapGen.Connectivity || !MapGen.Connectivity.FindPath)
            return true;

        var start = this.StartAccessPoint(pContext);
        var walkCost = this.StartWalkCost(pContext);
        if(!start || !walkCost)
            return true;
        if(!MapGen.Layers.InBounds(walkCost, pPoint.x, pPoint.y))
            return false;
        if(walkCost[pPoint.x][pPoint.y] === Infinity)
            return false;

        var previous = walkCost[pPoint.x][pPoint.y];
        MapGen.Connectivity.SetWalkCostCell(pContext, walkCost, pPoint.x, pPoint.y, MapGen.Connectivity.Costs.KeepClear);
        var path = MapGen.Connectivity.FindPath(pContext, walkCost, start, pPoint, "encounter_reachability");
        MapGen.Connectivity.SetWalkCostCell(pContext, walkCost, pPoint.x, pPoint.y, previous);

        return !!path;
    },

    CandidateOnPath: function(pContext, pPath, pFraction, pOffset, pRadius) {
        if(!pPath || !pPath.points.length)
            return null;

        var pointIndex = Math.min(pPath.points.length - 1, Math.max(0, Math.floor(pPath.points.length * pFraction)));
        var base = pPath.points[pointIndex];
        var normal = this.PathNormal(pPath, pointIndex);
        var offset = Number(pOffset || 0);
        var sideX = Math.round(normal.x * offset);
        var sideY = Math.round(normal.y * offset);
        var candidates = [
            { x: base.x + sideX, y: base.y + sideY },
            { x: base.x - sideX, y: base.y - sideY },
            { x: base.x + Math.round(sideX * 0.5), y: base.y + Math.round(sideY * 0.5) },
            { x: base.x - Math.round(sideY * 0.5), y: base.y + Math.round(sideX * 0.5) },
            { x: base.x + Math.round(sideY * 0.5), y: base.y - Math.round(sideX * 0.5) },
            { x: base.x, y: base.y }
        ];

        for(var index = 0; index < candidates.length; ++index) {
            var point = {
                x: Math.max(1, Math.min(pContext.Width - 2, candidates[index].x)),
                y: Math.max(1, Math.min(pContext.Height - 2, candidates[index].y))
            };

            if(!MapGen.Metrics.IsWalkable(pContext, point.x, point.y))
                continue;
            if(!this.LocallyConnectedToRoute(pContext, base, point, Math.abs(offset) + 2))
                continue;
            if(!this.IsStartLandReachable(pContext, point))
                continue;
            if(!this.StartConnectivityReachable(pContext, point))
                continue;
            if(MapGen.Features && !MapGen.Features.IsAreaFree(pContext, point, pRadius || 1))
                continue;

            return point;
        }

        return null;
    },

    CandidateNearPoint: function(pContext, pPoint, pRadius, pMinDistance) {
        if(MapGen.Features)
            return MapGen.Features.CandidateNearPoint(pContext, pPoint, pRadius || 1, pMinDistance || 5);

        return null;
    },

    ReserveEncounter: function(pContext, pEncounter) {
        var point = pEncounter.point;
        var radius = pEncounter.radius || 1;

        // P1.18 PHASE 2 PORT TARGET (D6 follow-up + W1.5 Encounters/Index.js KWC):
        // these 4 layer writes are the v1 owner/occupied/keepClear authoring vestige
        // inside an otherwise plan-shaped Encounters file. v3 destination: write the
        // actor reservation onto the IntentMap claim plane (CLAIM.OBJECTIVE +
        // CLAIM.SPAWN_SAFE for player kind) with priority above Concept-stamped
        // CLIFF/STRUCTURE so actors don't collide with cliff drift cells. Preserve
        // the keepClear+1 buffer ring semantics via radius+1 OR-flag write on the
        // claim plane. Currently writes legacy Layers.* so v1 rendering still works
        // pre-strip; post-strip P1.4 these calls drop dead because Layers.js is
        // deleted, and Phase 2 replaces with MapGen.Intent.Map.AddClaim calls.
        MapGen.Layers.StampDisc(pContext.Layers.occupied, point.x, point.y, radius, pEncounter.kind || 1);
        MapGen.Layers.StampDisc(pContext.Layers.keepClear, point.x, point.y, radius + 1, 1);
        // Architecture v3: claim OBJECT ownership at the actor cell so tree/decor
        // fill (which reads owner) leaves placed actors clear.
        if(pContext.Layers.owner)
            MapGen.Layers.ClaimCell(pContext.Layers.owner, point.x, point.y, MapGen.Layers.Owner.OBJECT);
    },

    AddEnemy: function(pContext, pEncounter) {
        if(!pEncounter || !pEncounter.point)
            return null;

        this.ReserveEncounter(pContext, pEncounter);
        pContext.Placements.enemies.push(pEncounter);
        return pEncounter;
    },

    AddPlayer: function(pContext, pPlacement) {
        this.ReserveEncounter(pContext, pPlacement);
        pContext.Placements.players.push(pPlacement);
        return pPlacement;
    },

    AddVehicle: function(pContext, pPlacement) {
        if(!pPlacement || !pPlacement.point)
            return null;

        this.ReserveEncounter(pContext, pPlacement);
        pContext.Placements.vehicles.push(pPlacement);
        return pPlacement;
    },

    AddRouteEnemy: function(pContext, pPath, pFraction, pOffset, pRole, pProgress) {
        var point = this.CandidateOnPath(pContext, pPath, pFraction, pOffset, 1);

        if(!point)
            return null;

        var routeFraction = pProgress && isFinite(Number(pProgress.routeFraction)) ?
            Number(pProgress.routeFraction) : pFraction;
        return this.AddEnemy(pContext, {
            kind: "enemy_patrol",
            template: this.TemplateForRole(pRole),
            role: pRole,
            point: point,
            radius: 1,
            pathFraction: pFraction,
            routeFraction: routeFraction,
            routePhase: pProgress && pProgress.routePhase ?
                pProgress.routePhase : this.ProgressPhase(routeFraction, pRole),
            branchId: pProgress && pProgress.branchId ? pProgress.branchId : null
        });
    },

    BuildCampaignPlayers: function(pContext) {
        var start = pContext.Anchors.start;
        if(!start)
            return;

        this.AddPlayer(pContext, {
            kind: "player_start",
            template: "campaign_squad",
            role: "start",
            point: { x: start.x, y: start.y },
            radius: 2
        });
    },

    VehicleSpawnOffsets: [
        { x: 3, y: 0 },
        { x: -3, y: 0 },
        { x: 0, y: 3 },
        { x: 0, y: -3 },
        { x: 2, y: 2 },
        { x: -2, y: -2 }
    ],

    BuildCampaignVehicles: function(pContext) {
        var count = Math.max(0, Math.floor(pContext.Profile.VehicleCount || 0));
        var start = pContext.Anchors.start;
        var offsets = this.VehicleSpawnOffsets;

        if(!count || !start)
            return;

        for(var vehicle = 0; vehicle < count; ++vehicle) {
            for(var offsetIndex = 0; offsetIndex < offsets.length; ++offsetIndex) {
                var offset = offsets[(offsetIndex + vehicle) % offsets.length];
                var base = {
                    x: Math.max(1, Math.min(pContext.Width - 2, start.x + offset.x)),
                    y: Math.max(1, Math.min(pContext.Height - 2, start.y + offset.y))
                };
                var point = this.CandidateNearPoint(pContext, base, 2, 4);

                if(!point)
                    continue;

                this.AddVehicle(pContext, {
                    kind: "vehicle_spawn",
                    template: "random_map_vehicle",
                    role: "start_support",
                    point: point,
                    radius: 2
                });
                break;
            }
        }
    },

    BuildEssentialRoutePressure: function(pContext, pPrimary) {
        if(!pPrimary)
            return;

        var fractions = pContext.Profile && pContext.Profile.EssentialRouteFractions instanceof Array ?
            pContext.Profile.EssentialRouteFractions :
            [0.26, 0.55, 0.82];
        var baseOffset = this.RouteEnemyOffsetBase(pContext, "RouteEnemyOffsetTiles", 4);

        for(var index = 0; index < fractions.length; ++index) {
            var fraction = Math.max(0.08, Math.min(0.94, Number(fractions[index])));
            if(isNaN(fraction))
                continue;

            var role = this.RouteRoleForFraction(fraction);
            var side = index % 2 ? 1 : -1;
            this.AddRouteEnemy(pContext, pPrimary, fraction, baseOffset * side, role);
        }
    },

    CampaignRouteFractions: function(pContext, pCount) {
        var bands = pContext.Profile && pContext.Profile.RouteEnemyPhaseBands instanceof Array ?
            pContext.Profile.RouteEnemyPhaseBands : null;
        var pattern = pContext.Profile && pContext.Profile.RouteEnemyFractions instanceof Array ?
            pContext.Profile.RouteEnemyFractions :
            [0.34, 0.45, 0.64, 0.73, 0.88, 0.24, 0.58, 0.78, 0.92];
        var result = [];

        if(bands && bands.length) {
            var slots = Math.max(1, Math.ceil(pCount / bands.length));
            for(var bandIndex = 0; bandIndex < pCount; ++bandIndex) {
                var band = bands[bandIndex % bands.length];
                if(!(band instanceof Array) || band.length < 2)
                    continue;

                var min = Number(band[0]);
                var max = Number(band[1]);
                if(isNaN(min) || isNaN(max))
                    continue;
                if(max < min) {
                    var swap = min;
                    min = max;
                    max = swap;
                }

                var slot = Math.floor(bandIndex / bands.length);
                var t = (slot + 1) / (slots + 1);
                var jitter = (this.HashUnit(pContext, bandIndex, pCount, 4211) - 0.5) * 0.05;
                result.push(Math.max(0.08, Math.min(0.94, min + ((max - min) * t) + jitter)));
            }

            if(result.length)
                return result.sort(function(a, b) { return a - b; });
        }

        for(var index = 0; index < pCount; ++index) {
            var value = Number(pattern[index % pattern.length]);
            if(isNaN(value))
                value = (index + 1) / (pCount + 1);
            result.push(Math.max(0.08, Math.min(0.94, value)));
        }

        return result;
    },

    BuildCampaignRouteEnemies: function(pContext, pPrimary) {
        if(!pPrimary)
            return;

        var density = pContext.Profile.EnemyDensity || 1;
        var base = this.ProfileNumber(pContext, "RouteEnemyBaseCount", 5);
        var scale = this.ProfileNumber(pContext, "RouteEnemyDensityScale", 1);
        var minCount = Math.max(2, Math.floor(this.ProfileNumber(pContext, "RouteEnemyMinCount", 2)));
        var offsetBase = this.RouteEnemyOffsetBase(pContext, "RouteEnemyOffsetTiles", 5);
        var routeLength = pPrimary.points ? pPrimary.points.length : 80;
        var routeScale = Math.max(0.75, Math.min(1.75, routeLength / 90));
        var count = Math.max(minCount, Math.round(base * density * scale * routeScale));
        var fractions = this.CampaignRouteFractions(pContext, count);

        for(var index = 0; index < fractions.length; ++index) {
            var fraction = fractions[index];
            var role = this.RouteRoleForFraction(fraction);
            var offset = (index % 2 ? 1 : -1) * (offsetBase + (index % 3 === 0 ? 1 : 0));

            this.AddRouteEnemy(pContext, pPrimary, fraction, offset, role);
        }
    },

    SideRoutePathRoles: ["primary", "secondary", "flank_loop", "spur"],

    SideRouteEnemyRole: function(pPathRole, pSlotIndex) {
        if(pPathRole === "flank_loop")
            return pSlotIndex % 2 ? "ambush" : "flank_route";
        if(pPathRole === "spur")
            return "support_route";

        return pSlotIndex % 2 ? "flank_route" : "support_route";
    },

    BuildCampaignSideRouteEnemies: function(pContext, pMainRoute) {
        var density = pContext.Profile.EnemyDensity || 1;
        var scale = this.ProfileNumber(pContext, "SideRouteEnemyScale", 1);
        var perPath = Math.max(0, Math.round(2 * density * scale));
        var sideRoutes = 0;

        for(var roleIndex = 0; roleIndex < this.SideRoutePathRoles.length; ++roleIndex) {
            var pathRole = this.SideRoutePathRoles[roleIndex];
            var paths = this.PathsByRole(pContext, pathRole);

            for(var pathIndex = 0; pathIndex < paths.length; ++pathIndex) {
                var path = paths[pathIndex];
                if(path === pMainRoute)
                    continue;

                ++sideRoutes;
                if(perPath <= 0)
                    continue;
                var slots = pathRole === "spur" ? 1 : perPath;

                for(var index = 0; index < slots; ++index) {
                    var fraction = (index + 1) / (slots + 1);
                    var role = this.SideRouteEnemyRole(pathRole, index);
                    var offsetBase = this.RouteEnemyOffsetBase(pContext, "SideRouteEnemyOffsetTiles", 4);
                    var offset = index % 2 ? offsetBase : -offsetBase;

                    this.AddRouteEnemy(pContext, path, fraction, offset, role, {
                        routeFraction: path.routeFraction,
                        routePhase: path.routePhase,
                        branchId: path.role + "_" + pathIndex
                    });
                }
            }
        }

        return sideRoutes;
    },

    AddStructureGuard: function(pContext, pStructure, pIndex) {
        var points = pStructure.guardPoints || [];
        var base = points.length ? points[pIndex % points.length] : pStructure.point;
        var point = this.CandidateNearPoint(pContext, base, 1, 5);

        if(!point)
            return null;

        return this.AddEnemy(pContext, {
            kind: "enemy_guard",
            template: this.TemplateForRole("objective_guard"),
            role: pStructure.role === "objective" ? "objective_guard" : "base_guard",
            point: point,
            radius: 1,
            structureTemplate: pStructure.template,
            routeFraction: pStructure.routeFraction,
            routePhase: pStructure.routePhase ||
                this.ProgressPhase(pStructure.routeFraction,
                    pStructure.role === "objective" ? "objective_guard" : "base_guard")
        });
    },

    StructureGuardCount: function(pStructure) {
        if(typeof pStructure.guardCount === "number")
            return pStructure.guardCount;

        var template = MapGen.Features ? MapGen.Features.TemplateInfo(pStructure.template) : null;
        return template && template.guardCount ? template.guardCount : 1;
    },

    BuildStructureGuards: function(pContext, pLimit) {
        var structures = pContext.Placements.structures || [];
        var placed = 0;

        for(var index = 0; index < structures.length; ++index) {
            var structure = structures[index];
            var guardCount = this.StructureGuardCount(structure);

            for(var guard = 0; guard < guardCount; ++guard) {
                if(pLimit !== undefined && placed >= pLimit)
                    return;

                if(this.AddStructureGuard(pContext, structure, guard))
                    ++placed;
            }
        }
    },

    BuildAmbushes: function(pContext) {
        var density = pContext.Profile.EnemyDensity || 1;
        var limit = Math.max(1, Math.round(2 * density));
        var clearings = pContext.Clearings || [];
        var placed = 0;

        for(var index = 0; index < clearings.length && placed < limit; ++index) {
            var clearing = clearings[index];
            if(clearing.role !== "ambush_pocket" && clearing.role !== "flank")
                continue;

            var point = MapGen.Features
                ? MapGen.Features.CandidateInClearing(pContext, clearing, 1, 6)
                : null;
            if(!point)
                continue;

            this.AddEnemy(pContext, {
                kind: "enemy_ambush",
                template: this.TemplateForRole(clearing.role === "flank" ? "flank_ambush" : "ambush"),
                role: clearing.role === "flank" ? "flank_ambush" : "ambush",
                point: point,
                radius: 1,
                routeFraction: clearing.routeFraction,
                routePhase: clearing.routePhase ||
                    this.ProgressPhase(clearing.routeFraction, clearing.role)
            });
            ++placed;
        }
    },

    BuildCampaignEnemies: function(pContext) {
        var mainRoute = this.CampaignMainRoute(pContext);

        if(!mainRoute)
            return;

        this.BuildCampaignRegions(pContext, mainRoute);
        // Intent concepts project their grammar sprites onto encounter regions
        // during Intent/Pipeline. Legacy jungle/beach terrain reaches this
        // campaign builder without that pass, leaving runtime sprites to be
        // associated with whichever region happens to be nearest after snap.
        // Apply the same shared assignment once for those pipelines too.
        if(!pContext.DeepOptionalEncounterPlan && pContext.GrammarPlan &&
            pContext.GrammarPlan.spritePlan)
            this.AssignGrammarPlanToRegions(pContext);
        this.AnnotateEncounterClearings(pContext);

        var before = pContext.Placements.enemies.length;
        this.BuildEssentialRoutePressure(pContext, mainRoute);
        this.BuildStructureGuards(pContext, 1);
        this.BuildCampaignRouteEnemies(pContext, mainRoute);
        var sideRoutes = this.BuildCampaignSideRouteEnemies(pContext, mainRoute);
        this.BuildAmbushes(pContext);
        this.BuildStructureGuards(pContext);

        var phaseCounts = { early: 0, mid: 0, late: 0, unassigned: 0 };
        var branchPressureCount = 0;
        for(var enemyIndex = before;
            enemyIndex < pContext.Placements.enemies.length; ++enemyIndex) {
            var enemy = pContext.Placements.enemies[enemyIndex];
            var region = enemy.regionId ?
                this.EncounterRegionById(pContext, enemy.regionId) :
                this.NearestEncounterRegion(pContext, enemy.point, false);
            if(region) {
                enemy.regionId = region.id;
                enemy.encounterKind = region.kind;
            }
            var phase = this.ProgressPhase(enemy.routeFraction,
                enemy.routePhase || enemy.role);
            phaseCounts[phase] = (phaseCounts[phase] || 0) + 1;
            if(enemy.branchId)
                ++branchPressureCount;
        }

        pContext.EncounterPlan = {
            mainRouteRole: mainRoute.role || "route",
            mainRouteLength: mainRoute.points ? mainRoute.points.length : 0,
            sideRouteCount: sideRoutes,
            enemyCount: pContext.Placements.enemies.length - before,
            phaseCounts: phaseCounts,
            branchPressureCount: branchPressureCount,
            regionCount: pContext.EncounterRegionPlan ?
                pContext.EncounterRegionPlan.regions.length : 0
        };
    },

    BuildMultiplayerPlayers: function(pContext) {
        var anchors = pContext.Anchors;
        var starts = [
            { role: "team_a", point: anchors.teamA },
            { role: "team_b", point: anchors.teamB }
        ];

        for(var index = 0; index < starts.length; ++index) {
            if(!starts[index].point)
                continue;

            this.AddPlayer(pContext, {
                kind: "team_player_start",
                template: starts[index].role,
                role: starts[index].role,
                point: { x: starts[index].point.x, y: starts[index].point.y },
                radius: 2
            });
        }
    },

    BuildCampaign: function(pContext) {
        this.BuildCampaignPlayers(pContext);
        this.BuildCampaignVehicles(pContext);
        this.BuildCampaignEnemies(pContext);
        MapGen.Context.AddLog(pContext, "Built campaign encounter placement plan");
    },

    BuildMultiplayer: function(pContext) {
        this.BuildMultiplayerPlayers(pContext);
        MapGen.Context.AddLog(pContext, "Built multiplayer encounter placement plan");
    }
};
