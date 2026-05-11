var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

MapGen.Layout.Clearings = {

    DistanceSq: function(pA, pB) {
        var dx = pA.x - pB.x;
        var dy = pA.y - pB.y;
        return (dx * dx) + (dy * dy);
    },

    CanAdd: function(pContext, pPoint, pRadius) {
        for(var index = 0; index < pContext.Clearings.length; ++index) {
            var existing = pContext.Clearings[index];
            var minDistance = existing.radius + pRadius + 3;

            if(this.DistanceSq(existing, pPoint) < minDistance * minDistance)
                return false;
        }

        return true;
    },

    RadiusForRole: function(pContext, pRole) {
        var base = pContext.Profile.ClearingRadius;

        switch(pRole) {
            case "start":
            case "team_a":
            case "team_b":
                return Math.max(base, Math.floor(base * (pContext.Profile.TeamClearingRadiusScale || 1.15)));
            case "objective":
                return Math.max(base, Math.floor(base * (pContext.Profile.ObjectiveClearingRadiusScale || 1.25)));
            case "contested":
                return Math.max(3, Math.floor(base * (pContext.Profile.ContestedClearingRadiusScale || pContext.Profile.ObjectiveClearingRadiusScale || 1.25)));
            case "support":
                return Math.max(3, Math.floor(base * (pContext.Profile.SupportClearingRadiusScale || 0.80)));
            case "ambush_pocket":
                return Math.max(3, Math.floor(base * (pContext.Profile.AmbushClearingRadiusScale || 0.55)));
            case "flank":
                return Math.max(3, Math.floor(base * (pContext.Profile.FlankClearingRadiusScale || 0.55)));
            case "open_space":
                return Math.max(3, Math.floor(base * (pContext.Profile.OpenSpaceClearingRadiusScale || 0.55)));
            case "village":
                return Math.max(5, Math.floor(base * (pContext.Profile.VillageClearingRadiusScale || 1.05)));
            case "enemy_camp":
                return Math.max(4, Math.floor(base * (pContext.Profile.EnemyCampClearingRadiusScale || 0.75)));
            case "derelict":
                return Math.max(3, Math.floor(base * (pContext.Profile.DerelictClearingRadiusScale || 0.60)));
            case "cache":
            case "lookout":
                return Math.max(3, Math.floor(base * (pContext.Profile.SmallClearingRadiusScale || 0.45)));
            case "route_clearing":
                return Math.max(3, Math.floor(base * (pContext.Profile.RouteClearingRadiusScale || 0.65)));
            case "route_rest":
            default:
                return Math.max(3, Math.floor(base * (pContext.Profile.RouteRestClearingRadiusScale || pContext.Profile.RouteClearingRadiusScale || 0.65)));
        }
    },

    Add: function(pContext, pPoint, pRadius, pRole, pForce) {
        if(!pForce && !this.CanAdd(pContext, pPoint, pRadius))
            return null;

        var clearing = {
            x: pPoint.x,
            y: pPoint.y,
            radius: pRadius,
            role: pRole || pPoint.role || "clearing"
        };

        pContext.Clearings.push(clearing);
        MapGen.Layers.StampDisc(pContext.Layers.keepClear, clearing.x, clearing.y, pRadius, 1);

        // Architecture v3: reserve the clearing footprint as CLEARING ownership
        // (ClaimCell preserves a higher ROUTE claim where a route crosses it).
        var r2 = pRadius * pRadius;
        for(var cx = clearing.x - pRadius; cx <= clearing.x + pRadius; ++cx) {
            for(var cy = clearing.y - pRadius; cy <= clearing.y + pRadius; ++cy) {
                var ddx = cx - clearing.x, ddy = cy - clearing.y;
                if((ddx * ddx) + (ddy * ddy) <= r2)
                    MapGen.Layers.ClaimCell(pContext.Layers.owner, cx, cy, MapGen.Layers.Owner.CLEARING);
            }
        }

        return clearing;
    },

    BuildFromAnchors: function(pContext) {
        var anchors = pContext.Anchors;
        var key;

        for(key in anchors) {
            if(anchors.hasOwnProperty(key))
                this.Add(pContext, anchors[key], this.RadiusForRole(pContext, anchors[key].role), anchors[key].role, true);
        }
    },

    PathClearingRole: function(pIndex) {
        var roles = ["route_rest", "ambush_pocket", "route_clearing", "flank", "route_rest", "route_clearing"];
        return roles[pIndex % roles.length];
    },

    OffsetPathPoint: function(pContext, pPath, pPointIndex, pRadius, pSide) {
        var previous = pPath.points[Math.max(0, pPointIndex - 3)];
        var next = pPath.points[Math.min(pPath.points.length - 1, pPointIndex + 3)];
        var base = pPath.points[pPointIndex];
        var dx = next.x - previous.x;
        var dy = next.y - previous.y;
        var length = Math.max(1, Math.sqrt((dx * dx) + (dy * dy)));
        var distance = Math.max(2, Math.floor(pRadius * 0.65));

        return {
            x: Math.max(2, Math.min(pContext.Width - 3, Math.round(base.x + ((-dy / length) * distance * pSide)))),
            y: Math.max(2, Math.min(pContext.Height - 3, Math.round(base.y + ((dx / length) * distance * pSide))))
        };
    },

    PlaceOnPath: function(pContext, pPathIndex, pFraction, pRole, pSide, pOffset) {
        var paths = pContext.Paths;
        if(!paths || pPathIndex >= paths.length)
            return null;

        var path = paths[pPathIndex];
        if(!path.points || !path.points.length)
            return null;

        var pointIndex = Math.min(path.points.length - 1, Math.floor(path.points.length * pFraction));
        var radius = this.RadiusForRole(pContext, pRole);
        var point = path.points[pointIndex];

        if(pOffset)
            point = this.OffsetPathPoint(pContext, path, pointIndex, radius, pSide || 1);

        return this.Add(pContext, point, radius, pRole, false);
    },

    DesiredPathClearingCount: function(pContext) {
        return Math.max(0, pContext.Profile.ClearingCount - pContext.Clearings.length);
    },

    BuildDefaultPathClearings: function(pContext) {
        var desiredCount = this.DesiredPathClearingCount(pContext);
        if(!desiredCount || !pContext.Paths.length)
            return;

        for(var index = 0; index < desiredCount; ++index) {
            var fraction = (index + 1) / (desiredCount + 1);
            var role = this.PathClearingRole(index);
            var side = index % 2 ? 1 : -1;
            var offset = (role === "open_space" || role === "ambush_pocket");
            this.PlaceOnPath(pContext, 0, fraction, role, side, offset);
        }
    },

    BuildPathClearings: function(pContext) {
        if(pContext.Profile && pContext.Profile.JungleMazeDisablePathClearings === true)
            return;

        var templates = MapGen.Layout.Templates;
        var template = templates ? templates.Resolve(pContext) : null;

        if(template && typeof template.ClearingComposition === "function") {
            template.ClearingComposition(pContext, this);
            return;
        }

        this.BuildDefaultPathClearings(pContext);
    },

    WildernessRoles: ["cache", "derelict", "enemy_camp", "lookout"],

    MinPathDistanceSq: function(pContext, pPoint) {
        var best = Infinity;

        for(var pathIndex = 0; pathIndex < pContext.Paths.length; ++pathIndex) {
            var points = pContext.Paths[pathIndex].points;
            for(var index = 0; index < points.length; ++index) {
                var distSq = this.DistanceSq(points[index], pPoint);
                if(distSq < best)
                    best = distSq;
            }
        }

        return best;
    },

    // Sample a candidate point near the route corridor by parametric t
    // along the polyline arc length, perpendicular offset within the
    // given range (cells from the route center). Returns null if the
    // resulting point is out of bounds. RNG draw count: 2 (matches the
    // 2 Int draws of the uniform-random alternative below, so RNG
    // consumption per attempt is identical regardless of which branch
    // ran — preserves byte-identical determinism for non-ice profiles
    // that take the uniform branch). RCA 2026-06-14 (spine-aware
    // wilderness clearing slot).
    SampleRouteAdjacentPoint: function(pContext, pRadius, pMargin) {
        var corridor = pContext.RouteCorridor;
        var random = pContext.Random;
        var minOff = pRadius + 6;
        var maxOff = pRadius + 12;
        if(!corridor || !corridor.points || corridor.points.length < 2) {
            // Failsafe: drain 2 RNG draws to keep parity then return null.
            random.Float(0, 1);
            random.Int(0, 1);
            return null;
        }
        // Reuse Outcrops' arc-length sampler (same module surface).
        var sampler = MapGen.Layout.Outcrops;
        if(!sampler || !sampler.SampleRoutePoint) {
            random.Float(0, 1);
            random.Int(0, 1);
            return null;
        }

        var t = 0.18 + (random.Float(0, 1) * 0.64);
        var sample = sampler.SampleRoutePoint(corridor.points, t);
        if(!sample) {
            random.Int(0, 1);
            return null;
        }

        var raw = random.Int(0, ((maxOff - minOff) * 2) + 1);
        var offset = minOff + Math.floor(raw / 2);
        if((raw & 1) === 0)
            offset = -offset;

        var px = -sample.tangent.y;
        var py = sample.tangent.x;
        var nlen = Math.sqrt((px * px) + (py * py));
        if(nlen < 1e-6) { px = 1; py = 0; nlen = 1; }
        px /= nlen; py /= nlen;

        var cx = Math.round(sample.point.x + (px * offset));
        var cy = Math.round(sample.point.y + (py * offset));

        if(cx < pMargin + pRadius || cy < pMargin + pRadius ||
            cx > pContext.Width - pMargin - pRadius - 1 ||
            cy > pContext.Height - pMargin - pRadius - 1)
            return null;

        return { x: cx, y: cy };
    },

    BuildWilderness: function(pContext) {
        var desired = pContext.Profile.WildernessClearingCount || 0;
        if(desired <= 0)
            return;

        var random = pContext.Random;
        var margin = 3;
        var minPathClear = Math.max(3, Math.floor(pContext.Profile.MainPathWidth * 1.5));
        var minPathClearSq = minPathClear * minPathClear;
        var attemptsPerSlot = 16;
        var placed = 0;
        // Spine-aware wilderness clearings: when the profile opts in via
        // RouteSpineClustering AND a RouteCorridor polyline exists,
        // alternate slots: even slots sample along the corridor (creating
        // intentional pockets near the route), odd slots stay uniform-
        // random for variety. Odd-slot uniform branch keeps the existing
        // 2-draw cost; even-slot route branch consumes the same 2 draws
        // (Float for t, Int for offset) so total RNG consumption per
        // slot is identical to the legacy path. Profile flag is the only
        // gate — jungle/beach take the legacy uniform-only branch.
        var spineCluster = !!(pContext.Profile && pContext.Profile.RouteSpineClustering);
        var hasCorridor = !!(pContext.RouteCorridor && pContext.RouteCorridor.points && pContext.RouteCorridor.points.length >= 2);
        var routeMode = spineCluster && hasCorridor;

        for(var slot = 0; slot < desired; ++slot) {
            var role = this.WildernessRoles[random.Int(0, this.WildernessRoles.length - 1)];
            var radius = this.RadiusForRole(pContext, role);
            var clusterThisSlot = routeMode && ((slot & 1) === 0);

            for(var attempt = 0; attempt < attemptsPerSlot; ++attempt) {
                var candidate = clusterThisSlot ?
                    this.SampleRouteAdjacentPoint(pContext, radius, margin) :
                    {
                        x: random.Int(margin + radius, pContext.Width - margin - radius - 1),
                        y: random.Int(margin + radius, pContext.Height - margin - radius - 1)
                    };

                if(!candidate)
                    continue;
                if(this.MinPathDistanceSq(pContext, candidate) < minPathClearSq)
                    continue;
                if(!this.CanAdd(pContext, candidate, radius))
                    continue;

                this.Add(pContext, candidate, radius, role, false);
                ++placed;
                break;
            }
        }

        pContext.WildernessClearingsPlaced = placed;
    },

    Build: function(pContext) {
        this.BuildFromAnchors(pContext);
        this.BuildPathClearings(pContext);
        this.BuildWilderness(pContext);
    }
};
