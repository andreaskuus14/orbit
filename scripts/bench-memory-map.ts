// Run alone (not beside the build/full suite): node --experimental-strip-types scripts/bench-memory-map.ts
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { layout, type MapItem } from "../src/lib/memory-map-pure.ts";

let seed = 12345;
const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const items: MapItem[] = Array.from({ length: 2000 }, (_, i) => ({
  id: `m${i}`, kind: `kind${i % 5}`, tags: [`tag${i % 11}`], embedding: Array.from({ length: 1024 }, () => rand() - 0.5),
}));
const links = items.slice(1).map((item, i) => ({ from: items[i].id, to: item.id }));
const cases: [string, MapItem[]][] = [
  ["2000 × 1024 embeddings", items],
  ["2000 fallback items", items.map(({ embedding: _e, ...item }) => item)],
  ["2000 rank-one embeddings", items.map((item, i) => ({ ...item, embedding: Array(128).fill(i % 2 ? 1 : -1) }))],
];
for (const [name, input] of cases) {
  const samples: number[] = [];
  for (let run = 0; run < 4; run++) {
    const start = performance.now();
    const result = layout(input, links);
    const ms = performance.now() - start;
    assert.equal(result.length, 2000);
    samples.push(ms);
  }
  const warm = samples.slice(1).sort((a, b) => a - b);
  console.log(`${name}: cold ${samples[0].toFixed(1)} ms, warm median ${warm[1].toFixed(1)} ms, warm max ${warm[2].toFixed(1)} ms`);
  assert.ok(samples[0] < 200, `${name}: cold ${samples[0].toFixed(1)} ms exceeds 200 ms`);
  assert.ok(warm[1] < 200, `${name}: median ${warm[1].toFixed(1)} ms exceeds 200 ms`);
}
