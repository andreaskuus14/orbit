import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { askClaude, FAST_MODEL, recordUsage } from "./claude";
import { stopAllOn } from "./stop-all";
import { usageHold } from "./usage-meter";
import { fromRows, type EventRow } from "./ledger-pure";
import type { NightRun } from "./night-pure";
import { DIARY_EVENTS, DIARY_SYSTEM, asksDiary, cleanEntry, diaryBlock, diaryPrompt, hasFacts, pageEntries, parseStore, pickFacts, putEntry, templateEntry, type Store } from "./diary-pure";

// ORBIT's diary I/O (rules: diary-pure.ts). Written once at the end of each night shift (night.ts), from ORBIT's own records only.
// At most one fast-model call per night, skipped under Stop-all, the usage hold or a spent night budget (then the plain template).
// State: <ORBIT data dir>/diary.json.

const file = () => path.join(orbitDataDir(), "diary.json");
const g = globalThis as unknown as { __orbitDiary?: Promise<unknown> };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);
const soft = <T>(name: string, fallback: T) => (e: unknown) => { console.warn(`[diary] ${name} skipped:`, msg(e)); return fallback; };

async function load(): Promise<Store> {
  const s = parseStore(await readFile(file(), "utf8").catch((e) => { if (e.code === "ENOENT") return ""; throw e; }));
  if (!s) throw new Error("diary.json is unreadable; fix or move it aside (nothing was overwritten).");
  return s;
}
function update<T>(fn: (s: Store) => T): Promise<T> {
  const p = (g.__orbitDiary ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await load(), out = fn(s);
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(s));
    await rename(file() + ".tmp", file());
    return out;
  });
  g.__orbitDiary = p;
  return p;
}

/** End of the night shift: write tonight's entry (day = the night's key). `model` false = template only. Never throws. */
export async function writeDiary(sb: SupabaseClient, userId: string, run: NightRun, model: boolean, signal?: AbortSignal) {
  try {
    const now = Date.now(), since = new Date(now - 86_400_000).toISOString();
    const [prev, events, lessons, issues, episodes] = await Promise.all([
      load().then((s) => s.users[userId]?.find((e) => e.day === run.key)),
      Promise.resolve(sb.from("events").select("id, created_at, type, planet, payload, caused_by").eq("user_id", userId).in("type", [...DIARY_EVENTS]).gte("created_at", since).limit(2000)
        .then((r) => { if (r.error) throw r.error; return fromRows((r.data ?? []) as EventRow[]); })).catch(soft("events", [])),
      import("./lessons").then((m) => m.lessonsView(userId)).then((v) => [...v.proposed, ...v.kept]).catch(soft("lessons", [])),
      import("./health").then((m) => m.healthIssues()).catch(soft("health", [])),
      import("./episodes").then(async (m) => { const { episodeView } = await import("./episodes-pure"); return (await m.listEpisodes(sb, userId, 30)).map(episodeView); }).catch(soft("episodes", [])),
    ]);
    const facts = pickFacts({ now, run, events, lessons, issues, episodes, day: run.key });
    let text = templateEntry(facts), used = false;
    // one model call per night: a resumed run that already got its model entry keeps the template from here on
    if (model && !prev?.model && hasFacts(facts) && !stopAllOn() && !usageHold() && !signal?.aborted) {
      const persona = await import("./persona").then((m) => m.personaContext(userId, "brief"), () => "");
      const r = await askClaude(diaryPrompt(facts, persona), DIARY_SYSTEM, { lane: "background", model: FAST_MODEL, purpose: "night.diary", timeoutMs: 60_000, signal })
        .catch(soft("model", null));
      if (r) { await recordUsage(sb, userId, "night.diary", r, FAST_MODEL).catch(() => {}); const c = cleanEntry(r.text); if (c) { text = c; used = true; } }
    }
    if (prev?.model && !used) return; // never replace a written entry with the template
    await update((s) => { s.users[userId] = putEntry(s.users[userId] ?? [], { day: run.key, text, model: used, at: new Date().toISOString() }); });
  } catch (e) { console.error("[diary] not written:", msg(e)); }
}

/** AGENTS → ORBIT's log: one page of entries, optionally searched. */
export async function diaryView(userId: string, q = "", page = 1) {
  return pageEntries((await load()).users[userId] ?? [], q.slice(0, 200), page);
}

/** CORE: the last 7 entries, only for "what did you learn this week?"-style questions ("" otherwise or on any failure). */
export const diaryContext = (userId: string, question: string) =>
  asksDiary(question) ? load().then((s) => diaryBlock(s.users[userId] ?? []), () => "") : Promise.resolve("");
