"""Export Run/Scripts/Tools/TileGroups.json into generator-consumable JS snippets.

Reads the authored data and emits both *preview* files (for human review)
and *runtime* files that the game and dumper tools load directly:

  Documentation/Exported/Structures.<Biome>.<Variant>.js          (preview)
  Documentation/Exported/Terrain.<Biome>.<Variant>.js             (preview)
      Hand-merged into Run/Scripts/Common/{Structures,Terrain.js}.

  Run/Scripts/Common/Generated/Terrain.<Biome>.<SubKey>.js        (runtime)
      Attribute-assignment file consumed in-game and by dumpers. Loaded
      after Run/Scripts/Common/Terrain.js (and its hand-authored Sub0
      blocks), so groups present here overwrite any same-named manual
      entries while leaving manual-only fields (TreeEdges, Vegetation,
      DestroyedHuts, etc. that are not yet captured in TileGroups.json)
      intact.

Group emission rules (terrain/decor kinds):
  - If any stamp is multi-tile-row or multi-row, emit as a stamp array
    (rows-of-rows). Single-tile-only groups with no stampNames flatten
    to a tile-id palette (legacy shape consumed by older callers).
  - If any stampName is non-empty, emit as a variant map keyed by name:
    `{ ice: [...], snow: [...] }`. Variant lists carry stamps in the
    same shape rule as above (palette vs rows-of-rows).

Usage:
    python Tools/ExportTileGroups.py
"""

import json
import re
from pathlib import Path


def pascal_case(name):
    """Canonical group-name form: PascalCase, no separators."""
    if not name:
        return ""
    parts = re.split(r"[\s_\-/]+", name.strip())
    return "".join(p[:1].upper() + p[1:] for p in parts if p)

# This script and its TileGroups.json source live in the tracked Run/Scripts
# submodule (Run/Scripts/Tools/). REPO is resolved by walking up to the parent
# repo (the dir holding both Run/ and Tools/) so the Documentation/Exported
# preview output still lands in the parent repo, independent of this file's depth.
def _find_repo_root(start):
    for parent in start.resolve().parents:
        if (parent / "Run").is_dir() and (parent / "Tools").is_dir():
            return parent
    raise RuntimeError("Could not find repo root from %s" % start)

HERE = Path(__file__).resolve().parent
REPO = _find_repo_root(HERE)
SRC = HERE / "TileGroups.json"
OUT_DIR = REPO / "Documentation" / "Exported"
RUNTIME_DIR = REPO / "Run" / "Scripts" / "Common" / "Generated"

# Tile IDs <SUB_VARIANT_SPLIT[biome] are shared between the biome's
# sub-tilesets; >= split they diverge. Used to fold sub0 entries into
# sub1 outputs without requiring duplicate tagging.
SUB_VARIANT_SPLIT = {"Jungle": 240}


def stamp_to_triplets(stamp):
    """Convert rows-of-rows stamp to [[col, row, tileId], ...] triplets."""
    triplets = []
    for r, row in enumerate(stamp or []):
        for c, tid in enumerate(row or []):
            if isinstance(tid, int):
                triplets.append([c, r, tid])
    return triplets


def fmt_triplets(triplets, indent="            "):
    """Pretty-print [c,r,t] triplets — one per line, blanks between rows."""
    if not triplets:
        return ""
    lines = []
    prev_row = None
    for c, r, t in triplets:
        if prev_row is not None and r != prev_row:
            lines.append("")
        lines.append(f"{indent}[{c}, {r}, {t}],")
        prev_row = r
    if lines and lines[-1].endswith(","):
        lines[-1] = lines[-1][:-1]
    return "\n".join(lines)


def fmt_stamp_rows(stamp, indent="        "):
    """Pretty-print a rows-of-rows stamp as a JS array literal."""
    out = ["["]
    for row in stamp:
        cells = ", ".join("null" if x is None else str(x) for x in row)
        out.append(f"{indent}    [{cells}],")
    if out[-1].endswith(","):
        out[-1] = out[-1][:-1]
    out.append(f"{indent}]")
    return "\n".join(out)


def stamp_max_id(stamp):
    """Largest tile ID in a stamp, or -1 if none."""
    m = -1
    for row in stamp or []:
        for x in row or []:
            if isinstance(x, int) and x > m:
                m = x
    return m


