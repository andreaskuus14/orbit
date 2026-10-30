// BUSINESS outreach scorecard: reply rate per angle and per segment (business type), with sample sizes, a simple significance
// hint and the next angle to try. Pure; tested in tests/outreach-score.test.ts. Sending stays the owner's own click.
import { TEMPLATES, type Stage, type Template } from "./business-pure.ts";

export type Sig = "few" | "better" | "worse" | "same";
export type Cell = { key: string; sent: number; replied: number; rate: number; low: number; high: number; sig: Sig };
type Row = { stage: Stage; template?: string | null; kind?: string };

export const MIN_N = 5; // below this per group the hint says "too few to tell"
const REPLIED: readonly Stage[] = ["replied", "pilot", "paying"];
const pct = (x: number) => Math.round(x * 100);

/** 95 % Wilson interval for k replies out of n, in %. */
export function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 100];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [pct(Math.max(0, (c - r) / d)), pct(Math.min(1, (c + r) / d))];
}

/** Two-proportion z-test of a group against everyone else: "better"/"worse" at p < 0.05, "same" otherwise, "few" when either side is small. */
export function compare(k1: number, n1: number, k2: number, n2: number): Sig {
  if (n1 < MIN_N || n2 < MIN_N) return "few";
  const p = (k1 + k2) / (n1 + n2), se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!se) return "same";
  const z = (k1 / n1 - k2 / n2) / se;
  return z > 1.96 ? "better" : z < -1.96 ? "worse" : "same";
}

function cells(rows: { key: string; replied: boolean }[], keys: string[]): Cell[] {
  const total = rows.length, totalK = rows.filter((r) => r.replied).length;
  return keys.map((key) => {
    const mine = rows.filter((r) => r.key === key), k = mine.filter((r) => r.replied).length, n = mine.length;
    const [low, high] = wilson(k, n);
    return { key, sent: n, replied: k, rate: n ? pct(k / n) : 0, low, high, sig: compare(k, n, totalK - k, total - n) };
  });
}

/** Sent = moved past "To contact" (lost counts as sent, not replied); replied = replied, pilot or paying. Untagged drafts count for segments only. */
export function scorecard(ps: Row[]): { angles: Cell[]; segments: Cell[]; next: { angle: Template; why: string } | null } {
  const sent = ps.filter((p) => p.stage !== "lead");
  const tagged = sent.filter((p) => (TEMPLATES as readonly unknown[]).includes(p.template)).map((p) => ({ key: p.template as string, replied: REPLIED.includes(p.stage) }));
  const seg = sent.map((p) => ({ key: (p.kind ?? "").trim().toLowerCase().slice(0, 40) || "unknown", replied: REPLIED.includes(p.stage) }));
  const segKeys = [...new Set(seg.map((s) => s.key))].sort((a, b) => seg.filter((s) => s.key === b).length - seg.filter((s) => s.key === a).length).slice(0, 8);
  const angles = cells(tagged, [...TEMPLATES]);
  return { angles, segments: cells(seg, segKeys), next: nextAngle(angles) };
}

/** Explore first (the least-tried angle until each has MIN_N sends), then the angle whose upper bound is highest (it could still be the best). */
export function nextAngle(angles: Cell[]): { angle: Template; why: string } | null {
  if (!angles.length) return null;
  const thin = [...angles].sort((a, b) => a.sent - b.sent)[0];
  if (thin.sent < MIN_N) return { angle: thin.key as Template, why: `only ${thin.sent} sent with this angle: send ${MIN_N - thin.sent} more to learn if it works` };
  const best = [...angles].sort((a, b) => b.high - a.high || b.rate - a.rate)[0];
  return { angle: best.key as Template, why: best.sig === "better" ? `${best.rate}% reply rate, clearly ahead of the others: keep using it`
    : `${best.rate}% so far (${best.replied}/${best.sent}); it could be as high as ${best.high}%, so it's the best bet to test next` };
}

export const SIG_LABEL: Record<Sig, string> = { few: "too few to tell", better: "likely better (p<0.05)", worse: "likely worse (p<0.05)", same: "could be chance" };

// ---- Conversion learning (BUS08): every step of the funnel with its sample size and window, why deals were lost or
// stalled, and one next experiment aimed at the weakest step. Built from the stages, timeline and lost reasons he logged.

const ORDER = ["lead", "contacted", "replied", "pilot", "paying"] as const;
const DAY = 86_400_000;
type Ev = { at: string; kind: string; text?: string };
export type LRow = Row & { id: string; name: string; updated_at: string; crm?: { events: Ev[]; lost?: { reason: string } }; touch?: { last: string } | null };
/** Days without real contact after which an open deal counts as stalled (and as decided, not won, in conversion). */
export const STALL_DAYS: Record<"contacted" | "replied" | "pilot", number> = { contacted: 14, replied: 10, pilot: 30 };
export const WINDOWS = [30, 90, 0] as const; // days; 0 = all time

