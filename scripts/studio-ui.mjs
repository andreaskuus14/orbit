// node --no-warnings --experimental-strip-types scripts/studio-ui.mjs — the STUDIO planet in headless Chrome, used like the owner.
// Bundles the real StudioWorld (esbuild) and the app's real CSS (Tailwind via PostCSS), serves them on a fake origin through
// Playwright routes and answers /api/* from made-up test data: a channel with 18 videos, clip jobs (one cutting, one done with
// 3 Shorts to check, one failed), a download, YouTube Analytics with a retention curve, and one clip approval in Needs you.
// Nothing is uploaded or published: every POST is recorded and answered locally; the publish routes answer 403 and are counted.
// ST_TAG names the files (before / after). Out: ST_OUT (default ./smoke-shots/studio-ui). Exits 1 on a failed check (after only).
// Numbers: load time, idle fps + long tasks over 5 s, click → visible feedback, DOM nodes.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const req = createRequire(import.meta.url);
const { chromium } = (() => { try { return req("playwright"); } catch { return req("playwright-core"); } })();
const OUT = resolve(process.env.ST_OUT || "smoke-shots/studio-ui"), TAG = process.env.ST_TAG || "after", AFTER = !TAG.startsWith("before");
const SIZES = (process.env.ST_SIZES || "1440x900,1280x720").split(",").map((s) => s.split("x").map(Number));
const FLAT = process.env.ST_FLAT === "1"; // 2D view (no WebGL)
mkdirSync(OUT, { recursive: true });
const ORIGIN = "http://orbit.test";
const fails = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails.push(what); };

const cssIn = ["globals.css", "observatory.css", "motion.css"].map((f) => readFileSync(resolve("src/app", f), "utf8")).join("\n");
const css = (await postcss([tailwind({ base: resolve(".") })]).process(cssIn, { from: resolve("src/app/globals.css") })).css;

const out = (await build({
  stdin: { contents: `import { createRoot } from "react-dom/client";
import { useState } from "react";
import StudioWorld from "@/components/StudioWorld";
import { Toaster } from "@/components/ui";
function App() {
  const [review, setReview] = useState(null);
  return <main className="orbit-shell relative h-dvh w-full overflow-hidden" data-view="3d">
    <div className="kept absolute inset-0"><StudioWorld flat={${FLAT}} reduced={!!window.__reduced} quality="auto" onClose={() => { window.__closed = (window.__closed || 0) + 1; }}
      onOpenTask={(id) => { window.__task = id; }} open={null} review={review} onReview={setReview} /></div>
    <Toaster dismissLabel="Dismiss" />
  </main>;
}
createRoot(document.getElementById("root")).render(<App />);`, loader: "tsx", resolveDir: resolve("src") },
  bundle: true, write: false, outdir: "/tmp/studio-ui-out", format: "esm", jsx: "automatic", logLevel: "error", minify: !process.env.ST_NOMIN, sourcemap: process.env.ST_NOMIN ? "inline" : false,
  define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_SUPABASE_URL": '"http://x.test"', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"x"', "process.env.__NEXT_ROUTER_BASEPATH": '""' },
  loader: { ".json": "json", ".png": "dataurl", ".svg": "dataurl", ".glsl": "text", ".webp": "dataurl" },
})).outputFiles;
const appJs = out.find((f) => f.path.endsWith(".js")).text, moduleCss = out.find((f) => f.path.endsWith(".css"))?.text ?? "";
console.log(`bundle ${(appJs.length / 1024).toFixed(0)} KB js, ${(moduleCss.length / 1024).toFixed(0)} KB css`);

