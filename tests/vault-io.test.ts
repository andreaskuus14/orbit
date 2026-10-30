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
  assert.equal(await v.saveUpload(new File(["%PDF-1.4"], "REPORT~1.PDF")), "REPORT-1.PDF");
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

// Minimal in-memory stand-in for sb.storage.from("vault"), recording the paths it is given.
function fakeSb(opts: { failUpload?: string } = {}) {
  const objects = new Map<string, Blob>();
  const api = {
    async upload(p: string, body: Buffer, o: { upsert?: boolean }) {
      if (opts.failUpload) return { error: { message: opts.failUpload } };
      if (objects.has(p) && !o.upsert) return { error: { message: "The resource already exists", statusCode: "409" } };
      objects.set(p, new Blob([new Uint8Array(body)])); return { error: null };
    },
    async list(prefix: string) {
      return { data: [...objects].filter(([k]) => k.startsWith(prefix + "/")).map(([k, b]) => ({ name: k.slice(prefix.length + 1), id: k, metadata: { size: b.size } })), error: null };
    },
    async remove(ps: string[]) { ps.forEach((p) => objects.delete(p)); return { error: null }; },
    async move(a: string, b: string) { const o = objects.get(a); if (!o) return { error: { message: "Object not found" } }; objects.delete(a); objects.set(b, o); return { error: null }; },
    async download(p: string) { const o = objects.get(p); return o ? { data: o, error: null } : { data: null, error: { message: "Object not found" } }; },
  };
  return { objects, sb: { storage: { from: (b: string) => { assert.equal(b, "vault"); return api; } } } as never };
}
const UID = "0b7d3c1e-2f4a-4c5b-9d6e-7f8a9b0c1d2e";

test("cloud copy: put, list, move, remove, sync, restore", async () => {
  const { objects, sb } = fakeSb();
  const p = (n: string) => `${UID}/vault-files/${n}`;
  await v.saveUpload(new File(["one"], "c1.txt"));
  await v.saveUpload(new File(["two"], "c2.txt"));
  assert.equal(await v.cloudPut(sb, UID, "c1.txt"), "ok");
  assert.match(await v.cloudPut(sb, UID, "c1.txt"), /^failed: a different "c1.txt" is already in the cloud/); // never upserts
  assert.equal(await v.cloudPut(sb, UID, "../c1.txt"), "failed: Invalid file name");
  assert.deepEqual([...(await v.cloudList(sb, UID, true))], [["c1.txt", 3]]);
  const s = await v.syncToCloud(sb, UID);
  assert.ok(s.uploaded >= 1 && s.failed === 0 && s.remaining === 0, JSON.stringify(s));
  assert.ok(objects.has(p("c2.txt")));
  assert.equal(await v.cloudMove(sb, UID, "c2.txt", "c3.txt"), "ok");
  assert.ok(objects.has(p("c3.txt")) && !objects.has(p("c2.txt")));
  assert.equal(await v.cloudRemove(sb, UID, "c1.txt"), "ok");
  assert.equal(await v.cloudRemove(sb, UID, "c1.txt"), "ok"); // not found is fine
  await v.deleteFile("c2.txt");
  await assert.rejects(v.restoreFromCloud(sb, UID, "c2.txt"), /Cloud download failed/);
  assert.equal(await v.restoreFromCloud(sb, UID, "c3.txt"), "c3.txt");
  assert.equal(await readFile(path.join(dir, "c3.txt"), "utf8"), "two");
  await assert.rejects(v.restoreFromCloud(sb, UID, "c3.txt"), /already exists/); // never overwrites or renames a local file
  await assert.rejects(v.restoreFromCloud(sb, UID, "../x"), /Invalid/);
  for (const k of objects.keys()) assert.ok(k.startsWith(`${UID}/vault-files/`), k);
  const bad = fakeSb({ failUpload: "The object exceeded the maximum allowed size" });
  assert.match(await v.cloudPut(bad.sb, UID, "c3.txt"), /^failed: .*0009_vault_cloud\.sql$/);
});

