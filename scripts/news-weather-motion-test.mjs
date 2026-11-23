#!/usr/bin/env node
// INTELLIGENCE news weather — deterministic 7.4 s motion test (owner's rule: one polished 5–8 s test before the full build).
// Renders the real renderer (src/components/news-weather/weather-draw.ts) and the real state machine (news-weather-tour-pure)
// on the 22 Nov fixture in headless Chrome, stepping a fixed 60 fps clock, one screenshot per frame, piped to ffmpeg.
//   node scripts/news-weather-motion-test.mjs <out.mp4> [stillsDir] [--stills-only]
// Fonts: Inter from the system; Source Serif 4 (OFL) from SERIF_WOFF2=<latin woff2 path> if set, else the system serif.
// Beats: rest hold → press Play (anticipation dip, settle) → rest HUD leaves (staggered) → camera arcs to the first story with
// a thin flight path → outlet leader lines land one by one (bold + solid = read in full) → the lower third builds in (red bar
// first, then kicker, headline, body, progress) → hold while the audio progress runs.
// The video is silent: the app plays the briefing's Kokoro audio, which this box can't make.
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), stillsOnly = args.includes("--stills-only");
const [out = "news-weather-motion-test.mp4", stillsDir] = args.filter((a) => !a.startsWith("--"));
const FPS = 60, W = Number(process.env.W || 1280), H = Number(process.env.H || 720), DPR = Number(process.env.DPR || (W === 1280 ? 1.5 : 1));

const entry = `
import fx from "./tests/fixtures/news-weather-22nov.json";
import { createWeatherDraw } from "@/components/news-weather/weather-draw";
import { weather, tourPlan, sinceLast, snapshotOf } from "@/lib/news-weather-pure";
import { restView, storyView, safeFrame, subsolar, TEST } from "@/lib/news-weather-motion-pure";
import { shortTitle } from "@/lib/news-weather-pure";
import { frameAt, CTL0 } from "@/lib/news-weather-tour-pure";
import { wxText, tourLength } from "@/lib/news-weather-text-pure";
const W = ${W}, H = ${H}, DPR = ${DPR}, OBST = ${JSON.stringify(process.env.OBSTACLES === "1")};
const wx = weather(fx.geo.hotspots, fx.briefing, "en");
// "Since you last looked": a snapshot from this morning, when Iran had 4 outlets and there was no UK–Turkey front.
const prev = snapshotOf(wx.systems.map((s) => s.key === "Iran" ? { ...s, outlets: 4 } : s), wx.fronts.filter((f) => !/United Kingdom/.test(f.key)), 0);
const plan = tourPlan(wx.stops.length);
// OBSTACLES=1: the app's other layers as they sit over the Intelligence view (top bar, search box, region chips, command bar,
// the panel on the right), turned into the free frame by the same safeFrame() the app uses on its elementFromPoint samples.
const obstacles = [{ x: 0, y: 0, w: W, h: 56 }, { x: W / 2 - 272, y: 68, w: 544, h: 44 }, { x: W / 2 - 300, y: H - 122, w: 600, h: 36 },
  { x: W / 2 - Math.min(336, W / 2 - 12), y: H - 72, w: Math.min(672, W - 24), h: 56 }, { x: W - (W >= 900 ? 512 : 300), y: 56, w: W >= 900 ? 512 : 300, h: H - 56 }];
const grid = Array.from({ length: 24 }, (_, y) => Array.from({ length: 32 }, (_, x) => { const px = ((x + 0.5) / 32) * W, py = ((y + 0.5) / 24) * H; return obstacles.some((o) => px >= o.x && px <= o.x + o.w && py >= o.y && py <= o.y + o.h); }));
const free = OBST ? safeFrame(grid, W, H, { x: 0, y: 0, w: W, h: H }) : { x: 0, y: 0, w: W, h: H };
const sun = subsolar(Date.UTC(2026, 10, 22, 8, 30)); // 22 Nov 08:30 UTC: morning over Asia, night still on the Americas
const chapters = plan.map((p, i) => ({ title: shortTitle(wx.stops[i].headline, 30), start: p.start, end: p.end }));
const rest = restView(fx.geo.hotspots.map((h) => ({ lon: h.lon, lat: h.lat, reports: h.count })), free);
const views = wx.stops.map((s) => storyView(s.system, free));
const t = wxText("en");
const model = { systems: wx.systems, fronts: wx.fronts, isobars: wx.isobars, hpa: wx.hpa, title: t.title + " · Sunday", forecast: wx.forecast,
  since: sinceLast(prev, wx.systems, wx.fronts).map((c) => c.text), playSub: tourLength(6, 70000, "en"), canPlay: true, text: t };
const c = document.getElementById("c");
const d = createWeatherDraw(c, { sans: "Inter, sans-serif", serif: "'Source Serif 4', 'DejaVu Serif', serif" }, { samples: 260000 });
const load = (k, src) => new Promise((ok) => { const im = new Image(); im.onload = () => { d.setTexture(k, im); ok(true); }; im.onerror = () => ok(false); im.src = src; });
window.ready = Promise.all([load("day", window.TEX.day), load("night", window.TEX.night), load("clouds", window.TEX.clouds)]).then((a) => a.every(Boolean));
const ctx = { rest, views, stops: wx.stops, plan, reduced: false };
window.info = { stops: wx.stops.map((s) => [s.headline, s.system.key, s.system.kind, s.beams.map((b) => b.source + (b.fetched ? "*" : ""))]), systems: wx.systems.map((s) => s.key + ":" + s.kind + s.outlets), fronts: wx.fronts.map((f) => f.key), forecast: wx.forecast, since: model.since };
window.wxAt = (now) => {
  const ctl = now >= TEST.press ? { ...CTL0, mode: "tour", pressAt: TEST.press } : CTL0;
  const f = frameAt(ctl, now, now - TEST.press - 260, ctx);
  const st = f.i >= 0 ? wx.stops[f.i] : null;
  d.draw(model, { W, H, dpr: DPR, free, view: f.view, now, reduced: false, rest: f.rest, sun,
    tour: ctl.mode === "tour" && st ? { stop: st, prev: f.i > 0 ? wx.stops[f.i - 1] : null, scene: f.scene, idx: f.i, n: wx.stops.length, from: f.from, paused: false, voiced: true, dur: plan[f.i].end - plan[f.i].start, chapters, clock: now - TEST.press - 260 } : null });
  if (OBST) { const g = c.getContext("2d"); g.save(); g.setTransform(DPR, 0, 0, DPR, 0, 0); g.fillStyle = "rgba(120,60,200,0.35)"; g.strokeStyle = "rgba(200,160,255,0.9)";
    for (const o of obstacles) { g.fillRect(o.x, o.y, o.w, o.h); g.strokeRect(o.x + 0.5, o.y + 0.5, o.w - 1, o.h - 1); } g.restore(); }
  return f.i;
};
`;
const bundle = await build({ stdin: { contents: entry, resolveDir: root, loader: "ts" }, bundle: true, write: false, format: "iife", target: "es2022",
  alias: { "@": path.join(root, "src") }, loader: { ".json": "json" }, logLevel: "error" });
