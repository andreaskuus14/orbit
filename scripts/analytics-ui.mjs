// node --no-warnings --experimental-strip-types scripts/analytics-ui.mjs — the ANALYTICS planet in headless Chrome, used like the owner.
// Bundles the real panel (esbuild) with the app's CSS, serves it on a fake origin through Playwright routes and answers Supabase REST
// and /api/* from made-up rows (1 500 tasks, 4 000 usage rows over 30 days). No server, no sign-in, no network, nothing sent anywhere.
// ANA_TAG=before bundles the old AnalyticsPanel (run on origin/main); anything else bundles AnalyticsShell. Out: ANA_OUT.
// Numbers: requests and bytes to open the planet and to switch 7 → 30 days, rows sent to the browser, time to first numbers,
// long tasks (> 50 ms), idle fps. Exits 1 on a failed check (after only).
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const req = createRequire(import.meta.url);
const { chromium } = (() => { try { return req("playwright"); } catch { return req("playwright-core"); } })();
const OUT = resolve(process.env.ANA_OUT || "smoke-shots/analytics-ui"), TAG = process.env.ANA_TAG || "after", AFTER = !TAG.startsWith("before");
mkdirSync(OUT, { recursive: true });
const ORIGIN = "http://orbit.test", SB = "http://x.test";
const fails = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails.push(what); };

const cssIn = ["globals.css", "observatory.css", "motion.css"].map((f) => readFileSync(resolve("src/app", f), "utf8")).join("\n");
const css = (await postcss([tailwind({ base: resolve(".") })]).process(cssIn, { from: resolve("src/app/globals.css") })).css;
const entry = AFTER
  ? `import { AnalyticsShell } from "@/components/AnalyticsShell"; import { Toaster } from "@/components/ui"; const P = () => <><AnalyticsShell onClose={() => { window.__closed = 1; }} /><Toaster dismissLabel="Dismiss" /></>;`
  : `import { AnalyticsPanel } from "@/components/panels"; const P = () => <AnalyticsPanel />;`;
const out = (await build({
  stdin: { contents: `import { createRoot } from "react-dom/client";\n${entry}
createRoot(document.getElementById("root")).render(<main className="orbit-shell relative h-dvh w-full overflow-hidden" style={{ background: "#05070c" }}><aside className="glass drawer" style={{ position: "absolute", right: 16, top: 16, bottom: 16, width: 460, overflow: "auto" }}><P /></aside></main>);`, loader: "tsx", resolveDir: resolve("src") },
  bundle: true, write: false, outdir: "/tmp/analytics-ui-out", format: "esm", jsx: "automatic", logLevel: "error", minify: true,
  define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_SUPABASE_URL": `"${SB}"`, "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"x"', "process.env.__NEXT_ROUTER_BASEPATH": '""' },
  loader: { ".json": "json", ".png": "dataurl", ".svg": "dataurl", ".glsl": "text", ".woff2": "dataurl" },
})).outputFiles;
const appJs = out.find((f) => f.path.endsWith(".js")).text, moduleCss = out.find((f) => f.path.endsWith(".css"))?.text ?? "";
console.log(`bundle ${(appJs.length / 1024).toFixed(0)} KB js`);

