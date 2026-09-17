# Gameplay planning and terrain reservations

Campaign maps resolve exact building footprints and entrance approaches before
cover and the first render. Materialization stamps those planned buildings
directly. Seed layouts change with this planner; a fixed seed and fixed inputs
remain deterministic on both supported JavaScript runtimes.

`grammar_beach` selects only sandy east/south coasts. The former inland sub1
bridge channel is available as `grammar_river_crossing`, separate from the
existing sub0 `grammar_jungle_river_crossing` composition. The explicit Beach
selection stays coastal; general Jungle/Random selection includes both rivers.
Final campaign validation counts actual sand and sand/water transition tiles,
plus water reaching the map edge. A beach needs at least one short map side's
worth of sand tiles (minimum 16), eight shoreline tiles and four edge-water
cells. Quicksand and unrendered terrain intentions cannot satisfy this check.
`Tests/MapGenBeachIdentityContracts.js` covers the distinction and rejection cases.
Coastal water records explicitly disable crossing requirements, so generic river
repair cannot paint a ford into the sea. Building searches check the complete
dry apron and buffer against the original water/coast mask before reserving land.
`Tests/MapGenShoreContracts.js` exercises both rules and preserves real river bridges.

## Ordering

- Open layouts establish the gameplay corridor and building sites before optional
  rivers and cover. The base landmass and coastline remain macro constraints.
- Maze layouts establish their corridor topology first. Building approaches join
  that network through their reserved apron.
- River/island layouts establish water and crossings before choosing building sites.
- Cliff layouts establish elevations and passes before choosing building sites.
- Ice concepts author macro terrain and route topology, then share the same exact
  building planner before cover generation.
- Multiplayer shares route and spawn protection; its existing match planner owns
  team objects. Campaign building requirements do not leak into multiplayer.

Regional ice reserves settlement space and any cliff before shaping water.
`Intent/RegionalTerrain.js` fits transit with the native pathfinder, preferring
dry routes and allowing only short water crossings. Cliff regions use the
existing stair and cliff tiles, with dry shore aprons; narrow maps retain their
water/forest layouts. Generic tiny ice maps choose a fitting style before runtime
tuning, while explicitly forced styles keep their authored selection.

Regional circuits separate arrival and objective across the loop. Regional
structure markers reserve approaches before cover because they still host
encounters even when exact building footprints move. Beach settlement scoring
lives in `Layout/RegionIntents.js` and distinguishes compounds, paired camps,
and dispersed sites while keeping the supported east/south shoreline families.
Regional forest fields distinguish individual groves, one to three winding
belts, a single heartwood mass, and a broad clearing enclosed by rim forest.
The latter three use map-scale geometry independent of the route partition.
`PreserveForestOpenSpace` keeps their open areas through generic perimeter and
open-field filler passes; route, encounter, and validation cover still apply.
Regional ice materializes its already allocated forest mask instead of thinning
it through a second patch allocation.

Ordinary regional layouts mix irregular, overlapping districts with complete
partitions; mazes and cliff reservations retain disjoint partitions. Full-edge
beaches use districts to reserve the local coastal footprint before sites.
`Layout/WaterGeography.js` supplies shared continuous fields for scattered lakes,
long basins, lake chains and crescents. Jungle varies water quantity by landform
and the strength of channels between islands. Ice budgets water by landscape,
from dry woodland to broad lakes/inlets, before explicit runtime overrides.
Shore-heavy ice leaves extra forest headroom for contour and route pruning.
Secondary-route recovery can search dry sectors within the missing progression
phase when perpendicular probes are blocked by water. Building distribution
recovery filters for unused encounter regions before ranking alternatives.

Generic beaches choose partial corner shores or full-edge shelves/deeper coasts.
All remain east/south-facing monotone contours, capped around reserved anchors.
Full-edge shores grow across their entire length using seeded depth curves.
Settlement planning reserves that local depth before placing regional points,
so a deep coast is not flattened by an anchor placed in its intended footprint.
Regional beach endpoints and support remain on the regional graph; the beach
hook no longer replaces them with the legacy six-layout endpoint matrix.
The generic water ceiling is 36%, with caller overrides preserved. Beach forest
allocation uses the composition's whole-map cover target, avoiding low-cover
retries when water takes more space. Regional sand bands stay at least four
cells wide to retain visible sand after fitting grass and water transitions.
Regional beaches choose forest amount independently of the mission recipe;
the source-family forest floors remain for authored profiles. Tactical cover
and live placement validation still apply to every regional composition.
Routed structure markers retain the fast placement search, then check off-axis
cells within the same bounded neighbourhood if that search misses a legal pocket.
Ice crossing overlays preserve fitted shoreline transitions instead of replacing
them with plain ford snow.

