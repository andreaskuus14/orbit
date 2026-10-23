// ORBIT's append-only event ledger: typed events, validation, and an order-independent snapshot at any moment. Pure (IO lives elsewhere).
import { PLANETS } from "./planets.ts";
import { STAGES, type Stage } from "./business-pure.ts";

type Data = {
  "core.turn": { model: string; tools: number; ms: number };
  "tool.call": { tool: string; ok: boolean; ms: number };
  "memory.saved": { memoryId: string; kind: string };
  "clip.published": { clipId: string; title?: string };
  "clip.outcome48h": { clipId: string; views: number; likes: number };
  "business.stage": { prospect: string; to: Stage };
  "goal.step": { goalId: string; step: string; status: "started" | "done" | "failed"; goalDone?: boolean };
  "life.habit": { habit: string; done: boolean };
  "focus.session": { minutes: number };
  "notify.shown": { kind: string; title: string };
};
export type EventType = keyof Data;
export type LedgerEvent = { [K in EventType]: { id: string; at: string; type: K; planet: string; data: Data[K]; caused_by?: string } }[EventType];

const str = (max: number) => (v: unknown) => typeof v === "string" && v.trim() !== "" && v.length <= max;
const count = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
const bool = (v: unknown) => typeof v === "boolean";
const oneOf = (xs: readonly string[]) => (v: unknown) => xs.includes(v as string);
const opt = (f: (v: unknown) => boolean) => (v: unknown) => v === undefined || f(v);
const id = str(128), name = str(200);

// Each type's data fields and their checks; unknown fields are dropped.
const SHAPES: { [K in EventType]: Record<keyof Data[K], (v: unknown) => boolean> } = {
  "core.turn": { model: id, tools: count, ms: count },
  "tool.call": { tool: id, ok: bool, ms: count },
  "memory.saved": { memoryId: id, kind: id },
  "clip.published": { clipId: id, title: opt(name) },
  "clip.outcome48h": { clipId: id, views: count, likes: count },
  "business.stage": { prospect: name, to: oneOf(STAGES) },
  "goal.step": { goalId: id, step: name, status: oneOf(["started", "done", "failed"]), goalDone: opt(bool) },
  "life.habit": { habit: name, done: bool },
  "focus.session": { minutes: (v) => typeof v === "number" && v > 0 && v <= 1440 },
  "notify.shown": { kind: id, title: name },
};
export const EVENT_TYPES = Object.keys(SHAPES) as EventType[];
export const LEDGER_PLANETS = [...PLANETS.map((p) => p.id), "core"];

/** ISO 8601 with a time and zone, and a real calendar day (Date.parse alone accepts Feb 30). Returns ms or NaN. */
export function isoMs(v: unknown): number {
  const m = typeof v === "string" && /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(v);
  if (!m) return NaN;
  const [y, mo, d] = [+m[1], +m[2], +m[3]], day = new Date(Date.UTC(y, mo - 1, d));
  return day.getUTCMonth() === mo - 1 && day.getUTCDate() === d ? Date.parse(v as string) : NaN;
}

export function validate(raw: unknown): { ok: LedgerEvent } | { error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "event must be an object" };
  const e = raw as Record<string, unknown>;
  if (!id(e.id)) return { error: "id is required" };
  if (Number.isNaN(isoMs(e.at))) return { error: "at must be an ISO date-time with a zone" };
  if (!EVENT_TYPES.includes(e.type as EventType)) return { error: `unknown type "${String(e.type).slice(0, 40)}"` };
  if (!LEDGER_PLANETS.includes(e.planet as string)) return { error: "unknown planet" };
  if (e.caused_by !== undefined && !id(e.caused_by)) return { error: "caused_by must be an event id" };
  if (e.caused_by === e.id) return { error: "an event can't cause itself" };
  const shape = SHAPES[e.type as EventType] as Record<string, (v: unknown) => boolean>;
  const d = e.data;
  if (!d || typeof d !== "object" || Array.isArray(d)) return { error: "data must be an object" };
  const data: Record<string, unknown> = {};
  for (const [k, check] of Object.entries(shape)) {
    const v = (d as Record<string, unknown>)[k];
    if (!check(v)) return { error: `data.${k} is invalid for ${e.type}` };
    if (v !== undefined) data[k] = v;
  }
  return { ok: { id: e.id as string, at: e.at as string, type: e.type, planet: e.planet, data, ...(e.caused_by !== undefined ? { caused_by: e.caused_by } : {}) } as LedgerEvent };
}

