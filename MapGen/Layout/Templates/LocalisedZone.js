(function() {

    function pickZone(pContext) {
        var random = pContext.Random;
        var widthFraction = random.Float(0.32, 0.58);
        var heightFraction = random.Float(0.32, 0.58);
        var zoneWidth = Math.max(14, Math.floor(pContext.Width * widthFraction));
        var zoneHeight = Math.max(12, Math.floor(pContext.Height * heightFraction));

        if(zoneWidth >= pContext.Width - 6)
            zoneWidth = pContext.Width - 6;
        if(zoneHeight >= pContext.Height - 6)
            zoneHeight = pContext.Height - 6;

        var marginX = 3;
        var marginY = 3;
        var maxX = (pContext.Width - marginX) - zoneWidth;
        var maxY = (pContext.Height - marginY) - zoneHeight;
        var x0 = random.Int(marginX, Math.max(marginX, maxX));
        var y0 = random.Int(marginY, Math.max(marginY, maxY));

        return {
            x0: x0,
            y0: y0,
            x1: x0 + zoneWidth - 1,
            y1: y0 + zoneHeight - 1,
            width: zoneWidth,
            height: zoneHeight
        };
    }

    function makePoint(pContext, pX, pY, pRole) {
        return MapGen.Layout.Anchors.MakePoint(pContext, pX, pY, pRole);
    }

    function buildCampaignAnchors(pContext) {
        var zone = pickZone(pContext);
        var random = pContext.Random;
        var startEdgeX = random.Int(zone.x0 + 1, zone.x0 + Math.max(1, Math.floor(zone.width * 0.30)));
        var objectiveEdgeX = random.Int(zone.x1 - Math.max(1, Math.floor(zone.width * 0.30)), zone.x1 - 1);
        var bandTop = zone.y0 + 1;
        var bandBottom = zone.y1 - 1;
        var midBandTop = Math.max(bandTop, zone.y0 + Math.floor(zone.height * 0.35));
        var midBandBottom = Math.min(bandBottom, zone.y0 + Math.floor(zone.height * 0.65));

        var start = makePoint(
            pContext,
            startEdgeX,
            random.Int(bandTop, bandBottom),
            "start"
        );
        var objective = makePoint(
            pContext,
            objectiveEdgeX,
            random.Int(bandTop, bandBottom),
            "objective"
        );
        var support = makePoint(
            pContext,
            random.Int(zone.x0 + Math.floor(zone.width * 0.30), zone.x1 - Math.floor(zone.width * 0.30)),
            random.Int(midBandTop, midBandBottom),
            "support"
        );

        pContext.Anchors = {
            start: start,
            objective: objective,
            support: support
        };
        pContext.CriticalPoints = [];
        pContext.Regions.push({ name: "player_start", point: start });
        pContext.Regions.push({ name: "objective", point: objective });
        pContext.Regions.push({ name: "support", point: support });
        pContext.Regions.push({
            name: "localised_zone",
            point: makePoint(pContext, Math.floor((zone.x0 + zone.x1) * 0.5), Math.floor((zone.y0 + zone.y1) * 0.5), "zone_centre")
        });
        pContext.Zone = zone;

        MapGen.Layout.Anchors.Orient(pContext);
    }

    function buildMultiplayerAnchors(pContext) {
        var zone = pickZone(pContext);
        var random = pContext.Random;
        var teamA = makePoint(
            pContext,
            random.Int(zone.x0 + 1, zone.x0 + Math.max(1, Math.floor(zone.width * 0.25))),
            random.Int(zone.y0 + 1, zone.y1 - 1),
            "team_a"
        );
        var teamB = makePoint(
            pContext,
            random.Int(zone.x1 - Math.max(1, Math.floor(zone.width * 0.25)), zone.x1 - 1),
            random.Int(zone.y0 + 1, zone.y1 - 1),
            "team_b"
        );
        var contested = makePoint(
            pContext,
            Math.floor((zone.x0 + zone.x1) * 0.5),
            Math.floor((zone.y0 + zone.y1) * 0.5),
            "contested"
        );

        pContext.Anchors = {
            teamA: teamA,
            teamB: teamB,
            contested: contested
        };
        pContext.CriticalPoints = [];
        pContext.Regions.push({ name: "team_a_spawn", point: teamA });
        pContext.Regions.push({ name: "team_b_spawn", point: teamB });
        pContext.Regions.push({ name: "contested", point: contested });
        pContext.Regions.push({
            name: "localised_zone",
            point: makePoint(pContext, contested.x, contested.y, "zone_centre")
        });
        pContext.Zone = zone;

        MapGen.Layout.Anchors.Orient(pContext);
    }

    function clearingComposition(pContext, pClearings) {
        var desired = pClearings.DesiredPathClearingCount(pContext);
        if(!desired || !pContext.Paths.length)
            return;
        for(var index = 0; index < desired; ++index) {
            var fraction = (index + 1) / (desired + 1);
            var role;
            if(fraction > 0.30 && fraction < 0.70)
                role = (index % 2) ? "village" : "route_clearing";
            else
                role = (index % 2) ? "ambush_pocket" : "route_rest";
            pClearings.PlaceOnPath(pContext, 0, fraction, role, index % 2 ? 1 : -1, role !== "village" && role !== "route_rest");
        }
    }

    var template = {
        Name: "localised_zone",

        ClearingComposition: clearingComposition,

        BuildAnchorsCampaign: buildCampaignAnchors,

        BuildAnchorsMultiplayer: buildMultiplayerAnchors
    };

    MapGen.Layout.Templates.Register(template);
})();
