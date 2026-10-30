// BUSINESS client records store: <ORBIT data dir>/prospect-crm.json, keyed by prospect id (rules: prospect-crm-pure.ts).
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir";
import { addEvent, contactKey, touch, type Crm, type EventKind, type Store } from "./prospect-crm-pure";

const FILE = () => path.join(orbitDataDir(), "prospect-crm.json");
const g = globalThis as unknown as { __orbitCrm?: Promise<unknown> };

export async function loadCrm(): Promise<Store> {
  try { const j = JSON.parse(await readFile(FILE(), "utf8")); if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("prospect-crm.json is unreadable"); return j; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return {}; throw e; } // a broken file throws instead of wiping the timelines
}
/** Read-modify-write, one at a time, saved atomically. */
export function updateCrm<T>(fn: (s: Store) => T): Promise<T> {
  const p = (g.__orbitCrm ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await loadCrm(), out = fn(s);
    await mkdir(path.dirname(FILE()), { recursive: true });
    await writeFile(FILE() + ".tmp", JSON.stringify(s));
    await rename(FILE() + ".tmp", FILE());
    return out;
  });
  g.__orbitCrm = p;
  return p;
}
/** A record for a prospect added before this store existed: manual, unverified only if its notes say it came from the web. */
const legacy = (p: { name: string; contact: string; notes?: string }): Crm =>
  ({ source: /Found on the web/i.test(p.notes ?? "") ? "web-find" : "manual", verified: !/Found on the web/i.test(p.notes ?? ""), key: contactKey(p.contact, p.name), events: [] });
/** BUSINESS timeline-aware rows for dueFollowups: same `touch` the BUSINESS panel uses; an unreadable store falls back to notes. */
export const withTouch = async <T extends { id: string }>(rows: T[]) => {
  const s = await loadCrm().catch((): Store => ({}));
  return rows.map((p) => ({ ...p, touch: s[p.id] ? touch(s[p.id].events) : null }));
};
export const crmOf = (s: Store, p: { id: string; name: string; contact: string; notes?: string }) => s[p.id] ?? legacy(p);

/** Log one event; never throws (the timeline must not break a send that already happened). */
export const logEvent = (p: { id: string; name: string; contact: string; notes?: string }, kind: EventKind, text?: string, at = new Date().toISOString()) =>
  updateCrm((s) => { s[p.id] = addEvent(crmOf(s, p), kind, at, text); }).catch(() => {});
