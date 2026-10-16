import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  cleanWords, audioArgs, probeArgs, assText, assTime, buildAss, captionGroups, escapeXml, fallbackMoments, frameArgs, isInboxName, isJobId, parseByteRange, parseDuration,
  peakTime, promptTranscript, removeOverlaps, renderArgs, renderFilter, resolveInside, rmsWindows, scoreCandidates, snapQuiet, snapToSpeech, thumbSvg, validateMoments,
  wordsFromChunks, wrapTitle, type Word,
  MAX_SOURCE_SEC, ffmpegTime, cleanPermission, isDownloadId, parseClipUrl, parseYtdlpProgress, validOptions, ytdlpArgs, ytdlpError, ytdlpOutputFile,
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
  assert.deepEqual([m[0].start, m[0].end, m[0].score, m[0].title.length, m[0].hook], [0, 40, 0.9, 60, "one two three four five six"]);
  assert.deepEqual([m[1].start, m[1].end, m[1].title, m[1].score], [100, 120, "Tail end", 0.5]);
  assert.deepEqual(validateMoments("no json", { duration: 10, maxSec: 45, count: 3 }), []);
  assert.deepEqual(validateMoments('{"start":1}', { duration: 10, maxSec: 45, count: 3 }), []);
  assert.equal(validateMoments(reply, { duration: 120, maxSec: 45, count: 1 }).length, 1);
});

test("validateMoments keeps the end of a too-long pick and reads clock times", () => {
  const o = { duration: 4000, maxSec: 45, count: 5 };
  assert.deepEqual(validateMoments('[{"start":10,"end":100}]', o).map((m) => [m.start, m.end]), [[55, 100]]);
  assert.deepEqual(validateMoments('[{"start":"1:05","end":"1:30.5"}]', o).map((m) => [m.start, m.end]), [[65, 90.5]]);
  assert.deepEqual(validateMoments('[{"start":"1:00:00","end":"1:00:20.5"}]', o).map((m) => [m.start, m.end]), [[3600, 3620.5]]);
  assert.deepEqual(validateMoments('[{"start":"12","end":30}]', o).map((m) => [m.start, m.end]), [[12, 30]]);
  assert.deepEqual(validateMoments('[{"start":"1:5","end":"soon"}]', o), []);
});

test("snapToSpeech snaps to sentence/pause boundaries within 3 s", () => {
  const w = (text: string, start: number, end = start + 0.4): Word => ({ text, start, end });
  const words = [w("so", 9), w("anyway.", 9.5), w("Here's", 10), w("the", 10.5), w("thing", 11), w("I", 13), w("mean", 13.5), w("wow.", 20), w("ok", 20.5)];
  // start 11.2 → "Here's" (after a sentence end) beats "I" at 13 (after a pause) by distance; end 20.5 → "wow." ends a sentence
  assert.deepEqual(snapToSpeech({ start: 11.2, end: 20.5 }, words), { start: 10, end: 20.4 });
  assert.deepEqual(snapToSpeech({ start: 12.8, end: 14 }, words), { start: 13, end: 13.9 }, "pause before I, end of the last word before the gap");
  assert.deepEqual(snapToSpeech({ start: 50, end: 60 }, words), { start: undefined, end: undefined }, "nothing in range → caller falls back");
  assert.deepEqual(snapToSpeech({ start: 1, end: 5 }, []), { start: undefined, end: undefined });
});

test("fallbackMoments gives generic titles", () => {
  const f = fallbackMoments([{ start: 65, end: 90, score: 1 }, { start: 0, end: 20, score: 0.5 }], 1);
  assert.deepEqual(f, [{ start: 65, end: 90, score: 1, title: "Highlight 1 (1:05)", hook: "Wait for this", reason: "Loudest, most active stretch" }]);
});

test("promptTranscript breaks on sentences, pauses and ~10 s, and trims to candidates", () => {
  const words: Word[] = Array.from({ length: 200 }, (_, i) => ({ start: i * 0.5, end: i * 0.5 + 0.4, text: `w${i}<x>` }));
  const full = promptTranscript(words, []);
  assert.ok(full.startsWith("[0.0s] w0x w1x"), full.slice(0, 30));
  assert.ok(full.includes("\n[10.0s] w20x "), "10 s cap");
  assert.ok(!full.includes("<"));
  const w = (text: string, start: number): Word => ({ text, start, end: start + 0.3 });
  assert.equal(promptTranscript([w("Hi", 83.4), w("there.", 83.7), w("So", 84.0), w("um", 84.3), w("yes", 85.5)], []), "[83.4s] Hi there.\n[84.0s] So um\n[85.5s] yes");
  const cut = promptTranscript(words, [{ start: 60, end: 70, score: 1 }], 200);
  assert.ok(cut.length <= 200 && cut.startsWith("[30.0s]"), cut.slice(0, 20));
});

test("ASS time format and escaping", () => {
  assert.equal(assTime(0), "0:00:00.00");
  assert.equal(assTime(3723.456), "1:02:03.46");
  assert.equal(assTime(-1), "0:00:00.00");
  assert.equal(assText("a{\\b1}c\\N d\nline"), "a(＼b1)c＼N d line");
});

