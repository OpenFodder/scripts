var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};
MapGen.Terrain.Smoothing.Jungle = MapGen.Terrain.Smoothing.Jungle || {};

(function(pJungle) {
    pJungle.IsGrammarBeachMapm5WadeCell = function(pContext, pX, pY) {
        if(!pContext || !pContext.GrammarLiveTerrain ||
            pContext.GrammarLiveTerrain.beachTemplate !== "mapm5_top_bank")
            return false;

        var crossings = pContext.Crossings || [];
        for(var index = 0; index < crossings.length; ++index) {
            var crossing = crossings[index];
            if(!crossing || crossing.role !== "grammar_beach_mapm5_wade" ||
                crossing.axis !== "horizontal")
                continue;
            if(pX >= Number(crossing.waterMinX) && pX <= Number(crossing.waterMaxX) &&
                Math.abs(pY - crossing.y) <= Math.max(1, Math.floor(crossing.halfWidth || 1)))
                return true;
        }

        return false;
    };

    pJungle.StampSub1Mapm8CornerCoveTiles = function(pContext, pTiles) {
        var live = pContext && pContext.GrammarLiveTerrain ? pContext.GrammarLiveTerrain : null;
        var beachData = MapGen.Terrain.Smoothing.JungleBeach;
        var template = beachData && beachData.Mapm8CornerCoveTileTemplate ?
            beachData.Mapm8CornerCoveTileTemplate() : null;

        if(!live || live.beachTemplate !== "mapm8_corner_cove" ||
            !live.beachTemplateOrigin || !template)
            return 0;

        var originX = Math.round(live.beachTemplateOrigin.x);
        var originY = Math.round(live.beachTemplateOrigin.y);
        var croppedRows = Math.max(0, Math.min(
            template.rows.length - 1,
            Math.round(live.beachCropRows || 0)
        ));
        var layers = pContext.Layers || {};
        var changed = 0;

        for(var row = croppedRows; row < template.rows.length; ++row) {
            var start = template.starts[row];
            for(var column = start; column < template.rows[row].length; ++column) {
                var x = originX + column;
                var y = originY + row - croppedRows;
                var tileId = template.rows[row][column];
                // The source cove's two-cell diagonal jog relies on context
                // outside the copied block. Its 260/283 bank pair reads as
                // two detached triangular river pieces here. Keep the water
                // connected down the edge, leave the two dry cells to generic
                // grass smoothing, and resume the authored widening below.
                if((row === 6 || row === 7) && column < 15)
                    continue;
                if((row === 6 || row === 7) && column === 15)
                    tileId = ((row + pContext.Seed) & 1) ? 297 : 298;
                var authoredTerrain = MapGen.Layers.Get(layers.water, x, y, 0) ||
                    MapGen.Layers.Get(layers.coast, x, y, 0);

                if(!MapGen.Layers.InBounds(pTiles, x, y) ||
                    MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                    (!authoredTerrain && MapGen.Layers.Get(layers.path, x, y, 0)) ||
                    MapGen.Layers.Get(layers.structureGround, x, y, 0))
                    continue;
                if(MapGen.Layers.Get(pTiles, x, y, -1) === tileId)
                    continue;

                MapGen.Layers.Set(pTiles, x, y, tileId);
                ++changed;
            }
        }

        return changed;
    };

    pJungle.StampSub1Mapm5TopBankTiles = function(pContext, pTiles) {
        var live = pContext && pContext.GrammarLiveTerrain ? pContext.GrammarLiveTerrain : null;
        var beachData = MapGen.Terrain.Smoothing.JungleBeach;
        var template = beachData && beachData.Mapm5TopBankTileTemplate ?
            beachData.Mapm5TopBankTileTemplate() : null;
        var continuation = beachData && beachData.Mapm5RiverContinuationTileTemplate ?
            beachData.Mapm5RiverContinuationTileTemplate() : null;

        if(!live || live.beachTemplate !== "mapm5_top_bank" ||
            !live.beachTemplateOrigin || !template || !continuation)
            return 0;

        var originX = Math.round(live.beachTemplateOrigin.x);
        var originY = Math.round(live.beachTemplateOrigin.y);
        var layers = pContext.Layers || {};
        var changed = 0;
        var rowPlan = live.beachTemplateRows && live.beachTemplateRows.length ?
            live.beachTemplateRows : null;
        var riverRowPlan = live.beachRiverRows && live.beachRiverRows.length ?
            live.beachRiverRows : null;
        var riverSpans = live.beachRiverSpans && live.beachRiverSpans.length ?
            live.beachRiverSpans : null;
        var beachRows = rowPlan ? rowPlan.length : template.rows.length;
        var riverStartY = originY + beachRows;

        for(var row = 0; row < beachRows; ++row) {
            var rowSpec = template.rows[rowPlan ? rowPlan[row] : row];
            for(var index = 0; index < rowSpec.tiles.length; ++index) {
                var x = originX + rowSpec.x + index;
                var y = originY + row;
                var tileId = rowSpec.tiles[index];
                var cls = rowSpec.classes.charAt(index);
                var terrainIntact = cls === "W" ?
                    MapGen.Layers.Get(layers.water, x, y, 0) :
                    (cls === "S" ? MapGen.Layers.Get(layers.coast, x, y, 0) : true);

                var beachWade = this.IsGrammarBeachMapm5WadeCell(pContext, x, y);
                if(!terrainIntact || !MapGen.Layers.InBounds(pTiles, x, y) ||
                    (!beachWade && MapGen.Layers.Get(layers.path, x, y, 0)) ||
                    (!beachWade && MapGen.Layers.Get(layers.crossing, x, y, 0)) ||
                    MapGen.Layers.Get(layers.occupied, x, y, 0) ||
                    MapGen.Layers.Get(layers.structureGround, x, y, 0))
                    continue;
                if(MapGen.Layers.Get(pTiles, x, y, -1) === tileId)
                    continue;

                MapGen.Layers.Set(pTiles, x, y, tileId);
                ++changed;
            }
        }

        var reconstructedLeftBanks = {
            "1,0": 282,
            "0,1": 283,
            "-1,0": 260,
            "0,-1": 300,
            // Consecutive diagonal moves and one-row reversals occur once the
            // source course is stretched. Use complete phrases observed in
            // mapm5; neutralise the otherwise unsupported out-and-back cell
            // with the atlas' straight left bank instead of a corner spike.
            "1,1": 342,
            "-1,-1": 264,
            "-1,1": 244,
            "1,-1": 280
        };
        var reconstructedRightBanks = {
            "1,0": 364,
            // Source-contiguous move/hold phrases use 384 here. 323 is the
            // following cap in a different turn; pairing 381 -> 323 created
            // the repeated inward-pointing triangles visible on generated
            // mapm5 courses.
            "0,1": 384,
            "-1,0": 362,
            "0,-1": 382,
            "1,1": 323,
            "-1,-1": 341,
            // mapm5 has no authored one-row right-bank reversal. Tile 380 is
            // its clean vertical shoreline, so it rounds the semantic blip
            // without inventing an unmatched triangular cap.
            "-1,1": 380,
            "1,-1": 380
        };
        var reconstructedLeftStraightCycle = [301, 302, 280];
        var reconstructedRightStraightCycle = [362, 381, 384];

        function stampReconstructedBank(pX, pY, pTileId) {
            if(pTileId === undefined ||
                !MapGen.Layers.InBounds(pTiles, pX, pY) ||
                MapGen.Layers.Get(layers.path, pX, pY, 0) ||
                MapGen.Layers.Get(layers.crossing, pX, pY, 0) ||
                MapGen.Layers.Get(layers.occupied, pX, pY, 0) ||
                MapGen.Layers.Get(layers.structureGround, pX, pY, 0) ||
                MapGen.Layers.Get(pTiles, pX, pY, -1) === pTileId)
                return;
            MapGen.Layers.Set(pTiles, pX, pY, pTileId);
            ++changed;
        }

        for(var riverY = Math.max(0, riverStartY); riverY < pContext.Height; ++riverY) {
            var riverOffset = riverY - riverStartY;
            var riverSpan = riverSpans ? riverSpans[riverOffset] : null;
            // `authored` and riverRowPlan describe where the semantic source
            // mask originated, not a legal exact-tile phrase after the course
            // is shifted, repeated, widened or narrowed. Even an individually
            // matching row can have generated neighbours that form a different
            // bend. Always smooth the procedural continuation against its real
            // spans; exact authored tiles remain confined to the beach/top
            // motif above this loop.
            if(riverSpan) {
                var previousSpan = riverOffset > 0 ?
                    riverSpans[riverOffset - 1] : riverSpan;
                var nextSpan = riverOffset + 1 < riverSpans.length ?
                    riverSpans[riverOffset + 1] : riverSpan;
                var leftKey = (riverSpan.minX - previousSpan.minX) + "," +
                    (nextSpan.minX - riverSpan.minX);
                var rightKey = (riverSpan.maxX - previousSpan.maxX) + "," +
                    (nextSpan.maxX - riverSpan.maxX);
                var leftTile = leftKey === "0,0" ?
                    reconstructedLeftStraightCycle[
                        riverOffset % reconstructedLeftStraightCycle.length
                    ] : reconstructedLeftBanks[leftKey];
                var rightTile = rightKey === "0,0" ?
                    reconstructedRightStraightCycle[
                        riverOffset % reconstructedRightStraightCycle.length
                    ] : reconstructedRightBanks[rightKey];
                stampReconstructedBank(
                    riverSpan.minX - 1,
                    riverY,
                    leftTile
                );
                stampReconstructedBank(
                    riverSpan.maxX + 1,
                    riverY,
                    rightTile
                );
                continue;
            }
            var continuationIndex = riverRowPlan ?
                riverRowPlan[riverOffset] :
                Math.min(continuation.rows.length - 1, riverOffset);
            var continuationRow = continuation.rows[continuationIndex];
            for(var riverIndex = 0; riverIndex < continuationRow.tiles.length; ++riverIndex) {
                var riverX = originX + continuationRow.x + riverIndex;
                var riverTile = continuationRow.tiles[riverIndex];
                var riverClass = continuationRow.classes.charAt(riverIndex);
                var riverIntact = riverClass === "W" ?
                    MapGen.Layers.Get(layers.water, riverX, riverY, 0) : true;

                var riverWade = this.IsGrammarBeachMapm5WadeCell(pContext, riverX, riverY);
                if(!riverIntact || !MapGen.Layers.InBounds(pTiles, riverX, riverY) ||
                    (!riverWade && MapGen.Layers.Get(layers.path, riverX, riverY, 0)) ||
                    (!riverWade && MapGen.Layers.Get(layers.crossing, riverX, riverY, 0)) ||
                    MapGen.Layers.Get(layers.occupied, riverX, riverY, 0) ||
                    MapGen.Layers.Get(layers.structureGround, riverX, riverY, 0))
                    continue;
                if(MapGen.Layers.Get(pTiles, riverX, riverY, -1) === riverTile)
                    continue;

                MapGen.Layers.Set(pTiles, riverX, riverY, riverTile);
                ++changed;
            }
        }

        return changed;
    };

    pJungle.StampSub1Mapm6ChannelBankTiles = function(pContext, pTiles) {
        var live = pContext && pContext.GrammarLiveTerrain ? pContext.GrammarLiveTerrain : null;
        if(!live || live.beachTemplate !== "mapm6_bridge_channel" ||
            live.beachChannelTop === undefined ||
            live.beachChannelBottom === undefined)
            return 0;

        // These cycles are contiguous bridge-free phrases from the shipped
        // mapm6 banks. Their wrap pairs also occur in that source, allowing a
        // long generated channel to retain pixel-level shoreline movement
        // without falling back to one repeated triangular edge tile.
        var upperCycle = [321, 241, 243, 320, 261, 262, 242, 242, 321, 241, 262, 242];
        // 303/304 are the atlas' genuinely shallow lower-bank pair (and occur
        // contiguously in mapm6). The old 343/361/342/360 cycle is a complete
        // down-and-up turn, so repeating it made every few cells into a sharp
        // tooth rather than a straight bank with natural pixel variation.
        var lowerCycle = [303, 304, 303, 303, 304];
        var layers = pContext.Layers || {};
        var topByX = live.beachChannelTopByX || null;
        var bottomByX = live.beachChannelBottomByX || null;
        var changed = 0;

        function isProtected(pX, pY) {
            return MapGen.Layers.Get(layers.crossing, pX, pY, 0) ||
                MapGen.Layers.Get(layers.occupied, pX, pY, 0) ||
                MapGen.Layers.Get(layers.structureGround, pX, pY, 0);
        }

        function bankYAt(pRows, pFallback, pX, pOutside) {
            var row = pRows && pRows[pX] !== undefined ? pRows[pX] : pFallback;
            return Math.round(row) + pOutside;
        }

        // The generic smoother paints both sides of a shore. Restore the
        // channel's background before its one-row authored banks, otherwise
        // leftover corners protrude beneath bridge ends or into the water.
        var riverTiles = this.Sub1EdgeData().river.tiles;
        for(var clearX = 0; clearX < pContext.Width; ++clearX) {
            var clearTop = bankYAt(topByX, live.beachChannelTop, clearX, -2);
            var clearBottom = bankYAt(bottomByX, live.beachChannelBottom, clearX, 2);
            for(var clearY = Math.max(0, clearTop); clearY <= Math.min(pContext.Height - 1, clearBottom); ++clearY) {
                var current = MapGen.Layers.Get(pTiles, clearX, clearY, -1);
                var record = riverTiles[String(current)];
                if(!record || isProtected(clearX, clearY))
                    continue;
                var materials = record.edges.N + record.edges.E + record.edges.S + record.edges.W;
                var water = MapGen.Layers.Get(layers.water, clearX, clearY, 0);
                if(materials.indexOf("W") < 0 || (water && !/[^W.]/.test(materials)))
                    continue;
                var background = water ?
                    297 + (MapGen.Random.HashTile(pContext.Seed, clearX, clearY, 7549) & 1) :
                    this.Sub1DarkGrassFloorTile(pContext, clearX, clearY);
                if(current !== background) {
                    MapGen.Layers.Set(pTiles, clearX, clearY, background);
                    ++changed;
                }
            }
        }

        function stampStraightRuns(pRows, pFallback, pOutside, pCycle, pSalt) {
            var runX = 0;
            while(runX < pContext.Width) {
                var bankY = bankYAt(pRows, pFallback, runX, pOutside);
                var runStart = runX;
                while(runX < pContext.Width &&
                    bankYAt(pRows, pFallback, runX, pOutside) === bankY)
                    ++runX;
                var runEnd = runX - 1;

                var phase = MapGen.Random.HashTile(
                    pContext.Seed,
                    runStart,
                    bankY,
                    pSalt
                ) % pCycle.length;
                for(var paintX = runStart; paintX <= runEnd; ++paintX) {
                    // A building buffer may have moved this shoreline. Do
                    // not overwrite its freshly smoothed bank with stale art.
                    if(!MapGen.Layers.Get(layers.water, paintX, bankY - pOutside, 0) ||
                        MapGen.Layers.Get(layers.water, paintX, bankY + pOutside, 0) ||
                        isProtected(paintX, bankY))
                        continue;
                    var tileId = pCycle[(phase + paintX - runStart) % pCycle.length];
                    if(MapGen.Layers.Get(pTiles, paintX, bankY, -1) === tileId)
                        continue;
                    MapGen.Layers.Set(pTiles, paintX, bankY, tileId);
                    ++changed;
                }
            }
        }

        function stampTransitions(pRows, pFallback, pOutside, pIncreasingTile, pDecreasingTile) {
            for(var transitionX = 1; transitionX < pContext.Width; ++transitionX) {
                var previousRow = pRows && pRows[transitionX - 1] !== undefined ?
                    Math.round(pRows[transitionX - 1]) : Math.round(pFallback);
                var currentRow = pRows && pRows[transitionX] !== undefined ?
                    Math.round(pRows[transitionX]) : Math.round(pFallback);
                var delta = currentRow - previousRow;
                if(!delta)
                    continue;

                // A one-cell shoreline step has one actual diagonal cell and
                // one ordinary shelf cell. The old implementation left both
                // to the generic matcher, which selected little corner tiles
                // and turned long slopes into a row of triangular teeth.
                // These four placements are the matching diagonal river tiles
                // from junsub1: choose the old shelf when the water expands,
                // and the new shelf when it contracts (mirrored for the upper
                // and lower banks via the supplied tile pair).
                var useCurrentShelf = (delta > 0) === (pOutside < 0);
                var stampX = useCurrentShelf ? transitionX : transitionX - 1;
                var stampRow = useCurrentShelf ? currentRow : previousRow;
                var transitionTile = delta > 0 ? pIncreasingTile : pDecreasingTile;
                var stampY = stampRow + pOutside;
                if(Math.abs(delta) !== 1 ||
                    !MapGen.Layers.Get(layers.water, stampX, stampY - pOutside, 0) ||
                    isProtected(stampX, stampY))
                    continue;
                if(MapGen.Layers.Get(pTiles, stampX, stampY, -1) === transitionTile)
                    continue;
                MapGen.Layers.Set(pTiles, stampX, stampY, transitionTile);
                ++changed;
            }
        }

        stampStraightRuns(topByX, live.beachChannelTop, -1, upperCycle, 7541);
        stampStraightRuns(bottomByX, live.beachChannelBottom, 1, lowerCycle, 7547);
        // Upper bank: 323 descends right, 243 rises right. Lower bank is the
        // vertical mirror: 342 descends right, 341 rises right.
        stampTransitions(topByX, live.beachChannelTop, -1, 323, 243);
        stampTransitions(bottomByX, live.beachChannelBottom, 1, 342, 341);
        return changed;
    };

    pJungle.StampSub1Mapm5WadeWaterTiles = function(pContext, pTiles) {
        var live = pContext && pContext.GrammarLiveTerrain ?
            pContext.GrammarLiveTerrain : null;
        if(!pContext || !pTiles || !live ||
            live.beachTemplate !== "mapm5_top_bank")
            return 0;

        var crossings = pContext.Crossings || [];
        var waterTiles = [297, 298];
        var riverSpans = live.beachRiverSpans || [];
        var beachRows = live.beachTemplateRows || [];
        var riverStartY = live.beachTemplateOrigin ?
            Math.round(live.beachTemplateOrigin.y) + beachRows.length : -1;
        var changed = 0;
        for(var index = 0; index < crossings.length; ++index) {
            var crossing = crossings[index];
            if(!crossing || crossing.role !== "grammar_beach_mapm5_wade" ||
                crossing.axis !== "horizontal")
                continue;

            var halfWidth = Math.max(1, Math.floor(crossing.halfWidth || 1));
            for(var dy = -halfWidth; dy <= halfWidth; ++dy) {
                var y = crossing.y + dy;
                var riverOffset = riverStartY >= 0 ? y - riverStartY : -1;
                var rowSpan = riverOffset >= 0 && riverOffset < riverSpans.length ?
                    riverSpans[riverOffset] : null;
                var waterMinX = Number(crossing.waterMinX);
                var waterMaxX = Number(crossing.waterMaxX);

                // A sloped bank can be narrower on either side of the centre
                // crossing row. Repainting all three rows to the centre span
                // produced a rectangular water lip through the shoreline.
                // The live span survives generic crossing/path materialisation,
                // so use it as the intended water footprint for each row.
                if(rowSpan) {
                    // The first and last water cells carry the bank pixels in
                    // the sub1 atlas. They were already restored by the
                    // authored/generic edge pass above; replacing them with a
                    // 297/298 centre tile creates a rectangular bite in both
                    // banks. Only hide crossing art in the water interior.
                    waterMinX = Math.max(waterMinX, Number(rowSpan.minX) + 1);
                    waterMaxX = Math.min(waterMaxX, Number(rowSpan.maxX) - 1);
                }

                for(var x = waterMinX; x <= waterMaxX; ++x) {
                    if(!MapGen.Layers.InBounds(pTiles, x, y) ||
                        (!rowSpan && !MapGen.Layers.Get(pContext.Layers.water, x, y, 0)) ||
                        MapGen.Layers.Get(pContext.Layers.structureGround, x, y, 0))
                        continue;

                    var tileId = waterTiles[MapGen.Random.HashTile(pContext.Seed, x, y, 3563) % waterTiles.length];
                    if(MapGen.Layers.Get(pTiles, x, y, -1) !== tileId) {
                        MapGen.Layers.Set(pTiles, x, y, tileId);
                        ++changed;
                    }
                }
            }
        }

        return changed;
    };

    pJungle.StampSub1AuthoredQuicksandPatchTiles = function(pContext, pTiles, pDropDamaged) {
        var live = pContext && pContext.GrammarLiveTerrain ? pContext.GrammarLiveTerrain : null;
        var quicksand = live && live.quicksand ? live.quicksand : null;
        var patchList = quicksand && quicksand.authoredTemplates === true ? quicksand.patches || [] : [];
        var beachData = MapGen.Terrain.Smoothing.JungleBeach;
        var templates = beachData && beachData.QuicksandPatchTemplates ?
            beachData.QuicksandPatchTemplates() : [];
        var byId = {};
        var layers = pContext ? pContext.Layers || {} : {};
        var changed = 0;
        var quicksandTiles = this.Sub1EdgeData().quicksand.tiles;

        for(var templateIndex = 0; templateIndex < templates.length; ++templateIndex)
            byId[templates[templateIndex].id] = templates[templateIndex];

        for(var patchIndex = 0; patchIndex < patchList.length; ++patchIndex) {
            var patch = patchList[patchIndex];
            var template = byId[patch.template];
            var origin = patch.origin;
            var core = patch.core || [];
            var support = patch.support && patch.support.length ? patch.support : core;
            var intact = !!(template && origin);

            // A cleared core or a claimed outline damages the whole authored
            // motif. Grass-centre contour tiles still contain quicksand pixels;
            // skipping just those cells leaves a visibly cut patch.
            for(var coreIndex = 0; intact && coreIndex < core.length; ++coreIndex)
                if(!MapGen.Layers.Get(layers.riverBank, core[coreIndex].x, core[coreIndex].y, 0))
                    intact = false;
            for(var supportIndex = 0; intact && supportIndex < support.length; ++supportIndex) {
                var cell = support[supportIndex];
                if(MapGen.Layers.Get(layers.path, cell.x, cell.y, 0) ||
                    MapGen.Layers.Get(layers.crossing, cell.x, cell.y, 0) ||
                    MapGen.Layers.Get(layers.occupied, cell.x, cell.y, 0) ||
                    MapGen.Layers.Get(layers.structureGround, cell.x, cell.y, 0))
                    intact = false;
            }

            if(!intact) {
                if(!pDropDamaged)
                    continue;

                // Remove every unclaimed remnant. A dropped patch becomes
                // ordinary grass around the winning route/object, rather than
                // falling back to individually smoothed quicksand fragments.
                var cleanupCells = support.slice(0);
                if(template && origin) {
                    for(var holeY = 0; holeY < template.rows.length; ++holeY)
                        for(var holeX = 0; holeX < template.rows[holeY].length; ++holeX) {
                            if(template.rows[holeY][holeX] !== null)
                                continue;
                            var hole = quicksandTiles[String(MapGen.Layers.Get(pTiles, origin.x + holeX, origin.y + holeY, -1))];
                            if(hole && (hole.edges.N + hole.edges.E + hole.edges.S + hole.edges.W).indexOf("Q") >= 0)
                                cleanupCells.push({x:origin.x + holeX, y:origin.y + holeY});
                        }
                }
                for(var cleanupIndex = 0; cleanupIndex < cleanupCells.length; ++cleanupIndex) {
                    var cleanupCell = cleanupCells[cleanupIndex];
                    if(!MapGen.Layers.InBounds(pTiles, cleanupCell.x, cleanupCell.y) ||
                        MapGen.Layers.Get(layers.path, cleanupCell.x, cleanupCell.y, 0) ||
                        MapGen.Layers.Get(layers.crossing, cleanupCell.x, cleanupCell.y, 0) ||
                        MapGen.Layers.Get(layers.occupied, cleanupCell.x, cleanupCell.y, 0) ||
                        MapGen.Layers.Get(layers.structureGround, cleanupCell.x, cleanupCell.y, 0))
                        continue;

                    var grassTile = this.Sub1DarkGrassFloorTile(
                        pContext,
                        cleanupCell.x,
                        cleanupCell.y
                    );
                    MapGen.Layers.Set(layers.riverBank, cleanupCell.x, cleanupCell.y, 0);
                    if(MapGen.Layers.Get(pTiles, cleanupCell.x, cleanupCell.y, -1) !== grassTile) {
                        MapGen.Layers.Set(pTiles, cleanupCell.x, cleanupCell.y, grassTile);
                        ++changed;
                    }
                }
                continue;
            }

            for(var row = 0; row < template.rows.length; ++row) {
                for(var column = 0; column < template.rows[row].length; ++column) {
                    var tileId = template.rows[row][column];
                    var x = origin.x + column;
                    var y = origin.y + row;
                    if(!MapGen.Layers.InBounds(pTiles, x, y) ||
                        MapGen.Layers.Get(layers.path, x, y, 0) ||
                        MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                        MapGen.Layers.Get(layers.occupied, x, y, 0) ||
                        MapGen.Layers.Get(layers.structureGround, x, y, 0))
                        continue;
                    if(tileId === null) {
                        // The generic edge pass can invent a quicksand corner
                        // in an authored hole, facing the grass edges of the
                        // exact contour. Preserve unrelated background tiles,
                        // but remove these extra quicksand fragments.
                        var current = quicksandTiles[String(MapGen.Layers.Get(pTiles, x, y, -1))];
                        if(!current || (current.edges.N + current.edges.E +
                            current.edges.S + current.edges.W).indexOf("Q") < 0)
                            continue;
                        tileId = this.Sub1DarkGrassFloorTile(pContext, x, y);
                    }
                    if(MapGen.Layers.Get(pTiles, x, y, -1) === tileId)
                        continue;

                    MapGen.Layers.Set(pTiles, x, y, tileId);
                    ++changed;
                }
            }
        }

        return changed;
    };
})(MapGen.Terrain.Smoothing.Jungle);
