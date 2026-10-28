import { test } from "node:test";
import assert from "node:assert/strict";
import { setVersion, suggestSessions, trailSteps, type Trail } from "../src/lib/dev-trail-pure.ts";
import type { Bug } from "../src/lib/devworld-pure.ts";
import type { DevEvent, DevSession } from "../src/lib/dev-session-pure.ts";

const bug: Bug = { id: "b1", game: "g", title: "Egg hatches twice", detail: "", severity: "major", status: "open", created: "2026-10-01T10:00:00Z", ref: "#12" };
const ev = (at: string, source: DevEvent["source"], label: string, ok = true): DevEvent => ({ at, source, label, ok, changes: [], errors: ok ? [] : ["still twice"], warnings: [], shots: [] });
const S: DevSession[] = [
  { id: "s1", userId: "u", n: 1, start: "2026-10-02T09:00:00Z", last: "2026-10-02T10:00:00Z", events: [ev("2026-10-02T09:10:00Z", "luau", "HatchService egg fix")] },
  { id: "s2", userId: "u", n: 2, start: "2026-10-03T09:00:00Z", last: "2026-10-03T10:00:00Z", events: [ev("2026-10-03T09:30:00Z", "playtest", "Hatch one egg", false), ev("2026-10-03T09:50:00Z", "playtest", "Hatch one egg")] },
  { id: "s3", userId: "u", n: 3, start: "2026-09-01T09:00:00Z", last: "2026-09-01T10:00:00Z", events: [ev("2026-09-01T09:10:00Z", "luau", "Hatch")] },
];

test("suggestSessions matches words from the title, only after the item existed", () => {
  assert.deepEqual(suggestSessions(bug, S), ["s1", "s2"]); // s3 predates the item
});

test("trail goes observation → fix → evidence → version, and never calls a suggestion applied", () => {
  let t: Trail = { bugId: "b1", sessionIds: ["s1", "s2"] };
  assert.match(trailSteps(bug, t, S).next!, /propose a fix/);
  t = { ...t, fix: { text: "debounce the hatch remote", state: "proposed", at: "2026-10-02T12:00:00Z" } };
  const r = trailSteps(bug, t, S);
  assert.deepEqual(r.steps.map((s) => s.kind), ["observed", "session", "fix", "session", "evidence", "evidence"]);
  assert.match(r.steps[2].text, /not applied/);
  assert.match(r.next!, /review/);
  assert.equal(setVersion(t, "v1.4", "x"), null); // not reviewed yet
  t = { ...t, fix: { ...t.fix!, state: "reviewed" } };
  assert.match(trailSteps(bug, t, S).next!, /record the version/);
  t = setVersion(t, " v1.4 ", "2026-10-04T00:00:00Z")!;
  const done = trailSteps(bug, t, S, "et");
  assert.equal(done.next, null);
  assert.match(done.steps.at(-1)!.text, /v1\.4/);
  assert.match(done.steps.find((s) => s.kind === "fix")!.text, /ORBIT ei rakendanud/);
  for (const s of trailSteps(bug, t, S).steps) assert.ok(!/\bapplied\b/.test(s.text.replace(/not applied/g, "")));
});
