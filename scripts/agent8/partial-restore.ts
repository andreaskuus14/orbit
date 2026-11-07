// Agent 8, test branch only: partial capsule restore on Windows, then recovery from the pre-restore safety backup.
// Synthetic data in temp dirs. Prints one JSON report; exit 0 always (the report is the result).
import { mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const data = await mkdtemp(path.join(os.tmpdir(), "a8-data-")), backups = await mkdtemp(path.join(os.tmpdir(), "a8-caps-"));
process.env.ORBIT_DATA_DIR = data;
const cap = await import("../../src/lib/capsule.ts");
const P = "correct horse battery";
const w = (n: string, s: string | Buffer) => writeFile(path.join(data, n), s);
async function snapshot() {
  const out: Record<string, string> = {};
  async function walk(rel: string) {
    for (const d of await readdir(path.join(data, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (r === "time-capsule.json") continue;
      if (d.isDirectory()) await walk(r); else out[r] = createHash("sha256").update(await readFile(path.join(data, r))).digest("hex").slice(0, 12);
    }
  }
  await walk(""); return out;
}
const diff = (a: Record<string, string>, b: Record<string, string>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).map((k) => `${k}: ${a[k] ?? "absent"} -> ${b[k] ?? "absent"}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 1. Backup X: the state we will try to restore later
await cap.setupCapsule({ dir: backups, maxMB: 1, passphrase: P });
await w("a-first.json", '{"v":"X"}'); await w("b-added.json", '{"v":"X"}'); await w("c-locked.json", '{"v":"X"}');
const X = (await cap.runBackup()).name;
await sleep(1100); // capsule names are per second for pre-restore, per day for nightly

// 2. The pre-restore state: a-first changed, b-added never existed, c-locked changed, d-big over the 1 MB limit and also in X
await w("a-first.json", '{"v":"PRE"}'); await import("node:fs/promises").then((f) => f.rm(path.join(data, "b-added.json")));
await w("c-locked.json", '{"v":"PRE"}');
const before = await snapshot();

// 3. Lock c-locked.json with no sharing, restore X: writes a-first and b-added, then fails on c-locked
const flag = path.join(os.tmpdir(), `a8-release-${process.pid}`);
const ps = spawn("powershell", ["-NoProfile", "-Command",
  `$f=[IO.File]::Open('${path.join(data, "c-locked.json")}','Open','ReadWrite','None'); Write-Output locked; while(!(Test-Path '${flag}')){Start-Sleep -Milliseconds 100}; $f.Close()`]);
await new Promise<void>((r) => ps.stdout.on("data", (d) => String(d).includes("locked") && r()));
let restoreError = "";
try { await cap.restoreCapsule(X, P); } catch (e) { restoreError = e instanceof Error ? e.message : String(e); }
const partial = await snapshot();
await writeFile(flag, ""); await new Promise((r) => ps.on("exit", r));

// 4. Recover with the newest pre-restore safety backup
const safety = (await readdir(backups)).filter((n) => n.includes("pre-restore")).sort().pop()!;
let recoverError = "";
try { await cap.restoreCapsule(safety, P); } catch (e) { recoverError = e instanceof Error ? e.message : String(e); }
const after = await snapshot();

// 5. Oversize case: a file over the limit is skipped by the safety backup but overwritten by the restore
await w("a-first.json", Buffer.alloc(2 * 1024 * 1024, 120)); // 2 MB, over maxMB 1
const big = (await stat(path.join(data, "a-first.json"))).size;
await sleep(1100);
await cap.restoreCapsule(X, P);
const safety2 = (await readdir(backups)).filter((n) => n.includes("pre-restore")).sort().pop()!;
await cap.restoreCapsule(safety2, P);
const bigAfter = (await stat(path.join(data, "a-first.json"))).size;

console.log(JSON.stringify({
  platform: process.platform,
  restoreError, partialVsBefore: diff(before, partial),
  safety, recoverError, exactAfterRecovery: diff(before, after).length === 0, afterRecoveryVsBefore: diff(before, after),
  oversize: { before: big, afterRestoreAndRecovery: bigAfter, recovered: bigAfter === big },
}, null, 2));
