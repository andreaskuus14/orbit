import { test } from "node:test";
import assert from "node:assert/strict";
import { candidate, claimMatches, clock, dequeue, embedParams, enqueue, groundedAnswer, noteMemory, noteMoment, parsePositions, parseQueue, parseSeek, parseTranscript, playerError, resumeAt, seekTarget, setPosition } from "../src/lib/theater-pure.ts";
import { parseWatchControl } from "../src/lib/watch-pure.ts";

const V = { id: "dQw4w9WgXcQ", title: "Clip", publishedAt: "", views: 0, durationSec: 600, thumb: "", channel: "Rick", at: 1 };
const W = { ...V, id: "abcdefghijk", at: 2 };

test("THE01 queue keeps order, dedupes, survives junk", () => {
  let q = enqueue(enqueue(enqueue([], V), W), V);
  assert.deepEqual(q.map((x) => x.id), [V.id, W.id]);
  assert.deepEqual(parseQueue(JSON.parse(JSON.stringify(q))).map((x) => x.id), [V.id, W.id]);
  assert.deepEqual(parseQueue([null, { id: "bad" }, "x"]), []);
  q = dequeue(q, V.id);
  assert.deepEqual(q.map((x) => x.id), [W.id]);
});

test("THE01 positions: resume mid-video only, no autoplay on restore", () => {
  let p = setPosition({}, V.id, 125.7, 600, 1);
  assert.equal(resumeAt(p, V.id), 125);
  assert.equal(resumeAt(setPosition(p, V.id, 590, 600, 2), V.id), 0); // finished
  assert.equal(resumeAt(setPosition(p, V.id, 3, 600, 2), V.id), 0);
  p = parsePositions({ [V.id]: { t: 50, at: 1 }, nope: { t: 5, at: 1 }, [W.id]: { t: "x", at: 1 } });
  assert.deepEqual(Object.keys(p), [V.id]);
  assert.deepEqual(parsePositions([1]), {});
  const e = embedParams("https://o", 125, false);
  assert.equal(e.get("autoplay"), "0");
  assert.equal(e.get("start"), "125");
  assert.equal(embedParams("https://o", 0, true).get("start"), null);
});

test("THE02 note memory carries the moment and outlives the video", () => {
  const m = noteMemory(V, 83, " great  angle ", "question")!;
  assert.equal(m.title, "Question at 1:23: Clip");
  assert.match(m.content, /great angle/);
  assert.match(m.content, /watch\?v=dQw4w9WgXcQ&t=83s/);
  assert.deepEqual(noteMoment(m.tags), { id: V.id, t: 83 });
  assert.equal(noteMemory(V, 1, "  ", "note"), null);
  assert.equal(noteMemory({ ...V, id: "x" }, 1, "hi", "note"), null);
  assert.equal(noteMoment(["theater"]), null);
  assert.equal(clock(3725), "1:02:05");
});

test("THE03 answers only from the transcript", () => {
  assert.deepEqual(groundedAnswer([], "what about the smoke?", 600), { status: "none", hits: [], covered: 0 });
  const segs = parseTranscript("0:05 welcome back\n1:10 now the smoke\nlands on site\n[2:30] rotate to B\n");
  assert.equal(segs.length, 3);
  assert.equal(segs[1].text, "now the smoke lands on site");
  const a = groundedAnswer(segs, "where does the smoke land?", 600);
  assert.equal(a.status, "partial"); // transcript ends at 2:30 of a 10-minute video
  assert.equal(a.hits[0].t, 70);
  assert.equal(groundedAnswer(segs, "zebra", 160).hits.length, 0);
  assert.equal(groundedAnswer(segs, "rotate", 160).status, "full");
  assert.ok(claimMatches(segs, 72) && !claimMatches(segs, 100));
});

test("THE04 seek commands vs discussion", () => {
  assert.equal(parseSeek("go back 30 seconds"), "-30");
  assert.equal(parseSeek("skip ahead a minute"), "+60");
  assert.equal(parseSeek("rewind ten seconds."), "-10");
  assert.equal(parseSeek("10 seconds back"), "-10");
  assert.equal(parseSeek("go to 2:30"), "=150");
  assert.equal(parseSeek("start over"), "=0");
  for (const d of ["why did he go back to base", "30 seconds", "that was ten seconds of nothing", "pause"]) assert.equal(parseSeek(d), null, d);
  assert.equal(parseWatchControl("why did he pause there"), null);
  assert.equal(seekTarget("-30", 10, 600), 0);
  assert.equal(seekTarget("+60", 580, 600), 599);
  assert.equal(seekTarget("=150", 0, 600), 150);
});

test("THE06 candidate: validated, rights unset, one key per range", () => {
  const c = candidate(V.id, 60, 90, "Short about the clutch");
  assert.ok(typeof c !== "string");
  if (typeof c === "string") return;
  assert.equal(c.key, `${V.id}:60-90`);
  assert.match(c.permission, /1:00–1:30/);
  assert.match(c.permission, /not recorded/);
  assert.ok(c.permission.length <= 300);
  const long = candidate(V.id, 0, 10, "x".repeat(500));
  assert.ok(typeof long !== "string" && long.permission.length <= 300 && /not recorded/.test(long.permission));
  assert.equal(typeof candidate(V.id, 90, 60, "why"), "string");
  assert.equal(typeof candidate(V.id, 0, 10, " "), "string");
  assert.equal(typeof candidate("bad", 0, 10, "why"), "string");
});

test("THE07 player errors", () => {
  assert.equal(playerError(150), "embedDisabled");
  assert.equal(playerError(101), "embedDisabled");
  assert.equal(playerError(100), "removed");
  assert.equal(playerError(2), "invalid");
  assert.equal(playerError(undefined), "network");
});
