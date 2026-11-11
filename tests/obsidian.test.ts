import { test } from "node:test";
import assert from "node:assert/strict";
import { noteNames, safeName, vault, type Mem } from "../src/lib/obsidian-pure.ts";

const m = (id: string, title: string, kind = "note", extra: Partial<Mem> = {}): Mem => ({ id, kind, title, content: `About ${title}`, created_at: `2026-11-0${id.length}T10:00:00Z`, ...extra });

test("file names are safe everywhere and unique by name (a clash gets its date)", () => {
  assert.equal(safeName('What: is/this? [x] #tag'), "What is this x tag");
  assert.equal(safeName("..."), "Untitled");
  const n = noteNames([m("a", "Plan"), m("bb", "Plan"), m("ccc", "plan")]);
  assert.deepEqual([...n.values()], ["Plan", "Plan (2026-11-02)", "plan (2026-11-03)"]);
});

test("vault: notes per kind with properties, confirmed links as wikilinks, suggested as maybe-related, journal left out by default", () => {
  const memories = [m("a", "Kivi House", "project", { tags: ["arch", "house plan"], url: "https://example.com/x" }), m("bb", "South glazing", "idea"), m("ccc", "Rejected idea", "idea"), m("dddd", "Tuesday", "journal")];
  const links = [{ from_id: "a", to_id: "bb", status: "confirmed" }, { from_id: "ccc", to_id: "a", status: "suggested" }, { from_id: "a", to_id: "dddd", status: "confirmed" }];
  const f = vault({ memories, links, projects: [{ id: "p1", name: "ORBIT", description: "Personal AI OS", status: "active", created_at: "2026-10-01T00:00:00Z" }], exportedAt: "2026-11-09T21:00:00Z" });
  const kivi = f["Projects/Kivi House.md"];
  assert.match(kivi, /^---\norbit_id: a\nkind: project\ntags:\n {2}- "arch"\n {2}- "house-plan"\ncreated: 2026-11-01\nsource: "https:\/\/example.com\/x"\n---/);
  assert.match(kivi, /## Linked\n- \[\[South glazing\]\]/);
  assert.match(kivi, /## Maybe related\n- \[\[Rejected idea\]\]/);
  assert.doesNotMatch(kivi, /Tuesday/, "a link to a journal entry isn't shown when journals are left out");
  assert.ok(!Object.keys(f).some((p) => p.startsWith("Journal/")));
  assert.ok(f["Projects/ORBIT (project).md"] && f["ORBIT memories.base"].includes("if(orbit_id, true, false)"));
  assert.match(f["ORBIT.md"], /## Ideas \(2\)\n- \[\[South glazing\]\]/);
  assert.ok(Object.keys(vault({ memories, links, projects: [], includeJournal: true, exportedAt: "2026-11-09T21:00:00Z" })).includes("Journal/Tuesday.md"));
});
