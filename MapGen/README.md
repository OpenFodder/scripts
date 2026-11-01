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
encounters even when exact building footprints move.
`Layout/MissionLayout.js` selects compound assaults, linked camps, exploration
or crossing missions for generic campaigns. It supplies building targets,
internal spacing and minimum span to both the planner and live validator.
When an authored route anchor cannot host a building, a bounded fitting pass
uses the existing footprint and approach search to move the district onto
usable land. Compact compounds retain viable original centres. Both proposed
and fitted points are included in diagnostic metadata.
Compounds require at least half their structures near the objective; other
missions must occupy multiple intended districts. Named profiles retain their
existing distribution rules. Building footprints, dry aprons, route access,
required counts, encounter connectivity and tactical cover remain validated.
Regional graphs use branches, chains, hubs or circuits to suit this mission.
Visual compositions favour distributed objectives, with occasional compounds.
The gaps between their camps scale with map size. Regional ice cliffs select a
crossing mission so objectives can use both terraces. Legacy opt-outs retain
their previous mission selection and spacing. The planned and live validators
share the same hard spacing and map-span requirements.
`Layout/Settlements.js` gives each district a forecourt, lane or stepped set of
building lots. Later lots follow the first building's actual position, so a
terrain-driven adjustment moves the local arrangement with it. Scene profiles
offer four quarter-turns of that arrangement when choosing the first secondary
building. Its committed lot records the selected turn, which later lots retain;
backtracking derives the alternatives again from the remaining sites. The same
site search ranks these options with the full district-distance penalty and a small
preference for the planned orientation when alternatives are near ties. Fitted
primary sites remain anchored even without a named landmark. Exact site
geometry and doorway access still decide what fits. All visual mission buildings
use the same 12–20 tile minimum between footprints, scaled by the short map side.
Camp membership, compound clearings and fallback metadata cannot reduce it.
Lot offsets and candidate scores also honor the mission's preferred separation.
`StructurePairSpacing` is shared by site search and both placement validators;
explicitly authored legacy layouts retain their earlier spacing contracts.
`Layout/BuildingTerrain.js` scores surviving scenery within a 20-by-15 tile view
centred on the building. Forest rewards exclude the final rounded clearing and
forecourt; ice requires a stand with a 5-by-5 interior and includes its supported fringe,
then excludes support lost beside that clearing. Each search subtracts existing sites and
approaches from its forest prediction. Removing canopy visible from a neighbouring
building also reduces the new site's score. Cliff scenery uses the planned tile overlay,
while the wider protection mask still controls legal placement. Distant terrain
and invisible padding cannot earn scenic credit. Beach scenery uses the water and authored sand layers and must extend across
the middle of at least one screen axis; tiny corner slivers and inland bank
reservations receive no bonus. Other biomes retain their shoreline context. Base summed-area
tables are shared, with forest exclusions rebuilt once per occupied-site search.
Exact clearing intersections are cached on that search geometry and discarded
after planning. A bridge in front of the south-facing
doorway receives an approach bonus; a bridge behind it does not. Shelters prefer
the site's surviving wooded side, still limited to one safe patch per building.
Named/legacy layouts keep their scores.
`Layout/Landmarks.js` samples existing crossings, cliff passes/feet, headlands,
shore shelves and woodland entrances before mission targets are fitted and lots
are arranged. Up to two targets may prefer a nearby landmark; every candidate
still passes the normal dry-footprint, spacing and reachable-door search. Primary
lots stay anchored to that setting instead of being shifted when the camp is
centred. Crossing candidates follow both ends of horizontal and vertical bridges.
Primary lots retain a landmark label only while close to the original setting;
bridge and cliff features must also remain within ten tiles on each axis. Metadata
records candidate kinds and the setting attached to each actual placement.
Coarse landmark hints earn their bonus and label only when the exact building
view retains the corresponding woodland, water, cliff artwork or bridge approach.
District fitting and final site selection use this same check, so an invisible
feature cannot override the surviving-terrain score. Shore landmark credit scales
with visible water instead of awarding the full bonus at its minimum threshold.
Visual river/island landscapes use water-first planning so their crossings exist
when sites are chosen. Authored maze/cliff ordering and legacy opt-outs remain intact.
Building totals come from campaign requirements and civilian objectives. Keep
that budget fixed when improving appearance: use terrain, approaches and the
placement of existing buildings. Do not fill quiet space with extra decorative
housing or relax spacing to fit it; that produced crowded, repetitive clusters.
`Layout/SettlementTerrain.js` reserves front yards and clear connecting lanes,
then authors bounded rear or side groves to frame individual buildings where space permits.
Visual ice sites rank at most 54 nearby shelter positions by visible canopy,
existing woodland and the preferred sheltered side. Three compact original-map
outlines use deterministic flips and one extra cell of source depth; a compact
7x7 grove remains available where an outline cannot fit. Visibility scores count
occupied mask cells, and equal fits use seeded tie-breaking. Each building receives at most
one complete patch within the existing 51-cell maximum; no spacing or route
exclusion is relaxed to make it fit.
Water, cliffs, crossings, occupied footprints, protected routes and spawn areas
are excluded before complete patches are committed. Existing biome smoothing
owns the resulting boundaries. Ice lanes remain cleared snow; no unsupported
road textures are stamped. Shelter patches are rechecked atomically against
current terrain and restored after cover generation. Active sub0 compositions mix soldier huts with
barracks without changing the required building count. Civilian huts remain
excluded from enemy-building validation; beach sub1 retains its supported art.
`Layout/SettlementDetails.js` fits ice barracks with wooden courts or open front
yards using fence corners, rails and caps verified in original Amiga maps
11, 15 and 16. The bounded site search prefers a complete plot where it fits,
with at most one fence landmark. Every fence encloses its building; a site that
cannot fit the complete compound stays open. Its footprint and dry fitting margin
are reserved before terrain and actors, and approach searches
avoid earlier fences. Open gates contain no solid gate artwork. Complete stamps
commit atomically before enemy/pickup placement and survive the final render.
Maze and named/legacy layouts retain their existing topology. Diagnostics
include camps, lots, yards, lanes, shelter and committed settlement details.
`Tests/MapGenSettlementSceneContracts.js` guards the building budget, committed
tiles/sprites, unsupported beach art, surviving scenery, viewport limits, cliff
art, shelter source budgets and mask stamping, and atomic rejection when water
or routes reach a saved shelter.
Ice detours follow mission progression instead of mandatory north/south rows.
Beach missions keep the supported east/south shoreline families.
Regional forest fields distinguish independent groves, winding belts, clustered
woodlands, branching stands and clearings around regional sites.
`Layout/ForestGeography.js` supplies their sizes, spacing and curved boundaries
independently of the route partition. Grove dimensions use tiles rather than
fractions of each map axis, so wide maps do not stretch every grove. Seeded
arrangements mix scattered, clustered and widely separated woodland bodies.
The normalized field retains influence beside soft route-edge penalties; hard
route, footprint and water exclusions remain authoritative. Each field
has a common 0–1 score range and bounded geometry: at most seven bodies or ten
tapered branch segments. Trigonometric offsets are computed per row/column
before evaluating cells. Branch widths use the short map dimension, with
asymmetric bends and tips; route and building cuts still take precedence.
The old per-district grove
parameters and duplicate regional field formulas have been removed.
`PreserveForestOpenSpace` keeps their open areas through generic perimeter and
open-field filler passes; route, encounter, and validation cover still apply.
Regional ice materializes its already allocated forest mask instead of thinning
it through a second patch allocation.

