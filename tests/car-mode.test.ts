import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CAR_CHARS, MAX_READ, briefSpeech, carOrder, markLater, speechParts, trimSpeech, waitingSpeech, type CarItem } from "../src/lib/car-mode-pure.ts";
import { voiceDecision, type CallItem } from "../src/lib/call-pure.ts";

const it = (id: string, kind: CarItem["kind"], title = id): CarItem => ({ id, kind, title });

test("carOrder: emails and replies first, then spends, then clips; stable within a kind", () => {
  const out = carOrder([it("c1", "clip"), it("s1", "spend"), it("e1", "send"), it("c2", "clip"), it("n1", "nego"), it("e2", "send")]);
  assert.deepEqual(out.map((x) => x.id), ["e1", "e2", "n1", "s1", "c1", "c2"]);
});

test("waitingSpeech: titles only, ordered, capped, and returns the ids it read", () => {
  assert.deepEqual(waitingSpeech([]), { text: "Nothing's waiting for you.", ids: [] });
  const one = waitingSpeech([{ ...it("a", "send", "Follow-up for **Kalev Bakery**"), to: "kalev@example.com", message: "SECRET BODY" } as CarItem]);
  assert.match(one.text, /^One thing is waiting\. One: an email, Follow-up for Kalev Bakery\./);
  assert.doesNotMatch(one.text, /SECRET|kalev@|\*/);
  assert.match(one.text, /review later.*on screen/);
  const many = Array.from({ length: 8 }, (_, i) => it(`c${i}`, "clip", `Clip ${i}`)).concat(it("s", "spend", "Story"));
  const w = waitingSpeech(many);
  assert.equal(w.ids.length, MAX_READ);
  assert.equal(w.ids[0], "s");
  assert.match(w.text, /^9 things are waiting\. One: a Higgsfield spend, Story\./);
  assert.match(w.text, /And 4 more\./);
});

test("trimSpeech: strips markdown/links and cuts at a sentence end", () => {
  assert.equal(trimSpeech("**Hi** [there](http://x.y) 🚗"), "Hi there");
  const long = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
  const t = trimSpeech(long);
  assert.ok(t.length <= MAX_CAR_CHARS);
  assert.match(t, /here\.$/);
  const word = trimSpeech("word ".repeat(400).trim(), 50);
  assert.ok(word.length <= 51 && word.endsWith("…"));
});

test("briefSpeech: off, failure, empty and normal", () => {
  assert.match(briefSpeech(null), /couldn't get the brief/);
  assert.match(briefSpeech({ off: true }), /turned off/);
  assert.equal(briefSpeech({ greeting: "Good morning", spoken: "" }), "Good morning. Nothing needs you right now.");
  assert.equal(briefSpeech({ greeting: "x", spoken: "Two clips are ready. Dentist at ten." }), "Two clips are ready. Dentist at ten.");
});

test("speechParts: one sentence per utterance", () => {
  assert.deepEqual(speechParts("One thing is waiting. One: a clip, Cats. Done."), ["One thing is waiting.", "One: a clip, Cats.", "Done."]);
});

test("markLater: adds what was read, drops what's no longer waiting", () => {
  assert.deepEqual(markLater(["old", "a"], ["a", "b"], ["a", "b", "c"]), ["a", "b"]);
});

test("voiceDecision in car mode: never approves or rejects, even after a yes", () => {
  const items: CallItem[] = [{ id: "x", kind: "send", title: "Kalev", seen: "1", to: "Kalev" }, { id: "y", kind: "clip", title: "Cats", seen: "1", thumb: true }];
  for (const said of ["approve the email", "send it", "approve the clip", "reject the clip", "spend the credits"]) {
    const d = voiceDecision(null, said, items, 0, true);
    assert.ok(d && !d.act && !d.pending, said);
    assert.match(d!.say!, /on screen later/);
  }
  assert.equal(voiceDecision(null, "yes", items, 0, true), null);
  assert.equal(voiceDecision(null, "what's the weather", items, 0, true), null);
  assert.ok(voiceDecision(null, "approve the email", items, 0)?.pending, "outside car mode it still asks to confirm");
});
