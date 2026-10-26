import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CALL, CALL_START, CALL_VAD, FILLERS, backchannel, callVad, cleanOpener, decideCall, endSilenceMs, fallbackSummary, itemsKey, opener, openerPrompt, parseCallState,
  phraseKey, quickReply, takeSentences, voiceDecision, whenLabel, worthSending,
  type CallItem, type CallState,
} from "../src/lib/call-pure.ts";
import { MIC_START, type Mic } from "../src/lib/audio-pure.ts";

// 2026-10-26 is after the DST switch: Tallinn = UTC+2.
const at = (h: number, m = 0, d = 26) => Date.UTC(2026, 9, d, h - 2, m);
const sig = (now: number, o: Partial<{ stopAll: boolean; approvals: string[]; nightReport: boolean; focus: boolean }> = {}) => ({ now, stopAll: false, approvals: [], nightReport: false, ...o });

test("a focus block lets only an urgent call ring, and uses nothing up", () => {
  const morning = sig(at(8, 30), { approvals: ["a"], nightReport: true, focus: true });
  const held = decideCall(CALL_START, morning);
  assert.equal(held.ring, null);
  assert.equal(decideCall(held.state, { ...morning, focus: false }).ring?.reason, "morning"); // rings once the block ends
  assert.equal(decideCall({ ...CALL_START, urgentAt: at(8, 20) }, morning).ring?.reason, "urgent");
});

test("morning after the night shift rings once when approvals wait", () => {
  const r = decideCall(CALL_START, sig(at(8, 30), { approvals: ["a", "b"], nightReport: true }));
  assert.deepEqual(r.ring, { reason: "morning", things: 2 });
  const again = decideCall(r.state, sig(at(10, 0), { approvals: ["a", "b"], nightReport: true }));
  assert.equal(again.ring, null); // morning already done today
  assert.equal(decideCall(CALL_START, sig(at(8, 30), { nightReport: true })).ring, null); // nothing waiting: no call
  assert.equal(decideCall(CALL_START, sig(at(12, 0), { approvals: ["a"], nightReport: true })).ring, null); // too late for "morning"
});

test("quiet hours, Stop-all, the daily cap and the gap all block a ring", () => {
  const urgent: CallState = { ...CALL_START, urgentAt: at(7, 30) };
  assert.equal(decideCall(urgent, sig(at(23, 30))).ring, null);
  assert.equal(decideCall(urgent, sig(at(7, 59))).ring, null);
  assert.equal(decideCall(urgent, sig(at(9), { stopAll: true })).ring, null);
  assert.equal(decideCall(urgent, sig(at(9))).ring?.reason, "urgent"); // held failure rings once quiet hours end
  assert.equal(decideCall({ ...CALL_START, urgentAt: at(2) }, sig(at(9))).ring, null); // too old by then: the morning card has it
  const capped = { ...urgent, day: "2026-10-26", calls: CALL.maxPerDay };
  assert.equal(decideCall(capped, sig(at(14))).ring, null);
  assert.equal(decideCall({ ...capped, day: "2026-10-25" }, sig(at(9))).ring?.reason, "urgent"); // new day resets the cap
  assert.equal(decideCall({ ...urgent, lastAt: at(13, 30), urgentAt: at(13, 45) }, sig(at(14))).ring, null); // < 1 h since the last call
});

test("an approval waiting longer than the block limit rings once, then not again", () => {
  let st = decideCall(CALL_START, sig(at(9), { approvals: ["x"] })).state;
  assert.equal(st.seen.x, at(9));
  assert.equal(decideCall(st, sig(at(12), { approvals: ["x"] })).ring, null);
  const r = decideCall(st, sig(at(13, 1), { approvals: ["x"] }));
  assert.deepEqual(r.ring, { reason: "blocked", things: 1 });
  st = r.state;
  assert.equal(decideCall(st, sig(at(15), { approvals: ["x"] })).ring, null);
  assert.deepEqual(decideCall(st, sig(at(15), { approvals: [] })).state.seen, {}); // gone: forgotten
});