export type Snapshot = {
  counts: Record<EventType, number>;
  lastClipOutcomes: { clipId: string; views: number; likes: number; at: string }[]; // newest first, at most 5
  businessStages: Record<Stage, number>; // prospects by their latest stage
  activeGoals: string[]; // goals with steps and no goalDone yet, sorted
  focusMinutes: number;
};

/** Total order on events: time, then id, then content; any input order gives the same result. */
const cmp = (a: LedgerEvent, b: LedgerEvent) => isoMs(a.at) - isoMs(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || JSON.stringify(a).localeCompare(JSON.stringify(b));

/** State from (already validated) events at or before t. Duplicate ids keep the earliest copy; events whose caused_by chain loops are ignored. */
export function stateAt(events: LedgerEvent[], t: string | number): Snapshot {
  const tm = typeof t === "number" ? t : isoMs(t);
  const byId = new Map<string, LedgerEvent>();
  for (const e of events.filter((e) => isoMs(e.at) <= tm).sort(cmp)) if (!byId.has(e.id)) byId.set(e.id, e);
  const loops = (e: LedgerEvent) => {
    const seen = new Set([e.id]);
    for (let c = e.caused_by; c !== undefined; c = byId.get(c)?.caused_by) {
      if (seen.has(c)) return true;
      seen.add(c);
    }
    return false;
  };
  const live = [...byId.values()].filter((e) => !loops(e));

  const s: Snapshot = {
    counts: Object.fromEntries(EVENT_TYPES.map((k) => [k, 0])) as Record<EventType, number>,
    lastClipOutcomes: [], businessStages: Object.fromEntries(STAGES.map((k) => [k, 0])) as Record<Stage, number>, activeGoals: [], focusMinutes: 0,
  };
  const stage = new Map<string, Stage>(), goals = new Map<string, boolean>();
  for (const e of live) { // sorted oldest first, so later events win
    s.counts[e.type]++;
    if (e.type === "clip.outcome48h") s.lastClipOutcomes.unshift({ ...e.data, at: e.at });
    else if (e.type === "business.stage") stage.set(e.data.prospect, e.data.to);
    else if (e.type === "goal.step") goals.set(e.data.goalId, !!e.data.goalDone || !!goals.get(e.data.goalId));
    else if (e.type === "focus.session") s.focusMinutes += e.data.minutes;
  }
  s.lastClipOutcomes = s.lastClipOutcomes.slice(0, 5).map(({ clipId, views, likes, at }) => ({ clipId, views, likes, at }));
  for (const v of stage.values()) s.businessStages[v]++;
  s.activeGoals = [...goals].filter(([, done]) => !done).map(([g]) => g).sort();
  return s;
}

/** emit()'s check: null for a non-ledger type or a valid payload, else why it doesn't fit the ledger shape. */
export function ledgerIssue(type: string, planet: string, data: unknown, causedBy?: string): string | null {
  if (!EVENT_TYPES.includes(type as EventType)) return null;
  const r = validate({ id: "new", at: "2000-01-01T00:00:00Z", type, planet, data, ...(causedBy !== undefined ? { caused_by: causedBy } : {}) });
  return "error" in r ? r.error : null;
}

export type EventRow = { id: number | string; created_at: string; type: string; planet: string; payload: unknown; caused_by?: number | string | null };
/** public.events rows → valid ledger events (legacy and malformed rows are skipped). Postgres timestamps carry microseconds, so they're normalised. */
export function fromRows(rows: EventRow[]): LedgerEvent[] {
  return rows.flatMap((r) => {
    const ms = Date.parse(r.created_at);
    if (Number.isNaN(ms)) return [];
    const v = validate({ id: String(r.id), at: new Date(ms).toISOString(), type: r.type, planet: r.planet, data: r.payload, ...(r.caused_by != null ? { caused_by: String(r.caused_by) } : {}) });
    return "ok" in v ? [v.ok] : [];
  });
}
