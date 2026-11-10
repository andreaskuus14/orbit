// Fair queue across departments (agent team step 2): when a slot frees up, the next task comes from the department with the
// fewest tasks running right now, oldest first inside it, so ten Business jobs can't make a News briefing wait behind all of them.
// Ties go to the oldest task overall. Custom agents count as their own "custom" department. Tests: tests/agent-queue.test.ts.
import { BUILTIN_AGENTS } from "./agent-defs-pure.ts";

export type Queued = { id: string; agent: string };
export const deptOf = (agent: string) => BUILTIN_AGENTS.find((a) => a.slug === agent)?.dept ?? "custom";

/** queued: oldest first. running: the agents of tasks running now. Returns the id to start, or null. */
export function pickFair(queued: readonly Queued[], running: readonly string[]): string | null {
  if (!queued.length) return null;
  const load = new Map<string, number>();
  for (const a of running) load.set(deptOf(a), (load.get(deptOf(a)) ?? 0) + 1);
  let best = queued[0], bestLoad = load.get(deptOf(best.agent)) ?? 0;
  for (const q of queued) { const l = load.get(deptOf(q.agent)) ?? 0; if (l < bestLoad) { best = q; bestLoad = l; } }
  return best.id;
}
