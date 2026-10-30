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
