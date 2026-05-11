var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};
MapGen.Terrain.Smoothing.Ice = MapGen.Terrain.Smoothing.Ice || {};

(function(pIce) {
    pIce.Chars = {
        water: ".",
        ground: "#",
        path: "+",
        tree: "T",
        bank: "~",
        wet: "W"
    };

    pIce.Data = function() {
        var data = MapGen.Terrain.Smoothing.IceData;
        var edgeData = MapGen.Terrain.Smoothing.IceTileEdges;

        if(!data || !edgeData)
            return null;

        return {
            treeRuntime: this.TreeRuntimeData(),
            treeGroundBoundary: data.treeGroundBoundary,
            edges: edgeData,
            charToClass: this.CharToClass()
        };
    };

    pIce.TreeRuntimeData = function() {
        var sub0 = (typeof Terrain !== "undefined" && Terrain.Ice && Terrain.Ice.Sub0) ? Terrain.Ice.Sub0 : null;
        var runtime = sub0 && sub0.TreeRuntime ? sub0.TreeRuntime : this.DefaultTreeRuntime();
        if(sub0 && sub0.Tree && !runtime.stacks)
            runtime.stacks = sub0.Tree;
        return runtime;
    };

    pIce.DefaultTreeRuntime = function() {
        return {
            connectOrder: "NESW",
            stacks: {
                middle: [[190, 210], [191, 211], [192, 212]],
                leftedge: [[213, 233]],
                rightedge: [[214, 234]]
            },
            bottomKeys: {
                leftedge: ["....T..T", ".TT.T...", ".TT.T..T", "TTT.T..T", "TTTTT..T"],
                rightedge: ["...T.T..", "TT.T....", "TT.T.T..", "TTTT.T..", "TTTTTT.."],
                middle: ["TTT.....", "TTT.T...", "TTTT....", "TTTTT..."]
            },
            bottomEdgeKeys: {
                leftedge: ["....T..T|I|N", ".TT.T...|I|N", ".TT.T..T|I|N", "TT......|R|N", "TTT.T..T|I|N", "TTTTT..T|I|N"],
                rightedge: ["...T.T..|I|N", ".T......|L|N", "TT.T....|I|N", "TT.T.T..|I|N", "TTTT.T..|I|N", "TTTTTT..|I|N"],
                middle: [".TT.T...|L|N", "TT.T....|R|N", "TTT.....|I|N", "TTT.T...|I|N", "TTTT....|I|N", "TTTTT...|I|N"]
            },
            shapeCandidates: {
                "TTTTTTT.": [194],
                "T..T.TT.": [216],
                ".TT.T.TT": [154],
                "TT.T.TT.": [236, 199, 230, 360, 239, 231]
            },
            middlePairKeys: [
                "TTTTTTTT/TTTTT...|I|N",
                "TTTTTTTT/TTTTT..T|I|N",
                "TTTTTTTT/TTTTTT..|I|N",
                "TTTTTTTT/TTTTTT.T|I|N",
                "TTTTT.TT/TTT.T...|I|N",
                "TTTTTTT./TTTT....|I|N",
                "TTTTT.T./TTT.....|I|N"
            ],
            candidates: {
                "0011": [174, 216, 218, 219],
                "0110": [173, 195, 196, 215],
                "0111": [197, 198, 217],
                "1011": [175, 194, 199, 236, 238, 239, 360],
                "1110": [154, 155, 193, 235, 237, 251, 380],
                "1111": [170, 171, 230, 231, 232]
            },
            fallback: {
                single: [195, 197, 218, 219],
                fill: [230, 231, 170, 171, 232]
            }
        };
    };

    pIce.PickListItem = function(pContext, pList, pX, pY, pSalt) {
        if(!pList || !pList.length)
            return 0;
        var seed = (pContext && pContext.Seed) || 0;
        var hash = (((seed ^ (pX * 73856093) ^ (pY * 19349663) ^ (pSalt * 83492791)) | 0) >>> 0);
        return pList[hash % pList.length];
    };

    pIce.IceTreeStyleFamilies = function() {
        var denseCanopyCycle = [
            230, 230, 231, 170, 230, 230, 231, 171,
            230, 231, 230, 232, 230, 230, 170, 171,
            230, 231, 230, 171, 230, 230, 231, 170,
            230, 232, 230, 231, 230, 230, 170, 171,
            230, 231, 230, 232, 230, 230, 170, 171,
            230, 231, 230, 232, 230, 230, 231, 170,
            230, 171, 230, 231, 230, 230, 232, 170,
            230, 231, 230, 171, 230, 232, 230, 170
        ];
        return {
            retail_run_phase_x: {
                id: "retail_run_phase_x",
                description: "Retail-style horizontal stack and canopy run phase",
                stackAxis: "x",
                middleCycle: [1, 0, 1, 2, 1, 1, 2, 0, 1],
                canopyCycle: denseCanopyCycle,
                phaseSalt: 7101
            },
            retail_sparse_hash: {
                id: "retail_sparse_hash",
                description: "Sparse fallback with deterministic local picks",
                stackAxis: "hash",
                middleCycle: [1, 0, 1, 2, 1, 1, 2, 0, 1],
                canopyCycle: denseCanopyCycle,
                phaseSalt: 7109
            }
        };
    };

    pIce.AnalyzeIceTreeStyleTopology = function(pContext, pChars) {
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var metrics = {
            treeCells: 0,
            denseCells: 0,
            explicitMiddle: 0,
            explicitLeft: 0,
            explicitRight: 0,
            bottomRuns: 0,
            longBottomRuns: 0,
            longestRunX: 0,
            longestRunY: 0
        };

        function isTree(x, y) {
            return x >= 0 && y >= 0 && x < width && y < height &&
                self.IsTreeCharValue(MapGen.Layers.Get(pChars, x, y, ""));
        }

        for(var y = 0; y < height; ++y) {
            var x = 0;
            while(x < width) {
                if(!isTree(x, y)) {
                    ++x;
                    continue;
                }
                var start = x;
                while(x < width && isTree(x, y)) {
                    var value = MapGen.Layers.Get(pChars, x, y, "");
                    ++metrics.treeCells;
                    if(value === "M") ++metrics.explicitMiddle;
                    else if(value === "L") ++metrics.explicitLeft;
                    else if(value === "R") ++metrics.explicitRight;
                    if(isTree(x - 1, y) && isTree(x + 1, y) && isTree(x, y - 1) && isTree(x, y + 1))
                        ++metrics.denseCells;
                    ++x;
                }
                var len = x - start;
                if(len > metrics.longestRunX)
                    metrics.longestRunX = len;
                var isBottomRun = false;
                for(var bx = start; bx < x; ++bx) {
                    if(!isTree(bx, y + 1)) {
                        isBottomRun = true;
                        break;
                    }
                }
                if(isBottomRun) {
                    ++metrics.bottomRuns;
                    if(len >= 3)
                        ++metrics.longBottomRuns;
                }
            }
        }

        for(var cx = 0; cx < width; ++cx) {
            var run = 0;
            for(var cy = 0; cy < height; ++cy) {
                if(isTree(cx, cy)) {
                    ++run;
                    if(run > metrics.longestRunY)
                        metrics.longestRunY = run;
                } else {
                    run = 0;
                }
            }
        }

        return metrics;
    };

    pIce.SelectIceTreeStyle = function(pContext, pChars) {
        var families = this.IceTreeStyleFamilies();
        var requested = "auto";
        if(pContext && pContext.Profile && pContext.Profile.IceTreeStyle)
            requested = pContext.Profile.IceTreeStyle;

        var metrics = this.AnalyzeIceTreeStyleTopology(pContext, pChars);
        var scores = {
            retail_run_phase_x: metrics.longBottomRuns * 12 + metrics.longestRunX * 2 +
                metrics.explicitMiddle * 3 + Math.floor(metrics.denseCells / 20),
            retail_sparse_hash: 10 + Math.max(0, 8 - metrics.longestRunX)
        };

        var selectedId = "retail_run_phase_x";
        if(requested && requested !== "auto" && families[requested])
            selectedId = requested;
        else if(metrics.treeCells > 0) {
            selectedId = scores.retail_run_phase_x >= scores.retail_sparse_hash ?
                "retail_run_phase_x" : "retail_sparse_hash";
        }

        var style = families[selectedId] || families.retail_run_phase_x;
        if(pContext) {
            pContext.IceTreeStyle = {
                requested: requested,
                selected: style.id,
                scores: scores,
                metrics: metrics,
                warnings: []
            };
        }
        return style;
    };

    pIce.TreeRunStartX = function(pIsTree, pX, pY) {
        var start = pX;
        while(start > 0 && pIsTree(start - 1, pY))
            --start;
        return start;
    };

    pIce.TreeRunPhaseIndex = function(pContext, pStyle, pIsTree, pX, pY, pModulo) {
        if(!pModulo)
            return 0;
        if(!pStyle || pStyle.stackAxis === "hash")
            return MapGen.Random.HashTile((pContext && pContext.Seed) || 0, pX, pY, 4101) % pModulo;

        var runStart = this.TreeRunStartX(pIsTree, pX, pY);
        var phase = MapGen.Random.HashTile(
            (pContext && pContext.Seed) || 0,
            runStart,
            pY,
            pStyle.phaseSalt || 7101
        ) % pModulo;
        return (pX - runStart + phase) % pModulo;
    };

    pIce.TreeStackCycleIndex = function(pContext, pStyle, pIsTree, pX, pY, pModulo) {
        if(!pModulo)
            return 0;
        var cycle = pStyle && pStyle.middleCycle ? pStyle.middleCycle : null;
        if(cycle && cycle.length) {
            var raw = this.TreeRunPhaseIndex(pContext, pStyle, pIsTree, pX, pY, cycle.length);
            return cycle[raw % cycle.length] % pModulo;
        }
        var raw = this.TreeRunPhaseIndex(pContext, pStyle, pIsTree, pX, pY, pModulo);
        return raw;
    };

    pIce.PickTreeStackStyled = function(pContext, pRuntime, pStyle, pKind, pX, pY, pIsTree) {
        var stacks = pRuntime.stacks || {};
        var list = stacks[pKind] || stacks.middle;
        if(!list || !list.length)
            return null;
        if(pKind === "middle" && pIsTree) {
            var index = this.TreeStackCycleIndex(pContext, pStyle, pIsTree, pX, pY, list.length);
            return this.FlattenTreeStack(list[index]);
        }
        return this.FlattenTreeStack(this.PickListItem(pContext, list, pX, pY, pKind === "middle" ? 4101 : 4102));
    };

    pIce.PickTreeCandidateStyled = function(pContext, pStyle, pCandidates, pX, pY, pSalt, pIsTree, pShapeKey, pConnectKey) {
        if(!pCandidates || !pCandidates.length)
            return 0;
        if(pStyle && pStyle.stackAxis !== "hash" && pStyle.canopyCycle &&
            pShapeKey === "TTTTTTTT" && pConnectKey === "1111" && pIsTree) {
            var allowed = {};
            for(var index = 0; index < pCandidates.length; ++index)
                allowed[pCandidates[index]] = true;

            var usable = [];
            for(var cycleIndex = 0; cycleIndex < pStyle.canopyCycle.length; ++cycleIndex) {
                var tile = pStyle.canopyCycle[cycleIndex];
                if(allowed[tile])
                    usable.push(tile);
            }

            if(usable.length >= 3) {
                var pick = this.TreeRunPhaseIndex(pContext, pStyle, pIsTree, pX, pY, usable.length);
                return usable[pick];
            }
        }
        return this.PickListItem(pContext, pCandidates, pX, pY, pSalt);
    };

    pIce.TreeConnectKey = function(pIsTree, pX, pY) {
        return (pIsTree(pX, pY - 1) ? "1" : "0") +
            (pIsTree(pX + 1, pY) ? "1" : "0") +
            (pIsTree(pX, pY + 1) ? "1" : "0") +
            (pIsTree(pX - 1, pY) ? "1" : "0");
    };

    pIce.TreeShapeKey = function(pIsTree, pX, pY) {
        return (pIsTree(pX - 1, pY - 1) ? "T" : ".") +
            (pIsTree(pX, pY - 1) ? "T" : ".") +
            (pIsTree(pX + 1, pY - 1) ? "T" : ".") +
            (pIsTree(pX - 1, pY) ? "T" : ".") +
            (pIsTree(pX + 1, pY) ? "T" : ".") +
            (pIsTree(pX - 1, pY + 1) ? "T" : ".") +
            (pIsTree(pX, pY + 1) ? "T" : ".") +
            (pIsTree(pX + 1, pY + 1) ? "T" : ".");
    };

    pIce.IsTreeCharValue = function(pValue) {
        return pValue === this.Chars.tree || pValue === "M" || pValue === "L" || pValue === "R";
    };

    pIce.ExplicitTreeBottomKind = function(pValue) {
        if(pValue === "M")
            return "middle";
        if(pValue === "L")
            return "leftedge";
        if(pValue === "R")
            return "rightedge";
        return "";
    };

    pIce.ExplicitTreeBottomChar = function(pKind) {
        if(pKind === "middle")
            return "M";
        if(pKind === "leftedge")
            return "L";
        if(pKind === "rightedge")
            return "R";
        return "";
    };

    pIce.ClearTrimmedTreeMarkers = function(pContext, pX, pY) {
        var layers = pContext.Layers || {};
        if(layers.trimmedTreeProtrusion)
            MapGen.Layers.Set(layers.trimmedTreeProtrusion, pX, pY, 0);
        if(layers.trimmedTreeTopSideTab)
            MapGen.Layers.Set(layers.trimmedTreeTopSideTab, pX, pY, 0);
        if(layers.trimmedTreeLowerSideTail)
            MapGen.Layers.Set(layers.trimmedTreeLowerSideTail, pX, pY, 0);
    };

    pIce.TreeKeyInList = function(pList, pKey) {
        if(!pList)
            return false;
        for(var i = 0; i < pList.length; ++i) {
            if(pList[i] === pKey)
                return true;
        }
        return false;
    };

    pIce.TreeBottomEdgeKey = function(pIsTree, pX, pY, pWidth, pHeight) {
        return this.TreeShapeKey(pIsTree, pX, pY) +
            (pX === 0 ? "|L" : (pX === pWidth - 1 ? "|R" : "|I")) +
            (pY === pHeight - 1 ? "|B" : "|N");
    };

    pIce.TreeMiddlePairKey = function(pIsTree, pX, pY, pWidth, pHeight) {
        return this.TreeShapeKey(pIsTree, pX, pY - 1) + "/" +
            this.TreeShapeKey(pIsTree, pX, pY) +
            (pX === 0 ? "|L" : (pX === pWidth - 1 ? "|R" : "|I")) +
            (pY === pHeight - 1 ? "|B" : "|N");
    };

    pIce.TreeSideStackKindForRule = function(pRule) {
        if(!pRule)
            return "";
        if(pRule.top === 214 && pRule.bottom === 234)
            return "rightedge";
        if(pRule.top === 213 && pRule.bottom === 233)
            return "leftedge";
        return "";
    };

    pIce.TreeExplicitSideStackFits = function(pIsTree, pKind, pX, pBottomY, pStack) {
        if(pKind !== "leftedge" && pKind !== "rightedge")
            return false;
        if(pStack && pStack.length !== 2)
            return false;
        if(pBottomY <= 0 || !pIsTree(pX, pBottomY) || !pIsTree(pX, pBottomY - 1))
            return false;

        var topShape = this.TreeShapeKey(pIsTree, pX, pBottomY - 1);
        var bottomShape = this.TreeShapeKey(pIsTree, pX, pBottomY);
        var pairRules = this.IceTreeDiagonalStackPairRules ? this.IceTreeDiagonalStackPairRules() : [];
        for(var ruleIndex = 0; ruleIndex < pairRules.length; ++ruleIndex) {
            var rule = pairRules[ruleIndex];
            if(this.TreeSideStackKindForRule(rule) !== pKind)
                continue;
            if(pStack && (((pStack[0] & 0x1FF) !== rule.top) || ((pStack[1] & 0x1FF) !== rule.bottom)))
                continue;
            return this.TreeKeyInList(rule.topShapes, topShape) &&
                this.TreeKeyInList(rule.bottomShapes, bottomShape);
        }
        return false;
    };

    pIce.TreeExplicitMiddleStackFits = function(pRuntime, pIsTree, pX, pBottomY, pWidth, pHeight) {
        if(pBottomY <= 0 || !pIsTree(pX, pBottomY) || !pIsTree(pX, pBottomY - 1))
            return false;
        var keys = (pRuntime && pRuntime.middlePairKeys) ? pRuntime.middlePairKeys : [];
        return this.TreeKeyInList(keys, this.TreeMiddlePairKey(pIsTree, pX, pBottomY, pWidth, pHeight));
    };

    pIce.TreeExplicitBottomRoleFits = function(pRuntime, pIsTree, pKind, pX, pBottomY, pWidth, pHeight, pStack) {
        if(pKind === "leftedge" || pKind === "rightedge")
            return this.TreeExplicitSideStackFits(pIsTree, pKind, pX, pBottomY, pStack);
        if(pKind === "middle")
            return this.TreeExplicitMiddleStackFits(pRuntime, pIsTree, pX, pBottomY, pWidth, pHeight);
        return false;
    };

    pIce.TreeBottomKindForKey = function(pKeys, pKey) {
        if(this.TreeKeyInList(pKeys.leftedge, pKey))
            return "leftedge";
        if(this.TreeKeyInList(pKeys.rightedge, pKey))
            return "rightedge";
        if(this.TreeKeyInList(pKeys.middle, pKey))
            return "middle";
        return "";
    };

    pIce.TreeBottomKind = function(pRuntime, pIsTree, pX, pY, pWidth, pHeight) {
        var edgeKeys = (pRuntime && pRuntime.bottomEdgeKeys) ? pRuntime.bottomEdgeKeys : {};
        var edgeKind = this.TreeBottomKindForKey(edgeKeys, this.TreeBottomEdgeKey(pIsTree, pX, pY, pWidth, pHeight));
        if(edgeKind)
            return edgeKind;
        if(edgeKeys.leftedge || edgeKeys.rightedge || edgeKeys.middle)
            return "";

        var bottomKeys = (pRuntime && pRuntime.bottomKeys) ? pRuntime.bottomKeys : {};
        return this.TreeBottomKindForKey(bottomKeys, this.TreeShapeKey(pIsTree, pX, pY));
    };

    pIce.IsMiddlePairBaseTile = function(pTiles, pX, pY) {
        var top = MapGen.Layers.Get(pTiles, pX, pY - 1, 0);
        var base = MapGen.Layers.Get(pTiles, pX, pY, 0);
        return (top === 190 || top === 191 || top === 192) &&
            (base === 210 || base === 211 || base === 212);
    };

    pIce.TreeCandidatesForKey = function(pRuntime, pKey) {
        var candidates = pRuntime.candidates || {};
        if(candidates[pKey] && candidates[pKey].length)
            return candidates[pKey];
        if(pKey === "0000" && pRuntime.fallback && pRuntime.fallback.single)
            return pRuntime.fallback.single;

        var best = null;
        var bestScore = 999;
        for(var key in candidates) {
            if(!candidates.hasOwnProperty(key) || !candidates[key].length)
                continue;
            var score = 0;
            for(var i = 0; i < 4; ++i) {
                if(key.charAt(i) !== pKey.charAt(i))
                    score += key.charAt(i) === "1" ? 2 : 1;
            }
            if(score < bestScore) {
                bestScore = score;
                best = candidates[key];
            }
        }

        if(best)
            return best;
        return (pRuntime.fallback && pRuntime.fallback.fill) || [230];
    };

    pIce.TreeCandidatesForShapeConnect = function(pShapeKey, pConnectKey) {
        var key = pShapeKey + "|" + pConnectKey;
        var lowerCurve = {
            // Derived from mapm15 reversed charmap and the CF1 ice corpus with
            // trunk bases treated as tree-body cells. These are true bottom
            // cells with no south continuation. Taller columns are polished
            // by vertical stack context instead of local shape alone.
            ".TT.T..T|1100": [233],
            "TTT.T..T|1100": [233],
            ".TT.T...|1100": [233],
            "TT.T.T..|1001": [234],
            "TT.T....|1001": [234],
            "TTTT.T..|1001": [234]
        };
        return lowerCurve[key] || null;
    };

    pIce.TreeCandidatesForShape = function(pRuntime, pKey, pConnectKey) {
        var exact = pConnectKey ? this.TreeCandidatesForShapeConnect(pKey, pConnectKey) : null;
        if(exact)
            return exact;

        var candidates = (pRuntime && pRuntime.shapeCandidates) ? pRuntime.shapeCandidates : {};
        if(pKey === ".TTTTTT.")
            return [231];
        if(pKey === "....TTTT")
            return [196, 195, 173, 197];
        if(pKey === "....T.TT")
            return [215, 215, 215, 215, 215, 173, 173, 173, 154, 235, 195, 196, 198];
        if(pKey === "...T.TTT")
            return [218, 219, 174];
        if(pKey === "...T.TT.")
            return [216, 216, 216, 216, 216, 174, 174, 174, 236, 236, 218, 230, 199, 219];
        if(pKey === "..T.T.TT")
            return [215, 215, 215, 215, 215, 215, 195, 195, 173];
        if(pKey === "..T.TTTT")
            return [195, 173, 215, 196];
        if(pKey === ".TT.T.TT")
            return [154, 154, 154, 154, 154, 154, 154, 154,
                235, 235, 235, 235, 235, 235,
                237, 237, 237, 237,
                380, 380, 251, 251, 231, 230, 232, 170, 172, 171];
        if(pKey === ".TT.TTTT")
            return [235, 235, 235, 235, 235, 235, 154, 237, 215];
        if(pKey === ".TTTTTTT")
            return [230, 230, 230, 230, 230, 230, 170, 231, 171, 235, 152, 172, 232, 153];
        if(pKey === "T..T.TT.")
            return [216, 216, 216, 216, 216, 216, 216, 216, 219, 219, 236, 218, 174];
        if(pKey === "T..TTTTT")
            return [217, 219, 218, 196, 198];
        if(pKey === "TTTTT.TT")
            return [193, 193, 193, 193, 193, 193, 193, 155, 251, 235];
        if(pKey === "TTTTT...")
            return [230, 231, 232, 171, 152, 210, 211, 212, 233, 234];
        if(pKey === "TTTTTTT.")
            return [194, 194, 194, 194, 194, 194, 194, 194, 175, 239, 199];
        if(pKey === "TT.T.TT.")
            return [236, 236, 236, 236, 236, 199, 199, 199, 199, 199,
                230, 230, 230, 230, 360, 360, 360, 360,
                239, 239, 231, 232, 170, 194, 238, 171, 175];
        if(pKey === "TT.T.TTT")
            return [236, 199, 360, 218];
        if(pKey === "TT.TTTTT")
            return [230, 230, 230, 230, 230, 230, 230, 230, 231, 171, 170, 232, 236, 217, 152, 193];
        if(pKey === "TTT.T.TT")
            return [155, 155, 155, 155, 155, 193, 193, 154, 380, 235, 251];
        if(pKey === "TTT.TTTT")
            return [235, 230, 215];
        if(pKey === "TTTT.TTT")
            return [175, 239, 218];
        if(pKey === "TTTTTTTT")
            return [230, 230, 230, 230, 231, 231, 170, 170, 171, 232];
        if(pKey === "T.TTTTT.")
            return [197, 198, 217, 216];
        if(pKey === "...TTTTT")
            return [230, 230, 230, 230, 198, 198, 217, 217, 170, 170, 197, 197, 231, 231, 171, 172, 196, 232, 218, 152, 174];
        if(pKey === ".TTT.TTT")
            return [175, 194, 199, 236, 238, 239, 360, 218];
        var list = candidates[pKey];
        if(!list || !list.length)
            return null;

        return list;
    };

    pIce.InteriorUpperTreeEdgeCandidates = function(pShapeKey, pConnectKey, pY) {
        if(pY <= 0)
            return null;

        // The runtime table merges map-border canopy with interior upper-edge
        // samples. Interior exposed edges need the corpus-backed upper-edge
        // family so dense fill tiles do not leak onto the visible top edge.
        if(pShapeKey === "...TTTTT" && pConnectKey === "0111")
            return [198, 198, 217, 217, 197, 197, 196, 218];
        if(pShapeKey === "T..T.TTT" && pConnectKey === "0011")
            return [219];
        if(pShapeKey === "T.TTTTTT" && pConnectKey === "0111")
            return [219];

        return null;
    };

    pIce.TreeCandidatesForContext = function(pRuntime, pShapeKey, pConnectKey, pX, pY) {
        return this.InteriorUpperTreeEdgeCandidates(pShapeKey, pConnectKey, pY) ||
            this.TreeCandidatesForShape(pRuntime, pShapeKey, pConnectKey) ||
            this.TreeCandidatesForKey(pRuntime, pConnectKey);
    };

    pIce.FlattenTreeStack = function(pStack) {
        var out = [];
        for(var row = 0; row < pStack.length; ++row) {
            if(pStack[row] && pStack[row].length !== undefined)
                out.push(pStack[row][0]);
            else
                out.push(pStack[row]);
        }
        return out;
    };

    pIce.ApplyTreeGroundBoundary = function(pContext, pChars, pTiles, pProtected, pTreeGroundBoundary) {
        var Core = MapGen.Terrain.Smoothing.Core;
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;

        function isTreeChar(x, y) {
            if(x < 0 || y < 0 || x >= width || y >= height) return false;
            return self.IsTreeCharValue(MapGen.Layers.Get(pChars, x, y, ""));
        }

        function isTrimmedTopSideTabCell(x, y) {
            var layers = pContext.Layers || {};
            return MapGen.Layers.Get(layers.trimmedTreeTopSideTab, x, y, 0);
        }

        function isTrimmedShortTopSideTabCell(x, y) {
            if(!isTrimmedTopSideTabCell(x, y))
                return false;
            if(!isTreeChar(x - 1, y))
                return true;

            var treeX = x - 1;
            var topY = y;
            while(topY > 0 && isTreeChar(treeX, topY - 1))
                --topY;
            var botY = y;
            while(botY < height - 1 && isTreeChar(treeX, botY + 1))
                ++botY;

            return (botY - topY + 1) <= 6;
        }

        var tgb = pTreeGroundBoundary || {};
        var middleSide = (tgb.middleSide && tgb.middleSide.length) ? tgb.middleSide : [63];
        var lowerSide  = (tgb.lowerSide  && tgb.lowerSide.length)  ? tgb.lowerSide  : [45];
        var upperSide  = (tgb.upperSide  && tgb.upperSide.length)  ? tgb.upperSide  : [24];
        var rightBaseEast = (tgb.rightBaseEast && tgb.rightBaseEast.length) ? tgb.rightBaseEast : [45];
        var southDecorMap = { 210: 19, 211: 17, 212: 15, 233: 19, 234: 19 };
        var painted = 0;
        var bounds = this.LocalRenderBounds(pContext, 0);

        for(var gx = bounds.minX; gx <= bounds.maxX; ++gx) {
            for(var gy = bounds.minY; gy <= bounds.maxY; ++gy) {
                if(!self.LocalRenderTileDirty(pContext, gx, gy))
                    continue;

                if(isTreeChar(gx, gy)) continue;
                if(MapGen.Layers.Get(pChars, gx, gy, "") === self.Chars.path) continue;
                var gt = MapGen.Layers.Get(pTiles, gx, gy, 0);
                if(gt !== 1 && gt !== 0) continue;

                var hL = isTreeChar(gx - 1, gy);
                var hR = isTreeChar(gx + 1, gy);
                var hU = isTreeChar(gx, gy - 1);
                var hD = isTreeChar(gx, gy + 1);
                var hash = ((gx * 73) ^ (gy * 41)) & 0xFFFF;
                var westTile = MapGen.Layers.Get(pTiles, gx - 1, gy, 0);

                if(isTrimmedShortTopSideTabCell(gx, gy))
                    continue;

                if(westTile === 234) {
                    if(isTrimmedShortTopSideTabCell(gx, gy - 1))
                        continue;
                    Core.SetTileIfAllowed(pTiles, gx, gy, rightBaseEast[hash % rightBaseEast.length], pProtected);
                    ++painted;
                    continue;
                }

                if(hU && !hL && !hR) {
                    var aboveTile = MapGen.Layers.Get(pTiles, gx, gy - 1, 0);
                    var pickDecor = southDecorMap[aboveTile];
                    if(pickDecor !== undefined && (hash % 3) !== 0) {
                        Core.SetTileIfAllowed(pTiles, gx, gy, pickDecor, pProtected);
                        ++painted;
                    }
                    continue;
                }

                if(hL && !hR && !hU && !hD) {
                    if(isTrimmedShortTopSideTabCell(gx, gy + 1))
                        continue;
                    var treeX = gx - 1;
                    var topY = gy;
                    while(topY > 0 && isTreeChar(treeX, topY - 1)) --topY;
                    var botY = gy;
                    while(botY < height - 1 && isTreeChar(treeX, botY + 1)) ++botY;
                    var canopy = botY - topY + 1;
                    if(canopy < 2) continue;
                    var pool;
                    if(canopy >= 4 && gy === topY) pool = upperSide;
                    else if(canopy >= 3 && gy === botY) pool = lowerSide;
                    else pool = middleSide;
                    Core.SetTileIfAllowed(pTiles, gx, gy, pool[hash % pool.length], pProtected);
                    ++painted;
                }
            }
        }

        return painted;
    };

    pIce.PolishTreeGroundBoundaryGaps = function(pContext, pChars, pTiles, pTreeGroundBoundary) {
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var tgb = pTreeGroundBoundary || {};
        var upperSide = (tgb.upperSide && tgb.upperSide.length) ? tgb.upperSide : [24];
        var middleSide = (tgb.middleSide && tgb.middleSide.length) ? tgb.middleSide : [63];
        var lowerSide = (tgb.lowerSide && tgb.lowerSide.length) ? tgb.lowerSide : [45];
        var upperCorner = (tgb.upperCorner && tgb.upperCorner.length) ? tgb.upperCorner : [44];
        var changed = 0;

        function isTreeChar(x, y) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return false;
            return self.IsTreeCharValue(MapGen.Layers.Get(pChars, x, y, ""));
        }

        function isGroundChar(x, y) {
            return MapGen.Layers.Get(pChars, x, y, self.Chars.ground) === self.Chars.ground;
        }

        function protectedGap(x, y) {
            var layers = pContext.Layers || {};
            return MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                isTrimmedShortTopSideTabCell(x, y) ||
                isTrimmedShortTopSideTabCell(x, y + 1) ||
                isTrimmedLowerSideTail(x, y) ||
                self.HasNearbyStructureArt(pContext, x, y, 2);
        }

        function isTrimmedTopSideTabCell(x, y) {
            var layers = pContext.Layers || {};
            return MapGen.Layers.Get(layers.trimmedTreeTopSideTab, x, y, 0);
        }

        function isTrimmedShortTopSideTabCell(x, y) {
            if(!isTrimmedTopSideTabCell(x, y))
                return false;
            if(!isTreeChar(x - 1, y))
                return true;

            var treeX = x - 1;
            var topY = y;
            while(topY > 0 && isTreeChar(treeX, topY - 1))
                --topY;
            var botY = y;
            while(botY < height - 1 && isTreeChar(treeX, botY + 1))
                ++botY;

            return (botY - topY + 1) <= 6;
        }

        function isTrimmedLowerSideTail(x, y) {
            var layers = pContext.Layers || {};
            if(layers.trimmedTreeLowerSideTail) {
                if(!MapGen.Layers.Get(layers.trimmedTreeLowerSideTail, x, y, 0))
                    return false;
            }
            else if(!MapGen.Layers.Get(layers.trimmedTreeProtrusion, x, y, 0)) {
                return false;
            }
            if(!isTreeChar(x - 1, y))
                return false;

            var treeX = x - 1;
            var topY = y;
            while(topY > 0 && isTreeChar(treeX, topY - 1))
                --topY;
            var botY = y;
            while(botY < height - 1 && isTreeChar(treeX, botY + 1))
                ++botY;
            var canopy = botY - topY + 1;

            return canopy <= 6 && y >= botY - 1;
        }

        function sideTileFor(treeX, y) {
            var topY = y;
            while(topY > 0 && isTreeChar(treeX, topY - 1))
                --topY;
            var botY = y;
            while(botY < height - 1 && isTreeChar(treeX, botY + 1))
                ++botY;
            var canopy = botY - topY + 1;

            if(canopy >= 4 && y === topY)
                return upperSide[0];
            if(canopy >= 3 && y === botY)
                return lowerSide[0];
            return middleSide[0];
        }

        function tileAt(x, y) {
            return MapGen.Layers.Get(pTiles, x, y, 0) & 0x1FF;
        }

        function listContains(list, tile) {
            for(var index = 0; index < list.length; ++index) {
                if((list[index] & 0x1FF) === tile)
                    return true;
            }
            return false;
        }

        function isSideBoundaryTile(tile) {
            return listContains(upperSide, tile) ||
                listContains(middleSide, tile) ||
                listContains(lowerSide, tile);
        }

        function cornerTileFor(x, y) {
            if(!isTreeChar(x - 1, y + 1))
                return null;
            if(isTreeChar(x - 1, y) || isTreeChar(x, y + 1) || isTreeChar(x + 1, y))
                return null;
            if(!isSideBoundaryTile(tileAt(x - 1, y)) || !listContains(upperSide, tileAt(x, y + 1)))
                return null;
            return upperCorner[0];
        }

        var bounds = this.LocalRenderBounds(pContext, 0);
        for(var x = Math.max(1, bounds.minX); x <= Math.min(width - 2, bounds.maxX); ++x) {
            for(var y = Math.max(1, bounds.minY); y <= Math.min(height - 2, bounds.maxY); ++y) {
                if(!self.LocalRenderTileDirty(pContext, x, y))
                    continue;

                if(!isGroundChar(x, y) || protectedGap(x, y))
                    continue;

                var currentTile = tileAt(x, y);
                if(currentTile !== 0 && currentTile !== 1)
                    continue;

                var tile = null;
                var hasTreeWest = isTreeChar(x - 1, y);
                var hasTreeEast = isTreeChar(x + 1, y);
                var hasTreeNorth = isTreeChar(x, y - 1);
                var hasTreeSouth = isTreeChar(x, y + 1);
                var isolatedSideGap = hasTreeWest && !hasTreeEast && !hasTreeNorth && !hasTreeSouth;
                var diagonalCornerSideGap = hasTreeWest && hasTreeSouth &&
                    !hasTreeEast && !hasTreeNorth && !isTreeChar(x + 1, y + 1);

                if(isolatedSideGap || diagonalCornerSideGap)
                    tile = sideTileFor(x - 1, y);
                else
                    tile = cornerTileFor(x, y);
                if(tile === null)
                    continue;
                if(currentTile === tile)
                    continue;

                MapGen.Layers.Set(pTiles, x, y, tile);
                ++changed;
            }
        }

        return changed;
    };

    pIce.PolishTreeTilePairs = function(pContext, pChars, pTiles, pProtected) {
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var changed = 0;
        var leftAbove = { 154: true, 155: true, 173: true, 193: true, 195: true, 235: true, 237: true, 251: true, 380: true };
        var rightAbove = { 174: true, 194: true, 196: true, 199: true, 236: true, 238: true, 239: true };
        var above239 = { 174: true, 175: true, 194: true, 219: true, 236: true };
        var upperRightCapAbove214 = { 199: true, 216: true, 238: true, 239: true };

        function isTreeChar(x, y) {
            if(x < 0 || y < 0 || x >= width || y >= height) return false;
            return self.IsTreeCharValue(MapGen.Layers.Get(pChars, x, y, ""));
        }

        function tileAt(x, y) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return 0;
            return MapGen.Layers.Get(pTiles, x, y, 0);
        }

        function setTile(x, y, tile) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return false;
            if(!self.LocalRenderTileDirty(pContext, x, y))
                return false;
            if(pProtected && pProtected(x, y))
                return false;
            if(tileAt(x, y) === tile)
                return false;
            MapGen.Layers.Set(pTiles, x, y, tile);
            return true;
        }

        function exactShapeConnectAllows(x, y, tile) {
            var exact = self.TreeCandidatesForShapeConnect(
                self.TreeShapeKey(isTreeChar, x, y),
                self.TreeConnectKey(isTreeChar, x, y)
            );
            if(!exact)
                return false;
            for(var index = 0; index < exact.length; ++index) {
                if(exact[index] === tile)
                    return true;
            }
            return false;
        }

        function stringListContains(list, value) {
            if(!list)
                return false;
            for(var index = 0; index < list.length; ++index) {
                if(list[index] === value)
                    return true;
            }
            return false;
        }

        function validSideStackTop(topTile, bottomTile, x, topY) {
            if(tileAt(x, topY) !== topTile || tileAt(x, topY + 1) !== bottomTile)
                return false;
            if(!isTreeChar(x, topY) || !isTreeChar(x, topY + 1))
                return false;

            var pairRules = self.IceTreeDiagonalStackPairRules ? self.IceTreeDiagonalStackPairRules() : [];
            for(var ruleIndex = 0; ruleIndex < pairRules.length; ++ruleIndex) {
                var rule = pairRules[ruleIndex];
                if(rule.top !== topTile || rule.bottom !== bottomTile)
                    continue;
                return stringListContains(rule.topShapes, self.TreeShapeKey(isTreeChar, x, topY)) &&
                    stringListContains(rule.bottomShapes, self.TreeShapeKey(isTreeChar, x, topY + 1));
            }
            return false;
        }

        function rightPairCandidates(x, y, fallback) {
            var shape = self.TreeShapeKey(isTreeChar, x, y);
            if(shape === "TT.T.TT.")
                return [236, 236, 199, 199, 360, 239, 194, 238, 175, fallback];
            if(shape === "TTTTTTT.")
                return [194, 175, fallback];
            if(shape === "TTTT.TT.")
                return [236, 236, 199, 194, 360, 239, 174, 175, fallback];
            return [fallback];
        }

        function setRightPairTile(x, y, fallback, salt) {
            var candidates = rightPairCandidates(x, y, fallback);
            return setTile(x, y, self.PickListItem(pContext, candidates, x, y, salt));
        }

        var bounds = this.LocalRenderBounds(pContext, 2);
        for(var y = bounds.minY; y <= bounds.maxY; ++y) {
            for(var x = bounds.minX; x <= bounds.maxX; ++x) {
                if(!isTreeChar(x, y))
                    continue;

                var tile = tileAt(x, y);
                var below = tileAt(x, y + 1);
                var leftStackBelow = below === 213 && validSideStackTop(213, 233, x, y + 1);
                var rightStackBelow = below === 214 && validSideStackTop(214, 234, x, y + 1);

                if(leftStackBelow && !leftAbove[tile]) {
                    if(exactShapeConnectAllows(x, y, tile))
                        continue;
                    if(setTile(x, y, 193))
                        ++changed;
                    continue;
                }

                if(rightStackBelow && tile === 239) {
                    if(tileAt(x, y - 1) === 360 && upperRightCapAbove214[tileAt(x, y - 2)] && setTile(x, y - 1, 199))
                        ++changed;
                    if(setRightPairTile(x, y, 236, 6151))
                        ++changed;
                    continue;
                }

                if(rightStackBelow && tile === 199 && tileAt(x, y - 1) === 218) {
                    if(setTile(x, y - 1, 216))
                        ++changed;
                    if(setRightPairTile(x, y, 236, 6152))
                        ++changed;
                    continue;
                }

                if(rightStackBelow && upperRightCapAbove214[tileAt(x, y - 1)] && tile !== 236) {
                    if(exactShapeConnectAllows(x, y, tile))
                        continue;
                    if(setRightPairTile(x, y, 236, 6153))
                        ++changed;
                    continue;
                }

                if(rightStackBelow && !rightAbove[tile]) {
                    if(self.TreeShapeKey(isTreeChar, x, y) === "TT.T.TT.") {
                        if(setRightPairTile(x, y, 236, 6154))
                            ++changed;
                        continue;
                    }
                    if(exactShapeConnectAllows(x, y, tile))
                        continue;
                    if(setTile(x, y, 194))
                        ++changed;
                    continue;
                }

                if(tile === 153 &&
                    tileAt(x, y - 1) === 152 &&
                    tileAt(x, y + 1) === 232 &&
                    tileAt(x - 1, y) === 230 &&
                    tileAt(x + 1, y) === 170) {
                    if(setTile(x, y, 231))
                        ++changed;
                    continue;
                }

                if(tile === 239 && below === 236 && !above239[tileAt(x, y - 1)]) {
                    if(setTile(x, y, 199))
                        ++changed;
                    continue;
                }

                if(tile === 197 && tileAt(x - 1, y) === 215 && !isTreeChar(x, y - 1) && isTreeChar(x, y + 1)) {
                    if(setTile(x, y, 217))
                        ++changed;
                    continue;
                }

            }
        }

        return changed;
    };

    pIce.PolishExplicitTreeBottomColumns = function(pContext, pChars, pTiles, pProtected, pTreeRuntime, pTreeStyle) {
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var runtime = (pTreeRuntime && pTreeRuntime.candidates) ? pTreeRuntime : this.TreeRuntimeData();
        var changed = 0;
        var trunkArtifacts = {
            190: true, 191: true, 192: true,
            210: true, 211: true, 212: true,
            213: true, 214: true, 233: true, 234: true
        };

        function isTreeChar(x, y) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return false;
            return self.IsTreeCharValue(MapGen.Layers.Get(pChars, x, y, ""));
        }

        function tileAt(x, y) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return 0;
            return MapGen.Layers.Get(pTiles, x, y, 0) & 0x1FF;
        }

        function setTile(x, y, tile) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return false;
            if(!self.LocalRenderTileDirty(pContext, x, y))
                return false;
            if(pProtected && pProtected(x, y))
                return false;
            if(tileAt(x, y) === tile)
                return false;
            MapGen.Layers.Set(pTiles, x, y, tile);
            return true;
        }

        function runTop(x, y) {
            var top = y;
            while(top > 0 && isTreeChar(x, top - 1))
                --top;
            return top;
        }

        function fillerTile(x, y, role) {
            var shapeKey = self.TreeShapeKey(isTreeChar, x, y);
            var connectKey = self.TreeConnectKey(isTreeChar, x, y);

            if(role === "leftedge") {
                if(shapeKey === ".TT.T.TT")
                    return 154;
                if(shapeKey === "TTT.T.TT")
                    return 154;
                return self.PickListItem(pContext, [230, 231, 170, 172, 193], x, y, 6121);
            }

            if(role === "rightedge") {
                if(shapeKey === "TT.T.TT." || shapeKey === "TTTT.TT.")
                    return 199;
                return self.PickListItem(pContext, [230, 231, 171, 172, 194], x, y, 6122);
            }

            if(connectKey === "1111")
                return self.PickListItem(pContext, [230, 231, 170, 171, 232], x, y, 6123);
            return self.PickListItem(pContext, [230, 231, 170], x, y, 6124);
        }

        function shapeAt(x, y) {
            return self.TreeShapeKey(isTreeChar, x, y);
        }

        function listContains(list, tile) {
            if(!list)
                return false;
            for(var index = 0; index < list.length; ++index) {
                if((list[index] & 0x1FF) === tile)
                    return true;
            }
            return false;
        }

        function candidatesAt(x, y) {
            if(!runtime)
                return null;
            var shapeKey = shapeAt(x, y);
            var connectKey = self.TreeConnectKey(isTreeChar, x, y);
            return self.TreeCandidatesForContext(runtime, shapeKey, connectKey, x, y);
        }

        function canPreserveCanopyTile(x, y, role, fallback) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return false;
            var tile = tileAt(x, y);
            if(trunkArtifacts[tile])
                return false;
            if(role === "leftedge" || role === "rightedge") {
                var explicitCandidates = explicitUpperCandidates(x, y, role, fallback);
                if(explicitCandidates && explicitCandidates.length > 1)
                    return listContains(explicitCandidates, tile);
            }
            return listContains(candidatesAt(x, y), tile);
        }

        function adjacentMiddleStackFits(x, bottomY, dx) {
            var middleX = x + dx;
            var middleBottomY = bottomY - 2;
            if(middleX < 0 || middleX >= width || middleBottomY <= 0 || middleBottomY >= height)
                return false;
            if(self.ExplicitTreeBottomKind(MapGen.Layers.Get(pChars, middleX, middleBottomY, "")) !== "middle")
                return false;
            return self.TreeExplicitMiddleStackFits(runtime, isTreeChar, middleX, middleBottomY, width, height);
        }

        function adjacentMiddleStackAtBottomFits(x, bottomY, dx) {
            var middleX = x + dx;
            if(middleX < 0 || middleX >= width || bottomY <= 0 || bottomY >= height)
                return false;
            if(self.ExplicitTreeBottomKind(MapGen.Layers.Get(pChars, middleX, bottomY, "")) !== "middle")
                return false;
            return self.TreeExplicitMiddleStackFits(runtime, isTreeChar, middleX, bottomY, width, height);
        }

        function explicitUpperCandidates(x, y, role, fallback) {
            var shape = shapeAt(x, y);
            if(role === "leftedge") {
                if(shape === "..T.T.TT")
                    return [215, 215, 195, 173, fallback];
                if(shape === "....T.TT")
                    return [215, 215, 195, 173, fallback];
                if(shape === ".TT.T.TT")
                    return [154, 154, 154, 235, 235, 237, 380, 251, fallback];
            }
            else if(role === "rightedge") {
                if(shape === "TT.T.TT.")
                    return [236, 236, 199, 199, 360, 239, 194, fallback];
                if(shape === "T..T.TT.")
                    return [216, 216, 219, 174, 236, fallback];
                if(shape === "...T.TT." || shape === "...T.TTT" || shape === "T.TTTTT.")
                    return [216, 216, 219, 174, 236, fallback];
            }
            return [fallback];
        }

        function shouldPolishPreservedUpper(x, y, role, fallback) {
            var shape = shapeAt(x, y);
            return (role === "leftedge" && fallback === 213 && shape === ".TT.T.TT") ||
                (role === "rightedge" && fallback === 214 && shape === "TT.T.TT.");
        }

        function setExplicitUpperTile(x, y, role, fallback, salt) {
            var candidates = explicitUpperCandidates(x, y, role, fallback);
            return setTile(x, y, self.PickListItem(pContext, candidates, x, y, salt));
        }

        function middleStackCapTile(index) {
            if(index === 0)
                return 170;
            if(index === 1)
                return 171;
            if(index === 2)
                return 172;
            return 0;
        }

        function polishColumn(x, bottomY, role) {
            var top = runTop(x, bottomY);
            var depth = bottomY - top + 1;
            if(depth <= 0)
                return;

            if(role === "leftedge") {
                var westMiddleStack = adjacentMiddleStackFits(x, bottomY, -1);
                var eastSameBottomMiddleStack = adjacentMiddleStackAtBottomFits(x, bottomY, 1);
                if(setTile(x, bottomY, 233)) ++changed;
                if(depth >= 2 && shapeAt(x, bottomY - 1) !== "TTTTTTTT" &&
                    (!canPreserveCanopyTile(x, bottomY - 1, role, 213) || shouldPolishPreservedUpper(x, bottomY - 1, role, 213)) &&
                    setExplicitUpperTile(x, bottomY - 1, role, 213, 6131)) ++changed;
                var leftSecond = westMiddleStack ? 155 : 235;
                if(depth >= 3 && eastSameBottomMiddleStack && shapeAt(x, bottomY - 2) === ".TT.T.TT") {
                    if(setTile(x, bottomY - 2, leftSecond)) ++changed;
                }
                else if(depth >= 3 && shapeAt(x, bottomY - 2) !== "TTTTTTTT" &&
                    (westMiddleStack || !canPreserveCanopyTile(x, bottomY - 2, role, leftSecond)) &&
                    setExplicitUpperTile(x, bottomY - 2, role, leftSecond, 6132)) ++changed;
                if(depth >= 4) {
                    var leftExtender = westMiddleStack ? 193 : (shapeAt(x, bottomY - 3) === "TTTTTTTT" ?
                        fillerTile(x, bottomY - 3, role) : 154);
                    if(westMiddleStack || eastSameBottomMiddleStack || !canPreserveCanopyTile(x, bottomY - 3, role, leftExtender)) {
                        if(setExplicitUpperTile(x, bottomY - 3, role, leftExtender, 6133)) ++changed;
                    }
                }
                if(depth >= 5 && eastSameBottomMiddleStack && shapeAt(x, bottomY - 4) === "TTTTT.TT") {
                    if(setTile(x, bottomY - 4, 251)) ++changed;
                }
            }
            else if(role === "rightedge") {
                var westSameBottomMiddleStack = adjacentMiddleStackAtBottomFits(x, bottomY, -1);
                if(setTile(x, bottomY, 234)) ++changed;
                if(depth >= 2 && shapeAt(x, bottomY - 1) !== "TTTTTTTT" &&
                    (!canPreserveCanopyTile(x, bottomY - 1, role, 214) || shouldPolishPreservedUpper(x, bottomY - 1, role, 214)) &&
                    setExplicitUpperTile(x, bottomY - 1, role, 214, 6141)) ++changed;
                if(depth >= 3) {
                    if(westSameBottomMiddleStack && shapeAt(x, bottomY - 2) === "TT.T.TT.") {
                        if(setTile(x, bottomY - 2, 236)) ++changed;
                    }
                    else if(shapeAt(x, bottomY - 2) !== "TTTTTTTT" && !canPreserveCanopyTile(x, bottomY - 2, role, 236) && setExplicitUpperTile(x, bottomY - 2, role, 236, 6142)) ++changed;
                }
                if(depth >= 4) {
                    var rightExtender = shapeAt(x, bottomY - 3) === "TTTTTTTT" ?
                        fillerTile(x, bottomY - 3, role) : 199;
                    if(westSameBottomMiddleStack || !canPreserveCanopyTile(x, bottomY - 3, role, rightExtender)) {
                        if(setExplicitUpperTile(x, bottomY - 3, role, rightExtender, 6143)) ++changed;
                    }
                }
            }
            else if(role === "middle") {
                var base = tileAt(x, bottomY);
                var topTile = tileAt(x, bottomY - 1);
                var index = self.TreeStackCycleIndex(pContext, pTreeStyle, isTreeChar, x, bottomY, 3);
                if((topTile === 191 && base === 211) || base === 211)
                    index = 1;
                else if((topTile === 192 && base === 212) || base === 212)
                    index = 2;
                var tops = [190, 191, 192];
                var bases = [210, 211, 212];
                var cap = middleStackCapTile(index);
                if(depth >= 3 && cap && setTile(x, bottomY - 2, cap)) ++changed;
                if(setTile(x, bottomY, bases[index])) ++changed;
                if(depth >= 2 && setTile(x, bottomY - 1, tops[index])) ++changed;
            }

            var reservedTop = bottomY - (role === "middle" ? 2 : 4);
            for(var y = top; y <= reservedTop; ++y) {
                if(!isTreeChar(x, y))
                    continue;
                if(!trunkArtifacts[tileAt(x, y)])
                    continue;
                if(setTile(x, y, fillerTile(x, y, role)))
                    ++changed;
            }
        }

        var bounds = this.LocalRenderBounds(pContext, 0);
        for(var x = bounds.minX; x <= bounds.maxX; ++x) {
            for(var y = 0; y < height; ++y) {
                var role = this.ExplicitTreeBottomKind(MapGen.Layers.Get(pChars, x, y, ""));
                if(!role)
                    continue;
                var inferredRole = this.TreeBottomKind(runtime, isTreeChar, x, y, width, height);
                if(inferredRole && inferredRole !== role &&
                    !this.TreeExplicitBottomRoleFits(runtime, isTreeChar, role, x, y, width, height))
                    continue;
                polishColumn(x, y, role);
            }
        }

        return changed;
    };

    pIce.PolishFinalTreeContextTiles = function(pContext, pChars, pTiles) {
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var changed = 0;

        function isTreeChar(x, y) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return false;
            return self.IsTreeCharValue(MapGen.Layers.Get(pChars, x, y, ""));
        }

        function tileAt(x, y) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return 0;
            return MapGen.Layers.Get(pTiles, x, y, 0) & 0x1FF;
        }

        function isInteriorEdgeArtifact(tile) {
            return tile === 193 || tile === 194;
        }

        function stringListContains(list, value) {
            if(!list)
                return false;
            for(var index = 0; index < list.length; ++index) {
                if(list[index] === value)
                    return true;
            }
            return false;
        }

        function validStackPairAt(x, topY, topTile, bottomTile) {
            if(!isTreeChar(x, topY) || !isTreeChar(x, topY + 1))
                return false;
            if(tileAt(x, topY) !== topTile || tileAt(x, topY + 1) !== bottomTile)
                return false;

            var pairRules = self.IceTreeDiagonalStackPairRules ? self.IceTreeDiagonalStackPairRules() : [];
            for(var ruleIndex = 0; ruleIndex < pairRules.length; ++ruleIndex) {
                var rule = pairRules[ruleIndex];
                if(rule.top !== topTile || rule.bottom !== bottomTile)
                    continue;
                return stringListContains(rule.topShapes, self.TreeShapeKey(isTreeChar, x, topY)) &&
                    stringListContains(rule.bottomShapes, self.TreeShapeKey(isTreeChar, x, topY + 1));
            }
            return false;
        }

        function isStackCapTile(x, y, tile) {
            return (tile === 193 && validStackPairAt(x, y + 1, 213, 233)) ||
                (tile === 193 && tileAt(x, y + 1) === 155 && validStackPairAt(x, y + 2, 213, 233)) ||
                (tile === 194 && validStackPairAt(x, y + 1, 214, 234));
        }

        function isGenericInteriorTreeTile(tile) {
            return tile === 152 || tile === 153 ||
                tile === 170 || tile === 171 || tile === 172 ||
                tile === 230 || tile === 231 || tile === 232;
        }

        function sideShapeCandidates(shape) {
            if(shape === "...TTTTT")
                return [198, 198, 217, 217, 197, 197, 196, 218];
            if(shape === "T..T.TTT" || shape === "T.TTTTTT")
                return [219];
            if(shape === ".TT.T.TT")
                return [154, 154, 154, 154, 235, 235, 235, 237, 237, 380, 251];
            if(shape === "TT.T.TT.")
                return [236, 236, 236, 199, 199, 199, 360, 360, 239, 194];
            if(shape === "..T.T.TT" || shape === "....T.TT")
                return [215, 215, 215, 195, 195, 173];
            if(shape === "T..T.TT." || shape === "...T.TT.")
                return [216, 216, 216, 219, 219, 174, 236];
            return null;
        }

        function isUnsafeTreeOverlayCell(x, y) {
            var layers = pContext.Layers || {};
            var occupied = MapGen.Layers.Get(layers.occupied, x, y, 0);
            return self.IsCliffCell(pContext, x, y) ||
                MapGen.Layers.Get(layers.path, x, y, 0) ||
                MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                MapGen.Layers.Get(layers.water, x, y, 0) ||
                (occupied &&
                    occupied !== 1 &&
                    occupied !== "structure_cluster" &&
                    occupied !== "objective_structure" &&
                    occupied !== "live_structure_clearance");
        }

        function treeCountInRadius(x, y, radius) {
            var total = 0;
            var count = 0;
            var minX = Math.max(0, x - radius);
            var maxX = Math.min(width - 1, x + radius);
            var minY = Math.max(0, y - radius);
            var maxY = Math.min(height - 1, y + radius);

            for(var yy = minY; yy <= maxY; ++yy) {
                for(var xx = minX; xx <= maxX; ++xx) {
                    ++total;
                    if(isTreeChar(xx, yy))
                        ++count;
                }
            }

            return { Count: count, Total: total };
        }

        function isDenseTreeClump(x, y) {
            if(MapGen.Layers.Get(pChars, x, y, "") !== self.Chars.tree)
                return false;

            var near = treeCountInRadius(x, y, 1);
            if(near.Count < near.Total - 1)
                return false;

            var wide = treeCountInRadius(x, y, 2);
            if(wide.Total >= 25)
                return wide.Count >= 21;

            return wide.Count === wide.Total;
        }

        function interiorTreeTile(x, y) {
            return self.PickListItem(pContext, [230, 231, 232, 170, 171], x, y, 6167);
        }

        var bounds = this.LocalRenderBounds(pContext, 0);
        for(var y = bounds.minY; y <= bounds.maxY; ++y) {
            for(var x = bounds.minX; x <= bounds.maxX; ++x) {
                if(!self.LocalRenderTileDirty(pContext, x, y))
                    continue;

                if(isTreeChar(x, y) && this.TreeShapeKey(isTreeChar, x, y) === ".TTTTTT." && tileAt(x, y) !== 231) {
                    MapGen.Layers.Set(pTiles, x, y, 231);
                    ++changed;
                    continue;
                }

                if(isTreeChar(x, y)) {
                    var shapeKey = this.TreeShapeKey(isTreeChar, x, y);
                    var sideCandidates = sideShapeCandidates(shapeKey);
                    var currentTile = tileAt(x, y);
                    if(sideCandidates && isGenericInteriorTreeTile(currentTile) && !isUnsafeTreeOverlayCell(x, y)) {
                        MapGen.Layers.Set(pTiles, x, y, self.PickListItem(pContext, sideCandidates, x, y, 6168));
                        ++changed;
                        continue;
                    }
                }

                var denseTile = tileAt(x, y);
                if(isDenseTreeClump(x, y) && isInteriorEdgeArtifact(denseTile) && !isStackCapTile(x, y, denseTile)) {
                    MapGen.Layers.Set(pTiles, x, y, interiorTreeTile(x, y));
                    ++changed;
                    continue;
                }

                if(x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1)
                    continue;

                if(tileAt(x, y) === 218 || tileAt(x - 1, y) !== 217)
                    continue;
                if(!isTreeChar(x, y) ||
                    isTreeChar(x - 1, y - 1) ||
                    isTreeChar(x, y - 1) ||
                    isTreeChar(x + 1, y - 1) ||
                    !isTreeChar(x - 1, y) ||
                    isTreeChar(x + 1, y) ||
                    !isTreeChar(x - 1, y + 1) ||
                    !isTreeChar(x, y + 1) ||
                    isTreeChar(x + 1, y + 1))
                    continue;

                MapGen.Layers.Set(pTiles, x, y, 218);
                ++changed;
            }
        }

        return changed;
    };

    pIce.IceTreeDiagonalRunRules = function() {
        return [
            {
                shape: "TTTTTTT.",
                axis: "ne_sw",
                minLength: 2,
                allowed: [214, 175, 194, 211],
                fill: [214],
                terminal: [214, 214, 175, 194],
                terminalLong: [214],
                salt: 6169
            },
            {
                shape: "TTTTT.TT",
                axis: "nw_se",
                minLength: 2,
                allowed: [213, 155, 193, 191, 211, 251],
                fill: [213],
                terminal: [213, 213, 155, 193],
                salt: 6171
            },
            {
                shape: "TTTT.T..",
                axis: "ne_sw",
                minLength: 2,
                allowed: [234],
                fill: [234],
                salt: 6172
            },
            {
                shape: "TTT.T..T",
                axis: "nw_se",
                minLength: 2,
                allowed: [233, 211],
                fill: [233],
                salt: 6173
            },
            {
                shape: "T..T.TTT",
                axis: "nw_se",
                minLength: 2,
                allowed: [219],
                fill: [219],
                salt: 6174
            },
            {
                shape: "TT.TTTTT",
                axis: "nw_se",
                minLength: 2,
                allowed: [230, 170, 231, 193, 171, 232],
                fill: [230, 230, 230, 230, 170, 231],
                salt: 6175
            },
            {
                shape: ".TTTTTTT",
                axis: "ne_sw",
                minLength: 2,
                allowed: [230, 170, 171, 231, 172, 153, 232, 197, 152, 235],
                fill: [230, 230, 230, 170, 171, 231],
                salt: 6176
            }
        ];
    };

    pIce.IceTreeDiagonalStackPairRules = function() {
        return [
            {
                top: 214,
                bottom: 234,
                topShapes: ["TTTTTTT.", "TT.T.TT.", "TTTT.TT."],
                bottomShapes: ["TTTT.T..", "TTTT....", "TTTT.TT.", "TT.T.T..", "TT.T...."]
            },
            {
                top: 213,
                bottom: 233,
                topShapes: ["TTTTT.TT", ".TT.T.TT", "TTT.T.TT"],
                bottomShapes: ["TTT.T...", "TTT.T..T", ".TT.T...", ".TT.T..T"]
            }
        ];
    };

    pIce.PolishTreeStackAndDiagonalTiles = function(pContext, pChars, pTiles) {
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var runtime = this.TreeRuntimeData ? this.TreeRuntimeData() : null;
        var iceData = MapGen.Terrain.Smoothing.IceData || {};
        var treeGroundBoundary = iceData.treeGroundBoundary || {};
        var groundBoundaryFallback = (treeGroundBoundary.fallback && treeGroundBoundary.fallback.length) ?
            treeGroundBoundary.fallback : [13, 25, 44, 45, 63];
        var changed = 0;
        var axes = {
            ne_sw: { backX: 1, backY: -1, stepX: -1, stepY: 1 },
            nw_se: { backX: -1, backY: -1, stepX: 1, stepY: 1 }
        };
        var sideStackArtifacts = { 213: true, 214: true, 233: true, 234: true };
        var sideStackShapes = {
            213: {
                "....T..T": true, ".TT.T...": true, ".TT.T..T": true,
                "TT......": true, "TTT.T..T": true, "TTTTT..T": true,
                ".TT.T.TT": true, "TTTTT.TT": true, "TTT.T.TT": true
            },
            214: {
                "...T.T..": true, ".T......": true, "TT.T....": true,
                "TT.T.T..": true, "TTTT.T..": true, "TTTTTT..": true,
                "TTTTTTT.": true, "TT.T.TT.": true, "TTTT.TT.": true,
                "...T.TT.": true
            },
            233: { ".TT.T...": true, "TTT.T...": true, ".TT.T..T": true, ".TT.TTT.": true, ".TT.TTTT": true, "TTT.T..T": true },
            234: { "TTTT....": true, "TT.T....": true, "TT.T.T..": true, "TTTT.T..": true, "TT.T.TT.": true, "TT.T...T": true, "TTTT.TT.": true, "TT.T.T.T": true, "TTTTT...": true }
        };
        var denseInteriorArtifacts = { 193: true, 194: true };

        function isTreeChar(x, y) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return false;
            return self.IsTreeCharValue(MapGen.Layers.Get(pChars, x, y, ""));
        }

        function shapeAt(x, y) {
            return self.TreeShapeKey(isTreeChar, x, y);
        }

        function tileAt(x, y) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return 0;
            return MapGen.Layers.Get(pTiles, x, y, 0) & 0x1FF;
        }

        function listContains(list, tile) {
            if(!list)
                return false;
            for(var index = 0; index < list.length; ++index) {
                if((list[index] & 0x1FF) === tile)
                    return true;
            }
            return false;
        }

        function stringListContains(list, value) {
            if(!list)
                return false;
            for(var index = 0; index < list.length; ++index) {
                if(list[index] === value)
                    return true;
            }
            return false;
        }

        function treeCandidatesAt(x, y) {
            if(!runtime)
                return null;
            var shapeKey = shapeAt(x, y);
            var connectKey = self.TreeConnectKey(isTreeChar, x, y);
            return self.TreeCandidatesForContext(runtime, shapeKey, connectKey, x, y);
        }

        function normalTreeCandidates(x, y) {
            var candidates = treeCandidatesAt(x, y);
            var filtered = [];
            var denseInterior = shapeAt(x, y) === "TTTTTTTT";
            if(candidates) {
                for(var index = 0; index < candidates.length; ++index) {
                    var tile = candidates[index] & 0x1FF;
                    if(sideStackArtifacts[tile])
                        continue;
                    if(denseInterior && denseInteriorArtifacts[tile])
                        continue;
                    filtered.push(candidates[index]);
                }
            }
            return filtered.length ? filtered : [230, 231, 232, 170, 171];
        }

        function setNormalTreeTile(x, y, salt) {
            if(!isTreeChar(x, y) || isUnsafeCell(x, y))
                return false;
            var replacement = self.PickListItem(pContext, normalTreeCandidates(x, y), x, y, salt);
            if(!replacement || tileAt(x, y) === replacement)
                return false;
            MapGen.Layers.Set(pTiles, x, y, replacement);
            return true;
        }

        function isPlainGroundChar(x, y) {
            return x >= 0 && y >= 0 && x < width && y < height &&
                MapGen.Layers.Get(pChars, x, y, self.Chars.ground) === self.Chars.ground;
        }

        function hasAdjacentTreeChar(x, y) {
            return isTreeChar(x, y - 1) || isTreeChar(x + 1, y) ||
                isTreeChar(x, y + 1) || isTreeChar(x - 1, y);
        }

        function setTreeGroundBoundaryTile(x, y, salt) {
            if(!isPlainGroundChar(x, y) || isUnsafeCell(x, y) || !hasAdjacentTreeChar(x, y))
                return false;
            var replacement = self.PickListItem(pContext, groundBoundaryFallback, x, y, salt);
            if(!replacement || tileAt(x, y) === replacement)
                return false;
            MapGen.Layers.Set(pTiles, x, y, replacement);
            return true;
        }

        function allowedSideStackShape(tile, shape) {
            var shapes = sideStackShapes[tile];
            return !!(shapes && shapes[shape]);
        }

        function isUnsafeCell(x, y) {
            var layers = pContext.Layers || {};
            var occupied = MapGen.Layers.Get(layers.occupied, x, y, 0);
            return self.IsCliffCell(pContext, x, y) ||
                MapGen.Layers.Get(layers.path, x, y, 0) ||
                MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                MapGen.Layers.Get(layers.water, x, y, 0) ||
                (occupied &&
                    occupied !== 1 &&
                    occupied !== "structure_cluster" &&
                    occupied !== "objective_structure" &&
                    occupied !== "live_structure_clearance");
        }

        function candidatesFor(rule, length, rank) {
            if(rank < length - 1)
                return rule.fill || rule.allowed;
            if(length >= 3 && rule.terminalLong)
                return rule.terminalLong;
            return rule.terminal || rule.fill || rule.allowed;
        }

        function looksLikeStackPairRule(rule, x, y) {
            return stringListContains(rule.topShapes, shapeAt(x, y - 1)) &&
                stringListContains(rule.bottomShapes, shapeAt(x, y));
        }

        function sideStackKindForRule(rule) {
            if(rule.top === 214 && rule.bottom === 234)
                return "rightedge";
            if(rule.top === 213 && rule.bottom === 233)
                return "leftedge";
            return "";
        }

        function isGroundSideStackPair(rule, x, bottomY) {
            if(!isTreeChar(x, bottomY - 1) || isTreeChar(x, bottomY))
                return false;
            if(isUnsafeCell(x, bottomY - 1) || isUnsafeCell(x, bottomY))
                return false;

            var kind = sideStackKindForRule(rule);
            return kind &&
                self.TreeBottomKind(runtime, isTreeChar, x, bottomY - 1, width, height) === kind &&
                looksLikeStackPairRule(rule, x, bottomY);
        }

        function validSideStackPair(rule, x, bottomY) {
            if(tileAt(x, bottomY - 1) !== rule.top ||
                tileAt(x, bottomY) !== rule.bottom)
                return false;
            if(isGroundSideStackPair(rule, x, bottomY))
                return true;
            return looksLikeStackPairRule(rule, x, bottomY);
        }

        function validSideStackTop(top, bottom, x, topY) {
            var pairRules = self.IceTreeDiagonalStackPairRules();
            for(var ruleIndex = 0; ruleIndex < pairRules.length; ++ruleIndex) {
                var rule = pairRules[ruleIndex];
                if(rule.top === top && rule.bottom === bottom)
                    return validSideStackPair(rule, x, topY + 1);
            }
            return false;
        }

        function rightStackCapCandidates(x, y) {
            var shape = shapeAt(x, y);
            if(shape === "TTTTTTTT" || shape === "...TTTTT")
                return [194];
            if(shape === "TTTTTTT.")
                return [194, 175];
            if(shape === "TT.T.TT.")
                return [236, 236, 199, 199, 360, 239, 194, 238, 175];
            if(shape === "TTTT.TT.")
                return [236, 236, 199, 194, 360, 239, 174, 175];
            if(shape === "T..T.TT." || shape === "...T.TT." || shape === "...T.TTT" || shape === "T.TTTTT.")
                return [216, 216, 219, 174, 236];
            return null;
        }

        function leftStackCapCandidates(x, y) {
            var shape = shapeAt(x, y);
            if(shape === "TTTTTTTT")
                return [193];
            if(shape === "TTTTT.TT")
                return [155, 193];
            if(shape === ".TT.T.TT")
                return [235, 235, 154, 237, 380, 251];
            if(shape === "..T.T.TT" || shape === "....T.TT")
                return [195, 195, 173];
            return null;
        }

        function stackCapCandidates(rule, x, y) {
            if(rule.top === 214 && rule.bottom === 234)
                return rightStackCapCandidates(x, y);
            if(rule.top === 213 && rule.bottom === 233)
                return leftStackCapCandidates(x, y);
            return null;
        }

        function isMiddleStackPair(top, bottom) {
            return (top === 190 && bottom === 210) ||
                (top === 191 && bottom === 211) ||
                (top === 192 && bottom === 212);
        }

        function isSideStackPair(top, bottom) {
            return (top === 213 && bottom === 233) ||
                (top === 214 && bottom === 234);
        }

        function isStackPairCell(x, y) {
            return isMiddleStackPair(tileAt(x, y), tileAt(x, y + 1)) ||
                isMiddleStackPair(tileAt(x, y - 1), tileAt(x, y)) ||
                isSideStackPair(tileAt(x, y), tileAt(x, y + 1)) ||
                isSideStackPair(tileAt(x, y - 1), tileAt(x, y));
        }

        function explicitKindMatchesRule(rule, kind) {
            return (rule.top === 214 && kind === "rightedge") ||
                (rule.top === 213 && kind === "leftedge");
        }

        function explicitSideStackBaseForRule(rule, x, bottomY) {
            var kind = sideStackKindForRule(rule);
            if(!kind || x < 0 || bottomY <= 0 || x >= width || bottomY >= height)
                return false;
            if(!isTreeChar(x, bottomY - 1) || !isTreeChar(x, bottomY))
                return false;
            if(self.ExplicitTreeBottomKind(MapGen.Layers.Get(pChars, x, bottomY, "")) !== kind)
                return false;
            return stringListContains(rule.topShapes, shapeAt(x, bottomY - 1)) &&
                stringListContains(rule.bottomShapes, shapeAt(x, bottomY));
        }

        function hasAdjacentExplicitSideStackBase(rule, x, bottomY) {
            return explicitSideStackBaseForRule(rule, x - 1, bottomY) ||
                explicitSideStackBaseForRule(rule, x + 1, bottomY);
        }

        function hasExplicitTreeStackAbove(rule, x, y) {
            if(y <= 0 || !isTreeChar(x, y - 1))
                return false;
            if(!looksLikeStackPairRule(rule, x, y))
                return false;

            var explicitKind = self.ExplicitTreeBottomKind(MapGen.Layers.Get(pChars, x, y, ""));
            if(explicitKindMatchesRule(rule, explicitKind))
                return true;
            return tileAt(x, y - 1) === rule.top && tileAt(x, y) === rule.bottom;
        }

        function polishBottomEdgeSideStacks() {
            var pairRules = self.IceTreeDiagonalStackPairRules();
            var stackChanged = 0;
            for(var edgeY = 0; edgeY < height - 1; ++edgeY) {
                for(var edgeX = 1; edgeX < width - 1; ++edgeX) {
                    if(!isTreeChar(edgeX, edgeY) || isTreeChar(edgeX, edgeY + 1))
                        continue;
                    if(isUnsafeCell(edgeX, edgeY) || isUnsafeCell(edgeX, edgeY + 1))
                        continue;

                    var kind = self.TreeBottomKind(runtime, isTreeChar, edgeX, edgeY, width, height);
                    for(var ruleIndex = 0; ruleIndex < pairRules.length; ++ruleIndex) {
                        var rule = pairRules[ruleIndex];
                        if(sideStackKindForRule(rule) !== kind)
                            continue;
                        if(!looksLikeStackPairRule(rule, edgeX, edgeY + 1))
                            continue;
                        if(hasAdjacentExplicitSideStackBase(rule, edgeX, edgeY + 1))
                            continue;
                        if(hasExplicitTreeStackAbove(rule, edgeX, edgeY))
                            continue;
                        if(tileAt(edgeX, edgeY) !== rule.top) {
                            MapGen.Layers.Set(pTiles, edgeX, edgeY, rule.top);
                            ++stackChanged;
                        }
                        if(tileAt(edgeX, edgeY + 1) !== rule.bottom) {
                            MapGen.Layers.Set(pTiles, edgeX, edgeY + 1, rule.bottom);
                            ++stackChanged;
                        }
                        break;
                    }
                }
            }
            return stackChanged;
        }

        function clearExplicitStackOverhangs() {
            var pairRules = self.IceTreeDiagonalStackPairRules();
            var cleared = 0;
            var layers = pContext.Layers || {};
            function protectedStaleBase(x, y) {
                return self.IsCliffCell(pContext, x, y) ||
                    MapGen.Layers.Get(layers.path, x, y, 0) ||
                    MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                    MapGen.Layers.Get(layers.water, x, y, 0);
            }

            for(var y = 1; y < height - 1; ++y) {
                for(var x = 1; x < width - 1; ++x) {
                    if(isTreeChar(x, y + 1) || protectedStaleBase(x, y + 1))
                        continue;
                    for(var ruleIndex = 0; ruleIndex < pairRules.length; ++ruleIndex) {
                        var rule = pairRules[ruleIndex];
                        if(tileAt(x, y + 1) !== rule.bottom)
                            continue;
                        if(!hasExplicitTreeStackAbove(rule, x, y))
                            continue;
                        MapGen.Layers.Set(pTiles, x, y + 1, 0);
                        ++cleared;
                        break;
                    }
                }
            }

            for(var topY = 0; topY < height - 2; ++topY) {
                for(var topX = 1; topX < width - 1; ++topX) {
                    if(!isTreeChar(topX, topY) ||
                        isTreeChar(topX, topY + 1) ||
                        isTreeChar(topX, topY + 2) ||
                        protectedStaleBase(topX, topY + 2))
                        continue;

                    for(var groundRuleIndex = 0; groundRuleIndex < pairRules.length; ++groundRuleIndex) {
                        var groundRule = pairRules[groundRuleIndex];
                        if(tileAt(topX, topY) !== groundRule.top ||
                            tileAt(topX, topY + 1) !== groundRule.bottom ||
                            tileAt(topX, topY + 2) !== groundRule.bottom)
                            continue;
                        if(self.TreeBottomKind(runtime, isTreeChar, topX, topY, width, height) !== sideStackKindForRule(groundRule))
                            continue;

                        MapGen.Layers.Set(pTiles, topX, topY + 2, 0);
                        ++cleared;
                        break;
                    }
                }
            }

            for(var groundY = 1; groundY < height; ++groundY) {
                for(var groundX = 1; groundX < width - 1; ++groundX) {
                    if(!isTreeChar(groundX, groundY - 1) ||
                        isTreeChar(groundX, groundY) ||
                        protectedStaleBase(groundX, groundY))
                        continue;

                    for(var sideRuleIndex = 0; sideRuleIndex < pairRules.length; ++sideRuleIndex) {
                        var sideRule = pairRules[sideRuleIndex];
                        if(tileAt(groundX, groundY - 1) !== sideRule.top ||
                            tileAt(groundX, groundY) !== sideRule.bottom)
                            continue;
                        if(!isGroundSideStackPair(sideRule, groundX, groundY))
                            continue;
                        if(!hasAdjacentExplicitSideStackBase(sideRule, groundX, groundY))
                            continue;

                        MapGen.Layers.Set(pTiles, groundX, groundY, 0);
                        ++cleared;
                        if(setNormalTreeTile(groundX, groundY - 1, 6190))
                            ++cleared;
                        var capY = groundY - 2;
                        if(capY >= 0 &&
                            isTreeChar(groundX, capY) &&
                            listContains(stackCapCandidates(sideRule, groundX, capY), tileAt(groundX, capY)) &&
                            setNormalTreeTile(groundX, capY, 6191))
                            ++cleared;
                        break;
                    }
                }
            }
            return cleared;
        }

        function polishStackPairs() {
            var pairRules = self.IceTreeDiagonalStackPairRules();
            var leftAbove = { 154: true, 155: true, 173: true, 193: true, 195: true, 235: true, 237: true, 251: true, 380: true };
            var rightAbove = { 174: true, 194: true, 196: true, 199: true, 236: true, 238: true, 239: true };
            var pairChanged = 0;
            for(var ruleIndex = 0; ruleIndex < pairRules.length; ++ruleIndex) {
                var rule = pairRules[ruleIndex];
                for(var y = 1; y < height; ++y) {
                    for(var x = 1; x < width - 1; ++x) {
                        if(!isTreeChar(x, y) || !isTreeChar(x, y - 1))
                            continue;

                        var currentTop = tileAt(x, y - 1);
                        var currentBottom = tileAt(x, y);
                        var explicitKind = self.ExplicitTreeBottomKind(MapGen.Layers.Get(pChars, x, y, ""));
                        var looksLikePair = looksLikeStackPairRule(rule, x, y);
                        var existingSideTile = looksLikePair &&
                            (currentTop === rule.top || currentBottom === rule.bottom);
                        var explicitSideStack = explicitKindMatchesRule(rule, explicitKind) &&
                            looksLikePair;
                        if(!existingSideTile && !explicitSideStack)
                            continue;
                        if(isUnsafeCell(x, y) || isUnsafeCell(x, y - 1))
                            continue;

                        if(isMiddleStackPair(currentTop, currentBottom))
                            continue;

                        if(currentTop !== rule.top) {
                            MapGen.Layers.Set(pTiles, x, y - 1, rule.top);
                            ++pairChanged;
                        }
                        if(currentBottom !== rule.bottom) {
                            MapGen.Layers.Set(pTiles, x, y, rule.bottom);
                            ++pairChanged;
                        }
                    }
                }
            }

            for(var capY = 0; capY < height - 2; ++capY) {
                for(var capX = 1; capX < width - 1; ++capX) {
                    var capTile = tileAt(capX, capY);
                    if(capTile !== 193 && capTile !== 194)
                        continue;
                    if(isUnsafeCell(capX, capY))
                        continue;

                    for(var capRuleIndex = 0; capRuleIndex < pairRules.length; ++capRuleIndex) {
                        var capRule = pairRules[capRuleIndex];
                        if((capTile === 193 && capRule.top !== 213) ||
                            (capTile === 194 && capRule.top !== 214))
                            continue;
                        if(tileAt(capX, capY + 1) !== capRule.top)
                            continue;

                        var capCandidates = stackCapCandidates(capRule, capX, capY);
                        if(validSideStackPair(capRule, capX, capY + 2) &&
                            listContains(capCandidates, capTile))
                            continue;
                        if(setNormalTreeTile(capX, capY, 6181))
                            ++pairChanged;
                    }
                }
            }

            for(var stackY = 1; stackY < height; ++stackY) {
                for(var stackX = 1; stackX < width - 1; ++stackX) {
                    for(var invalidRuleIndex = 0; invalidRuleIndex < pairRules.length; ++invalidRuleIndex) {
                        var invalidRule = pairRules[invalidRuleIndex];
                        if(tileAt(stackX, stackY - 1) !== invalidRule.top ||
                            tileAt(stackX, stackY) !== invalidRule.bottom)
                            continue;
                        if(validSideStackPair(invalidRule, stackX, stackY))
                            continue;

                        if(setNormalTreeTile(stackX, stackY - 1, 6182) ||
                            setTreeGroundBoundaryTile(stackX, stackY - 1, 6182))
                            ++pairChanged;
                        if(setNormalTreeTile(stackX, stackY, 6183) ||
                            setTreeGroundBoundaryTile(stackX, stackY, 6183))
                            ++pairChanged;
                    }
                }
            }

            for(var artifactY = 1; artifactY < height - 1; ++artifactY) {
                for(var artifactX = 1; artifactX < width - 1; ++artifactX) {
                    var artifactTile = tileAt(artifactX, artifactY);
                    if(!sideStackArtifacts[artifactTile])
                        continue;
                    if(allowedSideStackShape(artifactTile, shapeAt(artifactX, artifactY)))
                        continue;
                    if(setNormalTreeTile(artifactX, artifactY, 6186))
                        ++pairChanged;
                }
            }

            for(var cy = 0; cy < height - 1; ++cy) {
                for(var cx = 1; cx < width - 1; ++cx) {
                    if(!isTreeChar(cx, cy) || isUnsafeCell(cx, cy))
                        continue;

                    var current = tileAt(cx, cy);
                    var below = tileAt(cx, cy + 1);
                    if(below === 214 &&
                        validSideStackTop(214, 234, cx, cy + 1) &&
                        !rightAbove[current] &&
                        current !== 233 &&
                        current !== 234) {
                        var rightCapCandidates = rightStackCapCandidates(cx, cy);
                        if(rightCapCandidates) {
                            var rightCap = self.PickListItem(pContext, rightCapCandidates, cx, cy, 6184);
                            if(rightCap && current !== rightCap) {
                                MapGen.Layers.Set(pTiles, cx, cy, rightCap);
                                ++pairChanged;
                            }
                        }
                    }
                    else if(below === 213 &&
                        validSideStackTop(213, 233, cx, cy + 1) &&
                        !leftAbove[current] &&
                        current !== 233 &&
                        current !== 234) {
                        var leftCapCandidates = leftStackCapCandidates(cx, cy);
                        if(leftCapCandidates) {
                            var leftCap = self.PickListItem(pContext, leftCapCandidates, cx, cy, 6185);
                            if(leftCap && current !== leftCap) {
                                MapGen.Layers.Set(pTiles, cx, cy, leftCap);
                                ++pairChanged;
                            }
                        }
                    }
                }
            }
            return pairChanged;
        }

        function previousInRun(rule, axis, x, y) {
            var px = x + axis.backX;
            var py = y + axis.backY;
            return px > 0 && py > 0 && px < width - 1 && py < height - 1 &&
                shapeAt(px, py) === rule.shape;
        }

        function collectRun(rule, axis, x, y) {
            var run = [];
            while(x > 0 && y > 0 && x < width - 1 && y < height - 1 && shapeAt(x, y) === rule.shape) {
                run.push({ x: x, y: y });
                x += axis.stepX;
                y += axis.stepY;
            }
            return run;
        }

        changed += polishBottomEdgeSideStacks();
        changed += clearExplicitStackOverhangs();
        changed += polishStackPairs();

        var rules = this.IceTreeDiagonalRunRules();
        for(var ruleIndex = 0; ruleIndex < rules.length; ++ruleIndex) {
            var rule = rules[ruleIndex];
            var axis = axes[rule.axis];
            if(!axis)
                continue;

            for(var y = 1; y < height - 1; ++y) {
                for(var x = 1; x < width - 1; ++x) {
                    if(!isTreeChar(x, y) || shapeAt(x, y) !== rule.shape)
                        continue;
                    if(previousInRun(rule, axis, x, y))
                        continue;

                    var run = collectRun(rule, axis, x, y);
                    if(run.length < (rule.minLength || 2))
                        continue;

                    for(var rank = 0; rank < run.length; ++rank) {
                        var cell = run[rank];
                        var current = tileAt(cell.x, cell.y);
                        if(listContains(rule.allowed, current))
                            continue;
                        if(isStackPairCell(cell.x, cell.y))
                            continue;
                        if(isUnsafeCell(cell.x, cell.y))
                            continue;

                        var candidates = candidatesFor(rule, run.length, rank);
                        var replacement = self.PickListItem(pContext, candidates, cell.x, cell.y, rule.salt + rank);
                        if(!replacement || current === replacement)
                            continue;
                        MapGen.Layers.Set(pTiles, cell.x, cell.y, replacement);
                        ++changed;
                    }
                }
            }
        }

        // This is the final ice-tree pass after terrain/object overlays. An
        // explicit L/R char is already committed stack geometry, but stale
        // route/occupancy protection can make the earlier column painter skip
        // it and the diagonal polish above can then leave unrelated 211/238/
        // 239 tiles behind. Reassert the complete two-tile retail phrase last
        // so these cells cannot render as truncated green shards.
        for(var baseY = 1; baseY < height; ++baseY) {
            for(var baseX = 0; baseX < width; ++baseX) {
                var explicitRole = self.ExplicitTreeBottomKind(
                    MapGen.Layers.Get(pChars, baseX, baseY, "")
                );
                if((explicitRole !== "leftedge" && explicitRole !== "rightedge") ||
                    !isTreeChar(baseX, baseY - 1))
                    continue;

                var explicitTop = explicitRole === "leftedge" ? 213 : 214;
                var explicitBase = explicitRole === "leftedge" ? 233 : 234;
                if(tileAt(baseX, baseY - 1) !== explicitTop) {
                    MapGen.Layers.Set(pTiles, baseX, baseY - 1, explicitTop);
                    ++changed;
                }
                if(tileAt(baseX, baseY) !== explicitBase) {
                    MapGen.Layers.Set(pTiles, baseX, baseY, explicitBase);
                    ++changed;
                }
            }
        }

        return changed;
    };

    pIce.ApplyTreeColumns = function(pContext, pChars, pTiles, pTreeRuntime, pProtected, pTreeGroundBoundary) {
        var runtime = (pTreeRuntime && pTreeRuntime.candidates) ? pTreeRuntime : this.TreeRuntimeData();
        if(!runtime)
            return 0;

        var Core = MapGen.Terrain.Smoothing.Core;
        var painted = 0;
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var treeStyle = this.SelectIceTreeStyle(pContext, pChars);
        var maxStackHeight = 1;
        var stackGroups = runtime.stacks || {};
        for(var stackKind in stackGroups) {
            if(!stackGroups.hasOwnProperty(stackKind))
                continue;
            var stacks = stackGroups[stackKind] || [];
            for(var stackIndex = 0; stackIndex < stacks.length; ++stackIndex) {
                var stackHeight = this.FlattenTreeStack(stacks[stackIndex]).length;
                if(stackHeight > maxStackHeight)
                    maxStackHeight = stackHeight;
            }
        }
        function isTreeChar(x, y) {
            if(x < 0) x = 0;
            else if(x >= width) x = width - 1;
            if(y < 0) y = 0;
            else if(y >= height) y = height - 1;
            return self.IsTreeCharValue(MapGen.Layers.Get(pChars, x, y, ""));
        }

        function explicitSideStackFits(kind, x, bottomY, stack) {
            return self.TreeExplicitSideStackFits(isTreeChar, kind, x, bottomY, stack);
        }

        function sideStackRuleFor(kind, stack) {
            if(kind !== "leftedge" && kind !== "rightedge")
                return null;
            if(!stack || stack.length !== 2)
                return null;

            var pairRules = self.IceTreeDiagonalStackPairRules ? self.IceTreeDiagonalStackPairRules() : [];
            for(var ruleIndex = 0; ruleIndex < pairRules.length; ++ruleIndex) {
                var rule = pairRules[ruleIndex];
                if(self.TreeSideStackKindForRule(rule) !== kind)
                    continue;
                if((stack[0] & 0x1FF) !== rule.top || (stack[1] & 0x1FF) !== rule.bottom)
                    continue;
                return rule;
            }
            return null;
        }

        function sideStackRuleShapesFit(rule, x, bottomY) {
            return rule &&
                self.TreeKeyInList(rule.topShapes, self.TreeShapeKey(isTreeChar, x, bottomY - 1)) &&
                self.TreeKeyInList(rule.bottomShapes, self.TreeShapeKey(isTreeChar, x, bottomY));
        }

        function inferredSideStackOverhangFits(kind, x, topY, stack) {
            return sideStackRuleShapesFit(sideStackRuleFor(kind, stack), x, topY + 1);
        }

        function explicitSideStackBaseAt(kind, x, bottomY, stack) {
            if(x < 0 || bottomY <= 0 || x >= width || bottomY >= height)
                return false;
            if(self.ExplicitTreeBottomKind(MapGen.Layers.Get(pChars, x, bottomY, "")) !== kind)
                return false;
            return explicitSideStackFits(kind, x, bottomY, stack);
        }

        function hasAdjacentExplicitSideStackBase(kind, x, bottomY, stack) {
            return explicitSideStackBaseAt(kind, x - 1, bottomY, stack) ||
                explicitSideStackBaseAt(kind, x + 1, bottomY, stack);
        }

        function middleStackCapTile(topTile) {
            if(topTile === 190)
                return 170;
            if(topTile === 191)
                return 171;
            if(topTile === 192)
                return 172;
            return 0;
        }

        function paintMiddleStackCap(x, topY, stackTop) {
            var capY = topY - 1;
            var capTile = middleStackCapTile(stackTop);
            if(!capTile || capY < 0 || !isTreeChar(x, capY))
                return 0;
            if(!self.LocalRenderTileDirty(pContext, x, capY))
                return 0;
            Core.SetTileIfAllowed(pTiles, x, capY, capTile, pProtected);
            return 1;
        }

        function tileAt(x, y) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return 0;
            return MapGen.Layers.Get(pTiles, x, y, 0) & 0x1FF;
        }

        function clearExplicitStackOverhangs() {
            var cleared = 0;
            var pairs = {
                leftedge: { top: 213, bottom: 233 },
                rightedge: { top: 214, bottom: 234 }
            };
            var layers = pContext.Layers || {};

            function protectedStaleBase(x, y) {
                return MapGen.Layers.Get(layers.path, x, y, 0) ||
                    MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                    MapGen.Layers.Get(layers.water, x, y, 0);
            }

            var bounds = self.LocalRenderBounds(pContext, 1);
            for(var y = Math.max(1, bounds.minY); y <= Math.min(height - 2, bounds.maxY); ++y) {
                for(var x = bounds.minX; x <= bounds.maxX; ++x) {
                    var kind = self.ExplicitTreeBottomKind(MapGen.Layers.Get(pChars, x, y, ""));
                    var pair = pairs[kind];
                    if(!pair)
                        continue;
                    if(!isTreeChar(x, y - 1) || !isTreeChar(x, y) || isTreeChar(x, y + 1))
                        continue;
                    if(tileAt(x, y - 1) !== pair.top ||
                        tileAt(x, y) !== pair.bottom ||
                        tileAt(x, y + 1) !== pair.bottom)
                        continue;
                    if(!explicitSideStackFits(kind, x, y, [pair.top, pair.bottom]))
                        continue;
                    if(!self.LocalRenderTileDirty(pContext, x, y + 1) || protectedStaleBase(x, y + 1))
                        continue;
                    MapGen.Layers.Set(pTiles, x, y + 1, 0);
                    ++cleared;
                }
            }
            return cleared;
        }

        var tileBounds = this.LocalRenderBounds(pContext, 0);
        for(var y = tileBounds.minY; y <= tileBounds.maxY; ++y) {
            for(var x = tileBounds.minX; x <= tileBounds.maxX; ++x) {
                if(!self.LocalRenderTileDirty(pContext, x, y))
                    continue;

                if(!isTreeChar(x, y))
                    continue;
                var shapeKey = this.TreeShapeKey(isTreeChar, x, y);
                var connectKey = this.TreeConnectKey(isTreeChar, x, y);
                var candidates = this.TreeCandidatesForContext(runtime, shapeKey, connectKey, x, y);
                var tile = this.PickTreeCandidateStyled(pContext, treeStyle, candidates, x, y, 4001, isTreeChar, shapeKey, connectKey);
                if(tile) {
                    Core.SetTileIfAllowed(pTiles, x, y, tile, pProtected);
                    ++painted;
                }
            }
        }

        var middlePairKeys = runtime.middlePairKeys || [];
        if(middlePairKeys.length) {
            var pairBounds = this.LocalRenderBounds(pContext, 1);
            for(var py = Math.max(1, pairBounds.minY); py <= pairBounds.maxY; ++py) {
                for(var px = pairBounds.minX; px <= pairBounds.maxX; ++px) {
                    if(!self.LocalRenderTileDirty(pContext, px, py) &&
                        !self.LocalRenderTileDirty(pContext, px, py - 1))
                        continue;

                    if(!isTreeChar(px, py) || !isTreeChar(px, py - 1) || isTreeChar(px, py + 1))
                        continue;
                    var explicitPairKind = this.ExplicitTreeBottomKind(MapGen.Layers.Get(pChars, px, py, ""));
                    if(explicitPairKind && explicitPairKind !== "middle")
                        continue;
                    var pairKey = this.TreeMiddlePairKey(isTreeChar, px, py, width, height);
                    if(!this.TreeKeyInList(middlePairKeys, pairKey))
                        continue;
                    var pairStack = this.PickTreeStackStyled(pContext, runtime, treeStyle, "middle", px, py, isTreeChar);
                    if(!pairStack || pairStack.length < 2)
                        continue;
                    painted += paintMiddleStackCap(px, py - 1, pairStack[0]);
                    Core.SetTileIfAllowed(pTiles, px, py - 1, pairStack[0], pProtected);
                    Core.SetTileIfAllowed(pTiles, px, py, pairStack[1], pProtected);
                    painted += 2;
                }
            }
        }

        var stackBounds = this.LocalRenderBounds(pContext, maxStackHeight);
        for(var bx = stackBounds.minX; bx <= stackBounds.maxX; ++bx) {
            for(var by = stackBounds.minY; by <= stackBounds.maxY; ++by) {
                if(!isTreeChar(bx, by) || isTreeChar(bx, by + 1))
                    continue;
                if(this.IsMiddlePairBaseTile(pTiles, bx, by))
                    continue;

                var explicitKind = this.ExplicitTreeBottomKind(MapGen.Layers.Get(pChars, bx, by, ""));
                var inferredKind = this.TreeBottomKind(runtime, isTreeChar, bx, by, width, height);
                var kind = "";
                var stack = null;
                var useExplicitStackPlacement = false;

                if(explicitKind) {
                    stack = this.PickTreeStackStyled(pContext, runtime, treeStyle, explicitKind, bx, by, isTreeChar);
                    if(stack && stack.length && this.TreeExplicitBottomRoleFits(runtime, isTreeChar, explicitKind, bx, by, width, height, stack)) {
                        kind = explicitKind;
                        useExplicitStackPlacement = explicitKind !== "middle";
                    }
                    else {
                        stack = null;
                    }
                }

                if(!kind && inferredKind) {
                    kind = inferredKind;
                    stack = this.PickTreeStackStyled(pContext, runtime, treeStyle, kind, bx, by, isTreeChar);
                }
                if(!kind)
                    continue;
                if(kind === "middle" && by >= height - 1)
                    continue;
                if(kind !== "middle" && by >= height - 1)
                    continue;
                if(!stack || !stack.length)
                    continue;
                if(!useExplicitStackPlacement && (kind === "leftedge" || kind === "rightedge") &&
                    stack.length > 1 && !inferredSideStackOverhangFits(kind, bx, by, stack))
                    continue;

                var topY = (kind === "middle" || useExplicitStackPlacement) ? by - stack.length + 1 : by;
                if(topY < 0)
                    continue;
                if(kind === "middle" || useExplicitStackPlacement) {
                    var fits = true;
                    for(var mi = 0; mi < stack.length; ++mi) {
                        if(!isTreeChar(bx, topY + mi)) { fits = false; break; }
                    }
                    if(!fits)
                        continue;
                }

                if(!useExplicitStackPlacement && kind !== "middle" && stack.length > 1) {
                    var overhangY = by + 1;
                    var overhangChar = MapGen.Layers.Get(pChars, bx, overhangY, "#");
                    if(overhangY >= height ||
                        isTreeChar(bx, overhangY) ||
                        overhangChar === this.Chars.water ||
                        overhangChar === this.Chars.bank ||
                        overhangChar === this.Chars.path ||
                        hasAdjacentExplicitSideStackBase(kind, bx, overhangY, stack) ||
                        (pProtected && pProtected(bx, overhangY)))
                        continue;
                }

                // Inferred edge stacks overhang one ground cell; explicit
                // L/R/M bottom chars end their stack on the tree bottom row.
                for(var si = 0; si < stack.length; ++si) {
                    var ty = topY + si;
                    if(ty < 0 || ty >= height)
                        continue;
                    if(!self.LocalRenderTileDirty(pContext, bx, ty))
                        continue;
                    if(!useExplicitStackPlacement && kind !== "middle" && si > 0 && isTreeChar(bx, ty))
                        continue;
                    if(!useExplicitStackPlacement && kind !== "middle" && si > 0) {
                        var underChar = MapGen.Layers.Get(pChars, bx, ty, "#");
                        if(underChar === this.Chars.water ||
                            underChar === this.Chars.bank ||
                            underChar === this.Chars.path)
                            continue;
                    }
                    Core.SetTileIfAllowed(pTiles, bx, ty, stack[si], pProtected);
                    ++painted;
                }
                if(kind === "middle")
                    painted += paintMiddleStackCap(bx, topY, stack[0]);
            }
        }

        painted += this.ApplyTreeGroundBoundary(pContext, pChars, pTiles, pProtected, pTreeGroundBoundary);
        painted += this.PolishTreeTilePairs(pContext, pChars, pTiles, pProtected);
        painted += this.PolishExplicitTreeBottomColumns(pContext, pChars, pTiles, pProtected, runtime, treeStyle);
        painted += this.PolishTreeTilePairs(pContext, pChars, pTiles, pProtected);
        painted += clearExplicitStackOverhangs();
        return painted;
    };

    pIce.AddTreeTileSetItems = function(pSet, pItems) {
        if(!pItems)
            return;
        if(typeof pItems === "number") {
            pSet[pItems & 0x1FF] = true;
            return;
        }
        if(pItems.length !== undefined) {
            for(var index = 0; index < pItems.length; ++index)
                this.AddTreeTileSetItems(pSet, pItems[index]);
            return;
        }
        for(var key in pItems) {
            if(pItems.hasOwnProperty(key))
                this.AddTreeTileSetItems(pSet, pItems[key]);
        }
    };

    pIce.BuildTreeTileSet = function(pRuntime, pTreeGroundBoundary) {
        var runtime = pRuntime || this.TreeRuntimeData();
        var set = {};

        if(runtime) {
            this.AddTreeTileSetItems(set, runtime.candidates);
            this.AddTreeTileSetItems(set, runtime.shapeCandidates);
            this.AddTreeTileSetItems(set, runtime.stacks);
            this.AddTreeTileSetItems(set, runtime.fallback);
        }

        return set;
    };

    pIce.RepairUnpaintedTreeChars = function(pContext, pChars, pTiles, pTreeRuntime, pTreeGroundBoundary) {
        var runtime = (pTreeRuntime && pTreeRuntime.candidates) ? pTreeRuntime : this.TreeRuntimeData();
        if(!runtime)
            return 0;

        var Core = MapGen.Terrain.Smoothing.Core;
        var treeTiles = this.BuildTreeTileSet(runtime, pTreeGroundBoundary);
        var width = pContext.Width;
        var height = pContext.Height;
        var layers = pContext.Layers || {};
        var self = this;
        var changed = 0;

        function isTreeChar(x, y) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return false;
            return self.IsTreeCharValue(MapGen.Layers.Get(pChars, x, y, ""));
        }

        var bounds = this.LocalRenderBounds(pContext, 0);
        for(var y = bounds.minY; y <= bounds.maxY; ++y) {
            for(var x = bounds.minX; x <= bounds.maxX; ++x) {
                if(!self.LocalRenderTileDirty(pContext, x, y))
                    continue;

                if(!isTreeChar(x, y))
                    continue;

                var current = MapGen.Layers.Get(pTiles, x, y, 0) & 0x1FF;
                if(treeTiles[current])
                    continue;
                var occupied = MapGen.Layers.Get(layers.occupied, x, y, 0);
                if(MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                    MapGen.Layers.Get(layers.water, x, y, 0) ||
                    (occupied && occupied !== "live_structure_clearance"))
                    continue;

                var shapeKey = this.TreeShapeKey(isTreeChar, x, y);
                var connectKey = this.TreeConnectKey(isTreeChar, x, y);
                var candidates = this.TreeCandidatesForContext(runtime, shapeKey, connectKey, x, y) ||
                    (runtime.fallback && runtime.fallback.fill);
                var tile = this.PickListItem(pContext, candidates, x, y, 4071);
                if(!tile)
                    continue;

                Core.SetTile(pTiles, x, y, tile);
                ++changed;
            }
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Repaired unpainted ice tree chars: " + changed);

        return changed;
    };

})(MapGen.Terrain.Smoothing.Ice);
