var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// Districts choose where a mission happens; lots give its buildings a shared
// local arrangement. The normal site search still owns geometry and access.
MapGen.Layout.Settlements = {
    Prepare: function(c, specs, policy) {
        c.SettlementPlan = null;
        var mission = c.MissionLayout;
        if(!mission || mission.version !== 2 || !mission.targets.length ||
            !c.Profile.VisualComposition || MapGen.Context.IsMultiplayer(c) ||
            policy === "maze" || !specs.length) return;
        var count = Math.min(specs.length, mission.targets.length,
            mission.kind === "compound" ? 1 : mission.kind === "exploration" ? 3 : 2);
        var extent = 0;
        for(var s = 0; s < specs.length; ++s) {
            var info = MapGen.Integration.StructureInfo(specs[s], c);
            if(info) extent = Math.max(extent, info.width, info.height);
        }
        var spacing = mission.minSpacing;
        var step = Math.ceil(Math.max(spacing + extent + 2, mission.preferredSpacing || 0));
        if(mission.kind === "compound") step = Math.max(step, Math.ceil(mission.minSpanTiles + 2));
        var plan = {version:1, camps:[], lots:[]};
        for(var i = 0; i < count; ++i) {
            var hash = MapGen.Random.HashTile(c.Seed, i, 0, 20101);
            var kind = ["forecourt", "lane", "terrace"][hash % 3], sign = hash & 8 ? 1 : -1;
            var target = mission.targets[i], offsets = [], total = Math.ceil((specs.length - i) / count);
            for(var j = 0; j < total; ++j) {
                var x = j * step, y = 0;
                if(kind === "lane") { x = j % 2 ? Math.round(step * 0.25) : 0; y = j * step; }
                if(kind === "terrace") y = Math.round(j * step * 0.4);
                if(kind === "forecourt" && j === 2) { x = Math.round(step * 0.5); y = -step; }
                // Larger compounds use bounded rows around a common yard.
                // Extending a single row sends its last lots off a small map.
                if(total > 3) {
                    var columns = kind === "terrace" ? 3 : 2;
                    x = (j % columns) * step;
                    y = Math.floor(j / columns) * step;
                    if(kind === "forecourt") y = -y;
                    if(kind === "terrace") y += Math.round((j % columns) * step * 0.4);
                    if(kind === "lane") { var swap = x; x = y; y = swap; }
                }
                offsets.push({x:x * sign, y:y});
            }
            var mx = 0, my = 0;
            for(var o = 0; o < offsets.length; ++o) { mx += offsets[o].x; my += offsets[o].y; }
            // A fitted site belongs to the primary building. Recentering the
            // camp can move it off the usable terrain (or beyond the map).
            if(target.landmark || c.Profile.SceneForests && target.proposed) {
                mx=offsets[0].x*total; my=offsets[0].y*total;
            }
            var camp = {id:i, kind:kind, x:target.x, y:target.y, spacing:spacing,
                lots:[], yards:[], lanes:[], shelter:null};
            for(var k = 0; k < offsets.length; ++k) {
                var offset = offsets[k];
                camp.lots.push({id:i + k * count, camp:i, index:k,
                    x:Math.round(target.x + offset.x - mx / total),
                    y:Math.round(target.y + offset.y - my / total)});
            }
            plan.camps.push(camp);
        }
        for(var slot = 0; slot < specs.length; ++slot)
            plan.lots.push(plan.camps[slot % count].lots[Math.floor(slot / count)]);
        c.SettlementPlan = plan;
    },

    Next: function(c, entries) {
        var plan = c.SettlementPlan;
        if(!plan) return null;
        var used = {}, anchors = {}, rotations = {};
        for(var i = 0; i < entries.length; ++i) {
            var site = entries[i].candidate, lot = site.settlementLot;
            if(!lot) continue;
            used[lot.id] = true;
            if(lot.index === 0) anchors[lot.camp] = MapGen.Integration.StructureRectCenter(site.rect);
            else if(lot.rotation!==undefined) rotations[lot.camp]=lot.rotation;
        }
        for(var j = 0; j < plan.lots.length; ++j) {
            var next = plan.lots[j];
            if(used[next.id]) continue;
            var first = plan.camps[next.camp].lots[0], anchor = anchors[next.camp];
            var lot={id:next.id,camp:next.camp,index:next.index,
                x:next.x+(anchor ? anchor.x-first.x : 0),y:next.y+(anchor ? anchor.y-first.y : 0)};
            if(anchor && next.index>0 && c.Profile.SceneForests) {
                // Turn the shared arrangement around its actual first site.
                // The first secondary building chooses; later lots retain
                // that orientation rather than each turning independently.
                var dx=next.x-first.x,dy=next.y-first.y,chosen=rotations[next.camp];
                var options=[],begin=chosen===undefined ? 0 : chosen,end=chosen===undefined ? 4 : chosen+1;
                for(var turn=begin;turn<end;++turn) {
                    var x=turn===0 ? dx : turn===1 ? -dy : turn===2 ? -dx : dy;
                    var y=turn===0 ? dy : turn===1 ? dx : turn===2 ? -dy : -dx;
                    options.push({x:anchor.x+x,y:anchor.y+y,rotation:turn});
                }
                lot.x=options[0].x;lot.y=options[0].y;lot.rotation=options[0].rotation;
                if(options.length>1) lot.alternatives=options;
            }
            return lot;
        }
        return null;
    },

    Nearest: function(lot,point) {
        var options=lot.alternatives,best=lot,dx=point.x-lot.x,dy=point.y-lot.y,distance=dx*dx+dy*dy;
        if(options) for(var i=1;i<options.length;++i) {
            var p=options[i],px=point.x-p.x,py=point.y-p.y,d=px*px+py*py;
            if(d<distance) {best=p;distance=d;}
        }
        return best;
    },

    Resolve: function(lot,point) {
        if(!lot.alternatives) return lot;
        var selected=this.Nearest(lot,point);
        return {id:lot.id,camp:lot.camp,index:lot.index,x:selected.x,y:selected.y,rotation:selected.rotation};
    },

    Score: function(lot, point) {
        var target=this.Nearest(lot,point),dx=point.x-target.x,dy=point.y-target.y;
        // Retain the planned orientation when alternatives are near ties.
        // Once selected, subsequent lots follow that turn without a penalty.
        return 2200-Math.sqrt(dx*dx+dy*dy)*180-(lot.alternatives && target.rotation ? 300 : 0);
    }
};
