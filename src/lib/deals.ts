import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude, emit, recordUsage, MODEL, type Lane } from "./claude";
import { orbitDataDir } from "./data-dir";
import { stopAllOn } from "./stop-all";
import { PAUSED_MSG } from "./stop-all-pure";
import { usageHoldFor } from "./usage-meter";
import { localDay } from "./morning-pure";
import { pushLabel, quietAt } from "./remote-push-pure";
import { newTrace, traceLine } from "./niche-pure";
import {
  DEAL_SYSTEM, FRESH_MS, addObs, addWish, callsLeft, dailyLow, daytime, dealPrompt, dueWishes, mergeOffers, newAlerts, parseOffers, parseWish, recentMedian, sellerDraft, wishBlocked, wishlistText,
  type Found, type Obs, type Offer, type Wish,
} from "./deals-pure";

// Deal hunter store and runner (rules: deals-pure.ts): <ORBIT data dir>/deals.json. Hunts run from the scheduler tick (daytime, every 6 h),
// the night shift's "deals" slot, or the owner's "Hunt now" click. Each wish is one read-only web call (WebSearch/WebFetch);
// Stop-all, usageHold and a daily cap of calls stop it. Nothing is bought or sent: the seller draft is for him to copy.

type Store = {
  wishes: Wish[]; offers: Record<string, Offer[]>; obs: Record<string, Obs[]>; hunted: Record<string, string>; alerted: Record<string, number>;
  found: Found[]; day?: string; calls?: number; lastHunt?: string; lastError?: string;
};
const FILE = () => path.join(orbitDataDir(), "deals.json");
const g = globalThis as unknown as { __orbitDeals?: { write: Promise<unknown>; busy: boolean; ac: AbortController | null } };
const D = (g.__orbitDeals ??= { write: Promise.resolve(), busy: false, ac: null });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

async function load(): Promise<Store> {
  let raw: string;
  try { raw = await readFile(FILE(), "utf8"); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { wishes: [], offers: {}, obs: {}, hunted: {}, alerted: {}, found: [] };
    throw e;
  }
  const s = JSON.parse(raw) as Store; // a broken file throws instead of wiping his wishlist
  if (!s || !Array.isArray(s.wishes)) throw new Error("deals.json is unreadable");
  return { ...s, offers: s.offers ?? {}, obs: s.obs ?? {}, hunted: s.hunted ?? {}, alerted: s.alerted ?? {}, found: s.found ?? [] };
}
/** Read-modify-write, one at a time, saved atomically (tmp + rename). */
function update<T>(fn: (s: Store) => T): Promise<T> {
  const p = D.write.catch(() => {}).then(async () => {
    const s = await load(), out = fn(s);
    await mkdir(path.dirname(FILE()), { recursive: true });
    await writeFile(FILE() + ".tmp", JSON.stringify(s));
    await rename(FILE() + ".tmp", FILE());
    return out;
  });
  D.write = p;
  return p;
}

const held = (lane: Lane = "background") => (stopAllOn() ? PAUSED_MSG : usageHoldFor(lane));
/** Stop-all: cancel the running hunt. */
export function abortDealHunt() { D.ac?.abort(); }

export async function dealBoard() {
  const s = await load(), now = Date.now();
  return {
    wishes: s.wishes.filter((w) => w.status === "active"),
    offers: s.offers, drafts: Object.fromEntries(Object.values(s.offers).flat().filter((o) => o.great).map((o) => [o.id, sellerDraft(o, s.wishes.find((w) => w.id === o.wishId) ?? { region: "Estonia" })])),
    history: Object.fromEntries(Object.entries(s.obs).map(([id, o]) => [id, { low: dailyLow(o), median: recentMedian(o, now) }])),
    hunted: s.hunted, lastHunt: s.lastHunt ?? null, lastError: s.lastError ?? null, busy: D.busy, callsLeft: callsLeft(s, localDay(new Date(now))),
  };
}

