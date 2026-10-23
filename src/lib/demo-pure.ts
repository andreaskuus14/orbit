// Offline public-demo fixtures only. No route wiring, owner data, clock, network or global random state.
import { layout, type MapItem } from "./memory-map-pure.ts";
import { hotspots } from "./geo.ts";
import { funnel, STAGES, type Prospect } from "./business-pure.ts";
import { last7, streak, type Habit, type LifeState } from "./life-pure.ts";
import { stateAt, isoMs, type LedgerEvent } from "./ledger-pure.ts";
import { insights, syncRecords, type LearnState } from "./clips/learn-pure.ts";
import type { ClipJob } from "./clips/types";
import type { Goal } from "./goals-pure.ts";
import { progress, runsLeft } from "./goals-pure.ts";
import { NOTE, STRATEGIES, valueHoldings } from "./markets-pure.ts";
import { starterScene } from "./arch-pure.ts";
import { usageSummary } from "./analytics-usage-pure.ts";

export const DEMO_NOW = "2026-10-23T12:00:00.000Z";
export const DEMO_SEED = 73129;
const DAY = 86_400_000;
const time = (day: number) => new Date(Date.parse(DEMO_NOW) - (179 - day) * DAY).toISOString();
const date = (day: number) => time(day).slice(0, 10);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const series = <T>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));
const names = ["Velquori", "Nimbrelune", "Zefravel", "Orvithra", "Quenlori", "Thalvexa"];
type Query = URLSearchParams | Readonly<Record<string, string | number | boolean | undefined>>;

/** Each call owns its seed: endpoint order and caller mutations cannot change another response.
 * query.seed selects another repeatable universe; dates stay fixed at DEMO_NOW.
 * Unknown endpoints return undefined. Query values override an endpoint's embedded search string.
 */
