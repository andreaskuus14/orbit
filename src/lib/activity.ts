import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir.ts";
import { ACT_MAX, keepLast, parseActivity, type ActItem } from "./activity-pure.ts";

// Append-only <ORBIT data dir>/activity.jsonl for actions with no other record: Stop-all toggles, CORE write tools, autopilot
// approvals, usage-limit hits. Bounded: past ACT_MAX + 500 lines it is rewritten (atomically) to the newest ACT_MAX.

const file = () => path.join(orbitDataDir(), "activity.jsonl");
const g = globalThis as unknown as { __orbitAct?: { lines: number | null; chain: Promise<unknown> } };
const S = (g.__orbitAct ??= { lines: null, chain: Promise.resolve() });

/** Never throws and never blocks the caller; appends are serialized. */
export function logActivity(e: Omit<ActItem, "at">): void {
  const line = "\n" + JSON.stringify({ at: new Date().toISOString(), ...e }); // leading newline: a torn last line can't swallow this record
  S.chain = S.chain.then(async () => {
    await mkdir(path.dirname(file()), { recursive: true });
    const n = (S.lines ??= (await readFile(file(), "utf8").catch(() => "")).split("\n").filter((l) => l.trim()).length) + 1;
    await appendFile(file(), line);
    S.lines = n;
    if (n > ACT_MAX + 500) {
      await writeFile(file() + ".tmp", keepLast(await readFile(file(), "utf8"), ACT_MAX));
      await rename(file() + ".tmp", file());
      S.lines = ACT_MAX;
    }
  }).catch((err) => console.error("[orbit] activity log write failed:", err instanceof Error ? err.message : err));
}

export async function readActivity(): Promise<ActItem[]> {
  await S.chain; // include appends still in flight
  return parseActivity(await readFile(file(), "utf8").catch(() => ""));
}
