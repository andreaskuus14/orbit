import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STAGES, TOOL_MENU, ago, at, biggestDrop, coveredFailures, paceText, pipeline, retentionPoints, statusParts } from "../src/lib/studio-shell-pure.ts";
import { plainError } from "../src/lib/planet-page-pure.ts";
import { EN, ET, type Key } from "../src/lib/i18n-pure.ts";

const DAY = 86_400_000;

test("pipeline: downloads and queued jobs are Find, running jobs Cut, ready clips Check, approved/scheduled/uploading Post", () => {
  const s = pipeline([
    { id: "a", status: "queued" },
    { id: "b", status: "rendering", progress: 0.5 },
    { id: "c", status: "transcribing", progress: 0.1 },
    { id: "d", status: "done", clips: [{ status: "ready" }, { status: "ready" }, { status: "approved" }, { status: "published", publish: { status: "done" } }, { status: "approved", publish: { status: "uploading" } }] },
    { id: "e", status: "failed" },
  ], [{ status: "downloading", progress: 0.4 }, { status: "done" }, { status: "queued" }]);
  assert.deepEqual(s.map((x) => x.key), STAGES);
  assert.deepEqual(s.map((x) => x.n), [3, 2, 2, 2]);
  assert.equal(s[0].live, true); assert.equal(s[0].share, 0.4);
  assert.equal(s[1].live, true); assert.ok(Math.abs((s[1].share ?? 0) - 0.3) < 1e-9);
  assert.equal(s[2].live, false); assert.equal(s[3].live, true); // an upload is running
});

test("pipeline: nothing going on is all zeros, never NaN; odd progress values are clamped", () => {
  const s = pipeline([], []);
  assert.deepEqual(s.map((x) => [x.n, x.live, x.share]), [[0, false, null], [0, false, null], [0, false, null], [0, false, null]]);
  const t = pipeline([{ id: "x", status: "finding", progress: Number.NaN }, { id: "y", status: "rendering", progress: 7 }], []);
  assert.equal(t[1].share, 0.5);
});

test("pace badge: one decimal under 10, whole numbers from 10, empty for nonsense", () => {
  assert.equal(paceText(2.44), "2.4×");
  assert.equal(paceText(134.4), "134×");
  assert.equal(paceText(0), ""); assert.equal(paceText(Number.NaN), ""); assert.equal(paceText(-3), "");
});

test("ago: today, yesterday, days, weeks, then a date; EN and ET; bad input is empty", () => {
  const now = Date.parse("2026-11-23T12:00:00Z");
  assert.equal(ago(new Date(now - 3600_000).toISOString(), now, "en"), "today");
  assert.equal(ago(new Date(now - DAY).toISOString(), now, "en"), "yesterday");
  assert.equal(ago(new Date(now - 5 * DAY).toISOString(), now, "et"), "5 päeva tagasi");
  assert.equal(ago(new Date(now - 21 * DAY).toISOString(), now, "en"), "3 weeks ago");
  assert.match(ago(new Date(now - 200 * DAY).toISOString(), now, "en"), /2026/);
  assert.equal(ago("not a date", now, "en"), "");
});

test("status line: subscribers + the freshest fact; Shorts to check beat taking off; not connected says so", () => {
  assert.deepEqual(statusParts({ subs: 1240, videos: 18, hot: 2, toCheck: 3, connected: true }).map((p) => p.key), ["sx.status.subs", "sx.status.check"]);
  assert.deepEqual(statusParts({ subs: 1240, videos: 18, hot: 2, toCheck: 1, connected: true }).map((p) => p.key), ["sx.status.subs", "sx.status.check1"]);
  assert.deepEqual(statusParts({ subs: 1240, videos: 18, hot: 2, toCheck: 0, connected: true }).map((p) => p.key), ["sx.status.subs", "sx.status.hot"]);
  assert.deepEqual(statusParts({ subs: null, videos: 18, hot: 0, toCheck: 0, connected: true }).map((p) => p.key), ["sx.status.videos"]);
  assert.deepEqual(statusParts({ subs: 5, videos: 0, hot: 0, toCheck: 0, connected: false }).map((p) => p.key), ["sx.status.off"]);
  assert.equal(statusParts({ subs: 1240, videos: 1, hot: 0, toCheck: 0, connected: true })[0].vars?.n, "1.2K");
});

