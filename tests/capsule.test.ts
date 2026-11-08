import { test } from "node:test";
import assert from "node:assert/strict";
import { capsuleName, diffManifests, fallbackDue, fmtMB, makeKeyring, manifest, openCapsule, packFiles, parseName, pickFiles, readHeader, rotate, safeRel, seal, unlock, unpackFiles } from "../src/lib/capsule-pure.ts";

const PASS = "correct horse battery";
const ring = makeKeyring(PASS);

test("crypto round-trip: seal with the public key, open with the passphrase", () => {
  const files = [{ path: "night.json", data: Buffer.from('{"a":1}') }, { path: "vault/.index.json", data: Buffer.from("{}") }];
  const buf = seal(ring, packFiles(files), { at: "2026-10-26T02:00:00.000Z", kind: "nightly", files: 2, bytes: 9 });
  assert.equal(readHeader(buf).header.kind, "nightly");
  assert.ok(!buf.includes(Buffer.from('{"a":1}')) && !buf.includes(Buffer.from(PASS)));
  const { payload } = openCapsule(buf, PASS);
  assert.deepEqual(unpackFiles(payload), files);
});

test("wrong passphrase and tampering are refused", () => {
  const buf = seal(ring, packFiles([{ path: "x.json", data: Buffer.from("1") }]), { at: "2026-10-26T02:00:00.000Z", kind: "nightly", files: 1, bytes: 1 });
  assert.throws(() => openCapsule(buf, "wrong passphrase!"), /Wrong passphrase/);
  const bad = Buffer.from(buf); bad[bad.length - 20] ^= 1;
  assert.throws(() => openCapsule(bad, PASS), /damaged/);
  // the header is authenticated too: changing its date breaks the file
  const h = Buffer.from(buf), i = h.indexOf("2026-10-26"); h[i + 3] = "7".charCodeAt(0);
  assert.throws(() => openCapsule(h, PASS), /damaged/);
  assert.throws(() => readHeader(Buffer.from("hello world, not a capsule")), /Not an ORBIT backup/);
});

test("keyring stores only a verifier; short passphrases are refused", () => {
  assert.ok(!JSON.stringify(ring).includes(PASS));
  assert.ok(unlock(ring, PASS));
  assert.equal(unlock(ring, PASS + "x"), null);
  assert.throws(() => makeKeyring("short"), /at least/);
});

test("pickFiles: stores and vault index in, caches/vault files/tmp/config out, big files skipped", () => {
  const r = pickFiles([
    { path: "night.json", size: 10 }, { path: "activity.jsonl", size: 10 }, { path: "business/niches.json", size: 10 },
    { path: "vault/.index.json", size: 10 }, { path: "vault/notes.json", size: 10 }, { path: "cache/x.json", size: 10 },
    { path: "img-cache/y.json", size: 10 }, { path: "night.json.tmp", size: 10 }, { path: "time-capsule.json", size: 10 }, { path: "huge.json", size: 999 },
  ], 100);
  assert.deepEqual(r.keep.map((e) => e.path), ["night.json", "activity.jsonl", "business/niches.json", "vault/.index.json"]);
  assert.deepEqual(r.skipped.map((e) => e.path), ["huge.json"]);
});

test("safeRel / unpackFiles never let a path leave the data dir", () => {
  for (const p of ["../x.json", "/etc/passwd", "a/../../b", "C:/x", "a\\b", "", "a//b"]) assert.equal(safeRel(p), null, p);
  assert.equal(safeRel("business/niches.json"), "business/niches.json");
  const evil = unpackFiles(packFiles([{ path: "../evil.json", data: Buffer.from("x") }, { path: "time-capsule.json", data: Buffer.from("x") }, { path: "ok.json", data: Buffer.from("y") }]));
  assert.deepEqual(evil.map((f) => f.path), ["ok.json"]);
});

test("diffManifests: create, overwrite, same, keep", () => {
  const now = manifest([{ path: "a.json", data: Buffer.from("1") }, { path: "b.json", data: Buffer.from("2") }, { path: "new.json", data: Buffer.from("n") }]);
  const bak = manifest([{ path: "a.json", data: Buffer.from("1") }, { path: "b.json", data: Buffer.from("OLD") }, { path: "gone.json", data: Buffer.from("g") }]);
  assert.deepEqual(diffManifests(now, bak), { create: ["gone.json"], overwrite: ["b.json"], same: 1, keep: ["new.json"] });
});

