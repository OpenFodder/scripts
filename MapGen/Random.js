var MapGen = MapGen || {};

MapGen.Random = {

    CreateSeeded: function(pSeed) {
        var initialSeed = (pSeed === undefined ? 0 : pSeed) >>> 0;
        var state = initialSeed;

        function nextFloat() {
            state = ((state * 1664525) + 1013904223) >>> 0;
            return state / 4294967296;
        }

        return {
            // Expose the immutable seed for decisions that must be well mixed
            // across neighbouring input seeds. The LCG's first raw draw is
            // intentionally deterministic but highly correlated for N/N+1.
            InitialSeed: initialSeed,

            Int: function(pMin, pMax) {
                var min = Math.floor(pMin);
                var max = Math.floor(pMax);

                if(max < min) {
                    var swap = min;
                    min = max;
                    max = swap;
                }

                return min + Math.floor(nextFloat() * ((max - min) + 1));
            },

            Float: function(pMin, pMax) {
                return pMin + (nextFloat() * (pMax - pMin));
            },

            Chance: function(pProbability) {
                if(pProbability <= 0)
                    return false;
                if(pProbability >= 1)
                    return true;

                return this.Float(0, 1) < pProbability;
            },

            Pick: function(pItems) {
                if(!pItems || !pItems.length)
                    return null;

                return pItems[this.Int(0, pItems.length - 1)];
            },

            RangeInt: function(pRange) {
                if(pRange instanceof Array)
                    return this.Int(pRange[0], pRange[1]);

                return pRange;
            },

            Extreme: function(pMin, pMax, pInteger) {
                if(this.Chance(0.20)) {
                    var pickMax = this.Chance(0.5);
                    var edge = pickMax ? pMax : pMin;
                    return pInteger ? Math.floor(edge) : edge;
                }

                return pInteger ? this.Int(pMin, pMax) : this.Float(pMin, pMax);
            }
        };
    },

    HashTile: function(pSeed, pX, pY, pSalt) {
        var value = ((pSeed | 0) + (pX * 374761393) + (pY * 668265263) + ((pSalt || 0) * 1013904223)) | 0;
        value = (value ^ (value >>> 13)) | 0;
        value = (value * 1274126177) | 0;
        return (value ^ (value >>> 16)) >>> 0;
    },

    DeriveSeed: function(pSeed, pAttempt) {
        var seed = Number(pSeed);
        var attempt = Number(pAttempt || 0);

        if(isNaN(seed))
            seed = 0;
        if(isNaN(attempt) || attempt < 0)
            attempt = 0;

        seed = seed >>> 0;
        attempt = Math.floor(attempt) >>> 0;

        if(!attempt)
            return seed;

        seed = (seed + ((attempt * 1103) >>> 0) + 0x40B) >>> 0;
        seed = (((seed * 1664525) + 1013904223) >>> 0);
        seed = (seed ^ (seed >>> 16)) >>> 0;
        return seed >>> 0;
    }
};