def shared_band_group(group, split):
    """Return a copy of `group` keeping only stamps where every tile ID
    is < split (so the stamp's artwork is identical across sub-variants).
    Returns None if no stamps survive."""
    keep_idx = [i for i, s in enumerate(group.get("stamps", []))
                if 0 <= stamp_max_id(s) < split]
    if not keep_idx:
        return None
    out = dict(group)
    out["stamps"] = [group["stamps"][i] for i in keep_idx]
    for key in ("stampNames", "stampRoles", "stampDestroyed"):
        if isinstance(group.get(key), list):
            out[key] = [group[key][i] if i < len(group[key]) else None
                        for i in keep_idx]
    return out


def fold_shared_band(biome, sub0_groups, sub1_groups):
    """Add sub0 entries whose tile IDs all sit in the shared band into
    sub1, unless sub1 already defines a group with the same name."""
    split = SUB_VARIANT_SPLIT.get(biome)
    if split is None:
        return sub1_groups
    have = {g["name"].lower() for g in sub1_groups}
    folded = list(sub1_groups)
    for g in sub0_groups:
        if g["name"].lower() in have:
            continue
        shared = shared_band_group(g, split)
        if shared is not None:
            folded.append(shared)
    return folded


def keep_intact_stamps(group):
    """Return only the non-destroyed stamps — engine handles destruction."""
    stamps = group.get("stamps", [])
    destroyed = group.get("stampDestroyed", []) or []
    return [s for i, s in enumerate(stamps)
            if not (destroyed[i] if i < len(destroyed) else False)]


VARIANT_ROLES = ("start", "middle", "end", "single")


def collect_variants(group):
    """Group non-destroyed stamps by stampName, returning a dict:
       { variant_name: { role: [stamp, ...] } }
       Only stamps with both a non-empty name and a recognised role are
       included. Returns ({}, []) if the group has no variant tags at all,
       or (variants, orphans) where orphans is a list of (idx, reason)
       for stamps that look like they were meant to be variants but
       weren't tagged completely."""
    stamps = group.get("stamps", [])
    names = group.get("stampNames", []) or []
    roles = group.get("stampRoles", []) or []
    destroyed = group.get("stampDestroyed", []) or []
    variants = {}
    orphans = []
    has_any_tag = False
    for i, stamp in enumerate(stamps):
        if i < len(destroyed) and destroyed[i]:
            continue
        name = (names[i] if i < len(names) else "") or ""
        role = (roles[i] if i < len(roles) else "") or ""
        name = name.strip()
        role = role.strip().lower()
        if name or role:
            has_any_tag = True
        if not name or role not in VARIANT_ROLES:
            if name or role:
                orphans.append((i, f"name={name!r} role={role!r}"))
            continue
        variants.setdefault(name, {r: [] for r in VARIANT_ROLES})
        variants[name][role].append(stamp)
    if not has_any_tag:
        return {}, []
    return variants, orphans


def fmt_variant_role_stamps(stamps_for_role, indent="            "):
    """Emit array of stamps; each stamp is itself an array of triplets.

    Output shape (one stamp):  [[c, r, t], [c, r, t], ...]
    Output shape (n stamps):   [
                                  [...],
                                  [...]
                              ]
    """
    if len(stamps_for_role) == 1:
        triplets = stamp_to_triplets(stamps_for_role[0])
        cells = ", ".join(f"[{c}, {r}, {t}]" for c, r, t in triplets)
        return f"[{cells}]"
    parts = ["["]
    for k, stamp in enumerate(stamps_for_role):
        triplets = stamp_to_triplets(stamp)
        cells = ", ".join(f"[{c}, {r}, {t}]" for c, r, t in triplets)
        comma = "," if k < len(stamps_for_role) - 1 else ""
        parts.append(f"{indent}    [{cells}]{comma}")
    parts.append(f"{indent}]")
    return "\n".join(parts)


def emit_variants_block(biome, group, variants):
    name = pascal_case(group["name"])
    parts = [f"Structures.{biome}.{name} = {{"]
    parts.append(f"    StructFindTile: [")
    parts.append(f"        Terrain.{biome}.Mainland.concat(Terrain.{biome}.Borderland),")
    parts.append(f"    ],")
    parts.append("")
    parts.append(f"    Variants: {{")
    variant_names = list(variants.keys())
    for vi, vname in enumerate(variant_names):
        role_map = variants[vname]
        active = [r for r in VARIANT_ROLES if role_map[r]]
        parts.append(f"        {vname}: {{")
        for ri, role in enumerate(active):
            body = fmt_variant_role_stamps(role_map[role])
            comma = "," if ri < len(active) - 1 else ""
            parts.append(f"            {role.capitalize()}: {body}{comma}")
        comma = "," if vi < len(variant_names) - 1 else ""
        parts.append(f"        }}{comma}")
    parts.append(f"    }},")
    parts.append("};")
    return "\n".join(parts)


