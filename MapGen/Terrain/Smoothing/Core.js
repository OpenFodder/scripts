var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};

MapGen.Terrain.Smoothing.Core = {

    Pick: function(pContext, pItems, pX, pY, pSalt) {
        if(!pItems || !pItems.length)
            return 0;

        return pItems[MapGen.Random.HashTile(pContext.Seed, pX, pY, pSalt || 0) % pItems.length];
    },

    PickTileEntry: function(pContext, pEntry, pX, pY, pSalt) {
        var tiles = [];

        for(var index = 0; index < pEntry.tiles.length; ++index) {
            var tile = Number(pEntry.tiles[index].tile);
            if(!isNaN(tile))
                tiles.push(tile);
        }

        return this.Pick(pContext, tiles, pX, pY, pSalt);
    },

    PickMatrixRow: function(pContext, pMatrix, pX, pY, pSalt) {
        if(!pMatrix || !pMatrix.length)
            return null;

        return pMatrix[MapGen.Random.HashTile(pContext.Seed, pX, pY, pSalt || 0) % pMatrix.length];
    },

    Contains: function(pItems, pValue) {
        for(var index = 0; index < pItems.length; ++index) {
            if(pItems[index] === pValue)
                return true;
        }

        return false;
    },

    GetChar: function(pChars, pX, pY, pDefault) {
        if(!pChars || pX < 0 || pY < 0 || pX >= pChars.length || pY >= pChars[pX].length)
            return pDefault;

        return pChars[pX][pY];
    },

    PromoteCharmapEdges: function(pContext, pChars, pOpts) {
        // Per-biome CellChar fires proximity rules (ice IsBankGroundCell,
        // jungle riverBank from MarkBanks) that paint shallow/bank/wet on
        // every cell within a few tiles of inland water. On the literal
        // perimeter that produces three failure modes:
        //   1. Phantom bank surrounded entirely by water — corner cells
        //      where the only thing within proximity radius is inland
        //      water, so the cell itself reads as bank but its 3x3 is
        //      pure water (e.g. seed 3977742363, top-left = ~ with all
        //      neighbours = .). Should render as water, not bank.
        //   2. Phantom bank surrounded entirely by inland (no water in
        //      3x3) — the proximity rule fired from water 2+ cells away.
        //      Should render as land, not bank.
        //   3. Bank in a mixed neighbourhood — genuine bank-to-water
        //      shoreline. Leave alone.
        //
        // Tally water vs land in the 3x3 (ignoring same-class bank/wet
        // neighbours, which are also phantoms) and pick the dominant
        // class as the replacement.
        if(!pChars || !pOpts) return 0;
        var demote = {};
        var demoteList = pOpts.demote || [];
        for(var i = 0; i < demoteList.length; ++i)
            demote[demoteList[i]] = true;
        var waterChars = {};
        var waterList = pOpts.water || [];
        for(var wi = 0; wi < waterList.length; ++wi)
            waterChars[waterList[wi]] = true;
        var canonicalWater = waterList.length ? waterList[0] : undefined;

        var W = pContext.Width;
        var H = pContext.Height;
        var promoted = 0;

        function classifyNeighbourhood(x, y) {
            var hasWater = false;
            var hasLand = false;
            for(var nx = x - 1; nx <= x + 1; ++nx) {
                if(nx < 0 || nx >= W) continue;
                for(var ny = y - 1; ny <= y + 1; ++ny) {
                    if(ny < 0 || ny >= H) continue;
                    if(nx === x && ny === y) continue;
                    var c = pChars[nx] && pChars[nx][ny];
                    if(c === undefined) continue;
                    if(waterChars[c]) hasWater = true;
                    else if(!demote[c]) hasLand = true;
                }
            }
            return { water: hasWater, land: hasLand };
        }

        function visit(x, y) {
            var current = pChars[x] && pChars[x][y];
            if(current === undefined || !demote[current]) return;
            var n = classifyNeighbourhood(x, y);
            var replacement;
            if(!n.water) {
                var blocked = MapGen.Layers.Get(pContext.Layers.blocked, x, y, 0);
                replacement = blocked ? pOpts.tree : pOpts.ground;
            }
            else if(!n.land) {
                replacement = canonicalWater;
            }
            else {
                return;
            }
            if(replacement === undefined) return;
            MapGen.Layers.Set(pChars, x, y, replacement);
            ++promoted;
        }

        for(var x = 0; x < W; ++x) {
            visit(x, 0);
            visit(x, H - 1);
        }
        for(var y = 0; y < H; ++y) {
            visit(0, y);
            visit(W - 1, y);
        }

        if(promoted)
            MapGen.Context.AddLog(pContext, "Promoted " + promoted + " perimeter charmap cells out of shallow/bank");

        return promoted;
    },

    SetTile: function(pTiles, pX, pY, pTile) {
        if(!MapGen.Layers.InBounds(pTiles, pX, pY))
            return;

        var tile = Number(pTile);
        if(isNaN(tile))
            return;

        MapGen.Layers.Set(pTiles, pX, pY, tile);
    },

    SetTileIfAllowed: function(pTiles, pX, pY, pTile, pProtected) {
        if(pProtected && pProtected(pX, pY))
            return;

        this.SetTile(pTiles, pX, pY, pTile);
    },

    TransitionBitmask: function(pChars, pX, pY, pRule) {
        var centerChars = [pRule.center];
        var groundChars = [pRule.ground];
        var allowed = [];
        var centerAliases = pRule.centerAliases || [];
        var groundAliases = pRule.groundAliases || [];
        var extras = pRule.extras || [];
        var offsets = [
            [-1, -1], [0, -1], [1, -1],
            [-1, 0], [1, 0],
            [-1, 1], [0, 1], [1, 1]
        ];
        var bits = "";

        for(var centerIndex = 0; centerIndex < centerAliases.length; ++centerIndex)
            centerChars.push(centerAliases[centerIndex]);
        for(var groundIndex = 0; groundIndex < groundAliases.length; ++groundIndex)
            groundChars.push(groundAliases[groundIndex]);

        for(var allowedCenter = 0; allowedCenter < centerChars.length; ++allowedCenter)
            allowed.push(centerChars[allowedCenter]);
        for(var allowedGround = 0; allowedGround < groundChars.length; ++allowedGround)
            allowed.push(groundChars[allowedGround]);
        for(var extraIndex = 0; extraIndex < extras.length; ++extraIndex)
            allowed.push(extras[extraIndex]);

        for(var index = 0; index < offsets.length; ++index) {
            var value = this.GetChar(pChars, pX + offsets[index][0], pY + offsets[index][1], pRule.center);

            if(!this.Contains(allowed, value))
                return null;

            bits += this.Contains(centerChars, value) ? "0" : "1";
        }

        return bits;
    },

    ApplyTransitionRule: function(pContext, pChars, pTiles, pRule) {
        var data = pRule.data;

        if(!data || !data.bitmask)
            return 0;

        var applied = 0;
        var unmatched = {};
        var trace = [];

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(this.GetChar(pChars, x, y, "") !== pRule.center)
                    continue;

                var bitmask = this.TransitionBitmask(pChars, x, y, pRule);
                if(bitmask === null)
                    continue;
                if(pRule.bitmaskTransform)
                    bitmask = pRule.bitmaskTransform(bitmask, pChars, x, y);

                var matched = false;
                var bestEntry = null;
                var bestEntryIdx = 0;
                var bestDist = 9;
                var bestWeighted = 99;
                // Superset preference: when our bm has ground bits at certain
                // directions, a fallback tile whose bm has ground bits at
                // (at least) those same directions preserves the visible
                // shoreline. Hamming-distance alone tends to pick 00000000
                // for sparse boundary patterns like 00010000, painting a
                // fully-wet square where the cell actually has a ground
                // neighbour. Track the best superset separately and prefer
                // it when the plain hamming match is the all-zeros fill.
                var bestSupersetEntry = null;
                var bestSupersetIdx = 0;
                var bestSupersetExcess = 9;
                // bm bit positions: 0=NW 1=N 2=NE 3=W 4=E 5=SW 6=S 7=SE.
                // Cardinal lies cover 4-8 pixels of the cell border; corner
                // lies only touch a diagonal corner pixel. Weight cardinal
                // mismatches 3x so a single cardinal lie loses to two
                // corner lies (e.g. target 11010000 picks tile 81 with two
                // corner lies over tile 137 with one cardinal-W lie that
                // would streak deep water along the W edge of a cell whose
                // W neighbour is actually bank).
                var bitWeights = [1, 3, 1, 3, 3, 1, 3, 1];
                for(var entryIndex = 0; entryIndex < data.bitmask.length; ++entryIndex) {
                    var entry = data.bitmask[entryIndex];
                    if(entry.bm === bitmask) {
                        var tile = this.PickTileEntry(pContext, entry, x, y, pRule.salt || entryIndex);
                        this.SetTile(pTiles, x, y, tile);
                        ++applied;
                        matched = true;
                        trace.push({ x: x, y: y, bm: bitmask, tile: tile });
                        break;
                    }

                    // Track closest bm by hamming distance for fallback.
                    var dist = 0;
                    var weighted = 0;
                    var isSuperset = true;
                    var excess = 0;
                    for(var bi = 0; bi < entry.bm.length; ++bi) {
                        var ourBit = bitmask.charAt(bi);
                        var theirBit = entry.bm.charAt(bi);
                        if(theirBit !== ourBit) {
                            ++dist;
                            weighted += bitWeights[bi];
                        }
                        if(ourBit === '1' && theirBit !== '1')
                            isSuperset = false;
                        if(theirBit === '1' && ourBit !== '1')
                            ++excess;
                    }
                    if(weighted < bestWeighted || (weighted === bestWeighted && dist < bestDist)) {
                        bestDist = dist;
                        bestWeighted = weighted;
                        bestEntry = entry;
                        bestEntryIdx = entryIndex;
                    }
                    if(isSuperset && excess < bestSupersetExcess) {
                        bestSupersetExcess = excess;
                        bestSupersetEntry = entry;
                        bestSupersetIdx = entryIndex;
                    }
                }

                // Hamming fallback: procedural maps generate thin/isolated patterns
                // (e.g. 00001011) that don't appear in retail tilesets. Use the
                // closest-bm rule entry so the cell still gets a transition tile
                // instead of falling back to the flat fill tile.
                //
                // Superset preference: if our bm has any ground bits, prefer a
                // superset tile (one whose ground bits include all of ours)
                // over a plain hamming match. The hamming-1 fallback for a
                // sparse pattern like 00010000 is 00000000 (fully wet square),
                // which paints no shoreline at all - visually wrong because
                // the cell genuinely has a ground neighbour at W. A superset
                // like 11010100 paints slightly more shoreline than reality
                // (NW+W+SW vs just W), but never paints shoreline where we
                // had open water/wet, which is the disruptive failure mode.
                var fallbackThreshold = (typeof pRule.bmFallbackThreshold === "number") ? pRule.bmFallbackThreshold : 2;
                var supersetThreshold = 4;
                var ourGroundBits = 0;
                for(var gb = 0; gb < bitmask.length; ++gb) {
                    if(bitmask.charAt(gb) === '1') ++ourGroundBits;
                }
                // Only prefer the superset tile at the map boundary. Off-map
                // neighbours default to pRule.center, so superset's "extra"
                // ground bits land on imaginary cells nobody can see. Inside
                // the map those extra bits cover real wet/water cells, which
                // makes the rendered tile lie about its neighbours.
                var atBoundary = (x === 0 || y === 0 || x === pContext.Width - 1 || y === pContext.Height - 1);
                var useSuperset = !matched && atBoundary && ourGroundBits > 0 && bestSupersetEntry &&
                    bestSupersetExcess <= supersetThreshold &&
                    (!bestEntry || bestDist > fallbackThreshold || /^0+$/.test(bestEntry.bm));
                if(useSuperset) {
                    bestEntry = bestSupersetEntry;
                    bestEntryIdx = bestSupersetIdx;
                    bestDist = bestSupersetExcess;
                }
                if(!matched && bestEntry && bestDist <= (useSuperset ? supersetThreshold : fallbackThreshold)) {
                    var fbTile = this.PickTileEntry(pContext, bestEntry, x, y, pRule.salt || bestEntryIdx);
                    this.SetTile(pTiles, x, y, fbTile);
                    ++applied;
                    matched = true;
                    trace.push({ x: x, y: y, bm: bitmask, tile: fbTile, fallback: bestEntry.bm, dist: bestDist });
                }

                if(!matched) {
                    if(!unmatched[bitmask])
                        unmatched[bitmask] = { count: 0, samples: [] };
                    unmatched[bitmask].count++;
                    if(unmatched[bitmask].samples.length < 5)
                        unmatched[bitmask].samples.push({ x: x, y: y });
                }
            }
        }

        pRule.unmatched = unmatched;
        pRule.trace = trace;
        return applied;
    },

    // ----- Wang-Tile edge matcher -----
    EdgeGlyphsDisjoint: function(pA, pB) {
        if(pA === "." || pB === ".")
            return false;

        if(pA === "S")
            return pB === "W" || pB === "e";
        if(pB === "S")
            return pA === "W" || pA === "e";
        if(pA === "I")
            return pB === "W";
        if(pB === "I")
            return pA === "W";

        return false;
    },

    CountEdgeGlyphs: function(pEdge, pGlyphs) {
        var count = 0;
        for(var i = 0; i < pEdge.length; ++i) {
            if(pGlyphs.indexOf(pEdge.charAt(i)) >= 0)
                ++count;
        }
        return count;
    },

    ScoreEdgeContext: function(pCandidateEdge, pHintGlyph) {
        if(!pHintGlyph)
            return 0;

        if(pHintGlyph === "e") {
            var deep = this.CountEdgeGlyphs(pCandidateEdge, "W");
            var ice = this.CountEdgeGlyphs(pCandidateEdge, "I");
            var shallowScore = deep > 3 ? (deep - 3) * -80 : 0;
            shallowScore += ice > 4 ? (ice - 4) * -80 : 0;
            return shallowScore;
        }
        if(pHintGlyph === "I") {
            // Only DEEP water (`W`) is wrong against an ice hint; shallow (`e`)
            // is class-adjacent in the Wang chain (snow ↔ ice ↔ shallow ↔ deep)
            // and shouldn't be penalised. Mirrors C++ IceEdgeMatcher.cpp:153.
            // RCA 2026-06-12 cluster 1.
            var water = this.CountEdgeGlyphs(pCandidateEdge, "W");
            return water > 1 ? (water - 1) * -90 : 0;
        }
        if(pHintGlyph === "S") {
            var waterOnSnow = this.CountEdgeGlyphs(pCandidateEdge, "We");
            return waterOnSnow > 1 ? (waterOnSnow - 1) * -90 : 0;
        }
        if(pHintGlyph === "W") {
            var land = this.CountEdgeGlyphs(pCandidateEdge, "SI");
            return land > 3 ? (land - 3) * -80 : 0;
        }

        return 0;
    },

    // Score a single 16-char edge of a candidate tile against a neighbour's
    // facing edge (already placed) or against a class hint (unplaced cell).
    // Returns a numeric score; higher is better. Keep this aligned with the
    // native IceEdgeMatcher scorer because polish uses it after native tiling.
    ScoreEdgeMatch: function(pCandidateEdge, pNeighbourEdge, pHintGlyph) {
        if(pNeighbourEdge !== null && pNeighbourEdge !== undefined) {
            var edgeScore = 0;
            if(pCandidateEdge === pNeighbourEdge) {
                edgeScore = 100;
            }
            else {
                var same = 0;
                var bad = 0;
                for(var i = 0; i < 16; ++i) {
                    var candidateGlyph = pCandidateEdge.charAt(i);
                    var neighbourGlyph = pNeighbourEdge.charAt(i);
                    if(candidateGlyph === neighbourGlyph)
                        ++same;
                    else if(this.EdgeGlyphsDisjoint(candidateGlyph, neighbourGlyph))
                        ++bad;
                }
                // Graduated: 0 matches = -50, 16 matches ~= +100. Stepped tiers
                // were blind to "almost matching" edges (anything <8 matches got
                // the same -50), so a tile with 7/16 land-class chars on its W
                // edge couldn't outscore one with 0/16 against a snow neighbour.
                //
                // Disjoint-class penalty: exact neighbours can still be visually
                // impossible even when both edges are uniformly "wrong" in the
                // same way. Without this, pure shallow fills (eeee...) beat
                // ice/shallow bank pieces next to a placed snow/ice edge because
                // they recover the generic -50 mismatch through east/south hints.
                edgeScore = -50 + (same * 150) / 16 - (bad * 4);
            }

            return edgeScore + this.ScoreEdgeHint(pCandidateEdge, pHintGlyph) +
                this.ScoreEdgeContext(pCandidateEdge, pHintGlyph);
        }

        return this.ScoreEdgeHint(pCandidateEdge, pHintGlyph) +
            this.ScoreEdgeContext(pCandidateEdge, pHintGlyph);
    },

    ScoreEdgeHint: function(pCandidateEdge, pHintGlyph) {
        if(!pHintGlyph)
            return 0;
        // Class adjacency: which edge glyphs are incompatible with the hint.
        // The atlas has no snow|deep or snow|shallow direct seams (water
        // always borders ice or shallow first). A tile whose unplaced-side
        // edge holds a disjoint class is "wrong-side-facing" — its water/snow
        // is painted on the side that needs the opposite class. Penalise
        // those chars individually so a heavily wrong-side tile can't win
        // on placed-edge match alone.
        // snow('S') ⟂ deep('W'), shallow('e')
        // ice('I')  ⟂ deep('W')
        // shallow('e') ⟂ snow('S')
        // deep('W') ⟂ snow('S'), ice('I')
        var disjoint = "";
        if(pHintGlyph === "S")      disjoint = "We";
        else if(pHintGlyph === "I") disjoint = "W";
        else if(pHintGlyph === "e") disjoint = "S";
        else if(pHintGlyph === "W") disjoint = "SI";

        // Soft mismatch: a class-adjacent feature glyph that has no business
        // sitting on a plain-water seam. Ice IS class-adjacent to shallow,
        // but if both cell and neighbour are plain shallow (no ice nearby),
        // ice content on the candidate's facing edge means the tile expects
        // an ice neighbour that isn't there — produces a visible seam break.
        // (E.g. tile 98 has ice across its E edge for the "ice on SE corner"
        // case; placed where E is just plain shallow it leaves a sharp edge.)
        var soft = "";
        if(pHintGlyph === "e") soft = "IW";
        // Note: do NOT mark `e` as soft-mismatch against `I` hint. Mirrors
        // C++ IceEdgeMatcher.cpp:118-120. RCA 2026-06-12 cluster 1.

        var n = 0;
        var bad = 0;
        var softCount = 0;
        for(var j = 0; j < 16; ++j) {
            var c = pCandidateEdge.charAt(j);
            if(c === pHintGlyph)
                ++n;
            else if(disjoint.indexOf(c) >= 0)
                ++bad;
            else if(soft.indexOf(c) >= 0)
                ++softCount;
        }
        // Hint match: +4 per matching char (caps at +64 so hints don't beat
        // a placed-edge exact match of +100). Disjoint-class penalty: -8 per
        // char so a tile with 6+ wrong-class chars loses ~50 points - enough
        // to overturn a near-match on the placed-edge side when a "wrong
        // side facing" tile would otherwise sneak in. Soft mismatch: -10 per
        // char - strong enough to override the placed-edge advantage of an
        // ice-on-E-corner tile (e.g. tile 98) when its E neighbour is plain
        // shallow without ice content.
        return (n * 4) - (bad * 8) - (softCount * 10);
    },

    EdgeRuleHintGlyph: function(pClass) {
        if(pClass === "snow")    return "S";
        if(pClass === "ice")     return "I";
        if(pClass === "shallow") return "e";
        if(pClass === "deep")    return "W";
        return null;
    },

    // Glyph -> contents bit, mirroring IceEdgeMatcher.cpp (S=1 I=2 e=4 W=8).
    EdgeGlyphBit: function(pGlyph) {
        if(pGlyph === "S") return 1;
        if(pGlyph === "I") return 2;
        if(pGlyph === "e") return 4;
        if(pGlyph === "W") return 8;
        return 0;
    },

    // Hand the authored atlas to the engine once (it is static). Re-pushed only
    // if a different atlas object appears. Returns true on success.
    PushIceEdgeAtlas: function(pEdgeData, pCharToClass) {
        if(this._iceAtlasPushedFor === pEdgeData)
            return true;
        try {
            var tileRecords = [];
            var tiles = pEdgeData.tiles;
            for(var id in tiles) {
                if(!tiles.hasOwnProperty(id)) continue;
                var rec = tiles[id];
                if(!rec || !rec.edges) continue;
                var centerGlyph = this.EdgeRuleHintGlyph(rec.center) || "";
                var contentsGlyphs = "";
                var contents = rec.contents || [];
                for(var ci = 0; ci < contents.length; ++ci)
                    contentsGlyphs += (this.EdgeRuleHintGlyph(contents[ci]) || "");
                var terrainEdges = rec.terrainEdges || rec.edges;
                tileRecords.push(id + "|" + centerGlyph + "|" + contentsGlyphs + "|" +
                    rec.edges.N + "|" + rec.edges.E + "|" + rec.edges.S + "|" + rec.edges.W + "|" +
                    terrainEdges.N + "|" + terrainEdges.E + "|" + terrainEdges.S + "|" + terrainEdges.W);
            }

            var byCenterRecords = [];
            var byCenter = pEdgeData.byCenter;
            for(var cls in byCenter) {
                if(!byCenter.hasOwnProperty(cls)) continue;
                var glyph = this.EdgeRuleHintGlyph(cls);
                if(!glyph) continue;
                byCenterRecords.push(glyph + ":" + (byCenter[cls] || []).join(","));
            }

            var charRecords = [];
            for(var ch in pCharToClass) {
                if(!pCharToClass.hasOwnProperty(ch)) continue;
                var cg = this.EdgeRuleHintGlyph(pCharToClass[ch]);
                if(!cg) continue;
                charRecords.push((ch === "__default__" ? "*" : ch) + "=" + cg);
            }

            Map.SetIceEdgeAtlas(tileRecords, byCenterRecords, charRecords);
            this._iceAtlasPushedFor = pEdgeData;
            return true;
        } catch(e) {
            return false;
        }
    },

    // Precompute the per-cell hint/required arrays in JS (so the engine needs no
    // callbacks), call the native matcher, then decode the tile grid.
    EncodeTileLayerCsv: function(pTiles, pWidth, pHeight) {
        var parts = [];
        var index = 0;
        for(var y = 0; y < pHeight; ++y) {
            for(var x = 0; x < pWidth; ++x) {
                var col = pTiles[x];
                parts[index++] = String(col ? col[y] : 0);
            }
        }
        return parts.join(",");
    },

    ApplyEdgeRuleNative: function(pContext, pChars, pTiles, pEdgeData, pCharToClass, pOptions) {
        if(!this.PushIceEdgeAtlas(pEdgeData, pCharToClass))
            return -1;

        var width = pContext.Width;
        var height = pContext.Height;
        var byCenter = pEdgeData.byCenter;
        var defaultClass = pCharToClass["__default__"] || "snow";
        var edgeHintAt = pOptions && pOptions.EdgeHintAt;
        var requiredRuleAt = pOptions && pOptions.RequiredRuleAt;
        var requiredCenterClassAt = pOptions && pOptions.RequiredCenterClassAt;
        var requiredContentsAt = pOptions && pOptions.RequiredContentsAt;
        var dirtyMask = pOptions && pOptions.DirtyMask;
        var dirtyRegion = pOptions && pOptions.DirtyRegion;
        var previousTiles = pOptions && pOptions.PreviousTiles;
        var masked = dirtyMask && previousTiles && dirtyMask.length >= width * height;
        if(masked && !Map.ApplyIceEdgeRuleMasked)
            return -1;
        var _prof = !!(pContext && pContext.ProfileTimings && pContext.Timings);
        var _tEdgeSub = _prof ? (new Date()).getTime() : 0;
        function _edgeSub(pLabel) {
            if(!_prof)
                return;
            var now = (new Date()).getTime();
            pContext.Timings.push({ label: pLabel, ms: now - _tEdgeSub });
            _tEdgeSub = now;
        }

        var cellCount = width * height;
        var charsParts = new Array(cellCount);
        var hintsParts = new Array(cellCount * 4);
        var reqCenterParts = new Array(cellCount);
        var reqContentsParts = new Array(cellCount);
        var hintIndex = 0;
        var applied = 0;
        var dirs = ["N", "W", "S", "E"];

        for(var y = 0; y < height; ++y) {
            for(var x = 0; x < width; ++x) {
                var index = y * width + x;
                var col = pChars[x];
                var ch = col ? col[y] : "";
                charsParts[index] = (ch && ch.length) ? ch.charAt(0) : "#";

                var cls = pCharToClass[ch] || defaultClass;
                if((!masked || dirtyMask.charAt(index) === "1") && byCenter[cls] && byCenter[cls].length)
                    ++applied;

                if(masked && dirtyMask.charAt(index) !== "1") {
                    hintsParts[hintIndex++] = "-";
                    hintsParts[hintIndex++] = "-";
                    hintsParts[hintIndex++] = "-";
                    hintsParts[hintIndex++] = "-";
                    reqCenterParts[index] = "-";
                    reqContentsParts[index] = "-";
                    continue;
                }

                for(var d = 0; d < 4; ++d) {
                    var g = edgeHintAt ? edgeHintAt(x, y, dirs[d]) : null;
                    hintsParts[hintIndex++] = (g && g.length) ? g.charAt(0) : "-";
                }

                var required = requiredRuleAt ? requiredRuleAt(x, y) : null;
                var rc = required ? required.CenterClass : (requiredCenterClassAt ? requiredCenterClassAt(x, y) : null);
                var rcGlyph = rc ? this.EdgeRuleHintGlyph(rc) : null;
                reqCenterParts[index] = rcGlyph ? rcGlyph : "-";

                var rct = required ? required.Contents : (requiredContentsAt ? requiredContentsAt(x, y) : null);
                if(rct && rct.length) {
                    var mask = 0;
                    for(var mi = 0; mi < rct.length; ++mi)
                        mask |= this.EdgeGlyphBit(this.EdgeRuleHintGlyph(rct[mi]));
                    reqContentsParts[index] = String.fromCharCode(65 + mask);
                } else {
                    reqContentsParts[index] = "-";
                }
            }
        }
        var charsStr = charsParts.join("");
        var hintsStr = hintsParts.join("");
        var reqCenterStr = reqCenterParts.join("");
        var reqContentsStr = reqContentsParts.join("");
        _edgeSub("IceRender.EdgeRule.Pack");

        var previousCsv = null;
        if(masked) {
            previousCsv = this.EncodeTileLayerCsv(previousTiles, width, height);
            _edgeSub("IceRender.EdgeRule.PreviousCsv");
        }

        var result;
        try {
            if(masked && dirtyRegion && Map.ApplyIceEdgeRuleMaskedRegion) {
                result = Map.ApplyIceEdgeRuleMaskedRegion(width, height, charsStr, hintsStr,
                    reqCenterStr, reqContentsStr, dirtyMask, previousCsv,
                    pContext.Seed >>> 0,
                    dirtyRegion.minX, dirtyRegion.minY, dirtyRegion.maxX, dirtyRegion.maxY);
                _edgeSub("IceRender.EdgeRule.NativeRegion");
            } else if(masked && Map.ApplyIceEdgeRuleMasked) {
                result = Map.ApplyIceEdgeRuleMasked(width, height, charsStr, hintsStr,
                    reqCenterStr, reqContentsStr, dirtyMask, previousCsv,
                    pContext.Seed >>> 0);
                _edgeSub("IceRender.EdgeRule.NativeMasked");
            } else {
                result = Map.ApplyIceEdgeRule(width, height, charsStr, hintsStr,
                    reqCenterStr, reqContentsStr, pContext.Seed >>> 0);
                _edgeSub("IceRender.EdgeRule.NativeFull");
            }
        } catch(e) {
            return -1;
        }
        if(!result || result.length !== width * height)
            return -1;

        for(var ty = 0; ty < height; ++ty) {
            for(var tx = 0; tx < width; ++tx)
                pTiles[tx][ty] = result[ty * width + tx];
        }
        _edgeSub("IceRender.EdgeRule.Decode");

        return applied;
    },

    ApplyEdgeRule: function(pContext, pChars, pTiles, pEdgeData, pCharToClass, pOptions) {
        if(!pEdgeData || !pEdgeData.tiles || !pEdgeData.byCenter)
            return 0;

        if(typeof Map === "undefined" || !Map.ApplyIceEdgeRule)
            throw "Native ice edge rule is unavailable";

        var nativeApplied = this.ApplyEdgeRuleNative(pContext, pChars, pTiles, pEdgeData, pCharToClass, pOptions);
        if(nativeApplied < 0)
            throw "Native ice edge rule failed";

        return nativeApplied;
    },

    CoverBitmask: function(pChars, pX, pY, pCoverChar) {
        var offsets = [
            [-1, -1], [0, -1], [1, -1],
            [-1, 0], [1, 0],
            [-1, 1], [0, 1], [1, 1]
        ];
        var bits = "";

        for(var index = 0; index < offsets.length; ++index) {
            var x = pX + offsets[index][0];
            var y = pY + offsets[index][1];

            if(x < 0 || y < 0 || !pChars || x >= pChars.length || y >= pChars[x].length) {
                bits += index === 0 ? "1" : "0";
                continue;
            }

            bits += pChars[x][y] === pCoverChar ? "1" : "0";
        }

        return bits;
    },

    DetectMatches: function(pRule, pBitmask) {
        for(var index = 0; index < pRule.detect.length; ++index) {
            if(pRule.detect[index].vector === pBitmask)
                return true;
        }

        return false;
    },

    NextCoverMatrixRow: function(pRule, pMatrixIndex) {
        var matrix = pRule.change_to[pMatrixIndex].matrix;

        if(!matrix || !matrix.length)
            return null;

        if(!pRule.change_to_cur)
            pRule.change_to_cur = [{ row: "0" }, { row: "0" }, { row: "0" }];

        var current = Number(pRule.change_to_cur[pMatrixIndex].row || 0);
        current++;

        if(current > matrix.length - 1)
            current = 0;

        pRule.change_to_cur[pMatrixIndex].row = String(current);
        return matrix[current];
    },

    ApplyCoverBottom: function(pChars, pTiles, pRule, pX, pY, pProtected, pCoverChar) {
        var row = this.NextCoverMatrixRow(pRule, 0);

        if(row) {
            // The matrix encodes a vertical canopy stamp: row[0]=top-of-canopy
            // at pY-1, row[1]=mid-canopy at pY, row[2]=trunk-base at pY+1,
            // row[3]=below-trunk at pY+2. When pY is at the south map edge
            // (pY+1 out of bounds), the trunk-base row is silently dropped by
            // SetTile's InBounds guard, leaving an orphan mid-canopy tile
            // (e.g. 21-24) at pY with no support row below — the visible
            // "canopy clip" artifact at y=H-1. Shipped maps avoid this
            // (13/14 shipped jungle maps have 0 canopy at y=H-1; the one
            // outlier has 1). Skip the canopy stamp entirely when the
            // trunk-base row would be OOB; the cell falls through to the
            // base-tile selection (palette.tree top variant) which renders
            // as a small leafy peak instead of a floating mid-canopy.
            // Same fix applies to all biomes that use ApplyTreeRules
            // (ice trees use a separate ApplyTreeColumns path so this
            // doesn't affect them). RCA 2026-06-13.
            var trunkRowOOB = (row.length > 2) &&
                !MapGen.Layers.InBounds(pTiles, pX, pY + 1);
            if(!trunkRowOOB) {
                if(row.length > 0)
                    this.SetTileIfAllowed(pTiles, pX, pY - 1, row[0], pProtected);
                if(row.length > 1)
                    this.SetTileIfAllowed(pTiles, pX, pY, row[1], pProtected);
                if(row.length > 2)
                    this.SetTileIfAllowed(pTiles, pX, pY + 1, row[2], pProtected);
                if(row.length > 3)
                    this.SetTileIfAllowed(pTiles, pX, pY + 2, row[3], pProtected);
            }
        }

        if(pRule.change_to[1].matrix.length) {
            var left = pRule.change_to[1].matrix[0];
            if(left.length > 0 && this.GetChar(pChars, pX, pY - 2, "") === pCoverChar)
                this.SetTileIfAllowed(pTiles, pX - 1, pY - 1, left[0], pProtected);
            if(left.length > 1)
                this.SetTileIfAllowed(pTiles, pX - 1, pY, left[1], pProtected);
        }

        if(pRule.change_to[2].matrix.length) {
            var right = pRule.change_to[2].matrix[0];
            if(right.length > 0 && this.GetChar(pChars, pX, pY - 2, "") === pCoverChar)
                this.SetTileIfAllowed(pTiles, pX + 1, pY - 1, right[0], pProtected);
            if(right.length > 1)
                this.SetTileIfAllowed(pTiles, pX + 1, pY, right[1], pProtected);
        }
    },

    ApplyCoverSingle: function(pContext, pTiles, pRule, pX, pY, pProtected) {
        var matrix = pRule.change_to[0].matrix;
        var row = this.PickMatrixRow(pContext, matrix, pX, pY, pRule.group === "TOP" ? 3000 : 2000);

        if(row && row.length)
            this.SetTileIfAllowed(pTiles, pX, pY, row[0], pProtected);

        if(pRule.change_to[1].matrix.length)
            this.SetTileIfAllowed(pTiles, pX - 1, pY, pRule.change_to[1].matrix[0][0], pProtected);
        if(pRule.change_to[2].matrix.length)
            this.SetTileIfAllowed(pTiles, pX + 1, pY, pRule.change_to[2].matrix[0][0], pProtected);
    },

    ApplyCoverGroup: function(pContext, pChars, pTiles, pData, pGroup, pBitmask, pX, pY, pProtected, pCoverChar) {
        for(var ruleIndex = 0; ruleIndex < pData.bitmask.length; ++ruleIndex) {
            var rule = pData.bitmask[ruleIndex];
            if(rule.group !== pGroup || !this.DetectMatches(rule, pBitmask))
                continue;

            if(rule.group === "BOTTOM")
                this.ApplyCoverBottom(pChars, pTiles, rule, pX, pY, pProtected, pCoverChar);
            else
                this.ApplyCoverSingle(pContext, pTiles, rule, pX, pY, pProtected);

            return true;
        }

        return false;
    },

    ApplyCoverRules: function(pContext, pChars, pTiles, pData, pCoverChar, pProtected) {
        if(!pData || !pData.bitmask)
            return 0;

        var applied = 0;
        this.ResetCoverRuleRows(pData);

        for(var y = pContext.Height - 1; y >= 0; --y) {
            for(var x = 0; x < pContext.Width; ++x) {
                if(this.GetChar(pChars, x, y, "") !== pCoverChar)
                    continue;

                var bitmask = this.CoverBitmask(pChars, x, y, pCoverChar);
                var up = bitmask.charAt(1);
                var down = bitmask.charAt(6);

                if(up === "1" && down === "0" && this.ApplyCoverGroup(pContext, pChars, pTiles, pData, "BOTTOM", bitmask, x, y, pProtected, pCoverChar))
                    ++applied;
                if(up === "1" && this.ApplyCoverGroup(pContext, pChars, pTiles, pData, "MIDDLE", bitmask, x, y, pProtected, pCoverChar))
                    ++applied;
                if(up === "0" && down === "1" && this.ApplyCoverGroup(pContext, pChars, pTiles, pData, "TOP", bitmask, x, y, pProtected, pCoverChar))
                    ++applied;
            }
        }

        return applied;
    },

    ApplyTreeRules: function(pContext, pChars, pTiles, pData, pProtected) {
        return this.ApplyCoverRules(pContext, pChars, pTiles, pData, "T", pProtected);
    },

    ResetCoverRuleRows: function(pData) {
        if(!pData || !pData.bitmask)
            return;

        for(var ruleIndex = 0; ruleIndex < pData.bitmask.length; ++ruleIndex) {
            var rule = pData.bitmask[ruleIndex];
            if(!rule.change_to_cur)
                rule.change_to_cur = [{ row: "0" }, { row: "0" }, { row: "0" }];

            for(var index = 0; index < rule.change_to_cur.length; ++index)
                rule.change_to_cur[index].row = "0";
        }
    },

    BaseSmoothPatterns: function() {
        if(typeof bm_smooth_char !== "undefined")
            return bm_smooth_char;

        return [
            "00011111", "10111111", "10010111", "11010111", "00101010",
            "00101110", "01100110", "11111111", "11100111", "11111011",
            "11011011", "01111011", "11101010", "11110110", "11100011",
            "00011011", "11011001"
        ];
    },

    RotateBitmask: function(pBitmask, pFlip) {
        var source = [];
        var result = [];
        var bitmask = pBitmask;

        if(pFlip) {
            bitmask = "";
            for(var flipIndex = 0; flipIndex < pBitmask.length; ++flipIndex)
                bitmask += pBitmask.charAt(flipIndex) === "0" ? "1" : "0";
        }

        for(var index = 0; index < 8; ++index)
            source[index] = bitmask.charAt(index);

        result.push(source[0] + source[1] + source[2] + source[3] + source[4] + source[5] + source[6] + source[7]);
        result.push(source[5] + source[3] + source[0] + source[6] + source[1] + source[7] + source[4] + source[2]);
        result.push(source[5] + source[6] + source[7] + source[3] + source[4] + source[0] + source[1] + source[2]);
        result.push(source[0] + source[3] + source[5] + source[1] + source[6] + source[2] + source[4] + source[7]);
        result.push(source[2] + source[4] + source[7] + source[1] + source[6] + source[0] + source[3] + source[5]);
        result.push(source[7] + source[6] + source[5] + source[4] + source[3] + source[2] + source[1] + source[0]);

        source[0] = bitmask.charAt(2);
        source[1] = bitmask.charAt(1);
        source[2] = bitmask.charAt(0);
        source[3] = bitmask.charAt(4);
        source[4] = bitmask.charAt(3);
        source[5] = bitmask.charAt(7);
        source[6] = bitmask.charAt(6);
        source[7] = bitmask.charAt(5);

        result.push(source[0] + source[1] + source[2] + source[3] + source[4] + source[5] + source[6] + source[7]);
        result.push(source[5] + source[3] + source[0] + source[6] + source[1] + source[7] + source[4] + source[2]);
        result.push(source[5] + source[6] + source[7] + source[3] + source[4] + source[0] + source[1] + source[2]);
        result.push(source[0] + source[3] + source[5] + source[1] + source[6] + source[2] + source[4] + source[7]);
        result.push(source[2] + source[4] + source[7] + source[1] + source[6] + source[0] + source[3] + source[5]);
        result.push(source[7] + source[6] + source[5] + source[4] + source[3] + source[2] + source[1] + source[0]);

        return result;
    },

    SmoothPatternSet: function(pFlip) {
        var patterns = this.BaseSmoothPatterns();
        var set = {};

        for(var index = 0; index < patterns.length; ++index) {
            if(!patterns[index])
                continue;

            var rotations = this.RotateBitmask(patterns[index], pFlip);
            for(var rotationIndex = 0; rotationIndex < rotations.length; ++rotationIndex)
                set[rotations[rotationIndex]] = true;
        }

        return set;
    },

    // Inline-loop variant: protected mask is precomputed once (it doesn't
    // change between passes), char reads use direct column access, and
    // the post-step copy is a column-pointer swap (96 assignments instead
    // of W*H Layers.Set calls). Behaviour matches the prior implementation.
    SmoothCharStep: function(pContext, pChars, pRule, pProtectedMask, pPatternCenterToGround, pPatternGroundToCenter, pOptions) {
        var width = pContext.Width;
        var height = pContext.Height;
        var center = pRule.center;
        var ground = pRule.ground;
        var nextChar = pRule.next;
        var allowGrowth = !!pRule.allowGrowth;
        var changed = 0;
        var options = pOptions || {};
        var dirtyRegion = options.DirtyMask ? options.DirtyRegion : null;
        var minX = dirtyRegion ? Math.max(0, dirtyRegion.minX) : 0;
        var minY = dirtyRegion ? Math.max(0, dirtyRegion.minY) : 0;
        var maxX = dirtyRegion ? Math.min(width - 1, dirtyRegion.maxX) : width - 1;
        var maxY = dirtyRegion ? Math.min(height - 1, dirtyRegion.maxY) : height - 1;

        // Build a swapped-state grid. Shallow-copy each column so we can
        // read pChars and write next without aliasing.
        var next = new Array(width);
        for(var sx = 0; sx < width; ++sx)
            next[sx] = pChars[sx].slice(0);

        for(var x = minX; x <= maxX; ++x) {
            var col  = pChars[x];
            var colW = (x > 0) ? pChars[x - 1] : null;
            var colE = (x < width - 1) ? pChars[x + 1] : null;
            var nextCol = next[x];

            for(var y = minY; y <= maxY; ++y) {
                if(pProtectedMask[y * width + x])
                    continue;

                var current = col[y];

                // Inline CharBitmask. allowed = {center, ground, optional next}.
                // OOB cells are treated as "0" (i.e. center). Any in-bounds
                // value outside allowed -> bail.
                var ymN = y - 1, ymS = y + 1;
                var nbNW, nbN, nbNE, nbW, nbE, nbSW, nbS, nbSE;
                if(ymN < 0)         { nbNW = center; nbN = center; nbNE = center; }
                else                {
                    nbNW = colW ? colW[ymN] : center;
                    nbN  = col[ymN];
                    nbNE = colE ? colE[ymN] : center;
                }
                nbW = colW ? colW[y] : center;
                nbE = colE ? colE[y] : center;
                if(ymS >= height)   { nbSW = center; nbS = center; nbSE = center; }
                else                {
                    nbSW = colW ? colW[ymS] : center;
                    nbS  = col[ymS];
                    nbSE = colE ? colE[ymS] : center;
                }

                // OOB above is "0" not the value-bit calculation; mirror
                // the original CharBitmask semantics (InBounds-fail short-
                // circuits to "0" without the allowed check).
                var bm = "";
                bm += (ymN < 0)              ? "0" : ((nbNW !== center && nbNW !== ground && nbNW !== nextChar) ? "X" : (nbNW === center ? "0" : "1"));
                bm += (ymN < 0)              ? "0" : ((nbN  !== center && nbN  !== ground && nbN  !== nextChar) ? "X" : (nbN  === center ? "0" : "1"));
                bm += (ymN < 0)              ? "0" : ((nbNE !== center && nbNE !== ground && nbNE !== nextChar) ? "X" : (nbNE === center ? "0" : "1"));
                bm += (!colW)                ? "0" : ((nbW  !== center && nbW  !== ground && nbW  !== nextChar) ? "X" : (nbW  === center ? "0" : "1"));
                bm += (!colE)                ? "0" : ((nbE  !== center && nbE  !== ground && nbE  !== nextChar) ? "X" : (nbE  === center ? "0" : "1"));
                bm += (ymS >= height)        ? "0" : ((nbSW !== center && nbSW !== ground && nbSW !== nextChar) ? "X" : (nbSW === center ? "0" : "1"));
                bm += (ymS >= height)        ? "0" : ((nbS  !== center && nbS  !== ground && nbS  !== nextChar) ? "X" : (nbS  === center ? "0" : "1"));
                bm += (ymS >= height)        ? "0" : ((nbSE !== center && nbSE !== ground && nbSE !== nextChar) ? "X" : (nbSE === center ? "0" : "1"));

                if(bm.indexOf("X") >= 0)
                    continue;

                if(current === center && pPatternCenterToGround[bm]) {
                    nextCol[y] = ground;
                    ++changed;
                }
                else if(allowGrowth && current === ground && pPatternGroundToCenter[bm]) {
                    nextCol[y] = center;
                    ++changed;
                }
            }
        }

        // Swap column refs back into pChars in-place.
        for(var swapX = 0; swapX < width; ++swapX)
            pChars[swapX] = next[swapX];

        return changed;
    },

    SmoothCharMap: function(pContext, pChars, pRules, pProtected, pPasses, pOptions) {
        var centerToGround = this.SmoothPatternSet(false);
        var groundToCenter = this.SmoothPatternSet(true);
        var passes = pPasses || 2;
        var changed = 0;
        var width = pContext.Width;
        var height = pContext.Height;
        var options = pOptions || {};
        var dirtyMask = options.DirtyMask || null;

        // Precompute protected mask once - protected layers don't change
        // between passes, but the function previously fired 4 Layers.Get
        // per cell per rule per pass.
        var mask = new Array(width * height);
        if(pProtected || dirtyMask) {
            for(var py = 0; py < height; ++py) {
                var rowBase = py * width;
                for(var px = 0; px < width; ++px) {
                    var maskIndex = rowBase + px;
                    mask[maskIndex] = (dirtyMask && dirtyMask.charAt(maskIndex) !== "1") ||
                        (pProtected ? !!pProtected(px, py) : false);
                }
            }
        } else {
            for(var i = 0; i < mask.length; ++i) mask[i] = false;
        }

        for(var pass = 0; pass < passes; ++pass) {
            for(var ruleIndex = 0; ruleIndex < pRules.length; ++ruleIndex)
                changed += this.SmoothCharStep(pContext, pChars, pRules[ruleIndex], mask, centerToGround, groundToCenter, options);
        }

        return changed;
    }
};