export async function addWishItem(sb: SupabaseClient, userId: string, b: Record<string, unknown>): Promise<Wish | string> {
  const w = parseWish(b, randomUUID(), new Date().toISOString());
  if (typeof w === "string") return w;
  const err = await update((s) => { const r = addWish(s.wishes, w); if (typeof r === "string") return r; s.wishes = r; return ""; });
  if (err) return err;
  void emit(sb, userId, "deal.wish", "markets", { wishId: w.id, action: "added" });
  return w;
}

/** Remove a wish ("removed") or mark it bought ("done"); its offers and history go with it. */
export async function closeWish(sb: SupabaseClient, userId: string, id: string, action: "removed" | "done"): Promise<boolean> {
  const ok = await update((s) => {
    const w = s.wishes.find((x) => x.id === id);
    if (!w) return false;
    if (action === "done") w.status = "done"; else s.wishes = s.wishes.filter((x) => x.id !== id);
    delete s.offers[id]; delete s.obs[id]; delete s.hunted[id];
    s.found = s.found.filter((f) => f.wishId !== id);
    return true;
  });
  if (ok) void emit(sb, userId, "deal.wish", "markets", { wishId: id, action });
  return ok;
}

/** Dismiss one offer: it stops counting as a deal (it still counts in the price history). */
export const dismissOffer = (wishId: string, offerId: string) =>
  update((s) => { const o = s.offers[wishId]?.find((x) => x.id === offerId); if (!o) return false; s.offers[wishId] = s.offers[wishId].filter((x) => x.id !== offerId); s.alerted[offerId] = 0; s.found = s.found.filter((f) => f.offerId !== offerId); return true; });

/** One hunt over the due wishes (or all active ones with `all`), up to the daily cap. Returns counts; never runs twice at once. */
export async function huntDeals(sb: SupabaseClient, userId: string, lane: Lane, opts: { all?: boolean; signal?: AbortSignal; max?: number } = {}): Promise<{ wishes: number; offers: number; great: number }> {
  const h = held(lane);
  if (h) throw new Error(h);
  if (D.busy) throw new Error("The deal hunter is already working");
  D.busy = true;
  const ac = (D.ac = new AbortController());
  const signal = opts.signal ? AbortSignal.any([opts.signal, ac.signal]) : ac.signal;
  const out = { wishes: 0, offers: 0, great: 0 };
  const alerts: Offer[] = [];
  try {
    const now = Date.now(), day = localDay(new Date(now)), s = await load();
    const left = callsLeft(s, day);
    if (!left) throw new Error("Today's deal-hunt budget is used up; it continues tomorrow");
    const todo = dueWishes(s.wishes, opts.all ? {} : s.hunted, now, Math.min(left, opts.max ?? 3));
    for (const w of todo) {
      if (signal.aborted || held(lane)) break;
      const trace = newTrace(), at = new Date().toISOString();
      await update((x) => { if (x.day !== day) { x.day = day; x.calls = 0; } x.calls = (x.calls ?? 0) + 1; x.hunted[w.id] = at; x.lastHunt = at; });
      try {
        const r = await askClaude(dealPrompt(w, day), DEAL_SYSTEM, { lane, purpose: "deals.hunt", model: MODEL, web: true, timeoutMs: 6 * 60_000, signal, onLine: (l) => traceLine(trace, l) });
        void recordUsage(sb, userId, "deals.hunt", r, MODEL);
        const { offers, rejected } = parseOffers(r.text, trace, w, at);
        const fresh = await update((x) => {
          const merged = mergeOffers(x.offers[w.id] ?? [], offers, w, x.obs[w.id] ?? [], Date.now()).filter((o) => x.alerted[o.id] !== 0); // scored against the history before this hunt; 0 = he dismissed it
          x.obs[w.id] = addObs(x.obs[w.id] ?? [], offers);
          x.offers[w.id] = merged;
          const ids = new Set(offers.map((o) => o.id)), hits = newAlerts(merged.filter((o) => ids.has(o.id)), x.alerted);
          for (const o of hits) { x.alerted[o.id] = o.eur; x.found = [...x.found, { offerId: o.id, wishId: w.id, at }].slice(-50); }
          x.lastError = offers.length || !rejected.length ? undefined : `${w.item}: ${rejected.slice(0, 2).join("; ")}`.slice(0, 300);
          return hits;
        });
        out.wishes++; out.offers += offers.length; out.great += fresh.length; alerts.push(...fresh);
        await emit(sb, userId, "deal.hunt", "markets", { wishId: w.id, offers: offers.length, great: fresh.length });
        for (const o of fresh) await emit(sb, userId, "deal.found", "markets", { wishId: w.id, offerId: o.id });
      } catch (e) {
        if (signal.aborted) break;
        await update((x) => { x.lastError = `${w.item}: ${msg(e)}`.slice(0, 300); });
      }
    }
    if (alerts.length && !quietAt(Date.now())) { // label only, never the item or price; at night the 08:00+ call (call-pure "deal") tells him instead
      const { pushProblem, deliver } = await import("./remote-push");
      if (!pushProblem()) void deliver(pushLabel("deal"));
    }
    return out;
  } finally { D.busy = false; D.ac = null; }
}

