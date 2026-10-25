// Autonomy levels (pure, tested in tests/autonomy.test.ts). IO: autonomy.ts; API: /api/autonomy; UI: Profile → Autonomy.
// Per area, how much ORBIT may do on its own. The defaults reproduce ORBIT's behaviour before this file existed exactly:
// nothing is sent, published or spent without the owner's click (AGENTS.md rule 6). "auto" exists only for business-send and
// studio-publish, is never a default, and needs a typed confirmation; it then runs under a daily cap, a content check, a
// 10-minute cancel window, Stop-all and a push after each action. higgsfield-spend can never be auto.
import { localClock, type NightKind } from "./night-pure.ts";
import type { PushMessage } from "./remote-push-pure.ts";

export const AREAS = ["research", "brief", "memory", "studio-prepare", "studio-publish", "business-drafts", "business-send", "higgsfield-spend", "goals", "night-shift", "deals", "calls"] as const;
export type Area = (typeof AREAS)[number];
export const LEVELS = ["off", "ask", "do", "auto"] as const;
export type Level = (typeof LEVELS)[number];
export type Levels = Record<Area, Level>;

// levels: what the area may be set to. def: today's behaviour (unattended work that already ran on its own = "do", outside effects = "ask").
export const AREA_INFO: Record<Area, { label: string; levels: readonly Level[]; def: Level; what: string }> = {
  research: { label: "Research", levels: ["off", "ask", "do"], def: "do", what: "Agents researching your night-shift asks and the weekly BUSINESS niche scout" },
  brief: { label: "Morning brief", levels: ["off", "do"], def: "do", what: "The spoken \"Good morning\" overlay on the PC and the morning call's opener" },
  memory: { label: "Memory tidy-up", levels: ["off", "ask", "do"], def: "do", what: "Nightly memory consolidation and merge/retract suggestions (applied only when you accept them)" },
  "studio-prepare": { label: "Studio: prepare", levels: ["off", "ask", "do"], def: "do", what: "Packaging Shorts (titles, descriptions, slots) and clip scouting up to your review" },
  "studio-publish": { label: "Studio: publish", levels: ["off", "ask", "auto"], def: "ask", what: "Uploading Shorts to YouTube" },
  "business-drafts": { label: "BUSINESS drafts", levels: ["off", "ask", "do"], def: "do", what: "Overnight follow-up drafts for you to read (never sent)" },
  "business-send": { label: "BUSINESS email", levels: ["off", "ask", "auto"], def: "ask", what: "Sending emails to your BUSINESS prospects" },
  "higgsfield-spend": { label: "Higgsfield credits", levels: ["off", "ask"], def: "ask", what: "Spending Higgsfield credits on images and videos" },
  goals: { label: "Goals", levels: ["off", "ask", "do"], def: "do", what: "Running the next step of goal plans you approved" },
  "night-shift": { label: "Night shift", levels: ["off", "do"], def: "do", what: "The whole night shift run while you sleep" },
  deals: { label: "Deal hunter", levels: ["off", "ask", "do"], def: "do", what: "Checking public shop pages for your wishlist" },
  calls: { label: "Calls", levels: ["off", "do"], def: "do", what: "Ringing your phone when something needs you" },
};
export const LEVEL_TEXT: Record<Level, { label: string; means: string }> = {
  off: { label: "Off", means: "ORBIT never does this, not even when you ask." },
  ask: { label: "Ask", means: "Only when you ask or click: nothing happens on its own." },
  do: { label: "Do & report", means: "ORBIT does it on its own and tells you (night report, push). Nothing leaves ORBIT without your click." },
  auto: { label: "Auto with limits", means: "ORBIT acts without your click: daily cap, no prices/payments/contracts/promises, 10 minutes to cancel, a push after each one, Stop-all pauses it." },
};
export const DEFAULT_LEVELS = Object.fromEntries(AREAS.map((a) => [a, AREA_INFO[a].def])) as Levels;
/** Typed confirmation the owner must enter to switch an area to auto (server-checked). */
export const AUTO_CONFIRM: Partial<Record<Area, string>> = { "business-send": "SEND EMAIL WITHOUT ME", "studio-publish": "PUBLISH WITHOUT ME" };
export type AutoArea = "business-send" | "studio-publish";

export type Limits = { sendPerDay: number; publishPerDay: number };
export const LIMIT_DEFAULTS: Limits = { sendPerDay: 3, publishPerDay: 1 };
export const LIMIT_MAX: Limits = { sendPerDay: 20, publishPerDay: 5 };
export const UNDO_MS = 10 * 60_000;
export const TZ = "Europe/Tallinn";
export const DONE_KEEP_MS = 8 * 86_400_000;

