import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir";
import { logActivity } from "./activity";
import { DAILY_UNITS, account, pacificDay, parseQuota, quotaLeft, quotaMessage, today, totalUnits, weightedCost, type QuotaGroup, type QuotaLedger } from "./youtube-quota-pure";

type Scope = { caller: string; group: QuotaGroup; units: number };
type State = { ledger?: QuotaLedger; chain: Promise<void>; timer?: NodeJS.Timeout };
const g = globalThis as unknown as { __orbitYoutubeQuota?: State; __orbitYoutubeScope?: AsyncLocalStorage<Scope> };
const state = g.__orbitYoutubeQuota ??= { chain: Promise.resolve() };
const scope = g.__orbitYoutubeScope ??= new AsyncLocalStorage<Scope>();
const file = () => path.join(orbitDataDir(), "youtube-quota.json");
function ledger(): QuotaLedger {
  if (state.ledger) return state.ledger;
  try {
    const parsed = parseQuota(readFileSync(file(), "utf8"));
    if (!parsed) throw new Error("Invalid quota ledger");
    return state.ledger = parsed;
  } catch (e) {
    const now = Date.now(), day = pacificDay(now);
    let used = 0;
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") used = DAILY_UNITS; // fail closed, never grant fresh quota for a damaged ledger
    else try {
      // Read-only upgrade from the existing scout total. Same root as factory.ts, without importing the renderer.
      const root = path.resolve(process.env.ORBIT_STUDIO_DIR || path.join(process.cwd(), "..", "orbit-studio"));
      const old = JSON.parse(readFileSync(path.join(root, "scout.json"), "utf8"))?.quota;
      if (old?.day === day && Number.isFinite(old.used)) used = Math.max(0, old.used);
    } catch (oldError) { if ((oldError as NodeJS.ErrnoException).code !== "ENOENT") used = DAILY_UNITS; }
    return state.ledger = { v: 1, days: used ? [{ day, notified: [], callers: { "legacy-unattributed": { group: "legacy", units: used, calls: 0, searches: 0, dataUnits: 0, analytics: 0 } } }] : [] };
  }
}
function save() {
  if (state.timer) return;
  state.timer = setTimeout(() => {
    state.timer = undefined; const text = JSON.stringify(ledger());
    state.chain = state.chain.then(async () => { await mkdir(path.dirname(file()), { recursive: true }); await writeFile(file() + ".tmp", text); await rename(file() + ".tmp", file()); })
      .catch(() => { console.error("[youtube] quota ledger could not be saved"); });
  }, 1000); state.timer.unref?.();
}
export class YoutubeQuotaError extends Error { constructor(readonly group: QuotaGroup) { super(quotaMessage(group)); } }
export function youtubeRemaining(group: QuotaGroup) { return quotaLeft(today(ledger(), Date.now()), group); }
export function requireYoutubeUnits(group: QuotaGroup, units: number) {
  if (youtubeRemaining(group) >= units) return;
  const l = ledger(), d = today(l, Date.now());
  if (!d.notified.includes(group)) {
    state.ledger = { v: 1, days: [...l.days.filter((x) => x.day !== d.day), { ...d, notified: [...d.notified, group] }].slice(-7) }; save();
    console.info(`[youtube] ${quotaMessage(group)}`);
    logActivity({ area: "system", title: quotaMessage(group) });
  }
  throw new YoutubeQuotaError(group);
}
/** Charge before every outbound attempt (including failures/retries), synchronously so concurrent callers cannot overshoot. */
export function meterYoutube(endpoint: string) {
  const s = scope.getStore() ?? { caller: "learning", group: "scout" as const, units: 0 };
  const cost = weightedCost(endpoint);
  if (cost) requireYoutubeUnits(s.group, cost);
  state.ledger = account(ledger(), s.caller, s.group, endpoint, Date.now()); s.units += cost; save();
}
export const withYoutubeBudget = <T>(caller: string, group: QuotaGroup, fn: (s: Scope) => Promise<T>): Promise<T> => scope.run({ caller, group, units: 0 }, () => fn(scope.getStore()!));
export function youtubeQuotaView() {
  const d = today(ledger(), Date.now());
  return { ...d, budget: DAILY_UNITS, used: totalUnits(d), shares: Object.fromEntries((["herald", "scout", "niche", "manual"] as const).map((g) => [g, { left: quotaLeft(d, g) }])),
    note: "ORBIT weighted budget: search=100, list=1. Google now has separate search/upload buckets. Upload requests in the renderer are not metered here." };
}
