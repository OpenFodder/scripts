var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

// Resolve semantic placement disconnections before paying for atlas rendering.
// Final validation still catches obstructions introduced by smoothing.
MapGen.Layout.RepairBeforeRender = function(c, rules) {
    if(c.EarlyRejection || !rules || !rules.RequireConnectivityNodes ||
        !c.ConnectivityNodes || !c.ConnectivityNodes.length ||
        MapGen.Context.IsMultiplayer(c) ||
        MapGen.Layout.GameplayPlan.Policy(c) === "maze") return;
    var report = MapGen.Validate.CreateReport();
    c._nativeWalkability = null;
    MapGen.Validate.AllConnectivityNodesReachable(c, report, rules);
    if(!report.ok && !c.PlacementConnectionRepair &&
        !MapGen.Layout.RepairPlacementConnections(c, report)) {
        // Smoothing can change the available repair path. A failed semantic
        // probe must leave the later repair opportunity available.
        c.PlacementConnectionRepair = null;
    }
    c._nativeWalkability = null;
};

// A bounded 0/1 search finds the fewest forest cells needed to reconnect a
// placement pocket. Existing walkable ground costs zero; hard terrain is closed.
MapGen.Layout.RepairPlacementConnections = function(c, report) {
    var previous = c.PlacementConnectionRepair;
    if((previous && (!c.RenderedMap || previous.afterRender || previous.cells >= 12)) || MapGen.Context.IsMultiplayer(c) ||
        MapGen.Layout.GameplayPlan.Policy(c) === "maze" ||
        !MapGen.Repair.HasKey(report.reasons, "connectivity_node_unreachable")) return false;
    var V = MapGen.Validate, L = MapGen.Layers, R = MapGen.Layout.Reservations;
    var nodes = c.ConnectivityNodes || [], root = MapGen.Connectivity.RootConnectivityNode(c, nodes);
    if(!root) return false;
    var W = c.Width, H = c.Height, N = W * H, start = root.access || root.point;
    var cost = new Int8Array(N), distance = new Int16Array(N), pred = new Int32Array(N), buckets = [];
    var limit = 12, targets = [], stats = previous || {kind: "placement_connection", cells: 0, connected: 0};
    // A partial semantic repair can leave a pocket that becomes repairable
    // after smoothing. Allow one final search within the original cell budget.
    var initialCells = stats.cells, searchLimit = limit - initialCells;
    stats.afterRender = !!c.RenderedMap;
    c.PlacementConnectionRepair = stats;
    c.LocalRepairs = c.LocalRepairs || [];
    if(!previous) c.LocalRepairs.push(stats);
    for(var d = 0; d <= searchLimit; ++d) buckets[d] = [];
    for(var i = 0; i < N; ++i) {
        var x = i % W, y = Math.floor(i / W);
        distance[i] = 32767;
        pred[i] = -1;
        cost[i] = -1;
        if(R.At(c, x, y) & R.FLOOR) continue;
        if(V.OccupiedBlocksRoute(L.Get(c.Layers.occupied, x, y, 0)) ||
            (R.IsHardTerrain(c, x, y) && L.Get(c.Layers.blocked, x, y, 0))) continue;
        if(previous ? V.FinalRouteCharWalkable(c, x, y) : MapGen.Metrics.IsWalkable(c, x, y)) cost[i] = 0;
        else if(MapGen.Metrics.IsTreeBlocked(c, x, y) && !R.IsWater(c, x, y) && !R.IsHardTerrain(c, x, y) &&
            !L.Get(c.Layers.occupied, x, y, 0) &&
            MapGen.Connectivity.CorridorCanStamp(c, x, y, false)) cost[i] = 1;
    }
    var first = start.y * W + start.x;
    if(cost[first] !== 0) return false;
    distance[first] = 0;
    buckets[0].push(first);
    for(var level = 0; level <= searchLimit; ++level) {
        var queue = buckets[level];
        for(var head = 0; head < queue.length; ++head) {
            var cell = queue[head];
            if(distance[cell] !== level) continue;
            var cx = cell % W, cy = Math.floor(cell / W), neighbours = [cell + 1, cell + W, cell - 1, cell - W];
            for(var n = 0; n < 4; ++n) {
                var next = neighbours[n], nx = next % W, ny = Math.floor(next / W);
                if(next < 0 || next >= N || Math.abs(nx - cx) + Math.abs(ny - cy) !== 1 || cost[next] < 0) continue;
                var nd = level + cost[next];
                if(nd > searchLimit || nd >= distance[next]) continue;
                distance[next] = nd;
                pred[next] = cell;
                buckets[nd].push(next);
            }
        }
    }
    for(var ni = 0; ni < nodes.length; ++ni) {
        var point = nodes[ni].access || nodes[ni].point;
        if(!nodes[ni].mustReach || !point) continue;
        var end = point.y * W + point.x;
        if(distance[end] <= 0 || distance[end] > searchLimit) continue;
        targets.push(end);
    }
    var cleared = {};
    for(var ti = 0; ti < targets.length && stats.cells < limit; ++ti) {
        var cursor = targets[ti], route = [], additions = 0;
        while(cursor !== first && cursor >= 0 && route.length < N) {
            route.push({x: cursor % W, y: Math.floor(cursor / W)});
            if(cost[cursor] === 1 && !cleared[cursor]) ++additions;
            cursor = pred[cursor];
        }
        if(cursor !== first || stats.cells + additions > limit) continue;
        for(var pi = 0; pi < route.length; ++pi) {
            var p = route[pi], key = p.y * W + p.x;
            if(cost[key] === 1 && !cleared[key]) { cleared[key] = true; ++stats.cells; }
            R.Rect(c, {minX: p.x, minY: p.y, maxX: p.x, maxY: p.y}, R.CLEAR | R.ROUTE);
            L.Set(c.Layers.path, p.x, p.y, 1);
        }
        c.Paths.push({role: "repair_placement", radius: 0, points: route});
        ++stats.connected;
    }
    if(stats.cells > initialCells) { R.Apply(c); R.AuthorIntent(c); }
    return stats.cells > initialCells;
};
