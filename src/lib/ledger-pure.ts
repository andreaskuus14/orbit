// ORBIT's append-only event ledger: typed events, validation, and an order-independent snapshot at any moment. Pure (IO lives elsewhere).
import { PLANETS } from "./planets.ts";
import { STAGES, type Stage } from "./business-pure.ts";
import { CARD_KINDS, SOURCES, type CardKind, type Source } from "./morning-rank-pure.ts";
import { AREAS, LEVELS, type Area } from "./autonomy-pure.ts";
import { STATUSES as CONTRACT_STATUSES, type Status as ContractStatus } from "./contracts-pure.ts";
import { ITEM_STATUSES, NIGHT_KINDS, type ItemStatus, type NightKind } from "./night-pure.ts";
import { INTENTS, NEGO_STATES, type Intent, type NegoState } from "./negotiator-pure.ts";
import { ROLES, type Role } from "./company-pure.ts";
import { STATUSES as INVOICE_STATUSES, type Status as InvoiceStatus } from "./invoices-pure.ts";

type Data = {
  "core.turn": { model: string; tools: number; ms: number };
  "tool.call": { tool: string; ok: boolean; ms: number };
  "memory.saved": { memoryId: string; kind: string };
  "clip.published": { clipId: string; title?: string };
  "clip.outcome48h": { clipId: string; views: number; likes: number };
  "clip.postmortem": { clipId: string; drops: number; hold3s?: number }; // hold3s: watch ratio at 3 s (above 1 = rewatched)
  "business.stage": { prospect: string; to: Stage };
  "goal.step": { goalId: string; step: string; status: "started" | "done" | "failed"; goalDone?: boolean };
  "life.habit": { habit: string; done: boolean };
  "focus.session": { minutes: number };
  "notify.shown": { kind: string; title: string };
  "morning.thumb": { kind: CardKind; key: string; up: boolean };
  "policy.decision": { tool: string; tier: "T0" | "T1" | "T2" | "T3"; verdict: "allow" | "refuse"; reason: string; turn?: string }; // no message text or LIFE data
  "morning.click": { source: Source; key: string };
  "morning.done": { source: Source; key: string };
  "journal.saved": { memoryId: string };
  "remote.command": { command: string; ok: boolean; device: string }; // phone remote: the command type only, never its text
  "higgsfield.spend": { jobId: string; credits: number; kind: "story" | "draft" }; // credits the owner's Approve click allowed
  "memory.hygiene": { action: "merge" | "retract"; decision: "accepted" | "dismissed"; key: string }; // ids only, never memory text
  "night.start": { night: string }; // night shift (night.ts): ids and counts only, never task text, drafts or results
  "night.task": { night: string; kind: NightKind; ref: string; status: ItemStatus };
  "night.end": { night: string; done: number; approvals: number; failed: number; calls: number; minutes: number };
  "lesson.kept": { id: string }; // learning loop (lessons.ts): the lesson id only, never its text
  "lesson.rejected": { id: string };
  "brief.shown": { day: string; items: string[]; spoken: boolean }; // morning brief (brief.ts): item ids only, never the words
  "deal.wish": { wishId: string; action: "added" | "removed" | "done" }; // deal hunter (deals.ts): ids and counts only, never items, prices or URLs
  "deal.hunt": { wishId: string; offers: number; great: number };
  "deal.found": { wishId: string; offerId: string };
  "autonomy.change": { area: Area; from: string; to: string }; // Profile → Autonomy: levels only
  "autonomy.act": { area: Area; action: "send" | "publish"; ref: string }; // an auto action ORBIT took: prospect / job/clip id only
  "health.issue": { issue: string; status: "new" | "regressed" | "resolved" }; // self-healing (health.ts): the issue id only, never log text
  "dev.session.start": { session: string }; // Roblox dev session log (dev-session.ts): the session id only, never code, paths or console text
  "dev.session.end": { session: string };
  "twin.shown": { kind: string; ref: string; fallback: boolean }; // ORBIT twin (twin.ts): kind and item id only, never the decision or the argument
  "twin.muted": { kind: string; muted: boolean };
  "company.step": { chain: string; role: Role; status: "started" | "done" | "approval" | "failed" }; // agent company (company.ts): chain id and role only, never text
  "screen.look": { message: string }; // "look at my screen" (ScreenLook.tsx): the CORE message id only, never the image or question
  "contract.status": { contractId: string; to: ContractStatus; version: number }; // BUSINESS contracts (contracts.ts): ids only, never parties, prices or text
  "nego.step": { nego: string; intent?: Intent; state: NegoState }; // negotiator (negotiator.ts): the negotiation id, intent and state only, never text or prices
  "invoice.status": { invoice: string; to: InvoiceStatus }; // invoices (invoices.ts): the invoice id and status only, never buyers or amounts
  "invoice.reminder": { invoice: string; via: "email" | "copy" | "unknown" };
  "invoice.paylink": { invoice: string; via: "stripe" }; // a Stripe Payment Link made on his click: ids only
  "invoice.paylink_off": { invoice: string; ok: boolean }; // ok false: switching the old link off failed, it may still take a payment
  "focus.start": { focus: string; minutes: number }; // time dilation (focus.ts): the block id and minutes only, never the goal
  "focus.end": { focus: string; minutes: number }; // minutes actually focused
  // Which model ran a CORE turn / agent task (model-log-pure.ts): metadata tokens only, never message text. risky: the job was held to
  // the Opus floor; why: the T2/T3 tool names or "risk:<flag>" hints behind it; down: the model a usage limit stepped it down from.
  "model.run": { kind: "core" | "agent"; job: string; model: string; risky: boolean; why?: string[]; down?: string };
};
export type EventType = keyof Data;
export type LedgerEvent = { [K in EventType]: { id: string; at: string; type: K; planet: string; data: Data[K]; caused_by?: string } }[EventType];