Composed beaches cap their coastline depth around planned anchors before water
is painted, preserving the atlas's monotone shoreline and one-cell steps. Late
point clearance alone cannot recover access to a spawn surrounded by water.
Jungle water-budget repair prioritizes recorded channel cores, then removes
bridges left on truncated channels before refreshing derived layers. Removed
bridges retain their dry route but lose their crossing record. Ground polish
respects crossing cells and tree/cliff ownership as well as blocking flags.
The bridge overlay restores its deck's walkable characters and semantic layers
along with its artwork. A partial placement connection repair can make one
final search after smoothing, using rendered walkability and the unused portion
of its original 12-cell budget.

## Modules

| Module under `Run/Scripts/MapGen` | Responsibility |
| --- | --- |
| `Layout/GameplayPlan.js` | Ordering policy and building/approach reservations |
| `Layout/WaterGeography.js` | Seeded continuous basin geometry shared by jungle and ice |
| `Layout/BuildingSites.js` | Footprint checks, distribution scoring, shared route search |
| `Layout/RouteSiteSearch.js` | Bounded dense fallback when the fast route-side site search fails |
| `Layout/PlacementRepair.js` | Bounded forest connectors for disconnected placement pockets |
| `Layout/Reservations.js` | Authoritative clear space, footprints, routes, buffers, flexible margins |
| `Layout/TerrainSpace.js` | Budget for optional cover outside authored forest |
| `Layout/Preflight.js` | Reject unresolved site, route, and distribution failures before rendering |
| `Integration/BuildingRequirements.js` | Campaign building counts, independent of the live session |
| `Integration/PlannedStructures.js` | Commit exact plans without another search or terrain render |
| `Integration/Structures.js` | Shared building geometry, reservations and live placement records |
| `Integration/StructureContext.js` | Terrain classifications, footprint queries and cover measurements |
| `Integration/StructureAccess.js` | Door approaches and objective-site terrain preparation |
| `Integration/StructureTiles.js` | Building tile painting, sprite validation and ice aprons |
| `Integration/StructureSearch.js` | Clearing search for objective contexts without a planned home |
| `Integration/ReachableActors.js` | Place ground actors at reachable runtime positions |
| `Intent/CampaignTopology.js` | Secondary routes and geographic distribution |
| `Intent/TerrainDetail.js` | Cover materialization and rendered-cover ceiling repair |
| `Terrain/RouteCoverRepair.js` | Bounded cover patches beside exposed tactical routes |

The reservation mask survives replacement of derived terrain layers. Terrain and
smoothing reapply it while preserving water crossings and cliff geometry. Building
geometry comes from the requested biome, not the previous live map. Door approaches
start at the actual sprite-aligned entrance; a small local perimeter search joins
the shared route field without crossing the footprint.

Civilian delivery huts use the same building plan. Hostage actors and rescue tents
continue to use objective-site placement and final escort validation.

Campaign building placement requires `GameplayPlan`. Nonempty requests without
a matching valid plan fail before stamping. Custom scripts should generate through
`GenerateCampaignMap` or run the gameplay planner before materialization; the old
whole-map campaign building search is retired. Civilian delivery's separate
objective fallback remains available for contexts without a planned home.

The unused Phase 1 intent diagnostic, superseded mapm5/mapm8 terrain builders,
old enemy placement chain and their orphan helpers have been removed. Jungle,
beach, multiplayer and the ice rollback flag still use supported v1 paths.

The final engine collision, reachability, structure, objective, and drift checks
remain authoritative. Terrain budgets do not raise their thresholds. Cover repair
enforces its ceiling after derived-layer smoothing, which otherwise could regrow
the cells just removed. Route-cover scoring uses a local accumulation grid with
the same scores as the previous per-tree scan.

## Verification

Run through the real executable:

```powershell
Tools/Verify/MapGenAcceptance.ps1 -Full -OutputDir MapDumps/LayoutPlanning/final
Tools/Verify/MapGenRuntime.ps1 -OutputDir MapDumps/LayoutPlanning/runtime
Tools/Pipeline/RegenerateRandomMap.ps1 -Seed 982341001 -Profile grammar_ice -MapSize normal -Script Tests/MapGenLayoutContracts.js -ScriptRuntime Interpreter -MapPath MapDumps/LayoutPlanning/layout-interpreter.map
```

The acceptance matrix includes campaign biomes/sizes, maze and river profiles,
escorts, multiplayer, repeatability, failed publication, and comparison of planned
and committed building positions. Metadata includes `gameplayPlan`, reservation
counts, cover-budget allocation, and per-attempt timings. Measure the sum of
`retry.attempts[].elapsedMs` separately from executable startup and artifact export.

## Seed benchmarks and local repairs

