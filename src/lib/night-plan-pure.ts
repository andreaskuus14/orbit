// Night shift 2.0 (roadmap 8 · 4.1, pure, tested in tests/night-plan.test.ts). IO: night-plan.ts; runner: night.ts; UI: NightShift.tsx.
// 1. planTonight: scores the candidates planNight already builds (so only kinds the night supports, with the same caps, Autonomy "off"
//    and learned drops) from open loops, deadlines, due standing rules and his queued asks, then fits them to the night budget.
//    Each pick carries one "why tonight" reason (an i18n key + vars). Deterministic: same input, same plan.
// 2. Morning diff: per item, the counts that changed while it ran (before → after), and one line for the brief.
import { planNight, type NightItem, type NightKind, type NightSettings, type NightTask, type PlanInput } from "./night-pure.ts";
import type { Loop } from "./loops-pure.ts";
import { nextRun, type Rule } from "./rules-pure.ts";
import { translate, type Key, type Lang } from "./i18n-pure.ts";

const DAY = 86_400_000;
export type Why = { k: string; v?: Record<string, string | number> }; // k: nightplan.why.<k>
export type NightPick = NightTask & { score: number; why: Why };
export type Signals = {
  loops: Pick<Loop, "key" | "kind" | "since">[]; // open loops from the last scan (closed/snoozed already dropped)
  rules: Pick<Rule, "name" | "status" | "action" | "trigger">[];
};

// Upkeep that costs (almost) nothing and planNight already keeps first; his own asks come right after.
const HOUSE: NightKind[] = ["backup", "hygiene", "loops", "health", "dream"];
const days = (from: string, to: number) => Math.max(0, Math.floor((to - Date.parse(from)) / DAY)) || 0; // unreadable date → 0

/** Every scoring component for one candidate; the biggest one is its "why tonight". */
function parts(t: NightTask, i: PlanInput, sig: Signals): [number, Why][] {
  if (HOUSE.includes(t.kind)) return [[1000, { k: "house" }]];
  if (t.kind === "research") {
    const ask = i.tonight.find((x) => x.id === t.ref), d = ask ? days(ask.at, i.now) : 0;
    return [[500 + 5 * Math.min(d, 14), d ? { k: "askOld", v: { d } } : { k: "ask" }]];
  }
  const out: [number, Why][] = [[20, { k: "due" }]];
  const boost = i.boost?.[t.kind] ?? 1;
  if (boost === Infinity) out.push([400, { k: "pinned" }]);
  else out.push([Math.round(30 * (Math.min(boost, 2) - 1)), { k: "learned" }]); // faded kinds (boost < 1) lose up to 30
  const loop = (kind: Loop["kind"], id: string) => sig.loops.find((l) => l.kind === kind && l.key.startsWith(`${kind}:${id}:`));
  if (t.kind === "goal") {
    const l = loop("goal", t.ref);
    if (l) { const d = days(l.since, i.now); out.push([100 + 2 * Math.min(d, 30), { k: "stalled", v: { d } }]); }
    const dl = i.goals.find((g) => g.id === t.ref)?.doc.deadline;
    const left = dl ? Math.round((Date.parse(dl) - Date.parse(i.today)) / DAY) : NaN;
    if (left >= 0 && left <= 7) out.push([80 + 5 * (7 - left), { k: "deadline", v: { d: left } }]);
  }
  if (t.kind === "business") {
    const l = loop("prospect", t.ref);
    if (l) { const d = days(l.since, i.now); out.push([50 + Math.min(d, 30), { k: "noReply", v: { d } }]); }
  }
  if (t.kind === "deals") { // a standing "check deals" rule firing within the next day: have tonight's hunt ready for it
    const r = sig.rules.find((r) => r.status === "active" && r.action.kind === "orbit" && r.action.id === "deals" && r.trigger.type === "schedule"
      && (nextRun(r.trigger.schedule, new Date(i.now))?.getTime() ?? Infinity) - i.now <= DAY);
    if (r) out.push([60, { k: "rule", v: { name: r.name.slice(0, 60) } }]);
  }
  return out;
}

/** Tonight's queue: planNight's candidates scored, highest first (ties keep planNight's order), greedily fitted to the calls + minutes left. */
export function planTonight(i: PlanInput, s: NightSettings, used: { calls: number; ms: number }, sig: Signals): { queue: NightPick[]; deferred: number } {
  const all = planNight(i, { ...s, maxCalls: Infinity, maxMinutes: Infinity }, { calls: 0, ms: 0 }).queue;
  const scored = all.map((t, k) => {
    const p = parts(t, i, sig), top = p.reduce((a, b) => (b[0] > a[0] ? b : a));
    return { t: { ...t, score: p.reduce((n, x) => n + x[0], 0) - t.calls, why: top[1] }, k };
  }).sort((a, b) => b.t.score - a.t.score || a.k - b.k);
  const queue: NightPick[] = [];
  let calls = used.calls, min = used.ms / 60_000, deferred = 0;
  for (const { t } of scored) {
    if (calls + t.calls > s.maxCalls || min + t.minutes > s.maxMinutes) { deferred++; continue; }
    queue.push(t); calls += t.calls; min += t.minutes;
  }
  return { queue, deferred };
}

export const whyText = (w: Why, lang: Lang = "en") => translate(lang, `nightplan.why.${w.k}` as Key, w.v);

// ---- Morning diff ---------------------------------------------------------------

export const SNAP_KEYS = ["drafts", "tasks", "steps", "memories", "loops"] as const;
export type SnapKey = (typeof SNAP_KEYS)[number];
/** drafts: tasks waiting for his approval; tasks: done tasks; steps: done goal steps; memories: non-journal memories; loops: open loops. */
export type Snap = Record<SnapKey, number>;
export type Diff = Partial<Record<SnapKey, [number, number]>>; // before → after, changed keys only

/** What changed while one item ran; a business follow-up draft lives only in the report, so it counts as one more draft. */
export function snapDiff(a: Snap, b: Snap, item?: Pick<NightItem, "draft">): Diff | undefined {
  const d: Diff = {};
  for (const k of SNAP_KEYS) {
    const after = b[k] + (k === "drafts" && item?.draft ? 1 : 0);
    if (Number.isFinite(a[k]) && Number.isFinite(after) && a[k] !== after) d[k] = [a[k], after];
  }
  return Object.keys(d).length ? d : undefined;
}

/** "open loops 5 → 4 · drafts waiting 1 → 2" (card, under each item). */
export const diffText = (d: Diff | undefined, lang: Lang = "en") =>
  SNAP_KEYS.filter((k) => d?.[k]).map((k) => `${translate(lang, `nightplan.k.${k}` as Key)} ${d![k]![0]} → ${d![k]![1]}`).join(" · ");

/** The whole night before → after: each key from the first item that changed it to the last. */
export function nightDiff(items: Pick<NightItem, "diff" | "at">[]): Diff | undefined {
  const d: Diff = {};
  for (const i of [...items].sort((a, b) => a.at.localeCompare(b.at)))
    for (const k of SNAP_KEYS) { const x = i.diff?.[k]; if (x) d[k] = [d[k]?.[0] ?? x[0], x[1]]; }
  for (const k of SNAP_KEYS) if (d[k] && d[k]![0] === d[k]![1]) delete d[k];
  return Object.keys(d).length ? d : undefined;
}

/** One brief / card line, or "" when nothing measurable changed. */
export function nightDiffLine(items: Pick<NightItem, "diff" | "at">[], lang: Lang = "en"): string {
  const t = diffText(nightDiff(items), lang);
  return t ? translate(lang, "nightplan.overnight", { x: t }) : "";
}
