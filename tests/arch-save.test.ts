import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptSave, pickNewer, saveStep, staleCheck, type SaveState } from "../src/lib/arch-save-pure.ts";
import { applyOps, starterScene, type Op } from "../src/lib/arch-pure.ts";

test("save state: saved only for the newest rev, failure is never shown as saved", () => {
  let s: SaveState = { status: "idle", rev: 0 };
  s = saveStep(s, { type: "start", rev: 1 });
  s = saveStep(s, { type: "start", rev: 2 });
  s = saveStep(s, { type: "ok", rev: 1 });
  assert.equal(s.status, "saving");
  s = saveStep(s, { type: "fail", rev: 2, error: "500" });
  assert.deepEqual(s, { status: "failed", rev: 2, error: "500" });
  s = saveStep(s, { type: "ok", rev: 1 }); // a late old ok can't hide the failure
  assert.equal(s.status, "failed");
  s = saveStep(s, { type: "start", rev: 2 }); // retry
  s = saveStep(s, { type: "ok", rev: 2 });
  assert.equal(s.status, "saved");
  assert.equal(saveStep(s, { type: "local", rev: 3 }).status, "local");
});

test("pickNewer: higher rev wins, local on tie, junk ignored", () => {
  const a = { rev: 3, scene: starterScene() }, b = { rev: 5, scene: starterScene() };
  assert.equal(pickNewer(a, b), b);
  assert.equal(pickNewer(b, { ...a, rev: 5 }), b);
  assert.equal(pickNewer(null, a), a);
  assert.equal(pickNewer(a, { rev: 9 } as never), a);
});

test("acceptSave refuses older revisions and junk", () => {
  assert.ok(acceptSave(null, 0));
  assert.ok(acceptSave({ rev: 4 }, 4));
  assert.ok(!acceptSave({ rev: 4 }, 3));
  assert.ok(!acceptSave({}, "5"));
  assert.ok(!acceptSave({}, 1.5));
});

test("stale AI reply after an intervening manual edit", () => {
  const base = starterScene();
  // he edits the roof by hand while the AI is thinking
  const cur = applyOps(base, [{ op: "set", id: "p4", h: 3 }], () => "x").scene;
  const onRoof: Op[] = [{ op: "scale", id: "p4", h: 1 }];
  const onWall: Op[] = [{ op: "set", id: "p3", name: "Main walls" }, { op: "add", kind: "slab", w: 4, d: 4, h: 0.2 }];
  assert.equal(staleCheck(base, 1, cur, 2, onRoof), "conflict");
  assert.equal(staleCheck(base, 1, cur, 2, onWall), "apply");
  assert.equal(staleCheck(base, 1, cur, 2, [{ op: "add", kind: "window", host: "p4", face: "n", w: 1 }]), "conflict");
  const gone = applyOps(base, [{ op: "remove", id: "p3" }], () => "x").scene;
  assert.equal(staleCheck(base, 1, gone, 2, [{ op: "remove", id: "p3" }]), "conflict");
  const plot = applyOps(base, [{ op: "plot", trees: 2 }], () => "x").scene;
  assert.equal(staleCheck(base, 1, plot, 2, [{ op: "plot", w: 40 }]), "conflict");
  assert.equal(staleCheck(base, 1, base, 1, onRoof), "apply");
});
