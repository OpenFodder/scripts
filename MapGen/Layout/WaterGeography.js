var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// Continuous basin geometry shared by jungle masks and ice intent authors.
// The caller owns water budgets, protected sites and legal shore materialization.
MapGen.Layout.WaterGeography = {
    Random: function(c, fallback, salt) {
        return c.Profile.WaterSeed === undefined ? fallback :
            MapGen.Random.CreateSeeded(MapGen.Random.HashTile(c.Profile.WaterSeed,0,0,salt || 24711));
    },

    Plan: function(random, width, height, localBasins, kind) {
        var angle = random.Float(0, Math.PI * 2);
        var plan = {kind: ["lakes", "long_basin", "lake_chain", "crescent"][random.Int(0, 3)],
            x: random.Float(0.25, 0.75), y: random.Float(0.25, 0.75),
            co: Math.cos(angle), si: Math.sin(angle), phase: random.Float(0, Math.PI * 2),
            rx: random.Float(0.28, 0.52), ry: random.Float(0.16, 0.32), patches: []};
        if(kind) plan.kind=kind;
        if(kind==="inlets") {
            plan.edge=random.Int(0,3);
            plan.depth=random.Float(0.14,0.28);
            plan.mouth=random.Float(0.20,0.80);
            plan.waterFraction=random.Float(0.14,0.24);
            return plan;
        }
        if(kind==="meander" || kind==="tributaries") return this.Channels(random,width,height,kind);
        // Retain both enclosed inland waters and edge-reaching basins. Random
        // centers plus large offsets otherwise clip most shapes into bays.
        plan.inland = random.Chance(0.55);
        if(plan.inland) {
            plan.x = 0.5 + (plan.x - 0.5) * 0.45;
            plan.y = 0.5 + (plan.y - 0.5) * 0.45;
            plan.rx = Math.min(0.36, plan.rx);
        }
        // A lake district may be one dominant basin or several separate
        // waters. Previously every district overlaid 2-4 central ellipses,
        // which usually merged back into the same broad blob.
        if(localBasins && !kind && plan.kind === "crescent") return this.Channels(random,width,height);
        if(plan.kind === "lakes") {
            var side = Math.min(width || 96, height || 96);
            var counts = localBasins ? (side < 48 ? [1,2] : [2,3,4]) :
                (side < 48 ? [1,2] : [1,2,4,6]);
            var lakes = random.Pick(counts), radius = 0.29 / Math.sqrt(lakes);
            plan.waterFraction = lakes === 1 ? random.Float(0.14, 0.22) : random.Float(0.10, 0.18);
            for(var lake = 0; lake < lakes; ++lake) {
                var best = null, separation = -1;
                for(var trial = 0; trial < 12; ++trial) {
                    var candidate = {x:random.Float(0.16, 0.84), y:random.Float(0.16, 0.84)};
                    var distance = Infinity;
                    for(var other = 0; other < plan.patches.length; ++other) {
                        var previous = plan.patches[other];
                        var dx = candidate.x - previous.x, dy = candidate.y - previous.y;
                        distance = Math.min(distance, dx * dx + dy * dy);
                    }
                    if(distance > separation) { best = candidate; separation = distance; }
                }
                var turn = random.Float(0, Math.PI);
                // A dominant basin with smaller satellites gives the district
                // a hierarchy; equal-area lakes read as repeated ornaments.
                var weight = localBasins ? Math.pow(0.72,lake)*1.35 : 1;
                plan.patches.push({x:best.x, y:best.y,
                    rx:Math.max(6 / side, radius * weight * random.Float(0.75, 1.2)),
                    ry:Math.max(6 / side, radius * weight * random.Float(0.55, 0.85)),
                    co:Math.cos(turn), si:Math.sin(turn)});
            }
            return plan;
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

    // Rivers divide a map into banks and confluences, with a smaller tributary
    // giving each side a different shape. Work in tile coordinates so a wide
    // map does not stretch a narrow stream into a broad horizontal lake.
    Channels: function(random, width, height, kind) {
        var horizontal = random.Chance(0.5), W = width || 96, H = height || 96;
        var along = horizontal ? W : H, across = horizontal ? H : W;
        var points = [], segments = [], courses = [];
        for(var i = 0; i < 5; ++i)
            points.push({x:along*(i/4),y:across*random.Float(0.28,0.72)});
        points[0].x = -4; points[4].x = along+4;
        function addCourse(nodes, radius) {
            var samples = [];
            // Catmull-Rom keeps bends broad, without introducing sharp elbows.
            for(var i = 0; i < nodes.length-1; ++i) {
                var a = nodes[Math.max(0,i-1)], b = nodes[i],
                    d = nodes[i+1], e = nodes[Math.min(nodes.length-1,i+2)];
                for(var step = 0; step < 6; ++step) {
                    var t = step/6, tt = t*t, ttt = tt*t;
                    function axis(key) {
                        return 0.5*((2*b[key])+(-a[key]+d[key])*t+
                            (2*a[key]-5*b[key]+4*d[key]-e[key])*tt+
                            (-a[key]+3*b[key]-3*d[key]+e[key])*ttt);
                    }
                    samples.push({x:axis("x"),y:axis("y")});
                }
            }
            samples.push(nodes[nodes.length-1]);
            var course = [], phase=kind ? random.Float(0,Math.PI*2) : 0;
            for(var p = 0; p < samples.length; ++p) {
                var node = samples[p], actual = horizontal ? node : {x:node.y,y:node.x};
                course.push(actual);
                if(p) {
                    var prev = course[p-1], dx = actual.x-prev.x, dy = actual.y-prev.y;
                    var t=p/(samples.length-1), r=kind ? radius*(0.85+0.30*Math.sin(t*6+phase)+
                        0.55*Math.exp(-Math.pow((t-0.35)/0.16,2))) : radius;
                    segments.push({x:prev.x,y:prev.y,dx:dx,dy:dy,length2:dx*dx+dy*dy,radius2:r*r});
                }
            }
            courses.push(course);
        }
        var radius = random.Float(2.5,4);
        addCourse(points,radius);
        var branchCount = kind==="meander" ? 0 : W*H < 3200 ? 1 : 2;
        for(var b = 0; b < branchCount; ++b) {
            var join = points[b === 0 ? 1 : 3], side = b === 0 ? -1 : 1;
            var start = {x:Math.max(4,Math.min(along-4,join.x+random.Float(-0.2,0.2)*along)),
                y:side < 0 ? -4 : across+4};
            addCourse([start,{x:(start.x+join.x)/2+random.Float(-4,4),
                y:(start.y+join.y)/2},join],radius*random.Float(0.62,0.82));
        }
        return {kind:kind || "tributaries",width:W,height:H,waterFraction:random.Float(0.14,0.22),
            courses:courses,segments:segments};
    },

    Score: function(plan, x, y) {
        if(plan.kind==="inlets") {
            var along=plan.edge<2 ? x : y;
            var inward=plan.edge===0 ? y : plan.edge===1 ? 1-y : plan.edge===2 ? x : 1-x;
            var bay=Math.exp(-Math.pow((along-plan.mouth)/0.19,2))*plan.depth;
            var coast=0.06+bay+0.035*Math.sin(along*13+plan.phase);
            var sites=plan.shoreSites || [];
            for(var s=0;s<sites.length;++s) {
                var site=sites[s], offset=(along-site.along)*site.length/20;
                coast=Math.min(coast,site.inward-site.margin+offset*offset*0.20);
            }
            return (coast-inward)*5;
        }
        if(plan.kind === "tributaries" || plan.kind === "meander") {
            var px = x*plan.width, py = y*plan.height, best = -Infinity;
            for(var si = 0; si < plan.segments.length; ++si) {
                var segment = plan.segments[si], sx = px-segment.x, sy = py-segment.y;
                var t = segment.length2 ? Math.max(0,Math.min(1,(sx*segment.dx+sy*segment.dy)/segment.length2)) : 0;
                var ex = sx-t*segment.dx, ey = sy-t*segment.dy;
                best = Math.max(best,1-(ex*ex+ey*ey)/segment.radius2);
            }
            return best;
        }
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
            var p = plan.patches[i], px, py;
            if(plan.kind === "lakes") {
                var lakeX = x - p.x, lakeY = y - p.y;
                px = (lakeX * p.co + lakeY * p.si) / p.rx;
                py = (lakeY * p.co - lakeX * p.si) / p.ry;
                // Bend each body at its own scale. Fine shoreline noise cannot
                // disguise a district made entirely of regular ellipses.
                py -= 0.30 * Math.sin(px * 2.4 + plan.phase + i);
                px += 0.18 * Math.sin(py * 3.1 - plan.phase);
                if(plan.detailed) py+=0.18*Math.sin(px*5+plan.phase+i);
            } else {
                px = (u - p.x) / p.rx; py = (v - p.y) / p.ry;
            }
            score = Math.max(score, 1 - px * px - py * py);
        }
        return score;
    }
};
