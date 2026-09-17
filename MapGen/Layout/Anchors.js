var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

MapGen.Layout.Anchors = {

    BorderInset: function(pContext, pName, pDefaultValue) {
        var profile = pContext.Profile || {};
        var name = pName || "AnchorBorderInset";
        var value = Number(profile[name]);

        if(isNaN(value))
            value = pDefaultValue === undefined ? 4 : pDefaultValue;

        var minSide = Math.min(pContext.Width || 0, pContext.Height || 0);
        var maxInset = Math.max(1, Math.floor((minSide - 3) / 2));
        return Math.max(1, Math.min(maxInset, Math.floor(value)));
    },

    PointInsideInset: function(pContext, pPoint, pInset) {
        var inset = pInset === undefined ? this.BorderInset(pContext) : Math.max(1, Math.floor(pInset));
        return pPoint.x >= inset && pPoint.y >= inset &&
            pPoint.x <= pContext.Width - 1 - inset &&
            pPoint.y <= pContext.Height - 1 - inset;
    },

    ClampPointWithInset: function(pContext, pPoint, pInset) {
        var inset = pInset === undefined ? this.BorderInset(pContext) : Math.max(1, Math.floor(pInset));
        var maxX = Math.max(inset, pContext.Width - 1 - inset);
        var maxY = Math.max(inset, pContext.Height - 1 - inset);
        return {
            x: Math.max(inset, Math.min(maxX, pPoint.x)),
            y: Math.max(inset, Math.min(maxY, pPoint.y)),
            role: pPoint.role || ""
        };
    },

    ClampPoint: function(pContext, pPoint) {
        return this.ClampPointWithInset(pContext, pPoint, this.BorderInset(pContext, "AnchorBorderInset", 4));
    },

    MakePoint: function(pContext, pX, pY, pRole) {
        return this.ClampPoint(pContext, {
            x: Math.floor(pX),
            y: Math.floor(pY),
            role: pRole
        });
    },

    SnapToLand: function(pContext, pPoint) {
        if(!pContext.Continent || !pContext.Layers || !pContext.Layers.water)
            return this.ClampPoint(pContext, pPoint);

        var inset = this.BorderInset(pContext, "AnchorBorderInset", 4);
        var point = this.ClampPointWithInset(pContext, pPoint, inset);
        if(!MapGen.Layers.Get(pContext.Layers.water, point.x, point.y, 0))
            return point;

        var W = pContext.Width;
        var H = pContext.Height;
        var maxR = Math.max(2, Math.floor(Math.min(W, H) / 4));
        var fallback = null;

        for(var r = 1; r <= maxR; ++r) {
            for(var dx = -r; dx <= r; ++dx) {
                for(var dy = -r; dy <= r; ++dy) {
                    if(Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                    var nx = point.x + dx;
                    var ny = point.y + dy;
                    if(nx < 1 || ny < 1 || nx > W - 2 || ny > H - 2) continue;
                    if(MapGen.Layers.Get(pContext.Layers.water, nx, ny, 0)) continue;
                    var candidate = { x: nx, y: ny, role: pPoint.role };
                    if(this.PointInsideInset(pContext, candidate, inset))
                        return candidate;
                    if(!fallback)
                        fallback = candidate;
                }
            }
        }
        return fallback || point;
    },

    RepairCampaignSpacing: function(pContext) {
        if(!pContext || MapGen.Context.IsMultiplayer(pContext) ||
            !pContext.Anchors || !pContext.Profile ||
            this.IsGrammarBeachCampaign(pContext) ||
            pContext.Profile.TerrainType === Terrain.Types.Ice ||
            pContext.Profile.TargetPackProfile === "grammar_ice")
            return false;

        var anchors = pContext.Anchors;
        var clearings = MapGen.Layout.Clearings;
        if(!clearings || !clearings.RadiusForRole || !anchors.start)
            return false;

        var startRadius = clearings.RadiusForRole(pContext, "start");
        var roles = ["support", "objective"];
        var moved = false;
        var checks = 0, movedRoles = [];
        function dryDisc(point, radius) {
            for(var dx = -radius; dx <= radius; ++dx)
                for(var dy = -radius; dy <= radius; ++dy) {
                    if(dx * dx + dy * dy > radius * radius) continue;
                    var x = point.x + dx, y = point.y + dy;
                    if(x < 1 || y < 1 || x >= pContext.Width - 1 ||
                        y >= pContext.Height - 1 ||
                        MapGen.Layers.Get(pContext.Layers.water, x, y, 0))
                        return false;
                }
            return true;
        }
        function separated(point, radius, other, otherRadius) {
            if(!other) return true;
            var dx = point.x - other.x, dy = point.y - other.y;
            var gap = radius + otherRadius + 4;
            return dx * dx + dy * dy >= gap * gap;
        }
        for(var roleIndex = 0; roleIndex < roles.length; ++roleIndex) {
            var role = roles[roleIndex], point = anchors[role];
            if(!point) continue;
            var radius = clearings.RadiusForRole(pContext, role);
            if(separated(point, radius, anchors.start, startRadius) &&
                (role !== "objective" || separated(point, radius,
                    anchors.support, clearings.RadiusForRole(pContext, "support"))))
                continue;

            var originX = point.x, originY = point.y;
            var maxRadius = Math.max(8, Math.min(pContext.Width,
                pContext.Height));
            var replacement = null;
            for(var distance = 1; distance <= maxRadius && !replacement &&
                checks < 4096; ++distance) {
                var nearestDistanceSq = 0x7fffffff;
                var ring = [];
                for(var ringY = -distance; ringY <= distance; ++ringY)
                    ring.push({x: -distance, y: ringY});
                for(var ringX = -distance + 1; ringX < distance; ++ringX) {
                    ring.push({x: ringX, y: -distance});
                    ring.push({x: ringX, y: distance});
                }
                for(var ringYEnd = -distance; ringYEnd <= distance; ++ringYEnd)
                    ring.push({x: distance, y: ringYEnd});
                for(var ringIndex = 0;
                    ringIndex < ring.length && checks < 4096; ++ringIndex) {
                        var dx = ring[ringIndex].x, dy = ring[ringIndex].y;
                        ++checks;
                        var candidate = {x: originX + dx, y: originY + dy};
                        if(!this.PointInsideInset(pContext, candidate,
                            this.BorderInset(pContext))) continue;
                        if(!separated(candidate, radius, anchors.start, startRadius))
                            continue;
                        if(role === "objective" && !separated(candidate, radius,
                            anchors.support, clearings.RadiusForRole(pContext, "support")))
                            continue;
                        var candidateDistanceSq = dx * dx + dy * dy;
                        if(candidateDistanceSq >= nearestDistanceSq ||
                            !dryDisc(candidate, radius)) continue;
                        replacement = candidate;
                        nearestDistanceSq = candidateDistanceSq;
                }
            }
            if(replacement) {
                var previous = {x: point.x, y: point.y};
                point.x = replacement.x;
                point.y = replacement.y;
                moved = true;
                movedRoles.push({role: role, from: previous, to: {
                    x: replacement.x, y: replacement.y
                }});
            }
        }
        if(moved) {
            pContext.AnchorSpacingRepair = {moved: true, roles: movedRoles,
                candidateChecks: checks};
            MapGen.Context.AddLog(pContext, "Repaired overlapping campaign anchor clearings");
        }
        return moved;
    },

    Orient: function(pContext) {
        var roll = pContext.Random.Int(0, 3);
        var flipX = (roll & 1) !== 0;
        var flipY = (roll & 2) !== 0;

        pContext.Orientation = { flipX: flipX, flipY: flipY };

        if(!flipX && !flipY)
            return;

        var width = pContext.Width;
        var height = pContext.Height;
        var seen = [];

        var apply = function(pPoint) {
            if(!pPoint || typeof pPoint.x !== "number" || typeof pPoint.y !== "number")
                return;
            for(var i = 0; i < seen.length; ++i)
                if(seen[i] === pPoint)
                    return;
            seen.push(pPoint);
            if(flipX) pPoint.x = width - 1 - pPoint.x;
            if(flipY) pPoint.y = height - 1 - pPoint.y;
        };

        var key;
        for(key in pContext.Anchors)
            if(pContext.Anchors.hasOwnProperty(key))
                apply(pContext.Anchors[key]);

        for(var i = 0; i < pContext.CriticalPoints.length; ++i)
            apply(pContext.CriticalPoints[i]);

        for(var j = 0; j < pContext.Regions.length; ++j)
            apply(pContext.Regions[j].point);
    },

    IsGrammarBeachCampaign: function(pContext) {
        return !!(pContext &&
            pContext.Profile &&
            pContext.Profile.GeneratorCore === "official_grammar" &&
            pContext.Profile.TargetPackProfile === "grammar_beach");
    },

    BeachEdgeSide: function(pContext) {
        if(MapGen.Grammar && MapGen.Grammar.BeachEdgeSide)
            return MapGen.Grammar.BeachEdgeSide(pContext);

        var seed = pContext ? pContext.Seed || 0 : 0;
        var roll = MapGen.Random.HashTile(seed, 71, 79, 751) % 100;

        if(roll < 40)
            return 1;
        if(roll < 65)
            return 2;
        if(roll < 85)
            return 3;
        return 0;
    },

    DistanceSq: function(pA, pB) {
        var dx = pA.x - pB.x;
        var dy = pA.y - pB.y;
        return (dx * dx) + (dy * dy);
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

    BuildGrammarBeachCampaign: function(pContext) {
        // Regional layouts already own endpoints, branches and settlement
        // regions. Replacing those with the old six-row beach matrix made
        // unrelated plans share endpoints and pinched every coast around the
        // same near-edge spawn. Coast fitting protects these planned points.
        if(pContext.RegionalPlan) {
            if(!pContext.Anchors || !pContext.Anchors.start)
                MapGen.Layout.RegionIntents.PlaceAnchors(pContext);
            pContext.GrammarBeachRouteContext = {
                edgeSide: this.BeachEdgeSide(pContext),
                family: MapGen.Grammar.GrammarBeachFamily(pContext),
                source: "regional_beach_routes"
            };
            return pContext.Anchors;
        }
        // Named nonregional styles retain their authored route matrices.
        var random = pContext.Random;
        var minSide = Math.min(pContext.Width, pContext.Height);
        var marginX = Math.max(6, Math.floor(pContext.Width * 0.12));
        var marginY = Math.max(6, Math.floor(pContext.Height * 0.12));
        var family = MapGen.Grammar && MapGen.Grammar.GrammarBeachFamily ?
            MapGen.Grammar.GrammarBeachFamily(pContext) : "mapm8_corner_cove";
        var variant = MapGen.Grammar && MapGen.Grammar.GrammarBeachLayoutVariant ?
            MapGen.Grammar.GrammarBeachLayoutVariant(pContext) : 0;
        var side = this.BeachEdgeSide(pContext);
        var startSpec;
        var objectiveSpec;

        if(family === "mapm5_top_bank") {
            // The mapm5 river runs north/south. Keep the critical endpoints on
            // opposite banks, but vary which bank starts, their vertical phase,
            // and whether the route reads as diagonal or mostly horizontal.
            var mapm5Specs = [
                [[0.88, 0.16], [0.10, 0.80]],
                [[0.10, 0.18], [0.88, 0.76]],
                [[0.88, 0.76], [0.10, 0.22]],
                [[0.10, 0.72], [0.88, 0.28]],
                [[0.88, 0.46], [0.10, 0.58]],
                [[0.10, 0.42], [0.88, 0.54]]
            ];
            startSpec = mapm5Specs[variant][0];
            objectiveSpec = mapm5Specs[variant][1];
        }
        else if(family === "mapm6_bridge_channel") {
            // The mapm6 channel runs west/east. Place the endpoints on opposite
            // land masses so a bridge is part of the route, alternating which
            // end and which bridge the route naturally approaches.
            var mapm6Specs = [
                [[0.16, 0.14], [0.82, 0.84]],
                [[0.82, 0.14], [0.18, 0.84]],
                [[0.38, 0.14], [0.72, 0.84]],
                [[0.70, 0.14], [0.30, 0.84]],
                [[0.14, 0.82], [0.78, 0.14]],
                [[0.84, 0.82], [0.22, 0.14]]
            ];
            startSpec = mapm6Specs[variant][0];
            objectiveSpec = mapm6Specs[variant][1];
        }
        else {
            // The compact mapm8 cove does not divide the land, so allow the
            // complete range of long diagonals, cross-map and vertical routes.
            var mapm8Specs = [
                [[0.12, 0.16], [0.84, 0.78]],
                [[0.84, 0.16], [0.14, 0.80]],
                [[0.12, 0.72], [0.84, 0.24]],
                [[0.18, 0.46], [0.82, 0.56]],
                [[0.44, 0.12], [0.58, 0.84]],
                [[0.78, 0.72], [0.18, 0.22]]
            ];
            startSpec = mapm8Specs[variant][0];
            objectiveSpec = mapm8Specs[variant][1];
        }

        var start = this.MakePoint(
            pContext,
            startSpec[0] * (pContext.Width - 1),
            startSpec[1] * (pContext.Height - 1),
            "start"
        );
        var objective = this.MakePoint(
            pContext,
            objectiveSpec[0] * (pContext.Width - 1),
            objectiveSpec[1] * (pContext.Height - 1),
            "objective"
        );

        var supportRaw;
        if(family === "mapm6_bridge_channel") {
            // A chord midpoint sits inside mapm6's broad horizontal channel.
            // Because support is the first critical hop, protecting that point
            // punches a lone grass cell into the water and prevents both the
            // primary path and the campaign objective route from being built.
            // Keep support on the start-side bank; the objective remains the
            // deliberate cross-channel hop.
            supportRaw = {
                x: ((start.x * 0.55) + (objective.x * 0.45)),
                y: startSpec[1] < 0.5 ? marginY : pContext.Height - marginY - 1
            };
        }
        else {
            supportRaw = this.ChordPoint(
                start,
                objective,
                0.45,
                (random.Chance(0.5) ? 1 : -1) * Math.max(5, minSide * 0.10)
            );
        }
        var support = this.MakePoint(pContext, supportRaw.x, supportRaw.y, "support");

        pContext.Anchors = {
            start: start,
            objective: objective,
            support: support
        };
        pContext.CriticalPoints = [];
        var regions = pContext.Regions || [];
        var keptRegions = [];
        for(var regionIndex = 0; regionIndex < regions.length; ++regionIndex) {
            var region = regions[regionIndex];
            if(!region ||
                region.name === "player_start" ||
                region.name === "objective" ||
                region.name === "support")
                continue;
            keptRegions.push(region);
        }
        pContext.Regions = keptRegions;
        pContext.Regions.push({ name: "player_start", point: start });
        pContext.Regions.push({ name: "objective", point: objective });
        pContext.Regions.push({ name: "support", point: support });

        pContext.GrammarBeachRouteContext = {
            edgeSide: side,
            family: family,
            layoutVariant: variant,
            source: "grammar_beach_family_route_matrix"
        };

        return pContext.Anchors;
    },

    BuildCampaign: function(pContext) {
        if(this.IsGrammarBeachCampaign(pContext))
            return this.BuildGrammarBeachCampaign(pContext);

        var random = pContext.Random;
        var marginX = Math.max(5, Math.floor(pContext.Width * 0.12));
        var marginY = Math.max(5, Math.floor(pContext.Height * 0.14));
        var midY = Math.floor(pContext.Height * 0.5);
        var start = this.MakePoint(
            pContext,
            random.Int(marginX, Math.max(marginX, Math.floor(pContext.Width * 0.25))),
            random.Int(marginY, pContext.Height - marginY),
            "start"
        );
        var objective = this.MakePoint(
            pContext,
            random.Int(Math.floor(pContext.Width * 0.62), pContext.Width - marginX),
            random.Int(marginY, pContext.Height - marginY),
            "objective"
        );
        var support = this.MakePoint(
            pContext,
            random.Int(Math.floor(pContext.Width * 0.35), Math.floor(pContext.Width * 0.65)),
            random.Int(Math.max(marginY, midY - marginY), Math.min(pContext.Height - marginY, midY + marginY)),
            "support"
        );

        start = this.SnapToLand(pContext, start);
        objective = this.SnapToLand(pContext, objective);
        support = this.SnapToLand(pContext, support);

        pContext.Anchors = {
            start: start,
            objective: objective,
            support: support
        };
        pContext.CriticalPoints = [];
        pContext.Regions.push({ name: "player_start", point: start });
        pContext.Regions.push({ name: "objective", point: objective });
        pContext.Regions.push({ name: "support", point: support });

        this.Orient(pContext);

        return pContext.Anchors;
    },

    BuildMultiplayer: function(pContext) {
        var random = pContext.Random;
        var marginX = Math.max(6, Math.floor(pContext.Width * 0.14));
        var marginY = Math.max(6, Math.floor(pContext.Height * 0.14));
        var teamA = this.MakePoint(
            pContext,
            random.Int(marginX, Math.max(marginX, Math.floor(pContext.Width * 0.25))),
            random.Int(marginY, pContext.Height - marginY),
            "team_a"
        );
        var teamB = this.MakePoint(
            pContext,
            random.Int(Math.floor(pContext.Width * 0.75), pContext.Width - marginX),
            pContext.Height - teamA.y,
            "team_b"
        );
        var center = this.MakePoint(
            pContext,
            Math.floor(pContext.Width * 0.5),
            Math.floor(pContext.Height * 0.5),
            "contested"
        );

        teamA = this.SnapToLand(pContext, teamA);
        teamB = this.SnapToLand(pContext, teamB);
        center = this.SnapToLand(pContext, center);

        pContext.Anchors = {
            teamA: teamA,
            teamB: teamB,
            contested: center
        };
        pContext.CriticalPoints = [];
        pContext.Regions.push({ name: "team_a_spawn", point: teamA });
        pContext.Regions.push({ name: "team_b_spawn", point: teamB });
        pContext.Regions.push({ name: "contested", point: center });

        this.Orient(pContext);

        return pContext.Anchors;
    }
};
