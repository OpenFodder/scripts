var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};

MapGen.Terrain.Smoothing.Jungle = {

    Chars: {
        water: ".",
        ground: "#",
        path: "+",
        beach: "B",
        tree: "T",
        bank: "~"
    },

    Data: function() {
        var data = MapGen.Terrain.Smoothing.JungleData;
        var bitmasks = data && data.bitmasks;

        if(!bitmasks ||
            !bitmasks.bm_cf1_jungle_water_darkgrass ||
            !bitmasks.bm_cf1_jungle_lightgrass_darkgrass ||
            !bitmasks.bm_cf1_jungle_swamp_darkgrass ||
            !bitmasks.bm_cf1_jungle_tree) {
            return null;
        }

        return {
            waterDarkgrass: bitmasks.bm_cf1_jungle_water_darkgrass,
            lightgrassDarkgrass: bitmasks.bm_cf1_jungle_lightgrass_darkgrass,
            swampDarkgrass: bitmasks.bm_cf1_jungle_swamp_darkgrass,
            tree: bitmasks.bm_cf1_jungle_tree
        };
    },

    SupportsBeachTiles: function(pContext) {
        var catalog = MapGen.Terrain && MapGen.Terrain.TileCatalog;

        if(catalog && catalog.JungleBeachTilesAllowed)
            return catalog.JungleBeachTilesAllowed(pContext.Profile);

        return false;
    },

    UsesSub1ExplicitWaterTiles: function(pContext) {
        return pContext &&
            pContext.Profile &&
            pContext.Profile.TerrainType === Terrain.Types.Jungle &&
            Number(pContext.Profile.TerrainTypeSub || 0) === 1;
    },

    IsGrammarBeachProfile: function(pContext) {
        return pContext &&
            pContext.Profile &&
            pContext.Profile.TargetPackProfile === "grammar_beach";
    },

    // Bridge tiles are walkable gameplay cells, so Bridges.Build deliberately
    // removes them from Layers.water and marks them as crossings.  Visually,
    // however, the shipped maps smooth the river as one uninterrupted body
    // beneath the middle bridge rows.  Treat only those rows as water while
    // building the charmap; the final bridge overlay still replaces the water
    // tile art, while neighbouring shoreline tiles now keep a straight edge
    // against the bridge instead of curling inward onto grass.
    IsBridgeVisualWaterCell: function(pContext, pX, pY) {
        var bridges = pContext && pContext.Bridges ? pContext.Bridges : [];

        for(var index = 0; index < bridges.length; ++index) {
            var bridge = bridges[index];
            if(!bridge || bridge.axis !== "vertical" || !bridge.bounds ||
                typeof bridge.waterTop !== "number" || typeof bridge.waterBottom !== "number")
                continue;
            if(pY < bridge.waterTop || pY > bridge.waterBottom)
                continue;
            if(pX >= bridge.bounds.minX && pX <= bridge.bounds.maxX)
                return true;
        }

        return false;
    },

    TileSetForCell: function(pContext, pCell, pPalette) {
        if(this.UsesSub1ExplicitWaterTiles(pContext)) {
            if(pCell === this.Chars.water)
                return [297, 298, 316, 317];
            if(pCell === this.Chars.beach)
                return [256, 257];
            if(pCell === this.Chars.bank)
                return [146, 147, 148, 166, 187, 208, 227];
        }

        return pCell === this.Chars.water ? pPalette.water :
            pCell === this.Chars.tree ? pPalette.tree :
            pCell === this.Chars.beach ? pPalette.beach :
            pCell === this.Chars.path ? pPalette.path :
            pCell === this.Chars.bank ? pPalette.riverBank :
            pPalette.grass;
    },

    CellChar: function(pContext, pX, pY) {
        var layers = pContext.Layers;

        if(this.IsBridgeVisualWaterCell(pContext, pX, pY))
            return this.Chars.water;

        if(this.IsGrammarBeachMapm5WadeCell &&
            this.IsGrammarBeachMapm5WadeCell(pContext, pX, pY))
            // The mapm5 crossing is a gameplay wade, not a dirt ford. Repair
            // and route passes can clear Layers.water or set path/crossing on
            // parts of its reserved strip. Its recorded bounds still describe
            // the authored river span, so keep it visually wet and let the
            // movement layers carry walkability.
            return this.Chars.water;

        if(MapGen.Layers.Get(layers.crossing, pX, pY, 0))
            return this.Chars.path;

        if(MapGen.Layers.Get(layers.water, pX, pY, 0))
            return this.Chars.water;

        if(MapGen.Layers.Get(layers.structureGround, pX, pY, 0))
            return this.Chars.ground;

        if(this.SupportsBeachTiles(pContext) &&
            MapGen.Layers.Get(layers.coast, pX, pY, 0) &&
            this.IsCoastBackedByWater(pContext, pX, pY))
            return this.Chars.beach;

        if(MapGen.Layers.Get(layers.path, pX, pY, 0)) {
            // Original forest mazes read as grass corridors through trees, not
            // as a bright paved overlay on every navigable cell. Keep a little
            // authored path texture for visual guidance, while letting most of
            // the maze render as ordinary walkable jungle floor. The gameplay
            // path/owner layers are unchanged.
            if(pContext.Profile && pContext.Profile.JungleMazeForestFill === true) {
                var pathChance = Number(pContext.Profile.JungleMazePathOvergrowthChance);
                if(isNaN(pathChance))
                    pathChance = 0.38;
                var pathRoll = MapGen.Random.HashTile(pContext.Seed, pX, pY, 6401) / 4294967295;
                if(pathRoll >= Math.max(0, Math.min(1, pathChance)))
                    return this.Chars.ground;
            }
            return this.Chars.path;
        }

        if(MapGen.Layers.Get(layers.riverBank, pX, pY, 0)) {
            // A maze's continent shoreline can leave bank markers beneath
            // its continuous forest wall. Rendering those markers as the
            // sub-0 swamp palette exposes square red patches in the canopy
            // (especially at concave map-edge water joins). Keep the marker
            // for gameplay policy, but let the ordinary water/ground/tree
            // bitmasks own its visual transition.
            if(pContext.Profile && pContext.Profile.JungleMazeForestFill === true)
                return MapGen.Layers.Get(layers.blocked, pX, pY, 0) ?
                    this.Chars.tree : this.Chars.ground;
            return this.Chars.bank;
        }

        if(MapGen.Layers.Get(layers.blocked, pX, pY, 0))
            return this.Chars.tree;

        if(MapGen.Layers.Get(layers.terrainEdge, pX, pY, 0)) {
            // Maze soft-edge halos are routing/render bookkeeping around a
            // grass corridor. Emitting them as '+' causes FixCharMap to eat
            // every adjacent tree, widening narrow cuts by several cells.
            if(pContext.Profile && pContext.Profile.JungleMazeForestFill === true)
                return this.Chars.ground;
            return this.Chars.path;
        }

        return this.Chars.ground;
    },

    BuildCharMap: function(pContext) {
        var chars = MapGen.Layers.Create(pContext.Width, pContext.Height, this.Chars.ground);

        if(MapGen.Grammar && MapGen.Grammar.ReapplyLiveTerrainLayers)
            MapGen.Grammar.ReapplyLiveTerrainLayers(pContext);

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y)
                MapGen.Layers.Set(chars, x, y, this.CellChar(pContext, x, y));
        }

        MapGen.Terrain.Smoothing.Core.PromoteCharmapEdges(pContext, chars, {
            demote: [this.Chars.bank],
            water: [this.Chars.water],
            tree: this.Chars.tree,
            ground: this.Chars.ground
        });

        this.PromoteBeachBands(pContext, chars);
        this.ConstrainSub1BeachCharmap(pContext, chars);

        return chars;
    },

    BeachBandRadius: function(pContext) {
        var profile = pContext.Profile || {};
        var radius = Number(profile.BeachCharmapWaterBand);

        if(isNaN(radius))
            radius = 1;

        return Math.max(1, Math.min(3, Math.floor(radius)));
    },

    CoastBackedByWaterRadius: function(pContext) {
        var profile = pContext.Profile || {};
        var radius = Number(profile.CoastBeachWaterRadius);

        if(isNaN(radius) || radius < 1)
            radius = Math.max(2, Number(profile.BeachWidth || 3));

        return Math.max(1, Math.min(6, Math.floor(radius)));
    },

    LocalBeachRadius: function(pContext) {
        var radius = Number((pContext.Profile || {}).LocalBeachRadius);

        if(isNaN(radius) || radius < 1)
            radius = 18;

        return Math.max(6, Math.min(30, Math.floor(radius)));
    },

    HasNearbyChar: function(pChars, pX, pY, pChar, pRadius) {
        var radius = Math.max(1, Math.floor(pRadius || 1));

        for(var dx = -radius; dx <= radius; ++dx) {
            for(var dy = -radius; dy <= radius; ++dy) {
                if(dx === 0 && dy === 0)
                    continue;
                if(Math.max(Math.abs(dx), Math.abs(dy)) > radius)
                    continue;
                if(MapGen.Terrain.Smoothing.Core.GetChar(pChars, pX + dx, pY + dy, "") === pChar)
                    return true;
            }
        }

        return false;
    },

    HasNearbyLayer: function(pLayer, pX, pY, pRadius, pIncludeSelf) {
        if(!pLayer)
            return false;

        var radius = Math.max(0, Math.floor(pRadius || 0));

        for(var dx = -radius; dx <= radius; ++dx) {
            for(var dy = -radius; dy <= radius; ++dy) {
                if(!pIncludeSelf && dx === 0 && dy === 0)
                    continue;
                if(Math.max(Math.abs(dx), Math.abs(dy)) > radius)
                    continue;
                if(MapGen.Layers.Get(pLayer, pX + dx, pY + dy, 0))
                    return true;
            }
        }

        return false;
    },

    IsNearCoastLayer: function(pContext, pX, pY, pRadius) {
        return pContext &&
            pContext.Layers &&
            this.HasNearbyLayer(pContext.Layers.coast, pX, pY, pRadius, true);
    },

    IsCoastBackedByWater: function(pContext, pX, pY) {
        return pContext &&
            pContext.Layers &&
            this.HasNearbyLayer(pContext.Layers.water, pX, pY, this.CoastBackedByWaterRadius(pContext), true);
    },

    WaterBoundaryScore: function(pContext, pX, pY) {
        var layers = pContext.Layers;

        if(!MapGen.Layers.Get(layers.water, pX, pY, 0))
            return null;
        if(pX < 4 || pY < 4 || pX >= pContext.Width - 4 || pY >= pContext.Height - 4)
            return null;

        var hasLand = false;
        for(var dx = -1; dx <= 1 && !hasLand; ++dx) {
            for(var dy = -1; dy <= 1; ++dy) {
                if(dx === 0 && dy === 0)
                    continue;
                if(!MapGen.Layers.Get(layers.water, pX + dx, pY + dy, 0)) {
                    hasLand = true;
                    break;
                }
            }
        }

        if(!hasLand)
            return null;

        var centerX = pContext.Width * 0.5;
        var centerY = pContext.Height * 0.5;
        var dxCenter = (pX - centerX) / Math.max(1, centerX);
        var dyCenter = (pY - centerY) / Math.max(1, centerY);
        var centerBias = 1 - Math.min(1, Math.sqrt((dxCenter * dxCenter) + (dyCenter * dyCenter)));
        var random = MapGen.Random.HashTile(pContext.Seed, pX, pY, 6201) / 0xFFFFFFFF;

        return random + (centerBias * 0.35);
    },

    LocalBeachFocus: function(pContext) {
        if(pContext._jungleLocalBeachFocus !== undefined)
            return pContext._jungleLocalBeachFocus;

        var profile = pContext.Profile || {};
        var enabled = profile.TargetPackProfile === "grammar_beach" || profile.LocalBeachRadius !== undefined;

        if(!enabled || !this.SupportsBeachTiles(pContext) || !pContext.Layers || !pContext.Layers.water) {
            pContext._jungleLocalBeachFocus = null;
            return null;
        }

        var best = null;
        var bestScore = -1;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                var score = this.WaterBoundaryScore(pContext, x, y);
                if(score === null || score <= bestScore)
                    continue;

                bestScore = score;
                best = { x: x, y: y, score: score };
            }
        }

        pContext._jungleLocalBeachFocus = best;
        return best;
    },

    IsInLocalBeachZone: function(pContext, pX, pY) {
        var focus = this.LocalBeachFocus(pContext);
        if(!focus)
            return false;

        var radius = this.LocalBeachRadius(pContext);
        var dx = pX - focus.x;
        var dy = pY - focus.y;

        return (dx * dx) + (dy * dy) <= radius * radius;
    },

    CanPromoteBeachBandAt: function(pContext, pChars, pX, pY, pRadius) {
        if(this.IsGrammarBeachProfile(pContext))
            return this.IsNearCoastLayer(pContext, pX, pY, pRadius) &&
                (this.HasNearbyChar(pChars, pX, pY, this.Chars.water, pRadius) ||
                    this.HasNearbyLayer(pContext.Layers.water, pX, pY, pRadius, true));

        if(!this.IsNearCoastLayer(pContext, pX, pY, pRadius) &&
            !this.IsInLocalBeachZone(pContext, pX, pY))
            return false;

        return this.HasNearbyChar(pChars, pX, pY, this.Chars.water, pRadius) ||
            this.HasNearbyLayer(pContext.Layers.water, pX, pY, pRadius, true);
    },

    CanPromoteBeachBandCell: function(pContext, pX, pY) {
        var layers = pContext.Layers;

        if(pContext.GrammarLiveTerrain && pContext.GrammarLiveTerrain.mode === "localized_beach_river")
            return false;

        if(this.IsProtectedChar(pContext, pX, pY))
            return false;
        if(MapGen.Layers.Get(layers.structureGround, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(layers.blocked, pX, pY, 0))
            return false;

        return true;
    },

    PromoteBeachBands: function(pContext, pChars) {
        if(!this.SupportsBeachTiles(pContext))
            return 0;
        if(this.IsGrammarBeachProfile(pContext))
            return 0;

        var next = MapGen.Layers.Clone(pChars);
        var radius = this.BeachBandRadius(pContext);
        var changed = 0;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                var current = MapGen.Terrain.Smoothing.Core.GetChar(pChars, x, y, this.Chars.ground);

                if(current === this.Chars.ground &&
                    this.CanPromoteBeachBandCell(pContext, x, y) &&
                    this.CanPromoteBeachBandAt(pContext, pChars, x, y, radius)) {
                    MapGen.Layers.Set(next, x, y, this.Chars.beach);
                    ++changed;
                }
            }
        }

        if(changed) {
            for(var sx = 0; sx < pContext.Width; ++sx)
                pChars[sx] = next[sx];
        }

        return changed;
    },

    IsOuterCoverBuffer: function(pContext, pX, pY) {
        if(MapGen.Terrain && MapGen.Terrain.Cover && MapGen.Terrain.Cover.IsOuterCoverBuffer)
            return MapGen.Terrain.Cover.IsOuterCoverBuffer(pContext, pX, pY);

        return pX <= 0 || pY <= 0 || pX >= pContext.Width - 1 || pY >= pContext.Height - 1;
    },

    IsAuthoredLiveTerrainChar: function(pContext, pX, pY) {
        var live = pContext && pContext.GrammarLiveTerrain ? pContext.GrammarLiveTerrain : null;
        var layers = pContext && pContext.Layers ? pContext.Layers : {};

        if(!live || live.mode !== "localized_beach_river")
            return false;

        return MapGen.Layers.Get(layers.water, pX, pY, 0) ||
            MapGen.Layers.Get(layers.coast, pX, pY, 0) ||
            MapGen.Layers.Get(layers.riverBank, pX, pY, 0);
    },

    IsProtectedChar: function(pContext, pX, pY) {
        return this.IsOuterCoverBuffer(pContext, pX, pY) ||
            this.IsAuthoredLiveTerrainChar(pContext, pX, pY) ||
            MapGen.Layers.Get(pContext.Layers.keepClear, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.path, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.crossing, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.occupied, pX, pY, 0);
    },

    SurroundChars: function(pChars, pX, pY, pDefaultChar) {
        var offsets = [
            [-1, -1], [0, -1], [1, -1],
            [-1, 0], [1, 0],
            [-1, 1], [0, 1], [1, 1]
        ];
        var result = [];

        for(var index = 0; index < offsets.length; ++index)
            result.push(MapGen.Terrain.Smoothing.Core.GetChar(pChars, pX + offsets[index][0], pY + offsets[index][1], pDefaultChar || this.Chars.water));

        return result;
    },

    CharListContains: function(pChars, pValue) {
        for(var index = 0; index < pChars.length; ++index) {
            if(pChars[index] === pValue)
                return true;
        }

        return false;
    },

    FixCharMap: function(pContext, pChars) {
        var changed = 0;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(this.IsProtectedChar(pContext, x, y))
                    continue;

                var current = MapGen.Layers.Get(pChars, x, y, this.Chars.ground);
                var surrounding = this.SurroundChars(pChars, x, y, current);

                if(current === this.Chars.path && this.CharListContains(surrounding, this.Chars.water)) {
                    MapGen.Layers.Set(pChars, x, y, this.Chars.ground);
                    ++changed;
                }
                else if(current === this.Chars.tree &&
                    (this.CharListContains(surrounding, this.Chars.water) ||
                        this.CharListContains(surrounding, this.Chars.path) ||
                        this.CharListContains(surrounding, this.Chars.beach) ||
                        this.CharListContains(surrounding, this.Chars.bank))) {
                    MapGen.Layers.Set(pChars, x, y, this.Chars.ground);
                    ++changed;
                }
            }
        }

        return changed;
    },

    RemoveIsolatedPerimeterLandPockets: function(pContext, pChars) {
        var next = MapGen.Layers.Clone(pChars);
        var changed = 0;
        var width = pContext.Width;
        var height = pContext.Height;
        var offsets = [[0, -1], [1, 0], [0, 1], [-1, 0]];

        // The protected outer-cover buffer can preserve a diagonal pair of
        // grass cells even when every cardinal neighbour is water. Those
        // checkerboard islands have no shoreline shape and render as stray
        // grass squares in otherwise open corner water. Limit this repair to
        // the outer two cells so real inland islands remain untouched.
        for(var x = 0; x < width; ++x) {
            for(var y = 0; y < height; ++y) {
                if(x > 1 && y > 1 && x < width - 2 && y < height - 2)
                    continue;
                if(MapGen.Terrain.Smoothing.Core.GetChar(pChars, x, y, this.Chars.ground) === this.Chars.water)
                    continue;
                if(MapGen.Layers.Get(pContext.Layers.crossing, x, y, 0) ||
                    MapGen.Layers.Get(pContext.Layers.keepClear, x, y, 0) ||
                    MapGen.Layers.Get(pContext.Layers.occupied, x, y, 0))
                    continue;

                var neighbours = 0;
                var waterNeighbours = 0;
                for(var index = 0; index < offsets.length; ++index) {
                    var nx = x + offsets[index][0];
                    var ny = y + offsets[index][1];
                    if(nx < 0 || ny < 0 || nx >= width || ny >= height)
                        continue;

                    ++neighbours;
                    if(MapGen.Terrain.Smoothing.Core.GetChar(pChars, nx, ny, this.Chars.ground) === this.Chars.water)
                        ++waterNeighbours;
                }

                if(neighbours >= 2 && waterNeighbours === neighbours) {
                    MapGen.Layers.Set(next, x, y, this.Chars.water);
                    ++changed;
                }
            }
        }

        if(changed) {
            for(var copyX = 0; copyX < width; ++copyX)
                pChars[copyX] = next[copyX];
        }

        return changed;
    },

    RemoveSmallInteriorWaterFragments: function(pContext, pChars) {
        var maxTiles = Number(pContext.Profile.JungleMaxInteriorWaterFragmentTiles || 0);
        if(this.UsesSub1ExplicitWaterTiles(pContext) || maxTiles < 1)
            return 0;

        var width = pContext.Width;
        var height = pContext.Height;
        var visited = MapGen.Layers.Create(width, height, 0);
        var offsets = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        var removed = 0;

        // The sub-0 jungle atlas has no convincing shoreline for the tiny,
        // disconnected water flecks produced where noise masks barely overlap.
        // Remove only fully interior components below the profile threshold;
        // boundary water, crossings, paths and occupied areas remain authored.
        for(var startX = 0; startX < width; ++startX) {
            for(var startY = 0; startY < height; ++startY) {
                if(MapGen.Layers.Get(visited, startX, startY, 0) ||
                    MapGen.Layers.Get(pChars, startX, startY, this.Chars.ground) !== this.Chars.water)
                    continue;

                var queueX = [startX];
                var queueY = [startY];
                var component = [];
                var touchesBoundary = false;
                var protectedComponent = false;
                var head = 0;
                MapGen.Layers.Set(visited, startX, startY, 1);

                while(head < queueX.length) {
                    var x = queueX[head];
                    var y = queueY[head];
                    ++head;
                    component.push([x, y]);

                    if(x === 0 || y === 0 || x === width - 1 || y === height - 1)
                        touchesBoundary = true;
                    if(this.IsProtectedChar(pContext, x, y))
                        protectedComponent = true;

                    for(var offsetIndex = 0; offsetIndex < offsets.length; ++offsetIndex) {
                        var nx = x + offsets[offsetIndex][0];
                        var ny = y + offsets[offsetIndex][1];
                        if(nx < 0 || ny < 0 || nx >= width || ny >= height ||
                            MapGen.Layers.Get(visited, nx, ny, 0) ||
                            MapGen.Layers.Get(pChars, nx, ny, this.Chars.ground) !== this.Chars.water)
                            continue;

                        MapGen.Layers.Set(visited, nx, ny, 1);
                        queueX.push(nx);
                        queueY.push(ny);
                    }
                }

                if(touchesBoundary || protectedComponent || component.length > maxTiles)
                    continue;

                for(var cellIndex = 0; cellIndex < component.length; ++cellIndex) {
                    MapGen.Layers.Set(pChars, component[cellIndex][0], component[cellIndex][1], this.Chars.ground);
                    ++removed;
                }
            }
        }

        return removed;
    },

    RemoveUnrenderableNarrowWaterCells: function(pContext, pChars) {
        if(this.UsesSub1ExplicitWaterTiles(pContext) ||
            !pContext.Profile.JunglePruneUnrenderableNarrowWater)
            return 0;

        var data = this.Data();
        var entries = data.waterDarkgrass && data.waterDarkgrass.bitmask ?
            data.waterDarkgrass.bitmask : [];
        var core = MapGen.Terrain.Smoothing.Core;
        var cardinals = [1, 3, 4, 6];
        var rule = {
            center: this.Chars.water,
            ground: this.Chars.ground,
            extras: [this.Chars.path, this.Chars.bank, this.Chars.tree]
        };
        var removed = 0;

        // A one-cell stream pinch can put dry land on opposite sides of one
        // water cell. No sub-0 tile contains all of those shores, so keeping
        // it necessarily produces a square water tile. Prune a few layers of
        // unsupported tips/pinches, allowing adjacent cells to resolve to
        // ordinary shoreline tiles on the next pass.
        for(var pass = 0; pass < 3; ++pass) {
            var next = MapGen.Layers.Clone(pChars);
            var passRemoved = 0;

            for(var x = 0; x < pContext.Width; ++x) {
                for(var y = 0; y < pContext.Height; ++y) {
                    if(core.GetChar(pChars, x, y, "") !== this.Chars.water ||
                        this.IsAuthoredLiveTerrainChar(pContext, x, y) ||
                        MapGen.Layers.Get(pContext.Layers.crossing, x, y, 0))
                        continue;

                    var bitmask = core.TransitionBitmask(pChars, x, y, rule);
                    if(bitmask === null)
                        continue;

                    var hasCardinalLand = false;
                    var representable = false;
                    for(var cardinalIndex = 0; cardinalIndex < cardinals.length; ++cardinalIndex) {
                        if(bitmask.charAt(cardinals[cardinalIndex]) === "1") {
                            hasCardinalLand = true;
                            break;
                        }
                    }
                    if(!hasCardinalLand)
                        continue;

                    for(var entryIndex = 0; entryIndex < entries.length; ++entryIndex) {
                        var coversLand = true;
                        for(var compareIndex = 0; compareIndex < cardinals.length; ++compareIndex) {
                            var bitIndex = cardinals[compareIndex];
                            if(bitmask.charAt(bitIndex) === "1" &&
                                entries[entryIndex].bm.charAt(bitIndex) !== "1") {
                                coversLand = false;
                                break;
                            }
                        }
                        if(coversLand) {
                            representable = true;
                            break;
                        }
                    }

                    if(!representable) {
                        MapGen.Layers.Set(next, x, y, this.Chars.ground);
                        ++passRemoved;
                    }
                }
            }

            if(!passRemoved)
                break;
            for(var copyX = 0; copyX < pContext.Width; ++copyX)
                pChars[copyX] = next[copyX];
            removed += passRemoved;
        }

        return removed;
    },

    SmoothCharMap: function(pContext, pChars) {
        var self = this;
        var maze = pContext.Profile && pContext.Profile.JungleMazeForestFill === true;
        var beachPromoted = this.PromoteBeachBands(pContext, pChars);
        // The maze mask has already been authored at its final topology.
        // Generic cleanup removes tree end caps and the two CA passes round
        // narrow walls back into grass, so restrict maze smoothing to water
        // repairs and let the tree transition table shape the canopy art.
        var fixed = maze ? 0 : this.FixCharMap(pContext, pChars);
        beachPromoted += this.PromoteBeachBands(pContext, pChars);
        var beachConstrained = this.ConstrainSub1BeachCharmap(pContext, pChars);
        var supportsBeachTiles = this.SupportsBeachTiles(pContext);
        var grammarBeach = this.IsGrammarBeachProfile(pContext);
        var rules = supportsBeachTiles ?
            [
                { center: this.Chars.water, ground: this.Chars.beach, next: this.Chars.ground },
                { center: this.Chars.path, ground: this.Chars.ground, next: this.Chars.tree },
                { center: this.Chars.tree, ground: this.Chars.ground }
            ] :
            [
                { center: this.Chars.water, ground: this.Chars.ground, next: this.Chars.path },
                { center: this.Chars.path, ground: this.Chars.ground, next: this.Chars.tree },
                { center: this.Chars.tree, ground: this.Chars.ground }
            ];
        if(supportsBeachTiles && !grammarBeach)
            rules.splice(1, 0, { center: this.Chars.beach, ground: this.Chars.ground, next: this.Chars.water });
        var smoothed = maze ? 0 : MapGen.Terrain.Smoothing.Core.SmoothCharMap(
            pContext,
            pChars,
            rules,
            function(pX, pY) {
                return self.IsProtectedChar(pContext, pX, pY);
            },
            2
        );

        if(!maze)
            fixed += this.FixCharMap(pContext, pChars);
        beachPromoted += this.PromoteBeachBands(pContext, pChars);
        beachConstrained += this.ConstrainSub1BeachCharmap(pContext, pChars);
        fixed += this.RemoveSmallInteriorWaterFragments(pContext, pChars);
        fixed += this.RemoveUnrenderableNarrowWaterCells(pContext, pChars);
        fixed += this.RemoveSmallInteriorWaterFragments(pContext, pChars);
        fixed += this.RemoveIsolatedPerimeterLandPockets(pContext, pChars);
        MapGen.Context.AddLog(pContext, "Smoothed jungle char map: fixed=" + fixed + ", beach=" + beachPromoted + ", constrainedBeach=" + beachConstrained + ", smoothed=" + smoothed);

        return {
            fixed: fixed,
            beachPromoted: beachPromoted,
            beachConstrained: beachConstrained,
            smoothed: smoothed
        };
    },

    BuildBaseTiles: function(pContext, pChars) {
        var core = MapGen.Terrain.Smoothing.Core;
        var palette = MapGen.Terrain.TileCatalog.PaletteForTerrain(pContext.Profile.TerrainType);
        var tiles = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                var cell = MapGen.Layers.Get(pChars, x, y, this.Chars.ground);
                var tileSet = this.TileSetForCell(pContext, cell, palette);

                MapGen.Layers.Set(tiles, x, y, core.Pick(pContext, tileSet, x, y, cell.charCodeAt(0)));
            }
        }

        return tiles;
    },

    ApplyTransitionRuleIf: function(pContext, pChars, pTiles, pRule, pCondition) {
        var core = MapGen.Terrain.Smoothing.Core;
        var data = pRule.data;

        if(!data || !data.bitmask)
            return 0;

        var applied = 0;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(core.GetChar(pChars, x, y, "") !== pRule.center)
                    continue;
                if(pCondition && !pCondition(x, y))
                    continue;

                var bitmask = core.TransitionBitmask(pChars, x, y, pRule);
                if(bitmask === null)
                    continue;

                for(var entryIndex = 0; entryIndex < data.bitmask.length; ++entryIndex) {
                    var entry = data.bitmask[entryIndex];
                    if(entry.bm !== bitmask)
                        continue;

                    core.SetTile(pTiles, x, y, core.PickTileEntry(pContext, entry, x, y, pRule.salt || entryIndex));
                    ++applied;
                    break;
                }
            }
        }

        return applied;
    },

    RepairCardinalWaterTransitionGaps: function(pContext, pChars, pTiles, pData) {
        var core = MapGen.Terrain.Smoothing.Core;
        var entries = pData && pData.bitmask ? pData.bitmask : [];
        var fillTiles = { 326: true, 346: true };
        var cardinals = [1, 3, 4, 6]; // N, W, E, S in TransitionBitmask order.
        var rule = {
            center: this.Chars.water,
            ground: this.Chars.ground,
            extras: [this.Chars.path, this.Chars.bank, this.Chars.tree]
        };
        var changed = 0;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(core.GetChar(pChars, x, y, "") !== this.Chars.water)
                    continue;

                var currentTile = Number(MapGen.Layers.Get(pTiles, x, y, -1));
                if(!fillTiles[currentTile])
                    continue;

                var bitmask = core.TransitionBitmask(pChars, x, y, rule);
                if(bitmask === null)
                    continue;

                var hasCardinalLand = false;
                for(var cardinalIndex = 0; cardinalIndex < cardinals.length; ++cardinalIndex) {
                    if(bitmask.charAt(cardinals[cardinalIndex]) === "1") {
                        hasCardinalLand = true;
                        break;
                    }
                }
                if(!hasCardinalLand)
                    continue;

                var best = null;
                var bestScore = 100;
                for(var entryIndex = 0; entryIndex < entries.length; ++entryIndex) {
                    var entry = entries[entryIndex];
                    var cardinalExcess = 0;
                    var missesLand = false;
                    for(var compareIndex = 0; compareIndex < cardinals.length; ++compareIndex) {
                        var bitIndex = cardinals[compareIndex];
                        var actualLand = bitmask.charAt(bitIndex) === "1";
                        var entryLand = entry.bm.charAt(bitIndex) === "1";
                        if(actualLand && !entryLand)
                            missesLand = true;
                        else if(!actualLand && entryLand)
                            ++cardinalExcess;
                    }
                    if(missesLand)
                        continue;

                    var diagonalDistance = 0;
                    for(var diagonalIndex = 0; diagonalIndex < bitmask.length; ++diagonalIndex) {
                        if(diagonalIndex === 1 || diagonalIndex === 3 || diagonalIndex === 4 || diagonalIndex === 6)
                            continue;
                        if(entry.bm.charAt(diagonalIndex) !== bitmask.charAt(diagonalIndex))
                            ++diagonalDistance;
                    }

                    // Exact cardinal matches always win. If the atlas lacks
                    // that combination, a shape with one extra shore is safer
                    // than leaving a square full-water tile against dry land.
                    var score = cardinalExcess * 10 + diagonalDistance;
                    if(score < bestScore) {
                        best = entry;
                        bestScore = score;
                    }
                }

                if(!best)
                    continue;

                core.SetTile(pTiles, x, y, core.PickTileEntry(pContext, best, x, y, 11));
                ++changed;
            }
        }

        return changed;
    },

    ApplyTransitionRules: function(pContext, pChars, pTiles, pData) {
        var core = MapGen.Terrain.Smoothing.Core;
        var applied = 0;

        if(this.UsesSub1ExplicitWaterTiles(pContext)) {
            // Grass transitions are shared by both atlases. The sub1 water
            // dispatch used to bypass them, leaving square route bands.
            applied += core.ApplyTransitionRule(pContext, pChars, pTiles, {
                center: this.Chars.path, ground: this.Chars.ground,
                extras: [this.Chars.tree, this.Chars.bank],
                data: pData.lightgrassDarkgrass, salt: 20
            });
            return applied + this.ApplySub1PixelEdgeRules(pContext, pChars, pTiles);
        }

        applied += this.ApplyTransitionRuleIf(pContext, pChars, pTiles, {
            center: this.Chars.water,
            ground: this.Chars.ground,
            extras: [this.Chars.path, this.Chars.bank, this.Chars.tree],
            data: pData.waterDarkgrass,
            salt: 10
        });
        applied += this.RepairCardinalWaterTransitionGaps(
            pContext,
            pChars,
            pTiles,
            pData.waterDarkgrass
        );

        applied += core.ApplyTransitionRule(pContext, pChars, pTiles, {
            center: this.Chars.path,
            ground: this.Chars.ground,
            extras: [this.Chars.tree, this.Chars.bank],
            data: pData.lightgrassDarkgrass,
            salt: 20
        });

        applied += core.ApplyTransitionRule(pContext, pChars, pTiles, {
            center: this.Chars.bank,
            ground: this.Chars.ground,
            extras: [this.Chars.path, this.Chars.tree],
            data: pData.swampDarkgrass,
            salt: 30
        });

        return applied;
    },

    IsTreeTileProtected: function(pContext, pX, pY) {
        return this.IsOuterCoverBuffer(pContext, pX, pY) ||
            MapGen.Layers.Get(pContext.Layers.keepClear, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.path, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.crossing, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.water, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.coast, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.occupied, pX, pY, 0);
    },

    OverlayProtectedTiles: function(pContext, pTiles) {
        var palette = MapGen.Terrain.TileCatalog.PaletteForTerrain(pContext.Profile.TerrainType);
        var protectedCount = 0;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(MapGen.Layers.Get(pContext.Layers.crossing, x, y, 0)) {
                    // mapm5 has no horizontal sub1 bridge artwork. Its route
                    // crossing is a gameplay-only wade and CellChar already
                    // renders it as water. Do not overwrite that completed
                    // shoreline with the generic grass ford tile (20).
                    if(this.IsGrammarBeachMapm5WadeCell &&
                        this.IsGrammarBeachMapm5WadeCell(pContext, x, y))
                        continue;
                    MapGen.Layers.Set(pTiles, x, y, MapGen.Render.PickTile(palette.ford, pContext, x, y, 41));
                    ++protectedCount;
                    continue;
                }

            }
        }

        return protectedCount;
    },

    OverlayGrammarLiveTerrainTiles: function(pContext, pChars, pTiles) {
        var live = pContext.GrammarLiveTerrain;
        var core = MapGen.Terrain.Smoothing.Core;
        var cells = live && live.dynamicCells ? live.dynamicCells : [];
        var applied = 0;

        if(!live || live.mode !== "localized_beach_river" || !cells.length)
            return 0;

        for(var index = 0; index < cells.length; ++index) {
            var cell = cells[index];
            var x = Math.round(cell.x);
            var y = Math.round(cell.y);
            var ch = core.GetChar(pChars, x, y, this.Chars.ground);
            var allowAuthoredTerrain = cell.allowAuthoredTerrain === true;

            if(MapGen.Layers.Get(pContext.Layers.path, x, y, 0) ||
                MapGen.Layers.Get(pContext.Layers.crossing, x, y, 0))
                continue;

            if(cell.kind === "sinking") {
                if(ch !== this.Chars.bank &&
                    !MapGen.Layers.Get(pContext.Layers.riverBank, x, y, 0))
                    continue;

                // 107/167 are solid quicksand interiors. Painting one onto a
                // boundary cell after the sub-1 edge pass erases its curved
                // quicksand-to-grass transition and exposes a square 16px
                // edge. Keep animated sinking art at least one cardinal cell
                // inside the patch; the atlas owns every perimeter cell.
                if(!MapGen.Layers.Get(pContext.Layers.riverBank, x, y - 1, 0) ||
                    !MapGen.Layers.Get(pContext.Layers.riverBank, x + 1, y, 0) ||
                    !MapGen.Layers.Get(pContext.Layers.riverBank, x, y + 1, 0) ||
                    !MapGen.Layers.Get(pContext.Layers.riverBank, x - 1, y, 0))
                    continue;

                core.SetTile(pTiles, x, y, cell.tileId);
                ++applied;
                continue;
            }

            if(cell.kind !== "building" &&
                (MapGen.Layers.Get(pContext.Layers.keepClear, x, y, 0) ||
                    MapGen.Layers.Get(pContext.Layers.occupied, x, y, 0)))
                continue;

            if(!allowAuthoredTerrain && this.IsAuthoredLiveTerrainChar(pContext, x, y))
                continue;
            if(ch === this.Chars.water || ch === this.Chars.path)
                continue;
            if(ch === this.Chars.tree && cell.kind !== "blocked" && cell.kind !== "building")
                continue;
            if((cell.kind === "blocked" || cell.kind === "building") && (ch === this.Chars.beach || ch === this.Chars.bank))
                continue;

            core.SetTile(pTiles, x, y, cell.tileId);
            ++applied;
        }

        return applied;
    },

    Render: function(pContext) {
        if(pContext.Profile.TerrainType !== Terrain.Types.Jungle)
            return null;

        var data = this.Data();
        if(!data)
            return null;

        var self = this;
        var chars = MapGen.Context.Time(pContext, "Smoothing.Jungle.BuildCharMap", function() {
            return self.BuildCharMap(pContext);
        });
        var charSmoothing = MapGen.Context.Time(pContext, "Smoothing.Jungle.SmoothCharMap", function() {
            return self.SmoothCharMap(pContext, chars);
        });
        var tiles = MapGen.Context.Time(pContext, "Smoothing.Jungle.BuildBaseTiles", function() {
            return self.BuildBaseTiles(pContext, chars);
        });
        var transitionCount = MapGen.Context.Time(pContext, "Smoothing.Jungle.Transitions", function() {
            return self.ApplyTransitionRules(pContext, chars, tiles, data);
        });
        var treeCount = MapGen.Context.Time(pContext, "Smoothing.Jungle.Trees", function() {
            return MapGen.Terrain.Smoothing.Core.ApplyTreeRules(
                pContext,
                chars,
                tiles,
                data.tree,
                function(pX, pY) {
                    return self.IsTreeTileProtected(pContext, pX, pY);
                }
            );
        });
        var polishCount = MapGen.Context.Time(pContext, "Smoothing.Jungle.Polish", function() {
            return MapGen.Terrain.TilePolish ? MapGen.Terrain.TilePolish.Apply(pContext, chars, tiles) : 0;
        }) || 0;
        var grammarLiveCount = MapGen.Context.Time(pContext, "Smoothing.Jungle.GrammarLiveTiles", function() {
            return self.OverlayGrammarLiveTerrainTiles(pContext, chars, tiles);
        }) || 0;
        var grammarBeachBankPolishCount = MapGen.Context.Time(pContext, "Smoothing.Jungle.GrammarBeachBankFinal", function() {
            return self.RepairSub1GrammarBeachDryGrassEdges(pContext, chars, tiles);
        }) || 0;
        var protectedCount = MapGen.Context.Time(pContext, "Smoothing.Jungle.OverlayProtected", function() {
            return self.OverlayProtectedTiles(pContext, tiles);
        });
        return {
            Tiles: tiles,
            Chars: chars,
            Backend: "jungle_bitmask",
            CharFixes: charSmoothing.fixed,
            CharSmoothChanges: charSmoothing.smoothed,
            TransitionTiles: transitionCount,
            TreeTiles: treeCount,
            ProtectedTiles: protectedCount,
            PolishTiles: polishCount,
            GrammarBeachBankPolishTiles: grammarBeachBankPolishCount,
            GrammarLiveTiles: grammarLiveCount,
            GrammarLiveBeachTiles: 0
        };
    }
};
