import { test, mock } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtemp, readdir, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";

// A restore that fails part-way must leave the data dir byte-identical to before (synthetic data, temp dirs).
const tmp = (p: string) => mkdtemp(path.join(os.tmpdir(), p));
const data = await tmp("orbit-rb-data-"), backups = await tmp("orbit-rb-caps-");
process.env.ORBIT_DATA_DIR = data;
const cap = await import("../src/lib/capsule.ts");
const P = "correct horse battery";
const w = async (n: string, s: string | Buffer) => { await mkdir(path.dirname(path.join(data, n)), { recursive: true }); await writeFile(path.join(data, n), s); };
async function snapshot(rel = ""): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const d of await readdir(path.join(data, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (r === "time-capsule.json") continue;
    if (d.isDirectory()) Object.assign(out, { [r + "/"]: "dir" }, await snapshot(r));
    else out[r] = (await readFile(path.join(data, r))).toString("base64");
  }
  return out;
}

await cap.setupCapsule({ dir: backups, maxMB: 1, passphrase: P });
await w("a-first.json", '{"v":"X"}'); await w("b-added.json", '{"v":"X"}'); await w("c-fails.json", '{"v":"X"}'); await w("new/nested/d.json", '{"v":"X"}');
const X = (await cap.runBackup()).name;
// The state before the restore: a-first is oversized (2 MB, limit 1 MB), b-added and new/ don't exist, c-fails differs
await w("a-first.json", Buffer.alloc(2 * 1024 * 1024, 120));
await rm(path.join(data, "b-added.json")); await rm(path.join(data, "new"), { recursive: true });
await w("c-fails.json", '{"v":"PRE"}');
const before = await snapshot();

test("a write failure part-way rolls everything back, oversized files included", async () => {
  const real = fs.rename;
  const m = mock.method(fs, "rename", async (from: string, to: string) => {
    if (to.endsWith("c-fails.json")) throw Object.assign(new Error("EPERM: operation not permitted (simulated lock)"), { code: "EPERM" });
    return real(from, to);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(cap.restoreCapsule(X, P), /Nothing was changed/);
  } finally { m.mock.restore(); syncBuiltinESMExports(); }
  assert.deepEqual(await snapshot(), before);
});

test("a rollback that can't finish names what's left and the safety backup", async () => {
  const realRename = fs.rename, realRm = fs.rm;
  const m1 = mock.method(fs, "rename", async (from: string, to: string) => {
    if (to.endsWith("c-fails.json")) throw Object.assign(new Error("EPERM (simulated)"), { code: "EPERM" });
    return realRename(from, to);
  });
  const m2 = mock.method(fs, "rm", async (p: string, o?: Parameters<typeof realRm>[1]) => {
    if (String(p).endsWith("b-added.json")) throw Object.assign(new Error("EBUSY (simulated)"), { code: "EBUSY" });
    return realRm(p, o);
  });
  syncBuiltinESMExports();
  let msg = "";
  try { await cap.restoreCapsule(X, P); } catch (e) { msg = (e as Error).message; }
  finally { m1.mock.restore(); m2.mock.restore(); syncBuiltinESMExports(); }
  assert.match(msg, /could not undo b-added\.json\. The data from before the restore is in orbit-capsule-pre-restore-/);
  const safety = msg.match(/(orbit-capsule-pre-restore-\S+\.orbitcap)/)![1];
  // The safety backup holds the oversized original
  await rm(path.join(data, "b-added.json"));
  await cap.restoreCapsule(safety, P);
  assert.deepEqual(await snapshot(), before);
});

test("rollback preserves files added by another writer while removing empty restore directories", async () => {
  const real = fs.rename;
  const destination = path.join(data, "new", "nested", "d.json");
  const concurrent = '{"source":"another writer"}';
  const m = mock.method(fs, "rename", async (from: string, to: string) => {
    if (to === destination) {
      await writeFile(path.join(data, "new", "concurrent.json"), concurrent);
      throw Object.assign(new Error("EPERM (simulated)"), { code: "EPERM" });
    }
    return real(from, to);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(cap.restoreCapsule(X, P), /could not undo new\. The data from before the restore/);
    assert.deepEqual(await snapshot(), {
      ...before,
      "new/": "dir",
      "new/concurrent.json": Buffer.from(concurrent).toString("base64"),
    });
  } finally {
    m.mock.restore();
    syncBuiltinESMExports();
    await rm(path.join(data, "new"), { recursive: true, force: true });
  }
});

test("a successful restore still writes every file", async () => {
  const r = await cap.restoreCapsule(X, P);
  assert.equal(r.restored, 4);
  assert.equal(await readFile(path.join(data, "new/nested/d.json"), "utf8"), '{"v":"X"}');
  assert.equal(await readFile(path.join(data, "a-first.json"), "utf8"), '{"v":"X"}');
});
