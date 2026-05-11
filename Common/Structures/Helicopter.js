// Helicopter pickup structure for jungle cliff transit (T0.8a).
//
// Jungle cliff stamps are pure barriers — no walkway in the art (unlike ice
// stairs or desert bridge). Original mission mapm20 solves this with a
// helicopter that flies the squad over the cliff. Random jungle cliffs need
// the same coupling: a helicopter on the player-accessible side of the band,
// reachable from team spawn over walkable terrain that does NOT cross the
// cliff.
//
// Tile-stamp data is not yet authored in TileGroups.json — Variants is empty
// for now. The CliffHelicopter feature pass records the placement point in
// pContext.Placements.pickups regardless, and the integration pass spawns a
// live human helicopter there even before the artwork lands. Once the stamp is tagged,
// drop the triplet list into Variants[0] and CliffHelicopter.OverlayTiles
// will start writing it into the rendered tile grid.

Structures.Jungle.Helicopter = {
    StructFindTile: [
        Terrain.Jungle.Mainland.concat(Terrain.Jungle.Borderland),
    ],
    Variants: [],
    Width: 3,
    Height: 2
};
