var MapGen = MapGen || {};
MapGen.Features = MapGen.Features || {};

// Feature modules are loaded from the same folder as this index and the host
// does not promise directory ordering. Preserve modules which happened to be
// evaluated first; replacing the namespace here used to silently discard
// Bridges and CliffHelicopter on some filesystems.
var MapGenPreloadedFeatureModules = MapGen.Features;

// Features turns the abstract Layout.PlannedSites into concrete placements:
// structures, objective markers, and pickups. All "what goes where" decisions
// happen during Layout/CriticalSites; this module is purely materialization
// plus the per-objective-template emission that game logic needs.
MapGen.Features = {

    Templates: {
        hut_cluster: {
            radius: 2,
            approach: 2,
            minDistance: 8,
            guardCount: 1,
            entrance: "nearest_path",
            buildingMix: [
                { building: "hut", sprite: "civilian", weight: 3 },
                { building: "hut", sprite: "civilian_spear", weight: 1 }
            ]
        },

        jungle_base: {
            radius: 3,
            approach: 3,
            minDistance: 10,
            guardCount: 3,
            entrance: "nearest_path",
            buildingMix: [
                { building: "barracks", sprite: "soldier", weight: 3 },
                { building: "bunker", sprite: "soldier_heavy_explosion_only", weight: 1 }
            ]
        },

        barracks: {
            radius: 3,
            approach: 3,
            minDistance: 9,
            guardCount: 2,
            entrance: "nearest_path",
            buildingMix: [
                { building: "barracks", sprite: "soldier", weight: 1 }
            ]
        },

        bunker: {
            radius: 2,
            approach: 3,
            minDistance: 8,
            guardCount: 2,
            entrance: "nearest_path",
            buildingMix: [
                { building: "bunker", sprite: "soldier_heavy_explosion_only", weight: 1 }
            ]
        },

        supply_hut: {
            radius: 2,
            approach: 2,
            minDistance: 7,
            guardCount: 1,
            entrance: "nearest_path",
            buildingMix: [
                { building: "hut", sprite: "civilian", weight: 1 }
            ]
        }
    },

    DistanceSq: function(pA, pB) {
        var dx = pA.x - pB.x;
        var dy = pA.y - pB.y;
        return (dx * dx) + (dy * dy);
    },

    ClonePoint: function(pPoint) {
        return { x: pPoint.x, y: pPoint.y };
    },

    IsInsideClearing: function(pClearing, pPoint) {
        return this.DistanceSq(pClearing, pPoint) <= pClearing.radius * pClearing.radius;
    },

    IsAreaFree: function(pContext, pPoint, pRadius) {
        for(var x = pPoint.x - pRadius; x <= pPoint.x + pRadius; ++x) {
            for(var y = pPoint.y - pRadius; y <= pPoint.y + pRadius; ++y) {
                if(!MapGen.Layers.InBounds(pContext.Layers.occupied, x, y))
                    return false;
                if(MapGen.Layers.Get(pContext.Layers.occupied, x, y, 0))
                    return false;
                if(MapGen.Layout.Reservations.At(pContext,x,y) & MapGen.Layout.Reservations.FLOOR)
                    return false;
                if(MapGen.Layers.Get(pContext.Layers.water, x, y, 0) &&
                    !MapGen.Layers.Get(pContext.Layers.keepClear, x, y, 0) &&
                    !MapGen.Layers.Get(pContext.Layers.path, x, y, 0)) {
                    return false;
                }
            }
        }

        return true;
    },

    PlacementGroups: function(pContext) {
        return [
            pContext.Placements.players,
            pContext.Placements.teams,
            pContext.Placements.enemies,
            pContext.Placements.objectives,
            pContext.Placements.structures,
            pContext.Placements.pickups,
            pContext.Placements.vehicles
        ];
    },

    TooCloseToExisting: function(pContext, pPoint, pDistance) {
        if(!pDistance)
            return false;

        var minDistanceSq = pDistance * pDistance;
        var groups = this.PlacementGroups(pContext);

        for(var groupIndex = 0; groupIndex < groups.length; ++groupIndex) {
            var group = groups[groupIndex] || [];
            for(var index = 0; index < group.length; ++index) {
                if(group[index].point && this.DistanceSq(group[index].point, pPoint) < minDistanceSq)
                    return true;
            }
        }

        return this.TooCloseToAnchors(pContext, pPoint, pDistance);
    },

    TooCloseToAnchors: function(pContext, pPoint, pDistance) {
        var anchors = pContext.Anchors || {};
        var minDistanceSq = pDistance * pDistance;
        var keys = ["start", "teamA", "teamB"];

        for(var index = 0; index < keys.length; ++index) {
            var anchor = anchors[keys[index]];
            if(anchor && this.DistanceSq(anchor, pPoint) < minDistanceSq)
                return true;
        }

        return false;
    },

    CanPlaceAt: function(pContext, pPoint, pRadius, pMinDistance) {
        if(!MapGen.Metrics.IsWalkable(pContext, pPoint.x, pPoint.y))
            return false;
        if(!this.IsAreaFree(pContext, pPoint, pRadius))
            return false;
        if(this.TooCloseToExisting(pContext, pPoint, pMinDistance || 0))
            return false;

        return true;
    },

    CandidateInClearing: function(pContext, pClearing, pRadius, pMinDistance) {
        var random = pContext.Random;
        var attempts = 72;

        for(var attempt = 0; attempt < attempts; ++attempt) {
            var angle = random.Float(0, Math.PI * 2);
            var distance = random.Float(0, Math.max(1, pClearing.radius - pRadius));
            var point = {
                x: Math.round(pClearing.x + Math.cos(angle) * distance),
                y: Math.round(pClearing.y + Math.sin(angle) * distance)
            };

            if(!this.IsInsideClearing(pClearing, point))
                continue;
            if(!this.CanPlaceAt(pContext, point, pRadius, pMinDistance))
                continue;

            return point;
        }

        return null;
    },

    CandidateNearPoint: function(pContext, pPoint, pRadius, pMinDistance) {
        if(this.CanPlaceAt(pContext, pPoint, pRadius, pMinDistance))
            return this.ClonePoint(pPoint);

        for(var distance = 1; distance <= 6; ++distance) {
            var offsets = [
                { x: distance, y: 0 },
                { x: -distance, y: 0 },
                { x: 0, y: distance },
                { x: 0, y: -distance },
                { x: distance, y: distance },
                { x: -distance, y: distance },
                { x: distance, y: -distance },
                { x: -distance, y: -distance }
            ];

            for(var index = 0; index < offsets.length; ++index) {
                var candidate = {
                    x: Math.max(1, Math.min(pContext.Width - 2, pPoint.x + offsets[index].x)),
                    y: Math.max(1, Math.min(pContext.Height - 2, pPoint.y + offsets[index].y))
                };

                if(this.CanPlaceAt(pContext, candidate, pRadius, pMinDistance))
                    return candidate;
            }
        }

        return null;
    },

    ReservePlacement: function(pContext, pPlacement) {
        var point = pPlacement.point;
        var radius = pPlacement.radius || 1;
        var approachRadius = radius + (pPlacement.approach || 1);

        MapGen.Layers.StampDisc(pContext.Layers.occupied, point.x, point.y, radius, pPlacement.kind || 1);
        MapGen.Layers.StampDisc(pContext.Layers.keepClear, point.x, point.y, approachRadius, 1);
        // Architecture v3: a structure footprint claims STRUCTURE ownership so
        // later terrain fill leaves the building and its pad clear.
        if(pContext.Layers.owner) {
            var r2 = radius * radius;
            for(var sx = point.x - radius; sx <= point.x + radius; ++sx) {
                for(var sy = point.y - radius; sy <= point.y + radius; ++sy) {
                    var dx = sx - point.x, dy = sy - point.y;
                    if((dx * dx) + (dy * dy) <= r2)
                        MapGen.Layers.ClaimCell(pContext.Layers.owner, sx, sy, MapGen.Layers.Owner.STRUCTURE);
                }
            }
        }
    },

    AddPlacement: function(pContext, pGroup, pPlacement) {
        this.ReservePlacement(pContext, pPlacement);
        pContext.Placements[pGroup].push(pPlacement);
        return pPlacement;
    },

    TemplateInfo: function(pTemplate) {
        return this.Templates[pTemplate] || this.Templates.hut_cluster;
    },

    NearestPathPoint: function(pContext, pPoint) {
        var best = null;
        var bestDistance = 0x7FFFFFFF;

        for(var pathIndex = 0; pathIndex < pContext.Paths.length; ++pathIndex) {
            var path = pContext.Paths[pathIndex];
            for(var index = 0; index < path.points.length; ++index) {
                var distance = this.DistanceSq(pPoint, path.points[index]);
                if(distance < bestDistance) {
                    best = path.points[index];
                    bestDistance = distance;
                }
            }
        }

        return best;
    },

    DirectionToPath: function(pContext, pPoint) {
        var nearest = this.NearestPathPoint(pContext, pPoint);
        if(!nearest)
            return "south";

        var dx = nearest.x - pPoint.x;
        var dy = nearest.y - pPoint.y;

        if(Math.abs(dx) > Math.abs(dy))
            return dx < 0 ? "west" : "east";

        return dy < 0 ? "north" : "south";
    },

    GuardPointsForStructure: function(pContext, pPoint, pTemplate) {
        var template = this.TemplateInfo(pTemplate);
        var radius = (template.radius || 2) + (template.approach || 2) + 1;
        var offsets = [
            { x: 0, y: -radius },
            { x: radius, y: 0 },
            { x: 0, y: radius },
            { x: -radius, y: 0 },
            { x: radius - 1, y: -radius + 1 },
            { x: -radius + 1, y: radius - 1 }
        ];
        var points = [];

        for(var index = 0; index < offsets.length; ++index) {
            var point = {
                x: Math.max(1, Math.min(pContext.Width - 2, pPoint.x + offsets[index].x)),
                y: Math.max(1, Math.min(pContext.Height - 2, pPoint.y + offsets[index].y))
            };

            if(MapGen.Metrics.IsWalkable(pContext, point.x, point.y))
                points.push(point);
        }

        return points;
    },

    PlannedSitesByKind: function(pContext, pKind) {
        var sites = pContext.PlannedSites || [];
        var matches = [];

        for(var index = 0; index < sites.length; ++index) {
            if(sites[index].kind === pKind)
                matches.push(sites[index]);
        }

        return matches;
    },

    SiteCandidatePoint: function(pContext, pSite) {
        var template = pSite.template ? this.TemplateInfo(pSite.template) : null;
        var radius = template ? (template.radius || pSite.radius || 1) : (pSite.radius || 1);
        var minDistance = template ? (template.minDistance || 0) : 0;

        // Region-intent sites (e.g. ice_compound corner outposts) are
        // intentionally clustered around the support anchor; the template's
        // generic minDistance check would reject them as "too close to the
        // support's supply_hut" the same way it rightly rejects two random
        // bunkers spawning 4 cells apart. Honor the per-site override so the
        // template's own contract decides cluster spacing — see
        // [[mapgen_region_intent_v1]].
        if(typeof pSite.minDistanceOverride === "number")
            minDistance = Math.max(0, Math.floor(pSite.minDistanceOverride));

        var point = this.CandidateNearPoint(pContext, pSite.point, radius, minDistance);
        if(point || !pSite.routePlanned)
            return point;

        // The fast eight-ray search can miss a valid pocket beside a routed
        // site. Check the remaining cells within the same six-cell radius,
        // retaining placement clearance and the eight-cell site contract.
        for(var ring = 2; ring <= 6; ++ring) {
            for(var dy = -ring; dy <= ring; ++dy) {
                for(var dx = -ring; dx <= ring; ++dx) {
                    if(Math.max(Math.abs(dx), Math.abs(dy)) !== ring ||
                        !dx || !dy || Math.abs(dx) === Math.abs(dy) || dx * dx + dy * dy > 64)
                        continue;
                    var candidate = {x:pSite.point.x + dx, y:pSite.point.y + dy};
                    if(this.CanPlaceAt(pContext, candidate, radius, minDistance))
                        return candidate;
                }
            }
        }
        return null;
    },

    PlaceStructureSite: function(pContext, pSite) {
        var point = this.SiteCandidatePoint(pContext, pSite);
        if(!point)
            return null;

        var template = this.TemplateInfo(pSite.template);

        return this.AddPlacement(pContext, "structures", {
            kind: pSite.id === "objective" ? "objective_structure" : "structure_cluster",
            template: pSite.template,
            role: pSite.role,
            point: point,
            radius: template.radius || pSite.radius || 2,
            approach: template.approach || pSite.approach || 2,
            entrance: this.DirectionToPath(pContext, point),
            guardPoints: this.GuardPointsForStructure(pContext, point, pSite.template),
            guardCount: template.guardCount || 1,
            buildingMix: template.buildingMix || []
        });
    },

    PlacePickupSite: function(pContext, pSite) {
        var point = this.CandidateNearPoint(pContext, pSite.point, 1, 4);
        if(!point)
            return null;

        var routeFraction = pSite.routeFraction;
        if(routeFraction === undefined && pSite.point)
            routeFraction = pSite.point.routeFraction;
        var routePhase = pSite.routePhase;
        if(routePhase === undefined && pSite.point)
            routePhase = pSite.point.routePhase;
        var branchId = pSite.branchId;
        if(branchId === undefined && pSite.point)
            branchId = pSite.point.branchId;
        var topologyPurpose = pSite.topologyPurpose;
        if(topologyPurpose === undefined && pSite.point)
            topologyPurpose = pSite.point.topologyPurpose;

        return this.AddPlacement(pContext, "pickups", {
            kind: pSite.id ? ("pickup_" + pSite.id) : "pickup",
            template: pSite.template || "ammo",
            role: pSite.role || "route_pickup",
            point: point,
            radius: 1,
            approach: 1,
            routeFraction: routeFraction,
            routePhase: routePhase || "",
            branchId: branchId || null,
            topologyPurpose: topologyPurpose || "",
            routeOffset: pSite.routeOffset,
            routeAnchor: pSite.routeAnchor || null
        });
    },

    PlaceObjectiveMarkerSite: function(pContext, pSite) {
        var point = this.CandidateNearPoint(pContext, pSite.point, pSite.radius || 1, 5);
        if(!point)
            return null;

        var placement = {
            kind: pSite.template === "extraction_zone" ? "extraction_zone" :
                (pSite.virtual ? "campaign_objective_marker" : "multiplayer_objective"),
            template: pSite.template || "objective",
            role: pSite.role || "objective",
            point: point,
            radius: pSite.radius || 1,
            approach: pSite.approach || 2,
            virtual: !!pSite.virtual
        };

        if(pSite.virtual) {
            pContext.Placements.objectives.push(placement);
            return placement;
        }

        return this.AddPlacement(pContext, "objectives", placement);
    },

    SiteRendersAsStructure: function(pSite) {
        if(!pSite.template)
            return false;
        if(pSite.kind === "structure" || pSite.kind === "objective" || pSite.kind === "support")
            return true;

        return false;
    },

    BuildSiteStructures: function(pContext) {
        var sites = pContext.PlannedSites || [];

        for(var index = 0; index < sites.length; ++index) {
            if(this.SiteRendersAsStructure(sites[index]))
                this.PlaceStructureSite(pContext, sites[index]);
        }
    },

    BuildSitePickups: function(pContext) {
        var sites = this.PlannedSitesByKind(pContext, "pickup");
        for(var index = 0; index < sites.length; ++index)
            this.PlacePickupSite(pContext, sites[index]);
    },

    BuildObjectiveMarkers: function(pContext) {
        var sites = this.PlannedSitesByKind(pContext, "objective_marker");
        for(var index = 0; index < sites.length; ++index)
            this.PlaceObjectiveMarkerSite(pContext, sites[index]);
    },

    UniqueObjectiveTemplates: function(pContext) {
        var templates = pContext.Profile.ObjectiveTemplates || ["kill_enemies"];
        var unique = [];

        for(var index = 0; index < templates.length; ++index) {
            if(unique.indexOf(templates[index]) < 0)
                unique.push(templates[index]);
        }

        return unique.length ? unique : ["kill_enemies"];
    },

    ObjectiveAnchorForTemplate: function(pContext, pTemplate) {
        var anchors = pContext.Anchors;

        if((pTemplate === "rescue_hostages" || pTemplate === "civilian_home") && anchors.support)
            return anchors.support;

        return anchors.objective || anchors.support || anchors.start;
    },

    BuildObjectiveTemplates: function(pContext) {
        var templates = this.UniqueObjectiveTemplates(pContext);

        for(var index = 0; index < templates.length; ++index) {
            var anchor = this.ObjectiveAnchorForTemplate(pContext, templates[index]);
            if(!anchor)
                continue;

            this.AddPlacement(pContext, "objectives", {
                kind: "objective_anchor",
                template: templates[index],
                role: "objective",
                point: { x: anchor.x, y: anchor.y },
                radius: 1,
                approach: 2
            });
        }
    },

    BuildAnchorPickups: function(pContext) {
        if(pContext.Anchors.support) {
            this.PlacePickupSite(pContext, {
                id: "support_pickup",
                point: pContext.Anchors.support,
                template: "grenades_or_rockets",
                role: "support"
            });
        }

        if(pContext.Anchors.objective) {
            this.PlacePickupSite(pContext, {
                id: "objective_supply",
                point: pContext.Anchors.objective,
                template: "rockets",
                role: "objective_route"
            });
        }
    },

    BuildMultiplayerTeams: function(pContext) {
        var anchors = pContext.Anchors;
        var teams = [
            { role: "team_a", anchor: anchors.teamA },
            { role: "team_b", anchor: anchors.teamB }
        ];

        for(var index = 0; index < teams.length; ++index) {
            if(!teams[index].anchor)
                continue;

            this.AddPlacement(pContext, "teams", {
                kind: "team_spawn",
                template: teams[index].role,
                role: teams[index].role,
                point: { x: teams[index].anchor.x, y: teams[index].anchor.y },
                radius: 2,
                approach: 2
            });
            this.PrepareMultiplayerTeamSpawnPad(pContext, teams[index].anchor);
        }
    },

    MultiplayerTeamSpawnOffsets: [
        { x: -1, y: -1 },
        { x: 0, y: -1 },
        { x: 1, y: -1 },
        { x: -1, y: 0 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: -1, y: 1 },
        { x: 0, y: 1 },
        { x: 1, y: 1 }
    ],

    PrepareMultiplayerTeamSpawnPad: function(pContext, pAnchor) {
        if(!pContext || !pContext.Layers || !pAnchor)
            return 0;

        var layers = pContext.Layers;
        var changed = 0;
        for(var index = 0; index < this.MultiplayerTeamSpawnOffsets.length; ++index) {
            var offset = this.MultiplayerTeamSpawnOffsets[index];
            var x = pAnchor.x + offset.x;
            var y = pAnchor.y + offset.y;

            if(x < 0 || y < 0 || x >= pContext.Width || y >= pContext.Height)
                continue;

            if(MapGen.Layers.Set(layers.water, x, y, 0)) ++changed;
            MapGen.Layers.Set(layers.riverBank, x, y, 0);
            MapGen.Layers.Set(layers.forcedBank, x, y, 0);
            MapGen.Layers.Set(layers.blocked, x, y, 0);
            MapGen.Layers.Set(layers.terrainEdge, x, y, 0);
            MapGen.Layers.Set(layers.path, x, y, 1);
            MapGen.Layers.Set(layers.keepClear, x, y, 1);
        }

        if(changed)
            MapGen.Context.AddLog(pContext, "Cleared multiplayer team spawn water cells: " + changed);
        return changed;
    },

    BuildContestedPickup: function(pContext) {
        if(!pContext.Anchors.contested)
            return;

        this.PlacePickupSite(pContext, {
            id: "contested_pickup",
            point: pContext.Anchors.contested,
            template: "heavy_weapon",
            role: "contested"
        });
    },

    BuildCampaign: function(pContext) {
        this.BuildSiteStructures(pContext);
        this.BuildObjectiveTemplates(pContext);
        this.BuildObjectiveMarkers(pContext);
        this.BuildSitePickups(pContext);
        this.BuildAnchorPickups(pContext);
        if(MapGen.Features.CliffHelicopter)
            MapGen.Features.CliffHelicopter.Build(pContext);
        MapGen.Context.AddLog(pContext, "Built campaign feature placement plan");
    },

    BuildMultiplayer: function(pContext) {
        this.BuildObjectiveMarkers(pContext);
        this.BuildMultiplayerTeams(pContext);
        this.BuildSitePickups(pContext);
        this.BuildContestedPickup(pContext);
        if(MapGen.Features.CliffHelicopter)
            MapGen.Features.CliffHelicopter.Build(pContext);
        MapGen.Context.AddLog(pContext, "Built multiplayer feature placement plan");
    }
};

for(var preloadedFeatureName in MapGenPreloadedFeatureModules) {
    if(MapGenPreloadedFeatureModules.hasOwnProperty(preloadedFeatureName) &&
        !MapGen.Features.hasOwnProperty(preloadedFeatureName)) {
        MapGen.Features[preloadedFeatureName] = MapGenPreloadedFeatureModules[preloadedFeatureName];
    }
}
