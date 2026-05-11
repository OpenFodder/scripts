/**
 * OpenFodder
 *
 * Unified reachability facade. Gen-time and runtime each have their own
 * pathfinder (different data, different lifetimes), but every "can X reach Y?"
 * question in the codebase routes through one of these two methods.
 *
 *   PlanReachable  — gen-time, layer-backed (MapGen.Validate.CanReach BFS)
 *   VerifyReachable — runtime, engine-backed (Map.calculatePathBetweenPositions)
 *
 * Common/ loads before MapGen/, so PlanReachable defers MapGen lookup until
 * call time. Either side is safe to call when the other isn't loaded.
 */

var Reachability = {

    PlanReachable: function(pContext, pFrom, pTo) {
        if(!pContext || !pFrom || !pTo)
            return false;
        if(typeof MapGen === "undefined" || !MapGen.Validate || !MapGen.Validate.CanReach)
            return false;

        return MapGen.Validate.CanReach(pContext, pFrom, pTo);
    },

    VerifyReachable: function(pSpriteType, pFrom, pTo) {
        if(!pFrom || !pTo)
            return false;
        if(typeof Map === "undefined" || !Map.calculatePathBetweenPositions)
            return false;

        var path = Map.calculatePathBetweenPositions(pSpriteType, pFrom, pTo);
        return !!(path && path.length > 0);
    }
};
