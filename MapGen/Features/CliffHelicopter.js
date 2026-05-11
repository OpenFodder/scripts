var MapGen = MapGen || {};
MapGen.Features = MapGen.Features || {};

// Cliff-transit helicopter placement (T0.8a).
//
// Jungle cliff stamps are pure barriers; a helicopter on the player-accessible
// side of the cliff band lets the squad fly over. This module:
//   1. Reads pContext.Plateau / pContext.Cliffs to know the band geometry.
//   2. Determines which side of the band the start anchor sits on (= player
//      side).
//   3. Searches for a walkable cell on that side near the cliff for the
//      helicopter pickup, with a small clearance disc.
//   4. Records a placement in pContext.Placements.pickups with kind
//      "helicopter" so Validate.CliffsTraversable can check the plan and the
//      integration pass can materialize a live human helicopter at that point.
//
// OverlayTiles is a stub for now — Structures.Jungle.Helicopter.Variants is
// empty until the helicopter pickup stamp is tagged in TileGroups.json. Once
// authored, OverlayTiles will write Variants[0] into the rendered tile grid
// at the recorded placement point.
MapGen.Features.CliffHelicopter = (function() {

    var CLEARANCE_RADIUS = 1;
    var APPROACH_RADIUS = 2;
    // Distance (in cells) the helicopter must sit clear of the cliff band so
    // it doesn't land flush against the wall art.
    var BAND_BUFFER = 2;

    function biomeName(pTerrainType) {
        return MapGen.Terrain.BiomeStrategy.CliffBiomeName(pTerrainType);
    }

    function helicopterData(pContext) {
        var name = biomeName(pContext.Profile.TerrainType);
        if(!name)
            return null;
        if(!Structures[name] || !Structures[name].Helicopter)
            return null;
        return Structures[name].Helicopter;
    }

    function bumpReject(pContext, pReason) {
        if(!pContext.HelicopterRejectStats)
            pContext.HelicopterRejectStats = {};
        pContext.HelicopterRejectStats[pReason] = (pContext.HelicopterRejectStats[pReason] || 0) + 1;
    }

    function pickPlayerAnchor(pContext) {
        var anchors = pContext.Anchors || {};
        return anchors.start || anchors.teamA || anchors.teamB || anchors.support || null;
    }

    // Returns true when (pX, pY) and the disc of radius pRadius around it is
    // walkable, in-bounds, and free of existing reservations.
    function discIsClear(pContext, pX, pY, pRadius) {
        var layers = pContext.Layers;
        for(var dy = -pRadius; dy <= pRadius; ++dy) {
            for(var dx = -pRadius; dx <= pRadius; ++dx) {
                var x = pX + dx;
                var y = pY + dy;
                if(!MapGen.Layers.InBounds(layers.occupied, x, y))
                    return false;
                if(MapGen.Layers.Get(layers.occupied, x, y, 0))
                    return false;
                if(MapGen.Layers.Get(layers.water, x, y, 0))
                    return false;
                if(MapGen.Layers.Get(layers.riverBank, x, y, 0))
                    return false;
                if(MapGen.Layers.Get(layers.blocked, x, y, 0))
                    return false;
                if(!MapGen.Metrics.IsWalkable(pContext, x, y))
                    return false;
            }
        }
        return true;
    }

    // Walk outward from the anchor in expanding rings on the same side of
    // the cliff band, looking for the first cell whose clearance disc is
    // clear. Returns null if nothing fits.
    function findHelicopterPoint(pContext, pAnchor) {
        var plateau = pContext.Plateau;
        var bandY = plateau.bandY;
        var topRowY = plateau.topRowY;

        var south = pAnchor.y > bandY;
        var minY, maxY;
        if(south) {
            minY = Math.min(pContext.Height - 2, bandY + 1 + BAND_BUFFER);
            maxY = pContext.Height - 2;
        } else {
            minY = 1;
            maxY = Math.max(1, topRowY - 1 - BAND_BUFFER);
        }

        if(maxY < minY)
            return null;

        var maxRadius = Math.max(pContext.Width, pContext.Height);

        for(var radius = 0; radius <= maxRadius; ++radius) {
            for(var dy = -radius; dy <= radius; ++dy) {
                for(var dx = -radius; dx <= radius; ++dx) {
                    if(Math.abs(dx) !== radius && Math.abs(dy) !== radius)
                        continue;

                    var x = pAnchor.x + dx;
                    var y = pAnchor.y + dy;

                    if(y < minY || y > maxY)
                        continue;
                    if(x < CLEARANCE_RADIUS + 1 || x > pContext.Width - CLEARANCE_RADIUS - 2)
                        continue;

                    if(discIsClear(pContext, x, y, CLEARANCE_RADIUS))
                        return { x: x, y: y };
                }
            }
        }

        return null;
    }

    function build(pContext) {
        if(!pContext || !pContext.Profile)
            return pContext;
        if(!pContext.Profile.HelicopterTransit)
            return pContext;
        if(!pContext.Cliffs || !pContext.Cliffs.length)
            return pContext;
        if(!pContext.Plateau || pContext.Plateau.mode !== "terrace")
            return pContext;

        var data = helicopterData(pContext);
        if(!data) {
            MapGen.Context.AddLog(pContext, "CliffHelicopter skipped (no helicopter data for biome)");
            bumpReject(pContext, "noData");
            return pContext;
        }

        var anchor = pickPlayerAnchor(pContext);
        if(!anchor) {
            MapGen.Context.AddLog(pContext, "CliffHelicopter skipped (no spawn anchor)");
            bumpReject(pContext, "noAnchor");
            return pContext;
        }

        var point = findHelicopterPoint(pContext, anchor);
        if(!point) {
            MapGen.Context.AddLog(pContext, "CliffHelicopter skipped (no candidate cell on player side)");
            bumpReject(pContext, "noCandidate");
            return pContext;
        }

        var placement = MapGen.Features.AddPlacement(pContext, "pickups", {
            kind: "helicopter",
            template: "helicopter",
            role: "cliff_transit",
            point: point,
            radius: CLEARANCE_RADIUS,
            approach: APPROACH_RADIUS,
            requireConnected: true,
            structure: "Helicopter"
        });

        pContext.CliffHelicopter = placement;
        MapGen.Context.AddLog(pContext, "CliffHelicopter placed at " + point.x + "," + point.y +
            " (anchor=" + anchor.x + "," + anchor.y + ")");

        return pContext;
    }

    function overlayTiles(pContext, pTiles) {
        if(!pContext || !pTiles)
            return 0;
        var placement = pContext.CliffHelicopter;
        if(!placement || !placement.point)
            return 0;

        var data = helicopterData(pContext);
        if(!data || !data.Variants || !data.Variants.length)
            return 0;

        var variant = data.Variants[0];
        if(!variant || !variant.length)
            return 0;

        var stamped = 0;
        var ox = placement.point.x;
        var oy = placement.point.y;

        for(var index = 0; index < variant.length; ++index) {
            var triplet = variant[index];
            if(MapGen.Layers.Set(pTiles, ox + triplet[0], oy + triplet[1], triplet[2]))
                ++stamped;
        }

        return stamped;
    }

    return {
        Build: build,
        OverlayTiles: overlayTiles
    };
})();
