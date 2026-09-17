var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// Continuous basin geometry shared by jungle masks and ice intent authors.
// The caller owns water budgets, protected sites and legal shore materialization.
MapGen.Layout.WaterGeography = {
    Plan: function(random) {
        var angle = random.Float(0, Math.PI * 2);
        var plan = {kind: ["lakes", "long_basin", "lake_chain", "crescent"][random.Int(0, 3)],
            x: random.Float(0.25, 0.75), y: random.Float(0.25, 0.75),
            co: Math.cos(angle), si: Math.sin(angle), phase: random.Float(0, Math.PI * 2),
            rx: random.Float(0.28, 0.52), ry: random.Float(0.16, 0.32), patches: []};
        // Retain both enclosed inland waters and edge-reaching basins. Random
        // centers plus large offsets otherwise clip most shapes into bays.
        plan.inland = random.Chance(0.55);
        if(plan.inland) {
            plan.x = 0.5 + (plan.x - 0.5) * 0.45;
            plan.y = 0.5 + (plan.y - 0.5) * 0.45;
            plan.rx = Math.min(0.36, plan.rx);
        }
        var count = random.Int(2, 4);
        for(var i = 0; i < count; ++i) {
            var along = (i / (count - 1) - 0.5) * plan.rx * 2;
            plan.patches.push(plan.kind === "lake_chain" ?
                {x: along, y: Math.sin(along * 7 + plan.phase) * 0.10,
                    rx: plan.rx / count * random.Float(0.75, 1.4), ry: random.Float(0.07, 0.17)} :
                {x: random.Float(-0.30, 0.30) * (plan.inland ? 0.6 : 1),
                    y: random.Float(-0.30, 0.30) * (plan.inland ? 0.6 : 1),
                    rx: random.Float(0.10, 0.24), ry: random.Float(0.10, 0.24)});
        }
        return plan;
    },

    Score: function(plan, x, y) {
        var dx = x - plan.x, dy = y - plan.y;
        var u = dx * plan.co + dy * plan.si, v = dy * plan.co - dx * plan.si;
        if(plan.kind === "long_basin") {
            var bend = Math.sin(u * 8 + plan.phase) * 0.10;
            return 1 - u * u / (plan.rx * plan.rx) -
                (v - bend) * (v - bend) / (plan.ry * plan.ry * 0.25);
        }
        if(plan.kind === "crescent") {
            var radius = Math.sqrt(u * u / (plan.rx * plan.rx) + v * v / (plan.ry * plan.ry));
            return Math.min((0.30 - Math.abs(radius - 0.85)) * 3, (0.45 - u / plan.rx) * 2);
        }
        var score = -Infinity;
        for(var i = 0; i < plan.patches.length; ++i) {
            var p = plan.patches[i], px = (u - p.x) / p.rx, py = (v - p.y) / p.ry;
            score = Math.max(score, 1 - px * px - py * py);
        }
        return score;
    }
};
