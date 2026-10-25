import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude, recordUsage, FAST_MODEL } from "./claude";
import { orbitDataDir } from "./data-dir";
import { stopAllOn } from "./stop-all";
import { usageHold } from "./usage-meter";
import { DIGEST_SYSTEM, buildDigest, digestDue, digestPrompt, digestStats, parseDigest, type ArchDigest } from "./arch-digest-pure";

// ARCH weekly studio digest (roadmap 5.6): Sunday from 17:00 (Monday catch-up), scheduler tick, background lane. At most one
// FAST_MODEL call per user per week, and only when there were critiques. Reads only memories tagged "arch", never journals.
// State: <ORBIT data dir>/arch-digest.json = {last, users: {id: digest}}.

type State = { last?: string; users: Record<string, ArchDigest> };
const file = () => path.join(orbitDataDir(), "arch-digest.json");
const load = async (): Promise<State> => {
  try { const j = JSON.parse(await readFile(file(), "utf8")); return j?.users && typeof j.users === "object" ? j : { users: {} }; } catch { return { users: {} }; }
};
async function store(s: State) {
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file() + ".tmp", JSON.stringify(s));
  await rename(file() + ".tmp", file());
}

export const readArchDigest = async (userId: string): Promise<ArchDigest | null> => (await load()).users[userId] ?? null;

/** Called every scheduler tick; builds at most once a week. Never throws. */
export async function maybeArchDigest(sb: SupabaseClient, userIds: string[], now = new Date()): Promise<void> {
  try {
    const state = await load();
    const week = digestDue(now, state.last);
    if (!week || stopAllOn()) return;
    state.last = week; // claimed before any call, so a crash can't make it run twice
    await store(state);
    const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    for (const id of userIds) {
      const { data, error } = await sb.from("memories").select("id, title, content, tags, created_at").eq("user_id", id).contains("tags", ["arch"])
        .neq("kind", "journal").gte("created_at", since).order("created_at", { ascending: false }).limit(200);
      if (error) { console.error("[orbit] arch digest failed:", error.message); continue; }
      const s = digestStats(data ?? []);
      let ai = null;
      if (s.list.length && !usageHold()) { // held near the usage budget: the digest still comes, with a focus from the numbers
        const r = await askClaude(digestPrompt(s.list), DIGEST_SYSTEM, { lane: "background", model: FAST_MODEL, purpose: "arch.digest" }).catch(() => null);
        if (r) { await recordUsage(sb, id, "arch.digest", r, FAST_MODEL).catch(() => {}); ai = parseDigest(r.text, s.list.length); }
      }
      state.users[id] = buildDigest(week, s, ai, now);
    }
    await store(state);
  } catch (e) { console.error("[orbit] arch digest failed:", e instanceof Error ? e.message : e); }
}
