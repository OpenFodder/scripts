var MapGen = MapGen || {};
MapGen.Features = MapGen.Features || {};

// Fit a complete cliff through joins observed in the original Jungle maps.
// The small dynamic program keeps the course legal all the way to both edges;
// a greedy strip walk can reach a height from which no legal continuation fits.
MapGen.Features.JungleCliffCourse = {
    Plan: function(c, cliff, baseTop) {
        var data = MapGen.JungleCliffGrammar, p = c.Profile;
        if(!p.CurvedJungleCliffs || p.TerrainType !== Terrain.Types.Jungle ||
            p.CliffBridgeTransit || !data || MapGen.Context.IsMultiplayer(c)) return null;
        var W = c.Width, H = c.Height, height = cliff.StampHeight;
        var amplitude = Math.min(10,Math.max(3,Math.round(H*0.12)));
        var low = Math.max(1,baseTop-amplitude), high = Math.min(H-height-3,baseTop+amplitude);
        var anchors = c.Anchors || {};
        for(var key in anchors) if(anchors.hasOwnProperty(key) && anchors[key]) {
            var y = anchors[key].y;
            if(y < baseTop) low = Math.max(low,y+4);
            else high = Math.min(high,y-height-4);
        }
        if(high-low < 2) return null;
        var hash = MapGen.Random.HashTile, mode = hash(c.Seed,17,31,20401)%4;
        // Helicopter terraces deliberately split an abstract ground route;
        // use the same transit policy as the final cliff stamper.
        var fitOptions = p.HelicopterTransit === true ? {allowRouteTransit:true} : null;
        var names = ["rising","falling","ridge","valley"], rows = high-low+1;
        var strips = data.strips.length, states = rows*strips, edges = [];
        for(var s = 0; s < strips; ++s) edges[s] = [];
        for(var e = 0; e < data.edges.length; ++e) edges[data.edges[e].from].push(data.edges[e]);
        var parents = [], previous = null;
        for(var x = 0; x < W; ++x) {
            var t = x/Math.max(1,W-1), curve = mode === 0 ? 1-t : mode === 1 ? t :
                mode === 2 ? Math.abs(t*2-1) : 1-Math.abs(t*2-1);
            var desired = low+(high-low)*curve, fit = [], costs = new Float64Array(states);
            var from = new Int32Array(states);
            for(var state = 0; state < states; ++state) { costs[state] = Infinity; from[state] = -1; }
            for(var row = 0; row < rows; ++row) {
                var top = low+row;
                fit[row] = MapGen.Features.PlateauCliffs.ColumnFits(c,x,top-1,height+3,cliff,fitOptions);
                for(var yy = top-1; fit[row] && yy <= top+height+1; ++yy)
                    if(MapGen.Layers.Get(c.Layers.owner,x,yy,0) >= MapGen.Layers.Owner.STRUCTURE) fit[row] = false;
            }
            if(!previous) {
                for(var row = 0; row < rows; ++row) if(fit[row])
                    for(var s = 0; s < strips; ++s)
                        costs[row*strips+s] = Math.abs(low+row-desired)*10+hash(c.Seed,x,row*strips+s,20407)%1000/1000;
            } else {
                for(var state = 0; state < states; ++state) {
                    if(previous[state] === Infinity) continue;
                    var next = edges[state%strips], row = Math.floor(state/strips);
                    for(var n = 0; n < next.length; ++n) {
                        var edge = next[n], nr = row+edge.dy;
                        if(nr < 0 || nr >= rows || !fit[nr]) continue;
                        var index = nr*strips+edge.to;
                        var score = previous[state]+Math.abs(low+nr-desired)*10+
                            hash(c.Seed,x,index,20407)%1000/1000;
                        if(score < costs[index]) { costs[index] = score; from[index] = state; }
                    }
                }
            }
            parents.push(from); previous = costs;
        }
        var best = -1;
        for(var state = 0; state < states; ++state)
            if(previous[state] !== Infinity && (best < 0 || previous[state] < previous[best])) best = state;
        if(best < 0) return null;
        var columns = [], min = H, max = 0;
        for(var x = W-1; x >= 0; --x) {
            var top = low+Math.floor(best/strips);
            columns[x] = {x:x,topY:top,stripIndex:best%strips};
            min = Math.min(min,top); max = Math.max(max,top);
            best = parents[x][best];
        }
        return max-min < 2 ? null : {shape:names[mode],minY:min,maxY:max,columns:columns};
    }
};
