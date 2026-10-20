import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanOriginal, originalityIssue, uploadHealth } from "../src/lib/clips/publish-checks-pure.ts";
import { videoResource } from "../src/lib/yt-analytics-pure.ts";
import { tooFewToCompare } from "../src/lib/chart-pure.ts";

const other = { options: { count: 3, maxSec: 60, captions: true } };
const devlog = { options: { ...other.options, preset: "devlog" as const } };

test("another creator's clip needs the owner's own layer; own devlog footage doesn't", () => {
  assert.match(originalityIssue(other, {}) ?? "", /another creator/);
  assert.match(originalityIssue(other, { original: "  short  " }) ?? "", /own layer/, "under 10 characters is not a real note");
  assert.equal(originalityIssue(other, { original: "my voiceover explaining the play" }), null);
  assert.equal(originalityIssue(devlog, {}), null);
});

test("cleanOriginal: undefined = not sent, null = invalid, else trimmed text without control chars or < >", () => {
  assert.equal(cleanOriginal(undefined), undefined);
  assert.equal(cleanOriginal(42), null);
  assert.equal(cleanOriginal("x".repeat(201)), null);
  assert.equal(cleanOriginal("  my <b>take</b>\n on it "), "my b take /b on it");
  assert.equal(cleanOriginal(""), "");
});

test("uploadHealth flags private uploads, overdue schedules and expired sign-ins", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  const jobs = [{ clips: [
    { publish: { status: "done", privacy: "private" } },
    { publish: { status: "done", privacy: "public" } },
    { publish: { status: "scheduled", scheduledFor: "2026-10-19T18:00:00Z" } },
    { publish: { status: "scheduled", scheduledFor: "2026-10-21T18:00:00Z" } },
    { publish: { status: "failed", error: "Reconnect YouTube" } },
    {},
  ] }];
  const h = uploadHealth(jobs, now);
  assert.equal(h.length, 3);
  assert.match(h[0], /^1 upload is still private/);
  assert.match(h[1], /^1 scheduled clip has passed/);
  assert.match(h[2], /Testing/);
  assert.deepEqual(uploadHealth([{ clips: [{ publish: { status: "done", privacy: "public" } }] }], now), []);
});

test("videoResource sets YouTube's synthetic-content flag only when asked", () => {
  const clip = { title: "A clip", hook: "Hook" };
  const on = videoResource({ aiContent: true }, clip);
  const off = videoResource({}, clip);
  assert.ok(typeof on === "object" && on.status.containsSyntheticMedia === true);
  assert.ok(typeof off === "object" && !("containsSyntheticMedia" in off.status));
  assert.equal(videoResource({ aiContent: "yes" }, clip), "aiContent must be true or false");
});

test("too few views to compare periods", () => {
  assert.equal(tooFewToCompare({ views: 3 }, { views: 1 }), true);
  assert.equal(tooFewToCompare({ views: 99 }, { views: 0 }), true);
  assert.equal(tooFewToCompare({ views: 100 }, { views: 1 }), false);
  assert.equal(tooFewToCompare({ views: NaN }, { views: NaN }), true);
});
