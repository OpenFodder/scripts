var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};

MapGen.Terrain.Smoothing.IceData = {
    treeGroundBoundary: {
        upperSide: [24],
        middleSide: [63],
        lowerSide: [45],
        upperCorner: [44],
        rightBaseEast: [45],
        lowerBase: [13, 45],
        fallback: [13, 25, 44, 45, 63]
    }
};
