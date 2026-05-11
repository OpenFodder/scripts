var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

MapGen.Layout.Coast = {

    SupportsCoast: function(pContext) {
        var profile = pContext.Profile;

        if(!profile || !profile.CoastChance)
            return false;
        if(MapGen.Terrain && MapGen.Terrain.TileCatalog) {
            var catalog = MapGen.Terrain.TileCatalog;
            var supportsCoast = catalog.SupportsWaterFeatureForProfile ?
                catalog.SupportsWaterFeatureForProfile(profile, "coasts") :
                catalog.SupportsWaterFeature(profile.TerrainType, "coasts");

            if(!supportsCoast)
                return false;
        }

        return pContext.Random.Chance(profile.CoastChance);
    },

    ResolveWidth: function(pValue, pFallback) {
        var value = Math.floor(Number(pValue));

        if(isNaN(value) || value < 1)
            return pFallback;

        return value;
    },

    ResolveCoverageRange: function(pValue) {
        if(pValue && typeof pValue.length === "number") {
            var min = Number(pValue[0]);
            var max = Number(pValue[1]);

            if(!isNaN(min) && !isNaN(max))
                return [Math.max(0.05, Math.min(1, min)), Math.max(0.05, Math.min(1, max))];
        }

        if(typeof pValue === "number" && !isNaN(pValue)) {
            var value = Math.max(0.05, Math.min(1, pValue));
            return [value, value];
        }

        return null;
    },

    PickCoverage: function(pContext, pRange) {
        if(!pRange)
            return 1;

        var min = Math.min(pRange[0], pRange[1]);
        var max = Math.max(pRange[0], pRange[1]);

        if(max <= min)
            return min;

        return pContext.Random.Float(min, max);
    },

    AxisRange: function(pContext, pSide, pCoverage) {
        if(!pCoverage || pCoverage >= 0.995)
            return null;

        var profile = pContext.Profile || {};
        var margin = Math.max(0, Math.floor(Number(profile.CoastAxisMargin || 3)));
        var axisLength = pSide === "left" || pSide === "right" ? pContext.Height : pContext.Width;
        var span = Math.max(4, Math.floor(axisLength * pCoverage));
        var maxStart = axisLength - span - margin;

        if(maxStart <= margin)
            return null;

        var start = pContext.Random.Int(margin, maxStart);

        return {
            start: start,
            end: start + span,
            coverage: pCoverage
        };
    },

    PickAxisRange: function(pContext, pSide) {
        var range = this.ResolveCoverageRange((pContext.Profile || {}).CoastAxisCoverage);

        if(!range)
            return null;

        return this.AxisRange(pContext, pSide, this.PickCoverage(pContext, range));
    },

    PickSide: function(pContext) {
        var sides = ["left", "right", "top", "bottom"];
        return sides[pContext.Random.Int(0, sides.length - 1)];
    },

    EdgeDistance: function(pContext, pSide, pX, pY) {
        switch(pSide) {
            case "right":
                return pContext.Width - 1 - pX;
            case "top":
                return pY;
            case "bottom":
                return pContext.Height - 1 - pY;
            case "left":
            default:
                return pX;
        }
    },

    AxisPosition: function(pSide, pX, pY) {
        return pSide === "left" || pSide === "right" ? pY : pX;
    },

    // Smooth value-noise sampled along the coast axis. Coarse grid (`pStep`)
    // controls bay/headland frequency; smoothstepped lerp keeps bumps soft.
    NoiseAlong: function(pContext, pAxis, pStep, pSalt) {
        var step = Math.max(1, pStep | 0);
        var gx = Math.floor(pAxis / step);
        var fx = (pAxis - gx * step) / step;
        fx = fx * fx * (3 - 2 * fx);
        var inv = 1 / 0xFFFFFFFF;
        var h0 = MapGen.Random.HashTile(pContext.Seed, gx,     pSalt, 901) * inv;
        var h1 = MapGen.Random.HashTile(pContext.Seed, gx + 1, pSalt, 901) * inv;
        return h0 * (1 - fx) + h1 * fx;
    },

    BayDepthAt: function(pContext, pSide, pAxis, pBaseWidth) {
        var profile = pContext.Profile || {};
        var bayChance = (typeof profile.CoastBayChance === "number") ? profile.CoastBayChance : 0.35;
        if(bayChance <= 0) return 0;

        var bayDepth = (typeof profile.CoastBayDepth === "number") ? profile.CoastBayDepth : pBaseWidth * 4;
        var bayWindow = (typeof profile.CoastBayWindow === "number") ? profile.CoastBayWindow : 11;
        var step = Math.max(8, bayWindow | 0);

        // Cache discovered bay anchors per side so all axis samples agree.
        if(!pContext._coastBays) pContext._coastBays = {};
        var anchors = pContext._coastBays[pSide];
        if(!anchors) {
            anchors = [];
            var axisLen = (pSide === "left" || pSide === "right") ? pContext.Height : pContext.Width;
            for(var probe = step; probe < axisLen - step; probe += step) {
                var roll = MapGen.Random.HashTile(pContext.Seed, probe, pSide.length, 903) / 0xFFFFFFFF;
                if(roll < bayChance) {
                    var depthRoll = MapGen.Random.HashTile(pContext.Seed, probe, pSide.length, 904) / 0xFFFFFFFF;
                    var window = bayWindow + Math.floor(depthRoll * 4);
                    anchors.push({ axis: probe, depth: bayDepth, window: window });
                }
            }
            pContext._coastBays[pSide] = anchors;
        }

        var maxBoost = 0;
        for(var i = 0; i < anchors.length; ++i) {
            var d = pAxis - anchors[i].axis;
            var w = anchors[i].window;
            if(d < -w || d > w) continue;
            // Hermite ramp (1 - (d/w)^2)^2 — soft window edges, no step.
            var t = d / w;
            var ramp = (1 - t * t);
            if(ramp <= 0) continue;
            var boost = anchors[i].depth * ramp * ramp;
            if(boost > maxBoost) maxBoost = boost;
        }
        return maxBoost;
    },

    WaterWidthAt: function(pContext, pSide, pAxis, pBaseWidth) {
        var coarse = this.NoiseAlong(pContext, pAxis, 6,  pSide.length + 1) - 0.5;
        var fine   = this.NoiseAlong(pContext, pAxis, 11, pSide.length + 2) - 0.5;
        var width = pBaseWidth + Math.round(coarse * 3) + Math.round(fine * 2);
        var bay = this.BayDepthAt(pContext, pSide, pAxis, pBaseWidth);
        if(bay > 0)
            width += Math.round(bay);
        return Math.max(2, width);
    },

    MarkCoast: function(pContext, pSide, pWaterWidth, pBeachWidth, pAxisRange) {
        var changed = 0;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                var distance = this.EdgeDistance(pContext, pSide, x, y);
                var axis = this.AxisPosition(pSide, x, y);

                if(pAxisRange && (axis < pAxisRange.start || axis > pAxisRange.end))
                    continue;

                // Skip cliff-reservation cells (Option A,
                // [[mapgen_cliff_option_a_staged]]). The owner-grid ClaimCell
                // calls below would not be enough on their own because the
                // raw Layers.Set(water,...) at L195 and Set(coast,...) at L205
                // bypass the owner grid — without this guard, a coast strip
                // can flood the reserved band and PlateauCliffs.cellBlocksStamp
                // rejects every reserved column. cliffReserve=0 on non-ice
                // (CliffReservation entry-guarded), so byte-identical no-op
                // for jungle/beach/desert.
                if(MapGen.Layers.Get(pContext.Layers.cliffReserve, x, y, 0))
                    continue;

                var waterWidth = this.WaterWidthAt(pContext, pSide, axis, pWaterWidth);

                if(distance < waterWidth) {
                    if(MapGen.Layers.Set(pContext.Layers.water, x, y, 1))
                        ++changed;
                    // Architecture v3: coast water joins the owner model. ClaimCell
                    // only writes when outranking, so this never paints over a
                    // ROUTE/STRUCTURE/CLEARING the skeleton already reserved.
                    MapGen.Layers.ClaimCell(pContext.Layers.owner, x, y, MapGen.Layers.Owner.WATER);
                    continue;
                }

                if(distance < waterWidth + pBeachWidth) {
                    MapGen.Layers.Set(pContext.Layers.coast, x, y, 1);
                    MapGen.Layers.Set(pContext.Layers.blocked, x, y, 0);
                    // Claim BEACH so the sand band is honest on the owner grid and
                    // the tree pass can exclude it via owner (not only the coast bool).
                    MapGen.Layers.ClaimCell(pContext.Layers.owner, x, y, MapGen.Layers.Owner.BEACH);
                    ++changed;
                }
            }
        }

        return changed;
    },

    LandingPoint: function(pContext, pSide, pWaterWidth, pBeachWidth, pAxisRange) {
        var axisMin;
        var axisMax;
        var axis;
        var distance = pWaterWidth + Math.max(0, Math.floor(pBeachWidth * 0.5));

        if(pSide === "left" || pSide === "right") {
            axisMin = pAxisRange ? Math.max(4, pAxisRange.start + 1) : Math.max(4, Math.floor(pContext.Height * 0.25));
            axisMax = pAxisRange ? Math.min(pContext.Height - 5, pAxisRange.end - 1) : Math.max(axisMin, Math.floor(pContext.Height * 0.75));
            if(axisMax < axisMin)
                axisMax = axisMin;
            axis = pContext.Random.Int(axisMin, axisMax);

            return {
                x: pSide === "left" ? distance : pContext.Width - 1 - distance,
                y: axis,
                role: "start"
            };
        }

        axisMin = pAxisRange ? Math.max(4, pAxisRange.start + 1) : Math.max(4, Math.floor(pContext.Width * 0.25));
        axisMax = pAxisRange ? Math.min(pContext.Width - 5, pAxisRange.end - 1) : Math.max(axisMin, Math.floor(pContext.Width * 0.75));
        if(axisMax < axisMin)
            axisMax = axisMin;
        axis = pContext.Random.Int(axisMin, axisMax);

        return {
            x: axis,
            y: pSide === "top" ? distance : pContext.Height - 1 - distance,
            role: "start"
        };
    },

    MoveCampaignStartToLanding: function(pContext, pLanding) {
        var landing = MapGen.Layout.Anchors.ClampPoint(pContext, pLanding);

        pContext.Anchors.start = landing;

        for(var index = 0; index < pContext.Regions.length; ++index) {
            if(pContext.Regions[index].name === "player_start")
                pContext.Regions[index].point = landing;
        }

        pContext.Regions.push({
            name: "beach_landing",
            point: landing,
            radius: Math.max(4, Math.floor((pContext.Profile.ClearingRadius || 4) * 0.8))
        });

        return landing;
    },

    // Architecture v3: one coast builder. The water/beach marking is identical
    // for both modes; campaign additionally nudges the squad start onto the
    // landing (anchor-only, the sole mode difference). pOptions.multiplayer
    // selects; absence defaults to campaign for back-compat.
    Build: function(pContext, pOptions) {
        if(!this.SupportsCoast(pContext))
            return null;

        var multiplayer = !!(pOptions && pOptions.multiplayer);
        var side = this.PickSide(pContext);
        var waterWidth = this.ResolveWidth(pContext.Profile.CoastWaterWidth, 4);
        var beachWidth = this.ResolveWidth(pContext.Profile.BeachWidth, 3);
        var axisRange = this.PickAxisRange(pContext, side);
        var changed = this.MarkCoast(pContext, side, waterWidth, beachWidth, axisRange);

        var beach = {
            side: side,
            axisRange: axisRange,
            waterWidth: waterWidth,
            beachWidth: beachWidth,
            tiles: changed
        };

        // Campaign-only: move the start onto the beach landing (draws RNG, so it
        // must stay ordered after MarkCoast exactly as the legacy path did).
        if(!multiplayer) {
            beach.landing = this.MoveCampaignStartToLanding(
                pContext,
                this.LandingPoint(pContext, side, waterWidth, beachWidth, axisRange)
            );
        }

        pContext.Beaches.push(beach);
        MapGen.Context.AddLog(pContext, "Built planned coast and beach on " + side + " edge" +
            (axisRange ? " axis=" + axisRange.start + ".." + axisRange.end : ""));

        return beach;
    },

    // Back-compat wrappers (call sites migrate to Coast.Build in U2).
    BuildCampaign: function(pContext) { return this.Build(pContext, { multiplayer: false }); },
    BuildMultiplayer: function(pContext) { return this.Build(pContext, { multiplayer: true }); }
};