/** Scheduler tick: daytime hunt when a wish is due. Not awaited by the tick; never throws. */
export async function maybeDealHunt(sb: SupabaseClient, userIds: string[], now = Date.now()) {
  try {
    const id = userIds[0]; // one owner
    if (!id || D.busy || held() || !daytime(now)) return;
    const s = await load();
    if (!dueWishes(s.wishes, s.hunted, now).length || !callsLeft(s, localDay(new Date(now)))) return;
    const r = await huntDeals(sb, id, "background");
    console.log(`[orbit] deal hunt: ${r.wishes} wish(es), ${r.offers} offer(s), ${r.great} great`);
  } catch (e) { console.error("[orbit] deal hunt failed:", msg(e)); }
}

/** For the night planner: how many wishes a hunt would cover now. */
export const dueCount = async (now = Date.now()) => { const s = await load(); return Math.min(dueWishes(s.wishes, s.hunted, now).length, callsLeft(s, localDay(new Date(now)))); };

/** For call-pure: great deals found in the last 12 h (offer ids), and the newest one for the call's opener. The morning brief looks back 24 h. */
export async function freshDeals(now = Date.now(), ms = FRESH_MS): Promise<{ ids: string[]; latest: { item: string; eur: number } | null }> {
  const s = await load().catch(() => null);
  if (!s) return { ids: [], latest: null };
  const fresh = s.found.filter((f) => now - Date.parse(f.at) < ms);
  const f = fresh[fresh.length - 1], o = f && s.offers[f.wishId]?.find((x) => x.id === f.offerId), w = f && s.wishes.find((x) => x.id === f.wishId);
  return { ids: fresh.map((x) => x.offerId), latest: o && w ? { item: w.item, eur: o.eur } : null };
}

/** CORE module tools: wishlist {} (read) and add_wish {...} (the owner's explicit ask; policy decide() checked it first). */
export async function runDealTool(sb: SupabaseClient, userId: string, tool: string, input: Record<string, unknown>, question: string, tainted: boolean): Promise<string> {
  try {
    if (tool === "wishlist") { const s = await load(); return wishlistText(s.wishes, s.offers, Date.now()); }
    const blocked = wishBlocked(question, tainted);
    if (blocked) return `Error: ${blocked}`;
    const w = await addWishItem(sb, userId, input);
    if (typeof w === "string") return `Error: ${w}`;
    return `Done: "${w.item}" is on the wishlist (max €${w.maxPrice}${w.targetPrice ? `, target €${w.targetPrice}` : ""}, ${w.condition}, ${w.region}). ORBIT checks public listings and shops a few times a day (read-only) and pings his phone when a great deal shows up; it never contacts sellers or buys. Tell him.`;
  } catch (e) { return `Error: ${msg(e)}`; }
}
