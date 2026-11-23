#!/usr/bin/env node
// INTELLIGENCE globe benchmark: mounts the real NewsGlobe (same modules the app ships, fixture news) in headless Chrome and
// records frame times, long tasks, slow input handlers and WebGL call costs while it opens, idles, is hovered, switches the
// time window, searches and opens a country. Repeatable: same fixture, same script, same viewport.
//   node --experimental-strip-types scripts/globe-bench.mjs [--runs 3] [--size 1280x720] [--dpr 1.25] [--gpu] [--view classic|weather]
//     [--before origin/main] [--json out.json] [--profile out.cpuprofile] [--shot still.png] [--quick] [--ablate nopost,noland,noblur,…]
// Below 1280x720 the search bar covers the time-window chips (the run then warns that a step did not happen).
// Default GL is SwiftShader (software, CPU-bound: compare runs with each other, not with a real GPU). --gpu asks Chrome for
// the hardware GPU (ANGLE default backend); the renderer string is printed either way.
// Needs: playwright-core + a Chrome (CHROME=/path, default /usr/bin/google-chrome).
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { benchStats, formatBench } from "../src/lib/globe-bench-pure.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(k);
const runs = Number(arg("--runs", 3));
const [W, H] = arg("--size", "1280x720").split("x").map(Number);
const dpr = Number(arg("--dpr", 1.25));
const gpu = flag("--gpu");
// --view classic (default): the 3D globe, "Classic map" chosen. --view weather: the news weather view (ORBIT_UI_MOTION's
// default), which pauses the 3D globe under it; its steps are open, idle, hover, then "switch" (to Classic map and back).
const view = arg("--view", "classic");
const quick = flag("--quick"); // open + idle only: for comparing what the idle scene costs to draw (--ablate)
const origin = "http://orbit.test";
// Profiling only: --ablate a,b cuts one suspect at bundle time (the app's files are not touched) to see what it costs.
const ABLATE = {
  nopost: [/<EffectComposer[\s\S]*?<\/EffectComposer>/, ""],
  nobloom: [/<Bloom [^>]*\/>/, ""],
  nosmaa: [/\{msaa \? <><\/> : <SMAA \/>\}/, ""],
  noland: [/<Land reduced=\{reduced\} \/>/, ""],
  nostars: [/<Stars [^>]*\/>/, ""],
  norings: [/<ObsidianRings reduced=\{reduced\} \/>/, ""],
  dpr1: [/dpr=\{\[1, dpr\]\}/, "dpr={1}"],
};
// CSS-side suspect: the glass panels' backdrop blur, recomposited over the moving canvas every frame.
const noblur = (arg("--ablate", "") || "").split(",").includes("noblur");
const ablate = (arg("--ablate", "") || "").split(",").filter(Boolean);
// --before <git ref>: bench the globe's files (NewsGlobe.tsx, WarmCompile.tsx) as they are at that ref, e.g. origin/main.
const before = arg("--before");
const atRef = (file) => execFileSync("git", ["show", `${before}:${path.relative(root, file)}`], { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
// --shot out.png: a still of the idle globe with motion reduced (no spin, frozen shader time), to compare looks before/after.
const shot = arg("--shot");
const ablatePlugin = { name: "ablate", setup(b) {
  if (!ablate.length && !before) return;
  if (before) b.onLoad({ filter: /components\/WarmCompile\.tsx$/ }, (a) => ({ contents: atRef(a.path), loader: "tsx" }));
  b.onLoad({ filter: /NewsGlobe\.tsx$/ }, (a) => {
    let src = before ? atRef(a.path) : readFileSync(a.path, "utf8");
    for (const k of ablate) { if (k === "noblur") continue; const [re, to] = ABLATE[k] ?? []; if (!re || !re.test(src)) throw new Error(`ablation ${k} did not apply`); src = src.replace(re, to); }
    return { contents: src, loader: "tsx" };
  });
} };

const js = (await build({
  stdin: {
    contents: `import { createRoot } from "react-dom/client";
import NewsGlobe from "@/components/NewsGlobe";
createRoot(document.getElementById("root")).render(<NewsGlobe reduced={${shot ? "true" : "false"}} quality="auto" onClose={() => {}} />);`,
    loader: "tsx", resolveDir: path.join(root, "src"),
  },
  plugins: [ablatePlugin], bundle: true, write: false, format: "esm", jsx: "automatic", loader: { ".json": "json" }, keepNames: true,
  alias: { "@": path.join(root, "src") },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "error",
})).outputFiles[0].text;
// The app's own stylesheet (Tailwind's import dropped) + the few utilities the globe's layout needs to have a size.
let css = readFileSync(path.join(root, "src/app/globals.css"), "utf8").replace(/^@import[^\n]*\n/m, "") +
  ".bottom-36{bottom:9rem}.bottom-24{bottom:6rem}.left-3{left:.75rem}.right-3{right:.75rem}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}.absolute{position:absolute}.relative{position:relative}.inset-0{inset:0}.pointer-events-none{pointer-events:none}.overflow-hidden{overflow:hidden}.left-0{left:0}.top-0{top:0}.flex{display:flex}.hidden{display:none}" +
  ".globe-side{display:block!important}" + // narrower --size runs keep the side panel the hover/window/search steps click
  (noblur ? "*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}" : "");

/* ---------- fixture news: 60 countries, 8 stories each (as /api/news/geo returns) ---------- */
const PLACES = [
  ["United States of America", 39, -98], ["China", 35, 104], ["Russia", 61, 99], ["Ukraine", 49, 32], ["Israel", 31, 35], ["Iran", 32, 53],
  ["United Kingdom", 54, -2], ["France", 46, 2], ["Germany", 51, 10], ["India", 21, 78], ["Japan", 36, 138], ["Brazil", -10, -52],
  ["Canada", 57, -101], ["Australia", -25, 134], ["Mexico", 23, -102], ["Turkey", 39, 35], ["Egypt", 26, 30], ["Nigeria", 9, 8],
  ["South Africa", -29, 24], ["Saudi Arabia", 24, 45], ["Pakistan", 30, 69], ["Indonesia", -2, 118], ["Italy", 42, 12], ["Spain", 40, -4],
  ["Poland", 52, 19], ["Estonia", 59, 25], ["Finland", 64, 26], ["Sweden", 62, 15], ["Norway", 61, 8], ["Argentina", -34, -64],
  ["Colombia", 4, -73], ["Venezuela", 7, -66], ["Kenya", 0, 38], ["Ethiopia", 9, 40], ["Sudan", 15, 30], ["Syria", 35, 38],
  ["Iraq", 33, 44], ["Afghanistan", 33, 66], ["South Korea", 36, 128], ["North Korea", 40, 127], ["Taiwan", 23.7, 121], ["Philippines", 12, 122],
  ["Vietnam", 16, 107], ["Thailand", 15, 101], ["Netherlands", 52, 5], ["Belgium", 50.6, 4.6], ["Greece", 39, 22], ["Hungary", 47, 19],
  ["Romania", 46, 25], ["Chile", -30, -71], ["Peru", -9, -75], ["Morocco", 32, -6], ["Algeria", 28, 2], ["Libya", 27, 17],
  ["New Zealand", -41, 174], ["Bangladesh", 24, 90], ["Myanmar", 21, 96], ["Lebanon", 33.9, 35.9], ["Qatar", 25.3, 51.2], ["Serbia", 44, 21],
];
const story = (c, i, h) => ({ title: `${c} ${["talks", "vote", "strike", "deal", "storm", "markets", "court", "summit"][i % 8]} update ${h}h #${i}`,
  url: `https://news.example/${encodeURIComponent(c)}/${h}/${i}`, source: ["Reuters", "AP", "BBC", "ERR", "DW", "AFP"][i % 6], published_at: new Date(Date.now() - i * 3_600_000).toISOString() });
const geo = (hours) => {
  const n = hours === 24 ? 34 : hours === 72 ? 50 : 60; // a wider window places more countries
  const hotspots = PLACES.slice(0, n).map(([name, lat, lon], i) => ({ name, lat, lon, count: Math.max(1, Math.round((hours / 6) * 40 / (i + 2))),
    stories: Array.from({ length: 8 }, (_, k) => story(name, k, hours)) }));
  return { hours, total: hotspots.reduce((a, h) => a + h.count, 0), untagged: 12, hotspots };
};
const search = (q) => {
  const hs = PLACES.slice(3, 25).map(([name, lat, lon], i) => ({ name, lat, lon, count: 22 - i, stories: Array.from({ length: 4 }, (_, k) => story(name, k, 1)) }));
  return { results: hs.flatMap((h) => h.stories.map((s) => ({ ...s, title: `${q}: ${s.title}`, countries: [h.name], live: true }))), hotspots: hs };
};

/* ---------- in-page probes ---------- */
function probes() {
  const w = window;
  w.__b = { frames: [], long: [], events: [], gl: {}, cpu: [], phase: "open", marks: [] };
  const b = w.__b;
  // Main-thread time of each animation frame's callbacks (R3F's loop: React-free scene updates + three's render calls).
  // Under SwiftShader the GL raster runs in the GPU process, so this is the part that carries over to a real GPU.
  const raf = w.requestAnimationFrame.bind(w);
  w.requestAnimationFrame = (f) => raf((t) => { const t0 = performance.now(); try { f(t); } finally { b.cpu.push([performance.now() - t0, b.phase]); } });
  const loop = (t) => { b.frames.push([t, b.phase]); raf(loop); };
  raf(loop);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) b.long.push([e.startTime, e.duration, b.phase]); }).observe({ type: "longtask", buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) b.events.push([e.startTime, e.duration, e.name, b.phase, e.processingEnd - e.processingStart]); }).observe({ type: "event", durationThreshold: 16, buffered: true }); } catch {}
  // Synchronous cost of the WebGL calls that can stall a frame (uploads, mipmaps, shader work, readbacks), per phase.
  const TIMED = ["texImage2D", "texSubImage2D", "texStorage2D", "generateMipmap", "compileShader", "linkProgram", "getProgramParameter", "getShaderParameter", "bufferData", "readPixels", "drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"];
  for (const C of [w.WebGL2RenderingContext, w.WebGLRenderingContext]) {
    if (!C) continue;
    for (const k of TIMED) {
      const f = C.prototype[k];
      if (!f) continue;
      C.prototype[k] = function (...a) {
        const t0 = performance.now();
        try { return f.apply(this, a); } finally {
          const key = `${b.phase}:${k}`, s = (b.gl[key] ??= [0, 0, 0]);
          const ms = performance.now() - t0; s[0]++; s[1] += ms; s[2] = Math.max(s[2], ms);
        }
      };
    }
  }
}

