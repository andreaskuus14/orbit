import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  chatBurst, fuseSignals, fusedPeaks, heatStats, heatmapCurve, hypeToken, packHeatmap, parseHeatmap, reasonsFor, talkExcitement, topWindows, windowMoments, zFinite,
} from "../src/lib/clips/moments-pure.ts";
import { parseYouTubeChat } from "../src/lib/clips/hype-pure.ts";
import { detectGame, focusGuide, resolveFocus } from "../src/lib/clips/game-pure.ts";

// Real yt-dlp 2026.10.26 output (-J, trimmed to the fields ORBIT reads) of a public 3:33 music video, fetched from the sandbox.
const info = JSON.parse(readFileSync(new URL("./fixtures/ytdlp-heatmap-info.json", import.meta.url), "utf8"));

test("parseHeatmap: yt-dlp info JSON, a bare array, packed triples; bad points dropped; <10 points = none", () => {
  const pts = parseHeatmap(info);
  assert.equal(pts.length, 100);
  assert.deepEqual(pts[0], { start: 0, end: 2.14, value: 1 });
  assert.deepEqual(parseHeatmap(info.heatmap), pts);
  assert.deepEqual(parseHeatmap(packHeatmap(pts)).length, 100);
  assert.deepEqual(parseHeatmap([...info.heatmap.slice(0, 12), { start_time: 5, end_time: 4, value: 1 }, { start_time: "x" }, null]).length, 12);
  assert.deepEqual(parseHeatmap(info.heatmap.slice(0, 9)), []);
  assert.deepEqual(parseHeatmap({ heatmap: null }), []);
  assert.deepEqual(parseHeatmap("nope"), []);
});

test("heatmapCurve: per second, opening bias capped, the real replay bump (first chorus ~0:43) is the top", () => {
  const pts = parseHeatmap(info), c = heatmapCurve(pts, info.duration)!;
  assert.equal(c.length, Math.ceil(info.duration));
  assert.ok(c[0] < 0.2, `opening capped: ${c[0]}`); // raw value is 1.0 at 0:00 — everybody watches the start
  const top = c.indexOf(Math.max(...c.slice(10)));
  assert.ok(top >= 40 && top <= 50, `peak at ${top}s`);
  assert.equal(heatmapCurve([], 100), null);
  assert.equal(heatmapCurve(Array.from({ length: 20 }, (_, i) => ({ start: i * 5, end: i * 5 + 5, value: 0.5 })), 100), null); // flat
  const st = heatStats(pts)!;
  assert.ok(st.peakX >= 1.4 && st.peakAt > 40 && st.peakAt < 50, JSON.stringify(st));
  const spiky = Array.from({ length: 100 }, (_, i) => ({ start: i * 36, end: i * 36 + 36, value: i === 60 ? 0.9 : i === 20 ? 0.7 : 0.2 }));
  assert.deepEqual(heatStats(spiky), { peakX: 4.2, peakAt: 2178, peaks: 2, clear: true });
});

// yt-dlp's <name>.live_chat.json: one replayChatItemAction per line.
const ytLine = (ms: number, author: string, runs: object[]) => JSON.stringify({ replayChatItemAction: { videoOffsetTimeMsec: String(ms), actions: [{ addChatItemAction: { clientId: "x",
  item: { liveChatTextMessageRenderer: { message: { runs }, authorName: { simpleText: author }, authorExternalChannelId: `UC${author}` } } } }] } });

