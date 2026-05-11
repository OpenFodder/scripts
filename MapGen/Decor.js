var MapGen = MapGen || {};
MapGen.Decor = MapGen.Decor || {};
MapGen.Decor.Templates = MapGen.Decor.Templates || {};

MapGen.Decor.DistanceSq = function(pA, pB) {
    var dx = pA.x - pB.x;
    var dy = pA.y - pB.y;
    return (dx * dx) + (dy * dy);
};

MapGen.Decor.TooCloseToPlacement = function(pContext, pPoint, pDistance) {
    var groups = ["players", "teams", "enemies", "objectives", "structures", "pickups", "vehicles"];
    var minDistanceSq = pDistance * pDistance;

    for(var groupIndex = 0; groupIndex < groups.length; ++groupIndex) {
        var group = pContext.Placements[groups[groupIndex]] || [];

        for(var index = 0; index < group.length; ++index) {
            if(group[index].point && this.DistanceSq(group[index].point, pPoint) < minDistanceSq)
                return true;
        }
    }

    return false;
};

MapGen.Decor.TooCloseToDecor = function(pContext, pPoint, pDistance) {
    var decor = pContext.Placements.decor || [];
    var minDistanceSq = pDistance * pDistance;

    for(var index = 0; index < decor.length; ++index) {
        if(decor[index].point && this.DistanceSq(decor[index].point, pPoint) < minDistanceSq)
            return true;
    }

    return false;
};

MapGen.Decor.IsOpenLand = function(pContext, pPoint) {
    if(!MapGen.Layers.InBounds(pContext.Layers.blocked, pPoint.x, pPoint.y))
        return false;
    if(MapGen.Layers.Get(pContext.Layers.water, pPoint.x, pPoint.y, 0))
        return false;
    if(MapGen.Layers.Get(pContext.Layers.riverBank, pPoint.x, pPoint.y, 0))
        return false;
    if(MapGen.Layers.Get(pContext.Layers.blocked, pPoint.x, pPoint.y, 0))
        return false;
    if(MapGen.Layers.Get(pContext.Layers.occupied, pPoint.x, pPoint.y, 0))
        return false;
    return true;
};

MapGen.Decor.NearLayer = function(pLayer, pX, pY, pRadius) {
    for(var x = pX - pRadius; x <= pX + pRadius; ++x) {
        for(var y = pY - pRadius; y <= pY + pRadius; ++y) {
            if(MapGen.Layers.Get(pLayer, x, y, 0))
                return true;
        }
    }

    return false;
};

MapGen.Decor.LayerInRect = function(pLayer, pMinX, pMinY, pMaxX, pMaxY) {
    for(var x = pMinX; x <= pMaxX; ++x) {
        for(var y = pMinY; y <= pMaxY; ++y) {
            if(MapGen.Layers.Get(pLayer, x, y, 0))
                return true;
        }
    }

    return false;
};

MapGen.Decor.Register = function(pTerrainType, pTemplate) {
    pTemplate.terrain = pTerrainType;
    var list = MapGen.Decor.Templates[pTerrainType] = MapGen.Decor.Templates[pTerrainType] || [];
    list.push(pTemplate);
};

MapGen.Decor.TemplatesFor = function(pTerrainType) {
    return MapGen.Decor.Templates[pTerrainType] || [];
};

// Names like "water_patch" and "rock" are reused across biomes with different
// palettes. Resolve strictly under the placement's terrain so the materialized
// tile palette can never drift to another biome.
MapGen.Decor.TemplateByName = function(pTerrainType, pName) {
    var list = MapGen.Decor.Templates[pTerrainType];
    if(!list)
        return null;

    for(var index = 0; index < list.length; ++index) {
        if(list[index].name === pName)
            return list[index];
    }

    return null;
};

MapGen.Decor.DesiredCount = function(pContext, pTemplate) {
    var areaScale = (pContext.Width * pContext.Height) / (96 * 72);
    var density = pContext.Profile.DecorDensity === undefined ? 1.0 : pContext.Profile.DecorDensity;
    var base = pTemplate.baseCount || 0;
    var minimum = pTemplate.minCount || 0;

    return Math.max(minimum, Math.round(base * areaScale * density));
};

