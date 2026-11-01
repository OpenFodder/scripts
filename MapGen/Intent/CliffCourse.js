var MapGen = MapGen || {};
MapGen.Intent = MapGen.Intent || {};

// Shared atlas-safe height phrases for corner and regional ice cliffs.
MapGen.Intent.CliffCourse = {
    Regional: function(c, top, cross) {
        var shape = c.Profile.RegionalIceCliffShape;
        if(["rising", "falling", "ridge", "valley"].indexOf(shape) < 0) return null;
        var W = c.Width, H = c.Height, leftEnd = cross - 3, rightStart = cross + 5;
        var amplitude = Math.min(Math.floor((H - 48) / 2),
            Math.floor(Math.min(W, H) * 0.20), leftEnd, W - rightStart - 1);
        if(amplitude < 2) return null;
        top = Math.max(22 + amplitude, Math.min(H - 26 - amplitude, top));
        var left = top + (shape === "falling" || shape === "valley" ? -amplitude : amplitude);
        var right = top + (shape === "rising" || shape === "valley" ? -amplitude : amplitude);
        var hash = MapGen.Random.HashTile;
        var ascent = this.SlopeOffsets(top - left, leftEnd, hash(c.Seed, 0, 0, 19523));
        var descent = this.SlopeOffsets(right - top, W - rightStart - 1, hash(c.Seed, 0, 0, 19529));
        var columns = [], min = top, max = top;
        for(var x = 0; x < W; ++x) {
            // A broad flat landing surrounds the complete three-column stair.
            var y = x <= leftEnd ? left + ascent[x] :
                x >= rightStart ? top + descent[x - rightStart] : top;
            columns.push({x:x, topY:y}); min = Math.min(min, y); max = Math.max(max, y);
        }
        return {shape:shape, top:top, min:min, max:max, columns:columns};
    },

    // Build a one-cell-at-a-time cliff slope which the shipped ice atlas can
    // actually join.  Its step strips may repeat, but two separate step runs
    // need at least two body columns between them (step -> body_v3 ->
    // body_v0 -> step).  Linear rounding frequently produced step/body/step,
    // for which no legal strip sequence exists.
    SlopeOffsets: function(pDelta, pEdgeCount, pSequenceSeed) {
        var offsets = [0];
        var direction = pDelta < 0 ? -1 : 1;
        var changes = Math.abs(pDelta) | 0;
        if(changes === 0 || pEdgeCount <= 0) {
            while(offsets.length <= pEdgeCount)
                offsets.push(0);
            return offsets;
        }

        // A cliff column may move by at most one row.  Callers gate out maps
        // too narrow to fit the complete edge-to-edge terrace phrase.
        if(changes > pEdgeCount)
            return null;

        var flatEdges = pEdgeCount - changes;
        var clusterCount = Math.min(4, changes,
            1 + Math.floor(flatEdges / 2));
        if(pSequenceSeed !== undefined)
            clusterCount = 1 + MapGen.Random.HashTile(pSequenceSeed, 271, 277, 4237) % clusterCount;
        var clusterSizes = [];
        var clusterBase = Math.floor(changes / clusterCount);
        var clusterExtra = changes % clusterCount;
        for(var clusterIndex = 0; clusterIndex < clusterCount; ++clusterIndex) {
            clusterSizes.push(clusterBase +
                (clusterIndex < clusterExtra ? 1 : 0));
        }

        var gapSizes = [];
        for(var gapIndex = 0; gapIndex <= clusterCount; ++gapIndex)
            gapSizes.push(gapIndex > 0 && gapIndex < clusterCount ? 2 : 0);
        var spareFlats = flatEdges - ((clusterCount - 1) * 2);
        // Spread spare flats across the phrase rather than leaving one long,
        // conspicuously straight landing at either end.
        var spreadIndex = 0;
        while(spareFlats-- > 0) {
            var gap = pSequenceSeed === undefined ? spreadIndex % gapSizes.length :
                MapGen.Random.HashTile(pSequenceSeed, spreadIndex, 281, 4241) % gapSizes.length;
            gapSizes[gap]++;
            ++spreadIndex;
        }
        // The perpendicular edge owns exactly the atlas face plus its three
        // off-map exit columns. Any optional pause at the end of the slope
        // lengthens row 0/H-1 into the XL 7-8-cell flat wall. Move all such
        // flats to the broad side landing; a zero-pause terminal is also the
        // clean adjacency phrase (one continuous step run into the clip).
        gapSizes[0] += gapSizes[clusterCount];
        gapSizes[clusterCount] = 0;

        // Between descending runs the atlas requires v3 -> v0 -> v2,
        // with only v0/v2 able to start the next descent. A landing of
        // 1 mod 3 columns strands the grammar on v3. Move its spare flat
        // edge to the broad landing, preserving total width and elevation.
        for(var landing = 1; landing < clusterCount; ++landing) {
            if(gapSizes[landing] % 3 === 1) {
                --gapSizes[landing];
                ++gapSizes[0];
            }
        }

        var current = 0;
        function appendEdges(pCount, pChangesHeight) {
            for(var edgeIndex = 0; edgeIndex < pCount; ++edgeIndex) {
                if(pChangesHeight)
                    current += direction;
                offsets.push(current);
            }
        }
        appendEdges(gapSizes[0], false);
        for(var phraseIndex = 0; phraseIndex < clusterCount; ++phraseIndex) {
            appendEdges(clusterSizes[phraseIndex], true);
            appendEdges(gapSizes[phraseIndex + 1], false);
        }
        return offsets;
    }
};
