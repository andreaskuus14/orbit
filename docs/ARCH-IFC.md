# ARCH and IFC: which path supports what (Atlas G02)

ORBIT has three separate IFC paths. They share axis conventions (IFC X = ARCH x east, IFC Y = ARCH −z north, IFC Z = ARCH y up; metres)
but not code or capabilities. Check this table before promising "IFC support".

| | **Export** (`arch-ifc-pure.ts` → `arch-export-pure.ts`) | **Import as reference** (PR #451, `arch-ifc-import-pure.ts` + `arch-ifc-read.ts`, web-ifc 0.0.78) | **Summary via Blender** (`blender-pure.ts`, Bonsai/IfcOpenShell through the Blender plugin) |
|---|---|---|---|
| Direction | ARCH scene → IFC4 STEP file | outside `.ifc` → read-only model in the 3D view | outside `.ifc` → text summary |
| Needs | nothing (pure) | the browser (web-ifc WASM) | Blender + Bonsai on the PC, plugin connected |
| Geometry | every part an extruded box; gable roof an extruded triangle | full tessellated geometry from the file | none drawn, counts only |
| Walls / slabs / roof | yes (outer shell as four walls) | yes, grouped (wall, slab, roof, window, door, stair, structure, other) | element counts by IFC class |
| Openings | `IfcOpeningElement` voiding its host wall; hostless openings left out | drawn as windows and doors | counted |
| Storeys | one per slab level, with elevation | read | listed with elevations |
| Units | SI metres and m² declared | as in the file, web-ifc returns metres, Y-up | as in the file |
| Site latitude/longitude | written when the scene has a site | read; the sun study uses the IFC's site while it's open, never merged into the owner's | not read |
| True north | **not written** (IfcSite has no `TrueNorth`; noted in #473) | read (`northFromTrueNorth`); `IfcMapConversion` ignored (fine for buildings, not for site/infra models) | not read |
| Materials, layers, property sets, quantities | **no** (the export says so in its checks) | not used | materials listed |
| Spaces / rooms | no | not drawn | spaces with names and areas where present |
| Editable in ARCH | n/a | **no**, a reference model only | no |
| Limits | scene size | refuses files over 80 MB or 3 M triangles (parsed on the main thread) | Blender's |
| Tests | `tests/arch-ifc.test.ts`, `tests/arch-reference.test.ts` (#473: SI units, storeys at 0.0/3.0 m, opening sizes) | `tests/arch-ifc-import.test.ts` (#451) | none (prompt text only) |

## What this means

- "Open a BIM file and edit it" isn't supported. Import (#451) shows it beside your own model, read-only.
- An exported file is a massing model a viewer can open, not a BIM deliverable: no materials, property sets or true north.
- A round trip (export → import) keeps boxes, storeys and openings, but loses north and anything the export doesn't write.

## Gaps worth closing, in order

1. Write `TrueNorth` on export from the scene's `site.north` (one entity); then a round trip keeps orientation.
2. Wire `siteInstant()` (#473) into the sun study so the slider hour is the site's clock, not the viewer's (bug found in #473).
3. Move `readIfc` to a worker before real project files (tens of MB) are opened.
4. Only then: property sets and quantities on export, if a school or office workflow needs them.
