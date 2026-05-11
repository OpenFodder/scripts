var MapGen = MapGen || {};
MapGen.Integration = MapGen.Integration || {};

(function(pIntegration) {
    pIntegration.EnsureStructureGroundLayer = function(pContext) {
        if(!pContext || !pContext.Layers)
            return null;

        if(!pContext.Layers.structureGround)
            pContext.Layers.structureGround = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);

        return pContext.Layers.structureGround;
    };

    pIntegration.StructureFlushLocalEnabled = function(pContext) {
        if(!pContext)
            return false;
        if(!pContext.Profile || pContext.Profile.TerrainType !== Terrain.Types.Ice)
            return false;
        if(!pContext.RenderedMap || !pContext.RenderedMap.Tiles)
            return false;
        return !!(MapGen.Render && MapGen.Render.BuildTileLayer);
    };

    pIntegration.TrackStructureTerrainDirtyCells = function(pContext) {
        return !!(pContext && pContext.Profile && pContext.Profile.TerrainType === Terrain.Types.Ice);
    };

    pIntegration.MarkStructureTerrainDirtyCell = function(pContext, pX, pY) {
        if(!pContext || !this.TrackStructureTerrainDirtyCells(pContext))
            return;

        var key = pX + "," + pY;
        if(!pContext._structureTerrainDirtyCellMask)
            pContext._structureTerrainDirtyCellMask = {};
        if(pContext._structureTerrainDirtyCellMask[key])
            return;

        pContext._structureTerrainDirtyCellMask[key] = true;
        pContext._structureTerrainDirtyCellCount = (pContext._structureTerrainDirtyCellCount || 0) + 1;

        var bounds = pContext._structureTerrainDirtyBounds;
        if(!bounds) {
            pContext._structureTerrainDirtyBounds = {
                minX: pX,
                minY: pY,
                maxX: pX,
                maxY: pY
            };
            return;
        }

        if(pX < bounds.minX) bounds.minX = pX;
        if(pY < bounds.minY) bounds.minY = pY;
        if(pX > bounds.maxX) bounds.maxX = pX;
        if(pY > bounds.maxY) bounds.maxY = pY;
    };

    pIntegration.PaintStructureGroundCell = function(pContext, pX, pY, pSpec, pKind) {
        if(!pContext || pX < 0 || pY < 0 || pX >= pContext.Width || pY >= pContext.Height)
            return false;
        if(this.IsStructureCliffProtectedCell(pContext, pX, pY))
            return false;
        if(MapGen.Layers.Get(pContext.Layers.water, pX, pY, 0) &&
            !MapGen.Layers.Get(pContext.Layers.crossing, pX, pY, 0)) {
            return false;
        }
        if(MapGen.Layers.Get(pContext.Layers.riverBank, pX, pY, 0))
            return false;

        var occupied = MapGen.Layers.Get(pContext.Layers.occupied, pX, pY, 0);
        if(occupied &&
            occupied !== "structure_cluster" &&
            occupied !== "objective_structure" &&
            occupied !== "live_structure_clearance")
            return false;

        MapGen.Layers.Set(pContext.Layers.blocked, pX, pY, 0);
        MapGen.Layers.Set(pContext.Layers.outcrop, pX, pY, 0);
        MapGen.Layers.Set(pContext.Layers.terrainEdge, pX, pY, 0);
        MapGen.Layers.Set(pContext.Layers.coast, pX, pY, 0);
        MapGen.Layers.Set(pContext.Layers.forcedBank, pX, pY, 0);
        MapGen.Layers.Set(pContext.Layers.lakeShore, pX, pY, 0);
        MapGen.Layers.Set(pContext.Layers.keepClear, pX, pY, 1);
        if(pKind === "apron") {
            MapGen.Layers.Set(pContext.Layers.path, pX, pY, 0);
            MapGen.Layers.Set(pContext.Layers.crossing, pX, pY, 0);
            MapGen.Layers.Set(this.EnsureStructureGroundLayer(pContext), pX, pY, 1);
        }
        if(occupied === "structure_cluster" ||
            occupied === "objective_structure" ||
            occupied === "live_structure_clearance")
            MapGen.Layers.Set(pContext.Layers.occupied, pX, pY, 0);

        pContext.StructureTerrainDirty = true;
        this.MarkStructureTerrainDirtyCell(pContext, pX, pY);
        return true;
    };

    pIntegration.PaintStructureClearance = function(pContext, pSpec, pPlacement) {
        var clearance = this.StructureClearance(pSpec);
        var rect = pPlacement.rect;
        var painted = 0;

        for(var x = rect.minX - clearance.left; x <= rect.maxX + clearance.right; ++x) {
            for(var y = rect.minY - clearance.top; y <= rect.maxY + clearance.bottom; ++y) {
                var kind = this.IsStructureGroundApronCell(pSpec, rect, x, y) ? "apron" : "clearance";
                if(this.PaintStructureGroundCell(pContext, x, y, pSpec, kind))
                    ++painted;
            }
        }

        return painted;
    };

    pIntegration.StructureCoverTarget = function(pContext) {
        if(pContext && pContext.Profile && typeof pContext.Profile.LiveStructureCoverTarget === "number")
            return Math.max(0, Math.floor(pContext.Profile.LiveStructureCoverTarget));
        if(pContext && pContext.Profile && typeof pContext.Profile.RouteStructureCoverTarget === "number")
            return Math.max(0, Math.floor(pContext.Profile.RouteStructureCoverTarget));
        return 12;
    };

    pIntegration.StructureCoverRadius = function(pContext) {
        if(pContext && pContext.Profile && typeof pContext.Profile.LiveStructureCoverRadius === "number")
            return Math.max(3, Math.floor(pContext.Profile.LiveStructureCoverRadius));
        if(this.StructureContextRadius)
            return Math.max(3, Math.floor(this.StructureContextRadius(pContext)));
        return 7;
    };

    pIntegration.StructureCoverProtectedPointNearby = function(pContext, pX, pY, pRadius) {
        var radiusSq = pRadius * pRadius;
        var anchors = pContext.Anchors || {};
        var keys = ["start", "support", "objective", "teamA", "teamB"];

        for(var index = 0; index < keys.length; ++index) {
            var point = anchors[keys[index]];
            if(!point)
                continue;
            var dx = point.x - pX;
            var dy = point.y - pY;
            if((dx * dx) + (dy * dy) <= radiusSq)
                return true;
        }

        var critical = pContext.CriticalPoints || [];
        for(var criticalIndex = 0; criticalIndex < critical.length; ++criticalIndex) {
            var cp = critical[criticalIndex];
            if(!cp)
                continue;
            var cdx = cp.x - pX;
            var cdy = cp.y - pY;
            if((cdx * cdx) + (cdy * cdy) <= radiusSq)
                return true;
        }

        return false;
    };

    pIntegration.StructureCoverCellCanStamp = function(pContext, pSpec, pPlacement, pX, pY) {
        if(!pContext || !pContext.Layers)
            return false;
        if(pX < 0 || pY < 0 || pX >= pContext.Width || pY >= pContext.Height)
            return false;

        var rect = pPlacement.rect;
        var clearance = this.StructureClearance(pSpec);
        if(pX >= rect.minX - clearance.left - 1 &&
            pX <= rect.maxX + clearance.right + 1 &&
            pY >= rect.minY - clearance.top - 1 &&
            pY <= rect.maxY + clearance.bottom + 1) {
            return false;
        }

        if(pPlacement.accessPoint) {
            var adx = pPlacement.accessPoint.x - pX;
            var ady = pPlacement.accessPoint.y - pY;
            if((adx * adx) + (ady * ady) <= 9)
                return false;
        }

        if(this.StructureCellIsWaterLike(pContext, pX, pY))
            return false;
        if(this.IsStructureCliffProtectedCell(pContext, pX, pY))
            return false;
        if(MapGen.Layers.Get(pContext.Layers.path, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.crossing, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.causeway, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.structureGround, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(pContext.Layers.occupied, pX, pY, 0))
            return false;
        if(this.StructureCoverProtectedPointNearby(pContext, pX, pY, 4))
            return false;

        return true;
    };

    pIntegration.MarkStructureCoverCell = function(pContext, pX, pY) {
        MapGen.Layers.Set(pContext.Layers.blocked, pX, pY, 1);
        MapGen.Layers.Set(pContext.Layers.keepClear, pX, pY, 0);
        MapGen.Layers.Set(pContext.Layers.coast, pX, pY, 0);
        MapGen.Layers.Set(pContext.Layers.riverBank, pX, pY, 0);
        MapGen.Layers.Set(pContext.Layers.forcedBank, pX, pY, 0);
        MapGen.Layers.Set(pContext.Layers.lakeShore, pX, pY, 0);
        MapGen.Layers.Set(pContext.Layers.outcrop, pX, pY, 0);
        MapGen.Layers.Set(pContext.Layers.terrainEdge, pX, pY, 0);
        if(!pContext.Layers.structureContextCover)
            pContext.Layers.structureContextCover = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
        MapGen.Layers.Set(pContext.Layers.structureContextCover, pX, pY, 1);
        if(pContext.Layers.owner)
            MapGen.Layers.ClaimCell(pContext.Layers.owner, pX, pY, MapGen.Layers.Owner.TREE);

        pContext.StructureTerrainDirty = true;
        pContext._forceFullStructureRender = true;
        this.MarkStructureTerrainDirtyCell(pContext, pX, pY);
    };

    pIntegration.StampStructureCoverPatch = function(pContext, pSpec, pPlacement, pCenter, pHalfWidth, pHalfHeight, pSalt) {
        var stamped = 0;
        // Half-extent floor lowered from 2 to 1 (was hardcoded; ApplyStructure-
        // ContextCover now passes 1+patch%2 / 1 to produce tighter clusters).
        // RCA 2026-06-13.
        var halfWidth = Math.max(1, Math.floor(pHalfWidth || 1));
        var halfHeight = Math.max(1, Math.floor(pHalfHeight || 1));

        for(var x = pCenter.x - halfWidth; x <= pCenter.x + halfWidth; ++x) {
            for(var y = pCenter.y - halfHeight; y <= pCenter.y + halfHeight; ++y) {
                if(!this.StructureCoverCellCanStamp(pContext, pSpec, pPlacement, x, y))
                    continue;
                if(MapGen.Layers.Get(pContext.Layers.blocked, x, y, 0))
                    continue;

                var onEdge = x === pCenter.x - halfWidth ||
                    x === pCenter.x + halfWidth ||
                    y === pCenter.y - halfHeight ||
                    y === pCenter.y + halfHeight;
                if(onEdge && (MapGen.Random.HashTile(pContext.Seed, x, y, 1821 + (pSalt || 0)) % 100) < 18)
                    continue;

                this.MarkStructureCoverCell(pContext, x, y);
                ++stamped;
            }
        }

        return stamped;
    };

    pIntegration.ApplyStructureContextCover = function(pContext, pSpec, pPlacement) {
        if(!pContext || !pContext.Profile || pContext.Profile.TerrainType !== Terrain.Types.Ice)
            return 0;
        if(!pPlacement || !pPlacement.rect)
            return 0;

        var rect = pPlacement.rect;
        var radius = this.StructureCoverRadius(pContext);
        var center = this.StructureRectCenter(rect);
        var stats = this.StructureContextStats(pContext, rect, radius);
        var minCover = this.StructureMinContextCoverFraction(pContext);
        var renderedMinCover = pContext.Profile && typeof pContext.Profile.MinRenderedStructureContextCoverFraction === "number" ?
            Math.max(0, pContext.Profile.MinRenderedStructureContextCoverFraction) :
            minCover * 0.60;
        var renderedSurvival = pContext.Profile && typeof pContext.Profile.LiveStructureRenderedCoverSurvivalRate === "number" ?
            Number(pContext.Profile.LiveStructureRenderedCoverSurvivalRate) :
            0.45;
        if(isNaN(renderedSurvival) || renderedSurvival <= 0)
            renderedSurvival = 0.45;
        renderedSurvival = Math.max(0.20, Math.min(1.0, renderedSurvival));
        var target = Math.max(
            this.StructureCoverTarget(pContext),
            Math.ceil((stats.cells || 0) * minCover),
            renderedMinCover > 0 ? Math.ceil(((stats.cells || 0) * renderedMinCover) / renderedSurvival) : 0
        );
        var contextCover = {
            radius: radius,
            cells: stats.cells || 0,
            tree: stats.tree || 0,
            cliff: stats.cliff || 0,
            current: (stats.tree || 0) + (stats.cliff || 0),
            minCover: Math.round(minCover * 1000) / 1000,
            renderedMinCover: Math.round(renderedMinCover * 1000) / 1000,
            renderedSurvival: Math.round(renderedSurvival * 1000) / 1000,
            target: target,
            deficit: 0,
            candidates: 0,
            stamped: 0
        };
        var maxStamp = pContext.Profile && typeof pContext.Profile.LiveStructureCoverMaxStamp === "number" ?
            Math.max(0, Math.floor(pContext.Profile.LiveStructureCoverMaxStamp)) :
            42;
        var minStamp = pContext.Profile && typeof pContext.Profile.LiveStructureCoverMinStamp === "number" ?
            Math.max(0, Math.floor(pContext.Profile.LiveStructureCoverMinStamp)) :
            18;
        if(target <= 0 || maxStamp <= 0) {
            pPlacement.contextCover = contextCover;
            return 0;
        }

        var current = stats.tree;
        var needed = target - current;
        // This routine runs once while preparing the terrain and again after
        // the live structure is committed. The old Math.max(minStamp, ...)
        // stamped at least 18 more trees on the second call even when the
        // first call had already met the target. Besides producing bunker
        // halos, that pushed otherwise valid ice maps over their final tree
        // ceiling. A minimum batch only applies when cover is genuinely
        // missing.
        var deficit = needed > 0 ?
            Math.min(maxStamp, Math.max(minStamp, needed)) : 0;
        contextCover.deficit = deficit;
        if(deficit <= 0) {
            pPlacement.contextCover = contextCover;
            return 0;
        }

        var candidates = [];
        // The cluster centers are placed at distance `preferred` from the
        // structure. With the previous 0.72 multiplier and radius=8 this put
        // patches at distance 5-6 — visible as a ring of 18-34 stamped trees
        // halo-ed around bunkers, overlapping nearby terrain instead of
        // reading as the bunker's own cover. Drop the multiplier to 0.45 so
        // patches sit at distance ~3-4 (still outside the structure rect +
        // clearance + access guard, which forbids cells closer than 3-4),
        // keeping total stamp count identical (validator unchanged) but
        // tightening the visible footprint to a believable bunker apron.
        // RCA 2026-06-13.
        var preferred = Math.max(3, Math.floor(radius * 0.45));
        // Door-aware cluster angles: original Cannon Fodder ice maps consistently
        // tuck bunkers into a forest patch on ONE SIDE — the back of the
        // building, opposite the door — leaving the approach open so soldiers
        // have firing lanes. With random cluster angles the cover stamps
        // formed a symmetric 360° halo, which read as "structure inside a
        // green ring" instead of "bunker against a tree line." Bias the
        // three cluster angles toward the back direction (vector from
        // accessPoint to center, extended outward), spread within a ±55°
        // (~0.96 rad) cone. If accessPoint is missing, fall back to the
        // hashed random angles so the system still works for path-less
        // placements. RCA 2026-06-13: seed 832202380 bunker at (67,30) had
        // 28 stamps fanned out around it; door-aware clustering produces a
        // ~3-cluster forest behind the bunker with the door side open.
        var clusterAngles = [];
        var backAngle = null;
        if(pPlacement.accessPoint) {
            var bdx = center.x - pPlacement.accessPoint.x;
            var bdy = center.y - pPlacement.accessPoint.y;
            if(bdx !== 0 || bdy !== 0)
                backAngle = Math.atan2(bdy, bdx);
        }
        for(var cluster = 0; cluster < 3; ++cluster) {
            if(backAngle !== null) {
                // Spread within ±55° of backAngle. Three clusters: one
                // straight back, two flanking on either side. The hash adds
                // small per-cluster jitter so seeds stay distinct.
                var spread = ((cluster === 0) ? 0 : ((cluster === 1) ? 0.96 : -0.96));
                var jitter = (((MapGen.Random.HashTile(pContext.Seed, center.x + cluster, center.y, 1801 + cluster) % 400) - 200) / 1000);
                clusterAngles.push(backAngle + spread + jitter);
            }
            else {
                clusterAngles.push(
                    ((MapGen.Random.HashTile(pContext.Seed, center.x + cluster, center.y, 1801 + cluster) % 6283) / 1000)
                );
            }
        }

        var stamped = 0;
        for(var patch = 0; patch < clusterAngles.length && stamped < deficit; ++patch) {
            var patchDistance = preferred + (patch % 2);
            var patchCenter = {
                x: Math.round(center.x + (Math.cos(clusterAngles[patch]) * patchDistance)),
                y: Math.round(center.y + (Math.sin(clusterAngles[patch]) * patchDistance))
            };

            // Patch half-extents reduced from (2+patch%2, 2) to (1+patch%2, 1)
            // — shrinks each stamped cluster from a 5×5 / 7×5 footprint to
            // a 3×3 / 5×3 footprint. The total stamp count is preserved
            // because StructureCoverCellCanStamp guards reject overlap with
            // structure clearance and the deficit-driven candidate-fill loop
            // below tops up any remaining stamp budget; the visible halo
            // around bunkers tightens to 1-2 cells of cover instead of 3-5.
            // RCA 2026-06-13: bunker on seed 832202380 (67,28) had a 5x5
            // stamped patch overlapping surrounding terrain.
            stamped += this.StampStructureCoverPatch(
                pContext,
                pSpec,
                pPlacement,
                patchCenter,
                1 + (patch % 2),
                1,
                patch
            );
        }

        for(var x = center.x - radius; x <= center.x + radius; ++x) {
            for(var y = center.y - radius; y <= center.y + radius; ++y) {
                if(!this.StructureCoverCellCanStamp(pContext, pSpec, pPlacement, x, y))
                    continue;
                if(MapGen.Layers.Get(pContext.Layers.blocked, x, y, 0))
                    continue;

                var dx = x - center.x;
                var dy = y - center.y;
                var distSq = (dx * dx) + (dy * dy);
                if(distSq < 9 || distSq > radius * radius)
                    continue;

                var distance = Math.sqrt(distSq);
                var angle = Math.atan2(dy, dx);
                if(angle < 0)
                    angle += Math.PI * 2;

                var bestAngle = Math.PI * 2;
                for(var ai = 0; ai < clusterAngles.length; ++ai) {
                    var delta = Math.abs(angle - clusterAngles[ai]);
                    if(delta > Math.PI)
                        delta = (Math.PI * 2) - delta;
                    if(delta < bestAngle)
                        bestAngle = delta;
                }

                // Score weights: angle alignment (18), distance from
                // structure (was: |distance-preferred|*5; now: distance*15
                // to monotonically prefer the closest legal cells), jitter.
                // The previous "preferred distance" weighting was meant to
                // place the halo at radius*0.72 = 5-6, which produced a
                // visible faraway halo around bunkers. Replacing with a
                // pure-closeness weight keeps the halo TIGHT against the
                // structure clearance — stamps fill the cells at distance
                // 3 first, then 4, etc. Total stamps unchanged (deficit
                // controls count); only their placement shifts inward.
                // RCA 2026-06-13.
                //
                // Door-side penalty: when an accessPoint exists, cells
                // sitting in the ±60° wedge in front of the door are pushed
                // far down the candidate list (score+50). The clusters
                // already concentrate stamps behind the structure; this
                // only matters for the deficit-fill tail where extra cover
                // would otherwise spill into the door wedge. Result: the
                // door side stays open for soldier firing lanes, matching
                // the original-engine ice map composition.
                var doorPenalty = 0;
                if(backAngle !== null) {
                    var doorAngle = backAngle + Math.PI;
                    var deltaDoor = Math.abs(angle - doorAngle);
                    if(deltaDoor > Math.PI)
                        deltaDoor = (Math.PI * 2) - deltaDoor;
                    if(deltaDoor < 1.05)
                        doorPenalty = 50;
                }
                candidates.push({
                    x: x,
                    y: y,
                    score: (bestAngle * 18) +
                        (distance * 15) +
                        doorPenalty +
                        ((MapGen.Random.HashTile(pContext.Seed, x, y, 1811) % 1000) / 1000)
                });
            }
        }

        candidates.sort(function(pLeft, pRight) {
            if(pLeft.score !== pRight.score)
                return pLeft.score - pRight.score;
            if(pLeft.x !== pRight.x)
                return pLeft.x - pRight.x;
            return pLeft.y - pRight.y;
        });

        contextCover.candidates = candidates.length;
        for(var index = 0; index < candidates.length && stamped < deficit; ++index) {
            this.MarkStructureCoverCell(pContext, candidates[index].x, candidates[index].y);
            ++stamped;
        }

        contextCover.stamped = stamped;
        pPlacement.contextCover = contextCover;
        return stamped;
    };

})(MapGen.Integration);
