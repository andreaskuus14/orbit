import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { listFacts, FactsMissing } from "./facts";
import { parseVec } from "./sleep-pure";
import { weekKey } from "./weekly-pure";
import { dupCandidates, factCandidates, pickWeekly, decide, type HMem, type HygieneUser } from "./memory-hygiene-pure";

// Weekly memory hygiene: the first MEMORY visit of a week computes at most 3 proposals (no model call) and keeps them in
// <ORBIT data dir>/hygiene.json with the dismissed keys. Nothing is changed here: Accept runs the existing memory/fact routes.

type State = { users: Record<string, HygieneUser> };
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
    u = s.users[userId] = { week: weekKey(now), proposals: await compute(sb, userId, u?.dismissed ?? []), dismissed: u?.dismissed ?? [] };
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
  return {
    week: u.week,
    proposals: u.proposals.filter((p) => p.status !== "pending" || p.ids.every((id) => label.get(id)?.live))
      .map((p) => ({ ...p, items: p.ids.map((id) => ({ id, ...(label.get(id) ?? { title: "(gone)", at: "", live: false }) })) })),
  };
}

export async function decideHygiene(sb: SupabaseClient, userId: string, key: string, decision: "accepted" | "dismissed"): Promise<string> {
  const s = await load(), u = s.users[userId];
  if (!u) return "That suggestion is gone";
  const next = decide(u, key, decision);
  if (typeof next === "string") return next;
  s.users[userId] = next;
  await store(s);
  return "";
}
