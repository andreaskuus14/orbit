// Execution evidence for tasks marked "running": is a worker in THIS ORBIT process running it right now? Plain in-memory state
// (single process: launch.ps1 runs one server). agents.ts registers its worker sets, bg-resume.ts its background turns, and
// resolvePending tracks approved actions while they execute. Tested in tests/execution.test.ts.
import { startedBeforeBoot } from "./completion-pure.ts";

export type Exec = "active" | "restart" | "unknown" | "unchecked";
const g = globalThis as unknown as { __orbitExecTracked?: Map<string, number>; __orbitExecSources?: Map<string, (id: string) => boolean> };
const tracked = (g.__orbitExecTracked ??= new Map());
const sources = (g.__orbitExecSources ??= new Map());

/** Mark `id` as executing until the returned release() runs (call it in a finally). Counted, so overlapping runs of one id stay
 *  active until the last one ends; release is idempotent. */
export function track(id: string): () => void {
  tracked.set(id, (tracked.get(id) ?? 0) + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const n = (tracked.get(id) ?? 1) - 1;
    if (n > 0) tracked.set(id, n); else tracked.delete(id);
  };
}

/** A worker set elsewhere (agents.ts queue/live/handoff, bg-resume turns). Named, so re-registering on a hot reload replaces it. */
export const registerSource = (name: string, has: (id: string) => boolean) => void sources.set(name, has);

/** active = running here now; restart = it started before this process booted, so nothing here can still be running it (the
 *  scheduler marks it interrupted); unknown = started in this process and no tracked worker has it. Age never decides. */
export function taskExecution(id: string, startedAt: string | null | undefined, boot: number): Exec {
  if (tracked.has(id) || [...sources.values()].some((has) => has(id))) return "active";
  return startedBeforeBoot(startedAt ?? null, boot) ? "restart" : "unknown";
}
