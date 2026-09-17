var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// One regional plan is shared by landforms, routes, cover and building sites.
// Existing authored templates retain their own reservation hook.
MapGen.Layout.RegionIntents = {
    Prepare: function(c, terrainRegions) {
        if(!c.Profile.RegionalComposition || MapGen.Context.IsMultiplayer(c)) return;
        var random = MapGen.Random.CreateSeeded(MapGen.Random.HashTile(c.Seed, 7, 13, 19201));
        var topology = ["branching", "circuit", "hub"][random.Int(0, 2)];
        var regions = terrainRegions || [{x: 2, y: 2, w: c.Width - 4, h: c.Height - 4}];
        var count = random.Int(topology === "hub" ? 4 : 3, c.Width * c.Height >= 6500 ? 6 : 4);
        // Mazes and cliff faces need disjoint rectangular reservations. Other
        // landscapes use irregular districts with wilderness between them,
        // rather than inheriting a complete rectangular tiling every time.
        var scattered = !terrainRegions && c.Profile.CompositionVariant !== "forest_labyrinth" &&
            MapGen.Random.HashTile(c.Seed, 17, 29, 19207) % 2 === 0;
        // Full-edge beaches need their local coast reservation before sites.
        if(!terrainRegions && c.Profile.Name === "grammar_beach" &&
            MapGen.Grammar.RegionalBeachCoastDimensions(c).form !== 0) scattered = true;
        if(scattered) regions = this.ScatterRegions(c, random, count);
        while(regions.length < count) {
            var choice = -1, largest = 0;
            for(var i = 0; i < regions.length; ++i) {
                var r = regions[i], area = r.w * r.h;
                if(Math.max(r.w, r.h) >= 32 && area > largest) { choice = i; largest = area; }
            }
            if(choice < 0) break;
            var old = regions.splice(choice, 1)[0];
            var horizontal = old.w > old.h * 1.35 || (old.w >= 32 && old.h < old.w * 1.35 && random.Chance(0.5));
            if(old.h < 32) horizontal = true;
            var length = horizontal ? old.w : old.h;
            var cut = Math.max(16, Math.min(length - 16, Math.round(length * random.Float(0.36, 0.64))));
            regions.push({x: old.x, y: old.y, w: horizontal ? cut : old.w, h: horizontal ? old.h : cut});
            regions.push({x: old.x + (horizontal ? cut : 0), y: old.y + (horizontal ? 0 : cut),
                w: horizontal ? old.w - cut : old.w, h: horizontal ? old.h : old.h - cut});
        }
        if(regions.length < 3) return;
        for(var n = 0; n < regions.length; ++n) {
            var region = regions[n];
            region.id = n;
            if(!region.point) region.point = {x: Math.round(region.x + region.w * random.Float(0.32, 0.68)),
                y: Math.round(region.y + region.h * random.Float(0.32, 0.68))};
            region.kind = random.Chance(0.55) ? "woods" : "open";
            region.cover = region.kind === "woods" ? random.Float(0.72, 0.95) : random.Float(0.08, 0.28);
        }
        if(topology === "hub" && regions.length < 4) topology = "branching";
        var graph = this.Connect(regions, random, topology), spine = graph.spine;
        if(random.Chance(0.5)) spine.reverse();
        regions[spine[0]].kind = "arrival";
        regions[spine[0]].cover = 0.18;
        var objective = regions[spine[spine.length - 1]];
        objective.kind = "compound"; objective.cover = 0.20;
        var middle = regions[spine[Math.floor(spine.length / 2)]];
        middle.kind = "woods"; middle.cover = random.Float(0.78, 0.95);
        var maze = null;
        if(c.Profile.CompositionVariant === "forest_labyrinth") {
            for(var mi = 0; mi < regions.length; ++mi) {
                var candidate = regions[mi];
                if(candidate.kind !== "arrival" && candidate.kind !== "compound" &&
                    (!maze || candidate.w * candidate.h > maze.w * maze.h)) maze = candidate;
            }
            if(maze) { maze.kind = "maze"; maze.cover = 1; }
        }
        var settlement = ["compound", "camps", "scattered"][random.Int(0, 2)];
        // Cover centers are independent of route anchors: otherwise every
        // region becomes the same clearing with forest pushed to its edges.
        for(var ci = 0; ci < regions.length; ++ci) {
            var cr = regions[ci], angle = random.Float(0, Math.PI);
            cr.forest = {x: cr.x + cr.w * random.Float(0.25, 0.75),
                y: cr.y + cr.h * random.Float(0.25, 0.75),
                rx: Math.max(6, cr.w * random.Float(0.24, 0.45)),
                ry: Math.max(6, cr.h * random.Float(0.24, 0.45)),
                co: Math.cos(angle), si: Math.sin(angle)};
        }
        c.RegionalPlan = {version: 2, regions: regions, links: graph.links, spine: spine,
            arrangement: scattered ? "districts" : "partition",
            topology: topology, settlement: settlement, forestShape: c.Profile.ForestShape || "groves",
            maze: maze ? maze.id : null};
        var buildingRegions = [objective.id], secondary = -1, farthest = -1;
        for(var bi = 0; bi < regions.length; ++bi) {
            var br = regions[bi];
            if(br.id === objective.id || br.kind === "arrival" || br.kind === "maze") continue;
            var bx = br.point.x - objective.point.x, by = br.point.y - objective.point.y;
            if(bx * bx + by * by > farthest) { secondary = bi; farthest = bx * bx + by * by; }
        }
        if(secondary >= 0) buildingRegions.push(secondary);
        for(var bj = 0; bj < regions.length; ++bj)
            if(buildingRegions.indexOf(bj) < 0 && regions[bj].kind !== "arrival" && regions[bj].kind !== "maze")
                buildingRegions.push(bj);
        if(c.Profile.Name === "grammar_beach") {
            // Keep the objective region first, then shape the preference list
            // around the same edge family that the beach terrain author uses.
            // This changes candidate intent only; route and footprint checks
            // still decide whether a site can be placed.
            var beachFamily = MapGen.Grammar.GrammarBeachFamily(c);
            var beachSide = beachFamily === "mapm5_top_bank" ? "right" : "bottom";
            var eligible = [];
            for(var er = 0; er < regions.length; ++er) {
                var candidateRegion = regions[er];
                if(candidateRegion.kind === "arrival" || candidateRegion.kind === "maze" ||
                    candidateRegion.id === objective.id) continue;
                var coastal = beachSide === "right" ?
                    (candidateRegion.x + candidateRegion.w) / c.Width :
                    (candidateRegion.y + candidateRegion.h) / c.Height;
                candidateRegion.beachCoastalAffinity = coastal;
                eligible.push(candidateRegion);
            }
            eligible.sort(function(a, b) {
                if(settlement === "camps" && a.kind !== b.kind) {
                    var aRank = a.kind === "woods" ? 0 : a.kind === "open" ? 1 : 2;
                    var bRank = b.kind === "woods" ? 0 : b.kind === "open" ? 1 : 2;
                    if(aRank !== bRank) return aRank - bRank;
                }
                return b.beachCoastalAffinity - a.beachCoastalAffinity || a.id - b.id;
            });
            c.RegionalPlan.beachCoastFamily = beachFamily;
            if(settlement !== "compound") {
                buildingRegions = [objective.id];
                for(var ri = 0; ri < eligible.length; ++ri)
                    buildingRegions.push(eligible[ri].id);
            }
        }
        c.RegionalPlan.buildingRegions = buildingRegions;
    },

    ScatterRegions: function(c, random, count) {
        var regions = [], W = c.Width, H = c.Height;
        // Snow canopies and coastal aprons need more edge room. Compact
        // jungle sites can use it without losing their smaller transitions.
        var minimumMargin = c.Profile.Name === "grammar_jungle" ? 8 : 10;
        var marginX = Math.max(W < 38 ? 8 : minimumMargin, Math.min(16, Math.round(W * 0.14)));
        var marginY = Math.max(H < 38 ? 8 : minimumMargin, Math.min(16, Math.round(H * 0.14)));
        var focusX = random.Float(0.38, 0.62), focusY = random.Float(0.38, 0.62);
        var spanX = random.Float(0.60, 0.95), spanY = random.Float(0.60, 0.95);
        var coast = null, coastFamily = "";
        if(c.Profile.Name === "grammar_beach") {
            coast = MapGen.Grammar.RegionalBeachCoastDimensions(c);
            coastFamily = MapGen.Grammar.GrammarBeachFamily(c);
        }
        for(var i = 0; i < count; ++i) {
            var best = null, bestDistance = -1;
            for(var attempt = 0; attempt < 24; ++attempt) {
                var point = {x: Math.round(Math.max(marginX, Math.min(W - marginX - 1,
                    W * (focusX + random.Float(-0.5, 0.5) * spanX)))),
                    y: Math.round(Math.max(marginY, Math.min(H - marginY - 1,
                    H * (focusY + random.Float(-0.5, 0.5) * spanY))))};
                // Reserve the local coastal depth, not a rectangular strip.
                // Settlements may occupy wide inland shelves beside the bay.
                if(coast && coast.form !== 0) {
                    if(coastFamily === "mapm5_top_bank")
                        point.x = Math.max(marginX, Math.min(point.x, Math.floor(W *
                            (1 - MapGen.Grammar.RegionalBeachDepthFraction(coast, point.y / (H - 1))) - 10)));
                    else if(coastFamily === "mapm8_corner_cove")
                        point.y = Math.max(marginY, Math.min(point.y, Math.floor(H *
                            (1 - MapGen.Grammar.RegionalBeachDepthFraction(coast, point.x / (W - 1))) - 10)));
                }
                var distance = Infinity;
                for(var p = 0; p < regions.length; ++p) {
                    var dx = point.x - regions[p].point.x, dy = point.y - regions[p].point.y;
                    distance = Math.min(distance, dx * dx + dy * dy);
                }
                if(distance > bestDistance) { best = point; bestDistance = distance; }
            }
            var w = Math.min(W - 4, Math.max(16, Math.round(W * random.Float(0.24, 0.46))));
            var h = Math.min(H - 4, Math.max(16, Math.round(H * random.Float(0.24, 0.46))));
            regions.push({x: Math.max(2, Math.min(W - w - 2, best.x - Math.floor(w / 2))),
                y: Math.max(2, Math.min(H - h - 2, best.y - Math.floor(h / 2))),
                w: w, h: h, point: best});
        }
        return regions;
    },

    Connect: function(regions, random, topology) {
        var links = [], adjacency = [], count = regions.length;
        function distance(a, b) {
            var dx = regions[a].point.x - regions[b].point.x, dy = regions[a].point.y - regions[b].point.y;
            return Math.sqrt(dx * dx + dy * dy);
        }
        function link(a, b) {
            links.push({a: a, b: b}); adjacency[a].push(b); adjacency[b].push(a);
        }
        for(var i = 0; i < count; ++i) adjacency.push([]);
        if(topology === "circuit") {
            var cx = 0, cy = 0, order = [];
            for(var r = 0; r < count; ++r) { cx += regions[r].point.x; cy += regions[r].point.y; order.push(r); }
            cx /= count; cy /= count;
            order.sort(function(a, b) {
                return Math.atan2(regions[a].point.y - cy, regions[a].point.x - cx) -
                    Math.atan2(regions[b].point.y - cy, regions[b].point.x - cx) || a - b;
            });
            var spineLength = Math.max(3, Math.floor(count / 2) + 1);
            var bestSpan = -1, bestOffsets = [];
            for(var candidateOffset = 0; candidateOffset < count; ++candidateOffset) {
                var candidateEnd = (candidateOffset + spineLength - 1) % count;
                var endpointDistance = distance(order[candidateOffset], order[candidateEnd]);
                if(endpointDistance > bestSpan + 0.001) {
                    bestSpan = endpointDistance;
                    bestOffsets = [candidateOffset];
                } else if(Math.abs(endpointDistance - bestSpan) <= 0.001) {
                    bestOffsets.push(candidateOffset);
                }
            }
            // Preserve deterministic orientation variety among equally good
            // endpoint pairs while preventing nearby circuit endpoints.
            var offset = bestOffsets[random.Int(0, bestOffsets.length - 1)];
            order = order.slice(offset).concat(order.slice(0, offset));
            for(var e = 0; e < count; ++e) link(order[e], order[(e + 1) % count]);
            return {links: links, spine: order.slice(0, spineLength)};
        }
        if(topology === "hub") {
            var hub = 0, bestTotal = Infinity;
            for(var h = 0; h < count; ++h) {
                var total = 0;
                for(var other = 0; other < count; ++other) total += distance(h, other);
                if(total < bestTotal) { hub = h; bestTotal = total; }
            }
            for(var spoke = 0; spoke < count; ++spoke) if(spoke !== hub) link(hub, spoke);
        } else {
            var reached = [0], remaining = [];
            for(var n = 1; n < count; ++n) remaining.push(n);
            while(remaining.length) {
                var best = null;
                for(var a = 0; a < reached.length; ++a)
                    for(var b = 0; b < remaining.length; ++b) {
                        var cost = distance(reached[a], remaining[b]) * random.Float(0.85, 1.15);
                        if(!best || cost < best.cost) best = {a: reached[a], b: remaining[b], index: b, cost: cost};
                    }
                link(best.a, best.b); reached.push(best.b); remaining.splice(best.index, 1);
            }
        }
        function farthest(start) {
            var queue = [start], previous = [], distances = [], end = start;
            previous[start] = -1; distances[start] = 0;
            for(var q = 0; q < queue.length; ++q) {
                var at = queue[q];
                for(var j = 0; j < adjacency[at].length; ++j) {
                    var next = adjacency[at][j];
                    if(previous[next] !== undefined) continue;
                    previous[next] = at; distances[next] = distances[at] + distance(at, next);
                    if(distances[next] > distances[end]) end = next;
                    queue.push(next);
                }
            }
            var path = [];
            for(var p = end; p >= 0; p = previous[p]) path.unshift(p);
            return path;
        }
        var initial = farthest(0);
        return {links: links, spine: farthest(initial[initial.length - 1])};
    },

    PlaceAnchors: function(c) {
        var plan = c.RegionalPlan;
        if(!plan) return false;
        var anchors = MapGen.Layout.Anchors, regions = plan.regions;
        c.Regions = [];
        for(var i = 0; i < regions.length; ++i) {
            var r = regions[i];
            r.point = anchors.SnapToLand(c, anchors.MakePoint(c, r.point.x, r.point.y, r.kind));
            c.Regions.push({name: "region_" + r.id, point: r.point, radius: Math.max(4, Math.min(r.w, r.h) * 0.18)});
        }
        var spine = plan.spine;
        c.Anchors = {start: regions[spine[0]].point, objective: regions[spine[spine.length - 1]].point,
            support: regions[spine[Math.floor(spine.length / 2)]].point};
        c.Anchors.start.role = "start";
        c.Anchors.objective.role = "objective";
        c.Anchors.support.role = "support";
        c.CriticalPoints = [];
        return true;
    },

    Chain: function(c) {
        var plan = c.RegionalPlan, chain = [];
        if(plan) for(var i = 0; i < plan.spine.length; ++i) chain.push(plan.regions[plan.spine[i]].point);
        return chain;
    },

    Build: function(c) {
        if(c.RegionalPlan) return c;
        var templates = MapGen.Layout.Templates;
        var template = templates && templates.Resolve ? templates.Resolve(c) : null;
        if(template && typeof template.BuildRegionIntents === "function") template.BuildRegionIntents(c);
        return c;
    },

    ForestScore: function(c, x, y, noise) {
        var plan = c.RegionalPlan;
        if(!plan) return noise;
        if(plan.maze !== null) {
            var maze = plan.regions[plan.maze];
            if(x >= maze.x + 2 && y >= maze.y + 2 && x < maze.x + maze.w - 2 && y < maze.y + maze.h - 2)
                return 2 + noise * 0.1;
        }
        // Ranking and repair ask for the same immutable shape repeatedly.
        if(!c._regionalForestField) c._regionalForestField = this.ForestField(c);
        return c._regionalForestField[y * c.Width + x] * 0.80 + noise * 0.20;
    },

    ForestField: function(c) {
        var plan = c.RegionalPlan, field = new Float32Array(c.Width * c.Height);
        var angle = Number(c.Profile.ForestShapeAngle) || 0, co = Math.cos(angle), si = Math.sin(angle);
        var phase = Number(c.Profile.ForestShapePhase) || 0, bands = Number(c.Profile.ForestShapeBands) || 2;
        // Heartwood is one forest mass; rim is one broad clearing surrounded
        // by forest. Using every region's ellipse for both made them variants
        // of groves, irrespective of the advertised shape. This independent
        // stream leaves route and settlement decisions unchanged.
        var random = MapGen.Random.CreateSeeded(MapGen.Random.HashTile(c.Seed, 77, 31, 19403));
        var rim = plan.forestShape === "rim";
        var geometry = {x: random.Float(rim ? 0.32 : 0.18, rim ? 0.68 : 0.82),
            y: random.Float(rim ? 0.32 : 0.18, rim ? 0.68 : 0.82),
            rx: random.Float(0.25, 0.55), ry: random.Float(0.14, 0.34), angle: angle};
        plan.forestGeometry = geometry;
        for(var y = 0; y < c.Height; ++y) {
            for(var x = 0; x < c.Width; ++x) {
                var nx = x / c.Width - geometry.x, ny = y / c.Height - geometry.y;
                var u = nx * co + ny * si, v = ny * co - nx * si;
                var bend = Math.sin(v * 7 + phase) * 0.06, value = 0;
                if(plan.forestShape === "belts") {
                    value = 0.5 + Math.cos((u + bend) * bands * Math.PI * 2 + phase) * 0.5;
                } else if(plan.forestShape === "heartwood" || rim) {
                    u = (u + bend) / geometry.rx; v /= geometry.ry;
                    var radius = u * u + v * v;
                    value = rim ? radius / (0.4 + radius) : 1 / (0.4 + radius);
                } else for(var i = 0; i < plan.regions.length; ++i) {
                    var r = plan.regions[i], f = r.forest, dx = x - f.x, dy = y - f.y;
                    var gx = (dx * f.co + dy * f.si) / f.rx, gy = (dy * f.co - dx * f.si) / f.ry;
                    var d = gx * gx + gy * gy;
                    value = Math.max(value, (0.65 + r.cover * 0.35) / (1 + d * d));
                }
                field[y * c.Width + x] = value;
            }
        }
        return field;
    },

    BuildingScore: function(c, x, y, slot) {
        var plan = c.RegionalPlan;
        if(!plan) return 0;
        if(plan.maze !== null) {
            var maze = plan.regions[plan.maze];
            if(x >= maze.x && y >= maze.y && x < maze.x + maze.w && y < maze.y + maze.h) return -3000;
        }
        var targets = plan.buildingRegions, position = slot;
        if(plan.settlement === "compound" && slot >= 2) position = 0;
        if(plan.settlement === "camps") position %= 2;
        var index = targets[position % targets.length];
        var target = plan.regions[index].point;
        var dx = x - target.x, dy = y - target.y;
        var distance = Math.sqrt(dx * dx + dy * dy);
        var score = Math.max(0, 1600 - distance * 70);
        if(c.Profile.Name === "grammar_beach") {
            var beachTightness = plan.settlement === "compound" ? 90 :
                plan.settlement === "camps" ? 45 : 0;
            score -= distance * beachTightness;
            var candidateRegion = this.NearestRegion(plan, x, y);
            if(plan.settlement !== "scattered" && candidateRegion &&
                candidateRegion.id === index)
                score += plan.settlement === "compound" ? 500 : 250;
        }
        return score;
    },

    NearestRegion: function(plan, x, y) {
        var best = null, bestDistance = Infinity;
        for(var i = 0; i < plan.regions.length; ++i) {
            var region = plan.regions[i], dx = x - region.point.x, dy = y - region.point.y;
            var distance = dx * dx + dy * dy;
            if(distance < bestDistance) { best = region; bestDistance = distance; }
        }
        return best;
    },

    ReserveRoutes: function(c, mask, def) {
        var plan = c.RegionalPlan;
        if(!plan) return;
        var routes = MapGen.Layout.RouteArchetypes, primary = {};
        for(var i = 1; i < plan.spine.length; ++i)
            primary[Math.min(plan.spine[i-1], plan.spine[i]) + ":" + Math.max(plan.spine[i-1], plan.spine[i])] = true;
        for(var e = 0; e < plan.links.length; ++e) {
            var link = plan.links[e];
            if(primary[Math.min(link.a, link.b) + ":" + Math.max(link.a, link.b)]) continue;
            var points = routes.BuildRoutePoints(c, [plan.regions[link.a].point, plan.regions[link.b].point], def);
            for(var p = 0; p < points.length; ++p) routes.StampCorridorPoint(c, mask, points[p], 1, 2, false);
            c.Paths.push({role: "regional_branch", radius: 1, points: points});
        }
        if(plan.maze === null) return;
        var r = plan.regions[plan.maze], nodes = [], columns = Math.max(2, Math.floor((r.w - 6) / 9)), rows = Math.max(2, Math.floor((r.h - 6) / 9));
        for(var ny = 0; ny < rows; ++ny)
            for(var nx = 0; nx < columns; ++nx)
                nodes.push({x: Math.round(r.x + 4 + nx * (r.w - 8) / (columns - 1)),
                    y: Math.round(r.y + 4 + ny * (r.h - 8) / (rows - 1)), column: nx, row: ny});
        var graph = routes.BuildMazeGraphCandidate(c, nodes, columns, rows, 0, 73, 0.15);
        for(var ge = 0; ge < graph.edges.length; ++ge) {
            var edge = graph.edges[ge], path = routes.MazeEdgePoints(c, nodes[edge.a], nodes[edge.b], ge + 19301);
            for(var k = 0; k < path.length; ++k) routes.StampCorridorPoint(c, mask, path[k], 0, 1, false);
        }
        for(var x = r.x + 2; x < r.x + r.w - 2; ++x)
            for(var y = r.y + 2; y < r.y + r.h - 2; ++y)
                if(!c.Layers.water[x][y] && !c.Layers.path[x][y] && !c.Layers.keepClear[x][y]) {
                    c.Layers.blocked[x][y] = 1;
                    MapGen.Layers.ClaimCell(c.Layers.owner, x, y, MapGen.Layers.Owner.TREE);
                }
        plan.mazeNodes = nodes.length;
    }
};
