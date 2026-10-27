import { test } from "node:test";
import assert from "node:assert/strict";
import { STARTER_PRICES, applyOps, starterScene, type Scene } from "../src/lib/arch-pure.ts";
import { canReply, critEstimate, critFacts, critNote, critPrompt, parseCrit, rooms, sceneVersion, withReply } from "../src/lib/arch-crit-pure.ts";

let n = 0;
const id = () => `n${++n}`;
// starter shell 10 × 8 (inside 9.4 × 7.4); a wall along x at z = −2.5 leaves a 1.2 m strip; a wall along z splits the rest
const plan = (): Scene => applyOps(starterScene(), [
  { op: "add", kind: "wall", x: 0, z: -2.5, y: 0.2, w: 9.4, d: 0.2, h: 2.8 },
  { op: "add", kind: "wall", x: 0, z: 0.6, y: 0.2, w: 0.2, d: 6.2, h: 2.8 },
  { op: "add", kind: "window", host: "p3", face: "s", w: 1.2, off: -2 },
], id).scene;

test("rooms: interior walls split the shell, corridor strips are found, windows go to the room behind them", () => {
  const rs = rooms(plan());
  assert.deepEqual(rs.map((r) => r.area), [29.1, 29.1, 11.3]);
  assert.equal(rs[2].corridor, true);
  assert.equal(rs.filter((r) => r.glazing > 0).length, 1);
  const lit = rs.find((r) => r.glazing > 0)!;
  assert.deepEqual(lit.faces, ["s"]);
  assert.equal(lit.wfr, 0.05);
});

test("rooms: a wall that doesn't reach across leaves one room; no shell, no rooms", () => {
  const s = applyOps(starterScene(), [{ op: "add", kind: "wall", x: 0, z: 3.1, y: 0.2, w: 0.2, d: 1.2, h: 2.8 }], id).scene;
  assert.equal(rooms(s).length, 1);
  assert.equal(rooms(starterScene()).length, 1);
  assert.equal(rooms({ ...starterScene(), parts: [] }).length, 0);
});

test("critFacts: numbered, circulation share, daylight flag, sun, cost per m²", () => {
  const f = critFacts(plan(), STARTER_PRICES);
  assert.equal(f[0].id, "F1");
  const all = f.map((x) => x.text).join("\n");
  assert.match(all, /1 floor, gross floor area 80 m², 3 rooms/);
  assert.match(all, /Circulation .*: 11\.3 m² = 16%/);
  assert.match(all, /under the ~10% daylight rule/);
  assert.match(all, /noon sun from the south at 7° on Dec 21 and 54° on Jun 21/);
  assert.match(all, /EUR per m² gross/);
  assert.match(critFacts({ ...starterScene(), parts: [] }, STARTER_PRICES).map((x) => x.text).join(), /No floor shell/);
});

test("sceneVersion is stable and changes with the model", () => {
  const p = plan();
  assert.equal(sceneVersion(p), sceneVersion(structuredClone(p)));
  assert.notEqual(sceneVersion(plan()), sceneVersion(starterScene()));
  assert.match(sceneVersion(plan()), /^[0-9a-f]{8}$/);
});

test("critPrompt and critEstimate", () => {
  const f = critFacts(plan(), STARTER_PRICES), p = critPrompt(f, true);
  assert.match(p, /F1\. 1 floor/);
  assert.match(p, /attached image/);
  assert.ok(critEstimate(p.length, { w: 1200, h: 800 }) > critEstimate(p.length));
});

test("parseCrit keeps the shape and drops concerns citing unknown facts", () => {
  const f = critFacts(plan(), STARTER_PRICES);
  const raw = `Here: {"strengths":["a","b","c"],"concerns":[{"fact":"f2","text":"x"},{"fact":"F99","text":"y"},{"fact":"F3","text":"z"},{"fact":"F1","text":"w"}],"try":"move it","questions":["q1","q2","q3"]}`;
  const c = parseCrit(raw, f)!;
  assert.deepEqual(c.strengths, ["a", "b"]);
  assert.deepEqual(c.concerns.map((x) => x.fact), ["F2", "F3", "F1"]);
  assert.equal(c.questions.length, 2);
  assert.equal(parseCrit('{"strengths":["a"],"concerns":[],"try":"t","questions":["q"]}', f), null);
  assert.equal(parseCrit("no json", f), null);
});

test("critNote tags the version; one reply only", () => {
  const f = critFacts(plan(), STARTER_PRICES);
  const n = critNote({ strengths: ["a"], concerns: [{ fact: "F2", text: "too dark" }], try: "t", questions: ["q"] }, f, "abcd1234", false);
  assert.deepEqual(n.tags, ["arch", "crit", "model:abcd1234"]);
  assert.match(n.content, /Learning aid/);
  assert.match(n.content, /too dark \(F2: R1/);
  assert.ok(canReply(n.content));
  const r = withReply(n.content, "why?", "because");
  assert.ok(!canReply(r));
  assert.match(r, /## Tutor\nbecause$/);
});