// ---- made-up data, deterministic ----
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const T0 = Date.now(), DAY = 86_400_000, iso = (ms) => new Date(ms).toISOString();
const AG = ["nova", "atlas", "echo"], TITLES = ["Find three leads in Tallinn", "Write the weekly YouTube plan", "Summarise the news", "Fix the pet sim bug list", "Draft a Short script", "Check the shop prices", "Team: launch checklist", "Goal step 2: outline"];
const ERR = ["Timed out after 600 s", "Stale input: the file changed", "Model refused the request", "Network error 502"];
const tasks = Array.from({ length: 1500 }, (_, i) => {
  const at = T0 - rnd() * 30 * DAY, st = rnd() < 0.72 ? "done" : rnd() < 0.6 ? "failed" : rnd() < 0.5 ? "cancelled" : "queued";
  return { id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, parent_id: null, project_id: rnd() < 0.5 ? "p1" : "p2", agent: AG[i % 3], title: `${TITLES[i % TITLES.length]} #${i % 300}`, status: st,
    error: st === "failed" ? ERR[i % 4] : null, pending: st === "done" && rnd() < 0.6 ? [{ status: "approved", evidence: rnd() < 0.7 ? ["read back"] : [] }] : null,
    created_at: iso(at), started_at: iso(at + 5000), finished_at: st === "queued" ? null : iso(at + 60_000 + rnd() * 900_000) };
});
const PURP = ["core", "agent.nova", "agent.atlas.review", "clips.dub", "pulse.morning", "research.write", "goals.plan", "memo.classify"];
const MODELS = ["claude-opus-4-1-20250805", "claude-sonnet-4-5", "claude-haiku-4-5", "qwen2.5:7b"];
const usage = Array.from({ length: 4000 }, (_, i) => ({ id: i, model: MODELS[i % 4], purpose: PURP[i % PURP.length], input_tokens: Math.round(rnd() * 4000), output_tokens: Math.round(rnd() * 900), cost_usd: i % 4 === 3 ? 0.002 : 0, created_at: iso(T0 - rnd() * 30 * DAY) }));
const evTypes = ["agent.completed", "memory.created", "core.completed", "task.delivered", "pulse.completed", "proposal.created"];
const modelRuns = Array.from({ length: 400 }, (_, i) => ({ id: 10_000 + i, created_at: iso(T0 - rnd() * 30 * DAY), type: "model.run", planet: "agents", payload: { kind: i % 2 ? "agent" : "core", job: i % 5 ? "chat" : "send", model: MODELS[i % 3], risky: i % 5 === 0, why: i % 5 === 0 ? ["risk:send"] : [] } }));
const events = Array.from({ length: 8 }, (_, i) => ({ id: 20_000 + i, type: evTypes[i % evTypes.length], created_at: iso(T0 - i * 3_600_000) }));
const ana = { calibration: { manual: { single: 20, chain: 60 }, touch: 2, at: iso(T0 - 5 * DAY) }, experiments: [{ id: "e1", name: "Shorter prompts", change: "Cut the agent prompt by half", metric: "success", start: iso(T0 - 6 * DAY), end: null }], queued: {} };
const life = { today: "2026-11-24", habits: [{ id: "h1", name: "Walk", emoji: "", doneToday: true, scheduledToday: true, streak: 6, week: Array.from({ length: 7 }, (_, i) => ({ date: new Date(T0 - (6 - i) * DAY).toISOString().slice(0, 10), scheduled: true, done: i % 3 !== 0 })) }, { id: "h2", name: "Read", emoji: "", doneToday: false, scheduledToday: true, streak: 2, week: Array.from({ length: 7 }, (_, i) => ({ date: new Date(T0 - (6 - i) * DAY).toISOString().slice(0, 10), scheduled: true, done: i % 2 === 0 })) }], reminders: [], focus: { today: 45, week: 310 }, work: null, timer: null, review: null, journalDays: 12 };
const meter = { h5: { calls: 41, tokens: 182_000, cost: 0, byPurpose: { core: { calls: 20, tokens: 90_000 }, agent: { calls: 15, tokens: 70_000 }, clips: { calls: 6, tokens: 22_000 } } }, d7: { calls: 610, tokens: 2_400_000, cost: 0, byPurpose: {} }, level: { pct: 27, heavy: false }, settings: { calls5h: 150, tokens5h: 0, warnPct: 80, morningAt: "07:30", freshLeadMin: 120 }, limit: null, hold: "", pace: null, active: true };
const scorecard = { trend: [{ month: "2026-09", score: 1.4 }, { month: "2026-10", score: 1.55 }, { month: "2026-11", score: 1.6 }], latest: { month: "2026-11", at: iso(T0 - 3 * DAY), trigger: "monthly", complete: true, calls: 22, score: 1.6, judged: 10, prevMonth: "2026-10", prevScore: 1.55 },
  cases: Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, title: `Case ${i + 1}`, area: ["memory", "studio", "business"][i % 3], score: 1 + (i % 3) * 0.5, status: "judged", reason: "Good answer, one source missing", before: 1.5, regressed: i === 4 })), worst: null, regressions: ["c4"], estimate: { maxCalls: 30, lastCalls: 22 }, running: null };
