var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// Candidate geometry, distribution scoring, and shared approach-route searches.
(function(P) {
    function inside(r, x, y) { return x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY; }
    function expanded(r, n) {
        return {minX : r.minX - n, minY : r.minY - n, maxX : r.maxX + n, maxY : r.maxY + n};
    }
    P.Prepare = function(c) {
        var I = MapGen.Integration, get = MapGen.Layers.Get, water = [], cliff = [], occupied = [], bridge = [];
        for(var y = 0; y < c.Height; ++y) {
            water[y] = [];
            cliff[y] = [];
            occupied[y] = [];
            bridge[y] = [];
            for(var x = 0; x < c.Width; ++x) {
                bridge[y][x] = MapGen.Repair.IsBridgeWaterApproach(c, x, y) ? 1 : 0;
                water[y][x] = I.StructureCellIsWaterLike(c, x, y) ? 1 : 0;
                cliff[y][x] = I.IsStructureCliffProtectedCell(c, x, y) ||
                    MapGen.Layout.Reservations.IsHardTerrain(c, x, y) ? 1 : 0;
                occupied[y][x] = I.IsStructureOccupiedTile(get(c.Layers.occupied, x, y, 0)) ? 1 : 0;
            }
        }
        return {
            water : water,
            cliff : cliff,
            bridgeSAT : I.BuildStructureSAT(bridge, c.Width, c.Height),
            waterSAT : I.BuildStructureSAT(water, c.Width, c.Height),
            cliffSAT : I.BuildStructureSAT(cliff, c.Width, c.Height),
            occupiedSAT : I.BuildStructureSAT(occupied, c.Width, c.Height)
        };
    };
    function sum(c, sat, r) {
        return MapGen.Integration.StructureSATSum(sat, c.Width, c.Height, r.minX, r.minY, r.maxX, r.maxY);
    }
    // One multi-source search supplies exact approach routes for all candidates.
    function routeField(c, g, entries, maze) {
        var W = c.Width, H = c.Height, N = W * H, pred = new Int32Array(N), distance = new Int32Array(N);
        var queue = new Int32Array(N), tail = 0, head = 0, get = MapGen.Layers.Get;
        function blocked(x, y) {
            if(g.cliff[y][x])
                return true;
            if(g.water[y][x] && !get(c.Layers.crossing, x, y, 0) && !get(c.Layers.causeway, x, y, 0))
                return true;
            for(var b = 0; b < entries.length; ++b)
                if(inside(entries[b].candidate.rect, x, y))
                    return true;
            return false;
        }
        for(var i = 0; i < N; ++i) {
            pred[i] = -2;
            distance[i] = -1;
        }
        for(var y = 1; y < H - 1; ++y)
            for(var x = 1; x < W - 1; ++x) {
                if((get(c.Layers.path, x, y, 0) ||
                    (!c.Paths.length && get(c.Layers.owner, x, y, 0) === MapGen.Layers.Owner.ROUTE)) &&
                   !blocked(x, y)) {
                    var start = y * W + x;
                    pred[start] = -1;
                    distance[start] = 0;
                    queue[tail++] = start;
                }
            }
        while(head < tail) {
            var cell = queue[head++], cx = cell % W, cy = Math.floor(cell / W);
            if(maze && distance[cell] >= 6)
                continue;
            var neighbours = [ cell + 1, cell + W, cell - 1, cell - W ];
            for(var d = 0; d < 4; ++d) {
                var n = neighbours[d], nx = n % W, ny = Math.floor(n / W);
                if(nx < 1 || nx >= W - 1 || ny < 1 || ny >= H - 1 ||
                   Math.abs(nx - cx) + Math.abs(ny - cy) !== 1 || pred[n] !== -2 || blocked(nx, ny))
                    continue;
                pred[n] = cell;
                distance[n] = distance[cell] + 1;
                queue[tail++] = n;
            }
        }
        return {pred : pred, distance : distance};
    }
    // Join the real doorway to the shared route field through its reserved apron.
    // A field path can run through the proposed building: try the small perimeter
    // locally instead of rejecting a sound site or running another whole-map A*.
    function approach(c, field, r, info, spec, tx, ty) {
        var sprites = info.info.Types[spec.sprite] || [];
        var doors = [
            SpriteTypes.BuildingDoor, SpriteTypes.BuildingDoor2, SpriteTypes.BunkerDoor_HeavyExplosionOnly,
            SpriteTypes.BunkerDoor_ReinforcedHeavyExplosionOnly, SpriteTypes.Door_Civilian, SpriteTypes.Door_Civilian_Spear,
            SpriteTypes.Door_Civilian_Rescue
        ];
        var best = null;
        for(var s = 0; s < sprites.length; ++s) {
            if(doors.indexOf(sprites[s][2]) < 0)
                continue;
            var start = {x : tx + Math.floor(sprites[s][0] / 16), y : r.maxY + 1};
            var queue = [ {point : start, prefix : []} ], seen = {}, head = 0;
            seen[start.y * c.Width + start.x] = true;
            while(head < queue.length) {
                var node = queue[head++], p = node.point, cell = p.y * c.Width + p.x;
                var path = node.prefix.slice(0), cursor = cell;
                if(field.distance[cell] >= 0 && (!best || path.length + field.distance[cell] < best.length)) {
                    while(cursor >= 0 && path.length <= 64) {
                        var px = cursor % c.Width, py = Math.floor(cursor / c.Width);
                        if(inside(r, px, py))
                            break;
                        path.push({x : px, y : py});
                        cursor = field.pred[cursor];
                    }
                    if(cursor === -1 && (!best || path.length < best.length))
                        best = path;
                }
                var next = [
                    {x : p.x + 1, y : p.y}, {x : p.x, y : p.y + 1}, {x : p.x - 1, y : p.y}, {x : p.x, y : p.y - 1}
                ];
                for(var n = 0; n < next.length; ++n) {
                    var q = next[n], index = q.y * c.Width + q.x;
                    if(q.x < r.minX - 1 || q.x > r.maxX + 1 || q.y < r.minY - 1 || q.y > r.maxY + 1 ||
                       inside(r, q.x, q.y) || seen[index])
                        continue;
                    seen[index] = true;
                    queue.push({point : q, prefix : node.prefix.concat([ p ])});
                }
            }
        }
        return best;
    }
    P.Find = function(c, g, entries, spec, policy, search) {
        var I = MapGen.Integration, R = MapGen.Layout.Reservations, info = I.StructureInfo(spec, c);
        if(!info)
            return null;
        var field = routeField(c, g, entries, policy === "maze"), shortlist = [], occupiedRows = {},
            occupiedSectors = {}, regions = {};
        var start = c.Anchors && c.Anchors.start;
        for(var e = 0; e < entries.length; ++e) {
            var old = entries[e].candidate, center = I.StructureRectCenter(old.rect);
            var sx = Math.min(2, Math.floor(center.x * 3 / c.Width)),
                sy = Math.min(2, Math.floor(center.y * 3 / c.Height));
            occupiedRows[sy] = true;
            occupiedSectors[sx + "," + sy] = true;
            if(old.clearing.regionId)
                regions[old.clearing.regionId] = true;
        }
        var water = I.StructureWaterClearance(c, spec), cliff = I.StructureCliffClearance(c, spec);
        var clear = I.StructureClearance(spec), spacing = I.StructureSpacing(spec, c),
            margin = Math.max(3, I.StructureMapMargin(c));
        var clearings = c.Clearings || [], points = [], seen = {};
        function add(x, y) {
            var key = x + "," + y;
            if(!seen[key]) {
                seen[key] = true;
                points.push({x : x, y : y});
            }
        }
        for(var ci = 0; ci < clearings.length; ++ci) {
            if(clearings[ci].role === "start")
                continue;
            for(var dy = -4; dy <= 4; dy += 2)
                for(var dx = -4; dx <= 4; dx += 2)
                    add(clearings[ci].x + dx, clearings[ci].y + dy);
        }
        var stride = search && search.dense ? 1 : 3;
        for(var gy = margin; gy < c.Height - margin; gy += stride)
            for(var gx = margin; gx < c.Width - margin; gx += stride)
                add(gx, gy);
        for(var q = 0; q < points.length; ++q) {
            var pt = points[q], tx = pt.x - info.centerOffsetX, ty = pt.y - info.centerOffsetY,
                rect = I.StructureRect(tx, ty, info);
            // A replacement for a missing sector row must actually occupy it.
            // Filter before ranking so nearby sites cannot exhaust the bounded
            // shortlist while the useful row is farther from existing routes.
            if(search && search.requiredRows &&
                !search.requiredRows[Math.min(2, Math.floor((rect.minY + rect.maxY) * 1.5 / c.Height))])
                continue;
            var clearance = {
                minX : rect.minX - clear.left,
                minY : rect.minY - clear.top,
                maxX : rect.maxX + clear.right,
                maxY : rect.maxY + clear.bottom
            };
            if(clearance.minX < margin || clearance.minY < margin || clearance.maxX >= c.Width - margin ||
               clearance.maxY >= c.Height - margin)
                continue;
            // Neither the reserved apron nor its dry buffer may erase the
            // visible channel beside a bridge.
            if(sum(c, g.bridgeSAT, clearance) || sum(c, g.bridgeSAT, expanded(rect, Math.max(2, water))))
                continue;
            if(start && (pt.x - start.x) * (pt.x - start.x) + (pt.y - start.y) * (pt.y - start.y) < 225)
                continue;
            // The complete dry reservation must fit inland, including the
            // apron and the two-cell buffer later applied by GameplayPlan.
            if(sum(c, g.waterSAT, clearance) || sum(c, g.waterSAT, expanded(rect, Math.max(2, water))) ||
               sum(c, g.cliffSAT, expanded(clearance, cliff)) ||
               sum(c, g.occupiedSAT, clearance))
                continue;
            var conflict = false;
            for(var bi = 0; bi < entries.length; ++bi)
                if(I.StructureSiteConflictsPlaced(rect, [ entries[bi].candidate ], spacing)) {
                    conflict = true;
                    break;
                }
            if(conflict)
                continue;
            for(var ry = rect.minY; ry <= rect.maxY && !conflict; ++ry)
                for(var rx = rect.minX; rx <= rect.maxX; ++rx) {
                    if(R.At(c, rx, ry) & (R.CLEAR | R.FLOOR)) {
                        conflict = true;
                        break;
                    }
                }
            if(conflict)
                continue;
            var nearest = null, nearDistance = Infinity;
            for(var k = 0; k < clearings.length; ++k) {
                if(clearings[k].role === "start")
                    continue;
                var d = (pt.x - clearings[k].x) * (pt.x - clearings[k].x) +
                        (pt.y - clearings[k].y) * (pt.y - clearings[k].y);
                if(d < nearDistance) {
                    nearDistance = d;
                    nearest = clearings[k];
                }
            }
            var region = MapGen.Encounters.NearestEncounterRegion
                             ? MapGen.Encounters.NearestEncounterRegion(c, pt, false)
                             : null;
            var col = Math.min(2, Math.floor(pt.x * 3 / c.Width)),
                row = Math.min(2, Math.floor(pt.y * 3 / c.Height));
            var score = (occupiedSectors[col + "," + row] ? 0 : 600) + (occupiedRows[row] ? 0 : 500) +
                        (region && !regions[region.id] ? 500 : 0) - Math.sqrt(nearDistance) * 3;
            // Secure the required map span with the second landmark before
            // spending the remaining slots on geographic/encounter coverage.
            if(entries.length === 1) {
                var first = I.StructureRectCenter(entries[0].candidate.rect);
                var span = Math.sqrt((pt.x - first.x) * (pt.x - first.x) + (pt.y - first.y) * (pt.y - first.y));
                var target = Number(c.Profile.MinLiveStructureMapSpanFraction || 0) *
                             Math.sqrt(c.Width * c.Width + c.Height * c.Height);
                if(span >= target + 2)
                    score += 1500;
            }
            if(entries.length === 0 && nearest && nearest.role === "compound_objective")
                score += 900;
            score += (MapGen.Random.HashTile(c.Seed, pt.x, pt.y, 7319) % 1000) / 1000;
            shortlist.push({
                tileX : tx,
                tileY : ty,
                rect : rect,
                clearance : clearance,
                score : score,
                waterClearance : water,
                cliffClearance : cliff,
                clearing : nearest,
                region : region
            });
        }
        // Estimate the clear-route cost cheaply from the shared distance
        // field. Full doorway approach reconstruction remains lazy below;
        // this only keeps candidates with short likely approaches ahead of
        // long detours when their geographic scores are otherwise similar.
        var reachable = [];
        for(var estimateIndex = 0; estimateIndex < shortlist.length; ++estimateIndex) {
            var estimate = shortlist[estimateIndex], doorX = Math.floor((estimate.rect.minX + estimate.rect.maxX) / 2),
                doorY = estimate.rect.maxY + 1, estimatedDistance = -1;
            if(doorX >= 0 && doorX < c.Width && doorY >= 0 && doorY < c.Height)
                estimatedDistance = field.distance[doorY * c.Width + doorX];
            if(estimatedDistance >= 0) {
                estimate.approachEstimate = estimatedDistance;
                estimate.score -= Math.min(estimatedDistance, 64) * 12;
            }
            var canReach = estimatedDistance >= 0, edge = estimate.rect;
            // The doorway search is confined to this one-cell perimeter. If
            // none of it reaches the route field, reconstruction cannot help.
            // Exclude such sites before they consume a bounded shortlist.
            for(var ey = edge.minY - 1; ey <= edge.maxY + 1 && !canReach; ++ey)
                for(var ex = edge.minX - 1; ex <= edge.maxX + 1; ++ex) {
                    if(inside(edge, ex, ey)) continue;
                    if(field.distance[ey * c.Width + ex] >= 0) { canReach = true; break; }
                }
            if(canReach) reachable.push(estimate);
        }
        shortlist = reachable;
        shortlist.sort(function(a, b) { return b.score - a.score || a.tileY - b.tileY || a.tileX - b.tileX; });
        // Retry geographically distinct sites instead of adjacent origins
        // that all consume the same space needed by the remaining buildings.
        var alternatives = [], alternativeDistance = Math.max(3, Math.floor(spacing / 2));
        for(var s = 0; s < shortlist.length; ++s) {
            if(search && search.candidateLimit !== undefined && s >= search.candidateLimit) break;
            var candidate = shortlist[s], nearbyAlternative = false;
            if(search && search.diverse) {
                for(var ai = 0; ai < alternatives.length; ++ai) {
                    var ax = candidate.tileX - alternatives[ai].tileX, ay = candidate.tileY - alternatives[ai].tileY;
                    if(ax * ax + ay * ay < alternativeDistance * alternativeDistance) nearbyAlternative = true;
                }
            }
            if(nearbyAlternative) continue;
            var original = candidate.clearing || {};
            candidate.clearing = {
                x : candidate.tileX + info.centerOffsetX,
                y : candidate.tileY + info.centerOffsetY,
                radius : 6,
                role : original.role || "route_structure",
                source : "gameplay_plan",
                regionId : candidate.region ? candidate.region.id : original.regionId || "",
                routeFraction : original.routeFraction,
                routePhase : original.routePhase,
                topologyPurpose : original.topologyPurpose
            };
            // Reject an unsuitable replacement before reconstructing its route.
            if(search && search.accept && !search.accept(candidate)) continue;
            var path = approach(c, field, candidate.rect, info, spec, candidate.tileX, candidate.tileY);
            if(!path)
                continue;
            candidate.accessPath = path;
            candidate.accessPoint = path[0];
            candidate.accessTarget = path[path.length - 1];
            candidate.accessRouteLength = path.length;
            if(search && search.skip > 0) {
                alternatives.push(candidate);
                --search.skip;
                continue;
            }
            return candidate;
        }
        return null;
    };
})(MapGen.Layout.BuildingSites = MapGen.Layout.BuildingSites || {});
