var MapGen = MapGen || {};
MapGen.Grammar = MapGen.Grammar || {};

MapGen.Grammar.Util = {

    HasOwn: function(pObject, pKey) {
        return !!pObject && Object.prototype.hasOwnProperty.call(pObject, pKey);
    },

    NumberOrNull: function(pValue) {
        var value = Number(pValue);
        return isFinite(value) ? value : null;
    },

    Clamp: function(pValue, pMin, pMax) {
        if(pMax < pMin) {
            var swap = pMin;
            pMin = pMax;
            pMax = swap;
        }
        if(pValue < pMin)
            return pMin;
        if(pValue > pMax)
            return pMax;
        return pValue;
    },

    Round: function(pValue, pPlaces) {
        var scale = Math.pow(10, pPlaces || 0);
        return Math.round(pValue * scale) / scale;
    },

    StatRange: function(pStats, pPreferWide) {
        var source = null;

        if(!pStats)
            return null;

        if(!pPreferWide && pStats.targetRange instanceof Array)
            source = pStats.targetRange;
        else if(pStats.wideRange instanceof Array)
            source = pStats.wideRange;
        else if(pStats.targetRange instanceof Array)
            source = pStats.targetRange;

        if(!source || source.length < 2)
            return null;

        var min = this.NumberOrNull(source[0]);
        var max = this.NumberOrNull(source[1]);

        if(min === null || max === null)
            return null;

        if(max < min) {
            var swap = min;
            min = max;
            max = swap;
        }

        return [min, max];
    },

    PickStatNumber: function(pRandom, pStats, pInteger, pFallback) {
        return this.PickStatNumberWithMode(pRandom, pStats, pInteger, pFallback, "inner");
    },

    PickStatNumberOuter: function(pRandom, pStats, pInteger, pFallback) {
        return this.PickStatNumberWithMode(pRandom, pStats, pInteger, pFallback, "outer");
    },

    PickStatNumberWithMode: function(pRandom, pStats, pInteger, pFallback, pIntegerMode) {
        var range = this.StatRange(pStats, false) || this.StatRange(pStats, true);
        var value;

        if(range) {
            if(pInteger) {
                var minInt = pIntegerMode === "outer" ? Math.floor(range[0]) : Math.ceil(range[0]);
                var maxInt = pIntegerMode === "outer" ? Math.ceil(range[1]) : Math.floor(range[1]);
                if(maxInt < minInt)
                    maxInt = minInt;
                value = pRandom.Int(minInt, maxInt);
            }
            else {
                value = pRandom.Float(range[0], range[1]);
            }
            return pInteger ? Math.max(0, Math.round(value)) : value;
        }

        value = this.NumberOrNull(pStats ? pStats.median : null);
        if(value !== null)
            return pInteger ? Math.max(0, Math.round(value)) : value;

        value = this.NumberOrNull(pStats ? pStats.mean : null);
        if(value !== null)
            return pInteger ? Math.max(0, Math.round(value)) : value;

        return pFallback;
    },

    RangeSummary: function(pStats) {
        return {
            targetRange: this.StatRange(pStats, false),
            wideRange: this.StatRange(pStats, true),
            median: this.NumberOrNull(pStats ? pStats.median : null),
            mean: this.NumberOrNull(pStats ? pStats.mean : null)
        };
    },

    PickMetric: function(pContext, pStats, pInteger, pFallback) {
        var selected = this.PickStatNumber(pContext.Random, pStats, pInteger, pFallback);
        return {
            selected: pInteger ? Math.round(selected) : this.Round(selected, 4),
            range: this.RangeSummary(pStats)
        };
    },

    PickMetricOuter: function(pContext, pStats, pInteger, pFallback) {
        var selected = this.PickStatNumberOuter(pContext.Random, pStats, pInteger, pFallback);
        return {
            selected: pInteger ? Math.round(selected) : this.Round(selected, 4),
            range: this.RangeSummary(pStats)
        };
    }
};
