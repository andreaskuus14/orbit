import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cleanPrefs, type FeedHealth, type Prefs } from "./news-intel-pure";

// INTELLIGENCE local state (INT02/04/06/07) in <ORBIT data dir>/intel.json, beside follows.json: preferences and "less like this",
// last acknowledged revision per event per topic, per-feed health/backoff, and story actions already taken (so each lands once).
export type IntelStore = { prefs: Prefs; ack: Record<string, Record<string, string>>; health: Record<string, FeedHealth>; done: Record<string, string> };

const file = () => {
  const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "orbit") : path.join(os.homedir(), ".orbit");
  return path.join(process.env.ORBIT_DATA_DIR?.trim() || local, "intel.json");
};
const g = globalThis as unknown as { __orbitIntel?: Promise<unknown> };

export async function readIntel(): Promise<IntelStore> {
  try {
    const s = JSON.parse(await readFile(file(), "utf8"));
    const obj = (v: unknown) => (v && typeof v === "object" ? v : {}) as never;
    return { prefs: cleanPrefs(s.prefs), ack: obj(s.ack), health: obj(s.health), done: obj(s.done) };
  } catch (e) {
    // Only a missing file means "fresh"; a locked or corrupt file must not be overwritten with defaults.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { prefs: cleanPrefs({}), ack: {}, health: {}, done: {} };
    throw e;
  }
}

/** Read-modify-write, one at a time; tmp + rename so a crash never leaves a half-written file. */
export function updateIntel<T>(fn: (s: IntelStore) => T | Promise<T>): Promise<T> {
  const p = (g.__orbitIntel ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await readIntel();
    const out = await fn(s);
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(s, null, 2));
    await rename(file() + ".tmp", file());
    return out;
  });
  g.__orbitIntel = p;
  return p;
}
