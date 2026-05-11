var Structures = {
    Jungle: {
        Hut: {},
        Barracks: {},
        Bunker: {}
    },
    Desert: {
        Hut: {},
        Barracks: {},
        Bunker: {}
    },
    Ice: {
        Hut: {},
        Barracks: {},
        Bunker: {}
    },
    Moors: {
        Hut: {},
        Barracks: {},
        Bunker: {}
    },
    Interior: {
        Hut: {},
        Barracks: {},
        Bunker: {}
    },
    AmigaFormat: {
        Hut: {},
        Barracks: {},
        Bunker: {}
    },

    /**
     * 
     */
    HasStructureSet: function(pStruct) {
        return pStruct &&
            pStruct.Hut && pStruct.Hut.Struct && pStruct.Hut.Struct.length &&
            pStruct.Barracks && pStruct.Barracks.Struct && pStruct.Barracks.Struct.length &&
            pStruct.Bunker && pStruct.Bunker.Struct && pStruct.Bunker.Struct.length;
    },

	GetCurrent: function(pTerrainType) {
		switch(pTerrainType === undefined ? Map.getTileType() : pTerrainType) {

			case Terrain.Types.Jungle:
				return Structures.Jungle;
			case Terrain.Types.Desert:
				return Structures.Desert;
			case Terrain.Types.Ice:
				return Structures.Ice;
			case Terrain.Types.Moors:
				return Structures.Moors;
			case Terrain.Types.Interior:
				return Structures.Interior;
			case Terrain.Types.AmigaFormat:
				if(this.HasStructureSet(Structures.AmigaFormat))
					return Structures.AmigaFormat;
				return Structures.Ice;

			default:
				return Structures.Jungle;
		}
    },

    // Reads the loaded sub-tileset from the runtime Map binding (cOriginalMap::
    // getTileSub returns 0/1, set by the .map header at offset 0x10). Jungle
    // structures are sub-variant gated, so sub1 coastal/beach profiles can avoid
    // stamping inland-only art while bridge picking resolves to the right set.
    GetActiveSubVariant: function() {
        if(typeof Map !== "undefined" && typeof Map.getTileSub === "function") {
            var sub = Map.getTileSub();
            if(sub === 1)
                return 'sub1';
        }
        return 'sub0';
    },

    GetStructInfo: function(pStructType, pTerrainType) {
        var Struct = this.GetCurrent(pTerrainType);

        switch(pStructType.toLowerCase()) {
            case "barracks":
                return Struct.Barracks;
            case "hut":
                return Struct.Hut;
            case "bunker":
                return Struct.Bunker;
            default:
                print("Invalid structure: " + pStructType);
                break;
        }
    },

    /**
     * 
     * @param {string} pStructType
     */
    GetStructPositions: function(pStructType) {

        switch(pStructType.toLowerCase()) {
            case "barracks":
                return Session.BarracksPositions;

            case "huts":
                return Session.HutPositions;

            case "bunker":
                return Session.BunkerPositions;

            default:
                return [];
        }
    },

    TileChoice: function(pChoices, pTileX, pTileY, pSalt) {
        if(!pChoices || !pChoices.length)
            return 0;

        if(typeof MapGen !== "undefined" && MapGen.Render && MapGen.Render.HashTile)
            return pChoices[MapGen.Render.HashTile(Map.seed || 0, pTileX, pTileY, pSalt || 0) % pChoices.length];

        return pChoices[(Math.abs((pTileX * 31) + (pTileY * 17) + (pSalt || 0))) % pChoices.length];
    },

    StructureBounds: function(pStruct) {
        var bounds = {
            minX: 0,
            minY: 0,
            maxX: 0,
            maxY: 0
        };

        if(!pStruct || !pStruct.length)
            return bounds;

        bounds.minX = pStruct[0][0];
        bounds.minY = pStruct[0][1];
        bounds.maxX = pStruct[0][0];
        bounds.maxY = pStruct[0][1];

        for(var index = 1; index < pStruct.length; ++index) {
            bounds.minX = Math.min(bounds.minX, pStruct[index][0]);
            bounds.minY = Math.min(bounds.minY, pStruct[index][1]);
            bounds.maxX = Math.max(bounds.maxX, pStruct[index][0]);
            bounds.maxY = Math.max(bounds.maxY, pStruct[index][1]);
        }

        return bounds;
    },

    DistanceFromRect: function(pX, pY, pMinX, pMinY, pMaxX, pMaxY) {
        var dx = 0;
        var dy = 0;

        if(pX < pMinX)
            dx = pMinX - pX;
        else if(pX > pMaxX)
            dx = pX - pMaxX;

        if(pY < pMinY)
            dy = pMinY - pY;
        else if(pY > pMaxY)
            dy = pY - pMaxY;

        return Math.sqrt((dx * dx) + (dy * dy));
    },

    BuildJungleSiteChars: function(pWidth, pHeight, pSiteMinX, pSiteMinY, pSiteMaxX, pSiteMaxY, pRadius) {
        var chars = MapGen.Layers.Create(pWidth, pHeight, "+");

        for(var x = 0; x < pWidth; ++x) {
            for(var y = 0; y < pHeight; ++y) {
                if(this.DistanceFromRect(x, y, pSiteMinX, pSiteMinY, pSiteMaxX, pSiteMaxY) <= pRadius)
                    MapGen.Layers.Set(chars, x, y, "#");
            }
        }

        return chars;
    },

    TileInList: function(pTile, pTiles) {
        for(var index = 0; index < pTiles.length; ++index) {
            if(pTiles[index] === pTile)
                return true;
        }

        return false;
    },

    CurrentMapTile: function(pTileX, pTileY) {
        if(typeof Map.TileGet === "function")
            return Map.TileGet(pTileX, pTileY);

        return -1;
    },

    CanPaintJungleSiteTile: function(pTileX, pTileY, pIsDarkPatch) {
        var currentTile = this.CurrentMapTile(pTileX, pTileY);

        if(this.TileInList(currentTile, [326, 346, 107, 167]))
            return false;

        if(!this.TileInList(currentTile, this.JungleSitePaintableTiles()))
            return false;

        if(!pIsDarkPatch && this.TileInList(currentTile, [123, 124]))
            return false;

        return true;
    },

    JungleSitePaintableTiles: function() {
        var tiles = [
            0, 18, 19, 20, 40,
            47, 48, 49, 67, 68, 69,
            123, 124, 127, 128,
            165, 185, 205, 209, 210, 225, 228, 229
        ];

        if(typeof MapGen !== "undefined" && MapGen.Terrain && MapGen.Terrain.TileCatalog) {
            var transitionTiles = MapGen.Terrain.TileCatalog.JungleTransitionTiles("lightgrassDarkgrass");

            for(var index = 0; index < transitionTiles.length; ++index) {
                if(!this.TileInList(transitionTiles[index], tiles))
                    tiles.push(transitionTiles[index]);
            }
        }

        return tiles;
    },

    JungleSiteTransitionData: function() {
        if(typeof MapGen !== "undefined" &&
            MapGen.Terrain &&
            MapGen.Terrain.TileCatalog &&
            MapGen.Terrain.TileCatalog.TransitionData) {
            return MapGen.Terrain.TileCatalog.TransitionData("bm_cf1_jungle_lightgrass_darkgrass");
        }

        if(typeof bm_cf1_jungle_lightgrass_darkgrass !== "undefined")
            return bm_cf1_jungle_lightgrass_darkgrass;

        return null;
    },

    ApplyJungleSiteApron: function(pTileX, pTileY, pStruct, pStructType, pSpriteSet) {
        if(Map.getTileType() !== Terrain.Types.Jungle)
            return 0;
        if(typeof MapGen === "undefined" || !MapGen.Layers || !MapGen.Terrain || !MapGen.Terrain.Smoothing || !MapGen.Terrain.Smoothing.Core)
            return 0;

        var transitionData = this.JungleSiteTransitionData();
        if(!transitionData)
            return 0;

        var bounds = this.StructureBounds(pStruct);
        var isHut = pStructType && pStructType.toLowerCase() === "hut";
        if(!isHut)
            return 0;

        var left = 1;
        var right = 1;
        var top = 1;
        var bottom = 1;
        var edge = 1;
        var localWidth = (bounds.maxX - bounds.minX + 1) + left + right + (edge * 2);
        var localHeight = (bounds.maxY - bounds.minY + 1) + top + bottom + (edge * 2);
        var originX = pTileX + bounds.minX - left - edge;
        var originY = pTileY + bounds.minY - top - edge;
        var siteMinX = left + edge;
        var siteMinY = top + edge;
        var siteMaxX = siteMinX + (bounds.maxX - bounds.minX);
        var siteMaxY = siteMinY + (bounds.maxY - bounds.minY);
        var apronRadius = 1.35;
        var chars = this.BuildJungleSiteChars(localWidth, localHeight, siteMinX, siteMinY, siteMaxX, siteMaxY, apronRadius);
        var tiles = MapGen.Layers.Create(localWidth, localHeight, 0);
        var context = {
            Width: localWidth,
            Height: localHeight,
            Seed: Map.seed || 0
        };
        var darkGrass = [123, 124];
        var painted = 0;

        for(var x = 0; x < localWidth; ++x) {
            for(var y = 0; y < localHeight; ++y) {
                var cell = MapGen.Layers.Get(chars, x, y, "+");
                var worldX = originX + x;
                var worldY = originY + y;

                if(cell === "#")
                    MapGen.Layers.Set(tiles, x, y, this.TileChoice(darkGrass, worldX, worldY, cell.charCodeAt(0)));
            }
        }

        MapGen.Terrain.Smoothing.Core.ApplyTransitionRule(context, chars, tiles, {
            center: "+",
            ground: "#",
            data: transitionData,
            salt: 70
        });

        for(var tx = 0; tx < localWidth; ++tx) {
            for(var ty = 0; ty < localHeight; ++ty) {
                var distance = this.DistanceFromRect(tx, ty, siteMinX, siteMinY, siteMaxX, siteMaxY);
                var worldTileX = originX + tx;
                var worldTileY = originY + ty;
                var siteTile = MapGen.Layers.Get(tiles, tx, ty, 0);
                var darkPatch = MapGen.Layers.Get(chars, tx, ty, "+") === "#";

                if(distance > apronRadius + edge)
                    continue;
                if(worldTileX < 0 || worldTileY < 0 || worldTileX >= Map.getWidth() || worldTileY >= Map.getHeight())
                    continue;
                if(!siteTile)
                    continue;
                if(!this.CanPaintJungleSiteTile(worldTileX, worldTileY, darkPatch))
                    continue;

                Map.TileSet(worldTileX, worldTileY, siteTile);
                ++painted;
            }
        }

        return painted;
    },

    PrepareTerrain: function(pPosition, pStruct, pStructType, pSpriteSet) {
        if(!pStruct || pPosition.x < 0 || pPosition.y < 0)
            return;

        var tileX = Math.floor(pPosition.x / 16);
        var tileY = Math.floor(pPosition.y / 16);
        this.ApplyJungleSiteApron(tileX, tileY, pStruct, pStructType, pSpriteSet);
    },

    // Structure sprite slots are authored as pixel offsets from the structure's
    // tile origin. This is the same anchor convention used by
    // cMapData::Structure_Add: tile origin + authored offset (the relevant CF1
    // structure sheets all have zero ModX/ModY). Keep this calculation in one
    // place so placement and final-map validation cannot disagree about it.
    SpritePosition: function(pTileX, pTileY, pSpriteSlot) {
        return {
            x: (pTileX * 16) + pSpriteSlot[0],
            y: (pTileY * 16) + pSpriteSlot[1]
        };
    },

    /**
     * Place a structure
     *
     * @param {cPosition} pPosition
     * @param {sStructure} pStructure
     * @param {string} pStructSet
     * @param {string} pSpriteSet
     */
    Place: function(pPosition, pStructure, pStructSet, pSpriteSet, pStructType) {
        var TileX = Math.floor(pPosition.x / 16);
        var TileY = Math.floor(pPosition.y / 16);

        if(pStructure === undefined || pStructure.Struct === undefined || pStructure.Types === undefined)
            return false;

        if(pStructure.SubVariantsAllowed && pStructure.SubVariantsAllowed.indexOf(this.GetActiveSubVariant()) < 0)
            return false;

        var Struct = pStructure.Struct[pStructSet];
        var Sprites = pStructure.Types[pSpriteSet.toLowerCase()];

        if(Sprites === undefined && pSpriteSet !== "") {
            print("Structure does not have sprite-set: " + pSpriteSet);
            return false;
        }

        //this.PrepareTerrain(pPosition, Struct, pStructType || "", pSpriteSet || "");

        // Set the terrain tiles
        for( var count = 0; count < Struct.length; ++count ) {
            Map.TileSet(TileX + Struct[count][0], TileY + Struct[count][1], Struct[count][2]);
        }

        // Now add the sprites
        for( var count = 0; count < Sprites.length; ++count ) {
            var SpritePosition = this.SpritePosition(TileX, TileY, Sprites[count]);
            print("Place type:" + Sprites[count][2] + " x:" + SpritePosition.x + " y: " + SpritePosition.y);
            Map.SpriteAdd(Sprites[count][2], SpritePosition.x, SpritePosition.y);
        }

        return true;
    },

    /**
     * Place a civilian hut
     * 
     * @param {cPosition} pPosition
     * @param {string} pHutType
     */
    PlaceHut: function(pPosition, pHutType) {
        var Struct = this.GetCurrent();
        if(this.Place(pPosition, Struct.Hut, 0, pHutType, "hut")) {
            Session.HutPositions.push(pPosition);
            return true;
        }
        return false;
    },

    /**
     * Place a barracks
     *
     * @param {cPosition} pPosition
     * @param {string} pSpriteSet
     */
    PlaceBarracks: function(pPosition, pSpriteSet) {
        var Struct = this.GetCurrent();
        if(this.Place(pPosition, Struct.Barracks, 0, pSpriteSet, "barracks")) {
            Session.BarracksPositions.push(pPosition);
            return true;
        }
        return false;
    },

    /**
     * Place a bunker
     *
     * @param {cPosition} pPosition
     * @param {string} pSpriteSet
     */
    PlaceBunker: function(pPosition, pSpriteSet) {
        var Struct = this.GetCurrent();
        if(this.Place(pPosition, Struct.Bunker, 0, pSpriteSet, "bunker")) {
            Session.BunkerPositions.push(pPosition);
            return true;
        }
        return false;
    },

    /**
     *
     * Place a number of 'pStructType' at random locations, at a minimum of 'pMinDistance' from each other
     *
     * @param {string} pStructType
     * @param {string} pSpriteType
     * @param {number} pCount
     * @param {number} pMinDistance If undefined, value will be obtained from Settings.GetMinimumDistance
     */
    PlaceRandom: function(pStructType, pSpriteType, pCount, pMinDistance) {
        if(pMinDistance === undefined)
            var pMinDistance = Settings.GetMinimumDistance(pStructType, pSpriteType);

        var StructInfo = this.GetStructInfo(pStructType);

        for(var x = 0; x < pCount; ++x) {

            // Get the positions of the existing similar type structures
            var existingPositions = this.GetStructPositions(pStructType);

            var position = new cPosition(-1, -1);

            if(StructInfo.StructFindTile.length) {
                var type = Map.getRandomInt(0, StructInfo.StructFindTile.length - 1);
                position = Positioning.PositionOnTilesAwayFrom(StructInfo.StructFindTile[type], 3, existingPositions, pMinDistance );
            }

            if(position.x == -1 || position.y == -1) {
                print("Fallback position find to flatground");
                position = Positioning.PositionAwayFrom(Terrain.Features.FlatGround(), 4, existingPositions, pMinDistance );
            }

            if(position.x != -1 && position.y != -1) {
                existingPositions.push(position);

                this.Place(position, StructInfo, 0, pSpriteType, pStructType);
            }
        }
    },

    /**
     *
     * @param {object} pBuildings
     */
    PlaceBuildings: function(pBuildings) {

        for (var building in pBuildings) {
            for(var sprite in pBuildings[building]) {

                Structures.PlaceRandom(building, sprite, pBuildings[building][sprite]);
            };
        };

    }

};
