var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// Continuous woodland uses geographic fields; scattered groves use original
// silhouettes. Both share early clearings and the biome's normal tile renderer.
MapGen.Layout.SceneForests = {
    Boundary: function(c) {
        var edges=[], hash=MapGen.Random.HashTile;
        var margin=c.Profile.TerrainType===Terrain.Types.Ice ? 3 : 1;
        for(var side=0;side<4;++side) {
            var length=side<2 ? c.Width : c.Height, edge=[];
            var phase=hash(c.Seed,side,0,24731)/4294967296*Math.PI*2;
            var amplitude=5+hash(c.Seed,side,0,24733)%5;
            var open=hash(c.Seed,side,0,24737)%4===0;
            // Woods can meet a boundary instead of always forming an island
            // inside the same grass frame. Broad recesses leave occasional
            // edge clearings; ice retains its full canopy fitting margin.
            for(var i=0;i<length;++i) {
                var wave=0.7*Math.sin(i/13+phase)+0.3*Math.sin(i/23-phase);
                edge.push(margin+Math.max(0,Math.round(amplitude*(wave+(open ? 0.35 : -0.25)))));
            }
            edges.push(edge);
        }
        return edges;
    },

    MinimumCoverage: function(c, requested) {
        // Coverage is a soft composition goal, bounded by actual room for
        // woodland. Gameplay, route and render checks remain mandatory.
        var geometry = c.RegionalPlan && c.RegionalPlan.forestGeometry;
        return c._sceneForestField ? Math.min(requested, geometry.sourceMaskCells / (c.Width*c.Height)*0.75) : requested;
    },

    Connected: function(c, eligible, land, rooms, routeRooms) {
        var W=c.Width, H=c.Height, N=W*H;
        var geography=MapGen.Layout.ForestGeography.BaseField(c), plan=c.RegionalPlan.forestGeometry;
        var scores=[], mask=new Float32Array(N);
        var shoulders=c.RegionalPlan.routeShoulders;
        for(var s=0;s<shoulders.length;++s) {
            var shoulder=shoulders[s];
            for(var y=Math.max(3,shoulder.y-shoulder.ry);y<Math.min(H-3,shoulder.y+shoulder.ry);++y)
                for(var x=Math.max(3,shoulder.x-shoulder.rx);x<Math.min(W-3,shoulder.x+shoulder.rx);++x) {
                    var dx=(x-shoulder.x)/shoulder.rx, dy=(y-shoulder.y)/shoulder.ry;
                    geography[y*W+x]+=Math.max(0,1-dx*dx-dy*dy)*0.55;
                }
        }
        // Rank the dry landscape before subtracting routes and sites. Ranking
        // only the leftover cells inflated every style into the same perimeter
        // forest on maps with substantial gameplay reservations.
        for(var i=0;i<N;++i) if(land[i]) scores.push({i:i,score:geography[i]});
        scores.sort(function(a,b){return b.score-a.score || a.i-b.i;});
        var fraction=plan.shape==="clearings" ? 0.88 : plan.shape==="bank" ? 0.64 : 0.74;
        var target=Math.min(Math.floor(scores.length*fraction),Math.ceil(N*Math.min(0.64,c.Profile.TreeCoverage+0.04)));
        for(var j=0;j<target;++j) if(eligible[scores[j].i]) mask[scores[j].i]=1;
        // Discard isolated slivers before the tile fitter. Never join stands
        // across a reserved passage or refill a deliberately open clearing.
        var seen=new Uint8Array(N), bodies=[], placed=0;
        for(var start=0;start<N;++start) {
            if(!mask[start] || seen[start]) continue;
            var queue=[start]; seen[start]=1;
            for(var q=0;q<queue.length;++q) {
                var at=queue[q], neighbours=[at-1,at+1,at-W,at+W];
                for(var d=0;d<4;++d) {
                    var next=neighbours[d];
                    // At least one empty outer cell makes all neighbours safe.
                    if(mask[next] && !seen[next]) {seen[next]=1;queue.push(next);}
                }
            }
            if(queue.length<20) for(var rm=0;rm<queue.length;++rm) mask[queue[rm]]=0;
            else { bodies.push({cells:queue.length}); placed+=queue.length; }
        }
        c.RegionalPlan.forestGeometry={version:8,shape:plan.shape,arrangement:"continuous",
            rooms:rooms,bodies:bodies,sourceMaskCells:placed,routeRooms:routeRooms.length,geography:plan};
        c._sceneForestField=mask;
        return mask;
    },

    Field: function(c, terrain) {
        var p = c.Profile, regional = c.RegionalPlan, library = MapGen.ForestSilhouettes;
        if(!p.SceneForests || MapGen.Context.IsMultiplayer(c) || !regional || !regional.regions.length ||
            ["groves","heartwood","branches","bank","clearings"].indexOf(regional.forestShape) < 0) return null;
        if(c._sceneForestField) return c._sceneForestField;
        var W = c.Width, H = c.Height, N = W*H, get = MapGen.Layers.Get, E = MapGen.Intent;
        var eligible = new Uint8Array(N), land = new Uint8Array(N), boundary=this.Boundary(c);
        var rooms = [], bodies = [], sources = [], ice = p.TerrainType === Terrain.Types.Ice;
        var gap = ice ? 3 : 2;
        var entries = c.GameplayPlan && c.GameplayPlan.entries || [];
        for(var e = 0; e < entries.length; ++e) {
            var r = entries[e].candidate.rect;
            rooms.push({x:(r.minX+r.maxX)/2,y:(r.minY+r.maxY)/2,
                rx:Math.max(5,(r.maxX-r.minX+1)/2+2),ry:Math.max(4,(r.maxY-r.minY+1)/2+2),bounds:r});
        }
        for(var ri = 0; ri < regional.regions.length; ++ri) {
            var point = regional.regions[ri].point;
            rooms.push({x:point.x,y:point.y,rx:5,ry:4});
        }
        var routePlan=MapGen.Layout.RouteScenes.Prepare(c,terrain);
        var routeRooms=routePlan.rooms;
        rooms=rooms.concat(routeRooms);
        var margin=ice ? 3 : 1;
        for(var y = margin; y < H-margin; ++y) for(var x = margin; x < W-margin; ++x) {
            var cell = y*W+x, dry = true;
            for(var dy = -1; dy <= 1 && dry; ++dy) for(var dx = -1; dx <= 1; ++dx) {
                var xx = x+dx, yy = y+dy, at = yy*W+xx;
                if(terrain ? terrain.terrain[at] !== E.Terrain.LAND :
                    get(c.Layers.water,xx,yy,0) || get(c.Layers.riverBank,xx,yy,0) ||
                    get(c.Layers.coast,xx,yy,0) || get(c.Layers.outcrop,xx,yy,0) ||
                    get(c.Layers.owner,xx,yy,0) === MapGen.Layers.Owner.CLIFF) { dry = false; break; }
            }
            if(dry) land[cell]=1;
            if(y<boundary[0][x] || y>=H-boundary[1][x] ||
                x<boundary[2][y] || x>=W-boundary[3][y]) dry=false;
            if(terrain ? terrain.movement[cell]&E.Movement.KEEP_CLEAR :
                get(c.Layers.keepClear,x,y,0) || get(c.Layers.path,x,y,0)) dry=false;
            for(var k = 0; dry && k < rooms.length; ++k) {
                var room = rooms[k], rx = (x-room.x)/room.rx, ry = (y-room.y)/room.ry;
                var bounds = room.bounds;
                if(rx*rx+ry*ry < 1 || bounds && x >= bounds.minX && x <= bounds.maxX &&
                    y >= bounds.minY && y <= bounds.maxY) dry = false;
            }
            if(dry) eligible[cell] = 1;
        }
        if(regional.forestShape !== "groves") return this.Connected(c,eligible,land,rooms,routeRooms);
        if(!library || !library.length) return null;
        for(var li = 0; li < library.length; ++li)
            if(library[li].source === (ice ? "ice" : "jungle")) sources.push(li);
        if(!sources.length) return null;
        var random = MapGen.Random.CreateSeeded(MapGen.Random.HashTile(c.Seed,31,19,20301));
        var mask = new Uint8Array(N), spacing = new Uint8Array(N);
        // Use tile-scale stands on every map size. XL maps gain more places,
        // rather than stretching a pair of groves across several screens.
        var desired = Math.ceil(N*Math.min(0.48,p.TreeCoverage+0.04)), placed = 0;
        var open = p.VisualComposition === "open_woods", broken = p.VisualComposition === "broken_woods";
        for(var trial = 0; trial < 640 && placed < desired; ++trial) {
            if(open && bodies.length >= 3+Math.floor(N/6000)) break;
            var index = sources[random.Int(0,sources.length-1)], shape = library[index];
            var rotation = random.Int(0,3), flip = random.Chance(0.5);
            // Ice smoothing needs an interior behind its canopy and trunks.
            // Original visible silhouettes include those edge rows already.
            // Fit several size classes, rather than repeating a single scale.
            // Place the broad stands first; later trials fit medium satellites.
            var sizeClass = broken ? (trial%7 === 0 ? 2 : trial%2) : trial < 16 ? 2 : trial%3;
            var span = sizeClass === 2 ? random.Float(24,36) :
                sizeClass === 1 ? random.Float(15,23) : random.Float(9,14);
            var scale = Math.max(ice ? 1 : 0.9,span/Math.max(shape.width,shape.height));
            var sourceW = Math.round(shape.width*scale), sourceH = Math.round(shape.height*scale);
            var sw = rotation%2 ? sourceH : sourceW, sh = rotation%2 ? sourceW : sourceH;
            if(sw > W-6 || sh > H-6) continue;
            var site = rooms[trial%rooms.length], angle = random.Float(0,Math.PI*2);
            var reach = Math.min(sw,sh)/2+random.Float(5,9);
            var px = site.x+Math.cos(angle)*reach, py = site.y+Math.sin(angle)*reach;
            // Some stands occupy the spaces between districts. Most frame a
            // local clearing, so terrain and buildings describe the same place.
            if(trial%3 === 2) { px = random.Float(4,W-4); py = random.Float(4,H-4); }
            if(trial%4 === 0 && regional.routeShoulders.length) {
                var shoulder=regional.routeShoulders[Math.floor(trial/4)%regional.routeShoulders.length];
                px=shoulder.x; py=shoulder.y;
            }
            var ox = Math.max(3,Math.min(W-sw-3,Math.round(px-sw/2)));
            var oy = Math.max(3,Math.min(H-sh-3,Math.round(py-sh/2)));
            var cells = [], total = 0, adjacent = false, blocked = 0;
            for(var sy = 0; sy < sourceH; ++sy) for(var sx = 0; sx < sourceW; ++sx) {
                if(shape.rows[Math.floor(sy*shape.height/sourceH)].charAt(Math.floor(sx*shape.width/sourceW)) !== "1") continue;
                var fx = flip ? sourceW-1-sx : sx, tx = fx, ty = sy;
                if(rotation === 1) { tx = sourceH-1-sy; ty = fx; }
                if(rotation === 2) { tx = sourceW-1-fx; ty = sourceH-1-sy; }
                if(rotation === 3) { tx = sy; ty = sourceW-1-fx; }
                var at = (oy+ty)*W+ox+tx;
                ++total;
                if(!eligible[at]) ++blocked;
                else { cells.push(at); if(spacing[at]) adjacent = true; }
            }
            if(blocked > total*0.20 || adjacent || cells.length < 20) continue;
            if(cells.length > (desired-placed)*1.15) continue;
            for(var ci = 0; ci < cells.length; ++ci) {
                var cell = cells[ci], cx = cell%W, cy = Math.floor(cell/W);
                mask[cell] = 1; ++placed;
                for(var gy = cy-gap; gy <= cy+gap; ++gy)
                    for(var gx = cx-gap; gx <= cx+gap; ++gx) spacing[gy*W+gx] = 1;
            }
            bodies.push({silhouette:index,x:ox,y:oy,width:sw,height:sh,rotation:rotation,flip:flip,sizeClass:sizeClass});
        }
        // Give ice's canopy fitter an interior behind each source outline.
        // Keep a one-cell corridor when two stands face each other.
        if(ice) {
            var grown = new Uint8Array(mask);
            for(var gy = 3; gy < H-3; ++gy) for(var gx = 3; gx < W-3; ++gx) {
                var gi = gy*W+gx;
                if(!eligible[gi] || mask[gi]) continue;
                var horizontal = mask[gi-1] || mask[gi+1], vertical = mask[gi-W] || mask[gi+W];
                if((horizontal || vertical) && !(mask[gi-1] && mask[gi+1]) && !(mask[gi-W] && mask[gi+W])) {
                    grown[gi] = 1; ++placed;
                }
            }
            mask = grown;
        }
        // Preserve complete fitted stands. Global coverage growth would fill
        // the gaps back in after they have been deliberately left open.
        if(!placed) return null;
        var field = new Float32Array(N);
        for(var i = 0; i < N; ++i) field[i] = mask[i];
        regional.forestGeometry = {version:8,shape:regional.forestShape,arrangement:"scene_groups",
            rooms:rooms,bodies:bodies,sourceMaskCells:placed,routeRooms:routeRooms.length};
        c._sceneForestField = field;
        return field;
    }
};