MapGen.Decor.IsReadableGround = function(pContext, pPoint, pTemplate) {
    if(!MapGen.Layers.InBounds(pContext.Layers.blocked, pPoint.x, pPoint.y))
        return false;
    if(MapGen.Layers.Get(pContext.Layers.water, pPoint.x, pPoint.y, 0))
        return false;
    if(MapGen.Layers.Get(pContext.Layers.occupied, pPoint.x, pPoint.y, 0))
        return false;
    if(MapGen.Layers.Get(pContext.Layers.blocked, pPoint.x, pPoint.y, 0))
        return false;
    // The cliff foot is a visual landing, not spare decor space.  Some decor
    // (notably jungle shrubs) intentionally permits keepClear so checking that
    // layer alone cannot protect the late cliff overlay from truncated art.
    if(pContext.CliffFootApron &&
        pContext.CliffFootApron[pPoint.x + "," + pPoint.y])
        return false;
    if(pTemplate.footprint && !pTemplate.footprint(pContext, pPoint))
        return false;

    var onKeepClear = MapGen.Layers.Get(pContext.Layers.keepClear, pPoint.x, pPoint.y, 0) ||
        MapGen.Layers.Get(pContext.Layers.path, pPoint.x, pPoint.y, 0);

    if(onKeepClear) {
        if(!pTemplate.allowKeepClear)
            return false;
    }
    else if(pTemplate.avoidKeepClearRadius &&
        (this.NearLayer(pContext.Layers.keepClear, pPoint.x, pPoint.y, pTemplate.avoidKeepClearRadius) ||
         this.NearLayer(pContext.Layers.path, pPoint.x, pPoint.y, pTemplate.avoidKeepClearRadius))) {
        return false;
    }

    if(this.TooCloseToPlacement(pContext, pPoint, pTemplate.placeDistance))
        return false;
    if(this.TooCloseToDecor(pContext, pPoint, pTemplate.decorDistance))
        return false;

    return true;
};

MapGen.Decor.CandidateScore = function(pContext, pPoint, pTemplate) {
    var score = MapGen.Random.HashTile(pContext.Seed, pPoint.x, pPoint.y, pTemplate.scoreSalt);

    if(pTemplate.bonus)
        score += pTemplate.bonus(pContext, pPoint);

    return score;
};

MapGen.Decor.Candidates = function(pContext, pTemplate) {
    var candidates = [];

    for(var x = 1; x < pContext.Width - 1; ++x) {
        for(var y = 1; y < pContext.Height - 1; ++y) {
            var point = { x: x, y: y };

            if(!this.IsReadableGround(pContext, point, pTemplate))
                continue;

            candidates.push({
                point: point,
                score: this.CandidateScore(pContext, point, pTemplate)
            });
        }
    }

    candidates.sort(function(pLeft, pRight) {
        if(pLeft.score !== pRight.score)
            return pLeft.score - pRight.score;
        // Total-order tiebreak on unique cell coords: equal scores must not
        // reorder between launches (the engine's Array.sort is unstable).
        if(pLeft.point.x !== pRight.point.x)
            return pLeft.point.x - pRight.point.x;
        return pLeft.point.y - pRight.point.y;
    });

    return candidates;
};

MapGen.Decor.AddPlacement = function(pContext, pTemplate, pPoint) {
    pContext.Placements.decor.push({
        kind: "decor",
        template: pTemplate.name,
        terrain: pTemplate.terrain,
        role: "readability_safe",
        point: { x: pPoint.x, y: pPoint.y },
        radius: pTemplate.recordRadius || 1,
        approach: 0
    });
};

MapGen.Decor.BuildKind = function(pContext, pTemplate) {
    // Farthest-point sampling. The legacy "take the N lowest-hash candidates"
    // selector enforced decorDistance as a floor but did nothing to spread
    // placements across the map: with only a few picks the lowest hashes
    // routinely clumped in one region. Each placement after the first now
    // picks the candidate that maximises the minimum distance to already-
    // placed decor (hash + bonus is the tiebreak), so on big maps the picks
    // fan out instead of clustering. decorDistance is still enforced via
    // IsReadableGround so dense fillers like rock/shrub keep their tight
    // spacing — only the *order* of selection changes.
    var desired = this.DesiredCount(pContext, pTemplate);
    if(desired <= 0)
        return 0;

    var candidates = this.Candidates(pContext, pTemplate);
    if(!candidates.length)
        return 0;

    var placedPoints = [];
    var placed = 0;

    // Anchor: lowest-hash valid candidate. Matches legacy first-pick so seeds
    // that previously placed at point P keep that anchor; only spread changes.
    for(var i = 0; i < candidates.length; ++i) {
        if(this.IsReadableGround(pContext, candidates[i].point, pTemplate)) {
            this.AddPlacement(pContext, pTemplate, candidates[i].point);
            placedPoints.push(candidates[i].point);
            ++placed;
            break;
        }
    }

    var decorDistanceSq = (pTemplate.decorDistance || 0) *
        (pTemplate.decorDistance || 0);
    while(placed < desired) {
        var bestIdx = -1;
        var bestMinDist = -1;
        var bestScore = 0;

        for(var ci = 0; ci < candidates.length; ++ci) {
            var c = candidates[ci];
            var minDist = Number.POSITIVE_INFINITY;
            for(var pi = 0; pi < placedPoints.length; ++pi) {
                var d = this.DistanceSq(c.point, placedPoints[pi]);
                if(d < minDist) minDist = d;
            }

            // Candidates were fully validated once above. Placing decor does
            // not mutate terrain or encounter layers, so repeating the costly
            // footprint/near-layer/all-decor checks for every farthest-point
            // round was redundant. Only distance to decor added by this kind
            // can have changed since candidate construction.
            if(minDist < decorDistanceSq)
                continue;

            if(minDist > bestMinDist || (minDist === bestMinDist && (bestIdx < 0 || c.score < bestScore))) {
                bestMinDist = minDist;
                bestIdx = ci;
                bestScore = c.score;
            }
        }

        if(bestIdx < 0)
            break;

        this.AddPlacement(pContext, pTemplate, candidates[bestIdx].point);
        placedPoints.push(candidates[bestIdx].point);
        ++placed;
    }

    return placed;
};

