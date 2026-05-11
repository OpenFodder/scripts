var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};

MapGen.Terrain.TilePolish = {

    Density: function(pContext) {
        var value = pContext.Profile.MicroStampDensity;
        if(value === undefined)
            return 1.0;

        return Math.max(0, value);
    },

    Stamps: function(pContext) {
        if(MapGen.Terrain.TileCatalog) {
            var stamps = MapGen.Terrain.TileCatalog.StampsForTerrain(pContext.Profile.TerrainType);
            if(stamps)
                return stamps;
        }

        var palette = MapGen.Terrain.TileCatalog.PaletteForTerrain(pContext.Profile.TerrainType);
        return {
            riverBend: palette.water,
            bankAccent: palette.riverBank,
            fordApproach: palette.path,
            hutClearing: palette.featureGround,
            baseEntrance: palette.featureGround,
            roughGround: palette.grass
        };
    },

    UsesOwnedBeachTerrain: function(pContext) {
        return !!(pContext &&
            pContext.GrammarLiveTerrain &&
            pContext.GrammarLiveTerrain.mode === "localized_beach_river");
    },

    Pick: function(pContext, pTiles, pX, pY, pSalt) {
        if(!pTiles || !pTiles.length)
            return 0;

        return pTiles[MapGen.Random.HashTile(pContext.Seed, pX, pY, pSalt || 0) % pTiles.length];
    },

    Bounds: function(pContext, pMargin) {
        var width = pContext ? pContext.Width : 0;
        var height = pContext ? pContext.Height : 0;
        var region = pContext ? pContext._iceRenderDirtyRegion : null;
        if(!region)
            return { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 };

        var margin = pMargin || 0;
        return {
            minX: Math.max(0, region.minX - margin),
            minY: Math.max(0, region.minY - margin),
            maxX: Math.min(width - 1, region.maxX + margin),
            maxY: Math.min(height - 1, region.maxY + margin)
        };
    },

    SetTile: function(pContext, pTiles, pX, pY, pTile, pProtected) {
        if(!MapGen.Layers.InBounds(pTiles, pX, pY))
            return false;
        if(pContext && pContext._iceRenderDirtyMask &&
            MapGen.Terrain && MapGen.Terrain.Smoothing && MapGen.Terrain.Smoothing.Ice &&
            !MapGen.Terrain.Smoothing.Ice.LocalRenderTileDirty(pContext, pX, pY))
            return false;
        if(MapGen.Layers.Get(pContext.Layers.occupied, pX, pY, 0))
            return false;
        if(pProtected && pProtected(pX, pY))
            return false;

        MapGen.Layers.Set(pTiles, pX, pY, pTile);
        return true;
    },

    SetGroundTile: function(pContext, pTiles, pX, pY, pTile, pChars, pProtected) {
        if(MapGen.Layers.Get(pContext.Layers.water, pX, pY, 0))
            return false;
        // Keep accents outside crossing surfaces and tree/cliff footprints,
        // including terrain whose blocked bit was cleared for navigation.
        if(MapGen.Layers.Get(pContext.Layers.crossing, pX, pY, 0))
            return false;
        var owner = MapGen.Layers.Get(pContext.Layers.owner, pX, pY, MapGen.Layers.Owner.OPEN);
        if(owner === MapGen.Layers.Owner.TREE || owner === MapGen.Layers.Owner.CLIFF)
            return false;
        if(this.UsesOwnedBeachTerrain(pContext) &&
            (MapGen.Layers.Get(pContext.Layers.coast, pX, pY, 0) ||
                MapGen.Layers.Get(pContext.Layers.riverBank, pX, pY, 0)))
            return false;
        if(MapGen.Layers.Get(pContext.Layers.blocked, pX, pY, 0))
            return false;
        if(pChars) {
            var role = MapGen.Layers.Get(pChars, pX, pY, null);
            if(role === "." || role === "~" || role === "W")
                return false;
        }

        return this.SetTile(pContext, pTiles, pX, pY, pTile, pProtected);
    },

    DirectionOffset: function(pDirection) {
        switch(pDirection) {
            case "north":
                return { x: 0, y: -1 };
            case "south":
                return { x: 0, y: 1 };
            case "west":
                return { x: -1, y: 0 };
            case "east":
                return { x: 1, y: 0 };
            default:
                return { x: 0, y: 1 };
        }
    },

    ApplyRiverBends: function(pContext, pTiles, pStamps, pProtected) {
        if(this.UsesOwnedBeachTerrain(pContext))
            return 0;

        var changed = 0;
        var density = this.Density(pContext);
        var waterTiles = MapGen.Terrain.TileCatalog.PaletteForTerrain(pContext.Profile.TerrainType).water;

        for(var riverIndex = 0; riverIndex < pContext.Rivers.length; ++riverIndex) {
            var points = pContext.Rivers[riverIndex].points || [];

            for(var index = 1; index < points.length - 1; ++index) {
                var previous = points[index - 1];
                var current = points[index];
                var next = points[index + 1];
                var dxA = current.x - previous.x;
                var dyA = current.y - previous.y;
                var dxB = next.x - current.x;
                var dyB = next.y - current.y;

                if(dxA === dxB && dyA === dyB)
                    continue;
                if(MapGen.Random.HashTile(pContext.Seed, current.x, current.y, 701) % 100 >= Math.floor(60 * density))
                    continue;
                if(!MapGen.Layers.Get(pContext.Layers.water, current.x, current.y, 0))
                    continue;
                // The water layer predates smoothing. Preserve its shoreline
                // corners and pruned dry cells; full-water accents only belong
                // on tiles that still render as a water interior.
                if(waterTiles.indexOf(MapGen.Layers.Get(pTiles, current.x, current.y, -1)) < 0)
                    continue;

                if(this.SetTile(pContext, pTiles, current.x, current.y, this.Pick(pContext, pStamps.riverBend, current.x, current.y, 702), pProtected))
                    ++changed;
            }
        }

        return changed;
    },

    ApplyBankAccents: function(pContext, pChars, pTiles, pStamps, pProtected) {
        var changed = 0;
        var density = this.Density(pContext);
        var bounds = this.Bounds(pContext, 0);

        for(var x = bounds.minX; x <= bounds.maxX; ++x) {
            for(var y = bounds.minY; y <= bounds.maxY; ++y) {
                if(!MapGen.Layers.Get(pContext.Layers.riverBank, x, y, 0))
                    continue;
                if(pChars) {
                    var role = MapGen.Layers.Get(pChars, x, y, null);
                    // riverBank layer covers both the bank char "~" itself and
                    // adjacent ground "#". On "~"/"W"/"." the transition rules
                    // already chose a neighbour-aware tile; stamping a fixed
                    // accent tile (e.g. ice tile 84 with bm 11111000) corrupts
                    // the shoreline. Restrict the stamp to ground cells.
                    if(role !== "#")
                        continue;
                }
                if(MapGen.Random.HashTile(pContext.Seed, x, y, 711) % 100 >= Math.floor(16 * density))
                    continue;

                if(this.SetGroundTile(pContext, pTiles, x, y, this.Pick(pContext, pStamps.bankAccent, x, y, 712), null, pProtected))
                    ++changed;
            }
        }

        return changed;
    },

    ApplyCrossingApproaches: function(pContext, pChars, pTiles, pStamps, pProtected) {
        var changed = 0;
        var bounds = this.Bounds(pContext, 0);

        for(var crossingIndex = 0; crossingIndex < pContext.Crossings.length; ++crossingIndex) {
            var crossing = pContext.Crossings[crossingIndex];
            var radius = Math.max(1, crossing.radius || 1);

            for(var x = Math.max(crossing.x - radius, bounds.minX); x <= Math.min(crossing.x + radius, bounds.maxX); ++x) {
                for(var y = Math.max(crossing.y - radius, bounds.minY); y <= Math.min(crossing.y + radius, bounds.maxY); ++y) {
                    if(!MapGen.Layers.Get(pContext.Layers.keepClear, x, y, 0) && !MapGen.Layers.Get(pContext.Layers.path, x, y, 0))
                        continue;
                    if(MapGen.Layers.Get(pContext.Layers.water, x, y, 0) && !MapGen.Layers.Get(pContext.Layers.crossing, x, y, 0))
                        continue;

                    if(this.SetGroundTile(pContext, pTiles, x, y, this.Pick(pContext, pStamps.fordApproach, x, y, 721), pChars, pProtected))
                        ++changed;
                }
            }
        }

        return changed;
    },

    ApplyStructureEntrances: function(pContext, pChars, pTiles, pStamps, pProtected) {
        var structures = pContext.Placements.structures || [];
        var changed = 0;

        for(var index = 0; index < structures.length; ++index) {
            var structure = structures[index];
            if(!structure.point)
                continue;

            var offset = this.DirectionOffset(structure.entrance);
            var entranceTiles = structure.template === "jungle_base" || structure.template === "barracks" || structure.template === "bunker" ?
                pStamps.baseEntrance : pStamps.hutClearing;
            var roughTiles = pStamps.roughGround;

            for(var step = 1; step <= 3; ++step) {
                var x = structure.point.x + (offset.x * step);
                var y = structure.point.y + (offset.y * step);

                if(this.SetGroundTile(pContext, pTiles, x, y, this.Pick(pContext, entranceTiles, x, y, 731), pChars, pProtected))
                    ++changed;

                if(step === 2 && (structure.template === "jungle_base" || structure.template === "barracks")) {
                    var sideA = { x: x + offset.y, y: y + offset.x };
                    var sideB = { x: x - offset.y, y: y - offset.x };

                    if(this.SetGroundTile(pContext, pTiles, sideA.x, sideA.y, this.Pick(pContext, roughTiles, sideA.x, sideA.y, 732), pChars, pProtected))
                        ++changed;
                    if(this.SetGroundTile(pContext, pTiles, sideB.x, sideB.y, this.Pick(pContext, roughTiles, sideB.x, sideB.y, 733), pChars, pProtected))
                        ++changed;
                }
            }
        }

        return changed;
    },

    ApplyPondAccents: function(pContext, pChars, pTiles, pStamps, pProtected) {
        var changed = 0;
        var density = this.Density(pContext);
        var bounds = this.Bounds(pContext, 0);

        for(var pondIndex = 0; pondIndex < pContext.Ponds.length; ++pondIndex) {
            var pond = pContext.Ponds[pondIndex];
            var radius = (pond.radius || 2) + 1;

            for(var x = Math.max(pond.x - radius, bounds.minX); x <= Math.min(pond.x + radius, bounds.maxX); ++x) {
                for(var y = Math.max(pond.y - radius, bounds.minY); y <= Math.min(pond.y + radius, bounds.maxY); ++y) {
                    if(!MapGen.Layers.Get(pContext.Layers.riverBank, x, y, 0))
                        continue;
                    if(pChars) {
                        var pondRole = MapGen.Layers.Get(pChars, x, y, null);
                        if(pondRole !== "#")
                            continue;
                    }
                    if(MapGen.Random.HashTile(pContext.Seed, x, y, 741) % 100 >= Math.floor(35 * density))
                        continue;

                    if(this.SetGroundTile(pContext, pTiles, x, y, this.Pick(pContext, pStamps.bankAccent, x, y, 742), null, pProtected))
                        ++changed;
                }
            }
        }

        return changed;
    },

    // ApplyBeaches / ApplyBeachHints removed (architecture v3 cleanup): both were
    // dead for every active profile. Ice/jungle have waterPolicy.coasts:false so
    // no coast cells exist; grammar_beach always sets GrammarLiveTerrain.mode
    // "localized_beach_river" (LiveBeachTerrain owns beach materialization), so
    // UsesOwnedBeachTerrain() short-circuited both. Verified byte-neutral.

    Apply: function(pContext, pChars, pTiles, pProtected) {
        var stamps = this.Stamps(pContext);
        var changed = 0;

        changed += this.ApplyRiverBends(pContext, pTiles, stamps, pProtected);
        changed += this.ApplyBankAccents(pContext, pChars, pTiles, stamps, pProtected);
        changed += this.ApplyCrossingApproaches(pContext, pChars, pTiles, stamps, pProtected);
        changed += this.ApplyStructureEntrances(pContext, pChars, pTiles, stamps, pProtected);
        changed += this.ApplyPondAccents(pContext, pChars, pTiles, stamps, pProtected);

        if(changed)
            MapGen.Context.AddLog(pContext, "Applied terrain tile polish stamps: " + changed);

        return changed;
    }
};
