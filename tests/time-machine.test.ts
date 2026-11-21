import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  activityEntries, blockReason, cleanChange, dayOf, entryCard, inverse, isOpen, ledgerEntries, parseRecords, recordable, recordBlock,
  recordEntries, redact, swap, timeline, type Entry, type MemState, type TmRecord,
} from "../src/lib/time-machine-pure.ts";
import { cleanUndo, undoOf, withOpenUndo, type ActItem } from "../src/lib/activity-pure.ts";

const A = "a".repeat(64), B = "b".repeat(64), C1 = "1".repeat(40), C2 = "2".repeat(40);
const rec = (id: string, extra: Partial<TmRecord> = {}): TmRecord => ({ id, at: "2026-11-21T10:00:00Z", title: "Workspace site: index.html changed", changes: [{ t: "file", ws: "site", path: "index.html", before: A, after: B }], ...extra });
const mem = (content: string, kind = "fact", tags: string[] = []): MemState => ({ kind, title: "Pet sim notes", content, tags, source: null });

// ---- undo / redo ----

test("inverse swaps before/after and chains Undone → Redone → Undone", () => {
  const r = rec("tm00000001");
  const u = inverse(r, "tm00000002", "2026-11-21T10:01:00Z");
  assert.equal(u.undid, r.id);
  assert.equal(u.title, "Undone: Workspace site: index.html changed");
  assert.deepEqual(u.changes, [{ t: "file", ws: "site", path: "index.html", before: B, after: A }]);
  const re = inverse(u, "tm00000003", "2026-11-21T10:02:00Z");
  assert.equal(re.title, "Redone: Workspace site: index.html changed");
  assert.deepEqual(re.changes, r.changes, "undo of the undo is the original change again");
  assert.equal(inverse(re, "tm00000004", "x").title, "Undone: Workspace site: index.html changed");
});

test("only the newest of a chain still offers Undo", () => {
  const a = rec("tm00000001"), b = inverse(a, "tm00000002", "t"), c = inverse(b, "tm00000003", "t");
  const all = [a, b, c];
  assert.deepEqual(all.map((r) => isOpen(r, all)), [false, false, true]);
});

test("a file is only put back while it is exactly as ORBIT left it", () => {
  const c = rec("tm00000001").changes[0];
  assert.equal(blockReason(c, { t: "file", sha: B }), "");
  assert.match(blockReason(c, { t: "file", sha: A }), /changed since/);
  assert.match(blockReason(c, { t: "file", sha: null }), /changed since/);
  // a new file (before null): undo is a trash; the redo writes it again only while it is still gone
  const made = { t: "file" as const, ws: "site", path: "a.css", before: null, after: A };
  assert.equal(blockReason(made, { t: "file", sha: A }), "");
  assert.equal(blockReason(swap(made), { t: "file", sha: null }), "");
  assert.match(blockReason(swap(made), { t: "file", sha: B }), /changed since/);
});

test("memory edit: reverts only when untouched since; tag order doesn't matter", () => {
  const c = { t: "memory" as const, id: "m1", before: mem("old"), after: mem("new", "fact", ["b", "a"]) };
  assert.equal(blockReason(c, { t: "memory", state: mem("new", "fact", ["a", "b"]) }), "");
  assert.match(blockReason(c, { t: "memory", state: mem("owner edited it") }), /changed since/);
  assert.match(blockReason(c, { t: "memory", state: null }), /changed since/);
});

test("settings go back only when that makes ORBIT ask more, never less", () => {
  const loosened = { t: "setting" as const, key: "autonomy:research", before: "ask", after: "do" };
  assert.equal(blockReason(loosened, { t: "setting", value: "do" }), "", "undo of a loosening tightens: allowed");
  const tightened = { t: "setting" as const, key: "autonomy:research", before: "do", after: "ask" };
  assert.match(blockReason(tightened, { t: "setting", value: "ask" }), /Profile → Autonomy/, "undo would loosen: refused");
  assert.match(blockReason({ t: "setting", key: "autonomy:business-send", before: "auto", after: "off" }, { t: "setting", value: "off" }), /Profile → Autonomy/, "never back to auto");
  assert.match(blockReason(loosened, { t: "setting", value: "off" }), /changed since/);
});