// ---- Test data (made up; shaped like the real routes) ----
const NOW = Date.now(), DAY = 86_400_000, iso = (ms) => new Date(ms).toISOString();
const TITLES = ["What if there was no military?", "Stickman: the last civilization", "What if gravity turned off for 5 seconds?", "A stickman army conquers the world",
  "What if an asteroid hit tomorrow?", "Life after the collapse", "What if the moon disappeared?", "Every country at war (stickman)", "What if you never slept again?",
  "The day the internet stopped", "What if oceans dried up?", "Stickman builds a city in 60 seconds", "What if humans could fly?", "Pet sim egg trick nobody uses",
  "What if money vanished?", "Stickman vs time", "What if the sun went out?", "Roblox pet sim update #3"];
const videos = TITLES.map((title, i) => {
  const short = i % 3 === 1;
  const age = (i * 2.3 + 0.6) * DAY;
  const views = Math.round((i === 0 ? 48_200 : i === 2 ? 21_900 : 1800 + ((i * 7919) % 12_000)) * (short ? 0.6 : 1));
  return { id: `vid${String(i).padStart(8, "0")}`.slice(0, 11), title, publishedAt: iso(NOW - age), views, likes: Math.round(views * 0.04), comments: Math.round(views * 0.004),
    durationSec: short ? 42 + i : 420 + i * 31, thumb: `${ORIGIN}/thumb/${i}.svg` };
});
const channel = { title: "Andreas Makes", handle: "@test", subs: 1240, views: videos.reduce((s, v) => s + v.views, 0), videoCount: videos.length, thumb: "" };
const HUES = [12, 210, 30, 260, 350, 190, 45, 280, 160, 0, 220, 300, 100, 20, 240, 330, 50, 270];
const thumbSvg = (i) => `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${HUES[i % 18]},45%,42%)"/><stop offset="1" stop-color="hsl(${HUES[i % 18] + 40},40%,14%)"/></linearGradient></defs><rect width="320" height="180" fill="url(#g)"/><circle cx="160" cy="70" r="14" fill="#111"/><path d="M160 84v46M160 98l-22 18M160 98l22 18M160 130l-18 30M160 130l18 30" stroke="#111" stroke-width="6" stroke-linecap="round"/></svg>`;
const clip = (id, status, score, extra = {}) => ({ id, start: 10, end: 52, title: `Moment ${id}`, hook: "Wait for it", reason: "Big reaction", score, status, video: `clips/${id}.mp4`, thumb: `clips/${id}.jpg`, ...extra });
const jobs = [
  { id: "job-cut-1", source: "stream-2026-11-22.mp4", createdAt: iso(NOW - 6 * 60_000), updatedAt: iso(NOW - 20_000), status: "rendering", progress: 0.62, step: "Cutting clip 2 of 3", warnings: [], clips: [], options: { count: 3, maxSec: 58, captions: true } },
  { id: "job-done-1", source: "What if there was no military.mp4", createdAt: iso(NOW - 3 * 3600_000), updatedAt: iso(NOW - 2 * 3600_000), status: "done", progress: 1, step: "3 clips ready", warnings: [],
    clips: [clip("c1", "ready", 0.81), clip("c2", "ready", 0.74), clip("c3", "ready", 0.66), clip("c4", "published", 0.7, { publish: { status: "done", videoId: videos[1].id, at: iso(NOW - DAY) } })], options: { count: 4, maxSec: 58, captions: true } },
  { id: "job-fail-1", source: "broken-file.mp4", createdAt: iso(NOW - 5 * 3600_000), updatedAt: iso(NOW - 4 * 3600_000), status: "failed", progress: 0.3, step: "Failed", error: "ffmpeg exited with code 1: moov atom not found", warnings: [], clips: [], options: { count: 3, maxSec: 58, captions: true } },
];
const downloads = [{ id: "dl-1", url: "https://www.youtube.com/watch?v=abcdefghijk", status: "downloading", progress: 0.4, step: "Downloading 40%", createdAt: iso(NOW - 2 * 60_000), permission: "own" }];
const clipsBody = { root: "C:/orbit/studio", tools: { ffmpeg: true, transcriber: true, ytdlp: true, missing: [] }, inbox: [{ name: "stream-2026-11-22.mp4", size: 1.2e9, mtime: iso(NOW - DAY), jobId: "job-cut-1" }],
  jobs, downloads, quarantined: [], publishing: null, failAck: [] };