test("a failed job named by a Needs you item shows once (in Needs you), others stay", () => {
  const jobs = [{ id: "1", status: "failed", source: "broken-file.mp4" }, { id: "2", status: "failed", source: "other.mp4" }, { id: "3", status: "done", source: "broken-file.mp4" }];
  assert.deepEqual([...coveredFailures(jobs, ["Cutting broken-file.mp4 failed"])], ["clip:1"]);
  assert.equal(coveredFailures(jobs, []).size, 0);
});

test("retention: the biggest drop skips the first peek and finds where people leave", () => {
  const pts = Array.from({ length: 41 }, (_, i) => { const t = i / 40; return { t, ratio: t < 0.05 ? 1 - t * 4 : t < 0.6 ? 0.8 - t * 0.2 : t < 0.65 ? 0.68 - (t - 0.6) * 4 : 0.48 - (t - 0.65) * 0.2 }; });
  const d = biggestDrop(pts)!;
  assert.ok(d.t >= 0.5 && d.t <= 0.62, `drop at ${d.t}`);
  assert.ok(d.drop > 0.15);
  assert.equal(biggestDrop([{ t: 0, ratio: 1 }, { t: 1, ratio: 0.5 }]), null); // too short
  assert.equal(biggestDrop(Array.from({ length: 20 }, (_, i) => ({ t: i / 19, ratio: 0.5 }))), null); // flat: no marker
});

test("retention points stay inside the box, even with ratios over 1 (rewatches) and bad rows", () => {
  const box = { x0: 30, x1: 370, y0: 8, y1: 128 };
  const p = retentionPoints([{ t: 0, ratio: 1.3 }, { t: 0.5, ratio: 0.6 }, { t: Number.NaN, ratio: 1 }, { t: 1, ratio: 0.2 }], box);
  assert.equal(p.length, 3);
  for (const q of p) { assert.ok(q.x >= box.x0 && q.x <= box.x1); assert.ok(q.y >= box.y0 - 1e-9 && q.y <= box.y1); }
  assert.equal(p[0].y, box.y0); // the top is the highest ratio
  assert.equal(at(0.5, 125), "1:03"); assert.equal(at(Number.NaN, 60), "0:00");
});

test("ffmpeg failures read as plain words (EN + ET), other errors are untouched", () => {
  assert.equal(plainError("ffmpeg exited with code 1: moov atom not found", "en"), "The video file couldn't be read. It may be broken or still copying");
  assert.match(plainError("Invalid data found when processing input", "et"), /Videofaili ei saanud lugeda/);
  assert.equal(plainError("ffmpeg is missing", "en"), "ffmpeg is missing");
});

test("every STUDIO shell key has English and Estonian, and the menu labels exist", () => {
  const keys = (Object.keys(EN) as Key[]).filter((k) => k.startsWith("sx."));
  assert.ok(keys.length > 100);
  for (const k of keys) { assert.ok(EN[k]?.trim(), k); assert.ok(ET[k]?.trim(), `ET missing ${k}`); }
  for (const m of TOOL_MENU) assert.ok(EN[m.label as Key], m.label);
  for (const s of STAGES) assert.ok(EN[`sx.stage.${s}` as Key]);
});

test("the STUDIO shell never uploads or publishes, and has no emoji icons or spaced capitals", () => {
  const src = readFileSync("src/components/StudioShell.tsx", "utf8") + readFileSync("src/components/StudioWorld.tsx", "utf8");
  assert.doesNotMatch(src, /\/publish|\/upload|method: "(PUT|DELETE)"/);
  assert.doesNotMatch(src, /[\u{1F300}-\u{1FAFF}]/u);
  assert.doesNotMatch(src, /toUpperCase\(\)|SUBSCRIBERS|VIEWS · 28/);
  const css = readFileSync("src/app/studio-planet.css", "utf8");
  assert.doesNotMatch(css, /letter-spacing:\s*0\.[1-9]|text-transform:\s*uppercase|(?<![-\w])filter:\s*blur/);
  // motion: only transform/opacity in keyframes, and both switches are handled
  for (const kf of css.matchAll(/@keyframes [\w-]+ \{([^}]*\}[^}]*)\}/g)) assert.doesNotMatch(kf[1], /width|height|top|left|filter/);
  assert.match(css, /prefers-reduced-motion: reduce/); assert.match(css, /html\[data-motion="off"\]/);
});
