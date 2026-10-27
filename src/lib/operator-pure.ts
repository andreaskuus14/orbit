// Weekly operator report (roadmap B7; pure, tested in tests/operator.test.ts). Sunday evening, beside the weekly review: what ORBIT
// did on its own this week, money/results where the ledger knows them, a conservative time-saved estimate, what failed, and the
// autonomy raises his own decisions point to. Built from ledger events (ids only), autonomy levels and lesson ids/scores: never task
// text, drafts, prospect names, prices or journal data. It only ever SUGGESTS a level; changing one stays his click in Profile → Autonomy.
// Gathering: operator.ts.
import type { LedgerEvent } from "./ledger-pure.ts";
import { AREA_INFO, type Area, type Level, type Levels } from "./autonomy-pure.ts";
import { weekWindow } from "./week-pure.ts";

/** Minutes a person would have spent doing each action by hand. Conservative on purpose (the low end of a realistic range), so
 *  "time saved" understates rather than flatters. Only work that finished (or was prepared up to his approval) counts. */
export const MINUTES_SAVED = {
  "night.research": 20, // an agent research ask answered overnight
  "night.goal": 15, // a goal-plan step run
  "night.business": 8, // a follow-up email drafted (he still reads and sends it)
  "night.clips": 8, // Shorts packaged (titles, description, slot) up to review
  "night.niche": 15, // the weekly niche scout
  "night.hygiene": 3, // memory tidy-up suggestions
  "night.deals": 3, // a wishlist re-check
  "night.health": 5, // the nightly health check
  "night.personas": 20, // a persona playtest of his game plan
  "night.rivals": 15, // checking up to 5 competitor pages per kept niche by hand
  "night.dream": 5, // overnight idea combinations
  "auto.send": 3, // an email sent without his click (auto, with limits)
  "auto.publish": 5, // a Short uploaded without his click
  "deal.hunt": 2, // a shop page checked for a wish
  "health.fix": 10, // a health issue that resolved itself
  "brief.shown": 2, // the morning brief instead of opening each panel
} as const;
export type SavedKey = keyof typeof MINUTES_SAVED;
export const SAVED_LABEL: Record<SavedKey, string> = {
  "night.research": "research asks answered", "night.goal": "goal steps run", "night.business": "follow-up drafts", "night.clips": "Shorts packaged",
  "night.niche": "niche scouts", "night.hygiene": "memory tidy-ups", "night.deals": "deal re-checks", "night.health": "health checks", "night.personas": "persona playtests", "night.dream": "dream sessions", "night.rivals": "competitor checks",
  "auto.send": "emails sent on auto", "auto.publish": "Shorts published on auto", "deal.hunt": "deal hunts", "health.fix": "health issues fixed", "brief.shown": "morning briefs",
};

// "Always approves": at least this many of his decisions in an area, at least this share yes. Lessons: a yes-lesson this confident.
export const APPROVE_MIN = 5, APPROVE_SHARE = 0.9, LESSON_CONFIDENCE = 0.9;
/** Which autonomy area a lesson area is about. Only his own approve/reject decisions map; reply-rate lessons (outreach) don't. */
const LESSON_AREA: [RegExp, Area][] = [[/^clip\.(?!reason)/, "studio-publish"], [/^proposal\./, "goals"], [/^hygiene$/, "memory"], [/^niche$/, "research"]];
export const NEVER_SUGGEST: Area[] = ["higgsfield-spend"]; // spending stays a click, always

export type OpLesson = { id: string; area: string; sign: number; confidence: number; status: string };
export type OpIn = { now: number; weeksAgo?: number; events: LedgerEvent[]; levels: Levels; lessons: OpLesson[] };
export type OpRow = { key: SavedKey; label: string; count: number; minutes: number };
export type OpFail = { what: string; cite: string };
export type OpSuggest = { area: Area; label: string; from: Level; to: Level; why: string; cites: string[] };
export type OperatorReport = {
  from: string; to: string;
  did: OpRow[]; nights: number; approvalsPrepared: number;
  money: { credits: number; spends: number; replies: number; pilots: number; paying: number; lost: number; dealsFound: number; shortsOut: number; views: number; likes: number };
  savedMinutes: number; failed: OpFail[]; suggest: OpSuggest[]; lines: string[]; spoken: string;
};