export function demoFor(endpoint: string, query: Query = {}): unknown {
  const [path, search = ""] = endpoint.split("?"), q = new URLSearchParams(search);
  for (const [k, v] of query instanceof URLSearchParams ? query : Object.entries(query)) if (v !== undefined) q.set(k, String(v));
  let seed = Number(q.get("seed") ?? DEMO_SEED);
  seed = Number.isFinite(seed) ? seed >>> 0 : DEMO_SEED;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const memories = series(36, (i) => ({ id: uuid(i + 1), kind: ["note", "idea", "research", "decision"][i % 4],
    title: `${names[i % 6]} notebook ${i + 1}`, content: `Experiment ${i + 1}: smaller daily steps made the lantern garden easier to finish.`,
    tags: [["garden", "craft", "learning"][i % 3]], folder: "Lantern garden", source: "capture", url: null,
    created_at: time(i * 5), updated_at: time(i * 5), embedding: series(8, () => rand() * 2 - 1) }));
  const links = memories.slice(1).map((m, i) => ({ from: memories[i].id, to: m.id }));
  const mapInput: MapItem[] = memories.map(({ id, kind, tags, embedding }) => ({ id, kind, tags, embedding }));
  const jobs: ClipJob[] = series(12, (i) => ({ v: 1, id: `demo${String(i).padStart(4, "0")}-abcdef`, source: `${names[i % 6]}-garden-${i + 1}.mp4`,
    createdAt: time(i * 15), updatedAt: time(i * 15), status: "done", progress: 1, step: "Clips reviewed", durationSec: 120,
    warnings: [], permission: "Fictional original demo recording", options: { count: 1, maxSec: 40, captions: true, layout: i < 6 ? "fit" : "fill" },
    clips: [{ id: "clip-1", start: 10, end: 40, title: `The lantern garden grows: chapter ${i + 1}`, hook: i < 6 ? "A quiet start" : "Can one lantern change the garden?",
      reason: "A visible transformation with a clear payoff", score: 60 + i * 3, status: "approved",
      publish: { status: "done", videoId: `demo${String(i).padStart(7, "0")}`, url: `https://example.invalid/watch/${i}`, at: time(i * 15) } }],
    feedback: [{ clipId: "clip-1", action: "approved", at: time(i * 15) }] }));
  const learn: LearnState = { v: 1, checkedAt: DEMO_NOW, warnings: [], clips: syncRecords(jobs, {}) };
  Object.values(learn.clips).forEach((r, i) => {
    r.publishedAt = time(i * 15);
    const views = Math.round(350 + i * i * 210 + rand() * 120);
    const snap = (factor: number, day: number) => ({ at: time(day), views: Math.round(views * factor), likes: Math.round(views * factor * 0.06),
      comments: Math.round(views * factor * 0.004), avgViewPct: 45 + i * 4, avgViewSec: 13.5 + i * 1.2, subs: Math.round(views * factor * 0.002) });
    r.snaps = { "24h": snap(0.5, i * 15 + 1), "48h": snap(0.8, i * 15 + 2), "72h": snap(1, i * 15 + 3) };
    r.latest = snap(1.1, 179);
  });
  const videos = Object.values(learn.clips).map((r) => ({ id: r.videoId, title: r.title, publishedAt: r.publishedAt!,
    views: r.latest!.views, likes: r.latest!.likes, comments: r.latest!.comments, durationSec: r.durationSec, thumb: "" }));
  const prospects: Prospect[] = series(18, (i) => ({ id: uuid(100 + i), name: `${names[i % 6]} Lanternworks ${Math.floor(i / 6) + 1}`,
    kind: "Lantern workshop", contact: `hello${i}@example.invalid`, stage: STAGES[i % 6], fee: 90 + Math.floor(i / 6) * 40,
    notes: "Fictional workshop testing a clearer enquiry workflow.", draft: "Could we walk through a sample lantern enquiry together?",
    created_at: time(i * 8), updated_at: time(170 + i % 10) }));
  const agents = names.slice(0, 3).map((name, i) => ({ slug: name.toLowerCase(), name, role: ["Garden researcher", "Clip editor", "Habit coach"][i],
    instructions: "Explore the fictional lantern garden.", tools: ["search_memories"], builtin: false, enabled: true, color: "#a78bfa",
    stats: { running: i === 0 ? 1 : 0, done: 28 + i * 17, failed: 1, calls: 90 + i * 20, tokens: 18000 + i * 6000 } }));
  const tasks = series(18, (i) => ({ id: uuid(200 + i), parent_id: null, project_id: uuid(300), agent: agents[i % 3].slug,
    title: `Explore lantern pattern ${i + 1}`, request: "Compare the garden notes and describe the next small improvement.", status: i === 17 ? "running" : "done",
    result: i === 17 ? null : "A smaller lantern frame made assembly simpler.", error: null, trace: [], pending: null,
    created_at: time(i * 10 + 9), started_at: time(i * 10 + 9), finished_at: i === 17 ? null : time(i * 10 + 9) }));
  const goal: Goal = { v: 1, title: "Grow the lantern garden", why: "Learn through small completed experiments.", status: "approved",
    metric: { kind: "manual", how: "Finished lantern designs", target: 30, samples: series(6, (i) => ({ at: time(i * 30), value: 2 + i * 4 })) },
    agents: agents.map((a) => a.slug), budget: { runsPerDay: 4, callsPerStep: 6 }, usage: { day: date(179), runs: 1 },
    steps: series(3, (i) => ({ id: `step-${i}`, what: ["Collect garden notes", "Compare frame shapes", "Summarise the next experiment"][i],
      agent: agents[i].slug, expected: "A short design note", needsApproval: false, status: i < 2 ? "done" : "pending" })),
    learned: ["Small frames are easier to assemble."], log: [{ at: time(178), text: "Two experiments completed." }] };
  const goalView = { id: uuid(400), createdAt: time(0), updatedAt: time(178), ...goal, progress: progress(goal), runsLeft: runsLeft(goal, date(179)) };
  const habits: Habit[] = ["Sketch a lantern", "Walk the garden", "Read a design note"].map((name, i) => ({ id: `habit-${i}`, name, emoji: "✦",
    days: [0, 1, 2, 3, 4, 5, 6], created: date(0), done: series(180, (d) => d).filter((d) => d > 165 || rand() < 0.35 + d / 300).map(date) }));
  const life: LifeState = { today: date(179), habits: habits.map((h) => ({ ...h, streak: streak(h, date(179)), week: last7(h, date(179)), doneToday: true, scheduledToday: true })),
    reminders: [{ id: "reminder-1", text: "Review the lantern sketches", at: time(180) }], focus: { today: 75, week: 375 },
    journal: [{ date: date(179), text: "The garden has become a daily practice. Today the smallest frame finally held its shape." }] };
  const articles = ["Estonia", "Finland", "Japan", "Canada"].flatMap((country, i) => series(3, (j) => ({
    title: `${country}: ${names[i]} opens fictional lantern garden ${j + 1}`, summary: "A fictional community craft experiment grows with daily practice.",
    url: `https://example.invalid/garden/${i}/${j}`, source: "Quenlori Dispatch", published_at: new Date(Date.parse(DEMO_NOW) - (i * 3 + j) * 3600_000).toISOString() })));
  const events: LedgerEvent[] = [];
  const emit = (day: number, e: Omit<LedgerEvent, "id" | "at">) => events.push({ id: `demo-event-${events.length}`, at: time(day), ...e } as LedgerEvent);
  for (let d = 0; d < 180; d++) {
    emit(d, { type: "focus.session", planet: "life", data: { minutes: 25 * (1 + Math.floor(d / 60)) } });
    emit(d, { type: "life.habit", planet: "life", data: { habit: habits[d % 3].id, done: true } });
    for (let n = 0; n < 1 + Math.floor(d / 45); n++) emit(d, { type: "core.turn", planet: "core", data: { model: "demo-lantern", tools: 2, ms: 1200 } });
    if (d % 5 === 0) emit(d, { type: "memory.saved", planet: "memory", data: { memoryId: memories[d / 5].id, kind: memories[d / 5].kind } });
    if (d % 15 === 0) emit(d, { type: "clip.published", planet: "studio", data: { clipId: jobs[d / 15].clips[0].publish!.videoId!, title: jobs[d / 15].clips[0].title } });
    if (d % 15 === 2) {
      const r = Object.values(learn.clips)[Math.floor(d / 15)];
      emit(d, { type: "clip.outcome48h", planet: "studio", data: { clipId: r.videoId, views: r.snaps["48h"]!.views, likes: r.snaps["48h"]!.likes } });
    }
  }
  prospects.forEach((p, i) => emit(170 + i % 10, { type: "business.stage", planet: "business", data: { prospect: p.id, to: p.stage } }));
  goal.steps.slice(0, 2).forEach((s, i) => emit(170 + i, { type: "goal.step", planet: "agents", data: { goalId: goalView.id, step: s.id, status: "done" } }));
  events.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const projects = [{ id: uuid(300), name: "Lantern garden", description: "A fictional season of small creative experiments.", status: "active", created_at: time(0), updated_at: DEMO_NOW }];
  switch (path) {
    case "/api/memories": {
      const term = (q.get("q") ?? "").toLowerCase();
      return { results: memories.filter((m) => `${m.title} ${m.content}`.toLowerCase().includes(term)).map(({ embedding: _, ...m }) => m), mode: term ? "text" : "list" };
    }
    case "/api/memories/map/input": return { items: mapInput, links };
    case "/api/memories/map": {
      const points = layout(mapInput, links);
      return { items: memories.map(({ embedding: _, ...m }, i) => ({ ...m, ...points[i] })), links, total: memories.length };
    }
    case "/api/news/geo": {
      const h = Number(q.get("hours")), hours = Math.min(336, Math.max(6, Number.isFinite(h) && h ? h : 72));
      const recent = articles.filter((a) => Date.parse(a.published_at) >= Date.parse(DEMO_NOW) - hours * 3600_000);
      return { hours, total: recent.length, ...hotspots(recent) };
    }
    case "/api/briefings": return { briefings: [{ id: uuid(600), kind: "manual", title: "A season of lantern gardens", content: "Fictional craft gardens are growing through shared experiments. Smaller frames and daily practice made the latest designs easier to build.",
      citations: articles.map((a) => ({ title: a.title, url: a.url })), article_count: articles.length, created_at: DEMO_NOW }],
      articles: articles.map((a, i) => ({ ...a, id: uuid(610 + i), topic: "craft" })), jobs: [{ status: "done", detail: "Demo briefing prepared", started_at: DEMO_NOW, finished_at: DEMO_NOW }], scheduled: false };
    case "/api/studio": return { configured: true, channel: { title: "Velquori Lantern Journal", handle: "@velquori-demo", subs: 1840, views: videos.reduce((s, v) => s + v.views, 0), videoCount: videos.length, thumb: "" }, videos, fetchedAt: DEMO_NOW };
    case "/api/studio/clips": return { root: "demo", tools: { ffmpeg: true, transcriber: true, ytdlp: true, missing: [] }, inbox: [{ name: "next-lantern.mp4", size: 24000000, mtime: DEMO_NOW }], jobs, downloads: [], quarantined: [], publishing: null };
    case "/api/studio/clips/learn/state": return learn; // raw validator input, not a live route
    case "/api/studio/clips/learn": return { ...insights(learn, jobs), study: null, model: null };
    case "/api/agents": return { agents, tools: [{ name: "search_memories", description: "Search garden notes", approval: false }] };
    case "/api/tasks": return { tasks: tasks.filter((t) => (!q.get("agent") || t.agent === q.get("agent")) && (!q.get("project") || t.project_id === q.get("project"))).reverse() };
    case "/api/goals": return q.get("id") ? (q.get("id") === goalView.id ? goalView : { error: "Not found" }) : { goals: [goalView] };
    case "/api/projects": return { projects };
    case "/api/automations": return { automations: [{ id: uuid(500), name: "Garden morning notes", enabled: true, trigger: "schedule", schedule: { every: "day", hour: 9, minute: 0 },
      event: null, kind_filter: null, agent: agents[0].slug, prompt: "Summarise yesterday's lantern experiments.", last_run_at: time(179), run_count: 120, created_at: time(0),
      when: "Daily at 09:00", last: tasks[0], runs: [tasks[0]] }], failing: false };
    case "/api/analytics": { // AnalyticsPanel currently reads Supabase directly; this is its combined data shape.
      const usage = [{ model: "demo-lantern", purpose: "agent.garden", calls: 430, input_tokens: 180000, output_tokens: 42000 }];
      return { memories: memories.length, messages: 860, ...usageSummary(usage), usage, events: events.slice(-8).reverse().map((e) => ({ type: e.type, created_at: e.at })) };
    }
    case "/api/life": return q.get("due") === "1" ? { due: [] } : life;
    case "/api/business": return { prospects, funnel: funnel(prospects), canSend: false };
    case "/api/markets": {
      const watchlist = names.slice(0, 3).map((_, i) => {
        const spark = series(180, (d) => Math.round((24 + i * 15 + d * 0.08 + Math.sin(d / 6) * 0.7 + rand() * 0.2) * 100) / 100);
        return { ticker: `DEMO${i + 1}`, price: spark[179], date: date(179), changePct: Math.round((spark[179] / spark[178] - 1) * 10000) / 100, spark };
      });
      const prices = Object.fromEntries(watchlist.map((w) => [w.ticker, w.price]));
      const holdings = [{ ticker: "DEMO1", shares: 10, cost: 24 }], portfolio = valueHoldings(holdings, prices);
      const account = { cash: 9760, started: date(0),
        trades: [{ at: time(0), ticker: "DEMO1", side: "buy", qty: 10, price: 24 }], curve: watchlist[0].spark.map((v, d) => ({ d: date(d), eq: 9760 + 10 * v, spy: null })),
        equity: 9760 + portfolio.value, ret: portfolio.pl / 10000, spy: null };
      // accountView exposes valued positions, not its stored position dictionary.
      const view = { ...account, positions: portfolio };
      return { note: NOTE, watchlist, portfolio, alerts: [{ id: "alert-1", ticker: "DEMO1", kind: "above", value: 45, text: "DEMO1 above 45" }], paper: view,
        bot: { ...view, strategy: "off", strategies: STRATEGIES, lastRun: date(179), log: ["Demo observation day: no trades needed"] } };
    }
    case "/api/ledger/events": return { events }; // full 180-day input for time travel, not a live route
    case "/api/ledger": {
      const at = q.get("at") ?? DEMO_NOW, ms = isoMs(at);
      return Number.isFinite(ms) ? { at: new Date(ms).toISOString(), snapshot: stateAt(events, ms) } : { error: "at must be an ISO date-time with a zone" };
    }
    case "/api/devworld": return { world: { v: 1, games: [{ id: "lantern-maze", name: "Lantern Maze", platform: "web", stage: "beta", pitch: "Find a path through a growing garden.", notes: "Six playtests improved the first puzzle." }],
      bugs: [{ id: "gate-glow", game: "lantern-maze", title: "Gate glow lingers", detail: "Fade the light when the puzzle ends.", severity: "polish", status: "fixed", created: time(140), fixed: time(170) }] }, seeded: false, updatedAt: DEMO_NOW };
    case "/api/theater": return { videos: videos.map((v) => ({ ...v, channel: "Velquori Lantern Journal" })), topic: "Lantern gardens", note: "Fictional demo catalogue" };
    case "/api/vault": return { files: [{ name: "lantern-sketches.txt", size: 1840, mtime: Date.parse(DEMO_NOW), type: "text", cloud: false }], cloudOnly: [], cloudError: null, usage: { bytes: 1840, count: 1 } };
    case "/api/arch": return { ops: [{ op: "plot", w: 24, d: 20, ground: "grass", trees: 8 }], say: "A garden plot for a small lantern pavilion." };
    case "/api/arch/scene": return starterScene(); // local scene input, not a live GET route
    default: return undefined;
  }
}