const args = ["--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"];
if (!gpu) args.push("--enable-features=Vulkan", "--use-angle=swiftshader", "--enable-unsafe-swiftshader");
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : "/usr/bin/google-chrome"), headless: true, args });
const all = [];
let renderer = "";
try {
  for (let r = 0; r < runs; r++) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(probes);
    await page.addInitScript((v) => { try { localStorage.setItem("orbit.newsWeather.view", v); } catch {} }, view);
    const asked = [];
    await page.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.pathname.startsWith("/api/")) asked.push(u.pathname + u.search);
      if (u.origin !== origin) return route.abort();
      if (u.pathname === "/demo") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html data-motion="on"><head><style>${css}</style></head><body style="margin:0;background:#01040b"><main class="orbit-shell relative" style="width:100vw;height:100vh;overflow:hidden"><div id="root"></div></main><script type="module" src="/app.js"></script></body></html>` });
      if (u.pathname === "/app.js") return route.fulfill({ contentType: "text/javascript", body: js });
      if (u.pathname === "/api/news/geo") return route.fulfill({ json: geo(Number(u.searchParams.get("hours") ?? 72)) });
      if (u.pathname === "/api/briefings") return route.fulfill({ json: { briefings: [] } });
      if (u.pathname === "/api/news/follows") return route.fulfill({ json: { countries: ["Estonia", "Ukraine", "Finland"] } });
      if (u.pathname === "/api/news/search") {
        const c = u.searchParams.get("country");
        return route.fulfill({ json: c ? { results: Array.from({ length: 10 }, (_, k) => ({ ...story(c, k, 0), countries: [c], live: true })), local: [] } : search(u.searchParams.get("q") ?? "") });
      }
      return route.fulfill({ status: 404, json: { error: "No fixture" } });
    });
    const cdp = arg("--profile") && r === 0 ? await ctx.newCDPSession(page) : null;
    if (cdp) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 200 }); await cdp.send("Profiler.start"); }
    await page.goto(origin + "/demo");
    const phase = (p) => page.evaluate((p) => { window.__b.phase = p; }, p);
    await page.waitForSelector("canvas", { timeout: 30_000 });
    await page.waitForTimeout(7000); // open: prep, compile, fly-in
    if (!renderer) renderer = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2"), e = gl?.getExtension("WEBGL_debug_renderer_info");
      return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : "unknown";
    });
    await phase("idle"); await page.waitForTimeout(5000);
    if (shot) { await page.screenshot({ path: shot }); await ctx.close(); break; }
    const stopProfile = async () => { if (cdp) { const { profile } = await cdp.send("Profiler.stop"); writeFileSync(arg("--profile"), JSON.stringify(profile)); } };
    if (quick) { await phase("end"); all.push(await page.evaluate(() => window.__b)); await stopProfile(); await ctx.close(); continue; }
    await phase("hover");
    for (let i = 0; i < 80; i++) { await page.mouse.move(W * (0.35 + 0.3 * Math.sin(i / 9)), H * (0.4 + 0.2 * Math.cos(i / 7))); await page.waitForTimeout(50); }
    await page.mouse.move(5, H - 5);
    if (view === "weather") {
      await phase("switch");
      await page.getByRole("button", { name: /classic map/i }).click();
      await page.waitForTimeout(4000);
      await page.getByRole("button", { name: /news weather/i }).click();
      await page.waitForTimeout(3000);
      await phase("end");
      all.push(await page.evaluate(() => window.__b));
      await stopProfile();
      if (errors.length) console.error("page errors:", errors.slice(0, 5));
      await ctx.close();
      continue;
    }
    await phase("window");
    await page.getByRole("button", { name: "24h", exact: true }).click({ force: true });
    await page.waitForTimeout(3000);
    await page.getByRole("button", { name: "7d", exact: true }).click({ force: true });
    await page.waitForTimeout(3000);
    await phase("search");
    await page.getByLabel("Search world news").fill("energy prices");
    await page.getByRole("button", { name: "Search", exact: true }).click({ force: true });
    await page.waitForTimeout(4000);
    await page.getByRole("button", { name: "Clear", exact: true }).click({ force: true });
    await page.waitForTimeout(3000);
    await phase("country");
    await page.locator(".hud-row").first().click({ force: true });
    await page.waitForTimeout(4000);
    await phase("end");
    const b = await page.evaluate(() => window.__b);
    await stopProfile();
    if (errors.length) console.error("page errors:", errors.slice(0, 5));
    // The steps must really have run, or their numbers mean nothing.
    for (const need of ["hours=24", "hours=168", "/api/news/search?q=", "/api/news/search?country="])
      if (!asked.some((a) => a.includes(need))) console.error(`run ${r + 1}: step did not happen (no request with ${need})`);
    all.push(b);
    await ctx.close();
  }
} finally { await browser.close(); }

const stats = benchStats(all);
console.log(formatBench(stats, { renderer, size: `${W}x${H}@${dpr} · ${view} view${before ? ` · files from ${before}` : ""}${ablate.length ? ` · ablate ${ablate}` : ""}`, runs, software: !gpu }));
if (arg("--json")) writeFileSync(arg("--json"), JSON.stringify({ renderer, size: `${W}x${H}@${dpr}`, stats }, null, 2));
