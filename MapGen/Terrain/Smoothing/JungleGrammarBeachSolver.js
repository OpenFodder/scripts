var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};
MapGen.Terrain.Smoothing.Jungle = MapGen.Terrain.Smoothing.Jungle || {};

// Final constraint solver for procedural junsub1 coasts. The tile records are
// generated from the atlas by Tools/Build/BuildJungleEdgeTable.py; this module
// consumes their centre class, material shape edges and palette edges directly.
// Authored mapm5/mapm6/mapm8 motifs keep their exact template path.
(function(pJungle) {
    var ext = {
    IsComposedSub1BeachCoast: function(pContext) {
        var live = pContext && pContext.GrammarLiveTerrain ? pContext.GrammarLiveTerrain : null;
        return !!(live && (live.beachTemplate === "joined_east_coast" ||
            live.beachTemplate === "joined_south_coast"));
    },

    ComposedSub1BeachNeighbourClass: function(pContext, pChars, pTiles, pLookup, pX, pY, pFallbackFeature, pFallbackClass) {
        if(!MapGen.Layers.InBounds(pChars, pX, pY))
            return pFallbackClass;

        var core = MapGen.Terrain.Smoothing.Core;
        var feature = this.Sub1FeatureForCharCell(pContext, pChars, pX, pY) || pFallbackFeature;
        var ch = core.GetChar(pChars, pX, pY, this.Chars.ground);
        var semanticClass = this.Sub1ClassForChar(feature, ch);
        var participates = feature === "beach" &&
            this.Sub1ShouldApplyPixelEdge(pContext, pChars, pX, pY, feature, ch);

        if(participates)
            return semanticClass;

        // A path, structure apron, protected cell or other late overlay can
        // leave a semantic beach char backed by a real grass tile. The old
        // solver trusted the char and selected plain sand beside it, producing
        // the hard square grass edge. Use the decoded class of fixed tiles;
        // unclassified base/object tiles are land, never sand or water.
        var tileId = MapGen.Layers.Get(pTiles, pX, pY, -1);
        var rec = pLookup[String(tileId)];
        return rec && rec.center ? rec.center : "darkgrass";
    },

    ComposedSub1BeachDomain: function(pContext, pChars, pTiles, pLookup, pX, pY, pGroup, pForceActual, pAllowInterior) {
        var feature = this.Sub1FeatureForCharCell(pContext, pChars, pX, pY);
        if(feature !== "beach" && !pForceActual)
            return null;
        feature = "beach";

        var ch = MapGen.Terrain.Smoothing.Core.GetChar(
            pChars,
            pX,
            pY,
            this.Chars.ground
        );
        var currentTile = MapGen.Layers.Get(pTiles, pX, pY, -1);
        var currentRecord = pLookup[String(currentTile)];
        var cls = pForceActual ?
            (currentRecord ? currentRecord.center : "darkgrass") :
            this.Sub1ClassForChar(feature, ch);
        var shouldApply = pForceActual || this.Sub1ShouldApplyPixelEdge(
            pContext, pChars, pX, pY, feature, ch
        );

        if(pForceActual) {
            var forcedClass = this.Sub1NormalizedClass(cls);
            if(forcedClass !== "sand")
                return null;
        }

        var self = this;
        function neighbourClass(pNx, pNy) {
            if(!pForceActual)
                return self.ComposedSub1BeachNeighbourClass(
                    pContext, pChars, pTiles, pLookup, pNx, pNy, feature, cls
                );
            var neighbourTile = MapGen.Layers.Get(pTiles, pNx, pNy, -1);
            var neighbourRecord = pLookup[String(neighbourTile)];
            return neighbourRecord && neighbourRecord.center ?
                neighbourRecord.center : "darkgrass";
        }

        var northClass = neighbourClass(pX, pY - 1);
        var eastClass = neighbourClass(pX + 1, pY);
        var southClass = neighbourClass(pX, pY + 1);
        var westClass = neighbourClass(pX - 1, pY);

        if(pForceActual) {
            var forcedNormalized = this.Sub1NormalizedClass(cls);
            var forcedNeighbours = [northClass, eastClass, southClass, westClass];
            var touchesOpposite = false;
            for(var forcedIndex = 0; forcedIndex < forcedNeighbours.length; ++forcedIndex) {
                var forcedNeighbour = this.Sub1NormalizedClass(forcedNeighbours[forcedIndex]);
                if(forcedNormalized === "sand" && forcedNeighbour !== "sand") {
                    touchesOpposite = true;
                    break;
                }
            }
            if(!touchesOpposite && !pAllowInterior)
                return null;
        }

        if(!shouldApply && this.Sub1NormalizedClass(cls) === "sand") {
            // Late path/protection overlays can leave a semantic beach cell
            // outside the normal smoothing domain even though its final tile
            // now touches real grass or water. Pull those exposed sand cells
            // into the final solve; otherwise plain 256/257 squares survive on
            // the grass edge.
            var actualDirections = [[0, -1], [1, 0], [0, 1], [-1, 0]];
            for(var actualIndex = 0; actualIndex < actualDirections.length; ++actualIndex) {
                var actualClass = this.ComposedSub1BeachNeighbourClass(
                    pContext,
                    pChars,
                    pTiles,
                    pLookup,
                    pX + actualDirections[actualIndex][0],
                    pY + actualDirections[actualIndex][1],
                    feature,
                    cls
                );
                if(this.Sub1NormalizedClass(actualClass) !== "sand") {
                    shouldApply = true;
                    break;
                }
            }
        }

        if(!shouldApply)
            return null;

        var classMask =
            this.Sub1GlyphForClass(northClass) +
            this.Sub1GlyphForClass(eastClass) +
            this.Sub1GlyphForClass(southClass) +
            this.Sub1GlyphForClass(westClass);
        var source = (pGroup.byCenter[cls] || []).slice(0);

        // The official mapm8 diagonal uses 258,259,278 at the water turn.
        // Tile 278 is water-centred but carries the sand-to-water pixels which
        // complete that phrase. A centre-class-only domain can never choose it
        // for the final SWWS sand cell and substitutes 279, leaving the round
        // dark bite repeated along the coast. This is the sole cross-centre
        // transition admitted here; all other cells retain their semantic
        // centre class.
        var live = pContext && pContext.GrammarLiveTerrain ?
            pContext.GrammarLiveTerrain : null;
        if(live && live.beachTemplate === "joined_south_coast" &&
            this.Sub1NormalizedClass(cls) === "sand" &&
            classMask === "SWWS" &&
            pGroup.tiles["278"])
            source.push(278);

        var candidates = [];
        var strict;

        for(var pass = 0; pass < 2 && !candidates.length; ++pass) {
            strict = pass === 0;
            for(var index = 0; index < source.length; ++index) {
                var tileId = source[index];
                var rec = pGroup.tiles[String(tileId)];
                if(!rec)
                    continue;

                if(!this.Sub1CandidateFitsDirection(rec, "N", cls, northClass, strict) ||
                    !this.Sub1CandidateFitsDirection(rec, "E", cls, eastClass, strict) ||
                    !this.Sub1CandidateFitsDirection(rec, "S", cls, southClass, strict) ||
                    !this.Sub1CandidateFitsDirection(rec, "W", cls, westClass, strict))
                    continue;

                candidates.push(tileId);
            }
        }

        if(!candidates.length && pForceActual)
            candidates = source.slice(0);

        // A horizontal grass/sand edge uses the authored 275 -> 276 -> 277
        // contour. Its first two tiles have grass centres, so a sand-only
        // domain repeats corner 277 and breaks every horizontal join. Admit
        // the dry transition only with grass above and a full sand row below;
        // water corners and protected overlays retain their normal domains.
        if(this.Sub1NormalizedClass(cls) === "sand" &&
            MapGen.Layers.Get(pContext.Layers.coast, pX, pY, 0) &&
            (classMask === "GSSG" || classMask === "GSSS")) {
            if(classMask === "GSSG" && pGroup.tiles["275"])
                candidates.push(275);
            if(pGroup.tiles["276"])
                candidates.push(276);
        }

        if(!candidates.length)
            return null;

        return {
            x: pX,
            y: pY,
            feature: feature,
            cls: cls,
            classMask: classMask,
            neighbourClasses: {
                N: northClass,
                E: eastClass,
                S: southClass,
                W: westClass
            },
            candidates: candidates
        };
    },

    ComposedSub1BeachCandidateScore: function(pContext, pInfo, pTileId, pGroup, pLookup, pSelected, pTiles, pEdgeScores) {
        var rec = pGroup.tiles[String(pTileId)];
        if(!rec)
            return -1e9;

        var directions = [
            ["N", 0, -1, "S"],
            ["E", 1, 0, "W"],
            ["S", 0, 1, "N"],
            ["W", -1, 0, "E"]
        ];
        var score = this.Sub1CandidateStyleBias(pInfo.feature, pTileId);

        for(var index = 0; index < directions.length; ++index) {
            var dir = directions[index][0];
            var nx = pInfo.x + directions[index][1];
            var ny = pInfo.y + directions[index][2];
            var opposite = directions[index][3];
            var key = nx + "," + ny;
            var solvedNeighbour = pSelected.hasOwnProperty(key);
            var fixedTerrainBoundary = !solvedNeighbour &&
                this.Sub1NormalizedClass(pInfo.cls) !==
                    this.Sub1NormalizedClass(pInfo.neighbourClasses[dir]);
            var neighbourTile = solvedNeighbour ?
                pSelected[key] :
                MapGen.Layers.Get(pTiles, nx, ny, -1);
            var neighbour = pLookup[String(neighbourTile)];
            var neighbourClass = solvedNeighbour && neighbour ?
                neighbour.center : pInfo.neighbourClasses[dir];
            var currentNormalized = this.Sub1NormalizedClass(pInfo.cls);
            var neighbourNormalized = this.Sub1NormalizedClass(neighbourClass);
            var grassSandBoundary =
                (currentNormalized === "darkgrass" && neighbourNormalized === "sand") ||
                (currentNormalized === "sand" && neighbourNormalized === "darkgrass");
            var sandWaterBoundary =
                (currentNormalized === "sand" && neighbourNormalized === "water") ||
                (currentNormalized === "water" && neighbourNormalized === "sand");
            // Grass needs extra leverage because late overlays can replace its
            // neighbour. Water contours retain the atlas/corpus balance: an
            // excessive raw-pixel weight prefers square corner tile 295 over
            // the visually continuous 258/259 diagonal phrase.
            var shapeWeight = grassSandBoundary ? 6 : 3;

            if(neighbour && neighbour.shapeEdges && neighbour.shapeEdges[opposite]) {
                // Atlas pixels are immutable throughout one solve. Cache the
                // three raw scores; terrain-dependent weights still apply here.
                var pairKey = pTileId + ":" + dir + ":" + neighbourTile;
                var pair = pEdgeScores && pEdgeScores[pairKey];
                if(!pair) {
                    pair = [
                        this.Sub1ScoreShapeEdge((rec.shapeEdges || rec.edges)[dir],
                            (neighbour.shapeEdges || neighbour.edges)[opposite]),
                        this.Sub1ScoreVisualEdge(rec.visualEdges[dir], neighbour.visualEdges[opposite]),
                        this.Sub1ScoreEdge(rec.edges[dir], neighbour.edges[opposite], null)
                    ];
                    if(pEdgeScores) pEdgeScores[pairKey] = pair;
                }
                score += pair[0] * shapeWeight;
                score += pair[1];
                score += pair[2];
            }
            else {
                score += this.Sub1ScoreEdge(
                    rec.edges[dir],
                    null,
                    this.Sub1GlyphForClass(pInfo.neighbourClasses[dir])
                ) * (grassSandBoundary ? 6 : (sandWaterBoundary ? 3 :
                    (fixedTerrainBoundary ? 3 : 1)));
            }
        }

        var northTile = pSelected.hasOwnProperty(pInfo.x + "," + (pInfo.y - 1)) ?
            pSelected[pInfo.x + "," + (pInfo.y - 1)] :
            MapGen.Layers.Get(pTiles, pInfo.x, pInfo.y - 1, -1);
        var westTile = pSelected.hasOwnProperty((pInfo.x - 1) + "," + pInfo.y) ?
            pSelected[(pInfo.x - 1) + "," + pInfo.y] :
            MapGen.Layers.Get(pTiles, pInfo.x - 1, pInfo.y, -1);

        if(this.Sub1RejectGrammarBeachAdjacencyCandidate(
            pInfo.feature,
            pInfo.cls,
            pTileId,
            pInfo.classMask,
            northTile,
            westTile
        ))
            return -1e9;

        // The pixel table describes whether tiles can join, but a few
        // sand/water corner tiles encode a visibly different contour despite
        // having similar edge signatures. Use the shipped-map phrase bias for
        // water-only masks so diagonal shores choose 258/259 continuations
        // instead of repeating the square 295 bite. Grass-facing masks remain
        // entirely under the generated-edge solver.
        if(pInfo.classMask.indexOf("W") >= 0 &&
            pInfo.classMask.indexOf("G") < 0)
            score += this.Sub1GrammarBeachMaskBias(
                pInfo.feature,
                pInfo.cls,
                pTileId,
                pInfo.classMask,
                northTile,
                westTile
            );

        score += (MapGen.Random.HashTile(pContext.Seed, pInfo.x, pInfo.y, 9101 + pTileId) & 31) * 0.001;
        return score;
    },

    AuditComposedSub1BeachEdges: function(pInfos, pLookup, pSelected, pTiles) {
        var mismatchedShapePixels = 0;
        var mismatchedVisualPixels = 0;
        var mismatchedFixedShapePixels = 0;
        var fixedBoundaryJoins = 0;
        var fixedBoundaryFailures = 0;
        var grassBoundaryJoins = 0;
        var grassBoundaryFailures = 0;
        var mismatchedGrassShapePixels = 0;
        var hardGrassBoundaryFailures = 0;
        var waterBoundaryJoins = 0;
        var waterBoundaryFailures = 0;
        var mismatchedWaterShapePixels = 0;
        var hardWaterBoundaryFailures = 0;
        var unsupportedWaterCornerTiles = 0;
        var joins = 0;
        var samples = [];
        var directions = [
            ["N", 0, -1, "S"],
            ["E", 1, 0, "W"],
            ["S", 0, 1, "N"],
            ["W", -1, 0, "E"]
        ];

        for(var index = 0; index < pInfos.length; ++index) {
            var info = pInfos[index];
            var tileId = pSelected[info.x + "," + info.y];
            var rec = pLookup[String(tileId)];
            if(!rec)
                continue;

            if(tileId === 295 && info.classMask === "SWWS") {
                var auditNorthKey = info.x + "," + (info.y - 1);
                var auditNorthTile = pSelected.hasOwnProperty(auditNorthKey) ?
                    pSelected[auditNorthKey] :
                    MapGen.Layers.Get(pTiles, info.x, info.y - 1, -1);
                if(auditNorthTile !== 293 && auditNorthTile !== 294)
                    ++unsupportedWaterCornerTiles;
            }
            for(var dirIndex = 0; dirIndex < directions.length; ++dirIndex) {
                var dir = directions[dirIndex][0];
                var key = (info.x + directions[dirIndex][1]) + "," +
                    (info.y + directions[dirIndex][2]);
                var opposite = directions[dirIndex][3];
                var shapeA = (rec.shapeEdges || rec.edges)[dir];
                var joinShapeMismatches = 0;
                var grassSandJoin = false;
                var sandWaterJoin = false;
                var neighbourTile;
                var neighbour;

                if(pSelected.hasOwnProperty(key)) {
                    // Count each solved-to-solved join once.
                    if(dir === "N" || dir === "W")
                        continue;
                    neighbourTile = pSelected[key];
                    neighbour = pLookup[String(neighbourTile)];
                    if(!neighbour)
                        continue;
                    var internalCurrentClass = this.Sub1NormalizedClass(rec.center);
                    var internalNeighbourClass = this.Sub1NormalizedClass(neighbour.center);
                    grassSandJoin =
                        (internalCurrentClass === "darkgrass" && internalNeighbourClass === "sand") ||
                        (internalCurrentClass === "sand" && internalNeighbourClass === "darkgrass");
                    sandWaterJoin =
                        (internalCurrentClass === "sand" && internalNeighbourClass === "water") ||
                        (internalCurrentClass === "water" && internalNeighbourClass === "sand");
                    var shapeB = (neighbour.shapeEdges || neighbour.edges)[opposite];
                    var visualA = rec.visualEdges[dir];
                    var visualB = neighbour.visualEdges[opposite];
                    ++joins;

                    for(var pixel = 0; pixel < 16; ++pixel) {
                        var a = shapeA.charAt(pixel);
                        var b = shapeB.charAt(pixel);
                        if(a !== b && !((a === "G" && b === "L") || (a === "L" && b === "G")) &&
                            a !== "." && b !== ".") {
                            ++mismatchedShapePixels;
                            if(grassSandJoin)
                                ++mismatchedGrassShapePixels;
                            if(sandWaterJoin)
                                ++mismatchedWaterShapePixels;
                            ++joinShapeMismatches;
                        }
                        if(visualA.charAt(pixel) !== visualB.charAt(pixel))
                            ++mismatchedVisualPixels;
                        }
                    if(grassSandJoin) {
                        ++grassBoundaryJoins;
                        if(joinShapeMismatches)
                            ++grassBoundaryFailures;
                        var currentOwnsInternalBlend = internalCurrentClass === "sand" ?
                            (shapeA.indexOf("G") >= 0 || shapeA.indexOf("L") >= 0) :
                            shapeA.indexOf("S") >= 0;
                        var neighbourOwnsInternalBlend = internalNeighbourClass === "sand" ?
                            (shapeB.indexOf("G") >= 0 || shapeB.indexOf("L") >= 0) :
                            shapeB.indexOf("S") >= 0;
                        if(!currentOwnsInternalBlend && !neighbourOwnsInternalBlend)
                            ++hardGrassBoundaryFailures;
                    }
                    if(sandWaterJoin) {
                        ++waterBoundaryJoins;
                        if(joinShapeMismatches)
                            ++waterBoundaryFailures;
                        var currentOwnsInternalWaterBlend = internalCurrentClass === "sand" ?
                            shapeA.indexOf("W") >= 0 : shapeA.indexOf("S") >= 0;
                        var neighbourOwnsInternalWaterBlend = internalNeighbourClass === "sand" ?
                            shapeB.indexOf("W") >= 0 : shapeB.indexOf("S") >= 0;
                        if(!currentOwnsInternalWaterBlend && !neighbourOwnsInternalWaterBlend)
                            ++hardWaterBoundaryFailures;
                    }
                }
                else {
                    if(this.Sub1NormalizedClass(info.cls) ===
                        this.Sub1NormalizedClass(info.neighbourClasses[dir]))
                        continue;

                    // Fixed neighbours are exactly where late overlays used to
                    // expose plain sand against grass. Compare to their decoded
                    // tile edge when possible, otherwise to the effective
                    // terrain class captured while building the domain.
                    neighbourTile = MapGen.Layers.Get(
                        pTiles,
                        info.x + directions[dirIndex][1],
                        info.y + directions[dirIndex][2],
                        -1
                    );
                    neighbour = pLookup[String(neighbourTile)];
                    var fixedShape = neighbour && neighbour.shapeEdges ?
                        neighbour.shapeEdges[opposite] : null;
                    var expected = this.Sub1GlyphForClass(info.neighbourClasses[dir]);
                    var fixedCurrentClass = this.Sub1NormalizedClass(info.cls);
                    var fixedNeighbourClass = this.Sub1NormalizedClass(info.neighbourClasses[dir]);
                    grassSandJoin =
                        (fixedCurrentClass === "darkgrass" && fixedNeighbourClass === "sand") ||
                        (fixedCurrentClass === "sand" && fixedNeighbourClass === "darkgrass");
                    sandWaterJoin =
                        (fixedCurrentClass === "sand" && fixedNeighbourClass === "water") ||
                        (fixedCurrentClass === "water" && fixedNeighbourClass === "sand");
                    ++fixedBoundaryJoins;
                    if(grassSandJoin)
                        ++grassBoundaryJoins;
                    if(sandWaterJoin)
                        ++waterBoundaryJoins;

                    for(var fixedPixel = 0; fixedPixel < 16; ++fixedPixel) {
                        var fixedA = shapeA.charAt(fixedPixel);
                        var fixedB = fixedShape ? fixedShape.charAt(fixedPixel) : expected;
                        if(fixedA !== fixedB &&
                            !((fixedA === "G" && fixedB === "L") || (fixedA === "L" && fixedB === "G")) &&
                            fixedA !== "." && fixedB !== ".") {
                            ++mismatchedFixedShapePixels;
                            if(grassSandJoin)
                                ++mismatchedGrassShapePixels;
                            if(sandWaterJoin)
                                ++mismatchedWaterShapePixels;
                            ++joinShapeMismatches;
                        }
                    }
                    if(joinShapeMismatches)
                        ++fixedBoundaryFailures;
                    if(grassSandJoin && joinShapeMismatches)
                        ++grassBoundaryFailures;
                    if(sandWaterJoin && joinShapeMismatches)
                        ++waterBoundaryFailures;
                    if(grassSandJoin) {
                        var currentOwnsFixedBlend = fixedCurrentClass === "sand" ?
                            (shapeA.indexOf("G") >= 0 || shapeA.indexOf("L") >= 0) :
                            shapeA.indexOf("S") >= 0;
                        var neighbourOwnsFixedBlend = fixedNeighbourClass === "sand" ?
                            (fixedB.indexOf("G") >= 0 || fixedB.indexOf("L") >= 0) :
                            fixedB.indexOf("S") >= 0;
                        if(!currentOwnsFixedBlend && !neighbourOwnsFixedBlend)
                            ++hardGrassBoundaryFailures;
                    }
                    if(sandWaterJoin) {
                        var currentOwnsFixedWaterBlend = fixedCurrentClass === "sand" ?
                            shapeA.indexOf("W") >= 0 : shapeA.indexOf("S") >= 0;
                        var neighbourOwnsFixedWaterBlend = fixedNeighbourClass === "sand" ?
                            fixedB.indexOf("W") >= 0 : fixedB.indexOf("S") >= 0;
                        if(!currentOwnsFixedWaterBlend && !neighbourOwnsFixedWaterBlend)
                            ++hardWaterBoundaryFailures;
                    }
                }

                if(joinShapeMismatches && samples.length < 12) {
                    samples.push({
                        x: info.x,
                        y: info.y,
                        direction: dir,
                        tile: tileId,
                        neighbourTile: neighbourTile,
                        fixed: !pSelected.hasOwnProperty(key),
                        mismatchedShapePixels: joinShapeMismatches
                    });
                }
            }
        }

        return {
            joins: joins,
            mismatchedShapePixels: mismatchedShapePixels,
            mismatchedVisualPixels: mismatchedVisualPixels,
            fixedBoundaryJoins: fixedBoundaryJoins,
            fixedBoundaryFailures: fixedBoundaryFailures,
            mismatchedFixedShapePixels: mismatchedFixedShapePixels,
            grassBoundaryJoins: grassBoundaryJoins,
            grassBoundaryFailures: grassBoundaryFailures,
            mismatchedGrassShapePixels: mismatchedGrassShapePixels,
            hardGrassBoundaryFailures: hardGrassBoundaryFailures,
            waterBoundaryJoins: waterBoundaryJoins,
            waterBoundaryFailures: waterBoundaryFailures,
            mismatchedWaterShapePixels: mismatchedWaterShapePixels,
            hardWaterBoundaryFailures: hardWaterBoundaryFailures,
            hardTerrainBoundaryFailures:
                hardGrassBoundaryFailures + hardWaterBoundaryFailures,
            unsupportedWaterCornerTiles: unsupportedWaterCornerTiles,
            mismatchedCoastShapePixels:
                mismatchedGrassShapePixels + mismatchedWaterShapePixels,
            samples: samples
        };
    },

    AuditFinalComposedSub1BeachContacts: function(pContext, pTiles, pLookup, pInfoIndexes) {
        var hardGrassContacts = 0;
        var hardWaterContacts = 0;
        var samples = [];
        var directions = [["E", 1, 0, "W"], ["S", 0, 1, "N"]];

        function normalized(pJungle, pClass) {
            return pJungle.Sub1NormalizedClass(pClass || "darkgrass");
        }

        function edgeFor(pJungle, pRecord, pDirection, pClass) {
            if(pRecord && (pRecord.shapeEdges || pRecord.edges))
                return (pRecord.shapeEdges || pRecord.edges)[pDirection];
            var glyph = pJungle.Sub1GlyphForClass(pClass);
            return glyph + glyph + glyph + glyph + glyph + glyph + glyph + glyph +
                glyph + glyph + glyph + glyph + glyph + glyph + glyph + glyph;
        }

        for(var y = 0; y < pContext.Height; ++y) {
            for(var x = 0; x < pContext.Width; ++x) {
                var tileA = MapGen.Layers.Get(pTiles, x, y, -1);
                var recA = pLookup[String(tileA)];
                var classA = normalized(this, recA ? recA.center : "darkgrass");

                for(var directionIndex = 0; directionIndex < directions.length; ++directionIndex) {
                    var direction = directions[directionIndex];
                    var nx = x + direction[1];
                    var ny = y + direction[2];
                    if(!MapGen.Layers.InBounds(pTiles, nx, ny))
                        continue;
                    var tileB = MapGen.Layers.Get(pTiles, nx, ny, -1);
                    var recB = pLookup[String(tileB)];
                    var classB = normalized(this, recB ? recB.center : "darkgrass");
                    var grassSand =
                        (classA === "darkgrass" && classB === "sand") ||
                        (classA === "sand" && classB === "darkgrass");
                    var sandWater =
                        (classA === "sand" && classB === "water") ||
                        (classA === "water" && classB === "sand");
                    if(!grassSand && !sandWater)
                        continue;

                    var edgeA = edgeFor(this, recA, direction[0], classA);
                    var edgeB = edgeFor(this, recB, direction[3], classB);
                    var ownsA;
                    var ownsB;
                    if(grassSand) {
                        ownsA = classA === "sand" ?
                            (edgeA.indexOf("G") >= 0 || edgeA.indexOf("L") >= 0) :
                            edgeA.indexOf("S") >= 0;
                        ownsB = classB === "sand" ?
                            (edgeB.indexOf("G") >= 0 || edgeB.indexOf("L") >= 0) :
                            edgeB.indexOf("S") >= 0;
                    }
                    else {
                        ownsA = classA === "sand" ?
                            edgeA.indexOf("W") >= 0 : edgeA.indexOf("S") >= 0;
                        ownsB = classB === "sand" ?
                            edgeB.indexOf("W") >= 0 : edgeB.indexOf("S") >= 0;
                    }
                    if(ownsA || ownsB)
                        continue;

                    if(grassSand)
                        ++hardGrassContacts;
                    else
                        ++hardWaterContacts;
                    if(samples.length < 16) {
                        samples.push({
                            x: x,
                            y: y,
                            direction: direction[0],
                            tile: tileA,
                            neighbourTile: tileB,
                            classA: classA,
                            classB: classB,
                            cellSolved: pInfoIndexes.hasOwnProperty(x + "," + y),
                            neighbourSolved: pInfoIndexes.hasOwnProperty(nx + "," + ny)
                        });
                    }
                }
            }
        }

        return {
            hardGrassContacts: hardGrassContacts,
            hardWaterContacts: hardWaterContacts,
            samples: samples
        };
    },

    ScoreComposedSub1BeachSelection: function(pContext, pInfos, pGroup, pLookup, pSelected, pTiles, pEdgeScores) {
        var score = 0;
        for(var index = 0; index < pInfos.length; ++index) {
            var info = pInfos[index];
            score += this.ComposedSub1BeachCandidateScore(
                pContext,
                info,
                pSelected[info.x + "," + info.y],
                pGroup,
                pLookup,
                pSelected,
                pTiles,
                pEdgeScores
            );
        }
        return score;
    },

    OptimizeComposedSub1BeachSelection: function(pContext, pInfos, pGroup, pLookup, pSelected, pTiles, pEdgeScores, pWork) {
        // Scores depend only on the four adjacent selections. Keep the same
        // sweep/tie order, but revisit a cell only when a neighbour changed.
        // Each restart starts dirty; fixed tiles cannot change during a solve.
        var dirty = {}, keys = [];
        for(var index = 0; index < pInfos.length; ++index) {
            var key = pInfos[index].x + "," + pInfos[index].y;
            keys.push(key);
            dirty[key] = true;
        }
        var passes = 0;
        for(var pass = 0; pass < 8; ++pass) {
            var passChanged = 0;
            var reverse = (pass & 1) !== 0;
            for(var order = 0; order < pInfos.length; ++order) {
                var infoIndex = reverse ? pInfos.length - 1 - order : order;
                var info = pInfos[infoIndex];
                var key = keys[infoIndex];
                if(pWork) ++pWork.cellVisits;
                if(!dirty[key]) {
                    if(pWork) ++pWork.unchangedCells;
                    continue;
                }
                dirty[key] = false;
                var currentTile = pSelected[key];
                var bestTile = currentTile;
                var bestScore = this.ComposedSub1BeachCandidateScore(
                    pContext, info, currentTile, pGroup, pLookup, pSelected, pTiles, pEdgeScores
                );
                if(pWork) ++pWork.scoreCalls;

                for(var ci = 0; ci < info.candidates.length; ++ci) {
                    var candidate = info.candidates[ci];
                    if(candidate === currentTile)
                        continue;
                    var candidateScore = this.ComposedSub1BeachCandidateScore(
                        pContext, info, candidate, pGroup, pLookup, pSelected, pTiles, pEdgeScores
                    );
                    if(pWork) ++pWork.scoreCalls;
                    if(candidateScore > bestScore + 0.0001) {
                        bestScore = candidateScore;
                        bestTile = candidate;
                    }
                }

                if(bestTile !== currentTile) {
                    pSelected[key] = bestTile;
                    dirty[info.x + "," + (info.y - 1)] = true;
                    dirty[(info.x + 1) + "," + info.y] = true;
                    dirty[info.x + "," + (info.y + 1)] = true;
                    dirty[(info.x - 1) + "," + info.y] = true;
                    ++passChanged;
                }
            }

            ++passes;
            if(!passChanged)
                break;
        }
        return passes;
    },

    ResolveComposedSub1BeachEdges: function(pContext, pChars, pTiles) {
        if(!this.IsComposedSub1BeachCoast(pContext) || !pChars || !pTiles)
            return 0;

        var data = this.Sub1EdgeData();
        var group = data && data.beach ? data.beach : null;
        if(!group || !group.tiles || !group.byCenter)
            return 0;

        var lookup = this.Sub1RecordLookup(data);
        var infos = [];
        var infoIndexes = {};

        for(var y = 0; y < pContext.Height; ++y) {
            for(var x = 0; x < pContext.Width; ++x) {
                var info = this.ComposedSub1BeachDomain(pContext, pChars, pTiles, lookup, x, y, group);
                if(!info)
                    continue;
                infoIndexes[x + "," + y] = infos.length;
                infos.push(info);
            }
        }

        // Rebuild every final sand boundary from the tiles that are actually
        // present after overlays. This replaces semantic-only domains and also
        // adds exposed cells which the earlier char-based pass omitted.
        for(var actualY = 0; actualY < pContext.Height; ++actualY) {
            for(var actualX = 0; actualX < pContext.Width; ++actualX) {
                var actualInfo = this.ComposedSub1BeachDomain(
                    pContext,
                    pChars,
                    pTiles,
                    lookup,
                    actualX,
                    actualY,
                    group,
                    true
                );
                if(!actualInfo)
                    continue;
                var actualKey = actualX + "," + actualY;
                if(infoIndexes.hasOwnProperty(actualKey)) {
                    infos[infoIndexes[actualKey]] = actualInfo;
                    continue;
                }
                infoIndexes[actualKey] = infos.length;
                infos.push(actualInfo);
            }
        }

        var selected = null;
        var selectedAudit = null;
        var selectedScore = -1e30;
        var selectedPasses = 0;
        var edgeScores = {};
        var work = {cellVisits: 0, unchangedCells: 0, scoreCalls: 0};
        for(var restart = 0; restart < 8; ++restart) {
            var trial = {};
            for(var trialIndex = 0; trialIndex < infos.length; ++trialIndex) {
                var trialInfo = infos[trialIndex];
                var trialKey = trialInfo.x + "," + trialInfo.y;
                var current = MapGen.Layers.Get(pTiles, trialInfo.x, trialInfo.y, -1);
                var initialIndex = MapGen.Random.HashTile(
                    pContext.Seed,
                    trialInfo.x,
                    trialInfo.y,
                    9201 + restart
                ) % trialInfo.candidates.length;

                if(restart === 0) {
                    for(var candidateIndex = 0; candidateIndex < trialInfo.candidates.length; ++candidateIndex) {
                        if(trialInfo.candidates[candidateIndex] === current) {
                            initialIndex = candidateIndex;
                            break;
                        }
                    }
                }
                trial[trialKey] = trialInfo.candidates[initialIndex];
            }

            var trialPasses = this.OptimizeComposedSub1BeachSelection(
                pContext, infos, group, lookup, trial, pTiles, edgeScores, work
            );
            var trialAudit = this.AuditComposedSub1BeachEdges(infos, lookup, trial, pTiles);
            var trialScore = this.ScoreComposedSub1BeachSelection(
                pContext, infos, group, lookup, trial, pTiles, edgeScores
            );

            if(!selectedAudit ||
                trialAudit.hardTerrainBoundaryFailures < selectedAudit.hardTerrainBoundaryFailures ||
                (trialAudit.hardTerrainBoundaryFailures === selectedAudit.hardTerrainBoundaryFailures &&
                    trialAudit.unsupportedWaterCornerTiles < selectedAudit.unsupportedWaterCornerTiles) ||
                (trialAudit.hardTerrainBoundaryFailures === selectedAudit.hardTerrainBoundaryFailures &&
                    trialAudit.unsupportedWaterCornerTiles === selectedAudit.unsupportedWaterCornerTiles &&
                    trialScore > selectedScore) ||
                (trialAudit.hardTerrainBoundaryFailures === selectedAudit.hardTerrainBoundaryFailures &&
                    trialAudit.unsupportedWaterCornerTiles === selectedAudit.unsupportedWaterCornerTiles &&
                    trialScore === selectedScore &&
                    trialAudit.mismatchedCoastShapePixels < selectedAudit.mismatchedCoastShapePixels)) {
                selected = trial;
                selectedAudit = trialAudit;
                selectedScore = trialScore;
                selectedPasses = trialPasses;
            }
        }

        var changed = 0;
        for(var applyIndex = 0; applyIndex < infos.length; ++applyIndex) {
            var applyInfo = infos[applyIndex];
            var applyTile = selected[applyInfo.x + "," + applyInfo.y];
            if(MapGen.Layers.Get(pTiles, applyInfo.x, applyInfo.y, -1) === applyTile)
                continue;
            MapGen.Layers.Set(pTiles, applyInfo.x, applyInfo.y, applyTile);
            ++changed;
        }

        var audit = selectedAudit || this.AuditComposedSub1BeachEdges(infos, lookup, selected, pTiles);
        audit.finalContacts = this.AuditFinalComposedSub1BeachContacts(
            pContext, pTiles, lookup, infoIndexes
        );
        audit.cells = infos.length;
        audit.changed = changed;
        audit.passes = selectedPasses;
        audit.restarts = 8;
        audit.optimization = work;
        pContext.ComposedBeachEdgeAudit = audit;
        if(MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(
                pContext,
                "Resolved composed beach edges: cells=" + audit.cells +
                    " changed=" + changed +
                    " shapeMismatchPixels=" + audit.mismatchedShapePixels +
                    " fixedBoundaryMismatchPixels=" + audit.mismatchedFixedShapePixels
            );

        return changed;
    }
    };

    for(var key in ext) {
        if(ext.hasOwnProperty(key))
            pJungle[key] = ext[key];
    }
})(MapGen.Terrain.Smoothing.Jungle);
