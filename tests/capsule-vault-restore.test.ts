import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { byName, resolveRef } from "../src/lib/vault-meta-pure.ts";

// Synthetic new-PC restore: PC A backs up, PC B (empty data dir, same backup folder) restores. All temp dirs, no network.
const tmp = (p: string) => mkdtemp(path.join(os.tmpdir(), p));
const pcA = await tmp("orbit-pcA-"), pcB = await tmp("orbit-pcB-"), backups = await tmp("orbit-capsules-");
const PASS = "correct horse battery";
process.env.ORBIT_DATA_DIR = pcA;
const cap = await import("../src/lib/capsule.ts");
const v = await import("../src/lib/vault.ts");
const PDF = "%PDF-1.4 synthetic plan";

test("VAULT ids survive a capsule restore and the cloud restore of the same file", async () => {
  // PC A: a cloud-synced file a desk links to by id, plus a local-only file
  process.env.ORBIT_DATA_DIR = pcA;
  assert.equal(await v.saveUpload(new File([PDF], "plan.pdf")), "plan.pdf");
  assert.equal(await v.saveUpload(new File(["only here"], "local.txt")), "local.txt");
  await v.markSync("plan.pdf", "ok");
  const idA = byName(await v.readMeta(), "plan.pdf")!.id;
  await writeFile(path.join(pcA, "desk-link.json"), JSON.stringify({ files: [{ id: idA }] })); // stands in for a desk/contract link
  assert.equal(await cap.setupCapsule({ dir: backups, maxMB: 25, passphrase: PASS }), null);
  const { name } = await cap.runBackup();

  // PC B: fresh data dir, same backup folder; the config is never in a backup, so set it up again (old backups open with their own passphrase)
  process.env.ORBIT_DATA_DIR = pcB;
  assert.equal(await cap.setupCapsule({ dir: backups, maxMB: 25, passphrase: "a new passphrase" }), null);
  await cap.restoreCapsule(name, PASS);
  const link = JSON.parse(await readFile(path.join(pcB, "desk-link.json"), "utf8")).files[0].id;
  assert.equal(link, idA);
  assert.equal(byName(await v.readMeta(), "plan.pdf")?.id, idA, "vault/.meta.json is in the capsule");

  // Opening VAULT with no files yet keeps the cloud-backed record and drops the local-only one
  assert.deepEqual(await v.listDetailed(null), []);
  const m = await v.readMeta();
  assert.equal(byName(m, "plan.pdf")?.id, idA, "cloud-backed record kept while its file is missing");
  assert.equal(byName(m, "local.txt"), undefined, "missing local-only record dropped");

  // Explicit cloud restore (the download itself is stubbed: same bytes, same path as restoreFromCloud) keeps the id
  assert.equal(await v.saveUpload(new File([PDF], "plan.pdf"), { exact: true, restore: true }), "plan.pdf");
  const after = await v.readMeta();
  assert.equal(Object.values(after.files).filter((f) => f.name === "plan.pdf").length, 1);
  assert.equal(resolveRef(after, link), "plan.pdf");
  const chunks: Buffer[] = [];
  for await (const c of (await v.readStream(link, null)).stream as unknown as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(c));
  assert.equal(Buffer.concat(chunks).toString(), PDF, "the desk link opens the restored file by its id");
});

test("a normal upload with a stale record's name gets a new id", async () => {
  const dir = await tmp("orbit-pcC-");
  process.env.ORBIT_DATA_DIR = dir;
  await writeFile(path.join(dir, "x"), ""); // data dir exists
  await v.saveUpload(new File(["a"], "notes.txt"));
  await v.markSync("notes.txt", "ok");
  const old = byName(await v.readMeta(), "notes.txt")!.id;
  await v.deleteFile("notes.txt").catch(() => {}); // goes to the trash: record leaves m.files
  // Recreate a stale local-only record by hand, then upload a different file under that name
  const metaPath = path.join(v.vaultDir(), ".meta.json"), meta = JSON.parse(await readFile(metaPath, "utf8"));
  meta.files[old] = { id: old, name: "notes.txt", version: 1, hash: null, size: 1, addedAt: 0, formerNames: [], sync: "local", lastSync: null, syncError: null, attempts: 0 }; // local-only: its name isn't reserved
  await writeFile(metaPath, JSON.stringify(meta));
  assert.equal(await v.saveUpload(new File(["unrelated"], "notes.txt")), "notes.txt");
  const recs = Object.values((await v.readMeta()).files).filter((f) => f.name === "notes.txt");
  assert.equal(recs.length, 1);
  assert.notEqual(recs[0].id, old);
});

test("a same-name upload before the cloud restore gets its own name and id; the restore still keeps the original", async () => {
  const dir = await tmp("orbit-pcD-");
  process.env.ORBIT_DATA_DIR = dir;
  await v.saveUpload(new File([PDF], "plan.pdf"));
  await v.markSync("plan.pdf", "ok");
  const orig = byName(await v.readMeta(), "plan.pdf")!.id;
  // New PC: the file is gone locally, its cloud-backed record (from the capsule) stays
  await rm(path.join(v.vaultDir(), "plan.pdf"));
  await v.listDetailed(null);
  // A normal upload, no cloud-only names passed (cloud list unavailable): must not take the name or the id
  const other = await v.saveUpload(new File(["%PDF-1.4 a different plan"], "plan.pdf"));
  assert.notEqual(other, "plan.pdf");
  const m = await v.readMeta();
  assert.notEqual(byName(m, other)!.id, orig);
  assert.equal(byName(m, "plan.pdf")!.id, orig);
  // Then the cloud copy comes back under its own name and id; the original link opens it
  assert.equal(await v.saveUpload(new File([PDF], "plan.pdf"), { exact: true, restore: true }), "plan.pdf");
  const chunks: Buffer[] = [];
  for await (const c of (await v.readStream(orig, null)).stream as unknown as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(c));
  assert.equal(Buffer.concat(chunks).toString(), PDF);
});
