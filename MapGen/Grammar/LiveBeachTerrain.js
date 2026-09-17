var MapGen = MapGen || {};
MapGen.Grammar = MapGen.Grammar || {};

(function(pGrammar) {
    var liveBeachTerrain = {
    ShouldOwnLiveBeachTerrain: function(pContext) {
        return !!(pContext &&
            pContext.Profile &&
            pContext.Profile.TargetPackProfile === "grammar_beach" &&
            pContext.Profile.TerrainTypeSub === 1);
    },

    ResetLiveTerrainLayers: function(pContext) {
        var layers = pContext.Layers;
        var names = [
            "water", "riverBank", "forcedBank", "lakeShore", "coast",
            "crossing", "causeway", "terrainEdge", "outcrop", "blocked"
        ];

        for(var index = 0; index < names.length; ++index)
            layers[names[index]] = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);

        pContext.Rivers = [];
        pContext.Ponds = [];
        pContext.Lakes = [];
        pContext.Beaches = [];
        pContext.EdgeBiomes = [];
        pContext.Crossings = [];
        pContext.Outcrops = [];
        pContext._jungleLocalBeachFocus = undefined;
    },

    ClampPoint: function(pContext, pX, pY) {
        return {
            x: Math.max(1, Math.min(pContext.Width - 2, Math.round(pX))),
            y: Math.max(1, Math.min(pContext.Height - 2, Math.round(pY)))
        };
    },

    ProtectedLiveTerrainPoints: function(pContext) {
        var points = [];
        var anchors = pContext.Anchors || {};
        var key;

        for(key in anchors) {
            if(anchors.hasOwnProperty(key) && anchors[key])
                points.push(anchors[key]);
        }

        var critical = pContext.CriticalPoints || [];
        for(var index = 0; index < critical.length; ++index) {
            var point = critical[index].point || critical[index];
            if(point)
                points.push(point);
        }

        return points;
    },

    PointNearList: function(pPoint, pList, pRadius) {
        var radiusSq = pRadius * pRadius;

        for(var index = 0; index < pList.length; ++index) {
            var point = pList[index];
            var dx = point.x - pPoint.x;
            var dy = point.y - pPoint.y;
            if((dx * dx) + (dy * dy) <= radiusSq)
                return true;
        }

        return false;
    },

    LiveTerrainCellKey: function(pX, pY) {
        return pX + "," + pY;
    },

    RecordLiveTerrainPoint: function(pOutPoints, pSeen, pX, pY) {
        var key = this.LiveTerrainCellKey(pX, pY);
        if(pSeen && pSeen[key])
            return false;

        if(pSeen)
            pSeen[key] = true;
        pOutPoints.push({ x: pX, y: pY });
        return true;
    },

    HasLiveTerrainLayerNear: function(pLayer, pX, pY, pRadius) {
        var radius = Math.max(0, Math.floor(pRadius || 0));

        if(!pLayer)
            return false;

        for(var x = pX - radius; x <= pX + radius; ++x) {
            for(var y = pY - radius; y <= pY + radius; ++y) {
                if(Math.max(Math.abs(x - pX), Math.abs(y - pY)) > radius)
                    continue;
                if(MapGen.Layers.Get(pLayer, x, y, 0))
                    return true;
            }
        }

        return false;
    },

    IsLiveTerrainProtectedCell: function(pContext, pX, pY, pProtectedPoints, pRadius) {
        var layers = pContext.Layers || {};

        if(!MapGen.Layers.InBounds(layers.water, pX, pY))
            return true;
        if(MapGen.Layers.Get(layers.keepClear, pX, pY, 0) ||
            MapGen.Layers.Get(layers.path, pX, pY, 0) ||
            MapGen.Layers.Get(layers.crossing, pX, pY, 0) ||
            MapGen.Layers.Get(layers.occupied, pX, pY, 0) ||
            MapGen.Layers.Get(layers.structureGround, pX, pY, 0))
            return true;

        return this.PointNearList({ x: pX, y: pY }, pProtectedPoints || [], pRadius || 3);
    },

    IsLiveBeachProtectedCell: function(pContext, pX, pY, pAllowRiverBank) {
        var layers = pContext.Layers || {};

        if(!MapGen.Layers.InBounds(layers.coast, pX, pY))
            return true;
        if(MapGen.Layers.Get(layers.water, pX, pY, 0) ||
            MapGen.Layers.Get(layers.structureGround, pX, pY, 0))
            return true;
        if(!pAllowRiverBank && MapGen.Layers.Get(layers.riverBank, pX, pY, 0))
            return true;

        return false;
    },

    IsLiveWaterProtectedCell: function(pContext, pX, pY, pProtectedPoints, pRadius) {
        var layers = pContext.Layers || {};

        if(!MapGen.Layers.InBounds(layers.water, pX, pY))
            return true;
        if(MapGen.Layers.Get(layers.structureGround, pX, pY, 0) ||
            MapGen.Layers.Get(layers.occupied, pX, pY, 0))
            return true;

        return false;
    },

    SetLiveWaterCell: function(pContext, pX, pY, pOutPoints, pSeen) {
        var layers = pContext.Layers;

        if(!MapGen.Layers.InBounds(layers.water, pX, pY))
            return false;

        MapGen.Layers.Set(layers.water, pX, pY, 1);
        MapGen.Layers.Set(layers.coast, pX, pY, 0);
        MapGen.Layers.Set(layers.riverBank, pX, pY, 0);
        MapGen.Layers.Set(layers.blocked, pX, pY, 0);

        if(pOutPoints)
            this.RecordLiveTerrainPoint(pOutPoints, pSeen, pX, pY);
        return true;
    },

    SetLiveBeachCell: function(pContext, pX, pY, pOutPoints, pSeen) {
        var layers = pContext.Layers;

        if(!MapGen.Layers.InBounds(layers.coast, pX, pY))
            return false;
        if(MapGen.Layers.Get(layers.water, pX, pY, 0))
            return false;

        MapGen.Layers.Set(layers.coast, pX, pY, 1);
        MapGen.Layers.Set(layers.riverBank, pX, pY, 0);
        MapGen.Layers.Set(layers.blocked, pX, pY, 0);

        if(pOutPoints)
            this.RecordLiveTerrainPoint(pOutPoints, pSeen, pX, pY);
        return true;
    },

    SetLiveQuicksandCell: function(pContext, pX, pY, pOutPoints, pSeen) {
        var layers = pContext.Layers;

        if(!MapGen.Layers.InBounds(layers.riverBank, pX, pY))
            return false;
        if(MapGen.Layers.Get(layers.water, pX, pY, 0) ||
            MapGen.Layers.Get(layers.coast, pX, pY, 0))
            return false;

        MapGen.Layers.Set(layers.riverBank, pX, pY, 1);
        MapGen.Layers.Set(layers.blocked, pX, pY, 0);

        if(pOutPoints)
            this.RecordLiveTerrainPoint(pOutPoints, pSeen, pX, pY);
        return true;
    },

    BuildBeachShorePoints: function(pContext, pWaterPoints) {
        var shorePoints = [];
        var shoreSeen = {};
        var offsets = [
            [0, -1],
            [1, 0],
            [0, 1],
            [-1, 0]
        ];

        for(var waterIndex = 0; waterIndex < pWaterPoints.length; ++waterIndex) {
            var water = pWaterPoints[waterIndex];
            for(var offsetIndex = 0; offsetIndex < offsets.length; ++offsetIndex) {
                var sx = water.x + offsets[offsetIndex][0];
                var sy = water.y + offsets[offsetIndex][1];
                if(MapGen.Layers.Get(pContext.Layers.water, sx, sy, 0))
                    continue;
                if(MapGen.Layers.InBounds(pContext.Layers.coast, sx, sy))
                    this.RecordLiveTerrainPoint(shorePoints, shoreSeen, sx, sy);
            }
        }

        return shorePoints;
    },

    BeachEdgeSide: function(pContext) {
        if(pContext && pContext.Profile && pContext.Profile.TargetPackProfile === "grammar_beach") {
            var family = this.GrammarBeachFamily(pContext);
            if(family === "mapm5_top_bank")
                return 0;
            if(family === "mapm8_corner_cove")
                return 1;
            // mapm6 is an interior channel rather than a coast. Return a
            // deterministic planning side only for callers that need an
            // orientation hint; the channel builder itself does not use it.
            return (MapGen.Random.HashTile(pContext.Seed, 89, 93, 3539) % 2) ? 0 : 2;
        }

        var seed = pContext ? pContext.Seed || 0 : 0;
        var roll = MapGen.Random.HashTile(seed, 71, 79, 751) % 100;

        if(roll < 40)
            return 1;   // right
        if(roll < 65)
            return 2;   // bottom
        if(roll < 85)
            return 3;   // left
        return 0;       // top
    },

    GrammarBeachVariantHash: function(pContext, pSalt, pUseRequestedSeed) {
        var seed = pContext ? pContext.Seed || 0 : 0;
        if(pUseRequestedSeed && pContext && pContext.RequestedSeed !== undefined)
            seed = pContext.RequestedSeed;

        // HashTile is excellent for spatial noise, but its additive seed input
        // leaves neighbouring seeds correlated when the result is reduced to a
        // tiny macro-choice range. Campaign/UI seeds are commonly timestamp-
        // adjacent, which was enough to produce long runs of the same beach
        // family. Four LCG rounds provide a deterministic avalanche before the
        // modulo without consuming the context's generation RNG stream.
        var mixedSeed = ((seed >>> 0) ^ ((pSalt * 2654435761) >>> 0)) >>> 0;
        var random = MapGen.Random.CreateSeeded(mixedSeed);
        random.Float(0, 1);
        random.Float(0, 1);
        random.Float(0, 1);
        return Math.floor(random.Float(0, 4294967296)) >>> 0;
    },

    GrammarBeachFamily: function(pContext) {
        if(pContext.Profile && pContext.Profile.GrammarBeachChannel)
            return "mapm6_bridge_channel";
        var roll = this.GrammarBeachVariantHash(pContext, 3541, true) % 100;

        // Beach means coast. Keep both coast orientations; the interior
        // channel is selected only by the explicit river-crossing profile.
        // Historical names feed anchors; terrain uses local legal joins.
        if(roll < 59)
            return "mapm5_top_bank";
        return "mapm8_corner_cove";
    },

    GrammarBeachLayoutVariant: function(pContext) {
        return this.GrammarBeachVariantHash(pContext, 3557, false) % 6;
    },

    GrammarBeachLengthVariant: function(pContext) {
        return this.GrammarBeachVariantHash(pContext, 3607, false) % 6;
    },

    GrammarBeachCompositionVariant: function(pContext) {
        return this.GrammarBeachVariantHash(pContext, 3613, false) % 12;
    },

    GrammarBeachCourseVariant: function(pContext) {
        return this.GrammarBeachVariantHash(pContext, 3631, false) % 12;
    },

    BeachEdgeSideName: function(pSide) {
        switch(Number(pSide || 0)) {
            case 1: return "right";
            case 2: return "bottom";
            case 3: return "left";
            case 0:
            default:
                return "top";
        }
    },

    GrammarBeachOceanProtectedCell: function(pContext, pX, pY) {
        var layers = pContext ? pContext.Layers || {} : {};

        return MapGen.Layers.Get(layers.keepClear, pX, pY, 0) ||
            MapGen.Layers.Get(layers.path, pX, pY, 0) ||
            MapGen.Layers.Get(layers.crossing, pX, pY, 0) ||
            MapGen.Layers.Get(layers.occupied, pX, pY, 0) ||
            MapGen.Layers.Get(layers.structureGround, pX, pY, 0);
    },

    ClampGrammarBeachOceanDepthForProtectedCells: function(pContext, pDepths, pVerticalEdge, pPositiveEdge, pCrossLimit, pDepthMin, pStartT) {
        var changed = 0;
        var startT = Math.max(0, Math.floor(Number(pStartT || 0)));

        for(var t = 0; t < pDepths.length; ++t) {
            var depth = pDepths[t];
            var axis = startT + t;
            var startCross = pPositiveEdge ? pCrossLimit - depth : 0;
            var endCross = pPositiveEdge ? pCrossLimit - 1 : depth - 1;
            var adjustedDepth = depth;

            for(var cross = startCross; cross <= endCross; ++cross) {
                var x = pVerticalEdge ? cross : axis;
                var y = pVerticalEdge ? axis : cross;

                if(!this.GrammarBeachOceanProtectedCell(pContext, x, y))
                    continue;

                if(pPositiveEdge)
                    adjustedDepth = Math.min(adjustedDepth, Math.max(pDepthMin, pCrossLimit - cross - 2));
                else
                    adjustedDepth = Math.min(adjustedDepth, Math.max(pDepthMin, cross - 2));
            }

            if(adjustedDepth !== depth) {
                pDepths[t] = adjustedDepth;
                ++changed;
            }
        }

        return changed;
    },

    BuildEdgeBeachInlet: function(pContext, pProtectedPoints) {
        var waterPoints = [];
        var waterSeen = {};
        var beachCandidates = [];
        var grammarBeachOcean =
            pContext &&
            pContext.Profile &&
            pContext.Profile.TargetPackProfile === "grammar_beach";
        var side = this.BeachEdgeSide(pContext);
        var verticalEdge = side === 1 || side === 3;
        var positiveEdge = side === 1 || side === 2;
        var length = verticalEdge ? pContext.Height : pContext.Width;
        var crossLimit = verticalEdge ? pContext.Width : pContext.Height;
        var startT = 0;
        var endT = length - 1;
        var grammarBeachOceanAnchorAtStart = false;
        if(grammarBeachOcean) {
            var targetLength = Math.round(length * (0.20 +
                ((MapGen.Random.HashTile(pContext.Seed, side + 83, length, 791) % 7) / 100)));
            targetLength = Math.max(10, Math.min(18, Math.min(length, targetLength)));

            // The sub-1 atlas only contains one-direction beach turns. A
            // floating edge inlet must taper in and then out, which forces a
            // reversal and produces impossible tile combinations.  Shipped
            // mapm8 uses a compact bottom-right cove: a short monotonic water
            // wedge attached to the corner, not a coast covering half the map
            // edge.  Keep that atlas-supported orientation and scale its span
            // only modestly on large maps.
            startT = length - targetLength;
            endT = length - 1;
        }
        var phase = (MapGen.Random.HashTile(pContext.Seed, 59, 67, 739) % 6283) / 1000;
        var baseDepthRoll = MapGen.Random.HashTile(pContext.Seed, 61, 71, 743) % 2;
        var baseDepth = crossLimit >= 64 ?
            Math.max(9, Math.min(11, Math.round(crossLimit * 0.145) + baseDepthRoll)) :
            (!verticalEdge && length >= 64 ?
                Math.max(6, Math.min(8, Math.round(crossLimit * 0.12) + baseDepthRoll)) :
                Math.max(5, Math.min(7, Math.round(crossLimit * 0.095) + baseDepthRoll)));
        var depths = [];
        var controlPoints = [];
        var depthMin = 3;
        var depthMax = Math.max(depthMin + 4, Math.min(crossLimit - 5, baseDepth + 7));
        var controlT = startT;
        var controlIndex = 0;
        var controlDirection = (MapGen.Random.HashTile(pContext.Seed, 67, 73, 747) % 2) ? 1 : -1;
        var tIndex;

        function smoothStep(pValue) {
            return pValue * pValue * (3 - (2 * pValue));
        }

        function grammarBeachOceanEndDistance(pT) {
            return grammarBeachOceanAnchorAtStart ? endT - pT : pT - startT;
        }

        function grammarBeachOceanDepthFloor(pT) {
            var endDistance = grammarBeachOceanEndDistance(pT);

            if(endDistance <= 0)
                return 1;
            if(endDistance < 6)
                return Math.max(1, Math.min(depthMax, endDistance + 1));

            return Math.max(depthMin + 2, Math.min(depthMax, baseDepth - 1));
        }

        function grammarBeachOceanDepthLimit(pT) {
            var endDistance = grammarBeachOceanEndDistance(pT);

            if(endDistance < 6)
                return Math.max(grammarBeachOceanDepthFloor(pT), Math.min(depthMax, endDistance + 5));

            return depthMax;
        }

        function clampDepth(pDepth, pT) {
            if(grammarBeachOcean)
                return Math.max(
                    grammarBeachOceanDepthFloor(pT),
                    Math.min(grammarBeachOceanDepthLimit(pT), pDepth)
                );

            var taper = Math.min(pT - startT, endT - pT);
            var taperMax = Math.max(depthMin, Math.min(depthMax, taper + 5));
            return Math.max(depthMin, Math.min(taperMax, pDepth));
        }

        function shapeGrammarBeachOceanDepths(pDepths) {
            if(!grammarBeachOcean)
                return pDepths;

            var shaped = new Array(pDepths.length);
            var depthByDistance = [];
            var currentDepth = 1;
            var runRemaining = 2 +
                (MapGen.Random.HashTile(pContext.Seed, side + 5, pDepths.length, 769) & 1);
            var depthCap = Math.min(depthMax, baseDepth + 2);

            // Build from the free tip toward the attached map corner. Runs are
            // two or three cells long and every turn moves in the same
            // direction, matching the finite directional vocabulary.
            for(var distance = 0; distance < pDepths.length; ++distance) {
                depthByDistance[distance] = currentDepth;
                --runRemaining;
                if(runRemaining <= 0 && currentDepth < depthCap) {
                    ++currentDepth;
                    runRemaining = 2 +
                        (MapGen.Random.HashTile(pContext.Seed, distance + 7, side + 11, 771) & 1);
                }
            }

            for(var depthIndex = 0; depthIndex < shaped.length; ++depthIndex) {
                var tipDistance = grammarBeachOceanAnchorAtStart ?
                    shaped.length - 1 - depthIndex : depthIndex;
                shaped[depthIndex] = depthByDistance[tipDistance];
            }

            return shaped;
        }

        while(controlT <= endT) {
            var segmentLength = 5 + (MapGen.Random.HashTile(pContext.Seed, controlT + 1, controlIndex + 3, 751) % 14);
            var amplitude = 2 + (MapGen.Random.HashTile(pContext.Seed, controlT + 5, controlIndex + 7, 753) % 6);
            var offset = (MapGen.Random.HashTile(pContext.Seed, controlT + 11, controlIndex + 13, 757) % 3) - 1;
            var targetDepth = baseDepth + (controlDirection * amplitude) + offset;

            if((MapGen.Random.HashTile(pContext.Seed, controlT + 17, controlIndex + 19, 761) % 100) < 22)
                targetDepth += controlDirection * 2;

            controlPoints.push({
                t: Math.min(endT, controlT),
                depth: clampDepth(targetDepth, controlT),
                length: segmentLength
            });

            if((MapGen.Random.HashTile(pContext.Seed, controlT + 23, controlIndex + 29, 763) % 100) >= 18)
                controlDirection = -controlDirection;

            controlT += segmentLength;
            ++controlIndex;
        }

        if(controlPoints.length === 0 || controlPoints[controlPoints.length - 1].t < endT) {
            controlPoints.push({
                t: endT,
                depth: clampDepth(baseDepth - controlDirection * 2, endT),
                length: 0
            });
        }

        var controlCursor = 0;
        for(var t = startT; t <= endT; ++t) {
            while(controlCursor < controlPoints.length - 2 && controlPoints[controlCursor + 1].t < t)
                ++controlCursor;

            var leftControl = controlPoints[controlCursor];
            var rightControl = controlPoints[Math.min(controlCursor + 1, controlPoints.length - 1)];
            var span = Math.max(1, rightControl.t - leftControl.t);
            var blend = smoothStep((t - leftControl.t) / span);
            var localWobble =
                (Math.sin((t * 0.47) + phase) * 0.75) +
                (Math.sin((t * 0.23) + (phase * 1.7)) * 0.55);
            var noise = MapGen.Random.HashTile(pContext.Seed, t + 31, side + 37, 767) % 100;
            var depth = leftControl.depth + ((rightControl.depth - leftControl.depth) * blend);

            if(noise < 9)
                localWobble -= 1.0;
            else if(noise > 90)
                localWobble += 1.0;

            depths.push(clampDepth(Math.round(depth + localWobble), t));
        }

        for(var smoothPass = 0; smoothPass < (grammarBeachOcean ? 0 : 1); ++smoothPass) {
            var smoothedDepths = depths.slice(0);
            for(tIndex = 1; tIndex < depths.length - 1; ++tIndex)
                smoothedDepths[tIndex] = clampDepth(
                    Math.round((depths[tIndex - 1] + (depths[tIndex] * 3) + depths[tIndex + 1]) / 5),
                    startT + tIndex
                );
            depths = smoothedDepths;
        }

        var maxDepthStep = 2;
        for(tIndex = 1; tIndex < depths.length; ++tIndex) {
            if(depths[tIndex] > depths[tIndex - 1] + maxDepthStep)
                depths[tIndex] = depths[tIndex - 1] + maxDepthStep;
            else if(depths[tIndex] < depths[tIndex - 1] - maxDepthStep)
                depths[tIndex] = depths[tIndex - 1] - maxDepthStep;
            depths[tIndex] = clampDepth(depths[tIndex], startT + tIndex);
        }
        for(tIndex = depths.length - 2; tIndex >= 0; --tIndex) {
            if(depths[tIndex] > depths[tIndex + 1] + maxDepthStep)
                depths[tIndex] = depths[tIndex + 1] + maxDepthStep;
            else if(depths[tIndex] < depths[tIndex + 1] - maxDepthStep)
                depths[tIndex] = depths[tIndex + 1] - maxDepthStep;
            depths[tIndex] = clampDepth(depths[tIndex], startT + tIndex);
        }

        if(grammarBeachOcean) {
            depths = shapeGrammarBeachOceanDepths(depths);
            this.ClampGrammarBeachOceanDepthForProtectedCells(
                pContext,
                depths,
                verticalEdge,
                positiveEdge,
                crossLimit,
                depthMin,
                startT
            );
        }

        var minDepthUsed = 9999;
        var maxDepthUsed = 0;
        var depthChanges = 0;
        for(tIndex = 0; tIndex < depths.length; ++tIndex) {
            minDepthUsed = Math.min(minDepthUsed, depths[tIndex]);
            maxDepthUsed = Math.max(maxDepthUsed, depths[tIndex]);
            if(tIndex > 0 && depths[tIndex] !== depths[tIndex - 1])
                ++depthChanges;
        }

        for(t = startT; t <= endT; ++t) {
            var stampDepthMin = grammarBeachOcean ? 1 : depthMin;
            var depth = Math.max(stampDepthMin, Math.min(depthMax, depths[t - startT]));

            var landCross = positiveEdge ? crossLimit - depth - 1 : depth;
            for(var d = 0; d < depth; ++d) {
                var cross = positiveEdge ? crossLimit - 1 - d : d;
                var x = verticalEdge ? cross : t;
                var y = verticalEdge ? t : cross;

                if(this.IsLiveWaterProtectedCell(pContext, x, y, pProtectedPoints, 1))
                    continue;
                this.SetLiveWaterCell(pContext, x, y, waterPoints, waterSeen);
            }

            var candidate = verticalEdge ?
                { x: landCross, y: t, normal: { x: positiveEdge ? -1 : 1, y: 0 }, t: t, depth: depth } :
                { x: t, y: landCross, normal: { x: 0, y: positiveEdge ? -1 : 1 }, t: t, depth: depth };
            if(MapGen.Layers.InBounds(pContext.Layers.coast, candidate.x, candidate.y))
                beachCandidates.push(candidate);
        }

        var shorePoints = this.BuildBeachShorePoints(pContext, waterPoints);
        var river = {
            role: grammarBeachOcean ? "grammar_beach_ocean" : "grammar_beach_edge_inlet",
            requiresCrossing: false,
            points: shorePoints,
            center: shorePoints.length ? shorePoints[Math.floor(shorePoints.length * 0.5)] : { x: 1, y: 1 },
            segment: { start: startT, end: endT }
        };

        pContext.Rivers.push(river);
        return {
            river: river,
            waterPoints: waterPoints,
            shorePoints: shorePoints,
            beachCandidates: beachCandidates,
            vertical: verticalEdge,
            side: positiveEdge ? 1 : -1,
            inward: verticalEdge ?
                { x: positiveEdge ? -1 : 1, y: 0 } :
                { x: 0, y: positiveEdge ? -1 : 1 },
            localizedSegment: grammarBeachOcean,
            blob: false,
            ocean: grammarBeachOcean,
            edgeInlet: true,
            edgeSide: side,
            edgeSideName: this.BeachEdgeSideName(side),
            edgeAnchorAtStart: grammarBeachOceanAnchorAtStart,
            edgeBaseDepth: baseDepth,
            edgeDepthMin: minDepthUsed,
            edgeDepthMax: maxDepthUsed,
            edgeDepthChanges: depthChanges,
            edgeControlCount: controlPoints.length,
            segment: { start: startT, end: endT }
        };
    },

    RegionalBeachCoastDimensions: function(c) {
        var form = [0, 0, 1, 2][this.GrammarBeachVariantHash(c, 3697, false) % 4];
        var roll = this.GrammarBeachVariantHash(c, 3691, false) % 4;
        return {form: form,
            depth: form === 1 ? 0.18 + roll * 0.05 : form === 2 ? 0.32 + roll * 0.05 : 0.14 + roll * 0.07,
            entry: form === 1 ? 0.02 + roll * 0.02 : form === 2 ? 0.06 + roll * 0.02 : 0,
            curve: 0.7 + (this.GrammarBeachVariantHash(c, 3701, false) % 1000) / 1000};
    },

    RegionalBeachDepthFraction: function(dimensions, progress) {
        return dimensions.entry + (dimensions.depth - dimensions.entry) *
            Math.pow(Math.max(0, Math.min(1, progress)), dimensions.curve);
    },

    BuildComposableGrammarBeachCoast: function(pContext, pFamily) {
        var vertical = pFamily === "mapm5_top_bank";
        var axisLength = vertical ? pContext.Height : pContext.Width;
        var crossLimit = vertical ? pContext.Width : pContext.Height;
        var layoutVariant = this.GrammarBeachLayoutVariant(pContext);
        var lengthVariant = this.GrammarBeachLengthVariant(pContext);
        var courseVariant = this.GrammarBeachCourseVariant(pContext);
        var regional = pContext.RegionalPlan;
        var dimensions = regional ? this.RegionalBeachCoastDimensions(pContext) : null;
        var coastForm = dimensions ? dimensions.form : 0;
        var spanFractions = [0.42, 0.50, 0.58, 0.66, 0.74, 0.84];
        var span = Math.round(axisLength * spanFractions[lengthVariant]);
        var spanProfile = 0, shelfProfile = 0, widthProfile = 0;
        if(regional) {
            // Keep the original edge families and monotone contour, while
            // varying regional shelf extent independently of route topology.
            spanProfile = this.GrammarBeachVariantHash(pContext, 3683, false) % 3;
            shelfProfile = this.GrammarBeachVariantHash(pContext, 3685, false) % 3;
            widthProfile = this.GrammarBeachVariantHash(pContext, 3687, false) % 3;
            span += Math.round(axisLength * (spanProfile - 1) * 0.07);
        }
        span = Math.max(12, Math.min(axisLength, span));

        // A sub1 beach can enter through the top/right or bottom/right map
        // boundary, but it cannot close again in the middle: the atlas has no
        // opposite-facing cap. Let the legal contour begin at different points
        // and run to the far boundary instead of stamping a complete source-map
        // footprint.
        var start = Math.max(0, axisLength - span);
        if((layoutVariant === 0 || layoutVariant === 3) && span < axisLength)
            start = Math.max(0, start - Math.round(axisLength * 0.10));
        // A full-edge coast may enter the map already deep. Starting every
        // contour at one water tile forced all beaches into corner wedges.
        // Both forms still use only east/south-facing, monotone atlas joins.
        if(coastForm !== 0) start = 0;
        span = axisLength - start;

        var waterPoints = [];
        var waterSeen = {};
        var beachCells = [];
        var beachSeen = {};
        var depths = [];
        var widths = [];
        var waterDepth = 1;
        var beachWidth = 3 + (layoutVariant % 3);
        if(regional && widthProfile === 1) ++beachWidth;
        if(regional && widthProfile === 2) --beachWidth;
        var minimumBeachWidth = regional ? 4 : 3;
        beachWidth = Math.max(minimumBeachWidth, Math.min(7, beachWidth));
        var runStyle = courseVariant % 3;

        function nextRunLength(pAxis, pChange) {
            var roll = MapGen.Random.HashTile(
                pContext.Seed,
                pAxis,
                courseVariant + pChange,
                3673
            );
            // mapm8's south coast advances through broad two- to five-cell
            // shelves. One-cell shelves are legal at isolated corners, but a
            // long run of them makes every water turn expose the same tiny
            // diagonal tile phrase and produces a zipper-like shoreline.
            // Keep the steeper cadence for the mapm5-style east coast, whose
            // source contour genuinely changes almost every row.
            if(vertical) {
                var verticalRun;
                if(runStyle === 0)
                    verticalRun = 1 + (roll % 2);
                else if(runStyle === 1)
                    verticalRun = 1 + (roll % 3);
                else
                    verticalRun = 2 + (roll % 2);
                if(regional && shelfProfile === 0) ++verticalRun;
                if(regional && shelfProfile === 1 && (pChange % 2) === 0)
                    verticalRun = Math.max(1, verticalRun - 1);
                return verticalRun;
            }
            var horizontalRun;
            if(runStyle === 0)
                horizontalRun = 2 + (roll % 3);
            else if(runStyle === 1)
                horizontalRun = 2 + (roll % 4);
            else
                horizontalRun = 3 + (roll % 3);
            if(regional && shelfProfile === 0) ++horizontalRun;
            if(regional && shelfProfile === 1 && (pChange % 2) === 0)
                horizontalRun = Math.max(1, horizontalRun - 1);
            return horizontalRun;
        }

        var runRemaining = nextRunLength(
            start + 17,
            0
        );
        var widthRemaining = 4 + (MapGen.Random.HashTile(
            pContext.Seed,
            start + 29,
            layoutVariant + 31,
            3671
        ) % 5);
        var depthChanges = 0;
        var widthChanges = 0;
        var maximumWaterDepth = Math.max(5, crossLimit - 8);
        if(regional) {
            // Choose coast extent independently from route topology. A deep
            // bay and a long shallow shore must not imply the same route.
            maximumWaterDepth = Math.max(5, Math.round(crossLimit * dimensions.depth));
            if(coastForm !== 0) {
                waterDepth = Math.max(2, Math.round(crossLimit * dimensions.entry));
                maximumWaterDepth = Math.max(waterDepth, maximumWaterDepth);
            }
            regional.coast = {family: pFamily, depth: maximumWaterDepth, span: span,
                form: ["corner", "shelf", "deep"][coastForm],
                spanProfile: spanProfile, shelfProfile: shelfProfile,
                widthProfile: widthProfile};
        }

        for(var offset = 0; offset < span; ++offset) {
            if(offset > 0) {
                --runRemaining;
                if(coastForm === 0 && runRemaining <= 0 && waterDepth < maximumWaterDepth) {
                    ++waterDepth;
                    ++depthChanges;
                    runRemaining = nextRunLength(
                        start + offset,
                        depthChanges
                    );
                    if(regional) {
                        // Alternate broad shelves with steeper sections using
                        // only the monotone one-tile joins the sand atlas has.
                        var section = Math.floor(offset * 3 / span);
                        if(shelfProfile === 0 && section === 0)
                            runRemaining += 4;
                        else if(shelfProfile === 1 && section === 2)
                            runRemaining += 3;
                        else if(shelfProfile === 2 &&
                            (section + courseVariant) % 2 === 0)
                            runRemaining += 2;
                    }
                }

                --widthRemaining;
                if(widthRemaining <= 0) {
                    var widthRoll = MapGen.Random.HashTile(
                        pContext.Seed,
                        start + offset,
                        layoutVariant + widthChanges,
                        3677
                    ) % 5;
                    var nextWidth = beachWidth;
                    if(widthRoll < 2)
                        --nextWidth;
                    else if(widthRoll > 2)
                        ++nextWidth;
                    nextWidth = Math.max(minimumBeachWidth, Math.min(7, nextWidth));
                    if(nextWidth !== beachWidth) {
                        beachWidth = nextWidth;
                        ++widthChanges;
                    }
                    widthRemaining = 4 + (MapGen.Random.HashTile(
                        pContext.Seed,
                        start + offset + 7,
                        widthChanges + 11,
                        3679
                    ) % 6);
                }
            }

            if(coastForm !== 0)
                waterDepth = Math.min(offset ? depths[offset - 1] + 1 : maximumWaterDepth,
                    Math.max(1, Math.round(crossLimit * this.RegionalBeachDepthFraction(
                        dimensions, offset / Math.max(1, span - 1)))));
            depths.push(waterDepth);
            widths.push(beachWidth);
        }
        // Fit the coast around planned anchors before painting it. Clearing a
        // single submerged spawn afterwards leaves it stranded in the ocean.
        // A monotone prefix cap retains the atlas's one-direction shoreline;
        // the forward clamp keeps every remaining depth change to one tile.
        var protectedPoints = this.ProtectedLiveTerrainPoints(pContext);
        for(var pi = 0; pi < protectedPoints.length; ++pi) {
            var protectedPoint = protectedPoints[pi];
            var protectedAxis = vertical ? protectedPoint.y : protectedPoint.x;
            var protectedCross = vertical ? protectedPoint.x : protectedPoint.y;
            var lastOffset = Math.min(span - 1, Math.floor(protectedAxis - start + 4));
            var depthLimit = Math.max(1, crossLimit - Math.ceil(protectedCross) - 5);
            for(var oi = 0; oi <= lastOffset; ++oi)
                depths[oi] = Math.min(depths[oi], depthLimit);
        }
        depthChanges = 0;
        var runLengths = [];
        var currentRun = 1;
        for(var oi = 1; oi < depths.length; ++oi) {
            depths[oi] = Math.min(depths[oi], depths[oi - 1] + 1);
            if(depths[oi] !== depths[oi - 1]) {
                ++depthChanges;
                runLengths.push(currentRun);
                currentRun = 0;
            }
            ++currentRun;
        }
        runLengths.push(currentRun);
        if(regional) {
            regional.coast.start = start;
            regional.coast.entryDepth = depths[0];
            regional.coast.finalDepth = depths[depths.length - 1];
        }

        function stampWater(self, axis, cross) {
            var x = vertical ? cross : axis;
            var y = vertical ? axis : cross;
            self.SetLiveWaterCell(pContext, x, y, waterPoints, waterSeen);
        }

        function stampBeach(self, axis, cross) {
            var x = vertical ? cross : axis;
            var y = vertical ? axis : cross;
            self.SetLiveBeachCell(pContext, x, y, beachCells, beachSeen);
        }

        // South-facing contours need a short sand lead-in so their first
        // water-facing cell joins sand on its west side (SSWS), rather than
        // demanding the absent grass-to-water south cap (SSWG).
        if(!vertical) {
            var lead = Math.min(start, 2 + (layoutVariant % 4));
            for(var leadOffset = lead; leadOffset > 0; --leadOffset) {
                var leadAxis = start - leadOffset;
                var leadWidth = Math.max(2, widths[0] - Math.floor((leadOffset - 1) / 2));
                for(var leadBand = 0; leadBand < leadWidth; ++leadBand)
                    stampBeach(this, leadAxis, crossLimit - 1 - leadBand);
            }
        }

        for(offset = 0; offset < span; ++offset) {
            var axis = start + offset;
            var depth = depths[offset];
            var waterStart = crossLimit - depth;

            for(var cross = waterStart; cross < crossLimit; ++cross)
                stampWater(this, axis, cross);
            for(var band = 1; band <= widths[offset]; ++band)
                stampBeach(this, axis, waterStart - band);
        }

        var shorePoints = this.BuildBeachShorePoints(pContext, waterPoints);
        var edgeSide = vertical ? 1 : 2;
        var templateName = vertical ? "joined_east_coast" : "joined_south_coast";
        var river = {
            role: "grammar_beach_" + templateName,
            requiresCrossing: false,
            points: shorePoints,
            center: shorePoints.length ? shorePoints[Math.floor(shorePoints.length * 0.5)] :
                (vertical ? { x: pContext.Width - 2, y: start } : { x: start, y: pContext.Height - 2 }),
            segment: { start: start, end: axisLength - 1 }
        };

        pContext.Rivers.push(river);
        return {
            river: river,
            waterPoints: waterPoints,
            shorePoints: shorePoints,
            authoredBeachCells: beachCells,
            authoredBeachTemplate: templateName,
            templateOrigin: vertical ? { x: 0, y: start } : { x: start, y: 0 },
            vertical: vertical,
            side: 1,
            inward: vertical ? { x: -1, y: 0 } : { x: 0, y: -1 },
            localizedSegment: true,
            blob: false,
            ocean: true,
            edgeInlet: true,
            edgeSide: edgeSide,
            edgeSideName: vertical ? "right" : "bottom",
            edgeAnchorAtStart: false,
            edgeBaseDepth: depths[Math.floor(depths.length * 0.5)],
            edgeDepthMin: depths[0],
            edgeDepthMax: depths[depths.length - 1],
            edgeDepthChanges: depthChanges,
            edgeControlCount: runLengths.length,
            placementVariant: layoutVariant,
            lengthVariant: lengthVariant,
            courseVariant: courseVariant,
            composedDepths: depths,
            composedWidths: widths,
            composedRuns: runLengths,
            segment: { start: start, end: axisLength - 1 }
        };
    },

    BuildBeachEdgeWater: function(pContext, pProtectedPoints, pArchetype) {
        if(pContext && pContext.Profile &&
            pContext.Profile.TargetPackProfile === "grammar_beach") {
            var family = this.GrammarBeachFamily(pContext);
            if(family === "mapm6_bridge_channel")
                return this.BuildMapm6BridgeChannel(pContext);
            return this.BuildComposableGrammarBeachCoast(pContext, family);
        }

        return this.BuildEdgeBeachInlet(pContext, pProtectedPoints);
    },

    // mapm6 is the third scoped jun_sub1 original. Its defining composition is
    // a broad edge-to-edge channel separating two land masses, crossed by long
    // vertical bridges. This uses the exact sub1 bridge recipe already mined
    // from mapm6 while varying the channel course and crossing count.
    FitMapm6ChannelRows: function(pContext, pTop, pBottom) {
        // Reserve dry spawn/objective approaches before painting water. A late
        // square clearing otherwise cuts a tiny peninsula into the channel.
        var points = this.ProtectedLiveTerrainPoints(pContext);
        for(var i = 0; i < points.length; ++i) {
            var point = points[i], px = Math.round(point.x);
            if(px < 0 || px >= pTop.length)
                continue;
            var below = point.y > (pTop[px] + pBottom[px]) / 2;
            for(var x = 0; x < pTop.length; ++x) {
                var taper = Math.floor(Math.max(0, Math.abs(x - px) - 4) / 3);
                var shift = below ? Math.min(0, point.y - 5 + taper - pBottom[x]) :
                    Math.max(0, point.y + 5 - taper - pTop[x]);
                shift = Math.max(4 - pTop[x], Math.min(pContext.Height - 5 - pBottom[x], shift));
                pTop[x] += shift;
                pBottom[x] += shift;
            }
        }
        // Independent depth/course schedules can reverse within one cell.
        // Such a notch has two corner stamps fighting over the same tile.
        var rows = [pTop, pBottom];
        for(var r = 0; r < rows.length; ++r) {
            var a = rows[r];
            for(var step = 1; step < a.length; ++step)
                a[step] = Math.max(a[step - 1] - 1, Math.min(a[step - 1] + 1, a[step]));
            for(var j = 1; j < a.length - 1; ++j)
                if(a[j - 1] === a[j + 1])
                    a[j] = a[j - 1];
        }
    },

    FitMapm6ChannelHeight: function(pContext, pHeight) {
        var profile = pContext.Profile;
        var coverage = MapGen.Terrain.TileCatalog.MaxWaterCoverage(
            profile.TerrainType, profile.MaxWaterCoverage);
        if(!isFinite(coverage) || coverage <= 0) return pHeight;
        // The channel spans the whole width. Reserve one row for its depth
        // variation, retaining the five-row minimum required by the atlas.
        return Math.min(pHeight, Math.max(5, Math.floor(pContext.Height * coverage) - 1));
    },

    BuildMapm6BridgeChannel: function(pContext) {
        var waterPoints = [];
        var waterSeen = {};
        var courseVariant = this.GrammarBeachCourseVariant(pContext);
        var channelHeights = [5, 7, 9, 6, 8, 10, 5, 11, 6, 9, 7, 10];
        var heightJitter = (MapGen.Random.HashTile(pContext.Seed, 127, 131, 3571) % 3) - 1;
        var channelHeight = Math.max(5, Math.min(
            11,
            channelHeights[courseVariant] + heightJitter
        ));
        channelHeight = this.FitMapm6ChannelHeight(pContext, channelHeight);
        var centerRoll = (MapGen.Random.HashTile(pContext.Seed, 137, 139, 3577) % 13) - 6;
        var layoutVariant = this.GrammarBeachLayoutVariant(pContext);
        var centerFractions = [0.24, 0.34, 0.44, 0.56, 0.66, 0.76];
        var centerY = Math.round(
            (pContext.Height * centerFractions[layoutVariant]) + (centerRoll * 0.25)
        );
        var top = Math.max(8, Math.min(
            pContext.Height - channelHeight - 9,
            centerY - Math.floor(channelHeight * 0.5)
        ));
        var bottom = top + channelHeight - 1;
        var topByX = [];
        var bottomByX = [];
        var courseOffset = 0;
        var courseLimit = pContext.Width >= 56 ? 2 : 1;
        var nextCourseChange = 8 + (
            MapGen.Random.HashTile(pContext.Seed, 149, 151, 3579) % 8
        );
        var courseChanges = 0;
        var depthOffset = 0;
        var nextDepthChange = 14 + (
            MapGen.Random.HashTile(pContext.Seed, 153, 157, 3585) % 10
        );
        var depthChanges = 0;
        var minimumChannelHeight = channelHeight;
        var maximumChannelHeight = channelHeight;
        var x;
        for(x = 0; x < pContext.Width; ++x) {
            // mapm6's channel is broad, but its banks are not ruler-straight.
            // Move the channel centre by one row in long shelves, allowing
            // wider maps to wander up to two rows from the baseline. Depth has
            // a separate, slower shelf schedule below. A single transition
            // cell remains within the sub1 directional vocabulary.
            if(x === nextCourseChange && x < pContext.Width - 8) {
                var courseRoll = MapGen.Random.HashTile(
                    pContext.Seed,
                    x,
                    courseChanges,
                    3581
                ) % 5;
                var courseDirection = courseRoll < 2 ? -1 : 1;
                if(courseOffset <= -courseLimit)
                    courseDirection = 1;
                else if(courseOffset >= courseLimit)
                    courseDirection = -1;
                else if(courseRoll === 2 && courseOffset !== 0)
                    courseDirection = courseOffset > 0 ? -1 : 1;
                courseOffset += courseDirection;
                ++courseChanges;
                nextCourseChange += 9 + (
                    MapGen.Random.HashTile(pContext.Seed, x, courseChanges, 3583) % 9
                );
            }

            if(x === nextDepthChange && x < pContext.Width - 8) {
                var depthRoll = MapGen.Random.HashTile(
                    pContext.Seed,
                    x,
                    depthChanges,
                    3589
                ) % 3;
                var nextDepthOffset = depthRoll - 1;
                if(channelHeight + nextDepthOffset < 5)
                    nextDepthOffset = depthRoll & 1;
                if(nextDepthOffset === depthOffset)
                    nextDepthOffset = depthOffset === 0 ? 1 : 0;
                depthOffset = nextDepthOffset;
                ++depthChanges;
                nextDepthChange += 14 + (
                    MapGen.Random.HashTile(pContext.Seed, x, depthChanges, 3591) % 11
                );
            }

            topByX[x] = top + courseOffset;
            bottomByX[x] = bottom + courseOffset + depthOffset;
            minimumChannelHeight = Math.min(
                minimumChannelHeight,
                bottomByX[x] - topByX[x] + 1
            );
            maximumChannelHeight = Math.max(
                maximumChannelHeight,
                bottomByX[x] - topByX[x] + 1
            );
        }

        this.FitMapm6ChannelRows(pContext, topByX, bottomByX);
        minimumChannelHeight = Infinity;
        maximumChannelHeight = 0;
        for(x = 0; x < pContext.Width; ++x) {
            var localTop = topByX[x];
            var localBottom = bottomByX[x];
            minimumChannelHeight = Math.min(minimumChannelHeight, localBottom - localTop + 1);
            maximumChannelHeight = Math.max(maximumChannelHeight, localBottom - localTop + 1);

            for(var y = localTop; y <= localBottom; ++y)
                this.SetLiveWaterCell(pContext, x, y, waterPoints, waterSeen);
        }

        var shorePoints = this.BuildBeachShorePoints(pContext, waterPoints);
        var river = {
            role: "grammar_beach_mapm6_bridge_channel",
            points: shorePoints,
            center: {
                x: Math.floor(pContext.Width * 0.5),
                y: Math.floor((top + bottom) * 0.5)
            },
            segment: { start: 0, end: pContext.Width - 1 }
        };
        // The first crossing must intersect the already-planned campaign
        // corridor. Fixed bridge fractions look plausible, but can leave the
        // objective on the opposite bank from every legal route; validation
        // then rejects mapm6 and retries into one of the other beach families.
        var routePoints = pContext.RouteCorridor ? pContext.RouteCorridor.points || [] : [];
        var primaryBridgeX = -1;
        var primaryScore = Infinity;

        for(var routeIndex = 0; routeIndex < routePoints.length; ++routeIndex) {
            var routePoint = routePoints[routeIndex];
            var routeX = Math.round(routePoint.x);
            var routeY = Math.round(routePoint.y);
            if(routeX < 4 || routeX >= pContext.Width - 6)
                continue;
            if(routeY < topByX[routeX] - 1 || routeY > bottomByX[routeX] + 1)
                continue;

            var routeFraction = routePoints.length > 1 ?
                routeIndex / (routePoints.length - 1) : 0.5;
            var score = Math.abs(routeFraction - 0.5) * pContext.Width;
            if(score < primaryScore) {
                primaryScore = score;
                primaryBridgeX = routeX;
            }
        }

        if(primaryBridgeX < 0)
            primaryBridgeX = Math.round((pContext.Width - 1) * 0.28);

        var bridgeTargets = [1, 2, 2, 1, 2, 2, 1, 2, 1, 2, 1, 2];
        var bridgeTarget = bridgeTargets[courseVariant];
        var bridgeXs = [primaryBridgeX];
        if(bridgeTarget > 1) {
            var secondaryFraction = primaryBridgeX < pContext.Width * 0.5 ? 0.72 : 0.28;
            var secondaryX = Math.round((pContext.Width - 1) * secondaryFraction);
            var secondaryJitter = (MapGen.Random.HashTile(
                pContext.Seed,
                164,
                secondaryX,
                3587
            ) % 7) - 3;
            secondaryX = Math.max(4, Math.min(pContext.Width - 6, secondaryX + secondaryJitter));
            if(Math.abs(secondaryX - primaryBridgeX) < 12)
                secondaryX = primaryBridgeX < pContext.Width * 0.5 ?
                    Math.min(pContext.Width - 6, primaryBridgeX + 14) :
                    Math.max(4, primaryBridgeX - 14);
            bridgeXs.push(secondaryX);
        }

        for(var bridgeIndex = 0; bridgeIndex < bridgeXs.length; ++bridgeIndex) {
            var bridgeX = bridgeXs[bridgeIndex];
            var closestShelf = Infinity;
            // Fit the bridge and both water flanks on the same shelf. Fitting
            // only its two deck columns makes Bridges extend water sideways
            // through a sloped bank after the shoreline plan is finalized.
            for(var shelfX = 4; shelfX < pContext.Width - 5; ++shelfX) {
                var flat = true;
                for(var side = -1; side <= 2; ++side)
                    flat = flat && topByX[shelfX + side] === topByX[shelfX] &&
                        bottomByX[shelfX + side] === bottomByX[shelfX];
                for(var previous = 0; previous < bridgeIndex; ++previous)
                    flat = flat && Math.abs(shelfX - bridgeXs[previous]) >= 6;
                var distance = Math.abs(shelfX - bridgeXs[bridgeIndex]);
                if(flat && distance < closestShelf) {
                    closestShelf = distance;
                    bridgeX = shelfX;
                }
            }
            bridgeXs[bridgeIndex] = bridgeX;
            var bridgeTop = Math.min(topByX[bridgeX], topByX[bridgeX + 1]);
            var bridgeBottom = Math.max(bottomByX[bridgeX], bottomByX[bridgeX + 1]);

            var crossing = {
                x: bridgeX,
                y: Math.floor((bridgeTop + bridgeBottom) * 0.5),
                radius: Math.ceil((bridgeBottom - bridgeTop + 1) * 0.5) + 2,
                length: Math.ceil((bridgeBottom - bridgeTop + 1) * 0.5) + 3,
                halfWidth: 1,
                axis: "vertical",
                role: "grammar_beach_mapm6_bridge",
                surface: "ford"
            };
            pContext.Crossings.push(crossing);

            // Layout's generic Water.Build pass runs before TerrainIntent
            // replaces the beach terrain, so crossings created here would
            // otherwise be invisible to Connectivity. Stamp the provisional
            // walkable strip now; Bridges.Build will replace it with the exact
            // sub1 bridge footprint later in the pipeline.
            if(MapGen.Terrain && MapGen.Terrain.Water &&
                MapGen.Terrain.Water.StampCrossing)
                MapGen.Terrain.Water.StampCrossing(pContext, crossing);
        }

        pContext.Rivers.push(river);
        return {
            river: river,
            waterPoints: waterPoints,
            shorePoints: shorePoints,
            authoredBeachCells: [],
            authoredBeachTemplate: "mapm6_bridge_channel",
            templateOrigin: { x: 0, y: top },
            vertical: false,
            side: 0,
            inward: { x: 0, y: 0 },
            localizedSegment: false,
            blob: false,
            ocean: false,
            edgeInlet: false,
            edgeSide: -1,
            edgeSideName: "interior",
            edgeAnchorAtStart: false,
            edgeBaseDepth: channelHeight,
            edgeDepthMin: minimumChannelHeight,
            edgeDepthMax: maximumChannelHeight,
            edgeDepthChanges: courseChanges + depthChanges,
            edgeControlCount: courseChanges + depthChanges + 1,
            bridgeXs: bridgeXs,
            channelTop: top,
            channelBottom: bottom,
            channelTopByX: topByX,
            channelBottomByX: bottomByX,
            courseVariant: courseVariant,
            placementVariant: layoutVariant,
            lengthVariant: channelHeight - 5,
            segment: { start: 0, end: pContext.Width - 1 }
        };
    },


    ShouldBuildAuthoredBeachPondPocket: function(pContext) {
        return !!(pContext &&
            pContext.Profile &&
            pContext.Profile.AllowBeachPondPocket === true);
    },

    BuildAuthoredBeachPondPocket: function(pContext, pProtectedPoints) {
        if(!this.ShouldBuildAuthoredBeachPondPocket(pContext))
            return null;

        var waterPoints = [];
        var waterSeen = {};
        var layers = pContext.Layers;
        var center = null;
        var rx = 0;
        var ry = 0;

        for(var attempt = 0; attempt < 80 && !center; ++attempt) {
            rx = 3 + (MapGen.Random.HashTile(pContext.Seed, attempt, 3, 845) % 3);
            ry = 2 + (MapGen.Random.HashTile(pContext.Seed, attempt, 7, 847) % 3);

            var minX = rx + 7;
            var maxX = Math.max(minX, pContext.Width - rx - 12);
            var minY = ry + 6;
            var maxY = Math.max(minY, pContext.Height - ry - 7);
            var xRange = Math.max(1, maxX - minX + 1);
            var yRange = Math.max(1, maxY - minY + 1);
            var candidate = {
                x: minX + (MapGen.Random.HashTile(pContext.Seed, attempt, 11, 851) % xRange),
                y: minY + (MapGen.Random.HashTile(pContext.Seed, attempt, 13, 853) % yRange)
            };

            if(this.PointNearList(candidate, pProtectedPoints, 9))
                continue;
            if(this.HasLiveTerrainLayerNear(layers.water, candidate.x, candidate.y, Math.max(rx, ry) + 7))
                continue;
            if(this.HasLiveTerrainLayerNear(layers.coast, candidate.x, candidate.y, Math.max(rx, ry) + 5))
                continue;
            if(MapGen.Layers.Get(layers.path, candidate.x, candidate.y, 0) ||
                MapGen.Layers.Get(layers.keepClear, candidate.x, candidate.y, 0) ||
                MapGen.Layers.Get(layers.occupied, candidate.x, candidate.y, 0) ||
                MapGen.Layers.Get(layers.structureGround, candidate.x, candidate.y, 0))
                continue;

            center = candidate;
        }

        if(!center)
            return null;

        for(var wx = center.x - rx - 2; wx <= center.x + rx + 2; ++wx) {
            for(var wy = center.y - ry - 2; wy <= center.y + ry + 2; ++wy) {
                var nx = (wx - center.x) / Math.max(1, rx);
                var ny = (wy - center.y) / Math.max(1, ry);
                var wobble = ((MapGen.Random.HashTile(pContext.Seed, wx, wy, 857) % 100) / 100) * 0.18;
                var edgeNibble = ((MapGen.Random.HashTile(pContext.Seed, wx, wy, 859) % 100) / 100) * 0.10;

                if((nx * nx) + (ny * ny) + wobble - edgeNibble > 1)
                    continue;
                if(this.IsLiveTerrainProtectedCell(pContext, wx, wy, pProtectedPoints, 2))
                    continue;
                this.SetLiveWaterCell(pContext, wx, wy, waterPoints, waterSeen);
            }
        }

        if(waterPoints.length < 12)
            return null;

        var shorePoints = this.BuildBeachShorePoints(pContext, waterPoints);
        var river = {
            role: "grammar_beach_pond_pocket",
            center: center,
            radius: { x: rx, y: ry },
            points: shorePoints,
            segment: null
        };

        pContext.Rivers.push(river);
        return {
            river: river,
            waterPoints: waterPoints,
            shorePoints: shorePoints,
            vertical: false,
            side: 0,
            inward: { x: 0, y: 0 },
            localizedSegment: true,
            blob: true,
            pocket: true,
            segment: null
        };
    },

    CountLiveLayerNeighbours: function(pLayer, pX, pY, pRadius) {
        var radius = Math.max(1, Math.floor(pRadius || 1));
        var count = 0;

        for(var x = pX - radius; x <= pX + radius; ++x) {
            for(var y = pY - radius; y <= pY + radius; ++y) {
                if(x === pX && y === pY)
                    continue;
                if(Math.max(Math.abs(x - pX), Math.abs(y - pY)) > radius)
                    continue;
                if(MapGen.Layers.Get(pLayer, x, y, 0))
                    ++count;
            }
        }

        return count;
    },

    SealLiveBeachBand: function(pContext, pProtectedPoints, pBeachCells, pBeachSeen) {
        var sealed = 0;
        var layers = pContext.Layers;

        for(var pass = 0; pass < 4; ++pass) {
            var additions = [];
            for(var x = 1; x < pContext.Width - 1; ++x) {
                for(var y = 1; y < pContext.Height - 1; ++y) {
                    if(MapGen.Layers.Get(layers.water, x, y, 0) ||
                        MapGen.Layers.Get(layers.coast, x, y, 0) ||
                        MapGen.Layers.Get(layers.riverBank, x, y, 0) ||
                        this.IsLiveBeachProtectedCell(pContext, x, y))
                        continue;

                    var coastNeighbours = this.CountLiveLayerNeighbours(layers.coast, x, y, 1);
                    var horizontalBridge =
                        (MapGen.Layers.Get(layers.coast, x - 1, y, 0) || MapGen.Layers.Get(layers.coast, x - 2, y, 0)) &&
                        (MapGen.Layers.Get(layers.coast, x + 1, y, 0) || MapGen.Layers.Get(layers.coast, x + 2, y, 0));
                    var verticalBridge =
                        (MapGen.Layers.Get(layers.coast, x, y - 1, 0) || MapGen.Layers.Get(layers.coast, x, y - 2, 0)) &&
                        (MapGen.Layers.Get(layers.coast, x, y + 1, 0) || MapGen.Layers.Get(layers.coast, x, y + 2, 0));

                    if(coastNeighbours >= 4 ||
                        horizontalBridge ||
                        verticalBridge ||
                        (coastNeighbours >= 2 && this.HasLiveTerrainLayerNear(layers.water, x, y, 2)))
                        additions.push({ x: x, y: y });
                }
            }

            for(var index = 0; index < additions.length; ++index) {
                if(this.SetLiveBeachCell(pContext, additions[index].x, additions[index].y, pBeachCells, pBeachSeen))
                    ++sealed;
            }
        }

        return sealed;
    },

    SealGrammarBeachEdgeNotches: function(pContext, pProtectedPoints, pBeachCells, pBeachSeen, pNarrowOnly) {
        var sealed = 0;
        var layers = pContext.Layers;
        var offsets = [
            [0, -1],
            [1, 0],
            [0, 1],
            [-1, 0]
        ];

        for(var pass = 0; pass < 2; ++pass) {
            var additions = [];

            for(var x = 1; x < pContext.Width - 1; ++x) {
                for(var y = 1; y < pContext.Height - 1; ++y) {
                    if(MapGen.Layers.Get(layers.water, x, y, 0) ||
                        MapGen.Layers.Get(layers.coast, x, y, 0) ||
                        MapGen.Layers.Get(layers.riverBank, x, y, 0) ||
                        this.IsLiveBeachProtectedCell(pContext, x, y, true) ||
                        this.PointNearList({ x: x, y: y }, pProtectedPoints || [], 2))
                        continue;

                    var coastNeighbours = this.CountLiveLayerNeighbours(layers.coast, x, y, 1);
                    if(coastNeighbours < 2 ||
                        !this.HasLiveTerrainLayerNear(layers.water, x, y, 4))
                        continue;

                    var cardinalCoast = 0;
                    for(var offsetIndex = 0; offsetIndex < offsets.length; ++offsetIndex) {
                        if(MapGen.Layers.Get(layers.coast, x + offsets[offsetIndex][0], y + offsets[offsetIndex][1], 0))
                            ++cardinalCoast;
                    }

                    var horizontalBridge =
                        MapGen.Layers.Get(layers.coast, x - 1, y, 0) &&
                        MapGen.Layers.Get(layers.coast, x + 1, y, 0);
                    var verticalBridge =
                        MapGen.Layers.Get(layers.coast, x, y - 1, 0) &&
                        MapGen.Layers.Get(layers.coast, x, y + 1, 0);

                    if((!pNarrowOnly && (cardinalCoast >= 2 || coastNeighbours >= 3)) ||
                        horizontalBridge ||
                        verticalBridge)
                        additions.push({ x: x, y: y });
                }
            }

            if(!additions.length)
                break;

            for(var index = 0; index < additions.length; ++index) {
                if(this.SetLiveBeachCell(pContext, additions[index].x, additions[index].y, pBeachCells, pBeachSeen))
                    ++sealed;
            }
        }

        return sealed;
    },

    GrammarBeachExpectedWaterGapScore: function(pContext, pWaterInfo, pCandidate) {
        if(!pContext || !pContext.Layers || !pWaterInfo || !pCandidate)
            return 0;

        var layers = pContext.Layers;
        var score = 0;
        var x;
        var y;

        if(pWaterInfo.vertical) {
            y = pCandidate.y;
            if(pWaterInfo.side > 0) {
                for(x = pCandidate.x + 1; x < pContext.Width; ++x) {
                    if(MapGen.Layers.Get(layers.water, x, y, 0))
                        continue;
                    score += MapGen.Layers.Get(layers.occupied, x, y, 0) ||
                        MapGen.Layers.Get(layers.structureGround, x, y, 0) ? 300 : 25;
                }
            }
            else {
                for(x = 0; x < pCandidate.x; ++x) {
                    if(MapGen.Layers.Get(layers.water, x, y, 0))
                        continue;
                    score += MapGen.Layers.Get(layers.occupied, x, y, 0) ||
                        MapGen.Layers.Get(layers.structureGround, x, y, 0) ? 300 : 25;
                }
            }
        }
        else {
            x = pCandidate.x;
            if(pWaterInfo.side > 0) {
                for(y = pCandidate.y + 1; y < pContext.Height; ++y) {
                    if(MapGen.Layers.Get(layers.water, x, y, 0))
                        continue;
                    score += MapGen.Layers.Get(layers.occupied, x, y, 0) ||
                        MapGen.Layers.Get(layers.structureGround, x, y, 0) ? 300 : 25;
                }
            }
            else {
                for(y = 0; y < pCandidate.y; ++y) {
                    if(MapGen.Layers.Get(layers.water, x, y, 0))
                        continue;
                    score += MapGen.Layers.Get(layers.occupied, x, y, 0) ||
                        MapGen.Layers.Get(layers.structureGround, x, y, 0) ? 300 : 25;
                }
            }
        }

        return score;
    },

    GrammarBeachProtectedRangeScore: function(pContext, pWaterInfo, pCandidates, pStart, pEnd, pProtectedPoints) {
        var score = 0;
        var points = pProtectedPoints || [];
        var rangeLength = pEnd - pStart + 1;
        var anchor = pCandidates[pStart];
        var rangeStartT = pCandidates[pStart] ? pCandidates[pStart].t : pStart;
        var rangeEndT = pCandidates[pEnd] ? pCandidates[pEnd].t : pEnd;

        for(var index = 0; index < points.length; ++index) {
            var point = points[index];
            if(!point)
                continue;

            var t = pWaterInfo.vertical ? point.y : point.x;
            if(t < rangeStartT - 8 || t > rangeEndT + 8)
                continue;

            var candidateIndex = Math.max(pStart, Math.min(pEnd, pStart + Math.round(t - rangeStartT)));
            var candidate = pCandidates[candidateIndex];
            if(!candidate)
                continue;

            var cross = pWaterInfo.vertical ? point.x : point.y;
            var coastCross = pWaterInfo.vertical ? candidate.x : candidate.y;
            var nearWater = pWaterInfo.side > 0 ?
                cross >= coastCross - 3 :
                cross <= coastCross + 3;
            var shape = this.GrammarBeachShapeAt(candidateIndex - pStart, rangeLength);
            var normalCross = pWaterInfo.vertical ? candidate.normal.x : candidate.normal.y;
            var anchorCross = pWaterInfo.vertical ? anchor.x : anchor.y;
            var shapedStart = normalCross !== 0 ?
                anchorCross + (normalCross * shape.offset) :
                coastCross;
            var shapedEnd = shapedStart + (normalCross * Math.max(0, shape.width - 1));
            var lowCross = Math.min(coastCross, shapedStart, shapedEnd);
            var highCross = Math.max(coastCross, shapedStart, shapedEnd);
            var tDistance = Math.abs(t - candidate.t);

            if(cross >= lowCross - 7 && cross <= highCross + 7)
                score += 24000 + (Math.max(0, 8 - tDistance) * 1200);

            if(nearWater)
                score += 1200 + (Math.max(0, 4 - tDistance) * 80);
        }

        return score;
    },

    SelectGrammarBeachEdgeRanges: function(pContext, pWaterInfo, pCandidates, pProtectedPoints) {
        var candidateCount = pCandidates.length;

        // Shipped mapm8 reserves the narrow free end of its water wedge for a
        // small cove neck, then places one rounded sand lobe at the attached
        // corner.  Anchoring this range also avoids asking the one-direction
        // sub-1 beach turns to reverse partway along a floating ribbon.
        if(pWaterInfo.ocean) {
            var beachLength = Math.max(7, Math.min(candidateCount,
                Math.round(candidateCount * 0.68)));
            if(pWaterInfo.edgeAnchorAtStart)
                return [{ start: 0, end: beachLength - 1 }];
            return [{ start: candidateCount - beachLength, end: candidateCount - 1 }];
        }

        var scaledMinimum = Math.round(candidateCount * 0.30);
        var scaledMaximum = Math.round(candidateCount * 0.43);
        var desiredLength = Math.round(candidateCount * (0.32 +
            ((MapGen.Random.HashTile(pContext.Seed, candidateCount, 31, 859) % 9) / 100)));
        desiredLength = Math.max(16, Math.min(Math.min(34, candidateCount), desiredLength));
        var minLength = Math.max(14, Math.min(desiredLength, scaledMinimum));
        var maxLength = Math.max(minLength, Math.min(candidateCount, Math.min(36, Math.max(desiredLength + 5, scaledMaximum))));
        var bestStart = 0;
        var bestEnd = Math.min(candidateCount - 1, desiredLength - 1);
        var bestScore = 99999999;

        for(var length = minLength; length <= maxLength; ++length) {
            for(var start = 0; start <= candidateCount - length; ++start) {
                var end = start + length - 1;
                var score = Math.abs(length - desiredLength) * 18;
                var depthChanges = 0;
                var longestFlatRun = 1;
                var flatRun = 1;

                if(start === 0 || end === candidateCount - 1)
                    score += 25;
                if(pWaterInfo.ocean) {
                    var capMargin = Math.max(4, Math.min(8, Math.floor(candidateCount * 0.14)));
                    score += Math.max(0, capMargin - start) * 260;
                    score += Math.max(0, end - (candidateCount - capMargin - 1)) * 260;
                }

                for(var index = start; index <= end; ++index) {
                    if(index > start &&
                        typeof pCandidates[index - 1].depth === "number" &&
                        typeof pCandidates[index].depth === "number") {
                        if(pCandidates[index].depth !== pCandidates[index - 1].depth) {
                            ++depthChanges;
                            flatRun = 1;
                        }
                        else {
                            ++flatRun;
                            longestFlatRun = Math.max(longestFlatRun, flatRun);
                        }

                        if(pCandidates[index].depth < pCandidates[index - 1].depth && !pWaterInfo.ocean)
                            score += 5000;
                    }

                    score += this.GrammarBeachExpectedWaterGapScore(pContext, pWaterInfo, pCandidates[index]);
                }

                score += Math.max(0, 4 - depthChanges) * 12;
                score += Math.max(0, longestFlatRun - 3) * 20;
                score += this.GrammarBeachProtectedRangeScore(
                    pContext,
                    pWaterInfo,
                    pCandidates,
                    start,
                    end,
                    pProtectedPoints
                );

                if(score < bestScore) {
                    bestScore = score;
                    bestStart = start;
                    bestEnd = end;
                }
            }
        }

        return [{ start: bestStart, end: bestEnd }];
    },

    GrammarBeachShapeTemplate: function(pLength) {
        var bankWidths = MapGen.Terrain &&
            MapGen.Terrain.Smoothing &&
            MapGen.Terrain.Smoothing.JungleBeach &&
            MapGen.Terrain.Smoothing.JungleBeach.BankWidthProfile ?
            MapGen.Terrain.Smoothing.JungleBeach.BankWidthProfile() :
            [4, 4, 4, 4, 5, 4, 4, 6, 8, 6, 6, 5, 3, 2, 2, 1];

        return {
            offsets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            // This is the measured row-width sequence from mapm5.  Sampling
            // it to the generated range produces the same broad lobe and
            // rounded taper as both mapm5 and mapm8, without inventing a
            // second synthetic beach contour in this file.
            widths: bankWidths
        };
    },

    GrammarBeachShapeAt: function(pIndex, pLength) {
        var template = this.GrammarBeachShapeTemplate(pLength);
        var maxIndex = Math.max(1, pLength - 1);
        var sourceMax = template.widths.length - 1;
        var pos = (Math.max(0, Math.min(maxIndex, pIndex)) / maxIndex) * sourceMax;
        var left = Math.floor(pos);
        var right = Math.min(sourceMax, left + 1);
        var blend = pos - left;

        function sample(values) {
            return Math.round(values[left] + ((values[right] - values[left]) * blend));
        }

        return {
            offset: Math.max(0, sample(template.offsets)),
            width: Math.max(1, sample(template.widths))
        };
    },

    StampShoreBeachBand: function(pContext, pWaterInfo, pProtectedPoints) {
        var shore = pWaterInfo.shorePoints || [];
        var span = shore.length;
        var beachCells = [];
        var beachSeen = {};

        if(pWaterInfo.authoredBeachCells) {
            beachCells = pWaterInfo.authoredBeachCells.slice(0);
            var sealed = 0;
            if(pWaterInfo.ocean) {
                for(var bi = 0; bi < beachCells.length; ++bi)
                    beachSeen[beachCells[bi].x + "," + beachCells[bi].y] = true;
                sealed = this.SealGrammarBeachEdgeNotches(
                    pContext, pProtectedPoints, beachCells, beachSeen, true);
            }
            var authoredCenter = pWaterInfo.river && pWaterInfo.river.center ?
                pWaterInfo.river.center : null;

            pContext.Beaches.push({
                role: "grammar_" + (pWaterInfo.authoredBeachTemplate || "authored_beach"),
                center: authoredCenter,
                coastTiles: beachCells.length,
                quicksandTiles: 0,
                segment: pWaterInfo.segment,
                sealedTiles: sealed
            });

            return {
                coast: beachCells.length,
                sealed: sealed,
                cells: beachCells,
                center: authoredCenter,
                segment: pWaterInfo.segment,
                template: pWaterInfo.authoredBeachTemplate,
                templateOrigin: pWaterInfo.templateOrigin
            };
        }

        if(span < 8)
            return { coast: 0, cells: beachCells, center: null, segment: null };

        if(pWaterInfo.beachCandidates && pWaterInfo.beachCandidates.length) {
            var candidates = pWaterInfo.beachCandidates.slice(0).sort(function(pLeft, pRight) {
                if(pLeft.t !== pRight.t)
                    return pLeft.t - pRight.t;
                // Total-order tiebreak on unique cell coords: the engine's
                // Array.sort is unstable, so equal-t candidates must not be
                // free to reorder between launches (would change the beach).
                if(pLeft.x !== pRight.x)
                    return pLeft.x - pRight.x;
                return pLeft.y - pRight.y;
            });
            var candidateCount = candidates.length;
            var fullGrammarBeachEdge =
                pWaterInfo.edgeInlet &&
                pContext.Profile &&
                pContext.Profile.TargetPackProfile === "grammar_beach";
            var length;
            var start;
            var end;
            var profileBeachWidth = Math.round(Number(pContext.Profile && pContext.Profile.BeachWidth || 4));
            var baseWidth = pWaterInfo.edgeInlet ?
                (fullGrammarBeachEdge ? Math.max(3, Math.min(4, profileBeachWidth)) : Math.max(3, profileBeachWidth)) :
                4;
            var selectedRanges = [];
            var center;

            if(fullGrammarBeachEdge) {
                selectedRanges = this.SelectGrammarBeachEdgeRanges(
                    pContext,
                    pWaterInfo,
                    candidates,
                    pProtectedPoints
                );
                start = selectedRanges[0].start;
                end = selectedRanges[0].end;
                length = 0;
                for(var rangeCountIndex = 0; rangeCountIndex < selectedRanges.length; ++rangeCountIndex)
                    length += selectedRanges[rangeCountIndex].end - selectedRanges[rangeCountIndex].start + 1;
            }
            else {
                var segmentLengthFraction = pWaterInfo.edgeInlet ? 0.68 : 0.38;
                length = Math.max(
                    Math.min(candidateCount, pWaterInfo.edgeInlet ? 18 : 14),
                    Math.floor(candidateCount * segmentLengthFraction)
                );
                length = Math.min(candidateCount - 2, Math.max(8, length));
                var maxStart = Math.max(1, candidateCount - length - 2);
                start = 1 + (MapGen.Random.HashTile(pContext.Seed, candidateCount, 17, 817) % maxStart);
                end = Math.min(candidateCount - 2, start + length);
                selectedRanges.push({ start: start, end: end });
            }

            center = candidates[Math.floor((start + end) * 0.5)];

            var waterSeen = {};
            if(pWaterInfo.waterPoints) {
                for(var waterSeenIndex = 0; waterSeenIndex < pWaterInfo.waterPoints.length; ++waterSeenIndex) {
                    var waterPoint = pWaterInfo.waterPoints[waterSeenIndex];
                    waterSeen[waterPoint.x + "," + waterPoint.y] = true;
                }
            }

            function grammarBeachShapeTarget(point, anchor, offset) {
                return {
                    x: point.normal.x !== 0 ? anchor.x + (point.normal.x * offset) : point.x,
                    y: point.normal.y !== 0 ? anchor.y + (point.normal.y * offset) : point.y
                };
            }

            function expandOceanToBeachShape(self, point, target) {
                var offset = Math.round(
                    ((target.x - point.x) * point.normal.x) +
                    ((target.y - point.y) * point.normal.y)
                );
                var lastWaterStep = -1;

                if(offset <= 0)
                    return point;

                for(var step = 0; step < offset; ++step) {
                    var wx = point.x + (point.normal.x * step);
                    var wy = point.y + (point.normal.y * step);

                    if(self.IsLiveWaterProtectedCell(pContext, wx, wy, pProtectedPoints, 1))
                        break;
                    if(self.SetLiveWaterCell(pContext, wx, wy, pWaterInfo.waterPoints, waterSeen))
                        lastWaterStep = step;
                }

                var beachStep = Math.max(0, Math.min(offset, lastWaterStep + 1));
                return {
                    x: point.x + (point.normal.x * beachStep),
                    y: point.y + (point.normal.y * beachStep)
                };
            }

            if(fullGrammarBeachEdge) {
                for(var tailRangeIndex = 0; tailRangeIndex < selectedRanges.length; ++tailRangeIndex) {
                    var tailRange = selectedRanges[tailRangeIndex];
                    var tailLength = tailRange.end - tailRange.start + 1;
                    var tailRows = Math.min(6, Math.max(2, Math.floor(tailLength * 0.35)));
                    var tailAnchor = candidates[tailRange.start];

                    for(var tail = 1; tail <= tailRows && tailRange.end + tail < candidates.length; ++tail) {
                        var tailPoint = candidates[tailRange.end + tail];
                        var tailShape = this.GrammarBeachShapeAt(tailLength - 1, tailLength);
                        var tailOffset = Math.round(tailShape.offset * (1 - (tail / (tailRows + 1))));
                        expandOceanToBeachShape(
                            this,
                            tailPoint,
                            grammarBeachShapeTarget(tailPoint, tailAnchor, tailOffset)
                        );
                    }
                }
            }

            for(var rangeIndex = 0; rangeIndex < selectedRanges.length; ++rangeIndex) {
                var range = selectedRanges[rangeIndex];
                var rangeLength = range.end - range.start + 1;
                var rangeAnchor = candidates[range.start];
                for(var candidateIndex = range.start; candidateIndex <= range.end; ++candidateIndex) {
                    var point = candidates[candidateIndex];
                    var edgeDistance = Math.min(candidateIndex - range.start, range.end - candidateIndex);
                    var minimumWidth = fullGrammarBeachEdge ? Math.min(3, baseWidth) : 1;
                    var maximumWidth = fullGrammarBeachEdge ? Math.max(4, Math.min(6, baseWidth + 2)) :
                        baseWidth + (pWaterInfo.edgeInlet ? 3 : 3);
                    var shape = fullGrammarBeachEdge ?
                        this.GrammarBeachShapeAt(candidateIndex - range.start, rangeLength) :
                        null;
                    var taper = fullGrammarBeachEdge ?
                        Math.max(minimumWidth, Math.min(baseWidth + 2, Math.floor(edgeDistance / 2) + minimumWidth)) :
                        Math.max(1, Math.min(baseWidth + 1, Math.floor(edgeDistance / 3) + 1));
                    var depthBias = 0;
                    var wave = pWaterInfo.edgeInlet ?
                        Math.sin(((candidateIndex - range.start) / Math.max(1, range.end - range.start)) * Math.PI * 1.7) * 0.8 :
                        Math.sin(((candidateIndex - range.start) / Math.max(1, range.end - range.start)) * Math.PI * 2.1) * 0.9;
                    var noise = ((MapGen.Random.HashTile(pContext.Seed, point.x, point.y, 819) % 100) / 100);

                    if(pWaterInfo.edgeInlet && typeof point.depth === "number" && typeof pWaterInfo.edgeBaseDepth === "number")
                        depthBias = Math.max(-1, Math.min(2, Math.round((point.depth - pWaterInfo.edgeBaseDepth) * 0.35)));

                    var width = pWaterInfo.edgeInlet ?
                        Math.round(baseWidth + wave + depthBias + (noise > 0.82 ? 1 : 0) - (noise < 0.10 ? 1 : 0)) :
                        Math.round(baseWidth + wave + (noise > 0.86 ? 1 : 0));
                    width = shape ?
                        Math.max(1, Math.min(maximumWidth + 2, shape.width)) :
                        Math.max(minimumWidth, Math.min(maximumWidth, Math.min(width, taper + (pWaterInfo.edgeInlet ? 3 : 2))));

                    var beachStart = shape ?
                        grammarBeachShapeTarget(point, rangeAnchor, shape.offset) :
                        point;

                    if(shape)
                        beachStart = expandOceanToBeachShape(this, point, beachStart);

                    for(var band = 0; band < width; ++band) {
                        var bx = beachStart.x + (point.normal.x * band);
                        var by = beachStart.y + (point.normal.y * band);

                        if(MapGen.Layers.Get(pContext.Layers.water, bx, by, 0))
                            break;
                        if(this.IsLiveBeachProtectedCell(pContext, bx, by, pWaterInfo.edgeInlet))
                            break;
                        this.SetLiveBeachCell(pContext, bx, by, beachCells, beachSeen);

                        if(pWaterInfo.edgeInlet || band < 3)
                            continue;
                    }
                }
            }

            var sealed = fullGrammarBeachEdge ?
                this.SealGrammarBeachEdgeNotches(pContext, pProtectedPoints, beachCells, beachSeen) :
                (pWaterInfo.edgeInlet ? 0 : this.SealLiveBeachBand(pContext, pProtectedPoints, beachCells, beachSeen));

            pContext.Beaches.push({
                role: pWaterInfo.edgeInlet ? "grammar_edge_inlet_beach_band" : "grammar_meander_beach_band",
                center: center,
                coastTiles: beachCells.length,
                quicksandTiles: 0,
                segment: { start: start, end: end },
                segments: selectedRanges,
                sealedTiles: sealed
            });

            return {
                coast: beachCells.length,
                sealed: sealed,
                cells: beachCells,
                center: center,
                segment: { start: start, end: end },
                segments: selectedRanges
            };
        }

        if(pWaterInfo.blob) {
            var waterPoints = pWaterInfo.waterPoints || [];
            var center = pWaterInfo.river && pWaterInfo.river.center ? pWaterInfo.river.center : shore[Math.floor(span / 2)];
            var arcCenter = (MapGen.Random.HashTile(pContext.Seed, center.x, center.y, 821) % 6283) / 1000;
            var arcSpan = pWaterInfo.pocket ?
                1.35 + ((MapGen.Random.HashTile(pContext.Seed, center.x, center.y, 823) % 65) / 100) :
                2.15 + ((MapGen.Random.HashTile(pContext.Seed, center.x, center.y, 823) % 80) / 100);
            var selected = [];
            var maxBand = pWaterInfo.pocket ? 1 : 2;

            function angleDistance(pLeft, pRight) {
                var delta = Math.abs(pLeft - pRight);
                while(delta > Math.PI)
                    delta = Math.abs(delta - (Math.PI * 2));
                return delta;
            }

            shore.sort(function(pLeft, pRight) {
                var leftAngle = Math.atan2(pLeft.y - center.y, pLeft.x - center.x);
                var rightAngle = Math.atan2(pRight.y - center.y, pRight.x - center.x);
                var byAngle = angleDistance(leftAngle, arcCenter) - angleDistance(rightAngle, arcCenter);
                if(byAngle !== 0)
                    return byAngle;
                // Total-order tiebreak on unique cell coords: equal angular
                // distances (symmetric points) must not reorder per launch.
                if(pLeft.x !== pRight.x)
                    return pLeft.x - pRight.x;
                return pLeft.y - pRight.y;
            });

            for(var shoreIndex = 0; shoreIndex < shore.length; ++shoreIndex) {
                var shorePoint = shore[shoreIndex];
                var angle = Math.atan2(shorePoint.y - center.y, shorePoint.x - center.x);
                if(angleDistance(angle, arcCenter) <= arcSpan * 0.5)
                    selected.push(shorePoint);
            }

            var minimumArcCells = Math.min(
                shore.length,
                pWaterInfo.pocket ? 5 + (MapGen.Random.HashTile(pContext.Seed, center.x, center.y, 825) % 4) : 10
            );
            for(var fillIndex = 0; selected.length < minimumArcCells && fillIndex < shore.length; ++fillIndex)
                selected.push(shore[fillIndex]);

            for(var selectedIndex = 0; selectedIndex < selected.length; ++selectedIndex) {
                var point = selected[selectedIndex];
                var vx = point.x - center.x;
                var vy = point.y - center.y;
                var stepX = 0;
                var stepY = 0;

                if(Math.abs(vx) >= Math.abs(vy) * 0.65)
                    stepX = vx < 0 ? -1 : 1;
                if(Math.abs(vy) >= Math.abs(vx) * 0.65)
                    stepY = vy < 0 ? -1 : 1;
                if(stepX === 0 && stepY === 0)
                    stepX = vx < 0 ? -1 : 1;

                var tangentX = -stepY;
                var tangentY = stepX;
                if(tangentX === 0 && tangentY === 0)
                    tangentY = 1;

                for(var band = 0; band <= maxBand; ++band) {
                    var bx = point.x + (stepX * band);
                    var by = point.y + (stepY * band);

                    if(MapGen.Layers.Get(pContext.Layers.water, bx, by, 0))
                        break;
                    if(this.IsLiveBeachProtectedCell(pContext, bx, by))
                        break;
                    this.SetLiveBeachCell(pContext, bx, by, beachCells, beachSeen);

                    if(pWaterInfo.pocket || band < 2)
                        continue;

                    for(var side = -1; side <= 1; side += 2) {
                        var sx = bx + (tangentX * side);
                        var sy = by + (tangentY * side);
                        if(MapGen.Layers.Get(pContext.Layers.water, sx, sy, 0) ||
                            this.IsLiveBeachProtectedCell(pContext, sx, sy))
                            continue;
                        this.SetLiveBeachCell(pContext, sx, sy, beachCells, beachSeen);
                    }
                }
            }

            pContext.Beaches.push({
                role: pWaterInfo.pocket ? "grammar_pond_pocket_beach_arc" : "grammar_lagoon_beach_arc",
                center: center,
                coastTiles: beachCells.length,
                quicksandTiles: 0,
                segment: null,
                sealedTiles: 0
            });

            return {
                coast: beachCells.length,
                sealed: 0,
                cells: beachCells,
                center: center,
                segment: null
            };
        }

        var start = pWaterInfo.localizedSegment ? 1 : 0;
        var end = pWaterInfo.localizedSegment ? span - 2 : span - 1;

        if(!pWaterInfo.localizedSegment) {
            var centerFraction = 0.28 + ((MapGen.Random.HashTile(pContext.Seed, 11, 13, 733) % 45) / 100);
            var lengthFraction = 0.34 + ((MapGen.Random.HashTile(pContext.Seed, 17, 19, 739) % 22) / 100);
            var length = Math.max(10, Math.min(span - 4, Math.floor(span * lengthFraction)));
            var centerIndex = Math.max(4, Math.min(span - 5, Math.floor(span * centerFraction)));
            start = Math.max(2, centerIndex - Math.floor(length / 2));
            end = Math.min(span - 3, start + length);
            start = Math.max(2, end - length);
        }

        var baseWidth = 3 + (MapGen.Random.HashTile(pContext.Seed, 23, 29, 743) % 2);
        var center = shore[Math.max(start, Math.min(end, Math.floor((start + end) / 2)))];

        for(var index = start; index <= end; ++index) {
            var point = shore[index];
            var edgeDistance = Math.min(index - start, end - index);
            var taper = Math.max(1, Math.min(baseWidth + 1, Math.floor(edgeDistance / 2) + 1));
            var wave = Math.sin(((index - start) / Math.max(1, end - start)) * Math.PI * 2) * 1.2;
            var width = Math.max(1, Math.min(baseWidth + 2, Math.round(baseWidth + wave)));
            width = Math.min(width, taper);

            for(var band = 0; band < width; ++band) {
                var bx = point.x + (pWaterInfo.inward.x * band);
                var by = point.y + (pWaterInfo.inward.y * band);
                if(this.IsLiveBeachProtectedCell(pContext, bx, by))
                    continue;
                this.SetLiveBeachCell(pContext, bx, by, beachCells, beachSeen);
            }
        }

        if(pWaterInfo.localizedSegment) {
            var waterPoints = pWaterInfo.waterPoints || [];
            var offsets = [
                [0, -1],
                [1, 0],
                [0, 1],
                [-1, 0]
            ];
            var perimeterWidth = 2;

            for(var waterIndex = 0; waterIndex < waterPoints.length; ++waterIndex) {
                var water = waterPoints[waterIndex];
                for(var offsetIndex = 0; offsetIndex < offsets.length; ++offsetIndex) {
                    var ox = offsets[offsetIndex][0];
                    var oy = offsets[offsetIndex][1];

                    for(var band = 1; band <= perimeterWidth; ++band) {
                        var px = water.x + (ox * band);
                        var py = water.y + (oy * band);

                        if(MapGen.Layers.Get(pContext.Layers.water, px, py, 0))
                            break;
                        if(this.IsLiveBeachProtectedCell(pContext, px, py))
                            break;
                        this.SetLiveBeachCell(pContext, px, py, beachCells, beachSeen);
                    }
                }
            }
        }

        var sealed = 0;

        pContext.Beaches.push({
            role: "grammar_edge_beach_band",
            center: center,
            coastTiles: beachCells.length,
            quicksandTiles: 0,
            segment: { start: start, end: end },
            sealedTiles: sealed
        });

        return {
            coast: beachCells.length,
            sealed: sealed,
            cells: beachCells,
            center: center,
            segment: { start: start, end: end }
        };
    },

    CombineLiveBeachSets: function(pPrimary, pSecondary) {
        var sets = [];
        var cells = [];
        var centers = [];
        var coast = 0;
        var sealed = 0;

        if(pPrimary)
            sets.push(pPrimary);
        if(pSecondary)
            sets.push(pSecondary);

        for(var index = 0; index < sets.length; ++index) {
            var item = sets[index];
            var itemCells = item.cells || [];

            coast += Number(item.coast || 0);
            sealed += Number(item.sealed || 0);
            if(item.center)
                centers.push(item.center);
            for(var cellIndex = 0; cellIndex < itemCells.length; ++cellIndex)
                cells.push(itemCells[cellIndex]);
        }

        return {
            coast: coast,
            sealed: sealed,
            cells: cells,
            center: centers.length ? centers[0] : null,
            centers: centers,
            primary: pPrimary || null,
            pocket: pSecondary || null
        };
    },

    LiveTerrainTargetFraction: function(pContext, pClassName, pFallback) {
        var targets = pContext.Profile && pContext.Profile.TargetPack ?
            pContext.Profile.TargetPack.targets || {} : {};
        var terrain = targets.composition && targets.composition.terrainComposition ?
            targets.composition.terrainComposition : {};
        var stats = terrain.passabilityFractions ? terrain.passabilityFractions[pClassName] : null;
        var range = stats ? stats.targetRange || stats.wideRange || null : null;
        var low = range && range.length > 1 ? Number(range[0]) : NaN;
        var high = range && range.length > 1 ? Number(range[1]) : NaN;

        if(isFinite(low) && isFinite(high))
            return (low + high) / 2;

        return pFallback;
    },

    LiveQuicksandBeachMinDistance: function(pContext) {
        var profile = pContext && pContext.Profile ? pContext.Profile : {};
        var distance = Number(profile.QuicksandBeachMinDistance);

        if(isNaN(distance))
            distance = 0;

        return Math.max(0, Math.floor(distance));
    },

    StampAuthoredQuicksandPatches: function(pContext, pProtectedPoints, pArchetype) {
        var beachData = MapGen.Terrain && MapGen.Terrain.Smoothing ?
            MapGen.Terrain.Smoothing.JungleBeach : null;
        var templates = beachData && beachData.QuicksandPatchTemplates ?
            beachData.QuicksandPatchTemplates() : [];
        var substantialTemplates = [];
        for(var authoredTemplateIndex = 0;
            authoredTemplateIndex < templates.length;
            ++authoredTemplateIndex) {
            if(templates[authoredTemplateIndex].id !== "mapm8_small_slant")
                substantialTemplates.push(templates[authoredTemplateIndex]);
        }
        if(substantialTemplates.length)
            templates = substantialTemplates;
        var coreIds = {
            107: true, 146: true, 147: true, 148: true, 166: true,
            167: true, 187: true, 208: true, 227: true
        };
        var area = pContext.Width * pContext.Height;
        var targetFraction = this.LiveTerrainTargetFraction(
            pContext,
            "sinking_ground",
            pArchetype === "quicksand_field" ? 0.028 : 0.018
        );
        var targetCount = Math.round(area * targetFraction) + 7;
        var cells = [];
        var seen = {};
        var patches = [];
        var centers = [];
        var minBeachDistance = this.LiveQuicksandBeachMinDistance(pContext);
        var layers = pContext.Layers;
        var requestedPatchCount = Number(
            pContext.Profile && pContext.Profile.GrammarBeachQuicksandPatchTarget
        );

        if(!isFinite(requestedPatchCount))
            requestedPatchCount = pArchetype === "quicksand_field" ? 5 : 2;
        requestedPatchCount = Math.max(0, Math.min(7, Math.floor(requestedPatchCount)));

        if(requestedPatchCount === 0) {
            return {
                cells: [],
                patches: [],
                authoredTemplates: true,
                count: 0,
                target: 0,
                smootherSinkingReserve: 0
            };
        }

        targetCount = Math.max(
            requestedPatchCount * 12,
            Math.min(Math.round(area * 0.038), targetCount)
        );

        if(!templates.length)
            return null;

        for(var patchIndex = 0;
            cells.length < targetCount && patchIndex < requestedPatchCount;
            ++patchIndex) {
            var templateIndex = MapGen.Random.HashTile(
                pContext.Seed,
                patchIndex + 17,
                cells.length + 23,
                3527
            ) % templates.length;
            var template = templates[templateIndex];
            var height = template.rows.length;
            var width = template.rows[0].length;
            var origin = null;

            for(var attempt = 0; attempt < 180 && !origin; ++attempt) {
                var xRange = Math.max(1, pContext.Width - width - 4);
                var yRange = Math.max(1, pContext.Height - height - 4);
                var ox = 2 + (MapGen.Random.HashTile(pContext.Seed, patchIndex, attempt, 3533) % xRange);
                var oy = 2 + (MapGen.Random.HashTile(pContext.Seed, attempt, patchIndex, 3539) % yRange);
                var center = { x: ox + Math.floor(width / 2), y: oy + Math.floor(height / 2) };
                var clear = !this.PointNearList(center, centers, Math.max(width, height) + 5);

                for(var row = 0; clear && row < height; ++row) {
                    for(var column = 0; clear && column < template.rows[row].length; ++column) {
                        if(template.rows[row][column] === null)
                            continue;

                        var x = ox + column;
                        var y = oy + row;
                        if(this.IsLiveTerrainProtectedCell(pContext, x, y, pProtectedPoints, 3) ||
                            this.HasLiveTerrainLayerNear(layers.water, x, y, 1) ||
                            (minBeachDistance > 0 &&
                                this.HasLiveTerrainLayerNear(layers.coast, x, y, minBeachDistance)))
                            clear = false;
                    }
                }

                if(clear)
                    origin = { x: ox, y: oy, center: center };
            }

            if(!origin)
                continue;

            var patchCore = [];
            var support = [];
            for(var stampRow = 0; stampRow < height; ++stampRow) {
                for(var stampColumn = 0; stampColumn < template.rows[stampRow].length; ++stampColumn) {
                    var tileId = template.rows[stampRow][stampColumn];
                    if(tileId === null)
                        continue;

                    var sx = origin.x + stampColumn;
                    var sy = origin.y + stampRow;
                    support.push({ x: sx, y: sy });
                    MapGen.Layers.Set(layers.blocked, sx, sy, 0);
                    if(layers.perimeterCover)
                        MapGen.Layers.Set(layers.perimeterCover, sx, sy, 0);

                    if(coreIds[tileId] && this.SetLiveQuicksandCell(pContext, sx, sy, cells, seen))
                        patchCore.push({ x: sx, y: sy });
                    else if(layers.keepClear)
                        // Grass-centre contour tiles are still part of the
                        // painted outline. Reserve them from forest growth or
                        // a later tree mask will visually amputate the edge.
                        MapGen.Layers.Set(layers.keepClear, sx, sy, 1);
                }
            }

            centers.push(origin.center);
            patches.push({
                center: origin.center,
                origin: { x: origin.x, y: origin.y },
                template: template.id,
                cells: patchCore.length,
                core: patchCore,
                support: support
            });
        }

        return {
            cells: cells,
            patches: patches,
            authoredTemplates: true,
            count: cells.length,
            target: targetCount,
            smootherSinkingReserve: 0
        };
    },

    StampQuicksandPatches: function(pContext, pWaterInfo, pBeach, pProtectedPoints, pArchetype) {
        if(pContext && pContext.Profile &&
            pContext.Profile.TargetPackProfile === "grammar_beach") {
            var authored = this.StampAuthoredQuicksandPatches(
                pContext,
                pProtectedPoints,
                pArchetype
            );
            if(authored)
                return authored;
        }

        var area = pContext.Width * pContext.Height;
        var profile = pContext.Profile || {};
        var minBeachDistance = this.LiveQuicksandBeachMinDistance(pContext);
        var centerMinBeachDistance = Number(profile.QuicksandBeachCenterMinDistance);
        var coastAffinityDistance = Number(profile.QuicksandCoastAffinityDistance);
        var allowBeachAnchors = profile.AllowQuicksandBeachAnchors === true;
        var targetFraction = this.LiveTerrainTargetFraction(
            pContext,
            "sinking_ground",
            pArchetype === "quicksand_field" ? 0.028 : 0.018
        );
        var targetCount = Math.round(area * targetFraction) + 7;
        var patchCount = pArchetype === "quicksand_field" ?
            4 + (MapGen.Random.HashTile(pContext.Seed, 31, 37, 751) % 3) :
            2 + (MapGen.Random.HashTile(pContext.Seed, 41, 43, 757) % 2);
        var cells = [];
        var seen = {};
        var patches = [];
        var centers = [];
        var layers = pContext.Layers;
        var beachAnchors = [];

        if(isNaN(centerMinBeachDistance))
            centerMinBeachDistance = minBeachDistance + 2;
        centerMinBeachDistance = Math.max(minBeachDistance, Math.floor(centerMinBeachDistance));
        if(isNaN(coastAffinityDistance))
            coastAffinityDistance = 18;
        coastAffinityDistance = Math.max(centerMinBeachDistance + 1, Math.floor(coastAffinityDistance));

        targetCount = Math.max(pArchetype === "quicksand_field" ? 96 : 48, Math.min(Math.round(area * 0.038), targetCount));
        patchCount = Math.max(
            patchCount,
            Math.ceil(targetCount / (pArchetype === "quicksand_field" ? 38 : 24))
        );
        patchCount = Math.min(patchCount, pArchetype === "quicksand_field" ? 7 : 9);

        if(allowBeachAnchors && pBeach) {
            if(pBeach.centers) {
                for(var beachCenterIndex = 0; beachCenterIndex < pBeach.centers.length; ++beachCenterIndex) {
                    if(pBeach.centers[beachCenterIndex])
                        beachAnchors.push(pBeach.centers[beachCenterIndex]);
                }
            }
            if(pBeach.center)
                beachAnchors.push(pBeach.center);
            if(pBeach.pocket && pBeach.pocket.center)
                beachAnchors.push(pBeach.pocket.center);
        }

        for(var patch = 0; patch < patchCount && cells.length < targetCount; ++patch) {
            var center = null;

            for(var attempt = 0; attempt < 120 && !center; ++attempt) {
                var anchor = beachAnchors.length && attempt < 32 ?
                    beachAnchors[MapGen.Random.HashTile(pContext.Seed, patch, attempt, 758) % beachAnchors.length] : null;
                var x;
                var y;

                if(anchor) {
                    x = Math.round(anchor.x) - 10 + (MapGen.Random.HashTile(pContext.Seed, patch, attempt, 761) % 21);
                    y = Math.round(anchor.y) - 10 + (MapGen.Random.HashTile(pContext.Seed, attempt, patch, 769) % 21);
                }
                else {
                    x = 4 + (MapGen.Random.HashTile(pContext.Seed, patch, attempt, 761) % Math.max(1, pContext.Width - 8));
                    y = 4 + (MapGen.Random.HashTile(pContext.Seed, attempt, patch, 769) % Math.max(1, pContext.Height - 8));
                }

                var candidate = { x: x, y: y };
                var waterClearance = anchor ? 1 : 4;

                if(this.PointNearList(candidate, pProtectedPoints, 7) ||
                    this.PointNearList(candidate, centers, pArchetype === "quicksand_field" ? 8 : 8) ||
                    this.HasLiveTerrainLayerNear(layers.water, x, y, waterClearance))
                    continue;
                if(centerMinBeachDistance > 0 && this.HasLiveTerrainLayerNear(layers.coast, x, y, centerMinBeachDistance))
                    continue;
                if(pArchetype !== "quicksand_field" && !this.HasLiveTerrainLayerNear(layers.coast, x, y, coastAffinityDistance))
                    continue;

                center = candidate;
            }

            if(!center)
                continue;

            centers.push(center);
            var remaining = Math.max(0, targetCount - cells.length);
            var rx = 3 +
                (MapGen.Random.HashTile(pContext.Seed, center.x, center.y, 773) % (pArchetype === "quicksand_field" ? 4 : 3));
            var ry = 3 +
                (MapGen.Random.HashTile(pContext.Seed, center.y, center.x, 787) % (pArchetype === "quicksand_field" ? 4 : 3));
            var patchCells = 0;

            if(remaining > 44) {
                rx += 1;
                ry += 1;
            }

            for(var px = center.x - rx - 1; px <= center.x + rx + 1; ++px) {
                for(var py = center.y - ry - 1; py <= center.y + ry + 1; ++py) {
                    if(cells.length >= targetCount)
                        break;
                    if(this.IsLiveTerrainProtectedCell(pContext, px, py, pProtectedPoints, pArchetype === "quicksand_field" ? 3 : 4))
                        continue;
                    if(this.HasLiveTerrainLayerNear(layers.water, px, py, 1))
                        continue;
                    if(minBeachDistance > 0 && this.HasLiveTerrainLayerNear(layers.coast, px, py, minBeachDistance))
                        continue;

                    var nx = (px - center.x) / Math.max(1, rx);
                    var ny = (py - center.y) / Math.max(1, ry);
                    var noise = ((MapGen.Random.HashTile(pContext.Seed, px, py, 797) % 100) / 100) * 0.18;
                    if((nx * nx) + (ny * ny) + noise > 1)
                        continue;

                    if(this.SetLiveQuicksandCell(pContext, px, py, cells, seen))
                        ++patchCells;
                }
            }

            patches.push({ center: center, radius: { x: rx, y: ry }, cells: patchCells });
        }

        return {
            cells: cells,
            patches: patches,
            count: cells.length,
            target: targetCount,
            smootherSinkingReserve: 0
        };
    },

    BuildLiveDynamicTerrainCells: function(pContext, pWaterInfo, pBeach, pQuicksand, pProtectedPoints) {
        var plan = pContext.GrammarPlan && pContext.GrammarPlan.dynamicTerrainPlan ?
            pContext.GrammarPlan.dynamicTerrainPlan : {};
        var swapPairs = plan.swapPairs || [];
        var planned = Number(plan.plannedSwapTileCount || plan.swapTileTarget || 0);
        var areaTarget = Math.max(4, Math.round((pContext.Width * pContext.Height) * 0.0015));
        var target = Math.max(4, Math.round(planned || areaTarget));
        var cells = [];
        var seen = {};
        var walkable = 0;
        var blocked = 0;
        var sinking = 0;
        var walkableSwap = {
            245: true, 246: true, 265: true, 266: true, 285: true,
            286: true, 305: true, 306: true, 390: true, 391: true
        };
        var nonWalkableSwap = {
            98: true, 177: true, 217: true, 352: true, 353: true,
            354: true, 372: true, 373: true, 374: true
        };
        var isGrammarBeach =
            pContext.Profile &&
            pContext.Profile.TargetPackProfile === "grammar_beach";
        var self = this;

        function targetFraction(pClassName, pFallback) {
            var targets = pContext.Profile && pContext.Profile.TargetPack ?
                pContext.Profile.TargetPack.targets || {} : {};
            var terrain = targets.composition && targets.composition.terrainComposition ?
                targets.composition.terrainComposition : {};
            var stats = terrain.passabilityFractions ? terrain.passabilityFractions[pClassName] : null;
            var range = stats ? stats.targetRange || stats.wideRange || null : null;
            var low = range && range.length > 1 ? Number(range[0]) : NaN;
            var high = range && range.length > 1 ? Number(range[1]) : NaN;

            if(isFinite(low) && isFinite(high))
                return (low + high) / 2;

            return pFallback;
        }

        function targetFractionUpper(pClassName, pFallback) {
            var targets = pContext.Profile && pContext.Profile.TargetPack ?
                pContext.Profile.TargetPack.targets || {} : {};
            var terrain = targets.composition && targets.composition.terrainComposition ?
                targets.composition.terrainComposition : {};
            var stats = terrain.passabilityFractions ? terrain.passabilityFractions[pClassName] : null;
            var range = stats ? stats.targetRange || stats.wideRange || null : null;
            var high = range && range.length > 1 ? Number(range[1]) : NaN;

            if(isFinite(high))
                return high;

            return pFallback;
        }

        function targetFractionLower(pClassName, pFallback) {
            var targets = pContext.Profile && pContext.Profile.TargetPack ?
                pContext.Profile.TargetPack.targets || {} : {};
            var terrain = targets.composition && targets.composition.terrainComposition ?
                targets.composition.terrainComposition : {};
            var stats = terrain.passabilityFractions ? terrain.passabilityFractions[pClassName] : null;
            var range = stats ? stats.targetRange || stats.wideRange || null : null;
            var low = range && range.length > 1 ? Number(range[0]) : NaN;

            if(isFinite(low))
                return low;

            return pFallback;
        }

        function visualTargetFraction(pClassName, pFallback) {
            var targets = pContext.Profile && pContext.Profile.TargetPack ?
                pContext.Profile.TargetPack.targets || {} : {};
            var terrain = targets.composition && targets.composition.terrainComposition ?
                targets.composition.terrainComposition : {};
            var stats = terrain.visualFractions ? terrain.visualFractions[pClassName] : null;
            var range = stats ? stats.targetRange || stats.wideRange || null : null;
            var low = range && range.length > 1 ? Number(range[0]) : NaN;
            var high = range && range.length > 1 ? Number(range[1]) : NaN;

            if(isFinite(low) && isFinite(high))
                return (low + high) / 2;

            return pFallback;
        }

        function visualTargetFractionLower(pClassName, pFallback) {
            var targets = pContext.Profile && pContext.Profile.TargetPack ?
                pContext.Profile.TargetPack.targets || {} : {};
            var terrain = targets.composition && targets.composition.terrainComposition ?
                targets.composition.terrainComposition : {};
            var stats = terrain.visualFractions ? terrain.visualFractions[pClassName] : null;
            var range = stats ? stats.targetRange || stats.wideRange || null : null;
            var low = range && range.length > 1 ? Number(range[0]) : NaN;

            if(isFinite(low))
                return low;

            return pFallback;
        }

        function dynamicTargetLower(pMetricName, pFallback) {
            var targets = pContext.Profile && pContext.Profile.TargetPack ?
                pContext.Profile.TargetPack.targets || {} : {};
            var dynamicTerrain = targets.dynamicTerrain || {};
            var stats = dynamicTerrain[pMetricName] || null;
            var range = stats ? stats.targetRange || stats.wideRange || null : null;
            var low = range && range.length > 1 ? Number(range[0]) : NaN;

            if(isFinite(low))
                return low;

            return pFallback;
        }

        function cellKind(pPair) {
            var passability = String(pPair.sourcePassability || "");
            var visual = String(pPair.sourceVisual || "");

            if(nonWalkableSwap[Number(pPair.sourceTileId)] ||
                passability === "blocked" || passability === "drop" ||
                passability === "mixed_block" || visual === "building")
                return "blocked";

            return "walkable";
        }

        function allowed(pX, pY, pKind, pRequireQuicksand) {
            var layers = pContext.Layers || {};

            if(pX <= 1 || pY <= 1 || pX >= pContext.Width - 2 || pY >= pContext.Height - 2)
                return false;
            if(MapGen.Layers.Get(layers.water, pX, pY, 0) ||
                MapGen.Layers.Get(layers.path, pX, pY, 0) ||
                MapGen.Layers.Get(layers.crossing, pX, pY, 0) ||
                MapGen.Layers.Get(layers.structureGround, pX, pY, 0))
                return false;
            if(pKind !== "building" &&
                (MapGen.Layers.Get(layers.keepClear, pX, pY, 0) ||
                    MapGen.Layers.Get(layers.occupied, pX, pY, 0)))
                return false;

            if(pRequireQuicksand)
                return !!MapGen.Layers.Get(layers.riverBank, pX, pY, 0);

            if(MapGen.Layers.Get(layers.coast, pX, pY, 0) ||
                MapGen.Layers.Get(layers.riverBank, pX, pY, 0))
                return false;

            return true;
        }

        function reserveRecordedCell(pX, pY, pKind) {
            var layers = pContext.Layers || {};

            if(pKind === "blocked" || pKind === "building")
                return;

            if(layers.blocked)
                MapGen.Layers.Set(layers.blocked, pX, pY, 0);
            if(layers.perimeterCover)
                MapGen.Layers.Set(layers.perimeterCover, pX, pY, 0);
        }

        function record(pX, pY, pTileId, pKind, pSource, pPair, pOptions) {
            var key = self.LiveTerrainCellKey(pX, pY);
            var tileId = Number(pTileId);
            var options = pOptions || {};

            if(seen[key] || isNaN(tileId))
                return false;
            if(pContext.Profile && pContext.Profile.TargetPackProfile === "grammar_beach" && tileId === 383)
                return false;
            seen[key] = true;
            reserveRecordedCell(pX, pY, pKind);
            cells.push({
                x: pX,
                y: pY,
                tileId: tileId,
                kind: pKind,
                source: pSource,
                dynamicPairId: pPair ? pPair.id || null : null,
                targetTileId: pPair ? pPair.targetTileId : undefined,
                allowAuthoredTerrain: options.allowAuthoredTerrain === true
            });

            if(walkableSwap[tileId])
                ++walkable;
            else if(nonWalkableSwap[tileId])
                ++blocked;
            else if(pKind === "sinking")
                ++sinking;

            return true;
        }

        function candidateOffsets(pCenter, pCount, pSalt, pShape) {
            var radius = Math.max(2, Math.min(6, Math.ceil(Math.sqrt(Math.max(1, pCount))) + 1));
            var candidates = [];

            if(pShape === "gate_band_across_route")
                radius = Math.max(radius, 4);

            for(var dx = -radius; dx <= radius; ++dx) {
                for(var dy = -radius; dy <= radius; ++dy) {
                    if(dx === 0 && dy === 0 && pShape !== "structure_or_objective_state_cluster")
                        continue;
                    if((Math.abs(dx) + Math.abs(dy)) > radius + 2)
                        continue;
                    candidates.push({
                        x: pCenter.x + dx,
                        y: pCenter.y + dy,
                        dist: (dx * dx) + (dy * dy),
                        tie: MapGen.Random.HashTile(pContext.Seed, pCenter.x + dx, pCenter.y + dy, pSalt)
                    });
                }
            }

            candidates.sort(function(pLeft, pRight) {
                if(pLeft.dist !== pRight.dist)
                    return pLeft.dist - pRight.dist;
                if(pLeft.tie !== pRight.tie)
                    return pLeft.tie - pRight.tie;
                // Total-order tiebreak on unique cell coords (HashTile ties can
                // collide; the engine's Array.sort is unstable).
                if(pLeft.x !== pRight.x)
                    return pLeft.x - pRight.x;
                return pLeft.y - pRight.y;
            });

            return candidates;
        }

        function placePair(pPair, pIndex) {
            var center = pPair.point || pPair.anchorPoint;
            var tileId = Number(pPair.sourceTileId);
            var want = Math.max(1, Math.round(Number(pPair.tileCount || 1)));
            var kind = cellKind(pPair);
            var candidates;
            var placed = 0;

            if(!center || isNaN(tileId))
                return 0;
            if(String(pPair.sourceVisual || "") === "building")
                return 0;

            center = { x: Math.round(center.x), y: Math.round(center.y) };
            candidates = candidateOffsets(center, want, 3301 + pIndex, pPair.shape || "");

            for(var index = 0; index < candidates.length && placed < want; ++index) {
                var candidate = candidates[index];
                if(!allowed(candidate.x, candidate.y, kind, false))
                    continue;
                if(record(candidate.x, candidate.y, tileId, kind, "dynamicTerrainPlan.swapPairs", pPair))
                    ++placed;
            }

            return placed;
        }

        function collectBuildingAnchors() {
            var anchors = [];
            var objective = pContext.GrammarPlan && pContext.GrammarPlan.objectivePlan ?
                pContext.GrammarPlan.objectivePlan : {};
            var doors = objective.doors || [];
            var roofs = objective.roofs || [];
            var named = pContext.Anchors || {};
            var index;

            for(index = 0; index < doors.length; ++index) {
                if(doors[index].point)
                    anchors.push(doors[index].point);
            }
            for(index = 0; index < roofs.length; ++index) {
                if(roofs[index].point)
                    anchors.push(roofs[index].point);
            }
            if(named.objective)
                anchors.push(named.objective);
            if(named.support)
                anchors.push(named.support);
            if(named.start)
                anchors.push(named.start);

            return anchors;
        }

        function placePattern(pOrigin, pPattern, pSource) {
            var index;

            for(index = 0; index < pPattern.length; ++index) {
                var test = pPattern[index];
                if(!allowed(pOrigin.x + test.x, pOrigin.y + test.y, "building", false))
                    return 0;
                if(seen[self.LiveTerrainCellKey(pOrigin.x + test.x, pOrigin.y + test.y)])
                    return 0;
            }

            for(index = 0; index < pPattern.length; ++index) {
                var part = pPattern[index];
                record(
                    pOrigin.x + part.x,
                    pOrigin.y + part.y,
                    part.tileId,
                    "building",
                    pSource,
                    null
                );
            }

            return pPattern.length;
        }

        function placeSub1BuildingStamps() {
            var targetCells = Math.round((pContext.Width * pContext.Height) * visualTargetFraction("building", 0.0083));
            var anchors = collectBuildingAnchors();
            var full = [
                { x: 1, y: 0, tileId: 333 }, { x: 2, y: 0, tileId: 334 },
                { x: 0, y: 1, tileId: 352 }, { x: 1, y: 1, tileId: 353 }, { x: 2, y: 1, tileId: 354 },
                { x: 0, y: 2, tileId: 372 }, { x: 1, y: 2, tileId: 373 }, { x: 2, y: 2, tileId: 374 }, { x: 3, y: 2, tileId: 375 },
                { x: 0, y: 3, tileId: 392 }, { x: 1, y: 3, tileId: 393 }, { x: 2, y: 3, tileId: 394 }
            ];
            var detail = [
                { x: 1, y: 0, tileId: 333 }, { x: 2, y: 0, tileId: 334 },
                { x: 3, y: 1, tileId: 375 },
                { x: 0, y: 2, tileId: 392 }, { x: 1, y: 2, tileId: 393 }, { x: 2, y: 2, tileId: 394 }
            ];
            var placed = 0;
            var fullStamps = 0;
            var anchorIndex;

            for(anchorIndex = 0; anchorIndex < anchors.length && placed < targetCells; ++anchorIndex) {
                var anchor = {
                    x: Math.round(anchors[anchorIndex].x) - 1,
                    y: Math.round(anchors[anchorIndex].y) - 1
                };
                var candidates = candidateOffsets(anchor, 12, 3501 + anchorIndex, "structure_or_objective_state_cluster");
                var candidateIndex;

                for(candidateIndex = 0; candidateIndex < candidates.length && placed < targetCells; ++candidateIndex) {
                    var origin = candidates[candidateIndex];
                    var pattern = fullStamps < 1 ? full : detail;
                    var count = placePattern(origin, pattern, fullStamps < 1 ? "sub1_building_stamp" : "sub1_building_detail");
                    if(count > 0) {
                        placed += count;
                        if(pattern === full)
                            ++fullStamps;
                    }
                }
            }

            return placed;
        }

        function collectDetailAnchors() {
            var anchors = collectBuildingAnchors();
            var paths = pContext.Paths || [];
            var pathIndex;

            for(pathIndex = 0; pathIndex < paths.length; ++pathIndex) {
                var points = paths[pathIndex].points || [];
                var stride = Math.max(6, Math.floor(points.length / 8));
                for(var pointIndex = 0; pointIndex < points.length; pointIndex += stride)
                    anchors.push(points[pointIndex]);
            }

            if(pQuicksand && pQuicksand.patches) {
                for(var patchIndex = 0; patchIndex < pQuicksand.patches.length; ++patchIndex) {
                    if(pQuicksand.patches[patchIndex].center)
                        anchors.push(pQuicksand.patches[patchIndex].center);
                }
            }

            if(pBeach && pBeach.centers) {
                for(var beachIndex = 0; beachIndex < pBeach.centers.length; ++beachIndex)
                    anchors.push(pBeach.centers[beachIndex]);
            }
            else if(pBeach && pBeach.center) {
                anchors.push(pBeach.center);
            }

            if(!anchors.length && pContext.Anchors && pContext.Anchors.objective)
                anchors.push(pContext.Anchors.objective);

            return anchors;
        }

        function hasLayerNear(pLayer, pX, pY, pRadius) {
            return self.HasLiveTerrainLayerNear(pLayer, pX, pY, pRadius);
        }

        function isShoreContext(pX, pY, pWaterRadius, pCoastRadius) {
            var layers = pContext.Layers || {};

            return hasLayerNear(layers.water, pX, pY, pWaterRadius || 2) &&
                hasLayerNear(layers.coast, pX, pY, pCoastRadius || 2);
        }

        function isQuicksandBorderContext(pX, pY, pMinRadius, pMaxRadius) {
            var layers = pContext.Layers || {};
            var minRadius = Math.max(0, Math.floor(pMinRadius || 1));
            var maxRadius = Math.max(minRadius, Math.floor(pMaxRadius || 3));

            return !MapGen.Layers.Get(layers.riverBank, pX, pY, 0) &&
                hasLayerNear(layers.riverBank, pX, pY, maxRadius) &&
                (minRadius <= 0 || !hasLayerNear(layers.riverBank, pX, pY, minRadius - 1));
        }

        function collectCellsNearList(pCells, pMinRadius, pMaxRadius, pSalt, pFilter) {
            var candidates = [];
            var candidateSeen = {};
            var list = pCells || [];
            var minRadius = Math.max(0, Math.floor(pMinRadius || 0));
            var maxRadius = Math.max(minRadius, Math.floor(pMaxRadius || minRadius));

            for(var index = 0; index < list.length; ++index) {
                var origin = list[index];
                var ox = Math.round(origin.x);
                var oy = Math.round(origin.y);

                for(var dx = -maxRadius; dx <= maxRadius; ++dx) {
                    for(var dy = -maxRadius; dy <= maxRadius; ++dy) {
                        var distance = Math.max(Math.abs(dx), Math.abs(dy));
                        var x;
                        var y;
                        var key;

                        if(distance < minRadius || distance > maxRadius)
                            continue;

                        x = ox + dx;
                        y = oy + dy;
                        key = self.LiveTerrainCellKey(x, y);
                        if(candidateSeen[key])
                            continue;
                        if(pFilter && !pFilter(x, y))
                            continue;

                        candidateSeen[key] = true;
                        candidates.push({
                            x: x,
                            y: y,
                            distance: (dx * dx) + (dy * dy),
                            tie: MapGen.Random.HashTile(pContext.Seed, x, y, pSalt)
                        });
                    }
                }
            }

            candidates.sort(function(pLeft, pRight) {
                if(pLeft.distance !== pRight.distance)
                    return pLeft.distance - pRight.distance;
                if(pLeft.tie !== pRight.tie)
                    return pLeft.tie - pRight.tie;
                // Total-order tiebreak on unique cell coords (HashTile ties can
                // collide; the engine's Array.sort is unstable).
                if(pLeft.x !== pRight.x)
                    return pLeft.x - pRight.x;
                return pLeft.y - pRight.y;
            });

            return candidates;
        }

        function canPlaceStyleCell(pX, pY, pKind, pOptions) {
            var layers = pContext.Layers || {};
            var options = pOptions || {};

            if(options.allowAuthoredTerrain === true) {
                if(pX <= 1 || pY <= 1 || pX >= pContext.Width - 2 || pY >= pContext.Height - 2)
                    return false;
                if(MapGen.Layers.Get(layers.water, pX, pY, 0) ||
                    MapGen.Layers.Get(layers.path, pX, pY, 0) ||
                    MapGen.Layers.Get(layers.crossing, pX, pY, 0) ||
                    MapGen.Layers.Get(layers.structureGround, pX, pY, 0) ||
                    MapGen.Layers.Get(layers.keepClear, pX, pY, 0) ||
                    MapGen.Layers.Get(layers.occupied, pX, pY, 0))
                    return false;
                if((pKind === "blocked" || pKind === "building") &&
                    (MapGen.Layers.Get(layers.coast, pX, pY, 0) ||
                        MapGen.Layers.Get(layers.riverBank, pX, pY, 0)))
                    return false;

                return true;
            }

            return allowed(pX, pY, pKind, false);
        }

        function placeCandidates(pCandidates, pTilePool, pTargetCount, pKind, pSource, pSalt, pOptions) {
            var placed = 0;
            var candidates = pCandidates || [];
            var options = pOptions || {};

            if(!pTilePool.length || pTargetCount <= 0)
                return 0;

            for(var index = 0; index < candidates.length && placed < pTargetCount; ++index) {
                var candidate = candidates[index];
                var tileId = pTilePool[MapGen.Random.HashTile(pContext.Seed, candidate.x, candidate.y, pSalt + 13) % pTilePool.length];

                if(!canPlaceStyleCell(candidate.x, candidate.y, pKind, options))
                    continue;
                if(record(candidate.x, candidate.y, tileId, pKind, pSource, null, options))
                    ++placed;
            }

            return placed;
        }

        function patternCandidatesFromAnchors(pAnchors, pRadius, pSalt, pFilter) {
            var candidates = [];
            var candidateSeen = {};
            var anchors = pAnchors || [];
            var radius = Math.max(1, Math.floor(pRadius || 4));

            for(var anchorIndex = 0; anchorIndex < anchors.length; ++anchorIndex) {
                var anchor = anchors[anchorIndex];
                if(!anchor)
                    continue;

                var center = { x: Math.round(anchor.x), y: Math.round(anchor.y) };
                var offsets = candidateOffsets(center, radius * 2, pSalt + anchorIndex, "structure_or_objective_state_cluster");

                for(var offsetIndex = 0; offsetIndex < offsets.length; ++offsetIndex) {
                    var origin = offsets[offsetIndex];
                    var key = self.LiveTerrainCellKey(origin.x, origin.y);

                    if(candidateSeen[key])
                        continue;
                    if(pFilter && !pFilter(origin.x, origin.y))
                        continue;

                    candidateSeen[key] = true;
                    candidates.push({
                        x: origin.x,
                        y: origin.y,
                        distance: offsets[offsetIndex].dist || 0,
                        tie: MapGen.Random.HashTile(pContext.Seed, origin.x, origin.y, pSalt)
                    });
                }
            }

            candidates.sort(function(pLeft, pRight) {
                if(pLeft.distance !== pRight.distance)
                    return pLeft.distance - pRight.distance;
                if(pLeft.tie !== pRight.tie)
                    return pLeft.tie - pRight.tie;
                // Total-order tiebreak on unique cell coords (HashTile ties can
                // collide; the engine's Array.sort is unstable).
                if(pLeft.x !== pRight.x)
                    return pLeft.x - pRight.x;
                return pLeft.y - pRight.y;
            });

            return candidates;
        }

        function placePatternInstances(pOrigins, pPattern, pTargetInstances, pKind, pSource, pOptions) {
            var placedCells = 0;
            var instances = 0;
            var options = pOptions || {};

            if(!pPattern.length || pTargetInstances <= 0)
                return 0;

            for(var originIndex = 0; originIndex < pOrigins.length && instances < pTargetInstances; ++originIndex) {
                var origin = pOrigins[originIndex];
                var canPlace = true;
                var partIndex;

                for(partIndex = 0; partIndex < pPattern.length; ++partIndex) {
                    var test = pPattern[partIndex];
                    var tx = origin.x + test.x;
                    var ty = origin.y + test.y;

                    if(seen[self.LiveTerrainCellKey(tx, ty)] ||
                        !canPlaceStyleCell(tx, ty, pKind, options)) {
                        canPlace = false;
                        break;
                    }
                }

                if(!canPlace)
                    continue;

                for(partIndex = 0; partIndex < pPattern.length; ++partIndex) {
                    var part = pPattern[partIndex];
                    if(record(origin.x + part.x, origin.y + part.y, part.tileId, pKind, pSource, null, options))
                        ++placedCells;
                }

                ++instances;
            }

            return placedCells;
        }

        function placeDetailCells(pTilePool, pTargetCount, pSource, pSalt, pKind) {
            var anchors = collectDetailAnchors();
            var placed = 0;
            var anchorIndex = 0;
            var guard = 0;
            var kind = pKind || "detail";

            if(!pTilePool.length || pTargetCount <= 0 || !anchors.length)
                return 0;

            while(placed < pTargetCount && guard < pTargetCount * 80) {
                var anchor = anchors[anchorIndex % anchors.length];
                var radius = 3 + (guard % 9);
                var x = Math.round(anchor.x) - radius +
                    (MapGen.Random.HashTile(pContext.Seed, guard, anchorIndex, pSalt) % ((radius * 2) + 1));
                var y = Math.round(anchor.y) - radius +
                    (MapGen.Random.HashTile(pContext.Seed, anchorIndex, guard, pSalt + 7) % ((radius * 2) + 1));
                var tileId = pTilePool[MapGen.Random.HashTile(pContext.Seed, x, y, pSalt + 13) % pTilePool.length];

                ++guard;
                ++anchorIndex;

                if(!allowed(x, y, kind, false))
                    continue;
                if(record(x, y, tileId, kind, pSource, null))
                    ++placed;
            }

            return placed;
        }

        function placeSub1TerrainDetails() {
            var area = pContext.Width * pContext.Height;
            var roughTarget = Math.round(area * targetFractionUpper("rough", 0.01082) * 0.74);
            var blockedDecorTarget = 0;
            var slowGroundTarget = 0;
            var otherTarget = 0;

            return {
                rough: placeDetailCells([31, 32, 52, 56, 96, 97, 199, 349], roughTarget, "sub1_rough_detail", 3601),
                blockedDecor: placeDetailCells([17, 37, 58, 70, 71, 80, 81, 82, 101, 103, 105, 106, 126, 143, 158, 160, 161, 162, 164, 179, 180, 182, 200, 201, 220, 221], blockedDecorTarget, "sub1_blocked_decor_detail", 3781),
                slowGround: placeDetailCells([30, 181], slowGroundTarget, "sub1_slow_ground_detail", 3951),
                other: placeDetailCells([156, 175], otherTarget, "sub1_other_detail", 4001)
            };
        }

        function placeSub1ShapedStyleDetails() {
            var area = pContext.Width * pContext.Height;
            var layers = pContext.Layers || {};
            var beachCells = pBeach && pBeach.cells ? pBeach.cells : [];
            var waterCells = pWaterInfo && pWaterInfo.waterPoints ? pWaterInfo.waterPoints : [];
            var quicksandCells = pQuicksand && pQuicksand.cells ? pQuicksand.cells : [];
            var anchors = collectDetailAnchors();
            var mixedHazardPool = [39, 76, 88, 94, 310, 311, 330, 331, 351, 371];
            var mixedBlockPool = [36, 57, 125, 159, 178];
            var softHazardPool = [79, 168, 186, 188, 206, 207, 226];
            var landBlendPool = [0, 18, 19, 20, 38, 40, 47, 48, 49, 59, 67, 68, 69, 78, 87, 108, 127, 128, 165, 185, 205, 209, 210, 228, 229];
            var roughPool = [31, 32, 52, 56, 96, 97, 199];
            var slowGroundPool = [30, 181];
            var decorPool = [17, 37, 58, 70, 71, 80, 81, 82, 101, 103, 105, 106, 126, 143, 158, 160, 161, 162, 164, 179, 180, 182, 200, 201, 220, 221];
            var otherPool = [377, 398];
            // Tiles 313/314 are the authored mapm8 slope/drop pair, not loose
            // beach detail. Keep them out of generic scattering until a
            // contextual pair stamp can place the full ledge shape.
            var dropPool = [];
            var walkableSwapPattern = [
                { x: 0, y: 0, tileId: 265 }, { x: 1, y: 0, tileId: 266 },
                { x: 0, y: 1, tileId: 305 }, { x: 1, y: 1, tileId: 306 }
            ];
            var nonWalkableSwapPattern = [
                { x: 0, y: 0, tileId: 352 }, { x: 1, y: 0, tileId: 353 }, { x: 2, y: 0, tileId: 354 },
                { x: 0, y: 1, tileId: 372 }, { x: 1, y: 1, tileId: 373 }, { x: 2, y: 1, tileId: 374 }
            ];
            var largeMapStyleScale = area >= 5000 ? 1.0 : 0.0;
            var quicksandHazardTarget = Math.round(area * targetFraction("mixed_hazard", 0.00667) * 1.30);
            var mixedBlockTarget = Math.round(area * targetFraction("mixed_block", 0.03604) * (0.35 + (largeMapStyleScale * 0.20)));
            var softHazardTarget = Math.round(area * targetFraction("soft_hazard", 0.01535) * (0.65 + (largeMapStyleScale * 0.35)));
            var dropTarget = 0;
            var roughTarget = Math.max(0, Math.round(area * targetFractionLower("rough", 0.00678) * (0.95 + (largeMapStyleScale * 0.10))));
            var slowGroundTarget = area >= 5000 ?
                Math.round(area * targetFraction("slow_ground", 0.02479) * 0.38) : 0;
            var decorTarget = Math.round(area * visualTargetFractionLower("decor", 0.03740) * (0.95 + (largeMapStyleScale * 2.05)));
            var otherTarget = Math.max(3, Math.round(area * visualTargetFractionLower("other", 0.00057) * 1.35));
            var landBlendTarget = area < 5000 ? Math.round(area * 0.021) : 0;
            var swapTileLowerTarget = Math.ceil(dynamicTargetLower("swapTileCount", 15));
            var walkableSwapLowerTarget = Math.ceil(dynamicTargetLower("breakableWalkableTileCount", 7));
            function isBackshoreDetailContext(pX, pY) {
                return !hasLayerNear(layers.water, pX, pY, 1) &&
                    !hasLayerNear(layers.coast, pX, pY, 1);
            }

            var backshoreCandidates = collectCellsNearList(beachCells, 1, 10, 4321, function(pX, pY) {
                return !MapGen.Layers.Get(layers.coast, pX, pY, 0) &&
                    isBackshoreDetailContext(pX, pY) &&
                    isShoreContext(pX, pY, 10, 8);
            });
            var quicksandBorderCandidates = collectCellsNearList(quicksandCells, 1, 5, 4331, function(pX, pY) {
                return isQuicksandBorderContext(pX, pY, 1, 5);
            });
            var dropCandidates = collectCellsNearList(quicksandCells, 2, 6, 4337, function(pX, pY) {
                return isQuicksandBorderContext(pX, pY, 2, 6);
            });
            var beachClusterCandidates = collectCellsNearList(beachCells.length ? beachCells : waterCells, 2, 9, 4341, function(pX, pY) {
                return isBackshoreDetailContext(pX, pY) &&
                    isShoreContext(pX, pY, 10, 8);
            });
            var anchorClusterCandidates = patternCandidatesFromAnchors(anchors, 6, 4351, function(pX, pY) {
                return isBackshoreDetailContext(pX, pY) &&
                    (hasLayerNear(layers.coast, pX, pY, 10) ||
                        hasLayerNear(layers.riverBank, pX, pY, 5));
            });
            var walkableSwapInstances = Math.min(
                2,
                Math.ceil(Math.max(0, walkableSwapLowerTarget - walkable) / Math.max(1, walkableSwapPattern.length))
            );
            var results = {
                mixedWaterBeach: 0,
                mixedWaterBackshore: 0,
                mixedHazard: 0,
                mixedBlock: 0,
                softHazard: 0,
                landBlend: 0,
                drop: 0,
                rough: 0,
                decor: 0,
                other: 0,
                slowGround: 0,
                walkableSwap: 0,
                nonWalkableSwap: 0
            };

            results.slowGround = placeCandidates(
                beachClusterCandidates.concat(backshoreCandidates),
                slowGroundPool,
                slowGroundTarget,
                "detail",
                "sub1_beach_slow_ground_dune_clusters",
                4407
            );
            results.landBlend = placeCandidates(
                beachClusterCandidates.concat(backshoreCandidates).concat(anchorClusterCandidates),
                landBlendPool,
                landBlendTarget,
                "detail",
                "sub1_beach_land_buffer_blend",
                4393
            );
            results.drop = placeCandidates(
                dropCandidates.concat(beachClusterCandidates),
                dropPool,
                dropTarget,
                "detail",
                "sub1_beach_drop_clusters",
                4391
            );
            results.mixedHazard = placeCandidates(
                quicksandBorderCandidates,
                mixedHazardPool,
                quicksandHazardTarget,
                "detail",
                "sub1_quicksand_mixed_hazard_border",
                4381
            );
            results.mixedBlock = placeCandidates(
                beachClusterCandidates.concat(anchorClusterCandidates),
                mixedBlockPool,
                mixedBlockTarget,
                "detail",
                "sub1_beach_mixed_block_clusters",
                4387
            );
            results.softHazard = placeCandidates(
                quicksandBorderCandidates.concat(beachClusterCandidates),
                softHazardPool,
                softHazardTarget,
                "detail",
                "sub1_quicksand_soft_hazard_apron",
                4389
            );
            results.rough = placeCandidates(
                beachClusterCandidates.concat(anchorClusterCandidates),
                roughPool,
                roughTarget,
                "detail",
                "sub1_beach_rough_clusters",
                4401
            );
            results.decor = placeCandidates(
                anchorClusterCandidates.concat(beachClusterCandidates),
                decorPool,
                decorTarget,
                "blocked",
                "sub1_beach_decor_clusters",
                4411
            );
            results.other = placeCandidates(
                beachClusterCandidates.concat(anchorClusterCandidates),
                otherPool,
                otherTarget,
                "detail",
                "sub1_beach_other_clusters",
                4421
            );
            results.walkableSwap = placePatternInstances(
                beachClusterCandidates.concat(anchorClusterCandidates),
                walkableSwapPattern,
                walkableSwapInstances,
                "walkable",
                "sub1_walkable_bridge_swp_motif",
                { allowAuthoredTerrain: true }
            );
            var nonWalkableSwapInstances = 1 +
                (swapTileLowerTarget > 0 && (walkable + blocked) < swapTileLowerTarget ? 1 : 0);
            results.nonWalkableSwap = placePatternInstances(
                anchorClusterCandidates.concat(beachClusterCandidates),
                nonWalkableSwapPattern,
                Math.min(2, nonWalkableSwapInstances),
                "building",
                "sub1_nonwalkable_swp_motif"
            );

            return results;
        }

        var buildingCells = isGrammarBeach ? 0 : placeSub1BuildingStamps();

        if(!isGrammarBeach) {
            for(var pairIndex = 0; pairIndex < swapPairs.length; ++pairIndex)
                placePair(swapPairs[pairIndex], pairIndex);
        }

        var detailCells = isGrammarBeach ?
            { rough: 0, blockedDecor: 0, slowGround: 0, other: 0 } :
            placeSub1TerrainDetails();
        var shapedStyleDetails = isGrammarBeach ?
            {
                mixedWaterBeach: 0,
                mixedWaterBackshore: 0,
                mixedHazard: 0,
                mixedBlock: 0,
                softHazard: 0,
                landBlend: 0,
                drop: 0,
                rough: 0,
                decor: 0,
                other: 0,
                slowGround: 0,
                walkableSwap: 0,
                nonWalkableSwap: 0
            } :
            placeSub1ShapedStyleDetails();

        var quicksandCells = pQuicksand && pQuicksand.cells ? pQuicksand.cells : [];
        var sinkingTarget = Math.max(
            0,
            Math.round((pContext.Width * pContext.Height) * targetFraction("sinking_ground", 0.03244)) -
                Math.max(0, Number(pQuicksand && pQuicksand.smootherSinkingReserve || 0))
        );
        var sinkingCandidates = [];

        for(var quickIndex = 0; quickIndex < quicksandCells.length; ++quickIndex) {
            var quick = quicksandCells[quickIndex];
            sinkingCandidates.push({
                x: quick.x,
                y: quick.y,
                tie: MapGen.Random.HashTile(pContext.Seed, quick.x, quick.y, 3401)
            });
        }

        sinkingCandidates.sort(function(pLeft, pRight) {
            if(pLeft.tie !== pRight.tie)
                return pLeft.tie - pRight.tie;
            // Total-order tiebreak on unique cell coords (HashTile ties can
            // collide; the engine's Array.sort is unstable).
            if(pLeft.x !== pRight.x)
                return pLeft.x - pRight.x;
            return pLeft.y - pRight.y;
        });

        for(var sinkIndex = 0; sinkIndex < sinkingCandidates.length && sinking < sinkingTarget; ++sinkIndex) {
            var sink = sinkingCandidates[sinkIndex];
            if(!allowed(sink.x, sink.y, "sinking", true))
                continue;
            record(
                sink.x,
                sink.y,
                (MapGen.Random.HashTile(pContext.Seed, sink.x, sink.y, 3411) & 1) ? 107 : 167,
                "sinking",
                "quicksand_sinking_ground",
                null
            );
        }

        return {
            cells: cells,
            target: target,
            walkable: walkable,
            blocked: blocked,
            sinking: sinking,
            building: buildingCells,
            details: detailCells,
            shapedStyleDetails: shapedStyleDetails,
            sinkingTarget: sinkingTarget,
            deferred: false,
            sourcePairs: swapPairs.length
        };
    },

    IsLiveQuicksandCellStillSafe: function(pContext, pX, pY) {
        var layers = pContext ? pContext.Layers || {} : {};

        if(!layers.riverBank || !MapGen.Layers.InBounds(layers.riverBank, pX, pY))
            return false;

        return !(MapGen.Layers.Get(layers.water, pX, pY, 0) ||
            MapGen.Layers.Get(layers.coast, pX, pY, 0) ||
            MapGen.Layers.Get(layers.path, pX, pY, 0) ||
            MapGen.Layers.Get(layers.crossing, pX, pY, 0) ||
            MapGen.Layers.Get(layers.occupied, pX, pY, 0) ||
            MapGen.Layers.Get(layers.keepClear, pX, pY, 0) ||
            MapGen.Layers.Get(layers.structureGround, pX, pY, 0) ||
            this.HasLiveTerrainLayerNear(layers.coast, pX, pY, this.LiveQuicksandBeachMinDistance(pContext)));
    },

    SinkingTileIdForCell: function(pContext, pX, pY) {
        return (MapGen.Random.HashTile(pContext.Seed, pX, pY, 3411) & 1) ? 107 : 167;
    },

    ExpandLiveQuicksandSafeCells: function(pContext, pSafeCells, pSafeLookup, pSourceCells, pTargetCount) {
        var candidates = [];
        var candidateSeen = {};
        var dynamicUsed = {};
        var live = pContext && pContext.GrammarLiveTerrain ? pContext.GrammarLiveTerrain : null;
        var dynamicCells = live && live.dynamicCells ? live.dynamicCells : [];
        var added = 0;
        var targetCount = Math.max(0, Math.round(Number(pTargetCount || 0)));
        var usableSafeCount = 0;

        for(var dynamicIndex = 0; dynamicIndex < dynamicCells.length; ++dynamicIndex) {
            var dynamicCell = dynamicCells[dynamicIndex];
            if(dynamicCell.kind === "sinking")
                continue;
            dynamicUsed[this.LiveTerrainCellKey(Math.round(dynamicCell.x), Math.round(dynamicCell.y))] = true;
        }

        for(var safeIndex = 0; safeIndex < pSafeCells.length; ++safeIndex) {
            if(!dynamicUsed[this.LiveTerrainCellKey(pSafeCells[safeIndex].x, pSafeCells[safeIndex].y)])
                ++usableSafeCount;
        }

        if(usableSafeCount >= targetCount)
            return 0;

        for(var sourceIndex = 0; sourceIndex < pSourceCells.length; ++sourceIndex) {
            var source = pSourceCells[sourceIndex];
            var sx = Math.round(source.x);
            var sy = Math.round(source.y);

            for(var radius = 1; radius <= 12; ++radius) {
                for(var dx = -radius; dx <= radius; ++dx) {
                    for(var dy = -radius; dy <= radius; ++dy) {
                        if((Math.abs(dx) + Math.abs(dy)) > radius + 1)
                            continue;

                        var x = sx + dx;
                        var y = sy + dy;
                        var key = this.LiveTerrainCellKey(x, y);

                        if(pSafeLookup[key] || candidateSeen[key] || dynamicUsed[key])
                            continue;
                        if(!this.IsLiveQuicksandCellStillSafe(pContext, x, y))
                            continue;

                        candidateSeen[key] = true;
                        candidates.push({
                            x: x,
                            y: y,
                            distance: (dx * dx) + (dy * dy),
                            tie: MapGen.Random.HashTile(pContext.Seed, x, y, 3473)
                        });
                    }
                }
            }
        }

        candidates.sort(function(pLeft, pRight) {
            if(pLeft.distance !== pRight.distance)
                return pLeft.distance - pRight.distance;
            if(pLeft.tie !== pRight.tie)
                return pLeft.tie - pRight.tie;
            // Total-order tiebreak on unique cell coords (HashTile ties can
            // collide; the engine's Array.sort is unstable).
            if(pLeft.x !== pRight.x)
                return pLeft.x - pRight.x;
            return pLeft.y - pRight.y;
        });

        for(var index = 0; index < candidates.length && usableSafeCount < targetCount; ++index) {
            var candidate = candidates[index];
            var candidateKey = this.LiveTerrainCellKey(candidate.x, candidate.y);

            MapGen.Layers.Set(pContext.Layers.riverBank, candidate.x, candidate.y, 1);
            MapGen.Layers.Set(pContext.Layers.blocked, candidate.x, candidate.y, 0);
            pSafeLookup[candidateKey] = true;
            pSafeCells.push({ x: candidate.x, y: candidate.y });
            ++usableSafeCount;
            ++added;
        }

        return added;
    },

    RebalanceLiveDynamicSinkingCells: function(pContext, pSafeCells, pSafeLookup) {
        var live = pContext && pContext.GrammarLiveTerrain ? pContext.GrammarLiveTerrain : null;
        var cells = live && live.dynamicCells ? live.dynamicCells : [];
        var target = live ? Math.max(0, Math.round(Number(live.dynamicSinkingTarget || 0))) : 0;
        var next = [];
        var used = {};
        var sinking = 0;

        if(!live || !target)
            return 0;

        for(var index = 0; index < cells.length; ++index) {
            var cell = cells[index];
            var x = Math.round(cell.x);
            var y = Math.round(cell.y);
            var key = this.LiveTerrainCellKey(x, y);

            if(cell.kind === "sinking") {
                if(!pSafeLookup[key] || used[key])
                    continue;
                cell.x = x;
                cell.y = y;
                cell.tileId = this.SinkingTileIdForCell(pContext, x, y);
                next.push(cell);
                used[key] = true;
                ++sinking;
                continue;
            }

            if(used[key])
                continue;
            next.push(cell);
            used[key] = true;
        }

        var candidates = pSafeCells.slice(0);
        candidates.sort(function(pLeft, pRight) {
            var byHash = MapGen.Random.HashTile(pContext.Seed, pLeft.x, pLeft.y, 3491) -
                MapGen.Random.HashTile(pContext.Seed, pRight.x, pRight.y, 3491);
            if(byHash !== 0)
                return byHash;
            // Total-order tiebreak on unique cell coords (HashTile ties can
            // collide; the engine's Array.sort is unstable).
            if(pLeft.x !== pRight.x)
                return pLeft.x - pRight.x;
            return pLeft.y - pRight.y;
        });

        for(var candidateIndex = 0; candidateIndex < candidates.length && sinking < target; ++candidateIndex) {
            var candidate = candidates[candidateIndex];
            var candidateKey = this.LiveTerrainCellKey(candidate.x, candidate.y);

            if(used[candidateKey])
                continue;

            next.push({
                x: candidate.x,
                y: candidate.y,
                tileId: this.SinkingTileIdForCell(pContext, candidate.x, candidate.y),
                kind: "sinking",
                source: "quicksand_sinking_ground_rebalanced",
                dynamicPairId: null
            });
            used[candidateKey] = true;
            ++sinking;
        }

        live.dynamicCells = next;
        live.dynamicSinking = sinking;
        if(pContext.GrammarPlan && pContext.GrammarPlan.liveTerrain) {
            pContext.GrammarPlan.liveTerrain.dynamicCells = next;
            pContext.GrammarPlan.liveTerrain.dynamicSinking = sinking;
        }

        return sinking;
    },

    PruneSmallLiveQuicksandComponents: function(pContext, pSafeCells, pSafeLookup) {
        var layers = pContext && pContext.Layers ? pContext.Layers : {};
        var live = pContext && pContext.GrammarLiveTerrain ? pContext.GrammarLiveTerrain : null;
        var visited;
        var kept = [];
        var keptLookup = {};
        var minimumPatchTiles = 8;
        var removed = 0;

        if(!live || live.mode !== "localized_beach_river" || !layers.riverBank)
            return 0;

        visited = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
        for(var startX = 0; startX < pContext.Width; ++startX) {
            for(var startY = 0; startY < pContext.Height; ++startY) {
                if(MapGen.Layers.Get(visited, startX, startY, 0) ||
                    !MapGen.Layers.Get(layers.riverBank, startX, startY, 0))
                    continue;

                var component = [];
                var queue = [{ x: startX, y: startY }];
                MapGen.Layers.Set(visited, startX, startY, 1);

                for(var queueIndex = 0; queueIndex < queue.length; ++queueIndex) {
                    var point = queue[queueIndex];
                    component.push(point);
                    var offsets = [[0, -1], [1, 0], [0, 1], [-1, 0]];

                    for(var offsetIndex = 0; offsetIndex < offsets.length; ++offsetIndex) {
                        var nx = point.x + offsets[offsetIndex][0];
                        var ny = point.y + offsets[offsetIndex][1];
                        if(nx < 0 || ny < 0 || nx >= pContext.Width || ny >= pContext.Height ||
                            MapGen.Layers.Get(visited, nx, ny, 0) ||
                            !MapGen.Layers.Get(layers.riverBank, nx, ny, 0))
                            continue;

                        MapGen.Layers.Set(visited, nx, ny, 1);
                        queue.push({ x: nx, y: ny });
                    }
                }

                if(component.length < minimumPatchTiles) {
                    for(var removeIndex = 0; removeIndex < component.length; ++removeIndex) {
                        MapGen.Layers.Set(layers.riverBank, component[removeIndex].x, component[removeIndex].y, 0);
                        ++removed;
                    }
                    continue;
                }

                for(var keepIndex = 0; keepIndex < component.length; ++keepIndex) {
                    var keep = component[keepIndex];
                    var key = this.LiveTerrainCellKey(keep.x, keep.y);
                    kept.push(keep);
                    keptLookup[key] = true;
                }
            }
        }

        pSafeCells.length = 0;
        for(var keptIndex = 0; keptIndex < kept.length; ++keptIndex)
            pSafeCells.push(kept[keptIndex]);
        for(var lookupKey in pSafeLookup) {
            if(pSafeLookup.hasOwnProperty(lookupKey))
                delete pSafeLookup[lookupKey];
        }
        for(var keptKey in keptLookup) {
            if(keptLookup.hasOwnProperty(keptKey))
                pSafeLookup[keptKey] = true;
        }

        if(live.quicksand)
            live.quicksand.cells = kept.slice(0);
        return removed;
    },

    ReapplyLiveTerrainLayers: function(pContext) {
        var live = pContext && pContext.GrammarLiveTerrain ? pContext.GrammarLiveTerrain : null;
        var water = live && live.waterPoints ? live.waterPoints : [];
        var beach = live && live.beach && live.beach.cells ? live.beach.cells : [];
        var quicksand = live && live.quicksand && live.quicksand.cells ? live.quicksand.cells : [];
        var layers = pContext ? pContext.Layers || {} : {};
        var waterReapplied = 0;
        var beachReapplied = 0;
        var reapplied = 0;
        var expanded = 0;
        var sinking = 0;
        var safeQuicksand = [];
        var safeQuicksandLookup = {};

        if(!live || live.mode !== "localized_beach_river")
            return 0;

        if(water.length && layers.water) {
            for(var waterIndex = 0; waterIndex < water.length; ++waterIndex) {
                var wx = water[waterIndex].x;
                var wy = water[waterIndex].y;
                if(!MapGen.Layers.InBounds(layers.water, wx, wy))
                    continue;
                if(MapGen.Layers.Get(layers.keepClear, wx, wy, 0) ||
                    MapGen.Layers.Get(layers.path, wx, wy, 0) ||
                    MapGen.Layers.Get(layers.crossing, wx, wy, 0) ||
                    MapGen.Layers.Get(layers.structureGround, wx, wy, 0) ||
                    MapGen.Layers.Get(layers.occupied, wx, wy, 0))
                    continue;

                MapGen.Layers.Set(layers.water, wx, wy, 1);
                MapGen.Layers.Set(layers.coast, wx, wy, 0);
                MapGen.Layers.Set(layers.riverBank, wx, wy, 0);
                MapGen.Layers.Set(layers.blocked, wx, wy, 0);
                ++waterReapplied;
            }
        }

        if(beach.length && layers.coast) {
            var allowBeachRiverBank =
                pContext.Profile &&
                pContext.Profile.TargetPackProfile === "grammar_beach" &&
                live.ocean;

            for(var beachIndex = 0; beachIndex < beach.length; ++beachIndex) {
                var bx = beach[beachIndex].x;
                var by = beach[beachIndex].y;
                if(!MapGen.Layers.InBounds(layers.coast, bx, by))
                    continue;
                if(MapGen.Layers.Get(layers.crossing, bx, by, 0) ||
                    MapGen.Layers.Get(layers.structureGround, bx, by, 0))
                    continue;
                if(!allowBeachRiverBank && MapGen.Layers.Get(layers.water, bx, by, 0))
                    continue;
                if(!allowBeachRiverBank && MapGen.Layers.Get(layers.riverBank, bx, by, 0))
                    continue;

                MapGen.Layers.Set(layers.water, bx, by, 0);
                MapGen.Layers.Set(layers.coast, bx, by, 1);
                MapGen.Layers.Set(layers.riverBank, bx, by, 0);
                MapGen.Layers.Set(layers.blocked, bx, by, 0);
                ++beachReapplied;
            }
        }

        if(!quicksand.length || !layers.riverBank) {
            if((waterReapplied || beachReapplied) && MapGen.Context && MapGen.Context.AddLog)
                MapGen.Context.AddLog(
                    pContext,
                    "Reapplied grammar live terrain cells: water=" + waterReapplied +
                        " beach=" + beachReapplied
                );
            return waterReapplied + beachReapplied;
        }

        for(var index = 0; index < quicksand.length; ++index) {
            var x = quicksand[index].x;
            var y = quicksand[index].y;
            if(!MapGen.Layers.InBounds(layers.riverBank, x, y))
                continue;

            if(!this.IsLiveQuicksandCellStillSafe(pContext, x, y)) {
                MapGen.Layers.Set(layers.riverBank, x, y, 0);
                continue;
            }

            MapGen.Layers.Set(layers.riverBank, x, y, 1);
            MapGen.Layers.Set(layers.blocked, x, y, 0);
            safeQuicksandLookup[this.LiveTerrainCellKey(x, y)] = true;
            safeQuicksand.push({ x: x, y: y });
            ++reapplied;
        }

        if(!live.quicksand || live.quicksand.authoredTemplates !== true)
            expanded = this.ExpandLiveQuicksandSafeCells(
                pContext,
                safeQuicksand,
                safeQuicksandLookup,
                quicksand,
                Math.round(Number(live.dynamicSinkingTarget || 0))
            );
        var pruned = this.PruneSmallLiveQuicksandComponents(
            pContext,
            safeQuicksand,
            safeQuicksandLookup
        );
        sinking = this.RebalanceLiveDynamicSinkingCells(pContext, safeQuicksand, safeQuicksandLookup);

        if((waterReapplied || beachReapplied || reapplied) && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(
                pContext,
                "Reapplied grammar live terrain cells: water=" + waterReapplied +
                    " beach=" + beachReapplied +
                    " quicksand=" + reapplied +
                    " quicksandExpanded=" + expanded +
                    " quicksandPruned=" + pruned +
                    " sinking=" + sinking
            );

        return waterReapplied + beachReapplied + reapplied + expanded + pruned;
    },

    ClearProtectedLiveTerrain: function(pContext, pPoints) {
        var cleared = 0;

        for(var index = 0; index < pPoints.length; ++index) {
            var point = pPoints[index];
            for(var x = point.x; x <= point.x; ++x) {
                for(var y = point.y; y <= point.y; ++y) {
                    if(!MapGen.Layers.InBounds(pContext.Layers.water, x, y))
                        continue;
                    if(MapGen.Layers.Get(pContext.Layers.water, x, y, 0) ||
                        MapGen.Layers.Get(pContext.Layers.riverBank, x, y, 0))
                        ++cleared;

                    MapGen.Layers.Set(pContext.Layers.water, x, y, 0);
                    MapGen.Layers.Set(pContext.Layers.riverBank, x, y, 0);
                }
            }
        }

        return cleared;
    },

    ApplyLiveBeachTerrain: function(pContext) {
        var protectedPoints = this.ProtectedLiveTerrainPoints(pContext);
        this.ResetLiveTerrainLayers(pContext);

        var archetype = (MapGen.Random.HashTile(pContext.Seed, 53, 59, 829) % 100) < 45 ?
            "quicksand_field" : "edge_beach_landing";
        var riverInfo = this.BuildBeachEdgeWater(pContext, protectedPoints, archetype);
        var beach = this.StampShoreBeachBand(pContext, riverInfo, protectedPoints);
        var pocketInfo = this.BuildAuthoredBeachPondPocket(pContext, protectedPoints);
        var pocketBeach = pocketInfo ? this.StampShoreBeachBand(pContext, pocketInfo, protectedPoints) : null;
        var combinedBeach = this.CombineLiveBeachSets(beach, pocketBeach);
        var quicksand = this.StampQuicksandPatches(pContext, riverInfo, combinedBeach, protectedPoints, archetype);
        var cleared = this.ClearProtectedLiveTerrain(pContext, protectedPoints);
        var dynamic = this.BuildLiveDynamicTerrainCells(pContext, riverInfo, combinedBeach, quicksand, protectedPoints);
        var allWaterPoints = [];
        var allWaterSeen = {};
        pContext._jungleLocalBeachFocus = null;

        function appendWaterPoints(self, points) {
            if(!points)
                return;
            for(var pointIndex = 0; pointIndex < points.length; ++pointIndex)
                self.RecordLiveTerrainPoint(
                    allWaterPoints,
                    allWaterSeen,
                    points[pointIndex].x,
                    points[pointIndex].y
                );
        }

        appendWaterPoints(this, riverInfo.waterPoints);
        appendWaterPoints(this, pocketInfo ? pocketInfo.waterPoints : null);

        pContext.GrammarLiveTerrain = {
            mode: "localized_beach_river",
            archetype: archetype,
            beachCompositionVariant: pContext.Profile.GrammarBeachCompositionVariant,
            beachComposition: pContext.Profile.GrammarBeachComposition,
            riverRole: riverInfo.river.role,
            edgeSide: riverInfo.edgeSide,
            edgeSideName: riverInfo.edgeSideName || this.BeachEdgeSideName(riverInfo.edgeSide),
            edgeBaseDepth: riverInfo.edgeBaseDepth,
            edgeDepthMin: riverInfo.edgeDepthMin,
            edgeDepthMax: riverInfo.edgeDepthMax,
            edgeDepthChanges: riverInfo.edgeDepthChanges,
            edgeControlCount: riverInfo.edgeControlCount,
            riverPoints: riverInfo.river.points.length,
            ocean: riverInfo.ocean === true,
            beachTemplate: riverInfo.authoredBeachTemplate || null,
            beachTemplateOrigin: riverInfo.templateOrigin || null,
            beachTemplateRows: riverInfo.authoredBeachRowPlan || null,
            beachRiverRows: riverInfo.authoredRiverRowPlan || null,
            beachRiverSpans: riverInfo.authoredRiverSpans || null,
            beachChannelTop: riverInfo.channelTop,
            beachChannelBottom: riverInfo.channelBottom,
            beachChannelTopByX: riverInfo.channelTopByX || null,
            beachChannelBottomByX: riverInfo.channelBottomByX || null,
            beachCourseVariant: riverInfo.courseVariant,
            beachExitEdge: riverInfo.exitEdge || null,
            beachPlacementVariant: riverInfo.placementVariant,
            beachLengthVariant: riverInfo.lengthVariant,
            authoredBeachLength: riverInfo.authoredBeachLength || null,
            beachComposedDepths: riverInfo.composedDepths || null,
            beachComposedWidths: riverInfo.composedWidths || null,
            beachComposedRuns: riverInfo.composedRuns || null,
            beachExtensionX: riverInfo.beachExtensionX || 0,
            beachExtensionY: riverInfo.beachExtensionY || 0,
            beachCropRows: riverInfo.beachCropRows || 0,
            waterPoints: allWaterPoints,
            waterCells: allWaterPoints.length,
            edgeWaterCells: riverInfo.waterPoints.length,
            totalWaterCells: allWaterPoints.length,
            pocketRole: pocketInfo ? pocketInfo.river.role : null,
            pocketWaterCells: pocketInfo ? pocketInfo.waterPoints.length : 0,
            pocketBeach: pocketBeach,
            interiorRole: null,
            interiorWaterCells: 0,
            interiorWaterBodies: [],
            beach: combinedBeach,
            quicksand: quicksand,
            dynamicCells: dynamic.cells,
            dynamicTarget: dynamic.target,
            dynamicWalkable: dynamic.walkable,
            dynamicBlocked: dynamic.blocked,
            dynamicSinking: dynamic.sinking,
            dynamicSinkingTarget: dynamic.sinkingTarget,
            dynamicBuilding: dynamic.building,
            dynamicDetails: dynamic.details,
            dynamicShapedStyleDetails: dynamic.shapedStyleDetails,
            protectedCleared: cleared
        };

        if(pContext.GrammarPlan) {
            if(this.LiveMaterialization)
                this.LiveMaterialization.SetMode(
                    pContext,
                    "grammar_live_sprite_plan_over_owned_beach_terrain",
                    "grammar_owned_beach_tile_layer"
                );
            pContext.GrammarPlan.liveTerrain = pContext.GrammarLiveTerrain;
        }

        MapGen.Context.AddLog(
            pContext,
            "Applied grammar beach live terrain: archetype=" + archetype +
                " edge=" + (riverInfo.edgeSideName || this.BeachEdgeSideName(riverInfo.edgeSide)) +
                " depth=" + riverInfo.edgeDepthMin + "-" + riverInfo.edgeDepthMax +
                " depthChanges=" + riverInfo.edgeDepthChanges +
                " water=" + riverInfo.waterPoints.length +
                " pocketWater=" + (pocketInfo ? pocketInfo.waterPoints.length : 0) +
                " shore=" + riverInfo.river.points.length +
                " beach=" + combinedBeach.coast + " quicksand=" + quicksand.count +
                " dynamic=" + dynamic.cells.length +
                " protectedCleared=" + cleared
        );
    },

    ApplyLiveTerrain: function(pContext) {
        if(this.ShouldOwnLiveBeachTerrain(pContext)) {
            this.ApplyLiveBeachTerrain(pContext);
            return;
        }

        // Jungle/ice no longer fall through to a generic noise-only fill.
        // The grammar route already selected an official source layout; apply
        // that map's transformed semantic water field before connectivity.
        if(this.UsesOriginalTerrainTemplate &&
            this.UsesOriginalTerrainTemplate(pContext)) {
            if(!pContext.OriginalTerrainTemplate && this.PrepareOriginalTerrainTemplate)
                this.PrepareOriginalTerrainTemplate(pContext);
            if(this.ApplyOriginalTerrainWater)
                this.ApplyOriginalTerrainWater(pContext);
        }
    }
    };

    for(var key in liveBeachTerrain) {
        if(liveBeachTerrain.hasOwnProperty(key))
            pGrammar[key] = liveBeachTerrain[key];
    }
})(MapGen.Grammar);

