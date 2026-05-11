var MapGen = MapGen || {};
MapGen.Integration = MapGen.Integration || {};

(function(pIntegration) {
    pIntegration.PickupRoutePhase = function(pFraction, pRole, pPhase) {
        if(pPhase)
            return pPhase;
        if(pRole === "support")
            return "mid";
        if(pRole === "objective_route")
            return "late";

        var fraction = Number(pFraction);
        if(!isFinite(fraction))
            return "";
        if(fraction < 0.34)
            return "early";
        if(fraction < 0.68)
            return "mid";
        return "late";
    };

    pIntegration.PickupCandidate = function(pContext, pPlacement, pSource,
        pIndex) {
        if(!pPlacement || !pPlacement.point)
            return null;

        var point = {
            x: Math.floor(Number(pPlacement.point.x)),
            y: Math.floor(Number(pPlacement.point.y))
        };
        if(!isFinite(point.x) || !isFinite(point.y))
            return null;

        var fraction = Number(pPlacement.routeFraction);
        if(!isFinite(fraction) && pPlacement.point.routeFraction !== undefined)
            fraction = Number(pPlacement.point.routeFraction);
        if(!isFinite(fraction))
            fraction = null;

        return {
            placement: pPlacement,
            point: point,
            source: pSource,
            sourceIndex: pIndex,
            spriteType: pPlacement.spriteType,
            role: pPlacement.role || "",
            routeFraction: fraction,
            routePhase: this.PickupRoutePhase(
                fraction,
                pPlacement.role,
                pPlacement.routePhase || pPlacement.point.routePhase
            ),
            branchId: pPlacement.branchId || pPlacement.point.branchId || null,
            regionId: pPlacement.regionId || pPlacement.point.regionId || "",
            topologyPurpose: pPlacement.topologyPurpose ||
                pPlacement.point.topologyPurpose || "",
            tie: MapGen.Random.HashTile(
                pContext.Seed,
                point.x,
                point.y,
                1301 + pIndex
            )
        };
    };

    pIntegration.PickupSideRouteCandidates = function(pContext, pStartIndex) {
        var candidates = [];
        var paths = pContext && pContext.Paths ? pContext.Paths : [];
        var sideRoles = {
            secondary: true,
            flank_loop: true,
            spur: true,
            dead_end: true
        };

        for(var index = 0; index < paths.length; ++index) {
            var path = paths[index];
            if(!path || !sideRoles[path.role] || !path.points ||
                path.points.length < 3)
                continue;

            // Put the reward near the end of the authored detour. The old 68%
            // sample often left the box back in the main clearing, so collecting
            // it did not make the player use the branch.
            var pointIndex = Math.max(1, Math.min(
                path.points.length - 2,
                Math.floor(path.points.length * 0.82)
            ));
            var point = path.points[pointIndex];
            var placement = {
                id: "pickup_side_route_" + index,
                kind: "route_pickup",
                role: "route_pickup",
                point: { x: point.x, y: point.y },
                routeFraction: path.routeFraction,
                routePhase: path.routePhase,
                branchId: path.branchId || ("live_side_route_" + index),
                regionId: path.regionId || "",
                topologyPurpose: path.purpose || path.role
            };
            var candidate = this.PickupCandidate(
                pContext,
                placement,
                "side_route",
                pStartIndex + index
            );
            if(candidate)
                candidates.push(candidate);
        }

        return candidates;
    };

    pIntegration.PickupStructureApproachCandidates = function(pContext,
        pStartIndex) {
        var candidates = [];
        var structures = pContext && pContext.LiveStructurePlacements ?
            pContext.LiveStructurePlacements : [];
        var offsetSpecs = [
            { forward: 9, side: 0 },
            { forward: 12, side: 0 },
            { forward: 12, side: 4 },
            { forward: 12, side: -4 },
            { forward: 15, side: 0 }
        ];
        var candidateIndex = 0;

        for(var structureIndex = 0; structureIndex < structures.length;
            ++structureIndex) {
            var structure = structures[structureIndex];
            if(!structure || !structure.accessPoint)
                continue;
            var rect = structure.rect || {
                minX: structure.tileX,
                maxX: structure.tileX,
                minY: structure.tileY,
                maxY: structure.tileY
            };
            var centerX = (rect.minX + rect.maxX) / 2;
            var centerY = (rect.minY + rect.maxY) / 2;
            var directionX = structure.accessPoint.x < centerX ? -1 :
                (structure.accessPoint.x > centerX ? 1 : 0);
            var directionY = structure.accessPoint.y < centerY ? -1 :
                (structure.accessPoint.y > centerY ? 1 : 0);
            if(!directionX && !directionY)
                directionX = (structureIndex % 2) ? -1 : 1;
            var perpendicularX = -directionY;
            var perpendicularY = directionX;

            for(var offsetIndex = 0; offsetIndex < offsetSpecs.length;
                ++offsetIndex) {
                var offset = offsetSpecs[offsetIndex];
                var placement = {
                    id: "pickup_structure_approach_" + structureIndex + "_" +
                        offsetIndex,
                    kind: "rocket_support",
                    role: "objective_route",
                    point: {
                        x: structure.accessPoint.x +
                            (directionX * offset.forward) +
                            (perpendicularX * offset.side),
                        y: structure.accessPoint.y +
                            (directionY * offset.forward) +
                            (perpendicularY * offset.side)
                    },
                    spriteType: SpriteTypes.RocketBox,
                    routeFraction: structure.routeFraction,
                    routePhase: structure.routePhase,
                    branchId: "structure_" + structureIndex,
                    regionId: structure.regionId || "",
                    topologyPurpose: "structure_support_staging"
                };
                var candidate = this.PickupCandidate(
                    pContext,
                    placement,
                    "structure_approach",
                    pStartIndex + candidateIndex
                );
                if(candidate)
                    candidates.push(candidate);
                ++candidateIndex;
            }
        }
        return candidates;
    };

    pIntegration.PickupEncounterCandidates = function(pContext, pStartIndex) {
        var candidates = [];
        var grammar = this.GrammarSpritePlan ? this.GrammarSpritePlan() : null;
        var enemies = grammar && grammar.enemies ? grammar.enemies : [];
        var offsets = [
            { x: 5, y: 0 },
            { x: -5, y: 0 },
            { x: 0, y: 5 },
            { x: 0, y: -5 }
        ];
        var candidateIndex = 0;

        for(var enemyIndex = 0; enemyIndex < enemies.length; ++enemyIndex) {
            var enemy = enemies[enemyIndex];
            if(!enemy || !enemy.point)
                continue;
            for(var offsetIndex = 0; offsetIndex < offsets.length;
                ++offsetIndex) {
                var placement = {
                    id: "pickup_encounter_" + enemyIndex + "_" + offsetIndex,
                    kind: "guarded_pickup",
                    role: "contested",
                    point: {
                        x: enemy.point.x + offsets[offsetIndex].x,
                        y: enemy.point.y + offsets[offsetIndex].y
                    },
                    routeFraction: enemy.routeFraction,
                    routePhase: enemy.routePhase,
                    branchId: enemy.branchId || ("encounter_" + enemyIndex),
                    regionId: enemy.regionId || "",
                    topologyPurpose: "encounter_staging"
                };
                var candidate = this.PickupCandidate(
                    pContext,
                    placement,
                    "encounter_staging",
                    pStartIndex + candidateIndex
                );
                if(candidate)
                    candidates.push(candidate);
                ++candidateIndex;
            }
        }
        return candidates;
    };

    pIntegration.PickupPointDistance = function(pLeft, pRight) {
        if(!pLeft || !pRight)
            return 0x7FFFFFFF;
        var dx = pLeft.x - pRight.x;
        var dy = pLeft.y - pRight.y;
        return Math.sqrt((dx * dx) + (dy * dy));
    };

    pIntegration.PickupPointRectDistance = function(pPoint, pRect) {
        if(!pPoint || !pRect)
            return 0x7FFFFFFF;
        var dx = pPoint.x < pRect.minX ? pRect.minX - pPoint.x :
            (pPoint.x > pRect.maxX ? pPoint.x - pRect.maxX : 0);
        var dy = pPoint.y < pRect.minY ? pRect.minY - pPoint.y :
            (pPoint.y > pRect.maxY ? pPoint.y - pRect.maxY : 0);
        return Math.sqrt((dx * dx) + (dy * dy));
    };

    pIntegration.LivePickupStructureStandoff = function(pContext) {
        if(!pContext)
            return 7;
        var configured = Number(pContext.Profile &&
            pContext.Profile.LivePickupStructureStandoff);
        if(isFinite(configured) && configured > 0)
            return configured;
        var area = pContext.Width * pContext.Height;
        return area >= 10000 ? 12 :
            (area >= 6000 ? 10 : (area >= 3200 ? 9 : 7));
    };

    pIntegration.AnnotatePickupActivityContext = function(pContext,
        pCandidate) {
        var structures = pContext.LiveStructurePlacements || [];
        var grammar = this.GrammarSpritePlan ? this.GrammarSpritePlan() : null;
        var enemies = grammar && grammar.enemies ? grammar.enemies : [];
        var objectivePlan = pContext.GrammarPlan &&
            pContext.GrammarPlan.objectivePlan ?
            pContext.GrammarPlan.objectivePlan : {};
        var objectives = objectivePlan.objectives || [];
        var nearestStructure = 0x7FFFFFFF;
        var nearestEnemy = 0x7FFFFFFF;
        var nearestObjective = 0x7FFFFFFF;
        var index;

        for(index = 0; index < structures.length; ++index) {
            var structureRect = structures[index].rect || {
                minX: structures[index].tileX,
                maxX: structures[index].tileX,
                minY: structures[index].tileY,
                maxY: structures[index].tileY
            };
            nearestStructure = Math.min(nearestStructure,
                this.PickupPointRectDistance(pCandidate.point, structureRect));
        }
        for(index = 0; index < enemies.length; ++index) {
            if(enemies[index].point) {
                nearestEnemy = Math.min(nearestEnemy,
                    this.PickupPointDistance(pCandidate.point,
                        enemies[index].point));
            }
        }
        for(index = 0; index < objectives.length; ++index) {
            if(objectives[index].point) {
                nearestObjective = Math.min(nearestObjective,
                    this.PickupPointDistance(pCandidate.point,
                        objectives[index].point));
            }
        }

        pCandidate.nearestStructure = nearestStructure;
        pCandidate.nearestEnemy = nearestEnemy;
        pCandidate.nearestObjective = nearestObjective;
        pCandidate.nearestStart = pContext.Anchors && pContext.Anchors.start ?
            this.PickupPointDistance(pCandidate.point,
                pContext.Anchors.start) : 0x7FFFFFFF;
        pCandidate.edgeDistance = Math.min(
            pCandidate.point.x,
            pCandidate.point.y,
            pContext.Width - 1 - pCandidate.point.x,
            pContext.Height - 1 - pCandidate.point.y
        );
        pCandidate.actualDetour = pCandidate.source === "side_route";
        if(MapGen.Encounters && MapGen.Encounters.NearestEncounterRegion) {
            var region = pCandidate.regionId &&
                MapGen.Encounters.EncounterRegionById ?
                MapGen.Encounters.EncounterRegionById(
                    pContext, pCandidate.regionId) : null;
            if(!region)
                region = MapGen.Encounters.NearestEncounterRegion(
                    pContext, pCandidate.point, false);
            if(region) {
                pCandidate.regionId = region.id;
                pCandidate.encounterKind = region.kind;
                pCandidate.regionPickupTarget = region.targets.pickups > 0;
            }
        }
        pCandidate.activityContext = pCandidate.actualDetour ||
            pCandidate.regionPickupTarget ||
            nearestStructure <= 17 || nearestEnemy <= 10 ||
            nearestObjective <= 10;
        return pCandidate;
    };

    pIntegration.CampaignPickupCandidates = function() {
        var context = Session.MapGenContext;
        var candidates = [];
        var index;

        if(!context)
            return candidates;

        // The grammar plan is the authoritative campaign composition. Its
        // pickup points have already been projected onto the final v3 route,
        // including route phases and topology branches. The former live path
        // ignored these and used the older fixed support/objective anchors.
        var grammar = this.GrammarSpritePlan ? this.GrammarSpritePlan() : null;
        var planned = grammar && grammar.pickups ? grammar.pickups : [];
        for(index = 0; index < planned.length; ++index) {
            var grammarCandidate = this.PickupCandidate(
                context,
                planned[index],
                "grammar_plan",
                index
            );
            if(grammarCandidate)
                candidates.push(grammarCandidate);

        }

        // Retain the feature-plan sites as genuine fallbacks. They are useful
        // if final smoothing makes one grammar point unreachable, but no longer
        // replace the richer grammar plan by default.
        var legacy = context.Placements && context.Placements.pickups ?
            context.Placements.pickups : [];
        for(index = 0; index < legacy.length; ++index) {
            if(legacy[index].kind === "helicopter")
                continue;
            var legacyCandidate = this.PickupCandidate(
                context,
                legacy[index],
                "feature_plan",
                (planned.length * 17) + index
            );
            if(legacyCandidate)
                candidates.push(legacyCandidate);
        }

        var sideCandidates = this.PickupSideRouteCandidates(
            context,
            (planned.length * 17) + legacy.length
        );
        for(index = 0; index < sideCandidates.length; ++index)
            candidates.push(sideCandidates[index]);

        var structureCandidates = this.PickupStructureApproachCandidates(
            context,
            (planned.length * 17) + legacy.length + sideCandidates.length
        );
        for(index = 0; index < structureCandidates.length; ++index)
            candidates.push(structureCandidates[index]);

        var encounterCandidates = this.PickupEncounterCandidates(
            context,
            (planned.length * 17) + legacy.length + sideCandidates.length +
                structureCandidates.length
        );
        for(index = 0; index < encounterCandidates.length; ++index)
            candidates.push(encounterCandidates[index]);

        return candidates;
    };

    pIntegration.CampaignPickupPositionReachable = function(pPosition) {
        if(!pPosition)
            return false;
        if(!Session.HumanPosition || typeof Reachability === "undefined" ||
            !Reachability.VerifyReachable)
            return true;

        return Reachability.VerifyReachable(
            SpriteTypes.Player,
            Session.HumanPosition,
            pPosition
        );
    };

    pIntegration.PrepareCampaignPickupCandidate = function(pCandidate,
        pDeferReachability) {
        var context = Session.MapGenContext;
        if(!context || !pCandidate || !pCandidate.point)
            return null;

        var point = {
            x: Math.max(1, Math.min(context.Width - 2, pCandidate.point.x)),
            y: Math.max(1, Math.min(context.Height - 2, pCandidate.point.y))
        };
        var snapped = this.SnapGroundActorToWalkable ?
            this.SnapGroundActorToWalkable(context, point.x, point.y) : point;
        if(!snapped)
            return null;

        var position = this.TileToPosition(snapped);
        if(!pDeferReachability &&
            !this.CampaignPickupPositionReachable(position))
            return null;

        pCandidate.point = { x: snapped.x, y: snapped.y };
        pCandidate.position = position;
        pCandidate.snapped = snapped.x !== point.x || snapped.y !== point.y;
        pCandidate.key = snapped.x + "," + snapped.y;
        pCandidate.sector = Math.max(0, Math.min(2,
            Math.floor(snapped.x * 3 / Math.max(1, context.Width)))) + "," +
            Math.max(0, Math.min(2,
                Math.floor(snapped.y * 3 / Math.max(1, context.Height))));
        return this.AnnotatePickupActivityContext(context, pCandidate);
    };

    pIntegration.PickupCandidateMinimumDistance = function(pCandidate, pSelected) {
        if(!pSelected.length)
            return 0;

        var minimum = 0x7FFFFFFF;
        for(var index = 0; index < pSelected.length; ++index) {
            var dx = pCandidate.point.x - pSelected[index].point.x;
            var dy = pCandidate.point.y - pSelected[index].point.y;
            minimum = Math.min(minimum, Math.sqrt((dx * dx) + (dy * dy)));
        }
        return minimum;
    };

    pIntegration.PickupPointSetLineDeparture = function(pPoints) {
        if(pPoints.length < 3)
            return 0;

        var left = pPoints[0];
        var right = pPoints[1];
        var farthest = -1;
        var farthestLeft = 0;
        var farthestRight = 1;
        for(var leftIndex = 0; leftIndex < pPoints.length; ++leftIndex) {
            for(var rightIndex = leftIndex + 1;
                rightIndex < pPoints.length; ++rightIndex) {
                var pairDx = pPoints[leftIndex].x - pPoints[rightIndex].x;
                var pairDy = pPoints[leftIndex].y - pPoints[rightIndex].y;
                var distance = (pairDx * pairDx) + (pairDy * pairDy);
                if(distance > farthest) {
                    farthest = distance;
                    farthestLeft = leftIndex;
                    farthestRight = rightIndex;
                    left = pPoints[leftIndex];
                    right = pPoints[rightIndex];
                }
            }
        }

        var dx = right.x - left.x;
        var dy = right.y - left.y;
        var length = Math.sqrt((dx * dx) + (dy * dy));
        if(length < 0.001)
            return 0;

        var maximum = 0;
        for(var index = 0; index < pPoints.length; ++index) {
            if(index === farthestLeft || index === farthestRight)
                continue;
            maximum = Math.max(maximum, Math.abs(
                (dy * pPoints[index].x) - (dx * pPoints[index].y) +
                (right.x * left.y) - (right.y * left.x)
            ) / length);
        }
        return maximum;
    };

    pIntegration.PickupPointSetSpan = function(pPoints) {
        var maximum = 0;
        for(var left = 0; left < pPoints.length; ++left) {
            for(var right = left + 1; right < pPoints.length; ++right) {
                var dx = pPoints[left].x - pPoints[right].x;
                var dy = pPoints[left].y - pPoints[right].y;
                maximum = Math.max(maximum,
                    Math.sqrt((dx * dx) + (dy * dy)));
            }
        }
        return maximum;
    };

    pIntegration.PickupPointSetMinDistance = function(pPoints) {
        if(pPoints.length < 2)
            return null;
        var minimum = 0x7FFFFFFF;
        for(var left = 0; left < pPoints.length; ++left) {
            for(var right = left + 1; right < pPoints.length; ++right) {
                var dx = pPoints[left].x - pPoints[right].x;
                var dy = pPoints[left].y - pPoints[right].y;
                minimum = Math.min(minimum,
                    Math.sqrt((dx * dx) + (dy * dy)));
            }
        }
        return minimum;
    };

    pIntegration.PickupPointSetSectorCount = function(pContext, pPoints) {
        var sectors = {};
        var count = 0;
        for(var index = 0; index < pPoints.length; ++index) {
            var sectorX = Math.max(0, Math.min(2,
                Math.floor(pPoints[index].x * 3 /
                    Math.max(1, pContext.Width))));
            var sectorY = Math.max(0, Math.min(2,
                Math.floor(pPoints[index].y * 3 /
                    Math.max(1, pContext.Height))));
            var key = sectorX + "," + sectorY;
            if(!sectors[key]) {
                sectors[key] = true;
                ++count;
            }
        }
        return count;
    };

    pIntegration.ImprovePickupSelectionShape = function(pContext, pSelected,
        pCandidates, pMinSpacing, pReachabilityVerifier) {
        if(!pContext || pSelected.length < 2)
            return pSelected;

        var minSide = Math.min(pContext.Width, pContext.Height);
        var area = pContext.Width * pContext.Height;
        var diagonal = Math.max(1, Math.sqrt(
            (pContext.Width * pContext.Width) +
            (pContext.Height * pContext.Height)
        ));
        var profile = pContext.Profile || {};
        var departureTarget = Number(profile.LivePickupLineDeparture);
        if(!isFinite(departureTarget) || departureTarget <= 0)
            departureTarget = Math.max(4, Math.min(8,
                Math.round(minSide * 0.08)));
        var spanFractionTarget = Number(profile.MinLivePickupMapSpanFraction);
        if(!isFinite(spanFractionTarget) || spanFractionTarget <= 0) {
            spanFractionTarget = area >= 6000 ? 0.30 :
                (area >= 3200 ? 0.20 : 0.16);
        }
        var spanTarget = diagonal * spanFractionTarget;
        if(pSelected.length < 3) departureTarget = 0;
        var structureStandoff = this.LivePickupStructureStandoff(pContext);

        for(var pass = 0; pass < pSelected.length; ++pass) {
            var selectedPoints = [];
            for(var selectedIndex = 0;
                selectedIndex < pSelected.length; ++selectedIndex)
                selectedPoints.push(pSelected[selectedIndex].point);
            var currentDeparture = this.PickupPointSetLineDeparture(selectedPoints);
            var currentSpan = this.PickupPointSetSpan(selectedPoints);
            var needsDeparture = currentDeparture < departureTarget;
            var needsSpan = currentSpan < spanTarget;
            var needsSectors = pSelected.length >= 3 && this.PickupPointSetSectorCount(pContext, selectedPoints) < 2;
            if(!needsDeparture && !needsSpan && !needsSectors)
                break;

            var best = null;
            var bestReplace = -1;
            var bestScore = -999999;
            for(var replaceIndex = 0;
                replaceIndex < pSelected.length; ++replaceIndex) {
                for(var candidateIndex = 0;
                    candidateIndex < pCandidates.length; ++candidateIndex) {
                    var candidate = pCandidates[candidateIndex];
                    if(!candidate.activityContext)
                        continue;
                    if(candidate.nearestStructure < structureStandoff)
                        continue;
                    var duplicate = false;
                    for(var usedIndex = 0;
                        usedIndex < pSelected.length; ++usedIndex) {
                        if(usedIndex !== replaceIndex &&
                            pSelected[usedIndex].key === candidate.key) {
                            duplicate = true;
                            break;
                        }
                    }
                    if(duplicate)
                        continue;

                    var trialPoints = [];
                    for(var trialIndex = 0;
                        trialIndex < pSelected.length; ++trialIndex) {
                        trialPoints.push(trialIndex === replaceIndex ?
                            candidate.point : pSelected[trialIndex].point);
                    }
                    var trialMin = this.PickupPointSetMinDistance(trialPoints);
                    var trialSpan = this.PickupPointSetSpan(trialPoints);
                    var trialDeparture = this.PickupPointSetLineDeparture(trialPoints);
                    if(trialMin !== null && trialMin < pMinSpacing)
                        continue;
                    if(trialSpan < spanTarget)
                        continue;
                    if(this.PickupPointSetSectorCount(pContext, trialPoints) < 2)
                        continue;
                    if(trialDeparture < departureTarget)
                        continue;
                    if(needsDeparture &&
                        trialDeparture <= currentDeparture + 0.25)
                        continue;
                    if(needsSpan && trialSpan <= currentSpan + 0.5)
                        continue;

                    var phaseMatch = candidate.routePhase &&
                        candidate.routePhase === pSelected[replaceIndex].routePhase;
                    var score = (trialDeparture * 100) + trialSpan +
                        (phaseMatch ? 40 : 0) +
                        (candidate.source === "grammar_plan" ? 20 : 0) +
                        ((Math.abs(Number(candidate.tie) || 0) % 1000) / 1000);
                    if(score > bestScore &&
                        (!pReachabilityVerifier ||
                            pReachabilityVerifier(candidate.position))) {
                        best = candidate;
                        bestReplace = replaceIndex;
                        bestScore = score;
                    }
                }
            }

            if(!best || bestReplace < 0)
                break;
            best.shapeAdjusted = true;
            best.selectionScore = Math.round(bestScore * 10) / 10;
            pSelected[bestReplace] = best;
        }

        return pSelected;
    };

    pIntegration.PickupCandidateLineDeparture = function(pCandidate, pSelected) {
        if(pSelected.length < 2)
            return 0;

        var points = [];
        for(var index = 0; index < pSelected.length; ++index)
            points.push(pSelected[index].point);
        points.push(pCandidate.point);
        return this.PickupPointSetLineDeparture(points);
    };

    pIntegration.PickupCandidateScore = function(pCandidate, pSelected,
        pUsedSectors, pUsedPhases, pUsedBranches, pUsedRegions, pSlot, pCount) {
        var targetFraction = pCount <= 1 ? 0.52 :
            0.24 + ((pSlot / (pCount - 1)) * 0.56);
        var targetPhase = this.PickupRoutePhase(targetFraction, "", "");
        var score = 0;

        if(pCandidate.source === "structure_approach")
            score += 260;
        else if(pCandidate.source === "encounter_staging")
            score += 240;
        else if(pCandidate.source === "side_route")
            score += 220;
        else if(pCandidate.source === "grammar_plan")
            score += 90;
        else
            score += 50;

        if(pCandidate.activityContext)
            score += 180;
        else
            score -= 500;

        if(pCandidate.nearestStructure < 0x7FFFFFFF) {
            var context = Session.MapGenContext;
            var structureStandoff = this.LivePickupStructureStandoff(context);
            if(pCandidate.nearestStructure < structureStandoff)
                score -= 900 + ((structureStandoff -
                    pCandidate.nearestStructure) * 80);
            else if(pCandidate.nearestStructure <= structureStandoff + 10)
                score += 220 - (Math.abs(pCandidate.nearestStructure -
                    (structureStandoff + 3)) * 12);
        }
        if(pCandidate.nearestEnemy < 0x7FFFFFFF) {
            if(pCandidate.nearestEnemy < 3)
                score -= 180;
            else if(pCandidate.nearestEnemy <= 10)
                score += 180 - (Math.abs(pCandidate.nearestEnemy - 6) * 14);
        }
        if(pCandidate.nearestObjective <= 10)
            score += 140 - (Math.abs(pCandidate.nearestObjective - 6) * 9);
        if(pCandidate.actualDetour)
            score += 160;
        if(pCandidate.nearestStart < 12)
            score -= 360;
        else if(pCandidate.nearestStart >= 18 && pCandidate.nearestStart <= 52)
            score += 45;
        if(pCandidate.edgeDistance < 2)
            score -= 320;
        else if(pCandidate.edgeDistance < 5)
            score -= 120;

        if(pCandidate.routePhase === targetPhase)
            score += 150;
        if(typeof pCandidate.routeFraction === "number")
            score -= Math.abs(pCandidate.routeFraction - targetFraction) * 180;
        else
            score -= 30;

        if(!pUsedSectors[pCandidate.sector])
            score += 70;
        if(pCandidate.routePhase && !pUsedPhases[pCandidate.routePhase])
            score += 100;
        if(pCandidate.branchId && !pUsedBranches[pCandidate.branchId])
            score += 90;
        if(pCandidate.regionId && !pUsedRegions[pCandidate.regionId])
            score += 130;
        if(pCandidate.regionPickupTarget)
            score += 90;

        score += Math.min(30,
            this.PickupCandidateMinimumDistance(pCandidate, pSelected)) * 5;
        score += Math.min(12,
            this.PickupCandidateLineDeparture(pCandidate, pSelected)) * 18;
        score += (Math.abs(Number(pCandidate.tie) || 0) % 1000) / 1000;
        return score;
    };

    pIntegration.PlannedPickupSelections = function(pCount) {
        var context = Session.MapGenContext;
        var candidates = this.CampaignPickupCandidates();
        var prepared = [];
        var selected = [];
        var usedPoints = {};
        var usedSectors = {};
        var usedPhases = {};
        var usedBranches = {};
        var usedRegions = {};
        var minSpacing = context ? Math.max(5, Math.min(10,
            Math.round(Math.min(context.Width, context.Height) * 0.10))) : 5;
        var structureStandoff = this.LivePickupStructureStandoff(context);
        var relaxedStructureStandoff = context &&
            context.Width * context.Height >= 3200 ? structureStandoff :
            Math.max(5, structureStandoff - 3);
        var index;
        var integration = this;
        var reachabilityCache = {};
        var verifyReachability = function(pPosition) {
            if(!pPosition)
                return false;
            var key = String(pPosition.x) + "," + String(pPosition.y);
            if(Object.prototype.hasOwnProperty.call(reachabilityCache, key))
                return reachabilityCache[key];
            var reachable = integration.CampaignPickupPositionReachable(
                pPosition);
            reachabilityCache[key] = !!reachable;
            return !!reachable;
        };

        for(index = 0; index < candidates.length; ++index) {
            var candidate = this.PrepareCampaignPickupCandidate(
                candidates[index], true);
            if(candidate && !usedPoints[candidate.key]) {
                // This table only deduplicates the candidate pool. Selected
                // points are tracked separately below.
                usedPoints[candidate.key] = true;
                prepared.push(candidate);
            }
        }

        usedPoints = {};
        for(var slot = 0; slot < pCount; ++slot) {
            var best = null;
            var bestScore = -999999;

            for(index = 0; index < prepared.length; ++index) {
                var option = prepared[index];
                if(usedPoints[option.key])
                    continue;
                if(!option.activityContext)
                    continue;
                if(option.nearestStructure < structureStandoff)
                    continue;
                if(selected.length &&
                    this.PickupCandidateMinimumDistance(option, selected) < minSpacing)
                    continue;

                var score = this.PickupCandidateScore(
                    option,
                    selected,
                    usedSectors,
                    usedPhases,
                    usedBranches,
                    usedRegions,
                    slot,
                    pCount
                );
                if(score > bestScore && verifyReachability(option.position)) {
                    best = option;
                    bestScore = score;
                }
            }

            // On a constrained small island it is better to retain the requested
            // weapon count than silently lose objective support. Relax spacing,
            // but still reject exact duplicate cells.
            if(!best) {
                for(index = 0; index < prepared.length; ++index) {
                    var relaxed = prepared[index];
                    if(usedPoints[relaxed.key])
                        continue;
                    if(!relaxed.activityContext)
                        continue;
                    if(relaxed.nearestStructure < relaxedStructureStandoff)
                        continue;
                    var relaxedScore = this.PickupCandidateScore(
                        relaxed,
                        selected,
                        usedSectors,
                        usedPhases,
                        usedBranches,
                        usedRegions,
                        slot,
                        pCount
                    );
                    if(relaxedScore > bestScore &&
                        verifyReachability(relaxed.position)) {
                        best = relaxed;
                        bestScore = relaxedScore;
                    }
                }
            }

            // Only a severely constrained island should need a context-free
            // fallback. Keep it as a last-resort objective-completion path,
            // after exhausting guarded, structure and real-detour sites.
            if(!best) {
                for(index = 0; index < prepared.length; ++index) {
                    var fallbackCandidate = prepared[index];
                    if(usedPoints[fallbackCandidate.key])
                        continue;
                    if(fallbackCandidate.nearestStructure <
                        relaxedStructureStandoff)
                        continue;
                    var fallbackScore = this.PickupCandidateScore(
                        fallbackCandidate,
                        selected,
                        usedSectors,
                        usedPhases,
                        usedBranches,
                        usedRegions,
                        slot,
                        pCount
                    );
                    if(fallbackScore > bestScore &&
                        verifyReachability(fallbackCandidate.position)) {
                        best = fallbackCandidate;
                        bestScore = fallbackScore;
                    }
                }
            }

            if(!best)
                break;

            best.selectionScore = Math.round(bestScore * 10) / 10;
            selected.push(best);
            usedPoints[best.key] = true;
            usedSectors[best.sector] = true;
            if(best.routePhase)
                usedPhases[best.routePhase] = true;
            if(best.branchId)
                usedBranches[best.branchId] = true;
            if(best.regionId)
                usedRegions[best.regionId] = true;
        }

        for(var fallback = selected.length; fallback < pCount; ++fallback) {
            var routePosition = this.RoutePosition(fallback, pCount, 0);
            if(!routePosition ||
                !verifyReachability(routePosition))
                continue;
            var fallbackPoint = {
                x: Math.floor(routePosition.x / 16),
                y: Math.floor(routePosition.y / 16)
            };
            var fallbackKey = fallbackPoint.x + "," + fallbackPoint.y;
            if(usedPoints[fallbackKey])
                continue;
            selected.push({
                placement: null,
                point: fallbackPoint,
                position: routePosition,
                source: "primary_route_fallback",
                sourceIndex: fallback,
                spriteType: null,
                role: "route_pickup",
                routeFraction: (fallback + 1) / (pCount + 1),
                routePhase: this.PickupRoutePhase(
                    (fallback + 1) / (pCount + 1), "", ""),
                branchId: null,
                regionId: "",
                topologyPurpose: "",
                snapped: false,
                key: fallbackKey,
                sector: "",
                selectionScore: null
            });
            usedPoints[fallbackKey] = true;
        }

        selected = this.ImprovePickupSelectionShape(
            context,
            selected,
            prepared,
            minSpacing,
            verifyReachability
        );

        return selected;
    };

    pIntegration.RequiresCliffTransitHelicopter = function(pContext) {
        return !!(pContext &&
            pContext.Profile &&
            pContext.Profile.HelicopterTransit &&
            pContext.Cliffs &&
            pContext.Cliffs.length &&
            pContext.Plateau &&
            pContext.Plateau.mode === "terrace");
    };

    pIntegration.PlannedCliffHelicopter = function(pContext) {
        if(!pContext)
            return null;
        if(pContext.CliffHelicopter && pContext.CliffHelicopter.point)
            return pContext.CliffHelicopter;

        var pickups = pContext.Placements && pContext.Placements.pickups ?
            pContext.Placements.pickups : [];

        for(var index = 0; index < pickups.length; ++index) {
            if(pickups[index].kind === "helicopter" && pickups[index].point)
                return pickups[index];
        }

        return null;
    };

    pIntegration.PlaceCampaignCliffHelicopter = function() {
        var context = Session.MapGenContext;

        if(!this.RequiresCliffTransitHelicopter(context))
            return true;
        if(context.CliffHelicopterMaterialized && Helicopters.Human.HaveAny())
            return true;

        var placement = this.PlannedCliffHelicopter(context);
        if(!placement)
            return false;

        var position = this.TileToPosition(placement.point);
        Session.Helicopter = Helicopters.Human.Random(
            SpriteTypes.Helicopter_Grenade_Human,
            position
        );
        context.CliffHelicopterMaterialized = true;
        context.LiveCliffHelicopterPosition = position;

        return !!Session.Helicopter && Helicopters.Human.HaveAny();
    };

    pIntegration.PlaceCampaignPickups = function(pGrenadeCount, pRocketCount) {
        var total = Math.max(0, pGrenadeCount || 0) + Math.max(0, pRocketCount || 0);
        var context = Session.MapGenContext;
        var selections = this.PlannedPickupSelections(total);
        var remainingGrenades = Math.max(0, pGrenadeCount || 0);
        var remainingRockets = Math.max(0, pRocketCount || 0);
        var index;

        if(!selections.length && total > 0)
            return false;

        // Preserve the grammar's intended pickup type at its intended route
        // phase whenever possible. This keeps the forced objective rocket in
        // its authored slot instead of moving every rocket to the first N points.
        for(index = 0; index < selections.length; ++index) {
            var plannedType = selections[index].spriteType;
            if(plannedType === SpriteTypes.RocketBox && remainingRockets > 0) {
                selections[index].liveSpriteType = SpriteTypes.RocketBox;
                --remainingRockets;
            }
            else if(plannedType === SpriteTypes.GrenadeBox && remainingGrenades > 0) {
                selections[index].liveSpriteType = SpriteTypes.GrenadeBox;
                --remainingGrenades;
            }
        }

        for(index = 0; index < selections.length; ++index) {
            if(selections[index].liveSpriteType !== undefined)
                continue;
            if(remainingRockets > 0) {
                selections[index].liveSpriteType = SpriteTypes.RocketBox;
                --remainingRockets;
            }
            else if(remainingGrenades > 0) {
                selections[index].liveSpriteType = SpriteTypes.GrenadeBox;
                --remainingGrenades;
            }
        }

        if(context)
            context.LivePickupPlacements = [];
        var placed = 0;
        for(index = 0; index < selections.length; ++index) {
            var selection = selections[index];
            if(selection.liveSpriteType === undefined)
                continue;
            Map.SpriteAdd(
                selection.liveSpriteType,
                selection.position.x,
                selection.position.y
            );
            ++placed;

            if(context) {
                context.LivePickupPlacements.push({
                    index: index,
                    spriteType: selection.liveSpriteType,
                    plannedSpriteType: selection.spriteType,
                    point: {
                        x: selection.point.x,
                        y: selection.point.y
                    },
                    runtimePosition: {
                        x: selection.position.x,
                        y: selection.position.y
                    },
                    source: selection.source,
                    plannedId: selection.placement ?
                        selection.placement.id || "" : "",
                    role: selection.role,
                    routeFraction: selection.routeFraction,
                    routePhase: selection.routePhase,
                    branchId: selection.branchId,
                    regionId: selection.regionId || "",
                    encounterKind: selection.encounterKind || "",
                    topologyPurpose: selection.topologyPurpose,
                    activityContext: !!selection.activityContext,
                    actualDetour: !!selection.actualDetour,
                    nearestStructure: selection.nearestStructure < 0x7FFFFFFF ?
                        Math.round(selection.nearestStructure * 10) / 10 : null,
                    nearestEnemy: selection.nearestEnemy < 0x7FFFFFFF ?
                        Math.round(selection.nearestEnemy * 10) / 10 : null,
                    nearestObjective: selection.nearestObjective < 0x7FFFFFFF ?
                        Math.round(selection.nearestObjective * 10) / 10 : null,
                    nearestStart: selection.nearestStart < 0x7FFFFFFF ?
                        Math.round(selection.nearestStart * 10) / 10 : null,
                    edgeDistance: selection.edgeDistance,
                    snapped: !!selection.snapped,
                    shapeAdjusted: !!selection.shapeAdjusted,
                    selectionScore: selection.selectionScore
                });
            }
        }

        return placed >= total && remainingGrenades === 0 &&
            remainingRockets === 0 && this.PlaceCampaignCliffHelicopter();
    };

    pIntegration.TileInList = function(pTile, pTiles) {
        for(var index = 0; index < pTiles.length; ++index) {
            if(pTiles[index] === pTile)
                return true;
        }

        return false;
    };

    pIntegration.DecorBlockedVisualTiles = function() {
        var tiles = [1, 2];

        if(MapGen.Terrain && MapGen.Terrain.TileCatalog) {
            var treeTiles = MapGen.Terrain.TileCatalog.JungleTransitionTiles("treeCanopy");
            for(var index = 0; index < treeTiles.length; ++index) {
                if(!this.TileInList(treeTiles[index], tiles))
                    tiles.push(treeTiles[index]);
            }
        }

        return tiles;
    };

    pIntegration.JungleLightDecorTiles = function() {
        return [0, 18, 19, 20, 40];
    };

    pIntegration.DecorFootprintIsJungleLightGround = function(pPoint) {
        if(!Map || !Map.TileGet)
            return false;
        if(Map.getTileType() !== Terrain.Types.Jungle)
            return false;

        var lightTiles = this.JungleLightDecorTiles();

        for(var x = pPoint.x; x <= pPoint.x + 1; ++x) {
            for(var y = pPoint.y - 1; y <= pPoint.y; ++y) {
                if(!this.TileInList(Map.TileGet(x, y), lightTiles))
                    return false;
            }
        }

        return true;
    };

    pIntegration.DecorTouchesBlockedVisualTile = function(pPoint, pRadius, pTop, pBottom) {
        if(!Map || !Map.TileGet || Map.getTileType() !== Terrain.Types.Jungle)
            return false;

        var blockedTiles = this.DecorBlockedVisualTiles();

        for(var x = pPoint.x - pRadius; x <= pPoint.x + pRadius; ++x) {
            for(var y = pPoint.y - pTop; y <= pPoint.y + pBottom; ++y) {
                if(this.TileInList(Map.TileGet(x, y), blockedTiles))
                    return true;
            }
        }

        return false;
    };

    pIntegration.IsDecorPlacementStillOpen = function(pPlacement) {
        var context = Session.MapGenContext;
        var point = pPlacement.point;

        if(!context || !point)
            return false;

        if(!MapGen.Layers.InBounds(context.Layers.blocked, point.x, point.y))
            return false;
        if(MapGen.Layers.Get(context.Layers.water, point.x, point.y, 0))
            return false;
        if(MapGen.Layers.Get(context.Layers.riverBank, point.x, point.y, 0))
            return false;
        if(MapGen.Layers.Get(context.Layers.occupied, point.x, point.y, 0))
            return false;
        if(MapGen.Layers.Get(context.Layers.blocked, point.x, point.y, 0))
            return false;

        var template = MapGen.Decor.TemplateByName(pPlacement.terrain, pPlacement.template);
        if(template && template.runtimeCheck && !template.runtimeCheck(point))
            return false;

        return true;
    };

    pIntegration.PlaceDecorPlacement = function(pPlacement) {
        var template = MapGen.Decor.TemplateByName(pPlacement.terrain, pPlacement.template);

        if(!template || !template.materialize)
            return false;
        if(!this.IsDecorPlacementStillOpen(pPlacement))
            return false;

        template.materialize(pPlacement.point, this.TileToPosition(pPlacement.point));
        return true;
    };

    pIntegration.DecorMaterializationCap = function(pTemplateName, pCounts) {
        if(!pCounts)
            return -1;

        switch(pTemplateName) {
            case "palm":  return Math.max(0, pCounts.Palms || 0);
            case "shrub": return Math.max(0, pCounts.Bushes1 || 0);
            case "bloom": return Math.max(0, pCounts.Blooms || 0);
        }

        return -1;
    };

    pIntegration.PlaceMapDecor = function(pCounts) {
        var context = Session.MapGenContext;

        if(!context || !context.Placements || !context.Placements.decor)
            return false;

        var groups = {};
        var order = [];

        for(var index = 0; index < context.Placements.decor.length; ++index) {
            var name = context.Placements.decor[index].template;
            if(!groups[name]) {
                groups[name] = [];
                order.push(name);
            }
            groups[name].push(context.Placements.decor[index]);
        }

        for(var groupIndex = 0; groupIndex < order.length; ++groupIndex) {
            var name = order[groupIndex];
            var planned = groups[name];
            var cap = this.DecorMaterializationCap(name, pCounts);
            var target = cap < 0 ? planned.length : Math.min(cap, planned.length);
            var placed = 0;

            for(var placementIndex = 0; placementIndex < planned.length && placed < target; ++placementIndex) {
                if(this.PlaceDecorPlacement(planned[placementIndex]))
                    ++placed;
            }

            if(placed < target) {
                var message = "MapGen placed " + placed + " of " + target + " " + name + " decor items";
                print(message);
                MapGen.Context.AddLog(context, message);
            }
        }

        return true;
    };

    pIntegration.PlannedPlacements = function(pGroup) {
        var context = Session.MapGenContext;

        if(!context || !context.Placements || !context.Placements[pGroup])
            return [];

        return context.Placements[pGroup];
    };

    pIntegration.PlannedPlacementBy = function(pGroup, pTemplate, pRole) {
        var group = this.PlannedPlacements(pGroup);

        for(var index = 0; index < group.length; ++index) {
            var placement = group[index];
            if(pTemplate && placement.template !== pTemplate)
                continue;
            if(pRole && placement.role !== pRole)
                continue;
            if(!placement.point)
                continue;

            return placement;
        }

        return null;
    };
})(MapGen.Integration);
