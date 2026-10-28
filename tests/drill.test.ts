// Recovery drills (roadmap 45) on disposable data: a temp ORBIT_DATA_DIR and a temp backup folder, never the real ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { drillCheck, parses, verifyRestore } from "../src/lib/drill-pure.ts";
import { isAllowedEmail } from "../src/lib/allow.ts";

const PASS = "drill passphrase 123";

async function sandbox() {
  const data = await mkdtemp(path.join(os.tmpdir(), "orbit-data-")), bak = await mkdtemp(path.join(os.tmpdir(), "orbit-bak-"));
  process.env.ORBIT_DATA_DIR = data;
  await writeFile(path.join(data, "dayplan.json"), JSON.stringify({ commitments: [{ id: "c1" }] }));
  await writeFile(path.join(data, "events.jsonl"), '{"a":1}\n{"a":2}\n');
  await mkdir(path.join(data, "vault"), { recursive: true });
  await writeFile(path.join(data, "vault/.index.json"), "[]");
  const capsule = await import("../src/lib/capsule.ts"), drill = await import("../src/lib/drill.ts");
  assert.equal(await capsule.setupCapsule({ dir: bak, maxMB: 5, passphrase: PASS }), null);
  return { data, bak, capsule, drill, done: () => Promise.all([rm(data, { recursive: true, force: true }), rm(bak, { recursive: true, force: true })]) };
}
const tmpDrills = async () => (await readdir(os.tmpdir())).filter((n) => n.startsWith("orbit-drill-"));

test("pure: parse rules and verification", () => {
  assert.ok(parses("a.json", Buffer.from('{"x":1}')) && parses("a.jsonl", Buffer.from('{"x":1}\n\n[2]\n')) && parses("a.txt", Buffer.from("anything")));
  assert.ok(!parses("a.json", Buffer.from("{oops")) && !parses("a.jsonl", Buffer.from('{"x":1}\nnope')));
  const files = [{ path: "a.json", data: Buffer.from("{}") }, { path: "b.json", data: Buffer.from("{bad") }];
  const r = verifyRestore(3, files, new Map([["a.json", Buffer.from("{}")], ["b.json", Buffer.from("{bad")]]));
  assert.equal(r.ok, false); assert.equal(r.restored, 2); assert.equal(r.parsed, 1);
  assert.match(r.bad!.join(), /says 3 files, holds 2/); assert.match(r.bad!.join(), /b.json \(doesn't parse\)/);
  assert.match(verifyRestore(1, files.slice(0, 1), new Map([["a.json", Buffer.from("{ }")]])).bad![0], /not restored intact/);
});

test("pure: Doctor 'Last drill' row", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  assert.equal(drillCheck(null, now).status, "warn");
  assert.equal(drillCheck({ at: "2026-10-27T12:00:00Z", ok: true, backup: "x", restored: 3, expected: 3, parsed: 3 }, now).status, "ok");
  assert.equal(drillCheck({ at: "2026-08-01T12:00:00Z", ok: true, backup: "x", restored: 3, expected: 3, parsed: 3 }, now).status, "warn");
  assert.match(drillCheck({ at: "2026-10-28T11:00:00Z", ok: false, error: "Wrong passphrase" }, now).detail, /Failed today: Wrong passphrase/);
});

test("restore drill: real encrypted backup → temp folder → every file parses and counts match; data dir untouched", async () => {
  const s = await sandbox();
  try {
    const b = await s.capsule.runBackup();
    assert.equal(b.files, 3);
    const before = await readFile(path.join(s.data, "dayplan.json"), "utf8");
    const r = await s.drill.runDrill("", PASS); // "" = newest backup
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual([r.expected, r.restored, r.parsed], [3, 3, 3]);
    assert.equal(await readFile(path.join(s.data, "dayplan.json"), "utf8"), before);
    assert.equal((await s.drill.lastDrill())?.ok, true);
    assert.deepEqual(await tmpDrills(), []); // temp restore folder removed
  } finally { await s.done(); }
});

test("invalid session drill: wrong passphrase, damaged file, missing setup and a foreign account all fail closed", async () => {
  const s = await sandbox();
  try {
    const { name } = await s.capsule.runBackup();
    assert.match((await s.drill.runDrill(name, "not the passphrase")).error!, /Wrong passphrase/);
    const f = path.join(s.bak, name), buf = await readFile(f); buf[buf.length - 20] ^= 1; await writeFile(f, buf);
    assert.match((await s.drill.runDrill(name, PASS)).error!, /damaged/);
    assert.equal((await s.drill.lastDrill())?.ok, false); // Doctor shows the failure
    assert.deepEqual(await tmpDrills(), []);
    await writeFile(path.join(s.data, "time-capsule.json"), "{corrupt");
    assert.match((await s.drill.runDrill("", PASS)).error!, /damaged: set the time capsule up again/);
    process.env.ORBIT_ALLOWED_EMAILS = "owner@example.com";
    assert.equal(isAllowedEmail(undefined), false); // no/expired session → no user → refused
    assert.equal(isAllowedEmail("someone@else.com"), false);
    delete process.env.ORBIT_ALLOWED_EMAILS;
  } finally { await s.done(); }
});

test("restart during work: half-written temp files are ignored, and a restore re-run after a crash converges", async () => {
  const s = await sandbox();
  try {
    const { name } = await s.capsule.runBackup();
    // crash mid-write: atomicWrite leaves *.tmp siblings, the real files keep their last good version
    await writeFile(path.join(s.data, "dayplan.json.tmp"), '{"half');
    await writeFile(path.join(s.bak, name.replace(".orbitcap", ".orbitcap.tmp")), "half a backup");
    await writeFile(path.join(s.data, "dayplan.json"), JSON.stringify({ commitments: [] })); // work changed after the backup
    // overlapping work (night backup + restore) is serialized, never interleaved
    const [r, b2] = await Promise.all([s.capsule.restoreCapsule(name, PASS), s.capsule.runBackup()]);
    assert.equal(b2.files, 3); // the .tmp leftover is not a store and isn't backed up
    assert.equal(r.restored, 3);
    assert.equal(JSON.parse(await readFile(path.join(s.data, "dayplan.json"), "utf8")).commitments[0].id, "c1");
    const again = await s.capsule.restoreCapsule(name, PASS); // restart → run it again: same result
    assert.equal(again.restored, 3);
    assert.equal((await s.drill.runDrill(name, PASS)).ok, true);
  } finally { await s.done(); }
});
