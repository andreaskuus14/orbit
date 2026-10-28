import { test } from "node:test";
import assert from "node:assert/strict";
import { BARGE_MS, BARGE_START, bargeStep, ECHO_WARMUP_MS, type Barge } from "../src/lib/barge-pure.ts";

const F = 20; // ms per frame
/** Feed levels while ORBIT talks; the time (ms of loud input) of the first barge, or -1. */
function run(levels: number[], talking = true, b: Barge = BARGE_START) {
  for (let i = 0; i < levels.length; i++) {
    const r = bargeStep(b, levels[i], F, talking);
    b = r.b;
    if (r.barge) return { at: i, b };
  }
  return { at: -1, b };
}
const n = (ms: number, level: number) => Array(Math.round(ms / F)).fill(level);

test("owner talking over ORBIT barges in after ~200 ms", () => {
  const echo = n(500, 0.03); // ORBIT's own voice coming back
  const r = run([...echo, ...n(400, 0.2)]);
  assert.equal(r.at, echo.length + BARGE_MS / F - 1); // exactly BARGE_MS of louder frames
});

test("ORBIT's own echo, even loud, never barges in", () => {
  assert.equal(run(n(5000, 0.05)).at, -1);
  assert.equal(run([...n(500, 0.05), ...n(2000, 0.08)]).at, -1); // a slightly louder passage stays under 2×
});

test("a short cough or click doesn't barge in; louder frames must be consecutive", () => {
  const blips = [...n(400, 0.02), ...n(100, 0.3), ...n(100, 0.02), ...n(100, 0.3), ...n(400, 0.02)];
  assert.equal(run(blips).at, -1);
});

test("nothing during the warm-up or when ORBIT is silent", () => {
  assert.equal(run(n(ECHO_WARMUP_MS - F, 0.5)).at, -1);
  assert.equal(run(n(2000, 0.5), false).at, -1);
  assert.deepEqual(bargeStep({ echo: 0.1, playMs: 900, louderMs: 100 }, 0.5, F, false).b, BARGE_START); // resets when ORBIT stops
});

test("quiet room with echo cancellation: speech above the minimum level barges in, faint noise doesn't", () => {
  assert.equal(run([...n(300, 0.001), ...n(300, 0.01)]).at, -1); // under MIN_VOICE
  assert.ok(run([...n(300, 0.001), ...n(300, 0.05)]).at > 0);
});
