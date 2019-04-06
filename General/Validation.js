/**
 * OpenFodder
 * 
 * Map objective verification
 */


var Validation = {

    ValidateMap: function() {

        if (Session.isRescueTentPlaced()) {

            if(!this.ValidateHostageRescue()) {

                Session.RescueHelicopter = Helicopters.Human.Random();
            }
        }
    },

    /**
     * Ensure a path exists between the rescue tent, the humans, and each placed hostage
     */
    ValidateHostageRescue: function() {

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