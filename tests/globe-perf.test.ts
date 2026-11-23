// INTELLIGENCE globe: the shader tint's inputs (id map + colour table) and the benchmark's numbers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkByte, idBytes, tintTable } from "../src/lib/globe-tint-pure.ts";
import { benchStats, formatBench, intervals, quantile, type BenchRun } from "../src/lib/globe-bench-pure.ts";

const px = (id: number, a = 255, check = checkByte(id)) => [id & 255, (id >> 8) & 255, check, a];

test("idBytes: valid ids kept, sea dropped, half-covered coast kept", () => {
  const pick = [...px(3), ...px(0, 0, 0), ...px(5, 200), ...px(5, 60)];
  assert.deepEqual([...idBytes(pick, 177, 4)], [3, 0, 5, 0]);
});

test("idBytes: a blended border pixel takes a neighbour's id, never an out-of-range one", () => {
  // 3 wide: country 2 | blend of 2 and 7 (wrong check byte) | country 7
  const pick = [...px(2), 4, 0, 1, 255, ...px(7)];
  assert.deepEqual([...idBytes(pick, 177, 3)], [2, 2, 7]);
  assert.deepEqual([...idBytes([...px(200)], 177, 1)], [0]); // more than the atlas has
});

test("tintTable: same wash as the painted map (0.22 + 0.13·√share), sRGB colour at id = index + 1", () => {
  const t = tintTable(new Map([["A", 100], ["B", 25], ["C", 0]]), (n) => ({ A: 0, B: 4, C: 9 })[n], (n) => (n === "A" ? "#fbbf24" : "#4ade80"));
  assert.deepEqual([...t.slice(4, 8)], [0xfb, 0xbf, 0x24, Math.round(0.35 * 255)]);
  assert.deepEqual([...t.slice(20, 24)], [0x4a, 0xde, 0x80, Math.round((0.22 + 0.13 * 0.5) * 255)]);
  assert.equal(t[10 * 4 + 3], 0); // no stories: untinted
  assert.equal(t[3], 0); // entry 0 = sea
});

test("tintTable: unknown countries skipped, table reused and cleared", () => {
  const out = new Uint8Array(1024).fill(9);
  tintTable(new Map([["X", 3]]), () => undefined, () => "#ffffff", out);
  assert.ok(out.every((b) => b === 0));
});

test("bench: frame intervals go to the phase of the later frame; quantiles are nearest-rank", () => {
  const m = intervals([[0, "open"], [16, "open"], [116, "idle"], [132, "idle"]]);
  assert.deepEqual(m.get("open"), [16]);
  assert.deepEqual(m.get("idle"), [100, 16]);
  assert.equal(quantile([5, 1, 3], 0.5), 3);
  assert.equal(quantile([], 0.9), 0);
});

test("bench: stats per phase count slow frames, main-thread time and input handlers", () => {
  const run: BenchRun = {
    frames: [[0, "idle"], [17, "idle"], [34, "idle"], [94, "idle"]],
    long: [[40, 60, "idle"]],
    events: [[50, 120, "click", "idle", 40]],
    gl: { "idle:texSubImage2D": [1, 30, 30] },
    cpu: [[2, "idle"], [4, "idle"], [55, "idle"]],
  };
  const idle = benchStats([run]).find((s) => s.phase === "idle")!;
  assert.equal(idle.frames, 3);
  assert.equal(idle.over50, 1);
  assert.equal(idle.max, 60);
  assert.equal(idle.cpuMax, 55);
  assert.equal(idle.handlerMax, 40);
  assert.deepEqual(idle.glTop[0], { call: "texSubImage2D", n: 1, ms: 30, max: 30 });
  assert.match(formatBench(benchStats([run]), { renderer: "x", size: "1x1", runs: 1, software: true }), /idle\s+31\.9 fps/);
});
