import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFilters, inspect, NO_FILTERS, projects, whyMatched, type Mem } from "../src/lib/memory-workspace-pure.ts";

const m = (o: Partial<Mem>): Mem => ({ id: "1", title: "T", content: "", tags: [], created_at: "2026-05-10T10:00:00Z", source: "capture", kind: "note", ...o });

test("whyMatched points at the matching passage, else the meaning match", () => {
  const long = "x ".repeat(80) + "the budget for ORBIT is tight";
  assert.deepEqual(whyMatched(m({ content: long }), "budget").by, "content");
  assert.match(whyMatched(m({ content: long }), "budget").passage, /budget for ORBIT/);
  assert.equal(whyMatched(m({ title: "Budget plan", content: "nothing" }), "budget").by, "title");
  assert.deepEqual(whyMatched(m({ tags: ["finance"], content: "a" }), "finance"), { by: "tag", passage: "#finance" });
  assert.equal(whyMatched(m({ content: "money matters" }), "budget").by, "meaning");
});

test("filters: project, type, scope and inclusive dates", () => {
  const a = m({ id: "a", tags: ["scope:orbit"] }), b = m({ id: "b", source: "inferred", created_at: "2026-06-01T23:00:00Z" }), c = m({ id: "c", tags: ["chat:abc"] });
  const ids = (f: Partial<typeof NO_FILTERS>) => applyFilters([a, b, c], { ...NO_FILTERS, ...f }).map((x) => x.id);
  assert.deepEqual(ids({}), ["a", "b", "c"]);
  assert.deepEqual(ids({ project: "orbit" }), ["a"]);
  assert.deepEqual(ids({ type: "inferred" }), ["b"]);
  assert.deepEqual(ids({ scope: "chat" }), ["c"]);
  assert.deepEqual(ids({ from: "2026-06-01", to: "2026-06-01" }), ["b"]);
});

test("projects groups by scope tag or folder, biggest first", () => {
  const g = projects([m({ id: "a", folder: "school" }), m({ id: "b", tags: ["scope:orbit"] }), m({ id: "c", tags: ["scope:orbit"] }), m({ id: "d" })]);
  assert.deepEqual(g.map((p) => [p.name, p.items.length]), [["orbit", 2], ["school", 1]]);
});

test("inspect: stated vs inferred, scope and missing sources", () => {
  assert.equal(inspect(m({})).stated, "stated");
  assert.equal(inspect(m({ source: "inferred" })).stated, "inferred");
  assert.deepEqual(inspect(m({ tags: ["scope:orbit"] })).scope.where, "orbit");
  assert.equal(inspect(m({ source: "upload", kind: "document" })).link.missing, true);
  assert.equal(inspect(m({ source: "upload", storage_path: "x/y.pdf" })).link.missing, false);
  assert.equal(inspect(m({})).link.missing, false);
});
