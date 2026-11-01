var MapGen = MapGen || {};
MapGen.Intent = MapGen.Intent || {};

// Rotate semantic forest intent before rendering. Tile art is always selected
// in the final orientation; this helper is never used for cliff or beach art.
MapGen.Intent.AuthorForestAxis = function(author, plan, map, rngs, c) {
    var p = c.Profile || {}, style = p.GrammarIceLayoutStyle || "";
    var vertical = p.RegionalComposition && p.Name === "grammar_ice" &&
        map.width >= 50 && map.height >= 56 &&
        (style === "ice_tree_maze" || style === "ice_neck_route") &&
        MapGen.Random.HashTile(c.Seed, 97, 53, 19613) % 2 === 0;
    if(!vertical) return author(plan, map, rngs, c);
    var I = MapGen.Intent, source = I.Map.Create(map.height, map.width), local = {};
    for(var key in c) if(c.hasOwnProperty(key)) local[key] = c[key];
    local.Width = source.width; local.Height = source.height;
    local.IntentMap = source;
    local.IntentStyleContract = {};
    var result = author(plan, source, rngs, local);
    if(!result.ok) return result;
    var planes = ["terrain", "movement", "claim", "owner", "_terrainPriority",
        "_movementPriority", "_claimPriority", "_ownerPriority"];
    for(var pIndex = 0; pIndex < planes.length; ++pIndex) {
        var name = planes[pIndex];
        for(var y = 0; y < source.height; ++y) for(var x = 0; x < source.width; ++x)
            map[name][x * map.width + y] = source[name][y * source.width + x];
    }
    function point(pt) { return {x: pt.y, y: pt.x}; }
    map.anchors = {};
    for(var anchor in source.anchors) if(source.anchors.hasOwnProperty(anchor))
        map.anchors[anchor] = point(source.anchors[anchor]);
    map.regions = source.regions;
    for(var r = 0; r < map.regions.length; ++r)
        if(map.regions[r].at) map.regions[r].at = point(map.regions[r].at);
    // The forest author emits route flags and tactical points, not explicit
    // objects/routes. Fail loudly if that interface changes later.
    if(source.routes.length || source.objects.length)
        throw new Error("Forest axis author emitted unsupported route/object geometry");
    c.Continent = local.Continent;
    if(c.Continent) {
        var seedX = c.Continent.seedX;
        c.Continent.seedX = c.Continent.seedY; c.Continent.seedY = seedX;
    }
    c.IntentStyleContract = local.IntentStyleContract;
    c.IntentStyleContract.routeAxis = "vertical";
    var gates = c.IntentStyleContract.gates || [];
    for(var g = 0; g < gates.length; ++g) gates[g].transposed = true;
    return result;
};
