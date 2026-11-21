import { test } from "node:test";
import assert from "node:assert/strict";
import { briefingWork, examples, plainError, shortSource, studioWork } from "../src/lib/planet-page-pure.ts";

const NOW = Date.parse("2026-11-21T12:00:00Z");
const job = (o: Record<string, unknown>) => ({ id: "j1", source: "C:\\Users\\a\\Videos\\stream-0412.mp4", createdAt: "2026-11-21T11:50:00Z", updatedAt: "2026-11-21T11:58:00Z",
  status: "transcribing", progress: 0.3, clips: [], ...o });

test("shortSource keeps a name a person recognises", () => {
  assert.equal(shortSource("C:\\Users\\a\\Videos\\stream-0412.mp4"), "stream-0412.mp4");
  assert.equal(shortSource("/home/x/clip.mkv"), "clip.mkv");
  assert.match(shortSource("https://www.youtube.com/watch?v=abc"), /^youtube\.com\/watch/);
  assert.equal(shortSource(""), "a video");
});

test("a running clip job becomes plain steps with time left, no internal names", () => {
  const [p] = studioWork([job({})], [], "en", NOW);
  assert.equal(p.phase, "working");
  assert.equal(p.title, "Shorts from stream-0412.mp4");
  assert.deepEqual(p.steps.map((s) => s.state), ["done", "now", "next", "next"]);
  assert.equal(p.now, "Writing down what's said");
  assert.equal(p.leftMin, 2); // 12 min typical, 10 min in
  assert.ok(!/transcrib|probing|render/i.test(JSON.stringify(p.steps)));
});

test("a finished job says what happened and what to do next, with a Review button that only opens the queue", () => {
  const [p] = studioWork([job({ status: "done", clips: [{ id: "c1", status: "ready" }, { id: "c2", status: "rejected" }] })], [], "en", NOW);
  assert.equal(p.phase, "done");
  assert.match(p.result!.text, /^Made 1 Short\. Next:/);
  assert.equal(p.action?.label, "Review");
  assert.equal(p.action?.kind, "open");
  assert.equal(p.action?.open, "#o=studio&k=review&id=c1");
});

test("old finished jobs drop off; failures say why in plain words; Estonian works", () => {
  assert.equal(studioWork([job({ status: "done", updatedAt: "2026-11-19T10:00:00Z" })], [], "en", NOW).length, 0);
  const [f] = studioWork([job({ status: "failed", error: "spawn ffmpeg ENOENT\n    at x (/home/a/b.js:1)" })], [], "en", NOW);
  assert.equal(f.phase, "failed");
  assert.equal(f.result?.text, "spawn ffmpeg a file is missing");
  assert.equal(f.action?.kind, "retry");
  const [e] = studioWork([job({})], [], "et", NOW);
  assert.equal(e.now, "Kirjutan üles, mida räägitakse");
});

test("downloads in flight show; done ones are left to the clip job", () => {
  const dl = { id: "d1", url: "https://youtu.be/x", status: "downloading", createdAt: "2026-11-21T11:59:00Z" };
  const out = studioWork([], [dl, { ...dl, id: "d2", status: "done" }], "en", NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].now, "Downloading the video");
});

test("briefing job: running, done recently, and stale", () => {
  assert.equal(briefingWork(null, "en", NOW).length, 0);
  assert.equal(briefingWork({ status: "running", started_at: "2026-11-21T11:59:00Z" }, "en", NOW)[0].phase, "working");
  const done = briefingWork({ status: "done", started_at: "2026-11-21T11:00:00Z", finished_at: "2026-11-21T11:03:00Z" }, "en", NOW)[0];
  assert.equal(done.phase, "done");
  assert.match(done.result!.text, /Next: read it/);
  assert.equal(briefingWork({ status: "done", started_at: "2026-11-20T01:00:00Z", finished_at: "2026-11-20T01:03:00Z" }, "en", NOW).length, 0);
});

test("plainError swaps internal names and hides paths", () => {
  assert.equal(plainError("GPU lease timed out", "en"), "the graphics card is busy it took too long");
  assert.equal(plainError("pacer: reserved", "en"), "the daily AI limit: reserved");
  assert.equal(plainError("", "et"), "Ei õnnestunud.");
  assert.ok(!plainError("read C:\\Users\\andre\\x.json failed", "en").includes("andre"));
});

test("examples trims and keeps three", () => {
  assert.deepEqual(examples([" a ", "", "b", "c", "d"]), ["a", "b", "c"]);
});