const tex = (f) => "data:image/jpeg;base64," + readFileSync(path.join(root, "public/ui/relief", f)).toString("base64");
const TEX = { day: tex("globe-4096.jpg"), night: tex("night-2048.jpg"), clouds: tex("clouds-2048.jpg") };
const serif = process.env.SERIF_WOFF2 && existsSync(process.env.SERIF_WOFF2)
  ? `@font-face{font-family:'Source Serif 4';font-weight:200 900;src:url(data:font/woff2;base64,${readFileSync(process.env.SERIF_WOFF2).toString("base64")}) format('woff2')}` : "";
const html = `<!doctype html><html><head><style>${serif}html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#18191b}
canvas{width:${W}px;height:${H}px;display:block}</style></head><body><canvas id="c"></canvas><span style="font:600 10px \'Source Serif 4\';position:absolute;opacity:0">Aa</span><script>window.TEX=${JSON.stringify(TEX)};${bundle.outputFiles[0].text}</script></body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--disable-gpu-vsync", "--font-render-hinting=none"] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
page.on("console", (m) => console.log("[page]", m.text()));
page.on("pageerror", (e) => { console.error("[page error]", e.message); process.exit(1); });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
if (!(await page.evaluate(() => window.ready))) throw new Error("globe texture did not load");
console.log(JSON.stringify(await page.evaluate(() => window.info), null, 1));

await page.evaluate(() => document.fonts.load("600 30px 'Source Serif 4'"));
const frames = Math.round((7400 / 1000) * FPS);
const want = stillsDir ? { "1-rest": 1200, "2-flight": 2900, "3-story": 6900 } : {};
if (stillsOnly) { // style frames: just the three stills, no video
  mkdirSync(stillsDir, { recursive: true });
  for (const [k, t] of Object.entries(want)) { await page.evaluate((x) => window.wxAt(x), t); await page.screenshot({ path: path.join(stillsDir, `${k}.png`) }); console.log("still", k); }
  await browser.close(); process.exit(0);
}
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
