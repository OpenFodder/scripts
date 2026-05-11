var MapGen = MapGen || {};
MapGen.Integration = MapGen.Integration || {};

// Terrain classification, cover measurements and footprint query caches.
(function(pIntegration) {
    pIntegration.StructureContextRadius = function(pContext) {
        if(pContext && pContext.Profile && typeof pContext.Profile.StructureContextRadius === "number")
            return Math.max(0, Math.floor(pContext.Profile.StructureContextRadius));

        return 0;
    };

    pIntegration.StructureMinContextCoverFraction = function(pContext) {
        if(pContext && pContext.Profile && typeof pContext.Profile.MinStructureContextCoverFraction === "number")
            return Math.max(0, pContext.Profile.MinStructureContextCoverFraction);

        return 0;
    };

    pIntegration.StructureWaterClearance = function(pContext, pSpec) {
        if(pContext && pContext.Profile && typeof pContext.Profile.StructureWaterClearance === "number")
            return Math.max(0, Math.floor(pContext.Profile.StructureWaterClearance));

        return 0;
    };

    pIntegration.EffectiveStructureWaterClearance = function(pContext, pSpec, pOptions) {
        var clearance = this.StructureWaterClearance(pContext, pSpec);

        if(pOptions && pOptions.RelaxWaterClearance)
            return Math.min(clearance, 1);

        return clearance;
    };

    pIntegration.StructureCellIsWater = function(pContext, pX, pY) {
        if(!pContext || !pContext.Layers)
            return false;

        return !!(
            MapGen.Layers.Get(pContext.Layers.water, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.riverBank, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.lakeShore, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.coast, pX, pY, 0) ||
            (pContext.Layers.owner &&
                MapGen.Layers.Get(pContext.Layers.owner, pX, pY, 0) === MapGen.Layers.Owner.WATER)
        );
    };

    pIntegration.StructureCellIsWetGround = function(pContext, pX, pY) {
        if(!pContext || !pContext.Profile || pContext.Profile.TerrainType !== Terrain.Types.Ice)
            return false;
        if(!MapGen.Terrain || !MapGen.Terrain.Smoothing || !MapGen.Terrain.Smoothing.Ice)
            return false;

        var ice = MapGen.Terrain.Smoothing.Ice;
        return !!(
            (ice.IsBankGroundCell && ice.IsBankGroundCell(pContext, pX, pY)) ||
            (ice.IsWetGroundCell && ice.IsWetGroundCell(pContext, pX, pY))
        );
    };

    pIntegration.StructureCellIsWaterLike = function(pContext, pX, pY) {
        return this.StructureCellIsWater(pContext, pX, pY) ||
            this.StructureCellIsWetGround(pContext, pX, pY);
    };

    // Snapshot water and occupied cells for constant-time footprint queries.
    pIntegration.BuildStructurePlacementBitmap = function(pContext) {
        var width = pContext.Width;
        var height = pContext.Height;
        var bitmap = new Array(height);
        for(var y = 0; y < height; ++y) {
            var row = new Array(width);
            for(var x = 0; x < width; ++x) {
                var hard = 0;
                if(this.StructureCellIsWaterLike(pContext, x, y))
                    hard = 1;
                else if(this.IsStructureOccupiedTile(MapGen.Layers.Get(pContext.Layers.occupied, x, y, 0)))
                    hard = 1;
                row[x] = hard;
            }
            bitmap[y] = row;
        }
        return bitmap;
    };

    pIntegration.BuildStructureCliffProtectionBitmap = function(pContext) {
        var width = pContext.Width;
        var height = pContext.Height;
        var owner = pContext.Layers && pContext.Layers.owner;
        var mask = this.BuildStructureCliffProtectionMask(pContext);
        var hasMask = !!mask;
        var hasOwner = !!owner;
        var bitmap = new Array(height);
        for(var y = 0; y < height; ++y) {
            var row = new Array(width);
            for(var x = 0; x < width; ++x) {
                var v = 0;
                if(hasOwner && MapGen.Layers.Get(owner, x, y, 0) === MapGen.Layers.Owner.CLIFF)
                    v = 1;
                else if(hasMask && MapGen.Layers.Get(mask, x, y, 0))
                    v = 1;
                row[x] = v;
            }
            bitmap[y] = row;
        }
        return bitmap;
    };

    // Build a (W+1) x (H+1) summed-area table from a 2D 0/1 bitmap. Indexing
    // [y][x] mirrors the bitmap convention used elsewhere in this file. The
    // first row/column is zero so range queries don't need bounds-check
    // branches in the inner loop.
    pIntegration.BuildStructureSAT = function(pBitmap, pWidth, pHeight) {
        var sat = new Array(pHeight + 1);
        sat[0] = new Array(pWidth + 1);
        for(var fillX = 0; fillX <= pWidth; ++fillX)
            sat[0][fillX] = 0;
        for(var y = 1; y <= pHeight; ++y) {
            var row = new Array(pWidth + 1);
            row[0] = 0;
            var bitmapRow = pBitmap[y - 1];
            var prevRow = sat[y - 1];
            var rowSum = 0;
            for(var x = 1; x <= pWidth; ++x) {
                rowSum += bitmapRow[x - 1];
                row[x] = prevRow[x] + rowSum;
            }
            sat[y] = row;
        }
        return sat;
    };

    pIntegration.EnsureStructurePlacementSAT = function(pContext) {
        if(!pContext || !pContext.Layers || !pContext.Width || !pContext.Height)
            return null;
        if(pContext._structurePlacementSAT)
            return pContext._structurePlacementSAT;
        var bitmap = this.BuildStructurePlacementBitmap(pContext);
        pContext._structurePlacementSAT = this.BuildStructureSAT(bitmap, pContext.Width, pContext.Height);
        return pContext._structurePlacementSAT;
    };

    pIntegration.EnsureStructureCliffProtectionSAT = function(pContext) {
        if(!pContext || !pContext.Layers || !pContext.Width || !pContext.Height)
            return null;
        if(pContext._structureCliffProtectionSAT)
            return pContext._structureCliffProtectionSAT;
        if(!pContext.Cliffs || !pContext.Cliffs.length)
            return null;
        var bitmap = this.BuildStructureCliffProtectionBitmap(pContext);
        pContext._structureCliffProtectionSAT = this.BuildStructureSAT(bitmap, pContext.Width, pContext.Height);
        return pContext._structureCliffProtectionSAT;
    };

    // Snapshot rendered terrain classifications for repeated context queries.
    pIntegration.BuildStructureRenderedContextBitmaps = function(pContext) {
        var width = pContext.Width;
        var height = pContext.Height;
        if(typeof Map === "undefined" || !Map.TileGet)
            return null;

        var tree = new Array(height);
        var cliff = new Array(height);
        var water = new Array(height);
        var coverPlusCells = new Array(height);

        for(var y = 0; y < height; ++y) {
            var treeRow = new Array(width);
            var cliffRow = new Array(width);
            var waterRow = new Array(width);
            var sumRow = new Array(width);
            for(var x = 0; x < width; ++x) {
                var tile = Map.TileGet(x, y);
                var isWater = this.StructureRenderedCellIsWaterLike(pContext, x, y) ? 1 : 0;
                var isTreeArt = (!isWater && this.IsStructureTreeArtTile(pContext, tile)) ? 1 : 0;
                var isCliff = (this.IsStructureCliffProtectedCell(pContext, x, y) ||
                    (pContext.Layers && (
                        MapGen.Layers.Get(pContext.Layers.terrainEdge, x, y, 0) ||
                        MapGen.Layers.Get(pContext.Layers.outcrop, x, y, 0)))) ? 1 : 0;
                treeRow[x] = isTreeArt;
                cliffRow[x] = isCliff;
                waterRow[x] = isWater;
                sumRow[x] = isTreeArt + isCliff;
            }
            tree[y] = treeRow;
            cliff[y] = cliffRow;
            water[y] = waterRow;
            coverPlusCells[y] = sumRow;
        }

        return {
            width: width,
            height: height,
            tree: tree,
            cliff: cliff,
            water: water,
            // Combine tree and cliff cover for queries; retain individual
            // channels for live validation and tile diagnostics.
            coverSAT: this.BuildStructureSAT(coverPlusCells, width, height)
        };
    };

    pIntegration.EnsureStructureRenderedContextCache = function(pContext) {
        if(!pContext || !pContext.Profile || pContext.Profile.TerrainType !== Terrain.Types.Ice)
            return null;
        if(pContext._structureRenderedContextCache !== undefined)
            return pContext._structureRenderedContextCache || null;
        var cache = this.BuildStructureRenderedContextBitmaps(pContext);
        pContext._structureRenderedContextCache = cache || false;
        return cache || null;
    };

    // Annulus sum = full box minus inner rect (the structure footprint).
    // Returned value is the count of "cover" cells (tree + cliff) outside the
    // footprint within pRadius — exactly what StructureRenderedContextStats
    // computed cell-by-cell. cells is the corresponding cell count.
    pIntegration.StructureRenderedContextSAT = function(pContext, pRect, pRadius) {
        var cache = this.EnsureStructureRenderedContextCache(pContext);
        if(!cache || !cache.coverSAT)
            return null;
        var W = cache.width;
        var H = cache.height;
        var minX = pRect.minX - pRadius;
        var minY = pRect.minY - pRadius;
        var maxX = pRect.maxX + pRadius;
        var maxY = pRect.maxY + pRadius;
        var cellsBox = (Math.min(W - 1, maxX) - Math.max(0, minX) + 1) *
            (Math.min(H - 1, maxY) - Math.max(0, minY) + 1);
        if(cellsBox <= 0)
            return null;
        var rectCells = (Math.min(W - 1, pRect.maxX) - Math.max(0, pRect.minX) + 1) *
            (Math.min(H - 1, pRect.maxY) - Math.max(0, pRect.minY) + 1);
        if(rectCells <= 0)
            return null;
        var coverBox = this.StructureSATSum(cache.coverSAT, W, H, minX, minY, maxX, maxY);
        var coverInner = this.StructureSATSum(cache.coverSAT, W, H, pRect.minX, pRect.minY, pRect.maxX, pRect.maxY);
        var cells = cellsBox - rectCells;
        var cover = coverBox - coverInner;
        return {
            cells: cells,
            cover: cover,
            coverFraction: cells > 0 ? cover / cells : 0
        };
    };

    // Range sum over [pMinX..pMaxX] x [pMinY..pMaxY] (inclusive). Returns 0
    // if the box is empty. Coordinates are clamped to the map; out-of-bounds
    // contribution is treated as zero (the caller is responsible for any
    // separate "footprint extends past the map edge" rejection).
    pIntegration.StructureSATSum = function(pSAT, pWidth, pHeight, pMinX, pMinY, pMaxX, pMaxY) {
        if(pMinX > pMaxX || pMinY > pMaxY)
            return 0;
        var x0 = pMinX < 0 ? 0 : pMinX;
        var y0 = pMinY < 0 ? 0 : pMinY;
        var x1 = pMaxX >= pWidth ? pWidth - 1 : pMaxX;
        var y1 = pMaxY >= pHeight ? pHeight - 1 : pMaxY;
        if(x0 > x1 || y0 > y1)
            return 0;
        return pSAT[y1 + 1][x1 + 1] - pSAT[y0][x1 + 1] - pSAT[y1 + 1][x0] + pSAT[y0][x0];
    };

    pIntegration.StructureRenderedCellIsWaterLike = function(pContext, pX, pY) {
        if(this.StructureCellIsWaterLike(pContext, pX, pY))
            return true;

        if(typeof Map === "undefined" || !Map.TileTerrainFeature)
            return false;

        var feature = Map.TileTerrainFeature(pX, pY);
        return feature === 5 || feature === 6 || feature === 11;
    };

    pIntegration.StructureWaterOverlapStats = function(pContext, pRect, pClearance, pUseRendered) {
        var clearance = Math.max(0, Math.floor(pClearance || 0));
        var stats = {
            footprint: 0,
            clearance: 0,
            cells: 0
        };

        if(!pContext || !pRect)
            return stats;

        for(var x = pRect.minX - clearance; x <= pRect.maxX + clearance; ++x) {
            for(var y = pRect.minY - clearance; y <= pRect.maxY + clearance; ++y) {
                if(x < 0 || y < 0 || x >= pContext.Width || y >= pContext.Height)
                    continue;

                var inFootprint = x >= pRect.minX && x <= pRect.maxX && y >= pRect.minY && y <= pRect.maxY;
                var waterLike = pUseRendered ?
                    this.StructureRenderedCellIsWaterLike(pContext, x, y) :
                    this.StructureCellIsWaterLike(pContext, x, y);

                if(!waterLike)
                    continue;

                ++stats.cells;
                if(inFootprint)
                    ++stats.footprint;
                else
                    ++stats.clearance;
            }
        }

        return stats;
    };

    pIntegration.StructureWaterClearanceConflict = function(pContext, pRect, pClearance) {
        if(!pClearance)
            return false;

        return this.StructureWaterOverlapStats(pContext, pRect, pClearance, false).clearance > 0;
    };

    // Snapshot layer classifications; outer-box minus footprint queries measure the surrounding cover.
    pIntegration.BuildStructureContextBitmaps = function(pContext) {
        if(!pContext || !pContext.Layers)
            return null;
        var width = pContext.Width;
        var height = pContext.Height;
        var L = pContext.Layers;
        var hasOwner = !!L.owner;
        var TREE = MapGen.Layers.Owner.TREE;
        var CLIFF = MapGen.Layers.Owner.CLIFF;
        var tree = new Array(height);
        var cliff = new Array(height);
        var water = new Array(height);

        for(var y = 0; y < height; ++y) {
            var treeRow = new Array(width);
            var cliffRow = new Array(width);
            var waterRow = new Array(width);
            for(var x = 0; x < width; ++x) {
                var owner = hasOwner ? MapGen.Layers.Get(L.owner, x, y, 0) : 0;
                var isWater = this.StructureCellIsWaterLike(pContext, x, y) ? 1 : 0;
                var blocked = MapGen.Layers.Get(L.blocked, x, y, 0);
                var path = MapGen.Layers.Get(L.path, x, y, 0) || MapGen.Layers.Get(L.keepClear, x, y, 0);
                var occupied = MapGen.Layers.Get(L.occupied, x, y, 0);
                var coverMarker =
                    MapGen.Layers.Get(L.perimeterCover, x, y, 0) ||
                    MapGen.Layers.Get(L.finalFieldCover, x, y, 0) ||
                    MapGen.Layers.Get(L.finalRouteCover, x, y, 0) ||
                    MapGen.Layers.Get(L.softFillCover, x, y, 0) ||
                    MapGen.Layers.Get(L.structureContextCover, x, y, 0);
                var coverCanRender = coverMarker && blocked && !path && !occupied ? 1 : 0;
                var ownerTreeCanRender = (owner === TREE) && blocked && !path && !occupied ? 1 : 0;

                var isTree = (!isWater && (ownerTreeCanRender || coverCanRender)) ? 1 : 0;
                var isCliff = (owner === CLIFF ||
                    MapGen.Layers.Get(L.terrainEdge, x, y, 0) ||
                    MapGen.Layers.Get(L.outcrop, x, y, 0)) ? 1 : 0;

                treeRow[x] = isTree;
                cliffRow[x] = isCliff;
                waterRow[x] = isWater;
            }
            tree[y] = treeRow;
            cliff[y] = cliffRow;
            water[y] = waterRow;
        }

        return {
            width: width,
            height: height,
            treeSAT: this.BuildStructureSAT(tree, width, height),
            cliffSAT: this.BuildStructureSAT(cliff, width, height),
            waterSAT: this.BuildStructureSAT(water, width, height)
        };
    };

    pIntegration.EnsureStructureContextCache = function(pContext) {
        if(!pContext || !pContext.Layers || !pContext.Width || !pContext.Height)
            return null;
        if(pContext._structureContextCache !== undefined)
            return pContext._structureContextCache || null;
        var cache = this.BuildStructureContextBitmaps(pContext);
        pContext._structureContextCache = cache || false;
        return cache || null;
    };

    pIntegration.StructureContextStats = function(pContext, pRect, pRadius) {
        var stats = {
            cells: 0,
            tree: 0,
            cliff: 0,
            water: 0,
            route: 0,
            coverFraction: 0,
            waterFraction: 0
        };

        if(!pContext || !pContext.Layers || !pRadius)
            return stats;

        // Hot-path SAT branch: identical bitmap predicates to the cell loop
        // below. The route channel is omitted from the SAT (no caller reads
        // stats.route), so the cell-loop fallback is still authoritative for
        // anything that needs it.
        var cache = this.EnsureStructureContextCache(pContext);
        if(cache) {
            var W = cache.width;
            var H = cache.height;
            var minX = pRect.minX - pRadius;
            var minY = pRect.minY - pRadius;
            var maxX = pRect.maxX + pRadius;
            var maxY = pRect.maxY + pRadius;
            var bx0 = Math.max(0, minX);
            var by0 = Math.max(0, minY);
            var bx1 = Math.min(W - 1, maxX);
            var by1 = Math.min(H - 1, maxY);
            var rx0 = Math.max(0, pRect.minX);
            var ry0 = Math.max(0, pRect.minY);
            var rx1 = Math.min(W - 1, pRect.maxX);
            var ry1 = Math.min(H - 1, pRect.maxY);
            if(bx1 >= bx0 && by1 >= by0 && rx1 >= rx0 && ry1 >= ry0) {
                var cellsBox = (bx1 - bx0 + 1) * (by1 - by0 + 1);
                var rectCells = (rx1 - rx0 + 1) * (ry1 - ry0 + 1);
                if(cellsBox > rectCells) {
                    var treeBox = this.StructureSATSum(cache.treeSAT, W, H, minX, minY, maxX, maxY);
                    var treeInner = this.StructureSATSum(cache.treeSAT, W, H, pRect.minX, pRect.minY, pRect.maxX, pRect.maxY);
                    var cliffBox = this.StructureSATSum(cache.cliffSAT, W, H, minX, minY, maxX, maxY);
                    var cliffInner = this.StructureSATSum(cache.cliffSAT, W, H, pRect.minX, pRect.minY, pRect.maxX, pRect.maxY);
                    var waterBox = this.StructureSATSum(cache.waterSAT, W, H, minX, minY, maxX, maxY);
                    var waterInner = this.StructureSATSum(cache.waterSAT, W, H, pRect.minX, pRect.minY, pRect.maxX, pRect.maxY);
                    stats.cells = cellsBox - rectCells;
                    stats.tree = treeBox - treeInner;
                    stats.cliff = cliffBox - cliffInner;
                    stats.water = waterBox - waterInner;
                    stats.coverFraction = stats.cells > 0 ? (stats.tree + stats.cliff) / stats.cells : 0;
                    stats.waterFraction = stats.cells > 0 ? stats.water / stats.cells : 0;
                    return stats;
                }
            }
        }

        for(var x = pRect.minX - pRadius; x <= pRect.maxX + pRadius; ++x) {
            for(var y = pRect.minY - pRadius; y <= pRect.maxY + pRadius; ++y) {
                if(x < 0 || y < 0 || x >= pContext.Width || y >= pContext.Height)
                    continue;
                if(x >= pRect.minX && x <= pRect.maxX && y >= pRect.minY && y <= pRect.maxY)
                    continue;

                ++stats.cells;

                var owner = pContext.Layers.owner ?
                    MapGen.Layers.Get(pContext.Layers.owner, x, y, MapGen.Layers.Owner.NONE) :
                    MapGen.Layers.Owner.NONE;
                var water = this.StructureCellIsWaterLike(pContext, x, y);
                var blocked = MapGen.Layers.Get(pContext.Layers.blocked, x, y, 0);
                var path =
                    MapGen.Layers.Get(pContext.Layers.path, x, y, 0) ||
                    MapGen.Layers.Get(pContext.Layers.keepClear, x, y, 0);
                var occupied = MapGen.Layers.Get(pContext.Layers.occupied, x, y, 0);
                var coverMarker =
                    MapGen.Layers.Get(pContext.Layers.perimeterCover, x, y, 0) ||
                    MapGen.Layers.Get(pContext.Layers.finalFieldCover, x, y, 0) ||
                    MapGen.Layers.Get(pContext.Layers.finalRouteCover, x, y, 0) ||
                    MapGen.Layers.Get(pContext.Layers.softFillCover, x, y, 0) ||
                    MapGen.Layers.Get(pContext.Layers.structureContextCover, x, y, 0);
                var coverCanRender =
                    coverMarker &&
                    blocked &&
                    !path &&
                    !occupied;
                var ownerTreeCanRender =
                    owner === MapGen.Layers.Owner.TREE &&
                    blocked &&
                    !path &&
                    !occupied;

                if(water)
                    ++stats.water;
                if((ownerTreeCanRender && !water) ||
                    (coverCanRender && !water))
                    ++stats.tree;
                if(owner === MapGen.Layers.Owner.CLIFF ||
                    MapGen.Layers.Get(pContext.Layers.terrainEdge, x, y, 0) ||
                    MapGen.Layers.Get(pContext.Layers.outcrop, x, y, 0))
                    ++stats.cliff;
                if(path)
                    ++stats.route;
            }
        }

        if(stats.cells > 0) {
            stats.coverFraction = (stats.tree + stats.cliff) / stats.cells;
            stats.waterFraction = stats.water / stats.cells;
        }

        return stats;
    };

    pIntegration.StructureRenderedStyleSpec = function(pContext) {
        if(!pContext)
            return null;
        if(pContext._structureRenderedStyleSpec !== undefined)
            return pContext._structureRenderedStyleSpec || null;

        var materialize = MapGen.Grammar && MapGen.Grammar.StyleMaterialize ?
            MapGen.Grammar.StyleMaterialize :
            null;
        var sets = MapGen.Grammar && MapGen.Grammar.StyleTileSets ?
            MapGen.Grammar.StyleTileSets :
            null;
        var spec = null;

        if(materialize && materialize.GrammarStyleSpec && materialize.GrammarStylePrepareSpec) {
            spec = materialize.GrammarStylePrepareSpec(materialize.GrammarStyleSpec(pContext));
        } else if(sets && sets.GrammarStyleSpec && sets.GrammarStyleSet) {
            spec = sets.GrammarStyleSpec(pContext);
            spec.visualSets = {
                building: sets.GrammarStyleSet(spec.building),
                cliff: sets.GrammarStyleSet(spec.cliff),
                decor: sets.GrammarStyleSet(spec.decor),
                tree: sets.GrammarStyleSet(spec.tree),
                water: sets.GrammarStyleSet(spec.water),
                land: sets.GrammarStyleSet(spec.land)
            };
        }

        pContext._structureRenderedStyleSpec = spec || false;
        return spec || null;
    };

    pIntegration.StructureRenderedVisualClass = function(pContext, pTileId) {
        var spec = this.StructureRenderedStyleSpec(pContext);
        var materialize = MapGen.Grammar && MapGen.Grammar.StyleMaterialize ?
            MapGen.Grammar.StyleMaterialize :
            null;
        var tileId = Number(pTileId || 0) & 0x1FF;
        var sets;

        if(!spec)
            return "";
        if(materialize && materialize.GrammarStyleVisualClass)
            return materialize.GrammarStyleVisualClass(spec, tileId);

        sets = spec.visualSets || {};
        if(sets.building && sets.building[tileId]) return "building";
        if(sets.cliff && sets.cliff[tileId]) return "cliff";
        if(sets.decor && sets.decor[tileId]) return "decor";
        if(sets.tree && sets.tree[tileId]) return "tree";
        if(sets.water && sets.water[tileId]) return "water";
        if(sets.land && sets.land[tileId]) return "land";
        return "other";
    };

    pIntegration.IsStructureTreeArtTile = function(pContext, pTileId) {
        if(pContext && pContext.Profile &&
            pContext.Profile.TerrainType === Terrain.Types.Ice &&
            this.IsIceTreeArtTile) {
            return this.IsIceTreeArtTile(pTileId);
        }

        return this.StructureRenderedVisualClass(pContext, pTileId) === "tree";
    };

    pIntegration.StructureRenderedContextStats = function(pContext, pRect, pRadius, pOptions) {
        var stats = {
            cells: 0,
            tree: 0,
            cliff: 0,
            water: 0,
            coverFraction: 0,
            waterFraction: 0,
            topTiles: []
        };

        if(!pContext || !pRect || !pRadius || typeof Map === "undefined" || !Map.TileGet)
            return stats;

        // The hot path (StructureRenderedContextTooOpen during structure
        // search) only reads coverFraction; the "top N tile counts" tally
        // exists for the LiveValidation post-mortem dump and nothing else.
        // Tabulating + sorting it for ~3000 candidate sites burns time on a
        // result the caller throws away, so opt in only when LiveValidation
        // asks for it.
        var collectTopTiles = !!(pOptions && pOptions.IncludeTopTiles);
        var tileCounts = collectTopTiles ? {} : null;

        for(var x = pRect.minX - pRadius; x <= pRect.maxX + pRadius; ++x) {
            for(var y = pRect.minY - pRadius; y <= pRect.maxY + pRadius; ++y) {
                if(x < 0 || y < 0 || x >= pContext.Width || y >= pContext.Height)
                    continue;
                if(x >= pRect.minX && x <= pRect.maxX && y >= pRect.minY && y <= pRect.maxY)
                    continue;

                ++stats.cells;

                var tile = Map.TileGet(x, y);
                var water = this.StructureRenderedCellIsWaterLike(pContext, x, y);
                if(collectTopTiles) {
                    var tileId = Number(tile || 0) & 0x1FF;
                    tileCounts[tileId] = (tileCounts[tileId] || 0) + 1;
                }
                if(water)
                    ++stats.water;
                if(!water && this.IsStructureTreeArtTile(pContext, tile))
                    ++stats.tree;
                if(this.IsStructureCliffProtectedCell(pContext, x, y) ||
                    (pContext.Layers && (
                        MapGen.Layers.Get(pContext.Layers.terrainEdge, x, y, 0) ||
                        MapGen.Layers.Get(pContext.Layers.outcrop, x, y, 0)))) {
                    ++stats.cliff;
                }
            }
        }

        if(stats.cells > 0) {
            stats.coverFraction = (stats.tree + stats.cliff) / stats.cells;
            stats.waterFraction = stats.water / stats.cells;
        }
        if(tileCounts) {
            for(var key in tileCounts) {
                if(Object.prototype.hasOwnProperty.call(tileCounts, key))
                    stats.topTiles.push({ tile: Number(key), count: tileCounts[key] });
            }
            stats.topTiles.sort(function(pLeft, pRight) {
                if(pLeft.count !== pRight.count)
                    return pRight.count - pLeft.count;
                return pLeft.tile - pRight.tile;
            });
            if(stats.topTiles.length > 12)
                stats.topTiles.length = 12;
        }

        return stats;
    };

    pIntegration.StructureContextTooOpen = function(pContext, pRect) {
        var minCover = this.StructureMinContextCoverFraction(pContext);
        var radius = this.StructureContextRadius(pContext);

        if(minCover <= 0 || radius <= 0)
            return false;

        return this.StructureContextStats(pContext, pRect, radius).coverFraction < minCover;
    };

    pIntegration.StructureRenderedContextTooOpen = function(pContext, pRect) {
        if(!pContext || !pContext.Profile || pContext.Profile.TerrainType !== Terrain.Types.Ice)
            return false;
        if(!this.StructureRenderedContextStats || typeof Map === "undefined" || !Map.TileGet)
            return false;

        var radius = this.StructureContextRadius ? this.StructureContextRadius(pContext) : 0;
        var minCover = pContext.Profile && typeof pContext.Profile.MinRenderedStructureContextCoverFraction === "number" ?
            Math.max(0, pContext.Profile.MinRenderedStructureContextCoverFraction) :
            (this.StructureMinContextCoverFraction ? this.StructureMinContextCoverFraction(pContext) * 0.60 : 0);

        if(radius <= 0 || minCover <= 0)
            return false;

        // Hot path during structure search: every shortlist candidate runs
        // through here, and StructureRenderedContextStats invokes Map.TileGet
        // (engine bridge call) ~80 times per call. Use the precomputed SAT
        // cache when available — annulus = full-box minus inner-rect, both
        // O(1).
        var sat = this.StructureRenderedContextSAT(pContext, pRect, radius);
        if(sat)
            return sat.coverFraction < minCover;

        return this.StructureRenderedContextStats(pContext, pRect, radius).coverFraction < minCover;
    };
})(MapGen.Integration);
