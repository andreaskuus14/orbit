import { test } from "node:test";
import assert from "node:assert/strict";
import { isOutcomeAsk, kindOf, outcomeDraft, shortsCount, toMissionBody } from "../src/lib/outcome-pure.ts";
import { validateMission } from "../src/lib/missions-pure.ts";
import { validateChain } from "../src/lib/chains-pure.ts";
import { BUILTIN_AGENTS } from "../src/lib/agent-defs-pure.ts";

const ASKS = ["make a week of Shorts from today's stream", "launch this Roblox update with the new pet egg", "turn this client idea into a shop for handmade candles"];

test("outcome asks: the three examples, Estonian, and the explicit prefix count; questions and lookups don't", () => {
  for (const a of ASKS) assert.equal(isOutcomeAsk(a), true, a);
  assert.equal(isOutcomeAsk("tee nädala jagu lühivideoid tänasest striimist"), true);
  assert.equal(isOutcomeAsk("ehita kliendile e-pood"), true);
  assert.equal(isOutcomeAsk("outcome: write my study plan for the exam"), true);
  for (const q of ["how do I make Shorts?", "what is a roblox place", "kas pood töötab?", "make a note", "shorts", "write me an email to Mart"]) assert.equal(isOutcomeAsk(q), false, q);
});

test("kind and Shorts count", () => {
  assert.deepEqual(ASKS.map(kindOf), ["shorts", "roblox", "shop"]);
  assert.equal(kindOf("outcome: write my study plan"), "general");
  assert.equal(shortsCount("a week of Shorts"), 7);
  assert.equal(shortsCount("make 5 shorts"), 5);
  assert.equal(shortsCount("make five clips"), 5);
  assert.equal(shortsCount("make shorts"), 3);
  assert.equal(shortsCount("make 40 shorts"), 14);
});

test("each kind gets its agreed checks, from existing checkers, with the deep ones on the deliverable", () => {
  const ids = (t: string) => outcomeDraft(t).checks.map((c) => c.id);
  assert.deepEqual(ids(ASKS[0]), ["count", "frames", "captions"]);
  assert.deepEqual(ids(ASKS[1]), ["scripts", "playtest", "saved"]);
  assert.deepEqual(ids(ASKS[2]), ["pages", "static", "render"]);
  assert.deepEqual(ids("outcome: write my study plan"), ["artifact"]);
  assert.match(outcomeDraft(ASKS[0]).checks[0].what, /^7 rendered clips/);
  // The slow, deep checks (playtests, frame review, rendered site) run on the finished work only.
  for (const id of ["playtest", "frames", "render"]) assert.equal([...ASKS].flatMap((a) => outcomeDraft(a).checks).find((c) => c.id === id)!.deliverable, true, id);
  assert.equal(outcomeDraft(ASKS[1]).checks.find((c) => c.id === "scripts")!.deliverable, false);
});

test("sending, publishing, uploading and spending are always approval points, and every step is told to stop there", () => {
  for (const t of [...ASKS, "outcome: write my study plan"]) {
    const d = outcomeDraft(t);
    assert.ok(d.approvalPoints.length > 0, t);
    assert.match(d.constraints.join(" "), /send, publish, upload, schedule or spend/);
    const body = validateMission(toMissionBody(d));
    assert.ok(typeof body !== "string", String(body));
    for (const s of (body as { steps: { request: string }[] }).steps) assert.match(s.request, /Mission constraints \(must hold\): Do not send, publish/);
    for (const s of d.steps) assert.doesNotMatch(s.request, /\b(publish it|send it|schedule them|buy)\b/i, s.request);
  }
  assert.match(outcomeDraft(ASKS[0]).approvalPoints[0], /schedul/);
  assert.match(outcomeDraft(ASKS[1]).approvalPoints.join(" "), /publishing the place/);
  assert.match(outcomeDraft(ASKS[2]).approvalPoints.join(" "), /connecting payments/);
});

test("the draft is a valid mission: real agents, 2-4 steps, acceptance carried, chain limits pass", () => {
  const slugs = new Set(BUILTIN_AGENTS.map((a) => a.slug));
  for (const t of [...ASKS, "outcome: write my study plan"]) {
    const d = outcomeDraft(t);
    assert.ok(d.steps.length >= 2 && d.steps.length <= 4, t);
    for (const s of d.steps) assert.ok(slugs.has(s.agent), s.agent);
    const body = validateMission(toMissionBody(d));
    assert.ok(typeof body !== "string", String(body));
    if (typeof body === "string") continue;
    assert.equal(body.acceptance, d.acceptance);
    assert.match(body.acceptance, /done only when:/);
    const chain = validateChain({ goal: body.objective, steps: body.steps });
    assert.ok(typeof chain !== "string", String(chain));
  }
});

test("pure and bounded: same text gives the same draft; long text is cut; prefix is dropped from the objective", () => {
  assert.deepEqual(outcomeDraft(ASKS[2]), outcomeDraft(ASKS[2]));
  assert.equal(outcomeDraft("outcome: " + "x".repeat(900)).objective.length, 300);
  assert.equal(outcomeDraft("Outcome:  build   the shop").objective, "build the shop");
});
