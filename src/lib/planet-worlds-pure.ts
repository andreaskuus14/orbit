// Explorable worlds for the six workspace planets: each planet's live data (already served to its panel) → places in a
// small 3D scene. Pure: tests in tests/planet-worlds.test.ts. LIFE: only dates, counts and habit names; journal text never.
import { STAGE_COLOR } from "./living-galaxy-pure.ts";

export const PLANET_WORLDS = ["operations", "life", "vault", "analytics", "markets", "business"] as const;
export type PlanetWorldId = (typeof PLANET_WORLDS)[number];
export const isPlanetWorld = (id: unknown): id is PlanetWorldId => (PLANET_WORLDS as readonly unknown[]).includes(id);

export type Shape = "ship" | "crystal" | "column" | "moon" | "machine" | "tree" | "bloom" | "seed";
/** orbit: a moving place circles the origin (MARKETS); spin: a turning machine (running OPERATIONS jobs). */
export type Place = { key: string; label: string; sub: string; shape: Shape; at: [number, number, number]; size: number; color: string; fresh: boolean;
  orbit?: { r: number; speed: number; phase: number }; spin?: boolean };
export type Zone = { label: string; at: [number, number, number] };
export type Scene = { places: Place[]; zones: Zone[]; summary: string };

/** Where each world reads its data: the same GET its panel uses. */
export const WORLD_SOURCE: Record<PlanetWorldId, string> = {
  operations: "/api/tasks", life: "/api/life", vault: "/api/vault", analytics: "/api/activity", markets: "/api/markets", business: "/api/business",
};

const DAY = 86_400_000;
const MAX_PLACES = 240; // the instanced scene stays light; newest first
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const ms = (v: unknown) => { const t = typeof v === "number" ? v : Date.parse(str(v)); return Number.isFinite(t) ? t : 0; };
/** Within the last 24 h (and not in the future by more than a minute: clock skew). */
export const isFresh = (t: number, now: number) => t > 0 && now - t < DAY && t - now < 60_000;
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };
const r1 = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** BUSINESS: leads as ships moored at one pier per stage, bigger for a bigger fee. */
function business(j: Record<string, unknown>, now: number): Scene {
  const stages = Object.keys(STAGE_COLOR) as (keyof typeof STAGE_COLOR)[];
  const rows = arr(j.prospects).slice(0, MAX_PLACES);
  const at = new Map<string, number>();
  const places = rows.map((p): Place => {
    const stage = stages.includes(p.stage as never) ? (p.stage as keyof typeof STAGE_COLOR) : "lead";
    const i = stages.indexOf(stage), k = at.get(stage) ?? 0;
    at.set(stage, k + 1);
    const fee = num(p.fee);
    return { key: str(p.id) || `${stage}${k}`, label: str(p.name) || "Unnamed", sub: `${stage}${fee ? ` · €${Math.round(fee)}/mo` : ""}`, shape: "ship",
      at: [(i - (stages.length - 1) / 2) * 4.2, 0.3, 3 - k * 1.5], size: r1(0.55 + Math.min(0.6, Math.log10(1 + fee) / 5)), color: STAGE_COLOR[stage],
      fresh: isFresh(Math.max(ms(p.created_at), ms(p.updated_at)), now) };
  });
  return { places, zones: stages.map((s, i) => ({ label: s, at: [(i - (stages.length - 1) / 2) * 4.2, 0, 5] })), summary: `${places.length} ${places.length === 1 ? "lead" : "leads"}` };
}

