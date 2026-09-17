var MapGen = MapGen || {};
MapGen.Grammar = MapGen.Grammar || {};

// Enclosed inland water is filled after connectivity, beside reserved routes.
// Each body keeps its own bank bounds so ocean cells never use the river atlas.
(function(grammar) {
    function waterRoom(c) {
        var max = Number(c.Profile.MaxWaterCoverage), wet = 0;
        if(!isFinite(max)) max = 0.16;
        for(var x = 0; x < c.Width; ++x) for(var y = 0; y < c.Height; ++y)
            if(MapGen.Layers.Get(c.Layers.water, x, y, 0)) ++wet;
        return Math.max(0, Math.floor(c.Width * c.Height * Math.max(0, max - 0.004)) - wet);
    }

    function cellFits(c, protectedPoints, cache, x, y) {
        if(x < 2 || y < 2 || x >= c.Width - 2 || y >= c.Height - 2) return false;
        var index = y * c.Width + x;
        if(cache[index]) return cache[index] === 1;
        var layers = c.Layers, fits = true;
        // Include the dry bank apron, not just the proposed water footprint.
        for(var dx = -2; dx <= 2 && fits; ++dx) for(var dy = -2; dy <= 2; ++dy) {
            if(grammar.IsLiveTerrainProtectedCell(c, x + dx, y + dy, protectedPoints, 5) ||
                MapGen.Layers.Get(layers.owner, x + dx, y + dy, 0) === MapGen.Layers.Owner.ROUTE) {
                fits = false;
                break;
            }
        }
        fits = fits && !MapGen.Layers.Get(layers.riverBank, x, y, 0) &&
            !MapGen.Layers.Get(layers.forcedBank, x, y, 0) &&
            !MapGen.Layers.Get(layers.lakeShore, x, y, 0) &&
            !MapGen.Layers.Get(layers.blocked, x, y, 0) &&
            !grammar.HasLiveTerrainLayerNear(layers.water, x, y, 4) &&
            !grammar.HasLiveTerrainLayerNear(layers.coast, x, y, 3);
        cache[index] = fits ? 1 : 2;
        return fits;
    }

    function proposal(c, protectedPoints, cache, cx, cy, vertical, length, radius, phase, shape) {
        var lookup = {}, cells = [], complete = true;
        var bounds = {minX: c.Width, minY: c.Height, maxX: 0, maxY: 0};
        function add(x, y) {
            var key = x + "," + y;
            if(lookup[key]) return;
            if(!cellFits(c, protectedPoints, cache, x, y)) { complete = false; return; }
            lookup[key] = true;
            cells.push({x: x, y: y});
            bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
            bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
        }
        var previous = 0, start = -Math.floor(length / 2);
        for(var step = 0; step < length && complete; ++step) {
            var t = start + step, along = (2 * step / (length - 1)) - 1;
            var bend = shape === "channel" ? 2.5 : shape === "lagoon" ? 1.2 : 0.85;
            var offset = Math.round(Math.sin(t * 0.35 + phase) * bend);
            offset = Math.max(previous - 1, Math.min(previous + 1, offset));
            previous = offset;
            // At least three cells across both ends: the atlas has no
            // three-sided water cap. Broad bodies taper into rounded ends.
            var half = Math.max(1, Math.round(radius * Math.sqrt(Math.max(0, 1 - along * along))));
            for(var cross = -half; cross <= half && complete; ++cross)
                add(vertical ? cx + offset + cross : cx + t,
                    vertical ? cy + t : cy + offset + cross);
        }
        if(!complete) return null;

        // Resolve unsupported tips and grass notches inside the proposal.
        // Scan only its local bounds; never repair over a protected route.
        var loX = bounds.minX - 1, hiX = bounds.maxX + 1;
        var loY = bounds.minY - 1, hiY = bounds.maxY + 1;
        for(var pass = 0; pass <= 4; ++pass) {
            var fill = [], prune = {};
            for(var y = loY; y <= hiY; ++y) for(var x = loX; x <= hiX; ++x) {
                var wet = (lookup[(x - 1) + "," + y] ? 1 : 0) +
                    (lookup[(x + 1) + "," + y] ? 1 : 0) +
                    (lookup[x + "," + (y - 1)] ? 1 : 0) +
                    (lookup[x + "," + (y + 1)] ? 1 : 0);
                var key = x + "," + y;
                if(lookup[key] && wet <= 1) prune[key] = true;
                else if(!lookup[key] && wet >= 3) fill.push({x: x, y: y});
            }
            var next = [], changed = fill.length;
            for(var i = 0; i < cells.length; ++i) {
                var cell = cells[i], cellKey = cell.x + "," + cell.y;
                if(prune[cellKey]) { delete lookup[cellKey]; ++changed; }
                else next.push(cell);
            }
            if(!changed) return {cells: cells, bounds: bounds, shape: shape};
            if(pass === 4) return null;
            cells = next;
            for(var f = 0; f < fill.length && complete; ++f) add(fill[f].x, fill[f].y);
            if(!complete) return null;
        }
        return null;
    }

    function buildBody(c, protectedPoints, room, bodyIndex) {
        // Reuse eligibility within this body's search. A new cache after each
        // stamp observes the new water and preserves separation between bodies.
        var cache = new Uint8Array(c.Width * c.Height);
        var hash = MapGen.Random.HashTile;
        var shape = ["pond", "lagoon", "channel"][hash(c.Seed, bodyIndex, 41, 861) % 3];
        var scale = Math.sqrt(c.Width * c.Height / 4096);
        var length = shape === "pond" ? 6 : shape === "lagoon" ? 10 : 14;
        var stretch = 0.75 + (hash(c.Seed, bodyIndex, 43, 861) % 501) / 1000;
        var spread = 0.75 + (hash(c.Seed, bodyIndex, 45, 861) % 501) / 1000;
        length = Math.max(5, Math.min(26, Math.round(length * scale * stretch)));
        var radius = shape === "channel" ? 1 : Math.max(2, Math.min(4, Math.round(2 * scale * spread)));
        var marginX = Math.max(7, Math.floor(c.Width * 0.1));
        var marginY = Math.max(6, Math.floor(c.Height * 0.1));
        for(var attempt = 0; attempt < 96; ++attempt) {
            var salt = attempt + bodyIndex * 101;
            var cx = marginX + hash(c.Seed, salt, 5, 865) % Math.max(1, c.Width - marginX * 2);
            var cy = marginY + hash(c.Seed, salt, 7, 867) % Math.max(1, c.Height - marginY * 2);
            if(!cellFits(c, protectedPoints, cache, cx, cy)) continue;
            var vertical = hash(c.Seed, salt, 3, 863) % 2 === 0;
            var phase = (hash(c.Seed, salt, 11, 869) % 6283) / 1000;
            // Try the full recipe first, then smaller footprints in crowded maps.
            var shrink = attempt < 48 ? 1 : attempt < 80 ? 0.7 : 0.5;
            var body = proposal(c, protectedPoints, cache, cx, cy, vertical,
                Math.max(5, Math.round(length * shrink)), Math.max(1, Math.round(radius * shrink)), phase, shape);
            if(body && body.cells.length >= 10 && body.cells.length <= room) return body;
        }
        return null;
    }

    grammar.FillBeachInteriorWater = function(c) {
        var live = c.GrammarLiveTerrain;
        if(!live || !c.Profile || c.Profile.TargetPackProfile !== "grammar_beach" ||
            c.Profile.AllowBeachInteriorWater !== true || live.interiorWaterBodies.length) return;
        var area = c.Width * c.Height;
        var count = 1 + MapGen.Random.HashTile(c.Seed, area, 47, 871) %
            (area >= 10000 ? 3 : area >= 6000 ? 2 : 1);
        var room = Math.min(waterRoom(c), Math.floor(area * 0.03));
        var protectedPoints = grammar.ProtectedLiveTerrainPoints(c);
        for(var i = 0; i < count && room >= 10; ++i) {
            var body = buildBody(c, protectedPoints, room, i);
            if(!body) continue;
            var waterPoints = [], seen = {};
            for(var p = 0; p < body.cells.length; ++p)
                grammar.SetLiveWaterCell(c, body.cells[p].x, body.cells[p].y, waterPoints, seen);
            var bounds = body.bounds;
            bounds.minX -= 2; bounds.minY -= 2; bounds.maxX += 2; bounds.maxY += 2;
            var role = "grammar_beach_interior_lagoon";
            c.Rivers.push({role: role, requiresCrossing: false,
                center: {x: Math.round((bounds.minX + bounds.maxX) / 2),
                    y: Math.round((bounds.minY + bounds.maxY) / 2)},
                points: grammar.BuildBeachShorePoints(c, waterPoints), segment: null});
            live.interiorWaterBodies.push({bounds: bounds, cells: waterPoints.length, shape: body.shape});
            live.interiorRole = role;
            live.interiorWaterCells += waterPoints.length;
            for(var w = 0; w < waterPoints.length; ++w) live.waterPoints.push(waterPoints[w]);
            room -= waterPoints.length;
        }
        live.waterCells = live.totalWaterCells = live.waterPoints.length;
        c._jungleLocalBeachFocus = null;
    };
})(MapGen.Grammar);
