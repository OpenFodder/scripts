var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Cover = MapGen.Terrain.Cover || {};

(function(pJungle) {
    pJungle.HashUnit = function(pContext, pX, pY, pSalt) {
        return MapGen.Random.HashTile(pContext.Seed, pX, pY, pSalt || 0) / 4294967295;
    };

    pJungle.Lerp = function(pA, pB, pT) {
        return pA + ((pB - pA) * pT);
    };

    pJungle.SmoothStep = function(pT) {
        return pT * pT * (3 - (2 * pT));
    };

    pJungle.ValueNoise = function(pContext, pX, pY, pScale, pSalt) {
        var gx = Math.floor(pX / pScale);
        var gy = Math.floor(pY / pScale);
        var fx = this.SmoothStep((pX / pScale) - gx);
        var fy = this.SmoothStep((pY / pScale) - gy);
        var topLeft = this.HashUnit(pContext, gx, gy, pSalt);
        var topRight = this.HashUnit(pContext, gx + 1, gy, pSalt);
        var bottomLeft = this.HashUnit(pContext, gx, gy + 1, pSalt);
        var bottomRight = this.HashUnit(pContext, gx + 1, gy + 1, pSalt);
        var top = this.Lerp(topLeft, topRight, fx);
        var bottom = this.Lerp(bottomLeft, bottomRight, fx);

        return this.Lerp(top, bottom, fy);
    };

    pJungle.TreeScore = function(pContext, pX, pY) {
        var largeScale = Math.max(8, Math.floor(Math.min(pContext.Width, pContext.Height) * 0.20));
        var mediumScale = Math.max(5, Math.floor(Math.min(pContext.Width, pContext.Height) * 0.09));
        var fine = this.HashUnit(pContext, pX, pY, 303);
        var score = (this.ValueNoise(pContext, pX, pY, largeScale, 301) * 0.66) +
            (this.ValueNoise(pContext, pX, pY, mediumScale, 302) * 0.29) +
            (fine * 0.05);

        if(MapGen.Layers.Get(pContext.Layers.terrainEdge, pX, pY, 0))
            score -= 0.30;
        if(MapGen.Layers.Get(pContext.Layers.coast, pX, pY, 0))
            score -= this.TreesMayUseCoast(pContext) ? 0.08 : 0.45;
        if(this.IsReservedNearby(pContext, pX, pY, 2))
            score -= 0.20;

        // v3 Concepts describe where cover belongs on IntentMap; Cover.Build
        // decides the exact renderable mask. Bias patch origins toward that
        // semantic proposal so materialization preserves the authored layout
        // instead of replacing it with unrelated global noise.
        if(pContext.IntentMap && MapGen.Intent && MapGen.Intent.Terrain) {
            var intentIndex = (pY * pContext.IntentMap.width) + pX;
            var intentTerrain = pContext.IntentMap.terrain[intentIndex];
            if(intentTerrain === MapGen.Intent.Terrain.FOREST)
                score += 0.55;
            else if(intentTerrain === MapGen.Intent.Terrain.OUTCROP)
                score += 0.30;
            // Named necks are authored barriers. Prefer their forest cells
            // within the existing cover budget before filling ambient woods.
            var gates = pContext.IntentStyleContract && pContext.IntentStyleContract.gates;
            if(intentTerrain === MapGen.Intent.Terrain.FOREST && gates) {
                for(var g = 0; g < gates.length; ++g) {
                    var gate = gates[g];
                    if(pX >= gate.x && pX < gate.x + gate.thickness &&
                        pY >= gate.yStart && pY <= gate.yEnd) {
                        score += 2;
                        break;
                    }
                }
            }
        }

        return score;
    };

    pJungle.NeighborBlockedCount = function(pContext, pX, pY) {
        var count = 0;

        for(var x = pX - 1; x <= pX + 1; ++x) {
            for(var y = pY - 1; y <= pY + 1; ++y) {
                if(x === pX && y === pY)
                    continue;
                if(MapGen.Layers.Get(pContext.Layers.blocked, x, y, 0))
                    ++count;
            }
        }

        return count;
    };

    pJungle.IsReservedNearby = function(pContext, pX, pY, pRadius) {
        for(var x = pX - pRadius; x <= pX + pRadius; ++x) {
            for(var y = pY - pRadius; y <= pY + pRadius; ++y) {
                if(MapGen.Layers.Get(pContext.Layers.keepClear, x, y, 0))
                    return true;
            }
        }

        return false;
    };

    pJungle.TreesMayUseCoast = function(pContext) {
        var profile = pContext.Profile || {};

        if(profile.TreeCoverOnCoast !== undefined)
            return !!profile.TreeCoverOnCoast;

        return profile.TerrainType === Terrain.Types.Jungle && !profile.AllowJungleBeachTiles;
    };

    pJungle.MarkTreeCell = function(pContext, pX, pY) {
        MapGen.Layers.Set(pContext.Layers.blocked, pX, pY, 1);
        if(pContext.Layers.treeTrimmed)
            MapGen.Layers.Set(pContext.Layers.treeTrimmed, pX, pY, 0);
        if(pContext.Layers.owner)
            MapGen.Layers.ClaimCell(pContext.Layers.owner, pX, pY, MapGen.Layers.Owner.TREE);
    };

    pJungle.MarkSoftEdges = function(pContext) {
        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(!MapGen.Layers.Get(pContext.Layers.keepClear, x, y, 0) && !MapGen.Layers.Get(pContext.Layers.path, x, y, 0))
                    continue;

                for(var ex = x - 2; ex <= x + 2; ++ex) {
                    for(var ey = y - 2; ey <= y + 2; ++ey) {
                        if(!MapGen.Layers.InBounds(pContext.Layers.terrainEdge, ex, ey))
                            continue;
                        if(MapGen.Layers.Get(pContext.Layers.keepClear, ex, ey, 0) || MapGen.Layers.Get(pContext.Layers.path, ex, ey, 0))
                            continue;
                        if(MapGen.Layers.Get(pContext.Layers.water, ex, ey, 0))
                            continue;
                        if(MapGen.Layers.Get(pContext.Layers.coast, ex, ey, 0))
                            continue;

                        var dx = ex - x;
                        var dy = ey - y;
                        var distanceSq = (dx * dx) + (dy * dy);

                        if(distanceSq > 0 && distanceSq <= 4)
                            MapGen.Layers.Set(pContext.Layers.terrainEdge, ex, ey, 1);
                    }
                }
            }
        }

        MapGen.Context.AddLog(pContext, "Marked soft terrain edges");
    };

    pJungle.IsExcluded = function(pContext, pX, pY, pAllowClearing) {
        if(MapGen.Layout.Reservations.BlocksCover(pContext, pX, pY))
            return true;
        if(!MapGen.Layout.TerrainSpace.AllowsCover(pContext, pX, pY))
            return true;
        if(!MapGen.Layers.InBounds(pContext.Layers.blocked, pX, pY))
            return true;
        if(this.IsOuterCoverBuffer(pContext, pX, pY))
            return true;

        // Some v3 Concepts author a deliberate macro forest mask (belts,
        // banks, maze walls) rather than a loose cover suggestion. Preserve
        // that composition through PatchAndGrow and the carved-fill stages
        // when the profile explicitly opts in. Without this gate, TreeScore
        // only biases seed origins and GrowPatch freely expands into LAND,
        // causing structurally different Concepts to converge on the same
        // generic blob distribution.
        if(pContext.Profile && pContext.Profile.ForestRespectIntentMask &&
            pContext.IntentMap && MapGen.Intent && MapGen.Intent.Terrain) {
            var intentIndex = (pY * pContext.IntentMap.width) + pX;
            if(pContext.IntentMap.terrain[intentIndex] !==
                MapGen.Intent.Terrain.FOREST)
                return true;
        }
        // Architecture v3: the ownership grid is the single source of truth for
        // what trees may NOT cover. Anything claimed above OPEN/TREE — route,
        // clearing, water, cliff, beach, structure, object — is off-limits, so
        // ApplyTreeMask can no longer paint over the gameplay skeleton or the
        // cliff footprint. (This is what makes ReassertFootprint redundant.)
        if(pContext.Layers.owner) {
            var owner = MapGen.Layers.Get(pContext.Layers.owner, pX, pY, 0);
            if(owner === MapGen.Layers.Owner.ROUTE ||
                (!pAllowClearing && owner === MapGen.Layers.Owner.CLEARING) ||
                owner === MapGen.Layers.Owner.CLIFF ||
                owner === MapGen.Layers.Owner.STRUCTURE ||
                owner === MapGen.Layers.Owner.OBJECT)
                return true;
        }
        if(!pAllowClearing && MapGen.Layers.Get(pContext.Layers.keepClear, pX, pY, 0))
            return true;
        if(MapGen.Layers.Get(pContext.Layers.water, pX, pY, 0))
            return true;
        if(MapGen.Layers.Get(pContext.Layers.coast, pX, pY, 0) && !this.TreesMayUseCoast(pContext))
            return true;

        // Water/bank-proximity exclusion. PatchAndGrow used to seed trees
        // adjacent to water/riverBank cells, then IceCharMap.FixCharMap
        // Rule 1 (RCA 2026-06-12) demoted those trees to GROUND/WET/WATER
        // because the Wang atlas has no `T|~` or `T|~~` tile pair (a tree
        // edge directly abutting bank/wet). Slice 0 RCA 2026-06-15 measured
        // an 84% layer/render disagreement: ~16% of CellChar tree returns
        // survive to render; the rest get eaten by FixCharMap. The fix
        // moves the exclusion UPSTREAM into authoring so the seeds avoid
        // the cells the renderer would demote anyway. Profile knob:
        // `ForestSeedWaterClearance` — number of Chebyshev-1 cells from
        // water/riverBank/forcedBank that are off-limits to tree seeds.
        // See [[mapgen_layer_architecture_gap]] for the architectural
        // arc this slice fits into. Active for ice profiles only (the
        // atlas legality issue is ice-specific).
        var seedWaterClearance = pContext.Profile && pContext.Profile.ForestSeedWaterClearance;
        if(typeof seedWaterClearance === "number" && seedWaterClearance > 0) {
            var clearance = Math.floor(seedWaterClearance);
            for(var dx = -clearance; dx <= clearance; ++dx) {
                for(var dy = -clearance; dy <= clearance; ++dy) {
                    if(dx === 0 && dy === 0) continue;
                    var nx = pX + dx, ny = pY + dy;
                    if(MapGen.Layers.Get(pContext.Layers.water, nx, ny, 0))
                        return true;
                    if(MapGen.Layers.Get(pContext.Layers.riverBank, nx, ny, 0))
                        return true;
                    if(MapGen.Layers.Get(pContext.Layers.forcedBank, nx, ny, 0))
                        return true;
                }
            }
        }
        return false;
    };

    pJungle.OuterCoverClearance = function(pContext) {
        // Profile is invariant across the lifetime of a context; cache so the
        // per-cell IsOuterCoverBuffer hot path doesn't re-parse the profile on
        // each call (PostPlacementCover and ice-render call this millions of
        // times). Memoize to -1 when no override exists so isNaN/clamp run once.
        if(pContext._outerCoverClearance !== undefined)
            return pContext._outerCoverClearance;

        var profile = pContext.Profile || {};
        var clearance;
        if(profile.AllowOuterEdgeCover === true) {
            clearance = 0;
        } else {
            var value = Number(profile.OuterCoverClearance);
            if(isNaN(value))
                value = 2;
            clearance = Math.max(1, Math.min(4, Math.floor(value)));
        }

        pContext._outerCoverClearance = clearance;
        return clearance;
    };

    pJungle.IsOuterCoverBuffer = function(pContext, pX, pY) {
        var clearance = pContext._outerCoverClearance;
        if(clearance === undefined)
            clearance = this.OuterCoverClearance(pContext);
        if(clearance <= 0)
            return false;

        return this.PerimeterDistance(pContext, pX, pY) < clearance;
    };

    pJungle.ClearOuterCoverBuffer = function(pContext) {
        var clearance = this.OuterCoverClearance(pContext);
        var cleared = 0;

        if(clearance <= 0)
            return 0;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(!this.IsOuterCoverBuffer(pContext, x, y))
                    continue;
                if(MapGen.Layers.Get(pContext.Layers.blocked, x, y, 0)) {
                    MapGen.Layers.Set(pContext.Layers.blocked, x, y, 0);
                    ++cleared;
                }
            }
        }

        if(cleared)
            MapGen.Context.AddLog(pContext, "Cleared outer cover buffer (" + cleared + " tiles, clearance " + clearance + ")");

        return cleared;
    };
})(MapGen.Terrain.Cover);
