// Dream mode (roadmap 4), IO half: the night shift's "dream" step also dreams up idea combinations (dream-ideas-pure.ts).
// One fast-model call a night at most, gated by Stop-all and the usage hold. Ideas land in DREAMS (GoalsPanel): keep / discard /
// turn into a goal draft. State: <ORBIT data dir>/dream-ideas.json per user: the list and the keep/discard tally per category.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { askClaude, FAST_MODEL, recordUsage } from "./claude";
import { stopAllOn } from "./stop-all";
import { PAUSED_MSG } from "./stop-all-pure";
import { usageHold } from "./usage-meter";
import { NOTE_KINDS, type DNote } from "./dream-pure";
import { IDEAS_SYSTEM, applyDecision, ideasPrompt, mergeIdeas, parseIdeas, pickSources, type Decision, type IGoal, type INiche, type Idea, type Tally } from "./dream-ideas-pure";

type UserIdeas = { ideas: Idea[]; tally: Tally; lastDay?: string };
type Store = { users: Record<string, UserIdeas> };
const file = () => path.join(orbitDataDir(), "dream-ideas.json");
const g = globalThis as unknown as { __orbitIdeasWrite?: Promise<unknown> };
const load = async (): Promise<Store> => { try { const j = JSON.parse(await readFile(file(), "utf8")); return j?.users && typeof j.users === "object" ? j : { users: {} }; } catch { return { users: {} }; } };
const empty = (): UserIdeas => ({ ideas: [], tally: {} });

/** Read-modify-write one at a time (night run and his clicks), saved atomically. */
function update<T>(userId: string, fn: (u: UserIdeas) => T): Promise<T> {
  const p = (g.__orbitIdeasWrite ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await load(), u = (s.users[userId] ??= empty()), out = fn(u);
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(s));
    await rename(file() + ".tmp", file());
    return out;
  });
  g.__orbitIdeasWrite = p;
  return p;
}

export const ideasView = async (userId: string) => (await load()).users[userId] ?? empty();

/** Tonight's ideas for the morning of `day`. At most one model call; never journal (pickSources drops it). */
export async function runIdeas(sb: SupabaseClient, userId: string, day: string, signal?: AbortSignal): Promise<{ n: number; why?: string }> {
  const held = stopAllOn() ? PAUSED_MSG : usageHold();
  if (held) return { n: 0, why: held };
  const u = await ideasView(userId);
  if (u.lastDay === day) return { n: 0, why: "Already dreamt tonight" };
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const [goals, notes, niches] = await Promise.all([
    sb.from("goals").select("id, status, doc, updated_at").eq("user_id", userId).limit(50)
      .then((r) => (r.data ?? []).map((x): IGoal => ({ id: x.id, status: String(x.status ?? x.doc?.status ?? ""), title: String(x.doc?.title ?? ""), updated_at: x.updated_at }))),
    sb.from("memories").select("id, kind, title, content, created_at, tags").eq("user_id", userId).in("kind", NOTE_KINDS).gte("created_at", since)
      .order("created_at", { ascending: false }).limit(50).then((r) => (r.data ?? []) as DNote[]),
    import("./niche").then((m) => m.nicheBoard()).then((b) => b.niches as INiche[], () => []),
  ]);
  const src = pickSources({ goals, notes, niches, now: Date.now() });
  if (!src.length) return { n: 0, why: "Not enough goals, notes or niches to combine" };
  await update(userId, (x) => { x.lastDay = day; }); // one attempt a night, even if the call fails
  const r = await askClaude(ideasPrompt(src, u.tally), IDEAS_SYSTEM, { lane: "background", model: FAST_MODEL, timeoutMs: 60_000, purpose: "night.ideas", signal });
  void recordUsage(sb, userId, "night.ideas", r, FAST_MODEL);
  const fresh = parseIdeas(r.text, src, u.tally, day, randomUUID);
  if (!fresh.length) return { n: 0, why: "No idea passed the checks" };
  await update(userId, (x) => { x.ideas = mergeIdeas(x.ideas, fresh); });
  return { n: fresh.length };
}

/** keep / discard / goal (the route makes the goal draft first). Learns the idea's category. */
export const decideIdea = (userId: string, id: string, d: Decision) => update(userId, (u) => applyDecision(u, id, d));
