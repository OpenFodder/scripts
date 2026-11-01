var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// Author shared forecourts and shelter before terrain detail. No live tile
// stamping: existing biome smoothers provide the ground and tree boundaries.
(function(Layout) {
function ShelterCell(rect,x,y) {
    return rect.rows ? rect.rows[y-rect.minY].charAt(x-rect.minX)==="1" :
        !((x===rect.minX || x===rect.maxX) && (y===rect.minY || y===rect.maxY));
}
function ShelterDepth(rows,vertical) {
    // Corpus masks describe visible canopy. Add one cell of source depth;
    // all three compact ice outlines remain within the 51-cell allowance.
    var result=[],width=rows[0].length,height=rows.length;
    function filled(x,y) {return y>=0 && y<height && rows[y].charAt(x)==="1";}
    for(var y=0;y<height+(vertical ? 1 : 0);++y) {var line="";
        for(var x=0;x<width+(vertical ? 0 : 1);++x)
            line+=filled(x,y) || filled(x-(vertical ? 0 : 1),y-(vertical ? 1 : 0)) ? "1" : "0";
        result.push(line);
    }
    return result;
}
function ShelterSafe(c,geometry,rect) {
    var R=MapGen.Layout.Reservations, I=MapGen.Integration, E=MapGen.Intent;
    var get=MapGen.Layers.Get, m=c.IntentMap;
    function dry(x,y,margin) {
        if(x<3 || y<3 || x>=c.Width-3 || y>=c.Height-3) return false;
        for(var dy=-margin;dy<=margin;++dy) for(var dx=-margin;dx<=margin;++dx) {
            var xx=x+dx, yy=y+dy, cell=yy*c.Width+xx;
            if(geometry.water[yy][xx] || geometry.cliff[yy][xx] || R.IsWater(c,xx,yy) ||
                R.IsHardTerrain(c,xx,yy) || get(c.Layers.outcrop,xx,yy,0) ||
                (m && (m.terrain[cell]===E.Terrain.WATER || m.terrain[cell]===E.Terrain.RIVER ||
                    m.terrain[cell]===E.Terrain.RIVERBANK || m.terrain[cell]===E.Terrain.COAST ||
                    m.terrain[cell]===E.Terrain.CLIFF_BODY || m.terrain[cell]===E.Terrain.CLIFF_TOP ||
                    m.terrain[cell]===E.Terrain.OUTCROP))) return false;
        }
        return !(R.At(c,x,y)&(R.FLOOR|R.DETAIL)) && !I.IsStructureOccupiedTile(get(c.Layers.occupied,x,y,0));
    }
    for(var y=rect.minY;y<=rect.maxY;++y) for(var x=rect.minX;x<=rect.maxX;++x) {
        if(!dry(x,y,2) || R.BlocksCover(c,x,y) || get(c.Layers.keepClear,x,y,0) ||
            get(c.Layers.path,x,y,0) || I.StructureCoverProtectedPointNearby(c,x,y,4)) return false;
        if(m) {
            var cell=y*c.Width+x, existing=m.owner[cell]===E.Owner.TREE &&
                m.terrain[cell]===E.Terrain.FOREST && m.movement[cell]===E.Movement.BLOCKED;
            if(m.movement[cell]&(E.Movement.KEEP_CLEAR|E.Movement.ROUTE_PRIMARY|E.Movement.ROUTE_SECONDARY) ||
                (m.claim[cell]&~E.Claim.DECOR_ALLOWED) || (m.owner[cell]!==E.Owner.NONE && !existing)) return false;
        }
    }
    return true;
}
function StampShelter(c,rect) {
    var E=MapGen.Intent;
    for(var y=rect.minY;y<=rect.maxY;++y) for(var x=rect.minX;x<=rect.maxX;++x) {
        if(!ShelterCell(rect,x,y)) continue;
        c.Layers.blocked[x][y]=1;
        MapGen.Layers.ClaimCell(c.Layers.owner,x,y,MapGen.Layers.Owner.TREE);
        if(c.IntentMap) {
            var cell=y*c.Width+x;
            c.IntentMap.terrain[cell]=E.Terrain.FOREST;
            c.IntentMap.owner[cell]=E.Owner.TREE;
            c.IntentMap.movement[cell]=E.Movement.BLOCKED;
        }
    }
}
Layout.SettlementTerrain = {
    IceShelterOptions: function(c,geometry,site) {
        var r=site.rect,cx=Math.floor((r.minX+r.maxX)/2),cy=Math.floor((r.minY+r.maxY)/2);
        var viewX=(r.minX+r.maxX)/2,viewY=(r.minY+r.maxY)/2;
        var options=[],I=MapGen.Integration,library=MapGen.ForestSilhouettes.filter(function(s) {
            return s.source==="ice" && s.width<=9 && s.height<=9;
        });
        var variant=MapGen.Random.HashTile(c.Seed,r.minX,r.minY,24629);
        var silhouette=library[variant%library.length], rows=[];
        for(var row=0;row<silhouette.height;++row) {
            var value=silhouette.rows[variant&8 ? silhouette.height-row-1 : row];
            rows.push(variant&16 ? value.split("").reverse().join("") : value);
        }
        var rearRows=ShelterDepth(rows,true),sideRows=ShelterDepth(rows,false);
        // Ice needs depth behind its canopy. Keep complete patches within the
        // old 51-cell shelter budget, and prefer edges visible beside the site.
        for(var side=0;side<3;++side) for(var gap=5;gap<=7;++gap)
            for(var shift=-3;shift<=3;shift+=3) for(var shape=0;shape<2;++shape) {
                var sourceRows=side===0 ? rearRows : sideRows;
                var width=shape===0 ? sourceRows[0].length : 7;
                var height=shape===0 ? sourceRows.length : 7;
                var x=side===0 ? cx-Math.floor(width/2)+shift :
                    side===1 ? r.minX-gap-width+1 : r.maxX+gap;
                var y=side===0 ? r.minY-gap-height+1 : cy-Math.floor(height/2)+shift;
                var rect={minX:x,minY:y,maxX:x+width-1,maxY:y+height-1};
                if(shape===0) {rect.rows=sourceRows;rect.source=silhouette.map;}
                var visible=0;
                for(var py=rect.minY;py<=rect.maxY;++py) for(var px=rect.minX;px<=rect.maxX;++px)
                    if(ShelterCell(rect,px,py)) visible+=
                        Math.max(0,Math.min(px+0.5,viewX+10)-Math.max(px-0.5,viewX-10))*
                        Math.max(0,Math.min(py+0.5,viewY+7.5)-Math.max(py-0.5,viewY-7.5));
                if(!visible) continue;
                var existing=geometry.woodlandSAT ? I.StructureSATSum(geometry.woodlandSAT,c.Width,c.Height,
                    rect.minX-1,rect.minY-1,rect.maxX+1,rect.maxY+1) : 0;
                // Reuse complete original woodland outlines. A compact stand
                // remains a fallback where the authored silhouette cannot fit.
                options.push({rect:rect,score:visible*25+existing*8-gap*12-shift*shift-shape*150+
                    (side===site.terrainShelterSide ? 100 : 0),order:MapGen.Random.HashTile(c.Seed,x,y,24623)});
            }
        options.sort(function(a,b){return b.score-a.score || a.order-b.order ||
            a.rect.minY-b.rect.minY || a.rect.minX-b.rect.minX;});
        return options.map(function(option){return option.rect;});
    },

    Build: function(c, geometry) {
        var plan = c.SettlementPlan;
        if(!plan) return;
        // Site searches are finished; retain terrain geometry, not their cache.
        delete geometry.terrainSites;
        c.SettlementTerrainGeometry = geometry;
        var R = MapGen.Layout.Reservations, I = MapGen.Integration, E = MapGen.Intent;
        var entries = c.GameplayPlan.entries, get = MapGen.Layers.Get;
        function dry(x, y, margin) {
            if(x < 3 || y < 3 || x >= c.Width - 3 || y >= c.Height - 3) return false;
            for(var dy = -margin; dy <= margin; ++dy) for(var dx = -margin; dx <= margin; ++dx) {
                if(geometry.water[y + dy][x + dx] || geometry.cliff[y + dy][x + dx] ||
                    get(c.Layers.crossing,x + dx,y + dy,0) || get(c.Layers.causeway,x + dx,y + dy,0)) return false;
            }
            return !(R.At(c,x,y) & (R.FLOOR | R.DETAIL)) && !I.IsStructureOccupiedTile(get(c.Layers.occupied,x,y,0));
        }
        function yard(rect) {
            for(var y = rect.minY; y <= rect.maxY; ++y) for(var x = rect.minX; x <= rect.maxX; ++x)
                if(!dry(x,y,1)) return false;
            R.Rect(c,rect,R.CLEAR | R.ROUTE);
            for(var y = rect.minY; y <= rect.maxY; ++y) for(var x = rect.minX; x <= rect.maxX; ++x)
                c.Layers.path[x][y] = 1;
            return true;
        }
        function lane(a,b,verticalFirst,sideX) {
            var x = a.x, y = a.y, points = [{x:x,y:y}];
            var turns = sideX !== undefined ? [{x:sideX,y:a.y},{x:sideX,y:b.y},b] :
                [verticalFirst ? {x:a.x,y:b.y} : {x:b.x,y:a.y},b];
            for(var t = 0; t < turns.length; ++t) {
                var turn = turns[t];
                while((x !== turn.x || y !== turn.y) && points.length < 64) {
                    if(x !== turn.x) x += x < turn.x ? 1 : -1;
                    else y += y < turn.y ? 1 : -1;
                    points.push({x:x,y:y});
                }
                if(x !== turn.x || y !== turn.y) return null;
            }
            for(var i = 0; i < points.length; ++i) {
                var p = points[i];
                for(var dy = -1; dy <= 1; ++dy) for(var dx = -1; dx <= 1; ++dx)
                    if(!dry(p.x + dx,p.y + dy,1)) return null;
            }
            for(var j = 0; j < points.length; ++j) {
                var p = points[j];
                yard({minX:p.x-1,minY:p.y-1,maxX:p.x+1,maxY:p.y+1});
            }
            c.Paths.push({role:"settlement_lane", radius:1, points:points});
            return points;
        }
        function shelter(rect) {
            if(!ShelterSafe(c,geometry,rect)) return false;
            StampShelter(c,rect);
            return true;
        }
        for(var i = 0; i < plan.camps.length; ++i) {
            var camp = plan.camps[i], sites = [], front = [], left = c.Width, right = 0;
            for(var e = 0; e < entries.length; ++e) {
                var site = entries[e].candidate;
                if(site.settlementLot && site.settlementLot.camp === camp.id) {
                    sites.push(site);
                    left = Math.min(left,site.rect.minX);
                    right = Math.max(right,site.rect.maxX);
                }
            }
            for(var s = 0; s < sites.length; ++s) {
                var site = sites[s], r = site.rect, p = site.accessPoint;
                var visibleCourt = c.Profile.SceneForests && c.Profile.TerrainType === Terrain.Types.Jungle;
                var pad = visibleCourt ? 3 : 2, depth = visibleCourt ? 7 : 5;
                var forecourt = site.fenceCells ?
                    {minX:r.minX-1,maxX:r.maxX+1,minY:r.maxY+1,maxY:r.maxY+2} :
                    {minX:r.minX-pad,maxX:r.maxX+pad,minY:r.maxY+1,maxY:r.maxY+depth};
                if(!p || !yard(forecourt)) continue;
                camp.yards.push(forecourt);
                front.push({x:p.x,y:r.maxY+3});
            }
            for(var f = 1; f < front.length; ++f) {
                var joined = lane(front[f-1],front[f],false) || lane(front[f-1],front[f],true) ||
                    lane(front[f-1],front[f],false,left-3) || lane(front[f-1],front[f],false,right+3);
                if(joined) camp.lanes.push(joined);
            }
            // A solid rear or side grove frames the clearing. Try a bounded
            // set of complete patches; never chop a grove across protected land.
            camp.shelters = [];
            for(var s = 0; s < sites.length; ++s) {
                var r = sites[s].rect, cx = Math.floor((r.minX+r.maxX)/2), cy = Math.floor((r.minY+r.maxY)/2);
                var options = [
                    {minX:cx-5,maxX:cx+5,minY:r.minY-8,maxY:r.minY-4},
                    {minX:r.minX-8,maxX:r.minX-4,minY:cy-4,maxY:cy+4},
                    {minX:r.maxX+4,maxX:r.maxX+8,minY:cy-4,maxY:cy+4}
                ];
                // Larger dry building buffers can consume the close options.
                // Smaller stands outside that buffer still frame the same site.
                if(c.Profile.SceneForests) options=options.concat([
                    {minX:cx-4,maxX:cx+4,minY:r.minY-11,maxY:r.minY-7},
                    {minX:r.minX-11,maxX:r.minX-7,minY:cy-3,maxY:cy+3},
                    {minX:r.maxX+7,maxX:r.maxX+11,minY:cy-3,maxY:cy+3}
                ]);
                var framedIce=c.Profile.SceneForests && c.Profile.TerrainType===Terrain.Types.Ice;
                if(framedIce) options=this.IceShelterOptions(c,geometry,sites[s]);
                var offset = framedIce ? 0 : MapGen.Random.HashTile(c.Seed,cx,cy,24601)%options.length;
                var side=sites[s].terrainShelterSide;
                if(!framedIce && c.Profile.SceneForests && side !== undefined && side !== null) {
                    // Extend surviving cover on the selected site's wooded
                    // side, keeping the existing one-patch limit and checks.
                    var ordered=[];
                    for(var rank=0;rank<3;++rank) {
                        var index=(side+rank)%3;
                        ordered.push(options[index]);
                        if(options[index+3]) ordered.push(options[index+3]);
                    }
                    options=ordered; offset=0;
                }
                for(var k = 0; k < options.length; ++k) {
                    var option = options[(k+offset)%options.length];
                    if(shelter(option)) {
                        camp.shelters.push(option);
                        if(!camp.shelter) camp.shelter = option;
                        break;
                    }
                }
            }
        }
    },
    // Tree cover can be repainted by biome smoothers after settlement planning.
    // Revalidate the entire saved patch against the current map before restoring it.
    ApplyShelters: function(c) {
        var plan = c.SettlementPlan, geometry = c.SettlementTerrainGeometry;
        if(!plan || !geometry) return 0;
        var restored = 0;
        for(var i=0;i<plan.camps.length;++i) {
            var camp=plan.camps[i], patches=camp.shelters && camp.shelters.length ? camp.shelters : [camp.shelter];
            for(var j=0;j<patches.length;++j) {
                var rect=patches[j];
                if(rect && ShelterSafe(c,geometry,rect)) {
                    StampShelter(c,rect);
                    ++restored;
                }
            }
        }
        return restored;
    }
};
})(MapGen.Layout);