/** How far it got: its stage, or the furthest stage in its timeline (a lost business keeps that; lost counts as at least sent). */
export function reached(p: LRow): number {
  const ev = p.crm?.events ?? [];
  const r = Math.max(ORDER.indexOf(p.stage as (typeof ORDER)[number]), ...ev.map((e) => (e.kind === "stage" ? ORDER.indexOf(e.text as (typeof ORDER)[number]) : e.kind === "reply" ? 2 : e.kind === "sent" ? 1 : -1)));
  return p.stage === "lost" ? Math.max(1, r) : r;
}
/** When the first message went out: the first logged send, else the last update of a business past "To contact". */
export const sentAt = (p: LRow) => p.crm?.events.find((e) => e.kind === "sent")?.at ?? (p.stage !== "lead" ? p.updated_at : null);
export const windowed = (ps: LRow[], days: number, now: number) => (days ? ps.filter((p) => { const a = sentAt(p); return !!a && now - Date.parse(a) <= days * DAY; }) : ps);

export type Stall = { id: string; name: string; stage: keyof typeof STALL_DAYS; days: number };
export function stalled(ps: LRow[], now: number): Stall[] {
  return ps.flatMap((p) => {
    if (!(p.stage in STALL_DAYS)) return [];
    const days = Math.floor((now - Date.parse(p.touch?.last ?? p.updated_at)) / DAY), stage = p.stage as Stall["stage"];
    return days >= STALL_DAYS[stage] ? [{ id: p.id, name: p.name, stage, days }] : [];
  }).sort((a, b) => b.days - a.days);
}

export type Step = { from: string; to: string; n: number; k: number; rate: number; low: number; high: number; open: number };
/** Each step: of those that reached `from` and are decided (moved on, lost, or stalled), how many reached `to`. Still-open ones are counted apart. */
export function conversion(ps: LRow[], now: number): Step[] {
  const stuck = new Set(stalled(ps, now).map((s) => s.id));
  return ([[1, 2], [2, 3], [3, 4]] as const).map(([a, b]) => {
    const at = ps.filter((p) => reached(p) >= a), won = at.filter((p) => reached(p) >= b);
    const decided = at.filter((p) => reached(p) >= b || p.stage === "lost" || stuck.has(p.id)), [low, high] = wilson(won.length, decided.length);
    return { from: ORDER[a], to: ORDER[b], n: decided.length, k: won.length, rate: decided.length ? pct(won.length / decided.length) : 0, low, high, open: at.length - decided.length };
  });
}

export type Lost = { reason: string; n: number; after: Record<string, number> };
/** Lost businesses by his reason ("unknown" when he gave none) and the stage they had reached. */
export function lostReasons(ps: LRow[]): Lost[] {
  const m = new Map<string, Lost>();
  for (const p of ps.filter((x) => x.stage === "lost")) {
    const reason = p.crm?.lost?.reason ?? "unknown", l = m.get(reason) ?? { reason, n: 0, after: {} }, st = ORDER[reached(p)];
    l.n++; l.after[st] = (l.after[st] ?? 0) + 1; m.set(reason, l);
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}

/** One experiment for the next MIN_N businesses, aimed at the weakest decided step (lowest rate among steps with MIN_N outcomes).
 *  kind picks the wording (UI strings biz.exp.*): "few" = not enough outcomes yet, "angle" = test a first-message angle,
 *  a lost reason = answer that reason, "stalled" = pilots/replies going quiet, "unknown" = log reasons first. */
export type Experiment = { kind: string; step: Step | null; angle?: Template; why?: string; reason?: string; reasonN?: number; stalledN?: number };
export function nextExperiment(ps: LRow[], now: number): Experiment | null {
  const steps = conversion(ps, now), ok = steps.filter((s) => s.n >= MIN_N);
  const na = nextAngle(scorecard(ps).angles);
  if (!ok.length) return { kind: "few", step: steps[0], ...(na && { angle: na.angle, why: na.why }) };
  const w = [...ok].sort((a, b) => a.rate - b.rate || b.n - a.n)[0];
  if (w.from === "contacted") return na ? { kind: "angle", step: w, angle: na.angle, why: na.why } : null;
  const top = lostReasons(ps).map((l) => ({ reason: l.reason, n: l.after[w.from] ?? 0 })).filter((l) => l.n).sort((a, b) => b.n - a.n)[0];
  const stalledN = stalled(ps, now).filter((s) => s.stage === w.from).length;
  if (top && top.reason !== "unknown") return { kind: top.reason, step: w, reason: top.reason, reasonN: top.n, stalledN };
  return stalledN ? { kind: "stalled", step: w, stalledN } : { kind: "unknown", step: w, reasonN: top?.n ?? 0 };
}
