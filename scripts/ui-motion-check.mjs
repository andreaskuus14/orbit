// node --no-warnings scripts/ui-motion-check.mjs — feat/ui-motion proof + performance check, in a real browser.
// Bundles scripts/ui-motion/stage.tsx (the real Galaxy, CORE orb, streaming, progress card and focused view, on a scripted request
// with invented data) as a minified production bundle with the real stylesheets, serves it locally, and with Playwright:
//   1. before (data-motion="off", the old look): screenshots + frame times while the old camera flight and the reply run
//   2. after (motion on): a screen recording of request → thinking → tool → writing → camera fly → progress → done → back,
//      screenshots of each moment, frame times during the fly and the stream, and long tasks
// It also measures the eager app code of the home route (Orbit.tsx, packages external) here and in UIM_BEFORE (an origin/main
// tree) so the size change of the changed route is known. No sign-in, no network, no model.
// Env: UIM_OUT (default reports/ui-motion), UIM_BEFORE (tree to compare), UIM_CHROME (browser), UIM_SPEED (stage speed).
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const ROOT = resolve(".");
const OUT = resolve(process.env.UIM_OUT || "smoke-shots/ui-motion");
const BEFORE = process.env.UIM_BEFORE ? resolve(process.env.UIM_BEFORE) : null;
mkdirSync(OUT, { recursive: true });
const req = createRequire(import.meta.url);
const { chromium } = (() => { try { return req("playwright"); } catch { return req("playwright-core"); } })();
const CHROME = process.env.UIM_CHROME || (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);

