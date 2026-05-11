var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};

// Grass variant smoother. Runs after the bitmask smoothing pass and rewrites
// each grass cell to a member of the wider Jungle.Sub0.Grass palette (~40
// tiles) whose mean luminance matches a per-cell bias target.
//
// Bias = smooth hash-noise field
//        - inverse-square halo from blocked/occupied neighbours (shadow)
//        + inverse-square halo from water/coast neighbours (open sun).
//
// Picker: gaussian-weighted draw centred on the target. Mainland tiles
// (123, 124) keep weight 1; the rest are scaled by GrassPaletteRareWeight so
// the original look stays dominant. Per-tile luminance ships in
// MapGen.Terrain.Smoothing.JungleGrassEdges (Tools/BuildJungleGrassEdgeTable.py).
MapGen.Terrain.Smoothing.GrassVariantSmoother = (function() {

    var MAINLAND_TILES = { 123: true, 124: true };

    function profileNumber(pProfile, pName, pDefault) {
        var v = pProfile ? pProfile[pName] : undefined;
        return (typeof v === "number") ? v : pDefault;
    }

    // Smooth hash noise sampled on a coarse grid, smoothstepped + bilinearly
    // interpolated. Returns 0..1.
    function sampleNoise(pSeed, pX, pY, pScale, pSalt) {
        var step = Math.max(1, Math.round(1 / pScale));
        var gx = Math.floor(pX / step);
        var gy = Math.floor(pY / step);
        var fx = (pX - gx * step) / step;
        var fy = (pY - gy * step) / step;
        fx = fx * fx * (3 - 2 * fx);
        fy = fy * fy * (3 - 2 * fy);
        var inv = 1 / 0xFFFFFFFF;
        var h00 = MapGen.Random.HashTile(pSeed, gx,     gy,     pSalt) * inv;
        var h10 = MapGen.Random.HashTile(pSeed, gx + 1, gy,     pSalt) * inv;
        var h01 = MapGen.Random.HashTile(pSeed, gx,     gy + 1, pSalt) * inv;
        var h11 = MapGen.Random.HashTile(pSeed, gx + 1, gy + 1, pSalt) * inv;
        var a = h00 * (1 - fx) + h10 * fx;
        var b = h01 * (1 - fx) + h11 * fx;
        return a * (1 - fy) + b * fy;
    }

    // Sum 1/(1+d^2) over neighbour cells inside pRadius where pPredicate hits.
    function haloAmount(pContext, pX, pY, pRadius, pPredicate) {
        if(pRadius <= 0) return 0;
        var layers = pContext.Layers;
        var sum = 0;
        for(var dy = -pRadius; dy <= pRadius; ++dy) {
            for(var dx = -pRadius; dx <= pRadius; ++dx) {
                if(dx === 0 && dy === 0) continue;
                var nx = pX + dx, ny = pY + dy;
                if(!MapGen.Layers.InBounds(layers.blocked, nx, ny)) continue;
                if(pPredicate(layers, nx, ny))
                    sum += 1 / (1 + dx * dx + dy * dy);
            }
        }
        return sum;
    }

    function isShadowCell(pLayers, pX, pY) {
        return MapGen.Layers.Get(pLayers.blocked, pX, pY, 0) ||
            MapGen.Layers.Get(pLayers.occupied, pX, pY, 0);
    }

    function isLightCell(pLayers, pX, pY) {
        return MapGen.Layers.Get(pLayers.water, pX, pY, 0) ||
            MapGen.Layers.Get(pLayers.coast, pX, pY, 0);
    }

    // Bias target in luminance units. Range tuned to the JungleGrassEdges
    // spread (observed 72..93 across 40 tiles). Centred low (~78) because the
    // mainland tiles 123/124 sit at luminance 75 — biasing the target up
    // crowds them out of the gaussian picker.
    function biasFor(pContext, pX, pY, pNoiseScale, pDarkRadius, pLightRadius, pSalt) {
        var target = 72 + sampleNoise(pContext.Seed, pX, pY, pNoiseScale, pSalt) * 12;
        target -= 6 * haloAmount(pContext, pX, pY, pDarkRadius,  isShadowCell);
        target += 5 * haloAmount(pContext, pX, pY, pLightRadius, isLightCell);
        if(target < 68) target = 68;
        if(target > 92) target = 92;
        return target;
    }

    // Same as biasFor but reads precomputed halo fields instead of scanning
    // neighbour layers. Caller indexes by (x+1, y+1) into a (W+2)x(H+2) grid.
    function biasForCached(pContext, pX, pY, pNoiseScale, pSalt, pShadowField, pLightField, pStride) {
        var idx = (pY + 1) * pStride + (pX + 1);
        var target = 72 + sampleNoise(pContext.Seed, pX, pY, pNoiseScale, pSalt) * 12;
        target -= 6 * pShadowField[idx];
        target += 5 * pLightField[idx];
        if(target < 68) target = 68;
        if(target > 92) target = 92;
        return target;
    }

    // Precompute a halo field over the (W+2)x(H+2) padded grid by inlining
    // direct 2D-array reads against pPrimary[x][y] || (pSecondary && pSecondary[x][y]).
    // Avoids per-neighbour function-call overhead from MapGen.Layers.Get/InBounds —
    // at 96x72 that was ~700K calls per field.
    function precomputeHalo(pRadius, pPrimary, pSecondary, pStride, pPadH, pWidth, pHeight) {
        var field = new Array(pStride * pPadH);
        for(var i = 0; i < field.length; ++i) field[i] = 0;
        if(pRadius <= 0 || !pPrimary) return field;
        // Precompute the radial weights so the inner loop is a single
        // multiply-by-table lookup.
        var diam = pRadius * 2 + 1;
        var weights = new Array(diam * diam);
        for(var dy0 = -pRadius; dy0 <= pRadius; ++dy0) {
            for(var dx0 = -pRadius; dx0 <= pRadius; ++dx0)
                weights[(dy0 + pRadius) * diam + (dx0 + pRadius)] =
                    (dx0 === 0 && dy0 === 0) ? 0 : 1 / (1 + dx0 * dx0 + dy0 * dy0);
        }
        for(var y = -1; y <= pHeight; ++y) {
            var y0 = y - pRadius; if(y0 < 0) y0 = 0;
            var y1 = y + pRadius; if(y1 >= pHeight) y1 = pHeight - 1;
            for(var x = -1; x <= pWidth; ++x) {
                var x0 = x - pRadius; if(x0 < 0) x0 = 0;
                var x1 = x + pRadius; if(x1 >= pWidth) x1 = pWidth - 1;
                var sum = 0;
                for(var nx = x0; nx <= x1; ++nx) {
                    var primCol = pPrimary[nx];
                    var secCol = pSecondary ? pSecondary[nx] : null;
                    var dxw = nx - x;
                    for(var ny = y0; ny <= y1; ++ny) {
                        if(primCol[ny] || (secCol && secCol[ny]))
                            sum += weights[((ny - y) + pRadius) * diam + (dxw + pRadius)];
                    }
                }
                field[(y + 1) * pStride + (x + 1)] = sum;
            }
        }
        return field;
    }

    // T1.0b — asymmetric tiles get a bonus when their dark→light vector
    // (E.lum - W.lum, S.lum - N.lum) lines up with the bias-field gradient
    // sampled at the cell. Symmetric tiles (most of the palette) and cells
    // with a flat bias field get no bonus and the original gaussian wins.
    function orientationBonus(pRec, pGradX, pGradY, pStrength, pAsymThreshold) {
        if(pStrength <= 0)
            return 0;
        var lum = pRec.luminance;
        var dxLum = lum.E - lum.W;
        var dyLum = lum.S - lum.N;
        var asymMag2 = dxLum * dxLum + dyLum * dyLum;
        if(asymMag2 < pAsymThreshold * pAsymThreshold)
            return 0;
        var gradMag2 = pGradX * pGradX + pGradY * pGradY;
        if(gradMag2 < 0.0001)
            return 0;
        var cos = (dxLum * pGradX + dyLum * pGradY) /
            Math.sqrt(asymMag2 * gradMag2);
        return pStrength * cos;
    }

    function pickTile(pContext, pX, pY, pTileIds, pTileData, pTarget, pSigma, pRareWeight, pSalt,
                      pGradX, pGradY, pOrientStrength, pAsymThreshold) {
        var twoSigmaSquared = 2 * pSigma * pSigma;
        var weights = [];
        var totalWeight = 0;

        for(var i = 0; i < pTileIds.length; ++i) {
            var tid = pTileIds[i];
            var rec = pTileData[tid];
            if(!rec || !rec.luminance) {
                weights.push(0);
                continue;
            }
            var d = rec.luminance.mean - pTarget;
            var w = Math.exp(-(d * d) / twoSigmaSquared);
            if(!MAINLAND_TILES[tid])
                w *= pRareWeight;
            var bonus = orientationBonus(rec, pGradX, pGradY, pOrientStrength, pAsymThreshold);
            if(bonus !== 0) {
                var scale = 1 + bonus;
                if(scale < 0) scale = 0;
                w *= scale;
            }
            weights.push(w);
            totalWeight += w;
        }

        if(totalWeight <= 0)
            return pTileIds[0];

        var draw = (MapGen.Random.HashTile(pContext.Seed, pX, pY, pSalt) / 0xFFFFFFFF) * totalWeight;
        var acc = 0;
        for(var j = 0; j < pTileIds.length; ++j) {
            acc += weights[j];
            if(draw < acc)
                return pTileIds[j];
        }
        return pTileIds[pTileIds.length - 1];
    }

    // Path/crossing/water/bank/coast cells are painted by dedicated palettes.
    // Only dark-grass ground cells are eligible for variant rewriting.
    function isProtectedCell(pContext, pX, pY) {
        var layers = pContext.Layers;
        return MapGen.Layers.Get(layers.crossing, pX, pY, 0) ||
            MapGen.Layers.Get(layers.path, pX, pY, 0) ||
            MapGen.Layers.Get(layers.water, pX, pY, 0) ||
            MapGen.Layers.Get(layers.riverBank, pX, pY, 0) ||
            MapGen.Layers.Get(layers.coast, pX, pY, 0);
    }

    // Find the palette member whose pEdge luminance is closest to pTargetLum
    // while keeping its mean within pMeanTolerance of pOrigMean (so we don't
    // hop to a wildly different brightness while patching a seam).
    function findBestEdgeMatch(pData, pTileIds, pCurrent, pEdge, pTargetLum, pOrigMean, pMeanTolerance) {
        var origRec = pData.tiles[String(pCurrent)];
        var bestId = pCurrent;
        var bestDelta = (origRec && origRec.luminance) ?
            Math.abs(origRec.luminance[pEdge] - pTargetLum) : Infinity;

        for(var i = 0; i < pTileIds.length; ++i) {
            var tid = pTileIds[i];
            var rec = pData.tiles[String(tid)];
            if(!rec || !rec.luminance) continue;
            if(Math.abs(rec.luminance.mean - pOrigMean) > pMeanTolerance) continue;
            var d = Math.abs(rec.luminance[pEdge] - pTargetLum);
            if(d < bestDelta) {
                bestDelta = d;
                bestId = tid;
            }
        }
        return { id: bestId, delta: bestDelta };
    }

    // Inspect one A->B edge pair. If the luminance mismatch exceeds threshold,
    // try reskinning A first (so the bias-picker output usually wins on ties),
    // otherwise B. Returns 1 on swap, 0 otherwise.
    function tryEdge(pContext, pTiles, pData, pTileIds, pThreshold, pMeanTolerance,
                    pAx, pAy, pBx, pBy, pAedge, pBedge) {
        if(isProtectedCell(pContext, pBx, pBy)) return 0;
        var tA = MapGen.Layers.Get(pTiles, pAx, pAy, -1);
        var tB = MapGen.Layers.Get(pTiles, pBx, pBy, -1);
        var recA = pData.tiles[String(tA)];
        var recB = pData.tiles[String(tB)];
        if(!recA || !recA.luminance || !recB || !recB.luminance) return 0;
        var delta = Math.abs(recA.luminance[pAedge] - recB.luminance[pBedge]);
        if(delta <= pThreshold) return 0;

        var aFix = findBestEdgeMatch(pData, pTileIds, tA, pAedge, recB.luminance[pBedge], recA.luminance.mean, pMeanTolerance);
        if(aFix.id !== tA && aFix.delta < delta) {
            MapGen.Layers.Set(pTiles, pAx, pAy, aFix.id);
            return 1;
        }
        var bFix = findBestEdgeMatch(pData, pTileIds, tB, pBedge, recA.luminance[pAedge], recB.luminance.mean, pMeanTolerance);
        if(bFix.id !== tB && bFix.delta < delta) {
            MapGen.Layers.Set(pTiles, pBx, pBy, bFix.id);
            return 1;
        }
        return 0;
    }

    // Walk every E-W and N-S grass-tile pair once. Each pair touched at most
    // once per pass; cells repaired earlier in the row may be touched again
    // through their other neighbour, which is fine.
    function edgeMatchPass(pContext, pTiles, pData, pTileIds, pThreshold, pMeanTolerance) {
        var swaps = 0;
        var width = pContext.Width, height = pContext.Height;
        for(var y = 0; y < height; ++y) {
            for(var x = 0; x < width; ++x) {
                if(isProtectedCell(pContext, x, y)) continue;
                if(x + 1 < width)
                    swaps += tryEdge(pContext, pTiles, pData, pTileIds, pThreshold, pMeanTolerance, x, y, x + 1, y, "E", "W");
                if(y + 1 < height)
                    swaps += tryEdge(pContext, pTiles, pData, pTileIds, pThreshold, pMeanTolerance, x, y, x, y + 1, "S", "N");
            }
        }
        return swaps;
    }

    function apply(pContext, pTiles) {
        if(!pContext || !pContext.Profile || !pTiles)
            return 0;
        if(pContext.Profile.TerrainType !== Terrain.Types.Jungle)
            return 0;

        var data = MapGen.Terrain.Smoothing.JungleGrassEdges;
        if(!data || !data.tiles)
            return 0;

        var profile = pContext.Profile;
        var noiseScale     = profileNumber(profile, "GrassNoiseScale",        0.08);
        var darkRadius     = profileNumber(profile, "GrassDarkBoostRadius",   2);
        var lightRadius    = profileNumber(profile, "GrassLightBoostRadius",  2);
        var sigma          = profileNumber(profile, "GrassBiasSigma",         12);
        var rareWeight     = profileNumber(profile, "GrassPaletteRareWeight", 0.05);
        var salt           = profileNumber(profile, "GrassBiasSeedSalt",      7137);
        var matchThreshold = profileNumber(profile, "GrassEdgeMatchThreshold", 8);
        var matchPasses    = profileNumber(profile, "GrassEdgeMatchPasses",    2);
        var meanTolerance  = profileNumber(profile, "GrassEdgeMeanTolerance",  8);
        var orientStrength = profileNumber(profile, "GrassOrientationStrength", 0.5);
        var asymThreshold  = profileNumber(profile, "GrassAsymmetryThreshold",  6);

        var tileIds = [];
        for(var key in data.tiles) {
            if(data.tiles.hasOwnProperty(key))
                tileIds.push(parseInt(key, 10) | 0);
        }
        if(!tileIds.length)
            return 0;

        // Precompute bias[x,y] once. The main loop reads bias for the cell
        // and (if orientation is on) its 4 neighbours — without this cache
        // biasFor runs 5x per cell, and each call does two radius-2 halo
        // scans (~50 layer reads). At 96x72 that was 1.7M layer reads.
        var biasGrid = MapGen.Context.Time(pContext, "GrassVariant.biasPrecompute", function() {
            var width = pContext.Width, height = pContext.Height;
            // Pad by 1 on each side so x-1 / x+1 / y-1 / y+1 lookups don't
            // need bounds checks in the hot loop.
            var padW = width + 2, padH = height + 2;
            // One halo sweep per field replaces ~7252 per-call scans of the
            // same layers — same total reads but no Math.max/scale work
            // inside the inner loop, and the per-cell biasForCached call
            // collapses to two array indexes plus one noise sample.
            var ls = pContext.Layers;
            var shadowField = precomputeHalo(darkRadius,  ls.blocked, ls.occupied, padW, padH, width, height);
            var lightField  = precomputeHalo(lightRadius, ls.water,   ls.coast,    padW, padH, width, height);
            var grid = new Array(padW * padH);
            for(var y = -1; y <= height; ++y) {
                for(var x = -1; x <= width; ++x)
                    grid[(y + 1) * padW + (x + 1)] = biasForCached(pContext, x, y, noiseScale, salt,
                        shadowField, lightField, padW);
            }
            return { data: grid, stride: padW };
        });

        function biasAt(pX, pY) {
            return biasGrid.data[(pY + 1) * biasGrid.stride + (pX + 1)];
        }

        var rewritten = MapGen.Context.Time(pContext, "GrassVariant.bias", function() {
            var n = 0;
            for(var y = 0; y < pContext.Height; ++y) {
                for(var x = 0; x < pContext.Width; ++x) {
                    if(isProtectedCell(pContext, x, y))
                        continue;

                    var current = MapGen.Layers.Get(pTiles, x, y, -1);
                    if(!data.tiles[String(current)])
                        continue;

                    var target = biasAt(x, y);
                    var gradX = 0, gradY = 0;
                    if(orientStrength > 0) {
                        gradX = biasAt(x + 1, y) - biasAt(x - 1, y);
                        gradY = biasAt(x, y + 1) - biasAt(x, y - 1);
                    }
                    var pick = pickTile(pContext, x, y, tileIds, data.tiles, target, sigma, rareWeight, salt + 1,
                        gradX, gradY, orientStrength, asymThreshold);
                    if(pick !== current) {
                        MapGen.Layers.Set(pTiles, x, y, pick);
                        ++n;
                    }
                }
            }
            return n;
        }) || 0;

        if(rewritten > 0)
            MapGen.Context.AddLog(pContext, "Grass variant smoother rewrote " + rewritten + " cells");

        var edgeSwaps = MapGen.Context.Time(pContext, "GrassVariant.edgeMatch", function() {
            var total = 0;
            for(var p = 0; p < matchPasses; ++p) {
                var passSwaps = edgeMatchPass(pContext, pTiles, data, tileIds, matchThreshold, meanTolerance);
                if(passSwaps === 0) break;
                total += passSwaps;
            }
            return total;
        }) || 0;

        if(edgeSwaps > 0)
            MapGen.Context.AddLog(pContext, "Grass edge-match swapped " + edgeSwaps + " cells");

        return rewritten + edgeSwaps;
    }

    return {
        Apply: apply
    };
})();
