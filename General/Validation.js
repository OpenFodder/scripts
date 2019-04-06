/**
 * OpenFodder
 * 
 * Map objective verification
 */


var Validation = {

    /**
     * Ensure the map can be completed
     */
    ValidateMap: function() {
        needHelicopter = false;

        if( this.canKillAllEnemy() == false)
            needHelicopter = true;

        // If a rescue tent is placed
        if (Session.isRescueTentPlaced()) {

            // Ensure it can be completed by walking
            if(!this.canHostageRescue()) 
                needHelicopter = true;
        }

        if(needHelicopter) {
            if(Session.Helicopter === null)
                Session.Helicopter = Helicopters.Human.Random();
        }
    },

    /**
     * Ensure a path exists between human sprites and sprites of type pSpriteType
     */
    WalkToSprites: function(pSpriteType) {
        Sprites = Map.getSpritesByType(pSpriteType);

        for(x = 0; x < Sprites.length; ++x) {
            Distance = Map.calculatePathBetweenPositions(SpriteTypes.Hostage, Sprites[x].getPosition(), Session.HumanPosition);
            if(Distance.length == 0) {
                return false;
            }
        }

        return true;
    },

    /**
     * Can we walk to all enemy sprites
     */
    canKillAllEnemy: function() {

        return this.WalkToSprites(SpriteTypes.Enemy);
    },

    /**
     * Ensure a path exists between the rescue tent, the humans, and each placed hostage
     */
    canHostageRescue: function() {

        // Calculate a walkable path the tent and the humans 
        Distance = Map.calculatePathBetweenPositions(SpriteTypes.Player, Session.RescueTentPosition, Session.HumanPosition);
        if(Distance.length == 0)
            return false;
        
        // Check if any of the hostage groups cant walk to the rescue tent
        for( x = 0; x < Session.HostageGroupPositions.length; ++x) {
            Distance = Map.calculatePathBetweenPositions(SpriteTypes.Hostage, Session.RescueTentPosition, Session.HostageGroupPositions[x]);
            if(Distance.length == 0) {
                return false;
            }
        }

        return true;
    }
}