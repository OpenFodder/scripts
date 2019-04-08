class cPosition {
    x: number;
    y: number;
}

class sSprite {
    x: number;
    y: number;
}

interface cCampaign {
    name: string;
    author: string;

    getMissions(): Array<cMission>;
    SetCustomCampaign(): void;
}

interface cMap {

    /**
     * Save to disk
     */
    save(): void;

    /**
     * Add a barracks
     * 
     * @param pX 
     * @param pY 
     */
    addBarracks(pX, pY): void;

    /**
     * Create a new map
     * 
     * @param pWidth
     * @param pHeight 
     * @param pTypeTile 
     * @param pTileSub 
     */
    Create(pWidth:number, pHeight:number, pTypeTile:number, pTileSub:number): void;

    /**
     * 
     * @param pSeed 
     */
    CreateRandom(pSeed:number): void;

    createSimplexIslands(pOctaves, pRoughness, pScale, pSeed, pRadialEnabled, pEdgeFade): void;
    createSimplexNoise(pOctaves, pFrequency, pLacunarity, pPersistence): void;

    getTileType(): number;
    getTileSub(): number;

    getWidth(): number;
    getHeight(): number;

    getWidthPixels(): number;
    getHeightPixels(): number;

    getSpriteTypeCount(pSpriteType): number;
    getSpritesByType(pSpriteType): Array<sSprite>;

    /**
     * Get a random X/Y if the tiles within the radius contain the provided tile id
     * @param pTiles 
     * @param pRadius 
     */
    getRandomXYByTileID( pTiles:Array<number>, pRadius:number ) : cPosition;

    /**
     * Get a random X/Y if the tiles within the radius have the provided features
     * @param pFeatures 
     * @param pRadius 
     * @param pIgnoreSprites 
     */
    getRandomXYByFeatures( pFeatures:Array<number>, pRadius:number, pIgnoreSprites:boolean ) : cPosition;

    /**
     * Get a random X/Y if the tiles within the radius have the provided feature
     * 
     * @param pType 
     * @param pRadius 
     */
    getRandomXYByTerrainType( pType:number, pRadius:number ) : cPosition;

    /**
     * Add a sprite to the map
     * 
     * @param pSpriteID
     * @param pSpriteX 
     * @param pSpriteY 
     */
    SpriteAdd(pSpriteID:number, pSpriteX:number, pSpriteY:number ) : void;

    /**
     * Get the tile ID at X/Y
     * 
     * @param pTileX 
     * @param pTileY 
     */
    TileGet(pTileX:number, pTileY:number) : void;

    /**
     * Set the tile at X/Y
     * 
     * @param pTileX 
     * @param pTileY 
     * @param pTileID 
     */
    TileSet(pTileX:number, pTileY:number, pTileID:number) : void;

    /**
     * Get a random int between min/max
     * 
     * @param pMin 
     * @param pMax 
     */
    getRandomInt(pMin:number, pMax:number) : number;

    /**
     * Get a random float between the min/max
     * 
     * @param pMin 
     * @param pMax 
     */
    getRandomFloat(pMin:number, pMax:number) : number;

    /**
     * Calculate the distance between two positions
     * 
     * @param pPos1 
     * @param pPos2 
     */
    getDistanceBetweenPositions(pPos1:cPosition, pPos2:cPosition) : number;

    /**
     * Calculate a path between two positions for the provided sprite type
     * 
     * @param pSpriteType Type of sprite
     * @param pPos1 Starting position
     * @param pPos2 Finishing position
     */
    calculatePathBetweenPositions(pSpriteType:number, pPos1:cPosition, pPos2:cPosition) : Array<cPosition>;
}

interface cPhase {
    /**
     * Map filename
     */
    map: string;

    /**
     * Phase name
     */
    name: string;

    ObjectiveAdd(pObjectiveID): void;
    ObjectiveRemove(pObjectiveID): void;
    ObjectivesClear(): void;

    SetMinAggression(pMin): void;
    setMaxAggression(pMax): void;
}

interface cMission {
    /**
     * Mission name
     */
    name: string;

    NumberOfPhases(): number;
    PhaseGet(): cPhase;
}

interface cScriptingEngine {

    /**
     * Execute a script with the provided name
     * 
     * @param pFilename 
     */
    scriptCall(pFilename): void;

    /**
     * Get the current campaign
     */
    getCampaign(): cCampaign;

    /**
     * Get the current Map
     */
    getMap(): cMap;

    /**
     * Get the current Phase
     */
    getPhase(): cPhase;

    /**
     * Get the current Mission
     */
    getMission() : cMission;

    /**
     * Create a new mission
     */
    missionCreate() : cMission;
    
    /**
     * Create a new phase
     */
    phaseCreate() : cPhase;

    /**
     * Save the current map
     */
    mapSave() : void;
}

declare var Engine: cScriptingEngine;
