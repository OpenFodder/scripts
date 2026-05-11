var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

MapGen.Layout.Archipelago = {

    ShouldRun: function(pContext) {
        // Profile-driven gate: only fire if the profile lists "archipelago" in
        // its ContinentStyles AND the weighted picker rolled it. The roll is
        // cached on pContext.SelectedContinentStyle so Continent.Build reads
        // the same value rather than rolling a second time and burning the
        // RNG twice. Profiles that don't list archipelago (i.e. every non-ice
        // biome today) skip the roll entirely so seed determinism is unchanged
        // for them.
        if(!pContext || !pContext.Profile || !pContext.Profile.ContinentStyles)
            return false;
        var styles = pContext.Profile.ContinentStyles;
        var hasArchipelago = false;
        for(var i = 0; i < styles.length; ++i) {
            if(styles[i] && styles[i].name === "archipelago") {
                hasArchipelago = true;
                break;
            }
        }
        if(!hasArchipelago)
            return false;
        if(pContext.SelectedContinentStyle === undefined)
            pContext.SelectedContinentStyle = MapGen.Layout.Continent.PickStyle(pContext.Profile, pContext.Random);
        return pContext.SelectedContinentStyle === "archipelago";
    },

    Build: function(pContext) {
        if(!this.ShouldRun(pContext))
            return;
        if(pContext.Continent)
            return;

        var W = pContext.Width;
        var H = pContext.Height;
        var random = pContext.Random;
        var water = pContext.Layers.water;

        // Flood the map with water; islands and causeways carve land.
        for(var x = 0; x < W; ++x) {
            for(var y = 0; y < H; ++y)
                water[x][y] = 1;
        }

        var islandCount = random.Int(2, 4);
        var seeds = this.PickSeeds(W, H, random, islandCount);

        var landFraction = MapGen.Layout.Continent.LandFractionForStyle(pContext.Profile, "archipelago");
        if(isNaN(landFraction) || landFraction <= 0 || landFraction >= 1)
            landFraction = 0.55;
        var totalTarget = Math.floor(W * H * landFraction);
        var perIsland = Math.max(8, Math.floor(totalTarget / seeds.length));

        var sizes = [];
        for(var i = 0; i < seeds.length; ++i) {
            // Per-island variance ±20% so islands aren't uniform.
            var variance = random.Float(0.8, 1.2);
            var grown = this.GrowIsland(pContext, seeds[i], Math.floor(perIsland * variance), random);
            sizes.push(grown);
        }

        this.ConnectIslands(pContext, seeds, random);

        var totalLand = 0;
        for(var lx = 0; lx < W; ++lx)
            for(var ly = 0; ly < H; ++ly)
                if(!water[lx][ly]) ++totalLand;

        pContext.Continent = {
            mode: "archipelago",
            islandCount: seeds.length,
            islandSeeds: seeds,
            islandSizes: sizes,
            landCount: totalLand,
            targetLand: totalTarget,
            landFraction: totalLand / (W * H),
            style: "archipelago",
            centre: { x: seeds[0].x, y: seeds[0].y }
        };

        MapGen.Context.AddLog(pContext, "Archipelago: " + seeds.length + " islands, land=" + totalLand);
    },

    PickSeeds: function(pW, pH, pRandom, pCount) {
        // Lay seeds along a jittered band of the longer axis so they're spread,
        // not clustered. Each seed sits at least 4 cells from the map edge.
        var seeds = [];
        var horizontal = pW >= pH;
        for(var i = 0; i < pCount; ++i) {
            var t = (i + 0.5) / pCount;
            var jitterAxis = pRandom.Float(-0.5 / pCount, 0.5 / pCount);
            var jitterOff = pRandom.Float(-0.30, 0.30);
            var sx, sy;
            if(horizontal) {
                sx = Math.floor((t + jitterAxis) * pW);
                sy = Math.floor((0.5 + jitterOff) * pH);
            } else {
                sx = Math.floor((0.5 + jitterOff) * pW);
                sy = Math.floor((t + jitterAxis) * pH);
            }
            sx = Math.max(4, Math.min(pW - 5, sx));
            sy = Math.max(4, Math.min(pH - 5, sy));
            seeds.push({ x: sx, y: sy });
        }
        return seeds;
    },

    GrowIsland: function(pContext, pSeed, pTargetSize, pRandom) {
        // Curvature-weighted frontier walk (mirrors Continent.Build). Cells with
        // more land neighbours win the next step, producing cohesive blobs with
        // concave bays rather than splatter.
        var W = pContext.Width;
        var H = pContext.Height;
        var water = pContext.Layers.water;

        if(!water[pSeed.x][pSeed.y])
            return 0;

        water[pSeed.x][pSeed.y] = 0;
        var landCount = 1;

        var frontier = [];
        var inFrontier = {};
        var pushNeighbours = function(cx, cy) {
            var dxs = [1, -1, 0, 0];
            var dys = [0, 0, 1, -1];
            for(var i = 0; i < 4; ++i) {
                var nx = cx + dxs[i];
                var ny = cy + dys[i];
                if(nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;
                if(!water[nx][ny]) continue;
                var key = nx + "," + ny;
                if(inFrontier[key]) continue;
                inFrontier[key] = true;
                frontier.push({ x: nx, y: ny, _w: 0 });
            }
        };
        pushNeighbours(pSeed.x, pSeed.y);

        var iterCap = pTargetSize * 6;
        var iters = 0;

        while(landCount < pTargetSize && frontier.length && iters < iterCap) {
            ++iters;

            var totalWeight = 0;
            for(var fi = 0; fi < frontier.length; ++fi) {
                var c = frontier[fi];
                var n = 0;
                if(c.x > 0 && !water[c.x - 1][c.y]) ++n;
                if(c.x < W - 1 && !water[c.x + 1][c.y]) ++n;
                if(c.y > 0 && !water[c.x][c.y - 1]) ++n;
                if(c.y < H - 1 && !water[c.x][c.y + 1]) ++n;
                c._w = (1 + n) * (1 + n);
                totalWeight += c._w;
            }
            if(totalWeight <= 0)
                break;

            var roll = pRandom.Float(0, totalWeight);
            var pickIdx = 0;
            var acc = 0;
            for(var pi = 0; pi < frontier.length; ++pi) {
                acc += frontier[pi]._w;
                if(acc >= roll) { pickIdx = pi; break; }
            }

            var picked = frontier[pickIdx];
            water[picked.x][picked.y] = 0;
            ++landCount;
            delete inFrontier[picked.x + "," + picked.y];
            frontier[pickIdx] = frontier[frontier.length - 1];
            frontier.pop();
            pushNeighbours(picked.x, picked.y);
        }

        return landCount;
    },

    ConnectIslands: function(pContext, pSeeds, pRandom) {
        // Minimum-spanning-tree (Prim's) over island seeds; stamp a 3-wide
        // causeway along each tree edge so the whole archipelago stays
        // walkable as one component.
        if(pSeeds.length < 2)
            return;

        var visited = [0];
        var unvisited = [];
        for(var i = 1; i < pSeeds.length; ++i)
            unvisited.push(i);

        while(unvisited.length) {
            var bestU = -1, bestV = -1, bestD = Number.POSITIVE_INFINITY;
            for(var vi = 0; vi < visited.length; ++vi) {
                for(var ui = 0; ui < unvisited.length; ++ui) {
                    var a = pSeeds[visited[vi]];
                    var b = pSeeds[unvisited[ui]];
                    var ddx = a.x - b.x;
                    var ddy = a.y - b.y;
                    var d = ddx * ddx + ddy * ddy;
                    if(d < bestD) { bestD = d; bestU = visited[vi]; bestV = unvisited[ui]; }
                }
            }
            if(bestU < 0) break;

            this.StampCauseway(pContext, pSeeds[bestU], pSeeds[bestV], pRandom);
            visited.push(bestV);
            for(var ki = 0; ki < unvisited.length; ++ki) {
                if(unvisited[ki] === bestV) { unvisited.splice(ki, 1); break; }
            }
        }
    },

    StampCauseway: function(pContext, pA, pB, pRandom) {
        // Bresenham line with a single hashed perpendicular bow so the causeway
        // isn't ruler-straight. Tags every carved cell on Layers.causeway so
        // downstream renderers can pick snow-bridge tiles for these spans.
        var halfWidth = 1;
        var x0 = pA.x | 0, y0 = pA.y | 0;
        var x1 = pB.x | 0, y1 = pB.y | 0;
        var dxAbs = Math.abs(x1 - x0);
        var dyAbs = -Math.abs(y1 - y0);
        var sx = x0 < x1 ? 1 : -1;
        var sy = y0 < y1 ? 1 : -1;
        var err = dxAbs + dyAbs;

        var span = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
        if(span < 1) span = 1;
        var ox = -(y1 - y0) / span;
        var oy = (x1 - x0) / span;
        var amp = Math.min(2, span / 16);
        var bowSign = pRandom.Chance(0.5) ? 1 : -1;

        var cx = x0, cy = y0;
        var stepIndex = 0;
        var maxSteps = Math.ceil(span) + 4;
        var W = pContext.Width;
        var H = pContext.Height;
        var water = pContext.Layers.water;
        var causeway = pContext.Layers.causeway;

        while(stepIndex <= maxSteps) {
            var t = span > 0 ? stepIndex / span : 0;
            var off = Math.round(Math.sin(t * Math.PI) * amp) * bowSign;
            var px = cx + Math.round(ox * off);
            var py = cy + Math.round(oy * off);

            for(var ddx = -halfWidth; ddx <= halfWidth; ++ddx) {
                for(var ddy = -halfWidth; ddy <= halfWidth; ++ddy) {
                    var nx = px + ddx;
                    var ny = py + ddy;
                    if(nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;
                    if(water[nx][ny]) {
                        water[nx][ny] = 0;
                        if(causeway)
                            causeway[nx][ny] = 1;
                    }
                }
            }

            if(cx === x1 && cy === y1)
                break;
            var e2 = 2 * err;
            if(e2 >= dyAbs) { err += dyAbs; cx += sx; }
            if(e2 <= dxAbs) { err += dxAbs; cy += sy; }
            ++stepIndex;
        }
    }
};
