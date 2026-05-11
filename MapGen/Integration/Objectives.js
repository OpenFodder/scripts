var MapGen = MapGen || {};
MapGen.Integration = MapGen.Integration || {};

(function(pIntegration) {
    // Role-priority lookup per objective purpose. Lower = preferred clearing.
    // The "start" sentinels (10) deprioritise the player start; the per-purpose
    // default (last column) applies to any role not listed. Pure data — no RNG
    // or HashTile — so this is a byte-identical rewrite of the former ladders.
    var OBJECTIVE_ROLE_PRIORITY = {
        hostage:       { roles: { objective: 0, ambush_pocket: 1, route_rest: 2, support: 3, start: 10 }, fallback: 4 },
        rescue_tent:   { roles: { support: 0, route_rest: 1, start: 2, flank: 3 }, fallback: 4 },
        civilian:      { roles: { route_rest: 0, flank: 1, support: 2, objective: 3, start: 10 }, fallback: 4 },
        civilian_home: { roles: { support: 0, route_rest: 1, flank: 2, start: 3, objective: 4 }, fallback: 5 }
    };

    pIntegration.ObjectiveRolePriority = function(pPurpose, pRole) {
        var spec = OBJECTIVE_ROLE_PRIORITY[pPurpose];
        if(!spec)
            return 5;
        if(Object.prototype.hasOwnProperty.call(spec.roles, pRole))
            return spec.roles[pRole];
        return spec.fallback;
    };

    pIntegration.ObjectiveClearings = function(pContext, pPurpose) {
        var candidates = [];

        if(!pContext || !pContext.Clearings)
            return candidates;

        for(var index = 0; index < pContext.Clearings.length; ++index) {
            var clearing = pContext.Clearings[index];

            candidates.push({
                clearing: clearing,
                priority: this.ObjectiveRolePriority(pPurpose, clearing.role),
                tie: MapGen.Random.HashTile(pContext.Seed, clearing.x, clearing.y, 503 + index)
            });
        }

        candidates.sort(function(pLeft, pRight) {
            if(pLeft.priority !== pRight.priority)
                return pLeft.priority - pRight.priority;
            if(pLeft.clearing.radius !== pRight.clearing.radius)
                return pRight.clearing.radius - pLeft.clearing.radius;
            if(pLeft.tie !== pRight.tie)
                return pLeft.tie - pRight.tie;
            // Total-order tiebreak on unique clearing coords (HashTile ties can
            // collide; the engine's Array.sort is unstable).
            if(pLeft.clearing.x !== pRight.clearing.x)
                return pLeft.clearing.x - pRight.clearing.x;
            return pLeft.clearing.y - pRight.clearing.y;
        });

        var clearings = [];
        for(var clearIndex = 0; clearIndex < candidates.length; ++clearIndex)
            clearings.push(candidates[clearIndex].clearing);

        return clearings;
    };

    pIntegration.ObjectiveOffsets = function(pCount) {
        var count = Math.max(1, Math.floor(pCount || 1));
        var offsets = [];
        var start = -Math.floor((count - 1) / 2);

        for(var index = 0; index < count; ++index)
            offsets.push({ x: start + index, y: 0 });

        return offsets;
    };

    pIntegration.ObjectivePointPosition = function(pPoint, pOffset) {
        return this.TileToPosition({
            x: pPoint.x + (pOffset ? pOffset.x : 0),
            y: pPoint.y + (pOffset ? pOffset.y : 0)
        });
    };

    pIntegration.ObjectiveTileClear = function(pContext, pX, pY) {
        if(MapGen.Layout.Reservations.At(pContext,pX,pY) & MapGen.Layout.Reservations.FLOOR)
            return false;
        if(pX < 0 || pY < 0 || pX >= pContext.Width || pY >= pContext.Height)
            return false;
        if(MapGen.Layers.Get(pContext.Layers.water, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(pContext.Layers.riverBank, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(pContext.Layers.blocked, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(pContext.Layers.occupied, pX, pY, 0))
            return false;

        return true;
    };

    pIntegration.ObjectiveSiteClear = function(pContext, pPoint, pOffsets, pAvoidPositions, pAvoidDistance) {
        for(var index = 0; index < pOffsets.length; ++index) {
            var tileX = pPoint.x + pOffsets[index].x;
            var tileY = pPoint.y + pOffsets[index].y;

            if(!this.ObjectiveTileClear(pContext, tileX, tileY))
                return false;
            if(this.TooCloseToPositions(this.TileToPosition({ x: tileX, y: tileY }), pAvoidPositions, pAvoidDistance))
                return false;
        }

        return true;
    };

    pIntegration.ObjectiveCandidateInClearing = function(pContext, pClearing, pIndex, pOffsets, pAvoidPositions, pAvoidDistance) {
        var maxOffset = 0;
        var goldenAngle = 2.399963229728653;

        for(var offsetIndex = 0; offsetIndex < pOffsets.length; ++offsetIndex)
            maxOffset = Math.max(maxOffset, Math.abs(pOffsets[offsetIndex].x), Math.abs(pOffsets[offsetIndex].y));

        for(var attempt = 0; attempt < 72; ++attempt) {
            var point = {
                x: pClearing.x,
                y: pClearing.y
            };
            var maxDistance = Math.max(0, pClearing.radius - maxOffset - 1);

            if(attempt > 0 && maxDistance > 0) {
                var salt = 701 + (pIndex * 31) + attempt;
                var angle = ((MapGen.Random.HashTile(pContext.Seed, pClearing.x + pIndex, pClearing.y, salt) % 6283) / 1000) +
                    (pIndex * goldenAngle) + (attempt * 0.47);
                var distance = Math.min(maxDistance, Math.max(1, maxDistance * (0.30 + ((attempt % 5) * 0.16))));

                point.x = Math.round(pClearing.x + (Math.cos(angle) * distance));
                point.y = Math.round(pClearing.y + (Math.sin(angle) * distance));
            }

            if(this.ObjectiveSiteClear(pContext, point, pOffsets, pAvoidPositions, pAvoidDistance))
                return point;
        }

        return null;
    };

    pIntegration.FindObjectivePoint = function(pContext, pPurpose, pIndex, pOffsets, pAvoidPositions, pAvoidDistance) {
        var clearings = this.ObjectiveClearings(pContext, pPurpose);

        for(var index = 0; index < clearings.length; ++index) {
            var candidate = this.ObjectiveCandidateInClearing(
                pContext,
                clearings[index],
                pIndex + index,
                pOffsets,
                pAvoidPositions,
                pAvoidDistance
            );

            if(candidate)
                return candidate;
        }

        return null;
    };

    pIntegration.ReserveObjectiveOffsets = function(pContext, pGroup, pKind, pPoint, pOffsets, pApproach) {
        for(var index = 0; index < pOffsets.length; ++index) {
            var tileX = pPoint.x + pOffsets[index].x;
            var tileY = pPoint.y + pOffsets[index].y;

            MapGen.Layers.StampDisc(pContext.Layers.occupied, tileX, tileY, 1, pKind);
            MapGen.Layers.StampDisc(pContext.Layers.keepClear, tileX, tileY, pApproach || 2, 1);
        }

        pContext.Placements[pGroup].push({
            kind: pKind,
            template: pKind,
            role: pKind,
            point: { x: pPoint.x, y: pPoint.y },
            radius: Math.max(1, pOffsets.length),
            approach: pApproach || 2
        });
    };

    pIntegration.PlaceHostageGroup = function(pContext, pPoint, pHostageCount, pHasEnemyGuard) {
        var count = Math.max(1, Math.floor(pHostageCount || 1));
        var offsets = this.ObjectiveOffsets(count);
        var groupPosition = this.TileToPosition(pPoint);

        Session.HostageGroupPositions.push(groupPosition);

        for(var index = 0; index < offsets.length; ++index) {
            var position = this.ObjectivePointPosition(pPoint, offsets[index]);

            Map.SpriteAdd(SpriteTypes.Hostage, position.x, position.y);
            if(pHasEnemyGuard)
                Map.SpriteAdd(SpriteTypes.Enemy, position.x + 8, position.y);
        }

        this.ReserveObjectiveOffsets(pContext, "objectives", "live_hostage_group", pPoint, offsets, 2);
        return groupPosition;
    };

    pIntegration.NormalizeHostageGroups = function(pGroupSizes) {
        var groups = [];

        if(pGroupSizes instanceof Array) {
            for(var index = 0; index < pGroupSizes.length; ++index)
                groups.push(Math.max(1, Math.floor(pGroupSizes[index] || 1)));
        }
        else {
            groups.push(Math.max(1, Math.floor(pGroupSizes || 1)));
        }

        return groups;
    };

    pIntegration.PlannedObjectivePlacements = function(pContext, pTemplate, pRole) {
        var context = pContext || Session.MapGenContext;
        var matches = [];

        if(!context || !context.Placements || !context.Placements.objectives)
            return matches;

        for(var index = 0; index < context.Placements.objectives.length; ++index) {
            var placement = context.Placements.objectives[index];
            if(pTemplate && placement.template !== pTemplate)
                continue;
            if(pRole && placement.role !== pRole)
                continue;
            if(!placement.point)
                continue;

            matches.push(placement);
        }

        return matches;
    };

    pIntegration.PlannedObjectivePoint = function(pContext, pTemplate, pRole, pIndex) {
        var placements = this.PlannedObjectivePlacements(pContext, pTemplate, pRole);
        var index = Math.max(0, Math.floor(pIndex || 0));
        var placement;

        if(index >= placements.length)
            return null;

        placement = placements[index];
        return { x: placement.point.x, y: placement.point.y };
    };

    pIntegration.FindPlannedObjectivePoint = function(pContext, pTemplate, pRole, pIndex, pOffsets, pAvoidPositions, pAvoidDistance) {
        var point = this.PlannedObjectivePoint(pContext, pTemplate, pRole, pIndex);

        if(!point)
            return null;
        if(!this.ObjectiveSiteClear(pContext, point, pOffsets, pAvoidPositions, pAvoidDistance))
            return null;

        return point;
    };

    pIntegration.PlaceRescueTent = function(pContext, pAvoidPositions) {
        var tentOffsets = this.ObjectiveOffsets(1);
        var minimumDistance = Settings.GetMinimumDistance("hostage", "tent");
        var point = this.FindPlannedObjectivePoint(
            pContext,
            "rescue_tent",
            "rescue_tent",
            0,
            tentOffsets,
            pAvoidPositions,
            minimumDistance
        );

        if(!point)
            point = this.FindObjectivePoint(pContext, "rescue_tent", 0, tentOffsets, pAvoidPositions, minimumDistance);

        if(!point)
            point = this.FindPlannedObjectivePoint(
                pContext,
                "rescue_tent",
                "rescue_tent",
                0,
                tentOffsets,
                pAvoidPositions,
                32
            );

        if(!point)
            point = this.FindObjectivePoint(pContext, "rescue_tent", 0, tentOffsets, pAvoidPositions, 32);

        if(!point && pContext.Anchors && pContext.Anchors.start &&
            this.ObjectiveSiteClear(pContext, pContext.Anchors.start, tentOffsets, pAvoidPositions, 32)) {
            point = { x: pContext.Anchors.start.x, y: pContext.Anchors.start.y };
        }

        if(!point)
            return null;

        Session.RescueTentPosition = this.TileToPosition(point);
        Map.SpriteAdd(SpriteTypes.Hostage_Rescue_Tent, Session.RescueTentPosition.x, Session.RescueTentPosition.y);
        this.ReserveObjectiveOffsets(pContext, "objectives", "live_rescue_tent", point, tentOffsets, 2);

        return Session.RescueTentPosition;
    };

    pIntegration.PlaceCampaignRescueHostages = function(pGroupSizes) {
        var context = Session.MapGenContext;
        var groups = this.NormalizeHostageGroups(pGroupSizes);
        var hostagePlans = [];
        var hostagePositions = [];

        if(!context || !context.Clearings || !context.Clearings.length)
            return false;

        for(var index = 0; index < groups.length; ++index) {
            var offsets = this.ObjectiveOffsets(groups[index]);
            var point = this.FindPlannedObjectivePoint(
                context,
                "hostage_group",
                "hostage",
                index,
                offsets,
                hostagePositions,
                48
            );

            if(!point)
                point = this.FindObjectivePoint(context, "hostage", index, offsets, hostagePositions, 48);

            if(!point)
                continue;

            hostagePlans.push({
                point: point,
                count: groups[index]
            });
            hostagePositions.push(this.TileToPosition(point));
        }

        if(!hostagePlans.length)
            return false;

        if(!this.PlaceRescueTent(context, hostagePositions))
            return false;

        for(var planIndex = 0; planIndex < hostagePlans.length; ++planIndex)
            this.PlaceHostageGroup(context, hostagePlans[planIndex].point, hostagePlans[planIndex].count, true);

        if(hostagePlans.length < groups.length)
            print("MapGen placed " + hostagePlans.length + " of " + groups.length + " hostage groups");

        return true;
    };

    pIntegration.PlaceCampaignCivilianHome = function(pCivilianCount) {
        var context = Session.MapGenContext;
        var count = Math.max(1, Math.floor(pCivilianCount || 1));
        var civilianOffsets = this.ObjectiveOffsets(1);
        var civilianPoints = [];
        var civilianPositions = [];
        var rescueSpec = {
            building: "hut",
            sprite: "civilian_rescue"
        };
        var rescueInfo;
        var clearings;
        var candidate;
        var plannedHomePoint;
        var placedStructures;

        if(!context || !context.Clearings || !context.Clearings.length)
            return false;

        for(var index = 0; index < count; ++index) {
            var point = this.FindPlannedObjectivePoint(
                context,
                "civilian",
                "civilian",
                index,
                civilianOffsets,
                civilianPositions,
                64
            );

            if(!point)
                point = this.FindObjectivePoint(context, "civilian", index, civilianOffsets, civilianPositions, 64);

            if(!point)
                continue;

            civilianPoints.push(point);
            civilianPositions.push(this.TileToPosition(point));
        }

        if(!civilianPositions.length)
            return false;

        var homeEntry = null;
        var entries = context.GameplayPlan ? context.GameplayPlan.entries : [];
        for(var entryIndex = 0; entryIndex < entries.length; ++entryIndex)
            if(entries[entryIndex].purpose === "civilian_home") homeEntry = entries[entryIndex];
        if(homeEntry) candidate = homeEntry.candidate;
        else {
            rescueInfo = this.StructureInfo(rescueSpec);
            if(!rescueInfo)
                return false;

            placedStructures = this.LiveStructurePlacementsAsPlaced ?
                this.LiveStructurePlacementsAsPlaced(context) :
                [];

            plannedHomePoint = this.PlannedObjectivePoint(context, "civilian_home", "civilian_home", 0);
            if(plannedHomePoint) {
                candidate = this.FindStructureSite(
                    context,
                    [{ x: plannedHomePoint.x, y: plannedHomePoint.y, radius: 8, role: "support" }],
                    0,
                    rescueSpec,
                    rescueInfo,
                    0,
                    0,
                    placedStructures,
                    civilianPositions,
                    Settings.GetMinimumDistance("civilian", "rescue")
                );
            }

            clearings = this.ObjectiveClearings(context, "civilian_home");
            if(!candidate)
                candidate = this.FindStructureSite(
                    context,
                    clearings,
                    0,
                    rescueSpec,
                    rescueInfo,
                    0,
                    0,
                    placedStructures,
                    civilianPositions,
                    Settings.GetMinimumDistance("civilian", "rescue")
                );

            if(!candidate) {
                candidate = this.FindStructureSite(
                    context,
                    clearings,
                    0,
                    rescueSpec,
                    rescueInfo,
                    0,
                    0,
                    placedStructures,
                    civilianPositions,
                    32
                );
            }

            if(!candidate)
                return false;

            this.PrepareStructureSite(context, rescueSpec, candidate);
            this.ApplyPreparedStructureTerrain(context);

        }

        for(var civilianIndex = 0; civilianIndex < civilianPoints.length; ++civilianIndex) {
            var civilianPosition = civilianPositions[civilianIndex];

            Session.CivilianPositions.push(civilianPosition);
            Map.SpriteAdd(SpriteTypes.Civilian_Spear, civilianPosition.x, civilianPosition.y);
            this.ReserveObjectiveOffsets(context, "objectives", "live_civilian_home_actor", civilianPoints[civilianIndex], civilianOffsets, 2);
        }

        if(homeEntry) {
            if(!this.CommitPlannedStructure(context, homeEntry)) return false;
            Session.CivilianHomePosition = this.TileToPosition(candidate.accessPoint);
            return true;
        }

        if(this.PlaceStructureSpec(rescueSpec, candidate.tileX, candidate.tileY)) {
            this.ReserveStructureSite(context, rescueSpec, candidate);
            this.ApplyStructureContextCover(context, rescueSpec, candidate);
            this.RecordLiveStructurePlacement(context, rescueSpec, candidate, "civilian_home");
            Session.CivilianHomePosition = this.TileToPosition(candidate.accessPoint || {
                x: candidate.tileX, y: candidate.tileY
            });
            this.ApplyPreparedStructureTerrain(context);
            return true;
        }

        return false;
    };
})(MapGen.Integration);
