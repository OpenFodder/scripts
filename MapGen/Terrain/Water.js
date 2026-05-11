var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};

MapGen.Terrain.Water = {

    IsJungle: function(pContext) {
        return pContext.Profile &&
            typeof Terrain !== "undefined" &&
            pContext.Profile.TerrainType === Terrain.Types.Jungle;
    },

    NearCrossing: function(pContext, pX, pY, pExtraRadius) {
        var crossings = pContext.Crossings || [];

        for(var index = 0; index < crossings.length; ++index) {
            var crossing = crossings[index];
            var radius = (crossing.radius || 1) + (pExtraRadius || 0);
            var dx = crossing.x - pX;
            var dy = crossing.y - pY;

            if((dx * dx) + (dy * dy) <= radius * radius)
                return true;
        }

        return false;
    },

    NearRiver: function(pContext, pX, pY, pExtraRadius) {
        var rivers = pContext.Rivers || [];

        for(var riverIndex = 0; riverIndex < rivers.length; ++riverIndex) {
            var river = rivers[riverIndex];
            var points = river.points || [];
            var radius = Math.max(1, river.width || 1) + (pExtraRadius || 0);
            var radiusSq = radius * radius;

            for(var pointIndex = 0; pointIndex < points.length; ++pointIndex) {
                var point = points[pointIndex];
                var dx = point.x - pX;
                var dy = point.y - pY;

                if((dx * dx) + (dy * dy) <= radiusSq)
                    return true;
            }
        }

        return false;
    },

    NearPond: function(pContext, pX, pY, pExtraRadius) {
        var ponds = pContext.Ponds || [];

        for(var index = 0; index < ponds.length; ++index) {
            var pond = ponds[index];
            var radius = Math.max(1, pond.radius || 1) + (pExtraRadius || 0);
            var dx = pond.x - pX;
            var dy = pond.y - pY;

            if((dx * dx) + (dy * dy) <= radius * radius)
                return true;
        }

        return false;
    },

    ShouldMarkBank: function(pContext, pX, pY) {
        if(MapGen.Layers.Get(pContext.Layers.keepClear, pX, pY, 0) || MapGen.Layers.Get(pContext.Layers.path, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(pContext.Layers.occupied, pX, pY, 0))
            return false;

        if(this.IsJungle(pContext)) {
            if(this.NearCrossing(pContext, pX, pY, 2))
                return false;
            if(this.NearRiver(pContext, pX, pY, 2))
                return false;
            if(!this.NearPond(pContext, pX, pY, 1))
                return false;

            return (MapGen.Random.HashTile(pContext.Seed, pX, pY, 913) % 100) < 10;
        }

        return true;
    },

    MarkBanks: function(pContext) {
        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(MapGen.Layers.Get(pContext.Layers.water, x, y, 0))
                    continue;
                if(MapGen.Layers.Get(pContext.Layers.coast, x, y, 0))
                    continue;
                // Skip cliff-reservation cells (Option A,
                // [[mapgen_cliff_option_a_staged]]). The Set(riverBank,...)
                // at L107 below bypasses the owner grid; without this guard,
                // a bank ring inside the reservation gets PlateauCliffs.
                // cellBlocksStamp to reject every body column at planning
                // time. cliffReserve=0 on non-ice — byte-identical no-op.
                if(MapGen.Layers.Get(pContext.Layers.cliffReserve, x, y, 0))
                    continue;

                var nearWater = false;

                for(var nx = x - 1; nx <= x + 1 && !nearWater; ++nx) {
                    for(var ny = y - 1; ny <= y + 1; ++ny) {
                        if(MapGen.Layers.Get(pContext.Layers.water, nx, ny, 0)) {
                            nearWater = true;
                            break;
                        }
                    }
                }

                if(nearWater && this.ShouldMarkBank(pContext, x, y))
                    MapGen.Layers.Set(pContext.Layers.riverBank, x, y, 1);
            }
        }

        MapGen.Context.AddLog(pContext, "Marked river banks");
    },

    ApplyCrossings: function(pContext) {
        for(var index = 0; index < pContext.Crossings.length; ++index) {
            var crossing = pContext.Crossings[index];
            this.StampCrossing(pContext, crossing);
        }

        MapGen.Context.AddLog(pContext, "Applied water crossings");
    },

    SupportsCrossings: function(pContext) {
        var catalog = MapGen.Terrain && MapGen.Terrain.TileCatalog;
        if(!catalog || !catalog.SupportsWaterFeature)
            return true;

        return catalog.SupportsWaterFeature(pContext.Profile.TerrainType, "crossings");
    },

    StampCrossing: function(pContext, pCrossing) {
        if(pCrossing.axis === "horizontal" || pCrossing.axis === "vertical") {
            this.StampCrossingStrip(pContext, pCrossing);
            return;
        }

        MapGen.Layers.StampDisc(
            pContext.Layers.keepClear,
            pCrossing.x,
            pCrossing.y,
            pCrossing.radius,
            1
        );

        if(pCrossing.surface === "ford" && this.SupportsCrossings(pContext)) {
            MapGen.Layers.StampDisc(
                pContext.Layers.crossing,
                pCrossing.x,
                pCrossing.y,
                Math.max(1, Math.floor(pCrossing.radius * 0.75)),
                1
            );
        }
    },

    StampCrossingStrip: function(pContext, pCrossing) {
        var length = Math.max(2, Math.floor(pCrossing.length || ((pCrossing.radius || 1) * 2)));
        var halfWidth = Math.max(1, Math.floor(pCrossing.halfWidth || 1));
        var supportsCrossings = this.SupportsCrossings(pContext);

        for(var offset = -length; offset <= length; ++offset) {
            for(var side = -halfWidth; side <= halfWidth; ++side) {
                var x = pCrossing.x + (pCrossing.axis === "horizontal" ? offset : side);
                var y = pCrossing.y + (pCrossing.axis === "vertical" ? offset : side);

                if(pCrossing.role === "grammar_beach_mapm5_wade" &&
                    (x < Number(pCrossing.waterMinX) || x > Number(pCrossing.waterMaxX)))
                    continue;

                if(pCrossing.role !== "grammar_beach_mapm5_wade" ||
                    MapGen.Layers.Get(pContext.Layers.water, x, y, 0))
                    MapGen.Layers.Set(pContext.Layers.keepClear, x, y, 1);

                // A ford marks only the wet channel. Painting the full
                // reservation strip put the crossing tile onto dry approach
                // cells, producing long square-ended blue bars and isolated
                // blue blocks beside otherwise organic banks.
                if(pCrossing.surface === "ford" && supportsCrossings &&
                    MapGen.Layers.Get(pContext.Layers.water, x, y, 0))
                    MapGen.Layers.Set(pContext.Layers.crossing, x, y, 1);
            }
        }

        // A bridge replaces the broad provisional ford strip. Rebuild only
        // its exact saved footprint when derived layers are refreshed after a
        // repair; painting the entire approach as crossing uses water-looking
        // tile 20 on otherwise dry jungle grass.
        if(pCrossing.surface === "bridge" && pCrossing.bridgeBounds) {
            var bounds = pCrossing.bridgeBounds;
            for(var bridgeX = bounds.minX; bridgeX <= bounds.maxX; ++bridgeX) {
                for(var bridgeY = bounds.minY; bridgeY <= bounds.maxY; ++bridgeY) {
                    MapGen.Layers.Set(pContext.Layers.crossing, bridgeX, bridgeY, 1);
                    MapGen.Layers.Set(pContext.Layers.keepClear, bridgeX, bridgeY, 1);
                }
            }
        }
    },

    HasCrossableRiver: function(pContext) {
        var rivers = pContext.Rivers || [];
        for(var i = 0; i < rivers.length; ++i)
            if(rivers[i].requiresCrossing !== false)
                return true;
        return false;
    },

    EnforceSoftHazardPolicy: function(pContext) {
        var cleared = 0;
        var layers = pContext.Layers;
        var isSub0Jungle = this.IsJungle(pContext) &&
            Number((pContext.Profile || {}).TerrainTypeSub || 0) === 0;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(!MapGen.Layers.Get(layers.riverBank, x, y, 0))
                    continue;

                if(MapGen.Layers.Get(layers.keepClear, x, y, 0) ||
                    MapGen.Layers.Get(layers.path, x, y, 0) ||
                    MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                    MapGen.Layers.Get(layers.occupied, x, y, 0) ||
                    MapGen.Layers.Get(layers.coast, x, y, 0)) {
                    MapGen.Layers.Set(layers.riverBank, x, y, 0);
                    ++cleared;
                }
            }
        }

        // A single riverBank cell renders as the solid 107/167 quicksand
        // interior because there is no neighbouring bank cell from which the
        // swamp bitmask can select an edge. The old pond/edge-biome painters
        // deliberately sampled bank cells independently, so singleton and
        // tiny disconnected fragments were common. They read as accidental
        // red squares and also create invisible one-cell sink hazards.
        //
        // Sub-0 jungle hazards are optional accents: if a connected bank
        // component is too small to carry a readable interior plus border,
        // fold it back into ordinary ground. Beach/sub-1 has a separate,
        // explicit quicksand patch painter and is intentionally unaffected.
        if(isSub0Jungle) {
            var visited = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
            var offsets = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            var minimumPatchTiles = 4;

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

                        for(var offsetIndex = 0; offsetIndex < offsets.length; ++offsetIndex) {
                            var nx = point.x + offsets[offsetIndex][0];
                            var ny = point.y + offsets[offsetIndex][1];
                            if(nx < 0 || ny < 0 || nx >= pContext.Width || ny >= pContext.Height)
                                continue;
                            if(MapGen.Layers.Get(visited, nx, ny, 0) ||
                                !MapGen.Layers.Get(layers.riverBank, nx, ny, 0))
                                continue;

                            MapGen.Layers.Set(visited, nx, ny, 1);
                            queue.push({ x: nx, y: ny });
                        }
                    }

                    if(component.length >= minimumPatchTiles)
                        continue;

                    for(var componentIndex = 0; componentIndex < component.length; ++componentIndex) {
                        MapGen.Layers.Set(
                            layers.riverBank,
                            component[componentIndex].x,
                            component[componentIndex].y,
                            0
                        );
                        ++cleared;
                    }
                }
            }
        }

        if(cleared)
            MapGen.Context.AddLog(pContext, "Cleared protected or undersized soft-hazard bank tiles: " + cleared);

        return cleared;
    },

    HasWaterIn3x3: function(pContext, pX, pY) {
        for(var dy = -1; dy <= 1; ++dy) {
            for(var dx = -1; dx <= 1; ++dx) {
                if(MapGen.Layers.Get(pContext.Layers.water, pX + dx, pY + dy, 0))
                    return true;
            }
        }
        return false;
    },

    IsForcedBankProtected: function(pContext, pX, pY) {
        var layers = pContext.Layers;
        return MapGen.Layers.Get(layers.water, pX, pY, 0) ||
            MapGen.Layers.Get(layers.keepClear, pX, pY, 0) ||
            MapGen.Layers.Get(layers.path, pX, pY, 0) ||
            MapGen.Layers.Get(layers.crossing, pX, pY, 0) ||
            MapGen.Layers.Get(layers.occupied, pX, pY, 0) ||
            MapGen.Layers.Get(layers.coast, pX, pY, 0);
    },

    CanWidenStepSide: function(pContext, pX, pY, pDx) {
        var nx = pX + pDx;

        if(nx < 0 || nx >= pContext.Width)
            return false;
        if(this.IsForcedBankProtected(pContext, nx, pY))
            return false;
        // Don't widen onto a cell that would already be ~ (3x3 of water).
        if(this.HasWaterIn3x3(pContext, nx, pY))
            return false;

        // Step detection: the bank must continue diagonally past nx — i.e.
        // (nx, y+1) or (nx, y-1) must itself be near water. Without this
        // check we'd widen on straight horizontal bank rows where there is
        // no diagonal step.
        return this.HasWaterIn3x3(pContext, nx, pY + 1) ||
            this.HasWaterIn3x3(pContext, nx, pY - 1);
    },

    WidenStepBanks: function(pContext) {
        var marked = 0;

        for(var y = 1; y < pContext.Height - 1; ++y) {
            for(var x = 1; x < pContext.Width - 1; ++x) {
                if(MapGen.Layers.Get(pContext.Layers.water, x, y, 0))
                    continue;
                // Skip source cells inside the cliff reservation (Option A,
                // [[mapgen_cliff_option_a_staged]]). cliffReserve=0 on non-
                // ice — byte-identical no-op.
                if(MapGen.Layers.Get(pContext.Layers.cliffReserve, x, y, 0))
                    continue;
                // Only iterate cells that are themselves ~ (3x3-of-water).
                if(!this.HasWaterIn3x3(pContext, x, y))
                    continue;

                // Periodic spacing so we don't double the bank thickness
                // along the entire river. Hash-keyed for determinism.
                if((MapGen.Random.HashTile(pContext.Seed, x, y, 1517) % 4) !== 0)
                    continue;

                var canRight = this.CanWidenStepSide(pContext, x, y, +1);
                var canLeft = this.CanWidenStepSide(pContext, x, y, -1);

                var dx = 0;
                if(canRight && canLeft)
                    dx = ((MapGen.Random.HashTile(pContext.Seed, x, y, 2113) % 2) === 0) ? +1 : -1;
                else if(canRight)
                    dx = +1;
                else if(canLeft)
                    dx = -1;
                else
                    continue;

                if(MapGen.Layers.Get(pContext.Layers.forcedBank, x + dx, y, 0))
                    continue;
                // Also skip the TARGET (neighbour) cell if it's inside the
                // cliff reservation — the Set below writes at (x+dx, y), not
                // (x, y), so the source-cell guard above isn't enough.
                if(MapGen.Layers.Get(pContext.Layers.cliffReserve, x + dx, y, 0))
                    continue;

                MapGen.Layers.Set(pContext.Layers.forcedBank, x + dx, y, 1);
                ++marked;
            }
        }

        if(marked)
            MapGen.Context.AddLog(pContext, "Widened diagonal step banks: " + marked);
    },

    Build: function(pContext) {
        this.MarkBanks(pContext);
        this.ApplyCrossings(pContext);
        this.WidenStepBanks(pContext);
        this.EnforceSoftHazardPolicy(pContext);

        // Cliff-reservation cleanup ([[mapgen_cliff_option_a_staged]]).
        // Even with the upstream guards, MarkBanks/ApplyCrossings/
        // WidenStepBanks can each smear bits into the reservation on
        // unusual seeds (e.g. near-water cells flipping forcedBank via a
        // diagonal step into the strip). Run the chokepoint cleanup so
        // PlateauCliffs.cellBlocksStamp sees a clean reserved band.
        // No-op on non-ice (cliffReserve never written).
        if(MapGen.Layout && MapGen.Layout.Rivers && MapGen.Layout.Rivers.ProtectReservedCliff)
            MapGen.Layout.Rivers.ProtectReservedCliff(pContext);

        return pContext;
    }
};