test("captionGroups makes 1-3 word groups, breaking on punctuation, pauses and length", () => {
  const w = (text: string, start: number): Word => ({ text, start, end: start + 0.3 });
  const g = captionGroups([w("I", 0), w("went", 0.3), w("home.", 0.6), w("Then", 0.9), w("a", 1.2), w("b", 1.5), w("c", 1.8), w("later", 5), w("extraordinary", 5.3), w("x", 5.6)]);
  assert.deepEqual(g.map((x) => x.map((y) => y.text).join(" ")), ["I went home.", "Then a b", "c", "later", "extraordinary", "x"]);
});

test("buildAss: hook first 2.5 s, karaoke captions with the spoken word highlighted", () => {
  const ass = buildAss({ hook: "Wait {for} it", words: [{ text: "hello", start: 0.5, end: 1 }, { text: "world}", start: 1, end: 1.5 }, { text: "gone", start: 30, end: 31 }], duration: 20 });
  assert.match(ass, /PlayResX: 1080\nPlayResY: 1920/);
  assert.match(ass, /Dialogue: 1,0:00:00.00,0:00:02.50,Hook,,0,0,0,,WAIT \(FOR\) IT/);
  const hi = (t: string, c = "&H00E5FF&", s = 115) => `{\\c${c}\\t(0,80,\\fscx${s}\\fscy${s})}${t}{\\c&HFFFFFF&\\fscx100\\fscy100}`;
  assert.ok(ass.includes(`Dialogue: 0,0:00:00.50,0:00:01.00,Cap,,0,0,0,,{\\fs86}${hi("HELLO")} WORLD)\n`), ass); // 14 chars + 3: shrunk to fit the safe zone
  assert.ok(ass.includes(`Dialogue: 0,0:00:01.00,0:00:01.50,Cap,,0,0,0,,{\\fs86}HELLO ${hi("WORLD)")}\n`));
  assert.ok(!ass.includes("GONE"));
  assert.ok(!buildAss({ hook: "", words: [], duration: 5 }).includes("Dialogue:"));
  const loud = buildAss({ hook: "", words: [{ text: "no", start: 0, end: 0.3 }, { text: "WAY", start: 0.3, end: 0.6, loud: true }], duration: 5 });
  assert.ok(loud.includes(`NO ${hi("WAY", "&H632EFF&", 135)}`), "a shouted word is cherry and bigger");
});

