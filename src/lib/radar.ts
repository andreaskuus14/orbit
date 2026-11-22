// OPPORTUNITY RADAR, IO (rules: radar-pure.ts). Reads only what ORBIT already stored: the Trend Radar histories (Roblox and the
// YouTube Gaming chart), outlier ideas, the last REACH scan, news articles and BUSINESS leads. No web request and no model call
// of its own. Scheduler tick: every 30 min, open windows → at most PING_MAX_PER_DAY fixed-label phone pings (quiet hours, focus
// and Stop-all wait). His click on a window's step creates one Forge draft task inside ORBIT; nothing is posted or sent.
// State: <ORBIT data dir>/radar.json.
import path from "node:path";
import { readFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readStore, writeStore } from "./safe-file.ts";
import { orbitDataDir } from "./data-dir";
import { stopAllOn } from "./stop-all";
import { findRisers, parseSnaps } from "./trend-rise-pure";
import { findYtRisers, parseYtSnaps } from "./yt-trend-pure";
import { areaOf, findWindows, parseRadar, pingsDue, projectTerms, robloxUrl, visibleWindows, WINDOW_MS, youtubeUrl, type Project, type RadarState, type Signal, type Window } from "./radar-pure";
import { logActivity } from "./activity";

const file = () => path.join(orbitDataDir(), "radar.json");
const CHECK_MS = 30 * 60_000;
const g = globalThis as unknown as { __orbitRadar?: { write: Promise<unknown>; busy?: boolean; last?: { at: number; windows: Window[] } } };
const R = (g.__orbitRadar ??= { write: Promise.resolve() });
const load = async (): Promise<RadarState> => parseRadar(await readStore(file()));
function update<T>(fn: (s: RadarState) => T): Promise<T> {
  const p = R.write.catch(() => {}).then(async () => { const s = await load(), out = fn(s); await writeStore(file(), JSON.stringify(s)); return out; });
  R.write = p;
  return p;
}
const json = async (name: string) => JSON.parse(await readFile(path.join(orbitDataDir(), name), "utf8").catch(() => "[]"));
const PRIVATE_NAME = /journal|p[äa]evik|diary|\blife\b/i; // LIFE goals never become radar topics

/** Rising items at every stored snapshot of the last 96 h (one signal per item per snapshot; findWindows deduplicates). */
async function trendSignals(now: number): Promise<Signal[]> {
  const out: Signal[] = [];
  const since = now - 2 * WINDOW_MS;
  const yt = parseYtSnaps(await json("yt-trend-history.json").catch(() => []));
  for (let i = 1; i < yt.length; i++) if (yt[i].at >= since)
    for (const r of findYtRisers(yt.slice(0, i + 1), 15)) out.push({ source: "youtube", key: r.id, title: r.title, at: yt[i].at, url: youtubeUrl(r.id), strong: r.strong });
  const rb = parseSnaps(await json("trend-history.json").catch(() => []));
  for (let i = 1; i < rb.length; i++) if (rb[i].at >= since)
    for (const r of findRisers(rb.slice(0, i + 1), 15)) out.push({ source: "roblox", key: String(r.universeId), title: r.name, at: rb[i].at, url: robloxUrl(r.placeId), strong: r.strong, area: "gamedev" });
  return out;
}

async function signals(sb: SupabaseClient, userId: string, now: number): Promise<Signal[]> {
  const since = new Date(now - 2 * WINDOW_MS).toISOString();
  const [trends, ideas, reach, news, leads] = await Promise.all([
    trendSignals(now).catch(() => [] as Signal[]),
    import("./ideas").then((m) => m.listIdeas()).then((b) => b.shown.filter((i) => i.origin === "outliers" && i.at).map((i): Signal => ({ source: "outlier", key: i.video || i.id, title: i.videoTitle || i.title, at: Date.parse(i.at!), url: youtubeUrl(i.video), area: "studio" }))).catch(() => [] as Signal[]),
    import("./reach/index").then((m) => m.reachCached().items.filter((x) => x.hot).map((x): Signal => ({ source: "reach", key: `${x.source}:${x.id}`, title: x.title, at: x.created, url: x.open, strong: x.velocity > 3 }))).catch(() => [] as Signal[]),
    Promise.resolve(sb.from("articles").select("url, title, published_at, fetched_at").eq("user_id", userId).gte("fetched_at", since).limit(300))
      .then(({ data }) => (data ?? []).map((a): Signal => ({ source: "news", key: a.url, title: a.title, at: Date.parse(a.published_at ?? a.fetched_at), url: a.url }))),
    Promise.resolve(sb.from("prospects").select("id, kind, created_at").eq("user_id", userId).gte("created_at", since).limit(300))
      .then(({ data }) => (data ?? []).filter((p) => p.kind).map((p): Signal => ({ source: "business", key: p.id, title: p.kind, at: Date.parse(p.created_at), area: "business" }))),
  ]);
  return [...trends, ...ideas, ...reach, ...news, ...leads].filter((s) => Number.isFinite(s.at) && s.title);
}

