/**
 * OpenFodder
 * 
 * Map objective verification
 */


var Validation = {

    /**
     * Ensure a path exists between human sprites and sprites of type pSpriteType
     * 
     * @param {number} pSpriteType Type of sprites to ensure a path exists between
     */
    WalkToSprites: function(pSpriteType) {
        Sprites = Map.getSpritesByType(pSpriteType);

        for(x = 0; x < Sprites.length; ++x) {

            Path = Map.calculatePathBetweenPositions(SpriteTypes.Player, Sprites[x].getPosition(), Session.HumanPosition);
            if(Path.length == 0)
                return false;
        }
        return true;
    },

    /**
     * Ensure the map can be completed
     */
    ValidateMap: function() {
        print("Validating map objectives");

        this.canKillAllEnemy()

        // If a rescue tent is placed
        if (Session.isRescueTentPlaced()) {
            this.canHostageRescue();
        }

        // Can we access all buildings
        this.canDestroyEnemyBuilding();

        this.canAccessWeapons();

        if(Session.HelicopterMinimum >= 0)
            Session.Helicopter = Helicopters.Human.Random(SpriteTypes.Helicopter_Grenade_Human + Session.HelicopterMinimum);

    },

    /**
     * Can we access enough weapons to complete the map
     */
    canAccessWeapons: function() {
        print("Can we access weapons");        
        // Determine if we can walk to each grenade box
        canWalkTo = 0;
        Grenades = Map.getSpritesByType(SpriteTypes.GrenadeBox);
        for(count = 0; count < Grenades.length; ++count) {
            Path = Map.calculatePathBetweenPositions(SpriteTypes.Player, Grenades[count].getPosition(), Session.HumanPosition);
            if(Path.length) {
                ++canWalkTo;
            }
        }

        // Can we walk to enough grenades?
        if(canWalkTo >= Session.RequiredMinimumGrenades())
            return;

        // If we have a helicopter, it can be used
        if(Session.HelicopterMinimum >= 0)
            return;

        print("Placing Grenades");
        // Place more grenades in walkable path
        totalNades = Session.RequiredMinimumGrenades() - canWalkTo;
        Weapons.RandomGrenades(totalNades, true);
    },

    /**
     * Can we walk to all enemy sprites
     */
    canKillAllEnemy: function() {

        // Can we walk to all enemy?
        if(!this.WalkToSprites(SpriteTypes.Enemy))
            Session.RequireHelicopter(0);
    },

    /**
     * Can we destroy all enemy buildings
     * 
     * @return true If we can walk to and destroy any buildings
     */
    canDestroyEnemyBuilding: function() {
        print("Can the buildings be destroyed");

        // Helictopers can destroy buildings
        if(Helicopters.Human.HaveAny())
            return;

        for(count = 0; count < Session.BuildingPositions.length; ++count) {
            Path = Map.calculatePathBetweenPositions(SpriteTypes.Player, Session.BuildingPositions[count], Session.HumanPosition);
            if(Path.length == 0) {
                Session.RequireHelicopter(0);
                return;
            }
        }

        return;
    },

    /**
     * Ensure a path exists between the rescue tent, the humans, and each placed hostage
     */
    canHostageRescue: function() {
        print("Can the hostages be rescued");

        // Calculate a walkable path the tent and the humans 
        Distance = Map.calculatePathBetweenPositions(SpriteTypes.Player, Session.RescueTentPosition, Session.HumanPosition);
        if(Distance.length == 0) {
            Session.RequireHelicopter(0);
            return;
        }

        // Check if any of the hostage groups cant walk to the rescue tent
        for( x = 0; x < Session.HostageGroupPositions.length; ++x) {
            Distance = Map.calculatePathBetweenPositions(SpriteTypes.Hostage, Session.RescueTentPosition, Session.HostageGroupPositions[x]);
            if(Distance.length == 0) {
                Session.RequireHelicopter(0);
                return;
            }
        }
        print("Hostages can be rescued");
        return; 
    }
}