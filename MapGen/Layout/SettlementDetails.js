var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// Small, complete architectural stamps, planned before cover and committed
// before actors. Ice rails/corners/caps are verified in Amiga mapm11/15/16.
// The original 364..366 "gate" is solid, so entrances use actual open ground.
MapGen.Layout.SettlementDetails = {
    Fence: function(r, doorX, side, openFront) {
        var cells = {}, left = r.minX, right = r.maxX, top = r.minY, bottom = r.maxY;
        function put(x,y,tile) { cells[x+","+y] = {x:x,y:y,tile:tile}; }
        for(var x = left+1; x < right; ++x) { put(x,top,304); put(x,bottom,304); }
        for(var y = top+1; y < bottom; ++y) { put(left,y,324); put(right,y,324); }
        put(left,top,325); put(right,top,326); put(left,bottom,345); put(right,bottom,346);
        var gate = openFront ? left+2 : Math.max(left+2, Math.min(right-5,doorX-1));
        var gateEnd = openFront ? right-2 : gate+3;
        for(var gx = gate; gx <= gateEnd; ++gx) delete cells[gx+","+bottom];
        put(gate-1,bottom,306); put(gateEnd+1,bottom,305);
        if(side) {
            var sx = side < 0 ? left : right, sy = top+2;
            for(var gy = sy; gy < bottom-2; ++gy) delete cells[sx+","+gy];
            // Side openings turn outward into authored horizontal end caps.
            put(sx,sy-1,side < 0 ? 346 : 345);
            put(sx+side,sy-1,side < 0 ? 305 : 306);
            put(sx,bottom-2,side < 0 ? 326 : 325);
            put(sx+side,bottom-2,side < 0 ? 305 : 306);
        }
        var out = [];
        for(var key in cells) if(cells.hasOwnProperty(key)) out.push(cells[key]);
        return out;
    },

    FindFence: function(c, geometry, site) {
        var R = MapGen.Layout.Reservations, E = MapGen.Intent, get = MapGen.Layers.Get;
        var r = site.rect, doorX = site.accessPoint ? site.accessPoint.x : r.minX+1;
        for(var variant = 0; variant < 12; ++variant) {
            var side = [0,-1,1][variant%3], pad = variant%6 < 3 ? 3 : 2, open = variant >= 6;
            var bounds = {minX:r.minX-pad,maxX:r.maxX+pad,minY:r.minY-3,maxY:r.maxY+(open ? 2 : 4)};
            // A compound must contain its building. If an enclosing fence
            // cannot fit, leave the site open instead of inventing a side yard.
            var cells = this.Fence(bounds,doorX,side,open), fits = true;
            for(var i = 0; i < cells.length && fits; ++i) {
                var p = cells[i];
                if(p.x < 3 || p.y < 3 || p.x >= c.Width-3 || p.y >= c.Height-3) { fits = false; break; }
                for(var dy = -1; dy <= 1 && fits; ++dy) for(var dx = -1; dx <= 1; ++dx) {
                    var x = p.x+dx, y = p.y+dy, flags = R.At(c,x,y), cell = y*c.Width+x, m = c.IntentMap;
                    if(geometry.water[y][x] || geometry.cliff[y][x] || flags & (R.FLOOR | R.ROUTE | R.DETAIL) ||
                        get(c.Layers.crossing,x,y,0) || get(c.Layers.causeway,x,y,0) ||
                        !c.Profile.SceneForests && get(c.Layers.blocked,x,y,0) ||
                        MapGen.Integration.IsStructureOccupiedTile(get(c.Layers.occupied,x,y,0)) ||
                        m && (m.claim[cell] & (E.Claim.SPAWN_SAFE | E.Claim.OBJECTIVE | E.Claim.STRUCT_WALL) ||
                            dx === 0 && dy === 0 && m.movement[cell] & (E.Movement.ROUTE_PRIMARY | E.Movement.ROUTE_SECONDARY))) {
                        fits = false; break;
                    }
                }
                // Keep the proposed doorway route and its front court intact.
                if(p.x >= r.minX-1 && p.x <= r.maxX+1 && p.y >= r.maxY && p.y <= r.maxY+3) fits = false;
                var path = site.accessPath || [];
                for(var a = 0; a < path.length && fits; ++a)
                    if(Math.abs(p.x-path[a].x) <= 1 && Math.abs(p.y-path[a].y) <= 1) fits = false;
                if(MapGen.Integration.StructureCoverProtectedPointNearby(c,p.x,p.y,2)) fits = false;
            }
            if(fits) return cells;
        }
        return null;
    },

    Plan: function(c) {
        c.SettlementDetails = null;
        if(!c.SettlementPlan || c.Profile.TerrainType !== Terrain.Types.Ice) return;
        var stamps = [], entries = c.GameplayPlan.entries;
        for(var i = 0; i < entries.length; ++i) {
            var site = entries[i].candidate;
            if(site.fenceCells) stamps.push({kind:"fenced_yard",lot:site.settlementLot.id,
                cells:site.fenceCells,committed:false});
        }
        c.SettlementDetails = {stamps:stamps,tiles:0};
    },

    Commit: function(c) {
        var details = c.SettlementDetails;
        if(!details) return;
        var ice = c.Profile.TerrainType === Terrain.Types.Ice, S = MapGen.Terrain.SurfaceDetail;
        var ground = ice ? S.IceGround : S.Ground, get = MapGen.Layers.Get, E = MapGen.Intent;
        for(var i = 0; i < details.stamps.length; ++i) {
            var stamp = details.stamps[i], fits = true;
            if(stamp.committed) continue;
            for(var j = 0; j < stamp.cells.length; ++j) {
                var p = stamp.cells[j];
                if(ground.indexOf(c.Map.TileGet(p.x,p.y) & 511) < 0 ||
                    get(c.Layers.occupied,p.x,p.y,0) !== "settlement_detail_plan" &&
                        MapGen.Integration.IsStructureOccupiedTile(get(c.Layers.occupied,p.x,p.y,0))) {
                    stamp.rejected = {tile:c.Map.TileGet(p.x,p.y),occupied:get(c.Layers.occupied,p.x,p.y,0)};
                    fits = false; break;
                }
            }
            if(!fits) continue;
            stamp.committed = true;
            details.tiles += stamp.cells.length;
            for(var k = 0; k < stamp.cells.length; ++k) {
                var p = stamp.cells[k], cell = p.y*c.Width+p.x;
                c.Map.TileSet(p.x,p.y,p.tile);
                c.RenderedMap.Tiles[p.x][p.y] = p.tile;
                c.Layers.occupied[p.x][p.y] = "settlement_detail";
                c.Layers.owner[p.x][p.y] = MapGen.Layers.Owner.STRUCTURE;
                if(c.IntentMap) {
                    c.IntentMap.terrain[cell] = E.Terrain.LAND;
                    c.IntentMap.movement[cell] = E.Movement.BLOCKED;
                    c.IntentMap.claim[cell] = E.Claim.STRUCT_WALL | E.Claim.RESERVED;
                    c.IntentMap.owner[cell] = E.Owner.STRUCTURE;
                }
            }
        }
    },

    Repaint: function(c) {
        var stamps = c.SettlementDetails ? c.SettlementDetails.stamps : [];
        for(var i = 0; i < stamps.length; ++i) if(stamps[i].committed)
            for(var j = 0; j < stamps[i].cells.length; ++j) {
                var p = stamps[i].cells[j];
                c.RenderedMap.Tiles[p.x][p.y] = p.tile;
            }
    }
};
