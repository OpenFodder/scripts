var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// Find settings in the existing terrain before fitting mission districts.
// These are preferences: the normal footprint and route search owns legality.
MapGen.Layout.Landmarks = {
    Prepare: function(c, g) {
        g.landmarks=[];
        if(!c.Profile.SceneForests || MapGen.Context.IsMultiplayer(c) ||
            MapGen.Layout.GameplayPlan.Policy(c)==="maze") return [];
        var W=c.Width,H=c.Height,get=MapGen.Layers.Get,I=MapGen.Integration,found=[];
        function sum(sat,x,y,r) {return sat ? I.StructureSATSum(sat,W,H,x-r,y-r,x+r,y+r) : 0;}
        function add(kind,x,y,fx,fy,priority) {
            x=Math.round(x); y=Math.round(y);
            if(x<8 || y<8 || x>=W-8 || y>=H-8 || sum(g.waterSAT,x,y,4) || sum(g.cliffSAT,x,y,4)) return;
            for(var i=0;i<found.length;++i) {
                var a=found[i],dx=x-a.x,dy=y-a.y;
                if(a.kind===kind && dx*dx+dy*dy<49) return;
            }
            found.push({kind:kind,x:x,y:y,feature:{x:fx,y:fy},priority:priority});
        }
        var seen=new Uint8Array(W*H),m=c.IntentMap,E=MapGen.Intent;
        function crossing(x,y) {
            return get(c.Layers.crossing,x,y,0) || get(c.Layers.causeway,x,y,0) ||
                m && m.movement[y*W+x]&(E.Movement.CROSSING|E.Movement.BRIDGE);
        }
        for(var y=1;y<H-1;++y) for(var x=1;x<W-1;++x) {
            var start=y*W+x;
            if(seen[start] || !crossing(x,y)) continue;
            var queue=[start],sx=0,sy=0,minX=x,maxX=x,minY=y,maxY=y;seen[start]=1;
            for(var q=0;q<queue.length;++q) {
                var cell=queue[q],cx=cell%W,cy=Math.floor(cell/W);sx+=cx;sy+=cy;
                minX=Math.min(minX,cx);maxX=Math.max(maxX,cx);
                minY=Math.min(minY,cy);maxY=Math.max(maxY,cy);
                var neighbours=[cell-1,cell+1,cell-W,cell+W];
                for(var n=0;n<4;++n) {
                    var next=neighbours[n],nx=next%W,ny=Math.floor(next/W);
                    if(nx<1 || ny<1 || nx>=W-1 || ny>=H-1 || seen[next] || !crossing(nx,ny)) continue;
                    seen[next]=1;queue.push(next);
                }
            }
            var fx=Math.round(sx/queue.length),fy=Math.round(sy/queue.length);
            var kind=sum(g.cliffSAT,fx,fy,6) ? "cliff_pass" : "bridgehead";
            // Search the actual ends of the crossing. A centre-only northern
            // approach misses both banks of a horizontal bridge or wide river.
            if(maxX-minX>maxY-minY) {
                for(var side=-1;side<=1;side+=2) {
                    var endX=side<0 ? minX : maxX;
                    for(var offset=-5;offset<=3;offset+=8)
                        add(kind,endX+side*7,fy+offset,endX,fy,1200);
                }
            } else for(var side=-1;side<=1;side+=2) {
                var endY=side<0 ? minY : maxY;
                for(var offset=-4;offset<=4;offset+=8)
                    add(kind,fx+offset,endY+side*8,fx,endY,side<0 ? 1250 : 1200);
            }
        }
        var cliff=c.IntentStyleContract && c.IntentStyleContract.cliff;
        if(cliff && cliff.crossing) {
            var pass=cliff.crossing;
            for(var offset=-9;offset<=9;offset+=9) {
                add("cliff_pass",pass.x+offset,pass.y-8,pass.x,pass.y,1400);
                add("cliff_foot",pass.x+offset,pass.y+8,pass.x,pass.y,1200);
            }
        }
        // Shore geometry and woodland entrances provide settings on maps that
        // have no bridge or pass. Coarse sampling bounds the work per map.
        for(var y=9;y<H-9;y+=5) for(var x=9;x<W-9;x+=5) {
            if(sum(g.waterSAT,x,y,5) || sum(g.cliffSAT,x,y,5)) continue;
            var wet=sum(g.waterSAT,x,y,12),woods=sum(g.woodlandSAT,x,y,9);
            if(wet>18) {
                var sides=(sum(g.waterSAT,x-10,y,3)>5 ? 1 : 0)+
                    (sum(g.waterSAT,x+10,y,3)>5 ? 1 : 0)+(sum(g.waterSAT,x,y-10,3)>5 ? 1 : 0)+
                    (sum(g.waterSAT,x,y+10,3)>5 ? 1 : 0);
                add(sides>=2 ? "headland" : "shore",x,y,x,y,sides>=2 ? 850 : 500);
            } else if(woods>30 && woods<180 && !sum(g.woodlandSAT,x,y,3))
                add("woodland_entrance",x,y,x,y,350);
        }
        g.landmarks=found;
        if(c.MissionLayout) {
            var counts={};
            for(var i=0;i<found.length;++i) counts[found[i].kind]=(counts[found[i].kind] || 0)+1;
            c.MissionLayout.landmarkCandidates=counts;
        }
        return found;
    },

    ForTarget: function(c,g,target,index) {
        if(!g.landmarks || index>=2) return null;
        var best=null,score=-Infinity,plan=c.MissionLayout;
        for(var i=0;i<g.landmarks.length;++i) {
            var site=g.landmarks[i],dx=site.x-target.x,dy=site.y-target.y,distance=Math.sqrt(dx*dx+dy*dy);
            if(distance>Math.min(36,target.radius*1.5)) continue;
            var apart=true;
            for(var j=0;j<index;++j) {
                var previous=plan.targets[j];
                var px=site.x-previous.x,py=site.y-previous.y;
                if(px*px+py*py<400) apart=false;
            }
            var rank=site.priority-distance*22+MapGen.Random.HashTile(c.Seed,site.x,site.y,24901)%71;
            if(apart && rank>score) {best=site;score=rank;}
        }
        return best;
    },

    Setting: function(c,point,lot) {
        var target=lot && lot.index===0 && c.MissionLayout.targets[lot.camp];
        var setting=target && target.landmark;
        if(!setting) return null;
        return this.Fits(setting,point) ? setting : null;
    },

    Fits: function(setting,point) {
        var dx=point.x-setting.x,dy=point.y-setting.y;
        if(dx*dx+dy*dy>64) return false;
        if(setting.kind==="bridgehead" || setting.kind==="cliff_pass" || setting.kind==="cliff_foot") {
            // Keep the feature in the building's gameplay view. This is only
            // a scoring preference; floor and access checks remain mandatory.
            var feature=setting.feature;
            if(Math.abs(point.x-feature.x)>10 || Math.abs(point.y-feature.y)>10) return false;
        }
        return true;
    },

    Visible: function(setting,terrain) {
        if(!setting || !terrain) return false;
        // Coarse landmark samples are search hints. The exact building view
        // must retain the feature after clearing before it earns a bonus.
        if(setting.kind==="woodland_entrance") return terrain.woods>0;
        if(setting.kind==="shore" || setting.kind==="headland") return terrain.water>0;
        if(setting.kind==="cliff_pass" || setting.kind==="cliff_foot") return terrain.cliff>0;
        if(setting.kind==="bridgehead") return terrain.bridge>0 || terrain.water>0;
        return false;
    },

    Score: function(setting,point,terrain) {
        if(!setting || !this.Fits(setting,point)) return 0;
        var dx=point.x-setting.x,dy=point.y-setting.y;
        var strength=terrain && (setting.kind==="shore" || setting.kind==="headland") ?
            Math.min(1,terrain.water/800) : 1;
        return (1800-Math.sqrt(dx*dx+dy*dy)*120)*strength;
    }
};