const define = { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_SUPABASE_URL": '""', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '""' };
const cssModules = { name: "css-modules", setup(b) { b.onLoad({ filter: /\.module\.css$/ }, () => ({ contents: "export default new Proxy({}, { get: (_, k) => String(k) });", loader: "js" })); } };

// ---- 1. size of the home route's own code, before and after (packages are shared and unchanged) ----
async function routeSize(root) {
  const r = await build({ entryPoints: [resolve(root, "src/components/Orbit.tsx")], bundle: true, write: false, splitting: true, format: "esm", outdir: "/tmp/uim-size",
    minify: true, metafile: true, logLevel: "silent", jsx: "automatic", packages: "external", define, plugins: [cssModules], loader: { ".css": "empty" },
    tsconfig: resolve(root, "tsconfig.json") });
  const meta = r.metafile.outputs;
  const entry = Object.keys(meta).find((k) => meta[k].entryPoint?.endsWith("Orbit.tsx"));
  const galaxy = Object.keys(meta).find((k) => Object.keys(meta[k].inputs).some((i) => i.endsWith("components/Galaxy.tsx")));
  const kb = (path) => { const f = r.outputFiles.find((o) => o.path.endsWith(path.replace(/^.*\//, ""))); return f ? { minKB: +(f.contents.length / 1024).toFixed(1), gzKB: +(gzipSync(f.contents).length / 1024).toFixed(1) } : null; };
  return { home: entry ? kb(entry) : null, galaxyChunk: galaxy ? kb(galaxy) : null };
}
const sizes = { after: await routeSize(ROOT), before: BEFORE ? await routeSize(BEFORE) : null };
const cssAfter = readFileSync(resolve(ROOT, "src/app/motion.css"));
sizes.motionCss = { minKB: +(cssAfter.length / 1024).toFixed(1), gzKB: +(gzipSync(cssAfter).length / 1024).toFixed(1) };
console.log("route code:", JSON.stringify(sizes));

// ---- 2. the stage bundle + real CSS ----
const bundle = await build({ entryPoints: [resolve(ROOT, "scripts/ui-motion/stage.tsx")], bundle: true, write: false, format: "esm", jsx: "automatic", minify: true,
  logLevel: "error", banner: { js: 'globalThis.process ??= { env: { NODE_ENV: "production" } };' }, define, plugins: [cssModules], loader: { ".css": "empty" },
  alias: { "next/navigation": resolve(ROOT, "node_modules/next/dist/client/components/navigation.js") }, tsconfig: resolve(ROOT, "tsconfig.json") });
const js = bundle.outputFiles[0].text;
const rootReq = createRequire(resolve(ROOT, "package.json"));
const postcss = rootReq("postcss"), tw = rootReq("@tailwindcss/postcss");
const cssPath = resolve(ROOT, "src/app/globals.css");
const css = (await postcss([tw({ base: ROOT })]).process(readFileSync(cssPath, "utf8"), { from: cssPath })).css
  + readFileSync(resolve(ROOT, "src/app/observatory.css"), "utf8") + readFileSync(resolve(ROOT, "src/app/motion.css"), "utf8");

const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json", ".ktx2": "application/octet-stream", ".hdr": "application/octet-stream" };
const send = (res, type, body, code = 200) => { res.writeHead(code, { "content-type": type }); res.end(body); };
const server = createServer((rq, res) => {
  const u = new URL(rq.url, "http://x");
  if (u.pathname === "/") return send(res, "text/html", `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><body style="background:#02040b;color:#e6f1ff;margin:0;font-family:Inter,ui-sans-serif,system-ui,sans-serif"><div id="root"></div><script type="module" src="/app.js"></script>`);
  if (u.pathname === "/app.js") return send(res, "text/javascript", js);
  if (u.pathname === "/app.css") return send(res, "text/css", css);
  const f = join(ROOT, "public", decodeURIComponent(u.pathname));
  if (f.startsWith(join(ROOT, "public")) && existsSync(f) && statSync(f).isFile()) return send(res, TYPES[extname(f)] || "application/octet-stream", readFileSync(f));
  if (u.pathname.startsWith("/api/")) return send(res, "application/json", "{}");
  return send(res, "text/plain", "", 404);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: CHROME, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const VIEW = { width: 1280, height: 720 };
const FPS = 30;
const errors = [];
const TEXT = "Make 3 Shorts from my last video";

// ---- 3. performance: real time, the UI layer alone (galaxy=0; software WebGL runs the galaxy at ~1 fps here, before and after alike) ----
const recorder = () => {
  window.__frames = []; window.__long = []; window.__mark = "boot";
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push({ at: e.startTime, ms: e.duration, mark: window.__mark }); }).observe({ type: "longtask", buffered: true }); } catch { /* no longtask */ }
  let last = 0;
  const f = (t) => { if (last) window.__frames.push({ dt: t - last, mark: window.__mark }); last = t; requestAnimationFrame(f); };
  requestAnimationFrame(f);
};
const mark = (page, m) => page.evaluate((x) => { window.__mark = x; }, m);
function stats(frames, long, m) {
  const d = frames.filter((f) => f.mark === m).map((f) => f.dt).sort((a, b) => a - b);
  if (!d.length) return null;
  const sum = d.reduce((a, b) => a + b, 0), p = (q) => d[Math.min(d.length - 1, Math.floor(q * d.length))];
  const lt = long.filter((x) => x.mark === m);
  return { frames: d.length, fps: +(1000 / (sum / d.length)).toFixed(1), p50: +p(0.5).toFixed(1), p95: +p(0.95).toFixed(1), worst: +d.at(-1).toFixed(1), janky: d.filter((x) => x > 50).length, longTasks: lt.length, longMs: Math.round(lt.reduce((a, b) => a + b.ms, 0)) };
}
async function perf(motion) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`perf ${motion ? "after" : "before"}: ${e.message.slice(0, 200)}`));
  await page.addInitScript(recorder);
  await page.goto(`${ORIGIN}/?galaxy=0&motion=${motion ? 1 : 0}`);
  await page.getByRole("textbox").waitFor();
  await page.waitForTimeout(800);
  await mark(page, "idle"); await page.mouse.move(300, 300); await page.mouse.move(1000, 450, { steps: 30 }); await page.waitForTimeout(1500);
  await mark(page, "typing+thinking"); await page.evaluate((t) => window.__type(t), TEXT);
  await page.waitForFunction(() => window.__streamStart, null, { timeout: 20_000 });
  await mark(page, "streaming");
  await page.waitForFunction(() => window.__streamEnd, null, { timeout: 20_000 });
  await mark(page, "fly+open"); await page.waitForTimeout(1600);
  await mark(page, "working"); await page.waitForTimeout(3000);
  await page.waitForFunction(() => window.__stage?.done, null, { timeout: 30_000 });
  await mark(page, "done"); await page.waitForTimeout(1500);
  if (motion) { await mark(page, "back"); await page.evaluate(() => window.__back()); await page.waitForTimeout(1200); }
  await mark(page, "end");
  const { frames, long } = await page.evaluate(() => ({ frames: window.__frames, long: window.__long }));
  await ctx.close();
  const res = {};
  for (const m of ["idle", "typing+thinking", "streaming", "fly+open", "working", "done", "back"]) { const st = stats(frames, long, m); if (st) res[m] = st; }
  return res;
}

// ---- 4. the recording: the real galaxy, rendered frame by frame on the page's own clock ----
// The sandbox has no GPU (SwiftShader: ~1 fps), so a live screen capture would be a slideshow. Instead the page's clock
// (performance.now, Date.now, requestAnimationFrame, timers) and every CSS animation advance exactly 1/30 s per captured frame:
// the video shows the real timings and curves at 30 fps, as they play on a GPU.
const virtualClock = () => {
  const rST = window.setTimeout.bind(window);
  window.__realTimeout = rST;
  let vt = 0; const d0 = Date.now();
  const raf = []; let rid = 0; const timers = new Map(); let tid = 0;
  performance.now = () => vt;
  Date.now = () => d0 + vt;
  window.requestAnimationFrame = (cb) => { const id = ++rid; raf.push([id, cb]); return id; };
  window.cancelAnimationFrame = (id) => { const i = raf.findIndex((r) => r[0] === id); if (i >= 0) raf.splice(i, 1); };
  window.setTimeout = (cb, ms = 0, ...a) => { const id = 1e6 + ++tid; if (typeof cb === "function") timers.set(id, { at: vt + Math.max(0, +ms || 0), cb, a }); return id; };
  window.setInterval = (cb, ms = 0, ...a) => { const id = 1e6 + ++tid; const iv = Math.max(1, +ms || 0); timers.set(id, { at: vt + iv, cb, a, iv }); return id; };
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };
  const seen = new WeakSet();
  const tickAnims = (dt) => { for (const an of document.getAnimations()) { if (!seen.has(an)) { seen.add(an); an.pause(); an.currentTime = 0; } else an.currentTime = (Number(an.currentTime) || 0) + dt; } };
  window.__vt = () => vt;
  window.__step = async (dt) => {
    const target = vt + dt;
    for (;;) {
      let best = null;
      for (const e of timers) if (e[1].at <= target && (!best || e[1].at < best[1].at)) best = e;
      if (!best) break;
      const [id, t] = best;
      vt = Math.max(vt, t.at);
      if (t.iv) t.at += t.iv; else timers.delete(id);
      try { t.cb(...t.a); } catch (e) { console.error(e); }
      await new Promise((r) => rST(r, 0));
    }
    vt = target;
    for (const [, cb] of raf.splice(0)) { try { cb(vt); } catch (e) { console.error(e); } }
    await new Promise((r) => rST(r, 0)); await new Promise((r) => rST(r, 0)); // React commits (MessageChannel), then the CSS animations it started
    tickAnims(dt);
  };
};
async function render(motion, tag, shots, opts = {}) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`render ${tag}: ${e.message.slice(0, 200)}`));
  await page.addInitScript(virtualClock);
  await page.goto(`${ORIGIN}/?motion=${motion ? 1 : 0}`);
  await page.locator("canvas").first().waitFor({ timeout: 60_000 });
  const frames = join(OUT, `frames-${tag}`);
  if (opts.video) { rmSync(frames, { recursive: true, force: true }); mkdirSync(frames, { recursive: true }); }
  let n = 0;
  const R = opts.fps ?? FPS; // the before shots need no video: coarser steps
  const step = async (secs, onFrame) => {
    for (let i = 0, k = Math.max(1, Math.round(secs * R)); i < k; i++) {
      await page.evaluate((dt) => window.__step(dt), 1000 / R);
      if (onFrame) await onFrame(i);
      if (opts.video) await page.screenshot({ path: join(frames, `${String(n++).padStart(5, "0")}.jpg`), type: "jpeg", quality: 88 });
    }
  };
  const shot = async (name) => { if (shots.includes(name)) await page.screenshot({ path: `${OUT}/${tag}-${name}.png` }); };
  const until = async (fn, max) => { for (let t = 0; t < max * R && !(await page.evaluate(fn)); t++) await step(1 / R); };
  await step(3.2);                                          // the galaxy's intro flight
  await page.mouse.move(420, 300);
  await step(0.6, async (i) => { await page.mouse.move(420 + i * (420 / R), 300 + i * (120 / R)); }); // a little parallax
  await step(0.6); await shot("1-home");
  await page.evaluate((t) => window.__type(t), TEXT);
  await until(() => document.querySelector(".cmdbar input")?.value === "", 4);
  await step(0.5); await shot("2-thinking");
  await step(0.9); await shot("3-tool");
  await until(() => window.__streamStart, 4);
  await step(0.7); await shot("4-writing");
  await until(() => window.__streamEnd, 6);
  await until(() => window.__stage?.job || document.querySelector(".home-desk"), 4);
  await step(0.45); await shot("5-flying");
  await step(2.4); await shot("6-working");
  await until(() => window.__stage?.done, 20);
  await step(1.6); await shot("7-done");
  if (motion) { await step(1.4); await page.evaluate(() => window.__back()); await step(1.8); await shot("8-back-home"); await step(0.6); }
  await ctx.close();
  if (!opts.video) return null;
  const ffmpeg = rootReq("ffmpeg-static"), mp4 = `${OUT}/ui-motion-demo.mp4`, webm = `${OUT}/ui-motion-demo.webm`;
  const a = spawnSync(ffmpeg, ["-y", "-framerate", String(FPS), "-i", join(frames, "%05d.jpg"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20", "-movflags", "+faststart", mp4], { stdio: "ignore" });
  const b = spawnSync(ffmpeg, ["-y", "-framerate", String(FPS), "-i", join(frames, "%05d.jpg"), "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", "-row-mt", "1", "-deadline", "realtime", "-cpu-used", "8", webm], { stdio: "ignore" });
  rmSync(frames, { recursive: true, force: true });
  return { frames: n, seconds: +(n / FPS).toFixed(1), mp4: a.status === 0 ? mp4 : null, webm: b.status === 0 ? webm : null };
}

const SHOTS = ["1-home", "2-thinking", "3-tool", "4-writing", "5-flying", "6-working", "7-done", "8-back-home"];
const mode = process.env.UIM_MODE || "all"; // perf | render | all
const results = { when: new Date().toISOString(), viewport: VIEW, sizes, errors };
if (mode !== "render") { results.perf = { note: "real time, UI layer only (galaxy off), headless Chrome on a shared 2-CPU box", before: await perf(false), after: await perf(true) }; console.log(JSON.stringify(results.perf, null, 1)); }
if (mode !== "perf") {
  await render(false, "before", ["1-home", "2-thinking", "4-writing", "6-working", "7-done"], { fps: 8 });
  results.video = await render(true, "after", SHOTS, { video: true });
  results.videoNote = "rendered frame by frame at 30 fps on the page's own clock (software WebGL, no GPU here); timings and curves are the real ones";
}
await browser.close(); server.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ sizes: results.sizes, video: results.video, errors }, null, 2));
if (errors.length) process.exitCode = 1;
