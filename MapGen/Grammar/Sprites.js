var MapGen = MapGen || {};
MapGen.Grammar = MapGen.Grammar || {};

MapGen.Grammar.Sprites = {

    HasOwn: function(pObject, pKey) { return MapGen.Grammar.Util.HasOwn(pObject, pKey); },

    NumberOrNull: function(pValue) { return MapGen.Grammar.Util.NumberOrNull(pValue); },

    Clamp: function(pValue, pMin, pMax) { return MapGen.Grammar.Util.Clamp(pValue, pMin, pMax); },

    Round: function(pValue, pPlaces) { return MapGen.Grammar.Util.Round(pValue, pPlaces); },

    StatRange: function(pStats, pPreferWide) { return MapGen.Grammar.Util.StatRange(pStats, pPreferWide); },

    PickStatNumber: function(pRandom, pStats, pInteger, pFallback) {
        return MapGen.Grammar.Util.PickStatNumber(pRandom, pStats, pInteger, pFallback);
    },

    RangeSummary: function(pStats) { return MapGen.Grammar.Util.RangeSummary(pStats); },

    WeightedPick: function(pRandom, pWeights, pFallback) {
        var entries = [];
        var total = 0;
        var key;

        for(key in (pWeights || {})) {
            if(!this.HasOwn(pWeights, key))
                continue;

            var weight = Number(pWeights[key]);
            if(!isFinite(weight) || weight <= 0)
                continue;

            entries.push({ name: key, weight: weight });
            total += weight;
        }

        if(!entries.length || total <= 0)
            return pFallback || null;

        var roll = pRandom.Float(0, total);
        var cumulative = 0;

        for(var index = 0; index < entries.length; ++index) {
            cumulative += entries[index].weight;
            if(roll <= cumulative)
                return entries[index].name;
        }

        return entries[entries.length - 1].name;
    },

    ParseSpriteType: function(pKey, pFallbackType, pFallbackName) {
        var key = String(pKey || "");
        var open = key.lastIndexOf("(");
        var close = key.lastIndexOf(")");
        var type = this.NumberOrNull(pFallbackType);
        var name = pFallbackName || key || "sprite";

        if(open >= 0 && close > open) {
            var parsed = this.NumberOrNull(key.substring(open + 1, close));
            if(parsed !== null)
                type = parsed;
            name = key.substring(0, open);
        }

        if(type === null)
            type = 5;

        return {
            type: Math.round(type),
            name: name || ("type_" + Math.round(type)),
            sourceKey: key
        };
    },

    RoleTargets: function(pTargets, pRole) {
        var placement = pTargets ? pTargets.spriteRolePlacement || {} : {};
        var roles = placement.roles || {};
        return roles[pRole] || {};
    },

    RoleCountStats: function(pTargets, pRole, pCompositionRole) {
        var roleTarget = this.RoleTargets(pTargets, pRole);
        var style = pTargets ? pTargets.styleSpriteRoles || {} : {};
        var styleCounts = style.roleCounts || {};
        var composition = pTargets ? pTargets.composition || {} : {};
        var spriteCounts = composition.spriteCounts || {};

        if(roleTarget.count)
            return roleTarget.count;
        if(styleCounts[pRole])
            return styleCounts[pRole];
        if(pCompositionRole && spriteCounts[pCompositionRole])
            return spriteCounts[pCompositionRole];
        return null;
    },

    RoleCount: function(pContext, pTargets, pRole, pCompositionRole, pFallback, pMin, pMax) {
        var count = this.PickStatNumber(
            pContext.Random,
            this.RoleCountStats(pTargets, pRole, pCompositionRole),
            true,
            pFallback || 0
        );

        count = Math.max(pMin || 0, count);
        if(pMax !== undefined)
            count = Math.min(pMax, count);

        return count;
    },

    ApplyPickupDensity: function(pContext, pCount) {
        var profile = pContext && pContext.Profile ? pContext.Profile : {};
        var scale = this.NumberOrNull(profile.ForcedPickupDensityScale);

        if(scale === null)
            scale = this.NumberOrNull(profile.PickupDensityScale);
        if(scale === null)
            return pCount;

        return Math.max(0, Math.round(pCount * Math.max(0, scale)));
    },

    RequestedVehicleCount: function(pContext, pFallbackCount, pForceVehicle) {
        var profile = pContext && pContext.Profile ? pContext.Profile : {};
        var requested = this.NumberOrNull(profile.ForcedVehicleCount);
        var minimum = pForceVehicle ? 1 : 0;

        if(requested === null)
            requested = this.NumberOrNull(profile.VehicleCount);

        if(requested === null)
            return Math.max(minimum, pFallbackCount);

        return Math.max(minimum, Math.min(4, Math.floor(requested)));
    },

    RequestedVehicleSprite: function(pContext, pIndex, pFallbackSprite) {
        var profile = pContext && pContext.Profile ? pContext.Profile : {};
        var set = this.NumberOrNull(profile.ForcedVehicleSet);
        var types;
        var names;
        var pick;

        if(set === null)
            set = this.NumberOrNull(profile.VehicleSet);

        if(set === null || typeof NetworkVehicleSets === "undefined" || set === NetworkVehicleSets.None)
            return pFallbackSprite;

        switch(set) {
            case NetworkVehicleSets.Light:
                types = [typeof SpriteTypes !== "undefined" ? SpriteTypes.VehicleNoGun_Human : 63];
                names = ["VehicleNoGun_Human"];
                break;

            case NetworkVehicleSets.Tanks:
                types = [typeof SpriteTypes !== "undefined" ? SpriteTypes.Tank_Human : 65];
                names = ["Tank_Human"];
                break;

            case NetworkVehicleSets.Mixed:
                types = [
                    typeof SpriteTypes !== "undefined" ? SpriteTypes.VehicleNoGun_Human : 63,
                    typeof SpriteTypes !== "undefined" ? SpriteTypes.VehicleGun_Human : 64,
                    typeof SpriteTypes !== "undefined" ? SpriteTypes.Tank_Human : 65
                ];
                names = ["VehicleNoGun_Human", "VehicleGun_Human", "Tank_Human"];
                break;

            case NetworkVehicleSets.Armed:
            default:
                types = [typeof SpriteTypes !== "undefined" ? SpriteTypes.VehicleGun_Human : 64];
                names = ["VehicleGun_Human"];
                break;
        }

        pick = Math.abs(pIndex || 0) % types.length;
        return {
            type: types[pick],
            name: names[pick],
            source: "random_map_vehicle_set",
            sourceKey: "vehicle_set"
        };
    },

    RoleObservedMax: function(pTargets, pRole, pCompositionRole) {
        var stats = this.RoleCountStats(pTargets, pRole, pCompositionRole);
        var max = this.NumberOrNull(stats ? stats.max : null);

        if(max !== null)
            return max;

        return this.Keys(this.TypeWeights(pTargets, pRole)).length > 0 ? 1 : 0;
    },

    IsBeachProfile: function(pContext) {
        return !!(pContext &&
            pContext.Profile &&
            pContext.Profile.TargetPackProfile === "grammar_beach");
    },

    IsIceProfile: function(pContext) {
        return !!(pContext &&
            pContext.Profile &&
            pContext.Profile.TargetPackProfile === "grammar_ice");
    },

    RocketEnemyStartClearance: function(pContext) {
        var value = pContext && pContext.Profile ?
            Number(pContext.Profile.RocketEnemyStartClearance) : NaN;

        if(!isFinite(value))
            value = 14;
        return Math.max(8, Math.floor(value));
    },

    PointNearCampaignStart: function(pContext, pPoint, pClearance) {
        var start = pContext && pContext.Anchors ? pContext.Anchors.start : null;
        if(!start || !pPoint)
            return false;

        var dx = pPoint.x - start.x;
        var dy = pPoint.y - start.y;
        return (dx * dx) + (dy * dy) < pClearance * pClearance;
    },

    MobileEnemyPressureRole: function(pFraction) {
        if(pFraction < 0.34)
            return "early_route";
        if(pFraction < 0.68)
            return "mid_route";
        return "objective_guard";
    },

    ApplyRocketEnemyStartSafety: function(pContext, pPoint, pPressureRole, pSprite) {
        var rocketType = this.SpriteTypeId("Enemy_Rocket", 36);
        if(!pSprite || pSprite.type !== rocketType)
            return pSprite;

        var clearance = this.RocketEnemyStartClearance(pContext);
        if(pPressureRole !== "early_route" &&
            !this.PointNearCampaignStart(pContext, pPoint, clearance))
            return pSprite;

        return {
            type: this.SpriteTypeId("Enemy", 5),
            name: "Enemy",
            role: pSprite.role,
            source: "rocket_start_safety",
            sourceKey: pSprite.sourceKey || "Enemy_Rocket(36)"
        };
    },

    SpriteTypeId: function(pName, pFallback) {
        if(typeof SpriteTypes !== "undefined" && SpriteTypes[pName] !== undefined)
            return SpriteTypes[pName];

        return pFallback;
    },

    IsUnsafeSpriteType: function(pContext, pRole, pSprite) {
        if(!pSprite)
            return false;

        // The "pickups" role exists to drop weapon ammo a squad needs to
        // complete the level. Heavy-explosion-only bunker doors are not valid
        // targets for these ordinary weapon boxes. The shipped TargetPack
        // mines per-profile sprite weights from real maps and includes one-shot bonus pickups
        // (Bonus_RankToGeneral 93, Bonus_Rockets 94, Bonus_Armour 95) in the
        // pickups pool. Those are designer-placed flavour drops in the
        // campaign maps; treating them as weapon-box substitutes leaves
        // random maps without a real weapon at the support anchor. Restrict
        // pickups to GrenadeBox/RocketBox only.
        if(pRole === "pickups") {
            var spriteType = pSprite.type;
            if(spriteType !== 37 && spriteType !== 38)
                return true;
        }

        if(pRole !== "decor" || !this.IsIceProfile(pContext))
            return false;

        return pSprite.type === this.SpriteTypeId("Shrub", 13) ||
            pSprite.name === "Shrub" ||
            pSprite.type === this.SpriteTypeId("GroundHole", 24) ||
            pSprite.name === "GroundHole";
    },

    SafeFallbackSpriteType: function(pContext, pRole, pFallbackType, pFallbackName) {
        var fallback = this.ParseSpriteType(null, pFallbackType, pFallbackName);

        if(this.IsUnsafeSpriteType(pContext, pRole, fallback))
            return {
                type: this.SpriteTypeId("Bird_Right", 67),
                name: "Bird_Right"
            };

        return fallback;
    },

    ObjectiveGoalCountMax: function(pTargets) {
        var stats = pTargets && pTargets.objectiveInteraction ?
            pTargets.objectiveInteraction.objectiveCount : null;
        var range = this.StatRange(stats, false) || this.StatRange(stats, true);

        if(range)
            return Math.max(1, Math.floor(range[1]));

        return null;
    },

    MissionGoalCountSoFar: function(pOut) {
        var count = 0;
        var structureSprites = pOut.structureSprites || [];

        count += (pOut.enemies || []).length;
        count += (pOut.hostages || []).length;
        count += (pOut.extraction || []).length;
        count += (pOut.civilians || []).length;

        for(var index = 0; index < structureSprites.length; ++index) {
            if(structureSprites[index].role === "objective_doors" ||
                structureSprites[index].role === "civilian_doors")
                ++count;
        }

        return count;
    },

    Keys: function(pObject) {
        var result = [];
        var key;

        for(key in (pObject || {})) {
            if(this.HasOwn(pObject, key))
                result.push(key);
        }

        return result;
    },

    TypeWeights: function(pTargets, pRole) {
        var roleTarget = this.RoleTargets(pTargets, pRole);
        var style = pTargets ? pTargets.styleSpriteRoles || {} : {};
        var styleTypes = style.roleTypes || {};

        if(roleTarget.types)
            return roleTarget.types;
        return styleTypes[pRole] || {};
    },

    FilteredTypeWeights: function(pContext, pWeights, pRole) {
        var result = {};
        var changed = false;
        var key;

        for(key in (pWeights || {})) {
            if(!this.HasOwn(pWeights, key))
                continue;

            if(this.IsUnsafeSpriteType(pContext, pRole, this.ParseSpriteType(key, null, ""))) {
                changed = true;
                continue;
            }

            result[key] = pWeights[key];
        }

        return changed ? result : pWeights;
    },

    PickSpriteType: function(pContext, pTargets, pRole, pFallbackType, pFallbackName) {
        var fallback = this.SafeFallbackSpriteType(pContext, pRole, pFallbackType, pFallbackName);
        var weights = this.FilteredTypeWeights(pContext, this.TypeWeights(pTargets, pRole), pRole);
        var picked = this.WeightedPick(pContext.Random, weights, null);
        var parsed = this.ParseSpriteType(picked, fallback.type, fallback.name);
        parsed.role = pRole;
        parsed.source = picked ? "spriteRolePlacement.roles." + pRole + ".types" : "fallback";
        return parsed;
    },

    SptRecord: function(pPoint, pSpriteType) {
        var runtimeX = Math.round(pPoint.x * 16);
        var runtimeY = Math.round(pPoint.y * 16);

        return {
            word0: 0x7C,
            word1: 0,
            storedX: runtimeX - 16,
            runtimeX: runtimeX,
            runtimeY: runtimeY,
            spriteType: pSpriteType
        };
    },

    Placement: function(pId, pRole, pKind, pPoint, pSprite, pSource, pExtra) {
        var point = {
            x: Math.round(pPoint.x),
            y: Math.round(pPoint.y)
        };
        var placement = {
            id: pId,
            role: pRole,
            kind: pKind,
            spriteType: pSprite.type,
            spriteName: pSprite.name,
            point: point,
            runtimePosition: {
                x: point.x * 16,
                y: point.y * 16
            },
            spt: this.SptRecord(point, pSprite.type),
            source: pSource,
            typeSource: pSprite.source,
            sourceTypeKey: pSprite.sourceKey || null
        };
        var key;

        for(key in (pExtra || {})) {
            if(this.HasOwn(pExtra, key))
                placement[key] = pExtra[key];
        }

        return placement;
    },

    ClampPoint: function(pContext, pPoint, pMargin) {
        var margin = pMargin || 1;
        return {
            x: this.Clamp(Math.round(pPoint.x), margin, Math.max(margin, pContext.Width - 1 - margin)),
            y: this.Clamp(Math.round(pPoint.y), margin, Math.max(margin, pContext.Height - 1 - margin))
        };
    },

    OffsetPoint: function(pContext, pPoint, pDx, pDy, pMargin) {
        return this.ClampPoint(
            pContext,
            { x: pPoint.x + pDx, y: pPoint.y + pDy },
            pMargin || 1
        );
    },

    RoutePathPoint: function(pRoutePlan, pIndex, pCount) {
        var path = pRoutePlan && pRoutePlan.routePath ? pRoutePlan.routePath : [];
        var beats = pRoutePlan && pRoutePlan.routeBeats ? pRoutePlan.routeBeats : [];
        var fraction = pCount <= 1 ? 0.5 : (pIndex + 1) / (pCount + 1);
        var index;

        if(path.length) {
            index = Math.max(0, Math.min(path.length - 1, Math.round((path.length - 1) * fraction)));
            return path[index];
        }

        if(beats.length) {
            index = Math.max(0, Math.min(beats.length - 1, Math.round((beats.length - 1) * fraction)));
            return beats[index].point;
        }

        return null;
    },

    RoutePathPointAtFraction: function(pRoutePlan, pFraction) {
        var path = pRoutePlan && pRoutePlan.routePath ? pRoutePlan.routePath : [];
        var beats = pRoutePlan && pRoutePlan.routeBeats ? pRoutePlan.routeBeats : [];
        var fraction = this.Clamp(Number(pFraction) || 0, 0, 1);
        var index;

        if(path.length) {
            index = Math.max(0, Math.min(path.length - 1,
                Math.round((path.length - 1) * fraction)));
            return path[index];
        }

        if(beats.length) {
            index = Math.max(0, Math.min(beats.length - 1,
                Math.round((beats.length - 1) * fraction)));
            return beats[index].point;
        }

        return null;
    },

    ProgressPhase: function(pFraction) {
        if(pFraction < 0.34)
            return "early";
        if(pFraction < 0.68)
            return "mid";
        return "late";
    },

    DistributedFraction: function(pIndex, pCount, pLow, pHigh) {
        var low = pLow === undefined ? 0.22 : pLow;
        var high = pHigh === undefined ? 0.82 : pHigh;
        if(pCount <= 1)
            return (low + high) * 0.5;
        return low + ((pIndex / (pCount - 1)) * (high - low));
    },

    PointDistanceSquared: function(pLeft, pRight) {
        var dx = pLeft.x - pRight.x;
        var dy = pLeft.y - pRight.y;
        return (dx * dx) + (dy * dy);
    },

    ClusterOffsetPoint: function(pContext, pAnchor, pIndex) {
        var offsets = [
            { x: 0, y: 0 },
            { x: 2, y: 0 },
            { x: -2, y: 0 },
            { x: 0, y: 2 },
            { x: 0, y: -2 },
            { x: 2, y: 2 },
            { x: -2, y: 2 },
            { x: 2, y: -2 },
            { x: -2, y: -2 }
        ];
        var offset = offsets[Math.abs(pIndex || 0) % offsets.length];
        return this.OffsetPoint(pContext, pAnchor, offset.x, offset.y, 1);
    },

    BeatWithRole: function(pRoutePlan, pIndex, pRole, pScreenType) {
        var beats = pRoutePlan && pRoutePlan.routeBeats ? pRoutePlan.routeBeats : [];
        var matches = [];
        var index;

        for(index = 0; index < beats.length; ++index) {
            if(pRole && beats[index].routePhase !== pRole && beats[index].role !== pRole)
                continue;
            if(pScreenType && beats[index].screenType !== pScreenType)
                continue;
            matches.push(beats[index]);
        }

        if(!matches.length)
            matches = beats;
        if(!matches.length)
            return null;

        return matches[Math.max(0, Math.min(matches.length - 1, pIndex % matches.length))];
    },

    ObjectiveAnchor: function(pObjectivePlan, pIndex) {
        var objectives = pObjectivePlan && pObjectivePlan.objectives ? pObjectivePlan.objectives : [];
        if(objectives.length)
            return objectives[pIndex % objectives.length].point;

        var beats = pObjectivePlan && pObjectivePlan.objectiveBeats ? pObjectivePlan.objectiveBeats : [];
        if(beats.length)
            return beats[pIndex % beats.length].point;

        return null;
    },

    DoorAnchor: function(pObjectivePlan, pIndex) {
        var doors = pObjectivePlan && pObjectivePlan.doors ? pObjectivePlan.doors : [];
        if(doors.length)
            return doors[pIndex % doors.length].point;
        return this.ObjectiveAnchor(pObjectivePlan, pIndex);
    },

    DirectionVector: function(pBin, pFallbackIndex) {
        var dir = String(pBin || "");
        var cut = dir.indexOf("_");
        if(cut >= 0)
            dir = dir.substring(0, cut);
        if(!dir)
            dir = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][pFallbackIndex % 8];

        if(dir === "N")
            return { x: 0, y: -1 };
        if(dir === "NE")
            return { x: 1, y: -1 };
        if(dir === "E")
            return { x: 1, y: 0 };
        if(dir === "SE")
            return { x: 1, y: 1 };
        if(dir === "S")
            return { x: 0, y: 1 };
        if(dir === "SW")
            return { x: -1, y: 1 };
        if(dir === "W")
            return { x: -1, y: 0 };
        if(dir === "NW")
            return { x: -1, y: -1 };

        return { x: (pFallbackIndex % 2) ? 1 : -1, y: (pFallbackIndex % 3) ? 1 : -1 };
    },

    PairOffsetPoint: function(pContext, pTargets, pPairKey, pAnchor, pIndex, pFallbackDistance) {
        var placement = pTargets ? pTargets.spriteRolePlacement || {} : {};
        var pairOffsets = placement.pairOffsets || {};
        var pair = pairOffsets[pPairKey] || null;
        var direction = pair ? this.WeightedPick(pContext.Random, pair.directionBins || {}, null) : null;
        var vector = this.DirectionVector(direction, pIndex);
        var distance = this.PickStatNumber(
            pContext.Random,
            pair ? pair.distance : null,
            false,
            pFallbackDistance || 4
        );
        var jitter = (pIndex % 3) - 1;

        return this.OffsetPoint(
            pContext,
            pAnchor,
            Math.round(vector.x * distance) + jitter,
            Math.round(vector.y * distance) - jitter,
            1
        );
    },

    MobilityAssets: function(pPlan) {
        var routePlan = pPlan.routePlan || {};
        var mobilityPlan = pPlan.mobilityPlan || routePlan.mobilityPlan || {};
        return mobilityPlan.requiredAssets || mobilityPlan.assetOrdering || [];
    },

    MobilityRequires: function(pPlan, pKind) {
        var intent = pPlan.intent || {};
        var mode = String(intent.mobilityMode || "");
        var assets = this.MobilityAssets(pPlan);
        var index;

        if(pKind === "vehicle" &&
            (mode.indexOf("vehicle") >= 0 || mode.indexOf("skidoo") >= 0))
            return true;
        if(pKind === "helicopter" && mode === "helicopter")
            return true;

        for(index = 0; index < assets.length; ++index) {
            if(assets[index].kind === pKind || assets[index].name === pKind)
                return true;
        }

        return false;
    },

    AssetPoint: function(pPlan, pKind, pIndex) {
        var assets = this.MobilityAssets(pPlan);
        var matches = [];
        var index;

        for(index = 0; index < assets.length; ++index) {
            if(assets[index].kind === pKind || assets[index].name === pKind ||
                (pKind === "vehicle" && assets[index].kind === "vehicle") ||
                (pKind === "helicopter" && assets[index].kind === "helicopter"))
                matches.push(assets[index]);
        }

        if(matches.length && matches[pIndex % matches.length].point)
            return matches[pIndex % matches.length].point;

        return null;
    },

    // Mirror of LiveValidation.js destroy_buildings requirement: ceil(N/4)
    // reachable weapon boxes for N enemy buildings. We count the planned
    // structure-fire objectives (each maps to a building the squad must destroy),
    // which tracks the materialized building count far better than the plan's
    // single compound/structure record. Returns 0 when the objective isn't
    // destroy_buildings (no weapon-box floor needed).
    DestroyBuildingSupportBoxes: function(pPlan) {
        var intent = pPlan.intent || {};
        if(String(intent.objectiveLabel || "") !== "destroy_buildings")
            return 0;

        var objectives = (pPlan.objectivePlan || {}).objectives || [];
        var buildings = 0;
        for(var i = 0; i < objectives.length; ++i) {
            var cls = String(objectives[i].interactionClass || objectives[i].label || "");
            if(cls.indexOf("structure") >= 0 || cls.indexOf("building") >= 0)
                ++buildings;
        }
        if(!buildings)
            return 0;

        return Math.max(1, Math.ceil(buildings / 4));
    },

    ObjectiveNeedsSupportPickup: function(pPlan) {
        var objectivePlan = pPlan.objectivePlan || {};
        var objectives = objectivePlan.objectives || [];
        var intent = pPlan.intent || {};
        var required = intent.requiredAssets || [];
        var index;

        for(index = 0; index < required.length; ++index) {
            if(String(required[index]).indexOf("explosive") >= 0)
                return true;
        }

        for(index = 0; index < objectives.length; ++index) {
            if(String(objectives[index].interactionClass || "").indexOf("explosive") >= 0)
                return true;
        }

        return false;
    },

    // Shared per-item placement loop for the Add* role builders. Each item:
    //   anchor = pSpec.anchor(index)        [no RNG draws]
    //   point  = pSpec.point(index, anchor) [draws first — PairOffset/OffsetPoint]
    //   sprite = pSpec.sprite(index)        [draws second — PickSpriteType]
    // then a Placement is built and pushed. This is the ONE order every former
    // Add* method used, so the LCG draw sequence is preserved exactly and output
    // is byte-identical. Per-role differences (anchor chains, offset formulas,
    // role/kind/source strings, extra fields, secondary buckets) are supplied as
    // closures/values on pSpec — control flow is shared, behaviour is not merged.
    //   pSpec: { count, group, idPrefix, role, kind(index,sprite), source(index),
    //            anchor(index), point(index, anchor), sprite(index),
    //            adjustSprite(index, point, sprite),
    //            extra(index, ctx), also(placement) }
    PlaceRole: function(pContext, pOut, pSpec) {
        for(var index = 0; index < pSpec.count; ++index) {
            var anchor = pSpec.anchor(index);
            var point = pSpec.point(index, anchor);
            var sprite = pSpec.sprite(index);
            if(pSpec.adjustSprite)
                sprite = pSpec.adjustSprite(index, point, sprite);
            var bucket = pOut[pSpec.group];
            var placement = this.Placement(
                pSpec.idPrefix + bucket.length,
                pSpec.role,
                typeof pSpec.kind === "function" ? pSpec.kind(index, sprite) : pSpec.kind,
                point,
                sprite,
                typeof pSpec.source === "function" ? pSpec.source(index) : pSpec.source,
                pSpec.extra ? pSpec.extra(index) : {}
            );

            bucket.push(placement);
            if(pSpec.also)
                pSpec.also(placement);
        }
    },

    AddPlayers: function(pContext, pTargets, pRoutePlan, pOut) {
        var self = this;
        var count = this.RoleCount(pContext, pTargets, "players", "players", 4, 1, 8);
        var firstBeat = this.BeatWithRole(pRoutePlan, 0, "start_zone", "start_screen");
        var anchor = firstBeat ? firstBeat.point : { x: 4, y: Math.floor(pContext.Height / 2) };
        var offsets = [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
            { x: 1, y: 1 },
            { x: -1, y: 0 },
            { x: 0, y: -1 },
            { x: -1, y: 1 },
            { x: 1, y: -1 }
        ];

        // OffsetPoint draws no RNG, so point-before-sprite (PlaceRole's order)
        // consumes the same single PickSpriteType draw as the original.
        this.PlaceRole(pContext, pOut, {
            count: count,
            group: "players",
            idPrefix: "player_",
            role: "players",
            kind: "player_start",
            source: "routePlan.start_screen",
            anchor: function() { return anchor; },
            point: function(index) {
                var o = offsets[index % offsets.length];
                return self.OffsetPoint(pContext, anchor, o.x, o.y, 1);
            },
            sprite: function() { return self.PickSpriteType(pContext, pTargets, "players", 0, "Player"); },
            extra: function() { return { routeBeatId: firstBeat ? firstBeat.id : null }; }
        });
    },

    AddStructureSprites: function(pContext, pObjectivePlan, pOut) {
        var doors = pObjectivePlan && pObjectivePlan.doors ? pObjectivePlan.doors : [];
        var roofs = pObjectivePlan && pObjectivePlan.roofs ? pObjectivePlan.roofs : [];
        var index;

        for(index = 0; index < doors.length; ++index) {
            var door = doors[index];
            var role = door.role === "civilian_door" ? "civilian_doors" : "objective_doors";
            var sprite = {
                type: door.spriteType || (role === "civilian_doors" ? 74 : 20),
                name: door.spriteName || (role === "civilian_doors" ? "Door_Civilian" : "BuildingDoor"),
                source: door.source || "objectivePlan.doors",
                sourceKey: null
            };
            pOut.structureSprites.push(this.Placement(
                "structure_sprite_" + pOut.structureSprites.length,
                role,
                door.role,
                door.point,
                sprite,
                "objectivePlan.doors",
                { compoundId: door.compoundId || null, objectiveSprite: true }
            ));
        }

        for(index = 0; index < roofs.length; ++index) {
            var roof = roofs[index];
            var roofSprite = {
                type: roof.spriteType || 15,
                name: roof.spriteName || "BuildingRoof",
                source: roof.source || "objectivePlan.roofs",
                sourceKey: null
            };
            pOut.structureSprites.push(this.Placement(
                "structure_sprite_" + pOut.structureSprites.length,
                "building_roofs",
                roof.role || "building_roof",
                roof.point,
                roofSprite,
                "objectivePlan.roofs",
                { compoundId: roof.compoundId || null, objectiveSprite: true }
            ));
        }
    },

    AddMobileEnemies: function(pContext, pTargets, pRoutePlan, pObjectivePlan, pOut) {
        var self = this;
        var count = this.RoleCount(pContext, pTargets, "mobile_enemies", "enemies", 6, 1, 32);
        var doors = pObjectivePlan.doors || [];
        var branches = pRoutePlan && pRoutePlan.branches ? pRoutePlan.branches : [];
        var usedBranches = {};
        var slots = [];

        // The corpus role distribution is mission-specific and can legitimately
        // roll one mobile soldier. That works on a compact authored map, but on
        // generated large/XL terrain it leaves whole route phases undefended.
        // Scale only the mobile floor with playable area; fixed guards/turrets
        // remain independently corpus-driven.
        var mapArea = pContext.Width * pContext.Height;
        // XL mission topology owns four compulsory beats and can expose many
        // detours. Nine mobile actors covers the route, two selected outposts
        // with small squads, and one reward branch; the previous floor of seven
        // made expensive side branches terminate at a lone soldier.
        var areaFloor = mapArea >= 10000 ? 9 : Math.max(3, Math.min(8,
            Math.round(mapArea / 1700)));
        count = Math.max(count, areaFloor);

        if(this.IsBeachProfile(pContext)) {
            var goalMax = this.ObjectiveGoalCountMax(pTargets);
            if(goalMax !== null)
                count = Math.min(count, Math.max(1, goalMax - this.MissionGoalCountSoFar(pOut)));
        }

        // Plan progression before placing individual actors. Older placement
        // selected pressureWaypoints by array index, which could fold an early,
        // mid and late patrol back into the same part of a winding route. Give
        // every patrol an explicit mission fraction, and use a matching branch
        // for some non-objective patrols so optional routes are defended too.
        for(var slotIndex = 0; slotIndex < count; ++slotIndex) {
            var slotLow = count <= 2 ? 0.26 : 0.18;
            var slotHigh = count <= 2 ? 0.76 : 0.88;
            var slotFraction = self.DistributedFraction(slotIndex, count,
                slotLow, slotHigh);
            var slotRole = self.MobileEnemyPressureRole(slotFraction);
            var slotBranch = null;
            var bestDistance = 999;

            if(slotRole !== "objective_guard" && slotIndex % 2 === 1) {
                for(var branchIndex = 0; branchIndex < branches.length; ++branchIndex) {
                    var candidate = branches[branchIndex];
                    var candidateFraction = Number(candidate.routeFraction);
                    if(usedBranches[branchIndex] || !isFinite(candidateFraction))
                        continue;
                    var distance = Math.abs(candidateFraction - slotFraction);
                    if(distance < bestDistance) {
                        bestDistance = distance;
                        slotBranch = { branch: candidate, index: branchIndex };
                    }
                }
            }

            if(slotBranch && bestDistance <= 0.24)
                usedBranches[slotBranch.index] = true;
            else
                slotBranch = null;

            slots.push({
                fraction: slotFraction,
                phase: self.ProgressPhase(slotFraction),
                pressureRole: slotRole,
                branch: slotBranch ? slotBranch.branch : null
            });
        }

        this.PlaceRole(pContext, pOut, {
            count: count,
            group: "enemies",
            idPrefix: "enemy_",
            role: "mobile_enemies",
            kind: "enemy_patrol",
            source: function(index) {
                var pressureRole = slots[index].pressureRole;
                if(slots[index].branch)
                    return "routePlan.branches";
                return pressureRole === "objective_guard" && doors.length ?
                    "spriteRolePlacement.pairOffsets.objective_doors_to_mobile_enemies" :
                    "routePlan.routePath";
            },
            anchor: function(index) {
                var pressureRole = slots[index].pressureRole;
                if(pressureRole === "objective_guard" && doors.length)
                    return self.DoorAnchor(pObjectivePlan, index);
                if(slots[index].branch) {
                    var branchPath = slots[index].branch.path || [];
                    if(branchPath.length)
                        return branchPath[Math.floor(branchPath.length * 0.68)];
                    if(slots[index].branch.endpoint)
                        return slots[index].branch.endpoint;
                }
                return self.RoutePathPointAtFraction(pRoutePlan, slots[index].fraction) ||
                    { x: Math.floor(pContext.Width / 2), y: Math.floor(pContext.Height / 2) };
            },
            point: function(index, anchor) {
                var pressureRole = slots[index].pressureRole;
                return pressureRole === "objective_guard" && doors.length ?
                    self.PairOffsetPoint(pContext, pTargets, "objective_doors_to_mobile_enemies", anchor, index, 6) :
                    self.ClusterOffsetPoint(pContext, anchor, index);
            },
            sprite: function() { return self.PickSpriteType(pContext, pTargets, "mobile_enemies", 5, "Enemy"); },
            adjustSprite: function(index, point, sprite) {
                return self.ApplyRocketEnemyStartSafety(
                    pContext,
                    point,
                    slots[index].pressureRole,
                    sprite
                );
            },
            extra: function(index) {
                return {
                    pressureRole: slots[index].pressureRole,
                    routeFraction: slots[index].fraction,
                    routePhase: slots[index].phase,
                    branchId: slots[index].branch ? slots[index].branch.id : null
                };
            }
        });
    },

    AddFixedEnemies: function(pContext, pTargets, pObjectivePlan, pOut) {
        var self = this;
        var roles = [
            { role: "enemy_turrets", composition: "enemies", fallbackType: 84, fallbackName: "Turret_Missile_Enemy", kind: "enemy_turret", pair: "objective_doors_to_enemy_turrets", max: 12 },
            { role: "enemy_vehicles", composition: "vehicles", fallbackType: 80, fallbackName: "VehicleNoGun_Enemy", kind: "enemy_vehicle", pair: "objective_doors_to_mobile_enemies", max: 4 },
            { role: "enemy_helicopters", composition: "enemies", fallbackType: 40, fallbackName: "Helicopter_Grenade_Enemy", kind: "enemy_helicopter", pair: "objective_doors_to_mobile_enemies", max: 3 }
        ];

        for(var roleIndex = 0; roleIndex < roles.length; ++roleIndex) {
            // RoleCount is drawn INSIDE this outer loop (per role) — keep it here
            // so the draw order across the 3 roles is unchanged.
            var spec = roles[roleIndex];
            var count = this.RoleCount(pContext, pTargets, spec.role, spec.composition, 0, 0, spec.max);

            if(this.IsBeachProfile(pContext)) {
                var goalMax = this.ObjectiveGoalCountMax(pTargets);
                if(goalMax !== null)
                    count = Math.min(count, Math.max(0, goalMax - this.MissionGoalCountSoFar(pOut)));
            }

            (function(spec, roleIndex) {
                self.PlaceRole(pContext, pOut, {
                    count: count,
                    group: "enemies",
                    idPrefix: "enemy_",
                    role: spec.role,
                    kind: spec.kind,
                    source: "spriteRolePlacement.pairOffsets." + spec.pair,
                    anchor: function(index) {
                        return self.DoorAnchor(pObjectivePlan, index) || { x: Math.floor(pContext.Width / 2), y: Math.floor(pContext.Height / 2) };
                    },
                    point: function(index, anchor) {
                        return self.PairOffsetPoint(pContext, pTargets, spec.pair, anchor, index + roleIndex, 5);
                    },
                    sprite: function() { return self.PickSpriteType(pContext, pTargets, spec.role, spec.fallbackType, spec.fallbackName); },
                    extra: function() { return { pressureRole: "objective_guard" }; },
                    also: function(placement) {
                        if(spec.role === "enemy_helicopters")
                            pOut.helicopters.push(placement);
                    }
                });
            })(spec, roleIndex);
        }
    },

    AddPickups: function(pContext, pTargets, pPlan, pOut) {
        var self = this;
        var count = this.RoleCount(pContext, pTargets, "pickups", "pickups", 0, 0, 12);
        var needSupport = this.ObjectiveNeedsSupportPickup(pPlan);
        var branches = pPlan.routePlan && pPlan.routePlan.branches ? pPlan.routePlan.branches : [];

        count = this.ApplyPickupDensity(pContext, count);
        if(needSupport)
            count = Math.max(1, count);

        // destroy_buildings live validation requires ceil(buildings/4) REACHABLE
        // weapon boxes (LiveValidation.js). The mined pickups stat (~1) routinely
        // undershoots that for multi-building maps, so the objective failed on a
        // large fraction of seeds regardless of layout. Scale the pickup count to
        // the structure-fire objective count, plus a margin so a couple of boxes
        // landing behind water/cliffs still leaves enough reachable.
        var supportNeeded = this.DestroyBuildingSupportBoxes(pPlan);
        if(supportNeeded > 0)
            count = Math.max(count, supportNeeded + 1);

        // Destroy-building generation uses standard-explosive barracks. Both
        // GrenadeBox and RocketBox weapons produce the ordinary Explosion state
        // those doors accept, so either pickup is valid objective support.
        var pickupSlots = [];
        var usedBranches = {};
        var usedAnchors = [];

        // Rewards should pull the player through the map, not form a pile beside
        // one objective or the only branch. Match each pickup to a progression
        // fraction, prefer a distinct nearby branch, and fall back to that exact
        // point on the primary route. This naturally yields early/mid/late rewards
        // when three or more pickups exist.
        for(var slotIndex = 0; slotIndex < count; ++slotIndex) {
            var fraction = self.DistributedFraction(slotIndex, count, 0.24, 0.80);
            var phase = self.ProgressPhase(fraction);
            var candidates = [];
            for(var branchIndex = 0; branchIndex < branches.length; ++branchIndex) {
                var branchFraction = Number(branches[branchIndex].routeFraction);
                if(usedBranches[branchIndex] || !isFinite(branchFraction) ||
                    self.ProgressPhase(branchFraction) !== phase ||
                    !branches[branchIndex].endpoint)
                    continue;
                candidates.push({
                    anchor: branches[branchIndex].endpoint,
                    fraction: branchFraction,
                    branch: branches[branchIndex],
                    branchIndex: branchIndex,
                    branchBonus: 36
                });
            }

            var fractionOffsets = [0, -0.06, 0.06, -0.12, 0.12];
            for(var fractionIndex = 0; fractionIndex < fractionOffsets.length;
                ++fractionIndex) {
                var routeFraction = self.Clamp(fraction +
                    fractionOffsets[fractionIndex], 0.12, 0.90);
                if(self.ProgressPhase(routeFraction) !== phase)
                    continue;
                var routePoint = self.RoutePathPointAtFraction(
                    pPlan.routePlan || {}, routeFraction);
                if(routePoint) {
                    candidates.push({
                        anchor: routePoint,
                        fraction: routeFraction,
                        branch: null,
                        branchIndex: -1,
                        branchBonus: 0
                    });
                }
            }

            var selected = candidates.length ? candidates[0] : {
                anchor: { x: Math.floor(pContext.Width / 2), y: Math.floor(pContext.Height / 2) },
                fraction: fraction,
                branch: null,
                branchIndex: -1,
                branchBonus: 0
            };
            var bestScore = -999999;
            for(var candidateIndex = 0; candidateIndex < candidates.length;
                ++candidateIndex) {
                var candidate = candidates[candidateIndex];
                var minimumDistance = pContext.Width * pContext.Width +
                    pContext.Height * pContext.Height;
                for(var usedIndex = 0; usedIndex < usedAnchors.length; ++usedIndex) {
                    minimumDistance = Math.min(minimumDistance,
                        self.PointDistanceSquared(candidate.anchor,
                            usedAnchors[usedIndex]));
                }
                if(!usedAnchors.length)
                    minimumDistance = 0;
                var score = minimumDistance + candidate.branchBonus -
                    (Math.abs(candidate.fraction - fraction) * 100);
                if(score > bestScore) {
                    selected = candidate;
                    bestScore = score;
                }
            }
            if(selected.branchIndex >= 0)
                usedBranches[selected.branchIndex] = true;
            usedAnchors.push(selected.anchor);
            pickupSlots.push({
                fraction: selected.fraction,
                phase: phase,
                branch: selected.branch,
                anchor: selected.anchor
            });
        }

        this.PlaceRole(pContext, pOut, {
            count: count,
            group: "pickups",
            idPrefix: "pickup_",
            role: "pickups",
            kind: function(index, sprite) {
                return sprite.type === 38 || sprite.name === "RocketBox" ? "rocket_support" : "grenade_support";
            },
            source: function(index) {
                return pickupSlots[index].branch ? "routePlan.branches" : "routePlan.routePath";
            },
            anchor: function(index) {
                var anchor = pickupSlots[index].anchor;
                if(!anchor)
                    anchor = { x: Math.floor(pContext.Width / 2), y: Math.floor(pContext.Height / 2) };
                return anchor;
            },
            point: function(index, anchor) {
                return self.ClusterOffsetPoint(pContext, anchor, index + 4);
            },
            sprite: function(index) {
                return self.PickSpriteType(pContext, pTargets, "pickups", index % 2 ? 38 : 37, index % 2 ? "RocketBox" : "GrenadeBox");
            },
            extra: function(index) {
                var branch = pickupSlots[index].branch;
                return {
                    supportRequiredByObjective: needSupport,
                    branchId: branch ? branch.id : null,
                    routeFraction: pickupSlots[index].fraction,
                    routePhase: pickupSlots[index].phase
                };
            },
            also: function(placement) { pOut.support.push(placement); }
        });
    },

    AddVehicles: function(pContext, pTargets, pPlan, pOut) {
        var self = this;
        var forceVehicle = this.MobilityRequires(pPlan, "vehicle");
        var count = this.RoleCount(pContext, pTargets, "human_vehicles", "vehicles", 0, forceVehicle ? 1 : 0, 4);

        count = this.RequestedVehicleCount(pContext, count, forceVehicle);

        this.PlaceRole(pContext, pOut, {
            count: count,
            group: "vehicles",
            idPrefix: "vehicle_",
            role: "human_vehicles",
            kind: forceVehicle ? "required_access_vehicle" : "support_vehicle",
            source: forceVehicle ? "routePlan.mobilityPlan.requiredAssets" : "spriteRolePlacement.roles.human_vehicles",
            anchor: function(index) {
                return self.AssetPoint(pPlan, "vehicle", index) ||
                    self.RoutePathPoint(pPlan.routePlan || {}, index, Math.max(1, count)) ||
                    { x: 2, y: Math.floor(pContext.Height / 2) };
            },
            point: function(index, anchor) {
                return self.OffsetPoint(pContext, anchor, index % 2 ? 2 : -2, index % 3 === 0 ? 1 : -1, 1);
            },
            sprite: function(index) {
                return self.RequestedVehicleSprite(
                    pContext,
                    index,
                    self.PickSpriteType(pContext, pTargets, "human_vehicles", 64, "VehicleGun_Human")
                );
            },
            extra: function() { return { requiredByMobility: forceVehicle }; },
            also: function(placement) { pOut.support.push(placement); }
        });
    },

    AddHelicoptersAndCallpads: function(pContext, pTargets, pPlan, pOut) {
        var self = this;
        var forceHelicopter = this.MobilityRequires(pPlan, "helicopter");
        var callpadsObserved = this.RoleObservedMax(pTargets, "callpads", null) > 0;
        var helicopterCount = this.RoleCount(pContext, pTargets, "human_helicopters", null, 0, forceHelicopter ? 1 : 0, 3);
        var callpadCount = this.RoleCount(pContext, pTargets, "callpads", null, 0, (forceHelicopter && callpadsObserved) ? 1 : 0, 4);

        this.PlaceRole(pContext, pOut, {
            count: helicopterCount,
            group: "helicopters",
            idPrefix: "helicopter_",
            role: "human_helicopters",
            kind: forceHelicopter ? "required_access_helicopter" : "support_helicopter",
            source: forceHelicopter ? "routePlan.mobilityPlan.requiredAssets" : "spriteRolePlacement.roles.human_helicopters",
            anchor: function(index) {
                return self.AssetPoint(pPlan, "helicopter", index) ||
                    self.RoutePathPoint(pPlan.routePlan || {}, index, Math.max(1, helicopterCount)) ||
                    { x: 2, y: 2 };
            },
            point: function(index, anchor) { return self.OffsetPoint(pContext, anchor, index % 2 ? 3 : -3, -2, 1); },
            sprite: function() { return self.PickSpriteType(pContext, pTargets, "human_helicopters", 50, "Helicopter_Unarmed_Human"); },
            extra: function() { return { requiredByMobility: forceHelicopter }; },
            also: function(placement) { pOut.support.push(placement); }
        });

        // Callpads: the anchor IS the placement point (no offset), so point()
        // returns the anchor and the only draw is the PickSpriteType — same as
        // the original loop.
        this.PlaceRole(pContext, pOut, {
            count: callpadCount,
            group: "callpads",
            idPrefix: "callpad_",
            role: "callpads",
            kind: "helicopter_callpad",
            source: forceHelicopter ? "routePlan.mobilityPlan.requiredAssets" : "spriteRolePlacement.roles.callpads",
            anchor: function(index) {
                return self.AssetPoint(pPlan, "landing_zone", index) ||
                    self.RoutePathPoint(pPlan.routePlan || {}, index + 1, Math.max(1, callpadCount + 1)) ||
                    { x: pContext.Width - 3, y: pContext.Height - 3 };
            },
            point: function(index, anchor) { return anchor; },
            sprite: function() { return self.PickSpriteType(pContext, pTargets, "callpads", 99, "Helicopter_CallPad"); },
            extra: function() { return { requiredByMobility: forceHelicopter }; },
            also: function(placement) { pOut.support.push(placement); }
        });
    },

    AddHostagesAndExtraction: function(pContext, pTargets, pPlan, pOut) {
        var self = this;
        var intent = pPlan.intent || {};
        var requiresHostages = intent.objectiveLabel === "rescue_hostages" ||
            (intent.guardrails && intent.guardrails.requiresHostageExtraction);
        var hostageCount = this.RoleCount(pContext, pTargets, "hostages", "hostages", 0, requiresHostages ? 1 : 0, 6);
        var extractionCount = this.RoleCount(pContext, pTargets, "extraction", "extraction", 0, hostageCount ? 1 : 0, 3);
        var routePlan = pPlan.routePlan || {};
        var extractionBeat = this.BeatWithRole(routePlan, 0, "extraction_exit", "extraction_screen") ||
            this.BeatWithRole(routePlan, 0, null, "extraction_screen");
        var extractionAnchor = extractionBeat ? extractionBeat.point :
            (this.RoutePathPoint(routePlan, 99, 100) || { x: pContext.Width - 4, y: Math.floor(pContext.Height / 2) });
        var extractionPoint = this.ClampPoint(pContext, extractionAnchor, 1);

        // Extraction: the point is draw-free (extractionPoint or an OffsetPoint),
        // so PlaceRole's point-before-sprite order consumes the same single
        // PickSpriteType draw as the original sprite-before-point loop.
        this.PlaceRole(pContext, pOut, {
            count: extractionCount,
            group: "extraction",
            idPrefix: "extraction_",
            role: "extraction",
            kind: "rescue_tent",
            source: "spriteRolePlacement.roles.extraction",
            anchor: function() { return extractionPoint; },
            point: function(index) { return index ? self.OffsetPoint(pContext, extractionPoint, index, 0, 1) : extractionPoint; },
            sprite: function() { return self.PickSpriteType(pContext, pTargets, "extraction", 73, "Hostage_Rescue_Tent"); },
            extra: function() { return { routeBeatId: extractionBeat ? extractionBeat.id : null }; }
        });

        this.PlaceRole(pContext, pOut, {
            count: hostageCount,
            group: "hostages",
            idPrefix: "hostage_",
            role: "hostages",
            kind: "hostage_group_member",
            source: extractionCount ? "spriteRolePlacement.pairOffsets.extraction_to_hostages" : "objectivePlan.objectiveBeats",
            anchor: function(index) {
                return extractionCount ?
                    extractionPoint :
                    (self.ObjectiveAnchor(pPlan.objectivePlan || {}, index) || extractionPoint);
            },
            point: function(index, anchor) {
                return extractionCount ?
                    self.PairOffsetPoint(pContext, pTargets, "extraction_to_hostages", anchor, index, 8) :
                    self.OffsetPoint(pContext, anchor, index % 2 ? 2 : -2, 1, 1);
            },
            sprite: function() { return self.PickSpriteType(pContext, pTargets, "hostages", 72, "Hostage"); },
            extra: function() { return { extractionPlanned: extractionCount > 0 }; }
        });
    },

    AddCivilians: function(pContext, pTargets, pPlan, pOut) {
        var self = this;
        var intent = pPlan.intent || {};
        var civilianDelivery = intent.objectiveLabel === "civilian_delivery" ||
            (intent.guardrails && intent.guardrails.requiresCivilianDelivery);
        var count = this.RoleCount(pContext, pTargets, "civilians", "civilians", 0, civilianDelivery ? 1 : 0, 6);
        var objectivePlan = pPlan.objectivePlan || {};
        var doors = objectivePlan.doors || [];
        var homeDoor = null;

        for(var doorIndex = 0; doorIndex < doors.length; ++doorIndex) {
            if(doors[doorIndex].role === "civilian_door") {
                homeDoor = doors[doorIndex];
                break;
            }
        }

        this.PlaceRole(pContext, pOut, {
            count: count,
            group: "civilians",
            idPrefix: "civilian_",
            role: "civilians",
            kind: civilianDelivery ? "delivery_civilian" : "ambient_civilian",
            source: homeDoor ? "spriteRolePlacement.pairOffsets.civilian_doors_to_civilians" : "objectivePlan.objectiveBeats",
            anchor: function(index) {
                var anchor = homeDoor ? homeDoor.point :
                    (self.ObjectiveAnchor(objectivePlan, index) ||
                        self.RoutePathPoint(pPlan.routePlan || {}, index, Math.max(1, count)));
                if(!anchor)
                    anchor = { x: Math.floor(pContext.Width / 2), y: Math.floor(pContext.Height / 2) };
                return anchor;
            },
            point: function(index, anchor) {
                return homeDoor ?
                    self.PairOffsetPoint(pContext, pTargets, "civilian_doors_to_civilians", anchor, index, 4) :
                    self.OffsetPoint(pContext, anchor, index % 2 ? 2 : -2, 0, 1);
            },
            sprite: function() { return self.PickSpriteType(pContext, pTargets, "civilians", 70, "Civilian_Spear"); },
            extra: function() { return { civilianDeliveryTemplate: civilianDelivery, homeDoorId: homeDoor ? homeDoor.id : null }; }
        });
    },

    AddHazardsAndDecor: function(pContext, pTargets, pPlan, pOut) {
        var self = this;
        var hazardCount = this.RoleCount(pContext, pTargets, "hazards", null, 0, 0, 10);
        var decorCount = this.RoleCount(pContext, pTargets, "decor", null, 0, 0, 14);
        var routePlan = pPlan.routePlan || {};

        this.PlaceRole(pContext, pOut, {
            count: hazardCount,
            group: "hazards",
            idPrefix: "hazard_",
            role: "hazards",
            kind: "route_hazard",
            source: "spriteRolePlacement.roles.hazards",
            anchor: function(index) { return self.RoutePathPoint(routePlan, index, Math.max(1, hazardCount)) || { x: 4, y: 4 }; },
            point: function(index, anchor) { return self.OffsetPoint(pContext, anchor, index % 2 ? 3 : -3, index % 3 === 0 ? 2 : -2, 1); },
            sprite: function() { return self.PickSpriteType(pContext, pTargets, "hazards", 54, "Mine"); }
        });

        this.PlaceRole(pContext, pOut, {
            count: decorCount,
            group: "decor",
            idPrefix: "decor_",
            role: "decor",
            kind: "ambient_decor",
            source: "spriteRolePlacement.roles.decor",
            anchor: function(index) { return self.RoutePathPoint(routePlan, index + 1, Math.max(2, decorCount + 1)) || { x: pContext.Width - 4, y: 4 }; },
            point: function(index, anchor) { return self.OffsetPoint(pContext, anchor, index % 2 ? 5 : -5, index % 3 === 0 ? 3 : -3, 1); },
            sprite: function() { return self.PickSpriteType(pContext, pTargets, "decor", 13, "Shrub"); }
        });
    },

    PlacementIntents: function(pOut) {
        var groups = [
            "players",
            "structureSprites",
            "enemies",
            "pickups",
            "vehicles",
            "helicopters",
            "callpads",
            "hostages",
            "civilians",
            "extraction",
            "hazards",
            "decor"
        ];
        var result = [];

        for(var g = 0; g < groups.length; ++g) {
            var group = pOut[groups[g]] || [];
            for(var index = 0; index < group.length; ++index)
                result.push(group[index]);
        }

        return result;
    },

    RoleCountSummary: function(pOut) {
        return {
            players: pOut.players.length,
            enemies: pOut.enemies.length,
            pickups: pOut.pickups.length,
            vehicles: pOut.vehicles.length,
            helicopters: pOut.helicopters.length,
            callpads: pOut.callpads.length,
            hostages: pOut.hostages.length,
            civilians: pOut.civilians.length,
            extraction: pOut.extraction.length,
            hazards: pOut.hazards.length,
            decor: pOut.decor.length,
            structureSprites: pOut.structureSprites.length,
            support: pOut.support.length
        };
    },

    Plan: function(pContext, pPlan) {
        var self = MapGen.Grammar.Sprites;
        var profile = pContext.Profile || {};
        var target = profile.TargetPack || {};
        var targets = target.targets || {};
        var routePlan = pPlan.routePlan || {};
        var objectivePlan = pPlan.objectivePlan || {};
        var outlierReasons = [];
        var notes = [];
        var out = {
            players: [],
            enemies: [],
            pickups: [],
            vehicles: [],
            helicopters: [],
            callpads: [],
            hostages: [],
            civilians: [],
            extraction: [],
            support: [],
            hazards: [],
            decor: [],
            structureSprites: []
        };

        if(!targets.styleSpriteRoles)
            outlierReasons.push("sprite_role_density_out_of_range:missing_styleSpriteRoles");
        if(!targets.spriteRolePlacement)
            outlierReasons.push("sprite_role_density_out_of_range:missing_spriteRolePlacement");

        self.AddPlayers(pContext, targets, routePlan, out);
        self.AddStructureSprites(pContext, objectivePlan, out);
        self.AddMobileEnemies(pContext, targets, routePlan, objectivePlan, out);
        self.AddFixedEnemies(pContext, targets, objectivePlan, out);
        self.AddPickups(pContext, targets, pPlan, out);
        self.AddVehicles(pContext, targets, pPlan, out);
        self.AddHelicoptersAndCallpads(pContext, targets, pPlan, out);
        self.AddHostagesAndExtraction(pContext, targets, pPlan, out);
        self.AddCivilians(pContext, targets, pPlan, out);
        self.AddHazardsAndDecor(pContext, targets, pPlan, out);

        var needSupport = self.ObjectiveNeedsSupportPickup(pPlan);
        if(needSupport && !out.pickups.length)
            outlierReasons.push("support_pickup_missing");
        if((pPlan.intent || {}).objectiveLabel === "rescue_hostages" &&
            (!out.hostages.length || !out.extraction.length))
            outlierReasons.push("hostage_context_missing");
        if((pPlan.intent || {}).objectiveLabel === "civilian_delivery" &&
            !out.civilians.length)
            outlierReasons.push("civilian_home_route_missing");
        if(out.extraction.length && !routePlan.routePath)
            outlierReasons.push("extraction_unreachable");

        if((pPlan.intent || {}).guardrails &&
            (pPlan.intent || {}).guardrails.requiresHelicopter &&
            !out.helicopters.length)
            outlierReasons.push("support_pickup_missing:helicopter");

        if(target.officialDataConfidence === "limited")
            notes.push("profile_limited_sprite_source_maps");

        return {
            name: "spritePlan",
            status: "ready",
            players: out.players,
            enemies: out.enemies,
            pickups: out.pickups,
            vehicles: out.vehicles,
            helicopters: out.helicopters,
            callpads: out.callpads,
            hostages: out.hostages,
            civilians: out.civilians,
            extraction: out.extraction,
            support: out.support,
            hazards: out.hazards,
            decor: out.decor,
            structureSprites: out.structureSprites,
            placementIntents: self.PlacementIntents(out),
            roleCounts: self.RoleCountSummary(out),
            sptFormat: {
                word0: "0x7C",
                word1: 0,
                storedX: "runtimeX-0x10",
                runtimeY: "runtimeY",
                spriteType: "spriteType"
            },
            targetRefs: [
                "profiles." + (pPlan.targetPackProfileName || profile.TargetPackProfile || "") + ".targets.styleSpriteRoles",
                "profiles." + (pPlan.targetPackProfileName || profile.TargetPackProfile || "") + ".targets.spriteRolePlacement",
                "globalTargets.sptFormat",
                "objectivePlan",
                "routePlan.mobilityPlan"
            ],
            notes: notes,
            outlierReasons: outlierReasons
        };
    }
};
