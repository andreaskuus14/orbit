// node --no-warnings --experimental-strip-types scripts/life-ui.mjs — the LIFE planet in headless Chrome, used like the owner.
// Bundles the real panel (esbuild) with the app's CSS, serves it on a fake origin through Playwright routes and answers /api/*
// from MADE-UP data only. The journal here is placeholder text ("Placeholder entry …"); no real journal is ever read, and
// nothing is sent anywhere. LIFE_TAG=before bundles the old SimpleOr + LifePanel (run on origin/main); anything else the new
// shell. Out: LIFE_OUT. Checks: fits at 1440×900 / 1280×720, every sheet opens and closes with Esc, the decrypted journal is
// fetched only when the Journal opens, past entries start blurred, a failed save keeps the text locally, EN + ET, no errors.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const req = createRequire(import.meta.url);
const { chromium } = (() => { try { return req("playwright"); } catch { return req("playwright-core"); } })();
const OUT = resolve(process.env.LIFE_OUT || "smoke-shots/life-ui"), TAG = process.env.LIFE_TAG || "after", AFTER = !TAG.startsWith("before");
mkdirSync(OUT, { recursive: true });
const ORIGIN = "http://orbit.test", SB = "http://x.test";
const fails = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails.push(what); };

const cssIn = ["globals.css", "observatory.css", "motion.css"].map((f) => readFileSync(resolve("src/app", f), "utf8")).join("\n");
const css = (await postcss([tailwind({ base: resolve(".") })]).process(cssIn, { from: resolve("src/app/globals.css") })).css;
const entry = AFTER
  ? `import LifePanel from "@/components/LifePanel"; import { Toaster } from "@/components/ui"; const P = () => <><LifePanel open={null} onClose={() => { window.__closed = 1; }} /><Toaster dismissLabel="Dismiss" /></>;`
  : `import LifePanel from "@/components/LifePanel"; import { SimpleOr } from "@/components/SimpleOr"; const P = () => <SimpleOr planet="life" onOpenTask={() => {}}><LifePanel open={null} /></SimpleOr>;`;
const out = (await build({
  stdin: { contents: `import { createRoot } from "react-dom/client";\n${entry}
createRoot(document.getElementById("root")).render(<main className="orbit-shell relative h-dvh w-full overflow-hidden" style={{ background: "#05070c" }}><aside className="glass drawer" style={{ position: "absolute", right: 16, top: 16, bottom: 16, width: 460, overflow: "auto" }}><P /></aside></main>);`, loader: "tsx", resolveDir: resolve("src") },
  bundle: true, write: false, outdir: "/tmp/life-ui-out", format: "esm", jsx: "automatic", logLevel: "error", minify: true,
  define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_SUPABASE_URL": `"${SB}"`, "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"x"', "process.env.__NEXT_ROUTER_BASEPATH": '""' },
  loader: { ".json": "json", ".png": "dataurl", ".svg": "dataurl", ".glsl": "text", ".woff2": "dataurl" },
})).outputFiles;
const appJs = out.find((f) => f.path.endsWith(".js")).text, moduleCss = out.find((f) => f.path.endsWith(".css"))?.text ?? "";
console.log(`bundle ${(appJs.length / 1024).toFixed(0)} KB js`);

