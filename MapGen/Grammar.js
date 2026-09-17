var MapGen = MapGen || {};

MapGen.Grammar = {

    CreatePlan: function(pContext) {
        if(this.Plan && this.Plan.Create)
            return this.Plan.Create(pContext);

        return { schema: 1, scaffoldOnly: true, outlierReasons: ["grammar_plan_module_missing"] };
    },

    RunStage: function(pContext, pName, pFn) {
        if(!pFn)
            return null;

        return MapGen.Context.Time(pContext, "Grammar." + pName, function() {
            return pFn(pContext, pContext.GrammarPlan);
        });
    },

    BuildPlan: function(pContext) {
        var self = this;
        pContext.GrammarPlan.profile = self.RunStage(
            pContext,
            "Profile",
            self.Profile && self.Profile.Resolve
        );
        pContext.GrammarPlan.intent = self.RunStage(
            pContext,
            "Intent",
            self.Intent && self.Intent.Select
        );
        // Intent selection may establish the target-pack terrain/style used by
        // the structure budget. Resolve the budget before Objectives consumes
        // compound counts and structure caps.
        self.ApplyMapScaleStructureProgression(pContext);
        pContext.GrammarPlan.screenPlan = self.RunStage(
            pContext,
            "Viewport",
            self.Viewport && self.Viewport.Plan
        );
        pContext.GrammarPlan.routePlan = self.RunStage(
            pContext,
            "Route",
            self.Route && self.Route.Plan
        );
        self.PrepareOriginalTerrainTemplate(pContext);
        if(pContext.GrammarPlan.routePlan && pContext.GrammarPlan.routePlan.mobilityPlan)
            pContext.GrammarPlan.mobilityPlan = pContext.GrammarPlan.routePlan.mobilityPlan;
        pContext.GrammarPlan.objectivePlan = self.RunStage(
            pContext,
            "Objectives",
            self.Objectives && self.Objectives.Plan
        );
        // compoundPlan/supportPlan/civilianPlan were derived sub-plans with NO
        // live consumers (only the inert Grammar/Validate scaffold gate read
        // them). Removed in the architecture v3 scaffold cleanup — the live
        // pipeline reads objectivePlan/spritePlan directly.
        pContext.GrammarPlan.spritePlan = self.RunStage(
            pContext,
            "Sprites",
            self.Sprites && self.Sprites.Plan
        );
        pContext.GrammarPlan.dynamicTerrainPlan = self.RunStage(
            pContext,
            "DynamicTerrain",
            self.DynamicTerrain && self.DynamicTerrain.Plan
        );
        pContext.GrammarPlan.semanticTerrain = self.RunStage(
            pContext,
            "Terrain",
            self.Terrain && self.Terrain.Plan
        );
        pContext.GrammarPlan.materialization = self.RunStage(
            pContext,
            "Materialize",
            self.Materialize && self.Materialize.Plan
        );
        // The scaffold self-validation stage (Grammar/Validate) was removed: it
        // drew no RNG and NEVER failed (verified across all generated maps), so
        // it was an inert gate validating a plan the live render doesn't apply.
        // Real acceptance is the live MapGen.Validate.Run in the campaign pipeline.
        return pContext.GrammarPlan;
    },

    UsesOriginalTerrainTemplate: function(pContext) {
        var profile = pContext && pContext.Profile ? pContext.Profile : {};
        // Named procedural styles own their macro terrain contract.  Feeding
        // an unrelated shipped-map raster through them can erase the authored
        // river/neck/jump (and was also the main source of near-duplicate
        // outputs).  Profiles may explicitly opt out while generic profiles
        // continue to use the corpus exemplar path.
        if(profile.UseOriginalTerrainTemplate === false)
            return false;
        return profile.TargetPackProfile === "grammar_jungle" ||
            profile.TargetPackProfile === "grammar_ice";
    },

    PrepareOriginalTerrainTemplate: function(pContext) {
        if(!this.UsesOriginalTerrainTemplate(pContext))
            return null;

        var plan = pContext.GrammarPlan || {};
        var frame = plan.routePlan && plan.routePlan.routeFrame ?
            plan.routePlan.routeFrame : null;
        var targets = pContext.Profile && pContext.Profile.TargetPack ?
            pContext.Profile.TargetPack.targets || {} : {};
        var profileName = String((pContext.Profile || {}).TargetPackProfile || "");
        var templates = MapGen.OriginalTerrainTemplates &&
            MapGen.OriginalTerrainTemplates[profileName] ?
                MapGen.OriginalTerrainTemplates[profileName] :
                targets.terrainShapeTemplates || [];
        var sourceMap = frame ? String(frame.sourceMap || "") : "";
        var selected = null;
        var index;

        for(index = 0; index < templates.length; ++index) {
            if(String(templates[index].sourceMap || "") === sourceMap) {
                selected = templates[index];
                break;
            }
        }
        // Cross-biome styles (currently ice maze) deliberately reuse a
        // shipped jungle topology.  Resolve the frame's source map across the
        // small generated corpus before falling back to an unrelated local
        // template.
        if(!selected && MapGen.OriginalTerrainTemplates) {
            for(var templateProfile in MapGen.OriginalTerrainTemplates) {
                if(!MapGen.OriginalTerrainTemplates.hasOwnProperty(templateProfile))
                    continue;
                var alternateTemplates = MapGen.OriginalTerrainTemplates[templateProfile] || [];
                for(index = 0; index < alternateTemplates.length; ++index) {
                    if(String(alternateTemplates[index].sourceMap || "") === sourceMap) {
                        selected = alternateTemplates[index];
                        break;
                    }
                }
                if(selected)
                    break;
            }
        }
        if(!selected && templates.length)
            selected = templates[pContext.Random.Int(0, templates.length - 1)];
        if(!selected || !selected.rows || !selected.rows.length)
            return null;

        pContext.OriginalTerrainTemplate = {
            sourceMap: selected.sourceMap,
            width: Number(selected.width || 0),
            height: Number(selected.height || 0),
            rows: selected.rows,
            counts: selected.counts || {},
            transform: frame ? Number(frame.transform || 0) : 0,
            // Low-frequency warp changes silhouettes without breaking the
            // source map's macro relationship between open ground and cover.
            warpPhase: ((pContext.Seed >>> 0) % 6283) / 1000,
            // Enough to avoid a pixel-identical trace, but not enough to fold
            // narrow original corridors into disconnected tree fragments.
            warpAmount: 0.012 + (((pContext.Seed >>> 8) & 255) / 14166)
        };

        var totalCells = Math.max(1,
            pContext.OriginalTerrainTemplate.width * pContext.OriginalTerrainTemplate.height);
        var sourceTreeFraction = Number((selected.counts || {}).T || 0) / totalCells;
        var sourceWaterFraction = Number((selected.counts || {}).W || 0) / totalCells;
        var runtimeProfile = pContext.Profile || {};
        runtimeProfile.TreeCoverage = sourceTreeFraction;
        // Live routes, objective pads and structure access are deliberately
        // carved through the exemplar after resampling.  Budget for that
        // gameplay carve rather than rejecting a faithful source shape for
        // landing a fraction below its raw (pre-object) tree percentage.
        runtimeProfile.MinTreeCoverage = Math.max(0, sourceTreeFraction * 0.55);
        runtimeProfile.MaxTreeCoverage = Math.min(0.90,
            Math.max(sourceTreeFraction + 0.025, sourceTreeFraction * 1.12));
        runtimeProfile.MaxWaterCoverage = Math.min(0.60,
            Math.max(Number(runtimeProfile.MaxWaterCoverage || 0),
                sourceWaterFraction + 0.035, sourceWaterFraction * 1.12));
        // The ice renderer normally invents extra perimeter/route/open-field
        // tree ribbons to rescue generic sparse masks.  An original template
        // already owns that decision; replaying those injectors is precisely
        // how a treeless cliff map acquired random tree fragments.
        runtimeProfile.FinalOpenFieldCover = false;
        runtimeProfile.FinalRouteEdgeCover = false;
        runtimeProfile.RouteExposureHardFail = false;
        if(runtimeProfile.TerrainType === Terrain.Types.Ice) {
            runtimeProfile.AllowOuterEdgeCover = false;
            runtimeProfile.OuterCoverClearance = Math.max(4,
                Number(runtimeProfile.OuterCoverClearance || 0));
        }
        else {
            // The jungle originals routinely use the map edge as one side of
            // a forest wall. The jungle atlas supports it and removing that
            // band opens every maze around its perimeter.
            runtimeProfile.AllowOuterEdgeCover = true;
            runtimeProfile.OuterCoverClearance = 0;
        }
        MapGen.Context.AddLog(pContext,
            "Selected original terrain shape " + selected.sourceMap +
            " transform=" + pContext.OriginalTerrainTemplate.transform +
            " tree=" + sourceTreeFraction.toFixed(3) +
            " water=" + sourceWaterFraction.toFixed(3));
        return pContext.OriginalTerrainTemplate;
    },

    OriginalTerrainSourcePoint: function(pContext, pX, pY) {
        var item = pContext.OriginalTerrainTemplate;
        if(!item)
            return null;
        var u = pContext.Width > 1 ? pX / (pContext.Width - 1) : 0;
        var v = pContext.Height > 1 ? pY / (pContext.Height - 1) : 0;
        var transform = Math.abs(Math.floor(item.transform || 0)) % 8;
        var sx;
        var sy;

        // Inverse of Route.TransformLayoutPoint, so terrain and mission
        // anchors receive exactly the same mirror/rotation.
        if(transform === 0) { sx = u; sy = v; }
        else if(transform === 1) { sx = 1 - u; sy = v; }
        else if(transform === 2) { sx = u; sy = 1 - v; }
        else if(transform === 3) { sx = 1 - u; sy = 1 - v; }
        else if(transform === 4) { sx = v; sy = u; }
        else if(transform === 5) { sx = v; sy = 1 - u; }
        else if(transform === 6) { sx = 1 - v; sy = u; }
        else { sx = 1 - v; sy = 1 - u; }

        var amount = Number(item.warpAmount || 0);
        var phase = Number(item.warpPhase || 0);
        sx += Math.sin((sy * 11.0) + phase) * amount;
        sy += Math.sin((sx * 8.0) + (phase * 1.7)) * amount;
        sx = Math.max(0, Math.min(1, sx));
        sy = Math.max(0, Math.min(1, sy));
        return {
            x: Math.max(0, Math.min(item.width - 1,
                Math.round(sx * (item.width - 1)))),
            y: Math.max(0, Math.min(item.height - 1,
                Math.round(sy * (item.height - 1))))
        };
    },

    OriginalTerrainCell: function(pContext, pX, pY) {
        var item = pContext.OriginalTerrainTemplate;
        var point = this.OriginalTerrainSourcePoint(pContext, pX, pY);
        if(!item || !point || !item.rows[point.y])
            return "G";
        return item.rows[point.y].charAt(point.x) || "G";
    },

    OriginalTerrainCellProtected: function(pContext, pX, pY, pRadius, pProtectPath) {
        var layers = pContext.Layers || {};
        var radius = Math.max(0, Math.floor(pRadius || 0));
        for(var x = pX - radius; x <= pX + radius; ++x) {
            for(var y = pY - radius; y <= pY + radius; ++y) {
                var owner = layers.owner ?
                    MapGen.Layers.Get(layers.owner, x, y, 0) :
                    MapGen.Layers.Owner.NONE;
                // `keepClear` includes a broad tactical halo and `path` is a
                // separately invented route.  Neither may carve an original
                // forest exemplar: its own open corridors are the route. Water
                // still protects the path so a generated crossing stays dry.
                if((pProtectPath && MapGen.Layers.Get(layers.path, x, y, 0)) ||
                    MapGen.Layers.Get(layers.occupied, x, y, 0))
                    return true;
                if(owner === MapGen.Layers.Owner.CLEARING ||
                    owner === MapGen.Layers.Owner.STRUCTURE ||
                    owner === MapGen.Layers.Owner.CLIFF ||
                    owner === MapGen.Layers.Owner.OBJECT ||
                    (pProtectPath && owner === MapGen.Layers.Owner.ROUTE))
                    return true;
            }
        }
        return false;
    },

    ApplyOriginalTerrainWater: function(pContext) {
        if(!pContext || !pContext.OriginalTerrainTemplate || !pContext.Layers)
            return 0;
        var layers = pContext.Layers;
        var waterCount = 0;
        var owner;
        var desired;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                owner = MapGen.Layers.Get(layers.owner, x, y, 0);
                desired = this.OriginalTerrainCell(pContext, x, y) === "W" &&
                    !this.OriginalTerrainCellProtected(pContext, x, y, 1, true) &&
                    owner !== MapGen.Layers.Owner.CLIFF;

                MapGen.Layers.Set(layers.water, x, y, desired ? 1 : 0);
                MapGen.Layers.Set(layers.coast, x, y, 0);
                MapGen.Layers.Set(layers.lakeShore, x, y, 0);
                MapGen.Layers.Set(layers.riverBank, x, y, 0);
                MapGen.Layers.Set(layers.forcedBank, x, y, 0);
                MapGen.Layers.Set(layers.crossing, x, y, 0);
                MapGen.Layers.Set(layers.causeway, x, y, 0);

                if(desired) {
                    ++waterCount;
                    if(layers.owner && owner < MapGen.Layers.Owner.CLEARING)
                        MapGen.Layers.Set(layers.owner, x, y, MapGen.Layers.Owner.WATER);
                }
                else if(layers.owner && owner === MapGen.Layers.Owner.WATER) {
                    MapGen.Layers.Set(layers.owner, x, y, MapGen.Layers.Owner.OPEN);
                }
            }
        }

        pContext.Crossings = [];
        if(MapGen.Terrain && MapGen.Terrain.Water)
            MapGen.Terrain.Water.Build(pContext);
        MapGen.Context.AddLog(pContext,
            "Applied original terrain water shape: " + waterCount + " cells");
        return waterCount;
    },

    ApplyOriginalTerrainCover: function(pContext) {
        if(!pContext || !pContext.OriginalTerrainTemplate || !pContext.Layers)
            return 0;
        var layers = pContext.Layers;
        var cover = MapGen.Terrain && MapGen.Terrain.Cover;
        var treeCount = 0;
        var owner;

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                owner = MapGen.Layers.Get(layers.owner, x, y, 0);
                if(owner === MapGen.Layers.Owner.TREE) {
                    MapGen.Layers.Set(layers.owner, x, y, MapGen.Layers.Owner.OPEN);
                    MapGen.Layers.Set(layers.blocked, x, y, 0);
                    if(layers.perimeterCover)
                        MapGen.Layers.Set(layers.perimeterCover, x, y, 0);
                }
                else if(owner < MapGen.Layers.Owner.STRUCTURE &&
                    owner !== MapGen.Layers.Owner.CLIFF) {
                    MapGen.Layers.Set(layers.blocked, x, y, 0);
                }
            }
        }

        for(x = 0; x < pContext.Width; ++x) {
            for(y = 0; y < pContext.Height; ++y) {
                if(this.OriginalTerrainCell(pContext, x, y) !== "T")
                    continue;
                // Preserve an access apron around live structures and goals,
                // but do not erase the entire independently planned route.
                if(this.OriginalTerrainCellProtected(pContext, x, y, 2, false))
                    continue;
                // Do not call generic Cover.IsExcluded here: it rejects ROUTE
                // ownership and keepClear, both authored before the exemplar
                // is known. In an original-driven map, the original's open
                // cells define the traversable corridors. Only physical live
                // footprints and incompatible terrain remain exclusions.
                owner = MapGen.Layers.Get(layers.owner, x, y, 0);
                if(owner === MapGen.Layers.Owner.CLEARING ||
                    owner === MapGen.Layers.Owner.CLIFF ||
                    owner === MapGen.Layers.Owner.STRUCTURE ||
                    owner === MapGen.Layers.Owner.OBJECT ||
                    MapGen.Layers.Get(layers.occupied, x, y, 0) ||
                    MapGen.Layers.Get(layers.water, x, y, 0) ||
                    (MapGen.Layers.Get(layers.coast, x, y, 0) && cover &&
                        cover.TreesMayUseCoast && !cover.TreesMayUseCoast(pContext)) ||
                    (cover && cover.IsOuterCoverBuffer &&
                        cover.IsOuterCoverBuffer(pContext, x, y)))
                    continue;
                if(cover && cover.MarkTreeCell)
                    cover.MarkTreeCell(pContext, x, y);
                else
                    MapGen.Layers.Set(layers.blocked, x, y, 1);
                ++treeCount;
            }
        }

        treeCount -= this.PruneOriginalTerrainCover(pContext,
            (pContext.Profile || {}).TerrainType === Terrain.Types.Ice ? 6 : 8);

        // Protect only solid interiors from the ice renderer's cleanup.  The
        // old all-cells marker preserved unsupported one-cell edge/trunk
        // fragments, producing visibly chopped trees after a semantic mask
        // was resampled.  Boundary cells are now free to be replaced by the
        // legal canopy edge chosen by the renderer.
        if(layers.perimeterCover && cover && cover.NeighborBlockedCount) {
            for(x = 0; x < pContext.Width; ++x) {
                for(y = 0; y < pContext.Height; ++y) {
                    if(MapGen.Layers.Get(layers.blocked, x, y, 0) &&
                        cover.NeighborBlockedCount(pContext, x, y) >= 7)
                        MapGen.Layers.Set(layers.perimeterCover, x, y, 1);
                }
            }
        }

        MapGen.Context.AddLog(pContext,
            "Applied original terrain cover shape: " + treeCount + " cells");
        return treeCount;
    },

    PruneOriginalTerrainCover: function(pContext, pMinimumSize) {
        var layers = pContext.Layers || {};
        var visited = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
        var removed = 0;
        var minimumSize = Math.max(2, Math.floor(pMinimumSize || 2));
        var directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];

        for(var startX = 0; startX < pContext.Width; ++startX) {
            for(var startY = 0; startY < pContext.Height; ++startY) {
                if(MapGen.Layers.Get(visited, startX, startY, 0) ||
                    !MapGen.Layers.Get(layers.blocked, startX, startY, 0) ||
                    MapGen.Layers.Get(layers.owner, startX, startY, 0) !==
                        MapGen.Layers.Owner.TREE)
                    continue;

                var queue = [{ x: startX, y: startY }];
                var component = [];
                MapGen.Layers.Set(visited, startX, startY, 1);
                for(var head = 0; head < queue.length; ++head) {
                    var cell = queue[head];
                    component.push(cell);
                    for(var directionIndex = 0;
                        directionIndex < directions.length;
                        ++directionIndex) {
                        var nx = cell.x + directions[directionIndex][0];
                        var ny = cell.y + directions[directionIndex][1];
                        if(!MapGen.Layers.InBounds(layers.blocked, nx, ny) ||
                            MapGen.Layers.Get(visited, nx, ny, 0) ||
                            !MapGen.Layers.Get(layers.blocked, nx, ny, 0) ||
                            MapGen.Layers.Get(layers.owner, nx, ny, 0) !==
                                MapGen.Layers.Owner.TREE)
                            continue;
                        MapGen.Layers.Set(visited, nx, ny, 1);
                        queue.push({ x: nx, y: ny });
                    }
                }

                if(component.length >= minimumSize)
                    continue;
                for(var componentIndex = 0;
                    componentIndex < component.length;
                    ++componentIndex) {
                    var fragment = component[componentIndex];
                    MapGen.Layers.Set(layers.blocked, fragment.x, fragment.y, 0);
                    MapGen.Layers.Set(layers.owner, fragment.x, fragment.y,
                        MapGen.Layers.Owner.OPEN);
                    if(layers.perimeterCover)
                        MapGen.Layers.Set(layers.perimeterCover,
                            fragment.x, fragment.y, 0);
                    ++removed;
                }
            }
        }

        if(removed)
            MapGen.Context.AddLog(pContext,
                "Pruned original-terrain cover fragments: " + removed);
        return removed;
    },

    ApplyIntentToRuntimeProfile: function(pContext) {
        var plan = pContext && pContext.GrammarPlan ? pContext.GrammarPlan : {};
        var intent = plan.intent || {};
        var profile = pContext ? pContext.Profile || null : null;
        var label = String(intent.objectiveLabel || "");
        var templates = null;

        if(!profile)
            return;

        switch(label) {
            case "enemy_heavy":
                templates = ["kill_enemies"];
                break;

            case "civilian_delivery":
                templates = ["civilian_home"];
                break;

            case "rescue_hostages":
                templates = ["rescue_hostages"];
                break;

            case "destroy_buildings":
                templates = ["destroy_base", "destroy_buildings"];
                break;

            case "objective_unknown":
            default:
                templates = ["destroy_base", "destroy_buildings"];
                break;
        }

        // Beach missions deliberately avoid *compounds*, but their authored
        // standalone objective doors still represent real buildings.  Do not
        // turn those missions into enemy-only maps here: GrammarEnemyBuildings
        // uses the standalone door plan to request the corresponding live
        // barracks/bunkers without enabling clustered compound layouts.
        var liveLabel = label || "destroy_buildings";
        var liveTemplates = templates;
        var beachBuildingTarget = Number(profile.GrammarBeachBuildingTarget);

        if(profile.TargetPackProfile === "grammar_beach" &&
            liveLabel === "destroy_buildings" &&
            isFinite(beachBuildingTarget)) {
            liveTemplates = beachBuildingTarget <= 1 ?
                ["destroy_base"] :
                ["destroy_base", "destroy_buildings"];
        }

        profile.ObjectiveTemplates = liveTemplates;
        profile.GrammarObjectiveTemplates = templates.slice(0);
        profile.GrammarObjectiveLabel = label || "destroy_buildings";
        profile.GrammarLiveObjectiveLabel = liveLabel;

        // Keep cover between encounters on compact jungle maps. Unit
        // footprints and the separate spawn/building clearances still apply.
        if(profile.TargetPackProfile === "grammar_jungle" &&
            pContext.Width * pContext.Height <= 3072)
            profile.EncounterClearingRadius = Math.min(profile.EncounterClearingRadius, 2);

        this.ApplyIceLayoutToRuntimeProfile(pContext);
        this.ApplyMapScaleStructureProgression(pContext);
    },

    ApplyBeachCompositionToRuntimeProfile: function(pContext) {
        var profile = pContext ? pContext.Profile || null : null;
        if(!profile || profile.TargetPackProfile !== "grammar_beach")
            return;

        var variant = this.GrammarBeachCompositionVariant ?
            this.GrammarBeachCompositionVariant(pContext) : 0;
        var styles = [
            {
                name: "open_landing",
                objective: "enemy_heavy",
                layout: "localised_zone",
                route: "open_route",
                tree: 0.09,
                minTree: 0.04,
                maxTree: 0.17,
                sector: [0.00, 0.025],
                quicksand: 0,
                buildings: 1,
                forestSeed: 0.0040,
                patchAlpha: 1.72,
                patchMin: 6,
                patchMax: 34,
                perimeter: 0.03,
                perimeterRun: 22,
                deadEnds: false,
                spurRate: 0,
                loop: 0.04,
                pathWidth: 3
            },
            {
                name: "sparse_outpost",
                objective: "destroy_buildings",
                layout: "corner_to_corner",
                route: "outpost",
                tree: 0.14,
                minTree: 0.08,
                maxTree: 0.23,
                sector: [0.02, 0.06],
                quicksand: 1,
                buildings: 1,
                forestSeed: 0.0050,
                patchAlpha: 1.52,
                patchMin: 8,
                patchMax: 54,
                perimeter: 0.08,
                perimeterRun: 18,
                deadEnds: false,
                spurRate: 0,
                loop: 0.06,
                pathWidth: 2
            },
            {
                name: "quicksand_basin",
                objective: "enemy_heavy",
                layout: "peninsula",
                route: "broken_trail",
                tree: 0.12,
                minTree: 0.06,
                maxTree: 0.21,
                sector: [0.01, 0.05],
                quicksand: 5,
                buildings: 1,
                forestSeed: 0.0048,
                patchAlpha: 1.66,
                patchMin: 7,
                patchMax: 42,
                perimeter: 0.04,
                perimeterRun: 20,
                deadEnds: true,
                spurRate: 0.7,
                loop: 0.03,
                pathWidth: 2
            },
            {
                name: "split_groves",
                objective: "rescue_hostages",
                layout: "hub_and_spoke",
                route: "winding_route",
                tree: 0.25,
                minTree: 0.15,
                maxTree: 0.34,
                sector: [0.10, 0.18],
                quicksand: 2,
                buildings: 1,
                forestSeed: 0.0064,
                patchAlpha: 1.40,
                patchMin: 16,
                patchMax: 92,
                perimeter: 0.18,
                perimeterRun: 13,
                deadEnds: true,
                spurRate: 1.3,
                loop: 0.16,
                pathWidth: 2
            },
            {
                name: "forest_channel",
                objective: "enemy_heavy",
                layout: "crossroads",
                route: "winding_route",
                tree: 0.34,
                minTree: 0.22,
                maxTree: 0.43,
                sector: [0.20, 0.30],
                quicksand: 0,
                buildings: 1,
                forestSeed: 0.0074,
                patchAlpha: 1.24,
                patchMin: 38,
                patchMax: 176,
                perimeter: 0.34,
                perimeterRun: 9,
                deadEnds: true,
                spurRate: 1.8,
                loop: 0.24,
                pathWidth: 2
            },
            {
                name: "fortified_beach",
                objective: "destroy_buildings",
                layout: "valley",
                route: "compound_route",
                tree: 0.20,
                minTree: 0.12,
                maxTree: 0.30,
                sector: [0.07, 0.13],
                quicksand: 3,
                buildings: 2,
                forestSeed: 0.0058,
                patchAlpha: 1.36,
                patchMin: 20,
                patchMax: 108,
                perimeter: 0.14,
                perimeterRun: 14,
                deadEnds: false,
                spurRate: 0,
                loop: 0.08,
                pathWidth: 3
            },
            {
                name: "open_crossing",
                objective: "enemy_heavy",
                layout: "classic",
                route: "winding_route",
                tree: 0.11,
                minTree: 0.05,
                maxTree: 0.19,
                sector: [0.00, 0.04],
                quicksand: 1,
                buildings: 1,
                forestSeed: 0.0036,
                patchAlpha: 1.84,
                patchMin: 5,
                patchMax: 28,
                perimeter: 0.02,
                perimeterRun: 24,
                deadEnds: false,
                spurRate: 0,
                loop: 0.18,
                pathWidth: 3
            },
            {
                name: "twin_outposts",
                objective: "destroy_buildings",
                layout: "crossroads",
                route: "compound_route",
                tree: 0.17,
                minTree: 0.10,
                maxTree: 0.27,
                sector: [0.04, 0.09],
                quicksand: 0,
                buildings: 2,
                forestSeed: 0.0052,
                patchAlpha: 1.44,
                patchMin: 12,
                patchMax: 72,
                perimeter: 0.10,
                perimeterRun: 16,
                deadEnds: false,
                spurRate: 0,
                loop: 0.12,
                pathWidth: 2
            },
            {
                name: "dense_landing",
                objective: "rescue_hostages",
                layout: "peninsula",
                route: "winding_route",
                tree: 0.30,
                minTree: 0.20,
                maxTree: 0.39,
                sector: [0.16, 0.24],
                quicksand: 1,
                buildings: 1,
                forestSeed: 0.0068,
                patchAlpha: 1.30,
                patchMin: 28,
                patchMax: 138,
                perimeter: 0.28,
                perimeterRun: 10,
                deadEnds: true,
                spurRate: 1.5,
                loop: 0.20,
                pathWidth: 2
            },
            {
                name: "marsh_gauntlet",
                objective: "destroy_buildings",
                layout: "valley",
                route: "broken_trail",
                tree: 0.18,
                minTree: 0.10,
                maxTree: 0.28,
                sector: [0.05, 0.11],
                quicksand: 4,
                buildings: 1,
                forestSeed: 0.0056,
                patchAlpha: 1.58,
                patchMin: 10,
                patchMax: 64,
                perimeter: 0.12,
                perimeterRun: 15,
                deadEnds: true,
                spurRate: 1.0,
                loop: 0.02,
                pathWidth: 2
            },
            {
                name: "forest_outpost",
                objective: "destroy_buildings",
                layout: "hub_and_spoke",
                route: "outpost",
                tree: 0.28,
                minTree: 0.18,
                maxTree: 0.38,
                sector: [0.14, 0.22],
                quicksand: 0,
                buildings: 1,
                forestSeed: 0.0066,
                patchAlpha: 1.28,
                patchMin: 32,
                patchMax: 154,
                perimeter: 0.26,
                perimeterRun: 11,
                deadEnds: true,
                spurRate: 1.2,
                loop: 0.14,
                pathWidth: 2
            },
            {
                name: "sparse_trails",
                objective: "enemy_heavy",
                layout: "corner_to_corner",
                route: "broken_trail",
                tree: 0.10,
                minTree: 0.04,
                maxTree: 0.18,
                sector: [0.00, 0.03],
                quicksand: 2,
                buildings: 1,
                forestSeed: 0.0038,
                patchAlpha: 1.78,
                patchMin: 5,
                patchMax: 30,
                perimeter: 0.02,
                perimeterRun: 23,
                deadEnds: true,
                spurRate: 1.6,
                loop: 0.01,
                pathWidth: 2
            }
        ];
        var style = styles[variant % styles.length];
        var beachFamily = this.GrammarBeachFamily ?
            this.GrammarBeachFamily(pContext) : "";
        var regionalBeach = profile.RegionalComposition && profile.Name === "grammar_beach";
        if(regionalBeach && profile.RegionalBeachForestCoverage !== undefined) {
            // Mission recipes mostly describe sparse outposts. Forest amount
            // is an independent regional choice, just like its spatial shape.
            style.tree = profile.RegionalBeachForestCoverage;
            style.minTree = style.tree * 0.5;
            style.maxTree = Math.min(0.75, style.tree + 0.12);
        }

        // Authored families retain their source cover floors. Regional routes
        // and encounter cover own tactical pacing: raising every sparse/open
        // composition to the same family density erased those distinctions.
        // Other family features, including quicksand, still apply to both.
        if(beachFamily === "mapm8_corner_cove") {
            if(!regionalBeach) {
                style.tree = Math.max(style.tree, 0.28);
                style.minTree = Math.max(style.minTree, 0.18);
                style.maxTree = Math.max(style.maxTree, 0.40);
            }
            style.quicksand = Math.max(
                style.quicksand,
                2 + (MapGen.Random.HashTile(pContext.Seed, variant, 181, 3607) % 2)
            );
            style.forestSeed = Math.max(style.forestSeed, 0.0062);
            style.patchMin = Math.max(style.patchMin, 24);
            style.patchMax = Math.max(style.patchMax, 120);
            style.perimeter = Math.max(style.perimeter, 0.22);
            style.perimeterRun = Math.min(style.perimeterRun, 12);
            style.deadEnds = true;
            style.spurRate = Math.max(style.spurRate, 1.0);
        }
        else if(beachFamily === "mapm5_top_bank") {
            if(!regionalBeach) {
                style.tree = Math.max(style.tree, 0.22);
                style.minTree = Math.max(style.minTree, 0.14);
                style.maxTree = Math.max(style.maxTree, 0.34);
            }
            style.forestSeed = Math.max(style.forestSeed, 0.0058);
            style.patchMin = Math.max(style.patchMin, 18);
            style.patchMax = Math.max(style.patchMax, 96);
            style.perimeter = Math.max(style.perimeter, 0.16);
            style.perimeterRun = Math.min(style.perimeterRun, 14);
        }
        else if(beachFamily === "mapm6_bridge_channel") {
            style.tree = Math.max(style.tree, 0.16);
            style.minTree = Math.max(style.minTree, 0.09);
            style.maxTree = Math.max(style.maxTree, 0.28);
        }

        profile.GrammarBeachCompositionVariant = variant;
        profile.GrammarBeachComposition = style.name;
        profile.GrammarBeachQuicksandPatchTarget = style.quicksand;
        profile.GrammarBeachBuildingTarget = style.buildings;
        profile.ForcedObjectiveLabel = style.objective;
        profile.LayoutTemplate = style.layout;
        profile.RouteArchetype = style.route;
        profile.TreeCoverage = style.tree;
        profile.MinTreeCoverage = style.minTree;
        profile.MaxTreeCoverage = style.maxTree;
        profile.CarvedForestCoverage = [
            Math.max(0.04, style.tree - 0.04),
            Math.min(style.maxTree, style.tree + 0.04)
        ];
        profile.CarvedForestSectorCoverage = style.sector;
        profile.ForestSeedDensity = style.forestSeed;
        profile.ForestPatchAlpha = style.patchAlpha;
        profile.ForestPatchMinSize = style.patchMin;
        profile.ForestPatchMaxSize = style.patchMax;
        profile.PerimeterCoverChance = style.perimeter;
        profile.MaxWalkablePerimeterRun = style.perimeterRun;
        profile.DeadEndSpurs = style.deadEnds;
        profile.DeadEndSpursPer2048Tiles = style.spurRate;
        profile.LoopChance = style.loop;
        profile.MainPathWidth = style.pathWidth;
        profile.SidePathWidth = 1;
        profile.TacticalCoverDensity = style.tree < 0.15 ? 0.30 :
            (style.tree > 0.30 ? 0.80 : 0.56);
        profile.PostPlacementCoverDensity = style.tree < 0.15 ? 0.34 :
            (style.tree > 0.30 ? 0.86 : 0.60);

        // One-building beach compositions need only ordinary clearance. Two-
        // building compositions are supposed to read as separate landmarks,
        // so give their live footprints and authored clearings a visibly
        // larger gap instead of merely preventing overlap.
        var beachStructureSpacing = style.buildings > 1 ? 20 : 14;
        profile.LiveStructureMinSpacing = Math.max(
            Math.floor(Number(profile.LiveStructureMinSpacing || 0)),
            beachStructureSpacing
        );
        profile.StructureMinSpacing = Math.max(
            Math.floor(Number(profile.StructureMinSpacing || 0)),
            beachStructureSpacing
        );

        MapGen.Context.AddLog(
            pContext,
            "Applied grammar beach composition=" + style.name +
                " family=" + beachFamily +
                " objective=" + style.objective +
                " tree=" + style.tree +
                " quicksandPatches=" + style.quicksand +
                " buildings=" + style.buildings
        );
    },

    PickWeightedKey: function(pRandom, pWeights, pFallback) {
        var entries = [];
        var total = 0;
        var key;

        for(key in (pWeights || {})) {
            if(!pWeights.hasOwnProperty(key))
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

    PickTuningRange: function(pContext, pValue, pInteger, pFallback) {
        if(pValue instanceof Array && pValue.length >= 2) {
            var min = Number(pValue[0]);
            var max = Number(pValue[1]);
            if(isNaN(min) || isNaN(max))
                return pFallback;
            if(max < min) {
                var swap = min;
                min = max;
                max = swap;
            }
            return pInteger ?
                pContext.Random.Int(Math.floor(min), Math.floor(max)) :
                pContext.Random.Float(min, max);
        }

        if(typeof pValue === "number")
            return pInteger ? Math.round(pValue) : pValue;

        return pFallback;
    },

    PickTuningCountPer2048: function(pContext, pValue, pFallback) {
        var rate = this.PickTuningRange(pContext, pValue, false, null);
        if(rate === null || isNaN(rate))
            return pFallback;

        return Math.max(0, Math.round(rate * pContext.Width * pContext.Height / 2048));
    },

    ApplyMapScaleTuningOverrides: function(pContext, pBands, pRuntimeOverrides) {
        if(!(pBands instanceof Array) || !pBands.length)
            return null;

        var area = pContext.Width * pContext.Height;
        var selected = null;
        for(var index = 0; index < pBands.length; ++index) {
            var band = pBands[index] || {};
            var minArea = Math.max(0, Math.floor(Number(band.MinArea || 0)));
            if(area >= minArea && (!selected || minArea >= selected.minArea))
                selected = { minArea: minArea, values: band };
        }
        if(!selected)
            return null;

        var applied = {};
        var runtime = pRuntimeOverrides || {};
        for(var key in selected.values) {
            if(!selected.values.hasOwnProperty(key) || key === "MinArea")
                continue;
            // Explicit runtime overrides remain the final authority.
            if(runtime.hasOwnProperty(key))
                continue;
            pContext.Profile[key] = selected.values[key];
            applied[key] = selected.values[key];
        }

        return {
            minArea: selected.minArea,
            area: area,
            overrides: applied
        };
    },

    StructureProgressionBudget: function(pContext) {
        var profile = pContext ? pContext.Profile || null : null;
        var area = pContext ? pContext.Width * pContext.Height : 0;
        var isBeach;
        var isIce;
        var iceStyle = "";
        var isConstrainedIceRoute = false;

        if(!profile)
            return null;
        isBeach = profile.TargetPackProfile === "grammar_beach";

        // Sub1 beach maps avoid compounds, not map progression. The 76x52
        // shipped mapm5 has four standalone structure goals near different
        // extremities, while the one-building examples are much smaller
        // (19x15 and 50x45). Scale independent landmarks with the canvas and
        // require them to use the available map instead of preserving the
        // selected source map's literal count.
        if(isBeach) {
            if(area >= 10000) {
                return {
                    structureFloor: 6,
                    structureCeiling: 8,
                    compoundFloor: 0,
                    clearingSpacing: 28,
                    liveSpacing: 28,
                    routeSiteSpacing: 16,
                    spreadCap: Math.round(Math.min(pContext.Width, pContext.Height) * 0.58),
                    liveSpanFraction: 0.54
                };
            }
            if(area >= 6000) {
                return {
                    structureFloor: 5,
                    structureCeiling: 7,
                    compoundFloor: 0,
                    clearingSpacing: 22,
                    liveSpacing: 22,
                    routeSiteSpacing: 15,
                    spreadCap: Math.round(Math.min(pContext.Width, pContext.Height) * 0.56),
                    liveSpanFraction: 0.51
                };
            }
            if(area >= 3200) {
                return {
                    structureFloor: 4,
                    structureCeiling: 6,
                    compoundFloor: 0,
                    clearingSpacing: 14,
                    liveSpacing: 14,
                    routeSiteSpacing: 14,
                    spreadCap: Math.round(Math.min(pContext.Width, pContext.Height) * 0.54),
                    liveSpanFraction: 0.40
                };
            }
            if(area >= 1400) {
                return {
                    structureFloor: 2,
                    structureCeiling: 4,
                    compoundFloor: 0,
                    clearingSpacing: 18,
                    liveSpacing: 18,
                    routeSiteSpacing: 12,
                    spreadCap: Math.round(Math.min(pContext.Width, pContext.Height) * 0.46),
                    liveSpanFraction: 0.34
                };
            }

            return {
                structureFloor: 1,
                structureCeiling: 2,
                compoundFloor: 0,
                clearingSpacing: 12,
                liveSpacing: 14,
                routeSiteSpacing: 10,
                spreadCap: Math.round(Math.min(pContext.Width, pContext.Height) * 0.36),
                liveSpanFraction: 0
            };
        }
        if(profile.TargetPackProfile !== "grammar_jungle" &&
            profile.TargetPackProfile !== "grammar_ice")
            return null;
        isIce = profile.TargetPackProfile === "grammar_ice";
        if(isIce) {
            iceStyle = String(profile.ForcedIceLayoutStyle ||
                (pContext.GrammarPlan && pContext.GrammarPlan.intent &&
                    pContext.GrammarPlan.intent.guardrails ?
                    pContext.GrammarPlan.intent.guardrails.iceLayoutStyle : "") || "");
            isConstrainedIceRoute = iceStyle === "ice_neck_route" ||
                iceStyle === "ice_cliff_checkpoint";
        }

        if(area >= 10000) {
            return {
                structureFloor: isConstrainedIceRoute ? 4 : 5,
                structureCeiling: 8,
                compoundFloor: isIce ? (isConstrainedIceRoute ? 4 : 5) : 5,
                clearingSpacing: 18,
                routeSiteSpacing: 14,
                spreadCap: Math.round(Math.min(pContext.Width, pContext.Height) * 0.48),
                liveSpanFraction: isConstrainedIceRoute ? 0.34 : 0.38
            };
        }
        if(area >= 6000) {
            return {
                structureFloor: isConstrainedIceRoute ? 3 : 4,
                structureCeiling: 6,
                compoundFloor: isIce ? (isConstrainedIceRoute ? 3 : 4) : 4,
                clearingSpacing: 16,
                routeSiteSpacing: 13,
                spreadCap: Math.round(Math.min(pContext.Width, pContext.Height) * 0.44),
                liveSpanFraction: isConstrainedIceRoute ? 0.28 : 0.30
            };
        }
        if(area >= 3200) {
            return {
                structureFloor: 3,
                structureCeiling: 5,
                compoundFloor: 3,
                clearingSpacing: 14,
                routeSiteSpacing: 12,
                spreadCap: Math.round(Math.min(pContext.Width, pContext.Height) * 0.40),
                liveSpanFraction: 0
            };
        }

        return {
            structureFloor: 2,
            structureCeiling: 3,
            compoundFloor: 2,
            clearingSpacing: 10,
            routeSiteSpacing: 10,
            spreadCap: Math.round(Math.min(pContext.Width, pContext.Height) * 0.36),
            liveSpanFraction: 0
        };
    },

    ApplyMapScaleStructureProgression: function(pContext) {
        var profile = pContext ? pContext.Profile || null : null;
        var budget = this.StructureProgressionBudget(pContext);

        if(!profile || !budget)
            return;

        // Constrained Concepts may declare a fixed landmark capacity that is
        // already below the generic size progression floor (for example a
        // corner terrace whose cliff consumes a large part of the canvas).
        // Preserve that explicit contract through semantic objective planning
        // instead of scaling it back up and failing live placement later.
        if(profile.LockGrammarStructureTarget === true) {
            var lockedTarget = Math.max(1, Math.floor(Number(
                profile.GrammarStructureTargetMax ||
                profile.StructureMaxClearings || 1)));
            lockedTarget = Math.min(
                lockedTarget,
                Math.max(1, Math.floor(Number(
                    budget.structureFloor || lockedTarget)))
            );
            profile.StructureClusters = Math.min(
                lockedTarget,
                Math.max(1, Math.floor(Number(
                    profile.StructureClusters || lockedTarget)))
            );
            profile.StructureMaxClearings = lockedTarget;
            profile.GrammarStructureTargetMax = lockedTarget;
            return;
        }

        // Select the mission's building count before Objectives plans doors
        // and compounds. Stay within the existing size budget and preserve
        // explicit caller caps; live placement uses this same resolved cap.
        if(profile.StructureCountVariation && profile.GrammarStructureTargetMax === undefined) {
            var countRoll = MapGen.Random.HashTile(pContext.Seed, pContext.Width, pContext.Height, 19117) / 4294967296;
            profile.GrammarStructureTargetMax = budget.structureFloor +
                Math.floor(countRoll * (budget.structureCeiling - budget.structureFloor + 1));
        }

        profile.StructureClusters = Math.min(
            budget.structureCeiling,
            Math.max(
                Math.max(0, Math.floor(Number(profile.StructureClusters || 0))),
                budget.structureFloor
            )
        );
        profile.StructureMaxClearings = Math.min(
            budget.structureCeiling,
            Math.max(
                Math.max(1, Math.floor(Number(profile.StructureMaxClearings || 1))),
                budget.structureFloor
            )
        );
        if(isFinite(Number(profile.GrammarStructureTargetMax))) {
            profile.GrammarStructureTargetMax = Math.min(
                budget.structureCeiling,
                Math.max(
                    Math.floor(Number(profile.GrammarStructureTargetMax)),
                    budget.structureFloor
                )
            );
        }
        if(budget.liveSpacing) {
            if(profile.TargetPackProfile === "grammar_beach") {
                // Beach composition selection runs before this scale contract
                // and its old one/two-landmark spacing must not make a four-
                // landmark canvas geometrically impossible. Broad map use is
                // enforced separately by MinLiveStructureMapSpanFraction.
                profile.LiveStructureMinSpacing = budget.liveSpacing;
                profile.StructureMinSpacing = budget.liveSpacing;
            }
            else {
                profile.LiveStructureMinSpacing = Math.max(
                    Math.max(0, Math.floor(Number(profile.LiveStructureMinSpacing || 0))),
                    budget.liveSpacing
                );
                profile.StructureMinSpacing = Math.max(
                    Math.max(0, Math.floor(Number(profile.StructureMinSpacing || 0))),
                    budget.liveSpacing
                );
            }
        }
        profile.MinRouteStructureSiteDistance = Math.max(
            Math.max(0, Math.floor(Number(profile.MinRouteStructureSiteDistance || 0))),
            budget.routeSiteSpacing
        );

        // Structures should make a journey through the map, not a single
        // late-game compound. Most terrain styles use one broad distribution
        // band; beach landmarks use explicit early-to-late phases below.
        if(budget.structureFloor >= 3) {
            if(profile.TargetPackProfile === "grammar_beach") {
                // RouteSiteFraction samples only the inner slots of one broad
                // band. Give each standalone beach landmark its own phase so
                // the first and last buildings actually reach the early/late
                // map regions demonstrated by mapm5.
                profile.RouteStructurePhaseBands = [];
                for(var beachPhase = 0; beachPhase < budget.structureFloor; ++beachPhase) {
                    var phaseCenter = budget.structureFloor > 1 ?
                        0.12 + (beachPhase * 0.78 / (budget.structureFloor - 1)) :
                        0.50;
                    profile.RouteStructurePhaseBands.push([
                        Math.max(0.08, phaseCenter - 0.04),
                        Math.min(0.94, phaseCenter + 0.04)
                    ]);
                }
            }
            else {
                // One broad band compresses multiple route structures into
                // its inner quartiles.  On winding/XL routes those fractions
                // can even fold back into the same screen.  Give each
                // non-objective structure a distinct early/mid/late phase;
                // the required objective building already occupies the end.
                var routeStructureCount = Math.max(1,
                    budget.structureFloor - 1);
                profile.RouteStructurePhaseBands = [];
                for(var routePhase = 0;
                    routePhase < routeStructureCount; ++routePhase) {
                    var routeCenter = routeStructureCount > 1 ?
                        0.18 + (routePhase * 0.60 /
                            (routeStructureCount - 1)) : 0.48;
                    profile.RouteStructurePhaseBands.push([
                        Math.max(0.10, routeCenter - 0.035),
                        Math.min(0.86, routeCenter + 0.035)
                    ]);
                }
            }
            profile.MinCampaignFlowPhases = 3;
        }

        profile.MapScaleStructureFloor = budget.structureFloor;
        profile.MapScaleCompoundFloor = budget.compoundFloor;
        profile.MinLiveStructureMapSpanFraction = budget.liveSpanFraction;

        if(profile.TargetPackProfile === "grammar_beach") {
            profile.GrammarBeachBuildingTarget = Math.min(
                budget.structureCeiling,
                Math.max(
                    Math.floor(Number(profile.GrammarBeachBuildingTarget || 0)),
                    budget.structureFloor
                )
            );
            profile.GrammarStructureTargetMax = profile.GrammarBeachBuildingTarget;
        }

        if(MapGen.Context && MapGen.Context.AddLog) {
            MapGen.Context.AddLog(
                pContext,
                "Map-scale structure progression floor=" + budget.structureFloor +
                    " ceiling=" + budget.structureCeiling +
                    " compounds=" + budget.compoundFloor +
                    " span=" + budget.liveSpanFraction
            );
        }
    },

    IceLayoutTunings: function() {
        return {
            ice_outpost: {
                // Spine-aware feature clustering + tree-density push
                // (RCA 2026-06-14, plan tranquil-noodling-garden). Default
                // ice_outpost is the highest-weight ice variant and was
                // also the lowest-density route archetype, producing
                // "scattered features on an open snow field" — see
                // Tools/Analysis/FeatureDensity.py probe (gen p50
                // feature_cell_fraction 0.43 vs shipped 0.71). These
                // additions wire the existing pContext.RouteCorridor
                // polyline into Outcrops + Clearings.BuildWilderness +
                // DefensiveLines, and bump tree-coverage targets to
                // close half the gap.
                RouteSpineClustering: true,
                ForceDefensiveLineWhenFlat: true,
                OutcropChance: 0.85,
                MaxOutcropCount: 4,
                OutcropsPer2048Tiles: [1.0, 1.6],
                DefensiveLineChance: 1.0,
                DefensiveLineCount: [1, 2],
                TreeCoverage: 0.24,
                MinTreeCoverage: 0.11,
                MaxTreeCoverage: 0.42,
                MinRenderedTreeTileCoverage: 0.085,
                ForestSeedDensity: 0.0032,
                // Patch shape lifted toward renderable-blob params (2026-06-15
                // Stream A) — same lever proven on compound_raid (10%→46%) and
                // forest_route (32%→35% median). outpost was the second-
                // smallest patch envelope (30/120/1.55) of any non-intentionally
                // -sparse style despite being the highest-weight ice style
                // (1.6) and explicitly wanting visual density per the 2026-06-14
                // RCA. Calibrated to slot strictly between forest_route 52/176/
                // 1.40 and compound_raid 60/220/1.32 so the renderable-blob
                // ordering tree_blob > compound_raid > outpost > forest_route
                // is preserved. Kept under compound_raid because outpost banks
                // visual interest on outcrops + spine clustering + sometimes a
                // compound, with forest as supporting density. See
                // [[ice_forest_render_ratio]].
                ForestPatchAlpha: 1.36,
                ForestPatchMinSize: 56,
                ForestPatchMaxSize: 200,
                CarvedForestFill: true,
                CarvedForestSectorFill: true,
                CarvedForestCoverage: [0.16, 0.24],
                CarvedForestSectorCoverage: [0.02, 0.05],
                OpenAreaBreakup: true,
                OpenAreaBreakupChunkTiles: 60,
                MaxOpenAreaBreakupIslands: 8,
                MaxOpenAreaBreakupScreens: 4,
                OpenAreaBreakupPasses: 1,
                OpenAreaBreakupScreenLength: [10, 18],
                // One-cell ribbons cannot form a complete ice-tree body and
                // are correctly removed by the terminal topology cleanup.
                OpenAreaBreakupScreenThickness: [2, 3],
                PostPlacementOpenAreaBreakup: true,
                PostOpenAreaBreakupChunkTiles: 90,
                PostMaxOpenAreaBreakupIslands: 5,
                PostMaxOpenAreaBreakupScreens: 4,
                PostOpenAreaBreakupPasses: 1,
                RouteExposureBreakup: true,
                RouteExposureBreakupMinRunTiles: 10,
                RouteExposureBreakupRunChunkTiles: 16,
                RouteExposureBreakupScreenLength: [8, 14],
                RouteExposureBreakupScreenThickness: [1, 2],
                MaxRouteExposureBreakupScreens: 12,
                OpenFieldScreens: true,
                OpenFieldScreenLength: [8, 14],
                OpenFieldScreenThickness: [2, 3],
                MaxOpenFieldScreens: 10,
                FinalOpenFieldCover: true,
                FinalOpenFieldCoverLength: [10, 18],
                FinalOpenFieldCoverThickness: [2, 3],
                MaxFinalOpenFieldCoverScreens: 10,
                // Fixed medium-map caps left most of an XL canvas unevaluated.
                // Keep outpost as the open ice style, but give its large snow
                // fields enough substantial screens to create local decisions.
                MapScaleOverrides: [
                    {
                        MinArea: 8192,
                        MaxOpenAreaBreakupScreens: 6,
                        OpenAreaBreakupScreenLength: [14, 24],
                        OpenAreaBreakupScreenThickness: [2, 3],
                        FinalOpenFieldCoverSectorSize: [12, 16],
                        FinalOpenFieldCoverLength: [14, 24],
                        FinalOpenFieldCoverThickness: [2, 3],
                        MaxFinalOpenFieldCoverScreens: 16
                    }
                ],
                PerimeterCoverWidth: [2, 4],
                PerimeterCoverChance: [0.72, 0.92],
                TacticalCoverDensity: 0.50,
                PostPlacementCoverDensity: 0.48,
                RouteEdgeCoverChance: 0.52,
                RouteTacticalCoverSpacing: 12,
                RouteTacticalCoverScreenChance: 0.54,
                RouteEdgeCoverLength: [8, 13],
                RouteEdgeCoverThickness: [1, 2],
                FinalRouteEdgeCover: true,
                FinalRouteEdgeCoverSpacing: 5,
                FinalRouteEdgeCoverChance: 0.90,
                FinalRouteEdgeCoverDistance: 2,
                FinalRouteEdgeCoverLength: [10, 16],
                FinalRouteEdgeCoverThickness: [1, 2],
                FinalRouteEdgeCoverPathCenterClearance: 1,
                FinalRouteEdgeCoverCriticalClearance: 3,
                FinalRouteEdgeCoverPlacementClearance: 2,
                FinalRouteEdgeCoverOppositeSideScale: 0.65,
                MaxFinalRouteEdgeCoverScreens: 28,
                EdgeBiomeChance: 0.34,
                EdgeBiomeKinds: { ridge: 0.82, coast: 0.18 },
                MaxWaterCoverage: 0.18,
                LandFraction: 0.90,
                ContinentStyles: [
                    { name: "mainland", weight: 0.28, landFraction: 1.00 },
                    { name: "rectangle", weight: 0.32, landFraction: 0.92 },
                    { name: "edge", weight: 0.28, landFraction: 0.90 },
                    { name: "island", weight: 0.12, landFraction: 0.86 }
                ],
                LakeChance: 0.20,
                MaxLakeCount: 1,
                RiverChance: 0.04,
                MaxRiverCount: 1,
                PondChance: 0.08,
                MaxPondCount: 1,
                MaxStreamCount: 1,
                PlateauChance: 1.0,
                CliffChance: 1.0,
                PlateauBottomMargin: 14,
                StructureCliffClearance: 3,
                IceStructureSmoothApronRadiusSq: 4,
                IceStructurePlainApronRadiusSq: 1,
                StructureMinSpacing: 10,
                StructureBuildingsPerClearing: 1,
                StructureMaxClearings: 4,
                // The cliff/outcrop footprint leaves room for three reliably
                // separated live buildings on a medium map.  The corpus-wide
                // objective-door target asks for four, which made this style
                // generate a valid layout and then fail live materialization
                // at 3/4 on nearly every seed.  Cap the semantic request to
                // the geometry this layout can actually support.
                GrammarStructureTargetMax: 3,
                // ice_compound carries the siege-shape anchors plus a
                // pre-Skeleton STRUCTURE region claim (see Layout/Templates/
                // IceCompound.js + RegionIntents.js). Replaces the siege slot
                // entirely for ice_outpost — ice_outpost's whole point IS a
                // compound near support, so this is the canonical home for
                // the region-intent slice and gives it enough weight to fire
                // on a useful fraction of seeds. [[mapgen_quality_ceiling]]
                // slice 2.
                LayoutTemplates: { crossroads: 0.40, ice_compound: 0.28, localised_zone: 0.18, classic: 0.14 },
                ClearingCountPer2048Tiles: [3.0, 4.4],
                WildernessClearingsPer2048Tiles: [0.6, 1.2],
                CampaignSpurCount: 2,
                RouteStructurePhaseBands: [[0.52, 0.72]],
                RoutePickupPhaseBands: [[0.24, 0.36], [0.58, 0.76]],
                RouteStructureTemplateWeights: { bunker: 0.45, hut_cluster: 0.25, supply_hut: 0.30 },
                RoutePickupTemplates: ["grenades", "ammo"],
                RouteStructureSideDistance: [8, 14],
                RoutePickupSideDistance: [3, 6],
                MaxRouteSideSiteDistance: 18,
                MinRouteStructureSiteDistance: 12,
                MinRouteStructureAnchorDistance: 12,
                RouteStructureAlternateSides: true,
                RouteStructureCoverTarget: 14,
                RoutePickupCoverTarget: 5,
                RouteScreenCoverFloor: 0.09,
                MinimumChokepoints: 1,
                MaxRouteMedianWidth: 28,
                RouteWidthHardFail: false,
                MinFinalRouteNarrowFractionAtMost3: 0.02,
                MaxFinalRouteMedianWidth: 22,
                MinFinalRouteNarrowRunAtMost3: 2,
                FinalRouteWidthHardFail: false,
                RouteEnemyBaseCount: 10,
                RouteEnemyMinCount: 3,
                RouteEnemyDensityScale: 1.4,
                RouteEnemyFractions: [0.28, 0.45, 0.62, 0.82],
                RouteEnemyPhaseBands: [[0.22, 0.34], [0.42, 0.56], [0.64, 0.78], [0.80, 0.92]],
                EssentialRouteFractions: [0.30, 0.68, 0.86],
                RouteEnemyOffsetTiles: 4,
                SideRouteEnemyScale: 0.8,
                EnemyDensity: 0.32,
                StructureClusters: 2
            },
            ice_edge_patrol: {
                // Spine-aware clustering: same wiring as ice_outpost but
                // DefensiveLineChance is moderate (0.6) because edge-patrol
                // already has a strong perimeter band. CarvedForestFill
                // stays false (intentional stylistic — ice_edge_patrol
                // emphasises the perimeter ring, not interior forests).
                RouteSpineClustering: true,
                ForceDefensiveLineWhenFlat: true,
                OutcropChance: 0.78,
                MaxOutcropCount: 3,
                OutcropsPer2048Tiles: [0.7, 1.2],
                DefensiveLineChance: 0.6,
                DefensiveLineCount: 1,
                TreeCoverage: 0.21,
                MinTreeCoverage: 0.09,
                MaxTreeCoverage: 0.36,
                // This style's four-cell perimeter ring renders as connected
                // multi-row canopy, so visible tree classification is much
                // larger than its 36% authored-mask ceiling. Keep the mask
                // budget unchanged and validate the measured representation.
                MaxRenderedTreeTileCoverage: 0.49,
                MinRenderedTreeTileCoverage: 0.06,
                ForestSeedDensity: 0.0026,
                ForestPatchAlpha: 1.55,
                ForestPatchMinSize: 28,
                ForestPatchMaxSize: 92,
                CarvedForestFill: false,
                CarvedForestSectorFill: false,
                // The perimeter ring is enough to identify this style on a
                // small map, but on large/XL canvases it leaves an enormous
                // empty centre. Use fewer, substantially larger patches and
                // restore the low-frequency carved fill at scale. Routes and
                // encounter clearings remain exclusions, so the result is a
                // handful of connected patrol barriers rather than noise.
                MapScaleOverrides: [
                    {
                        MinArea: 3500,
                        TreeCoverage: 0.23,
                        MinTreeCoverage: 0.10,
                        MaxTreeCoverage: 0.37,
                        ForestSeedDensity: 0.0022,
                        ForestPatchAlpha: 1.40,
                        ForestPatchMinSize: 40,
                        ForestPatchMaxSize: 130,
                        CarvedForestFill: true,
                        CarvedForestSectorFill: true,
                        CarvedForestCoverage: [0.16, 0.21],
                        CarvedForestSectorCoverage: [0.02, 0.04],
                        RouteExposureBreakup: true,
                        RouteExposureBreakupMinCover: 10,
                        RouteExposureBreakupMinRunTiles: 8,
                        RouteExposureBreakupRunChunkTiles: 12,
                        RouteExposureBreakupScreenLength: [7, 11],
                        RouteExposureBreakupScreenThickness: [3, 4],
                        RouteExposureBreakupDistributePaths: true,
                        MaxRouteExposureBreakupScreens: 10,
                        RouteViewportCover: true,
                        RouteViewportCoverRadius: 3,
                        MaxRouteViewportCoverClusters: 4
                    },
                    {
                        MinArea: 6000,
                        TreeCoverage: 0.26,
                        MinTreeCoverage: 0.11,
                        MaxTreeCoverage: 0.39,
                        ForestSeedDensity: 0.0018,
                        ForestPatchAlpha: 1.32,
                        ForestPatchMinSize: 56,
                        ForestPatchMaxSize: 190,
                        CarvedForestFill: true,
                        CarvedForestSectorFill: true,
                        CarvedForestCoverage: [0.18, 0.24],
                        CarvedForestSectorCoverage: [0.025, 0.05],
                        RouteExposureBreakup: true,
                        RouteExposureBreakupMinCover: 10,
                        RouteExposureBreakupMinRunTiles: 9,
                        RouteExposureBreakupRunChunkTiles: 14,
                        RouteExposureBreakupScreenLength: [8, 13],
                        RouteExposureBreakupScreenThickness: [3, 5],
                        RouteExposureBreakupDistributePaths: true,
                        MaxRouteExposureBreakupScreens: 16,
                        RouteViewportCover: true,
                        RouteViewportCoverRadius: 4,
                        MaxRouteViewportCoverClusters: 8
                    },
                    {
                        MinArea: 10000,
                        TreeCoverage: 0.29,
                        MinTreeCoverage: 0.13,
                        MaxTreeCoverage: 0.42,
                        ForestSeedDensity: 0.0016,
                        ForestPatchAlpha: 1.28,
                        ForestPatchMinSize: 84,
                        ForestPatchMaxSize: 280,
                        CarvedForestFill: true,
                        CarvedForestSectorFill: true,
                        CarvedForestCoverage: [0.22, 0.28],
                        CarvedForestSectorCoverage: [0.04, 0.07],
                        RouteExposureBreakup: true,
                        RouteExposureBreakupMinCover: 11,
                        RouteExposureBreakupMinRunTiles: 10,
                        RouteExposureBreakupRunChunkTiles: 16,
                        RouteExposureBreakupScreenLength: [9, 14],
                        RouteExposureBreakupScreenThickness: [3, 5],
                        RouteExposureBreakupDistributePaths: true,
                        MaxRouteExposureBreakupScreens: 22,
                        RouteViewportCover: true,
                        RouteViewportCoverRadius: 4,
                        MaxRouteViewportCoverClusters: 12
                    }
                ],
                OpenAreaBreakup: false,
                PostPlacementOpenAreaBreakup: false,
                RouteExposureBreakup: false,
                OpenFieldScreens: true,
                OpenFieldScreenLength: [7, 12],
                OpenFieldScreenThickness: 2,
                MaxOpenFieldScreens: 8,
                FinalOpenFieldCover: true,
                FinalOpenFieldCoverLength: [7, 12],
                FinalOpenFieldCoverThickness: 2,
                MaxFinalOpenFieldCoverScreens: 8,
                PerimeterCoverWidth: [3, 4],
                PerimeterCoverChance: [0.84, 0.96],
                TacticalCoverDensity: 0.42,
                PostPlacementCoverDensity: 0.40,
                RouteEdgeCoverChance: 0.42,
                RouteTacticalCoverSpacing: 14,
                RouteTacticalCoverScreenChance: 0.42,
                RouteEdgeCoverLength: [7, 12],
                RouteEdgeCoverThickness: [1, 2],
                FinalRouteEdgeCover: true,
                FinalRouteEdgeCoverSpacing: 5,
                FinalRouteEdgeCoverChance: 0.84,
                FinalRouteEdgeCoverDistance: 2,
                FinalRouteEdgeCoverLength: [8, 15],
                FinalRouteEdgeCoverThickness: [1, 2],
                FinalRouteEdgeCoverPathCenterClearance: 1,
                FinalRouteEdgeCoverCriticalClearance: 3,
                FinalRouteEdgeCoverPlacementClearance: 2,
                FinalRouteEdgeCoverOppositeSideScale: 0.65,
                MaxFinalRouteEdgeCoverScreens: 26,
                EdgeBiomeChance: 0.44,
                EdgeBiomeKinds: { ridge: 1.0 },
                MaxWaterCoverage: 0.18,
                LandFraction: 0.92,
                ContinentStyles: [
                    { name: "mainland", weight: 0.20, landFraction: 1.00 },
                    { name: "edge", weight: 0.45, landFraction: 0.92 },
                    { name: "rectangle", weight: 0.28, landFraction: 0.94 },
                    { name: "island", weight: 0.07, landFraction: 0.88 }
                ],
                LakeChance: 0.12,
                MaxLakeCount: 1,
                RiverChance: 0.04,
                MaxRiverCount: 1,
                PondChance: 0.05,
                MaxPondCount: 1,
                MaxStreamCount: 0,
                PlateauChance: 1.0,
                CliffChance: 1.0,
                PlateauBottomMargin: 14,
                StructureCliffClearance: 3,
                IceStructureSmoothApronRadiusSq: 4,
                IceStructurePlainApronRadiusSq: 1,
                StructureMinSpacing: 10,
                StructureBuildingsPerClearing: 1,
                StructureMaxClearings: 4,
                LayoutTemplates: { peninsula: 0.34, valley: 0.30, parallel_lanes: 0.22, corner_to_corner: 0.14 },
                ClearingCountPer2048Tiles: [2.6, 4.0],
                WildernessClearingsPer2048Tiles: [0.4, 0.9],
                CampaignSpurCount: 2,
                RouteStructurePhaseBands: [[0.62, 0.82]],
                RoutePickupPhaseBands: [[0.24, 0.38], [0.56, 0.72]],
                RouteStructureTemplateWeights: { bunker: 0.34, hut_cluster: 0.24, supply_hut: 0.42 },
                RoutePickupTemplates: ["ammo", "grenades"],
                RouteStructureSideDistance: [9, 16],
                RoutePickupSideDistance: [3, 6],
                MaxRouteSideSiteDistance: 20,
                MinRouteStructureSiteDistance: 13,
                MinRouteStructureAnchorDistance: 12,
                RouteStructureAlternateSides: true,
                RouteStructureCoverTarget: 12,
                RoutePickupCoverTarget: 4,
                MaxRouteMedianWidth: 26,
                RouteWidthHardFail: false,
                MinFinalRouteNarrowFractionAtMost3: 0.02,
                MaxFinalRouteMedianWidth: 22,
                MinFinalRouteNarrowRunAtMost3: 2,
                FinalRouteWidthHardFail: false,
                RouteEnemyBaseCount: 9,
                RouteEnemyMinCount: 3,
                RouteEnemyDensityScale: 1.2,
                RouteEnemyFractions: [0.26, 0.48, 0.70, 0.86],
                RouteEnemyPhaseBands: [[0.24, 0.38], [0.48, 0.62], [0.70, 0.88]],
                EssentialRouteFractions: [0.32, 0.70, 0.88],
                RouteEnemyOffsetTiles: 5,
                SideRouteEnemyScale: 1.0,
                EnemyDensity: 0.30,
                StructureClusters: 1
            },
            ice_forest_route: {
                ForestUseAuthoredMask: true,
                TreeCoverage: 0.22,
                MinTreeCoverage: 0.08,
                // Explicit cap retained (2026-06-15): without it the effective
                // over-foresting/thin caps fall back to TreeCoverage*1.35≈0.30
                // and *1.15≈0.25, which would fight the patch-shape lift below
                // by trimming the bigger patches. 0.34 keeps headroom for a
                // high-roll forest_route to render a substantial (but still
                // lane-carved) forest.
                MaxTreeCoverage: 0.34,
                // The final tactical edge-cover pass is intentionally outside
                // the authored forest-mask budget. Dense but still lane-carved
                // forest-route maps render around 40% tree tiles, so validate
                // that final representation directly instead of applying the
                // generic authored-ceiling + 3% fallback.
                MaxRenderedTreeTileCoverage: 0.44,
                // MinRenderedTreeTileCoverage is measured AFTER the ice render
                // prune (the real floor — authored treeBlocked is mostly pruned
                // away). Lifted 0.045 → 0.08 (2026-06-15). forest_route was the
                // worst low-tail style: 7 of the 10 plainest maps, worst seed
                // 7049 rendered 150/1036 = 14% (3.7% of map) as scattered 2-3
                // cell fragments — no readable forest mass. The old 0.045 floor
                // accepted these. 0.08 rejects/regrows low-render seeds while
                // staying below tree_blob's 0.12 (forest_route keeps route lanes
                // carved through, so it should render less solid than tree_blob).
                MinRenderedTreeTileCoverage: 0.08,
                ForestSeedDensity: 0.0024,
                // Patch shape lifted toward tree_blob's renderable-blob params
                // (2026-06-15), same lever proven on ice_compound_raid (render
                // ratio 10%→46%). forest_route had the SMALLEST patches of any
                // style (18/72/1.60) — the ice render pipeline's prune passes
                // discard scattered/thin tree shapes, so tiny high-alpha patches
                // fragment into 2-3 cell stipple that renders away (14% ratio
                // tail). Bigger, rounder patches survive the prune. Kept just
                // under compound_raid (52/176 vs 60/220) and well under tree_blob
                // (80/320) so route lanes still carve cleanly through the forest
                // — this is a TREED route map, not a solid blob. Alpha 1.60→1.40
                // rounds the patches without going full-blob (tree_blob 1.20).
                // See [[ice_forest_render_ratio]], [[mapgen_layer_architecture_gap]].
                ForestPatchAlpha: 1.40,
                ForestPatchMinSize: 52,
                ForestPatchMaxSize: 176,
                CarvedForestFill: true,
                CarvedForestSectorFill: true,
                // Carved range lifted [0.10,0.16] → [0.14,0.20] (2026-06-15).
                // Low-roll ice_forest_route seeds (e.g. 7003, 7009) bottomed
                // out near 3-4% rendered trees — a flat, plain map — because
                // the per-seed RangeFloatValue roll landed near 0.10. Raising
                // the floor to 0.14 lifts those; raising the cap to 0.20 keeps
                // a 0.06-wide range so within-style variety survives. Stays
                // well under MaxTreeCoverage 0.34. See [[ice_tree_coverage_dials]].
                CarvedForestCoverage: [0.14, 0.20],
                CarvedForestSectorCoverage: [0.02, 0.05],
                OpenAreaBreakup: true,
                OpenAreaBreakupChunkTiles: 120,
                MaxOpenAreaBreakupIslands: 5,
                MaxOpenAreaBreakupScreens: 2,
                OpenAreaBreakupPasses: 1,
                PostPlacementOpenAreaBreakup: true,
                PostOpenAreaBreakupChunkTiles: 110,
                PostMaxOpenAreaBreakupIslands: 4,
                PostMaxOpenAreaBreakupScreens: 2,
                PostOpenAreaBreakupPasses: 1,
                RouteExposureBreakup: true,
                MaxRouteExposureBreakupScreens: 6,
                OpenFieldScreens: true,
                OpenFieldScreenLength: [8, 14],
                OpenFieldScreenThickness: 1,
                MaxOpenFieldScreens: 10,
                FinalOpenFieldCover: true,
                FinalOpenFieldCoverLength: [8, 15],
                FinalOpenFieldCoverThickness: 1,
                MaxFinalOpenFieldCoverScreens: 10,
                PerimeterCoverWidth: [2, 3],
                PerimeterCoverChance: [0.58, 0.76],
                TacticalCoverDensity: 0.66,
                PostPlacementCoverDensity: 0.64,
                RouteEdgeCoverChance: 0.58,
                RouteTacticalCoverSpacing: 11,
                RouteTacticalCoverScreenChance: 0.62,
                RouteEdgeCoverLength: [8, 14],
                RouteEdgeCoverThickness: [1, 2],
                FinalRouteEdgeCover: true,
                FinalRouteEdgeCoverSpacing: 4,
                FinalRouteEdgeCoverChance: 1.0,
                FinalRouteEdgeCoverDistance: 2,
                FinalRouteEdgeCoverLength: [9, 15],
                FinalRouteEdgeCoverThickness: [1, 2],
                FinalRouteEdgeCoverPathCenterClearance: 1,
                FinalRouteEdgeCoverCriticalClearance: 3,
                FinalRouteEdgeCoverPlacementClearance: 1,
                FinalRouteEdgeCoverOppositeSideScale: 0.75,
                MaxFinalRouteEdgeCoverScreens: 36,
                EdgeBiomeChance: 0.24,
                EdgeBiomeKinds: { ridge: 0.70, coast: 0.30 },
                MaxWaterCoverage: 0.18,
                LandFraction: 0.90,
                ContinentStyles: [
                    { name: "mainland", weight: 0.30, landFraction: 1.00 },
                    { name: "edge", weight: 0.27, landFraction: 0.90 },
                    { name: "rectangle", weight: 0.25, landFraction: 0.92 },
                    { name: "island", weight: 0.13, landFraction: 0.86 },
                    { name: "archipelago", weight: 0.05, landFraction: 0.80 }
                ],
                LakeChance: 0.24,
                MaxLakeCount: 1,
                RiverChance: 0.08,
                MaxRiverCount: 1,
                PondChance: 0.10,
                MaxPondCount: 1,
                MaxStreamCount: 1,
                PlateauChance: 0.88,
                CliffChance: 1.0,
                PlateauBottomMargin: 14,
                StructureCliffClearance: 3,
                IceStructureSmoothApronRadiusSq: 4,
                IceStructurePlainApronRadiusSq: 1,
                StructureMinSpacing: 10,
                StructureBuildingsPerClearing: 1,
                StructureMaxClearings: 4,
                LayoutTemplates: { linear_gauntlet: 0.46, valley: 0.28, corner_to_corner: 0.16, siege: 0.10 },
                ClearingCountPer2048Tiles: [4.2, 5.8],
                WildernessClearingsPer2048Tiles: [0.9, 1.6],
                CampaignSpurCount: 3,
                RouteStructurePhaseBands: [[0.68, 0.84]],
                RoutePickupPhaseBands: [[0.20, 0.32], [0.46, 0.58], [0.72, 0.84]],
                RouteStructureTemplateWeights: { bunker: 0.25, hut_cluster: 0.35, supply_hut: 0.40 },
                RoutePickupTemplates: ["ammo", "grenades", "rockets"],
                RouteStructureSideDistance: [8, 15],
                RoutePickupSideDistance: [2, 5],
                MaxRouteSideSiteDistance: 20,
                MinRouteStructureSiteDistance: 14,
                MinRouteStructureAnchorDistance: 13,
                RouteStructureAlternateSides: true,
                RouteStructureCoverTarget: 18,
                RoutePickupCoverTarget: 7,
                MinRouteNarrowFractionAtMost3: 0.02,
                MaxRouteMedianWidth: 24,
                MinRouteNarrowRunAtMost3: 2,
                RouteWidthHardFail: false,
                MinFinalRouteNarrowFractionAtMost3: 0.04,
                MaxFinalRouteMedianWidth: 18,
                MinFinalRouteNarrowRunAtMost3: 3,
                FinalRouteWidthHardFail: false,
                RouteEnemyBaseCount: 12,
                RouteEnemyMinCount: 4,
                RouteEnemyDensityScale: 1.5,
                RouteEnemyFractions: [0.22, 0.36, 0.50, 0.66, 0.80, 0.90],
                RouteEnemyPhaseBands: [[0.18, 0.30], [0.34, 0.48], [0.52, 0.66], [0.72, 0.88]],
                EssentialRouteFractions: [0.26, 0.54, 0.78],
                RouteEnemyOffsetTiles: 4,
                SideRouteEnemyScale: 0.6,
                EnemyDensity: 0.34,
                StructureClusters: 1
            },
            ice_tree_maze: {
                IceMazeExactForestFill: true,
                JungleMazeForestFill: true,
                JungleMazeGridSpacing: [8, 10],
                JungleMazeGridMargin: [4, 6],
                JungleMazeCorridorRadius: 0,
                TreeCoverage: 0.72,
                MinTreeCoverage: 0.48,
                MaxTreeCoverage: 0.86,
                MinRenderedTreeTileCoverage: 0.20,
                ForestSeedDensity: 0.0034,
                ForestPatchAlpha: 1.42,
                ForestPatchMinSize: 32,
                ForestPatchMaxSize: 150,
                CarvedForestFill: true,
                CarvedForestSectorFill: true,
                CarvedForestCoverage: [0.64, 0.76],
                CarvedForestSectorCoverage: [0.50, 0.64],
                // Toned-down breakup intensity (was 12 islands × 9 screens
                // × 2 passes pre-placement and same post-placement). The
                // tree-maze style is supposed to be tree-heavy, but the
                // breakup passes were carving so many islands of open
                // ground that actual tree coverage maxed at ~25% even
                // though the dial allowed 36%. Halving islands/screens
                // and dropping to 1 pass each lets bigger forest masses
                // survive while still keeping route corridors playable.
                OpenAreaBreakup: true,
                OpenAreaBreakupChunkTiles: 90,
                MaxOpenAreaBreakupIslands: 6,
                MaxOpenAreaBreakupScreens: 5,
                OpenAreaBreakupPasses: 1,
                PostPlacementOpenAreaBreakup: true,
                PostOpenAreaBreakupChunkTiles: 70,
                PostMaxOpenAreaBreakupIslands: 5,
                PostMaxOpenAreaBreakupScreens: 5,
                PostOpenAreaBreakupPasses: 1,
                RouteExposureBreakup: true,
                RouteExposureBreakupMinRunTiles: 12,
                RouteExposureBreakupRunChunkTiles: 18,
                RouteExposureBreakupScreenLength: [8, 14],
                RouteExposureBreakupScreenThickness: [1, 2],
                MaxRouteExposureBreakupScreens: 12,
                MaxRouteExposureFraction: 0.46,
                MaxRouteExposedRunTiles: 24,
                OpenFieldScreens: true,
                OpenFieldScreenLength: [8, 14],
                OpenFieldScreenThickness: [1, 2],
                MaxOpenFieldScreens: 16,
                FinalOpenFieldCover: true,
                FinalOpenFieldCoverLength: [10, 16],
                FinalOpenFieldCoverThickness: [1, 2],
                MaxFinalOpenFieldCoverScreens: 16,
                PerimeterCoverWidth: [3, 4],
                PerimeterCoverChance: [0.78, 0.94],
                TacticalCoverDensity: 0.86,
                PostPlacementCoverDensity: 0.92,
                RouteEdgeCoverChance: 0.68,
                RouteTacticalCoverSpacing: 9,
                RouteTacticalCoverScreenChance: 0.84,
                RouteEdgeCoverLength: [8, 15],
                RouteEdgeCoverThickness: [1, 2],
                FinalRouteEdgeCover: true,
                FinalRouteEdgeCoverSpacing: 4,
                FinalRouteEdgeCoverChance: 0.90,
                FinalRouteEdgeCoverDistance: 2,
                FinalRouteEdgeCoverLength: [10, 18],
                FinalRouteEdgeCoverThickness: [1, 2],
                FinalRouteEdgeCoverPathCenterClearance: 1,
                FinalRouteEdgeCoverCriticalClearance: 3,
                FinalRouteEdgeCoverPlacementClearance: 1,
                FinalRouteEdgeCoverOppositeSideScale: 0.80,
                MaxFinalRouteEdgeCoverScreens: 40,
                EdgeBiomeChance: 0.18,
                EdgeBiomeKinds: { ridge: 0.70, coast: 0.30 },
                MaxWaterCoverage: 0.08,
                LandFraction: 1.0,
                ContinentStyles: [
                    { name: "mainland", weight: 1.0, landFraction: 1.0 }
                ],
                CoastChance: 0,
                LakeChance: 0,
                MaxLakeCount: 0,
                RiverChance: 0,
                MaxRiverCount: 0,
                StreamChance: 0,
                MaxStreamCount: 0,
                PondChance: 0,
                MaxPondCount: 0,
                PlateauChance: 0.72,
                CliffChance: 0.90,
                PlateauBottomMargin: 14,
                StructureCliffClearance: 3,
                IceStructureSmoothApronRadiusSq: 4,
                IceStructurePlainApronRadiusSq: 1,
                StructureMinSpacing: 12,
                StructureBuildingsPerClearing: 1,
                StructureMaxClearings: 2,
                // The dense maze only authors two structure clearings and the
                // live fallback can reliably add one more without blocking a
                // corridor. Keep the objective target within that capacity.
                GrammarStructureTargetMax: 3,
                LayoutTemplates: { linear_gauntlet: 0.48, valley: 0.26, corner_to_corner: 0.16, hub_and_spoke: 0.10 },
                ClearingCountPer2048Tiles: [5.0, 7.0],
                WildernessClearingsPer2048Tiles: [1.2, 2.0],
                CampaignSpurCount: 4,
                RouteStructurePhaseBands: [[0.72, 0.88]],
                RoutePickupPhaseBands: [[0.18, 0.28], [0.38, 0.50], [0.60, 0.72], [0.78, 0.90]],
                RouteStructureTemplateWeights: { bunker: 0.18, hut_cluster: 0.32, supply_hut: 0.50 },
                RoutePickupTemplates: ["ammo", "grenades", "ammo", "rockets"],
                RouteStructureSideDistance: [7, 13],
                RoutePickupSideDistance: [2, 5],
                MaxRouteSideSiteDistance: 18,
                MinRouteStructureSiteDistance: 15,
                MinRouteStructureAnchorDistance: 14,
                RouteStructureAlternateSides: true,
                RouteStructureCoverTarget: 22,
                RoutePickupCoverTarget: 9,
                MinRouteNarrowFractionAtMost3: 0.03,
                MaxRouteMedianWidth: 18,
                MinRouteNarrowRunAtMost3: 3,
                MinFinalRouteNarrowFractionAtMost3: 0.06,
                MaxFinalRouteMedianWidth: 14,
                MinFinalRouteNarrowRunAtMost3: 4,
                RouteEnemyBaseCount: 15,
                RouteEnemyMinCount: 5,
                RouteEnemyDensityScale: 1.8,
                RouteEnemyFractions: [0.18, 0.28, 0.40, 0.52, 0.64, 0.76, 0.86, 0.94],
                RouteEnemyPhaseBands: [[0.16, 0.26], [0.30, 0.42], [0.46, 0.58], [0.62, 0.74], [0.78, 0.92]],
                EssentialRouteFractions: [0.24, 0.48, 0.72],
                RouteEnemyOffsetTiles: 3,
                SideRouteEnemyScale: 0.45,
                EnemyDensity: 0.38,
                StructureClusters: 1
            },
            ice_neck_route: {
                TreeCoverage: 0.52,
                MinTreeCoverage: 0.32,
                MaxTreeCoverage: 0.72,
                MinRenderedTreeTileCoverage: 0.14,
                ForestSeedDensity: 0.0026,
                ForestPatchAlpha: 1.50,
                ForestPatchMinSize: 26,
                ForestPatchMaxSize: 96,
                CarvedForestFill: true,
                CarvedForestSectorFill: false,
                CarvedForestCoverage: [0.48, 0.60],
                OpenAreaBreakup: true,
                OpenAreaBreakupChunkTiles: 86,
                MaxOpenAreaBreakupIslands: 8,
                MaxOpenAreaBreakupScreens: 6,
                OpenAreaBreakupPasses: 1,
                PostPlacementOpenAreaBreakup: true,
                PostOpenAreaBreakupChunkTiles: 70,
                PostMaxOpenAreaBreakupIslands: 7,
                PostMaxOpenAreaBreakupScreens: 6,
                PostOpenAreaBreakupPasses: 1,
                RouteExposureBreakup: true,
                RouteExposureBreakupMinRunTiles: 8,
                RouteExposureBreakupRunChunkTiles: 14,
                RouteExposureBreakupScreenLength: [7, 12],
                RouteExposureBreakupScreenThickness: [1, 2],
                MaxRouteExposureBreakupScreens: 16,
                MaxRouteExposureFraction: 0.48,
                MaxRouteExposedRunTiles: 24,
                OpenFieldScreens: true,
                OpenFieldScreenLength: [8, 13],
                OpenFieldScreenThickness: 2,
                MaxOpenFieldScreens: 12,
                FinalOpenFieldCover: true,
                FinalOpenFieldCoverLength: [8, 14],
                FinalOpenFieldCoverThickness: 2,
                MaxFinalOpenFieldCoverScreens: 12,
                PerimeterCoverWidth: [3, 4],
                PerimeterCoverChance: [0.80, 0.96],
                TacticalCoverDensity: 0.72,
                PostPlacementCoverDensity: 0.82,
                RouteEdgeCoverChance: 0.58,
                RouteTacticalCoverSpacing: 10,
                RouteTacticalCoverScreenChance: 0.74,
                RouteEdgeCoverLength: [8, 14],
                RouteEdgeCoverThickness: [1, 2],
                FinalRouteEdgeCover: true,
                FinalRouteEdgeCoverSpacing: 4,
                FinalRouteEdgeCoverChance: 0.86,
                FinalRouteEdgeCoverDistance: 2,
                FinalRouteEdgeCoverLength: [9, 16],
                FinalRouteEdgeCoverThickness: [1, 2],
                FinalRouteEdgeCoverPathCenterClearance: 1,
                FinalRouteEdgeCoverCriticalClearance: 3,
                FinalRouteEdgeCoverPlacementClearance: 1,
                FinalRouteEdgeCoverOppositeSideScale: 0.80,
                MaxFinalRouteEdgeCoverScreens: 36,
                EdgeBiomeChance: 0.58,
                EdgeBiomeKinds: { ridge: 1.0 },
                MaxWaterCoverage: 0.14,
                LandFraction: 0.96,
                ContinentStyles: [
                    { name: "mainland", weight: 0.55, landFraction: 1.00 },
                    { name: "edge", weight: 0.25, landFraction: 0.92 },
                    { name: "rectangle", weight: 0.20, landFraction: 0.94 }
                ],
                CoastChance: 0.08,
                LakeChance: 0.04,
                MaxLakeCount: 1,
                RiverChance: 0.04,
                MaxRiverCount: 1,
                PondChance: 0.05,
                MaxPondCount: 1,
                MaxStreamCount: 0,
                PlateauChance: 0,
                CliffChance: 0,
                PlateauBottomMargin: 14,
                StructureCliffClearance: 4,
                IceStructureSmoothApronRadiusSq: 4,
                IceStructurePlainApronRadiusSq: 1,
                StructureMinSpacing: 12,
                StructureBuildingsPerClearing: 1,
                StructureMaxClearings: 3,
                // The narrow route deliberately exposes three separated
                // structure sites. Asking for four made valid neck layouts
                // fail after materialization at 3/4.
                GrammarStructureTargetMax: 3,
                // ice_neck_route routes a critical path through a narrow
                // squeeze; ice_compound at the bottleneck is shipped-style
                // (the squeeze BECOMES the compound). Replaces the siege slot.
                // [[mapgen_region_intent_v1]].
                LayoutTemplates: { valley: 0.36, linear_gauntlet: 0.34, ice_compound: 0.18, peninsula: 0.12 },
                ClearingCountPer2048Tiles: [3.6, 5.2],
                WildernessClearingsPer2048Tiles: [0.6, 1.2],
                CampaignSpurCount: 3,
                RouteStructurePhaseBands: [[0.58, 0.70], [0.78, 0.90]],
                RoutePickupPhaseBands: [[0.24, 0.36], [0.50, 0.62], [0.72, 0.84]],
                RouteStructureTemplateWeights: { bunker: 0.42, hut_cluster: 0.22, supply_hut: 0.36 },
                RoutePickupTemplates: ["grenades", "ammo", "rockets"],
                RouteStructureSideDistance: [6, 12],
                RoutePickupSideDistance: [2, 5],
                MaxRouteSideSiteDistance: 18,
                MinRouteStructureSiteDistance: 14,
                MinRouteStructureAnchorDistance: 13,
                RouteStructureAlternateSides: true,
                RouteStructureCoverTarget: 18,
                RoutePickupCoverTarget: 7,
                MinRouteNarrowFractionAtMost3: 0.04,
                MaxRouteMedianWidth: 16,
                MinRouteNarrowRunAtMost3: 3,
                RouteWidthHardFail: false,
                MinFinalRouteNarrowFractionAtMost3: 0.06,
                MaxFinalRouteMedianWidth: 12,
                MinFinalRouteNarrowRunAtMost3: 4,
                FinalRouteWidthHardFail: false,
                RouteEnemyBaseCount: 14,
                RouteEnemyMinCount: 5,
                RouteEnemyDensityScale: 1.7,
                RouteEnemyFractions: [0.20, 0.34, 0.48, 0.62, 0.76, 0.88],
                RouteEnemyPhaseBands: [[0.18, 0.28], [0.32, 0.44], [0.48, 0.60], [0.64, 0.78], [0.82, 0.92]],
                EssentialRouteFractions: [0.28, 0.56, 0.82],
                RouteEnemyOffsetTiles: 3,
                SideRouteEnemyScale: 0.55,
                EnemyDensity: 0.36,
                StructureClusters: 2
            },
            ice_cliff_checkpoint: {
                TreeCoverage: 0.16,
                MinTreeCoverage: 0.05,
                MaxTreeCoverage: 0.25,
                // Ice canopy art expands a 25% semantic mask to roughly
                // 29-32% classified tree tiles before/after live structure
                // aprons are cut. Keep the authored budget strict, but give
                // this rendered contract its own measured ceiling instead of
                // pretending the two representations have identical area.
                MaxRenderedTreeTileCoverage: 0.32,
                MinRenderedTreeTileCoverage: 0.035,
                ForestSeedDensity: 0.0018,
                ForestPatchAlpha: 1.62,
                ForestPatchMinSize: 18,
                ForestPatchMaxSize: 72,
                CarvedForestFill: true,
                CarvedForestSectorFill: false,
                CarvedForestCoverage: [0.04, 0.10],
                OpenAreaBreakup: true,
                OpenAreaBreakupChunkTiles: 100,
                MaxOpenAreaBreakupIslands: 5,
                MaxOpenAreaBreakupScreens: 4,
                OpenAreaBreakupPasses: 1,
                PostPlacementOpenAreaBreakup: true,
                PostOpenAreaBreakupChunkTiles: 86,
                PostMaxOpenAreaBreakupIslands: 5,
                PostMaxOpenAreaBreakupScreens: 4,
                PostOpenAreaBreakupPasses: 1,
                RouteExposureBreakup: true,
                RouteExposureBreakupMinRunTiles: 8,
                RouteExposureBreakupRunChunkTiles: 14,
                RouteExposureBreakupScreenLength: [7, 12],
                RouteExposureBreakupScreenThickness: [1, 2],
                MaxRouteExposureBreakupScreens: 14,
                MaxRouteExposureFraction: 0.50,
                MaxRouteExposedRunTiles: 24,
                OpenFieldScreens: true,
                OpenFieldScreenLength: [7, 12],
                OpenFieldScreenThickness: 1,
                MaxOpenFieldScreens: 10,
                FinalOpenFieldCover: true,
                FinalOpenFieldCoverLength: [7, 12],
                FinalOpenFieldCoverThickness: 1,
                MaxFinalOpenFieldCoverScreens: 10,
                PerimeterCoverWidth: [2, 4],
                PerimeterCoverChance: [0.74, 0.92],
                TacticalCoverDensity: 0.52,
                PostPlacementCoverDensity: 0.58,
                RouteEdgeCoverChance: 0.48,
                RouteTacticalCoverSpacing: 12,
                RouteTacticalCoverScreenChance: 0.56,
                RouteEdgeCoverLength: [7, 12],
                RouteEdgeCoverThickness: [1, 2],
                FinalRouteEdgeCover: true,
                FinalRouteEdgeCoverSpacing: 5,
                FinalRouteEdgeCoverChance: 0.86,
                FinalRouteEdgeCoverDistance: 2,
                FinalRouteEdgeCoverLength: [8, 14],
                FinalRouteEdgeCoverThickness: [1, 2],
                FinalRouteEdgeCoverPathCenterClearance: 1,
                FinalRouteEdgeCoverCriticalClearance: 3,
                FinalRouteEdgeCoverPlacementClearance: 1,
                FinalRouteEdgeCoverOppositeSideScale: 0.65,
                MaxFinalRouteEdgeCoverScreens: 28,
                EdgeBiomeChance: 0.82,
                EdgeBiomeKinds: { ridge: 1.0 },
                MaxWaterCoverage: 0.16,
                LandFraction: 0.92,
                ContinentStyles: [
                    { name: "mainland", weight: 0.38, landFraction: 1.00 },
                    { name: "edge", weight: 0.32, landFraction: 0.92 },
                    { name: "rectangle", weight: 0.24, landFraction: 0.94 },
                    { name: "island", weight: 0.06, landFraction: 0.88 }
                ],
                LakeChance: 0.06,
                MaxLakeCount: 1,
                RiverChance: 0.02,
                MaxRiverCount: 1,
                PondChance: 0.04,
                MaxPondCount: 1,
                MaxStreamCount: 0,
                PlateauChance: 1.0,
                CliffChance: 1.0,
                PlateauBottomMargin: 16,
                StructureCliffClearance: 5,
                IceStructureSmoothApronRadiusSq: 4,
                IceStructurePlainApronRadiusSq: 1,
                StructureMinSpacing: 15,
                StructureBuildingsPerClearing: 1,
                StructureMaxClearings: 3,
                // A spanning/corner cliff deliberately consumes a large part
                // of the placement field.  Keep the requested building count
                // aligned with the three authored clearings so validation does
                // not discard otherwise-good cliff maps as 3/4 or 3/5.
                GrammarStructureTargetMax: 3,
                // ice_cliff_checkpoint pairs a checkpoint structure with cliff
                // terrain; ice_compound is the natural fit for the checkpoint
                // (a fortified pocket near the cliff). Replaces the siege slot.
                // [[mapgen_region_intent_v1]].
                LayoutTemplates: { linear_gauntlet: 0.34, valley: 0.30, ice_compound: 0.24, peninsula: 0.12 },
                ClearingCountPer2048Tiles: [3.2, 4.8],
                WildernessClearingsPer2048Tiles: [0.4, 0.9],
                CampaignSpurCount: 3,
                RouteStructurePhaseBands: [[0.46, 0.58], [0.70, 0.86]],
                RoutePickupPhaseBands: [[0.22, 0.34], [0.52, 0.64], [0.76, 0.88]],
                RouteStructureTemplateWeights: { bunker: 0.62, hut_cluster: 0.12, supply_hut: 0.26 },
                RoutePickupTemplates: ["grenades", "ammo", "rockets"],
                RouteStructureSideDistance: [6, 12],
                RoutePickupSideDistance: [2, 5],
                MaxRouteSideSiteDistance: 18,
                MinRouteStructureSiteDistance: 15,
                MinRouteStructureAnchorDistance: 14,
                RouteStructureAlternateSides: true,
                RouteStructureCoverTarget: 18,
                RoutePickupCoverTarget: 6,
                MinRouteNarrowFractionAtMost3: 0.03,
                MaxRouteMedianWidth: 16,
                MinRouteNarrowRunAtMost3: 3,
                MinFinalRouteNarrowFractionAtMost3: 0.04,
                MaxFinalRouteMedianWidth: 14,
                MinFinalRouteNarrowRunAtMost3: 3,
                RouteEnemyBaseCount: 13,
                RouteEnemyMinCount: 4,
                RouteEnemyDensityScale: 1.45,
                RouteEnemyFractions: [0.22, 0.36, 0.50, 0.64, 0.78, 0.90],
                RouteEnemyPhaseBands: [[0.20, 0.32], [0.38, 0.52], [0.58, 0.72], [0.78, 0.92]],
                EssentialRouteFractions: [0.28, 0.58, 0.84],
                RouteEnemyOffsetTiles: 3,
                SideRouteEnemyScale: 0.65,
                EnemyDensity: 0.35,
                StructureClusters: 2
            },
            ice_compound_raid: {
                TreeCoverage: 0.25,
                MinTreeCoverage: 0.11,
                MaxTreeCoverage: 0.36,
                // Compound raids surround several separated objectives with
                // cover after the authored mask has been budgeted. The final
                // rendered layer can therefore approach half tree coverage
                // without losing its route or objective clearings.
                MaxRenderedTreeTileCoverage: 0.50,
                // MinRenderedTreeTileCoverage is measured AFTER the ice render
                // prune (it is the real floor — the authored treeBlocked count
                // is mostly pruned away). Keep the floor high enough to reject
                // bare maps (e.g. ~136 or the v3 projection-regression 61-tile
                // case) without rejecting acceptable compound layouts in the
                // high-200s after authored cover is restored.
                MinRenderedTreeTileCoverage: 0.07,
                ForestSeedDensity: 0.0032,
                // Patch shape lifted toward tree_blob's renderable-blob params
                // (2026-06-15). RCA: compound_raid authored MORE trees than
                // tree_blob (treeBlocked 1297 vs 956) but rendered 3× FEWER
                // (136 vs 383) — a 10% render-ratio vs tree_blob's 40% —
                // because its small patches (30-130) fragment into the
                // scattered/thin tree shapes the ice render pipeline prunes,
                // while tree_blob's big round patches (80-320, alpha 1.20)
                // survive. Grow patches bigger and rounder so the forest
                // SURVIVES the render prune; this is the actual lever for the
                // "open and bare" symptom, not forest amount or breakup count.
                // Stay below tree_blob's size (keep compound_raid sparser by
                // identity). See [[mapgen_layer_architecture_gap]].
                ForestPatchAlpha: 1.32,
                ForestPatchMinSize: 60,
                ForestPatchMaxSize: 220,
                CarvedForestFill: true,
                CarvedForestSectorFill: true,
                // Carved range lifted [0.10,0.17] → [0.14,0.20] (2026-06-15).
                // Low-roll ice_compound_raid seeds (e.g. 7012, 7021) bottomed
                // out near 3% rendered trees — below this style's own
                // MinRenderedTreeTileCoverage floor (0.07) — producing a flat
                // map with no cliff (compound_raid banks on cliffs for drama,
                // but cliff firing is binary and often absent). Lifting the
                // carved floor to 0.14 gives a respectable forest even when
                // the cliff doesn't fire. Cap 0.20 stays under MaxTreeCoverage
                // 0.36. See [[ice_tree_coverage_dials]], [[mapgen_cliff_edge_to_edge]].
                CarvedForestCoverage: [0.14, 0.20],
                CarvedForestSectorCoverage: [0.03, 0.06],
                // Reduced breakup intensity (was 6 islands × 5 screens × 1
                // pass each side). The compound_raid style was producing
                // mean 15% trees against a 36% ceiling — the placer had
                // no way to fill the gap while breakup kept clearing islands.
                //
                // 2026-06-15: raising the island cap (4→8) was tried to fill
                // seed 7012's large open void and was a RENDER no-op — it
                // stamped ~600 more tree cells into `blocked` but the ice
                // render pipeline prunes scattered/stipple tree shapes, so
                // rendered trees stayed ~136 (10% of the 1297 authored).
                // compound_raid's plainness is a forest-SHAPE problem (its
                // dispersed cover prunes away; tree_blob's contiguous blobs
                // render at 40%), NOT a breakup-count problem. Kept at 4.
                // See [[mapgen_layer_architecture_gap]], [[ice_tree_coverage_dials]].
                OpenAreaBreakup: true,
                OpenAreaBreakupChunkTiles: 110,
                MaxOpenAreaBreakupIslands: 4,
                MaxOpenAreaBreakupScreens: 4,
                OpenAreaBreakupPasses: 1,
                PostPlacementOpenAreaBreakup: true,
                PostOpenAreaBreakupChunkTiles: 90,
                PostMaxOpenAreaBreakupIslands: 4,
                PostMaxOpenAreaBreakupScreens: 4,
                PostOpenAreaBreakupPasses: 1,
                RouteExposureBreakup: true,
                RouteExposureBreakupMinRunTiles: 10,
                RouteExposureBreakupRunChunkTiles: 16,
                RouteExposureBreakupScreenLength: [8, 14],
                RouteExposureBreakupScreenThickness: [1, 2],
                MaxRouteExposureBreakupScreens: 10,
                OpenFieldScreens: true,
                OpenFieldScreenLength: [7, 12],
                OpenFieldScreenThickness: 1,
                MaxOpenFieldScreens: 10,
                FinalOpenFieldCover: true,
                FinalOpenFieldCoverLength: [7, 12],
                FinalOpenFieldCoverThickness: 1,
                MaxFinalOpenFieldCoverScreens: 10,
                PerimeterCoverWidth: [2, 4],
                PerimeterCoverChance: [0.68, 0.88],
                TacticalCoverDensity: 0.78,
                PostPlacementCoverDensity: 0.84,
                RouteEdgeCoverChance: 0.74,
                RouteTacticalCoverSpacing: 9,
                RouteTacticalCoverScreenChance: 0.78,
                RouteEdgeCoverLength: [9, 15],
                RouteEdgeCoverThickness: [1, 2],
                FinalRouteEdgeCover: true,
                FinalRouteEdgeCoverSpacing: 5,
                FinalRouteEdgeCoverChance: 0.90,
                FinalRouteEdgeCoverDistance: 2,
                FinalRouteEdgeCoverLength: [10, 16],
                FinalRouteEdgeCoverThickness: [1, 2],
                FinalRouteEdgeCoverPathCenterClearance: 1,
                FinalRouteEdgeCoverCriticalClearance: 3,
                FinalRouteEdgeCoverPlacementClearance: 2,
                FinalRouteEdgeCoverOppositeSideScale: 0.70,
                MaxFinalRouteEdgeCoverScreens: 30,
                EdgeBiomeChance: 0.36,
                EdgeBiomeKinds: { ridge: 0.86, coast: 0.14 },
                MaxWaterCoverage: 0.16,
                LandFraction: 0.92,
                ContinentStyles: [
                    { name: "mainland", weight: 0.35, landFraction: 1.00 },
                    { name: "rectangle", weight: 0.30, landFraction: 0.94 },
                    { name: "edge", weight: 0.25, landFraction: 0.92 },
                    { name: "island", weight: 0.08, landFraction: 0.88 },
                    { name: "archipelago", weight: 0.02, landFraction: 0.82 }
                ],
                LakeChance: 0.14,
                MaxLakeCount: 1,
                RiverChance: 0.04,
                MaxRiverCount: 1,
                PondChance: 0.08,
                MaxPondCount: 1,
                MaxStreamCount: 0,
                PlateauChance: 0.95,
                CliffChance: 1.0,
                PlateauBottomMargin: 14,
                StructureCliffClearance: 4,
                IceStructureSmoothApronRadiusSq: 4,
                IceStructurePlainApronRadiusSq: 1,
                StructureMinSpacing: 14,
                StructureBuildingsPerClearing: 1,
                StructureMaxClearings: 3,
                // ice_compound_raid is the canonical "raid an enemy compound"
                // style; ice_compound region-intent claims that footprint
                // before route/water composition. Replaces the siege weight
                // entirely — siege without region-intent is exactly what this
                // style is meant to fix. [[mapgen_quality_ceiling]] slice 2.
                LayoutTemplates: { ice_compound: 0.44, crossroads: 0.30, valley: 0.18, localised_zone: 0.08 },
                ClearingCountPer2048Tiles: [3.0, 4.6],
                WildernessClearingsPer2048Tiles: [0.5, 1.0],
                CampaignSpurCount: 2,
                RouteStructurePhaseBands: [[0.56, 0.70], [0.78, 0.90]],
                RoutePickupPhaseBands: [[0.28, 0.42], [0.60, 0.76]],
                RouteStructureTemplateWeights: { bunker: 0.58, hut_cluster: 0.24, supply_hut: 0.18 },
                RoutePickupTemplates: ["grenades", "rockets"],
                RouteStructureSideDistance: [9, 15],
                RoutePickupSideDistance: [3, 6],
                MaxRouteSideSiteDistance: 20,
                MinRouteStructureSiteDistance: 15,
                MinRouteStructureAnchorDistance: 14,
                RouteStructureAlternateSides: true,
                RouteStructureCoverTarget: 16,
                RoutePickupCoverTarget: 5,
                RouteScreenCoverFloor: 0.10,
                MaxRouteMedianWidth: 28,
                RouteWidthHardFail: false,
                MinFinalRouteNarrowFractionAtMost3: 0.02,
                MaxFinalRouteMedianWidth: 20,
                MinFinalRouteNarrowRunAtMost3: 2,
                FinalRouteWidthHardFail: false,
                RouteEnemyBaseCount: 11,
                RouteEnemyMinCount: 4,
                RouteEnemyDensityScale: 1.3,
                RouteEnemyFractions: [0.30, 0.50, 0.68, 0.84],
                RouteEnemyPhaseBands: [[0.28, 0.42], [0.52, 0.66], [0.74, 0.90]],
                EssentialRouteFractions: [0.34, 0.66, 0.86],
                RouteEnemyOffsetTiles: 4,
                SideRouteEnemyScale: 0.75,
                EnemyDensity: 0.34,
                StructureClusters: 2
            },
            // Tree-blob style — mapm33-class large contiguous forest masses.
            // Modeled on ice_tree_maze but with breakup passes disabled so
            // the placer's own forest masses survive intact, larger forest
            // patches, and a higher tree-coverage ceiling. The route still
            // gets cut through trees (CarvedForestFill on, RouteEdgeCover on),
            // but the open-area / route-exposure breakup passes that shred
            // big forests into corridors are off here.
            ice_tree_blob: {
                TreeCoverage: 0.32,
                MinTreeCoverage: 0.22,
                MaxTreeCoverage: 0.45,
                // Connected canopy edges and late structure-context cover
                // expand the 45% semantic mask by roughly 3-4 points. Give
                // the deliberately dense blob style a measured rendered
                // ceiling rather than relying on the generic +3% allowance.
                MaxRenderedTreeTileCoverage: 0.50,
                MinRenderedTreeTileCoverage: 0.12,
                ForestSeedDensity: 0.0030,
                ForestPatchAlpha: 1.20,
                ForestPatchMinSize: 80,
                ForestPatchMaxSize: 320,
                CarvedForestFill: true,
                CarvedForestSectorFill: true,
                CarvedForestCoverage: [0.28, 0.40],
                CarvedForestSectorCoverage: [0.10, 0.18],
                // Breakup passes are what carve big forests into corridors —
                // disabled here so blob masses survive into the final map.
                OpenAreaBreakup: false,
                PostPlacementOpenAreaBreakup: false,
                RouteExposureBreakup: false,
                OpenFieldScreens: false,
                FinalOpenFieldCover: false,
                PerimeterCoverWidth: [3, 4],
                PerimeterCoverChance: [0.78, 0.94],
                TacticalCoverDensity: 0.62,
                PostPlacementCoverDensity: 0.70,
                RouteEdgeCoverChance: 0.58,
                RouteTacticalCoverSpacing: 11,
                RouteTacticalCoverScreenChance: 0.62,
                RouteEdgeCoverLength: [8, 14],
                RouteEdgeCoverThickness: [1, 2],
                FinalRouteEdgeCover: true,
                FinalRouteEdgeCoverSpacing: 5,
                FinalRouteEdgeCoverChance: 0.84,
                FinalRouteEdgeCoverDistance: 2,
                FinalRouteEdgeCoverLength: [10, 16],
                FinalRouteEdgeCoverThickness: [1, 2],
                FinalRouteEdgeCoverPathCenterClearance: 1,
                FinalRouteEdgeCoverCriticalClearance: 3,
                FinalRouteEdgeCoverPlacementClearance: 2,
                FinalRouteEdgeCoverOppositeSideScale: 0.70,
                MaxFinalRouteEdgeCoverScreens: 22,
                EdgeBiomeChance: 0.20,
                EdgeBiomeKinds: { ridge: 0.78, coast: 0.22 },
                MaxWaterCoverage: 0.16,
                LandFraction: 0.94,
                ContinentStyles: [
                    { name: "mainland", weight: 0.36, landFraction: 1.00 },
                    { name: "rectangle", weight: 0.32, landFraction: 0.95 },
                    { name: "edge", weight: 0.22, landFraction: 0.93 },
                    { name: "island", weight: 0.08, landFraction: 0.89 },
                    { name: "archipelago", weight: 0.02, landFraction: 0.84 }
                ],
                LakeChance: 0.12,
                MaxLakeCount: 1,
                RiverChance: 0.04,
                MaxRiverCount: 1,
                PondChance: 0.06,
                MaxPondCount: 1,
                MaxStreamCount: 0,
                PlateauChance: 0.70,
                CliffChance: 0.85,
                PlateauBottomMargin: 14,
                StructureCliffClearance: 3,
                IceStructureSmoothApronRadiusSq: 4,
                IceStructurePlainApronRadiusSq: 1,
                StructureMinSpacing: 14,
                StructureBuildingsPerClearing: 1,
                StructureMaxClearings: 2,
                LayoutTemplates: { linear_gauntlet: 0.40, valley: 0.32, corner_to_corner: 0.18, hub_and_spoke: 0.10 },
                ClearingCountPer2048Tiles: [3.0, 4.6],
                WildernessClearingsPer2048Tiles: [0.6, 1.2],
                CampaignSpurCount: 2,
                RouteStructurePhaseBands: [[0.62, 0.82]],
                RoutePickupPhaseBands: [[0.22, 0.34], [0.50, 0.64], [0.74, 0.86]],
                RouteStructureTemplateWeights: { bunker: 0.28, hut_cluster: 0.32, supply_hut: 0.40 },
                RoutePickupTemplates: ["ammo", "grenades", "ammo"],
                RouteStructureSideDistance: [8, 14],
                RoutePickupSideDistance: [3, 6],
                MaxRouteSideSiteDistance: 18,
                MinRouteStructureSiteDistance: 14,
                MinRouteStructureAnchorDistance: 14,
                RouteStructureAlternateSides: true,
                RouteStructureCoverTarget: 18,
                RoutePickupCoverTarget: 7,
                RouteScreenCoverFloor: 0.10,
                MaxRouteMedianWidth: 22,
                RouteWidthHardFail: false,
                MinFinalRouteNarrowFractionAtMost3: 0.04,
                MaxFinalRouteMedianWidth: 16,
                MinFinalRouteNarrowRunAtMost3: 3,
                FinalRouteWidthHardFail: false,
                RouteEnemyBaseCount: 12,
                RouteEnemyMinCount: 4,
                RouteEnemyDensityScale: 1.5,
                RouteEnemyFractions: [0.24, 0.40, 0.58, 0.76, 0.90],
                RouteEnemyPhaseBands: [[0.20, 0.32], [0.40, 0.54], [0.60, 0.74], [0.80, 0.92]],
                EssentialRouteFractions: [0.30, 0.62, 0.84],
                RouteEnemyOffsetTiles: 4,
                SideRouteEnemyScale: 0.55,
                EnemyDensity: 0.34,
                StructureClusters: 1
            }
        };
    },

    ApplyIceLayoutToRuntimeProfile: function(pContext) {
        var plan = pContext && pContext.GrammarPlan ? pContext.GrammarPlan : {};
        var intent = plan.intent || {};
        var profile = pContext ? pContext.Profile || null : null;
        var style = intent.iceLayout ? intent.iceLayout.name : "";
        var tunings = this.IceLayoutTunings();
        var tuning;
        var key;
        var needsStructures;
        var runtimeOverrides;
        var layoutTemplates;
        var layoutTemplate;
        var clearingCountPer2048;
        var wildernessClearingsPer2048;

        if(!profile || profile.TargetPackProfile !== "grammar_ice")
            return;

        if(!style && intent.guardrails)
            style = intent.guardrails.iceLayoutStyle || "";
        // ice_cliff_terrace is a geometry variant of the checkpoint and owns
        // no independent cover/encounter tuning. Keep its intent name for
        // Concept dispatch while sharing the proven runtime tuning.
        var tuningStyle = style === "ice_cliff_terrace" ?
            "ice_cliff_checkpoint" : style;
        if(!style || !tunings[tuningStyle]) {
            style = "ice_outpost";
            tuningStyle = style;
        }

        tuning = tunings[tuningStyle];
        for(key in tuning) {
            if(tuning.hasOwnProperty(key) && key !== "MapScaleOverrides")
                profile[key] = tuning[key];
        }

        // A corpus-selected water-heavy intent must remain visibly watery,
        // regardless of which compatible procedural style wins. This keeps
        // lakes/coasts available to forest, neck, outpost, and compound
        // layouts while the edge-patrol + water-mobility combination can use
        // the dedicated river-fork Concept.
        if(intent.archetype === "water_heavy_ice") {
            profile.LakeChance = Math.max(
                1.0,
                Number(profile.LakeChance || 0)
            );
            profile.MaxLakeCount = Math.max(
                1,
                Math.floor(Number(profile.MaxLakeCount || 0))
            );
            profile.LakesPer2048Tiles = [1, 2];
            profile.MaxWaterCoverage = Math.max(
                0.22,
                Number(profile.MaxWaterCoverage || 0)
            );
        }

        // Regional landscapes have their own water budget. The older style
        // caps reduced broad lakes and inlets to the same small snowfield pond.
        // Apply this before explicit runtime overrides so caller limits win.
        if(profile.RegionalComposition && profile.Name === "grammar_ice" &&
            style !== "ice_tree_maze" && style !== "ice_neck_route" &&
            style !== "ice_cliff_checkpoint" && style !== "ice_cliff_terrace")
            profile.MaxWaterCoverage = Math.max(Number(profile.MaxWaterCoverage || 0),
                Number(profile.RegionalIceWaterCoverage || 0) / 0.78 + 0.02);

        runtimeOverrides = profile.IceLayoutRuntimeOverrides || null;
        if(runtimeOverrides) {
            for(key in runtimeOverrides) {
                if(runtimeOverrides.hasOwnProperty(key))
                    profile[key] = runtimeOverrides[key];
            }
        }

        // Corner terraces are allowed to be broader than forest corridors,
        // but never an uninterrupted map-wide snowfield.  This style used to
        // inherit checkpoint width targets with hard failure disabled, so a
        // measured 50-tile median route was accepted as a warning.  Keep the
        // cap deliberately looser than the original-map p90 while the corner
        // cliff consumes placement space, but make it a real acceptance rule.
        if(style === "ice_cliff_terrace") {
            profile.TreeCoverage = Math.max(0.24,
                Number(profile.TreeCoverage || 0));
            profile.MinTreeCoverage = Math.max(0.08,
                Number(profile.MinTreeCoverage || 0));
            profile.MaxTreeCoverage = Math.max(0.34,
                Number(profile.MaxTreeCoverage || 0));
            profile.MaxRenderedTreeTileCoverage = Math.max(0.42,
                Number(profile.MaxRenderedTreeTileCoverage || 0));
            profile.ForestPatchAlpha = 1.32;
            profile.ForestPatchMinSize = 64;
            profile.ForestPatchMaxSize = 200;
            profile.CarvedForestCoverage = [0.14, 0.22];
            profile.CarvedForestSectorCoverage = [0.04, 0.09];
            profile.MinTerraceRenderedTreeCharFraction = 0.14;
            profile.MaxFinalRouteMedianWidth = 28;
            profile.MinFinalRouteNarrowFractionAtMost3 = 0;
            profile.MinFinalRouteNarrowRunAtMost3 = 0;
            profile.FinalRouteWidthHardFail = true;
        }

        pContext.IceMapScaleTuning = this.ApplyMapScaleTuningOverrides(
            pContext,
            tuning.MapScaleOverrides,
            runtimeOverrides
        );

        layoutTemplates = runtimeOverrides && runtimeOverrides.LayoutTemplates ?
            runtimeOverrides.LayoutTemplates :
            tuning.LayoutTemplates;
        layoutTemplate = runtimeOverrides && runtimeOverrides.LayoutTemplate ?
            runtimeOverrides.LayoutTemplate :
            tuning.LayoutTemplate;
        clearingCountPer2048 = runtimeOverrides && runtimeOverrides.ClearingCountPer2048Tiles !== undefined ?
            runtimeOverrides.ClearingCountPer2048Tiles :
            tuning.ClearingCountPer2048Tiles;
        wildernessClearingsPer2048 = runtimeOverrides && runtimeOverrides.WildernessClearingsPer2048Tiles !== undefined ?
            runtimeOverrides.WildernessClearingsPer2048Tiles :
            tuning.WildernessClearingsPer2048Tiles;

        if(layoutTemplates) {
            profile.LayoutTemplate = this.PickWeightedKey(
                pContext.Random,
                layoutTemplates,
                profile.LayoutTemplate || "classic"
            );
        } else if(layoutTemplate) {
            profile.LayoutTemplate = layoutTemplate;
        }

        if(clearingCountPer2048 !== undefined) {
            profile.ClearingCount = this.PickTuningCountPer2048(
                pContext,
                clearingCountPer2048,
                profile.ClearingCount || 0
            );
        }

        if(wildernessClearingsPer2048 !== undefined) {
            profile.WildernessClearingCount = this.PickTuningCountPer2048(
                pContext,
                wildernessClearingsPer2048,
                profile.WildernessClearingCount || 0
            );
        }

        var minRenderedTreeTiles = 0;
        if(tuning.MinRenderedTreeTiles !== undefined) {
            minRenderedTreeTiles = Math.max(0, Math.floor(Number(tuning.MinRenderedTreeTiles) || 0));
        } else {
            var minTreeCoverage = Number(profile.MinTreeCoverage || profile.TreeCoverage || 0);
            if(isNaN(minTreeCoverage))
                minTreeCoverage = 0;
            minRenderedTreeTiles = Math.max(
                12,
                Math.round(minTreeCoverage * pContext.Width * pContext.Height * 0.12)
            );
        }
        if(profile.MinRenderedTreeTileCoverage !== undefined &&
            profile.MinRenderedTreeTileCoverage !== null) {
            var minRenderedTreeCoverage = Number(profile.MinRenderedTreeTileCoverage);
            if(!isNaN(minRenderedTreeCoverage)) {
                minRenderedTreeTiles = Math.max(
                    minRenderedTreeTiles,
                    Math.round(minRenderedTreeCoverage * pContext.Width * pContext.Height)
                );
            }
        }
        profile.MinRenderedTreeTiles = minRenderedTreeTiles;

        // MapScaleOverrides are applied immediately above. Read the resolved
        // profile here rather than re-applying the unscaled tuning value;
        // otherwise a scale band cannot enable a stage disabled by the base
        // style (the old behaviour silently discarded those overrides).
        profile.ForestPatchAndGrow = profile.ForestPatchAndGrow !== false;
        profile.CarvedForestFill = profile.CarvedForestFill !== false;
        profile.CarvedForestSectorFill = profile.CarvedForestSectorFill !== false;
        profile.AllowOuterEdgeCover = true;
        profile.PerimeterCover = true;
        // Forest-seed-only edge clearance (does NOT touch IsOuterCoverBuffer
        // semantics). User feedback 2026-06-15: AllowOuterEdgeCover=0 let
        // forest seeds land at y=0 / x=0 etc, producing thin foliage bands
        // clipped at the map boundary. The first attempt — flipping
        // AllowOuterEdgeCover to false — fixed the trees but also gated the
        // perimeter cover band and several other passes (ApplyTreeMask,
        // ClearOuterCoverBuffer, TacticalCover, IceCharMap) leaving a flat
        // snow-vs-water boundary. This narrower knob is read ONLY by
        // PatchAndGrow when filtering candidate seed cells. See
        // [[mapgen_cliff_stop_topology]] companion-fix update.
        profile.ForestSeedEdgeClearance = 2;
        // Forest-seed water clearance — number of Chebyshev-1 cells from
        // water/riverBank/forcedBank that are off-limits to tree seeds.
        // Slice 0 RCA 2026-06-15: ApplyTreeMask was authoring 84% of trees
        // in cells adjacent to bank/wet/water, which IceCharMap.FixCharMap
        // Rule 1 (RCA 2026-06-12) then demoted because the Wang atlas has
        // no `T|~` or `T|#` tile pair. Setting clearance=1 makes
        // PatchAndGrow respect the same atlas-legality rule the renderer
        // enforces, lifting tree-render yield from ~16% to ~80%+. See
        // [[mapgen_layer_architecture_gap]].
        profile.ForestSeedWaterClearance = 1;
        // Ice has relatively few, large forest patches. The legacy 0.40
        // jitter lets the 0.66-weight large-scale value-noise lobe win every
        // seed ranking, clustering most patch origins in one quadrant even
        // when the Concept authored forest across the map. Let the per-cell
        // hash compete with that lobe so the selected patches sample the
        // full authored FOREST proposal.
        if(profile.ForestSeedJitter === undefined)
            profile.ForestSeedJitter = 0.80;
        profile.TreeCoverOnCoast = false;
        profile.RouteEdgeCover = true;
        profile.FinalRouteEdgeCover = tuning.FinalRouteEdgeCover !== false;
        profile.TacticalCoverShaping = true;
        // ContinueValidationRetriesOnWarnings + ValidationRetryIgnoredWarnings
        // were the warning-hunt mode dropped 2026-06-10 (Layer C). The retry
        // framework now returns the first ok=true attempt regardless of
        // warnings; warnings only count toward the retry-best score, not as
        // a continuation trigger.
        if(profile.MaxQuietScreenFraction === undefined)
            profile.MaxQuietScreenFraction = style === "ice_tree_maze" || style === "ice_tree_blob" || style === "ice_neck_route" ? 0.16 : 0.20;
        if(profile.MaxRouteQuietScreenFraction === undefined)
            profile.MaxRouteQuietScreenFraction = style === "ice_tree_maze" || style === "ice_tree_blob" || style === "ice_neck_route" ? 0.08 : 0.12;
        if(profile.QuietScreenCoverFloor === undefined)
            profile.QuietScreenCoverFloor = style === "ice_outpost" || style === "ice_edge_patrol" ? 0.08 : 0.09;
        if(profile.QuietScreenInterestFloor === undefined)
            profile.QuietScreenInterestFloor = 0.11;
        if(profile.LiveStructureMinSpacing === undefined) {
            profile.LiveStructureMinSpacing =
                style === "ice_compound_raid" ||
                style === "ice_tree_maze" ||
                style === "ice_tree_blob" ||
                style === "ice_neck_route" ||
                style === "ice_cliff_checkpoint" ?
                    22 :
                    20;
        }
        profile.StructureMinSpacing = Math.max(
            Math.floor(Number(profile.StructureMinSpacing || 0)),
            Math.floor(Number(profile.LiveStructureMinSpacing || 0))
        );
        if(profile.StructureWaterClearance === undefined)
            profile.StructureWaterClearance = 3;
        if(profile.StructureContextRadius === undefined)
            profile.StructureContextRadius = 8;
        if(profile.MinStructureContextCoverFraction === undefined)
            profile.MinStructureContextCoverFraction =
                style === "ice_compound_raid" ||
                style === "ice_tree_maze" ||
                style === "ice_tree_blob" ||
                style === "ice_neck_route" ||
                style === "ice_cliff_checkpoint" ?
                    0.22 :
                    0.18;
        profile.OpenAreaBreakup = tuning.OpenAreaBreakup !== false;
        profile.PostPlacementOpenAreaBreakup = tuning.PostPlacementOpenAreaBreakup !== false;
        profile.CliffWaterClearance = 2;
        profile.GrammarIceLayoutStyle = style;

        needsStructures = profile.GrammarLiveObjectiveLabel === "destroy_buildings" ||
            profile.GrammarObjectiveLabel === "destroy_buildings";
        profile.StructureClusters = needsStructures ?
            Math.max(1, Math.floor(tuning.StructureClusters || 1)) :
            Math.min(1, Math.floor(tuning.StructureClusters || 1));

        if(MapGen.Context && MapGen.Context.AddLog) {
            MapGen.Context.AddLog(
                pContext,
                "Applied grammar ice layout style=" + style +
                    " tree=" + profile.TreeCoverage +
                    " waterMax=" + profile.MaxWaterCoverage +
                    " layout=" + profile.LayoutTemplate +
                    " structures=" + profile.StructureClusters
            );
        }
    },

    BuildCampaignPlan: function(pOptions, pContext) {
        var context = pContext || MapGen.Context.Create(pOptions || {});
        context.GrammarPlan = this.CreatePlan(context);
        this.ApplyBeachCompositionToRuntimeProfile(context);
        this.BuildPlan(context);
        this.ApplyIntentToRuntimeProfile(context);

        MapGen.Context.AddLog(
            context,
            "Grammar scaffold selected " + context.GrammarPlan.profileName +
                " using " + context.GrammarPlan.targetPackProfileName
        );

        if(MapGen.BuildGrammarCampaignPlanFromContext) {
            // No scaffold-validation merge here anymore — the live pipeline's
            // MapGen.Validate.Run (inside BuildGrammarCampaignPlanFromContext) is
            // the sole acceptance authority. The old Grammar.Validate.ApplyToContext
            // gate was inert (never failed) and has been removed.
            return MapGen.BuildGrammarCampaignPlanFromContext(context);
        }

        context.Validation = {
            ok: false,
            fatal: true,
            seed: context.Seed,
            profile: context.Profile ? context.Profile.Name : "",
            attempt: context.Attempt || 0,
            reasons: ["grammar_live_materialization_missing"],
            warnings: [],
            metrics: null,
            tactical: null,
            repairActions: [],
            log: context.Log.slice(0),
            debug: null
        };
        return context;
    }
};
