var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};

// Complete shared jungle-base stamps. Original junbase HIT/BHT marks every
// subtile as ground, rough ground or slow ground, never blocked/wet/hazardous.
// Keep this whitelist small: many other Brush tiles contain solid obstacles.
MapGen.Terrain.SurfaceDetail = {
    Stamps: [[84], [27], [28, 29], [30], [31], [32], [52], [53], [93], [96, 97], [199]],
    Ground: [0,7,8,9,10,11,12,13,14,15,16,18,19,20,38,40,47,48,49,59,
        67,68,69,78,87,108,123,124,127,128,165,185,205,209,210,225,228,229],
    // Complete dry, walkable rocks with snow-backed borders. Ice patches,
    // pits and the solid 2x2 boulder are not interchangeable with snow art.
    IceStamps: [[27], [28], [29], [30], [48], [60]],
    IceGround: [0,1],

    Commit: function(c) {
        if(!this.Palette(c) || !c.Profile.SurfaceDetailCoverage ||
            MapGen.Context.IsMultiplayer(c)) return null;
        var tiles = MapGen.Layers.Create(c.Width, c.Height, 0), x, y;
        for(x = 0; x < c.Width; ++x) for(y = 0; y < c.Height; ++y)
            tiles[x][y] = c.Map.TileGet(x,y);
        var report = this.Apply(c, tiles);
        for(x = 0; x < c.Width; ++x) for(y = 0; y < c.Height; ++y)
            if(tiles[x][y] !== c.Map.TileGet(x,y)) {
                c.Map.TileSet(x,y,tiles[x][y]);
                c.RenderedMap.Tiles[x][y] = tiles[x][y];
            }
        return report;
    },

    Eligible: function(c, tiles, x, y) {
        var ground = c.Profile.TerrainType === Terrain.Types.Ice ? this.IceGround : this.Ground;
        if(x < 1 || y < 1 || x >= c.Width - 1 || y >= c.Height - 1 ||
            ground.indexOf(MapGen.Layers.Get(tiles, x, y, -1)) < 0) return false;
        // Grass transition art belongs to the material field. A dark-backed
        // detail stamp must not punch a square into its light grass or edge.
        var tile=MapGen.Layers.Get(tiles,x,y,-1);
        if(MapGen.Terrain.GrassRegions.Enabled(c) && tile!==123 && tile!==124) return false;
        var l = c.Layers, get = MapGen.Layers.Get;
        return !get(l.water,x,y,0) && !get(l.riverBank,x,y,0) && !get(l.coast,x,y,0) &&
            !get(l.path,x,y,0) && !get(l.keepClear,x,y,0) && !get(l.occupied,x,y,0) &&
            !get(l.blocked,x,y,0) && !get(l.outcrop,x,y,0) && !get(l.crossing,x,y,0) &&
            get(l.owner,x,y,0) <= MapGen.Layers.Owner.OPEN;
    },

    Palette: function(c) {
        var p = c.Profile;
        if(p.TerrainType === Terrain.Types.Ice) return this.IceStamps;
        if(p.TerrainType !== Terrain.Types.Jungle) return null;
        return p.SurfaceDetailStyle === "meadow" ? this.Stamps.slice(0,3) :
            p.SurfaceDetailStyle === "scrub" ? this.Stamps.slice(3) : this.Stamps;
    },

    Apply: function(c, tiles) {
        var p = c.Profile, density = Number(p.SurfaceDetailCoverage) || 0, palette = this.Palette(c);
        if(!palette || density <= 0 || MapGen.Context.IsMultiplayer(c)) return null;
        var hash = MapGen.Random.HashTile, W = c.Width, H = c.Height;
        var ice = p.TerrainType === Terrain.Types.Ice, spaced = new Uint8Array(W * H);
        var step = 8 + hash(c.Seed, 0, 0, 19801) % 9, patches = [], candidates = [];
        // An independent jittered grid gives coherent, uneven meadows without
        // visiting every cell for every patch or consuming the mission RNG.
        for(var gy = 0; gy < Math.ceil(H / step); ++gy)
            for(var gx = 0; gx < Math.ceil(W / step); ++gx) {
                var h = hash(c.Seed, gx, gy, 19807);
                patches.push({x:(gx + (h & 255) / 255) * step,
                    y:(gy + ((h >>> 8) & 255) / 255) * step,
                    radius:step * (0.3 + ((h >>> 16) & 255) / 510)});
            }
        var columns = Math.ceil(W / step);
        for(var y = 1; y < H - 1; ++y) for(var x = 1; x < W - 1; ++x) {
            if(!this.Eligible(c, tiles, x, y)) continue;
            var score = 0, cx = Math.floor(x / step), cy = Math.floor(y / step);
            for(var py = Math.max(0, cy - 1); py <= Math.min(Math.ceil(H / step) - 1, cy + 1); ++py)
                for(var px = Math.max(0, cx - 1); px <= Math.min(columns - 1, cx + 1); ++px) {
                    var patch = patches[py * columns + px], dx = x - patch.x, dy = y - patch.y;
                    score = Math.max(score, 1 - (dx * dx + dy * dy) / (patch.radius * patch.radius));
                }
            // Prefer a few details beside terrain or buildings. Keep broad
            // clearings quiet rather than peppering every open screen.
            var edge = 0;
            for(var ey = -3; ey <= 3; ey += 3) for(var ex = -3; ex <= 3; ex += 3)
                if(MapGen.Layers.Get(c.Layers.blocked,x+ex,y+ey,0) ||
                    MapGen.Layers.Get(c.Layers.occupied,x+ex,y+ey,0)) edge = 0.6;
            if(score > 0) candidates.push({x:x, y:y, score:score + edge + hash(c.Seed,x,y,19811) / 4294967296 * 0.4});
        }
        candidates.sort(function(a,b) { return b.score - a.score || a.y - b.y || a.x - b.x; });
        var target = Math.floor(W * H * Math.min(ice ? 0.04 : 0.20, density)), changed = 0, stamps = 0;
        for(var i = 0; i < candidates.length && changed < target; ++i) {
            var point = candidates[i], stamp = palette[hash(c.Seed,point.x,point.y,19813) % palette.length];
            if(spaced && spaced[point.y * W + point.x]) continue;
            var fits = changed + stamp.length <= target;
            for(var s = 0; fits && s < stamp.length; ++s)
                fits = !spaced[point.y * W + point.x + s] && this.Eligible(c, tiles, point.x + s, point.y);
            if(!fits) continue;
            for(var t = 0; t < stamp.length; ++t) tiles[point.x + t][point.y] = stamp[t];
            // Keep a ground gap around complete stamps, including both halves
            // of a tuft. Dense adjacent marks read as a tiled carpet.
            for(var sy = point.y - 1; sy <= point.y + 1; ++sy)
                for(var sx = point.x - 1; sx <= point.x + stamp.length; ++sx) spaced[sy * W + sx] = 1;
            changed += stamp.length; ++stamps;
        }
        return {tiles:changed, stamps:stamps, target:target, style:ice ? "rock_fields" : p.SurfaceDetailStyle || "mixed"};
    }
};
