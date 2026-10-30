import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRASH_DAYS, coverageOf, emptyMeta, expired, fromTrash, newMeta, parseMeta, reconcile, recordSync, renamed, resolveRef, retryQueue, searchVerdict, syncState, toTrash, typeMismatch,
} from "../src/lib/vault-meta-pure.ts";

let n = 0;
const mk = () => `id${++n}`;

test("rename keeps references resolving (id, new name, old name)", () => {
  const m = emptyMeta();
  reconcile(m, [{ name: "a.pdf", size: 1 }, { name: "b.txt", size: 2 }], mk, 0);
  const id = Object.values(m.files).find((f) => f.name === "a.pdf")!.id;
  renamed(m, "a.pdf", "contract.pdf");
  renamed(m, "contract.pdf", "final.pdf");
  assert.equal(resolveRef(m, id), "final.pdf");
  assert.equal(resolveRef(m, "a.pdf"), "final.pdf");
  assert.equal(resolveRef(m, "contract.pdf"), "final.pdf");
  assert.equal(resolveRef(m, "b.txt"), "b.txt");
  assert.equal(resolveRef(m, "nope"), null);
  assert.equal(m.files[id].id, id); // same id after renames
});

test("restore after delete keeps the id; expiry after TRASH_DAYS", () => {
  const m = emptyMeta();
  m.files.x = newMeta("x", "r.txt", 5, "abc", 0);
  recordSync(m.files.x, "ok", 10);
  const t = toTrash(m, "r.txt", 5, mk, 100);
  assert.equal(t.id, "x");
  assert.deepEqual(m.files, {});
  assert.equal(expired(m, 100 + (TRASH_DAYS - 1) * 86_400_000).length, 0);
  assert.equal(expired(m, 100 + TRASH_DAYS * 86_400_000).length, 1);
  const f = fromTrash(m, "x", "r (2).txt")!;
  assert.equal(f.id, "x"); assert.equal(f.hash, "abc"); assert.equal(f.name, "r (2).txt");
  assert.equal(f.sync, "local"); // cloud copy was removed on delete: never claims one
  assert.equal(resolveRef(m, "r.txt"), "r (2).txt");
  assert.equal(m.trash.length, 0);
  assert.equal(fromTrash(m, "x", "r.txt"), null);
});

test("reconcile adds new files and drops vanished ones", () => {
  const m = emptyMeta();
  assert.ok(reconcile(m, [{ name: "a", size: 1 }], mk, 0));
  assert.ok(!reconcile(m, [{ name: "a", size: 1 }], mk, 0));
  assert.ok(reconcile(m, [], mk, 0));
  assert.deepEqual(m.files, {});
  assert.deepEqual(parseMeta({ junk: 1 }), emptyMeta());
});

test("sync state: never claims a cloud copy it can't see; failures counted", () => {
  const f = newMeta("i", "a", 1, null, 0);
  assert.equal(syncState(f, false), "local");
  recordSync(f, "pending", 1); assert.equal(syncState(f, false), "pending");
  recordSync(f, "failed: boom", 2); recordSync(f, "failed: boom", 3);
  assert.equal(f.attempts, 2); assert.equal(f.syncError, "boom"); assert.equal(syncState(f, false), "failed");
  assert.equal(syncState(f, true), "cloud");
  recordSync(f, "ok", 4); assert.equal(f.lastSync, 4); assert.equal(f.attempts, 0);
  assert.equal(syncState(f, undefined), "cloud");
  f.sync = "restored"; assert.equal(syncState(f, true), "restored");
  assert.equal(syncState(undefined, false), "local");
});

test("retry queue: failed first, never one already in the cloud", () => {
  const m = emptyMeta();
  m.files.a = newMeta("a", "a", 1, null, 0); m.files.b = newMeta("b", "b", 1, null, 0); m.files.c = newMeta("c", "c", 1, null, 0);
  recordSync(m.files.a, "failed: x", 0);
  const q = retryQueue([{ name: "a", mtime: 1 }, { name: "b", mtime: 5 }, { name: "c", mtime: 9 }], m, new Map([["c", 1]]));
  assert.deepEqual(q, ["a", "b"]);
});

test("coverage and search verdict", () => {
  assert.equal(coverageOf(false, {}), "unsupported");
  assert.equal(coverageOf(true, { error: true }), "failed");
  assert.equal(coverageOf(true, { truncated: true }), "partial");
  assert.equal(coverageOf(true, {}), "indexed");
  assert.equal(searchVerdict(2, 3), "hits");
  assert.equal(searchVerdict(0, 3), "notIndexed");
  assert.equal(searchVerdict(0, 0), "noMatch");
});

test("import type check: bytes must match the extension", () => {
  const b = (s: string | number[]) => (typeof s === "string" ? new TextEncoder().encode(s) : new Uint8Array(s));
  assert.equal(typeMismatch("a.pdf", b("%PDF-1.7 ...")), null);
  assert.match(typeMismatch("a.pdf", b("MZ\x90\x00 exe"))!, /isn't a real \.pdf/);
  assert.equal(typeMismatch("a.png", b([0x89, 0x50, 0x4e, 0x47])), null);
  assert.ok(typeMismatch("a.JPG", b("hello")));
  assert.equal(typeMismatch("a.docx", b("PK\x03\x04")), null);
  assert.equal(typeMismatch("notes.txt", b("anything")), null);
  assert.equal(typeMismatch("empty.pdf", b("")), null);
});