test("buildAss shrinks a line that wouldn't fit", () => {
  const ass = buildAss({ hook: "", words: [{ text: "Congratulations!!", start: 0, end: 1 }], duration: 5 });
  assert.match(ass, /Cap,,0,0,0,,\{\\fs65\}\{/); // floor(100 * 13 / (17 + 3))
  assert.match(buildAss({ hook: "", words: [{ text: "ten chars", start: 0, end: 1 }], duration: 5 }), /Cap,,0,0,0,,\{\\c/);
});

test("ffmpeg arg builders", () => {
  const r = renderArgs({ input: "C:\\v\\a b.mp4", start: 12.3456, duration: 30, ass: "clip-1.ass", out: "clip-1.mp4" });
  assert.ok(!r.includes("[a]"), "no audio stream, no audio map");
  assert.deepEqual(r.slice(3, 7), ["-ss", "12.346", "-t", "30"]);
  assert.equal(r[r.indexOf("-i") + 1], "C:\\v\\a b.mp4");
  for (const args of [r, probeArgs("x.mp4"), audioArgs("x.mp4", "a.f32"), frameArgs("x.mp4", 1, "f.jpg")]) // inputs are always whitelisted
    assert.equal(args[args.indexOf("-i") - 1], "file");
  assert.ok(r.includes("libx264") && r.includes("+faststart") && r.at(-1) === "clip-1.mp4");
  assert.equal(r[r.indexOf("-ac") + 1], "2", "5.1 sources are downmixed to stereo");
  const a = audioArgs("x.mp4", "a.f32");
  assert.deepEqual(a.slice(a.indexOf("-af"), a.indexOf("-af") + 4), ["-af", "aresample=async=1:first_pts=0", "-f", "f32le"]);
  assert.ok(r[r.indexOf("-filter_complex") + 1].endsWith(",ass=clip-1.ass[v]"));
  assert.throws(() => renderFilter({ duration: 5, ass: "C:\\x\\y.ass" }));
  assert.throws(() => renderFilter({ duration: 5, ass: "a'b.ass" }));
  assert.ok(!renderFilter({ duration: 5 }).includes("ass="));
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
  assert.ok(thumbSvg("unbelievable!!").includes('font-size="80"'), "14 chars at 0.85 em must fit 960 px"); // floor(960 / (14 * 0.85))
  assert.ok(thumbSvg("hi").includes('font-size="170"'));
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
  assert.ok(ytdlpArgs("https://youtu.be/a", "C:/ff").includes("--no-quiet")); // must stay a real flag, not swallowed by a comment
  assert.match(ytdlpError("ERROR: [youtube] x: Sign in to confirm you're not a bot"), /yt-dlp -U/);
  assert.match(ytdlpError("[download] x does not pass filter (duration<=10800 & !is_live), skipping .."), /Live streams/);
  assert.equal(ytdlpError("junk\nERROR: something odd\n"), "something odd");
});

test("long sources: 8 h limit, ≤1080p download that drops to ≤720p for big streams, ffmpeg progress time", () => {
  assert.equal(MAX_SOURCE_SEC, 8 * 3600);
  const a = ytdlpArgs("https://youtu.be/a", "C:/ff");
  assert.equal(a[a.indexOf("--match-filter") + 1], "duration<=28800 & !is_live");
  const f = a[a.indexOf("-f") + 1];
  assert.ok(!/height<=(1440|2160)|bv\*\+/.test(f) && f.startsWith("bv*[height<=1080]") && f.includes("bv*[height<=720]"), f);
  assert.match(ytdlpError("[download] x does not pass filter (duration<=28800 & !is_live), skipping .."), /over 8 hours/);
  assert.equal(ffmpegTime("size=  1kB time=00:00:01.00 bitrate\rsize=  2kB time=01:02:03.50 bitrate=1"), 3723.5);
  assert.equal(ffmpegTime("Duration: 01:00:00.00, start"), null);
});

test("ytdlpArgs keeps the URL last, after --", () => {
  const a = ytdlpArgs("https://youtu.be/--exec=evil", "C:\\ff");
  assert.deepEqual(a.slice(-2), ["--", "https://youtu.be/--exec=evil"]);
  assert.equal(a.indexOf("--"), a.length - 2);
  assert.equal(a[a.indexOf("--ffmpeg-location") + 1], "C:\\ff");
});

test("validOptions and isDownloadId", () => {
  assert.deepEqual(validOptions({}), { count: 5, maxSec: 45, captions: true, layout: "fit", camSide: "right", jumpCuts: true, zooms: true, language: "en",
    coldOpen: true, progressBar: false, loopEnd: true, preset: "viral" });
  assert.match(validOptions({ coldOpen: "yes" }) as string, /coldOpen/);
  assert.equal((validOptions({ progressBar: true }) as { progressBar: boolean }).progressBar, true);
  assert.deepEqual(validOptions({ layout: "split", camSide: "left", jumpCuts: false, zooms: false, language: "auto" }),
    { count: 5, maxSec: 45, captions: true, layout: "split", camSide: "left", jumpCuts: false, zooms: false, language: "auto", coldOpen: true, progressBar: false, loopEnd: true, preset: "viral" });
  for (const bad of [{ count: 11 }, { captions: "yes" }, { layout: "zoom" }, { camSide: "top" }, { jumpCuts: 1 }, { zooms: null }, { language: "de" }, { preset: "funny" }])
    assert.equal(typeof validOptions(bad), "string", JSON.stringify(bad));
  assert.ok(isDownloadId("dl-mgr1abc-a1b2c3"));
  assert.ok(!isDownloadId("../x"));
});

test("cleanWords collapses Whisper repetition loops, keeps normal speech", () => {
  const w = (t: string, i: number) => ({ start: i, end: i + 0.5, text: t });
  const loop = Array.from({ length: 6 }, () => ["I'M", "GOING", "TO", "BE", "NINE", "HOURS."]).flat().map(w);
  assert.equal(cleanWords(loop).map((x) => x.text).join(" "), "I'M GOING TO BE NINE HOURS.");
  const normal = ["go", "go", "now", "we", "won", "we", "won"].map(w); // short repeats (≤2×) stay
  assert.equal(cleanWords(normal).length, 7);
  assert.equal(cleanWords([{ start: 2, end: 1, text: "bad" }, { start: NaN, end: 1, text: "x" }, w("ok", 3)]).length, 1);
});

test("cleanWords drops chunk-overlap duplicates", () => {
  const w = (text: string, start: number): Word => ({ text, start, end: start + 0.3 });
  const doubled = [w("no", 10), w("way", 10.3), w("dude", 10.6), w("no", 10.05), w("way", 10.35), w("dude", 10.62), w("next", 11)];
  assert.equal(cleanWords(doubled).map((x) => x.text).join(" "), "no way dude next");
  assert.equal(cleanWords([w("b", 1), w("a", 0)]).map((x) => x.text).join(" "), "a b", "sorted by start");
});

test("buildAss never shows two captions at once", () => {
  const words = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map((t, i) => ({ start: t, end: t + 2, text: `w${i}.` })); // overlapping timestamps
  const caps = buildAss({ hook: "", words, duration: 10 }).split("\n").filter((l) => l.includes(",Cap,"));
  const toS = (t: string) => { const [h, m, s] = t.split(":"); return +h * 3600 + +m * 60 + +s; };
  const spans = caps.map((l) => l.split(",").slice(1, 3).map(toS));
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] >= spans[i - 1][1] - 1e-9, `caption ${i} overlaps`);
});
