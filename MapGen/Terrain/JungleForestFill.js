var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Cover = MapGen.Terrain.Cover || {};

(function(pJungle) {
    pJungle.MazeCorridorCanOpen = function(pContext, pX, pY) {
        var layers = pContext.Layers;
        if(!MapGen.Layers.InBounds(layers.path, pX, pY))
            return false;
        if(MapGen.Layers.Get(layers.water, pX, pY, 0) ||
            MapGen.Layers.Get(layers.occupied, pX, pY, 0))
            return false;

        var owner = layers.owner ?
            MapGen.Layers.Get(layers.owner, pX, pY, MapGen.Layers.Owner.NONE) :
            MapGen.Layers.Owner.NONE;
        return owner !== MapGen.Layers.Owner.WATER &&
            owner !== MapGen.Layers.Owner.STRUCTURE &&
            owner !== MapGen.Layers.Owner.CLIFF &&
            owner !== MapGen.Layers.Owner.OBJECT;
    };

    pJungle.StampMazeCorridorPoint = function(pContext, pX, pY, pRadius, pStats) {
        for(var dx = -pRadius; dx <= pRadius; ++dx) {
            for(var dy = -pRadius; dy <= pRadius; ++dy) {
                // A circular brush keeps corners from turning into square
                // plazas. With radius 1 this is a three-cell-wide corridor.
                if((dx * dx) + (dy * dy) > (pRadius * pRadius) + 1)
                    continue;
                var x = pX + dx;
                var y = pY + dy;
                if(!this.MazeCorridorCanOpen(pContext, x, y))
                    continue;

                if(!MapGen.Layers.Get(pContext.Layers.path, x, y, 0))
                    ++pStats.carvedCells;
                MapGen.Layers.Set(pContext.Layers.path, x, y, 1);
                MapGen.Layers.Set(pContext.Layers.keepClear, x, y, 1);
                MapGen.Layers.Set(pContext.Layers.blocked, x, y, 0);
                if(pContext.Layers.owner)
                    MapGen.Layers.ClaimCell(
                        pContext.Layers.owner,
                        x,
                        y,
                        MapGen.Layers.Owner.ROUTE
                    );
            }
        }
    };

    pJungle.StampMazeCorridorLine = function(pContext, pStart, pEnd, pRadius, pStats, pSalt) {
        var horizontalFirst = this.HashUnit(
            pContext,
            pStart.x + pEnd.x,
            pStart.y + pEnd.y,
            pSalt
        ) < 0.5;
        var x = pStart.x;
        var y = pStart.y;
        this.StampMazeCorridorPoint(pContext, x, y, pRadius, pStats);

        // Adjacent logical maze nodes are offset slightly so an L-shaped join
        // introduces a natural kink rather than producing a sterile grid.
        if(horizontalFirst) {
            while(x !== pEnd.x) {
                x += (pEnd.x > x) ? 1 : -1;
                this.StampMazeCorridorPoint(pContext, x, y, pRadius, pStats);
            }
            while(y !== pEnd.y) {
                y += (pEnd.y > y) ? 1 : -1;
                this.StampMazeCorridorPoint(pContext, x, y, pRadius, pStats);
            }
        } else {
            while(y !== pEnd.y) {
                y += (pEnd.y > y) ? 1 : -1;
                this.StampMazeCorridorPoint(pContext, x, y, pRadius, pStats);
            }
            while(x !== pEnd.x) {
                x += (pEnd.x > x) ? 1 : -1;
                this.StampMazeCorridorPoint(pContext, x, y, pRadius, pStats);
            }
        }
    };

    pJungle.MazeCorridorEdgeTouchesAuthoredPath = function(pContext, pStart, pEnd, pAuthoredPath, pPadding) {
        var padding = Math.max(0, Math.floor(pPadding || 0));
        var minX = Math.max(0, Math.min(pStart.x, pEnd.x) - padding);
        var maxX = Math.min(pContext.Width - 1, Math.max(pStart.x, pEnd.x) + padding);
        var minY = Math.max(0, Math.min(pStart.y, pEnd.y) - padding);
        var maxY = Math.min(pContext.Height - 1, Math.max(pStart.y, pEnd.y) + padding);

        for(var x = minX; x <= maxX; ++x) {
            for(var y = minY; y <= maxY; ++y) {
                if(!MapGen.Layers.Get(pAuthoredPath, x, y, 0))
                    continue;
                // The first node of a component is deliberately attached to
                // the mission route. Let its first branch leave that junction,
                // but reject every later crossing that would form a big loop
                // and turn the intervening forest wall into an isolated blob.
                if(Math.abs(x - pStart.x) + Math.abs(y - pStart.y) <= padding + 1)
                    continue;
                return true;
            }
        }
        return false;
    };

    pJungle.ReserveMazeBranchClearings = function(pContext, pNodes, pAuthoredPath) {
        var profile = pContext.Profile || {};
        var target = Number(profile.JungleMazeBranchClearingCount);
        if(isNaN(target))
            target = pContext.Width * pContext.Height >= 8192 ? 4 : 3;
        target = Math.max(0, Math.min(6, Math.floor(target)));
        if(!target || !MapGen.Layout.Clearings)
            return [];

        var radius = Number(profile.JungleMazeBranchClearingRadius);
        if(isNaN(radius))
            radius = pContext.Width * pContext.Height >= 8192 ? 5 : 4;
        radius = Math.max(3, Math.min(6, Math.floor(radius)));
        var candidates = [];
        for(var index = 0; index < pNodes.length; ++index) {
            var node = pNodes[index];
            if(node.degree !== 1 ||
                node.x < radius + 2 || node.y < radius + 2 ||
                node.x >= pContext.Width - radius - 2 ||
                node.y >= pContext.Height - radius - 2)
                continue;

            var pathDistance = 999999;
            for(var px = 0; px < pContext.Width; ++px) {
                for(var py = 0; py < pContext.Height; ++py) {
                    if(!MapGen.Layers.Get(pAuthoredPath, px, py, 0))
                        continue;
                    var distance = Math.abs(node.x - px) + Math.abs(node.y - py);
                    if(distance < pathDistance)
                        pathDistance = distance;
                }
            }
            if(pathDistance < radius + 4)
                continue;
            candidates.push({
                node: index,
                x: node.x,
                y: node.y,
                pathDistance: pathDistance,
                tie: MapGen.Random.HashTile(pContext.Seed, node.x, node.y, 1381)
            });
        }

        var selected = [];
        while(selected.length < target && candidates.length) {
            var bestIndex = -1;
            var bestScore = -1;
            for(index = 0; index < candidates.length; ++index) {
                var candidate = candidates[index];
                var spreadSq = candidate.pathDistance * candidate.pathDistance;
                for(var selectedIndex = 0; selectedIndex < selected.length; ++selectedIndex) {
                    var dx = candidate.x - selected[selectedIndex].x;
                    var dy = candidate.y - selected[selectedIndex].y;
                    var distanceSq = (dx * dx) + (dy * dy);
                    if(distanceSq < spreadSq)
                        spreadSq = distanceSq;
                }
                var score = (spreadSq * 1000) +
                    (candidate.pathDistance * 100) + (candidate.tie & 0xff);
                if(score > bestScore) {
                    bestScore = score;
                    bestIndex = index;
                }
            }
            if(bestIndex < 0)
                break;

            var picked = candidates.splice(bestIndex, 1)[0];
            var clearing = MapGen.Layout.Clearings.Add(
                pContext, picked, radius, "maze_branch", false
            );
            if(!clearing)
                continue;
            selected.push({
                node: picked.node,
                x: picked.x,
                y: picked.y,
                radius: radius,
                pathDistance: picked.pathDistance
            });
        }
        return selected;
    };

    // Cut a connected randomized depth-first maze into the jungle land before
    // the continuous forest fill. The authored gameplay route remains intact,
    // while this graph supplies the long side passages, turns and genuine
    // cul-de-sacs visible in mapm19/mapm28/mapm30.
    pJungle.BuildMazeCorridorNetwork = function(pContext) {
        var authoredPath = MapGen.Layers.Clone(pContext.Layers.path);
        var spacing = Math.max(6, this.RangeValue(
            pContext,
            "JungleMazeGridSpacing",
            8,
            10,
            pContext.Width,
            pContext.Height,
            1311
        ));
        var radius = Math.max(0, this.RangeValue(
            pContext,
            "JungleMazeCorridorRadius",
            1,
            1,
            pContext.Width,
            pContext.Height,
            1313
        ));
        var margin = Math.max(radius + 2, this.RangeValue(
            pContext,
            "JungleMazeGridMargin",
            4,
            5,
            0,
            0,
            1317
        ));
        var loopChance = this.RangeFloatValue(
            pContext,
            "JungleMazeLoopChance",
            0.06,
            0.12,
            pContext.Width,
            pContext.Height,
            1319
        );
        var usableWidth = Math.max(1, pContext.Width - (margin * 2));
        var usableHeight = Math.max(1, pContext.Height - (margin * 2));
        var columns = Math.max(2, Math.floor(usableWidth / spacing) + 1);
        var rows = Math.max(2, Math.floor(usableHeight / spacing) + 1);
        var widthRemainder = Math.max(0, usableWidth - ((columns - 1) * spacing));
        var heightRemainder = Math.max(0, usableHeight - ((rows - 1) * spacing));
        if(columns > 2 && widthRemainder < Math.floor(spacing * 0.45))
            --columns;
        if(rows > 2 && heightRemainder < Math.floor(spacing * 0.45))
            --rows;
        var startX = Math.floor((pContext.Width - ((columns - 1) * spacing)) / 2);
        var startY = Math.floor((pContext.Height - ((rows - 1) * spacing)) / 2);
        var nodes = [];
        var index;

        for(var row = 0; row < rows; ++row) {
            for(var column = 0; column < columns; ++column) {
                index = (row * columns) + column;
                var jitterX = Math.floor(this.HashUnit(pContext, column, row, 1321) * 3) - 1;
                var jitterY = Math.floor(this.HashUnit(pContext, column, row, 1327) * 3) - 1;
                nodes[index] = {
                    x: Math.max(margin, Math.min(pContext.Width - margin - 1, startX + (column * spacing) + jitterX)),
                    y: Math.max(margin, Math.min(pContext.Height - margin - 1, startY + (row * spacing) + jitterY)),
                    column: column,
                    row: row,
                    degree: 0
                };
            }
        }

        var stats = {
            spacing: spacing,
            radius: radius,
            columns: columns,
            rows: rows,
            nodes: nodes.length,
            edges: 0,
            loops: 0,
            deadEnds: 0,
            carvedCells: 0,
            connectorCells: 0
        };
        if(!nodes.length)
            return stats;

        var visited = [];
        for(index = 0; index < nodes.length; ++index)
            visited[index] = false;
        var stack = [];
        var visitedCount = 0;
        var rejectedEdges = {};
        var usedEdges = {};
        stats.components = 0;

        // The authored objective/access routes already form a connected graph.
        // Grow a DFS tree from them in each separated region, never crossing
        // back over that graph. The union stays branch-like and leaves long,
        // connected forest walls instead of making dozens of enclosed islands.
        while(visitedCount < nodes.length || stack.length) {
            if(!stack.length) {
                var root = -1;
                var nearestPath = null;
                var nearestDistance = 999999;
                for(index = 0; index < nodes.length; ++index) {
                    if(visited[index])
                        continue;
                    for(var px = 0; px < pContext.Width; ++px) {
                        for(var py = 0; py < pContext.Height; ++py) {
                            if(!MapGen.Layers.Get(authoredPath, px, py, 0))
                                continue;
                            var distance = Math.abs(nodes[index].x - px) + Math.abs(nodes[index].y - py);
                            if(distance < nearestDistance) {
                                nearestDistance = distance;
                                root = index;
                                nearestPath = { x: px, y: py };
                            }
                        }
                    }
                }
                if(root < 0) {
                    for(index = 0; index < nodes.length; ++index) {
                        if(!visited[index]) {
                            root = index;
                            break;
                        }
                    }
                }
                if(root < 0)
                    break;

                if(nearestPath) {
                    var beforeConnector = stats.carvedCells;
                    this.StampMazeCorridorLine(
                        pContext,
                        nodes[root],
                        nearestPath,
                        radius,
                        stats,
                        1331 + stats.components
                    );
                    stats.connectorCells += stats.carvedCells - beforeConnector;
                    ++nodes[root].degree;
                }
                visited[root] = true;
                ++visitedCount;
                ++stats.components;
                stack.push(root);
            }

            var currentIndex = stack[stack.length - 1];
            var current = nodes[currentIndex];
            var candidates = [];
            var edgeKey;
            if(current.column > 0 && !visited[currentIndex - 1]) {
                edgeKey = (currentIndex - 1) + "_" + currentIndex;
                if(!rejectedEdges[edgeKey])
                    candidates.push(currentIndex - 1);
            }
            if(current.column + 1 < columns && !visited[currentIndex + 1]) {
                edgeKey = currentIndex + "_" + (currentIndex + 1);
                if(!rejectedEdges[edgeKey])
                    candidates.push(currentIndex + 1);
            }
            if(current.row > 0 && !visited[currentIndex - columns]) {
                edgeKey = (currentIndex - columns) + "_" + currentIndex;
                if(!rejectedEdges[edgeKey])
                    candidates.push(currentIndex - columns);
            }
            if(current.row + 1 < rows && !visited[currentIndex + columns]) {
                edgeKey = currentIndex + "_" + (currentIndex + columns);
                if(!rejectedEdges[edgeKey])
                    candidates.push(currentIndex + columns);
            }

            if(!candidates.length) {
                stack.pop();
                continue;
            }

            var choice = Math.floor(this.HashUnit(
                pContext,
                currentIndex,
                visitedCount,
                1337
            ) * candidates.length);
            if(choice >= candidates.length)
                choice = candidates.length - 1;
            var nextIndex = candidates[choice];
            edgeKey = Math.min(currentIndex, nextIndex) + "_" + Math.max(currentIndex, nextIndex);
            if(this.MazeCorridorEdgeTouchesAuthoredPath(
                pContext,
                current,
                nodes[nextIndex],
                authoredPath,
                radius + 1
            )) {
                rejectedEdges[edgeKey] = true;
                continue;
            }
            this.StampMazeCorridorLine(
                pContext,
                current,
                nodes[nextIndex],
                radius,
                stats,
                1341 + stats.edges
            );
            ++current.degree;
            ++nodes[nextIndex].degree;
            ++stats.edges;
            usedEdges[edgeKey] = true;
            visited[nextIndex] = true;
            ++visitedCount;
            stack.push(nextIndex);
        }

        // A few deterministic cross-links make the forest traversable without
        // losing the characteristic DFS dead ends. Only east/south pairs need
        // consideration because every undirected neighbour otherwise repeats.
        for(index = 0; index < nodes.length; ++index) {
            var node = nodes[index];
            var neighbours = [];
            if(node.column + 1 < columns)
                neighbours.push(index + 1);
            if(node.row + 1 < rows)
                neighbours.push(index + columns);
            for(var neighbourIndex = 0; neighbourIndex < neighbours.length; ++neighbourIndex) {
                var otherIndex = neighbours[neighbourIndex];
                var other = nodes[otherIndex];
                edgeKey = Math.min(index, otherIndex) + "_" + Math.max(index, otherIndex);
                if(usedEdges[edgeKey] || rejectedEdges[edgeKey])
                    continue;
                if(this.MazeCorridorEdgeTouchesAuthoredPath(
                    pContext,
                    node,
                    other,
                    authoredPath,
                    radius + 1
                ))
                    continue;
                if(this.HashUnit(pContext, index, otherIndex, 1361) >= loopChance)
                    continue;
                this.StampMazeCorridorLine(
                    pContext,
                    node,
                    other,
                    radius,
                    stats,
                    1367 + stats.loops
                );
                ++node.degree;
                ++other.degree;
                ++stats.edges;
                ++stats.loops;
                usedEdges[edgeKey] = true;
            }
        }

        for(index = 0; index < nodes.length; ++index)
            if(nodes[index].degree === 1)
                ++stats.deadEnds;
        stats.branchClearings = this.ReserveMazeBranchClearings(
            pContext, nodes, authoredPath
        );

        MapGen.Context.AddLog(
            pContext,
            "Cut jungle maze corridor network (" + stats.nodes + " nodes, " +
                stats.deadEnds + " dead ends, " + stats.branchClearings.length +
                " branch clearings, " + stats.carvedCells + " new path cells)"
        );
        return stats;
    };

    // Original jungle mazes (notably mapm19/mapm28/mapm30) are authored as a
    // nearly continuous forest mass with the playable network cut out of it.
    // A coverage-ranked patch fill cannot reproduce that topology: it puts the
    // requested number of trees in attractive blobs, but leaves the gaps
    // between blobs joined into enormous fields. For maze profiles, invert the
    // operation. Layout/Connectivity have already reserved routes, clearings,
    // water, structures and every deliberate dead-end; fill all remaining
    // OPEN land so those reservations become corridors and chambers through a
    // connected tree wall.
    pJungle.ApplyMazeForestFill = function(pContext) {
        var layers = pContext.Layers;
        var ownerLayer = layers.owner;
        var eligible = 0;
        var stamped = 0;
        var skipped = {
            outer: 0,
            path: 0,
            water: 0,
            crossing: 0,
            causeway: 0,
            occupied: 0,
            owner: 0,
            coast: 0
        };

        // Clear only cells owned by the low-priority cover/open layers. Cliff
        // and feature blocking was authored before terrain cover and must
        // survive this reset.
        for(var clearX = 0; clearX < pContext.Width; ++clearX) {
            for(var clearY = 0; clearY < pContext.Height; ++clearY) {
                var clearOwner = ownerLayer ?
                    MapGen.Layers.Get(ownerLayer, clearX, clearY, MapGen.Layers.Owner.NONE) :
                    MapGen.Layers.Owner.OPEN;

                if(clearOwner === MapGen.Layers.Owner.NONE ||
                    clearOwner === MapGen.Layers.Owner.OPEN ||
                    clearOwner === MapGen.Layers.Owner.TREE)
                    MapGen.Layers.Set(layers.blocked, clearX, clearY, 0);
            }
        }

        // New maze profiles reserve the labyrinth in Layout, before
        // Connectivity chooses the mission route. Retain the terrain-time
        // builder only as a compatibility fallback for older/custom profiles.
        var mazeNetwork = pContext.RouteCorridor && pContext.RouteCorridor.mazeNetwork ?
            pContext.RouteCorridor.mazeNetwork :
            this.BuildMazeCorridorNetwork(pContext);

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(this.IsOuterCoverBuffer(pContext, x, y))
                {
                    ++skipped.outer;
                    continue;
                }
                if(MapGen.Layers.Get(layers.path, x, y, 0)) {
                    ++skipped.path;
                    continue;
                }
                if(MapGen.Layers.Get(layers.water, x, y, 0)) {
                    ++skipped.water;
                    continue;
                }
                if(MapGen.Layers.Get(layers.crossing, x, y, 0)) {
                    ++skipped.crossing;
                    continue;
                }
                if(MapGen.Layers.Get(layers.causeway, x, y, 0)) {
                    ++skipped.causeway;
                    continue;
                }
                if(MapGen.Layers.Get(layers.occupied, x, y, 0)) {
                    ++skipped.occupied;
                    continue;
                }

                // keepClear is deliberately not sufficient to open a maze
                // cell. Route planning uses a broad keepClear halo as search
                // bookkeeping; preserving that halo is what made the old maze
                // output one huge lawn. High-priority ownership and the actual
                // path layer remain authoritative.
                var owner = ownerLayer ?
                    MapGen.Layers.Get(ownerLayer, x, y, MapGen.Layers.Owner.NONE) :
                    MapGen.Layers.Owner.OPEN;
                if(owner !== MapGen.Layers.Owner.NONE &&
                    owner !== MapGen.Layers.Owner.OPEN &&
                    owner !== MapGen.Layers.Owner.TREE) {
                    ++skipped.owner;
                    continue;
                }
                if(MapGen.Layers.Get(layers.coast, x, y, 0) && !this.TreesMayUseCoast(pContext)) {
                    ++skipped.coast;
                    continue;
                }

                ++eligible;
                this.MarkTreeCell(pContext, x, y);
                ++stamped;
            }
        }

        pContext._mazeForestFill = {
            eligible: eligible,
            stamped: stamped,
            skipped: skipped,
            network: mazeNetwork,
            mode: "reserved_corridors_through_continuous_forest"
        };

        MapGen.Context.AddLog(
            pContext,
            "Applied jungle maze forest fill (" + stamped +
                " tree-wall cells around reserved corridors)"
        );

        return pContext._mazeForestFill;
    };

    pJungle.SamplePatchSize = function(pContext, pX, pY, pAlpha, pMin, pMax) {
        var u = this.HashUnit(pContext, pX, pY, 411);
        if(u >= 0.9999) u = 0.9999;
        if(u <  0.0001) u = 0.0001;
        var size = Math.floor(pMin / Math.pow(1 - u, 1 / pAlpha));
        if(size < pMin) size = pMin;
        if(size > pMax) size = pMax;
        return size;
    };

    pJungle.GrowPatch = function(pContext, pSeed, pSize) {
        var blocked = pContext.Layers.blocked;
        var visited = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
        var frontier = [{ x: pSeed.x, y: pSeed.y, dist: 0 }];
        visited[pSeed.x][pSeed.y] = 1;

        // Density gradient: cells within coreRadius stamp 100%; beyond, the
        // probability falls linearly to ~30% at the patch's outer ring. Gives
        // patches dense cores with feathered edges (spec: "cores denser than
        // edges").
        var coreRadius = Math.max(2, Math.sqrt(pSize / Math.PI));
        var maxDist = coreRadius * 2.5;
        var stamped = 0;
        var visits = 0;
        var maxVisits = pSize * 4;

        while(frontier.length && stamped < pSize && visits < maxVisits) {
            ++visits;
            // Hash-rank the frontier — the cell with the highest "lobe bias"
            // (most blocked 4-neighbours) goes first, with a hash tiebreak.
            // Produces organic lobed shapes instead of round blobs.
            var bestIdx = 0;
            var bestScore = -1;
            for(var fi = 0; fi < frontier.length; ++fi) {
                var fc = frontier[fi];
                var nbrs = 0;
                if(MapGen.Layers.Get(blocked, fc.x + 1, fc.y, 0)) ++nbrs;
                if(MapGen.Layers.Get(blocked, fc.x - 1, fc.y, 0)) ++nbrs;
                if(MapGen.Layers.Get(blocked, fc.x, fc.y + 1, 0)) ++nbrs;
                if(MapGen.Layers.Get(blocked, fc.x, fc.y - 1, 0)) ++nbrs;
                var jitter = this.HashUnit(pContext, fc.x, fc.y, 412);
                var score = nbrs + jitter * 0.5;
                if(score > bestScore) {
                    bestScore = score;
                    bestIdx = fi;
                }
            }
            var cell = frontier[bestIdx];
            frontier.splice(bestIdx, 1);

            if(this.IsExcluded(pContext, cell.x, cell.y))
                continue;
            if(cell.dist > maxDist)
                continue;

            var density = (cell.dist <= coreRadius) ?
                1.0 :
                Math.max(0.30, 1 - (cell.dist - coreRadius) / coreRadius);
            var roll = this.HashUnit(pContext, cell.x, cell.y, 413);
            if(roll > density)
                continue;

            this.MarkTreeCell(pContext, cell.x, cell.y);
            ++stamped;

            var dirs = [[1,0],[-1,0],[0,1],[0,-1]];
            for(var d = 0; d < dirs.length; ++d) {
                var nx = cell.x + dirs[d][0];
                var ny = cell.y + dirs[d][1];
                if(!MapGen.Layers.InBounds(visited, nx, ny)) continue;
                if(visited[nx][ny]) continue;
                visited[nx][ny] = 1;
                frontier.push({ x: nx, y: ny, dist: cell.dist + 1 });
            }
        }

        return stamped;
    };

    pJungle.PatchAndGrow = function(pContext) {
        var profile = pContext.Profile;
        var area = pContext.Width * pContext.Height;
        var density = (typeof profile.ForestSeedDensity === "number") ? profile.ForestSeedDensity : 0.005;
        var alpha = (typeof profile.ForestPatchAlpha === "number") ? profile.ForestPatchAlpha : 1.4;
        var minSize = (typeof profile.ForestPatchMinSize === "number") ? profile.ForestPatchMinSize : 8;
        var maxSize = (typeof profile.ForestPatchMaxSize === "number") ? profile.ForestPatchMaxSize : 60;
        var seedCount = Math.max(1, Math.round(area * density));

        // Wipe blocked layer so seeds land on a clean canvas (matches old
        // ApplyTreeMask's first pass).
        for(var wx = 0; wx < pContext.Width; ++wx)
            for(var wy = 0; wy < pContext.Height; ++wy)
                MapGen.Layers.Set(pContext.Layers.blocked, wx, wy, 0);

        // Candidate pool: anywhere not hard-excluded, with TreeScore as the
        // selection weight. Top `seedCount` cells (with hash tiebreak so
        // seeds spread instead of clustering at peak-noise crests) become
        // patch origins.
        //
        // ForestSeedEdgeClearance: extra buffer that ONLY applies to seed
        // placement. With AllowOuterEdgeCover=true (the ice path), the
        // generic IsOuterCoverBuffer collapses to 0 so the perimeter cover
        // band and other passes can stamp at the literal map edge. But
        // forest *seeds* placed at the edge produce thin foliage bands
        // clipped at the map boundary (a tree centered at y=0 has its top
        // half off-map). This narrower knob keeps seeds inside the buffer
        // without changing any other pass's outer-edge behaviour. See
        // [[mapgen_cliff_stop_topology]] companion-fix update.
        var seedEdgeClearance = Number(profile.ForestSeedEdgeClearance);
        if(isNaN(seedEdgeClearance) || seedEdgeClearance < 0)
            seedEdgeClearance = 0;
        // ForestSeedJitter: weight of the per-cell HashUnit relative to the
        // 0..1 TreeScore. Default 0.40 (legacy; preserves jungle/beach byte-
        // identity since they don't override). Ice profiles set higher (0.80
        // recommended) to break the 0.66-weight largeScale value-noise lobe
        // dominance documented in [[ice_forest_seed_quadrant_bias]] — pooled
        // ice median p≈1e-31 against uniform-by-land null. Higher jitter lets
        // the per-cell hash compete with the noise lobe so patches spread
        // across the map instead of all landing in one quadrant.
        var seedJitter = Number(profile.ForestSeedJitter);
        if(isNaN(seedJitter) || seedJitter < 0)
            seedJitter = 0.40;
        var candidates = [];
        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(this.IsExcluded(pContext, x, y)) continue;
                if(seedEdgeClearance > 0 && this.PerimeterDistance(pContext, x, y) < seedEdgeClearance)
                    continue;
                var jitter = this.HashUnit(pContext, x, y, 410) * seedJitter;
                var intentForest = false;
                if(pContext.IntentMap && MapGen.Intent && MapGen.Intent.Terrain) {
                    var intentIndex = (y * pContext.IntentMap.width) + x;
                    intentForest = pContext.IntentMap.terrain[intentIndex] ===
                        MapGen.Intent.Terrain.FOREST;
                }
                candidates.push({
                    x: x,
                    y: y,
                    score: this.TreeScore(pContext, x, y) + jitter,
                    intentForest: intentForest
                });
            }
        }
        candidates.sort(function(pA, pB) {
            if(pA.score !== pB.score)
                return pB.score - pA.score;
            if(pA.x !== pB.x)
                return pA.x - pB.x;
            return pA.y - pB.y;
        });

        // Spread seeds: skip a candidate if another seed is too close. Min
        // separation ≈ sqrt(meanPatchArea / π) so patches barely overlap on
        // average. With α=1.4, mean ≈ α·xmin/(α−1) = 28; radius ≈ 3.
        var minSepSq = 9;
        var seeds = [];
        function farEnough(pCandidate) {
            for(var si = 0; si < seeds.length; ++si) {
                var ddx = seeds[si].x - pCandidate.x;
                var ddy = seeds[si].y - pCandidate.y;
                if((ddx * ddx) + (ddy * ddy) < minSepSq)
                    return false;
            }
            return true;
        }

        // v3 Concepts already authored the spatial FOREST proposal. Seed its
        // best candidate in each 3x3 map sector before filling from the global
        // score list; otherwise a single large-scale noise lobe can consume
        // all 12-15 origins and turn a map-wide forest proposal into one
        // corner blob. Legacy generators have no IntentMap and retain their
        // original global ranking byte-for-byte.
        var stratifiedSeeds = 0;
        if(pContext.IntentMap && seedCount > 1) {
            var sectorBest = {};
            for(var sc = 0; sc < candidates.length; ++sc) {
                var sectorCandidate = candidates[sc];
                if(!sectorCandidate.intentForest)
                    continue;
                var sectorX = Math.min(2,
                    Math.floor(sectorCandidate.x * 3 / pContext.Width));
                var sectorY = Math.min(2,
                    Math.floor(sectorCandidate.y * 3 / pContext.Height));
                var sectorKey = sectorY * 3 + sectorX;
                if(!sectorBest.hasOwnProperty(sectorKey))
                    sectorBest[sectorKey] = sectorCandidate;
            }
            for(var sectorIndex = 0;
                sectorIndex < 9 && seeds.length < seedCount;
                ++sectorIndex) {
                var best = sectorBest[sectorIndex];
                if(best && farEnough(best)) {
                    seeds.push({ x: best.x, y: best.y });
                    ++stratifiedSeeds;
                }
            }
        }

        for(var ci = 0; ci < candidates.length && seeds.length < seedCount; ++ci) {
            var cand = candidates[ci];
            if(farEnough(cand))
                seeds.push({ x: cand.x, y: cand.y });
        }

        var totalStamped = 0;
        for(var k = 0; k < seeds.length; ++k) {
            var s = seeds[k];
            var size = this.SamplePatchSize(pContext, s.x, s.y, alpha, minSize, maxSize);
            totalStamped += this.GrowPatch(pContext, s, size);
        }

        pContext._forestPatches = {
            seeds: seeds.length,
            stratifiedSeeds: stratifiedSeeds,
            stamped: totalStamped,
            density: density
        };

        // Coverage rebalance: the validator/repair pass enforces TreeCoverage
        // bounds via Repair.ThinTreesToTarget / GrowTreesToTarget, so we
        // don't need to hit `coverage` exactly here — just produce visually
        // discrete patches and let the repair loop trim/grow if out of band.
        MapGen.Context.AddLog(pContext, "Applied patch-and-grow forest (" + seeds.length + " patches, " + totalStamped + " tiles)");
    };

    pJungle.CarvedForestCoverage = function(pContext) {
        var profile = pContext.Profile || {};
        var fallback = Number(profile.TreeCoverage);
        if(isNaN(fallback))
            fallback = 0.50;

        var coverage = this.RangeFloatValue(
            pContext,
            "CarvedForestCoverage",
            fallback,
            fallback,
            pContext.Width,
            pContext.Height,
            1241
        );

        if(isNaN(coverage))
            coverage = fallback;

        return Math.max(0, Math.min(0.90, coverage));
    };

    pJungle.CarvedForestSectorSize = function(pContext) {
        return Math.max(8, this.RangeValue(pContext, "CarvedForestSectorSize", 16, 18, pContext.Width, pContext.Height, 1231));
    };

    pJungle.CarvedForestSectorCoverage = function(pContext) {
        var coverage = this.RangeFloatValue(pContext, "CarvedForestSectorCoverage", 0, 0, pContext.Width, pContext.Height, 1233);

        if(isNaN(coverage))
            coverage = 0;

        return Math.max(0, Math.min(0.75, coverage));
    };

    pJungle.ApplySectorForestFill = function(pContext) {
        var profile = pContext.Profile || {};
        if(profile.CarvedForestSectorFill === false)
            return { sectors: 0, stamped: 0 };

        var sectorCoverage = this.CarvedForestSectorCoverage(pContext);
        if(sectorCoverage <= 0)
            return { sectors: 0, stamped: 0 };

        var sectorSize = this.CarvedForestSectorSize(pContext);
        var blocked = pContext.Layers.blocked;
        var sectors = 0;
        var stampedTotal = 0;

        for(var sx = 0; sx < pContext.Width; sx += sectorSize) {
            for(var sy = 0; sy < pContext.Height; sy += sectorSize) {
                var candidates = [];
                var eligible = 0;
                var current = 0;
                var maxX = Math.min(pContext.Width, sx + sectorSize);
                var maxY = Math.min(pContext.Height, sy + sectorSize);

                for(var x = sx; x < maxX; ++x) {
                    for(var y = sy; y < maxY; ++y) {
                        if(this.IsExcluded(pContext, x, y))
                            continue;

                        ++eligible;
                        if(MapGen.Layers.Get(blocked, x, y, 0)) {
                            ++current;
                            continue;
                        }

                        candidates.push({
                            x: x,
                            y: y,
                            score: this.TreeScore(pContext, x, y) + (this.HashUnit(pContext, x, y, 1237) * 0.22)
                        });
                    }
                }

                if(eligible < 24 || !candidates.length)
                    continue;

                var target = Math.max(0, Math.min(eligible, Math.round(eligible * sectorCoverage)));
                if(current >= target)
                    continue;

                candidates.sort(function(pA, pB) {
            if(pA.score !== pB.score)
                return pB.score - pA.score;
            if(pA.x !== pB.x)
                return pA.x - pB.x;
            return pA.y - pB.y;
        });

                var needed = target - current;
                var stamped = 0;
                for(var index = 0; index < candidates.length && stamped < needed; ++index) {
                    this.MarkTreeCell(pContext, candidates[index].x, candidates[index].y);
                    ++stamped;
                }

                if(stamped) {
                    ++sectors;
                    stampedTotal += stamped;
                }
            }
        }

        pContext._sectorForestFill = {
            sectors: sectors,
            stamped: stampedTotal,
            sectorSize: sectorSize,
            sectorCoverage: sectorCoverage
        };

        if(stampedTotal)
            MapGen.Context.AddLog(pContext, "Applied sector forest fill (" + sectors + " sectors, " + stampedTotal + " tiles)");

        return pContext._sectorForestFill;
    };

    pJungle.ApplyCarvedForestFill = function(pContext) {
        var profile = pContext.Profile || {};
        if(profile.CarvedForestFill === false)
            return { stamped: 0, target: 0, eligible: 0 };

        var coverage = this.CarvedForestCoverage(pContext);
        var blocked = pContext.Layers.blocked;
        var candidates = [];
        var eligible = 0;
        var current = 0;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(this.IsExcluded(pContext, x, y))
                    continue;

                ++eligible;
                if(MapGen.Layers.Get(blocked, x, y, 0)) {
                    ++current;
                    continue;
                }

                candidates.push({
                    x: x,
                    y: y,
                    score: this.TreeScore(pContext, x, y) + (this.HashUnit(pContext, x, y, 1243) * 0.18)
                });
            }
        }

        var target = Math.max(0, Math.min(eligible, Math.round(eligible * coverage)));
        if(current >= target || !candidates.length) {
            pContext._carvedForestFill = {
                stamped: 0,
                current: current,
                target: target,
                eligible: eligible,
                coverage: coverage
            };
            MapGen.Context.AddLog(pContext, "Skipped carved forest fill (" + current + "/" + target + " cover tiles)");
            return pContext._carvedForestFill;
        }

        candidates.sort(function(pA, pB) {
            if(pA.score !== pB.score)
                return pB.score - pA.score;
            if(pA.x !== pB.x)
                return pA.x - pB.x;
            return pA.y - pB.y;
        });

        var stamped = 0;
        var needed = target - current;
        for(var index = 0; index < candidates.length && stamped < needed; ++index) {
            this.MarkTreeCell(pContext, candidates[index].x, candidates[index].y);
            ++stamped;
        }

        pContext._carvedForestFill = {
            stamped: stamped,
            current: current + stamped,
            target: target,
            eligible: eligible,
            coverage: coverage
        };

        MapGen.Context.AddLog(pContext, "Applied carved forest fill (" + stamped + " tiles, target " + target + "/" + eligible + ")");
        return pContext._carvedForestFill;
    };
})(MapGen.Terrain.Cover);
