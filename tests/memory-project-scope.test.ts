import { test } from "node:test";
import assert from "node:assert/strict";
import { currentOnly, isCurrent, legacyScopeKey, projectScopeKey, scopeOfRecord, scopeTags, temporaryOf, typeLabel } from "../src/lib/memory-types-pure.ts";
import { addProject, chatContext, deleteProject, emptyChats, moveChat, updateProject } from "../src/lib/core-chats-pure.ts";
import { correctionRecords } from "../src/lib/provenance-pure.ts";

const at = "2026-11-01T12:00:00Z", now = Date.parse(at);
const record = (content: string, tags: string[] = []) => ({ id: "m", kind: "note", source: "capture", created_at: at, content, tags });

test("project-only wording without a project never becomes global truth", () => {
  for (const text of ["In this project use tabs", "For this project use British spelling", "Selles projektis kasuta tabe"]) {
    assert.equal(temporaryOf(text, at)?.kind, "project");
    const r = record(text);
    for (const project of [undefined, "ORBIT", "Other"]) {
      assert.equal(isCurrent(r, { now, project }), false, text);
      assert.deepEqual(currentOnly([r], { now, project }), []);
    }
    assert.doesNotMatch(typeLabel(r), /undefined/);
  }
});

test("capture retains unresolved project scope even when the cue was in the title", () => {
  const tags = scopeTags("For this project use tabs\nIndent with tabs", ["style"], {});
  assert.deepEqual(tags, ["style", "scope:"]);
  // Retrieval sees content, not the title/capture string that originally supplied the scope cue.
  const r = record("Indent with tabs", tags);
  assert.equal(scopeOfRecord(r).kind, "project");
  for (const project of [undefined, "ORBIT", "unknown", ""]) assert.equal(isCurrent(r, { now, project }), false);
});

test("an explicit empty project scope is closed, while named projects and global facts still work", () => {
  const unresolved = record("Use tabs", ["scope:"]);
  assert.equal(scopeOfRecord(unresolved).kind, "project");
  assert.equal(isCurrent(unresolved, { now }), false);
  assert.equal(isCurrent(unresolved, { now, project: "ORBIT" }), false);
  const text = "For this project use tabs";
  const named = record("Use tabs", scopeTags(text, [], { project: "ORBIT" }));
  assert.deepEqual(named.tags, ["scope:ORBIT"]);
  assert.equal(isCurrent(named, { now, project: "orbit" }), true);
  assert.equal(isCurrent(named, { now, project: "Other" }), false);
  assert.equal(isCurrent(named, { now }), false);
  assert.equal(isCurrent(record("The capital of Estonia is Tallinn"), { now }), true);
});

// Synthetic #423 isolation checks: CORE project memory is scoped by stable project ID, never by display name.
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function twoProjects(nameA: string, nameB: string) {
  const s = emptyChats();
  addProject(s, A, nameA, "", at); addProject(s, B, nameB, "", at);
  moveChat(s, "chat-a", A); moveChat(s, "chat-b", B);
  const ctx = (chat: string) => { const m = chatContext(s, chat).memoryProject!; return { now, project: m.scope, legacy: m.legacy }; };
  return { s, ctx, save: (chat: string, text: string) => record(text, scopeTags(text, [], { project: chatContext(s, chat).memoryProject!.scope })) };
}

test("projects whose names differ only by case get separate memory scopes", () => {
  const { ctx, save } = twoProjects("Kitchen", "kitchen");
  assert.notEqual(ctx("chat-a").project, ctx("chat-b").project);
  const r = save("chat-a", "For this project use oak worktops");
  assert.deepEqual(r.tags, [`scope:${projectScopeKey(A)}`]);
  assert.equal(r.tags[0].length, 40); // fits the tag cap whole, so the ID is never cut
  assert.equal(isCurrent(r, ctx("chat-a")), true);
  assert.equal(isCurrent(r, ctx("chat-b")), false);
  // An old name-scoped memory is ambiguous between them: assigned to neither.
  const old = record("Use oak worktops", ["scope:Kitchen"]);
  assert.equal(ctx("chat-a").legacy, undefined); assert.equal(ctx("chat-b").legacy, undefined);
  assert.equal(isCurrent(old, ctx("chat-a")), false); assert.equal(isCurrent(old, ctx("chat-b")), false);
});

