import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "../data-dir";
import { stopAllOn } from "../stop-all";
import { REACH_SOURCES, defaultSources, parseSources, scoreItems, type ReachItem, type ReachSource, type ReachSources, type Scored } from "./pure";
import { readReddit } from "./reddit";
import { readKick } from "./kick";
import { readTwitch } from "./twitch";
import { readBsky } from "./bsky";

// Reach: one scan of every watched source at most every 3 h (single-flight, skipped while Stop-all is on), cached in memory.
// Started by whoever asks first (Herald poll, Rising tab, CORE); the watchlists live in <data dir>/reach.json (plain names, no secrets).
export type ReachScan = { at: number; items: Scored[]; hints: Record<ReachSource, string[]>; running: boolean; stopped?: boolean };
export const SCAN_MS = 3 * 3_600_000;
const RETRY_MS = 15 * 60_000;
const file = () => path.join(orbitDataDir(), "reach.json");
const emptyHints = (): Record<ReachSource, string[]> => ({ reddit: [], kick: [], twitch: [], bsky: [] });
const g = globalThis as unknown as { __orbitReach?: { scan: ReachScan; next: number; p?: Promise<ReachScan> } };
const st = (g.__orbitReach ??= { scan: { at: 0, items: [], hints: emptyHints(), running: false }, next: 0 });

export async function getSources(): Promise<ReachSources> {
  const raw = await readFile(file(), "utf8").catch(() => null);
  if (raw !== null) { try { return parseSources(JSON.parse(raw), defaultSources([], [])); } catch { /* corrupt: defaults below */ } }
  try { // first run: seed from the Video Scout's creators and keywords
    const [{ scoutView }, { allKeywords }] = await Promise.all([import("../clips/scout"), import("../clips/scout-pure")]);
    const sv = await scoutView();
    return defaultSources(sv.scout.watchlist.map((w) => w.title), allKeywords(sv.scout));
  } catch { return defaultSources([], []); }
}

export async function saveSources(s: ReachSources): Promise<void> {
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file() + ".tmp", JSON.stringify(s, null, 2));
  await rename(file() + ".tmp", file());
  st.next = 0; // new lists: scan again on the next ask
}

async function scan(now: number): Promise<ReachScan> {
  const s = await getSources();
  const hints = emptyHints(), items: ReachItem[] = [];
  const runs: [ReachSource, () => Promise<{ items: ReachItem[]; hints: string[] }>][] = [
    ["reddit", () => readReddit(s.reddit)], ["kick", () => readKick(s.kick)], ["twitch", () => readTwitch(s.twitch, now)], ["bsky", () => readBsky(s.bsky, now)]];
  await Promise.all(runs.map(async ([src, run]) => { // different hosts run in parallel; each host stays sequential in net.ts
    if (!s[src].length && src !== "twitch") { hints[src].push("No sources listed; add some in 🌐 Reach sources"); return; }
    try { const r = await run(); items.push(...r.items); hints[src].push(...r.hints); }
    catch (e) { hints[src].push(e instanceof Error ? e.message.slice(0, 160) : "failed"); }
  }));
  return { at: now, items: scoreItems(items, Date.now()).slice(0, 200), hints, running: false };
}

/** The cached scan; starts a fresh one in the background when stale (not while Stop-all is on). */
export function reachScan(now = Date.now()): ReachScan {
  if (stopAllOn()) return { ...st.scan, stopped: true };
  if (!st.p && now >= st.next) {
    st.next = now + SCAN_MS;
    st.scan = { ...st.scan, running: true };
    st.p = scan(now).then((r) => {
      st.scan = r;
      if (!r.items.length && REACH_SOURCES.some((x) => r.hints[x].length)) st.next = Date.now() + RETRY_MS; // nothing came back: retry sooner
      return r;
    }, (e) => {
      console.error("[reach] scan:", e instanceof Error ? e.message : e);
      st.scan = { ...st.scan, running: false };
      st.next = Date.now() + RETRY_MS;
      return st.scan;
    }).finally(() => { st.p = undefined; });
  }
  return st.scan;
}

/** For CORE: the cached scan, waiting up to `waitMs` for a first one that is still running. */
export async function reachNow(waitMs = 45_000): Promise<ReachScan> {
  const s = reachScan();
  if (s.at || !st.p) return s;
  await Promise.race([st.p, new Promise((r) => setTimeout(r, waitMs))]);
  return st.scan;
}
