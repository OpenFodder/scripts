var MapGen = MapGen || {};
MapGen.Grammar = MapGen.Grammar || {};

MapGen.Grammar.Materialize = {

    HasOwn: function(pObject, pKey) { return MapGen.Grammar.Util.HasOwn(pObject, pKey); },

    NumberOrNull: function(pValue) { return MapGen.Grammar.Util.NumberOrNull(pValue); },

    Clamp: function(pValue, pMin, pMax) { return MapGen.Grammar.Util.Clamp(pValue, pMin, pMax); },

    Round: function(pValue, pPlaces) { return MapGen.Grammar.Util.Round(pValue, pPlaces); },

    StatRange: function(pStats, pPreferWide) { return MapGen.Grammar.Util.StatRange(pStats, pPreferWide); },

    PickStatNumber: function(pRandom, pStats, pInteger, pFallback) {
        return MapGen.Grammar.Util.PickStatNumberOuter(pRandom, pStats, pInteger, pFallback);
    },

    RangeSummary: function(pStats) { return MapGen.Grammar.Util.RangeSummary(pStats); },

    PickMetric: function(pContext, pStats, pInteger, pFallback) {
        return MapGen.Grammar.Util.PickMetricOuter(pContext, pStats, pInteger, pFallback);
    },

    AddUnique: function(pList, pValue) {
        if(pValue === undefined || pValue === null)
            return;

        for(var index = 0; index < pList.length; ++index) {
            if(pList[index] === pValue)
                return;
        }

        pList.push(pValue);
    },

    SortByCountDesc: function(pEntries) {
        var result = [];
        var index;

        for(index = 0; index < (pEntries || []).length; ++index)
            result.push(pEntries[index]);

        result.sort(function(a, b) {
            var byCount = Number(b.count || 0) - Number(a.count || 0);
            if(byCount !== 0)
                return byCount;
            // Total-order tiebreak: motif/sequence signatureId is unique and
            // stable, so equal-count entries keep a deterministic order
            // regardless of the engine's (unstable) Array.sort. Without this,
            // tied motifs could swap slots between process launches and
            // regenerate the map differently for the same seed.
            var leftSig = String(a.signatureId || "");
            var rightSig = String(b.signatureId || "");
            if(leftSig < rightSig)
                return -1;
            if(leftSig > rightSig)
                return 1;
            return 0;
        });

        return result;
    },

    ObjectKeys: function(pObject) {
        var result = [];
        var key;

        for(key in (pObject || {})) {
            if(this.HasOwn(pObject, key))
                result.push(key);
        }

        return result;
    },

    // Returns the top motifs per window as lightweight identity stubs
    // (signatureId/windowSize/count). The heavy per-motif bodies (rows,
    // centerTileCounts/centerVisualCounts, topVisualWindows) and the aggregated
    // centerTileIds list were write-only telemetry: nothing in the live build,
    // validator, IntegrationMetadata, or the Python doc generator reads them —
    // only the motif COUNT (motifs.length) is consumed. Kept the count + a
    // stable identity so the recipe count, outlier checks, and seed-debug
    // signature comparisons still work. Verified via ContextPlanFingerprint.
    TopMotifs: function(pFeature, pMaxPerWindow) {
        var windows = pFeature ? pFeature.motifWindows || {} : {};
        var windowKeys = this.ObjectKeys(windows);
        var result = [];

        windowKeys.sort(function(a, b) {
            return Number(a) - Number(b);
        });

        for(var windowIndex = 0; windowIndex < windowKeys.length; ++windowIndex) {
            var windowKey = windowKeys[windowIndex];
            var sorted = this.SortByCountDesc(windows[windowKey]);

            for(var index = 0; index < sorted.length && index < pMaxPerWindow; ++index) {
                var motif = sorted[index];
                result.push({
                    signatureId: motif.signatureId || "",
                    windowSize: Number(motif.windowSize || windowKey),
                    count: Number(motif.count || 0)
                });
            }
        }

        return {
            motifs: result,
            centerTileIds: []
        };
    },

    FeatureRecipe: function(pContext, pExact, pFeatureName, pSemanticSource, pRequired, pOutlierReasons) {
        var features = pExact ? pExact.features || {} : {};
        var feature = features[pFeatureName] || null;
        var top = this.TopMotifs(feature, 2);

        if(pRequired && (!feature || !top.motifs.length))
            pOutlierReasons.push("tile_motif_missing:" + pFeatureName);

        return {
            feature: pFeatureName,
            required: !!pRequired,
            semanticSource: pSemanticSource,
            cellTarget: this.PickMetric(pContext, feature ? feature.cellsPerMap : null, true, 0),
            motifCount: top.motifs.length,
            motifs: top.motifs,
            centerTileIds: top.centerTileIds,
            confidence: top.motifs.length ? "motif_supported" : "missing_motif_support"
        };
    },

    // As with TopMotifs, the heavy per-sequence tile-id bodies and the
    // aggregated tileIds list were write-only telemetry; only the sequence
    // COUNT is consumed. Keep lightweight identity stubs + the count.
    TopTransition: function(pContext, pTransitionName, pTransition, pRequired, pOutlierReasons) {
        var sequences = this.SortByCountDesc(pTransition ? pTransition.sequences || [] : []);
        var result = [];

        for(var index = 0; index < sequences.length && index < 4; ++index) {
            result.push({
                signatureId: sequences[index].signatureId || "",
                count: Number(sequences[index].count || 0)
            });
        }

        if(pRequired && !result.length)
            pOutlierReasons.push("exact_transition_gap:" + pTransitionName);

        return {
            transition: pTransitionName,
            required: !!pRequired,
            countTarget: this.PickMetric(pContext, pTransition ? pTransition.countPerMap : null, true, 0),
            sequenceCount: result.length,
            sequences: result,
            tileIds: [],
            confidence: result.length ? "sequence_supported" : "missing_sequence_support"
        };
    },

    HasFeature: function(pExact, pFeatureName) {
        return !!(pExact && pExact.features && pExact.features[pFeatureName]);
    },

    AddFeatureNeed: function(pNeeds, pExact, pFeatureName, pSemanticSource, pRequired) {
        if(!this.HasFeature(pExact, pFeatureName) && !pRequired)
            return;

        for(var index = 0; index < pNeeds.length; ++index) {
            if(pNeeds[index].name === pFeatureName) {
                pNeeds[index].required = pNeeds[index].required || !!pRequired;
                return;
            }
        }

        pNeeds.push({
            name: pFeatureName,
            semanticSource: pSemanticSource,
            required: !!pRequired
        });
    },

    PrimaryCompoundCategory: function(pCompound) {
        if(!pCompound)
            return "";

        if(pCompound.category)
            return pCompound.category;
        if(pCompound.templateCategory)
            return pCompound.templateCategory;
        if(pCompound.template && pCompound.template.category)
            return pCompound.template.category;
        if(pCompound.sourceTemplate && pCompound.sourceTemplate.category)
            return pCompound.sourceTemplate.category;

        return "";
    },

    FeatureNeeds: function(pPlan, pExact) {
        var semantic = pPlan.semanticTerrain || {};
        var counts = semantic.counts || {};
        var objectivePlan = pPlan.objectivePlan || {};
        var spritePlan = pPlan.spritePlan || {};
        var dynamicTerrain = pPlan.dynamicTerrainPlan || {};
        var needs = [];
        var structures = objectivePlan.structures || [];
        var compounds = objectivePlan.compounds || [];
        var structureSprites = spritePlan.structureSprites || [];
        var objectives = objectivePlan.objectives || [];
        var variant = pPlan.terrainVariant || "";
        var hasTrees = Number(counts.treeBlobs || 0) > 0;
        var hasWater = Number(counts.waterBodies || 0) > 0;
        var hasCliffs = Number(counts.cliffBands || 0) > 0;
        var hasBeach = variant === "jun_sub1" ||
            (variant === "jun_sub0" && Number(counts.beachHazards || 0) > 0);
        var hasStructures = structures.length > 0 || structureSprites.length > 0 || compounds.length > 0;

        this.AddFeatureNeed(needs, pExact, "plain_dry_land", "semanticTerrain.layers.ground", true);
        this.AddFeatureNeed(needs, pExact, "route_corridors", "semanticTerrain.layers.routeCorridors", true);
        this.AddFeatureNeed(needs, pExact, "plain_route_corridors", "semanticTerrain.layers.cover.routePlainSegments", true);

        if(hasTrees) {
            this.AddFeatureNeed(needs, pExact, "tree_tiles", "semanticTerrain.layers.trees", true);
            this.AddFeatureNeed(needs, pExact, "tree_edges", "semanticTerrain.layers.trees", true);
        }

        if(hasWater) {
            this.AddFeatureNeed(needs, pExact, "water_tiles", "semanticTerrain.layers.water", true);
            this.AddFeatureNeed(needs, pExact, "water_banks", "semanticTerrain.layers.water", true);
        }

        if(hasCliffs) {
            this.AddFeatureNeed(needs, pExact, "cliff_tiles", "semanticTerrain.layers.cliffs", true);
            this.AddFeatureNeed(needs, pExact, "cliff_transitions", "semanticTerrain.layers.cliffs", true);
        }

        if(hasBeach) {
            this.AddFeatureNeed(needs, pExact, "beach_quicksand_tiles", "semanticTerrain.layers.beach", true);
            this.AddFeatureNeed(needs, pExact, "beach_quicksand_borders", "semanticTerrain.layers.beach", true);
        }

        if(hasStructures) {
            this.AddFeatureNeed(needs, pExact, "structure_tiles", "objectivePlan.structures", true);
            this.AddFeatureNeed(needs, pExact, "structure_edges", "objectivePlan.structures", true);
            this.AddFeatureNeed(needs, pExact, "structure_compound_footprints", "objectivePlan.compounds", compounds.length > 0);
            this.AddFeatureNeed(needs, pExact, "structure_compound_edges", "objectivePlan.compounds", compounds.length > 0);
        }

        if(objectives.length)
            this.AddFeatureNeed(needs, pExact, "objective_arenas", "objectivePlan.objectives", true);

        for(var index = 0; index < compounds.length; ++index) {
            var category = this.PrimaryCompoundCategory(compounds[index]);
            var featureName = category ? "compound_category:" + category : "";

            if(featureName && this.HasFeature(pExact, featureName))
                this.AddFeatureNeed(needs, pExact, featureName, "objectivePlan.compounds", true);
        }

        if(dynamicTerrain.swapPairs && dynamicTerrain.swapPairs.length)
            this.AddFeatureNeed(needs, pExact, "route_corridors", "dynamicTerrainPlan.swapPairs", true);

        return needs;
    },

    AddTransitionNeed: function(pNeeds, pExact, pName, pSemanticSource, pRequired) {
        var transitions = pExact ? pExact.transitionSequences || {} : {};

        if(!transitions[pName] && !pRequired)
            return;

        for(var index = 0; index < pNeeds.length; ++index) {
            if(pNeeds[index].name === pName) {
                pNeeds[index].required = pNeeds[index].required || !!pRequired;
                return;
            }
        }

        pNeeds.push({
            name: pName,
            semanticSource: pSemanticSource,
            required: !!pRequired
        });
    },

    TransitionNeeds: function(pPlan, pExact) {
        var semantic = pPlan.semanticTerrain || {};
        var counts = semantic.counts || {};
        var objectivePlan = pPlan.objectivePlan || {};
        var spritePlan = pPlan.spritePlan || {};
        var needs = [];
        var structures = (objectivePlan.structures || []).length > 0 ||
            (objectivePlan.compounds || []).length > 0 ||
            (spritePlan.structureSprites || []).length > 0;
        var variant = pPlan.terrainVariant || "";

        if(Number(counts.treeBlobs || 0) > 0)
            this.AddTransitionNeed(needs, pExact, "tree_edge", "semanticTerrain.layers.trees", true);
        if(Number(counts.waterBodies || 0) > 0)
            this.AddTransitionNeed(needs, pExact, "water_bank", "semanticTerrain.layers.water", true);
        if(Number(counts.cliffBands || 0) > 0)
            this.AddTransitionNeed(needs, pExact, "cliff_transition", "semanticTerrain.layers.cliffs", true);
        if(variant === "jun_sub1" || (variant === "jun_sub0" && Number(counts.beachHazards || 0) > 0))
            this.AddTransitionNeed(needs, pExact, "beach_quicksand_border", "semanticTerrain.layers.beach", true);
        if(structures)
            this.AddTransitionNeed(needs, pExact, "building_transition", "objectivePlan.structures", true);

        return needs;
    },

    RoutePhaseRecipes: function(pContext, pExact, pOutlierReasons) {
        var phases = pExact ? pExact.routePhases || {} : {};
        var phaseNames = [
            "start_zone",
            "first_contact",
            "mid_route",
            "objective_arena",
            "extraction_exit"
        ];
        var result = [];

        for(var index = 0; index < phaseNames.length; ++index) {
            var name = phaseNames[index];
            var phase = phases[name] || null;
            var top = this.TopMotifs(phase, 1);

            if(!phase || !top.motifs.length)
                pOutlierReasons.push("route_phase_tile_motif_missing:" + name);

            result.push({
                phase: name,
                routeSource: "routePlan.routeBeats[" + name + "]",
                cellTarget: this.PickMetric(pContext, phase ? phase.cellsPerMap : null, true, 0),
                motifCount: top.motifs.length,
                motifs: top.motifs,
                centerTileIds: top.centerTileIds,
                confidence: top.motifs.length ? "motif_supported" : "missing_motif_support"
            });
        }

        return result;
    },

    SmoothingBackend: function(pPlan) {
        var variant = pPlan.terrainVariant || "";

        if(variant === "ice_sub0") {
            return {
                enabled: true,
                exactTileGrammarGuided: true,
                backend: "ice_bitmask_smoothing",
                usesIceTreeStyleProfile: true,
                reusableModules: [
                    "MapGen.Render",
                    "MapGen.Terrain.TileCatalog",
                    "MapGen.Terrain.Smoothing.Core",
                    "MapGen.Terrain.Smoothing.Ice",
                    "MapGen.Terrain.Smoothing.GrassVariantSmoother",
                    "MapGen.Terrain.TilePolish",
                    "IceTreeStyleProfile"
                ]
            };
        }

        return {
            enabled: true,
            exactTileGrammarGuided: true,
            backend: "jungle_smoothing",
            usesIceTreeStyleProfile: false,
            reusableModules: [
                "MapGen.Render",
                "MapGen.Terrain.TileCatalog",
                "MapGen.Terrain.Smoothing.Core",
                "MapGen.Terrain.Smoothing.Jungle",
                "MapGen.Terrain.Smoothing.GrassVariantSmoother",
                "MapGen.Terrain.TilePolish"
            ]
        };
    },

    PostChecks: function() {
        return [
            {
                id: "route_corridors_still_pass_hit_bht",
                source: "routePlan.subcellValidation",
                hardGate: true
            },
            {
                id: "objective_target_cells_are_reachable_and_interactable",
                source: "objectivePlan.objectiveTruth",
                hardGate: true
            },
            {
                id: "swp_source_target_states_match_dynamic_pair_grammar",
                source: "dynamicTerrainPlan.swapPairs",
                hardGate: true
            },
            {
                id: "required_transitions_have_exact_tile_support",
                source: "materialization.transitionRecipes",
                hardGate: false
            },
            {
                id: "required_features_have_motif_support",
                source: "materialization.featureRecipes",
                hardGate: false
            },
            {
                id: "route_phase_tiles_follow_official_motifs",
                source: "materialization.routePhaseRecipes",
                hardGate: false
            }
        ];
    },

    PostpassRecipes: function(pContext, pPlan) {
        var profile = pContext.Profile || {};
        var targetPackProfile = profile.TargetPackProfile || (pPlan ? pPlan.targetPackProfileName : "");
        var recipes = [];

        function add(pId, pSource, pSemanticSource) {
            recipes.push({
                id: pId,
                enabled: true,
                owner: "MapGen.Grammar.StyleMaterialize",
                stage: "after_smoothing",
                quarantine: "profile_scoped",
                targetPackProfile: targetPackProfile,
                source: pSource,
                semanticSource: pSemanticSource
            });
        }

        if(profile.GeneratorCore !== "official_grammar")
            return recipes;

        if(targetPackProfile === "grammar_beach") {
            add(
                "beach_ocean_edge_repair",
                "StyleTileSets.GrammarBeachOceanRepairSets",
                "semanticTerrain.layers.water + semanticTerrain.layers.beach"
            );
            add(
                "beach_grass_edge_cleanup",
                "Terrain.Smoothing.Jungle.RepairSub1GrammarBeachFinalGrassSideMasks",
                "semanticTerrain.layers.beach + final tile layer"
            );
        }

        return recipes;
    },

    Plan: function(pContext, pPlan) {
        var self = MapGen.Grammar.Materialize;
        var plan = pPlan || pContext.GrammarPlan || {};
        var profile = pContext.Profile || {};
        var target = profile.TargetPack || {};
        var targets = target.targets || {};
        var exact = targets.exactTileGrammar || {};
        var outlierReasons = [];
        var featureNeeds = self.FeatureNeeds(plan, exact);
        var transitionNeeds = self.TransitionNeeds(plan, exact);
        var featureRecipes = [];
        var transitionRecipes = [];
        var routePhaseRecipes;
        var index;

        if(!targets.exactTileGrammar)
            outlierReasons.push("exact_tile_grammar_missing");
        if(!plan.semanticTerrain || plan.semanticTerrain.status !== "ready")
            outlierReasons.push("semantic_terrain_missing_for_materialization");

        for(index = 0; index < featureNeeds.length; ++index) {
            featureRecipes.push(self.FeatureRecipe(
                pContext,
                exact,
                featureNeeds[index].name,
                featureNeeds[index].semanticSource,
                featureNeeds[index].required,
                outlierReasons
            ));
        }

        for(index = 0; index < transitionNeeds.length; ++index) {
            var transitionName = transitionNeeds[index].name;
            transitionRecipes.push(self.TopTransition(
                pContext,
                transitionName,
                exact.transitionSequences ? exact.transitionSequences[transitionName] : null,
                transitionNeeds[index].required,
                outlierReasons
            ));
            transitionRecipes[transitionRecipes.length - 1].semanticSource = transitionNeeds[index].semanticSource;
        }

        routePhaseRecipes = self.RoutePhaseRecipes(pContext, exact, outlierReasons);

        return {
            name: "materialization",
            status: outlierReasons.length ? "ready_with_warnings" : "ready",
            materializationMode: "semantic_exact_tile_intent",
            runtimeTileLayerStatus: "deferred_to_render_stage",
            tileLayer: {
                mode: "semantic_exact_tile_intent",
                width: pContext.Width,
                height: pContext.Height,
                semanticSource: "semanticTerrain.layers",
                plannedExactFeatureCount: featureRecipes.length,
                plannedTransitionCount: transitionRecipes.length,
                plannedRoutePhaseCount: routePhaseRecipes.length,
                liveTileBuffer: null
            },
            featureRecipes: featureRecipes,
            transitionRecipes: transitionRecipes,
            routePhaseRecipes: routePhaseRecipes,
            smoothing: self.SmoothingBackend(plan),
            tilePolish: {
                enabled: true,
                module: "MapGen.Terrain.TilePolish",
                stage: "after_smoothing",
                exactTileGrammarGuided: true
            },
            postMaterializationChecks: self.PostChecks(),
            postpassRecipes: self.PostpassRecipes(pContext, plan),
            targetFamilies: [
                "exactTileGrammar",
                "semanticTerrain",
                "iceTreeStyle",
                "HIT/BHT",
                "composition",
                "spatialGrammar"
            ],
            targetRefs: [
                "profiles." + (plan.targetPackProfileName || profile.TargetPackProfile || "") + ".targets.exactTileGrammar",
                "semanticTerrain.layers",
                "routePlan.subcellValidation",
                "dynamicTerrainPlan.swapPairs",
                "objectivePlan.objectiveTruth"
            ],
            notes: [
                "This stage emits exact tile-ID materialization recipes; the live .map tile buffer still comes from the existing render path until the replacement core owns final stamping.",
                "Passability gates must stay HIT/BHT-derived; visual motifs only select tile art and transition shape."
            ],
            outlierReasons: outlierReasons
        };
    }
};
