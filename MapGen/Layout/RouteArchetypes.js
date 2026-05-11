var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// First-class route archetype planning.
//
// This runs before water/cliffs/trees. It builds a semantic corridor mask that
// later passes can read: route core, centerline, edge-cover band, narrow
// chokepoint segments, and small route-phase pockets for structures/pickups.
// Connectivity still owns the exact A* route; this module gives terrain and
// placement a shared route shape to aim at instead of hoping profile density
// knobs accidentally produce a maze or funnel.
MapGen.Layout.RouteArchetypes = {
    Definitions: function() {
        return {
            outpost: {
                halfWidth: 2,
                edgeWidth: 3,
                bendCount: 1,
                bendAmplitude: 0.10,
                pocketRadius: 3,
                pocketFractions: [0.30, 0.62],
                edgeCoverChance: 0.35
            },
            compound_route: {
                halfWidth: 2,
                edgeWidth: 3,
                bendCount: 2,
                bendAmplitude: 0.12,
                pocketRadius: 4,
                pocketFractions: [0.42, 0.70, 0.84],
                edgeCoverChance: 0.42
            },
            winding_route: {
                halfWidth: 2,
                edgeWidth: 3,
                bendCount: 3,
                bendAmplitude: 0.20,
                pocketRadius: 4,
                pocketFractions: [0.20, 0.42, 0.65, 0.82],
                edgeCoverChance: 0.46
            },
            open_route: {
                halfWidth: 3,
                edgeWidth: 2,
                bendCount: 2,
                bendAmplitude: 0.09,
                pocketRadius: 5,
                pocketFractions: [0.34, 0.68],
                edgeCoverChance: 0.42
            },
            broken_trail: {
                halfWidth: 1,
                edgeWidth: 3,
                bendCount: 3,
                bendAmplitude: 0.16,
                narrowHalfWidth: 0,
                narrowBands: [[0.30, 0.36], [0.62, 0.69]],
                pocketRadius: 2,
                pocketFractions: [0.28, 0.57, 0.82],
                edgeCoverChance: 0.52,
                outsideCoverChance: 0.06,
                sideCoverChance: 0.28,
                sideCoverDistance: 4
            },
            maze: {
                halfWidth: 1,
                edgeWidth: 4,
                bendCount: 4,
                bendAmplitude: 0.22,
                narrowHalfWidth: 0,
                narrowBands: [[0.18, 0.26], [0.42, 0.50], [0.66, 0.74]],
                pocketRadius: 2,
                pocketFractions: [0.24, 0.48, 0.70, 0.84],
                edgeCoverChance: 0.78,
                outsideCoverChance: 0.24,
                sideCoverChance: 0.70,
                sideCoverDistance: 5,
                sealOffRouteFragments: true
            },
            neck: {
                halfWidth: 1,
                edgeWidth: 4,
                bendCount: 2,
                bendAmplitude: 0.16,
                narrowHalfWidth: 0,
                narrowBands: [[0.30, 0.38], [0.56, 0.66], [0.78, 0.86]],
                pocketRadius: 2,
                pocketFractions: [0.36, 0.60, 0.80],
                edgeCoverChance: 0.86,
                outsideCoverChance: 0.20,
                sideCoverChance: 0.92,
                sideCoverDistance: 5,
                gateCoverChance: 0.95,
                gateSpacing: 4,
                actualGateRepairChance: 1.00,
                actualGateRepairSpacing: 7,
                actualGateRepairHalfLength: 14,
                actualGateRepairThickness: 2,
                actualGateRepairGap: 0,
                actualGateRepairEndpointTrim: 0.12,
                actualGateRepairMaxGates: 10,
                actualSideRepairChance: 1.00,
                actualSideRepairDistance: 5,
                actualSideRepairThickness: 1,
                actualSideRepairTangentDepth: 1,
                actualSideRepairSpacing: 1,
                sealOffRouteFragments: true
            },
            vehicle_jump_route: {
                halfWidth: 2,
                edgeWidth: 3,
                bendCount: 2,
                bendAmplitude: 0.12,
                narrowHalfWidth: 1,
                narrowBands: [[0.38, 0.46], [0.68, 0.76]],
                pocketRadius: 3,
                pocketFractions: [0.34, 0.58, 0.78],
                edgeCoverChance: 0.45,
                outsideCoverChance: 0.08
            }
        };
    },

    Clamp: function(pValue, pMin, pMax) {
        if(isNaN(pValue))
            return pMin;
        if(pValue < pMin)
            return pMin;
        if(pValue > pMax)
            return pMax;
        return pValue;
    },

    HashUnit: function(pContext, pX, pY, pSalt) {
        return MapGen.Random.HashTile(pContext.Seed || 0, pX || 0, pY || 0, pSalt || 0) / 4294967295;
    },

    ProfileString: function(pProfile, pKey) {
        var value = pProfile ? pProfile[pKey] : null;
        if(value === undefined || value === null)
            return "";
        value = String(value);
        return value.length ? value : "";
    },

    PickWeightedName: function(pContext, pWeights) {
        if(!pWeights || typeof pWeights !== "object")
            return "";

        var defs = this.Definitions();
        var entries = [];
        var total = 0;
        var key;
        for(key in pWeights) {
            if(!pWeights.hasOwnProperty(key) || !defs[key])
                continue;
            var weight = Number(pWeights[key]);
            if(isNaN(weight) || weight <= 0)
                continue;
            entries.push({ name: key, weight: weight });
            total += weight;
        }
        if(!entries.length || total <= 0)
            return "";

        // Stable ordering plus a seed hash keeps the choice deterministic and
        // independent of how many mutable RNG calls earlier layout stages make.
        entries.sort(function(pLeft, pRight) {
            return pLeft.name < pRight.name ? -1 : (pLeft.name > pRight.name ? 1 : 0);
        });
        var roll = this.HashUnit(
            pContext,
            (pContext.Width || 0) + entries.length,
            pContext.Height || 0,
            6121
        ) * total;
        var cumulative = 0;
        for(var index = 0; index < entries.length; ++index) {
            cumulative += entries[index].weight;
            if(roll <= cumulative)
                return entries[index].name;
        }
        return entries[entries.length - 1].name;
    },

    ResolveName: function(pContext) {
        var profile = pContext ? (pContext.Profile || {}) : {};
        var forced = this.ProfileString(profile, "RouteArchetype") ||
            this.ProfileString(profile, "ForcedRouteArchetype");
        var profileName = this.ProfileString(profile, "Name");
        var mobility = this.ProfileString(profile, "ForcedMobilityMode");

        if(forced)
            return forced;
        if(profileName.indexOf("_maze") >= 0)
            return "maze";
        if(profileName.indexOf("_neck") >= 0)
            return "neck";
        if(profileName.indexOf("_skidoo_jump") >= 0 || mobility === "skidoo_jump" || mobility === "vehicle_jump")
            return "vehicle_jump_route";
        if(profileName.indexOf("_compound") >= 0)
            return "compound_route";

        var weighted = this.PickWeightedName(pContext, profile.RouteArchetypes);
        if(weighted)
            return weighted;

        return "outpost";
    },

    Resolve: function(pContext) {
        var defs = this.Definitions();
        var name = this.ResolveName(pContext);
        var def = defs[name] || defs.outpost;

        return {
            name: defs[name] ? name : "outpost",
            definition: def
        };
    },

    AnchorChain: function(pContext) {
        var a = pContext.Anchors || {};
        var chain = [];

        if(a.start) {
            chain.push(a.start);
            if(a.objective) chain.push(a.objective);
            else if(a.objectiveB) chain.push(a.objectiveB);
        }
        else if(a.teamA && a.teamB) {
            chain.push(a.teamA);
            if(a.contested) chain.push(a.contested);
            chain.push(a.teamB);
        }

        return chain;
    },

    EnsureMask: function(pContext) {
        if(pContext.RouteCorridor && pContext.RouteCorridor.width === pContext.Width && pContext.RouteCorridor.height === pContext.Height)
            return pContext.RouteCorridor;

        pContext.RouteCorridor = {
            schema: 1,
            width: pContext.Width,
            height: pContext.Height,
            archetype: "",
            core: MapGen.Layers.Create(pContext.Width, pContext.Height, 0),
            center: MapGen.Layers.Create(pContext.Width, pContext.Height, 0),
            edge: MapGen.Layers.Create(pContext.Width, pContext.Height, 0),
            pocket: MapGen.Layers.Create(pContext.Width, pContext.Height, 0),
            narrow: MapGen.Layers.Create(pContext.Width, pContext.Height, 0),
            points: [],
            pockets: [],
            stampedCore: 0,
            stampedEdge: 0,
            stampedPockets: 0,
            edgeCover: null
        };
        return pContext.RouteCorridor;
    },

    LinePoints: function(pA, pB) {
        var points = [];
        var x0 = pA.x | 0, y0 = pA.y | 0;
        var x1 = pB.x | 0, y1 = pB.y | 0;
        var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
        var sx = x0 < x1 ? 1 : -1;
        var sy = y0 < y1 ? 1 : -1;
        var err = dx - dy;
        var guard = (dx + dy) * 2 + 8;

        while(guard-- > 0) {
            points.push({ x: x0, y: y0 });
            if(x0 === x1 && y0 === y1)
                break;
            var e2 = 2 * err;
            if(e2 > -dy) { err -= dy; x0 += sx; }
            if(e2 < dx) { err += dx; y0 += sy; }
        }

        return points;
    },

    BuildControlPoints: function(pContext, pStart, pEnd, pDef, pSegmentIndex) {
        var profile = pContext.Profile || {};
        var count = Math.max(0, Math.floor(Number(profile.RouteArchetypeBends !== undefined ? profile.RouteArchetypeBends : pDef.bendCount) || 0));
        var amplitude = Number(profile.RouteArchetypeBendAmplitude !== undefined ? profile.RouteArchetypeBendAmplitude : pDef.bendAmplitude);
        if(isNaN(amplitude))
            amplitude = 0;

        var points = [{ x: pStart.x, y: pStart.y }];
        var dx = pEnd.x - pStart.x;
        var dy = pEnd.y - pStart.y;
        var length = Math.max(1, Math.sqrt((dx * dx) + (dy * dy)));
        var nx = -dy / length;
        var ny = dx / length;
        var sideSeed = this.HashUnit(pContext, pStart.x + pSegmentIndex, pStart.y, 6171) < 0.5 ? -1 : 1;
        var maxAmp = Math.min(pContext.Width, pContext.Height) * amplitude;
        var margin = Math.max(4, Math.floor(Number(profile.RouteArchetypeMapMargin || 5)));

        for(var index = 0; index < count; ++index) {
            var t = (index + 1) / (count + 1);
            var wave = (index % 2 === 0 ? sideSeed : -sideSeed);
            var jitter = (this.HashUnit(pContext, pStart.x + index, pEnd.y + pSegmentIndex, 6173) - 0.5) * maxAmp * 0.35;
            var amp = (maxAmp * wave) + jitter;
            var x = pStart.x + (dx * t) + (nx * amp);
            var y = pStart.y + (dy * t) + (ny * amp);

            points.push({
                x: Math.round(this.Clamp(x, margin, pContext.Width - 1 - margin)),
                y: Math.round(this.Clamp(y, margin, pContext.Height - 1 - margin))
            });
        }

        points.push({ x: pEnd.x, y: pEnd.y });
        return points;
    },

    BuildRoutePoints: function(pContext, pChain, pDef) {
        var all = [];
        for(var segment = 0; segment + 1 < pChain.length; ++segment) {
            var controls = this.BuildControlPoints(pContext, pChain[segment], pChain[segment + 1], pDef, segment);
            for(var index = 0; index + 1 < controls.length; ++index) {
                var line = this.LinePoints(controls[index], controls[index + 1]);
                for(var li = 0; li < line.length; ++li) {
                    if(all.length && all[all.length - 1].x === line[li].x && all[all.length - 1].y === line[li].y)
                        continue;
                    all.push(line[li]);
                }
            }
        }
        return all;
    },

    ProfileRange: function(pContext, pName, pDefaultMin, pDefaultMax, pSalt, pInteger) {
        var value = (pContext.Profile || {})[pName];
        var min = pDefaultMin;
        var max = pDefaultMax;

        if(value instanceof Array && value.length >= 2) {
            min = Number(value[0]);
            max = Number(value[1]);
        } else if(value !== undefined && value !== null) {
            min = Number(value);
            max = min;
        }
        if(isNaN(min)) min = pDefaultMin;
        if(isNaN(max) || max < min) max = min;

        var result = min + ((max - min) * this.HashUnit(
            pContext,
            pContext.Width,
            pContext.Height,
            pSalt
        ));
        return pInteger ? Math.round(result) : result;
    },

    MazeNearestNode: function(pNodes, pPoint) {
        var best = 0;
        var bestDistance = Infinity;
        for(var index = 0; index < pNodes.length; ++index) {
            var distance = Math.abs(pNodes[index].x - pPoint.x) +
                Math.abs(pNodes[index].y - pPoint.y);
            if(distance < bestDistance) {
                bestDistance = distance;
                best = index;
            }
        }
        return best;
    },

    BuildMazeGraphCandidate: function(pContext, pNodes, pColumns, pRows, pRoot, pCandidate, pStraightBias) {
        var adjacency = [];
        var visited = [];
        var edges = [];
        var index;
        for(index = 0; index < pNodes.length; ++index) {
            adjacency[index] = [];
            visited[index] = false;
        }

        var stack = [pRoot];
        var stackDirections = [{ x: 0, y: 0 }];
        var visitedCount = 1;
        visited[pRoot] = true;
        while(stack.length) {
            var current = stack[stack.length - 1];
            var node = pNodes[current];
            var candidates = [];
            if(node.column > 0 && !visited[current - 1])
                candidates.push(current - 1);
            if(node.column + 1 < pColumns && !visited[current + 1])
                candidates.push(current + 1);
            if(node.row > 0 && !visited[current - pColumns])
                candidates.push(current - pColumns);
            if(node.row + 1 < pRows && !visited[current + pColumns])
                candidates.push(current + pColumns);

            if(!candidates.length) {
                stack.pop();
                stackDirections.pop();
                continue;
            }

            var choice = -1;
            var previousDirection = stackDirections[stackDirections.length - 1];
            if(previousDirection && (previousDirection.x || previousDirection.y) &&
                this.HashUnit(
                    pContext,
                    current + (pCandidate * 97),
                    visitedCount,
                    7009 + (pCandidate * 17)
                ) < pStraightBias) {
                for(var straightIndex = 0; straightIndex < candidates.length; ++straightIndex) {
                    var straightNode = pNodes[candidates[straightIndex]];
                    var straightX = straightNode.column - node.column;
                    var straightY = straightNode.row - node.row;
                    if(straightX === previousDirection.x && straightY === previousDirection.y) {
                        choice = straightIndex;
                        break;
                    }
                }
            }
            if(choice < 0)
                choice = Math.floor(this.HashUnit(
                    pContext,
                    current + (pCandidate * 97),
                    visitedCount,
                    7013 + (pCandidate * 17)
                ) * candidates.length);
            if(choice >= candidates.length)
                choice = candidates.length - 1;
            var next = candidates[choice];
            var nextDirection = {
                x: pNodes[next].column - node.column,
                y: pNodes[next].row - node.row
            };
            edges.push({ a: current, b: next });
            adjacency[current].push(next);
            adjacency[next].push(current);
            visited[next] = true;
            ++visitedCount;
            stack.push(next);
            stackDirections.push(nextDirection);
        }

        return {
            adjacency: adjacency,
            edges: edges,
            candidate: pCandidate
        };
    },

    MazeNodePath: function(pAdjacency, pStart, pEnd) {
        var parent = [];
        var queue = [pStart];
        var head = 0;
        for(var index = 0; index < pAdjacency.length; ++index)
            parent[index] = -2;
        parent[pStart] = -1;

        while(head < queue.length) {
            var current = queue[head++];
            if(current === pEnd)
                break;
            var neighbours = pAdjacency[current] || [];
            for(var ni = 0; ni < neighbours.length; ++ni) {
                var next = neighbours[ni];
                if(parent[next] !== -2)
                    continue;
                parent[next] = current;
                queue.push(next);
            }
        }

        if(parent[pEnd] === -2)
            return [];
        var reverse = [];
        var cursor = pEnd;
        while(cursor >= 0) {
            reverse.push(cursor);
            cursor = parent[cursor];
        }
        var path = [];
        for(index = reverse.length - 1; index >= 0; --index)
            path.push(reverse[index]);
        return path;
    },

    AppendConnectedMazeLine: function(pContext, pTarget, pA, pB, pSalt) {
        var line = this.LinePoints(pA, pB);
        for(var index = 0; index < line.length; ++index) {
            var point = line[index];
            if(pTarget.length) {
                var previous = pTarget[pTarget.length - 1];
                var diagonal = previous.x !== point.x && previous.y !== point.y;
                if(diagonal) {
                    // Bresenham diagonals only meet at a corner. Insert one of
                    // the two orthogonal bridge cells so the thin maze remains
                    // four-way connected while its visible edge reads as a
                    // diagonal staircase rather than an axis-aligned dogleg.
                    var horizontalFirst = this.HashUnit(
                        pContext,
                        previous.x + index,
                        previous.y + pSalt,
                        7037 + pSalt
                    ) < 0.5;
                    pTarget.push(horizontalFirst ?
                        { x: point.x, y: previous.y } :
                        { x: previous.x, y: point.y });
                }
            }
            if(!pTarget.length ||
                pTarget[pTarget.length - 1].x !== point.x ||
                pTarget[pTarget.length - 1].y !== point.y)
                pTarget.push({ x: point.x, y: point.y });
        }
    },

    MazeEdgePoints: function(pContext, pA, pB, pSalt) {
        var profile = pContext.Profile || {};
        var bendSetting = profile.JungleMazeEdgeBend;
        var bendMin = 1;
        var bendMax = 2;
        if(bendSetting instanceof Array && bendSetting.length >= 2) {
            bendMin = Math.max(0, Math.floor(Number(bendSetting[0]) || 0));
            bendMax = Math.max(bendMin, Math.floor(Number(bendSetting[1]) || bendMin));
        } else if(bendSetting !== undefined && bendSetting !== null) {
            bendMin = Math.max(0, Math.floor(Number(bendSetting) || 0));
            bendMax = bendMin;
        }

        var dx = pB.x - pA.x;
        var dy = pB.y - pA.y;
        var fraction = 0.38 + (this.HashUnit(
            pContext, pA.x + pSalt, pB.y, 7041 + pSalt
        ) * 0.24);
        var bend = bendMin;
        if(bendMax > bendMin)
            bend += Math.floor(this.HashUnit(
                pContext, pB.x, pA.y + pSalt, 7043 + pSalt
            ) * (bendMax - bendMin + 1));
        var sign = this.HashUnit(
            pContext, pA.x + pB.x, pA.y + pB.y, 7049 + pSalt
        ) < 0.5 ? -1 : 1;

        // Each graph edge gets a slightly off-centre bend perpendicular to its
        // dominant direction. Together with the warped node lattice this turns
        // long square grid runs into the sloping, irregular passages used by
        // the original jungle mazes.
        var middle = {
            x: Math.round(pA.x + (dx * fraction)),
            y: Math.round(pA.y + (dy * fraction))
        };
        if(Math.abs(dx) >= Math.abs(dy))
            middle.y += bend * sign;
        else
            middle.x += bend * sign;
        middle.x = Math.max(1, Math.min(pContext.Width - 2, middle.x));
        middle.y = Math.max(1, Math.min(pContext.Height - 2, middle.y));

        var points = [];
        this.AppendConnectedMazeLine(pContext, points, pA, middle, pSalt * 2 + 1);
        this.AppendConnectedMazeLine(pContext, points, middle, pB, pSalt * 2 + 2);
        return points;
    },

    MazeWideEdgePoints: function(pContext, pPoints, pA, pB, pSalt) {
        if(!pPoints || pPoints.length < 6)
            return [];

        var dx = pB.x - pA.x;
        var dy = pB.y - pA.y;
        var horizontal = Math.abs(dx) >= Math.abs(dy);
        var sign = this.HashUnit(
            pContext, pA.x + pB.x + pSalt, pA.y - pB.y, 7051 + pSalt
        ) < 0.5 ? -1 : 1;
        var offsetX = horizontal ? 0 : sign;
        var offsetY = horizontal ? sign : 0;
        // Taper each widened run back to one tile before a graph node. This
        // keeps intersections compact and makes the width changes read as
        // deliberate path sections instead of square junction rooms.
        var inset = Math.max(1, Math.floor(pPoints.length * 0.14));
        var result = [];

        for(var index = inset; index < pPoints.length - inset; ++index) {
            var point = {
                x: pPoints[index].x + offsetX,
                y: pPoints[index].y + offsetY
            };
            if(point.x < 1 || point.y < 1 ||
                point.x >= pContext.Width - 1 || point.y >= pContext.Height - 1)
                continue;
            if(result.length &&
                result[result.length - 1].x === point.x &&
                result[result.length - 1].y === point.y)
                continue;
            result.push(point);
        }
        return result;
    },

    AppendMazePoints: function(pTarget, pPoints) {
        for(var index = 0; index < pPoints.length; ++index) {
            var point = pPoints[index];
            if(pTarget.length &&
                pTarget[pTarget.length - 1].x === point.x &&
                pTarget[pTarget.length - 1].y === point.y)
                continue;
            pTarget.push({ x: point.x, y: point.y });
        }
    },

    ReserveMazeRoutingWalls: function(pContext) {
        var layers = pContext.Layers;
        var reserved = 0;
        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(MapGen.Layers.Get(layers.path, x, y, 0) ||
                    MapGen.Layers.Get(layers.water, x, y, 0) ||
                    MapGen.Layers.Get(layers.occupied, x, y, 0))
                    continue;
                var owner = MapGen.Layers.Get(
                    layers.owner, x, y, MapGen.Layers.Owner.NONE
                );
                if(owner !== MapGen.Layers.Owner.NONE &&
                    owner !== MapGen.Layers.Owner.OPEN &&
                    owner !== MapGen.Layers.Owner.TREE)
                    continue;
                MapGen.Layers.Set(layers.blocked, x, y, 1);
                MapGen.Layers.ClaimCell(layers.owner, x, y, MapGen.Layers.Owner.TREE);
                ++reserved;
            }
        }
        return reserved;
    },

    MazeRouteTarget: function(pContext) {
        var target = (pContext.Profile || {}).ForcedRouteLengthTarget;
        if(target instanceof Array && target.length >= 2) {
            var min = Number(target[0]);
            var max = Number(target[1]);
            if(!isNaN(min) && !isNaN(max))
                return (min + max) * 0.5;
        }
        return Math.max(80, (pContext.Width + pContext.Height) * 1.4);
    },

    MazeAnchorList: function(pContext) {
        var anchors = pContext.Anchors || {};
        var names = ["start", "objective", "objectiveB", "support", "extraction", "contested"];
        var result = [];
        for(var index = 0; index < names.length; ++index) {
            var point = anchors[names[index]];
            if(!point)
                continue;
            var duplicate = false;
            for(var existing = 0; existing < result.length; ++existing) {
                if(result[existing].x === point.x && result[existing].y === point.y) {
                    duplicate = true;
                    break;
                }
            }
            if(!duplicate)
                result.push(point);
        }
        return result;
    },

    ReserveMazeBranchClearings: function(pContext, pNodes, pAdjacency, pPrimaryNodes, pStartNode, pEndNode) {
        var profile = pContext.Profile || {};
        var target = Number(profile.JungleMazeBranchClearingCount);
        if(isNaN(target))
            target = pContext.Width * pContext.Height >= 8192 ? 4 : 3;
        target = Math.max(0, Math.min(6, Math.floor(target)));
        if(!target || !MapGen.Layout.Clearings || !pNodes || !pNodes.length)
            return [];

        var radius = Number(profile.JungleMazeBranchClearingRadius);
        if(isNaN(radius))
            radius = pContext.Width * pContext.Height >= 8192 ? 5 : 4;
        radius = Math.max(3, Math.min(6, Math.floor(radius)));

        // Measure graph distance from the authored start-to-objective route.
        // A dead end one edge off that route is still effectively on the main
        // line; deeper endpoints make buildings reward actual exploration.
        var distance = [];
        var primary = {};
        var queue = [];
        var queueIndex = 0;
        var index;
        for(index = 0; index < pNodes.length; ++index)
            distance[index] = 999999;
        for(index = 0; index < pPrimaryNodes.length; ++index) {
            var primaryIndex = pPrimaryNodes[index];
            if(primary[primaryIndex])
                continue;
            primary[primaryIndex] = true;
            distance[primaryIndex] = 0;
            queue.push(primaryIndex);
        }
        while(queueIndex < queue.length) {
            var current = queue[queueIndex++];
            var neighbours = pAdjacency[current] || [];
            for(var neighbourIndex = 0; neighbourIndex < neighbours.length; ++neighbourIndex) {
                var neighbour = neighbours[neighbourIndex];
                if(distance[neighbour] <= distance[current] + 1)
                    continue;
                distance[neighbour] = distance[current] + 1;
                queue.push(neighbour);
            }
        }

        var anchors = this.MazeAnchorList(pContext);
        var minAnchorDistance = radius + 7;
        var minAnchorDistanceSq = minAnchorDistance * minAnchorDistance;
        var candidates = [];
        for(index = 0; index < pNodes.length; ++index) {
            var node = pNodes[index];
            if(index === pStartNode || index === pEndNode || primary[index] ||
                !pAdjacency[index] || pAdjacency[index].length !== 1)
                continue;
            if(node.x < radius + 2 || node.y < radius + 2 ||
                node.x >= pContext.Width - radius - 2 ||
                node.y >= pContext.Height - radius - 2)
                continue;

            var nearestAnchorSq = 999999999;
            for(var anchorIndex = 0; anchorIndex < anchors.length; ++anchorIndex) {
                var anchorDx = node.x - anchors[anchorIndex].x;
                var anchorDy = node.y - anchors[anchorIndex].y;
                var anchorDistanceSq = (anchorDx * anchorDx) + (anchorDy * anchorDy);
                if(anchorDistanceSq < nearestAnchorSq)
                    nearestAnchorSq = anchorDistanceSq;
            }
            if(nearestAnchorSq < minAnchorDistanceSq)
                continue;

            candidates.push({
                node: index,
                x: node.x,
                y: node.y,
                branchDepth: distance[index],
                nearestAnchorSq: nearestAnchorSq,
                tie: MapGen.Random.HashTile(pContext.Seed, node.x, node.y, 7421)
            });
        }

        var selected = [];
        while(selected.length < target && candidates.length) {
            var bestIndex = -1;
            var bestScore = -1;
            for(index = 0; index < candidates.length; ++index) {
                var candidate = candidates[index];
                var spreadSq = candidate.nearestAnchorSq;
                for(var selectedIndex = 0; selectedIndex < selected.length; ++selectedIndex) {
                    var dx = candidate.x - selected[selectedIndex].x;
                    var dy = candidate.y - selected[selectedIndex].y;
                    var selectedDistanceSq = (dx * dx) + (dy * dy);
                    if(selectedDistanceSq < spreadSq)
                        spreadSq = selectedDistanceSq;
                }
                var score = (candidate.branchDepth * 1000000) +
                    (spreadSq * 100) + (candidate.tie & 0xffff);
                if(score > bestScore) {
                    bestScore = score;
                    bestIndex = index;
                }
            }
            if(bestIndex < 0)
                break;

            var picked = candidates.splice(bestIndex, 1)[0];
            if(!MapGen.Layout.Clearings.CanAdd(pContext, picked, radius))
                continue;
            var clearing = MapGen.Layout.Clearings.Add(
                pContext, picked, radius, "maze_branch", false
            );
            if(!clearing)
                continue;

            // Reserve a real chamber around the endpoint. Route-wall
            // reservation ran first, so clear its blocked bits while leaving
            // the corridor itself and higher-priority ownership intact.
            var radiusSq = radius * radius;
            for(var clearX = picked.x - radius; clearX <= picked.x + radius; ++clearX) {
                for(var clearY = picked.y - radius; clearY <= picked.y + radius; ++clearY) {
                    var clearDx = clearX - picked.x;
                    var clearDy = clearY - picked.y;
                    if((clearDx * clearDx) + (clearDy * clearDy) > radiusSq)
                        continue;
                    MapGen.Layers.Set(pContext.Layers.blocked, clearX, clearY, 0);
                }
            }
            selected.push({
                node: picked.node,
                x: picked.x,
                y: picked.y,
                radius: radius,
                branchDepth: picked.branchDepth
            });
        }

        return selected;
    },

    MazeBranchRoute: function(pBest, pEdgePaths, pPrimaryNodeSet, pBranchNode) {
        var queue = [pBranchNode];
        var previous = {};
        previous[pBranchNode] = pBranchNode;
        var goal = -1;
        for(var queueIndex = 0; queueIndex < queue.length; ++queueIndex) {
            var currentNode = queue[queueIndex];
            if(pPrimaryNodeSet[currentNode] !== undefined) {
                goal = currentNode;
                break;
            }
            var neighbours = pBest.adjacency[currentNode] || [];
            for(var neighbourIndex = 0; neighbourIndex < neighbours.length;
                ++neighbourIndex) {
                var neighbour = neighbours[neighbourIndex];
                if(previous[neighbour] !== undefined)
                    continue;
                previous[neighbour] = currentNode;
                queue.push(neighbour);
            }
        }
        if(goal < 0)
            return null;

        var nodeRoute = [];
        for(var routeNode = goal;; routeNode = previous[routeNode]) {
            nodeRoute.push(routeNode);
            if(routeNode === pBranchNode)
                break;
        }
        var routePoints = [];
        for(var routeIndex = 0; routeIndex < nodeRoute.length - 1;
            ++routeIndex) {
            var fromNode = nodeRoute[routeIndex];
            var toNode = nodeRoute[routeIndex + 1];
            var routeKey = Math.min(fromNode, toNode) + "_" +
                Math.max(fromNode, toNode);
            var routeEdge = pEdgePaths[routeKey];
            if(!routeEdge)
                continue;
            var edgePoints = routeEdge.a === fromNode ? routeEdge.points :
                routeEdge.points.slice().reverse();
            for(var edgePointIndex = 0; edgePointIndex < edgePoints.length;
                ++edgePointIndex) {
                if(routePoints.length && edgePointIndex === 0 &&
                    routePoints[routePoints.length - 1].x === edgePoints[edgePointIndex].x &&
                    routePoints[routePoints.length - 1].y === edgePoints[edgePointIndex].y)
                    continue;
                routePoints.push(edgePoints[edgePointIndex]);
            }
        }
        return { points: routePoints, primaryNode: goal };
    },

    MazeMeaningfulSpurCount: function(pContext) {
        var primary = null;
        var primaryLength = 0;
        var paths = pContext.Paths || [];
        for(var pathIndex = 0; pathIndex < paths.length; ++pathIndex) {
            var path = paths[pathIndex];
            var length = path && path.points ? path.points.length : 0;
            if(path && path.role === "primary" && length > primaryLength) {
                primary = path;
                primaryLength = length;
            }
        }
        if(!primary)
            return 0;
        var floor = Math.max(7, Math.round(Math.min(pContext.Width,
            pContext.Height) * 0.11));
        var count = 0;
        for(var sideIndex = 0; sideIndex < paths.length; ++sideIndex) {
            var side = paths[sideIndex];
            if(!side || !side.points || side.points.length < 7 ||
                (side.role !== "spur" && side.role !== "secondary" &&
                 side.role !== "flank_loop" && side.role !== "dead_end"))
                continue;
            var departure = 0;
            for(var pointIndex = 0; pointIndex < side.points.length; ++pointIndex) {
                var point = side.points[pointIndex];
                var nearest = 0x7fffffff;
                for(var primaryIndex = 0; primaryIndex < primary.points.length;
                    ++primaryIndex) {
                    var primaryPoint = primary.points[primaryIndex];
                    var dx = point.x - primaryPoint.x;
                    var dy = point.y - primaryPoint.y;
                    nearest = Math.min(nearest, Math.sqrt((dx * dx) + (dy * dy)));
                }
                departure = Math.max(departure, nearest);
            }
            if(departure >= floor)
                ++count;
        }
        return count;
    },

    RegisterMazeBranchRoutes: function(pContext, pBest, pEdgePaths,
        pBestPath, pBranchClearings) {
        if(!pContext.Paths || !pBranchClearings || !pBranchClearings.length)
            return;

        var existingSpurs = this.MazeMeaningfulSpurCount(pContext);
        var configured = Number((pContext.Profile || {}).CampaignSpurCount);
        var target = isFinite(configured) && configured > 0 ?
            Math.min(3, Math.floor(configured)) : 3;
        if(existingSpurs >= target)
            return;

        var primaryNodeSet = {};
        for(var primaryIndex = 0; primaryIndex < pBestPath.length; ++primaryIndex)
            primaryNodeSet[pBestPath[primaryIndex]] = primaryIndex;
        for(var branchIndex = 0;
            branchIndex < pBranchClearings.length && existingSpurs < target;
            ++branchIndex) {
            var branch = pBranchClearings[branchIndex];
            var route = this.MazeBranchRoute(pBest, pEdgePaths,
                primaryNodeSet, branch.node);
            if(!route || route.points.length < 7)
                continue;
            var fraction = primaryNodeSet[route.primaryNode];
            fraction = fraction === undefined ? 0.5 :
                fraction / Math.max(1, pBestPath.length - 1);
            pContext.Paths.push({
                role: "spur",
                radius: 1,
                purpose: "maze_branch",
                routeFraction: fraction,
                routePhase: fraction < 0.34 ? "early" :
                    (fraction < 0.67 ? "mid" : "late"),
                site: { x: branch.x, y: branch.y },
                points: route.points
            });
            ++existingSpurs;
        }
    },

    BuildMazeRouteNetwork: function(pContext, pChain, pDef, pMask) {
        var spacing = Math.max(6, this.ProfileRange(
            pContext, "JungleMazeGridSpacing", 6, 8, 7057, true
        ));
        var radius = Math.max(0, this.ProfileRange(
            pContext, "JungleMazeCorridorRadius", 0, 0, 7059, true
        ));
        var margin = Math.max(radius + 2, this.ProfileRange(
            pContext, "JungleMazeGridMargin", 4, 5, 7061, true
        ));
        var edgeWidth = Math.max(1, Math.min(3, this.EdgeWidth(pContext, pDef)));
        var usableWidth = Math.max(1, pContext.Width - (margin * 2));
        var usableHeight = Math.max(1, pContext.Height - (margin * 2));
        var columns = Math.max(3, Math.floor(usableWidth / spacing) + 1);
        var rows = Math.max(3, Math.floor(usableHeight / spacing) + 1);
        if(columns > 3 && usableWidth - ((columns - 1) * spacing) < spacing * 0.45)
            --columns;
        if(rows > 3 && usableHeight - ((rows - 1) * spacing) < spacing * 0.45)
            --rows;
        var startX = Math.floor((pContext.Width - ((columns - 1) * spacing)) / 2);
        var startY = Math.floor((pContext.Height - ((rows - 1) * spacing)) / 2);
        var nodes = [];

        for(var row = 0; row < rows; ++row) {
            for(var column = 0; column < columns; ++column) {
                var jitterRadius = Math.max(1, this.ProfileRange(
                    pContext, "JungleMazeNodeJitter", 2, 3, 7062, true
                ));
                var jitterX = Math.floor(this.HashUnit(
                    pContext, column, row, 7063
                ) * ((jitterRadius * 2) + 1)) - jitterRadius;
                var jitterY = Math.floor(this.HashUnit(
                    pContext, column, row, 7069
                ) * ((jitterRadius * 2) + 1)) - jitterRadius;
                nodes.push({
                    x: Math.max(margin, Math.min(pContext.Width - margin - 1,
                        startX + (column * spacing) + jitterX)),
                    y: Math.max(margin, Math.min(pContext.Height - margin - 1,
                        startY + (row * spacing) + jitterY)),
                    column: column,
                    row: row
                });
            }
        }

        var startNode = this.MazeNearestNode(nodes, pChain[0]);
        var endNode = this.MazeNearestNode(nodes, pChain[pChain.length - 1]);
        var targetLength = this.MazeRouteTarget(pContext);
        var straightBias = this.ProfileRange(
            pContext, "JungleMazeStraightBias", 0.60, 0.74, 7073, false
        );
        var wideEdgeChance = this.ProfileRange(
            pContext, "JungleMazeWideEdgeChance", 0.24, 0.36, 7075, false
        );
        var best = null;
        var bestPath = [];
        var bestScore = Infinity;
        var candidateCount = 16;
        for(var candidate = 0; candidate < candidateCount; ++candidate) {
            var graph = this.BuildMazeGraphCandidate(
                pContext, nodes, columns, rows, startNode, candidate, straightBias
            );
            var nodePath = this.MazeNodePath(graph.adjacency, startNode, endNode);
            var estimatedLength = 0;
            for(var pi = 1; pi < nodePath.length; ++pi) {
                var pa = nodes[nodePath[pi - 1]];
                var pb = nodes[nodePath[pi]];
                estimatedLength += Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y);
            }
            estimatedLength += Math.abs(pChain[0].x - nodes[startNode].x) +
                Math.abs(pChain[0].y - nodes[startNode].y) +
                Math.abs(pChain[pChain.length - 1].x - nodes[endNode].x) +
                Math.abs(pChain[pChain.length - 1].y - nodes[endNode].y);
            var score = Math.abs(estimatedLength - targetLength);
            if(score < bestScore) {
                bestScore = score;
                best = graph;
                bestPath = nodePath;
                best.estimatedRouteLength = estimatedLength;
            }
        }

        if(!best)
            return false;

        // Stamp the complete perfect-maze tree first. Because there are no
        // cross-route shortcuts, the forest remaining around it forms long,
        // connected walls instead of decorative islands in an open field.
        var edgePaths = {};
        var wideEdges = 0;
        var wideCells = 0;
        for(var edgeIndex = 0; edgeIndex < best.edges.length; ++edgeIndex) {
            var edge = best.edges[edgeIndex];
            var edgePoints = this.MazeEdgePoints(
                pContext, nodes[edge.a], nodes[edge.b], edgeIndex + best.candidate * 101
            );
            edgePaths[Math.min(edge.a, edge.b) + "_" + Math.max(edge.a, edge.b)] = {
                a: edge.a,
                b: edge.b,
                points: edgePoints
            };
            for(var pointIndex = 0; pointIndex < edgePoints.length; ++pointIndex)
                this.StampCorridorPoint(
                    pContext, pMask, edgePoints[pointIndex], radius, edgeWidth, false
                );

            // Preserve narrow dead-end tips and most branches, but give a
            // stable subset of the longer runs a second parallel cell. A
            // radius-one stamp would create a three-cell cross and over-open
            // diagonal bends; the offset lane is an exact two-tile corridor.
            if(this.HashUnit(
                pContext,
                edge.a + (best.candidate * 131),
                edge.b + edgeIndex,
                7079
            ) < wideEdgeChance) {
                var widePoints = this.MazeWideEdgePoints(
                    pContext,
                    edgePoints,
                    nodes[edge.a],
                    nodes[edge.b],
                    edgeIndex + (best.candidate * 149)
                );
                if(widePoints.length)
                    ++wideEdges;
                for(var wideIndex = 0; wideIndex < widePoints.length; ++wideIndex) {
                    if(!MapGen.Layers.Get(
                        pMask.core, widePoints[wideIndex].x, widePoints[wideIndex].y, 0
                    ))
                        ++wideCells;
                    this.StampCorridorPoint(
                        pContext, pMask, widePoints[wideIndex], 0, edgeWidth, false
                    );
                }
            }
        }

        // Every gameplay anchor gets a short connector into the same graph.
        // Connectivity therefore follows the labyrinth rather than drawing a
        // later straight corridor across its walls.
        var anchors = this.MazeAnchorList(pContext);
        var connectors = [];
        for(var anchorIndex = 0; anchorIndex < anchors.length; ++anchorIndex) {
            var anchorNode = this.MazeNearestNode(nodes, anchors[anchorIndex]);
            var connector = this.MazeEdgePoints(
                pContext, anchors[anchorIndex], nodes[anchorNode], 7301 + anchorIndex
            );
            connectors.push({ anchor: anchors[anchorIndex], node: anchorNode, points: connector.length });
            for(pointIndex = 0; pointIndex < connector.length; ++pointIndex)
                this.StampCorridorPoint(
                    pContext, pMask, connector[pointIndex], radius, edgeWidth, false
                );
        }

        var primary = [];
        this.AppendMazePoints(primary, this.MazeEdgePoints(
            pContext, pChain[0], nodes[startNode], 7401
        ));
        for(pi = 1; pi < bestPath.length; ++pi) {
            var previousNode = bestPath[pi - 1];
            var currentNode = bestPath[pi];
            var pathKey = Math.min(previousNode, currentNode) + "_" + Math.max(previousNode, currentNode);
            var stored = edgePaths[pathKey];
            var storedPoints = stored ? stored.points : [];
            if(stored && stored.a !== previousNode) {
                storedPoints = [];
                for(var reverseIndex = stored.points.length - 1; reverseIndex >= 0; --reverseIndex)
                    storedPoints.push(stored.points[reverseIndex]);
            }
            this.AppendMazePoints(primary, storedPoints);
        }
        this.AppendMazePoints(primary, this.MazeEdgePoints(
            pContext, nodes[endNode], pChain[pChain.length - 1], 7403
        ));
        pMask.points = primary;

        var deadEnds = 0;
        for(var nodeIndex = 0; nodeIndex < best.adjacency.length; ++nodeIndex)
            if(best.adjacency[nodeIndex].length === 1)
                ++deadEnds;

        var routingWallCells = this.ReserveMazeRoutingWalls(pContext);
        var branchClearings = this.ReserveMazeBranchClearings(
            pContext, nodes, best.adjacency, bestPath, startNode, endNode
        );

        this.RegisterMazeBranchRoutes(pContext, best, edgePaths, bestPath,
            branchClearings);
        pMask.mazeNetwork = {
            topology: "perfect_maze_route_skeleton",
            geometry: "warped_diagonal_stair_step",
            spacing: spacing,
            radius: radius,
            columns: columns,
            rows: rows,
            nodes: nodes.length,
            edges: best.edges.length,
            deadEnds: deadEnds,
            wideEdgeChance: wideEdgeChance,
            wideEdges: wideEdges,
            wideCells: wideCells,
            candidate: best.candidate,
            straightBias: straightBias,
            estimatedRouteLength: best.estimatedRouteLength,
            primaryPoints: primary.length,
            connectors: connectors,
            routingWallCells: routingWallCells,
            branchClearings: branchClearings
        };
        MapGen.Context.AddLog(
            pContext,
            "Route maze planned before terrain (" + nodes.length + " nodes, " +
                deadEnds + " dead ends, " + branchClearings.length +
                " branch clearings, route " + primary.length + " cells)"
        );
        return true;
    },

    RangeNumber: function(pContext, pName, pFallback) {
        var value = pContext.Profile ? pContext.Profile[pName] : undefined;
        if(value === undefined || value === null)
            return pFallback;
        value = Number(value);
        return isNaN(value) ? pFallback : value;
    },

    InBand: function(pFraction, pBands) {
        if(!(pBands instanceof Array))
            return false;
        for(var index = 0; index < pBands.length; ++index) {
            var band = pBands[index];
            if(!(band instanceof Array) || band.length < 2)
                continue;
            var min = Number(band[0]);
            var max = Number(band[1]);
            if(isNaN(min) || isNaN(max))
                continue;
            if(max < min) {
                var swap = min;
                min = max;
                max = swap;
            }
            if(pFraction >= min && pFraction <= max)
                return true;
        }
        return false;
    },

    CorridorHalfWidth: function(pContext, pDef, pFraction) {
        var profile = pContext.Profile || {};
        var half = this.RangeNumber(pContext, "RouteCorridorHalfWidth", pDef.halfWidth);
        var narrowBands = profile.RouteNarrowBands || pDef.narrowBands;
        if(this.InBand(pFraction, narrowBands))
            half = this.RangeNumber(pContext, "RouteNarrowHalfWidth", pDef.narrowHalfWidth !== undefined ? pDef.narrowHalfWidth : 0);
        return Math.max(0, Math.floor(half));
    },

    EdgeWidth: function(pContext, pDef) {
        return Math.max(0, Math.floor(this.RangeNumber(pContext, "RouteCorridorEdgeWidth", pDef.edgeWidth || 0)));
    },

    StampMaskDisc: function(pContext, pLayer, pX, pY, pRadius, pValue) {
        var radius = Math.max(0, Math.floor(pRadius || 0));
        var radiusSq = radius * radius;
        var stamped = 0;

        for(var dx = -radius; dx <= radius; ++dx) {
            for(var dy = -radius; dy <= radius; ++dy) {
                if((dx * dx) + (dy * dy) > radiusSq)
                    continue;
                var x = pX + dx;
                var y = pY + dy;
                if(!MapGen.Layers.InBounds(pLayer, x, y))
                    continue;
                if(!MapGen.Layers.Get(pLayer, x, y, 0))
                    ++stamped;
                MapGen.Layers.Set(pLayer, x, y, pValue);
            }
        }

        return stamped;
    },

    StampCorridorPoint: function(pContext, pMask, pPoint, pHalfWidth, pEdgeWidth, pNarrow) {
        var owner = pContext.Layers.owner;
        var layers = pContext.Layers;
        var edgeRadius = pHalfWidth + pEdgeWidth;
        var x;
        var y;

        pMask.stampedEdge += this.StampMaskDisc(pContext, pMask.edge, pPoint.x, pPoint.y, edgeRadius, 1);
        pMask.stampedCore += this.StampMaskDisc(pContext, pMask.core, pPoint.x, pPoint.y, pHalfWidth, 1);
        this.StampMaskDisc(pContext, pMask.center, pPoint.x, pPoint.y, 0, 1);
        if(pNarrow)
            this.StampMaskDisc(pContext, pMask.narrow, pPoint.x, pPoint.y, Math.max(0, pHalfWidth), 1);

        for(x = pPoint.x - pHalfWidth; x <= pPoint.x + pHalfWidth; ++x) {
            for(y = pPoint.y - pHalfWidth; y <= pPoint.y + pHalfWidth; ++y) {
                var dx = x - pPoint.x;
                var dy = y - pPoint.y;
                if((dx * dx) + (dy * dy) > pHalfWidth * pHalfWidth)
                    continue;
                if(!MapGen.Layers.InBounds(layers.keepClear, x, y))
                    continue;
                MapGen.Layers.Set(layers.path, x, y, 1);
                MapGen.Layers.Set(layers.keepClear, x, y, 1);
                MapGen.Layers.Set(layers.blocked, x, y, 0);
                MapGen.Layers.ClaimCell(owner, x, y, MapGen.Layers.Owner.ROUTE);
            }
        }
    },

    StampPocket: function(pContext, pMask, pPoint, pRadius, pRole) {
        var layers = pContext.Layers;
        var radius = Math.max(1, Math.floor(pRadius || 2));
        var radiusSq = radius * radius;
        var stamped = 0;

        for(var x = pPoint.x - radius; x <= pPoint.x + radius; ++x) {
            for(var y = pPoint.y - radius; y <= pPoint.y + radius; ++y) {
                var dx = x - pPoint.x;
                var dy = y - pPoint.y;
                if((dx * dx) + (dy * dy) > radiusSq)
                    continue;
                if(!MapGen.Layers.InBounds(layers.keepClear, x, y))
                    continue;
                if(MapGen.Layers.Get(layers.water, x, y, 0))
                    continue;
                if(!MapGen.Layers.Get(pMask.pocket, x, y, 0))
                    ++stamped;
                MapGen.Layers.Set(pMask.pocket, x, y, 1);
                MapGen.Layers.Set(layers.keepClear, x, y, 1);
                MapGen.Layers.Set(layers.blocked, x, y, 0);
                MapGen.Layers.ClaimCell(layers.owner, x, y, MapGen.Layers.Owner.CLEARING);
            }
        }

        pMask.pockets.push({
            x: pPoint.x,
            y: pPoint.y,
            radius: radius,
            role: pRole || "route_pocket"
        });
        pMask.stampedPockets += stamped;
    },

    Build: function(pContext) {
        if(!pContext || !pContext.Layers || !pContext.Layers.owner)
            return false;

        var chain = this.AnchorChain(pContext);
        if(chain.length < 2)
            return false;

        var resolved = this.Resolve(pContext);
        var def = resolved.definition;
        var mask = this.EnsureMask(pContext);
        var points = this.BuildRoutePoints(pContext, chain, def);
        var edgeWidth = this.EdgeWidth(pContext, def);
        var bands = (pContext.Profile || {}).RouteNarrowBands || def.narrowBands;

        mask.archetype = resolved.name;
        mask.points = points;
        pContext.RouteArchetype = {
            name: resolved.name,
            definition: def
        };

        if(resolved.name === "maze" &&
            (pContext.Profile || {}).JungleMazeRouteTopology === true) {
            if(!this.BuildMazeRouteNetwork(pContext, chain, def, mask))
                return false;

            var mazePocketFractions = (pContext.Profile || {}).RoutePocketFractions || def.pocketFractions || [];
            var mazePocketRadius = this.RangeNumber(pContext, "RoutePocketRadius", def.pocketRadius || 2);
            for(var mpi = 0; mpi < mazePocketFractions.length; ++mpi) {
                var mazePocket = this.PointAtFraction(pContext, Number(mazePocketFractions[mpi]));
                if(mazePocket)
                    this.StampPocket(pContext, mask, mazePocket, mazePocketRadius, "route_phase_" + mpi);
            }
            return true;
        }

        for(var index = 0; index < points.length; ++index) {
            var fraction = points.length > 1 ? index / (points.length - 1) : 0;
            var narrow = this.InBand(fraction, bands);
            var halfWidth = this.CorridorHalfWidth(pContext, def, fraction);
            this.StampCorridorPoint(pContext, mask, points[index], halfWidth, edgeWidth, narrow);
        }

        var pocketFractions = (pContext.Profile || {}).RoutePocketFractions || def.pocketFractions || [];
        var pocketRadius = this.RangeNumber(pContext, "RoutePocketRadius", def.pocketRadius || 2);
        for(var pi = 0; pi < pocketFractions.length; ++pi) {
            var pocket = this.PointAtFraction(pContext, Number(pocketFractions[pi]));
            if(pocket)
                this.StampPocket(pContext, mask, pocket, pocketRadius, "route_phase_" + pi);
        }

        MapGen.Context.AddLog(
            pContext,
            "Route archetype " + resolved.name +
                " planned " + points.length + " cells, core " + mask.stampedCore +
                ", edge " + mask.stampedEdge + ", pockets " + mask.pockets.length
        );
        return true;
    },

    PointIndexAtFraction: function(pContext, pFraction) {
        var points = pContext && pContext.RouteCorridor ? pContext.RouteCorridor.points || [] : [];
        if(!points.length)
            return -1;

        var minIndex = Math.min(points.length - 1, 2);
        var maxIndex = Math.max(minIndex, points.length - 3);
        var fraction = this.Clamp(Number(pFraction), 0, 1);
        return Math.round(minIndex + ((maxIndex - minIndex) * fraction));
    },

    PointAtFraction: function(pContext, pFraction) {
        var points = pContext && pContext.RouteCorridor ? pContext.RouteCorridor.points || [] : [];
        var index = this.PointIndexAtFraction(pContext, pFraction);
        if(index < 0)
            return null;
        return {
            x: points[index].x,
            y: points[index].y,
            routeIndex: index,
            routeFraction: points.length > 1 ? index / (points.length - 1) : 0
        };
    },

    TangentAtIndex: function(pContext, pIndex) {
        var points = pContext && pContext.RouteCorridor ? pContext.RouteCorridor.points || [] : [];
        if(!points.length)
            return { x: 1, y: 0 };

        var index = Math.max(0, Math.min(points.length - 1, Math.floor(pIndex)));
        var previous = points[Math.max(0, index - 3)] || points[index];
        var next = points[Math.min(points.length - 1, index + 3)] || points[index];
        var dx = next.x - previous.x;
        var dy = next.y - previous.y;
        var length = Math.max(1, Math.sqrt((dx * dx) + (dy * dy)));

        return {
            x: dx / length,
            y: dy / length
        };
    },

    PathAxesAtIndex: function(pPath, pIndex) {
        if(!pPath || !pPath.length)
            return {
                tangent: { x: 1, y: 0 },
                normal: { x: 0, y: 1 }
            };

        var index = Math.max(0, Math.min(pPath.length - 1, Math.floor(pIndex)));
        var previous = pPath[Math.max(0, index - 1)] || pPath[index];
        var next = pPath[Math.min(pPath.length - 1, index + 1)] || pPath[index];
        var dx = next.x - previous.x;
        var dy = next.y - previous.y;

        if(Math.abs(dx) >= Math.abs(dy)) {
            return {
                tangent: { x: dx < 0 ? -1 : 1, y: 0 },
                normal: { x: 0, y: 1 }
            };
        }

        return {
            tangent: { x: 0, y: dy < 0 ? -1 : 1 },
            normal: { x: 1, y: 0 }
        };
    },

    SidePoint: function(pContext, pFraction, pSide, pDistance, pRole) {
        var base = this.PointAtFraction(pContext, pFraction);
        if(!base)
            return null;

        var tangent = this.TangentAtIndex(pContext, base.routeIndex);
        var nx = -tangent.y;
        var ny = tangent.x;
        var side = pSide < 0 ? -1 : 1;
        var distance = Math.max(0, Number(pDistance) || 0);
        var x = Math.round(base.x + (nx * side * distance));
        var y = Math.round(base.y + (ny * side * distance));

        x = Math.max(2, Math.min(pContext.Width - 3, x));
        y = Math.max(2, Math.min(pContext.Height - 3, y));

        return {
            x: x,
            y: y,
            role: pRole || "route_site",
            routeAnchor: { x: base.x, y: base.y },
            routeOffset: distance * side,
            routeIndex: base.routeIndex,
            routeFraction: base.routeFraction,
            routeDistance: Math.round(Math.sqrt(((x - base.x) * (x - base.x)) + ((y - base.y) * (y - base.y))) * 10) / 10
        };
    },

    CanStampCover: function(pContext, pX, pY) {
        var layers = pContext.Layers || {};
        if(!MapGen.Layers.InBounds(layers.blocked, pX, pY))
            return false;
        if(MapGen.Layers.Get(layers.path, pX, pY, 0) ||
            MapGen.Layers.Get(layers.keepClear, pX, pY, 0) ||
            MapGen.Layers.Get(layers.water, pX, pY, 0) ||
            MapGen.Layers.Get(layers.coast, pX, pY, 0) ||
            MapGen.Layers.Get(layers.occupied, pX, pY, 0))
            return false;

        var owner = layers.owner ? MapGen.Layers.Get(layers.owner, pX, pY, 0) : 0;
        if(owner === MapGen.Layers.Owner.ROUTE ||
            owner === MapGen.Layers.Owner.CLEARING ||
            owner === MapGen.Layers.Owner.WATER ||
            owner === MapGen.Layers.Owner.CLIFF ||
            owner === MapGen.Layers.Owner.STRUCTURE ||
            owner === MapGen.Layers.Owner.OBJECT)
            return false;

        return true;
    },

    CanStampActualGateCover: function(pContext, pPathLayer, pX, pY,
        pReplaceRouteShoulder) {
        var layers = pContext.Layers || {};
        if(!MapGen.Layers.InBounds(layers.blocked, pX, pY))
            return false;
        if(MapGen.Layers.Get(pPathLayer, pX, pY, 0) ||
            MapGen.Layers.Get(layers.water, pX, pY, 0) ||
            MapGen.Layers.Get(layers.coast, pX, pY, 0) ||
            MapGen.Layers.Get(layers.occupied, pX, pY, 0))
            return false;

        var owner = layers.owner ?
            MapGen.Layers.Get(layers.owner, pX, pY, 0) : 0;
        if(owner === MapGen.Layers.Owner.WATER ||
            owner === MapGen.Layers.Owner.CLIFF ||
            owner === MapGen.Layers.Owner.CLEARING ||
            owner === MapGen.Layers.Owner.STRUCTURE ||
            owner === MapGen.Layers.Owner.OBJECT)
            return false;

        // Enemy and pickup placements are connectivity nodes but are not all
        // represented in the occupied layer. Never turn the node itself into
        // a gate wall while tightening its surrounding route shoulder.
        var placements = pContext.Placements || {};
        for(var group in placements) {
            if(!placements.hasOwnProperty(group) ||
                !(placements[group] instanceof Array))
                continue;
            for(var index = 0; index < placements[group].length; ++index) {
                var placement = placements[group][index] || {};
                var point = placement.point || placement;
                if(Math.abs(Number(point.x) - pX) <= 2 &&
                    Math.abs(Number(point.y) - pY) <= 2)
                    return false;
            }
        }

        // Route structures materialize after this repair pass. Reserve their
        // planned approach area now, otherwise a valid semantic gate can be
        // stamped directly across the future building door and only fail once
        // the live sprites/structures are committed.
        var plannedSites = pContext.PlannedSites || [];
        for(var siteIndex = 0; siteIndex < plannedSites.length; ++siteIndex) {
            var site = plannedSites[siteIndex] || {};
            var sitePoint = site.point || site;
            if(!isFinite(Number(sitePoint.x)) ||
                !isFinite(Number(sitePoint.y)))
                continue;
            var siteRadius = Math.max(2,
                Math.floor(Number(site.radius || 0)) +
                Math.floor(Number(site.approach || 0)) + 1);
            if(Math.abs(Number(sitePoint.x) - pX) <= siteRadius &&
                Math.abs(Number(sitePoint.y) - pY) <= siteRadius)
                return false;
        }

        // Named neck maps deliberately close the broad route shoulder around
        // a one-cell tactical path. Generic cover stamping refuses ROUTE,
        // CLEARING and keepClear ownership, which made almost every late gate
        // a no-op after placement routes had been flushed. The actual path and
        // occupied footprints remain protected above.
        if(pReplaceRouteShoulder)
            return true;
        return this.CanStampCover(pContext, pX, pY);
    },

    MarkActualGateCover: function(pContext, pX, pY,
        pReplaceRouteShoulder) {
        if(pReplaceRouteShoulder) {
            MapGen.Layers.Set(pContext.Layers.path, pX, pY, 0);
            MapGen.Layers.Set(pContext.Layers.keepClear, pX, pY, 0);
            if(pContext.Layers.outcrop)
                MapGen.Layers.Set(pContext.Layers.outcrop, pX, pY, 0);
        }
        this.MarkCoverCell(pContext, pX, pY);
    },

    MarkCoverCell: function(pContext, pX, pY) {
        if(MapGen.Terrain && MapGen.Terrain.Cover && MapGen.Terrain.Cover.MarkTreeCell)
            MapGen.Terrain.Cover.MarkTreeCell(pContext, pX, pY);
        else {
            MapGen.Layers.Set(pContext.Layers.blocked, pX, pY, 1);
            if(pContext.Layers.owner)
                MapGen.Layers.ClaimCell(pContext.Layers.owner, pX, pY, MapGen.Layers.Owner.TREE);
        }
    },

    ProtectActualRouteCell: function(pContext, pX, pY) {
        var layers = pContext.Layers || {};
        if(!MapGen.Layers.InBounds(layers.path, pX, pY))
            return false;
        if(MapGen.Layers.Get(layers.water, pX, pY, 0) && !MapGen.Layers.Get(layers.crossing, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(layers.coast, pX, pY, 0))
            return false;

        var owner = layers.owner ? MapGen.Layers.Get(layers.owner, pX, pY, 0) : 0;
        if(owner === MapGen.Layers.Owner.WATER ||
            owner === MapGen.Layers.Owner.CLIFF ||
            owner === MapGen.Layers.Owner.STRUCTURE ||
            owner === MapGen.Layers.Owner.OBJECT)
            return false;

        MapGen.Layers.Set(layers.path, pX, pY, 1);
        MapGen.Layers.Set(layers.keepClear, pX, pY, 1);
        MapGen.Layers.Set(layers.blocked, pX, pY, 0);
        if(layers.owner)
            MapGen.Layers.ClaimCell(layers.owner, pX, pY, MapGen.Layers.Owner.ROUTE);
        return true;
    },

    ActualPathLayer: function(pContext, pPath) {
        var layer = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);

        for(var index = 0; index < pPath.length; ++index) {
            if(!pPath[index])
                continue;
            if(MapGen.Layers.InBounds(layer, pPath[index].x, pPath[index].y))
                MapGen.Layers.Set(layer, pPath[index].x, pPath[index].y, 1);
        }

        return layer;
    },

    ApplyActualRouteGateCover: function(pContext, pPath) {
        var resolved = pContext.RouteArchetype || this.Resolve(pContext);
        var def = resolved.definition || {};
        var path = pPath || pContext.TacticalRoutePath || [];
        var chance = this.RangeNumber(pContext, "RouteArchetypeActualGateRepairChance", def.actualGateRepairChance || 0);
        var spacing = Math.max(1, Math.floor(this.RangeNumber(pContext, "RouteArchetypeActualGateRepairSpacing", def.actualGateRepairSpacing || 7)));
        var halfLength = Math.max(2, Math.floor(this.RangeNumber(pContext, "RouteArchetypeActualGateRepairHalfLength", def.actualGateRepairHalfLength || 12)));
        var thickness = Math.max(0, Math.floor(this.RangeNumber(pContext, "RouteArchetypeActualGateRepairThickness", def.actualGateRepairThickness || 2)));
        var gap = Math.max(0, Math.floor(this.RangeNumber(pContext, "RouteArchetypeActualGateRepairGap", def.actualGateRepairGap || 0)));
        var trim = this.Clamp(this.RangeNumber(pContext, "RouteArchetypeActualGateRepairEndpointTrim", def.actualGateRepairEndpointTrim || 0.12), 0, 0.45);
        var maxGates = Math.max(1, Math.floor(this.RangeNumber(pContext, "RouteArchetypeActualGateRepairMaxGates", def.actualGateRepairMaxGates || 10)));
        var sideChance = this.RangeNumber(pContext, "RouteArchetypeActualSideRepairChance", def.actualSideRepairChance || 0);
        var sideDistance = Math.max(2, Math.floor(this.RangeNumber(pContext, "RouteArchetypeActualSideRepairDistance", def.actualSideRepairDistance || 5)));
        var sideThickness = Math.max(0, Math.floor(this.RangeNumber(pContext, "RouteArchetypeActualSideRepairThickness", def.actualSideRepairThickness || 1)));
        var sideTangentDepth = Math.max(0, Math.floor(this.RangeNumber(pContext, "RouteArchetypeActualSideRepairTangentDepth", def.actualSideRepairTangentDepth || 1)));
        var sideSpacing = Math.max(1, Math.floor(this.RangeNumber(pContext, "RouteArchetypeActualSideRepairSpacing", def.actualSideRepairSpacing || 1)));
        var pathLayer;
        var first;
        var last;
        var stamped = 0;
        var candidates = 0;
        var gates = 0;
        var protectedCells = 0;
        var sideStamped = 0;
        var sideCandidates = 0;
        var replaceRouteShoulder = String(
            (pContext.Profile || {}).Name || "") ===
            "grammar_jungle_neck";

        if(!path.length || (chance <= 0 && sideChance <= 0))
            return { stamped: 0, candidates: 0, gates: 0, protectedCells: 0 };

        pathLayer = this.ActualPathLayer(pContext, path);
        first = Math.max(1, Math.floor(path.length * trim));
        last = Math.min(path.length - 2, Math.ceil(path.length * (1.0 - trim)));

        if(sideChance > 0) {
            for(var sideIndex = first; sideIndex <= last; sideIndex += sideSpacing) {
                var sidePoint = path[sideIndex];
                var sideAxes = this.PathAxesAtIndex(path, sideIndex);
                if(!sidePoint)
                    continue;

                for(var sideSign = -1; sideSign <= 1; sideSign += 2) {
                    for(var normal = -sideThickness; normal <= sideThickness; ++normal) {
                        var sideOffset = sideDistance + normal;
                        if(sideOffset <= gap)
                            continue;

                        for(var sideDepth = -sideTangentDepth; sideDepth <= sideTangentDepth; ++sideDepth) {
                            var sideX = sidePoint.x + (sideAxes.normal.x * sideSign * sideOffset) + (sideAxes.tangent.x * sideDepth);
                            var sideY = sidePoint.y + (sideAxes.normal.y * sideSign * sideOffset) + (sideAxes.tangent.y * sideDepth);

                            if(MapGen.Layers.Get(pathLayer, sideX, sideY, 0))
                                continue;
                            if(!this.CanStampActualGateCover(pContext, pathLayer,
                                sideX, sideY, replaceRouteShoulder))
                                continue;

                            ++sideCandidates;
                            if(this.HashUnit(pContext, sideX + sideIndex, sideY + sideDepth, 6253) > sideChance)
                                continue;
                            if(!MapGen.Layers.Get(pContext.Layers.blocked, sideX, sideY, 0))
                                ++sideStamped;
                            this.MarkActualGateCover(pContext, sideX, sideY,
                                replaceRouteShoulder);
                        }
                    }
                }
            }
        }

        // Spread the finite gate budget over the whole journey. The old loop
        // consumed all maxGates slots near the start of a long/XL route, so a
        // structure clearing there could nullify every gate while the final
        // two thirds of the map remained wide open.
        var availableGateSlots = Math.max(1,
            Math.floor((last - first) / spacing) + 1);
        var gateTarget = Math.min(maxGates, availableGateSlots);
        for(var gateOrdinal = 0; gateOrdinal < gateTarget; ++gateOrdinal) {
            var index = gateTarget > 1 ? Math.round(
                first + ((last - first) * gateOrdinal /
                    (gateTarget - 1))) : first;
            var point = path[index];
            var axes = this.PathAxesAtIndex(path, index);
            if(!point)
                continue;

            ++gates;
            for(var depth = -thickness; depth <= thickness; ++depth) {
                if(this.ProtectActualRouteCell(
                    pContext,
                    point.x + (axes.tangent.x * depth),
                    point.y + (axes.tangent.y * depth)
                ))
                    ++protectedCells;
            }

            for(var side = -halfLength; side <= halfLength; ++side) {
                if(Math.abs(side) <= gap)
                    continue;

                for(var gateDepth = -thickness; gateDepth <= thickness; ++gateDepth) {
                    var x = point.x + (axes.normal.x * side) + (axes.tangent.x * gateDepth);
                    var y = point.y + (axes.normal.y * side) + (axes.tangent.y * gateDepth);

                    if(MapGen.Layers.Get(pathLayer, x, y, 0))
                        continue;
                    if(!this.CanStampActualGateCover(pContext, pathLayer,
                        x, y, replaceRouteShoulder))
                        continue;

                    ++candidates;
                    if(this.HashUnit(pContext, x + index, y + gateDepth, 6241) > chance)
                        continue;
                    if(!MapGen.Layers.Get(pContext.Layers.blocked, x, y, 0))
                        ++stamped;
                    this.MarkActualGateCover(pContext, x, y,
                        replaceRouteShoulder);
                }
            }
        }

        if(!pContext.RouteCorridor)
            this.EnsureMask(pContext);
        pContext.RouteCorridor.actualGateRepair = {
            archetype: resolved.name,
            pathLength: path.length,
            stamped: stamped,
            candidates: candidates,
            sideStamped: sideStamped,
            sideCandidates: sideCandidates,
            gates: gates,
            protectedCells: protectedCells,
            chance: chance,
            spacing: spacing,
            halfLength: halfLength,
            thickness: thickness,
            gap: gap,
            sideChance: sideChance,
            sideDistance: sideDistance,
            sideThickness: sideThickness,
            sideTangentDepth: sideTangentDepth,
            sideSpacing: sideSpacing,
            endpointTrim: trim,
            maxGates: maxGates
        };

        return pContext.RouteCorridor.actualGateRepair;
    },

    ApplyNarrowGateCover: function(pContext, pDef, pGateChance, pSalt) {
        var corridor = pContext.RouteCorridor;
        var points = corridor && corridor.points ? corridor.points : [];
        var chance = Number(pGateChance || 0);
        var edgeWidth = this.EdgeWidth(pContext, pDef);
        var halfLength = Math.max(2, Math.floor(this.RangeNumber(pContext, "RouteArchetypeGateHalfLength", edgeWidth + 2)));
        var thickness = Math.max(0, Math.floor(this.RangeNumber(pContext, "RouteArchetypeGateThickness", 1)));
        var spacing = Math.max(1, Math.floor(this.RangeNumber(pContext, "RouteArchetypeGateSpacing", pDef.gateSpacing || 4)));
        var gap = Math.max(0, Math.floor(this.RangeNumber(pContext, "RouteArchetypeGateGap", 0)));
        var stamped = 0;
        var candidates = 0;
        var gates = 0;

        if(!corridor || !corridor.narrow || !points.length || chance <= 0)
            return { stamped: 0, candidates: 0, gates: 0 };

        for(var index = 0; index < points.length; index += spacing) {
            var point = points[index];
            if(!MapGen.Layers.Get(corridor.narrow, point.x, point.y, 0))
                continue;

            var tangent = this.TangentAtIndex(pContext, index);
            var nx = -tangent.y;
            var ny = tangent.x;
            ++gates;

            for(var side = -halfLength; side <= halfLength; ++side) {
                if(Math.abs(side) <= gap)
                    continue;
                for(var depth = -thickness; depth <= thickness; ++depth) {
                    var x = Math.round(point.x + (nx * side) + (tangent.x * depth));
                    var y = Math.round(point.y + (ny * side) + (tangent.y * depth));
                    if(MapGen.Layers.Get(corridor.core, x, y, 0) ||
                        MapGen.Layers.Get(corridor.pocket, x, y, 0))
                        continue;
                    if(!this.CanStampCover(pContext, x, y))
                        continue;

                    ++candidates;
                    if(this.HashUnit(pContext, x + index, y + depth, 6211 + (pSalt || 0)) > chance)
                        continue;
                    if(!MapGen.Layers.Get(pContext.Layers.blocked, x, y, 0))
                        ++stamped;
                    this.MarkCoverCell(pContext, x, y);
                }
            }
        }

        return {
            stamped: stamped,
            candidates: candidates,
            gates: gates,
            chance: chance,
            spacing: spacing,
            halfLength: halfLength,
            thickness: thickness
        };
    },

    ApplySideWallCover: function(pContext, pDef, pChance, pSalt) {
        var corridor = pContext.RouteCorridor;
        var points = corridor && corridor.points ? corridor.points : [];
        var chance = Number(pChance || 0);
        var distanceFallback = pDef.sideCoverDistance !== undefined ?
            pDef.sideCoverDistance :
            Math.max(2, (pDef.halfWidth || 1) + Math.floor((pDef.edgeWidth || 2) * 0.75));
        var distance = Math.max(2, Math.floor(this.RangeNumber(pContext, "RouteArchetypeSideCoverDistance", distanceFallback)));
        var thickness = Math.max(0, Math.floor(this.RangeNumber(pContext, "RouteArchetypeSideCoverThickness", 0)));
        var tangentDepth = Math.max(0, Math.floor(this.RangeNumber(pContext, "RouteArchetypeSideCoverTangentDepth", 1)));
        var spacing = Math.max(1, Math.floor(this.RangeNumber(pContext, "RouteArchetypeSideCoverSpacing", 1)));
        var stamped = 0;
        var candidates = 0;

        if(!corridor || !points.length || chance <= 0)
            return { stamped: 0, candidates: 0 };

        for(var index = 0; index < points.length; index += spacing) {
            var point = points[index];
            var fraction = points.length > 1 ? index / (points.length - 1) : 0;
            var coreHalf = this.CorridorHalfWidth(pContext, pDef, fraction);
            var offset = Math.max(coreHalf + 1, distance);
            var tangent = this.TangentAtIndex(pContext, index);
            var nx = -tangent.y;
            var ny = tangent.x;

            for(var side = -1; side <= 1; side += 2) {
                for(var normal = -thickness; normal <= thickness; ++normal) {
                    var sideOffset = offset + normal;
                    if(sideOffset <= coreHalf)
                        continue;

                    for(var depth = -tangentDepth; depth <= tangentDepth; ++depth) {
                        var x = Math.round(point.x + (nx * side * sideOffset) + (tangent.x * depth));
                        var y = Math.round(point.y + (ny * side * sideOffset) + (tangent.y * depth));
                        if(MapGen.Layers.Get(corridor.core, x, y, 0) ||
                            MapGen.Layers.Get(corridor.pocket, x, y, 0))
                            continue;
                        if(!this.CanStampCover(pContext, x, y))
                            continue;

                        ++candidates;
                        if(this.HashUnit(pContext, x + index, y + depth, 6229 + (pSalt || 0)) > chance)
                            continue;
                        if(!MapGen.Layers.Get(pContext.Layers.blocked, x, y, 0))
                            ++stamped;
                        this.MarkCoverCell(pContext, x, y);
                    }
                }
            }
        }

        return {
            stamped: stamped,
            candidates: candidates,
            chance: chance,
            distance: distance,
            thickness: thickness,
            tangentDepth: tangentDepth,
            spacing: spacing
        };
    },

    ApplyEdgeCover: function(pContext) {
        if(!pContext || !pContext.RouteCorridor || !pContext.RouteCorridor.edge)
            return { stamped: 0, candidates: 0 };

        var resolved = pContext.RouteArchetype || this.Resolve(pContext);
        var def = resolved.definition || {};
        var chance = this.RangeNumber(pContext, "RouteArchetypeEdgeCoverChance", def.edgeCoverChance || 0);
        var passes = Math.max(1, Math.floor(this.RangeNumber(pContext, "RouteArchetypeEdgeCoverPasses", 1)));
        var outsideChance = this.RangeNumber(pContext, "RouteArchetypeOutsideCoverChance", def.outsideCoverChance || 0);
        var outsidePasses = Math.max(1, Math.floor(this.RangeNumber(pContext, "RouteArchetypeOutsideCoverPasses", 1)));
        var gateChance = this.RangeNumber(pContext, "RouteArchetypeGateCoverChance", def.gateCoverChance || 0);
        var sideChance = this.RangeNumber(pContext, "RouteArchetypeSideCoverChance", def.sideCoverChance || 0);
        var stamped = 0;
        var candidates = 0;
        var outsideStamped = 0;
        var outsideCandidates = 0;
        var sideCover = this.ApplySideWallCover(pContext, def, sideChance, 0);
        var gates = this.ApplyNarrowGateCover(pContext, def, gateChance, 0);

        if(chance <= 0 && outsideChance <= 0 && gateChance <= 0 && sideChance <= 0)
            return { stamped: 0, candidates: 0 };

        if(chance > 0) {
            for(var pass = 0; pass < passes; ++pass) {
                for(var x = 0; x < pContext.Width; ++x) {
                    for(var y = 0; y < pContext.Height; ++y) {
                        if(!MapGen.Layers.Get(pContext.RouteCorridor.edge, x, y, 0))
                            continue;
                        if(MapGen.Layers.Get(pContext.RouteCorridor.core, x, y, 0))
                            continue;
                        if(!this.CanStampCover(pContext, x, y))
                            continue;
                        ++candidates;
                        if(this.HashUnit(pContext, x + pass, y, 6191) > chance)
                            continue;
                        if(!MapGen.Layers.Get(pContext.Layers.blocked, x, y, 0))
                            ++stamped;
                        this.MarkCoverCell(pContext, x, y);
                    }
                }
            }
        }

        if(outsideChance > 0) {
            for(var outsidePass = 0; outsidePass < outsidePasses; ++outsidePass) {
                for(var ox = 0; ox < pContext.Width; ++ox) {
                    for(var oy = 0; oy < pContext.Height; ++oy) {
                        if(MapGen.Layers.Get(pContext.RouteCorridor.edge, ox, oy, 0) ||
                            MapGen.Layers.Get(pContext.RouteCorridor.core, ox, oy, 0) ||
                            MapGen.Layers.Get(pContext.RouteCorridor.pocket, ox, oy, 0))
                            continue;
                        if(!this.CanStampCover(pContext, ox, oy))
                            continue;
                        ++outsideCandidates;
                        if(this.HashUnit(pContext, ox + outsidePass, oy, 6203) > outsideChance)
                            continue;
                        if(!MapGen.Layers.Get(pContext.Layers.blocked, ox, oy, 0))
                            ++outsideStamped;
                        this.MarkCoverCell(pContext, ox, oy);
                    }
                }
            }
        }

        pContext.RouteCorridor.edgeCover = {
            archetype: resolved.name,
            stamped: stamped,
            candidates: candidates,
            chance: chance,
            passes: passes,
            outsideStamped: outsideStamped,
            outsideCandidates: outsideCandidates,
            outsideChance: outsideChance,
            outsidePasses: outsidePasses,
            sideCover: sideCover,
            gateCover: gates
        };

        if(stamped || outsideStamped || sideCover.stamped || gates.stamped)
            MapGen.Context.AddLog(
                pContext,
                "Route archetype cover stamped edge " + stamped +
                    " outside " + outsideStamped +
                    " side " + sideCover.stamped +
                    " gate " + gates.stamped + " cells"
            );

        return pContext.RouteCorridor.edgeCover;
    },

    Summary: function(pContext) {
        var corridor = pContext ? pContext.RouteCorridor : null;
        if(!corridor)
            return null;

        return {
            schema: corridor.schema || 1,
            archetype: corridor.archetype || "",
            points: corridor.points ? corridor.points.length : 0,
            pockets: corridor.pockets || [],
            stampedCore: corridor.stampedCore || 0,
            stampedEdge: corridor.stampedEdge || 0,
            stampedPockets: corridor.stampedPockets || 0,
            mazeNetwork: corridor.mazeNetwork || null,
            edgeCover: corridor.edgeCover || null,
            actualGateRepair: corridor.actualGateRepair || null
        };
    }
};
