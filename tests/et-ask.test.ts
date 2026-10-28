import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../src/lib/policy-pure.ts";
import { etQuestion } from "../src/lib/et-ask-pure.ts";

const allow = (tool: string, question: string) => decide(tool, {}, { stopAll: false, attach: false, pins: false, steps: [], question }).allow;

test("Estonian questions and 'don't' never count as an order", () => {
  assert.ok(etQuestion("Kas ma peaksin eesmärgi looma") && etQuestion("Mis on mu eesmärk?") && !etQuestion("Loo eesmärk") && !etQuestion("Kas sa saaksid eesmärgi luua?"));
  assert.equal(allow("create_goal", "Kas loon eesmärgi 1000 tellijat?"), false);
  assert.equal(allow("ws_create", "Ära ehita veebilehte"), false);
  assert.equal(allow("higgsfield_draft", "Ära tee pilte rebasest"), false);
  assert.equal(allow("life_check", "Kas märkisin lugemise tehtuks?"), false);
  assert.equal(allow("queue_tonight", "Mis juhtus öösel"), false);
  assert.equal(allow("add_wish", "Tahan uut arvutit"), false); // no price
});
