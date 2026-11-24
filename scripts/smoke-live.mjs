// npm run smoke:live — after an update, check his own running ORBIT (default http://127.0.0.1:3000) end to end. Read-only:
// only GET requests; in the browser part every non-GET request is blocked and listed. Nothing is sent, published or spent.
// Sign-in: ORBIT's own session cookie, exported by him to a local file (SMOKE_COOKIE_FILE, default ./.smoke-cookie.txt, git-ignored):
// either the raw Cookie header text or a JSON array of {name, value}. See docs/SMOKE.md.
// Out: a pass/fail table, smoke-shots/live-<date>/report.json and (if Playwright + a browser are there) one screenshot per screen.
// Exit 1 if anything failed.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { commitCheck, cookieHeader, httpVerdict, parseCookieFile, privateKeys, realConsoleErrors, runFolder, summarize, tileOf } from "../src/lib/smoke-live-pure.ts";

const BASE = (process.env.SMOKE_BASE || "http://127.0.0.1:3000").replace(/\/$/, "");
const COOKIE_FILE = resolve(process.env.SMOKE_COOKIE_FILE || ".smoke-cookie.txt");
const OUT = resolve(process.env.SMOKE_OUT || "smoke-shots", runFolder(new Date()));
mkdirSync(OUT, { recursive: true });
const results = [];
const add = (r) => { results.push(r); console.log(`${r.verdict.toUpperCase().padEnd(4)}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`); };

const cookies = existsSync(COOKIE_FILE) ? parseCookieFile(readFileSync(COOKIE_FILE, "utf8")) : [];
const COOKIE = cookieHeader(cookies);
if (!cookies.length) console.log(`No session cookie in ${COOKIE_FILE}: signed-in checks will fail with 401. See docs/SMOKE.md.`);

async function get(path, { auth = true, timeout = 20000 } = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + path, { headers: auth && COOKIE ? { cookie: COOKIE } : {}, redirect: "manual", signal: AbortSignal.timeout(timeout) });
    const type = r.headers.get("content-type") || "";
    const buf = Buffer.from(await r.arrayBuffer());
    let json = null;
    if (type.includes("json")) try { json = JSON.parse(buf.toString("utf8")); } catch { /* not json */ }
    return { status: r.status, type, size: buf.length, json, text: type.includes("json") || type.startsWith("text") ? buf.toString("utf8").slice(0, 300) : "", ms: Date.now() - t0 };
  } catch (e) { return { status: 0, type: "", size: 0, json: null, text: String(e?.message || e), ms: Date.now() - t0 }; }
}
/** One route: default verdict by status, then an optional extra check (returns { verdict, detail } to override). */
async function route(name, path, extra, opts) {
  const r = await get(path, opts);
  let res = { name, verdict: httpVerdict(r.status), status: r.status, ms: r.ms, detail: r.status === 0 ? r.text : r.status >= 400 ? (r.json?.error || r.text || "").slice(0, 120) : `${r.ms} ms` };
  if (extra) { const x = extra(r); if (x) res = { ...res, ...x }; }
  add(res);
  return r;
}

// ---- server + build ----
const health = await route("/api/health", "/api/health", null, { auth: false });
if (health.status === 0) {
  add({ name: "server answers", verdict: "fail", detail: `nothing on ${BASE}: is ORBIT running?` });
  console.log(`\n${summarize(results).table}`);
  process.exit(1);
}
let head = null;
try { head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* no git on PATH */ }
add(commitCheck(health.json?.commit, head));
await route("signed in", "/api/team-status", (r) => r.status === 401 ? { detail: "cookie missing or expired: export it again" } : null);

// ---- planets ----
const lifeOk = (r) => { if (r.status !== 200) return null; const bad = privateKeys(r.json); return bad.length ? { verdict: "fail", detail: `journal fields in lite answer: ${bad.slice(0, 4).join(", ")}` } : { detail: "no journal fields" }; };
const PLANET_API = [
  ["VAULT", "/api/vault"],
  ["STUDIO", "/api/studio/oauth/status"],
  ["OPERATIONS", "/api/tasks"],
  ["MEMORY", "/api/memories"],
  ["AGENTS status poll", "/api/team-status"],
  ["ANALYTICS summary", "/api/analytics/summary"],
  ["BUSINESS", "/api/business/overview"],
  ["LIFE lite", "/api/life?lite=1", lifeOk],
  ["ARCH", "/api/arch/studio"],
  ["GAME DEV", "/api/devworld"],
];
for (const [n, p, x] of PLANET_API) await route(`${n} ${p}`, p, x);

// ---- Earth (outside sources may be down: the routes must say so, not crash) ----
await route("earth tile (day 2/2/1)", "/api/earth/tile?k=day&z=2&x=2&y=1", (r) =>
  r.status === 200 ? (r.type.startsWith("image/") && r.size > 0 ? { detail: `${r.size} B ${r.type}` } : { verdict: "fail", detail: `not an image (${r.type})` })
  : r.status === 502 && /tile unavailable/.test(r.text) ? { verdict: "warn", detail: "offline: tile source not reachable, nothing cached" } : null);
await route("earth local", "/api/earth/local");
await route("earth region (Helsinki)", "/api/earth/region?lon=24.94&lat=60.17&alt=500", (r) => r.status === 200 && !Array.isArray(r.json?.towns) ? { verdict: "fail", detail: "no towns list" } : null, { timeout: 45000 });
const tt = tileOf(24.745, 59.437, 14);
await route(`earth buildings (Tallinn ${tt.x}/${tt.y})`, `/api/earth/buildings?x=${tt.x}&y=${tt.y}`, (r) =>
  r.status !== 200 ? null : r.json?.offline ? { verdict: "warn", detail: "offline: Overpass not reachable (handled)" }
  : Array.isArray(r.json?.buildings) ? { detail: `${r.json.buildings.length} buildings` } : { verdict: "fail", detail: "no buildings list" }, { timeout: 60000 });

