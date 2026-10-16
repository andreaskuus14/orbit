import { test } from "node:test";
import assert from "node:assert/strict";
import { bytes, channelLink, isJobActive, mmss, parseClipUrl } from "../src/lib/clips/format.ts";

test("mmss: m:ss, rounding, junk input", () => {
  assert.equal(mmss(0), "0:00");
  assert.equal(mmss(65.4), "1:05");
  assert.equal(mmss(3600), "1:00:00");
  assert.equal(mmss(NaN), "0:00");
  assert.equal(mmss(-3), "0:00");
});

test("bytes: units and precision", () => {
  assert.equal(bytes(0), "0 B");
  assert.equal(bytes(-5), "0 B");
  assert.equal(bytes(NaN), "0 B");
  assert.equal(bytes(1023), "1023 B");
  assert.equal(bytes(1536), "1.5 KB");
  assert.equal(bytes(50 * 1024 * 1024), "50 MB");
  assert.equal(bytes(2.25 * 1024 ** 3), "2.3 GB");
  assert.equal(bytes(1024 ** 6), "1048576 TB");
});

test("isJobActive: working statuses or any rendering clip", () => {
  for (const s of ["queued", "probing", "transcribing", "finding", "rendering"]) assert.equal(isJobActive({ status: s, clips: [] }), true, s);
  assert.equal(isJobActive({ status: "done", clips: [{ status: "ready" }, { status: "approved" }] }), false);
  assert.equal(isJobActive({ status: "failed" }), false);
  assert.equal(isJobActive({ status: "done", clips: [{ status: "ready" }, { status: "rendering" }] }), true);
});

test("channelLink: channel pages are refused by the download box, single videos pass", () => {
  const k = (s: string) => channelLink(parseClipUrl(s)!);
  assert.equal(k("https://www.youtube.com/@Jynxzi"), "youtube");
  assert.equal(k("youtube.com/@Jynxzi/videos"), "youtube");
  assert.equal(k("https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa"), "youtube");
  assert.equal(k("https://www.youtube.com/c/Name"), "youtube");
  assert.equal(k("https://www.youtube.com/user/Name"), "youtube");
  assert.equal(k("https://www.twitch.tv/jynxzi"), "other");
  assert.equal(k("https://kick.com/someone"), "other");
  assert.equal(k("https://www.youtube.com/PewDiePie"), "youtube"); // old vanity URL = whole channel
  assert.equal(k("https://www.youtube.com/playlist?list=PLx"), "other");
  for (const v of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ", "https://www.twitch.tv/videos/123", "https://clips.twitch.tv/SomeClip", "https://kick.com/someone/videos/abc", "https://kick.com/xqc?clip=clip_01ABC"]) assert.equal(k(v), null, v);
});