def emit_struct_block(biome, group):
    name = pascal_case(group["name"])
    keep = keep_intact_stamps(group)
    parts = [f"Structures.{biome}.{name} = {{"]
    parts.append(f"    StructFindTile: [")
    parts.append(f"        Terrain.{biome}.Mainland.concat(Terrain.{biome}.Borderland),")
    parts.append(f"    ],")
    parts.append("")
    parts.append(f"    Struct: [")
    for i, stamp in enumerate(keep):
        parts.append(f"        [")
        parts.append(fmt_triplets(stamp_to_triplets(stamp)))
        comma = "," if i < len(keep) - 1 else ""
        parts.append(f"        ]{comma}")
    parts.append(f"    ],")
    parts.append("};")
    return "\n".join(parts)


def emit_structure_block(biome, group):
    """Pick variant-aware emit when the group has variant tags, else
    fall back to flat Struct (current behaviour for Hut/Bunker/Barracks)."""
    variants, orphans = collect_variants(group)
    if variants:
        if orphans:
            print(f"  WARN {biome}/{group['name']}: skipping "
                  f"{len(orphans)} stamp(s) without name+role: "
                  f"{', '.join(f'#{i} {why}' for i, why in orphans)}")
        return emit_variants_block(biome, group, variants)
    return emit_struct_block(biome, group)


# --- Structures RUNTIME leg ---------------------------------------------------
# Unlike the structure PREVIEW (whole-object literal, for human review), the
# runtime block mirrors the terrain runtime leg: a PER-FIELD attribute
# assignment that overwrites ONLY the `Struct` tile geometry of an
# already-hand-authored Structures.<Biome>.<Name> object, leaving its
# hand-authored Types / SubVariantsAllowed / StructFindTile untouched.
#
# Hard constraints (see plan rosy-finding-hamming.md):
#   - Allow-list = {Hut, Bunker, Barracks} only. Cliff/Bridge/Helicopter and the
#     Ice WoodFence/WireFence/Building use richer or absent schemas and are NOT
#     emitted here.
#   - Emit from sub0 sets ONLY. The buildings are sub0 structures
#     (SubVariantsAllowed:['sub0'] on the Jungle variants); emitting from a sub1
#     set would, due to alphabetical Generated/ load order, clobber the single
#     shared Structures.<Biome>.<Name> object's sub0 geometry.
#   - The engine only ever stamps Struct[0] (Structures.js Place(...,0,...)),
#     so emit Struct as a single-element array holding exactly the first kept
#     stamp — discarding the vestigial Struct[1..n] the preview carries.
#   - Per-(biome,name) EXCLUSIONS for cases whose TileGroups.json geometry does
#     not match the canonical (C++ Barracks.cpp) core building.
STRUCT_RUNTIME_NAMES = {"Hut", "Bunker", "Barracks"}
# Jungle Barracks re-tagged 2026-05-30 to the frameless 12-tile core (the prior
# hand-authored Struct[0] baked in a decorative jungle frame the original engine
# never had); its hand-authored Types offsets were recalibrated to the core to
# match. No exclusions remain.
STRUCT_RUNTIME_EXCLUDE = set()


def emit_structure_runtime_block(biome, group):
    """Per-field `.Struct` override for an allow-listed building, or None if
    this group is not eligible for the runtime leg."""
    name = pascal_case(group["name"])
    if name not in STRUCT_RUNTIME_NAMES:
        return None
    if (biome, name) in STRUCT_RUNTIME_EXCLUDE:
        return None
    # Variant-tagged groups are not flat-Struct buildings — skip (defensive;
    # Hut/Bunker/Barracks have no variant tags).
    variants, _ = collect_variants(group)
    if variants:
        return None
    keep = keep_intact_stamps(group)
    if not keep:
        return None
    parts = [
        f"Structures.{biome} = Structures.{biome} || {{}};",
        f"Structures.{biome}.{name} = Structures.{biome}.{name} || {{}};",
        "",
        f"Structures.{biome}.{name}.Struct = [",
        f"    [",
        fmt_triplets(stamp_to_triplets(keep[0]), indent="        "),
        f"    ]",
        f"];",
    ]
    return "\n".join(parts)


def stamp_is_single_tile(stamp):
    """A stamp counts as single-tile when it has exactly one row of one
    non-null cell (e.g. `[[27]]`). `[[221, 222]]` and 2x2 corners are not."""
    rows = [r for r in (stamp or []) if r is not None]
    if len(rows) != 1:
        return False
    cells = [c for c in rows[0] if c is not None]
    return len(cells) == 1


