var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};
MapGen.Terrain.Smoothing.Jungle = MapGen.Terrain.Smoothing.Jungle || {};

// Shared sub1 beach/river atlas reconstruction. Dispatched by the jungle
// smoother through UsesSub1ExplicitWaterTiles. Loads after Jungle.js.
(function(pJungle) {
    // Edge glyph/palette strings are immutable during one render. Share their
    // scores across cells; terrain weights and candidate ordering stay local.
    function cachedEdgeScore(score) {
        var cache = {};
        return function(a, b, hint) {
            var key = a + "|" + b + "|" + hint;
            if(cache[key] === undefined) cache[key] = score(a, b, hint);
            return cache[key];
        };
    }
    var ext = {
    Sub1EdgeData: function() {
        var edges = MapGen.Terrain.Smoothing.JungleTileEdges;
        return edges && edges.sub1 ? edges.sub1 : null;
    },

    Sub1OceanAllowedTiles: function() {
        if(this._Sub1OceanAllowedTiles)
            return this._Sub1OceanAllowedTiles;

        this._Sub1OceanAllowedTiles = {
            242: true,
            244: true,
            260: true,
            261: true,
            263: true,
            280: true,
            282: true,
            341: true,
            361: true,
            364: true,
            382: true
        };

        return this._Sub1OceanAllowedTiles;
    },

    Sub1OceanEdgeData: function(pData) {
        if(!pData || !pData.river || !pData.river.tiles)
            return null;
        if(pData.ocean)
            return pData.ocean;

        var allowed = this.Sub1OceanAllowedTiles();
        var ocean = {
            tiles: {},
            byCenter: {
                darkgrass: [],
                water: []
            }
        };

        for(var tid in pData.river.tiles) {
            if(!pData.river.tiles.hasOwnProperty(tid) || !allowed[Number(tid)])
                continue;

            var rec = pData.river.tiles[tid];
            ocean.tiles[tid] = rec;
            if(!ocean.byCenter[rec.center])
                ocean.byCenter[rec.center] = [];
            ocean.byCenter[rec.center].push(Number(tid));
        }

        pData.ocean = ocean;
        return ocean;
    },

    Sub1GroupForFeature: function(pData, pFeature) {
        if(pFeature === "ocean")
            return this.Sub1OceanEdgeData(pData);

        return pData ? pData[pFeature] : null;
    },

    Sub1FeatureForCharCell: function(pContext, pChars, pX, pY) {
        var ch = MapGen.Terrain.Smoothing.Core.GetChar(pChars, pX, pY, this.Chars.ground);
        var grammarBeach = this.IsGrammarBeachProfile(pContext);
        var live = pContext && pContext.GrammarLiveTerrain ? pContext.GrammarLiveTerrain : null;
        var mapm5BeachRows = live && live.beachTemplateRows ?
            live.beachTemplateRows.length : 19;
        var mapm5River = !!(live && live.beachTemplate === "mapm5_top_bank" &&
            live.beachTemplateOrigin &&
            pY >= Math.round(live.beachTemplateOrigin.y) + mapm5BeachRows - 2);
        var mapm6River = !!(live && live.beachTemplate === "mapm6_bridge_channel");
        var grammarRiver = mapm5River || mapm6River;

        if(ch === this.Chars.bank)
            return "quicksand";
        if(ch === this.Chars.beach)
            return "beach";
        if(ch === this.Chars.tree && grammarBeach)
            return this.HasNearbyChar(pChars, pX, pY, this.Chars.water, 1) ?
                (grammarRiver ? "river" : "ocean") : null;
        if(ch === this.Chars.water)
            return this.HasNearbyChar(pChars, pX, pY, this.Chars.beach, 1) ? "beach" :
                (grammarBeach && !grammarRiver ? "ocean" : "river");
        if(ch === this.Chars.ground) {
            if(this.HasNearbyChar(pChars, pX, pY, this.Chars.bank, 1))
                return "quicksand";
            if(this.HasNearbyChar(pChars, pX, pY, this.Chars.beach, 1))
                return "beach";
            if(this.HasNearbyChar(pChars, pX, pY, this.Chars.water, 1))
                return grammarBeach && !grammarRiver ? "ocean" :
                    (this.IsNearCoastLayer(pContext, pX, pY, 2) ||
                    this.IsInLocalBeachZone(pContext, pX, pY)) ? "beach" :
                    "river";
        }

        return null;
    },

    Sub1ClassForChar: function(pFeature, pChar) {
        if(pFeature === "quicksand")
            return pChar === this.Chars.bank ? "quicksand" : "darkgrass";
        if(pFeature === "beach") {
            if(pChar === this.Chars.water)
                return "water";
            if(pChar === this.Chars.beach)
                return "sand";
            return "darkgrass";
        }
        if(pFeature === "river" || pFeature === "ocean")
            return pChar === this.Chars.water ? "water" : "darkgrass";

        return "darkgrass";
    },

    Sub1ShouldApplyPixelEdge: function(pContext, pChars, pX, pY, pFeature, pChar) {
        var core = MapGen.Terrain.Smoothing.Core;
        var currentClass = this.Sub1ClassForChar(pFeature, pChar);
        var grammarBeach = this.IsGrammarBeachProfile(pContext);
        var offsets = [
            [0, -1],
            [1, 0],
            [0, 1],
            [-1, 0]
        ];

        // Official sub1 maps mostly keep water cells as plain water variants
        // and place shoreline/river detail on the neighbouring land/sand side.
        if(pChar === this.Chars.water) {
            if(grammarBeach && pFeature === "beach") {
                var sandContact = 0;
                for(var sandContactIndex = 0; sandContactIndex < offsets.length; ++sandContactIndex) {
                    var sx = pX + offsets[sandContactIndex][0];
                    var sy = pY + offsets[sandContactIndex][1];
                    if(core.GetChar(pChars, sx, sy, this.Chars.ground) === this.Chars.beach)
                        ++sandContact;
                }
                if(sandContact < 2)
                    return false;

                return true;
            }

            return false;
        }

        if(this.Sub1ShouldKeepPlainBeachSand(pContext, pChars, pX, pY, pFeature, pChar))
            return false;

        if(pFeature === "beach" && pChar === this.Chars.ground) {
            if(grammarBeach && this.IsProtectedChar(pContext, pX, pY))
                return false;

            var beachContact = 0;
            for(var contactIndex = 0; contactIndex < offsets.length; ++contactIndex) {
                var cx = pX + offsets[contactIndex][0];
                var cy = pY + offsets[contactIndex][1];
                var contactChar = core.GetChar(pChars, cx, cy, this.Chars.ground);
                if(contactChar === this.Chars.beach || contactChar === this.Chars.water)
                    ++beachContact;
            }

            if(grammarBeach)
                return beachContact > 0;

            if(beachContact < 3)
                return false;
        }

        for(var index = 0; index < offsets.length; ++index) {
            var nx = pX + offsets[index][0];
            var ny = pY + offsets[index][1];
            if(!MapGen.Layers.InBounds(pChars, nx, ny))
                continue;
            var nFeature = this.Sub1FeatureForCharCell(pContext, pChars, nx, ny) || pFeature;
            var nClass = this.Sub1ClassForChar(nFeature, core.GetChar(pChars, nx, ny, this.Chars.ground));

            if(nClass !== currentClass)
                return true;
        }

        return false;
    },

    Sub1GlyphForClass: function(pClass) {
        if(pClass === "sand")
            return "S";
        if(pClass === "water")
            return "W";
        if(pClass === "quicksand")
            return "Q";
        if(pClass === "lightgrass")
            return "L";
        return "G";
    },

    Sub1ClassForGlyph: function(pGlyph) {
        if(pGlyph === "S")
            return "sand";
        if(pGlyph === "W")
            return "water";
        if(pGlyph === "Q")
            return "quicksand";
        if(pGlyph === "G" || pGlyph === "L")
            return "darkgrass";
        return null;
    },

    Sub1NormalizedClass: function(pClass) {
        return pClass === "lightgrass" ? "darkgrass" : pClass;
    },

    Sub1ClassSet: function(pClassA, pClassB) {
        var set = {};
        set[this.Sub1NormalizedClass(pClassA)] = true;
        set[this.Sub1NormalizedClass(pClassB)] = true;
        return set;
    },

    Sub1ClassAtOrSelf: function(pContext, pChars, pX, pY, pFallbackFeature, pFallbackClass) {
        var core = MapGen.Terrain.Smoothing.Core;

        if(!MapGen.Layers.InBounds(pChars, pX, pY))
            return pFallbackClass;

        var feature = this.Sub1FeatureForCharCell(pContext, pChars, pX, pY) || pFallbackFeature;
        return this.Sub1ClassForChar(feature, core.GetChar(pChars, pX, pY, this.Chars.ground));
    },

    Sub1CardinalClassCounts: function(pContext, pChars, pX, pY, pFeature, pClass) {
        var counts = {};
        var offsets = [
            [0, -1],
            [1, 0],
            [0, 1],
            [-1, 0]
        ];

        for(var index = 0; index < offsets.length; ++index) {
            var cls = this.Sub1ClassAtOrSelf(
                pContext,
                pChars,
                pX + offsets[index][0],
                pY + offsets[index][1],
                pFeature,
                pClass
            );
            counts[cls] = (counts[cls] || 0) + 1;
        }

        return counts;
    },

    Sub1ShouldKeepPlainBeachSand: function(pContext, pChars, pX, pY, pFeature, pChar) {
        if(pFeature !== "beach" || pChar !== this.Chars.beach)
            return false;

        var counts = this.Sub1CardinalClassCounts(pContext, pChars, pX, pY, pFeature, "sand");
        var water = counts.water || 0;
        var sand = counts.sand || 0;
        var darkgrass = counts.darkgrass || 0;

        if(water > 0 &&
            pContext.Profile &&
            pContext.Profile.TargetPackProfile === "grammar_beach")
            return false;

        if(water !== 1 || sand < 1 || darkgrass > 2)
            return false;

        // Official sub1 beaches often leave straight shoreline cells as plain
        // sand, using edge art as accents rather than a repeated full outline.
        return (MapGen.Random.HashTile(pContext.Seed, pX, pY, 6371) % 100) < 18;
    },

    Sub1GrammarBeachSandMasks: function() {
        return {
            // Every sand-centre cardinal mask observed in the shipped sub1
            // beach maps.  The old five-mask subset made the charmap repair
            // turn legal shoreline sand back into water, leaving comb-like
            // notches before the tile selector even ran.
            GGWG: true,
            GWSS: true,
            SWWS: true,
            SWSS: true,
            SSWS: true,
            GWWS: true,
            SWWG: true,
            SWGS: true,
            // Shipped mapm8 uses SGWS at the small cove neck.  Keeping that
            // observed mask prevents the legality repair from deleting the
            // neck cell and turning a rounded corner beach into a staircase.
            SGWS: true
        };
    },

    Sub1MaskClassForChar: function(pChar) {
        if(pChar === this.Chars.water)
            return "W";
        if(pChar === this.Chars.beach)
            return "S";
        return "G";
    },

    Sub1BeachSandMaskAt: function(pContext, pChars, pX, pY) {
        var core = MapGen.Terrain.Smoothing.Core;
        var defaultChar = this.IsGrammarBeachProfile(pContext) ?
            this.Chars.beach :
            this.Chars.ground;

        return this.Sub1MaskClassForChar(core.GetChar(pChars, pX, pY - 1, defaultChar)) +
            this.Sub1MaskClassForChar(core.GetChar(pChars, pX + 1, pY, defaultChar)) +
            this.Sub1MaskClassForChar(core.GetChar(pChars, pX, pY + 1, defaultChar)) +
            this.Sub1MaskClassForChar(core.GetChar(pChars, pX - 1, pY, defaultChar));
    },

    CanRewriteSub1BeachCharmapCell: function(pContext, pX, pY) {
        var layers = pContext.Layers || {};

        return !MapGen.Layers.Get(layers.occupied, pX, pY, 0) &&
            !MapGen.Layers.Get(layers.keepClear, pX, pY, 0) &&
            !MapGen.Layers.Get(layers.path, pX, pY, 0) &&
            !MapGen.Layers.Get(layers.structureGround, pX, pY, 0);
    },

    CanShapeSub1BeachGrassContourCell: function(pContext, pX, pY) {
        var layers = pContext.Layers || {};

        return !MapGen.Layers.Get(layers.occupied, pX, pY, 0) &&
            !MapGen.Layers.Get(layers.keepClear, pX, pY, 0) &&
            !MapGen.Layers.Get(layers.structureGround, pX, pY, 0);
    },

    CanPruneUnsupportedSub1BeachCharmapCell: function(pContext, pX, pY) {
        var layers = pContext.Layers || {};

        return !MapGen.Layers.Get(layers.crossing, pX, pY, 0) &&
            !MapGen.Layers.Get(layers.path, pX, pY, 0) &&
            !MapGen.Layers.Get(layers.structureGround, pX, pY, 0);
    },

    IsAuthoredSub1GrammarBeachCoastCell: function(pContext, pX, pY) {
        var live = pContext && pContext.GrammarLiveTerrain ? pContext.GrammarLiveTerrain : null;
        var beach = live && live.beach && live.beach.cells ? live.beach.cells : null;
        var lookup;

        if(!this.IsGrammarBeachProfile(pContext) ||
            !live ||
            live.mode !== "localized_beach_river" ||
            !beach)
            return false;

        lookup = pContext._sub1AuthoredGrammarBeachLookup;
        if(!lookup) {
            lookup = {};
            for(var index = 0; index < beach.length; ++index)
                lookup[beach[index].x + "," + beach[index].y] = true;
            pContext._sub1AuthoredGrammarBeachLookup = lookup;
        }

        return !!lookup[pX + "," + pY];
    },

    TryExpandSub1BeachMask: function(pContext, pChars, pNext, pX, pY, pMask, pAllowed) {
        var core = MapGen.Terrain.Smoothing.Core;
        var dirs = [
            { index: 0, dx: 0, dy: -1 },
            { index: 1, dx: 1, dy: 0 },
            { index: 2, dx: 0, dy: 1 },
            { index: 3, dx: -1, dy: 0 }
        ];

        for(var changeCount = 1; changeCount <= 4; ++changeCount) {
            for(var bits = 1; bits < 16; ++bits) {
                var bitCount = 0;
                for(var bitIndex = 0; bitIndex < 4; ++bitIndex) {
                    if((bits & (1 << bitIndex)) !== 0)
                        ++bitCount;
                }
                if(bitCount !== changeCount)
                    continue;

                var maskChars = pMask.split("");
                var changes = [];
                var valid = true;

                for(var i = 0; i < dirs.length; ++i) {
                    if((bits & (1 << i)) === 0)
                        continue;

                    var dir = dirs[i];
                    if(maskChars[dir.index] !== "G") {
                        valid = false;
                        break;
                    }

                    var x = pX + dir.dx;
                    var y = pY + dir.dy;
                    if(!MapGen.Layers.InBounds(pChars, x, y) ||
                        core.GetChar(pChars, x, y, this.Chars.ground) !== this.Chars.ground ||
                        !this.CanRewriteSub1BeachCharmapCell(pContext, x, y)) {
                        valid = false;
                        break;
                    }

                    maskChars[dir.index] = "S";
                    changes.push({ x: x, y: y });
                }

                if(!valid || !pAllowed[maskChars.join("")])
                    continue;

                for(var c = 0; c < changes.length; ++c)
                    MapGen.Layers.Set(pNext, changes[c].x, changes[c].y, this.Chars.beach);
                return changes.length;
            }
        }

        return 0;
    },

    Sub1SameSandMixedEdgeFits: function(pRecord, pDirection) {
        if(!pRecord || !pRecord.edgeProfile || !pRecord.edgeProfile[pDirection])
            return false;

        var profile = pRecord.edgeProfile[pDirection];
        var first = this.Sub1NormalizedClass(profile[0]);
        var second = this.Sub1NormalizedClass(profile[1]);

        return (first === "sand" || second === "sand") &&
            (first === "water" || second === "water");
    },

    Sub1EdgeProfileFitsClasses: function(pRecord, pDirection, pCurrentClass, pNeighbourClass, pRequireNeighbour) {
        if(!pRecord || !pRecord.edgeProfile || !pRecord.edgeProfile[pDirection])
            return true;

        var allowed = this.Sub1ClassSet(pCurrentClass, pNeighbourClass);
        var profile = pRecord.edgeProfile[pDirection];
        var first = this.Sub1NormalizedClass(profile[0]);
        var second = this.Sub1NormalizedClass(profile[1]);
        var neighbour = this.Sub1NormalizedClass(pNeighbourClass);

        if(!allowed[first] || !allowed[second])
            return false;

        return !pRequireNeighbour || first === neighbour || second === neighbour;
    },

    Sub1EdgeGlyphsFitClasses: function(pEdge, pCurrentClass, pNeighbourClass) {
        var allowed = this.Sub1ClassSet(pCurrentClass, pNeighbourClass);
        var darkgrassTolerance = (allowed.water && !allowed.darkgrass) ? 4 : 0;
        var darkgrassCount = 0;

        for(var index = 0; index < pEdge.length; ++index) {
            var cls = this.Sub1ClassForGlyph(pEdge.charAt(index));
            if(!cls)
                continue;
            cls = this.Sub1NormalizedClass(cls);
            if(allowed[cls])
                continue;

            if(cls === "darkgrass" && darkgrassCount < darkgrassTolerance) {
                ++darkgrassCount;
                continue;
            }

            return false;
        }

        return true;
    },

    Sub1CandidateFitsDirection: function(pRecord, pDirection, pCurrentClass, pNeighbourClass, pStrictSameClass) {
        if(!pRecord || !pRecord.edges || !pRecord.edges[pDirection])
            return false;

        if(this.Sub1NormalizedClass(pCurrentClass) === this.Sub1NormalizedClass(pNeighbourClass)) {
            if(this.Sub1EdgeProfileFitsClasses(pRecord, pDirection, pCurrentClass, pNeighbourClass))
                return true;
            return this.Sub1NormalizedClass(pCurrentClass) === "sand" &&
                this.Sub1SameSandMixedEdgeFits(pRecord, pDirection);
        }

        return this.Sub1EdgeProfileFitsClasses(pRecord, pDirection, pCurrentClass, pNeighbourClass, true) &&
            this.Sub1EdgeGlyphsFitClasses(pRecord.edges[pDirection], pCurrentClass, pNeighbourClass);
    },

    Sub1CandidatePenaltyForDirection: function(pRecord, pDirection, pCurrentClass, pNeighbourClass) {
        if(!pRecord || !pRecord.edges || !pRecord.edges[pDirection])
            return 4000;

        if(this.Sub1NormalizedClass(pCurrentClass) === this.Sub1NormalizedClass(pNeighbourClass)) {
            if(this.Sub1EdgeProfileFitsClasses(pRecord, pDirection, pCurrentClass, pNeighbourClass))
                return 0;
            return this.Sub1NormalizedClass(pCurrentClass) === "sand" &&
                this.Sub1SameSandMixedEdgeFits(pRecord, pDirection) ? 0 : 1800;
        }

        if(!this.Sub1EdgeProfileFitsClasses(pRecord, pDirection, pCurrentClass, pNeighbourClass, true))
            return 1800;
        if(!this.Sub1EdgeGlyphsFitClasses(pRecord.edges[pDirection], pCurrentClass, pNeighbourClass))
            return 450;

        return 0;
    },

    Sub1ScoreEdge: function(pCandidateEdge, pNeighbourEdge, pHintGlyph) {
        var score = 0;

        if(pNeighbourEdge !== null && pNeighbourEdge !== undefined) {
            if(pCandidateEdge === pNeighbourEdge)
                return 100;
            for(var i = 0; i < 16; ++i) {
                var a = pCandidateEdge.charAt(i);
                var b = pNeighbourEdge.charAt(i);
                if(a === b)
                    score += 8;
                else if((a === "G" && b === "L") || (a === "L" && b === "G"))
                    score += 5;
                else if(a === "." || b === ".")
                    score -= 1;
                else
                    score -= 5;
            }
            return score;
        }

        if(!pHintGlyph)
            return 0;

        for(var j = 0; j < 16; ++j) {
            var c = pCandidateEdge.charAt(j);
            if(c === pHintGlyph)
                score += 4;
            else if((pHintGlyph === "G" && c === "L") || (pHintGlyph === "L" && c === "G"))
                score += 3;
            else if(c === ".")
                score -= 1;
            else if(pHintGlyph === "W" || c === "W")
                score -= 8;
            else if(pHintGlyph === "Q" || c === "Q")
                score -= 6;
            else
                score -= 4;
        }

        return score;
    },

    Sub1ScoreVisualEdge: function(pCandidateEdge, pNeighbourEdge) {
        if(!pCandidateEdge || !pNeighbourEdge)
            return 0;

        var score = 0;
        var length = Math.min(pCandidateEdge.length, pNeighbourEdge.length);
        for(var index = 0; index < length; ++index) {
            var a = parseInt(pCandidateEdge.charAt(index), 16);
            var b = parseInt(pNeighbourEdge.charAt(index), 16);
            if(isNaN(a) || isNaN(b))
                continue;

            if(a === b) {
                score += 4;
                continue;
            }

            score -= 2;
        }

        return score;
    },

    Sub1ScoreShapeEdge: function(pCandidateEdge, pNeighbourEdge) {
        if(!pCandidateEdge || !pNeighbourEdge)
            return 0;

        var score = 0;
        var length = Math.min(pCandidateEdge.length, pNeighbourEdge.length);
        for(var index = 0; index < length; ++index) {
            var a = pCandidateEdge.charAt(index);
            var b = pNeighbourEdge.charAt(index);
            if(a === b)
                score += 6;
            else if((a === "G" && b === "L") || (a === "L" && b === "G"))
                score += 4;
            else if(a === "." || b === ".")
                score -= 1;
            else
                score -= 6;
        }

        return score;
    },

    Sub1ScoreBeachSandVisualJoin: function(pRecord, pLookup, pTiles, pX, pY) {
        if(!pRecord || !pRecord.visualEdges)
            return 0;

        var score = 0;
        var neighbours = [
            ["N", 0, -1, "S"],
            ["E", 1, 0, "W"],
            ["S", 0, 1, "N"],
            ["W", -1, 0, "E"]
        ];

        for(var index = 0; index < neighbours.length; ++index) {
            var dir = neighbours[index][0];
            var nx = pX + neighbours[index][1];
            var ny = pY + neighbours[index][2];
            var opposite = neighbours[index][3];
            var tileId = MapGen.Layers.Get(pTiles, nx, ny, -1);
            if(this.Sub1BeachTileMaskClass(pLookup, tileId) !== "S")
                continue;

            var neighbour = pLookup[String(tileId)];
            if(!neighbour || !neighbour.visualEdges)
                continue;

            score += this.Sub1ScoreVisualEdge(pRecord.visualEdges[dir], neighbour.visualEdges[opposite]);
            score += this.Sub1ScoreShapeEdge(
                (pRecord.shapeEdges || pRecord.edges || {})[dir],
                (neighbour.shapeEdges || neighbour.edges || {})[opposite]
            );
        }

        return score;
    },

    Sub1CandidateStyleBias: function(pFeature, pTileId) {
        if(pFeature === "quicksand") {
            if(pTileId === 107 || pTileId === 167)
                return -520;
        }

        if(pFeature === "beach") {
            if(pTileId === 336 || pTileId === 337 || pTileId === 339 || pTileId === 357)
                return -260;
            if(pTileId === 314)
                return -120;
            if(pTileId === 258 || pTileId === 293 || pTileId === 294)
                return 35;
            if(pTileId === 277 || pTileId === 279 || pTileId === 292)
                return 20;
        }

        if(pFeature === "ocean") {
            if(pTileId === 260 || pTileId === 280 || pTileId === 282 ||
                pTileId === 263 || pTileId === 361)
                return 20;
            if(pTileId === 244 || pTileId === 261 || pTileId === 341 ||
                pTileId === 364 || pTileId === 382)
                return 5;
        }

        return 0;
    },

    Sub1CandidateDirectionBias: function(pFeature, pTileId, pNorthClass, pEastClass, pSouthClass, pWestClass) {
        if(pFeature !== "ocean")
            return 0;

        var northWater = this.Sub1NormalizedClass(pNorthClass) === "water";
        var eastWater = this.Sub1NormalizedClass(pEastClass) === "water";
        var southWater = this.Sub1NormalizedClass(pSouthClass) === "water";
        var westWater = this.Sub1NormalizedClass(pWestClass) === "water";

        if(!northWater && eastWater && !southWater && !westWater) {
            if(pTileId === 260)
                return 260;
            if(pTileId === 280)
                return 140;
            if(pTileId === 244)
                return -260;
            if(pTileId === 282)
                return -120;
        }

        if(!northWater && !eastWater && southWater && !westWater) {
            if(pTileId === 242)
                return 220;
            if(pTileId === 261)
                return -180;
        }

        if(northWater && eastWater && !southWater && !westWater) {
            if(pTileId === 263 || pTileId === 280)
                return 90;
            if(pTileId === 244)
                return -120;
        }

        if(!northWater && eastWater && southWater && !westWater) {
            if(pTileId === 282)
                return 90;
            if(pTileId === 244)
                return 30;
            if(pTileId === 260)
                return -80;
        }

        if(!northWater && !eastWater && southWater && westWater) {
            if(pTileId === 261 || pTileId === 364)
                return 90;
        }

        if(northWater && !eastWater && !southWater && westWater) {
            if(pTileId === 341 || pTileId === 361 || pTileId === 382)
                return 90;
        }

        return 0;
    },

    Sub1RiverCorpusJoinBias: function(pGroup, pFeature, pTileId, pNorthTile, pWestTile) {
        if(pFeature !== "river" || !pGroup || !pGroup.corpusJoins)
            return 0;

        function joinScore(pTable, pPreviousTile, pCurrentTile) {
            if(!pTable || pPreviousTile < 0)
                return 0;

            var count = Number(pTable[pPreviousTile + ">" + pCurrentTile] || 0);
            if(count > 0)
                return 220 + (Math.min(10, count) * 18);

            // Pixel-compatible but unobserved joins are still available for
            // genuinely new contours; they simply lose to a coherent shipped
            // sequence whenever one fits the same local class mask.
            return -280;
        }

        return joinScore(pGroup.corpusJoins.N, pNorthTile, pTileId) +
            joinScore(pGroup.corpusJoins.W, pWestTile, pTileId);
    },

    Sub1RiverCorpusJoinFits: function(pGroup, pFeature, pTileId, pNorthTile, pWestTile) {
        if(pFeature !== "river" || !pGroup || !pGroup.corpusJoins)
            return true;

        if(pNorthTile >= 0 && pGroup.corpusJoins.N &&
            !pGroup.corpusJoins.N[pNorthTile + ">" + pTileId])
            return false;
        if(pWestTile >= 0 && pGroup.corpusJoins.W &&
            !pGroup.corpusJoins.W[pWestTile + ">" + pTileId])
            return false;

        return true;
    },

    Sub1HasNearbyPlaced278: function(pPlaced, pX, pY) {
        if(!pPlaced)
            return false;

        for(var dy = -2; dy <= 0; ++dy) {
            for(var dx = -3; dx <= 3; ++dx) {
                if(dy === 0 && dx >= 0)
                    continue;
                if(dx === 0 && dy === 0)
                    continue;
                if(MapGen.Layers.Get(pPlaced, pX + dx, pY + dy, -1) === 278)
                    return true;
            }
        }

        return false;
    },

    Sub1PlacedRunLength: function(pPlaced, pX, pY, pTileId, pDx, pDy) {
        if(!pPlaced)
            return 0;

        var length = 0;
        var x = pX + pDx;
        var y = pY + pDy;

        while(MapGen.Layers.Get(pPlaced, x, y, -1) === pTileId) {
            ++length;
            x += pDx;
            y += pDy;
        }

        return length;
    },

    Sub1Reject278Candidate: function(pFeature, pCurrentClass, pTileId, pNorthTile, pWestTile, pPlaced, pX, pY) {
        if(pFeature !== "beach" ||
            this.Sub1NormalizedClass(pCurrentClass) !== "water" ||
            pTileId !== 278)
            return false;

        if(pWestTile !== 258 && pWestTile !== 259)
            return true;
        if(pNorthTile !== 256 && pNorthTile !== 257)
            return true;

        return this.Sub1HasNearbyPlaced278(pPlaced, pX, pY);
    },

    Sub1Reject298Candidate: function(pFeature, pCurrentClass, pTileId, pPlaced, pX, pY) {
        if(pFeature !== "beach" ||
            this.Sub1NormalizedClass(pCurrentClass) !== "water" ||
            pTileId !== 298)
            return false;

        // The Amiga sub1 references have 298 diagonal runs up to length 4 on
        // this axis, but not the longer stair-step generated beach artifact.
        return this.Sub1PlacedRunLength(pPlaced, pX, pY, 298, 1, -1) >= 4;
    },

    Sub1CandidateRepeatPenalty: function(pFeature, pCurrentClass, pTileId, pNorthTile, pWestTile, pNorthEastTile, pPlaced, pX, pY) {
        if(pFeature === "ocean" && pCurrentClass === "darkgrass") {
            var oceanPenalty = 0;

            if(pTileId === pWestTile)
                oceanPenalty += 30;
            if(pTileId === pNorthTile)
                oceanPenalty += 20;

            return oceanPenalty;
        }

        if(pFeature === "beach" &&
            this.Sub1NormalizedClass(pCurrentClass) === "water" &&
            pTileId === 278 &&
            pPlaced) {
            return this.Sub1HasNearbyPlaced278(pPlaced, pX, pY) ? 520 : 0;
        }

        if(pFeature !== "beach" || pCurrentClass !== "sand")
            return 0;

        var penalty = 0;

        if(pTileId === pWestTile)
            penalty += 65;
        if(pTileId === pNorthTile)
            penalty += 35;
        if(pTileId === 258 && pNorthEastTile === 258)
            penalty += 180;
        if(pTileId === 258 &&
            (pNorthEastTile === 293 ||
                pNorthEastTile === 294 ||
                pNorthEastTile === 295 ||
                pNorthEastTile === 279))
            penalty += 420;

        return penalty;
    },

    RepairSub1GrammarBeachDryGrassEdges: function(pContext, pChars, pTiles) {
        if(!this.IsGrammarBeachProfile(pContext))
            return 0;

        // Procedural joined coasts are resolved once, after overlays, by the
        // generated-edge constraint solver. The routines below are retained
        // only for the exact authored mapm5/mapm6/mapm8 motifs.
        if(this.IsComposedSub1BeachCoast && this.IsComposedSub1BeachCoast(pContext))
            return 0;

        var core = MapGen.Terrain.Smoothing.Core;
        var lookup = this.Sub1RecordLookup(this.Sub1EdgeData());
        var changed = 0;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                var ch = core.GetChar(pChars, x, y, this.Chars.ground);

                if(ch === this.Chars.water ||
                    ch === this.Chars.beach ||
                    ch === this.Chars.bank ||
                    ch === this.Chars.path ||
                    ch === this.Chars.tree)
                    continue;
                if(!this.CanRetileSub1BeachDryGrassEdgeCell(pContext, x, y))
                    continue;

                var mask = this.Sub1ClassMaskAt(pContext, pChars, x, y, "beach", "darkgrass");
                if(mask !== "GSSG" && mask !== "GSGG") {
                    mask = this.Sub1BeachTileClassMaskAt(lookup, pTiles, x, y);
                    if(mask !== "GSSG" && mask !== "GSGG")
                        continue;
                }

                var northTile = y > 0 ? MapGen.Layers.Get(pTiles, x, y - 1, -1) : -1;
                var eastTile = x < pContext.Width - 1 ? MapGen.Layers.Get(pTiles, x + 1, y, -1) : -1;
                var tileId = this.Sub1GrammarBeachDryGrassEdgeTileForMask(pContext, x, y, mask, northTile, eastTile);
                if(tileId < 0)
                    continue;

                core.SetTile(pTiles, x, y, tileId);
                ++changed;
            }
        }

        changed += this.RepairSub1GrammarBeachGrassContourTiles(pContext, pChars, pTiles, lookup);
        changed += this.RepairSub1GrammarBeachFinalGrassSideMasks(pContext, pTiles, lookup);
        changed += this.StampSub1GrammarBeachBankTemplateTiles(pContext, pTiles, lookup);
        changed += this.NormalizeSub1GrammarBeachBankLeftTemplateTiles(pContext, pTiles, lookup);
        changed += this.RepairSub1GrammarBeachFinalSeamArtifacts(pContext, pTiles, lookup);
        changed += this.StampSub1Mapm8CornerCoveTiles(pContext, pTiles);
        changed += this.StampSub1Mapm5TopBankTiles(pContext, pTiles);
        changed += this.StampSub1Mapm6ChannelBankTiles(pContext, pTiles);
        changed += this.StampSub1AuthoredQuicksandPatchTiles(pContext, pTiles);

        return changed;
    },

    Sub1GrammarBeachSandMaskTiles: function() {
        return {
            // N,E,S,W class masks. These are derived from the official Amiga
            // sub1 beach maps instead of raw pixel edges alone.
            GGGG: { 277: true, 314: true },
            GGSG: { 257: true },
            GGSS: { 257: true },
            GGWG: { 279: true },
            GSGG: { 256: true },
            GSSG: { 256: true, 257: true, 277: true, 292: true },
            GSSS: { 256: true, 257: true },
            GWSS: { 293: true },
            GWWS: { 258: true },
            SGGS: { 279: true },
            SGSS: { 257: true },
            SSGG: { 336: true },
            SSGS: { 257: true, 258: true },
            SSSG: { 256: true, 257: true },
            SSSS: { 256: true, 257: true },
            SSWS: { 256: true, 257: true },
            SWGS: { 259: true },
            SWSS: { 293: true, 294: true },
            SWWG: { 279: true },
            SWWS: { 258: true, 259: true, 279: true, 295: true }
        };
    },

    Sub1GrammarBeachWaterEdgeTiles: function() {
        return {
            258: true,
            259: true,
            279: true,
            293: true,
            294: true,
            295: true
        };
    },

    Sub1GrammarBeachWaterMaskTiles: function() {
        return {
            // Mined from shipped Amiga junsub1 beach maps (mapm5/mapm6/mapm8).
            // Masks are N,E,S,W class contexts for water-center cells.
            278: { GWWS: true, SGGS: true, SWWS: true },
            297: {
                GGGG: true, GGGW: true, GGWG: true, GGWW: true,
                GWGG: true, GWWG: true, GWWW: true,
                SWWG: true, SWWS: true, SWWW: true,
                WGGW: true, WGWG: true,
                WGWW: true, WWGG: true, WWGW: true, WWWG: true,
                WWWS: true, WWWW: true
            },
            298: {
                GGWW: true, GWWG: true, GWWW: true, WGGG: true,
                WGGW: true, WGWW: true, WWGW: true, WWWG: true,
                WWWS: true, WWWW: true
            },
            316: { SWWG: true, WGWW: true, WWWW: true },
            317: {
                GGGW: true, GGWG: true, GGWW: true, GWGG: true,
                GWGW: true, GWWG: true, GWWW: true, SWWW: true,
                WGGG: true, WGGW: true, WGWG: true, WGWW: true,
                WWGG: true, WWGW: true, WWWG: true, WWWS: true,
                WWWW: true
            }
        };
    },

    Sub1GrammarBeachSandTileFitsMask: function(pContext, pChars, pX, pY, pFeature, pCurrentClass, pTileId) {
        if(pFeature !== "beach" ||
            this.Sub1NormalizedClass(pCurrentClass) !== "sand")
            return true;

        var mask = this.Sub1ClassMaskAt(pContext, pChars, pX, pY, pFeature, pCurrentClass);
        var maskTiles = this.Sub1GrammarBeachSandMaskTiles()[mask];
        var edgeTiles = this.Sub1GrammarBeachWaterEdgeTiles();

        if(maskTiles)
            return !!maskTiles[pTileId];

        if(mask.indexOf("W") >= 0 && edgeTiles[pTileId])
            return false;

        return false;
    },

    Sub1GrammarBeachWaterTileFitsMask: function(pContext, pChars, pX, pY, pFeature, pCurrentClass, pTileId) {
        if(pFeature !== "beach" ||
            this.Sub1NormalizedClass(pCurrentClass) !== "water")
            return true;

        var mask = this.Sub1ClassMaskAt(pContext, pChars, pX, pY, pFeature, pCurrentClass);
        var maskTiles = this.Sub1GrammarBeachWaterMaskTiles()[pTileId];

        return !!(maskTiles && maskTiles[mask]);
    },

    Sub1GrammarBeachMaskBias: function(pFeature, pCurrentClass, pTileId, pMask, pNorthTile, pWestTile) {
        if(pFeature !== "beach")
            return 0;

        var cls = this.Sub1NormalizedClass(pCurrentClass);

        if(cls === "darkgrass") {
            if(pMask === "GSGG") {
                if((pNorthTile === 252 || pNorthTile === 272) && pTileId === 272)
                    return 360;
                if(pTileId === 252)
                    return 220;
                if(pTileId === 335)
                    return 160;
            }

            if(pMask === "GSSG") {
                if(pNorthTile === 252 && pTileId === 272)
                    return 360;
                if(pTileId === 255)
                    return 260;
                if(pTileId === 252)
                    return 180;
            }

            return 0;
        }

        if(cls !== "sand")
            return 0;

        if(pMask === "GSSG") {
            if((pNorthTile === 252 || pNorthTile === 272) && pTileId === 292)
                return 420;
            if(pTileId === 292)
                return 260;
            if(pTileId === 277)
                return 80;
        }

        if(pMask === "SWSS") {
            if(pNorthTile === 293 && pTileId === 294)
                return 260;
            if(pNorthTile !== 293 && pNorthTile !== 294 && pTileId === 293)
                return 220;
        }

        if((pMask === "SWSG" || pMask === "GWSS") && pTileId === 293)
            return 220;

        if(pMask === "GWWS" && pTileId === 258)
            return 280;

        if(pMask === "SWWG" && pTileId === 279)
            return 280;

        if(pMask === "SWWS") {
            if(pNorthTile === 293 || pNorthTile === 294) {
                if(pTileId === 295)
                    return 520;
                if(pTileId === 258 || pTileId === 279)
                    return -260;
            }
            if(pTileId === 258)
                return 460;
            if(pTileId === 279)
                return 240;
            if(pTileId === 295)
                return 40;
        }

        if(pMask === "SSWS" && (pTileId === 256 || pTileId === 257))
            return 160;

        return 0;
    },

    Sub1RejectGrammarBeachAdjacencyCandidate: function(pFeature, pCurrentClass, pTileId, pMask, pNorthTile, pWestTile) {
        if(pFeature !== "beach")
            return false;

        var cls = this.Sub1NormalizedClass(pCurrentClass);

        if(cls === "sand" &&
            pNorthTile === 294 &&
            pTileId === 293)
            return true;

        if(cls === "water" &&
            pTileId === 297 &&
            (pWestTile === 256 || pWestTile === 257 ||
                pWestTile === 258 || pWestTile === 259))
            return true;

        return false;
    },

    Sub1RejectCandidate: function(pContext, pFeature, pTileId, pCurrentClass, pChars, pX, pY) {
        if(!pContext ||
            !pContext.Profile ||
            pContext.Profile.TargetPackProfile !== "grammar_beach")
            return false;

        if(pFeature === "ocean")
            return !this.Sub1OceanAllowedTiles()[pTileId];

        if(pFeature === "beach" &&
            this.Sub1NormalizedClass(pCurrentClass) === "sand" &&
            pTileId === 278)
            return true;

        if(pFeature === "beach" && (pTileId === 271 || pTileId === 314))
            return true;

        if(!this.Sub1GrammarBeachSandTileFitsMask(pContext, pChars, pX, pY, pFeature, pCurrentClass, pTileId))
            return true;

        if(!this.Sub1GrammarBeachWaterTileFitsMask(pContext, pChars, pX, pY, pFeature, pCurrentClass, pTileId))
            return true;

        if(pFeature === "beach" &&
            this.Sub1NormalizedClass(pCurrentClass) === "sand" &&
            pTileId === 294 &&
            this.Sub1ClassMaskAt(pContext, pChars, pX, pY, pFeature, pCurrentClass).charAt(2) === "W")
            return true;

        if(pFeature === "beach" &&
            this.Sub1NormalizedClass(pCurrentClass) === "darkgrass")
            return !this.Sub1GrammarBeachDryGrassEdgeFits(pContext, pChars, pX, pY, pFeature, pCurrentClass, pTileId);

        return pFeature === "beach" &&
            (pTileId === 252 || pTileId === 255 || pTileId === 272 ||
                pTileId === 275 || pTileId === 276 || pTileId === 313 ||
                pTileId === 335 || pTileId === 337 || pTileId === 338 ||
                pTileId === 339 || pTileId === 355 || pTileId === 356 ||
                pTileId === 357 || pTileId === 383);
    },

    ApplySub1PixelEdgeRules: function(pContext, pChars, pTiles) {
        var data = this.Sub1EdgeData();
        if(!data)
            return 0;

        var core = MapGen.Terrain.Smoothing.Core;
        var placed = MapGen.Layers.Create(pContext.Width, pContext.Height, -1);
        var lookup = this.Sub1RecordLookup(data);
        var applied = 0;
        var scoreEdge = cachedEdgeScore(this.Sub1ScoreEdge);
        var scoreVisual = cachedEdgeScore(this.Sub1ScoreVisualEdge);
        var scoreShape = cachedEdgeScore(this.Sub1ScoreShapeEdge);
        var passLimit = this.IsGrammarBeachProfile(pContext) ? 4 : 5;

        for(var y = 0; y < pContext.Height; ++y) {
            for(var x = 0; x < pContext.Width; ++x) {
                var feature = this.Sub1FeatureForCharCell(pContext, pChars, x, y);
                if(!feature)
                    continue;

                var group = this.Sub1GroupForFeature(data, feature);
                if(!group || !group.byCenter || !group.tiles)
                    continue;

                var ch = core.GetChar(pChars, x, y, this.Chars.ground);
                var cls = this.Sub1ClassForChar(feature, ch);
                var candidates = group.byCenter[cls] || [];
                if(!candidates.length)
                    continue;
                if(!this.Sub1ShouldApplyPixelEdge(pContext, pChars, x, y, feature, ch))
                    continue;

                var northTile = y > 0 ? MapGen.Layers.Get(placed, x, y - 1, -1) : -1;
                var westTile = x > 0 ? MapGen.Layers.Get(placed, x - 1, y, -1) : -1;
                var northEastTile = (y > 0 && x < pContext.Width - 1) ? MapGen.Layers.Get(placed, x + 1, y - 1, -1) : -1;
                var northRec = northTile >= 0 ? lookup[String(northTile)] : null;
                var westRec = westTile >= 0 ? lookup[String(westTile)] : null;
                var northClass = this.Sub1ClassAtOrSelf(pContext, pChars, x, y - 1, feature, cls);
                var eastClass = this.Sub1ClassAtOrSelf(pContext, pChars, x + 1, y, feature, cls);
                var southClass = this.Sub1ClassAtOrSelf(pContext, pChars, x, y + 1, feature, cls);
                var westClass = this.Sub1ClassAtOrSelf(pContext, pChars, x - 1, y, feature, cls);
                var northHint = this.Sub1GlyphForClass(northClass);
                var eastHint = this.Sub1GlyphForClass(eastClass);
                var southHint = this.Sub1GlyphForClass(southClass);
                var westHint = this.Sub1GlyphForClass(westClass);
                var classMask = northHint + eastHint + southHint + westHint;
                var bestTile = candidates[0];
                var bestScore = -1e9;
                var foundCandidate = false;

                // First exhaust candidates that form complete N/W joins seen
                // in the original sub1 maps. Only relax to a new join when no
                // observed continuation can satisfy the local class mask. The final
                // pass retains the penalized fallback for non-beach profiles.
                for(var pass = 0; pass < passLimit && !foundCandidate; ++pass) {
                    var fallback = pass === 4;
                    var strictCorpusJoin = pass < 2;
                    var strictSameClass = (pass % 2) === 0;

                    for(var index = 0; index < candidates.length; ++index) {
                        var tileId = candidates[index];
                        if(this.Sub1RejectCandidate(pContext, feature, tileId, cls, pChars, x, y))
                            continue;
                        if(this.Sub1RejectGrammarBeachAdjacencyCandidate(feature, cls, tileId, classMask, northTile, westTile))
                            continue;
                        if(this.Sub1Reject278Candidate(feature, cls, tileId, northTile, westTile, placed, x, y))
                            continue;
                        if(this.Sub1Reject298Candidate(feature, cls, tileId, placed, x, y))
                            continue;
                        if(strictCorpusJoin &&
                            !this.Sub1RiverCorpusJoinFits(group, feature, tileId, northTile, westTile))
                            continue;

                        var rec = group.tiles[String(tileId)];
                        if(!rec || !rec.edges)
                            continue;
                        if(!fallback && (!this.Sub1CandidateFitsDirection(rec, "N", cls, northClass, strictSameClass) ||
                            !this.Sub1CandidateFitsDirection(rec, "E", cls, eastClass, strictSameClass) ||
                            !this.Sub1CandidateFitsDirection(rec, "S", cls, southClass, strictSameClass) ||
                            !this.Sub1CandidateFitsDirection(rec, "W", cls, westClass, strictSameClass)))
                            continue;

                        var score = 0;
                        score += scoreEdge(rec.edges.N, northRec ? northRec.edges.S : null, northRec ? null : northHint);
                        score += scoreEdge(rec.edges.W, westRec ? westRec.edges.E : null, westRec ? null : westHint);
                        score += scoreEdge(rec.edges.E, null, eastHint);
                        score += scoreEdge(rec.edges.S, null, southHint);
                        if((feature === "beach" && this.Sub1NormalizedClass(cls) === "sand") ||
                            feature === "river") {
                            if(northRec &&
                                (feature === "river" || this.Sub1NormalizedClass(northClass) === "sand") &&
                                northRec.visualEdges && rec.visualEdges) {
                                score += scoreVisual(rec.visualEdges.N, northRec.visualEdges.S);
                                score += scoreShape(
                                    (rec.shapeEdges || rec.edges || {}).N,
                                    (northRec.shapeEdges || northRec.edges || {}).S
                                );
                            }
                            if(westRec &&
                                (feature === "river" || this.Sub1NormalizedClass(westClass) === "sand") &&
                                westRec.visualEdges && rec.visualEdges) {
                                score += scoreVisual(rec.visualEdges.W, westRec.visualEdges.E);
                                score += scoreShape(
                                    (rec.shapeEdges || rec.edges || {}).W,
                                    (westRec.shapeEdges || westRec.edges || {}).E
                                );
                            }
                        }
                        score += this.Sub1CandidateStyleBias(feature, tileId);
                        score += this.Sub1CandidateDirectionBias(feature, tileId, northClass, eastClass, southClass, westClass);
                        score += this.Sub1RiverCorpusJoinBias(group, feature, tileId, northTile, westTile);
                        score += this.Sub1GrammarBeachMaskBias(feature, cls, tileId, classMask, northTile, westTile);
                        score -= this.Sub1CandidateRepeatPenalty(feature, cls, tileId, northTile, westTile, northEastTile, placed, x, y);
                        score -= fallback ?
                            this.Sub1CandidatePenaltyForDirection(rec, "N", cls, northClass) +
                            this.Sub1CandidatePenaltyForDirection(rec, "E", cls, eastClass) +
                            this.Sub1CandidatePenaltyForDirection(rec, "S", cls, southClass) +
                            this.Sub1CandidatePenaltyForDirection(rec, "W", cls, westClass) : pass * 1000;
                        score += (MapGen.Random.HashTile(pContext.Seed, x, y, (fallback ? 6101 : 5101) + tileId) & 7) * 0.001;

                        if(score > bestScore) {
                            bestScore = score;
                            bestTile = tileId;
                            foundCandidate = true;
                        }
                    }
                }


                if(!foundCandidate)
                    continue;

                core.SetTile(pTiles, x, y, bestTile);
                MapGen.Layers.Set(placed, x, y, bestTile);
                ++applied;
            }
        }

        applied += this.RepairSub1GrammarBeachDryGrassEdges(pContext, pChars, pTiles);

        return applied;
    },

        Sub1ModuleLoaded: true
    };

    for(var key in ext) {
        if(ext.hasOwnProperty(key))
            pJungle[key] = ext[key];
    }
})(MapGen.Terrain.Smoothing.Jungle);
