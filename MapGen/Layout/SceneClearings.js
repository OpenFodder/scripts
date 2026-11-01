var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// Soften the outer edge of required rectangular aprons. Only dry optional
// woodland is removed; floors, shorelines and hard terrain keep their geometry.
MapGen.Layout.SceneClearings = {
    Outline: function(c,site) {
        var r=site.rect,b=Math.max(2,site.waterClearance || 0),a=site.clearance;
        var bounds={minX:Math.min(a.minX,r.minX-b),minY:Math.min(a.minY,r.minY-b),
            maxX:Math.max(a.maxX,r.maxX+b),maxY:Math.max(a.maxY,r.maxY+b)};
        var body={x:(bounds.minX+bounds.maxX)/2,y:(bounds.minY+bounds.maxY)/2,
            rx:(bounds.maxX-bounds.minX+1)*0.62,ry:(bounds.maxY-bounds.minY+1)*0.62,
            phase:MapGen.Random.HashTile(c.Seed,r.minX,r.minY,24911)/4294967296*Math.PI*2};
        if(!c.SettlementPlan || site.fenceCells) return body;
        // The required apron stays intact. Only the optional forecourt varies:
        // a narrower, offset entrance leaves woodland beside the doorway.
        var h=MapGen.Random.HashTile(c.Seed,r.minX,r.minY,24919);
        var front={x:body.x+((h&255)/255-0.5)*3,
            y:r.maxY+2.5,rx:2.5+((h>>>8)&255)/255*1.5,
            ry:2+((h>>>16)&255)/255*2};
        var minX=Math.min(body.x-body.rx,front.x-front.rx), maxX=Math.max(body.x+body.rx,front.x+front.rx);
        var minY=body.y-body.ry, maxY=Math.max(body.y+body.ry,front.y+front.ry);
        return {x:(minX+maxX)/2,y:(minY+maxY)/2,rx:(maxX-minX)/2,ry:(maxY-minY)/2,
            body:body,front:front};
    },

    Contains: function(shape,x,y) {
        if(shape.body) {
            var fx=(x-shape.front.x)/shape.front.rx, fy=(y-shape.front.y)/shape.front.ry;
            return this.Contains(shape.body,x,y) || fx*fx+fy*fy<=1;
        }
        var dx=(x-shape.x+Math.sin(y*0.25+shape.phase)*0.6)/shape.rx;
        var dy=(y-shape.y+Math.sin(x*0.21-shape.phase)*0.6)/shape.ry;
        // A rounded box contains the required corners without pushing the
        // middle of each edge several tiles into the surrounding woodland.
        return dx*dx*dx*dx+dy*dy*dy*dy<=1;
    },

    Rows: function(shape) {
        var rows=[];
        for(var y=Math.floor(shape.y-shape.ry-1);y<=Math.ceil(shape.y+shape.ry+1);++y) {
            var start=null, end=Math.ceil(shape.x+shape.rx+1);
            for(var x=Math.floor(shape.x-shape.rx-1);x<=end;++x) {
                var inside=this.Contains(shape,x,y);
                if(inside && start===null) start=x;
                if(!inside && start!==null) {rows.push({y:y,minX:start,maxX:x-1});start=null;}
            }
        }
        return rows;
    },

    Apply: function(c) {
        if(!c.Profile.SceneForests || MapGen.Context.IsMultiplayer(c) || !c.GameplayPlan ||
            c.GameplayPlan.policy==="maze") return;
        var R=MapGen.Layout.Reservations,E=MapGen.Intent,get=MapGen.Layers.Get,m=c.IntentMap;
        var field=c._sceneForestField,removed=0,shapes=[];
        for(var s=0;s<c.GameplayPlan.entries.length;++s) {
            var site=c.GameplayPlan.entries[s].candidate,shape=this.Outline(c,site);
            shapes.push(shape);
            for(var y=Math.max(3,Math.floor(shape.y-shape.ry-1));y<Math.min(c.Height-3,shape.y+shape.ry+1);++y)
                for(var x=Math.max(3,Math.floor(shape.x-shape.rx-1));x<Math.min(c.Width-3,shape.x+shape.rx+1);++x) {
                    if(!this.Contains(shape,x,y)) continue;
                    var at=y*c.Width+x;
                    if(field && field[at] && R.BlocksCover(c,x,y)) {field[at]=0;++removed;}
                    var dry=true;
                    for(var dy=-1;dy<=1 && dry;++dy) for(var dx=-1;dx<=1;++dx)
                        if(R.IsWater(c,x+dx,y+dy) || R.IsHardTerrain(c,x+dx,y+dy) ||
                            get(c.Layers.outcrop,x+dx,y+dy,0)) {dry=false;break;}
                    if(!dry || R.At(c,x,y)&(R.FLOOR|R.DETAIL) || get(c.Layers.occupied,x,y,0)) continue;
                    if(m && m.terrain[at]!==E.Terrain.LAND && m.terrain[at]!==E.Terrain.FOREST) continue;
                    if(field && field[at]) {field[at]=0;++removed;}
                    R.Rect(c,{minX:x,minY:y,maxX:x,maxY:y},R.CLEAR);
                }
        }
        if(field && c.RegionalPlan.forestGeometry)
            c.RegionalPlan.forestGeometry.sourceMaskCells-=removed;
        c.GameplayPlan.sceneClearings={shapes:shapes,forestCellsRemoved:removed};
    }
};
