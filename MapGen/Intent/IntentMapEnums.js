// MapGen v3 Intent — plane enums.
//
// Per OpenFodder_Map_Generator_Rewrite_Design_v3.4.md §3.2 the IntentMap has
// four parallel planes, each backed by a typed array. Plane values are integer
// constants so they can live in Uint8Array / Uint16Array cells without the
// per-cell allocation hit of string keys.
//
// Plane semantics (cf v3.4 §3.2):
//   terrain  — single ENUM per cell. What the cell IS (LAND, WATER, ...).
//   movement — bitwise FLAGS (OR'd). How the cell behaves for traversal.
//   claim    — bitwise FLAGS (OR'd). Authoring claims (RESERVED, SPAWN_SAFE,
//              ...) that downstream Concepts and validators read.
//   owner    — single ENUM per cell. Which authoring layer claimed it last
//              (PLAYER_SPAWN, ENEMY_SPAWN, ...).

var MapGen = MapGen || {};
MapGen.Intent = MapGen.Intent || {};

// ---------------------------------------------------------------------------
// terrain plane (Uint8Array, single ENUM per cell)

MapGen.Intent.Terrain = {
    LAND:         0,
    WATER:        1,
    COAST:        2,
    BEACH:        3,
    RIVER:        4,
    RIVERBANK:    5,
    CLIFF_BODY:   6,
    CLIFF_TOP:    7,
    FOREST:       8,
    OUTCROP:      9
};

MapGen.Intent.TerrainName = {
    0: 'LAND',
    1: 'WATER',
    2: 'COAST',
    3: 'BEACH',
    4: 'RIVER',
    5: 'RIVERBANK',
    6: 'CLIFF_BODY',
    7: 'CLIFF_TOP',
    8: 'FOREST',
    9: 'OUTCROP'
};

// ---------------------------------------------------------------------------
// movement plane (Uint16Array, FLAGS — bit-OR)

MapGen.Intent.Movement = {
    WALKABLE:        1,
    BLOCKED:         2,
    ROUTE_PRIMARY:   4,
    ROUTE_SECONDARY: 8,
    KEEP_CLEAR:      16,
    CROSSING:        32,
    BRIDGE:          64,
    TRANSIT:         128
};

MapGen.Intent.MovementName = {
    1:   'WALKABLE',
    2:   'BLOCKED',
    4:   'ROUTE_PRIMARY',
    8:   'ROUTE_SECONDARY',
    16:  'KEEP_CLEAR',
    32:  'CROSSING',
    64:  'BRIDGE',
    128: 'TRANSIT'
};

// ---------------------------------------------------------------------------
// claim plane (Uint16Array, FLAGS — bit-OR)

MapGen.Intent.Claim = {
    RESERVED:        1,
    STRUCT_FLOOR:    2,
    STRUCT_WALL:     4,
    COMPOUND:        8,
    OBJECTIVE:       16,
    SPAWN_SAFE:      32,
    DECOR_ALLOWED:   64,
    SPRITE_BLOCKED:  128
};

MapGen.Intent.ClaimName = {
    1:   'RESERVED',
    2:   'STRUCT_FLOOR',
    4:   'STRUCT_WALL',
    8:   'COMPOUND',
    16:  'OBJECTIVE',
    32:  'SPAWN_SAFE',
    64:  'DECOR_ALLOWED',
    128: 'SPRITE_BLOCKED'
};

// ---------------------------------------------------------------------------
// owner plane (Uint16Array, single ENUM per cell)

MapGen.Intent.Owner = {
    NONE:         0,
    PLAYER_SPAWN: 1,
    ENEMY_SPAWN:  2,
    STRUCTURE:    3,
    COMPOUND:     4,
    OPEN:         5,
    TREE:         6,
    CLIFF:        7
};

MapGen.Intent.OwnerName = {
    0: 'NONE',
    1: 'PLAYER_SPAWN',
    2: 'ENEMY_SPAWN',
    3: 'STRUCTURE',
    4: 'COMPOUND',
    5: 'OPEN',
    6: 'TREE',
    7: 'CLIFF'
};
