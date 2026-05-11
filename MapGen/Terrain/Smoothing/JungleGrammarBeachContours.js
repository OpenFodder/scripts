var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};
MapGen.Terrain.Smoothing.Jungle = MapGen.Terrain.Smoothing.Jungle || {};

(function(pJungle) {
    pJungle.SmoothSub1GrammarBeachWaterCorners = function(pContext, pChars) {
        if(!this.UsesSub1ExplicitWaterTiles(pContext) ||
            !pContext.Profile ||
            pContext.Profile.TargetPackProfile !== "grammar_beach")
            return 0;

        var core = MapGen.Terrain.Smoothing.Core;
        var next = MapGen.Layers.Clone(pChars);
        var changed = 0;

        for(var x = 1; x < pContext.Width - 1; ++x) {
            for(var y = 1; y < pContext.Height - 1; ++y) {
                if(core.GetChar(pChars, x, y, this.Chars.ground) !== this.Chars.water)
                    continue;

                var mask = this.Sub1BeachSandMaskAt(pContext, pChars, x, y);
                if(mask !== "SWWS")
                    continue;

                if(core.GetChar(pChars, x + 1, y - 1, this.Chars.ground) === this.Chars.beach &&
                    this.Sub1BeachSandMaskAt(pContext, pChars, x - 1, y) === "SWSS" &&
                    this.CanRewriteSub1BeachCharmapCell(pContext, x, y)) {
                    MapGen.Layers.Set(next, x, y, this.Chars.beach);
                    ++changed;
                    continue;
                }

                if(core.GetChar(pChars, x + 1, y - 1, this.Chars.ground) === this.Chars.water &&
                    this.CanRewriteSub1BeachCharmapCell(pContext, x + 1, y - 1)) {
                    MapGen.Layers.Set(next, x + 1, y - 1, this.Chars.beach);
                    ++changed;
                }

                if(core.GetChar(pChars, x - 1, y + 1, this.Chars.ground) === this.Chars.beach &&
                    !this.IsAuthoredSub1GrammarBeachCoastCell(pContext, x - 1, y + 1) &&
                    this.CanRewriteSub1BeachCharmapCell(pContext, x - 1, y + 1)) {
                    MapGen.Layers.Set(next, x - 1, y + 1, this.Chars.water);
                    ++changed;
                }
            }
        }

        if(changed) {
            for(var sx = 0; sx < pContext.Width; ++sx)
                pChars[sx] = next[sx];
        }

        return changed;
    };

    pJungle.PruneUnsupportedSub1GrammarBeachMasks = function(pContext, pChars) {
        if(!this.UsesSub1ExplicitWaterTiles(pContext) ||
            !pContext.Profile ||
            pContext.Profile.TargetPackProfile !== "grammar_beach")
            return 0;

        var core = MapGen.Terrain.Smoothing.Core;
        var allowed = this.Sub1GrammarBeachSandMasks();
        var changed = 0;
        var next = MapGen.Layers.Clone(pChars);

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(core.GetChar(pChars, x, y, this.Chars.ground) !== this.Chars.beach)
                    continue;
                if(!this.CanPruneUnsupportedSub1BeachCharmapCell(pContext, x, y))
                    continue;

                var mask = this.Sub1BeachSandMaskAt(pContext, pChars, x, y);
                if(mask.indexOf("W") < 0 || allowed[mask])
                    continue;

                MapGen.Layers.Set(next, x, y, this.Chars.water);
                ++changed;
            }
        }

        if(changed) {
            for(var sx = 0; sx < pContext.Width; ++sx)
                pChars[sx] = next[sx];
        }

        return changed;
    };

    pJungle.Sub1GrammarBeachContourDirection = function(pContext) {
        var live = pContext && pContext.GrammarLiveTerrain ? pContext.GrammarLiveTerrain : null;

        if(!live || live.mode !== "localized_beach_river" || !live.ocean)
            return null;

        if(live.edgeSideName === "right")
            return "E";
        if(live.edgeSideName === "left")
            return "W";
        if(live.edgeSideName === "bottom")
            return "S";
        if(live.edgeSideName === "top")
            return "N";

        return null;
    };

    pJungle.Sub1OppositeContourDirection = function(pDirection) {
        if(pDirection === "E")
            return "W";
        if(pDirection === "W")
            return "E";
        if(pDirection === "S")
            return "N";
        if(pDirection === "N")
            return "S";
        return null;
    };

    pJungle.Sub1ContourDelta = function(pDirection) {
        if(pDirection === "E")
            return { x: 1, y: 0 };
        if(pDirection === "W")
            return { x: -1, y: 0 };
        if(pDirection === "S")
            return { x: 0, y: 1 };
        if(pDirection === "N")
            return { x: 0, y: -1 };
        return { x: 0, y: 0 };
    };

    pJungle.Sub1FindBeachContourSegments = function(pContext, pChars, pDirection) {
        var core = MapGen.Terrain.Smoothing.Core;
        var delta = this.Sub1ContourDelta(pDirection);
        var verticalScan = pDirection === "E" || pDirection === "W";
        var scanLimit = verticalScan ? pContext.Height : pContext.Width;
        var lineLimit = verticalScan ? pContext.Width : pContext.Height;
        var entries = [];
        var segments = [];
        var current = [];

        for(var scan = 0; scan < scanLimit; ++scan) {
            var found = false;
            var coord = 0;

            for(var line = 0; line < lineLimit; ++line) {
                var x = verticalScan ? line : scan;
                var y = verticalScan ? scan : line;

                if(core.GetChar(pChars, x, y, this.Chars.ground) !== this.Chars.beach ||
                    core.GetChar(pChars, x + delta.x, y + delta.y, this.Chars.ground) !== this.Chars.water)
                    continue;

                var value = verticalScan ? x : y;
                if(!found ||
                    ((pDirection === "E" || pDirection === "S") && value > coord) ||
                    ((pDirection === "W" || pDirection === "N") && value < coord)) {
                    coord = value;
                    found = true;
                }
            }

            if(found)
                entries.push({ scan: scan, coord: coord });
        }

        for(var index = 0; index < entries.length; ++index) {
            if(current.length && entries[index].scan !== current[current.length - 1].scan + 1) {
                segments.push(current);
                current = [];
            }
            current.push(entries[index]);
        }

        if(current.length)
            segments.push(current);

        return segments;
    };

    pJungle.Sub1GrammarBeachBankWidthProfile = function() {
        return MapGen.Terrain.Smoothing.JungleBeach.BankWidthProfile();
    };

    pJungle.Sub1FindBeachSandSpanSegments = function(pContext, pChars, pWaterDirection) {
        var core = MapGen.Terrain.Smoothing.Core;
        var verticalScan = pWaterDirection === "E" || pWaterDirection === "W";
        var scanLimit = verticalScan ? pContext.Height : pContext.Width;
        var lineLimit = verticalScan ? pContext.Width : pContext.Height;
        var entries = [];
        var segments = [];
        var current = [];

        for(var scan = 0; scan < scanLimit; ++scan) {
            var minCoord = -1;
            var maxCoord = -1;

            for(var line = 0; line < lineLimit; ++line) {
                var x = verticalScan ? line : scan;
                var y = verticalScan ? scan : line;

                if(core.GetChar(pChars, x, y, this.Chars.ground) !== this.Chars.beach)
                    continue;

                if(minCoord < 0)
                    minCoord = line;
                maxCoord = line;
            }

            if(minCoord < 0)
                continue;

            entries.push({
                scan: scan,
                grassCoord: (pWaterDirection === "E" || pWaterDirection === "S") ? minCoord : maxCoord,
                waterCoord: (pWaterDirection === "E" || pWaterDirection === "S") ? maxCoord : minCoord
            });
        }

        for(var index = 0; index < entries.length; ++index) {
            if(current.length && entries[index].scan !== current[current.length - 1].scan + 1) {
                segments.push(current);
                current = [];
            }
            current.push(entries[index]);
        }

        if(current.length)
            segments.push(current);

        return segments;
    };

    pJungle.ShapeSub1GrammarBeachGrassContour = function(pContext, pChars) {
        if(!this.UsesSub1ExplicitWaterTiles(pContext) ||
            !pContext.Profile ||
            pContext.Profile.TargetPackProfile !== "grammar_beach")
            return 0;

        var live = pContext && pContext.GrammarLiveTerrain ? pContext.GrammarLiveTerrain : null;
        if(live && (live.beachTemplate === "joined_east_coast" ||
            live.beachTemplate === "joined_south_coast"))
            return 0;

        var waterDirection = this.Sub1GrammarBeachContourDirection(pContext);
        var grassDirection = this.Sub1OppositeContourDirection(waterDirection);
        if(!grassDirection)
            return 0;

        var core = MapGen.Terrain.Smoothing.Core;
        var profile = this.Sub1GrammarBeachBankWidthProfile();
        var segments = this.Sub1FindBeachSandSpanSegments(pContext, pChars, waterDirection);
        var changed = 0;

        for(var segmentIndex = 0; segmentIndex < segments.length; ++segmentIndex) {
            var segment = segments[segmentIndex];
            if(segment.length < 8)
                continue;

            var maxIndex = Math.max(1, segment.length - 1);

            for(var index = 0; index < segment.length; ++index) {
                var profileIndex = segment.length <= profile.length ?
                    index :
                    Math.round((index / maxIndex) * (profile.length - 1));
                var targetWidth = profile[Math.max(0, Math.min(profile.length - 1, profileIndex))];
                var entry = segment[index];
                var currentCoord = entry.grassCoord;
                var lowerSide = grassDirection === "W" || grassDirection === "N";
                var targetCoord = lowerSide ?
                    entry.waterCoord - targetWidth + 1 :
                    entry.waterCoord + targetWidth - 1;
                var scan = entry.scan;
                var verticalEdge = grassDirection === "W" || grassDirection === "E";
                var rewriteToBeach = lowerSide ? targetCoord < currentCoord : targetCoord > currentCoord;
                var startCoord;
                var endCoord;
                var x;
                var y;
                var canApply;

                if(targetCoord === currentCoord)
                    continue;

                if(rewriteToBeach) {
                    startCoord = lowerSide ? targetCoord : currentCoord + 1;
                    endCoord = lowerSide ? currentCoord - 1 : targetCoord;
                }
                else {
                    startCoord = lowerSide ? currentCoord : targetCoord + 1;
                    endCoord = lowerSide ? targetCoord - 1 : currentCoord;
                }

                if(startCoord > endCoord)
                    continue;

                if(verticalEdge) {
                    y = scan;
                    canApply = true;
                    for(x = startCoord; x <= endCoord; ++x) {
                        if(core.GetChar(pChars, x, y, this.Chars.ground) !== (rewriteToBeach ? this.Chars.ground : this.Chars.beach) ||
                            !this.CanShapeSub1BeachGrassContourCell(pContext, x, y)) {
                            canApply = false;
                            break;
                        }
                    }
                    if(!canApply)
                        continue;

                    for(x = startCoord; x <= endCoord; ++x) {
                        MapGen.Layers.Set(pChars, x, y, rewriteToBeach ? this.Chars.beach : this.Chars.ground);
                        ++changed;
                    }
                }
                else {
                    x = scan;
                    canApply = true;
                    for(y = startCoord; y <= endCoord; ++y) {
                        if(core.GetChar(pChars, x, y, this.Chars.ground) !== (rewriteToBeach ? this.Chars.ground : this.Chars.beach) ||
                            !this.CanShapeSub1BeachGrassContourCell(pContext, x, y)) {
                            canApply = false;
                            break;
                        }
                    }
                    if(!canApply)
                        continue;

                    for(y = startCoord; y <= endCoord; ++y) {
                        MapGen.Layers.Set(pChars, x, y, rewriteToBeach ? this.Chars.beach : this.Chars.ground);
                        ++changed;
                    }
                }
            }
        }

        return changed;
    };

    pJungle.Sub1ContourCellForEntry = function(pEntry, pDirection) {
        if(pDirection === "E" || pDirection === "W")
            return { x: pEntry.coord, y: pEntry.scan };

        return { x: pEntry.scan, y: pEntry.coord };
    };

    pJungle.Sub1BeachInwardRunLength = function(pChars, pX, pY, pDirection) {
        var core = MapGen.Terrain.Smoothing.Core;
        var delta = this.Sub1ContourDelta(pDirection);
        var x = pX;
        var y = pY;
        var length = 0;

        while(core.GetChar(pChars, x, y, this.Chars.ground) === this.Chars.beach) {
            ++length;
            x -= delta.x;
            y -= delta.y;
        }

        return length;
    };

    pJungle.CanPullSub1BeachContourCell = function(pContext, pChars, pX, pY, pDirection) {
        var core = MapGen.Terrain.Smoothing.Core;
        var delta = this.Sub1ContourDelta(pDirection);

        if(!this.CanRewriteSub1BeachCharmapCell(pContext, pX, pY))
            return false;
        if(core.GetChar(pChars, pX, pY, this.Chars.ground) !== this.Chars.beach)
            return false;
        if(core.GetChar(pChars, pX + delta.x, pY + delta.y, this.Chars.ground) !== this.Chars.water)
            return false;

        return this.Sub1BeachInwardRunLength(pChars, pX, pY, pDirection) >= 3;
    };

    pJungle.SmoothSub1GrammarBeachContourRuns = function(pContext, pChars) {
        if(!this.UsesSub1ExplicitWaterTiles(pContext) ||
            !pContext.Profile ||
            pContext.Profile.TargetPackProfile !== "grammar_beach")
            return 0;

        var direction = this.Sub1GrammarBeachContourDirection(pContext);
        if(!direction)
            return 0;

        var maxFlatRun = 3;
        var changed = 0;

        for(var pass = 0; pass < 2; ++pass) {
            var segments = this.Sub1FindBeachContourSegments(pContext, pChars, direction);
            var passChanged = 0;

            for(var segmentIndex = 0; segmentIndex < segments.length; ++segmentIndex) {
                var segment = segments[segmentIndex];
                var runStart = 0;

                for(var index = 1; index <= segment.length; ++index) {
                    if(index < segment.length && segment[index].coord === segment[runStart].coord)
                        continue;

                    if(index - runStart > maxFlatRun) {
                        for(var pullIndex = runStart + maxFlatRun; pullIndex < index; ++pullIndex) {
                            var cell = this.Sub1ContourCellForEntry(segment[pullIndex], direction);
                            if(!this.CanPullSub1BeachContourCell(pContext, pChars, cell.x, cell.y, direction))
                                continue;

                            MapGen.Layers.Set(pChars, cell.x, cell.y, this.Chars.water);
                            ++passChanged;
                        }
                    }

                    runStart = index;
                }
            }

            if(!passChanged)
                break;

            changed += passChanged;
        }

        return changed;
    };

    pJungle.ConstrainSub1BeachCharmap = function(pContext, pChars) {
        if(!this.UsesSub1ExplicitWaterTiles(pContext) ||
            !pContext.Profile ||
            pContext.Profile.TargetPackProfile !== "grammar_beach")
            return 0;

        // This footprint was lifted from a shipped, atlas-valid sub-1 map.
        // Procedural contour repair only understands generic cardinal masks;
        // applying it here destroys the small cove neck and the intentional
        // mixed grass/sand cells before the authored tile rows can be used.
        if(pContext.GrammarLiveTerrain &&
            pContext.GrammarLiveTerrain.beachTemplate === "mapm8_corner_cove")
            return 0;

        var core = MapGen.Terrain.Smoothing.Core;
        var allowed = this.Sub1GrammarBeachSandMasks();
        var changed = 0;

        for(var pass = 0; pass < 3; ++pass) {
            var next = MapGen.Layers.Clone(pChars);
            var passChanged = 0;

            for(var x = 0; x < pContext.Width; ++x) {
                for(var y = 0; y < pContext.Height; ++y) {
                    if(core.GetChar(pChars, x, y, this.Chars.ground) !== this.Chars.beach)
                        continue;
                    if(!this.CanRewriteSub1BeachCharmapCell(pContext, x, y))
                        continue;

                    var mask = this.Sub1BeachSandMaskAt(pContext, pChars, x, y);
                    if(mask.indexOf("W") < 0 || allowed[mask])
                        continue;

                    var expanded = this.TryExpandSub1BeachMask(pContext, pChars, next, x, y, mask, allowed);
                    if(expanded > 0) {
                        passChanged += expanded;
                        continue;
                    }

                    // If nearby ground cannot be widened into a supported
                    // beach mask, remove this beach cell before tile selection.
                    MapGen.Layers.Set(next, x, y, this.Chars.water);
                    ++passChanged;
                }
            }

            if(!passChanged)
                break;

            for(var sx = 0; sx < pContext.Width; ++sx)
                pChars[sx] = next[sx];
            changed += passChanged;
        }

        changed += this.SmoothSub1GrammarBeachWaterCorners(pContext, pChars);
        changed += this.PruneUnsupportedSub1GrammarBeachMasks(pContext, pChars);
        changed += this.SmoothSub1GrammarBeachContourRuns(pContext, pChars);
        changed += this.PruneUnsupportedSub1GrammarBeachMasks(pContext, pChars);
        changed += this.ShapeSub1GrammarBeachGrassContour(pContext, pChars);
        changed += this.PruneUnsupportedSub1GrammarBeachMasks(pContext, pChars);

        return changed;
    };
})(MapGen.Terrain.Smoothing.Jungle);
