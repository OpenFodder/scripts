var MultiplayerClasses = {

    Soldier: {
        ID: 0,
        Name: "Soldier",
        Sprite: 0
    },

    Grenadier: {
        ID: 1,
        Name: "Grenadier",
        Sprite: 0
    },

    Rocketeer: {
        ID: 2,
        Name: "Rocketeer",
        Sprite: 0
    },

    All: function() {
        return [this.Soldier, this.Grenadier, this.Rocketeer];
    },

    Get: function(pClassID) {
        var classes = this.All();
        for(var index = 0; index < classes.length; ++index) {
            if(classes[index].ID == pClassID)
                return classes[index];
        }

        return this.Soldier;
    }
};
