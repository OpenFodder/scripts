var MapGen = MapGen || {};

// Choose a coherent landscape before reserving routes and buildings. Independent
// feature rolls otherwise converge on the same water cap and forest silhouette.
// Water-rich landscapes use the atlas's existing 32% ceiling. Navigation,
// objective, footprint and rendered-tile checks still apply to every landscape.
MapGen.ProfileCompositions = {
    grammar_jungle: [
        {
            name: "inland_trails", weight: 1,
            overrides: {
                ContinentStyles: [{name: "mainland", weight: 1}],
                RiverChance: 0, StreamChance: 0, PondChance: 0, LakeChance: 0,
                EdgeBiomeChance: 0, CliffChance: 0.65, PlateauChance: 0.45
            }
        },
        {
            name: "lake_basin", weight: 1,
            overrides: {
                ContinentStyles: [{name: "mainland", weight: 1}],
                RiverChance: 0, StreamChance: 0, PondChance: 0, LakeChance: 0,
                JungleLandform: "basin", MaxWaterCoverage: 0.26,
                EdgeBiomeChance: 0, CliffChance: 0, PlateauChance: 0,
                TreeCoverage: [0.36, 0.52]
            }
        },
        {
            name: "river_valley", weight: 1,
            overrides: {
                ContinentStyles: [{name: "mainland", weight: 1}],
                RiverChance: 1, RiversPer2048Tiles: 0, MinRiverCount: 1,
                RiverWidth: [3, 4], RiverBranchChance: 0.30,
                MaxWaterCoverage: 0.28,
                StreamChance: 0, PondChance: 0, LakeChance: 0,
                EdgeBiomeChance: 0, CliffChance: 0, PlateauChance: 0
            }
        },
        {
            name: "river_fork_cliffs", weight: 1,
            overrides: {
                ContinentStyles: [{name: "mainland", weight: 1}],
                RiverChance: 1, RiversPer2048Tiles: [0.18, 0.32], MinRiverCount: 1,
                MaxRiverCount: 2, RiverWidth: [2, 4], RiverBranchChance: 0.55,
                MaxBranchDepth: 2, CrossingCount: 2, CrossingsPer2048Tiles: undefined,
                MaxWaterCoverage: 0.30,
                StreamChance: 0, PondChance: 0, LakeChance: 0,
                EdgeBiomeChance: 0, CliffChance: 0.38, PlateauChance: 0.20
            }
        },
        {
            name: "river_island_chain", weight: 1,
            overrides: {
                ContinentStyles: [{name: "mainland", weight: 1}],
                JungleLandform: "islands",
                RiverChance: 1, RiversPer2048Tiles: [0.18, 0.32], MinRiverCount: 1,
                MaxRiverCount: 2, RiverWidth: [2, 3], RiverBranchChance: 0.35,
                MaxBranchDepth: 1, CrossingCount: 2, CrossingsPer2048Tiles: undefined,
                MaxWaterCoverage: 0.32,
                StreamChance: 0, PondChance: 0, LakeChance: 0,
                EdgeBiomeChance: 0, CliffChance: 0, PlateauChance: 0,
                TreeCoverage: [0.28, 0.44]
            }
        },
        {
            name: "coastal_woods", weight: 1,
            overrides: {
                ContinentStyles: [
                    {name: "edge", weight: 0.6, landFraction: 0.72},
                    {name: "island", weight: 0.4, landFraction: 0.74}
                ],
                RiverChance: 0, StreamChance: 0, PondChance: 0, LakeChance: 0,
                EdgeBiomeChance: 0, CliffChance: 0, PlateauChance: 0,
                MaxWaterCoverage: 0.32, TreeCoverage: [0.28, 0.42]
            }
        },
        {
            name: "island_chain", weight: 1,
            overrides: {
                ContinentStyles: [{name: "mainland", weight: 1}],
                JungleLandform: "islands",
                RiverChance: 0, StreamChance: 0, PondChance: 0, LakeChance: 0,
                EdgeBiomeChance: 0, CliffChance: 0, PlateauChance: 0,
                MaxWaterCoverage: 0.32, TreeCoverage: [0.28, 0.42]
            }
        },
        {
            name: "forest_labyrinth", weight: 1,
            overrides: {
                ContinentStyles: [{name: "mainland", weight: 1}],
                RiverChance: 0, StreamChance: 0, PondChance: 0, LakeChance: 0,
                EdgeBiomeChance: 0, CliffChance: 0, PlateauChance: 0,
                RouteArchetype: "broken_trail", JungleMazeForestFill: false,
                JungleMazeRouteTopology: false, JungleMazeDisablePathClearings: false,
                TreeCoverage: [0.42, 0.56], PerimeterCoverChance: 0.35,
                JungleLandform: "basin", MaxWaterCoverage: 0.22
            }
        }
    ]
};
