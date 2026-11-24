// node --no-warnings scripts/home-ui.mjs — the galaxy home + CORE chat in headless Chrome, used like the owner.
// Bundles the REAL Orbit.tsx (esbuild, minified production build) with the app's real CSS, serves it on a fake origin through
// Playwright routes, swaps the Supabase browser client for an in-memory one and answers /api/* with made-up data: two jobs working,
// one waiting for his click, one failed, a morning brief, notifications and a CORE reply that streams with steps and citations.
// No server, no sign-in, no network, no model.
// HOME_TAG names the files (before / after). Out: HOME_OUT (default ./smoke-shots/home-ui). HOME_SIZES (default 1440x900,1280x720).
// Numbers per size: idle fps + long tasks on home (UI layer: galaxy=0 hides the WebGL canvas so software GL doesn't drown it, and with
// the galaxy on too), input latency (key → painted text in the command field), click → first visible feedback for the top-bar
// buttons, CORE open → first paint, the CORE answer stream (longest task while streaming).
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const req = createRequire(import.meta.url);
const { chromium } = (() => { try { return req("playwright"); } catch { return req("playwright-core"); } })();
const postcss = req("postcss"), tailwind = req("@tailwindcss/postcss");
const ROOT = resolve(".");
const OUT = resolve(process.env.HOME_OUT || "smoke-shots/home-ui"), TAG = process.env.HOME_TAG || "after";
const SIZES = (process.env.HOME_SIZES || "1440x900,1280x720").split(",").map((s) => s.split("x").map(Number));
const LANG = process.env.HOME_LANG || "en";
mkdirSync(OUT, { recursive: true });
const ORIGIN = "http://orbit.test";
const fails = [], notes = [], unknown = new Set();
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails.push(what); };

// ---- CSS: what the root layout imports, through the app's PostCSS (Tailwind 4) ----
const cssPath = resolve("src/app/globals.css");
const css = (await postcss([tailwind({ base: ROOT })]).process(readFileSync(cssPath, "utf8"), { from: cssPath })).css
  + ["observatory.css", "motion.css"].map((f) => readFileSync(resolve("src/app", f), "utf8")).join("\n");

