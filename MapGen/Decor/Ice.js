(function() {

    MapGen.Decor.Register(Terrain.Types.Ice, {
        name: "snowman",
        baseCount: 10,
        minCount: 0,
        scoreSalt: 841,
        recordRadius: 1,
        placeDistance: 6,
        decorDistance: 10,
        allowKeepClear: false,
        avoidKeepClearRadius: 2,
        materialize: function(pPoint, pPosition) {
            Map.SpriteAdd(SpriteTypes.Snowman, pPosition.x, pPosition.y);
            Session.Background.Bush2Positions.push(pPosition);
        }
    });

    function classifyIceTile(pTileId) {
        var edges = MapGen.Terrain.Smoothing.IceTileEdges;
        if(edges && edges.tiles && edges.tiles[pTileId] && edges.tiles[pTileId].primary)
            return edges.tiles[pTileId].primary;
        return null;
    }

    function isIceCell(pTileX, pTileY) {
        var primary = classifyIceTile(Map.TileGet(pTileX, pTileY));
        return primary === "ice" || primary === "shallow";
    }

    function flattenWaterPatchPalette() {
        var palette = Terrain.Ice.Sub0 && Terrain.Ice.Sub0.WaterPatches;
        if(!palette)
            return [41, 61];
        if(palette.length !== undefined)
            return palette;
        var ids = [];
        for(var key in palette) {
            if(!palette.hasOwnProperty(key)) continue;
            var arr = palette[key];
            for(var i = 0; i < arr.length; ++i)
                if(ids.indexOf(arr[i]) === -1)
                    ids.push(arr[i]);
        }
        return ids.length ? ids : [41, 61];
    }

    function placeRockStamp(pStamp, pTileX, pTileY) {
        for(var row = 0; row < pStamp.length; ++row) {
            var cells = pStamp[row];
            for(var col = 0; col < cells.length; ++col) {
                var tid = cells[col];
                if(tid === null || tid === undefined)
                    continue;
                Map.TileSet(pTileX + col, pTileY + row, tid);
            }
        }
    }

    function pickRockStamp(pTileX, pTileY) {
        var rocks = Terrain.Ice.Sub0 && Terrain.Ice.Sub0.Rocks;
        if(!rocks || !rocks.length)
            return null;
        var index = MapGen.Random.HashTile(Map.seed || 0, pTileX, pTileY, 879) % rocks.length;
        return rocks[index];
    }

    function pickHoleStamp(pTileX, pTileY) {
        var holes = Terrain.Ice.Sub0 && Terrain.Ice.Sub0.Hole;
        if(!holes || !holes.length)
            return null;
        var index = MapGen.Random.HashTile(Map.seed || 0, pTileX, pTileY, 901) % holes.length;
        return holes[index];
    }

    function stampFootprintFits(pStamp, pTileX, pTileY) {
        if(!pStamp)
            return false;
        for(var row = 0; row < pStamp.length; ++row) {
            var cells = pStamp[row];
            for(var col = 0; col < cells.length; ++col) {
                var tid = cells[col];
                if(tid === null || tid === undefined)
                    continue;
                var tx = pTileX + col;
                var ty = pTileY + row;
                if(tx < 0 || ty < 0 || tx >= Map.getWidth() || ty >= Map.getHeight())
                    return false;
                if(!isIceCell(tx, ty))
                    return false;
            }
        }
        return true;
    }

    MapGen.Decor.Register(Terrain.Types.Ice, {
        name: "water_patch",
        baseCount: 4,
        minCount: 0,
        scoreSalt: 884,
        recordRadius: 1,
        placeDistance: 5,
        decorDistance: 4,
        allowKeepClear: false,
        avoidKeepClearRadius: 1,
        footprint: function(pContext, pPoint) {
            if(!MapGen.Decor.IsOpenLand(pContext, pPoint))
                return false;
            if(!isIceCell(pPoint.x, pPoint.y))
                return false;
            var coastBuffer = (pContext.Profile && pContext.Profile.CoastWaterWidth) || 3;
            if(MapGen.Decor.NearLayer(pContext.Layers.water, pPoint.x, pPoint.y, coastBuffer))
                return false;
            if(MapGen.Decor.NearLayer(pContext.Layers.riverBank, pPoint.x, pPoint.y, coastBuffer))
                return false;
            return true;
        },
        materialize: function(pPoint, pPosition) {
            var palette = flattenWaterPatchPalette();
            var tile = Structures.TileChoice(palette, pPoint.x, pPoint.y, 884);
            Map.TileSet(pPoint.x, pPoint.y, tile);
        }
    });

    MapGen.Decor.Register(Terrain.Types.Ice, {
        name: "rock",
        baseCount: 24,
        minCount: 6,
        scoreSalt: 879,
        recordRadius: 1,
        placeDistance: 3,
        decorDistance: 2,
        allowKeepClear: false,
        avoidKeepClearRadius: 1,
        footprint: function(pContext, pPoint) {
            if(!MapGen.Decor.IsOpenLand(pContext, pPoint))
                return false;
            var stamp = pickRockStamp(pPoint.x, pPoint.y);
            return stampFootprintFits(stamp, pPoint.x, pPoint.y);
        },
        bonus: function(pContext, pPoint) {
            if(MapGen.Decor.NearLayer(pContext.Layers.blocked, pPoint.x, pPoint.y, 1))
                return 0x10000000;
            return 0;
        },
        materialize: function(pPoint, pPosition) {
            var stamp = pickRockStamp(pPoint.x, pPoint.y);
            if(stamp)
                placeRockStamp(stamp, pPoint.x, pPoint.y);
        }
    });

    MapGen.Decor.Register(Terrain.Types.Ice, {
        name: "hole",
        baseCount: 6,
        minCount: 0,
        scoreSalt: 901,
        recordRadius: 2,
        placeDistance: 8,
        decorDistance: 6,
        allowKeepClear: false,
        avoidKeepClearRadius: 3,
        footprint: function(pContext, pPoint) {
            if(!MapGen.Decor.IsOpenLand(pContext, pPoint))
                return false;
            var stamp = pickHoleStamp(pPoint.x, pPoint.y);
            return stampFootprintFits(stamp, pPoint.x, pPoint.y);
        },
        materialize: function(pPoint, pPosition) {
            var stamp = pickHoleStamp(pPoint.x, pPoint.y);
            if(!stamp)
                return;
            // Sprite 24 has jungle-visible art but still acts as an enemy spawn
            // marker on ice, where it appears invisible.
            placeRockStamp(stamp, pPoint.x, pPoint.y);
        }
    });

})();
