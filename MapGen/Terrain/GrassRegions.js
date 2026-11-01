var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};

// Two grass materials, with the original atlas joining them. This is a visual
// field on final dry ground: it never creates paths or changes terrain owners.
MapGen.Terrain.GrassRegions = {
    Enabled: function(c) {
        return c.Profile.SceneForests && c.Profile.NaturalJungleGround &&
            c.Profile.TerrainType===Terrain.Types.Jungle &&
            Number(c.Profile.TerrainTypeSub || 0)<=1 && !MapGen.Context.IsMultiplayer(c);
    },

    Noise: function(seed,x,y,scale,salt) {
        x/=scale; y/=scale;
        var ix=Math.floor(x), iy=Math.floor(y), fx=x-ix, fy=y-iy;
        fx=fx*fx*(3-2*fx); fy=fy*fy*(3-2*fy);
        var hash=MapGen.Random.HashTile, a=hash(seed,ix,iy,salt)/4294967296;
        var b=hash(seed,ix+1,iy,salt)/4294967296, d=hash(seed,ix,iy+1,salt)/4294967296;
        var e=hash(seed,ix+1,iy+1,salt)/4294967296;
        return (a+(b-a)*fx)*(1-fy)+(d+(e-d)*fx)*fy;
    },

    Rules: function() {
        if(this._rules) return this._rules;
        var rules=MapGen.Terrain.Smoothing.Jungle.Data().lightgrassDarkgrass.bitmask;
        var exact={}, cardinal={}, positions=[1,3,4,6];
        for(var i=0;i<rules.length;++i) {
            var key="";
            exact[rules[i].bm]=rules[i];
            for(var j=0;j<4;++j) key+=rules[i].bm.charAt(positions[j]);
            if(!cardinal[key]) cardinal[key]=rules[i];
        }
        return this._rules={exact:exact,cardinal:cardinal,fill:{tiles:[{tile:"0"}]}};
    },

    Entry: function(bm) {
        var rules=this.Rules(), key=bm.charAt(1)+bm.charAt(3)+bm.charAt(4)+bm.charAt(6);
        // Diagonal-only contact leaves every shared edge light grass.
        return rules.exact[bm] || (key==="0000" ? rules.fill : rules.cardinal[key]);
    },

    Tiles: function(seed,chars,width,height) {
        var C=MapGen.Terrain.Smoothing.Core, tiles=MapGen.Layers.Create(width,height,123);
        var context={Seed:seed,Width:width,Height:height};
        for(var y=0;y<height;++y) for(var x=0;x<width;++x) if(chars[x][y]==="+") {
            var entry=this.Entry(C.TransitionBitmask(chars,x,y,{center:"+",ground:"#"}));
            if(!entry) return null;
            tiles[x][y]=C.PickTileEntry(context,entry,x,y,24607);
        }
        return tiles;
    },

    Eligible: function(c,x,y) {
        var tile=c.Map.TileGet(x,y), R=MapGen.Layout.Reservations;
        if(tile!==123 && tile!==124) return false;
        // Mobile actors and pickups do not need a dark rectangle under them.
        // Both grass materials have the same dry, walkable movement contract.
        return !(R.At(c,x,y)&(R.FLOOR|R.DETAIL|R.DRY)) && !R.IsHardTerrain(c,x,y) &&
            !R.IsWater(c,x,y) && !MapGen.Layers.Get(c.Layers.outcrop,x,y,0) &&
            MapGen.Layers.Get(c.Layers.occupied,x,y,0)!=="live_structure";
    },

    Mask: function(c) {
        var W=c.Width,H=c.Height, L=MapGen.Layers;
        var hash=MapGen.Random.HashTile, chars=L.Create(W,H,"#"), eligible=L.Create(W,H,0), join=L.Create(W,H,0);
        var scale=15+hash(c.Seed,0,0,24901)%17;
        var angle=hash(c.Seed,0,0,24903)/4294967296*Math.PI, cs=Math.cos(angle), sn=Math.sin(angle);
        var stretch=0.55+hash(c.Seed,0,0,24905)/4294967296*0.8;
        var fraction=0.24+hash(c.Seed,0,0,24907)/4294967296*0.28;
        var values=L.Create(W,H,-1), scores=[];
        for(var y=0;y<H;++y) for(var x=0;x<W;++x) {
            eligible[x][y]=this.Eligible(c,x,y) ? 1 : 0;
            var R=MapGen.Layout.Reservations, flags=R.At(c,x,y), tile=c.Map.TileGet(x,y);
            // A plain dark-grass floor already supplies the dark half of the
            // join. Adding another empty belt boxes every building in twice.
            join[x][y]=eligible[x][y] || (flags&R.FLOOR) && !(flags&(R.DETAIL|R.DRY)) &&
                (tile===123 || tile===124) && !R.IsWater(c,x,y) && !R.IsHardTerrain(c,x,y) ? 1 : 0;
        }
        // Keep a dark-grass join to existing bank, canopy and structure art.
        // Routes remain eligible because both materials are ordinary ground.
        for(var y=0;y<H;++y) for(var x=0;x<W;++x) {
            if(!eligible[x][y]) continue;
            var safe=true;
            for(var dy=-1;dy<=1 && safe;++dy) for(var dx=-1;dx<=1;++dx)
                if(x+dx>=0 && x+dx<W && y+dy>=0 && y+dy<H && !join[x+dx][y+dy]) {safe=false;break;}
            if(!safe) continue;
            var u=x*cs+y*sn, v=(y*cs-x*sn)*stretch;
            var value=this.Noise(c.Seed,u,v,scale,24911)+
                (this.Noise(c.Seed,x,y,6,24913)-0.5)*0.24;
            values[x][y]=value; scores.push(value);
        }
        // Rank only safe ground so an unlucky low-frequency sample cannot
        // erase the material contrast from an otherwise open map.
        scores.sort(function(a,b){return a-b;});
        var threshold=scores.length ? scores[Math.floor((scores.length-1)*(1-fraction))] : 2;
        for(var y=0;y<H;++y) for(var x=0;x<W;++x)
            if(values[x][y]>=threshold) chars[x][y]="+";
        // Removing an unsupported tip can expose the next cell in a narrow
        // neck. A work queue reaches the fixed point in linear work instead
        // of dropping a large region after an arbitrary number of full scans.
        var C=MapGen.Terrain.Smoothing.Core, pending=[];
        for(var y=0;y<H;++y) for(var x=0;x<W;++x) if(chars[x][y]==="+" &&
            !this.Entry(C.TransitionBitmask(chars,x,y,{center:"+",ground:"#"}))) pending.push({x:x,y:y});
        for(var r=0;r<pending.length;++r) {
            var p=pending[r];
            if(chars[p.x][p.y]!=="+" || this.Entry(C.TransitionBitmask(chars,p.x,p.y,{center:"+",ground:"#"}))) continue;
            chars[p.x][p.y]="#";
            var adjacent=[[p.x-1,p.y],[p.x+1,p.y],[p.x,p.y-1],[p.x,p.y+1]];
            for(var n=0;n<4;++n) {
                var nx=adjacent[n][0],ny=adjacent[n][1];
                if(nx>=0 && nx<W && ny>=0 && ny<H && chars[nx][ny]==="+") pending.push({x:nx,y:ny});
            }
        }
        // Keep broad regions, not a new collection of little texture stamps.
        var seen=L.Create(W,H,0), regions=[];
        for(var y=0;y<H;++y) for(var x=0;x<W;++x) if(chars[x][y]==="+" && !seen[x][y]) {
            var queue=[{x:x,y:y}], valid=true, bounds={x:x,y:y,maxX:x,maxY:y};
            seen[x][y]=1;
            for(var q=0;q<queue.length;++q) {
                var p=queue[q];
                if(!this.Entry(C.TransitionBitmask(chars,p.x,p.y,{center:"+",ground:"#"}))) valid=false;
                bounds.x=Math.min(bounds.x,p.x); bounds.y=Math.min(bounds.y,p.y);
                bounds.maxX=Math.max(bounds.maxX,p.x); bounds.maxY=Math.max(bounds.maxY,p.y);
                var neighbours=[[p.x-1,p.y],[p.x+1,p.y],[p.x,p.y-1],[p.x,p.y+1]];
                for(var n=0;n<4;++n) {
                    var nx=neighbours[n][0],ny=neighbours[n][1];
                    if(nx>=0 && nx<W && ny>=0 && ny<H && chars[nx][ny]==="+" && !seen[nx][ny]) {seen[nx][ny]=1;queue.push({x:nx,y:ny});}
                }
            }
            if(!valid || queue.length<24) {
                for(var q=0;q<queue.length;++q) chars[queue[q].x][queue[q].y]="#";
            } else regions.push({x:bounds.x,y:bounds.y,width:bounds.maxX-bounds.x+1,
                height:bounds.maxY-bounds.y+1,tiles:queue.length,kind:"material_region",material:"light_grass"});
        }
        return {chars:chars,regions:regions,scale:scale,threshold:threshold,repairVisits:pending.length};
    },

    Commit: function(c) {
        var field=this.Mask(c), tiles=this.Tiles(c.Seed,field.chars,c.Width,c.Height);
        var report={patches:field.regions,tiles:0,probes:0,scale:field.scale,threshold:field.threshold};
        if(!tiles) return {patches:[],tiles:0,probes:0};
        for(var y=0;y<c.Height;++y) for(var x=0;x<c.Width;++x) if(field.chars[x][y]==="+") {
            c.Map.TileSet(x,y,tiles[x][y]); c.RenderedMap.Tiles[x][y]=tiles[x][y]; ++report.tiles;
        }
        return report;
    }
};
