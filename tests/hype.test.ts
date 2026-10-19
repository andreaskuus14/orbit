import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alignToPeak, buildHype, chatSeries, estimateDelay, findPeaks, hypeRegions, packHype, parseTwitchChat, parseYouTubeChat, peakInside, robustZ, shiftEarlier, voiceWindows,
  type ChatMsg,
} from "../src/lib/clips/hype-pure.ts";

// yt-dlp's <name>.live_chat.json: one replayChatItemAction per line (shape from yt_dlp/downloader/youtube_live_chat.py).
const ytLine = (ms: number, item: object) => JSON.stringify({ replayChatItemAction: { actions: [{ addChatItemAction: { item, clientId: "x" } }], videoOffsetTimeMsec: String(ms) } });
const text = (author: string, runs: object[]) => ({ liveChatTextMessageRenderer: { message: { runs }, authorName: { simpleText: author }, authorExternalChannelId: `UC${author}`, timestampUsec: "1" } });

test("parseYouTubeChat: text, emoji shortcuts, super chats, memberships; bad lines skipped", () => {
  const file = [
    ytLine(12_500, text("ann", [{ text: "NO WAY " }, { emoji: { emojiId: "💀", shortcuts: [":skull:"] } }])),
    "not json",
    ytLine(3_000, { liveChatPaidMessageRenderer: { message: { runs: [{ text: "gg" }] }, authorName: { simpleText: "bob" }, purchaseAmountText: { simpleText: "$5.00" } } }),
    ytLine(4_000, { liveChatMembershipItemRenderer: { headerSubtext: { runs: [{ text: "Welcome to the club" }] }, authorExternalChannelId: "UCcat" } }),
    ytLine(5_000, { liveChatViewerEngagementMessageRenderer: { message: { runs: [{ text: "Chat rules" }] } } }), // system notice: ignored
    JSON.stringify({ addChatItemAction: {} }),
    "",
  ].join("\n");
  const m = parseYouTubeChat(file);
  assert.deepEqual(m.map((x) => [x.t, x.kind, x.text, x.author]), [[3, "donation", "gg", "bob"], [4, "sub", "Welcome to the club", "UCcat"], [12.5, "msg", "NO WAY :skull:", "UCann"]]);
});

test("parseTwitchChat: TwitchDownloader / rechat comments shape, subs, raids, bits", () => {
  const json = { video: { id: "1" }, comments: [
    { content_offset_seconds: 61.2, commenter: { _id: "11", display_name: "Zed" }, message: { body: "KEKW KEKW", fragments: [] } },
    { content_offset_seconds: 10, commenter: { _id: "12" }, message: { body: "Cheer100 lets go", bits_spent: 100 } },
    { content_offset_seconds: 20, commenter: { _id: "13" }, message: { body: "subbed!", user_notice_params: { "msg-id": "resub" } } },
    { content_offset_seconds: 30, commenter: { _id: "14" }, message: { body: "StreamerX is raiding with 500 viewers" } },
    { content_offset_seconds: "bad" },
  ] };
  const m = parseTwitchChat(json);
  assert.deepEqual(m.map((x) => [x.t, x.kind, x.author]), [[10, "donation", "12"], [20, "sub", "13"], [30, "raid", "14"], [61.2, "msg", "11"]]);
  assert.deepEqual(parseTwitchChat(json.comments).length, 4); // a bare array works too
  assert.deepEqual(parseTwitchChat(null), []);
});

const msg = (t: number, author: string, text: string, kind: ChatMsg["kind"] = "msg"): ChatMsg => ({ t, author, text, kind });

test("chatSeries: rate, unique chatters, emote bursts (top token), clip spam, events", () => {
  const msgs = [msg(0.1, "a", "hi"), msg(1.1, "a", "KEKW"), msg(1.2, "b", "KEKW lol"), msg(1.3, "c", "kekw"), msg(1.5, "c", "clip it"), msg(1.9, "d", "CLIP"),
    msg(2.5, "e", "W"), msg(2.6, "f", "W W W"), msg(2.7, "g", "L"), msg(3.0, "x", "sub", "sub")];
  const s = chatSeries(msgs, 4);
  assert.deepEqual(s.rate, [1, 5, 3, 0]);
  assert.deepEqual(s.uniq, [1, 4, 3, 0]);
  assert.equal(s.emote[1], 3); // KEKW in 3 messages (case-folded)
  assert.equal(s.top.get(1), "KEKW");
  assert.equal(s.emote[2], 2); // W twice, L once
  assert.equal(s.top.get(2), "W");
  assert.equal(s.emote[0], 0);
  assert.deepEqual(s.clip, [0, 2, 0, 0]);
  assert.deepEqual(s.events, [0, 0, 0, 1]);
});

test("robustZ: spikes stand out, flat input is all zero, quiet chat falls back to std", () => {
  const z = robustZ([1, 1.1, 0.9, 1, 1.05, 0.95, 10]);
  assert.ok(z[6] > 8 && Math.abs(z[0]) < 1);
  assert.deepEqual(robustZ([2, 2, 2]), [0, 0, 0]);
  const q = robustZ([0, 0, 0, 0, 0, 0, 5]); // MAD = 0
  assert.ok(q[6] > 2);
  assert.equal(q[0], 0); // centred on the median
});

test("estimateDelay + shiftEarlier: chat 6 s behind the audio is detected and moved back", () => {
  const audio = new Array(300).fill(0), chat = new Array(300).fill(0);
  for (const t of [40, 110, 190, 250]) { audio[t] = 10; chat[t + 6] = 30; chat[t + 7] = 20; }
  assert.equal(estimateDelay(chat, audio), 6);
  assert.equal(shiftEarlier(chat, 6)[40], 30);
  assert.equal(estimateDelay(new Array(300).fill(1), audio), 5); // no correlation: default
});

