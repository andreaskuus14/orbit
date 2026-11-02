// Entity graph + contradiction check, IO half (rules: entity-graph-pure.ts). Rebuilt by the night shift's hygiene step and on the
// first MEMORY visit; no model call, so nothing here leaves ORBIT. Journal rows are never even read (query filter + pure usable()).
// State: <ORBIT data dir>/entities.json per user: the last scan (suggestions and questions, ids + short labels) and his decisions.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { isMissingColumn } from "./provenance-pure";
import { listFacts, FactsMissing } from "./facts";
import {
  contradictionBrief, decideEntity, emptyDecisions, findContradictions, gather, mergeSuggestions, outdatedClaims, outdatedLabel, resolveGraph, undoable, usable,
  type Contradiction, type Outdated, type EntityDecisions, type MemIn, type MergeHist, type MergeSuggestion,
} from "./entity-graph-pure";
import { entityCards, type Card } from "./entity-memory-pure";

type UserEnt = { at?: string; entities?: number; merges: MergeSuggestion[]; contradictions: Contradiction[]; decisions: EntityDecisions; outdated?: Outdated[]; cards?: Card[] };
type Store = { users: Record<string, UserEnt> };
const file = () => path.join(orbitDataDir(), "entities.json");
const LIMIT = 500; // budget: newest 500 non-journal memories (resolution is O(n²) over distinct names, capped at 800)
const g = globalThis as unknown as { __orbitEntities?: Promise<unknown> };
const load = async (): Promise<Store> => { try { const j = JSON.parse(await readFile(file(), "utf8")); return j?.users && typeof j.users === "object" ? j : { users: {} }; } catch { return { users: {} }; } };
const empty = (): UserEnt => ({ merges: [], contradictions: [], decisions: emptyDecisions() });

function update<T>(userId: string, fn: (u: UserEnt) => T): Promise<T> {
  const p = (g.__orbitEntities ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await load(), u = (s.users[userId] ??= empty()), out = fn(u);
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(s));
    await rename(file() + ".tmp", file());
    return out;
  });
  g.__orbitEntities = p;
  return p;
}

/** With provenance (migration 0019) when applied, so conflicts settle by type; plain rows until then. */
async function memRows(sb: SupabaseClient, userId: string) {
  const q = (cols: string) => sb.from("memories").select(cols).eq("user_id", userId).neq("kind", "journal").order("created_at", { ascending: false }).limit(LIMIT);
  const r = await q("id, kind, title, content, created_at, source, tags, confirmation");
  return isMissingColumn(r.error) ? q("id, kind, title, content, created_at, source, tags") : r;
}

/** Recompute suggestions and questions from memories (never journal), current beliefs and his People list. */
export async function scanEntities(sb: SupabaseClient, userId: string): Promise<{ merges: number; contradictions: number }> {
  const [mem, facts, people, prospects] = await Promise.all([
    memRows(sb, userId),
    listFacts(sb, userId).catch((e) => { if (e instanceof FactsMissing) return []; throw e; }),
    import("./people").then((m) => m.localPeople(), () => []),
    // BUSINESS companies, so one company is one identity across BUSINESS and MEMORY (records only; best-effort)
    sb.from("prospects").select("id, name, contact, created_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(300).then((r) => r.data ?? [], () => []),
  ]);
  if (mem.error) throw mem.error;
  const memories = usable(((mem.data ?? []) as unknown as MemIn[]).map((m) => ({ ...m, title: String(m.title ?? ""), content: String(m.content ?? "") })));
  const { mentions, claims } = gather({ memories, facts, people, prospects: prospects as { id: string; name: string; contact: string | null; created_at: string }[] });
  return update(userId, (u) => {
    const { ents, related } = resolveGraph(mentions, u.decisions);
    u.at = new Date().toISOString(); u.entities = ents.length;
    u.merges = mergeSuggestions(ents, undefined, { related, claims });
    u.contradictions = findContradictions(claims, ents, u.decisions);
    u.outdated = outdatedClaims(claims, ents, u.decisions).slice(0, 300); // memories saying a value a newer/stronger one replaced
    u.cards = entityCards(claims, ents, u.decisions); // CORE's entity-grouped view (facts.ts factsContext)
    return { merges: u.merges.length, contradictions: u.contradictions.length };
  });
}

/** What MEMORY shows; scans once if there has never been a scan (before the first night). */
export async function entitiesView(sb: SupabaseClient, userId: string): Promise<UserEnt & { merged: MergeHist[] }> {
  const u = (await load()).users[userId];
  if (!u?.at) await scanEntities(sb, userId);
  const v = (await load()).users[userId] ?? empty();
  return { ...v, merged: undoable(v.decisions), decisions: emptyDecisions() }; // the panel needs only the open items and what can be undone
}

/** His click; the next scan uses it. A merge never edits People or memories: it only lets claims group across names. */
export function decideEntityKey(userId: string, key: string, choice: string): Promise<string> {
  return update(userId, (u) => {
    const d = decideEntity(u.decisions, u, key, choice);
    if (typeof d === "string") return d;
    u.decisions = d;
    u.merges = u.merges.filter((m) => m.key !== key);
    u.contradictions = u.contradictions.filter((c) => c.key !== key);
    return "";
  });
}

/** The morning brief's one line (null when nothing disagrees). */
export const entitiesBrief = async (userId: string) => contradictionBrief((await load()).users[userId]?.contradictions ?? []);

/** Entity cards as of the last scan ([] before the first). */
export const cardsOf = async (userId: string): Promise<Card[]> => (await load()).users[userId]?.cards ?? [];

/** memory id → its "superseded" label for CORE's retrieval (as of the last scan; his "Which is right?" answer counts from the next one). */
export async function outdatedNotes(userId: string): Promise<Map<string, string>> {
  const by = new Map<string, Outdated[]>();
  for (const o of (await load()).users[userId]?.outdated ?? []) by.set(o.id, [...(by.get(o.id) ?? []), o]);
  return new Map([...by].map(([id, xs]) => [id, outdatedLabel(xs)]));
}
