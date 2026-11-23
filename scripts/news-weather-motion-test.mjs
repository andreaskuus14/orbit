#!/usr/bin/env node
// INTELLIGENCE news weather — deterministic 7.4 s motion test (owner's rule: one polished 5–8 s test before the full build).
// Renders the real renderer (src/components/news-weather/weather-draw.ts) and the real state machine (news-weather-tour-pure)
// on the 22 Nov fixture in headless Chrome, stepping a fixed 60 fps clock, one screenshot per frame, piped to ffmpeg.
//   node scripts/news-weather-motion-test.mjs <out.mp4> [stillsDir]
// Beats: rest hold → press Play (anticipation dip, settle) → rest HUD leaves (staggered) → camera arcs to the first story with
// a trail → beams land one by one (bright = read in full) → lower third builds in → hold with the voice bar.
// The video is silent: the app plays the briefing's Kokoro audio, which this box can't make.
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [out = "news-weather-motion-test.mp4", stillsDir] = process.argv.slice(2);
const FPS = 60, W = 1280, H = 720, DPR = 1.5;

const entry = `
import fx from "./tests/fixtures/news-weather-22nov.json";
import { createWeatherDraw, peaksOf } from "@/components/news-weather/weather-draw";
import { weather, tourPlan, sinceLast, snapshotOf } from "@/lib/news-weather-pure";
import { restView, storyView, TEST } from "@/lib/news-weather-motion-pure";
import { frameAt, CTL0 } from "@/lib/news-weather-tour-pure";
import { wxText, tourLength } from "@/lib/news-weather-text-pure";
const W = ${W}, H = ${H}, DPR = ${DPR};
const wx = weather(fx.geo.hotspots, fx.briefing, "en");
// "Since you last looked": a snapshot from this morning, when Iran had 4 outlets and there was no UK–Turkey front.
const prev = snapshotOf(wx.systems.map((s) => s.key === "Iran" ? { ...s, outlets: 4 } : s), wx.fronts.filter((f) => !/United Kingdom/.test(f.key)), 0);
const plan = tourPlan(wx.stops.length);
const free = { x: 0, y: 0, w: W, h: H };
const rest = restView(fx.geo.hotspots.map((h) => ({ lon: h.lon, lat: h.lat, reports: h.count })), free);
const views = wx.stops.map((s) => storyView(s.system, free));
const t = wxText("en");
const model = { systems: wx.systems, fronts: wx.fronts, isobars: wx.isobars, title: t.title + " · Sunday", forecast: wx.forecast,
  since: sinceLast(prev, wx.systems, wx.fronts).map((c) => c.text), playSub: tourLength(6, 70000, "en"), canPlay: true, text: t };
const c = document.getElementById("c");
const d = createWeatherDraw(c, { sans: "Inter, sans-serif", mono: "'JetBrains Mono', 'DejaVu Sans Mono', monospace", display: "Rajdhani, Inter, sans-serif" });
const peaks = peaksOf(null, 0, 0, 0);
const ctx = { rest, views, stops: wx.stops, plan, reduced: false };
window.info = { stops: wx.stops.map((s) => [s.headline, s.system.key, s.system.kind, s.beams.map((b) => b.source + (b.fetched ? "*" : ""))]), systems: wx.systems.map((s) => s.key + ":" + s.kind + s.outlets), fronts: wx.fronts.map((f) => f.key), forecast: wx.forecast, since: model.since };
window.wxAt = (now) => {
  const ctl = now >= TEST.press ? { ...CTL0, mode: "tour", pressAt: TEST.press } : CTL0;
  const f = frameAt(ctl, now, now - TEST.press - 260, ctx);
  const st = f.i >= 0 ? wx.stops[f.i] : null;
  d.draw(model, { W, H, dpr: DPR, free, view: f.view, now, reduced: false, rest: f.rest,
    tour: ctl.mode === "tour" && st ? { stop: st, prev: f.i > 0 ? wx.stops[f.i - 1] : null, scene: f.scene, idx: f.i, n: 6, from: f.from, paused: false, peaks, voiced: true } : null });
  return f.i;
};
`;
const bundle = await build({ stdin: { contents: entry, resolveDir: root, loader: "ts" }, bundle: true, write: false, format: "iife", target: "es2022",
  alias: { "@": path.join(root, "src") }, loader: { ".json": "json" }, logLevel: "error" });
const html = `<!doctype html><html><head><style>html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#02050b}
canvas{width:${W}px;height:${H}px;display:block}</style></head><body><canvas id="c"></canvas><script>${bundle.outputFiles[0].text}</script></body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--disable-gpu-vsync", "--font-render-hinting=none"] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
page.on("console", (m) => console.log("[page]", m.text()));
page.on("pageerror", (e) => { console.error("[page error]", e.message); process.exit(1); });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
console.log(JSON.stringify(await page.evaluate(() => window.info), null, 1));

const frames = Math.round((7400 / 1000) * FPS);
const want = stillsDir ? { "1-rest": 1200, "2-flight": 2900, "3-story": 6900 } : {};
const byFrame = new Map(Object.entries(want).map(([k, t]) => [Math.round((t / 1000) * FPS), k]));
if (stillsDir) mkdirSync(stillsDir, { recursive: true });
const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
  "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
const t0 = Date.now(); let worst = 0;
for (let i = 0; i < frames; i++) {
  const now = (i * 1000) / FPS;
  const d0 = performance.now();
  await page.evaluate((t) => window.wxAt(t), now);
  worst = Math.max(worst, performance.now() - d0);
  const buf = await page.screenshot({ type: "png" });
  const still = byFrame.get(i);
  if (still) await page.screenshot({ path: path.join(stillsDir, `${still}.png`) });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  if (i % 60 === 0) console.log(`frame ${i}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
console.log(`done: ${out} · slowest draw call incl. round trip ${worst.toFixed(1)} ms (software canvas)`);
await browser.close();
