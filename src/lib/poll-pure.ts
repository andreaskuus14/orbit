// Client polling budget (roadmap G11/G22): one interval policy and one in-flight dedupe for every poller in src/components.
// Background work runs on the server; the client only refreshes what is on screen.

/** Floors per kind: badge/status data refreshes at most every 60 s, a running job's progress at most every 2 s. */
export const POLL_FLOOR = { status: 60_000, live: 2_000 } as const;
export type PollKind = keyof typeof POLL_FLOOR;

/** The interval a poller actually uses: never below its kind's floor. */
export const pollMs = (ms: number, kind: PollKind = "status") => Math.max(ms, POLL_FLOOR[kind]);

/** A tick fires only when enabled, its world is on screen and the tab is visible. */
export const shouldPoll = (s: { enabled: boolean; paused: boolean; hidden: boolean }) => s.enabled && !s.paused && !s.hidden;

/** Same key in flight: share its promise instead of a second request. The entry clears when it settles. */
export function dedupe<T>(inflight: Map<string, Promise<unknown>>, key: string, run: () => Promise<T>): Promise<T> {
  const cur = inflight.get(key);
  if (cur) return cur as Promise<T>;
  const p = run().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