/** His projects: STUDIO scout keywords, active OPERATIONS projects, open goals. */
async function projects(sb: SupabaseClient, userId: string): Promise<Project[]> {
  const [scout, proj, goals] = await Promise.all([
    import("./clips/scout").then((m) => m.scoutView()).then((v) => [...v.scout.keywords, ...v.scout.aiKeywords]).catch(() => [] as string[]),
    Promise.resolve(sb.from("projects").select("name").eq("user_id", userId).eq("status", "active").limit(30)).then((r) => (r.data ?? []).map((p) => String(p.name))),
    Promise.resolve(sb.from("goals").select("title").eq("user_id", userId).in("status", ["draft", "approved", "running", "waiting", "paused", "blocked"]).limit(30)).then((r) => (r.data ?? []).map((x) => String(x.title))),
  ]);
  const out: Project[] = scout.length ? [{ area: "studio", name: "Your Shorts", terms: projectTerms("", scout) }] : [];
  for (const name of [...proj, ...goals]) if (name && !PRIVATE_NAME.test(name)) out.push({ area: areaOf(name), name: name.slice(0, 80), terms: projectTerms(name) });
  return out;
}

/** The open windows right now (cached for a minute; the radar card polls). */
export async function radarWindows(sb: SupabaseClient, userId: string, now = Date.now()): Promise<Window[]> {
  if (R.last && now - R.last.at < 60_000) return visibleWindows(R.last.windows, await load(), now);
  const ws = findWindows(await signals(sb, userId, now), await projects(sb, userId), now);
  R.last = { at: now, windows: ws };
  return visibleWindows(ws, await load(), now);
}

/** Scheduler tick: every 30 min; pings only through the capped, quiet-hours-aware rule. Never throws. */
export async function maybeRadar(sb: SupabaseClient, userId: string | undefined, now = Date.now()): Promise<void> {
  if (!userId || R.busy) return;
  R.busy = true;
  try {
    const st = await load();
    if (st.checkedAt && now - st.checkedAt < CHECK_MS) return;
    const ws = await radarWindows(sb, userId, now);
    const [{ quietAt, parseQuiet, pushLabel }, push] = await Promise.all([import("./remote-push-pure"), import("./remote-push")]);
    const { ping, state } = pingsDue(ws, st, now, { quiet: quietAt(now, parseQuiet(process.env.ORBIT_QUIET_HOURS)), stopAll: stopAllOn() });
    await update((s) => Object.assign(s, state, { checkedAt: now }));
    if (ping.length) {
      if (push.canNotify()) void push.deliver(pushLabel("radar", ping.length)); // a fixed label; the topic stays inside ORBIT
      for (const w of ping) logActivity({ area: "core", title: `Opportunity radar: ${w.reason}`.slice(0, 300) });
    }
  } catch (e) { console.error("[orbit] opportunity radar failed:", e instanceof Error ? e.message : e); }
  finally { R.busy = false; }
}

/** His click: "draft" starts the window's one draft task (inside ORBIT only); "later" hides the topic for a week. */
export async function radarAct(sb: SupabaseClient, userId: string, id: string, act: "draft" | "later"): Promise<{ ok: true; task?: string; open?: string } | { ok: false; error: string; status: number }> {
  const w = (await radarWindows(sb, userId)).find((x) => x.id === id);
  if (!w) return { ok: false, error: "That window is closed", status: 404 };
  if (act === "later") { await update((s) => { s.snoozed[id] = Date.now(); }); return { ok: true }; }
  await update((s) => { s.acted[id] = Date.now(); });
  if ("open" in w.step) return { ok: true, open: w.step.open };
  const { data, error } = await sb.from("tasks").insert({ user_id: userId, agent: w.step.agent, title: w.step.title, request: w.step.request }).select("id").single();
  if (error || !data) { await update((s) => { delete s.acted[id]; }); return { ok: false, error: error?.message ?? "Couldn't start the draft", status: 500 }; }
  void import("./agents").then((m) => m.kickQueue(sb, userId)).catch(() => {});
  logActivity({ area: "core", title: `Opportunity radar: started "${w.step.title}"`, link: { task: data.id } });
  return { ok: true, task: data.id };
}