// T1.7: enemies, pickups, structures and objectives have all been placed by
// the time we get here. Erode the tree mask within a configurable radius of
// each so encounters read as deliberate defensive setups rather than spawning
// inside dense forest. Reuses the keepClear discs Encounters already stamped;
// also adds an extra outward ring of decor-clearing for visibility.
MapGen.Decor.CarveEncounterClearings = function(pContext) {
    var profile = pContext.Profile || {};
    var ringRadius = (typeof profile.EncounterClearingRadius === "number") ?
        profile.EncounterClearingRadius : 3;
    if(ringRadius <= 0) return 0;


    var groups = ["enemies", "pickups", "vehicles", "structures", "objectives", "players", "teams"];
    var carved = 0;

    for(var groupIndex = 0; groupIndex < groups.length; ++groupIndex) {
        var group = pContext.Placements[groups[groupIndex]] || [];

        for(var i = 0; i < group.length; ++i) {
            var placement = group[i];
            if(!placement || !placement.point) continue;
            // Official grammar resolves exact building rectangles in
            // GameplayPlan and commits them later. The feature pass also
            // leaves schematic structure placements at the authored clearing
            // points; carving both rings wastes tree capacity at stale
            // coordinates. Keep individual enemy/objective/pickup clearings,
            // and let live structure reservation own the exact footprint.
            if(groups[groupIndex] === "structures" &&
                pContext.GameplayPlan && pContext.GameplayPlan.ok &&
                placement.kind !== "live_structure")
                continue;
            var radius = ringRadius + ((placement.radius | 0));

            for(var dy = -radius; dy <= radius; ++dy) {
                for(var dx = -radius; dx <= radius; ++dx) {
                    if(dx * dx + dy * dy > radius * radius) continue;
                    var x = placement.point.x + dx;
                    var y = placement.point.y + dy;
                    if(!MapGen.Layers.InBounds(pContext.Layers.blocked, x, y)) continue;
                    if(MapGen.Layers.Get(pContext.Layers.water, x, y, 0)) continue;
                    if(MapGen.Layers.Get(pContext.Layers.coast, x, y, 0)) continue;
                    if(MapGen.Layers.Get(pContext.Layers.blocked, x, y, 0)) {
                        MapGen.Layers.Set(pContext.Layers.blocked, x, y, 0);
                        ++carved;
                    }
                    MapGen.Layers.Set(pContext.Layers.keepClear, x, y, 1);
                }
            }
        }
    }

    if(carved > 0)
        MapGen.Context.AddLog(pContext, "Carved " + carved + " tree cells from encounter clearings");
    return carved;
};

MapGen.Decor.Build = function(pContext) {
    var self = this;
    MapGen.Context.Time(pContext, "Decor.Carve", function() {
        self.CarveEncounterClearings(pContext);
    });

    var templates = this.TemplatesFor(pContext.Profile.TerrainType);
    var summary = [];

    for(var index = 0; index < templates.length; ++index) {
        var template = templates[index];
        var count = MapGen.Context.Time(pContext, "Decor." + (template.name || ("kind_" + index)), function() {
            return self.BuildKind(pContext, template);
        });
        summary.push(template.name + "=" + count);
    }

    MapGen.Context.AddLog(pContext, "Built decor placement plan " + (summary.length ? summary.join(", ") : "(no templates)"));
    return pContext;
};
