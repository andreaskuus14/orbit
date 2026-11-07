// Windows-only checks for #426 (run on windows-latest from the checkout root; copied into tests/ by the workflow, never committed
// to a product branch). Synthetic data in throwaway folders on C:, no network, no Supabase.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = await mkdtemp("C:\\iso-orbit-");
const local = path.join(root, "LocalAppData"), pcB = path.join(root, "pcB"), backups = path.join(root, "capsules");
await mkdir(local, { recursive: true });
delete process.env.ORBIT_DATA_DIR;
process.env.LOCALAPPDATA = local; // no ORBIT_DATA_DIR: ORBIT must fall back to %LOCALAPPDATA%\orbit
const { orbitDataDir } = await import("../src/lib/data-dir.ts");
const v = await import("../src/lib/vault.ts");
const cap = await import("../src/lib/capsule.ts");
const { byName } = await import("../src/lib/vault-meta-pure.ts");
const PDF = "%PDF-1.4 synthetic report";

const shortName = (file: string) => execFileSync("cmd", ["/c", `for %I in ("${file}") do @echo %~snxI`], { encoding: "utf8" }).trim();
/** Holds file open with no sharing (like an editor or AV scanner) until release(). */
function lock(file: string) {
  const ps = spawn("powershell", ["-NoProfile", "-Command", `$f=[IO.File]::Open('${file}','Open','ReadWrite','None'); [Console]::Out.WriteLine('locked'); [Console]::In.ReadLine() | Out-Null; $f.Close()`], { stdio: ["pipe", "pipe", "inherit"] });
  const ready = new Promise<void>((r) => ps.stdout.on("data", (d) => { if (String(d).includes("locked")) r(); }));
  return { ready, release: () => new Promise<void>((r) => { ps.on("exit", () => r()); ps.stdin.end("\n"); }) };
}

test("LOCALAPPDATA: with no ORBIT_DATA_DIR, data and VAULT live in %LOCALAPPDATA%\\orbit", async () => {
  assert.equal(orbitDataDir(), path.join(local, "orbit"));
  assert.equal(v.vaultDir(), path.join(local, "orbit", "vault"));
  assert.equal(await v.saveUpload(new File([PDF], "Quarterly report.pdf")), "Quarterly report.pdf");
  assert.equal(await readFile(path.join(local, "orbit", "vault", "Quarterly report.pdf"), "utf8"), PDF);
  console.log("data dir:", orbitDataDir());
});

test("8.3 short-name guard: an upload or rename to another file's short name never overwrites it", async (t) => {
  const real = path.join(v.vaultDir(), "Quarterly report.pdf");
  const sn = shortName(real);
  console.log("short name of 'Quarterly report.pdf':", sn);
  if (!/~\d/.test(sn)) { t.skip(`8.3 names not generated on this volume (got "${sn}")`); return; }
  const stored = await v.saveUpload(new File(["%PDF-1.4 other"], sn)).catch((e) => `refused: ${e.status} ${e.message}`);
  console.log(`upload as "${sn}" →`, stored);
  assert.equal(await readFile(real, "utf8"), PDF, "the original file is untouched");
  assert.notEqual(String(stored).toLowerCase(), sn.toLowerCase(), "not stored under the short name");
  await v.saveUpload(new File(["%PDF-1.4 third"], "third.pdf"));
  const renamed = await v.renameFile("third.pdf", sn).catch((e) => `refused: ${e.status} ${e.message}`);
  console.log(`rename third.pdf → "${sn}" →`, renamed);
  assert.equal(await readFile(real, "utf8"), PDF, "the original file is untouched after the rename");
  const names = (await readdir(v.vaultDir())).filter((n) => !n.startsWith("."));
  console.log("vault now:", names);
  assert.ok(names.includes("Quarterly report.pdf"));
});

test("capsule restore with a locked file: fails or succeeds cleanly, safety backup first, retry after unlock completes", async () => {
  // PC A = the LOCALAPPDATA dir above. Link the report by id, back up.
  await v.markSync("Quarterly report.pdf", "ok");
  const idA = byName(await v.readMeta(), "Quarterly report.pdf")!.id;
  await writeFile(path.join(orbitDataDir(), "project-desks.json"), JSON.stringify({ synthetic: { files: [{ id: idA }] } }));
  assert.equal(await cap.setupCapsule({ dir: backups, maxMB: 25, passphrase: "pass A synthetic" }), null);
  const { name } = await cap.runBackup();

  // PC B: an older desk file that a process holds open while the restore runs.
  process.env.ORBIT_DATA_DIR = pcB;
  await mkdir(pcB, { recursive: true });
  const desk = path.join(pcB, "project-desks.json");
  await writeFile(desk, JSON.stringify({ old: true }));
  assert.equal(await cap.setupCapsule({ dir: backups, maxMB: 25, passphrase: "pass B synthetic" }), null);
  const l = lock(desk); await l.ready;
  const t0 = Date.now();
  const first = await cap.restoreCapsule(name, "pass A synthetic").then((r) => ({ ok: true, r }), (e: Error & { code?: string }) => ({ ok: false, e: `${e.code ?? ""} ${e.message}` }));
  console.log("restore while locked:", JSON.stringify(first), `${Date.now() - t0} ms`);
  const leftovers = (await readdir(pcB)).filter((n) => n.endsWith(".tmp"));
  console.log("leftover .tmp files:", leftovers);
  const safety = (await readdir(backups)).filter((n) => /pre-restore/.test(n));
  console.log("safety backups:", safety);
  await l.release();
  assert.ok(Date.now() - t0 < 60_000, "no hang");
  assert.ok(safety.length >= 1, "a pre-restore safety backup was written");
  if (!first.ok) {
    assert.match(String((first as { e: string }).e), /EPERM|EBUSY|EACCES|locked|in use|denied/i, "a clear lock error");
    assert.equal(await readFile(desk, "utf8"), JSON.stringify({ old: true }), "the locked file was left as it was");
  }
  const second = await cap.restoreCapsule(name, "pass A synthetic");
  console.log("restore after unlock:", JSON.stringify(second));
  assert.equal(JSON.parse(await readFile(desk, "utf8")).synthetic.files[0].id, idA, "desk link restored with the original id");
  assert.equal(byName(await v.readMeta(), "Quarterly report.pdf")?.id, idA, "VAULT id restored");
  console.log("leftover .tmp after retry:", (await readdir(pcB)).filter((n) => n.endsWith(".tmp")));
});
