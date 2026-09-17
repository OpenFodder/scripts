var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

MapGen.Layout.Rivers = {

    Policy: function(pContext) {
        if(MapGen.Terrain && MapGen.Terrain.TileCatalog && MapGen.Terrain.TileCatalog.WaterPolicyForTerrain)
            return MapGen.Terrain.TileCatalog.WaterPolicyForTerrain(pContext.Profile.TerrainType);

        return {
            rivers: true,
            ponds: true,
            coasts: false,
            style: "generic"
        };
    },

    SupportsFeature: function(pContext, pFeature) {
        if(MapGen.Terrain && MapGen.Terrain.TileCatalog && MapGen.Terrain.TileCatalog.SupportsWaterFeature)
            return MapGen.Terrain.TileCatalog.SupportsWaterFeature(pContext.Profile.TerrainType, pFeature);

        return true;
    },

    ScaledChance: function(pContext, pChance, pScaleKey) {
        var policy = this.Policy(pContext);
        var chance = Number(pChance || 0);
        var scale = Number(policy[pScaleKey]);

        if(chance >= 1)
            return 1;

        if(isNaN(scale))
            scale = 1;

        return Math.max(0, Math.min(1, chance * scale));
    },

    PolicyMax: function(pContext, pPolicyKey, pProfileValue) {
        var policy = this.Policy(pContext);
        var policyValue = Number(policy[pPolicyKey]);
        var profileValue = Math.floor(Number(pProfileValue || 0));

        if(isNaN(profileValue))
            profileValue = 0;
        if(isNaN(policyValue))
            return profileValue;

        return Math.min(profileValue, Math.floor(policyValue));
    },

    // Architecture v3: water budget. Area-scaling the river/pond/lake COUNTS
    // (so big maps are not sparse) must not be allowed to drown the map — more
    // features on a big canvas is good, more *coverage fraction* is not. This
    // returns the max water-cell count from the profile/policy MaxWaterCoverage
    // so the multi-feature loops can stop once the budget is spent. Keeps the
    // per-screen interest win (spread features) while holding the global cap.
    WaterBudgetCells: function(pContext) {
        var profile = pContext.Profile || {};
        var cap = profile.MaxWaterCoverage;
        if(MapGen.Terrain && MapGen.Terrain.TileCatalog && MapGen.Terrain.TileCatalog.MaxWaterCoverage)
            cap = MapGen.Terrain.TileCatalog.MaxWaterCoverage(profile.TerrainType, profile.MaxWaterCoverage);
        var fraction = Number(cap);
        if(isNaN(fraction) || fraction <= 0)
            fraction = 0.6;
        return Math.floor(pContext.Width * pContext.Height * fraction);
    },

    CurrentWaterCells: function(pContext) {
        return MapGen.Layers.Count(pContext.Layers.water, function(pValue) { return !!pValue; });
    },

    WaterBudgetExceeded: function(pContext) {
        return this.CurrentWaterCells(pContext) >= this.WaterBudgetCells(pContext);
    },

    ResolveRange: function(pContext, pValue, pInteger, pFallback) {
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

        var value = Number(pValue);
        return isNaN(value) ? pFallback : value;
    },

    ShouldBuild: function(pContext) {
        var profile = pContext.Profile;

        if(!this.SupportsFeature(pContext, "rivers"))
            return false;

        if(this.PolicyMax(pContext, "maxRiverCount", profile.MaxRiverCount) < 1)
            return false;

        return pContext.Random.Chance(this.ScaledChance(pContext, profile.RiverChance, "riverChanceScale"));
    },

    ShouldBuildPond: function(pContext) {
        var profile = pContext.Profile;

        if(!this.SupportsFeature(pContext, "ponds"))
            return false;

        if(this.PolicyMax(pContext, "maxPondCount", profile.MaxPondCount) < 1)
            return false;

        return pContext.Random.Chance(this.ScaledChance(pContext, profile.PondChance, "pondChanceScale"));
    },

    ShouldBuildLake: function(pContext) {
        var profile = pContext.Profile;

        if(!this.SupportsFeature(pContext, "lakes"))
            return false;

        if(this.PolicyMax(pContext, "maxLakeCount", profile.MaxLakeCount) < 1)
            return false;

        return pContext.Random.Chance(this.ScaledChance(pContext, this.ResolveRange(pContext, profile.LakeChance, false, 0), "lakeChanceScale"));
    },

    RiverWidth: function(pContext) {
        var profileWidth = Math.max(1, Math.floor(Number(pContext.Profile.RiverWidth || 1)));
        var policy = this.Policy(pContext);
        var policyWidth = Math.floor(Number(policy.maxRiverWidth));

        if(isNaN(policyWidth) || policyWidth < 1)
            return profileWidth;

        return Math.min(profileWidth, policyWidth);
    },

    PondRadius: function(pContext) {
        var policy = this.Policy(pContext);
        var maxRadius = Math.max(2, Math.floor((pContext.Profile.RiverWidth || 2) * 1.5));
        var policyRadius = Math.floor(Number(policy.maxPondRadius));

        if(!isNaN(policyRadius) && policyRadius > 0)
            maxRadius = Math.min(maxRadius, policyRadius);

        return pContext.Random.Int(2, Math.max(2, maxRadius));
    },

    LakeRadius: function(pContext) {
        var policy = this.Policy(pContext);
        var profileRadius = Math.max(3, Math.floor(this.ResolveRange(pContext, pContext.Profile.LakeRadius, true, 5)));
        var policyRadius = Math.floor(Number(policy.maxLakeRadius));

        if(!isNaN(policyRadius) && policyRadius > 0)
            profileRadius = Math.min(profileRadius, policyRadius);

        return pContext.Random.Int(3, Math.max(3, profileRadius));
    },

    EdgePoint: function(pContext, pSide) {
        var random = pContext.Random;
        var profileMargin = Math.floor(Number(
            pContext.Profile && pContext.Profile.RiverSpineMargin
        ));
        var margin = isNaN(profileMargin) ? 3 : Math.max(3, profileMargin);
        margin = Math.min(
            margin,
            Math.max(3, Math.floor((Math.min(pContext.Width, pContext.Height) - 2) / 3))
        );
        var beach = null;
        var beaches = pContext.Beaches || [];
        for(var i = 0; i < beaches.length; ++i) {
            if(beaches[i].side === pSide) { beach = beaches[i]; break; }
        }
        // When the river meets a coast, push the endpoint inward so the spine
        // terminates inside the water band rather than on the literal edge.
        // coastWaterWidth on the point is consumed by DrawRiver to ramp the
        // width into a delta on the last 15% of the spine.
        var coastWaterWidth = beach ? Math.max(1, beach.waterWidth | 0) : 0;
        var inset = coastWaterWidth > 0 ? Math.max(1, Math.floor(coastWaterWidth / 2)) : 1;

        var pt;
        switch(pSide) {
            case "top":
                pt = { x: random.Int(margin, pContext.Width - margin - 1), y: inset, role: "river_edge", coastWaterWidth: coastWaterWidth };
                break;
            case "bottom":
                pt = { x: random.Int(margin, pContext.Width - margin - 1), y: pContext.Height - 1 - inset, role: "river_edge", coastWaterWidth: coastWaterWidth };
                break;
            case "left":
                pt = { x: inset, y: random.Int(margin, pContext.Height - margin - 1), role: "river_edge", coastWaterWidth: coastWaterWidth };
                break;
            default:
                pt = { x: pContext.Width - 1 - inset, y: random.Int(margin, pContext.Height - margin - 1), role: "river_edge", coastWaterWidth: coastWaterWidth };
                break;
        }

        // If a continent has been carved, the inset cell may already be water.
        // Walk inward along the side's normal until we land on a land cell so
        // the river spine starts on real ground. Capped to avoid excursions
        // into the interior; if no land found in cap we fall through.
        if(pContext.Continent && pContext.Layers && pContext.Layers.water) {
            var dx = 0, dy = 0;
            switch(pSide) {
                case "top":    dy =  1; break;
                case "bottom": dy = -1; break;
                case "left":   dx =  1; break;
                case "right":  dx = -1; break;
            }
            var cap = Math.floor(Math.max(pContext.Width, pContext.Height) / 3);
            var sx = pt.x;
            var sy = pt.y;
            for(var step = 0; step <= cap; ++step) {
                var nx = sx + dx * step;
                var ny = sy + dy * step;
                if(nx < 0 || ny < 0 || nx >= pContext.Width || ny >= pContext.Height) break;
                if(!MapGen.Layers.Get(pContext.Layers.water, nx, ny, 0)) {
                    pt.x = nx;
                    pt.y = ny;
                    break;
                }
            }
        }

        return pt;
    },

    // Pick the river's running axis. With probability RiverBisectChance the
    // axis is chosen perpendicular to the player_start -> objective vector so
    // the river cuts across that path; otherwise it's a coin flip. Falls back
    // to a coin flip when anchors aren't available (eg. unusual templates).
    PickRiverAxis: function(pContext) {
        var random = pContext.Random;
        var forcedAxis = String((pContext.Profile || {}).RiverAxis || "").toLowerCase();
        if(forcedAxis === "horizontal")
            return true;
        if(forcedAxis === "vertical")
            return false;
        var bisectChance = (typeof pContext.Profile.RiverBisectChance === "number") ? pContext.Profile.RiverBisectChance : 0.7;
        if(!random.Chance(bisectChance))
            return random.Chance(0.5);

        var anchors = pContext.Anchors || {};
        var a = anchors.start || anchors.teamA;
        var b = anchors.objective || anchors.teamB;
        if(!a || !b)
            return random.Chance(0.5);

        var dx = Math.abs(b.x - a.x);
        var dy = Math.abs(b.y - a.y);
        if(dx === dy)
            return random.Chance(0.5);
        // dx > dy: start->objective is horizontal, so river runs top<->bottom
        // (horizontal=false) to bisect it. Vice versa for dy > dx.
        return dx < dy;
    },

    // Architecture v3: authoritative reconciliation after all water passes.
    // Any cell the Skeleton reserved as ROUTE must stay dry land — clear water
    // there so the reserved corridor is never fragmented by ponds/lakes/streams
    // (rivers that legitimately cross the route get a ford via PlaceCrossings).
    // Single chokepoint so individual stamp sites don't each need a guard.
    ProtectReservedRoute: function(pContext) {
        var owner = pContext.Layers ? pContext.Layers.owner : null;
        if(!owner)
            return 0;
        var water = pContext.Layers.water;
        // Preserve authored river bodies where they intersect the broad
        // Skeleton ROUTE reservation. Connectivity can then steer the real
        // route through the recorded crossing. Clearing these cells here
        // used to cut a several-tile rectangular land plug through the river,
        // often leaving the later bridge stranded on only one bank.
        // Ponds/lakes still get carved away from the route as before.
        var riverBody = MapGen.Layers.Create(pContext.Width, pContext.Height, 0);
        var rivers = pContext.Rivers || [];
        for(var riverIndex = 0; riverIndex < rivers.length; ++riverIndex) {
            var river = rivers[riverIndex];
            if(river.kind !== "river" &&
                !(pContext.RegionalPlan && river.kind === "river_branch"))
                continue;
            var radius = Math.max(1, Math.floor(Number(river.width || 1)));
            var points = river.points || [];
            for(var pointIndex = 0; pointIndex < points.length; ++pointIndex)
                MapGen.Layers.StampDisc(riverBody, points[pointIndex].x, points[pointIndex].y, radius, 1);
        }
        var cleared = 0;
        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(MapGen.Layers.Get(owner, x, y, 0) !== MapGen.Layers.Owner.ROUTE)
                    continue;
                if(MapGen.Layers.Get(riverBody, x, y, 0))
                    continue;
                if(MapGen.Layers.Get(water, x, y, 0)) {
                    MapGen.Layers.Set(water, x, y, 0);
                    ++cleared;
                }
            }
        }
        if(cleared)
            MapGen.Context.AddLog(pContext, "Protected reserved route: cleared " + cleared + " water cells");
        return cleared;
    },

    // Cliff reservation cleanup pass — companion to ProtectReservedRoute, for
    // Option A ([[mapgen_cliff_option_a_staged]]). Even with the upstream
    // cliffReserve guards in Skeleton/Coast/Rivers/Water, individual sub-
    // passes (lake stamps, branch streams, soft-hazard re-marks, edge biome
    // post-passes) can still smear water/bank/coast/keepClear/path bits into
    // the reserved strip on tight seeds. PlateauCliffs.cellBlocksStamp's
    // reject set is exactly {water, riverBank, forcedBank, coast, lakeShore,
    // keepClear, crossing, path, occupied} — so any leakage into one of
    // those layers fails ColumnFits and the reservation has been wasted.
    //
    // Walk the grid; for cells with cliffReserve=1, clear 8 layers (occupied
    // is left alone — owner-grid claim is the right authority for structures
    // and we never wrote occupied during cliff reservation). No-op on non-
    // ice (cliffReserve all-zero, entry guard never wrote).
    ProtectReservedCliff: function(pContext) {
        if(!pContext.Layers || !pContext.Layers.cliffReserve)
            return 0;
        var layers = pContext.Layers;
        var cliffReserve = layers.cliffReserve;
        var cleared = 0;
        for(var x = 0; x < pContext.Width; ++x) {
            for(var y = 0; y < pContext.Height; ++y) {
                if(!MapGen.Layers.Get(cliffReserve, x, y, 0))
                    continue;
                var changed = false;
                if(MapGen.Layers.Get(layers.water, x, y, 0)) {
                    MapGen.Layers.Set(layers.water, x, y, 0);
                    changed = true;
                }
                if(MapGen.Layers.Get(layers.riverBank, x, y, 0)) {
                    MapGen.Layers.Set(layers.riverBank, x, y, 0);
                    changed = true;
                }
                if(MapGen.Layers.Get(layers.forcedBank, x, y, 0)) {
                    MapGen.Layers.Set(layers.forcedBank, x, y, 0);
                    changed = true;
                }
                if(MapGen.Layers.Get(layers.coast, x, y, 0)) {
                    MapGen.Layers.Set(layers.coast, x, y, 0);
                    changed = true;
                }
                if(MapGen.Layers.Get(layers.lakeShore, x, y, 0)) {
                    MapGen.Layers.Set(layers.lakeShore, x, y, 0);
                    changed = true;
                }
                if(MapGen.Layers.Get(layers.keepClear, x, y, 0)) {
                    MapGen.Layers.Set(layers.keepClear, x, y, 0);
                    changed = true;
                }
                if(MapGen.Layers.Get(layers.crossing, x, y, 0)) {
                    MapGen.Layers.Set(layers.crossing, x, y, 0);
                    changed = true;
                }
                if(MapGen.Layers.Get(layers.path, x, y, 0)) {
                    MapGen.Layers.Set(layers.path, x, y, 0);
                    changed = true;
                }
                if(changed)
                    ++cleared;
            }
        }
        if(cleared)
            MapGen.Context.AddLog(pContext, "Protected reserved cliff: cleared " + cleared + " smeared cell(s)");
        return cleared;
    },

    Build: function(pContext) {
        if(!this.ShouldBuild(pContext)) {
            this.BuildPonds(pContext);
            this.BuildLakes(pContext);
            this.BuildStreams(pContext);
            this.ProtectReservedRoute(pContext);
            this.ProtectReservedCliff(pContext);
            this.TrimWaterPeninsulas(pContext);
            this.SmoothInwardCorners(pContext);
            var retracted0 = this.EdgeFuzz(pContext);
            this.SmoothPinchesOnly(pContext, retracted0);
            this.RepairBankProfile(pContext);
            return null;
        }

        // Architecture v3: draw up to MaxRiverCount rivers (area-scaled and
        // policy-clamped). Each river picks its own axis/endpoints/width so a
        // big canvas gets proportionally more water structure instead of a
        // single thread. Fixed loop order keeps generation deterministic.
        var riverCount = Math.max(1, this.PolicyMax(pContext, "maxRiverCount", pContext.Profile.MaxRiverCount));
        var firstRiver = null;

        for(var riverIndex = 0; riverIndex < riverCount; ++riverIndex) {
            // Always draw the first river (ShouldBuild already committed to one);
            // additional area-scaled rivers stop once the water budget is spent.
            if(riverIndex > 0 && this.WaterBudgetExceeded(pContext))
                break;
            var horizontal = this.PickRiverAxis(pContext);
            var start = horizontal ? this.EdgePoint(pContext, "left") : this.EdgePoint(pContext, "top");
            var end = horizontal ? this.EdgePoint(pContext, "right") : this.EdgePoint(pContext, "bottom");
            var width = this.RiverWidth(pContext);
            var branchPlanned = false;
            if(pContext.RegionalPlan) {
                var chance = Number(pContext.Profile.RiverBranchChance || 0);
                branchPlanned = chance > 0 && (pContext.Profile.CompositionVariant === "river_fork_cliffs" ||
                    MapGen.Random.HashTile(pContext.Seed, riverIndex, 61, 19403) / 4294967296 < chance);
                if(branchPlanned) {
                    // Leave room for a narrow tributary and later bank smoothing.
                    var length = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
                    var branchRoom = Math.min(pContext.Width, pContext.Height) * 1.5 + 32;
                    var room = (this.WaterBudgetCells(pContext) - this.CurrentWaterCells(pContext)) * 0.80 - branchRoom;
                    width = Math.max(1, Math.min(width, Math.floor(room / Math.max(1, length * 2.3) - 0.5)));
                }
            }
            var river = {
                start: start,
                end: end,
                width: width,
                points: [],
                kind: "river",
                branchPlanned: branchPlanned
            };

            this.DrawRiver(pContext, river);
            if(pContext.RegionalPlan) {
                this.BuildBranches(pContext, river);
                this.PlaceCrossings(pContext, river);
            } else {
                this.PlaceCrossings(pContext, river);
                this.BuildBranches(pContext, river);
            }
            pContext.Rivers.push(river);

            if(!firstRiver)
                firstRiver = river;
        }

        this.BuildPonds(pContext);
        this.BuildLakes(pContext);
        this.BuildStreams(pContext);
        this.ProtectReservedRoute(pContext);
        this.ProtectReservedCliff(pContext);
        this.TrimWaterPeninsulas(pContext);
        this.SmoothInwardCorners(pContext);
        var retracted = this.EdgeFuzz(pContext);
        this.SmoothPinchesOnly(pContext, retracted);
        this.RepairBankProfile(pContext);

        return firstRiver;
    },

    // Named river-crossing compositions must retain the authored channel after
    // Connectivity and terrain passes have carved their route reservations.
    // Reapply the recorded spine immediately after Terrain.Build, preserving
    // the exact dry bridge footprint. This turns the river record into an
    // enforced final semantic feature instead of best-effort metadata.
    RestoreProfileRiver: function(pContext) {
        var profile = pContext.Profile || {};
        if(String(profile.Name || "") !== "grammar_jungle_river_crossing")
            return 0;
        if(!pContext.Rivers || !pContext.Rivers.length)
            return 0;

        var bridgeCells = {};
        var bridges = pContext.Bridges || [];
        for(var bi = 0; bi < bridges.length; ++bi) {
            var trips = bridges[bi].triplets || [];
            for(var ti = 0; ti < trips.length; ++ti)
                bridgeCells[trips[ti].x + "," + trips[ti].y] = true;
        }

        var restored = 0;
        for(var ri = 0; ri < pContext.Rivers.length; ++ri) {
            var river = pContext.Rivers[ri];
            if(!river || river.kind !== "river") continue;
            var radius = Math.max(1, Math.floor(Number(river.width || 1)));
            var radiusSq = radius * radius;
            var points = river.points || [];
            for(var pi = 0; pi < points.length; ++pi) {
                for(var dx = -radius; dx <= radius; ++dx) {
                    for(var dy = -radius; dy <= radius; ++dy) {
                        if((dx * dx) + (dy * dy) > radiusSq) continue;
                        var x = points[pi].x + dx;
                        var y = points[pi].y + dy;
                        if(x < 0 || y < 0 || x >= pContext.Width || y >= pContext.Height)
                            continue;
                        if(bridgeCells[x + "," + y]) continue;
                        if(!MapGen.Layers.Get(pContext.Layers.water, x, y, 0)) {
                            MapGen.Layers.Set(pContext.Layers.water, x, y, 1);
                            ++restored;
                        }
                    }
                }
            }
        }
        if(restored)
            MapGen.Context.AddLog(pContext,
                "Restored named river-crossing spine cells=" + restored);
        return restored;
    },

    // Final shape-repair: SmoothInwardCorners can promote a land cell back to
    // water (rounding an inward corner), and EdgeFuzz can retract its previous
    // neighbours to land — leaving the promoted cell as a fresh 1-cardinal
    // water peninsula that the original TrimWaterPeninsulas already ran past.
    // Also catches 1-cell sideways edge bumps: cells that have water cardinals
    // only in one perpendicular pair (e.g. N+W) AND no diagonal water on the
    // opposite side, which read as a sharp single-row jut and break the bank
    // tile vocabulary because no tile encodes a 1-cell-wide protrusion.
    //
    // Trim-only — refilling here would simply undo the EdgeFuzz retractions
    // (a cell EdgeFuzz pushed back to land has water cardinals on 3+ sides
    // and would re-flood) and then cascade outward, ballooning the river.
    // Trimming a 1-cardinal cell never creates a new 3-cardinal land cell, so
    // there is no pinch to heal afterwards. Iterate so each removal can expose
    // a freshly-stranded neighbour. Spine/crossing cells stay protected.
    RepairBankProfile: function(pContext) {
        var layers = pContext.Layers;
        var width = pContext.Width;
        var height = pContext.Height;
        var spine = {};

        for(var ri = 0; ri < pContext.Rivers.length; ++ri) {
            var pts = pContext.Rivers[ri].points || [];
            for(var pi = 0; pi < pts.length; ++pi)
                spine[pts[pi].x + "," + pts[pi].y] = true;
        }
        for(var pdi = 0; pdi < pContext.Ponds.length; ++pdi)
            spine[pContext.Ponds[pdi].x + "," + pContext.Ponds[pdi].y] = true;

        var totalRemoved = 0;

        for(var pass = 0; pass < 4; ++pass) {
            var toLand = [];

            for(var ty = 1; ty < height - 1; ++ty) {
                for(var tx = 1; tx < width - 1; ++tx) {
                    if(!MapGen.Layers.Get(layers.water, tx, ty, 0)) continue;
                    if(MapGen.Layers.Get(layers.crossing, tx, ty, 0)) continue;
                    if(spine[tx + "," + ty]) continue;

                    var n = MapGen.Layers.Get(layers.water, tx, ty - 1, 0);
                    var s = MapGen.Layers.Get(layers.water, tx, ty + 1, 0);
                    var w = MapGen.Layers.Get(layers.water, tx - 1, ty, 0);
                    var e = MapGen.Layers.Get(layers.water, tx + 1, ty, 0);
                    var nw = MapGen.Layers.Get(layers.water, tx - 1, ty - 1, 0);
                    var ne = MapGen.Layers.Get(layers.water, tx + 1, ty - 1, 0);
                    var sw = MapGen.Layers.Get(layers.water, tx - 1, ty + 1, 0);
                    var se = MapGen.Layers.Get(layers.water, tx + 1, ty + 1, 0);
                    var cardinals = (n ? 1 : 0) + (s ? 1 : 0) + (w ? 1 : 0) + (e ? 1 : 0);

                    if(cardinals <= 1) {
                        toLand.push([tx, ty]);
                        continue;
                    }

                    // 1-cell sideways edge bump: water cardinals form a single
                    // perpendicular pair (corner of an L) with NO water at the
                    // diagonal between them — the cell juts off the river by
                    // one cell in two directions while the river body is
                    // elsewhere. Compare to a real corner of a wider river,
                    // where the cell has 2 cardinals AND the matching diagonal
                    // is also water (so the bend is supported by a 2x2 block).
                    if(cardinals === 2) {
                        if(n && w && !nw) { toLand.push([tx, ty]); continue; }
                        if(n && e && !ne) { toLand.push([tx, ty]); continue; }
                        if(s && w && !sw) { toLand.push([tx, ty]); continue; }
                        if(s && e && !se) { toLand.push([tx, ty]); continue; }
                    }
                }
            }

            if(!toLand.length)
                break;

            for(var i = 0; i < toLand.length; ++i)
                MapGen.Layers.Set(layers.water, toLand[i][0], toLand[i][1], 0);

            totalRemoved += toLand.length;
        }

        if(totalRemoved)
            MapGen.Context.AddLog(pContext, "RepairBankProfile: trimmed=" + totalRemoved);

        return totalRemoved;
    },

    // Per-step jitter in DrawRiver occasionally pushes a single disc 1-2 cells
    // sideways from its neighbours, producing 1-cell water tongues that read as
    // jagged dents in the bank (e.g. west bank at x=20,19,18,19,20 down a column
    // — that x=18 dent is one of these tongues). SmoothInwardCorners only acts on
    // *land* cells with 3+ water cardinals, so it can't remove stray water tongues.
    // This pass removes water cells with <=1 cardinal water neighbours, iterated
    // so each removal can expose a freshly-stranded neighbour. River/stream/pond
    // spine cells are protected so width-1 streams aren't eaten end-to-end, and
    // crossings keep their water (fords intentionally sit on water tongues).
    TrimWaterPeninsulas: function(pContext) {
        var layers = pContext.Layers;
        var width = pContext.Width;
        var height = pContext.Height;
        var spine = {};

        for(var ri = 0; ri < pContext.Rivers.length; ++ri) {
            var pts = pContext.Rivers[ri].points || [];
            for(var pi = 0; pi < pts.length; ++pi)
                spine[pts[pi].x + "," + pts[pi].y] = true;
        }
        for(var pdi = 0; pdi < pContext.Ponds.length; ++pdi)
            spine[pContext.Ponds[pdi].x + "," + pContext.Ponds[pdi].y] = true;

        var totalRemoved = 0;

        // Cap iterations at 2: more passes cascade and start eating wider river
        // edges (a removed cell strands its previously-adjacent neighbour, which
        // gets removed next pass, etc.). Two passes catches the obvious 1-2 cell
        // tongues without chewing into the main river body.
        for(var pass = 0; pass < 2; ++pass) {
            var toLand = [];

            for(var y = 1; y < height - 1; ++y) {
                for(var x = 1; x < width - 1; ++x) {
                    if(!MapGen.Layers.Get(layers.water, x, y, 0)) continue;
                    if(MapGen.Layers.Get(layers.crossing, x, y, 0)) continue;
                    if(spine[x + "," + y]) continue;

                    var n = MapGen.Layers.Get(layers.water, x, y - 1, 0);
                    var s = MapGen.Layers.Get(layers.water, x, y + 1, 0);
                    var w = MapGen.Layers.Get(layers.water, x - 1, y, 0);
                    var e = MapGen.Layers.Get(layers.water, x + 1, y, 0);
                    var cardinals = (n ? 1 : 0) + (s ? 1 : 0) + (w ? 1 : 0) + (e ? 1 : 0);

                    if(cardinals <= 1)
                        toLand.push([x, y]);
                }
            }

            if(!toLand.length)
                break;

            for(var i = 0; i < toLand.length; ++i)
                MapGen.Layers.Set(layers.water, toLand[i][0], toLand[i][1], 0);

            totalRemoved += toLand.length;
        }

        if(totalRemoved)
            MapGen.Context.AddLog(pContext, "Trimmed water peninsulas: " + totalRemoved);

        return totalRemoved;
    },

    // Round stair-stepped river/pond boundaries by promoting non-water cells that
    // form land protrusions into water. Three classes get eroded:
    //   - L-corner: water in 2 cardinals + the diagonal between them
    //   - Peninsula tip: 3+ water cardinals (cell juts out into water)
    //   - Diagonal pinch: water on one cardinal AND both diagonals on either side
    // Without this, banks are jagged single-cell stair-steps that no Amiga tile
    // maps cleanly. Multiple passes erode each protrusion by one cell at a time
    // while leaving wider banks untouched.
    SmoothInwardCorners: function(pContext) {
        var layers = pContext.Layers;
        var width = pContext.Width;
        var height = pContext.Height;
        var totalChanged = 0;

        for(var pass = 0; pass < 3; ++pass) {
            var toFill = [];

            // Skip border cells. OOB neighbours default to 0 (not water),
            // which makes border land cells look like 1-cell tongues to
            // the diagonal-pinch rule (s && sw && se) when the row below
            // is interior water — the continent perimeter then erodes to
            // a perimeter water ring. The rule is meant to round river
            // and pond boundaries, not the map edge.
            for(var y = 1; y < height - 1; ++y) {
                for(var x = 1; x < width - 1; ++x) {
                    if(MapGen.Layers.Get(layers.water, x, y, 0)) continue;
                    if(MapGen.Layers.Get(layers.keepClear, x, y, 0)) continue;
                    if(MapGen.Layers.Get(layers.path, x, y, 0)) continue;
                    if(MapGen.Layers.Get(layers.crossing, x, y, 0)) continue;
                    if(MapGen.Layers.Get(layers.occupied, x, y, 0)) continue;

                    var n = MapGen.Layers.Get(layers.water, x, y - 1, 0);
                    var s = MapGen.Layers.Get(layers.water, x, y + 1, 0);
                    var w = MapGen.Layers.Get(layers.water, x - 1, y, 0);
                    var e = MapGen.Layers.Get(layers.water, x + 1, y, 0);
                    var nw = MapGen.Layers.Get(layers.water, x - 1, y - 1, 0);
                    var ne = MapGen.Layers.Get(layers.water, x + 1, y - 1, 0);
                    var sw = MapGen.Layers.Get(layers.water, x - 1, y + 1, 0);
                    var se = MapGen.Layers.Get(layers.water, x + 1, y + 1, 0);

                    var cardinals = (n ? 1 : 0) + (s ? 1 : 0) + (w ? 1 : 0) + (e ? 1 : 0);

                    if((n && w && nw) || (n && e && ne) || (s && w && sw) || (s && e && se)) {
                        toFill.push([x, y]);
                        continue;
                    }

                    if(cardinals >= 3) {
                        toFill.push([x, y]);
                        continue;
                    }

                    if((n && nw && ne) || (s && sw && se) || (w && nw && sw) || (e && ne && se))
                        toFill.push([x, y]);
                }
            }

            if(!toFill.length)
                break;

            for(var i = 0; i < toFill.length; ++i)
                MapGen.Layers.Set(layers.water, toFill[i][0], toFill[i][1], 1);

            totalChanged += toFill.length;
        }

        if(totalChanged)
            MapGen.Context.AddLog(pContext, "Smoothed inward water corners: " + totalChanged);

        return totalChanged;
    },

    // Break up perfectly straight bank runs that the inward-corner smoothing
    // leaves behind. After SmoothInwardCorners flattens stair-steps, near-45-
    // degree river segments end up as crisp diagonal cliffs with no per-cell
    // variation, which read visually as ruler-drawn rather than natural. We
    // detect long collinear edge runs and retract a deterministic subset of
    // boundary water cells back to land — small notches that disrupt the
    // straightness without materially reshaping the river.
    EdgeFuzz: function(pContext) {
        var layers = pContext.Layers;
        var width = pContext.Width;
        var height = pContext.Height;
        var sig = new Array(width * height);
        var profile = pContext.Profile || {};
        var straightRunLimit = Math.max(4, Math.floor(profile.StraightShoreRunLimit || 8));
        var forcedStride = Math.max(3, Math.floor(profile.ShorelineWobbleStride || 5));
        var forcedLimit = Math.max(0, Math.floor(
            profile.MaxShorelineWobbleCells !== undefined ?
                profile.MaxShorelineWobbleCells :
                Math.max(12, (width * height) / 160)
        ));

        // Off-map neighbours are treated as water so river endpoints that exit
        // through a map edge don't read as a long "land on the off-map side"
        // straight run and get retracted into nothing.
        var isLandNeighbour = function(cx, cy) {
            if(cx < 0 || cx >= width || cy < 0 || cy >= height) return false;
            return !MapGen.Layers.Get(layers.water, cx, cy, 0);
        };

        for(var y = 0; y < height; ++y) {
            for(var x = 0; x < width; ++x) {
                if(!MapGen.Layers.Get(layers.water, x, y, 0)) {
                    sig[y * width + x] = 0;
                    continue;
                }
                var s = 0;
                if(isLandNeighbour(x, y - 1)) s |= 1; // N land
                if(isLandNeighbour(x + 1, y)) s |= 2; // E land
                if(isLandNeighbour(x, y + 1)) s |= 4; // S land
                if(isLandNeighbour(x - 1, y)) s |= 8; // W land
                sig[y * width + x] = s;
            }
        }

        var canRetract = function(cx, cy) {
            // Never retract cells on the map border - those are river mouths
            // that need to stay water so the river reaches the edge.
            if(cx <= 0 || cx >= width - 1 || cy <= 0 || cy >= height - 1) return false;
            if(MapGen.Layers.Get(layers.keepClear, cx, cy, 0)) return false;
            if(MapGen.Layers.Get(layers.path, cx, cy, 0)) return false;
            if(MapGen.Layers.Get(layers.crossing, cx, cy, 0)) return false;
            if(MapGen.Layers.Get(layers.occupied, cx, cy, 0)) return false;
            return true;
        };

        var roll = function(cx, cy, salt) {
            var raw = MapGen.Random.HashTile(pContext.Seed, cx, cy, salt);
            return ((raw % 100) + 100) % 100;
        };

        var toLand = [];
        var toLandKeys = {};
        var forced = 0;

        var addRetract = function(cx, cy) {
            if(!canRetract(cx, cy))
                return false;

            var key = cx + "," + cy;
            if(toLandKeys[key])
                return false;

            toLandKeys[key] = true;
            toLand.push([cx, cy]);
            return true;
        };

        // Cardinal straight runs: cells whose only land-neighbor bit is the
        // same single direction for >=4 consecutive cells along the tangent.
        var sweepCardinal = function(landBit, axis, salt) {
            var outerLen = (axis === "h") ? height : width;
            var innerLen = (axis === "h") ? width : height;
            for(var o = 0; o < outerLen; ++o) {
                var runStart = -1;
                for(var i = 0; i <= innerLen; ++i) {
                    var cx = (axis === "h") ? i : o;
                    var cy = (axis === "h") ? o : i;
                    var inRun = (i < innerLen) && (sig[cy * width + cx] === landBit);
                    if(inRun) {
                        if(runStart < 0) runStart = i;
                    } else {
                        if(runStart >= 0 && (i - runStart) >= 4) {
                            var runLen = i - runStart;
                            for(var k = runStart + 1; k < i - 1; ++k) {
                                var rx = (axis === "h") ? k : o;
                                var ry = (axis === "h") ? o : k;
                                if(roll(rx, ry, salt) < 30)
                                    addRetract(rx, ry);
                            }

                            if(runLen >= straightRunLimit && forced < forcedLimit) {
                                var phase = roll(runStart, o, salt + 1000) % forcedStride;
                                for(var forcedStep = runStart + 1 + phase;
                                    forcedStep < i - 1 && forced < forcedLimit;
                                    forcedStep += forcedStride) {
                                    var frx = (axis === "h") ? forcedStep : o;
                                    var fry = (axis === "h") ? o : forcedStep;
                                    if(addRetract(frx, fry))
                                        ++forced;
                                }
                            }
                        }
                        runStart = -1;
                    }
                }
            }
        };

        sweepCardinal(1, "h", 811); // N-edge run, scan horizontally
        sweepCardinal(4, "h", 812); // S-edge run
        sweepCardinal(8, "v", 813); // W-edge run, scan vertically
        sweepCardinal(2, "v", 814); // E-edge run

        // Diagonal corner runs: cells with two adjacent land-neighbor bits
        // (sig 3=N+E, 6=S+E, 12=S+W, 9=N+W) chained for >=3 cells along the
        // appropriate diagonal — that pattern is exactly the clean stair-step
        // bank that SmoothInwardCorners can't otherwise touch.
        var diagonals = [
            { mask: 3,  dx: 1,  dy: -1 },
            { mask: 6,  dx: 1,  dy:  1 },
            { mask: 12, dx: -1, dy:  1 },
            { mask: 9,  dx: -1, dy: -1 }
        ];

        for(var d = 0; d < diagonals.length; ++d) {
            var dd = diagonals[d];
            for(var dy2 = 0; dy2 < height; ++dy2) {
                for(var dx2 = 0; dx2 < width; ++dx2) {
                    if(sig[dy2 * width + dx2] !== dd.mask) continue;
                    var px = dx2 - dd.dx;
                    var py = dy2 - dd.dy;
                    if(px >= 0 && px < width && py >= 0 && py < height && sig[py * width + px] === dd.mask)
                        continue;

                    var len = 0;
                    var cx2 = dx2;
                    var cy2 = dy2;
                    while(cx2 >= 0 && cx2 < width && cy2 >= 0 && cy2 < height && sig[cy2 * width + cx2] === dd.mask) {
                        cx2 += dd.dx;
                        cy2 += dd.dy;
                        ++len;
                    }
                    if(len < 3) continue;

                    cx2 = dx2;
                    cy2 = dy2;
                    for(var step = 0; step < len; ++step) {
                        if(roll(cx2, cy2, 815 + d) < 30)
                            addRetract(cx2, cy2);
                        cx2 += dd.dx;
                        cy2 += dd.dy;
                    }

                    var diagonalLimit = Math.max(3, Math.floor(straightRunLimit * 0.75));
                    if(len >= diagonalLimit && forced < forcedLimit) {
                        var phase2 = roll(dx2, dy2, 1900 + d) % forcedStride;
                        cx2 = dx2 + (dd.dx * phase2);
                        cy2 = dy2 + (dd.dy * phase2);
                        for(var forcedDiag = phase2;
                            forcedDiag < len && forced < forcedLimit;
                            forcedDiag += forcedStride) {
                            if(addRetract(cx2, cy2))
                                ++forced;
                            cx2 += dd.dx * forcedStride;
                            cy2 += dd.dy * forcedStride;
                        }
                    }
                }
            }
        }

        var retractedSet = {};
        for(var t = 0; t < toLand.length; ++t) {
            MapGen.Layers.Set(layers.water, toLand[t][0], toLand[t][1], 0);
            if(layers.riverBank)
                MapGen.Layers.Set(layers.riverBank, toLand[t][0], toLand[t][1], 0);
            if(layers.forcedBank)
                MapGen.Layers.Set(layers.forcedBank, toLand[t][0], toLand[t][1], 0);
            if(layers.lakeShore)
                MapGen.Layers.Set(layers.lakeShore, toLand[t][0], toLand[t][1], 0);
            retractedSet[toLand[t][0] + "," + toLand[t][1]] = true;
        }

        if(toLand.length)
            MapGen.Context.AddLog(pContext, "EdgeFuzz: retracted " + toLand.length + " bank cells, forced straight-run notches " + forced);

        return retractedSet;
    },

    // Re-run only the diagonal-pinch arm of SmoothInwardCorners, so EdgeFuzz
    // notches that accidentally produce tile-incompatible pinches get healed
    // without re-flattening the L-corners we deliberately introduced. Cells
    // that EdgeFuzz just retracted are excluded so this pass doesn't simply
    // refill the notches we deliberately cut into long bank runs.
    SmoothPinchesOnly: function(pContext, pRetracted) {
        var layers = pContext.Layers;
        var width = pContext.Width;
        var height = pContext.Height;
        var totalChanged = 0;
        var retracted = pRetracted || {};

        for(var pass = 0; pass < 2; ++pass) {
            var toFill = [];

            // Skip border cells — see SmoothInwardCorners for rationale.
            for(var y = 1; y < height - 1; ++y) {
                for(var x = 1; x < width - 1; ++x) {
                    if(MapGen.Layers.Get(layers.water, x, y, 0)) continue;
                    if(retracted[x + "," + y]) continue;
                    if(MapGen.Layers.Get(layers.keepClear, x, y, 0)) continue;
                    if(MapGen.Layers.Get(layers.path, x, y, 0)) continue;
                    if(MapGen.Layers.Get(layers.crossing, x, y, 0)) continue;
                    if(MapGen.Layers.Get(layers.occupied, x, y, 0)) continue;

                    var n = MapGen.Layers.Get(layers.water, x, y - 1, 0);
                    var s = MapGen.Layers.Get(layers.water, x, y + 1, 0);
                    var w = MapGen.Layers.Get(layers.water, x - 1, y, 0);
                    var e = MapGen.Layers.Get(layers.water, x + 1, y, 0);
                    var nw = MapGen.Layers.Get(layers.water, x - 1, y - 1, 0);
                    var ne = MapGen.Layers.Get(layers.water, x + 1, y - 1, 0);
                    var sw = MapGen.Layers.Get(layers.water, x - 1, y + 1, 0);
                    var se = MapGen.Layers.Get(layers.water, x + 1, y + 1, 0);

                    if((n && nw && ne) || (s && sw && se) || (w && nw && sw) || (e && ne && se))
                        toFill.push([x, y]);
                }
            }

            if(!toFill.length)
                break;

            for(var i = 0; i < toFill.length; ++i)
                MapGen.Layers.Set(layers.water, toFill[i][0], toFill[i][1], 1);

            totalChanged += toFill.length;
        }

        return totalChanged;
    },

    ShouldBuildStream: function(pContext) {
        var profile = pContext.Profile;

        if(!this.SupportsFeature(pContext, "rivers"))
            return false;

        if(!profile.MaxStreamCount || profile.MaxStreamCount < 1)
            return false;

        return pContext.Random.Chance(this.ScaledChance(pContext, profile.StreamChance, "riverChanceScale"));
    },

    StreamWidth: function(pContext) {
        var max = Math.max(1, Math.min(2, Math.floor(this.RiverWidth(pContext))));
        return Math.max(1, Math.min(max, pContext.Random.Int(1, max)));
    },

    BuildStreams: function(pContext) {
        if(!this.ShouldBuildStream(pContext))
            return null;

        var maxCount = Math.max(1, Math.floor(pContext.Profile.MaxStreamCount || 1));
        var attempts = pContext.Random.Int(1, maxCount);
        var built = [];

        for(var index = 0; index < attempts; ++index) {
            var stream = this.BuildStream(pContext);
            if(stream)
                built.push(stream);
        }

        return built;
    },

    BuildStream: function(pContext) {
        var sides = ["left", "right", "top", "bottom"];
        var startSide = sides[pContext.Random.Int(0, 3)];
        var endSide;

        if(startSide === "left")
            endSide = pContext.Random.Chance(0.7) ? "right" : "bottom";
        else if(startSide === "right")
            endSide = pContext.Random.Chance(0.7) ? "left" : "top";
        else if(startSide === "top")
            endSide = pContext.Random.Chance(0.7) ? "bottom" : "right";
        else
            endSide = pContext.Random.Chance(0.7) ? "top" : "left";

        var stream = {
            start: this.EdgePoint(pContext, startSide),
            end: this.EdgePoint(pContext, endSide),
            width: this.StreamWidth(pContext),
            points: [],
            kind: "stream"
        };

        this.DrawRiver(pContext, stream);
        this.PlaceStreamCrossings(pContext, stream);
        pContext.Rivers.push(stream);

        return stream;
    },

    PlaceStreamCrossings: function(pContext, pStream) {
        var crossing = {
            x: pStream.points[Math.floor(pStream.points.length * 0.5)].x,
            y: pStream.points[Math.floor(pStream.points.length * 0.5)].y,
            radius: pStream.width + 1,
            length: Math.max(2, pStream.width + 1),
            halfWidth: 1,
            axis: Math.abs(pStream.end.x - pStream.start.x) > Math.abs(pStream.end.y - pStream.start.y) ? "vertical" : "horizontal",
            role: "stream_crossing",
            surface: "ford"
        };

        if(this.CrossingTooClose(pContext, crossing, 6))
            return;

        pContext.Crossings.push(crossing);
        this.StampCrossingReservation(pContext, crossing);
    },

    DrawRiver: function(pContext, pRiver) {
        var dx = pRiver.end.x - pRiver.start.x;
        var dy = pRiver.end.y - pRiver.start.y;
        var profile = pContext.Profile;
        // T2.10: try a heightmap-driven momentum-biased flow trace first. If
        // the descent reaches (or near-reaches) the sink, the traced path
        // becomes the spine; otherwise fall through to the parametric meander.
        var flowPath = profile.RiverUseHeightmapFlow === false ?
            null : this.TraceFlow(pContext, pRiver.start, pRiver.end);
        var useFlow = !!(flowPath && flowPath.length >= 4);
        var steps = useFlow ? (flowPath.length - 1) : Math.max(Math.abs(dx), Math.abs(dy), 1);
        var meander = Math.max(1, Math.floor(Math.min(pContext.Width, pContext.Height) * profile.RiverMeander * 0.15));
        var baseWidth = Math.max(1, pRiver.width);
        // widthAmp was 2, which let radius swing baseWidth±2 (so 3..7 when
        // baseWidth=5). After binomial smoothing the swing was still large
        // enough that adjacent rows could differ by 2 cells of bank/wet width,
        // producing visible "bulge then narrow" patches in the wet band.
        // Tightening to ±1 keeps the river feeling natural without dramatic
        // per-row width changes.
        var widthAmp = baseWidth >= 2 ? 1 : 0;
        // Two strides give layered curvature: a long stride for slow bank waves
        // and a short stride for high-frequency wobble. Lerping between samples
        // keeps both layers smooth at the cell level.
        var widthStride = 3;
        var jitterStride = 4;
        var sampleNoise = function(sampleIndex, salt) {
            var raw = MapGen.Random.HashTile(pContext.Seed, sampleIndex, 0, salt);
            return (((raw % 2001) | 0) - 1000) / 1000;
        };
        var lerpedNoise = function(stepIndex, stride, salt) {
            var sampleIdx = stepIndex / stride;
            var sampleLow = Math.floor(sampleIdx);
            var lerpT = sampleIdx - sampleLow;
            var lo = sampleNoise(sampleLow, salt);
            var hi = sampleNoise(sampleLow + 1, salt);
            return lo + (hi - lo) * lerpT;
        };
        var horizontal = Math.abs(dx) > Math.abs(dy);

        // Multi-octave meander: a slow primary sine (one full cycle along the
        // river) plus a faster secondary sine with per-river phase shift,
        // plus lerped jitter for organic break-up. Frequencies and phase are
        // hashed from the river's start coords so the same seed reproduces
        // the same shape but adjacent rivers don't echo each other.
        var primaryAmp   = (typeof profile.RiverMeanderPrimary   === "number") ? profile.RiverMeanderPrimary   : 1.0;
        var secondaryAmp = (typeof profile.RiverMeanderSecondary === "number") ? profile.RiverMeanderSecondary : 0.45;
        var jitterAmp    = (typeof profile.RiverMeanderJitter    === "number") ? profile.RiverMeanderJitter    : 0.2;
        var riverHash = MapGen.Random.HashTile(pContext.Seed, pRiver.start.x, pRiver.start.y, 909);
        var k1    = 0.85 + ((riverHash % 1000) / 1000) * 0.30;
        var k2    = 0.85 + (((riverHash >>> 12) % 1000) / 1000) * 0.30;
        var phase = ((riverHash >>> 20) % 6283) / 1000;

        // Delta widening at coast mouths. If profile defines RiverDeltaWidth use
        // it; otherwise derive from baseWidth (×2.5). Endpoint is treated as a
        // mouth only when EdgePoint stamped a coastWaterWidth > 0.
        var deltaWidth = (typeof profile.RiverDeltaWidth === "number") ? profile.RiverDeltaWidth : Math.ceil(baseWidth * 2.5);
        var startIsMouth = pRiver.start && (pRiver.start.coastWaterWidth | 0) > 0;
        var endIsMouth   = pRiver.end   && (pRiver.end.coastWaterWidth   | 0) > 0;

        // Swell + throat regimes. Both positions are hashed per-river so the
        // shape is reproducible. Swell widens the river upstream of mid; throat
        // narrows it where a bridge would naturally land. Throat t is exported
        // on the river object so PlaceCrossings can snap a crossing to it.
        var swellAmp    = 1.4;
        var throatAmp   = 0.6;
        var swellSigma  = 0.06;
        var throatSigma = 0.05;
        var swellT  = 0.20 + (((riverHash >>> 4) % 1000) / 1000) * 0.20;
        var throatT = 0.45 + (((riverHash >>> 8) % 1000) / 1000) * 0.25;
        pRiver.swellT = swellT;
        pRiver.throatT = throatT;

        // Collect raw spine positions and widths first, then smooth them with a
        // 3-tap moving average before stamping. The per-step uncorrelated jitter
        // (added earlier to break up clean diagonal banks) was producing sawtooth
        // spine spikes — two consecutive disc centres could be 8+ cells apart in
        // x at the same y, leaving 1-3 cell land bridges in the middle of the
        // river. Smoothing the offset/jitter sum keeps the macro shape (sin
        // meander + lerped wobble) but kills the high-frequency spikes that
        // produce river splits.
        var rawX = [];
        var rawY = [];
        var rawWidth = [];

        for(var index = 0; index <= steps; ++index) {
            var t = steps > 0 ? index / steps : 0;
            var x, y;

            if(useFlow) {
                // T2.10: spine coordinates come from the flow descent path;
                // the parametric sin meander/jitter is suppressed because the
                // heightmap already supplies cell-by-cell curvature.
                x = flowPath[index].x;
                y = flowPath[index].y;
            } else {
                var primary   = Math.sin(t * Math.PI * 2 * k1) * primaryAmp;
                var secondary = Math.sin(t * Math.PI * 5 * k2 + phase) * secondaryAmp;
                var noiseTerm = lerpedNoise(index, jitterStride, 805) * jitterAmp;
                var wave = primary + secondary + noiseTerm;
                var offset = Math.round(wave * meander);
                x = Math.round(pRiver.start.x + (dx * t));
                y = Math.round(pRiver.start.y + (dy * t));

                if(horizontal)
                    y += offset;
                else
                    x += offset;
            }

            rawX.push(x);
            rawY.push(y);

            var width = baseWidth;
            if(widthAmp > 0) {
                var widthDelta = Math.round(lerpedNoise(index, widthStride, 803) * widthAmp);
                width = Math.max(1, baseWidth + widthDelta);
            }
            // Swell + throat: gaussian multipliers around the per-river hashed
            // positions. Apply before delta widening so mouth widening dominates.
            var dSwell  = t - swellT;
            var dThroat = t - throatT;
            var swellMul  = 1 + (swellAmp  - 1) * Math.exp(-(dSwell  * dSwell)  / (2 * swellSigma  * swellSigma));
            var throatMul = 1 + (throatAmp - 1) * Math.exp(-(dThroat * dThroat) / (2 * throatSigma * throatSigma));
            width = Math.max(1, Math.round(width * swellMul * throatMul));
            // Lerp the spine width up to deltaWidth across the last 15% of the
            // run (and the first 15% if the start side is also a coast).
            if(endIsMouth && deltaWidth > width && t > 0.85) {
                var endRamp = (t - 0.85) / 0.15;
                width = Math.round(width + (deltaWidth - width) * endRamp);
            }
            if(startIsMouth && deltaWidth > width && t < 0.15) {
                var startRamp = (0.15 - t) / 0.15;
                width = Math.round(width + (deltaWidth - width) * startRamp);
            }
            rawWidth.push(width);
        }

        // 3-tap moving average on the off-axis spine and on width. Endpoints are
        // preserved so the river mouth stays anchored to the chosen edge cell.
        var smoothX = [];
        var smoothY = [];
        var smoothWidth = [];

        // 5-tap binomial smoothing on BOTH axes plus width. Smoothing only the
        // variable axis isn't enough because per-step Y jitter on a vertical
        // river causes y to stutter (e.g. 18, 18, 20, 19, 21) which leaves the
        // x-progression of consecutive discs at the *same* y far enough apart
        // that their bodies don't overlap, splitting the river. Smoothing both
        // axes guarantees monotonic-ish progression so consecutive discs always
        // overlap. Endpoints are pinned so the river still anchors to its mouth.
        var binomial = function(values, idx) {
            if(idx === 0 || idx === values.length - 1)
                return values[idx];
            if(idx === 1 || idx === values.length - 2)
                return Math.round((values[idx - 1] + values[idx] * 2 + values[idx + 1]) / 4);
            return Math.round((values[idx - 2] + values[idx - 1] * 4 + values[idx] * 6 + values[idx + 1] * 4 + values[idx + 2]) / 16);
        };

        for(var si = 0; si < rawX.length; ++si) {
            smoothX.push(binomial(rawX, si));
            smoothY.push(binomial(rawY, si));
            smoothWidth.push(binomial(rawWidth, si));
        }

        for(var pi = 0; pi < smoothX.length; ++pi) {
            // Most rivers may approach a side normally. Composition profiles
            // can reserve a larger cross-axis margin so a meandering river
            // does not spend half its run flattened against the map boundary
            // and read as an accidental coastline. Along-axis coordinates
            // remain edge-adjacent so the mouth extension below still exits.
            var requestedSpineMargin = Math.floor(Number(profile.RiverSpineMargin));
            var spineMargin = isNaN(requestedSpineMargin) ? 1 :
                Math.max(1, requestedSpineMargin);
            var maxSpineMargin = horizontal ?
                Math.max(1, Math.floor((pContext.Height - 2) / 3)) :
                Math.max(1, Math.floor((pContext.Width - 2) / 3));
            spineMargin = Math.min(spineMargin, maxSpineMargin);
            var sx = horizontal ?
                Math.max(1, Math.min(pContext.Width - 2, smoothX[pi])) :
                Math.max(spineMargin, Math.min(pContext.Width - 1 - spineMargin, smoothX[pi]));
            var sy = horizontal ?
                Math.max(spineMargin, Math.min(pContext.Height - 1 - spineMargin, smoothY[pi])) :
                Math.max(1, Math.min(pContext.Height - 2, smoothY[pi]));
            var sw = Math.max(1, smoothWidth[pi]);

            pRiver.points.push({ x: sx, y: sy });
            MapGen.Layers.StampDisc(pContext.Layers.water, sx, sy, sw, 1);
        }

        // Extend the river past both map edges so it exits at full width.
        // The path is clamped to [1, H-2] / [1, W-2] so the boundary row
        // (y=0 or y=H-1) only receives a single anchor disc - too narrow
        // to match the river's interior width, leaving thin ~/W slivers
        // the canonical ice tileset has no bank tile for. We explicitly
        // fill a cross-stream band of overlapping discs at the boundary,
        // and continue stamping past the edge so off-map cells still
        // contribute to the bank-detector neighbourhood at the boundary.
        //
        // When Continent is active, EdgePoint walks the endpoint inland to
        // the first land cell — if the continent doesn't reach this side of
        // the map, the endpoint is far from the edge and the band stamps
        // would clobber the continent's border land with a perimeter water
        // ring. Only fire the band on a side where the endpoint is actually
        // near the boundary.
        var anchorWidth = Math.max(1, baseWidth);
        var bandHalf = baseWidth + 1;
        var bandRadius = anchorWidth;
        var extension = anchorWidth + 2;
        var edgeNearThreshold = 3;

        if(horizontal) {
            var startSY = smoothY[0];
            var endSY = smoothY[smoothY.length - 1];
            var startAtEdge = pRiver.start.x <= edgeNearThreshold;
            var endAtEdge = pRiver.end.x >= pContext.Width - 1 - edgeNearThreshold;
            for(var bx = -extension; bx <= 0; ++bx) {
                for(var bo = -bandHalf; bo <= bandHalf; ++bo) {
                    if(startAtEdge)
                        MapGen.Layers.StampDisc(pContext.Layers.water,
                            bx, startSY + bo, bandRadius, 1);
                    if(endAtEdge)
                        MapGen.Layers.StampDisc(pContext.Layers.water,
                            pContext.Width - 1 - bx, endSY + bo, bandRadius, 1);
                }
            }
        }
        else {
            var startSX = smoothX[0];
            var endSX = smoothX[smoothX.length - 1];
            var startAtEdgeV = pRiver.start.y <= edgeNearThreshold;
            var endAtEdgeV = pRiver.end.y >= pContext.Height - 1 - edgeNearThreshold;
            for(var by = -extension; by <= 0; ++by) {
                for(var boo = -bandHalf; boo <= bandHalf; ++boo) {
                    if(startAtEdgeV)
                        MapGen.Layers.StampDisc(pContext.Layers.water,
                            startSX + boo, by, bandRadius, 1);
                    if(endAtEdgeV)
                        MapGen.Layers.StampDisc(pContext.Layers.water,
                            endSX + boo, pContext.Height - 1 - by, bandRadius, 1);
                }
            }
        }

        // Bump recorded width so NearRiver / crossing checks cover the widest stamp.
        pRiver.width = baseWidth + widthAmp;
    },

    PlaceCrossings: function(pContext, pRiver) {
        var count = Math.max(1, pContext.Profile.CrossingCount || 1);
        var minDistance = Math.max(10, (pRiver.width + 1) * 4);
        var hasThroat = typeof pRiver.throatT === "number";

        // Composition profiles can anchor the primary crossing to the route
        // reservation instead of merely placing it at the river's narrowest
        // point. This is decided before Connectivity and bridge stamping, so
        // the bridge, route, and intact river all agree on one location.
        var routeCrossingPoint = null;
        if(pContext.Profile.RiverCrossingPreferRoute &&
            pContext.Layers && pContext.Layers.owner && pRiver.points.length) {
            var preferredIndex = hasThroat ?
                Math.floor(pRiver.points.length * pRiver.throatT) :
                Math.floor(pRiver.points.length * 0.5);
            var searchRadius = Math.max(1, Math.floor(Number(pRiver.width || 1)));
            var bestRouteScore = 0x7FFFFFFF;

            for(var routePointIndex = 0; routePointIndex < pRiver.points.length; ++routePointIndex) {
                var routePoint = pRiver.points[routePointIndex];
                var nearestRouteDistance = 0x7FFFFFFF;
                for(var routeDx = -searchRadius; routeDx <= searchRadius; ++routeDx) {
                    for(var routeDy = -searchRadius; routeDy <= searchRadius; ++routeDy) {
                        if(MapGen.Layers.Get(pContext.Layers.owner,
                            routePoint.x + routeDx, routePoint.y + routeDy, 0) !== MapGen.Layers.Owner.ROUTE)
                            continue;
                        var routeDistance = (routeDx * routeDx) + (routeDy * routeDy);
                        if(routeDistance < nearestRouteDistance)
                            nearestRouteDistance = routeDistance;
                    }
                }
                if(nearestRouteDistance === 0x7FFFFFFF)
                    continue;

                var routeScore = (Math.abs(routePointIndex - preferredIndex) * 16) + nearestRouteDistance;
                if(routeScore < bestRouteScore) {
                    bestRouteScore = routeScore;
                    routeCrossingPoint = routePoint;
                }
            }
        }

        for(var index = 0; index < count; ++index) {
            // First crossing snaps to the throat when one is exported, so
            // bridge artwork lands on the narrow point. Remaining crossings
            // stay evenly spaced.
            var fraction = (hasThroat && index === 0) ? pRiver.throatT : (index + 1) / (count + 1);
            var pointIndex = Math.min(pRiver.points.length - 1, Math.floor(pRiver.points.length * fraction));
            var point = (index === 0 && routeCrossingPoint) ? routeCrossingPoint : pRiver.points[pointIndex];
            var crossing = {
                x: point.x,
                y: point.y,
                radius: pRiver.width + 1,
                length: Math.max(3, (pRiver.width * 2) + 2),
                halfWidth: 1,
                axis: Math.abs(pRiver.end.x - pRiver.start.x) > Math.abs(pRiver.end.y - pRiver.start.y) ? "vertical" : "horizontal",
                role: "river_crossing",
                surface: "ford"
            };

            // Branches are already planned: move crossings along the parent
            // instead of fitting a bridge down a tributary junction.
            if(pContext.RegionalPlan && !this.CrossingAvoidsTributaries(pContext, crossing)) {
                var preferred = pRiver.points.indexOf(point), replacement = null;
                for(var shift = 1; shift < pRiver.points.length && !replacement; ++shift) {
                    for(var side = -1; side <= 1; side += 2) {
                        var at = preferred + shift * side;
                        if(at < 0 || at >= pRiver.points.length) continue;
                        crossing.x = pRiver.points[at].x; crossing.y = pRiver.points[at].y;
                        if(!this.CrossingTooClose(pContext, crossing, minDistance) &&
                            this.CrossingAvoidsTributaries(pContext, crossing)) {
                            replacement = pRiver.points[at]; break;
                        }
                    }
                }
                if(!replacement) continue;
            }
            if(this.CrossingTooClose(pContext, crossing, minDistance))
                continue;

            pContext.Crossings.push(crossing);
            this.StampCrossingReservation(pContext, crossing);
        }
    },

    CrossingAvoidsTributaries: function(c, crossing) {
        var probe = {Crossings:[crossing]};
        for(var i = 0; i < c.Rivers.length; ++i) {
            var branch = c.Rivers[i];
            if(branch.kind === "river_branch" &&
                !this.TributaryAvoidsCrossings(probe, branch.points, branch.width)) return false;
        }
        return true;
    },

    StampCrossingReservation: function(pContext, pCrossing) {
        var length = Math.max(2, Math.floor(pCrossing.length || ((pCrossing.radius || 1) * 2)));
        var halfWidth = Math.max(1, Math.floor(pCrossing.halfWidth || 1));

        for(var offset = -length; offset <= length; ++offset) {
            for(var side = -halfWidth; side <= halfWidth; ++side) {
                var x = pCrossing.x + (pCrossing.axis === "horizontal" ? offset : side);
                var y = pCrossing.y + (pCrossing.axis === "vertical" ? offset : side);

                MapGen.Layers.Set(pContext.Layers.keepClear, x, y, 1);
            }
        }
    },

    CrossingTooClose: function(pContext, pCrossing, pMinDistance) {
        var minDistanceSq = pMinDistance * pMinDistance;

        for(var index = 0; index < pContext.Crossings.length; ++index) {
            var existing = pContext.Crossings[index];
            var dx = existing.x - pCrossing.x;
            var dy = existing.y - pCrossing.y;

            if((dx * dx) + (dy * dy) < minDistanceSq)
                return true;
        }

        return false;
    },

    PondPoint: function(pContext) {
        var margin = Math.max(6, pContext.Profile.ClearingRadius || 4);

        return {
            x: pContext.Random.Int(margin, Math.max(margin, pContext.Width - margin - 1)),
            y: pContext.Random.Int(margin, Math.max(margin, pContext.Height - margin - 1)),
            role: "pond"
        };
    },

    PointNearAnchors: function(pContext, pX, pY, pRadius) {
        var anchors = pContext.Anchors || {};
        var radiusSq = pRadius * pRadius;

        for(var key in anchors) {
            if(!anchors.hasOwnProperty(key))
                continue;

            var anchor = anchors[key];
            if(!anchor || typeof anchor.x !== "number" || typeof anchor.y !== "number")
                continue;

            var dx = anchor.x - pX;
            var dy = anchor.y - pY;
            if((dx * dx) + (dy * dy) <= radiusSq)
                return true;
        }

        return false;
    },

    LakeTooCloseToWaterFeature: function(pContext, pX, pY, pRadius) {
        var features = [];
        var i;

        for(i = 0; i < pContext.Ponds.length; ++i)
            features.push(pContext.Ponds[i]);
        for(i = 0; i < pContext.Lakes.length; ++i)
            features.push(pContext.Lakes[i]);
        for(i = 0; i < pContext.Crossings.length; ++i)
            features.push(pContext.Crossings[i]);

        for(i = 0; i < features.length; ++i) {
            var other = features[i];
            var otherRadius = other.radius || 1;
            var minDistance = pRadius + otherRadius + 5;
            var dx = other.x - pX;
            var dy = other.y - pY;
            if((dx * dx) + (dy * dy) <= minDistance * minDistance)
                return true;
        }

        return false;
    },

    LakePoint: function(pContext, pRadius) {
        var margin = Math.max(pRadius + 4, pContext.Profile.ClearingRadius || 4);

        for(var attempt = 0; attempt < 40; ++attempt) {
            var point = {
                x: pContext.Random.Int(margin, Math.max(margin, pContext.Width - margin - 1)),
                y: pContext.Random.Int(margin, Math.max(margin, pContext.Height - margin - 1)),
                role: "lake"
            };

            if(this.PointNearAnchors(pContext, point.x, point.y, pRadius + 8))
                continue;
            if(this.LakeTooCloseToWaterFeature(pContext, point.x, point.y, pRadius))
                continue;
            if(MapGen.Layers.Get(pContext.Layers.water, point.x, point.y, 0))
                continue;

            return point;
        }

        return null;
    },

    // T2.10: 4-octave value-noise heightmap, smoothstep bilerped, normalised
    // to [0..1]. Cached on pContext so a single map's flow trace + branch
    // descents share the same surface. Salts are deterministic so repeated
    // runs at the same seed reproduce the same shape.
    BuildHeightmap: function(pContext) {
        if(pContext.Heightmap)
            return pContext.Heightmap;

        var W = pContext.Width;
        var H = pContext.Height;
        var seed = pContext.Seed;

        var sampleNoise = function(ix, iy, salt) {
            var raw = MapGen.Random.HashTile(seed, ix, iy, salt);
            return (((raw % 10000) + 10000) % 10000) / 10000;
        };
        var smooth = function(t) { return t * t * (3 - 2 * t); };
        var octave = function(fx, fy, freq, salt) {
            var sx = fx * freq;
            var sy = fy * freq;
            var ix = Math.floor(sx);
            var iy = Math.floor(sy);
            var u = smooth(sx - ix);
            var v = smooth(sy - iy);
            var a = sampleNoise(ix,     iy,     salt);
            var b = sampleNoise(ix + 1, iy,     salt);
            var c = sampleNoise(ix,     iy + 1, salt);
            var d = sampleNoise(ix + 1, iy + 1, salt);
            var ab = a + (b - a) * u;
            var cd = c + (d - c) * u;
            return ab + (cd - ab) * v;
        };

        var hm = MapGen.Layers.Create(W, H, 0);
        var minV = Number.POSITIVE_INFINITY;
        var maxV = Number.NEGATIVE_INFINITY;
        var freqs = [3, 6, 12, 24];
        var salts = [3001, 3002, 3003, 3004];

        for(var x = 0; x < W; ++x) {
            for(var y = 0; y < H; ++y) {
                var fx = x / Math.max(1, W - 1);
                var fy = y / Math.max(1, H - 1);
                var v = 0, amp = 1, total = 0;
                for(var o = 0; o < freqs.length; ++o) {
                    v += octave(fx, fy, freqs[o], salts[o]) * amp;
                    total += amp;
                    amp *= 0.5;
                }
                v = total > 0 ? v / total : 0;
                hm[x][y] = v;
                if(v < minV) minV = v;
                if(v > maxV) maxV = v;
            }
        }

        var span = maxV - minV;
        if(span > 0) {
            for(var nx = 0; nx < W; ++nx)
                for(var ny = 0; ny < H; ++ny)
                    hm[nx][ny] = (hm[nx][ny] - minV) / span;
        }

        pContext.Heightmap = hm;
        return hm;
    },

    // T2.10: 8-neighbour momentum-biased steepest-descent walk with
    // pull toward the sink. When stuck (no admissible descent), punch
    // through saddles up to saddleTolerance. Returns the path (start..end)
    // or null if the walker can't reach near the sink within the iteration
    // budget.
    TraceFlow: function(pContext, pStart, pEnd) {
        if(!pStart || !pEnd)
            return null;

        this.BuildHeightmap(pContext);
        var hm = pContext.Heightmap;
        var W = pContext.Width;
        var H = pContext.Height;
        var seed = pContext.Seed;

        var sx = Math.max(1, Math.min(W - 2, pStart.x | 0));
        var sy = Math.max(1, Math.min(H - 2, pStart.y | 0));
        var ex = Math.max(1, Math.min(W - 2, pEnd.x | 0));
        var ey = Math.max(1, Math.min(H - 2, pEnd.y | 0));

        var alpha = 0.18;            // momentum
        var beta  = 0.05;            // noise
        var pull  = 0.08;            // attraction toward sink
        var saddleTolerance = 0.15;
        var maxIter = (W + H) * 4;

        var dirs = [
            [1, 0],  [-1, 0], [0, 1],  [0, -1],
            [1, 1],  [1, -1], [-1, 1], [-1, -1]
        ];

        var path = [{ x: sx, y: sy }];
        var visited = {};
        visited[sx + "," + sy] = true;

        var x = sx, y = sy;
        var prevDx = 0, prevDy = 0;

        for(var iter = 0; iter < maxIter; ++iter) {
            if(x === ex && y === ey)
                return path;

            var hereH = hm[x][y];
            var distGoal = Math.max(1, Math.abs(ex - x) + Math.abs(ey - y));
            var gdx = (ex - x) / distGoal;
            var gdy = (ey - y) / distGoal;

            var bestScore = Number.POSITIVE_INFINITY;
            var bestDx = 0, bestDy = 0;

            for(var d = 0; d < dirs.length; ++d) {
                var ndx = dirs[d][0];
                var ndy = dirs[d][1];
                var nx = x + ndx;
                var ny = y + ndy;
                if(nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;
                if(visited[nx + "," + ny]) continue;

                var nh = hm[nx][ny];
                var dh = nh - hereH; // negative => downhill
                if(dh > 0) continue; // strict descent in normal mode

                var ndlen = (ndx === 0 || ndy === 0) ? 1 : Math.SQRT2;
                var pullScore = -((ndx / ndlen) * gdx + (ndy / ndlen) * gdy);
                var momentum  = (prevDx === 0 && prevDy === 0) ? 0 :
                                -((ndx * prevDx + ndy * prevDy) / ndlen);
                var noiseRaw = MapGen.Random.HashTile(seed, nx, ny, 7777);
                var noise = (((noiseRaw % 1001) - 500) / 500);

                var score = dh + alpha * momentum + beta * noise + pull * pullScore;
                if(score < bestScore) {
                    bestScore = score;
                    bestDx = ndx;
                    bestDy = ndy;
                }
            }

            if(bestDx === 0 && bestDy === 0) {
                // Saddle-punch: pick lowest in-tolerance neighbour, biased
                // toward the sink so we don't oscillate around a basin.
                var saddleBest = Number.POSITIVE_INFINITY;
                var sdx = 0, sdy = 0;
                for(var d2 = 0; d2 < dirs.length; ++d2) {
                    var n2x = x + dirs[d2][0];
                    var n2y = y + dirs[d2][1];
                    if(n2x < 1 || n2y < 1 || n2x >= W - 1 || n2y >= H - 1) continue;
                    if(visited[n2x + "," + n2y]) continue;
                    var n2h = hm[n2x][n2y];
                    if((n2h - hereH) > saddleTolerance) continue;
                    var pullS = -((dirs[d2][0]) * gdx + (dirs[d2][1]) * gdy);
                    var s2 = n2h + 0.30 * pullS;
                    if(s2 < saddleBest) {
                        saddleBest = s2;
                        sdx = dirs[d2][0];
                        sdy = dirs[d2][1];
                    }
                }
                if(sdx === 0 && sdy === 0) {
                    // Truly stuck. If we got close to the sink, append it and
                    // accept; otherwise abort and let the caller fall back.
                    if((Math.abs(ex - x) + Math.abs(ey - y)) <= 6) {
                        path.push({ x: ex, y: ey });
                        return path;
                    }
                    return null;
                }
                bestDx = sdx;
                bestDy = sdy;
            }

            prevDx = bestDx;
            prevDy = bestDy;
            x += bestDx;
            y += bestDy;
            path.push({ x: x, y: y });
            visited[x + "," + y] = true;
        }

        if((Math.abs(ex - x) + Math.abs(ey - y)) <= 6) {
            path.push({ x: ex, y: ey });
            return path;
        }
        return null;
    },

    // T2.11: pure downhill walk on the heightmap from a source until we hit
    // existing water or a local minimum. Used by branch tributaries which
    // need a natural sink rather than a fixed endpoint.
    WalkDownhill: function(pContext, pStart, pMaxLen) {
        this.BuildHeightmap(pContext);
        var hm = pContext.Heightmap;
        var W = pContext.Width;
        var H = pContext.Height;

        var x = Math.max(1, Math.min(W - 2, pStart.x | 0));
        var y = Math.max(1, Math.min(H - 2, pStart.y | 0));
        var path = [{ x: x, y: y }];
        var visited = {};
        visited[x + "," + y] = true;

        var dirs = [
            [1, 0],  [-1, 0], [0, 1],  [0, -1],
            [1, 1],  [1, -1], [-1, 1], [-1, -1]
        ];
        var prevDx = 0, prevDy = 0;
        var alpha = 0.10;
        var maxLen = Math.max(6, pMaxLen | 0);

        for(var i = 0; i < maxLen; ++i) {
            var hereH = hm[x][y];
            var bestScore = Number.POSITIVE_INFINITY;
            var bestDx = 0, bestDy = 0;
            for(var d = 0; d < dirs.length; ++d) {
                var ndx = dirs[d][0];
                var ndy = dirs[d][1];
                var nx = x + ndx;
                var ny = y + ndy;
                if(nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;
                if(visited[nx + "," + ny]) continue;
                var nh = hm[nx][ny];
                if(nh > hereH) continue;
                var ndlen = (ndx === 0 || ndy === 0) ? 1 : Math.SQRT2;
                var momentum = (prevDx === 0 && prevDy === 0) ? 0 :
                               -((ndx * prevDx + ndy * prevDy) / ndlen);
                var score = nh + alpha * momentum;
                if(score < bestScore) {
                    bestScore = score;
                    bestDx = ndx;
                    bestDy = ndy;
                }
            }
            if(bestDx === 0 && bestDy === 0)
                break;
            prevDx = bestDx;
            prevDy = bestDy;
            x += bestDx;
            y += bestDy;
            path.push({ x: x, y: y });
            visited[x + "," + y] = true;
            if(MapGen.Layers.Get(pContext.Layers.water, x, y, 0))
                break;
        }
        return path;
    },

    // T2.11: roll branches off the main spine. RiverBranchChance gates the
    // first branch; each successful branch may recurse up to MaxBranchDepth
    // with reduced length and width. The first joint is reserved as a bridge
    // candidate via the existing crossing reservation machinery.
    BuildBranches: function(pContext, pParent) {
        if(!pParent || !pParent.points || pParent.points.length < 6)
            return;

        var profile = pContext.Profile;
        var branchChance = (typeof profile.RiverBranchChance === "number") ? profile.RiverBranchChance : 0;
        var maxDepth = (typeof profile.MaxBranchDepth === "number") ? Math.floor(profile.MaxBranchDepth) : 2;
        if(branchChance <= 0 || maxDepth <= 0)
            return;

        if(pContext.RegionalPlan ? !pParent.branchPlanned : !pContext.Random.Chance(branchChance))
            return;

        this.BuildBranchRecursive(pContext, pParent, 1, maxDepth, true);
    },

    BuildBranchRecursive: function(pContext, pParent, pDepth, pMaxDepth, pReserveCrossing) {
        if(pDepth > pMaxDepth)
            return;

        var random = pContext.Random;
        var points = pParent.points;
        if(!points || points.length < 6)
            return;

        // Pick a joint along the parent (avoid the first/last 25% so the
        // branch reads as a tributary rather than a forked mouth).
        var lo = Math.max(2, Math.floor(points.length * 0.25));
        var hi = Math.min(points.length - 3, Math.floor(points.length * 0.75));
        if(hi <= lo)
            return;
        var jointIdx = random.Int(lo, hi);
        var joint = points[jointIdx];

        var maxLen = Math.max(8, Math.floor(points.length * (0.45 / pDepth)));
        var branchWidth = Math.max(1, (pParent.width || 2) - pDepth);
        // Recorded parent width includes modulation. Subtracting one and then
        // adding modulation again previously made tributaries as wide as it.
        if(pContext.RegionalPlan)
            branchWidth = Math.max(1, Math.min(2, Math.floor((pParent.width || 2) / 2) - pDepth + 1));
        // A walk starting inside the parent immediately hits its next water
        // cell and stops. Regional tributaries start on a dry bank and flow
        // back to the joint, so the branch can actually leave the main river.
        var path = null;
        if(pContext.RegionalPlan) {
            // A junction beside a reserved crossing can stretch its bridge
            // down the tributary. Search a few distributed joints instead.
            var span = hi - lo + 1, trials = Math.min(8, span);
            for(var trial = 0; trial < trials && !path; ++trial) {
                var candidate = lo + ((jointIdx - lo + Math.floor(trial * span / trials)) % span);
                path = this.RegionalTributaryPath(pContext, pParent, candidate, maxLen, branchWidth);
                if(path) { jointIdx = candidate; joint = points[candidate]; }
            }
            // A local height minimum can reject every short flow path. Try a
            // bounded curve only after those candidates fail; keep it clear
            // of reserved land and existing crossings.
            for(var fallback = 0; fallback < trials && !path; ++fallback) {
                var fallbackIndex = lo + ((jointIdx - lo + Math.floor(fallback * span / trials)) % span);
                path = this.RegionalTributaryPath(pContext, pParent, fallbackIndex, maxLen, branchWidth, true);
                if(path) { jointIdx = fallbackIndex; joint = points[fallbackIndex]; }
            }
        } else {
            path = this.WalkDownhill(pContext, joint, maxLen);
        }
        if(!path || path.length < 4)
            return;

        var endPoint = path[path.length - 1];
        var branch = {
            start: { x: joint.x, y: joint.y, role: "river_branch" },
            end:   { x: endPoint.x, y: endPoint.y, role: "river_branch_end" },
            width: branchWidth,
            points: [],
            kind: "river_branch",
            depth: pDepth
        };

        this.StampBranchSpine(pContext, branch, path);

        // Regional routes already have parent crossings. A crossing at the
        // junction runs along the branch; connectivity can route around its tip.
        if(pReserveCrossing && pDepth === 1 && !pContext.RegionalPlan) {
            var prev = points[Math.max(0, jointIdx - 1)];
            var next = points[Math.min(points.length - 1, jointIdx + 1)];
            var axis = Math.abs(next.x - prev.x) > Math.abs(next.y - prev.y) ? "vertical" : "horizontal";
            var crossing = {
                x: joint.x,
                y: joint.y,
                radius: branchWidth + 1,
                length: Math.max(3, (branchWidth * 2) + 2),
                halfWidth: 1,
                axis: axis,
                role: "branch_joint",
                surface: "ford"
            };
            if(!this.CrossingTooClose(pContext, crossing, 6)) {
                pContext.Crossings.push(crossing);
                this.StampCrossingReservation(pContext, crossing);
            }
        }

        pContext.Rivers.push(branch);

        if(pDepth < pMaxDepth && random.Chance((pContext.Profile.RiverBranchChance || 0) * 0.6))
            this.BuildBranchRecursive(pContext, branch, pDepth + 1, pMaxDepth, false);
    },

    TributaryAvoidsCrossings: function(c, path, width) {
        // Match StampCrossingReservation's rectangle, including the branch's
        // widest disc and a bank apron. Checking the source alone misses bends.
        var radius = width + (width >= 2 ? 1 : 0) + 2;
        for(var ci = 0; ci < c.Crossings.length; ++ci) {
            var crossing = c.Crossings[ci];
            var length = Math.max(2, Math.floor(crossing.length || ((crossing.radius || 1) * 2)));
            var half = Math.max(1, Math.floor(crossing.halfWidth || 1));
            for(var pi = 0; pi < path.length; ++pi) {
                var dx = Math.abs(path[pi].x - crossing.x), dy = Math.abs(path[pi].y - crossing.y);
                var along = crossing.axis === "horizontal" ? dx : dy;
                var across = crossing.axis === "horizontal" ? dy : dx;
                if(along <= length + radius && across <= half + radius) return false;
            }
        }
        return true;
    },

    TributaryCurve: function(c, source, joint) {
        var dx = joint.x - source.x, dy = joint.y - source.y;
        var distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        var bend = (MapGen.Random.HashTile(c.Seed, source.x, source.y, 19429) / 4294967296 * 2 - 1) *
            Math.min(3, distance * 0.2);
        var steps = Math.ceil(distance), path = [source];
        for(var step = 1; step <= steps; ++step) {
            var t = step / steps, offset = 4 * t * (1 - t) * bend;
            var point = {
                x: Math.max(1, Math.min(c.Width - 2, Math.round(source.x + dx * t - dy / distance * offset))),
                y: Math.max(1, Math.min(c.Height - 2, Math.round(source.y + dy * t + dx / distance * offset)))
            };
            path = path.concat(MapGen.Grammar.Route.LinePoints(path[path.length - 1], point, true));
        }
        return path;
    },

    RegionalTributaryPath: function(c, parent, jointIndex, length, width, fallback) {
        if(this.WaterBudgetExceeded(c)) return null;
        var points = parent.points, joint = points[jointIndex];
        var a = points[Math.max(0, jointIndex - 3)], b = points[Math.min(points.length - 1, jointIndex + 3)];
        var dx = b.x - a.x, dy = b.y - a.y, span = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        var sign = fallback ? (MapGen.Random.HashTile(c.Seed, joint.x, joint.y, 19427) % 2 ? 1 : -1) :
            (c.Random.Chance(0.5) ? 1 : -1);
        length = Math.min(length, Math.round(Math.min(c.Width, c.Height) * 0.28));
        for(var side = 0; side < 2; ++side) {
            var direction = side ? -sign : sign;
            var source = {x: Math.max(3, Math.min(c.Width - 4, Math.round(joint.x - dy / span * length * direction))),
                y: Math.max(3, Math.min(c.Height - 4, Math.round(joint.y + dx / span * length * direction)))};
            if(!this.CanStampLakeCell(c, source.x, source.y, 5) ||
                MapGen.Layers.Get(c.Layers.water, source.x, source.y, 0)) continue;
            var path = fallback ? this.TributaryCurve(c, source, joint) : this.TraceFlow(c, source, joint);
            if(!path || path.length < 7) continue;
            // TraceFlow may finish with a short jump to the sink. Fill that
            // last segment so narrow tributaries cannot leave a dry gap.
            var sink = path.pop();
            path = path.concat(MapGen.Grammar.Route.LinePoints(path[path.length - 1], sink, true));
            if(path.length > length * 2 + 1) continue;
            if(!this.TributaryAvoidsCrossings(c, path, width)) continue;
            var dry = 0, fits = true;
            for(var i = 0; i < path.length; ++i) {
                if(MapGen.Layers.Get(c.Layers.water, path[i].x, path[i].y, 0)) continue;
                ++dry;
                if(fallback && !this.CanStampLakeCell(c, path[i].x, path[i].y, width + 2)) {
                    fits = false; break;
                }
            }
            if(fits && dry >= 6) return path.reverse();
        }
        return null;
    },

    // Stamp a pre-computed spine path with width modulation. Lighter than
    // DrawRiver — no swell/throat/delta widening, no edge bands — branches
    // are short and don't terminate at a coast mouth.
    StampBranchSpine: function(pContext, pRiver, pPath) {
        var baseWidth = Math.max(1, pRiver.width);
        var widthAmp = baseWidth >= 2 ? 1 : 0;
        var seed = pContext.Seed;
        var sampleNoise = function(sampleIndex, salt) {
            var raw = MapGen.Random.HashTile(seed, sampleIndex, 0, salt);
            return (((raw % 2001) | 0) - 1000) / 1000;
        };
        var lerpedNoise = function(stepIndex, stride, salt) {
            var sampleIdx = stepIndex / stride;
            var sampleLow = Math.floor(sampleIdx);
            var lerpT = sampleIdx - sampleLow;
            var lo = sampleNoise(sampleLow, salt);
            var hi = sampleNoise(sampleLow + 1, salt);
            return lo + (hi - lo) * lerpT;
        };

        var rawWidth = [];
        for(var i = 0; i < pPath.length; ++i) {
            var w = baseWidth;
            if(widthAmp > 0)
                w = Math.max(1, baseWidth + Math.round(lerpedNoise(i, 3, 803) * widthAmp));
            rawWidth.push(w);
        }

        // 3-tap binomial smooth on width.
        var smoothW = [];
        for(var si = 0; si < rawWidth.length; ++si) {
            if(si === 0 || si === rawWidth.length - 1)
                smoothW.push(rawWidth[si]);
            else
                smoothW.push(Math.round((rawWidth[si - 1] + rawWidth[si] * 2 + rawWidth[si + 1]) / 4));
        }

        for(var pi = 0; pi < pPath.length; ++pi) {
            var sx = Math.max(1, Math.min(pContext.Width - 2, pPath[pi].x));
            var sy = Math.max(1, Math.min(pContext.Height - 2, pPath[pi].y));
            var sw = Math.max(1, smoothW[pi]);
            pRiver.points.push({ x: sx, y: sy });
            MapGen.Layers.StampDisc(pContext.Layers.water, sx, sy, sw, 1);
        }

        pRiver.width = baseWidth + widthAmp;
    },

    CanStampLakeCell: function(pContext, pX, pY, pClearance) {
        if(!MapGen.Layers.InBounds(pContext.Layers.water, pX, pY))
            return false;
        // Architecture v3: never flood the reserved ROUTE corridor (claimed by
        // Skeleton before water). Lakes pool beside the path, not over it.
        if(pContext.Layers.owner &&
            MapGen.Layers.Get(pContext.Layers.owner, pX, pY, 0) === MapGen.Layers.Owner.ROUTE)
            return false;
        // Same protection for the cliff reservation (Option A,
        // [[mapgen_cliff_option_a_staged]]). Lake water inside the cliff band
        // would be rejected by PlateauCliffs.cellBlocksStamp at planning time.
        // cliffReserve=0 on non-ice — byte-identical no-op.
        if(pContext.Layers.cliffReserve &&
            MapGen.Layers.Get(pContext.Layers.cliffReserve, pX, pY, 0))
            return false;
        if(MapGen.Layers.Get(pContext.Layers.keepClear, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.path, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.crossing, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.causeway, pX, pY, 0) ||
            MapGen.Layers.Get(pContext.Layers.occupied, pX, pY, 0))
            return false;

        return !this.PointNearAnchors(pContext, pX, pY, pClearance || 4);
    },

    StampIrregularLake: function(pContext, pLake) {
        var radius = Math.max(3, pLake.radius | 0);
        var rx = radius + pContext.Random.Int(0, 2);
        var ry = Math.max(3, radius - pContext.Random.Int(0, 1));
        var angle = pContext.Random.Float(0, Math.PI);
        var cosA = Math.cos(angle);
        var sinA = Math.sin(angle);
        var maxR = Math.max(rx, ry) + 2;
        var stamped = 0;

        for(var dx = -maxR; dx <= maxR; ++dx) {
            for(var dy = -maxR; dy <= maxR; ++dy) {
                var px = pLake.x + dx;
                var py = pLake.y + dy;
                if(!this.CanStampLakeCell(pContext, px, py, 4))
                    continue;

                var ex = (dx * cosA) + (dy * sinA);
                var ey = (-dx * sinA) + (dy * cosA);
                var normalized = (ex * ex) / (rx * rx) + (ey * ey) / (ry * ry);
                var wobble = ((MapGen.Random.HashTile(pContext.Seed || 0, px, py, 1321) % 1000) / 1000) - 0.5;

                if(normalized <= 1.0 + (wobble * 0.18)) {
                    if(!MapGen.Layers.Get(pContext.Layers.water, px, py, 0))
                        ++stamped;
                    MapGen.Layers.Set(pContext.Layers.water, px, py, 1);
                    if(pContext.Layers.lakeShore)
                        MapGen.Layers.Set(pContext.Layers.lakeShore, px, py, 1);
                }
            }
        }

        var satellites = pContext.Random.Int(1, 2);
        for(var index = 0; index < satellites; ++index) {
            var satelliteAngle = pContext.Random.Float(0, Math.PI * 2);
            var distance = pContext.Random.Int(Math.max(2, Math.floor(radius * 0.45)), Math.max(3, radius));
            var sx = Math.round(pLake.x + Math.cos(satelliteAngle) * distance);
            var sy = Math.round(pLake.y + Math.sin(satelliteAngle) * distance);
            var sr = Math.max(2, Math.floor(radius * pContext.Random.Float(0.35, 0.55)));
            var radiusSq = sr * sr;

            for(var sdx = -sr; sdx <= sr; ++sdx) {
                for(var sdy = -sr; sdy <= sr; ++sdy) {
                    if((sdx * sdx) + (sdy * sdy) > radiusSq)
                        continue;
                    var spx = sx + sdx;
                    var spy = sy + sdy;
                    if(!this.CanStampLakeCell(pContext, spx, spy, 4))
                        continue;
                    if(!MapGen.Layers.Get(pContext.Layers.water, spx, spy, 0))
                        ++stamped;
                    MapGen.Layers.Set(pContext.Layers.water, spx, spy, 1);
                    if(pContext.Layers.lakeShore)
                        MapGen.Layers.Set(pContext.Layers.lakeShore, spx, spy, 1);
                }
            }
        }

        return stamped;
    },

    BuildLakes: function(pContext) {
        if(!this.ShouldBuildLake(pContext))
            return null;

        var maxCount = Math.max(1, this.PolicyMax(pContext, "maxLakeCount", pContext.Profile.MaxLakeCount || 1));
        var count = pContext.Random.Int(1, maxCount);
        var lakes = [];
        var stampedTotal = 0;

        for(var index = 0; index < count; ++index) {
            // Stop adding area-scaled lakes once the water budget is spent.
            if(index > 0 && this.WaterBudgetExceeded(pContext))
                break;
            var radius = this.LakeRadius(pContext);
            var point = this.LakePoint(pContext, radius);
            if(!point)
                continue;

            var lake = {
                x: point.x,
                y: point.y,
                radius: radius,
                role: "lake"
            };
            var stamped = this.StampIrregularLake(pContext, lake);
            if(stamped <= 0)
                continue;

            lake.tiles = stamped;
            pContext.Lakes.push(lake);
            lakes.push(lake);
            stampedTotal += stamped;
        }

        if(stampedTotal)
            MapGen.Context.AddLog(pContext, "Built ice lakes: " + lakes.length + " lakes, " + stampedTotal + " water tiles");

        return lakes.length ? lakes : null;
    },

    BuildPonds: function(pContext) {
        if(!this.ShouldBuildPond(pContext))
            return null;

        var count = pContext.Random.Int(1, Math.max(1, this.PolicyMax(pContext, "maxPondCount", pContext.Profile.MaxPondCount || 1)));
        var ponds = [];

        for(var index = 0; index < count; ++index) {
            // Stop adding area-scaled ponds once the water budget is spent.
            if(index > 0 && this.WaterBudgetExceeded(pContext))
                break;
            var point = this.PondPoint(pContext);
            var radius = this.PondRadius(pContext);
            var pond = {
                x: point.x,
                y: point.y,
                radius: radius,
                role: "pond"
            };

            ponds.push(pond);
            pContext.Ponds.push(pond);
            MapGen.Layers.StampDisc(pContext.Layers.water, pond.x, pond.y, pond.radius, 1);
        }

        return ponds;
    }
};
