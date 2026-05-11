var MapGen = MapGen || {};
MapGen.Integration = MapGen.Integration || {};

(function(pIntegration) {
    // GenerateCampaignMap / GenerateMultiplayerMap (the public entry points) now
    // live in Integration/Index.js so the front door matches the file name.

    pIntegration.FirstPlacement = function(pGroup, pKind, pRole) {
        var context = Session.MapGenContext;
        if(!context || !context.Placements || !context.Placements[pGroup])
            return null;

        var group = context.Placements[pGroup];
        for(var index = 0; index < group.length; ++index) {
            var placement = group[index];
            if(pKind && placement.kind !== pKind)
                continue;
            if(pRole && placement.role !== pRole)
                continue;

            return placement;
        }

        return null;
    };

    pIntegration.CampaignStartPosition = function() {
        var placement = this.FirstPlacement("players", "player_start", "start");
        if(!placement || !placement.point)
            return null;

        return this.TileToPosition(placement.point);
    };

    pIntegration.PlaceCampaignPlayers = function(pCount) {
        var position = this.CampaignStartPosition();

        if(!position)
            return false;

        Session.HumanPosition = new cPosition(position.x, position.y);

        for(var count = 0; count < pCount; ++count) {
            Map.SpriteAdd(SpriteTypes.Player, position.x, position.y);

            if(count > 0)
                position.x += 16;
            else
                position.y += 16;
        }

        return Map.getSpriteTypeCount(SpriteTypes.Player) >= pCount;
    };

    pIntegration.IsGrammarCampaignContext = function() {
        var context = Session.MapGenContext;
        return !!(context &&
            context.Profile &&
            context.Profile.GeneratorCore === "official_grammar" &&
            context.GrammarPlan &&
            context.GrammarPlan.spritePlan);
    };

    pIntegration.GrammarSpritePlan = function() {
        var context = Session.MapGenContext;
        return this.IsGrammarCampaignContext() ? context.GrammarPlan.spritePlan : null;
    };

    // Ice enemy turrets stand on a 2-tile base (381 left, 382 right) on the
    // turret's own tile row. Shipped ice maps (mapm21/22) place this pair under
    // every type-84 turret; the generator previously stamped only the sprite,
    // leaving turrets baseless on ice. Jungle/desert reuse 381/382 as river art,
    // so the base is ICE-ONLY.
    var TURRET_BASE_LEFT = 381;
    var TURRET_BASE_RIGHT = 382;
    var ENEMY_TURRET_SPRITES = { 84: true, 85: true };

    // Ground-combat actors must stand on walkable terrain. The grammar sprite
    // plan computes their tiles from route/anchor offsets BEFORE the live terrain
    // is built, so trees (blocked) and water can grow over those cells, leaving a
    // soldier rendered on a tree or in a lake. These kinds get snapped to the
    // nearest walkable tile at placement time (post-render, when blocked/water are
    // final). Decor/hazards/doors are deliberately NOT here: hazards belong on
    // hazard tiles, decor is scenery, and structure doors are tied to a building.
    var GROUND_ACTOR_KINDS = {
        enemy_patrol: true,
        enemy_turret: true,
        enemy_vehicle: true
    };
    // Sub-tile pixel anchor of the turret sprite within its base tile — the
    // canonical (7,15) seen across all shipped ice turrets (mapm21/22/...). Puts
    // the gun on the base instead of one cell up-and-left of it.
    var TURRET_SPRITE_OFFSET_X = 7;
    var TURRET_SPRITE_OFFSET_Y = 15;

    // Rocket infantry are high-pressure enemies. Keep them out of the opening
    // encounter even if the live walkability pass snaps a planned placement
    // back toward the squad after grammar generation has finished.
    var ROCKET_ENEMY_START_CLEARANCE = 14;
    pIntegration.RocketEnemyStartClearance = function(pContext) {
        var value = pContext && pContext.Profile ?
            Number(pContext.Profile.RocketEnemyStartClearance) : NaN;

        if(!isFinite(value))
            value = ROCKET_ENEMY_START_CLEARANCE;
        return Math.max(8, Math.floor(value));
    };

    pIntegration.RocketEnemyNearStart = function(
        pContext, pTileX, pTileY, pClearance) {
        var start = pContext && pContext.Anchors ? pContext.Anchors.start : null;
        if(!start)
            return false;

        var clearance = pClearance === undefined ?
            this.RocketEnemyStartClearance(pContext) : pClearance;
        var dx = pTileX - start.x;
        var dy = pTileY - start.y;
        return (dx * dx) + (dy * dy) < clearance * clearance;
    };

    // Shipped ice maps keep a dry buffer around turret bases: across mapm21/22/31-35
    // essentially every 381/382 base cell is >=2 tiles from water (only 2 of ~41 sit
    // at margin 1). The generator was ignoring this and stamping bases right on the
    // shoreline ("the base is in the water"). This is the engine-oracle water test
    // for the all-8 neighbourhood (P2 margin).
    var WATER_FEATURES = { 5: true, 6: true }; // ShallowWater, DeepWater
    pIntegration.CellAdjacentToWater = function(pContext, pTileX, pTileY) {
        if(typeof Map === "undefined" || !Map.TileTerrainFeature)
            return false;
        for(var dy = -1; dy <= 1; ++dy) {
            for(var dx = -1; dx <= 1; ++dx) {
                if(dx === 0 && dy === 0)
                    continue;
                var f = Map.TileTerrainFeature(pTileX + dx, pTileY + dy);
                if(f >= 0 && WATER_FEATURES[f])
                    return true;
            }
        }
        return false;
    };

    // The turret is an objective_guard; it must never be stamped on or beside the
    // player squad's start (the reported "turret right above the soldiers' start").
    // Campaign maps carry Anchors.start; multiplayer carries team spawns instead, so
    // fall back to those so the keep-out still applies if the turret path ever runs
    // in MP. Returns an array of {x,y} keep-out centres (may be empty).
    var TURRET_START_KEEPOUT = 8;
    pIntegration.TurretKeepOutAnchors = function(pContext) {
        var anchors = pContext && pContext.Anchors ? pContext.Anchors : {};
        var out = [];
        if(anchors.start && typeof anchors.start.x === "number")
            out.push(anchors.start);
        if(anchors.teamA && typeof anchors.teamA.x === "number")
            out.push(anchors.teamA);
        if(anchors.teamB && typeof anchors.teamB.x === "number")
            out.push(anchors.teamB);
        return out;
    };

    pIntegration.TurretSpotNearKeepOut = function(pContext, pTileX, pTileY) {
        var anchors = this.TurretKeepOutAnchors(pContext);
        for(var index = 0; index < anchors.length; ++index) {
            var a = anchors[index];
            if(Math.max(Math.abs(pTileX - a.x), Math.abs(pTileY - a.y)) <= TURRET_START_KEEPOUT)
                return true;
        }
        return false;
    };

    // Turret bases are a destructive two-tile overlay (381/382), so engine
    // walkability alone is not a sufficient placement oracle. Several ice
    // cliff-top and stair tiles are deliberately walkable, but overwriting
    // any of them leaves a gun sitting in a broken cliff. Reserve the entire
    // synthesized visual footprint: lip row, face/stairs, and the two-row
    // foot-shadow apron.
    pIntegration.CellInCliffPlacementKeepOut = function(
        pContext, pTileX, pTileY) {
        if(!pContext || !pContext.Cliffs)
            return false;

        for(var index = 0; index < pContext.Cliffs.length; ++index) {
            var record = pContext.Cliffs[index] || {};
            var columns = record.columns || [];
            for(var c = 0; c < columns.length; ++c) {
                var column = columns[c] || {};
                if(column.x !== pTileX)
                    continue;

                var trips = column.triplets || [];
                if(trips.length) {
                    var minY = trips[0].y;
                    var maxY = trips[0].y;
                    for(var t = 1; t < trips.length; ++t) {
                        if(trips[t].y < minY) minY = trips[t].y;
                        if(trips[t].y > maxY) maxY = trips[t].y;
                    }
                    if(pTileY >= minY - 1 && pTileY <= maxY + 2)
                        return true;
                }

                // Stair-replaced columns intentionally have no body
                // triplets, but their column contract still describes the
                // cliff band that the stair art occupies.
                if(column.isStairs && typeof column.topRowY === "number") {
                    var height = Number(record.stampHeight || 4) | 0;
                    if(pTileY >= column.topRowY - 1 &&
                        pTileY <= column.topRowY + height + 1)
                        return true;
                }
            }

            var stairs = record.stairs;
            if(stairs && pTileX >= stairs.originX &&
                pTileX < stairs.originX + stairs.width &&
                pTileY >= stairs.originY - 1 &&
                pTileY <= stairs.originY + stairs.height + 1)
                return true;
        }
        return false;
    };

    // A base footprint cell must be on placeable ground. Runs post-render, so the
    // engine collision (GroundActorCellStandable -> Map.TileTerrainFeature) is the
    // authoritative "is this solid/water" test — same oracle the enemy snap uses,
    // so a turret base can't land on a tree/water tile the layer model missed. The
    // riverBank guard stays a layer check: it's a placement-aesthetic margin, not an
    // engine terrain feature. pMargin adds the all-8 water-free requirement (P2);
    // it's relaxed in later fallback tiers so a near-water turret still gets a base.
    pIntegration.TurretBaseCellOpen = function(pContext, pTileX, pTileY, pMargin) {
        if(!pContext || !pContext.Layers)
            return false;
        if(!MapGen.Layers.InBounds(pContext.Layers.blocked, pTileX, pTileY))
            return false;
        // Keep the base off the very edge. A base at tile x=0 makes the turret
        // sprite's stored X (= x*16 + 7 - 0x10) underflow to a negative int16, which
        // the engine renders as a garbage off-map sprite. Shipped maps never base a
        // turret at x=0 (min is x=1). The +1 footprint cell guards the right edge.
        if(pTileX < 1 || pTileY < 1 ||
            pTileX >= pContext.Width - 1 || pTileY >= pContext.Height - 1)
            return false;
        if(MapGen.Layers.Get(pContext.Layers.riverBank, pTileX, pTileY, 0))
            return false;
        if(this.CellInCliffPlacementKeepOut(pContext, pTileX, pTileY))
            return false;
        // Turret bases are solid rendered tiles. Keep them beside the v3 route,
        // never on it, or the post-commit route oracle reports route_solid.
        if(MapGen.Layers.Get(pContext.Layers.path, pTileX, pTileY, 0))
            return false;
        if(pContext.IntentMap && MapGen.Intent && MapGen.Intent.Movement) {
            var im = pContext.IntentMap;
            if(pTileX >= 0 && pTileY >= 0 && pTileX < im.width && pTileY < im.height) {
                var move = im.movement[(pTileY * im.width) + pTileX] || 0;
                if(move & (MapGen.Intent.Movement.ROUTE_PRIMARY |
                           MapGen.Intent.Movement.ROUTE_SECONDARY)) {
                    return false;
                }
            }
        }
        // Don't reuse a cell another turret base (or other reserved sprite) already
        // claimed this pass. Two turrets planned on adjacent tiles would otherwise
        // overwrite each other's 381/382 (leaving "381 381 382" and a baseless gun).
        if(MapGen.Layers.Get(pContext.Layers.occupied, pTileX, pTileY, 0))
            return false;
        if(this.TurretSpotNearKeepOut(pContext, pTileX, pTileY))
            return false;
        if(!this.GroundActorCellStandable(pContext, pTileX, pTileY))
            return false;
        if(pMargin && this.CellAdjacentToWater(pContext, pTileX, pTileY))
            return false;
        // Firing clearance: a turret boxed in by trees shoots the adjacent trees and
        // self-destructs. Shipped turrets sit clear (0 solid neighbours typically,
        // never >3). Require an open surround — strict in the margin/Tier-1 pass
        // (<=1 solid neighbour), relaxed in the Tier-2 fallback (<=3, the shipped max).
        var solidLimit = pMargin ? 1 : 3;
        if(this.SolidNeighbourCount(pContext, pTileX, pTileY) > solidLimit)
            return false;
        return true;
    };

    // The 2-wide base footprint (tile + tile to its right) is valid when both
    // cells are open ground.
    pIntegration.TurretBaseFootprintOpen = function(pContext, pTileX, pTileY, pMargin) {
        return this.TurretBaseCellOpen(pContext, pTileX, pTileY, pMargin) &&
               this.TurretBaseCellOpen(pContext, pTileX + 1, pTileY, pMargin);
    };

    // Spiral outward deterministically (ring by ring, no RNG draw) from a planned
    // point for the nearest tile whose 2-wide footprint is open. pMargin toggles the
    // P2 water-free requirement; pMaxRadius bounds the search. Returns {x,y} or null.
    pIntegration.FindTurretBaseSpot = function(pContext, pTileX, pTileY, pMargin, pMaxRadius) {
        var maxRadius = pMaxRadius || 8;
        if(this.TurretBaseFootprintOpen(pContext, pTileX, pTileY, pMargin))
            return { x: pTileX, y: pTileY };

        for(var radius = 1; radius <= maxRadius; ++radius) {
            for(var dy = -radius; dy <= radius; ++dy) {
                for(var dx = -radius; dx <= radius; ++dx) {
                    // Only the ring edge at this radius (interior already scanned).
                    if(Math.max(Math.abs(dx), Math.abs(dy)) !== radius)
                        continue;
                    var tx = pTileX + dx;
                    var ty = pTileY + dy;
                    if(this.TurretBaseFootprintOpen(pContext, tx, ty, pMargin))
                        return { x: tx, y: ty };
                }
            }
        }
        return null;
    };

    // Tiered, base-preferring search for an ice turret's 2-wide base spot. Order
    // matters: prefer a water-margin-clean (P2) spot at a WIDER radius over a
    // water-adjacent (P0) spot at a narrow one, otherwise a turret planned near a
    // shore takes the first P0 cell and still reads as "in the water".
    //   Tier 1: margin-clean (P2), radius 16 (bounded relocation, no map-wide teleport).
    //   Tier 2: margin relaxed (P0, still standable + riverBank-free + off-start),
    //           radius 8 — only reached when NO clean spot exists within 16, i.e. a
    //           genuinely water-locked turret; recovers the shipped long-tail.
    // Returns null when even that fails, in which case the caller DROPS the turret
    // (no baseless orphan, no base in water). Verified on a 40-map/76-turret ice
    // corpus: Tier 1 bases 72/76 margin-clean, 0 water-adjacent, 0 on-start, 4 dropped
    // (genuinely water-locked) — vs 39 water-adjacent / 10 baseless / 2 on-start before.
    pIntegration.ResolveTurretBaseSpot = function(pContext, pTileX, pTileY) {
        return this.FindTurretBaseSpot(pContext, pTileX, pTileY, true, 16) ||
               this.FindTurretBaseSpot(pContext, pTileX, pTileY, false, 8);
    };

    pIntegration.IsIceEnemyTurretPlacement = function(pContext, pPlacement, pType) {
        return !!(pContext && pContext.Profile &&
            pContext.Profile.TerrainType === Terrain.Types.Ice &&
            pPlacement && pPlacement.kind === "enemy_turret" &&
            ENEMY_TURRET_SPRITES[pType]);
    };

    // Engine terrain features (eTerrainFeature) a ground actor must NOT be spawned
    // on. Map.TileIsWalkable alone is not enough: the engine's foot-unit walkable
    // table only blocks SolidObstacle(3), because infantry CAN wade into water in
    // game — but spawning an enemy already standing in a lake looks wrong, so we
    // also reject the water/hazard/drop features here. SlowGround(7, tree edges)
    // and SoftHazard(4) stay allowed, matching shipped maps.
    var NON_STANDABLE_FEATURES = {
        3: true,   // SolidObstacle (trees, rocks, buildings)
        5: true,   // ShallowWater
        6: true,   // DeepWater
        9: true,   // LedgeDrop
        10: true,  // PitDrop
        11: true   // SinkingGround
    };

    // True when a ground actor can legitimately stand on this cell, asked of the
    // ENGINE itself (Map.TileTerrainFeature -> Map_Terrain_Get -> HIT/BHT collision).
    // This is the same per-tile feature the running game resolves, so it can never
    // disagree with what the player collides with — unlike the generation-time
    // `blocked` layer (which the smoother can diverge from when it paints tree art)
    // or a hand-maintained tile-id list.
    pIntegration.GroundActorCellStandable = function(pContext, pTileX, pTileY) {
        if(pTileX < 0 || pTileY < 0 || pTileX >= pContext.Width || pTileY >= pContext.Height)
            return false;
        if(typeof Map !== "undefined" && Map.TileTerrainFeature) {
            var feature = Map.TileTerrainFeature(pTileX, pTileY);
            if(feature < 0)
                return false;
            if(NON_STANDABLE_FEATURES[feature])
                return false;
            // Engine collision treats ice tree-TRUNK tiles (e.g. 210-219) as
            // SlowGround — technically walkable, but they render as a TREE, so a
            // soldier there looks like he's standing on/in a tree. Reject any cell
            // whose rendered tile is ice tree art even when the feature is passable.
            if(typeof Map.TileGet === "function" &&
                pContext.Profile && pContext.Profile.TerrainType === Terrain.Types.Ice &&
                this.IsIceTreeArtTile && this.IsIceTreeArtTile(Map.TileGet(pTileX, pTileY)))
                return false;
            return true;
        }
        // Fallback only if the engine query is unavailable (older exe): the
        // generation-time layers. Less accurate but better than nothing.
        if(MapGen.Metrics && MapGen.Metrics.IsWalkable)
            return MapGen.Metrics.IsWalkable(pContext, pTileX, pTileY);
        return true;
    };

    // Count solid-obstacle (tree/rock/building) neighbours in the 8-ring, via the
    // engine feature oracle. A turret with too many solid neighbours fires into the
    // adjacent trees and destroys itself instantly; shipped turrets sit almost
    // always fully clear (0 solid neighbours; never more than 3 across mapm21-35).
    pIntegration.SolidNeighbourCount = function(pContext, pTileX, pTileY) {
        if(typeof Map === "undefined" || !Map.TileTerrainFeature)
            return 0;
        var count = 0;
        for(var dy = -1; dy <= 1; ++dy) {
            for(var dx = -1; dx <= 1; ++dx) {
                if(dx === 0 && dy === 0)
                    continue;
                if(Map.TileTerrainFeature(pTileX + dx, pTileY + dy) === 3)
                    ++count;
            }
        }
        return count;
    };

    // Last-resort fallback when no standable cell sits near a planned point: the
    // nearest cell on the reserved route corridor (the `path` layer, which is
    // walkable by construction). Scanned in fixed row-major order with a
    // Chebyshev-distance tiebreak so it's deterministic. Used only for actors
    // stranded in a large tree/water region (e.g. an offset that flung them to an
    // impassable map edge) — keeps them on the route the player actually traverses
    // instead of floating on water.
    pIntegration.NearestRouteCell = function(pContext, pTileX, pTileY) {
        var layers = pContext.Layers || {};
        if(!layers.path)
            return null;
        var best = null;
        var bestDist = -1;
        for(var y = 0; y < pContext.Height; ++y) {
            for(var x = 0; x < pContext.Width; ++x) {
                if(!MapGen.Layers.Get(layers.path, x, y, 0))
                    continue;
                if(!this.GroundActorCellStandable(pContext, x, y))
                    continue;
                var dist = Math.max(Math.abs(x - pTileX), Math.abs(y - pTileY));
                if(best === null || dist < bestDist) {
                    best = { x: x, y: y };
                    bestDist = dist;
                }
            }
        }
        return best;
    };

    // A ground-combat sprite whose planned tile ended up on a tree/water/drop is
    // snapped to the nearest standable tile. Deterministic ring search, no RNG draw
    // — so an already-standable placement is unchanged (output stays byte-identical
    // there; only the broken placements move). If no standable cell is near (the
    // actor was flung into a large impassable region), falls back to the nearest
    // route cell. Returns {x,y} tile coords, or null only if even the route has no
    // standable cell (caller then places the bare sprite — no worse than before).
    pIntegration.SnapGroundActorToWalkable = function(pContext, pTileX, pTileY) {
        if(this.GroundActorCellStandable(pContext, pTileX, pTileY))
            return { x: pTileX, y: pTileY };

        var maxRadius = 8;
        for(var radius = 1; radius <= maxRadius; ++radius) {
            for(var dy = -radius; dy <= radius; ++dy) {
                for(var dx = -radius; dx <= radius; ++dx) {
                    // Only the ring edge at this radius (interior already scanned).
                    if(Math.max(Math.abs(dx), Math.abs(dy)) !== radius)
                        continue;
                    var tx = pTileX + dx;
                    var ty = pTileY + dy;
                    if(this.GroundActorCellStandable(pContext, tx, ty))
                        return { x: tx, y: ty };
                }
            }
        }

        return this.NearestRouteCell(pContext, pTileX, pTileY);
    };

    pIntegration.RecordLiveGrammarEnemy = function(pContext, pPlacement,
        pSpriteType, pX, pY, pDropped) {
        if(!pContext || !pPlacement ||
            String(pPlacement.kind || "").indexOf("enemy_") !== 0)
            return;
        if(!pContext.LiveEnemyPlacements)
            pContext.LiveEnemyPlacements = [];
        var livePoint = {
            x: Math.floor(pX / 16),
            y: Math.floor(pY / 16)
        };
        var liveRegion = pPlacement.regionId && MapGen.Encounters &&
            MapGen.Encounters.EncounterRegionById ?
            MapGen.Encounters.EncounterRegionById(
                pContext, pPlacement.regionId) : null;
        if(!liveRegion && MapGen.Encounters &&
            MapGen.Encounters.NearestEncounterRegion) {
            liveRegion = MapGen.Encounters.NearestEncounterRegion(
                pContext, livePoint, false);
        }
        pContext.LiveEnemyPlacements.push({
            kind: pPlacement.kind,
            role: pPlacement.role || "",
            spriteType: pSpriteType,
            point: livePoint,
            runtimePosition: { x: pX, y: pY },
            routeFraction: pPlacement.routeFraction,
            routePhase: pPlacement.routePhase || "",
            branchId: pPlacement.branchId || null,
            regionId: liveRegion ? liveRegion.id : "",
            encounterKind: liveRegion ? liveRegion.kind : "",
            topologyPurpose: pPlacement.topologyPurpose || "",
            dropped: !!pDropped
        });
    };

    pIntegration.PlaceGrammarSpritePlacement = function(pPlacement) {
        if(!pPlacement)
            return false;

        var type = pPlacement.spriteType;
        var runtime = pPlacement.runtimePosition || null;
        var point = pPlacement.point || null;
        var x;
        var y;

        if(type === undefined || type === null)
            return false;

        // Ice enemy turrets stand on a 2-wide 381/382 base. Resolve a base spot that
        // is standable, water-margin-clean, riverBank-free and away from the player
        // start (see ResolveTurretBaseSpot's tiers), stamp the base there, and place
        // the sprite ON it. If NO dry 2-wide footprint exists within radius 16 (a
        // water-locked turret), DROP the turret rather than emit a baseless orphan or
        // a base in the water — both are worse than one fewer turret, and shipped ice
        // maps never show a baseless or water-bound turret.
        var context = Session.MapGenContext;
        if(point && this.IsIceEnemyTurretPlacement(context, pPlacement, type) &&
            typeof Map !== "undefined" && Map.TileSet) {
            var spot = this.ResolveTurretBaseSpot(context, point.x, point.y);
            if(spot) {
                Map.TileSet(spot.x, spot.y, TURRET_BASE_LEFT);
                Map.TileSet(spot.x + 1, spot.y, TURRET_BASE_RIGHT);
                // Keep these cells out of later placement reuse.
                if(context.Layers && context.Layers.occupied) {
                    MapGen.Layers.Set(context.Layers.occupied, spot.x, spot.y, "turret_base");
                    MapGen.Layers.Set(context.Layers.occupied, spot.x + 1, spot.y, "turret_base");
                }
                // Shipped ice turrets are stored at the base tile origin + (7,15)
                // sub-pixel (canonical across mapm21/22/etc.): the sprite anchors
                // near the bottom of its cell so it stands ON the 381/382 base
                // rather than up-and-left of it. Without this the base looked one
                // row down and one column right of the gun.
                Map.SpriteAdd(type, (spot.x * 16) + TURRET_SPRITE_OFFSET_X, (spot.y * 16) + TURRET_SPRITE_OFFSET_Y);
                this.RecordLiveGrammarEnemy(context, pPlacement, type,
                    (spot.x * 16) + TURRET_SPRITE_OFFSET_X,
                    (spot.y * 16) + TURRET_SPRITE_OFFSET_Y, false);
            }
            // No dry footprint within radius 16: drop the turret (return true so the
            // caller counts it as handled, not a placement failure).
            return true;
        }

        if(runtime) {
            x = runtime.x;
            y = runtime.y;
        }
        else if(point) {
            x = point.x * 16;
            y = point.y * 16;
        }
        else {
            return false;
        }

        // Ground-combat actors must not be left standing on a tree (blocked) or in
        // water: the plan picks their tile (and the matching runtimePosition) from
        // route/anchor offsets BEFORE the live terrain exists, so cover/water can
        // grow over it. Snap the final pixel position to the nearest walkable tile,
        // preserving the sub-tile pixel offset. No-op + byte-identical when the
        // tile is already walkable, so only the broken placements move.
        if(pPlacement.kind && GROUND_ACTOR_KINDS[pPlacement.kind]) {
            var tileX = Math.floor(x / 16);
            var tileY = Math.floor(y / 16);
            var snapped = this.SnapGroundActorToReachable(context, tileX, tileY, x - tileX * 16, y - tileY * 16);
            if(!snapped) throw new Error("ground_actor_has_no_reachable_site:" + tileX + "," + tileY);
            if(snapped && (snapped.x !== tileX || snapped.y !== tileY)) {
                x += (snapped.x - tileX) * 16;
                y += (snapped.y - tileY) * 16;
            }
        }

        // This is intentionally checked after snapping. Planning already keeps
        // rockets out of the early route, while this final boundary guarantees
        // that the materialized sprite cannot be moved inside the start radius.
        if(type === SpriteTypes.Enemy_Rocket &&
            this.RocketEnemyNearStart(
                context,
                Math.floor(x / 16),
                Math.floor(y / 16))) {
            type = SpriteTypes.Enemy;
            context.RocketStartSafetyConversions =
                (context.RocketStartSafetyConversions || 0) + 1;
            pPlacement.liveSpriteType = type;
            pPlacement.rocketStartSafetyConverted = true;
        }

        Map.SpriteAdd(type, x, y);
        this.RecordLiveGrammarEnemy(context, pPlacement, type, x, y, false);
        return true;
    };

    pIntegration.PlaceGrammarBeachEnemyFallbacks = function(pPlacedCount, pRequestedCount) {
        var context = Session.MapGenContext;

        if(!context ||
            !context.Profile ||
            context.Profile.TargetPackProfile !== "grammar_beach")
            return 0;

        var target = this.CampaignEnemyTargetCount(pRequestedCount);
        var added = 0;

        for(var fallback = Math.max(0, pPlacedCount || 0); fallback < target; ++fallback) {
            var routePosition = this.RoutePosition(fallback, target, 3);
            if(routePosition) {
                Map.SpriteAdd(SpriteTypes.Enemy, routePosition.x, routePosition.y);
                this.RecordLiveGrammarEnemy(context, {
                    kind: "enemy_patrol",
                    role: "route_fallback"
                }, SpriteTypes.Enemy, routePosition.x, routePosition.y, false);
                ++added;
            }
        }

        return added;
    };

    pIntegration.PlaceGrammarSpriteGroups = function(pGroups) {
        var context = Session.MapGenContext;
        var plan = this.GrammarSpritePlan();
        var groups = pGroups || [];
        var placed = {};
        var total = 0;
        var enemyRequested = 0;
        var enemyPlaced = 0;

        if(!plan)
            return true;

        for(var groupIndex = 0; groupIndex < groups.length; ++groupIndex) {
            var groupName = groups[groupIndex];
            var group = plan[groupName] || [];
            placed[groupName] = 0;
            if(groupName === "enemies" && context)
                context.LiveEnemyPlacements = [];

            if(groupName === "structureSprites" && Session.TotalStructures && Session.TotalStructures() > 0) {
                MapGen.Grammar.LiveMaterialization.Ensure(context).structureSpritesSkipped = group.length;
                continue;
            }

            for(var index = 0; index < group.length; ++index) {
                if(this.PlaceGrammarSpritePlacement(group[index])) {
                    ++placed[groupName];
                    ++total;
                }
            }

            if(groupName === "enemies") {
                enemyRequested = group.length;
                enemyPlaced = placed[groupName];
            }
        }

        var enemyFallbacks = this.PlaceGrammarBeachEnemyFallbacks(enemyPlaced, enemyRequested);
        if(enemyFallbacks) {
            placed.enemyFallbacks = enemyFallbacks;
            total += enemyFallbacks;
        }

        var liveMat = MapGen.Grammar.LiveMaterialization.Ensure(context);
        liveMat.spriteGroups = placed;
        liveMat.spriteCount = total;
        if(context.GrammarLiveTerrain && context.GrammarLiveTerrain.mode === "localized_beach_river") {
            MapGen.Grammar.LiveMaterialization.SetMode(
                context,
                "grammar_live_sprite_plan_over_owned_beach_terrain",
                "grammar_owned_beach_tile_layer"
            );
        }
        else if(liveMat.liveConstructionOwner === "official_grammar") {
            MapGen.Grammar.LiveMaterialization.SetMode(
                context,
                "grammar_live_tile_and_sprite_plan",
                "grammar_owned_context_tile_layer"
            );
        }
        else {
            MapGen.Grammar.LiveMaterialization.SetMode(
                context,
                "grammar_live_sprite_plan_over_shared_runtime_terrain",
                "shared_context_tile_layer"
            );
        }
        return true;
    };

    pIntegration.PrimaryPath = function() {
        var context = Session.MapGenContext;

        if(!context || !context.Paths)
            return null;

        if(MapGen.Layout && MapGen.Layout.CriticalSites &&
            MapGen.Layout.CriticalSites.CampaignObjectiveRoute &&
            context.Anchors && context.Anchors.objective) {
            var objectiveRoute = MapGen.Layout.CriticalSites.CampaignObjectiveRoute(context);
            if(objectiveRoute && objectiveRoute.points && objectiveRoute.points.length)
                return objectiveRoute;
        }

        for(var index = 0; index < context.Paths.length; ++index) {
            if(context.Paths[index].role === "primary")
                return context.Paths[index];
        }

        return context.Paths.length ? context.Paths[0] : null;
    };

    pIntegration.RoutePosition = function(pIndex, pCount, pOffsetTiles) {
        var path = this.PrimaryPath();

        if(!path || !path.points || !path.points.length)
            return null;

        var fraction = (pIndex + 1) / (pCount + 1);
        var pointIndex = Math.min(path.points.length - 1, Math.max(0, Math.floor(path.points.length * fraction)));
        var point = {
            x: path.points[pointIndex].x,
            y: path.points[pointIndex].y
        };

        if(pOffsetTiles) {
            if(pIndex % 2)
                point.x += pOffsetTiles;
            else
                point.y += pOffsetTiles;
        }

        point.x = Math.max(1, Math.min(Session.MapGenContext.Width - 2, point.x));
        point.y = Math.max(1, Math.min(Session.MapGenContext.Height - 2, point.y));

        return this.TileToPosition(point);
    };

    pIntegration.GrammarBeachMissionGoalMinimum = function(pContext) {
        var stats = pContext &&
            pContext.Profile &&
            pContext.Profile.TargetPack &&
            pContext.Profile.TargetPack.targets &&
            pContext.Profile.TargetPack.targets.objectiveInteraction ?
            pContext.Profile.TargetPack.targets.objectiveInteraction.objectiveCount : null;
        var range = stats ? stats.targetRange || stats.wideRange || null : null;
        var low = range && range.length > 1 ? Number(range[0]) : NaN;

        if(isFinite(low))
            return Math.ceil(low);

        return null;
    };

    pIntegration.GrammarBeachNonEnemyMissionGoalCount = function(pContext) {
        var plan = pContext && pContext.GrammarPlan && pContext.GrammarPlan.spritePlan ?
            pContext.GrammarPlan.spritePlan : {};
        var structureSprites = plan.structureSprites || [];
        var count = 0;
        var index;

        for(index = 0; index < structureSprites.length; ++index) {
            if(structureSprites[index].role === "objective_doors" ||
                structureSprites[index].role === "civilian_doors")
                ++count;
        }

        count += (plan.hostages || []).length;
        count += (plan.extraction || []).length;
        count += (plan.civilians || []).length;

        return count;
    };

    pIntegration.CampaignEnemyTargetCount = function(pRequestedCount) {
        var context = Session.MapGenContext;
        var requested = Math.max(0, Math.floor(pRequestedCount || 0));
        var planned = context && context.Placements && context.Placements.enemies ? context.Placements.enemies.length : 0;
        var density = context && context.Profile ? context.Profile.EnemyDensity || 1 : 1;
        var areaTarget = context ? Math.round((context.Width * context.Height / 650) * density) : requested;
        var target = Math.max(requested, areaTarget);
        var grammarBeachEnemyMinimum = null;

        if(context &&
            context.Profile &&
            context.Profile.TargetPackProfile === "grammar_beach") {
            var missionGoalMin = this.GrammarBeachMissionGoalMinimum(context);
            if(missionGoalMin !== null) {
                grammarBeachEnemyMinimum = Math.max(0, missionGoalMin - this.GrammarBeachNonEnemyMissionGoalCount(context));
                target = Math.max(target, grammarBeachEnemyMinimum);
            }
        }

        if(planned) {
            if(grammarBeachEnemyMinimum !== null)
                target = Math.min(Math.max(planned, grammarBeachEnemyMinimum), target);
            else
                target = Math.min(planned, target);
        }

        return Math.max(requested, target);
    };

})(MapGen.Integration);
