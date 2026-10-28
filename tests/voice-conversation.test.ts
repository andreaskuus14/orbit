import { test } from "node:test";
import assert from "node:assert/strict";
import { CAP_MS, convStep, IDLE, startsConversation, isAddressedToOrbit, isConversationEnd, isConversationStart, SILENCE_MS, THINK_MS, type Conv, type ConvEvent } from "../src/components/voice/conversation.ts";

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
  for (const type of ["ask", "speaking", "spoke", "tick", "hearing", "stop", "barge"] as const) assert.equal(convStep(IDLE, { type }, 5), IDLE);
  assert.equal(run([[{ type: "start", persist: true }, 0], [{ type: "stop" }, 1]]).phase, "idle");
});

test("60 s of silence while listening ends it in either mode; talking or speaking keeps it alive", () => {
  for (const persist of [true, false]) {
    const s = convStep(IDLE, { type: "start", persist }, 0);
    assert.equal(convStep(s, { type: "tick" }, SILENCE_MS - 1).phase, "listening");
    assert.equal(convStep(s, { type: "tick" }, SILENCE_MS).phase, "idle");
    assert.equal(run([[{ type: "hearing" }, 50_000], [{ type: "tick" }, SILENCE_MS + 1]], s).phase, "listening"); // mid-question
    assert.equal(run([[{ type: "ask" }, 1], [{ type: "speaking" }, 2], [{ type: "tick" }, 99_000]], s).phase, "speaking"); // long answer
    const answered = run([[{ type: "ask" }, 1], [{ type: "speaking" }, 2], [{ type: "done" }, 3], [{ type: "spoke" }, 50_000]], s);
    assert.equal(convStep(answered, { type: "tick" }, 50_000 + SILENCE_MS - 1).phase, "listening"); // the clock starts when ORBIT stops
  }
});

test("30 min without a question ends it in any phase (a TV talking, a stuck speaking)", () => {
  const s = convStep(IDLE, { type: "start", persist: true }, 0);
  let tv = s;
  for (let t = 30_000; t < CAP_MS; t += 30_000) tv = run([[{ type: "hearing" }, t], [{ type: "tick" }, t]], tv);
  assert.equal(tv.phase, "listening");
  assert.equal(convStep(tv, { type: "tick" }, CAP_MS).phase, "idle");
  const stuck = run([[{ type: "ask" }, 0], [{ type: "speaking" }, 1]], s);
  assert.equal(convStep(stuck, { type: "tick" }, CAP_MS - 1).phase, "speaking");
  assert.equal(convStep(stuck, { type: "tick" }, CAP_MS).phase, "idle");
});

test("barge-in: talking over ORBIT goes straight back to listening, even while CORE still streams", () => {
  const speaking = run([[{ type: "start", persist: true }, 0], [{ type: "ask" }, 1], [{ type: "speaking" }, 2]]);
  const cut = run([[{ type: "spoke" }, 3], [{ type: "barge" }, 3]], speaking); // stop() → spoke, then barge
  assert.equal(cut.phase, "listening");
  assert.equal(cut.streams, 1);
  const next = run([[{ type: "ask" }, 4], [{ type: "done" }, 5]], cut); // the silenced stream ends after the new ask
  assert.equal(next.phase, "thinking");
  assert.equal(run([[{ type: "done" }, 6]], next).phase, "listening");
  assert.equal(convStep(convStep(IDLE, { type: "start", persist: true }, 0), { type: "barge" }, 1).since, 0); // listening: no-op
  assert.equal(convStep(IDLE, { type: "barge" }, 1), IDLE);
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
  for (const t of ["That's all", "that's all, thanks", "Stop listening", "Goodbye", "bye", "Orbit, goodbye", "that's it for now", "end conversation", "we're done", "that'll be all", "bye bye", "that's enough", "no, that's all", "ok thanks, bye", "stop listening please", "stop", "Orbit, stop", "Stop.", "lõpeta", "Lõpeta!", "lõpetame", "lõpeta vestlus", "aitab küll"])
    assert.equal(isConversationEnd(t), true, t);
  for (const t of ["is that all there is", "stop talking", "stop the timer", "lõpeta see ülesanne", "goodbye to summer"]) assert.equal(isConversationEnd(t), false, t);
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