const KIND_COLOR: Record<string, string> = { image: "#ff9ec7", video: "#ff8f6b", audio: "#c3b4ff", pdf: "#ffd27a", text: "#9ec9ff", doc: "#7de3d0", other: "#a9b4c8" };
/** VAULT: files as crystals, one cluster per kind on a ring; a crystal's height follows the file size. */
function vault(j: Record<string, unknown>, now: number): Scene {
  const files = arr(j.files).sort((a, b) => num(b.mtime) - num(a.mtime)).slice(0, MAX_PLACES);
  const kinds = [...new Set(files.map((f) => str(f.type) || "other"))].sort();
  const seen = new Map<string, number>();
  const ring = Math.max(3, kinds.length * 1.4);
  const places = files.map((f): Place => {
    const kind = str(f.type) || "other", ki = kinds.indexOf(kind), n = seen.get(kind) ?? 0;
    seen.set(kind, n + 1);
    const a = (ki / Math.max(1, kinds.length)) * Math.PI * 2, c: [number, number] = [Math.cos(a) * ring, Math.sin(a) * ring];
    const rr = 0.6 * Math.sqrt(n), th = n * 2.39996; // golden-angle spiral inside the cluster
    const size = r1(0.35 + Math.min(1.2, Math.log10(1 + num(f.size)) / 7));
    const name = str(f.name);
    return { key: name || `${kind}${n}`, label: name.split("/").pop() || "file", sub: `${kind} · ${Math.max(1, Math.round(num(f.size) / 1024))} KB`, shape: "crystal",
      at: [r1(c[0] + Math.cos(th) * rr), size / 2, r1(c[1] + Math.sin(th) * rr)], size, color: KIND_COLOR[kind] ?? KIND_COLOR.other, fresh: isFresh(num(f.mtime), now) };
  });
  return { places, zones: kinds.map((k, i) => { const a = (i / Math.max(1, kinds.length)) * Math.PI * 2; return { label: k, at: [r1(Math.cos(a) * (ring + 2.2)), 0, r1(Math.sin(a) * (ring + 2.2))] }; }),
    summary: `${places.length} ${places.length === 1 ? "file" : "files"}` };
}

const TERRAIN_DAYS = 21;
/** ANALYTICS: activity as terrain, one ridge per area across the last three weeks; column height = events that day. */
function analytics(j: Record<string, unknown>, now: number): Scene {
  const items = arr(j.items), today = dayKey(now);
  const days = Array.from({ length: TERRAIN_DAYS }, (_, i) => dayKey(now - (TERRAIN_DAYS - 1 - i) * DAY));
  const count = new Map<string, number>();
  for (const it of items) { const k = `${str(it.area) || "other"}|${dayKey(ms(it.at))}`; count.set(k, (count.get(k) ?? 0) + 1); }
  const areas = [...new Set(items.map((it) => str(it.area) || "other"))].sort();
  const top = Math.max(1, ...count.values());
  const places: Place[] = [];
  areas.forEach((area, ai) => days.forEach((d, di) => {
    const n = count.get(`${area}|${d}`) ?? 0;
    if (!n) return;
    const h = r1(0.3 + (n / top) * 5);
    places.push({ key: `${area}|${d}`, label: `${area}, ${d.slice(5)}`, sub: `${n} ${n === 1 ? "event" : "events"}`, shape: "column",
      at: [r1((di - (TERRAIN_DAYS - 1) / 2) * 0.9), h / 2, r1((ai - (areas.length - 1) / 2) * 1.6)], size: h, color: d === today ? "#ffb04d" : "#60a5fa", fresh: d === today });
  }));
  return { places, zones: areas.map((a, i) => ({ label: a, at: [r1(-((TERRAIN_DAYS - 1) / 2) * 0.9 - 2), 0, r1((i - (areas.length - 1) / 2) * 1.6)] })),
    summary: `${items.length} events in ${TERRAIN_DAYS} days` };
}

