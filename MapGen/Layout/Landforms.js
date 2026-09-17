var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// Large-scale water geometry, before anchors and gameplay reservations. Budget
// the initial mask once instead of growing islands into one another and then
// repairing an oversized ocean back into a rectangular mainland.
MapGen.Layout.Landforms = {
    Build: function(c) {
        var form = c.Profile.JungleLandform;
        if(form !== "basin" && form !== "islands") return false;
        var W = c.Width, H = c.Height, random = c.Random;
        var horizontal = random.Chance(0.5), cells = [], seeds = [], patches = [];
        var regions = c.RegionalPlan && c.RegionalPlan.regions;
        var basin = form === "basin" ? MapGen.Layout.WaterGeography.Plan(random) : null;
        var divideStrength = c.Profile.RiverChance > 0 ? 0.90 :
            1.5 + (MapGen.Random.HashTile(c.Seed, 17, 23, 19109) / 4294967296) * 3;
        var divideScale = c.Profile.RiverChance > 0 ? 16 : 5;
        var count = basin ? 0 : (regions ? regions.length : random.Int(2, 3));
        for(var s = 0; s < count; ++s) {
            var region = regions ? regions[s % regions.length] : null;
            var px = region ? region.point.x / W : (horizontal ? (s + 0.5) / count : random.Float(0.3, 0.7));
            var py = region ? region.point.y / H : (horizontal ? random.Float(0.3, 0.7) : (s + 0.5) / count);
            var angle = random.Float(0, Math.PI);
            patches.push({x: px, y: py, co: Math.cos(angle), si: Math.sin(angle),
                rx: region ? region.w / W * random.Float(0.6, 0.85) : 0.36,
                ry: region ? region.h / H * random.Float(0.6, 0.85) : 0.32});
            seeds.push({x: Math.floor(px * W), y: Math.floor(py * H)});
        }
        for(var y = 0; y < H; ++y) {
            for(var x = 0; x < W; ++x) {
                var nx = (x + 0.5) / W, ny = (y + 0.5) / H, score;
                var noise = MapGen.Terrain.Cover.ValueNoise(c, x, y, Math.min(W, H) * 0.15, 19103);
                score = Infinity;
                var second = Infinity;
                for(var i = 0; i < patches.length; ++i) {
                    var patch = patches[i], dx = nx - patch.x, dy = ny - patch.y;
                    var u = (dx * patch.co + dy * patch.si) / patch.rx;
                    var v = (dy * patch.co - dx * patch.si) / patch.ry;
                    var distance = u * u + v * v + noise * 0.40;
                    if(distance < score) { second = score; score = distance; }
                    else if(distance < second) second = distance;
                }
                if(basin) score = MapGen.Layout.WaterGeography.Score(basin, nx, ny) + noise * 0.16;
                else score += divideStrength / (1 + (second - score) * (second - score) * divideScale);
                // A feature must leave room for the regional arrival/landmarks.
                // Routes can then go around a lake instead of always bisecting it.
                if(regions) for(var ri = 0; ri < regions.length; ++ri) {
                    var ax = x - regions[ri].point.x, ay = y - regions[ri].point.y;
                    if(ax * ax + ay * ay < 49) score = -100;
                    var mr = regions[ri];
                    // Water contour fitting can move a bank by several cells.
                    // Leave that apron outside the region's actual maze walls.
                    if(mr.kind === "maze" && x >= mr.x - 4 && y >= mr.y - 4 && x < mr.x + mr.w + 4 && y < mr.y + mr.h + 4)
                        score = -100;
                }
                cells.push({x:x, y:y, score:score});
            }
        }
        cells.sort(function(a, b) { return a.score - b.score || a.y - b.y || a.x - b.x; });
        // A scattered lake district can be mostly dry; an elongated basin
        // occupies much more ground. Equal quotas made both silhouettes merge.
        var fraction = basin ? (basin.kind === "lakes" ? random.Float(0.88, 0.95) :
            basin.kind === "lake_chain" ? random.Float(0.82, 0.91) : random.Float(0.78, 0.88)) :
            random.Float(0.71, 0.78);
        // A mixed island/river composition needs a separate water allowance
        // for the river; spending the entire budget here rejects it later.
        if(form === "islands" && c.Profile.RiverChance > 0)
            fraction = random.Float(0.86, 0.91);
        if(c.Profile.CompositionVariant === "forest_labyrinth") fraction = random.Float(0.84, 0.90);
        var landCount = Math.round(W * H * fraction);
        for(var k = 0; k < cells.length; ++k) {
            var cell = cells[k];
            c.Layers.water[cell.x][cell.y] = k < landCount ? 0 : 1;
        }
        if(form === "islands")
            MapGen.Layout.Archipelago.ConnectIslands(c, seeds, random);
        landCount = 0;
        for(var lx = 0; lx < W; ++lx) {
            for(var ly = 0; ly < H; ++ly) {
                var water = c.Layers.water[lx][ly];
                if(!water) ++landCount;
                c.Layers.owner[lx][ly] = water ? MapGen.Layers.Owner.WATER : MapGen.Layers.Owner.OPEN;
            }
        }
        c.Continent = {style:form, landCount:landCount, targetLand:landCount,
            landFraction:landCount / (W * H), centre:{x:Math.floor(W / 2), y:Math.floor(H / 2)}};
        c.SelectedContinentStyle = form;
        if(c.RegionalPlan) c.RegionalPlan.landforms = {kind: form, basin: basin, patches: patches};
        MapGen.Context.AddLog(c, "Planned " + form + " landform before gameplay sites");
        return true;
    }
};