// ---- made-up data (fake names, placeholder journal) ----
const T0 = Date.now(), DAY = 86_400_000, day = (o) => new Date(T0 + o * DAY).toISOString().slice(0, 10), TODAY = day(0);
const week = (p) => Array.from({ length: 7 }, (_, i) => ({ date: day(i - 6), scheduled: true, done: p(i) }));
const habits = [
  { id: "h1", name: "Walk 20 minutes", emoji: "", days: [0, 1, 2, 3, 4, 5, 6], created: day(-40), done: [], streak: 6, week: week((i) => i !== 0), doneToday: true, scheduledToday: true, weekDone: 4 },
  { id: "h2", name: "Read", emoji: "", days: [0, 1, 2, 3, 4, 5, 6], created: day(-40), done: [], streak: 2, week: week((i) => i % 2 === 0 && i < 6), doneToday: false, scheduledToday: true, target: 5, weekDone: 3 },
  { id: "h3", name: "Water", emoji: "", days: [0, 1, 2, 3, 4, 5, 6], created: day(-20), done: [], streak: 0, week: week(() => false), doneToday: false, scheduledToday: true, unit: "glasses", goal: 8, amountToday: 3 },
  { id: "h4", name: "Sketch a building", emoji: "", days: [1, 3, 5], created: day(-10), done: [], streak: 3, week: week((i) => i === 2 || i === 4), doneToday: false, scheduledToday: true },
];
const at = (h, m, o = 0) => { const d = new Date(T0 + o * DAY); d.setHours(h, m, 0, 0); return d.toISOString(); };
const reminders = [
  { id: "r1", text: "Bring the sports kit", at: at(7, 30, 1), repeat: "weekdays", time: "07:30" },
  { id: "r2", text: "Call grandma", at: at(18, 0, 0) },
  { id: "r3", text: "Library book due", at: at(9, 0, -1), last: { at: at(9, 0, -1), missed: true } },
];
const review = { unacked: [{ id: "r3", text: "Library book due", at: at(9, 0, -1), missed: true }], overdue: [] };
const lite = { today: TODAY, habits, reminders, focus: { today: 50, week: 215 }, work: [{ day: TODAY, task: "Maths homework", min: 50 }], timer: null, review, journalDays: 3 };
const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes(), s0 = Math.max(8 * 60, Math.min(nowMin - 20, 20 * 60));
const plan = { plan: { day: TODAY, accepted: undefined, load: { capMin: 240, plannedMin: 150, demandMin: 180, freeMin: 90, overload: false }, carried: [],
  blocks: [
    { id: "b1", title: "Maths homework", start: s0, end: s0 + 45, flexible: true, source: { kind: "deadline", label: "School" }, why: { r: "dueToday", est: "own" } },
    { id: "b2", title: "Break", start: s0 + 45, end: s0 + 60, flexible: false, source: { kind: "break", label: "Break" } },
    { id: "b3", title: "Edit the pet sim trailer", start: s0 + 60, end: s0 + 120, flexible: true, source: { kind: "goal", label: "Goal: YouTube" }, why: { r: "goal", est: "orbit" } },
    { id: "b4", title: "Football practice", start: s0 + 150, end: s0 + 240, flexible: false, source: { kind: "calendar", label: "Calendar" }, why: { r: "fixed", est: "event" } },
  ], unplaced: [{ id: "u1", title: "Clean the desk", source: { kind: "commitment", label: "Task" }, why: "cap" }] }, review: null };
const weekR = { from: day(-6), to: TODAY, outcomes: { tasksDone: 7, tasksPlanned: 10, focusMin: 215, habitsDone: 15, habitsDue: 24, schoolDone: ["Essay draft"] }, accuracy: { plannedMin: 600, doneMin: 430, pct: 72, days: 5 }, friction: [{ title: "Clean the desk", deferred: 3, missed: 1 }], adjust: null, missing: [] };
const PH = "Placeholder entry. This is fake sample text for the screenshot harness, not a real journal.";
const full = { ...lite, journal: [{ date: TODAY, text: "" }, { date: day(-1), text: `${PH} One.` }, { date: day(-2), text: `${PH} Two.` }, { date: day(-4), text: `${PH} Three.` }], notes: [{ id: "n1", date: `${day(-1)}T20:00:00Z`, source: "evening", text: `${PH} Evening note.` }] };

