import { test } from "node:test";
import assert from "node:assert/strict";
import { layout, type MapItem, type MapPoint } from "../src/lib/memory-map-pure.ts";

const item = (id: string, embedding?: number[]): MapItem => ({ id, kind: "note", tags: [], ...(embedding ? { embedding } : {}) });
const distance = (a: MapPoint, b: MapPoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function bounded(points: MapPoint[]) {
  for (const p of points) {
    assert.ok([p.x, p.y, p.z].every(Number.isFinite), p.id);
    assert.ok(Math.hypot(p.x, p.y, p.z) <= 20 + 1e-9, `${p.id} escaped the sphere`);
  }
}
function averagePairs(points: MapPoint[]) {
  let total = 0, count = 0;
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) { total += distance(points[i], points[j]); count++; }
  return total / count;
}
function fixture(n: number, embeddings = true): MapItem[] {
  let seed = 7654321;
  const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 - 0.5; };
  return Array.from({ length: n }, (_, i) => ({ id: `m${i}`, kind: `kind${i % 3}`, tags: [`tag${i % 7}`], ...(embeddings ? { embedding: Array.from({ length: 16 }, rand) } : {}) }));
}

test("empty and singleton inputs have stable useful layouts", () => {
  assert.deepEqual(layout([], [{ from: "missing", to: "other" }]), []);
  assert.deepEqual(layout([item("one", [1, 2, 3])], []), [{ id: "one", x: 0, y: 0, z: 0 }]);
});

test("both PCA and metadata layouts are deterministic, bounded, ordered and leave inputs untouched", () => {
  for (const embedding of [true, false]) {
    const items = fixture(100, embedding), before = structuredClone(items);
    const links = [{ from: "m0", to: "m80" }, { from: "m20", to: "m50" }], saved = structuredClone(links);
    const first = layout(items, links);
    assert.deepEqual(first, layout(items, links));
    assert.deepEqual(first.map((p) => p.id), items.map((p) => p.id));
    assert.deepEqual(items, before); assert.deepEqual(links, saved);
    bounded(first);
    assert.ok(averagePairs(first) > 2, "points must not collapse to the origin");
  }
});

test("constant, low-rank, tiny and huge embeddings never produce NaN or collapse all points", () => {
  for (const vector of [[], [0, 0, 0], [1, 1, 1], [1e-300, -1e-300], [1e308, -1e308]]) {
    const result = layout(Array.from({ length: 30 }, (_, i) => item(String(i), vector.slice())), []);
    bounded(result);
    assert.ok(averagePairs(result) > 1);
  }
  const rankOne = Array.from({ length: 60 }, (_, i) => item(String(i), [i % 2 ? 1 : -1, 0, 0, 0]));
  bounded(layout(rankOne, rankOne.slice(1).map((p, i) => ({ from: rankOne[i].id, to: p.id }))));
});

test("missing, ragged and non-finite embeddings safely use metadata fallback", () => {
  const items = [item("a", [1, 2, 3]), item("b", [3, 2, 1]), item("missing"), item("empty", []), item("ragged", [1, 2]), item("nan", [NaN, 1, 1]), item("inf", [Infinity, 0, 0])];
  const result = layout(items, []);
  assert.equal(result.length, items.length);
  assert.deepEqual(result, layout(items, []));
  bounded(result);
});

test("PCA centers embeddings and recovers three distinct principal directions", () => {
  const items = Array.from({ length: 80 }, (_, i) => {
    const a = Math.sin(i * 1.37) * 9, b = Math.cos(i * 0.73) * 3, c = Math.sin(i * 2.13);
    return item(String(i), [a + b, a - b, c, c * 0.5]);
  });
  const result = layout(items, []);
  const correlation = (a: number[], b: number[]) => {
    const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
    const ma = mean(a), mb = mean(b);
    return Math.abs(a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0) / Math.sqrt(a.reduce((s, x) => s + (x - ma) ** 2, 0) * b.reduce((s, x) => s + (x - mb) ** 2, 0)));
  };
  assert.ok(correlation(result.map((p) => p.x), items.map((p) => p.embedding![0] + p.embedding![1])) > 0.98);
  assert.ok(correlation(result.map((p) => p.y), items.map((p) => p.embedding![0] - p.embedding![1])) > 0.95);
  assert.ok(correlation(result.map((p) => p.z), items.map((p) => p.embedding![2])) > 0.9);
  const shifted = layout(items.map((p) => ({ ...p, embedding: p.embedding!.map((v, d) => v + 100 * (d + 1)) })), []);
  for (let i = 0; i < result.length; i++) assert.ok(distance(result[i], shifted[i]) < 0.01, "centering removes a constant translation");
});

test("fallback clusters by kind, then first tag; later tags do not change positions", () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ id: String(i), kind: i < 30 ? "idea" : "project", tags: [i % 30 < 15 ? "a" : "b", "ignored"] }));
  const result = layout(items, []);
  const within = averagePairs(result.slice(0, 15));
  let otherTag = 0, otherKind = 0;
  for (let i = 0; i < 15; i++) for (let j = 0; j < 15; j++) { otherTag += distance(result[i], result[j + 15]); otherKind += distance(result[i], result[j + 30]); }
  assert.ok(within < otherTag / 225);
  assert.ok(otherTag < otherKind);
  assert.deepEqual(layout(items.map((p) => ({ ...p, tags: [p.tags[0], "changed"] })), []), result);
});

test("links pull pairs closer than the global average and closer than their unlinked positions", () => {
  for (const embeddings of [true, false]) {
    const items = fixture(100, embeddings);
    const links = Array.from({ length: 50 }, (_, i) => ({ from: `m${i}`, to: `m${i + 50}` }));
    const plain = layout(items, []), linked = layout(items, links);
    const mean = (p: MapPoint[]) => links.reduce((sum, _, i) => sum + distance(p[i], p[i + 50]), 0) / links.length;
    assert.ok(mean(linked) < averagePairs(linked) * 0.7);
    assert.ok(mean(linked) < mean(plain) * 0.6);
    bounded(linked);
  }
});

test("self-links, unknown endpoints, duplicate/reversed edges and edge order cannot change the result", () => {
  const items = fixture(25), links = [{ from: "m1", to: "m20" }, { from: "m2", to: "m21" }];
  assert.deepEqual(layout(items, links), layout(items, [...links].reverse().concat(links, [{ from: "m20", to: "m1" }, { from: "m1", to: "m1" }, { from: "unknown", to: "m2" }])));
});

test("2000-item mixed layouts stay finite and inside the sphere under a hub's links", () => {
  const items = fixture(2000);
  for (let i = 0; i < items.length; i += 3) delete items[i].embedding;
  const links = items.slice(1).map((p) => ({ from: "m0", to: p.id }));
  const result = layout(items, links);
  assert.equal(result.length, 2000); bounded(result);
});
