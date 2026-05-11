var MapGen = MapGen || {};
MapGen.Integration = MapGen.Integration || {};

(function(pIntegration) {
    pIntegration.IncludeStructureFlushDirtyRect = function(pRegion, pMinX, pMinY, pMaxX, pMaxY) {
        if(pMinX > pMaxX || pMinY > pMaxY)
            return pRegion;

        if(!pRegion)
            return { minX: pMinX, minY: pMinY, maxX: pMaxX, maxY: pMaxY };

        if(pMinX < pRegion.minX) pRegion.minX = pMinX;
        if(pMinY < pRegion.minY) pRegion.minY = pMinY;
        if(pMaxX > pRegion.maxX) pRegion.maxX = pMaxX;
        if(pMaxY > pRegion.maxY) pRegion.maxY = pMaxY;
        return pRegion;
    };

    pIntegration.StructureFlushDirtyRegion = function(pContext, pMargin) {
        if(!pContext)
            return null;

        var margin = pMargin || 0;
        var region = null;
        var source = "none";

        if(pContext._structureTerrainDirtyBounds) {
            var tracked = pContext._structureTerrainDirtyBounds;
            region = this.IncludeStructureFlushDirtyRect(
                region,
                tracked.minX,
                tracked.minY,
                tracked.maxX,
                tracked.maxY
            );
            source = "painted_cells";
        }

        if(!region) {
            var placements = pContext.LiveStructurePlacements || [];
            for(var index = 0; index < placements.length; ++index) {
                var placement = placements[index];
                if(!placement || !placement.rect)
                    continue;

                var clearance = this.StructureClearance(placement.spec || {});
                region = this.IncludeStructureFlushDirtyRect(
                    region,
                    placement.rect.minX - clearance.left,
                    placement.rect.minY - clearance.top,
                    placement.rect.maxX + clearance.right,
                    placement.rect.maxY + clearance.bottom
                );

                if(placement.accessPoint)
                    region = this.IncludeStructureFlushDirtyRect(region, placement.accessPoint.x, placement.accessPoint.y, placement.accessPoint.x, placement.accessPoint.y);
                if(placement.accessTarget)
                    region = this.IncludeStructureFlushDirtyRect(region, placement.accessTarget.x, placement.accessTarget.y, placement.accessTarget.x, placement.accessTarget.y);
            }
            if(region)
                source = "placements";
        }

        if(!region)
            return null;

        region = {
            minX: Math.max(0, region.minX - margin),
            minY: Math.max(0, region.minY - margin),
            maxX: Math.min(pContext.Width - 1, region.maxX + margin),
            maxY: Math.min(pContext.Height - 1, region.maxY + margin),
            margin: margin,
            source: source,
            paintedCells: pContext._structureTerrainDirtyCellCount || 0,
            placementCount: pContext.LiveStructurePlacements ? pContext.LiveStructurePlacements.length : 0
        };

        return region;
    };

    pIntegration.StructureFlushCellInRegion = function(pRegion, pX, pY) {
        return !!pRegion &&
            pX >= pRegion.minX &&
            pX <= pRegion.maxX &&
            pY >= pRegion.minY &&
            pY <= pRegion.maxY;
    };

    pIntegration.ClearStructureFlushDirtyTracking = function(pContext) {
        if(!pContext)
            return;

        pContext._structureTerrainDirtyBounds = null;
        pContext._structureTerrainDirtyCellMask = null;
        pContext._structureTerrainDirtyCellCount = 0;
    };

    pIntegration.StructureFlushCoverLayerNames = [
        "blocked", "coast", "riverBank", "forcedBank", "lakeShore", "terrainEdge",
        "path", "keepClear", "outcrop", "occupied",
        "structureGroundMaterial", "structurePlainGround",
        "perimeterCover", "finalFieldCover", "finalRouteCover", "softFillCover",
        "structureContextCover"
    ];

    pIntegration.CloneStructureFlushRenderState = function(pContext) {
        if(!pContext || !pContext.Layers)
            return null;

        var layers = {};
        var names = this.StructureFlushCoverLayerNames;
        for(var index = 0; index < names.length; ++index) {
            var name = names[index];
            if(pContext.Layers[name])
                layers[name] = MapGen.Layers.Clone(pContext.Layers[name]);
        }

        var backup = {};
        var source = pContext._coverBackup || {};
        for(var key in source) {
            if(!Object.prototype.hasOwnProperty.call(source, key))
                continue;
            var snap = source[key] || {};
            var copy = {};
            for(var layerName in snap) {
                if(Object.prototype.hasOwnProperty.call(snap, layerName))
                    copy[layerName] = snap[layerName];
            }
            backup[key] = copy;
        }

        return {
            layers: layers,
            coverBackup: backup
        };
    };

    pIntegration.StructureFlushKeyInRegion = function(pKey, pDirtyRegion) {
        var comma = pKey.indexOf(",");
        if(comma < 0)
            return false;

        var x = Number(pKey.substr(0, comma));
        var y = Number(pKey.substr(comma + 1));
        return this.StructureFlushCellInRegion(pDirtyRegion, x, y);
    };

    pIntegration.RestoreStructureFlushRenderStateOutsideRegion = function(pContext, pSnapshot, pDirtyRegion) {
        if(!pContext || !pSnapshot || !pSnapshot.layers || !pDirtyRegion)
            return;

        var names = this.StructureFlushCoverLayerNames;
        for(var nameIndex = 0; nameIndex < names.length; ++nameIndex) {
            var name = names[nameIndex];
            var before = pSnapshot.layers[name] || null;
            var target = pContext.Layers[name];
            if(!target)
                continue;

            for(var x = 0; x < pContext.Width; ++x) {
                for(var y = 0; y < pContext.Height; ++y) {
                    if(this.StructureFlushCellInRegion(pDirtyRegion, x, y))
                        continue;
                    MapGen.Layers.Set(target, x, y, before ? MapGen.Layers.Get(before, x, y, 0) : 0);
                }
            }
        }

        var current = pContext._coverBackup || {};
        var merged = {};
        for(var currentKey in current) {
            if(!Object.prototype.hasOwnProperty.call(current, currentKey))
                continue;
            if(this.StructureFlushKeyInRegion(currentKey, pDirtyRegion))
                merged[currentKey] = current[currentKey];
        }
        var beforeBackup = pSnapshot.coverBackup || {};
        for(var beforeKey in beforeBackup) {
            if(!Object.prototype.hasOwnProperty.call(beforeBackup, beforeKey))
                continue;
            if(!this.StructureFlushKeyInRegion(beforeKey, pDirtyRegion))
                merged[beforeKey] = beforeBackup[beforeKey];
        }
        pContext._coverBackup = merged;
    };

    pIntegration.ApplyPreparedStructureTerrain = function(pContext) {
        if(!pContext || !pContext.StructureTerrainDirty)
            return;
        if(!MapGen.Render || !MapGen.Render.BuildTileLayer || !MapGen.Render.ApplyTileLayerToMap)
            return;
        if(typeof Map === "undefined")
            return;

        // PERF: each call full-smooths the WHOLE map (~7s on ice) to clear access
        // tiles around the structures placed so far. During multi-step placement
        // (enemy buildings -> objectives -> civilian buildings) that ran 3-4x. When
        // batching is on, intermediate calls leave the dirty flag set and skip the
        // render; FlushStructureTerrain renders ONCE at the end (before pickups/decor/
        // sprite groups read the committed map). NOTE: the render is not idempotent
        // (open-field/perimeter cover writes `blocked`, which feeds the next render's
        // char map), so collapsing the renders LEGITIMATELY CHANGES OUTPUT: cover is
        // computed once from clean structural inputs instead of compounding across
        // renders. Gate re-baselined for this deliberate, cleaner result.
        if(pContext._deferStructureRender)
            return;

        var localFlushEnabled = !pContext._forceFullStructureRender && this.StructureFlushLocalEnabled(pContext);
        var dirtyRegion = localFlushEnabled ? this.StructureFlushDirtyRegion(pContext, 4) : null;
        var dirtyCells = dirtyRegion ? (dirtyRegion.maxX - dirtyRegion.minX + 1) *
            (dirtyRegion.maxY - dirtyRegion.minY + 1) : pContext.Width * pContext.Height;
        var stats = pContext.StructureRenderStats || { renders: 0, full: 0, local: 0, elapsedMs: 0 };
        pContext.StructureRenderStats = stats;
        stats.renders++;
        stats.dirtyFraction = dirtyCells / (pContext.Width * pContext.Height);
        stats.paintedCells = pContext._structureTerrainDirtyCellCount || 0;
        var renderStart = (new Date()).getTime();
        // A region containing every tile needs no previous-grid cloning or
        // outside-region restoration. Preserve the full smoothing semantics.
        if(dirtyCells === pContext.Width * pContext.Height) localFlushEnabled = false;
        if(localFlushEnabled) stats.local++; else stats.full++;
        var beforeTiles = (localFlushEnabled && pContext.RenderedMap && pContext.RenderedMap.Tiles) ?
            MapGen.Layers.Clone(pContext.RenderedMap.Tiles) :
            null;
        var beforeRenderState = localFlushEnabled ?
            this.CloneStructureFlushRenderState(pContext) :
            null;
        if(!localFlushEnabled) dirtyRegion = null;

        var previousRenderDirtyRegion = pContext._structureFlushRenderDirtyRegion || null;
        pContext._structureFlushRenderDirtyRegion = dirtyRegion || null;
        try {
            if(localFlushEnabled && beforeTiles && dirtyRegion) {
                MapGen.Render.BuildTileLayer(pContext, {
                    DirtyRegion: dirtyRegion,
                    PreviousTiles: beforeTiles,
                    StructureFlushLocal: true
                });
                this.RestoreStructureFlushRenderStateOutsideRegion(pContext, beforeRenderState, dirtyRegion);
            } else {
                MapGen.Render.BuildTileLayer(pContext);
            }
        } finally {
            pContext._structureFlushRenderDirtyRegion = previousRenderDirtyRegion;
        }
        MapGen.Render.ApplyTileLayerToMap(pContext, Map);
        this.RepaintLiveStructureTiles(pContext);
        var plainAprons = this.PaintIceStructurePlainAprons(pContext);
        stats.elapsedMs += (new Date()).getTime() - renderStart;
        pContext.StructureTerrainDirty = false;
        pContext._forceFullStructureRender = false;
        this.ClearStructureFlushDirtyTracking(pContext);

        if(MapGen.Context && MapGen.Context.AddLog)
            MapGen.Context.AddLog(pContext, "Re-rendered terrain after structure access clearing; plainAprons=" + plainAprons);
    };

    // Render batching: BeginDeferredStructureTerrain makes intermediate
    // ApplyPreparedStructureTerrain calls no-op (leaving the dirty flag set);
    // FlushStructureTerrain forces the single render. Safe to call when not batching.
    pIntegration.BeginDeferredStructureTerrain = function(pContext) {
        if(pContext)
            pContext._deferStructureRender = true;
    };

    pIntegration.FlushStructureTerrain = function(pContext) {
        if(!pContext)
            return;
        pContext._deferStructureRender = false;
        this.ApplyPreparedStructureTerrain(pContext);
    };

})(MapGen.Integration);