test("scheduled check-in rings inside its window once a day", () => {
  const st = { ...CALL_START, checkin: "17:30" };
  assert.equal(decideCall(st, sig(at(17, 0))).ring, null);
  const r = decideCall(st, sig(at(17, 40)));
  assert.equal(r.ring?.reason, "checkin");
  assert.equal(decideCall({ ...r.state, lastAt: 0 }, sig(at(18, 50))).ring, null);
  assert.equal(decideCall(st, sig(at(19, 31))).ring, null); // window passed
});

test("state file parsing is tolerant", () => {
  assert.deepEqual(parseCallState("nope"), CALL_START);
  const s = parseCallState(JSON.stringify({ calls: 1, checkin: "25:00", seen: { a: 5, b: "x" }, nagged: ["a", 3] }));
  assert.equal(s.calls, 1); assert.equal(s.checkin, ""); assert.deepEqual(s.seen, { a: 5 }); assert.deepEqual(s.nagged, ["a"]);
});

test("openers are short, natural and end on a question", () => {
  const items = [{ kind: "clip" as const, title: "Big Fish" }, { kind: "spend" as const, title: "Robot", credits: 40 }];
  const m = opener("morning", 8, items);
  assert.match(m, /^Morning\. The night shift's done, and two things need your OK\. Want to start with the clip “Big Fish”\?$/);
  for (const r of ["urgent", "blocked", "checkin", "manual"] as const) assert.match(opener(r, 15, items), /\?$/);
  assert.equal(opener("checkin", 20, []), "Evening, just checking in. Nothing's waiting on you. How's it going?");
});

test("sentence chunking streams whole sentences and keeps abbreviations and decimals together", () => {
  assert.deepEqual(takeSentences("Hi there. It costs 3.5 credits, e.g. a"), { done: ["Hi there."], rest: "It costs 3.5 credits, e.g. a" });
  assert.deepEqual(takeSentences("It costs 3.5 credits, e.g. a lot. Next", false).done, ["It costs 3.5 credits, e.g. a lot."]);
  assert.deepEqual(takeSentences("**Done** [1]! See [docs](http://x).", true).done, ["Done!", "See docs."]);
  const long = takeSentences(`${"word ".repeat(20)}, ${"more ".repeat(30)}`);
  assert.ok(long.done.length >= 1 && long.done.every((c) => c.length <= 160));
  assert.deepEqual(takeSentences("", true), { done: [], rest: "" });
});

test("VAD: ORBIT's own echo doesn't count as him talking, a clear voice does", () => {
  const run = (level: number, speaking: boolean, frames = 20) => {
    let m: Mic = { ...MIC_START, floor: 0.01 }, started = false;
    for (let i = 0; i < frames; i++) { const r = callVad(m, level, 0.1, 21, speaking); m = r.m; if (r.event === "start") started = true; }
    return started;
  };
  assert.equal(run(0.05, false), true);
  assert.equal(run(0.05, true), false); // echo-level while ORBIT talks
  assert.equal(run(0.2, true), true); // barge-in
  assert.equal(worthSending(200), false);
  assert.equal(worthSending(400), true);
});

const items: CallItem[] = [
  { id: "c1", kind: "clip", title: "Giant Squid Facts", seen: "s1", thumb: true },
  { id: "p1", kind: "spend", title: "Robot Story", seen: "q1", credits: 40 },
  { id: "e1", kind: "send", title: "Acme Bakery", seen: "u1", to: "hi@acme.test" },
];

test("approving by voice needs a spoken yes on the exact item", () => {
  const ask = voiceDecision(null, "Approve the giant squid clip", items, 1000)!;
  assert.equal(ask.say, "Approve the clip “Giant Squid Facts”? Say yes to confirm.");
  assert.equal(ask.act, undefined);
  const yes = voiceDecision(ask.pending, "Yes.", items, 5000)!;
  assert.deepEqual(yes.act, { id: "c1", action: "approve", echo: { kind: "clip", seen: "s1" } });
  assert.equal(yes.pending, null);
  // anything but yes cancels
  assert.deepEqual(voiceDecision(ask.pending, "hmm, maybe not", items, 5000), { pending: null, say: "Okay, I'll leave it." });
  assert.equal(voiceDecision(ask.pending, "yes but not that one", items, 5000)!.act, undefined);
  // timed out
  assert.equal(voiceDecision(ask.pending, "yes", items, 1000 + CALL.confirmMs + 1)!.act, undefined);
  // the item changed between the question and the yes
  assert.equal(voiceDecision(ask.pending, "yes", [{ ...items[0], seen: "s2" }], 5000)!.act, undefined);
  assert.equal(voiceDecision(ask.pending, "yes", [], 5000)!.act, undefined);
});

test("spends name the exact credits, rejects are clip-only, ambiguity asks which one", () => {
  const sp = voiceDecision(null, "go ahead with the robot story", items, 0)!;
  assert.equal(sp.say, "Spend 40 Higgsfield credits on “Robot Story”? Say yes to confirm.");
  assert.deepEqual(voiceDecision(sp.pending, "yes", items, 10)!.act?.echo, { kind: "spend", seen: "q1", credits: 40 });
  assert.equal(voiceDecision(sp.pending, "yes", [{ ...items[1], credits: 41 }], 10)!.act, undefined); // quote changed
  assert.match(voiceDecision(null, "reject the email", items, 0)!.say!, /only reject clips/);
  assert.match(voiceDecision(null, "approve it", items, 0)!.say!, /^Which one\?/);
  assert.match(voiceDecision(null, "approve it", [items[0]], 0)!.say!, /^Approve the clip/);
  assert.equal(voiceDecision(null, "should I approve the squid clip?", items, 0), null); // advice → CORE
  assert.equal(voiceDecision(null, "how was the night?", items, 0), null);
  assert.match(voiceDecision(null, "approve the clip", [{ ...items[0], thumb: false }], 0)!.say!, /no preview/);
  assert.equal(voiceDecision(null, "approve the clip", [], 0)!.say, "There's nothing waiting for you right now.");
  const em = voiceDecision(null, "send the email", items, 0)!; // emails are screen-only: never sent on a spoken yes
  assert.match(em.say!, /^The email to hi@acme\.test needs you to read it first/);
  assert.equal(em.pending, null);
});

test("fallback summary keeps his words short and lists what was done", () => {
  const s = fallbackSummary([{ role: "assistant", content: "Morning." }, { role: "user", content: "Move the check-in to six." }], ["approved a clip"]);
  assert.equal(s, "On a call, Andreas said: “Move the check-in to six.”. Done on the call: approved a clip.");
  assert.equal(fallbackSummary([], []), "A short call with no decisions.");
});

test("fillers vary and never repeat within a call", () => {
  assert.notEqual(backchannel("what's next?", 0), backchannel("what's next?", 1));
  assert.match(backchannel("I liked it", 0)!, /^(Mm-hm|Okay|Right|Got it|I see|Yeah|Sure|Mm)\.$/);
  const said = new Set<string>();
  const got: string[] = [];
  for (let i = 0; i < 20; i++) { const f = backchannel("I liked it", 0, said); if (!f) break; got.push(f); said.add(phraseKey(f)); }
  assert.equal(new Set(got).size, got.length); // all different
  assert.equal(backchannel("I liked it", 3, said), null); // all used up: silence, not a repeat
  assert.ok(FILLERS.includes("One sec."));
});

test("goodbyes and bare okays are answered locally; an okay to a question goes to CORE", () => {
  const none = new Set<string>();
  assert.deepEqual(quickReply("Okay, bye!", "Done.", none)?.end, true);
  assert.equal(quickReply("No, that's all, thanks", "Anything else?", none)?.end, true);
  assert.equal(quickReply("I have to go", "", none)?.end, true);
  const ack = quickReply("Okay.", "Done, approved.", none);
  assert.ok(ack && !ack.end && /\?$/.test(ack.say));
  assert.equal(quickReply("Okay.", "Want to start with the clip?", none), null);
  assert.equal(quickReply("okay so what about the squid clip", "Done.", none), null);
  const said = new Set(["Anything else?", "What else is on your mind?"].map(phraseKey));
  assert.ok(!said.has(phraseKey(quickReply("cool", "Done.", said)!.say)));
});

test("end of turn: a short yes ends sooner, a long thought gets more room", () => {
  assert.equal(endSilenceMs(400), CALL_VAD.shortEndMs);
  assert.equal(endSilenceMs(2000), CALL_VAD.endMs);
  assert.equal(endSilenceMs(8000), CALL_VAD.longEndMs);
  // a 0.4 s "yes" then silence: the turn ends after shortEndMs, not the default
  let m: Mic = { ...MIC_START, floor: 0.01 }, endedAt = -1;
  for (let i = 0; i < 60; i++) { const r = callVad(m, i < 20 ? 0.1 : 0.001, 0.1, 21, false); m = r.m; if (r.event === "end" && endedAt < 0) endedAt = i; }
  assert.ok(endedAt > 20 && (endedAt - 20) * 21 < CALL_VAD.endMs, `ended at frame ${endedAt}`);
});

test("earlier calls: when-labels, the opener prompt and a safe fallback", () => {
  assert.equal(whenLabel("2026-10-25", "2026-10-25"), "earlier today");
  assert.equal(whenLabel("2026-10-24", "2026-10-25"), "yesterday");
  assert.equal(whenLabel("2026-10-23", "2026-10-25"), "on Friday");
  assert.equal(whenLabel("2026-10-10", "2026-10-25"), null);
  assert.equal(whenLabel("nope", "2026-10-25"), null);
  const base = "Hey, I'm here. What's up?";
  assert.match(openerPrompt(base, [{ when: "yesterday", text: "He wants the\nsquid clip shorter." }]), /OPENER:\nHey, I'm here\. What's up\?\n\nEARLIER CALLS \(data\):\n- yesterday: He wants the squid clip shorter\./);
  assert.equal(cleanOpener("\"Hey. Following up on yesterday's squid clip: want to hear the shorter cut?\"", base), "Hey. Following up on yesterday's squid clip: want to hear the shorter cut?");
  assert.equal(cleanOpener("Sure! Here's an opener:", base), base); // no question: not an opener
  assert.equal(cleanOpener("See https://x.test ok?", base), base);
  assert.equal(cleanOpener(`${"word ".repeat(70)}?`, base), base);
  assert.equal(itemsKey([{ id: "b", seen: "2" }, { id: "a", seen: "1" }]), "a@1,b@2");
});

test("a contract waiting for his signature rings once per contract, after deals, never in quiet hours", () => {
  const r = decideCall(CALL_START, { ...sig(at(10)), contracts: ["k1"] });
  assert.deepEqual(r.ring, { reason: "contract", things: 1 });
  assert.match(opener("contract", 10, []), /contract waits for your signature.*signing it is yours/);
  assert.equal(decideCall({ ...r.state, lastAt: 0 }, { ...sig(at(12)), contracts: ["k1"] }).ring, null); // already rung about k1
  assert.equal(decideCall(CALL_START, { ...sig(at(23, 30)), contracts: ["k1"] }).ring, null);
  assert.equal(decideCall(CALL_START, { ...sig(at(10)), contracts: ["k1"], deals: ["d1"] }).ring?.reason, "deal");
  assert.deepEqual(parseCallState(JSON.stringify(r.state)).contracted, ["k1"]);
});
