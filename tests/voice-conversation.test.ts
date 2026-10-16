import { test } from "node:test";
import assert from "node:assert/strict";
import { conversationBargeIn, convStep, IDLE, isConversationEnd, isConversationStart, SILENCE_MS, THINK_MS, type Conv, type ConvEvent } from "../src/components/voice/conversation.ts";

const run = (events: [ConvEvent, number][], s: Conv = IDLE) => events.reduce((c, [e, t]) => convStep(c, e, t), s);

test("conversation loops listening → thinking → speaking → listening", () => {
  let s = convStep(IDLE, { type: "start", persist: true }, 0);
  assert.equal(s.phase, "listening");
  for (let i = 0; i < 3; i++) {
    s = convStep(s, { type: "ask" }, 1);
    assert.equal(s.phase, "thinking");
    s = convStep(s, { type: "speaking" }, 2);
    assert.equal(s.phase, "speaking");
    s = convStep(s, { type: "done" }, 2);
    s = convStep(s, { type: "spoke" }, 3);
    assert.equal(s.phase, "listening");
  }
  assert.equal(s.asked, 3);
});

test("idle ignores everything but start; stop ends", () => {
  for (const type of ["ask", "speaking", "spoke", "tick", "hearing", "stop"] as const) assert.equal(convStep(IDLE, { type }, 5), IDLE);
  assert.equal(run([[{ type: "start", persist: true }, 0], [{ type: "stop" }, 1]]).phase, "idle");
});

test("30 s of silence while listening ends it; talking or speaking keeps it alive", () => {
  const s = convStep(IDLE, { type: "start", persist: true }, 0);
  assert.equal(convStep(s, { type: "tick" }, SILENCE_MS - 1).phase, "listening");
  assert.equal(convStep(s, { type: "tick" }, SILENCE_MS).phase, "idle");
  assert.equal(run([[{ type: "hearing" }, 20_000], [{ type: "tick" }, SILENCE_MS + 1]], s).phase, "listening");
  assert.equal(run([[{ type: "ask" }, 1], [{ type: "speaking" }, 2], [{ type: "tick" }, 99_000]], s).phase, "speaking"); // long answer
});

test("asked but never spoken (speech off) goes back to listening", () => {
  const s = run([[{ type: "start", persist: true }, 0], [{ type: "ask" }, 0]]);
  assert.equal(convStep(s, { type: "tick" }, THINK_MS - 1).phase, "thinking");
  assert.equal(convStep(s, { type: "tick" }, THINK_MS).phase, "listening");
});

test("one follow-up only: ends after the follow-up's answer", () => {
  const s = run([[{ type: "start", persist: false }, 0], [{ type: "ask" }, 1], [{ type: "speaking" }, 2], [{ type: "done" }, 2], [{ type: "spoke" }, 3]]);
  assert.equal(s.phase, "listening"); // first answer: still listening for the follow-up
  assert.equal(run([[{ type: "ask" }, 4], [{ type: "speaking" }, 5], [{ type: "spoke" }, 6], [{ type: "done" }, 7]], s).phase, "idle");
});

test("start and end phrases", () => {
  for (const t of ["Let's talk", "Orbit, let's talk", "hey orbit lets chat", "conversation mode", "start conversation mode", "Let's have a conversation."])
    assert.equal(isConversationStart(t), true, t);
  for (const t of ["let's talk about Estonia", "what is conversation mode", "talk to me"]) assert.equal(isConversationStart(t), false, t);
  for (const t of ["That's all", "that's all, thanks", "Stop listening", "Goodbye", "Orbit, goodbye", "that's it for now", "end conversation"])
    assert.equal(isConversationEnd(t), true, t);
  for (const t of ["is that all there is", "stop", "goodbye to summer"]) assert.equal(isConversationEnd(t), false, t);
});

test("barge-in needs 2+ words ORBIT didn't just say, and never its echo", () => {
  const spoken = "Tallinn will be sunny with highs around eighteen degrees.";
  assert.equal(conversationBargeIn("what about tomorrow", spoken), true);
  assert.equal(conversationBargeIn("sunny with highs around eighteen", spoken), false); // echo through the speakers
  assert.equal(conversationBargeIn("tomorrow", spoken), false); // one word
  assert.equal(conversationBargeIn("uh um tomorrow", spoken), false); // fillers don't count
  assert.equal(conversationBargeIn("", spoken), false);
});

test("a pause between streamed sentences doesn't reopen listening; stream done + speech ended does", () => {
  const start = run([[{ type: "start", persist: true }, 0], [{ type: "ask" }, 1], [{ type: "speaking" }, 2]]);
  const gap = convStep(start, { type: "spoke" }, 3);
  assert.equal(gap.phase, "thinking"); // CORE still streaming
  const more = run([[{ type: "speaking" }, 4], [{ type: "done" }, 5]], gap);
  assert.equal(more.phase, "speaking"); // done mid-speech: wait for the voice to finish
  assert.equal(convStep(more, { type: "spoke" }, 6).phase, "listening");
  assert.equal(run([[{ type: "done" }, 4]], gap).phase, "listening"); // done after the last sentence was spoken
  assert.equal(run([[{ type: "tick" }, 3 + THINK_MS]], gap).phase, "listening"); // done never came: 20 s fallback
});

test("an interrupted answer's late done doesn't count for the next question; navigation needs no done", () => {
  const s = run([[{ type: "start", persist: true }, 0], [{ type: "ask" }, 1], [{ type: "speaking" }, 2], [{ type: "spoke" }, 3], // barge-in
    [{ type: "ask" }, 4], [{ type: "done" }, 5]]); // old stream ends after the new ask
  assert.equal(convStep(s, { type: "spoke" }, 6).phase, "thinking");
  assert.equal(run([[{ type: "done" }, 7]], s).phase, "listening");
  const nav = run([[{ type: "start", persist: true }, 0], [{ type: "ask", core: false }, 1], [{ type: "speaking" }, 2], [{ type: "spoke" }, 3]]);
  assert.equal(nav.phase, "listening");
});