// ---- the Supabase browser client → in-memory tables ----
const SUPA = `
const now = Date.now(), iso = (ms) => new Date(now - ms).toISOString();
const T = window.__tasks = window.__tasks || [
  { id: "t-shorts", title: "Make 3 Shorts from my last video", agent: "nova", request: "youtube shorts", status: "running", result: null, error: null, created_at: iso(240000), started_at: iso(230000), finished_at: null, trace: [{ step: "research" }, { step: "render" }], pending: null, parent_id: null },
  { id: "t-leads", title: "Find 20 cafés in Tallinn for the plant shop", agent: "atlas", request: "leads", status: "running", result: null, error: null, created_at: iso(600000), started_at: iso(590000), finished_at: null, trace: [{ step: "web_search" }, { step: "fetch_url" }], pending: null, parent_id: null },
  { id: "t-email", title: "Email to Kask café", agent: "nova", request: "email", status: "awaiting_approval", result: null, error: null, created_at: iso(900000), started_at: iso(890000), finished_at: null, trace: [{ step: "draft" }], pending: { tool: "send_email" }, parent_id: null },
  { id: "t-thumb", title: "Thumbnail test: face vs no face", agent: "nova", request: "thumb", status: "failed", result: null, error: "The image service did not answer. Nothing was spent.", created_at: iso(3600000), started_at: iso(3500000), finished_at: iso(3400000), trace: [{ step: "image" }], pending: null, parent_id: null },
  { id: "t-done1", title: "Summarise this week's pet sim reviews", agent: "atlas", request: "x", status: "complete", result: "42 reviews: players want trading and a rebirth shop.", error: null, created_at: iso(7200000), started_at: iso(7100000), finished_at: iso(6800000), trace: [{ step: "research" }], pending: null, parent_id: null },
  { id: "t-done2", title: "Plan the architecture study week", agent: "nova", request: "x", status: "complete", result: "Five days, 40 min each, sketching first.", error: null, created_at: iso(9200000), started_at: iso(9100000), finished_at: iso(8800000), trace: [{ step: "plan" }], pending: null, parent_id: null },
  { id: "t-done3", title: "Check ORBIT backups", agent: "nova", request: "x", status: "complete", result: "All 3 backups are fine.", error: null, created_at: iso(12200000), started_at: iso(12100000), finished_at: iso(11800000), trace: [{ step: "check" }], pending: null, parent_id: null },
];
function q(table) {
  const st = { table, head: false, filters: [] };
  const run = () => {
    if (st.head) return { data: null, count: table === "memories" ? 1284 : 0, error: null };
    if (table === "tasks") {
      let rows = T.slice();
      for (const [k, v] of st.filters) if (k === "in") rows = rows.filter((r) => v.includes(r.status)); else if (k === "gte") rows = rows.filter((r) => r.finished_at && r.finished_at >= v);
      return { data: rows, error: null };
    }
    if (table === "events") return { data: [], error: null };
    return { data: [], error: null };
  };
  const b = {
    select(_c, o) { if (o && o.head) st.head = true; return b; }, is() { return b; }, eq() { return b; }, neq() { return b; }, or() { return b; }, order() { return b; }, limit() { return b; },
    in(_k, v) { st.filters.push(["in", v]); return b; }, gte(_k, v) { st.filters.push(["gte", v]); return b; }, lte() { return b; }, not() { return b; }, ilike() { return b; }, match() { return b; }, range() { return b; },
    single() { return Promise.resolve({ data: null, error: null }); }, maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    insert() { return b; }, update() { return b; }, upsert() { return b; }, delete() { return b; },
    then(ok, bad) { return Promise.resolve(run()).then(ok, bad); },
  };
  return b;
}
const ch = { on() { return ch; }, subscribe(cb) { setTimeout(() => cb && cb("SUBSCRIBED"), 50); return ch; }, unsubscribe() {} };
const client = { from: q, channel: () => ch, removeChannel: () => Promise.resolve(), rpc: () => Promise.resolve({ data: null, error: null }),
  auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1", email: "owner@example.test" } } }), getSession: () => Promise.resolve({ data: { session: null } }), signOut: () => Promise.resolve({}), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  storage: { from: () => ({ upload: () => Promise.resolve({}), createSignedUrl: () => Promise.resolve({ data: null }) }) } };
export function createClient() { return client; }
`;
const supaPlugin = { name: "supa", setup(b) {
  b.onResolve({ filter: /^@\/lib\/supabase\/client$/ }, () => ({ path: "supa", namespace: "supa" }));
  b.onLoad({ filter: /.*/, namespace: "supa" }, () => ({ contents: SUPA, loader: "js" }));
} };

const galaxyStub = { name: "galaxy-stub", setup(b) {
  b.onResolve({ filter: /^\.\/Galaxy$/ }, (a) => (a.importer.endsWith("Orbit.tsx") ? { path: "galaxy", namespace: "gstub" } : undefined));
  b.onLoad({ filter: /.*/, namespace: "gstub" }, () => ({ contents: "export default function Galaxy(){ return null; }", loader: "js" }));
} };
async function bundle(stub) {
  const out = (await build({
    stdin: { contents: `import { createRoot } from "react-dom/client";
import Orbit from "@/components/Orbit";
createRoot(document.getElementById("root")).render(<Orbit userId="u1" email="owner@example.test" />);`, loader: "tsx", resolveDir: resolve("src") },
    bundle: true, write: false, outdir: "/tmp/home-ui-out", format: "esm", jsx: "automatic", logLevel: "error", minify: !process.env.HOME_NOMIN, sourcemap: process.env.HOME_NOMIN ? "inline" : false,
    splitting: true, chunkNames: "c-[hash]", tsconfig: resolve("tsconfig.json"),
    banner: { js: 'globalThis.process ??= { env: { NODE_ENV: "production" } };' },
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_SUPABASE_URL": '"http://x.test"', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"x"', "process.env.__NEXT_ROUTER_BASEPATH": '""' },
    alias: { "next/navigation": resolve("node_modules/next/dist/client/components/navigation.js") },
    plugins: stub ? [supaPlugin, galaxyStub] : [supaPlugin],
    loader: { ".json": "json", ".png": "dataurl", ".svg": "dataurl", ".glsl": "text", ".module.css": "local-css", ".css": "css", ".woff2": "dataurl", ".ttf": "dataurl" },
  })).outputFiles;
  return { files: new Map(out.map((f) => [`/${f.path.split("/").pop()}`, f])), css: out.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n"),
    entry: `/${out.find((f) => /\/stdin\.js$/.test(f.path)).path.split("/").pop()}`, kb: out.filter((f) => f.path.endsWith(".js")).reduce((a, f) => a + f.contents.length, 0) / 1024 };
}
const B = { full: await bundle(false), ui: await bundle(true) };
console.log(`bundle ${B.full.kb.toFixed(0)} KB js`);

