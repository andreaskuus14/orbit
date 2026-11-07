// ARCH IFC import (pure, tested in tests/arch-ifc-import.test.ts). An .ifc from another program opens as a read-only reference
// model: web-ifc tessellates it (arch-ifc-read.ts); this file holds the limits and the maths that need no geometry kernel.
// Axes as arch-ifc-pure: IFC X = ARCH x, IFC Y = ARCH −z, IFC Z = ARCH y (up). web-ifc already hands back Y-up metres.

/** The file comes from outside: refuse what would freeze the tab instead of trying. */
export const IFC_LIMITS = { bytes: 150 * 1024 * 1024, triangles: 3_000_000 };
/** Checked before the file is read into memory, and again on the bytes. */
export function checkIfcSize(bytes: number): void {
  if (bytes > IFC_LIMITS.bytes) throw new Error(`This IFC is ${Math.round(bytes / 1048576)} MB; ARCH opens files up to ${IFC_LIMITS.bytes / 1048576} MB.`);
}

export type IfcGroup = "wall" | "slab" | "roof" | "window" | "door" | "stair" | "structure" | "other";
export const IFC_GROUPS: IfcGroup[] = ["wall", "slab", "roof", "window", "door", "stair", "structure", "other"];
/** IFC type name (any case, e.g. IfcWallStandardCase) and PredefinedType → display group; null = not drawn (voids, spaces, helpers). */
export function ifcGroup(type: string, predefined?: unknown): IfcGroup | null {
  const t = type.toUpperCase();
  if (t === "IFCSLAB" && predefined === "ROOF") return "roof"; // most tools write pitched roof planes as roof slabs
  if (/^IFC(OPENINGELEMENT|SPACE|VIRTUALELEMENT|ANNOTATION|GRID|SITE|BUILDING|BUILDINGSTOREY)$/.test(t)) return null;
  if (t.startsWith("IFCWALL") || t === "IFCCURTAINWALL") return "wall";
  if (t === "IFCSLAB" || t === "IFCCOVERING") return "slab";
  if (t === "IFCROOF") return "roof";
  if (t === "IFCWINDOW" || t === "IFCPLATE") return "window";
  if (t === "IFCDOOR") return "door";
  if (/^IFC(STAIR|STAIRFLIGHT|RAMP|RAMPFLIGHT|RAILING)$/.test(t)) return "stair";
  if (/^IFC(BEAM|COLUMN|MEMBER|FOOTING|PILE)$/.test(t)) return "structure";
  return "other";
}
export const GROUP_COLOR: Record<IfcGroup, string> = { wall: "#e8e2d6", slab: "#b9b2a5", roof: "#9a4f3c", window: "#8fb8d8", door: "#8a6a4a", stair: "#a9a39a", structure: "#c9b48a", other: "#d6d0c4" };

/** IfcCompoundPlaneAngleMeasure (degrees, minutes, seconds, millionths; one shared sign) → decimal degrees; null if missing or out of range. */
export function dmsToDeg(v: unknown, max: number): number | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const n = v.slice(0, 4).map(Number);
  if (!n.every(Number.isFinite)) return null;
  const deg = n[0] + n[1] / 60 + n[2] / 3600 + (n[3] ?? 0) / 3.6e9;
  return Math.abs(deg) <= max ? Math.round(deg * 1e6) / 1e6 : null;
}

/** IFC TrueNorth (direction in the model's XY plane) → ARCH's site.north: true north's bearing, degrees clockwise from model −Z
 *  (= IFC +Y) seen from above. Missing or zero-length → 0 (the file says model +Y is north). */
export function northFromTrueNorth(v: unknown): number {
  const [x, y] = Array.isArray(v) ? v.map(Number) : [];
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) < 1e-9) return 0;
  const deg = ((((Math.atan2(x, y) * 180) / Math.PI) % 360) + 360) % 360;
  return Math.round((deg > 180 ? deg - 360 : deg) * 100) / 100; // (−180, 180]
}

/** IfcSIUnit prefix of the length unit → metres per file unit (storey elevations are written in file units). */
export function lengthScale(prefix: unknown): number {
  const p = typeof prefix === "string" ? prefix.replace(/\./g, "").toUpperCase() : "";
  return ({ MILLI: 1e-3, CENTI: 1e-2, DECI: 0.1, KILO: 1e3 } as Record<string, number>)[p] ?? 1;
}

export type Bounds = { min: [number, number, number]; max: [number, number, number] };
/** Shift that puts the model on ARCH's plot: footprint centred on the origin; IFC elevation 0 stays ground level, unless the whole
 *  model sits far from it (georeferenced heights), then its lowest point becomes ground.
 *  shortcut: ignores IfcMapConversion and the site's own placement; fine for building files, upgrade for site/infra models. */
export function placeOnPlot(b: Bounds): [number, number, number] {
  const dy = b.min[1] > 50 || b.max[1] < -50 ? -b.min[1] : 0;
  return [-(b.min[0] + b.max[0]) / 2, dy, -(b.min[2] + b.max[2]) / 2];
}

/** The classic shadow-study sheet: 21 March, 21 June and 21 December at 09, 12 and 15 local solar time (sun south at 12). */
export function shadowStudyTimes(year: number, lon: number): { label: string; at: Date }[] {
  return ([[2, "21 Mar"], [5, "21 Jun"], [11, "21 Dec"]] as const).flatMap(([m, day]) => [9, 12, 15].map((h) => ({
    label: `${day} · ${String(h).padStart(2, "0")}:00 solar`, at: new Date(Date.UTC(year, m, 21) + (h - lon / 15) * 3_600_000),
  })));
}
