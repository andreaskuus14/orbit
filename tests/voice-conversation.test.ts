import { test } from "node:test";
import assert from "node:assert/strict";
import { CAP_MS, convStep, IDLE, IDLE_MS, startsConversation, isAddressedToOrbit, isConversationEnd, isConversationStart, SILENCE_MS, THINK_MS, type Conv, type ConvEvent } from "../src/components/voice/conversation.ts";

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

test("stay mode is open mic: ends after 5 min without a question; room talk doesn't keep it alive", () => {
  const s = convStep(IDLE, { type: "start", persist: true }, 0);
  assert.equal(convStep(s, { type: "tick" }, IDLE_MS - 1).phase, "listening");
  assert.equal(convStep(s, { type: "tick" }, IDLE_MS).phase, "idle");
  assert.equal(run([[{ type: "hearing" }, IDLE_MS - 10], [{ type: "tick" }, IDLE_MS]], s).phase, "idle"); // a TV talking
  const answered = run([[{ type: "ask" }, 60_000], [{ type: "speaking" }, 61_000], [{ type: "done" }, 62_000], [{ type: "spoke" }, 70_000]], s);
  assert.equal(convStep(answered, { type: "tick" }, 60_000 + IDLE_MS - 1).phase, "listening"); // the clock restarts at each question
  assert.equal(convStep(answered, { type: "tick" }, 60_000 + IDLE_MS).phase, "idle"); // …not when ORBIT finishes speaking
  // Other speakers (nav replies, "I'm listening.") flip phases and reset `since`; they mustn't hold the mic open.
  const chatter = run([[{ type: "speaking" }, IDLE_MS - 5], [{ type: "spoke" }, IDLE_MS - 1]], s);
  assert.equal(convStep(chatter, { type: "tick" }, IDLE_MS).phase, "idle");
  const stuck = run([[{ type: "ask" }, 0], [{ type: "speaking" }, 1]], s); // speaking that never ends
  assert.equal(convStep(stuck, { type: "tick" }, CAP_MS - 1).phase, "speaking");
  assert.equal(convStep(stuck, { type: "tick" }, CAP_MS).phase, "idle");
});

test("one-follow-up mode: 30 s of silence while listening ends it; talking or speaking keeps it alive", () => {
  const s = convStep(IDLE, { type: "start", persist: false }, 0);
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
  for (const t of ["Let's talk", "Orbit, let's talk", "hey orbit lets chat", "conversation mode", "start conversation mode", "Let's have a conversation.", "let's just talk", "Lets just talk.", "Orbit, let's just chat for a bit", "stay listening", "keep listening", "open mic", "let's keep talking"])
    assert.equal(isConversationStart(t), true, t);
  for (const t of ["let's talk about Estonia", "what is conversation mode", "talk to me"]) assert.equal(isConversationStart(t), false, t);
  assert.equal(startsConversation("let's just talk", false), true); // no "Orbit" needed with "just"
  assert.equal(startsConversation("let's talk", false), false); // a TV line
  assert.equal(startsConversation("Orbit, let's talk", true), true);
  for (const t of ["That's all", "that's all, thanks", "Stop listening", "Goodbye", "bye", "Orbit, goodbye", "that's it for now", "end conversation", "we're done", "that'll be all", "bye bye", "that's enough", "no, that's all", "ok thanks, bye", "stop listening please"])
    assert.equal(isConversationEnd(t), true, t);
  for (const t of ["is that all there is", "stop", "goodbye to summer"]) assert.equal(isConversationEnd(t), false, t);
});

test("open mic answers what's meant for ORBIT and ignores filler and room talk", () => {
  for (const t of ["what's the weather tomorrow", "so how far is Tallinn", "can you open my studio", "tell me a joke", "remind me to call mom",
    "search for Roblox news", "is it going to rain?", "it's going to rain?", "I want a summary of my week", "orbit I'm bored", "help", "open studio", "go to sleep"])
    assert.equal(isAddressedToOrbit(t), true, t);
  for (const t of ["yeah", "ok", "okay thanks", "uh um", "", "it's cold in here", "I was at the shop earlier", "yeah yeah sure", "mm hmm",
    "have a good one", "don't do that", "can't believe it", "tell him I said hi", "turn left here"])
    assert.equal(isAddressedToOrbit(t), false, t);
  assert.equal(isAddressedToOrbit("yes", {}, true), true); // ORBIT just asked "Want me to open it?"
  assert.equal(isAddressedToOrbit("uh", {}, true), false);
  assert.equal(isAddressedToOrbit("no I was telling my brother about the trip we took last summer", {}, true), false); // long: room talk
  for (const t of ["next", "more", "louder", "repeat that", "please summarize it", "summarize it please", "can you repeat"]) assert.equal(isAddressedToOrbit(t), true, t);
});

test("a pause between streamed sentences doesn't reopen listening; stream done + speech ended does", () => {
  const start = run([[{ type: "start", persist: true }, 0], [{ type: "ask" }, 1], [{ type: "speaking" }, 2]]);
  const gap = convStep(start, { type: "spoke" }, 3);
  assert.equal(gap.phase, "thinking"); // CORE still streaming
  const more = run([[{ type: "speaking" }, 4], [{ type: "done" }, 5]], gap);
  assert.equal(more.phase, "speaking"); // done mid-speech: wait for the voice to finish
  assert.equal(convStep(more, { type: "spoke" }, 6).phase, "listening");
  assert.equal(run([[{ type: "done" }, 4]], gap).phase, "listening"); // done after the last sentence was spoken
  assert.equal(run([[{ type: "tick" }, 3 + THINK_MS]], gap).phase, "listening"); // done never came: fallback
});

test("an interrupted answer's late done doesn't count for the next question; navigation needs no done", () => {
  const s = run([[{ type: "start", persist: true }, 0], [{ type: "ask" }, 1], [{ type: "speaking" }, 2], [{ type: "spoke" }, 3], // barge-in
    [{ type: "ask" }, 4], [{ type: "done" }, 5]]); // old stream ends after the new ask
  assert.equal(convStep(s, { type: "spoke" }, 6).phase, "thinking");
  assert.equal(run([[{ type: "done" }, 7]], s).phase, "listening");
  const nav = run([[{ type: "start", persist: true }, 0], [{ type: "ask", core: false }, 1], [{ type: "speaking" }, 2], [{ type: "spoke" }, 3]]);
  assert.equal(nav.phase, "listening");
});