test("cloud-only files are never overwritten or orphaned", async () => {
  const { objects, sb } = fakeSb();
  const key = `${UID}/vault-files/only.txt`;
  objects.set(key, new Blob(["precious"]));
  await v.cloudList(sb, UID, true);
  const taken = await v.cloudOnlyNames(sb, UID);
  assert.deepEqual(taken, ["only.txt"]);
  assert.equal(await v.saveUpload(new File(["new"], "only.txt"), { taken }), "only (2).txt");
  await assert.rejects(v.renameFile("only (2).txt", "only", taken), /already exists/);
  // Even when the cloud listing missed it, a clashing key is refused rather than overwritten.
  await v.saveUpload(new File(["other"], "clash.txt"));
  objects.set(`${UID}/vault-files/clash.txt`, new Blob(["cloud original"]));
  assert.match(await v.cloudPut(sb, UID, "clash.txt"), /^failed:/);
  assert.equal(await objects.get(key)!.text(), "precious");
  assert.equal(await objects.get(`${UID}/vault-files/clash.txt`)!.text(), "cloud original");
});

// Quota (40 MB / 5 GB / 2000 files) is a constant, not injectable here; uploadError is unit-tested in tests/vault.test.ts.

test("delete goes to the trash and restores with the same id; purge erases it", async () => {
  await v.saveUpload(new File(["keep me"], "trash-me.txt"));
  const before = (await v.listDetailed(null)).find((f) => f.name === "trash-me.txt")!;
  assert.ok(before.id && before.hash && before.version === 1 && before.sync === "local");
  const { id, name } = await v.deleteFile("trash-me.txt");
  assert.equal(id, before.id); assert.equal(name, "trash-me.txt");
  assert.ok(!(await names()).includes("trash-me.txt"));
  assert.ok((await v.listTrash()).some((t) => t.id === id));
  assert.equal(await v.restoreTrash(id), "trash-me.txt");
  assert.equal(await readFile(path.join(dir, "trash-me.txt"), "utf8"), "keep me");
  assert.equal((await v.listDetailed(null)).find((f) => f.name === "trash-me.txt")!.id, id);
  const again = await v.deleteFile("trash-me.txt");
  await v.purgeTrash(again.id);
  assert.ok(!(await v.listTrash()).some((t) => t.id === again.id));
  await assert.rejects(v.restoreTrash(again.id), /Not in the trash/);
});

test("rename keeps old references (name and id) working", async () => {
  await v.saveUpload(new File(["%PDF-1.4 signed"], "contract.pdf"));
  const id = (await v.listDetailed(null)).find((f) => f.name === "contract.pdf")!.id;
  assert.equal(await v.renameFile("contract.pdf", "Contract final"), "Contract final.pdf");
  assert.equal(await new Response((await v.readStream("contract.pdf", null)).stream).text(), "%PDF-1.4 signed");
  assert.equal(await new Response((await v.readStream(id, null)).stream).text(), "%PDF-1.4 signed");
  await assert.rejects(v.renameFile("contract.pdf", "x"), /not found/); // rename needs the current name
});

test("import refuses a lying extension and keeps nothing", async () => {
  await assert.rejects(v.saveUpload(new File(["MZ not a pdf"], "fake.pdf")), (e: Error & { status?: number }) => e.status === 415);
  assert.ok(!(await names()).includes("fake.pdf"));
});

test("search tells 'not indexed' apart from 'no match'", async () => {
  await v.saveUpload(new File(["%PDF-1.4 garbage"], "broken.pdf"));
  const r = await v.searchVaultInfo("zzz-nothing");
  assert.deepEqual(r.results, []);
  assert.ok(r.notIndexed.includes("broken.pdf"), JSON.stringify(r));
});

test("sync marks state and never re-uploads a file already in the cloud", async () => {
  const objects = new Map<string, Blob>();
  let uploads = 0;
  const api = {
    async upload(p: string, body: Buffer) { uploads++; objects.set(p, new Blob([new Uint8Array(body)])); return { error: null }; },
    async list(prefix: string) { return { data: [...objects].filter(([k]) => k.startsWith(prefix + "/")).map(([k, b]) => ({ name: k.slice(prefix.length + 1), id: k, metadata: { size: b.size } })), error: null }; },
  };
  const sb = { storage: { from: () => api } } as never;
  await v.syncToCloud(sb, UID);
  const n = uploads;
  assert.ok(n > 0);
  await v.syncToCloud(sb, UID);
  assert.equal(uploads, n);
  const listed = await v.listDetailed(await v.cloudList(sb, UID, true));
  assert.ok(listed.every((f) => f.sync === "cloud" || f.sync === "restored"), JSON.stringify(listed.map((f) => [f.name, f.sync])));
});
