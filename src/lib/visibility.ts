import path from "node:path";
import { askClaude } from "./claude";
import { stopAllOn } from "./stop-all";
import { PAUSED_MSG } from "./stop-all-pure";
import { usageHold } from "./usage-meter";
import { readState, saveState, studioRoot } from "./clips/factory";
import { KNOW_SYSTEM, MAX_TARGETS, WEB_SYSTEM, checkPrompt, parseCheck, validateName, withChecks, type Check, type Target } from "./visibility-pure";

// AI VISIBILITY store: <studio>/visibility.json (local, like Ideas). Logic: visibility-pure.ts.
type Store = { targets: Target[] };
const FILE = () => path.join(studioRoot(), "visibility.json");
const problem = (x: unknown) => (x && typeof x === "object" && Array.isArray((x as Store).targets) ? "" : "no targets list");
const load = async () => (await readState<Store>(studioRoot(), "visibility", problem)) ?? { targets: [] };
const S = globalThis as unknown as { __orbitVis?: string | null };
// One change to the file at a time: add/remove/check write-backs never overwrite each other.
let chain: Promise<unknown> = Promise.resolve();
const locked = <T>(f: () => Promise<T>): Promise<T> => { const p = chain.then(f); chain = p.catch(() => {}); return p; };

export async function listTargets() { return { targets: (await load()).targets, busy: S.__orbitVis ?? null }; }

export function addTarget(raw: unknown): Promise<Store | { error: string }> {
  const name = validateName(raw);
  if (typeof name !== "string") return Promise.resolve(name);
  return locked(async () => {
  const st = await load();
  if (st.targets.some((t) => t.name.toLowerCase() === name.toLowerCase())) return { error: "Already tracked" };
  if (st.targets.length >= MAX_TARGETS) return { error: `At most ${MAX_TARGETS} names` };
  const next = { targets: [...st.targets, { name, checks: [] }] };
  await saveState("visibility", FILE(), next);
  return next;
  });
}

export const removeTarget = (name: string) => locked(async () => {
  const st = await load();
  await saveState("visibility", FILE(), { targets: st.targets.filter((t) => t.name !== name) });
});

/** Both checks for one tracked name: Claude's own knowledge (no tools) and a web search (read-only tools). */
export async function checkTarget(name: string, signal: AbortSignal): Promise<Target> {
  const held = stopAllOn() ? PAUSED_MSG : usageHold();
  if (held) throw new Error(held);
  if (S.__orbitVis) throw new Error("Already checking another name: wait for it to finish");
  S.__orbitVis = name; // taken before any await, so two clicks can't both start
  try {
    if (!(await load()).targets.some((t) => t.name === name)) throw new Error("Not a tracked name");
    const at = new Date().toISOString();
    const [know, web] = await Promise.all([
      askClaude(checkPrompt(name), KNOW_SYSTEM, { lane: "foreground", purpose: "business.visibility", timeoutMs: 90_000, signal }),
      askClaude(checkPrompt(name), WEB_SYSTEM, { lane: "foreground", purpose: "business.visibility", timeoutMs: 180_000, signal, web: true }),
    ]);
    const checks = [parseCheck(know.text, "claude", at), parseCheck(web.text, "web", at)].filter((c): c is Check => !!c);
    if (!checks.length) throw new Error("CORE's answers were unusable; try again");
    return await locked(async () => {
      const st = await load(); // re-read: the list may have changed during the checks
      const t = st.targets.find((x) => x.name === name);
      if (!t) throw new Error("That name was removed meanwhile");
      const updated = withChecks(t, checks);
      await saveState("visibility", FILE(), { targets: st.targets.map((x) => (x.name === name ? updated : x)) });
      return updated;
    });
  } finally { S.__orbitVis = null; }
}
