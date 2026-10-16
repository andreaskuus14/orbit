import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { endpointDelay, ENDPOINT_LONG_MS, ENDPOINT_MS, finalJoiner, isEcho, shouldBargeIn, STOP_WORDS } from "../src/components/voice/hear.ts";

test("endpointDelay waits longer for unfinished or very short utterances", () => {
  assert.equal(endpointDelay("Orbit what's the weather in Tallinn"), ENDPOINT_MS);
  assert.equal(endpointDelay("Orbit what's the weather and"), ENDPOINT_LONG_MS);
  assert.equal(endpointDelay("Orbit open studio"), ENDPOINT_MS); // short complete command: no long wait
  assert.equal(endpointDelay("tell me about the history of"), ENDPOINT_LONG_MS);
  assert.equal(endpointDelay("open my studio um"), ENDPOINT_LONG_MS);
  assert.equal(endpointDelay("Orbit, show me"), ENDPOINT_LONG_MS); // <3 words after the wake word
  assert.equal(endpointDelay("Orbit"), ENDPOINT_LONG_MS);
  assert.equal(endpointDelay("what is my schedule today"), ENDPOINT_MS);
  assert.equal(endpointDelay("is it going to rain"), ENDPOINT_MS); // "rain" isn't "in"
});

test("isEcho: mostly ORBIT's own words is echo; the user's own words are not", () => {
  const spoken = "Tallinn will be cloudy today with a high of twelve degrees and light rain in the evening.";
  assert.equal(isEcho("cloudy today with a high of twelve", spoken), true);
  assert.equal(isEcho("light rain in the evening", spoken), true);
  assert.equal(isEcho("what about tomorrow in Tartu", spoken), false);
  assert.equal(isEcho("uh a", spoken), true); // nothing word-like: never a reason to act
});

test("STOP_WORDS: whole-utterance stop phrases, with or without the wake word", () => {
  for (const t of ["stop", "Stop.", "orbit stop", "Orbit, stop", "hey orbit stop", "wait", "shut up", "be quiet", "stop talking", "please stop"]) assert.ok(STOP_WORDS.test(t), t);
  for (const t of ["stop the timer", "wait until tomorrow", "don't stop"]) assert.ok(!STOP_WORDS.test(t), t);
});

test("shouldBargeIn: only a stop phrase or the wake word, never noise, other speech or echo", () => {
  const spoken = "Here is the news for today. The orbit of the new satellite was adjusted, and you should wait for updates.";
  assert.equal(shouldBargeIn("stop", spoken), "stop");
  assert.equal(shouldBargeIn("orbit stop", spoken), "stop");
  assert.equal(shouldBargeIn("be quiet", spoken), "stop");
  assert.equal(shouldBargeIn("Orbit what's the weather tomorrow", spoken), "wake");
  assert.equal(shouldBargeIn("can you pass me the salt", spoken), null); // room talk
  assert.equal(shouldBargeIn("mm hmm", spoken), null); // noise
  assert.equal(shouldBargeIn("the news for today", spoken), null); // echo
  assert.equal(shouldBargeIn("orbit of the new satellite", spoken), null); // echo that happens to start with "orbit"
  assert.equal(shouldBargeIn("wait", spoken), null); // ORBIT itself just said "wait"
  assert.equal(shouldBargeIn("wait", "Here is the news for today."), "stop");
});

test("finalJoiner with endpointDelay: a thinking pause after 'and' doesn't end the question; interim keeps it open", () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    const got: string[] = [];
    const j = finalJoiner(endpointDelay, (t) => got.push(t));
    j.add("Orbit what's the weather in Tallinn and");
    mock.timers.tick(2000); // 900 ms used to send it here
    assert.deepEqual(got, []);
    j.hold("what about"); // interim words count as still talking
    mock.timers.tick(2000);
    j.add("what about Tartu tomorrow");
    mock.timers.tick(1400);
    assert.deepEqual(got, []);
    mock.timers.tick(200);
    assert.deepEqual(got, ["Orbit what's the weather in Tallinn and what about Tartu tomorrow"]);
    // Words still only interim when the silence timer fires are kept, not dropped.
    j.add("Orbit open my calendar for");
    j.hold("next week");
    mock.timers.tick(ENDPOINT_MS);
    assert.equal(got[1], "Orbit open my calendar for next week");
  } finally { mock.timers.reset(); }
});

test("D1: a real 'Orbit …' question sharing ORBIT's topic words is not echo", () => {
  const spoken = "The weather today is cloudy.";
  assert.equal(shouldBargeIn("Orbit what's the weather", spoken), "wake");
  assert.equal(isEcho("Orbit what's the weather", spoken), false); // also in the post-speech tail filter
  assert.equal(shouldBargeIn("Orbit what's the weather", "Ask me: Orbit what's the weather."), null); // ORBIT said it itself
  assert.equal(isEcho("the weather is", spoken), true); // "the"/"is" don't count; "weather" does
});

test("D2: stop phrases are judged only against what ORBIT is saying now", () => {
  assert.equal(shouldBargeIn("wait", "Here is the forecast. It will rain."), "stop");
  assert.equal(shouldBargeIn("no", "No, that's not right."), null);
  assert.equal(shouldBargeIn("no", ""), "stop"); // after stop() the recent text is empty
});

test("endpointDelay: complete commands get the short delay", () => {
  for (const t of ["zoom in", "zoom out", "reset zoom", "Orbit zoom in", "open studio", "Orbit, shut down"]) assert.equal(endpointDelay(t), ENDPOINT_MS, t);
  assert.equal(endpointDelay("Orbit open the"), ENDPOINT_LONG_MS);
});
