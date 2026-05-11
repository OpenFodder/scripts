var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};
MapGen.Layout.Templates = MapGen.Layout.Templates || {};

(function() {

    function makePoint(pContext, pX, pY, pRole) {
        return MapGen.Layout.Anchors.MakePoint(pContext, pX, pY, pRole);
    }

    function pushAnchorRegions(pContext, pNames) {
        for(var index = 0; index < pNames.length; ++index) {
            var entry = pNames[index];
            pContext.Regions.push({ name: entry.name, point: entry.point });
        }
    }

    function finalise(pContext) {
        MapGen.Layout.Anchors.Orient(pContext);
    }

    function placeCampaign(pContext, pStart, pObjective, pSupport) {
        pContext.Anchors = { start: pStart, objective: pObjective, support: pSupport };
        pContext.CriticalPoints = [];
        pushAnchorRegions(pContext, [
            { name: "player_start", point: pStart },
            { name: "objective", point: pObjective },
            { name: "support", point: pSupport }
        ]);
        finalise(pContext);
    }

    function placeMultiplayer(pContext, pTeamA, pTeamB, pContested) {
        pContext.Anchors = { teamA: pTeamA, teamB: pTeamB, contested: pContested };
        pContext.CriticalPoints = [];
        pushAnchorRegions(pContext, [
            { name: "team_a_spawn", point: pTeamA },
            { name: "team_b_spawn", point: pTeamB },
            { name: "contested", point: pContested }
        ]);
        finalise(pContext);
    }

    function clamp(pValue, pMin, pMax) {
        if(pValue < pMin) return pMin;
        if(pValue > pMax) return pMax;
        return pValue;
    }

    function jitter(pRandom, pCenter, pRadius) {
        return pCenter + pRandom.Int(-pRadius, pRadius);
    }

    // -- corner_to_corner ---------------------------------------------------
    MapGen.Layout.Templates.Register({
        Name: "corner_to_corner",

        BuildAnchorsCampaign: function(pContext) {
            var random = pContext.Random;
            var marginX = Math.max(4, Math.floor(pContext.Width * 0.10));
            var marginY = Math.max(4, Math.floor(pContext.Height * 0.10));
            var topStart = random.Chance(0.5);
            var startY = topStart ? marginY : pContext.Height - 1 - marginY;
            var objectiveY = topStart ? pContext.Height - 1 - marginY : marginY;
            var start = makePoint(pContext, jitter(random, marginX, 2), jitter(random, startY, 2), "start");
            var objective = makePoint(pContext, jitter(random, pContext.Width - 1 - marginX, 2), jitter(random, objectiveY, 2), "objective");
            var support = makePoint(
                pContext,
                Math.floor(pContext.Width * 0.5) + random.Int(-3, 3),
                Math.floor(pContext.Height * 0.5) + random.Int(-3, 3),
                "support"
            );
            placeCampaign(pContext, start, objective, support);
        },

        BuildAnchorsMultiplayer: function(pContext) {
            var random = pContext.Random;
            var marginX = Math.max(5, Math.floor(pContext.Width * 0.12));
            var marginY = Math.max(5, Math.floor(pContext.Height * 0.12));
            var topA = random.Chance(0.5);
            var teamA = makePoint(pContext, marginX, topA ? marginY : pContext.Height - 1 - marginY, "team_a");
            var teamB = makePoint(pContext, pContext.Width - 1 - marginX, topA ? pContext.Height - 1 - marginY : marginY, "team_b");
            var contested = makePoint(pContext, Math.floor(pContext.Width * 0.5), Math.floor(pContext.Height * 0.5), "contested");
            placeMultiplayer(pContext, teamA, teamB, contested);
        }
    });

    function siegeClearingComposition(pContext, pClearings) {
        var desired = pClearings.DesiredPathClearingCount(pContext);
        if(!desired || !pContext.Paths.length)
            return;
        for(var index = 0; index < desired; ++index) {
            var fraction = (index + 1) / (desired + 1);
            var role;
            if(fraction > 0.55) role = "ambush_pocket";
            else if(fraction > 0.30) role = "flank";
            else role = "route_rest";
            pClearings.PlaceOnPath(pContext, 0, fraction, role, index % 2 ? 1 : -1, role !== "route_rest");
        }
    }

    // -- siege --------------------------------------------------------------
    MapGen.Layout.Templates.Register({
        Name: "siege",
        ClearingComposition: siegeClearingComposition,

        BuildAnchorsCampaign: function(pContext) {
            var random = pContext.Random;
            var centerX = Math.floor(pContext.Width * 0.5);
            var centerY = Math.floor(pContext.Height * 0.5);
            var objective = makePoint(pContext, jitter(random, centerX, 2), jitter(random, centerY, 2), "objective");
            var side = random.Int(0, 3);
            var marginX = Math.max(3, Math.floor(pContext.Width * 0.08));
            var marginY = Math.max(3, Math.floor(pContext.Height * 0.08));
            var startX, startY;
            if(side === 0) { startX = marginX; startY = jitter(random, centerY, 4); }
            else if(side === 1) { startX = pContext.Width - 1 - marginX; startY = jitter(random, centerY, 4); }
            else if(side === 2) { startX = jitter(random, centerX, 4); startY = marginY; }
            else { startX = jitter(random, centerX, 4); startY = pContext.Height - 1 - marginY; }
            var start = makePoint(pContext, startX, startY, "start");
            var dx = (centerX === startX) ? 1 : (centerX > startX ? 1 : -1);
            var dy = (centerY === startY) ? 1 : (centerY > startY ? 1 : -1);
            var support = makePoint(
                pContext,
                clamp(startX + dx * Math.floor(pContext.Width * 0.18), 1, pContext.Width - 2),
                clamp(startY + dy * Math.floor(pContext.Height * 0.18), 1, pContext.Height - 2),
                "support"
            );
            placeCampaign(pContext, start, objective, support);
            pContext.Regions.push({
                name: "siege_inner",
                point: makePoint(pContext, objective.x, objective.y, "siege_inner"),
                radius: Math.max(4, Math.floor(Math.min(pContext.Width, pContext.Height) * 0.12))
            });
            pContext.DefensiveLineSpec = {
                Count: 1,
                Fraction: [0.55, 0.72],
                Thickness: [2, 4],
                AxisCoverage: [0.55, 0.85]
            };
        },

        BuildAnchorsMultiplayer: function(pContext) {
            var random = pContext.Random;
            var centerX = Math.floor(pContext.Width * 0.5);
            var centerY = Math.floor(pContext.Height * 0.5);
            var horizontal = random.Chance(0.5);
            var marginX = Math.max(5, Math.floor(pContext.Width * 0.10));
            var marginY = Math.max(5, Math.floor(pContext.Height * 0.10));
            var teamA, teamB;
            if(horizontal) {
                teamA = makePoint(pContext, marginX, jitter(random, centerY, 3), "team_a");
                teamB = makePoint(pContext, pContext.Width - 1 - marginX, jitter(random, centerY, 3), "team_b");
            }
            else {
                teamA = makePoint(pContext, jitter(random, centerX, 3), marginY, "team_a");
                teamB = makePoint(pContext, jitter(random, centerX, 3), pContext.Height - 1 - marginY, "team_b");
            }
            var contested = makePoint(pContext, centerX, centerY, "contested");
            placeMultiplayer(pContext, teamA, teamB, contested);
            pContext.Regions.push({
                name: "siege_inner",
                point: makePoint(pContext, contested.x, contested.y, "siege_inner"),
                radius: Math.max(4, Math.floor(Math.min(pContext.Width, pContext.Height) * 0.12))
            });
            pContext.DefensiveLineSpec = {
                Count: 2,
                Fraction: [0.30, 0.70],
                Thickness: [2, 3],
                AxisCoverage: [0.50, 0.75]
            };
        }
    });

    // -- peninsula ----------------------------------------------------------
    MapGen.Layout.Templates.Register({
        Name: "peninsula",

        BuildAnchorsCampaign: function(pContext) {
            var random = pContext.Random;
            var horizontal = random.Chance(0.5);
            var bandWidth = horizontal ? Math.floor(pContext.Height * 0.55) : Math.floor(pContext.Width * 0.55);
            var marginCross = 3;
            var bandStart = random.Chance(0.5) ? marginCross : (horizontal ? pContext.Height - bandWidth - marginCross : pContext.Width - bandWidth - marginCross);
            var marginLong = Math.max(4, Math.floor((horizontal ? pContext.Width : pContext.Height) * 0.10));
            var start, objective, support;
            if(horizontal) {
                start = makePoint(pContext, marginLong, jitter(random, bandStart + Math.floor(bandWidth * 0.5), 2), "start");
                objective = makePoint(pContext, pContext.Width - 1 - marginLong, jitter(random, bandStart + Math.floor(bandWidth * 0.5), 2), "objective");
                support = makePoint(pContext, Math.floor(pContext.Width * 0.5), bandStart + Math.floor(bandWidth * (random.Chance(0.5) ? 0.25 : 0.75)), "support");
            }
            else {
                start = makePoint(pContext, jitter(random, bandStart + Math.floor(bandWidth * 0.5), 2), marginLong, "start");
                objective = makePoint(pContext, jitter(random, bandStart + Math.floor(bandWidth * 0.5), 2), pContext.Height - 1 - marginLong, "objective");
                support = makePoint(pContext, bandStart + Math.floor(bandWidth * (random.Chance(0.5) ? 0.25 : 0.75)), Math.floor(pContext.Height * 0.5), "support");
            }
            pContext.Peninsula = { horizontal: horizontal, bandStart: bandStart, bandWidth: bandWidth };
            placeCampaign(pContext, start, objective, support);
        },

        BuildAnchorsMultiplayer: function(pContext) {
            var random = pContext.Random;
            var horizontal = random.Chance(0.5);
            var bandWidth = horizontal ? Math.floor(pContext.Height * 0.55) : Math.floor(pContext.Width * 0.55);
            var bandStart = random.Chance(0.5) ? 3 : (horizontal ? pContext.Height - bandWidth - 3 : pContext.Width - bandWidth - 3);
            var marginLong = Math.max(5, Math.floor((horizontal ? pContext.Width : pContext.Height) * 0.10));
            var teamA, teamB, contested;
            if(horizontal) {
                teamA = makePoint(pContext, marginLong, bandStart + Math.floor(bandWidth * 0.5), "team_a");
                teamB = makePoint(pContext, pContext.Width - 1 - marginLong, bandStart + Math.floor(bandWidth * 0.5), "team_b");
                contested = makePoint(pContext, Math.floor(pContext.Width * 0.5), bandStart + Math.floor(bandWidth * 0.5), "contested");
            }
            else {
                teamA = makePoint(pContext, bandStart + Math.floor(bandWidth * 0.5), marginLong, "team_a");
                teamB = makePoint(pContext, bandStart + Math.floor(bandWidth * 0.5), pContext.Height - 1 - marginLong, "team_b");
                contested = makePoint(pContext, bandStart + Math.floor(bandWidth * 0.5), Math.floor(pContext.Height * 0.5), "contested");
            }
            pContext.Peninsula = { horizontal: horizontal, bandStart: bandStart, bandWidth: bandWidth };
            placeMultiplayer(pContext, teamA, teamB, contested);
        }
    });

    function crossroadsClearingComposition(pContext, pClearings) {
        var desired = pClearings.DesiredPathClearingCount(pContext);
        if(!desired || !pContext.Paths.length)
            return;
        var hubRole = "village";
        var hubPlaced = false;
        for(var index = 0; index < desired; ++index) {
            var fraction = (index + 1) / (desired + 1);
            if(!hubPlaced && fraction >= 0.40 && fraction <= 0.60) {
                pClearings.PlaceOnPath(pContext, 0, fraction, hubRole, 0, false);
                hubPlaced = true;
                continue;
            }
            var role = (index % 2) ? "ambush_pocket" : "route_clearing";
            pClearings.PlaceOnPath(pContext, 0, fraction, role, index % 2 ? 1 : -1, role === "ambush_pocket");
        }
    }

    // -- crossroads ---------------------------------------------------------
    MapGen.Layout.Templates.Register({
        Name: "crossroads",
        ClearingComposition: crossroadsClearingComposition,

        BuildAnchorsCampaign: function(pContext) {
            var random = pContext.Random;
            var marginX = Math.max(4, Math.floor(pContext.Width * 0.10));
            var marginY = Math.max(4, Math.floor(pContext.Height * 0.10));
            var sides = [
                { x: marginX, y: jitter(random, Math.floor(pContext.Height * 0.5), 4) },
                { x: pContext.Width - 1 - marginX, y: jitter(random, Math.floor(pContext.Height * 0.5), 4) },
                { x: jitter(random, Math.floor(pContext.Width * 0.5), 4), y: marginY },
                { x: jitter(random, Math.floor(pContext.Width * 0.5), 4), y: pContext.Height - 1 - marginY }
            ];
            var startIndex = random.Int(0, 3);
            var objectiveIndex = (startIndex + 1 + random.Int(0, 2)) % 4;
            var start = makePoint(pContext, sides[startIndex].x, sides[startIndex].y, "start");
            var objective = makePoint(pContext, sides[objectiveIndex].x, sides[objectiveIndex].y, "objective");
            var support = makePoint(pContext, Math.floor(pContext.Width * 0.5), Math.floor(pContext.Height * 0.5), "support");
            placeCampaign(pContext, start, objective, support);
            pContext.Regions.push({ name: "crossroads_hub", point: support });
        },

        BuildAnchorsMultiplayer: function(pContext) {
            var random = pContext.Random;
            var marginX = Math.max(5, Math.floor(pContext.Width * 0.12));
            var marginY = Math.max(5, Math.floor(pContext.Height * 0.12));
            var horizontal = random.Chance(0.5);
            var teamA, teamB;
            if(horizontal) {
                teamA = makePoint(pContext, marginX, Math.floor(pContext.Height * 0.5), "team_a");
                teamB = makePoint(pContext, pContext.Width - 1 - marginX, Math.floor(pContext.Height * 0.5), "team_b");
            }
            else {
                teamA = makePoint(pContext, Math.floor(pContext.Width * 0.5), marginY, "team_a");
                teamB = makePoint(pContext, Math.floor(pContext.Width * 0.5), pContext.Height - 1 - marginY, "team_b");
            }
            var contested = makePoint(pContext, Math.floor(pContext.Width * 0.5), Math.floor(pContext.Height * 0.5), "contested");
            placeMultiplayer(pContext, teamA, teamB, contested);
            pContext.Regions.push({ name: "crossroads_hub", point: contested });
        }
    });

    function valleyClearingComposition(pContext, pClearings) {
        var desired = pClearings.DesiredPathClearingCount(pContext);
        if(!desired || !pContext.Paths.length)
            return;
        var roles = ["route_rest", "flank", "route_clearing", "route_rest", "ambush_pocket"];
        for(var index = 0; index < desired; ++index) {
            var fraction = (index + 1) / (desired + 1);
            var role = roles[index % roles.length];
            pClearings.PlaceOnPath(pContext, 0, fraction, role, index % 2 ? 1 : -1, role === "flank" || role === "ambush_pocket");
        }
    }

    // -- valley -------------------------------------------------------------
    MapGen.Layout.Templates.Register({
        Name: "valley",
        ClearingComposition: valleyClearingComposition,

        BuildAnchorsCampaign: function(pContext) {
            var random = pContext.Random;
            var horizontal = random.Chance(0.5);
            var crossCenter = horizontal ? Math.floor(pContext.Height * 0.5) : Math.floor(pContext.Width * 0.5);
            var crossDrift = Math.max(2, Math.floor((horizontal ? pContext.Height : pContext.Width) * 0.06));
            var marginLong = Math.max(4, Math.floor((horizontal ? pContext.Width : pContext.Height) * 0.10));
            var start, objective, support;
            if(horizontal) {
                start = makePoint(pContext, marginLong, jitter(random, crossCenter, crossDrift), "start");
                objective = makePoint(pContext, pContext.Width - 1 - marginLong, jitter(random, crossCenter, crossDrift), "objective");
                support = makePoint(pContext, Math.floor(pContext.Width * 0.5), jitter(random, crossCenter, crossDrift), "support");
            }
            else {
                start = makePoint(pContext, jitter(random, crossCenter, crossDrift), marginLong, "start");
                objective = makePoint(pContext, jitter(random, crossCenter, crossDrift), pContext.Height - 1 - marginLong, "objective");
                support = makePoint(pContext, jitter(random, crossCenter, crossDrift), Math.floor(pContext.Height * 0.5), "support");
            }
            pContext.Valley = { horizontal: horizontal, axis: crossCenter };
            placeCampaign(pContext, start, objective, support);
        },

        BuildAnchorsMultiplayer: function(pContext) {
            var random = pContext.Random;
            var horizontal = random.Chance(0.5);
            var crossCenter = horizontal ? Math.floor(pContext.Height * 0.5) : Math.floor(pContext.Width * 0.5);
            var marginLong = Math.max(5, Math.floor((horizontal ? pContext.Width : pContext.Height) * 0.10));
            var teamA, teamB, contested;
            if(horizontal) {
                teamA = makePoint(pContext, marginLong, crossCenter, "team_a");
                teamB = makePoint(pContext, pContext.Width - 1 - marginLong, crossCenter, "team_b");
                contested = makePoint(pContext, Math.floor(pContext.Width * 0.5), crossCenter, "contested");
            }
            else {
                teamA = makePoint(pContext, crossCenter, marginLong, "team_a");
                teamB = makePoint(pContext, crossCenter, pContext.Height - 1 - marginLong, "team_b");
                contested = makePoint(pContext, crossCenter, Math.floor(pContext.Height * 0.5), "contested");
            }
            pContext.Valley = { horizontal: horizontal, axis: crossCenter };
            placeMultiplayer(pContext, teamA, teamB, contested);
        }
    });

    function linearGauntletClearingComposition(pContext, pClearings) {
        var desired = pClearings.DesiredPathClearingCount(pContext);
        if(!desired || !pContext.Paths.length)
            return;
        for(var index = 0; index < desired; ++index) {
            var fraction = (index + 1) / (desired + 1);
            var role = (index % 3 === 0) ? "route_clearing" : "ambush_pocket";
            pClearings.PlaceOnPath(pContext, 0, fraction, role, index % 2 ? 1 : -1, role === "ambush_pocket");
        }
    }

    // -- linear_gauntlet ----------------------------------------------------
    MapGen.Layout.Templates.Register({
        Name: "linear_gauntlet",
        ClearingComposition: linearGauntletClearingComposition,

        BuildAnchorsCampaign: function(pContext) {
            var random = pContext.Random;
            var linearProfile = pContext.Profile || {};
            var forcedAxis = String(linearProfile.LinearGauntletAxis || "").toLowerCase();
            var horizontal = forcedAxis === "horizontal" ? true :
                (forcedAxis === "vertical" ? false : random.Chance(0.6));
            var crossCenter = horizontal ? Math.floor(pContext.Height * 0.5) : Math.floor(pContext.Width * 0.5);
            var marginLong = Math.max(4, Math.floor((horizontal ? pContext.Width : pContext.Height) * 0.08));
            var driftValue = linearProfile.LinearGauntletLateralDrift || 0;
            if(driftValue instanceof Array)
                driftValue = random.Float(Number(driftValue[0] || 0), Number(driftValue[1] || 0));
            driftValue = Math.max(0, Math.min(0.32, Number(driftValue) || 0));
            var drift = Math.floor((horizontal ? pContext.Height : pContext.Width) * driftValue);
            var driftSign = random.Chance(0.5) ? 1 : -1;
            var start, objective, support;
            if(horizontal) {
                start = makePoint(pContext, marginLong, crossCenter - (drift * driftSign), "start");
                objective = makePoint(pContext, pContext.Width - 1 - marginLong, crossCenter + (drift * driftSign), "objective");
                support = makePoint(pContext, Math.floor(pContext.Width * 0.5), crossCenter, "support");
            }
            else {
                start = makePoint(pContext, crossCenter - (drift * driftSign), marginLong, "start");
                objective = makePoint(pContext, crossCenter + (drift * driftSign), pContext.Height - 1 - marginLong, "objective");
                support = makePoint(pContext, crossCenter, Math.floor(pContext.Height * 0.5), "support");
            }
            placeCampaign(pContext, start, objective, support);
            var checkpointCount = random.Int(1, 2);
            for(var index = 0; index < checkpointCount; ++index) {
                var fraction = (index + 1) / (checkpointCount + 2);
                var x = horizontal ? Math.floor(pContext.Width * fraction) : crossCenter;
                var y = horizontal ? crossCenter : Math.floor(pContext.Height * fraction);
                pContext.Regions.push({ name: "checkpoint_" + (index + 1), point: makePoint(pContext, x, y, "checkpoint") });
            }
            pContext.DefensiveLineSpec = {
                Count: checkpointCount,
                Fraction: [0.25, 0.75],
                Thickness: [2, 3],
                AxisCoverage: [0.45, 0.70]
            };
        },

        BuildAnchorsMultiplayer: function(pContext) {
            var random = pContext.Random;
            var linearProfile = pContext.Profile || {};
            var forcedAxis = String(linearProfile.LinearGauntletAxis || "").toLowerCase();
            var horizontal = forcedAxis === "horizontal" ? true :
                (forcedAxis === "vertical" ? false : random.Chance(0.6));
            var crossCenter = horizontal ? Math.floor(pContext.Height * 0.5) : Math.floor(pContext.Width * 0.5);
            var marginLong = Math.max(5, Math.floor((horizontal ? pContext.Width : pContext.Height) * 0.10));
            var driftValue = linearProfile.LinearGauntletLateralDrift || 0;
            if(driftValue instanceof Array)
                driftValue = random.Float(Number(driftValue[0] || 0), Number(driftValue[1] || 0));
            driftValue = Math.max(0, Math.min(0.32, Number(driftValue) || 0));
            var drift = Math.floor((horizontal ? pContext.Height : pContext.Width) * driftValue);
            var driftSign = random.Chance(0.5) ? 1 : -1;
            var teamA, teamB, contested;
            if(horizontal) {
                teamA = makePoint(pContext, marginLong, crossCenter - (drift * driftSign), "team_a");
                teamB = makePoint(pContext, pContext.Width - 1 - marginLong, crossCenter + (drift * driftSign), "team_b");
                contested = makePoint(pContext, Math.floor(pContext.Width * 0.5), crossCenter, "contested");
            }
            else {
                teamA = makePoint(pContext, crossCenter - (drift * driftSign), marginLong, "team_a");
                teamB = makePoint(pContext, crossCenter + (drift * driftSign), pContext.Height - 1 - marginLong, "team_b");
                contested = makePoint(pContext, crossCenter, Math.floor(pContext.Height * 0.5), "contested");
            }
            placeMultiplayer(pContext, teamA, teamB, contested);
            pContext.DefensiveLineSpec = {
                Count: 2,
                Fraction: [0.25, 0.75],
                Thickness: [2, 3],
                AxisCoverage: [0.45, 0.70]
            };
        }
    });

    function hubAndSpokeClearingComposition(pContext, pClearings) {
        var desired = pClearings.DesiredPathClearingCount(pContext);
        if(!desired || !pContext.Paths.length)
            return;
        var hubPlaced = false;
        for(var index = 0; index < desired; ++index) {
            var fraction = (index + 1) / (desired + 1);
            if(!hubPlaced && fraction >= 0.40 && fraction <= 0.60) {
                pClearings.PlaceOnPath(pContext, 0, fraction, "village", 0, false);
                hubPlaced = true;
                continue;
            }
            var role = (index % 2) ? "ambush_pocket" : "route_rest";
            pClearings.PlaceOnPath(pContext, 0, fraction, role, index % 2 ? 1 : -1, role === "ambush_pocket");
        }
    }

    // -- hub_and_spoke ------------------------------------------------------
    MapGen.Layout.Templates.Register({
        Name: "hub_and_spoke",
        ClearingComposition: hubAndSpokeClearingComposition,

        BuildAnchorsCampaign: function(pContext) {
            var random = pContext.Random;
            var hubX = jitter(random, Math.floor(pContext.Width * 0.5), Math.max(2, Math.floor(pContext.Width * 0.05)));
            var hubY = jitter(random, Math.floor(pContext.Height * 0.5), Math.max(2, Math.floor(pContext.Height * 0.05)));
            var hubRadiusX = Math.floor(pContext.Width * 0.35);
            var hubRadiusY = Math.floor(pContext.Height * 0.35);
            var startAngle = random.Float(0, Math.PI * 2);
            var spokeCount = 4;
            var spokeOffsets = [];
            for(var index = 0; index < spokeCount; ++index)
                spokeOffsets.push(startAngle + index * (Math.PI * 2 / spokeCount));
            var pickIndex = random.Int(0, spokeCount - 1);
            var objectiveIndex = (pickIndex + 2) % spokeCount;
            var supportIndex = (pickIndex + 1 + random.Int(0, 1)) % spokeCount;
            function spokePoint(pAngle, pRole) {
                var x = clamp(Math.floor(hubX + Math.cos(pAngle) * hubRadiusX), 2, pContext.Width - 3);
                var y = clamp(Math.floor(hubY + Math.sin(pAngle) * hubRadiusY), 2, pContext.Height - 3);
                return makePoint(pContext, x, y, pRole);
            }
            var start = spokePoint(spokeOffsets[pickIndex], "start");
            var objective = spokePoint(spokeOffsets[objectiveIndex], "objective");
            var support = makePoint(pContext, hubX, hubY, "support");
            placeCampaign(pContext, start, objective, support);
            for(var spoke = 0; spoke < spokeCount; ++spoke) {
                if(spoke === pickIndex || spoke === objectiveIndex || spoke === supportIndex)
                    continue;
                pContext.Regions.push({ name: "spoke_" + spoke, point: spokePoint(spokeOffsets[spoke], "spoke") });
            }
        },

        BuildAnchorsMultiplayer: function(pContext) {
            var random = pContext.Random;
            var hubX = Math.floor(pContext.Width * 0.5);
            var hubY = Math.floor(pContext.Height * 0.5);
            var hubRadiusX = Math.floor(pContext.Width * 0.38);
            var hubRadiusY = Math.floor(pContext.Height * 0.38);
            var angle = random.Float(0, Math.PI * 2);
            function spokePoint(pAngle, pRole) {
                var x = clamp(Math.floor(hubX + Math.cos(pAngle) * hubRadiusX), 2, pContext.Width - 3);
                var y = clamp(Math.floor(hubY + Math.sin(pAngle) * hubRadiusY), 2, pContext.Height - 3);
                return makePoint(pContext, x, y, pRole);
            }
            var teamA = spokePoint(angle, "team_a");
            var teamB = spokePoint(angle + Math.PI, "team_b");
            var contested = makePoint(pContext, hubX, hubY, "contested");
            placeMultiplayer(pContext, teamA, teamB, contested);
            pContext.Regions.push({ name: "spoke_a", point: spokePoint(angle + Math.PI * 0.5, "spoke") });
            pContext.Regions.push({ name: "spoke_b", point: spokePoint(angle - Math.PI * 0.5, "spoke") });
        }
    });

    function parallelLanesClearingComposition(pContext, pClearings) {
        var desired = pClearings.DesiredPathClearingCount(pContext);
        if(!desired || !pContext.Paths.length)
            return;
        var pathCount = pContext.Paths.length;
        for(var index = 0; index < desired; ++index) {
            var fraction = (index + 1) / (desired + 1);
            var pathIndex = pathCount > 1 ? (index % pathCount) : 0;
            var role = (index % 3 === 0) ? "flank" : (index % 3 === 1 ? "ambush_pocket" : "route_clearing");
            var placed = pClearings.PlaceOnPath(pContext, pathIndex, fraction, role, index % 2 ? 1 : -1, role !== "route_clearing");
            if(!placed && pathIndex !== 0)
                pClearings.PlaceOnPath(pContext, 0, fraction, role, index % 2 ? 1 : -1, role !== "route_clearing");
        }
    }

    // -- parallel_lanes -----------------------------------------------------
    MapGen.Layout.Templates.Register({
        Name: "parallel_lanes",
        ClearingComposition: parallelLanesClearingComposition,

        BuildAnchorsCampaign: function(pContext) {
            var random = pContext.Random;
            var horizontal = random.Chance(0.5);
            var laneCount = random.Int(2, 3);
            var marginLong = Math.max(4, Math.floor((horizontal ? pContext.Width : pContext.Height) * 0.08));
            var crossExtent = horizontal ? pContext.Height : pContext.Width;
            var laneCross = [];
            for(var index = 0; index < laneCount; ++index)
                laneCross.push(Math.floor(crossExtent * (index + 1) / (laneCount + 1)));
            var startLane = random.Int(0, laneCount - 1);
            var objectiveLane = laneCount === 2 ? (startLane === 0 ? 1 : 0) : (startLane + 1 + random.Int(0, laneCount - 2)) % laneCount;
            var start, objective, support;
            if(horizontal) {
                start = makePoint(pContext, marginLong, laneCross[startLane], "start");
                objective = makePoint(pContext, pContext.Width - 1 - marginLong, laneCross[objectiveLane], "objective");
                support = makePoint(pContext, Math.floor(pContext.Width * 0.5), laneCross[Math.floor(laneCount / 2)], "support");
            }
            else {
                start = makePoint(pContext, laneCross[startLane], marginLong, "start");
                objective = makePoint(pContext, laneCross[objectiveLane], pContext.Height - 1 - marginLong, "objective");
                support = makePoint(pContext, laneCross[Math.floor(laneCount / 2)], Math.floor(pContext.Height * 0.5), "support");
            }
            placeCampaign(pContext, start, objective, support);
            for(var lane = 0; lane < laneCount; ++lane) {
                var x = horizontal ? Math.floor(pContext.Width * 0.5) : laneCross[lane];
                var y = horizontal ? laneCross[lane] : Math.floor(pContext.Height * 0.5);
                pContext.Regions.push({ name: "lane_" + lane, point: makePoint(pContext, x, y, "lane") });
            }
        },

        BuildAnchorsMultiplayer: function(pContext) {
            var random = pContext.Random;
            var horizontal = random.Chance(0.5);
            var marginLong = Math.max(5, Math.floor((horizontal ? pContext.Width : pContext.Height) * 0.10));
            var crossCenter = horizontal ? Math.floor(pContext.Height * 0.5) : Math.floor(pContext.Width * 0.5);
            var teamA, teamB, contested;
            if(horizontal) {
                teamA = makePoint(pContext, marginLong, crossCenter, "team_a");
                teamB = makePoint(pContext, pContext.Width - 1 - marginLong, crossCenter, "team_b");
                contested = makePoint(pContext, Math.floor(pContext.Width * 0.5), crossCenter, "contested");
                pContext.Regions.push({ name: "lane_top", point: makePoint(pContext, Math.floor(pContext.Width * 0.5), Math.floor(pContext.Height * 0.25), "lane") });
                pContext.Regions.push({ name: "lane_bottom", point: makePoint(pContext, Math.floor(pContext.Width * 0.5), Math.floor(pContext.Height * 0.75), "lane") });
            }
            else {
                teamA = makePoint(pContext, crossCenter, marginLong, "team_a");
                teamB = makePoint(pContext, crossCenter, pContext.Height - 1 - marginLong, "team_b");
                contested = makePoint(pContext, crossCenter, Math.floor(pContext.Height * 0.5), "contested");
                pContext.Regions.push({ name: "lane_left", point: makePoint(pContext, Math.floor(pContext.Width * 0.25), Math.floor(pContext.Height * 0.5), "lane") });
                pContext.Regions.push({ name: "lane_right", point: makePoint(pContext, Math.floor(pContext.Width * 0.75), Math.floor(pContext.Height * 0.5), "lane") });
            }
            placeMultiplayer(pContext, teamA, teamB, contested);
        }
    });

})();