// ---- made-up data, shaped like the real routes ----
const NOW = Date.now(), ago = (ms) => new Date(NOW - ms).toISOString();
const NEEDS = [{ ref: "approval:e1", kind: "decide", cause: "approval", title: "Send the email to Kask café?", detail: "The draft is ready. Nothing is sent until you approve.", at: ago(900000), act: { open: { task: "t-email" } } },
  { ref: "review:c1", kind: "review", cause: "review", title: "3 Shorts are ready to check", detail: "From Friday's stream", at: ago(1800000), act: { open: { panel: "studio" } } }];
const CHECKS = [{ id: "ollama", status: "ok", label: "Local model" }, { id: "claude", status: "ok", label: "Claude" }, { id: "higgsfield", status: "warn", label: "Higgsfield", detail: "Key missing" }];
const REPLY = "Here is what I found. The **plant shop** idea fits Tallinn well: 14 cafés already sell plants [m:00000000-0000-4000-8000-0000000000c1], and desk plants sell best at **19–24 €** ([Etsy prices](https://www.etsy.com/market/desk_plants)).\n\n- Start with 20 cafés in Kalamaja and the Old Town\n- Ask 3 of them for a 2-week trial\n- I can draft the first emails now (nothing is sent without you)";
function coreStream() {
  const lines = [
    { type: "start", conversationId: "c-1" }, { type: "route", model: "smart" },
    { type: "step", label: "Searching the web", tool: "web_search" }, { type: "step_done" },
    { type: "step", label: "Reading pages", tool: "fetch_url" }, { type: "step_done" },
  ];
  for (const w of REPLY.match(/.{1,18}/gs)) lines.push({ type: "delta", text: w });
  lines.push({ type: "done", answer: REPLY, model: "smart", citations: [{ id: "00000000-0000-4000-8000-0000000000c1", title: "Café list, Tallinn (saved note)", kind: "memory" }],
    trace: [{ step: "web_search", detail: "plant shops Tallinn", ms: 1200, ok: true }, { step: "fetch_url", detail: "visittallinn.ee", ms: 900, ok: true }] });
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}
const API = (p, u) => ({
  "/api/needs-you": { items: NEEDS }, "/api/doctor": { checks: CHECKS }, "/api/automations": { failing: false, automations: [] },
  "/api/life": { habits: [{ scheduledToday: true, doneToday: true }, { scheduledToday: true, doneToday: false }] }, "/api/scout": { glowing: 2 },
  "/api/higgsfield": { used: 3, cap: 20 }, "/api/goals": { cards: [], goals: [] }, "/api/research": { cards: [] }, "/api/insights": { items: [] },
  "/api/presence": { ok: true }, "/api/health": { ok: true }, "/api/speak-first": { approvals: [], incidents: [], meetings: [], loops: [] }, "/api/stop-all": { stop: { on: false, at: null }, host: { busy: false } }, "/api/morning": {}, "/api/focus": { block: null },
  "/api/core/chats": u.searchParams.get("id") ? { messages: [{ role: "user", content: "Is a plant shop for cafés in Tallinn a good idea?" }, { role: "assistant", content: REPLY, citations: [{ id: "00000000-0000-4000-8000-0000000000c1", title: "Café list, Tallinn (saved note)", kind: "memory" }] }] } : { chats: [{ id: "c-0", title: "Plant shop ideas", updated_at: ago(86400000) }, { id: "c-00", title: "Pet sim egg odds", updated_at: ago(2 * 86400000) }], projects: [], map: {} },
  "/api/notifications": { items: [] }, "/api/studio/clips": { clips: [] }, "/api/plans": { plans: [] }, "/api/playbook": { items: [] },
}[p]);

