// Dreaming (roadmap C5), IO half: the night shift's "dream" step gathers non-journal data (beliefs, the last 30 days of notes/decisions,
// goals, Studio sessions), ranks questions (dream-pure.ts) and lets the fast model pick/phrase among the top 3 (at most DREAM_CALLS calls,
// rules' wording on any failure). The one question is stored for the morning brief, the morning call opener and CORE's context that day.
// State: <ORBIT data dir>/dream.json, per user the last question and which keys were asked when (keys only, no note text).
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isCurrent } from "./memory-types-pure";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { askClaude, FAST_MODEL, recordUsage } from "./claude";
import { localDay } from "./morning-pure";
import { DREAM_CALLS, DREAM_SYSTEM, NOTE_KINDS, cleanDream, dreamContextText, dreamPrompt, markAsked, rankDream, type DGoal, type DNote, type Dream } from "./dream-pure";

type UserDream = { last?: Dream; asked: Record<string, string> };
type Store = { users: Record<string, UserDream> };
const file = () => path.join(orbitDataDir(), "dream.json");
const load = async (): Promise<Store> => { try { const j = JSON.parse(await readFile(file(), "utf8")); return j?.users && typeof j.users === "object" ? j : { users: {} }; } catch { return { users: {} }; } };
async function save(userId: string, u: UserDream) { // only the night run writes, one at a time
  const s = await load();
  s.users[userId] = u;
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file() + ".tmp", JSON.stringify(s));
  await rename(file() + ".tmp", file());
}

/** Tonight's dream: the question for the morning of `day` (the night key), or why there is none. */
export async function runDream(sb: SupabaseClient, userId: string, day: string, tz: string, signal?: AbortSignal): Promise<{ dream?: Dream; why?: string }> {
  const now = Date.now(), since = new Date(now - 30 * 86_400_000).toISOString();
  const [facts, notes, goals, dev, st] = await Promise.all([
    sb.from("memory_facts").select("id, statement, created_at").eq("user_id", userId).eq("status", "current").limit(500).then((r) => r.data ?? []), // no table yet → none
    sb.from("memories").select("id, kind, title, content, created_at, tags").eq("user_id", userId).in("kind", NOTE_KINDS).gte("created_at", since)
      .order("created_at", { ascending: false }).limit(300).then((r) => (r.data ?? []).filter((m) => isCurrent(m, { now: Date.now() })) as DNote[]),
    sb.from("goals").select("id, doc, updated_at").eq("user_id", userId).limit(50)
      .then((r) => (r.data ?? []).map((g): DGoal => ({ id: g.id, title: String(g.doc?.title ?? ""), updated_at: g.updated_at }))),
    import("./dev-session").then((d) => d.listDevSessions(sb, userId)).then((x) => x.map((s) => s.last), () => []),
    load(),
  ]);
  const u = st.users[userId] ?? { asked: {} };
  const cands = rankDream({ now, tz, facts, notes, goals, dev, asked: u.asked });
  if (!cands.length) return { why: "Nothing worth asking" };
  let pick = { cand: cands[0], question: cands[0].question }, by: Dream["by"] = "rules";
  for (let k = 0; k < DREAM_CALLS && cands.length > 1 && !signal?.aborted; k++) { // one choice to make: the model only helps when there is more than one
    try {
      const r = await askClaude(dreamPrompt(cands), DREAM_SYSTEM, { lane: "background", model: FAST_MODEL, timeoutMs: 30_000, purpose: "night.dream", signal });
      void recordUsage(sb, userId, "night.dream", r, FAST_MODEL);
      const c = cleanDream(r.text, cands);
      if (c) { pick = c; by = "model"; break; }
    } catch (e) { console.error("[dream] model:", e instanceof Error ? e.message : e); break; }
  }
  const dream: Dream = { day, key: pick.cand.key, kind: pick.cand.kind, question: pick.question, by };
  await save(userId, { last: dream, asked: markAsked(u.asked, dream.key, day) });
  return { dream };
}

/** The question for this morning, if last night left one. */
export const dreamToday = async (userId: string, now = Date.now()): Promise<Dream | null> => {
  const d = (await load()).users[userId]?.last;
  return d && d.day === localDay(new Date(now)) ? d : null;
};

/** CORE's context line on the day it was asked ("" otherwise; never throws). */
export const dreamContext = (userId: string) => dreamToday(userId).then((d) => dreamContextText(d, localDay(new Date())), () => "");
