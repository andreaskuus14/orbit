import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir.ts";

// Worker heartbeat (OPS08/G19), apart from task progress: the scheduler stamps <data dir>/host-heartbeat.json every tick interval,
// even while a long tick is busy. The UI/phone read it (GET /api/stop-all → host) to show "host offline since …" (ops-status-pure hostOffline).
const file = () => path.join(orbitDataDir(), "host-heartbeat.json");

export async function beat(now = new Date()) {
  try {
    await mkdir(orbitDataDir(), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify({ at: now.toISOString(), pid: process.pid }));
    await rename(file() + ".tmp", file());
  } catch (e) { console.error("[orbit] heartbeat write failed:", e instanceof Error ? e.message : e); } // the stale beat is the signal
}

/** Last beat (ISO), or null when the scheduler has never beaten on this data dir (it isn't running: nothing resumes work). */
export function lastBeat(): string | null {
  try { const at = JSON.parse(readFileSync(file(), "utf8"))?.at; return typeof at === "string" ? at : null; } catch { return null; }
}
