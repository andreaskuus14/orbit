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
import { latestPublished } from "./clips/engage-pure.ts";

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
    case "/api/studio/analytics": { // one fixture for every query: ?range=…&video=… (Stats) and ?results=1 (Last Shorts) read different keys
      const daily = series(28, (i) => { const views = Math.round(260 + i * 9 + Math.sin(i / 3) * 60 + rand() * 40);
        return { day: date(150 + i), views, watchMinutes: Math.round(views * 0.31), subsGained: Math.round(views / 90 + rand() * 2), subsLost: Math.round(rand() * 2) }; });
      const sum = (k: "views" | "watchMinutes" | "subsGained" | "subsLost") => daily.reduce((s, d) => s + d[k], 0);
      const totals = { views: sum("views"), watchMinutes: sum("watchMinutes"), avgViewSec: 19, subsGained: sum("subsGained"), subsLost: sum("subsLost"),
        likes: Math.round(sum("views") * 0.06), comments: Math.round(sum("views") * 0.004), shares: Math.round(sum("views") * 0.003) };
      const prev = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round(v * 0.82)])) as typeof totals;
      const sh = Math.round(totals.views * 0.71), se = Math.round(totals.views * 0.12), su = Math.round(totals.views * 0.1);
      return { connected: true, channelTitle: "Velquori Lantern Journal", range: { days: 28, start: date(150), end: date(177) }, totals, prevTotals: prev, daily,
        traffic: [{ source: "SHORTS", label: "Shorts feed", views: sh }, { source: "YT_SEARCH", label: "YouTube search", views: se }, { source: "SUBSCRIBER", label: "Browse features", views: su },
          { source: "EXT_URL", label: "External", views: totals.views - sh - se - su }],
        countries: [["US", 0.31], ["GB", 0.14], ["DE", 0.11], ["CA", 0.09], ["JP", 0.07]].map(([country, f]) => ({ country, views: Math.round(totals.views * Number(f)) })),
        topVideos: [...videos].sort((a, b) => b.views - a.views).slice(0, 5).map((v) => ({ id: v.id, views: v.views, watchMinutes: Math.round(v.views * 0.3), avgViewSec: 18 })),
        retention: series(11, (i) => ({ t: i / 10, ratio: Math.round((i ? 0.92 - i * 0.045 : 1) * 100) / 100, relative: 0.5 + (i % 3) * 0.05 })),
        engaged: { cur: Math.round(totals.views * 0.64), prev: Math.round(prev.views * 0.6) }, warnings: [], fetchedAt: DEMO_NOW,
        shorts: insights(learn, jobs).lastShorts ?? [], checkedAt: DEMO_NOW, postmortem: null };
    }
    case "/api/studio/oauth/status": return { configured: true, connected: true, expired: false, canUpload: true, channelTitle: "Velquori Lantern Journal", connectedAt: time(0) };
    case "/api/studio/clips/inbox-auto": return { enabled: false, options: { count: 3, maxSec: 45, captions: true, layout: "fit", camSide: "right", camSize: 0.3, jumpCuts: true,
      zooms: true, language: "auto", coldOpen: false, progressBar: false, loopEnd: false, preset: "viral" } };
    case "/api/studio/clips/schedule": return { settings: { timezone: "UTC", slots: ["12:00", "17:00"], perDay: 2 }, next: [1, 2, 3].map((d) => `${date(179 + d)}T12:00:00.000Z`), batch: null };
    case "/api/studio/clips/devlog": return { enabled: false, days: {}, path: "demo/devlog" };
    case "/api/studio/clips/scout": {
      const watchlist = names.slice(0, 2).map((n, i) => ({ channelId: `UCdemo${i}`, title: `${n} Crafts`, autoClip: false }));
      const picks = series(3, (i) => ({ videoId: `demoscout0${i}`, url: `https://example.invalid/watch/scout${i}`, title: `How the ${names[i + 2]} lantern frame was built`, channel: watchlist[i % 2].title,
        channelId: watchlist[i % 2].channelId, durationSec: 900 + i * 300, publishedAt: time(178 - i), stats: { views: 4200 + i * 1800, likes: 260 + i * 90, comments: 31 + i * 7 },
        score: 82 - i * 9, reason: "A clear build-and-reveal arc with a quotable moment", source: i ? "keyword" : "watchlist", status: "new" }));
      return { scout: { watchlist, keywords: ["paper lanterns", "garden craft"], aiKeywords: [], nicheAuto: false, maxAgeHours: 72, creatorMaxAgeDays: 14, minMinutes: 8, dailyAuto: 0, runAt: 7, picks,
        lastRun: { at: time(179), ok: true, warnings: [], candidates: 24, units: 310, ranker: "score", auto: 0, summary: "3 fresh picks from 24 candidates" } },
        running: false, researching: false, configured: true, budget: 5000, usedToday: 310 };
    }
    case "/api/studio/clips/story": return { stories: [{ id: "demo-story-1", createdAt: time(176), status: "draft", step: "Script ready for review", warnings: [], items: [],
      opts: { idea: "A lantern that only lights when someone is lost", style: "storybook", length: 30, voice: "calm", motion: "stills" },
      story: { title: "The lantern that waits", hook: "Every night one lantern stays dark. Tonight it wakes.", scenes: [
        { visual: "A dark garden path lined with paper lanterns", narration: "Every night, one lantern stays dark.", sec: 6, camera: "slow push in" },
        { visual: "A small traveller stops beside the dark lantern", narration: "It waits for the one who has lost the way.", sec: 8, camera: "low angle" },
        { visual: "The lantern glows and the path lights up ahead", narration: "Tonight, it wakes.", sec: 6, camera: "pull back wide" }] } }], running: null, dryRun: true };
    case "/api/ideas": return { shown: [{ id: "idea-1", title: "Folding a lantern in 30 seconds", summary: "Speed-run the simplest frame from the notebook.", area: "studio", score: 78 },
      { id: "idea-2", title: "Which lantern lasts the storm?", summary: "Three frames, one windy night, one winner.", area: "studio", score: 71 }] };
    case "/api/studio/clips/engage": return { v: 1, fetchedAt: DEMO_NOW, shorts: latestPublished(jobs, Date.parse(DEMO_NOW), 3).map((s, i) => ({ ...s,
      comments: [{ id: `demo-comment-${i}`, author: `${names[(i + 3) % 6]} Garden Club`, text: "What paper did you use for the frame?", likes: 4 + i, publishedAt: time(178) }] })) };
    case "/api/studio/shorts-plan": return { target: 7, booked: 4, ready: 2, need: 1, running: null, planning: false, week: { used: 0, cap: 300 },
      picks: [{ key: "pick-1", source: "radar", title: "Folding a lantern in 30 seconds", story: "demo-story-1", status: "draft", step: "Script ready for review" }],
      batch: { items: [], credits: 0, label: "Nothing priced yet", held: 0 } };
    case "/api/studio/longform": return { plans: [] };
    case "/api/studio/autopilot": {
      const stage = (i: number) => (i < 2 ? "published" : i < 3 ? "scheduled" : "found") as "published" | "scheduled" | "found";
      const items = series(4, (i) => ({ videoId: `demoauto00${i}`, title: `${names[i]} builds a ${["tiny", "floating", "spiral", "folded"][i]} lantern`, channel: `${names[i % 2]} Crafts`,
        auto: false, stage: stage(i), detail: stage(i) === "found" ? "Waiting for your Clip click" : "Short is live", clips: i < 3 ? [{ key: `auto-${i}`, title: `The ${["tiny", "floating", "spiral"][i]} lantern reveal`, stage: stage(i) }] : [] }));
      return { settings: { auto: false, dailyDownloads: 1, options: { layout: "fit", camSide: "right", captions: true } }, today: { downloads: 0, scoutAuto: 0, cap: 1, left: 1 },
        scout: { running: false, configured: true, usedToday: 310, budget: 5000, lastRun: { at: time(179), ok: true, summary: "3 fresh picks" }, creators: ["Velquori Crafts", "Nimbrelune Crafts"], keywords: ["paper lanterns"], runAt: 7 },
        candidates: [{ videoId: "demoauto003", url: "https://example.invalid/watch/auto3", title: items[3].title, channel: items[3].channel, apScore: 74, why: ["Clear reveal at 2:10", "Creator's Shorts beat their usual"] }],
        items, counts: { found: 1, clipping: 0, packaging: 0, waiting: 0, scheduled: 1, published: 2, failed: 0 }, proposals: {}, slots: [],
        working: { n: 12, confidence: "early", findings: [{ text: "Clips under 35 s kept viewers longer." }], dims: { length: { "20-30": { n: 5, mult: 1.2 }, "40+": { n: 7, mult: 0.9 } } } } };
    }
    case "/api/git": return { env: [], saved: ["~/projects/lantern-maze"] };
    case "/api/place": return { on: false, places: [] }; // RealSky keeps its default sky: the demo never has a location
    case "/api/news/follows": {
      const items = articles.slice(0, 3).map(({ title, url, source, published_at }) => ({ title, url, source, published_at, new: true }));
      return { topics: [{ name: "Lantern gardens", at: DEMO_NOW, items }], countries: ["Finland", "Japan"], lastVisit: Date.parse(DEMO_NOW) - DAY };
    }
    case "/api/arch/studio": return { rows: [
      { id: uuid(700), title: "Precedent: Lantern Pavilion", content: "Lesson: a light timber frame reads as a lantern at night when the roof floats above a band of glazing.", tags: ["arch", "lesson", "precedent:lantern-pavilion"], created_at: time(170), storage_path: null },
      { id: uuid(701), title: "Critique: garden pavilion sketch", content: "Proportion: the roof overhang balances the low walls.\nLight: the north wall needs one high window.\nStructure: four corner posts carry the roof simply.", tags: ["arch", "critique", "precedent:lantern-pavilion"], created_at: time(174), storage_path: null },
      { id: uuid(702), title: "Crit: pavilion v3", content: "Tutor: the 10 × 8 m plan is generous for one room; try 6 × 5 m and give the rest to the garden.\nCirculation is direct; the entrance could face the path.", tags: ["arch", "crit", "model:v3"], created_at: time(177), storage_path: null }],
      digest: { week: "2026-W43", at: time(176), lessons: 1, critiques: 1, scans: 0, precedents: ["Lantern Pavilion"], weak: [{ aspect: "light", count: 2 }],
        focus: "Bring daylight in from two sides before adding more rooms.", line: "1 lesson · 1 critique · focus: daylight" } };
    case "/api/arch/versions": return { versions: [10, 8, 6].map((w, i) => { const s = starterScene();
      s.parts = s.parts.map((p) => ({ ...p, w: p.kind === "roof" ? w + 1 : w, d: p.kind === "roof" ? w : w - 2 }));
      return { at: time(172 + i * 3), scene: s }; }) };
    default: return undefined;
  }
}
