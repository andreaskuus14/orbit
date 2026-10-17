import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STATE_V, addFeedback, baseEdit, buildAss, downloadProblem, isClipId, jobProblem, matchUpload, nextVersionId, packAnalysis, parseAnalysis, parseSuggestion,
  listedQuarantine, quarantineName, reconcileOutcome, setRejectReason, uploadsFrom, validVersion, versionSpan,
} from "../src/lib/clips/pure.ts";
import { rootClipId } from "../src/lib/clips/format.ts";

const clip = (id = "clip-1", extra = {}) => ({ id, start: 10, end: 40, title: "t", hook: "h", reason: "r", score: 0.8, status: "ready", ...extra });
const job = (extra = {}) => ({ v: 1, id: "lq3k2a-abc123", source: "a.mp4", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
  status: "done", progress: 1, step: "done", warnings: [], clips: [clip()], options: { count: 5, maxSec: 45, captions: true }, ...extra });

test("jobProblem accepts current and legacy jobs, names what's wrong otherwise", () => {
  assert.equal(jobProblem(job(), "lq3k2a-abc123"), "");
  assert.equal(jobProblem(job({ v: undefined })), "", "files from before versioning still load");
  assert.equal(jobProblem(job({ clips: [clip(), clip("clip-1-v2", { variantOf: "clip-1", publish: { status: "unknown", at: "x" } })] })), "");
  assert.match(jobProblem(job({ v: STATE_V + 1 })), /newer ORBIT/);
  assert.match(jobProblem(job(), "lq3k2a-ffffff"), /doesn't match/);
  assert.match(jobProblem(job({ status: "exploded" })), /status/);
  assert.match(jobProblem(job({ clips: [clip(), { id: "clip-2", start: "x" }] })), /clip 2/);
  assert.match(jobProblem(job({ clips: [clip("clip-1", { publish: { status: "weird" } })] })), /clip 1/);
  assert.match(jobProblem(job({ warnings: [1] })), /warnings/);
  assert.match(jobProblem(job({ options: null })), /options/);
  assert.match(jobProblem([]), /object/);
  assert.match(jobProblem(null), /object/);
});

test("downloadProblem checks the fields the queue relies on", () => {
  const d = { v: 1, id: "dl-lq3k2a-abc123", url: "https://youtu.be/x", status: "done", progress: 1, step: "Downloaded", createdAt: "x", permission: "" };
  assert.equal(downloadProblem(d, "dl-lq3k2a-abc123"), "");
  assert.match(downloadProblem({ ...d, parts: [3] }), /parts/);
  assert.match(downloadProblem({ ...d, status: "?" }), /status/);
  assert.match(downloadProblem({ ...d, id: "nope" }), /id/);
});

test("quarantineName is unique per moment and keeps .json", () => {
  const n = quarantineName("lq3k2a-abc123", new Date("2026-10-16T08:09:10.123Z"));
  assert.equal(n, "lq3k2a-abc123.2026-10-16T08-09-10-123Z.json");
  assert.ok(!/[:\\/]/.test(n), "valid Windows file name");
});

test("listedQuarantine shows set-aside state files only: not reasons, not the self-rebuilding insights cache", () => {
  assert.equal(listedQuarantine("lq3k2a-abc123.2026-10-16T08-09-10-123Z.json"), true);
  assert.equal(listedQuarantine("scout.2026-10-16T08-09-10-123Z.json"), true);
  assert.equal(listedQuarantine("lq3k2a-abc123.2026-10-16T08-09-10-123Z.reason.json"), false);
  assert.equal(listedQuarantine("insights.2026-10-17T12-53-46-849Z.json"), false);
  assert.equal(listedQuarantine("notes.txt"), false);
});

test("analysis round-trips through JSON, rounded; damaged files read as null", () => {
  const a = packAnalysis({ duration: 100, hasAudio: true, spans: [{ start: 0, end: 100 }], words: [{ start: 1.23456, end: 1.5, text: "hi", loud: true }],
    rms: [0.123456789, 0], cands: [{ start: 0, end: 15, score: 1 }], moments: [{ start: 0, end: 20, title: "t", hook: "h", reason: "r", score: 0.9 }] });
  const b = parseAnalysis(JSON.stringify(a));
  assert.ok(b);
  assert.deepEqual(b.words, [{ start: 1.235, end: 1.5, text: "hi" }]);
  assert.deepEqual(b.rms, [0.12346, 0]);
  assert.equal(b.moments[0].score, 0.9);
  assert.equal(b.cands.length, 1);
  assert.equal(parseAnalysis("{trunc"), null);
  assert.equal(parseAnalysis(JSON.stringify({ ...a, v: 2 })), null);
  assert.equal(parseAnalysis(JSON.stringify({ ...a, words: [{ start: "a" }] })), null);
  assert.equal(parseAnalysis(JSON.stringify({ ...a, rms: [null] })), null);
});

test("validVersion: options checked, nudges clamped to ±10 s, text cleaned", () => {
  assert.deepEqual(validVersion({}), { edit: {}, hook: undefined, title: undefined, dStart: 0, dEnd: 0, suggest: false });
  const v = validVersion({ layout: "split", camSide: "left", captions: "classic", jumpCuts: false, start: -25, end: 3.5, hook: "one two three four five six seven", title: "  a   b ", suggest: true });
  assert.ok(typeof v !== "string");
  assert.deepEqual(v.edit, { layout: "split", camSide: "left", captions: "classic", jumpCuts: false });
  assert.equal(v.dStart, -10);
  assert.equal(v.dEnd, 3.5);
  assert.equal(v.hook, "one two three four five six");
  assert.equal(v.title, "a b");
  assert.equal(v.suggest, true);
  assert.equal((validVersion({ hook: "" }) as { hook: string }).hook, "", "empty hook = no hook");
  assert.match(validVersion({ captions: "fancy" }) as string, /captions/);
  assert.match(validVersion({ layout: "wide" }) as string, /layout/);
  assert.match(validVersion({ zooms: "yes" }) as string, /zooms/);
  assert.match(validVersion({ coldOpen: 1 }) as string, /coldOpen/);
  assert.deepEqual((validVersion({ progressBar: true, loopEnd: false }) as { edit: object }).edit, { progressBar: true, loopEnd: false });
  assert.match(validVersion({ start: "5" }) as string, /numbers/);
  assert.match(validVersion({ end: NaN }) as string, /numbers/);
  assert.match(validVersion({ title: "  " }) as string, /title/);
});

test("versionSpan keeps the clip inside the video and at least 5 s", () => {
  assert.deepEqual(versionSpan({ start: 10, end: 40 }, -2, 3, 100), { start: 8, end: 43 });
  assert.deepEqual(versionSpan({ start: 3, end: 98 }, -10, 10, 100), { start: 0, end: 100 });
  assert.match(versionSpan({ start: 10, end: 16 }, 4, -3, 100) as string, /5 s/);
  assert.match(versionSpan({ start: 0, end: 179 }, 0, 5, 500) as string, /3 minutes/);
});

test("version ids number after the original and its other versions", () => {
  assert.equal(nextVersionId([{ id: "clip-1" }, { id: "clip-2" }], "clip-1"), "clip-1-v2");
  assert.equal(nextVersionId([{ id: "clip-1" }, { id: "clip-1-v2" }, { id: "clip-1-v3" }], "clip-1-v2"), "clip-1-v4", "a version of a version");
  assert.equal(nextVersionId([{ id: "clip-1-v99" }], "clip-1"), null);
  assert.equal(rootClipId("clip-12-v3"), "clip-12");
  assert.ok(isClipId("clip-1-v2") && isClipId("clip-10") && !isClipId("clip-1-v") && !isClipId("clip-1-v100") && !isClipId("clip-1-x2"));
  assert.deepEqual(baseEdit({ count: 5, maxSec: 45, captions: false }), { layout: "fit", camSide: "right", camSize: 0.3, captions: "none", jumpCuts: true, zooms: true,
    coldOpen: false, progressBar: false, loopEnd: false }); // old job: rendered without the retention edits
});

test("parseSuggestion takes title/hook from a JSON object reply", () => {
  assert.deepEqual(parseSuggestion('Sure: {"title":"He  actually did it","hook":"WAIT FOR IT one two three four five"}'), { title: "He actually did it", hook: "WAIT FOR IT one two three" });
  assert.deepEqual(parseSuggestion('{"title":"","hook":3}'), {});
  assert.deepEqual(parseSuggestion("no json"), {});
});

test("classic captions: one plain line per group, no per-word highlight", () => {
  const words = [{ start: 0.5, end: 0.8, text: "one" }, { start: 0.8, end: 1.1, text: "two." }, { start: 2, end: 2.4, text: "three" }];
  const ass = buildAss({ hook: "", words, duration: 5, style: "classic" });
  const ev = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
  assert.equal(ev.length, 2);
  assert.match(ev[0], /,Cap,,0,0,0,,ONE TWO\.$/);
  assert.ok(!ass.includes("\\c&H"), "no colour overrides");
  assert.equal(buildAss({ hook: "", words, duration: 5 }).split("\n").filter((l) => l.startsWith("Dialogue:")).length, 3, "karaoke stays per word");
});

test("reconciliation: uploads parsed, matched by exact title within the upload window", () => {
  const list = { items: [
    { snippet: { title: "My clip", publishedAt: "2026-10-16T10:05:00Z", resourceId: { videoId: "aaaaaaaaaaa" } }, status: { privacyStatus: "private" } },
    { snippet: { title: "My clip", publishedAt: "2026-10-15T10:00:00Z", resourceId: { videoId: "bbbbbbbbbbb" } } },
    { snippet: { title: "My clip 2", publishedAt: "2026-10-16T10:01:00Z", resourceId: { videoId: "ccccccccccc" } } },
    { snippet: { title: "bad id", publishedAt: "2026-10-16T10:01:00Z", resourceId: { videoId: "x" } } },
    null,
  ] };
  const ups = uploadsFrom(list);
  assert.equal(ups.length, 3);
  assert.deepEqual(matchUpload(ups, { title: " My clip ", since: "2026-10-16T10:00:00Z" }), { videoId: "aaaaaaaaaaa", title: "My clip", publishedAt: "2026-10-16T10:05:00Z", privacy: "private" });
  assert.equal(matchUpload(ups, { title: "My clip", since: "2026-10-16T17:00:00Z" }), null, "too late: another upload");
  assert.equal(matchUpload(ups, { title: "my clip", since: "2026-10-16T10:00:00Z" }), null, "title must match exactly");
  assert.equal(matchUpload([{ ...ups[0], title: "My  clip\n" }], { title: "My clip", since: "2026-10-16T10:00:00Z" })?.videoId, "aaaaaaaaaaa", "whitespace normalised");
  assert.deepEqual(reconcileOutcome(ups[0], "public"), { status: "done", progress: 1, videoId: "aaaaaaaaaaa", url: "https://youtube.com/shorts/aaaaaaaaaaa", error: undefined, privacy: "private" });
  const miss = reconcileOutcome(null);
  assert.equal(miss.status, "unknown", "not listed never becomes failed (no duplicate-inviting retry)");
  assert.match(miss.error, /check again/);
  assert.equal(matchUpload(ups, { title: "My clip", since: "garbage" }), null);
  assert.equal(matchUpload([], { title: "My clip", since: "2026-10-16T10:00:00Z" }), null);
  const twice = [{ videoId: "ddddddddddd", title: "T", publishedAt: "2026-10-16T12:00:00Z" }, { videoId: "eeeeeeeeeee", title: "T", publishedAt: "2026-10-16T10:02:00Z" }];
  assert.equal(matchUpload(twice, { title: "T", since: "2026-10-16T10:00:00Z" })?.videoId, "eeeeeeeeeee", "closest to the start wins");
  assert.deepEqual(uploadsFrom(null), []);
});

test("feedback: events appended, reason attached to the latest reject, capped", () => {
  const j: { feedback?: { clipId: string; action: string; reason?: string; at: string }[] } = {};
  addFeedback(j as never, "clip-1", "approved", undefined, "t1");
  addFeedback(j as never, "clip-2", "rejected", "boring", "t2");
  addFeedback(j as never, "clip-3", "rejected", undefined, "t3");
  assert.deepEqual(j.feedback, [{ clipId: "clip-1", action: "approved", at: "t1" }, { clipId: "clip-2", action: "rejected", reason: "boring", at: "t2" }, { clipId: "clip-3", action: "rejected", at: "t3" }]);
  assert.equal(setRejectReason(j as never, "clip-3", "bad cut"), true);
  assert.equal(j.feedback![2].reason, "bad cut");
  assert.equal(setRejectReason(j as never, "clip-1", "boring"), false, "never rejected");
  for (let i = 0; i < 600; i++) addFeedback(j as never, "clip-1", "version");
  assert.equal(j.feedback!.length, 500);
  assert.equal(jobProblem(job({ feedback: j.feedback })), "");
  assert.match(jobProblem(job({ feedback: {} })), /feedback/);
});

test("youtubePauseUntil: YouTube pauses 3 h after a bot-wall failure; other hosts never", async () => {
  const { youtubePauseUntil } = await import("../src/lib/clips/pure.ts");
  const now = Date.parse("2026-10-16T10:00:00Z");
  const blocked = [{ status: "failed" as const, error: "YouTube blocked the download; try again later", createdAt: "2026-10-16T09:00:00Z" }];
  assert.equal(youtubePauseUntil(blocked, "https://www.youtube.com/watch?v=dQw4w9WgXcQ", now), Date.parse("2026-10-16T12:00:00Z"));
  assert.equal(youtubePauseUntil(blocked, "https://youtu.be/dQw4w9WgXcQ", now), Date.parse("2026-10-16T12:00:00Z"));
  assert.equal(youtubePauseUntil(blocked, "https://www.twitch.tv/videos/123", now), 0);
  assert.equal(youtubePauseUntil(blocked, "https://www.youtube.com/watch?v=dQw4w9WgXcQ", now + 3 * 3600_000), 0);
  assert.equal(youtubePauseUntil([{ status: "failed", error: "network", createdAt: "2026-10-16T09:59:00Z" }], "https://youtu.be/dQw4w9WgXcQ", now), 0);
});

test("interrupted job: resumed once as the same job, failed with a clear message the second time", async () => {
  const { recoverInterrupted, RESUMED_NOTE } = await import("../src/lib/clips/pure.ts");
  const job = { id: "abc123-0a0b0c", source: "v.mp4", createdAt: "", updatedAt: "", status: "transcribing", progress: 0.3, step: "Transcribing 40%",
    warnings: ["old"], clips: [{ id: "clip-1", start: 0, end: 1, title: "", hook: "", reason: "", score: 0, status: "rendering" }], options: { count: 3, maxSec: 60 }, devlogDay: 7 } as never as import("../src/lib/clips/types.ts").ClipJob;
  assert.equal(recoverInterrupted(job), "resumed");
  assert.equal(job.status, "queued");
  assert.equal(job.resumes, 1);
  assert.equal(job.devlogDay, 7);
  assert.deepEqual(job.warnings, [RESUMED_NOTE]);
  assert.deepEqual(job.clips, []);
  // ORBIT went down again mid-run
  job.status = "rendering";
  job.clips = [{ id: "clip-1", start: 0, end: 1, title: "", hook: "", reason: "", score: 0, status: "rendering" }];
  assert.equal(recoverInterrupted(job), "failed");
  assert.equal(job.status, "failed");
  assert.match(job.error!, /interrupted twice/);
  assert.equal(job.clips[0].status, "failed");
  assert.equal(job.resumes, 1);
});

test("interrupted while rendering with clips made: keeps them, job done, the rest failed", async () => {
  const { recoverInterrupted } = await import("../src/lib/clips/pure.ts");
  const job = { id: "abc123-0a0b0d", status: "rendering", progress: 0.7, warnings: [], options: { count: 3, maxSec: 60 },
    clips: [{ id: "clip-1", status: "approved" }, { id: "clip-2", status: "ready" }, { id: "clip-3", status: "rendering" }] } as never as import("../src/lib/clips/types.ts").ClipJob;
  assert.equal(recoverInterrupted(job), "done");
  assert.equal(job.status, "done");
  assert.equal(job.resumes, undefined);
  assert.deepEqual(job.clips.map((c) => [c.status, c.error]), [["approved", undefined], ["ready", undefined], ["failed", "interrupted"]]);
  assert.match(job.warnings[0], /1 clip weren't rendered/);
});

test("interrupted job with a reviewed (rejected) clip but none kept isn't re-run (would drop the review)", async () => {
  const { recoverInterrupted } = await import("../src/lib/clips/pure.ts");
  const job = { id: "abc123-0a0b0e", status: "rendering", progress: 0.7, warnings: [], options: { count: 2, maxSec: 60 },
    clips: [{ id: "clip-1", status: "rejected" }, { id: "clip-2", status: "rendering" }] } as never as import("../src/lib/clips/types.ts").ClipJob;
  assert.equal(recoverInterrupted(job), "failed");
  assert.equal(job.error, "interrupted — start again");
  assert.deepEqual(job.clips.map((c) => c.status), ["rejected", "failed"]);
});
