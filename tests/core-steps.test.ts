import { test } from "node:test";
import assert from "node:assert/strict";
import { stepTier, stepsContext, callKey, remember, reused, estimateStepMs, STEP_THINKING, KEEP_FULL } from "../src/lib/core-steps-pure.ts";

const search = (q: string, body = "x".repeat(8000)) => `You called web_search {"query":"${q}"}\nRESULT:\n${body}`;

test("stepTier: tool choice after a read goes to the fast model; answer, step 0, writes and sessions stay", () => {
  assert.equal(stepTier("smart", { lastStep: search("a"), last: false, session: false }), "fast");
  assert.equal(stepTier("deep", { lastStep: 'You called fetch_url {"url":"u"}\nRESULT:\nok', last: false, session: false }), "fast");
  assert.equal(stepTier("smart", { lastStep: undefined, last: false, session: false }), "smart"); // step 0
  assert.equal(stepTier("smart", { lastStep: search("a"), last: true, session: false }), "smart"); // the final synthesis
  assert.equal(stepTier("smart", { lastStep: 'You called ws_write {}\nRESULT:\nok', last: false, session: false }), "smart");
  assert.equal(stepTier("smart", { lastStep: search("a"), last: false, session: true }), "smart");
  assert.equal(stepTier("fast", { lastStep: search("a"), last: false, session: false }), "fast");
});

test("stepsContext: planning keeps the newest results in full and shortens older ones; the answer sees all", () => {
  const steps = [search("a"), search("b"), search("c"), search("d")];
  const plan = stepsContext(steps, true);
  assert.equal(plan.length, 4);
  assert.ok(plan[0].length < 800 && plan[0].startsWith('You called web_search {"query":"a"}') && plan[0].includes("shortened"));
  assert.deepEqual(plan.slice(-KEEP_FULL), steps.slice(-KEEP_FULL));
  assert.equal(stepsContext(steps, false), steps);
  assert.deepEqual(stepsContext(["short"], true), ["short"]);
});

test("callKey: same tool + same input match regardless of key order", () => {
  assert.equal(callKey("web_search", { query: "Lasila Betoon", n: 1 }), callKey("web_search", { n: 1, query: "Lasila Betoon" }));
  assert.notEqual(callKey("web_search", { query: "a" }), callKey("fetch_url", { query: "a" }));
  assert.notEqual(callKey("web_search", { query: "a" }), callKey("web_search", { query: "b" }));
});

test("remember: dedupes successes, never errors; a write drops earlier reads but keeps writes", () => {
  const done = new Map<string, string>(), isWrite = (t: string) => t === "lead_create";
  remember(done, "web_search", { query: "Lasila Betoon" }, "found", isWrite);
  remember(done, "fetch_url", { url: "x" }, "Error: 404", isWrite);
  assert.equal(done.get(callKey("web_search", { query: "Lasila Betoon" })), "found");
  assert.equal(done.has(callKey("fetch_url", { url: "x" })), false);
  remember(done, "lead_create", { name: "Lasila Betoon" }, "saved", isWrite);
  assert.equal(done.has(callKey("web_search", { query: "Lasila Betoon" })), false);
  assert.equal(done.get(callKey("lead_create", { name: "Lasila Betoon" })), "saved");
  assert.match(reused("saved"), /not run again[\s\S]*saved$/);
});

test("resume after handoff: finished steps carry over and repeat calls hit the cache", () => {
  // What runCoreFor hands the background run (CoreHandoff.carry): the same arrays/maps, not a restart.
  const carry = { steps: [search("Lasila Betoon")], done: new Map<string, string>() };
  remember(carry.done, "web_search", { query: "Lasila Betoon" }, "found", () => false);
  const resumed = { ...carry };
  assert.equal(resumed.steps.length, 1); // the background loop starts at step 1, results already in its prompt
  assert.equal(resumed.done.get(callKey("web_search", { query: "Lasila Betoon" })), "found");
});

test("timing model: the live 3 min step vs a capped fast tool-choice step", () => {
  // Live: smart model, ~30k chars of context + 6 full results (8000 chars each), uncapped thinking (~10k tokens) → minutes.
  const before = estimateStepMs({ tier: "smart", inputChars: 30_000 + 6 * 8000, outputTokens: 150, thinkingTokens: 10_000 });
  // Now: fast model, 2 full + 4 shortened results, thinking capped.
  const after = estimateStepMs({ tier: "fast", inputChars: 30_000 + 2 * 8000 + 4 * 650, outputTokens: 150, thinkingTokens: STEP_THINKING });
  assert.ok(before > 150_000, `before ${before}`);
  assert.ok(after < 20_000, `after ${after}`);
});