`Tools/Verify/MapGenBenchmark.ps1` runs a reproducible matrix through the real
executable. Defaults cover six profiles, four sizes and two fixed seeds (48 cases).
Use a fresh output directory for each run:

```powershell
Tools/Verify/MapGenBenchmark.ps1 -OutputDir MapDumps/benchmark-before
# After changing the generator, repeat exactly the same matrix:
Tools/Verify/MapGenBenchmark.ps1 -OutputDir MapDumps/benchmark-after -CompareDir MapDumps/benchmark-before
# Broaden seed coverage or narrow a profiling run:
Tools/Verify/MapGenBenchmark.ps1 -OutputDir MapDumps/jungle-seeds -Profiles grammar_jungle -Sizes normal,xl -Seeds 0,101,982341003,260908103,3156408432,4294967295
# Interleaved control runs disable just the new repair and early rejection:
Tools/Verify/MapGenBenchmark.ps1 -OutputDir MapDumps/paired -Profiles grammar_jungle -Sizes normal,large,xl -BaselineScript Tests/MapGenRepairBaseline.js
```

Each case preserves its map, sprites, metadata (or failure sidecar), and log.
`runs.json` checkpoints completed cases. The Python artifact reader produces
`benchmark.json` and `benchmark.md`, including acceptance, first-attempt success,
retry counts, p50/p95/maximum generation time, wall time, rejection causes and
measured stage self time. Rejected attempts count toward generation time. Missing
timings are excluded rather than recorded as zero; comparison requires matching
profile/size/seed cases. Add `-RequireSuccess` for a batch that must pass every case.
`-BaselineScript` alternates baseline/current execution order within each case to
reduce timing bias from machine load and warm caches. Results go into `baseline/`
and `current/`, with their comparison in `current/benchmark.md`.

Route-side site plans marked failed now reject immediately after connectivity;
later terrain generation cannot change that planning result. Exposure failures
can try one deterministic cover pass per campaign attempt. It fills small 2x2
patches (including gaps adjoining existing trees), bounded by 32 patches, 128 new
cells, 3% of map area, and remaining tree-coverage headroom. Both exposure fraction
and longest exposed run must meet the existing profile limits. The actual tactical
route retains a one-cell apron; building reservations, water, cliffs, outcrops,
occupied cells, authored cover budgets and ordinary cover exclusions still apply.

Incomplete repairs undo their layer changes before another render is attempted.
Cover-only repairs render and fully revalidate without rebuilding water or running
global terrain smoothing. Other repair types retain their derived-terrain refresh.
When both are needed, structural changes refresh and revalidate first; cover
uses the resulting route on the next pass within the same repair budget.
Final collision, connectivity, objective and drift validation remain mandatory;
this does not guarantee that every seed can be repaired. Per-attempt
`localRepairs` metadata records patch counts, exposure before/after, rollback or
stop reason, and the subsequent validation result when the repair runs alone.

`Tests/MapGenRepairContracts.js` checks protected geometry, work limits, rollback,
deterministic choices and final engine validation. It is included in the extended
acceptance suite and can also run with either native script runtime.

## Layout reliability

When greedy building placement fails, the planner rolls back its provisional
reservations and tries up to three choices per building, with a total limit of
32 candidate searches. If those fail, a second tier tries geographically distinct
sites with at most 32 additional searches. Successful first-tier plans stay intact.
Maze retries sample every tile to find spaces missed by
the normal three-tile grid. Rejected branches restore the reservation mask,
path layer and path list; terrain is applied only after selection finishes.
`gameplayPlan.search` records the search count, limit and whether it recovered the plan.

Disconnected non-maze placement pockets can receive one forest-connection pass.
A bounded 0/1 search costs existing ground at zero and removable forest at one,
with no more than 12 forest cells removed across the attempt. Future building
footprints, occupied obstacles, water and hard terrain cannot be cut through.
Maze walls retain their topology. The resulting route reservations survive
smoothing, and the complete map is rendered and validated again.

Ground actors are checked at their actual pixel coordinates before spawning.
Isolated placements search within eight tiles, with at most 64 engine reachability
probes; unsuccessful searches reject the attempt. `actorRelocations` records how
many actors moved. Encounter-region reachability likewise uses an actor or
pickup's recorded runtime position, rather than testing a different sub-tile
position at the tile origin. Building representatives retain their door approaches.

Map-use preflight uses exact planned building footprints once available; obsolete
clearing centres cannot stand in for buildings planned elsewhere. The final check
continues to measure actual live placements. Pickup shape repair now handles
two-pickup span failures and sector-only failures as well as larger linear sets.

