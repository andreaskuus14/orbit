import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { archBrowserKey, archScopeKey, archUrl, deskInput, emptyDesk, projectId, readDeskDraft } from "../src/lib/project-desk-pure.ts";
import { exportDesks, getDesk, saveDesk } from "../src/lib/project-desk.ts";

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
    await saveDesk("other", a, 0, { notes: "Other user private notes", references: [] });
    assert.deepEqual(Object.keys((await exportDesks("owner")).desks).sort(), [a, b]);
    assert.doesNotMatch(JSON.stringify(await exportDesks("owner")), /Other user private/);
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
test("desk export keeps valid records and names an invalid one instead of failing the whole section", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "orbit-project-desk-")), previous = process.env.ORBIT_DATA_DIR;
  process.env.ORBIT_DATA_DIR = dir;
  try {
    const good = { notes: "Keep me", references: [], rev: 2 };
    await writeFile(path.join(dir, "project-desks.json"), JSON.stringify({ [`owner:${a}`]: good, [`owner:${b}`]: { notes: 7, references: "x", rev: -1 }, [`other:${b}`]: { notes: 1 } }));
    const out = await exportDesks("owner");
    assert.deepEqual(out.desks, { [a]: good });
    assert.deepEqual(out.skipped, [b]);
    assert.match(out.warning ?? "", new RegExp(`1 project desk record\\(s\\) were invalid.*${b}.*unchanged in project-desks.json`));
    assert.doesNotMatch(out.warning ?? "", /other/); // another user's bad record isn't reported to this user
    assert.equal((await exportDesks("nobody")).warning, undefined);
    await assert.rejects(getDesk("owner", b)); // reading/saving that desk still refuses, so it can't be overwritten blind
  } finally {
    if (previous === undefined) delete process.env.ORBIT_DATA_DIR; else process.env.ORBIT_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
test("file and clip membership uses bounded stable IDs, and palettes accept only colors", () => {
  const input = { notes: "", references: [], files: [{ id: a, label: "Reference.png" }, { id: a, label: "Same file" }], productions: [{ id: "job-1:clip-1", title: "My clip" }], palette: ["#AABBCC", "#aabbcc"] };
  const result = deskInput(input);
  assert.notEqual(typeof result, "string");
  if (typeof result === "string") return;
  assert.equal(result.files?.length, 1); assert.deepEqual(result.palette, ["#aabbcc"]);
  assert.equal(typeof deskInput({ ...input, files: [{ id: "../secret", label: "Bad" }] }), "string");
  assert.equal(typeof deskInput({ ...input, productions: [{ id: "javascript:alert(1)", title: "Bad" }] }), "string");
  assert.equal(typeof deskInput({ ...input, palette: ["url(https://outside)"] }), "string");
  assert.equal(typeof deskInput({ ...input, files: Array(51).fill(input.files[0]) }), "string");
});
test("tab draft recovery validates links and retains its old revision for conflict checking", () => {
  const draft = { desk: { rev: 2, notes: "Unsaved", references: [] }, title: "Draft link", url: "", request: "Do not submit yet" };
  assert.deepEqual(readDeskDraft(draft), draft);
  assert.equal(readDeskDraft({ ...draft, desk: { ...draft.desk, references: [{ title: "Bad", url: "javascript:x" }] } }), null);
  assert.equal(readDeskDraft({ ...draft, desk: { ...draft.desk, rev: -1 } }), null);
});
