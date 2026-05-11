// MapGen v3 Intent skeleton — Phase 1, work item P1.2.
//
// Per OpenFodder_Map_Generator_Rewrite_Design_v3.4.md §3.6 (Grammar/Integration
// boundaries) and §3.5 (AuthorResult), this folder hosts the multi-plane
// IntentMap, the Concept registry, the AuthorResult type, and the two MP
// foundation primitives required by v3.4 threshold T15.
//
// Coexistence: this folder is loadable but is NOT yet wired into any v1 call
// site. v1 (Layout/Features/Decor/Validate/Repair/Connectivity/...) continues
// to own map generation. The strip commit P1.4 will:
//   - delete the v1 JS folders on the rewrite branch, AND
//   - register `Intent/` in Source/ScriptingEngine.cpp:229-243 alongside the
//     surviving folders so the Duktape loader picks it up.
//
// All public symbols hang off MapGen.Intent.* and are pure JS (Duktape ES5):
// no class, no let/const, no arrow functions, no template strings, no
// destructuring.

var MapGen = MapGen || {};
MapGen.Intent = MapGen.Intent || {};

// Sub-namespaces are populated by the sibling files in this folder.
MapGen.Intent.Map = MapGen.Intent.Map || {};
MapGen.Intent.Registry = MapGen.Intent.Registry || {};
