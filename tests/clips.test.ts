import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  audioArgs, probeArgs, assText, assTime, buildAss, captionLines, escapeXml, fallbackMoments, frameArgs, isInboxName, isJobId, parseByteRange, parseDuration,
  peakTime, promptTranscript, removeOverlaps, renderArgs, resolveInside, rmsWindows, scoreCandidates, snapQuiet, thumbSvg, validateMoments,
  verticalFilter, wordsFromChunks, wrapTitle, type Word,
  cleanPermission, isDownloadId, parseClipUrl, parseYtdlpProgress, validOptions, ytdlpArgs, ytdlpError, ytdlpOutputFile,
} from "../src/lib/clips/pure.ts";

test("parseDuration reads ffmpeg's Duration line", () => {
  assert.equal(parseDuration("Input #0, mov,mp4\n  Duration: 01:02:03.45, start: 0.000000, bitrate: 1 kb/s"), 3723.45);
  assert.equal(parseDuration("  Duration: 00:00:07.00,"), 7);
  assert.equal(parseDuration("  Duration: N/A, bitrate: N/A"), null);
  assert.equal(parseDuration("garbage"), null);
});

test("rmsWindows computes RMS per window, last partial included", () => {
  const pcm = new Float32Array([1, -1, 1, -1, 0.5, 0.5, 0.5]);
  assert.deepEqual(rmsWindows(pcm, 4), [1, 0.5]);
  assert.deepEqual(rmsWindows(new Float32Array(0), 4), []);
});

test("removeOverlaps keeps the best non-overlapping items", () => {
  const r = removeOverlaps([{ start: 0, end: 10, score: 0.5 }, { start: 5, end: 15, score: 0.9 }, { start: 15, end: 20, score: 0.1 }]);
  assert.deepEqual(r.map((x) => x.start), [5, 15]);
});

test("scoreCandidates finds the loud stretch and never overlaps", () => {
  const rms = Array.from({ length: 600 }, (_, i) => (i >= 300 && i < 360 ? 0.8 + (i % 2) * 0.2 : 0.05)); // 300 s, loud at 150-180 s
  const c = scoreCandidates(rms, 30, [], 5);
  assert.ok(c.length > 1);
  assert.equal(c[0].score, 1);
  assert.ok(c[0].start >= 140 && c[0].end <= 190, JSON.stringify(c[0]));
  for (const x of c) assert.ok(x.end - x.start >= 15 && x.end - x.start <= 30);
  assert.equal(removeOverlaps(c).length, c.length);
  assert.deepEqual(scoreCandidates([], 30), []);
  assert.deepEqual(scoreCandidates([0.1, 0.2], 45), [{ start: 0, end: 1, score: 1 }], "short video is one clip");
});

test("peakTime and snapQuiet", () => {
  const rms = [0.1, 0.2, 0.9, 0.3, 0.0, 0.5];
  assert.equal(peakTime(rms, 0, 3), 1.25);
  assert.equal(peakTime(rms, 2, 3), 2.75, "only windows inside the clip");
  assert.equal(snapQuiet(rms, 1.6, 0.75), 2.25);
});

test("wordsFromChunks handles word and chunk timestamps", () => {
  assert.deepEqual(wordsFromChunks([{ text: " hi", timestamp: [1, 1.5] }], 10), [{ start: 11, end: 11.5, text: "hi" }]);
  const w = wordsFromChunks([{ text: "one two", timestamp: [0, 2] }, { text: "x", timestamp: [3, null] }, { text: "bad", timestamp: [null, 1] }]);
  assert.deepEqual(w.map((x) => [x.text, x.start, x.end]), [["one", 0, 1], ["two", 1, 2], ["x", 3, 4]]);
});

