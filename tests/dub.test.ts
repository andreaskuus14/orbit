import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONSENT_TEXT, MAX_SPEED, MAX_TEMPO, burnArgs, dubBlocked, dubCaptionWords, dubProgress, dubPrompt, dubSegments, lineArgs, maxChars, missingLines, mixArgs,
  otherLang, parseDub, sourceLang, speedFor, tempoFor, wavSeconds, type ClipDub,
} from "../src/lib/clips/dub-pure.ts";
import { studioWork } from "../src/lib/planet-page-pure.ts";
import { videoResource } from "../src/lib/yt-analytics-pure.ts";
import { encodeWav } from "../src/lib/local-ai-pure.ts";

const w = (start: number, end: number, text: string) => ({ start, end, text });

test("lines: break at sentence ends, pauses and length; slot runs to just before the next line", () => {
  const s = dubSegments([w(0.2, 0.5, "Hey"), w(0.5, 0.9, "guys."), w(1.0, 1.4, "Today"), w(1.4, 1.8, "I"), w(1.8, 2.2, "built"), w(3.5, 3.9, "this"), w(3.9, 4.3, "level")], 6);
  assert.deepEqual(s.map((x) => x.text), ["Hey guys.", "Today I built", "this level"]);
  assert.equal(s[0].slotEnd, 1.0 - 0.08);
  assert.equal(s[2].slotEnd, 6);
  assert.ok(s.every((x) => x.slotEnd >= x.end));
  const long = dubSegments(Array.from({ length: 40 }, (_, i) => w(i * 0.3, i * 0.3 + 0.25, "word")), 20);
  assert.ok(long.length >= 2 && long.every((x) => x.end - x.start <= 7.01));
  assert.deepEqual(dubSegments([w(NaN, 1, "x"), w(2, 1, "y"), w(9, 10, "late")], 5), []);
});

test("language: Estonian words or letters → et, else en; the dub goes the other way", () => {
  assert.equal(sourceLang("täna ma ehitasin oma mängu uue taseme ja see on väga hea".split(" ").map((t) => ({ text: t }))), "et");
  assert.equal(sourceLang("today I built a new level for my game and it is very good".split(" ").map((t) => ({ text: t }))), "en");
  assert.equal(sourceLang([]), "en");
  assert.equal(otherLang("en"), "et"); assert.equal(otherLang("et"), "en");
});

test("translation prompt carries a length budget per line; reply parsed, junk and far-too-long lines dropped", () => {
  const segs = dubSegments([w(0, 0.4, "Hey"), w(0.4, 1, "guys."), w(1.2, 3, "This <b>is</b> wild")], 4);
  const p = JSON.parse(dubPrompt({ title: "My {title}", hook: "Look", segs, to: "et" }));
  assert.equal(p.lines.length, 2);
  assert.equal(p.lines[0].max, maxChars(segs[0], "et"));
  assert.ok(![p.title, ...p.lines.map((l: { text: string }) => l.text)].some((x) => /[<>{}]/.test(x)));
  const reply = `Sure: {"title":"Minu pealkiri","hook":"vaata seda siin kohe nüüd palun","lines":[{"i":0,"t":"Tere!"},{"i":1,"t":"${"x".repeat(400)}"},{"i":7,"t":"no"}]}`;
  const d = parseDub(reply, segs, "et");
  assert.equal(d.title, "Minu pealkiri");
  assert.equal(d.hook.split(" ").length, 6);
  assert.deepEqual(d.lines, ["Tere!", null]);
  assert.deepEqual(missingLines(d), [1]);
  assert.deepEqual(parseDub("not json", segs, "et").lines, [null, null]);
});

test("fitting: faster voice first (capped), then tempo (capped), then a trim", () => {
  assert.equal(speedFor(2, 3), 1);
  assert.equal(speedFor(3.3, 3), 1.13);
  assert.equal(speedFor(10, 3), MAX_SPEED);
  assert.deepEqual(tempoFor(2, 3), { tempo: 1, trim: false });
  const t = tempoFor(3.2, 3);
  assert.ok(t.tempo > 1 && t.tempo <= MAX_TEMPO + 0.01 && !t.trim);
  assert.deepEqual(tempoFor(5, 3), { tempo: MAX_TEMPO, trim: true });
  assert.ok(lineArgs("a.wav", "b.wav", { tempo: 1.1, trim: true, slot: 2 }).join(" ").includes("atempo=1.1,atrim=0:2.000,afade=t=out:st=1.940"));
  assert.ok(!lineArgs("a.wav", "b.wav", { tempo: 1, trim: false, slot: 2 }).join(" ").includes("atempo"));
});