test("names that collide after the old 34-char tag cut share nothing, old or new", () => {
  const long = "Kitchen renovation north wing 2026 phase", other = "Kitchen renovation north wing 2026 budget";
  assert.equal(legacyScopeKey(long), legacyScopeKey(other));
  const { ctx, save } = twoProjects(long, other);
  const r = save("chat-b", "For this project keep the budget under 20k");
  assert.equal(isCurrent(r, ctx("chat-b")), true);
  assert.equal(isCurrent(r, ctx("chat-a")), false);
  const old = record("Keep the budget under 20k", [`scope:${long}`.slice(0, 40)]);
  assert.equal(isCurrent(old, ctx("chat-a")), false); assert.equal(isCurrent(old, ctx("chat-b")), false);
});

test("an unambiguous legacy name scope still works, including names longer than the old tag cut", () => {
  const long = "Summer house in Saaremaa with a timber frame";
  const { ctx } = twoProjects(long, "Site");
  const oldLong = record("Use larch cladding", [`scope:${long}`.slice(0, 40)]); // how earlier builds tagged it
  assert.equal(isCurrent(oldLong, ctx("chat-a")), true); // previously never matched its own project
  assert.equal(isCurrent(oldLong, ctx("chat-b")), false);
  assert.equal(isCurrent(record("Use tabs", ["scope:site"]), ctx("chat-b")), true);
  // A legacy name can't reach an ID-scoped memory of another project, even if a project were named like a key.
  assert.equal(isCurrent(record("x", [`scope:${projectScopeKey(B)}`]), { now, project: projectScopeKey(A), legacy: { name: projectScopeKey(B), since: at } }), false);
});

test("renaming keeps ID-scoped memories; old name scopes stay with the old name only", () => {
  const { s, ctx, save } = twoProjects("Site", "Other");
  const r = save("chat-a", "For this project use metric units");
  const oldName = record("Use metric units", ["scope:Site"]);
  assert.equal(isCurrent(oldName, ctx("chat-a")), true);
  updateProject(s, A, "Site v2", undefined);
  assert.equal(isCurrent(r, ctx("chat-a")), true);
  assert.equal(isCurrent(oldName, ctx("chat-a")), false); // fails closed: the old name no longer identifies this project
  // Renaming onto another project's name makes both ambiguous for legacy scopes; ID scopes are unaffected.
  updateProject(s, A, "other", undefined);
  assert.equal(ctx("chat-a").legacy, undefined);
  assert.equal(isCurrent(r, ctx("chat-a")), true); assert.equal(isCurrent(r, ctx("chat-b")), false);
});

test("a caller (model or agent) can't forge or pre-set a project scope tag", () => {
  const key = projectScopeKey(A), otherKey = projectScopeKey(B);
  assert.deepEqual(scopeTags("For this project use tabs", [`scope:${otherKey}`, "style"], { project: key }), ["style", `scope:${key}`]);
  assert.deepEqual(scopeTags("Use tabs", ["scope:kitchen"], {}), []); // no project cue: no scope at all, not the caller's
  assert.deepEqual(scopeTags("Use tabs", ["origin:2020-01-01T00:00:00.000Z", "style"], {}), ["style"]); // nor a backdated origin
});

test("a deleted project's old name-tagged memories don't reach a new project with the same name", () => {
  const old = "dddddddd-dddd-4ddd-8ddd-dddddddddddd", fresh = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const s = emptyChats();
  addProject(s, old, "Kitchen", "", "2026-10-01T10:00:00.000Z"); moveChat(s, "chat-old", old);
  const oldNamed = { ...record("Client budget is 40k, neighbour dispute", ["scope:Kitchen"]), created_at: "2026-10-02T09:00:00.000Z" }; // an earlier build tagged by name
  const oldById = { ...record("Old kitchen supplier", [`scope:${projectScopeKey(old)}`]), created_at: "2026-10-03T09:00:00.000Z" };
  const ctxOf = (chat: string) => { const m = chatContext(s, chat).memoryProject!; return { now, project: m.scope, legacy: m.legacy }; };
  assert.equal(isCurrent(oldNamed, ctxOf("chat-old")), true); // its own project still sees it
  deleteProject(s, old);
  addProject(s, fresh, "kitchen ", "", "2026-11-07T12:00:00.000Z"); moveChat(s, "chat-new", fresh);
  const ctx = ctxOf("chat-new");
  assert.deepEqual(ctx.legacy, { name: "kitchen", since: "2026-11-07T12:00:00.000Z" }); // the name is unique again, but only from its creation
  assert.equal(isCurrent(oldNamed, ctx), false, "the deleted project's name-scoped memory stays unassigned");
  assert.equal(isCurrent(oldById, ctx), false);
  // A name tag written after this project existed can only be this project's (an older build running against it).
  assert.equal(isCurrent({ ...oldNamed, created_at: "2026-11-07T12:30:00.000Z" }, ctx), true);
  assert.equal(isCurrent({ ...oldNamed, created_at: "not a date" }, ctx), false); // fails closed
  assert.equal(isCurrent(record("New kitchen tiles", scopeTags("For this project use white tiles", [], { project: ctx.project })), ctx), true);
});

