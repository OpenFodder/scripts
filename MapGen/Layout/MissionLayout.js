var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// Mission geography is selected before sites. The same targets are used by
// candidate ranking, planned validation and validation of live placements.
MapGen.Layout.MissionLayout = {
    Kind: function(c) {
        var p = c.Profile || {};
        if(!p.RegionalComposition || MapGen.Context.IsMultiplayer(c) ||
            ["grammar_jungle", "grammar_ice", "grammar_beach"].indexOf(p.Name) < 0) return null;
        var style = String(p.GrammarIceLayoutStyle || "");
        if(style.indexOf("cliff") >= 0 || p.VisualComposition && p.RegionalIceCliff) return "crossing";
        if(style.indexOf("maze") >= 0 || p.CompositionVariant === "forest_labyrinth") return "exploration";
        var hash = MapGen.Random.HashTile(c.Seed, 83, 41, 19601);
        var water = String(p.CompositionVariant || "").indexOf("river") >= 0 ||
            p.RegionalIceTerrain === "river_loop";
        var choices = p.VisualComposition ?
            ["compound", "linked_camps", "exploration", "exploration", "linked_camps", "exploration"] :
            ["compound", "linked_camps", "exploration"];
        return water && hash % 4 === 3 ? "crossing" : choices[hash % choices.length];
    },

    Prepare: function(c, anchors) {
        if(c.MissionLayout) return c.MissionLayout;
        var kind = this.Kind(c);
        anchors = anchors || c.Anchors;
        if(!kind || !anchors || !anchors.start || !anchors.objective) return null;
        var side = Math.min(c.Width, c.Height), targets = [], regional = c.RegionalPlan;
        var radius = Math.max(18, side * (kind === "compound" ? 0.34 : 0.24));
        function add(point) {
            if(!point) return;
            for(var i = 0; i < targets.length; ++i) {
                var dx = point.x - targets[i].x, dy = point.y - targets[i].y;
                if(dx * dx + dy * dy < 144) return;
            }
            targets.push({x: point.x, y: point.y, radius: radius});
        }
        add(anchors.objective);
        if(kind !== "compound") {
            var options = [];
            if(kind === "crossing" && anchors.crossing) options.push({
                x: Math.round((anchors.start.x + anchors.crossing.x) / 2),
                y: Math.round((anchors.start.y + anchors.crossing.y) / 2)});
            else if(regional) for(var r = 0; r < regional.regions.length; ++r) {
                var region = regional.regions[r];
                if(region.kind !== "arrival" && region.kind !== "maze") options.push(region.point);
            }
            // Authored necks/cliffs have a trunk instead of regional points.
            if(!options.length) options.push({
                x: Math.round(anchors.start.x * 0.60 + anchors.objective.x * 0.40),
                y: Math.round(anchors.start.y * 0.60 + anchors.objective.y * 0.40)});
            options.sort(function(a, b) {
                var ax = a.x - anchors.objective.x, ay = a.y - anchors.objective.y;
                var bx = b.x - anchors.objective.x, by = b.y - anchors.objective.y;
                return bx * bx + by * by - ax * ax - ay * ay || a.y - b.y || a.x - b.x;
            });
            for(var o = 0; o < options.length; ++o) {
                add(options[o]);
                if(kind !== "exploration" && targets.length >= 2) break;
            }
        }
        var span = 0;
        for(var a = 0; a < targets.length; ++a) for(var b = a + 1; b < targets.length; ++b) {
            var dx = targets[a].x - targets[b].x, dy = targets[a].y - targets[b].y;
            span = Math.max(span, Math.sqrt(dx * dx + dy * dy));
        }
        c.MissionLayout = {version: 1, kind: kind, targets: targets,
            minSpacing: kind === "compound" ? 6 : kind === "linked_camps" ? 8 : 12,
            minSpanTiles: kind === "compound" ? 10 : Math.max(12, span * 0.45),
            detours: kind === "compound" ? "approach" : kind === "linked_camps" ? "supply" :
                kind === "crossing" ? "flanks" : "branches"};
        if(c.Profile.VisualComposition) {
            var plan = c.MissionLayout, compound = kind === "compound";
            plan.version = 2;
            // Every building keeps this footprint-to-footprint gap, including
            // buildings in a shared compound. A camp label cannot shrink it.
            plan.minSpacing = Math.max(12, Math.min(20, Math.round(side * 0.20)));
            plan.preferredSpacing = Math.max(plan.minSpacing + 4, Math.min(30, side * 0.32));
            plan.minSpanTiles = compound ? Math.max(10, side * 0.25) : Math.max(12, span * 0.60);
        }
        return c.MissionLayout;
    },

    Group: function(plan, point) {
        var nearest = -1, distance = Infinity;
        for(var i = 0; i < plan.targets.length; ++i) {
            var t = plan.targets[i], dx = point.x - t.x, dy = point.y - t.y;
            var d = Math.sqrt(dx * dx + dy * dy);
            if(d <= t.radius && d < distance) { nearest = i; distance = d; }
        }
        return nearest;
    },

    Counts: function(plan, centers) {
        var counts = [];
        for(var t = 0; t < plan.targets.length; ++t) counts.push(0);
        for(var i = 0; i < centers.length; ++i) {
            var group = this.Group(plan, centers[i]);
            if(group >= 0) ++counts[group];
        }
        return counts;
    },

    Fit: function(c, geometry, specs, policy) {
        var plan = c.MissionLayout;
        if(!plan || plan.fitted || !specs.length) return;
        var I = MapGen.Integration, largest = specs[0], area = 0;
        for(var s = 0; s < specs.length; ++s) {
            var info = I.StructureInfo(specs[s], c);
            if(info && info.width * info.height > area) {
                largest = specs[s]; area = info.width * info.height;
            }
        }
        // Authored cliff/neck anchors can sit on land too narrow for a
        // building apron. Fit districts to actual dry, reachable footprints
        // before any building is reserved, using the normal site search.
        for(var i = 0; i < plan.targets.length; ++i) {
            var t = plan.targets[i];
            var landmark=MapGen.Layout.Landmarks.ForTarget(c,geometry,t,i);
            var preference=landmark ? {x:landmark.x,y:landmark.y,radius:t.radius,landmark:landmark} : t;
            var site = MapGen.Layout.BuildingSites.Find(c, geometry, [], largest, policy,
                {missionTarget: preference, candidateLimit: 128});
            if(!site) continue;
            var center = I.StructureRectCenter(site.rect);
            var dx = center.x - t.x, dy = center.y - t.y;
            // Keep a viable district centred on its original intent. Chasing
            // a nearby doorway can push a compact compound against the edge
            // and exclude the other otherwise valid buildings in that area.
            if(!landmark && plan.kind === "compound" && dx * dx + dy * dy <= t.radius * t.radius * 0.25) continue;
            if(dx * dx + dy * dy > t.radius * t.radius * 4) continue;
            var overlaps = false;
            for(var j = 0; j < i; ++j) {
                var px = center.x - plan.targets[j].x, py = center.y - plan.targets[j].y;
                if(px * px + py * py < 144) overlaps = true;
            }
            if(overlaps) continue;
            t.proposed = {x: t.x, y: t.y}; t.x = center.x; t.y = center.y;
            if(landmark && site.landmark && MapGen.Layout.Landmarks.Fits(landmark,center))
                t.landmark=landmark;
        }
        plan.fitted = true;
    },

    TargetScore: function(target, point) {
        var dx = point.x - target.x, dy = point.y - target.y;
        return 2200 - Math.sqrt(dx * dx + dy * dy) * 90;
    },

    Score: function(plan, point, slot, counts, centers) {
        var index = plan.kind === "compound" ? 0 : slot % plan.targets.length;
        // Fill the still-empty intended districts before adding local sites.
        if(plan.kind !== "compound") for(var i = 0; i < counts.length; ++i)
            if(!counts[i]) { index = i; break; }
        return this.TargetScore(plan.targets[index], point) + this.SeparationScore(plan, point, centers);
    },

    SeparationScore: function(plan, point, centers) {
        var nearest = Infinity;
        // Separate landmarks within a district as well as between districts.
        // This is a preference: the exact apron and hard spacing checks still
        // decide what fits on a narrow coast or beside a lake.
        if(plan.preferredSpacing && centers) {
            for(var c = 0; c < centers.length; ++c) {
                var dx = point.x - centers[c].x, dy = point.y - centers[c].y;
                nearest = Math.min(nearest, Math.sqrt(dx * dx + dy * dy));
            }
            return -Math.max(0, plan.preferredSpacing - nearest) * 120;
        }
        return 0;
    },

    Validate: function(c, centers, report) {
        var plan = c.MissionLayout;
        if(!plan || !centers.length) return;
        var counts = this.Counts(plan, centers), occupied = 0;
        for(var i = 0; i < counts.length; ++i) if(counts[i]) ++occupied;
        var required = plan.kind === "compound" ? Math.ceil(centers.length * 0.5) :
            Math.min(centers.length, plan.targets.length, plan.kind === "exploration" ? 3 : 2);
        report.counts.missionLayout = {kind: plan.kind, targetCounts: counts,
            occupiedTargets: occupied, required: required};
        if(plan.kind === "compound" ? counts[0] < required : occupied < required)
            MapGen.Integration.LiveFail(report, "mission_structure_targets_too_low:" +
                (plan.kind === "compound" ? counts[0] : occupied) + "/" + required);
    },

    // Progression phases remain mandatory, but an XL map no longer forces
    // detours into a northern sector that may be occupied by a lake.
    SpurFraction: function(plan, index, count) {
        if(count <= 1) return plan.kind === "compound" ? 0.72 : 0.50;
        var low = plan.kind === "compound" ? 0.42 : 0.23;
        var high = plan.kind === "compound" ? 0.82 : 0.77;
        return low + index / (count - 1) * (high - low);
    }
};
