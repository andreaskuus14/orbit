import { test } from "node:test";
import assert from "node:assert/strict";
import { holdAnswerCall, toolAllowed } from "../src/lib/answer-call-pure.ts";

// chargeCall's rule (claude.ts): a call is refused once used reaches calls.
const charge = (b: { calls: number; used: number }) => { if (b.used >= b.calls) throw new Error("budget"); b.used++; };

test("a tool that spends calls can't take the answer's call (the Atlas scorecard regression)", async () => {
  const b = { calls: 6, used: 4 };
  assert.equal(toolAllowed(b), true);
  // a web_search or delegated sub-task that would happily spend everything
  await holdAnswerCall(b, async () => { try { for (;;) charge(b); } catch { /* sub-task stops on its budget */ } });
  assert.equal(b.used, 5);
  assert.equal(b.calls, 6, "the hold is released");
  assert.equal(toolAllowed(b), false, "no more tools");
  charge(b); // ...but the answer still gets its call
  assert.equal(b.used, 6);
});

test("the hold is released when the tool throws", async () => {
  const b = { calls: 3, used: 0 };
  await assert.rejects(holdAnswerCall(b, async () => { throw new Error("tool failed"); }));
  assert.equal(b.calls, 3);
});