async function routes(ctx, log) {
  await ctx.route(`${SB}/**`, (route) => { log.push({ url: `SB ${route.request().url()}`, bytes: 2 }); return route.fulfill({ status: 200, contentType: "application/json", body: "[]" }); });
  await ctx.route(`${ORIGIN}/**`, async (route) => {
    const r = route.request(), u = new URL(r.url()), p = u.pathname;
    if (p === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html class="dark" lang="en"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><style>:root{--font-inter:"Inter";--font-jetbrains:monospace;--font-rajdhani:sans-serif}</style><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>` });
    if (p === "/app.css") return route.fulfill({ contentType: "text/css", body: css + "\n" + moduleCss });
    if (p === "/app.js") return route.fulfill({ contentType: "text/javascript", body: appJs });
    const body = r.method() === "POST" ? r.postDataJSON() : null;
    const json = (j, status = 200) => { const s = JSON.stringify(j); log.push({ url: `API ${r.method()} ${p}${u.search}${body?.action ? ` ${body.action}` : ""}`, bytes: s.length }); return route.fulfill({ status, contentType: "application/json", body: s }); };
    if (p === "/api/life" && r.method() === "GET") {
      if (globalThis.__fail) return json({ error: "boom" }, 500);
      await new Promise((ok) => setTimeout(ok, globalThis.__slow ?? 40));
      if (u.searchParams.get("week") === "1") return json(weekR);
      if (u.searchParams.get("due") === "1") return json({ due: [], habits: [] });
      return json(u.searchParams.get("lite") === "1" ? lite : full);
    }
    if (p === "/api/life") {
      if (body?.action === "journal" && globalThis.__failSave) return json({ error: "disk full" }, 500);
      if (body?.action === "check") { const h = habits.find((x) => x.id === body.id); if (h) h.doneToday = body.done ?? true; }
      return json({ ok: true });
    }
    if (p === "/api/dayplan") return json(r.method() === "POST" ? { result: { moved: [], dropped: [] } } : plan);
    if (p === "/api/life/calendar") return json({ connected: false });
    if (p === "/api/school") return json({ items: [], courses: [], plan: { weeks: [], blocks: [], short: [] }, settings: { weekday: ["16:00", "21:00"], weekend: ["10:00", "18:00"], maxDay: 3, maxWeek: 10, bufferDays: 1 } });
    return json({ error: "not in harness" }, 404);
  });
}

const browser = await chromium.launch();
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
const ready = (page) => AFTER ? page.locator(".lf-habits").first().waitFor() : page.waitForLoadState("networkidle");
const fullJournalCalls = (log) => log.filter((x) => /^API GET \/api\/life$/.test(x.url)).length;

for (const [w, h] of [[1440, 900], [1280, 720]]) {
  const { ctx, page, log, errors } = await open(w, h);
  await page.goto(`${ORIGIN}/`); await ready(page); await page.waitForTimeout(AFTER ? 400 : 1500);
  await page.screenshot({ path: `${OUT}/${TAG}-${w}.png` });
  if (w === 1440) {
    const lt = await page.evaluate(() => ({ n: window.__lt.length, max: Math.round(Math.max(0, ...window.__lt)) }));
    result.open = { requests: log.length, longTasks: lt.n, longestMs: lt.max, fullJournalCalls: fullJournalCalls(log), calls: log.map((x) => x.url) };
    result.idle = await fps(page);
    if (!AFTER) {
      await page.getByRole("button", { name: /All tools|More/ }).first().click().catch(() => {}); await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/${TAG}-1440-tools.png`, fullPage: true });
      for (const v of ["Review", "Journal"]) { await page.getByRole("tab", { name: v }).or(page.getByRole("button", { name: v, exact: true })).first().click().catch(() => {}); await page.waitForTimeout(900); await page.screenshot({ path: `${OUT}/${TAG}-1440-${v.toLowerCase()}.png` }); }
    } else {
      check(fullJournalCalls(log) === 0, "first screen: no decrypted journal fetched (lite only)");
      // one tap checks a habit
      const n = log.length; await page.locator(".lf-habit button[aria-pressed=false]").first().click(); await page.waitForTimeout(300);
      check(log.slice(n).some((x) => x.url.includes("POST /api/life check")), "habit: one tap sends check");
      check(log.slice(n).every((x) => !/GET \/api\/life$/.test(x.url)), "habit: no full LIFE reload after a check");
      // sheets from the menu
      for (const name of ["Tasks and day plan", "Reminders", "Week review", "Manage habits", "School"]) {
        await page.getByRole("button", { name: "More" }).click(); await page.getByRole("menuitem", { name }).click();
        await page.locator(".pu-sheet").waitFor(); await page.waitForTimeout(350);
        await page.screenshot({ path: `${OUT}/${TAG}-1440-sheet-${name.toLowerCase().replace(/ /g, "-")}.png` });
        await page.keyboard.press("Escape"); await page.waitForTimeout(300);
        check(!(await page.locator(".pu-sheet").count()), `sheet ${name}: Esc closes`);
      }
      check(fullJournalCalls(log) === 0, "sheets: still no decrypted journal");
      // the journal: opened on purpose, past entries blurred, region marked private
      await page.getByRole("button", { name: /Open journal/ }).click(); await page.locator(".pu-sheet [data-private]").waitFor(); await page.waitForTimeout(400);
      check(fullJournalCalls(log) === 1, "journal: decrypted only when opened");
      check(await page.locator(".lf-blur").count() >= 3, "journal: past entries start blurred");
      await page.screenshot({ path: `${OUT}/${TAG}-1440-journal.png` });
      globalThis.__failSave = true;
      await page.locator(".lf-journal-text").fill("Placeholder text typed by the harness.");
      await page.waitForTimeout(1600); // autosave
      check(await page.locator(".pu-sheet [role=alert]").count() > 0, "journal: failed save says so");
      check(await page.evaluate(() => (localStorage.getItem("orbit.life.journalDraft") ?? "").includes("Placeholder text")), "journal: failed save keeps a local draft");
      await page.screenshot({ path: `${OUT}/${TAG}-1440-journal-failed.png` });
      globalThis.__failSave = false;
      await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    }
    result.errors = errors;
    if (AFTER) check(!errors.length, `no console errors (${errors.join(" | ")})`);
  }
  if (AFTER) {
    const fit = await page.evaluate(() => { const s = document.querySelector(".pu-shell"), b = s.getBoundingClientRect(); return b.bottom <= innerHeight + 1 && s.scrollWidth <= s.clientWidth + 1; });
    check(fit, `${w}×${h}: shell fits, no sideways scroll`);
  }
  await ctx.close();
}
if (AFTER) {
  globalThis.__slow = 3000;
  { const { ctx, page } = await open(1440, 900); await page.goto(`${ORIGIN}/`); await page.waitForTimeout(600); check(await page.locator(".pu-shell [role=status]").count() > 0, "loading state shows"); await page.screenshot({ path: `${OUT}/${TAG}-1440-loading.png` }); await ctx.close(); }
  globalThis.__slow = 40; globalThis.__fail = true;
  { const { ctx, page } = await open(1440, 900); await page.goto(`${ORIGIN}/`); await page.locator("[role=alert]").first().waitFor(); check(!(await page.locator("text=boom").count()), "error state: plain words, no raw error"); await page.screenshot({ path: `${OUT}/${TAG}-1440-error.png` }); await ctx.close(); }
  globalThis.__fail = false;
  { const { ctx, page, errors } = await open(1440, 900, { lang: "et" }); await page.goto(`${ORIGIN}/`); await ready(page); await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/${TAG}-1440-et.png` }); check(!errors.length, "Estonian: no errors"); await ctx.close(); }
  { const { ctx, page } = await open(1440, 900, { reduced: true, dpr: 2 }); await page.goto(`${ORIGIN}/`); await ready(page); await page.waitForTimeout(300); const bb = await page.locator(".pu-shell").boundingBox(); await page.screenshot({ path: `${OUT}/${TAG}-1440-shell-2x.png`, clip: bb }); await ctx.close(); }
}
await browser.close();
writeFileSync(`${OUT}/${TAG}-numbers.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, open: { ...result.open, calls: result.open?.calls.length } }, null, 1));
if (AFTER && fails.length) { console.log(`${fails.length} failed`); process.exit(1); }
