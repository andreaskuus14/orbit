#!/usr/bin/env node
// CORE thinking orb — deterministic motion test (owner's rule: one polished 5–8 s motion test before shipping).
// Renders the real shader + the real phase machine + the real motion curves in headless Chrome (software GL / SwiftShader),
// stepping a fixed 60 fps clock, one screenshot per frame, piped to ffmpeg. Smooth even without a GPU.
//   node scripts/orb-motion-test.mjs square <out.mp4>              1080×1080, orb alone on ORBIT's space background
//   node scripts/orb-motion-test.mjs home <out.mp4> <home.png>     1280×720, orb above the home input over the galaxy
//   node scripts/orb-motion-test.mjs stills <outDir>               one 1080 still per phase (idle … done)
//   node scripts/orb-motion-test.mjs sizes <out.png>               idle + thinking stills at the real 40 px / 96 px sizes, DPR 2
// Needs: playwright-core + a Chrome (CHROME=/path, default /usr/bin/google-chrome), ffmpeg on PATH.
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [mode = "square", out = "orb-motion-test.mp4", bgPath] = process.argv.slice(2);
const FPS = 60;
const TOTAL_MS = 7600;

// The script the page runs: same modules ORBIT ships.
const entry = `
import { createOrbRenderer } from "@/components/motion/orb-gl";
import { orbMotionInit, orbRetarget, orbBeat, orbFrame, orbClock0, orbTier, orbStill } from "@/lib/orb-motion-pure";
import { idlePhase, phaseReduce, phaseTick, phaseLabel } from "@/lib/core-phase-pure";
// The scene: idle → listening → thinking → tool → writing (text chunks at uneven gaps) → done (settles to idle at the end).
const EVENTS = [
  [1000, { type: "listen" }],
  [2200, { type: "submit" }],
  [3900, { type: "tool", tool: "web_search" }],
  [4900, { type: "delta" }],
  ...[5010, 5140, 5230, 5390, 5480, 5600, 5760, 5850, 5990, 6080, 6200].map((t) => [t, { type: "delta" }]),
  [6300, { type: "done" }],
];
let r, ps, m, clock, ei, last, detail;
window.orbSetup = (cssPx) => {
  const c = document.getElementById("orb");
  r = createOrbRenderer(c, { preserveDrawingBuffer: true });
  if (!r) return false;
  r.resize(c.width, c.height);
  detail = orbTier(cssPx);
  ps = idlePhase(0); m = orbMotionInit("idle", 0); clock = orbClock0(); ei = 0; last = 0;
  return true;
};
window.orbStillAt = (id, cssPx, phase) => { // one reduced-motion still on its own canvas, at the tier for that size
  const c = document.getElementById(id);
  const rr = createOrbRenderer(c, { preserveDrawingBuffer: true });
  if (!rr) return false;
  rr.resize(c.width, c.height); rr.draw(orbStill(phase), orbTier(cssPx)); rr.gl.finish();
  return orbTier(cssPx);
};
window.orbAt = (now, draw = true) => { // frames must be asked for in order (fixed steps)
  while (ei < EVENTS.length && EVENTS[ei][0] <= now) {
    const [t, ev] = EVENTS[ei++];
    ps = phaseReduce(ps, ev, t);
    if (ev.type === "delta") m = orbBeat(m, t);
    if (ps.phase !== m.phase) m = orbRetarget(m, ps.phase, t);
  }
  const ps2 = phaseTick(ps, now);
  if (ps2 !== ps) { ps = ps2; if (ps.phase !== m.phase) m = orbRetarget(m, ps.phase, now); }
  const f = orbFrame(m, clock, now, (now - last) / 1000);
  clock = f.clock; last = now;
  if (draw) { r.draw(f.u, detail); r.gl.finish(); }
  const label = phaseLabel(ps, "en");
  const el = document.getElementById("label");
  if (el) el.textContent = label ? label + (["listening", "thinking", "tool", "writing"].includes(ps.phase) ? "…" : "") : "";
  const cap = document.getElementById("cap");
  if (cap) cap.textContent = ps.phase;
  return ps.phase;
};
`;

const bundle = await build({
  stdin: { contents: entry, resolveDir: root, loader: "ts" },
  bundle: true, write: false, format: "iife", target: "es2022",
  alias: { "@": path.join(root, "src") },
  logLevel: "error",
});
const js = bundle.outputFiles[0].text;

function stars(w, h, n, seed) { // deterministic faint star field (ORBIT's near-black space)
  let s = seed; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  let o = "";
  for (let i = 0; i < n; i++) { const x = rnd() * w, y = rnd() * h, a = 0.15 + rnd() * 0.5, sz = rnd() < 0.08 ? 2 : 1; o += `<i style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;opacity:${a.toFixed(2)};width:${sz}px;height:${sz}px"></i>`; }
  return o;
}