`Layout/SceneForests.js` keeps two forest construction methods. Groves use a compact
library of original shape masks at several local scales; open woods limit their
stand count, while broken woods favour smaller groups. Heartlands, branches,
wooded banks and forests around clearings preserve continuous geographic fields.
Their budgets rank dry land before carving gameplay reservations, so constrained
maps cannot spend the whole budget filling the same leftover perimeter. Biome
renderers still fit all canopy and trunk art; no finished tree tiles are stamped.
Up to three dry route-side rooms are planned before woodland allocation, favouring
terrain approaches. Regional ice supplies its actual transit paths to this step.
Woodland shoulders between those rooms redistribute the existing tree budget;
they do not raise coverage or scatter more props. Seeded outer boundaries mix
close woodland edges with broad recesses, instead of a similar grass frame on
all four sides. Jungle keeps one source fitting cell; ice retains three for its
canopy renderer. Boundary placement still respects routes and terrain.
The same rooms anchor late material patches. Coverage repair follows the fitted
mask instead of refilling its deliberate gaps. Explicit forest-shape/body-count
overrides and multiplayer retain their existing generation paths.

`Layout/RouteScenes.js` plans both enclosure and pauses before building lots and
forest allocation. Shoulders use a separate fit test from complete dry clearings,
avoiding the old requirement to fit a full clearing and then stay twenty tiles
from every district. At most 512 candidates and three scenes of each kind are
considered; route floors and terrain exclusions remain authoritative. Saved-tile
reviews distinguish planned shoulders from those retaining visible tree cover.
`Layout/SceneClearings.js` keeps the required rounded apron intact and adds a
narrower, seed-varied entrance lobe for unfenced sites. Its offset and depth leave
more woodland beside the doorway. Fenced sites keep their fitted clearing.
Site scoring and final carving use the same union of shapes and scanlines.
Floors, dry buffers, hard terrain, shore margins and occupied cells retain their
protection; cuts update the cached forest budget.