const ev = (e: LedgerEvent) => `event:${e.type}~${e.id}`;
const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const hrs = (m: number) => (m < 60 ? `${m} minutes` : `${Math.round(m / 6) / 10} hours`);

export function operatorReport(x: OpIn): OperatorReport {
  const w = weekWindow(x.now, x.weeksAgo ?? 0), stop = Math.min(w.end, x.now + 1);
  const evs = x.events.filter((e) => { const t = Date.parse(e.at); return t >= w.start && t < stop; });
  const counts = new Map<SavedKey, number>();
  const bump = (k: SavedKey, by = 1) => counts.set(k, (counts.get(k) ?? 0) + by);
  const failed: OpFail[] = [];
  const money = { credits: 0, spends: 0, replies: 0, pilots: 0, paying: 0, lost: 0, dealsFound: 0, shortsOut: 0, views: 0, likes: 0 };
  let nights = 0, approvalsPrepared = 0;
  const health = new Map<string, LedgerEvent>(); // issue → its latest event this week
  for (const e of evs) {
    switch (e.type) {
      case "night.end": nights++; break;
      case "night.task":
        if ((e.data.status === "done" || e.data.status === "approval") && `night.${e.data.kind}` in MINUTES_SAVED) bump(`night.${e.data.kind}` as SavedKey); // new night kinds count once added to MINUTES_SAVED
        if (e.data.status === "approval") approvalsPrepared++;
        if (e.data.status === "failed") failed.push({ what: `Night shift ${e.data.kind} task failed`, cite: ev(e) });
        break;
      case "autonomy.act": bump(e.data.action === "send" ? "auto.send" : "auto.publish"); break;
      case "deal.hunt": bump("deal.hunt"); break;
      case "deal.found": money.dealsFound++; break;
      case "brief.shown": bump("brief.shown"); break;
      case "health.issue": health.set(e.data.issue, e); break;
      case "higgsfield.spend": money.credits += e.data.credits; money.spends++; break;
      case "business.stage":
        if (e.data.to === "replied") money.replies++; else if (e.data.to === "pilot") money.pilots++; else if (e.data.to === "paying") money.paying++; else if (e.data.to === "lost") money.lost++;
        break;
      case "clip.published": money.shortsOut++; break;
      case "clip.outcome48h": money.views += e.data.views; money.likes += e.data.likes; break;
    }
  }
  for (const [issue, e] of health) {
    if (e.type !== "health.issue") continue;
    if (e.data.status === "resolved") bump("health.fix");
    else failed.push({ what: `Health issue still open (${issue.slice(0, 40)}, ${e.data.status})`, cite: ev(e) });
  }
  money.credits = Math.round(money.credits * 100) / 100;
  const did = (Object.keys(MINUTES_SAVED) as SavedKey[]).flatMap((key) => {
    const count = counts.get(key) ?? 0;
    return count ? [{ key, label: SAVED_LABEL[key], count, minutes: count * MINUTES_SAVED[key] }] : [];
  }).sort((a, b) => b.minutes - a.minutes);
  const savedMinutes = did.reduce((a, r) => a + r.minutes, 0);
  const suggest = suggestRaises(x);

  const m = money, lines = [
    did.length ? `On its own: ${did.slice(0, 4).map((r) => `${r.label} ${r.count}`).join(", ")}${nights ? ` over ${n(nights, "night")}` : ""}.` : "ORBIT didn't do anything on its own this week.",
    approvalsPrepared ? `${n(approvalsPrepared, "thing")} prepared up to your approval.` : "",
    `Results: ${[m.shortsOut && n(m.shortsOut, "Short") + " out", m.views && `${m.views.toLocaleString("en")} views in 48 h`, m.replies && n(m.replies, "business reply", "business replies"),
      m.pilots && n(m.pilots, "pilot"), m.paying && `${m.paying} paying`, m.dealsFound && n(m.dealsFound, "deal") + " found"].filter(Boolean).join(", ") || "nothing measurable yet"}.`,
    m.credits ? `Spent ${m.credits.toLocaleString("en")} Higgsfield credits on ${n(m.spends, "generation")}, each one your click.` : "",
    savedMinutes ? `Time saved: about ${hrs(savedMinutes)} (conservative).` : "",
    failed.length ? `${n(failed.length, "thing")} failed or still open.` : "Nothing failed.",
  ].filter(Boolean);
  const spoken = [
    `Operator report.`,
    did.length ? `This week I handled ${did.reduce((a, r) => a + r.count, 0)} things on my own, which saved you about ${hrs(savedMinutes)}.` : "I didn't do much on my own this week.",
    m.replies || m.pilots || m.paying ? `Business: ${[m.replies && n(m.replies, "reply", "replies"), m.pilots && n(m.pilots, "pilot"), m.paying && `${m.paying} paying`].filter(Boolean).join(", ")}.` : "",
    m.credits ? `You spent ${Math.round(m.credits)} Higgsfield credits.` : "",
    failed.length ? `${n(failed.length, "thing")} failed, it's on the card.` : "",
    suggest[0] ? `You nearly always approve ${suggest[0].label.toLowerCase().replace(":", "")}, want to raise it to ${LEVEL_WORD[suggest[0].to]}? Your call, in Profile, Autonomy.` : "",
  ].filter(Boolean).join(" ");
  return { from: w.from, to: w.to, did, nights, approvalsPrepared, money, savedMinutes, failed: failed.slice(0, 8), suggest, lines, spoken };
}

