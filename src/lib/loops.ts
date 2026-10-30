// Open loops IO (logic: loops-pure.ts). Reads ORBIT's own records (commitment inbox, goals, missions, prospects, invoices,
// contracts, his CORE messages) and keeps <data dir>/loops.json: the last scan and his decisions per loop key, so a closed loop
// is never raised again. Rules only, no model call; Journal/LIFE is never read. Changes nothing outside this file except
// "Turn into task", which adds a confirmed task to his own commitment inbox (dayplan.ts).
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { localDay } from "./morning-pure";
import { CHAT_DAYS, DAY, decideLoop, detectLoops, loopsLine, openLoops, type Decided, type Loop } from "./loops-pure";

type Store = { at?: string; found: Loop[]; decided: Record<string, Decided> };
const file = () => path.join(orbitDataDir(), "loops.json");
const load = async (): Promise<Store> => {
  try { const j = JSON.parse(await readFile(file(), "utf8")); return { at: j.at, found: Array.isArray(j.found) ? j.found : [], decided: j.decided && typeof j.decided === "object" ? j.decided : {} }; }
  catch { return { found: [], decided: {} }; }
};
let saving: Promise<unknown> = Promise.resolve();
function update<T>(fn: (s: Store) => T): Promise<T> {
  const p = saving.catch(() => {}).then(async () => {
    const s = await load();
    const r = fn(s);
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(s));
    await rename(file() + ".tmp", file());
    return r;
  });
  saving = p;
  return p;
}
const soft = <T>(p: PromiseLike<T>, empty: T) => Promise.resolve(p).catch((e) => { console.error("[loops]", e instanceof Error ? e.message : e); return empty; });

/** Scan now (nightly, or on first open) and keep the result. Returns the open loops and the one line for the night report / brief. */
export async function scanLoops(sb: SupabaseClient, userId: string, now = Date.now()) {
  const since = new Date(now - CHAT_DAYS * DAY).toISOString();
  const [commitments, goals, missions, prospects, invoices, contracts, messages] = await Promise.all([
    soft(import("./dayplan").then((m) => m.commitments()), []),
    soft(import("./goals").then((m) => m.listGoals(sb, userId)).then((rs) => rs.map((r) => ({ id: r.id, title: r.doc.title, status: r.doc.status, updated_at: r.updated_at }))), []),
    soft(sb.from("missions").select("id, doc, status, updated_at").eq("user_id", userId).limit(50)
      .then((r) => ((r.data ?? []) as { id: string; doc: { objective: string }; status: string; updated_at: string }[]).map((m) => ({ id: m.id, objective: m.doc?.objective ?? "", status: m.status, updated_at: m.updated_at }))), []),
    soft(sb.from("prospects").select("id, name, stage, updated_at, notes, draft").eq("user_id", userId).limit(300).then((r) => import("./prospect-crm").then((c) => c.withTouch(r.data ?? []))), []),
    soft(import("./invoices").then((m) => m.allInvoices()), []),
    soft(import("./contracts").then((m) => m.listContracts()), []),
    soft(sb.from("messages").select("id, conversation_id, content, created_at").eq("user_id", userId).eq("role", "user").gte("created_at", since).order("created_at", { ascending: false }).limit(300).then((r) => r.data ?? []), []),
  ]);
  const found = detectLoops({ now, today: localDay(new Date(now)), commitments, goals, missions, prospects: prospects as never, invoices, contracts, messages });
  const s = await update((s) => { s.at = new Date(now).toISOString(); s.found = found; return s; });
  const open = openLoops(found, s.decided, localDay(new Date(now)));
  return { at: s.at!, open, line: loopsLine(open) || "No open loops" };
}

/** The panel's view: the last scan (scanning first if there never was one), minus what he closed or snoozed. */
export async function loopsView(sb: SupabaseClient, userId: string, now = Date.now()) {
  const s = await load();
  if (!s.at) return scanLoops(sb, userId, now);
  const open = openLoops(s.found, s.decided, localDay(new Date(now)));
  return { at: s.at, open, line: loopsLine(open) };
}

/** Brief: one line about the open loops from the last scan, or null. */
export async function loopsBrief(now = Date.now()) {
  const s = await load();
  const open = openLoops(s.found, s.decided, localDay(new Date(now)));
  return open.length ? { id: `loops:${s.at?.slice(0, 10)}`, title: loopsLine(open), say: `There ${open.length === 1 ? "is one open loop" : `are ${open.length} open loops`}, the oldest: ${open[0].title}.` } : null;
}

/** Close / Snooze / Turn into task. */
export async function actLoop(key: unknown, action: unknown, now = Date.now()): Promise<Decided | string> {
  const s = await load();
  const d = decideLoop(s.found, key, action, now, localDay(new Date(now)));
  if (typeof d === "string") return d;
  const loop = s.found.find((l) => l.key === key)!;
  if (d.action === "task") await (await import("./dayplan")).addTask(`${loop.next}: ${loop.title}`, { kind: "loop", ref: loop.key });
  return update((s) => { s.decided[key as string] = d; return d; });
}