test("validateMoments clamps, caps and removes overlaps", () => {
  const reply = 'Sure!\n```json\n[{"start":-5,"end":40,"title":"' + "A".repeat(100) + '","hook":"one two three four five six seven","reason":"r","score":90},' +
    '{"start":10,"end":30,"title":"overlap","hook":"h","reason":"","score":0.2},' +
    '{"start":100,"end":500,"title":" Tail  end ","hook":"x","reason":"y","score":"nope"},' +
    '{"start":50,"end":52,"title":"too short"},"junk",null]\n```';
  const m = validateMoments(reply, { duration: 120, maxSec: 45, count: 5 });
  assert.equal(m.length, 2);
  assert.deepEqual([m[0].start, m[0].end, m[0].score, m[0].title.length, m[0].hook], [0, 40, 0.9, 70, "one two three four five six"]);
  assert.deepEqual([m[1].start, m[1].end, m[1].title, m[1].score], [100, 120, "Tail end", 0.5]);
  assert.deepEqual(validateMoments("no json", { duration: 10, maxSec: 45, count: 3 }), []);
  assert.deepEqual(validateMoments('{"start":1}', { duration: 10, maxSec: 45, count: 3 }), []);
  assert.equal(validateMoments(reply, { duration: 120, maxSec: 45, count: 1 }).length, 1);
});

test("fallbackMoments gives generic titles", () => {
  const f = fallbackMoments([{ start: 65, end: 90, score: 1 }, { start: 0, end: 20, score: 0.5 }], 1);
  assert.deepEqual(f, [{ start: 65, end: 90, score: 1, title: "Highlight 1 (1:05)", hook: "Wait for this", reason: "Loudest, most active stretch" }]);
});

test("promptTranscript groups lines and trims to candidates", () => {
  const words: Word[] = Array.from({ length: 200 }, (_, i) => ({ start: i * 3, end: i * 3 + 1, text: `w${i}<x>` }));
  const full = promptTranscript(words, []);
  assert.ok(full.startsWith("[0:00] w0x w1x w2x w3x\n[0:12]"));
  assert.ok(!full.includes("<"));
  const cut = promptTranscript(words, [{ start: 300, end: 330, score: 1 }], 500);
  assert.ok(cut.length <= 500 && cut.startsWith("[4:"), cut.slice(0, 20));
});

test("ASS time format and escaping", () => {
  assert.equal(assTime(0), "0:00:00.00");
  assert.equal(assTime(3723.456), "1:02:03.46");
  assert.equal(assTime(-1), "0:00:00.00");
  assert.equal(assText("a{\\b1}c\\N d\nline"), "a(＼b1)c＼N d line");
});

test("captionLines makes 2-4 word lines and breaks on punctuation/pauses", () => {
  const w = (text: string, start: number): Word => ({ text, start, end: start + 0.3 });
  const lines = captionLines([w("I", 0), w("went", 0.3), w("home.", 0.6), w("Then", 0.9), w("a", 1.2), w("b", 1.5), w("c", 1.8), w("d", 2.1), w("later", 5)]);
  assert.deepEqual(lines.map((l) => l.text), ["I went home.", "Then a b c", "d later"]);
  assert.deepEqual([lines[0].start, lines[0].end], [0, 0.8999999999999999]);
});

test("buildAss has the hook first 2.5 s and escaped captions", () => {
  const ass = buildAss({ hook: "Wait {for} it", words: [{ text: "hello", start: 0.5, end: 1 }, { text: "world}", start: 1, end: 1.5 }, { text: "gone", start: 30, end: 31 }], duration: 20 });
  assert.match(ass, /PlayResX: 1080\nPlayResY: 1920/);
  assert.match(ass, /Dialogue: 1,0:00:00.00,0:00:02.50,Hook,,0,0,0,,WAIT \(FOR\) IT/);
  assert.match(ass, /Dialogue: 0,0:00:00.50,0:00:01.50,Cap,,0,0,0,,HELLO WORLD\)/);
  assert.ok(!ass.includes("GONE"));
  assert.ok(!buildAss({ hook: "", words: [], duration: 5 }).includes("Dialogue:"));
});

