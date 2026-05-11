var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

MapGen.Layout.DefensiveLines = {

    DefaultThickness: [2, 3],
    DefaultAxisCoverage: [0.45, 0.75],
    DefaultFraction: [0.40, 0.60],

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

    AxisAnchors: function(pContext) {
        var anchors = pContext.Anchors || {};

        if(anchors.start && anchors.objective)
            return { a: anchors.start, b: anchors.objective };

        if(anchors.teamA && anchors.teamB)
            return { a: anchors.teamA, b: anchors.teamB };

        return null;
    },

    StampLine: function(pContext, pSpec) {
        var endpoints = this.AxisAnchors(pContext);
        if(!endpoints)
            return null;

        var dx = endpoints.b.x - endpoints.a.x;
        var dy = endpoints.b.y - endpoints.a.y;
        var length = Math.sqrt((dx * dx) + (dy * dy));

        if(length < 6)
            return null;

        var ax = dx / length;
        var ay = dy / length;
        var nx = -ay;
        var ny = ax;

        var fractionRange = this.ResolveRange(pSpec.Fraction, this.DefaultFraction);
        var thicknessRange = this.ResolveRange(pSpec.Thickness, this.DefaultThickness);
        var coverageRange = this.ResolveRange(pSpec.AxisCoverage, this.DefaultAxisCoverage);
        var fraction = this.PickFromRange(pContext, fractionRange, false);
        var thickness = this.PickFromRange(pContext, thicknessRange, true);
        var coverage = this.PickFromRange(pContext, coverageRange, false);

        var cx = endpoints.a.x + dx * fraction;
        var cy = endpoints.a.y + dy * fraction;
        var halfSpan = Math.floor(Math.min(pContext.Width, pContext.Height) * coverage * 0.5);
        var startT = -Math.floor(thickness / 2);
        var endT = startT + thickness - 1;

        var stamped = {};
        var skippedByPath = 0;
        var changed = 0;

        for(var s = -halfSpan; s <= halfSpan; ++s) {
            for(var t = startT; t <= endT; ++t) {
                var px = Math.round(cx + (nx * s) + (ax * t));
                var py = Math.round(cy + (ny * s) + (ay * t));
                var key = px + ":" + py;

                if(stamped[key])
                    continue;
                stamped[key] = true;

                if(px < 1 || px >= pContext.Width - 1)
                    continue;
                if(py < 1 || py >= pContext.Height - 1)
                    continue;

                if(MapGen.Layers.Get(pContext.Layers.keepClear, px, py, 0) || MapGen.Layers.Get(pContext.Layers.path, px, py, 0)) {
                    ++skippedByPath;
                    continue;
                }
                if(MapGen.Layers.Get(pContext.Layers.water, px, py, 0))
                    continue;
                if(MapGen.Layers.Get(pContext.Layers.coast, px, py, 0))
                    continue;

                MapGen.Layers.Set(pContext.Layers.outcrop, px, py, 1);
                MapGen.Layers.Set(pContext.Layers.blocked, px, py, 1);
                MapGen.Layers.Set(pContext.Layers.occupied, px, py, 1);
                ++changed;
            }
        }

        return {
            changed: changed,
            gaps: skippedByPath,
            center: { x: Math.round(cx), y: Math.round(cy) },
            fraction: fraction,
            thickness: thickness,
            coverage: coverage
        };
    },

    ResolveSpec: function(pContext) {
        if(pContext.DefensiveLineSpec)
            return pContext.DefensiveLineSpec;

        var profile = pContext.Profile || {};
        var chance = Number(profile.DefensiveLineChance || 0);

        // Always draw the chance roll if chance>0, regardless of how the
        // result is interpreted. This keeps RNG draw count identical
        // between profiles that use force-when-flat and those that don't,
        // protecting jungle/beach byte-identical determinism.
        var rolled = (chance > 0) ? pContext.Random.Chance(chance) : false;

        // Force-when-flat: ice profiles that opt in via
        // ForceDefensiveLineWhenFlat get a guaranteed defensive line if
        // and only if the active route archetype provides no chokepoint
        // composition (no narrowBands, no gateCoverChance). This addresses
        // ice_outpost specifically — the most common ice variant which has
        // bendCount=1 and no narrows/gates, leaving an essentially open
        // map. The forced bar provides the spine-crossing funnel that
        // shipped ice maps reliably contain.
        var forceFlat = !!profile.ForceDefensiveLineWhenFlat;
        var archetypeIsFlat = false;
        if(forceFlat) {
            var arch = pContext.RouteArchetype && pContext.RouteArchetype.definition;
            if(arch) {
                var hasNarrows = !!(arch.narrowBands && arch.narrowBands.length);
                var hasGates = (Number(arch.gateCoverChance) || 0) > 0;
                archetypeIsFlat = !hasNarrows && !hasGates;
            }
            else {
                // No archetype info means the legacy Skeleton fallback
                // ran, which has no chokepoint composition. Treat as flat.
                archetypeIsFlat = true;
            }
        }

        if(chance <= 0 && !(forceFlat && archetypeIsFlat))
            return null;
        if(!rolled && !(forceFlat && archetypeIsFlat))
            return null;

        return {
            Count: profile.DefensiveLineCount || 1,
            Fraction: profile.DefensiveLineFraction || this.DefaultFraction,
            Thickness: profile.DefensiveLineThickness || this.DefaultThickness,
            AxisCoverage: profile.DefensiveLineAxisCoverage || this.DefaultAxisCoverage
        };
    },

    Build: function(pContext) {
        var spec = this.ResolveSpec(pContext);
        if(!spec)
            return null;

        var count = Math.max(1, Math.floor(Number(spec.Count) || 1));
        var results = [];

        for(var index = 0; index < count; ++index) {
            var spacedFraction;

            if(count > 1) {
                var center = (index + 1) / (count + 1);
                spacedFraction = [Math.max(0.15, center - 0.05), Math.min(0.85, center + 0.05)];
            }
            else {
                spacedFraction = spec.Fraction || this.DefaultFraction;
            }

            var perSpec = {
                Fraction: spacedFraction,
                Thickness: spec.Thickness,
                AxisCoverage: spec.AxisCoverage
            };
            var result = this.StampLine(pContext, perSpec);

            if(result && result.changed) {
                results.push(result);

                if(pContext.Regions) {
                    pContext.Regions.push({
                        name: "defensive_line_" + index,
                        point: result.center
                    });
                }
            }
        }

        if(!results.length)
            return null;

        if(!pContext.DefensiveLines)
            pContext.DefensiveLines = [];

        for(var ri = 0; ri < results.length; ++ri)
            pContext.DefensiveLines.push(results[ri]);

        if(MapGen.Context && MapGen.Context.AddLog) {
            MapGen.Context.AddLog(pContext, "Defensive lines placed=" + results.length +
                " thickness=" + results[0].thickness +
                " coverage=" + Math.round(results[0].coverage * 100) + "%" +
                " gaps=" + results[0].gaps);
        }

        return results;
    }
};
