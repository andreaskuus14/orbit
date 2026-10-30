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

test("MEM06: stabilize keeps known stars in place and shifts new ones with the frame", async () => {
  const { stabilize } = await import("../src/lib/memory-world-pure.ts");
  const prev = new Map<string, [number, number, number]>([["a", [1, 1, 1]], ["b", [3, 1, 1]]]);
  const out = stabilize(prev, [{ id: "a", x: 0, y: 0, z: 0 }, { id: "b", x: 2, y: 0, z: 0 }, { id: "c", x: 5, y: 5, z: 5 }]);
  assert.deepEqual(out.map((p) => [p.id, p.x, p.y, p.z]), [["a", 1, 1, 1], ["b", 3, 1, 1], ["c", 6, 6, 6]]);
  assert.equal(stabilize(undefined, out), out);
});

test("MEM06: connections tell explicit links from inferred similarity; subgraph re-indexes", async () => {
  const { connections, subgraph, starProjects } = await import("../src/lib/memory-world-pure.ts");
  const items = [{ id: "a", tags: ["scope:orbit"] }, { id: "b", tags: [] as string[], folder: "orbit" }, { id: "c", tags: ["scope:school"] }, { id: "d", tags: ["scope:orbit"] }];
  const edges: [number, number, number][] = [[0, 2, 0.7], [0, 1, 0.9], [0, 3, 0.8]];
  assert.deepEqual(connections(0, items, [{ from: "b", to: "a" }], edges), [{ i: 1, kind: "explicit" }, { i: 3, kind: "inferred", sim: 0.8 }, { i: 2, kind: "inferred", sim: 0.7 }]);
  const g = subgraph(items, edges, "ORBIT");
  assert.deepEqual(g.items.map((m) => m.id), ["a", "b", "d"]);
  assert.deepEqual(g.edges, [[0, 1, 0.9], [0, 2, 0.8]]);
  assert.deepEqual(starProjects(items), ["orbit", "school"]);
});

test("MEM06: 1500 stars stay searchable", () => {
  const many = Array.from({ length: 1500 }, (_, i) => ({ id: String(i), title: `memory ${i}`, kind: "note", tags: i % 100 ? [] : ["rare"] }));
  assert.equal(searchStars(many, "rare").length, 15);
  assert.deepEqual(searchStars(many, "memory 1499"), [1499]);
});
