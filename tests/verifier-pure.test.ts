import { test } from "node:test";
import assert from "node:assert/strict";
import { needsVerify, parseVerdict, verifierContinue, verifierPrompt } from "../src/lib/verifier-pure.ts";
import { coreReceipt } from "../src/lib/receipt-pure.ts";

const site = { tool: "ws_write", input: { workspace: "bakery", files: [{ path: "index.html", content: "<h1>Tartu Bakery</h1><a href=\"order.html\">Order</a>" }] }, output: "Wrote 1 file.\nCheck: renders on desktop and phone, no errors. Give the user the preview link", evidence: [{ kind: "file" as const, id: "bakery", path: "index.html" }] };
const lead = (n: string) => ({ tool: "lead_create", input: { name: n }, output: `added "${n}" (id 1)`, evidence: [] });

test("verify only a receipt that claims done on a checkable task; never plain chat or reads", () => {
  const q = "Build me a website for a bakery";
  assert.equal(needsVerify(q, coreReceipt(q, [site]), [site]), true);
  assert.equal(needsVerify("what's up?", null, []), false);
  const two = [lead("A"), lead("B")], q5 = "Add 5 new leads: car repair shops";
  assert.equal(needsVerify(q5, coreReceipt(q5, two), two), false); // receipt already says partly: the done-gate handles it
  const five = ["A", "B", "C", "D", "E"].map(lead);
  assert.equal(needsVerify(q5, coreReceipt(q5, five), five), true);
  const mem = { tool: "save_memory", input: { title: "x" }, output: "Saved memory", evidence: [{ kind: "memory" as const, id: "m1" }] };
  assert.equal(needsVerify("remember that I like tea", coreReceipt("remember that I like tea", [mem]), [mem]), false); // a plain save: read-back is enough
});

test("prompt carries request, receipt, answer, files as written and the site check, capped", () => {
  const q = "Build me a website for a bakery", r = coreReceipt(q, [site])!;
  const p = verifierPrompt(q, r, "Done! Here is your site.", [site]);
  assert.match(p, /REQUEST:\nBuild me a website/);
  assert.match(p, /FILE bakery\/index\.html \(\d+ chars\):\n<h1>Tartu Bakery/);
  assert.match(p, /ws_write site check: Check: renders/);
  assert.match(p, /AGENT'S ANSWER:\nDone!/);
  const big = { ...site, input: { workspace: "b", files: [{ path: "a.html", content: "x".repeat(50_000) }, { path: "b.css", content: "y" }] } };
  const capped = verifierPrompt(q, r, "ok", [big], 6000);
  assert.ok(capped.length < 6300);
  assert.match(capped, /…\(cut\)|more files not shown/);
  const err = { ...site, output: "Error: disk full" };
  assert.doesNotMatch(verifierPrompt(q, r, "ok", [err]), /FILE /); // failed writes are not evidence
});

test("verdict parsing: verified / not verified with reason; junk is no verdict", () => {
  assert.deepEqual(parseVerdict("VERDICT: verified — all 5 leads stored with source links"), { ok: true, reason: "all 5 leads stored with source links" });
  assert.deepEqual(parseVerdict("Some thinking.\n**VERDICT: not verified** - order.html is linked but was never written"), { ok: false, reason: "order.html is linked but was never written" });
  assert.deepEqual(parseVerdict("verdict: Unverified: count is 4"), { ok: false, reason: "count is 4" });
  assert.deepEqual(parseVerdict("VERDICT: verified"), { ok: true, reason: "no gap found" });
  assert.equal(parseVerdict("Looks good to me!"), null);
  assert.match(verifierContinue({ ok: false, reason: "order.html missing" }), /NOT met yet: order\.html missing/);
});
