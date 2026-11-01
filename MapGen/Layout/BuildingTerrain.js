var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// Read the same forest proposal that terrain will consume. Building searches
// can then find an edge before carving their exact floors and approaches.
MapGen.Layout.BuildingTerrain = {
    Woodland: function(c) {
        if(!c.Profile.SceneForests) return null;
        var W = c.Width, H = c.Height, field = null, threshold = 0, values = [];
        var get = MapGen.Layers.Get, rows = [], R = MapGen.Layout.Reservations;
        if(!c.IntentMap && c.RegionalPlan) {
            if(!c._regionalForestField)
                c._regionalForestField = MapGen.Layout.RegionIntents.ForestField(c);
            field = c._regionalForestField;
            if(!c._sceneForestField) {
                for(var y = 0; y < H; ++y) for(var x = 0; x < W; ++x)
                    if(!R.IsWater(c,x,y) && !get(c.Layers.keepClear,x,y,0)) values.push(field[y*W+x]);
                values.sort(function(a,b) { return b-a; });
                threshold = values.length ? values[Math.min(values.length-1,Math.floor(W*H*c.Profile.TreeCoverage))] : Infinity;
            }
        }
        for(var y = 0; y < H; ++y) {
            rows[y] = [];
            for(var x = 0; x < W; ++x) {
                var tree = field ? field[y*W+x] > threshold : get(c.Layers.blocked,x,y,0);
                rows[y][x] = tree && !R.IsWater(c,x,y) && !R.IsHardTerrain(c,x,y) &&
                    !get(c.Layers.outcrop,x,y,0) && !get(c.Layers.keepClear,x,y,0) ? 1 : 0;
            }
        }
        return MapGen.Integration.BuildStructureSAT(rows,W,H);
    },

    SupportedWoodland: function(c, sat) {
        if(!sat || c.Profile.TerrainType!==Terrain.Types.Ice) return sat;
        // A stand needs room for canopy and trunk transitions. Keep its
        // supported fringe too: scoring only the deep core misses visible
        // edges when the rest of a large forest is just outside the screen.
        var rows=[],I=MapGen.Integration;
        for(var y=0;y<c.Height;++y) {rows[y]=[];
            for(var x=0;x<c.Width;++x) rows[y][x]=x>1 && y>1 && x<c.Width-2 && y<c.Height-2 &&
                I.StructureSATSum(sat,c.Width,c.Height,x-2,y-2,x+2,y+2)===25 ? 1 : 0;
        }
        var core=I.BuildStructureSAT(rows,c.Width,c.Height);
        for(var y=0;y<c.Height;++y) for(var x=0;x<c.Width;++x)
            rows[y][x]=I.StructureSATSum(core,c.Width,c.Height,x-1,y-1,x+1,y+1)>0 ? 1 : 0;
        return I.BuildStructureSAT(rows,c.Width,c.Height);
    },

    View: function(c, rect) {
        var cx=Math.floor((rect.minX+rect.maxX)/2),cy=Math.floor((rect.minY+rect.maxY)/2);
        var x=Math.max(0,Math.min(c.Width-20,cx-10)),y=Math.max(0,Math.min(c.Height-15,cy-7));
        return {minX:x,minY:y,maxX:x+19,maxY:y+14};
    },

    ForEntries: function(c, g, entries) {
        if(!c.Profile.SceneForests || !g.woodlandSAT || !entries.length) return g;
        // Existing clearings also remove canopy support. Build this once per
        // search, so candidates cannot borrow trees from a neighbour's yard.
        var W=c.Width,H=c.Height,I=MapGen.Integration,clear=new Uint8Array(W*H),views=[];
        for(var i=0;i<entries.length;++i) {
            var site=entries[i].candidate,rows=MapGen.Layout.SceneClearings.Rows(
                MapGen.Layout.SceneClearings.Outline(c,site));
            views.push(this.View(c,site.rect));
            for(var j=0;j<rows.length;++j) {var row=rows[j];
                if(row.y<0 || row.y>=H) continue;
                for(var x=Math.max(0,row.minX);x<=Math.min(W-1,row.maxX);++x) clear[row.y*W+x]=1;
            }
        }
        var woods=[];
        for(var y=0;y<H;++y) {woods[y]=[];
            for(var x=0;x<W;++x) woods[y][x]=!clear[y*W+x] && !c.Layers.path[x][y] &&
                I.StructureSATSum(g.woodlandSAT,W,H,x,y,x,y) ? 1 : 0;
        }
        var sat=I.BuildStructureSAT(woods,W,H),core=this.SupportedWoodland(c,sat),shared=[];
        for(var y=0;y<H;++y) {shared[y]=[];
            for(var x=0;x<W;++x) {
                var visible=false;
                for(var v=0;v<views.length && !visible;++v) {var view=views[v];
                    visible=x>=view.minX && x<=view.maxX && y>=view.minY && y<=view.maxY;
                }
                shared[y][x]=visible ? I.StructureSATSum(core,W,H,x,y,x,y) : 0;
            }
        }
        return {woodlandSAT:sat,woodlandCoreSAT:core,sharedWoodlandSAT:I.BuildStructureSAT(shared,W,H),
            waterSAT:g.waterSAT,scenicWaterSAT:g.scenicWaterSAT,cliffSAT:g.cliffSAT,
            cliffArtSAT:g.cliffArtSAT,bridgeSAT:g.bridgeSAT};
    },

    CliffArt: function(c) {
        if(!c.Profile.SceneForests) return null;
        // Clearance masks include invisible padding above and below a cliff.
        // Only the planned tile overlay belongs in the scenic score.
        var rows=[],cliffs=c.Cliffs || [];
        for(var y=0;y<c.Height;++y) {rows[y]=[];
            for(var x=0;x<c.Width;++x) rows[y][x]=0;
        }
        for(var i=0;i<cliffs.length;++i) {
            var tiles=cliffs[i].triplets || [];
            for(var j=0;j<tiles.length;++j) {var t=tiles[j];
                if(t.x>=0 && t.y>=0 && t.x<c.Width && t.y<c.Height && (t.tileId&511)>1) rows[t.y][t.x]=1;
            }
        }
        return MapGen.Integration.BuildStructureSAT(rows,c.Width,c.Height);
    },

    Surroundings: function(c, g, rect, clearance, waterClearance) {
        // Geometry is immutable during site searches. Reuse exact clearing
        // intersections when district fitting and later lots visit a site.
        var key=[rect.minX,rect.minY,rect.maxX,rect.maxY,clearance.minX,clearance.minY,
            clearance.maxX,clearance.maxY,waterClearance || 0,c.SettlementPlan ? 1 : 0].join(":");
        var cache=g.terrainSites || (g.terrainSites={});
        if(cache[key]) return cache[key];
        // Score woodland outside the final clearing, including its softened
        // edge and forecourt. Cover erased later must not attract a building.
        var outline=MapGen.Layout.SceneClearings.Outline(c,
            {rect:rect,clearance:clearance,waterClearance:waterClearance});
        var rows=MapGen.Layout.SceneClearings.Rows(outline);
        var supported=g.woodlandCoreSAT || g.woodlandSAT;
        var margin=supported!==g.woodlandSAT ? 1 : 0, coreRows={};
        // Clearance also removes support from the next canopy cell. Merge
        // expanded scanlines so intersections never count a cell twice.
        for(var ri=0;ri<rows.length;++ri) for(var dy=-margin;dy<=margin;++dy) {
            var row=rows[ri],yy=row.y+dy,previous=coreRows[yy];
            coreRows[yy]={minX:Math.min(previous ? previous.minX : Infinity,row.minX-margin),
                maxX:Math.max(previous ? previous.maxX : -Infinity,row.maxX+margin)};
        }
        clearance={minX:Math.floor(outline.x-outline.rx),minY:Math.floor(outline.y-outline.ry),
            maxX:Math.ceil(outline.x+outline.rx),maxY:Math.ceil(outline.y+outline.ry)};
        function sum(sat,r) {
            return sat ? MapGen.Integration.StructureSATSum(sat,c.Width,c.Height,
                r.minX,r.minY,r.maxX,r.maxY) : 0;
        }
        function removed(r) {
            var count=0;
            for(var i=0;i<rows.length;++i) {
                var row=rows[i];
                if(row.y>=r.minY && row.y<=r.maxY)
                    count+=sum(g.woodlandSAT,{minX:Math.max(row.minX,r.minX),maxX:Math.min(row.maxX,r.maxX),
                        minY:row.y,maxY:row.y});
            }
            return count;
        }
        var view=this.View(c,rect),sharedLost=0;
        for(var y in coreRows) {var row=coreRows[y];
            sharedLost+=sum(g.sharedWoodlandSAT,{minX:row.minX,maxX:row.maxX,minY:Number(y),maxY:Number(y)});
        }
        function surviving(r) {
            r={minX:Math.max(r.minX,view.minX),maxX:Math.min(r.maxX,view.maxX),
                minY:Math.max(r.minY,view.minY),maxY:Math.min(r.maxY,view.maxY)};
            var count=sum(supported,r);
            for(var y=r.minY;y<=r.maxY;++y) {
                var row=coreRows[y];
                if(row) count-=sum(supported,{minX:Math.max(row.minX,r.minX),maxX:Math.min(row.maxX,r.maxX),minY:y,maxY:y});
            }
            return count;
        }
        var back = surviving({minX:view.minX,minY:view.minY,maxX:view.maxX,maxY:rect.minY-1});
        var left = surviving({minX:view.minX,minY:rect.minY,maxX:rect.minX-1,maxY:rect.maxY+2});
        var right = surviving({minX:rect.maxX+1,minY:rect.minY,maxX:view.maxX,maxY:rect.maxY+2});
        var lost = removed(clearance);
        var cover=Math.max(back,left,right), visibleWood=surviving(view);
        var woods=visibleWood<4 ? 0 : Math.min(1800,cover*100)+Math.min(400,visibleWood*20);
        var waterSAT=g.scenicWaterSAT || g.waterSAT,visibleWater=sum(waterSAT,view);
        // A corner sliver is not a coastal setting. Require water across the
        // middle of at least one screen axis, using water rather than buffers.
        var across=sum(waterSAT,{minX:view.minX,maxX:view.maxX,minY:view.minY+5,maxY:view.maxY-5});
        var along=sum(waterSAT,{minX:view.minX+7,maxX:view.maxX-7,minY:view.minY,maxY:view.maxY});
        var water=visibleWater<(g.scenicWaterSAT ? 12 : 8) ||
            g.scenicWaterSAT && Math.max(across,along)<4 ? 0 : Math.min(800,visibleWater*18);
        var visibleCliff=sum(g.cliffArtSAT || g.cliffSAT,view);
        var cliff=visibleCliff<6 ? 0 : Math.min(900,visibleCliff*25);
        // Door art faces south. Reward crossings in front of the doorway.
        var approach={minX:rect.minX-9,maxX:rect.maxX+9,minY:rect.maxY+4,maxY:rect.maxY+18};
        var bridge=Math.min(650,sum(g.bridgeSAT,approach)*45);
        return cache[key]={woods:woods,water:water,cliff:cliff,bridge:bridge,lost:lost,sharedLost:sharedLost,
            shelterSide:woods && cover ? (cover===back ? 0 : cover===left ? 1 : 2) : null};
    },

    Context: function(c, g, rect, clearance, camp, waterClearance) {
        if(!c.Profile.SceneForests) return {score:0,setting:null};
        var nearby=this.Surroundings(c,g,rect,clearance,waterClearance);
        var woods=nearby.woods,water=nearby.water,cliff=nearby.cliff,bridge=nearby.bridge;
        // Camps have different settings; all still need the same legal floor,
        // shore clearance and reachable doorway checked by BuildingSites.
        var affinity = MapGen.Random.HashTile(c.Seed,camp || 0,0,20501)%3;
        if(affinity === 1) water *= 1.5;
        if(affinity === 2) cliff *= 1.5;
        var strongest = Math.max(woods,water,cliff);
        var shelteredWater=water>0 && nearby.shelterSide!==null;
        return {score:strongest + Math.min(400,(woods+water+cliff-strongest)*0.2)+bridge-nearby.lost*40-nearby.sharedLost*180,
            woods:woods,water:water,cliff:cliff,bridge:bridge,
            shelterSide:nearby.shelterSide,
            setting:bridge ? "bridge_approach" : shelteredWater ? "sheltered_shore" :
                strongest === 0 ? "open" : strongest === woods ? "woodland_edge" :
                strongest === water ? "waterside" : "cliff_foot"};
    }
};
