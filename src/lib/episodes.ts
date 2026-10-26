import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { createMemory, searchMemories, MEMORY_COLUMNS } from "./memory";
import { stopAllOn } from "./stop-all";
import { localDay } from "./morning-pure";
import { fromRows, type EventRow } from "./ledger-pure";
import { buildEpisodes, episodeMemory, episodeView, episodesBlock, type ClipDecisionIn, type EpisodeRow } from "./episodes-pure";

// Episodic memory I/O (rules: episodes-pure.ts). Nightly (scheduler tick, from 02:00 local, once a day) ORBIT's own records become
// episode memories via createMemory (so they're embedded like any memory). No model call. Journal text is never read here.
// State: <ORBIT data dir>/episodes.json {lastDay}.

const file = () => path.join(orbitDataDir(), "episodes.json");
const DAY = 86_400_000;
const LOOKBACK = 180 * DAY;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);
const soft = <T>(name: string, fallback: T) => (e: unknown) => { console.warn(`[episodes] ${name} skipped:`, msg(e)); return fallback; };
const G = globalThis as unknown as { __orbitEpisodes?: Promise<unknown> };

async function clipsIn(): Promise<{ titles: Record<string, string>; decisions: ClipDecisionIn[] }> {
  const { listJobs } = await import("./clips/factory");
  const titles: Record<string, string> = {}, decisions: ClipDecisionIn[] = [];
  for (const job of await listJobs()) {
    for (const c of job.clips) titles[`${job.id}/${c.id}`] = c.publish?.title || c.title;
    for (const f of job.feedback ?? []) decisions.push({ clipId: `${job.id}/${f.clipId}`, title: titles[`${job.id}/${f.clipId}`] ?? "a clip", action: f.action, reason: f.reason, at: f.at });
  }
  return { titles, decisions };
}

/** Build and store new episodes for one user. Returns how many were added. Throws on a failed insert (e.g. migration 0018 not run). */
export async function buildNow(sb: SupabaseClient, userId: string, now = Date.now()): Promise<number> {
  const since = new Date(now - LOOKBACK).toISOString();
  const rows = <T>(p: PromiseLike<{ data: T[] | null; error: unknown }>, name: string) => Promise.resolve(p).then((r) => { if (r.error) throw r.error; return r.data ?? []; }).catch(soft(name, [] as T[]));
  const [have, memories, events, proposals, goals, prospects, clips] = await Promise.all([
    sb.from("memories").select("tags").eq("user_id", userId).eq("kind", "episode").limit(5000).then((r) => { if (r.error) throw r.error; return r.data ?? []; }), // must work: else everything is added twice
    // never kind journal: LIFE text stays out of episodes (the builder drops it too)
    rows(sb.from("memories").select("id, kind, source, title, content, tags, created_at").eq("user_id", userId).in("kind", ["conversation", "decision"]).gte("created_at", since).order("created_at", { ascending: false }).limit(1000), "memories"),
    rows(sb.from("events").select("id, created_at, type, planet, payload, caused_by").eq("user_id", userId).in("type", ["clip.outcome48h", "business.stage", "goal.step"]).gte("created_at", since).limit(5000), "events"),
    rows(sb.from("proposals").select("id, title, why, agent, status, created_at, decided_at, task_id").eq("user_id", userId).in("status", ["approved", "dismissed"]).gte("created_at", since).limit(1000), "proposals"),
    rows(sb.from("goals").select("id, title, status, updated_at").eq("user_id", userId).limit(500), "goals"),
    rows(sb.from("prospects").select("id, name").eq("user_id", userId).limit(2000), "prospects"),
    clipsIn().catch(soft("clips", { titles: {}, decisions: [] })),
  ]);
  const haveKeys = new Set(have.flatMap((m) => (m.tags as string[]).filter((t) => t.startsWith("ep:")).map((t) => t.slice(3))));
  const eps = buildEpisodes({
    memories: memories as never, events: fromRows(events as EventRow[]), proposals: proposals as never, goals: goals as never,
    clipDecisions: clips.decisions.filter((d) => Date.parse(d.at) >= now - LOOKBACK), clipTitles: clips.titles,
    prospects: Object.fromEntries((prospects as { id: string; name: string }[]).map((p) => [p.id, p.name])),
  }, haveKeys);
  let added = 0;
  for (const e of eps) {
    if (stopAllOn()) break;
    await createMemory(sb, userId, { kind: "episode", source: "episodes", ...episodeMemory(e) });
    added++;
  }
  return added;
}

/** Scheduler tick: once a local day from 02:00, for each user. Serialized, never throws. */
export function maybeEpisodes(sb: SupabaseClient, userIds: string[], now = new Date()): Promise<unknown> {
  const p = (G.__orbitEpisodes ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (now.getHours() < 2 || stopAllOn()) return;
    const st = JSON.parse(await readFile(file(), "utf8").catch(() => "{}")) as { lastDay?: string };
    const day = localDay(now);
    if (st.lastDay === day) return;
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify({ lastDay: day })); // claimed first: a crash can't make it run all day
    await rename(file() + ".tmp", file());
    for (const id of userIds) {
      const n = await buildNow(sb, id, now.getTime()).catch((e) => { console.error("[episodes] build failed (is migration 0018 applied?):", msg(e)); return 0; });
      if (n) console.log(`[orbit] episodes: ${n} new`);
    }
  }).catch((e) => console.error("[episodes] nightly failed:", msg(e)));
  G.__orbitEpisodes = p;
  return p;
}

/** Episode rows, newest first by when they happened. */
export async function listEpisodes(sb: SupabaseClient, userId: string, limit = 200): Promise<EpisodeRow[]> {
  const { data, error } = await sb.from("memories").select(MEMORY_COLUMNS).eq("user_id", userId).eq("kind", "episode").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return ((data ?? []) as EpisodeRow[]).sort((a, b) => episodeView(b).when.localeCompare(episodeView(a).when));
}

/** CORE's recall: the two episodes closest to the question, as a short block ("" when none or on any failure). */
export async function episodesContext(sb: SupabaseClient, userId: string, question: string): Promise<string> {
  try {
    const { results } = await searchMemories(sb, question, 2, userId, { kind: "episode" });
    return episodesBlock(results as EpisodeRow[], Date.now());
  } catch { return ""; }
}
