import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOK_TONES, SLOT_W, STUDIO_CAM, WORLD_PICK, bookSet, containerLayout, glyphOf, hashStr, inFrame, pickTarget, rng, screenGradient, vaultVariant } from "../src/lib/world-props-pure.ts";

test("rng and hash are deterministic", () => {
  const a = rng(5), b = rng(5); assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.equal(hashStr("file-0.pdf"), hashStr("file-0.pdf")); assert.notEqual(hashStr("a"), hashStr("b"));
});

test("documents are books and boxes, media are crystals and boxes", () => {
  for (const k of ["pdf", "doc", "text"]) for (let i = 0; i < 30; i++) assert.notEqual(vaultVariant(k, i), "crystal");
  for (const k of ["image", "video", "audio", "other"]) for (let i = 0; i < 30; i++) assert.notEqual(vaultVariant(k, i), "books");
  assert.equal(glyphOf("image"), "image"); assert.equal(glyphOf("pdf"), "file"); assert.equal(glyphOf("zip"), "file");
});

test("a book row always fits one shelf slot and is the same every time", () => {
  for (let seed = 1; seed < 200; seed++) {
    const bs = bookSet(seed); assert.ok(bs.length >= 3 && bs.length <= 4);
    const lo = Math.min(...bs.map((b) => b.dx - b.w / 2)), hi = Math.max(...bs.map((b) => b.dx + b.w / 2));
    assert.ok(hi - lo <= SLOT_W, `seed ${seed} is ${hi - lo} wide`);
    for (const b of bs) { assert.ok(b.tone >= 0 && b.tone < BOOK_TONES.length); assert.ok(b.h >= 0.5 && b.h <= 0.86); }
    assert.deepEqual(bs, bookSet(seed));
  }
});

test("containers: two rows, within the hull length", () => {
  const c = containerLayout(); assert.equal(c.length, 6);
  assert.equal(c.filter((x) => x.row === 0).length, 3); assert.ok(c.every((x) => Math.abs(x.x) < 0.8));
});

test("placeholder screen gradients are stable and never black", () => {
  const g = screenGradient("v1"); assert.deepEqual(g, screenGradient("v1"));
  assert.match(g.a, /^hsl\(/); assert.ok(!/ 0%\)/.test(g.a)); assert.ok(g.angle >= 0 && g.angle <= 90);
});

test("the Studio default camera has the truss and its lights in frame", () => {
  assert.ok(inFrame(STUDIO_CAM, [0, 5.4, -3]), "truss");
  assert.ok(inFrame(STUDIO_CAM, [-4.5, 5, -2.6]) && inFrame(STUDIO_CAM, [4.5, 5, -2.6]), "lamps");
  assert.ok(inFrame(STUDIO_CAM, [0, 0, 0]), "planet"); assert.ok(inFrame(STUDIO_CAM, [0, 0.8, -5.3]), "screen wall");
  assert.ok(!inFrame({ pos: [0, 4.2, 11], target: [0, 0, 0], fov: 45 }, [0, 5.4, -3]), "the old camera cut the truss off");
});

test("world-pick maps chip ids to the item each panel opens", () => {
  assert.equal(WORLD_PICK, "orbit:world-pick");
  assert.deepEqual(pickTarget({ world: "operations", id: "p:t7" }, "operations"), { kind: "job", id: "t7" });
  assert.deepEqual(pickTarget({ world: "business", id: "s:abc:1" }, "business"), { kind: "client", id: "abc:1" });
  assert.deepEqual(pickTarget({ world: "business", id: "d:x" }, "business"), { kind: "client", id: "x" });
  assert.deepEqual(pickTarget({ world: "analytics", id: "k:Pet simulator" }, "analytics"), { kind: "project", id: "Pet simulator" });
  assert.deepEqual(pickTarget({ world: "studio", id: "v:vid9" }, "studio"), { kind: "video", id: "vid9" });
});

test("world-pick ignores other worlds, lanes, tiers and junk", () => {
  assert.equal(pickTarget({ world: "vault", id: "f:x" }, "operations"), null);
  assert.equal(pickTarget({ world: "operations", id: "l:running" }, "operations"), null);
  assert.equal(pickTarget({ world: "business", id: "t:lead" }, "business"), null);
  assert.equal(pickTarget({ world: "operations", id: "p:" }, "operations"), null);
  assert.equal(pickTarget({ world: "operations", id: "nope" }, "operations"), null);
  assert.equal(pickTarget(null, "operations"), null); assert.equal(pickTarget({ world: "operations", id: 4 }, "operations"), null);
});