test("chat replay: live_chat JSON lines → messages/second and emote bursts (KEKW, 💀, W, laughs, caps)", () => {
  const lines: string[] = [];
  for (let s = 0; s < 120; s++) lines.push(ytLine(s * 1000 + 300, `u${s % 7}`, [{ text: "anyone know the song?" }])); // 1 msg/s background
  const wall = ["KEKW", "KEKW KEKW", "LMAOOO", "W", "NO WAY BRO", "hahaha", "OMEGALUL"];
  for (let k = 0; k < 40; k++) lines.push(ytLine(65_000 + k * 100, `v${k}`, k % 5 === 0 ? [{ emoji: { emojiId: "💀", shortcuts: [":skull:"] } }] : [{ text: wall[k % wall.length] }]));
  const msgs = parseYouTubeChat(lines.join("\n"));
  assert.equal(msgs.length, 160);
  const { burst, top } = chatBurst(msgs, 120, 3); // chat reacts ~3 s late: moved earlier
  assert.equal(burst.slice(0, 60).reduce((a, b) => a + b, 0), 0);
  assert.equal(burst[62] + burst[63] + burst[64] + burst[65], 40);
  assert.equal(top.get(62), "KEKW");
  for (const [t, want] of [["KEKW", "KEKW"], ["W", "W"], ["w", null], ["LMAOOO", "LAUGH"], ["hahaha", "LAUGH"], ["THAT WAS INSANE", "CAPS"], ["ok", null], ["💀💀", "💀💀"], [":skull:", ":skull:"]] as const)
    assert.equal(hypeToken(t), want, t);
});

test("talkExcitement: shouted/hype words count, NaN outside the transcribed spans", () => {
  const words = [{ start: 10.2, end: 10.5, text: "okay" }, { start: 20.1, end: 20.4, text: "NO" }, { start: 20.4, end: 20.7, text: "way!", loud: true }, { start: 20.7, end: 21, text: "bro" }];
  const t = talkExcitement(words, [{ start: 5, end: 30 }], 40);
  assert.ok(Number.isNaN(t[2]) && Number.isNaN(t[35]));
  assert.equal(t[6], 0);
  assert.equal(t[10], 0.25);
  assert.ok(t[20] > 5, String(t[20]));
});

const flat = (n: number, v = 1) => new Array<number>(n).fill(v);
const noisy = (n: number, seed = 1) => Array.from({ length: n }, (_, i) => 1 + 0.2 * Math.sin(i * 1.7 + seed) + 0.1 * Math.cos(i * 0.37 * seed));
const bump = (xs: number[], at: number, w: number, h: number) => xs.map((x, i) => (Math.abs(i - at) <= w ? x + h : x));

test("fusion: windows land on the replay + chat spike, reasons quote × avg; a missing signal is renormalized away", () => {
  const secs = 600;
  const replay = bump(noisy(secs, 2).map((x) => x * 0.2), 300, 8, 0.6); // the replay graph spikes at 5:00
  const chat = bump(noisy(secs, 3), 302, 4, 6);
  const loud = bump(noisy(secs, 4), 120, 3, 3); // a loud moment nobody rewatched
  const f = fuseSignals({ replay, chat, loud }, secs);
  assert.deepEqual(f.used, ["replay", "chat", "loud"]);
  const ws = topWindows(f, { replay, chat, loud }, { maxSec: 45, duration: secs, n: 3 });
  assert.ok(ws[0].start <= 300 && ws[0].end >= 304, JSON.stringify(ws[0]));
  assert.match(ws[0].reasons.join(", "), /replayed \d\.\d× avg/);
  assert.match(ws[0].reasons.join(", "), /chat \d\.\d× avg/);
  assert.ok(ws.some((w) => w.start <= 120 && w.end >= 121), "the loud moment is still a candidate");
  assert.ok(ws.every((w, i) => ws.every((x, j) => i === j || w.end <= x.start || x.end <= w.start)), "no overlaps");
  assert.deepEqual(reasonsFor({ start: 290, end: 320 }, ws), ws[0].reasons);

  // No heatmap: same fusion of the rest, never NaN.
  const g = fuseSignals({ chat, loud }, secs);
  assert.deepEqual(g.used, ["chat", "loud"]);
  assert.ok(g.curve.every(Number.isFinite));
  // Talk only known inside a span: outside it, the other signals alone decide (renormalized, not dragged to 0).
  const talk = new Array<number>(secs).fill(NaN).map((_, i) => (i >= 100 && i < 200 ? (i === 150 ? 9 : 0.3 + 0.1 * Math.sin(i)) : NaN));
  const h = fuseSignals({ loud, talk }, secs), lo = fuseSignals({ loud }, secs);
  assert.ok(Math.abs(h.curve[400] - lo.curve[400]) < 1e-9, "outside the span talk is absent, not zero");
  assert.ok(h.curve[150] > lo.curve[150] + 0.5);
  // Flat or empty signals are dropped; nothing left → no windows, curve 0.
  const none = fuseSignals({ replay: flat(secs), chat: [] }, secs);
  assert.deepEqual(none.used, []);
  assert.deepEqual(topWindows(none, {}, { maxSec: 45, duration: secs }), []);
  assert.ok(fusedPeaks(f, { replay, chat, loud }).some((p) => Math.abs(p.t - 301) <= 6));
  const m = windowMoments(ws, 2);
  assert.equal(m.length, 2);
  assert.match(m[0].reason, /^Audience signals: replayed/);
});

