
var Background = {

    /**
     * 
     * @param {number}  pCount      
     */
    RandomPalms: function(pCount) {
        print("Placing Palms");
        for(count = 0; count < pCount; ++count ) {
            var position = Map.getRandomXYByTileID(Terrain.Jungle.DarkGrassTiles, 1);
            var correct = true;
            if(position.x != -1 && position.y != -1) {
                print("Session.Background.TreePositions.length: " + Session.Background.TreePositions.length);
                if(Session.Background.TreePositions.length > 0){
                    print("check other bushes positions...")
                    for(count = 0; count < Session.Background.TreePositions.length; ++count) {
                        if(Map.getDistanceBetweenPositions(Session.Background.TreePositions[count], position) < 80 ) {
                            print("too close to other positions!")
                            correct = false;
                            break;
                        }
                    }
                }
                if(correct) {
                    Map.SpriteAdd( SpriteTypes.Tree, position.x, position.y + 4 );
                    TileX = position.x / 16;
                    TileY = position.y / 16;
                    Map.TileSet( TileX, TileY, 58 );
                    Session.Background.TreePositions.push(position);
                    print("added to session: x: " + position.x + " - y: " + position.y);
                }
            }
        }
    },

    /**
     * 
     * @param {number} pCount 
     */
    RandomBushes1: function(pCount) {
        print("Placing Bushes1");
        for(count = 0; count < pCount; ++count ) {
            var position = Map.getRandomXYByTileID(Terrain.Jungle.LightGrassTiles, 1);
            var correct = true;
            if(position.x != -1 && position.y != -1) {
                print("Session.Background.Bush1Positions.length: " + Session.Background.Bush1Positions.length);
                if(Session.Background.Bush1Positions.length > 0){
                    print("check other bushes positions...")
                    for(count = 0; count < Session.Background.Bush1Positions.length; ++count) {
                        if(Map.getDistanceBetweenPositions(Session.Background.Bush1Positions[count], position) < 80 ) {
                            print("too close to other positions!")
                            correct = false;
                            break;
                        }
                    }
                }
                if(correct) {
                    Map.SpriteAdd( SpriteTypes.Shrub, position.x, position.y + 4 );
                    TileX = position.x / 16;
                    TileY = position.y / 16;
                    Map.TileSet( TileX, TileY - 1, 50 );
                    Map.TileSet( TileX + 1, TileY - 1, 51 );
                    Map.TileSet( TileX, TileY, 70 );
                    Map.TileSet( TileX + 1, TileY, 71 );
                    Session.Background.Bush1Positions.push(position);
                    print("added to session: x: " + position.x + " - y: " + position.y);
                }
            }
        }
    },

    /**
     * 
     * @param {number} pCount 
     */
    RandomBlooms: function(pCount) {
        print("Placing Blooms");
        for(count = 0; count < pCount; ++count ) {
            var position = Map.getRandomXYByTileID(Terrain.Jungle.LightGrassTiles, 1);
            var correct = true;
            if(position.x != -1 && position.y != -1) {
                print("Session.Background.BloomPositions.length: " + Session.Background.BloomPositions.length);
                if(Session.Background.BloomPositions.length > 0){
                    print("check other bushes positions...")
                    for(count = 0; count < Session.Background.BloomPositions.length; ++count) {
                        if(Map.getDistanceBetweenPositions(Session.Background.BloomPositions[count], position) < 80 ) {
                            print("too close to other positions!")
                            correct = false;
                            break;
                        }
                    }
                }
                if(correct) {
                    TileX = position.x / 16;
                    TileY = position.y / 16;
                    Map.TileSet( TileX, TileY, 74 );
                    Session.Background.BloomPositions.push(position);
                    print("added to session: x: " + position.x + " - y: " + position.y);
                }
                
            }
        }
    },

    /**
     * 
     * @param {Array<Array<number>>} pCounts
     */
    Random: function(pCounts) {

        this.RandomPalms(pCounts.Palms);
        this.RandomBushes1(pCounts.Bushes1);
        this.RandomBlooms(pCounts.Blooms);
    }
}