`Tools/Build/BuildForestSilhouettes.py` reproduces the runtime library from shipped
Amiga maps. `Tests/MapGenSceneForestContracts.js` checks deterministic masks,
protected cells, biome selection, coverage accounting and local lake hierarchy in
the native host. Regional basin districts favour unequal dominant/satellite lakes;
legacy geography calls retain their existing random sequence.

`VisualCompositions.js` varies terrain proportions as well as geometry for generic
campaign profiles: dense forest around clearings, sparse woods, a forested bank,
broken woods, branching woodland, an interior forest heartland, broad coastal
shelves and cliff terrain. Heartland uses one substantial inland body, while
branching woodland creates open bays between tapered limbs. Both are available
in jungle, beach and ice, with biome-specific cover and water budgets.
Ice also retains an authored
forest maze. Jungle cliff country is paired with inland terrain. Named profiles,
multiplayer and explicitly forced ice styles keep their existing selection.
`VisualComposition:false` opts out; explicit caller values and resolved ranges
remain authoritative through late mission tuning. Metadata records the selected
composition separately from the mission and landscape.

Styles also select a compatible jungle landscape and a separate water RNG stream.
Changing the style can therefore change river courses, lake geometry and coasts
even with the same requested seed. Ice chooses lakes, chains, crescents, elongated
basins, meanders, tributaries or inlets. Channel widths vary along their courses;
inlet shores bend around objective ground before hard reservations are cut, keeping
those headlands attached to the mainland. Lake budgets retain each body's own
coverage limit. Beach coast depth, orientation and shelf progression vary by style
and seed, with monotone shore advances respecting the east/south-only beach art.
Explicit landscape lists, ice terrain modes and water overrides remain authoritative.
Metadata exposes `waterComposition` separately from the actual regional water plan.

`Tools/Verify/CompareMapGenWater.py <saved-map-directory> --before <baseline-directory>
--output-directory <report-directory>` reads executable-saved tiles and compares
water masks independently of trees. Its normalized-mask IoU and contact sheets
expose repeated water layouts; they do not measure aesthetic quality. The native
visual-composition, scene-forest and settlement-scene contracts check the geometry,
legacy opt-outs, protected routes, budgets and directional building settings.

Default jungle landscape selection balances dry inland/forest terrain with wet
landscapes. Forest labyrinths use a dry mainland; lakes and rivers retain their
own explicit choices. `ProfileCompositions.ForProfile` returns fresh weighted
entries, preserving shared definitions, legacy opt-outs, named profiles and
multiplayer. Explicit landscape lists still take precedence.

Ice compositions own both forest and water budgets. Sparse regional layouts skip
generic late forest screens, which otherwise fill their deliberately open ground.
Late tuning also clears the previous style's cached absolute tree minimum before
validation derives the new composition's floor. This prevents valid sparse maps
from retrying into a denser style; explicit caller limits still take precedence.

Regional ice cliffs can rise, fall or form ridges and valleys, with a flat stair
landing and dry aprons along every column. Settlement regions reserve the full
elevation range before water and buildings are planned. `Intent/CliffCourse.js`
shares the existing atlas-safe slope phrases with corner terraces; it preserves
their required body strips between step runs. Short maps retain a fitting flat
course. Native contracts check 200 courses against real strip adjacency and
complete stairs, and the composition regression replays all five cliff shapes.