// dueAt "": held by quiet hours; its cancel window (and the push) starts at 08:00.
export type Pending = { id: string; area: AutoArea; ref: string; seen: string; label: string; at: string; dueAt: string };
export type DoneAuto = { area: AutoArea; ref: string; at: string };
export type AutonomyState = { levels: Levels; limits: Limits; pending: Pending[]; done: DoneAuto[] };
export const autonomyDefaults = (): AutonomyState => ({ levels: { ...DEFAULT_LEVELS }, limits: { ...LIMIT_DEFAULTS }, pending: [], done: [] });

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const isArea = (a: unknown): a is Area => AREAS.includes(a as Area);
const levelOf = (levels: Partial<Levels> | undefined, a: Area): Level => {
  const l = levels?.[a];
  return l && AREA_INFO[a].levels.includes(l) ? l : AREA_INFO[a].def; // a level the area can't have (e.g. higgsfield auto) never counts
};

/** autonomy.json text → state; anything unreadable falls back to the defaults (= today's behaviour). */
export function parseAutonomy(text: string): AutonomyState {
  const s = autonomyDefaults();
  try {
    const j = JSON.parse(text);
    if (!isObj(j)) return s;
    if (isObj(j.levels)) for (const a of AREAS) s.levels[a] = levelOf(j.levels as Partial<Levels>, a);
    if (isObj(j.limits)) { const l = patchLimits(j.limits, s.limits); if (typeof l !== "string") s.limits = l; }
    const str = (v: unknown) => typeof v === "string" && v.length <= 300;
    if (Array.isArray(j.pending)) s.pending = j.pending.filter((p: Record<string, unknown>) => isObj(p) && (p.area === "business-send" || p.area === "studio-publish") && ["id", "ref", "seen", "label", "at", "dueAt"].every((k) => str(p[k]))) as Pending[];
    if (Array.isArray(j.done)) s.done = j.done.filter((d: Record<string, unknown>) => isObj(d) && (d.area === "business-send" || d.area === "studio-publish") && str(d.ref) && str(d.at)) as DoneAuto[];
  } catch { /* defaults */ }
  return s;
}

/** The owner's level change, or why not. Auto needs the exact typed phrase. */
export function setLevel(s: AutonomyState, area: unknown, level: unknown, confirm: unknown): AutonomyState | string {
  if (!isArea(area)) return "Unknown area";
  if (!LEVELS.includes(level as Level) || !AREA_INFO[area].levels.includes(level as Level)) return `${AREA_INFO[area].label} can be: ${AREA_INFO[area].levels.map((l) => LEVEL_TEXT[l].label).join(", ")}`;
  if (level === "auto" && confirm !== AUTO_CONFIRM[area]) return `Type "${AUTO_CONFIRM[area]}" to turn on auto`;
  const next = { ...s, levels: { ...s.levels, [area]: level as Level } };
  if (level !== "auto") next.pending = s.pending.filter((p) => p.area !== area); // leaving auto cancels what was waiting
  return next;
}

export function patchLimits(b: Record<string, unknown>, cur: Limits): Limits | string {
  const l = { ...cur };
  for (const k of ["sendPerDay", "publishPerDay"] as const) {
    if (b[k] === undefined) continue;
    if (!Number.isInteger(b[k]) || (b[k] as number) < 1 || (b[k] as number) > LIMIT_MAX[k]) return `${k} must be a whole number 1-${LIMIT_MAX[k]}`;
    l[k] = b[k] as number;
  }
  return l;
}

// ---- The one check --------------------------------------------------------------

/** owner: the owner asked or clicked. background: ORBIT starts it on its own. auto: ORBIT acts outside without a click. */
export type Action = "owner" | "background" | "auto";
/** levels: current levels (missing = defaults). For auto: doneToday/pending for the cap, text = what would go out, known = the
 *  recipient/target is an existing BUSINESS prospect or ORBIT clip. */
export type AllowCtx = { levels?: Partial<Levels>; stopAll?: boolean; limits?: Limits; doneToday?: number; text?: string; known?: boolean };
export type Verdict = { ok: boolean; why: string };

export function autonomyAllows(area: Area, action: Action, ctx: AllowCtx = {}): Verdict {
  const level = levelOf(ctx.levels, area), name = AREA_INFO[area].label;
  const no = (why: string): Verdict => ({ ok: false, why });
  if (level === "off") return no(`${name} is Off in Profile → Autonomy`);
  if (action === "owner") return { ok: true, why: "" };
  if (ctx.stopAll) return no("Stop-all is on");
  if (action === "background") return level === "do" || level === "auto" ? { ok: true, why: "" } : no(`${name} is set to Ask: only when you ask`);
  if (level !== "auto") return no(`${name} needs your click (Autonomy: ${LEVEL_TEXT[level].label})`);
  const cap = capOf(area as AutoArea, ctx.limits ?? LIMIT_DEFAULTS);
  if ((ctx.doneToday ?? Infinity) >= cap) return no(`Today's auto limit (${cap}) is used up`);
  if (!ctx.known) return no("Only existing BUSINESS prospects / ORBIT's own clips");
  const hit = commitmentIn(ctx.text ?? "");
  if (hit) return no(`Mentions "${hit}": prices, payments, contracts and promises always need you`);
  return { ok: true, why: "" };
}
const capOf = (a: AutoArea, l: Limits) => (a === "business-send" ? l.sendPerDay : l.publishPerDay);

