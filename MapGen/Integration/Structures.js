var MapGen = MapGen || {};
MapGen.Integration = MapGen.Integration || {};

(function(pIntegration) {
    pIntegration.FlattenBuildings = function(pBuildings) {
        var buildings = [];

        if(!pBuildings)
            return buildings;

        for(var building in pBuildings) {
            if(!pBuildings.hasOwnProperty(building))
                continue;

            for(var sprite in pBuildings[building]) {
                if(!pBuildings[building].hasOwnProperty(sprite))
                    continue;

                var count = Math.max(0, Math.floor(pBuildings[building][sprite] || 0));
                for(var index = 0; index < count; ++index) {
                    buildings.push({
                        building: building,
                        sprite: sprite
                    });
                }
            }
        }

        return buildings;
    };

    pIntegration.StructurePurpose = function(pSpec, pPurpose) {
        if(pPurpose)
            return pPurpose;

        var building = (pSpec.building || "").toLowerCase();
        var sprite = (pSpec.sprite || "").toLowerCase();

        if(building === "barracks" || building === "bunker" || sprite.indexOf("soldier") >= 0)
            return "enemy";

        return "civilian";
    };

    pIntegration.StructureInfo = function(pSpec, pContext) {
        var info = Structures.GetStructInfo(pSpec.building,
            pContext && pContext.Profile ? pContext.Profile.TerrainType : undefined);

        if(!info || !info.Struct || !info.Struct.length)
            return null;
        var sub = pContext && pContext.Profile ?
            (Number(pContext.Profile.TerrainTypeSub || 0) === 1 ? "sub1" : "sub0") :
            Structures.GetActiveSubVariant();
        if(info.SubVariantsAllowed && info.SubVariantsAllowed.indexOf(sub) < 0)
            return null;

        var struct = info.Struct[0];
        var bounds = Structures.StructureBounds(struct);

        return {
            info: info,
            struct: struct,
            bounds: bounds,
            width: bounds.maxX - bounds.minX + 1,
            height: bounds.maxY - bounds.minY + 1,
            centerOffsetX: Math.floor((bounds.minX + bounds.maxX) / 2),
            centerOffsetY: Math.floor((bounds.minY + bounds.maxY) / 2)
        };
    };

    pIntegration.StructureRect = function(pTileX, pTileY, pInfo) {
        return {
            minX: pTileX + pInfo.bounds.minX,
            minY: pTileY + pInfo.bounds.minY,
            maxX: pTileX + pInfo.bounds.maxX,
            maxY: pTileY + pInfo.bounds.maxY
        };
    };

    pIntegration.RectDistance = function(pLeft, pRight) {
        var dx = 0;
        var dy = 0;

        if(pLeft.maxX < pRight.minX)
            dx = pRight.minX - pLeft.maxX;
        else if(pRight.maxX < pLeft.minX)
            dx = pLeft.minX - pRight.maxX;

        if(pLeft.maxY < pRight.minY)
            dy = pRight.minY - pLeft.maxY;
        else if(pRight.maxY < pLeft.minY)
            dy = pLeft.minY - pRight.maxY;

        return Math.sqrt((dx * dx) + (dy * dy));
    };

    pIntegration.StructureSpacing = function(pSpec, pContext) {
        var building = (pSpec.building || "").toLowerCase();
        var spacing;

        if(building === "hut")
            spacing = 5;
        else
            spacing = 4;

        if(pContext && pContext.Profile && typeof pContext.Profile.StructureMinSpacing === "number")
            spacing = Math.max(spacing, Math.floor(pContext.Profile.StructureMinSpacing));
        if(pContext && pContext.Profile && typeof pContext.Profile.LiveStructureMinSpacing === "number")
            spacing = Math.max(spacing, Math.floor(pContext.Profile.LiveStructureMinSpacing));

        return spacing;
    };

    pIntegration.StructureSiteConflictsPlaced = function(pRect, pPlaced, pSpacing) {
        for(var index = 0; index < pPlaced.length; ++index) {
            if(this.RectDistance(pRect, pPlaced[index].rect) < pSpacing)
                return true;
        }

        return false;
    };

    pIntegration.LiveStructurePlacementsAsPlaced = function(pContext) {
        var placed = [];
        var placements = pContext && pContext.LiveStructurePlacements ?
            pContext.LiveStructurePlacements :
            [];

        for(var index = 0; index < placements.length; ++index) {
            var placement = placements[index];
            if(!placement || !placement.rect)
                continue;

            placed.push({
                rect: placement.rect,
                purpose: placement.purpose || "",
                clearingIndex: -1
            });
        }

        return placed;
    };

    pIntegration.SessionStructureRect = function(pPosition, pWidth, pHeight) {
        var tileX = Math.floor(pPosition.x / 16);
        var tileY = Math.floor(pPosition.y / 16);

        return {
            minX: tileX,
            minY: tileY,
            maxX: tileX + pWidth - 1,
            maxY: tileY + pHeight - 1
        };
    };

    pIntegration.StructureSiteConflictsSessionGroup = function(pRect, pPositions, pWidth, pHeight, pSpacing) {
        for(var index = 0; index < pPositions.length; ++index) {
            if(this.RectDistance(pRect, this.SessionStructureRect(pPositions[index], pWidth, pHeight)) < pSpacing)
                return true;
        }

        return false;
    };

    pIntegration.StructureSiteConflictsSession = function(pRect, pSpacing) {
        return this.StructureSiteConflictsSessionGroup(pRect, Session.HutPositions, 3, 3, pSpacing) ||
            this.StructureSiteConflictsSessionGroup(pRect, Session.BarracksPositions, 6, 6, pSpacing) ||
            this.StructureSiteConflictsSessionGroup(pRect, Session.BunkerPositions, 4, 4, pSpacing);
    };

    pIntegration.RectCenterPosition = function(pRect) {
        return this.TileToPosition({
            x: Math.floor((pRect.minX + pRect.maxX) / 2),
            y: Math.floor((pRect.minY + pRect.maxY) / 2)
        });
    };

    pIntegration.StructureSiteTooCloseToPositions = function(pRect, pAvoidPositions, pAvoidDistance) {
        return this.TooCloseToPositions(this.RectCenterPosition(pRect), pAvoidPositions, pAvoidDistance);
    };

    pIntegration.StructureMapMargin = function(pContext) {
        var profile = pContext ? (pContext.Profile || {}) : {};
        var value = profile.LiveStructureMapMargin;

        if(value === undefined || value === null)
            value = profile.StructureMapMargin;
        value = Math.floor(Number(value));
        if(isNaN(value) || value < 0)
            return 0;

        return value;
    };

    pIntegration.StructureClearance = function(pSpec) {
        var building = (pSpec.building || "").toLowerCase();

        if(building === "hut") {
            return {
                left: 2,
                right: 2,
                top: 4,
                bottom: 2
            };
        }

        return {
            left: 1,
            right: 1,
            top: 2,
            bottom: 1
        };
    };

    pIntegration.StructureGroundClearance = function(pSpec) {
        var building = (pSpec.building || "").toLowerCase();

        if(building === "hut") {
            return {
                left: 1,
                right: 1,
                top: 1,
                bottom: 1
            };
        }

        return {
            left: 1,
            right: 1,
            top: 1,
            bottom: 1
        };
    };

    pIntegration.StructureCliffClearance = function(pContext, pSpec) {
        if(!pContext || !pContext.Cliffs || !pContext.Cliffs.length)
            return 0;

        var profile = pContext.Profile || {};
        var value = profile.StructureCliffClearance;
        if(typeof value !== "number") {
            value = profile.TerrainType === Terrain.Types.Ice ? 3 : 2;
        }
        return Math.max(0, Math.floor(value));
    };

    pIntegration.EffectiveStructureCliffClearance = function(
        pContext, pSpec, pOptions) {
        var clearance = this.StructureCliffClearance(pContext, pSpec);
        if(pOptions && pOptions.CliffClearanceOverride !== undefined &&
            isFinite(Number(pOptions.CliffClearanceOverride))) {
            clearance = Math.min(clearance, Math.max(0, Math.floor(
                Number(pOptions.CliffClearanceOverride))));
        }
        return clearance;
    };

    pIntegration.MarkStructureCliffProtectionCell = function(pContext, pMask, pX, pY) {
        // pMask is a 2D layer (Layers.Create). Layers.Set silently no-ops on
        // out-of-bounds coordinates, so the explicit bounds guard the original
        // string-keyed implementation needed is unnecessary here.
        if(!pContext || !pMask)
            return;
        MapGen.Layers.Set(pMask, pX, pY, 1);
    };

    pIntegration.BuildStructureCliffProtectionMask = function(pContext) {
        // A dense mask keeps cliff-clearance checks to indexed layer reads.
        if(!pContext || !pContext.Cliffs || !pContext.Cliffs.length)
            return null;
        if(pContext._structureCliffProtectionMask)
            return pContext._structureCliffProtectionMask;

        var mask = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
        for(var cliffIndex = 0; cliffIndex < pContext.Cliffs.length; ++cliffIndex) {
            var record = pContext.Cliffs[cliffIndex];
            var columns = record.columns || [];

            for(var colIndex = 0; colIndex < columns.length; ++colIndex) {
                var col = columns[colIndex];
                var triplets = col.triplets || [];
                if(!triplets.length)
                    continue;

                var topY = triplets[0].y;
                var bottomY = triplets[0].y;
                for(var ti = 1; ti < triplets.length; ++ti) {
                    if(triplets[ti].y < topY) topY = triplets[ti].y;
                    if(triplets[ti].y > bottomY) bottomY = triplets[ti].y;
                }

                for(var y = topY - 1; y <= bottomY + 2; ++y)
                    this.MarkStructureCliffProtectionCell(pContext, mask, col.x, y);
            }

            var stairs = record.stairs;
            if(stairs) {
                for(var sx = stairs.originX; sx < stairs.originX + stairs.width; ++sx) {
                    for(var sy = stairs.originY - 1; sy <= stairs.originY + stairs.height + 1; ++sy)
                        this.MarkStructureCliffProtectionCell(pContext, mask, sx, sy);
                }
            }

            var tripletsAll = record.triplets || [];
            for(var t = 0; t < tripletsAll.length; ++t) {
                var trip = tripletsAll[t];
                this.MarkStructureCliffProtectionCell(pContext, mask, trip.x, trip.y);
            }
        }

        pContext._structureCliffProtectionMask = mask;
        return mask;
    };

    pIntegration.IsStructureCliffProtectedCell = function(pContext, pX, pY) {
        if(!pContext || !pContext.Layers)
            return false;

        if(pContext.Layers.owner &&
            MapGen.Layers.Get(pContext.Layers.owner, pX, pY, 0) === MapGen.Layers.Owner.CLIFF)
            return true;

        var mask = this.BuildStructureCliffProtectionMask(pContext);
        return !!(mask && MapGen.Layers.Get(mask, pX, pY, 0));
    };

    pIntegration.IsStructureGroundApronCell = function(pSpec, pRect, pX, pY) {
        var ground = this.StructureGroundClearance(pSpec);

        return pX >= pRect.minX - ground.left &&
            pX <= pRect.maxX + ground.right &&
            pY >= pRect.minY - ground.top &&
            pY <= pRect.maxY + ground.bottom;
    };

    pIntegration.IsStructureOccupiedTile = function(pValue) {
        return pValue &&
            pValue !== "structure_cluster" &&
            pValue !== "objective_structure";
    };

    pIntegration.CanClearStructureCover = function(pContext, pX, pY) {
        return !MapGen.Layers.Get(pContext.Layers.water, pX, pY, 0) &&
            !MapGen.Layers.Get(pContext.Layers.riverBank, pX, pY, 0);
    };

    pIntegration.ClampTile = function(pValue, pMin, pMax) {
        if(pValue < pMin)
            return pMin;
        if(pValue > pMax)
            return pMax;
        return pValue;
    };

    pIntegration.StructureRectCenter = function(pRect) {
        return {
            x: Math.floor((pRect.minX + pRect.maxX) / 2),
            y: Math.floor((pRect.minY + pRect.maxY) / 2)
        };
    };

    pIntegration.RecordLiveStructurePlacement = function(pContext, pSpec, pPlacement, pPurpose) {
        if(!pContext.LiveStructurePlacements)
            pContext.LiveStructurePlacements = [];

        var liveRegion = pPlacement.clearing && pPlacement.clearing.regionId &&
            MapGen.Encounters && MapGen.Encounters.EncounterRegionById ?
            MapGen.Encounters.EncounterRegionById(
                pContext, pPlacement.clearing.regionId) : null;
        if(!liveRegion && MapGen.Encounters &&
            MapGen.Encounters.NearestEncounterRegion) {
            var liveRegionPoint = pPlacement.accessPoint ||
                (pPlacement.clearing ? {
                    x: pPlacement.clearing.x,
                    y: pPlacement.clearing.y
                } : { x: pPlacement.tileX, y: pPlacement.tileY });
            liveRegion = MapGen.Encounters.NearestEncounterRegion(
                pContext, liveRegionPoint, false);
        }

        pContext.LiveStructurePlacements.push({
            spec: {
                building: pSpec.building,
                sprite: pSpec.sprite
            },
            purpose: pPurpose || "",
            tileX: pPlacement.tileX,
            tileY: pPlacement.tileY,
            rect: pPlacement.rect || null,
            accessPoint: pPlacement.accessPoint || null,
            accessTarget: pPlacement.accessTarget || null,
            accessRouteLength: pPlacement.accessRouteLength || 0,
            spacingOverride: typeof pPlacement.spacingOverride === "number" ?
                pPlacement.spacingOverride : null,
            waterClearance: typeof pPlacement.waterClearance === "number" ?
                pPlacement.waterClearance :
                this.StructureWaterClearance(pContext, pSpec),
            cliffClearance: typeof pPlacement.cliffClearance === "number" ?
                pPlacement.cliffClearance :
                this.StructureCliffClearance(pContext, pSpec),
            contextCover: pPlacement.contextCover || null,
            placementSource: pPlacement.fallback ? "fallback" :
                ((pPlacement.clearing && pPlacement.clearing.source) || "clearing"),
            clearingRole: pPlacement.clearing ? (pPlacement.clearing.role || "") : "",
            clearingTemplate: pPlacement.clearing ? (pPlacement.clearing.template || "") : "",
            plannedKind: pPlacement.clearing ? (pPlacement.clearing.plannedKind || "") : "",
            clearingPoint: pPlacement.clearing ? { x: pPlacement.clearing.x, y: pPlacement.clearing.y } : null,
            routeFraction: typeof pPlacement.routeFraction === "number" ?
                pPlacement.routeFraction :
                (pPlacement.clearing &&
                    typeof pPlacement.clearing.routeFraction === "number" ?
                    pPlacement.clearing.routeFraction : null),
            routePhase: pPlacement.clearing ?
                (pPlacement.clearing.routePhase || "") : "",
            topologyPurpose: pPlacement.clearing ?
                (pPlacement.clearing.topologyPurpose || "") : "",
            regionId: liveRegion ? liveRegion.id : "",
            encounterKind: liveRegion ? liveRegion.kind : ""
        });
    };

    pIntegration.ReserveStructureSite = function(pContext, pSpec, pPlacement) {
        var clearance = this.StructureClearance(pSpec);
        var rect = pPlacement.rect;

        for(var x = rect.minX - clearance.left; x <= rect.maxX + clearance.right; ++x) {
            for(var y = rect.minY - clearance.top; y <= rect.maxY + clearance.bottom; ++y) {
                MapGen.Layers.Set(pContext.Layers.blocked, x, y, 0);
                MapGen.Layers.Set(pContext.Layers.keepClear, x, y, 1);
                if(this.IsStructureGroundApronCell(pSpec, rect, x, y))
                    MapGen.Layers.Set(this.EnsureStructureGroundLayer(pContext), x, y, 1);
                MapGen.Layers.Set(pContext.Layers.occupied, x, y, "live_structure_clearance");
            }
        }

        for(var fx = rect.minX; fx <= rect.maxX; ++fx) {
            for(var fy = rect.minY; fy <= rect.maxY; ++fy)
                MapGen.Layers.Set(pContext.Layers.occupied, fx, fy, "live_structure");
        }

        pContext.Placements.structures.push({
            kind: "live_structure",
            template: pSpec.building,
            role: this.StructurePurpose(pSpec),
            point: {
                x: Math.floor((rect.minX + rect.maxX) / 2),
                y: Math.floor((rect.minY + rect.maxY) / 2)
            },
            radius: Math.ceil(Math.max(rect.maxX - rect.minX + 1, rect.maxY - rect.minY + 1) / 2),
            approach: 1
        });

        pContext.StructureTerrainDirty = true;
    };

    pIntegration.PlaceStructureSpec = function(pSpec, pTileX, pTileY) {
        var position = this.TileToPosition({
            x: pTileX,
            y: pTileY
        });
        var building = (pSpec.building || "").toLowerCase();

        if(building === "hut") {
            return Structures.PlaceHut(position, pSpec.sprite);
        }

        if(building === "barracks") {
            return Structures.PlaceBarracks(position, pSpec.sprite);
        }

        if(building === "bunker") {
            return Structures.PlaceBunker(position, pSpec.sprite);
        }

        return false;
    };

})(MapGen.Integration);
