// Windows-only checks for #426 (run on windows-latest from the checkout root; copied into tests/ by the workflow, never committed
// to a product branch). Synthetic data in throwaway folders on C:, no network, no Supabase.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = await mkdtemp("C:\\iso-orbit-");
const local = path.join(root, "LocalAppData"), pcB = path.join(root, "pcB"), backups = path.join(root, "capsules");
await mkdir(local, { recursive: true }); await mkdir(backups, { recursive: true });
delete process.env.ORBIT_DATA_DIR;
process.env.LOCALAPPDATA = local; // no ORBIT_DATA_DIR: ORBIT must fall back to %LOCALAPPDATA%\orbit
const { orbitDataDir } = await import("../src/lib/data-dir.ts");
const v = await import("../src/lib/vault.ts");
const cap = await import("../src/lib/capsule.ts");
const { byName } = await import("../src/lib/vault-meta-pure.ts");
const PDF = "%PDF-1.4 synthetic report";

const shortName = (file: string) => path.basename(execFileSync("powershell", ["-NoProfile", "-Command", `(New-Object -ComObject Scripting.FileSystemObject).GetFile('${file}').ShortPath`], { encoding: "utf8" }).trim());
/** Holds file open with no sharing (like an editor or AV scanner) until release(). */
function lock(file: string, share = "None") {
  const ps = spawn("powershell", ["-NoProfile", "-Command", `$f=[IO.File]::Open('${file}','Open','ReadWrite','${share}'); [Console]::Out.WriteLine('locked'); [Console]::In.ReadLine() | Out-Null; $f.Close()`], { stdio: ["pipe", "pipe", "inherit"] });
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
  const files0 = async () => Object.fromEntries(await Promise.all((await readdir(pcB, { recursive: true })).filter((n) => !/time-capsule\.json$/.test(n)).map(async (n) => [n, await readFile(path.join(pcB, n), "utf8").catch(() => "<dir>")])));
  const before = await files0();
  // (a) locked with no sharing: the restore can't even read it, so it must stop before changing anything.
  let l = lock(desk); await l.ready;
  let t0 = Date.now();
  const first = await cap.restoreCapsule(name, "pass A synthetic").then((r) => ({ ok: true, r }), (e: Error & { code?: string }) => ({ ok: false, e: `${e.code ?? ""} ${e.message}` }));
  console.log("(a) restore while locked (no sharing):", JSON.stringify(first), `${Date.now() - t0} ms`);
  await l.release();
  assert.ok(!first.ok, "the restore failed");
  assert.match(String((first as { e: string }).e), /EBUSY|EPERM|locked/i, "a clear lock error");
  assert.deepEqual(await files0(), before, "(a) nothing in the data dir changed, no .tmp left");
  // (b) locked but readable (an editor that shares reads): originals are read, the write fails, earlier writes must be undone.
  l = lock(desk, "Read"); await l.ready;
  t0 = Date.now();
  const mid = await cap.restoreCapsule(name, "pass A synthetic").then((r) => ({ ok: true, r }), (e: Error) => ({ ok: false, e: e.message }));
  console.log("(b) restore while locked (reads shared):", JSON.stringify(mid), `${Date.now() - t0} ms`);
  await l.release();
  const after = await files0();
  const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]);
  console.log("(b) files changed after the failed restore:", changed, "safety backups:", (await readdir(backups)).filter((n) => /pre-restore/.test(n)));
  assert.ok(!mid.ok, "the restore failed on the write");
  assert.match(String((mid as { e: string }).e), /Nothing was changed/, "it says nothing was changed");
  assert.deepEqual(changed, [], "(b) every file written before the failure was put back, nothing created is left");
  assert.ok(Date.now() - t0 < 60_000, "no hang");
  const second = await cap.restoreCapsule(name, "pass A synthetic");
  console.log("restore after unlock:", JSON.stringify(second));
  assert.equal(JSON.parse(await readFile(desk, "utf8")).synthetic.files[0].id, idA, "desk link restored with the original id");
  assert.equal(byName(await v.readMeta(), "Quarterly report.pdf")?.id, idA, "VAULT id restored");
  console.log("leftover .tmp after retry:", (await readdir(pcB)).filter((n) => n.endsWith(".tmp")));
});

test("f419f8f: on the new PC, a same-name save before the cloud restore can't take the cloud-backed record's name", async () => {
  // pcB after the restore above: the record (cloud-backed) is there, its file isn't.
  const rec = byName(await v.readMeta(), "Quarterly report.pdf");
  assert.ok(rec, "restored record present");
  const got = await v.saveUpload(new File(["%PDF-1.4 a different file"], "Quarterly report.pdf"));
  console.log("same-name save before cloud restore →", got);
  assert.notEqual(got, "Quarterly report.pdf", "the cloud-backed name is reserved");
  assert.equal(byName(await v.readMeta(), "Quarterly report.pdf")?.id, rec!.id, "the cloud-backed record (and its desk link id) is kept");
  const back = await v.saveUpload(new File([PDF], "Quarterly report.pdf"), { exact: true, restore: true });
  assert.equal(back, "Quarterly report.pdf");
  assert.equal(byName(await v.readMeta(), "Quarterly report.pdf")?.id, rec!.id, "the cloud restore still keeps the original id");
});
