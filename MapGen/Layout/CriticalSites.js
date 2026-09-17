var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// Plans the full set of "must be reachable" map sites before paths are drawn.
// CriticalPoints is empty when this runs; PromoteToCritical is the single
// source of truth that pushes anchor sites and any extra structure clusters
// or pickup spurs that opted in via requireConnected. The resulting payload
// list is stored as pContext.PlannedSites for Features to consume.
MapGen.Layout.CriticalSites = {

    Build: function(pContext) {
        var sites = [];

        if(pContext.Anchors.start)
            sites = this.BuildCampaignSites(pContext);
        else if(pContext.Anchors.teamA)
            sites = this.BuildMultiplayerSites(pContext);

        pContext.PlannedSites = sites;
        this.PromoteToCritical(pContext, sites);
        MapGen.Context.AddLog(pContext, "Planned " + sites.length + " critical sites");
    },

    PromoteToCritical: function(pContext, pSites) {
        for(var index = 0; index < pSites.length; ++index) {
            var site = pSites[index];
            if(!site.requireConnected)
                continue;
            if(this.HasCriticalPoint(pContext, site.point))
                continue;

            pContext.CriticalPoints.push(site.point);
        }
    },

    HasCriticalPoint: function(pContext, pPoint) {
        var points = pContext.CriticalPoints || [];

        for(var index = 0; index < points.length; ++index) {
            if(points[index].x === pPoint.x && points[index].y === pPoint.y)
                return true;
        }

        return false;
    },

    TemplateRadius: function(pTemplate) {
        if(!pTemplate)
            return 1;
        if(pTemplate === "jungle_base" || pTemplate === "barracks")
            return 3;
        if(pTemplate === "bunker" || pTemplate === "hut_cluster" || pTemplate === "supply_hut")
            return 2;
        return 2;
    },

    TemplateApproach: function(pTemplate) {
        if(!pTemplate)
            return 2;
        if(pTemplate === "jungle_base" || pTemplate === "barracks")
            return 3;
        return 2;
    },

    SupportsStructureSites: function(pContext) {
        return !(pContext.Profile &&
            pContext.Profile.TerrainType === Terrain.Types.Jungle &&
            Number(pContext.Profile.TerrainTypeSub || 0) === 1);
    },

    StructureTemplateForObjective: function(pContext) {
        var templates = pContext.Profile.ObjectiveTemplates || [];

        if(!this.SupportsStructureSites(pContext))
            return null;
        if(templates.indexOf("destroy_base") >= 0 || templates.indexOf("destroy_buildings") >= 0)
            return "jungle_base";
        if(templates.indexOf("rescue_hostages") >= 0 || templates.indexOf("civilian_home") >= 0 || templates.indexOf("kidnap_leader") >= 0)
            return "hut_cluster";
        if(templates.indexOf("destroy_factory") >= 0 || templates.indexOf("destroy_computer") >= 0)
            return "bunker";

        return "barracks";
    },

    AnchorSite: function(pAnchor, pKind) {
        return {
            id: pKind,
            point: pAnchor,
            role: pAnchor.role || pKind,
            kind: pKind,
            template: null,
            radius: 1,
            approach: 2,
            requireConnected: true,
            requireSpur: false,
            anchor: true
        };
    },

    ObjectiveSite: function(pContext, pAnchor) {
        var template = this.StructureTemplateForObjective(pContext);

        return {
            id: "objective",
            point: pAnchor,
            role: "objective",
            kind: "objective",
            template: template,
            radius: this.TemplateRadius(template),
            approach: this.TemplateApproach(template),
            requireConnected: true,
            requireSpur: false,
            anchor: true
        };
    },

    SupportSite: function(pContext, pAnchor) {
        if(!this.SupportsStructureSites(pContext)) {
            return {
                id: "support",
                point: pAnchor,
                role: "support",
                kind: "support",
                template: null,
                radius: this.TemplateRadius(null),
                approach: 2,
                requireConnected: true,
                requireSpur: false,
                anchor: true
            };
        }

        // ice_compound layout template promotes the support anchor to a real
        // enemy barracks instead of the default civilian supply_hut. The
        // template just reserved a STRUCTURE rect around this anchor (see
        // [[mapgen_region_intent_v1]]); planting a 7x7 barracks fills the
        // rect's centre with non-boring tiles and gives the compound visible
        // content. supply_hut (radius 2) at the same point would leave the
        // rect mostly empty plain snow.
        var profile = pContext.Profile || {};
        var template = profile.LayoutTemplate === "ice_compound" ? "barracks" : "supply_hut";
        var role = profile.LayoutTemplate === "ice_compound" ? "compound_objective" : "support";

        return {
            id: "support",
            point: pAnchor,
            role: role,
            kind: "support",
            template: template,
            radius: this.TemplateRadius(template),
            approach: 2,
            requireConnected: true,
            requireSpur: false,
            anchor: true
        };
    },

    ChordPoint: function(pStart, pEnd, pFraction, pPerpScale) {
        var dx = pEnd.x - pStart.x;
        var dy = pEnd.y - pStart.y;
        var distance = Math.max(1, Math.sqrt((dx * dx) + (dy * dy)));
        var nx = -dy / distance;
        var ny = dx / distance;

        return {
            x: pStart.x + (dx * pFraction) + (nx * pPerpScale),
            y: pStart.y + (dy * pFraction) + (ny * pPerpScale)
        };
    },

    ClampPoint: function(pContext, pX, pY, pRole) {
        return {
            x: Math.max(2, Math.min(pContext.Width - 3, Math.round(pX))),
            y: Math.max(2, Math.min(pContext.Height - 3, Math.round(pY))),
            role: pRole || ""
        };
    },

    StructureSite: function(pContext, pPoint, pTemplate, pRole) {
        var profile = pContext.Profile || {};
        var mainRoute = profile.ExtraStructureSitesRequireConnected !== undefined ?
            !!profile.ExtraStructureSitesRequireConnected : true;
        var spurRoute = mainRoute ? false :
            profile.ExtraStructureSitesRequireSpur !== false;

        return {
            id: pTemplate + "_" + pPoint.x + "_" + pPoint.y,
            point: pPoint,
            role: pRole,
            kind: "structure",
            template: pTemplate,
            radius: this.TemplateRadius(pTemplate),
            approach: this.TemplateApproach(pTemplate),
            requireConnected: mainRoute,
            requireSpur: spurRoute
        };
    },

    SpurSite: function(pContext, pPoint, pTemplate, pRole) {
        return {
            id: pTemplate + "_" + pPoint.x + "_" + pPoint.y,
            point: pPoint,
            role: pRole,
            kind: "pickup",
            template: pTemplate,
            radius: 1,
            approach: 1,
            requireConnected: false,
            requireSpur: true
        };
    },

    DistanceSq: function(pA, pB) {
        var dx = pA.x - pB.x;
        var dy = pA.y - pB.y;
        return (dx * dx) + (dy * dy);
    },

    WeightedPick: function(pRandom, pWeights, pFallback) {
        var entries = [];
        var total = 0;
        var key;

        for(key in (pWeights || {})) {
            if(!pWeights.hasOwnProperty(key))
                continue;

            var weight = Number(pWeights[key]);
            if(!isFinite(weight) || weight <= 0)
                continue;

            entries.push({ name: key, weight: weight });
            total += weight;
        }

        if(!entries.length || total <= 0)
            return pFallback || null;

        var roll = pRandom.Float(0, total);
        var cumulative = 0;

        for(var index = 0; index < entries.length; ++index) {
            cumulative += entries[index].weight;
            if(roll <= cumulative)
                return entries[index].name;
        }

        return entries[entries.length - 1].name;
    },

    HashUnit: function(pContext, pX, pY, pSalt) {
        return MapGen.Random.HashTile(pContext.Seed || 0, pX || 0, pY || 0, pSalt || 0) / 4294967295;
    },

    IsCampaignRouteSite: function(pContext, pSite) {
        if(!pSite || !pSite.requireSpur || !pSite.point)
            return false;
        if(!(pContext.Anchors && pContext.Anchors.start && pContext.Anchors.objective))
            return false;
        if(pSite.routeLocked || pSite.anchor)
            return false;

        return pSite.kind === "structure" || pSite.kind === "pickup";
    },

    CampaignObjectiveRoute: function(pContext) {
        var paths = pContext.Paths || [];
        var objective = pContext.Anchors ? pContext.Anchors.objective : null;
        var best = null;
        // Distance penalties can make every valid route's score negative.
        var bestScore = -Infinity;

        for(var index = 0; index < paths.length; ++index) {
            var path = paths[index];
            if(!path || !path.points || path.points.length < 6)
                continue;
            if(path.role === "dead_end" || path.role === "repair_critical" || path.role === "spur")
                continue;

            var end = path.points[path.points.length - 1];
            var score = path.points.length;

            if(objective) {
                var dist = this.DistanceSq(end, objective);
                score -= Math.min(9999, dist) * 0.25;
                if(dist <= 4)
                    score += 10000;
            }
            if(path.role === "primary")
                score += 20;
            if(path.role === "secondary")
                score += 30;

            if(score > bestScore) {
                bestScore = score;
                best = path;
            }
        }

        return best;
    },

    RoutePointIndex: function(pPath, pFraction) {
        var points = pPath.points || [];
        if(points.length < 1)
            return 0;

        var minIndex = Math.min(points.length - 1, 3);
        var maxIndex = Math.max(minIndex, points.length - 4);
        var index = Math.round(minIndex + ((maxIndex - minIndex) * pFraction));

        if(index < minIndex)
            index = minIndex;
        if(index > maxIndex)
            index = maxIndex;

        return index;
    },

    RouteTangent: function(pPath, pIndex) {
        var points = pPath.points || [];
        var previous = points[Math.max(0, pIndex - 3)] || points[pIndex];
        var next = points[Math.min(points.length - 1, pIndex + 3)] || points[pIndex];
        var dx = next.x - previous.x;
        var dy = next.y - previous.y;
        var length = Math.max(1, Math.sqrt((dx * dx) + (dy * dy)));

        return {
            x: dx / length,
            y: dy / length
        };
    },

    RouteSidePoint: function(pContext, pPath, pIndex, pSide, pDistance, pRole) {
        var base = pPath.points[pIndex];
        var tangent = this.RouteTangent(pPath, pIndex);
        var nx = -tangent.y;
        var ny = tangent.x;

        return this.ClampPoint(
            pContext,
            base.x + (nx * pSide * pDistance),
            base.y + (ny * pSide * pDistance),
            pRole || "route_site"
        );
    },

    RouteSiteDistance: function(pContext, pSite, pOrder) {
        var profile = pContext.Profile || {};
        var value = pSite.kind === "structure" ?
            profile.RouteStructureSideDistance :
            profile.RoutePickupSideDistance;
        var min = pSite.kind === "structure" ? 6 : 2;
        var max = pSite.kind === "structure" ? 10 : 5;

        if(value instanceof Array && value.length >= 2) {
            min = Number(value[0]);
            max = Number(value[1]);
        } else if(value !== undefined && value !== null) {
            min = Number(value);
            max = min;
        }

        if(isNaN(min))
            min = pSite.kind === "structure" ? 6 : 2;
        if(isNaN(max) || max < min)
            max = min;

        return Math.round(min + ((max - min) * this.HashUnit(pContext, pOrder, pSite.point.y, 3101)));
    },

    RouteSiteConnectable: function(pContext, pPoint, pSite) {
        if(!pSite || !pSite.requireSpur)
            return true;
        if(!MapGen.Connectivity || !MapGen.Connectivity.BuildWalkCost ||
            !MapGen.Connectivity.NearestCorridorPoint || !MapGen.Connectivity.FindPath)
            return true;

        var anchor = MapGen.Connectivity.NearestCorridorPoint(pContext, pPoint);
        if(!anchor)
            return true;

        if(pSite.kind === "structure" && pContext.Profile &&
            pContext.Profile.JungleMazeRouteTopology === true) {
            // The live structure pass owns a short, explicit doorway through
            // maze-tree walls. Admit only candidates within that same local
            // connector budget; forcing ordinary A* to prove reachability here
            // rejects the wall before the doorway can be authored.
            var maxDoorLength = Math.max(3, Math.floor(Number(
                pContext.Profile.JungleMazeStructureDoorMaxLength || 10)));
            var approachAllowance = this.RouteSiteFootprintRadius(pSite) + 1;
            var directDistance = Math.abs(anchor.x - pPoint.x) + Math.abs(anchor.y - pPoint.y);
            if(directDistance <= maxDoorLength + approachAllowance)
                return true;
        }

        var walkCost = pContext._routeSiteWalkCost;
        if(!walkCost) {
            walkCost = MapGen.Connectivity.BuildWalkCost(pContext);
            pContext._routeSiteWalkCost = walkCost;
        }
        if(!MapGen.Layers.InBounds(walkCost, pPoint.x, pPoint.y))
            return false;
        if(walkCost[pPoint.x][pPoint.y] === Infinity)
            return false;

        var previous = walkCost[pPoint.x][pPoint.y];
        MapGen.Connectivity.SetWalkCostCell(
            pContext, walkCost, pPoint.x, pPoint.y, MapGen.Connectivity.Costs.KeepClear);
        var path = MapGen.Connectivity.FindPath(pContext, walkCost, anchor, pPoint, "route_site_connectable");
        MapGen.Connectivity.SetWalkCostCell(pContext, walkCost, pPoint.x, pPoint.y, previous);

        return !!path;
    },

    IsRouteSideCandidate: function(pContext, pPoint, pSite, pSites, pSkipConnectable) {
        var layers = pContext.Layers;
        var profile = pContext.Profile || {};
        var margin = Math.max(3, (pSite.radius || 1) + 1);
        var footprintRadius = this.RouteSiteFootprintRadius(pSite);

        if(pPoint.x < margin || pPoint.y < margin ||
            pPoint.x >= pContext.Width - margin || pPoint.y >= pContext.Height - margin)
            return false;
        if(MapGen.Layers.Get(layers.water, pPoint.x, pPoint.y, 0) ||
            MapGen.Layers.Get(layers.crossing, pPoint.x, pPoint.y, 0) ||
            MapGen.Layers.Get(layers.causeway, pPoint.x, pPoint.y, 0) ||
            MapGen.Layers.Get(layers.occupied, pPoint.x, pPoint.y, 0) ||
            MapGen.Layers.Get(layers.outcrop, pPoint.x, pPoint.y, 0))
            return false;

        if(pSite.kind === "structure") {
            if(MapGen.Layers.Get(layers.path, pPoint.x, pPoint.y, 0) ||
                MapGen.Layers.Get(layers.keepClear, pPoint.x, pPoint.y, 0))
                return false;
        }

        if(!this.RouteSiteFootprintClear(pContext, pPoint, pSite, footprintRadius))
            return false;

        var minAnchorDistance = pSite.kind === "structure" ?
            Math.max(8, Math.floor(Number(profile.MinRouteStructureAnchorDistance || 12))) :
            Math.max(4, Math.floor(Number(profile.MinRoutePickupAnchorDistance || 6)));
        var anchorKeys = ["start", "support", "objective"];
        var anchors = pContext.Anchors || {};

        for(var anchorIndex = 0; anchorIndex < anchorKeys.length; ++anchorIndex) {
            var anchor = anchors[anchorKeys[anchorIndex]];
            if(anchor && this.DistanceSq(anchor, pPoint) < minAnchorDistance * minAnchorDistance)
                return false;
        }

        var minSiteDistance = pSite.kind === "structure" ?
            Math.max(8, Math.floor(Number(profile.MinRouteStructureSiteDistance || 12))) :
            Math.max(4, Math.floor(Number(profile.MinRoutePickupSiteDistance || 5)));
        for(var siteIndex = 0; siteIndex < pSites.length; ++siteIndex) {
            var other = pSites[siteIndex];
            if(!other || other === pSite || !other.point)
                continue;
            if(this.IsCampaignRouteSite(pContext, other) && !other.routePlanned)
                continue;
            if(this.DistanceSq(other.point, pPoint) < minSiteDistance * minSiteDistance)
                return false;
        }

        if(!pSkipConnectable && !this.RouteSiteConnectable(pContext, pPoint, pSite))
            return false;

        return true;
    },

    RouteSiteFootprintRadius: function(pSite) {
        if(!pSite)
            return 1;
        if(pSite.kind === "structure")
            return Math.max(2, Math.floor(pSite.radius || this.TemplateRadius(pSite.template) || 2));
        return Math.max(1, Math.floor(pSite.radius || 1));
    },

    RouteSiteWaterClearance: function(pContext, pSite) {
        if(!pSite || pSite.kind !== "structure")
            return 0;
        if(!MapGen.Integration || !MapGen.Integration.StructureWaterClearance)
            return 0;

        return Math.max(0, Math.floor(MapGen.Integration.StructureWaterClearance(pContext, {
            template: pSite.template,
            kind: pSite.kind,
            role: pSite.role
        }) || 0));
    },

    RouteSiteFootprintClear: function(pContext, pPoint, pSite, pRadius) {
        var layers = pContext.Layers;
        var radius = Math.max(1, Math.floor(pRadius || 1));
        var radiusSq = radius * radius;
        var waterClearance = this.RouteSiteWaterClearance(pContext, pSite);
        var waterRadius = radius + waterClearance;
        var waterRadiusSq = waterRadius * waterRadius;

        for(var x = pPoint.x - waterRadius; x <= pPoint.x + waterRadius; ++x) {
            for(var y = pPoint.y - waterRadius; y <= pPoint.y + waterRadius; ++y) {
                var dx = x - pPoint.x;
                var dy = y - pPoint.y;
                var distSq = (dx * dx) + (dy * dy);

                if(distSq > waterRadiusSq)
                    continue;
                if(x < 0 || y < 0 || x >= pContext.Width || y >= pContext.Height)
                    return false;
                if(waterClearance > 0 &&
                    (MapGen.Layers.Get(layers.water, x, y, 0) ||
                        MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                        MapGen.Layers.Get(layers.causeway, x, y, 0)))
                    return false;
                if(distSq > radiusSq)
                    continue;
                if(MapGen.Layers.Get(layers.water, x, y, 0) ||
                    MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                    MapGen.Layers.Get(layers.causeway, x, y, 0) ||
                    MapGen.Layers.Get(layers.occupied, x, y, 0) ||
                    MapGen.Layers.Get(layers.outcrop, x, y, 0))
                    return false;
                if(pSite.kind === "structure" &&
                    (MapGen.Layers.Get(layers.path, x, y, 0) ||
                        MapGen.Layers.Get(layers.keepClear, x, y, 0)))
                    return false;
            }
        }

        return true;
    },

    ReserveRouteSiteClearing: function(pContext, pSite) {
        if(!pSite || !pSite.point)
            return 0;

        var layers = pContext.Layers;
        var radius = this.RouteSiteFootprintRadius(pSite) + (pSite.kind === "structure" ? 1 : 0);
        var radiusSq = radius * radius;
        var changed = 0;

        for(var x = pSite.point.x - radius; x <= pSite.point.x + radius; ++x) {
            for(var y = pSite.point.y - radius; y <= pSite.point.y + radius; ++y) {
                var dx = x - pSite.point.x;
                var dy = y - pSite.point.y;

                if((dx * dx) + (dy * dy) > radiusSq)
                    continue;
                if(x < 0 || y < 0 || x >= pContext.Width || y >= pContext.Height)
                    continue;
                if(MapGen.Layers.Get(layers.water, x, y, 0) ||
                    MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                    MapGen.Layers.Get(layers.causeway, x, y, 0) ||
                    MapGen.Layers.Get(layers.outcrop, x, y, 0))
                    continue;

                if(!MapGen.Layers.Get(layers.keepClear, x, y, 0))
                    ++changed;
                MapGen.Layers.Set(layers.keepClear, x, y, 1);
                MapGen.Layers.Set(layers.blocked, x, y, 0);
                MapGen.Layers.Set(layers.coast, x, y, 0);
                MapGen.Layers.Set(layers.riverBank, x, y, 0);
                MapGen.Layers.Set(layers.forcedBank, x, y, 0);
                MapGen.Layers.Set(layers.terrainEdge, x, y, 0);
            }
        }

        pSite.routeClearingRadius = radius;
        pSite.routeClearingTiles = changed;
        return changed;
    },

    CountTacticalCoverNear: function(pContext, pPoint, pRadius, pInnerRadius) {
        var layers = pContext.Layers;
        var radius = Math.max(1, Math.floor(pRadius || 1));
        var inner = Math.max(0, Math.floor(pInnerRadius || 0));
        var radiusSq = radius * radius;
        var innerSq = inner * inner;
        var count = 0;

        for(var x = pPoint.x - radius; x <= pPoint.x + radius; ++x) {
            for(var y = pPoint.y - radius; y <= pPoint.y + radius; ++y) {
                var dx = x - pPoint.x;
                var dy = y - pPoint.y;
                var distSq = (dx * dx) + (dy * dy);

                if(distSq > radiusSq || distSq <= innerSq)
                    continue;
                if(x < 0 || y < 0 || x >= pContext.Width || y >= pContext.Height) {
                    ++count;
                    continue;
                }

                if(MapGen.Layers.Get(layers.blocked, x, y, 0) ||
                    MapGen.Layers.Get(layers.water, x, y, 0) ||
                    MapGen.Layers.Get(layers.coast, x, y, 0) ||
                    MapGen.Layers.Get(layers.riverBank, x, y, 0) ||
                    MapGen.Layers.Get(layers.outcrop, x, y, 0)) {
                    ++count;
                }
            }
        }

        return count;
    },

    CountProtectedNear: function(pContext, pPoint, pRadius) {
        var layers = pContext.Layers;
        var radius = Math.max(1, Math.floor(pRadius || 1));
        var radiusSq = radius * radius;
        var count = 0;

        for(var x = pPoint.x - radius; x <= pPoint.x + radius; ++x) {
            for(var y = pPoint.y - radius; y <= pPoint.y + radius; ++y) {
                var dx = x - pPoint.x;
                var dy = y - pPoint.y;
                if((dx * dx) + (dy * dy) > radiusSq)
                    continue;
                if(x < 0 || y < 0 || x >= pContext.Width || y >= pContext.Height)
                    continue;
                if(MapGen.Layers.Get(layers.path, x, y, 0) ||
                    MapGen.Layers.Get(layers.keepClear, x, y, 0))
                    ++count;
            }
        }

        return count;
    },

    RouteSiteQuality: function(pContext, pPoint, pSite, pAnchor, pDesiredDistance, pFraction, pOrder) {
        var profile = pContext.Profile || {};
        var dx = pPoint.x - pAnchor.x;
        var dy = pPoint.y - pAnchor.y;
        var distance = Math.sqrt((dx * dx) + (dy * dy));
        var radius = pSite.kind === "structure" ? 6 : 4;
        var inner = pSite.kind === "structure" ? 2 : 1;
        var cover = this.CountTacticalCoverNear(pContext, pPoint, radius, inner);
        var protectedCells = this.CountProtectedNear(pContext, pPoint, pSite.kind === "structure" ? 3 : 2);
        var desiredCover = pSite.kind === "structure" ?
            Math.max(0, Number(profile.RouteStructureCoverTarget || 18)) :
            Math.max(0, Number(profile.RoutePickupCoverTarget || 8));
        var maxCover = pSite.kind === "structure" ?
            Math.max(desiredCover + 8, Number(profile.RouteStructureMaxCover || 42)) :
            Math.max(desiredCover + 6, Number(profile.RoutePickupMaxCover || 22));
        var score = 100;

        score -= Math.abs(distance - pDesiredDistance) * (pSite.kind === "structure" ? 5 : 3);
        if(cover < desiredCover)
            score -= (desiredCover - cover) * 2.5;
        if(cover > maxCover)
            score -= (cover - maxCover) * 1.5;
        if(pSite.kind === "structure")
            score -= protectedCells * 1.4;
        else
            score -= Math.max(0, protectedCells - 2) * 0.5;

        // Nudge sites away from mechanical exact-phase placement without
        // overriding the phase bands chosen by RouteSiteFraction.
        score += (this.HashUnit(pContext, pPoint.x + pOrder, pPoint.y, 3131) - 0.5) * 3.0;

        pPoint.routeQuality = Math.round(score * 10) / 10;
        pPoint.routeCover = cover;
        pPoint.routeDistance = Math.round(distance * 10) / 10;
        pPoint.routeProtectedCells = protectedCells;
        pPoint.routeFraction = pFraction;
        return pPoint.routeQuality;
    },

    PreferredRouteSiteSide: function(pContext, pSite, pOrder) {
        if(pSite.kind === "structure" &&
            (!pContext.Profile || pContext.Profile.RouteStructureAlternateSides !== false)) {
            var base = (MapGen.Random.HashTile(pContext.Seed || 0, pContext.Width, pContext.Height, 3151) % 2) ? 1 : -1;
            return (pOrder % 2) ? -base : base;
        }

        var sideSeed = MapGen.Random.HashTile(pContext.Seed || 0, pOrder, pSite.point.x, 3111);
        return (sideSeed % 2) === 0 ? 1 : -1;
    },

    RouteSitePhaseBands: function(pContext, pSite) {
        var profile = pContext.Profile || {};
        var value = pSite.kind === "structure" ?
            profile.RouteStructurePhaseBands :
            profile.RoutePickupPhaseBands;

        if(value instanceof Array && value.length)
            return value;

        return null;
    },

    RouteSiteFraction: function(pContext, pSite, pOrder, pCount) {
        var bands = this.RouteSitePhaseBands(pContext, pSite);
        if(bands && bands.length) {
            var band = bands[pOrder % bands.length];
            if(band instanceof Array && band.length >= 2) {
                var min = Number(band[0]);
                var max = Number(band[1]);
                if(!isNaN(min) && !isNaN(max)) {
                    if(max < min) {
                        var swap = min;
                        min = max;
                        max = swap;
                    }
                    var slots = Math.max(1, Math.ceil(pCount / bands.length));
                    var slot = Math.floor(pOrder / bands.length);
                    var t = pCount <= bands.length ? 0.5 : (slot + 1) / (slots + 1);
                    var jitter = (this.HashUnit(pContext, pOrder, pCount, 3141) - 0.5) * 0.04;
                    var value = min + ((max - min) * t) + jitter;
                    return Math.max(0.08, Math.min(0.94, value));
                }
            }
        }

        var base = (pOrder + 1) / (pCount + 1);

        if(pSite.kind === "structure")
            return 0.28 + (base * 0.56);

        return 0.18 + (base * 0.64);
    },

    RouteSiteFallbackPoint: function(pContext, pPath, pIndex, pSite, pSites) {
        if(pSite.kind !== "pickup")
            return null;

        var anchor = pPath.points[pIndex];
        var point = this.ClampPoint(
            pContext,
            anchor.x,
            anchor.y,
            pSite.role || "route_pickup"
        );

        if(this.IsRouteSideCandidate(pContext, point, pSite, pSites)) {
            point.routeAnchor = { x: anchor.x, y: anchor.y };
            this.RouteSiteQuality(pContext, point, pSite, anchor, 0, pIndex / Math.max(1, (pPath.points.length - 1)), 0);
            return point;
        }

        return null;
    },

    FindRouteNeighbourSitePoint: function(pContext, pPath, pIndex, pSite, pOrder, pSites) {
        var base = pPath.points[pIndex];
        var minRadius = pSite.kind === "structure" ? 4 : 2;
        var maxRadius = pSite.kind === "structure" ? 15 : 7;
        var angleSeed = this.HashUnit(pContext, base.x + pOrder, base.y, 3121) * Math.PI * 2.0;

        for(var radius = minRadius; radius <= maxRadius; ++radius) {
            var samples = Math.max(8, radius * 2);
            for(var sample = 0; sample < samples; ++sample) {
                var angle = angleSeed + ((sample / samples) * Math.PI * 2.0);
                var point = this.ClampPoint(
                    pContext,
                    base.x + Math.cos(angle) * radius,
                    base.y + Math.sin(angle) * radius,
                    pSite.role || "route_site"
                );

                if(this.IsRouteSideCandidate(pContext, point, pSite, pSites)) {
                    point.routeAnchor = { x: base.x, y: base.y };
                    point.routeOffset = radius;
                    this.RouteSiteQuality(
                        pContext,
                        point,
                        pSite,
                        base,
                        radius,
                        pIndex / Math.max(1, (pPath.points.length - 1)),
                        pOrder
                    );
                    return point;
                }
            }
        }

        return null;
    },

    FindRouteSideSitePoint: function(pContext, pPath, pSite, pOrder, pCount, pSites) {
        var fraction = this.RouteSiteFraction(pContext, pSite, pOrder, pCount);
        var baseIndex = this.RoutePointIndex(pPath, fraction);
        var baseDistance = this.RouteSiteDistance(pContext, pSite, pOrder);
        var preferredSide = this.PreferredRouteSiteSide(pContext, pSite, pOrder);
        var offsets = [0, -4, 4, -8, 8, -12, 12, -16, 16];
        // Widened distance ladder: structures on water-heavy ice maps frequently
        // need to sit further off the route to find a clear footprint (clear of
        // water/other sites). The old ladder topped out at baseDistance+4, so when
        // baseDistance was small the search couldn't reach a viable spot and the
        // site failed -> full map re-roll. Most campaign-ice retry churn (and the
        // batch timeouts) traced to this. We add reach but CLAMP to the validator's
        // MaxRouteSideSiteDistance (default 18) so we don't trade a placement
        // failure for a campaign_route_site_too_far failure. Same candidate gate,
        // so this only changes how far we LOOK, never where a site may legally go.
        var maxSideDistance = pContext.Profile && pContext.Profile.MaxRouteSideSiteDistance !== undefined ?
            Math.max(1, Number(pContext.Profile.MaxRouteSideSiteDistance) || 18) : 18;
        var distances = [];
        var distanceLadder = [
            baseDistance,
            baseDistance + 2,
            Math.max(2, baseDistance - 2),
            baseDistance + 4,
            baseDistance + 6,
            baseDistance + 9,
            baseDistance + 12
        ];
        for(var ladderIndex = 0; ladderIndex < distanceLadder.length; ++ladderIndex) {
            if(distanceLadder[ladderIndex] <= maxSideDistance)
                distances.push(distanceLadder[ladderIndex]);
        }
        if(!distances.length)
            distances.push(Math.min(baseDistance, maxSideDistance));
        var candidates = [];

        for(var oi = 0; oi < offsets.length; ++oi) {
            var index = baseIndex + offsets[oi];
            if(index < 2 || index >= pPath.points.length - 2)
                continue;

            for(var di = 0; di < distances.length; ++di) {
                for(var si = 0; si < 2; ++si) {
                    var side = si === 0 ? preferredSide : -preferredSide;
                    var point = this.RouteSidePoint(
                        pContext,
                        pPath,
                        index,
                        side,
                        distances[di],
                        pSite.role || "route_site"
                    );

                    if(this.IsRouteSideCandidate(pContext, point, pSite, pSites, true)) {
                        var anchor = pPath.points[index];
                        point.routeAnchor = {
                            x: anchor.x,
                            y: anchor.y
                        };
                        point.routeOffset = distances[di] * side;
                        point.routeIndex = index;

                        var score = this.RouteSiteQuality(
                            pContext,
                            point,
                            pSite,
                            anchor,
                            distances[di],
                            fraction,
                            pOrder
                        );

                        candidates.push(point);
                    }
                }
            }
        }

        if(candidates.length) {
            candidates.sort(function(pLeft, pRight) {
                if(pLeft.routeQuality !== pRight.routeQuality)
                    return pRight.routeQuality - pLeft.routeQuality;
                if(pLeft.routeIndex !== pRight.routeIndex)
                    return pLeft.routeIndex - pRight.routeIndex;
                // Opposite sides of the same route can have equal quality and
                // distance. Both native runtimes must choose the same site.
                return Math.abs(pLeft.routeOffset || 0) - Math.abs(pRight.routeOffset || 0) ||
                    pLeft.x - pRight.x || pLeft.y - pRight.y ||
                    (pLeft.routeOffset || 0) - (pRight.routeOffset || 0);
            });

            var profile = pContext.Profile || {};
            var maxConnectProbes = Math.max(1, Math.floor(Number(profile.RouteSiteConnectProbeLimit || 32)));
            for(var candidateIndex = 0; candidateIndex < candidates.length && candidateIndex < maxConnectProbes; ++candidateIndex) {
                if(this.RouteSiteConnectable(pContext, candidates[candidateIndex], pSite))
                    return candidates[candidateIndex];
            }
        }

        var neighbour = this.FindRouteNeighbourSitePoint(pContext, pPath, baseIndex, pSite, pOrder, pSites);
        if(neighbour)
            return neighbour;

        return this.RouteSiteFallbackPoint(pContext, pPath, baseIndex, pSite, pSites);
    },

    ApplyRouteSitePoint: function(pContext, site, point, route) {
        site.originalPoint = {
            x: site.point.x,
            y: site.point.y
        };
        site.point = point;
        site.routePlanned = true;
        site.routeSource = route.role || "route";
        site.routeFraction = point.routeFraction;
        site.routeAnchor = point.routeAnchor;
        site.routeOffset = point.routeOffset || 0;
        site.routeIndex = point.routeIndex;
        site.routeQuality = point.routeQuality;
        site.routeCover = point.routeCover;
        site.routeDistance = point.routeDistance;
        site.routeProtectedCells = point.routeProtectedCells;
        site.originalId = site.id;
        site.id = site.template + "_" + site.point.x + "_" + site.point.y;
        var protectedTiles = this.ReserveRouteSiteClearing(pContext, site);
        pContext._routeSiteWalkCost = null;
        return protectedTiles;
    },

    RepositionRouteSpurSites: function(pContext) {
        var sites = pContext.PlannedSites || [];
        var route = this.CampaignObjectiveRoute(pContext);
        var movable = [];

        if(!route || !route.points || route.points.length < 8)
            return 0;

        for(var index = 0; index < sites.length; ++index) {
            if(this.IsCampaignRouteSite(pContext, sites[index]))
                movable.push(sites[index]);
        }

        if(!movable.length)
            return 0;

        var moved = 0;
        var failed = 0;
        var missing = [];
        var protectedTiles = 0;
        var kindCounts = {};
        var kindOrders = {};

        for(var countIndex = 0; countIndex < movable.length; ++countIndex) {
            var kind = movable[countIndex].kind || "site";
            if(!kindCounts[kind])
                kindCounts[kind] = 0;
            ++kindCounts[kind];
        }

        for(var moveIndex = 0; moveIndex < movable.length; ++moveIndex) {
            var site = movable[moveIndex];
            var siteKind = site.kind || "site";
            if(!kindOrders[siteKind])
                kindOrders[siteKind] = 0;
            var kindOrder = kindOrders[siteKind]++;
            var point = this.FindRouteSideSitePoint(pContext, route, site, kindOrder, kindCounts[siteKind], sites);
            var siteRoute = route;

            // Required support branches are part of the playable route too.
            // Use them when the objective leg has no legal room for a site.
            if(!point) {
                var paths = pContext.Paths || [];
                for(var pathIndex = 0; pathIndex < paths.length && !point; ++pathIndex) {
                    var branch = paths[pathIndex];
                    if(branch === route || !branch.points || branch.points.length < 8 ||
                        (branch.role !== "primary" && branch.role !== "secondary" && branch.role !== "regional_branch"))
                        continue;
                    point = this.FindRouteSideSitePoint(pContext, branch, site,
                        kindOrder, kindCounts[siteKind], sites);
                    if(point)
                        siteRoute = branch;
                }
            }

            if(!point) {
                missing.push({site: site, order: kindOrder, count: kindCounts[siteKind]});
                site.routePlanFailed = true;
                ++failed;
                continue;
            }

            protectedTiles += this.ApplyRouteSitePoint(pContext, site, point, siteRoute);
            ++moved;
        }

        // Spend one shared rescue budget per layout. Later attempts get a
        // smaller budget: one missing footprint should not automatically force
        // another complete map. Dense search checks the same eligible branches used
        // by the fast pass, so a failed site can be repaired onto a concrete
        // alternate route without changing any validation thresholds. Each
        // route receives a fair slice of the shared budget; unused work is
        // carried forward to the next route/site.
        if(failed && MapGen.Layout.RouteSiteSearch) {
            var firstAttempt = (pContext.Attempt || 0) === 0;
            var rescueBudget = {checksLeft: firstAttempt ? 4096 : 1024, probesLeft: firstAttempt ? 32 : 8};
            var planner = this;
            MapGen.Context.Time(pContext, "Layout.RouteSiteSearch", function() {
                for(var missingIndex = 0; missingIndex < missing.length &&
                    rescueBudget.checksLeft > 0 && rescueBudget.probesLeft > 0; ++missingIndex) {
                    var pending = missing[missingIndex];
                    var searchRoutes = [route];
                    var paths = pContext.Paths || [];
                    for(var pathIndex = 0; pathIndex < paths.length; ++pathIndex) {
                        var branch = paths[pathIndex];
                        if(branch === route || !branch.points || branch.points.length < 8 ||
                            (branch.role !== "primary" && branch.role !== "secondary" && branch.role !== "regional_branch"))
                            continue;
                        searchRoutes.push(branch);
                    }

                    for(var searchIndex = 0; searchIndex < searchRoutes.length &&
                        rescueBudget.checksLeft > 0 && rescueBudget.probesLeft > 0; ++searchIndex) {
                        var routesLeft = searchRoutes.length - searchIndex;
                        var searchesLeft = (missing.length - missingIndex) * routesLeft;
                        var allocatedChecks = Math.max(1, Math.ceil(rescueBudget.checksLeft / searchesLeft));
                        var allocatedProbes = Math.max(1, Math.ceil(rescueBudget.probesLeft / searchesLeft));
                        var searchBudget = {checksLeft: allocatedChecks, probesLeft: allocatedProbes};
                        var recovered = MapGen.Layout.RouteSiteSearch.Find(
                            pContext, searchRoutes[searchIndex], pending.site,
                            pending.order, pending.count, sites, searchBudget);
                        var remainingChecks = Number(searchBudget.checksLeft);
                        var remainingProbes = Number(searchBudget.probesLeft);
                        rescueBudget.checksLeft = Math.max(0,
                            rescueBudget.checksLeft - (allocatedChecks - remainingChecks));
                        rescueBudget.probesLeft = Math.max(0,
                            rescueBudget.probesLeft - (allocatedProbes - remainingProbes));
                        if(!recovered)
                            continue;
                        pending.site.routePlanFailed = false;
                        protectedTiles += planner.ApplyRouteSitePoint(
                            pContext, pending.site, recovered, searchRoutes[searchIndex]);
                        ++moved;
                        --failed;
                        break;
                    }
                }
            });
        }

        var minQuality = null;
        var totalQuality = 0;
        var qualityCount = 0;
        for(var qualityIndex = 0; qualityIndex < movable.length; ++qualityIndex) {
            if(movable[qualityIndex].routeQuality === undefined)
                continue;
            if(minQuality === null || movable[qualityIndex].routeQuality < minQuality)
                minQuality = movable[qualityIndex].routeQuality;
            totalQuality += movable[qualityIndex].routeQuality;
            ++qualityCount;
        }

        pContext.RouteSitePlan = {
            denseSearch: pContext.RouteSiteSearch || null,
            moved: moved,
            failed: failed,
            routeRole: route.role || "route",
            routeLength: route.points.length,
            protectedTiles: protectedTiles,
            minQuality: minQuality,
            averageQuality: qualityCount ? Math.round((totalQuality / qualityCount) * 10) / 10 : null
        };

        if(moved || failed)
            MapGen.Context.AddLog(pContext, "Route-side campaign sites moved " + moved + " failed " + failed);

        return moved;
    },

    ObjectiveMarkerSite: function(pContext, pPoint, pTemplate, pRole, pVirtual) {
        return {
            id: pTemplate + "_" + pRole + "_" + pPoint.x + "_" + pPoint.y,
            point: pPoint,
            role: pRole,
            kind: "objective_marker",
            template: pTemplate,
            radius: 1,
            approach: 2,
            requireConnected: true,
            requireSpur: false,
            virtual: !!pVirtual
        };
    },

    IsRescuePrisoner: function(pContext) {
        return pContext.Profile && pContext.Profile.ObjectiveType === "rescue_prisoner";
    },

    HasObjectiveTemplate: function(pContext, pTemplate) {
        var templates = pContext.Profile.ObjectiveTemplates || [];

        for(var index = 0; index < templates.length; ++index) {
            if(templates[index] === pTemplate)
                return true;
        }

        return false;
    },

    AddCampaignObjectiveMarkers: function(pContext, pSites) {
        var anchors = pContext.Anchors;

        if(this.HasObjectiveTemplate(pContext, "rescue_hostages")) {
            if(anchors.objective) {
                pSites.push(this.ObjectiveMarkerSite(
                    pContext,
                    anchors.objective,
                    "hostage_group",
                    "hostage",
                    true
                ));
            }

            if(anchors.support || anchors.start) {
                pSites.push(this.ObjectiveMarkerSite(
                    pContext,
                    anchors.support || anchors.start,
                    "rescue_tent",
                    "rescue_tent",
                    true
                ));
            }
        }

        if(this.HasObjectiveTemplate(pContext, "civilian_home")) {
            if(anchors.objective) {
                pSites.push(this.ObjectiveMarkerSite(
                    pContext,
                    anchors.objective,
                    "civilian",
                    "civilian",
                    true
                ));
            }

            if(anchors.support || anchors.objective) {
                pSites.push(this.ObjectiveMarkerSite(
                    pContext,
                    anchors.support || anchors.objective,
                    "civilian_home",
                    "civilian_home",
                    true
                ));
            }
        }
    },

    DesiredCampaignStructures: function(pContext) {
        var requested = Math.max(0, Math.floor(pContext.Profile.StructureClusters || 0));

        // Objective already counts as one structure cluster
        return Math.max(0, requested - 1);
    },

    DesiredCampaignSpurs: function(pContext) {
        var profileCount = pContext.Profile && pContext.Profile.CampaignSpurCount;
        if(profileCount !== undefined && profileCount !== null && !isNaN(Number(profileCount)))
            return Math.max(0, Math.floor(Number(profileCount)));

        var area = pContext.Width * pContext.Height;
        var density = Math.max(1, Math.min(4, Math.floor(area / 1800)));

        return density;
    },

    StructureTemplateChoice: function(pContext, pIndex) {
        var random = pContext.Random;
        var weights = pContext.Profile ? pContext.Profile.RouteStructureTemplateWeights || null : null;
        var pool = ["bunker", "hut_cluster", "supply_hut"];

        if(weights)
            return this.WeightedPick(random, weights, "bunker");

        if(pIndex === 0)
            return random.Chance(0.5) ? "bunker" : "hut_cluster";

        return pool[random.Int(0, pool.length - 1)];
    },

    PickupTemplateChoice: function(pContext, pIndex) {
        var templates = pContext.Profile ? pContext.Profile.RoutePickupTemplates || null : null;
        if(templates instanceof Array && templates.length)
            return templates[pIndex % templates.length];

        if(pIndex % 3 === 0)
            return "grenades";
        if(pIndex % 3 === 1)
            return "ammo";

        return "rockets";
    },

    InitialRouteSitePoint: function(pContext, pKind, pOrder, pCount, pRole) {
        var anchors = pContext.Anchors;
        var random = pContext.Random;
        var site = {
            kind: pKind,
            point: anchors.objective || anchors.support || anchors.start || { x: 0, y: 0 }
        };
        var fraction = this.RouteSiteFraction(pContext, site, pOrder, Math.max(1, pCount));
        var routePlanner = MapGen.Layout && MapGen.Layout.RouteArchetypes ?
            MapGen.Layout.RouteArchetypes :
            null;

        if(routePlanner && routePlanner.SidePoint) {
            var routePoint = routePlanner.SidePoint(
                pContext,
                fraction,
                this.PreferredRouteSiteSide(pContext, site, pOrder),
                this.RouteSiteDistance(pContext, site, pOrder),
                pRole || "route_site"
            );
            if(routePoint)
                return routePoint;
        }

        var profile = pContext.Profile || {};
        var perpReach = Math.min(pContext.Width, pContext.Height);
        var baseDistance = pKind === "structure" ?
            (profile.RouteStructureSideDistance || [6, 10]) :
            (profile.RoutePickupSideDistance || [2, 5]);
        var distance;

        if(baseDistance instanceof Array && baseDistance.length >= 2)
            distance = random.Int(Math.floor(baseDistance[0]), Math.floor(baseDistance[1]));
        else
            distance = Math.max(2, Math.floor(Number(baseDistance) || (pKind === "structure" ? 8 : 4)));

        var perpSign = random.Chance(0.5) ? 1 : -1;
        var perpScale = perpSign * Math.min(perpReach * 0.20, distance + random.Int(1, 5));
        var raw = this.ChordPoint(anchors.start, anchors.objective, fraction, perpScale);

        return this.ClampPoint(pContext, raw.x, raw.y, pRole || "route_site");
    },

    // Region-intent payload from a layout template's BuildRegionIntents (e.g.
    // ice_compound). Reservation alone produced a hole of plain snow tiles —
    // see [[mapgen_region_intent_v1]]. Pairing the reservation with extra
    // structure sites at the rect corners turns the reserved pocket into a
    // *populated* compound, which is the macro composition the metric is
    // actually trying to measure.
    //
    // The extra sites:
    //   - are emitted as `bunker` (radius 2) so they fit inside the 11x9 rect
    //     alongside the support's supply_hut without collision,
    //   - sit at the rect's two long-axis corners offset 1 inward,
    //   - require neither route nor spur connection (they're inside the
    //     already-reachable support pocket; insisting on connection just adds
    //     repair work for sites that are by construction reachable),
    //   - cost a fixed number of RNG draws (zero — coordinates are derived
    //     from the rect, no Random.* calls), so the determinism contract for
    //     fixed-draw budgets per template is preserved.
    AddRegionIntentSites: function(pContext, pSites) {
        var intents = pContext.RegionIntents;
        if(!intents || !intents.compound || !intents.compound.rect)
            return;

        var rect = intents.compound.rect;
        var width = rect.maxX - rect.minX + 1;
        var height = rect.maxY - rect.minY + 1;
        if(width < 7 || height < 5)
            return;

        // Place corners at the rect's diagonal extremes (not inset). The
        // bunker footprint then straddles the STRUCTURE-claimed boundary,
        // which lets the live placement validator's halo annulus reach into
        // natural (tree-able) terrain outside the rect — without that the
        // halo annulus is dominated by reserved snow and the validator's
        // MinStructureContextCoverFraction check rejects every candidate.
        var landscape = width >= height;
        var pointA, pointB;

        if(landscape) {
            pointA = this.ClampPoint(pContext, rect.minX, rect.minY, "compound_corner");
            pointB = this.ClampPoint(pContext, rect.maxX, rect.maxY, "compound_corner");
        }
        else {
            pointA = this.ClampPoint(pContext, rect.minX, rect.maxY, "compound_corner");
            pointB = this.ClampPoint(pContext, rect.maxX, rect.minY, "compound_corner");
        }

        var siteA = this.StructureSite(pContext, pointA, "bunker", "compound_outpost");
        siteA.requireConnected = false;
        siteA.requireSpur = false;
        siteA.regionIntent = "compound";
        // The corner outposts sit ~4 cells from the support's supply_hut
        // (intentionally — that's a clustered compound). The default bunker
        // template minDistance=8 would reject them; override to 3 (still
        // enough to keep the two corners + the support from overlapping
        // their footprints). See [[mapgen_region_intent_v1]].
        siteA.minDistanceOverride = 3;
        pSites.push(siteA);

        var siteB = this.StructureSite(pContext, pointB, "bunker", "compound_outpost");
        siteB.requireConnected = false;
        siteB.requireSpur = false;
        siteB.regionIntent = "compound";
        siteB.minDistanceOverride = 3;
        pSites.push(siteB);

        MapGen.Context.AddLog(
            pContext,
            "Region-intent compound: 2 corner sites at (" +
            pointA.x + "," + pointA.y + ") and (" +
            pointB.x + "," + pointB.y + ")"
        );
    },

    BuildCampaignSites: function(pContext) {
        var anchors = pContext.Anchors;
        var random = pContext.Random;
        var sites = [];

        if(anchors.start)
            sites.push(this.AnchorSite(anchors.start, "player_start"));
        if(anchors.support)
            sites.push(this.SupportSite(pContext, anchors.support));
        if(anchors.objective)
            sites.push(this.ObjectiveSite(pContext, anchors.objective));

        this.AddCampaignObjectiveMarkers(pContext, sites);
        this.AddRegionIntentSites(pContext, sites);

        if(!anchors.start || !anchors.objective)
            return sites;

        var structures = this.DesiredCampaignStructures(pContext);

        for(var index = 0; index < structures; ++index) {
            var point = this.InitialRouteSitePoint(
                pContext,
                "structure",
                index,
                structures,
                index % 2 ? "checkpoint" : "ambush_pocket"
            );
            var template = this.StructureTemplateChoice(pContext, index);

            sites.push(this.StructureSite(pContext, point, template, point.role || "ambush_pocket"));
        }

        var spurs = this.DesiredCampaignSpurs(pContext);

        for(var spurIndex = 0; spurIndex < spurs; ++spurIndex) {
            var spurPoint = this.InitialRouteSitePoint(
                pContext,
                "pickup",
                spurIndex,
                spurs,
                "spur_pickup"
            );
            var template = this.PickupTemplateChoice(pContext, spurIndex);

            sites.push(this.SpurSite(pContext, spurPoint, template, "route_pickup"));
        }

        return sites;
    },

    BuildMultiplayerSites: function(pContext) {
        var anchors = pContext.Anchors;
        var sites = [];

        if(anchors.teamA)
            sites.push(this.AnchorSite(anchors.teamA, "team_a_start"));
        if(anchors.contested) {
            if(this.IsRescuePrisoner(pContext))
                sites.push(this.ObjectiveMarkerSite(pContext, anchors.contested, "prisoner", "prisoner"));
            else
                sites.push(this.AnchorSite(anchors.contested, "contested"));
        }
        if(anchors.teamB)
            sites.push(this.AnchorSite(anchors.teamB, "team_b_start"));

        if(!anchors.teamA || !anchors.teamB)
            return sites;

        var perpReach = Math.min(pContext.Width, pContext.Height);
        var extractionOffset = perpReach * 0.10;

        if(this.IsRescuePrisoner(pContext)) {
            var extractionA = this.ChordPoint(anchors.teamA, anchors.teamB, 0.10, extractionOffset);
            var extractionB = this.ChordPoint(anchors.teamA, anchors.teamB, 0.90, -extractionOffset);

            sites.push(this.ObjectiveMarkerSite(
                pContext,
                this.ClampPoint(pContext, extractionA.x, extractionA.y, "team_a_extraction"),
                "extraction_zone",
                "team_a_extraction"
            ));
            sites.push(this.ObjectiveMarkerSite(
                pContext,
                this.ClampPoint(pContext, extractionB.x, extractionB.y, "team_b_extraction"),
                "extraction_zone",
                "team_b_extraction"
            ));
        }

        var sideTargets = [
            { fraction: 0.40, sign: 1, role: "team_a_route", template: "ammo" },
            { fraction: 0.40, sign: -1, role: "team_b_route", template: "ammo" },
            { fraction: 0.65, sign: 1, role: "team_a_contested", template: "grenades" },
            { fraction: 0.65, sign: -1, role: "team_b_contested", template: "grenades" }
        ];

        for(var index = 0; index < sideTargets.length; ++index) {
            var target = sideTargets[index];
            var raw = this.ChordPoint(anchors.teamA, anchors.teamB, target.fraction, target.sign * perpReach * 0.18);
            var point = this.ClampPoint(pContext, raw.x, raw.y, target.role);

            sites.push(this.SpurSite(pContext, point, target.template, target.role));
        }

        return sites;
    }
};
