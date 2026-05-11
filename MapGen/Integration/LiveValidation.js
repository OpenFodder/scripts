var MapGen = MapGen || {};
MapGen.Integration = MapGen.Integration || {};

(function(pIntegration) {
    pIntegration.CreateLiveValidationReport = function(pMode) {
        return {
            ok: true,
            mode: pMode || "campaign",
            reasons: [],
            counts: {}
        };
    };

    pIntegration.LiveFail = function(pReport, pReason) {
        pReport.ok = false;
        pReport.reasons.push(pReason);
    };

    pIntegration.SpriteCount = function(pSpriteType) {
        if(typeof Map === "undefined" || !Map.getSpriteTypeCount)
            return 0;

        return Map.getSpriteTypeCount(pSpriteType);
    };

    pIntegration.SpriteTypeGroupCount = function(pNames) {
        var count = 0;
        var seen = {};
        for(var index = 0; index < pNames.length; ++index) {
            var type = SpriteTypes[pNames[index]];
            if(type === undefined || type === null || seen[type])
                continue;
            seen[type] = true;
            count += this.SpriteCount(type);
        }
        return count;
    };

    pIntegration.EnemyInfantryCount = function() {
        return this.SpriteTypeGroupCount([
            "Enemy", "Enemy_Rocket", "Enemy_Leader"
        ]);
    };

    pIntegration.HostileActorCount = function() {
        return this.SpriteTypeGroupCount([
            "Enemy", "Enemy_Rocket", "Enemy_Leader",
            "Tank_Enemy", "VehicleNoGun_Enemy", "VehicleGun_Enemy",
            "Vehicle_Unk_Enemy", "Turret_Missile_Enemy",
            "Turret_Missile2_Enemy", "Turret_HomingMissile_Enemy",
            "Helicopter_Grenade_Enemy", "Helicopter_Grenade2_Enemy",
            "Helicopter_Missile_Enemy", "Helicopter_Homing_Enemy",
            "Helicopter_Homing_Enemy2"
        ]);
    };

    pIntegration.ValidateMinimumCount = function(pReport, pName, pActual, pExpected) {
        pExpected = Math.max(0, Math.ceil(pExpected || 0));
        pReport.counts[pName] = pActual;

        if(pActual < pExpected)
            this.LiveFail(pReport, pName + "_too_low:" + pActual + "/" + pExpected);
    };

    pIntegration.ValidatePlannedContext = function(pReport) {
        var context = Session.MapGenContext;

        if(!context || !context.Validation)
            return;

        if(!context.Validation.ok)
            this.LiveFail(pReport, "plan_validation_failed:" + context.Validation.reasons.join("|"));
    };

    pIntegration.ValidateReachablePosition = function(pReport, pName, pSpriteType, pFrom, pTo) {
        if(!pFrom || !pTo) {
            this.LiveFail(pReport, pName + "_missing_position");
            return false;
        }

        if(!Reachability.VerifyReachable(pSpriteType, pFrom, pTo)) {
            this.LiveFail(pReport, pName + "_unreachable");
            return false;
        }

        return true;
    };

    pIntegration.ValidateReachableSpritesFrom = function(pReport, pName, pSpriteType, pFrom, pPathSpriteType) {
        var sprites = Map.getSpritesByType(pSpriteType);
        var pathSpriteType = pPathSpriteType === undefined ? SpriteTypes.Player : pPathSpriteType;

        for(var index = 0; index < sprites.length; ++index) {
            if(!Reachability.VerifyReachable(pathSpriteType, pFrom, sprites[index].getPosition()))
                this.LiveFail(pReport, pName + "_unreachable:" + index);
        }
    };

    pIntegration.ValidateReachableSpritesFromAny = function(pReport, pName, pSpriteType, pFromPositions, pPathSpriteType) {
        var sprites = Map.getSpritesByType(pSpriteType);
        var pathSpriteType = pPathSpriteType === undefined ? SpriteTypes.Player : pPathSpriteType;

        for(var index = 0; index < sprites.length; ++index) {
            var position = sprites[index].getPosition();
            var reachable = false;

            for(var fromIndex = 0; fromIndex < pFromPositions.length; ++fromIndex) {
                if(Reachability.VerifyReachable(pathSpriteType, pFromPositions[fromIndex], position)) {
                    reachable = true;
                    break;
                }
            }

            if(!reachable)
                this.LiveFail(pReport, pName + "_unreachable:" + index);
        }
    };

    pIntegration.FinishLiveValidation = function(pReport) {
        var context = Session.MapGenContext;

        if(context) {
            context.LiveValidation = pReport;
            if(pReport.ok)
                MapGen.Context.AddLog(context, "Live materialization validation passed");
            else
                MapGen.Context.AddLog(context, "Live materialization validation failed: " + pReport.reasons.join(", "));

            this.WriteContextMetadata(context, this.LiveValidationRequestedSeed(context));
        }

        return pReport;
    };

    pIntegration.LiveValidationRequestedSeed = function(pContext) {
        if(pContext && pContext.RequestedSeed !== undefined)
            return pContext.RequestedSeed;
        if(Settings.Multiplayer && Settings.Multiplayer.Enabled)
            return Settings.Multiplayer.MapSeed;
        return this.CampaignSeed();
    };

    pIntegration.CountReachableSpritesFrom = function(pSpriteType, pFrom, pPathSpriteType) {
        if(!pFrom || typeof Map === "undefined" || !Map.getSpritesByType)
            return 0;

        var sprites = Map.getSpritesByType(pSpriteType);
        var pathSpriteType = pPathSpriteType === undefined ? SpriteTypes.Player : pPathSpriteType;
        var count = 0;

        for(var index = 0; index < sprites.length; ++index) {
            if(Reachability.VerifyReachable(pathSpriteType, pFrom, sprites[index].getPosition()))
                ++count;
        }

        return count;
    };

    pIntegration.CountReachablePositionsFrom = function(pPositions, pFrom, pPathSpriteType) {
        if(!pPositions || !pFrom)
            return 0;

        var pathSpriteType = pPathSpriteType === undefined ? SpriteTypes.Player : pPathSpriteType;
        var count = 0;

        for(var index = 0; index < pPositions.length; ++index) {
            if(Reachability.VerifyReachable(pathSpriteType, pFrom, pPositions[index]))
                ++count;
        }

        return count;
    };

    pIntegration.HumanHelicopterSpriteTypes = function() {
        return [
            SpriteTypes.Helicopter_Grenade_Human,
            SpriteTypes.Helicopter_Missile_Human,
            SpriteTypes.Helicopter_Homing_Human
        ];
    };

    pIntegration.CountHumanHelicopters = function() {
        var types = this.HumanHelicopterSpriteTypes();
        var count = 0;

        for(var index = 0; index < types.length; ++index)
            count += this.SpriteCount(types[index]);

        return count;
    };

    pIntegration.CountReachableHumanHelicoptersFrom = function(pFrom) {
        var types = this.HumanHelicopterSpriteTypes();
        var count = 0;

        for(var index = 0; index < types.length; ++index)
            count += this.CountReachableSpritesFrom(types[index], pFrom, SpriteTypes.Player);

        return count;
    };

    pIntegration.HasDestroyBuildingObjective = function() {
        return typeof Objectives !== "undefined" &&
            typeof Settings !== "undefined" &&
            Settings.hasObjective &&
            Settings.hasObjective(Objectives.DestroyEnemyBuildings);
    };

    pIntegration.PlannedHelicopterTransit = function(pContext) {
        if(!pContext)
            return false;
        if(pContext.CliffHelicopter)
            return true;
        if(pContext.Profile && pContext.Profile.HelicopterTransit)
            return true;

        return false;
    };

    pIntegration.ValidateLiveCliffTransitHelicopter = function(pReport) {
        var context = Session.MapGenContext;

        if(!this.RequiresCliffTransitHelicopter(context))
            return;

        var helicopters = this.CountHumanHelicopters();
        var reachable = Session.HumanPosition ?
            this.CountReachableHumanHelicoptersFrom(Session.HumanPosition) : 0;

        pReport.counts.cliffTransitHelicopters = helicopters;
        pReport.counts.reachableCliffTransitHelicopters = reachable;

        if(helicopters < 1)
            this.LiveFail(pReport, "cliff_transit_helicopter_missing");
        if(reachable < 1)
            this.LiveFail(pReport, "cliff_transit_helicopter_unreachable");
    };

    pIntegration.EnemyStructureAccessInfo = function(pContext, pBuildings) {
        var positions = [];
        var placements = pContext && pContext.LiveStructurePlacements ? pContext.LiveStructurePlacements : [];
        var buildings = pBuildings || [];
        var accessPointCount = 0;

        for(var index = 0; index < placements.length; ++index) {
            var placement = placements[index];
            if(placement.purpose !== "enemy")
                continue;
            if(!placement.accessPoint)
                continue;

            positions.push(this.TileToPosition(placement.accessPoint));
            ++accessPointCount;
        }

        for(var fallback = positions.length; fallback < buildings.length; ++fallback)
            positions.push(buildings[fallback]);

        return {
            positions: positions,
            accessPointCount: accessPointCount,
            missingAccessPoints: Math.max(0, buildings.length - accessPointCount)
        };
    };

    pIntegration.ValidateDestroyBuildingObjectiveSupport = function(pReport, pExpected) {
        if(!this.HasDestroyBuildingObjective())
            return;

        var context = Session.MapGenContext;
        var expected = pExpected || {};
        var buildings = Session.getEnemyBuildings ? Session.getEnemyBuildings() : [];
        var start = Session.HumanPosition || null;
        var buildingAccess = this.EnemyStructureAccessInfo(context, buildings);
        var buildingAccessPositions = buildingAccess.positions;
        var reachableBuildings = start ? this.CountReachablePositionsFrom(buildingAccessPositions, start, SpriteTypes.Player) : 0;
        var grenadeBoxes = this.SpriteCount(SpriteTypes.GrenadeBox);
        var rocketBoxes = this.SpriteCount(SpriteTypes.RocketBox);
        var reachableGrenadeBoxes = start ? this.CountReachableSpritesFrom(SpriteTypes.GrenadeBox, start, SpriteTypes.Player) : 0;
        var reachableRocketBoxes = start ? this.CountReachableSpritesFrom(SpriteTypes.RocketBox, start, SpriteTypes.Player) : 0;
        var heavyExplosionOnlyBunkerDoors =
            this.SpriteCount(SpriteTypes.BunkerDoor_HeavyExplosionOnly) +
            this.SpriteCount(SpriteTypes.BunkerDoor_ReinforcedHeavyExplosionOnly);
        var helicopters = this.CountHumanHelicopters();
        var reachableHelicopters = start ? this.CountReachableHumanHelicoptersFrom(start) : 0;
        var requiredWeaponBoxes = expected.destroyBuildingSupportBoxes !== undefined ?
            Math.max(1, Math.ceil(expected.destroyBuildingSupportBoxes)) :
            Math.max(1, Math.ceil(buildings.length / 4));
        var reachableWeaponBoxes = reachableGrenadeBoxes + reachableRocketBoxes;
        // Generated destroy-buildings targets must accept the ordinary
        // Explosion damage produced by both GrenadeBox and RocketBox weapons.
        // Heavy-explosion-only bunker doors require Explosion2 instead and are
        // rejected below if one leaks into this objective.
        var requiresStandardExplosiveSupport = buildings.length > 0;
        var plannedHelicopterTransit = this.PlannedHelicopterTransit(context);
        var support = {
            enemyBuildings: buildings.length,
            reachableEnemyBuildings: reachableBuildings,
            enemyBuildingAccessPoints: buildingAccess.accessPointCount,
            enemyBuildingMissingAccessPoints: buildingAccess.missingAccessPoints,
            grenadeBoxes: grenadeBoxes,
            rocketBoxes: rocketBoxes,
            reachableGrenadeBoxes: reachableGrenadeBoxes,
            reachableRocketBoxes: reachableRocketBoxes,
            heavyExplosionOnlyBunkerDoors: heavyExplosionOnlyBunkerDoors,
            requiredWeaponBoxes: requiredWeaponBoxes,
            reachableWeaponBoxes: reachableWeaponBoxes,
            requiresStandardExplosiveSupport: requiresStandardExplosiveSupport,
            humanHelicopters: helicopters,
            reachableHumanHelicopters: reachableHelicopters,
            plannedHelicopterTransit: plannedHelicopterTransit
        };

        pReport.objectiveSupport = support;
        pReport.counts.destroyBuildingSupport = support;
        if(context)
            context.ObjectiveSupport = support;

        if(!buildings.length) {
            this.LiveFail(pReport, "destroy_buildings_no_targets");
            return;
        }

        if(heavyExplosionOnlyBunkerDoors > 0)
            this.LiveFail(pReport, "destroy_buildings_heavy_explosion_only_bunker_targets:" + heavyExplosionOnlyBunkerDoors);

        if(reachableWeaponBoxes < requiredWeaponBoxes && reachableHelicopters < 1)
            this.LiveFail(pReport, "destroy_buildings_weapon_support_too_low:" + reachableWeaponBoxes + "/" + requiredWeaponBoxes);

        if(reachableWeaponBoxes < 1 && reachableHelicopters < 1)
            this.LiveFail(pReport, "destroy_buildings_no_reachable_weapon_support");

        if(reachableBuildings < buildings.length && reachableHelicopters < 1)
            this.LiveFail(pReport, "destroy_buildings_unreachable_targets:" + reachableBuildings + "/" + buildings.length);

        if(buildingAccess.accessPointCount < buildings.length && reachableHelicopters < 1)
            this.LiveFail(pReport, "destroy_buildings_missing_access_points:" + buildingAccess.accessPointCount + "/" + buildings.length);

        if(reachableBuildings < buildings.length && reachableHelicopters > 0 && !plannedHelicopterTransit)
            this.LiveFail(pReport, "destroy_buildings_unplanned_helicopter_dependency");
    };

    pIntegration.ValidateLivePickupMapUse = function(pReport) {
        var context = Session.MapGenContext;
        if(!context || !context.LivePickupPlacements)
            return;

        var placements = context.LivePickupPlacements;
        var points = [];
        var sectors = {};
        var phases = {};
        var branches = {};
        var sources = {};
        var contextual = 0;
        var actualDetours = 0;
        var nearestActivityTotal = 0;
        var nearestActivityCount = 0;
        var farthestFromActivity = 0;
        var nearestStructureMinimum = null;
        var structureStandoffViolations = 0;
        var index;

        for(index = 0; index < placements.length; ++index) {
            var placement = placements[index];
            if(!placement || !placement.point)
                continue;
            points.push(placement.point);
            var sectorX = Math.max(0, Math.min(2,
                Math.floor(placement.point.x * 3 / Math.max(1, context.Width))));
            var sectorY = Math.max(0, Math.min(2,
                Math.floor(placement.point.y * 3 / Math.max(1, context.Height))));
            sectors[sectorX + "," + sectorY] = true;
            if(placement.routePhase)
                phases[placement.routePhase] = true;
            if(placement.branchId)
                branches[placement.branchId] = true;
            sources[placement.source || "unknown"] =
                (sources[placement.source || "unknown"] || 0) + 1;
            if(placement.activityContext)
                ++contextual;
            if(placement.actualDetour)
                ++actualDetours;
            var nearestActivity = null;
            var activityDistances = [
                placement.nearestStructure,
                placement.nearestEnemy,
                placement.nearestObjective
            ];
            for(var activityIndex = 0;
                activityIndex < activityDistances.length; ++activityIndex) {
                if(activityDistances[activityIndex] === null ||
                    activityDistances[activityIndex] === undefined)
                    continue;
                var activityDistance = Number(activityDistances[activityIndex]);
                if(!isFinite(activityDistance))
                    continue;
                if(nearestActivity === null || activityDistance < nearestActivity)
                    nearestActivity = activityDistance;
            }
            if(nearestActivity !== null) {
                nearestActivityTotal += nearestActivity;
                ++nearestActivityCount;
                farthestFromActivity = Math.max(farthestFromActivity,
                    nearestActivity);
            }
            if(placement.nearestStructure !== null &&
                placement.nearestStructure !== undefined &&
                isFinite(Number(placement.nearestStructure))) {
                var structureDistance = Number(placement.nearestStructure);
                if(nearestStructureMinimum === null ||
                    structureDistance < nearestStructureMinimum)
                    nearestStructureMinimum = structureDistance;
            }
        }

        var minimum = null;
        var maximum = 0;
        var farthestLeft = -1;
        var farthestRight = -1;
        for(var left = 0; left < points.length; ++left) {
            for(var right = left + 1; right < points.length; ++right) {
                var dx = points[left].x - points[right].x;
                var dy = points[left].y - points[right].y;
                var distance = Math.sqrt((dx * dx) + (dy * dy));
                if(minimum === null || distance < minimum)
                    minimum = distance;
                if(distance > maximum) {
                    maximum = distance;
                    farthestLeft = left;
                    farthestRight = right;
                }
            }
        }

        var lineDeparture = null;
        if(points.length >= 3 && farthestLeft >= 0 && farthestRight >= 0) {
            var lineA = points[farthestLeft];
            var lineB = points[farthestRight];
            var lineDx = lineB.x - lineA.x;
            var lineDy = lineB.y - lineA.y;
            var lineLength = Math.sqrt((lineDx * lineDx) + (lineDy * lineDy));
            lineDeparture = 0;
            if(lineLength > 0.001) {
                for(index = 0; index < points.length; ++index) {
                    if(index === farthestLeft || index === farthestRight)
                        continue;
                    var departure = Math.abs(
                        (lineDy * points[index].x) -
                        (lineDx * points[index].y) +
                        (lineB.x * lineA.y) -
                        (lineB.y * lineA.x)
                    ) / lineLength;
                    lineDeparture = Math.max(lineDeparture, departure);
                }
            }
        }

        function keyCount(pObject) {
            var count = 0;
            for(var key in pObject) {
                if(pObject.hasOwnProperty(key))
                    ++count;
            }
            return count;
        }

        var profile = context.Profile || {};
        var minSide = Math.min(context.Width, context.Height);
        var area = context.Width * context.Height;
        var diagonal = Math.max(1, Math.sqrt(
            (context.Width * context.Width) +
            (context.Height * context.Height)
        ));
        var spanFraction = maximum / diagonal;
        var spacingTarget = Number(profile.LivePickupMinSpacing);
        if(!isFinite(spacingTarget) || spacingTarget <= 0)
            spacingTarget = Math.max(5, Math.min(10, Math.round(minSide * 0.10)));
        var spanTarget = Number(profile.MinLivePickupMapSpanFraction);
        if(!isFinite(spanTarget) || spanTarget <= 0) {
            spanTarget = area >= 6000 ? 0.30 :
                (area >= 3200 ? 0.20 : 0.16);
        }
        var departureTarget = Number(profile.LivePickupLineDeparture);
        if(!isFinite(departureTarget) || departureTarget <= 0)
            departureTarget = Math.max(4, Math.min(8, Math.round(minSide * 0.08)));
        var structureStandoff = this.LivePickupStructureStandoff ?
            this.LivePickupStructureStandoff(context) :
            (area >= 10000 ? 12 : (area >= 6000 ? 10 :
                (area >= 3200 ? 9 : 7)));
        for(index = 0; index < placements.length; ++index) {
            if(placements[index] &&
                placements[index].nearestStructure !== null &&
                placements[index].nearestStructure !== undefined &&
                isFinite(Number(placements[index].nearestStructure)) &&
                Number(placements[index].nearestStructure) < structureStandoff)
                ++structureStandoffViolations;
        }

        var summary = {
            pickups: points.length,
            minDistanceTiles: minimum === null ? null :
                Math.round(minimum * 10) / 10,
            spanTiles: Math.round(maximum * 10) / 10,
            spanFraction: Math.round(spanFraction * 1000) / 1000,
            lineDepartureTiles: lineDeparture === null ? null :
                Math.round(lineDeparture * 10) / 10,
            sectors: keyCount(sectors),
            phases: keyCount(phases),
            branches: keyCount(branches),
            sources: sources,
            contextual: contextual,
            actualDetours: actualDetours,
            openField: Math.max(0, points.length - contextual),
            meanNearestActivityTiles: nearestActivityCount ?
                Math.round((nearestActivityTotal / nearestActivityCount) * 10) / 10 :
                null,
            farthestFromActivityTiles: nearestActivityCount ?
                Math.round(farthestFromActivity * 10) / 10 : null,
            nearestStructureTiles: nearestStructureMinimum === null ? null :
                Math.round(nearestStructureMinimum * 10) / 10,
            structureStandoffViolations: structureStandoffViolations,
            targets: {
                minDistanceTiles: spacingTarget,
                spanFraction: spanTarget,
                lineDepartureTiles: departureTarget,
                structureStandoffTiles: structureStandoff
            }
        };
        pReport.counts.livePickupMapUse = summary;

        if(points.length >= 2 && minimum !== null && minimum < spacingTarget)
            this.LiveFail(pReport, "live_pickups_too_close:" +
                summary.minDistanceTiles + "/" + spacingTarget);
        if(points.length >= 2 && spanFraction < spanTarget)
            this.LiveFail(pReport, "live_pickup_map_span_too_low:" +
                summary.spanFraction + "/" + spanTarget);
        if(points.length >= 3 && lineDeparture !== null &&
            lineDeparture < departureTarget)
            this.LiveFail(pReport, "live_pickups_too_linear:" +
                summary.lineDepartureTiles + "/" + departureTarget);
        if(points.length >= 3 && summary.sectors < 2)
            this.LiveFail(pReport, "live_pickup_sectors_too_low:" +
                summary.sectors + "/2");
        if(summary.openField > 0)
            this.LiveFail(pReport, "live_pickups_without_activity_context:" +
                summary.openField + "/" + points.length);
        if(structureStandoffViolations > 0)
            this.LiveFail(pReport, "live_pickups_too_close_to_structures:" +
                summary.nearestStructureTiles + "/" + structureStandoff);
    };

    pIntegration.ValidateLiveStructureSpacing = function(pReport, pContext) {
        if(!pContext || !pContext.LiveStructurePlacements || !this.RectDistance)
            return;

        var placements = pContext.LiveStructurePlacements;
        var minObserved = null;

        for(var leftIndex = 0; leftIndex < placements.length; ++leftIndex) {
            var left = placements[leftIndex];
            if(!left || !left.rect)
                continue;

            for(var rightIndex = leftIndex + 1; rightIndex < placements.length; ++rightIndex) {
                var right = placements[rightIndex];
                if(!right || !right.rect)
                    continue;

                var minSpacing = 0;
                if(this.StructureSpacing) {
                    minSpacing = Math.max(
                        minSpacing,
                        this.StructureSpacing(left.spec || {}, pContext),
                        this.StructureSpacing(right.spec || {}, pContext)
                    );
                }
                if(pContext.Profile && typeof pContext.Profile.LiveStructureMinSpacing === "number")
                    minSpacing = Math.max(minSpacing, Math.floor(pContext.Profile.LiveStructureMinSpacing));
                // Required whole-map fallback records the narrower spacing it
                // was explicitly allowed to use. Validate that exact audited
                // contract for pairs involving the fallback, while all normal
                // placements retain the profile's preferred minimum.
                if(typeof left.spacingOverride === "number")
                    minSpacing = Math.min(minSpacing, left.spacingOverride);
                if(typeof right.spacingOverride === "number")
                    minSpacing = Math.min(minSpacing, right.spacingOverride);

                // Buildings deliberately authored inside the same compound
                // clearing are one tactical site, not two supposedly spread
                // whole-map objectives. Preserve a readable internal lane but
                // do not apply the cross-map spacing contract within that one
                // compound. Pairs in different clearings still retain the
                // full profile minimum.
                var leftPoint = left.clearingPoint || null;
                var rightPoint = right.clearingPoint || null;
                var sameCompound =
                    left.clearingRole === "compound_objective" &&
                    right.clearingRole === "compound_objective" &&
                    leftPoint && rightPoint &&
                    leftPoint.x === rightPoint.x &&
                    leftPoint.y === rightPoint.y;
                if(sameCompound) {
                    minSpacing = Math.min(
                        minSpacing,
                        Math.max(2, Math.floor(Number(
                            (pContext.Profile || {}).LiveCompoundInternalMinSpacing || 2
                        )))
                    );
                }

                var distance = this.RectDistance(left.rect, right.rect);
                if(minObserved === null || distance < minObserved)
                    minObserved = distance;

                if(minSpacing > 0 && distance < minSpacing) {
                    this.LiveFail(
                        pReport,
                        "live_structure_spacing_too_close:" +
                            leftIndex + "/" + rightIndex + ":" +
                            Math.round(distance) + "/" + minSpacing
                    );
                    return;
                }
            }
        }

        pReport.counts.liveStructureMinDistance = minObserved === null ?
            null :
            Math.round(minObserved * 10) / 10;
    };

    pIntegration.ValidateLiveStructureMapUse = function(pReport, pContext, pExpectedCount) {
        if(!pContext || !pContext.Profile || !pContext.LiveStructurePlacements)
            return;

        var target = Number(pContext.Profile.MinLiveStructureMapSpanFraction || 0);
        var placements = pContext.LiveStructurePlacements;
        var centers = [];
        var maxDistance = 0;
        var minX = pContext.Width;
        var maxX = 0;
        var minY = pContext.Height;
        var maxY = 0;
        var sectors = {};
        var sectorRows = {};
        var sectorColumns = {};
        var regions = {};

        for(var index = 0; index < placements.length; ++index) {
            var rect = placements[index] ? placements[index].rect : null;
            if(!rect)
                continue;
            var center = {
                x: (rect.minX + rect.maxX) / 2,
                y: (rect.minY + rect.maxY) / 2
            };
            centers.push(center);
            minX = Math.min(minX, center.x);
            maxX = Math.max(maxX, center.x);
            minY = Math.min(minY, center.y);
            maxY = Math.max(maxY, center.y);
            var sectorX = Math.max(0, Math.min(2,
                Math.floor(center.x * 3 / Math.max(1, pContext.Width))));
            var sectorY = Math.max(0, Math.min(2,
                Math.floor(center.y * 3 / Math.max(1, pContext.Height))));
            sectors[sectorX + "," + sectorY] = true;
            sectorColumns[sectorX] = true;
            sectorRows[sectorY] = true;
            if(placements[index].regionId)
                regions[placements[index].regionId] = true;
        }

        for(var left = 0; left < centers.length; ++left) {
            for(var right = left + 1; right < centers.length; ++right) {
                var dx = centers[left].x - centers[right].x;
                var dy = centers[left].y - centers[right].y;
                maxDistance = Math.max(maxDistance, Math.sqrt((dx * dx) + (dy * dy)));
            }
        }

        var diagonal = Math.max(1, Math.sqrt(
            (pContext.Width * pContext.Width) +
            (pContext.Height * pContext.Height)
        ));
        var span = maxDistance / diagonal;
        function ownCount(pObject) {
            var count = 0;
            for(var key in pObject) {
                if(Object.prototype.hasOwnProperty.call(pObject, key))
                    ++count;
            }
            return count;
        }
        var lineDeparture = centers.length >= 3 &&
            this.PickupPointSetLineDeparture ?
            this.PickupPointSetLineDeparture(centers) : 0;
        var xSpanFraction = centers.length > 1 ?
            (maxX - minX) / Math.max(1, pContext.Width) : 0;
        var ySpanFraction = centers.length > 1 ?
            (maxY - minY) / Math.max(1, pContext.Height) : 0;
        var sectorCount = ownCount(sectors);
        var sectorRowCount = ownCount(sectorRows);
        var sectorColumnCount = ownCount(sectorColumns);
        var structureRegionCount = ownCount(regions);
        pReport.counts.liveStructureMapUse = {
            structures: centers.length,
            spanTiles: Math.round(maxDistance * 100) / 100,
            spanFraction: Math.round(span * 1000) / 1000,
            targetFraction: target,
            xSpanFraction: Math.round(xSpanFraction * 1000) / 1000,
            ySpanFraction: Math.round(ySpanFraction * 1000) / 1000,
            lineDepartureTiles: Math.round(lineDeparture * 10) / 10,
            sectors: sectorCount,
            sectorRows: sectorRowCount,
            sectorColumns: sectorColumnCount,
            encounterRegions: structureRegionCount
        };

        // Large maps must spend their extra area on gameplay. A low span means
        // all buildings can be cleared in one local encounter while most of
        // the generated terrain is optional scenery.
        var structureFloor = Math.max(0, Math.floor(Number(
            pContext.Profile.MapScaleStructureFloor || 0
        )));
        if(pExpectedCount !== undefined)
            structureFloor = Math.min(
                structureFloor,
                Math.max(0, Math.floor(Number(pExpectedCount) || 0))
            );
        if(structureFloor > 0 && centers.length < structureFloor) {
            this.LiveFail(
                pReport,
                "live_structure_map_count_too_low:" + centers.length + "/" + structureFloor
            );
        }
        else if(target > 0 && structureFloor > 1 && centers.length > 1 && span < target) {
            this.LiveFail(
                pReport,
                "live_structure_map_span_too_low:" +
                    Math.round(span * 1000) / 1000 + "/" + target
                );
        }

        var area = pContext.Width * pContext.Height;
        var iceStyle = String(pContext.Profile.GrammarIceLayoutStyle ||
            pContext.Profile.ForcedIceLayoutStyle || "");
        var constrainedLayout = pContext.Profile.LockGrammarStructureTarget === true ||
            iceStyle.indexOf("cliff") >= 0;
        var minRegions = area >= 10000 ? 4 :
            (area >= 6000 ? 4 : (area >= 3200 ? 3 : 2));
        minRegions = Math.min(minRegions, centers.length);
        if(centers.length >= 3 && structureRegionCount < minRegions) {
            this.LiveFail(pReport, "live_structure_regions_too_low:" +
                structureRegionCount + "/" + minRegions);
        }

        var departureTarget = area >= 10000 ? 8 :
            (area >= 6000 ? 6 : (area >= 3200 ? 4 : 0));
        if(!constrainedLayout && centers.length >= 3 &&
            departureTarget > 0 && lineDeparture < departureTarget) {
            this.LiveFail(pReport, "live_structures_too_linear:" +
                Math.round(lineDeparture * 10) / 10 + "/" + departureTarget);
        }

        var sectorTarget = area >= 10000 ? 5 :
            (area >= 6000 ? 4 : (area >= 3200 ? 3 : 2));
        sectorTarget = Math.min(sectorTarget, centers.length);
        if(!constrainedLayout && centers.length >= 3 &&
            sectorCount < sectorTarget) {
            this.LiveFail(pReport, "live_structure_sectors_too_low:" +
                sectorCount + "/" + sectorTarget);
        }
        if(!constrainedLayout && area >= 10000 && centers.length >= 5 &&
            sectorRowCount < 3) {
            this.LiveFail(pReport, "live_structure_rows_too_low:" +
                sectorRowCount + "/3");
        }
    };

    pIntegration.ValidateLiveStructureWater = function(pReport, pContext) {
        if(!pContext || !pContext.LiveStructurePlacements || !this.StructureWaterOverlapStats)
            return;

        var placements = pContext.LiveStructurePlacements;
        var totals = {
            footprint: 0,
            clearance: 0
        };

        for(var index = 0; index < placements.length; ++index) {
            var placement = placements[index];
            if(!placement || !placement.rect)
                continue;

            var clearance = typeof placement.waterClearance === "number" ?
                placement.waterClearance :
                (this.StructureWaterClearance ?
                    this.StructureWaterClearance(pContext, placement.spec || {}) :
                    0);
            var stats = this.StructureWaterOverlapStats(pContext, placement.rect, clearance, true);
            var semanticStats = pContext.OriginalTerrainTemplate ?
                this.StructureWaterOverlapStats(pContext, placement.rect, clearance, false) :
                stats;
            totals.footprint += stats.footprint;
            totals.clearance += stats.clearance;

            if(stats.footprint > 0) {
                this.LiveFail(pReport, "live_structure_water_overlap:" + index + "/" + stats.footprint);
                return;
            }
            // A smoothed original shoreline may use one water-classified edge
            // tile inside the visual clearance even though the authored water
            // mask is fully outside it. Keep footprint overlap strict and only
            // accept the fringe when the semantic clearance is genuinely dry.
            if(stats.clearance > 0 && semanticStats.clearance > 0) {
                this.LiveFail(pReport, "live_structure_water_clearance_overlap:" + index + "/" + clearance + "/" + stats.clearance);
                return;
            }
        }

        pReport.counts.liveStructureWater = totals;
    };

    pIntegration.ValidateLiveStructureCliffs = function(pReport, pContext) {
        if(!pContext || !pContext.LiveStructurePlacements ||
            !pContext.Cliffs || !pContext.Cliffs.length ||
            !this.IsStructureCliffProtectedCell)
            return;

        var placements = pContext.LiveStructurePlacements;
        var checked = 0;
        for(var index = 0; index < placements.length; ++index) {
            var placement = placements[index];
            if(!placement || !placement.rect)
                continue;

            var spec = placement.spec || {};
            var clearance = this.StructureClearance ?
                this.StructureClearance(spec) :
                { left: 0, right: 0, top: 0, bottom: 0 };
            var cliffClearance = typeof placement.cliffClearance === "number" ?
                placement.cliffClearance :
                (this.StructureCliffClearance ?
                    this.StructureCliffClearance(pContext, spec) : 0);
            var rect = placement.rect;
            ++checked;
            for(var x = rect.minX - clearance.left - cliffClearance;
                x <= rect.maxX + clearance.right + cliffClearance; ++x) {
                for(var y = rect.minY - clearance.top - cliffClearance;
                    y <= rect.maxY + clearance.bottom + cliffClearance; ++y) {
                    if(!this.IsStructureCliffProtectedCell(
                            pContext, x, y))
                        continue;
                    pReport.counts.liveStructureCliffs = {
                        checked: checked,
                        overlaps: 1,
                        structureIndex: index,
                        x: x,
                        y: y
                    };
                    this.LiveFail(pReport,
                        "live_structure_cliff_overlap:" + index + ":" +
                        x + "," + y);
                    return;
                }
            }
        }
        pReport.counts.liveStructureCliffs = {
            checked: checked,
            overlaps: 0
        };
    };

    pIntegration.LiveStructureRenderedContextFloor = function(pContext) {
        if(pContext && pContext.Profile && typeof pContext.Profile.MinRenderedStructureContextCoverFraction === "number")
            return Math.max(0, pContext.Profile.MinRenderedStructureContextCoverFraction);
        if(this.StructureMinContextCoverFraction)
            return this.StructureMinContextCoverFraction(pContext) * 0.60;
        return 0;
    };

    pIntegration.ValidateLiveStructureContext = function(pReport, pContext) {
        if(!pContext || !pContext.LiveStructurePlacements || !this.StructureRenderedContextStats)
            return;

        var radius = this.StructureContextRadius ? this.StructureContextRadius(pContext) : 0;
        var minCover = this.LiveStructureRenderedContextFloor(pContext);

        if(radius <= 0 || minCover <= 0)
            return;

        var placements = pContext.LiveStructurePlacements;
        var summaries = [];

        for(var index = 0; index < placements.length; ++index) {
            var placement = placements[index];
            if(!placement || !placement.rect)
                continue;

            var stats = this.StructureRenderedContextStats(pContext, placement.rect, radius, { IncludeTopTiles: true });
            var cover = stats.coverFraction || 0;
            summaries.push({
                index: index,
                coverFraction: Math.round(cover * 1000) / 1000,
                waterFraction: Math.round((stats.waterFraction || 0) * 1000) / 1000,
                cells: stats.cells || 0,
                tree: stats.tree || 0,
                cliff: stats.cliff || 0,
                water: stats.water || 0,
                topTiles: stats.topTiles || []
            });

            if(cover < minCover) {
                pReport.counts.liveStructureContext = summaries;
                this.LiveFail(
                    pReport,
                    "live_structure_rendered_context_too_open:" +
                        index + ":" +
                        Math.round(cover * 100) + "/" +
                        Math.round(minCover * 100)
                );
                return;
            }
        }

        pReport.counts.liveStructureContext = summaries;
    };

    pIntegration.ValidateLiveStructures = function(pReport, pExpectedCount) {
        var context = Session.MapGenContext;

        if(!context)
            return;

        var placements = context.LiveStructurePlacements || [];
        var expected = pExpectedCount === undefined ? null :
            Math.max(0, Math.floor(Number(pExpectedCount) || 0));
        var destroyObjective = this.HasDestroyBuildingObjective();
        var placementFailed = (expected !== null && placements.length < expected) ||
            (destroyObjective && placements.length === 0);
        var intentionalStructureless = expected === 0 &&
            !destroyObjective && placements.length === 0;

        pReport.counts.liveStructures = placements.length;
        pReport.counts.structurePolicy = {
            requestedStructures: expected,
            liveStructures: placements.length,
            requiredByDestroyObjective: destroyObjective,
            intentionalStructureless: intentionalStructureless,
            placementFailed: placementFailed,
            status: placementFailed ? "placement_failed" :
                (intentionalStructureless ? "intentional_structureless" :
                    (placements.length > 0 ? "structures_present" : "optional_none"))
        };
        if(pExpectedCount !== undefined)
            this.ValidateMinimumCount(
                pReport,
                "liveStructures",
                placements.length,
                pExpectedCount
            );
        this.ValidateLiveStructureSpacing(pReport, context);
        this.ValidateLiveStructureMapUse(pReport, context, pExpectedCount);
        this.ValidateLiveStructureWater(pReport, context);
        this.ValidateLiveStructureCliffs(pReport, context);
        this.ValidateLiveStructureContext(pReport, context);

        // This shared validator also covers legacy/retry-selected generator
        // paths which do not pass through Intent.FinaliseForCommit.
        if(this.ValidateLiveStructureSprites) {
            var spriteReport = this.ValidateLiveStructureSprites(context);
            context.FinalStructureSpriteReport = spriteReport;
            pReport.counts.liveStructureSpriteAnchors = {
                ok: spriteReport.ok,
                placements: spriteReport.placements,
                sprites: spriteReport.sprites
            };
            if(!spriteReport.ok) {
                for(var reasonIndex = 0;
                    reasonIndex < spriteReport.reasons.length;
                    ++reasonIndex) {
                    this.LiveFail(pReport, spriteReport.reasons[reasonIndex]);
                }
            }
        }
    };

    // Ice turret bases occupy two horizontal tiles. Their sprites are offset
    // within the left base cell, so recover that cell from the live sprite and
    // reject any base which overlaps the synthesized cliff/stairs footprint.
    // This duplicates the placement invariant at the materialized-map boundary:
    // a future fallback or placement-order regression cannot silently save the
    // visually broken map.
    pIntegration.ValidateLiveIceTurretCliffKeepOut = function(pReport) {
        var context = Session.MapGenContext;

        if(!context || !context.Profile ||
            context.Profile.TerrainType !== Terrain.Types.Ice ||
            !context.Cliffs || !this.CellInCliffPlacementKeepOut ||
            typeof Map === "undefined" || !Map.getSpritesByType)
            return;

        var turretTypes = [
            SpriteTypes.Turret_Missile_Enemy,
            SpriteTypes.Turret_Missile2_Enemy
        ];
        var checked = 0;
        var overlaps = 0;

        for(var typeIndex = 0; typeIndex < turretTypes.length; ++typeIndex) {
            var sprites = Map.getSpritesByType(turretTypes[typeIndex]);

            for(var spriteIndex = 0; spriteIndex < sprites.length; ++spriteIndex) {
                var position = sprites[spriteIndex].getPosition();
                var tileX = Math.floor(position.x / 16);
                var tileY = Math.floor(position.y / 16);
                ++checked;

                if(this.CellInCliffPlacementKeepOut(context, tileX, tileY) ||
                    this.CellInCliffPlacementKeepOut(context, tileX + 1, tileY)) {
                    ++overlaps;
                    this.LiveFail(
                        pReport,
                        "ice_turret_on_cliff:" + tileX + "," + tileY
                    );
                }
            }
        }

        pReport.counts.iceTurretsChecked = checked;
        pReport.counts.iceTurretCliffOverlaps = overlaps;
    };

    // Validate the saved/live result, not just the grammar plan: actor snapping
    // happens during materialization and could otherwise move a rocket infantry
    // unit back into the opening encounter.
    pIntegration.ValidateLiveRocketEnemyStartKeepOut = function(pReport) {
        var context = Session.MapGenContext;

        if(!context || !context.Anchors || !context.Anchors.start ||
            !this.RocketEnemyStartClearance || !this.RocketEnemyNearStart ||
            typeof Map === "undefined" || !Map.getSpritesByType)
            return;

        var clearance = this.RocketEnemyStartClearance(context);
        var start = context.Anchors.start;
        var sprites = Map.getSpritesByType(SpriteTypes.Enemy_Rocket);
        var minimum = null;
        var violations = 0;

        for(var index = 0; index < sprites.length; ++index) {
            var position = sprites[index].getPosition();
            var tileX = Math.floor(position.x / 16);
            var tileY = Math.floor(position.y / 16);
            var dx = tileX - start.x;
            var dy = tileY - start.y;
            var distance = Math.sqrt((dx * dx) + (dy * dy));

            if(minimum === null || distance < minimum)
                minimum = distance;

            if(this.RocketEnemyNearStart(context, tileX, tileY, clearance)) {
                ++violations;
                this.LiveFail(
                    pReport,
                    "rocket_enemy_near_start:" + tileX + "," + tileY + "/" +
                        Math.round(distance * 10) / 10
                );
            }
        }

        pReport.counts.rocketEnemiesChecked = sprites.length;
        pReport.counts.rocketEnemyStartClearance = clearance;
        pReport.counts.rocketEnemyMinStartDistance = minimum === null ? null :
            Math.round(minimum * 10) / 10;
        pReport.counts.rocketEnemyStartViolations = violations;
        pReport.counts.rocketStartSafetyConversions =
            context.RocketStartSafetyConversions || 0;
    };

    // Validate the topology against the materialized navigation oracle. It is
    // not enough for route metadata to exist: each authored reward/structure
    // site must still be reachable after smoothing and live object placement.
    pIntegration.ValidateLiveGameplayTopology = function(pReport) {
        var context = Session.MapGenContext;
        var plan = context ? context.IntentTopologyPlan : null;
        if(!plan)
            return;

        var paths = context.Paths || [];
        var sideRoutes = 0;
        var sideRoutePoints = 0;
        var routePhases = { early: 0, mid: 0, late: 0 };
        for(var pathIndex = 0; pathIndex < paths.length; ++pathIndex) {
            var path = paths[pathIndex];
            if(!path || (path.role !== "secondary" &&
                path.role !== "flank_loop" && path.role !== "spur" &&
                path.role !== "dead_end"))
                continue;
            ++sideRoutes;
            sideRoutePoints += path.points ? path.points.length : 0;
            if(path.routePhase && routePhases.hasOwnProperty(path.routePhase))
                routePhases[path.routePhase] += 1;
        }

        var sites = plan.sites || [];
        var reachableSites = 0;
        var siteSectors = {};
        var siteRows = {};
        var northernOffAxisSites = 0;
        var objectiveSectorX = context.Anchors && context.Anchors.objective ?
            Math.max(0, Math.min(2, Math.floor(
                context.Anchors.objective.x * 3 /
                Math.max(1, context.Width)))) : 1;
        for(var sectorSiteIndex = 0; sectorSiteIndex < sites.length;
            ++sectorSiteIndex) {
            if(!sites[sectorSiteIndex])
                continue;
            var topologySectorX = Math.max(0, Math.min(2, Math.floor(
                sites[sectorSiteIndex].x * 3 / Math.max(1, context.Width))));
            var topologySectorY = Math.max(0, Math.min(2, Math.floor(
                sites[sectorSiteIndex].y * 3 / Math.max(1, context.Height))));
            siteSectors[topologySectorX + "," + topologySectorY] = true;
            siteRows[topologySectorY] = true;
            if(topologySectorY === 0 && topologySectorX !== objectiveSectorX)
                ++northernOffAxisSites;
        }
        if(Session.HumanPosition) {
            for(var siteIndex = 0; siteIndex < sites.length; ++siteIndex) {
                var position = this.TileToPosition(sites[siteIndex]);
                var siteReachable = Reachability.VerifyReachable(
                    SpriteTypes.Player, Session.HumanPosition, position);

                // A topology destination may deliberately become the centre
                // of a building footprint. In that case the exact authored
                // site cell is solid, while the region's live access point is
                // the correct player destination. Validate that materialized
                // representative before declaring the branch unreachable.
                var siteRegionId = sites[siteIndex].regionId || "";
                if(!siteReachable && siteRegionId) {
                    var regionCandidates = [];
                    var liveStructures = context.LiveStructurePlacements || [];
                    var livePickups = context.LivePickupPlacements || [];
                    var liveEnemies = context.LiveEnemyPlacements || [];
                    var candidateIndex;
                    for(candidateIndex = 0;
                        candidateIndex < liveStructures.length; ++candidateIndex) {
                        if(liveStructures[candidateIndex].regionId === siteRegionId &&
                            liveStructures[candidateIndex].accessPoint)
                            regionCandidates.push(
                                liveStructures[candidateIndex].accessPoint);
                    }
                    for(candidateIndex = 0;
                        candidateIndex < livePickups.length; ++candidateIndex) {
                        if(livePickups[candidateIndex].regionId === siteRegionId &&
                            livePickups[candidateIndex].point)
                            regionCandidates.push(livePickups[candidateIndex].point);
                    }
                    for(candidateIndex = 0;
                        candidateIndex < liveEnemies.length; ++candidateIndex) {
                        if(liveEnemies[candidateIndex].regionId === siteRegionId &&
                            liveEnemies[candidateIndex].point)
                            regionCandidates.push(liveEnemies[candidateIndex].point);
                    }
                    for(candidateIndex = 0;
                        candidateIndex < regionCandidates.length; ++candidateIndex) {
                        if(Reachability.VerifyReachable(
                            SpriteTypes.Player,
                            Session.HumanPosition,
                            this.TileToPosition(regionCandidates[candidateIndex]))) {
                            siteReachable = true;
                            break;
                        }
                    }
                }
                if(siteReachable)
                    ++reachableSites;
            }
        }

        var topologyClearings = 0;
        var clearings = context.Clearings || [];
        for(var clearingIndex = 0; clearingIndex < clearings.length; ++clearingIndex) {
            if(clearings[clearingIndex] && clearings[clearingIndex].topologySite)
                ++topologyClearings;
        }

        var required = Math.max(0, Math.floor(Number(plan.required || 0)));
        function topologyKeyCount(pObject) {
            var count = 0;
            for(var topologyKey in pObject) {
                if(pObject.hasOwnProperty(topologyKey))
                    ++count;
            }
            return count;
        }
        var siteSectorCount = topologyKeyCount(siteSectors);
        var siteRowCount = topologyKeyCount(siteRows);
        var requiredPhases = 0;
        var authoredPhases = 0;
        var phaseNames = ["early", "mid", "late"];
        for(var phaseIndex = 0; phaseIndex < phaseNames.length; ++phaseIndex) {
            var phaseName = phaseNames[phaseIndex];
            if(plan.phaseTargets && plan.phaseTargets[phaseName] > 0) {
                ++requiredPhases;
                if(routePhases[phaseName] > 0)
                    ++authoredPhases;
            }
        }
        pReport.counts.gameplayTopology = {
            desiredRoutes: plan.desired || 0,
            requiredRoutes: required,
            sideRoutes: sideRoutes,
            sideRoutePoints: sideRoutePoints,
            sites: sites.length,
            reachableSites: reachableSites,
            topologyClearings: topologyClearings,
            routePhases: routePhases,
            requiredPhases: requiredPhases,
            authoredPhases: authoredPhases,
            failedAuthoringAttempts: plan.failed || 0,
            siteSectors: siteSectorCount,
            siteRows: siteRowCount,
            northernOffAxisSites: northernOffAxisSites
        };
        if(sideRoutes < required)
            this.LiveFail(pReport, "gameplay_side_routes_too_low:" +
                sideRoutes + "/" + required);
        if(sites.length < required)
            this.LiveFail(pReport, "gameplay_route_sites_too_low:" +
                sites.length + "/" + required);
        if(reachableSites < required)
            this.LiveFail(pReport, "gameplay_route_sites_unreachable:" +
                reachableSites + "/" + required);
        if(topologyClearings < Math.min(required, 3))
            this.LiveFail(pReport, "gameplay_topology_clearings_too_low:" +
                topologyClearings + "/" + Math.min(required, 3));
        if(authoredPhases < requiredPhases)
            this.LiveFail(pReport, "gameplay_topology_phase_gap:" +
                authoredPhases + "/" + requiredPhases);
        if(context.Width * context.Height >= 10000 && sites.length >= 3 &&
            siteRowCount < 2)
            this.LiveFail(pReport, "gameplay_topology_rows_too_low:" +
                siteRowCount + "/2");
        if(context.Width * context.Height >= 10000 && sites.length >= 3 &&
            northernOffAxisSites < 1)
            this.LiveFail(pReport, "gameplay_topology_northern_sector_unused");
    };

    // Validate the shared encounter-region contract against what was actually
    // materialized.  Phase labels alone cannot detect three buildings and all
    // support items occupying one compound; this groups live structures,
    // enemies and pickups by their concrete region, checks concentration, and
    // asks both the engine and the final generator grid whether the travelled
    // sequence is connected.
    pIntegration.ValidateLiveEncounterRegions = function(pReport) {
        var context = Session.MapGenContext;
        var plan = context ? context.EncounterRegionPlan : null;
        if(!plan || !plan.regions || !plan.regions.length)
            return;

        var summaries = {};
        var index;
        for(index = 0; index < plan.regions.length; ++index) {
            var source = plan.regions[index];
            summaries[source.id] = {
                id: source.id,
                kind: source.kind,
                required: !!source.required,
                optional: !!source.optional,
                routeFraction: source.routeFraction,
                point: source.point,
                structures: 0,
                enemies: 0,
                pickups: 0,
                representative: null
            };
        }

        function nearestRegion(pPoint) {
            if(!pPoint || !MapGen.Encounters ||
                !MapGen.Encounters.NearestEncounterRegion)
                return null;
            return MapGen.Encounters.NearestEncounterRegion(
                context, pPoint, false);
        }

        function addPlacement(pPlacement, pGroup, pPoint) {
            if(!pPoint)
                return;
            var region = pPlacement && pPlacement.regionId &&
                MapGen.Encounters && MapGen.Encounters.EncounterRegionById ?
                MapGen.Encounters.EncounterRegionById(
                    context, pPlacement.regionId) : null;
            if(!region)
                region = nearestRegion(pPoint);
            var summary = region ? summaries[region.id] : null;
            if(!summary)
                return;
            summary[pGroup] += 1;
            if(!summary.representative) {
                summary.representative = { x: pPoint.x, y: pPoint.y };
                // Actors and pickups can occupy a different sub-tile position
                // from the tile origin. Check the position actually spawned.
                var runtime = pPlacement && pPlacement.runtimePosition;
                summary.representativePosition = runtime ? {x: runtime.x, y: runtime.y} :
                    {x: pPoint.x * 16, y: pPoint.y * 16};
            }
        }

        var structures = context.LiveStructurePlacements || [];
        for(index = 0; index < structures.length; ++index) {
            var structure = structures[index];
            var structurePoint = structure.accessPoint;
            if(!structurePoint && structure.rect) {
                structurePoint = {
                    x: Math.round((structure.rect.minX + structure.rect.maxX) / 2),
                    y: Math.round((structure.rect.minY + structure.rect.maxY) / 2)
                };
            }
            addPlacement(structure, "structures", structurePoint);
        }
        var enemies = context.LiveEnemyPlacements || [];
        for(index = 0; index < enemies.length; ++index) {
            if(!enemies[index].dropped)
                addPlacement(enemies[index], "enemies", enemies[index].point);
        }
        var pickups = context.LivePickupPlacements || [];
        for(index = 0; index < pickups.length; ++index)
            addPlacement(pickups[index], "pickups", pickups[index].point);

        var active = [];
        var activeRequired = 0;
        var activeOptional = 0;
        var totalActivity = 0;
        var maxRegionActivity = 0;
        var minFraction = 1;
        var maxFraction = 0;
        for(index = 0; index < plan.regions.length; ++index) {
            var summary = summaries[plan.regions[index].id];
            var activity = summary.structures + summary.enemies + summary.pickups;
            plan.regions[index].assignments = {
                structures: summary.structures,
                enemies: summary.enemies,
                pickups: summary.pickups
            };
            totalActivity += activity;
            maxRegionActivity = Math.max(maxRegionActivity, activity);
            if(activity <= 0 || summary.kind === "start_safe")
                continue;
            active.push(summary);
            if(summary.optional)
                ++activeOptional;
            else
                ++activeRequired;
            minFraction = Math.min(minFraction, Number(summary.routeFraction) || 0);
            maxFraction = Math.max(maxFraction, Number(summary.routeFraction) || 0);
        }
        active.sort(function(pLeft, pRight) {
            return Number(pLeft.routeFraction) - Number(pRight.routeFraction);
        });

        var reachable = 0;
        var travelLengths = [];
        var engineConnectedLegs = 0;
        var previous = null;
        for(index = 0; index < active.length; ++index) {
            var representative = active[index].representative || active[index].point;
            var pixel = active[index].representativePosition;
            var runtime = pixel ? new cPosition(pixel.x, pixel.y) : this.TileToPosition(representative);
            if(!Session.HumanPosition || Reachability.VerifyReachable(
                SpriteTypes.Player, Session.HumanPosition, runtime))
                ++reachable;
            if(previous) {
                var previousRuntime = previous;
                var livePath = typeof Map !== "undefined" &&
                    Map.calculatePathBetweenPositions ?
                    Map.calculatePathBetweenPositions(
                        SpriteTypes.Player, previousRuntime, runtime) : null;
                travelLengths.push(livePath ? livePath.length : 0);
                if(livePath && livePath.length)
                    ++engineConnectedLegs;
            }
            previous = runtime;
        }

        var area = context.Width * context.Height;
        var minimumActive = area >= 10000 ? 6 :
            (area >= 6000 ? 5 : (area >= 3200 ? 4 : 3));
        minimumActive = Math.min(minimumActive,
            Math.max(1, totalActivity), plan.regions.length - 1);
        var minimumOptional = area >= 6000 ? 2 :
            (area >= 3200 ? 1 : 0);
        minimumOptional = Math.min(minimumOptional,
            Number(plan.optionalRegionCount) || 0);
        var routeSpan = active.length ? maxFraction - minFraction : 0;
        var concentration = totalActivity ?
            maxRegionActivity / totalActivity : 0;
        var disconnectedLegs = 0;
        for(index = 0; index < travelLengths.length; ++index) {
            if(travelLengths[index] <= 0)
                ++disconnectedLegs;
        }

        var deepPlan = context.DeepOptionalEncounterPlan || null;
        var deepOutposts = {
            enabled: !!(deepPlan && deepPlan.enabled),
            target: 0,
            meetingTarget: 0,
            minimumEnemies: deepPlan && deepPlan.minimumEnemiesPerOutpost ?
                deepPlan.minimumEnemiesPerOutpost : 1,
            regions: []
        };
        if(deepOutposts.enabled) {
            var deepIds = deepPlan.outpostRegionIds || [];
            deepOutposts.target = deepIds.length;
            for(index = 0; index < deepIds.length; ++index) {
                var deepSummary = summaries[deepIds[index]];
                var deepEnemies = deepSummary ? deepSummary.enemies : 0;
                if(deepEnemies >= deepOutposts.minimumEnemies)
                    ++deepOutposts.meetingTarget;
                deepOutposts.regions.push({
                    id: deepIds[index],
                    enemies: deepEnemies
                });
            }
        }

        pReport.counts.encounterRegions = {
            planned: plan.regions.length,
            required: plan.requiredRegionCount || 0,
            optional: plan.optionalRegionCount || 0,
            active: active.length,
            activeRequired: activeRequired,
            activeOptional: activeOptional,
            reachable: reachable,
            totalActivity: totalActivity,
            maxRegionActivity: maxRegionActivity,
            concentration: Math.round(concentration * 1000) / 1000,
            routeSpan: Math.round(routeSpan * 1000) / 1000,
            travelLengths: travelLengths,
            engineConnectedLegs: engineConnectedLegs,
            deepOptionalOutposts: deepOutposts,
            regions: summaries
        };

        if(active.length < minimumActive)
            this.LiveFail(pReport, "encounter_regions_too_few:" +
                active.length + "/" + minimumActive);
        if(activeOptional < minimumOptional)
            this.LiveFail(pReport, "encounter_optional_regions_unused:" +
                activeOptional + "/" + minimumOptional);
        if(reachable < active.length)
            this.LiveFail(pReport, "encounter_regions_unreachable:" +
                reachable + "/" + active.length);
        if(disconnectedLegs)
            this.LiveFail(pReport, "encounter_region_travel_disconnected:" +
                disconnectedLegs);
        if(area >= 3200 && active.length >= 3 && routeSpan < 0.42)
            this.LiveFail(pReport, "encounter_route_span_too_low:" +
                Math.round(routeSpan * 1000) / 1000 + "/0.42");
        if(totalActivity >= 6 && concentration > 0.67)
            this.LiveFail(pReport, "encounter_region_concentrated:" +
                Math.round(concentration * 1000) / 1000 + "/0.67");
        if(deepOutposts.enabled &&
            deepOutposts.meetingTarget < deepOutposts.target) {
            this.LiveFail(pReport, "encounter_outposts_too_shallow:" +
                deepOutposts.meetingTarget + "/" + deepOutposts.target +
                ":min_enemies=" + deepOutposts.minimumEnemies);
        }
    };

    // Recompute from the final placed structures and materialized route graph.
    // Plan-time utilisation can use clearing intents on v1; this final boundary
    // deliberately uses the actual live placements where they are available.
    pIntegration.ValidateLiveGameplayUtilization = function(pReport) {
        var context = Session.MapGenContext;
        if(!context || !MapGen.Metrics || !MapGen.Metrics.GameplayUtilization)
            return;

        var use = MapGen.Metrics.GameplayUtilization(context);
        context.GameplayUtilization = use;
        pReport.counts.gameplayUtilization = use;

        for(var index = 0; index < use.hardReasons.length; ++index)
            this.LiveFail(pReport, "live_" + use.hardReasons[index]);
    };

    // Inspect final tiles, so a coast label or a discarded sand layer cannot
    // satisfy the beach contract. Quicksand belongs to a separate tile group.
    pIntegration.ValidateSandyCoastline = function(c, report, tileAt) {
        if(!c || !c.Profile.RequireSandyCoastline)
            return;
        var beach = MapGen.Terrain.Smoothing.Jungle.Sub1EdgeData().beach;
        var sand = 0, shore = 0, edgeWater = 0;
        for(var x = 0; x < c.Width; ++x) {
            for(var y = 0; y < c.Height; ++y) {
                var tile = beach.tiles[tileAt(x, y)];
                if(tile && tile.center === "sand") {
                    ++sand;
                    if((tile.edges.N + tile.edges.E + tile.edges.S + tile.edges.W).indexOf("W") >= 0)
                        ++shore;
                }
                if((x === 0 || y === 0 || x === c.Width - 1 || y === c.Height - 1) &&
                    MapGen.Layers.Get(c.Layers.water, x, y, 0))
                    ++edgeWater;
            }
        }
        report.counts.beachSandTiles = sand;
        report.counts.beachShoreTiles = shore;
        report.counts.beachEdgeWaterTiles = edgeWater;
        if(sand < Math.max(16, Math.min(c.Width, c.Height)) || shore < 8 || edgeWater < 4)
            this.LiveFail(report, "sandy_coastline_missing:" + sand + "/" + shore + "/" + edgeWater);
    };

    pIntegration.ValidateMaterializedCampaign = function(pExpected) {
        var expected = pExpected || {};
        var report = this.CreateLiveValidationReport("campaign");
        var enemyBuildingCount = Session.getEnemyBuildings ? Session.getEnemyBuildings().length : 0;
        var totalStructureCount = Session.TotalStructures ? Session.TotalStructures() : 0;

        this.ValidatePlannedContext(report);
        this.ValidateMinimumCount(report, "players", this.SpriteCount(SpriteTypes.Player), expected.players || 1);

        if(expected.enemies !== undefined)
            this.ValidateMinimumCount(report, "enemies", this.SpriteCount(SpriteTypes.Enemy), expected.enemies);
        if(expected.enemyInfantry !== undefined)
            this.ValidateMinimumCount(report, "enemyInfantry",
                this.EnemyInfantryCount(), expected.enemyInfantry);
        report.counts.hostileActors = this.HostileActorCount();
        if(expected.enemyBuildings !== undefined)
            this.ValidateMinimumCount(report, "enemyBuildings", enemyBuildingCount, expected.enemyBuildings);
        if(expected.totalStructures !== undefined)
            this.ValidateMinimumCount(report, "totalStructures", totalStructureCount, expected.totalStructures);
        if(expected.grenadeBoxes !== undefined)
            this.ValidateMinimumCount(report, "grenadeBoxes", this.SpriteCount(SpriteTypes.GrenadeBox), expected.grenadeBoxes);
        if(expected.rocketBoxes !== undefined)
            this.ValidateMinimumCount(report, "rocketBoxes", this.SpriteCount(SpriteTypes.RocketBox), expected.rocketBoxes);

        if(typeof Objectives !== "undefined" && typeof Settings !== "undefined" && Settings.hasObjective) {
            if(Settings.hasObjective(Objectives.RescueHostages)) {
                this.ValidateMinimumCount(report, "hostages", this.SpriteCount(SpriteTypes.Hostage), expected.hostages || 1);
                if(!Session.isRescueTentPlaced || !Session.isRescueTentPlaced())
                    this.LiveFail(report, "rescue_tent_missing");
            }

            if(Settings.hasObjective(Objectives.GetCivilianHome))
                this.ValidateMinimumCount(report, "civilianHomeActors", this.SpriteCount(SpriteTypes.Civilian_Spear), expected.civilians || 1);
        }

        if(Session.HumanPosition) {
            this.ValidateReachableSpritesFrom(report, "grenade_box", SpriteTypes.GrenadeBox, Session.HumanPosition, SpriteTypes.Player);
            this.ValidateReachableSpritesFrom(report, "rocket_box", SpriteTypes.RocketBox, Session.HumanPosition, SpriteTypes.Player);
        }

        this.ValidateEscortObjectives(report);
        this.ValidateLiveCliffTransitHelicopter(report);
        this.ValidateDestroyBuildingObjectiveSupport(report, expected);
        this.ValidateLivePickupMapUse(report);
        this.ValidateLiveStructures(report, expected.liveStructures);
        this.ValidateLiveIceTurretCliffKeepOut(report);
        this.ValidateLiveRocketEnemyStartKeepOut(report);
        this.ValidateLiveEncounterRegions(report);
        this.ValidateLiveGameplayTopology(report);
        this.ValidateLiveGameplayUtilization(report);
        this.ValidateSandyCoastline(Session.MapGenContext, report, function(x, y) { return Map.TileGet(x, y); });

        return this.FinishLiveValidation(report);
    };

    pIntegration.ValidateMaterializedMultiplayer = function() {
        var report = this.CreateLiveValidationReport("multiplayer");
        var teamCount = typeof Settings !== "undefined" && Settings.Multiplayer ? Settings.Multiplayer.TeamCount || 1 : 1;
        var troopsPerTeam = typeof Settings !== "undefined" && Settings.Multiplayer ? Settings.Multiplayer.SquadTroopsPerTeam || 1 : 1;
        var expectedPlayers = teamCount * troopsPerTeam;
        var spawns = Session.TeamSpawns || [];

        this.ValidatePlannedContext(report);
        this.ValidateMinimumCount(report, "teamSpawns", spawns.length, teamCount);
        this.ValidateMinimumCount(report, "players", this.SpriteCount(SpriteTypes.Player), expectedPlayers);
        this.ValidateMaterializedMultiplayerPlayerSpawnTiles(report);

        if(teamCount > 1 && spawns.length > 1) {
            var distance = this.PositionDistance(spawns[0], spawns[1]);
            report.counts.teamSpawnDistance = distance;
            if(typeof Teams !== "undefined" && distance < Teams.MinimumSpawnDistance * 0.65)
                this.LiveFail(report, "team_spawns_too_close_after_materialization");
        }

        for(var teamIndex = 0; teamIndex < spawns.length; ++teamIndex) {
            for(var otherIndex = 0; otherIndex < spawns.length; ++otherIndex) {
                if(otherIndex == teamIndex)
                    continue;
                this.ValidateReachablePosition(
                    report,
                    "team_spawn_path:" + teamIndex + ":" + otherIndex,
                    SpriteTypes.Player,
                    spawns[teamIndex],
                    spawns[otherIndex]
                );
            }

            for(var objectiveIndex = 0; objectiveIndex < Session.ObjectivePositions.length; ++objectiveIndex) {
                this.ValidateReachablePosition(
                    report,
                    "objective_path:" + teamIndex + ":" + objectiveIndex,
                    SpriteTypes.Player,
                    spawns[teamIndex],
                    Session.ObjectivePositions[objectiveIndex]
                );
            }

            for(var extractionIndex = 0; extractionIndex < Session.ExtractionZones.length; ++extractionIndex) {
                this.ValidateReachablePosition(
                    report,
                    "extraction_path:" + teamIndex + ":" + extractionIndex,
                    SpriteTypes.Player,
                    spawns[teamIndex],
                    Session.ExtractionZones[extractionIndex]
                );
            }
        }

        if(spawns.length) {
            this.ValidateReachableSpritesFromAny(report, "multiplayer_grenade_box", SpriteTypes.GrenadeBox, spawns, SpriteTypes.Player);
            this.ValidateReachableSpritesFromAny(report, "multiplayer_rocket_box", SpriteTypes.RocketBox, spawns, SpriteTypes.Player);
        }

        return this.FinishLiveValidation(report);
    };

    pIntegration.ValidateMaterializedMultiplayerPlayerSpawnTiles = function(pReport) {
        var context = Session.MapGenContext;
        if(!context || typeof Map === "undefined" || !Map.getSpritesByType)
            return;

        var players = Map.getSpritesByType(SpriteTypes.Player);
        var dryCount = 0;
        for(var index = 0; index < players.length; ++index) {
            var position = players[index].getPosition();
            var tile = this.PositionToTile(position);

            if(this.SavedTileDryForMultiplayerSpawn(context, tile)) {
                ++dryCount;
                continue;
            }

            this.LiveFail(
                pReport,
                "multiplayer_player_spawn_not_dry:" + index + ":" + tile.x + "," + tile.y
            );
        }

        pReport.counts.playerSpawnDryTiles = dryCount;
    };
})(MapGen.Integration);
