import { test } from "node:test";
import assert from "node:assert/strict";
import { CONSEQUENTIAL, EFFECTS } from "../src/lib/approval-pure.ts";
import { AREAS, DEFAULT_LEVELS, autonomyDefaults, parseAutonomy, type Area, type Levels } from "../src/lib/autonomy-pure.ts";
import { KIND_AREA, MIN_STREAK, SNOOZE_DAYS, kindStats, snoozeTrust, suggestable, taskDecisions, trustSuggestions, type TrustDecision } from "../src/lib/trust-pure.ts";

const now = Date.parse("2026-10-28T12:00:00Z"), H = 3_600_000;
const run = (kind: string, n: number, opts: Partial<TrustDecision> = {}, from = now): TrustDecision[] =>
  Array.from({ length: n }, (_, i) => ({ kind, at: new Date(from - i * H).toISOString(), approved: true, ...opts }));
const asking: Levels = Object.fromEntries(AREAS.map((a) => [a, "ask"])) as Levels; // every area on Ask (even ones that can't be)

test("24 of 24 memory saves on Ask → one suggestion to Do & report", () => {
  const s = trustSuggestions(run("save_memory", 24), { ...DEFAULT_LEVELS, memory: "ask" }, {}, now);
  assert.deepEqual(s, [{ kind: "save_memory", area: "memory", from: "ask", to: "do", approved: 24, total: 24, streak: 24 }]);
});

test("consequential kinds are never suggested: perfect history, every area, any mapping", () => {
  const kinds = Object.keys(EFFECTS).filter((k) => CONSEQUENTIAL.includes(EFFECTS[k]));
  assert.ok(kinds.includes("business.send") && kinds.includes("story.approve") && kinds.includes("studio.publish") && kinds.includes("contracts.sign"));
  const history = kinds.flatMap((k) => run(k, 100));
  for (const area of AREAS) {
    const map = Object.fromEntries(kinds.map((k) => [k, area])) as Record<string, Area>;
    for (const lv of [asking, { ...DEFAULT_LEVELS }]) assert.deepEqual(trustSuggestions(history, lv, {}, now, map), [], area);
    for (const k of kinds) assert.equal(suggestable(k, area), false, `${k} → ${area}`);
  }
  for (const k of Object.keys(KIND_AREA)) assert.ok(!CONSEQUENTIAL.includes(EFFECTS[k]), `${k} in KIND_AREA must not be consequential`);
});

test("unknown kinds fail closed; areas without Do (send, publish, spend, contracts) never suggested; never auto", () => {
  for (const k of ["send_email", "toString", "constructor", "__proto__"]) {
    assert.equal(suggestable(k, "memory"), false, k);
    assert.deepEqual(trustSuggestions(run(k, 50), asking, {}, now, { [k]: "memory" } as Record<string, Area>), [], k);
  }
  for (const area of ["business-send", "studio-publish", "higgsfield-spend", "contracts"] as Area[])
    assert.deepEqual(trustSuggestions(run("save_memory", 50), asking, {}, now, { save_memory: area }), [], area);
  const all = trustSuggestions(Object.keys(EFFECTS).flatMap((k) => run(k, 50)), asking, {}, now, Object.fromEntries(Object.keys(EFFECTS).map((k, i) => [k, AREAS[i % AREAS.length]])));
  assert.ok(all.length > 0);
  for (const s of all) { assert.equal(s.to, "do"); assert.ok(!CONSEQUENTIAL.includes(EFFECTS[s.kind])); }
});

test("a rejection resets the streak; edits don't count; thresholds hold", () => {
  const lv = { ...DEFAULT_LEVELS, memory: "ask" as const };
  const reset = [...run("save_memory", MIN_STREAK - 1), { kind: "save_memory", at: new Date(now - 20 * H).toISOString(), approved: false }, ...run("save_memory", 30, {}, now - 21 * H)];
  assert.equal(kindStats(reset, now)[0].streak, MIN_STREAK - 1);
  assert.deepEqual(trustSuggestions(reset, lv, {}, now), []);
  assert.equal(trustSuggestions([...run("save_memory", MIN_STREAK), { kind: "save_memory", at: new Date(now - 20 * H).toISOString(), approved: false }, ...run("save_memory", 20, {}, now - 21 * H)], lv, {}, now).length, 1);
  assert.deepEqual(trustSuggestions(run("save_memory", MIN_STREAK - 1), lv, {}, now), []); // too few
  assert.deepEqual(trustSuggestions(run("save_memory", 20, { edited: true }), lv, {}, now), []); // all edited: streak 0
  assert.deepEqual(trustSuggestions([...run("save_memory", 12), ...run("save_memory", 4, { edited: true }, now - 13 * H)], lv, {}, now), []); // 25% edited
  assert.deepEqual(trustSuggestions(run("save_memory", 20, {}, now - 15 * 86_400_000), lv, {}, now), []); // stale
  assert.deepEqual(trustSuggestions(run("save_memory", 20, {}, now - 31 * 86_400_000), lv, {}, now), []); // outside the month
});

test("only from Ask: never from Off, Do or defaults; snooze hides it for 30 days", () => {
  const h = run("save_memory", 20);
  for (const level of ["off", "do"] as const) assert.deepEqual(trustSuggestions(h, { ...DEFAULT_LEVELS, memory: level }, {}, now), []);
  assert.deepEqual(trustSuggestions([...h, ...run("add_task", 20), ...run("memory.hygiene", 20)], DEFAULT_LEVELS, {}, now), []);
  const s = snoozeTrust(autonomyDefaults(), "memory", now);
  assert.ok(typeof s !== "string");
  assert.deepEqual(trustSuggestions(h, { ...DEFAULT_LEVELS, memory: "ask" }, s.snooze, now), []);
  assert.equal(trustSuggestions(h, { ...DEFAULT_LEVELS, memory: "ask" }, s.snooze, now + SNOOZE_DAYS * 86_400_000 + 1).length, 0); // history now stale too
  assert.equal(trustSuggestions(run("save_memory", 20, {}, now + 31 * 86_400_000), { ...DEFAULT_LEVELS, memory: "ask" }, s.snooze, now + 31 * 86_400_000).length, 1);
  assert.equal(snoozeTrust(autonomyDefaults(), "toString", now), "Unknown area");
  assert.deepEqual(parseAutonomy(JSON.stringify(s)).snooze, s.snooze);
  assert.deepEqual(parseAutonomy(JSON.stringify({ snooze: { memory: "nope", bogus: "2026-01-01" } })).snooze, {});
});

test("one suggestion per area: the kind with most approvals", () => {
  const s = trustSuggestions([...run("save_memory", 12), ...run("memory.hygiene", 15)], { ...DEFAULT_LEVELS, memory: "ask" }, {}, now);
  assert.equal(s.length, 1);
  assert.equal(s[0].kind, "memory.hygiene");
});

test("taskDecisions reads agent pending actions", () => {
  const at = new Date(now).toISOString();
  assert.deepEqual(taskDecisions([
    { finished_at: at, pending: [{ tool: "save_memory", status: "approved" }, { tool: "add_task", status: "rejected" }, { tool: "save_memory", status: "failed" }, { tool: "x", status: "pending" }] },
    { finished_at: null, pending: [{ tool: "save_memory", status: "approved" }] }, { finished_at: at, pending: null },
  ]), [{ kind: "save_memory", at, approved: true }, { kind: "add_task", at, approved: false }, { kind: "save_memory", at, approved: true }]);
});
