import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  LOCKED_NOTE, PREFIX, isSealed, keyFileText, keyId, lifeAad, memoryAad, open, parseKeyFile, parseRecoveryKey, plainJournalIn, plaintextLeft,
  planLife, planLifeOpen, planRows, planRowsOpen, recoveryKey, redactJournalRow, seal, sealer, type JournalRow,
} from "../src/lib/journal-crypt-pure.ts";

const key = randomBytes(32), other = randomBytes(32), s = sealer(key);

test("seal/open: round-trip (unicode, empty, long), random IV, key id in the value", () => {
  for (const t of ["", "Täna oli hea päev 🌙", "x".repeat(20_000)]) {
    const v = seal(key, t, lifeAad("2026-11-20"));
    assert.ok(v.startsWith(`${PREFIX}${keyId(key)}:`));
    assert.equal(open(key, v, lifeAad("2026-11-20")), t);
  }
  assert.notEqual(seal(key, "same", "a"), seal(key, "same", "a"));
  assert.ok(!seal(key, "secret words here", "a").includes("secret"));
});

test("open refuses a wrong key, a wrong field/day (AAD) and any tampering", () => {
  const v = seal(key, "private", lifeAad("2026-11-20"));
  assert.throws(() => open(other, v, lifeAad("2026-11-20")), /another key/);
  assert.throws(() => open(key, v, lifeAad("2026-11-19")));
  assert.throws(() => open(key, seal(key, "t", memoryAad("u", "title")), memoryAad("u", "content")));
  const body = v.split(":")[2], flipped = body.slice(0, -2) + (body.at(-2) === "A" ? "B" : "A") + body.at(-1);
  assert.throws(() => open(key, `${PREFIX}${keyId(key)}:${flipped}`, lifeAad("2026-11-20")));
  assert.throws(() => seal(Buffer.alloc(16), "x", "a"), /32 bytes/);
});

test("recovery key and key file: round-trip, typo caught, case and dashes ignored", () => {
  const r = recoveryKey(key);
  assert.match(r, /^([0-9A-F]{4}-){16}[0-9A-F]{4}$/);
  assert.ok(parseRecoveryKey(r)!.equals(key));
  assert.ok(parseRecoveryKey(r.toLowerCase().replace(/-/g, " "))!.equals(key));
  const typo = (r[0] === "0" ? "1" : "0") + r.slice(1);
  assert.equal(parseRecoveryKey(typo), null);
  assert.equal(parseRecoveryKey("short"), null);
  assert.ok(parseKeyFile(keyFileText(key))!.equals(key));
  assert.equal(parseKeyFile("bm90IGEga2V5"), null);
});

test("redactJournalRow: journal rows outside LIFE show only the day and the locked note", () => {
  const r = redactJournalRow({ id: "1", kind: "journal", title: seal(key, "Today in a minute · 2026-11-20", "a"), content: seal(key, "secret", "b"), created_at: "2026-11-20T19:00:00Z" });
  assert.equal(r.title, "Journal entry · 2026-11-20");
  assert.equal(r.content, LOCKED_NOTE);
  assert.equal(r.locked, true);
  const n = { id: "2", kind: "note", title: "Groceries", content: "milk", created_at: "x" };
  assert.equal(redactJournalRow(n), n);
});

// ---- migration on a fake dataset ----
const fakeLife = { "2026-11-18": "Walked with Marko", "2026-11-19": "Bad sleep, worried about exams", "2026-11-20": "" };
const fakeRows: JournalRow[] = [
  { id: "a", user_id: "u1", kind: "journal", title: "Today in a minute · 2026-11-19", content: "Felt good about the model", has_embedding: true },
  { id: "b", user_id: "u1", kind: "journal", title: "Voice note", content: "", has_embedding: false },
  { id: "c", user_id: "u1", kind: "note", title: "Not journal", content: "public", has_embedding: true },
];
const applyLife = (j: Record<string, string>, p: Record<string, string>) => ({ ...j, ...p });
const applyRows = (rows: JournalRow[], p: { id: string; title: string; content: string }[], dropEmb = true) =>
  rows.map((r) => { const u = p.find((x) => x.id === r.id); return u ? { ...r, title: u.title, content: u.content, has_embedding: dropEmb ? false : r.has_embedding } : r; });

