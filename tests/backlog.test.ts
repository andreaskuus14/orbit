import { test } from "node:test";
import assert from "node:assert/strict";
import { backlogGoal, fixContext, importDrafts, parseBacklog, sortBacklog } from "../src/lib/backlog-pure.ts";
import { SEED_WORLD, validateDevWorld, type Bug } from "../src/lib/devworld-pure.ts";
import { validateGoal } from "../src/lib/goals-pure.ts";

test("pasted list: bullets, checkboxes, tags, prefixes and detail", () => {
  const d = parseBacklog([
    "## Backlog",
    "- [ ] [bug][P1] Coins awarded twice — ClickerServer and BubbleLabServer both award",
    "  happens after rebirth",
    "* feature: Rebirth system (low)",
    "1. [x] Hatch sound placeholder #polish",
    "2) Game crashes when opening egg (#14)",
  ].join("\n"));
  assert.equal(d.length, 4);
  assert.deepEqual(d[0], { title: "Coins awarded twice", detail: "ClickerServer and BubbleLabServer both award happens after rebirth", kind: "bug", priority: "high", severity: "major", status: "open" });
  assert.equal(d[1].kind, "feature"); assert.equal(d[1].priority, "low"); assert.equal(d[1].title, "Rebirth system");
  assert.equal(d[2].kind, "polish"); assert.equal(d[2].status, "fixed"); assert.equal(d[2].severity, "polish");
  assert.equal(d[3].severity, "crash"); assert.equal(d[3].ref, "#14"); assert.equal(d[3].title, "Game crashes when opening egg");
});

test("gh issue list output (tabs) and the TTY form", () => {
  const d = parseBacklog("12\tOPEN\tPet icons render black\tbug, priority: high\t2026-10-20T10:00:00Z\n13\tCLOSED\tAdd trading\tenhancement\t2026-10-01T10:00:00Z\n#14  Leaderboard UI spacing  ui  about 2 days ago");
  assert.deepEqual(d.map((x) => [x.ref, x.title, x.kind, x.priority, x.status]), [
    ["#12", "Pet icons render black", "bug", "high", "open"],
    ["#13", "Add trading", "feature", "medium", "fixed"],
    ["#14", "Leaderboard UI spacing", "polish", "medium", "open"],
  ]);
});

test("GitHub web copy: the '#N opened' line attaches to the title before it", () => {
  const d = parseBacklog("Egg hatch animation stutters\n#21 opened 3 days ago by andreas\nDataStore loses pets on rejoin\n#22 was closed yesterday");
  assert.deepEqual(d.map((x) => [x.title, x.ref, x.status]), [["Egg hatch animation stutters", "#21", "open"], ["DataStore loses pets on rejoin", "#22", "fixed"]]);
});

test("import skips duplicates by title or ref and the result validates", () => {
  let k = 0;
  const r = importDrafts(SEED_WORLD, "pet-sim", parseBacklog("- Rebirth isn't implemented\n- NEW thing [feature]\n- new thing\n#22 opened by x"), "2026-10-25T00:00:00.000Z", () => `imp-${++k}`);
  assert.equal(r.added, 1);
  assert.equal(r.skipped, 2);
  const v = validateDevWorld(r.world);
  assert.ok(v.ok);
  if (v.ok) assert.equal(v.world.bugs.at(-1)!.kind, "feature");
});

test("validateDevWorld checks the new fields", () => {
  const w = structuredClone(SEED_WORLD);
  (w.bugs[0] as Bug).priority = "high"; (w.bugs[0] as Bug).goalId = "6f1c2d3e-aaaa-4bbb-8ccc-123456789abc"; (w.bugs[0] as Bug).ref = "#3";
  assert.ok(validateDevWorld(w).ok);
  (w.bugs[1] as { kind: string }).kind = "wish";
  assert.equal(validateDevWorld(w).ok, false);
  const x = structuredClone(SEED_WORLD); (x.bugs[0] as { goalId: string }).goalId = "../x";
  assert.equal(validateDevWorld(x).ok, false);
});

test("sortBacklog: active first, then priority, severity, age", () => {
  const b = (id: string, over: Partial<Bug>): Bug => ({ id, game: "g", title: id, detail: "", severity: "major", status: "open", created: "2026-10-01T00:00:00.000Z", ...over });
  const out = sortBacklog([b("done", { status: "fixed", priority: "high" }), b("low", { priority: "low" }), b("mid", {}), b("crash", { severity: "crash" }), b("hi", { priority: "high" })]);
  assert.deepEqual(out.map((x) => x.id), ["hi", "crash", "mid", "low", "done"]);
});

test("backlogGoal is a valid goals API body that forbids editing the place", () => {
  const body = backlogGoal({ name: "Pet Simulator" }, { title: "Coins awarded twice", detail: "both servers award", kind: "bug", priority: "high", ref: "#12" });
  const v = validateGoal(body, ["nova", "atlas", "forge"]);
  assert.equal(typeof v, "object");
  assert.match(body.title, /^Pet Simulator: Fix Coins awarded twice$/);
  assert.match(body.why, /Never change the Roblox place directly/);
  assert.match(body.why, /GitHub #12/);
  assert.equal(fixContext({ title: "A", detail: "B" }), "A\nB");
});
