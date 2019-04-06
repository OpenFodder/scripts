
/**
 * Functions for calculating positions on a map
 */
var Positioning = {
    
    /**
     * Find a position on the map which 'SpriteType' can walk to from its location
     * 
     * @param {*} pSpriteType     Type of the sprite
     * @param {*} pSpritePosition Position of the sprite
     * @param {*} pMaxAttempts    Maximum number of attempts to find a random X/Y (default 20)
     * 
     */
    RandomWalkable: function(pSpriteType, pSpritePosition, pMaxAttempts) {
        if(pMaxAttempts === undefined)
            pMaxAttempts = 20;

        Attempts = 0;
        Distance = [];
        
        // Find a position which can be accessed by moving
        do {
            Position = Map.getRandomXYByFeatures(Terrain.Features.FlatGround(), 1);
            Distance = Map.calculatePathBetweenPositions(pSpriteType, Position, pSpritePosition);
            ++Attempts;
        } while(Distance.length < 2 && Attempts < pMaxAttempts);

        if(Attempts >= pMaxAttempts) {
            Position = pSpritePosition;
            Position.x += 16;
            print("Failed to find a walkable position");
        }

        return Position;
    }
}