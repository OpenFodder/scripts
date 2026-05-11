var MapGen = MapGen || {};
MapGen.Integration = MapGen.Integration || {};

// Standable ground may be on an isolated pocket. Validate the actual runtime
// position before spawning; relocate locally without cutting new maze corridors.
MapGen.Integration.SnapGroundActorToReachable = function(c, x, y, offsetX, offsetY) {
    var self = this, probes = 0;
    function acceptable(tx, ty) {
        if(!self.GroundActorCellStandable(c, tx, ty) ||
            (MapGen.Layout.Reservations.At(c, tx, ty) & MapGen.Layout.Reservations.FLOOR)) return false;
        if(++probes > 64) return false;
        var position = self.TileToPosition({x: tx, y: ty});
        position.x = tx * 16 + offsetX;
        position.y = ty * 16 + offsetY;
        return !Session.HumanPosition || Reachability.VerifyReachable(SpriteTypes.Player,
            Session.HumanPosition, position);
    }
    if(acceptable(x, y)) return {x: x, y: y};
    for(var r = 1; r <= 8 && probes < 64; ++r)
        for(var dy = -r; dy <= r && probes < 64; ++dy)
            for(var dx = -r; dx <= r && probes < 64; ++dx) {
                if(Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                if(acceptable(x + dx, y + dy)) {
                    c.ActorRelocations = (c.ActorRelocations || 0) + 1;
                    return {x: x + dx, y: y + dy};
                }
            }
    return null;
};
