import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { SMART_MODEL, askClaude, type Lane } from "./claude";
import { orbitDataDir } from "./data-dir";
import { stopAllOn } from "./stop-all";
import { PAUSED_MSG } from "./stop-all-pure";
import { usageHoldFor } from "./usage-meter";
import { NICHE_SYSTEM, SHOP_SYSTEM, isNicheId, kitMarkdown, mergeBatch, newTrace, nichePrompt, parseKit, parseNiches, renderShop, scoutDue, shopPrompt, traceLine, type Kit, type Niche } from "./niche-pure";

// BUSINESS niche scout + shop-in-a-box store: <ORBIT data dir>/business/niches.json and business/shops/<niche id>/{index.html,kit.json,launch-kit.md}.
// Local only; ORBIT never deploys, uploads or posts a shop. Logic: niche-pure.ts.

type Store = { niches: Niche[]; lastAttempt?: string; lastOk?: string; lastError?: string };
const root = () => path.join(orbitDataDir(), "business");
const FILE = () => path.join(root(), "niches.json");
export const shopDir = (id: string) => path.join(root(), "shops", id);
const g = globalThis as unknown as { __orbitNicheWrite?: Promise<unknown>; __orbitNicheBusy?: string | null; __orbitNicheAbort?: AbortController | null };

async function load(): Promise<Store> {
  let raw: string;
  try { raw = await readFile(FILE(), "utf8"); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { niches: [] };
    throw e;
  }
  const s = JSON.parse(raw) as Store; // a broken file throws instead of being reset to empty
  if (!s || !Array.isArray(s.niches)) throw new Error("niches.json is unreadable");
  return s;
}

/** Read-modify-write, one at a time, saved atomically (tmp + rename). */
function update<T>(fn: (s: Store) => T): Promise<T> {
  const p = (g.__orbitNicheWrite ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await load();
    const out = fn(s);
    await mkdir(root(), { recursive: true });
    await writeFile(FILE() + ".tmp", JSON.stringify(s, null, 1));
    await rename(FILE() + ".tmp", FILE());
    return out;
  });
  g.__orbitNicheWrite = p;
  return p;
}

export async function nicheBoard() {
  const s = await load();
  const niches = s.niches.filter((n) => n.status !== "dismissed").sort((a, b) => Number(b.status === "kept") - Number(a.status === "kept") || b.at.localeCompare(a.at) || b.score - a.score);
  const kits: Record<string, Kit> = {};
  for (const n of niches) if (n.shopAt) kits[n.id] = JSON.parse(await readFile(path.join(shopDir(n.id), "kit.json"), "utf8").catch(() => "null"));
  return { niches, kits, lastOk: s.lastOk ?? null, lastAttempt: s.lastAttempt ?? null, lastError: s.lastError ?? null, busy: g.__orbitNicheBusy ?? null, dir: root() };
}

const held = (lane: Lane = "background") => (stopAllOn() ? PAUSED_MSG : usageHoldFor(lane));

/** One scout run: CORE searches the web (read-only tools) and proposes niches; only ideas with ≥2 links it really read are kept. */
export async function runScout(lane: Lane): Promise<number> {
  const h = held(lane);
  if (h) throw new Error(h);
  if (g.__orbitNicheBusy) throw new Error("The niche scout is already working");
  g.__orbitNicheBusy = "scout";
  const ac = (g.__orbitNicheAbort = new AbortController());
  const now = new Date();
  try {
    const avoid = await update((s) => { s.lastAttempt = now.toISOString(); return s.niches.slice(0, 30).map((n) => n.title); });
    const trace = newTrace();
    const r = await askClaude(nichePrompt(now.toISOString().slice(0, 10), avoid), NICHE_SYSTEM,
      { lane, purpose: "business.niche", model: SMART_MODEL, web: true, timeoutMs: 10 * 60_000, signal: ac.signal, onLine: (l) => traceLine(trace, l) });
    const { niches, rejected } = parseNiches(r.text, trace, new Date().toISOString(), randomUUID);
    if (!niches.length) throw new Error(`No idea passed the checks${rejected.length ? `: ${rejected.slice(0, 3).join("; ")}` : ""}`);
    await update((s) => { s.niches = mergeBatch(s.niches, niches, Date.now()); s.lastOk = new Date().toISOString(); s.lastError = rejected.length ? `Dropped: ${rejected.slice(0, 3).join("; ")}` : undefined; });
    return niches.length;
  } catch (e) {
    const msg = ac.signal.aborted ? "Stopped" : e instanceof Error ? e.message : String(e);
    await update((s) => { s.lastError = msg.slice(0, 300); }).catch(() => {});
    throw new Error(msg);
  } finally { g.__orbitNicheBusy = null; g.__orbitNicheAbort = null; }
}

/** From the scheduler tick: start a background run when a week has passed. Not awaited by the tick (a run takes minutes). */
export async function maybeWeeklyScout() {
  if (held() || g.__orbitNicheBusy || !scoutDue(await load(), Date.now())) return;
  console.log("[orbit] weekly niche scout starting");
  await runScout("background").then((n) => console.log(`[orbit] niche scout proposed ${n} idea(s)`), (e) => console.error("[orbit] niche scout failed:", e instanceof Error ? e.message : e));
}

/** Stop-all: cancel a running scout or shop build. */
export function abortNicheWork() { g.__orbitNicheAbort?.abort(); }

export async function setNicheStatus(id: string, status: "kept" | "dismissed") {
  return update((s) => { const n = s.niches.find((x) => x.id === id); if (n) n.status = status; return !!n; });
}

/** Shop-in-a-box for a kept idea, on the owner's click: copy from CORE (no tools), page rendered locally. Nothing is published. */
export async function buildShop(id: string, signal: AbortSignal): Promise<Kit> {
  const h = held("foreground");
  if (h) throw new Error(h);
  const n = (await load()).niches.find((x) => x.id === id);
  if (!n) throw new Error("Not found");
  if (n.status !== "kept") throw new Error("Keep the idea first");
  if (g.__orbitNicheBusy) throw new Error("The niche scout is busy; try again when it's done");
  g.__orbitNicheBusy = `shop:${id}`;
  const ac = (g.__orbitNicheAbort = new AbortController());
  try {
    const r = await askClaude(shopPrompt(n), SHOP_SYSTEM, { lane: "foreground", purpose: "business.shop", timeoutMs: 4 * 60_000, signal: AbortSignal.any([signal, ac.signal]) });
    const kit = parseKit(r.text);
    if (typeof kit === "string") throw new Error(`CORE's kit didn't pass the checks: ${kit}`);
    const dir = shopDir(id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "index.html"), renderShop(kit));
    await writeFile(path.join(dir, "kit.json"), JSON.stringify(kit, null, 1));
    await writeFile(path.join(dir, "launch-kit.md"), kitMarkdown(kit, n));
    await update((s) => { const x = s.niches.find((y) => y.id === id); if (x) x.shopAt = new Date().toISOString(); });
    return kit;
  } finally { g.__orbitNicheBusy = null; g.__orbitNicheAbort = null; }
}

/** The saved landing page, or null. */
export async function readShop(id: string): Promise<string | null> {
  if (!isNicheId(id)) return null;
  return readFile(path.join(shopDir(id), "index.html"), "utf8").catch(() => null);
}
