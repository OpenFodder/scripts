var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};
MapGen.Terrain.Smoothing.Jungle = MapGen.Terrain.Smoothing.Jungle || {};

(function(pJungle) {
    pJungle.Sub1RecordLookup = function(pData) {
        var lookup = {};
        var features = ["beach", "river", "quicksand"];

        for(var featureIndex = 0; featureIndex < features.length; ++featureIndex) {
            var group = pData[features[featureIndex]];
            if(!group || !group.tiles)
                continue;
            for(var tid in group.tiles) {
                if(group.tiles.hasOwnProperty(tid))
                    lookup[tid] = group.tiles[tid];
            }
        }

        return lookup;
    };

    pJungle.Sub1GrammarBeachDryGrassEdgeMasks = function() {
        return {
            252: { GSGG: true, GSSG: true },
            255: { GSSG: true },
            272: { GSSG: true, GSGG: true },
            335: { GSGG: true }
        };
    };

    pJungle.Sub1ClassMaskAt = function(pContext, pChars, pX, pY, pFeature, pClass) {
        var offsets = [
            [0, -1],
            [1, 0],
            [0, 1],
            [-1, 0]
        ];
        var mask = "";

        for(var index = 0; index < offsets.length; ++index) {
            mask += this.Sub1GlyphForClass(this.Sub1ClassAtOrSelf(
                pContext,
                pChars,
                pX + offsets[index][0],
                pY + offsets[index][1],
                pFeature,
                pClass
            ));
        }

        return mask;
    };

    pJungle.Sub1GrammarBeachDryGrassEdgeFits = function(pContext, pChars, pX, pY, pFeature, pCurrentClass, pTileId) {
        if(pFeature !== "beach" ||
            this.Sub1NormalizedClass(pCurrentClass) !== "darkgrass")
            return false;

        var tileMasks = this.Sub1GrammarBeachDryGrassEdgeMasks()[pTileId];
        if(!tileMasks)
            return false;

        var mask = this.Sub1ClassMaskAt(pContext, pChars, pX, pY, pFeature, pCurrentClass);
        return !!tileMasks[mask];
    };

    pJungle.CanRetileSub1BeachDryGrassEdgeCell = function(pContext, pX, pY) {
        var layers = pContext.Layers || {};

        return !MapGen.Layers.Get(layers.crossing, pX, pY, 0) &&
            !MapGen.Layers.Get(layers.path, pX, pY, 0) &&
            !MapGen.Layers.Get(layers.structureGround, pX, pY, 0);
    };

    pJungle.Sub1GrammarBeachDryGrassEdgeTileForMask = function(pContext, pX, pY, pMask, pNorthTile, pEastTile) {
        if(pMask === "GSGG") {
            if(pEastTile === 258 || pEastTile === 279)
                return 335;
            if(pNorthTile === 252)
                return 272;
            if(pNorthTile === 272)
                return 252;
            return 252;
        }

        if(pMask === "GSSG") {
            if(pNorthTile === 252)
                return 272;
            if(pNorthTile === 272)
                return 255;
            var roll = MapGen.Random.HashTile(pContext.Seed, pX, pY, 7283) % 3;
            if(roll === 0)
                return 252;
            if(roll === 1)
                return 272;
            return 255;
        }

        return -1;
    };

    pJungle.Sub1BeachTileMaskClass = function(pLookup, pTileId) {
        if(pTileId === 324)
            return "S";

        var rec = pLookup ? pLookup[String(pTileId)] : null;
        if(rec && rec.smoothing === "excluded")
            return "G";

        var center = rec ? this.Sub1NormalizedClass(rec.center) : "";

        if(center === "sand")
            return "S";
        if(center === "water")
            return "W";

        return "G";
    };

    pJungle.Sub1BeachTileClassMaskAt = function(pLookup, pTiles, pX, pY) {
        var offsets = [
            [0, -1],
            [1, 0],
            [0, 1],
            [-1, 0]
        ];
        var mask = "";

        for(var index = 0; index < offsets.length; ++index) {
            var x = pX + offsets[index][0];
            var y = pY + offsets[index][1];
            var tileId = MapGen.Layers.Get(pTiles, x, y, -1);
            mask += this.Sub1BeachTileMaskClass(pLookup, tileId);
        }

        return mask;
    };

    pJungle.Sub1LightGrassTiles = function() {
        if(this._Sub1LightGrassTiles)
            return this._Sub1LightGrassTiles;

        var tiles = {
            0: true,
            20: true,
            40: true
        };
        var data = this.Data();
        var entries = data && data.lightgrassDarkgrass ? data.lightgrassDarkgrass.bitmask : null;

        if(entries) {
            for(var entryIndex = 0; entryIndex < entries.length; ++entryIndex) {
                var entryTiles = entries[entryIndex].tiles || [];
                for(var tileIndex = 0; tileIndex < entryTiles.length; ++tileIndex) {
                    var tileId = Number(entryTiles[tileIndex].tile);
                    if(!isNaN(tileId))
                        tiles[tileId] = true;
                }
            }
        }

        this._Sub1LightGrassTiles = tiles;
        return tiles;
    };

    pJungle.Sub1IsLightGrassTile = function(pTileId) {
        return !!this.Sub1LightGrassTiles()[Number(pTileId) & 0x1FF];
    };

    pJungle.Sub1DarkGrassFloorTile = function(pContext, pX, pY) {
        return (MapGen.Random.HashTile(pContext.Seed, pX, pY, 7319) & 1) ? 123 : 124;
    };

    pJungle.Sub1FindBeachGrassContourSegments = function(pLookup, pTiles, pDirection) {
        var delta = this.Sub1ContourDelta(pDirection);
        var verticalScan = pDirection === "E" || pDirection === "W";
        var scanLimit = verticalScan ? pTiles[0].length : pTiles.length;
        var lineLimit = verticalScan ? pTiles.length : pTiles[0].length;
        var entries = [];
        var segments = [];
        var current = [];

        for(var scan = 0; scan < scanLimit; ++scan) {
            var found = false;
            var best = null;
            var bestCoord = 0;

            for(var line = 0; line < lineLimit; ++line) {
                var x = verticalScan ? line : scan;
                var y = verticalScan ? scan : line;
                var sandTile = MapGen.Layers.Get(pTiles, x, y, -1);
                var grassTile = MapGen.Layers.Get(pTiles, x + delta.x, y + delta.y, -1);

                if(this.Sub1BeachTileMaskClass(pLookup, sandTile) !== "S" ||
                    this.Sub1BeachTileMaskClass(pLookup, grassTile) !== "G")
                    continue;

                var coord = verticalScan ? x : y;
                if(!found ||
                    ((pDirection === "E" || pDirection === "S") && coord > bestCoord) ||
                    ((pDirection === "W" || pDirection === "N") && coord < bestCoord)) {
                    bestCoord = coord;
                    best = {
                        scan: scan,
                        sandX: x,
                        sandY: y,
                        grassX: x + delta.x,
                        grassY: y + delta.y
                    };
                    found = true;
                }
            }

            if(found)
                entries.push(best);
        }

        for(var index = 0; index < entries.length; ++index) {
            if(current.length && entries[index].scan !== current[current.length - 1].scan + 1) {
                segments.push(current);
                current = [];
            }
            current.push(entries[index]);
        }

        if(current.length)
            segments.push(current);

        return segments;
    };

    pJungle.Sub1GrammarBeachGrassEdgePattern = function() {
        return [
            { side: "G", tile: 252 },
            { side: "S", tile: 292 },
            { side: "G", tile: 255 },
            { side: "S", tile: 277 },
            { side: "G", tile: 252 },
            { side: "G", tile: 272 },
            { side: "S", tile: 292 },
            { side: "G", tile: 255 },
            { side: "G", tile: 255 },
            { side: "S", tile: 277 },
            { side: "G", tile: 252 },
            { side: "G", tile: 272 },
            { side: "S", tile: 292 },
            { side: "G", tile: 252 },
            { side: "G", tile: 272 },
            { side: "G", tile: 272 },
            { side: "S", tile: 292 },
            { side: "G", tile: 335 }
        ];
    };

    pJungle.Sub1GrammarBeachGrassEdgePatternEntry = function(pIndex, pLength) {
        var pattern = this.Sub1GrammarBeachGrassEdgePattern();
        var maxIndex = Math.max(1, pLength - 1);
        var patternIndex = Math.round((Math.max(0, Math.min(maxIndex, pIndex)) / maxIndex) * (pattern.length - 1));

        return pattern[Math.max(0, Math.min(pattern.length - 1, patternIndex))];
    };

    pJungle.Sub1GrammarBeachBankTileTemplates = function() {
        return [
            { left: [123, 252], sand: [257, 256, 256, 258], water: [278, 297, 297] },
            { left: [365, 124], sand: [292, 256, 257, 293], water: [297, 297, 297] },
            { left: [124, 255], sand: [257, 257, 256, 295], water: [298, 298, 298] },
            { left: [124, 275], sand: [277, 257, 256, 258], water: [278, 297, 298] },
            { left: [128, 252], sand: [257, 257, 257, 293], water: [297, 298, 297] },
            { left: [124, 272], sand: [257, 257, 257, 294], water: [297, 297, 297] },
            { left: [366, 124], sand: [292, 257, 257, 257, 295], water: [297, 297, 298] },
            { left: [128, 255], sand: [257, 256, 257, 279], water: [297, 297, 298] },
            { left: [124, 255], sand: [257, 257, 257, 293], water: [297, 298, 298] },
            { left: [275, 276], sand: [277, 257, 256, 257, 257, 294], water: [297, 297, 297] },
            { left: [45, 252], sand: [257, 257, 257, 257, 257, 256, 257, 295], water: [297, 298, 298] },
            { left: [65, 272], sand: [257, 257, 324, 256, 257, 258], water: [278, 297, 298] },
            { left: [203, 85], sand: [292, 257, 256, 256, 257, 279], water: [297, 298, 298] },
            { left: [223, 252], sand: [257, 256, 257, 257, 279], water: [297, 297, 297] },
            { left: [366, 272], sand: [256, 257, 258], water: [278, 297, 297] },
            { left: [87, 272], sand: [256, 279], water: [297, 297, 298] },
            { left: [123, 123], sand: [292, 279], water: [297, 297, 298] },
            { left: [87, 335], sand: [279], water: [297, 297, 298] }
        ];
    };

    pJungle.Sub1GrammarBeachWaterEdgeTileTemplates = function() {
        return MapGen.Terrain.Smoothing.JungleBeach.WaterEdgeTemplates();
    };

    pJungle.StampSub1GrammarBeachWaterEdgeTemplateTiles = function(pContext, pTiles, pLookup) {
        if(!this.IsGrammarBeachProfile(pContext))
            return 0;

        var live = pContext && pContext.GrammarLiveTerrain ? pContext.GrammarLiveTerrain : null;
        if(live && (live.beachTemplate === "joined_east_coast" ||
            live.beachTemplate === "joined_south_coast"))
            return 0;

        var waterDirection = this.Sub1GrammarBeachContourDirection(pContext);
        if(waterDirection !== "E")
            return 0;

        var core = MapGen.Terrain.Smoothing.Core;
        var templates = this.Sub1GrammarBeachWaterEdgeTileTemplates();
        var bankIds = {};
        var topY = -1;
        var anchor = 0;
        var changed = 0;

        for(var templateId = 0; templateId < templates.length; ++templateId) {
            for(var sandId = 0; sandId < templates[templateId].sand.length; ++sandId)
                bankIds[templates[templateId].sand[sandId]] = true;
        }

        function rowMatchesTemplate(pRowY, pTemplate, pEndX) {
            var startX = pEndX - pTemplate.sand.length + 1;
            if(pRowY < 0 || pRowY >= pContext.Height || startX < 0)
                return false;

            for(var index = 0; index < pTemplate.sand.length; ++index) {
                if(MapGen.Layers.Get(pTiles, startX + index, pRowY, -1) !== pTemplate.sand[index])
                    return false;
            }

            return true;
        }

        for(var y = 0; y < pContext.Height - 1 && topY < 0; ++y) {
            var topTemplate = templates[0];
            for(var x = 0; x <= pContext.Width - topTemplate.sand.length; ++x) {
                var topEndX = x + topTemplate.sand.length - 1;
                if(!rowMatchesTemplate(y, topTemplate, topEndX))
                    continue;
                if(!rowMatchesTemplate(y + 1, templates[1], topEndX + templates[1].offset - topTemplate.offset))
                    continue;

                topY = y;
                anchor = topEndX - topTemplate.offset;
                break;
            }
        }

        if(topY < 0)
            return 0;

        for(var index = 5; index < templates.length; ++index) {
            var template = templates[index];
            var rowY = topY + index;
            if(rowY >= pContext.Height)
                break;

            var targetWaterX = anchor + template.offset;
            var startX = targetWaterX - template.sand.length + 1;
            var stampFullRow = index >= 9;
            var firstSandIndex = stampFullRow ? 0 : 1;
            var cleanupStartX = stampFullRow ?
                Math.max(0, startX - 2) :
                Math.min(pContext.Width - 1, targetWaterX + 1);
            var cleanupEndX = Math.min(pContext.Width - 1, targetWaterX + template.water.length);

            for(var cleanupX = cleanupStartX; cleanupX <= cleanupEndX; ++cleanupX) {
                if(cleanupX >= startX && cleanupX <= targetWaterX)
                    continue;
                if(!bankIds[MapGen.Layers.Get(pTiles, cleanupX, rowY, -1)] ||
                    !this.CanRetileSub1BeachDryGrassEdgeCell(pContext, cleanupX, rowY))
                    continue;

                core.SetTile(pTiles, cleanupX, rowY, cleanupX < startX ?
                    this.Sub1DarkGrassFloorTile(pContext, cleanupX, rowY) :
                    297);
                ++changed;
            }

            for(var sandIndex = firstSandIndex; sandIndex < template.sand.length; ++sandIndex) {
                var sandX = startX + sandIndex;
                if(!MapGen.Layers.InBounds(pTiles, sandX, rowY) ||
                    !this.CanRetileSub1BeachDryGrassEdgeCell(pContext, sandX, rowY) ||
                    MapGen.Layers.Get(pTiles, sandX, rowY, -1) === template.sand[sandIndex])
                    continue;

                core.SetTile(pTiles, sandX, rowY, template.sand[sandIndex]);
                ++changed;
            }

            for(var waterIndex = 0; waterIndex < template.water.length; ++waterIndex) {
                var waterX = targetWaterX + 1 + waterIndex;
                if(!MapGen.Layers.InBounds(pTiles, waterX, rowY) ||
                    !this.CanRetileSub1BeachDryGrassEdgeCell(pContext, waterX, rowY) ||
                    MapGen.Layers.Get(pTiles, waterX, rowY, -1) === template.water[waterIndex])
                    continue;

                core.SetTile(pTiles, waterX, rowY, template.water[waterIndex]);
                ++changed;
            }
        }

        return changed;
    };

    pJungle.Sub1IsGrammarBeachBankGrassTemplateTile = function(pTileId) {
        return pTileId === 252 || pTileId === 255 ||
            pTileId === 272 || pTileId === 275 ||
            pTileId === 276 || pTileId === 335;
    };

    pJungle.Sub1FindBeachTileSpanSegments = function(pLookup, pTiles, pWaterDirection) {
        var verticalScan = pWaterDirection === "E" || pWaterDirection === "W";
        var scanLimit = verticalScan ? pTiles[0].length : pTiles.length;
        var lineLimit = verticalScan ? pTiles.length : pTiles[0].length;
        var entries = [];
        var segments = [];
        var current = [];

        for(var scan = 0; scan < scanLimit; ++scan) {
            var minCoord = -1;
            var maxCoord = -1;

            for(var line = 0; line < lineLimit; ++line) {
                var x = verticalScan ? line : scan;
                var y = verticalScan ? scan : line;
                var tileId = MapGen.Layers.Get(pTiles, x, y, -1);

                if(this.Sub1BeachTileMaskClass(pLookup, tileId) !== "S")
                    continue;

                if(minCoord < 0)
                    minCoord = line;
                maxCoord = line;
            }

            if(minCoord < 0)
                continue;

            var hasWaterSide = false;
            for(var waterOffset = 1; waterOffset <= 3; ++waterOffset) {
                var waterX = verticalScan ? maxCoord + waterOffset : scan;
                var waterY = verticalScan ? scan : maxCoord + waterOffset;

                if(pWaterDirection === "W") {
                    waterX = minCoord - waterOffset;
                    waterY = scan;
                }
                else if(pWaterDirection === "N") {
                    waterX = scan;
                    waterY = minCoord - waterOffset;
                }

                if(this.Sub1BeachTileMaskClass(
                    pLookup,
                    MapGen.Layers.Get(pTiles, waterX, waterY, -1)
                ) === "W") {
                    hasWaterSide = true;
                    break;
                }
            }

            if(!hasWaterSide)
                continue;

            entries.push({
                scan: scan,
                grassCoord: (pWaterDirection === "E" || pWaterDirection === "S") ? minCoord : maxCoord,
                waterCoord: (pWaterDirection === "E" || pWaterDirection === "S") ? maxCoord : minCoord
            });
        }

        for(var index = 0; index < entries.length; ++index) {
            if(current.length && entries[index].scan !== current[current.length - 1].scan + 1) {
                segments.push(current);
                current = [];
            }
            current.push(entries[index]);
        }

        if(current.length)
            segments.push(current);

        return segments;
    };

    pJungle.StampSub1GrammarBeachBankTemplateTiles = function(pContext, pTiles, pLookup) {
        if(!this.IsGrammarBeachProfile(pContext))
            return 0;

        var live = pContext && pContext.GrammarLiveTerrain ? pContext.GrammarLiveTerrain : null;
        if(live && (live.beachTemplate === "joined_east_coast" ||
            live.beachTemplate === "joined_south_coast"))
            return 0;

        var waterDirection = this.Sub1GrammarBeachContourDirection(pContext);
        if(waterDirection !== "E")
            return 0;

        var core = MapGen.Terrain.Smoothing.Core;
        var templates = this.Sub1GrammarBeachBankTileTemplates();
        var segments = this.Sub1FindBeachTileSpanSegments(pLookup, pTiles, waterDirection);
        var entries = [];
        var changed = 0;

        for(var segmentIndex = 0; segmentIndex < segments.length; ++segmentIndex) {
            var segment = segments[segmentIndex];
            if(segment.length > entries.length)
                entries = segment;
        }

        if(entries.length < 8)
            return 0;

        var maxIndex = Math.max(1, entries.length - 1);

        for(var index = 0; index < entries.length; ++index) {
                var entry = entries[index];
                var templateIndex = Math.round((index / maxIndex) * (templates.length - 1));
                var template = templates[Math.max(0, Math.min(templates.length - 1, templateIndex))];
                var y = entry.scan;
                var leftX = entry.grassCoord;
                var immediateLeftTile = template.left[template.left.length - 1];
                var immediateLeftX = leftX - 1;

                for(var leftIndex = 0; leftIndex < template.left.length; ++leftIndex) {
                    var leftTile = template.left[leftIndex];
                    if(!this.Sub1IsGrammarBeachBankGrassTemplateTile(leftTile))
                        continue;

                    var gx = leftX - template.left.length + leftIndex;
                    if(!MapGen.Layers.InBounds(pTiles, gx, y))
                        continue;

                    if(MapGen.Layers.Get(pTiles, gx, y, -1) !== leftTile) {
                        core.SetTile(pTiles, gx, y, leftTile);
                        ++changed;
                    }
                }

                if(!this.Sub1IsGrammarBeachBankGrassTemplateTile(immediateLeftTile) &&
                    MapGen.Layers.InBounds(pTiles, immediateLeftX, y)) {
                    var currentLeft = MapGen.Layers.Get(pTiles, immediateLeftX, y, -1);
                    var plainLeft = (immediateLeftTile === 123 || immediateLeftTile === 124) ?
                        immediateLeftTile :
                        this.Sub1DarkGrassFloorTile(pContext, immediateLeftX, y);

                    if(currentLeft !== plainLeft) {
                        core.SetTile(pTiles, immediateLeftX, y, plainLeft);
                        ++changed;
                    }
                }

                if(index >= entries.length - 8) {
                    for(var sandIndex = 0; sandIndex < template.sand.length; ++sandIndex) {
                        var sandX = leftX + sandIndex;
                        if(!MapGen.Layers.InBounds(pTiles, sandX, y) ||
                            this.Sub1BeachTileMaskClass(pLookup, MapGen.Layers.Get(pTiles, sandX, y, -1)) !== "S")
                            continue;

                        if(MapGen.Layers.Get(pTiles, sandX, y, -1) !== template.sand[sandIndex]) {
                            core.SetTile(pTiles, sandX, y, template.sand[sandIndex]);
                            ++changed;
                        }
                    }

                    for(var excessSandIndex = template.sand.length; excessSandIndex <= entry.waterCoord - leftX; ++excessSandIndex) {
                        var excessSandX = leftX + excessSandIndex;
                        if(!MapGen.Layers.InBounds(pTiles, excessSandX, y) ||
                            this.Sub1BeachTileMaskClass(pLookup, MapGen.Layers.Get(pTiles, excessSandX, y, -1)) !== "S")
                            continue;

                        var excessWaterTile = template.water[Math.min(excessSandIndex - template.sand.length, template.water.length - 1)] || 297;
                        core.SetTile(pTiles, excessSandX, y, excessWaterTile);
                        ++changed;
                    }

                    for(var waterIndex = 0; waterIndex < template.water.length; ++waterIndex) {
                        var waterX = leftX + template.sand.length + waterIndex;
                        if(!MapGen.Layers.InBounds(pTiles, waterX, y) ||
                            this.Sub1BeachTileMaskClass(pLookup, MapGen.Layers.Get(pTiles, waterX, y, -1)) !== "W")
                            continue;

                        if(MapGen.Layers.Get(pTiles, waterX, y, -1) !== template.water[waterIndex]) {
                            core.SetTile(pTiles, waterX, y, template.water[waterIndex]);
                            ++changed;
                        }
                    }
                }

        }

        return changed;
    };

    pJungle.NormalizeSub1GrammarBeachBankLeftTemplateTiles = function(pContext, pTiles, pLookup) {
        if(!this.IsGrammarBeachProfile(pContext))
            return 0;

        var waterDirection = this.Sub1GrammarBeachContourDirection(pContext);
        if(waterDirection !== "E")
            return 0;

        var core = MapGen.Terrain.Smoothing.Core;
        var templates = this.Sub1GrammarBeachBankTileTemplates();
        var segments = this.Sub1FindBeachTileSpanSegments(pLookup, pTiles, waterDirection);
        var entries = [];
        var changed = 0;

        for(var segmentIndex = 0; segmentIndex < segments.length; ++segmentIndex) {
            var segment = segments[segmentIndex];
            if(segment.length > entries.length)
                entries = segment;
        }

        if(entries.length < 8)
            return 0;

        var maxIndex = Math.max(1, entries.length - 1);

        for(var index = 0; index < entries.length; ++index) {
            var entry = entries[index];
            var templateIndex = Math.round((index / maxIndex) * (templates.length - 1));
            var template = templates[Math.max(0, Math.min(templates.length - 1, templateIndex))];
            var tile = template.left[template.left.length - 1];
            var x = entry.grassCoord - 1;
            var y = entry.scan;
            var desired = this.Sub1IsGrammarBeachBankGrassTemplateTile(tile) ?
                tile :
                ((tile === 123 || tile === 124) ? tile : this.Sub1DarkGrassFloorTile(pContext, x, y));

            if(!MapGen.Layers.InBounds(pTiles, x, y))
                continue;
            if(desired === 255 &&
                this.Sub1BeachTileClassMaskAt(pLookup, pTiles, x, y) === "GSGG") {
                var seamReplacement = this.Sub1GrammarBeachDryGrassEdgeTileForMask(
                    pContext,
                    x,
                    y,
                    "GSGG",
                    y > 0 ? MapGen.Layers.Get(pTiles, x, y - 1, -1) : -1,
                    x < pContext.Width - 1 ? MapGen.Layers.Get(pTiles, x + 1, y, -1) : -1
                );
                if(seamReplacement >= 0)
                    desired = seamReplacement;
            }
            if(MapGen.Layers.Get(pTiles, x, y, -1) !== desired) {
                core.SetTile(pTiles, x, y, desired);
                ++changed;
            }

            var firstSandX = entry.grassCoord;
            if(!MapGen.Layers.InBounds(pTiles, firstSandX, y) ||
                this.Sub1BeachTileMaskClass(pLookup, MapGen.Layers.Get(pTiles, firstSandX, y, -1)) !== "S")
                continue;

            var firstSandTile = MapGen.Layers.Get(pTiles, firstSandX, y, -1);
            var desiredFirstSand = -1;
            if(desired === 276 && template.sand.length && template.sand[0] === 277 && firstSandTile === 257)
                desiredFirstSand = 277;
            else if((desired === 252 || desired === 255) &&
                firstSandTile === 256 &&
                this.Sub1BeachTileMaskClass(pLookup, MapGen.Layers.Get(pTiles, firstSandX + 1, y, -1)) === "S")
                desiredFirstSand = 257;

            if(desiredFirstSand >= 0 && desiredFirstSand !== firstSandTile) {
                core.SetTile(pTiles, firstSandX, y, desiredFirstSand);
                ++changed;
            }
        }

        return changed;
    };

    pJungle.RepairSub1GrammarBeachGrassContourTiles = function(pContext, pChars, pTiles, pLookup) {
        if(!this.IsGrammarBeachProfile(pContext))
            return 0;

        var waterDirection = this.Sub1GrammarBeachContourDirection(pContext);
        var grassDirection = this.Sub1OppositeContourDirection(waterDirection);
        if(!grassDirection)
            return 0;

        var core = MapGen.Terrain.Smoothing.Core;
        var segments = this.Sub1FindBeachGrassContourSegments(pLookup, pTiles, grassDirection);
        var changed = 0;

        for(var segmentIndex = 0; segmentIndex < segments.length; ++segmentIndex) {
            var segment = segments[segmentIndex];
            if(segment.length < 6)
                continue;

            for(var index = 0; index < segment.length; ++index) {
                var entry = segment[index];
                var pattern = this.Sub1GrammarBeachGrassEdgePatternEntry(index, segment.length);
                var targetX = pattern.side === "G" ? entry.grassX : entry.sandX;
                var targetY = pattern.side === "G" ? entry.grassY : entry.sandY;
                var ch = core.GetChar(pChars, targetX, targetY, this.Chars.ground);

                if(pattern.side === "G") {
                    if(ch === this.Chars.water ||
                        ch === this.Chars.beach ||
                        ch === this.Chars.bank ||
                        ch === this.Chars.path ||
                        ch === this.Chars.tree)
                        continue;
                    if(!this.CanRetileSub1BeachDryGrassEdgeCell(pContext, targetX, targetY))
                        continue;

                    var grassMask = this.Sub1BeachTileClassMaskAt(pLookup, pTiles, targetX, targetY);
                    var tileMasks = this.Sub1GrammarBeachDryGrassEdgeMasks()[pattern.tile];
                    if(grassMask === "GSGG" && index >= segment.length - 3) {
                        pattern = { side: "G", tile: 335 };
                        tileMasks = this.Sub1GrammarBeachDryGrassEdgeMasks()[pattern.tile];
                    }
                    if(!tileMasks || !tileMasks[grassMask]) {
                        pattern = {
                            side: "G",
                            tile: this.Sub1GrammarBeachDryGrassEdgeTileForMask(
                                pContext,
                                targetX,
                                targetY,
                                grassMask,
                                targetY > 0 ? MapGen.Layers.Get(pTiles, targetX, targetY - 1, -1) : -1,
                                targetX < pContext.Width - 1 ? MapGen.Layers.Get(pTiles, targetX + 1, targetY, -1) : -1
                            )
                        };
                        if(pattern.tile < 0)
                            continue;
                    }
                }
                else {
                    if(ch !== this.Chars.beach)
                        continue;

                    var sandMask = this.Sub1BeachTileClassMaskAt(pLookup, pTiles, targetX, targetY);
                    var sandTiles = this.Sub1GrammarBeachSandMaskTiles()[sandMask];
                    if(!sandTiles || !sandTiles[pattern.tile])
                        continue;
                }

                if(MapGen.Layers.Get(pTiles, targetX, targetY, -1) === pattern.tile)
                    continue;

                core.SetTile(pTiles, targetX, targetY, pattern.tile);
                ++changed;
            }
        }

        return changed;
    };
})(MapGen.Terrain.Smoothing.Jungle);