test("captions follow the said lines; mix places each line at its start; burn keeps the dub audio", () => {
  const cw = dubCaptionWords([{ text: "Tere kõigile", at: 1, dur: 2 }, { text: "jah", at: 4, dur: 0.5 }]);
  assert.deepEqual(cw.map((x) => x.text), ["Tere", "kõigile", "jah"]);
  assert.ok(cw[0].start === 1 && cw[1].start > cw[0].end - 1e-9 && cw[1].end <= 3 && cw[2].start === 4);
  const m = mixArgs({ background: "bg.wav", lines: [{ file: "l0.wav", at: 1.25 }, { file: "l1.wav", at: 4 }], total: 10, out: "o.wav" }).join(" ");
  assert.ok(m.includes("adelay=1250:all=1") && m.includes("adelay=4000:all=1") && m.includes("amix=inputs=3") && m.includes("atrim=0:10.000"));
  const b = burnArgs({ video: "v.mp4", audio: "d.wav", ass: "captions.ass", out: "f.mp4", encoder: "x264" });
  assert.deepEqual(b.slice(b.indexOf("-map"), b.indexOf("-map") + 4), ["-map", "0:v:0", "-map", "1:a:0"]);
  assert.ok(b.includes("subtitles=captions.ass"));
});

test("who may be dubbed: approved, own footage, his consent + sample; never a dub of a dub or the recap", () => {
  const own = { source: "rec.mp4", options: {}, rights: { basis: "own" } };
  const ok = { consent: true, sample: true };
  const clip = { status: "approved", video: "clips/j/c.mp4" };
  assert.equal(dubBlocked(own, clip, ok), "");
  assert.equal(dubBlocked({ source: "rec.mp4", options: { preset: "devlog" } }, clip, ok), "");
  assert.match(dubBlocked({ source: "x.mp4", options: {}, rights: { basis: "licensed" } }, clip, ok), /own videos/);
  assert.match(dubBlocked({ source: "x.mp4", options: {} }, clip, ok), /own videos/);
  assert.match(dubBlocked(own, { ...clip, status: "ready" }, ok), /Approve/);
  assert.match(dubBlocked(own, { ...clip, dub: {} }, ok), /already a dub/);
  assert.match(dubBlocked(own, clip, { consent: false, sample: true }), /Settings/);
  assert.match(dubBlocked(own, clip, { consent: true, sample: false }, "et"), /Seaded/);
  assert.match(dubBlocked({ ...own, source: "ORBIT daily recap: 2026-11-21" }, clip, ok), /never posted/);
  assert.ok(CONSENT_TEXT.includes("my own voice"));
});

test("progress: one shared card per dub with plain steps, the line it's on, review button when done; a restart shows as failed", () => {
  const NOW = Date.parse("2026-11-21T12:00:00Z");
  const d = (o: Partial<ClipDub>): ClipDub => ({ lang: "et", from: "en", of: "c1", stage: "voicing", startedAt: "2026-11-21T11:58:00Z", at: "2026-11-21T11:59:00Z", line: 3, lines: 9, ...o });
  const p = dubProgress({ id: "c1-v2", title: "Big win", status: "rendering", dub: d({}) }, "j1", "en", NOW)!;
  assert.equal(p.phase, "working");
  assert.equal(p.title, "Estonian version: Big win");
  assert.equal(p.now, "Saying line 3 of 9 in your voice");
  assert.deepEqual(p.steps.map((s) => s.state), ["done", "done", "done", "now", "next"]);
  const done = dubProgress({ id: "c1-v2", title: "Suur võit", status: "ready", dub: d({ stage: "done" }) }, "j1", "et", NOW)!;
  assert.equal(done.phase, "needs"); assert.equal(done.action?.label, "Vaata üle");
  const fail = dubProgress({ id: "c1-v2", title: "x", status: "failed", dub: d({ stage: "separating" }) }, "j1", "en", NOW)!;
  assert.equal(fail.phase, "failed"); assert.deepEqual(fail.steps.map((s) => s.state), ["done", "done", "failed", "next", "next"]);
  assert.equal(dubProgress({ id: "c", title: "x", status: "ready", dub: d({ stage: "done", at: "2026-11-19T00:00:00Z" }) }, "j1", "en", NOW), null);
  const cards = studioWork([{ id: "j1", source: "rec.mp4", createdAt: "2026-11-20T10:00:00Z", updatedAt: "2026-11-20T10:00:00Z", status: "done",
    clips: [{ id: "c1", status: "approved" }, { id: "c1-v2", status: "rendering", title: "Big win", dub: d({}) }] }], [], "en", NOW);
  assert.ok(cards.some((c) => c.id === "dub:j1/c1-v2" && c.phase === "working"));
});

test("a dub always uploads with YouTube's altered/synthetic label", () => {
  const v = videoResource({}, { title: "T", hook: "h", dub: { lang: "et" } });
  assert.ok(typeof v !== "string" && v.status.containsSyntheticMedia === true);
  const plain = videoResource({}, { title: "T", hook: "h" });
  assert.ok(typeof plain !== "string" && plain.status.containsSyntheticMedia === undefined);
});

test("wavSeconds reads the data chunk of a PCM WAV", () => {
  assert.equal(wavSeconds(encodeWav(new Float32Array(22050), 22050)), 1);
  assert.equal(wavSeconds(new Uint8Array([1, 2, 3])), 0);
});
