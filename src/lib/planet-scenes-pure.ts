// Planet worlds v2: each planet's real data (the same GET its panel uses) → the parts of its 3D scene. Pure: tests in
// tests/planet-scenes.test.ts. LIFE: habit names, streaks and done-today only; the journal is never read here.
import { STAGE_COLOR } from "./living-galaxy-pure.ts";

const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const ms = (v: unknown) => { const t = typeof v === "number" ? v : Date.parse(str(v)); return Number.isFinite(t) ? t : 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000;
export const clip = (s: string, n = 34) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Where each v2 world reads its data. ANALYTICS reads the planet's own summary (real minutes per project). */
export const SCENE_SOURCE = { operations: "/api/tasks?lite=1", vault: "/api/vault", business: "/api/business", analytics: "/api/analytics/summary?days=7", life: "/api/life" } as const;
export type SceneId = keyof typeof SCENE_SOURCE;

/* ---------- OPERATIONS: a ring station; jobs are pods on the lane, parked at the gate of their state ---------- */

export const GATES = ["queued", "running", "needs", "done", "failed"] as const;
export type Gate = (typeof GATES)[number];
export const GATE_COLOR: Record<Gate, string> = { queued: "#38bdf8", running: "#ffb04d", needs: "#c084fc", done: "#4ade80", failed: "#f87171" };
/** Gate angles on the ring (radians): the work flows round clockwise queued → running → needs → done, failed off to the side. */
export const GATE_ANGLE: Record<Gate, number> = { queued: Math.PI * 0.95, running: Math.PI * 0.45, needs: -Math.PI * 0.05, done: -Math.PI * 0.55, failed: -Math.PI * 1.05 + 0.4 };
export const gateOf = (s: string): Gate => (s === "queued" ? "queued" : s === "running" ? "running" : s === "awaiting_approval" || s === "waiting" ? "needs" : s === "done" ? "done" : s === "failed" || s === "cancelled" ? "failed" : "queued");
export type Pod = { id: string; title: string; agent: string; gate: Gate; moving: boolean; fresh: boolean; slot: number };
export type OpsScene = { gates: { gate: Gate; count: number; today: number }[]; pods: Pod[]; summary: string };
const MAX_PODS = 48;
export function opsScene(json: unknown, now: number): OpsScene {
  const tasks = arr(obj(json).tasks).filter((t) => !t.parent_id);
  const count = new Map<Gate, number>(), today = new Map<Gate, number>(), slot = new Map<Gate, number>();
  for (const t of tasks) {
    const g = gateOf(str(t.status)); count.set(g, (count.get(g) ?? 0) + 1);
    if (now - Math.max(ms(t.finished_at), ms(t.created_at)) < DAY) today.set(g, (today.get(g) ?? 0) + 1);
  }
  // active work first, then the newest finished; a finished pod only shows if it ended in the last day
  const rank = (g: Gate) => (g === "running" ? 0 : g === "needs" ? 1 : g === "queued" ? 2 : 3);
  const pods = tasks.map((t) => ({ t, g: gateOf(str(t.status)) }))
    .filter(({ t, g }) => rank(g) < 3 || now - Math.max(ms(t.finished_at), ms(t.created_at)) < DAY)
    .sort((a, b) => rank(a.g) - rank(b.g) || ms(b.t.created_at) - ms(a.t.created_at)).slice(0, MAX_PODS)
    .map(({ t, g }, i): Pod => { const s = slot.get(g) ?? 0; slot.set(g, s + 1);
      return { id: str(t.id) || `p${i}`, title: str(t.title) || str(t.request).slice(0, 60) || "Job", agent: str(t.agent), gate: g, moving: g === "running", fresh: now - ms(t.created_at) < DAY, slot: s }; });
  const run = count.get("running") ?? 0, needs = count.get("needs") ?? 0;
  return { gates: GATES.map((g) => ({ gate: g, count: count.get(g) ?? 0, today: today.get(g) ?? 0 })), pods,
    summary: `${run} running${needs ? `, ${needs} need you` : ""}, ${today.get("done") ?? 0} done today` };
}
/** A parked pod's place on the ring: queued line up before their gate, finished ones pile after it. */
export function podAngle(p: Pod, n: number): number {
  const base = GATE_ANGLE[p.gate], step = 0.09;
  if (p.moving) return base + ((p.slot + 0.5) / Math.max(1, n)) * 0.9 - 0.45;
  return base + (p.gate === "queued" ? 1 : -1) * (0.18 + p.slot * step) * (p.slot % 2 ? 1 : 1);
}

/* ---------- VAULT: file crystals on shelves round the vault, one arc per kind ---------- */

export const VAULT_KIND_COLOR: Record<string, string> = { image: "#ff9f2e", video: "#ff7a3d", audio: "#ffc14d", pdf: "#ffb347", text: "#ffd36b", doc: "#e8a33c", other: "#c98a3a" };
export type VaultKind = { kind: string; count: number; bytes: number; from: number; to: number };
export type VaultCrystal = { key: string; name: string; kind: string; at: [number, number, number]; h: number; fresh: boolean; size: number; mtime: number };
export function vaultScene(json: unknown, now: number) {
  const files = arr(obj(json).files).sort((a, b) => num(b.mtime) - num(a.mtime));
  const by = new Map<string, Record<string, unknown>[]>();
  for (const f of files) { const k = str(f.type) || "other"; by.set(k, [...(by.get(k) ?? []), f]); }
  const kinds = [...by.keys()].sort((a, b) => (by.get(b)!.length - by.get(a)!.length) || a.localeCompare(b));
  const span = (Math.PI * 1.5) / Math.max(1, kinds.length), start = -Math.PI * 1.25; // a horseshoe of shelves, open toward the camera
  const crystals: VaultCrystal[] = [], out: VaultKind[] = [];
  kinds.forEach((k, ki) => {
    const list = by.get(k)!, from = start + ki * span, to = from + span * 0.86;
    out.push({ kind: k, count: list.length, bytes: list.reduce((s, f) => s + num(f.size), 0), from, to });
    list.slice(0, 40).forEach((f, i) => { // 4 shelves x 10 per kind
      const row = Math.floor(i / 10), col = i % 10, a = from + ((col + 0.5) / 10) * (to - from), r = 7.2 + row * 0.15;
      const h = r2(0.35 + Math.min(0.9, Math.log10(1 + num(f.size)) / 9));
      crystals.push({ key: str(f.name) || `${k}${i}`, name: str(f.name).split("/").pop() || "file", kind: k, at: [r2(Math.cos(a) * r), r2(0.55 + row * 1.15), r2(Math.sin(a) * r)], h, fresh: now - num(f.mtime) < DAY, size: num(f.size), mtime: num(f.mtime) });
    });
  });
  const total = files.reduce((s, f) => s + num(f.size), 0);
  return { kinds: out, crystals, total, count: files.length, summary: `${files.length} ${files.length === 1 ? "file" : "files"}, ${bytes(total)}` };
}
export function bytes(n: number) { const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return `${i ? n.toFixed(n < 10 ? 1 : 0) : Math.round(n)} ${u[i]}`; }

/* ---------- BUSINESS: a stacked trade hub, one tier per deal stage; deals dock as ships round their tier ---------- */

export const BIZ_STAGES = ["lead", "contacted", "replied", "pilot", "paying"] as const;
export type Tier = { stage: string; count: number; fees: number; r: number; y: number; color: string };
export type Ship = { id: string; name: string; stage: string; fee: number; angle: number; r: number; y: number; size: number; fresh: boolean };
export function bizScene(json: unknown, now: number) {
  const rows = arr(obj(json).prospects);
  const tiers: Tier[] = BIZ_STAGES.map((s, i) => ({ stage: s, count: 0, fees: 0, r: r2(6.2 - i * 0.95), y: r2(0.6 + i * 1.25), color: STAGE_COLOR[s] }));
  const ships: Ship[] = [], seen = new Map<string, number>();
  let lost = 0;
  for (const p of rows) {
    const st = str(p.stage), ti = BIZ_STAGES.indexOf(st as never);
    if (ti < 0) { lost++; continue; }
    const t = tiers[ti], fee = num(p.fee); t.count++; t.fees += fee;
    const k = seen.get(st) ?? 0; seen.set(st, k + 1);
    if (k >= 18) continue;
    const a = (k / 18) * Math.PI * 2 + ti * 0.7;
    ships.push({ id: str(p.id) || `${st}${k}`, name: str(p.name) || "Unnamed", stage: st, fee, angle: r2(a), r: r2(t.r + 0.9), y: t.y, size: r2(0.45 + Math.min(0.55, Math.log10(1 + fee) / 6)), fresh: now - ms(p.updated_at || p.created_at) < DAY });
  }
  const paying = tiers[4];
  return { tiers, ships, lost, summary: `${rows.length - lost} open ${rows.length - lost === 1 ? "deal" : "deals"}${paying.fees ? `, €${Math.round(paying.fees)}/mo paying` : ""}` };
}

/* ---------- ANALYTICS: time spent as terrain, one peak per project (real minutes, last 7 days) ---------- */

export type Peak = { name: string; minutes: number; x: number; z: number; h: number; w: number };
export function timeScene(json: unknown) {
  const projects = arr(obj(obj(json).cost).projects).map((p) => ({ name: str(p.name) || "No project", minutes: num(p.minutes) })).filter((p) => p.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes).slice(0, 8);
  const top = Math.max(1, ...projects.map((p) => p.minutes)), total = projects.reduce((s, p) => s + p.minutes, 0);
  const peaks: Peak[] = projects.map((p, i) => { // biggest in the middle, the rest on a spiral out from it
    const a = i * 2.39996, r = i ? 3 + Math.sqrt(i) * 3.2 : 0;
    return { ...p, x: r2(Math.cos(a) * r), z: r2(Math.sin(a) * r * 0.7), h: r2(1 + (p.minutes / top) * 6), w: r2(1.6 + Math.sqrt(p.minutes / top) * 1.6) };
  });
  const daily = arr(obj(json).daily).map((d) => num(d.done) + num(d.failed));
  return { peaks, total, daily, summary: `${fmtMin(total)} of work in 7 days` };
}
export const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`);
/** Terrain height at (x, z): gaussian peaks plus a low ripple, so empty ground is not dead flat. */
export function heightAt(peaks: Peak[], x: number, z: number) {
  let h = 0.12 * Math.sin(x * 0.7) * Math.cos(z * 0.6);
  for (const p of peaks) { const d2 = ((x - p.x) ** 2 + (z - p.z) ** 2) / (p.w * p.w); h += p.h * Math.exp(-d2) * (1 + 0.08 * Math.sin(x * 3 + z * 2)); }
  return h;
}

/* ---------- LIFE: one glass habit pod per habit round a garden pond; done today = lit ---------- */

export type HabitPod = { id: string; name: string; streak: number; done: boolean; due: boolean; at: [number, number, number] };
export function lifeScene(json: unknown) {
  const habits = arr(obj(json).habits).filter((h) => !h.off).slice(0, 12);
  const n = habits.length;
  const pods: HabitPod[] = habits.map((h, i) => { const a = -Math.PI / 2 + ((i + 0.5) / Math.max(1, n)) * Math.PI * 2, r = n > 1 ? 4.2 : 0;
    return { id: str(h.id) || `h${i}`, name: str(h.name) || "Habit", streak: num(h.streak), done: !!h.doneToday, due: h.scheduledToday !== false, at: [r2(Math.cos(a) * r), 0, r2(Math.sin(a) * r)] }; });
  const due = pods.filter((p) => p.due), done = due.filter((p) => p.done).length;
  return { pods, done, due: due.length, summary: `${done} of ${due.length} habits done today` };
}

/* ---------- MEMORY: one crystal cluster per kind on the ground under the star map; bigger kinds grow more, taller crystals ---------- */

export type MemCluster = { kind: string; count: number; x: number; z: number; crystals: { at: [number, number, number]; h: number; tilt: [number, number] }[] };
/** items: the map's stars (x/y/z from the server layout). Returns clusters and the ground height (below the lowest star). */
export function memoryClusters(items: { kind: string; x: number; y: number; z: number }[]) {
  const by = new Map<string, { n: number; x: number; z: number }>();
  let minY = Infinity;
  for (const m of items) {
    if (![m.x, m.y, m.z].every(Number.isFinite)) continue;
    const k = by.get(m.kind) ?? { n: 0, x: 0, z: 0 }; k.n++; k.x += m.x; k.z += m.z; by.set(m.kind, k); minY = Math.min(minY, m.y);
  }
  const ground = Number.isFinite(minY) ? r2(minY - 5) : -8;
  const clusters: MemCluster[] = [...by.entries()].sort((a, b) => b[1].n - a[1].n).map(([kind, k], ci) => {
    const cx = k.x / k.n, cz = k.z / k.n, n = Math.min(26, 5 + Math.round(Math.sqrt(k.n) * 2)), big = Math.log10(1 + k.n);
    const crystals = Array.from({ length: n }, (_, i) => { const a = i * 2.39996 + ci, rr = i ? 0.45 * Math.sqrt(i) * (1 + big * 0.3) : 0;
      return { at: [r2(cx + Math.cos(a) * rr), ground, r2(cz + Math.sin(a) * rr)] as [number, number, number], h: r2((i ? 1.2 + ((i * 7) % 5) * 0.35 : 2.6) * (0.8 + big * 0.55) * (1 - Math.min(0.5, rr * 0.06))),
        tilt: [r2(Math.sin(i * 3.1) * 0.25), r2(Math.cos(i * 1.7) * 0.25)] as [number, number] }; });
    return { kind, count: k.n, x: r2(cx), z: r2(cz), crystals };
  });
  return { clusters, ground };
}