async function shoot(page, name) { await page.screenshot({ path: `${OUT}/${TAG}-${name}.png`, timeout: 180_000 }); }
const perf = { tag: TAG, lang: LANG, sizes: {} };
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

async function open(w, h, { reduced = false, galaxy = true, motion = "on" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage(), calls = [], errors = [], bd = galaxy ? B.full : B.ui;
  page.on("pageerror", (e) => { errors.push(e.message); if (process.env.HOME_NOMIN) console.log(e.stack?.split("\n").slice(0, 5).join("\n")); });
  page.on("console", (m) => { if (m.type() === "error" && !/WebGL|GPU stall|404|Failed to load resource|GL_|swiftshader/i.test(m.text())) errors.push(m.text().slice(0, 200)); });
  page.on("dialog", (d) => d.dismiss());
  await page.addInitScript(({ lang, galaxy }) => {
    try { sessionStorage.setItem("orbit.booted", "1"); sessionStorage.setItem("orbit.woke", "1"); localStorage.setItem("orbit.woke", "1"); localStorage.setItem("orbit.lang", lang); localStorage.setItem("orbit.view", "3d"); localStorage.setItem("orbit.boot.seen", "1"); localStorage.setItem("orbit.tour.v1", "done"); localStorage.setItem("orbit.home.fold.v2", "0"); } catch {}
    if (!galaxy) { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (k, o) { return /webgl/.test(k) && this.isConnected ? null : g.call(this, k, o); }; } // UI layer: the CSS orb (software GL would drown the numbers)
    window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: "longtask", buffered: true });
  }, { lang: LANG, galaxy });
  await ctx.route(`${ORIGIN}/**`, async (route) => {
    const r = route.request(), u = new URL(r.url()), p = u.pathname;
    calls.push(`${r.method()} ${p}${u.search}`);
    if (p === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en" data-motion="${motion}"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><style>:root{--font-inter:"Inter";--font-jetbrains:"JetBrains Mono",monospace;--font-rajdhani:"Rajdhani","Inter",sans-serif;--font-serif:"Source Serif 4",serif}</style><body><div id="root"></div><script type="module" src="${bd.entry}"></script></body></html>` });
    if (p === "/app.css") return route.fulfill({ contentType: "text/css", body: css + "\n" + bd.css });
    if (bd.files.has(p)) return route.fulfill({ contentType: p.endsWith(".css") ? "text/css" : "text/javascript", body: bd.files.get(p).text });
    const pub = resolve("public" + decodeURIComponent(p));
    if (!p.startsWith("/api/") && pub.startsWith(resolve("public")) && existsSync(pub)) return route.fulfill({ body: readFileSync(pub) });
    if (p === "/api/core" && r.method() === "POST") { await new Promise((ok) => setTimeout(ok, 400)); return route.fulfill({ contentType: "application/x-ndjson", body: coreStream() }); }
    const j = API(p, u);
    if (j !== undefined) return route.fulfill({ json: j ?? {} });
    if (p.startsWith("/api/")) { unknown.add(p); return route.fulfill({ status: 404, json: { error: "not in harness" } }); }
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto(`${ORIGIN}/`);
  try { await page.waitForSelector(".cmdbar input", { state: "attached", timeout: 60_000 }); }
  catch (e) { await page.screenshot({ path: `${OUT}/fail-${w}.png` }); console.log("LOAD FAIL", errors, (await page.content()).slice(0, 1500)); throw e; }
  return { ctx, page, calls, errors };
}
const idle = (page, ms) => page.evaluate(async (ms) => {
  window.__lt.length = 0; let n = 0; const s = performance.now(), gaps = []; let last = s;
  await new Promise((ok) => { const f = (t) => { n++; gaps.push(t - last); last = t; if (performance.now() - s < ms) requestAnimationFrame(f); else ok(); }; requestAnimationFrame(f); });
  const lt = window.__lt.slice(); gaps.sort((a, b) => a - b);
  return { fps: Math.round((n / ((performance.now() - s) / 1000)) * 10) / 10, p95FrameMs: Math.round(gaps[Math.floor(gaps.length * 0.95)] || 0), longTasks: lt.length, longestMs: Math.round(Math.max(0, ...lt)) };
}, ms);
// key → next paint, measured in the page (the time the owner waits to see his letter)
const typeLatency = (page) => page.evaluate(async () => {
  const el = document.querySelector(".cmdbar input"); el.focus(); const res = [];
  for (const ch of "plant shop") {
    const s = performance.now();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(el, el.value + ch);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((ok) => requestAnimationFrame(() => setTimeout(ok, 0)));
    res.push(performance.now() - s);
  }
  const v = el.value; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(el, ""); el.dispatchEvent(new Event("input", { bubbles: true }));
  res.sort((a, b) => a - b); return { typed: v, medianMs: Math.round(res[Math.floor(res.length / 2)] * 10) / 10, maxMs: Math.round(res.at(-1) * 10) / 10 };
});
// text on screen that overlaps other text: pairs of visible leaf text boxes that intersect (a quick clipping/overlap finder)
const overlaps = (page) => page.evaluate(() => {
  const vis = (el) => { const s = getComputedStyle(el); return s.visibility !== "hidden" && s.display !== "none" && +s.opacity > 0.05; };
  const leaves = [...document.querySelectorAll("header *, .cmdbar *, .home-desk *, .galaxy-label, .galaxy-label *, [class*=home-] *, .orbit-shell > [role=status], .home-presence *")]
    .filter((el) => el.childElementCount === 0 && el.textContent.trim() && vis(el) && el.closest("[hidden],[popover]:not(:popover-open)") === null)
    .map((el) => ({ t: el.textContent.trim().slice(0, 30), r: el.getBoundingClientRect() })).filter((x) => x.r.width > 2 && x.r.height > 2);
  const hits = [];
  for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
    const a = leaves[i].r, b = leaves[j].r, ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ix > 3 && iy > 3) hits.push(`${leaves[i].t} × ${leaves[j].t}`);
  }
  const off = leaves.filter((x) => x.r.right > innerWidth + 1 || x.r.left < -1 || x.r.bottom > innerHeight + 1 || x.r.top < -1).map((x) => `${x.t} off-screen`);
  return [...new Set([...hits, ...off])].slice(0, 30);
});
const topBar = (page) => page.evaluate(() => [...document.querySelectorAll("header button, header a, header [role=button]")].filter((b) => b.getClientRects().length).map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 30)));

