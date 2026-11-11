import { readStore, writeStore } from "../safe-file.ts";
import { rename } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "../data-dir.ts";

// STUDIO failures the owner dismissed (failKey strings): <ORBIT data dir>/studio-fail-ack.json, shared by every browser and the phone.
const file = () => path.join(orbitDataDir(), "studio-fail-ack.json");
const g = globalThis as unknown as { __orbitFailAck?: Promise<unknown> };

export async function readFailAck(): Promise<string[]> {
  const t = await readStore(file()), v = t ? JSON.parse(t) : []; // missing = none; locked/damaged throws
  return Array.isArray(v) ? v.filter((k) => typeof k === "string") : [];
}

/** Adds keys (newest 1000 kept), serialized so two dismissals never overwrite each other; tmp + rename so a crash can't truncate it. */
export function addFailAck(keys: string[]): Promise<string[]> {
  const p = (g.__orbitFailAck ?? Promise.resolve()).catch(() => {}).then(async () => {
    const next = [...new Set([...(await readFailAck()), ...keys])].slice(-1000);
    await writeStore(file(), JSON.stringify(next));
    return next;
  });
  g.__orbitFailAck = p;
  return p;
}
