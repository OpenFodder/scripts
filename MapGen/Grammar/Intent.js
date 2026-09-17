var MapGen = MapGen || {};
MapGen.Grammar = MapGen.Grammar || {};

MapGen.Grammar.Intent = {

    HasOwn: function(pObject, pKey) { return MapGen.Grammar.Util.HasOwn(pObject, pKey); },

    Keys: function(pObject) {
        var keys = [];
        var key;

        if(!pObject)
            return keys;

        for(key in pObject) {
            if(this.HasOwn(pObject, key))
                keys.push(key);
        }

        return keys;
    },

    NumberOrNull: function(pValue) { return MapGen.Grammar.Util.NumberOrNull(pValue); },

    StatRange: function(pStats, pPreferWide) { return MapGen.Grammar.Util.StatRange(pStats, pPreferWide); },

    PickStatNumber: function(pRandom, pStats, pInteger, pFallback) {
        return MapGen.Grammar.Util.PickStatNumber(pRandom, pStats, pInteger, pFallback);
    },

    PickBlendedStatNumber: function(pRandom, pProfileStats, pBandStats, pInteger, pFallback) {
        var profileRange = this.StatRange(pProfileStats, false) || this.StatRange(pProfileStats, true);
        var bandRange = this.StatRange(pBandStats, false) || this.StatRange(pBandStats, true);
        var range = profileRange || bandRange;
        var value;

        if(profileRange && bandRange) {
            var min = Math.max(profileRange[0], bandRange[0]);
            var max = Math.min(profileRange[1], bandRange[1]);

            // Campaign bands are global across all scoped maps. Use them to
            // narrow a profile target, but never let them drag a profile into
            // a range that was not observed for that terrain variant.
            if(max >= min)
                range = [min, max];
            else
                range = profileRange;
        }

        if(range) {
            if(pInteger) {
                var minInt = Math.ceil(range[0]);
                var maxInt = Math.floor(range[1]);
                if(maxInt < minInt)
                    maxInt = minInt;
                value = pRandom.Int(minInt, maxInt);
            }
            else {
                value = pRandom.Float(range[0], range[1]);
            }
            return pInteger ? Math.max(0, Math.round(value)) : value;
        }

        return this.PickStatNumber(pRandom, pProfileStats || pBandStats, pInteger, pFallback);
    },

    WeightedPick: function(pRandom, pWeights, pFallback) {
        var entries = [];
        var total = 0;
        var key;

        if(!pWeights)
            return pFallback || null;

        for(key in pWeights) {
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

    IceStyleRandom: function(pRandom, pSalt) {
        var seed;
        var mixedSeed;

        if(!pRandom || pRandom.InitialSeed === undefined ||
            !MapGen.Random || !MapGen.Random.HashTile ||
            !MapGen.Random.CreateSeeded)
            return pRandom;

        // Intent selection consumes a variable number of draws before the
        // ice style is chosen. Using that same LCG stream tied style to the
        // preceding campaign-band/archetype choices and made nearby seeds
        // particularly correlated. A named, seed-derived stream makes style
        // selection stable and well mixed without coupling it to how many
        // unrelated target stats happened to be sampled first.
        seed = pRandom.InitialSeed >>> 0;
        mixedSeed = MapGen.Random.HashTile(
            seed,
            211,
            223,
            Number(pSalt || 4219)
        );
        return MapGen.Random.CreateSeeded(mixedSeed);
    },

    ProfileString: function(pProfile, pKey) {
        if(!pProfile || pProfile[pKey] === undefined || pProfile[pKey] === null)
            return "";

        var value = String(pProfile[pKey]);
        return value.length ? value : "";
    },

    PickProfileNumber: function(pRandom, pValue, pInteger, pFallback) {
        if(pValue === undefined || pValue === null)
            return pFallback;

        if(pValue instanceof Array) {
            if(!pValue.length)
                return pFallback;
            if(pValue.length < 2)
                return this.PickProfileNumber(pRandom, pValue[0], pInteger, pFallback);

            var min = Number(pValue[0]);
            var max = Number(pValue[1]);
            if(!isFinite(min) || !isFinite(max))
                return pFallback;
            if(max < min) {
                var swap = min;
                min = max;
                max = swap;
            }

            if(pInteger) {
                var minInt = Math.ceil(min);
                var maxInt = Math.floor(max);
                if(maxInt < minInt)
                    maxInt = minInt;
                return Math.max(0, Math.round(pRandom.Int(minInt, maxInt)));
            }

            return pRandom.Float(min, max);
        }

        var value = Number(pValue);
        if(!isFinite(value))
            return pFallback;

        return pInteger ? Math.max(0, Math.round(value)) : value;
    },

    NormalizedMapId: function(pMapName) {
        var value = String(pMapName || "").toLowerCase();
        var dot = value.indexOf(".");

        if(dot >= 0)
            value = value.substring(0, dot);

        return value;
    },

    CampaignProgression: function() {
        if(MapGen.TargetPack && MapGen.TargetPack.GlobalTarget)
            return MapGen.TargetPack.GlobalTarget("campaignProgression");

        if(MapGen.TargetPack && MapGen.TargetPack.Data &&
            MapGen.TargetPack.Data.globalTargets)
            return MapGen.TargetPack.Clone(MapGen.TargetPack.Data.globalTargets.campaignProgression || {});

        return null;
    },

    ProfileSourceMapSet: function(pTarget) {
        var result = {};
        var maps = pTarget && pTarget.sourceMaps ? pTarget.sourceMaps : [];

        for(var index = 0; index < maps.length; ++index)
            result[this.NormalizedMapId(maps[index])] = true;

        return result;
    },

    PickCampaignBand: function(pContext, pTarget, pOutlierReasons) {
        var progression = this.CampaignProgression();
        var bands = progression && progression.bands ? progression.bands : null;
        var sourceMaps = this.ProfileSourceMapSet(pTarget);
        var weights = {};
        var overlapWeights = {};
        var anyOverlap = false;
        var forcedBand;
        var name;

        if(!bands) {
            pOutlierReasons.push("campaign_progression_targets_missing");
            return {
                name: "unknown",
                source: "missing_campaign_progression",
                target: null
            };
        }

        forcedBand = this.ProfileString(pContext ? pContext.Profile : null, "ForcedCampaignBand");
        if(forcedBand) {
            if(bands[forcedBand]) {
                return {
                    name: forcedBand,
                    source: "profile_forced_campaign_band",
                    weight: Number(bands[forcedBand].mapCount || 0),
                    target: bands[forcedBand]
                };
            }
            pOutlierReasons.push("forced_campaign_band_unknown:" + forcedBand);
        }

        for(name in bands) {
            if(!this.HasOwn(bands, name))
                continue;

            var band = bands[name];
            var maps = band && band.maps ? band.maps : [];
            var overlap = 0;

            for(var mapIndex = 0; mapIndex < maps.length; ++mapIndex) {
                if(sourceMaps[this.NormalizedMapId(maps[mapIndex])])
                    ++overlap;
            }

            if(overlap > 0) {
                overlapWeights[name] = overlap;
                anyOverlap = true;
            }
            weights[name] = Math.max(1, Number(band.mapCount || 0));
        }

        if(anyOverlap)
            weights = overlapWeights;

        var selected = this.WeightedPick(pContext.Random, weights, "mid");
        return {
            name: selected,
            source: anyOverlap ? "profile_source_map_overlap" : "global_campaign_map_count",
            weight: weights[selected] || 0,
            target: bands[selected] || null
        };
    },

    CombineProfileAndBandWeights: function(pProfileWeights, pBandWeights) {
        pProfileWeights = pProfileWeights || {};
        pBandWeights = pBandWeights || {};

        var combined = {};
        var key;
        var hasBand = false;
        var hasIntersection = false;

        for(key in pBandWeights) {
            if(this.HasOwn(pBandWeights, key) && Number(pBandWeights[key]) > 0) {
                hasBand = true;
                break;
            }
        }

        for(key in pProfileWeights) {
            if(!this.HasOwn(pProfileWeights, key))
                continue;

            var profileWeight = Number(pProfileWeights[key]);
            if(!isFinite(profileWeight) || profileWeight <= 0)
                continue;

            if(hasBand) {
                var bandWeight = Number(pBandWeights[key] || 0);
                if(!isFinite(bandWeight) || bandWeight <= 0)
                    continue;

                combined[key] = profileWeight * bandWeight;
                hasIntersection = true;
            }
            else {
                combined[key] = profileWeight;
            }
        }

        return hasIntersection || !hasBand ? combined : pProfileWeights;
    },

    FilterObjectiveWeights: function(pWeights) {
        var weights = {};
        var hasKnown = false;
        var key;

        for(key in (pWeights || {})) {
            if(!this.HasOwn(pWeights, key))
                continue;

            var weight = Number(pWeights[key]);
            if(!isFinite(weight) || weight <= 0)
                continue;

            if(key !== "objective_unknown")
                hasKnown = true;

            weights[key] = weight;
        }

        if(hasKnown && this.HasOwn(weights, "objective_unknown"))
            delete weights.objective_unknown;

        return weights;
    },

    PatternMatchesObjective: function(pPattern, pObjectiveLabel) {
        var pattern = String(pPattern || "");

        switch(pObjectiveLabel) {
            case "civilian_delivery":
                return pattern.indexOf("civilian") >= 0;

            case "rescue_hostages":
                return pattern.indexOf("hostage") >= 0 ||
                    pattern.indexOf("extraction") >= 0;

            case "enemy_heavy":
                return pattern.indexOf("enemy_cluster") >= 0;

            case "destroy_buildings":
                return pattern.indexOf("structure_cluster") >= 0;

            case "objective_unknown":
            default:
                return true;
        }
    },

    PickOrderPattern: function(pRandom, pMissionFlow, pObjectiveLabel) {
        var source = pMissionFlow && pMissionFlow.orderPatterns ? pMissionFlow.orderPatterns : {};
        var filtered = {};
        var key;
        var hasFiltered = false;

        for(key in source) {
            if(!this.HasOwn(source, key))
                continue;

            if(this.PatternMatchesObjective(key, pObjectiveLabel)) {
                filtered[key] = source[key];
                hasFiltered = true;
            }
        }

        return this.WeightedPick(pRandom, hasFiltered ? filtered : source, "structure_cluster");
    },

    SplitOrderPattern: function(pPattern) {
        var value = String(pPattern || "");
        var raw = value.length ? value.split(">") : [];
        var steps = [];

        for(var index = 0; index < raw.length; ++index) {
            if(raw[index])
                steps.push(raw[index]);
        }

        return steps;
    },

    ObjectiveTemplate: function(pObjectiveLabel) {
        switch(pObjectiveLabel) {
            case "destroy_buildings":
                return "destroy_base";
            case "enemy_heavy":
                return "kill_enemies";
            case "civilian_delivery":
                return "civilian_home";
            case "rescue_hostages":
                return "rescue_hostages";
            case "objective_unknown":
            default:
                return "official_unknown";
        }
    },

    RequiredAssets: function(pObjectiveLabel, pMobilityMode, pOrderSteps) {
        var assets = [];
        var pattern = pOrderSteps ? pOrderSteps.join(">") : "";

        function add(pName) {
            for(var index = 0; index < assets.length; ++index)
                if(assets[index] === pName)
                    return;
            assets.push(pName);
        }

        switch(pObjectiveLabel) {
            case "destroy_buildings":
                add("objective_structures");
                break;
            case "enemy_heavy":
                add("enemy_clusters");
                break;
            case "civilian_delivery":
                add("civilian");
                add("civilian_home");
                break;
            case "rescue_hostages":
                add("hostages");
                add("extraction_zone");
                break;
        }

        if(pattern.indexOf("structure_cluster") >= 0)
            add("structure_clusters");
        if(pattern.indexOf("enemy_cluster") >= 0)
            add("enemy_clusters");
        if(pattern.indexOf("hostage") >= 0)
            add("hostages");
        if(pattern.indexOf("extraction") >= 0)
            add("extraction_zone");

        switch(pMobilityMode) {
            case "helicopter":
                add("helicopter");
                break;
            case "skidoo_or_vehicle":
                add("skidoo_or_vehicle");
                break;
            case "vehicle_or_swim":
                add("vehicle_or_swim_option");
                break;
            case "skidoo_jump":
                add("skidoo");
                add("jump_ramps");
                break;
            case "vehicle_jump":
                add("vehicle");
                add("jump_ramps");
                break;
            case "breakable_or_lowering_terrain":
                add("breakable_or_lowering_tiles");
                break;
        }

        return assets;
    },

    MobilityFeatureFlags: function(pMobilityMode) {
        switch(pMobilityMode) {
            case "swim_or_wade":
                return ["water_crossing"];
            case "vehicle_or_swim":
                return ["water_crossing", "vehicle_optional"];
            case "skidoo_or_vehicle":
                return ["vehicle_route"];
            case "helicopter":
                return ["air_route"];
            case "skidoo_jump":
            case "vehicle_jump":
                return ["jump_route"];
            case "breakable_or_lowering_terrain":
                return ["dynamic_unlock_route"];
            case "foot":
            default:
                return ["foot_route"];
        }
    },

    DynamicTerrainMode: function(pRandom, pDynamicTerrain, pMobilityMode) {
        if(pMobilityMode === "breakable_or_lowering_terrain") {
            return {
                name: "route_breakable_or_lowering",
                source: "mobility_required_mode",
                swapTileTarget: this.PickStatNumber(
                    pRandom,
                    pDynamicTerrain ? pDynamicTerrain.swapTileCount : null,
                    true,
                    0
                )
            };
        }

        if(pDynamicTerrain && pDynamicTerrain.mapsWithAnySwap &&
            pDynamicTerrain.mapsWithAnySwap.length) {
            return {
                name: "ambient_walkable_swaps",
                source: "profile_dynamic_terrain_targets",
                swapTileTarget: this.PickStatNumber(
                    pRandom,
                    pDynamicTerrain.swapTileCount,
                    true,
                    0
                )
            };
        }

        return {
            name: "none",
            source: "no_dynamic_terrain_target",
            swapTileTarget: 0
        };
    },

    MapScale: function(pContext, pArchetype, pRouteLengthTarget, pRouteStats) {
        var p25 = this.NumberOrNull(pRouteStats ? pRouteStats.p25 : null);
        var p75 = this.NumberOrNull(pRouteStats ? pRouteStats.p75 : null);
        var label = "standard";

        if(pArchetype === "compact" || (p25 !== null && pRouteLengthTarget <= p25))
            label = "compact";
        else if(pArchetype === "long_route" || (p75 !== null && pRouteLengthTarget >= p75))
            label = "long_route";

        return {
            label: label,
            width: pContext.Width,
            height: pContext.Height,
            areaTiles: pContext.Width * pContext.Height,
            routeLengthTarget: pRouteLengthTarget,
            source: "resolved_dimensions_and_official_route_target"
        };
    },

    Guardrails: function(pProfile, pObjectiveLabel, pMobilityMode, pDynamicTerrainMode) {
        var profileName = typeof pProfile === "string" ? pProfile :
            (pProfile ? String(pProfile.Name || "") : "");
        var targetProfileName = typeof pProfile === "string" ? pProfile :
            (pProfile ? String(pProfile.TargetPackProfile || pProfile.Name || "") : "");
        var isBeach = targetProfileName === "grammar_beach";
        var isIce = targetProfileName === "grammar_ice";
        var isJungle = targetProfileName === "grammar_jungle" || profileName === "grammar_jungle";

        return {
            allowStructureCompounds: !isBeach,
            compoundMode: isBeach ? "standalone_beach_objectives" : "profile_targeted",
            allowBeachTerrain: isBeach,
            allowJungleStructures: !isBeach,
            allowIceOnlyMobility: isIce,
            keepBeachAssumptionsOutOfJungle: isJungle,
            requiresHelicopter: pMobilityMode === "helicopter",
            requiresJumpRoute: pMobilityMode === "skidoo_jump" || pMobilityMode === "vehicle_jump",
            requiresDynamicUnlock: pDynamicTerrainMode === "route_breakable_or_lowering",
            requiresCivilianDelivery: pObjectiveLabel === "civilian_delivery",
            requiresHostageExtraction: pObjectiveLabel === "rescue_hostages"
        };
    },

    IceLayoutStyle: function(pRandom, pProfile, pObjectiveLabel, pMobilityMode, pArchetype) {
        var forcedName;
        var styleRandom;

        if(!pProfile || pProfile.TargetPackProfile !== "grammar_ice")
            return null;

        var smallGenericIce = String(pProfile.Name || "") === "grammar_ice" &&
            Number(pProfile.Width) * Number(pProfile.Height) < 3200;

        styleRandom = this.IceStyleRandom(pRandom, 4219);

        // ice_outpost is the only style that exercises the crossroads /
        // localised_zone / classic templates and the lake/river/pond/cliff
        // variety, so it carries most of the morphological diversity. It
        // used to be weight 0.2 (clamped to 0.08 under destroy_buildings)
        // and was effectively never picked across 50-seed audits — the
        // generator was producing visually similar maps in lockstep. Bumped
        // to a normal-tier weight so it shows up roughly proportionally to
        // its peers; the destroy_buildings clamp is gone.
        // ice_tree_blob is the new tree-blob style (large contiguous forest
        // masses, like mapm33). Heavier weight under tree_heavy so it
        // sometimes wins over ice_tree_maze.
        var weights = {
            ice_outpost: 1.6,
            ice_edge_patrol: 2.2,
            ice_forest_route: 2.4,
            ice_tree_maze: 2.2,
            ice_tree_blob: 1.6,
            ice_neck_route: 2.1,
            ice_compound_raid: 1.6,
            ice_cliff_checkpoint: 1.2,
            // Corner terraces use the same tiles/runtime tuning as the
            // checkpoint, but author a second edge-to-edge grammar instead
            // of another horizontal line through the middle.
            ice_cliff_terrace: 1.2
        };

        if(pObjectiveLabel === "destroy_buildings") {
            weights.ice_edge_patrol *= 0.35;
            weights.ice_compound_raid += 2.2;
            weights.ice_outpost += 0.4;
            weights.ice_forest_route += 0.8;
            weights.ice_tree_maze += 0.8;
            weights.ice_tree_blob += 0.6;
            weights.ice_neck_route += 0.6;
            weights.ice_cliff_checkpoint += 0.8;
            weights.ice_cliff_terrace += 0.6;
            weights.ice_edge_patrol = Math.min(weights.ice_edge_patrol, 0.08);
        }
        if(pMobilityMode === "helicopter" || pMobilityMode === "breakable_or_lowering_terrain") {
            weights.ice_outpost += 0.5;
            weights.ice_compound_raid += 0.7;
        }
        if(pMobilityMode === "swim_or_wade" || pMobilityMode === "vehicle_or_swim") {
            weights.ice_edge_patrol += 1.0;
            weights.ice_neck_route += 0.5;
        }
        if(pArchetype === "tree_heavy") {
            weights.ice_tree_maze += 3.6;
            weights.ice_tree_blob += 3.0;
            weights.ice_forest_route += 1.2;
            weights.ice_neck_route += 0.6;
        }
        if(pArchetype === "long_route") {
            weights.ice_outpost = Math.min(weights.ice_outpost, 0.6);
            weights.ice_neck_route += 2.8;
            weights.ice_cliff_checkpoint += 1.0;
            weights.ice_cliff_terrace += 1.0;
            weights.ice_tree_maze += 1.4;
            weights.ice_forest_route += 1.0;
        }

        forcedName = this.ProfileString(pProfile, "ForcedIceLayoutStyle");
        if(forcedName && weights[forcedName] !== undefined) {
            return {
                name: forcedName,
                source: "profile_forced_ice_layout",
                weights: weights
            };
        }

        // The strict checkpoint Concept is a diagnostic/skidoo layout: it
        // deliberately bisects the whole canvas with one straight cliff. The
        // terrace is the real cliff-archetype binding below. Neither belongs
        // in the ordinary style lottery as well, otherwise cliffs are counted
        // twice and unrelated long-route/structure intents become extra
        // terraces. Explicit forced profiles were already handled above.
        weights.ice_cliff_checkpoint = 0;
        weights.ice_cliff_terrace = 0;

        // Water-heavy is a terrain family, not one fixed silhouette. Keep the
        // selection inside styles that can author a lake, coast, neck, or
        // river, but retain meaningful variation within that family. The
        // runtime profile raises their water budget after selection.
        if(pArchetype === "water_heavy_ice") {
            weights.ice_outpost = 2.4;
            weights.ice_edge_patrol =
                pMobilityMode === "swim_or_wade" ||
                pMobilityMode === "vehicle_or_swim" ? 2.2 : 0;
            weights.ice_forest_route = 2.4;
            weights.ice_tree_maze = 0.8;
            weights.ice_tree_blob = 1.8;
            weights.ice_neck_route = 2.6;
            weights.ice_compound_raid = 1.8;
            weights.ice_cliff_checkpoint = 0;
            weights.ice_cliff_terrace = 0;
        }
        if(!smallGenericIce &&
            (pArchetype === "cliff_heavy" || pArchetype === "cliff_structure_ice")) {
            // These corpus archetypes promise a visible cliff. The other ice
            // styles still carry legacy CliffChance values, but their v3
            // Concepts own the terrain plane and do not author cliff cells.
            // Preserve the semantic contract here; terrace itself varies its
            // corner, reach, slope and crossing from a well-mixed seed hash.
            return {
                name: "ice_cliff_terrace",
                source: "original_cliff_archetype_binding",
                weights: weights
            };
        }

        // Select the macro family first, then a style inside it. A flat style
        // lottery accidentally made the forest Concept dominate because it
        // owns four public styles while open and compound families own two
        // and one. Family-first selection keeps adding a new substyle from
        // silently increasing that family's overall frequency.
        var familyWeights = {
            open: 2.1,
            forest: 2.0,
            compound: 0.9
        };
        if(pObjectiveLabel === "destroy_buildings") {
            familyWeights.open = 1.7;
            familyWeights.forest = 2.0;
            familyWeights.compound = 1.6;
        }
        if(pArchetype === "water_heavy_ice") {
            familyWeights.open = 2.0;
            familyWeights.forest = 2.4;
            familyWeights.compound = 0.8;
        }
        if(pArchetype === "tree_heavy") {
            familyWeights.open = 0.7;
            familyWeights.forest = 5.4;
            familyWeights.compound = 0.5;
        }
        if(pArchetype === "long_route") {
            familyWeights.open = 1.4;
            familyWeights.forest = 3.2;
            familyWeights.compound = 0.7;
        }

        var familyStyles = {
            open: ["ice_outpost", "ice_edge_patrol"],
            forest: [
                "ice_forest_route",
                "ice_tree_maze",
                "ice_tree_blob",
                "ice_neck_route"
            ],
            compound: ["ice_compound_raid"]
        };
        var familyRandom = this.IceStyleRandom(pRandom, 6229);
        var family = this.WeightedPick(familyRandom, familyWeights, "open");
        var familyStyleWeights = {};
        var eligibleStyles = familyStyles[family] || familyStyles.open;
        for(var familyStyleIndex = 0;
            familyStyleIndex < eligibleStyles.length;
            ++familyStyleIndex) {
            var familyStyle = eligibleStyles[familyStyleIndex];
            if(Number(weights[familyStyle] || 0) > 0)
                familyStyleWeights[familyStyle] = weights[familyStyle];
        }
        // Mobility/archetype filtering may legitimately empty a family.
        // Fall back to the complete compatible set without changing the
        // independent family/style RNG streams.
        var name = this.WeightedPick(
            styleRandom,
            this.Keys(familyStyleWeights).length ? familyStyleWeights : weights,
            "ice_outpost"
        );
        return {
            name: name,
            family: family,
            source: pArchetype === "water_heavy_ice" ?
                "grammar_ice_water_family_then_style" :
                "grammar_ice_family_then_style",
            familyWeights: familyWeights,
            weights: weights
        };
    },

    Select: function(pContext, pPlan) {
        var self = MapGen.Grammar.Intent;
        var profile = pContext.Profile || {};
        var profileName = profile.Name || pPlan.profileName;
        var target = (pContext.Profile || {}).TargetPack || {};
        var targets = target.targets || {};
        var missionFlow = targets.missionFlow || {};
        var mobilityFlow = targets.mobilityMissionFlow || {};
        var composition = targets.composition || {};
        var dynamicTerrain = targets.dynamicTerrain || {};
        var outlierReasons = [];
        var notes = [];
        var band = self.PickCampaignBand(pContext, target, outlierReasons);
        var forcedObjectiveLabel;
        var forcedMobilityMode;
        var forcedArchetype;
        var objectiveWeights = self.CombineProfileAndBandWeights(
            missionFlow.objectiveLabels || {},
            band.target ? band.target.objectiveLabelCounts || {} : {}
        );
        objectiveWeights = self.FilterObjectiveWeights(objectiveWeights);
        forcedObjectiveLabel = self.ProfileString(profile, "ForcedObjectiveLabel");
        var objectiveLabel = forcedObjectiveLabel || self.WeightedPick(
            pContext.Random,
            objectiveWeights,
            "destroy_buildings"
        );
        var orderPattern = self.PickOrderPattern(
            pContext.Random,
            missionFlow,
            objectiveLabel
        );
        var orderSteps = self.SplitOrderPattern(orderPattern);
        var mobilityWeights = self.CombineProfileAndBandWeights(
            mobilityFlow.requiredModeCounts || missionFlow.mobilityModes || {},
            band.target ? band.target.requiredModeCounts || {} : {}
        );
        forcedMobilityMode = self.ProfileString(profile, "ForcedMobilityMode");
        var mobilityMode = forcedMobilityMode || self.WeightedPick(
            pContext.Random,
            mobilityWeights,
            "foot"
        );
        forcedArchetype = self.ProfileString(profile, "ForcedArchetype");
        var archetype = forcedArchetype || self.WeightedPick(
            pContext.Random,
            target.archetypeWeights || {},
            "long_route"
        );
        var profileRouteStats = missionFlow.routeLength || (composition.route ? composition.route.routeLength : null);
        var bandRouteStats = band.target ? band.target.routeLength : null;
        var routeLengthTarget = self.PickBlendedStatNumber(
            pContext.Random,
            profileRouteStats,
            bandRouteStats,
            true,
            self.PickStatNumber(pContext.Random, profileRouteStats, true, 96)
        );
        routeLengthTarget = self.PickProfileNumber(
            pContext.Random,
            profile.ForcedRouteLengthTarget,
            true,
            routeLengthTarget
        );
        var legCountTarget = self.PickStatNumber(
            pContext.Random,
            missionFlow.legCount,
            true,
            orderSteps.length || 1
        );
        var primaryGoalCountTarget = self.PickBlendedStatNumber(
            pContext.Random,
            missionFlow.primaryGoalCount,
            band.target ? band.target.objectiveCount : null,
            true,
            Math.max(1, orderSteps.length || 1)
        );
        primaryGoalCountTarget = self.PickProfileNumber(
            pContext.Random,
            profile.ForcedPrimaryGoalCountTarget,
            true,
            primaryGoalCountTarget
        );
        var pressureGoalCountTarget = self.PickBlendedStatNumber(
            pContext.Random,
            missionFlow.pressureGoalCount,
            band.target ? band.target.enemyCount : null,
            true,
            0
        );
        pressureGoalCountTarget = self.PickProfileNumber(
            pContext.Random,
            profile.ForcedPressureGoalCountTarget,
            true,
            pressureGoalCountTarget
        );
        var supportGoalCountTarget = self.PickBlendedStatNumber(
            pContext.Random,
            missionFlow.supportGoalCount,
            band.target ? band.target.supportCount : null,
            true,
            0
        );
        supportGoalCountTarget = self.PickProfileNumber(
            pContext.Random,
            profile.ForcedSupportGoalCountTarget,
            true,
            supportGoalCountTarget
        );
        var dynamicMode = self.DynamicTerrainMode(pContext.Random, dynamicTerrain, mobilityMode);
        var guardrails = self.Guardrails(
            profile,
            objectiveLabel,
            mobilityMode,
            dynamicMode.name
        );
        var iceLayout = self.IceLayoutStyle(
            pContext.Random,
            profile,
            objectiveLabel,
            mobilityMode,
            archetype
        );
        var routeArchetype = self.ProfileString(profile, "RouteArchetype");

        if(!routeArchetype && MapGen.Layout && MapGen.Layout.RouteArchetypes &&
            MapGen.Layout.RouteArchetypes.ResolveName)
            routeArchetype = MapGen.Layout.RouteArchetypes.ResolveName(pContext);

        if(iceLayout) {
            guardrails.iceLayoutStyle = iceLayout.name;
            guardrails.iceLayoutPolicy = iceLayout.source;
        }
        if(routeArchetype)
            guardrails.routeArchetype = routeArchetype;

        if(objectiveLabel === "objective_unknown")
            outlierReasons.push("objective_unknown_template_required");
        if(profile.TargetPackProfile === "grammar_beach")
            notes.push("beach_profile_uses_standalone_objectives_no_compounds");
        if(forcedObjectiveLabel)
            notes.push("forced_objective_label:" + forcedObjectiveLabel);
        if(forcedMobilityMode)
            notes.push("forced_mobility_mode:" + forcedMobilityMode);
        if(forcedArchetype)
            notes.push("forced_archetype:" + forcedArchetype);
        if(profile.ForcedIceLayoutStyle)
            notes.push("forced_ice_layout:" + profile.ForcedIceLayoutStyle);
        if(routeArchetype)
            notes.push("route_archetype:" + routeArchetype);

        return {
            name: "intent",
            status: "ready",
            profileName: profileName,
            terrainVariant: pPlan.terrainVariant,
            targetPackProfileName: pPlan.targetPackProfileName,
            officialDataConfidence: target.officialDataConfidence || "",
            archetypeWeights: target.archetypeWeights || {},
            routeArchetype: routeArchetype,
            selectedWeights: {
                objectiveLabels: objectiveWeights,
                mobilityModes: mobilityWeights
            },
            archetype: archetype,
            mapScale: self.MapScale(pContext, archetype, routeLengthTarget, profileRouteStats),
            objectiveLabel: objectiveLabel,
            objectiveTemplate: self.ObjectiveTemplate(objectiveLabel),
            campaignBand: {
                name: band.name,
                source: band.source,
                weight: band.weight || 0
            },
            mobilityMode: mobilityMode,
            mobilityFeatureFlags: self.MobilityFeatureFlags(mobilityMode),
            dynamicTerrainMode: dynamicMode.name,
            dynamicTerrain: dynamicMode,
            routeShape: {
                orderPattern: orderPattern,
                steps: orderSteps,
                legCountTarget: Math.max(orderSteps.length || 1, legCountTarget),
                routeLengthTarget: routeLengthTarget,
                primaryGoalCountTarget: Math.max(1, primaryGoalCountTarget),
                pressureGoalCountTarget: Math.max(0, pressureGoalCountTarget),
                supportGoalCountTarget: Math.max(0, supportGoalCountTarget)
            },
            requiredAssets: self.RequiredAssets(objectiveLabel, mobilityMode, orderSteps),
            iceLayout: iceLayout,
            guardrails: guardrails,
            targetRefs: [
                "profiles." + pPlan.targetPackProfileName + ".archetypeWeights",
                "profiles." + pPlan.targetPackProfileName + ".targets.missionFlow",
                "profiles." + pPlan.targetPackProfileName + ".targets.mobilityMissionFlow",
                "profiles." + pPlan.targetPackProfileName + ".targets.dynamicTerrain",
                "globalTargets.campaignProgression"
            ],
            notes: notes,
            outlierReasons: outlierReasons
        };
    }
};