test("ffmpeg arg builders", () => {
  const r = renderArgs({ input: "C:\\v\\a b.mp4", start: 12.3456, duration: 30, ass: "clip-1.ass", out: "clip-1.mp4" });
  assert.deepEqual(r.slice(3, 7), ["-ss", "12.346", "-t", "30"]);
  assert.equal(r[r.indexOf("-i") + 1], "C:\\v\\a b.mp4");
  for (const args of [r, probeArgs("x.mp4"), audioArgs("x.mp4", "a.f32"), frameArgs("x.mp4", 1, "f.jpg")]) // inputs are always whitelisted
    assert.equal(args[args.indexOf("-i") - 1], "file");
  assert.ok(r.includes("libx264") && r.includes("+faststart") && r.at(-1) === "clip-1.mp4");
  assert.ok(r[r.indexOf("-filter_complex") + 1].endsWith(",ass=clip-1.ass[v]"));
  assert.throws(() => verticalFilter("C:\\x\\y.ass"));
  assert.throws(() => verticalFilter("a'b.ass"));
  assert.ok(!verticalFilter().includes("ass="));
  assert.deepEqual(frameArgs("in.mp4", 5, "f.jpg").slice(-5), ["[v]", "-frames:v", "1", "-q:v", "2", "f.jpg"].slice(-5));
});

test("isInboxName accepts plain video names only", () => {
  for (const ok of ["talk.mp4", "My Video (final).MOV", "a.mkv", "x.webm", "y.m4v"]) assert.ok(isInboxName(ok), ok);
  for (const bad of ["../a.mp4", "a/b.mp4", "a\\b.mp4", "C:a.mp4", "a.mp4:ads", "a.txt", "", " a.mp4", "a\0.mp4", 5, null]) assert.ok(!isInboxName(bad), String(bad));
  assert.ok(isJobId("mg8x2k1a-0a1b2c") && !isJobId("../x") && !isJobId("abc"));
});

test("resolveInside never escapes the base (posix and win32)", () => {
  assert.equal(resolveInside("/s/clips", "job/clip-1.mp4", path.posix), "/s/clips/job/clip-1.mp4");
  for (const bad of ["../x", "a/../../x", "/etc/passwd", "C:/x", "c:x", "\\\\host\\share\\x", "//host/x", "a\0b", "", "a//b", "./a", "a/b:c"]) {
    assert.equal(resolveInside("/s/clips", bad, path.posix), null, bad);
  }
  assert.equal(resolveInside("C:\\s\\clips", "job/a.mp4", path.win32), "C:\\s\\clips\\job\\a.mp4");
  assert.equal(resolveInside("C:\\s\\clips", "job\\..\\..\\a.mp4", path.win32), null);
  assert.equal(resolveInside("C:\\s\\clips", "D:\\a.mp4", path.win32), null);
});

