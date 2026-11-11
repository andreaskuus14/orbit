// ARCH IFC import: web-ifc reads and tessellates the file in this process (browser tab or a Node test); nothing is uploaded.
// Output is plain arrays merged per display group, already in ARCH axes and moved onto the plot (arch-ifc-import-pure.ts).
import type { IfcAPI } from "web-ifc";
import { checkIfcSize, dmsToDeg, ifcGroup, IFC_GROUPS, IFC_LIMITS, lengthScale, northFromTrueNorth, placeOnPlot, type Bounds, type IfcGroup } from "./arch-ifc-import-pure.ts";

// web-ifc type codes (from its schema; constant across IFC2x3/IFC4)
const IFCPROJECT = 103090709, IFCSITE = 4097777520, IFCBUILDINGSTOREY = 3124254112, IFCSIUNIT = 448429030, IFCGEOMETRICREPRESENTATIONCONTEXT = 3448662350;

export type IfcMesh = { positions: Float32Array; normals: Float32Array; indices: Uint32Array };
export type IfcInfo = {
  schema: string; project: string; site: { lat: number; lon: number } | null; north: number;
  storeys: { name: string; elevation: number }[]; counts: Partial<Record<IfcGroup, number>>; size: [number, number, number]; triangles: number;
};
export type IfcModel = { info: IfcInfo; meshes: Partial<Record<IfcGroup, IfcMesh>> };

const val = (v: unknown): unknown => (v && typeof v === "object" && "value" in v ? (v as { value: unknown }).value : v);
const text = (v: unknown, n = 120) => { const s = val(v); return typeof s === "string" ? s.slice(0, n) : ""; };
const ids = (api: IfcAPI, m: number, type: number) => { const v = api.GetLineIDsWithType(m, type); return Array.from({ length: v.size() }, (_, i) => v.get(i)); };

/** Reads one .ifc. Throws a plain-language Error for files over IFC_LIMITS or with nothing drawable. */
export function readIfc(api: IfcAPI, bytes: Uint8Array): IfcModel {
  checkIfcSize(bytes.byteLength);
  const m = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: false });
  try {
    const line = (id: number) => api.GetLine(m, id, true);
    const proj = ids(api, m, IFCPROJECT).map(line)[0], project = text(proj?.Name);
    const siteLine = ids(api, m, IFCSITE).map(line)[0];
    const dms = (v: unknown, max: number) => { const a = val(v); return dmsToDeg(Array.isArray(a) ? a.map(val) : null, max); };
    const lat = dms(siteLine?.RefLatitude, 90), lon = dms(siteLine?.RefLongitude, 180);
    const ctx = ids(api, m, IFCGEOMETRICREPRESENTATIONCONTEXT).map(line).find((c) => c?.TrueNorth);
    const north = northFromTrueNorth(ctx?.TrueNorth?.DirectionRatios?.map(val));
    const isLen = (u: { UnitType?: unknown } | null) => val(u?.UnitType) === "LENGTHUNIT"; // the project's own unit; files can hold more
    const lenUnit = (proj?.UnitsInContext?.Units as unknown[] | undefined)?.map((u) => (typeof val(u) === "number" ? line(val(u) as number) : u)).find(isLen)
      ?? ids(api, m, IFCSIUNIT).map(line).find(isLen);
    const scale = lengthScale(val(lenUnit?.Prefix));
    const storeys = ids(api, m, IFCBUILDINGSTOREY).map(line).map((s) => ({ name: text(s.Name), elevation: Math.round(Number(val(s.Elevation) ?? 0) * scale * 1000) / 1000 }))
      .sort((a, b) => a.elevation - b.elevation);

    const acc: Partial<Record<IfcGroup, { p: number[]; n: number[]; i: number[] }>> = {}, counts: Partial<Record<IfcGroup, number>> = {};
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    let triangles = 0;
    api.StreamAllMeshes(m, (mesh) => {
      const type = api.GetNameFromTypeCode(api.GetLineType(m, mesh.expressID)).toUpperCase(); // web-ifc says "IfcSlab"
      const g = ifcGroup(type, type === "IFCSLAB" ? val(api.GetLine(m, mesh.expressID).PredefinedType) : undefined);
      if (!g) return;
      counts[g] = (counts[g] ?? 0) + 1;
      const a = (acc[g] ??= { p: [], n: [], i: [] });
      for (let k = 0; k < mesh.geometries.size(); k++) {
        const pg = mesh.geometries.get(k), geo = api.GetGeometry(m, pg.geometryExpressID), t = pg.flatTransformation; // column-major 4×4
        const v = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize()), ix = api.GetIndexArray(geo.GetIndexData(), geo.GetIndexDataSize());
        triangles += ix.length / 3;
        if (triangles > IFC_LIMITS.triangles) { geo.delete(); throw new Error(`This IFC has more than ${IFC_LIMITS.triangles.toLocaleString("en")} triangles; ARCH can't show it smoothly. Export a lighter view (one building, no furniture).`); }
        const base = a.p.length / 3;
        for (let j = 0; j < v.length; j += 6) {
          const [x, y, z, nx, ny, nz] = [v[j], v[j + 1], v[j + 2], v[j + 3], v[j + 4], v[j + 5]];
          const w = [t[0] * x + t[4] * y + t[8] * z + t[12], t[1] * x + t[5] * y + t[9] * z + t[13], t[2] * x + t[6] * y + t[10] * z + t[14]];
          a.p.push(...w); a.n.push(t[0] * nx + t[4] * ny + t[8] * nz, t[1] * nx + t[5] * ny + t[9] * nz, t[2] * nx + t[6] * ny + t[10] * nz);
          for (let q = 0; q < 3; q++) { lo[q] = Math.min(lo[q], w[q]); hi[q] = Math.max(hi[q], w[q]); }
        }
        for (const i of ix) a.i.push(base + i);
        geo.delete();
      }
    });
    if (!triangles) throw new Error("No building geometry found in this IFC (it may hold only properties or spaces).");

    const b: Bounds = { min: lo as Bounds["min"], max: hi as Bounds["max"] }, d = placeOnPlot(b), meshes: IfcModel["meshes"] = {};
    for (const g of IFC_GROUPS) {
      const a = acc[g]; if (!a) continue;
      const positions = new Float32Array(a.p);
      for (let j = 0; j < positions.length; j += 3) { positions[j] += d[0]; positions[j + 1] += d[1]; positions[j + 2] += d[2]; }
      meshes[g] = { positions, normals: new Float32Array(a.n), indices: new Uint32Array(a.i) };
    }
    const size = [0, 1, 2].map((q) => Math.round((hi[q] - lo[q]) * 100) / 100) as [number, number, number];
    return { info: { schema: api.GetModelSchema(m), project, site: lat !== null && lon !== null ? { lat, lon } : null, north, storeys, counts, size, triangles }, meshes };
  } finally { api.CloseModel(m); }
}