const str = (max: number) => (v: unknown) => typeof v === "string" && v.trim() !== "" && v.length <= max;
const count = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
const bool = (v: unknown) => typeof v === "boolean";
const oneOf = (xs: readonly string[]) => (v: unknown) => xs.includes(v as string);
const opt = (f: (v: unknown) => boolean) => (v: unknown) => v === undefined || f(v);
const id = str(128), name = str(200);
const tok = (v: unknown) => typeof v === "string" && /^[\w.:[\]-]{1,64}$/.test(v); // one token (no spaces): a model id, tool name or job kind, never a sentence

// Each type's data fields and their checks; unknown fields are dropped.
const SHAPES: { [K in EventType]: Record<keyof Data[K], (v: unknown) => boolean> } = {
  "core.turn": { model: id, tools: count, ms: count },
  "tool.call": { tool: id, ok: bool, ms: count },
  "memory.saved": { memoryId: id, kind: id },
  "clip.published": { clipId: id, title: opt(name) },
  "clip.outcome48h": { clipId: id, views: count, likes: count },
  "clip.postmortem": { clipId: id, drops: count, hold3s: opt((v) => typeof v === "number" && v >= 0 && v <= 10) },
  "business.stage": { prospect: name, to: oneOf(STAGES) },
  "goal.step": { goalId: id, step: name, status: oneOf(["started", "done", "failed"]), goalDone: opt(bool) },
  "life.habit": { habit: name, done: bool },
  "focus.session": { minutes: (v) => typeof v === "number" && v > 0 && v <= 1440 },
  "notify.shown": { kind: id, title: name },
  "morning.thumb": { kind: oneOf(CARD_KINDS), key: id, up: bool },
  "policy.decision": { tool: id, tier: oneOf(["T0", "T1", "T2", "T3"]), verdict: oneOf(["allow", "refuse"]), reason: str(300), turn: opt(id) },
  "morning.click": { source: oneOf([...SOURCES, "markets"]), key: id },
  "morning.done": { source: oneOf([...SOURCES, "markets"]), key: id },
  "journal.saved": { memoryId: id },
  "remote.command": { command: oneOf(["navigate", "core.ask", "approval.list", "approve", "reject", "stopAll", "status", "invalid", "shortcut.status", "shortcut.call", "shortcut.stop", "shortcut.approve", "shortcut.ask", "habit.done", "brief", "night"]), ok: bool, device: id }, // shortcut.*: Shortcuts & Watch, device "shortcut:<id>"
  "higgsfield.spend": { jobId: id, credits: (v) => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 100_000, kind: oneOf(["story", "draft"]) },
  "memory.hygiene": { action: oneOf(["merge", "retract"]), decision: oneOf(["accepted", "dismissed"]), key: id },
  "night.start": { night: id },
  "night.task": { night: id, kind: oneOf([...NIGHT_KINDS, "dream"]), ref: id, status: oneOf(ITEM_STATUSES) },
  "night.end": { night: id, done: count, approvals: count, failed: count, calls: count, minutes: count },
  "lesson.kept": { id },
  "lesson.rejected": { id },
  "brief.shown": { day: id, items: (v) => Array.isArray(v) && v.length <= 6 && v.every(id), spoken: bool },
  "deal.wish": { wishId: id, action: oneOf(["added", "removed", "done"]) },
  "deal.hunt": { wishId: id, offers: count, great: count },
  "deal.found": { wishId: id, offerId: id },
  "autonomy.change": { area: oneOf(AREAS), from: oneOf(LEVELS), to: oneOf(LEVELS) },
  "autonomy.act": { area: oneOf(AREAS), action: oneOf(["send", "publish"]), ref: id },
  "health.issue": { issue: id, status: oneOf(["new", "regressed", "resolved"]) },
  "dev.session.start": { session: id },
  "dev.session.end": { session: id },
  "twin.shown": { kind: id, ref: id, fallback: bool },
  "twin.muted": { kind: id, muted: bool },
  "screen.look": { message: id },
  "contract.status": { contractId: id, to: oneOf(CONTRACT_STATUSES), version: (v) => Number.isInteger(v) && (v as number) >= 1 },
  "nego.step": { nego: id, intent: opt(oneOf(INTENTS)), state: oneOf(NEGO_STATES) },
  "company.step": { chain: id, role: oneOf(ROLES), status: oneOf(["started", "done", "approval", "failed"]) },
  "invoice.status": { invoice: id, to: oneOf(INVOICE_STATUSES) },
  "invoice.reminder": { invoice: id, via: oneOf(["email", "copy", "unknown"]) },
  "invoice.paylink": { invoice: id, via: oneOf(["stripe"]) },
  "invoice.paylink_off": { invoice: id, ok: bool },
  "focus.start": { focus: id, minutes: (v) => count(v) && (v as number) <= 1440 },
  "model.run": { kind: oneOf(["core", "agent"]), job: tok, model: tok, risky: bool, why: opt((v) => Array.isArray(v) && v.length <= 8 && v.every(tok)), down: opt(tok) },
  "focus.end": { focus: id, minutes: (v) => count(v) && (v as number) <= 1440 },
};
export const EVENT_TYPES = Object.keys(SHAPES) as EventType[];
// "markets" still tags deal events and old rows keep "theater"/"markets": the planets are gone, the history stays valid.
export const LEDGER_PLANETS = [...PLANETS.map((p) => p.id), "core", "markets", "theater"];

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
  recent: Record<string, number>; // events per ledger planet in the 7 days up to t
  today: Record<string, number>; // … and in the 24 h up to t ("new today" in the galaxy)
};
export const RECENT_MS = 7 * 86_400_000;

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
    recent: Object.fromEntries(LEDGER_PLANETS.map((k) => [k, 0])), today: Object.fromEntries(LEDGER_PLANETS.map((k) => [k, 0])),
  };
  const stage = new Map<string, Stage>(), goals = new Map<string, boolean>();
  for (const e of live) { // sorted oldest first, so later events win
    s.counts[e.type]++;
    if (isoMs(e.at) > tm - RECENT_MS) s.recent[e.planet]++;
    if (isoMs(e.at) > tm - 86_400_000) s.today[e.planet]++;
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