const perfRuns = { runs: [{ at: T0 - DAY, label: "after #760", gpu: "RTX 5060 Laptop", hidden: false, rows: [{ seg: "galaxy-idle", fps: 60, p95: 17.1, long: 0, pct: -4, prevP95: 17.8, regressed: false, renderChanged: false }, { seg: "dive", fps: 57, p95: 21.3, long: 1, pct: 2, prevP95: 20.9, regressed: false, renderChanged: false }] }] };

const since = (u) => { const g = [...u.searchParams.entries()].find(([k, v]) => k === "created_at" && v.startsWith("gte.")); return g ? Date.parse(g[1].slice(4)) : 0; };
const lim = (u) => Number(u.searchParams.get("limit") ?? 1e9);
let summaryFor = null;
if (AFTER) {
  const { buildSummary, parseDays } = await import(resolve("src/lib/analytics-summary-pure.ts"));
  const ls = await import(resolve("src/lib/life-stats-pure.ts"));
  var liteStats = (l) => { const b = ls.bestStreak(l.habits); return { habits: l.habits.length, today: ls.todayCount(l.habits), best: b ? { name: b.name, streak: b.streak } : null, week: ls.weekCompletion(l.habits), focus: l.focus }; };
  summaryFor = (d) => { const days = parseDays(d), from = T0 - days * DAY, inW = (r) => Date.parse(r.created_at) >= from;
    return { ...buildSummary({ days, now: T0, tasks: tasks.filter(inW), tasksCapped: false, chains: new Set(), usage: usage.filter(inW), projects: new Map([["p1", "Pet simulator"], ["p2", "YouTube"]]), calibration: ana.calibration, experiments: ana.experiments, queued: ana.queued, events, modelRunRows: modelRuns.filter(inW), counts: { memories: 1284, messages: 5310 } }),
      life: liteStats(life), meter, scorecard, perf: perfRuns.runs, anaOk: true, eventsOk: true }; };
}

