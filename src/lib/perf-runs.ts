// Scripted perf runs on disk: <ORBIT data dir>/perf-runs/<ms>.json, one file per run. Shared by /api/perf/run,
// the health collector and scripts/perf-run.ts (so: relative .ts imports, no "@/" alias, node only).
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir.ts";
import { cleanRun, type PerfRun } from "./perf-run-pure.ts";

export const perfRunDir = () => path.join(orbitDataDir(), "perf-runs");

export async function saveRun(run: PerfRun): Promise<string> {
  await mkdir(perfRunDir(), { recursive: true });
  const f = path.join(perfRunDir(), `${run.at}.json`);
  await writeFile(f, JSON.stringify(run, null, 1));
  return f;
}

/** The newest `limit` runs, oldest first. Unreadable or invalid files are skipped. */
export async function listRuns(limit = 30): Promise<PerfRun[]> {
  const names = (await readdir(perfRunDir()).catch(() => [] as string[])).filter((n) => /^\d+\.json$/.test(n)).sort((a, b) => parseInt(a) - parseInt(b)).slice(-limit);
  const runs = await Promise.all(names.map(async (n) => {
    try { return cleanRun(JSON.parse(await readFile(path.join(perfRunDir(), n), "utf8")), parseInt(n)); } catch { return null; }
  }));
  return runs.filter((r): r is PerfRun => !!r);
}
