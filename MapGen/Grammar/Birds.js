var MapGen = MapGen || {};
MapGen.Grammar = MapGen.Grammar || {};

MapGen.Grammar.Birds = {
    IsBird: function(type) {
        return type === 19 || type === 66 || type === 67;
    },

    Supported: function(profile) {
        // CF1 originals use 66/67 on these atlases. Beach shares junarmy.
        // Do not infer support for indoor, moor or special-edition sheets.
        var terrain = profile.TerrainType, sub = profile.TerrainTypeSub || 0;
        return (terrain === Terrain.Types.Jungle && (sub === 0 || sub === 1)) ||
            ((terrain === Terrain.Types.Ice || terrain === Terrain.Types.Desert) && sub === 0);
    },

    Apply: function(c, out) {
        // Replace birds sampled as generic decor (including ice fallbacks).
        // Keep those earlier draws unchanged so birds cannot reshuffle terrain,
        // buildings or enemies. Non-bird decoration retains its existing budget.
        var self = this;
        out.decor = out.decor.filter(function(p) { return !self.IsBird(p.spriteType); });
        // A separate group keeps airborne sprites out of ground-route snapping.
        out.birds = [];
        if(!this.Supported(c.Profile) || MapGen.Context.IsMultiplayer(c)) return;
        var random = MapGen.Random.CreateSeeded(MapGen.Random.HashTile(c.Seed, 0, 0, 24107));
        var roll = random.Int(0, 99), count = roll < 40 ? 0 : roll < 90 ? 1 : 2;
        // These actors recycle around the camera, so area must not multiply
        // their density. Small maps get at most one; all others at most two.
        if(c.Width * c.Height < 4096) count = Math.min(count, 1);
        var points = [];
        for(var attempt = 0; attempt < 32 && points.length < count; ++attempt) {
            var point = {x:random.Int(3, c.Width - 4), y:random.Int(3, c.Height - 4)};
            if(points.length && MapGen.Grammar.Sprites.PointDistanceSquared(point, points[0]) < 400)
                continue;
            var left = random.Chance(0.5);
            out.birds.push(MapGen.Grammar.Sprites.Placement("bird_" + points.length,
                "decor", "ambient_bird", point,
                {type:left ? SpriteTypes.Bird_Left : SpriteTypes.Bird_Right,
                    name:left ? "Bird_Left" : "Bird_Right"}, "sparse_birds"));
            points.push(point);
        }
    }
};
