var MapGen = MapGen || {};
MapGen.Integration = MapGen.Integration || {};

(function(pIntegration) {
    pIntegration.MultiplayerObjectivePosition = function(pSpawns) {
        var placement = this.PlannedPlacementBy("objectives", "prisoner", "prisoner");

        if(placement)
            return this.TileToPosition(placement.point);

        return Teams.PositionOnTeamPath(pSpawns, 0.5);
    };

    pIntegration.MultiplayerExtractionZones = function(pSpawns) {
        var zones = [];
        var roles = ["team_a_extraction", "team_b_extraction"];

        for(var index = 0; index < pSpawns.length && index < roles.length; ++index) {
            var placement = this.PlannedPlacementBy("objectives", "extraction_zone", roles[index]);
            if(placement)
                zones.push(this.TileToPosition(placement.point));
            else
                zones.push(Teams.FindNearbyWalkable(pSpawns[index], index));
        }

        return zones;
    };

    pIntegration.MultiplayerPickupSpriteType = function(pTemplate, pIndex) {
        switch(pTemplate) {
            case "heavy_weapon":
            case "rockets":
                return SpriteTypes.RocketBox;

            case "grenades":
                return SpriteTypes.GrenadeBox;

            // grenades_or_rockets is the support-pickup template at the support
            // anchor (Features.BuildAnchorPickups). The name says either is fine,
            // but the prior implementation always emitted GrenadeBox — that
            // disagrees with Sprites.js classifying type 38 as "rocket_support".
            // Alternate by index so support spawns get a useful weapon mix,
            // with rockets first.
            case "grenades_or_rockets":
                return (pIndex % 2) === 0 ? SpriteTypes.RocketBox : SpriteTypes.GrenadeBox;

            case "ammo":
            default:
                return (pIndex % 3) === 1 ? SpriteTypes.RocketBox : SpriteTypes.GrenadeBox;
        }
    };

    pIntegration.PlaceMultiplayerPickups = function(pSpawns) {
        var placements = this.PlannedPlacements("pickups");
        var placed = 0;

        if(!placements.length)
            return false;

        for(var index = 0; index < placements.length; ++index) {
            var placement = placements[index];
            if(!placement.point)
                continue;

            var position = this.TileToPosition(placement.point);
            var spriteType = this.MultiplayerPickupSpriteType(placement.template, index);
            Map.SpriteAdd(spriteType, position.x, position.y);
            ++placed;
        }

        return placed > 0;
    };

    pIntegration.MultiplayerTeamSpawns = function(pTeamCount) {
        var context = Session.MapGenContext;
        var spawns = [];

        if(!context || !context.Placements || !context.Placements.teams)
            return spawns;

        for(var index = 0; index < context.Placements.teams.length; ++index) {
            var placement = context.Placements.teams[index];
            if(!placement.point)
                continue;

            var spawnTile = this.FindDryMultiplayerTeamSpawnTile(context, placement.point);
            spawns.push(this.TileToPosition(spawnTile));
        }

        if(spawns.length)
            Session.HumanPosition = new cPosition(spawns[0].x, spawns[0].y);

        Session.TeamSpawns = spawns.slice(0, Math.max(1, Math.min(pTeamCount || spawns.length, spawns.length)));
        return Session.TeamSpawns;
    };

    pIntegration.MultiplayerTeamSpawnPadOffsets = [
        { x: -1, y: -1 },
        { x: 0, y: -1 },
        { x: 1, y: -1 },
        { x: -1, y: 0 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: -1, y: 1 },
        { x: 0, y: 1 },
        { x: 1, y: 1 }
    ];

    pIntegration.SavedTeamSpawnPadDry = function(pContext, pPoint) {
        if(!pContext || !pPoint)
            return true;

        for(var index = 0; index < this.MultiplayerTeamSpawnPadOffsets.length; ++index) {
            var offset = this.MultiplayerTeamSpawnPadOffsets[index];
            var x = pPoint.x + offset.x;
            var y = pPoint.y + offset.y;
            if(x < 0 || y < 0 || x >= pContext.Width || y >= pContext.Height)
                return false;
            // Engine collision (HIT/BHT) is the authority for "can a unit stand
            // here" — biome-agnostic and matches the running game, so a spawn pad
            // can't land on water OR a solid tree the old ice-water-only tile check
            // missed. (Runs post-render; Map.TileTerrainFeature reads final tiles.)
            if(!this.GroundActorCellStandable(pContext, x, y))
                return false;
        }

        return true;
    };

    pIntegration.FindDryMultiplayerTeamSpawnTile = function(pContext, pPoint) {
        if(!pPoint || this.SavedTeamSpawnPadDry(pContext, pPoint))
            return pPoint;

        var best = null;
        var bestDist = 0x7FFFFFFF;
        var maxRadius = Math.max(4, Math.min(10, Math.floor(Math.min(pContext.Width, pContext.Height) / 8)));

        for(var radius = 1; radius <= maxRadius; ++radius) {
            for(var dx = -radius; dx <= radius; ++dx) {
                for(var dy = -radius; dy <= radius; ++dy) {
                    if(Math.max(Math.abs(dx), Math.abs(dy)) !== radius)
                        continue;

                    var candidate = { x: pPoint.x + dx, y: pPoint.y + dy };
                    if(!this.SavedTeamSpawnPadDry(pContext, candidate))
                        continue;

                    var dist = (dx * dx) + (dy * dy);
                    if(dist < bestDist) {
                        best = candidate;
                        bestDist = dist;
                    }
                }
            }

            if(best)
                break;
        }

        if(best) {
            MapGen.Context.AddLog(
                pContext,
                "Adjusted multiplayer team spawn from " + pPoint.x + "," + pPoint.y +
                    " to " + best.x + "," + best.y + " for dry saved-map pad"
            );
            return best;
        }

        return pPoint;
    };

    pIntegration.PositionToTile = function(pPosition) {
        return {
            x: Math.floor(pPosition.x / 16),
            y: Math.floor(pPosition.y / 16)
        };
    };

    pIntegration.SavedTileDryForMultiplayerSpawn = function(pContext, pPoint) {
        if(!pContext || !pPoint)
            return true;
        if(pPoint.x < 0 || pPoint.y < 0 || pPoint.x >= pContext.Width || pPoint.y >= pContext.Height)
            return false;
        // Engine collision authority (see SavedTeamSpawnPadDry): rejects water and
        // solid tiles alike, replacing the ice-water-only rendered-tile check.
        return this.GroundActorCellStandable(pContext, pPoint.x, pPoint.y);
    };

    pIntegration.PointAlreadyUsedBySpawn = function(pPoint, pExisting) {
        if(!pExisting)
            return false;

        for(var index = 0; index < pExisting.length; ++index) {
            var existing = pExisting[index];
            if(existing && Math.floor(existing.x / 16) === pPoint.x && Math.floor(existing.y / 16) === pPoint.y)
                return true;
        }

        return false;
    };

    pIntegration.AdjustMultiplayerPlayerSpawnPosition = function(pContext, pCenter, pPosition, pExisting) {
        if(!pContext || !pPosition)
            return pPosition;

        var tile = this.PositionToTile(pPosition);
        if(this.SavedTileDryForMultiplayerSpawn(pContext, tile) && !this.PointAlreadyUsedBySpawn(tile, pExisting))
            return pPosition;

        var centerTile = this.PositionToTile(pCenter);
        var best = null;
        var bestScore = 0x7FFFFFFF;
        var maxRadius = 5;

        for(var radius = 1; radius <= maxRadius; ++radius) {
            for(var dx = -radius; dx <= radius; ++dx) {
                for(var dy = -radius; dy <= radius; ++dy) {
                    if(Math.max(Math.abs(dx), Math.abs(dy)) !== radius)
                        continue;

                    var candidate = { x: centerTile.x + dx, y: centerTile.y + dy };
                    if(!this.SavedTileDryForMultiplayerSpawn(pContext, candidate))
                        continue;
                    if(this.PointAlreadyUsedBySpawn(candidate, pExisting))
                        continue;

                    var idX = candidate.x - tile.x;
                    var idY = candidate.y - tile.y;
                    var cX = candidate.x - centerTile.x;
                    var cY = candidate.y - centerTile.y;
                    var score = (idX * idX) + (idY * idY) + ((cX * cX) + (cY * cY)) * 2;
                    if(score < bestScore) {
                        best = candidate;
                        bestScore = score;
                    }
                }
            }

            if(best)
                break;
        }

        return best ? this.TileToPosition(best) : pPosition;
    };
})(MapGen.Integration);
