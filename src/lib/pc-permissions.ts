// Durable local JSON store for toggleable PC Control Permissions (<ORBIT data dir>/pc-permissions.json).
// Pure validation & Rule 6 hard-lock checks live in pc-permissions-pure.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { orbitDataDir } from "./data-dir";
import { writeStore } from "./safe-file";
import { ALL_OFF_PC_PERMS, DEFAULT_PC_PERMS, parsePcPerms, patchPcPerms, type PcPermissions } from "./pc-permissions-pure";

const file = () => path.join(orbitDataDir(), "pc-permissions.json");
const g = globalThis as unknown as { __orbitPcPerms?: PcPermissions; __orbitPcPermsLock?: Promise<unknown> };

export function getPcPerms(): PcPermissions {
  if (!g.__orbitPcPerms) {
    try {
      g.__orbitPcPerms = parsePcPerms(readFileSync(file(), "utf8"));
    } catch {
      g.__orbitPcPerms = { ...DEFAULT_PC_PERMS };
    }
  }
  return { ...g.__orbitPcPerms };
}

export function setPcPerms(patch: Record<string, unknown>): Promise<PcPermissions> {
  const p = (g.__orbitPcPermsLock ?? Promise.resolve()).catch(() => {}).then(async () => {
    const next = patchPcPerms(getPcPerms(), patch);
    await writeStore(file(), JSON.stringify(next));
    g.__orbitPcPerms = next;
    return { ...next };
  });
  g.__orbitPcPermsLock = p;
  return p;
}

export const disableAllPcPerms = () => setPcPerms(ALL_OFF_PC_PERMS);
export const resetPcPerms = () => setPcPerms(DEFAULT_PC_PERMS);
