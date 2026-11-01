import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { archBrowserKey, archScopeKey, archUrl, deskInput, emptyDesk, projectId } from "../src/lib/project-desk-pure.ts";
import { getDesk, saveDesk } from "../src/lib/project-desk.ts";

const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222";
test("project storage separates projects and preserves the existing unassigned ARCH keys", () => {
  assert.ok(projectId(a));
  for (const invalid of ["", "../x", "__proto__", a + "/x", null]) assert.equal(projectId(invalid), false);
  assert.equal(archScopeKey("owner", null), "owner");
  assert.notEqual(archScopeKey("owner", a), archScopeKey("owner", b));
  assert.notEqual(archScopeKey("owner", a), archScopeKey("other", a));
  assert.equal(archBrowserKey(null), "orbit.arch.v1");
  assert.notEqual(archBrowserKey(a), archBrowserKey(b));
  assert.equal(archUrl("scene", null), "/api/arch/scene");
  assert.equal(archUrl("versions", a), `/api/arch/versions?project=${a}`);
});
test("desk input bounds notes and references and rejects executable or credential-bearing links", () => {
  const ref = { title: " Study ", url: "https://example.com" };
  assert.deepEqual(deskInput({ notes: "Keep the original", references: [ref, ref] }), { notes: "Keep the original", references: [{ title: "Study", url: "https://example.com/" }] });
  for (const url of ["javascript:alert(1)", "file:///private", "https://user:secret@example.com", "not a url"]) assert.equal(typeof deskInput({ notes: "", references: [{ title: "bad", url }] }), "string");
  assert.equal(typeof deskInput({ notes: "x".repeat(6001), references: [] }), "string");
  assert.equal(typeof deskInput({ notes: "", references: Array(51).fill(ref) }), "string");
  assert.equal(typeof deskInput({ notes: "", references: [null] }), "string");
});
test("durable desk keeps projects/users apart, serializes saves and refuses stale/corrupt updates", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "orbit-project-desk-")), previous = process.env.ORBIT_DATA_DIR;
  process.env.ORBIT_DATA_DIR = dir;
  try {
    assert.deepEqual(await getDesk("owner", a), emptyDesk());
    const input = { notes: "House decisions", references: [{ title: "Reference", url: "https://example.com/" }] };
    const writes = await Promise.all([saveDesk("owner", a, 0, input), saveDesk("owner", a, 0, { notes: "Stale tab", references: [] })]);
    assert.equal(writes.filter(Boolean).length, 1);
    assert.equal((await getDesk("owner", a)).notes, "House decisions");
    assert.deepEqual(await getDesk("owner", b), emptyDesk());
    assert.deepEqual(await getDesk("other", a), emptyDesk());
    await saveDesk("owner", b, 0, { notes: "Other model", references: [] });
    assert.equal((await getDesk("owner", a)).notes, "House decisions");
    const file = path.join(dir, "project-desks.json");
    await writeFile(file, "{broken");
    await assert.rejects(saveDesk("owner", a, 1, input));
    assert.equal(await readFile(file, "utf8"), "{broken");
    await assert.rejects(getDesk("owner", a));
  } finally {
    if (previous === undefined) delete process.env.ORBIT_DATA_DIR; else process.env.ORBIT_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