// ---- news pictures: 200 picture or 404 "none" are both fine ----
await route("news thumb (icon)", `/api/news/thumb?kind=icon&u=${encodeURIComponent("https://www.err.ee/")}`, (r) =>
  r.status === 404 ? { verdict: "pass", detail: "no picture (404, handled)" } : r.status === 200 && !r.type.startsWith("image/") ? { verdict: "fail", detail: `not an image (${r.type})` } : null);

// ---- phone app ----
await route("/m/manifest.webmanifest (no cookie)", "/m/manifest.webmanifest", (r) => {
  if (r.status !== 200) return null;
  let m = r.json; try { m ??= JSON.parse(r.text); } catch { /* fallthrough */ }
  return m?.name && m?.start_url ? { detail: `${m.name} → ${m.start_url}` } : { verdict: "fail", detail: "manifest has no name/start_url" };
}, { auth: false });
await route("/m page", "/m");

// ---- GPU queue: with ORBIT_GPU_QUEUE off it must answer {on:false, jobs:[]} ----
await route("gpu-jobs", "/api/gpu-jobs", (r) => r.status !== 200 ? null
  : r.json?.on === false ? (Array.isArray(r.json.jobs) && r.json.jobs.length === 0 ? { detail: "flag off, empty" } : { verdict: "fail", detail: "flag off but jobs listed" })
  : { verdict: "warn", detail: "queue is ON (ORBIT_GPU_QUEUE=1): off-state not checked" });

// ---- browser: home + each planet, console errors, long tasks, 5xx, screenshots ----
const PLANETS = ["vault", "studio", "operations", "memory", "agents", "analytics", "business", "life", "arch", "creation", "intelligence"];
const browserRows = [];
let chromium = null;
try { const req = createRequire(import.meta.url); ({ chromium } = (() => { try { return req("playwright"); } catch { return req("playwright-core"); } })()); } catch { /* none */ }
let browser = null;
if (chromium && process.env.SMOKE_BROWSER !== "0") {
  // Playwright's own Chromium if installed, else the Edge / Chrome already on the laptop.
  for (const o of [{}, { channel: "msedge" }, { channel: "chrome" }]) { try { browser = await chromium.launch({ headless: true, ...o }); break; } catch { /* next */ } }
}
if (!browser) add({ name: "browser checks", verdict: "warn", detail: chromium ? "no browser found (npx playwright-core install chromium, or install Edge)" : "Playwright not installed: HTTP checks only" });
else {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const url = new URL(BASE);
  if (cookies.length) await ctx.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, domain: url.hostname, path: "/", httpOnly: false, secure: url.protocol === "https:", sameSite: "Lax" })));
  await ctx.addInitScript(() => {
    window.__longTasks = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longTasks.push(Math.round(e.duration)); }).observe({ type: "longtask", buffered: true }); } catch { /* unsupported */ }
  });
  for (const id of ["home", ...PLANETS]) {
    const page = await ctx.newPage(), errors = [], blocked = [], server5xx = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e.message).slice(0, 200)}`));
    page.on("response", (r) => { if (r.status() >= 500) server5xx.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    // Read-only: block every write the page tries (presence pings, saves...), keep a list.
    await page.route("**/*", (rt) => { const q = rt.request(); if (!["GET", "HEAD", "OPTIONS"].includes(q.method())) { blocked.push(new URL(q.url()).pathname); return rt.abort(); } return rt.continue(); });
    const t0 = Date.now();
    let status = 0;
    try {
      const resp = await page.goto(id === "home" ? `${BASE}/` : `${BASE}/#o=${id}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      status = resp?.status() ?? 0;
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2500);
    } catch (e) { errors.push(`load: ${String(e.message).slice(0, 160)}`); }
    const loadMs = Date.now() - t0;
    const onLogin = new URL(page.url()).pathname.startsWith("/login");
    const crashed = await page.getByText(/Application error|Unhandled Runtime Error|client-side exception/i).count().catch(() => 0);
    const longTasks = await page.evaluate(() => window.__longTasks || []).catch(() => []);
    const shot = join(OUT, `${id}.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    const real = realConsoleErrors(errors, blocked);
    const verdict = onLogin || crashed || server5xx.length || !status || status >= 500 ? "fail" : real.length ? "warn" : "pass";
    const detail = onLogin ? "sent to /login: cookie missing or expired" : crashed ? "Next error screen" : server5xx.length ? server5xx.slice(0, 3).join(", ")
      : `${real.length} console errors, ${longTasks.length} long tasks (max ${Math.max(0, ...longTasks)} ms), ${loadMs} ms`;
    add({ name: `screen ${id}`, verdict, status, ms: loadMs, detail });
    browserRows.push({ id, status, loadMs, consoleErrors: real, blockedWrites: [...new Set(blocked)], server5xx, longTasks, screenshot: shot });
    await page.close();
  }
  await browser.close();
}

// ---- no 5xx anywhere ----
const any5xx = results.filter((r) => r.status >= 500 && r.verdict !== "warn");
add({ name: "no 5xx", verdict: any5xx.length ? "fail" : "pass", detail: any5xx.map((r) => r.name).join(", ") });

const s = summarize(results);
const report = { at: new Date().toISOString(), base: BASE, head, served: health.json?.commit ?? null, totals: { pass: s.pass, warn: s.warn, fail: s.fail }, results, browser: browserRows };
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(`\n${s.table}\nReport: ${join(OUT, "report.json")}`);
process.exit(s.exitCode);
