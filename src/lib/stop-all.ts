import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir.ts";
import { STOP_OFF, parseStop, type StopState } from "./stop-all-pure.ts";

// Global Stop-all flag: <ORBIT data dir>/stop-all.json, cached on globalThis so every entry point can check it synchronously.
// Who checks it: scheduler tick, automations, kickQueue/runTask, chains drive, goals advance/draftPlan, plans drive, scout tick +
// auto-clip, inbox auto-clip, autopilot tick, herald watch (niche scan + toasts), proposals, deal hunter (deals.ts), CORE's work-starting tools. Cancelling running work: /api/stop-all.

const file = () => path.join(orbitDataDir(), "stop-all.json");
const g = globalThis as unknown as { __orbitStopAll?: StopState; __orbitStopSave?: Promise<unknown> };

export function stopAllState(): StopState {
  if (!g.__orbitStopAll) {
    try { g.__orbitStopAll = parseStop(readFileSync(file(), "utf8")); } catch { g.__orbitStopAll = STOP_OFF; }
  }
  return g.__orbitStopAll;
}

export const stopAllOn = () => stopAllState().on;

/** Takes effect in memory at once (even if the disk write then fails), then is saved atomically (tmp + rename).
 *  Writes are serialized and each writes the state current at its turn, so the last toggle always wins on disk. */
export async function setStopAll(on: boolean): Promise<StopState> {
  const s = { on, at: new Date().toISOString() };
  g.__orbitStopAll = s;
  const p = (g.__orbitStopSave ?? Promise.resolve()).catch(() => {}).then(async () => {
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(stopAllState()));
    await rename(file() + ".tmp", file());
  });
  g.__orbitStopSave = p;
  await p;
  return s;
}
