var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};
MapGen.Layout.Templates = MapGen.Layout.Templates || {};

// First region-intent template (slice 2 of mapgen_quality_ceiling work).
//
// Anchor placement mirrors `siege` (start at a side, objective at centre,
// support between them) so existing behaviour at the spine level is the
// familiar siege shape. The new contribution is BuildRegionIntents: a small
// compound footprint is claimed as STRUCTURE ownership on the owner grid
// BEFORE Skeleton draws the route corridor.
//
// Why STRUCTURE ownership matters here, even with no actual building stamped:
// terrain fill, tree growth, and the route walker all already short-circuit
// on owner === STRUCTURE (JungleCore.js:140, IceCharMap.js:1409,
// RouteArchetypes.js:547). Stamping STRUCTURE on a 5x4 macro region therefore
// forces the rest of the pipeline to compose AROUND it — producing a clean
// negative-space pocket where today's per-cell statistical fill produces
// random tree/water scatter.
//
// The compound size (5x4 tiles, area=20) is calibrated against shipped ice
// maps: see Documentation/RandomMapGenerator_IceFingerprints.json — building
// regions there have p25=2 / p50=2 / p75=2.75 macro cells (block size 4),
// i.e. roughly 32 tiles each, which 5x4=20 sits near the lower end of.
// Conservative on purpose: this is the first slice and over-reservation
// would crowd small maps.
(function() {

    function makePoint(pContext, pX, pY, pRole) {
        return MapGen.Layout.Anchors.MakePoint(pContext, pX, pY, pRole);
    }

    function jitter(pRandom, pCenter, pRadius) {
        return pCenter + pRandom.Int(-pRadius, pRadius);
    }

    function clamp(pValue, pMin, pMax) {
        if(pValue < pMin) return pMin;
        if(pValue > pMax) return pMax;
        return pValue;
    }

    function placeCampaign(pContext, pStart, pObjective, pSupport) {
        pContext.Anchors = { start: pStart, objective: pObjective, support: pSupport };
        pContext.CriticalPoints = [];
        pContext.Regions.push({ name: "player_start", point: pStart });
        pContext.Regions.push({ name: "objective", point: pObjective });
        pContext.Regions.push({ name: "support", point: pSupport });
        MapGen.Layout.Anchors.Orient(pContext);
    }

    function placeMultiplayer(pContext, pTeamA, pTeamB, pContested) {
        pContext.Anchors = { teamA: pTeamA, teamB: pTeamB, contested: pContested };
        pContext.CriticalPoints = [];
        pContext.Regions.push({ name: "team_a_spawn", point: pTeamA });
        pContext.Regions.push({ name: "team_b_spawn", point: pTeamB });
        pContext.Regions.push({ name: "contested", point: pContested });
        MapGen.Layout.Anchors.Orient(pContext);
    }

    // Reserve a rectangular compound footprint as STRUCTURE ownership. Uses a
    // contiguous rect (not a disc) so the negative-space pocket reads as a
    // built site rather than a clearing. ClaimCell respects the priority enum
    // so any cell that an earlier pass somehow already claimed at >= STRUCTURE
    // (e.g. a forced anchor object) is not clobbered.
    //
    // ALSO: claim a TREE perimeter ring around the rect. The live structure
    // validator's MinStructureContextCoverFraction check expects ~12% tree/
    // cliff cover in the annulus around each building. Without the ring the
    // rect sits in plain snow with 0 cover and every corner placement gets
    // rejected before it can place. The tree pass uses ClaimCell which
    // respects priority — ROUTE/CLEARING already claimed by Skeleton/Coast
    // outrank TREE so the ring won't block routes; only OPEN cells become
    // TREE.
    function reserveCompoundFootprint(pContext, pCenter, pHalfWidth, pHalfHeight) {
        if(!pContext.Layers || !pContext.Layers.owner)
            return null;

        var minX = clamp(pCenter.x - pHalfWidth, 1, pContext.Width - 2);
        var maxX = clamp(pCenter.x + pHalfWidth, 1, pContext.Width - 2);
        var minY = clamp(pCenter.y - pHalfHeight, 1, pContext.Height - 2);
        var maxY = clamp(pCenter.y + pHalfHeight, 1, pContext.Height - 2);

        var claimed = 0;
        for(var x = minX; x <= maxX; ++x) {
            for(var y = minY; y <= maxY; ++y) {
                if(MapGen.Layers.ClaimCell(pContext.Layers.owner, x, y, MapGen.Layers.Owner.STRUCTURE))
                    ++claimed;
            }
        }

        // Tree halo ring (3-cell band around the rect). Only OPEN cells get
        // bumped to TREE; any cell already claimed for ROUTE / CLEARING /
        // STRUCTURE / WATER stays — ClaimCell enforces that via the priority
        // enum. The ring gives the live placement validator the cover it
        // needs to accept the corner outposts emitted by CriticalSites.
        var ringOuter = 3;
        var treeClaimed = 0;
        for(var rx = minX - ringOuter; rx <= maxX + ringOuter; ++rx) {
            for(var ry = minY - ringOuter; ry <= maxY + ringOuter; ++ry) {
                if(rx >= minX && rx <= maxX && ry >= minY && ry <= maxY)
                    continue;
                if(MapGen.Layers.ClaimCell(pContext.Layers.owner, rx, ry, MapGen.Layers.Owner.TREE))
                    ++treeClaimed;
            }
        }

        return {
            minX: minX, maxX: maxX,
            minY: minY, maxY: maxY,
            cellsClaimed: claimed,
            treeRingClaimed: treeClaimed
        };
    }

    var template = {
        Name: "ice_compound",

        BuildAnchorsCampaign: function(pContext) {
            var random = pContext.Random;
            var centerX = Math.floor(pContext.Width * 0.5);
            var centerY = Math.floor(pContext.Height * 0.5);
            var marginX = Math.max(3, Math.floor(pContext.Width * 0.08));
            var marginY = Math.max(3, Math.floor(pContext.Height * 0.08));
            var side = random.Int(0, 3);
            var startX, startY;
            if(side === 0)      { startX = marginX;                       startY = jitter(random, centerY, 4); }
            else if(side === 1) { startX = pContext.Width - 1 - marginX;  startY = jitter(random, centerY, 4); }
            else if(side === 2) { startX = jitter(random, centerX, 4);    startY = marginY; }
            else                { startX = jitter(random, centerX, 4);    startY = pContext.Height - 1 - marginY; }
            var start = makePoint(pContext, startX, startY, "start");
            var objective = makePoint(
                pContext,
                jitter(random, centerX, 2),
                jitter(random, centerY, 2),
                "objective"
            );
            // Support sits between start and objective at ~70% from start.
            var supportX = Math.floor(start.x + (objective.x - start.x) * 0.70);
            var supportY = Math.floor(start.y + (objective.y - start.y) * 0.70);
            var support = makePoint(pContext, supportX, supportY, "support");
            placeCampaign(pContext, start, objective, support);
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
        },

        // Region-intent reservation. Runs after Anchors and before Skeleton —
        // see Run/Scripts/MapGen/Layout/RegionIntents.js + Layout/Index.js.
        BuildRegionIntents: function(pContext) {
            // Maps under a minimum size can't afford a 5x4 reserved pocket
            // without crowding the spine; skip the reservation there.
            if(pContext.Width < 30 || pContext.Height < 22)
                return;

            var anchors = pContext.Anchors || {};
            var center = anchors.support || anchors.contested;
            if(!center)
                return;

            // Half-extent: a 5x4 footprint (covers a 11x9 tile rectangle) is
            // about 1 macro cell (block 4) worth of compound — squarely inside
            // the shipped p25..p50 building-region size band. A small random
            // rotation makes the footprint either landscape or portrait so
            // the reservation doesn't visually repeat across seeds.
            var portrait = pContext.Random.Chance(0.40);
            var halfWidth = portrait ? 4 : 5;
            var halfHeight = portrait ? 5 : 4;

            var rect = reserveCompoundFootprint(pContext, center, halfWidth, halfHeight);
            if(!rect)
                return;

            pContext.Regions.push({
                name: "ice_compound_zone",
                point: makePoint(
                    pContext,
                    Math.floor((rect.minX + rect.maxX) * 0.5),
                    Math.floor((rect.minY + rect.maxY) * 0.5),
                    "compound"
                ),
                rect: rect
            });

            // Stash the rect so CriticalSites can plant 1-2 EXTRA structure
            // sites inside it. Reservation alone produced a hole of plain snow
            // tiles (the macro intent reads as "designed clearing", but the
            // pixel-density metric sees it as the opposite of an interesting
            // region). Pairing the reservation with content is the second half
            // of [[mapgen_region_intent_v1]] — see CriticalSites.AddRegionIntentSites.
            pContext.RegionIntents = pContext.RegionIntents || {};
            pContext.RegionIntents.compound = {
                rect: rect,
                center: { x: center.x, y: center.y }
            };

            MapGen.Context.AddLog(
                pContext,
                "ice_compound region intent reserved " + rect.cellsClaimed +
                " STRUCTURE cells around " + center.x + "," + center.y
            );
        }
    };

    MapGen.Layout.Templates.Register(template);
})();
