// ARCH measure inside a scan (roadmap 5.5), pure and tested in tests/arch-measure.test.ts: ray picking against splat
// centres, calibration (scan units → metres), length parsing/formatting, and the measurement lines kept in the scan's note.
// Points are in the scan file's own coordinates, so the viewer's centring and ↕ flip never change a stored measurement.

export type V3 = [number, number, number];
export type Measure = { a: V3; b: V3 };

/** Angular pick radius: a click counts splats within `px` screen pixels (tan of the half-angle, per unit of depth). */
export const pickK = (fovDeg: number, viewportPx: number, px = 10) => (2 * Math.tan((fovDeg * Math.PI) / 360) * px) / Math.max(1, viewportPx);

/** The surface a click lands on: splat centres inside the pick cone, front to back, composited by opacity (falloff with
 *  distance from the ray); the hit is where the ray is half covered, like the rendered pixel. Returns the point on the
 *  ray at that depth (exactly under the cursor), or null when nothing is in the cone. `dir` must be unit length.
 *  One pass over the cloud (~2 ms for 300k splats), run in the splat worker. */
export function pickSplat(positions: Float32Array, opacities: Float32Array, o: V3, dir: V3, k: number, near = 0.05): V3 | null {
  const hits: { t: number; w: number }[] = [];
  for (let i = 0, n = opacities.length; i < n; i++) {
    const vx = positions[3 * i] - o[0], vy = positions[3 * i + 1] - o[1], vz = positions[3 * i + 2] - o[2];
    const t = vx * dir[0] + vy * dir[1] + vz * dir[2];
    if (t < near) continue;
    const perp2 = vx * vx + vy * vy + vz * vz - t * t, r = k * t;
    if (perp2 > r * r) continue;
    hits.push({ t, w: opacities[i] * Math.exp((-2 * perp2) / (r * r)) });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a.t - b.t);
  let T = 1, at = -1;
  for (let i = 0; i < hits.length && at < 0; i++) { T *= 1 - Math.min(0.99, hits[i].w); if (T < 0.5) at = i; }
  if (at < 0) at = hits.reduce((m, h, i) => (h.w > hits[m].w ? i : m), 0); // sparse cone: the strongest splat
  const t = hits[at].t;
  return [o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t];
}

export const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const mid = (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/** Metres per scan unit from one known length, or null if either side is unusable. */
export function calibrate(scanUnits: number, realMetres: number): number | null {
  const s = realMetres / scanUnits;
  return Number.isFinite(s) && s > 0 && scanUnits > 1e-6 ? s : null;
}

/** "2", "2,05", "2.0 m", "200 cm", "2000mm" → metres; null if unreadable or outside 1 cm..1 km. */
export function parseLength(s: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?\s*$/i.exec(s);
  if (!m) return null;
  const v = Number(m[1].replace(",", ".")) / ({ mm: 1000, cm: 100, m: 1 }[(m[2] ?? "m").toLowerCase() as "mm" | "cm" | "m"]);
  return v >= 0.01 && v <= 1000 ? v : null;
}

/** 0.853 → "85 cm", 2.4321 → "2.43 m", 12.34 → "12.3 m". */
export function formatLength(m: number): string {
  if (!Number.isFinite(m)) return "?";
  if (m < 1) return `${Math.round(m * 100)} cm`;
  return m < 10 ? `${m.toFixed(2)} m` : `${m.toFixed(1)} m`;
}

// ---- stored in the scan's MEMORY note (scanNote in arch-studio-pure) ----
export type MeasureNote = { scale: number | null; ref: number | null; list: Measure[] };
const num = (v: number) => String(Number(v.toFixed(4)));
const v3 = (s: string): V3 | null => { const p = s.trim().split(/\s+/).map(Number); return p.length === 3 && p.every(Number.isFinite) ? (p as V3) : null; };

export function readMeasureNote(content: string): MeasureNote {
  const sc = /^scale: ([\d.]+) m per scan unit(?: \(calibrated on ([\d.]+) m\))?/m.exec(content);
  const scale = sc ? Number(sc[1]) : NaN;
  const list = [...content.matchAll(/^measure: [^|\n]*\|([^|\n]+)\|([^|\n]+)$/gm)].flatMap((m) => { const a = v3(m[1]), b = v3(m[2]); return a && b ? [{ a, b }] : []; });
  return { scale: scale > 0 ? scale : null, ref: sc?.[2] ? Number(sc[2]) : null, list };
}

/** The note with its scale/measure lines replaced (everything else kept). */
export function withMeasures(content: string, n: MeasureNote): string {
  const keep = content.split("\n").filter((l) => !/^(scale|measure): /.test(l));
  while (keep.length && !keep[keep.length - 1].trim()) keep.pop();
  const s = n.scale ?? 1;
  return [
    ...keep,
    ...(n.scale ? [`scale: ${n.scale.toPrecision(6)} m per scan unit${n.ref ? ` (calibrated on ${num(n.ref)} m)` : ""}`] : []),
    ...n.list.map((m) => `measure: ${formatLength(dist(m.a, m.b) * s)}${n.scale ? "" : " (uncalibrated)"} | ${m.a.map(num).join(" ")} | ${m.b.map(num).join(" ")}`),
  ].join("\n");
}
