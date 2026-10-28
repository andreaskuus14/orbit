import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir";
import { isoWeek } from "./health-pure";
import { addRecord, evalTrend, staticEval, type EvalRecord } from "./self-eval-pure";

// Weekly self-eval IO (rules: self-eval-pure.ts). Run from the night shift's health slot, at most once per ISO week; 0 model calls.
// State: <ORBIT data dir>/self-eval.json = { runs: EvalRecord[] } (case ids and counts only).
const file = () => path.join(orbitDataDir(), "self-eval.json");
const load = async (): Promise<EvalRecord[]> => { try { return (JSON.parse(await readFile(file(), "utf8")) as { runs?: EvalRecord[] }).runs ?? []; } catch { return []; } };

/** Night-shift hook: records this week's static scorecard once. Never throws. */
export async function maybeSelfEval(now = Date.now()): Promise<EvalRecord | null> {
  try {
    const runs = await load(), week = isoWeek(now);
    if (runs.at(-1)?.week === week) return null;
    const r = await staticEval(now, week);
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify({ runs: addRecord(runs, r) }));
    await rename(file() + ".tmp", file());
    if (r.redTeamFailures) console.error(`[self-eval] ${r.redTeamFailures} red-team case(s) not refused: ${r.failed.join(", ")}`);
    return r;
  } catch (e) { console.error("[self-eval] failed:", e instanceof Error ? e.message : e); return null; }
}

/** For the Doctor card: the trend over the stored weeks (null before the first night run). */
export const selfEvalView = async () => evalTrend(await load());
