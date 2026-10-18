import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { autopilotItems, cleanLink, clipItems, goalItems, keepLast, mergeActivity, parseActivity, taskItems } from "../src/lib/activity-pure.ts";

test("parseActivity skips malformed lines and unknown areas", () => {
  const text = [
    JSON.stringify({ at: "2026-10-18T10:00:00Z", area: "system", title: "Stop-all on" }),
    "not json",
    JSON.stringify({ at: "2026-10-18T10:01:00Z", area: "nope", title: "x" }),
    JSON.stringify({ at: "garbage", area: "core", title: "x" }),
    JSON.stringify({ at: "2026-10-18T10:02:00Z", area: "core", title: "CORE save_memory: Saved", link: { task: "t1" } }),
    "",
  ].join("\n");
  const items = parseActivity(text);
  assert.equal(items.length, 2);
  assert.deepEqual(items[1], { at: "2026-10-18T10:02:00Z", area: "core", title: "CORE save_memory: Saved", link: { task: "t1" } });
});

test("keepLast keeps the newest lines, newline-terminated", () => {
  const text = Array.from({ length: 10 }, (_, i) => `l${i}`).join("\n") + "\n\n";
  assert.equal(keepLast(text, 3), "l7\nl8\nl9\n");
  assert.equal(keepLast("", 3), "");
  assert.equal(keepLast("a\nb\n", 5), "a\nb\n");
});

test("mergeActivity sorts newest first, filters by area and caps", () => {
  const a = [{ at: "2026-10-18T09:00:00Z", area: "core" as const, title: "a" }];
  const b = [{ at: "2026-10-18T11:00:00Z", area: "system" as const, title: "b" }, { at: "2026-10-18T10:00:00Z", area: "core" as const, title: "c" }];
  assert.deepEqual(mergeActivity([a, b]).map((x) => x.title), ["b", "c", "a"]);
  assert.deepEqual(mergeActivity([a, b], "core").map((x) => x.title), ["c", "a"]);
  assert.equal(mergeActivity([a, b], undefined, 1).length, 1);
});

test("taskItems: area from automation / team / goal step, tools and approvals in the detail", () => {
  const base = { parent_id: null, agent: "atlas", status: "done", error: null, created_at: "2026-10-18T09:00:00Z", started_at: "2026-10-18T09:01:00Z", finished_at: "2026-10-18T09:05:00Z" };
  const [auto, team, goal, plain] = taskItems([
    { ...base, id: "1", title: "⚙ Daily", automation_id: "a1" },
    { ...base, id: "2", title: "Team step 1/2 · atlas: research" },
    { ...base, id: "3", title: "Goal step 1/3 · Grow: x" },
    { ...base, id: "4", title: "Research X", status: "awaiting_approval", finished_at: null, trace: [{ step: "think", ok: true }, { step: "fetch_url", ok: true }, { step: "fetch_url", ok: true }], pending: [{ tool: "save_memory", status: "pending" }] },
  ]);
  assert.equal(auto.area, "automations");
  assert.equal(team.area, "chains");
  assert.equal(goal.area, "goals");
  assert.equal(plain.area, "agents");
  assert.equal(plain.at, "2026-10-18T09:01:00Z");
  assert.equal(plain.title, "Needs approval: Research X");
  assert.equal(plain.detail, "atlas · tools: fetch_url · approvals: save_memory pending");
  assert.deepEqual(plain.link, { task: "4" });
});

test("goal logs, clip uploads and autopilot clips become items", () => {
  assert.equal(goalItems([{ doc: { title: "Grow", log: [{ at: "2026-10-18T09:00:00Z", text: "Step 1 done" }] } }])[0].title, "Grow: Step 1 done");
  const c = clipItems([{ source: "vod.mp4", clips: [{ title: "Clip" }, { title: "Clip2", publish: { status: "scheduled", at: "2026-10-18T09:00:00Z", scheduledFor: "2026-10-19T17:00:00Z" } }] }]);
  assert.equal(c.length, 1);
  assert.equal(c[0].title, "Scheduled: Clip2");
  assert.match(c[0].detail ?? "", /goes live 2026-10-19T17:00:00Z/);
  assert.equal(autopilotItems([{ title: "Stream", channel: "Ch", at: "2026-10-18T09:00:00Z", auto: true }])[0].detail, "Ch · auto-picked");
});

test("logActivity appends JSONL that readActivity reads back", async () => {
  process.env.ORBIT_DATA_DIR = await mkdtemp(path.join(tmpdir(), "orbit-act-"));
  const { logActivity, readActivity } = await import("../src/lib/activity.ts");
  logActivity({ area: "system", title: "one" });
  logActivity({ area: "core", title: "two" });
  const items = await readActivity();
  assert.deepEqual(items.map((x) => x.title), ["one", "two"]);
  delete process.env.ORBIT_DATA_DIR;
});

test("cleanLink keeps only task ids and known panels", () => {
  assert.deepEqual(cleanLink({ task: "8c6f-12ab" }), { task: "8c6f-12ab" });
  assert.deepEqual(cleanLink({ panel: "studio" }), { panel: "studio" });
  assert.equal(cleanLink({ panel: "javascript:alert(1)" }), undefined);
  assert.equal(cleanLink({ task: "../../etc" }), undefined);
  assert.equal(cleanLink("studio"), undefined);
  assert.equal(parseActivity(JSON.stringify({ at: "2026-10-18T10:00:00Z", area: "core", title: "x", link: { panel: "nowhere" } }))[0].link, undefined);
});