/** MARKETS: each watched ticker circles the core; a bigger daily move orbits faster, green up / red down. */
function markets(j: Record<string, unknown>, now: number): Scene {
  const today = dayKey(now);
  const fired = new Set(arr(j.alerts).filter((a) => str(a.firedOn) === today).map((a) => str(a.ticker)));
  const places = arr(j.watchlist).slice(0, 40).map((w, i): Place => {
    const t = str(w.ticker) || `#${i}`, ch = typeof w.changePct === "number" && Number.isFinite(w.changePct) ? w.changePct : null;
    const r = 3 + i * 1.3;
    return { key: t, label: t, sub: `${num(w.price) ? num(w.price).toFixed(2) : "no price"}${ch === null ? "" : ` · ${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%`}`, shape: "moon",
      at: [r, 0, 0], size: 0.45, color: ch === null ? "#a9b4c8" : ch >= 0 ? "#34d399" : "#f87171", fresh: fired.has(t),
      orbit: { r, speed: r1((0.08 + Math.min(10, Math.abs(ch ?? 0)) * 0.06) * (i % 2 ? -1 : 1)), phase: r1(hash(t) * Math.PI * 2) } };
  });
  return { places, zones: [], summary: `${places.length} on the watchlist` };
}

const HALLS = ["running", "queued", "waiting", "done", "failed"] as const;
const HALL_COLOR: Record<(typeof HALLS)[number], string> = { running: "#ffb04d", queued: "#38bdf8", waiting: "#b49cff", done: "#6dffae", failed: "#f87171" };
const hallOf = (s: string): (typeof HALLS)[number] => (s === "running" || s === "queued" || s === "done" ? s : s === "failed" || s === "cancelled" ? "failed" : "waiting");
/** OPERATIONS: agent tasks as machines on a factory floor, one hall per state; running ones turn. */
function operations(j: Record<string, unknown>, now: number): Scene {
  const tasks = arr(j.tasks).slice(0, MAX_PLACES), seen = new Map<string, number>();
  const places = tasks.map((t): Place => {
    const hall = hallOf(str(t.status)), hi = HALLS.indexOf(hall), n = seen.get(hall) ?? 0;
    seen.set(hall, n + 1);
    return { key: str(t.id) || `${hall}${n}`, label: str(t.title) || str(t.request).slice(0, 60) || "Task", sub: `${str(t.agent) || "agent"} · ${str(t.status) || hall}`, shape: "machine",
      at: [r1((hi - 2) * 3.6 + ((n % 3) - 1) * 1.1), 0.4, r1(2.5 - Math.floor(n / 3) * 1.1)], size: hall === "running" ? 0.8 : 0.55, color: HALL_COLOR[hall],
      fresh: isFresh(ms(t.created_at), now), spin: hall === "running" };
  });
  return { places, zones: HALLS.map((h, i) => ({ label: h, at: [(i - 2) * 3.6, 0, 4.2] })), summary: `${seen.get("running") ?? 0} running, ${places.length} recent` };
}

/** Consecutive journal days ending today (or yesterday, if today has no entry yet). */
export function journalStreak(dates: string[], now: number): number {
  const have = new Set(dates);
  let t = have.has(dayKey(now)) ? now : now - DAY, n = 0;
  while (have.has(dayKey(t))) { n++; t -= DAY; }
  return n;
}
const GARDEN_DAYS = 28;
/** LIFE: habits as trees (taller for a longer streak, lit when done today); the journal as a ring of flowers, one per
 *  day it was written in the last four weeks. Dates only: the entries' text is never read here. */
function life(j: Record<string, unknown>, now: number): Scene {
  const habits = arr(j.habits).slice(0, 30);
  const dates = arr(j.journal).map((e) => str(e.date)).filter(Boolean);
  const written = new Set(dates), today = dayKey(now);
  const places: Place[] = habits.map((h, i) => {
    const streak = num(h.streak), a = (i / Math.max(1, habits.length)) * Math.PI * 2, rr = habits.length > 1 ? 2.4 : 0;
    const size = r1(0.6 + Math.min(3, Math.sqrt(streak) * 0.6));
    return { key: `h:${str(h.id) || i}`, label: str(h.name) || "Habit", sub: `${streak}-day streak${h.doneToday ? ", done today" : ""}`, shape: "tree",
      at: [r1(Math.cos(a) * rr), size / 2, r1(Math.sin(a) * rr)], size, color: h.doneToday ? "#34d399" : "#3f6f5a", fresh: !!h.doneToday };
  });
  for (let i = 0; i < GARDEN_DAYS; i++) {
    const d = dayKey(now - (GARDEN_DAYS - 1 - i) * DAY), on = written.has(d), a = (i / GARDEN_DAYS) * Math.PI * 2 - Math.PI / 2;
    places.push({ key: `j:${d}`, label: d, sub: on ? "journal written" : "no entry", shape: on ? "bloom" : "seed",
      at: [r1(Math.cos(a) * 6.5), on ? 0.35 : 0.08, r1(Math.sin(a) * 6.5)], size: on ? 0.42 : 0.16, color: on ? "#f9a8d4" : "#4b5563", fresh: on && d === today });
  }
  const s = journalStreak(dates, now);
  return { places, zones: [], summary: `${habits.length} ${habits.length === 1 ? "habit" : "habits"}, journal streak ${s} ${s === 1 ? "day" : "days"}` };
}

const LAYOUT: Record<PlanetWorldId, (j: Record<string, unknown>, now: number) => Scene> = { business, vault, analytics, markets, operations, life };
/** Raw GET JSON (anything) → the scene. Bad input gives an empty scene, never a throw. */
export function worldScene(id: PlanetWorldId, json: unknown, now: number): Scene {
  return LAYOUT[id](json && typeof json === "object" ? (json as Record<string, unknown>) : {}, now);
}

/** A moving place's position at time t (seconds). */
export function placeAt(p: Place, t: number): [number, number, number] {
  if (!p.orbit) return p.at;
  const a = p.orbit.phase + t * p.orbit.speed;
  return [p.orbit.r * Math.cos(a), p.at[1], p.orbit.r * Math.sin(a)];
}
