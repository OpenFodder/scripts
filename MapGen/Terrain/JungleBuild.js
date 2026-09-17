var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Cover = MapGen.Terrain.Cover || {};

(function(pJungle) {
    pJungle.ApplyTreeMask = function(pContext) {
        if(pContext.IntentMap && pContext.Profile.ForestUseAuthoredMask) {
            var intent = pContext.IntentMap, forest = MapGen.Intent.Terrain.FOREST;
            for(var ax = 0; ax < pContext.Width; ++ax) {
                for(var ay = 0; ay < pContext.Height; ++ay) {
                    pContext.Layers.blocked[ax][ay] = 0;
                    if(intent.terrain[ay * intent.width + ax] === forest &&
                        !this.IsExcluded(pContext, ax, ay))
                        this.MarkTreeCell(pContext, ax, ay);
                }
            }
            return;
        }
        if(pContext.OriginalTerrainTemplate && MapGen.Grammar &&
            MapGen.Grammar.ApplyOriginalTerrainCover) {
            MapGen.Grammar.ApplyOriginalTerrainCover(pContext);
            return;
        }

        if(pContext.Profile && pContext.Profile.JungleMazeForestFill === true) {
            this.ApplyMazeForestFill(pContext);
            return;
        }

        if(pContext.Profile && pContext.Profile.ForestPatchAndGrow) {
            this.PatchAndGrow(pContext);
            this.ApplySectorForestFill(pContext);
            this.ApplyCarvedForestFill(pContext);
            return;
        }

        var coverage = pContext.Profile.TreeCoverage;
        var candidates = [];
        var targetCount;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                MapGen.Layers.Set(pContext.Layers.blocked, x, y, 0);

                if(this.IsOuterCoverBuffer(pContext, x, y))
                    continue;
                if(MapGen.Layers.Get(pContext.Layers.keepClear, x, y, 0))
                    continue;
                if(MapGen.Layers.Get(pContext.Layers.water, x, y, 0))
                    continue;
                if(MapGen.Layers.Get(pContext.Layers.coast, x, y, 0))
                    continue;

                candidates.push({
                    x: x,
                    y: y,
                    score: this.TreeScore(pContext, x, y)
                });
            }
        }

        candidates.sort(function(pA, pB) {
            if(pA.score !== pB.score)
                return pB.score - pA.score;
            // Total-order tiebreak on unique cell coords (TreeScore ties are
            // common; the engine's Array.sort is unstable).
            if(pA.x !== pB.x)
                return pA.x - pB.x;
            return pA.y - pB.y;
        });

        // Beach compositions specify whole-map cover targets. Applying that
        // fraction to the remaining dry cells underfills deeper shores and
        // makes retries favour the same shallow layout. Rank enough forest
        // up front; all route, water and building exclusions still apply.
        var coverArea = pContext.RegionalPlan && pContext.Profile.Name === "grammar_beach" ?
            pContext.Width * pContext.Height : candidates.length;
        targetCount = Math.max(0, Math.min(candidates.length, Math.round(coverArea * coverage)));

        for(var index = 0; index < targetCount; ++index) {
            this.MarkTreeCell(pContext, candidates[index].x, candidates[index].y);
        }

        MapGen.Context.AddLog(pContext, "Applied clustered terrain cover mask");
    };

    pJungle.SmoothBlockedMaskPass = function(pContext) {
        var next = MapGen.Layers.Clone(pContext.Layers.blocked);

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(this.IsOuterCoverBuffer(pContext, x, y)) {
                    MapGen.Layers.Set(next, x, y, 0);
                    continue;
                }
                // Architecture v3: cliff BODY cells are owner==CLIFF and carry
                // keepClear=1, so the clause below would clear their blocked
                // every pass — which is exactly why the legacy ReassertFootprint
                // re-stamped them afterward. Instead, keep blocked here: a cliff
                // body cell is owner==CLIFF AND currently blocked==1. Stairs,
                // crossings and the top-edge row are owner==CLIFF but blocked==0
                // (walkable), so they're naturally excluded and stay clear.
                if(pContext.Layers.owner &&
                    MapGen.Layers.Get(pContext.Layers.owner, x, y, 0) === MapGen.Layers.Owner.CLIFF &&
                    MapGen.Layers.Get(pContext.Layers.blocked, x, y, 0)) {
                    MapGen.Layers.Set(next, x, y, 1);
                    continue;
                }
                if(pContext.Layers.treeTrimmed &&
                    MapGen.Layers.Get(pContext.Layers.treeTrimmed, x, y, 0)) {
                    MapGen.Layers.Set(next, x, y, 0);
                    continue;
                }
                if(MapGen.Layers.Get(pContext.Layers.keepClear, x, y, 0) ||
                    MapGen.Layers.Get(pContext.Layers.water, x, y, 0) ||
                    MapGen.Layers.Get(pContext.Layers.coast, x, y, 0) ||
                    MapGen.Layers.Get(pContext.Layers.occupied, x, y, 0)) {
                    MapGen.Layers.Set(next, x, y, 0);
                    continue;
                }

                var blocked = MapGen.Layers.Get(pContext.Layers.blocked, x, y, 0);
                var neighbors = this.NeighborBlockedCount(pContext, x, y);
                // If a profile explicitly allows literal edge cover, scale
                // the smoothing thresholds for cells with fewer in-bounds
                // neighbours. The normal path clears the outer cover buffer
                // before this point so tree art never has to render clipped
                // against the map border.
                var atEdge = (x === 0 || x === pContext.Width - 1 || y === 0 || y === pContext.Height - 1);
                var inBounds = atEdge ? ((x === 0 || x === pContext.Width - 1) && (y === 0 || y === pContext.Height - 1) ? 3 : 5) : 8;
                var erodeThreshold = Math.floor((inBounds * 2) / 8);
                var growthThreshold = Math.floor((inBounds * 5) / 8);

                if(blocked && neighbors <= erodeThreshold) {
                    MapGen.Layers.Set(next, x, y, 0);
                }
                else if(!blocked && neighbors >= growthThreshold && !MapGen.Layers.Get(pContext.Layers.terrainEdge, x, y, 0)) {
                    MapGen.Layers.Set(next, x, y, 1);
                }
            }
        }

        pContext.Layers.blocked = next;
    };

    pJungle.SmoothBlockedMask = function(pContext) {
        // Maze topology is already an exact one-cell corridor cut through a
        // continuous forest mask. Cellular smoothing here erodes every thin
        // wall/end cap for several passes, joining neighbouring corridors
        // into the broad lawns that made the result stop reading as a maze.
        // Leave the authored mask intact; the tile bitmask renderer still
        // rounds the visible canopy edges without changing walkability.
        if(pContext.Profile && pContext.Profile.JungleMazeForestFill === true) {
            MapGen.Context.AddLog(pContext, "Preserved authored jungle maze forest mask");
            return;
        }

        // Patch-and-grow already produces shape-coherent blobs; running the
        // CA 2-4 times merges adjacent patches into uniform texture. One
        // pass is enough to clean up single-tile spikes left by the density
        // jitter without erasing the lobe structure.
        var patchAndGrow = pContext.Profile && pContext.Profile.ForestPatchAndGrow;
        var passes = patchAndGrow ?
            1 :
            Math.max(2, Math.min(4, Math.floor(Math.min(pContext.Width, pContext.Height) / 24)));

        for(var pass = 0; pass < passes; ++pass)
            this.SmoothBlockedMaskPass(pContext);

        MapGen.Context.AddLog(pContext, "Smoothed blocked terrain cover mask with " + passes + " passes");
    };

    pJungle.Build = function(pContext) {
        if(pContext.OriginalTerrainTemplate) {
            this.MarkSoftEdges(pContext);
            this.ApplyTreeMask(pContext);
            // Resampling and the low-frequency warp can leave a one-cell
            // stair-step. One ownership-aware pass cleans that boundary while
            // retaining the original map's lobes, corridors and clearings.
            if(!(pContext.Profile && pContext.Profile.JungleMazeForestFill === true)) {
                var originalPasses = pContext.Profile &&
                    pContext.Profile.TerrainType === Terrain.Types.Ice ? 2 : 1;
                for(var originalPass = 0; originalPass < originalPasses; ++originalPass)
                    this.SmoothBlockedMaskPass(pContext);
            }
            this.ClearOuterCoverBuffer(pContext);
            MapGen.Context.AddLog(pContext,
                "Preserved original-map terrain composition; skipped generic cover fill");
            return pContext;
        }

        this.MarkSoftEdges(pContext);
        this.ApplyTreeMask(pContext);
        // ApplyTreeMask clears and rebuilds the complete blocked layer for the
        // generic, authored-mask, and patch-and-grow paths. Maze fill preserves
        // selected pre-existing hard owners while skipping the outer buffer,
        // so only that path still needs this early cleanup scan.
        if(pContext.Profile && pContext.Profile.JungleMazeForestFill === true)
            this.ClearOuterCoverBuffer(pContext);
        this.ApplyPerimeterCover(pContext);
        this.ApplyTacticalCover(pContext);
        this.ApplyOpenAreaBreakup(pContext);
        this.SmoothBlockedMask(pContext);
        if(MapGen.Layout && MapGen.Layout.RouteArchetypes &&
            MapGen.Layout.RouteArchetypes.ApplyEdgeCover)
            MapGen.Layout.RouteArchetypes.ApplyEdgeCover(pContext);
        this.BreakPerimeterWalkableRuns(pContext);
        this.ClearOuterCoverBuffer(pContext);
        return pContext;
    };
})(MapGen.Terrain.Cover);