const daily = Array.from({ length: 28 }, (_, i) => ({ day: iso(NOW - (27 - i) * DAY).slice(0, 10), views: 900 + Math.round(400 * Math.sin(i / 3)) + i * 30, watchMinutes: 2100 + i * 40, subsGained: 6 + (i % 5), subsLost: 1 }));
const tot = (k) => daily.reduce((s, d) => s + d[k], 0);
const totals = { views: tot("views"), watchMinutes: tot("watchMinutes"), avgViewSec: 96, subsGained: tot("subsGained"), subsLost: tot("subsLost"), likes: 1200, comments: 140, shares: 90 };
const retention = Array.from({ length: 41 }, (_, i) => { const t = i / 40; return { t, ratio: Math.max(0.18, 1 - 0.5 * t - (t > 0.68 ? 0.12 : 0) - 0.22 * Math.min(1, t * 8) * 0.5), relative: 0.5 }; });
const analytics = (video) => ({ connected: true, channelTitle: channel.title, range: { days: 28, start: daily[0].day, end: daily.at(-1).day }, totals, prevTotals: { ...totals, views: Math.round(totals.views * 0.8) }, daily,
  traffic: [{ source: "SHORTS", label: "Shorts feed", views: 14_000 }, { source: "YT_SEARCH", label: "YouTube search", views: 6000 }, { source: "SUBSCRIBER", label: "Browse", views: 4000 }],
  countries: [{ country: "EE", views: 9000 }, { country: "US", views: 7000 }, { country: "FI", views: 3000 }],
  topVideos: videos.slice(0, 5).map((v) => ({ id: v.id, views: v.views, watchMinutes: v.views * 2, avgViewSec: 80 })), retention: video ? retention : retention, engaged: { cur: 20_000, prev: 16_000 }, warnings: [], fetchedAt: iso(NOW) });
const needs = { items: [
  { ref: "approval:clips", kind: "decide", cause: "approval", title: "3 Shorts are ready to check", detail: "From “What if there was no military?”", at: iso(NOW - 2 * 3600_000), act: { open: { link: "#o=studio&k=review&id=c1" } } },
  { ref: "work:x", kind: "unblock", cause: "failed", title: "Cutting broken-file.mp4 failed", at: iso(NOW - 4 * 3600_000), act: { open: { panel: "studio", view: "review" } } },
] };

async function shoot(page, name) { await page.screenshot({ path: `${OUT}/${TAG}-${name}.png` }); }
const perf = { tag: TAG, flat: FLAT, sizes: {} };
const forbidden = []; // any request that would upload/publish
const html = `<!doctype html><html data-motion="on" class="dark" lang="en"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><style>:root{--font-inter:"Inter";--font-jetbrains:monospace;--font-rajdhani:sans-serif}</style><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`;