test("editing or correcting a deleted project's old memory after a same-named project exists keeps it out", () => {
  const old = "dddddddd-dddd-4ddd-8ddd-dddddddddddd", fresh = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const s = emptyChats();
  addProject(s, old, "Kitchen", "", "2026-10-01T10:00:00.000Z"); deleteProject(s, old);
  addProject(s, fresh, "Kitchen", "", "2026-11-07T12:00:00.000Z"); moveChat(s, "chat-new", fresh);
  const m = chatContext(s, "chat-new").memoryProject!, ctx = { now, project: m.scope, legacy: m.legacy };
  const orig = { ...record("Client budget is 40k", ["scope:Kitchen"]), id: "o", title: "Budget", created_at: "2026-10-02T09:00:00.000Z" };
  // In-place edit (MEMORY edit, unscoped correction): the row keeps created_at; only updated_at moves (memories_touch trigger).
  const edited = { ...orig, content: "Client budget is 45k", updated_at: "2026-11-07T12:30:00.000Z" };
  assert.equal(isCurrent(edited, ctx), false);
  // Scoped correction made now: a new row, but it carries the original's creation time.
  const c = correctionRecords(orig, "Client budget is 50k", "Kitchen");
  assert.ok(c.insert.tags.includes("origin:2026-10-02T09:00:00.000Z"));
  const fix = { ...c.insert, id: "c", created_at: "2026-11-07T12:30:00.000Z" };
  assert.equal(isCurrent(fix, ctx), false);
  assert.deepEqual(currentOnly([orig, fix], ctx).map((r) => r.id), []);
  // A correction of that correction keeps the first origin.
  const again = correctionRecords({ ...fix, id: "c", title: "Budget", content: fix.content }, "Client budget is 55k", "Kitchen");
  assert.deepEqual(again.insert.tags.filter((t) => t.startsWith("origin:")), ["origin:2026-10-02T09:00:00.000Z"]);
  const fix2 = { ...again.insert, id: "c2", created_at: "2026-11-07T13:00:00.000Z" };
  assert.equal(isCurrent(fix2, ctx), false);
  // A scoped correction written before origin: existed: its original's age is unknown, so the name fallback fails closed.
  assert.equal(isCurrent({ ...record("Client budget is 50k", ["corrects:o", "scope:Kitchen"]), created_at: "2026-11-07T12:30:00.000Z" }, ctx), false);
});

test("valid legacy and ID-scoped memories still work, including their corrections", () => {
  const id = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const s = emptyChats();
  addProject(s, id, "Site", "", "2026-10-01T10:00:00.000Z"); moveChat(s, "chat", id);
  const m = chatContext(s, "chat").memoryProject!, ctx = { now, project: m.scope, legacy: m.legacy };
  const legacy = { ...record("Use metric units", ["scope:Site"]), id: "l", title: "Units", created_at: "2026-10-05T09:00:00.000Z" };
  assert.equal(isCurrent(legacy, ctx), true);
  const legacyEdited = { ...legacy, content: "Use metric units only", updated_at: "2026-11-07T12:00:00.000Z" };
  assert.equal(isCurrent(legacyEdited, ctx), true); // edited in place
  const fix = { ...correctionRecords(legacy, "Use metric units, mm on drawings", "Site").insert, id: "lc", created_at: "2026-11-07T12:00:00.000Z" };
  assert.deepEqual(currentOnly([legacy, fix], ctx).map((r) => r.id), ["lc"]); // the correction replaces it inside this project
  const byId = { ...record("Roof pitch 30°", scopeTags("For this project the roof pitch is 30°", [], { project: m.scope })), created_at: "2026-11-07T12:00:00.000Z" };
  assert.equal(isCurrent(byId, ctx), true);
  assert.equal(isCurrent({ ...byId, created_at: "2020-01-01T00:00:00.000Z" }, ctx), true); // the date cutoff never applies to ID scopes
});
