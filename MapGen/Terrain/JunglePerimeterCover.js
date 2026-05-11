var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Cover = MapGen.Terrain.Cover || {};

(function(pJungle) {
    pJungle.SupportsPerimeterCover = function(pContext) {
        var profile = pContext.Profile || {};
        if(profile.PerimeterCover === false)
            return false;

        return profile.TerrainType === Terrain.Types.Jungle ||
            profile.TerrainType === Terrain.Types.Ice;
    };

    pJungle.MaxWalkablePerimeterRun = function(pContext) {
        var value = this.RangeValue(pContext, "MaxWalkablePerimeterRun", 8, 12, pContext.Width, pContext.Height, 1261);

        if(isNaN(value))
            value = 10;

        return Math.max(4, Math.min(24, Math.floor(value)));
    };

    pJungle.PerimeterCoverChance = function(pContext) {
        var value = this.RangeFloatValue(pContext, "PerimeterCoverChance", 0, 0, 0, 0, 1251);

        if(isNaN(value))
            value = 0;

        return Math.max(0, Math.min(1, value));
    };

    pJungle.EnsurePerimeterCoverLayer = function(pContext) {
        if(!pContext.Layers.perimeterCover)
            pContext.Layers.perimeterCover = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
        return pContext.Layers.perimeterCover;
    };

    pJungle.MarkPerimeterCoverCell = function(pContext, pX, pY) {
        this.MarkTreeCell(pContext, pX, pY);
        MapGen.Layers.Set(this.EnsurePerimeterCoverLayer(pContext), pX, pY, 1);
        MapGen.Layers.Set(pContext.Layers.coast, pX, pY, 0);
        MapGen.Layers.Set(pContext.Layers.riverBank, pX, pY, 0);
        MapGen.Layers.Set(pContext.Layers.forcedBank, pX, pY, 0);
        MapGen.Layers.Set(pContext.Layers.lakeShore, pX, pY, 0);
        MapGen.Layers.Set(pContext.Layers.terrainEdge, pX, pY, 0);
        MapGen.Layers.Set(pContext.Layers.occupied, pX, pY, 0);
    };

    pJungle.PerimeterDistance = function(pContext, pX, pY) {
        var left = pX;
        var top = pY;
        var right = pContext.Width - 1 - pX;
        var bottom = pContext.Height - 1 - pY;
        var minA = left < top ? left : top;
        var minB = right < bottom ? right : bottom;

        return minA < minB ? minA : minB;
    };

    pJungle.ApplyPerimeterCover = function(pContext) {
        if(!this.SupportsPerimeterCover(pContext))
            return { stamped: 0, width: 0 };

        var chance = this.PerimeterCoverChance(pContext);
        if(chance <= 0)
            return { stamped: 0, width: 0 };

        var width = Math.max(1, this.RangeValue(pContext, "PerimeterCoverWidth", 2, 3, 0, 0, 1253));
        var startDistance = this.OuterCoverClearance(pContext);
        // Ice never has 1-wide tree columns at the literal map-edge ring in
        // shipped maps (verified across 16 ice maps: 0 right-edge 1-wide
        // columns, all shipped right-edge forests are 5-9 cells wide). The
        // grammar_ice profile sets AllowOuterEdgeCover=true (Grammar.js:1240),
        // which collapses OuterCoverClearance to 0 and lets ApplyPerimeterCover
        // stamp on PerimeterDistance==0 (the literal x=0 / x=W-1 / y=0 /
        // y=H-1 ring). That's the source of seed 832202380's (71,24-26)
        // 1-wide right-edge tree column. Force startDistance>=1 for ice so
        // the outer ring stays clear of perimeter cover; the inner band
        // (PerimeterCoverWidth cells from distance 1) keeps producing
        // shipped-style coastline cover. Jungle/beach unaffected (this guard
        // is keyed on TerrainType). RCA 2026-06-13.
        var profile = pContext.Profile || {};
        if(profile.TerrainType === Terrain.Types.Ice && startDistance < 1)
            startDistance = 1;
        var stamped = 0;
        var considered = 0;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                var distance = this.PerimeterDistance(pContext, x, y);
                if(distance < startDistance || distance >= startDistance + width)
                    continue;

                // allowKeepClear lets the snowdrift band stamp inside a
                // structure's keepClear halo when the structure sits on the
                // map edge. Without this flag, a coastal bunker's clearing
                // halo blocks the band, leaving a flat snow→water boundary
                // beside the bunker (user-flagged on seed 7001 2026-06-15).
                // placementClearance was 5 — too wide for snowdrift cover,
                // which is just visual stippling that doesn't interfere with
                // gameplay. Lowered to 2 so the band can still draw beside
                // a structure (1-cell gap between structure footprint and
                // snowdrift). The structure's own occupied disc still
                // blocks the band from drawing ON the building footprint.
                if(!this.CanStampTacticalCover(pContext, x, y, {
                    allowKeepClear: true,
                    criticalClearance: 5,
                    placementClearance: 2
                }))
                    continue;

                ++considered;
                var falloff = 1.0 - ((distance / Math.max(1, width)) * 0.35);
                var roll = this.HashUnit(pContext, x, y, 1257);
                var score = (this.TreeScore(pContext, x, y) * 0.20) + (chance * falloff);

                if(roll > score)
                    continue;

                this.MarkPerimeterCoverCell(pContext, x, y);
                ++stamped;
            }
        }

        pContext._perimeterCover = {
            stamped: stamped,
            considered: considered,
            width: width,
            startDistance: startDistance,
            chance: chance
        };

        if(stamped)
            MapGen.Context.AddLog(pContext, "Applied perimeter cover (" + stamped + " tiles, width " + width + ")");

        return pContext._perimeterCover;
    };

    pJungle.IsPerimeterWalkableCell = function(pContext, pX, pY) {
        var layers = pContext.Layers;

        if(!MapGen.Layers.InBounds(layers.blocked, pX, pY))
            return false;
        if(this.PerimeterCellHasVisibleCover(pContext, pX, pY))
            return false;
        if(MapGen.Layers.Get(layers.water, pX, pY, 0))
            return false;

        return true;
    };

    pJungle.PerimeterCellHasVisibleCover = function(pContext, pX, pY) {
        var layers = pContext.Layers;
        if(!MapGen.Layers.Get(layers.blocked, pX, pY, 0))
            return false;

        if(MapGen.Layers.Get(layers.perimeterCover, pX, pY, 0))
            return true;

        if(MapGen.Layers.Get(layers.occupied, pX, pY, 0))
            return false;

        if(MapGen.Layers.Get(layers.path, pX, pY, 0) ||
            MapGen.Layers.Get(layers.coast, pX, pY, 0) ||
            MapGen.Layers.Get(layers.riverBank, pX, pY, 0) ||
            MapGen.Layers.Get(layers.forcedBank, pX, pY, 0) ||
            MapGen.Layers.Get(layers.lakeShore, pX, pY, 0))
            return false;

        if(pContext.Profile && pContext.Profile.TerrainType === Terrain.Types.Ice &&
            MapGen.Terrain.Smoothing && MapGen.Terrain.Smoothing.Ice) {
            var ice = MapGen.Terrain.Smoothing.Ice;
            if((ice.IsBankGroundCell && ice.IsBankGroundCell(pContext, pX, pY)) ||
                (ice.IsWetGroundCell && ice.IsWetGroundCell(pContext, pX, pY)))
                return false;
        }

        return true;
    };

    pJungle.CanForcePerimeterCover = function(pContext, pX, pY) {
        return this.CanStampTacticalCover(pContext, pX, pY, {
            criticalClearance: 3,
            placementClearance: 2,
            allowKeepClear: true,
            allowCoast: true,
            allowRiverBank: true,
            allowOccupied: true
        });
    };

    pJungle.StampPerimeterCoverWedge = function(pContext, pX, pY, pInwardDx, pInwardDy, pSalt) {
        var stamped = 0;
        var sideDx = -pInwardDy;
        var sideDy = pInwardDx;
        var cells = [
            { x: pX, y: pY },
            { x: pX + pInwardDx, y: pY + pInwardDy },
            { x: pX + pInwardDx * 2, y: pY + pInwardDy * 2 },
            { x: pX + sideDx, y: pY + sideDy },
            { x: pX - sideDx, y: pY - sideDy },
            { x: pX + pInwardDx + sideDx, y: pY + pInwardDy + sideDy },
            { x: pX + pInwardDx - sideDx, y: pY + pInwardDy - sideDy },
            { x: pX + pInwardDx * 3, y: pY + pInwardDy * 3 }
        ];

        for(var index = 0; index < cells.length; ++index) {
            var cell = cells[index];
            if(!this.CanForcePerimeterCover(pContext, cell.x, cell.y))
                continue;
            if(index === 7 && this.HashUnit(pContext, pX + pSalt, pY + index, 1269) < 0.45)
                continue;
            if(this.PerimeterCellHasVisibleCover(pContext, cell.x, cell.y))
                continue;

            this.MarkPerimeterCoverCell(pContext, cell.x, cell.y);
            ++stamped;
        }

        return stamped;
    };

    pJungle.BreakPerimeterWalkableRunsOnSide = function(pContext, pSideName, pCells, pInwardDx, pInwardDy, pMaxRun, pSalt) {
        var stamped = 0;
        var run = [];
        var self = this;
        var debug = {
            side: pSideName,
            maxRun: 0,
            longRuns: [],
            stamped: 0
        };

        function flush() {
            if(run.length > debug.maxRun)
                debug.maxRun = run.length;

            if(run.length <= pMaxRun) {
                run = [];
                return;
            }

            var beforeStamped = stamped;
            var blockCount = Math.max(1, Math.floor(run.length / (pMaxRun + 1)));
            var interval = run.length / (blockCount + 1);

            for(var index = 1; index <= blockCount; ++index) {
                var base = Math.round((interval * index) - 0.5);
                var jitter = (MapGen.Random.HashTile(pContext.Seed, run[0].x + index, run[0].y + pSalt, 1267) % 3) - 1;
                var center = Math.max(0, Math.min(run.length - 1, base + jitter));
                var placed = false;

                for(var radius = 0; radius <= Math.min(4, run.length - 1) && !placed; ++radius) {
                    for(var dir = radius === 0 ? 0 : -1; dir <= 1 && !placed; dir += 2) {
                        var candidateIndex = center + (radius * dir);
                        if(candidateIndex < 0 || candidateIndex >= run.length)
                            continue;
                        var cell = run[candidateIndex];
                        var added = self.StampPerimeterCoverWedge(pContext, cell.x, cell.y, pInwardDx, pInwardDy, pSalt + index);
                        if(added) {
                            stamped += added;
                            placed = true;
                        }
                    }
                }
            }

            debug.longRuns.push({
                start: { x: run[0].x, y: run[0].y },
                end: { x: run[run.length - 1].x, y: run[run.length - 1].y },
                length: run.length,
                stamped: stamped - beforeStamped
            });

            run = [];
        }

        for(var cellIndex = 0; cellIndex < pCells.length; ++cellIndex) {
            var cell = pCells[cellIndex];
            if(this.IsPerimeterWalkableCell(pContext, cell.x, cell.y))
                run.push(cell);
            else
                flush();
        }

        flush();
        debug.stamped = stamped;
        if(!pContext._perimeterRunDebug)
            pContext._perimeterRunDebug = [];
        pContext._perimeterRunDebug.push(debug);
        return stamped;
    };

    pJungle.BreakPerimeterWalkableRuns = function(pContext) {
        if(!this.SupportsPerimeterCover(pContext))
            return { stamped: 0, maxRun: 0 };

        var maxRun = this.MaxWalkablePerimeterRun(pContext);
        var width = pContext.Width;
        var height = pContext.Height;
        var top = [];
        var bottom = [];
        var left = [];
        var right = [];

        for(var x = 0; x < width; ++x) {
            top.push({ x: x, y: 0 });
            bottom.push({ x: x, y: height - 1 });
        }
        for(var y = 1; y < height - 1; ++y) {
            left.push({ x: 0, y: y });
            right.push({ x: width - 1, y: y });
        }

        var stamped = 0;
        pContext._perimeterRunDebug = [];
        stamped += this.BreakPerimeterWalkableRunsOnSide(pContext, "top", top, 0, 1, maxRun, 1);
        stamped += this.BreakPerimeterWalkableRunsOnSide(pContext, "bottom", bottom, 0, -1, maxRun, 11);
        stamped += this.BreakPerimeterWalkableRunsOnSide(pContext, "left", left, 1, 0, maxRun, 21);
        stamped += this.BreakPerimeterWalkableRunsOnSide(pContext, "right", right, -1, 0, maxRun, 31);

        pContext._perimeterWalkableRunBreakup = {
            stamped: stamped,
            maxRun: maxRun,
            sides: pContext._perimeterRunDebug
        };

        if(stamped)
            MapGen.Context.AddLog(pContext, "Broke perimeter walkable runs (" + stamped + " cover tiles, max run " + maxRun + ")");

        return pContext._perimeterWalkableRunBreakup;
    };
})(MapGen.Terrain.Cover);
