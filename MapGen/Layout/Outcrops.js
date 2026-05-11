var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

MapGen.Layout.Outcrops = {

    ShouldBuild: function(pContext) {
        var profile = pContext.Profile;

        if(!profile)
            return false;
        if((profile.MaxOutcropCount || 0) < 1)
            return false;
        if(profile.OutcropKind === "none")
            return false;

        return pContext.Random.Chance(Number(profile.OutcropChance || 0));
    },

    PickRadius: function(pContext) {
        var max = Math.max(2, Math.floor(Number(pContext.Profile.OutcropRadius || 4)));
        return pContext.Random.Int(2, max);
    },

    NearAny: function(pPoint, pX, pY, pPoints, pField, pBuffer) {
        for(var index = 0; index < pPoints.length; ++index) {
            var other = pPoints[index];
            var ox = pField ? other[pField].x : other.x;
            var oy = pField ? other[pField].y : other.y;
            var dx = ox - pX;
            var dy = oy - pY;
            var radius = (other.radius || 0) + pBuffer;

            if((dx * dx) + (dy * dy) <= radius * radius)
                return true;
        }

        return false;
    },

    OverlapsReserved: function(pContext, pX, pY, pRadius) {
        var radiusSq = (pRadius + 1) * (pRadius + 1);

        for(var dx = -pRadius - 1; dx <= pRadius + 1; ++dx) {
            for(var dy = -pRadius - 1; dy <= pRadius + 1; ++dy) {
                if((dx * dx) + (dy * dy) > radiusSq)
                    continue;

                var x = pX + dx;
                var y = pY + dy;

                if(MapGen.Layers.Get(pContext.Layers.keepClear, x, y, 0) || MapGen.Layers.Get(pContext.Layers.path, x, y, 0))
                    return true;
                if(MapGen.Layers.Get(pContext.Layers.water, x, y, 0))
                    return true;
                if(MapGen.Layers.Get(pContext.Layers.coast, x, y, 0))
                    return true;
            }
        }

        return false;
    },

    PickCenter: function(pContext, pRadius) {
        var margin = pRadius + 2;
        var minX = margin;
        var maxX = pContext.Width - margin - 1;
        var minY = margin;
        var maxY = pContext.Height - margin - 1;

        if(maxX <= minX || maxY <= minY)
            return null;

        return {
            x: pContext.Random.Int(minX, maxX),
            y: pContext.Random.Int(minY, maxY)
        };
    },

    // Polyline arc-length helper. Returns total length and per-segment
    // cumulative-length array. Reused by route-adjacent samplers to map
    // a parametric t in [0,1] to a point along the corridor with
    // uniform-by-distance distribution (NOT uniform-by-segment, which
    // would over-cluster near short bend segments).
    RouteCorridorArcLengths: function(pPoints) {
        var lengths = [0];
        var total = 0;
        for(var i = 1; i < pPoints.length; ++i) {
            var dx = pPoints[i].x - pPoints[i - 1].x;
            var dy = pPoints[i].y - pPoints[i - 1].y;
            total += Math.sqrt((dx * dx) + (dy * dy));
            lengths.push(total);
        }
        return { lengths: lengths, total: total };
    },

    // Map a parametric t in [0,1] to a point on the polyline by arc
    // length. Returns { point: {x,y}, tangent: {x,y} (unit-ish) } or
    // null if the polyline is degenerate.
    SampleRoutePoint: function(pPoints, pT) {
        if(!pPoints || pPoints.length < 2)
            return null;
        var arc = this.RouteCorridorArcLengths(pPoints);
        if(arc.total <= 0)
            return null;
        var target = pT * arc.total;
        // Find the segment containing `target`.
        for(var i = 1; i < arc.lengths.length; ++i) {
            if(arc.lengths[i] >= target) {
                var prev = arc.lengths[i - 1];
                var segLen = Math.max(1e-6, arc.lengths[i] - prev);
                var local = (target - prev) / segLen;
                var ax = pPoints[i - 1].x;
                var ay = pPoints[i - 1].y;
                var bx = pPoints[i].x;
                var by = pPoints[i].y;
                var px = ax + (bx - ax) * local;
                var py = ay + (by - ay) * local;
                // Tangent: segment direction normalised; segLen>0 here.
                var tx = (bx - ax) / segLen;
                var ty = (by - ay) / segLen;
                return { point: { x: px, y: py }, tangent: { x: tx, y: ty } };
            }
        }
        // Fallback to last point (shouldn't happen since pT<=1).
        var last = pPoints[pPoints.length - 1];
        return { point: { x: last.x, y: last.y }, tangent: { x: 0, y: 0 } };
    },

    // Spine-aware center picker. Samples a parametric t in [0.18, 0.82]
    // along pContext.RouteCorridor.points (arc-length parameterised) and
    // offsets perpendicular to the local tangent by a feature-radius-
    // relative distance. Falls back to PickCenter when RouteCorridor is
    // missing (jungle/beach/MP) so determinism for non-ice profiles is
    // preserved.
    //
    // RNG draw budget per call: 2 (matches PickCenter's 2 draws so the
    // existing 16-attempt outer loop consumes the same RNG count whether
    // RouteSpineClustering is on or off — which is required for jungle/
    // beach byte-identical output per project_mapgen_determinism).
    PickRouteAdjacentCenter: function(pContext, pRadius) {
        var corridor = pContext.RouteCorridor;
        if(!corridor || !corridor.points || corridor.points.length < 2)
            return this.PickCenter(pContext, pRadius);

        // Draw 1: parametric t along arc length, restricted to [0.18, 0.82]
        // to avoid sampling at the literal start/objective anchor cells
        // (which would collide with NearAnchors anyway).
        var t = 0.18 + (pContext.Random.Float(0, 1) * 0.64);
        var sample = this.SampleRoutePoint(corridor.points, t);
        if(!sample) {
            // Pull the second draw anyway to keep RNG draw count parity
            // with the success path. Without this the failure path would
            // consume 1 fewer draw and shift downstream RNG state.
            pContext.Random.Int(0, 1);
            return this.PickCenter(pContext, pRadius);
        }

        // Draw 2: perpendicular offset distance. Signed via low bit; the
        // [pRadius+3, pRadius+10] range keeps the outcrop clear of the
        // route core/center/edge masks but close enough to read as
        // "next to the route" rather than scattered.
        var minOff = pRadius + 3;
        var maxOff = pRadius + 10;
        var raw = pContext.Random.Int(0, ((maxOff - minOff) * 2) + 1);
        var offset = minOff + Math.floor(raw / 2);
        if((raw & 1) === 0)
            offset = -offset;

        // Perpendicular direction: rotate tangent 90° (ccw). If the
        // tangent is degenerate (final-point fallback), use a fixed
        // orientation so the result is still deterministic.
        var px = -sample.tangent.y;
        var py = sample.tangent.x;
        var nlen = Math.sqrt((px * px) + (py * py));
        if(nlen < 1e-6) { px = 1; py = 0; nlen = 1; }
        px /= nlen;
        py /= nlen;

        var cx = Math.round(sample.point.x + (px * offset));
        var cy = Math.round(sample.point.y + (py * offset));

        // Clamp to in-bounds. If the offset pushed the candidate
        // off-map, return null so the outer 16-attempt loop tries again
        // (the next attempt will redraw t/offset and likely land back
        // in bounds). Don't fall back to PickCenter here — the outer
        // loop already retries up to 16 times.
        var margin = pRadius + 2;
        if(cx < margin || cy < margin ||
            cx > pContext.Width - margin - 1 ||
            cy > pContext.Height - margin - 1)
            return null;

        return { x: cx, y: cy };
    },

    StampBlob: function(pContext, pCenter, pRadius) {
        var satellites = pContext.Random.Int(2, 4);
        var maxOffset = Math.max(1, Math.floor(pRadius * 0.6));

        this.StampDisc(pContext, pCenter.x, pCenter.y, pRadius);

        for(var index = 0; index < satellites; ++index) {
            var angle = pContext.Random.Float(0, Math.PI * 2);
            var distance = pContext.Random.Int(Math.max(1, Math.floor(pRadius * 0.5)), pRadius);
            var sx = Math.round(pCenter.x + (Math.cos(angle) * distance));
            var sy = Math.round(pCenter.y + (Math.sin(angle) * distance));
            var sr = Math.max(1, Math.floor(pRadius * (0.5 + (pContext.Random.Float(0, 0.4)))));

            this.StampDisc(pContext, sx, sy, sr);
        }
    },

    StampDisc: function(pContext, pX, pY, pRadius) {
        var radiusSq = pRadius * pRadius;

        for(var dx = -pRadius; dx <= pRadius; ++dx) {
            for(var dy = -pRadius; dy <= pRadius; ++dy) {
                if((dx * dx) + (dy * dy) > radiusSq)
                    continue;

                var x = pX + dx;
                var y = pY + dy;

                if(!MapGen.Layers.InBounds(pContext.Layers.outcrop, x, y))
                    continue;
                if(MapGen.Layers.Get(pContext.Layers.keepClear, x, y, 0) || MapGen.Layers.Get(pContext.Layers.path, x, y, 0))
                    continue;
                if(MapGen.Layers.Get(pContext.Layers.water, x, y, 0))
                    continue;
                if(MapGen.Layers.Get(pContext.Layers.coast, x, y, 0))
                    continue;

                MapGen.Layers.Set(pContext.Layers.outcrop, x, y, 1);
                MapGen.Layers.Set(pContext.Layers.occupied, x, y, 1);
            }
        }
    },

    Build: function(pContext) {
        if(!this.ShouldBuild(pContext))
            return null;

        var maxCount = Math.max(1, Math.floor(Number(pContext.Profile.MaxOutcropCount || 1)));
        var attempts = pContext.Random.Int(1, maxCount);
        var built = [];
        var clearingBuffer = 4;
        // Spine-aware mode: when the profile opts in via RouteSpineClustering,
        // outcrops sample positions along the route polyline (perpendicular
        // offset by radius+3..radius+10) instead of uniform random. The
        // sampler keeps t in [0.18, 0.82] which already keeps clear of the
        // start anchor at t=0, so a tighter anchor buffer is safe and
        // prevents over-rejection of valid route-side positions.
        var spineCluster = !!(pContext.Profile && pContext.Profile.RouteSpineClustering);
        var hasCorridor = !!(pContext.RouteCorridor && pContext.RouteCorridor.points && pContext.RouteCorridor.points.length >= 2);
        var routeMode = spineCluster && hasCorridor;
        var anchorBuffer = 6;

        for(var index = 0; index < attempts; ++index) {
            var radius = this.PickRadius(pContext);
            var localAnchorBuffer = routeMode ? (radius + 3) : anchorBuffer;
            var placed = false;

            for(var attempt = 0; attempt < 16 && !placed; ++attempt) {
                var center = routeMode ?
                    this.PickRouteAdjacentCenter(pContext, radius) :
                    this.PickCenter(pContext, radius);

                if(!center)
                    break;
                if(this.OverlapsReserved(pContext, center.x, center.y, radius))
                    continue;
                if(this.NearAny(center, center.x, center.y, pContext.Clearings || [], null, radius + clearingBuffer))
                    continue;
                if(this.NearAny(center, center.x, center.y, built, null, radius + 2))
                    continue;
                if(this.NearAnchors(pContext, center, radius + localAnchorBuffer))
                    continue;

                this.StampBlob(pContext, center, radius);
                built.push({
                    x: center.x,
                    y: center.y,
                    radius: radius,
                    kind: pContext.Profile.OutcropKind || "rocks"
                });
                placed = true;
            }
        }

        for(var pushIndex = 0; pushIndex < built.length; ++pushIndex)
            pContext.Outcrops.push(built[pushIndex]);

        return built;
    },

    NearAnchors: function(pContext, pCenter, pBuffer) {
        var anchors = pContext.Anchors;
        var bufferSq = pBuffer * pBuffer;

        if(!anchors)
            return false;

        for(var key in anchors) {
            if(!anchors.hasOwnProperty(key))
                continue;

            var anchor = anchors[key];
            if(!anchor || typeof anchor.x !== "number" || typeof anchor.y !== "number")
                continue;

            var dx = anchor.x - pCenter.x;
            var dy = anchor.y - pCenter.y;
            if((dx * dx) + (dy * dy) <= bufferSq)
                return true;
        }

        return false;
    },

    ApplyToBlocked: function(pContext) {
        if(!pContext.Outcrops || !pContext.Outcrops.length)
            return 0;

        var outcrop = pContext.Layers.outcrop;
        var blocked = pContext.Layers.blocked;
        var keepClear = pContext.Layers.keepClear;
        var path = pContext.Layers.path;
        var changed = 0;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(!MapGen.Layers.Get(outcrop, x, y, 0))
                    continue;
                if(MapGen.Layers.Get(keepClear, x, y, 0) || MapGen.Layers.Get(path, x, y, 0))
                    continue;
                if(MapGen.Layers.Get(blocked, x, y, 0))
                    continue;

                MapGen.Layers.Set(blocked, x, y, 1);
                ++changed;
            }
        }

        if(changed)
            MapGen.Context.AddLog(pContext, "Applied outcrops to blocked: " + changed);

        return changed;
    }
};
