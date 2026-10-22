import { test } from "node:test";
import assert from "node:assert/strict";
import { centroid, isLearned, parseEmbedding, searchStars } from "../src/lib/memory-world-pure.ts";

test("isLearned matches CORE-saved sources only", () => {
  assert.equal(isLearned("core-auto"), true);
  assert.equal(isLearned("capture"), false);
  assert.equal(isLearned(null), false);
});

test("parseEmbedding accepts pgvector strings and arrays, rejects junk", () => {
  assert.deepEqual(parseEmbedding("[0.5,-1,2]"), [0.5, -1, 2]);
  assert.deepEqual(parseEmbedding([1, 2]), [1, 2]);
  assert.equal(parseEmbedding("[1,"), undefined);
  assert.equal(parseEmbedding("[]"), undefined);
  assert.equal(parseEmbedding([1, Number.NaN]), undefined);
  assert.equal(parseEmbedding(null), undefined);
});

test("searchStars needs every word across title, kind and tags", () => {
  const items = [
    { id: "a", title: "Roblox pet ideas", kind: "idea", tags: ["game"] },
    { id: "b", title: "House plan", kind: "project", tags: ["arch"] },
  ];
  assert.deepEqual(searchStars(items, "PET game"), [0]);
  assert.deepEqual(searchStars(items, "arch project"), [1]);
  assert.deepEqual(searchStars(items, "  "), []);
  assert.deepEqual(searchStars(items, "pet arch"), []);
});

test("centroid averages points and is the origin for none", () => {
  assert.deepEqual(centroid([]), [0, 0, 0]);
  assert.deepEqual(centroid([{ x: 2, y: 0, z: -2 }, { x: 0, y: 4, z: 2 }]), [1, 2, 0]);
});
