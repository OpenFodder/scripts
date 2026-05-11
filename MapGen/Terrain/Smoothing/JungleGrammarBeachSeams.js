var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};
MapGen.Terrain.Smoothing.Jungle = MapGen.Terrain.Smoothing.Jungle || {};

(function(pJungle) {
    pJungle.RepairSub1GrammarBeachFinalSeamArtifacts = function(pContext, pTiles, pLookup) {
        if(!this.IsGrammarBeachProfile(pContext))
            return 0;

        var core = MapGen.Terrain.Smoothing.Core;
        var self = this;
        var changed = 0;

        function canRewrite(pSelf, pX, pY) {
            return MapGen.Layers.InBounds(pTiles, pX, pY) &&
                pSelf.CanRetileSub1BeachDryGrassEdgeCell(pContext, pX, pY);
        }

        function nearbyPlainGrassTile(pSelf, pX, pY) {
            var offsets = [[1, 0], [-1, 0], [0, -1], [0, 1]];
            for(var index = 0; index < offsets.length; ++index) {
                var tileId = MapGen.Layers.Get(pTiles, pX + offsets[index][0], pY + offsets[index][1], -1);
                if(tileId === 123 || tileId === 124)
                    return tileId;
            }

            return pSelf.Sub1DarkGrassFloorTile(pContext, pX, pY);
        }

        function isMaskClass(pSelf, pX, pY, pClass) {
            return pSelf.Sub1BeachTileMaskClass(pLookup, MapGen.Layers.Get(pTiles, pX, pY, -1)) === pClass;
        }

        function hasAdjacentRowSand(pSelf, pX, pY) {
            for(var dy = -1; dy <= 1; dy += 2) {
                for(var dx = -1; dx <= 2; ++dx) {
                    if(isMaskClass(pSelf, pX + dx, pY + dy, "S"))
                        return true;
                }
            }

            return false;
        }

        function isLiveWaterCell(pX, pY) {
            var layers = pContext && pContext.Layers ? pContext.Layers : {};

            return !!MapGen.Layers.Get(layers.water, pX, pY, 0);
        }

        function isLiveBeachCell(pX, pY) {
            var layers = pContext && pContext.Layers ? pContext.Layers : {};

            return !!MapGen.Layers.Get(layers.coast, pX, pY, 0) ||
                self.IsAuthoredSub1GrammarBeachCoastCell(pContext, pX, pY);
        }

        function liveClassAt(pX, pY) {
            if(isLiveWaterCell(pX, pY))
                return "W";
            if(isLiveBeachCell(pX, pY))
                return "S";
            return "G";
        }

        function liveMaskAt(pX, pY) {
            return liveClassAt(pX, pY - 1) +
                liveClassAt(pX + 1, pY) +
                liveClassAt(pX, pY + 1) +
                liveClassAt(pX - 1, pY);
        }

        function replacementSandTileForLiveMask(pX, pY) {
            var mask = liveMaskAt(pX, pY);
            var northTile = MapGen.Layers.Get(pTiles, pX, pY - 1, -1);
            var westTile = MapGen.Layers.Get(pTiles, pX - 1, pY, -1);

            if(mask === "SWSS") {
                if(northTile === 293)
                    return 294;
                return 293;
            }
            if(mask === "SWWS") {
                if(northTile === 293 || northTile === 294 || westTile === 293 || westTile === 294)
                    return 295;
                return 258;
            }
            if(mask === "SWWG")
                return 279;
            if(mask === "GWWS")
                return 258;
            if(mask === "GSSG")
                return 292;
            if(mask === "SGSS" || mask === "SSGS")
                return 257;
            return 256;
        }

        function replacementForPureWaterLeak(pX, pY) {
            if(isLiveBeachCell(pX, pY))
                return replacementSandTileForLiveMask(pX, pY);
            if(isLiveWaterCell(pX + 1, pY))
                return 244;
            return nearbyPlainGrassTile(self, pX, pY);
        }

        function isBeachEdgeTile(pTileId) {
            return pTileId === 256 ||
                pTileId === 257 ||
                pTileId === 258 ||
                pTileId === 259 ||
                pTileId === 277 ||
                pTileId === 278 ||
                pTileId === 279 ||
                pTileId === 292 ||
                pTileId === 293 ||
                pTileId === 294 ||
                pTileId === 295 ||
                pTileId === 324;
        }

        function isPureWaterTile(pTileId) {
            return pTileId === 297 ||
                pTileId === 298 ||
                pTileId === 316 ||
                pTileId === 317;
        }

        function stampEndpointTile(pX, pY, pTileId) {
            if(pTileId === null || !MapGen.Layers.InBounds(pTiles, pX, pY))
                return 0;
            if(isPureWaterTile(pTileId) && !isLiveWaterCell(pX, pY)) {
                if(isLiveWaterCell(pX + 1, pY))
                    pTileId = 244;
                else
                    return 0;
            }
            if(MapGen.Layers.Get(pTiles, pX, pY, -1) === pTileId)
                return 0;

            core.SetTile(pTiles, pX, pY, pTileId);
            return 1;
        }

        function stampEndpointTemplate(pBaseX, pBaseY) {
            var endpointUpperGrassTile = nearbyPlainGrassTile(self, pBaseX, pBaseY - 2);
            var endpointGrassTile = nearbyPlainGrassTile(self, pBaseX, pBaseY - 1);
            var endpointRows = [
                { y: -2, tiles: [endpointUpperGrassTile, 272, 256, 279, 297, 297, 298] },
                { y: -1, tiles: [endpointGrassTile, 292, 279, 297, 297, 298] },
                { y: 0, x: -1, tiles: [87, 335, 279, 297, 297, 298, 298, 297] },
                { y: 1, x: -1, tiles: [225, 355, 297, 298, 298, 298, 297, 297] },
                { y: 2, x: -1, tiles: [365, 280, 297, 297, 297, 298, 298, 298] },
                { y: 3, x: -1, tiles: [366, 301, 297, 297, 297, 298, 297, 298] },
                { y: 4, x: -1, tiles: [104, 302, 297, 298, 298, 297, 297, 297] }
            ];
            var localChanged = 0;

            for(var rowIndex = 0; rowIndex < endpointRows.length; ++rowIndex) {
                var endpointRow = endpointRows[rowIndex];
                var endpointOffsetX = endpointRow.x || 0;
                for(var tileIndex = 0; tileIndex < endpointRow.tiles.length; ++tileIndex)
                    localChanged += stampEndpointTile(pBaseX + endpointOffsetX + tileIndex, pBaseY + endpointRow.y, endpointRow.tiles[tileIndex]);
            }

            return localChanged;
        }

        var waterDirection = this.Sub1GrammarBeachContourDirection(pContext);
        if(waterDirection === "E") {
            for(var repeatX = 2; repeatX < pContext.Width - 1; ++repeatX) {
                for(var repeatY = 1; repeatY < pContext.Height; ++repeatY) {
                    if(MapGen.Layers.Get(pTiles, repeatX, repeatY, -1) !== 279 ||
                        MapGen.Layers.Get(pTiles, repeatX, repeatY - 1, -1) !== 279 ||
                        MapGen.Layers.Get(pTiles, repeatX - 1, repeatY, -1) !== 292 ||
                        !isMaskClass(this, repeatX + 1, repeatY, "W") ||
                        !isMaskClass(this, repeatX, repeatY + 1, "W") ||
                        isMaskClass(this, repeatX - 2, repeatY, "S") ||
                        !canRewrite(this, repeatX - 2, repeatY))
                        continue;

                    core.SetTile(pTiles, repeatX - 2, repeatY, 292);
                    core.SetTile(pTiles, repeatX - 1, repeatY, 279);
                    core.SetTile(pTiles, repeatX, repeatY, 297);
                    changed += 3;
                }
            }

            for(var interiorX = 0; interiorX < pContext.Width; ++interiorX) {
                for(var interiorY = 0; interiorY < pContext.Height; ++interiorY) {
                    if(MapGen.Layers.Get(pTiles, interiorX, interiorY, -1) !== 279 ||
                        MapGen.Layers.Get(pTiles, interiorX - 1, interiorY, -1) === 335 ||
                        (isMaskClass(this, interiorX + 1, interiorY, "W") &&
                            isMaskClass(this, interiorX, interiorY + 1, "W")))
                        continue;

                    core.SetTile(pTiles, interiorX, interiorY, 256);
                    ++changed;
                }
            }

            for(var endpointX = 0; endpointX < pContext.Width - 2; ++endpointX) {
                for(var endpointY = 1; endpointY < pContext.Height - 1; ++endpointY) {
                    if(MapGen.Layers.Get(pTiles, endpointX, endpointY, -1) !== 335 ||
                        MapGen.Layers.Get(pTiles, endpointX + 1, endpointY, -1) !== 279 ||
                        !isMaskClass(this, endpointX + 2, endpointY, "W") ||
                        hasAdjacentRowSand(this, endpointX, endpointY) ||
                        !canRewrite(this, endpointX, endpointY) ||
                        !canRewrite(this, endpointX + 1, endpointY))
                        continue;

                    core.SetTile(pTiles, endpointX, endpointY, nearbyPlainGrassTile(this, endpointX, endpointY));
                    core.SetTile(pTiles, endpointX + 1, endpointY, 297);
                    changed += 2;
                }
            }

            for(var baseX = 0; baseX < pContext.Width - 3; ++baseX) {
                for(var baseY = 0; baseY < pContext.Height - 1; ++baseY) {
                    var belowEndpointTile = MapGen.Layers.Get(pTiles, baseX, baseY + 1, -1);
                    if(MapGen.Layers.Get(pTiles, baseX, baseY, -1) !== 335 ||
                        MapGen.Layers.Get(pTiles, baseX + 1, baseY, -1) !== 279 ||
                        !hasAdjacentRowSand(this, baseX, baseY) ||
                        (belowEndpointTile !== 355 && !isMaskClass(this, baseX, baseY + 1, "W")) ||
                        !canRewrite(this, baseX, baseY + 1))
                        continue;

                    changed += stampEndpointTemplate(baseX, baseY);
                }
            }

        }

        for(var leakX = 0; leakX < pContext.Width; ++leakX) {
            for(var leakY = 0; leakY < pContext.Height; ++leakY) {
                var leakTile = MapGen.Layers.Get(pTiles, leakX, leakY, -1);
                if(!isPureWaterTile(leakTile) ||
                    isLiveWaterCell(leakX, leakY) ||
                    !canRewrite(this, leakX, leakY))
                    continue;

                var leakReplacement = replacementForPureWaterLeak(leakX, leakY);
                if(leakReplacement === leakTile)
                    continue;

                core.SetTile(pTiles, leakX, leakY, leakReplacement);
                ++changed;
            }
        }

        for(var endpointFillX = 0; endpointFillX < pContext.Width - 7; ++endpointFillX) {
            for(var endpointFillY = 0; endpointFillY < pContext.Height - 5; ++endpointFillY) {
                if(MapGen.Layers.Get(pTiles, endpointFillX, endpointFillY, -1) !== 335 ||
                    MapGen.Layers.Get(pTiles, endpointFillX, endpointFillY + 1, -1) !== 355 ||
                    MapGen.Layers.Get(pTiles, endpointFillX, endpointFillY + 2, -1) !== 280 ||
                    MapGen.Layers.Get(pTiles, endpointFillX, endpointFillY + 3, -1) !== 301 ||
                    MapGen.Layers.Get(pTiles, endpointFillX, endpointFillY + 4, -1) !== 302)
                    continue;

                var endpointContinuations = [
                    { y: 2, tiles: [297, 297, 297, 298, 298, 298] },
                    { y: 3, tiles: [297, 297, 297, 298, 297, 298] },
                    { y: 4, tiles: [297, 298, 298, 297, 297, 297] }
                ];

                for(var fillRowIndex = 0; fillRowIndex < endpointContinuations.length; ++fillRowIndex) {
                    var fillRow = endpointContinuations[fillRowIndex];
                    for(var fillTileIndex = 0; fillTileIndex < fillRow.tiles.length; ++fillTileIndex) {
                        var fillX = endpointFillX + 1 + fillTileIndex;
                        var fillY = endpointFillY + fillRow.y;
                        if(!canRewrite(this, fillX, fillY) ||
                            MapGen.Layers.Get(pTiles, fillX, fillY, -1) === fillRow.tiles[fillTileIndex])
                            continue;

                        core.SetTile(pTiles, fillX, fillY, fillRow.tiles[fillTileIndex]);
                        ++changed;
                    }
                }
            }
        }

        for(var sandLeakX = 0; sandLeakX < pContext.Width; ++sandLeakX) {
            for(var sandLeakY = 0; sandLeakY < pContext.Height; ++sandLeakY) {
                var sandLeakTile = MapGen.Layers.Get(pTiles, sandLeakX, sandLeakY, -1);
                if(!isBeachEdgeTile(sandLeakTile) ||
                    isLiveBeachCell(sandLeakX, sandLeakY) ||
                    isLiveWaterCell(sandLeakX, sandLeakY) ||
                    !canRewrite(this, sandLeakX, sandLeakY))
                    continue;

                var sandLeakReplacement = isLiveWaterCell(sandLeakX + 1, sandLeakY) ?
                    244 :
                    nearbyPlainGrassTile(this, sandLeakX, sandLeakY);
                if(sandLeakReplacement === sandLeakTile)
                    continue;

                core.SetTile(pTiles, sandLeakX, sandLeakY, sandLeakReplacement);
                ++changed;
            }
        }

        var valid260SouthTiles = {
            280: true,
            282: true,
            283: true,
            300: true,
            302: true,
            317: true,
            341: true
        };
        for(var eastWaterGrassX = 0; eastWaterGrassX < pContext.Width; ++eastWaterGrassX) {
            for(var eastWaterGrassY = 0; eastWaterGrassY < pContext.Height; ++eastWaterGrassY) {
                if(MapGen.Layers.Get(pTiles, eastWaterGrassX, eastWaterGrassY, -1) !== 260 ||
                    !isMaskClass(this, eastWaterGrassX + 1, eastWaterGrassY, "W") ||
                    valid260SouthTiles[MapGen.Layers.Get(pTiles, eastWaterGrassX, eastWaterGrassY + 1, -1)])
                    continue;

                core.SetTile(pTiles, eastWaterGrassX, eastWaterGrassY, 244);
                ++changed;
            }
        }

        for(var grassSpurX = 0; grassSpurX < pContext.Width - 2; ++grassSpurX) {
            for(var grassSpurY = 0; grassSpurY < pContext.Height; ++grassSpurY) {
                if(MapGen.Layers.Get(pTiles, grassSpurX, grassSpurY, -1) !== 275 ||
                    MapGen.Layers.Get(pTiles, grassSpurX + 1, grassSpurY, -1) !== 276 ||
                    MapGen.Layers.Get(pTiles, grassSpurX + 2, grassSpurY, -1) !== 277 ||
                    this.Sub1BeachTileClassMaskAt(pLookup, pTiles, grassSpurX, grassSpurY) !== "GGGG")
                    continue;

                if(canRewrite(this, grassSpurX, grassSpurY)) {
                    core.SetTile(pTiles, grassSpurX, grassSpurY, nearbyPlainGrassTile(this, grassSpurX, grassSpurY));
                    ++changed;
                }
                if(canRewrite(this, grassSpurX + 1, grassSpurY)) {
                    core.SetTile(pTiles, grassSpurX + 1, grassSpurY, 252);
                    ++changed;
                }
                if(canRewrite(this, grassSpurX + 2, grassSpurY)) {
                    core.SetTile(pTiles, grassSpurX + 2, grassSpurY, 257);
                    ++changed;
                }
            }
        }

        for(var loneCornerX = 1; loneCornerX < pContext.Width; ++loneCornerX) {
            for(var loneCornerY = 0; loneCornerY < pContext.Height; ++loneCornerY) {
                if(MapGen.Layers.Get(pTiles, loneCornerX, loneCornerY, -1) !== 276 ||
                    MapGen.Layers.Get(pTiles, loneCornerX - 1, loneCornerY, -1) === 275 ||
                    this.Sub1BeachTileMaskClass(pLookup, MapGen.Layers.Get(pTiles, loneCornerX + 1, loneCornerY, -1)) !== "S" ||
                    !canRewrite(this, loneCornerX, loneCornerY))
                    continue;

                var loneCornerMask = this.Sub1BeachTileClassMaskAt(pLookup, pTiles, loneCornerX, loneCornerY);
                var loneCornerReplacement = this.Sub1GrammarBeachDryGrassEdgeTileForMask(
                    pContext,
                    loneCornerX,
                    loneCornerY,
                    loneCornerMask,
                    loneCornerY > 0 ? MapGen.Layers.Get(pTiles, loneCornerX, loneCornerY - 1, -1) : -1,
                    MapGen.Layers.Get(pTiles, loneCornerX + 1, loneCornerY, -1)
                );
                if(loneCornerReplacement >= 0) {
                    core.SetTile(pTiles, loneCornerX, loneCornerY, loneCornerReplacement);
                    ++changed;
                }
            }
        }

        for(var plainGrassX = 1; plainGrassX < pContext.Width; ++plainGrassX) {
            for(var plainGrassY = 0; plainGrassY < pContext.Height; ++plainGrassY) {
                if(MapGen.Layers.Get(pTiles, plainGrassX, plainGrassY, -1) !== 256 ||
                    (MapGen.Layers.Get(pTiles, plainGrassX - 1, plainGrassY, -1) !== 123 &&
                        MapGen.Layers.Get(pTiles, plainGrassX - 1, plainGrassY, -1) !== 124) ||
                    this.Sub1BeachTileMaskClass(pLookup, MapGen.Layers.Get(pTiles, plainGrassX + 1, plainGrassY, -1)) !== "S")
                    continue;

                if(canRewrite(this, plainGrassX - 1, plainGrassY)) {
                    var grassMask = this.Sub1BeachTileClassMaskAt(pLookup, pTiles, plainGrassX - 1, plainGrassY);
                    var grassReplacement = this.Sub1GrammarBeachDryGrassEdgeTileForMask(
                        pContext,
                        plainGrassX - 1,
                        plainGrassY,
                        grassMask,
                        plainGrassY > 0 ? MapGen.Layers.Get(pTiles, plainGrassX - 1, plainGrassY - 1, -1) : -1,
                        MapGen.Layers.Get(pTiles, plainGrassX, plainGrassY, -1)
                    );
                    if(grassReplacement >= 0) {
                        core.SetTile(pTiles, plainGrassX - 1, plainGrassY, grassReplacement);
                        ++changed;
                    }
                }

                if(canRewrite(this, plainGrassX, plainGrassY)) {
                    core.SetTile(pTiles, plainGrassX, plainGrassY, 257);
                    ++changed;
                }
            }
        }

        changed += this.RepairSub1GrammarBeachSandVisualSeams(pContext, pTiles, pLookup);

        for(var bottomRunX = 1; bottomRunX < pContext.Width - 6; ++bottomRunX) {
            for(var bottomRunY = 1; bottomRunY < pContext.Height - 1; ++bottomRunY) {
                if(MapGen.Layers.Get(pTiles, bottomRunX, bottomRunY, -1) !== 335 ||
                    MapGen.Layers.Get(pTiles, bottomRunX + 1, bottomRunY, -1) !== 279)
                    continue;

                var hasRawBottomRun =
                    MapGen.Layers.Get(pTiles, bottomRunX, bottomRunY + 1, -1) === 124 &&
                    MapGen.Layers.Get(pTiles, bottomRunX + 1, bottomRunY + 1, -1) === 124 &&
                    MapGen.Layers.Get(pTiles, bottomRunX + 2, bottomRunY + 1, -1) === 124 &&
                    MapGen.Layers.Get(pTiles, bottomRunX + 3, bottomRunY + 1, -1) === 244;
                var hasPartialBottomRun =
                    MapGen.Layers.Get(pTiles, bottomRunX, bottomRunY + 1, -1) === 240 &&
                    MapGen.Layers.Get(pTiles, bottomRunX + 1, bottomRunY + 1, -1) === 123 &&
                    MapGen.Layers.Get(pTiles, bottomRunX + 2, bottomRunY + 1, -1) === 123 &&
                    MapGen.Layers.Get(pTiles, bottomRunX + 3, bottomRunY + 1, -1) === 244;
                var hasReopenedBottomRun =
                    MapGen.Layers.Get(pTiles, bottomRunX, bottomRunY + 1, -1) === 240 &&
                    MapGen.Layers.Get(pTiles, bottomRunX + 1, bottomRunY + 1, -1) === 244 &&
                    MapGen.Layers.Get(pTiles, bottomRunX + 2, bottomRunY + 1, -1) === 123 &&
                    MapGen.Layers.Get(pTiles, bottomRunX + 3, bottomRunY + 1, -1) === 244;
                if(!hasRawBottomRun && !hasPartialBottomRun && !hasReopenedBottomRun)
                    continue;

                var bottomContinuation = [240, 244, 297, 298, 297, 297];
                for(var bottomIndex = 0; bottomIndex < bottomContinuation.length; ++bottomIndex) {
                    if(MapGen.Layers.Get(pTiles, bottomRunX + bottomIndex, bottomRunY + 1, -1) === bottomContinuation[bottomIndex])
                        continue;
                    core.SetTile(pTiles, bottomRunX + bottomIndex, bottomRunY + 1, bottomContinuation[bottomIndex]);
                    ++changed;
                }
            }
        }

        for(var topRunX = 0; topRunX < pContext.Width - 6; ++topRunX) {
            for(var topRunY = 0; topRunY < pContext.Height; ++topRunY) {
                var topLeadTile = MapGen.Layers.Get(pTiles, topRunX, topRunY, -1);
                if((topLeadTile !== 252 && topLeadTile !== 124) ||
                    (MapGen.Layers.Get(pTiles, topRunX + 1, topRunY, -1) !== 292 &&
                        MapGen.Layers.Get(pTiles, topRunX + 1, topRunY, -1) !== 257) ||
                    MapGen.Layers.Get(pTiles, topRunX + 2, topRunY, -1) !== 256 ||
                    MapGen.Layers.Get(pTiles, topRunX + 3, topRunY, -1) !== 256 ||
                    !isLiveBeachCell(topRunX + 5, topRunY) ||
                    !isLiveWaterCell(topRunX + 6, topRunY))
                    continue;

                var hasRawTopRun =
                    MapGen.Layers.Get(pTiles, topRunX + 4, topRunY, -1) === 294 &&
                    MapGen.Layers.Get(pTiles, topRunX + 5, topRunY, -1) === 256 &&
                    MapGen.Layers.Get(pTiles, topRunX + 6, topRunY, -1) === 297 &&
                    MapGen.Layers.Get(pTiles, topRunX + 7, topRunY, -1) === 297;
                var hasPartialTopRun =
                    MapGen.Layers.Get(pTiles, topRunX + 4, topRunY, -1) === 256 &&
                    MapGen.Layers.Get(pTiles, topRunX + 5, topRunY, -1) === 258 &&
                    (MapGen.Layers.Get(pTiles, topRunX + 6, topRunY, -1) === 297 ||
                        MapGen.Layers.Get(pTiles, topRunX + 6, topRunY, -1) === 278) &&
                    MapGen.Layers.Get(pTiles, topRunX + 7, topRunY, -1) === 297;
                if(!hasRawTopRun && !hasPartialTopRun)
                    continue;

                var topContinuation = [252, 257, 257, 324, 256, 257, 258, 278];
                for(var topIndex = 0; topIndex < topContinuation.length; ++topIndex) {
                    if(MapGen.Layers.Get(pTiles, topRunX + topIndex, topRunY, -1) === topContinuation[topIndex])
                        continue;
                    core.SetTile(pTiles, topRunX + topIndex, topRunY, topContinuation[topIndex]);
                    ++changed;
                }
            }
        }

        for(var bankRunX = 0; bankRunX < pContext.Width - 3; ++bankRunX) {
            for(var bankRunY = 0; bankRunY < pContext.Height - 2; ++bankRunY) {
                var bankFirst = MapGen.Layers.Get(pTiles, bankRunX, bankRunY, -1);
                var bankSecond = MapGen.Layers.Get(pTiles, bankRunX + 1, bankRunY, -1);
                var bankThird = MapGen.Layers.Get(pTiles, bankRunX + 2, bankRunY, -1);
                var bankFourth = MapGen.Layers.Get(pTiles, bankRunX + 3, bankRunY, -1);
                var hasRawBankRun =
                    (bankFirst === 123 || bankFirst === 124) &&
                    (bankSecond === 123 || bankSecond === 124) &&
                    bankThird === 244 &&
                    isPureWaterTile(bankFourth);
                var hasPartialBankRun =
                    bankFirst === 240 &&
                    (bankSecond === 123 || bankSecond === 124 || bankSecond === 244) &&
                    bankThird === 244 &&
                    isPureWaterTile(bankFourth);
                if(!hasRawBankRun && !hasPartialBankRun)
                    continue;

                var nearBeach = false;
                for(var bankBeachY = bankRunY + 1; bankBeachY <= bankRunY + 2 && !nearBeach; ++bankBeachY) {
                    for(var bankBeachX = bankRunX - 1; bankBeachX <= bankRunX + 3; ++bankBeachX) {
                        if(isLiveBeachCell(bankBeachX, bankBeachY)) {
                            nearBeach = true;
                            break;
                        }
                    }
                }
                if(!nearBeach)
                    continue;

                var bankContinuation = [240, 244, 297, 297];
                for(var bankIndex = 0; bankIndex < bankContinuation.length; ++bankIndex) {
                    if(MapGen.Layers.Get(pTiles, bankRunX + bankIndex, bankRunY, -1) === bankContinuation[bankIndex])
                        continue;
                    core.SetTile(pTiles, bankRunX + bankIndex, bankRunY, bankContinuation[bankIndex]);
                    ++changed;
                }
            }
        }

        for(var bridgeRunX = 0; bridgeRunX < pContext.Width - 9; ++bridgeRunX) {
            for(var bridgeRunY = 0; bridgeRunY < pContext.Height - 1; ++bridgeRunY) {
                var hasRawBridgeRun =
                    MapGen.Layers.Get(pTiles, bridgeRunX, bridgeRunY, -1) === 252 &&
                    MapGen.Layers.Get(pTiles, bridgeRunX + 1, bridgeRunY, -1) === 256 &&
                    MapGen.Layers.Get(pTiles, bridgeRunX + 2, bridgeRunY, -1) === 244 &&
                    isPureWaterTile(MapGen.Layers.Get(pTiles, bridgeRunX + 3, bridgeRunY, -1));
                var hasStackBridgeRun =
                    MapGen.Layers.Get(pTiles, bridgeRunX, bridgeRunY, -1) === 275 &&
                    MapGen.Layers.Get(pTiles, bridgeRunX + 1, bridgeRunY, -1) === 276 &&
                    MapGen.Layers.Get(pTiles, bridgeRunX + 2, bridgeRunY, -1) === 277 &&
                    MapGen.Layers.Get(pTiles, bridgeRunX + 3, bridgeRunY, -1) === 257 &&
                    MapGen.Layers.Get(pTiles, bridgeRunX + 4, bridgeRunY, -1) === 324 &&
                    MapGen.Layers.Get(pTiles, bridgeRunX + 5, bridgeRunY, -1) === 279;
                if(!hasRawBridgeRun && !hasStackBridgeRun)
                    continue;

                var bridgeNearBeach = false;
                for(var bridgeBeachX = bridgeRunX - 2; bridgeBeachX <= bridgeRunX + 4; ++bridgeBeachX) {
                    if(isLiveBeachCell(bridgeBeachX, bridgeRunY + 1)) {
                        bridgeNearBeach = true;
                        break;
                    }
                }
                if(!bridgeNearBeach)
                    continue;
                if(bridgeRunY <= 3)
                    continue;

                var bridgeApproachA = [20, 19, 38, 225, 124, 225, 124, 124, 300, 297];
                for(var bridgeApproachAIndex = 0; bridgeApproachAIndex < bridgeApproachA.length; ++bridgeApproachAIndex) {
                    if(MapGen.Layers.Get(pTiles, bridgeRunX + bridgeApproachAIndex, bridgeRunY - 4, -1) === bridgeApproachA[bridgeApproachAIndex])
                        continue;
                    core.SetTile(pTiles, bridgeRunX + bridgeApproachAIndex, bridgeRunY - 4, bridgeApproachA[bridgeApproachAIndex]);
                    ++changed;
                }

                var bridgeApproachB = [38, 225, 124, 124, 124, 124, 123, 260, 317, 316];
                for(var bridgeApproachBIndex = 0; bridgeApproachBIndex < bridgeApproachB.length; ++bridgeApproachBIndex) {
                    if(MapGen.Layers.Get(pTiles, bridgeRunX + bridgeApproachBIndex, bridgeRunY - 3, -1) === bridgeApproachB[bridgeApproachBIndex])
                        continue;
                    core.SetTile(pTiles, bridgeRunX + bridgeApproachBIndex, bridgeRunY - 3, bridgeApproachB[bridgeApproachBIndex]);
                    ++changed;
                }

                var bridgeApproachC = [229, 124, 124, 87, 123, 124, 88, 283, 317, 297];
                for(var bridgeApproachCIndex = 0; bridgeApproachCIndex < bridgeApproachC.length; ++bridgeApproachCIndex) {
                    if(MapGen.Layers.Get(pTiles, bridgeRunX + bridgeApproachCIndex, bridgeRunY - 2, -1) === bridgeApproachC[bridgeApproachCIndex])
                        continue;
                    core.SetTile(pTiles, bridgeRunX + bridgeApproachCIndex, bridgeRunY - 2, bridgeApproachC[bridgeApproachCIndex]);
                    ++changed;
                }

                var bridgeUpperPrefix = [124, 124, 123];
                for(var bridgeUpperPrefixIndex = 0; bridgeUpperPrefixIndex < bridgeUpperPrefix.length; ++bridgeUpperPrefixIndex) {
                    if(MapGen.Layers.Get(pTiles, bridgeRunX + bridgeUpperPrefixIndex, bridgeRunY - 1, -1) === bridgeUpperPrefix[bridgeUpperPrefixIndex])
                        continue;
                    core.SetTile(pTiles, bridgeRunX + bridgeUpperPrefixIndex, bridgeRunY - 1, bridgeUpperPrefix[bridgeUpperPrefixIndex]);
                    ++changed;
                }

                var bridgeUpper = [275, 276, 313, 314, 243, 317, 317];
                for(var bridgeUpperIndex = 0; bridgeUpperIndex < bridgeUpper.length; ++bridgeUpperIndex) {
                    if(MapGen.Layers.Get(pTiles, bridgeRunX + 3 + bridgeUpperIndex, bridgeRunY - 1, -1) === bridgeUpper[bridgeUpperIndex])
                        continue;
                    core.SetTile(pTiles, bridgeRunX + 3 + bridgeUpperIndex, bridgeRunY - 1, bridgeUpper[bridgeUpperIndex]);
                    ++changed;
                }

                var bridgeContinuation = [275, 276, 277, 257, 324, 279, 315, 317, 317, 316];
                for(var bridgeIndex = 0; bridgeIndex < bridgeContinuation.length; ++bridgeIndex) {
                    if(MapGen.Layers.Get(pTiles, bridgeRunX + bridgeIndex, bridgeRunY, -1) === bridgeContinuation[bridgeIndex])
                        continue;
                    core.SetTile(pTiles, bridgeRunX + bridgeIndex, bridgeRunY, bridgeContinuation[bridgeIndex]);
                    ++changed;
                }

                var bridgeLowerStartX = bridgeRunX - 1;
                if(bridgeLowerStartX < 0)
                    continue;

                var bridgeLower = [255, 257, 257, 257, 257, 293, 297, 297, 317, 297, 298];
                for(var bridgeLowerIndex = 0; bridgeLowerIndex < bridgeLower.length; ++bridgeLowerIndex) {
                    if(MapGen.Layers.Get(pTiles, bridgeLowerStartX + bridgeLowerIndex, bridgeRunY + 1, -1) === bridgeLower[bridgeLowerIndex])
                        continue;
                    core.SetTile(pTiles, bridgeLowerStartX + bridgeLowerIndex, bridgeRunY + 1, bridgeLower[bridgeLowerIndex]);
                    ++changed;
                }

                if(bridgeRunY + 5 >= pContext.Height)
                    continue;

                var bridgeTailAStartX = bridgeRunX - 3;
                if(bridgeTailAStartX < 0)
                    continue;

                var bridgeTailA = [275, 277, 257, 257, 256, 257, 257, 295, 317, 317, 316, 317, 298];
                for(var bridgeTailAIndex = 0; bridgeTailAIndex < bridgeTailA.length; ++bridgeTailAIndex) {
                    if(MapGen.Layers.Get(pTiles, bridgeTailAStartX + bridgeTailAIndex, bridgeRunY + 2, -1) === bridgeTailA[bridgeTailAIndex])
                        continue;
                    core.SetTile(pTiles, bridgeTailAStartX + bridgeTailAIndex, bridgeRunY + 2, bridgeTailA[bridgeTailAIndex]);
                    ++changed;
                }

                var bridgeTailBStartX = bridgeRunX - 4;
                if(bridgeTailBStartX < 0)
                    continue;

                var bridgeTailB = [255, 256, 257, 256, 257, 258, 259, 278, 317, 298, 298, 298, 298, 298];
                for(var bridgeTailBIndex = 0; bridgeTailBIndex < bridgeTailB.length; ++bridgeTailBIndex) {
                    if(MapGen.Layers.Get(pTiles, bridgeTailBStartX + bridgeTailBIndex, bridgeRunY + 3, -1) === bridgeTailB[bridgeTailBIndex])
                        continue;
                    core.SetTile(pTiles, bridgeTailBStartX + bridgeTailBIndex, bridgeRunY + 3, bridgeTailB[bridgeTailBIndex]);
                    ++changed;
                }

                var bridgeTailDStartX = bridgeRunX - 6;
                if(bridgeTailDStartX < 0)
                    continue;

                var bridgeTailDHasBeachBelow = false;
                if(bridgeRunY + 6 < pContext.Height) {
                    for(var bridgeTailDBeachX = bridgeTailDStartX; bridgeTailDBeachX < bridgeTailDStartX + 6; ++bridgeTailDBeachX) {
                        if(isLiveBeachCell(bridgeTailDBeachX, bridgeRunY + 6)) {
                            bridgeTailDHasBeachBelow = true;
                            break;
                        }
                    }
                }
                if(bridgeTailDHasBeachBelow) {
                    continue;
                }

                var bridgeTailCStartX = bridgeRunX - 5;
                if(bridgeTailCStartX < 0)
                    continue;

                var bridgeTailC = [255, 256, 257, 256, 257, 279, 315, 316, 317, 298, 298, 298, 298, 298];
                for(var bridgeTailCIndex = 0; bridgeTailCIndex < bridgeTailC.length; ++bridgeTailCIndex) {
                    if(MapGen.Layers.Get(pTiles, bridgeTailCStartX + bridgeTailCIndex, bridgeRunY + 4, -1) === bridgeTailC[bridgeTailCIndex])
                        continue;
                    core.SetTile(pTiles, bridgeTailCStartX + bridgeTailCIndex, bridgeRunY + 4, bridgeTailC[bridgeTailCIndex]);
                    ++changed;
                }

                var bridgeTailD = [255, 256, 257, 258, 259, 278, 296, 297, 298, 298, 298, 298, 298, 298, 298];
                for(var bridgeTailDIndex = 0; bridgeTailDIndex < bridgeTailD.length; ++bridgeTailDIndex) {
                    if(MapGen.Layers.Get(pTiles, bridgeTailDStartX + bridgeTailDIndex, bridgeRunY + 5, -1) === bridgeTailD[bridgeTailDIndex])
                        continue;
                    core.SetTile(pTiles, bridgeTailDStartX + bridgeTailDIndex, bridgeRunY + 5, bridgeTailD[bridgeTailDIndex]);
                    ++changed;
                }
            }
        }

        for(var waterSpurY = 0; waterSpurY < pContext.Height; ++waterSpurY) {
            for(var waterSpurX = 1; waterSpurX < pContext.Width - 3; ++waterSpurX) {
                if(MapGen.Layers.Get(pTiles, waterSpurX - 1, waterSpurY, -1) !== 256 ||
                    MapGen.Layers.Get(pTiles, waterSpurX, waterSpurY, -1) !== 278 ||
                    MapGen.Layers.Get(pTiles, waterSpurX + 1, waterSpurY, -1) !== 278 ||
                    MapGen.Layers.Get(pTiles, waterSpurX + 2, waterSpurY, -1) !== 278 ||
                    !isPureWaterTile(MapGen.Layers.Get(pTiles, waterSpurX + 3, waterSpurY, -1)))
                    continue;

                var waterSpurReplacement = [257, 258, 278];
                for(var waterSpurIndex = 0; waterSpurIndex < waterSpurReplacement.length; ++waterSpurIndex) {
                    if(MapGen.Layers.Get(pTiles, waterSpurX + waterSpurIndex, waterSpurY, -1) === waterSpurReplacement[waterSpurIndex])
                        continue;
                    core.SetTile(pTiles, waterSpurX + waterSpurIndex, waterSpurY, waterSpurReplacement[waterSpurIndex]);
                    ++changed;
                }
            }
        }

        for(var waterTouchY = 0; waterTouchY < pContext.Height; ++waterTouchY) {
            for(var waterTouchX = 0; waterTouchX < pContext.Width; ++waterTouchX) {
                if(MapGen.Layers.Get(pTiles, waterTouchX, waterTouchY, -1) !== 297)
                    continue;

                var westTouchTile = MapGen.Layers.Get(pTiles, waterTouchX - 1, waterTouchY, -1);
                if(westTouchTile === 256 || westTouchTile === 257) {
                    core.SetTile(pTiles, waterTouchX - 1, waterTouchY, 279);
                    ++changed;
                }
                else if(westTouchTile === 259) {
                    core.SetTile(pTiles, waterTouchX, waterTouchY, 278);
                    ++changed;
                    continue;
                }

                var northTouchTile = MapGen.Layers.Get(pTiles, waterTouchX, waterTouchY - 1, -1);
                if(northTouchTile === 257 && westTouchTile === 279) {
                    core.SetTile(pTiles, waterTouchX, waterTouchY, 279);
                    ++changed;
                    continue;
                }
                if(northTouchTile === 256 || northTouchTile === 257) {
                    core.SetTile(pTiles, waterTouchX, waterTouchY - 1, 279);
                    ++changed;
                }
                else if(northTouchTile === 259) {
                    core.SetTile(pTiles, waterTouchX, waterTouchY, 278);
                    ++changed;
                }
            }
        }

        for(var unsupportedShoreRunY = 0; unsupportedShoreRunY < pContext.Height - 1; ++unsupportedShoreRunY) {
            for(var unsupportedShoreRunX = 1; unsupportedShoreRunX < pContext.Width - 3; ++unsupportedShoreRunX) {
                var unsupportedShoreWestTile = MapGen.Layers.Get(pTiles, unsupportedShoreRunX - 1, unsupportedShoreRunY, -1);
                if((unsupportedShoreWestTile !== 256 && unsupportedShoreWestTile !== 257) ||
                    MapGen.Layers.Get(pTiles, unsupportedShoreRunX, unsupportedShoreRunY, -1) !== 279 ||
                    MapGen.Layers.Get(pTiles, unsupportedShoreRunX + 1, unsupportedShoreRunY, -1) !== 258 ||
                    MapGen.Layers.Get(pTiles, unsupportedShoreRunX + 2, unsupportedShoreRunY, -1) !== 278 ||
                    !isPureWaterTile(MapGen.Layers.Get(pTiles, unsupportedShoreRunX + 3, unsupportedShoreRunY, -1)))
                    continue;

                core.SetTile(pTiles, unsupportedShoreRunX, unsupportedShoreRunY, 257);
                ++changed;

                if(MapGen.Layers.Get(pTiles, unsupportedShoreRunX, unsupportedShoreRunY + 1, -1) === 297) {
                    core.SetTile(pTiles, unsupportedShoreRunX, unsupportedShoreRunY + 1, 279);
                    ++changed;
                }
            }
        }

        for(var repeatedPlainEdgeY = 0; repeatedPlainEdgeY < pContext.Height; ++repeatedPlainEdgeY) {
            for(var repeatedPlainEdgeX = 3; repeatedPlainEdgeX < pContext.Width - 1; ++repeatedPlainEdgeX) {
                var repeatedPlainEdgeTile = MapGen.Layers.Get(pTiles, repeatedPlainEdgeX, repeatedPlainEdgeY, -1);
                if(repeatedPlainEdgeTile !== 279 && repeatedPlainEdgeTile !== 293 && repeatedPlainEdgeTile !== 295)
                    continue;
                if(!isPureWaterTile(MapGen.Layers.Get(pTiles, repeatedPlainEdgeX + 1, repeatedPlainEdgeY, -1)))
                    continue;

                if(repeatedPlainEdgeTile === 279) {
                    if(MapGen.Layers.Get(pTiles, repeatedPlainEdgeX - 1, repeatedPlainEdgeY, -1) === 279 &&
                        (MapGen.Layers.Get(pTiles, repeatedPlainEdgeX - 2, repeatedPlainEdgeY, -1) === 256 ||
                            MapGen.Layers.Get(pTiles, repeatedPlainEdgeX - 2, repeatedPlainEdgeY, -1) === 257)) {
                        core.SetTile(pTiles, repeatedPlainEdgeX - 1, repeatedPlainEdgeY, 257);
                        ++changed;
                    }
                    else if(MapGen.Layers.Get(pTiles, repeatedPlainEdgeX - 1, repeatedPlainEdgeY, -1) === 256 &&
                        MapGen.Layers.Get(pTiles, repeatedPlainEdgeX - 2, repeatedPlainEdgeY, -1) === 256) {
                        core.SetTile(pTiles, repeatedPlainEdgeX - 1, repeatedPlainEdgeY, 257);
                        ++changed;
                    }
                    continue;
                }

                if(repeatedPlainEdgeTile === 293) {
                    if(MapGen.Layers.Get(pTiles, repeatedPlainEdgeX - 1, repeatedPlainEdgeY, -1) === 256 &&
                        MapGen.Layers.Get(pTiles, repeatedPlainEdgeX - 2, repeatedPlainEdgeY, -1) === 256) {
                        core.SetTile(pTiles, repeatedPlainEdgeX - 1, repeatedPlainEdgeY, 257);
                        ++changed;
                    }
                    if(MapGen.Layers.Get(pTiles, repeatedPlainEdgeX - 2, repeatedPlainEdgeY, -1) === 256 &&
                        MapGen.Layers.Get(pTiles, repeatedPlainEdgeX - 3, repeatedPlainEdgeY, -1) === 256) {
                        core.SetTile(pTiles, repeatedPlainEdgeX - 2, repeatedPlainEdgeY, 257);
                        ++changed;
                    }
                    continue;
                }

                if(MapGen.Layers.Get(pTiles, repeatedPlainEdgeX - 1, repeatedPlainEdgeY, -1) === 256 &&
                    MapGen.Layers.Get(pTiles, repeatedPlainEdgeX - 2, repeatedPlainEdgeY, -1) === 256 &&
                    MapGen.Layers.Get(pTiles, repeatedPlainEdgeX - 3, repeatedPlainEdgeY, -1) === 256) {
                    core.SetTile(pTiles, repeatedPlainEdgeX - 2, repeatedPlainEdgeY, 257);
                    core.SetTile(pTiles, repeatedPlainEdgeX - 3, repeatedPlainEdgeY, 257);
                    changed += 2;
                }
            }
        }

        for(var stackedHoleY = 0; stackedHoleY < pContext.Height - 1; ++stackedHoleY) {
            for(var stackedHoleX = 1; stackedHoleX < pContext.Width - 2; ++stackedHoleX) {
                if(MapGen.Layers.Get(pTiles, stackedHoleX, stackedHoleY, -1) !== 279 ||
                    MapGen.Layers.Get(pTiles, stackedHoleX + 1, stackedHoleY, -1) !== 297 ||
                    MapGen.Layers.Get(pTiles, stackedHoleX + 2, stackedHoleY, -1) !== 298 ||
                    MapGen.Layers.Get(pTiles, stackedHoleX, stackedHoleY + 1, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, stackedHoleX + 1, stackedHoleY + 1, -1) !== 258 ||
                    MapGen.Layers.Get(pTiles, stackedHoleX + 2, stackedHoleY + 1, -1) !== 278)
                    continue;

                core.SetTile(pTiles, stackedHoleX, stackedHoleY, 257);
                core.SetTile(pTiles, stackedHoleX + 1, stackedHoleY, 279);
                core.SetTile(pTiles, stackedHoleX + 2, stackedHoleY, 297);
                changed += 3;
            }
        }

        for(var connectorSupportY = 0; connectorSupportY < pContext.Height - 1; ++connectorSupportY) {
            for(var connectorSupportX = 0; connectorSupportX < pContext.Width - 2; ++connectorSupportX) {
                if(MapGen.Layers.Get(pTiles, connectorSupportX, connectorSupportY, -1) !== 258 ||
                    MapGen.Layers.Get(pTiles, connectorSupportX + 1, connectorSupportY, -1) !== 259 ||
                    MapGen.Layers.Get(pTiles, connectorSupportX + 2, connectorSupportY, -1) !== 278 ||
                    MapGen.Layers.Get(pTiles, connectorSupportX, connectorSupportY + 1, -1) !== 294 ||
                    MapGen.Layers.Get(pTiles, connectorSupportX + 1, connectorSupportY + 1, -1) !== 278)
                    continue;

                core.SetTile(pTiles, connectorSupportX + 1, connectorSupportY + 1, 297);
                if(MapGen.Layers.Get(pTiles, connectorSupportX + 2, connectorSupportY + 1, -1) === 297)
                    core.SetTile(pTiles, connectorSupportX + 2, connectorSupportY + 1, 298);
                changed += 2;
            }
        }

        for(var continuedSupportY = 0; continuedSupportY < pContext.Height - 2; ++continuedSupportY) {
            for(var continuedSupportX = 1; continuedSupportX < pContext.Width - 3; ++continuedSupportX) {
                if(MapGen.Layers.Get(pTiles, continuedSupportX, continuedSupportY, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, continuedSupportX + 1, continuedSupportY, -1) !== 258 ||
                    MapGen.Layers.Get(pTiles, continuedSupportX + 2, continuedSupportY, -1) !== 259 ||
                    MapGen.Layers.Get(pTiles, continuedSupportX + 3, continuedSupportY, -1) !== 278 ||
                    MapGen.Layers.Get(pTiles, continuedSupportX - 1, continuedSupportY + 1, -1) !== 256 ||
                    MapGen.Layers.Get(pTiles, continuedSupportX, continuedSupportY + 1, -1) !== 256 ||
                    MapGen.Layers.Get(pTiles, continuedSupportX + 1, continuedSupportY + 1, -1) !== 294 ||
                    MapGen.Layers.Get(pTiles, continuedSupportX + 2, continuedSupportY + 1, -1) !== 297 ||
                    MapGen.Layers.Get(pTiles, continuedSupportX + 3, continuedSupportY + 1, -1) !== 298 ||
                    MapGen.Layers.Get(pTiles, continuedSupportX, continuedSupportY + 2, -1) !== 256 ||
                    MapGen.Layers.Get(pTiles, continuedSupportX + 1, continuedSupportY + 2, -1) !== 295)
                    continue;

                core.SetTile(pTiles, continuedSupportX - 1, continuedSupportY + 1, 257);
                core.SetTile(pTiles, continuedSupportX, continuedSupportY + 1, 293);
                core.SetTile(pTiles, continuedSupportX + 1, continuedSupportY + 1, 297);
                core.SetTile(pTiles, continuedSupportX + 2, continuedSupportY + 1, 298);
                changed += 4;
            }
        }

        for(var protrudingShoreY = 0; protrudingShoreY < pContext.Height - 1; ++protrudingShoreY) {
            for(var protrudingShoreX = 1; protrudingShoreX < pContext.Width - 4; ++protrudingShoreX) {
                if(MapGen.Layers.Get(pTiles, protrudingShoreX, protrudingShoreY, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, protrudingShoreX + 1, protrudingShoreY, -1) !== 279 ||
                    MapGen.Layers.Get(pTiles, protrudingShoreX + 2, protrudingShoreY, -1) !== 297 ||
                    MapGen.Layers.Get(pTiles, protrudingShoreX, protrudingShoreY + 1, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, protrudingShoreX + 1, protrudingShoreY + 1, -1) !== 258 ||
                    MapGen.Layers.Get(pTiles, protrudingShoreX + 2, protrudingShoreY + 1, -1) !== 278)
                    continue;

                core.SetTile(pTiles, protrudingShoreX + 1, protrudingShoreY, 256);
                core.SetTile(pTiles, protrudingShoreX + 2, protrudingShoreY, 257);
                core.SetTile(pTiles, protrudingShoreX + 3, protrudingShoreY, 295);
                core.SetTile(pTiles, protrudingShoreX + 4, protrudingShoreY, 297);
                changed += 4;
            }
        }

        for(var mapm5SupportY = 0; mapm5SupportY < pContext.Height - 1; ++mapm5SupportY) {
            for(var mapm5SupportX = 0; mapm5SupportX < pContext.Width - 6; ++mapm5SupportX) {
                if(MapGen.Layers.Get(pTiles, mapm5SupportX, mapm5SupportY, -1) !== 256 ||
                    MapGen.Layers.Get(pTiles, mapm5SupportX + 1, mapm5SupportY, -1) !== 256 ||
                    MapGen.Layers.Get(pTiles, mapm5SupportX + 2, mapm5SupportY, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, mapm5SupportX + 3, mapm5SupportY, -1) !== 279 ||
                    MapGen.Layers.Get(pTiles, mapm5SupportX + 4, mapm5SupportY, -1) !== 297 ||
                    MapGen.Layers.Get(pTiles, mapm5SupportX + 5, mapm5SupportY, -1) !== 298 ||
                    MapGen.Layers.Get(pTiles, mapm5SupportX + 6, mapm5SupportY, -1) !== 298 ||
                    MapGen.Layers.Get(pTiles, mapm5SupportX, mapm5SupportY + 1, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, mapm5SupportX + 1, mapm5SupportY + 1, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, mapm5SupportX + 2, mapm5SupportY + 1, -1) !== 256 ||
                    MapGen.Layers.Get(pTiles, mapm5SupportX + 3, mapm5SupportY + 1, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, mapm5SupportX + 4, mapm5SupportY + 1, -1) !== 295 ||
                    MapGen.Layers.Get(pTiles, mapm5SupportX + 5, mapm5SupportY + 1, -1) !== 297 ||
                    MapGen.Layers.Get(pTiles, mapm5SupportX + 6, mapm5SupportY + 1, -1) !== 298)
                    continue;

                core.SetTile(pTiles, mapm5SupportX, mapm5SupportY, 257);
                core.SetTile(pTiles, mapm5SupportX + 3, mapm5SupportY, 257);
                core.SetTile(pTiles, mapm5SupportX + 4, mapm5SupportY, 294);
                core.SetTile(pTiles, mapm5SupportX + 5, mapm5SupportY, 297);
                core.SetTile(pTiles, mapm5SupportX + 6, mapm5SupportY, 297);
                changed += 5;
            }
        }

        for(var mapm5UpperSupportY = 0; mapm5UpperSupportY < pContext.Height - 2; ++mapm5UpperSupportY) {
            for(var mapm5UpperSupportX = 0; mapm5UpperSupportX < pContext.Width - 6; ++mapm5UpperSupportX) {
                if(MapGen.Layers.Get(pTiles, mapm5UpperSupportX, mapm5UpperSupportY, -1) !== 255 ||
                    MapGen.Layers.Get(pTiles, mapm5UpperSupportX + 1, mapm5UpperSupportY, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, mapm5UpperSupportX + 2, mapm5UpperSupportY, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, mapm5UpperSupportX + 3, mapm5UpperSupportY, -1) !== 256 ||
                    MapGen.Layers.Get(pTiles, mapm5UpperSupportX + 4, mapm5UpperSupportY, -1) !== 295 ||
                    MapGen.Layers.Get(pTiles, mapm5UpperSupportX + 5, mapm5UpperSupportY, -1) !== 297 ||
                    MapGen.Layers.Get(pTiles, mapm5UpperSupportX + 6, mapm5UpperSupportY, -1) !== 297 ||
                    MapGen.Layers.Get(pTiles, mapm5UpperSupportX, mapm5UpperSupportY + 1, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, mapm5UpperSupportX + 1, mapm5UpperSupportY + 1, -1) !== 256 ||
                    MapGen.Layers.Get(pTiles, mapm5UpperSupportX + 2, mapm5UpperSupportY + 1, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, mapm5UpperSupportX + 3, mapm5UpperSupportY + 1, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, mapm5UpperSupportX + 4, mapm5UpperSupportY + 1, -1) !== 294 ||
                    MapGen.Layers.Get(pTiles, mapm5UpperSupportX + 5, mapm5UpperSupportY + 1, -1) !== 297 ||
                    MapGen.Layers.Get(pTiles, mapm5UpperSupportX + 6, mapm5UpperSupportY + 1, -1) !== 297 ||
                    MapGen.Layers.Get(pTiles, mapm5UpperSupportX, mapm5UpperSupportY + 2, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, mapm5UpperSupportX + 1, mapm5UpperSupportY + 2, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, mapm5UpperSupportX + 2, mapm5UpperSupportY + 2, -1) !== 256 ||
                    MapGen.Layers.Get(pTiles, mapm5UpperSupportX + 3, mapm5UpperSupportY + 2, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, mapm5UpperSupportX + 4, mapm5UpperSupportY + 2, -1) !== 295 ||
                    MapGen.Layers.Get(pTiles, mapm5UpperSupportX + 5, mapm5UpperSupportY + 2, -1) !== 297 ||
                    MapGen.Layers.Get(pTiles, mapm5UpperSupportX + 6, mapm5UpperSupportY + 2, -1) !== 298)
                    continue;

                core.SetTile(pTiles, mapm5UpperSupportX + 3, mapm5UpperSupportY, 257);
                core.SetTile(pTiles, mapm5UpperSupportX + 4, mapm5UpperSupportY, 293);
                core.SetTile(pTiles, mapm5UpperSupportX + 6, mapm5UpperSupportY, 298);
                changed += 3;
            }
        }

        for(var shiftedInletY = 0; shiftedInletY < pContext.Height - 1; ++shiftedInletY) {
            for(var shiftedInletX = 1; shiftedInletX < pContext.Width - 2; ++shiftedInletX) {
                if(MapGen.Layers.Get(pTiles, shiftedInletX - 1, shiftedInletY, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, shiftedInletX, shiftedInletY, -1) !== 293 ||
                    MapGen.Layers.Get(pTiles, shiftedInletX + 1, shiftedInletY, -1) !== 297 ||
                    MapGen.Layers.Get(pTiles, shiftedInletX + 2, shiftedInletY, -1) !== 298 ||
                    MapGen.Layers.Get(pTiles, shiftedInletX - 1, shiftedInletY + 1, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, shiftedInletX, shiftedInletY + 1, -1) !== 256 ||
                    MapGen.Layers.Get(pTiles, shiftedInletX + 1, shiftedInletY + 1, -1) !== 295 ||
                    MapGen.Layers.Get(pTiles, shiftedInletX + 2, shiftedInletY + 1, -1) !== 298)
                    continue;

                core.SetTile(pTiles, shiftedInletX - 1, shiftedInletY + 1, 256);
                core.SetTile(pTiles, shiftedInletX, shiftedInletY + 1, 295);
                core.SetTile(pTiles, shiftedInletX + 1, shiftedInletY + 1, 298);
                changed += 3;
            }
        }

        for(var repeatedUpperShoreY = 0; repeatedUpperShoreY < pContext.Height - 3; ++repeatedUpperShoreY) {
            for(var repeatedUpperShoreX = 3; repeatedUpperShoreX < pContext.Width - 2; ++repeatedUpperShoreX) {
                if(MapGen.Layers.Get(pTiles, repeatedUpperShoreX - 3, repeatedUpperShoreY, -1) !== 256 ||
                    MapGen.Layers.Get(pTiles, repeatedUpperShoreX - 2, repeatedUpperShoreY, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, repeatedUpperShoreX - 1, repeatedUpperShoreY, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, repeatedUpperShoreX, repeatedUpperShoreY, -1) !== 293 ||
                    MapGen.Layers.Get(pTiles, repeatedUpperShoreX + 1, repeatedUpperShoreY, -1) !== 297 ||
                    MapGen.Layers.Get(pTiles, repeatedUpperShoreX + 2, repeatedUpperShoreY, -1) !== 297 ||
                    MapGen.Layers.Get(pTiles, repeatedUpperShoreX - 2, repeatedUpperShoreY + 1, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, repeatedUpperShoreX - 1, repeatedUpperShoreY + 1, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, repeatedUpperShoreX, repeatedUpperShoreY + 1, -1) !== 293 ||
                    MapGen.Layers.Get(pTiles, repeatedUpperShoreX + 1, repeatedUpperShoreY + 1, -1) !== 297 ||
                    MapGen.Layers.Get(pTiles, repeatedUpperShoreX + 2, repeatedUpperShoreY + 1, -1) !== 298 ||
                    MapGen.Layers.Get(pTiles, repeatedUpperShoreX, repeatedUpperShoreY + 2, -1) !== 294 ||
                    MapGen.Layers.Get(pTiles, repeatedUpperShoreX, repeatedUpperShoreY + 3, -1) !== 295)
                    continue;

                core.SetTile(pTiles, repeatedUpperShoreX, repeatedUpperShoreY, 257);
                core.SetTile(pTiles, repeatedUpperShoreX + 1, repeatedUpperShoreY, 279);
                changed += 2;
            }
        }

        for(var stackedLipY = 0; stackedLipY < pContext.Height - 5; ++stackedLipY) {
            for(var stackedLipX = 4; stackedLipX < pContext.Width - 3; ++stackedLipX) {
                if(MapGen.Layers.Get(pTiles, stackedLipX, stackedLipY, -1) !== 295 ||
                    MapGen.Layers.Get(pTiles, stackedLipX, stackedLipY + 1, -1) !== 279 ||
                    MapGen.Layers.Get(pTiles, stackedLipX, stackedLipY + 2, -1) !== 279 ||
                    MapGen.Layers.Get(pTiles, stackedLipX - 1, stackedLipY + 1, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, stackedLipX + 1, stackedLipY + 1, -1) !== 297 ||
                    MapGen.Layers.Get(pTiles, stackedLipX - 1, stackedLipY + 2, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, stackedLipX + 1, stackedLipY + 2, -1) !== 297 ||
                    MapGen.Layers.Get(pTiles, stackedLipX - 1, stackedLipY + 3, -1) !== 293 ||
                    MapGen.Layers.Get(pTiles, stackedLipX - 1, stackedLipY + 4, -1) !== 294 ||
                    MapGen.Layers.Get(pTiles, stackedLipX - 1, stackedLipY + 5, -1) !== 295)
                    continue;

                core.SetTile(pTiles, stackedLipX, stackedLipY, 257);
                core.SetTile(pTiles, stackedLipX + 1, stackedLipY, 295);
                core.SetTile(pTiles, stackedLipX + 2, stackedLipY, 297);
                core.SetTile(pTiles, stackedLipX, stackedLipY + 1, 293);
                core.SetTile(pTiles, stackedLipX, stackedLipY + 2, 294);
                changed += 5;
            }
        }

        for(var shiftedCurveY = 0; shiftedCurveY < pContext.Height - 1; ++shiftedCurveY) {
            for(var shiftedCurveX = 1; shiftedCurveX < pContext.Width - 2; ++shiftedCurveX) {
                if(MapGen.Layers.Get(pTiles, shiftedCurveX, shiftedCurveY, -1) !== 293 ||
                    !isPureWaterTile(MapGen.Layers.Get(pTiles, shiftedCurveX + 1, shiftedCurveY, -1)) ||
                    MapGen.Layers.Get(pTiles, shiftedCurveX, shiftedCurveY + 1, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, shiftedCurveX + 1, shiftedCurveY + 1, -1) !== 295 ||
                    MapGen.Layers.Get(pTiles, shiftedCurveX - 1, shiftedCurveY, -1) !== 257)
                    continue;

                if(MapGen.Layers.Get(pTiles, shiftedCurveX - 1, shiftedCurveY + 1, -1) === 256) {
                    core.SetTile(pTiles, shiftedCurveX - 1, shiftedCurveY + 1, 257);
                    ++changed;
                }
                core.SetTile(pTiles, shiftedCurveX, shiftedCurveY + 1, 294);
                core.SetTile(pTiles, shiftedCurveX + 1, shiftedCurveY + 1, 297);
                changed += 2;
            }
        }

        for(var repeatedEdgeStartY = 0; repeatedEdgeStartY < pContext.Height - 4; ++repeatedEdgeStartY) {
            for(var repeatedEdgeStartX = 1; repeatedEdgeStartX < pContext.Width - 2; ++repeatedEdgeStartX) {
                if(MapGen.Layers.Get(pTiles, repeatedEdgeStartX, repeatedEdgeStartY, -1) !== 293 ||
                    MapGen.Layers.Get(pTiles, repeatedEdgeStartX, repeatedEdgeStartY + 1, -1) !== 294 ||
                    MapGen.Layers.Get(pTiles, repeatedEdgeStartX, repeatedEdgeStartY + 2, -1) !== 293 ||
                    MapGen.Layers.Get(pTiles, repeatedEdgeStartX, repeatedEdgeStartY + 3, -1) !== 294 ||
                    !isPureWaterTile(MapGen.Layers.Get(pTiles, repeatedEdgeStartX + 1, repeatedEdgeStartY, -1)) ||
                    !isPureWaterTile(MapGen.Layers.Get(pTiles, repeatedEdgeStartX + 1, repeatedEdgeStartY + 1, -1)) ||
                    !isPureWaterTile(MapGen.Layers.Get(pTiles, repeatedEdgeStartX + 1, repeatedEdgeStartY + 2, -1)) ||
                    !isPureWaterTile(MapGen.Layers.Get(pTiles, repeatedEdgeStartX + 1, repeatedEdgeStartY + 3, -1)) ||
                    MapGen.Layers.Get(pTiles, repeatedEdgeStartX - 1, repeatedEdgeStartY + 2, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, repeatedEdgeStartX - 1, repeatedEdgeStartY + 3, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, repeatedEdgeStartX - 1, repeatedEdgeStartY + 4, -1) !== 293)
                    continue;

                core.SetTile(pTiles, repeatedEdgeStartX, repeatedEdgeStartY + 2, 295);
                core.SetTile(pTiles, repeatedEdgeStartX + 1, repeatedEdgeStartY + 2, 297);
                core.SetTile(pTiles, repeatedEdgeStartX + 2, repeatedEdgeStartY + 2, 297);
                core.SetTile(pTiles, repeatedEdgeStartX, repeatedEdgeStartY + 3, 279);
                core.SetTile(pTiles, repeatedEdgeStartX + 1, repeatedEdgeStartY + 3, 297);
                core.SetTile(pTiles, repeatedEdgeStartX + 2, repeatedEdgeStartY + 3, 297);
                changed += 6;
            }
        }

        for(var lowerBankStepY = 1; lowerBankStepY < pContext.Height - 2; ++lowerBankStepY) {
            for(var lowerBankStepX = 2; lowerBankStepX < pContext.Width - 5; ++lowerBankStepX) {
                if(MapGen.Layers.Get(pTiles, lowerBankStepX, lowerBankStepY - 1, -1) !== 324 ||
                    MapGen.Layers.Get(pTiles, lowerBankStepX + 1, lowerBankStepY - 1, -1) !== 256 ||
                    MapGen.Layers.Get(pTiles, lowerBankStepX + 2, lowerBankStepY - 1, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, lowerBankStepX + 3, lowerBankStepY - 1, -1) !== 258 ||
                    MapGen.Layers.Get(pTiles, lowerBankStepX + 4, lowerBankStepY - 1, -1) !== 278 ||
                    !isPureWaterTile(MapGen.Layers.Get(pTiles, lowerBankStepX + 5, lowerBankStepY - 1, -1)) ||
                    MapGen.Layers.Get(pTiles, lowerBankStepX, lowerBankStepY, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, lowerBankStepX + 1, lowerBankStepY, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, lowerBankStepX + 2, lowerBankStepY, -1) !== 279 ||
                    MapGen.Layers.Get(pTiles, lowerBankStepX + 3, lowerBankStepY, -1) !== 297 ||
                    MapGen.Layers.Get(pTiles, lowerBankStepX + 4, lowerBankStepY, -1) !== 297 ||
                    MapGen.Layers.Get(pTiles, lowerBankStepX + 5, lowerBankStepY, -1) !== 298 ||
                    MapGen.Layers.Get(pTiles, lowerBankStepX, lowerBankStepY + 1, -1) !== 279 ||
                    MapGen.Layers.Get(pTiles, lowerBankStepX + 1, lowerBankStepY + 1, -1) !== 297 ||
                    MapGen.Layers.Get(pTiles, lowerBankStepX + 2, lowerBankStepY + 1, -1) !== 297 ||
                    MapGen.Layers.Get(pTiles, lowerBankStepX + 3, lowerBankStepY + 1, -1) !== 297 ||
                    MapGen.Layers.Get(pTiles, lowerBankStepX, lowerBankStepY + 2, -1) !== 297)
                    continue;

                core.SetTile(pTiles, lowerBankStepX, lowerBankStepY, 256);
                core.SetTile(pTiles, lowerBankStepX + 4, lowerBankStepY, 298);
                core.SetTile(pTiles, lowerBankStepX, lowerBankStepY + 1, 257);
                core.SetTile(pTiles, lowerBankStepX + 1, lowerBankStepY + 1, 279);
                core.SetTile(pTiles, lowerBankStepX + 4, lowerBankStepY + 1, 297);
                core.SetTile(pTiles, lowerBankStepX + 5, lowerBankStepY + 1, 298);
                core.SetTile(pTiles, lowerBankStepX, lowerBankStepY + 2, 278);
                changed += 7;
            }
        }

        changed += this.StampSub1GrammarBeachWaterEdgeTemplateTiles(pContext, pTiles, pLookup);

        for(var sandDropY = 0; sandDropY < pContext.Height - 1; ++sandDropY) {
            for(var sandDropX = 1; sandDropX < pContext.Width - 2; ++sandDropX) {
                if(MapGen.Layers.Get(pTiles, sandDropX, sandDropY, -1) !== 258 ||
                    MapGen.Layers.Get(pTiles, sandDropX + 1, sandDropY, -1) !== 259 ||
                    MapGen.Layers.Get(pTiles, sandDropX + 2, sandDropY, -1) !== 278 ||
                    MapGen.Layers.Get(pTiles, sandDropX, sandDropY + 1, -1) !== 293 ||
                    MapGen.Layers.Get(pTiles, sandDropX - 1, sandDropY + 1, -1) !== 257 ||
                    !canRewrite(this, sandDropX - 1, sandDropY + 1) ||
                    !canRewrite(this, sandDropX, sandDropY + 1))
                    continue;

                core.SetTile(pTiles, sandDropX - 1, sandDropY + 1, 293);
                core.SetTile(pTiles, sandDropX, sandDropY + 1, 297);
                changed += 2;
            }
        }

        for(var repeated278Y = 0; repeated278Y < pContext.Height; ++repeated278Y) {
            for(var repeated278X = 0; repeated278X < pContext.Width; ++repeated278X) {
                if(MapGen.Layers.Get(pTiles, repeated278X, repeated278Y, -1) !== 278 ||
                    !isLiveWaterCell(repeated278X, repeated278Y) ||
                    !canRewrite(this, repeated278X, repeated278Y))
                    continue;

                if(MapGen.Layers.Get(pTiles, repeated278X - 1, repeated278Y, -1) === 278 ||
                    MapGen.Layers.Get(pTiles, repeated278X, repeated278Y - 1, -1) === 278) {
                    core.SetTile(pTiles, repeated278X, repeated278Y, 297);
                    ++changed;
                }
            }
        }

        for(var stacked295Y = 0; stacked295Y < pContext.Height - 1; ++stacked295Y) {
            for(var stacked295X = 1; stacked295X < pContext.Width - 1; ++stacked295X) {
                if(MapGen.Layers.Get(pTiles, stacked295X, stacked295Y, -1) !== 295 ||
                    MapGen.Layers.Get(pTiles, stacked295X, stacked295Y + 1, -1) !== 279 ||
                    MapGen.Layers.Get(pTiles, stacked295X - 1, stacked295Y + 1, -1) !== 257 ||
                    !canRewrite(this, stacked295X - 1, stacked295Y + 1) ||
                    !canRewrite(this, stacked295X, stacked295Y + 1))
                    continue;

                core.SetTile(pTiles, stacked295X - 1, stacked295Y + 1, 279);
                core.SetTile(pTiles, stacked295X, stacked295Y + 1, 297);
                changed += 2;
            }
        }

        for(var vertical257Y = 0; vertical257Y < pContext.Height - 1; ++vertical257Y) {
            for(var vertical257X = 1; vertical257X < pContext.Width - 1; ++vertical257X) {
                if(MapGen.Layers.Get(pTiles, vertical257X, vertical257Y, -1) !== 257 ||
                    !isPureWaterTile(MapGen.Layers.Get(pTiles, vertical257X, vertical257Y + 1, -1)) ||
                    MapGen.Layers.Get(pTiles, vertical257X + 1, vertical257Y, -1) !== 279 ||
                    !canRewrite(this, vertical257X, vertical257Y) ||
                    !canRewrite(this, vertical257X + 1, vertical257Y))
                    continue;

                core.SetTile(pTiles, vertical257X, vertical257Y, 279);
                core.SetTile(pTiles, vertical257X + 1, vertical257Y, 297);
                changed += 2;
            }
        }

        for(var stacked257293Y = 0; stacked257293Y < pContext.Height - 1; ++stacked257293Y) {
            for(var stacked257293X = 0; stacked257293X < pContext.Width - 1; ++stacked257293X) {
                if(MapGen.Layers.Get(pTiles, stacked257293X, stacked257293Y, -1) !== 257 ||
                    MapGen.Layers.Get(pTiles, stacked257293X + 1, stacked257293Y, -1) !== 293 ||
                    MapGen.Layers.Get(pTiles, stacked257293X, stacked257293Y + 1, -1) !== 279 ||
                    MapGen.Layers.Get(pTiles, stacked257293X + 1, stacked257293Y + 1, -1) !== 295 ||
                    !canRewrite(this, stacked257293X, stacked257293Y + 1))
                    continue;

                core.SetTile(
                    pTiles,
                    stacked257293X,
                    stacked257293Y + 1,
                    isPureWaterTile(MapGen.Layers.Get(pTiles, stacked257293X, stacked257293Y + 2, -1)) ? 256 : 257
                );
                ++changed;
            }
        }

        for(var unsupported278Y = 0; unsupported278Y < pContext.Height; ++unsupported278Y) {
            for(var unsupported278X = 0; unsupported278X < pContext.Width; ++unsupported278X) {
                if(MapGen.Layers.Get(pTiles, unsupported278X, unsupported278Y, -1) !== 278 ||
                    !isLiveWaterCell(unsupported278X, unsupported278Y) ||
                    !canRewrite(this, unsupported278X, unsupported278Y))
                    continue;

                var supportNorth = MapGen.Layers.Get(pTiles, unsupported278X, unsupported278Y - 1, -1);
                var supportWest = MapGen.Layers.Get(pTiles, unsupported278X - 1, unsupported278Y, -1);
                if((supportWest === 258 || supportWest === 259) &&
                    (supportNorth === 256 || supportNorth === 257))
                    continue;

                if(supportWest === 256 &&
                    supportNorth === 279 &&
                    canRewrite(this, unsupported278X - 1, unsupported278Y))
                    core.SetTile(pTiles, unsupported278X - 1, unsupported278Y, 279);

                core.SetTile(pTiles, unsupported278X, unsupported278Y, 297);
                ++changed;
            }
        }

        changed += this.StampSub1GrammarBeachWaterEdgeTemplateTiles(pContext, pTiles, pLookup);

        return changed;
    };

    pJungle.RepairSub1GrammarBeachSandVisualSeams = function(pContext, pTiles, pLookup) {
        if(!this.IsGrammarBeachProfile(pContext))
            return 0;

        var core = MapGen.Terrain.Smoothing.Core;
        var changed = 0;
        var masks = this.Sub1GrammarBeachSandMaskTiles();
        var retileMasks = {
            GSSS: true,
            SSSS: true,
            SSSG: true,
            SSWS: true,
            SSGG: true,
            GSGG: true
        };

        function candidateSandVisualScore(pSelf, pCandidate, pMask, pX, pY) {
            var record = pLookup[String(pCandidate)];
            if(!record || !record.visualEdges)
                return -1e9;

            var score = pSelf.Sub1ScoreBeachSandVisualJoin(record, pLookup, pTiles, pX, pY);
            score += pSelf.Sub1GrammarBeachMaskBias(
                "beach",
                "sand",
                pCandidate,
                pMask,
                pY > 0 ? MapGen.Layers.Get(pTiles, pX, pY - 1, -1) : -1,
                pX > 0 ? MapGen.Layers.Get(pTiles, pX - 1, pY, -1) : -1
            );

            return score;
        }

        for(var pass = 0; pass < 2; ++pass) {
            var passChanged = 0;
            for(var y = 0; y < pContext.Height; ++y) {
                for(var x = 0; x < pContext.Width; ++x) {
                    var tileId = MapGen.Layers.Get(pTiles, x, y, -1);
                    if(tileId !== 256 && tileId !== 257)
                        continue;

                    var mask = this.Sub1BeachTileClassMaskAt(pLookup, pTiles, x, y);
                    if(!retileMasks[mask])
                        continue;

                    var maskTiles = masks[mask];
                    if(!maskTiles || !maskTiles[256] || !maskTiles[257])
                        continue;

                    var currentScore = candidateSandVisualScore(this, tileId, mask, x, y);
                    var bestTile = tileId;
                    var bestScore = currentScore + 4;
                    var candidates = [256, 257];
                    for(var index = 0; index < candidates.length; ++index) {
                        var candidate = candidates[index];
                        if(candidate === tileId)
                            continue;

                        var score = candidateSandVisualScore(this, candidate, mask, x, y);

                        if(score > bestScore) {
                            bestScore = score;
                            bestTile = candidate;
                        }
                    }

                    if(bestTile === tileId)
                        continue;

                    core.SetTile(pTiles, x, y, bestTile);
                    ++passChanged;
                }
            }

            if(!passChanged)
                break;

            changed += passChanged;
        }

        return changed;
    };
})(MapGen.Terrain.Smoothing.Jungle);