try {
  for (const [w, h] of SIZES) {
    const P = {};
    { // UI layer only: the WebGL galaxy hidden (software GL here runs it at a few fps, before and after alike)
      const { ctx, page, errors, calls } = await open(w, h, { galaxy: false });
      await page.waitForTimeout(4500);
      P.uiIdle = await idle(page, 4000);
      P.typing = await typeLatency(page);
      P.topBar = await topBar(page);
      P.overlaps = await overlaps(page);
      await shoot(page, `${w}-home-ui`);
      // the "N need you" tray
      const needs = page.locator("[data-tour=needs]").first();
      if (await needs.count()) { await needs.click(); await page.waitForTimeout(600); await shoot(page, `${w}-needs`); await page.keyboard.press("Escape"); await page.waitForTimeout(300); }
      // CORE: type, send, watch it stream
      const box = page.locator(".cmdbar input");
      await box.fill("Is a plant shop for cafés in Tallinn a good idea?");
      await page.evaluate(() => { window.__lt.length = 0; });
      const t0 = Date.now();
      let prof = null;
      if (process.env.HOME_PROF) { prof = await ctx.newCDPSession(page); await prof.send("Profiler.enable"); await prof.send("Profiler.setSamplingInterval", { interval: 2000 }); await prof.send("Profiler.start"); }
      await box.press("Enter");
      if (prof) { await page.waitForTimeout(12000); const { profile } = await prof.send("Profiler.stop"); const self = new Map(); const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
        profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0) / 1000); });
        console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${v.toFixed(0)}ms ${k}`).join("\n")); process.exit(0); }
      await page.waitForTimeout(900); await shoot(page, `${w}-ask-thinking`);
      await page.waitForTimeout(3500);
      P.askLongTasks = await page.evaluate(() => ({ n: window.__lt.length, longestMs: Math.round(Math.max(0, ...window.__lt)) }));
      await shoot(page, `${w}-ask-answer`);
      const ans = await page.locator(".home-answer").innerText().catch(() => "");
      check(!/\[m:|\[\[c\d/.test(ans), `${TAG}-${w}: the home answer shows numbered sources, not raw markers`);
      // continue in CORE (or CORE itself when the answer opened there)
      const cont = page.getByRole("button", { name: /continue in chat|jätka vestluses/i });
      if (await cont.count()) { await cont.first().click(); await page.waitForTimeout(1200); }
      else if (!(await page.locator("aside.drawer").count())) { await page.evaluate(() => dispatchEvent(new CustomEvent("orbit:navigate", { detail: { panel: "core" } }))); await page.waitForTimeout(1200); }
      await shoot(page, `${w}-core`);
      // a second question typed in CORE itself: thinking → steps → streamed answer with numbered sources
      const cbox = page.locator("aside.drawer textarea, aside.drawer input[type=text], aside.drawer input:not([type])").last();
      if (await cbox.count()) {
        await cbox.fill("And which cafés should I start with?");
        await page.evaluate(() => { window.__lt.length = 0; });
        await cbox.press("Enter"); await page.waitForTimeout(700); await shoot(page, `${w}-core-thinking`);
        await page.waitForTimeout(4000); await shoot(page, `${w}-core-answer`);
        P.coreLongTasks = await page.evaluate(() => ({ n: window.__lt.length, longestMs: Math.round(Math.max(0, ...window.__lt)) }));
      }
      // close CORE: back to home
      const tc = Date.now(); await page.keyboard.press("Escape"); await page.waitForTimeout(500); P.coreCloseMs = Date.now() - tc;
      await shoot(page, `${w}-after-core`);
      P.coreText = (await page.locator("aside.drawer").first().innerText().catch(() => "")).slice(0, 600);
      check(!/undefined|\bnull\b|NaN|Invalid Date/.test(await page.locator("body").innerText()), `${TAG}-${w}: no undefined/null/NaN on screen`);
      P.errors = errors.slice(0, 8); P.apiCalls = [...new Set(calls.filter((c) => c.includes("/api/")).map((c) => c.split("?")[0]))];
      void t0;
      await ctx.close();
    }
    { // with the galaxy drawn (software WebGL: absolute fps is low here; compare before/after only)
      const { ctx, page, errors } = await open(w, h, { galaxy: true });
      await page.waitForTimeout(25000);
      P.galaxyIdle = await idle(page, 5000);
      P.galaxyOverlaps = await overlaps(page);
      await shoot(page, `${w}-home`);
      P.galaxyErrors = errors.slice(0, 8);
      await ctx.close();
    }
    perf.sizes[w] = P;
  }
  { // reduced motion + motion off at 1440
    const { ctx, page } = await open(1440, 900, { reduced: true, galaxy: true });
    await page.waitForTimeout(6000); await shoot(page, "1440-reduced"); await ctx.close();
    const m = await open(1440, 900, { motion: "off", galaxy: true });
    await m.page.waitForTimeout(6000); await shoot(m.page, "1440-motion-off"); await m.ctx.close();
  }
} finally { await browser.close(); }
writeFileSync(`${OUT}/${TAG}-perf.json`, JSON.stringify(perf, null, 2));
console.log(JSON.stringify(perf, null, 2));
if (notes.length) console.log(notes.join("\n"));
console.log("api not in harness:", [...unknown].join(" "));
if (fails.length) { console.log(`${fails.length} check(s) failed`); process.exitCode = 1; }
