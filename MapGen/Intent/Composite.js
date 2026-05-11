var MapGen = MapGen || {};
MapGen.Intent = MapGen.Intent || {};

// MapGen.Intent.Composite — projects the v3 multi-plane IntentMap onto the
// legacy `pContext.Layers.*` shape that PRESERVED files (Smoothing/, Encounters/,
// Integration/, Render.js, TilePolish.js) still read.
//
// Why this exists:
//   v3.4 §3.6 "Grammar and Integration boundaries" + Phase 1 D1 cross-check
//   identified 25 distinct legacy Layers.* slots that KEEP-list files read.
//   Without a projection, post-strip those reads would all return undefined and
//   render output would silently degrade. The Composite stage runs after every
//   Concept's author() and BEFORE the renderer, producing a v1-shape Layers
//   bag that downstream code consumes unchanged.
//
// Slot inventory (25 reads found by grep over Smoothing/Encounters/Integration/
//   Render.js/TilePolish.js):
//     blocked  causeway  coast  crossing  finalFieldCover  finalRouteCover
//     forcedBank  keepClear  lakeShore  occupied  outcrop  owner  path
//     perimeterCover  riverBank  softFillCover  structureContextCover
//     structureEdgeHints  structureGround  structureGroundMaterial
//     structurePlainGround  terrainEdge  trimmedTreeProtrusion  water
//
// Mapping (Phase 1 minimum-viable; many slots emit zeros until Phase 2 Concepts
// stamp the corresponding IntentMap state):
//
//   IntentMap.terrain  = WATER     -> Layers.water = 1
//   IntentMap.terrain  = COAST     -> Layers.coast = 1
//   IntentMap.terrain  = RIVER     -> Layers.water = 1, Layers.path is left
//                                      to the Concept's route stamp
//   IntentMap.terrain  = RIVERBANK -> Layers.riverBank = 1
//   IntentMap.terrain  = CLIFF_BODY|CLIFF_TOP -> Layers.blocked = 1
//   IntentMap.terrain  = FOREST    -> Layers.blocked = 1
//   IntentMap.terrain  = OUTCROP   -> Layers.outcrop = 1, Layers.blocked = 1
//
//   IntentMap.movement & WALKABLE        -> (no legacy slot — derived state)
//   IntentMap.movement & BLOCKED         -> Layers.blocked = 1
//   IntentMap.movement & ROUTE_PRIMARY   -> Layers.path = 1
//   IntentMap.movement & ROUTE_SECONDARY -> Layers.path = 1 (degraded; Phase 2
//                                            adds a separate slot if needed)
//   IntentMap.movement & KEEP_CLEAR      -> Layers.keepClear = 1
//   IntentMap.movement & CROSSING        -> Layers.crossing = 1
//   IntentMap.movement & BRIDGE          -> Layers.causeway = 1
//   IntentMap.movement & TRANSIT         -> (folded into bridge/crossing/path
//                                            depending on the biome — Phase 2)
//
//   IntentMap.claim & RESERVED      -> Layers.keepClear = 1
//   IntentMap.claim & STRUCT_FLOOR  -> Layers.structureGround = 1
//   IntentMap.claim & STRUCT_WALL   -> Layers.blocked = 1
//   IntentMap.claim & COMPOUND      -> Layers.occupied = 'live_structure'
//   IntentMap.claim & OBJECTIVE     -> Layers.occupied = 'objective'
//   IntentMap.claim & SPAWN_SAFE    -> Layers.keepClear = 1
//   IntentMap.claim & DECOR_ALLOWED -> (no legacy slot — Phase 2 emits decor)
//   IntentMap.claim & SPRITE_BLOCKED -> Layers.occupied = 'sprite_block'
//
//   IntentMap.owner -> Layers.owner (semantic translation; the enum values
//                                      are intentionally different)
//
// Slots emitted as zeros until Phase 2 Concepts populate them:
//   finalFieldCover, finalRouteCover, perimeterCover, softFillCover,
//   structureContextCover, structureEdgeHints, structureGroundMaterial,
//   structurePlainGround, terrainEdge, trimmedTreeProtrusion, forcedBank,
//   lakeShore. These are all set by v1 Layout/Features passes that the strip
//   removes; their PRESERVED consumers (Smoothing/Ice* and JungleGrammarBeach)
//   read them defensively (`MapGen.Layers.Get(...)` returns 0 on undefined),
//   so emitting zeros is safe — output may differ vs v1 baseline (decor cover
//   patterns) but the engine still produces a loadable map. v3.4 §8.5 row 7
//   tolerance band absorbs the cover/decor delta.
//
// Composite is INTENT -> LAYERS only. The reverse direction (legacy Layers
// reads back into IntentMap state) is forbidden by design — the strip removes
// the writers, so anything still reading post-render must consume the
// committed RenderedMap or the engine collision oracle, not Layers.