test("branch: put away while it still points at ORBIT's commit; brought back only while gone", () => {
  const c = { t: "branch" as const, name: "night/fix-x", before: null, after: C1 };
  assert.equal(blockReason(c, { t: "branch", sha: C1 }), "");
  assert.match(blockReason(c, { t: "branch", sha: C2 }), /moved/);
  assert.equal(blockReason(swap(c), { t: "branch", sha: null }), "");
  assert.equal(cleanChange({ t: "branch", name: "main", before: null, after: C1 }), undefined, "never main");
  assert.equal(cleanChange({ t: "branch", name: "feat/owner", before: null, after: C1 }), undefined, "never the owner's branches");
  assert.equal(cleanChange({ t: "branch", name: "night/../main", before: null, after: C1 }), undefined);
});

test("recordBlock: every change must be reversible, else nothing is done", () => {
  const r: TmRecord = { ...rec("tm00000001"), changes: [rec("x").changes[0], { t: "file", ws: "site", path: "b.js", before: null, after: A }] };
  assert.equal(recordBlock(r, [{ t: "file", sha: B }, { t: "file", sha: A }]), "");
  assert.match(recordBlock(r, [{ t: "file", sha: B }, { t: "file", sha: B }]), /b\.js changed since/);
  assert.notEqual(recordBlock(r, [{ t: "file", sha: B }]), "");
});

test("parseRecords keeps valid records and drops broken lines and changes", () => {
  const good = rec("tm00000001");
  const text = [JSON.stringify(good), "nope", JSON.stringify({ ...good, id: "bad" }), JSON.stringify({ ...good, id: "tm00000002", changes: [{ t: "file", ws: "../x", path: "a", before: null, after: A }] }), ""].join("\n");
  assert.deepEqual(parseRecords(text), [good]);
});

// ---- Activity-log glue ----

test("CORE ws_write's [tm:id] last line becomes a tm undo; cleanUndo validates it", () => {
  assert.deepEqual(undoOf("ws_write", "Workspace site:\n- index.html updated (2 KB)\nUndo: [tm:tm00000001]"), { undo: { kind: "tm", id: "tm00000001" } });
  assert.deepEqual(undoOf("ws_write", "Workspace site:\n- a [tm:tm00000001] b\nmore"), {});
  assert.deepEqual(undoOf("web_search", "Undo: [tm:tm00000001]"), {});
  assert.deepEqual(cleanUndo({ kind: "tm", id: "tm00000001" }), { kind: "tm", id: "tm00000001" });
  assert.equal(cleanUndo({ kind: "tm", id: "../x" }), undefined);
});

test("an Activity undo that wrote a record hides the original's Undo and shows the record (with its redo) once", () => {
  const a = rec("tm00000001"), b = inverse(a, "tm00000002", "2026-11-21T10:05:00Z");
  const items: ActItem[] = [
    { at: "2026-11-21T10:00:00Z", area: "core", title: "CORE ws_write: index.html", undo: { kind: "tm", id: a.id } },
    { at: "2026-11-21T10:05:00Z", area: "core", title: b.title, undid: "tm:tm00000001", undo: { kind: "tm", id: b.id } },
  ];
  const acts = activityEntries(items, [a, b]);
  assert.equal(acts.length, 1);
  assert.equal(acts[0].state, "undone");
  const recs = recordEntries([a, b], items);
  assert.deepEqual(recs.map((e) => [e.id, e.state, e.undo && "tm" in e.undo && e.undo.redo]), [["tm:tm00000002", "open", true]]);
  // the Activity panel still hides the first Undo and offers the redo on the undo line
  assert.deepEqual(withOpenUndo(items).map((x) => !!x.undo), [false, true]);
});

// ---- journal redaction ----

