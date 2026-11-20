import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applySourceSignals, clippedIds, nonEnglish, parseProbe, signalPromptLines, sourceSignal, sourceSkip, trendingGames, type SourceCand } from "../src/lib/clips/source-pick-pure.ts";
import { toCandidates } from "../src/lib/clips/scout-pure.ts";
import { ytdlpArgs, YTDLP_META_MARK } from "../src/lib/clips/pure.ts";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const c = (id: string, title: string, o: Partial<SourceCand> = {}): SourceCand => ({ id, title, channel: "Streamer", durationSec: 3600, publishedAt: "2026-11-20T00:00:00Z", stats: { views: 50_000 }, ...o });
const info = JSON.parse(readFileSync(new URL("./fixtures/ytdlp-heatmap-info.json", import.meta.url), "utf8"));

test("clippedIds: video ids from yt-dlp file names of existing jobs", () => {
  assert.deepEqual([...clippedIds(["xQc - GTA chaos [dQw4w9WgXcQ].mp4", "my own recording.mkv", "a [short].mp4"])], ["dQw4w9WgXcQ"]);
});

test("sourceSkip: already clipped, known non-English audio; unknown language kept", () => {
  const done = new Set(["aaaaaaaaaaa"]);
  assert.equal(sourceSkip(c("aaaaaaaaaaa", "x"), done), "clipped");
  assert.equal(sourceSkip(c("bbbbbbbbbbb", "x", { lang: "es" }), done), "lang");
  assert.equal(sourceSkip(c("bbbbbbbbbbb", "x", { lang: "en-US" }), done), "");
  assert.equal(sourceSkip(c("bbbbbbbbbbb", "x"), done), "");
  assert.ok(!nonEnglish("en") && !nonEnglish("en-GB") && nonEnglish("pt-BR") && !nonEnglish(undefined));
  const [v] = toCandidates([{ id: "ccccccccccc", snippet: { title: "t", publishedAt: "2026-11-20T00:00:00Z", defaultAudioLanguage: "de" } }], "keyword");
  assert.equal(v.lang, "de");
});

test("trendingGames: games named in ≥2 titles, hottest first", () => {
  const cs = [c("1", "GTA 5 RP cop chase"), c("2", "NoPixel GTA heist fail", { stats: { views: 400_000 } }), c("3", "Fortnite with friends"), c("4", "Fortnite win"), c("5", "Just chatting"), c("6", "Minecraft hardcore")];
  assert.deepEqual(trendingGames(cs, NOW).map((g) => [g.game, g.videos]), [["GTA", 2], ["Fortnite", 2]]);
});

test("sourceSignal + applySourceSignals: clear replay peaks and a trending game lift a pick, notes explain why", () => {
  const spiky = { heatmap: Array.from({ length: 100 }, (_, i) => ({ start_time: i * 36, end_time: i * 36 + 36, value: i === 60 ? 0.9 : 0.2 })) };
  const probe = parseProbe(`ORBIT_PROBE=${JSON.stringify({ ...spiky, language: "en" })}`)!;
  assert.ok(probe.heat?.clear);
  assert.equal(probe.lang, "en");
  assert.equal(parseProbe("ORBIT_PROBE={bad"), null);
  assert.equal(parseProbe("[youtube] x"), null);
  assert.equal(parseProbe(`ORBIT_PROBE=${JSON.stringify({ heatmap: null })}`)!.heat, null); // no heatmap: neutral
  const flatMap = { heatmap: Array.from({ length: 100 }, (_, i) => ({ start_time: i * 216, end_time: i * 216 + 216, value: 0.3 + 0.02 * Math.sin(i) })) };
  const hot = sourceSignal(c("a", "GTA 5 police escape"), { trending: ["GTA"], probe });
  assert.ok(hot.delta >= 15, String(hot.delta));
  assert.ok(hot.notes.some((n) => /replay peaks 4\.\d× avg/.test(n)) && hot.notes.includes("🔥 trending game: GTA"));
  const flat = sourceSignal(c("b", "Podcast", { durationSec: 6 * 3600 }), { trending: ["GTA"], probe: parseProbe(`ORBIT_PROBE=${JSON.stringify(flatMap)}`)! });
  assert.ok(flat.notes.includes("📉 flat replay graph"));
  assert.ok(parseProbe(`ORBIT_PROBE=${JSON.stringify(info)}`)!.heat!.clear); // the real one: chorus replayed 2× avg
  assert.ok(flat.delta < 0);
  const picks = applySourceSignals([{ videoId: "b", score: 70 }, { videoId: "a", score: 60 }], new Map([["a", hot], ["b", flat]]));
  assert.deepEqual(picks.map((p) => p.videoId), ["a", "b"]);
  assert.ok(picks[0].score <= 100 && picks[0].signals!.length >= 2);
  const lines = signalPromptLines([c("a", "x"), c("b", "y")], new Map([["a", probe]]), ["GTA"]);
  assert.match(lines, /trending.*GTA/);
  assert.match(lines, /id=a: YouTube "Most replayed" graph peaks at 4\.\d×/);
  assert.ok(!/id=b/.test(lines));
});

test("download asks yt-dlp to print the heatmap meta in the same run (no extra request)", () => {
  const a = ytdlpArgs("https://youtu.be/a", "C:/ff");
  const i = a.findIndex((x) => x.includes(YTDLP_META_MARK));
  assert.ok(i > 0 && a[i - 1] === "--print" && /^after_move:ORBIT_META=%\(\.\{heatmap,title,uploader/.test(a[i]), a[i]);
  assert.equal(a.indexOf("--"), a.length - 2);
});