def stamps_are_all_single_tile(stamps):
    return all(stamp_is_single_tile(s) for s in stamps)


def stamps_have_any_name(group):
    names = group.get("stampNames", []) or []
    for n in names:
        if n and n.strip():
            return True
    return False


def fmt_palette_list(stamps):
    """Flatten single-tile stamps into a tile-id list, preserving order."""
    ids = []
    for stamp in stamps:
        for row in stamp or []:
            for x in row or []:
                if isinstance(x, int) and x not in ids:
                    ids.append(x)
    return f"[{', '.join(map(str, ids))}]"


def fmt_stamp_rows_array(stamps, indent="    "):
    """Emit a JS array of rows-of-rows stamps."""
    parts = ["["]
    for i, s in enumerate(stamps):
        body = fmt_stamp_rows(s, indent=indent + "    ")
        comma = "," if i < len(stamps) - 1 else ""
        parts.append(f"{indent}    {body}{comma}")
    parts.append(f"{indent}]")
    return "\n".join(parts)


def emit_group_value(group, indent="    "):
    """Pick the right shape for a terrain/decor group:
       - variant map { name: [...] } when stampNames are tagged
       - flat palette [tile, tile] when every stamp is a single 1x1 tile
       - rows-of-rows stamp array otherwise
    """
    stamps = group.get("stamps", [])
    names = group.get("stampNames", []) or []

    if stamps_have_any_name(group):
        # Variant-keyed map. Stamps without a name fall under '_default'.
        buckets = {}
        order = []
        for i, stamp in enumerate(stamps):
            name = ((names[i] if i < len(names) else "") or "").strip()
            key = name or "_default"
            if key not in buckets:
                buckets[key] = []
                order.append(key)
            buckets[key].append(stamp)

        parts = ["{"]
        last = len(order) - 1
        for vi, key in enumerate(order):
            grp_stamps = buckets[key]
            if stamps_are_all_single_tile(grp_stamps):
                body = fmt_palette_list(grp_stamps)
            else:
                body = fmt_stamp_rows_array(grp_stamps, indent=indent + "    ")
            comma = "," if vi < last else ""
            parts.append(f"{indent}    {key}: {body}{comma}")
        parts.append(f"{indent}}}")
        return "\n".join(parts)

    if stamps_are_all_single_tile(stamps):
        return fmt_palette_list(stamps)

    return fmt_stamp_rows_array(stamps, indent=indent)


def emit_terrain_preview_block(biome, sub_key, terrain_groups):
    """Preview-style block: `Terrain.<Biome>.<SubKey> = { ... };`"""
    parts = [f"Terrain.{biome}.{sub_key} = {{"]
    last = len(terrain_groups) - 1
    for i, g in enumerate(terrain_groups):
        name = pascal_case(g["name"])
        body = emit_group_value(g, indent="    ")
        comma = "," if i < last else ""
        parts.append(f"    {name}: {body}{comma}")
    parts.append("};")
    return "\n".join(parts)


def emit_terrain_runtime_block(biome, sub_key, terrain_groups):
    """Runtime file: attribute-assignment style so manual fields in
    Run/Scripts/Common/Terrain.js (Vegetation, TreeEdges, ...) survive
    when the same Sub-block is partially captured in TileGroups.json.
    Every group in TileGroups.json overwrites the manual entry of the
    same name; manual-only fields are untouched."""
    parts = [
        f"Terrain.{biome} = Terrain.{biome} || {{}};",
        f"Terrain.{biome}.{sub_key} = Terrain.{biome}.{sub_key} || {{}};",
        ""
    ]
    for g in terrain_groups:
        name = pascal_case(g["name"])
        body = emit_group_value(g, indent="")
        parts.append(f"Terrain.{biome}.{sub_key}.{name} = {body};")
    return "\n".join(parts)


def variant_to_subkey(variant):
    """`Amiga_sub0` -> `Sub0`, `AmigaTheOne_sub0` -> `Sub0`, etc."""
    v = variant.lower()
    if "sub0" in v:
        return "Sub0"
    if "sub1" in v:
        return "Sub1"
    return "Sub0"


