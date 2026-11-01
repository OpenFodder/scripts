var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};
MapGen.Terrain.Smoothing.Jungle = MapGen.Terrain.Smoothing.Jungle || {};

// The first sub1 pass sees only north/west tiles. Reconcile inland banks with
// all four finished neighbours, retaining terrain classes and protected cells.
MapGen.Terrain.Smoothing.Jungle.RefineInteriorWaterJoins = function(c,chars,tiles) {
    var live=c.GrammarLiveTerrain,bodies=live && live.interiorWaterBodies;
    if(!c.Profile.SceneForests || !bodies || !bodies.length) return 0;
    var data=this.Sub1EdgeData(),group=data && data.river;
    if(!group) return 0;
    var lookup=this.Sub1RecordLookup(data),get=MapGen.Layers.Get,cells=[],seen={};
    var grass={center:"darkgrass",edges:{N:"GGGGGGGGGGGGGGGG",E:"GGGGGGGGGGGGGGGG",
        S:"GGGGGGGGGGGGGGGG",W:"GGGGGGGGGGGGGGGG"}};
    function recordFor(tile) {return tile===123 || tile===124 ? grass : lookup[String(tile)];}
    var directions=[[0,-1,"N","S"],[1,0,"E","W"],[0,1,"S","N"],[-1,0,"W","E"]];
    for(var b=0;b<bodies.length;++b) {
        var bounds=bodies[b].bounds;
        for(var y=Math.max(1,bounds.minY);y<=Math.min(c.Height-2,bounds.maxY);++y)
            for(var x=Math.max(1,bounds.minX);x<=Math.min(c.Width-2,bounds.maxX);++x) {
                var at=y*c.Width+x,ch=chars[x][y];
                if(seen[at] || cells.length>=512 || ch!==this.Chars.water && ch!==this.Chars.ground ||
                    get(c.Layers.path,x,y,0) || get(c.Layers.keepClear,x,y,0) || get(c.Layers.crossing,x,y,0) ||
                    get(c.Layers.causeway,x,y,0) || get(c.Layers.occupied,x,y,0) || get(c.Layers.structureGround,x,y,0) ||
                    !this.Sub1ShouldApplyPixelEdge(c,chars,x,y,"river",ch)) continue;
                seen[at]=true;
                var cls=this.Sub1ClassForChar("river",ch),source=(group.byCenter[cls] || []).slice(0),domain=[];
                if(cls==="darkgrass") source.push(123,124);
                for(var i=0;i<source.length;++i) {
                    var tid=source[i],record=recordFor(tid),fits=true;
                    if(this.Sub1RejectCandidate(c,"river",tid,cls,chars,x,y)) continue;
                    for(var d=0;d<4;++d) {
                        var dir=directions[d],neighbour=this.Sub1ClassForChar("river",chars[x+dir[0]][y+dir[1]]);
                        if(!this.Sub1InteriorRiverEdgeFits(c,chars,x,y,record,dir[2],cls,neighbour)) {
                            // A water-centred tile can contain the entire bank.
                            // Its grass-facing neighbour then needs plain land,
                            // not a second shoreline pointing into that bank.
                            var adjacent=recordFor(get(tiles,x+dir[0],y+dir[1],-1));
                            var edge=adjacent && adjacent.edges[dir[3]],ground=0;
                            if(edge) for(var pixel=0;pixel<16;++pixel)
                                if(edge.charAt(pixel)==="G" || edge.charAt(pixel)==="L") ++ground;
                            if((tid!==123 && tid!==124) || neighbour!=="water" || ground<14) {fits=false;break;}
                        }
                    }
                    if(fits) domain.push(tid);
                }
                if(domain.length) cells.push({x:x,y:y,domain:domain});
            }
    }
    var cache={},self=this,changed=0;
    function join(a,b,direction) {
        var key=a+":"+b+":"+direction,previous=cache[key];
        if(previous!==undefined) return previous;
        var ar=recordFor(a),br=recordFor(b),dir=directions[direction];
        if(!ar || !br) return 0;
        var left=ar.edges[dir[2]],right=br.edges[dir[3]],cost=0;
        for(var p=0;p<16;++p) {
            var ca=left.charAt(p),cb=right.charAt(p);
            if(ca==="L") ca="G"; if(cb==="L") cb="G";
            if(ca!==cb && ca!=="." && cb!==".") cost+=100;
        }
        if(ar.visualEdges && br.visualEdges)
            cost-=self.Sub1ScoreVisualEdge(ar.visualEdges[dir[2]],br.visualEdges[dir[3]]);
        cache[key]=cost;return cost;
    }
    function cost(tile,cell) {
        var total=0;
        for(var d=0;d<4;++d) {
            var dir=directions[d];
            total+=join(tile,get(tiles,cell.x+dir[0],cell.y+dir[1],-1),d);
        }
        return total;
    }
    for(var pass=0;pass<4;++pass) {
        var edits=0;
        for(var i=0;i<cells.length;++i) {
            var cell=cells[pass%2 ? cells.length-1-i : i],current=tiles[cell.x][cell.y];
            var best=current,score=cost(current,cell);
            for(var d=0;d<cell.domain.length;++d) {
                var candidate=cell.domain[d],value=cost(candidate,cell);
                if(value<score) {best=candidate;score=value;}
            }
            if(best!==current) {tiles[cell.x][cell.y]=best;++edits;++changed;}
        }
        if(!edits) break;
    }
    return changed;
};
