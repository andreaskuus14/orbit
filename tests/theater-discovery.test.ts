// THE05 discovery controls and THE08 learning sessions (theater-pure.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_FILTER, addSaved, filterOn, filterVideos, followUps, parseIds, parseSaved, parseSession, removeSaved, sessionMemory, sourceKey, startSession, toggleId } from "../src/lib/theater-pure.ts";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const v = (id: string, p: Partial<{ title: string; channel: string; publishedAt: string; durationSec: number }> = {}) =>
  ({ id, title: "A video", channel: "Jynxzi", publishedAt: "2026-10-29T12:00:00Z", durationSec: 600, ...p });
const A = v("aaaaaaaaaaa", { title: "Rainbow Six ranked", durationSec: 120 }), B = v("bbbbbbbbbbb", { channel: "Other", publishedAt: "2026-01-01T00:00:00Z", durationSec: 3000 }), C = v("ccccccccccc");

test("THE05: filters by creator, topic, date, duration; hides and watched", () => {
  const all = [A, B, C], none = new Set<string>();
  assert.equal(filterVideos(all, NO_FILTER, [], none, NOW).length, 3);
  assert.deepEqual(filterVideos(all, { ...NO_FILTER, creator: "jynx" }, [], none, NOW).map((x) => x.id), [A.id, C.id]);
  assert.deepEqual(filterVideos(all, { ...NO_FILTER, topic: "RANKED" }, [], none, NOW).map((x) => x.id), [A.id]);
  assert.deepEqual(filterVideos(all, { ...NO_FILTER, since: "week" }, [], none, NOW).map((x) => x.id), [A.id, C.id]);
  assert.deepEqual(filterVideos(all, { ...NO_FILTER, dur: "short" }, [], none, NOW).map((x) => x.id), [A.id]);
  assert.deepEqual(filterVideos(all, { ...NO_FILTER, dur: "medium" }, [], none, NOW).map((x) => x.id), [C.id]);
  assert.deepEqual(filterVideos(all, { ...NO_FILTER, dur: "long" }, [], none, NOW).map((x) => x.id), [B.id]);
  assert.deepEqual(filterVideos(all, NO_FILTER, [B.id], none, NOW).map((x) => x.id), [A.id, C.id]);
  assert.deepEqual(filterVideos(all, { ...NO_FILTER, watched: false }, [], new Set([A.id]), NOW).map((x) => x.id), [B.id, C.id]);
  assert.equal(filterOn(NO_FILTER), false);
  assert.equal(filterOn({ ...NO_FILTER, watched: false }), true);
});

test("THE05: saved searches and hidden ids are validated", () => {
  let s = addSaved([], { name: "R6 short", kind: "topic", q: "Rainbow Six", filter: { ...NO_FILTER, dur: "short" } });
  s = addSaved(s, { name: "r6 SHORT", kind: "topic", q: "R6", filter: NO_FILTER });
  assert.equal(s.length, 1);
  assert.equal(s[0].q, "R6");
  assert.deepEqual(parseSaved([{ name: "x", kind: "bad", q: "y" }, null, { name: "ok", kind: "creator", q: "Jynxzi", filter: { since: "nope", dur: "long" } }]),
    [{ name: "ok", kind: "creator", q: "Jynxzi", filter: { creator: "", topic: "", since: "", dur: "long", watched: true } }]);
  assert.equal(removeSaved(s, "r6 short").length, 0);
  const full = Array.from({ length: 12 }, (_, i) => ({ name: `s${i}`, kind: "topic" as const, q: "q", filter: NO_FILTER })).reduce(addSaved, []);
  assert.equal(addSaved(full, { name: "13th", kind: "topic", q: "q", filter: NO_FILTER }), full);
  assert.deepEqual(parseIds(["bad", A.id, A.id]), [A.id]);
  assert.deepEqual(toggleId(toggleId([], A.id), A.id), []);
});

test("THE05: source explanation per feed", () => {
  assert.deepEqual(sourceKey("topic", "cs2", "new"), { key: "thr.src.topic", q: "cs2", sort: "new" });
  assert.equal(sourceKey(undefined, "Jynxzi", undefined).key, "thr.src.creator");
  assert.equal(sourceKey("trending", "", "viral").key, "thr.src.trending");
});

test("THE08: a session from the queue → one MEMORY entry with questions, notes and end notes; follow-ups for LIFE", () => {
  assert.equal(startSession("x", [A as never], NOW), "Name what you're learning");
  assert.equal(startSession("Lighting", [], NOW), "Queue some videos first");
  const s = startSession("  Daylight   design ", [{ id: A.id, title: A.title, channel: A.channel }, { id: "bad", title: "x", channel: "" }], NOW - 30 * 60_000);
  assert.ok(typeof s !== "string");
  assert.equal(s.topic, "Daylight design");
  assert.equal(s.playlist.length, 1);
  assert.deepEqual(parseSession(JSON.parse(JSON.stringify(s))), s);
  assert.equal(parseSession({ topic: 1 }), null);
  const notes = [
    { id: A.id, t: 75, text: "Why north light?", kind: "question" as const, at: NOW - 10_000 },
    { id: A.id, t: 90, text: "Clerestory trick", kind: "note" as const, at: NOW - 5_000 },
    { id: A.id, t: 5, text: "old note", kind: "note" as const, at: NOW - 3_600_000 }, // before the session
    { id: B.id, t: 5, text: "other video", kind: "note" as const, at: NOW - 1000 },
  ];
  const m = sessionMemory(s, notes, "North light is even.", NOW);
  assert.match(m.content, /Why north light\? \(1:15 in “Rainbow Six ranked”/);
  assert.match(m.content, /Clerestory trick/);
  assert.doesNotMatch(m.content, /old note|other video/);
  assert.match(m.content, /End notes:\nNorth light is even\./);
  assert.match(m.content, /30 min/);
  assert.deepEqual(m.tags, ["theater", "learning", `yt:${A.id}`]);
  assert.match(sessionMemory(s, [], "", NOW).content, /Questions: none captured\.[\s\S]*End notes: none written\./);
  assert.deepEqual(followUps("- Sketch a section\n\n2) read Baker ch. 3\nok\n- Sketch a section\n" + "x\n".repeat(3) + "aa1\naa2\naa3\naa4\naa5\naa6"), ["Sketch a section", "read Baker ch. 3", "aa1", "aa2", "aa3"]);
});
