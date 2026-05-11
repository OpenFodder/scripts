var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};

// Thin per-biome dispatch layer. Generic code (Render, Validate, Features) used
// to inline `if(TerrainType === Terrain.Types.Ice) ...` chains; those branches
// move here as hooks so the generic modules stay terrain-agnostic. This is a
// DISPATCH refactor, never a biome merge — each hook returns exactly what the
// former inline branch returned, so generated output is unchanged.
//
// The strategy table is built lazily inside For() (not at file-eval) so it
// never depends on the load order of Terrain.Types / Smoothing.Ice — same
// idiom as Terrain/Smoothing/Render.js.
MapGen.Terrain.BiomeStrategy = {

    // Returns true if the rendered tile at (x,y) is a deep/shallow water tile
    // that must not count as a dry route cell. Ice-only; every other biome has
    // no rendered-tile dry-route blocker. (Formerly Validate.RenderedTileBlocksDryRoute.)
    IceRenderedTileBlocksDryRoute: function(pContext, pX, pY) {
        if(!pContext.RenderedMap ||
            !pContext.RenderedMap.Tiles ||
            !MapGen.Terrain.Smoothing ||
            !MapGen.Terrain.Smoothing.Ice ||
            !MapGen.Terrain.Smoothing.Ice.Data) {
            return false;
        }

        var data = MapGen.Terrain.Smoothing.Ice.Data();
        var tiles = data && data.edges && data.edges.tiles;
        if(!tiles)
            return false;

        var tile = MapGen.Layers.Get(pContext.RenderedMap.Tiles, pX, pY, 0) & 0x1FF;
        var record = tiles[String(tile)];
        if(!record)
            return false;

        return record.center === "deep" ||
            record.center === "shallow" ||
            record.primary === "deep" ||
            record.primary === "shallow";
    },

    // True if (x,y) is an ice riverBank ground cell that should block a dry
    // route. Ice-only. (Formerly the inline branch in Validate.IsDryWalkable.)
    IceBankBlocksDryRoute: function(pContext, pX, pY) {
        return !!(MapGen.Terrain.Smoothing &&
            MapGen.Terrain.Smoothing.Ice &&
            MapGen.Terrain.Smoothing.Ice.IsBankGroundCell &&
            MapGen.Terrain.Smoothing.Ice.IsBankGroundCell(pContext, pX, pY));
    },

    // Whether a rendered structure-ground tile needs biome correction.
    // (Formerly the Ice/Jungle branches in Render.StructureGroundTileNeedsCorrection.)
    IceStructureGroundTileNeedsCorrection: function(pContext, pTile) {
        var data = MapGen.Terrain &&
            MapGen.Terrain.Smoothing &&
            MapGen.Terrain.Smoothing.Ice &&
            MapGen.Terrain.Smoothing.Ice.Data ?
            MapGen.Terrain.Smoothing.Ice.Data() :
            null;
        var tileData = data && data.edges && data.edges.tiles;
        var rec = tileData && tileData[String(pTile)];
        if(!rec || !rec.contents)
            return true;

        return rec.contents.indexOf("snow") < 0;
    },

    JUNGLE_STRUCTURE_GROUND_CORRECTION_TILES: { 0: true, 18: true, 20: true, 40: true },

    JungleStructureGroundTileNeedsCorrection: function(pContext, pTile) {
        return !!this.JUNGLE_STRUCTURE_GROUND_CORRECTION_TILES[pTile];
    },

    // Display/Structures-key name for a cliff/bridge/helicopter biome.
    CliffBiomeName: function(pTerrainType) {
        if(typeof Terrain === "undefined")
            return null;
        if(pTerrainType === Terrain.Types.Jungle) return "Jungle";
        if(pTerrainType === Terrain.Types.Ice) return "Ice";
        if(pTerrainType === Terrain.Types.Desert) return "Desert";
        return null;
    },

    // Resolve the active biome strategy for a context. Returns one of the
    // per-biome objects below, or the NULL strategy whose hooks are no-ops.
    For: function(pContext) {
        if(!pContext || !pContext.Profile || typeof Terrain === "undefined")
            return this.Null;

        if(pContext.Profile.TerrainType === Terrain.Types.Ice)
            return this.Ice;
        if(pContext.Profile.TerrainType === Terrain.Types.Jungle)
            return this.Jungle;

        return this.Null;
    }
};

(function(pStrategy) {
    // NULL strategy: every hook returns the pre-refactor default for biomes
    // that had no inline branch (i.e. "no correction / not blocking").
    pStrategy.Null = {
        renderedTileBlocksDryRoute: function() { return false; },
        bankBlocksDryRoute: function() { return false; },
        structureGroundTileNeedsCorrection: function() { return false; }
    };

    pStrategy.Ice = {
        renderedTileBlocksDryRoute: function(pContext, pX, pY) {
            return pStrategy.IceRenderedTileBlocksDryRoute(pContext, pX, pY);
        },
        bankBlocksDryRoute: function(pContext, pX, pY) {
            return pStrategy.IceBankBlocksDryRoute(pContext, pX, pY);
        },
        structureGroundTileNeedsCorrection: function(pContext, pTile) {
            return pStrategy.IceStructureGroundTileNeedsCorrection(pContext, pTile);
        }
    };

    pStrategy.Jungle = {
        // Jungle has no dry-route blockers (no water-route gameplay).
        renderedTileBlocksDryRoute: function() { return false; },
        bankBlocksDryRoute: function() { return false; },
        structureGroundTileNeedsCorrection: function(pContext, pTile) {
            return pStrategy.JungleStructureGroundTileNeedsCorrection(pContext, pTile);
        }
    };
})(MapGen.Terrain.BiomeStrategy);
