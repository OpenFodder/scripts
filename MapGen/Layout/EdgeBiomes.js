var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

MapGen.Layout.EdgeBiomes = {

    DefaultAxisCoverage: [0.30, 0.60],
    DefaultWaterWidth: [2, 4],
    DefaultBeachWidth: [1, 3],
    DefaultBandWidth: [2, 4],
    AxisMargin: 3,

    ResolveRange: function(pValue, pFallback) {
        if(pValue && typeof pValue.length === "number") {
            var min = Number(pValue[0]);
            var max = Number(pValue[1]);
            if(!isNaN(min) && !isNaN(max))
                return [min, max];
        }

        if(typeof pValue === "number" && !isNaN(pValue))
            return [pValue, pValue];

        return pFallback;
    },

    PickFromRange: function(pContext, pRange, pInteger) {
        var lo = pRange[0];
        var hi = pRange[1];

        if(hi <= lo)
            return pInteger ? Math.max(1, Math.floor(lo)) : lo;

        if(pInteger)
            return pContext.Random.Int(Math.floor(lo), Math.max(Math.floor(lo), Math.floor(hi)));

        return pContext.Random.Float(lo, hi);
    },

    PickKind: function(pContext) {
        var profile = pContext.Profile;
        var weights = profile.EdgeBiomeKinds || { ridge: 1.0 };
        var kinds = [];
        var totals = [];
        var total = 0;

        for(var key in weights) {
            if(!weights.hasOwnProperty(key))
                continue;

            var weight = Number(weights[key]) || 0;
            if(weight <= 0)
                continue;

            kinds.push(key);
            total += weight;
            totals.push(total);
        }

        if(!kinds.length)
            return "ridge";

        var roll = pContext.Random.Float(0, total);
        for(var index = 0; index < totals.length; ++index) {
            if(roll <= totals[index])
                return kinds[index];
        }

        return kinds[kinds.length - 1];
    },

    SupportsKind: function(pContext, pKind) {
        var terrain = pContext.Profile.TerrainType;
        var catalog = MapGen.Terrain && MapGen.Terrain.TileCatalog;

        if(pKind === "coast") {
            if(!catalog)
                return true;
            if(catalog.SupportsWaterFeatureForProfile)
                return catalog.SupportsWaterFeatureForProfile(pContext.Profile, "coasts");

            return catalog.SupportsWaterFeature(terrain, "coasts");
        }
        if(pKind === "swamp")
            return catalog ? catalog.SupportsWaterFeature(terrain, "ponds") : true;

        return true;
    },

    PickSide: function(pContext) {
        var sides = ["left", "right", "top", "bottom"];
        var taken = {};

        if(pContext.Beaches) {
            for(var index = 0; index < pContext.Beaches.length; ++index) {
                var side = pContext.Beaches[index] && pContext.Beaches[index].side;
                if(side)
                    taken[side] = true;
            }
        }

        var available = [];
        for(var sideIndex = 0; sideIndex < sides.length; ++sideIndex) {
            if(!taken[sides[sideIndex]])
                available.push(sides[sideIndex]);
        }

        if(!available.length)
            return null;

        return available[pContext.Random.Int(0, available.length - 1)];
    },

    AxisRange: function(pContext, pSide, pCoverage) {
        var axisLength = pSide === "left" || pSide === "right" ? pContext.Height : pContext.Width;
        var span = Math.max(4, Math.floor(axisLength * pCoverage));
        var maxStart = axisLength - span - this.AxisMargin;

        if(maxStart <= this.AxisMargin)
            return { start: this.AxisMargin, end: axisLength - this.AxisMargin };

        var start = pContext.Random.Int(this.AxisMargin, maxStart);
        return { start: start, end: start + span };
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

    StampCoast: function(pContext, pSide, pAxisRange, pWaterWidth, pBeachWidth) {
        var changed = 0;
        var catalog = MapGen.Terrain && MapGen.Terrain.TileCatalog;
        var supportsCoast = true;

        if(catalog) {
            supportsCoast = catalog.SupportsWaterFeatureForProfile ?
                catalog.SupportsWaterFeatureForProfile(pContext.Profile, "coasts") :
                catalog.SupportsWaterFeature(pContext.Profile.TerrainType, "coasts");
        }

        if(!supportsCoast)
            return 0;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                var axis = this.AxisPosition(pSide, x, y);
                if(axis < pAxisRange.start || axis > pAxisRange.end)
                    continue;

                var distance = this.EdgeDistance(pContext, pSide, x, y);

                if(MapGen.Layers.Get(pContext.Layers.keepClear, x, y, 0) || MapGen.Layers.Get(pContext.Layers.path, x, y, 0))
                    continue;

                if(distance < pWaterWidth) {
                    MapGen.Layers.Set(pContext.Layers.water, x, y, 1);
                    MapGen.Layers.Set(pContext.Layers.blocked, x, y, 0);
                    ++changed;
                    continue;
                }

                if(distance < pWaterWidth + pBeachWidth) {
                    MapGen.Layers.Set(pContext.Layers.coast, x, y, 1);
                    MapGen.Layers.Set(pContext.Layers.blocked, x, y, 0);
                    ++changed;
                }
            }
        }

        return changed;
    },

    StampSwamp: function(pContext, pSide, pAxisRange, pWaterWidth) {
        var changed = 0;
        var catalog = MapGen.Terrain && MapGen.Terrain.TileCatalog;
        var supportsCoast = catalog && catalog.SupportsWaterFeatureForProfile ?
            catalog.SupportsWaterFeatureForProfile(pContext.Profile, "coasts") :
            false;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                var axis = this.AxisPosition(pSide, x, y);
                if(axis < pAxisRange.start || axis > pAxisRange.end)
                    continue;

                var distance = this.EdgeDistance(pContext, pSide, x, y);
                var jitter = pContext.Random.Int(-1, 1);
                var threshold = pWaterWidth + jitter;

                if(MapGen.Layers.Get(pContext.Layers.keepClear, x, y, 0) || MapGen.Layers.Get(pContext.Layers.path, x, y, 0))
                    continue;

                if(distance < threshold) {
                    if(pContext.Random.Chance(0.6)) {
                        MapGen.Layers.Set(pContext.Layers.water, x, y, 1);
                        MapGen.Layers.Set(pContext.Layers.blocked, x, y, 0);
                    }
                    else {
                        if(supportsCoast)
                            MapGen.Layers.Set(pContext.Layers.coast, x, y, 1);
                        else
                            MapGen.Layers.Set(pContext.Layers.riverBank, x, y, 1);
                        MapGen.Layers.Set(pContext.Layers.blocked, x, y, 0);
                    }
                    ++changed;
                }
            }
        }

        return changed;
    },

    StampRidge: function(pContext, pSide, pAxisRange, pBandWidth) {
        var changed = 0;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                var axis = this.AxisPosition(pSide, x, y);
                if(axis < pAxisRange.start || axis > pAxisRange.end)
                    continue;

                var distance = this.EdgeDistance(pContext, pSide, x, y);
                if(distance >= pBandWidth)
                    continue;

                if(MapGen.Layers.Get(pContext.Layers.keepClear, x, y, 0) || MapGen.Layers.Get(pContext.Layers.path, x, y, 0))
                    continue;
                if(MapGen.Layers.Get(pContext.Layers.water, x, y, 0))
                    continue;
                if(MapGen.Layers.Get(pContext.Layers.coast, x, y, 0))
                    continue;

                if(distance === pBandWidth - 1 && pContext.Random.Chance(0.25))
                    continue;

                MapGen.Layers.Set(pContext.Layers.outcrop, x, y, 1);
                MapGen.Layers.Set(pContext.Layers.blocked, x, y, 1);
                MapGen.Layers.Set(pContext.Layers.occupied, x, y, 1);
                ++changed;
            }
        }

        return changed;
    },

    RegionPoint: function(pContext, pSide, pAxisRange, pInset) {
        var axis = Math.floor((pAxisRange.start + pAxisRange.end) / 2);
        var inset = Math.max(2, Math.floor(pInset));

        switch(pSide) {
            case "left":   return { x: inset, y: axis };
            case "right":  return { x: pContext.Width - 1 - inset, y: axis };
            case "top":    return { x: axis, y: inset };
            case "bottom": return { x: axis, y: pContext.Height - 1 - inset };
            default:       return { x: inset, y: axis };
        }
    },

    Build: function(pContext) {
        var profile = pContext.Profile;
        var chance = Number(profile.EdgeBiomeChance || 0);

        if(chance <= 0)
            return null;
        if(!pContext.Random.Chance(chance))
            return null;

        var kind = this.PickKind(pContext);

        if(!this.SupportsKind(pContext, kind))
            kind = "ridge";

        var side = this.PickSide(pContext);
        if(!side)
            return null;

        var coverageRange = this.ResolveRange(profile.EdgeBiomeAxisCoverage, this.DefaultAxisCoverage);
        var coverage = this.PickFromRange(pContext, coverageRange, false);
        var axisRange = this.AxisRange(pContext, side, coverage);
        var changed = 0;
        var meta = {
            kind: kind,
            side: side,
            axisRange: axisRange,
            coverage: coverage
        };

        if(kind === "coast") {
            var waterRange = this.ResolveRange(profile.EdgeBiomeWaterWidth, this.DefaultWaterWidth);
            var beachRange = this.ResolveRange(profile.EdgeBiomeBeachWidth, this.DefaultBeachWidth);
            var waterWidth = this.PickFromRange(pContext, waterRange, true);
            var beachWidth = this.PickFromRange(pContext, beachRange, true);

            changed = this.StampCoast(pContext, side, axisRange, waterWidth, beachWidth);
            meta.waterWidth = waterWidth;
            meta.beachWidth = beachWidth;
        }
        else if(kind === "swamp") {
            var swampRange = this.ResolveRange(profile.EdgeBiomeWaterWidth, this.DefaultWaterWidth);
            var swampWidth = this.PickFromRange(pContext, swampRange, true);

            changed = this.StampSwamp(pContext, side, axisRange, swampWidth);
            meta.waterWidth = swampWidth;
        }
        else {
            var bandRange = this.ResolveRange(profile.EdgeBiomeBandWidth, this.DefaultBandWidth);
            var bandWidth = this.PickFromRange(pContext, bandRange, true);

            changed = this.StampRidge(pContext, side, axisRange, bandWidth);
            meta.bandWidth = bandWidth;
        }

        meta.tiles = changed;

        if(!changed)
            return null;

        if(!pContext.EdgeBiomes)
            pContext.EdgeBiomes = [];
        pContext.EdgeBiomes.push(meta);

        if(pContext.Regions) {
            pContext.Regions.push({
                name: "edge_biome_" + kind,
                point: this.RegionPoint(pContext, side, axisRange, (meta.waterWidth || meta.bandWidth || 2) + 1),
                radius: Math.max(3, Math.floor((axisRange.end - axisRange.start) * 0.25))
            });
        }

        MapGen.Context.AddLog(pContext, "Edge biome " + kind + " on " + side + " axis=" +
            axisRange.start + ".." + axisRange.end + " tiles=" + changed);

        return meta;
    }
};
