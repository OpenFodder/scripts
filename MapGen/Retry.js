var MapGen = MapGen || {};

MapGen.Retry = {

    Bucket: function(pValue, pBucketSize) {
        if(typeof pValue !== "number" || isNaN(pValue))
            return 0;
        return Math.floor(pValue / Math.max(1, pBucketSize));
    },

    AnchorFingerprint: function(pAnchors, pWidth, pHeight) {
        var maxX = Math.max(1, pWidth - 1);
        var maxY = Math.max(1, pHeight - 1);
        var keys = [];
        var key;

        for(key in pAnchors) {
            if(pAnchors.hasOwnProperty(key))
                keys.push(key);
        }
        keys.sort();

        var parts = [];
        for(var i = 0; i < keys.length; ++i) {
            var anchor = pAnchors[keys[i]];
            if(!anchor || typeof anchor.x !== "number" || typeof anchor.y !== "number")
                continue;
            var col = Math.min(2, Math.floor(3 * anchor.x / maxX));
            var row = Math.min(2, Math.floor(3 * anchor.y / maxY));
            parts.push(keys[i] + ":" + col + "," + row);
        }

        return parts.join("|");
    },

    PathEdgeBucket: function(pPaths) {
        var edges = 0;
        for(var index = 0; index < pPaths.length; ++index) {
            if(pPaths[index] && pPaths[index].points)
                edges += Math.max(0, pPaths[index].points.length - 1);
        }
        return Math.floor(edges / 16);
    },

    WaterFamily: function(pProfile, pCoverage) {
        var hasRiver = (pProfile.RiverChance || 0) > 0 && (pProfile.MaxRiverCount || 0) > 0;
        var hasPond = (pProfile.PondChance || 0) > 0 && (pProfile.MaxPondCount || 0) > 0;
        var hasCoast = (pProfile.CoastChance || 0) > 0;
        var heavy = pCoverage && pCoverage.water > 0.20;
        return (hasCoast ? "C" : "-") + (hasRiver ? "R" : "-") + (hasPond ? "P" : "-") + (heavy ? "+" : "");
    },

    IntentRegionValue: function(pResult, pRegionId, pKey) {
        var regions = pResult && pResult.IntentMap ?
            pResult.IntentMap.regions || [] : [];
        for(var index = 0; index < regions.length; ++index) {
            if(regions[index] && regions[index].id === pRegionId)
                return regions[index][pKey] || "";
        }
        return "";
    },

    MacroTerrainSignature: function(pResult) {
        var map = pResult ? pResult.IntentMap : null;
        if(!map || !map.terrain || !map.movement || !map.width || !map.height)
            return "";

        var terrainEnum = MapGen.Intent && MapGen.Intent.Terrain ?
            MapGen.Intent.Terrain : {};
        var movementEnum = MapGen.Intent && MapGen.Intent.Movement ?
            MapGen.Intent.Movement : {};
        var forestValue = terrainEnum.FOREST === undefined ? 8 : terrainEnum.FOREST;
        var waterValues = {};
        waterValues[terrainEnum.WATER === undefined ? 1 : terrainEnum.WATER] = true;
        waterValues[terrainEnum.COAST === undefined ? 2 : terrainEnum.COAST] = true;
        waterValues[terrainEnum.BEACH === undefined ? 3 : terrainEnum.BEACH] = true;
        waterValues[terrainEnum.RIVER === undefined ? 4 : terrainEnum.RIVER] = true;
        waterValues[terrainEnum.RIVERBANK === undefined ? 5 : terrainEnum.RIVERBANK] = true;
        var cliffValues = {};
        cliffValues[terrainEnum.CLIFF_BODY === undefined ? 6 : terrainEnum.CLIFF_BODY] = true;
        cliffValues[terrainEnum.CLIFF_TOP === undefined ? 7 : terrainEnum.CLIFF_TOP] = true;
        var routeFlag = movementEnum.ROUTE_PRIMARY === undefined ? 4 :
            movementEnum.ROUTE_PRIMARY;
        var gridWidth = 4;
        var gridHeight = 4;
        var parts = [];

        for(var gridY = 0; gridY < gridHeight; ++gridY) {
            var minY = Math.floor(gridY * map.height / gridHeight);
            var maxY = Math.max(minY + 1,
                Math.floor((gridY + 1) * map.height / gridHeight));
            for(var gridX = 0; gridX < gridWidth; ++gridX) {
                var minX = Math.floor(gridX * map.width / gridWidth);
                var maxX = Math.max(minX + 1,
                    Math.floor((gridX + 1) * map.width / gridWidth));
                var cells = 0;
                var forest = 0;
                var water = 0;
                var cliff = 0;
                var route = 0;
                for(var y = minY; y < maxY; ++y) {
                    for(var x = minX; x < maxX; ++x) {
                        var cellIndex = (y * map.width) + x;
                        var terrain = map.terrain[cellIndex];
                        ++cells;
                        if(terrain === forestValue)
                            ++forest;
                        else if(waterValues[terrain])
                            ++water;
                        else if(cliffValues[terrain])
                            ++cliff;
                        if(map.movement[cellIndex] & routeFlag)
                            ++route;
                    }
                }

                var dominant = "L";
                var dominantCount = 0;
                if(forest > dominantCount) {
                    dominant = "F";
                    dominantCount = forest;
                }
                if(water > dominantCount) {
                    dominant = "W";
                    dominantCount = water;
                }
                if(cliff > dominantCount) {
                    dominant = "C";
                    dominantCount = cliff;
                }
                if(dominantCount < cells * 0.15) {
                    dominant = "L";
                    dominantCount = cells - forest - water - cliff;
                }
                var intensity = Math.min(3,
                    Math.floor(4 * dominantCount / Math.max(1, cells)));
                var routeMark = route >= Math.max(2, cells * 0.025) ? "r" : "-";
                parts.push(dominant + intensity + routeMark);
            }
        }
        return parts.join("");
    },

    Fingerprint: function(pResult) {
        if(!pResult)
            return null;

        var profile = pResult.Profile || {};
        var width = profile.Width || 0;
        var height = profile.Height || 0;
        var anchors = pResult.Anchors || {};
        var paths = pResult.Paths || [];
        var clearings = pResult.Clearings || [];
        var metrics = pResult.Validation && pResult.Validation.metrics;
        var coverage = metrics && metrics.Coverage;
        var orientation = pResult.Orientation || { flipX: false, flipY: false };
        var route = pResult.RouteCorridor || {};
        var continent = pResult.Continent || {};
        var beach = pResult.GrammarLiveTerrain || {};
        var grammarIntent = pResult.GrammarPlan && pResult.GrammarPlan.intent ?
            pResult.GrammarPlan.intent : {};
        var iceLayout = grammarIntent.iceLayout || {};
        var styleContract = pResult.IntentStyleContract || {};

        return {
            terrain: profile.TerrainType,
            concept: pResult.ConceptId || "",
            iceFamily: iceLayout.family || "",
            iceStyle: profile.GrammarIceLayoutStyle ||
                profile.ForcedIceLayoutStyle || iceLayout.name || "",
            coverStyle: pResult.TerraceCover ?
                pResult.TerraceCover.style || "" : "",
            routeFrame: styleContract.routeFrame || "",
            routeShape: this.IntentRegionValue(
                pResult,
                "forest_corridor.corridor",
                "shape"
            ),
            layoutTemplate: profile.LayoutTemplate || "",
            routeArchetype: route.archetype || "",
            continentStyle: continent.style || pResult.SelectedContinentStyle || "",
            widthBucket: this.Bucket(width, 16),
            heightBucket: this.Bucket(height, 16),
            anchors: this.AnchorFingerprint(anchors, width, height),
            pathCount: paths.length,
            pathEdgeBucket: this.PathEdgeBucket(paths),
            waterFamily: this.WaterFamily(profile, coverage),
            beachFamily: profile.TargetPackProfile === "grammar_beach" ?
                (beach.beachTemplate || beach.riverRole || "") : "",
            beachCourse: profile.TargetPackProfile === "grammar_beach" ?
                Number(beach.beachCourseVariant || 0) : 0,
            beachPlacement: profile.TargetPackProfile === "grammar_beach" ?
                Number(beach.beachPlacementVariant || 0) : 0,
            structureBucket: this.Bucket(clearings.length, 4),
            orientation: (orientation.flipX ? "X" : "-") + (orientation.flipY ? "Y" : "-"),
            macroTerrain: this.MacroTerrainSignature(pResult)
        };
    },

    FingerprintKey: function(pFingerprint) {
        if(!pFingerprint)
            return "";
        return [
            pFingerprint.terrain,
            pFingerprint.concept || "",
            pFingerprint.iceFamily || "",
            pFingerprint.iceStyle || "",
            pFingerprint.coverStyle || "",
            pFingerprint.routeFrame || "",
            pFingerprint.routeShape || "",
            pFingerprint.layoutTemplate,
            pFingerprint.routeArchetype,
            pFingerprint.continentStyle,
            pFingerprint.widthBucket,
            pFingerprint.heightBucket,
            pFingerprint.anchors,
            pFingerprint.pathCount,
            pFingerprint.pathEdgeBucket,
            pFingerprint.waterFamily,
            pFingerprint.beachFamily || "",
            pFingerprint.beachCourse || 0,
            pFingerprint.beachPlacement || 0,
            pFingerprint.structureBucket,
            pFingerprint.orientation,
            pFingerprint.macroTerrain || ""
        ].join("/");
    },

    AttemptSummary: function(pResult, pScore, pElapsedMs) {
        var validation = pResult && pResult.Validation ? pResult.Validation : null;
        var fingerprint = this.Fingerprint(pResult);
        var pacing = validation && validation.metrics ? validation.metrics.ScreenPacing : null;
        var utilization = validation && validation.metrics ?
            validation.metrics.GameplayUtilization : null;

        return {
            seed: pResult ? pResult.Seed : null,
            attempt: pResult ? pResult.Attempt : 0,
            ok: validation ? validation.ok : false,
            fatal: validation ? validation.fatal : true,
            score: pScore,
            elapsedMs: pElapsedMs || 0,
            stage: pResult ? pResult.AttemptStage || "plan" : "plan",
            planElapsedMs: pResult ? pResult.PlanElapsedMs || 0 : 0,
            materializationElapsedMs: pResult ? pResult.MaterializationElapsedMs || 0 : 0,
            timings: pResult && pResult.Timings ? pResult.Timings.slice(0) : [],
            driftValidation: pResult ? pResult.DriftValidation || null : null,
            structureRender: pResult ? pResult.StructureRenderStats || null : null,
            liveValidation: pResult && pResult.LiveValidation ? {
                ok: pResult.LiveValidation.ok,
                skipped: !!pResult.LiveValidation.skipped,
                reasons: (pResult.LiveValidation.reasons || []).slice(0)
            } : null,
            reasons: validation ? validation.reasons.slice(0) : ["no_result"],
            warnings: validation ? validation.warnings.slice(0) : [],
            repairActions: validation && validation.repairActions ? validation.repairActions.slice(0) : [],
            localRepairs: pResult && pResult.LocalRepairs ? pResult.LocalRepairs.slice(0) : [],
            authorFailure: pResult && pResult.AuthorResult && !pResult.AuthorResult.ok ? {
                reason: pResult.AuthorResult.reason,
                diagnostics: (pResult.AuthorResult.diagnostics || []).slice(0)
            } : null,
            screenPacing: pacing ? {
                deadFraction: pacing.deadFraction,
                quietFraction: pacing.quietFraction,
                routeDeadFraction: pacing.routeDeadFraction,
                routeQuietFraction: pacing.routeQuietFraction
            } : null,
            gameplayUtilization: utilization ? {
                ok: utilization.ok,
                focusRegions: utilization.focusRegions,
                sectors: utilization.sectors,
                activityPhases: utilization.activityPhases,
                meaningfulSideRoutes: utilization.meaningfulSideRoutes,
                offPrimaryRegions: utilization.offPrimaryRegions,
                routeScreenFraction: utilization.routeScreenFraction,
                misses: utilization.misses.slice(0)
            } : null,
            fingerprint: fingerprint,
            fingerprintKey: this.FingerprintKey(fingerprint)
        };
    },

    AttachSummary: function(pResult, pAttempts, pSelectedScore) {
        if(!pResult)
            return pResult;

        var fingerprint = this.Fingerprint(pResult);

        pResult.Retry = {
            attempts: pAttempts.slice(0),
            selectedAttempt: pResult.Attempt || 0,
            selectedSeed: pResult.Seed,
            selectedScore: pSelectedScore,
            totalAttempts: pAttempts.length,
            selectedFingerprint: fingerprint,
            selectedFingerprintKey: this.FingerprintKey(fingerprint)
        };

        if(pResult.Validation && pResult.Validation.debug)
            pResult.Validation.debug.retry = pResult.Retry;

        return pResult;
    },

    Run: function(pOptions, pAttemptCallback) {
        var options = pOptions || {};
        var attempts = options.Attempts || 1;
        var best = null;
        var bestScore = -1000000;
        var summaries = [];

        for(var attempt = 0; attempt < attempts; ++attempt) {
            var startMs = (new Date()).getTime();
            var result = pAttemptCallback(attempt);
            if(result) result.PlanElapsedMs = (new Date()).getTime() - startMs;
            if(result && result.Validation && result.Validation.ok && options.CompleteAttempt) {
                var liveStart = (new Date()).getTime();
                options.CompleteAttempt(result);
                result.MaterializationElapsedMs = (new Date()).getTime() - liveStart;
            }
            var elapsedMs = (new Date()).getTime() - startMs;
            var score = this.Score(result);

            summaries.push(this.AttemptSummary(result, score, elapsedMs));

            if(!best || score > bestScore) {
                best = result;
                bestScore = score;
            }

            // First ok=true wins. The previous "continue on warnings" mode
            // (ContinueValidationRetriesOnWarnings) ran up to ValidationRetries
            // attempts looking for a warning-free map; on hard ice seeds that
            // burned 50–90s of wall time hunting for soft route-geometry
            // perfection. We accept warning-laden ok=true maps now: the
            // validator already promotes anything genuinely playability-
            // breaking to a hard fail, so a warning-laden ok map is
            // shippable. See Documentation/Current/MapGen_AtlasAware_Redesign.md
            // (Layer C).
            if(result && result.Validation && result.Validation.ok)
                return this.AttachSummary(result, summaries, score);

            // Profile validation errors are deterministic — reseeding can't
            // fix a missing/invalid profile dial. Bail immediately rather
            // than burning the full retry budget producing identical failures.
            // Other fatal reasons (cliff_strands_plateau etc.) are
            // geometry-dependent and *do* benefit from retrying.
            if(result && result.Validation && result.Validation.reasons) {
                var reasons = result.Validation.reasons;
                for(var ri = 0; ri < reasons.length; ++ri) {
                    if(typeof reasons[ri] === "string" && (reasons[ri].indexOf("profile_error:") === 0 ||
                        reasons[ri].indexOf("profile_validation_failed:") === 0))
                        return this.AttachSummary(best, summaries, bestScore);
                }
            }
        }

        return this.AttachSummary(best, summaries, bestScore);
    },

    Score: function(pResult) {
        if(!pResult || !pResult.Validation)
            return -1000000;

        var report = pResult.Validation;
        var score = 0;

        if(report.ok)
            score += 1000;

        score -= report.reasons.length * 100;
        score -= report.warnings.length * 10;

        if(report.metrics) {
            score += Math.floor(report.metrics.Coverage.largestWalkableComponent * 100);
            if(report.metrics.ScreenPacing) {
                score -= Math.floor((report.metrics.ScreenPacing.quietFraction || 0) * 160);
                score -= Math.floor((report.metrics.ScreenPacing.routeQuietFraction || 0) * 240);
            }
            if(report.metrics.GameplayUtilization) {
                var use = report.metrics.GameplayUtilization;
                score += Math.min(100,
                    (use.focusRegions || 0) * 4 +
                    (use.sectors || 0) * 5 +
                    (use.activityPhases || 0) * 6 +
                    (use.meaningfulSideRoutes || 0) * 7 +
                    Math.floor((use.routeScreenFraction || 0) * 60));
                score -= (use.misses ? use.misses.length : 0) * 20;
            }
        }

        return score;
    }
};