(function(pIntent) {

    function ensureLayer(pLayers, pName, pWidth, pHeight) {
        if(!pLayers[pName]) {
            pLayers[pName] = MapGen.Layers.Create(pWidth, pHeight, 0);
        }
        return pLayers[pName];
    }

    function setLayerCell(pLayer, pX, pY, pValue) {
        if(!pLayer || !pLayer.length) return;
        // MapGen.Layers is column-major: layer[x][y]. The original Composite
        // helper wrote layer[y][x], transposing square maps and silently
        // dropping the rightmost Width-Height columns on landscape maps.
        // That disconnected every projected water/cover/route cell from its
        // IntentMap coordinate and made shoreline proximity expand in the
        // wrong places.
        if(pX < 0 || pX >= pLayer.length) return;
        var column = pLayer[pX];
        if(!column || pY < 0 || pY >= column.length) return;
        column[pY] = pValue;
    }

    function legacyOwnerValue(pIntentOwner) {
        // Composite.js can be enumerated before IntentMapEnums.js by the
        // folder loader. Resolve enums when a map is projected, never at
        // module evaluation time, or every cached enum is undefined and the
        // producer/validator silently agree on an all-zero projection.
        var O = pIntent.Owner || {};
        var LO = MapGen.Layers && MapGen.Layers.Owner ? MapGen.Layers.Owner : {};
        switch(pIntentOwner) {
            case O.PLAYER_SPAWN:
            case O.ENEMY_SPAWN:
                return LO.CLEARING || 0;
            case O.STRUCTURE:
            case O.COMPOUND:
                return LO.STRUCTURE || 0;
            case O.OPEN:
                return LO.OPEN || 0;
            case O.TREE:
                return LO.TREE || 0;
            case O.CLIFF:
                return LO.CLIFF || 0;
            default:
                return LO.NONE || 0;
        }
    }

    // Returns a fresh pContext.Layers-shaped object derived from the IntentMap.
    // Caller assigns: pContext.Layers = MapGen.Intent.Composite.Project(pContext, intentMap);
    pIntent.Composite = pIntent.Composite || {};

    pIntent.Composite.Project = function(pContext, pIntentMap) {
        if(!pIntentMap) {
            return null;
        }
        var T = pIntent.Terrain || {};
        var M = pIntent.Movement || {};
        var C = pIntent.Claim || {};
        var W = pIntentMap.width;
        var H = pIntentMap.height;
        var layers = {};

        // Pre-create the 25 slots so consumers using `pContext.Layers.foo` after
        // the projection always see a defined 2D grid (zeros if no IntentMap
        // state asserts the slot). The Layers.* helper functions tolerate
        // missing slots, but creating up-front avoids cascading defensive
        // checks throughout the Smoothing pipeline.
        var slotNames = [
            'blocked', 'causeway', 'coast', 'crossing',
            'finalFieldCover', 'finalRouteCover', 'forcedBank', 'keepClear',
            'lakeShore', 'occupied', 'outcrop', 'owner', 'path',
            'perimeterCover', 'riverBank', 'softFillCover',
            'structureContextCover', 'structureEdgeHints',
            'structureGround', 'structureGroundMaterial',
            'structurePlainGround', 'terrainEdge', 'trimmedTreeProtrusion',
            'water'
        ];
        for(var slotIndex = 0; slotIndex < slotNames.length; ++slotIndex) {
            ensureLayer(layers, slotNames[slotIndex], W, H);
        }

        var blocked = layers.blocked;
        var water = layers.water;
        var coast = layers.coast;
        var riverBank = layers.riverBank;
        var crossing = layers.crossing;
        var causeway = layers.causeway;
        var keepClear = layers.keepClear;
        var occupied = layers.occupied;
        var outcrop = layers.outcrop;
        var owner = layers.owner;
        var path = layers.path;
        var structureGround = layers.structureGround;

        var T_WATER      = T.WATER      || 0;
        var T_COAST      = T.COAST      || 0;
        var T_RIVER      = T.RIVER      || 0;
        var T_RIVERBANK  = T.RIVERBANK  || 0;
        var T_CLIFF_BODY = T.CLIFF_BODY || 0;
        var T_CLIFF_TOP  = T.CLIFF_TOP  || 0;
        var T_FOREST     = T.FOREST     || 0;
        var T_OUTCROP    = T.OUTCROP    || 0;

        var M_BLOCKED        = M.BLOCKED        || 0;
        var M_ROUTE_PRIMARY  = M.ROUTE_PRIMARY  || 0;
        var M_ROUTE_SECONDARY= M.ROUTE_SECONDARY|| 0;
        var M_KEEP_CLEAR     = M.KEEP_CLEAR     || 0;
        var M_CROSSING       = M.CROSSING       || 0;
        var M_BRIDGE         = M.BRIDGE         || 0;

        var C_RESERVED       = C.RESERVED       || 0;
        var C_STRUCT_FLOOR   = C.STRUCT_FLOOR   || 0;
        var C_STRUCT_WALL    = C.STRUCT_WALL    || 0;
        var C_COMPOUND       = C.COMPOUND       || 0;
        var C_OBJECTIVE      = C.OBJECTIVE      || 0;
        var C_SPAWN_SAFE     = C.SPAWN_SAFE     || 0;
        var C_SPRITE_BLOCKED = C.SPRITE_BLOCKED || 0;

        for(var y = 0; y < H; ++y) {
            for(var x = 0; x < W; ++x) {
                var idx = (y * W) + x;

                // ---- terrain plane projection ----
                var terrain = pIntentMap.terrain[idx];
                switch(terrain) {
                    case T_WATER:
                        setLayerCell(water, x, y, 1);
                        break;
                    case T_COAST:
                        setLayerCell(coast, x, y, 1);
                        break;
                    case T_RIVER:
                        setLayerCell(water, x, y, 1);
                        break;
                    case T_RIVERBANK:
                        setLayerCell(riverBank, x, y, 1);
                        break;
                    case T_CLIFF_BODY:
                    case T_CLIFF_TOP:
                        setLayerCell(blocked, x, y, 1);
                        break;
                    case T_FOREST:
                        setLayerCell(blocked, x, y, 1);
                        // Tag as perimeter-cover-zone so v1's tree prune passes
                        // (PruneUnsupportedSparseTreeFragments etc.) treat
                        // these cells as cover-protected, matching how v1
                        // grammar_ice marks its tree cells. Without this layer
                        // tag, ~80% of authored forest is pruned at render.
                        if(layers.perimeterCover) {
                            setLayerCell(layers.perimeterCover, x, y, 1);
                        }
                        break;
                    case T_OUTCROP:
                        setLayerCell(outcrop, x, y, 1);
                        setLayerCell(blocked, x, y, 1);
                        if(layers.perimeterCover) {
                            setLayerCell(layers.perimeterCover, x, y, 1);
                        }
                        break;
                    default:
                        // LAND / 0 — leave layers zeroed
                        break;
                }

                // ---- movement plane projection (flags, OR-merged) ----
                var move = pIntentMap.movement[idx];
                if(move) {
                    if(move & M_BLOCKED) {
                        setLayerCell(blocked, x, y, 1);
                    }
                    if((move & M_ROUTE_PRIMARY) || (move & M_ROUTE_SECONDARY)) {
                        setLayerCell(path, x, y, 1);
                    }
                    if(move & M_KEEP_CLEAR) {
                        setLayerCell(keepClear, x, y, 1);
                    }
                    if(move & M_CROSSING) {
                        setLayerCell(crossing, x, y, 1);
                    }
                    if(move & M_BRIDGE) {
                        setLayerCell(causeway, x, y, 1);
                    }
                }

                // ---- claim plane projection (flags) ----
                var claim = pIntentMap.claim[idx];
                if(claim) {
                    if(claim & C_RESERVED) {
                        setLayerCell(keepClear, x, y, 1);
                    }
                    if(claim & C_STRUCT_FLOOR) {
                        setLayerCell(structureGround, x, y, 1);
                    }
                    if(claim & C_STRUCT_WALL) {
                        setLayerCell(blocked, x, y, 1);
                    }
                    if(claim & C_COMPOUND) {
                        setLayerCell(occupied, x, y, 'live_structure');
                    }
                    if(claim & C_OBJECTIVE) {
                        setLayerCell(occupied, x, y, 'objective');
                    }
                    if(claim & C_SPAWN_SAFE) {
                        setLayerCell(keepClear, x, y, 1);
                    }
                    if(claim & C_SPRITE_BLOCKED) {
                        setLayerCell(occupied, x, y, 'sprite_block');
                    }
                }

                // ---- owner plane projection. Intent.Owner and Layers.Owner
                // use different numeric ranks, so translate by meaning. A
                // raw 1:1 copy turns Intent.TREE(6) into Layers.ROUTE(6) and
                // makes Cover.Build reject every authored forest cell. ----
                var ownerValue = pIntentMap.owner[idx];
                if(ownerValue) {
                    setLayerCell(owner, x, y, legacyOwnerValue(ownerValue));
                }
            }
        }

        // Carry through region/route/object plans for downstream consumers
        // that still walk pContext.Rivers / Ponds / Crossings / Anchors etc.
        // Phase 1 leaves these as empty arrays — Concepts populate them.
        if(!pContext.Rivers)    pContext.Rivers = [];
        if(!pContext.Ponds)     pContext.Ponds = [];
        if(!pContext.Lakes)     pContext.Lakes = [];
        if(!pContext.Beaches)   pContext.Beaches = [];
        if(!pContext.EdgeBiomes)pContext.EdgeBiomes = [];
        if(!pContext.Crossings) pContext.Crossings = [];
        if(!pContext.Outcrops)  pContext.Outcrops = [];
        if(!pContext.Anchors)   pContext.Anchors = {};

        return layers;
    };

    // Verify the coordinate/plane contract immediately after Project(),
    // before Cover.Build intentionally reshapes blocked. This is deliberately
    // independent of setLayerCell so an x/y transpose in that helper cannot
    // make the producer and checker fail in the same way.
    pIntent.Composite.ValidateProjection = function(pIntentMap, pLayers) {
        var result = { ok: true, mismatches: 0, samples: [] };
        if(!pIntentMap || !pLayers) {
            return { ok: false, mismatches: 1, samples: ["missing map/layers"] };
        }

        var T = pIntent.Terrain || {};
        var M = pIntent.Movement || {};
        var C = pIntent.Claim || {};

        var W = pIntentMap.width;
        var H = pIntentMap.height;
        function expect(pLayer, pX, pY, pExpected, pName) {
            var actual = MapGen.Layers.Get(pLayer, pX, pY, 0);
            if(actual === pExpected)
                return;
            ++result.mismatches;
            if(result.samples.length < 8)
                result.samples.push(pName + "@" + pX + "," + pY +
                    " expected=" + pExpected + " actual=" + actual);
        }

        for(var y = 0; y < H; ++y) {
            for(var x = 0; x < W; ++x) {
                var index = (y * W) + x;
                var terrain = pIntentMap.terrain[index];
                var movement = pIntentMap.movement[index] || 0;
                var claim = pIntentMap.claim[index] || 0;
                var owner = pIntentMap.owner[index] || 0;

                if(terrain === T.WATER || terrain === T.RIVER)
                    expect(pLayers.water, x, y, 1, "water");
                if(terrain === T.COAST)
                    expect(pLayers.coast, x, y, 1, "coast");
                if(terrain === T.RIVERBANK)
                    expect(pLayers.riverBank, x, y, 1, "riverBank");
                if(terrain === T.CLIFF_BODY || terrain === T.CLIFF_TOP ||
                    terrain === T.FOREST || terrain === T.OUTCROP)
                    expect(pLayers.blocked, x, y, 1, "blocked");
                if(terrain === T.OUTCROP)
                    expect(pLayers.outcrop, x, y, 1, "outcrop");
                if(movement & (M.ROUTE_PRIMARY | M.ROUTE_SECONDARY))
                    expect(pLayers.path, x, y, 1, "path");
                if(movement & M.KEEP_CLEAR)
                    expect(pLayers.keepClear, x, y, 1, "keepClear");
                if(movement & M.CROSSING)
                    expect(pLayers.crossing, x, y, 1, "crossing");
                if(movement & M.BRIDGE)
                    expect(pLayers.causeway, x, y, 1, "causeway");
                if(claim & (C.RESERVED | C.SPAWN_SAFE))
                    expect(pLayers.keepClear, x, y, 1, "claimKeepClear");
                if(owner)
                    expect(pLayers.owner, x, y, legacyOwnerValue(owner), "owner");
            }
        }

        result.ok = result.mismatches === 0;
        return result;
    };

    // Re-apply authored IntentMap terrain onto an existing Layers bag.
    // Cover.Build enriches LAND with v1-shaped cover, but it also rebuilds
    // Layers.blocked from scratch. This overlay restores v3-authored HARD
    // terrain after that enrichment without discarding the new v1 cover.
    // FOREST is deliberately not restored here: it is a cover proposal, not
    // an exact rendered mask. Re-stamping the raw CA forest after Cover.Build
    // bypasses its shape/material rules and makes the later tree-prune passes
    // fight the authoring stage.
    pIntent.Composite.OverlayAuthoredTerrain = function(pContext, pIntentMap, pLayers) {
        if(!pIntentMap || !pLayers) {
            return 0;
        }

        var T = pIntent.Terrain || {};
        var M = pIntent.Movement || {};
        var C = pIntent.Claim || {};

        var W = pIntentMap.width || (pContext && pContext.Width) || 0;
        var H = pIntentMap.height || (pContext && pContext.Height) || 0;
        if(W <= 0 || H <= 0) {
            return 0;
        }

        var blocked = ensureLayer(pLayers, 'blocked', W, H);
        var water = ensureLayer(pLayers, 'water', W, H);
        var coast = ensureLayer(pLayers, 'coast', W, H);
        var riverBank = ensureLayer(pLayers, 'riverBank', W, H);
        var forcedBank = ensureLayer(pLayers, 'forcedBank', W, H);
        var lakeShore = ensureLayer(pLayers, 'lakeShore', W, H);
        var crossing = ensureLayer(pLayers, 'crossing', W, H);
        var causeway = ensureLayer(pLayers, 'causeway', W, H);
        var keepClear = ensureLayer(pLayers, 'keepClear', W, H);
        var occupied = ensureLayer(pLayers, 'occupied', W, H);
        var outcrop = ensureLayer(pLayers, 'outcrop', W, H);
        var owner = ensureLayer(pLayers, 'owner', W, H);
        var path = ensureLayer(pLayers, 'path', W, H);
        var perimeterCover = ensureLayer(pLayers, 'perimeterCover', W, H);
        var structureGround = ensureLayer(pLayers, 'structureGround', W, H);

        var T_LAND       = T.LAND;
        var T_WATER      = T.WATER;
        var T_COAST      = T.COAST;
        var T_RIVER      = T.RIVER;
        var T_RIVERBANK  = T.RIVERBANK;
        var T_CLIFF_BODY = T.CLIFF_BODY;
        var T_CLIFF_TOP  = T.CLIFF_TOP;
        var T_FOREST     = T.FOREST;
        var T_OUTCROP    = T.OUTCROP;

        var M_BLOCKED         = M.BLOCKED         || 0;
        var M_ROUTE_PRIMARY   = M.ROUTE_PRIMARY   || 0;
        var M_ROUTE_SECONDARY = M.ROUTE_SECONDARY || 0;
        var M_KEEP_CLEAR      = M.KEEP_CLEAR      || 0;
        var M_CROSSING        = M.CROSSING        || 0;
        var M_BRIDGE          = M.BRIDGE          || 0;

        var C_RESERVED       = C.RESERVED       || 0;
        var C_STRUCT_FLOOR   = C.STRUCT_FLOOR   || 0;
        var C_STRUCT_WALL    = C.STRUCT_WALL    || 0;
        var C_COMPOUND       = C.COMPOUND       || 0;
        var C_OBJECTIVE      = C.OBJECTIVE      || 0;
        var C_SPAWN_SAFE     = C.SPAWN_SAFE     || 0;
        var C_SPRITE_BLOCKED = C.SPRITE_BLOCKED || 0;

        var terrainPlane = pIntentMap.terrain || [];
        var movementPlane = pIntentMap.movement || [];
        var claimPlane = pIntentMap.claim || [];
        var ownerPlane = pIntentMap.owner || [];
        var touchedCells = 0;

        for(var y = 0; y < H; ++y) {
            for(var x = 0; x < W; ++x) {
                var idx = (y * W) + x;
                var touched = false;
                var terrain = terrainPlane[idx];
                var move = movementPlane[idx] || 0;
                var claim = claimPlane[idx] || 0;
                var dryReservation = terrain === T_LAND && (
                    (move & (M_ROUTE_PRIMARY | M_ROUTE_SECONDARY | M_KEEP_CLEAR)) ||
                    (claim & (C_STRUCT_FLOOR | C_SPAWN_SAFE))
                );

                // Smoothing is allowed to adjust its material layers, but a
                // land-authored gameplay reservation remains dry and open.
                // Reapplying this overlay after render keeps live placement,
                // drift checks and later local re-renders on the IntentMap's
                // side of that contract.
                if(dryReservation) {
                    setLayerCell(water, x, y, 0);
                    setLayerCell(coast, x, y, 0);
                    setLayerCell(riverBank, x, y, 0);
                    setLayerCell(forcedBank, x, y, 0);
                    setLayerCell(lakeShore, x, y, 0);
                    setLayerCell(outcrop, x, y, 0);
                    setLayerCell(blocked, x, y, 0);
                    touched = true;
                }

                switch(terrain) {
                    case T_WATER:
                        setLayerCell(water, x, y, 1);
                        touched = true;
                        break;
                    case T_COAST:
                        setLayerCell(coast, x, y, 1);
                        touched = true;
                        break;
                    case T_RIVER:
                        setLayerCell(water, x, y, 1);
                        touched = true;
                        break;
                    case T_RIVERBANK:
                        setLayerCell(riverBank, x, y, 1);
                        touched = true;
                        break;
                    case T_CLIFF_BODY:
                    case T_CLIFF_TOP:
                        setLayerCell(blocked, x, y, 1);
                        touched = true;
                        break;
                    case T_FOREST:
                        // Cover.Build already materialized the renderable tree
                        // mask. Keep its decision instead of restoring the raw
                        // IntentMap proposal into blocked/perimeterCover.
                        touched = true;
                        break;
                    case T_OUTCROP:
                        setLayerCell(outcrop, x, y, 1);
                        setLayerCell(blocked, x, y, 1);
                        setLayerCell(perimeterCover, x, y, 1);
                        touched = true;
                        break;
                }

                if(move) {
                    // FOREST carries BLOCKED in the semantic map, but its
                    // physical blocked cells are selected by Cover.Build.
                    // Other blocked terrain remains hard authored geometry.
                    if((move & M_BLOCKED) && terrain !== T_FOREST && !dryReservation) {
                        setLayerCell(blocked, x, y, 1);
                    }
                    if((move & M_ROUTE_PRIMARY) || (move & M_ROUTE_SECONDARY)) {
                        setLayerCell(path, x, y, 1);
                    }
                    if(move & M_KEEP_CLEAR) {
                        setLayerCell(keepClear, x, y, 1);
                    }
                    if(move & M_CROSSING) {
                        setLayerCell(crossing, x, y, 1);
                    }
                    if(move & M_BRIDGE) {
                        setLayerCell(causeway, x, y, 1);
                    }
                    touched = true;
                }

                if(claim) {
                    if(claim & C_RESERVED) {
                        setLayerCell(keepClear, x, y, 1);
                    }
                    if(claim & C_STRUCT_FLOOR) {
                        setLayerCell(structureGround, x, y, 1);
                    }
                    if(claim & C_STRUCT_WALL) {
                        setLayerCell(blocked, x, y, 1);
                    }
                    if(claim & C_COMPOUND) {
                        setLayerCell(occupied, x, y, 'live_structure');
                    }
                    if(claim & C_OBJECTIVE) {
                        setLayerCell(occupied, x, y, 'objective');
                    }
                    if(claim & C_SPAWN_SAFE) {
                        setLayerCell(keepClear, x, y, 1);
                    }
                    if(claim & C_SPRITE_BLOCKED) {
                        setLayerCell(occupied, x, y, 'sprite_block');
                    }
                    touched = true;
                }

                var ownerValue = ownerPlane[idx] || 0;
                if(ownerValue) {
                    setLayerCell(owner, x, y, legacyOwnerValue(ownerValue));
                    touched = true;
                }

                if(touched) {
                    ++touchedCells;
                }
            }
        }

        return touchedCells;
    };

    // For Phase 2 forward-compat: hook for per-Concept finaliser step that
    // mutates Layers AFTER projection but BEFORE Render. Today a no-op;
    // FinaliseRenderedMap (v3.4 §6) lives one stage further along.
    pIntent.Composite.Finalise = function(pContext, pIntentMap, pLayers) {
        // No-op in Phase 1. Phase 2 dispatches to per-Concept finaliseConcept().
        return pLayers;
    };

})(MapGen.Intent);
