var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};
MapGen.Terrain.Smoothing.Jungle = MapGen.Terrain.Smoothing.Jungle || {};

(function(pJungle) {
    pJungle.RepairSub1GrammarBeachFinalGrassSideMasks = function(pContext, pTiles, pLookup) {
        if(!this.IsGrammarBeachProfile(pContext))
            return 0;

        var core = MapGen.Terrain.Smoothing.Core;
        var self = this;
        var changed = 0;
        var transitionTiles = {
            252: true, 255: true, 256: true, 257: true, 258: true,
            259: true, 272: true, 275: true, 276: true, 277: true,
            278: true, 279: true, 292: true, 293: true, 294: true,
            295: true, 297: true, 298: true, 316: true, 317: true,
            324: true,
            335: true, 337: true
        };

        function nearbyPlainGrassTile(pSelf, pX, pY) {
            var offsets = [
                [1, 0],
                [-1, 0],
                [0, -1],
                [0, 1]
            ];

            for(var index = 0; index < offsets.length; ++index) {
                var tileId = MapGen.Layers.Get(pTiles, pX + offsets[index][0], pY + offsets[index][1], -1);
                if(tileId < 0 || transitionTiles[tileId])
                    continue;
                if(tileId === 123 || tileId === 124)
                    return tileId;
            }

            return pSelf.Sub1DarkGrassFloorTile(pContext, pX, pY);
        }

        function hasBeachBackedContact(pSelf, pX, pY) {
            var offsets = [
                [1, 0],
                [-1, 0],
                [0, -1],
                [0, 1]
            ];

            for(var index = 0; index < offsets.length; ++index) {
                var tileId = MapGen.Layers.Get(pTiles, pX + offsets[index][0], pY + offsets[index][1], -1);
                if(tileId < 0)
                    continue;
                if(tileId === 252 || tileId === 255 || tileId === 272 ||
                    tileId === 277 || tileId === 292 || tileId === 335)
                    return true;
                if(pSelf.Sub1BeachTileMaskClass(pLookup, tileId) === "S")
                    return true;
            }

            return false;
        }

        function canRewriteFinalBeachTile(pSelf, pX, pY) {
            return MapGen.Layers.InBounds(pTiles, pX, pY) &&
                pSelf.CanShapeSub1BeachGrassContourCell(pContext, pX, pY);
        }

        function hasNearbySandTile(pSelf, pX, pY, pRadius) {
            for(var dy = -pRadius; dy <= pRadius; ++dy) {
                for(var dx = -pRadius; dx <= pRadius; ++dx) {
                    if(Math.abs(dx) + Math.abs(dy) > pRadius)
                        continue;
                    if(dx === 0 && dy === 0)
                        continue;
                    if(pSelf.Sub1BeachTileMaskClass(pLookup, MapGen.Layers.Get(pTiles, pX + dx, pY + dy, -1)) === "S")
                        return true;
                }
            }

            return false;
        }

        function retileFinalGrassSandEdge(pSelf, pX, pY) {
            var edgeMask = pSelf.Sub1BeachTileClassMaskAt(pLookup, pTiles, pX, pY);
            var edgeTile = pSelf.Sub1GrammarBeachDryGrassEdgeTileForMask(
                pContext,
                pX,
                pY,
                edgeMask,
                pY > 0 ? MapGen.Layers.Get(pTiles, pX, pY - 1, -1) : -1,
                pX < pContext.Width - 1 ? MapGen.Layers.Get(pTiles, pX + 1, pY, -1) : -1
            );

            if(edgeTile >= 0)
                core.SetTile(pTiles, pX, pY, edgeTile);
        }

        for(var pass = 0; pass < 4; ++pass) {
            var passChanged = 0;

            for(var x = 0; x < pContext.Width; ++x) {
                for(var y = 0; y < pContext.Height; ++y) {
                    var tileId = MapGen.Layers.Get(pTiles, x, y, -1);
                    var mask;

                    if(tileId === 271 || tileId === 314) {
                        core.SetTile(pTiles, x, y, nearbyPlainGrassTile(this, x, y));
                        ++passChanged;
                        continue;
                    }

                    if(tileId === 293) {
                        mask = this.Sub1BeachTileClassMaskAt(pLookup, pTiles, x, y);
                        if(mask === "GWSS" &&
                            canRewriteFinalBeachTile(this, x, y - 1) &&
                            this.Sub1BeachTileMaskClass(pLookup, MapGen.Layers.Get(pTiles, x, y - 1, -1)) === "G") {
                            core.SetTile(pTiles, x, y - 1, 324);
                            ++passChanged;
                            continue;
                        }

                        if(mask === "SWGG" &&
                            canRewriteFinalBeachTile(this, x - 2, y + 1) &&
                            canRewriteFinalBeachTile(this, x - 1, y) &&
                            canRewriteFinalBeachTile(this, x - 1, y + 1) &&
                            canRewriteFinalBeachTile(this, x, y) &&
                            canRewriteFinalBeachTile(this, x, y + 1) &&
                            this.Sub1BeachTileMaskClass(pLookup, MapGen.Layers.Get(pTiles, x + 1, y, -1)) === "W") {
                            core.SetTile(pTiles, x - 1, y, 292);
                            core.SetTile(pTiles, x, y, 279);
                            core.SetTile(pTiles, x - 2, y + 1, 335);
                            core.SetTile(pTiles, x - 1, y + 1, 279);
                            core.SetTile(pTiles, x, y + 1, 297);
                            passChanged += 5;
                            continue;
                        }
                    }

                    if(tileId === 297) {
                        mask = this.Sub1BeachTileClassMaskAt(pLookup, pTiles, x, y);
                        if(mask === "GWWS") {
                            core.SetTile(pTiles, x, y, 278);
                            ++passChanged;
                            continue;
                        }
                    }

                    if(tileId === 279) {
                        mask = this.Sub1BeachTileClassMaskAt(pLookup, pTiles, x, y);
                        if(mask === "SWGG" &&
                            canRewriteFinalBeachTile(this, x, y + 1) &&
                            this.Sub1BeachTileMaskClass(pLookup, MapGen.Layers.Get(pTiles, x + 1, y, -1)) === "W") {
                            core.SetTile(pTiles, x, y + 1, 297);
                            ++passChanged;
                            if(canRewriteFinalBeachTile(this, x + 1, y + 1)) {
                                core.SetTile(pTiles, x + 1, y + 1, 298);
                                ++passChanged;
                            }
                            if(canRewriteFinalBeachTile(this, x + 2, y)) {
                                core.SetTile(pTiles, x + 2, y, 297);
                                ++passChanged;
                            }
                            if(canRewriteFinalBeachTile(this, x, y + 2)) {
                                core.SetTile(pTiles, x, y + 2, 297);
                                ++passChanged;
                            }
                            if(canRewriteFinalBeachTile(this, x + 1, y + 2)) {
                                core.SetTile(pTiles, x + 1, y + 2, 297);
                                ++passChanged;
                            }
                            continue;
                        }
                    }

                    if(tileId === 324) {
                        if(this.Sub1BeachTileMaskClass(pLookup, MapGen.Layers.Get(pTiles, x - 1, y, -1)) !== "S" ||
                            this.Sub1BeachTileMaskClass(pLookup, MapGen.Layers.Get(pTiles, x + 1, y, -1)) !== "S") {
                            core.SetTile(pTiles, x, y, 258);
                            ++passChanged;
                            continue;
                        }
                    }

                    if(this.Sub1IsLightGrassTile(tileId) &&
                        hasBeachBackedContact(this, x, y) &&
                        !MapGen.Layers.Get((pContext.Layers || {}).crossing, x, y, 0)) {
                        mask = this.Sub1BeachTileClassMaskAt(pLookup, pTiles, x, y);
                        var lightGrassReplacement = this.Sub1GrammarBeachDryGrassEdgeTileForMask(
                            pContext,
                            x,
                            y,
                            mask,
                            y > 0 ? MapGen.Layers.Get(pTiles, x, y - 1, -1) : -1,
                            x < pContext.Width - 1 ? MapGen.Layers.Get(pTiles, x + 1, y, -1) : -1
                        );

                        if(lightGrassReplacement >= 0 &&
                            this.Sub1GrammarBeachDryGrassEdgeMasks()[lightGrassReplacement] &&
                            this.Sub1GrammarBeachDryGrassEdgeMasks()[lightGrassReplacement][mask]) {
                            core.SetTile(pTiles, x, y, lightGrassReplacement);
                            ++passChanged;
                            continue;
                        }

                        var darkGrassTile = nearbyPlainGrassTile(this, x, y);
                        if(darkGrassTile !== tileId) {
                            core.SetTile(pTiles, x, y, darkGrassTile);
                            ++passChanged;
                        }
                        continue;
                    }

                    if((tileId === 123 || tileId === 124) &&
                        hasBeachBackedContact(this, x, y) &&
                        !MapGen.Layers.Get((pContext.Layers || {}).crossing, x, y, 0)) {
                        mask = this.Sub1BeachTileClassMaskAt(pLookup, pTiles, x, y);
                        var darkEdgeReplacement = this.Sub1GrammarBeachDryGrassEdgeTileForMask(
                            pContext,
                            x,
                            y,
                            mask,
                            y > 0 ? MapGen.Layers.Get(pTiles, x, y - 1, -1) : -1,
                            x < pContext.Width - 1 ? MapGen.Layers.Get(pTiles, x + 1, y, -1) : -1
                        );

                        if(darkEdgeReplacement >= 0 &&
                            this.Sub1GrammarBeachDryGrassEdgeMasks()[darkEdgeReplacement] &&
                            this.Sub1GrammarBeachDryGrassEdgeMasks()[darkEdgeReplacement][mask]) {
                            core.SetTile(pTiles, x, y, darkEdgeReplacement);
                            ++passChanged;
                            continue;
                        }
                    }

                    if((tileId === 252 || tileId === 255 || tileId === 272) &&
                        MapGen.Layers.Get(pTiles, x + 1, y, -1) === 277) {
                        mask = this.Sub1BeachTileClassMaskAt(pLookup, pTiles, x, y);
                        if(mask === "GSSG") {
                            core.SetTile(pTiles, x, y, 275);
                            ++passChanged;
                            continue;
                        }
                    }

                    if(tileId === 275) {
                        mask = this.Sub1BeachTileClassMaskAt(pLookup, pTiles, x, y);
                        var eastTile = MapGen.Layers.Get(pTiles, x + 1, y, -1);
                        if((mask === "GSSG" || mask === "GGSG") &&
                            (eastTile === 277 || eastTile === 276))
                            continue;
                    }

                    if(tileId === 275 || tileId === 276 || tileId === 337) {
                        mask = this.Sub1BeachTileClassMaskAt(pLookup, pTiles, x, y);
                        var rejectedReplacement = this.Sub1GrammarBeachDryGrassEdgeTileForMask(
                            pContext,
                            x,
                            y,
                            mask,
                            y > 0 ? MapGen.Layers.Get(pTiles, x, y - 1, -1) : -1,
                            x < pContext.Width - 1 ? MapGen.Layers.Get(pTiles, x + 1, y, -1) : -1
                        );

                        if(rejectedReplacement >= 0 &&
                            this.Sub1GrammarBeachDryGrassEdgeMasks()[rejectedReplacement] &&
                            this.Sub1GrammarBeachDryGrassEdgeMasks()[rejectedReplacement][mask]) {
                            core.SetTile(pTiles, x, y, rejectedReplacement);
                            ++passChanged;
                            continue;
                        }

                        var rejectedGrassTile = nearbyPlainGrassTile(this, x, y);
                        if(rejectedGrassTile !== tileId) {
                            core.SetTile(pTiles, x, y, rejectedGrassTile);
                            ++passChanged;
                        }
                        continue;
                    }

                    if(tileId === 252 || tileId === 255 || tileId === 272 || tileId === 335) {
                        mask = this.Sub1BeachTileClassMaskAt(pLookup, pTiles, x, y);
                        if((tileId === 252 || tileId === 272) && mask === "GSGG") {
                            var northEdgeTile = y > 0 ? MapGen.Layers.Get(pTiles, x, y - 1, -1) : -1;
                            var gsggReplacement = this.Sub1GrammarBeachDryGrassEdgeTileForMask(
                                pContext,
                                x,
                                y,
                                mask,
                                northEdgeTile,
                                x < pContext.Width - 1 ? MapGen.Layers.Get(pTiles, x + 1, y, -1) : -1
                            );

                            if(gsggReplacement >= 0 && gsggReplacement !== tileId) {
                                core.SetTile(pTiles, x, y, gsggReplacement);
                                ++passChanged;
                                continue;
                            }
                        }

                        var tileMasks = this.Sub1GrammarBeachDryGrassEdgeMasks()[tileId];
                        if(tileMasks && tileMasks[mask])
                            continue;

                        var edgeReplacement = this.Sub1GrammarBeachDryGrassEdgeTileForMask(
                            pContext,
                            x,
                            y,
                            mask,
                            y > 0 ? MapGen.Layers.Get(pTiles, x, y - 1, -1) : -1,
                            x < pContext.Width - 1 ? MapGen.Layers.Get(pTiles, x + 1, y, -1) : -1
                        );

                        if(edgeReplacement >= 0 &&
                            this.Sub1GrammarBeachDryGrassEdgeMasks()[edgeReplacement] &&
                            this.Sub1GrammarBeachDryGrassEdgeMasks()[edgeReplacement][mask]) {
                            core.SetTile(pTiles, x, y, edgeReplacement);
                            ++passChanged;
                            continue;
                        }

                        var edgeGrassTile = nearbyPlainGrassTile(this, x, y);
                        if(edgeGrassTile !== tileId) {
                            core.SetTile(pTiles, x, y, edgeGrassTile);
                            ++passChanged;
                        }
                        continue;
                    }

                    if(tileId !== 256 && tileId !== 257 && tileId !== 277 && tileId !== 292)
                        continue;

                    mask = this.Sub1BeachTileClassMaskAt(pLookup, pTiles, x, y);
                    if(tileId === 277 || tileId === 292) {
                        if(mask === "GSSG")
                            continue;

                        if(mask === "GSGG") {
                            var sandEdgeReplacement = this.Sub1GrammarBeachDryGrassEdgeTileForMask(
                                pContext,
                                x,
                                y,
                                mask,
                                y > 0 ? MapGen.Layers.Get(pTiles, x, y - 1, -1) : -1,
                                x < pContext.Width - 1 ? MapGen.Layers.Get(pTiles, x + 1, y, -1) : -1
                            );
                            if(sandEdgeReplacement >= 0) {
                                core.SetTile(pTiles, x, y, sandEdgeReplacement);
                                ++passChanged;
                                continue;
                            }
                        }

                        core.SetTile(pTiles, x, y, tileId === 277 ? 257 : nearbyPlainGrassTile(this, x, y));
                        ++passChanged;
                        continue;
                    }

                    if(mask === "GSGG") {
                        var replacement = this.Sub1GrammarBeachDryGrassEdgeTileForMask(
                            pContext,
                            x,
                            y,
                            mask,
                            y > 0 ? MapGen.Layers.Get(pTiles, x, y - 1, -1) : -1,
                            x < pContext.Width - 1 ? MapGen.Layers.Get(pTiles, x + 1, y, -1) : -1
                        );
                        if(replacement >= 0 && replacement !== tileId) {
                            core.SetTile(pTiles, x, y, replacement);
                            ++passChanged;
                        }
                        continue;
                    }

                    if(mask === "GGSG" || mask === "GGSS" || mask === "SSGG") {
                        var grassTile = nearbyPlainGrassTile(this, x, y);
                        if(grassTile !== tileId) {
                            core.SetTile(pTiles, x, y, grassTile);
                            ++passChanged;
                        }
                    }
                }
            }

            if(!passChanged)
                break;

            changed += passChanged;
        }

        for(var finalEdgeX = 0; finalEdgeX < pContext.Width - 1; ++finalEdgeX) {
            for(var finalEdgeY = 0; finalEdgeY < pContext.Height; ++finalEdgeY) {
                if(this.Sub1BeachTileMaskClass(pLookup, MapGen.Layers.Get(pTiles, finalEdgeX, finalEdgeY, -1)) !== "G" ||
                    this.Sub1BeachTileMaskClass(pLookup, MapGen.Layers.Get(pTiles, finalEdgeX + 1, finalEdgeY, -1)) !== "S" ||
                    !canRewriteFinalBeachTile(this, finalEdgeX, finalEdgeY))
                    continue;

                var finalEdgeTile = MapGen.Layers.Get(pTiles, finalEdgeX, finalEdgeY, -1);
                var finalEdgeMask = this.Sub1BeachTileClassMaskAt(pLookup, pTiles, finalEdgeX, finalEdgeY);
                var finalEdgeMasks = this.Sub1GrammarBeachDryGrassEdgeMasks()[finalEdgeTile];
                if(finalEdgeMasks && finalEdgeMasks[finalEdgeMask])
                    continue;

                if(finalEdgeMask === "SSSS") {
                    core.SetTile(pTiles, finalEdgeX, finalEdgeY, 257);
                    ++changed;
                    continue;
                }

                if(finalEdgeMask === "SSGG" &&
                    finalEdgeX > 0 &&
                    canRewriteFinalBeachTile(this, finalEdgeX - 1, finalEdgeY)) {
                    core.SetTile(pTiles, finalEdgeX, finalEdgeY, 257);
                    retileFinalGrassSandEdge(this, finalEdgeX - 1, finalEdgeY);
                    ++changed;
                    continue;
                }

                var beforeFinalEdge = finalEdgeTile;
                retileFinalGrassSandEdge(this, finalEdgeX, finalEdgeY);
                if(MapGen.Layers.Get(pTiles, finalEdgeX, finalEdgeY, -1) !== beforeFinalEdge)
                    ++changed;
            }
        }

        for(var cleanupX = 0; cleanupX < pContext.Width; ++cleanupX) {
            for(var cleanupY = 0; cleanupY < pContext.Height; ++cleanupY) {
                var cleanupTile = MapGen.Layers.Get(pTiles, cleanupX, cleanupY, -1);
                if(cleanupTile !== 252 && cleanupTile !== 255 &&
                    cleanupTile !== 272 && cleanupTile !== 335)
                    continue;

                var cleanupMask = this.Sub1BeachTileClassMaskAt(pLookup, pTiles, cleanupX, cleanupY);
                var cleanupMasks = this.Sub1GrammarBeachDryGrassEdgeMasks()[cleanupTile];
                if(cleanupMasks && cleanupMasks[cleanupMask])
                    continue;

                core.SetTile(pTiles, cleanupX, cleanupY, nearbyPlainGrassTile(this, cleanupX, cleanupY));
                ++changed;
            }
        }

        var nearShoreOceanTiles = {
            242: true, 244: true, 260: true, 261: true, 263: true,
            280: true, 282: true, 316: true, 317: true,
            341: true, 361: true, 364: true, 382: true
        };

        for(var waterX = 0; waterX < pContext.Width; ++waterX) {
            for(var waterY = 0; waterY < pContext.Height; ++waterY) {
                var waterTile = MapGen.Layers.Get(pTiles, waterX, waterY, -1);
                if(!nearShoreOceanTiles[waterTile] ||
                    !hasNearbySandTile(this, waterX, waterY, 3))
                    continue;

                var westWaterEdgeTile = MapGen.Layers.Get(pTiles, waterX - 1, waterY, -1);
                var northWaterEdgeTile = MapGen.Layers.Get(pTiles, waterX, waterY - 1, -1);
                var replacementWaterTile = westWaterEdgeTile === 258 ||
                    northWaterEdgeTile === 256 ||
                    northWaterEdgeTile === 257 ?
                    278 :
                    (westWaterEdgeTile === 295 ? 298 :
                        ((MapGen.Random.HashTile(pContext.Seed, waterX, waterY, 7391) % 5) === 0 ? 298 : 297));

                core.SetTile(
                    pTiles,
                    waterX,
                    waterY,
                    replacementWaterTile
                );
                ++changed;
            }
        }

        for(var gapX = 1; gapX < pContext.Width - 1; ++gapX) {
            for(var gapY = 0; gapY < pContext.Height; ++gapY) {
                if(this.Sub1BeachTileMaskClass(pLookup, MapGen.Layers.Get(pTiles, gapX - 1, gapY, -1)) !== "S" ||
                    this.Sub1BeachTileMaskClass(pLookup, MapGen.Layers.Get(pTiles, gapX, gapY, -1)) !== "G" ||
                    this.Sub1BeachTileMaskClass(pLookup, MapGen.Layers.Get(pTiles, gapX + 1, gapY, -1)) !== "W" ||
                    !hasNearbySandTile(this, gapX, gapY, 2) ||
                    !this.CanShapeSub1BeachGrassContourCell(pContext, gapX, gapY))
                    continue;

                core.SetTile(pTiles, gapX, gapY, MapGen.Layers.Get(pTiles, gapX - 1, gapY, -1) === 258 ? 278 : 297);
                ++changed;
            }
        }

        for(var finalWaterX = 0; finalWaterX < pContext.Width; ++finalWaterX) {
            for(var finalWaterY = 0; finalWaterY < pContext.Height; ++finalWaterY) {
                if(MapGen.Layers.Get(pTiles, finalWaterX, finalWaterY, -1) !== 278 ||
                    this.Sub1BeachTileClassMaskAt(pLookup, pTiles, finalWaterX, finalWaterY) !== "WWWS")
                    continue;

                core.SetTile(pTiles, finalWaterX, finalWaterY, 297);
                ++changed;
            }
        }

        for(var finalSandX = 0; finalSandX < pContext.Width; ++finalSandX) {
            for(var finalSandY = 0; finalSandY < pContext.Height; ++finalSandY) {
                if(MapGen.Layers.Get(pTiles, finalSandX, finalSandY, -1) !== 258 ||
                    this.Sub1BeachTileClassMaskAt(pLookup, pTiles, finalSandX, finalSandY) !== "GWSG")
                    continue;

                core.SetTile(pTiles, finalSandX, finalSandY, nearbyPlainGrassTile(this, finalSandX, finalSandY));
                ++changed;
            }
        }

        changed += this.RepairSub1GrammarBeachFinalSeamArtifacts(pContext, pTiles, pLookup);

        return changed;
    };
})(MapGen.Terrain.Smoothing.Jungle);