test("zFinite: robust, NaN kept, floored at -2", () => {
  const z = zFinite([1, 1, 2, 1, 1, NaN, 50, 1, 0]);
  assert.ok(Number.isNaN(z[5]));
  assert.ok(z[6] > 2.5 && z.every((v) => Number.isNaN(v) || v >= -2));
  assert.ok(zFinite([1, 2, NaN]).every(Number.isNaN)); // too few values to judge
});

test("game presets: detection from title/channel, auto → gta/game/general, explicit wins, guidance text", () => {
  assert.equal(detectGame("xQc - GTA RP NoPixel 4.0 cop chase [abc123def45].mp4"), "GTA");
  assert.equal(detectGame("Grand Theft Auto V funny moments"), "GTA");
  assert.equal(detectGame("Kai Cenat plays FORTNITE with Ninja"), "Fortnite");
  assert.equal(detectGame("Our trip to Rome vlog"), null);
  assert.equal(detectGame("I pushed my code to the repo"), null);
  assert.deepEqual(resolveFocus("auto", { text: "Summit1g - GTA 5 police escapes" }), { focus: "gta", game: "GTA" });
  assert.deepEqual(resolveFocus(undefined, { text: "Elden Ring first time playing" }), { focus: "game", game: "Elden Ring" });
  assert.deepEqual(resolveFocus("auto", { text: "Some indie thing", categories: ["Gaming"] }), { focus: "game", game: null });
  assert.deepEqual(resolveFocus("auto", { text: "Podcast ep 12 with Bob" }), { focus: "general", game: null });
  assert.deepEqual(resolveFocus("general", { text: "GTA 5 chaos" }), { focus: "general", game: null });
  assert.deepEqual(resolveFocus("gta", { text: "stream" }), { focus: "gta", game: "GTA" });
  assert.match(focusGuide("gta"), /police chases/);
  assert.match(focusGuide("gta"), /clutch/); // GTA builds on the game guide
  assert.match(focusGuide("game"), /fails/);
  assert.equal(focusGuide("general"), "");
});

test("parseSourceMeta: the ORBIT_META print line / info JSON → cleaned fields, round-trips through storeMeta", async () => {
  const { parseSourceMeta, storeMeta, focusText } = await import("../src/lib/clips/moments-pure.ts");
  const m = parseSourceMeta(JSON.stringify(info))!;
  assert.equal(m.heatmap.length, 100);
  assert.equal(m.uploader, "Rick Astley");
  assert.equal(m.language, "en");
  assert.deepEqual(parseSourceMeta(storeMeta(m)), m);
  assert.equal(parseSourceMeta("{bad"), null);
  assert.deepEqual(parseSourceMeta({ heatmap: null, title: "<b>GTA</b>", tags: ["a", 3] }), { heatmap: [], title: "b GTA /b", uploader: "", language: "", categories: [], tags: ["a"], wasLive: false });
  assert.match(focusText("x.mp4", m), /^x\.mp4 \| Rick Astley - Never/);
});
