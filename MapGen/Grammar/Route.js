var MapGen = MapGen || {};
MapGen.Grammar = MapGen.Grammar || {};

MapGen.Grammar.Route = {

    HasOwn: function(pObject, pKey) { return MapGen.Grammar.Util.HasOwn(pObject, pKey); },

    NumberOrNull: function(pValue) { return MapGen.Grammar.Util.NumberOrNull(pValue); },

    Clamp: function(pValue, pMin, pMax) { return MapGen.Grammar.Util.Clamp(pValue, pMin, pMax); },

    Round: function(pValue, pPlaces) { return MapGen.Grammar.Util.Round(pValue, pPlaces); },

    StatRange: function(pStats, pPreferWide) { return MapGen.Grammar.Util.StatRange(pStats, pPreferWide); },

    PickStatNumber: function(pRandom, pStats, pInteger, pFallback) {
        return MapGen.Grammar.Util.PickStatNumber(pRandom, pStats, pInteger, pFallback);
    },

    RangeSummary: function(pStats) { return MapGen.Grammar.Util.RangeSummary(pStats); },

    PickMetric: function(pContext, pStats, pInteger, pFallback) {
        return MapGen.Grammar.Util.PickMetric(pContext, pStats, pInteger, pFallback);
    },

    Distance: function(pA, pB) {
        var dx = pA.x - pB.x;
        var dy = pA.y - pB.y;
        return Math.sqrt((dx * dx) + (dy * dy));
    },

    ClampPoint: function(pContext, pPoint, pMargin) {
        var margin = Math.max(1, Math.floor(pMargin || 1));
        return {
            x: this.Clamp(Math.round(pPoint.x), margin, pContext.Width - margin - 1),
            y: this.Clamp(Math.round(pPoint.y), margin, pContext.Height - margin - 1)
        };
    },

    TransformLayoutPoint: function(pContext, pPoint, pTransform) {
        if(!pPoint || pPoint.length < 2)
            return null;

        var x = this.Clamp(Number(pPoint[0]), 0, 1);
        var y = this.Clamp(Number(pPoint[1]), 0, 1);
        var transform = Math.abs(Math.floor(pTransform || 0)) % 8;
        var tx;
        var ty;

        if(transform === 0) { tx = x; ty = y; }
        else if(transform === 1) { tx = 1 - x; ty = y; }
        else if(transform === 2) { tx = x; ty = 1 - y; }
        else if(transform === 3) { tx = 1 - x; ty = 1 - y; }
        else if(transform === 4) { tx = y; ty = x; }
        else if(transform === 5) { tx = 1 - y; ty = x; }
        else if(transform === 6) { tx = y; ty = 1 - x; }
        else { tx = 1 - y; ty = 1 - x; }

        return this.ClampPoint(pContext, {
            x: tx * (pContext.Width - 1),
            y: ty * (pContext.Height - 1)
        }, 2);
    },

    LayoutGoalPoints: function(pContext, pGoals, pTransform) {
        var points = [];
        for(var index = 0; index < (pGoals || []).length; ++index) {
            var point = this.TransformLayoutPoint(
                pContext,
                pGoals[index] ? pGoals[index].point : null,
                pTransform
            );
            if(point)
                points.push(point);
        }
        return points;
    },

    LayoutGoalSpan: function(pTemplate) {
        var goals = pTemplate && pTemplate.primaryGoals ? pTemplate.primaryGoals : [];
        var maximum = 0;
        for(var left = 0; left < goals.length; ++left) {
            var a = goals[left] ? goals[left].point : null;
            if(!a || a.length < 2)
                continue;
            for(var right = left + 1; right < goals.length; ++right) {
                var b = goals[right] ? goals[right].point : null;
                if(!b || b.length < 2)
                    continue;
                var dx = Number(a[0]) - Number(b[0]);
                var dy = Number(a[1]) - Number(b[1]);
                maximum = Math.max(maximum, Math.sqrt((dx * dx) + (dy * dy)));
            }
        }
        return maximum;
    },

    SelectMissionLayout: function(pContext, pIntent) {
        var profile = pContext && pContext.Profile ? pContext.Profile : {};
        var wantsMaze = !!(profile.JungleMazeForestFill ||
            String(profile.Name || "").toLowerCase().indexOf("maze") >= 0 ||
            String(pIntent && pIntent.archetype || "").toLowerCase().indexOf("maze") >= 0 ||
            String(pIntent && pIntent.iceLayout && pIntent.iceLayout.name || "")
                .toLowerCase().indexOf("maze") >= 0);
        var layoutProfileName = String(profile.TargetPackProfile || "");
        // The shipped ice missions do not contain the dense, branching tree
        // mazes represented by mapm19/mapm28/mapm30.  Maze topology is biome
        // independent, so an ice-maze request borrows one of those proven
        // mission/terrain skeletons and lets the ice renderer choose tiles.
        if(wantsMaze && layoutProfileName === "grammar_ice")
            layoutProfileName = "grammar_jungle";
        var layoutPack = layoutProfileName === String(profile.TargetPackProfile || "") ?
            profile.TargetPack :
            (MapGen.TargetPack && MapGen.TargetPack.Profile ?
                MapGen.TargetPack.Profile(layoutProfileName) : null);
        var targets = layoutPack && layoutPack.targets ? layoutPack.targets : {};
        var templates = targets.missionLayouts || [];
        var label = String(pIntent && pIntent.objectiveLabel || "");
        var matches = [];

        for(var index = 0; index < templates.length; ++index) {
            var labels = templates[index].objectiveLabels || [];
            for(var li = 0; li < labels.length; ++li) {
                if(String(labels[li]) === label) {
                    matches.push(templates[index]);
                    break;
                }
            }
        }

        if(!matches.length)
            matches = templates;
        if(!matches.length)
            return null;

        // Keep the mission skeleton and the terrain exemplar in the same
        // original-map family.  Without this, a water-heavy intent could use
        // the objectives from a cliff arena (or a tree-heavy intent from an
        // open snowfield) merely because both had the same mission label.
        var selectedArchetype = String(pIntent && pIntent.archetype || "");
        var profileTerrainTemplates = MapGen.OriginalTerrainTemplates ?
            MapGen.OriginalTerrainTemplates[layoutProfileName] || [] : [];
        if(selectedArchetype && profileTerrainTemplates.length && !wantsMaze) {
            var archetypeMatches = [];
            for(var archetypeIndex = 0; archetypeIndex < matches.length; ++archetypeIndex) {
                var archetypeTags = [];
                for(var sourceIndex = 0; sourceIndex < profileTerrainTemplates.length; ++sourceIndex) {
                    if(String(profileTerrainTemplates[sourceIndex].sourceMap || "") ===
                        String(matches[archetypeIndex].sourceMap || "")) {
                        archetypeTags = profileTerrainTemplates[sourceIndex].archetypes || [];
                        break;
                    }
                }
                for(var archetypeTagIndex = 0; archetypeTagIndex < archetypeTags.length; ++archetypeTagIndex) {
                    if(String(archetypeTags[archetypeTagIndex]) === selectedArchetype) {
                        archetypeMatches.push(matches[archetypeIndex]);
                        break;
                    }
                }
            }
            if(archetypeMatches.length)
                matches = archetypeMatches;
        }

        // The ice layout is more specific than the broad corpus archetype.
        // Several official maps are all tagged long_route, but a cliff
        // checkpoint, flooded edge patrol and forest corridor are not
        // interchangeable terrain exemplars.  Keep the selected live concept
        // in the same visual family as the original whose mission anchors we
        // borrow.
        var iceLayoutName = String(pIntent && pIntent.iceLayout &&
            pIntent.iceLayout.name || "").toLowerCase();
        var requiredTerrainTag = "";
        if(iceLayoutName.indexOf("cliff") >= 0)
            requiredTerrainTag = "cliff_heavy";
        else if(iceLayoutName.indexOf("edge_patrol") >= 0 ||
            iceLayoutName.indexOf("river") >= 0)
            requiredTerrainTag = "water_heavy_ice";
        else if(iceLayoutName.indexOf("forest") >= 0 ||
            iceLayoutName.indexOf("tree") >= 0 ||
            iceLayoutName.indexOf("maze") >= 0)
            requiredTerrainTag = "tree_heavy";
        else if(iceLayoutName.indexOf("outpost") >= 0 ||
            iceLayoutName.indexOf("compound") >= 0)
            requiredTerrainTag = "structure_heavy";

        if(requiredTerrainTag && profileTerrainTemplates.length) {
            var familyMatches = [];
            for(var familyIndex = 0; familyIndex < matches.length; ++familyIndex) {
                for(var familySourceIndex = 0;
                    familySourceIndex < profileTerrainTemplates.length;
                    ++familySourceIndex) {
                    var familyTemplate = profileTerrainTemplates[familySourceIndex];
                    if(String(familyTemplate.sourceMap || "") !==
                        String(matches[familyIndex].sourceMap || ""))
                        continue;
                    var familyTags = familyTemplate.archetypes || [];
                    for(var familyTagIndex = 0;
                        familyTagIndex < familyTags.length;
                        ++familyTagIndex) {
                        if(String(familyTags[familyTagIndex]) === requiredTerrainTag) {
                            familyMatches.push(matches[familyIndex]);
                            break;
                        }
                    }
                    break;
                }
            }
            if(familyMatches.length)
                matches = familyMatches;
        }

        // A requested maze should be based on one of the originals whose
        // cover is genuinely arranged as a maze.  Tree coverage alone is not
        // sufficient: some originals have many trees but broad open lawns,
        // with none of mapm19/mapm28/mapm30's narrow branching routes.
        if(wantsMaze) {
            var mazeMatches = [];
            for(var mazeIndex = 0; mazeIndex < matches.length; ++mazeIndex) {
                var mazeTags = matches[mazeIndex].archetypes || [];
                if(!mazeTags.length && MapGen.OriginalTerrainTemplates) {
                    var terrainTemplates = MapGen.OriginalTerrainTemplates[
                        layoutProfileName] || [];
                    for(var terrainIndex = 0; terrainIndex < terrainTemplates.length; ++terrainIndex) {
                        if(String(terrainTemplates[terrainIndex].sourceMap || "") ===
                            String(matches[mazeIndex].sourceMap || "")) {
                            mazeTags = terrainTemplates[terrainIndex].archetypes || [];
                            break;
                        }
                    }
                }
                for(var tagIndex = 0; tagIndex < mazeTags.length; ++tagIndex) {
                    if(String(mazeTags[tagIndex]) === "original_maze") {
                        mazeMatches.push(matches[mazeIndex]);
                        break;
                    }
                }
            }
            if(mazeMatches.length)
                matches = mazeMatches;
        }

        // Do not select a two-objective original for a live mission whose
        // normal structure budget is three or more.  That mismatch forced the
        // placer to invent an unprofiled third site and was the source of the
        // intermittent 2/3 building failures on otherwise valid ice maps.
        if(label === "destroy_buildings" &&
            (pContext.Width * pContext.Height) >= 2000) {
            var goalCompatible = [];
            for(index = 0; index < matches.length; ++index) {
                if((matches[index].primaryGoals || []).length >= 3)
                    goalCompatible.push(matches[index]);
            }
            if(goalCompatible.length)
                matches = goalCompatible;
        }

        // A one-compound original is a useful compact-map shape, but scaling it
        // onto a large/XL canvas recreates the exact failure we are avoiding:
        // every objective sits in one corner and most of the map is irrelevant.
        // On larger maps, select only originals whose real goal set was both
        // multi-site and spatially broad. Mirroring still provides eight layout
        // variants without inventing distributions unsupported by the corpus.
        var minSide = Math.min(pContext.Width, pContext.Height);
        if(label === "destroy_buildings" && minSide >= 70) {
            var broad = [];
            for(index = 0; index < matches.length; ++index) {
                if((matches[index].primaryGoals || []).length >= 3 &&
                    this.LayoutGoalSpan(matches[index]) >= 0.45)
                    broad.push(matches[index]);
            }
            if(broad.length)
                matches = broad;
        }


        // Prefer originals with a comparable canvas and aspect ratio.  A
        // 19x15 tutorial map stretched across an XL canvas preserves neither
        // its encounter pacing nor its terrain shapes.  Keep the best half of
        // the candidates, then use seeded randomness within that pool.
        if(matches.length > 3) {
            var targetAspect = pContext.Width / Math.max(1, pContext.Height);
            var targetArea = pContext.Width * pContext.Height;
            matches.sort(function(pA, pB) {
                function score(item) {
                    var size = item.originalSize || [pContext.Width, pContext.Height];
                    var width = Math.max(1, Number(size[0] || 1));
                    var height = Math.max(1, Number(size[1] || 1));
                    var aspectCost = Math.abs(Math.log((width / height) / targetAspect));
                    var areaCost = Math.abs(Math.log((width * height) / targetArea));
                    return (aspectCost * 1.6) + areaCost;
                }
                return score(pA) - score(pB);
            });
            matches = matches.slice(0, Math.max(3, Math.ceil(matches.length / 2)));
        }

        return matches[pContext.Random.Int(0, matches.length - 1)];
    },

    MissionLayoutFrame: function(pContext, pIntent) {
        var template = this.SelectMissionLayout(pContext, pIntent);
        if(!template)
            return null;

        var transform = pContext.Random.Int(0, 7);
        var start = this.TransformLayoutPoint(pContext, template.start, transform);
        var goals = this.LayoutGoalPoints(pContext, template.primaryGoals, transform);
        if(!start || !goals.length)
            return null;

        var waypoints = [start];
        for(var index = 0; index < goals.length; ++index) {
            if(this.Distance(waypoints[waypoints.length - 1], goals[index]) >= 3)
                waypoints.push(goals[index]);
        }
        if(waypoints.length < 2)
            return null;

        return {
            start: waypoints[0],
            end: waypoints[waypoints.length - 1],
            waypoints: waypoints,
            pressureWaypoints: this.LayoutGoalPoints(
                pContext, template.pressureGoals, transform),
            supportWaypoints: this.LayoutGoalPoints(
                pContext, template.supportGoals, transform),
            source: "official_mission_layout",
            sourceMap: template.sourceMap || null,
            transform: transform,
            originalSize: template.originalSize || null,
            horizontalBias: Math.abs(waypoints[waypoints.length - 1].x - waypoints[0].x) >=
                Math.abs(waypoints[waypoints.length - 1].y - waypoints[0].y)
        };
    },

    PointAlongPolyline: function(pPoints, pFraction) {
        if(!pPoints || pPoints.length < 2)
            return null;

        var lengths = [];
        var total = 0;
        for(var index = 1; index < pPoints.length; ++index) {
            var length = this.Distance(pPoints[index - 1], pPoints[index]);
            lengths.push(length);
            total += length;
        }
        if(total <= 0)
            return { point: pPoints[0], dx: 1, dy: 0 };

        var target = this.Clamp(pFraction, 0, 1) * total;
        var travelled = 0;
        for(index = 0; index < lengths.length; ++index) {
            if(target <= travelled + lengths[index] || index === lengths.length - 1) {
                var from = pPoints[index];
                var to = pPoints[index + 1];
                var local = lengths[index] > 0 ?
                    (target - travelled) / lengths[index] : 0;
                return {
                    point: {
                        x: from.x + ((to.x - from.x) * local),
                        y: from.y + ((to.y - from.y) * local)
                    },
                    dx: to.x - from.x,
                    dy: to.y - from.y
                };
            }
            travelled += lengths[index];
        }
        return null;
    },

    LinePoints: function(pStart, pEnd, pSkipFirst) {
        var points = [];
        var x0 = Math.round(pStart.x);
        var y0 = Math.round(pStart.y);
        var x1 = Math.round(pEnd.x);
        var y1 = Math.round(pEnd.y);
        var dx = Math.abs(x1 - x0);
        var dy = Math.abs(y1 - y0);
        var sx = x0 < x1 ? 1 : -1;
        var sy = y0 < y1 ? 1 : -1;
        var err = dx - dy;
        var first = true;

        while(true) {
            if(!(pSkipFirst && first))
                points.push({ x: x0, y: y0 });
            first = false;

            if(x0 === x1 && y0 === y1)
                break;

            var e2 = 2 * err;
            if(e2 > -dy) {
                err -= dy;
                x0 += sx;
            }
            if(e2 < dx) {
                err += dx;
                y0 += sy;
            }
        }

        return points;
    },

    SegmentPath: function(pContext, pStart, pEnd, pBendStrength) {
        var dx = pEnd.x - pStart.x;
        var dy = pEnd.y - pStart.y;
        var direct = Math.max(1, this.Distance(pStart, pEnd));
        var bend = Math.max(0, pBendStrength || 0);
        var mid = {
            x: (pStart.x + pEnd.x) / 2,
            y: (pStart.y + pEnd.y) / 2
        };
        var perpX = -dy / direct;
        var perpY = dx / direct;
        var offset = (pContext.Random.Float(-1, 1) * bend);
        var control = this.ClampPoint(
            pContext,
            { x: mid.x + (perpX * offset), y: mid.y + (perpY * offset) },
            2
        );
        var first = this.LinePoints(pStart, control, false);
        var second = this.LinePoints(control, pEnd, true);

        return first.concat(second);
    },

    PathLength: function(pPath) {
        if(!pPath || pPath.length < 2)
            return 0;

        var length = 0;
        for(var index = 1; index < pPath.length; ++index)
            length += this.Distance(pPath[index - 1], pPath[index]);
        return this.Round(length, 2);
    },

    ScreenRectForAnchor: function(pContext, pScreenPlan, pPoint) {
        var width = pScreenPlan && pScreenPlan.viewportTiles ? Number(pScreenPlan.viewportTiles.width || 17) : 17;
        var height = pScreenPlan && pScreenPlan.viewportTiles ? Number(pScreenPlan.viewportTiles.height || 13) : 13;
        var left = this.Clamp(Math.round(pPoint.x - (width / 2)), 0, Math.max(0, pContext.Width - width));
        var top = this.Clamp(Math.round(pPoint.y - (height / 2)), 0, Math.max(0, pContext.Height - height));

        return {
            x: left,
            y: top,
            width: width,
            height: height
        };
    },

    BuildRouteFrame: function(pContext, pIntent) {
        var missionFrame = this.MissionLayoutFrame(pContext, pIntent);
        if(missionFrame)
            return missionFrame;

        var marginX = Math.max(5, Math.min(11, Math.floor(pContext.Width * 0.11)));
        var marginY = Math.max(5, Math.min(9, Math.floor(pContext.Height * 0.13)));
        var horizontal = pContext.Width >= pContext.Height;
        var archetype = pIntent ? String(pIntent.archetype || "") : "";
        var routeTarget = pIntent && pIntent.routeShape ?
            Number(pIntent.routeShape.routeLengthTarget || 0) : 0;
        var wantsLongAxis = routeTarget > Math.max(pContext.Width, pContext.Height) * 1.35;

        if(archetype === "compact" && !wantsLongAxis && pContext.Random.Chance(0.35))
            horizontal = !horizontal;

        var start;
        var end;

        if(horizontal) {
            start = {
                x: marginX,
                y: pContext.Random.Int(marginY, Math.max(marginY, pContext.Height - marginY - 1))
            };
            end = {
                x: pContext.Width - marginX - 1,
                y: pContext.Random.Int(marginY, Math.max(marginY, pContext.Height - marginY - 1))
            };
        }
        else {
            start = {
                x: pContext.Random.Int(marginX, Math.max(marginX, pContext.Width - marginX - 1)),
                y: marginY
            };
            end = {
                x: pContext.Random.Int(marginX, Math.max(marginX, pContext.Width - marginX - 1)),
                y: pContext.Height - marginY - 1
            };
        }

        if(pContext.Random.Chance(0.5)) {
            var swap = start;
            start = end;
            end = swap;
        }

        return {
            start: this.ClampPoint(pContext, start, 2),
            end: this.ClampPoint(pContext, end, 2),
            horizontalBias: horizontal
        };
    },

    AnchorForFraction: function(pContext, pFrame, pFraction, pIntent, pIndex) {
        var start = pFrame.start;
        var end = pFrame.end;
        var sample = this.PointAlongPolyline(pFrame.waypoints, pFraction);
        var base = sample ? sample.point : {
            x: start.x + ((end.x - start.x) * pFraction),
            y: start.y + ((end.y - start.y) * pFraction)
        };
        var dx = sample ? sample.dx : end.x - start.x;
        var dy = sample ? sample.dy : end.y - start.y;
        var direct = Math.max(1, Math.sqrt((dx * dx) + (dy * dy)));
        var routeLengthTarget = pIntent && pIntent.routeShape ?
            Number(pIntent.routeShape.routeLengthTarget || direct) : direct;
        var minSide = Math.min(pContext.Width, pContext.Height);
        var wanderRatio = this.Clamp((routeLengthTarget / direct) - 1, 0, 1.4);
        var amplitude = this.Clamp((minSide * 0.05) + (minSide * 0.08 * wanderRatio), 2, minSide * 0.22);
        if(sample)
            amplitude *= 0.55;
        var perpX = -dy / direct;
        var perpY = dx / direct;
        var waveCount = pIntent && pIntent.archetype === "compact" ? 1.0 : 1.6;
        var wave = Math.sin((pFraction * Math.PI * 2 * waveCount) + (pIndex * 0.37)) * amplitude;
        var jitter = pContext.Random.Float(-amplitude * 0.30, amplitude * 0.30);
        var point = {
            x: base.x + (perpX * (wave + jitter)),
            y: base.y + (perpY * (wave + jitter))
        };

        if(pIndex === 0)
            point = start;
        else if(pFraction >= 0.999)
            point = end;

        return this.ClampPoint(pContext, point, 2);
    },

    ContextKeyForBeat: function(pBeat) {
        if(!pBeat)
            return "route_phase:mid_route";
        if(pBeat.screenType === "extraction_screen" ||
            pBeat.routePhase === "extraction_or_exit")
            return "route_phase:extraction_exit";
        if(pBeat.screenType === "objective_arena" ||
            pBeat.routePhase === "objective_push")
            return "route_phase:objective_arena";
        if(pBeat.routePhase === "start_zone")
            return "route_phase:start_zone";
        if(pBeat.routePhase === "first_contact")
            return "route_phase:first_contact";
        return "route_phase:mid_route";
    },

    ContextTarget: function(pContext, pSubtileTargets, pContextKey) {
        var contexts = pSubtileTargets && pSubtileTargets.contexts ? pSubtileTargets.contexts : {};
        var target = contexts[pContextKey] || null;

        if(!target && pContextKey === "route_phase:objective_arena")
            target = contexts.objective_arenas || null;
        if(!target && pContextKey === "route_phase:mid_route")
            target = contexts.combat_viewports || null;

        return {
            contextKey: pContextKey,
            tileCount: this.PickMetric(pContext, target ? target.tileCount : null, true, 0),
            dryWalkableSubcellFraction: this.PickMetric(pContext, target ? target.dryWalkableSubcellFraction : null, false, 0),
            engineWalkableSubcellFraction: this.PickMetric(pContext, target ? target.engineWalkableSubcellFraction : null, false, 0),
            partialDryTileFraction: this.PickMetric(pContext, target ? target.partialDryTileFraction : null, false, 0),
            narrowDryTileCount: this.PickMetric(pContext, target ? target.narrowDryTileCount : null, true, 0),
            sourceAvailable: !!target
        };
    },

    CorridorTargets: function(pContext, pSubtileTargets) {
        return {
            routeCorridorWidthTiles: this.PickMetric(
                pContext,
                pSubtileTargets ? pSubtileTargets.routeCorridorWidthTiles : null,
                false,
                4
            ),
            engineOnlyCorridorWidthTiles: this.PickMetric(
                pContext,
                pSubtileTargets ? pSubtileTargets.engineOnlyCorridorWidthTiles : null,
                false,
                8
            )
        };
    },

    MobilityAssetSpecs: function(pContext, pIntent, pMobilityTargets, pBeatCount) {
        var mode = pIntent ? String(pIntent.mobilityMode || "foot") : "foot";
        var assets = [];
        var access = pMobilityTargets && pMobilityTargets.assetAccess ? pMobilityTargets.assetAccess : {};

        function add(pName, pKind, pFraction, pEnablesMode, pTargetStats, pRequired) {
            var beatIndex = Math.max(0, Math.min(pBeatCount - 1, Math.round((pBeatCount - 1) * pFraction)));
            assets.push({
                name: pName,
                kind: pKind,
                routeFraction: pFraction,
                beforeBeatIndex: beatIndex,
                enablesMode: pEnablesMode,
                required: pRequired !== false,
                targetCount: pTargetStats || null
            });
        }

        if(mode === "swim_or_wade") {
            add("water_crossing", "terrain_crossing", 0.33, "swim_or_wade", null, true);
        }
        else if(mode === "vehicle_or_swim") {
            add("optional_vehicle", "vehicle", 0.24, "vehicle_or_swim", access.reachableVehicleCount, false);
            add("water_crossing", "terrain_crossing", 0.34, "swim_or_wade", null, true);
        }
        else if(mode === "skidoo_or_vehicle") {
            add("vehicle_or_skidoo", "vehicle", 0.22, "skidoo_or_vehicle", access.reachableVehicleCount, true);
        }
        else if(mode === "helicopter") {
            add("helicopter", "helicopter", 0.26, "helicopter", access.reachableHumanHelicopterCount, true);
            add("air_landing_zone", "landing_zone", 0.72, "helicopter", access.coarseReachableHumanHelicopterCount, true);
        }
        else if(mode === "skidoo_jump") {
            add("skidoo", "vehicle", 0.20, "skidoo", access.reachableVehicleCount, true);
            add("jump_ramps", "jump_ramps", 0.42, "skidoo_jump", access.jumpRampCount, true);
        }
        else if(mode === "vehicle_jump") {
            add("vehicle", "vehicle", 0.20, "vehicle", access.reachableVehicleCount, true);
            add("jump_ramps", "jump_ramps", 0.42, "vehicle_jump", access.jumpRampCount, true);
        }
        else if(mode === "breakable_or_lowering_terrain") {
            add("dynamic_unlock", "breakable_or_lowering_terrain", 0.44, "foot", null, true);
        }

        return assets;
    },

    ModeForLeg: function(pIntent, pFromFraction, pToFraction) {
        var mode = pIntent ? String(pIntent.mobilityMode || "foot") : "foot";
        var mid = (pFromFraction + pToFraction) / 2;

        if(mode === "helicopter" && mid >= 0.28)
            return "helicopter";
        if(mode === "swim_or_wade" && mid >= 0.35 && mid <= 0.66)
            return "swim_or_wade";
        if(mode === "vehicle_or_swim" && mid >= 0.24 && mid <= 0.66)
            return "vehicle_or_swim";
        if(mode === "skidoo_or_vehicle" && mid >= 0.24)
            return "skidoo_or_vehicle";
        if(mode === "skidoo_jump" && mid >= 0.24)
            return mid >= 0.45 && mid <= 0.62 ? "skidoo_jump" : "skidoo";
        if(mode === "vehicle_jump" && mid >= 0.24)
            return mid >= 0.45 && mid <= 0.62 ? "vehicle_jump" : "vehicle";
        if(mode === "breakable_or_lowering_terrain" && mid >= 0.48 && mid <= 0.60)
            return "dynamic_unlock";
        return "foot";
    },

    RequiredModes: function(pIntent, pLegs) {
        var modes = {};
        var result = [];
        var index;

        modes.foot = true;
        if(pIntent && pIntent.mobilityMode)
            modes[pIntent.mobilityMode] = true;
        for(index = 0; index < pLegs.length; ++index)
            modes[pLegs[index].mode] = true;

        for(var key in modes) {
            if(this.HasOwn(modes, key))
                result.push(key);
        }

        return result;
    },

    AssetForLeg: function(pAssets, pLeg) {
        for(var index = 0; index < pAssets.length; ++index) {
            var asset = pAssets[index];
            if(!asset.required)
                continue;
            if(asset.beforeBeatIndex <= pLeg.fromBeatIndex &&
                (asset.enablesMode === pLeg.mode ||
                    (asset.kind === "jump_ramps" && pLeg.mode.indexOf("jump") >= 0) ||
                    (asset.kind === "terrain_crossing" && pLeg.mode.indexOf("swim") >= 0) ||
                    (asset.kind === "breakable_or_lowering_terrain" && pLeg.mode === "dynamic_unlock")))
                return asset.name;
        }

        return null;
    },

    BuildRouteBeats: function(pContext, pPlan, pSubtileTargets, pOutlierReasons) {
        var screenPlan = pPlan.screenPlan || {};
        var screenBeats = screenPlan.sequence || [];
        var intent = pPlan.intent || {};
        var frame = this.BuildRouteFrame(pContext, intent);
        var beats = [];

        if(!screenBeats.length) {
            pOutlierReasons.push("route_plan_missing_screen_plan");
            screenBeats = [
                { index: 0, routeFraction: 0, screenType: "start_screen", routePhase: "start_zone", role: "start" },
                { index: 1, routeFraction: 1, screenType: "objective_arena", routePhase: "objective_push", role: "objective_arena" }
            ];
        }

        for(var index = 0; index < screenBeats.length; ++index) {
            var screenBeat = screenBeats[index];
            var fraction = this.NumberOrNull(screenBeat.routeFraction);
            if(fraction === null)
                fraction = screenBeats.length <= 1 ? 0 : index / (screenBeats.length - 1);

            var anchor = this.AnchorForFraction(pContext, frame, fraction, intent, index);
            var contextKey = this.ContextKeyForBeat(screenBeat);
            var target = this.ContextTarget(pContext, pSubtileTargets, contextKey);
            if(!target.sourceAvailable)
                pOutlierReasons.push("subcell_context_target_missing:" + contextKey);

            beats.push({
                id: "beat_" + index,
                index: index,
                routeFraction: this.Round(fraction, 4),
                point: anchor,
                viewport: this.ScreenRectForAnchor(pContext, screenPlan, anchor),
                screenType: screenBeat.screenType,
                routePhase: screenBeat.routePhase,
                role: screenBeat.role || "",
                orderStep: screenBeat.orderStep || null,
                intendedEnemyPressure: screenBeat.intendedEnemyPressure || 0,
                supportObjectCount: screenBeat.supportObjectCount || 0,
                tacticalObjectCount: screenBeat.tacticalObjectCount || 0,
                screenTarget: screenBeat.terrainBalance || null,
                subcellTarget: target
            });
        }

        return {
            frame: frame,
            beats: beats
        };
    },

    BuildAccessAssets: function(pContext, pIntent, pMobilityTargets, pBeats) {
        var specs = this.MobilityAssetSpecs(pContext, pIntent, pMobilityTargets, pBeats.length);
        var assets = [];

        for(var index = 0; index < specs.length; ++index) {
            var spec = specs[index];
            var beat = pBeats[Math.max(0, Math.min(pBeats.length - 1, spec.beforeBeatIndex))];
            assets.push({
                name: spec.name,
                kind: spec.kind,
                required: spec.required,
                enablesMode: spec.enablesMode,
                routeFraction: this.Round(spec.routeFraction, 4),
                beforeBeatIndex: spec.beforeBeatIndex,
                point: beat ? { x: beat.point.x, y: beat.point.y } : null,
                targetCount: spec.targetCount ? this.PickMetric(pContext, spec.targetCount, true, spec.required ? 1 : 0) : null,
                ordering: "before_required_leg"
            });
        }

        return assets;
    },

    BuildLegs: function(pContext, pIntent, pSubtileTargets, pBeats, pAssets) {
        var legs = [];
        var routePath = [];

        for(var index = 1; index < pBeats.length; ++index) {
            var from = pBeats[index - 1];
            var to = pBeats[index];
            var bend = Math.max(2, Math.min(10, this.Distance(from.point, to.point) * 0.18));
            var path = this.SegmentPath(pContext, from.point, to.point, bend);
            var mode = this.ModeForLeg(pIntent, from.routeFraction, to.routeFraction);
            var leg = {
                id: "leg_" + (index - 1),
                index: index - 1,
                fromBeatId: from.id,
                toBeatId: to.id,
                fromBeatIndex: from.index,
                toBeatIndex: to.index,
                routeFraction: {
                    from: from.routeFraction,
                    to: to.routeFraction
                },
                mode: mode,
                requiredAsset: null,
                routePhase: to.routePhase,
                screenType: to.screenType,
                path: path,
                lengthTiles: this.PathLength(path),
                subcellTarget: this.ContextTarget(
                    pContext,
                    pSubtileTargets,
                    this.ContextKeyForBeat(to)
                )
            };

            leg.requiredAsset = this.AssetForLeg(pAssets, leg);
            legs.push(leg);

            for(var p = 0; p < path.length; ++p) {
                if(routePath.length && p === 0)
                    continue;
                routePath.push(path[p]);
            }
        }

        return {
            legs: legs,
            routePath: routePath
        };
    },

    BranchEndpoint: function(pContext, pBeat, pIndex) {
        var side = pIndex % 2 === 0 ? 1 : -1;
        var distance = pContext.Random.Int(7, Math.max(8, Math.min(16, Math.floor(Math.min(pContext.Width, pContext.Height) * 0.28))));
        var xOffset = side * distance;
        var yOffset = pContext.Random.Int(-Math.floor(distance * 0.55), Math.floor(distance * 0.55));

        if(pContext.Height > pContext.Width) {
            yOffset = side * distance;
            xOffset = pContext.Random.Int(-Math.floor(distance * 0.55), Math.floor(distance * 0.55));
        }

        return this.ClampPoint(
            pContext,
            { x: pBeat.point.x + xOffset, y: pBeat.point.y + yOffset },
            3
        );
    },

    BuildBranches: function(pContext, pPlan, pBeats, pSubtileTargets) {
        var intent = pPlan.intent || {};
        var routeShape = intent.routeShape || {};
        var profile = pContext.Profile || {};
        var target = profile.TargetPack || {};
        var targets = target.targets || {};
        var missionFlow = targets.missionFlow || {};
        var supportTarget = Number(routeShape.supportGoalCountTarget || 0);
        var branchCount = Math.max(0, Math.min(4, Math.round(supportTarget)));
        var branches = [];
        var candidates = [];
        var index;

        for(index = 1; index < pBeats.length - 1; ++index) {
            var beat = pBeats[index];
            if(beat.screenType === "support_screen" ||
                beat.role === "support" ||
                beat.supportObjectCount > 0 ||
                beat.routePhase === "mid_route_pressure")
                candidates.push(beat);
        }

        if(missionFlow.branchPointCount) {
            var branchTarget = this.PickStatNumber(pContext.Random, missionFlow.branchPointCount, true, branchCount);
            branchCount = Math.max(branchCount, Math.min(4, branchTarget));
        }
        if(!branchCount && pBeats.length >= 12 && pContext.Random.Chance(0.45))
            branchCount = 1;
        if(!candidates.length) {
            for(index = 1; index < pBeats.length - 1; ++index) {
                if(index >= Math.floor(pBeats.length * 0.25) && index <= Math.ceil(pBeats.length * 0.75))
                    candidates.push(pBeats[index]);
            }
        }
        if(branchCount > candidates.length)
            branchCount = candidates.length;

        for(index = 0; index < branchCount; ++index) {
            var candidate = candidates[Math.floor(((index + 1) / (branchCount + 1)) * candidates.length)];
            var end = this.BranchEndpoint(pContext, candidate, index);
            var path = this.SegmentPath(pContext, candidate.point, end, 4);
            branches.push({
                id: "branch_" + index,
                index: index,
                fromBeatId: candidate.id,
                fromBeatIndex: candidate.index,
                routeFraction: candidate.routeFraction,
                routePhase: candidate.routePhase,
                purpose: index === 0 ? "support_or_pickup_spur" : "route_context_spur",
                mode: "foot",
                endpoint: end,
                path: path,
                lengthTiles: this.PathLength(path),
                subcellTarget: this.ContextTarget(pContext, pSubtileTargets, "route_phase:mid_route")
            });
        }

        return branches;
    },

    MobilityGuardrails: function(pIntent, pAssets, pLegs) {
        var mode = pIntent ? String(pIntent.mobilityMode || "foot") : "foot";
        var reasons = [];
        var index;
        var requiredAssetSeen = {};

        for(index = 0; index < pAssets.length; ++index) {
            if(pAssets[index].required)
                requiredAssetSeen[pAssets[index].name] = true;
        }

        if(mode === "helicopter" && !requiredAssetSeen.helicopter)
            reasons.push("mobility_asset_missing:helicopter");
        if((mode === "skidoo_jump" || mode === "vehicle_jump") && !requiredAssetSeen.jump_ramps)
            reasons.push("mobility_asset_missing:jump_ramps");
        if(mode === "breakable_or_lowering_terrain" && !requiredAssetSeen.dynamic_unlock)
            reasons.push("mobility_asset_missing:dynamic_unlock");

        for(index = 0; index < pLegs.length; ++index) {
            var leg = pLegs[index];
            if((leg.mode === "helicopter" || leg.mode === "dynamic_unlock" ||
                leg.mode === "skidoo_or_vehicle" || leg.mode === "skidoo" ||
                leg.mode === "vehicle" ||
                leg.mode === "skidoo_jump" || leg.mode === "vehicle_jump" ||
                leg.mode === "swim_or_wade") && !leg.requiredAsset)
                reasons.push("asset_after_required_leg:" + leg.id + ":" + leg.mode);
        }

        return reasons;
    },

    RouteMetrics: function(pContext, pIntent, pLegs, pRoutePath) {
        var target = pIntent && pIntent.routeShape ? Number(pIntent.routeShape.routeLengthTarget || 0) : 0;
        var length = this.PathLength(pRoutePath);
        var direct = pRoutePath && pRoutePath.length > 1 ? this.Distance(pRoutePath[0], pRoutePath[pRoutePath.length - 1]) : 0;

        return {
            targetRouteLength: target,
            plannedRouteLength: length,
            directDistance: this.Round(direct, 2),
            sinuosity: direct > 0 ? this.Round(length / direct, 3) : 0,
            legCount: pLegs.length,
            averageLegLength: pLegs.length ? this.Round(length / pLegs.length, 2) : 0,
            mapCoverageFraction: this.Round(length / Math.max(1, pContext.Width * pContext.Height), 4)
        };
    },

    Plan: function(pContext, pPlan) {
        var self = MapGen.Grammar.Route;
        var profile = pContext.Profile || {};
        var target = profile.TargetPack || {};
        var targets = target.targets || {};
        var intent = pPlan.intent || {};
        var subtileTargets = targets.subtileTacticalTerrain || {};
        var mobilityTargets = targets.mobilityMissionFlow || {};
        var outlierReasons = [];

        if(!targets.missionFlow)
            outlierReasons.push("mission_flow_targets_missing");
        if(!subtileTargets.routeCorridorWidthTiles)
            outlierReasons.push("subcell_route_width_targets_missing");
        if(!mobilityTargets.requiredModeCounts)
            outlierReasons.push("mobility_targets_missing");

        var routeBuild = self.BuildRouteBeats(pContext, pPlan, subtileTargets, outlierReasons);
        var beats = routeBuild.beats;
        var accessAssets = self.BuildAccessAssets(pContext, intent, mobilityTargets, beats);
        var legBuild = self.BuildLegs(pContext, intent, subtileTargets, beats, accessAssets);
        var branches = self.BuildBranches(pContext, pPlan, beats, subtileTargets);
        var mobilityReasons = self.MobilityGuardrails(intent, accessAssets, legBuild.legs);
        var routeMetrics = self.RouteMetrics(pContext, intent, legBuild.legs, legBuild.routePath);
        var corridorTargets = self.CorridorTargets(pContext, subtileTargets);
        var index;

        for(index = 0; index < mobilityReasons.length; ++index)
            outlierReasons.push(mobilityReasons[index]);

        if(routeMetrics.targetRouteLength > 0 &&
            routeMetrics.plannedRouteLength < routeMetrics.targetRouteLength * 0.50)
            outlierReasons.push("route_length_target_capped_by_map_geometry");

        var mobilityPlan = {
            name: "mobilityPlan",
            status: "ready",
            selectedMode: intent.mobilityMode || "foot",
            requiredModes: self.RequiredModes(intent, legBuild.legs),
            requiredAssets: accessAssets,
            assetOrdering: accessAssets,
            mobilityFeatureFlags: intent.mobilityFeatureFlags || [],
            sourceMapsByMode: mobilityTargets.mapsByMode || {},
            targetRefs: [
                "profiles." + (pPlan.targetPackProfileName || profile.TargetPackProfile || "") + ".targets.mobilityMissionFlow",
                "intent.mobilityMode"
            ],
            outlierReasons: mobilityReasons
        };

        return {
            name: "routePlan",
            status: "ready",
            routeFrame: routeBuild.frame,
            routeBeats: beats,
            legs: legBuild.legs,
            branches: branches,
            routePath: legBuild.routePath,
            routeMetrics: routeMetrics,
            mobilityPlan: mobilityPlan,
            subcellValidation: {
                required: true,
                status: "planned_targets_ready",
                validationMode: "pre_materialization_targets",
                corridorTargets: corridorTargets,
                contextTargets: {
                    startZone: self.ContextTarget(pContext, subtileTargets, "route_phase:start_zone"),
                    firstContact: self.ContextTarget(pContext, subtileTargets, "route_phase:first_contact"),
                    midRoute: self.ContextTarget(pContext, subtileTargets, "route_phase:mid_route"),
                    objectiveArena: self.ContextTarget(pContext, subtileTargets, "route_phase:objective_arena"),
                    extractionExit: self.ContextTarget(pContext, subtileTargets, "route_phase:extraction_exit"),
                    waterCrossings: self.ContextTarget(pContext, subtileTargets, "water_crossings"),
                    jumpRampApproaches: self.ContextTarget(pContext, subtileTargets, "jump_ramp_approaches"),
                    softChokepoints: self.ContextTarget(pContext, subtileTargets, "soft_chokepoints"),
                    hardChokepoints: self.ContextTarget(pContext, subtileTargets, "hard_chokepoints")
                }
            },
            targetRefs: [
                "profiles." + (pPlan.targetPackProfileName || profile.TargetPackProfile || "") + ".targets.missionFlow",
                "profiles." + (pPlan.targetPackProfileName || profile.TargetPackProfile || "") + ".targets.subtileTacticalTerrain",
                "profiles." + (pPlan.targetPackProfileName || profile.TargetPackProfile || "") + ".targets.mobilityMissionFlow",
                "screenPlan.sequence",
                "intent.routeShape"
            ],
            outlierReasons: outlierReasons
        };
    }
};
