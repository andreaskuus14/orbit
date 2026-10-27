import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir";
import { safeFetch } from "./memory";
import { UA, polite } from "./reach/net";
import { stopAllOn } from "./stop-all";
import { scoutDue } from "./niche-pure";
import { addWeek, checkRivalUrls, extractItems, latestPair, parseRivalStore, rivalReport, robotsAllows, type RivalReport, type RivalSnap, type RivalStore } from "./rivals-pure";

// BUSINESS competitor watch: <ORBIT data dir>/business/rivals.json (the owner's links per kept niche + the last 8 weekly snapshots).
// Read-only: public pages through safeFetch (SSRF guard, 10 s timeout, size cap), no cookies or logins, robots.txt respected,
// polite per-host gaps (reach/net). No model calls. Logic: rivals-pure.ts.

const FILE = () => path.join(orbitDataDir(), "business", "rivals.json");
const g = globalThis as unknown as { __orbitRivalsWrite?: Promise<unknown>; __orbitRivalsBusy?: boolean };

const load = async (): Promise<RivalStore> => parseRivalStore(await readFile(FILE(), "utf8").catch((e) => { if (e.code === "ENOENT") return ""; throw e; }));
function update<T>(fn: (s: RivalStore) => T): Promise<T> {
  const p = (g.__orbitRivalsWrite ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await load(), out = fn(s);
    await mkdir(path.dirname(FILE()), { recursive: true });
    await writeFile(FILE() + ".tmp", JSON.stringify(s));
    await rename(FILE() + ".tmp", FILE());
    return out;
  });
  g.__orbitRivalsWrite = p;
  return p;
}

const kept = async () => (await (await import("./niche")).nicheBoard()).niches.filter((n) => n.status === "kept");

export async function rivalsBoard() {
  const [s, niches] = await Promise.all([load(), kept()]);
  const reports: Record<string, RivalReport & { at: string }> = {};
  for (const n of niches) { const p = latestPair(s, n.id); if (p.cur) reports[n.id] = { ...rivalReport(n, p.cur, p.prev), at: p.at! }; }
  return { urls: s.urls, reports, lastOk: s.lastOk ?? null, lastError: s.lastError ?? null, busy: !!g.__orbitRivalsBusy };
}

export async function setRivalUrls(nicheId: string, raw: unknown): Promise<string> {
  const urls = checkRivalUrls(raw);
  if (typeof urls === "string") return urls;
  if (!(await kept()).some((n) => n.id === nicheId)) return "Keep the niche first";
  await update((s) => { if (urls.length) s.urls[nicheId] = urls; else delete s.urls[nicheId]; });
  return "";
}

/** Pages a run would read now (0 when not due): the night planner's budget estimate. */
export async function rivalsDue(now = Date.now()): Promise<number> {
  const s = await load();
  if (g.__orbitRivalsBusy || !scoutDue(s, now)) return 0;
  const ids = new Set((await kept()).map((n) => n.id));
  return Object.entries(s.urls).filter(([id]) => ids.has(id)).reduce((k, [, u]) => k + u.length, 0);
}

const text = (url: string, accept: string, max: number) => polite(url, async () => (await safeFetch(url, accept, UA, max)).res.text());

/** One weekly read of every kept niche's competitor pages; returns the reports. */
export async function runRivals(signal?: AbortSignal): Promise<RivalReport[]> {
  if (g.__orbitRivalsBusy) throw new Error("The competitor watch is already running");
  g.__orbitRivalsBusy = true;
  try {
    await update((s) => { s.lastAttempt = new Date().toISOString(); });
    const [s, niches] = await Promise.all([load(), kept()]);
    const robots = new Map<string, Promise<string | null>>(); // origin → robots.txt ("" = none), null = unreadable
    const week: Record<string, RivalSnap[]> = {};
    for (const n of niches) {
      const urls = s.urls[n.id];
      if (!urls?.length) continue;
      week[n.id] = [];
      for (const url of urls) {
        if (signal?.aborted || stopAllOn()) throw new Error("Stopped");
        const u = new URL(url);
        if (!robots.has(u.origin)) robots.set(u.origin, text(`${u.origin}/robots.txt`, "text/plain", 500_000).catch((e: Error) => (/answered 4\d\d/.test(e.message) ? "" : null)));
        const rb = await robots.get(u.origin)!;
        let snap: RivalSnap;
        if (rb === null) snap = { url, items: [], error: "robots.txt unreadable, skipped" };
        else if (!robotsAllows(rb, u.pathname + u.search)) snap = { url, items: [], error: "robots.txt disallows it" };
        else snap = await text(url, "text/html,application/xhtml+xml", 3_000_000)
          .then((html) => ({ url, items: extractItems(html, url) }), (e: Error) => ({ url, items: [], error: (e.name === "TimeoutError" ? "timed out" : e.message).slice(0, 120) }));
        if (!snap.error && !snap.items.length) snap.error = "no products found on the page";
        week[n.id].push(snap);
      }
    }
    const at = new Date().toISOString();
    const after = await update((x) => { Object.assign(x, addWeek(x, at, week)); x.lastOk = at; x.lastError = undefined; return structuredClone(x); });
    return niches.filter((n) => week[n.id]).map((n) => { const p = latestPair(after, n.id); return rivalReport(n, p.cur!, p.prev); });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    await update((s) => { s.lastError = m.slice(0, 300); }).catch(() => {});
    throw e;
  } finally { g.__orbitRivalsBusy = false; }
}
