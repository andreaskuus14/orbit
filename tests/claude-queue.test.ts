import { test } from "node:test";
import assert from "node:assert/strict";
import { createLaneLimiter, BusyError, createBudget, chargeCall, BudgetError, stopKind, stoppedReport } from "../src/lib/claude.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));
/** A job that runs until released; `started` records the start order. */
function jobs() {
  const started: string[] = [];
  const release = new Map<string, () => void>();
  const job = (name: string) => () => new Promise<string>((r) => { started.push(name); release.set(name, () => r(name)); });
  return { started, job, done: (name: string) => release.get(name)!() };
}

test("background never takes the last slot; foreground still gets it", async () => {
  const run = createLaneLimiter(3);
  const { started, job } = jobs();
  for (const n of ["b1", "b2", "b3"]) void run("background", job(n));
  await tick();
  assert.deepEqual(started, ["b1", "b2"]);
  void run("foreground", job("f1"));
  await tick();
  assert.deepEqual(started, ["b1", "b2", "f1"]);
});

test("a waiting foreground request jumps ahead of queued background work", async () => {
  const run = createLaneLimiter(2);
  const { started, job, done } = jobs();
  void run("foreground", job("f1"));
  void run("background", job("b1"));
  void run("background", job("b2"));
  void run("foreground", job("f2"));
  await tick();
  assert.deepEqual(started, ["f1", "b1"]);
  done("f1");
  await tick();
  assert.deepEqual(started, ["f1", "b1", "f2"]); // f2 before the older b2
  done("b1");
  await tick();
  assert.deepEqual(started, ["f1", "b1", "f2", "b2"]);
});

test("limit 1 still runs background work", async () => {
  const run = createLaneLimiter(1);
  assert.equal(await run("background", async () => 7), 7);
});

test("background queue is bounded and fails fast", async () => {
  const run = createLaneLimiter(2, 2);
  const { job } = jobs();
  void run("background", job("running"));
  void run("background", job("w1"));
  void run("background", job("w2"));
  await assert.rejects(run("background", job("w3")), BusyError);
  void run("foreground", job("f")); // foreground is never refused
});

test("aborting a queued request removes it from the queue", async () => {
  const run = createLaneLimiter(2);
  const { started, job, done } = jobs();
  void run("background", job("b1"));
  const ac = new AbortController();
  const p = run("background", job("b2"), ac.signal);
  void run("background", job("b3"));
  ac.abort();
  await assert.rejects(p);
  done("b1");
  await tick();
  assert.deepEqual(started, ["b1", "b3"]);
});

test("budget: calls are shared and run out with a clear error", () => {
  const b = createBudget(60_000, 2);
  const parent = new AbortController().signal, child = new AbortController().signal;
  chargeCall(b, parent);
  chargeCall(b, child); // a delegated sub-task spends the same budget
  assert.throws(() => chargeCall(b, parent), (e: unknown) => e instanceof BudgetError && /Budget exceeded: all 2 Claude calls/.test(e.message));
  assert.equal(b.used, 2);
});

test("budget: deadline and cancellation are told apart", async () => {
  const b = createBudget(1, 5);
  await new Promise((r) => setTimeout(r, 20));
  const sig = AbortSignal.any([new AbortController().signal, b.signal]);
  assert.throws(() => chargeCall(b, sig), /minute limit/);
  assert.equal(stopKind(b, sig, new Error("x")), "budget");

  const b2 = createBudget(60_000, 5);
  const root = new AbortController();
  const childSig = AbortSignal.any([new AbortController().signal, b2.signal, root.signal]);
  root.abort(); // cancelling the parent reaches the child
  assert.throws(() => chargeCall(b2, childSig));
  assert.equal(stopKind(b2, childSig, new Error("x")), "cancelled");
  assert.equal(stopKind(b2, new AbortController().signal, new Error("x")), null);
});

test("stoppedReport lists finished steps and sub-tasks only", () => {
  const r = stoppedReport("Cancelled", [
    { step: "think", detail: "sonnet", ok: true },
    { step: "read_news", detail: '{"query":"x"} → 3 articles', ok: true },
    { step: "fetch_url", detail: "→ Error: blocked", ok: false },
  ], [{ agent: "atlas", title: "Research", status: "done" }, { agent: "qa", title: "Check", status: "cancelled" }]);
  assert.match(r, /^\*\*Cancelled\.\*\* Completed before stopping:/);
  assert.match(r, /read_news/);
  assert.match(r, /atlas finished sub-task "Research"/);
  assert.doesNotMatch(r, /think|fetch_url|qa/);
  assert.match(stoppedReport("Cancelled", [], []), /Nothing was completed yet/);
});
