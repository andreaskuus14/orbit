import { readFileSync, statSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir.ts";
import { STOP_OFF, stopFileState, type StopState } from "./stop-all-pure.ts";

// Global Stop-all flag: <ORBIT data dir>/stop-all.json, cached on globalThis so every entry point can check it synchronously.
// The cache is re-read whenever the file changes (mtime+size), so a second process or a restart sees the other's toggle.
// Who checks it: scheduler tick, automations, kickQueue/runTask, chains drive, goals advance/draftPlan, plan-jobs drive (incl. STUDIO plans), scout tick +
// auto-clip, inbox auto-clip, autopilot tick, herald watch (niche scan + toasts), proposals, deal hunter (deals.ts), CORE's work-starting tools. Cancelling running work: /api/stop-all.

const file = () => path.join(orbitDataDir(), "stop-all.json");
const g = globalThis as unknown as { __orbitStopAll?: StopState; __orbitStopStamp?: string; __orbitStopSave?: Promise<unknown> };
const stamp = () => { try { const s = statSync(file()); return `${s.mtimeMs}:${s.size}`; } catch { return "none"; } };

export function stopAllState(): StopState {
  const st = stamp();
  if (!g.__orbitStopAll || st !== g.__orbitStopStamp) { // unchanged file: keep memory (it may be ahead of a pending/failed write)
    g.__orbitStopStamp = st;
    g.__orbitStopAll = readStop();
  }
  return g.__orbitStopAll;
}

// Only a missing file means off. A file that can't be read (Windows antivirus lock at boot) or isn't valid (a power cut can leave
// it empty) fails closed: on, so nothing starts before he looks; his Resume rewrites it. A read error is retried on the next check.
function readStop(): StopState {
  let raw: string;
  try { raw = readFileSync(file(), "utf8"); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return STOP_OFF;
    g.__orbitStopStamp = ""; // re-read next time: a lock is usually brief
    return failClosed(`couldn't be read (${(e as NodeJS.ErrnoException).code ?? e})`);
  }
  return stopFileState(raw) ?? failClosed("is damaged");
}
function failClosed(why: string): StopState {
  console.error(`[orbit] stop-all.json ${why}: ORBIT stays paused until Resume`);
  return { on: true, at: "" };
}

export const stopAllOn = () => stopAllState().on;

/** Takes effect in memory at once (even if the disk write then fails), then is saved atomically (tmp + rename).
 *  Writes are serialized and each writes the state current at its turn, so the last toggle always wins on disk. */
export async function setStopAll(on: boolean): Promise<StopState> {
  const s = { on, at: new Date().toISOString() };
  g.__orbitStopAll = s;
  g.__orbitStopStamp = stamp(); // memory is ahead of the file until the write below lands
  const p = (g.__orbitStopSave ?? Promise.resolve()).catch(() => {}).then(async () => {
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(g.__orbitStopAll));
    await rename(file() + ".tmp", file());
    g.__orbitStopStamp = stamp(); // our own write: no re-read needed
  });
  g.__orbitStopSave = p;
  await p;
  return s;
}
