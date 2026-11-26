// Pure helpers for the v9 planet-world props (no three.js): which prop a Vault slot gets, a book row's dimensions,
// the numbers that make a cargo pod / freighter, placeholder screen gradients, the Studio default camera and how an
// "orbit:world-pick" event maps to the item a planet's panel should open.

/** Small deterministic generator (mulberry32) so a prop looks the same on every visit. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hashStr(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/* ---------- VAULT shelves ---------- */

export type VaultVariant = "crystal" | "box" | "books";
const DOCS = new Set(["pdf", "doc", "text"]);
/** What stands in a file's slot: documents are books and archive boxes, media files are glass crystals on a plinth
 *  (with some boxes between), so each shelf reads as the kind of thing it holds. */
export function vaultVariant(kind: string, i: number): VaultVariant {
  if (DOCS.has(kind)) return i % 3 === 1 ? "box" : "books";
  return i % 3 === 2 ? "box" : "crystal";
}
/** The icon drawn on a crystal's face. */
export type Glyph = "image" | "video" | "audio" | "file";
export const glyphOf = (kind: string): Glyph => (kind === "image" ? "image" : kind === "video" ? "video" : kind === "audio" ? "audio" : "file");

export const BOOK_TONES = ["#6b2d22", "#4a3a22", "#2f4a3a", "#5a2f3f", "#7a5a2a", "#2e3a52", "#8a6a3a", "#3d2a1d"] as const;
export type Book = { dx: number; w: number; h: number; d: number; lean: number; tone: number; band: boolean };
export const SLOT_W = 0.46; // a slot is about half a unit wide along the shelf
/** Three or four books standing in a row (no gap wider than a finger), one maybe leaning; always fits in a slot. */
export function bookSet(seed: number): Book[] {
  const r = rng(seed), n = 3 + (r() < 0.4 ? 1 : 0), out: Book[] = [];
  const ws = Array.from({ length: n }, () => 0.09 + r() * 0.06), total = ws.reduce((a, b) => a + b, 0), k = Math.min(1, (SLOT_W - 0.03) / total);
  let x = -(total * k) / 2;
  const lean = Math.floor(r() * n);
  ws.forEach((w0, i) => { const w = w0 * k; out.push({ dx: x + w / 2, w, h: 0.5 + r() * 0.36, d: 0.3 + r() * 0.1, lean: i === lean && r() < 0.5 ? (r() < 0.5 ? -1 : 1) * (0.12 + r() * 0.12) : 0, tone: Math.floor(r() * BOOK_TONES.length), band: r() < 0.5 }); x += w; });
  return out;
}

/* ---------- OPERATIONS cargo pod / BUSINESS freighter dimensions (world units) ---------- */

/** Pod: long axis along the track. The body sits on two rails; corners carry the gate colour. */
export const POD = { len: 1.15, wid: 0.62, hgt: 0.5, corner: 0.16, wheels: 4, rail: 0.3 } as const;
/** Freighter: nose at +x. hull length 1 unit before scale. */
export const FREIGHTER = { len: 1.6, beam: 0.42, height: 0.3, containers: 6, engines: 3 } as const;
/** Container stack layout on a freighter's back: [x, row] for each container (row 0 = lower, 1 = upper). */
export function containerLayout(n: number = FREIGHTER.containers): { x: number; row: 0 | 1 }[] {
  const per = Math.ceil(n / 2), out: { x: number; row: 0 | 1 }[] = [];
  for (let i = 0; i < n; i++) out.push({ x: -0.45 + (i % per) * (0.82 / Math.max(1, per - 1 || 1)), row: i < per ? 0 : 1 });
  return out;
}

/* ---------- placeholder screens (STUDIO wall) ---------- */

/** A screen with no thumbnail gets a deterministic dark red/violet/blue gradient instead of black. */
export function screenGradient(key: string): { a: string; b: string; angle: number } {
  const r = rng(hashStr(key)), hues = [350, 330, 285, 255, 215], h = hues[Math.floor(r() * hues.length)], h2 = (h + 25 + r() * 40) % 360;
  return { a: `hsl(${Math.round(h)} 70% 30%)`, b: `hsl(${Math.round(h2)} 75% 14%)`, angle: Math.round(r() * 90) };
}

/* ---------- STUDIO default camera ---------- */

export const STUDIO_CAM = { pos: [0, 3.9, 13.2] as [number, number, number], target: [0, 1.9, -1.2] as [number, number, number], fov: 45 };
export const studioHome = () => Math.hypot(STUDIO_CAM.pos[0] - STUDIO_CAM.target[0], STUDIO_CAM.pos[1] - STUDIO_CAM.target[1], STUDIO_CAM.pos[2] - STUDIO_CAM.target[2]);
/** Is a world point inside the vertical field of view of a camera looking at its target (no roll)? Used to keep the truss in frame. */
export function inFrame(cam: { pos: [number, number, number]; target: [number, number, number]; fov: number }, p: [number, number, number]): boolean {
  const f = [cam.target[0] - cam.pos[0], cam.target[1] - cam.pos[1], cam.target[2] - cam.pos[2]], fl = Math.hypot(...f);
  const d = [p[0] - cam.pos[0], p[1] - cam.pos[1], p[2] - cam.pos[2]], depth = (d[0] * f[0] + d[1] * f[1] + d[2] * f[2]) / fl;
  if (depth <= 0) return false;
  const pitch = Math.atan2(f[1], Math.hypot(f[0], f[2])), ang = Math.atan2(p[1] - cam.pos[1], Math.hypot(d[0], d[2]));
  return Math.abs(ang - pitch) <= (cam.fov / 2) * (Math.PI / 180);
}

/* ---------- orbit:world-pick -> the item a planet's panel opens ---------- */

export type PickTarget = { kind: "job" | "client" | "project" | "video"; id: string };
/** The chip ids the 3D scenes use (PlanetScenes, StudioScreens): p:<job> s:<client> d:<client> k:<project> v:<video>. Lanes, gates and
 *  tiers are not items, so they open nothing. Returns null when the event is for another world or names no item. */
export function pickTarget(detail: unknown, world: string): PickTarget | null {
  const d = detail as { world?: unknown; id?: unknown } | null;
  if (!d || d.world !== world || typeof d.id !== "string") return null;
  const i = d.id.indexOf(":"), tag = d.id.slice(0, i), id = d.id.slice(i + 1);
  if (i < 0 || !id) return null;
  if (world === "operations" && tag === "p") return { kind: "job", id };
  if (world === "business" && (tag === "s" || tag === "d")) return { kind: "client", id };
  if (world === "analytics" && tag === "k") return { kind: "project", id };
  if (world === "studio" && tag === "v") return { kind: "video", id };
  return null;
}
export const WORLD_PICK = "orbit:world-pick";