Jungle/beach surface treatments use sparse clusters of complete shared-base
shrub and brush stamps, with meadow, scrub and mixed palettes. Every subtile in
the small whitelist is dry and walkable according to the original HIT/BHT data.
`Terrain/SurfaceDetail.js` runs once after final structure/terrain flushes and
before live validation, replacing only plain grass outside routes, reservations,
water, beaches, structures and other occupied terrain. It cannot introduce new
blocked terrain. `Tests/MapGenVisualCompositionContracts.js` checks replay,
overrides and exclusions; `Tools/Verify/TestMapGenSurfaceDetail.py` checks the
whitelist against authored stamps and the original terrain semantics.
The same final pass adds sparse rock fields to plain ice snow (`0|1`). Its six
complete rock stamps have snow-backed borders and dry, walkable HIT/BHT data.
Rocks have a one-cell snow gap, a four-percent hard coverage cap, and the same
route, owner, structure and shore protections. Active compositions request only
0.1–0.3% extra jungle detail and 0.2–0.5% ice detail, favouring terrain/building
edges. These budgets follow the original maps' sparse ground marks. Jungle's
grass smoother excludes tuft halves 28/29 from both random selection and edge
matching; complete pairs belong to the detail pass. Ice patches, pits and solid
boulders are excluded from this snow palette. Named ice styles and explicit
surface-detail opt-outs retain their previous small-decoration budget.

`Terrain/GrassRegions.js` fits coherent light/dark grass materials on final dry
jungle and beach ground. Rotated, stretched fields vary at two spatial scales;
a seed-selected fraction of eligible ground sets their threshold, retaining
contrast even when a small map samples a quiet part of the field. A work queue
removes atlas-incompatible narrow tips in linear work; regions under 24 cells
are discarded. The original light/dark transition rules fit the remaining
silhouettes. Materials can continue to map edges and across walkable approaches,
without editing navigation, water, structures, props or terrain ownership.
Mobile actors and pickups do not create artificial dark holes. A dark grass join
remains beside other artwork. Plain reserved dark-grass floors can meet the
material transition directly, avoiding a second rectangular buffer. Floors
remain unpainted; real foundation art, fences and dry reservations keep their
fitting margins. Small surface-detail stamps stay on dark grass.
Scene profiles bypass the brightness-based grass smoother, which used transition
tiles as random variants. Explicit natural-ground opt-outs retain that renderer.
No original terrain layout is copied by this material field.

`Terrain/GroundScenes.js` commits these grass regions, or fits bounded complete
dry ice patches after terrain flushes and before live validation. Ice patches
have asymmetric outlines; their actual ice core has a bounded aspect ratio and
each cached shape is placed at most once. Native edge hints let adjacent boundary
cells carry a shared ice band. An extra inner snow margin keeps the complete
painted border snow-backed. Planned route rooms and edges provide anchors;
additional patches fit near existing water with a twelve-tile search limit.
Cached rectangle sums locate legal space; distance bounds narrow each row.
Ice stays outside navigation clearance. Native edge fitting owns its artwork,
with a complete rectangular fallback when an irregular silhouette cannot fit.
Patch count and area budgets remain bounded. No beach-facing art is invented.
Metadata records committed material regions and ice patches.

`Tests/MapGenGrassRegionContracts.js` covers replay, varied fields, linear repair,
map boundaries, preserved gameplay and artwork, and actor-independent materials.
`Tests/MapGenGroundSceneContracts.js` checks native ice fitting, replay and
protected terrain. `Tools/Verify/TestMapGenGroundScenes.py --grass-report <path>`
can verify both reports against original HIT/BHT semantics and snow-backed ice
borders. `Tests/MapGenGroundSearchContracts.js` compares the bounded search with
an exhaustive scan, including blocked maps, fractional anchors, score limits
and spacing. Ground decor is omitted when final terrain cannot support it;
airborne birds retain their separate placement policy.

