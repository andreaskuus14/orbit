import { test } from "node:test";
import assert from "node:assert/strict";
import { blockersOf, cleanRights, mediaVerdict, parseRecordId, productionRecords, recordId, rightsProblem } from "../src/lib/clips/production-pure.ts";
import { clipContent, contentHash } from "../src/lib/approval-pure.ts";
import { linkFromHash, linkToHash } from "../src/lib/deeplink-pure.ts";

const SHA = "a".repeat(64);
const job = (o: Record<string, unknown> = {}) => ({ v: 1, id: "abc123-0f0f0f", source: "vod.mp4", createdAt: "", updatedAt: "", status: "done", progress: 1, step: "", warnings: [],
  options: { count: 1, maxSec: 60, captions: true }, clips: [] as never[], ...o }) as never;
const clip = (o: Record<string, unknown> = {}) => ({ id: "clip-1", start: 0, end: 30, title: "T", hook: "h", reason: "", score: 1, status: "approved", video: "clips/a.mp4",
  approvedHash: "x", approvedMedia: SHA, original: "my commentary on top", qc: { pass: true, media: SHA, blocking: [] }, ...o }) as never;

test("STU02: a link or a download is not permission; missing permission blocks", () => {
  assert.match(String(rightsProblem(job())), /No permission basis/);
  assert.equal(typeof cleanRights({ basis: "licensed", evidence: "https://youtube.com/watch?v=x" }), "string");
  assert.equal(typeof cleanRights({ basis: "licensed", evidence: "it's public" }), "string");
  assert.equal(typeof cleanRights({ basis: "nope", evidence: "whatever whatever" }), "string");
  const r = cleanRights({ basis: "written-permission", evidence: "Email from @creator, 3 Oct 2026: yes, clip it" }, "2026-10-30T00:00:00Z");
  assert.equal(typeof r, "object");
  assert.equal(rightsProblem(job({ rights: r })), null);
  assert.equal(rightsProblem(job({ options: { count: 1, maxSec: 60, captions: true, preset: "devlog" } })), null); // own footage
  assert.equal(rightsProblem(job({ source: "AI story: x" })), null);
  assert.ok(blockersOf(job(), clip()).some((b) => /permission/i.test(b)));
  assert.deepEqual(blockersOf(job({ rights: r }), clip()), []);
});

test("STU03: the approval hash covers title and edit settings, so any edit invalidates it", async () => {
  const base = { video: "v", thumb: "t", start: 0, end: 30, title: "A", edit: { captions: "karaoke" } };
  const h = await contentHash(clipContent(base));
  assert.notEqual(await contentHash(clipContent({ ...base, title: "B" })), h);
  assert.notEqual(await contentHash(clipContent({ ...base, edit: { captions: "none" } })), h);
  assert.equal(await contentHash(clipContent({ ...base })), h);
  const r = cleanRights({ basis: "licensed", evidence: "Licence #42 from the agency" }) as never;
  assert.ok(blockersOf(job({ rights: r }), clip({ status: "ready" })).includes("Not approved yet"));
  assert.ok(blockersOf(job({ rights: r }), clip({ publish: { status: "unknown", at: "" } })).some((b) => /checked on YouTube/.test(b)));
  assert.ok(blockersOf(job({ rights: r }), clip({ qc: { pass: true, media: "b".repeat(64), blocking: [] } })).some((b) => /another render/.test(b)));
});

const GOOD = `Input #0, mov,mp4, from 'a.mp4':
  Duration: 00:00:31.20, start: 0.000000, bitrate: 4000 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1080x1920, 3800 kb/s, 30 fps
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s
[Parsed_volumedetect_0 @ 0x1] mean_volume: -18.4 dB
[Parsed_volumedetect_0 @ 0x1] max_volume: -1.2 dB`;

test("STU04: media verdict from the ffmpeg log", () => {
  const ok = mediaVerdict(GOOD, { seconds: 30, captions: true });
  assert.equal(ok.pass, true);
  assert.deepEqual(ok.blocking, []);
  assert.equal(ok.facts.width, 1080);
  assert.equal(ok.unchecked.length, 1); // burned captions: said, not claimed
  assert.ok(!JSON.stringify(ok).toLowerCase().includes("engag")); // a technical pass is never called engaging
  const corrupt = mediaVerdict("[mov,mp4 @ 0x1] moov atom not found\na.mp4: Invalid data found when processing input");
  assert.equal(corrupt.pass, false);
  assert.ok(corrupt.evidence.length > 0);
  const silentBlack = mediaVerdict(GOOD.replace(/Stream #0:1[^\n]*\n/, "").replace(/\[Parsed_volume[^\n]*\n?/g, "") +
    "\n[blackdetect @ 0x2] black_start:0 black_end:20 black_duration:20\n[freezedetect @ 0x3] lavfi.freezedetect.freeze_start: 20\n[freezedetect @ 0x3] lavfi.freezedetect.freeze_duration: 5");
  assert.equal(silentBlack.pass, false);
  assert.ok(silentBlack.blocking.includes("No audio track") && silentBlack.blocking.includes("Mostly black frames"));
  assert.ok(silentBlack.warnings.some((w) => /frozen/.test(w)));
  assert.ok(mediaVerdict(GOOD.replace("1080x1920", "1920x1080")).warnings.some((w) => /9:16/.test(w)));
});

test("STU01: one record per clip with a stable id that a review link can carry", () => {
  const r = cleanRights({ basis: "licensed", evidence: "Licence #42 from the agency" }) as never;
  const j = job({ rights: r, clips: [clip(), clip({ id: "clip-1-v1", variantOf: "clip-1", status: "ready", publish: { status: "done", videoId: "yt1", at: "" } })] });
  const recs = productionRecords([j], [{ id: "s1", clipJob: "abc123-0f0f0f", opts: { idea: "Idea X" }, story: { title: "Script X" } }]);
  assert.equal(recs.length, 2);
  assert.equal(recs[0].idea, "Idea X");
  assert.equal(recs[0].revisions.length, 2);
  assert.equal(recs[1].result?.videoId, "yt1");
  assert.deepEqual(parseRecordId(recs[0].id), { job: "abc123-0f0f0f", clip: "clip-1" });
  const l = { planet: "studio" as const, view: "review", kind: "review" as const, id: recordId("abc123-0f0f0f", "clip-1-v1") };
  assert.deepEqual(linkFromHash(linkToHash(l)), l);
});
