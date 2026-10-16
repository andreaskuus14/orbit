import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Real file I/O against a throwaway data dir; must be set before vault.ts is imported.
process.env.ORBIT_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "orbit-vault-test-"));
const v = await import("../src/lib/vault.ts");
const dir = v.vaultDir();
const names = async () => (await v.listVault()).map((f) => f.name).sort();

test("upload sanitizes names and suffixes collisions (case-insensitive)", async () => {
  assert.equal(await v.saveUpload(new File(["hello needle world"], "../notes.txt")), "notes.txt");
  assert.equal(await v.saveUpload(new File(["second"], "NOTES.TXT")), "NOTES (2).TXT");
  assert.equal(await v.saveUpload(new File(["x"], "REPORT~1.PDF")), "REPORT-1.PDF");
  assert.deepEqual(await names(), ["NOTES (2).TXT", "REPORT-1.PDF", "notes.txt"]);
  assert.equal(await readFile(path.join(dir, "notes.txt"), "utf8"), "hello needle world");
});

test("rejects traversal, index, short-name aliases, directories and symlinks", async () => {
  await mkdir(path.join(dir, "sub"));
  for (const bad of ["../notes.txt", "..\\notes.txt", ".index.json", "REPORT~1.PDF", "sub/notes.txt", ""])
    await assert.rejects(v.readStream(bad, null), /Invalid/, bad);
  await assert.rejects(v.readStream("sub", null), /not found/);
  await assert.rejects(v.deleteFile("sub"), /not found/);
  let linked = true;
  try { await symlink(path.join(dir, "notes.txt"), path.join(dir, "link.txt")); } catch { linked = false; } // Windows without symlink rights
  if (linked) {
    await assert.rejects(v.readStream("link.txt", null), /not found/);
    assert.ok(!(await names()).includes("link.txt"));
    // An existing but unlisted destination (like an NTFS 8.3 alias) is never overwritten.
    await assert.rejects(v.saveUpload(new File(["new"], "link.txt")), /exists/);
    await assert.rejects(v.renameFile("REPORT-1.PDF", "link.txt"), /exists/);
  }
});

test("rename: keeps extension, refuses existing names, allows case-only", async () => {
  await assert.rejects(v.renameFile("NOTES (2).TXT", "notes.txt"), (e: Error & { status?: number }) => e.status === 409);
  assert.equal(await v.renameFile("NOTES (2).TXT", "draft"), "draft.TXT");
  assert.equal(await v.renameFile("draft.TXT", "Draft.TXT"), "Draft.TXT");
  assert.ok((await names()).includes("Draft.TXT"));
});

test("range read, preview, search, readVaultText", async () => {
  const r = await v.readStream("notes.txt", "bytes=6-11");
  assert.deepEqual(r.range, [6, 11]);
  assert.equal(await new Response(r.stream).text(), "needle");
  assert.equal((await v.readStream("notes.txt", "bytes=99-", )).stream, null);
  assert.equal((await v.previewText("notes.txt")).text, "hello needle world");
  assert.deepEqual(await v.searchVault("needle"), [{ name: "notes.txt", snippet: "hello needle world" }]);
  assert.deepEqual((await v.searchVault("draft")).map((x) => x.name), ["Draft.TXT"]); // by name
  assert.equal(await v.readVaultText("notes.txt", 5), "hello");
  assert.equal(await v.readVaultText("../notes.txt"), null);
  assert.equal(await v.readVaultText("missing.txt"), null);
  assert.ok(JSON.parse(await readFile(path.join(dir, ".index.json"), "utf8"))["notes.txt"]);
});

test("delete", async () => {
  await writeFile(path.join(dir, "keep.bin"), "k");
  await v.deleteFile("notes.txt");
  assert.ok(!(await names()).includes("notes.txt"));
  await assert.rejects(v.deleteFile("notes.txt"), /not found/);
  assert.deepEqual(await v.searchVault("needle"), []);
});
// Quota (40 MB / 5 GB / 2000 files) is a constant, not injectable here; uploadError is unit-tested in tests/vault.test.ts.
