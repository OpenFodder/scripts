var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// Forest bodies and clearings are independent of mission districts. All sizes
// are in tiles so a long map does not stretch every grove into the same strip.
MapGen.Layout.ForestGeography = {
    // Broad, tapered limbs leave bays between them instead of allocating
    // unrelated round groves. Routes can cut these proposals as usual.
    Branches: function(random, W, H, angle) {
        var side = Math.min(W, H), segments = [], arms = random.Int(3, 5);
        var root = {x: W * random.Float(0.32, 0.68), y: H * random.Float(0.32, 0.68)};
        var rootRadius = Math.max(4, side * random.Float(0.09, 0.14));
        function segment(a, b, r0, r1) {
            var dx = b.x - a.x, dy = b.y - a.y;
            segments.push({x:a.x, y:a.y, dx:dx, dy:dy,
                inverseLength:1 / Math.max(1, dx * dx + dy * dy), r0:r0, r1:r1});
        }
        for(var i = 0; i < arms; ++i) {
            var turn = angle + (i + random.Float(-0.18, 0.18)) * Math.PI * 2 / arms;
            var co = Math.cos(turn), si = Math.sin(turn);
            var reachX = (co < 0 ? root.x : W - root.x) / Math.max(0.001, Math.abs(co));
            var reachY = (si < 0 ? root.y : H - root.y) / Math.max(0.001, Math.abs(si));
            var length = Math.min(reachX, reachY) * random.Float(0.70, 1.08);
            var bend = side * random.Float(-0.12, 0.12);
            var joint = {x:root.x + co * length * 0.50 - si * bend,
                y:root.y + si * length * 0.50 + co * bend};
            var tip = {x:root.x + co * length, y:root.y + si * length};
            var tipRadius = Math.max(3, side * random.Float(0.045, 0.08));
            var jointRadius = (rootRadius + tipRadius) / 2;
            segment(root, joint, rootRadius, jointRadius);
            segment(joint, tip, jointRadius, tipRadius);
        }
        return segments;
    },

    Plan: function(c) {
        var p = c.Profile, W = c.Width, H = c.Height, side = Math.min(W, H);
        var random = MapGen.Random.CreateSeeded(MapGen.Random.HashTile(c.Seed, 77, 31, 19403));
        var shape = c.RegionalPlan.forestShape, angle = Number(p.ForestShapeAngle) || 0;
        var count = shape === "groves" ? random.Int(3, 7) :
            shape === "belts" ? Number(p.ForestShapeBands) || 2 : random.Int(1, 3);
        count = Math.max(1, Math.min(7, Math.floor(count)));
        if(p.ForestBodyCount) count = Math.max(1, Math.min(7, Math.floor(p.ForestBodyCount)));
        var plan = {version: 2, shape: shape, bodies: [],
            arrangement: random.Pick(["scattered", "clustered", "separated"]),
            warp: side * random.Float(0.04, 0.12),
            wavelength: side * random.Float(0.65, 1.4),
            phase: Number(p.ForestShapePhase) || 0};
        var focus = {x: W * random.Float(0.15, 0.85), y: H * random.Float(0.15, 0.85)};
        if(shape === "bank" || shape === "clearings") count = 0;
        if(shape === "branches") {
            count = 0;
            plan.version = 3;
            plan.segments = this.Branches(random, W, H, angle);
            plan.warp *= 0.5;
        }
        for(var i = 0; i < count; ++i) {
            var point = null, separation = -1;
            // Mix local clusters, scattered woods and separated bodies.
            // Always maximizing separation pushes every grove to the edges.
            // Fixed trial counts also keep size draws independent of aspect.
            for(var trial = 0; trial < 8; ++trial) {
                var candidate = {x: W * random.Float(0.10, 0.90), y: H * random.Float(0.10, 0.90)};
                if(plan.arrangement === "clustered") {
                    candidate.x = Math.max(3, Math.min(W - 4, focus.x + (candidate.x / W - 0.5) * side));
                    candidate.y = Math.max(3, Math.min(H - 4, focus.y + (candidate.y / H - 0.5) * side));
                }
                var distance = Infinity;
                for(var b = 0; b < plan.bodies.length; ++b) {
                    var dx = candidate.x - plan.bodies[b].x, dy = candidate.y - plan.bodies[b].y;
                    distance = Math.min(distance, dx * dx + dy * dy);
                }
                if(distance > separation && (plan.arrangement === "separated" ||
                    separation < side * side * 0.0144)) {
                    point = candidate; separation = distance;
                }
            }
            var rx, ry, direction = random.Float(0, Math.PI);
            if(shape === "belts") {
                var span = Math.abs(W * Math.cos(angle)) + Math.abs(H * Math.sin(angle));
                var offset = ((i + 0.5) / count - 0.5 + random.Float(-0.10, 0.10)) * span;
                point = {x: W / 2 + Math.cos(angle) * offset, y: H / 2 + Math.sin(angle) * offset};
                rx = Math.max(W, H) * random.Float(0.40, 0.85);
                ry = side * random.Float(0.08, 0.18);
                direction = angle + Math.PI / 2;
            } else if(shape === "heartwood") {
                point = {x: focus.x + side * random.Float(-0.25, 0.25),
                    y: focus.y + side * random.Float(-0.25, 0.25)};
                rx = side * random.Float(0.25, 0.55);
                ry = side * random.Float(0.16, 0.35);
                direction = angle + random.Float(-0.5, 0.5);
                // Heartland keeps its main body inland. Older explicit
                // heartwood profiles retain their original placement.
                if(p.VisualComposition === "forest_heartland") {
                    point.x = Math.max(W * 0.30, Math.min(W * 0.70, point.x));
                    point.y = Math.max(H * 0.30, Math.min(H * 0.70, point.y));
                }
            } else {
                var scale = shape === "rim" ? 1.4 : 1;
                rx = side * random.Float(0.13, 0.32) * scale;
                ry = side * random.Float(0.12, 0.27) * scale;
            }
            plan.bodies.push({x: point.x, y: point.y, rx: Math.max(6, rx), ry: Math.max(6, ry),
                co: Math.cos(direction), si: Math.sin(direction), weight: random.Float(0.75, 1)});
        }
        if(shape === "clearings") {
            var regions = c.RegionalPlan.regions;
            for(var r = 0; r < regions.length; ++r) {
                var site = regions[r].point, turn = random.Float(0, Math.PI);
                plan.bodies.push({x:site.x, y:site.y, rx:Math.max(7, side * random.Float(0.13, 0.24)),
                    ry:Math.max(6, side * random.Float(0.10, 0.19)),
                    co:Math.cos(turn), si:Math.sin(turn), weight:1});
            }
        }
        plan.co = Math.cos(angle); plan.si = Math.sin(angle);
        return plan;
    },

    Field: function(c, terrain) {
        var scenes = MapGen.Layout.SceneForests.Field(c,terrain);
        if(scenes) return scenes;
        return this.BaseField(c);
    },

    BaseField: function(c) {
        var plan = this.Plan(c), W = c.Width, H = c.Height;
        c.RegionalPlan.forestGeometry = plan;
        var field = new Float32Array(W * H), warpX = [], warpY = [], segments = plan.segments || [];
        var frequency = Math.PI * 2 / plan.wavelength, low = Infinity, high = -Infinity;
        // Trigonometry scales with width + height, not with every body/cell.
        for(var wy = 0; wy < H; ++wy)
            warpX[wy] = Math.sin(wy * frequency + plan.phase) * plan.warp;
        for(var wx = 0; wx < W; ++wx)
            warpY[wx] = Math.sin(wx * frequency * 0.73 - plan.phase) * plan.warp;
        for(var y = 0; y < H; ++y) for(var x = 0; x < W; ++x) {
            var value = 0, px = x + warpX[y], py = y + warpY[x];
            for(var i = 0; i < plan.bodies.length; ++i) {
                var b = plan.bodies[i], dx = px - b.x, dy = py - b.y;
                var u = (dx * b.co + dy * b.si) / b.rx;
                var v = (dy * b.co - dx * b.si) / b.ry;
                var distance = u * u + v * v;
                value = Math.max(value, b.weight / (1 + distance * distance));
            }
            for(var s = 0; s < segments.length; ++s) {
                var limb = segments[s], lx = px - limb.x, ly = py - limb.y;
                var t = Math.max(0, Math.min(1, (lx * limb.dx + ly * limb.dy) * limb.inverseLength));
                var ex = lx - t * limb.dx, ey = ly - t * limb.dy;
                var radius = limb.r0 + t * (limb.r1 - limb.r0);
                var d = (ex * ex + ey * ey) / (radius * radius);
                value = Math.max(value, 1 / (1 + d * d));
            }
            if(plan.shape === "rim" || plan.shape === "clearings") value = 1 - value;
            if(plan.shape === "bank")
                value = (px - W / 2) * plan.co + (py - H / 2) * plan.si;
            field[y * W + x] = value;
            low = Math.min(low, value); high = Math.max(high, value);
        }
        // Give each shape the same influence over noise and placement-edge
        // penalties. The old heartwood field peaked at 2.5; others at 1.
        var range = Math.max(0.001, high - low);
        for(var cell = 0; cell < field.length; ++cell)
            field[cell] = (field[cell] - low) / range;
        return field;
    }
};
