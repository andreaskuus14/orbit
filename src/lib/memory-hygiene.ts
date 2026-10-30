import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { listFacts, FactsMissing } from "./facts";
import { parseVec } from "./sleep-pure";
import { weekKey } from "./weekly-pure";
import { dupCandidates, factCandidates, pickWeekly, type HMem } from "./memory-hygiene-pure";
import { buildQueue, decideReview, STALE_PROJECT_DAYS, type Decision, type ReviewState } from "./memory-review-pure";

// Weekly memory hygiene: the first MEMORY visit of a week computes at most 3 proposals (no model call) and keeps them in
// <ORBIT data dir>/hygiene.json with the dismissed keys. Nothing is changed here: Accept runs the existing memory/fact routes.

type State = { users: Record<string, ReviewState> };
const file = () => path.join(orbitDataDir(), "hygiene.json");
async function load(): Promise<State> {
  try { const j = JSON.parse(await readFile(file(), "utf8")); return j?.users && typeof j.users === "object" ? j : { users: {} }; } catch { return { users: {} }; }
}
async function store(s: State) {
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file() + ".tmp", JSON.stringify(s));
  await rename(file() + ".tmp", file());
}

async function compute(sb: SupabaseClient, userId: string, dismissed: string[]) {
  const { data, error } = await sb.from("memories").select("id, title, content, kind, tags, created_at, embedding").eq("user_id", userId)
    .neq("kind", "conversation").order("created_at", { ascending: false }).limit(300); // shortcut: newest 300 only, like the sleep loop
  if (error) throw error;
  const mems: HMem[] = (data ?? []).map((m) => ({ ...m, content: String(m.content ?? ""), tags: (m.tags ?? []) as string[], embedding: parseVec(m.embedding) }));
  const facts = await listFacts(sb, userId).catch((e) => { if (e instanceof FactsMissing) return []; throw e; });
  return pickWeekly([...dupCandidates(mems), ...factCandidates(facts, Date.now())], dismissed);
}

/** This week's proposals with the labels the MEMORY panel shows (memory titles, belief statements). Items deleted meanwhile drop out. */
export async function getHygiene(sb: SupabaseClient, userId: string, now = new Date()) {
  const s = await load();
  let u = s.users[userId];
  if (u?.week !== weekKey(now)) {
    u = s.users[userId] = { ...u, week: weekKey(now), proposals: await compute(sb, userId, u?.dismissed ?? []), dismissed: u?.dismissed ?? [] };
    await store(s);
  }
  const memIds = u.proposals.filter((p) => p.action === "merge").flatMap((p) => p.ids);
  const factIds = u.proposals.filter((p) => p.action === "retract").flatMap((p) => p.ids);
  const [mems, facts] = await Promise.all([
    memIds.length ? sb.from("memories").select("id, title, kind, created_at").eq("user_id", userId).in("id", memIds) : { data: [] },
    factIds.length ? sb.from("memory_facts").select("id, subject, statement, status, created_at").eq("user_id", userId).in("id", factIds) : { data: [] },
  ]);
  const label = new Map<string, { title: string; kind?: string; at: string; live: boolean }>();
  for (const m of mems.data ?? []) label.set(m.id, { title: m.title, kind: m.kind, at: m.created_at, live: true });
  for (const f of facts.data ?? []) label.set(f.id, { title: `${f.subject}: ${f.statement}`, at: f.created_at, live: f.status === "current" });
  const proposals = u.proposals.filter((p) => p.status !== "pending" || p.ids.every((id) => label.get(id)?.live))
    .map((p) => ({ ...p, items: p.ids.map((id) => ({ id, ...(label.get(id) ?? { title: "(gone)", at: "", live: false }) })) }));
  return { week: u.week, proposals, queue: await queue(sb, userId, u, proposals, now.getTime()) };
}

/** MEM05: the one review queue (memory-review-pure.ts). Journals and chat summaries never enter it; nothing goes to a model. */
async function queue(sb: SupabaseClient, userId: string, u: ReviewState, proposals: Parameters<typeof buildQueue>[0]["proposals"], now: number) {
  const cols = "id, title, content, kind, tags, folder, source, created_at, updated_at";
  const mine = (c: string) => sb.from("memories").select(c).eq("user_id", userId).not("kind", "in", "(journal,conversation)");
  const cutoff = new Date(now - STALE_PROJECT_DAYS * 86_400_000).toISOString();
  const ids = proposals.filter((p) => p.action === "merge").flatMap((p) => p.ids);
  const [inferred, stale, merged, facts] = await Promise.all([
    mine(`${cols}, confirmation`).or("confirmation.eq.suggested,source.eq.inferred").limit(50).then((r) => (r.error ? { data: [] } : r)), // until 0019: no confirmation column
    mine(cols).lt("updated_at", cutoff).order("updated_at").limit(100),
    ids.length ? mine(cols).in("id", ids) : { data: [] },
    listFacts(sb, userId).catch((e) => { if (e instanceof FactsMissing) return []; throw e; }),
  ]);
  const entities = await import("./entity-graph").then((m) => m.entitiesView(sb, userId)).catch((e) => { console.error("[hygiene] entities", e); return null; });
  type Row = { content?: unknown; tags?: unknown } & Record<string, unknown>;
  const mems = ([...(inferred.data ?? []), ...(stale.data ?? []), ...(merged.data ?? [])] as unknown as Row[])
    .map((m) => ({ ...m, content: String(m.content ?? ""), tags: (m.tags ?? []) as string[] })) as unknown as Parameters<typeof buildQueue>[0]["mems"];
  return buildQueue({ proposals, mems, facts, entities }, u, now);
}

/** The owner's decision on a queue item (the action itself already ran through the memory/fact routes). */
export async function decideHygiene(userId: string, key: string, decision: Decision) {
  const s = await load();
  s.users[userId] = decideReview(s.users[userId] ?? { week: "", proposals: [], dismissed: [] }, key, decision, Date.now());
  await store(s);
}
