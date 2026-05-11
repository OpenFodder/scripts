var MapGen = MapGen || {};
MapGen.Grammar = MapGen.Grammar || {};

MapGen.Grammar.StyleMaterialize = {
    PostpassAllowed: function(pContext, pId) {
        return !!(MapGen.Grammar.PostpassPolicy &&
            MapGen.Grammar.PostpassPolicy.Allows(pContext, pId));
    },

    RecordPostpass: function(pContext, pId, pChanged) {
        if(MapGen.Grammar.PostpassPolicy && MapGen.Grammar.PostpassPolicy.Record)
            MapGen.Grammar.PostpassPolicy.Record(pContext, pId, pChanged);
    },

    GrammarStyleSet: function() {
        return MapGen.Grammar.StyleTileSets.GrammarStyleSet.apply(MapGen.Grammar.StyleTileSets, arguments);
    },

    GrammarStyleSpec: function() {
        return MapGen.Grammar.StyleTileSets.GrammarStyleSpec.apply(MapGen.Grammar.StyleTileSets, arguments);
    },

    GrammarStylePrepareSpec: function(pSpec) {
        if(pSpec._prepared)
            return pSpec;

        pSpec.visualSets = {
            building: this.GrammarStyleSet(pSpec.building),
            cliff: this.GrammarStyleSet(pSpec.cliff),
            decor: this.GrammarStyleSet(pSpec.decor),
            tree: this.GrammarStyleSet(pSpec.tree),
            water: this.GrammarStyleSet(pSpec.water),
            land: this.GrammarStyleSet(pSpec.land)
        };
        pSpec._prepared = true;
        return pSpec;
    },

    GrammarStyleTileId: function(pTile) {
        return Number(pTile || 0) & 0x1FF;
    },

    GrammarStyleVisualClass: function(pSpec, pTile) {
        var sets = pSpec.visualSets;
        var tile = this.GrammarStyleTileId(pTile);

        if(sets.building[tile]) return "building";
        if(sets.cliff[tile]) return "cliff";
        if(sets.decor[tile]) return "decor";
        if(sets.tree[tile]) return "tree";
        if(sets.water[tile]) return "water";
        if(sets.land[tile]) return "land";
        return "other";
    },

    GrammarBeachOceanRepairSets: function() {
        return MapGen.Grammar.StyleTileSets.GrammarBeachOceanRepairSets.apply(MapGen.Grammar.StyleTileSets, arguments);
    },

    GrammarBeachOceanRepairProtectedCell: function(pContext, pX, pY) {
        var layers = pContext.Layers || {};

        return MapGen.Layers.Get(layers.crossing, pX, pY, 0) ||
            MapGen.Layers.Get(layers.structureGround, pX, pY, 0);
    },

    GrammarBeachOceanRepairIsWater: function(pContext, pTiles, pSets, pX, pY) {
        if(pX < 0 || pY < 0 || pX >= pContext.Width || pY >= pContext.Height)
            return false;

        return pSets.water[MapGen.Layers.Get(pTiles, pX, pY, 0) & 0x1FF] ||
            MapGen.Layers.Get((pContext.Layers || {}).water, pX, pY, 0);
    },

    GrammarBeachOceanRepairIsBeach: function(pTiles, pSets, pX, pY) {
        if(!pTiles)
            return false;

        return !!(pSets.beach[MapGen.Layers.Get(pTiles, pX, pY, 0) & 0x1FF]);
    },

    GrammarBeachOceanRepairHasBeachNeighbor: function(pTiles, pSets, pX, pY) {
        return this.GrammarBeachOceanRepairIsBeach(pTiles, pSets, pX, pY - 1) ||
            this.GrammarBeachOceanRepairIsBeach(pTiles, pSets, pX + 1, pY) ||
            this.GrammarBeachOceanRepairIsBeach(pTiles, pSets, pX, pY + 1) ||
            this.GrammarBeachOceanRepairIsBeach(pTiles, pSets, pX - 1, pY);
    },

    GrammarBeachOceanRepairTile: function(pContext, pX, pY, pMask) {
        var choices;

        if(pMask.N && pMask.E && !pMask.S && !pMask.W)
            choices = [263, 282];
        else if(!pMask.N && pMask.E && pMask.S && !pMask.W)
            choices = [282, 244];
        else if(!pMask.N && !pMask.E && pMask.S && pMask.W)
            choices = [261, 364];
        else if(pMask.N && !pMask.E && !pMask.S && pMask.W)
            choices = [361, 341, 382];
        else if(pMask.N && !pMask.E && !pMask.S && !pMask.W)
            choices = [361, 341, 263];
        else if(!pMask.N && pMask.E && !pMask.S && !pMask.W)
            choices = [260, 260, 280];
        else if(!pMask.N && !pMask.E && pMask.S && !pMask.W)
            choices = [242];
        else if(!pMask.N && !pMask.E && !pMask.S && pMask.W)
            choices = [364, 361];
        else if(pMask.N && pMask.E && pMask.S && !pMask.W)
            choices = [282, 263];
        else if(pMask.N && !pMask.E && pMask.S && pMask.W)
            choices = [341, 361, 261];
        else if(!pMask.N && pMask.E && pMask.S && pMask.W)
            choices = [261, 282, 364];
        else if(pMask.N && pMask.E && !pMask.S && pMask.W)
            choices = [361, 263, 341];
        else
            choices = [282, 244, 242, 361, 364];

        return choices[MapGen.Random.HashTile(pContext.Seed, pX, pY, 3359) % choices.length];
    },

    ApplyGrammarBeachOceanEdgeRepair: function(pContext, pTiles) {
        if(!pContext ||
            !pContext.Profile ||
            pContext.Profile.TargetPackProfile !== "grammar_beach" ||
            Number(pContext.Profile.TerrainTypeSub || 0) !== 1 ||
            !this.PostpassAllowed(pContext, "beach_ocean_edge_repair"))
            return 0;

        var jungleSmoothing = MapGen.Terrain &&
            MapGen.Terrain.Smoothing &&
            MapGen.Terrain.Smoothing.Jungle ?
            MapGen.Terrain.Smoothing.Jungle :
            null;
        if(jungleSmoothing &&
            jungleSmoothing.IsComposedSub1BeachCoast &&
            jungleSmoothing.IsComposedSub1BeachCoast(pContext))
            return 0;

        var sets = this.GrammarBeachOceanRepairSets();
        var changes = [];

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                var tileId = MapGen.Layers.Get(pTiles, x, y, 0) & 0x1FF;

                if(sets.water[tileId] || sets.beach[tileId] || sets.ocean[tileId])
                    continue;
                if(this.GrammarBeachOceanRepairProtectedCell(pContext, x, y))
                    continue;
                if(!MapGen.Layers.Get((pContext.Layers || {}).water, x, y, 0) &&
                    this.GrammarBeachOceanRepairHasBeachNeighbor(pTiles, sets, x, y))
                    continue;

                var mask = {
                    N: this.GrammarBeachOceanRepairIsWater(pContext, pTiles, sets, x, y - 1),
                    E: this.GrammarBeachOceanRepairIsWater(pContext, pTiles, sets, x + 1, y),
                    S: this.GrammarBeachOceanRepairIsWater(pContext, pTiles, sets, x, y + 1),
                    W: this.GrammarBeachOceanRepairIsWater(pContext, pTiles, sets, x - 1, y)
                };

                if(!mask.N && !mask.E && !mask.S && !mask.W)
                    continue;

                changes.push({
                    x: x,
                    y: y,
                    tile: this.GrammarBeachOceanRepairTile(pContext, x, y, mask)
                });
            }
        }

        for(var index = 0; index < changes.length; ++index)
            MapGen.Layers.Set(pTiles, changes[index].x, changes[index].y, changes[index].tile);

        var grassEdgeCleanup = 0;
        jungleSmoothing = MapGen.Terrain &&
            MapGen.Terrain.Smoothing &&
            MapGen.Terrain.Smoothing.Jungle ?
            MapGen.Terrain.Smoothing.Jungle :
            null;

        if(jungleSmoothing &&
            jungleSmoothing.Sub1EdgeData &&
            jungleSmoothing.Sub1RecordLookup &&
            jungleSmoothing.RepairSub1GrammarBeachFinalGrassSideMasks) {
            var data = jungleSmoothing.Sub1EdgeData();
            if(data) {
                var lookup = jungleSmoothing.Sub1RecordLookup(data);
                grassEdgeCleanup = jungleSmoothing.RepairSub1GrammarBeachFinalGrassSideMasks(
                    pContext,
                    pTiles,
                    lookup
                );
                if(jungleSmoothing.StampSub1GrammarBeachBankTemplateTiles)
                    grassEdgeCleanup += jungleSmoothing.StampSub1GrammarBeachBankTemplateTiles(pContext, pTiles, lookup);
                if(jungleSmoothing.NormalizeSub1GrammarBeachBankLeftTemplateTiles)
                    grassEdgeCleanup += jungleSmoothing.NormalizeSub1GrammarBeachBankLeftTemplateTiles(pContext, pTiles, lookup);
                if(jungleSmoothing.RepairSub1GrammarBeachFinalSeamArtifacts)
                    grassEdgeCleanup += jungleSmoothing.RepairSub1GrammarBeachFinalSeamArtifacts(pContext, pTiles, lookup);
            }
        }

        // The generic ocean repair above is still useful for lagoons and
        // incidental water elsewhere on the map, but it must not rewrite the
        // complete mapm8 cove sequence. Restore that authored atlas block as
        // the final beach operation.
        if(jungleSmoothing && jungleSmoothing.StampSub1Mapm8CornerCoveTiles)
            grassEdgeCleanup += jungleSmoothing.StampSub1Mapm8CornerCoveTiles(pContext, pTiles);
        if(jungleSmoothing && jungleSmoothing.StampSub1Mapm5TopBankTiles)
            grassEdgeCleanup += jungleSmoothing.StampSub1Mapm5TopBankTiles(pContext, pTiles);
        if(jungleSmoothing && jungleSmoothing.StampSub1AuthoredQuicksandPatchTiles)
            grassEdgeCleanup += jungleSmoothing.StampSub1AuthoredQuicksandPatchTiles(pContext, pTiles);

        if(changes.length > 0 && MapGen.Context && MapGen.Context.AddLog) {
            this.RecordPostpass(pContext, "beach_ocean_edge_repair", changes.length);
            MapGen.Context.AddLog(pContext, "Repaired grammar beach ocean edge tiles=" + changes.length);
        }

        if(grassEdgeCleanup > 0 && MapGen.Context && MapGen.Context.AddLog) {
            this.RecordPostpass(pContext, "beach_grass_edge_cleanup", grassEdgeCleanup);
            MapGen.Context.AddLog(pContext, "Repaired grammar beach grass edge tiles=" + grassEdgeCleanup);
        }

        return changes.length + grassEdgeCleanup;
    }
};
