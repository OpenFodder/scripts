var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// Plan pauses and enclosing stands together, before building lots and forest
// allocation. Records describe preferred spaces, never new cover budgets.
MapGen.Layout.RouteScenes = {
    Prepare: function(c,terrain) {
        if(!c.Profile.SceneForests || !c.RegionalPlan || MapGen.Context.IsMultiplayer(c)) return null;
        if(c.RouteScenes) return c.RouteScenes;
        var W=c.Width,H=c.Height,E=MapGen.Intent,get=MapGen.Layers.Get;
        var plan={rooms:[],shoulders:[],candidates:0},paths=c._regionalSceneRoutes || c.Paths || [];
        var obstacles=c.RegionalPlan.regions.map(function(r){return {x:r.point.x,y:r.point.y,rx:5,ry:4};});
        function dry(x,y) {
            if(x<4 || y<4 || x>=W-4 || y>=H-4) return false;
            return terrain ? terrain.terrain[y*W+x]===E.Terrain.LAND :
                !MapGen.Layout.Reservations.IsWater(c,x,y) && !MapGen.Layout.Reservations.IsHardTerrain(c,x,y) &&
                !get(c.Layers.outcrop,x,y,0);
        }
        function fits(x,y,wood) {
            var usable=0,total=0;
            for(var dy=-3;dy<=3;++dy) for(var dx=-4;dx<=4;++dx) {
                ++total;
                if(!dry(x+dx,y+dy)) {if(!wood) return false;continue;}
                var clear=terrain ? terrain.movement[(y+dy)*W+x+dx]&E.Movement.KEEP_CLEAR :
                    get(c.Layers.keepClear,x+dx,y+dy,0) || get(c.Layers.path,x+dx,y+dy,0);
                if(!clear) ++usable;
            }
            return usable>=total*(wood ? 0.80 : 0.50);
        }
        function apart(point,list,extra) {
            for(var i=0;i<list.length;++i) {
                var p=list[i],dx=(point.x-p.x)/(p.rx+extra),dy=(point.y-p.y)/(p.ry+extra);
                if(dx*dx+dy*dy<1) return false;
            }
            return true;
        }
        var candidates=[],limit=Math.min(3,1+Math.floor(W*H/5000));
        for(var p=0;p<paths.length && candidates.length<512;++p) {
            var points=paths[p].points || [];
            if(paths[p].role==="planned_structure_access") continue;
            for(var j=8;j<points.length-6 && candidates.length<512;j+=6) {
                var a=points[j-3],b=points[j+3],pt=points[j],dx=b.x-a.x,dy=b.y-a.y;
                var length=Math.max(1,Math.sqrt(dx*dx+dy*dy));
                for(var side=-1;side<=1 && candidates.length<512;side+=2) {
                    var distance=7+MapGen.Random.HashTile(c.Seed,j,p,24903)%3;
                    var candidate={x:Math.round(pt.x-dy/length*distance*side),
                        y:Math.round(pt.y+dx/length*distance*side),rx:7,ry:5,path:p,step:j};
                    if(apart(candidate,obstacles,5)) candidates.push(candidate);
                }
            }
        }
        plan.candidates=candidates.length;
        // Prefer a different part of the route for each scene. Clearings and
        // shoulders use separate fit tests and share their exclusion list.
        candidates.sort(function(a,b){return MapGen.Random.HashTile(c.Seed,a.x,a.y,24907)-
            MapGen.Random.HashTile(c.Seed,b.x,b.y,24907) || a.y-b.y || a.x-b.x;});
        var used=[];
        for(var kind=0;kind<2;++kind) {
            var wood=kind===0,list=wood ? plan.shoulders : plan.rooms;
            for(var i=0;i<candidates.length && list.length<limit;++i) {
                var point=candidates[i];
                if(!apart(point,used,6) || !fits(point.x,point.y,wood)) continue;
                var scene={x:point.x,y:point.y,rx:7,ry:5,path:point.path,step:point.step};
                if(!wood) {scene.route=true;scene.kind="woodland_clearing";}
                list.push(scene);used.push(scene);
            }
        }
        c.RouteScenes=plan;
        c.RegionalPlan.sceneRooms=plan.rooms;
        c.RegionalPlan.routeShoulders=plan.shoulders;
        return plan;
    }
};