`Grammar/Birds.js` gives ambient birds a separate, seed-stable budget: 40% of
maps have none, 50% have one, and 10% request two (small maps cap at one).
The left/right birds (66/67) are allowed only on the original jungle sub0/sub1,
ice sub0 and desert sub0 atlases; type 19 and unverified tilesets are excluded.
Birds replace generic-decor bird samples without changing the mission RNG.
They start at least 20 tiles apart and fly above terrain; their engine handlers
recycle them around the camera, so larger maps do not receive larger flocks.
PNG previews include a flight frame from the matching army sheet.

Regional coasts use their own ocean coverage limit instead of the inland swamp
cap. Flat cliff planning now scores the same complete footprint that its tile
stamper accepts. Tree coverage excludes water marked blocked by live collision.

Generic ice maze and neck concepts can author vertical routes on maps with room
for complete gates. `Intent/IceForestAxis.js` transposes semantic intent before
tile selection, including claims, ownership and gate validation coordinates.
Explicitly named profiles retain their authored orientation and approach.

Ordinary regional layouts mix irregular, overlapping districts with complete
partitions; mazes and cliff reservations retain disjoint partitions. Full-edge
beaches use districts to reserve the local coastal footprint before sites.
`Layout/WaterGeography.js` supplies shared continuous fields for scattered lakes,
long basins, lake chains and crescents. Lake districts vary from one dominant
basin to several separately positioned, rotated and bent bodies. Compact maps
limit their count; larger maps can distribute four or six lakes. These districts
use independent body centres rather than the shared centre of the other basin
forms. Jungle varies water quantity by landform
and the strength of channels between islands. Ice budgets water by landscape,
from dry woodland to broad lakes/inlets, before explicit runtime overrides.
Shore-heavy ice leaves extra forest headroom for contour and route pruning.
Secondary-route recovery can search dry sectors within the missing progression
phase when perpendicular probes are blocked by water. Building distribution
recovery filters for unused encounter regions before ranking alternatives.

Generic beaches choose partial corner shores or full-edge shelves/deeper coasts.
All remain east/south-facing monotone contours, capped around reserved anchors.
Both partial and full-edge shores use seeded monotone profiles: steady slopes,
long shelves, concentrated bends and stepped stretches. Depth varies separately,
retaining shallow strips as well as broad bays. Site planning and painting use
the same profile; final contour steps stay within the supported tile joins.
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
| `Layout/MissionLayout.js` | Shared mission targets, spacing and distribution validation |
| `Layout/WaterGeography.js` | Seeded continuous basin geometry shared by jungle and ice |
| `Layout/ForestGeography.js` | Independent woodland bodies, clearings and normalized forest fields |
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
Tree-growth capacity and repair exclude outcrops and stronger owner claims,
matching the measured tree count. Drying water does not make a retained water
or beach claim count as newly planted forest.

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

Ice tail cleanup checks the original two-tile canopy/trunk stack rules before
removing a lower side column. Valid left/right contours must survive each pass;
otherwise a rounded grove is repeatedly shaved into a narrow stem. Detached
one- and two-cell tabs still use the existing cleanup rules, and route clearance
remains authoritative. `Tests/MapGenIceCanopyContracts.js` exercises repeated
cleanup, both side stacks, unsupported tabs and later route cuts in the native
executable.

The ice shadow finisher fills gaps beside a canopy, but does not extend tile 44
beyond a diagonal step: its shaded west edge cannot join the plain-snow east
edge of the existing side tile. Native canopy contracts cover this corner and
preserve continuous side/base shading without suppressing visual-audit warnings.

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
`JungleInteriorWaterJoins.js` reconciles procedural inland sub1 bank tiles against
all four finished neighbours. A water-centred tile can contain a complete bank;
its dry neighbour then needs plain grass, rather than a duplicate pointed shore.
The pass retains semantic terrain classes and skips protected cells, with at most
four sweeps over 512 cells. Legacy and authored rendering paths are unchanged.
`Tests/MapGenLandmarkPacingContracts.js` covers this duplicate-bank regression,
landmark preferences, route exclusions, work limits and clearing accounting in
both native runtimes. `Tools/Analysis/ReviewMapVisualGroups.py` produces close-ups
for recurring audit groups, preferring samples from different maps. Review decisions
remain separate from audit severity; a reviewed sample does not whitelist all joins.
`Tests/MapGenPolishContracts.js` covers viewport bounds, tree-growth capacity,
post-protection repair ordering and live bounded building search in full acceptance.
