"use client";
import { useEffect } from "react";
import { useWorldPaused } from "./world-paused";
import { dedupe, shouldPoll } from "@/lib/poll-pure";

/** Shared poller: runs fn now and every ms while enabled; skips ticks while the tab is hidden or its world is kept-but-hidden
 *  (WorldPaused), and refreshes at once when the tab comes back or the window regains focus. `refreshOn`: bus events that refresh too. */
export function usePoll(fn: () => void, ms: number, enabled = true, refreshOn: readonly string[] = []) {
  const paused = useWorldPaused();
  const events = refreshOn.join(",");
  useEffect(() => {
    if (!enabled || paused) return;
    const tick = () => { if (shouldPoll({ enabled, paused, hidden: document.hidden })) fn(); };
    fn();
    const h = setInterval(tick, ms), evs = events ? events.split(",") : [];
    document.addEventListener("visibilitychange", tick);
    addEventListener("focus", tick);
    for (const e of evs) addEventListener(e, tick);
    return () => { clearInterval(h); document.removeEventListener("visibilitychange", tick); removeEventListener("focus", tick); for (const e of evs) removeEventListener(e, tick); };
  }, [fn, ms, enabled, paused, events]);
}

const inflight = new Map<string, Promise<unknown>>();
/** GET JSON (null on failure), shared across components while one identical request is in flight. */
export const sharedJson = <T = unknown>(url: string): Promise<T | null> =>
  dedupe(inflight, url, () => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null), () => null));

const tagged = new Map<string, { etag: string; json: unknown }>();
/** GET JSON with If-None-Match: a 304 returns the exact object of the last 200 (same identity, so React skips the re-render).
 *  Throws like a failed fetch on other errors; servers without an ETag behave exactly like a plain GET. */
export async function etagJson<T>(url: string): Promise<{ ok: boolean; status: number; json: T }> {
  const prev = tagged.get(url);
  const res = await fetch(url, { cache: "no-store", headers: prev ? { "If-None-Match": prev.etag } : undefined });
  if (res.status === 304 && prev) return { ok: true, status: 200, json: prev.json as T };
  const json = await res.json().catch(() => ({}));
  const etag = res.headers.get("etag");
  if (res.ok && etag) tagged.set(url, { etag, json }); else tagged.delete(url);
  return { ok: res.ok, status: res.status, json: json as T };
}