// Prices, money, contracts, commitments: auto-sent text with any of these waits for the owner. Fails closed (false positives just mean "ask").
const COMMIT = /[€$£¥]|\b\d[\d.,]*\s?(?:eur|euros?|usd|dollars?|gbp|pounds?|k|%)(?![a-z])|%|\b(?:prices?|priced|pricing|costs?|fees?|rates?|quotes?|quoted|invoices?|pay|paid|paying|payments?|deposit|discounts?|budget|contracts?|agreements?|sign|signed|terms|guarantee[sd]?|warrant(?:y|ies)?|commit(?:ment|ted|s)?|promise[sd]?|deadline|refunds?|purchase|subscription|we'll|we will|i'll|i will)\b/i;
/** The first price/payment/contract/commitment word in text, or "". */
export const commitmentIn = (text: string) => COMMIT.exec(text)?.[0] ?? "";

// ---- Night shift / auto queue ------------------------------------------------------

export const NIGHT_AREA: Record<NightKind, Area> = { research: "research", niche: "research", goal: "goals", business: "business-drafts", clips: "studio-prepare", hygiene: "memory", deals: "deals" };
/** Night kinds the current levels don't allow unattended (empty with the defaults). */
export const nightOff = (levels?: Partial<Levels>): NightKind[] =>
  (Object.keys(NIGHT_AREA) as NightKind[]).filter((k) => !autonomyAllows(NIGHT_AREA[k], "background", { levels }).ok);

/** Auto actions of `area` on the local (Tallinn) day of `now`. */
export const doneToday = (s: AutonomyState, area: AutoArea, now: number) => {
  const day = localClock(now, TZ).day;
  return s.done.filter((d) => d.area === area && localClock(Date.parse(d.at), TZ).day === day).length;
};

export type Candidate = { ref: string; seen: string; label: string; text?: string };
/** Which candidates to queue now (each goes out UNDO_MS later unless cancelled). Pending ones count toward the cap. */
export function pickAuto(s: AutonomyState, area: AutoArea, cands: Candidate[], now: number, stopAll: boolean): Candidate[] {
  const seenRefs = new Set([...s.pending, ...s.done].filter((x) => x.area === area).map((x) => x.ref));
  let used = doneToday(s, area, now) + s.pending.filter((p) => p.area === area).length;
  const out: Candidate[] = [];
  for (const c of cands) {
    if (seenRefs.has(c.ref)) continue; // once per prospect / clip
    if (!autonomyAllows(area, "auto", { levels: s.levels, stopAll, limits: s.limits, doneToday: used, text: c.text, known: true }).ok) continue;
    out.push(c); used++;
  }
  return out;
}

/** Quiet hours 23:00-08:00 Tallinn (same as phone pushes): no auto action goes out, and no cancel window runs while he sleeps. */
export const quietAuto = (now: number) => { const m = localClock(now, TZ).min; return m >= 23 * 60 || m < 8 * 60; };

/** Each tick: in quiet hours every queued action is held (dueAt ""); after them, held ones get a fresh UNDO_MS window
 *  (`opened`, to push about) and those whose window has passed are `due`. */
export function autoClock(pending: Pending[], now: number): { pending: Pending[]; opened: Partial<Record<AutoArea, number>>; due: Pending[] } {
  if (quietAuto(now)) return { pending: pending.map((p) => ({ ...p, dueAt: "" })), opened: {}, due: [] };
  const opened: Partial<Record<AutoArea, number>> = {}, dueAt = new Date(now + UNDO_MS).toISOString();
  const next = pending.map((p) => (p.dueAt ? p : (opened[p.area] = (opened[p.area] ?? 0) + 1, { ...p, dueAt })));
  return { pending: next, opened, due: next.filter((p) => Date.parse(p.dueAt) <= now) };
}

/** The label-only push for an auto action (never names, addresses or text). */
export function autoPush(area: AutoArea, phase: "queued" | "done", n = 1): PushMessage {
  const what = area === "business-send" ? (n > 1 ? `${n} emails` : "an email") : (n > 1 ? `${n} Shorts` : "a Short");
  return phase === "queued"
    ? { title: `ORBIT will ${area === "business-send" ? "send" : "publish"} ${what} in ${UNDO_MS / 60_000} min`, body: "Cancel in Profile → Autonomy, or Stop-all.", url: "/remote#r-stop", tag: "auto" }
    : { title: `ORBIT ${area === "business-send" ? "sent" : "scheduled"} ${what}`, body: "Auto with limits. See Profile → Autonomy.", url: "/remote#r-queue", tag: "auto" };
}