const LEVEL_WORD: Record<Level, string> = { off: "off", ask: "ask", do: "do and report", auto: "auto with limits" };

/** Areas where his decisions are nearly always yes, below their highest allowed level: the next level up, with the evidence ids. */
export function suggestRaises(x: Pick<OpIn, "now" | "events" | "levels" | "lessons">): OpSuggest[] {
  const ev90 = x.events.filter((e) => { const t = Date.parse(e.at); return t <= x.now && x.now - t <= 90 * 86_400_000; });
  const out = new Map<Area, OpSuggest>();
  const offer = (area: Area, why: string, cites: string[]) => {
    const levels = AREA_INFO[area].levels, from = x.levels[area] ?? AREA_INFO[area].def, i = levels.indexOf(from);
    if (NEVER_SUGGEST.includes(area) || from === "off" || i < 0 || i === levels.length - 1 || out.has(area)) return; // off = he turned it off on purpose
    const to = levels[i + 1]; // AREA_INFO lists levels lowest first
    out.set(area, { area, label: AREA_INFO[area].label, from, to, why, cites: cites.slice(0, 8) });
  };
  // memory hygiene: his accept/dismiss answers (last 90 days)
  const hy = ev90.filter((e) => e.type === "memory.hygiene");
  const yes = hy.filter((e) => e.type === "memory.hygiene" && e.data.decision === "accepted");
  if (hy.length >= APPROVE_MIN && yes.length / hy.length >= APPROVE_SHARE) offer("memory", `You accepted ${yes.length} of ${hy.length} memory tidy-up suggestions`, yes.map(ev));
  // lessons he kept (or the miner proposes) that say he approves
  for (const l of [...x.lessons].sort((a, b) => b.confidence - a.confidence)) {
    if (l.sign !== 1 || l.confidence < LESSON_CONFIDENCE || l.status === "rejected") continue;
    const area = LESSON_AREA.find(([re]) => re.test(l.area))?.[1];
    if (area) offer(area, `A ${l.status} lesson: you approve these ${Math.round(l.confidence * 100)}% of the time`, [`lesson:${l.id}`]);
  }
  return [...out.values()];
}
