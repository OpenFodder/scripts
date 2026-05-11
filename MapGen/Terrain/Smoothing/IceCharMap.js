var MapGen = MapGen || {};
MapGen.Terrain = MapGen.Terrain || {};
MapGen.Terrain.Smoothing = MapGen.Terrain.Smoothing || {};
MapGen.Terrain.Smoothing.Ice = MapGen.Terrain.Smoothing.Ice || {};

(function(pIce) {
    // Phase 3 P3.7: IntentMap-direct CellChar for v3 path.
    //
    // Per OpenFodder_Map_Generator_Rewrite_Design_v3.4.md §3.6: the renderer
    // reads IntentMap directly, not the legacy Layers projection. This
    // function is the v3 char-map producer; CellChar (below) is the v1
    // path. BuildCharMap dispatches based on whether pContext.IntentMap is
    // set.
    //
    // Per-cell precedence (highest priority first):
    //   movement.CROSSING / BRIDGE      -> path char (bridges + ford tiles)
    //   movement.ROUTE_PRIMARY/SECONDARY -> path char (route corridor walkable)
    //   terrain.WATER / RIVER           -> water char
    //   terrain.RIVERBANK               -> bank char
    //   terrain.CLIFF_BODY / CLIFF_TOP  -> ground char (engine renders cliff art)
    //   terrain.FOREST                  -> Cover.Build materialized char
    //   terrain.OUTCROP                 -> tree char (engine renders rock cluster)
    //   terrain.COAST                   -> bank char
    //   movement.KEEP_CLEAR             -> wet/ground char (walkable open)
    //   claim.STRUCT_FLOOR / COMPOUND   -> ground char (compound interior)
    //   claim.STRUCT_WALL               -> tree char (renders as obstacle)
    //   default                         -> ground char (open snow)
    pIce.CellCharFromIntent = function(pContext, pX, pY) {
        if(typeof MapGen.Intent === "undefined" || !pContext.IntentMap) {
            return null;
        }
        var im = pContext.IntentMap;
        var W = im.width;
        var H = im.height;
        if(pX < 0 || pY < 0 || pX >= W || pY >= H) {
            return this.Chars.water;
        }
        var i = (pY * W) + pX;
        var t = im.terrain[i];
        var move = im.movement[i];
        var claim = im.claim[i];

        var T = MapGen.Intent.Terrain;
        var M = MapGen.Intent.Movement;
        var C = MapGen.Intent.Claim;
        var layers = pContext.Layers || {};
        var layerWater = MapGen.Layers.Get(layers.water, pX, pY, 0);

        if(move & (M.CROSSING | M.BRIDGE)) {
            return this.Chars.path;
        }
        if(move & (M.ROUTE_PRIMARY | M.ROUTE_SECONDARY)) {
            return this.Chars.path;
        }
        // Cliff art is overlaid after the char-map pass. Its footprint must
        // therefore be classified as ground before the generic legacy
        // `blocked => tree` bridge below. Otherwise CLIFF cells become tree
        // chars and the late tree-polish pass is allowed to replace already
        // painted cliff columns with canopy/ground tiles.
        if(this.IsCliffCell(pContext, pX, pY)) {
            return this.Chars.ground;
        }
        // Cover.Build and repair passes operate on legacy Layers after the
        // IntentMap is authored. Trust the committed layer-water plane here;
        // stale IntentMap WATER must not hide non-water blocked cover.
        if(pContext.Layers &&
            MapGen.Layers.Get(layers.blocked, pX, pY, 0) &&
            !layerWater &&
            !(claim & (C.SPAWN_SAFE | C.OBJECTIVE | C.STRUCT_FLOOR | C.COMPOUND))) {
            return this.Chars.tree;
        }
        if((t === T.WATER || t === T.RIVER) && layerWater) {
            return this.Chars.water;
        }
        if(t === T.RIVERBANK) {
            return this.Chars.bank;
        }
        if(t === T.CLIFF_BODY || t === T.CLIFF_TOP) {
            // Cliff cells render as ground in the char map; the cliff's
            // OWN tile selection happens in the post-CellChar overlay
            // pass per Render.js cliff overlay block.
            return this.Chars.ground;
        }
        // FOREST is semantic cover intent. Cover.Build materializes the
        // subset that has a renderable tree shape into Layers.blocked, which
        // was handled above. A raw IntentMap FOREST cell that was not selected
        // must continue through the normal shoreline/ground material rules.
        if(t === T.OUTCROP) {
            return this.Chars.tree;
        }
        if(t === T.COAST) {
            return this.Chars.bank;
        }
        if(claim & (C.STRUCT_FLOOR | C.COMPOUND)) {
            return this.Chars.ground;
        }
        if(claim & C.STRUCT_WALL) {
            return this.Chars.tree;
        }
        if((move & M.BLOCKED) && t !== T.FOREST) {
            return this.Chars.tree;
        }

        if(move & M.KEEP_CLEAR) {
            // KEEP_CLEAR is still walkable open terrain, but it must not
            // suppress the derived ice shoreline apron. Without this, v3
            // maps render direct snow/path-to-water seams because the
            // IntentMap branch returns before legacy CellChar can apply
            // IsBankGroundCell/IsWetGroundCell.
            if(!MapGen.Layers.Get(layers.occupied, pX, pY, 0) &&
                this.IsWetGroundCell(pContext, pX, pY))
                return this.Chars.wet;
            return this.Chars.ground;
        }
        // Fall through to v1 layer-based logic for cells that the IntentMap
        // doesn't claim. This is what lets v1's Cover.Build pipeline (called
        // from Pipeline.js step 6.8) populate the LAND with v1-shape trees:
        // ApplyTreeMask + ApplyPostPlacementCover + ApplyPerimeterCover all
        // write into pContext.Layers.blocked, NOT into IntentMap.terrain.
        // Without this fallback the v1 cover stamps render as snow ground.
        if(MapGen.Layers.Get(layers.riverBank, pX, pY, 0) &&
            this.IsBankGroundCell(pContext, pX, pY))
            return this.Chars.bank;
        if(MapGen.Layers.Get(layers.forcedBank, pX, pY, 0))
            return this.Chars.bank;
        if(this.IsBankGroundCell(pContext, pX, pY))
            return this.Chars.bank;
        if(this.IsWetGroundCell(pContext, pX, pY))
            return this.Chars.wet;
        return this.Chars.ground;
    };

    pIce.CellChar = function(pContext, pX, pY) {
        // Phase 3 P3.7 dispatch: when running the v3 path with an IntentMap
        // attached, read IntentMap directly. Falls through to v1 Layers-
        // based CellChar otherwise.
        if(pContext.IntentMap && this.CellCharFromIntent) {
            var c = this.CellCharFromIntent(pContext, pX, pY);
            if(c !== null) { return c; }
        }
        var layers = pContext.Layers;

        if(MapGen.Layers.Get(layers.crossing, pX, pY, 0))
            return this.Chars.path;

        if(this.IsPathIceEdgeCell(pContext, pX, pY))
            return this.Chars.wet;

        // Validation and A* treat route cells as walkable before shoreline
        // bands. Preserve that contract in the saved tile layer so a validated
        // path cannot later be painted as shallow/deep water by ice smoothing.
        if(MapGen.Layers.Get(layers.path, pX, pY, 0))
            return this.Chars.path;

        if(MapGen.Layers.Get(layers.keepClear, pX, pY, 0) &&
            MapGen.Layers.Get(layers.water, pX, pY, 0))
            return this.Chars.wet;

        if(MapGen.Layers.Get(layers.water, pX, pY, 0))
            return this.Chars.water;

        if(this.IsCliffCell(pContext, pX, pY))
            return this.Chars.ground;

        if(this.IsCliffTopApronCell(pContext, pX, pY))
            return this.Chars.ground;

        if(this.IsCliffFootApronCell(pContext, pX, pY))
            return this.Chars.ground;

        var structureMaterial = this.StructureGroundMaterialChar(pContext, pX, pY);
        if(structureMaterial)
            return structureMaterial;

        if(MapGen.Layers.Get(layers.structureGround, pX, pY, 0))
            return this.Chars.ground;

        if(MapGen.Layers.Get(layers.keepClear, pX, pY, 0)) {
            // keepClear prevents cover, but it should not flatten the derived
            // wet apron around ice ponds; real blockers were handled above.
            if(!MapGen.Layers.Get(layers.occupied, pX, pY, 0) &&
                this.IsWetGroundCell(pContext, pX, pY))
                return this.Chars.wet;
            return this.Chars.ground;
        }

        if(MapGen.Layers.Get(layers.blocked, pX, pY, 0) &&
            MapGen.Layers.Get(layers.structureContextCover, pX, pY, 0) &&
            !MapGen.Layers.Get(layers.occupied, pX, pY, 0))
            return this.Chars.tree;

        if(layers.owner) {
            var owner = MapGen.Layers.Get(layers.owner, pX, pY, 0);
            if(owner > MapGen.Layers.Owner.TREE)
                return this.Chars.ground;
        }

        if(MapGen.Layers.Get(layers.blocked, pX, pY, 0) &&
            MapGen.Layers.Get(layers.perimeterCover, pX, pY, 0))
            return this.Chars.tree;

        if(MapGen.Layers.Get(layers.riverBank, pX, pY, 0) &&
            this.IsBankGroundCell(pContext, pX, pY))
            return this.Chars.bank;

        if(this.IsBankGroundCell(pContext, pX, pY))
            return this.Chars.bank;

        // forcedBank widens the ~ ring horizontally at diagonal step rows so
        // paired ice_shallow tiles (82+83 / 82+84) can place. See Water.WidenStepBanks.
        if(MapGen.Layers.Get(layers.forcedBank, pX, pY, 0))
            return this.Chars.bank;

        if(this.IsTreeApronGroundCell(pContext, pX, pY))
            return this.Chars.ground;

        if(this.IsWetGroundCell(pContext, pX, pY))
            return this.Chars.wet;

        if(MapGen.Layers.Get(layers.coast, pX, pY, 0))
            return this.Chars.path;

        if(MapGen.Layers.Get(layers.path, pX, pY, 0))
            return this.Chars.path;

        var occupied = MapGen.Layers.Get(layers.occupied, pX, pY, 0);
        if(occupied && occupied !== "live_structure_clearance")
            return this.Chars.ground;

        if(MapGen.Layers.Get(layers.blocked, pX, pY, 0))
            return this.Chars.tree;

        if(MapGen.Layers.Get(layers.terrainEdge, pX, pY, 0))
            return this.Chars.path;

        return this.Chars.ground;
    };

    pIce.BuildCharMap = function(pContext) {
        var self = this;
        var _prof = !!(pContext && pContext.ProfileTimings);
        var _profileSub = function(pLabel, pCallback) {
            if(!_prof)
                return pCallback();

            var _start = (new Date()).getTime();
            var _result = pCallback();
            pContext.Timings.push({ label: pLabel, ms: (new Date()).getTime() - _start });
            return _result;
        };
        var chars = MapGen.Layers.Create(pContext.Width, pContext.Height, this.Chars.ground);

        // IDEMPOTENCY: the structure passes (art/apron/edge) mutate PERSISTENT layers
        // that CellChar reads — the apron clears `blocked` (ClearStructureApronCell)
        // and they set `structureGroundMaterial`. Originally they ran AFTER the
        // CellChar loop, so on the first render CellChar saw the pre-clear `blocked`
        // while later renders saw the persisted post-clear state — a render-count
        // dependency (cosmetic, but it broke pure-projection). Commit their layer
        // effects FIRST, against a throwaway char buffer, so every render's CellChar
        // loop reads the same committed structure baseline. The setters are all
        // absolute (idempotent), so re-running the passes below re-commits identical
        // layer state and only then writes the real chars.
        var scratch = MapGen.Layers.Create(pContext.Width, pContext.Height, this.Chars.ground);
        _profileSub("IceRender.CC.Build.StructureArtScratch", function() { return self.ApplyStructureArtChars(pContext, scratch); });
        _profileSub("IceRender.CC.Build.StructureApronScratch", function() { return self.ApplyStructureApronChars(pContext, scratch); });
        _profileSub("IceRender.CC.Build.StructureEdgeScratch", function() { return self.ApplyStructureEdgeInfluence(pContext, scratch); });

        _profileSub("IceRender.CC.Build.CellChars", function() {
            for(var x = 0; x < pContext.Width; ++x) {
                for(var y = 0; y < pContext.Height; ++y)
                    MapGen.Layers.Set(chars, x, y, self.CellChar(pContext, x, y));
            }
        });

        _profileSub("IceRender.CC.Build.TreeSnowApron1", function() { return self.ApplyTreeSnowApronChars(pContext, chars); });

        var structureArt = _profileSub("IceRender.CC.Build.StructureArt", function() { return self.ApplyStructureArtChars(pContext, chars); });
        var structureApron = _profileSub("IceRender.CC.Build.StructureApron", function() { return self.ApplyStructureApronChars(pContext, chars); });
        var structureEdges = _profileSub("IceRender.CC.Build.StructureEdges", function() { return self.ApplyStructureEdgeInfluence(pContext, chars); });
        var structureEdgeHints = _profileSub("IceRender.CC.Build.StructureEdgeHints", function() { return self.BuildStructureEdgeHints(pContext); });

        if((structureArt || structureApron || structureEdges || structureEdgeHints) && MapGen.Context && MapGen.Context.AddLog) {
            MapGen.Context.AddLog(
                pContext,
                "Applied ice structure terrain hints: art=" + structureArt +
                    ", apron=" + structureApron +
                    ", edges=" + structureEdges +
                    ", edgeHints=" + structureEdgeHints
            );
        }

        _profileSub("IceRender.CC.Build.PromoteEdges", function() {
            return MapGen.Terrain.Smoothing.Core.PromoteCharmapEdges(pContext, chars, {
                demote: [self.Chars.bank, self.Chars.wet],
                water: [self.Chars.water],
                tree: self.Chars.tree,
                ground: self.Chars.ground
            });
        });

        _profileSub("IceRender.CC.Build.TreeSnowApron2", function() { return self.ApplyTreeSnowApronChars(pContext, chars); });
        _profileSub("IceRender.CC.Build.WetShoreBreakup", function() { return self.BreakRepeatingWetShoreBands(pContext, chars); });

        return chars;
    };

    pIce.IsOuterCoverBuffer = function(pContext, pX, pY) {
        if(MapGen.Terrain && MapGen.Terrain.Cover && MapGen.Terrain.Cover.IsOuterCoverBuffer)
            return MapGen.Terrain.Cover.IsOuterCoverBuffer(pContext, pX, pY);

        return pX <= 0 || pY <= 0 || pX >= pContext.Width - 1 || pY >= pContext.Height - 1;
    };

    pIce.IsProtectedChar = function(pContext, pX, pY) {
        return MapGen.Layout.Reservations.BlocksCover(pContext, pX, pY) ||
            !MapGen.Layout.TerrainSpace.AllowsCover(pContext, pX, pY) ||
            this.IsOuterCoverBuffer(pContext, pX, pY) ||
            MapGen.Layers.Get(pContext.Layers.keepClear, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.path, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.crossing, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.occupied, pX, pY, 0);
    };

    // Terminal char mutator (2026-06-15 [[atlas_legality_invariant]] /
    // [[mapgen_cliff_edge_to_edge]]). The Wang atlas chain is
    // snow→ice→shallow→deep — there is NO snow|shallow (`#|~`) or
    // snow|deep (`#|.`) cardinal tile. Inside the map the bank ring
    // (`~`, IsBankGroundCell) and wet ring (`W`, IsWetGroundCell) insert
    // the transition cells so every shore chains through the legal
    // ladder. But at the LITERAL map-edge perimeter, the proximity rings
    // get clipped by the OOB direction: a cell two-or-more cells inland
    // from the water (same row) is NOT a bank cell (water out of
    // sqDist≤2 range) so it renders `#`, sitting directly cardinal to the
    // bank ring's `~`. The matcher then has no `~|#` tile and falls back
    // to a wrong-class near-match — the visible deep-water-vs-snow seam
    // the user flagged on seed 7019 row 0.
    //
    // Fix: bridge the seam by inserting the missing transition glyph at
    // the perimeter. Runs AS THE TERMINAL char pass (after every smooth/
    // prune/repair pass, immediately before DumpCharMap) so nothing
    // reverts it.
    //
    // Determinism contract (per adversarial review):
    //  - fixed total-order traversal (top L→R, bottom L→R, left T→B, right T→B)
    //  - snapshot-read + deferred-write: ALL reads use the pre-pass
    //    `original` snapshot; writes are collected and applied after the
    //    scan, so the result is independent of traversal order and cannot
    //    chain-propagate.
    //  - single fixed pass: `#`/`T` cardinal-`~` → `W`, and `#`/`T`
    //    cardinal-`.`(deep, no bank between) → `~`. This converts the two
    //    illegal cardinals into legal ones WITHOUT creating new illegal
    //    cardinals (a promoted `W` sits between `~` and the next `#`,
    //    giving `~|W|#` = shallow|ice|snow, all legal; a promoted `~` sits
    //    between `.` and the next `#`, giving `.|~|#` = deep|shallow|snow,
    //    all legal). No second pass needed.
    // Returns the number of cells bridged (0 = no-op).
    pIce.BridgePerimeterAtlasSeam = function(pContext, pChars) {
        if(!pContext || !pContext.Profile ||
            pContext.Profile.TerrainType !== Terrain.Types.Ice)
            return 0;

        var W = pContext.Width;
        var H = pContext.Height;
        var GROUND = this.Chars.ground;   // #
        var TREE = this.Chars.tree;       // T
        var BANK = this.Chars.bank;       // ~
        var WET = this.Chars.wet;         // W
        var WATER = this.Chars.water;     // .
        var self = this;

        function charAt(x, y) {
            return MapGen.Layers.Get(pChars, x, y, GROUND);
        }
        function cardinalHas(x, y, glyph) {
            if(x > 0 && charAt(x - 1, y) === glyph) return true;
            if(x < W - 1 && charAt(x + 1, y) === glyph) return true;
            if(y > 0 && charAt(x, y - 1) === glyph) return true;
            if(y < H - 1 && charAt(x, y + 1) === glyph) return true;
            return false;
        }
        // Skip cells that own their atlas tile through another rule —
        // structure material, cliff body/apron, coast/path/route/crossing.
        function isBridgeProtected(x, y) {
            var layers = pContext.Layers || {};
            if(MapGen.Layers.Get(layers.path, x, y, 0) ||
                MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                MapGen.Layers.Get(layers.coast, x, y, 0) ||
                MapGen.Layers.Get(layers.occupied, x, y, 0) ||
                MapGen.Layers.Get(layers.structureGround, x, y, 0))
                return true;
            if(self.StructureGroundMaterialChar(pContext, x, y))
                return true;
            if(self.IsCliffCell(pContext, x, y) ||
                self.IsCliffTopApronCell(pContext, x, y) ||
                self.IsCliffFootApronCell(pContext, x, y))
                return true;
            return false;
        }

        var writes = [];   // deferred {x, y, glyph}
        function consider(x, y) {
            var c = charAt(x, y);
            if(c !== GROUND && c !== TREE) return;
            if(isBridgeProtected(x, y)) return;
            // Snow/tree directly cardinal to deep water with no bank
            // between → insert shallow (deep|shallow|snow ladder).
            if(cardinalHas(x, y, WATER)) {
                writes.push({ x: x, y: y, glyph: BANK });
                return;
            }
            // Snow/tree directly cardinal to a bank cell → insert ice
            // (shallow|ice|snow ladder).
            if(cardinalHas(x, y, BANK)) {
                writes.push({ x: x, y: y, glyph: WET });
                return;
            }
        }

        // Fixed total-order traversal over the four perimeter strips.
        for(var tx = 0; tx < W; ++tx) consider(tx, 0);
        for(var bx = 0; bx < W; ++bx) consider(bx, H - 1);
        for(var ly = 0; ly < H; ++ly) consider(0, ly);
        for(var ry = 0; ry < H; ++ry) consider(W - 1, ry);

        for(var wi = 0; wi < writes.length; ++wi)
            MapGen.Layers.Set(pChars, writes[wi].x, writes[wi].y, writes[wi].glyph);

        if(writes.length)
            MapGen.Context.AddLog(pContext, "Bridged perimeter atlas seam: " + writes.length + " cells");

        return writes.length;
    };

    pIce.SurroundChars = function(pChars, pX, pY, pDefaultChar) {
        var offsets = [
            [-1, -1], [0, -1], [1, -1],
            [-1, 0], [1, 0],
            [-1, 1], [0, 1], [1, 1]
        ];
        var result = [];

        for(var index = 0; index < offsets.length; ++index)
            result.push(MapGen.Terrain.Smoothing.Core.GetChar(pChars, pX + offsets[index][0], pY + offsets[index][1], pDefaultChar || this.Chars.water));

        return result;
    };

    pIce.CharListContains = function(pChars, pValue) {
        for(var index = 0; index < pChars.length; ++index) {
            if(pChars[index] === pValue)
                return true;
        }

        return false;
    };

    pIce.FixCharMap = function(pContext, pChars, pOptions) {
        var changed = 0;
        var offsets = [
            [-1, -1], [0, -1], [1, -1],
            [-1, 0], [1, 0],
            [-1, 1], [0, 1], [1, 1]
        ];

        // PERF: hoist the hot accessors/constants out of the per-cell loops. This
        // function is the dominant render cost (~29 full-grid passes per render),
        // so dropping the MapGen.Layers / this.Chars property chains (millions of
        // lookups/run) and the per-cell SurroundChars allocation matters. Behaviour
        // is unchanged (byte-identical) — same logic, same scan order, faster access.
        var Get = MapGen.Layers.Get;
        var Set = MapGen.Layers.Set;
        var GROUND = this.Chars.ground, WATER = this.Chars.water, PATH = this.Chars.path,
            TREE = this.Chars.tree, BANK = this.Chars.bank, WET = this.Chars.wet;
        var W = pContext.Width, H = pContext.Height;
        var forcedBank = pContext.Layers.forcedBank, riverBank = pContext.Layers.riverBank;
        var options = pOptions || {};
        var allowTreeDemotion = options.AllowTreeDemotion !== false;
        var allowWetPromotion = options.AllowWetPromotion !== false;
        // Tree-boundary repair must be a bounded, order-independent erosion.
        // Reading and writing pChars in the same x/y scan let the first
        // demoted tree become WET, which demoted its neighbour, and so on
        // through an otherwise valid forest. Later convergence passes are for
        // shoreline slivers; they explicitly disable tree demotion.
        var treeConflictSource = allowTreeDemotion ? MapGen.Layers.Clone(pChars) : null;
        // Enclosed-pocket promotion is also a bounded shape correction. If
        // it reads its own writes, or runs during the later convergence
        // passes, each new wet cell qualifies the next dry cell and floods
        // entire islands/objective aprons. Read one immutable source and let
        // only the initial FixCharMap pass perform this promotion.
        var wetPromotionSource = allowWetPromotion ? MapGen.Layers.Clone(pChars) : null;
        var dirtyMask = options.DirtyMask || null;
        var dirtyRegion = options.DirtyRegion || null;
        var minX = dirtyRegion ? Math.max(0, dirtyRegion.minX) : 0;
        var minY = dirtyRegion ? Math.max(0, dirtyRegion.minY) : 0;
        var maxX = dirtyRegion ? Math.min(W - 1, dirtyRegion.maxX) : W - 1;
        var maxY = dirtyRegion ? Math.min(H - 1, dirtyRegion.maxY) : H - 1;
        options.ChangeRegion = null;
        function dirty(x, y) {
            return !dirtyMask || (x >= 0 && y >= 0 && x < W && y < H &&
                dirtyMask.charAt((y * W) + x) === "1");
        }
        function markChanged(cx, cy) {
            ++changed;
            if(!options.TrackChanges)
                return;

            var region = options.ChangeRegion;
            if(!region) {
                options.ChangeRegion = { minX: cx, minY: cy, maxX: cx, maxY: cy };
                return;
            }

            if(cx < region.minX) region.minX = cx;
            if(cy < region.minY) region.minY = cy;
            if(cx > region.maxX) region.maxX = cx;
            if(cy > region.maxY) region.maxY = cy;
        }

        for(var x = minX; x <= maxX; ++x) {
            for(var y = minY; y <= maxY; ++y) {
                if(!dirty(x, y))
                    continue;

                var current = Get(pChars, x, y, GROUND);

                // Rule 1 (drop path/tree cells stranded against water/bank/etc.) is
                // the ONLY consumer of the 8-neighbour scan and the protected-cell
                // test, so for the common non-path/tree cell we compute neither.
                // The scan inlines SurroundChars (OOB neighbour -> `current`,
                // matching Core.GetChar's default) with no array allocation and no
                // CharListContains rescans.
                if((current === PATH || (current === TREE && allowTreeDemotion)) &&
                    !this.IsProtectedChar(pContext, x, y)) {
                    var hasWater = false, hasBank = false, hasPath = false, hasWet = false;
                    var conflictSource = current === TREE ? treeConflictSource : pChars;
                    for(var s1 = 0; s1 < 8; ++s1) {
                        var n1 = Get(conflictSource, x + offsets[s1][0], y + offsets[s1][1], current);
                        if(n1 === WATER) hasWater = true;
                        else if(n1 === BANK) hasBank = true;
                        else if(n1 === PATH) hasPath = true;
                        else if(n1 === WET) hasWet = true;
                    }

                    if(current === PATH && (hasWater || hasBank)) {
                        Set(pChars, x, y, GROUND);
                        markChanged(x, y);
                        continue;
                    }
                    if(current === TREE && (hasWater || hasPath || hasBank || hasWet)) {
                        // Cardinal-aware demote: if a cardinal neighbour is
                        // bank or wet, demote to wet (provides the W ring
                        // shipped maps always have between snow and shallow).
                        // If a cardinal is water, demote to water (extend the
                        // lake one cell). Otherwise GROUND. Without this
                        // bridge a perimeter tree adjacent to bank produced
                        // a `#|~` seam that has no Wang-atlas tile pair and
                        // visually reads as ice/snow protruding into shallow.
                        // RCA 2026-06-12 cluster 3.
                        var cN = Get(treeConflictSource, x, y - 1, GROUND);
                        var cS = Get(treeConflictSource, x, y + 1, GROUND);
                        var cW = Get(treeConflictSource, x - 1, y, GROUND);
                        var cE = Get(treeConflictSource, x + 1, y, GROUND);
                        var cardWater = cN === WATER || cS === WATER || cW === WATER || cE === WATER;
                        var cardBankOrWet = cN === BANK || cS === BANK || cW === BANK || cE === BANK ||
                            cN === WET || cS === WET || cW === WET || cE === WET;
                        var demoteTo = GROUND;
                        if(cardWater) demoteTo = WATER;
                        else if(cardBankOrWet) demoteTo = WET;
                        Set(pChars, x, y, demoteTo);
                        markChanged(x, y);
                        continue;
                    }
                }

                // Demote sliver bank/wet cells back to a thinner band when they
                // have only 0-1 ground-side neighbours. Retail ice_shallow /
                // wetIce rules need ≥3 ground bits for an exact match; the
                // hamming-1 fallback covers 2-bit cells but a 1-bit cell only
                // matches via hamming-2 and the resulting tile is visually
                // wrong (e.g. an L-shape applied to a single-corner sliver).
                // Run on protected cells too — a broken tile is more disruptive
                // than the slight shoreline drift around path zones.
                // forcedBank cells were deliberately added to widen the bank
                // at diagonal step rows. Skip demotion so the ~~ pair survives
                // — pair-tile rules in IceData handle their bm patterns.
                // Single-cell-thick slivers (groundSide < 2) produce 1-pixel
                // edge transitions that no atlas tile can match cleanly even
                // with edge-pixel matching. Demote them to the next-water-ward
                // band so adjacent cells get a continuous shoreline.
                if((current === BANK || current === WET) &&
                    !Get(forcedBank, x, y, 0)) {
                    var groundSide = 0;
                    for(var sd = 0; sd < offsets.length; ++sd) {
                        // Count anything-but-water as "land side". This treats
                        // a 2-cell-thick bank ring's inner cell as legitimate
                        // (it has bank neighbours rather than being a stub
                        // sticking into water). Genuine slivers — single ~ or
                        // W cells poking into water — still hit groundSide<2
                        // and get demoted because their non-water neighbours
                        // are too few. (OOB neighbour -> ground via Get's default.)
                        var nndch = Get(pChars, x + offsets[sd][0], y + offsets[sd][1], GROUND);
                        if(nndch !== WATER)
                            ++groundSide;
                    }
                    if(groundSide < 2) {
                        var demoted = (current === BANK) ? WATER : BANK;
                        Set(pChars, x, y, demoted);
                        markChanged(x, y);
                        continue;
                    }
                }

                // Orphan-bank cleanup. The block above skips forcedBank cells
                // so the widened ~~ pair survives, and uses 8-neighbour
                // ground-side count (so a cell with 2 diagonal-only land
                // bits passes). Both rules let "thin-finger" banks survive
                // — a ~ with just 1 cardinal land-side and a single supporting
                // diagonal. The bm pattern (e.g. 11000000) does technically
                // match a corner ice_shallow tile, but the placed neighbour-
                // edge for the missing-cardinal sides is plain water, and
                // the Wang matcher's class-adjacency penalties end up picking
                // a near-flat tile that reads as shallow water with no edge.
                // Demote when: zero cardinal land-side (truly stranded), OR
                // one cardinal land-side with total 8-neighbour land < 3
                // (thin spur jutting into water). Clear forcedBank/riverBank
                // alongside so the demote sticks across the FixCharMap loop.
                if(current === BANK) {
                    var oN = Get(pChars, x, y - 1, GROUND);
                    var oS = Get(pChars, x, y + 1, GROUND);
                    var oW = Get(pChars, x - 1, y, GROUND);
                    var oE = Get(pChars, x + 1, y, GROUND);
                    var cardLand =
                        (oN !== WATER ? 1 : 0) +
                        (oS !== WATER ? 1 : 0) +
                        (oW !== WATER ? 1 : 0) +
                        (oE !== WATER ? 1 : 0);

                    var orphan = false;
                    if(cardLand === 0) {
                        orphan = true;
                    }
                    else if(cardLand === 1) {
                        var totalLand = 0;
                        for(var od = 0; od < offsets.length; ++od) {
                            var onch = Get(pChars, x + offsets[od][0], y + offsets[od][1], GROUND);
                            if(onch !== WATER)
                                ++totalLand;
                        }
                        if(totalLand < 3)
                            orphan = true;
                    }

                    if(orphan) {
                        Set(pChars, x, y, WATER);
                        Set(forcedBank, x, y, 0);
                        Set(riverBank, x, y, 0);
                        markChanged(x, y);
                        continue;
                    }
                }

                // Retract single-edge ice incursions. The shallow-center tiles
                // in the retail atlas frame ice as a corner / T / two-edge
                // shape — there is no shallow tile with ice on exactly one
                // cardinal edge. So a `~` cell whose only `W` cardinal is
                // unsupported by a `W` corner on that side is structurally
                // unrenderable: every shallow candidate fights the seam.
                // Demote the offending `W` to `~` so the ring becomes a clean
                // shallow-deep transition. Self-limiting (only fires on the
                // bad pattern); cascading via the FixCharMap convergence loop
                // dissolves 1-cell ice fingers entirely while leaving 2-wide
                // ice patches intact.
                // forcedBank pins THIS cell against being demoted; it doesn't
                // prevent it from triggering a demote of a neighbouring W cell.
                // Run on forcedBank cells too — the demote target's own forcedBank
                // flag is checked below.
                if(current === BANK) {
                    var cardN = Get(pChars, x, y - 1, GROUND);
                    var cardS = Get(pChars, x, y + 1, GROUND);
                    var cardW = Get(pChars, x - 1, y, GROUND);
                    var cardE = Get(pChars, x + 1, y, GROUND);
                    var wetCardCount =
                        (cardN === WET ? 1 : 0) +
                        (cardS === WET ? 1 : 0) +
                        (cardW === WET ? 1 : 0) +
                        (cardE === WET ? 1 : 0);
                    if(wetCardCount === 1) {
                        var demoteX = x, demoteY = y, doDemote = false;
                        // OOB diagonal default: treat as wet (i.e. "supporting
                        // the cardinal"). With the prior ground default, an
                        // OOB diagonal spuriously satisfied "neither diagonal
                        // is wet" — at y=0 the cardW=wet branch would demote
                        // the wet cardinal whenever its inland diagonal wasn't
                        // wet, and the resulting bank then triggered the same
                        // rule on its own western neighbour, cascading a phantom
                        // bank ring across the entire top/bottom row.
                        // (Get returns the WET default on OOB, matching the prior
                        // explicit in-bounds-else-wet expression.)
                        if(cardN === WET) {
                            var nw = Get(pChars, x - 1, y - 1, WET);
                            var ne = Get(pChars, x + 1, y - 1, WET);
                            if(nw !== WET && ne !== WET) {
                                demoteY = y - 1;
                                doDemote = true;
                            }
                        }
                        else if(cardS === WET) {
                            var sw = Get(pChars, x - 1, y + 1, WET);
                            var se = Get(pChars, x + 1, y + 1, WET);
                            if(sw !== WET && se !== WET) {
                                demoteY = y + 1;
                                doDemote = true;
                            }
                        }
                        else if(cardW === WET) {
                            var nw2 = Get(pChars, x - 1, y - 1, WET);
                            var sw2 = Get(pChars, x - 1, y + 1, WET);
                            if(nw2 !== WET && sw2 !== WET) {
                                demoteX = x - 1;
                                doDemote = true;
                            }
                        }
                        else if(cardE === WET) {
                            var ne2 = Get(pChars, x + 1, y - 1, WET);
                            var se2 = Get(pChars, x + 1, y + 1, WET);
                            if(ne2 !== WET && se2 !== WET) {
                                demoteX = x + 1;
                                doDemote = true;
                            }
                        }
                        if(doDemote && dirty(demoteX, demoteY) && !Get(forcedBank, demoteX, demoteY, 0)) {
                            Set(pChars, demoteX, demoteY, BANK);
                            markChanged(demoteX, demoteY);
                            continue;
                        }
                    }
                }

                // Promote enclosed dry pockets to wet regardless of keepClear/path-zone
                // protection: wet ice is walkable so it doesn't break paths, and skipping
                // protected cells leaves visible notches where path corridors run alongside
                // the river.
                //
                // Boundary cells adjacent to the river mouth easily satisfy
                // bankOrWet+wetLike>=4 because most of their in-bounds neighbours
                // are river cells. Promoting them widens the wet apron at the
                // mouth into bm patterns that have no canonical tile (the river
                // extension is sized for a single-W bank ring). Pin the outer
                // ring against this promotion.
                if((x === 0 || y === 0 || x === W - 1 || y === H - 1)) {
                    // skip promotion on boundary
                }
                else if(allowWetPromotion && current === GROUND &&
                    !this.IsCliffCell(pContext, x, y)) {
                    var wetLike = 0;
                    var bankOrWet = false;
                    for(var si = 0; si < offsets.length; ++si) {
                        var nx = x + offsets[si][0];
                        var ny = y + offsets[si][1];
                        if(nx < 0 || ny < 0 || nx >= W || ny >= H)
                            continue;
                        var nch = Get(wetPromotionSource, nx, ny, GROUND);
                        if(nch === WET || nch === BANK) {
                            ++wetLike;
                            bankOrWet = true;
                        }
                        else if(nch === WATER) {
                            ++wetLike;
                        }
                    }
                    if(bankOrWet && wetLike >= 4) {
                        Set(pChars, x, y, WET);
                        markChanged(x, y);
                    }
                }
            }
        }

        return changed;
    },

    // Fill thin concave bays in tree-edge boundaries. Shipped CF1 ice maps
    // average 1.4 n>=3 indents per map; the random generator produces ragged
    // edges with 1-cell-wide bays 2-3 cells deep that no tile choice can
    // smooth, so we close them at the chars layer before tile assignment.
    // A bay = a non-tree run in a column (or row) of length <= maxGap, T-bordered
    // above and below (or left/right), with the adjacent column (or row) solidly
    // T across the gap so the fill clearly belongs to a tree edge.;

    pIce.FillTreeBays = function(pContext, pChars, pOptions) {
        var W = pContext.Width;
        var H = pContext.Height;
        var Core = MapGen.Terrain.Smoothing.Core;
        var TREE = this.Chars.tree;
        var maxGap = 3;
        var changed = 0;
        var src = MapGen.Layers.Clone(pChars);
        var dirtyMask = (pOptions || {}).DirtyMask || null;
        function dirty(x, y) {
            return !dirtyMask || (x >= 0 && y >= 0 && x < W && y < H &&
                dirtyMask.charAt((y * W) + x) === "1");
        }

        function isT(x, y) {
            return Core.GetChar(src, x, y, TREE) === TREE;
        }
        function colSolidT(cx, y0, y1) {
            if(cx < 0 || cx >= W) return false;
            for(var yy = y0; yy <= y1; ++yy) {
                if(!isT(cx, yy)) return false;
            }
            return true;
        }
        function rowSolidT(cy, x0, x1) {
            if(cy < 0 || cy >= H) return false;
            for(var xx = x0; xx <= x1; ++xx) {
                if(!isT(xx, cy)) return false;
            }
            return true;
        }

        function hardProtected(x, y) {
            return MapGen.Layers.Get(pContext.Layers.path, x, y, 0) ||
                MapGen.Layers.Get(pContext.Layers.crossing, x, y, 0) ||
                MapGen.Layers.Get(pContext.Layers.water, x, y, 0) ||
                MapGen.Layers.Get(pContext.Layers.perimeterCover, x, y, 0) ||
                MapGen.Layers.Get(pContext.Layers.coast, x, y, 0) ||
                MapGen.Layers.Get(pContext.Layers.riverBank, x, y, 0) ||
                MapGen.Layers.Get(pContext.Layers.occupied, x, y, 0);
        }

        for(var x = 0; x < W; ++x) {
            for(var y = 0; y < H; ++y) {
                if(!dirty(x, y)) continue;
                if(isT(x, y)) continue;
                if(hardProtected(x, y)) continue;
                if(MapGen.Layers.Get(pChars, x, y, this.Chars.ground) !== this.Chars.ground) continue;

                var topY = -1;
                for(var dy = 1; dy <= maxGap; ++dy) {
                    if(isT(x, y - dy)) { topY = y - dy; break; }
                }
                var botY = -1;
                for(var dy2 = 1; dy2 <= maxGap; ++dy2) {
                    if(isT(x, y + dy2)) { botY = y + dy2; break; }
                }
                if(topY >= 0 && botY >= 0 && (botY - topY - 1) <= maxGap) {
                    if(colSolidT(x - 1, topY + 1, botY - 1) ||
                        colSolidT(x + 1, topY + 1, botY - 1)) {
                        MapGen.Layers.Set(pChars, x, y, TREE);
                        ++changed;
                        continue;
                    }
                }

                var leftX = -1;
                for(var dx = 1; dx <= maxGap; ++dx) {
                    if(isT(x - dx, y)) { leftX = x - dx; break; }
                }
                var rightX = -1;
                for(var dx2 = 1; dx2 <= maxGap; ++dx2) {
                    if(isT(x + dx2, y)) { rightX = x + dx2; break; }
                }
                if(leftX >= 0 && rightX >= 0 && (rightX - leftX - 1) <= maxGap) {
                    if(rowSolidT(y - 1, leftX + 1, rightX - 1) ||
                        rowSolidT(y + 1, leftX + 1, rightX - 1)) {
                        MapGen.Layers.Set(pChars, x, y, TREE);
                        ++changed;
                    }
                }
            }
        }

        return changed;
    };

    pIce.TrimTreeSpurs = function(pContext, pChars, pOptions) {
        var W = pContext.Width;
        var H = pContext.Height;
        var Core = MapGen.Terrain.Smoothing.Core;
        var src = MapGen.Layers.Clone(pChars);
        var self = this;
        var changed = 0;
        var dirtyMask = (pOptions || {}).DirtyMask || null;
        function dirty(x, y) {
            return !dirtyMask || (x >= 0 && y >= 0 && x < W && y < H &&
                dirtyMask.charAt((y * W) + x) === "1");
        }

        function isT(x, y) {
            return self.IsTreeCharValue(Core.GetChar(src, x, y, ""));
        }

        function hardProtected(x, y) {
            return MapGen.Layers.Get(pContext.Layers.path, x, y, 0) ||
                MapGen.Layers.Get(pContext.Layers.crossing, x, y, 0) ||
                MapGen.Layers.Get(pContext.Layers.water, x, y, 0) ||
                MapGen.Layers.Get(pContext.Layers.perimeterCover, x, y, 0) ||
                MapGen.Layers.Get(pContext.Layers.coast, x, y, 0) ||
                MapGen.Layers.Get(pContext.Layers.riverBank, x, y, 0) ||
                MapGen.Layers.Get(pContext.Layers.occupied, x, y, 0);
        }

        for(var x = 0; x < W; ++x) {
            for(var y = 0; y < H; ++y) {
                if(!dirty(x, y)) continue;
                if(!isT(x, y)) continue;
                if(hardProtected(x, y)) continue;

                var n = isT(x, y - 1);
                var e = isT(x + 1, y);
                var s = isT(x, y + 1);
                var w = isT(x - 1, y);
                var cardinal = (n ? 1 : 0) + (e ? 1 : 0) + (s ? 1 : 0) + (w ? 1 : 0);

                if(cardinal === 0 || (cardinal === 1 && (e || w) && !n && !s)) {
                    MapGen.Layers.Set(pChars, x, y, this.Chars.ground);
                    ++changed;
                }
            }
        }

        return changed;
    };

    // Final singleton sweep — runs LATE in the render pipeline, after
    // BreakPerimeterCharRuns / FinalOpenFieldCover / FinalRouteEdgeCover
    // have stamped their lobes AND after the various prune passes have
    // demoted unsupported lobe-mate cells. Any tree char that is now a
    // true singleton (no cardinal tree neighbour) gets demoted regardless
    // of perimeterCover/path/coast/etc. protection — without this, the
    // depth-0 perimeter-cover cells whose supporting depth-1/depth-2
    // cells were trimmed remain alive as visible "tree-in-water" artefacts
    // (user-reported singletons at top/bottom rows on seed 832202380).
    // The cleanup only acts on true singletons (cardinal === 0); thin spurs
    // and 1-wide protrusions are left to the earlier shape-aware passes.
    // RCA 2026-06-14.
    pIce.TrimFinalSingletonTreeChars = function(pContext, pChars) {
        var W = pContext.Width;
        var H = pContext.Height;
        var Core = MapGen.Terrain.Smoothing.Core;
        var self = this;
        var src = MapGen.Layers.Clone(pChars);

        function isT(x, y) {
            return self.IsTreeCharValue(Core.GetChar(src, x, y, ""));
        }

        var changed = 0;
        for(var x = 0; x < W; ++x) {
            for(var y = 0; y < H; ++y) {
                if(!isT(x, y))
                    continue;
                var n = isT(x, y - 1);
                var e = isT(x + 1, y);
                var s = isT(x, y + 1);
                var w = isT(x - 1, y);
                if(n || e || s || w)
                    continue;

                MapGen.Layers.Set(pChars, x, y, this.Chars.ground);
                if(pContext.Layers.blocked)
                    MapGen.Layers.Set(pContext.Layers.blocked, x, y, 0);
                if(pContext.Layers.perimeterCover)
                    MapGen.Layers.Set(pContext.Layers.perimeterCover, x, y, 0);
                if(pContext.Layers.structureContextCover)
                    MapGen.Layers.Set(pContext.Layers.structureContextCover, x, y, 0);
                ++changed;
            }
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Trimmed final singleton ice tree chars: " + changed);

        return changed;
    };

    pIce.MaxWalkablePerimeterRun = function(pContext) {
        if(MapGen.Terrain && MapGen.Terrain.Cover && MapGen.Terrain.Cover.MaxWalkablePerimeterRun)
            return MapGen.Terrain.Cover.MaxWalkablePerimeterRun(pContext);

        var value = Number((pContext.Profile || {}).MaxWalkablePerimeterRun);
        if(isNaN(value))
            value = 10;
        return Math.max(4, Math.min(24, Math.floor(value)));
    };

    pIce.IsPerimeterCharWalkable = function(pChar) {
        return pChar === this.Chars.ground || pChar === this.Chars.path;
    };

    pIce.CanStampPerimeterCharCover = function(pContext, pChars, pX, pY) {
        if(pX < 0 || pY < 0 || pX >= pContext.Width || pY >= pContext.Height)
            return false;

        var ch = MapGen.Layers.Get(pChars, pX, pY, this.Chars.ground);
        if(!this.IsPerimeterCharWalkable(ch))
            return false;

        // Don't stamp perimeter cover on cells the gen committed to as routes
        // (path / keepClear) — that overwrites the placement-connectivity
        // carve and disconnects pickup access points post-render. The other
        // tree-fill passes (RepairUnsupportedTreeConcavityChars, the diagonal
        // edge stair repair) already consult Layers.path; this one didn't,
        // so was the gap behind connectivity_node_unreachable failures.
        // IsProtectedChar covers path + keepClear + crossing + occupied.
        if(this.IsProtectedChar(pContext, pX, pY))
            return false;

        var layers = pContext.Layers || {};
        if(MapGen.Layers.Get(layers.water, pX, pY, 0) ||
            MapGen.Layers.Get(layers.causeway, pX, pY, 0) ||
            MapGen.Layers.Get(layers.outcrop, pX, pY, 0) ||
            this.IsCliffCell(pContext, pX, pY) ||
            this.IsCliffTopApronCell(pContext, pX, pY) ||
            this.IsCliffFootApronCell(pContext, pX, pY) ||
            this.StructureGroundMaterialChar(pContext, pX, pY))
            return false;

        return true;
    };

    // Layers a cover injector overwrites at a stamped cell. The injectors set
    // blocked=1 AND zero a set of sibling terrain/placement layers (so the cell
    // renders as clean tree cover). To make the render idempotent we must invert
    // ALL of those writes on reclaim, not just blocked — otherwise a re-render
    // sees siblings still zeroed and reclassifies a few cells.
    pIce.CoverBackupLayers = [
        "blocked", "coast", "riverBank", "forcedBank", "lakeShore", "terrainEdge",
        "path", "keepClear", "outcrop", "occupied",
        "structureGroundMaterial", "structurePlainGround"
    ];

    // Snapshot (once per cell) the pre-injection values of every layer a cover
    // injector is about to overwrite. Called by each injector BEFORE it mutates.
    // First-touch-wins so the recorded value is the authored/committed state, not
    // a value written by a sibling injector earlier in the same render.
    pIce.BackupCoverCell = function(pContext, pX, pY) {
        var store = pContext._coverBackup || (pContext._coverBackup = {});
        var key = pX + "," + pY;
        if(store[key] !== undefined)
            return;

        var layers = pContext.Layers || {};
        var names = this.CoverBackupLayers;
        var snap = {};
        for(var i = 0; i < names.length; ++i) {
            var layer = layers[names[i]];
            snap[names[i]] = layer ? MapGen.Layers.Get(layer, pX, pY, 0) : undefined;
        }
        store[key] = snap;
    };

    // Un-inject all cover the previous render added, restoring each stamped cell
    // to its exact pre-injection state, so THIS render starts from the same stable
    // authored-mask + structure baseline every time. The ice render ADDS cover
    // while it runs (perimeter runs / anti-empty open-field sectors / diagonal
    // tree-edge fill); because the render runs >=2x per attempt and BuildCharMap
    // re-reads blocked to seed tree chars, without this reclaim each render would
    // COMPOUND the prior render's cover. We key off the MARKER layers to find the
    // injected cells and restore each cell's pre-injection values from the per-cell
    // backup map (populated by BackupCoverCell at injection time), then clear the
    // markers. On the very first render the markers are empty -> no-op, so a single
    // render's output is unchanged; only render 2+ stop compounding. (Structures
    // never place on blocked cells, so a
    // between-render structure edit can't land on an injected-cover cell and be
    // clobbered by the restore.)
    pIce.ReclaimInjectedCover = function(pContext) {
        var layers = pContext.Layers || {};
        var perimeter = layers.perimeterCover;
        var finalField = layers.finalFieldCover;
        var finalRoute = layers.finalRouteCover;
        var softFill = layers.softFillCover;
        var store = pContext._coverBackup || {};
        var names = this.CoverBackupLayers;
        var reclaimed = 0;

        // Iterate the MARKER layers (not the backup map) to find injected cells:
        // the markers survive RefreshDerivedLayers, so this stays correct even on
        // the repair path. Restore the recorded pre-injection value for every
        // backed-up layer; always force blocked=0 and clear the markers so cover
        // can never survive into the next render even if the backup desynced.
        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                var hasPerimeterMarker = MapGen.Layers.Get(perimeter, x, y, 0);
                var hasInjectedMarker =
                    MapGen.Layers.Get(finalField, x, y, 0) ||
                    MapGen.Layers.Get(finalRoute, x, y, 0) ||
                    MapGen.Layers.Get(softFill, x, y, 0);
                var snap = store[x + "," + y];

                // `perimeterCover` is both an authored-cover protection tag
                // and a renderer-injected marker. Only reclaim perimeter cells
                // that this renderer backed up; preserve authored v3 forest.
                if(!hasInjectedMarker && (!hasPerimeterMarker || !snap))
                    continue;

                if(snap) {
                    for(var i = 0; i < names.length; ++i) {
                        var value = snap[names[i]];
                        if(value !== undefined && layers[names[i]])
                            MapGen.Layers.Set(layers[names[i]], x, y, value);
                    }
                } else if(layers.blocked) {
                    MapGen.Layers.Set(layers.blocked, x, y, 0);
                }

                if(snap)
                    MapGen.Layers.Set(perimeter, x, y, 0);
                MapGen.Layers.Set(finalField, x, y, 0);
                MapGen.Layers.Set(finalRoute, x, y, 0);
                MapGen.Layers.Set(softFill, x, y, 0);
                ++reclaimed;
            }
        }

        pContext._coverBackup = {};

        if(reclaimed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Reclaimed prior-render injected cover: " + reclaimed);

        return reclaimed;
    };

    pIce.MarkPerimeterCharCover = function(pContext, pChars, pX, pY) {
        var layers = pContext.Layers || {};

        this.BackupCoverCell(pContext, pX, pY);
        MapGen.Layers.Set(pChars, pX, pY, this.Chars.tree);
        MapGen.Layers.Set(layers.blocked, pX, pY, 1);
        if(!layers.perimeterCover)
            layers.perimeterCover = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
        MapGen.Layers.Set(layers.perimeterCover, pX, pY, 1);
        MapGen.Layers.Set(layers.coast, pX, pY, 0);
        MapGen.Layers.Set(layers.riverBank, pX, pY, 0);
        MapGen.Layers.Set(layers.forcedBank, pX, pY, 0);
        MapGen.Layers.Set(layers.lakeShore, pX, pY, 0);
        MapGen.Layers.Set(layers.terrainEdge, pX, pY, 0);
        if(MapGen.Layers.Get(layers.occupied, pX, pY, 0) === 1)
            MapGen.Layers.Set(layers.occupied, pX, pY, 0);
    };

    pIce.StampPerimeterCharCoverLobe = function(pContext, pChars, pX, pY, pInwardDx, pInwardDy, pRecordCells) {
        var sideDx = -pInwardDy;
        var sideDy = pInwardDx;
        var offsets = [
            { dx: 0, dy: 0, depth: 0 },
            { dx: sideDx, dy: sideDy, depth: 0 },
            { dx: -sideDx, dy: -sideDy, depth: 0 },
            { dx: pInwardDx, dy: pInwardDy, depth: 1 },
            { dx: pInwardDx + sideDx, dy: pInwardDy + sideDy, depth: 1 },
            { dx: pInwardDx - sideDx, dy: pInwardDy - sideDy, depth: 1 },
            { dx: pInwardDx * 2, dy: pInwardDy * 2, depth: 2 },
            { dx: pInwardDx * 2 + sideDx, dy: pInwardDy * 2 + sideDy, depth: 2 },
            { dx: pInwardDx * 2 - sideDx, dy: pInwardDy * 2 - sideDy, depth: 2 }
        ];
        var stamped = 0;
        var pending = [];
        var edgeSupport = 0;
        var depthOneSupport = 0;
        var depthTwoSupport = 0;

        for(var index = 0; index < offsets.length; ++index) {
            var offset = offsets[index];
            var x = pX + offset.dx;
            var y = pY + offset.dy;
            if(!this.CanStampPerimeterCharCover(pContext, pChars, x, y))
                continue;
            pending.push({ x: x, y: y });
            if(offset.depth === 0) ++edgeSupport;
            else if(offset.depth === 1) ++depthOneSupport;
            else if(offset.depth === 2) ++depthTwoSupport;
        }

        if(edgeSupport < 1 || depthOneSupport < 1 || depthTwoSupport < 1 || pending.length < 3)
            return 0;

        for(var pendingIndex = 0; pendingIndex < pending.length; ++pendingIndex) {
            var cell = pending[pendingIndex];
            this.MarkPerimeterCharCover(pContext, pChars, cell.x, cell.y);
            if(pRecordCells)
                pRecordCells.push({ x: cell.x, y: cell.y });
            ++stamped;
        }

        return stamped;
    };

    pIce.BreakPerimeterCharRunsOnSide = function(pContext, pChars, pCells, pInwardDx, pInwardDy, pMaxRun, pRecordCells) {
        var self = this;
        var stamped = 0;
        var run = [];

        function flush() {
            if(run.length <= pMaxRun) {
                run = [];
                return;
            }

            var blockCount = Math.max(1, Math.floor(run.length / (pMaxRun + 1)));
            var interval = run.length / (blockCount + 1);
            for(var index = 1; index <= blockCount; ++index) {
                var center = Math.max(0, Math.min(run.length - 1, Math.round((interval * index) - 0.5)));
                var placed = false;
                for(var radius = 0; radius <= Math.min(5, run.length - 1) && !placed; ++radius) {
                    for(var dir = radius === 0 ? 0 : -1; dir <= 1 && !placed; dir += 2) {
                        var candidateIndex = center + (radius * dir);
                        if(candidateIndex < 0 || candidateIndex >= run.length)
                            continue;
                        var cell = run[candidateIndex];
                        var added = self.StampPerimeterCharCoverLobe(
                            pContext,
                            pChars,
                            cell.x,
                            cell.y,
                            pInwardDx,
                            pInwardDy,
                            pRecordCells
                        );
                        if(added > 0) {
                            stamped += added;
                            placed = true;
                        }
                    }
                }
            }

            run = [];
        }

        for(var cellIndex = 0; cellIndex < pCells.length; ++cellIndex) {
            var cell = pCells[cellIndex];
            var ch = MapGen.Layers.Get(pChars, cell.x, cell.y, this.Chars.ground);
            if(this.IsPerimeterCharWalkable(ch))
                run.push(cell);
            else
                flush();
        }

        flush();
        return stamped;
    };

    pIce.PerimeterCharCoverPlanMatches = function(pContext, pPlan) {
        return !!(pContext &&
            pPlan &&
            pPlan.schema === 1 &&
            pPlan.width === pContext.Width &&
            pPlan.height === pContext.Height &&
            pPlan.cells instanceof Array);
    };

    pIce.OutsideStructureFlushDirtyRegion = function(pContext, pX, pY) {
        var region = pContext ? pContext._structureFlushRenderDirtyRegion : null;
        return !!(region &&
            (pX < region.minX || pX > region.maxX || pY < region.minY || pY > region.maxY));
    };

    pIce.ReplayPerimeterCharCoverPlan = function(pContext, pChars, pPlan) {
        var cells = pPlan && pPlan.cells instanceof Array ? pPlan.cells : [];
        var pending = [];
        var skipped = 0;
        var forcedOutsideDirty = 0;

        for(var index = 0; index < cells.length; ++index) {
            if(!cells[index])
                continue;

            var x = Number(cells[index].x);
            var y = Number(cells[index].y);
            if(isNaN(x) || isNaN(y)) {
                ++skipped;
                continue;
            }

            x = Math.floor(x);
            y = Math.floor(y);
            if(x < 0 || y < 0 || x >= pContext.Width || y >= pContext.Height) {
                ++skipped;
            } else if(this.OutsideStructureFlushDirtyRegion(pContext, x, y)) {
                pending.push({ x: x, y: y });
                ++forcedOutsideDirty;
            } else if(this.CanStampPerimeterCharCover(pContext, pChars, x, y)) {
                pending.push({ x: x, y: y });
            } else {
                ++skipped;
            }
        }

        var stamped = 0;
        for(var pendingIndex = 0; pendingIndex < pending.length; ++pendingIndex) {
            this.MarkPerimeterCharCover(pContext, pChars, pending[pendingIndex].x, pending[pendingIndex].y);
            ++stamped;
        }

        pContext._perimeterCharCoverReplay = {
            replayed: true,
            plannedCells: cells.length,
            stamped: stamped,
            skipped: skipped,
            forcedOutsideDirty: forcedOutsideDirty
        };

        if((stamped || skipped) && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(
                pContext,
                "Replayed final perimeter char runs: " + stamped + " skipped=" + skipped +
                    " forcedOutsideDirty=" + forcedOutsideDirty
            );

        return stamped;
    };

    pIce.BreakPerimeterCharRuns = function(pContext, pChars) {
        if(pContext && pContext.OriginalTerrainTemplate)
            return 0;
        if(!pContext.Profile || (pContext.Profile.TerrainType !== Terrain.Types.Ice && pContext.Profile.TerrainType !== Terrain.Types.Jungle))
            return 0;

        var width = pContext.Width;
        var height = pContext.Height;
        var maxRun = this.MaxWalkablePerimeterRun(pContext);
        var replayEnabled = this.FinalOpenFieldCoverReplayEnabled(pContext);
        if(replayEnabled && this.PerimeterCharCoverPlanMatches(pContext, pContext.PerimeterCharCoverPlan))
            return this.ReplayPerimeterCharCoverPlan(pContext, pChars, pContext.PerimeterCharCoverPlan);

        var recordCells = replayEnabled ? [] : null;
        var top = [];
        var bottom = [];
        var left = [];
        var right = [];

        for(var x = 0; x < width; ++x) {
            top.push({ x: x, y: 0 });
            bottom.push({ x: x, y: height - 1 });
        }
        for(var y = 1; y < height - 1; ++y) {
            left.push({ x: 0, y: y });
            right.push({ x: width - 1, y: y });
        }

        var stamped = 0;
        stamped += this.BreakPerimeterCharRunsOnSide(pContext, pChars, top, 0, 1, maxRun, recordCells);
        stamped += this.BreakPerimeterCharRunsOnSide(pContext, pChars, bottom, 0, -1, maxRun, recordCells);
        stamped += this.BreakPerimeterCharRunsOnSide(pContext, pChars, left, 1, 0, maxRun, recordCells);
        stamped += this.BreakPerimeterCharRunsOnSide(pContext, pChars, right, -1, 0, maxRun, recordCells);

        if(replayEnabled) {
            pContext.PerimeterCharCoverPlan = {
                schema: 1,
                width: width,
                height: height,
                maxRun: maxRun,
                stamped: stamped,
                cells: this.CloneFinalOpenFieldCoverCells(recordCells)
            };
            pContext._perimeterCharCoverReplay = {
                replayed: false,
                plannedCells: recordCells ? recordCells.length : 0,
                stamped: stamped,
                skipped: 0
            };
        }

        if(stamped && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Broke final perimeter char runs: " + stamped);

        return stamped;
    };

    pIce.FinalOpenFieldHashUnit = function(pContext, pX, pY, pSalt) {
        return MapGen.Random.HashTile(pContext.Seed || 0, pX, pY, pSalt || 0) / 4294967295;
    };

    pIce.FinalOpenFieldRangeValue = function(pContext, pName, pDefaultMin, pDefaultMax, pX, pY, pSalt) {
        var value = (pContext.Profile || {})[pName];
        var min = pDefaultMin;
        var max = pDefaultMax;

        if(value instanceof Array && value.length >= 2) {
            min = Number(value[0]);
            max = Number(value[1]);
        } else if(value !== undefined && value !== null) {
            min = Number(value);
            max = min;
        }

        if(isNaN(min))
            min = pDefaultMin;
        if(isNaN(max) || max < min)
            max = min;

        return Math.round(min + ((max - min) * this.FinalOpenFieldHashUnit(pContext, pX, pY, pSalt || 0)));
    };

    pIce.FinalOpenFieldCoverReplayEnabled = function(pContext) {
        if(!pContext)
            return false;
        if(pContext._finalOpenFieldCoverReplayEnabled !== undefined)
            return pContext._finalOpenFieldCoverReplayEnabled;

        pContext._finalOpenFieldCoverReplayEnabled = !!(pContext.Profile &&
            pContext.Profile.TerrainType === Terrain.Types.Ice);
        return pContext._finalOpenFieldCoverReplayEnabled;
    };

    pIce.FinalOpenFieldHasNearbyHardEdge = function(pContext, pChars, pX, pY, pRadius) {
        var radius = Math.max(1, Math.floor(pRadius || 3));

        for(var y = pY - radius; y <= pY + radius; ++y) {
            for(var x = pX - radius; x <= pX + radius; ++x) {
                if(x < 0 || y < 0 || x >= pContext.Width || y >= pContext.Height)
                    return true;
                var ch = MapGen.Layers.Get(pChars, x, y, this.Chars.ground);
                if(ch === this.Chars.water || this.IsTreeCharValue(ch))
                    return true;
            }
        }

        return false;
    };

    pIce.FinalOpenFieldProtected = function(pContext, pX, pY, pOptions) {
        var options = pOptions || {};
        var layers = pContext.Layers || {};
        var jungle = MapGen.Terrain && MapGen.Terrain.Cover ? MapGen.Terrain.Cover : null;

        if(jungle && jungle.PathCenterNearby &&
            jungle.PathCenterNearby(pContext, pX, pY, options.pathCenterClearance || 2))
            return true;
        if(jungle && jungle.CriticalNearby &&
            jungle.CriticalNearby(pContext, pX, pY, options.criticalClearance || 5))
            return true;
        if(jungle && jungle.PlacementNearby &&
            jungle.PlacementNearby(pContext, pX, pY, options.placementClearance || 4))
            return true;

        return false;
    };

    pIce.CanStampFinalOpenFieldCover = function(pContext, pChars, pX, pY, pOptions) {
        if(pX < 0 || pY < 0 || pX >= pContext.Width || pY >= pContext.Height)
            return false;

        var ch = MapGen.Layers.Get(pChars, pX, pY, this.Chars.ground);
        if(ch !== this.Chars.ground)
            return false;

        var layers = pContext.Layers || {};
        if(MapGen.Layers.Get(layers.water, pX, pY, 0) ||
            MapGen.Layers.Get(layers.crossing, pX, pY, 0) ||
            MapGen.Layers.Get(layers.causeway, pX, pY, 0) ||
            MapGen.Layers.Get(layers.occupied, pX, pY, 0) ||
            MapGen.Layers.Get(layers.structureGround, pX, pY, 0) ||
            this.IsCliffCell(pContext, pX, pY) ||
            this.IsCliffTopApronCell(pContext, pX, pY) ||
            this.IsCliffFootApronCell(pContext, pX, pY) ||
            this.StructureGroundMaterialChar(pContext, pX, pY) ||
            this.FinalOpenFieldProtected(pContext, pX, pY, pOptions))
            return false;

        return !this.FinalOpenFieldHasNearbyHardEdge(
            pContext,
            pChars,
            pX,
            pY,
            (pOptions || {}).hardEdgeClearance || 3
        );
    };

    pIce.MarkFinalOpenFieldCover = function(pContext, pChars, pX, pY) {
        var layers = pContext.Layers || {};

        this.BackupCoverCell(pContext, pX, pY);
        MapGen.Layers.Set(pChars, pX, pY, this.Chars.tree);
        MapGen.Layers.Set(layers.blocked, pX, pY, 1);
        // Tag as render-injected so ReclaimInjectedCover can un-inject it at the
        // top of the next render (keeps the render idempotent — see Layers.js).
        if(!layers.finalFieldCover)
            layers.finalFieldCover = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
        MapGen.Layers.Set(layers.finalFieldCover, pX, pY, 1);
        MapGen.Layers.Set(layers.coast, pX, pY, 0);
        MapGen.Layers.Set(layers.riverBank, pX, pY, 0);
        MapGen.Layers.Set(layers.forcedBank, pX, pY, 0);
        MapGen.Layers.Set(layers.lakeShore, pX, pY, 0);
        MapGen.Layers.Set(layers.terrainEdge, pX, pY, 0);
        MapGen.Layers.Set(layers.path, pX, pY, 0);
        MapGen.Layers.Set(layers.keepClear, pX, pY, 0);
    };

    pIce.FinalRouteEdgeCoverRangeValue = function(pContext, pName, pFallbackName, pDefaultMin, pDefaultMax, pX, pY, pSalt) {
        var profile = pContext.Profile || {};
        var primary = profile[pName];
        var fallback = profile[pFallbackName];
        var value = primary !== undefined && primary !== null ? primary : fallback;
        var min = pDefaultMin;
        var max = pDefaultMax;

        if(value instanceof Array && value.length >= 2) {
            min = Number(value[0]);
            max = Number(value[1]);
        } else if(value !== undefined && value !== null) {
            min = Number(value);
            max = min;
        }

        if(isNaN(min))
            min = pDefaultMin;
        if(isNaN(max) || max < min)
            max = min;

        return Math.round(min + ((max - min) * this.FinalOpenFieldHashUnit(pContext, pX, pY, pSalt || 0)));
    };

    pIce.FinalRouteEdgeCoverWalkable = function(pContext, pX, pY) {
        if(pX < 0 || pY < 0 || pX >= pContext.Width || pY >= pContext.Height)
            return false;

        var layers = pContext.Layers || {};
        if(MapGen.Layers.Get(layers.crossing, pX, pY, 0))
            return true;
        if(MapGen.Layers.Get(layers.water, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(layers.riverBank, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(layers.path, pX, pY, 0))
            return true;
        if(MapGen.Terrain.BiomeStrategy.For(pContext).bankBlocksDryRoute(pContext, pX, pY))
            return false;
        if(MapGen.Layers.Get(layers.blocked, pX, pY, 0))
            return false;

        return true;
    };

    pIce.FinalRouteEdgeCoverUsesAuthoredPath = function(pContext) {
        var profile = pContext.Profile || {};
        var style = String(profile.ForcedIceLayoutStyle || profile.GrammarIceLayoutStyle || "");
        return style === "ice_forest_route" ||
            style === "ice_neck_route" ||
            style === "ice_cliff_terrace";
    };

    pIce.FinalRouteEdgeCoverPath = function(pContext) {
        var endpoints = null;
        var points = null;

        // Follow the authored route first.  A shortest-path probe through a
        // large open snow field is free to cut straight across the authored
        // curve; offsetting cover from that probe used to place most of the
        // proposed trees *inside* ROUTE_PRIMARY, where RestoreIntentRoutes
        // quite correctly removed them again.
        var paths = pContext.Paths || [];
        var best = null;
        for(var index = 0; index < paths.length; ++index) {
            var authored = paths[index];
            if(!authored || !authored.points || authored.points.length < 8)
                continue;
            if(authored.role === "dead_end" || authored.role === "repair_critical" || authored.role === "spur")
                continue;
            if(!best ||
                (authored.role === "primary" && best.role !== "primary") ||
                (authored.role === best.role && authored.points.length > best.points.length))
                best = authored;
        }
        if(best && this.FinalRouteEdgeCoverUsesAuthoredPath(pContext))
            return best;

        if(MapGen.Validate && MapGen.Validate.TacticalEndpoints && MapGen.Validate.ShortestPathWithWalkable) {
            endpoints = MapGen.Validate.TacticalEndpoints(pContext);
            if(endpoints && endpoints.start && endpoints.end) {
                var self = this;
                points = MapGen.Validate.ShortestPathWithWalkable(
                    pContext,
                    endpoints.start,
                    endpoints.end,
                    null,
                    function(pCtx, pX, pY) { return self.FinalRouteEdgeCoverWalkable(pCtx, pX, pY); }
                );
                if(points && points.length >= 8)
                    return { role: "final_route_probe", radius: 1, points: points };
            }
        }

        if(MapGen.Layout && MapGen.Layout.CriticalSites && MapGen.Layout.CriticalSites.CampaignObjectiveRoute) {
            var route = MapGen.Layout.CriticalSites.CampaignObjectiveRoute(pContext);
            if(route && route.points && route.points.length >= 8)
                return route;
        }

        if(best)
            return best;

        return null;
    };

    pIce.FinalRouteEdgeCoverPoint = function(pContext, pPath, pPointIndex, pSide, pOffset) {
        var points = pPath.points || [];
        var previous = points[Math.max(0, pPointIndex - 3)] || points[pPointIndex];
        var next = points[Math.min(points.length - 1, pPointIndex + 3)] || points[pPointIndex];
        var base = points[pPointIndex];
        var dx = next.x - previous.x;
        var dy = next.y - previous.y;
        var length = Math.max(1, Math.sqrt((dx * dx) + (dy * dy)));
        var offset = Math.max(2, Math.floor(pOffset || 3));

        return {
            x: Math.max(1, Math.min(pContext.Width - 2, Math.round(base.x + ((-dy / length) * offset * pSide)))),
            y: Math.max(1, Math.min(pContext.Height - 2, Math.round(base.y + ((dx / length) * offset * pSide))))
        };
    };

    pIce.FinalRouteEdgeCoverTangentAngle = function(pPath, pPointIndex) {
        var points = pPath.points || [];
        var previous = points[Math.max(0, pPointIndex - 3)] || points[pPointIndex];
        var next = points[Math.min(points.length - 1, pPointIndex + 3)] || points[pPointIndex];
        var dx = next.x - previous.x;
        var dy = next.y - previous.y;

        if(dx === 0 && dy === 0)
            return 0;

        return Math.atan2(dy, dx);
    };

    pIce.FinalRouteEdgeCoverNearWater = function(pContext, pChars, pX, pY, pRadius) {
        var radius = Math.max(0, Math.floor(pRadius || 0));
        var layers = pContext.Layers || {};

        for(var y = pY - radius; y <= pY + radius; ++y) {
            for(var x = pX - radius; x <= pX + radius; ++x) {
                if(x < 0 || y < 0 || x >= pContext.Width || y >= pContext.Height)
                    return true;
                if(MapGen.Layers.Get(layers.water, x, y, 0) ||
                    MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                    MapGen.Layers.Get(layers.causeway, x, y, 0))
                    return true;
                if(MapGen.Layers.Get(pChars, x, y, this.Chars.ground) === this.Chars.water)
                    return true;
            }
        }

        return false;
    };

    pIce.CanStampFinalRouteEdgeCover = function(pContext, pChars, pX, pY, pOptions) {
        var options = pOptions || {};
        function reject(pReason) {
            if(options.rejectCounts)
                options.rejectCounts[pReason] = (options.rejectCounts[pReason] || 0) + 1;
            return false;
        }

        if(pX < 0 || pY < 0 || pX >= pContext.Width || pY >= pContext.Height)
            return reject("bounds");

        var edgeClearance = Math.max(0, Math.floor(Number(
            options.edgeClearance || 0)));
        if(edgeClearance > 0 &&
            (pX < edgeClearance || pY < edgeClearance ||
             pX >= pContext.Width - edgeClearance ||
             pY >= pContext.Height - edgeClearance))
            return reject("outer");

        var ch = MapGen.Layers.Get(pChars, pX, pY, this.Chars.ground);
        if(ch !== this.Chars.ground && !(options.allowPath && ch === this.Chars.path))
            return reject("char");

        var layers = pContext.Layers || {};
        var jungle = MapGen.Terrain && MapGen.Terrain.Cover ? MapGen.Terrain.Cover : null;
        var occupied = MapGen.Layers.Get(layers.occupied, pX, pY, 0);

        if(this.IsOuterCoverBuffer(pContext, pX, pY))
            return reject("outer");
        if(MapGen.Layers.Get(layers.crossing, pX, pY, 0))
            return reject("crossing");
        if(MapGen.Layers.Get(layers.water, pX, pY, 0))
            return reject("water");
        if(MapGen.Layers.Get(layers.riverBank, pX, pY, 0) ||
            MapGen.Layers.Get(layers.forcedBank, pX, pY, 0) ||
            MapGen.Layers.Get(layers.lakeShore, pX, pY, 0) ||
            MapGen.Layers.Get(layers.coast, pX, pY, 0))
            return reject("shore");
        if(MapGen.Layers.Get(layers.causeway, pX, pY, 0))
            return reject("causeway");
        if(MapGen.Layers.Get(layers.outcrop, pX, pY, 0))
            return reject("outcrop");
        if(MapGen.Layers.Get(layers.structureGround, pX, pY, 0) ||
            this.StructureGroundMaterialChar(pContext, pX, pY))
            return reject("structureGround");
        if(occupied)
            return reject("occupied");
        if(this.IsCliffCell(pContext, pX, pY) ||
            this.IsCliffTopApronCell(pContext, pX, pY) ||
            this.IsCliffFootApronCell(pContext, pX, pY))
            return reject("cliff");
        if(MapGen.Layers.Get(layers.path, pX, pY, 0) && !options.allowPath)
            return reject("path");

        var im = pContext.IntentMap;
        var movement = MapGen.Intent && MapGen.Intent.Movement;
        if(this.FinalRouteEdgeCoverUsesAuthoredPath(pContext) &&
            im && im.movement && movement) {
            var routeFlags = movement.ROUTE_PRIMARY | movement.ROUTE_SECONDARY |
                movement.CROSSING | movement.BRIDGE;
            if(im.movement[(pY * im.width) + pX] & routeFlags)
                return reject("intentRoute");
        }

        if(layers.owner) {
            var owner = MapGen.Layers.Get(layers.owner, pX, pY, 0);
            if(owner === MapGen.Layers.Owner.WATER ||
                owner === MapGen.Layers.Owner.CLIFF ||
                owner === MapGen.Layers.Owner.STRUCTURE ||
                owner === MapGen.Layers.Owner.OBJECT)
                return reject("owner");
        }

        if(options.pathCenterLayer) {
            if(MapGen.Layers.Get(options.pathCenterLayer, pX, pY, 0))
                return reject("pathCenter");
        } else if(jungle && jungle.PathCenterNearby &&
            jungle.PathCenterNearby(pContext, pX, pY, options.pathCenterClearance || 2)) {
            return reject("pathCenter");
        }
        if(jungle && jungle.CriticalNearby &&
            jungle.CriticalNearby(pContext, pX, pY, options.criticalClearance || 4))
            return reject("critical");
        if(jungle && jungle.PlacementNearby &&
            jungle.PlacementNearby(pContext, pX, pY, options.placementClearance || 3))
            return reject("placement");
        if(this.FinalRouteEdgeCoverNearWater(
            pContext,
            pChars,
            pX,
            pY,
            options.waterClearance !== undefined ? options.waterClearance : 1
        ))
            return reject("nearWater");

        return true;
    };

    pIce.MarkFinalRouteEdgeCover = function(pContext, pChars, pX, pY) {
        var layers = pContext.Layers || {};

        this.BackupCoverCell(pContext, pX, pY);
        MapGen.Layers.Set(pChars, pX, pY, this.Chars.tree);
        MapGen.Layers.Set(layers.blocked, pX, pY, 1);
        if(!layers.finalRouteCover)
            layers.finalRouteCover = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
        MapGen.Layers.Set(layers.finalRouteCover, pX, pY, 1);
        MapGen.Layers.Set(layers.coast, pX, pY, 0);
        MapGen.Layers.Set(layers.riverBank, pX, pY, 0);
        MapGen.Layers.Set(layers.forcedBank, pX, pY, 0);
        MapGen.Layers.Set(layers.lakeShore, pX, pY, 0);
        MapGen.Layers.Set(layers.terrainEdge, pX, pY, 0);
        MapGen.Layers.Set(layers.path, pX, pY, 0);
        MapGen.Layers.Set(layers.keepClear, pX, pY, 0);
    };

    // Report how much of the late route cover actually survives the tree
    // topology and intent-route restoration passes.  `stamped` alone was
    // misleading: it described the pre-cleanup proposal, even when a later
    // pass quite correctly reshaped or removed most of that proposal.
    pIce.AuditFinalRouteEdgeCover = function(pContext, pChars) {
        var layers = pContext && pContext.Layers ? pContext.Layers : {};
        var marker = layers.finalRouteCover;
        var result = {
            marked: 0,
            survivingTree: 0,
            restoredRoute: 0,
            otherDemoted: 0,
            intentRouteMarked: 0,
            survivalFraction: 0
        };
        if(!marker || !pChars)
            return result;

        var movement = pContext.IntentMap && pContext.IntentMap.movement;
        var intentMovement = MapGen.Intent && MapGen.Intent.Movement;
        var routeFlags = intentMovement ?
            (intentMovement.ROUTE_PRIMARY | intentMovement.ROUTE_SECONDARY |
             intentMovement.CROSSING | intentMovement.BRIDGE) : 0;

        for(var y = 0; y < pContext.Height; ++y) {
            for(var x = 0; x < pContext.Width; ++x) {
                if(!MapGen.Layers.Get(marker, x, y, 0))
                    continue;
                ++result.marked;
                if(movement && routeFlags && (movement[(y * pContext.Width) + x] & routeFlags))
                    ++result.intentRouteMarked;

                var ch = MapGen.Layers.Get(pChars, x, y, this.Chars.ground);
                if(this.IsTreeCharValue(ch))
                    ++result.survivingTree;
                else if(ch === this.Chars.path || ch === this.Chars.wet)
                    ++result.restoredRoute;
                else
                    ++result.otherDemoted;
            }
        }

        result.survivalFraction = result.marked ?
            Math.round((result.survivingTree / result.marked) * 10000) / 10000 : 0;
        return result;
    };

    // Measure the authored open-field barriers after every ice-tree topology
    // and prune pass has finished. Counts at stamp time describe proposals;
    // this audit describes what the player will actually see.
    pIce.AuditOpenFieldScreens = function(pContext, pChars) {
        var layers = pContext && pContext.Layers ? pContext.Layers : {};
        var marker = layers.openFieldScreen;
        var profile = pContext.Profile || {};
        var result = {
            markedScreens: 0,
            survivingScreens: 0,
            substantialScreens: 0,
            markedTiles: 0,
            survivingTreeTiles: 0,
            survivalFraction: 0,
            screens: []
        };
        if(!marker || !pChars)
            return result;

        var byId = {};
        var id;
        var x;
        var y;
        for(y = 0; y < pContext.Height; ++y) {
            for(x = 0; x < pContext.Width; ++x) {
                id = MapGen.Layers.Get(marker, x, y, 0);
                if(!id)
                    continue;
                if(!byId[id]) {
                    byId[id] = {
                        id: id,
                        marked: 0,
                        survivingTree: 0,
                        minX: pContext.Width,
                        minY: pContext.Height,
                        maxX: -1,
                        maxY: -1,
                        cells: []
                    };
                }
                var entry = byId[id];
                ++entry.marked;
                ++result.markedTiles;
                if(this.IsTreeCharValue(MapGen.Layers.Get(
                    pChars, x, y, this.Chars.ground))) {
                    ++entry.survivingTree;
                    ++result.survivingTreeTiles;
                    entry.minX = Math.min(entry.minX, x);
                    entry.minY = Math.min(entry.minY, y);
                    entry.maxX = Math.max(entry.maxX, x);
                    entry.maxY = Math.max(entry.maxY, y);
                    entry.cells.push((y * pContext.Width) + x);
                }
            }
        }

        var minSurvival = Number(
            profile.MinRenderedOpenFieldScreenSurvivalFraction);
        var minMajorSpan = Number(profile.MinRenderedOpenFieldScreenMajorSpan);
        var minMinorSpan = Number(profile.MinRenderedOpenFieldScreenMinorSpan);
        var minComponent = Number(
            profile.MinRenderedOpenFieldScreenLargestComponent);
        if(!isFinite(minSurvival)) minSurvival = 0.22;
        if(!isFinite(minMajorSpan)) minMajorSpan = 6;
        if(!isFinite(minMinorSpan)) minMinorSpan = 2;
        if(!isFinite(minComponent)) minComponent = 8;

        for(id in byId) {
            if(!byId.hasOwnProperty(id))
                continue;
            var screen = byId[id];
            ++result.markedScreens;
            if(screen.survivingTree)
                ++result.survivingScreens;

            var visited = {};
            var largestComponent = 0;
            for(var cellIndex = 0; cellIndex < screen.cells.length; ++cellIndex) {
                var root = screen.cells[cellIndex];
                if(visited[root])
                    continue;
                visited[root] = true;
                var queue = [root];
                var queueIndex = 0;
                var componentSize = 0;
                while(queueIndex < queue.length) {
                    var cell = queue[queueIndex++];
                    ++componentSize;
                    var cellX = cell % pContext.Width;
                    var cellY = Math.floor(cell / pContext.Width);
                    var neighbours = [
                        [cellX - 1, cellY], [cellX + 1, cellY],
                        [cellX, cellY - 1], [cellX, cellY + 1]
                    ];
                    for(var neighbourIndex = 0;
                        neighbourIndex < neighbours.length;
                        ++neighbourIndex) {
                        var nx = neighbours[neighbourIndex][0];
                        var ny = neighbours[neighbourIndex][1];
                        if(nx < 0 || ny < 0 || nx >= pContext.Width ||
                            ny >= pContext.Height ||
                            MapGen.Layers.Get(marker, nx, ny, 0) != screen.id)
                            continue;
                        var neighbourCell = (ny * pContext.Width) + nx;
                        if(visited[neighbourCell] ||
                            !this.IsTreeCharValue(MapGen.Layers.Get(
                                pChars, nx, ny, this.Chars.ground)))
                            continue;
                        visited[neighbourCell] = true;
                        queue.push(neighbourCell);
                    }
                }
                largestComponent = Math.max(largestComponent, componentSize);
            }

            var spanX = screen.survivingTree ?
                screen.maxX - screen.minX + 1 : 0;
            var spanY = screen.survivingTree ?
                screen.maxY - screen.minY + 1 : 0;
            var survival = screen.marked ?
                screen.survivingTree / screen.marked : 0;
            var substantial = survival >= minSurvival &&
                Math.max(spanX, spanY) >= minMajorSpan &&
                Math.min(spanX, spanY) >= minMinorSpan &&
                largestComponent >= minComponent;
            if(substantial)
                ++result.substantialScreens;
            result.screens.push({
                id: screen.id,
                marked: screen.marked,
                survivingTree: screen.survivingTree,
                survivalFraction: Math.round(survival * 10000) / 10000,
                spanX: spanX,
                spanY: spanY,
                largestComponent: largestComponent,
                substantial: substantial
            });
        }
        result.screens.sort(function(pLeft, pRight) {
            return pLeft.id - pRight.id;
        });
        result.survivalFraction = result.markedTiles ?
            Math.round((result.survivingTreeTiles / result.markedTiles) *
                10000) / 10000 : 0;
        return result;
    };

    pIce.CollectFinalRouteEdgeCoverScreenCells = function(pContext, pChars, pCenter, pAngle, pLength, pThickness, pSalt, pOptions) {
        var length = Math.max(6, Math.floor(pLength || 10));
        var half = Math.floor(length / 2);
        var thickness = Math.max(1, Math.floor(pThickness || 1));
        var dx = Math.cos(pAngle);
        var dy = Math.sin(pAngle);
        var px = -dy;
        var py = dx;
        var pending = [];
        var seen = {};

        for(var step = -half; step <= half; ++step) {
            var taper = half > 0 ? Math.abs(step) / half : 0;

            for(var side = -thickness; side <= thickness; ++side) {
                var x = Math.round(pCenter.x + (dx * step) + (px * side));
                var y = Math.round(pCenter.y + (dy * step) + (py * side));
                var key = x + "," + y;
                var edge = Math.abs(side) === thickness;

                if(seen[key])
                    continue;
                if(!this.CanStampFinalRouteEdgeCover(pContext, pChars, x, y, pOptions))
                    continue;
                if(taper > 0.78 && this.FinalOpenFieldHashUnit(pContext, x, y, 3721 + (pSalt || 0)) < 0.30)
                    continue;
                if(edge && this.FinalOpenFieldHashUnit(pContext, x, y, 3727 + (pSalt || 0)) < 0.12)
                    continue;

                seen[key] = true;
                pending.push({ x: x, y: y });
            }
        }

        if(pending.length < Math.max(8, length)) {
            if(pOptions && pOptions.rejectCounts)
                pOptions.rejectCounts.shortScreen = (pOptions.rejectCounts.shortScreen || 0) + 1;
            return null;
        }

        return pending;
    };

    pIce.StampFinalRouteEdgeCoverCells = function(pContext, pChars, pCells) {
        if(!pCells)
            return 0;

        var stamped = 0;
        for(var index = 0; index < pCells.length; ++index) {
            if(!pCells[index])
                continue;
            this.MarkFinalRouteEdgeCover(pContext, pChars, pCells[index].x, pCells[index].y);
            ++stamped;
        }

        return stamped;
    };

    pIce.FinalRouteEdgeCoverPlanMatches = function(pContext, pPlan) {
        return !!(pContext &&
            pPlan &&
            pPlan.schema === 1 &&
            pPlan.width === pContext.Width &&
            pPlan.height === pContext.Height &&
            pPlan.ribbons instanceof Array);
    };

    pIce.ReplayFinalRouteEdgeCoverPlan = function(pContext, pChars, pPlan, pOptions) {
        var ribbons = pPlan && pPlan.ribbons instanceof Array ? pPlan.ribbons : [];
        var shaped = {
            pathLength: pPlan.pathLength || 0,
            candidates: pPlan.candidates || ribbons.length,
            ribbons: 0,
            stamped: 0,
            skipped: 0,
            forcedOutsideDirty: 0,
            replayed: true,
            rejectCounts: pPlan.rejectCounts || null
        };

        for(var ribbonIndex = 0; ribbonIndex < ribbons.length; ++ribbonIndex) {
            var cells = ribbons[ribbonIndex] && ribbons[ribbonIndex].cells instanceof Array ? ribbons[ribbonIndex].cells : [];
            var pending = [];

            for(var cellIndex = 0; cellIndex < cells.length; ++cellIndex) {
                if(!cells[cellIndex])
                    continue;

                var x = Number(cells[cellIndex].x);
                var y = Number(cells[cellIndex].y);
                if(isNaN(x) || isNaN(y)) {
                    ++shaped.skipped;
                    continue;
                }

                x = Math.floor(x);
                y = Math.floor(y);
                if(x < 0 || y < 0 || x >= pContext.Width || y >= pContext.Height) {
                    ++shaped.skipped;
                } else if(this.OutsideStructureFlushDirtyRegion(pContext, x, y)) {
                    pending.push({ x: x, y: y });
                    ++shaped.forcedOutsideDirty;
                } else if(this.CanStampFinalRouteEdgeCover(pContext, pChars, x, y, pOptions)) {
                    pending.push({ x: x, y: y });
                } else {
                    ++shaped.skipped;
                }
            }

            var stamped = this.StampFinalRouteEdgeCoverCells(pContext, pChars, pending);
            if(stamped) {
                ++shaped.ribbons;
                shaped.stamped += stamped;
            }
        }

        if((shaped.stamped || shaped.skipped) && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(
                pContext,
                "Replayed final ice route-edge cover: " + shaped.stamped + " skipped=" + shaped.skipped +
                    " forcedOutsideDirty=" + shaped.forcedOutsideDirty
            );

        return shaped;
    };

    pIce.ApplyFinalRouteEdgeCover = function(pContext, pChars) {
        var profile = pContext.Profile || {};
        if(profile.FinalRouteEdgeCover === false || profile.TerrainType !== Terrain.Types.Ice)
            return { pathLength: 0, candidates: 0, ribbons: 0, stamped: 0 };

        var path = this.FinalRouteEdgeCoverPath(pContext);
        if(!path || !path.points || path.points.length < 12)
            return { pathLength: path && path.points ? path.points.length : 0, candidates: 0, ribbons: 0, stamped: 0 };

        var spacing = Number(profile.FinalRouteEdgeCoverSpacing || profile.RouteEdgeCoverSpacing || 8);
        var chance = Number(profile.FinalRouteEdgeCoverChance !== undefined ? profile.FinalRouteEdgeCoverChance : profile.RouteEdgeCoverChance);
        var distance = Number(profile.FinalRouteEdgeCoverDistance || profile.RouteEdgeCoverDistance || 3);
        var maxRibbons = Number(profile.MaxFinalRouteEdgeCoverScreens || 12);
        var oppositeSideScale = Number(profile.FinalRouteEdgeCoverOppositeSideScale);
        var options = {
            pathCenterClearance: profile.FinalRouteEdgeCoverPathCenterClearance !== undefined ? profile.FinalRouteEdgeCoverPathCenterClearance : 2,
            criticalClearance: profile.FinalRouteEdgeCoverCriticalClearance || 4,
            placementClearance: profile.FinalRouteEdgeCoverPlacementClearance || 3,
            waterClearance: profile.FinalRouteEdgeCoverWaterClearance !== undefined ? profile.FinalRouteEdgeCoverWaterClearance : 0,
            edgeClearance: profile.FinalRouteEdgeCoverEdgeClearance || 0,
            allowPath: profile.FinalRouteEdgeCoverAllowPath !== false
        };
        options.rejectCounts = {};

        if(isNaN(spacing) || spacing <= 0)
            spacing = 8;
        if(isNaN(chance))
            chance = 0.45;
        if(isNaN(distance) || distance <= 0)
            distance = 3;
        if(isNaN(maxRibbons) || maxRibbons <= 0)
            maxRibbons = 12;
        if(isNaN(oppositeSideScale))
            oppositeSideScale = 0.40;

        spacing = Math.max(4, Math.floor(spacing));
        chance = Math.max(0, Math.min(1, chance));
        distance = Math.max(2, Math.floor(distance));
        maxRibbons = Math.max(1, Math.floor(maxRibbons));
        oppositeSideScale = Math.max(0, Math.min(1, oppositeSideScale));
        options.pathCenterLayer = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
        for(var pathIndex = 0; pathIndex < path.points.length; ++pathIndex)
            MapGen.Layers.StampDisc(
                options.pathCenterLayer,
                path.points[pathIndex].x,
                path.points[pathIndex].y,
                Math.max(0, Math.floor(options.pathCenterClearance || 0)),
                1
            );

        if(this.FinalRouteEdgeCoverPlanMatches(pContext, pContext.FinalRouteEdgeCoverPlan))
            return this.ReplayFinalRouteEdgeCoverPlan(pContext, pChars, pContext.FinalRouteEdgeCoverPlan, options);

        var shaped = { pathLength: path.points.length, candidates: 0, ribbons: 0, stamped: 0 };
        var plan = {
            schema: 1,
            width: pContext.Width,
            height: pContext.Height,
            pathLength: path.points.length,
            spacing: spacing,
            chance: chance,
            distance: distance,
            maxRibbons: maxRibbons,
            options: {
                pathCenterClearance: options.pathCenterClearance,
                criticalClearance: options.criticalClearance,
                placementClearance: options.placementClearance,
                waterClearance: options.waterClearance,
                edgeClearance: options.edgeClearance,
                allowPath: options.allowPath
            },
            rejectCounts: {},
            ribbons: []
        };

        for(var pointIndex = spacing; pointIndex < path.points.length - spacing && shaped.ribbons < maxRibbons; pointIndex += spacing) {
            var mainSide = ((Math.floor(pointIndex / spacing) + (path.role === "secondary" ? 1 : 0)) % 2) ? 1 : -1;
            var base = path.points[pointIndex];

            for(var pass = 0; pass < 2 && shaped.ribbons < maxRibbons; ++pass) {
                var side = pass === 0 ? mainSide : -mainSide;
                var sideChance = pass === 0 ? chance : chance * oppositeSideScale;
                ++shaped.candidates;

                if(this.FinalOpenFieldHashUnit(pContext, base.x + pass, base.y, 3701 + pointIndex) > sideChance)
                    continue;

                var center = this.FinalRouteEdgeCoverPoint(
                    pContext,
                    path,
                    pointIndex,
                    side,
                    (path.radius || 1) + distance
                );
                var length = Math.max(6, this.FinalRouteEdgeCoverRangeValue(
                    pContext, "FinalRouteEdgeCoverLength", "RouteEdgeCoverLength", 8, 14, center.x, center.y, 3707 + pass
                ));
                var thickness = Math.max(1, this.FinalRouteEdgeCoverRangeValue(
                    pContext, "FinalRouteEdgeCoverThickness", "RouteEdgeCoverThickness", 1, 2, center.x, center.y, 3713 + pass
                ));
                var jitter = (this.FinalOpenFieldHashUnit(pContext, center.x, center.y, 3719 + pass) - 0.5) * 0.36;
                var cells = this.CollectFinalRouteEdgeCoverScreenCells(
                    pContext,
                    pChars,
                    center,
                    this.FinalRouteEdgeCoverTangentAngle(path, pointIndex) + jitter,
                    length,
                    thickness,
                    3733 + pointIndex + pass,
                    options
                );
                var stamped = this.StampFinalRouteEdgeCoverCells(pContext, pChars, cells);

                if(stamped) {
                    ++shaped.ribbons;
                    shaped.stamped += stamped;
                    plan.ribbons.push({
                        pointIndex: pointIndex,
                        side: side,
                        center: { x: center.x, y: center.y },
                        length: length,
                        thickness: thickness,
                        cells: this.CloneFinalOpenFieldCoverCells(cells)
                    });
                }
            }
        }

        plan.candidates = shaped.candidates;
        plan.stamped = shaped.stamped;
        plan.acceptedRibbons = shaped.ribbons;
        plan.rejectCounts = options.rejectCounts;
        shaped.rejectCounts = options.rejectCounts;
        pContext.FinalRouteEdgeCoverPlan = plan;

        if(shaped.stamped && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Applied final ice route-edge cover: " + shaped.stamped);

        return shaped;
    };

    pIce.SelectFinalOpenFieldCenter = function(pContext, pChars, pBounds, pSectorIndex, pOptions) {
        var best = null;
        var centerX = (pBounds.minX + pBounds.maxX) / 2;
        var centerY = (pBounds.minY + pBounds.maxY) / 2;
        // Eligibility is stable while selecting one screen. Count each cell
        // once, including the four-cell scoring halo, then query 9x9 windows.
        // Rebuild for the next screen so newly stamped trees remain obstacles.
        var left = pBounds.minX - 4, top = pBounds.minY - 4;
        var width = pBounds.maxX - pBounds.minX + 9;
        var height = pBounds.maxY - pBounds.minY + 9, stride = width + 1;
        var eligible = new Uint8Array(width * height);
        var sums = new Uint32Array(stride * (height + 1));
        for(var row = 0; row < height; ++row) {
            var rowSum = 0;
            for(var column = 0; column < width; ++column) {
                var value = this.CanStampFinalOpenFieldCover(
                    pContext, pChars, left + column, top + row, pOptions) ? 1 : 0;
                eligible[row * width + column] = value;
                rowSum += value;
                sums[(row + 1) * stride + column + 1] = sums[row * stride + column + 1] + rowSum;
            }
        }

        for(var y = pBounds.minY; y <= pBounds.maxY; ++y) {
            for(var x = pBounds.minX; x <= pBounds.maxX; ++x) {
                var px = x - left, py = y - top;
                if(!eligible[py * width + px]) continue;
                var open = sums[(py + 5) * stride + px + 5] - sums[(py - 4) * stride + px + 5] -
                    sums[(py + 5) * stride + px - 4] + sums[(py - 4) * stride + px - 4];
                var score = open + (this.FinalOpenFieldHashUnit(pContext, x, y, 3571 + pSectorIndex) * 12);

                var dx = x - centerX;
                var dy = y - centerY;
                score += 8 - (Math.sqrt((dx * dx) + (dy * dy)) * 0.35);
                if(!best || score > best.score)
                    best = { x: x, y: y, score: score };
            }
        }

        return best;
    };

    pIce.CollectFinalOpenFieldCoverScreenCells = function(pContext, pChars, pCenter, pAngle, pLength, pThickness, pSalt, pOptions) {
        var length = Math.max(6, Math.floor(pLength || 14));
        var half = Math.floor(length / 2);
        var thickness = Math.max(1, Math.floor(pThickness || 1));
        var dx = Math.cos(pAngle);
        var dy = Math.sin(pAngle);
        var px = -dy;
        var py = dx;
        var pending = [];

        for(var step = -half; step <= half; ++step) {
            var taper = half > 0 ? Math.abs(step) / half : 0;

            for(var side = -thickness; side <= thickness; ++side) {
                var x = Math.round(pCenter.x + (dx * step) + (px * side));
                var y = Math.round(pCenter.y + (dy * step) + (py * side));
                var edge = Math.abs(side) === thickness;

                if(!this.CanStampFinalOpenFieldCover(pContext, pChars, x, y, pOptions))
                    continue;
                if(taper > 0.72 && this.FinalOpenFieldHashUnit(pContext, x, y, 3593 + (pSalt || 0)) < 0.35)
                    continue;
                if(edge && this.FinalOpenFieldHashUnit(pContext, x, y, 3599 + (pSalt || 0)) < 0.18)
                    continue;

                pending.push({ x: x, y: y });
            }
        }

        if(pending.length < Math.max(8, length))
            return null;

        return pending;
    };

    pIce.StampFinalOpenFieldCoverCells = function(pContext, pChars, pCells) {
        if(!pCells)
            return 0;

        var stamped = 0;
        for(var index = 0; index < pCells.length; ++index) {
            if(!pCells[index])
                continue;
            this.MarkFinalOpenFieldCover(pContext, pChars, pCells[index].x, pCells[index].y);
            ++stamped;
        }

        return stamped;
    };

    pIce.FinalOpenFieldCoverPlanMatches = function(pContext, pPlan) {
        return !!(pContext &&
            pPlan &&
            pPlan.schema === 1 &&
            pPlan.width === pContext.Width &&
            pPlan.height === pContext.Height &&
            pPlan.screens instanceof Array);
    };

    pIce.CloneFinalOpenFieldCoverCells = function(pCells) {
        var result = [];
        if(!(pCells instanceof Array))
            return result;

        for(var index = 0; index < pCells.length; ++index) {
            if(!pCells[index])
                continue;
            result.push({ x: pCells[index].x, y: pCells[index].y });
        }

        return result;
    };

    pIce.ReplayFinalOpenFieldCoverPlan = function(pContext, pChars, pPlan, pOptions) {
        var screens = pPlan && pPlan.screens instanceof Array ? pPlan.screens : [];
        var shaped = {
            sectors: pPlan.sectors || 0,
            candidates: pPlan.candidates || 0,
            screens: 0,
            stamped: 0,
            replayed: true,
            replayScreens: screens.length,
            skipped: 0,
            forcedOutsideDirty: 0
        };

        for(var screenIndex = 0; screenIndex < screens.length; ++screenIndex) {
            var screen = screens[screenIndex] || {};
            var cells = screen.cells instanceof Array ? screen.cells : null;
            if(!cells && screen.center) {
                cells = this.CollectFinalOpenFieldCoverScreenCells(
                    pContext,
                    pChars,
                    screen.center,
                    screen.angle,
                    screen.length,
                    screen.thickness,
                    screen.salt,
                    pOptions
                );
            }
            if(!cells || !cells.length)
                continue;

            var pending = [];
            for(var cellIndex = 0; cellIndex < cells.length; ++cellIndex) {
                if(!cells[cellIndex])
                    continue;

                var x = Number(cells[cellIndex].x);
                var y = Number(cells[cellIndex].y);
                if(isNaN(x) || isNaN(y)) {
                    ++shaped.skipped;
                    continue;
                }

                x = Math.floor(x);
                y = Math.floor(y);
                if(x < 0 || y < 0 || x >= pContext.Width || y >= pContext.Height) {
                    ++shaped.skipped;
                } else if(this.OutsideStructureFlushDirtyRegion(pContext, x, y)) {
                    pending.push({ x: x, y: y });
                    ++shaped.forcedOutsideDirty;
                } else if(this.CanStampFinalOpenFieldCover(pContext, pChars, x, y, pOptions)) {
                    pending.push({ x: x, y: y });
                } else {
                    ++shaped.skipped;
                }
            }

            if(!pending.length)
                continue;

            var stamped = this.StampFinalOpenFieldCoverCells(pContext, pChars, pending);
            if(stamped) {
                ++shaped.screens;
                shaped.stamped += stamped;
            }
        }

        if((shaped.stamped || shaped.skipped) && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(
                pContext,
                "Replayed final ice open-field cover: " + shaped.stamped + " skipped=" + shaped.skipped +
                    " forcedOutsideDirty=" + shaped.forcedOutsideDirty
            );

        return shaped;
    };

    pIce.ApplyFinalOpenFieldCover = function(pContext, pChars) {
        var profile = pContext.Profile || {};
        if(profile.FinalOpenFieldCover === false || profile.TerrainType !== Terrain.Types.Ice)
            return { sectors: 0, candidates: 0, screens: 0, stamped: 0 };

        var sectorSize = Math.max(8, this.FinalOpenFieldRangeValue(pContext, "FinalOpenFieldCoverSectorSize", 10, 14, 0, 0, 3541));
        var minOpenFraction = Number(profile.FinalOpenFieldCoverMinOpenFraction);
        var minOpenTiles = Number(profile.FinalOpenFieldCoverMinOpenTiles);
        var maxScreens = Number(profile.MaxFinalOpenFieldCoverScreens);
        var options = {
            pathCenterClearance: profile.FinalOpenFieldCoverPathCenterClearance || 2,
            criticalClearance: profile.FinalOpenFieldCoverCriticalClearance || 5,
            placementClearance: profile.FinalOpenFieldCoverPlacementClearance || 4,
            hardEdgeClearance: profile.FinalOpenFieldCoverHardEdgeClearance || 3
        };
        var used = [];
        var shaped = { sectors: 0, candidates: 0, screens: 0, stamped: 0 };
        var replayEnabled = this.FinalOpenFieldCoverReplayEnabled(pContext);
        var sectors = [];

        if(isNaN(minOpenFraction) || minOpenFraction <= 0)
            minOpenFraction = 0.52;
        if(isNaN(minOpenTiles) || minOpenTiles <= 0)
            minOpenTiles = Math.floor(sectorSize * sectorSize * 0.42);
        if(isNaN(maxScreens) || maxScreens <= 0)
            maxScreens = 36;

        var minSpacingSq = Math.max(36, Math.floor(sectorSize * sectorSize * 0.30));

        if(replayEnabled && this.FinalOpenFieldCoverPlanMatches(pContext, pContext.FinalOpenFieldCoverPlan))
            return this.ReplayFinalOpenFieldCoverPlan(pContext, pChars, pContext.FinalOpenFieldCoverPlan, options);

        var replayPlan = replayEnabled ? {
            schema: 1,
            width: pContext.Width,
            height: pContext.Height,
            sectorSize: sectorSize,
            minOpenFraction: minOpenFraction,
            minOpenTiles: minOpenTiles,
            maxScreens: maxScreens,
            minSpacingSq: minSpacingSq,
            options: {
                pathCenterClearance: options.pathCenterClearance,
                criticalClearance: options.criticalClearance,
                placementClearance: options.placementClearance,
                hardEdgeClearance: options.hardEdgeClearance
            },
            sectors: 0,
            candidates: 0,
            stamped: 0,
            screens: []
        } : null;

        // Select from the whole map rather than filling row-major until the
        // cap. On large canvases the old ordering never inspected later rows,
        // producing a characteristic dense top / empty bottom split.
        for(var buildY = 0; buildY < pContext.Height; buildY += sectorSize) {
            for(var buildX = 0; buildX < pContext.Width; buildX += sectorSize) {
                sectors.push({
                    x: buildX,
                    y: buildY,
                    ordinal: sectors.length + 1,
                    priority: this.FinalOpenFieldHashUnit(pContext, buildX, buildY, 4591)
                });
            }
        }
        sectors.sort(function(pLeft, pRight) {
            if(pLeft.priority !== pRight.priority)
                return pLeft.priority - pRight.priority;
            return pLeft.ordinal - pRight.ordinal;
        });

        for(var sectorIndex = 0;
            sectorIndex < sectors.length && shaped.screens < maxScreens;
            ++sectorIndex) {
                var sector = sectors[sectorIndex];
                var sx = sector.x;
                var sy = sector.y;
                var bounds = {
                    minX: sx,
                    minY: sy,
                    maxX: Math.min(pContext.Width - 1, sx + sectorSize - 1),
                    maxY: Math.min(pContext.Height - 1, sy + sectorSize - 1)
                };
                var total = 0;
                var open = 0;

                ++shaped.sectors;
                for(var y = bounds.minY; y <= bounds.maxY; ++y) {
                    for(var x = bounds.minX; x <= bounds.maxX; ++x) {
                        ++total;
                        if(this.CanStampFinalOpenFieldCover(pContext, pChars, x, y, options))
                            ++open;
                    }
                }

                if(total <= 0 || open < minOpenTiles || (open / total) < minOpenFraction)
                    continue;

                ++shaped.candidates;
                var center = this.SelectFinalOpenFieldCenter(pContext, pChars, bounds, sector.ordinal, options);
                if(!center)
                    continue;

                var spaced = true;
                for(var usedIndex = 0; usedIndex < used.length; ++usedIndex) {
                    var ux = used[usedIndex].x - center.x;
                    var uy = used[usedIndex].y - center.y;
                    if((ux * ux) + (uy * uy) < minSpacingSq) {
                        spaced = false;
                        break;
                    }
                }
                if(!spaced)
                    continue;

                var angle = this.FinalOpenFieldHashUnit(pContext, sx, sy, 3547) < 0.58 ? 0 : Math.PI / 2;
                angle += (this.FinalOpenFieldHashUnit(pContext, center.x, center.y, 3551) - 0.5) * 0.42;
                var length = this.FinalOpenFieldRangeValue(pContext, "FinalOpenFieldCoverLength", 14, 24, center.x, center.y, 3553);
                var thickness = this.FinalOpenFieldRangeValue(pContext, "FinalOpenFieldCoverThickness", 1, 2, center.x, center.y, 3557);
                var salt = 3613 + sector.ordinal;
                var screenCells = this.CollectFinalOpenFieldCoverScreenCells(
                    pContext,
                    pChars,
                    center,
                    angle,
                    length,
                    thickness,
                    salt,
                    options
                );
                var stamped = this.StampFinalOpenFieldCoverCells(pContext, pChars, screenCells);

                if(stamped) {
                    ++shaped.screens;
                    shaped.stamped += stamped;
                    used.push({ x: center.x, y: center.y });
                    if(replayPlan) {
                        replayPlan.screens.push({
                            sector: sector.ordinal,
                            sectorX: sx,
                            sectorY: sy,
                            bounds: {
                                minX: bounds.minX,
                                minY: bounds.minY,
                                maxX: bounds.maxX,
                                maxY: bounds.maxY
                            },
                            center: { x: center.x, y: center.y },
                            angle: angle,
                            length: length,
                            thickness: thickness,
                            salt: salt,
                            cells: this.CloneFinalOpenFieldCoverCells(screenCells)
                        });
                    }
                }
        }

        if(replayPlan) {
            replayPlan.sectors = shaped.sectors;
            replayPlan.candidates = shaped.candidates;
            replayPlan.stamped = shaped.stamped;
            replayPlan.acceptedScreens = shaped.screens;
            pContext.FinalOpenFieldCoverPlan = replayPlan;
        }

        if(shaped.stamped && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Applied final ice open-field cover: " + shaped.stamped);

        return shaped;
    };

    // Clearance is final here: recover a missing ice apron by retreating the
    // water edge, keeping building floors, spawn space and routes untouched.
    // Two deferred passes suffice to restore the snow/ice/shallow/deep ladder.
    pIce.RepairClearedShoreChars = function(pContext, pChars) {
        var water = this.Chars.water, bank = this.Chars.bank, wet = this.Chars.wet;
        var ground = this.Chars.ground, path = this.Chars.path, pending = [];
        var get = MapGen.Layers.Get;
        function rank(x, y) {
            var ch = get(pChars, x, y, "");
            return ch === ground || ch === path ? 0 : ch === wet ? 1 : 3;
        }
        for(var y = 0; y < pContext.Height; ++y) {
            for(var x = 0; x < pContext.Width; ++x) {
                var ch = pChars[x][y];
                if(ch !== water && ch !== bank) continue;
                var neighbour = Math.min(rank(x - 1, y), rank(x + 1, y),
                    rank(x, y - 1), rank(x, y + 1));
                if(neighbour === 0)
                    pending.push({x: x, y: y, value: wet});
                else if(ch === water && neighbour === 1)
                    pending.push({x: x, y: y, value: bank});
            }
        }
        for(var i = 0; i < pending.length; ++i) {
            var cell = pending[i];
            pChars[cell.x][cell.y] = cell.value;
        }
        return pending.length;
    };

    pIce.RepairDirectWaterGroundChars = function(pContext, pChars) {
        var changed = 0;
        var layers = pContext.Layers || {};
        var Get = MapGen.Layers.Get;
        var Set = MapGen.Layers.Set;
        var WATER = this.Chars.water;
        var BANK = this.Chars.bank;
        var WET = this.Chars.wet;
        var GROUND = this.Chars.ground;
        var PATH = this.Chars.path;
        var pending = [];

        function charAt(x, y) {
            return Get(pChars, x, y, GROUND);
        }

        function hasCardinalChar(x, y, value) {
            return charAt(x, y - 1) === value ||
                charAt(x - 1, y) === value ||
                charAt(x + 1, y) === value ||
                charAt(x, y + 1) === value;
        }

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                var ch = charAt(x, y);
                if(ch !== GROUND && ch !== PATH)
                    continue;
                if(Get(layers.crossing, x, y, 0) ||
                    Get(layers.causeway, x, y, 0))
                    continue;

                if(hasCardinalChar(x, y, WATER))
                    pending.push({ x: x, y: y, value: ch === PATH ? WET : BANK });
                else if(hasCardinalChar(x, y, BANK))
                    pending.push({ x: x, y: y, value: WET });
            }
        }

        for(var index = 0; index < pending.length; ++index) {
            var cell = pending[index];
            if(Set(pChars, cell.x, cell.y, cell.value))
                ++changed;
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Repaired direct ice water/ground chars: " + changed);

        return changed;
    };

    pIce.RepairDirectWaterIceChars = function(pContext, pChars) {
        var changed = 0;
        var layers = pContext.Layers || {};
        var self = this;
        var Get = MapGen.Layers.Get;
        var Set = MapGen.Layers.Set;
        var WATER = this.Chars.water;
        var WET = this.Chars.wet;
        var BANK = this.Chars.bank;
        var GROUND = this.Chars.ground;
        var PATH = this.Chars.path;
        var TREE = this.Chars.tree;
        var pending = [];

        function charAt(x, y) {
            // Off-map cells are not water contacts. Treating them as water
            // repeatedly turns the newly repaired perimeter ice into bank.
            return Get(pChars, x, y, GROUND);
        }

        function protectedCell(x, y) {
            var occupied = Get(layers.occupied, x, y, 0);
            return Get(layers.crossing, x, y, 0) ||
                Get(layers.causeway, x, y, 0) ||
                Get(layers.coast, x, y, 0) ||
                (occupied && occupied !== 1 && occupied !== "live_structure_clearance") ||
                self.StructureGroundMaterialChar(pContext, x, y) ||
                self.HasNearbyStructureArt(pContext, x, y, 2) ||
                self.IsCliffCell(pContext, x, y) ||
                self.IsCliffTopApronCell(pContext, x, y);
        }

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(charAt(x, y) !== WET)
                    continue;
                if(protectedCell(x, y))
                    continue;

                var wetCardinals = 0;
                var bankCardinals = 0;
                var landCardinals = 0;
                var touchesWater = false;
                var neighbours = [
                    charAt(x, y - 1),
                    charAt(x + 1, y),
                    charAt(x, y + 1),
                    charAt(x - 1, y)
                ];

                for(var n = 0; n < neighbours.length; ++n) {
                    var ch = neighbours[n];
                    if(ch === WATER) {
                        touchesWater = true;
                    }
                    else if(ch === WET) {
                        ++wetCardinals;
                    }
                    else if(ch === BANK) {
                        ++bankCardinals;
                    }
                    else if(ch === GROUND || ch === PATH || ch === TREE) {
                        ++landCardinals;
                    }
                }

                if(!touchesWater)
                    continue;

                pending.push({
                    x: x,
                    y: y,
                    value: (wetCardinals <= 1 && bankCardinals === 0 && landCardinals === 0) ? WATER : BANK
                });
            }
        }

        for(var index = 0; index < pending.length; ++index) {
            var cell = pending[index];
            if(Set(pChars, cell.x, cell.y, cell.value))
                ++changed;
        }

        if(changed && MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Repaired direct ice water/ice chars: " + changed);

        return changed;
    };

    pIce.IceSoftHazardTargetMaxCount = function(pContext, pFallback) {
        var targets = pContext && pContext.Profile && pContext.Profile.TargetPack ?
            pContext.Profile.TargetPack.targets || {} :
            {};
        var terrain = targets.composition && targets.composition.terrainComposition ?
            targets.composition.terrainComposition :
            {};
        var stats = terrain.passabilityFractions ? terrain.passabilityFractions.soft_hazard : null;
        var range = stats && stats.targetRange && stats.targetRange.length >= 2 ?
            stats.targetRange :
            (stats && stats.wideRange && stats.wideRange.length >= 2 ? stats.wideRange : null);
        var max = range ? Number(range[1]) : NaN;

        if(!isFinite(max))
            return pFallback;

        return Math.floor(max * pContext.Width * pContext.Height);
    };

    pIce.DistanceSqToIceWaterChar = function(pChars, pX, pY, pRadius) {
        var best = -1;
        var radius = pRadius || 8;

        for(var dy = -radius; dy <= radius; ++dy) {
            for(var dx = -radius; dx <= radius; ++dx) {
                if(dx === 0 && dy === 0)
                    continue;

                var ch = MapGen.Terrain.Smoothing.Core.GetChar(
                    pChars,
                    pX + dx,
                    pY + dy,
                    this.Chars.ground
                );
                if(ch !== this.Chars.water && ch !== this.Chars.bank)
                    continue;

                var distSq = (dx * dx) + (dy * dy);
                if(best < 0 || distSq < best)
                    best = distSq;
            }
        }

        return best < 0 ? (radius + 1) * (radius + 1) : best;
    };

    pIce.HasNearIceWaterChar = function(pChars, pX, pY, pRadius) {
        return this.DistanceSqToIceWaterChar(pChars, pX, pY, pRadius) <= (pRadius * pRadius);
    };

    pIce.ApplyIceSoftHazardBudgetChars = function(pContext, pChars) {
        if(!pContext || !pContext.Profile ||
            pContext.Profile.GeneratorCore !== "official_grammar" ||
            pContext.Profile.TargetPackProfile !== "grammar_ice" ||
            pContext.Profile.TerrainType !== Terrain.Types.Ice)
            return 0;

        var wetCount = 0;
        var candidates = [];
        var layers = pContext.Layers || {};
        var total = pContext.Width * pContext.Height;
        var targetMax = this.IceSoftHazardTargetMaxCount(pContext, Math.floor(total * 0.195));

        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                var ch = MapGen.Layers.Get(pChars, x, y, this.Chars.ground);
                if(ch !== this.Chars.wet)
                    continue;

                ++wetCount;

                if(this.IsProtectedChar(pContext, x, y))
                    continue;
                if(MapGen.Layers.Get(layers.water, x, y, 0) ||
                    MapGen.Layers.Get(layers.riverBank, x, y, 0) ||
                    MapGen.Layers.Get(layers.crossing, x, y, 0) ||
                    MapGen.Layers.Get(layers.structureGround, x, y, 0))
                    continue;
                if(this.StructureGroundMaterialChar(pContext, x, y) ||
                    this.HasNearbyStructureArt(pContext, x, y, 3))
                    continue;
                if(this.HasNearIceWaterChar(pChars, x, y, 2))
                    continue;

                var waterDistSq = this.DistanceSqToIceWaterChar(pChars, x, y, 8);
                candidates.push({
                    x: x,
                    y: y,
                    waterDistSq: waterDistSq,
                    score: ((((pContext.Seed || 0) ^ (x * 73856093) ^ (y * 19349663) ^ ((8801 + candidates.length) * 83492791)) | 0) >>> 0)
                });
            }
        }

        var need = Math.max(0, wetCount - targetMax);
        if(need <= 0 || !candidates.length)
            return 0;

        candidates.sort(function(pLeft, pRight) {
            if(pLeft.waterDistSq !== pRight.waterDistSq)
                return pRight.waterDistSq - pLeft.waterDistSq;
            if(pLeft.score !== pRight.score)
                return pLeft.score - pRight.score;
            // Total-order tiebreak on unique cell coords (the hashed score can
            // collide; the engine's Array.sort is unstable).
            if(pLeft.x !== pRight.x)
                return pLeft.x - pRight.x;
            return pLeft.y - pRight.y;
        });

        var changed = Math.min(need, candidates.length);
        for(var index = 0; index < changed; ++index)
            MapGen.Layers.Set(pChars, candidates[index].x, candidates[index].y, this.Chars.ground);

        var live = MapGen.Grammar.LiveMaterialization.Ensure(pContext);
        live.iceSoftHazardDemotedChars = changed;
        live.iceSoftHazardSource = "ice_char_wet_interior";
        live.iceSoftHazardTargetMaxChars = targetMax;
        MapGen.Context.AddLog(pContext, "Applied ice soft-hazard wet-char budget: " + changed);

        return changed;
    };
})(MapGen.Terrain.Smoothing.Ice);
