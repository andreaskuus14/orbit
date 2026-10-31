import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "../data-dir.ts";

// STUDIO failures the owner dismissed (failKey strings): <ORBIT data dir>/studio-fail-ack.json, shared by every browser and the phone.
const file = () => path.join(orbitDataDir(), "studio-fail-ack.json");
const g = globalThis as unknown as { __orbitFailAck?: Promise<unknown> };

export async function readFailAck(): Promise<string[]> {
  try { const v = JSON.parse(await readFile(file(), "utf8")); return Array.isArray(v) ? v.filter((k) => typeof k === "string") : []; } catch { return []; }
}

/** Adds keys (newest 1000 kept), serialized so two dismissals never overwrite each other; tmp + rename so a crash can't truncate it. */
export function addFailAck(keys: string[]): Promise<string[]> {
  const p = (g.__orbitFailAck ?? Promise.resolve()).catch(() => {}).then(async () => {
    const next = [...new Set([...(await readFailAck()), ...keys])].slice(-1000);
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(next));
    await rename(file() + ".tmp", file());
    return next;
  });
  g.__orbitFailAck = p;
  return p;
}
