var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};
MapGen.Terrain.Smoothing.Ice = MapGen.Terrain.Smoothing.Ice || {};

(function(pIce) {
    pIce.DebugDumpFlagEnabled = function(pPath) {
        if(typeof FileIO === "undefined")
            return false;

        try {
            var flag = new FileIO(pPath, true);
            var enabled = flag.isOpen();
            if(enabled)
                flag.close();
            return enabled;
        } catch(e) {
            return false;
        }
    };

    pIce.DebugDumpsEnabled = function(pContext) {
        if(pContext && (pContext.DebugDumps || pContext.IceDebugDumps))
            return true;
        if(pContext && pContext.Profile && (pContext.Profile.DebugDumps || pContext.Profile.IceDebugDumps))
            return true;
        if(typeof Settings !== "undefined" && (Settings.MapGenDebugDumps || Settings.IceDebugDumps))
            return true;

        return this.DebugDumpFlagEnabled("mapgen_ice_debug_dumps.flag");
    };

    // Final charmap authority: shore repair, gameplay clearance, then canopy
    // normalization and unsupported-shelf removal. Tile projection follows.
    pIce.FinalizeIceCharMap = function(c, chars, data, sub, full) {
        var self = this, result = {fullTileProjection: !!full};
        function run(label, method) {
            return sub("IceRender.CC." + label, function() {
                return self[method](c, chars);
            });
        }
        function forceFullProjection() {
            c._iceRenderDirtyMask = null;
            c._iceRenderDirtyRegion = null;
            result.fullTileProjection = true;
        }
        function repairShore(prefix, limit, groundKey, iceKey) {
            result[groundKey] = result[iceKey] = 0;
            var settled = false;
            for(var pass = 0; pass < limit; ++pass) {
                var ground = run(prefix + "DirectWaterGroundRepair", "RepairDirectWaterGroundChars");
                var ice = run(prefix + "DirectWaterIceRepair", "RepairDirectWaterIceChars");
                result[groundKey] += ground;
                result[iceKey] += ice;
                if(!ground && !ice) { settled = true; break; }
            }
            if(result[groundKey] || result[iceKey]) forceFullProjection();
            return settled;
        }
        var shoreSettled = repairShore("Terminal", 3, "terminalDirectWaterGroundRepair", "terminalDirectWaterIceRepair");
        result.perimeterAtlasSeam = run("PerimeterAtlasSeam", "BridgePerimeterAtlasSeam");
        if(result.perimeterAtlasSeam) forceFullProjection();
        result.postPerimeterDirectWaterGroundRepair = result.postPerimeterDirectWaterIceRepair = 0;
        // A capped loop may still have work. Skip the duplicate scan only when
        // both repairs settled and the intervening seam pass changed nothing.
        if(!shoreSettled || result.perimeterAtlasSeam)
            repairShore("PostPerimeter", 2, "postPerimeterDirectWaterGroundRepair", "postPerimeterDirectWaterIceRepair");
        result.restoredIntentRouteChars = sub("IceRender.CC.RestoreIntentRoutes", function() {
            return self.RestoreIntentRouteChars(c, chars) +
                MapGen.Layout.Reservations.ApplyChars(c, chars) +
                MapGen.Layout.TerrainSpace.ApplyChars(c, chars);
        });
        result.terminalTreeTopSideTabTrim = run("TerminalTreeTopSideTabTrim", "TrimUnsupportedTreeTopSideTabs");
        result.terminalSmallTreeClusterPrune = run("TerminalSmallTreeClusterPrune", "PruneUnsupportedSmallTreeClusters");
        result.terminalSingletonTreeTrim = run("TerminalSingletonTreeTrim", "TrimFinalSingletonTreeChars");
        result.terminalThinTreeTopologyNormalize = 0;
        function normalizeAfter(phase) {
            var label = phase === "Thin" ? "TerminalThinTreeTopologyNormalize" :
                "TerminalPost" + phase + "TreeTopologyNormalize";
            result.terminalThinTreeTopologyNormalize += sub("IceRender.CC." + label, function() {
                return self.NormalizeIceTreeTopology(c, chars, data.treeRuntime);
            });
            result.terminalSmallTreeClusterPrune += run("TerminalPost" + phase + "SmallTreeClusterPrune", "PruneUnsupportedSmallTreeClusters");
            result.terminalSingletonTreeTrim += run("TerminalPost" + phase + "SingletonTreeTrim", "TrimFinalSingletonTreeChars");
        }
        result.terminalThinTreeRunPrune = 0;
        for(var pass = 0; pass < 4; ++pass) {
            var changed = run("TerminalThinTreeRunPrune", "PruneUnsupportedShortTreeSideColumns");
            result.terminalThinTreeRunPrune += changed;
            if(!changed) break;
            normalizeAfter("Thin");
        }
        result.terminalSlenderTreeFingerPrune = run("TerminalSlenderTreeFingerPrune", "PruneExcessSlenderTreeFingers");
        if(result.terminalSlenderTreeFingerPrune) normalizeAfter("Finger");
        result.terminalSlenderTreeIslandPrune = run("TerminalSlenderTreeIslandPrune", "PruneExcessSlenderTreeIslands");
        if(result.terminalSlenderTreeIslandPrune) normalizeAfter("Island");
        result.terminalTopEdgeTreeBaseTrim = run("TerminalTopEdgeTreeBaseTrim", "TrimDetachedTopEdgeTreeBaseChars");
        if(result.terminalTopEdgeTreeBaseTrim) normalizeAfter("TopEdge");
        // Nothing may re-normalize roles after removing unsupported shelves.
        result.terminalFlatTerminalTreeShelfPrune = run("TerminalFlatTerminalTreeShelfPrune", "PruneUnsupportedFlatTerminalTreeShelves");
        // Clearance and canopy removal can expose a new snow/water contact.
        // Reconcile the shore once those charmap writers have finished.
        result.postClearanceShoreRepair = 0;
        for(var pass = 0; pass < 2; ++pass) {
            var changed = run("PostClearanceShoreRepair", "RepairClearedShoreChars");
            result.postClearanceShoreRepair += changed;
            if(!changed) break;
        }
        if(result.postClearanceShoreRepair) forceFullProjection();
        if(result.terminalTreeTopSideTabTrim || result.terminalSmallTreeClusterPrune ||
            result.terminalSingletonTreeTrim || result.terminalThinTreeRunPrune ||
            result.terminalThinTreeTopologyNormalize || result.terminalSlenderTreeFingerPrune ||
            result.terminalSlenderTreeIslandPrune || result.terminalTopEdgeTreeBaseTrim ||
            result.terminalFlatTerminalTreeShelfPrune) forceFullProjection();
        return result;
    };

    pIce.SmoothCharMap = function(pContext, pChars, pOptions) {
        var self = this;
        var options = pOptions || {};
        var _prof = !!(pContext && pContext.ProfileTimings);
        var _profileSub = function(pLabel, pCallback) {
            if(!_prof)
                return pCallback();

            var _start = (new Date()).getTime();
            var _result = pCallback();
            var timing = { label: pLabel, ms: (new Date()).getTime() - _start };
            if(typeof _result === "number") timing.changed = _result;
            pContext.Timings.push(timing);
            return _result;
        };
        var _fixRegionPad = 8;
        var _baseDirtyRegion = options.DirtyRegion || null;
        function _expandFixRegion(pRegion) {
            if(!pRegion)
                return null;

            var region = {
                minX: Math.max(0, pRegion.minX - _fixRegionPad),
                minY: Math.max(0, pRegion.minY - _fixRegionPad),
                maxX: Math.min(pContext.Width - 1, pRegion.maxX + _fixRegionPad),
                maxY: Math.min(pContext.Height - 1, pRegion.maxY + _fixRegionPad)
            };

            if(_baseDirtyRegion) {
                region.minX = Math.max(region.minX, _baseDirtyRegion.minX);
                region.minY = Math.max(region.minY, _baseDirtyRegion.minY);
                region.maxX = Math.min(region.maxX, _baseDirtyRegion.maxX);
                region.maxY = Math.min(region.maxY, _baseDirtyRegion.maxY);
            }

            if(region.minX > region.maxX || region.minY > region.maxY)
                return null;

            return region;
        }
        function _fixOptions(pRegion) {
            var result = {};
            for(var key in options) {
                if(options.hasOwnProperty(key))
                    result[key] = options[key];
            }
            result.TrackChanges = true;
            if(pRegion)
                result.DirtyRegion = pRegion;
            return result;
        }
        function _trackedFix(pLabel, pRegion, pAllowTreeDemotion, pAllowWetPromotion) {
            var passOptions = _fixOptions(pRegion);
            passOptions.AllowTreeDemotion = pAllowTreeDemotion !== false;
            passOptions.AllowWetPromotion = pAllowWetPromotion !== false;
            var changed = _profileSub(pLabel, function() {
                return self.FixCharMap(pContext, pChars, passOptions);
            });
            return {
                changed: changed,
                nextRegion: changed > 0 ? _expandFixRegion(passOptions.ChangeRegion) : null
            };
        }

        var initialFix = _trackedFix("IceRender.CC.Smooth.FixInitial", null);
        var fixed = initialFix.changed;
        this.DumpCharMapNamed(pContext, pChars, "icecharmap_after_fix1_" + pContext.Seed + ".txt");
        // Wobble was tuned for the previous bm matcher to break up perfect 1-cell
        // diagonals into thicker bm patterns. Wang-tile edge matching picks
        // tiles by edge pixels and tolerates clean diagonals natively, so the
        // wobble noise no longer helps and actively breaks the 2-cell bank
        // ring (it scatters wet cells out into ground and pokes water into
        // bank). Disabled.
        var wobbled = 0;
        this.DumpCharMapNamed(pContext, pChars, "icecharmap_after_wobble_" + pContext.Seed + ".txt");
        var smoothed = _profileSub("IceRender.CC.Smooth.Core", function() {
            return MapGen.Terrain.Smoothing.Core.SmoothCharMap(
                pContext,
                pChars,
                [
                    { center: self.Chars.wet, ground: self.Chars.ground, next: self.Chars.path },
                    { center: self.Chars.path, ground: self.Chars.ground, next: self.Chars.tree },
                    { center: self.Chars.tree, ground: self.Chars.ground }
                ],
                function(pX, pY) {
                    return self.IsProtectedChar(pContext, pX, pY);
                },
                2,
                options
            );
        });
        this.DumpCharMapNamed(pContext, pChars, "icecharmap_after_smooth_" + pContext.Seed + ".txt");

        // Demoting a sliver removes a wet/bank neighbour that was propping up
        // an adjacent cell's ground-side count, so a single FixCharMap pass
        // can leave behind 1-bit slivers (bm patterns 00000001 / 11000000 /
        // 10010000) that the retail ice_shallow rules have no tile for.
        // Iterate to convergence with a generous safety cap. The demote is
        // monotonic (ground-side count only decreases as wet/bank neighbours
        // get demoted), so it terminates without oscillation.
        var fixRegion = null;
        for(var fixPass = 0; fixPass < 16; ++fixPass) {
            var fixResult = _trackedFix(
                "IceRender.CC.Smooth.FixIter", fixRegion, false, false);
            fixed += fixResult.changed;
            if(fixResult.changed === 0)
                break;
            fixRegion = fixResult.nextRegion;
        }

        var thinIceBandWiden = _profileSub("IceRender.CC.Smooth.ThinIceBandWiden", function() { return self.WidenUnsupportedIceWaterSnowBands(pContext, pChars, options); });
        if(thinIceBandWiden > 0) {
            var widenFixRegion = null;
            for(var widenPass = 0; widenPass < 8; ++widenPass) {
                var widenFixResult = _trackedFix(
                    "IceRender.CC.Smooth.WidenFix", widenFixRegion, false, false);
                fixed += widenFixResult.changed;
                if(widenFixResult.changed === 0)
                    break;
                widenFixRegion = widenFixResult.nextRegion;
            }
        }

        // Close thin tree-edge bays so tile assignment doesn't have to render
        // multi-row 1-cell indents that no shipped tile combination supports.
        // Re-run FixCharMap after to re-validate any newly-added tree cells.
        var bayFills = _profileSub("IceRender.CC.Smooth.TreeBays", function() { return self.FillTreeBays(pContext, pChars, options); });
        if(bayFills > 0) {
            var bayFixRegion = null;
            for(var bayPass = 0; bayPass < 4; ++bayPass) {
                var bayFixResult = _trackedFix(
                    "IceRender.CC.Smooth.BayFix", bayFixRegion, false, false);
                fixed += bayFixResult.changed;
                if(bayFixResult.changed === 0) break;
                bayFixRegion = bayFixResult.nextRegion;
            }
        }
        var treeSpurs = _profileSub("IceRender.CC.Smooth.TreeSpurs", function() { return self.TrimTreeSpurs(pContext, pChars, options); });
        MapGen.Context.AddLog(pContext, "Smoothed ice char map: fixed=" + fixed + ", smoothed=" + smoothed + ", wobbled=" + wobbled + ", thinIceBandWiden=" + thinIceBandWiden + ", bayFills=" + bayFills + ", treeSpurs=" + treeSpurs);

        return {
            fixed: fixed,
            smoothed: smoothed,
            wobbled: wobbled,
            thinIceBandWiden: thinIceBandWiden,
            treeSpurs: treeSpurs
        };
    },

    pIce.DumpCharMapNamed = function(pContext, pChars, pPath, pForce) {
        if(!pForce && !this.DebugDumpsEnabled(pContext))
            return;
        if(typeof FileIO === "undefined")
            return;
        try {
            var rows = [];
            for(var y = 0; y < pContext.Height; ++y) {
                var row = "";
                for(var x = 0; x < pContext.Width; ++x)
                    row += MapGen.Layers.Get(pChars, x, y, this.Chars.ground);
                if(row.length !== pContext.Width)
                    throw "invalid char map dump row width";
                rows.push(row);
            }
            if(rows.length !== pContext.Height)
                throw "invalid char map dump row count";

            var f = new FileIO(pPath, false);
            if(!f.isOpen()) return;
            f.writeLine("# Ice char map " + pPath);
            f.writeLine("# Chars: . water  # ground  + path  T tree  ~ bank  W wet");
            f.writeLine("# Size: " + pContext.Width + "x" + pContext.Height);
            for(var rowIndex = 0; rowIndex < rows.length; ++rowIndex)
                f.writeLine(rows[rowIndex]);
            f.close();
        } catch(e) {
            MapGen.Context.AddLog(pContext, "Failed to write char map dump: " + e);
        }
    };

    pIce.DumpCharMap = function(pContext, pChars) {
        this.DumpCharMapNamed(pContext, pChars, "icecharmap_" + pContext.Seed + ".txt",
            MapGen.Integration.DiagnosticsEnabled(pContext));
    };

    pIce.DumpTileLayerNamed = function(pContext, pTiles, pPath, pForce) {
        if(!pForce && !this.DebugDumpsEnabled(pContext))
            return;
        if(typeof FileIO === "undefined")
            return;
        try {
            var f = new FileIO(pPath, false);
            if(!f.isOpen()) return;
            f.writeLine("# Ice tile layer " + pPath);
            f.writeLine("# Size: " + pContext.Width + "x" + pContext.Height);
            f.writeLine("begin generated");
            for(var y = 0; y < pContext.Height; ++y) {
                var row = "";
                for(var x = 0; x < pContext.Width; ++x) {
                    if(x > 0)
                        row += ",";
                    row += String(MapGen.Layers.Get(pTiles, x, y, 0) & 0x1FF);
                }
                f.writeLine(row);
            }
            f.writeLine("end generated");
            f.close();
        } catch(e) {
            MapGen.Context.AddLog(pContext, "Failed to write tile layer dump: " + e);
        }
    };

    pIce.IsTreeTileProtected = function(pContext, pX, pY) {
        return this.IsOuterCoverBuffer(pContext, pX, pY) ||
            MapGen.Layers.Get(pContext.Layers.path, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.crossing, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.water, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.coast, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.riverBank, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.occupied, pX, pY, 0);
    };

    pIce.LocalRenderTileDirty = function(pContext, pX, pY) {
        var mask = pContext ? pContext._iceRenderDirtyMask : null;
        if(!mask)
            return true;
        if(pX < 0 || pY < 0 || pX >= pContext.Width || pY >= pContext.Height)
            return false;
        return mask.charAt((pY * pContext.Width) + pX) === "1";
    };

    pIce.LocalRenderBounds = function(pContext, pMargin) {
        var width = pContext ? pContext.Width : 0;
        var height = pContext ? pContext.Height : 0;
        var region = pContext ? pContext._iceRenderDirtyRegion : null;
        if(!region)
            return { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 };

        var margin = pMargin || 0;
        return {
            minX: Math.max(0, region.minX - margin),
            minY: Math.max(0, region.minY - margin),
            maxX: Math.min(width - 1, region.maxX + margin),
            maxY: Math.min(height - 1, region.maxY + margin)
        };
    };

    pIce.SplicePreviousCharsOutsideRegion = function(pContext, pChars, pPreviousChars, pDirtyRegion) {
        if(!pContext || !pChars || !pPreviousChars || !pDirtyRegion)
            return 0;

        var changed = 0;
        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(x >= pDirtyRegion.minX && x <= pDirtyRegion.maxX &&
                    y >= pDirtyRegion.minY && y <= pDirtyRegion.maxY)
                    continue;

                var previous = MapGen.Layers.Get(pPreviousChars, x, y, this.Chars.ground);
                if(MapGen.Layers.Get(pChars, x, y, this.Chars.ground) === previous)
                    continue;

                MapGen.Layers.Set(pChars, x, y, previous);
                ++changed;
            }
        }

        return changed;
    };

    pIce.OverlayProtectedTiles = function(pContext, pTiles, pChars) {
        var palette = MapGen.Terrain.TileCatalog.PaletteForTerrain(pContext.Profile.TerrainType);
        var protectedCount = 0;
        var bounds = this.LocalRenderBounds(pContext, 0);

        function isIntentRouteCell(x, y) {
            if(!pContext.IntentMap || !MapGen.Intent || !MapGen.Intent.Movement)
                return false;
            var im = pContext.IntentMap;
            if(x < 0 || y < 0 || x >= im.width || y >= im.height)
                return false;
            var move = im.movement[(y * im.width) + x] || 0;
            return !!(move & (MapGen.Intent.Movement.ROUTE_PRIMARY |
                              MapGen.Intent.Movement.ROUTE_SECONDARY));
        }

        for(var x = bounds.minX; x <= bounds.maxX; ++x) {
            for(var y = bounds.minY; y <= bounds.maxY; ++y) {
                if(!this.LocalRenderTileDirty(pContext, x, y))
                    continue;

                if(MapGen.Layers.Get(pContext.Layers.crossing, x, y, 0)) {
                    if(palette && palette.ford)
                        MapGen.Layers.Set(pTiles, x, y, MapGen.Render.PickTile(palette.ford, pContext, x, y, 41));
                    ++protectedCount;
                    continue;
                }

                var intentRoute = isIntentRouteCell(x, y);
                if(intentRoute || MapGen.Layers.Get(pContext.Layers.path, x, y, 0)) {
                    if(pChars && MapGen.Layers.Get(pChars, x, y, this.Chars.path) !== this.Chars.path)
                        continue;
                    if(this.NeedsCardinalTerrainTransition(pChars, x, y))
                        continue;

                    var pathTiles = palette && palette.grass ? palette.grass : [0, 1];
                    MapGen.Layers.Set(pTiles, x, y, MapGen.Render.PickTile(pathTiles, pContext, x, y, 42));
                    ++protectedCount;
                    continue;
                }

                if(MapGen.Layers.Get(pContext.Layers.occupied, x, y, 0) === "team_spawn") {
                    if(this.NeedsCardinalTerrainTransition(pChars, x, y))
                        continue;

                    var spawnTiles = palette && palette.grass ? palette.grass : [0, 1];
                    MapGen.Layers.Set(pTiles, x, y, MapGen.Render.PickTile(spawnTiles, pContext, x, y, 43));
                    ++protectedCount;
                }
            }
        }

        return protectedCount;
    };

    pIce.RestoreIntentRouteChars = function(pContext, pChars) {
        if(!pContext || !pContext.IntentMap || !MapGen.Intent || !MapGen.Intent.Movement)
            return 0;
        var im = pContext.IntentMap;
        var M = MapGen.Intent.Movement;
        var routeFlags = M.ROUTE_PRIMARY | M.ROUTE_SECONDARY | M.CROSSING | M.BRIDGE;
        var changed = 0;
        var bounds = this.LocalRenderBounds(pContext, 0);
        var self = this;

        function charAt(x, y) {
            return MapGen.Layers.Get(pChars, x, y, self.Chars.water);
        }

        function touchesShoreline(x, y) {
            var n = charAt(x, y - 1);
            var e = charAt(x + 1, y);
            var s = charAt(x, y + 1);
            var w = charAt(x - 1, y);
            return n === self.Chars.water || n === self.Chars.bank ||
                e === self.Chars.water || e === self.Chars.bank ||
                s === self.Chars.water || s === self.Chars.bank ||
                w === self.Chars.water || w === self.Chars.bank;
        }

        for(var y = bounds.minY; y <= bounds.maxY; ++y) {
            for(var x = bounds.minX; x <= bounds.maxX; ++x) {
                if(!this.LocalRenderTileDirty(pContext, x, y))
                    continue;
                if(x < 0 || y < 0 || x >= im.width || y >= im.height)
                    continue;

                var move = im.movement[(y * im.width) + x] || 0;
                if(!(move & routeFlags))
                    continue;

                var target = (move & (M.CROSSING | M.BRIDGE)) ?
                    this.Chars.path :
                    (touchesShoreline(x, y) ? this.Chars.wet : this.Chars.path);
                if(MapGen.Layers.Get(pChars, x, y, "") === target)
                    continue;

                MapGen.Layers.Set(pChars, x, y, target);
                ++changed;
            }
        }

        return changed;
    };

    pIce.OverlayStructurePlainAprons = function(pContext, pChars, pTiles) {
        var changed = 0;
        var bounds = this.LocalRenderBounds(pContext, 0);

        for(var x = bounds.minX; x <= bounds.maxX; ++x) {
            for(var y = bounds.minY; y <= bounds.maxY; ++y) {
                if(!this.LocalRenderTileDirty(pContext, x, y))
                    continue;

                if(MapGen.Layers.Get(pChars, x, y, "") !== this.Chars.ground)
                    continue;

                if(!this.IsStructurePlainPadCell(pContext, x, y))
                    continue;
                if(this.NeedsCardinalTerrainTransition(pChars, x, y))
                    continue;

                var tile = MapGen.Render.PickTile([0, 1], pContext, x, y, 910);
                if(MapGen.Layers.Get(pTiles, x, y, 0) === tile)
                    continue;

                MapGen.Layers.Set(pTiles, x, y, tile);
                ++changed;
            }
        }

        return changed;
    };

    pIce.BoostInteriorVariants = function(pContext, pChars, pTiles, pEdgeData) {
        if(!pEdgeData || !pEdgeData.byPrimary || !pEdgeData.tiles)
            return 0;

        var byPrimary = pEdgeData.byPrimary;
        var tilesData = pEdgeData.tiles;
        var charToClass = this.CharToClass();
        var defaultClass = charToClass["__default__"] || "snow";
        var width = pContext.Width;
        var height = pContext.Height;
        var swaps = 0;

        // A "variant" tile in IceTileEdges.js shares its primary class
        // (e.g. tile 148 is primary=ice) but its edges may bleed a
        // foreign class outward. Tile 148 has deep water on its N/W
        // edges; tile 87 has shallow on S and snow/water on W. When
        // BoostInteriorVariants placed those into a pure-ice interior
        // (all 8 neighbours wet), the water on the edges leaked into
        // neighbouring cells visually — frozen-lake cells with a
        // water/shallow patch glued to their boundary. Filter the
        // palette so a land-class interior (snow/ice) only accepts
        // variants whose edges carry no aquatic glyphs. Water primaries
        // (shallow/deep) keep the full palette.
        var forbiddenByPrimary = {
            snow: { shallow: true, deep: true },
            ice:  { shallow: true, deep: true }
        };
        var safePalettes = {};
        function edgeProfileHasForbidden(rec, forbidden) {
            if(!rec || !rec.edgeProfile)
                return true;
            var dirs = ["N", "E", "S", "W"];
            for(var i = 0; i < dirs.length; ++i) {
                var prof = rec.edgeProfile[dirs[i]];
                if(!prof)
                    continue;
                if(forbidden[prof[0]] || forbidden[prof[1]])
                    return true;
            }
            return false;
        }
        function safePalette(cls) {
            if(safePalettes[cls] !== undefined)
                return safePalettes[cls];
            var raw = byPrimary[cls] && byPrimary[cls].variant;
            var forbidden = forbiddenByPrimary[cls];
            if(!raw || !raw.length || !forbidden) {
                safePalettes[cls] = raw || null;
                return safePalettes[cls];
            }
            var filtered = [];
            for(var i = 0; i < raw.length; ++i) {
                var rec = tilesData[String(raw[i])];
                if(!edgeProfileHasForbidden(rec, forbidden))
                    filtered.push(raw[i]);
            }
            safePalettes[cls] = filtered.length ? filtered : null;
            return safePalettes[cls];
        }

        function classAt(pX, pY) {
            if(pX < 0 || pY < 0 || pX >= width || pY >= height)
                return null;
            var ch = MapGen.Layers.Get(pChars, pX, pY, "");
            if(ch === "" || ch === undefined)
                return defaultClass;
            return charToClass[ch] || defaultClass;
        }

        var offsets = [
            [-1, -1], [0, -1], [1, -1],
            [-1,  0],          [1,  0],
            [-1,  1], [0,  1], [1,  1]
        ];

        var bounds = this.LocalRenderBounds(pContext, 0);
        for(var y = bounds.minY; y <= bounds.maxY; ++y) {
            for(var x = bounds.minX; x <= bounds.maxX; ++x) {
                if(!this.LocalRenderTileDirty(pContext, x, y))
                    continue;

                var cls = classAt(x, y);
                if(!cls)
                    continue;

                var palette = safePalette(cls);
                if(!palette || !palette.length)
                    continue;

                if(this.IsTreeTileProtected(pContext, x, y))
                    continue;
                if(this.StructureGroundMaterialChar(pContext, x, y))
                    continue;

                var ch = MapGen.Layers.Get(pChars, x, y, "");
                if(ch === "T" || ch === "+")
                    continue;

                var interior = true;
                for(var index = 0; index < offsets.length; ++index) {
                    var nclass = classAt(x + offsets[index][0], y + offsets[index][1]);
                    if(nclass && nclass !== cls) {
                        interior = false;
                        break;
                    }
                }
                if(!interior)
                    continue;

                var pick = palette[MapGen.Random.HashTile(pContext.Seed || 0, x, y, 1801) % palette.length];
                if(MapGen.Layers.Get(pTiles, x, y, 0) !== pick) {
                    MapGen.Layers.Set(pTiles, x, y, pick);
                    ++swaps;
                }
            }
        }

        return swaps;
    };

    pIce.PolishFlatShallowWaterEdges = function(pContext, pChars, pTiles, pEdgeData) {
        if(!pEdgeData || !pEdgeData.byCenter || !pEdgeData.tiles)
            return 0;

        var candidates = pEdgeData.byCenter.shallow;
        if(!candidates || !candidates.length)
            return 0;

        var tilesData = pEdgeData.tiles;
        var Core = MapGen.Terrain.Smoothing.Core;
        var charToClass = this.CharToClass();
        var defaultClass = charToClass["__default__"] || "snow";
        var flatShallowDeep = { "111": true };
        var dirs = [
            { name: "N", x: 0, y: -1 },
            { name: "E", x: 1, y: 0 },
            { name: "S", x: 0, y: 1 },
            { name: "W", x: -1, y: 0 }
        ];
        var changed = 0;

        function classAt(x, y) {
            if(x < 0 || y < 0 || x >= pContext.Width || y >= pContext.Height)
                return defaultClass;
            var ch = MapGen.Layers.Get(pChars, x, y, "");
            return charToClass[ch] || defaultClass;
        }

        function countGlyph(edge, glyph) {
            var count = 0;
            for(var i = 0; i < edge.length; ++i) {
                if(edge.charAt(i) === glyph)
                    ++count;
            }
            return count;
        }

        function hasContent(rec, cls) {
            if(!rec || !rec.contents)
                return false;
            for(var i = 0; i < rec.contents.length; ++i) {
                if(rec.contents[i] === cls)
                    return true;
            }
            return false;
        }

        function matchEdges(rec) {
            return rec && (rec.terrainEdges || rec.edges);
        }

        function scoreCandidate(rec, desired) {
            var score = 0;
            var edges = matchEdges(rec);
            if(!edges)
                return -1e9;

            for(var i = 0; i < dirs.length; ++i) {
                var dir = dirs[i].name;
                var want = desired[dir];
                var edge = edges[dir];

                if(want === "e") {
                    score += countGlyph(edge, "e") * 4;
                    score -= countGlyph(edge, "W") * 3;
                    score -= countGlyph(edge, "I") * 4;
                    score -= countGlyph(edge, "S") * 12;
                }
                else {
                    var wantedCount = countGlyph(edge, want);
                    score += wantedCount * 18;
                    if(wantedCount === 0)
                        score -= 240;
                    score -= countGlyph(edge, "e") * 2;
                }
            }

            return score;
        }

        var bounds = this.LocalRenderBounds(pContext, 0);
        for(var y = bounds.minY; y <= bounds.maxY; ++y) {
            for(var x = bounds.minX; x <= bounds.maxX; ++x) {
                if(!this.LocalRenderTileDirty(pContext, x, y))
                    continue;

                if(classAt(x, y) !== "shallow")
                    continue;

                var currentId = MapGen.Layers.Get(pTiles, x, y, 0) & 0x1FF;
                if(!flatShallowDeep[String(currentId)])
                    continue;

                var desired = {};
                var neededContents = { shallow: true, deep: true };
                var deepNeighbourCount = 0;
                var unsupportedNeighbour = false;

                for(var dirIndex = 0; dirIndex < dirs.length; ++dirIndex) {
                    var dirInfo = dirs[dirIndex];
                    var cls = classAt(x + dirInfo.x, y + dirInfo.y);
                    var glyph = Core.EdgeRuleHintGlyph(cls) || "e";
                    desired[dirInfo.name] = glyph;
                    if(cls === "deep")
                        ++deepNeighbourCount;
                    else if(cls !== "shallow")
                        unsupportedNeighbour = true;
                }

                if(deepNeighbourCount !== 1 || unsupportedNeighbour)
                    continue;

                var currentRec = tilesData[String(currentId)];
                var bestId = currentId;
                var bestScore = currentRec ? scoreCandidate(currentRec, desired) : -1e9;

                for(var candIndex = 0; candIndex < candidates.length; ++candIndex) {
                    var candidateId = candidates[candIndex];
                    var rec = tilesData[String(candidateId)];
                    if(!rec || rec.center !== "shallow")
                        continue;

                    var missingContent = false;
                    for(var content in neededContents) {
                        if(neededContents.hasOwnProperty(content) && !hasContent(rec, content)) {
                            missingContent = true;
                            break;
                        }
                    }
                    if(missingContent)
                        continue;

                    var score = scoreCandidate(rec, desired);
                    if(hasContent(rec, "ice"))
                        score -= 80;
                    score += (MapGen.Random.HashTile(pContext.Seed || 0, x, y, 2301 + candidateId) & 7) * 0.001;
                    if(score > bestScore) {
                        bestScore = score;
                        bestId = candidateId;
                    }
                }

                if(bestId !== currentId) {
                    MapGen.Layers.Set(pTiles, x, y, bestId);
                    ++changed;
                }
            }
        }

        return changed;
    };

    pIce.PolishCliffWaterEdges = function(pContext, pChars, pTiles, pEdgeData) {
        if(!pEdgeData || !pEdgeData.byCenter || !pEdgeData.tiles)
            return 0;
        if(!pContext || !pContext.Cliffs || !pContext.Cliffs.length)
            return 0;

        var candidates = pEdgeData.byCenter.shallow;
        if(!candidates || !candidates.length)
            return 0;

        var tilesData = pEdgeData.tiles;
        var Core = MapGen.Terrain.Smoothing.Core;
        var charToClass = this.CharToClass();
        var defaultClass = charToClass["__default__"] || "snow";
        var cliffInfluence = {};
        var influenceRadius = 3;
        var influenceRadiusSq = influenceRadius * influenceRadius;
        var dirs = [
            { name: "N", opposite: "S", x: 0, y: -1 },
            { name: "E", opposite: "W", x: 1, y: 0 },
            { name: "S", opposite: "N", x: 0, y: 1 },
            { name: "W", opposite: "E", x: -1, y: 0 }
        ];
        var changed = 0;

        for(var cliffIndex = 0; cliffIndex < pContext.Cliffs.length; ++cliffIndex) {
            var triplets = pContext.Cliffs[cliffIndex].triplets || [];
            for(var t = 0; t < triplets.length; ++t) {
                var triplet = triplets[t];
                for(var iy = -influenceRadius; iy <= influenceRadius; ++iy) {
                    for(var ix = -influenceRadius; ix <= influenceRadius; ++ix) {
                        if((ix * ix) + (iy * iy) > influenceRadiusSq)
                            continue;
                        cliffInfluence[(triplet.x + ix) + "," + (triplet.y + iy)] = true;
                    }
                }
            }
        }

        function classAt(x, y) {
            if(x < 0 || y < 0 || x >= pContext.Width || y >= pContext.Height)
                return defaultClass;
            var ch = MapGen.Layers.Get(pChars, x, y, "");
            return charToClass[ch] || defaultClass;
        }

        function isCliffInfluenced(x, y) {
            return cliffInfluence[x + "," + y] === true;
        }

        function hasContent(rec, cls) {
            if(!rec || !rec.contents)
                return false;
            for(var i = 0; i < rec.contents.length; ++i) {
                if(rec.contents[i] === cls)
                    return true;
            }
            return false;
        }

        function countAny(edge, glyphs) {
            var count = 0;
            for(var i = 0; i < edge.length; ++i) {
                if(glyphs.indexOf(edge.charAt(i)) >= 0)
                    ++count;
            }
            return count;
        }

        function scoreEdge(edge, want, pWeight) {
            var score = 0;
            var desired = want === "S" ? "SI" : want;
            for(var i = 0; i < edge.length; ++i) {
                var c = edge.charAt(i);
                if(desired.indexOf(c) >= 0)
                    score += pWeight;
                else if(want === "S" && (c === "W" || c === "e"))
                    score -= pWeight * 3;
                else if(want === "e" && c === "S")
                    score -= pWeight * 2;
                else if(want === "W" && (c === "S" || c === "I"))
                    score -= pWeight * 2;
                else if(want === "I" && c === "W")
                    score -= pWeight * 2;
            }
            return score;
        }

        function matchEdges(rec) {
            return rec && (rec.terrainEdges || rec.edges);
        }

        var bounds = this.LocalRenderBounds(pContext, 0);
        for(var y = bounds.minY; y <= bounds.maxY; ++y) {
            for(var x = bounds.minX; x <= bounds.maxX; ++x) {
                if(!this.LocalRenderTileDirty(pContext, x, y))
                    continue;

                if(classAt(x, y) !== "shallow")
                    continue;

                var cliffDir = null;
                var deepCount = 0;
                var shallowCount = 0;

                for(var d = 0; d < dirs.length; ++d) {
                    var dir = dirs[d];
                    var nx = x + dir.x;
                    var ny = y + dir.y;
                    var ncls = classAt(nx, ny);

                    if(this.IsCliffCell(pContext, nx, ny) ||
                        (ncls === "snow" && isCliffInfluenced(nx, ny)))
                        cliffDir = dir;
                    if(ncls === "deep")
                        ++deepCount;
                    else if(ncls === "shallow")
                        ++shallowCount;
                }

                if(!cliffDir)
                    continue;
                if(deepCount + shallowCount <= 0)
                    continue;

                var currentId = MapGen.Layers.Get(pTiles, x, y, 0) & 0x1FF;
                var currentRec = tilesData[String(currentId)];
                var currentEdges = matchEdges(currentRec);
                if(currentEdges && countAny(currentEdges[cliffDir.name], "SI") >= 4)
                    continue;

                var desired = {};
                for(var di = 0; di < dirs.length; ++di) {
                    var dirInfo = dirs[di];
                    if(dirInfo.name === cliffDir.name)
                        desired[dirInfo.name] = "S";
                    else
                        desired[dirInfo.name] = Core.EdgeRuleHintGlyph(classAt(x + dirInfo.x, y + dirInfo.y)) || "e";
                }

                var bestId = currentId;
                var bestScore = -1e9;

                for(var ci = 0; ci < candidates.length; ++ci) {
                    var candidateId = candidates[ci];
                    var rec = tilesData[String(candidateId)];
                    if(!rec || rec.center !== "shallow")
                        continue;
                    if(!hasContent(rec, "shallow"))
                        continue;
                    if(deepCount > 0 && !hasContent(rec, "deep"))
                        continue;

                    var recEdges = matchEdges(rec);
                    if(!recEdges)
                        continue;

                    var cliffLand = countAny(recEdges[cliffDir.name], "SI");
                    if(cliffLand < 4)
                        continue;

                    var score = cliffLand * 80;
                    score += scoreEdge(recEdges[cliffDir.name], "S", 12);
                    for(var si = 0; si < dirs.length; ++si) {
                        var scoreDir = dirs[si].name;
                        if(scoreDir === cliffDir.name)
                            continue;
                        score += scoreEdge(recEdges[scoreDir], desired[scoreDir], 3);
                    }
                    score += (MapGen.Random.HashTile(pContext.Seed || 0, x, y, 2701 + candidateId) & 7) * 0.001;

                    if(score > bestScore) {
                        bestScore = score;
                        bestId = candidateId;
                    }
                }

                if(bestId !== currentId) {
                    MapGen.Layers.Set(pTiles, x, y, bestId);
                    ++changed;
                }
            }
        }

        return changed;
    };

    pIce.PolishIceSnowCorners = function(pContext, pChars, pTiles, pEdgeData) {
        if(!pEdgeData || !pEdgeData.byCenter || !pEdgeData.tiles)
            return 0;

        var candidates = pEdgeData.byCenter.ice;
        if(!candidates || !candidates.length)
            return 0;

        var Core = MapGen.Terrain.Smoothing.Core;
        var tilesData = pEdgeData.tiles;
        var charToClass = this.CharToClass();
        var defaultClass = charToClass["__default__"] || "snow";
        var dirs = [
            { name: "N", x: 0, y: -1 },
            { name: "E", x: 1, y: 0 },
            { name: "S", x: 0, y: 1 },
            { name: "W", x: -1, y: 0 }
        ];
        var changed = 0;

        function classAt(x, y) {
            if(x < 0 || y < 0 || x >= pContext.Width || y >= pContext.Height)
                return defaultClass;
            var ch = MapGen.Layers.Get(pChars, x, y, "");
            return charToClass[ch] || defaultClass;
        }

        function hasContent(rec, cls) {
            if(!rec || !rec.contents)
                return false;
            for(var i = 0; i < rec.contents.length; ++i) {
                if(rec.contents[i] === cls)
                    return true;
            }
            return false;
        }

        function matchEdges(rec) {
            return rec && (rec.terrainEdges || rec.edges);
        }

        function scoreCandidate(rec, x, y) {
            var score = 0;
            var edges = matchEdges(rec);
            if(!edges)
                return -1e9;
            for(var i = 0; i < dirs.length; ++i) {
                var dir = dirs[i];
                score += Core.ScoreEdgeMatch(
                    edges[dir.name],
                    null,
                    Core.EdgeRuleHintGlyph(classAt(x + dir.x, y + dir.y))
                );
            }
            return score;
        }

        function hasSnowCorner(summary) {
            return (summary.N === "snow" && summary.E === "snow") ||
                (summary.E === "snow" && summary.S === "snow") ||
                (summary.S === "snow" && summary.W === "snow") ||
                (summary.W === "snow" && summary.N === "snow");
        }

        // Loop bounds extended from 1..H-2/1..W-2 to 0..H-1/0..W-1 so the
        // map-edge rows/columns get polished. classAt() already returns
        // defaultClass ("snow") for OOB neighbours, so the existing 4-cardinal
        // scoring is well-defined at the perimeter. Without this, snow-with-
        // ice-corner cells on the four boundary rows skipped polishing and
        // could keep an inappropriate ice-center tile. RCA 2026-06-13.
        var bounds = this.LocalRenderBounds(pContext, 0);
        for(var y = Math.max(0, bounds.minY); y <= Math.min(pContext.Height - 1, bounds.maxY); ++y) {
            for(var x = Math.max(0, bounds.minX); x <= Math.min(pContext.Width - 1, bounds.maxX); ++x) {
                if(!this.LocalRenderTileDirty(pContext, x, y))
                    continue;

                if(classAt(x, y) !== "ice")
                    continue;

                var summary = {
                    N: classAt(x, y - 1),
                    E: classAt(x + 1, y),
                    S: classAt(x, y + 1),
                    W: classAt(x - 1, y)
                };
                var snowCount = 0;
                var iceCount = 0;
                var aquaticCount = 0;
                for(var s = 0; s < dirs.length; ++s) {
                    var cls = summary[dirs[s].name];
                    if(cls === "snow") ++snowCount;
                    else if(cls === "ice") ++iceCount;
                    else if(cls === "shallow" || cls === "deep") ++aquaticCount;
                }

                if(snowCount < 2 || iceCount < 1 || aquaticCount > 0 || !hasSnowCorner(summary))
                    continue;

                var currentId = MapGen.Layers.Get(pTiles, x, y, 0) & 0x1FF;
                var currentRec = tilesData[String(currentId)];
                var currentScore = currentRec ? scoreCandidate(currentRec, x, y) : -1e9;
                var bestId = currentId;
                var bestScore = currentScore;

                for(var c = 0; c < candidates.length; ++c) {
                    var candidateId = candidates[c] & 0x1FF;
                    var rec = tilesData[String(candidateId)];
                    if(!rec || rec.center !== "ice")
                        continue;
                    if(!hasContent(rec, "snow") || !hasContent(rec, "ice"))
                        continue;
                    if(hasContent(rec, "shallow") || hasContent(rec, "deep"))
                        continue;

                    var score = scoreCandidate(rec, x, y);
                    score += (MapGen.Random.HashTile(pContext.Seed || 0, x, y, 8101 + candidateId) & 7) * 0.001;
                    if(score > bestScore) {
                        bestScore = score;
                        bestId = candidateId;
                    }
                }

                if(bestId !== currentId && bestScore >= currentScore + 35) {
                    MapGen.Layers.Set(pTiles, x, y, bestId);
                    ++changed;
                }
            }
        }

        return changed;
    };

    pIce.PolishIceSnowDiagonalRuns = function(pContext, pChars, pTiles) {
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var charToClass = this.CharToClass();
        var changed = 0;

        function charClassAt(x, y) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return "snow";
            var ch = MapGen.Layers.Get(pChars, x, y, self.Chars.ground);
            return charToClass[ch] || "snow";
        }

        function isSnowClass(cls) {
            return cls === "snow";
        }

        function isIceClass(cls) {
            return cls === "ice";
        }

        function tileAt(x, y) {
            return MapGen.Layers.Get(pTiles, x, y, 0) & 0x1FF;
        }

        function isSouthEastSnowIceStep(x, y) {
            if(tileAt(x, y) !== 10)
                return false;
            return isSnowClass(charClassAt(x, y - 1)) &&
                isSnowClass(charClassAt(x + 1, y)) &&
                isIceClass(charClassAt(x, y + 1)) &&
                isIceClass(charClassAt(x - 1, y));
        }

        function polishRun(run) {
            if(run.length < 4)
                return;

            for(var index = 1; index < run.length - 1; index += 2) {
                var cell = run[index];
                if(!self.LocalRenderTileDirty(pContext, cell[0], cell[1]))
                    continue;
                if(tileAt(cell[0], cell[1]) !== 10)
                    continue;
                MapGen.Layers.Set(pTiles, cell[0], cell[1], 8);
                ++changed;
            }
        }

        var bounds = this.LocalRenderBounds(pContext, 0);
        var minDiag = bounds.minY - bounds.maxX;
        var maxDiag = bounds.maxY - bounds.minX;
        for(var startY = 1; startY < height - 1; ++startY) {
            for(var startX = 1; startX < width - 1; ++startX) {
                var diag = startY - startX;
                if(diag < minDiag || diag > maxDiag)
                    continue;
                if(isSouthEastSnowIceStep(startX - 1, startY - 1))
                    continue;
                if(!isSouthEastSnowIceStep(startX, startY))
                    continue;

                var run = [];
                var x = startX;
                var y = startY;
                while(x < width - 1 && y < height - 1 && isSouthEastSnowIceStep(x, y)) {
                    run.push([x, y]);
                    ++x;
                    ++y;
                }

                polishRun(run);
            }
        }

        return changed;
    };

    pIce.PolishPureIceInteriorNoise = function(pContext, pChars, pTiles) {
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var charToClass = this.CharToClass();
        var plainIce = [20, 33];
        var changed = 0;

        function classAt(x, y) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return "snow";
            var ch = MapGen.Layers.Get(pChars, x, y, self.Chars.ground);
            return charToClass[ch] || "snow";
        }

        function tileAt(x, y) {
            return MapGen.Layers.Get(pTiles, x, y, 0) & 0x1FF;
        }

        function isPureIceInterior(x, y) {
            if(classAt(x, y) !== "ice")
                return false;

            for(var dy = -1; dy <= 1; ++dy) {
                for(var dx = -1; dx <= 1; ++dx) {
                    if(dx === 0 && dy === 0)
                        continue;
                    if(classAt(x + dx, y + dy) !== "ice")
                        return false;
                }
            }

            return true;
        }

        var bounds = this.LocalRenderBounds(pContext, 0);
        for(var y = Math.max(1, bounds.minY); y <= Math.min(height - 2, bounds.maxY); ++y) {
            for(var x = Math.max(1, bounds.minX); x <= Math.min(width - 2, bounds.maxX); ++x) {
                if(!this.LocalRenderTileDirty(pContext, x, y))
                    continue;

                if(!isPureIceInterior(x, y))
                    continue;

                var targetIce = plainIce[MapGen.Random.HashTile(pContext.Seed || 0, x, y, 7621) % plainIce.length];
                if(tileAt(x, y) === (targetIce & 0x1FF))
                    continue;

                MapGen.Layers.Set(pTiles, x, y, targetIce);
                ++changed;
            }
        }

        return changed;
    };

    pIce.PolishPureSnowInteriorNoise = function(pContext, pChars, pTiles) {
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var charToClass = this.CharToClass();
        var plainSnow = [0, 1];
        var changed = 0;

        function classAt(x, y) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return "snow";
            var ch = MapGen.Layers.Get(pChars, x, y, self.Chars.ground);
            return charToClass[ch] || "snow";
        }

        function tileAt(x, y) {
            return MapGen.Layers.Get(pTiles, x, y, 0) & 0x1FF;
        }

        function isPureSnowInterior(x, y) {
            if(classAt(x, y) !== "snow")
                return false;

            for(var dy = -1; dy <= 1; ++dy) {
                for(var dx = -1; dx <= 1; ++dx) {
                    if(dx === 0 && dy === 0)
                        continue;
                    if(classAt(x + dx, y + dy) !== "snow")
                        return false;
                }
            }

            return true;
        }

        var bounds = this.LocalRenderBounds(pContext, 0);
        for(var y = Math.max(1, bounds.minY); y <= Math.min(height - 2, bounds.maxY); ++y) {
            for(var x = Math.max(1, bounds.minX); x <= Math.min(width - 2, bounds.maxX); ++x) {
                if(!this.LocalRenderTileDirty(pContext, x, y))
                    continue;

                if(!isPureSnowInterior(x, y))
                    continue;

                var targetSnow = plainSnow[MapGen.Random.HashTile(pContext.Seed || 0, x, y, 7627) % plainSnow.length];
                if(tileAt(x, y) === (targetSnow & 0x1FF))
                    continue;

                MapGen.Layers.Set(pTiles, x, y, targetSnow);
                ++changed;
            }
        }

        return changed;
    };

    pIce.TileContentsMask = function(pContents) {
        var mask = 0;
        if(!pContents)
            return mask;

        for(var i = 0; i < pContents.length; ++i) {
            var c = pContents[i];
            if(c === "snow") mask |= 1;
            else if(c === "ice") mask |= 2;
            else if(c === "shallow") mask |= 4;
            else if(c === "deep") mask |= 8;
        }

        return mask;
    };

    pIce.TileContentsExact = function(pRec, pRequiredContents) {
        if(!pRequiredContents || !pRequiredContents.length)
            return true;
        return this.TileContentsMask(pRec && pRec.contents) === this.TileContentsMask(pRequiredContents);
    };

    pIce.ShorelineTransitionContentsForClass = function(pClassAt, pX, pY, pCenterClass, pWidth, pHeight) {
        if(pCenterClass !== "ice" && pCenterClass !== "shallow" && pCenterClass !== "deep")
            return null;

        var hasIce = pCenterClass === "ice";
        var hasShallow = pCenterClass === "shallow";
        var hasDeep = pCenterClass === "deep";
        var hasSnow = false;
        var dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        for(var i = 0; i < dirs.length; ++i) {
            var nx = pX + dirs[i][0];
            var ny = pY + dirs[i][1];
            if(typeof pWidth === "number" && typeof pHeight === "number" &&
                (nx < 0 || ny < 0 || nx >= pWidth || ny >= pHeight))
                continue;

            var cls = pClassAt(nx, ny);
            if(cls === "ice")
                hasIce = true;
            else if(cls === "shallow")
                hasShallow = true;
            else if(cls === "deep")
                hasDeep = true;
            else if(cls === "snow")
                hasSnow = true;
        }

        if(hasSnow)
            return null;
        // 3-class case: shallow cell touching both ice AND deep neighbours.
        // Don't force `ice|shallow|deep` exact contents — the atlas has only
        // ~12 such 3-class tiles and most have a pure-ice west edge that
        // mismatches the wave shore on ice neighbours, producing visible
        // `ice piece sticking out` seams. Shipped maps use 2-class tiles
        // (149, 156, 178, etc.) at 47% of these cells because their edges
        // align better. Returning null lets EdgeRule pick by seam score
        // alone — it can still pick a 3-class tile when one fits, but it's
        // free to pick a 2-class tile when that's the better visual match.
        if(hasIce && hasShallow && hasDeep)
            return null;
        if(hasIce && hasShallow)
            return ["ice", "shallow"];
        if(hasShallow && hasDeep)
            return ["shallow", "deep"];
        return null;
    };

    pIce.PolishRepeatingShoreRuns = function(pContext, pChars, pTiles, pEdgeData) {
        if(!pEdgeData || !pEdgeData.byCenter || !pEdgeData.tiles)
            return 0;

        var Core = MapGen.Terrain.Smoothing.Core;
        var self = this;
        var tilesData = pEdgeData.tiles;
        var byCenter = pEdgeData.byCenter;
        var charToClass = this.CharToClass();
        var defaultClass = charToClass["__default__"] || "snow";
        var width = pContext.Width;
        var height = pContext.Height;
        var changed = 0;
        var pending = {};

        function classAt(x, y) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return defaultClass;
            var ch = MapGen.Layers.Get(pChars, x, y, "");
            return charToClass[ch] || defaultClass;
        }

        function tileAt(x, y) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return -1;
            return MapGen.Layers.Get(pTiles, x, y, 0) & 0x1FF;
        }

        function recAt(x, y) {
            var tile = tileAt(x, y);
            return tile >= 0 ? tilesData[String(tile)] : null;
        }

        function matchEdges(rec) {
            return rec && (rec.terrainEdges || rec.edges);
        }

        function hasAquaticNeighbour(x, y) {
            var dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
            for(var i = 0; i < dirs.length; ++i) {
                var cls = classAt(x + dirs[i][0], y + dirs[i][1]);
                if(cls === "shallow" || cls === "deep")
                    return true;
            }
            return false;
        }

        function shoreRunCell(x, y) {
            var cls = classAt(x, y);
            return (cls === "ice" || cls === "shallow") && hasAquaticNeighbour(x, y);
        }

        function edgeScoreFor(tileId, x, y) {
            var rec = tilesData[String(tileId)];
            if(!rec)
                return -1e9;

            var nrec = recAt(x, y - 1);
            var erec = recAt(x + 1, y);
            var srec = recAt(x, y + 1);
            var wrec = recAt(x - 1, y);

            var edges = matchEdges(rec);
            var nedges = matchEdges(nrec);
            var eedges = matchEdges(erec);
            var sedges = matchEdges(srec);
            var wedges = matchEdges(wrec);
            if(!edges)
                return -1e9;

            var score = 0;
            score += Core.ScoreEdgeMatch(edges.N, nedges ? nedges.S : null, nedges ? null : Core.EdgeRuleHintGlyph(classAt(x, y - 1)));
            score += Core.ScoreEdgeMatch(edges.E, eedges ? eedges.W : null, eedges ? null : Core.EdgeRuleHintGlyph(classAt(x + 1, y)));
            score += Core.ScoreEdgeMatch(edges.S, sedges ? sedges.N : null, sedges ? null : Core.EdgeRuleHintGlyph(classAt(x, y + 1)));
            score += Core.ScoreEdgeMatch(edges.W, wedges ? wedges.E : null, wedges ? null : Core.EdgeRuleHintGlyph(classAt(x - 1, y)));
            return score;
        }

        function bestAlternate(x, y, currentTile) {
            var cls = classAt(x, y);
            var candidates = byCenter[cls];
            if(!candidates || !candidates.length)
                return null;

            var currentScore = edgeScoreFor(currentTile, x, y);
            var bestScore = -1e9;
            var best = [];
            for(var i = 0; i < candidates.length; ++i) {
                var candidate = candidates[i] & 0x1FF;
                if(candidate === currentTile)
                    continue;

                var rec = tilesData[String(candidate)];
                if(!rec)
                    continue;

                // Keep center class stable. This pass is visual variation, not
                // a class repair, so reject candidates that don't carry the
                // current char-map class in their contents.
                var hasClass = false;
                for(var c = 0; c < rec.contents.length; ++c) {
                    if(rec.contents[c] === cls) {
                        hasClass = true;
                        break;
                    }
                }
                if(!hasClass)
                    continue;

                var requiredContents = self.ShorelineTransitionContentsForClass(classAt, x, y, cls, width, height);
                if(requiredContents && !self.TileContentsExact(rec, requiredContents))
                    continue;

                var score = edgeScoreFor(candidate, x, y);
                if(score < currentScore - 55)
                    continue;

                if(score > bestScore + 0.001) {
                    bestScore = score;
                    best = [candidate];
                } else if(Math.abs(score - bestScore) <= 0.001) {
                    best.push(candidate);
                }
            }

            if(!best.length)
                return null;

            var pick = MapGen.Random.HashTile(pContext.Seed || 0, x, y, 7331) % best.length;
            return best[pick];
        }

        function maybeQueue(x, y, currentTile, salt) {
            var key = x + "," + y;
            if(pending[key] !== undefined)
                return;
            if((MapGen.Random.HashTile(pContext.Seed || 0, x, y, salt) % 100) >= 55)
                return;

            var alt = bestAlternate(x, y, currentTile);
            if(alt !== null && alt !== currentTile)
                pending[key] = { x: x, y: y, tile: alt };
        }

        function scanRun(pAxis, pFixed, pStart, pEnd, pTile) {
            var len = pEnd - pStart;
            if(len < 5)
                return;

            for(var i = pStart + 1; i < pEnd - 1; ++i) {
                var x = pAxis === "h" ? i : pFixed;
                var y = pAxis === "h" ? pFixed : i;
                if(((i - pStart) % 3) !== 1)
                    continue;
                maybeQueue(x, y, pTile, pAxis === "h" ? 7332 : 7333);
            }
        }

        var bounds = this.LocalRenderBounds(pContext, 0);
        for(var y = bounds.minY; y <= bounds.maxY; ++y) {
            var runStart = -1;
            var runTile = -1;
            for(var x = 0; x <= width; ++x) {
                var valid = x < width && shoreRunCell(x, y);
                var tile = valid ? tileAt(x, y) : -1;
                if(valid && tile === runTile) {
                    // continue
                } else {
                    if(runStart >= 0)
                        scanRun("h", y, runStart, x, runTile);
                    runStart = valid ? x : -1;
                    runTile = valid ? tile : -1;
                }
            }
        }

        for(var vx = bounds.minX; vx <= bounds.maxX; ++vx) {
            var vRunStart = -1;
            var vRunTile = -1;
            for(var vy = 0; vy <= height; ++vy) {
                var vValid = vy < height && shoreRunCell(vx, vy);
                var vTile = vValid ? tileAt(vx, vy) : -1;
                if(vValid && vTile === vRunTile) {
                    // continue
                } else {
                    if(vRunStart >= 0)
                        scanRun("v", vx, vRunStart, vy, vRunTile);
                    vRunStart = vValid ? vy : -1;
                    vRunTile = vValid ? vTile : -1;
                }
            }
        }

        for(var key in pending) {
            if(!pending.hasOwnProperty(key))
                continue;
            var item = pending[key];
            if(!this.LocalRenderTileDirty(pContext, item.x, item.y))
                continue;
            if(MapGen.Layers.Get(pTiles, item.x, item.y, 0) !== item.tile) {
                MapGen.Layers.Set(pTiles, item.x, item.y, item.tile);
                ++changed;
            }
        }

        return changed;
    };

    pIce.PolishLowerShoreRuns = function(pContext, pChars, pTiles, pEdgeData) {
        if(!pEdgeData || !pEdgeData.tiles)
            return 0;

        var Core = MapGen.Terrain.Smoothing.Core;
        var tilesData = pEdgeData.tiles;
        var charToClass = this.CharToClass();
        var defaultClass = charToClass["__default__"] || "snow";
        var width = pContext.Width;
        var height = pContext.Height;
        var self = this;
        var changed = 0;
        var lowerShoreFamily = [99, 93, 99, 95, 96, 99, 93, 150, 99, 96, 93];

        function charAt(x, y) {
            return MapGen.Layers.Get(pChars, x, y, self.Chars.ground);
        }

        function classAt(x, y) {
            if(x < 0 || y < 0 || x >= width || y >= height)
                return defaultClass;

            return charToClass[charAt(x, y)] || defaultClass;
        }

        function tileAt(x, y) {
            return MapGen.Layers.Get(pTiles, x, y, 0) & 0x1FF;
        }

        function recAt(x, y) {
            var tile = tileAt(x, y);
            return tile >= 0 ? tilesData[String(tile)] : null;
        }

        function matchEdges(rec) {
            return rec && (rec.terrainEdges || rec.edges);
        }

        function edgeScoreFor(tileId, x, y) {
            var rec = tilesData[String(tileId)];
            if(!rec)
                return -1e9;

            var edges = matchEdges(rec);
            if(!edges)
                return -1e9;

            var nedges = matchEdges(recAt(x, y - 1));
            var eedges = matchEdges(recAt(x + 1, y));
            var sedges = matchEdges(recAt(x, y + 1));
            var wedges = matchEdges(recAt(x - 1, y));

            var score = 0;
            score += Core.ScoreEdgeMatch(edges.N, nedges ? nedges.S : null, nedges ? null : Core.EdgeRuleHintGlyph(classAt(x, y - 1)));
            score += Core.ScoreEdgeMatch(edges.E, eedges ? eedges.W : null, eedges ? null : Core.EdgeRuleHintGlyph(classAt(x + 1, y)));
            score += Core.ScoreEdgeMatch(edges.S, sedges ? sedges.N : null, sedges ? null : Core.EdgeRuleHintGlyph(classAt(x, y + 1)));
            score += Core.ScoreEdgeMatch(edges.W, wedges ? wedges.E : null, wedges ? null : Core.EdgeRuleHintGlyph(classAt(x - 1, y)));
            return score;
        }

        function candidateAllowed(tileId, x, y, requiredContents) {
            var rec = tilesData[String(tileId)];
            if(!rec)
                return false;

            var cls = classAt(x, y);
            if(rec.center !== cls)
                return false;

            return self.TileContentsExact(rec, requiredContents);
        }

        function isLowerShoreCell(x, y) {
            if(x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1)
                return false;

            if(charAt(x, y) !== self.Chars.wet)
                return false;
            if(charAt(x, y - 1) !== self.Chars.bank)
                return false;
            if(charAt(x, y + 1) === self.Chars.water)
                return false;

            return true;
        }

        function replacementFor(x, y, indexInRun, runStart, runEnd) {
            var current = tileAt(x, y);
            if(indexInRun <= 0 || x >= runEnd - 1)
                return current;

            var phase = MapGen.Random.HashTile(pContext.Seed || 0, runStart, y, 6113) % lowerShoreFamily.length;
            var requiredContents = self.ShorelineTransitionContentsForClass(classAt, x, y, classAt(x, y), width, height);
            var currentScore = edgeScoreFor(current, x, y);
            var leftTile = tileAt(x - 1, y);

            for(var offset = 0; offset < lowerShoreFamily.length; ++offset) {
                var pick = lowerShoreFamily[(indexInRun + phase + offset) % lowerShoreFamily.length];
                if(pick === current)
                    continue;
                if(pick === leftTile)
                    continue;
                if(!candidateAllowed(pick, x, y, requiredContents))
                    continue;
                if(edgeScoreFor(pick, x, y) < currentScore - 55)
                    continue;

                return pick;
            }

            return current;
        }

        function polishRun(y, start, end) {
            var len = end - start;
            if(len < 5)
                return;

            for(var x = start + 1; x < end - 1; ++x) {
                if(!self.LocalRenderTileDirty(pContext, x, y))
                    continue;

                var replacement = replacementFor(x, y, x - start, start, end);
                if(replacement !== tileAt(x, y)) {
                    MapGen.Layers.Set(pTiles, x, y, replacement);
                    ++changed;
                }
            }
        }

        var bounds = this.LocalRenderBounds(pContext, 0);
        for(var y = Math.max(1, bounds.minY); y <= Math.min(height - 2, bounds.maxY); ++y) {
            var start = -1;
            for(var x = 1; x <= width - 1; ++x) {
                var inRun = x < width - 1 && isLowerShoreCell(x, y);
                if(inRun) {
                    if(start < 0)
                        start = x;
                    continue;
                }

                if(start >= 0) {
                    polishRun(y, start, x);
                    start = -1;
                }
            }
        }

        return changed;
    };

    pIce.Render = function(pContext, pOptions) {
        if(pContext.Profile.TerrainType !== Terrain.Types.Ice)
            return null;

        var data = this.Data();
        if(!data)
            return null;
        var renderOptions = pOptions || {};
        pContext._iceRenderDirtyMask = renderOptions.DirtyMask || null;
        pContext._iceRenderDirtyRegion = renderOptions.DirtyRegion || null;

        // IDEMPOTENCY: un-inject the cover this renderer added on any PRIOR render
        // (perimeter runs / anti-empty open-field sectors / diagonal tree-edge fill)
        // before BuildCharMap re-reads `blocked` to seed tree chars. The render runs
        // >=2x per attempt (pipeline Render, then FlushStructureTerrain after
        // structures); without this each pass would compound the previous pass's
        // cover. No-op on the first render (marker grids empty). See ReclaimInjectedCover.
        if(!pContext._idemNegativeControl)
            this.ReclaimInjectedCover(pContext);

        // PERF MEASUREMENT (only when ProfileTimings): split the render into its three
        // cost phases so we can see char+cover (needed for validation's blocked) vs the
        // Wang matcher vs the tree/polish passes (cosmetic; candidates to skip on
        // per-attempt validation-only renders).
        var _prof = !!pContext.ProfileTimings;
        var _tPhase = _prof ? (new Date()).getTime() : 0;
        var self = this;
        var _treeStageDebug = self.DebugDumpsEnabled(pContext);
        var _treeStageCounts = [];
        function _recordTreeStage(pLabel) {
            if(!_treeStageDebug || typeof chars === "undefined" || !chars)
                return;
            if(pLabel.indexOf("IceRender.CC.") !== 0)
                return;
            var count = 0;
            for(var tx = 0; tx < pContext.Width; ++tx)
                for(var ty = 0; ty < pContext.Height; ++ty)
                    if(self.IsTreeCharValue(MapGen.Layers.Get(chars, tx, ty, "")))
                        ++count;
            _treeStageCounts.push({ stage: pLabel, trees: count });
        }
        var _profileSub = function(pLabel, pCallback) {
            var _start = _prof ? (new Date()).getTime() : 0;
            var _result = pCallback();
            if(_prof) {
                var timing = { label: pLabel, ms: (new Date()).getTime() - _start };
                if(typeof _result === "number") timing.changed = _result;
                pContext.Timings.push(timing);
            }
            _recordTreeStage(pLabel);
            return _result;
        };

        // PERF: precompute structure-proximity grids ONCE for this Render. The ~40
        // sub-passes + Wang matcher call StructureApronDistanceSq/HasNearbyStructureArt
        // per cell; without this they each rescan all placements / the engine map.
        // Rebuilt every Render (placements/art are fixed within a Render but change
        // between repair/structure re-renders), so this overwrites any stale cache.
        _profileSub("IceRender.Cache.StructureProximity", function() { return self.BuildStructureProximityCache(pContext); });

        // PERF: IsBankGroundCell/IsWetGroundCell are pure water/river-bank
        // proximity tests within a render. Build the grids once so CellChar and
        // tree apron passes don't rescan the same small discs for every cell.
        _profileSub("IceRender.Cache.TerrainProximity", function() { return self.BuildTerrainProximityCache(pContext); });
        if(_prof)
            _tPhase = (new Date()).getTime();

        var chars = this.BuildCharMap(pContext);
        MapGen.Layout.Reservations.ApplyChars(pContext, chars);
        _recordTreeStage("IceRender.CC.Build");
        this.DumpCharMapNamed(pContext, chars, "icecharmap_pre_" + pContext.Seed + ".txt");
        if(_prof) { var _ccb = (new Date()).getTime(); pContext.Timings.push({ label: "IceRender.CC.Build", ms: _ccb - _tPhase }); _tPhase = _ccb; }
        var charSmoothing = this.SmoothCharMap(pContext, chars, renderOptions);
        MapGen.Layout.Reservations.ApplyChars(pContext, chars);
        MapGen.Layout.TerrainSpace.ApplyChars(pContext, chars);
        if(_prof) { var _ccs = (new Date()).getTime(); pContext.Timings.push({ label: "IceRender.CC.Smooth", ms: _ccs - _tPhase }); _tPhase = _ccs; }
        var treeTopRepair = _profileSub("IceRender.CC.TreeTopRepair", function() { return self.RepairSupportedTreeTopGaps(pContext, chars); });
        var treeTailPrune = _profileSub("IceRender.CC.TreeTailPrune", function() { return self.PruneUnsupportedTreeTailChars(pContext, chars); });
        var treeProtrusionTrim = _profileSub("IceRender.CC.TreeProtrusionTrim", function() { return self.TrimUnsupportedTreeProtrusionChars(pContext, chars); });
        var treeTopSideTabTrim = _profileSub("IceRender.CC.TreeTopSideTabTrim", function() { return self.TrimUnsupportedTreeTopSideTabs(pContext, chars); });
        var treeConcavityRepair = _profileSub("IceRender.CC.TreeConcavityRepair", function() { return self.RepairUnsupportedTreeConcavityChars(pContext, chars); });
        var shorelinePathBlend = _profileSub("IceRender.CC.ShorelinePathBlend", function() { return self.BlendShorelinePathChars(pContext, chars); });
        var shorelineDiagonalRound = _profileSub("IceRender.CC.ShorelineDiagonalRound", function() { return self.RoundShorelineIceSnowDiagonalChars(pContext, chars); });
        var shorelineBankDiagonalRound = _profileSub("IceRender.CC.ShorelineBankDiagonalRound", function() { return self.RoundShorelineIceBankDiagonalChars(pContext, chars); });
        _profileSub("IceRender.CC.TreeSnowApron1", function() { return self.ApplyTreeSnowApronChars(pContext, chars); });
        var wetShoreBreakup = _profileSub("IceRender.CC.WetShoreBreakup", function() { return self.BreakRepeatingWetShoreBands(pContext, chars); });
        var openWaterIceStripNormalize = _profileSub("IceRender.CC.OpenWaterIceStrips", function() { return self.NormalizeOpenWaterIceStrips(pContext, chars); });
        var structureMaterialSync = _profileSub("IceRender.CC.StructureMaterialSync", function() { return self.SyncStructureGroundMaterials(pContext, chars); });
        var perimeterCharBreakup = _profileSub("IceRender.CC.PerimeterCharBreakup", function() { return self.BreakPerimeterCharRuns(pContext, chars); });
        var finalOpenFieldCover = _profileSub("IceRender.CC.FinalOpenFieldCover", function() { return self.ApplyFinalOpenFieldCover(pContext, chars); });
        var finalRouteEdgeCover = _profileSub("IceRender.CC.FinalRouteEdgeCover", function() { return self.ApplyFinalRouteEdgeCover(pContext, chars); });
        if(finalOpenFieldCover.stamped || finalRouteEdgeCover.stamped)
            _profileSub("IceRender.CC.TreeSnowApron2", function() { return self.ApplyTreeSnowApronChars(pContext, chars); });
        var directWaterGroundRepair = _profileSub("IceRender.CC.DirectWaterGroundRepair", function() { return self.RepairDirectWaterGroundChars(pContext, chars); });
        var directWaterIceRepair = _profileSub("IceRender.CC.DirectWaterIceRepair", function() { return self.RepairDirectWaterIceChars(pContext, chars); });
        var postDirectOpenWaterIceStripNormalize = (directWaterGroundRepair || directWaterIceRepair) ?
            _profileSub("IceRender.CC.PostDirectOpenWaterIceStrips", function() { return self.NormalizeOpenWaterIceStrips(pContext, chars); }) :
            0;
        var lateTreeTopSideTabTrim = (treeConcavityRepair || perimeterCharBreakup || finalOpenFieldCover.stamped || finalRouteEdgeCover.stamped) ?
            _profileSub("IceRender.CC.LateTreeTopSideTabTrim", function() { return self.TrimUnsupportedTreeTopSideTabs(pContext, chars); }) :
            0;
        var treeBottomCompletion = _profileSub("IceRender.CC.TreeBottomCompletion", function() { return self.CompleteNarrowLowerTreeBottoms(pContext, chars); });
        var lateTreeTailPrune = _profileSub("IceRender.CC.LateTreeTailPrune", function() { return self.PruneUnsupportedTreeTailChars(pContext, chars); });
        var narrowTreeTerminalRowPrune = _profileSub("IceRender.CC.NarrowTreeTerminalRowPrune", function() { return self.PruneUnsupportedNarrowTerminalTreeRows(pContext, chars); });
        var postTerminalTreeTailPrune = _profileSub("IceRender.CC.PostTerminalTreeTailPrune", function() { return self.PruneUnsupportedTreeTailChars(pContext, chars); });
        var flatTerminalTreeShelfPrune = _profileSub("IceRender.CC.FlatTerminalTreeShelfPrune", function() { return self.PruneUnsupportedFlatTerminalTreeShelves(pContext, chars); });
        var sparseTreeFragmentPrune = _profileSub("IceRender.CC.SparseTreeFragmentPrune", function() { return self.PruneUnsupportedSparseTreeFragments(pContext, chars); });
        var narrowTreeBridgePrune = _profileSub("IceRender.CC.NarrowTreeBridgePrune", function() { return self.PruneUnsupportedNarrowTreeBridges(pContext, chars); });
        var smallTreeClusterPrune = _profileSub("IceRender.CC.SmallTreeClusterPrune", function() { return self.PruneUnsupportedSmallTreeClusters(pContext, chars); });
        var diagonalTreeEdgeStairRepair = _profileSub("IceRender.CC.DiagonalTreeEdgeStairRepair", function() { return self.RepairDiagonalTreeEdgeStairChars(pContext, chars); });
        var postRepairTreeProtrusionTrim = _profileSub("IceRender.CC.PostRepairTreeProtrusionTrim", function() { return self.TrimUnsupportedTreeProtrusionChars(pContext, chars, { PreserveMarkers: true }); });
        var postDiagonalSmallTreeClusterPrune = _profileSub("IceRender.CC.PostDiagonalSmallTreeClusterPrune", function() { return self.PruneUnsupportedSmallTreeClusters(pContext, chars); });
        var protectedTreeCharPrune = _profileSub("IceRender.CC.ProtectedTreeCharPrune", function() { return self.PruneProtectedTreeChars(pContext, chars); });
        var postProtectedSmallTreeClusterPrune = protectedTreeCharPrune ?
            _profileSub("IceRender.CC.PostProtectedSmallTreeClusterPrune", function() { return self.PruneUnsupportedSmallTreeClusters(pContext, chars); }) :
            0;
        var topEdgeTreeShoulderPrune = _profileSub("IceRender.CC.TopEdgeTreeShoulderPrune", function() { return self.PruneUnsupportedTopEdgeTreeShoulders(pContext, chars); });
        var treeTopologyNormalize = _profileSub("IceRender.CC.TreeTopologyNormalize", function() { return self.NormalizeIceTreeTopology(pContext, chars, data.treeRuntime); });
        var shortTreeSideColumnPrune = _profileSub("IceRender.CC.ShortTreeSideColumnPrune", function() { return self.PruneUnsupportedShortTreeSideColumns(pContext, chars); });
        var postRoleFlatTerminalTreeShelfPrune = _profileSub("IceRender.CC.PostRoleFlatTerminalTreeShelfPrune", function() { return self.PruneUnsupportedFlatTerminalTreeShelves(pContext, chars); });
        var postRoleSparseTreeFragmentPrune = _profileSub("IceRender.CC.PostRoleSparseTreeFragmentPrune", function() { return self.PruneUnsupportedSparseTreeFragments(pContext, chars); });
        var finalTreeTopologyNormalize = (shortTreeSideColumnPrune || postRoleFlatTerminalTreeShelfPrune || postRoleSparseTreeFragmentPrune) ?
            _profileSub("IceRender.CC.FinalTreeTopologyNormalize", function() { return self.NormalizeIceTreeTopology(pContext, chars, data.treeRuntime); }) :
            0;
        var finalSmallTreeClusterPrune = (treeTopologyNormalize || finalTreeTopologyNormalize) ?
            _profileSub("IceRender.CC.FinalSmallTreeClusterPrune", function() { return self.PruneUnsupportedSmallTreeClusters(pContext, chars); }) :
            0;
        // Final singleton sweep — runs after every prune pass has had its
        // chance to demote unsupported lobe-mate cells. Any tree char that
        // is now a true singleton (no cardinal tree neighbour) gets demoted
        // regardless of perimeterCover/path/coast protection so the wang
        // matcher doesn't render orphan "tree-in-water" tiles. Catches the
        // perimeter-row singletons users reported on seed 832202380's
        // y=0 / y=H-1 / right edge after Fix 1 of 2026-06-13. RCA 2026-06-14.
        var finalSingletonTreeTrim = _profileSub("IceRender.CC.FinalSingletonTreeTrim", function() { return self.TrimFinalSingletonTreeChars(pContext, chars); });
        if(lateTreeTopSideTabTrim || treeBottomCompletion || lateTreeTailPrune || narrowTreeTerminalRowPrune || postTerminalTreeTailPrune || flatTerminalTreeShelfPrune || sparseTreeFragmentPrune || narrowTreeBridgePrune || smallTreeClusterPrune || diagonalTreeEdgeStairRepair || postRepairTreeProtrusionTrim || postDiagonalSmallTreeClusterPrune || topEdgeTreeShoulderPrune || protectedTreeCharPrune || postProtectedSmallTreeClusterPrune || treeTopologyNormalize || shortTreeSideColumnPrune || postRoleFlatTerminalTreeShelfPrune || postRoleSparseTreeFragmentPrune || finalTreeTopologyNormalize || finalSmallTreeClusterPrune || finalRouteEdgeCover.stamped || finalSingletonTreeTrim)
            _profileSub("IceRender.CC.TreeSnowApron3", function() { return self.ApplyTreeSnowApronChars(pContext, chars); });
        var finalDirectWaterIceRepair = _profileSub("IceRender.CC.FinalDirectWaterIceRepair", function() { return self.RepairDirectWaterIceChars(pContext, chars); });
        var finalShorelineBankDiagonalRound = _profileSub("IceRender.CC.FinalShorelineBankDiagonalRound", function() { return self.RoundShorelineIceBankDiagonalChars(pContext, chars); });
        var postFinalBankRoundDirectWaterIceRepair = finalShorelineBankDiagonalRound ?
            _profileSub("IceRender.CC.PostFinalBankRoundDirectWaterIceRepair", function() { return self.RepairDirectWaterIceChars(pContext, chars); }) :
            0;
        var enclosedBankNotches = 0;
        for(var enclosedBankPass = 0; enclosedBankPass < 4; ++enclosedBankPass) {
            var enclosedBankChanged = _profileSub("IceRender.CC.EnclosedBankNotches", function() {
                return self.PromoteEnclosedIceBankNotches(pContext, chars);
            });
            enclosedBankNotches += enclosedBankChanged;
            if(!enclosedBankChanged)
                break;
        }
        var iceSoftHazardBudgetChars = _profileSub("IceRender.CC.SoftHazardBudgetChars", function() { return self.ApplyIceSoftHazardBudgetChars(pContext, chars); });
        var localFlushSplicedChars = (renderOptions.DirtyRegion && renderOptions.PreviousChars) ?
            _profileSub("IceRender.CC.LocalFlushSpliceChars", function() {
                return self.SplicePreviousCharsOutsideRegion(
                    pContext, chars, renderOptions.PreviousChars, renderOptions.DirtyRegion
                );
            }) :
            0;
        var postSpliceDiagonalTreeEdgeStairRepair = localFlushSplicedChars ?
            _profileSub("IceRender.CC.PostSpliceDiagonalTreeEdgeStairRepair", function() {
                return self.RepairDiagonalTreeEdgeStairChars(pContext, chars, { IgnoreLocalBounds: true });
            }) :
            0;
        var postSpliceTreeTopologyNormalize = localFlushSplicedChars ?
            _profileSub("IceRender.CC.PostSpliceTreeTopologyNormalize", function() {
                return self.NormalizeIceTreeTopology(pContext, chars, data.treeRuntime);
            }) :
            0;
        var postSpliceSmallTreeClusterPrune = localFlushSplicedChars ?
            _profileSub("IceRender.CC.PostSpliceSmallTreeClusterPrune", function() {
                return self.PruneUnsupportedSmallTreeClusters(pContext, chars);
            }) :
            0;
        if(postSpliceDiagonalTreeEdgeStairRepair || postSpliceTreeTopologyNormalize || postSpliceSmallTreeClusterPrune)
            _profileSub("IceRender.CC.PostSpliceTreeSnowApron", function() { return self.ApplyTreeSnowApronChars(pContext, chars); });
        var fullTileProjection = false;
        if(postSpliceDiagonalTreeEdgeStairRepair || postSpliceTreeTopologyNormalize || postSpliceSmallTreeClusterPrune) {
            pContext._iceRenderDirtyMask = null;
            pContext._iceRenderDirtyRegion = null;
            fullTileProjection = true;
        }
        var finalization = this.FinalizeIceCharMap(pContext, chars, data, _profileSub, fullTileProjection);
        fullTileProjection = finalization.fullTileProjection;
        var finalRouteEdgeCoverAudit = this.AuditFinalRouteEdgeCover(pContext, chars);
        var openFieldScreenAudit = this.AuditOpenFieldScreens(pContext, chars);
        this.DumpCharMap(pContext, chars);
        if(_prof) { var _now = (new Date()).getTime(); pContext.Timings.push({ label: "IceRender.CC.TreeCover", ms: _now - _tPhase }); _tPhase = _now; }
        var tiles = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
        var structureEdgeHints = pContext.Layers && pContext.Layers.structureEdgeHints;
        var structureGroundMaterial = pContext.Layers && pContext.Layers.structureGroundMaterial;
        var charToClass = data.charToClass;
        var defaultClass = charToClass["__default__"] || "snow";
        var requiredSnowContents = ["snow"];
        var requiredSnowIceContents = ["snow", "ice"];
        var requiredIceShallowContents = ["ice", "shallow"];
        var requiredIceShallowDeepContents = ["ice", "shallow", "deep"];
        var requiredShallowDeepContents = ["shallow", "deep"];
        var requiredRuleScratch = { CenterClass: null, Contents: null };
        var requiredContentDirs = [
            [0, -1],
            [1, 0],
            [0, 1],
            [-1, 0]
        ];
        function charClassAt(pX, pY) {
            if(pX < 0 || pY < 0 || pX >= pContext.Width || pY >= pContext.Height)
                return defaultClass;

            var col = chars[pX];
            var ch = col ? col[pY] : "";
            return charToClass[ch] || defaultClass;
        }
        function shorelineTransitionContents(pX, pY, pCenterClass) {
            // Snow-center cells with at least one ice cardinal need a snow|ice
            // contents tile, otherwise the matcher emits plain snow against
            // ice with no visible shore boundary (the canonical wetIce-edge
            // family 2-19/22-25/42-45/62/63 from byContents["snow|ice"] never
            // gets picked because no contents mask is requested). At the
            // bottom-row of the map (y=H-1) with S=OOB, the artifact at seed
            // 832202380 selectedSeed 502015201 produced unbroken plain snow
            // tiles 0/1 against y=54 wet-ice. Shipped-fidelity probe over
            // mapm9/10/15/31/34 confirms 645/942 = 68% of shipped snow-with-
            // ice-cardinal cells use the snow|ice family; the remaining 32%
            // use pure-snow tiles 0/1 at positions where the ice neighbour
            // tile has 0 ice pixels on its facing edge (an ice-center tile
            // painted with snow-only edges — a layout pattern the generator
            // doesn't currently produce). For our generator the 100% snow|ice
            // rule is correct because every wet/W char neighbour DOES paint
            // ice into the shared edge.
            // Snow|shallow and snow|deep have no atlas entries (verified:
            // byContents has no "snow|shallow" or "snow|deep" keys); shipped
            // art always inserts an ice apron between snow and water, and
            // upstream terrain expansion enforces that invariant. Returning
            // null on those rare cases preserves the matcher's fallback.
            // RCA 2026-06-13: shipped-fidelity probe in
            // Tools/Probes/_audit_snow_ice_shipped.py confirms tile family.
            if(pCenterClass === "snow") {
                for(var si = 0; si < requiredContentDirs.length; ++si) {
                    var sd = requiredContentDirs[si];
                    var sx = pX + sd[0];
                    var sy = pY + sd[1];
                    if(sx < 0 || sy < 0 || sx >= pContext.Width || sy >= pContext.Height)
                        continue;
                    if(charClassAt(sx, sy) === "ice")
                        return requiredSnowIceContents;
                }
                return null;
            }
            if(pCenterClass !== "ice" && pCenterClass !== "shallow" && pCenterClass !== "deep")
                return null;

            var hasIce = pCenterClass === "ice";
            var hasShallow = pCenterClass === "shallow";
            var hasDeep = pCenterClass === "deep";
            var hasSnow = false;
            // Track the four cardinal classes individually so we can detect a
            // diagonal-step shore (two adjacent ice cardinals + two adjacent
            // aquatic cardinals — the inside of a staircase corner). At those
            // cells the canonical ice|shallow|deep contents=14 set collapses
            // to a single atlas tile (151) under aquaticIceContentOrientationAllowed,
            // which paints the full stair with one tile and produces visible
            // "ice lump" repeats. Shipped maps use plain shallow|deep tiles
            // (134/115/114/178 on mapm9's clean SE staircase) at the same
            // geometry, so admit those tiles by relaxing the contents
            // requirement to shallow|deep at diagonal-step cells.
            // RCA 2026-06-12: probe Tools/Probes/_audit_edge_scorer.py.
            var clsByDir = ["", "", "", ""];
            for(var i = 0; i < requiredContentDirs.length; ++i) {
                var dir = requiredContentDirs[i];
                var nx = pX + dir[0];
                var ny = pY + dir[1];
                if(nx < 0 || ny < 0 || nx >= pContext.Width || ny >= pContext.Height)
                    continue;

                var cls = charClassAt(nx, ny);
                clsByDir[i] = cls;
                if(cls === "ice")
                    hasIce = true;
                else if(cls === "shallow")
                    hasShallow = true;
                else if(cls === "deep")
                    hasDeep = true;
                else if(cls === "snow")
                    hasSnow = true;
            }

            if(hasSnow)
                return null;

            // Diagonal-step relaxation: at a shallow-center cell whose
            // cardinal pattern is two adjacent ice neighbours + two adjacent
            // aquatic (shallow/deep) neighbours — i.e. the inside corner of
            // a staircase where ice fills one diagonal quadrant and water
            // the other — require shallow|deep (mask 12) instead of
            // ice|shallow|deep (mask 14). The contents=14 requirement
            // collapses the candidate set under aquaticIceContentOrientationAllowed
            // to exactly one tile (151), which paints every cell of the
            // staircase with the same textured-ice corner tile and produces
            // visible "ice lump" repeats. Shipped maps use plain tiles
            // (111/114/115/134/178) at THIS exact pattern; tile 151 in
            // shipped maps appears at the OFF-BY-ONE outer-shallow cell
            // (cardinals like N=shallow E=deep S=deep W=ice), which is
            // NOT matched by this gate so still gets contents=14. Audit
            // of 28 tile-151 occurrences across mapm9/10/15/31/34 confirms:
            // 10/28 are the off-by-one outer-shallow position (kept as 14),
            // 18/28 are the inner-shallow position our gate catches. The
            // relaxation moves the inner cells off 151 and onto plain tiles,
            // matching shipped placement exactly.
            // Only fires at shallow-center cells; ice and deep cells keep
            // their original contracts. The cardinals are indexed in
            // requiredContentDirs order: N, E, S, W.
            // RCA 2026-06-12: probe Tools/Probes/_audit_edge_scorer.py.
            if(pCenterClass === "shallow" && hasIce && hasShallow && hasDeep) {
                var cN = clsByDir[0], cE = clsByDir[1], cS = clsByDir[2], cW = clsByDir[3];
                function isAquatic(c) { return c === "shallow" || c === "deep"; }
                var nwCorner = cN === "ice" && cW === "ice" && isAquatic(cE) && isAquatic(cS);
                var neCorner = cN === "ice" && cE === "ice" && isAquatic(cW) && isAquatic(cS);
                var swCorner = cS === "ice" && cW === "ice" && isAquatic(cN) && isAquatic(cE);
                var seCorner = cS === "ice" && cE === "ice" && isAquatic(cN) && isAquatic(cW);
                if(nwCorner || neCorner || swCorner || seCorner)
                    return requiredShallowDeepContents;
            }

            if(hasIce && hasShallow && hasDeep)
                return requiredIceShallowDeepContents;
            if(hasIce && hasShallow)
                return requiredIceShallowContents;
            if(hasShallow && hasDeep)
                return requiredShallowDeepContents;
            return null;
        }
        var edgeHintAt = function(pX, pY, pDirection) {
            var hints = structureEdgeHints ? MapGen.Layers.Get(structureEdgeHints, pX, pY, null) : null;
            return hints && hints[pDirection] ? hints[pDirection] : null;
        };
        var requiredRuleAt = function(pX, pY) {
            var col = chars[pX];
            var ch = col ? col[pY] : "";
            var centerClass = null;
            var contents = null;
            var charClass = charToClass[ch] || defaultClass;

            if(ch === self.Chars.path) {
                requiredRuleScratch.CenterClass = "snow";
                requiredRuleScratch.Contents = self.NeedsCardinalTerrainTransition(chars, pX, pY) ? null : requiredSnowContents;
                return requiredRuleScratch;
            }

            var isGround = ch === self.Chars.ground;
            var fixedSnowCenter = self.IsCliffCell(pContext, pX, pY) ||
                self.IsCliffTopApronCell(pContext, pX, pY) ||
                self.IsTreeApronCharCell(chars, pX, pY);
            if(fixedSnowCenter)
                centerClass = "snow";

            var material = structureGroundMaterial ? MapGen.Layers.Get(structureGroundMaterial, pX, pY, "") : "";
            var distSq = isGround ? self.StructureApronDistanceSq(pContext, pX, pY) : -1;
            if((material === "snow" && isGround) ||
                (isGround && self.HasNearbyStructureArt(pContext, pX, pY, 3)) ||
                (distSq >= 0 && distSq <= 9))
                centerClass = "snow";
            if(!centerClass && material === "ice" && ch === self.Chars.wet)
                centerClass = "ice";

            // Tree/cliff aprons retain a snow center, but still need the
            // snow/ice boundary when a shoreline reaches the apron.
            if(isGround && fixedSnowCenter && !self.NeedsCardinalTerrainTransition(chars, pX, pY))
                contents = requiredSnowContents;
            else if(!self.NeedsCardinalTerrainTransition(chars, pX, pY) &&
                ((isGround && self.IsStructurePlainGround(pContext, pX, pY)) ||
                    (isGround && self.IsStructurePlainPadCell(pContext, pX, pY)) ||
                    (distSq >= 0 && distSq <= 4)))
                contents = requiredSnowContents;
            else
                contents = shorelineTransitionContents(pX, pY, charClass);

            requiredRuleScratch.CenterClass = centerClass;
            requiredRuleScratch.Contents = contents;
            return requiredRuleScratch;
        };
        var transitionCount = MapGen.Terrain.Smoothing.Core.ApplyEdgeRule(
            pContext, chars, tiles, data.edges, data.charToClass, {
                EdgeHintAt: edgeHintAt,
                RequiredRuleAt: requiredRuleAt,
                DirtyMask: renderOptions.DirtyMask,
                DirtyRegion: renderOptions.DirtyRegion,
                PreviousTiles: renderOptions.PreviousTiles
            }
        );
        this.DumpTileLayerNamed(pContext, tiles, "icetiles_after_edgerule_" + pContext.Seed + ".txt");
        if(_prof) { var _now2 = (new Date()).getTime(); pContext.Timings.push({ label: "IceRender.EdgeRule", ms: _now2 - _tPhase }); _tPhase = _now2; }
        var interiorVariantSwaps = _profileSub("IceRender.Polish.InteriorVariants", function() { return self.BoostInteriorVariants(pContext, chars, tiles, data.edges); });
        var shallowWaterEdgePolish = _profileSub("IceRender.Polish.FlatShallowWaterEdges", function() { return self.PolishFlatShallowWaterEdges(pContext, chars, tiles, data.edges); });
        var cliffWaterEdgePolish = _profileSub("IceRender.Polish.CliffWaterEdges", function() { return self.PolishCliffWaterEdges(pContext, chars, tiles, data.edges); });
        var iceSnowCornerPolish = _profileSub("IceRender.Polish.IceSnowCorners", function() { return self.PolishIceSnowCorners(pContext, chars, tiles, data.edges); });
        var iceSnowDiagonalPolish = _profileSub("IceRender.Polish.IceSnowDiagonalRuns", function() { return self.PolishIceSnowDiagonalRuns(pContext, chars, tiles); });
        var pureIceInteriorPolish = _profileSub("IceRender.Polish.PureIceInterior", function() { return self.PolishPureIceInteriorNoise(pContext, chars, tiles); });
        var pureSnowInteriorPolish = _profileSub("IceRender.Polish.PureSnowInterior", function() { return self.PolishPureSnowInteriorNoise(pContext, chars, tiles); });
        var repeatingShorePolish = _profileSub("IceRender.Polish.RepeatingShoreRuns", function() { return self.PolishRepeatingShoreRuns(pContext, chars, tiles, data.edges); });
        this.DumpTileLayerNamed(pContext, tiles, "icetiles_after_repeating_shore_" + pContext.Seed + ".txt");
        var lowerShorePolish = _profileSub("IceRender.Polish.LowerShoreRuns", function() { return self.PolishLowerShoreRuns(pContext, chars, tiles, data.edges); });
        this.DumpTileLayerNamed(pContext, tiles, "icetiles_after_lower_shore_" + pContext.Seed + ".txt");
        var protectFn = function(pX, pY) {
            var finalChar = MapGen.Layers.Get(chars, pX, pY, "");
            if(pContext.Layers.trimmedTreeProtrusion &&
                MapGen.Layers.Get(pContext.Layers.trimmedTreeProtrusion, pX, pY, 0) &&
                !self.IsTreeCharValue(finalChar))
                return true;
            if(self.IsTreeCharValue(finalChar)) {
                var occupied = MapGen.Layers.Get(pContext.Layers.occupied, pX, pY, 0);
                if(MapGen.Layers.Get(pContext.Layers.perimeterCover, pX, pY, 0))
                    return MapGen.Layers.Get(pContext.Layers.crossing, pX, pY, 0) ||
                        MapGen.Layers.Get(pContext.Layers.water, pX, pY, 0) ||
                        (occupied && occupied !== "live_structure_clearance");
                return self.IsOuterCoverBuffer(pContext, pX, pY) ||
                    MapGen.Layers.Get(pContext.Layers.path, pX, pY, 0) ||
                    MapGen.Layers.Get(pContext.Layers.crossing, pX, pY, 0) ||
                    MapGen.Layers.Get(pContext.Layers.water, pX, pY, 0) ||
                    (occupied && occupied !== "live_structure_clearance");
            }
            return self.IsTreeTileProtected(pContext, pX, pY);
        };
        var localProtectFn = function(pX, pY) {
            if(!self.LocalRenderTileDirty(pContext, pX, pY))
                return true;
            return protectFn(pX, pY);
        };
        var treeCount = _profileSub("IceRender.Polish.TreeColumns", function() {
            return self.ApplyTreeColumns(
                pContext, chars, tiles, data.treeRuntime, localProtectFn, data.treeGroundBoundary
            );
        });
        var polishCount = 0;

        if(MapGen.Terrain.TilePolish)
            polishCount = _profileSub("IceRender.Polish.MicroStamps", function() { return MapGen.Terrain.TilePolish.Apply(pContext, chars, tiles); });
        var structurePlainAprons = _profileSub("IceRender.Polish.StructurePlainAprons", function() { return self.OverlayStructurePlainAprons(pContext, chars, tiles); });
        var protectedCount = _profileSub("IceRender.Polish.ProtectedTiles", function() { return self.OverlayProtectedTiles(pContext, tiles, chars); });
        var treeBoundaryGapPolish = _profileSub("IceRender.Polish.TreeBoundaryGaps", function() {
            return self.PolishTreeGroundBoundaryGaps(
                pContext, chars, tiles, data.treeGroundBoundary
            );
        });
        var unpaintedTreeRepair = _profileSub("IceRender.Polish.UnpaintedTreeRepair", function() {
            return self.RepairUnpaintedTreeChars(
                pContext, chars, tiles, data.treeRuntime, data.treeGroundBoundary
            );
        });
        var finalTreeContextPolish = _profileSub("IceRender.Polish.FinalTreeContext", function() { return self.PolishFinalTreeContextTiles(pContext, chars, tiles); });

        // Drop the per-Render proximity caches so they never leak into a later Render
        // with different placements/art or terrain layers (each Render rebuilds them).
        this.ClearStructureProximityCache(pContext);
        this.ClearTerrainProximityCache(pContext);
        pContext._iceRenderDirtyMask = null;
        pContext._iceRenderDirtyRegion = null;

        if(_prof) pContext.Timings.push({ label: "IceRender.Polish", ms: (new Date()).getTime() - _tPhase });

        return {
            Tiles: tiles,
            Chars: chars,
            Backend: "ice_edges",
            CharFixes: charSmoothing.fixed,
            CharSmoothChanges: charSmoothing.smoothed,
            WetShoreBreakup: wetShoreBreakup,
            OpenWaterIceStripNormalize: openWaterIceStripNormalize,
            TransitionTiles: transitionCount,
            TerrainTransitionTiles: transitionCount,
            TreeTiles: treeCount,
            TreeStageCounts: _treeStageCounts,
            TreeTopRepair: treeTopRepair,
            TreeTailPrune: treeTailPrune,
            LateTreeTailPrune: lateTreeTailPrune,
            NarrowTreeTerminalRowPrune: narrowTreeTerminalRowPrune,
            PostTerminalTreeTailPrune: postTerminalTreeTailPrune,
            FlatTerminalTreeShelfPrune: flatTerminalTreeShelfPrune,
            SparseTreeFragmentPrune: sparseTreeFragmentPrune,
            PostRoleFlatTerminalTreeShelfPrune: postRoleFlatTerminalTreeShelfPrune,
            PostRoleSparseTreeFragmentPrune: postRoleSparseTreeFragmentPrune,
            NarrowTreeBridgePrune: narrowTreeBridgePrune,
            SmallTreeClusterPrune: smallTreeClusterPrune,
            PostDiagonalSmallTreeClusterPrune: postDiagonalSmallTreeClusterPrune,
            PostSpliceDiagonalTreeEdgeStairRepair: postSpliceDiagonalTreeEdgeStairRepair,
            PostSpliceTreeTopologyNormalize: postSpliceTreeTopologyNormalize,
            TopEdgeTreeShoulderPrune: topEdgeTreeShoulderPrune,
            ProtectedTreeCharPrune: protectedTreeCharPrune,
            PostProtectedSmallTreeClusterPrune: postProtectedSmallTreeClusterPrune,
            TerminalFlatTerminalTreeShelfPrune: finalization.terminalFlatTerminalTreeShelfPrune,
            TerminalSmallTreeClusterPrune: finalization.terminalSmallTreeClusterPrune,
            TerminalSingletonTreeTrim: finalization.terminalSingletonTreeTrim,
            TerminalThinTreeRunPrune: finalization.terminalThinTreeRunPrune,
            TerminalThinTreeTopologyNormalize: finalization.terminalThinTreeTopologyNormalize,
            TerminalSlenderTreeFingerPrune: finalization.terminalSlenderTreeFingerPrune,
            TerminalSlenderTreeIslandPrune: finalization.terminalSlenderTreeIslandPrune,
            TerminalTopEdgeTreeBaseTrim: finalization.terminalTopEdgeTreeBaseTrim,
            TreeProtrusionTrim: treeProtrusionTrim,
            PostRepairTreeProtrusionTrim: postRepairTreeProtrusionTrim,
            TreeTopSideTabTrim: treeTopSideTabTrim,
            LateTreeTopSideTabTrim: lateTreeTopSideTabTrim,
            TreeBottomCompletion: treeBottomCompletion,
            TreeTopologyNormalize: treeTopologyNormalize,
            FinalTreeTopologyNormalize: finalTreeTopologyNormalize,
            ShortTreeSideColumnPrune: shortTreeSideColumnPrune,
            IceTreeStyle: pContext.IceTreeStyle || null,
            TreeConcavityRepair: treeConcavityRepair,
            ShorelinePathBlend: shorelinePathBlend,
            ShorelineDiagonalRound: shorelineDiagonalRound,
            ShorelineBankDiagonalRound: shorelineBankDiagonalRound,
            PerimeterCharBreakup: perimeterCharBreakup,
            RestoredIntentRouteChars: finalization.restoredIntentRouteChars,
            ProtectedTiles: protectedCount,
            PolishTiles: polishCount,
            TreeBoundaryGapPolish: treeBoundaryGapPolish,
            UnpaintedTreeRepair: unpaintedTreeRepair,
            FinalTreeContextPolish: finalTreeContextPolish,
            StructurePlainAprons: structurePlainAprons,
            DirectWaterGroundRepair: directWaterGroundRepair,
            DirectWaterIceRepair: directWaterIceRepair,
            FinalDirectWaterIceRepair: finalDirectWaterIceRepair,
            TerminalDirectWaterGroundRepair: finalization.terminalDirectWaterGroundRepair,
            TerminalDirectWaterIceRepair: finalization.terminalDirectWaterIceRepair,
            PostPerimeterDirectWaterGroundRepair: finalization.postPerimeterDirectWaterGroundRepair,
            PostPerimeterDirectWaterIceRepair: finalization.postPerimeterDirectWaterIceRepair,
            PostClearanceShoreRepair: finalization.postClearanceShoreRepair,
            FinalShorelineBankDiagonalRound: finalShorelineBankDiagonalRound,
            PostFinalBankRoundDirectWaterIceRepair: postFinalBankRoundDirectWaterIceRepair,
            PostDirectOpenWaterIceStripNormalize: postDirectOpenWaterIceStripNormalize,
            EnclosedBankNotches: enclosedBankNotches,
            IceSoftHazardBudgetChars: iceSoftHazardBudgetChars,
            LocalFlushSplicedChars: localFlushSplicedChars,
            FullTileProjection: fullTileProjection,
            FinalOpenFieldCover: finalOpenFieldCover,
            FinalRouteEdgeCover: finalRouteEdgeCover,
            FinalRouteEdgeCoverAudit: finalRouteEdgeCoverAudit,
            OpenFieldScreenAudit: openFieldScreenAudit,
            StructureMaterialSync: structureMaterialSync,
            ShallowWaterEdgePolish: shallowWaterEdgePolish,
            CliffWaterEdgePolish: cliffWaterEdgePolish,
            IceSnowCornerPolish: iceSnowCornerPolish,
            IceSnowDiagonalPolish: iceSnowDiagonalPolish,
            PureIceInteriorPolish: pureIceInteriorPolish,
            PureSnowInteriorPolish: pureSnowInteriorPolish,
            RepeatingShorePolish: repeatingShorePolish,
            LowerShorePolish: lowerShorePolish,
            InteriorVariantSwaps: interiorVariantSwaps
        };
    };
})(MapGen.Terrain.Smoothing.Ice);