def main():
    payload = json.loads(SRC.read_text(encoding="utf-8"))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

    sets = payload.get("sets", {})

    # Index sub0 groups per biome so sub1 outputs can inherit shared-band
    # entries (Jungle: tile IDs <240 share artwork across sub0/sub1).
    sub0_by_biome = {}
    for set_key, groups in sets.items():
        biome, variant = set_key.split("/", 1)
        if "sub0" in variant.lower():
            sub0_by_biome[biome] = groups

    for set_key, groups in sets.items():
        biome, variant = set_key.split("/", 1)
        sub_key = variant_to_subkey(variant)
        is_sub1 = "sub1" in variant.lower()

        if is_sub1 and biome in sub0_by_biome:
            sub0 = sub0_by_biome[biome]
            sub0_structs = [g for g in sub0 if g.get("kind") == "structure"]
            sub0_terrain = [g for g in sub0
                            if g.get("kind") in (None, "", "terrain", "decor")]
            structures = fold_shared_band(
                biome, sub0_structs,
                [g for g in groups if g.get("kind") == "structure"])
            terrain = fold_shared_band(
                biome, sub0_terrain,
                [g for g in groups
                 if g.get("kind") in (None, "", "terrain", "decor")])
        else:
            structures = [g for g in groups if g.get("kind") == "structure"]
            terrain = [g for g in groups
                       if g.get("kind") in (None, "", "terrain", "decor")]

        safe_variant = variant.replace("/", "_")
        if structures:
            out = OUT_DIR / f"Structures.{biome}.{safe_variant}.js"
            blocks = [emit_structure_block(biome, g) for g in structures]
            header = (f"// Generated by Tools/ExportTileGroups.py\n"
                      f"// Source: Run/Scripts/Tools/TileGroups.json [{set_key}]\n"
                      f"// Review before merging into "
                      f"Run/Scripts/Common/Structures/.\n\n")
            out.write_text(header + "\n\n".join(blocks) + "\n",
                           encoding="utf-8")
            print(f"  wrote {out.relative_to(REPO)} "
                  f"({len(structures)} structure block(s))")

            # Structures RUNTIME leg (sub0 only — see emit_structure_runtime_block).
            # Per-field .Struct overrides for allow-listed buildings, loaded by
            # the engine after Common/Structures/ so the hand-authored
            # Types/SubVariantsAllowed survive.
            if not is_sub1:
                runtime_blocks = [b for b in
                                  (emit_structure_runtime_block(biome, g)
                                   for g in structures)
                                  if b is not None]
                if runtime_blocks:
                    sruntime_out = RUNTIME_DIR / f"Structures.{biome}.{sub_key}.js"
                    sruntime_header = (
                        f"// Generated by Tools/ExportTileGroups.py\n"
                        f"// Source: Run/Scripts/Tools/TileGroups.json [{set_key}]\n"
                        f"// Loaded after Run/Scripts/Common/Structures/ — these\n"
                        f"// assignments overwrite ONLY the Struct tile geometry of\n"
                        f"// the hand-authored building objects; Types,\n"
                        f"// SubVariantsAllowed and StructFindTile are untouched.\n\n")
                    sruntime_out.write_text(
                        sruntime_header + "\n\n".join(runtime_blocks) + "\n",
                        encoding="utf-8")
                    print(f"  wrote {sruntime_out.relative_to(REPO)} "
                          f"({len(runtime_blocks)} runtime structure block(s))")

        if terrain:
            out = OUT_DIR / f"Terrain.{biome}.{safe_variant}.js"
            block = emit_terrain_preview_block(biome, sub_key, terrain)
            header = (f"// Generated by Tools/ExportTileGroups.py\n"
                      f"// Source: Run/Scripts/Tools/TileGroups.json [{set_key}]\n"
                      f"// Review before merging into "
                      f"Run/Scripts/Common/Terrain.js.\n\n")
            out.write_text(header + block + "\n", encoding="utf-8")
            print(f"  wrote {out.relative_to(REPO)} "
                  f"({len(terrain)} terrain group(s))")

            runtime_out = RUNTIME_DIR / f"Terrain.{biome}.{sub_key}.js"
            runtime_block = emit_terrain_runtime_block(biome, sub_key, terrain)
            runtime_header = (
                f"// Generated by Tools/ExportTileGroups.py\n"
                f"// Source: Run/Scripts/Tools/TileGroups.json [{set_key}]\n"
                f"// Loaded after Run/Scripts/Common/Terrain.js — these\n"
                f"// assignments overwrite same-named manual entries while\n"
                f"// leaving manual-only fields (TreeEdges, Vegetation, ...)\n"
                f"// intact.\n\n")
            runtime_out.write_text(runtime_header + runtime_block + "\n",
                                   encoding="utf-8")
            print(f"  wrote {runtime_out.relative_to(REPO)} "
                  f"({len(terrain)} runtime terrain group(s))")

    print(f"\nDone. Outputs in {OUT_DIR.relative_to(REPO)}/")


if __name__ == "__main__":
    main()
