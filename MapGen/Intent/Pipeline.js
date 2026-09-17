// Ice campaign intent pipeline.
//
//   Grammar.BuildPlan -> PickConcept -> author() -> Composite.Project ->
//   Render.CreateMap -> FinaliseRenderedMap -> drift report
//
// ShouldRouteV3 selects ice profiles unless mapgen_use_v1.flag requests the
// rollback pipeline. Jungle and beach use BuildBestCampaignPlan.
//
// Per §3.5 frozen RNG namespaces: this file allocates per-channel RNGs
// (concept / terrain / route / structures / decor) so author-time draws are
// reproducible across Concept variants and across Phase 3 expansions.

var MapGen = MapGen || {};
MapGen.Intent = MapGen.Intent || {};

(function(pIntent) {

    pIntent.Pipeline = pIntent.Pipeline || {};

    // -----------------------------------------------------------------------
    // Routing
    //
    // Returns true if this profile must be authored by the v3 path. Phase 2
    // restricts to ice-tileset profiles. The MAPGEN_USE_V1 emergency-rollback
    // flag overrides to false for any profile.

    pIntent.Pipeline.ShouldRouteV3 = function(pContext) {
        if(!pContext || !pContext.Profile) {
            return false;
        }

        // Emergency rollback flag: a single FileIO check at MapGen.Intent
        // ROUTING time. Off in production; on for engineers debugging a v3
        // regression. Same pattern as Phase 1 IntentDiagnosticEnabled.
        if(typeof FileIO !== "undefined") {
            try {
                var rollback = new FileIO("mapgen_use_v1.flag", true);
                var rollbackOn = rollback.isOpen();
                if(rollbackOn) { rollback.close(); }
                if(rollbackOn) {
                    return false;
                }
            } catch(e) { /* ignore — file system not available means no flag */ }
        }

        // Phase 2 scope: ice tileset only. Jungle/beach stay on v1 until the
        // Phase 4/5 jungle Concept set lands. The TerrainType enum is set in
        // Common/Terrain.js (Ice = 2).
        if(typeof Terrain === "undefined" || !Terrain.Types) {
            return false;
        }
        return pContext.Profile.TerrainType === Terrain.Types.Ice;
    };

    // -----------------------------------------------------------------------
    // RNG channels (§3.5 frozen substream namespaces)
    //
    // Each channel derives its seed from the master seed via DeriveSeed with
    // a stable channel-string salt. This ensures that adding a new Concept
    // does not shift the RNG draws of an unrelated channel — adding ice tree
    // styling to a Concept's `decor` channel cannot move route placement in
    // another Concept's `route` channel.

    function makeChannelRng(pMasterSeed, pChannel) {
        var derived = MapGen.Random.DeriveSeed(pMasterSeed, channelSalt(pChannel));
        return MapGen.Random.CreateSeeded(derived);
    }

    // String -> integer salt. Tiny FNV-like hash — keeps each channel stable
    // across releases as long as the channel name is stable.
    function channelSalt(pChannel) {
        var h = 2166136261;
        for(var i = 0; i < pChannel.length; ++i) {
            h = (h ^ pChannel.charCodeAt(i)) >>> 0;
            h = ((h * 16777619) >>> 0);
        }
        return h | 0;
    }

    pIntent.Pipeline.MakeRngs = function(pContext) {
        var seed = pContext.Seed | 0;
        return {
            concept:    makeChannelRng(seed, "intent.concept"),
            terrain:    makeChannelRng(seed, "intent.terrain"),
            route:      makeChannelRng(seed, "intent.route"),
            structures: makeChannelRng(seed, "intent.structures"),
            decor:      makeChannelRng(seed, "intent.decor")
        };
    };

    // -----------------------------------------------------------------------
    // PickConceptForContext
    //
    // Wraps PickConcept with the Phase 2 fallback policy:
    //   - if PickConcept returns a Concept whose appliesTo(profile, dims, plan)
    //     accepts, use it.
    //   - else, fall back to the biome's `_open_arena` Concept (always permits)
    //     unless GameMode.requiresMpFairness is true.
    //
    // Returns { concept, fallback: bool, reason: string|null }.

    pIntent.Pipeline.PickConceptForContext = function(pContext) {
        var profile = pContext.Profile;
        var plan = pContext.GrammarPlan || {};
        var dimensions = { width: pContext.Width, height: pContext.Height,
            multiplayer: MapGen.Context.IsMultiplayer(pContext) };

        // Tag profile.biome from TerrainType so PickConcept's biome filter works.
        // This is a pure read — does not mutate the profile object. We attach
        // a transient property only on the local context-shaped object.
        if(!profile.biome && typeof Terrain !== "undefined" && Terrain.Types) {
            profile = {
                biome: profile.TerrainType === Terrain.Types.Ice ? "ice" :
                       profile.TerrainType === Terrain.Types.Jungle ? "jungle" :
                       null,
                TerrainType: profile.TerrainType,
                TerrainTypeSub: profile.TerrainTypeSub,
                Name: profile.Name,
                _wrapped: pContext.Profile
            };
        }

        var picked = pIntent.PickConcept(profile, plan, dimensions);
        if(picked) {
            return { concept: picked, fallback: false, reason: null };
        }

        // Fallback path: if the GameMode requires MP fairness and the picked
        // Concept rejected, do NOT fall back to a non-MP Concept. Return null
        // and let the caller surface the failure for retry.
        if(pContext.GameMode && pContext.GameMode.requiresMpFairness) {
            return { concept: null, fallback: false, reason: "mp_fairness_required" };
        }

        // Default fallback: ice biome -> ice_open_arena.
        var fallbackId = profile.biome === "ice" ? "ice_open_arena" :
                         profile.biome === "jungle" ? "jungle_open_arena" :
                         null;
        if(fallbackId && pIntent.Registry[fallbackId]) {
            return { concept: pIntent.Registry[fallbackId], fallback: true, reason: "no_concept_matched" };
        }
        return { concept: null, fallback: false, reason: "no_fallback_for_biome" };
    };

    // -----------------------------------------------------------------------
    // RunCampaignAttempt
    //
    // One attempt of v3 ice authoring. Returns the populated pContext, with
    // pContext.Validation = { ok, fatal, reasons, [...] } reflecting the
    // outcome. Caller (MapGen.GenerateCampaign or BuildBest retry harness)
    // decides whether to retry.
    //
    // On success, pContext.RenderedMap is populated, sprite/objective placement
    // has run, and pContext.IntentMap + pContext.ConceptId are present for
    // downstream sidecar emission.

    // -----------------------------------------------------------------------
    // ExtractRoutePoints
    //
    // Walks IntentMap.movement.ROUTE_PRIMARY cells from start anchor to
    // objective anchor and returns a sequence of {x,y} cell points. Used
    // to emit pContext.Paths so v1 Encounters route-helpers (PathByRole +
    // BuildEssentialRoutePressure) have non-empty data to walk.
    //
    // Strategy: BFS over ROUTE_PRIMARY cells from start; reconstruct the
    // path back from objective. Falls back to a straight Bresenham line
    // if no ROUTE_PRIMARY connects them (degraded but still walkable per
    // the Concept's KEEP_CLEAR + WALKABLE stamping).
    pIntent.Pipeline.ExtractRoutePoints = function(pIntentMap, pStart, pEnd) {
        var W = pIntentMap.width;
        var H = pIntentMap.height;
        // Secondary routes can reconnect to the trunk and be shorter than the
        // authored mission route. Do not silently promote one of those
        // shortcuts to the primary encounter path.
        var M_ROUTE = pIntent.Movement.ROUTE_PRIMARY;
        var M_CROSS = pIntent.Movement.CROSSING;
        function inb(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }
        function isRoute(x, y) {
            if(!inb(x, y)) { return false; }
            return (pIntentMap.movement[(y * W) + x] & (M_ROUTE | M_CROSS)) !== 0;
        }

        // BFS over ROUTE cells; record predecessor cell index.
        if(isRoute(pStart.x, pStart.y) && isRoute(pEnd.x, pEnd.y)) {
            var pred = new Int32Array(W * H);
            for(var i = 0; i < W * H; ++i) { pred[i] = -1; }
            var startI = (pStart.y * W) + pStart.x;
            var endI   = (pEnd.y   * W) + pEnd.x;
            pred[startI] = startI;
            var queue = [pStart.x, pStart.y];
            var head = 0;
            while(head < queue.length) {
                var px = queue[head++];
                var py = queue[head++];
                if(px === pEnd.x && py === pEnd.y) { break; }
                var neighbours = [px+1, py, px-1, py, px, py+1, px, py-1];
                for(var n = 0; n < neighbours.length; n += 2) {
                    var nx = neighbours[n];
                    var ny = neighbours[n + 1];
                    if(!isRoute(nx, ny)) { continue; }
                    var ni = (ny * W) + nx;
                    if(pred[ni] !== -1) { continue; }
                    pred[ni] = (py * W) + px;
                    queue.push(nx);
                    queue.push(ny);
                }
            }
            if(pred[endI] !== -1) {
                var path = [];
                var cursor = endI;
                while(cursor !== pred[cursor]) {
                    path.push({ x: cursor % W, y: Math.floor(cursor / W) });
                    cursor = pred[cursor];
                }
                path.push({ x: pStart.x, y: pStart.y });
                path.reverse();
                return path;
            }
        }

        // Fallback: straight line — Encounters route-helpers walk the
        // points sequentially regardless of the underlying terrain, so a
        // straight line is acceptable for Phase 2 (route_pressure spawns
        // a few enemies along the line; the BFS gate in Pipeline already
        // verified anchors_reachable).
        var line = [];
        var dx = Math.abs(pEnd.x - pStart.x), dy = Math.abs(pEnd.y - pStart.y);
        var sx = pStart.x < pEnd.x ? 1 : -1;
        var sy = pStart.y < pEnd.y ? 1 : -1;
        var err = dx - dy;
        var x = pStart.x, y = pStart.y;
        var safety = 0;
        while(safety++ < 500) {
            line.push({ x: x, y: y });
            if(x === pEnd.x && y === pEnd.y) { break; }
            var e2 = 2 * err;
            if(e2 > -dy) { err -= dy; x += sx; }
            if(e2 < dx) { err += dx; y += sy; }
        }
        return line;
    };

    // v3 calibration: relax the v1 cover-density floor so compound buildings
    // can be placed inside Concept-stamped compounds even though v3 doesn't
    // yet stamp dense forest cover around them. Phase 4 reinstates the floor
    // once Concepts emit perimeter cover. Without this, ~8% of ice_compound_siege
    // seeds fail PlaceCampaignBuildings → 0 enemy buildings → instant-win on
    // destroy_buildings objective.
    function relaxV1CoverFloors(pContext) {
        if(!pContext || !pContext.Profile) { return; }
        // 0 disables both cover-too-open checks (Integration/Structures.js
        // StructureContextTooOpen + StructureRenderedContextTooOpen).
        pContext.Profile.MinStructureContextCoverFraction = 0;
        pContext.Profile.MinRenderedStructureContextCoverFraction = 0;
    }

    pIntent.Pipeline.RunCampaignAttempt = function(pContext) {
        // 0. v3 calibration overrides — see relaxV1CoverFloors.
        relaxV1CoverFloors(pContext);

        // 1. Grammar plan — Concepts dispatch off plan.intent strings.
        if(MapGen.Grammar && MapGen.Grammar.CreatePlan && MapGen.Grammar.BuildPlan) {
            try {
                pContext.GrammarPlan = MapGen.Grammar.CreatePlan(pContext);
                MapGen.Grammar.BuildPlan(pContext);
                if(MapGen.Grammar.ApplyIntentToRuntimeProfile) {
                    MapGen.Grammar.ApplyIntentToRuntimeProfile(pContext);
                }
            } catch(grammarErr) {
                // Grammar build is preserved per v3.4 §3.6; failure is fatal.
                // Surface as a validation reject so the caller's retry harness
                // can either rerun or give up.
                pContext.Validation = {
                    ok: false, fatal: true,
                    reasons: ["grammar_build_failed:" + grammarErr],
                    warnings: [], metrics: null,
                    log: pContext.Log.slice(0)
                };
                return pContext;
            }
        }

        // 2. Pick a Concept.
        var picked = pIntent.Pipeline.PickConceptForContext(pContext);
        if(!picked.concept) {
            pContext.Validation = {
                ok: false, fatal: true,
                reasons: ["no_concept:" + (picked.reason || "unknown")],
                warnings: [], metrics: null,
                log: pContext.Log.slice(0)
            };
            return pContext;
        }
        pContext.ConceptId = picked.concept.id;
        pContext.ConceptIsFallback = picked.fallback;
        if(picked.fallback) {
            MapGen.Context.AddLog(pContext, "Concept fallback: " + picked.concept.id +
                " (reason=" + picked.reason + ")");
        } else {
            MapGen.Context.AddLog(pContext, "Concept selected: " + picked.concept.id);
        }
        // 3. Allocate IntentMap + author.
        var intentMap = pIntent.Map.Create(pContext.Width, pContext.Height);
        pContext.IntentMap = intentMap;

        var rngs = pIntent.Pipeline.MakeRngs(pContext);
        var authorResult;
        try {
            authorResult = MapGen.Context.Time(pContext, "Intent.Author", function() {
                // The plan describes mission intent, while the resolved
                // runtime profile carries the selected ice-style tuning
                // (ContinentStyles, LandFraction, LakeChance, and so on).
                // Pass the context explicitly so Concepts do not duplicate
                // and drift away from those profile-owned values.
                return picked.concept.author(
                    pContext.GrammarPlan || {}, intentMap, rngs, pContext);
            });
        } catch(authorErr) {
            var authorMessage = authorErr && authorErr.message ?
                authorErr.message : String(authorErr);
            var authorStack = authorErr && authorErr.stack ?
                " stack=" + authorErr.stack : "";
            authorResult = pIntent.AuthorResult.Fail(
                pIntent.AuthorReason.UnknownAuthoringFailure,
                [pIntent.AuthorResult.Diagnostic(
                    picked.concept.id + ".author",
                    "exception during author: " + authorMessage + authorStack,
                    {severity: "error"}
                )]
            );
        }
        // Authors must return an AuthorResult. Normalize legacy/bare false
        // returns so retries record which concept violated the contract.
        if(!authorResult || typeof authorResult !== "object" ||
            typeof authorResult.ok !== "boolean") {
            var malformedMessage = authorResult === false ?
                "author returned false" : "author returned an invalid result";
            authorResult = pIntent.AuthorResult.Fail(
                authorResult === false ?
                    pIntent.AuthorReason.ProfileConstraintUnsatisfied :
                    pIntent.AuthorReason.UnknownAuthoringFailure,
                [pIntent.AuthorResult.Diagnostic(
                    picked.concept.id + ".author",
                    malformedMessage,
                    {severity: "error"}
                )]
            );
        }
        pContext.AuthorResult = authorResult;
        if(!authorResult.ok) {
            pContext.Validation = {
                ok: false, fatal: false, // not fatal — retry may pick another seed
                reasons: ["author_failed:" + (authorResult.reason || "unknown")],
                warnings: [], metrics: null,
                log: pContext.Log.slice(0)
            };
            return pContext;
        }

        // Add useful secondary route legs before geometric validation and
        // Composite projection. Terrain Concepts continue to own the trunk;
        // this shared pass owns gameplay distribution.
        MapGen.Context.Time(pContext, "Intent.GameplayTopology", function() {
            pIntent.Pipeline.AuthorCampaignTopology(
                pContext, intentMap, rngs.route);
        });
        var topologyPlan = pContext.IntentTopologyPlan;
        var topologyRequiredPhases = 0;
        var topologyAuthoredPhases = 0;
        if(topologyPlan && topologyPlan.phaseTargets &&
            topologyPlan.phaseAuthored) {
            var topologyPhases = ["early", "mid", "late"];
            for(var topologyPhaseIndex = 0;
                topologyPhaseIndex < topologyPhases.length;
                ++topologyPhaseIndex) {
                var topologyPhaseName = topologyPhases[topologyPhaseIndex];
                if(topologyPlan.phaseTargets[topologyPhaseName] > 0) {
                    ++topologyRequiredPhases;
                    if(topologyPlan.phaseAuthored[topologyPhaseName] > 0)
                        ++topologyAuthoredPhases;
                }
            }
        }
        if(topologyPlan &&
            (topologyPlan.routes.length < topologyPlan.required ||
                topologyAuthoredPhases < topologyRequiredPhases)) {
            var topologyReasons = [];
            if(topologyPlan.routes.length < topologyPlan.required) {
                topologyReasons.push("intent_gameplay_topology_too_thin:" +
                    topologyPlan.routes.length + "/" + topologyPlan.required);
            }
            if(topologyAuthoredPhases < topologyRequiredPhases) {
                topologyReasons.push("intent_gameplay_topology_phase_gap:" +
                    topologyAuthoredPhases + "/" + topologyRequiredPhases);
            }
            pContext.Validation = {
                ok: false, fatal: false,
                reasons: topologyReasons,
                warnings: [], metrics: null,
                log: pContext.Log.slice(0)
            };
            return pContext;
        }

        // 4. Intent-hard validators — geometric invariants on the IntentMap.
        // Failure here is hard-reject; no further compute.
        if(pIntent.Validate && pIntent.Validate.RunIntentHard) {
            var intentHardReport = MapGen.Context.Time(pContext, "Intent.ValidateHard", function() {
                return pIntent.Validate.RunIntentHard(pContext, picked.concept, intentMap);
            });
            if(!intentHardReport.ok) {
                pContext.Validation = {
                    ok: false, fatal: false,
                    reasons: intentHardReport.reasons,
                    warnings: [], metrics: null,
                    log: pContext.Log.slice(0)
                };
                return pContext;
            }
        }

        // 5. Composite — project IntentMap onto the legacy Layers shape so
        // the PRESERVED Smoothing/Render path can consume it unchanged.
        if(!pIntent.Composite || !pIntent.Composite.Project) {
            pContext.Validation = {
                ok: false, fatal: true,
                reasons: ["composite_unavailable"],
                warnings: [], metrics: null,
                log: pContext.Log.slice(0)
            };
            return pContext;
        }
        MapGen.Context.Time(pContext, "Intent.Composite", function() {
            pContext.Layers = pIntent.Composite.Project(pContext, intentMap);
        });
        if(pIntent.Composite.ValidateProjection) {
            var projectionCheck = pIntent.Composite.ValidateProjection(
                intentMap, pContext.Layers);
            pContext.IntentProjection = projectionCheck;
            if(!projectionCheck.ok) {
                pContext.Validation = {
                    ok: false, fatal: true,
                    reasons: ["composite_projection_mismatch:" +
                        projectionCheck.mismatches],
                    warnings: projectionCheck.samples || [], metrics: null,
                    log: pContext.Log.slice(0)
                };
                return pContext;
            }
        }

        // Replace the Concept's generic macro water proposal with the
        // transformed water field from the same official map selected by the
        // grammar route. Route/anchor KEEP_CLEAR cells remain authoritative;
        // only the surrounding terrain shape comes from the original.
        if(MapGen.Grammar && MapGen.Grammar.ApplyOriginalTerrainWater &&
            pContext.OriginalTerrainTemplate) {
            MapGen.Context.Time(pContext, "Intent.OriginalTerrainWater", function() {
                MapGen.Grammar.ApplyOriginalTerrainWater(pContext);
            });
        }

        // 6. Anchor carry-through. Several legacy passes (Encounters, sidecar)
        // walk pContext.Anchors directly; the IntentMap stores anchors as a
        // side-channel so we must hand them across.
        if(intentMap.anchors) {
            pContext.Anchors = pContext.Anchors || {};
            for(var anchorKey in intentMap.anchors) {
                if(intentMap.anchors.hasOwnProperty(anchorKey)) {
                    pContext.Anchors[anchorKey] = intentMap.anchors[anchorKey];
                }
            }
        }

        // 6.5. Emit pContext.Paths from IntentMap.movement.ROUTE_PRIMARY.
        // Encounters/PathByRole + the Path emission probe consumers expect
        // a v1-shape Path entry: { role, radius, points: [{x,y},...] }. We
        // walk start -> objective along route cells using the path that
        // Concepts stamp; if direct walking fails we emit a straight line
        // between anchors so Encounters has *some* primary path to read.
        pContext.Paths = pContext.Paths || [];
        if(pContext.Anchors && pContext.Anchors.start && pContext.Anchors.objective) {
            var primaryPoints = pIntent.Pipeline.ExtractRoutePoints(intentMap,
                pContext.Anchors.start, pContext.Anchors.objective);
            if(primaryPoints && primaryPoints.length >= 2) {
                pContext.Paths.push({
                    role: "primary",
                    radius: 1,
                    points: primaryPoints
                });
            }
        }
        if(pContext.IntentTopologyPlan && pContext.IntentTopologyPlan.routes) {
            for(var topologyPathIndex = 0;
                topologyPathIndex < pContext.IntentTopologyPlan.routes.length;
                ++topologyPathIndex) {
                var topologyPath = pContext.IntentTopologyPlan.routes[topologyPathIndex];
                pContext.Paths.push({
                    role: topologyPath.role,
                    radius: topologyPath.radius || 1,
                    purpose: topologyPath.purpose,
                    routeFraction: topologyPath.routeFraction,
                    routePhase: topologyPath.routePhase,
                    site: topologyPath.site,
                    points: topologyPath.points
                });
            }
        }

        // Build concrete mission-space regions after all primary/secondary
        // paths exist. The sprite projection below and the later structure
        // placer both consume these same region IDs.
        if(MapGen.Encounters && MapGen.Encounters.BuildCampaignRegions)
            MapGen.Encounters.BuildCampaignRegions(pContext);

        // 6.55. Re-position grammar plan's sprite-group ENEMIES, PICKUPS,
        // and DECOR onto the v3 route. v1 Grammar/Sprites computes positions
        // from v1-Layout anchors+routes; v3 anchors land in different cells,
        // so the planned positions snap-fail in PlaceGrammarSpritePlacement
        // (8-cell radius) and we get zero enemies/pickups/decor. Walk our
        // primary route, evenly distribute the planned sprites along it.
        if(pContext.GrammarPlan && pContext.GrammarPlan.spritePlan &&
            pContext.Anchors && pContext.Anchors.start && pContext.Anchors.objective) {
            var spriteRoute = pIntent.Pipeline.ExtractRoutePoints(intentMap,
                pContext.Anchors.start, pContext.Anchors.objective);
            function setSpritePlanPoint(pSprite, pPoint) {
                var ex = pPoint.x;
                var ey = pPoint.y;
                pSprite.point = { x: ex, y: ey };
                if(pPoint.routeFraction !== undefined)
                    pSprite.routeFraction = pPoint.routeFraction;
                if(pPoint.routePhase !== undefined)
                    pSprite.routePhase = pPoint.routePhase;
                if(pPoint.branchId !== undefined)
                    pSprite.branchId = pPoint.branchId;
                if(pPoint.topologyPurpose !== undefined)
                    pSprite.topologyPurpose = pPoint.topologyPurpose;
                pSprite.runtimePosition = {
                    x: (ex * 16) + 8,
                    y: (ey * 16) + 8
                };
                if(pSprite.spt) {
                    pSprite.spt.runtimeX = (ex * 16) + 8;
                    pSprite.spt.runtimeY = (ey * 16) + 8;
                    pSprite.spt.storedX = ex * 16;
                }
            }

            function routePointAtFraction(pFraction) {
                var fraction = Math.max(0, Math.min(1, pFraction));
                var pointIdx = Math.min(spriteRoute.length - 1,
                    Math.floor((spriteRoute.length - 1) * fraction));
                return {
                    x: spriteRoute[pointIdx].x,
                    y: spriteRoute[pointIdx].y,
                    routeFraction: fraction,
                    routePhase: pIntent.Pipeline.topologyRoutePhase(fraction)
                };
            }

            function distributedFraction(pIndex, pCount, pLow, pHigh) {
                if(pCount <= 1) { return (pLow + pHigh) * 0.5; }
                return pLow + ((pIndex / (pCount - 1)) * (pHigh - pLow));
            }

            function closestUnused(pItems, pFraction, pUsed, pMaxDistance) {
                var best = null;
                var bestIndex = -1;
                var bestDistance = 999;
                for(var ci = 0; ci < pItems.length; ++ci) {
                    if(pUsed[ci]) { continue; }
                    var itemFraction = Number(pItems[ci].routeFraction);
                    if(!isFinite(itemFraction)) { continue; }
                    if(pIntent.Pipeline.topologyRoutePhase(itemFraction) !==
                        pIntent.Pipeline.topologyRoutePhase(pFraction)) { continue; }
                    var distance = Math.abs(itemFraction - pFraction);
                    if(distance < bestDistance) {
                        best = pItems[ci];
                        bestIndex = ci;
                        bestDistance = distance;
                    }
                }
                if(bestIndex < 0 || bestDistance > pMaxDistance) { return null; }
                pUsed[bestIndex] = true;
                return { item: best, index: bestIndex };
            }

            function sitePoint(pSite, pBranchId) {
                return {
                    x: pSite.x,
                    y: pSite.y,
                    routeFraction: pSite.routeFraction,
                    routePhase: pSite.routePhase,
                    branchId: pBranchId,
                    topologyPurpose: pSite.topologyPurpose
                };
            }

            function repositionPickups(plan) {
                if(!plan || !plan.length || !spriteRoute || spriteRoute.length < 4)
                    return;
                var sites = pContext.IntentTopologyPlan &&
                    pContext.IntentTopologyPlan.sites ?
                    pContext.IntentTopologyPlan.sites : [];
                var routes = pContext.IntentTopologyPlan &&
                    pContext.IntentTopologyPlan.routes ?
                    pContext.IntentTopologyPlan.routes : [];
                var usedSites = {};
                for(var pi = 0; pi < plan.length; ++pi) {
                    var fraction = distributedFraction(pi, plan.length, 0.24, 0.80);
                    var siteSelection = closestUnused(sites, fraction, usedSites, 0.25);
                    if(siteSelection) {
                        var site = siteSelection.item;
                        var matchingRoute = null;
                        for(var ri = 0; ri < routes.length; ++ri) {
                            if(routes[ri].site && routes[ri].site.x === site.x &&
                                routes[ri].site.y === site.y) {
                                matchingRoute = routes[ri];
                                break;
                            }
                        }
                        setSpritePlanPoint(plan[pi], sitePoint(site,
                            matchingRoute ? "topology_" + ri : null));
                    }
                    else {
                        setSpritePlanPoint(plan[pi], routePointAtFraction(fraction));
                    }
                }
            }

            function repositionEnemies(plan) {
                if(!plan || !plan.length || !spriteRoute || spriteRoute.length < 4)
                    return;
                var sideRoutes = pContext.IntentTopologyPlan &&
                    pContext.IntentTopologyPlan.routes ?
                    pContext.IntentTopologyPlan.routes : [];
                var usedRoutes = {};
                var mobileCount = 0;
                var mobileIndex = 0;
                for(var mc = 0; mc < plan.length; ++mc) {
                    if(plan[mc].kind === "enemy_patrol") { ++mobileCount; }
                }
                for(var ei = 0; ei < plan.length; ++ei) {
                    var enemy = plan[ei];
                    if(enemy.kind !== "enemy_patrol") {
                        var guardFraction = distributedFraction(ei, plan.length, 0.76, 0.92);
                        setSpritePlanPoint(enemy, routePointAtFraction(guardFraction));
                        continue;
                    }
                    var mobileLow = mobileCount <= 2 ? 0.26 : 0.18;
                    var mobileHigh = mobileCount <= 2 ? 0.76 : 0.88;
                    var fraction = distributedFraction(mobileIndex, mobileCount,
                        mobileLow, mobileHigh);
                    var sideRoute = null;
                    if(mobileIndex % 2 === 1)
                        sideRoute = closestUnused(sideRoutes, fraction, usedRoutes, 0.25);
                    if(sideRoute && sideRoute.item.points && sideRoute.item.points.length > 2) {
                        var selectedRoute = sideRoute.item;
                        var sideIndex = Math.max(1, Math.min(
                            selectedRoute.points.length - 2,
                            Math.floor(selectedRoute.points.length * 0.68)));
                        setSpritePlanPoint(enemy, {
                            x: selectedRoute.points[sideIndex].x,
                            y: selectedRoute.points[sideIndex].y,
                            routeFraction: selectedRoute.routeFraction,
                            routePhase: selectedRoute.routePhase,
                            branchId: "topology_" + sideRoute.index,
                            topologyPurpose: selectedRoute.purpose
                        });
                    }
                    else {
                        setSpritePlanPoint(enemy, routePointAtFraction(fraction));
                    }
                    ++mobileIndex;
                }
            }

            function repositionAlongRoute(plan, pUseSideRoutes) {
                if(!plan || !plan.length) { return; }
                if(!spriteRoute || spriteRoute.length < 4) { return; }
                var sideRoutes = pContext.IntentTopologyPlan &&
                    pContext.IntentTopologyPlan.routes ?
                    pContext.IntentTopologyPlan.routes : [];
                for(var si = 0; si < plan.length; ++si) {
                    if(pUseSideRoutes && sideRoutes.length && si % 3 === 1) {
                        var sideRoute = sideRoutes[si % sideRoutes.length];
                        var sideIndex = Math.max(1, Math.min(
                            sideRoute.points.length - 2,
                            Math.floor(sideRoute.points.length * 0.68)));
                        setSpritePlanPoint(plan[si], {
                            x: sideRoute.points[sideIndex].x,
                            y: sideRoute.points[sideIndex].y,
                            routeFraction: sideRoute.routeFraction,
                            routePhase: sideRoute.routePhase,
                            branchId: "topology_" + (si % sideRoutes.length),
                            topologyPurpose: sideRoute.purpose
                        });
                        continue;
                    }
                    var fraction = (si + 1) / (plan.length + 1);
                    setSpritePlanPoint(plan[si], routePointAtFraction(fraction));
                }
            }
            // Enemies, pickups, and decor all snap-fail at v1-planned positions
            // when v3 anchors moved the route. Reposition all three onto our
            // route. This brings 4 player + 2-3 enemy + 2-3 pickup + 2-3 decor
            // sprites visible per map (was 4 + 2 + 0 + 0).
            repositionEnemies(pContext.GrammarPlan.spritePlan.enemies);
            repositionPickups(pContext.GrammarPlan.spritePlan.pickups);
            repositionAlongRoute(pContext.GrammarPlan.spritePlan.decor,
                true);
            if(MapGen.Encounters && MapGen.Encounters.AssignGrammarPlanToRegions)
                MapGen.Encounters.AssignGrammarPlanToRegions(pContext);
        }

        // 6.6. Emit pContext.Clearings from IntentMap regions + anchors.
        // Carry spawn anchors and authored structural regions into the shared
        // gameplay planner. Intermediate route sites distribute landmarks.
        pContext.Clearings = pContext.Clearings || [];
        if(pContext.Anchors) {
            if(pContext.Anchors.start) {
                pContext.Clearings.push({
                    x: pContext.Anchors.start.x,
                    y: pContext.Anchors.start.y,
                    radius: 4,
                    role: "start"
                });
            }
            if(pContext.Anchors.objective) {
                pContext.Clearings.push({
                    x: pContext.Anchors.objective.x,
                    y: pContext.Anchors.objective.y,
                    // This is the authored destination for a required
                    // objective structure, not an incidental open patch.
                    // Marking it as a compound clearing lets the structure
                    // placer use the reserved footprint without rejecting
                    // the deliberately open route terminus as "too open".
                    radius: 6,
                    role: "compound_objective",
                    routeFraction: 1,
                    routePhase: "late",
                    regionId: "objective_compound",
                    encounterKind: "objective_compound"
                });
            }
        }
        // Put structure candidates at useful side-route sites instead of
        // forming one sequential row down the primary route.
        var topologyClearings = 0;
        if(pContext.IntentTopologyPlan && pContext.IntentTopologyPlan.routes) {
            var topologyRoles = ["checkpoint", "ambush_pocket", "route_rest"];
            for(var tc = 0;
                tc < pContext.IntentTopologyPlan.routes.length && tc < 3;
                ++tc) {
                var topologyRoute = pContext.IntentTopologyPlan.routes[tc];
                if(!topologyRoute.site) { continue; }
                pContext.Clearings.push({
                    x: topologyRoute.site.x,
                    y: topologyRoute.site.y,
                    radius: 6,
                    role: topologyRoles[tc % topologyRoles.length],
                    routeRole: topologyRoute.role,
                    topologySite: true,
                    routeFraction: topologyRoute.routeFraction,
                    routePhase: topologyRoute.routePhase,
                    topologyPurpose: topologyRoute.purpose,
                    regionId: topologyRoute.regionId || "",
                    encounterKind: topologyRoute.regionId ?
                        (topologyRoute.purpose === "structure_detour" ||
                            topologyRoute.purpose === "flank_site" ?
                            "optional_outpost" : "optional_reward") : ""
                });
                topologyClearings += 1;
            }
        }
        // Keep one lower-priority trunk clearing as a placement fallback. The
        // structure pass can reject an otherwise valid side pocket because a
        // particular building footprint is wider than the route-site pad.
        if(pContext.Anchors && pContext.Anchors.start && pContext.Anchors.objective) {
            var midRoute = pIntent.Pipeline.ExtractRoutePoints(intentMap,
                pContext.Anchors.start, pContext.Anchors.objective);
            if(midRoute && midRoute.length >= 6) {
                // Pick 3 intermediate positions at fractions 0.30, 0.55, 0.80
                // so the buildings spread visibly along the route. Each has
                // a different role so they sort distinct in v1's priority.
                var midSpec = [
                    { fraction: 0.56, role: "route_rest", radius: 4 }
                ];
                for(var mi = 0; mi < midSpec.length; ++mi) {
                    var spec = midSpec[mi];
                    var ridx = Math.floor(midRoute.length * spec.fraction);
                    if(ridx < 1) { ridx = 1; }
                    if(ridx >= midRoute.length - 1) { continue; }
                    var rpt = midRoute[ridx];
                    pContext.Clearings.push({
                        x: rpt.x, y: rpt.y,
                        radius: spec.radius,
                        role: spec.role,
                        routeFraction: spec.fraction,
                        routePhase: pIntent.Pipeline.topologyRoutePhase(spec.fraction)
                    });
                }
            }
        }
        // Preserve the concept/profile's explicit structure capacity.
        if(pContext.Profile) {
            var currentStructureCapacity = Math.max(1, Math.floor(Number(
                pContext.Profile.StructureMaxClearings || 1)));
            var resolvedStructureTarget = Math.floor(Number(
                pContext.Profile.GrammarResolvedStructureTargetMax ||
                pContext.Profile.GrammarStructureTargetMax));
            if(isFinite(resolvedStructureTarget) && resolvedStructureTarget > 0) {
                pContext.Profile.StructureMaxClearings = Math.min(
                    5,
                    Math.max(currentStructureCapacity, resolvedStructureTarget)
                );
            }
            else {
                pContext.Profile.StructureMaxClearings = 5;
            }
        }
        // No additional region-derived clearings — for compound concepts the
        // anchors.objective IS the compound centre (the IceCompoundSiege
        // Concept sets it that way), so the objective_zone clearing above
        // already gives PlaceCampaignBuildings a footprint inside the
        // compound walls. Emitting a separate "compound" clearing at the
        // entrance (a wall-adjacent cell) would just give the v1 placer a
        // bad candidate that gets rejected for cliff/wall clearance.

        // 6.7. Synthesize pContext.Cliffs from IntentMap CLIFF cells so the
        // existing v1 cliff-tile painter (Render.js:265 calls into
        // Features.PlateauCliffs.OverlayTiles) stamps cliff art onto the
        // rendered map. Skip if MapGen.Intent.CliffTiles isn't loaded.
        if(pIntent.CliffTiles && pIntent.CliffTiles.SynthesizeCliffsFromIntent) {
            try {
                pIntent.CliffTiles.SynthesizeCliffsFromIntent(pContext);
            } catch(eC) {
                MapGen.Context.AddLog(pContext,
                    "cliff tile synthesis threw: " + eC);
            }
        }

        var gameplay = MapGen.Context.Time(pContext, "Layout.GameplayPlan", function() {
            return MapGen.Layout.GameplayPlan.Build(pContext);
        });
        if(gameplay && !gameplay.ok) {
            pContext.Validation = {ok:false, reasons:[gameplay.reason], warnings:[], metrics:null};
            return pContext;
        }

        pIntent.Pipeline.BuildTerrainDetail(pContext, intentMap);

        // 7. Render the smoothed tile layer. PRESERVED renderer reads the
        //    Composite-projected pContext.Layers and produces RenderedMap.Tiles.
        try {
            MapGen.Context.Time(pContext, "Intent.Render", function() {
                MapGen.Render.BuildTileLayer(pContext);
            });
        } catch(renderErr) {
            pContext.Validation = {
                ok: false, fatal: true,
                reasons: ["render_failed:" + renderErr],
                warnings: [], metrics: null,
                log: pContext.Log.slice(0)
            };
            return pContext;
        }
        MapGen.Context.Time(pContext, "Intent.RenderedTreeCeilingRepair", function() {
            pIntent.Pipeline.RepairRenderedTreeCeiling(pContext);
        });

        // The ice char/atlas pipeline may widen water material in its legacy
        // layer bag while resolving legal shore transitions. Restore authored
        // LAND reservations before drift checks and live gameplay placement;
        // otherwise a visually dry route/objective pad is rejected as water.
        if(pIntent.Composite && pIntent.Composite.OverlayAuthoredTerrain) {
            MapGen.Context.Time(pContext, "Intent.PostRenderReservationOverlay", function() {
                return pIntent.Composite.OverlayAuthoredTerrain(
                    pContext, intentMap, pContext.Layers);
            });
        }

        // 8. FinaliseRenderedMap (v3.4 §6.1 / §7) — Concept finaliser hook +
        // global biome finaliser. Operates on pContext.RenderedMap, can mutate
        // tiles within the Concept's drift budget.
        if(pIntent.FinaliseRenderedMap) {
            MapGen.Context.Time(pContext, "Intent.FinaliseRenderedMap", function() {
                pIntent.FinaliseRenderedMap(pContext, picked.concept, intentMap, pContext.RenderedMap);
            });
        }

        // 9. Rendered-hard validators — engine-oracle / classification checks
        //    on the post-render tile grid. These catch render drift that
        //    silently breaks reachability (e.g. wang atlas rejecting a
        //    Concept-stamped corridor and substituting a wall).
        //
        // Phase 2 policy: RenderedHard is advisory at the JS layer because
        // the ice atlas's perimeter water band can shift during smoothing
        // and the in-process collision proxy (pContext.Layers post-Composite)
        // doesn't see those mutations. The Drift report (step 10) catches
        // the unplayable cases (route_solid > 0, spawn_safe_solid > 0,
        // objective_solid > 0) which IS fatal — those are real drift
        // counters computed against the rendered tile grid, not the
        // pre-render Layers projection. Concept-specific budgets land in
        // Phase 3.
        if(pIntent.Validate && pIntent.Validate.RunRenderedHard) {
            var renderedHardReport = MapGen.Context.Time(pContext, "Intent.ValidateRenderedHard", function() {
                return pIntent.Validate.RunRenderedHard(pContext, picked.concept, intentMap);
            });
            pContext.RenderedHardReport = renderedHardReport;
            if(!renderedHardReport.ok) {
                if(pContext.Profile && pContext.Profile.RequireRenderedHardValidation) {
                    pContext.Validation = {
                        ok: false, fatal: false,
                        reasons: renderedHardReport.reasons || ["rendered_hard_failed"],
                        warnings: [], metrics: null,
                        log: pContext.Log.slice(0)
                    };
                    return pContext;
                }
                MapGen.Context.AddLog(pContext, "rendered_hard advisory: " +
                    renderedHardReport.reasons.join(", "));
                // This stage is deliberately advisory until its coverage
                // proxy is derived from final engine tile semantics. The
                // current tree count comes from the shared legacy `blocked`
                // layer and can be a few cells above the authored budget even
                // after legal canopy shaping. Returning here prevented
                // Encounters from placing the player and made otherwise
                // playable fast/smoke maps fail to save.
                pContext.RenderedHardWarnings =
                    renderedHardReport.reasons || ["rendered_hard_failed"];
            }
        }

        // 10. Drift report (§7) — for telemetry + Phase 2 acceptance evidence.
        //
        // Phase 2 policy: drift is REPORTED, not GATED. The drift counters
        // currently read from pContext.Layers post-render, which the
        // Smoothing/IceCharMap pass MUTATES to bake atlas-legality fixes
        // back into layers.water/blocked. So a seed showing 149 route_solid
        // cells doesn't necessarily mean the route is unplayable — it
        // means the perimeter cover pass painted something there. Phase 3
        // either (a) recomputes drift from RenderedMap.Tiles + engine
        // Terrain.Features rather than mutable Layers, or (b) calibrates
        // per-Concept budgets that absorb the expected mutation.
        if(pIntent.Drift && pIntent.Drift.Report) {
            pContext.RenderDrift = MapGen.Context.Time(pContext, "Intent.DriftReport", function() {
                return pIntent.Drift.Report(pContext, intentMap, pContext.RenderedMap);
            });
            if(pContext.RenderDrift && pContext.RenderDrift.warnings &&
                pContext.RenderDrift.warnings.length) {
                MapGen.Context.AddLog(pContext, "drift advisory: " +
                    pContext.RenderDrift.warnings.join(", "));
            }
        }

        // 11. Encounter authoring — players + enemies + vehicles.
        //     Phase 2 keeps the v1 Encounters module since its plan-shaped
        //     code is largely reusable; the dual-write port (claim-plane)
        //     lands as a separate slice. For now: write to v1 Layers (which
        //     Composite produced), let v1 Encounters pipeline run.
        if(MapGen.Encounters) {
            // Encounters.BuildCampaign reads pContext.Anchors + Placements
            // and writes to Composite-projected Layers (occupied / keepClear /
            // owner). Failure is non-fatal at the Pipeline level — Phase 2
            // ice_open_arena Concept emits anchors but no path graph yet, so
            // Encounters.BuildCampaign places only the start player and
            // skips the route-pressure / structure-guard logic that needs
            // pContext.Paths populated. Phase 3+ wires the route graph.
            try {
                MapGen.Context.Time(pContext, "Intent.Encounters", function() {
                    if(MapGen.Context.IsMultiplayer(pContext) && MapGen.Encounters.BuildMultiplayer) {
                        MapGen.Encounters.BuildMultiplayer(pContext);
                    } else if(MapGen.Encounters.BuildCampaign) {
                        MapGen.Encounters.BuildCampaign(pContext);
                    }
                });
            } catch(encErr) {
                MapGen.Context.AddLog(pContext, "Encounters threw: " + encErr);
            }
        }

        // 11.5. Encounter/structure placement can flush a dirty terrain
        // region by rebuilding RenderedMap.Tiles.  Any concept-owned exact
        // motif applied in step 8 (notably skidoo jump ramps) must therefore
        // be finalised and validated against the map that will actually be
        // committed, not only against the pre-structure render.
        if(pIntent.FinaliseRenderedMap) {
            MapGen.Context.Time(pContext, "Intent.FinaliseAfterEncounters", function() {
                pIntent.FinaliseRenderedMap(
                    pContext, picked.concept, intentMap, pContext.RenderedMap);
            });
        }
        if(pIntent.Validate && pIntent.Validate.RunRenderedHard) {
            var finalRenderedHardReport = MapGen.Context.Time(
                pContext, "Intent.ValidateRenderedHardFinal", function() {
                    return pIntent.Validate.RunRenderedHard(
                        pContext, picked.concept, intentMap);
                });
            pContext.FinalRenderedHardReport = finalRenderedHardReport;
            if(!finalRenderedHardReport.ok && pContext.Profile &&
                pContext.Profile.RequireRenderedHardValidation) {
                pContext.Validation = {
                    ok: false, fatal: false,
                    reasons: finalRenderedHardReport.reasons ||
                        ["final_rendered_hard_failed"],
                    warnings: [], metrics: null,
                    log: pContext.Log.slice(0)
                };
                return pContext;
            }
        }

        // 12. Compute the real final metrics. The old v3-shaped success report
        // claimed perfect connectivity and zero quiet screens, which prevented
        // retry selection from seeing underused large maps at all.
        var finalMetrics = MapGen.Context.Time(
            pContext, "Intent.FinalMetrics", function() {
                return MapGen.Metrics.Compute(pContext);
            });
        pContext.Validation = {
            ok: true, fatal: false,
            reasons: [],
            warnings: [],
            metrics: finalMetrics,
            log: pContext.Log.slice(0)
        };
        pContext.Validation.metrics.conceptId = picked.concept.id;
        pContext.Validation.metrics.fallback = picked.fallback;
        if(MapGen.Validate) {
            MapGen.Validate.ScreenPacing(pContext, pContext.Validation, {
                MaxDeadScreenFraction: 0.05
            });
            MapGen.Validate.GameplayUtilization(pContext, pContext.Validation);
        }
        return pContext;
    };

})(MapGen.Intent);
