import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, graphHint, halos, keywords, kmeans, parseGraph, words, type GMem } from "../src/lib/memory-graph-pure.ts";

// Three synthetic topics on orthogonal axes in 8-D, a little seeded noise each; one memory halfway between ARCH and BUSINESS.
function noise(seed: number) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 - 0.5; }; }
const r = noise(7);
const around = (axis: number) => Array.from({ length: 8 }, (_, d) => (d === axis ? 1 : 0) + r() * 0.1);
const topics = [
  { axis: 0, text: "architecture facade concrete building" },
  { axis: 1, text: "business webshop revenue customers" },
  { axis: 2, text: "roblox pet simulator game" },
];
const mems: GMem[] = topics.flatMap((t, ti) => Array.from({ length: 6 }, (_, i) => ({
  id: `${ti}-${i}`, title: `${t.text.split(" ")[i % 4]} ${i}`, content: `${t.text} extra${ti}${i}`, tags: [], embedding: around(t.axis),
})));
const bridge: GMem = { id: "bridge", title: "Shop for architecture models", content: "architecture business", tags: [], embedding: [1, 1, 0, 0, 0, 0, 0, 0] };

test("buildGraph finds the three topics by silhouette and names them from shared keywords", () => {
  const g = buildGraph(mems, "2026-10-26");
  assert.equal(g.clusters.length, 3);
  for (const c of g.clusters) assert.equal(new Set(c.members.map((id) => id[0])).size, 1, "a cluster holds one topic only");
  const byTopic = (t: string) => g.clusters.find((c) => c.members[0][0] === t)!;
  assert.ok(["ARCHITECTURE", "FACADE", "CONCRETE", "BUILDING"].includes(byTopic("0").name), byTopic("0").name);
  assert.ok(["BUSINESS", "WEBSHOP", "REVENUE", "CUSTOMERS"].includes(byTopic("1").name), byTopic("1").name);
  assert.equal(new Set(g.clusters.map((c) => c.name)).size, 3, "names are distinct");
});

test("deterministic: the same input gives the same graph", () => {
  assert.deepEqual(buildGraph([...mems, bridge], "x"), buildGraph([...mems, bridge], "x"));
});

test("a memory between two clusters is a bridge joining exactly those two", () => {
  const g = buildGraph([...mems, bridge], "x");
  const b = g.bridges.find((x) => x.id === "bridge");
  assert.ok(b, "bridge found");
  const name = (id: number) => g.clusters.find((c) => c.id === id)!.members.filter((m) => m !== "bridge")[0][0];
  assert.deepEqual([name(b!.a), name(b!.b)].sort(), ["0", "1"]);
  assert.ok(!g.bridges.some((x) => x.id.startsWith("2-")), "a tight topic member is no bridge");
});

test("too few or unusable vectors: no clusters", () => {
  assert.deepEqual(buildGraph(mems.slice(0, 5), "x").clusters, []);
  assert.deepEqual(buildGraph(mems.map((m) => ({ ...m, embedding: null })), "x").clusters, []);
});

test("kmeans splits two obvious groups; identical points don't crash", () => {
  const u = (v: number[]) => Float64Array.from(v, (x) => x / Math.hypot(...v));
  const { labels } = kmeans([u([1, 0.1]), u([1, 0]), u([0, 1]), u([0.1, 1])], 2);
  assert.equal(labels[0], labels[1]); assert.equal(labels[2], labels[3]); assert.notEqual(labels[0], labels[2]);
  assert.equal(kmeans([u([1, 0]), u([1, 0]), u([1, 0])], 2).labels.length, 3);
});

test("keywords need two members and skip stop words; words() drops short tokens and numbers", () => {
  assert.deepEqual(words("The big Facade, 2026 and a façade!"), ["big", "facade", "façade"]);
  const kw = keywords([["arch", "solo"], ["arch", "x1"], ["shop", "y"], ["shop", "z"]], [0, 0, 1, 1], 2);
  assert.deepEqual(kw, [["arch"], ["shop"]]);
});

test("halos: centre of member stars, radius at least 1.5; unknown members skipped", () => {
  const pos = new Map([["a", { x: 0, y: 0, z: 0 }], ["b", { x: 4, y: 0, z: 0 }]]);
  const [h] = halos([{ id: 0, name: "A", keywords: [], members: ["a", "b", "gone"] }], pos);
  assert.deepEqual(h.at, [2, 0, 0]); assert.equal(h.r, 2); assert.equal(h.size, 2);
  assert.deepEqual(halos([{ id: 1, name: "B", keywords: [], members: ["gone"] }], pos), []);
});

test("graphHint lists the largest clusters; parseGraph rejects garbage", () => {
  const g = buildGraph(mems, "x");
  assert.match(graphHint(g), /^MEMORY TOPICS .*\(6\)/);
  assert.equal(graphHint(null), "");
  assert.equal(parseGraph("nope"), null);
  assert.equal(parseGraph('{"at":1}'), null);
  assert.deepEqual(parseGraph(JSON.stringify(g)), g);
});