test("findPeaks: prominence, min gap, half-height window, sharpness", () => {
  const c = new Array(200).fill(0);
  const bump = (t: number, h: number, w: number) => { for (let i = -w; i <= w; i++) if (c[t + i] !== undefined) c[t + i] = Math.max(c[t + i], h * (1 - Math.abs(i) / (w + 1))); };
  bump(50, 5, 6); bump(58, 3, 3); bump(150, 4, 4); bump(100, 0.6, 2); // 58 is inside 50's gap, 100 is under minHeight
  const p = findPeaks(c, { minGap: 20 });
  assert.deepEqual(p.map((x) => x.t), [50, 150]);
  assert.ok(p[0].start <= 47 && p[0].start >= 44 && p[0].end >= 53 && p[0].end <= 56);
  assert.ok(p[0].sharp > 3);
});

test("buildHype: audio-only finds the scream; chat with delay is shifted onto it, with reasons", () => {
  const dur = 600, rms = new Array(dur * 2).fill(0.02);
  for (let i = 0; i < rms.length; i++) rms[i] += 0.004 * Math.sin(i / 7); // background game audio
  for (let w = 600; w < 606; w++) rms[w] = 0.3; // scream at 300-303 s
  const audioOnly = buildHype({ rms, duration: dur });
  assert.equal(audioOnly.chatMsgs, 0);
  assert.ok(Math.abs(audioOnly.peaks[0].t - 301) <= 3, `peak at ${audioOnly.peaks[0].t}`);
  assert.deepEqual(audioOnly.chatX, []);

  const chat: ChatMsg[] = [];
  for (let t = 0; t < dur; t += 2) chat.push(msg(t + 0.5, `u${t % 7}`, "chatting")); // 0.5 msg/s baseline
  for (let k = 0; k < 60; k++) chat.push(msg(305.5 + (k % 4) + k / 100, `fan${k}`, k % 3 ? "OMEGALUL" : "CLIP IT")); // burst ~6 s after the scream
  const h = buildHype({ rms, duration: dur, chat: chat.sort((a, b) => a.t - b.t) });
  assert.ok(h.delay >= 5 && h.delay <= 7, `delay ${h.delay}`);
  const top = h.peaks[0];
  assert.ok(Math.abs(top.t - 302) <= 4, `peak at ${top.t}`);
  assert.ok(top.reasons.some((r) => /chat \d+(\.\d)?× normal/.test(r)), top.reasons.join(" | "));
  assert.ok(top.reasons.some((r) => /OMEGALUL spam|"clip it"/.test(r)), top.reasons.join(" | "));
  assert.ok(Math.max(...h.chatX.slice(298, 308)) > 5);
});

test("alignToPeak: payoff inside with a lead-in and reaction; untouched without a nearby peak", () => {
  const peaks = [{ t: 100, start: 95, end: 104, height: 6, sharp: 4, reasons: [] }];
  assert.deepEqual(alignToPeak({ start: 70, end: 99 }, peaks, 45, 600), { start: 70, end: 102.5 }); // reaction kept
  assert.deepEqual(alignToPeak({ start: 99, end: 125 }, peaks, 45, 600), { start: 97, end: 125 }); // build-up added
  const long = alignToPeak({ start: 60, end: 99 }, peaks, 30, 600);
  assert.ok(long.end - long.start <= 30 && long.start <= 99 && long.end >= 102.5);
  const far = { start: 200, end: 230, title: "x" };
  assert.equal(alignToPeak(far, peaks, 45, 600), far);
  assert.equal(peakInside({ start: 90, end: 110 }, peaks)?.t, 100);
});

test("hypeRegions: peaks get transcribed first, within the budget", () => {
  const peaks = [{ t: 1000, start: 990, end: 1005, height: 5, sharp: 3, reasons: [] }];
  const r = hypeRegions(peaks, [{ start: 0, end: 100 }, { start: 2000, end: 2100 }], 160, 3000);
  assert.deepEqual(r, [{ start: 0, end: 100 }, { start: 960, end: 1015 }]); // 55 + 100 fit, the last region doesn't
});

test("voiceWindows: one value per second, louder in the voice band than at 50 Hz", () => {
  const sr = 16000, tone = (f: number) => Float32Array.from({ length: sr * 2 }, (_, i) => Math.sin((2 * Math.PI * f * i) / sr));
  const v = voiceWindows(tone(1000)), lo = voiceWindows(tone(50));
  assert.equal(v.length, 2);
  assert.ok(v[1] > 3 * lo[1]);
});

test("packHype: downsampled by max, normalized, peaks kept", () => {
  const h = buildHype({ rms: Array.from({ length: 4000 }, (_, i) => (i === 3000 ? 0.5 : 0.02)), duration: 2000 });
  const v = packHype(h, { hint: "x" }, 100);
  assert.equal(v.bucketSec, 20);
  assert.equal(v.curve.length, 100);
  assert.equal(Math.max(...v.curve), 1);
  assert.equal(v.chat, undefined);
  assert.equal(v.hint, "x");
  assert.ok(v.peaks.length >= 1);
});

test("alignToPeak: cutting down keeps the full lead before the peak", () => {
  const r = alignToPeak({ start: 100, end: 160 }, [{ t: 98, height: 5, prom: 4, start: 95, end: 100, sharp: 1, reasons: [] } as never], 60, 999);
  assert.equal(r.start, 95);
  assert.equal(r.end, 155);
});
