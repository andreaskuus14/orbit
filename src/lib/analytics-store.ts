import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir";
import { cleanCalibration, type Calibration, type Experiment } from "./analytics-improve-pure";

// ANALYTICS owner inputs (ANA02 calibration, ANA07 experiments, ANA08 queued keys) in <ORBIT data dir>/analytics.json.
export type AnaStore = { calibration: Calibration; experiments: Experiment[]; queued: Record<string, string> };
const file = () => path.join(orbitDataDir(), "analytics.json");
const g = globalThis as unknown as { __orbitAna?: Promise<unknown> };

export async function readAna(): Promise<AnaStore> {
  try {
    const s = JSON.parse(await readFile(file(), "utf8"));
    return { calibration: { ...cleanCalibration(s.calibration), at: typeof s.calibration?.at === "string" ? s.calibration.at : undefined },
      experiments: Array.isArray(s.experiments) ? s.experiments.filter((e: Experiment) => e && typeof e.id === "string") : [], queued: s.queued && typeof s.queued === "object" ? s.queued : {} };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { calibration: cleanCalibration({}), experiments: [], queued: {} };
    throw e; // a locked or corrupt file is never overwritten with defaults
  }
}
/** Read-modify-write, one at a time; tmp + rename. */
export function updateAna<T>(fn: (s: AnaStore) => T): Promise<T> {
  const p = (g.__orbitAna ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await readAna();
    const out = fn(s);
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(s, null, 1));
    await rename(file() + ".tmp", file());
    return out;
  });
  g.__orbitAna = p;
  return p;
}