if (mode === "sizes") { // chat orb 40 px and home orb 96 px, idle + thinking, DPR 2, shown 4× with no smoothing
  const sz = [40, 96], ph = ["idle", "thinking"];
  const cells = sz.flatMap((o) => ph.map((p) => ({ o, p, c: Math.round(o / 0.6) })));
  const W2 = cells.reduce((a, x) => a + x.c * 2 + 24, 24), H2 = Math.max(...cells.map((x) => x.c * 2)) + 48;
  const html2 = `<!doctype html><html><body style="margin:0;background:#03040b;width:${W2}px;height:${H2}px;display:flex;gap:24px;padding:24px;box-sizing:border-box;align-items:flex-start">${cells.map((x, i) => `<canvas id="c${i}" width="${x.c * 2}" height="${x.c * 2}" style="width:${x.c * 2}px;height:${x.c * 2}px"></canvas>`).join("")}<script>${js}</script></body></html>`;
  const b2 = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
  const pg = await b2.newPage({ viewport: { width: W2, height: H2 }, deviceScaleFactor: 1 });
  await pg.setContent(html2);
  for (let i = 0; i < cells.length; i++) console.log(cells[i].o, "px", cells[i].p, "tier", await pg.evaluate(([id, o, p]) => window.orbStillAt(id, o, p), [`c${i}`, cells[i].o, cells[i].p]));
  await pg.screenshot({ path: out });
  await b2.close();
  process.exit(0);
}
const home = mode === "home";
const W = home ? 1280 : 1080, H = home ? 720 : 1080;
// home: 96 px orb (lg) → 160 px canvas, centred above the input like .home-presence; square: 648 px orb.
const orbCss = home ? 96 : 648;
const canvasCss = Math.round(orbCss / 0.6);
const cx = W / 2, cy = home ? 548 : H / 2;
const bg = home ? `background:#000 url(data:image/png;base64,${readFileSync(bgPath).toString("base64")}) 0 0/1280px 720px no-repeat;` : "background:radial-gradient(ellipse at 50% 45%, #070a1c 0%, #03040b 60%, #020208 100%);";
const html = `<!doctype html><html><head><style>
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;${bg}font-family:Inter,ui-sans-serif,system-ui,sans-serif}
.stars i{position:absolute;background:#cfe6ff;border-radius:50%}
#orb{position:absolute;left:${cx - canvasCss / 2}px;top:${cy - canvasCss / 2}px;width:${canvasCss}px;height:${canvasCss}px}
#label{position:absolute;left:0;right:0;top:${cy + orbCss / 2 + 10}px;text-align:center;color:#9aa6b8;font-size:14px;letter-spacing:.01em}
#cap{position:absolute;left:28px;bottom:22px;color:#5d6a80;font-size:20px;letter-spacing:.2em;text-transform:uppercase}
</style></head><body>${home ? "" : `<div class="stars">${stars(W, H, 140, 7)}</div>`}
<canvas id="orb" width="${canvasCss}" height="${canvasCss}"></canvas>${home ? '<div id="label"></div>' : '<div id="cap"></div>'}
<script>${js}</script></body></html>`;

const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on("console", (m) => console.log("[page]", m.text()));
await page.setContent(html);
if (!(await page.evaluate((px) => window.orbSetup(px), orbCss))) { console.error("WebGL2 not available in this Chrome"); process.exit(1); }

const frames = Math.round((TOTAL_MS / 1000) * FPS);
if (mode === "stills") {
  mkdirSync(out, { recursive: true });
  const want = { idle: 700, listening: 1900, thinking: 3700, tool: 4250, writing: 5800, done: 6650 };
  const byFrame = new Map(Object.entries(want).map(([k, t]) => [Math.round((t / 1000) * FPS), k]));
  for (let i = 0; i <= Math.max(...byFrame.keys()); i++) {
    const name = byFrame.get(i);
    const ph = await page.evaluate(([t, d]) => window.orbAt(t, d), [(i * 1000) / FPS, !!name]);
    if (name) { await page.screenshot({ path: path.join(out, `${name}.png`) }); console.log(name, "→", ph); }
  }
} else {
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
  const t0 = Date.now();
  const log = [];
  for (let i = 0; i < frames; i++) {
    const now = (i * 1000) / FPS;
    const ph = await page.evaluate((t) => window.orbAt(t), now);
    if (!log.length || log[log.length - 1][1] !== ph) log.push([Math.round(now), ph]);
    const buf = await page.screenshot({ type: "png" });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % 60 === 0) console.log(`frame ${i}/${frames} ${ph} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  writeFileSync(out.replace(/\.mp4$/, ".phases.json"), JSON.stringify(log));
  console.log("phases:", log.map(([t, p]) => `${t}ms ${p}`).join(" · "));
}
await browser.close();
