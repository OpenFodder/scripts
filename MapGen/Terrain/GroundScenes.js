var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};

// Broad material changes are scenes, not a higher density of small decor.
// Fit a complete, walkable patch on final dry ground; never clip its artwork.
MapGen.Terrain.GroundScenes = {
    Enabled: function(c) {
        return c.Profile.SceneForests && !MapGen.Context.IsMultiplayer(c) &&
            (c.Profile.TerrainType === Terrain.Types.Jungle && Number(c.Profile.TerrainTypeSub || 0) <= 1 ||
             c.Profile.TerrainType === Terrain.Types.Ice && Number(c.Profile.TerrainTypeSub || 0) === 0);
    },

    Eligible: function(c,x,y,ice,yard) {
        var S=MapGen.Terrain.SurfaceDetail, R=MapGen.Layout.Reservations;
        var l=c.Layers, get=MapGen.Layers.Get;
        if(x<2 || y<2 || x>=c.Width-2 || y>=c.Height-2 ||
            (ice ? S.IceGround : S.Ground).indexOf(c.Map.TileGet(x,y))<0) return false;
        var occupied=get(l.occupied,x,y,0);
        if(occupied && !(yard && !ice && occupied==="live_structure_clearance") ||
            get(l.blocked,x,y,0) || get(l.water,x,y,0) ||
            get(l.riverBank,x,y,0) || get(l.coast,x,y,0) || get(l.outcrop,x,y,0) ||
            get(l.crossing,x,y,0) || get(l.causeway,x,y,0) || R.IsHardTerrain(c,x,y) ||
            R.At(c,x,y)&(R.FLOOR|R.DETAIL|R.DRY)) return false;
        // Grass is ordinary dry ground, so a forecourt may include its own
        // approach. Slippery ice always stays outside navigation clearance.
        return yard && !ice || !(get(l.keepClear,x,y,0) || get(l.path,x,y,0) || R.BlocksCover(c,x,y));
    },

    Patch: function(seed,width,height,ice,rounded) {
        var L=MapGen.Layers, C=MapGen.Terrain.Smoothing.Core;
        var chars=L.Create(width,height,"#"), tiles=L.Create(width,height,ice ? 0 : 123);
        var cx=(width-1)/2, cy=(height-1)/2, rx=cx-(ice ? 2 : 1), ry=cy-(ice ? 2 : 1);
        var phase=MapGen.Random.HashTile(seed,0,0,24609)/4294967296*Math.PI*2;
        var inset=ice ? 3 : 2;
        for(var y=inset;y<height-inset;++y) for(var x=inset;x<width-inset;++x) {
            var nx=(x-cx)/rx, ny=(y-cy)/ry;
            if(rounded==="organic") {
                nx+=0.24*Math.sin(ny*2+phase);
                ny+=0.18*Math.sin(nx*3-phase);
            }
            if(!rounded || nx*nx+ny*ny<=1)
                chars[x][y]=ice ? "W" : "+";
        }
        var context={Width:width,Height:height,Seed:seed};
        if(ice) {
            var data=MapGen.Terrain.Smoothing.Ice.Data();
            function edge(x,y) {
                return chars[x] && chars[x][y]==="#" &&
                    (chars[x-1] && chars[x-1][y]==="W" || chars[x+1] && chars[x+1][y]==="W" ||
                    chars[x][y-1]==="W" || chars[x][y+1]==="W");
            }
            C.ApplyEdgeRule(context,chars,tiles,data.edges,data.charToClass,{
                EdgeHintAt:function(x,y,dir) {
                    var nx=x+(dir==="E" ? 1 : dir==="W" ? -1 : 0);
                    var ny=y+(dir==="S" ? 1 : dir==="N" ? -1 : 0);
                    // Neighbouring edge cells carry the same material band.
                    // Treating them as pure snow makes a row of corner pairs.
                    return edge(x,y) && (chars[nx] && chars[nx][ny]==="W" || edge(nx,ny)) ? "I" : null;
                },
                RequiredContentsAt:function(x,y) {
                    if(chars[x][y]==="W") return ["ice"];
                    return chars[x-1] && chars[x-1][y]==="W" || chars[x+1] && chars[x+1][y]==="W" ||
                        chars[x][y-1]==="W" || chars[x][y+1]==="W" ? ["snow","ice"] : ["snow"];
                }
            });
            for(var y=0;y<height;++y) for(var x=0;x<width;++x) {
                var tile=data.edges.tiles[tiles[x][y]];
                if(!tile || tile.contents.some(function(value){return value!=="snow" && value!=="ice";})) return null;
                if((x===0 || x===width-1 || y===0 || y===height-1) && tiles[x][y]!==0 && tiles[x][y]!==1) return null;
            }
        } else {
            tiles=MapGen.Terrain.GrassRegions.Tiles(seed,chars,width,height);
            if(!tiles) return null;
        }
        return {tiles:tiles,width:width,height:height,ice:ice};
    },

    Fit: function(c,patch,x,y,yard) {
        if(!patch) return false;
        for(var py=0;py<patch.height;++py) for(var px=0;px<patch.width;++px)
            if(!this.Eligible(c,x+px,y+py,patch.ice,yard)) return false;
        return true;
    },

    Paint: function(c,patch,x,y) {
        var count=0, tile;
        // The one-cell outer frame is only a fitting margin. The interior
        // carries all transition tiles, including snow beside an ice center.
        for(var py=1;py<patch.height-1;++py) for(var px=1;px<patch.width-1;++px) {
            tile=patch.tiles[px][py];
            if(!patch.ice && tile===123) continue;
            c.Map.TileSet(x+px,y+py,tile);
            c.RenderedMap.Tiles[x+px][y+py]=tile;
            ++count;
        }
        return count;
    },

    Find: function(c,patch,anchor,sat,placed,scoreLimit) {
        var I=MapGen.Integration, hash=MapGen.Random.HashTile, best=null, bestScore=scoreLimit;
        var radius=Math.sqrt(bestScore), minX=Math.max(2,Math.ceil(anchor.x-patch.width/2-radius));
        var maxX=Math.min(c.Width-patch.width-2,Math.floor(anchor.x-patch.width/2+radius));
        var minY=Math.max(2,Math.ceil(anchor.y-patch.height/2-radius));
        var maxY=Math.min(c.Height-patch.height-2,Math.floor(anchor.y-patch.height/2+radius));
        // Scores add only nonnegative penalties to squared distance. Shrink
        // each row to positions that can improve the winner, retaining the
        // original row/column order for exact replay ties.
        for(var y=minY;y<=maxY;++y) {
            var dy=y+patch.height/2-anchor.y, remaining=bestScore-dy*dy;
            if(remaining<=0) continue;
            var reach=Math.sqrt(remaining);
            var rowStart=Math.max(minX,Math.ceil(anchor.x-patch.width/2-reach));
            var rowEnd=Math.min(maxX,Math.floor(anchor.x-patch.width/2+reach));
            for(var x=rowStart;x<=rowEnd;++x) {
                var dx=x+patch.width/2-anchor.x, distance=dx*dx+dy*dy;
                if(distance>=bestScore || I.StructureSATSum(sat,c.Width,c.Height,
                    x,y,x+patch.width-1,y+patch.height-1)) continue;
                var score=distance+hash(c.Seed,x,y,24617)%17;
                if(score>=bestScore) continue;
                var apart=true;
                for(var pi=0;pi<placed.length;++pi) {
                    var other=placed[pi];
                    if(x<other.x+other.width+5 && x+patch.width+5>other.x &&
                        y<other.y+other.height+5 && y+patch.height+5>other.y) apart=false;
                }
                if(apart) {best={x:x,y:y};bestScore=score;}
            }
        }
        return best;
    },

    Commit: function(c) {
        if(!this.Enabled(c)) return null;
        if(MapGen.Terrain.GrassRegions.Enabled(c)) return MapGen.Terrain.GrassRegions.Commit(c);
        var ice=c.Profile.TerrainType===Terrain.Types.Ice, hash=MapGen.Random.HashTile;
        var random=MapGen.Random.CreateSeeded(hash(c.Seed,0,0,24611));
        var anchors=[], entries=c.GameplayPlan ? c.GameplayPlan.entries : [], paths=c.Paths || [];
        var scenes=c.RegionalPlan && c.RegionalPlan.sceneRooms || [];
        for(var s=0;s<scenes.length;++s)
            anchors.push({x:scenes[s].x,y:scenes[s].y,kind:"route_scene"});
        if(!ice) for(var e=0;e<entries.length;++e) {
            var r=entries[e].candidate.rect;
            anchors.push({x:(r.minX+r.maxX)/2,y:r.maxY+4,kind:"forecourt"});
        }
        for(var p=0;p<paths.length;++p) {
            var points=paths[p].points || [];
            for(var j=12;j<points.length-6;j+=28) {
                var pt=points[j], prev=points[Math.max(0,j-3)], next=points[Math.min(points.length-1,j+3)];
                var horizontal=Math.abs(next.x-prev.x)>=Math.abs(next.y-prev.y), side=random.Chance(0.5) ? -1 : 1;
                anchors.push({x:pt.x+(horizontal ? 0 : side*8),
                    y:pt.y+(horizontal ? side*8 : 0),kind:"route_edge"});
            }
        }
        var report={patches:[],tiles:0,probes:0}, limit=Math.min(10,2+Math.floor(c.Width*c.Height/1800));
        var budget=Math.floor(c.Width*c.Height*(ice ? 0.045 : 0.065));
        var I=MapGen.Integration, blocked=[], yards=[], shore=[], get=MapGen.Layers.Get;
        for(var y=0;y<c.Height;++y) {
            blocked[y]=[]; yards[y]=[];
            for(var x=0;x<c.Width;++x) {
                blocked[y][x]=this.Eligible(c,x,y,ice,false) ? 0 : 1;
                yards[y][x]=!ice && this.Eligible(c,x,y,false,true) ? 0 : 1;
                if(ice && (x+y)%5===0 && get(c.Layers.water,x,y,0) &&
                    (!get(c.Layers.water,x-1,y,1) || !get(c.Layers.water,x+1,y,1) ||
                     !get(c.Layers.water,x,y-1,1) || !get(c.Layers.water,x,y+1,1)))
                    shore.push({x:x,y:y,kind:"shore_field"});
            }
        }
        var fieldSAT=I.BuildStructureSAT(blocked,c.Width,c.Height);
        var yardSAT=ice ? fieldSAT : I.BuildStructureSAT(yards,c.Width,c.Height);
        // Cache a handful of complete patches; all fit trials are rectangle
        // checks. Native ice fitting runs once per shape, not per candidate.
        var patches=[], used={};
        for(var k=0;k<4;++k) {
            var w=k===0 ? 9 : random.Int(ice ? 9 : 11,17), h=k===0 ? (ice ? 9 : 7) : random.Int(9,ice ? 14 : 12);
            // The painted core excludes three cells on each side. Bound its
            // aspect ratio, rather than the bbox, to avoid thin icy bars.
            if(ice) {
                h=Math.max(h,6+Math.ceil((w-6)/2));
                w=Math.max(w,6+Math.ceil((h-6)/2));
            }
            patches.push(this.Patch(hash(c.Seed,k,0,24613),w,h,ice,ice ? "organic" : true) ||
                this.Patch(hash(c.Seed,k,0,24613),w,h,ice,false));
        }
        for(var trial=0;trial<24 && report.patches.length<limit;++trial) {
            ++report.probes;
            var anchor=trial<Math.min(12,anchors.length) ? anchors[trial] :
                ice ? (shore.length ? shore[random.Int(0,shore.length-1)] : null) :
                {x:random.Int(4,c.Width-5),y:random.Int(4,c.Height-5),kind:"field"};
            if(!anchor) continue;
            var yard=anchor.kind==="forecourt", planned=anchor.kind==="route_scene";
            var index=yard || planned ? 0 : trial%patches.length, patch=patches[index];
            // Repeating the only small shape that fits produced rows of
            // identical ice diamonds. Each fitted ice silhouette appears once.
            if(ice && used[index]) continue;
            if(!patch || report.tiles+(patch.width-2)*(patch.height-2)>budget) continue;
            var scoreLimit=planned ? 25 : yard ? 100 : anchor.kind==="shore_field" ? 144 :
                anchor.kind==="route_edge" ? 324 : Infinity;
            var best=this.Find(c,patch,anchor,yard ? yardSAT : fieldSAT,report.patches,scoreLimit);
            if(!best || !this.Fit(c,patch,best.x,best.y,yard)) continue;
            var x=best.x, y=best.y;
            report.tiles+=this.Paint(c,patch,x,y);
            used[index]=true;
            report.patches.push({x:x,y:y,width:patch.width,height:patch.height,
                kind:anchor.kind,material:ice ? "ice" : "light_grass"});
        }
        return report;
    }
};
