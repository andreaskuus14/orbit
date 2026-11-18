import { test } from "node:test";
import assert from "node:assert/strict";
import { STALLED, STALL_GRACE_MS, raceStall, stalledMsg } from "../src/lib/stall-pure.ts";

test("a task that finishes in time returns its result", async () => {
  assert.equal(await raceStall(Promise.resolve("done"), Date.now() + 60_000), "done");
});

test("a task that never settles is reported stalled after deadline + grace, and its late failure can't crash", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const now = 1_000_000, deadline = now + 8 * 60_000;
  let reject!: (e: Error) => void;
  const hung = new Promise<string>((_, r) => { reject = r; });
  const p = raceStall(hung, deadline, now);
  t.mock.timers.tick(8 * 60_000 + STALL_GRACE_MS);
  assert.equal(await p, STALLED);
  reject(new Error("late")); // swallowed
});

test("message says how long and that Retry works", () => {
  assert.match(stalledMsg(8), /13 min after start \(its budget is 8 min\).*Retry/);
});
