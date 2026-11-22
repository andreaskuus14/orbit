// Restart re-runs (rules: run-recovery-pure.ts): which tasks were already re-queued once after a restart, kept in
// <data dir>/restart-retries.json (task ids and times only) so "once" holds across the many restarts of a live-update day.
import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { orbitDataDir } from "./data-dir";
import { pruneMarks } from "./run-recovery-pure";

const file = () => path.join(orbitDataDir(), "restart-retries.json");

/** Ids already re-queued after a restart. Unreadable file: null (the caller then re-queues nothing, as before). */
export async function readRetried(now = Date.now()): Promise<Record<string, number> | null> {
  try { return pruneMarks(JSON.parse(await readFile(file(), "utf8")), now); }
  catch (e) { return (e as { code?: string })?.code === "ENOENT" ? {} : null; }
}

/** Record re-queued ids (written before the queue update, so a crash in between can never make it twice). */
export async function markRetried(ids: string[], now = Date.now()): Promise<boolean> {
  const cur = await readRetried(now);
  if (!cur) return false;
  for (const id of ids) cur[id] = now;
  try {
    await mkdir(orbitDataDir(), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(cur));
    await rename(file() + ".tmp", file());
    return true;
  } catch { return false; }
}