test("journal / LIFE never shows more than 'Journal entry · day'", () => {
  const day = "2026-11-21";
  const entries = timeline(day, {
    items: [
      { at: "2026-11-21T08:00:00Z", area: "core", title: "CORE life_journal: wrote about my secret plans", detail: "feeling sad about X" },
      { at: "2026-11-21T09:00:00Z", area: "operator", title: "CORE vault_rename: diary-2026.md", undo: { kind: "vault-rename", id: "diary-2026.md", to: "old.md" } },
    ],
    recs: [],
    ledger: [
      { id: "e1", type: "journal.saved", created_at: "2026-11-21T07:00:00Z", data: { memoryId: "m9" } },
      { id: "e2", type: "life.habit", created_at: "2026-11-21T07:30:00Z", data: { habit: "therapy", done: true } },
      { id: "e3", type: "memory.saved", created_at: "2026-11-21T07:40:00Z", data: { memoryId: "m8", kind: "journal" } },
    ],
  });
  assert.equal(entries.length, 5);
  for (const e of entries) {
    assert.deepEqual(Object.keys(e).sort(), ["at", "day", "id", "kind", "state", "what"]);
    assert.equal(e.what, "Journal entry");
    assert.equal(e.state, "private");
    const card = entryCard(e, "en");
    assert.equal(card.title, `Journal entry · ${day}`);
    assert.equal(card.result, null);
    assert.equal(card.action, null, "no Undo on a journal line");
  }
  const blob = JSON.stringify(entries);
  for (const secret of ["secret", "sad", "therapy", "diary-2026", "m9", "m8"]) assert.ok(!blob.includes(secret), secret);
  assert.equal(entryCard(entries[0], "et").title, `Päeviku sissekanne · ${day}`);
});

test("journal-like changes are never recorded (memory kind/tags, file names)", () => {
  assert.equal(recordable({ t: "memory", id: "m1", before: mem("x", "journal"), after: mem("y", "journal") }), false);
  assert.equal(recordable({ t: "memory", id: "m1", before: mem("x", "fact", ["life:sleep"]), after: mem("y") }), false);
  assert.equal(recordable({ t: "memory", id: "m1", before: null, after: { ...mem("y"), title: "Päevik 12.11" } }), false);
  assert.equal(recordable({ t: "file", ws: "site", path: "journal.md", before: null, after: A }), false);
  assert.equal(recordable({ t: "vault", before: null, after: { name: "life.json" } }), false);
  assert.equal(recordable({ t: "memory", id: "m1", before: mem("x"), after: mem("y") }), true);
});

test("redact is the last guard even for a hand-built entry", () => {
  const leak: Entry = { id: "x", at: "2026-11-21T08:00:00Z", day: "2026-11-21", kind: "journal", what: "my words", why: "more words", state: "done", undo: { tm: "tm00000001", redo: false } };
  assert.deepEqual(redact(leak), { id: "x", at: leak.at, day: leak.day, kind: "journal", what: "Journal entry", state: "private" });
});

// ---- sends and cards ----