test("migration: seals every journal value, drops journal embeddings, leaves other rows alone", () => {
  const life = applyLife(fakeLife, planLife(fakeLife, s));
  const rows = applyRows(fakeRows, planRows(fakeRows, s));
  assert.ok(isSealed(life["2026-11-18"]) && isSealed(life["2026-11-19"]) && isSealed(life["2026-11-20"]));
  assert.ok(rows.filter((r) => r.kind === "journal").every((r) => isSealed(r.title) && isSealed(r.content) && !r.has_embedding));
  assert.deepEqual(rows[2], fakeRows[2]);
  assert.deepEqual(plaintextLeft({ life, rows }), []);
});

test("migration is idempotent: a second run plans nothing and changes nothing", () => {
  const life = applyLife(fakeLife, planLife(fakeLife, s));
  const rows = applyRows(fakeRows, planRows(fakeRows, s));
  assert.deepEqual(planLife(life, s), {});
  assert.deepEqual(planRows(rows, s), []);
  // a half-done run (sealed but embedding left) only drops the embedding
  const half = rows.map((r) => (r.id === "a" ? { ...r, has_embedding: true } : r));
  const p = planRows(half, s);
  assert.equal(p.length, 1);
  assert.equal(p[0].title, half[0].title);
});

test("rollback gives back exactly the original text", () => {
  const life = applyLife(fakeLife, planLife(fakeLife, s));
  const rows = applyRows(fakeRows, planRows(fakeRows, s));
  assert.deepEqual(applyLife(life, planLifeOpen(life, s)), fakeLife);
  assert.deepEqual(applyRows(rows, planRowsOpen(rows, s), false).map(({ title, content }) => ({ title, content })), fakeRows.map(({ title, content }) => ({ title, content })));
});

test("no plaintext journal left: finds plain days, plain rows, leftover embeddings and old exports", () => {
  const issues = plaintextLeft({ life: fakeLife, rows: fakeRows, files: [{ name: "orbit-2026-11-01.json", text: JSON.stringify({ local: { life: { journal: { "2026-11-01": "old" } } }, tables: { memories: [{ kind: "journal", title: "t", content: "c" }] } }) }] });
  assert.equal(issues.length, 4);
  assert.match(issues[0], /life\.json: 2 journal day/);
  assert.match(issues[1], /2 journal row/);
  assert.match(issues[2], /1 journal row\(s\) still have an embedding/);
  assert.match(issues[3], /orbit-2026-11-01\.json: 2 plain-text/);
  assert.equal(plainJournalIn("not json"), 0);
});

test("scripts/journal-encrypt.ts --local-only: backup, encrypt, idempotent rerun, check, rollback on a fake data dir", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "orbit-jc-"));
  mkdirSync(path.join(dir, "keys"));
  writeFileSync(path.join(dir, "keys", "journal.key"), keyFileText(key));
  const store = { habits: [], reminders: [], focus: {}, journal: { ...fakeLife } };
  writeFileSync(path.join(dir, "life.json"), JSON.stringify(store));
  const env = { ...process.env, ORBIT_DATA_DIR: dir, ORBIT_BACKUP_DIR: path.join(dir, "none") };
  const run = (...a: string[]) => execFileSync(process.execPath, ["--no-warnings", "--experimental-strip-types", "scripts/journal-encrypt.ts", "--local-only", "--force", ...a], { env, encoding: "utf8" });
  const life = () => JSON.parse(readFileSync(path.join(dir, "life.json"), "utf8")).journal as Record<string, string>;

  assert.throws(() => run("--check")); // plain text left → exit 1
  const out = run();
  assert.match(out, /Encrypted backup/);
  assert.match(out, /No plain-text journal left/);
  assert.ok(Object.values(life()).every(isSealed));
  assert.ok(!readFileSync(path.join(dir, "life.json"), "utf8").includes("Marko"));
  const backups = readdirSync(path.join(dir, "journal-backups"));
  assert.equal(backups.length, 1);
  assert.ok(!readFileSync(path.join(dir, "journal-backups", backups[0]), "utf8").includes("Marko")); // the backup is encrypted too

  const before = life();
  assert.match(run(), /Nothing to do/);
  assert.deepEqual(life(), before); // idempotent
  assert.match(run("--check"), /No plain-text journal left/);

  run("--rollback");
  assert.deepEqual(life(), fakeLife);
  run();
  run("--restore-backup", path.join(dir, "journal-backups", backups[0]));
  assert.deepEqual(life(), fakeLife); // the first backup held the original plain text
});