`Tests/MapGenReliabilityContracts.js` covers connector limits and protected
geometry, pickup span/sectors, planned map-use metrics, live actor reachability and
sub-tile region positions. The extended acceptance suite permanently includes the
six formerly failing maze, river-crossing and forest-corridor cases.

## Runtime target data and smoothing modules

`Tools/Build/BuildMapGenTargetPackRuntime.py` projects exact tile grammar into
the fields consumed by materialization: motif identities, window sizes, counts,
and cell/count distributions. It preserves all feature, route-phase and transition
entries and their input order. Detailed tile examples remain in
`Documentation/RandomMapGenerator_TargetPack.json`. Run
`python Tools/Verify/ValidateMapGenTargetPack.py` after regenerating to check all
profiles and ensure unrelated targets and the authoring source are preserved.

Beach smoothing is divided into the core edge selector, contours, grass rules,
grass repair, seam repair and authored templates (`JungleGrammarBeach*.js`). Ice
character terrain is divided into shared classifiers/aprons, tree edges, pruning,
topology, fragments and shoreline rules (`IceCharTerrain*.js`). These modules
extend the same biome objects; the native smoothing-folder loader loads them all
before generation. Module extraction preserves the existing function bodies.

When ordinary route-side placement on the initial attempt leaves exactly one
missing site, a dense search checks previously missed route indices and distances.
Later retries and plans missing several sites reject early. Each search is
limited to 4,096 candidate checks and
32 reachability probes, with a maximum search radius of 32 tiles or the profile's
smaller limit. Footprint, water, spacing and reachability checks remain mandatory.
The selected site records its actual route fraction; the usual route-distribution
and final live validators still decide acceptance. `routeSitePlan.denseSearch`
records calls, candidate checks, path probes and recovered sites. The fallback
does not consume RNG draws or modify terrain while searching.

Tree-growth repair rounds fractional minimum coverage up to the next whole cell.
`Tests/MapGenPlanningSearchContracts.js` checks this boundary plus dense-search
work limits, protected geometry, deterministic selection and final live validation.
It is included in the full/extended acceptance suites and supports both runtimes.
Use `Tests/MapGenPlanningBaseline.js` with the benchmark's `-BaselineScript`
option to interleave equivalent runs with just dense site repair disabled.

## Outlier prevention and performance checks

Building requirements resolve supported structures against the profile's tileset
before site search. Beach bunker requests become supported barracks while retaining
the requested count. Building buffers preserve bridge flank water in layers,
charmaps and intent; site search rejects aprons/buffers that intersect that channel.
The final ground correction follows shoreline overlays so sparse building stamps
cannot leave water in their reserved footprint corners.

Route-cover repair shares already-grown cells between adjacent patches, counting
only their remaining cells against the existing budget. It retains the same route,
water, building and maze protection, render validation and incomplete-repair rollback.
Bulk walk-cost construction resolves layer columns and invariant maze policy once
per grid/column; the scalar cost function remains an independent contract oracle.
`Tests/MapGenOutlierContracts.js` covers these cases in both native runtimes and is
included in full acceptance.

`Tools/Verify/MapGenBenchmark.ps1` supports:

- `-ExtendedSeeds`: six seeds per profile/size, including unsigned seed boundaries
  and the established regression seeds (144 cases with default profiles/sizes).
- `-Repetitions 3`: repeat the same cases with distinct artifact names.
- `-CompareDir <baseline>`: flag acceptance regressions, increased attempts, and
  median/p95 slowdown beyond `-MaxSlowdownPercent` (default 25).
- `-MaxP95Ms 2000`: flag generation p95 over an absolute budget.
- `-FailOnRegression`: return failure after writing the diagnostic report.

Use fresh output directories and matched cases/repetitions for comparisons. Run
native generation sequentially because it shares runtime output and flags. Timing
checks include rejected attempts; missing measurements fail an enabled budget.
Repeated/interleaved comparisons help distinguish hot-loop improvements from host
load. `python Tools/Verify/TestMapGenBenchmark.py` tests the artifact-reader gate.

Camera pacing audits full 17-by-13-tile viewports, including each far edge once;
it does not count cropped border strips as playable screens. Viewport cover considers
both empty and quiet route windows. Route protection is revalidated inside the
bounded repair loop, so cover removed by protection can receive a repair pass.
Tree-only repairs skip global terrain refresh. Before rendering, attempts whose
legal growth sites cannot meet minimum tree coverage reject early; the final
attempt retains its normal rendering and diagnostics.

Beach rendering applies grass transitions before subvariant-specific shoreline
edges. Authored channel-bank overlays check current water positions, preserving
the smoothed boundary where building buffers have moved the channel.
`Tests/MapGenPolishContracts.js` covers viewport bounds, tree-growth capacity,
post-protection repair ordering and live bounded building search in full acceptance.
