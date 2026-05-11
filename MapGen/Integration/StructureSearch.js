var MapGen = MapGen || {};
MapGen.Integration = MapGen.Integration || {};

// Bounded clearing search retained for objective placement without a home plan.
(function(pIntegration) {
    pIntegration.IsStructureSiteValid = function(pContext, pTileX, pTileY, pSpec, pInfo, pPlaced, pAvoidPositions, pAvoidDistance, pOptions) {
        var rect = this.StructureRect(pTileX, pTileY, pInfo);
        var clearance = this.StructureClearance(pSpec);
        var minX = rect.minX - clearance.left;
        var maxX = rect.maxX + clearance.right;
        var minY = rect.minY - clearance.top;
        var maxY = rect.maxY + clearance.bottom;
        var spacing = this.StructureSpacing(pSpec, pContext);
        var mapMargin = this.StructureMapMargin(pContext);
        var options = pOptions || {};
        var cliffClearance = this.EffectiveStructureCliffClearance(
            pContext, pSpec, options);

        // Region-intent compound clearings explicitly cluster buildings inside
        // a small reserved rect — the supply_hut at the support anchor plus
        // 1-2 outpost bunkers at the corners are by-design under the normal
        // LiveStructureMinSpacing (~18 tiles for ice). Tighten just the
        // placed-conflict threshold for compound placements; the pPlaced
        // entries here still encode water/cliff distance independently.
        if(options.SkipContext && options.CompoundSpacing > 0)
            spacing = Math.min(spacing, options.CompoundSpacing);

        if(this.StructureSiteConflictsPlaced(rect, pPlaced, spacing))
            return false;
        if(this.StructureSiteConflictsSession(rect, spacing))
            return false;
        if(this.StructureSiteTooCloseToPositions(rect, pAvoidPositions, pAvoidDistance))
            return false;
        if(mapMargin > 0 &&
            (rect.minX < mapMargin || rect.minY < mapMargin ||
                rect.maxX >= pContext.Width - mapMargin ||
                rect.maxY >= pContext.Height - mapMargin))
            return false;
        // Compound clearings sit in a STRUCTURE-claimed rect that water can't
        // be inside — but the reserved rect's edges may sit 1-2 cells from
        // the macro coast. The standard 3-cell water clearance rejects every
        // corner candidate when that's the case. Drop it to 1 for compound
        // roles; the reserved-rect invariant guarantees the building
        // footprint itself stays dry, and 1-cell of damp adjacency is fine.
        var effectiveWaterClearance = this.EffectiveStructureWaterClearance(pContext, pSpec, options);
        // Resmoothing an original-derived shoreline can move a legal bank
        // transition outward by one tile. Reserve that renderer halo during
        // placement so a semantically valid three-cell clearance does not
        // become a one-cell rendered overlap at final validation.
        var placementWaterClearance = effectiveWaterClearance +
            (pContext.OriginalTerrainTemplate ? 1 : 0);
        if(this.StructureWaterClearanceConflict(pContext, rect, placementWaterClearance))
            return false;

        // Footprint+clearance must be inside the map. Previously this was
        // checked per-cell inside the cell loop; pulled out so the SAT range
        // query below can run unguarded on the (clamped) box.
        if(minX < 0 || minY < 0 || maxX >= pContext.Width || maxY >= pContext.Height)
            return false;

        // Query the footprint in constant time, retaining a cell scan when
        // the context cannot provide a summed-area table.
        var sat = this.EnsureStructurePlacementSAT(pContext);
        if(sat) {
            if(this.StructureSATSum(sat, pContext.Width, pContext.Height, minX, minY, maxX, maxY) > 0)
                return false;
        } else {
            for(var x = minX; x <= maxX; ++x) {
                for(var y = minY; y <= maxY; ++y) {
                    if(this.StructureCellIsWaterLike(pContext, x, y))
                        return false;
                    if(MapGen.Layers.Get(pContext.Layers.blocked, x, y, 0) &&
                        !this.CanClearStructureCover(pContext, x, y)) {
                        return false;
                    }
                    if(this.IsStructureOccupiedTile(MapGen.Layers.Get(pContext.Layers.occupied, x, y, 0)))
                        return false;
                }
            }
        }

        if(cliffClearance > 0) {
            var cliffSAT = this.EnsureStructureCliffProtectionSAT(pContext);
            if(cliffSAT) {
                if(this.StructureSATSum(
                        cliffSAT,
                        pContext.Width,
                        pContext.Height,
                        minX - cliffClearance,
                        minY - cliffClearance,
                        maxX + cliffClearance,
                        maxY + cliffClearance) > 0)
                    return false;
            } else {
                for(var cx = minX - cliffClearance; cx <= maxX + cliffClearance; ++cx) {
                    for(var cy = minY - cliffClearance; cy <= maxY + cliffClearance; ++cy) {
                        if(this.IsStructureCliffProtectedCell(pContext, cx, cy))
                            return false;
                    }
                }
            }
        }

        if(!options.SkipContext) {
            if(this.StructureContextTooOpen(pContext, rect))
                return false;
            if(this.StructureRenderedContextTooOpen(pContext, rect))
                return false;
        }

        return true;
    };

    pIntegration.StructureCandidateInClearing = function(pContext, pClearing, pSpec, pInfo, pLocalIndex, pSpecIndex, pPlaced, pAvoidPositions, pAvoidDistance, pValidateOptions) {
        var maxStructureRadius = Math.ceil(Math.max(pInfo.width, pInfo.height) / 2);
        var maxDistance = Math.max(0, pClearing.radius - maxStructureRadius - 1);
        var goldenAngle = 2.399963229728653;

        // Region-intent compound roles are deliberately stamped on a STRUCTURE-
        // claimed rect that suppresses the natural tree halo. Honoring the
        // generic MinStructureContextCoverFraction check would reject every
        // candidate inside that rect; the layout template's whole purpose is
        // to OWN that pocket. Skip the context-cover validator for those AND
        // tighten the placed-conflict spacing to a value that allows two
        // bunkers + a barracks to coexist inside an 11x9 rect (the live
        // 18-tile default would only fit one building).
        var skipContext = pClearing && (pClearing.role === "compound_objective" || pClearing.role === "compound_outpost");
        // CompoundSpacing 3 lets a 4x4 barracks and 4x4 bunker sit 3 cells
        // apart (rect-edge to rect-edge), which fits inside the 11x9 reserved
        // pocket. Higher values were calibrated for the standalone-bunker case
        // (LiveStructureMinSpacing 18) and rejected every corner candidate
        // once the central barracks claimed the rect's middle. See
        // [[mapgen_region_intent_v1]].
        var validateOptions = {};
        var optionKey;
        for(optionKey in (pValidateOptions || {})) {
            if((pValidateOptions || {}).hasOwnProperty(optionKey))
                validateOptions[optionKey] = pValidateOptions[optionKey];
        }
        if(skipContext) {
            validateOptions.SkipContext = true;
            validateOptions.CompoundSpacing = 3;
            validateOptions.RelaxWaterClearance = true;
            // The compound rect is reserved land authored before the cliff
            // pass. Keep a real apron, but do not let the generic three-tile
            // standalone-building halo evict the required objective from its
            // own destination when a cliff decorates the nearby edge.
            validateOptions.CliffClearanceOverride = 1;
        }

        for(var attempt = 0; attempt < 72; ++attempt) {
            var centerX = pClearing.x;
            var centerY = pClearing.y;

            if(attempt > 0 && maxDistance > 0) {
                var salt = 211 + (pSpecIndex * 37) + (pLocalIndex * 17) + attempt;
                var angle = ((MapGen.Random.HashTile(pContext.Seed, pClearing.x + pSpecIndex, pClearing.y + pLocalIndex, salt) % 6283) / 1000) +
                    (pLocalIndex * goldenAngle) + (attempt * 0.41);
                var distanceStep = 0.35 + ((attempt % 5) * 0.15);
                var distance = Math.min(maxDistance, Math.max(1, maxDistance * distanceStep));

                centerX = Math.round(pClearing.x + (Math.cos(angle) * distance));
                centerY = Math.round(pClearing.y + (Math.sin(angle) * distance));
            }

            var tileX = centerX - pInfo.centerOffsetX;
            var tileY = centerY - pInfo.centerOffsetY;

            if(this.IsStructureSiteValid(pContext, tileX, tileY, pSpec, pInfo, pPlaced, pAvoidPositions, pAvoidDistance, validateOptions)) {
                return {
                    tileX: tileX,
                    tileY: tileY,
                    rect: this.StructureRect(tileX, tileY, pInfo),
                    waterClearance: this.EffectiveStructureWaterClearance(
                        pContext, pSpec, validateOptions),
                    cliffClearance: this.EffectiveStructureCliffClearance(
                        pContext, pSpec, validateOptions)
                };
            }
        }

        return null;
    };

    pIntegration.FindStructureSite = function(pContext, pClearings, pPreferredIndex, pSpec, pInfo, pLocalIndex, pSpecIndex, pPlaced, pAvoidPositions, pAvoidDistance, pValidateOptions) {
        if(!pClearings.length)
            return null;

        for(var pass = 0; pass < pClearings.length; ++pass) {
            var clearingIndex = (pPreferredIndex + pass) % pClearings.length;
            var candidate = this.StructureCandidateInClearing(
                pContext,
                pClearings[clearingIndex],
                pSpec,
                pInfo,
                pLocalIndex + pass,
                pSpecIndex,
                pPlaced,
                pAvoidPositions,
                pAvoidDistance,
                pValidateOptions
            );

            if(candidate) {
                candidate.clearingIndex = clearingIndex;
                candidate.clearing = pClearings[clearingIndex];
                return candidate;
            }
        }

        return null;
    };
})(MapGen.Integration);
