import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { cleanWhisperText, correctTranscript, finalJoiner, mergeFinals, pickBestAlternative, TURN_LONG_MS, TURN_MS, turnWaitMs } from "../src/components/voice/hear.ts";

test("correctTranscript fixes misheard wake word only at the start before a command", () => {
  assert.equal(correctTranscript("or bit open studio"), "Orbit open studio");
  assert.equal(correctTranscript("a bit, what's the weather"), "a bit, what's the weather"); // room talk must not wake ORBIT
  assert.equal(correctTranscript("hey a bit, what's the weather"), "hey Orbit, what's the weather");
  assert.equal(correctTranscript("is stonia nice"), "is Estonia nice");
  assert.equal(correctTranscript("hey orbital show me the news"), "hey Orbit show me the news");
  assert.equal(correctTranscript("orbital wake up"), "Orbit wake up");
  assert.equal(correctTranscript("a bit"), "a bit"); // overheard "...a bit." must not arm ORBIT
  assert.equal(correctTranscript("a bit more detail please"), "a bit more detail please");
  assert.equal(correctTranscript("orbital mechanics are hard"), "orbital mechanics are hard");
  assert.equal(correctTranscript("explain it a bit better"), "explain it a bit better");
});

test("correctTranscript fixes place words after a nav verb only", () => {
  assert.equal(correctTranscript("open the stereo"), "open the studio");
  assert.equal(correctTranscript("go to intelligent"), "go to intelligence");
  assert.equal(correctTranscript("show me my clip"), "show me my clips");
  assert.equal(correctTranscript("Orbit, open stat."), "Orbit, open stats.");
  assert.equal(correctTranscript("the stereo is loud"), "the stereo is loud");
  assert.equal(correctTranscript("is that intelligent"), "is that intelligent");
  assert.equal(correctTranscript("show me a clip of the game"), "show me a clip of the game");
});

test("correctTranscript fixes Estonia mishearings anywhere", () => {
  assert.equal(correctTranscript("news from a stonia"), "news from Estonia");
  assert.equal(correctTranscript("what is the estonyan weather"), "what is the Estonian weather");
  assert.equal(correctTranscript("go to in telligence"), "go to intelligence");
});

test("pickBestAlternative prefers commands and wake word, else the top alternative", () => {
  assert.equal(pickBestAlternative(["open the studios thing", "open the studio"]), "open the studio");
  assert.equal(pickBestAlternative(["price history what's new", "orbit what's new"]), "price history what's new"); // lower alts never create a wake
  assert.equal(pickBestAlternative(["how much was it", "a bit"]), "how much was it");
  assert.equal(pickBestAlternative(["what's in my studio", "open studio"]), "what's in my studio"); // a question stays a question
  assert.equal(pickBestAlternative(["all right shut town", "all right shut down"]), "all right shut down");
  assert.equal(pickBestAlternative(["what is the time", "what is the thyme"]), "what is the time");
  assert.equal(pickBestAlternative(["germany", "jeremy"], { current: "intelligence" }), "germany");
  assert.equal(pickBestAlternative(["", "  "]), "");
});

test("mergeFinals joins split finals and drops a repeated seam", () => {
  assert.equal(mergeFinals(["what's the weather", "in Tallinn tomorrow"]), "what's the weather in Tallinn tomorrow");
  assert.equal(mergeFinals(["show me the news", "the news from Germany"]), "show me the news from Germany");
  assert.equal(mergeFinals(["very", "very good"]), "very very good"); // one-word overlap is kept: people repeat words
  assert.equal(mergeFinals(["open studio", "open studio"]), "open studio");
  assert.equal(mergeFinals([" ", "hello"]), "hello");
});

test("finalJoiner waits for the grace window and extends it while speech continues", () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    const got: string[] = [];
    const j = finalJoiner(900, (t) => got.push(t), 3000);
    j.add("what's the weather");
    mock.timers.tick(800);
    j.hold(); // interim speech
    mock.timers.tick(800);
    j.add("in Tallinn");
    assert.deepEqual(got, []);
    assert.equal(j.pending, true);
    mock.timers.tick(900);
    assert.deepEqual(got, ["what's the weather in Tallinn"]);
    assert.equal(j.pending, false);
    j.hold(); // nothing pending: no-op
    mock.timers.tick(2000);
    assert.equal(got.length, 1);
    // Never waits past maxMs after the first final, even with constant interim noise.
    j.add("one");
    for (let i = 0; i < 10; i++) { mock.timers.tick(500); j.hold(); }
    assert.deepEqual(got, ["what's the weather in Tallinn", "one"]);
    j.add("dropped"); j.cancel(); mock.timers.tick(2000);
    assert.equal(got.length, 2);
  } finally { mock.timers.reset(); }
});

test("cleanWhisperText strips tags and stock hallucinations", () => {
  assert.equal(cleanWhisperText(" Open the studio."), "Open the studio.");
  assert.equal(cleanWhisperText("[BLANK_AUDIO]"), "");
  assert.equal(cleanWhisperText(" you"), "");
  assert.equal(cleanWhisperText("(music) What's new?"), "What's new?");
  assert.equal(cleanWhisperText("Thank you."), "Thank you.");
});

test("a lower voice guess can't jump to a LIFE tab or start the timer", () => {
  assert.equal(pickBestAlternative(["journal entry for today", "journal"]), "journal entry for today");
  assert.equal(pickBestAlternative(["start focusing on it", "start focusing"]), "start focusing on it");
});

test("ORBIT mic end of turn: short after a finished sentence, long after a trailing word", () => {
  for (const t of ["What's the weather in Tallinn?", "Open studio", "Tell me a joke.", "Yes.", "Orbit, go to sleep"]) assert.equal(turnWaitMs(t, 0), TURN_MS, t);
  for (const t of ["What's the weather and", "Tell me about the, um", "So", "I was thinking that maybe we could, but"]) assert.equal(turnWaitMs(t, 0), TURN_LONG_MS, t);
  assert.equal(turnWaitMs("Tell me a joke.", 600), 0); // the mic already waited 600 ms of quiet: answer now
  assert.equal(turnWaitMs("Tell me about the", 600), TURN_LONG_MS - 600);
});
