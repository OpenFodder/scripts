var MapGen = MapGen || {};
MapGen.Layout = MapGen.Layout || {};

MapGen.Layout.Continent = {

    StyleDefaults: {
        island:    { landFraction: 0.74, position: "centre",   jitter: 0.15 },
        edge:      { landFraction: 0.86, position: "edge",     jitter: 0.15 },
        rectangle: { landFraction: 0.92, position: "centre",   jitter: 0.10 },
        mainland:  { landFraction: 1.00, position: "centre",   jitter: 0.00 }
    },

    Build: function(pContext) {
        var profile = pContext.Profile;
        if(!profile)
            return;

        // Archipelago.Build runs first when the profile rolls the archipelago
        // style; it stamps its own land mask + pContext.Continent. Bail so we
        // don't overwrite it.
        if(pContext.Continent)
            return;

        if(profile.ContinentStyles === undefined && profile.LandFraction === undefined)
            return;

        // Reuse the style Archipelago.ShouldRun rolled (if any). If we ran
        // first — e.g. a profile that doesn't include archipelago — roll now
        // and cache for any later reader.
        var style = pContext.SelectedContinentStyle;
        if(style === undefined) {
            style = this.PickStyle(profile, pContext.Random);
            pContext.SelectedContinentStyle = style;
        }
        var landFraction = this.LandFractionForStyle(profile, style);
        if(style === "mainland") {
            this.BuildMainland(pContext);
            return;
        }
        if(isNaN(landFraction) || landFraction <= 0 || landFraction >= 1)
            return;

        var W = pContext.Width;
        var H = pContext.Height;
        var random = pContext.Random;

        var land = this.AllocateMask(W, H);

        var seed = this.PickSeed(pContext, W, H, random, style);
        land[seed.x][seed.y] = 1;

        var landCount = 1;
        var targetLand = Math.round(W * H * landFraction);
        if(targetLand < 1)
            targetLand = 1;

        var frontier = [];
        var frontierIndex = this.AllocateMask(W, H);
        this.SeedFrontier(land, frontierIndex, frontier, W, H, seed.x, seed.y);

        var iterCap = W * H * 2;
        var iters = 0;
        while(landCount < targetLand && frontier.length > 0 && iters < iterCap) {
            ++iters;

            var totalWeight = 0;
            var i;
            for(i = 0; i < frontier.length; ++i) {
                var cell = frontier[i];
                var n = this.LandNeighbourCount(land, W, H, cell.x, cell.y);
                cell._w = (1 + n) * (1 + n);
                totalWeight += cell._w;
            }

            if(totalWeight <= 0)
                break;

            var pick = random.Float(0, totalWeight);
            var pickIdx = 0;
            var acc = 0;
            for(i = 0; i < frontier.length; ++i) {
                acc += frontier[i]._w;
                if(acc >= pick) {
                    pickIdx = i;
                    break;
                }
            }

            var picked = frontier[pickIdx];
            land[picked.x][picked.y] = 1;
            ++landCount;
            frontierIndex[picked.x][picked.y] = 0;
            frontier[pickIdx] = frontier[frontier.length - 1];
            frontier.pop();

            this.PushNeighbours(land, frontierIndex, frontier, W, H, picked.x, picked.y);
        }

        landCount = this.SmoothMask(land, W, H);
        landCount = this.SmoothMask(land, W, H);
        landCount = this.TrimSlivers(land, W, H);
        landCount = this.SmoothMask(land, W, H);

        // The frontier walk weights cells by (1 + landNeighbours)^2 which biases
        // growth toward concavities; even with reflective-boundary smoothing,
        // the walk typically reaches column 1 / row 1 only via SmoothMask
        // promotion. Promote the outermost ring to follow whatever sits at the
        // second-from-edge ring, then run one more smoothing pass so the
        // promotion blends with neighbours. Without this, every map has a
        // 1-cell water moat at any border the walk didn't reach naturally,
        // which produces a continuous shallow-water `~` ring on the rendered
        // ice maps.
        this.ExtendToBorder(land, W, H);
        landCount = this.SmoothMask(land, W, H);

        for(var x = 0; x < W; ++x) {
            for(var y = 0; y < H; ++y) {
                MapGen.Layers.Set(pContext.Layers.water, x, y, land[x][y] ? 0 : 1);
                // Architecture v3 canvas pass: seed the ownership grid. Land is
                // OPEN (awaiting fill); sea is WATER. Later passes claim upward
                // (route/clearing/cliff) and never overwrite a higher owner.
                MapGen.Layers.Set(pContext.Layers.owner, x, y,
                    land[x][y] ? MapGen.Layers.Owner.OPEN : MapGen.Layers.Owner.WATER);
            }
        }

        pContext.Continent = {
            centre: { x: seed.x, y: seed.y },
            landCount: landCount,
            targetLand: targetLand,
            landFraction: landCount / (W * H),
            style: style
        };
    },

    BuildMainland: function(pContext) {
        var W = pContext.Width;
        var H = pContext.Height;
        var total = W * H;

        // An inland canvas is intentionally dry at the macro-landmass stage.
        // Rivers, ponds, lakes and later feature passes can still add water,
        // producing maps that do not all begin as an island with a sea frame.
        for(var x = 0; x < W; ++x) {
            for(var y = 0; y < H; ++y) {
                MapGen.Layers.Set(pContext.Layers.water, x, y, 0);
                MapGen.Layers.Set(pContext.Layers.owner, x, y, MapGen.Layers.Owner.OPEN);
            }
        }

        pContext.Continent = {
            centre: { x: Math.floor(W / 2), y: Math.floor(H / 2) },
            landCount: total,
            targetLand: total,
            landFraction: 1,
            style: "mainland"
        };
        pContext.SelectedContinentStyle = "mainland";
        MapGen.Context.AddLog(pContext, "Continent selected inland mainland canvas");
    },

    PickStyle: function(pProfile, pRandom) {
        var styles = pProfile.ContinentStyles;
        if(!styles || !styles.length)
            return "island";
        var total = 0;
        for(var i = 0; i < styles.length; ++i) {
            if(styles[i] && styles[i].weight > 0)
                total += styles[i].weight;
        }
        if(!(total > 0))
            return "island";
        var roll = pRandom.Float(0, total);
        var acc = 0;
        for(var j = 0; j < styles.length; ++j) {
            if(!styles[j] || !(styles[j].weight > 0)) continue;
            acc += styles[j].weight;
            if(roll <= acc)
                return styles[j].name;
        }
        return styles[styles.length - 1].name;
    },

    LandFractionForStyle: function(pProfile, pStyle) {
        if(pProfile.ContinentStyles) {
            for(var i = 0; i < pProfile.ContinentStyles.length; ++i) {
                var entry = pProfile.ContinentStyles[i];
                if(entry && entry.name === pStyle && entry.landFraction !== undefined)
                    return Number(entry.landFraction);
            }
        }
        var def = this.StyleDefaults[pStyle];
        if(def && def.landFraction !== undefined)
            return def.landFraction;
        return Number(pProfile.LandFraction);
    },

    AllocateMask: function(pW, pH) {
        var m = [];
        for(var x = 0; x < pW; ++x) {
            m[x] = [];
            for(var y = 0; y < pH; ++y)
                m[x][y] = 0;
        }
        return m;
    },

    PickSeed: function(pContext, pW, pH, pRandom, pStyle) {
        var def = this.StyleDefaults[pStyle] || this.StyleDefaults.island;
        var cx, cy;
        if(def.position === "edge") {
            var side = pRandom.Int(0, 3);
            if(side === 0) {
                cx = pRandom.Float(0.10, 0.25) * pW;
                cy = pRandom.Float(0.30, 0.70) * pH;
            } else if(side === 1) {
                cx = pRandom.Float(0.75, 0.90) * pW;
                cy = pRandom.Float(0.30, 0.70) * pH;
            } else if(side === 2) {
                cx = pRandom.Float(0.30, 0.70) * pW;
                cy = pRandom.Float(0.10, 0.25) * pH;
            } else {
                cx = pRandom.Float(0.30, 0.70) * pW;
                cy = pRandom.Float(0.75, 0.90) * pH;
            }
        } else {
            var jitter = def.jitter !== undefined ? def.jitter : 0.15;
            cx = pW * 0.5 + pRandom.Float(-jitter, jitter) * pW;
            cy = pH * 0.5 + pRandom.Float(-jitter, jitter) * pH;
        }
        cx = Math.floor(cx);
        cy = Math.floor(cy);
        if(cx < 2) cx = 2;
        if(cx > pW - 3) cx = pW - 3;
        if(cy < 2) cy = 2;
        if(cy > pH - 3) cy = pH - 3;
        return { x: cx, y: cy };
    },

    SeedFrontier: function(pLand, pIndex, pFrontier, pW, pH, pX, pY) {
        this.PushNeighbours(pLand, pIndex, pFrontier, pW, pH, pX, pY);
    },

    ExtendToBorder: function(pLand, pW, pH) {
        // Force the entire 1-cell border to land. The frontier walk's
        // (1+n)^2 curvature weighting biases growth toward concavities so it
        // rarely fills the perimeter; the leftover edge water is then
        // *protected* by Repair.WaterTrimCandidates (edgeBonus = +100000,
        // which assumes any border water is a river mouth) and survives the
        // MaxWaterCoverage trim. The result is a continuous shallow-water
        // `~` ring along whatever border the walk didn't reach. Bays come
        // from Coast/Rivers carving water inside the continent later, not
        // from continent-walk leftovers at the perimeter.
        for(var x = 0; x < pW; ++x) {
            pLand[x][0] = 1;
            pLand[x][pH - 1] = 1;
        }
        for(var y = 0; y < pH; ++y) {
            pLand[0][y] = 1;
            pLand[pW - 1][y] = 1;
        }
    },

    PushNeighbours: function(pLand, pIndex, pFrontier, pW, pH, pX, pY) {
        var dx = [1, -1, 0, 0];
        var dy = [0, 0, 1, -1];
        for(var i = 0; i < 4; ++i) {
            var nx = pX + dx[i];
            var ny = pY + dy[i];
            if(nx < 0 || ny < 0 || nx >= pW || ny >= pH) continue;
            if(pLand[nx][ny]) continue;
            if(pIndex[nx][ny]) continue;
            pIndex[nx][ny] = 1;
            pFrontier.push({ x: nx, y: ny, _w: 0 });
        }
    },

    LandNeighbourCount: function(pLand, pW, pH, pX, pY) {
        var n = 0;
        if(pX > 0 && pLand[pX - 1][pY]) ++n;
        if(pX < pW - 1 && pLand[pX + 1][pY]) ++n;
        if(pY > 0 && pLand[pX][pY - 1]) ++n;
        if(pY < pH - 1 && pLand[pX][pY + 1]) ++n;
        return n;
    },

    TrimSlivers: function(pLand, pW, pH) {
        // Erode thin tendrils that survive 5/4 cellular smoothing: a 3-wide
        // finger has ≥5 Moore neighbours but only ~17 of 48 cells in a 7×7
        // window are land. Trimming at the wider window dissolves the finger
        // before MarkBanks rings it with phantom banks.
        //
        // Reflective boundary: out-of-bounds neighbours mirror the cell itself,
        // so border land cells aren't unfairly eroded just for being adjacent
        // to the map edge. Without this, the continent always recedes one cell
        // from each border, leaving a phantom water moat around the perimeter.
        var radius = 3;
        var threshold = 18;
        var next = this.AllocateMask(pW, pH);
        var landCount = 0;

        for(var x = 0; x < pW; ++x) {
            for(var y = 0; y < pH; ++y) {
                if(!pLand[x][y]) {
                    next[x][y] = 0;
                    continue;
                }
                var n = 0;
                var inBounds = 0;
                for(var dx = -radius; dx <= radius; ++dx) {
                    for(var dy = -radius; dy <= radius; ++dy) {
                        if(dx === 0 && dy === 0) continue;
                        var nx = x + dx;
                        var ny = y + dy;
                        if(nx < 0 || ny < 0 || nx >= pW || ny >= pH) continue;
                        ++inBounds;
                        if(pLand[nx][ny]) ++n;
                    }
                }
                // Mirror: OOB cells count as 1 (same as this land cell).
                var totalArea = (radius * 2 + 1) * (radius * 2 + 1) - 1;
                var oob = totalArea - inBounds;
                var nMirrored = n + oob;
                var alive = nMirrored >= threshold ? 1 : 0;
                next[x][y] = alive;
                if(alive) ++landCount;
            }
        }

        for(var x2 = 0; x2 < pW; ++x2) {
            for(var y2 = 0; y2 < pH; ++y2)
                pLand[x2][y2] = next[x2][y2];
        }

        return landCount;
    },

    SmoothMask: function(pLand, pW, pH) {
        // Reflective boundary: out-of-bounds neighbours mirror the center cell.
        // For an interior cell this is identical to the standard 5/4 rule. For
        // a border cell, OOB votes match the cell's own state so the rule
        // weighs only the in-bounds 5×5 neighbourhood. Without this, every
        // 1-cell border layer gets eroded each pass and the continent never
        // reaches the map edge — producing a perimeter water moat with thick
        // bank/wet rings.
        var next = this.AllocateMask(pW, pH);
        var landCount = 0;

        for(var x = 0; x < pW; ++x) {
            for(var y = 0; y < pH; ++y) {
                var n = 0;
                var inBounds = 0;
                for(var dx = -1; dx <= 1; ++dx) {
                    for(var dy = -1; dy <= 1; ++dy) {
                        if(dx === 0 && dy === 0) continue;
                        var nx = x + dx;
                        var ny = y + dy;
                        if(nx < 0 || ny < 0 || nx >= pW || ny >= pH) continue;
                        ++inBounds;
                        if(pLand[nx][ny]) ++n;
                    }
                }

                var here = pLand[x][y] ? 1 : 0;
                var oob = 8 - inBounds;
                var nMirrored = n + (here ? oob : 0);
                var alive = (nMirrored >= 5) || (here && nMirrored >= 4);
                next[x][y] = alive ? 1 : 0;
                if(alive) ++landCount;
            }
        }

        for(var x2 = 0; x2 < pW; ++x2) {
            for(var y2 = 0; y2 < pH; ++y2)
                pLand[x2][y2] = next[x2][y2];
        }

        return landCount;
    },

    IsLand: function(pContext, pX, pY) {
        if(pX < 0 || pY < 0 || pX >= pContext.Width || pY >= pContext.Height)
            return false;
        return MapGen.Layers.Get(pContext.Layers.water, pX, pY, 0) === 0;
    },

    Finalise: function(pContext) {
        if(!pContext.Continent || !pContext.Layers || !pContext.Layers.water)
            return;

        var W = pContext.Width;
        var H = pContext.Height;
        var water = pContext.Layers.water;

        var label = this.AllocateMask(W, H);
        var components = [];

        for(var sx = 0; sx < W; ++sx) {
            for(var sy = 0; sy < H; ++sy) {
                if(label[sx][sy]) continue;
                if(MapGen.Layers.Get(water, sx, sy, 0)) continue;
                var id = components.length + 1;
                var size = 0;
                var stack = [[sx, sy]];
                while(stack.length) {
                    var c = stack.pop();
                    var cx = c[0], cy = c[1];
                    if(cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
                    if(label[cx][cy]) continue;
                    if(MapGen.Layers.Get(water, cx, cy, 0)) continue;
                    label[cx][cy] = id;
                    ++size;
                    stack.push([cx + 1, cy]);
                    stack.push([cx - 1, cy]);
                    stack.push([cx, cy + 1]);
                    stack.push([cx, cy - 1]);
                }
                components.push({ id: id, size: size });
            }
        }

        // Archipelago intentionally produces multiple islands joined by
        // causeways; skip eviction so the islands survive even if a causeway
        // disc didn't quite stitch two components into one. Mainland canvases
        // also retain every dry component: a deliberate edge-to-edge river
        // naturally separates its two banks, and flooding the smaller bank
        // turns that river into a giant coastline.
        var isArchipelago = pContext.Continent && pContext.Continent.mode === "archipelago";
        var isMainland = pContext.Continent && pContext.Continent.style === "mainland";
        if(components.length > 1 && !isArchipelago && !isMainland) {
            var mainId = 0;
            var mainSize = -1;
            for(var i = 0; i < components.length; ++i) {
                if(components[i].size > mainSize) {
                    mainSize = components[i].size;
                    mainId = components[i].id;
                }
            }

            for(var x = 0; x < W; ++x) {
                for(var y = 0; y < H; ++y) {
                    if(label[x][y] && label[x][y] !== mainId)
                        MapGen.Layers.Set(water, x, y, 1);
                }
            }
        }

        this.FillWaterHoles(pContext);
        this.BleedWaterToBorder(pContext);

        if(pContext.Anchors) {
            var key;
            for(key in pContext.Anchors) {
                if(!pContext.Anchors.hasOwnProperty(key)) continue;
                var anchor = pContext.Anchors[key];
                if(!anchor) continue;
                var snapped = this.WideSnapToLand(pContext, anchor);
                anchor.x = snapped.x;
                anchor.y = snapped.y;
            }
        }

        this.TrimEdgeWaterLanes(pContext);
        this.SnapshotLandMask(pContext);
    },

    TrimEdgeWaterLanes: function(pContext) {
        // Single-cell perimeter water lanes — a border cell that's water with
        // a land cell immediately inward — render as a one-tile shallow ring
        // around the map. Coast/EdgeBiomes/Rivers/wet-apron all leak into
        // this ring even when the visible feature is several cells inland.
        // Convert those isolated edge cells back to land so the existing
        // tree/decor passes (which iterate the full grid) extend cover to
        // the literal map border. Snapshotted so the trim never reads its
        // own writes — corner cells decide based on the original water
        // state, not the post-trim row.
        if(!pContext.Layers || !pContext.Layers.water)
            return;

        var W = pContext.Width;
        var H = pContext.Height;
        var water = pContext.Layers.water;
        var coast = pContext.Layers.coast;
        var bank = pContext.Layers.riverBank;
        var cleared = 0;

        var snap = [];
        for(var sx = 0; sx < W; ++sx) {
            snap[sx] = [];
            for(var sy = 0; sy < H; ++sy)
                snap[sx][sy] = water[sx][sy] ? 1 : 0;
        }

        function trim(x, y, ix, iy) {
            if(!snap[x][y]) return false;
            if(ix < 0 || iy < 0 || ix >= W || iy >= H) return false;
            if(snap[ix][iy]) return false;
            MapGen.Layers.Set(water, x, y, 0);
            if(coast) MapGen.Layers.Set(coast, x, y, 0);
            if(bank) MapGen.Layers.Set(bank, x, y, 0);
            return true;
        }

        for(var x = 0; x < W; ++x) {
            if(trim(x, 0, x, 1)) ++cleared;
            if(trim(x, H - 1, x, H - 2)) ++cleared;
        }
        for(var y = 0; y < H; ++y) {
            if(trim(0, y, 1, y)) ++cleared;
            if(trim(W - 1, y, W - 2, y)) ++cleared;
        }

        if(cleared)
            MapGen.Context.AddLog(pContext, "Trimmed " + cleared + " single-cell perimeter water lanes");
    },

    BleedWaterToBorder: function(pContext) {
        // ExtendToBorder seals the perimeter to land before Coast and Rivers
        // run, so a river that passes near the edge leaves a 1-2 cell land
        // ring between itself and the map border. The wet apron rule then
        // paints that ring as `W` and the smoother emits an ice-edge
        // transition strip on the literal map edge.
        //
        // For each border cell, scan up to `maxReach` cells perpendicular for
        // water; if found, fill the gap with water so the river/bay reaches
        // the edge. Snapshot the water layer first so promotions don't
        // chain along the border. Border water survives the trim pass via
        // Repair.WaterTrimCandidates' +100000 edgeBonus.
        //
        // maxReach=2 is conservative on purpose: with a wider reach Coast's
        // edge bites cascade and the entire perimeter ends up water; with
        // reach=1 the wet apron between river and edge (typical inset 2-3)
        // never gets covered.
        if(!pContext.Profile || !pContext.Profile.LandFraction) return;
        if(!pContext.Layers || !pContext.Layers.water) return;

        var W = pContext.Width;
        var H = pContext.Height;
        var water = pContext.Layers.water;
        var maxReach = 2;

        // Snapshot so this pass never sees its own promotions.
        var snap = [];
        for(var sx = 0; sx < W; ++sx) {
            snap[sx] = [];
            for(var sy = 0; sy < H; ++sy)
                snap[sx][sy] = MapGen.Layers.Get(water, sx, sy, 0) ? 1 : 0;
        }

        function reach(sx, sy, dx, dy) {
            for(var k = 1; k <= maxReach; ++k) {
                var cx = sx + dx * k;
                var cy = sy + dy * k;
                if(cx < 0 || cy < 0 || cx >= W || cy >= H) return -1;
                if(snap[cx][cy]) return k;
            }
            return -1;
        }

        function fillTo(sx, sy, dx, dy, k) {
            for(var f = 0; f < k; ++f)
                MapGen.Layers.Set(water, sx + dx * f, sy + dy * f, 1);
        }

        var y, x, k;
        for(y = 0; y < H; ++y) {
            if(!snap[0][y]) {
                k = reach(0, y, 1, 0);
                if(k > 0) fillTo(0, y, 1, 0, k);
            }
            if(!snap[W - 1][y]) {
                k = reach(W - 1, y, -1, 0);
                if(k > 0) fillTo(W - 1, y, -1, 0, k);
            }
        }
        for(x = 0; x < W; ++x) {
            if(!snap[x][0]) {
                k = reach(x, 0, 0, 1);
                if(k > 0) fillTo(x, 0, 0, 1, k);
            }
            if(!snap[x][H - 1]) {
                k = reach(x, H - 1, 0, -1);
                if(k > 0) fillTo(x, H - 1, 0, -1, k);
            }
        }
    },

    FillWaterHoles: function(pContext) {
        // Coast and Rivers may leave 1-2 cell water holes embedded in the
        // continent. IsBankGroundCell paints `~` on every land cell within
        // Chebyshev-2 of any water — so a 1-cell hole rings 24 surrounding
        // ice cells with phantom banks. Iteratively fill holes whose 3×3
        // neighbourhood contains no protected water (≥4 land neighbours and
        // not on the coast layer).
        var W = pContext.Width;
        var H = pContext.Height;
        var water = pContext.Layers.water;
        var coast = pContext.Layers.coast;
        var iter = 0;
        var changed = true;

        while(changed && iter < 4) {
            changed = false;
            ++iter;
            for(var x = 1; x < W - 1; ++x) {
                for(var y = 1; y < H - 1; ++y) {
                    if(!MapGen.Layers.Get(water, x, y, 0)) continue;
                    if(MapGen.Layers.Get(coast, x, y, 0)) continue;

                    var landCount = 0;
                    for(var dy = -1; dy <= 1; ++dy) {
                        for(var dx = -1; dx <= 1; ++dx) {
                            if(dx === 0 && dy === 0) continue;
                            if(!MapGen.Layers.Get(water, x + dx, y + dy, 0))
                                ++landCount;
                        }
                    }

                    if(landCount >= 7) {
                        MapGen.Layers.Set(water, x, y, 0);
                        changed = true;
                    }
                }
            }
        }
    },

    SnapshotLandMask: function(pContext) {
        if(!pContext.Layers || !pContext.Layers.water || !pContext.Continent)
            return;
        var W = pContext.Width;
        var H = pContext.Height;
        var snapshot = [];
        for(var x = 0; x < W; ++x) {
            snapshot[x] = [];
            for(var y = 0; y < H; ++y)
                snapshot[x][y] = pContext.Layers.water[x][y] ? 1 : 0;
        }
        pContext.Continent.LandMask = snapshot;
    },

    WideSnapToLand: function(pContext, pPoint) {
        var W = pContext.Width;
        var H = pContext.Height;
        var anchors = MapGen.Layout && MapGen.Layout.Anchors ? MapGen.Layout.Anchors : null;
        var inset = anchors ? anchors.BorderInset(pContext, "AnchorBorderInset", 4) : 4;
        var point = anchors ? anchors.ClampPointWithInset(pContext, pPoint, inset) : pPoint;

        if(!MapGen.Layers.Get(pContext.Layers.water, point.x, point.y, 0))
            return point;

        var maxR = Math.max(2, Math.floor(Math.max(W, H) / 2));
        var fallback = null;
        for(var r = 1; r <= maxR; ++r) {
            for(var dx = -r; dx <= r; ++dx) {
                for(var dy = -r; dy <= r; ++dy) {
                    if(Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                    var nx = point.x + dx;
                    var ny = point.y + dy;
                    if(nx < 1 || ny < 1 || nx > W - 2 || ny > H - 2) continue;
                    if(MapGen.Layers.Get(pContext.Layers.water, nx, ny, 0)) continue;
                    var candidate = { x: nx, y: ny, role: pPoint.role };
                    if(!anchors || anchors.PointInsideInset(pContext, candidate, inset))
                        return candidate;
                    if(!fallback)
                        fallback = candidate;
                }
            }
        }
        return fallback || point;
    }
};