test("names parse and rotation keeps 14 nightly + 8 weekly + 3 safety", () => {
  const start = Date.parse("2026-10-26T02:00:00Z");
  const nightly = Array.from({ length: 100 }, (_, i) => capsuleName("nightly", new Date(start - i * 86_400_000)));
  const safety = Array.from({ length: 5 }, (_, i) => capsuleName("pre-restore", new Date(start - i * 3_600_000)));
  assert.equal(parseName(safety[0])?.kind, "pre-restore");
  assert.equal(parseName("orbit-capsule-2026-10-26T01-00-00.orbitcap"), null);
  const del = new Set(rotate([...nightly, ...safety, "notes.txt"]));
  const kept = nightly.filter((n) => !del.has(n));
  assert.deepEqual(kept.slice(0, 14), nightly.slice(0, 14));
  // 2026-10-26 is a Monday: the 14 days span 3 weeks, so 5 more older weekly ones are kept (one per week)
  assert.equal(kept.length, 14 + 5);
  assert.deepEqual(kept.slice(14), ["2026-10-11", "2026-10-04", "2026-09-27", "2026-09-20", "2026-09-13"].map((d) => `orbit-capsule-${d}.orbitcap`));
  assert.deepEqual(safety.filter((n) => !del.has(n)), safety.slice(0, 3));
  assert.ok(!del.has("notes.txt"));
  assert.deepEqual(rotate(nightly.slice(0, 5)), []);
});

test("fmtMB", () => {
  assert.equal(fmtMB(12.3 * 1024 * 1024), "12 MB");
  assert.equal(fmtMB(300), "1 KB");
});

test("capsule.ts: setup, nightly backup, preview, restore with a safety backup (temp dirs)", async () => {
  const { mkdtemp, mkdir, writeFile, readFile, readdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const data = await mkdtemp(path.join(tmpdir(), "orbit-data-")), out = await mkdtemp(path.join(tmpdir(), "orbit-caps-"));
  process.env.ORBIT_DATA_DIR = data;
  await mkdir(path.join(data, "vault"));
  await writeFile(path.join(data, "night.json"), '{"v":1}');
  await writeFile(path.join(data, "vault", ".index.json"), "{}");
  await writeFile(path.join(data, "vault", "photo.json"), "personal");
  const cap = await import("../src/lib/capsule.ts");
  assert.match(String(await cap.setupCapsule({ dir: "relative/x", passphrase: PASS })), /full folder path/);
  assert.equal(await cap.setupCapsule({ dir: out, maxMB: 5, passphrase: PASS }), null);
  assert.ok(!(await readFile(path.join(data, "time-capsule.json"), "utf8")).includes(PASS));
  assert.equal(await cap.backupDue(), true);
  assert.equal(await cap.fallbackBackupDue(), true, "set up, never backed up: the scheduler's safety net runs one");
  const r = await cap.runBackup();
  assert.equal(r.files, 2);
  assert.equal(await cap.backupDue(), false);
  assert.equal(await cap.fallbackBackupDue(), false);
  await writeFile(path.join(data, "night.json"), '{"v":2}');
  await writeFile(path.join(data, "new.json"), "{}");
  await assert.rejects(cap.previewRestore(r.name, "nope nope nope"), /Wrong passphrase/);
  const pv = await cap.previewRestore(r.name, PASS);
  assert.deepEqual([pv.overwrite, pv.create, pv.same, pv.keep], [["night.json"], [], 1, ["new.json"]]);
  const done = await cap.restoreCapsule(r.name, PASS);
  assert.equal(await readFile(path.join(data, "night.json"), "utf8"), '{"v":1}');
  assert.equal(await readFile(path.join(data, "new.json"), "utf8"), "{}");
  assert.ok((await readdir(out)).includes(done.safety));
  const view = await cap.capsuleView();
  assert.ok(view.configured && view.backups.length === 2 && view.last?.ok);
});

test("fallbackDue: the scheduler backs up when the night shift hasn't for 26 h, and retries a failure every 6 h", () => {
  const h = 3_600_000, now = Date.parse("2026-11-07T12:00:00Z"), at = (hours: number) => new Date(now - hours * h).toISOString();
  assert.equal(fallbackDue(undefined, now), true, "set up but never backed up");
  assert.equal(fallbackDue({ at: at(21), ok: true }, now), false, "the night shift (due after 20 h) gets the first chance");
  assert.equal(fallbackDue({ at: at(26), ok: true }, now), true, "no night shift: back up");
  assert.equal(fallbackDue({ at: at(5), ok: false }, now), false, "drive unplugged: don't retry every minute");
  assert.equal(fallbackDue({ at: at(6), ok: false }, now), true, "retry after 6 h");
  assert.equal(fallbackDue({ at: "garbage", ok: true }, now), true, "unreadable date: back up");
  assert.equal(fallbackDue({ at: at(-1), ok: true }, now), true, "date in the future (clock moved): back up");
});
