import { test } from "node:test";
import assert from "node:assert/strict";
import { buildKnows, groupKnows, itemLine, knowRequest, EDIT_MAX } from "../src/lib/knows-pure.ts";

const J = "99999999-9999-4999-8999-999999999999";
const input = {
  profile: { display_name: "Andreas", interests: ["game dev", "architecture"], projects: ["pet sim"], goals: [], communication: "short answers" },
  rules: ["Answer briefly"],
  facts: [{ id: "f1", subject: "school", statement: "starts architecture studies", status: "current", source: "user_said", updated_at: "2026-11-01T00:00:00Z" },
    { id: "f2", subject: "old", statement: "gone", status: "superseded", source: "user_said" }],
  memories: [{ id: "m1", kind: "preference", title: "Dark UI", content: "prefers calm dark screens", source: "core" },
    { id: "m2", kind: "note", title: "random note", content: "x" },
    { id: "m3", kind: "preference", title: "Dream diary", content: "SECRET life text", tags: ["life:mood"] }],
  journal: [{ id: J, created_at: "2026-11-20T21:00:00Z" }],
  people: [{ id: "p1", name: "Mari", relation: "friend", notes: "likes chess", local: true }, { id: "p:9", name: "Lead Co", notes: "", local: false }],
  lessons: [{ id: "l1", text: "Don't open the galaxy for chat questions", area: "correction", status: "kept" }],
  mistakes: [{ id: "k1", mistake: "used the wrong voice", fix: "use Kokoro", status: "active" }, { id: "k2", mistake: "old", fix: "old", status: "archived" }],
  skills: [{ id: "s1", name: "weekly-niche-check", instruction: "check the niche every week" }],
};

test("groups the stores plainly, current beliefs only, about-you memory kinds only", () => {
  const g = groupKnows(buildKnows(input));
  assert.deepEqual(g.map((x) => x.group), ["you", "prefs", "people", "projects", "lessons", "skills", "journal"]);
  const keys = g.flatMap((x) => x.items.map((i) => i.key));
  assert.ok(keys.includes("fact:f1") && !keys.includes("fact:f2"));
  assert.ok(keys.includes("memory:m1") && !keys.includes("memory:m2"));
  assert.ok(!keys.includes("mistake:k2"));
  const m1 = g.flatMap((x) => x.items).find((i) => i.key === "memory:m1")!;
  assert.equal(m1.src, "memoryCore");
});

test("redaction: journal and LIFE-tagged rows show only 'Journal entry · date', never title or text, and can't be edited", () => {
  const items = buildKnows(input);
  const priv = items.filter((i) => i.group === "journal");
  assert.equal(priv.length, 2);
  for (const i of priv) { assert.equal(i.text, ""); assert.equal(i.label, undefined); assert.equal(i.edit, false); assert.equal(i.del, false); }
  assert.ok(!JSON.stringify(items).includes("SECRET") && !JSON.stringify(items).includes("Dream diary"));
  assert.equal(itemLine(priv.find((i) => i.id === J)!, "Journal entry"), "Journal entry · 2026-11-20");
  assert.equal(typeof knowRequest(priv[0], "x"), "string");
});

test("edits and deletes map to each store's existing route", () => {
  const items = buildKnows(input), by = (k: string) => items.find((i) => i.key === k)!;
  const ctx = { profile: input.profile, playbook: { rules: input.rules, version: 3 }, skills: [{ id: "s1", name: "weekly-niche-check", tools: ["run_niche"], example: "" }] };
  assert.deepEqual(knowRequest(by("profile:interests:1"), "architecture school", ctx), { url: "/api/profile", method: "PUT", body: { interests: ["game dev", "architecture school"] } });
  assert.deepEqual(knowRequest(by("profile:interests:0"), null, ctx), { url: "/api/profile", method: "PUT", body: { interests: ["architecture"] } });
  assert.deepEqual(knowRequest(by("playbook:0"), "Answer very briefly", ctx), { url: "/api/playbook", method: "POST", body: { action: "set", rules: ["Answer very briefly"], version: 3 } });
  assert.deepEqual(knowRequest(by("fact:f1"), null), { url: "/api/facts", method: "POST", body: { action: "forget", id: "f1" } });
  assert.deepEqual(knowRequest(by("memory:m1"), "calm dark"), { url: "/api/memories/m1", method: "PATCH", body: { content: "calm dark" } });
  assert.deepEqual(knowRequest(by("person:p1"), "loves chess"), { url: "/api/people", method: "POST", body: { action: "update", id: "p1", notes: "loves chess" } });
  assert.deepEqual(knowRequest(by("lesson:l1"), null), { url: "/api/lessons", method: "POST", body: { id: "l1", decision: "reject" } });
  assert.deepEqual(knowRequest(by("mistake:k1"), "use Kokoro voice"), { url: "/api/mistakes", method: "PATCH", body: { id: "k1", fix: "use Kokoro voice" } });
  assert.equal((knowRequest(by("skill:s1"), "check the niche every Monday", ctx) as unknown as { body: { tools: string[] } }).body.tools[0], "run_niche");
  assert.equal(typeof knowRequest(by("person:p:9"), "x"), "string", "prospect-backed people are edited in BUSINESS");
  assert.equal(typeof knowRequest(by("profile:interests:1"), "x", { profile: { interests: ["changed"] } }), "string", "stale profile refuses");
  assert.equal(typeof knowRequest(by("memory:m1"), "  "), "string");
});

test("a very long memory is shown short and not editable here (an edit would cut it)", () => {
  const [i] = buildKnows({ memories: [{ id: "m", kind: "project", title: "big", content: "x".repeat(EDIT_MAX + 1) }] });
  assert.equal(i.edit, false); assert.ok(i.text.length <= 600);
});

test("the page's server side never calls a model or an embedder", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["src/lib/knows.ts", "src/lib/knows-pure.ts", "src/app/api/knows/route.ts", "src/components/KnowsPanel.tsx"]) {
    const code = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(code, /\b(askClaude|askClaudeStream|chatLocal|reviewDraft|rerankScores|embed)\s*\(|from "\.\/claude"|@\/lib\/claude"/, f);
  }
});
