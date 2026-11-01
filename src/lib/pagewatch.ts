import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { orbitDataDir } from "./data-dir";
import { safeFetch } from "./memory";
import { UA, polite } from "./reach/net";
import { stopAllOn } from "./stop-all";
import { KEEP_CHANGES, MAX_WATCHES, applyCheck, changesSince, changesText, checkWatchInput, listText, pageText, parseStore, pickDue, robotsGate, watchBlocked,
  type CheckResult, type Watch, type WatchStore } from "./pagewatch-pure";

// INTELLIGENCE → Watches (page-change watch): <ORBIT data dir>/pagewatch.json. Checked by the server scheduler's minute tick (scheduler.ts),
// at most PER_TICK due watches a tick. Read-only public pages: safeFetch (SSRF guard, 10 s timeout, 2 MB cap), no cookies or logins,
// robots.txt respected, polite per-host gaps and day caps (reach/net), an honest User-Agent. No model calls. Logic: pagewatch-pure.ts.

const FILE = () => path.join(orbitDataDir(), "pagewatch.json");
const g = globalThis as unknown as { __orbitPageWatch?: Promise<unknown>; __orbitPageWatchBusy?: boolean; __orbitRobots?: Map<string, { at: number; txt: Promise<string | null> }> };
const robotsCache = (g.__orbitRobots ??= new Map());

const load = async (): Promise<WatchStore> => parseStore(await readFile(FILE(), "utf8").catch((e) => { if (e.code === "ENOENT") return "{}"; throw e; }));
function update<T>(fn: (s: WatchStore) => T): Promise<T> {
  const p = (g.__orbitPageWatch ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await load(), out = fn(s);
    await mkdir(path.dirname(FILE()), { recursive: true });
    await writeFile(FILE() + ".tmp", JSON.stringify(s));
    await rename(FILE() + ".tmp", FILE());
    return out;
  });
  g.__orbitPageWatch = p;
  return p;
}

const get = (url: string, accept: string, max: number) => polite(url, () => safeFetch(url, accept, UA, max));
const msg = (e: unknown) => (e instanceof Error ? (e.name === "TimeoutError" ? "timed out" : e.message) : "request failed").slice(0, 160);

/** robots.txt per origin, cached 6 h: "" = none (4xx), null = unreadable. */
function robots(origin: string): Promise<string | null> {
  const hit = robotsCache.get(origin);
  if (hit && Date.now() - hit.at < 6 * 3_600_000) return hit.txt;
  const txt = get(`${origin}/robots.txt`, "text/plain", 500_000).then(({ res }) => res.text(), (e: Error) => (/answered 4\d\d/.test(e.message) ? "" : null));
  robotsCache.set(origin, { at: Date.now(), txt });
  return txt;
}

async function fetchWatch(w: Watch): Promise<CheckResult> {
  try {
    const blocked = robotsGate(await robots(new URL(w.url).origin), w.url);
    if (blocked) return { ok: false, error: blocked };
    const { res } = await get(w.url, "text/html,text/plain", 2_000_000);
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|xhtml/.test(type)) return { ok: false, error: `not a web page (${type || "unknown type"})` };
    return pageText(await res.text(), !type.includes("text/plain"), w.focus);
  } catch (e) { return { ok: false, error: msg(e) }; }
}

async function check(w: Watch): Promise<void> {
  const r = await fetchWatch(w), now = Date.now();
  await update((s) => {
    const i = s.watches.findIndex((x) => x.id === w.id);
    if (i < 0) return; // removed meanwhile
    const { watch, change } = applyCheck(s.watches[i], r, now, randomUUID());
    s.watches[i] = watch;
    if (change) s.changes = [...s.changes, change].slice(-KEEP_CHANGES);
  });
}

/** Scheduler hook (every minute): due watches, oldest first, a few per tick. Never throws. */
export async function tickWatches(): Promise<void> {
  if (g.__orbitPageWatchBusy || stopAllOn()) return;
  g.__orbitPageWatchBusy = true;
  try {
    for (const w of pickDue((await load()).watches, Date.now())) { if (stopAllOn()) break; await check(w); }
  } catch (e) { console.error("[orbit] page watch failed:", msg(e)); }
  finally { g.__orbitPageWatchBusy = false; }
}

/** The Watches list: watches without their snapshot text, plus recent changes. */
export async function watchBoard() {
  const s = await load();
  return { watches: s.watches.map(({ snaps, ...w }) => ({ ...w, versions: snaps.length })), changes: changesSince(s).slice(0, 60) };
}

export async function addWatch(b: Record<string, unknown>): Promise<{ watch: Watch } | { error: string }> {
  const v = checkWatchInput(b);
  if (typeof v === "string") return { error: v };
  return update((s) => {
    const had = s.watches.find((w) => w.url === v.url && w.focus === v.focus);
    if (had) return { watch: had };
    if (s.watches.length >= MAX_WATCHES) return { error: `At most ${MAX_WATCHES} watches: remove one first` };
    const watch: Watch = { id: randomUUID(), ...v, important: b.important === true, created: new Date().toISOString(), snaps: [] };
    s.watches.push(watch);
    return { watch };
  });
}

export const removeWatch = (id: string) => update((s) => {
  const n = s.watches.length;
  s.watches = s.watches.filter((w) => w.id !== id);
  s.changes = s.changes.filter((c) => c.watch !== id);
  return n !== s.watches.length;
});

/** important: owner-marked (its changes go to Needs you); seen: he looked at the latest change. */
export const markWatch = (id: string, p: { important?: boolean; seen?: boolean }) => update((s) => {
  const w = s.watches.find((x) => x.id === id);
  if (!w) return false;
  if (typeof p.important === "boolean") w.important = p.important;
  if (p.seen) w.seenAt = new Date().toISOString();
  return true;
});

/** "Check now": one watch, right away (still robots + polite). */
export async function checkNow(id: string): Promise<boolean> {
  const w = (await load()).watches.find((x) => x.id === id);
  if (!w || stopAllOn()) return false;
  await check(w);
  return true;
}

/** Readers for brief.ts / needs-you.ts (soft: callers catch). */
export const watchStore = load;

/** CORE tools. watch_add writes a local record only; page text in results is third-party data. */
export async function runWatchTool(tool: string, i: Record<string, unknown>, question: string, tainted: boolean): Promise<string> {
  if (tool === "watch_list") return listText(await load(), Date.now());
  if (tool === "watch_changes") {
    const since = typeof i.since === "string" && Date.parse(i.since) ? Date.parse(i.since) : Date.now() - 7 * 86_400_000;
    return changesText(await load(), since);
  }
  const no = watchBlocked(question, tainted);
  if (no) return `Error: ${no}`;
  const r = await addWatch({ url: i.url, focus: i.selector, every: i.every, purpose: i.purpose });
  if ("error" in r) return `Error: ${r.error}`;
  const w = r.watch;
  return `Watching ${w.url}${w.focus ? ` (focus: ${w.focus})` : ""} every ${w.everyH} h as "${w.purpose}". First check within a minute or two (if ORBIT's scheduler is on); changes show in INTELLIGENCE → Watches and the morning brief. He can mark it important there to get changes in Needs you.`;
}
