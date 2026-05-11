(function() {

    function palmHasOpenCanopy(pContext, pPoint) {
        return !MapGen.Decor.LayerInRect(pContext.Layers.blocked, pPoint.x - 4, pPoint.y - 5, pPoint.x + 4, pPoint.y + 3) &&
            !MapGen.Decor.LayerInRect(pContext.Layers.water, pPoint.x - 2, pPoint.y - 3, pPoint.x + 2, pPoint.y + 2) &&
            !MapGen.Decor.LayerInRect(pContext.Layers.riverBank, pPoint.x - 2, pPoint.y - 3, pPoint.x + 2, pPoint.y + 2);
    }

    function shrubHasLightGround(pContext, pPoint) {
        for(var x = pPoint.x; x <= pPoint.x + 1; ++x) {
            for(var y = pPoint.y - 1; y <= pPoint.y; ++y) {
                if(!MapGen.Layers.InBounds(pContext.Layers.blocked, x, y))
                    return false;
                if(MapGen.Layers.Get(pContext.Layers.water, x, y, 0))
                    return false;
                if(MapGen.Layers.Get(pContext.Layers.riverBank, x, y, 0))
                    return false;
                if(MapGen.Layers.Get(pContext.Layers.occupied, x, y, 0))
                    return false;
                if(MapGen.Layers.Get(pContext.Layers.blocked, x, y, 0))
                    return false;
                if(!MapGen.Layers.Get(pContext.Layers.keepClear, x, y, 0) &&
                    !MapGen.Layers.Get(pContext.Layers.path, x, y, 0) &&
                    !MapGen.Layers.Get(pContext.Layers.terrainEdge, x, y, 0)) {
                    return false;
                }
            }
        }

        return true;
    }

    MapGen.Decor.Register(Terrain.Types.Jungle, {
        name: "palm",
        baseCount: 4,
        minCount: 0,
        scoreSalt: 811,
        recordRadius: 3,
        placeDistance: 7,
        decorDistance: 7,
        allowKeepClear: false,
        avoidKeepClearRadius: 3,
        footprint: palmHasOpenCanopy,
        bonus: function(pContext, pPoint) {
            var bonus = 0;

            if(MapGen.Layers.Get(pContext.Layers.terrainEdge, pPoint.x, pPoint.y, 0))
                bonus += 0x30000000;
            if(MapGen.Decor.NearLayer(pContext.Layers.blocked, pPoint.x, pPoint.y, 1))
                bonus += 0x18000000;

            return bonus;
        },
        runtimeCheck: function(pPoint) {
            var context = Session.MapGenContext;

            if(!context || !palmHasOpenCanopy(context, pPoint))
                return false;
            if(MapGen.Integration.DecorTouchesBlockedVisualTile(pPoint, 3, 5, 2))
                return false;

            return true;
        },
        materialize: function(pPoint, pPosition) {
            Map.SpriteAdd(SpriteTypes.Tree, pPosition.x, pPosition.y + 4);
            Map.TileSet(pPoint.x, pPoint.y, 58);
            Session.Background.TreePositions.push(pPosition);
        }
    });

    function pickShrubVariant(pPoint) {
        var stamps = Terrain.Jungle.Sub0 && Terrain.Jungle.Sub0.Shrubs;
        if(!stamps || !stamps.length)
            return [[50, 51], [70, 71]];

        return Structures.TileChoice(stamps, pPoint.x, pPoint.y, 821);
    }

    function stampShrub(pPoint, pStamp) {
        var rows = pStamp.length;
        for(var r = 0; r < rows; ++r) {
            var row = pStamp[r];
            var y = pPoint.y - (rows - 1 - r);
            for(var c = 0; c < row.length; ++c)
                Map.TileSet(pPoint.x + c, y, row[c]);
        }
    }

    MapGen.Decor.Register(Terrain.Types.Jungle, {
        name: "shrub",
        baseCount: 16,
        minCount: 4,
        scoreSalt: 821,
        recordRadius: 1,
        placeDistance: 5,
        decorDistance: 4,
        allowKeepClear: true,
        avoidKeepClearRadius: 0,
        footprint: shrubHasLightGround,
        bonus: function(pContext, pPoint) {
            var bonus = 0;

            if(!MapGen.Layers.Get(pContext.Layers.terrainEdge, pPoint.x, pPoint.y, 0))
                bonus += 0x18000000;
            if(MapGen.Layers.Get(pContext.Layers.keepClear, pPoint.x, pPoint.y, 0) ||
                MapGen.Layers.Get(pContext.Layers.path, pPoint.x, pPoint.y, 0))
                bonus += 0x08000000;

            return bonus;
        },
        runtimeCheck: function(pPoint) {
            return MapGen.Integration.DecorFootprintIsJungleLightGround(pPoint);
        },
        materialize: function(pPoint, pPosition) {
            Map.SpriteAdd(SpriteTypes.Shrub, pPosition.x, pPosition.y + 4);
            stampShrub(pPoint, pickShrubVariant(pPoint));
            Session.Background.Bush1Positions.push(pPosition);
        }
    });

    MapGen.Decor.Register(Terrain.Types.Jungle, {
        name: "shrub2",
        baseCount: 6,
        minCount: 2,
        scoreSalt: 851,
        recordRadius: 1,
        placeDistance: 5,
        decorDistance: 4,
        allowKeepClear: false,
        avoidKeepClearRadius: 2,
        bonus: function(pContext, pPoint) {
            if(MapGen.Layers.Get(pContext.Layers.terrainEdge, pPoint.x, pPoint.y, 0))
                return 0x10000000;

            return 0;
        },
        materialize: function(pPoint, pPosition) {
            Map.SpriteAdd(SpriteTypes.Shrub2, pPosition.x, pPosition.y);
            Session.Background.LittleShrub2Positions.push(pPosition);
        }
    });

    MapGen.Decor.Register(Terrain.Types.Jungle, {
        name: "rock",
        baseCount: 8,
        minCount: 2,
        scoreSalt: 877,
        recordRadius: 1,
        placeDistance: 4,
        decorDistance: 3,
        allowKeepClear: false,
        avoidKeepClearRadius: 1,
        footprint: MapGen.Decor.IsOpenLand,
        bonus: function(pContext, pPoint) {
            if(MapGen.Decor.NearLayer(pContext.Layers.blocked, pPoint.x, pPoint.y, 1))
                return 0x10000000;
            return 0;
        },
        runtimeCheck: function(pPoint) {
            return MapGen.Integration.DecorFootprintIsJungleLightGround(pPoint);
        },
        materialize: function(pPoint, pPosition) {
            var palette = (Terrain.Jungle.Sub0 && Terrain.Jungle.Sub0.Rocks) || [17, 33];
            var tile = Structures.TileChoice(palette, pPoint.x, pPoint.y, 877);
            Map.TileSet(pPoint.x, pPoint.y, tile);
        }
    });

    MapGen.Decor.Register(Terrain.Types.Jungle, {
        name: "skeleton",
        baseCount: 2,
        minCount: 0,
        scoreSalt: 883,
        recordRadius: 1,
        placeDistance: 12,
        decorDistance: 8,
        allowKeepClear: false,
        avoidKeepClearRadius: 4,
        footprint: MapGen.Decor.IsOpenLand,
        materialize: function(pPoint, pPosition) {
            var palette = (Terrain.Jungle.Sub0 && Terrain.Jungle.Sub0.Skeletons) || [391];
            var tile = Structures.TileChoice(palette, pPoint.x, pPoint.y, 883);
            Map.TileSet(pPoint.x, pPoint.y, tile);
        }
    });

    MapGen.Decor.Register(Terrain.Types.Jungle, {
        name: "water_patch",
        baseCount: 4,
        minCount: 0,
        scoreSalt: 887,
        recordRadius: 1,
        placeDistance: 5,
        decorDistance: 4,
        allowKeepClear: false,
        avoidKeepClearRadius: 1,
        footprint: function(pContext, pPoint) {
            if(!MapGen.Decor.IsOpenLand(pContext, pPoint))
                return false;
            // Don't drop a puddle within sight of real water — it'd just look like noise.
            var coastBuffer = (pContext.Profile && pContext.Profile.CoastWaterWidth) || 3;
            if(MapGen.Decor.NearLayer(pContext.Layers.water, pPoint.x, pPoint.y, coastBuffer))
                return false;
            if(MapGen.Decor.NearLayer(pContext.Layers.riverBank, pPoint.x, pPoint.y, coastBuffer))
                return false;
            return true;
        },
        materialize: function(pPoint, pPosition) {
            var palette = (Terrain.Jungle.Sub0 && Terrain.Jungle.Sub0.WaterPatches) || [39, 395];
            var tile = Structures.TileChoice(palette, pPoint.x, pPoint.y, 887);
            Map.TileSet(pPoint.x, pPoint.y, tile);
        }
    });

    MapGen.Decor.Register(Terrain.Types.Jungle, {
        name: "bloom",
        baseCount: 12,
        minCount: 4,
        scoreSalt: 831,
        recordRadius: 1,
        placeDistance: 5,
        decorDistance: 4,
        allowKeepClear: false,
        avoidKeepClearRadius: 2,
        bonus: function(pContext, pPoint) {
            if(MapGen.Decor.NearLayer(pContext.Layers.riverBank, pPoint.x, pPoint.y, 2))
                return 0x12000000;

            return 0;
        },
        materialize: function(pPoint, pPosition) {
            Map.TileSet(pPoint.x, pPoint.y, 74);
            Session.Background.BloomPositions.push(pPosition);
        }
    });

    function pickJungleHoleTile(pPoint) {
        var palette = Terrain.Jungle.Sub0 && Terrain.Jungle.Sub0.Hole;
        if(!palette || !palette.length)
            return null;
        return Structures.TileChoice(palette, pPoint.x, pPoint.y, 901);
    }

    MapGen.Decor.Register(Terrain.Types.Jungle, {
        name: "hole",
        baseCount: 4,
        minCount: 0,
        scoreSalt: 901,
        recordRadius: 2,
        placeDistance: 8,
        decorDistance: 6,
        allowKeepClear: false,
        avoidKeepClearRadius: 3,
        footprint: MapGen.Decor.IsOpenLand,
        materialize: function(pPoint, pPosition) {
            var tile = pickJungleHoleTile(pPoint);
            if(tile === null || tile === undefined)
                return;
            Map.TileSet(pPoint.x, pPoint.y, tile);
            Map.SpriteAdd(SpriteTypes.GroundHole, pPosition.x, pPosition.y);
        }
    });

})();
