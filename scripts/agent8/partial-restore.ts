// Agent 8, test branch only: a capsule restore that hits a locked file on Windows must leave the data dir exactly as before.
// Synthetic data in temp dirs. Prints one JSON report and exits 1 if any case isn't exact.
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
  for (const d of await readdir(data, { withFileTypes: true })) {
    if (d.name === "time-capsule.json") continue;
    out[d.name] = d.isDirectory() ? "dir" : createHash("sha256").update(await readFile(path.join(data, d.name))).digest("hex").slice(0, 12);
  }
  return out;
}
const diff = (a: Record<string, string>, b: Record<string, string>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).map((k) => `${k}: ${a[k] ?? "absent"} -> ${b[k] ?? "absent"}`);

await cap.setupCapsule({ dir: backups, maxMB: 1, passphrase: P });
await w("a-first.json", '{"v":"X"}'); await w("b-added.json", '{"v":"X"}'); await w("c-locked.json", '{"v":"X"}');
const X = (await cap.runBackup()).name;
await w("a-first.json", Buffer.alloc(2 * 1024 * 1024, 120)); // oversized original (limit 1 MB)
await rm(path.join(data, "b-added.json"));
await w("c-locked.json", '{"v":"PRE"}');
const before = await snapshot();

// share "None": unreadable and unwritable; share "Read": readable, but the rename over it fails part-way
async function attempt(share: "None" | "Read") {
  const flag = path.join(os.tmpdir(), `a8-release-${process.pid}-${share}`);
  const ps = spawn("powershell", ["-NoProfile", "-Command",
    `$f=[IO.File]::Open('${path.join(data, "c-locked.json")}','Open','Read','${share}'); Write-Output locked; while(!(Test-Path '${flag}')){Start-Sleep -Milliseconds 100}; $f.Close()`]);
  await new Promise<void>((r) => ps.stdout.on("data", (d) => String(d).includes("locked") && r()));
  let error = "";
  try { await cap.restoreCapsule(X, P); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  await writeFile(flag, ""); await new Promise((r) => ps.on("exit", r));
  const changes = diff(before, await snapshot());
  return { share, error, exact: changes.length === 0, changes };
}
const results = [await attempt("None"), await attempt("Read")];
console.log(JSON.stringify({ platform: process.platform, sha: process.env.GITHUB_SHA, results }, null, 2));
if (results.some((r) => !r.exact || !r.error)) process.exit(1);