test("parseByteRange", () => {
  assert.equal(parseByteRange(null, 100), null);
  assert.deepEqual(parseByteRange("bytes=0-", 100), { start: 0, end: 99 });
  assert.deepEqual(parseByteRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(parseByteRange("bytes=90-500", 100), { start: 90, end: 99 });
  assert.deepEqual(parseByteRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.equal(parseByteRange("bytes=100-", 100), "bad");
  assert.equal(parseByteRange("bytes=5-2", 100), "bad");
  assert.equal(parseByteRange("items=1-2", 100), "bad");
  assert.equal(parseByteRange("bytes=0-1,5-6", 100), null, "multi-range falls back to the whole file");
});

test("thumbnail SVG escapes XML and wraps", () => {
  assert.equal(escapeXml(`<a & "b" 'c'>\x01`), "&lt;a &amp; &quot;b&quot; &apos;c&apos;&gt;");
  assert.deepEqual(wrapTitle("the quick brown fox jumps over"), ["the quick", "brown fox", "jumps over"]);
  assert.equal(wrapTitle("a b c d e f g h i j k l m n o p q r s t u v w x y z aa bb cc dd ee ff gg hh", 3, 2).length, 2);
  const svg = thumbSvg(`Tom & Jerry's <script>`);
  assert.ok(svg.includes("TOM &amp; JERRY&apos;S") && !svg.includes("<script>") && svg.includes("#ff2e63"));
});

test("parseClipUrl allows only https YouTube/Twitch hosts", () => {
  for (const u of ["https://www.youtube.com/watch?v=abc123", "https://youtube.com/shorts/x", "https://m.youtube.com/watch?v=a", "https://youtu.be/abc",
    "https://twitch.tv/videos/123", "https://www.twitch.tv/videos/123", "https://clips.twitch.tv/SlugName", "https://WWW.YouTube.com/watch?v=a", "https://kick.com/xqc/videos/1"]) assert.ok(parseClipUrl(u), u);
  // forgiving input, strict output
  assert.equal(parseClipUrl("  youtube.com/watch?v=a  "), "https://youtube.com/watch?v=a");
  assert.equal(parseClipUrl("http://youtu.be/a"), "https://youtu.be/a");
  assert.equal(parseClipUrl('<iframe width="560" src="https://www.youtube.com/embed/nMav0Ugaz1c?si=x" allowfullscreen></iframe>'), "https://www.youtube.com/embed/nMav0Ugaz1c?si=x");
  for (const u of ["https://youtube.com.evil.io/watch", "https://evilyoutube.com/", "https://vimeo.com/1",
    "https://user:pw@youtube.com/", "https://youtube.com@evil.io/", "https://evil.io\\@youtube.com/", "https://youtube.com:443/watch", "https://youtube.com:8080/",
    "javascript:alert(1)", "https://youtu.be/a b", "ftp://youtube.com/a", "https://kick.com.evil.io/x", "https://youtu.be/" + "a".repeat(300), "", 42, null]) assert.equal(parseClipUrl(u), null, String(u));
  assert.equal(parseClipUrl("https://www.youtube.com/@kai/videos"), "https://www.youtube.com/@kai/videos"); // @ in the path is fine
});

test("cleanPermission is an optional one-line note up to 300 chars", () => {
  assert.equal(cleanPermission("  Kai's   clipping\nprogram  "), "Kai's clipping program");
  assert.equal(cleanPermission("ok"), "ok");
  assert.equal(cleanPermission(""), "");
  assert.equal(cleanPermission("x".repeat(301)), null);
  assert.equal(cleanPermission(undefined), "");
  assert.equal(cleanPermission(42), null);
});

test("yt-dlp progress, output files and errors", () => {
  assert.equal(parseYtdlpProgress("[download]  12.3% of  1.20GiB at  5.00MiB/s ETA 03:10"), 0.123);
  assert.equal(parseYtdlpProgress("[download] 100% of 1.20GiB in 00:04:00"), 1);
  assert.equal(parseYtdlpProgress("[download] Destination: a.mp4"), null);
  assert.equal(ytdlpOutputFile("[download] Destination: Kai - Stream [x1].f137.mp4"), "Kai - Stream [x1].f137.mp4");
  assert.equal(ytdlpOutputFile('[Merger] Merging formats into "Kai - Stream [x1].mp4"'), "Kai - Stream [x1].mp4");
  assert.equal(ytdlpOutputFile("[youtube] x1: Downloading webpage"), null);
  assert.match(ytdlpError("ERROR: [youtube] x: Sign in to confirm you're not a bot"), /yt-dlp -U/);
  assert.match(ytdlpError("[download] x does not pass filter (duration<=10800 & !is_live), skipping .."), /Live streams/);
  assert.equal(ytdlpError("junk\nERROR: something odd\n"), "something odd");
});

test("ytdlpArgs keeps the URL last, after --", () => {
  const a = ytdlpArgs("https://youtu.be/--exec=evil", "C:\\ff");
  assert.deepEqual(a.slice(-2), ["--", "https://youtu.be/--exec=evil"]);
  assert.equal(a.indexOf("--"), a.length - 2);
  assert.equal(a[a.indexOf("--ffmpeg-location") + 1], "C:\\ff");
});

test("validOptions and isDownloadId", () => {
  assert.deepEqual(validOptions({}), { count: 5, maxSec: 45, captions: true });
  assert.equal(typeof validOptions({ count: 11 }), "string");
  assert.equal(typeof validOptions({ captions: "yes" }), "string");
  assert.ok(isDownloadId("dl-mgr1abc-a1b2c3"));
  assert.ok(!isDownloadId("../x"));
});