async function routes(ctx, log) {
  await ctx.route(`${SB}/**`, async (route) => {
    const r = route.request(), u = new URL(r.url()), t = u.pathname.replace("/rest/v1/", "");
    const send = (rows, extra = {}) => { const s = JSON.stringify(rows); log.push({ url: `SB ${r.method()} ${t}`, bytes: s.length, rows: Array.isArray(rows) ? rows.length : 0 }); return route.fulfill({ status: 200, contentType: "application/json", headers: { "content-range": `0-${Math.max(0, (Array.isArray(rows) ? rows.length : 1) - 1)}/${extra.count ?? "*"}`, ...extra.h }, body: s }); };
    if (r.method() === "HEAD") { log.push({ url: `SB HEAD ${t}`, bytes: 0, rows: 0 }); return route.fulfill({ status: 200, headers: { "content-range": `0-0/${t === "memories" ? 1284 : 5310}` }, body: "" }); }
    if (t === "tasks") return send(tasks.filter((x) => Date.parse(x.created_at) >= since(u)).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, lim(u)));
    if (t === "usage") return send(usage.filter((x) => Date.parse(x.created_at) >= since(u)).slice(0, lim(u)));
    if (t === "missions") return send([]);
    if (t === "projects") return send([{ id: "p1", name: "Pet simulator" }, { id: "p2", name: "YouTube" }]);
    if (t === "events") return send(u.searchParams.get("type") === "eq.model.run" ? modelRuns.filter((x) => Date.parse(x.created_at) >= since(u)) : events);
    if (t === "rpc/usage_totals") { const d = (r.postDataJSON() ?? {}).p_days ?? 7, g = new Map(); for (const x of usage) if (Date.parse(x.created_at) >= T0 - d * DAY) { const k = `${x.model}|${x.purpose}`, o = g.get(k) ?? { model: x.model, purpose: x.purpose, calls: 0, input_tokens: 0, output_tokens: 0 }; o.calls++; o.input_tokens += x.input_tokens; o.output_tokens += x.output_tokens; g.set(k, o); } return send([...g.values()]); }
    return send([]);
  });
  await ctx.route(`${ORIGIN}/**`, async (route) => {
    const r = route.request(), u = new URL(r.url()), p = u.pathname;
    if (p === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html class="dark" lang="en"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><style>:root{--font-inter:"Inter";--font-jetbrains:monospace;--font-rajdhani:sans-serif}</style><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>` });
    if (p === "/app.css") return route.fulfill({ contentType: "text/css", body: css + "\n" + moduleCss });
    if (p === "/app.js") return route.fulfill({ contentType: "text/javascript", body: appJs });
    const json = (j, status = 200) => { const s = JSON.stringify(j); log.push({ url: `API ${r.method()} ${p}${u.search}`, bytes: s.length, rows: 0 }); return route.fulfill({ status, contentType: "application/json", body: s }); };
    if (globalThis.__fail && p.startsWith("/api/analytics/summary")) return json({ error: "boom" }, 500);
    if (p === "/api/analytics/summary") { await new Promise((ok) => setTimeout(ok, globalThis.__slow ?? 60)); return json(summaryFor(u.searchParams.get("days"))); }
    if (p === "/api/analytics") return json(ana);
    if (p === "/api/life") return json(life);
    if (p === "/api/usage-meter") return json(r.method() === "POST" ? meter : meter);
    if (p === "/api/agent-scorecard") return json(scorecard, r.method() === "POST" ? 202 : 200);
    if (p === "/api/perf/run") return json(perfRuns);
    return json({ error: "not in harness" }, 404);
  });
}

const browser = await chromium.launch();
const sum = (log) => ({ requests: log.length, kb: Math.round(log.reduce((s, x) => s + x.bytes, 0) / 102.4) / 10, rows: log.reduce((s, x) => s + x.rows, 0) });
const result = { tag: TAG };
async function open(w, h, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: o.dpr ?? 1, reducedMotion: o.reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage(), log = [], errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 160)); });
  await page.addInitScript((lang) => { try { localStorage.setItem("orbit.lang", lang); } catch {} window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: "longtask", buffered: true }); }, o.lang ?? "en");
  await routes(ctx, log);
  return { ctx, page, log, errors };
}
const fps = (page) => page.evaluate(async () => { window.__lt.length = 0; let k = 0; const s = performance.now(); await new Promise((ok) => { const f = () => { k++; if (performance.now() - s < 3000) requestAnimationFrame(f); else ok(); }; requestAnimationFrame(f); }); return { fps: Math.round(k / 3), longTasks: window.__lt.length }; });

for (const [w, h] of [[1440, 900], [1280, 720]]) {
  const { ctx, page, log, errors } = await open(w, h);
  const t0 = Date.now();
  await page.goto(`${ORIGIN}/`);
  if (AFTER) await page.locator(".ana-hero-num").first().waitFor(); else await page.waitForLoadState("networkidle");
  await page.waitForTimeout(AFTER ? 300 : 1500);
  const firstMs = Date.now() - t0;
  const lt = await page.evaluate(() => ({ n: window.__lt.length, max: Math.round(Math.max(0, ...window.__lt)) }));
  await page.screenshot({ path: `${OUT}/${TAG}-${w}.png` });
  if (w === 1440) {
    result.open = { ...sum(log), firstNumbersMs: firstMs, longTasks: lt.n, longestMs: lt.max, calls: log.map((x) => x.url) };
    if (!AFTER) { // the old Perf view: every sub-panel fetches on its own
      for (const v of ["Reliability", "Time & cost", "Performance"]) { await page.getByRole("tab", { name: v }).or(page.getByRole("button", { name: v, exact: true })).first().click(); await page.waitForTimeout(1200); }
      await page.screenshot({ path: `${OUT}/${TAG}-1440-perf.png`, fullPage: true });
      result.allViews = sum(log);
      const n = log.length; await page.getByRole("button", { name: "Last 30 days" }).click(); await page.waitForTimeout(1500);
      result.switch30 = sum(log.slice(n));
    } else {
      result.idle = await fps(page);
      const n = log.length; await page.getByRole("button", { name: /30 days/ }).click(); await page.locator(".ana-hero-num").first().waitFor(); await page.waitForTimeout(300);
      result.switch30 = sum(log.slice(n));
      check(log.slice(n).every((x) => x.url.includes("days=30")), "30 days: one request, days=30");
      check(log.every((x) => !x.url.startsWith("SB")), "no Supabase rows in the browser");
      check((await page.locator("text=claude-").count()) === 0 && (await page.locator("text=agent.nova").count()) === 0, "no raw model / purpose strings");
      await page.screenshot({ path: `${OUT}/${TAG}-1440-30d.png` });
      // every sheet opens and closes with Esc
      for (const name of ["Outcomes", "Reliability", "Time and cost", "Improve", "AI usage", "Agent scorecard", "Speed"]) {
        await page.getByRole("button", { name: "More" }).click();
        await page.getByRole("menuitem", { name }).click();
        await page.locator(".pu-sheet").waitFor();
        await page.waitForTimeout(250);
        await page.screenshot({ path: `${OUT}/${TAG}-1440-sheet-${name.toLowerCase().replace(/ /g, "-")}.png` });
        await page.keyboard.press("Escape"); await page.waitForTimeout(250);
        check(!(await page.locator(".pu-sheet").count()), `sheet ${name}: Esc closes`);
      }
      check(!(await page.locator("text=claude-").count()), "sheets: no raw model names");
    }
    result.errors = errors;
    if (AFTER) check(!errors.length, `no console errors (${errors.join(" | ")})`);
  }
  if (AFTER) {
    const clip = await page.evaluate(() => { const s = document.querySelector(".pu-shell"), b = s.getBoundingClientRect(); return b.bottom <= innerHeight + 1 && s.scrollWidth <= s.clientWidth + 1; });
    check(clip, `${w}×${h}: shell fits, no sideways scroll`);
  }
  await ctx.close();
}
if (AFTER) {
  // loading + error states, Estonian
  globalThis.__slow = 3000;
  { const { ctx, page } = await open(1440, 900); await page.goto(`${ORIGIN}/`); await page.waitForTimeout(600); check(await page.locator(".pu-shell [role=status]").count() > 0, "loading state shows"); await page.screenshot({ path: `${OUT}/${TAG}-1440-loading.png` }); await ctx.close(); }
  globalThis.__slow = 60; globalThis.__fail = true;
  { const { ctx, page } = await open(1440, 900); await page.goto(`${ORIGIN}/`); await page.locator("[role=alert]").first().waitFor(); check(!(await page.locator("text=boom").count()), "error state: plain words, no raw error"); await page.screenshot({ path: `${OUT}/${TAG}-1440-error.png` }); await ctx.close(); }
  globalThis.__fail = false;
  { const { ctx, page, errors } = await open(1440, 900, { lang: "et" }); await page.goto(`${ORIGIN}/`); await page.locator(".ana-hero-num").first().waitFor(); await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/${TAG}-1440-et.png` }); check(!errors.length, "Estonian: no errors"); await ctx.close(); }
  { const { ctx, page } = await open(1440, 900, { reduced: true, dpr: 2 }); await page.goto(`${ORIGIN}/`); await page.locator(".ana-hero-num").first().waitFor(); await page.waitForTimeout(300); const bb = await page.locator(".pu-shell").boundingBox(); await page.screenshot({ path: `${OUT}/${TAG}-1440-shell-2x.png`, clip: bb }); await ctx.close(); }
}
await browser.close();
writeFileSync(`${OUT}/${TAG}-numbers.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, open: { ...result.open, calls: result.open.calls.length } }, null, 1));
if (AFTER && fails.length) { console.log(`${fails.length} failed`); process.exit(1); }
