// Recovery drill IO (rules: drill-pure.ts): opens a time-capsule backup with his passphrase, restores it into a fresh temp folder
// (never the real data dir), reads every file back, checks it, deletes the temp folder and records the result for Doctor.
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { orbitDataDir } from "./data-dir.ts";
import { capsuleView, openBackup } from "./capsule.ts";
import { DRILL_FILE, verifyRestore, type DrillResult } from "./drill-pure.ts";

const file = () => path.join(orbitDataDir(), DRILL_FILE);
export const lastDrill = async (): Promise<DrillResult | null> => JSON.parse(await readFile(file(), "utf8").catch(() => "null")) as DrillResult | null;

async function record(r: DrillResult) {
  await mkdir(orbitDataDir(), { recursive: true });
  await writeFile(file() + ".tmp", JSON.stringify(r, null, 2));
  await rename(file() + ".tmp", file());
  return r;
}

/** Restore drill on the named backup (default: the newest). Never throws: a failure is a recorded result. */
export async function runDrill(name: unknown, pass: unknown): Promise<DrillResult> {
  const at = new Date().toISOString();
  let tmp: string | null = null;
  try {
    const v = await capsuleView();
    const pick = typeof name === "string" && name ? name : v.configured ? v.backups[0]?.name : undefined;
    if (!pick) throw new Error(v.configured ? "No backup in the folder yet" : "Time capsule isn't set up");
    const { header, files } = await openBackup(pick, pass);
    tmp = await mkdtemp(path.join(os.tmpdir(), "orbit-drill-"));
    const back = new Map<string, Buffer | null>();
    for (const f of files) { // paths already passed safeRel in unpackFiles
      const dest = path.join(tmp, f.path);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, f.data);
      back.set(f.path, await readFile(dest).catch(() => null));
    }
    return await record({ at, backup: pick, backupAt: header.at, ...verifyRestore(header.files, files, back) });
  } catch (e) {
    return record({ at, ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  }
}