test("sends can't be undone and say so", () => {
  const [e] = ledgerEntries([{ id: "e1", type: "autonomy.act", created_at: "2026-11-21T09:00:00Z", data: { area: "business-send", action: "send", ref: "p1" } }]);
  assert.equal(e.state, "sent");
  const card = entryCard(e, "en");
  assert.equal(card.action, null);
  assert.match(card.result!.text, /Can't be undone: it was sent/);
  const [clip] = activityEntries([{ at: "2026-11-21T09:00:00Z", area: "clips", title: "Published: My short" }], []);
  assert.equal(clip.state, "sent");
});

test("cards: Undo on open entries, 'Undo the undo' on redo-able ones, nothing once undone", () => {
  const a = rec("tm00000001"), b = inverse(a, "tm00000002", "2026-11-21T10:05:00Z");
  const es = recordEntries([a, b], []);
  const [cb, ca] = [es.find((e) => e.id === "tm:tm00000002")!, es.find((e) => e.id === "tm:tm00000001")!];
  assert.equal(entryCard(cb, "en").action?.label, "Undo the undo");
  assert.equal(entryCard(cb, "en").action?.kind, "undo");
  assert.equal(entryCard(ca, "en").action, null);
  assert.match(entryCard(ca, "en").result!.text, /Undone/);
  assert.equal(entryCard(ca, "en").phase, "done");
});

test("days follow ORBIT's day (Europe/Tallinn), not UTC", () => {
  assert.equal(dayOf("2026-11-21T22:30:00Z"), "2026-11-22"); // 00:30 in Tallinn
  assert.equal(dayOf("2026-11-21T21:30:00Z"), "2026-11-21");
  const es = timeline("2026-11-22", { items: [{ at: "2026-11-21T22:30:00Z", area: "system", title: "Stop-all on" }, { at: "2026-11-21T12:00:00Z", area: "system", title: "earlier" }], recs: [], ledger: [] });
  assert.deepEqual(es.map((e) => e.what), ["Stop-all on"]);
});

// ---- IO round trip: a workspace file undone, redone, and undone again ----

test("time machine IO: new file → Undo (trashed) → Undo the undo (back) → Undo; a changed file is never clobbered", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "orbit-tm-"));
  const prev = process.env.ORBIT_DATA_DIR;
  process.env.ORBIT_DATA_DIR = dir;
  try {
    const ws = await import("../src/lib/workspace.ts");
    const tm = await import("../src/lib/time-machine.ts");
    const uid = "00000000-0000-4000-8000-000000000001", sb = null as never;
    assert.ok(!("error" in (await ws.createWorkspace(uid, "site"))));
    await ws.writeWsFile(uid, "site", "notes.md", "v1");
    // CORE changes notes.md and makes a.css
    await ws.writeWsFile(uid, "site", "notes.md", "v2");
    await ws.writeWsFile(uid, "site", "a.css", "body{}");
    const id = await tm.recordWsWrites("site", [{ path: "notes.md", before: Buffer.from("v1"), after: "v2" }, { path: "a.css", before: null, after: "body{}" }], "CORE: test");
    assert.ok(id);
    const u1 = await tm.undoRecord(sb, uid, id!);
    assert.ok(u1.ok, JSON.stringify(u1));
    assert.equal((await ws.readWsFile(uid, "site", "notes.md"))?.text, "v1");
    assert.equal(await ws.readWsFile(uid, "site", "a.css"), null);
    assert.deepEqual(await tm.undoRecord(sb, uid, id!), { ok: false, error: "Already undone", status: 409 });
    const u2 = await tm.undoRecord(sb, uid, (u1 as { id: string }).id); // undo of the undo
    assert.ok(u2.ok, JSON.stringify(u2));
    assert.equal((await ws.readWsFile(uid, "site", "notes.md"))?.text, "v2");
    assert.equal((await ws.readWsFile(uid, "site", "a.css"))?.text, "body{}");
    // the owner edits the file: the next Undo refuses and changes nothing
    await ws.writeWsFile(uid, "site", "notes.md", "owner's own words");
    const u3 = await tm.undoRecord(sb, uid, (u2 as { id: string }).id);
    assert.equal(u3.ok, false);
    assert.equal((await ws.readWsFile(uid, "site", "notes.md"))?.text, "owner's own words");
    assert.equal((await ws.readWsFile(uid, "site", "a.css"))?.text, "body{}");
    // journal-named files are never recorded
    assert.equal(await tm.recordWsWrites("site", [{ path: "journal.md", before: null, after: "x" }], "CORE"), null);
    const titles = (await tm.readRecords()).map((r) => r.title);
    assert.deepEqual(titles, ["Workspace site: 2 files written", "Undone: Workspace site: 2 files written", "Redone: Workspace site: 2 files written"]);
  } finally {
    if (prev === undefined) delete process.env.ORBIT_DATA_DIR; else process.env.ORBIT_DATA_DIR = prev;
    await rm(dir, { recursive: true, force: true });
  }
});
