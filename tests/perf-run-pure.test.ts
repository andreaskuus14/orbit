import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameRing } from "../src/lib/perf-pure.ts";
import { PERF_RUN_SCRIPT, cleanRun, compareRuns, formatRun, previousOf, regressionLines, runSegment, type PerfRun } from "../src/lib/perf-run-pure.ts";

const seg = (name: string, p95: number) => ({ seg: name, n: 600, p50: 16.7, p95, p99: p95 + 2, fps: 60, worst: 40, jank: 0, long: 0, level: 3, rdpr: 1.25, cw: 1920, ch: 1080, dpr: 1.25 });
const run = (at: number, label: string, p95s: Record<string, number>): PerfRun =>
  cleanRun({ label, w: 1536, h: 864, dpr: 1.25, gpu: "ANGLE (NVIDIA)", segments: Object.entries(p95s).map(([k, v]) => seg(k, v)), marks: [] }, at)!;

test("script: fixed order, five worlds each followed by a return, about 70 s", () => {
  assert.deepEqual(PERF_RUN_SCRIPT.filter((s) => s.nav).map((s) => s.nav), ["studio", "intelligence", "memory", "arch", "agents"]);
  assert.equal(PERF_RUN_SCRIPT.filter((s) => s.nav === null).length, 5);
  assert.equal(PERF_RUN_SCRIPT.reduce((a, s) => a + s.ms, 0), 3000 + 10_000 + 5 * 9000 + 10_000);
});

test("runSegment counts jank and long frames and the worst one", () => {
  const r = new FrameRing(64), scratch = new Float32Array(64);
  assert.equal(runSegment(r, scratch), null);
  for (let i = 0; i < 20; i++) r.push(16);
  r.push(60); r.push(200);
  const s = runSegment(r, scratch)!;
  assert.equal(s.n, 22);
  assert.equal(s.jank, 2);
  assert.equal(s.long, 1);
  assert.equal(s.worst, 200);
});

test("cleanRun rejects bad bodies and keeps only known fields", () => {
  assert.equal(cleanRun(null, 1), null);
  assert.equal(cleanRun({ label: "../x", w: 1, h: 1, dpr: 1, segments: [seg("a", 16)] }, 1), null);
  assert.equal(cleanRun({ label: "a", w: 1, h: 1, dpr: 1, segments: [] }, 1), null);
  assert.equal(cleanRun({ label: "a", w: 1, h: 1, dpr: 1, segments: [{ ...seg("a", 16), p95: NaN }] }, 1), null);
  const r = cleanRun({ label: "1536x864", w: 1536, h: 864, dpr: 1.25, gpu: "g".repeat(500), segments: [{ ...seg("galaxy-idle", 17), evil: "x" }], marks: [{ mark: "galaxy-drawn", at: 900, extra: { ms: 3 } }, { mark: "bad name!", at: 1 }] }, 42)!;
  assert.equal(r.at, 42);
  assert.equal(r.gpu.length, 160);
  assert.equal("evil" in r.segments[0], false);
  assert.deepEqual(r.marks, [{ mark: "galaxy-drawn", at: 900, extra: { ms: 3 } }]);
});

test("compare: previous run at the same label, >15% and >=1 ms p95 is a regression", () => {
  const a = run(1, "1536x864", { "galaxy-idle": 16.7, studio: 20, dive: 5 });
  const other = run(2, "1920x1080", { "galaxy-idle": 30 });
  const b = run(3, "1536x864", { "galaxy-idle": 17.5, studio: 24, dive: 5.9, memory: 18 });
  assert.equal(previousOf([a, other, b], b), a);
  assert.equal(previousOf([a, other, b], a), null);
  const rows = compareRuns(a, b);
  assert.deepEqual(rows.map((r) => [r.seg, r.regressed]), [["galaxy-idle", false], ["studio", true], ["dive", false], ["memory", false]]); // dive: +18% but under 1 ms
  assert.equal(rows[1].pct, 20);
  assert.equal(rows[3].prevP95, null);
  assert.deepEqual(regressionLines(b, rows), ["Perf run 1536x864: studio p95 20 ms -> 24 ms (+20%)"]);
  assert.match(formatRun(b, rows), /studio .*REGRESSION/);
  assert.equal(compareRuns(null, b).some((r) => r.regressed), false);
});
