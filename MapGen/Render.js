var MapGen = MapGen || {};

MapGen.Render = {

    HashTile: function(pSeed, pX, pY, pSalt) {
        return MapGen.Random.HashTile(pSeed, pX, pY, pSalt);
    },

    PickTile: function(pTiles, pContext, pX, pY, pSalt) {
        if(!pTiles || !pTiles.length)
            return 0;

        return pTiles[this.HashTile(pContext.Seed, pX, pY, pSalt) % pTiles.length];
    },

    ClassifyTile: function(pContext, pX, pY) {
        var layers = pContext.Layers;

        if(MapGen.Layers.Get(layers.occupied, pX, pY, 0))
            return "featureGround";

        if(MapGen.Layers.Get(layers.crossing, pX, pY, 0))
            return "crossing";

        if(!MapGen.Layers.Get(layers.water, pX, pY, 0) &&
            MapGen.Layers.Get(layers.blocked, pX, pY, 0) &&
            MapGen.Layers.Get(layers.perimeterCover, pX, pY, 0))
            return "tree";

        if(MapGen.Layers.Get(layers.coast, pX, pY, 0) && !MapGen.Layers.Get(layers.water, pX, pY, 0)) {
            var catalog = MapGen.Terrain && MapGen.Terrain.TileCatalog;
            var supportsCoast = catalog && catalog.SupportsWaterFeatureForProfile ?
                catalog.SupportsWaterFeatureForProfile(pContext.Profile, "coasts") :
                true;

            return supportsCoast ? "coast" : "grass";
        }

        if(MapGen.Layers.Get(layers.water, pX, pY, 0))
            return "water";

        if(MapGen.Layers.Get(layers.structureGround, pX, pY, 0))
            return "grass";

        if(MapGen.Layers.Get(layers.riverBank, pX, pY, 0))
            return "riverBank";

        if(MapGen.Layers.Get(layers.blocked, pX, pY, 0))
            return "tree";

        if(MapGen.Layers.Get(layers.terrainEdge, pX, pY, 0))
            return "terrainEdge";

        return "grass";
    },

    EmptyCounts: function() {
        return {
            grass: 0,
            tree: 0,
            water: 0,
            crossing: 0,
            riverBank: 0,
            coast: 0,
            terrainEdge: 0,
            featureGround: 0
        };
    },

    BuildClassificationCounts: function(pContext) {
        var counts = this.EmptyCounts();

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                var classification = this.ClassifyTile(pContext, x, y);
                // `blocked` is shared by tree cover and hard authored
                // obstacles. In v3, cliffs carry a CLIFF owner and outcrops
                // have their own layer; neither belongs in the rendered-tree
                // coverage budget. Keep fallback rendering behavior intact,
                // but make telemetry/validation use the canonical tree test.
                if(classification === "tree" && MapGen.Metrics &&
                    MapGen.Metrics.IsTreeBlocked &&
                    !MapGen.Metrics.IsTreeBlocked(pContext, x, y)) {
                    classification = "featureGround";
                }
                counts[classification] = (counts[classification] || 0) + 1;
            }
        }

        return counts;
    },

    StructureGroundTileNeedsCorrection: function(pContext, pTile) {
        if(!pContext || !pContext.Profile)
            return false;

        // Per-biome correction rule dispatched via the biome strategy (the
        // ice snow-test and jungle tile-ID set live in Terrain/BiomeStrategy.js).
        var strategy = MapGen.Terrain.BiomeStrategy.For(pContext);
        return strategy.structureGroundTileNeedsCorrection(pContext, pTile);
    },

    StructureGroundMaterialAt: function(pContext, pX, pY) {
        if(!pContext || !pContext.Layers || !pContext.Layers.structureGroundMaterial)
            return "";

        return MapGen.Layers.Get(pContext.Layers.structureGroundMaterial, pX, pY, "");
    },

    OverlayStructureGroundCorrections: function(pContext, pTiles) {
        if(!pContext || !pContext.Layers || !pContext.Layers.structureGround)
            return 0;

        var palette = MapGen.Terrain.TileCatalog.PaletteForTerrain(pContext.Profile.TerrainType);
        var correctionTiles = palette && palette.grass;
        var changed = 0;

        if(!correctionTiles || !correctionTiles.length)
            return 0;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(!MapGen.Layers.Get(pContext.Layers.structureGround, x, y, 0))
                    continue;
                if(MapGen.Layers.Get(pContext.Layers.water, x, y, 0))
                    continue;

                if(pContext.Profile.TerrainType === Terrain.Types.Ice) {
                    var ice = MapGen.Terrain &&
                        MapGen.Terrain.Smoothing &&
                        MapGen.Terrain.Smoothing.Ice;
                    if(ice && ice.IsWetGroundCell && ice.IsWetGroundCell(pContext, x, y))
                        continue;

                    var material = this.StructureGroundMaterialAt(pContext, x, y);
                    if(material !== "snow")
                        continue;
                }

                var current = MapGen.Layers.Get(pTiles, x, y, 0);
                var plannedFloor = pContext.Profile.TerrainType === Terrain.Types.Jungle &&
                    (MapGen.Layout.Reservations.At(pContext, x, y) & MapGen.Layout.Reservations.FLOOR);
                if(plannedFloor ? correctionTiles.indexOf(current & 0x1FF) >= 0 :
                    !this.StructureGroundTileNeedsCorrection(pContext, current))
                    continue;

                MapGen.Layers.Set(pTiles, x, y, this.PickTile(correctionTiles, pContext, x, y, 54));
                ++changed;
            }
        }

        return changed;
    },



    PaletteKeyForClassification: function(pClassification) {
        if(pClassification === "coast")
            return "beach";
        if(pClassification === "crossing")
            return "ford";
        if(pClassification === "terrainEdge")
            return "jungleEdge";

        return pClassification;
    },

    BuildFallbackTileLayer: function(pContext) {
        var palette = MapGen.Terrain.TileCatalog.PaletteForTerrain(pContext.Profile.TerrainType);
        var tiles = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                var classification = this.ClassifyTile(pContext, x, y);
                var paletteKey = this.PaletteKeyForClassification(classification);
                var tileSet = palette[paletteKey] || palette.grass;
                var salt = classification === "water" ? 1 :
                    classification === "tree" ? 2 :
                    classification === "crossing" ? 3 :
                    classification === "featureGround" ? 5 :
                    classification === "riverBank" ? 7 :
                    classification === "coast" ? 8 :
                    classification === "terrainEdge" ? 9 : 10;

                MapGen.Layers.Set(tiles, x, y, this.PickTile(tileSet, pContext, x, y, salt));
            }
        }

        return {
            Tiles: tiles,
            Backend: "classification"
        };
    },

    BuildDirtyMaskString: function(pContext, pDirtyRegion) {
        if(!pContext || !pDirtyRegion)
            return "";

        var mask = "";
        for(var y = 0; y < pContext.Height; ++y) {
            for(var x = 0; x < pContext.Width; ++x) {
                mask += (x >= pDirtyRegion.minX && x <= pDirtyRegion.maxX &&
                    y >= pDirtyRegion.minY && y <= pDirtyRegion.maxY) ? "1" : "0";
            }
        }

        return mask;
    },

    SplicePreviousTilesOutsideRegion: function(pContext, pTiles, pPreviousTiles, pDirtyRegion) {
        if(!pContext || !pTiles || !pPreviousTiles || !pDirtyRegion)
            return 0;

        var changed = 0;
        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(x >= pDirtyRegion.minX && x <= pDirtyRegion.maxX &&
                    y >= pDirtyRegion.minY && y <= pDirtyRegion.maxY)
                    continue;

                var previous = MapGen.Layers.Get(pPreviousTiles, x, y, 0);
                if(MapGen.Layers.Get(pTiles, x, y, 0) === previous)
                    continue;

                MapGen.Layers.Set(pTiles, x, y, previous);
                ++changed;
            }
        }

        return changed;
    },

    BuildTileLayer: function(pContext, pOptions) {
        var smoothed = null;
        var renderOptions = pOptions || {};
        var localFlushSplicedTiles = 0;

        if(renderOptions.DirtyRegion && renderOptions.PreviousTiles && !renderOptions.DirtyMask)
            renderOptions.DirtyMask = this.BuildDirtyMaskString(pContext, renderOptions.DirtyRegion);
        if(renderOptions.DirtyRegion && !renderOptions.PreviousChars &&
            pContext.RenderedMap && pContext.RenderedMap.Chars)
            renderOptions.PreviousChars = pContext.RenderedMap.Chars;

        MapGen.Context.Time(pContext, "Render.SoftHazardPolicy", function() {
            if(MapGen.Terrain && MapGen.Terrain.EnforceSoftHazardPolicy)
                MapGen.Terrain.EnforceSoftHazardPolicy(pContext);
        });

        MapGen.Context.Time(pContext, "Render.Smoothing", function() {
            MapGen.Layout.Reservations.Apply(pContext);
            MapGen.Layout.TerrainSpace.Apply(pContext);
            if(MapGen.Terrain && MapGen.Terrain.Smoothing && MapGen.Terrain.Smoothing.Render)
                smoothed = MapGen.Terrain.Smoothing.Render(pContext, renderOptions);
        });

        if(!smoothed)
            smoothed = this.BuildFallbackTileLayer(pContext);

        var grassVariantTiles = MapGen.Context.Time(pContext, "Render.GrassVariant", function() {
            if(MapGen.Terrain.Smoothing.GrassVariantSmoother)
                return MapGen.Terrain.Smoothing.GrassVariantSmoother.Apply(pContext, smoothed.Tiles);
            return 0;
        }) || 0;

        // Grass-variant polish can legitimately touch ordinary shoreline
        // tiles, but the authored sub-1 cove is already a complete legal
        // atlas sequence. Restore that sequence after generic grass polish.
        var authoredBeachTiles = 0;
        var authoredQuicksandTiles = 0;
        if(MapGen.Terrain.Smoothing.Jungle &&
            MapGen.Terrain.Smoothing.Jungle.StampSub1Mapm8CornerCoveTiles)
            authoredBeachTiles = MapGen.Terrain.Smoothing.Jungle.StampSub1Mapm8CornerCoveTiles(
                pContext,
                smoothed.Tiles
            );
        if(MapGen.Terrain.Smoothing.Jungle &&
            MapGen.Terrain.Smoothing.Jungle.StampSub1Mapm5TopBankTiles)
            authoredBeachTiles += MapGen.Terrain.Smoothing.Jungle.StampSub1Mapm5TopBankTiles(
                pContext,
                smoothed.Tiles
            );
        if(MapGen.Terrain.Smoothing.Jungle &&
            MapGen.Terrain.Smoothing.Jungle.StampSub1AuthoredQuicksandPatchTiles)
            authoredQuicksandTiles = MapGen.Terrain.Smoothing.Jungle.StampSub1AuthoredQuicksandPatchTiles(
                pContext,
                smoothed.Tiles
            );

        var structureGroundCorrections = 0;

        // P1.18 PHASE 2 PORT TARGETS (D6 + W1.5 Render.js KWC follow-ups):
        // The MapGen.Features.{PlateauCliffs,Bridges,CliffHelicopter}.OverlayTiles
        // calls below + the MapGen.Grammar.StyleMaterialize.ApplyGrammar* calls
        // are hardcoded overlay invocations into v1 modules in the throw boundary.
        // Each is already defensively-guarded (`if (MapGen.Features && ...)`),
        // so post-strip P1.4 they short-circuit to 0 cleanly — no runtime crash.
        // PHASE 2: replace each with a v3 Concept finalise hook registered via
        // MapGen.Intent.RegisterFinaliser('cliff_body'|'bridge'|'cliff_helicopter'
        // |'jungle_soft_hazard'|'beach_ocean_edge', function(intentMap, tiles) {...}).
        // The TilePolish.PolishTreeStackAndDiagonalTiles call at lines 285-296 is
        // a biome-specific render polish reaching into Smoothing internals; lift
        // into BiomeStrategy.For(pContext).polishRenderedTiles() per W1.5 OQ.
        var cliffTiles = 0;
        if(MapGen.Features && MapGen.Features.PlateauCliffs && MapGen.Features.PlateauCliffs.OverlayTiles)
            cliffTiles = MapGen.Features.PlateauCliffs.OverlayTiles(pContext, smoothed.Tiles);

        var cliffTopTiles = 0;
        if(MapGen.Features && MapGen.Features.PlateauCliffs && MapGen.Features.PlateauCliffs.OverlayCliffTop)
            cliffTopTiles = MapGen.Features.PlateauCliffs.OverlayCliffTop(pContext, smoothed.Tiles);

        var cliffFootShadowTiles = 0;
        if(MapGen.Features && MapGen.Features.PlateauCliffs && MapGen.Features.PlateauCliffs.OverlayFootShadow)
            cliffFootShadowTiles = MapGen.Features.PlateauCliffs.OverlayFootShadow(pContext, smoothed.Tiles);

        var bridgeTiles = 0;
        if(MapGen.Features && MapGen.Features.Bridges && MapGen.Features.Bridges.OverlayTiles)
            bridgeTiles = MapGen.Features.Bridges.OverlayTiles(pContext, smoothed.Tiles, smoothed.Chars);

        // The mapm5-style channel uses a gameplay wade because sub1 has no
        // horizontal bridge art. Jungle.OverlayProtectedTiles deliberately
        // leaves it to the completed water-edge solver; this guard remains a
        // no-op safety net for any later overlay that writes into its interior.
        var grammarBeachWadeTiles = 0;
        if(MapGen.Terrain.Smoothing.Jungle &&
            MapGen.Terrain.Smoothing.Jungle.StampSub1Mapm5WadeWaterTiles)
            grammarBeachWadeTiles = MapGen.Terrain.Smoothing.Jungle.StampSub1Mapm5WadeWaterTiles(
                pContext,
                smoothed.Tiles
            );

        var helicopterTiles = 0;
        if(MapGen.Features && MapGen.Features.CliffHelicopter && MapGen.Features.CliffHelicopter.OverlayTiles)
            helicopterTiles = MapGen.Features.CliffHelicopter.OverlayTiles(pContext, smoothed.Tiles);

        var styleMaterialize = MapGen.Grammar && MapGen.Grammar.StyleMaterialize;
        var grammarBeachOceanEdgeRepairTiles = styleMaterialize ?
            styleMaterialize.ApplyGrammarBeachOceanEdgeRepair(pContext, smoothed.Tiles) : 0;
        // The general beach cleanup above owns coastlines and can legitimately
        // retile river-looking cells. mapm6 is an interior river, so restore
        // both of its source-derived visible banks after that cleanup. This is
        // deliberately the final river-bank operation; an older cyclic lower-
        // edge polish here was flattening the authored variation back out.
        var grammarBeachRiverEdgeTiles = 0;
        if(MapGen.Terrain.Smoothing.Jungle &&
            MapGen.Terrain.Smoothing.Jungle.StampSub1Mapm6ChannelBankTiles) {
            grammarBeachRiverEdgeTiles =
                MapGen.Terrain.Smoothing.Jungle.StampSub1Mapm6ChannelBankTiles(
                    pContext,
                    smoothed.Tiles
                );
            authoredBeachTiles += grammarBeachRiverEdgeTiles;
        }
        var composedBeachEdgeTiles = 0;
        if(smoothed.Chars &&
            MapGen.Terrain.Smoothing.Jungle &&
            MapGen.Terrain.Smoothing.Jungle.ResolveComposedSub1BeachEdges)
            composedBeachEdgeTiles = MapGen.Context.Time(pContext, "Render.ComposedBeachEdges", function() {
                return MapGen.Terrain.Smoothing.Jungle.ResolveComposedSub1BeachEdges(
                    pContext, smoothed.Chars, smoothed.Tiles);
            });
        // The wade interior is already water. Let the final ocean-edge repair
        // retain/restore legal shoreline tiles on both sides of the crossing.
        // This is the first point after every terrain/object overlay. Resolve
        // any authored quicksand motif that lost a core cell as an all-or-none
        // operation; earlier smoothing passes are intentionally non-destructive.
        if(MapGen.Terrain.Smoothing.Jungle &&
            MapGen.Terrain.Smoothing.Jungle.StampSub1AuthoredQuicksandPatchTiles)
            authoredQuicksandTiles += MapGen.Terrain.Smoothing.Jungle.StampSub1AuthoredQuicksandPatchTiles(
                pContext,
                smoothed.Tiles,
                true
            );
        // Shoreline overlays can reach the unfilled corners of a sparse
        // building stamp. Settle its reserved floor after all terrain overlays;
        // the live structure stamp then supplies the walls and roof.
        structureGroundCorrections = this.OverlayStructureGroundCorrections(pContext, smoothed.Tiles);
        if(renderOptions.DirtyRegion && renderOptions.PreviousTiles && !smoothed.FullTileProjection) {
            localFlushSplicedTiles = this.SplicePreviousTilesOutsideRegion(
                pContext,
                smoothed.Tiles,
                renderOptions.PreviousTiles,
                renderOptions.DirtyRegion
            );
        }
        var postOverlayTreeStackTiles = 0;
        if(smoothed.Chars &&
            pContext.Profile.TerrainType === Terrain.Types.Ice &&
            MapGen.Terrain.Smoothing &&
            MapGen.Terrain.Smoothing.Ice &&
            MapGen.Terrain.Smoothing.Ice.PolishTreeStackAndDiagonalTiles) {
            postOverlayTreeStackTiles = MapGen.Terrain.Smoothing.Ice.PolishTreeStackAndDiagonalTiles(
                pContext,
                smoothed.Chars,
                smoothed.Tiles
            );
        }

        pContext.RenderedMap = {
            TerrainType: pContext.Profile.TerrainType,
            TerrainTypeSub: pContext.Profile.TerrainTypeSub,
            Tiles: smoothed.Tiles,
            Chars: smoothed.Chars || null,
            Counts: this.BuildClassificationCounts(pContext),
            Backend: smoothed.Backend || "classification",
            Smoothing: {
                charFixes: smoothed.CharFixes || 0,
                charSmoothChanges: smoothed.CharSmoothChanges || 0,
                transitionTiles: smoothed.TransitionTiles || 0,
                terrainTransitionTiles: smoothed.TerrainTransitionTiles || 0,
                treeTiles: smoothed.TreeTiles || 0,
                treeStageCounts: smoothed.TreeStageCounts || [],
                treePasses: {
                    topRepair: smoothed.TreeTopRepair || 0,
                    tailPrune: smoothed.TreeTailPrune || 0,
                    lateTailPrune: smoothed.LateTreeTailPrune || 0,
                    terminalRowPrune: smoothed.NarrowTreeTerminalRowPrune || 0,
                    flatShelfPrune: smoothed.FlatTerminalTreeShelfPrune || 0,
                    sparseFragmentPrune: smoothed.SparseTreeFragmentPrune || 0,
                    bridgePrune: smoothed.NarrowTreeBridgePrune || 0,
                    smallClusterPrune: smoothed.SmallTreeClusterPrune || 0,
                    protectedPrune: smoothed.ProtectedTreeCharPrune || 0,
                    topologyNormalize: smoothed.TreeTopologyNormalize || 0,
                    finalTopologyNormalize: smoothed.FinalTreeTopologyNormalize || 0,
                    shortColumnPrune: smoothed.ShortTreeSideColumnPrune || 0
                },
                coverShapeTiles: smoothed.CoverShapeTiles || 0,
                featureShapeTiles: smoothed.FeatureShapeTiles || 0,
                profiledTileCorrections: smoothed.ProfiledTileCorrections || 0,
                protectedTiles: smoothed.ProtectedTiles || 0,
                polishTiles: smoothed.PolishTiles || 0,
                grammarBeachBankPolishTiles: smoothed.GrammarBeachBankPolishTiles || 0,
                grammarBeachRiverEdgeTiles: grammarBeachRiverEdgeTiles,
                iceSoftHazardBudgetChars: smoothed.IceSoftHazardBudgetChars || 0,
                cliffTiles: cliffTiles,
                cliffFootShadowTiles: cliffFootShadowTiles,
                bridgeTiles: bridgeTiles,
                grammarBeachWadeTiles: grammarBeachWadeTiles,
                helicopterTiles: helicopterTiles,
                grassVariantTiles: grassVariantTiles,
                grammarBeachOceanEdgeRepairTiles: grammarBeachOceanEdgeRepairTiles,
                composedBeachEdgeTiles: composedBeachEdgeTiles,
                composedBeachEdgeAudit: pContext.ComposedBeachEdgeAudit || null,
                authoredBeachTiles: authoredBeachTiles,
                authoredQuicksandTiles: authoredQuicksandTiles,
                postOverlayTreeStackTiles: postOverlayTreeStackTiles,
                structureGroundCorrections: structureGroundCorrections,
                localFlushSplicedChars: smoothed.LocalFlushSplicedChars || 0,
                fullTileProjection: !!smoothed.FullTileProjection,
                localFlushSplicedTiles: localFlushSplicedTiles,
                finalOpenFieldCover: smoothed.FinalOpenFieldCover || null,
                finalRouteEdgeCover: smoothed.FinalRouteEdgeCover || null,
                finalRouteEdgeCoverAudit: smoothed.FinalRouteEdgeCoverAudit || null,
                openFieldScreenAudit: smoothed.OpenFieldScreenAudit || null
            }
        };

        MapGen.Context.AddLog(pContext, "Built rendered tile layer using " + pContext.RenderedMap.Backend);
        return pContext.RenderedMap;
    },

    ApplyTileLayerToMap: function(pContext, pMap) {
        var map = pMap || pContext.Map || (typeof Map !== "undefined" ? Map : null);
        var renderedMap = pContext.RenderedMap || this.BuildTileLayer(pContext);

        if(!map || !map.TileSet)
            throw new Error("MapGen.Render.ApplyTileLayerToMap requires a map with TileSet");

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y)
                map.TileSet(x, y, MapGen.Layers.Get(renderedMap.Tiles, x, y, 0));
        }

        MapGen.Context.AddLog(pContext, "Applied rendered tile layer to map");
        return pContext;
    },

    CreateMap: function(pContext, pMap) {
        var map = pMap || pContext.Map || (typeof Map !== "undefined" ? Map : null);

        if(!map || !map.Create)
            throw new Error("MapGen.Render.CreateMap requires a map with Create");

        map.Create(
            pContext.Width,
            pContext.Height,
            pContext.Profile.TerrainType,
            pContext.Profile.TerrainTypeSub
        );

        pContext.Map = map;
        this.ApplyTileLayerToMap(pContext, map);
        MapGen.Context.AddLog(pContext, "Created map from rendered tile layer");
        return pContext;
    }
};