async function routes(ctx, calls, opts = {}) {
  await ctx.route(`${ORIGIN}/**`, async (route) => {
    const r = route.request(), u = new URL(r.url()), p = u.pathname, m = r.method();
    calls.push(`${m} ${p}${u.search}`);
    if (p === "/") return route.fulfill({ contentType: "text/html", body: html });
    if (p === "/app.css") return route.fulfill({ contentType: "text/css", body: css + "\n" + moduleCss });
    if (p === "/app.js") return route.fulfill({ contentType: "text/javascript", body: appJs });
    const th = p.match(/^\/thumb\/(\d+)\.svg$/);
    if (th) return route.fulfill({ contentType: "image/svg+xml", body: thumbSvg(+th[1]) });
    if (/publish|upload|oauth\/start|oauth\/disconnect|restore/.test(p) && m !== "GET") { forbidden.push(`${m} ${p}`); return route.fulfill({ status: 403, json: { error: "harness: no publishing" } }); }
    if (p.startsWith("/textures/")) return route.fulfill({ status: 404, body: "" });
    if (opts.noChannel && p === "/api/studio") return route.fulfill({ json: { configured: false, setup: { env: ["YOUTUBE_API_KEY", "YOUTUBE_CHANNEL"] } } });
    if (opts.broken && p.startsWith("/api/studio")) return route.fulfill({ status: 502, json: { error: "fetch failed: getaddrinfo ENOTFOUND www.googleapis.com" } });
    if (p === "/api/studio") return route.fulfill({ json: { configured: true, channel, videos, fetchedAt: iso(NOW) } });
    if (p === "/api/studio/clips" && m === "GET") return route.fulfill({ json: clipsBody });
    if (p === "/api/studio/analytics") {
      if (u.searchParams.get("results") === "1") return route.fulfill({ json: { shorts: [{ videoId: videos[1].id, title: videos[1].title, views24: 800, views48: 1500, changePct: 34, verdict: "worked", avgViewPct: 71 }], warnings: [], postmortem: null } });
      if (u.searchParams.get("forecast") === "1") return route.fulfill({ json: { items: [] } });
      return route.fulfill({ json: opts.noOauth ? { connected: false, reason: "not_connected" } : analytics(u.searchParams.get("video")) });
    }
    if (p === "/api/studio/oauth/status") return route.fulfill({ json: opts.noOauth ? { configured: true, connected: false, expired: false, canUpload: false } : { configured: true, connected: true, expired: false, canUpload: true, channelTitle: channel.title, connectedAt: iso(NOW - 9 * DAY) } });
    if (p === "/api/needs-you") return route.fulfill({ json: opts.noNeeds ? { items: [] } : needs });
    if (p === "/api/studio/production") return route.fulfill({ json: { records: [], jobs, live: [], outcomes: {}, capacity: null, bases: {} } });
    if (p === "/api/studio/autopilot") return route.fulfill({ json: { settings: { auto: false, dailyDownloads: 2 }, scout: { configured: false, creators: [] }, today: { left: 2 } } });
    if (p === "/api/autonomy") return route.fulfill({ json: { publish: "ask" } });
    if (p === "/api/tasks" && m === "POST") return route.fulfill({ json: { task: { id: "task-1" } } });
    if (p === "/api/ideas") return route.fulfill({ json: { ideas: [] } });
    if (p.startsWith("/api/studio/clips/media")) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 404, json: { error: "not in harness" } });
  });
}

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const steps = {}; // per-step notes, before only
try {
  for (const [w, h] of SIZES) {
    const name = `${w}`, P = {};
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage(), calls = [], errors = [];
    page.on("pageerror", (e) => { errors.push(e.message); if (process.env.ST_NOMIN) console.log(e.stack?.split("\n").slice(0, 6).join("\n")); });
    page.on("console", (m) => { if (m.type() === "error" && !/WebGL|GPU stall|404|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 160)); });
    page.on("dialog", (d) => d.dismiss());
    await page.addInitScript(() => {
      try { localStorage.setItem("orbit.lang", "en"); } catch {}
      window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: "longtask", buffered: true });
    });
    await routes(ctx, calls);
    const t0 = Date.now();
    await page.goto(`${ORIGIN}/`);
    await page.waitForFunction(() => document.body.innerText.includes("Andreas Makes") || document.body.innerText.includes("1.2K"), null, { timeout: 30_000 }).catch(() => {});
    P.firstDataMs = Date.now() - t0;
    await page.waitForTimeout(FLAT ? 1500 : +(process.env.ST_WAIT || 6000)); // swiftshader: shaders compile slowly
    P.loadLongTasks = await page.evaluate(() => ({ n: window.__lt.length, longestMs: Math.round(Math.max(0, ...window.__lt)), totalMs: Math.round(window.__lt.reduce((a, b) => a + b, 0)) }));
    await shoot(page, `${name}-home`);
    const cdp = await ctx.newCDPSession(page); await cdp.send("Performance.enable");
    const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
    const idle = async (ms = 5000) => {
      const a = await metrics();
      const r = await page.evaluate(async (ms) => {
        window.__lt.length = 0; let n = 0; const s = performance.now();
        await new Promise((ok) => { const f = () => { n++; if (performance.now() - s < ms) requestAnimationFrame(f); else ok(); }; requestAnimationFrame(f); });
        const lt = window.__lt.slice(); return { fps: Math.round((n / ((performance.now() - s) / 1000)) * 10) / 10, longTasks: lt.length, longestMs: Math.round(Math.max(0, ...lt)) };
      }, ms);
      const b = await metrics();
      return { ...r, scriptMsPerSec: Math.round(((b.ScriptDuration - a.ScriptDuration) * 1000) / (ms / 1000)), styleLayoutMsPerSec: Math.round((((b.RecalcStyleDuration - a.RecalcStyleDuration) + (b.LayoutDuration - a.LayoutDuration)) * 1000) / (ms / 1000)), domNodes: b.Nodes };
    };
    P.idle = await idle();
    const text = await page.locator("body").innerText();
    check(!/undefined|\bnull\b|NaN|Invalid Date/.test(text), `${TAG}-${name}: no undefined/null/NaN/Invalid Date on screen`);
    check(!/ENOTFOUND|moov atom|exited with code|\.env\.local|npm run/.test(text), `${TAG}-${name}: no raw error or developer text on the first screen`);
    // overlap: header/status lines vs the back button and the rail at this size
    P.overlaps = await page.evaluate(() => {
      const els = [...document.querySelectorAll(".studio button, .studio h2, .studio p, .studio a, .studio li, .studio input, .studio textarea")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; });
      const out = [];
      for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
        const a = els[i], b = els[j]; if (a.contains(b) || b.contains(a)) continue;
        const r = a.getBoundingClientRect(), s = b.getBoundingClientRect();
        const ox = Math.min(r.right, s.right) - Math.max(r.left, s.left), oy = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top);
        if (ox > 4 && oy > 4) out.push(`${(a.textContent || a.tagName).trim().slice(0, 30)} × ${(b.textContent || b.tagName).trim().slice(0, 30)}`);
      }
      return out.slice(0, 12);
    });
    P.offscreen = await page.evaluate(() => [...document.querySelectorAll(".studio button, .studio a")].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1); }).map((e) => (e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 30)).slice(0, 10));
    P.buttonsOnFirstScreen = await page.evaluate(() => [...document.querySelectorAll(".studio button, .studio a[href]")].filter((e) => e.getBoundingClientRect().width > 0).length);
    P.fontsOnFirstScreen = await page.evaluate(() => [...new Set([...document.querySelectorAll(".studio *")].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => getComputedStyle(e).fontFamily.split(",")[0].replace(/"/g, "").trim()))]);
    P.spacedCaps = await page.evaluate(() => [...document.querySelectorAll(".studio *")].filter((e) => { const s = getComputedStyle(e); return s.textTransform === "uppercase" && parseFloat(s.letterSpacing) > 1 && e.textContent.trim() && e.getBoundingClientRect().width > 0; }).map((e) => e.textContent.trim().slice(0, 24)).slice(0, 12));

    if (process.env.ST_HOME_ONLY) { /* shots + idle numbers only (the 3D pass) */ }
    else if (!AFTER) {
      // simple page → "More" → All tools; then a video; then Shorts tools, Stats
      const more = page.locator("details summary", { hasText: "More" }).first();
      if (await more.count()) { await more.click(); await page.waitForTimeout(300); await shoot(page, `${name}-more`); await page.getByRole("button", { name: /all tools|Manual/i }).first().click().catch(() => {}); await page.waitForTimeout(1200); }
      await shoot(page, `${name}-tools`);
      const row = page.locator(".hud-row").first();
      if (await row.count()) {
        const fb = await row.evaluate(async (el) => { const s = performance.now(); el.click(); for (let i = 0; i < 5 && el.getAttribute("aria-pressed") !== "true"; i++) await Promise.resolve(); return { ms: Math.round((performance.now() - s) * 10) / 10, on: el.getAttribute("aria-pressed") === "true" }; });
        P.pickFeedbackMs = fb.ms; await page.waitForTimeout(800); await shoot(page, `${name}-video`);
      }
      for (const label of ["Shorts", "Stats", "Production"]) {
        const b = page.locator(".studio-modes button", { hasText: new RegExp(`^${label}`) }).first();
        if (await b.count()) { const s = Date.now(); await b.click(); await page.waitForTimeout(2500); P[`open${label}Ms`] = Date.now() - s; await shoot(page, `${name}-${label.toLowerCase()}`); P[`${label}Idle`] = await idle(3000); }
      }
    } else {
      const shell = page.locator(".st-shell");
      check(await shell.count() === 1, `${name}: one STUDIO shell`);
      check(/Needs you/.test(await shell.innerText()), `${name}: Needs you shows the waiting Shorts`);
      check(/Working on it/.test(await shell.innerText()), `${name}: Working on it lists the running jobs`);
      check(await page.locator(".st-shell .pu-bar").count() >= 1, `${name}: a running job shows a progress bar`);
      const fit = await page.evaluate(() => { const s = document.querySelector(".st-shell")?.getBoundingClientRect(); return s ? { top: Math.round(s.top), bottom: Math.round(s.bottom), h: innerHeight, right: Math.round(s.right), w: innerWidth } : null; });
      check(!!fit && fit.bottom <= fit.h + 1 && fit.right <= fit.w + 1 && fit.top >= 0, `${name}: the shell fits the window (${JSON.stringify(fit)})`);
      // a video: click → selected in the same frame, then the details sheet with retention
      const vid = page.locator(".st-video").first();
      const c0 = Date.now();
      const fb = await vid.evaluate(async (el) => { const s = performance.now(); el.click(); for (let i = 0; i < 5 && el.getAttribute("aria-current") !== "true"; i++) await Promise.resolve(); return { ms: Math.round((performance.now() - s) * 10) / 10, on: el.getAttribute("aria-current") === "true" }; });
      P.pickFeedbackMs = fb.ms; check(fb.on, `${name}: a video click marks the row before the next frame (${fb.ms} ms)`);
      await page.locator(".pu-sheet").waitFor({ timeout: 15_000 }).catch(() => {});
      P.sheetOpenMs = Date.now() - c0; // click → the sheet is in the DOM (it slides in over 320 ms after that)
      await page.waitForTimeout(600);
      check(await page.locator(".pu-sheet").count() === 1, `${name}: the video opens in a sheet`);
      await shoot(page, `${name}-video`);
      if (w === 1440) {
        await page.locator(".pu-sheet").getByRole("button", { name: /Title and thumbnail ideas/ }).click(); await page.waitForTimeout(600);
        check(calls.some((c) => c === "POST /api/tasks"), "ideas: starts a Forge task (no publish)");
      }
      await page.keyboard.press("Escape"); await page.locator(".pu-sheet").waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
      check(await page.locator(".pu-sheet").count() === 0, `${name}: Esc closes the video sheet`);
      // the menu: tools open in the workspace with a way back
      await page.getByRole("button", { name: "More", exact: true }).click(); await page.getByRole("menu").waitFor({ timeout: 15_000 }).catch(() => {}); await page.waitForTimeout(300);
      await shoot(page, `${name}-menu`);
      check(await page.getByRole("menuitem").first().evaluate((el) => el === document.activeElement), `${name}: menu opens with focus on its first item`);
      for (const [label, file] of [["Shorts tools", "shorts"], ["Stats", "stats"], ["Production", "production"]]) {
        if (!(await page.getByRole("menu").count())) { await page.getByRole("button", { name: "More", exact: true }).click({ timeout: 120_000 }); await page.getByRole("menu").waitFor({ timeout: 30_000 }).catch(() => {}); }
        const s = Date.now(); await page.getByRole("menuitem", { name: new RegExp(`^${label}`) }).click({ timeout: 120_000 }); await page.locator(".st-tool-back").waitFor({ timeout: 20_000 }).catch(() => {}); P[`open${file}Ms`] = Date.now() - s; await page.waitForTimeout(2000);
        await shoot(page, `${name}-${file}`); P[`${file}Idle`] = await idle(3000);
        check(await page.locator(".st-tool-back").count() === 1, `${name}: ${label} has a way back`);
        await page.locator(".st-tool-back").click({ timeout: 120_000 }); await page.locator(".st-shell").waitFor({ timeout: 20_000 }).catch(() => {});
      }
      check(await page.locator(".st-shell").count() === 1, `${name}: back returns to the shell`);
      // the ask box sends to CORE (VOICE_ASK) and clears
      const ask = page.getByRole("textbox", { name: /Ask Studio/ });
      await page.evaluate(() => { window.__asked = null; addEventListener("orbit:voice-ask", (e) => { window.__asked = e.detail?.text; }); });
      await ask.fill("Find Shorts in my last video"); await ask.press("Enter"); await page.waitForTimeout(300);
      check(await page.evaluate(() => window.__asked) === "Find Shorts in my last video", `${name}: the ask goes to CORE`);
    }
    check(!forbidden.length, `${TAG}-${name}: nothing tried to upload or publish (${forbidden.join(", ")})`);
    check(!errors.length, `${TAG}-${name}: no page errors${errors.length ? ` (${errors.slice(0, 3).join(" | ")})` : ""}`);
    perf.sizes[name] = P;
    await ctx.close();
  }
  // states: not connected / broken API / reduced motion
  if (!process.env.ST_HOME_ONLY) for (const [state, opts] of [["noChannel", { noChannel: true, noOauth: true, noNeeds: true }], ["broken", { broken: true, noNeeds: true }]]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage(), calls = [];
    await page.addInitScript(() => { try { localStorage.setItem("orbit.lang", "en"); } catch {} });
    await routes(ctx, calls, opts); await page.goto(`${ORIGIN}/`); await page.waitForTimeout(FLAT ? 2000 : 5000);
    const t = await page.locator("body").innerText();
    perf[`${state}Text`] = t.slice(0, 600);
    if (AFTER) check(!/ENOTFOUND|getaddrinfo|\.env\.local|npm run/.test(t), `${state}: plain words, no raw error or developer text`);
    await shoot(page, `1440-${state}`); await ctx.close();
  }
  if (!process.env.ST_HOME_ONLY) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" }); const page = await ctx.newPage(), calls = [];
    await page.addInitScript(() => { window.__reduced = true; try { localStorage.setItem("orbit.lang", "en"); } catch {} });
    await routes(ctx, calls); await page.goto(`${ORIGIN}/`); await page.waitForTimeout(FLAT ? 2000 : 6000);
    perf.reducedAnimations = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && !String(a.animationName || "").includes("spin")).map((a) => a.animationName || a.constructor.name).slice(0, 10));
    await shoot(page, "1440-reduced"); await ctx.close();
  }
} finally { await browser.close(); }
writeFileSync(`${OUT}/${TAG}-perf.json`, JSON.stringify(perf, null, 2));
console.log(JSON.stringify(perf, null, 2));
if (fails.length) { console.log(`${fails.length} check(s) failed`); if (AFTER) process.exitCode = 1; }
