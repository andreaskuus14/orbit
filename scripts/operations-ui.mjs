// node --no-warnings --experimental-strip-types scripts/operations-ui.mjs — the OPERATIONS planet in headless Chrome, used like the owner.
// Bundles the real PlanetWorld + OperationsPanel (esbuild) and the app's real CSS (Tailwind via PostCSS), serves them on a fake origin
// through Playwright routes and answers /api/* from an in-memory job store that moves on its own: a running job gains a step every
// few seconds, a new job queues → runs → finishes, approve / cancel / retry / run-now change the rows like the real routes do.
// Made-up data only. No server, no sign-in, no network, no model, nothing is sent anywhere.
// OPS_TAG names the files (before / after). Out: OPS_OUT (default ./smoke-shots/operations-ui). Exits 1 on a failed check (after only).
// Numbers: idle fps + long tasks (> 50 ms) + script/layout ms per second, renders while polling, /api/tasks bytes per poll, click → feedback.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const req = createRequire(import.meta.url);
const { chromium } = (() => { try { return req("playwright"); } catch { return req("playwright-core"); } })();
const OUT = resolve(process.env.OPS_OUT || "smoke-shots/operations-ui"), TAG = process.env.OPS_TAG || "after", AFTER = !TAG.startsWith("before");
const SIZES = (process.env.OPS_SIZES || "1440x900,1280x720").split(",").map((s) => s.split("x").map(Number));
mkdirSync(OUT, { recursive: true });
const ORIGIN = "http://orbit.test";
const fails = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails.push(what); };

// ---- CSS: what the root layout imports, through the app's PostCSS (Tailwind 4) ----
const cssIn = ["globals.css", "observatory.css", "motion.css"].map((f) => readFileSync(resolve("src/app", f), "utf8")).join("\n");
const css = (await postcss([tailwind({ base: resolve(".") })]).process(cssIn, { from: resolve("src/app/globals.css") })).css;

const out = (await build({
  stdin: { contents: `import { createRoot } from "react-dom/client";
import { useState, useEffect } from "react";
import PlanetWorld from "@/components/PlanetWorld";
import { OperationsPanel } from "@/components/AgentsPanels";
${AFTER ? `import { Toaster } from "@/components/ui";` : ""}
function App() {
  const [focus, setFocus] = useState(window.__focus ?? null);
  useEffect(() => { const f = (e) => setFocus(e.detail ?? null); addEventListener("test:focus", f); return () => removeEventListener("test:focus", f); }, []);
  return <main className="orbit-shell relative h-dvh w-full overflow-hidden" data-view="3d">
    <PlanetWorld id="operations" reduced={!!window.__reduced} quality="auto" onClose={() => { window.__closed = (window.__closed || 0) + 1; }}>
      <OperationsPanel focusTask={focus} onOpen={(id) => { window.__open = id; }} openMemory={() => {}} />
    </PlanetWorld>
    ${AFTER ? `<Toaster dismissLabel="Dismiss" />` : ""}
  </main>;
}
createRoot(document.getElementById("root")).render(<App />);`, loader: "tsx", resolveDir: resolve("src") },
  bundle: true, write: false, outdir: "/tmp/operations-ui-out", format: "esm", jsx: "automatic", logLevel: "error", minify: !process.env.OPS_NOMIN, sourcemap: process.env.OPS_NOMIN ? "inline" : false,
  define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_SUPABASE_URL": '"http://x.test"', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"x"', "process.env.__NEXT_ROUTER_BASEPATH": '""' },
  loader: { ".json": "json", ".png": "dataurl", ".svg": "dataurl", ".glsl": "text" },
})).outputFiles;
const appJs = out.find((f) => f.path.endsWith(".js")).text, moduleCss = out.find((f) => f.path.endsWith(".css"))?.text ?? "";
console.log(`bundle ${(appJs.length / 1024).toFixed(0)} KB js, ${(moduleCss.length / 1024).toFixed(0)} KB css`);

// ---- Test data (made up; shaped like the real tasks rows) ----
const T0 = Date.now(), MIN = 60_000, H = 60 * MIN;
const iso = (ms) => new Date(ms).toISOString();
let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const LONG = "Here is what I found.\n\n" + Array.from({ length: 30 }, (_, i) => `- Point ${i + 1}: a longer line of result text so the payload is the size of a real answer, with a [source](https://example.com/${i}).`).join("\n");
const step = (s, ms, ok = true, detail = "") => ({ step: s, detail: detail || `${s} finished with a few lines of detail that the log shows`, ms, ok });
function task(o) {
  const at = T0 - (o.ago ?? 10) * MIN;
  return { id: uid(), parent_id: null, project_id: o.project ?? null, agent: o.agent ?? "nova", title: o.title, request: o.request ?? `${o.title}. Please do it carefully and tell me what you did.`,
    status: o.status, result: o.result ?? null, error: o.error ?? null, trace: o.trace ?? [], pending: o.pending ?? [],
    created_at: iso(at), started_at: o.status === "queued" ? null : iso(at + 20_000), finished_at: ["done", "failed", "cancelled"].includes(o.status) ? iso(at + (o.took ?? 6) * MIN) : null, automation_id: o.auto ?? null };
}
const RUN_STEPS = [["think", 3800], ["web_search", 161_000], ["fetch_url", 84_000], ["search_memory", 71_000], ["draft", 418_000], ["check", 287_000], ["save_memory", 9000]];
const tasks = [
  task({ title: "Write this week's YouTube ideas", status: "running", ago: 24, agent: "forge", trace: RUN_STEPS.slice(0, 3).map(([s, ms]) => step(s, ms)) }),
  task({ title: "Find 5 new clients in Tallinn", status: "running", ago: 9, agent: "nova", trace: [step("think", 2100), step("web_search", 64_000)] }),
  task({ title: "Approve the video topics shortlist", status: "awaiting_approval", ago: 47, agent: "forge", trace: [step("think", 2000), step("draft", 120_000)],
    pending: [{ tool: "save_memory", input: { title: "Video topics shortlist", content: "1. What if there was no military?\n2. Why ships avoid one strait\n3. The cheapest house in Europe" }, status: "pending" }] }),
  task({ title: "Summarize the new school brochure", status: "queued", ago: 1, agent: "echo" }),
  task({ title: "Morning brief", status: "done", ago: 180, took: 4, agent: "sentinel", result: LONG, trace: RUN_STEPS.slice(0, 5).map(([s, ms]) => step(s, ms / 3)) }),
  task({ title: "Pull analytics from YouTube", status: "done", ago: 140, took: 11, agent: "nova", result: "Views up 12% this week. Best video: the stickman one.\n\n" + LONG, trace: [step("think", 1500), step("fetch_url", 40_000), step("draft", 90_000)] }),
  task({ title: "Check the pet sim shop prices", status: "failed", ago: 70, took: 3, agent: "nova", error: "fetch failed: ETIMEDOUT at Socket.<anonymous> (/home/x/node_modules/undici/lib/core.js:12:3)", trace: [step("think", 1800), step("fetch_url", 30_000, false, "timed out")] }),
  task({ title: "Book a dentist appointment", status: "cancelled", ago: 26 * 60, took: 1, agent: "nova" }),
  task({ title: "Weekly project review", status: "done", ago: 30 * 60, took: 8, agent: "nova", result: "Top 3 for next week: 1. Pet sim trading. 2. Entrance exam sketches. 3. Upload the Friday video.", auto: "a1", trace: [step("think", 1500), step("search_memory", 20_000), step("draft", 70_000)] }),
  task({ title: "Daily YouTube ideas", status: "done", ago: 50 * 60, took: 5, agent: "forge", result: "3 ideas, all from today's news.", auto: "a3", trace: [step("search_memory", 20_000), step("draft", 70_000)] }),
  task({ title: "Daily YouTube ideas", status: "failed", ago: 74 * 60, took: 2, agent: "forge", error: "Claude is busy right now. Try again in a minute.", auto: "a3" }),
  ...Array.from({ length: 30 }, (_, i) => task({ title: ["Tidy the vault folders", "Draft a reply to the supplier", "Research Roblox egg odds", "Summarize a podcast"][i % 4] + ` #${i + 1}`, status: i % 7 === 3 ? "failed" : "done", ago: (3 + i * 5) * 60, took: 3 + (i % 5), agent: ["nova", "echo", "forge"][i % 3], result: i % 7 === 3 ? null : LONG, error: i % 7 === 3 ? "Didn't finish in time" : null, trace: RUN_STEPS.slice(0, 2 + (i % 4)).map(([s, ms]) => step(s, ms / 4)) })),
];
const children = { [tasks[0].id]: [{ ...task({ title: "Research trending topics", status: "done", ago: 22, agent: "echo", result: "Trending: AI agents, personal AI setup, home labs." }), parent_id: tasks[0].id }] };
const sweepTick = () => { // the running job gains one step every 6 s; a queued one starts after 3 s and finishes after 25 s
  const now = Date.now();
  const r0 = tasks[0];
  if (r0.status === "running" && now - (r0.__last ?? T0) > 5000) { const [s, ms] = RUN_STEPS[r0.trace.length % RUN_STEPS.length]; r0.trace.push(step(s, ms)); r0.__last = now; }
  for (const t of tasks) {
    if (t.status === "queued" && now - Date.parse(t.created_at) > 3000) { t.status = "running"; t.started_at = iso(now); t.trace = [step("think", 1200)]; }
    if (t.status === "running" && t !== r0 && t !== tasks[1] && now - Date.parse(t.started_at) > 22_000) { t.status = "done"; t.finished_at = iso(now); t.result = "Done. Here is the short answer."; t.trace.push(step("draft", 9000)); }
  }
};
const agents = ["nova", "echo", "forge", "sentinel"].map((slug) => ({ slug, name: slug[0].toUpperCase() + slug.slice(1), role: `${slug} helper`, instructions: "", tools: [], builtin: true, color: "#38bdf8", enabled: true,
  stats: { running: tasks.filter((t) => t.agent === slug && t.status === "running").length, done: 4, failed: 1, calls: 40, tokens: 120_000 } }));
const projects = [{ id: "p1", name: "Pet simulator", description: "", status: "active" }, { id: "p2", name: "Entrance exam", description: "", status: "active" }];
const run = (t) => (t ? { id: t.id, status: t.status, created_at: t.created_at, error: t.error } : null);
const automations = [
  { id: "a1", name: "Weekly project review", enabled: true, trigger: "schedule", schedule: { every: "week", weekday: 0, hour: 18, minute: 0 }, event: null, kind_filter: null, agent: "nova", prompt: "Review my projects and open tasks.", run_count: 6 },
  { id: "a2", name: "Morning world watch", enabled: true, trigger: "schedule", schedule: { every: "day", hour: 8, minute: 0 }, event: null, kind_filter: null, agent: "sentinel", prompt: "Check the latest news.", run_count: 21 },
  { id: "a3", name: "Daily YouTube ideas", enabled: true, trigger: "schedule", schedule: { every: "day", hour: 17, minute: 0 }, event: null, kind_filter: null, agent: "forge", prompt: "Write 3 YouTube video ideas.", run_count: 14 },
  { id: "a4", name: "Summarize new documents", enabled: false, trigger: "event", schedule: null, event: "memory.created", kind_filter: "document", agent: "echo", prompt: "Summarize the document I just uploaded.", run_count: 2 },
];
const describe = (a) => (a.trigger === "event" ? `When you save ${a.kind_filter ? `a ${a.kind_filter}` : "a memory"}` : a.schedule.every === "day" ? `Every day at ${String(a.schedule.hour).padStart(2, "0")}:00` : `Every Sunday at ${String(a.schedule.hour).padStart(2, "0")}:00`);
const autoBody = () => ({ automations: automations.map((a) => { const mine = tasks.filter((t) => t.automation_id === a.id); return { ...a, when: describe(a), last: run(mine[0]), runs: mine.slice(0, 5).map(run) }; }), failing: false });
const scout = { candidates: [
  { key: "k1", name: "whisper-turbo", kind: "model", source: "huggingface", url: "https://huggingface.co/x/whisper-turbo", what: "Faster speech to text.", area: "voice", areaLabel: "Voice", licenseClass: "ok", licenseLabel: "MIT", fit: "fits", vramGb: 2, ready: true, score: 82, improves: "Voice replies start faster", why: "Half the delay of the current one", status: "new", foundAt: iso(T0 - 3 * H) },
  { key: "k2", name: "tiny-reranker", kind: "model", source: "huggingface", url: "https://huggingface.co/x/tiny-reranker", what: "Better search order.", area: "memory", areaLabel: "Memory", licenseClass: "ok", licenseLabel: "Apache-2.0", fit: "fits", vramGb: 1, ready: true, score: 74, improves: "Memory search finds the right note first", why: "", status: "seen", foundAt: iso(T0 - 20 * H) },
  { key: "k3", name: "big-video-model", kind: "model", source: "github", url: "https://github.com/x/big-video", what: "Video generation.", area: "studio", areaLabel: "Studio", licenseClass: "unknown", licenseLabel: "other", fit: "too-big", vramGb: 24, ready: false, score: 40, improves: "Studio videos", why: "", status: "seen", foundAt: iso(T0 - 40 * H) },
], glowing: 1, lastOk: iso(T0 - 3 * H), status: "3 found", lastError: null, busy: false, off: false };
const NEEDS = () => ({ items: tasks.filter((t) => t.status === "awaiting_approval").map((t) => ({ ref: `task:${t.id}`, kind: "decide", cause: "approval", title: t.title, detail: "Save the shortlist to memory", at: t.created_at, act: { open: { task: t.id } } })) });
const listBody = (lite) => ({ tasks: tasks.map(({ automation_id, __last, ...t }) => (lite ? { ...t, trace: t.trace.map(({ step: s, ms, ok }) => ({ step: s, ms, ok })), result: t.result?.slice(0, 400) ?? null, request: t.request.slice(0, 400) } : t)).slice(0, 60) });

async function shoot(page, name) { await page.screenshot({ path: `${OUT}/${TAG}-${name}.png`, timeout: 60_000 }); }
const perf = { tag: TAG, sizes: {} };
const HTML = (lang, motion = "on") => `<!doctype html><html data-motion="${motion}" class="dark" lang="${lang}"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><style>:root{--font-inter:"Inter";--font-jetbrains:monospace;--font-rajdhani:sans-serif}</style><body><div id="root"></div><script>window.process={env:{NODE_ENV:"production"}}</script><script type="module" src="/app.js"></script></body></html>`;

async function routes(ctx, calls, bytes, opts = {}) {
  await ctx.route(`${ORIGIN}/**`, async (route) => {
    const r = route.request(), u = new URL(r.url()), p = u.pathname, m = r.method();
    calls.push(`${m} ${p}${u.search}`);
    if (p === "/") return route.fulfill({ contentType: "text/html", body: HTML(opts.lang ?? "en", opts.motion) });
    if (p === "/app.css") return route.fulfill({ contentType: "text/css", body: css + "\n" + moduleCss });
    if (p === "/app.js") return route.fulfill({ contentType: "text/javascript", body: appJs });
    if (p.startsWith("/ui/")) { try { return route.fulfill({ body: readFileSync(resolve("public" + p)), contentType: p.endsWith(".webp") ? "image/webp" : "application/octet-stream" }); } catch { return route.fulfill({ status: 404, body: "" }); } }
    sweepTick();
    const body = (() => { try { return r.postDataJSON(); } catch { return null; } })() ?? {};
    const json = (j, status = 200) => { const s = JSON.stringify(j); if (p === "/api/tasks" && m === "GET") bytes.push(s.length); return route.fulfill({ status, contentType: "application/json", body: s }); };
    if (p === "/api/tasks" && m === "GET") {
      if (u.searchParams.get("id")) return json({ tasks: tasks.filter((t) => t.id === u.searchParams.get("id")) });
      const b = listBody(u.searchParams.get("lite") === "1");
      const tag = `"${b.tasks.length}-${b.tasks.map((t) => `${t.status}${t.trace.length}`).join("")}"`;
      if (r.headers()["if-none-match"] === tag) { bytes.push(0); return route.fulfill({ status: 304, headers: { etag: tag } }); }
      const s = JSON.stringify(b); bytes.push(s.length);
      return route.fulfill({ status: 200, contentType: "application/json", headers: { etag: tag }, body: s });
    }
    if (p === "/api/tasks" && m === "POST") {
      const t = task({ title: String(body.request ?? "").split("\n")[0].slice(0, 120), request: body.request, status: "queued", ago: 0, agent: body.agent || "nova" });
      t.created_at = iso(Date.now()); tasks.unshift(t); return json({ task: t }, 201);
    }
    const one = p.match(/^\/api\/tasks\/([^/]+)$/);
    if (one) {
      const t = tasks.find((x) => x.id === one[1]) ?? Object.values(children).flat().find((x) => x.id === one[1]);
      if (!t) return json({ error: "Not found" }, 404);
      if (m === "GET") { const { __last, automation_id, ...row } = t; return json({ task: row, children: children[t.id] ?? [] }); }
      const a = body.action;
      if (a === "approve") { t.pending = t.pending.map((x) => ({ ...x, status: "approved" })); t.status = "running"; t.trace.push(step("save_memory", 900)); setTimeout(() => { t.status = "done"; t.finished_at = iso(Date.now()); t.result = "Saved the shortlist."; }, 2500); return json({ pending: t.pending }); }
      if (a === "reject") { t.pending = t.pending.map((x) => ({ ...x, status: "rejected" })); t.status = "done"; t.finished_at = iso(Date.now()); return json({ pending: t.pending }); }
      if (a === "cancel") { if (!["queued", "running"].includes(t.status)) return json({ error: "Only queued or running tasks can be cancelled" }, 400); t.status = "cancelled"; t.finished_at = iso(Date.now()); return json({ ok: true }); }
      if (a === "retry" || a === "replace_input") { if (!["failed", "cancelled"].includes(t.status)) return json({ error: "Only failed or cancelled tasks can be retried" }, 400); Object.assign(t, { status: "queued", error: null, result: null, trace: [], started_at: null, finished_at: null, created_at: iso(Date.now()) }); return json({ ok: true }); }
      if (a === "abandon") { t.status = "cancelled"; return json({ ok: true }); }
      return json({ error: "Unknown action" }, 400);
    }
    if (/^\/api\/tasks\/[^/]+\/trace$/.test(p)) return route.fulfill({ contentType: "application/json", body: "{}" });
    if (p === "/api/projects") return json({ projects });
    if (p === "/api/agents") return json({ agents, tools: [] });
    if (p === "/api/automations") {
      if (m === "GET") return json(autoBody());
      if (m === "POST" && body.run) { const a = automations.find((x) => x.id === body.run); const t = task({ title: a.name, status: "queued", ago: 0, agent: a.agent, auto: a.id }); t.created_at = iso(Date.now()); tasks.unshift(t); a.run_count++; return json({ task: t.id }); }
      if (m === "POST") { const a = { id: `a${automations.length + 1}`, enabled: true, trigger: body.trigger, schedule: body.schedule, event: body.event, kind_filter: body.kind_filter, agent: body.agent, prompt: body.prompt, name: body.name, run_count: 0 }; automations.push(a); return json({ automation: a }, 201); }
      if (m === "PATCH") { const a = automations.find((x) => x.id === body.id); Object.assign(a, body); return json({ automation: a }); }
      if (m === "DELETE") { const i = automations.findIndex((x) => x.id === u.searchParams.get("id")); automations.splice(i, 1); return json({ ok: true }); }
    }
    if (p === "/api/scout") {
      if (m === "POST") { const c = scout.candidates.find((x) => x.key === body.key); if (body.action === "open" && c) c.status = "seen"; if (body.action === "dismiss") scout.candidates = scout.candidates.filter((x) => x.key !== body.key);
        if (body.action === "prototype" && c) { const t = task({ title: `Prototype ${c.name}`, status: "queued", ago: 0 }); t.created_at = iso(Date.now()); tasks.unshift(t); c.taskId = t.id; return json({ taskId: t.id }); } return json({ ok: true }); }
      return json(scout);
    }
    if (p === "/api/needs-you") return json(NEEDS());
    const J = { "/api/core/eval": null, "/api/health": { buildId: "test" }, "/api/activity": { items: [] }, "/api/stop-all": { on: false } }[p];
    if (J !== undefined) return J === null ? route.fulfill({ status: 404, json: {} }) : json(J);
    return route.fulfill({ status: 404, json: { error: "not in harness" } });
  });
}

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const fresh = async (w, h, o = {}) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: o.dpr ?? 1, reducedMotion: (o.reduced ?? !!process.env.OPS_REDUCED) ? "reduce" : "no-preference" });
  const page = await ctx.newPage(), calls = [], errors = [], bytes = [];
  page.setDefaultTimeout(o.timeout ?? 20_000);
  page.on("pageerror", (e) => { errors.push(e.message); if (process.env.OPS_NOMIN) console.log(e.stack?.split("\n").slice(0, 6).join("\n")); });
  page.on("console", (m) => { if (m.type() === "error" && !/WebGL|GPU stall|404|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 160)); });
  page.on("dialog", (d) => d.accept());
  await page.addInitScript(({ lang, manual, reduced }) => {
    try { localStorage.setItem("orbit.lang", lang); if (manual) localStorage.setItem("orbit.planetManual", JSON.stringify({ operations: true })); } catch {}
    if (reduced) window.__reduced = true;
    window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: "longtask", buffered: true });
  }, { lang: o.lang ?? "en", manual: !!o.manual, reduced: o.reduced ?? !!process.env.OPS_REDUCED });
  await routes(ctx, calls, bytes, o);
  const cdp = await ctx.newCDPSession(page); await cdp.send("Performance.enable");
  const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const cost = (a, b, ms) => ({ scriptMsPerSec: Math.round(((b.ScriptDuration - a.ScriptDuration) * 1000) / (ms / 1000)), taskMsPerSec: Math.round(((b.TaskDuration - a.TaskDuration) * 1000) / (ms / 1000)),
    styleLayoutMsPerSec: Math.round((((b.RecalcStyleDuration - a.RecalcStyleDuration) + (b.LayoutDuration - a.LayoutDuration)) * 1000) / (ms / 1000)), domNodes: b.Nodes });
  const idle = async (ms = 5000) => {
    const a = await metrics();
    const r = await page.evaluate(async (ms) => {
      window.__lt.length = 0; let k = 0; const s = performance.now();
      await new Promise((ok) => { const f = () => { k++; if (performance.now() - s < ms) requestAnimationFrame(f); else ok(); }; requestAnimationFrame(f); });
      const lt = window.__lt.slice(); return { fps: Math.round((k / ((performance.now() - s) / 1000)) * 10) / 10, longTasks: lt.length, longestMs: Math.round(Math.max(0, ...lt)) };
    }, ms);
    return { ...r, ...cost(a, await metrics(), ms) };
  };
  return { ctx, page, calls, errors, bytes, idle, metrics };
};
// DOM mutations in the panel over a window: how much the polling re-renders when nothing visible changed
const mutations = (page, ms) => page.evaluate(async (ms) => {
  const root = document.querySelector(".world-panel, .pu-shell, section[aria-label$='workspace']") ?? document.body; let k = 0;
  const mo = new MutationObserver((l) => { k += l.length; }); mo.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
  await new Promise((r) => setTimeout(r, ms)); mo.disconnect(); return k;
}, ms);
const textOk = async (page, name) => {
  const txt = await page.locator("body").innerText();
  check(!/undefined|\bnull\b|NaN|Invalid Date/.test(txt), `${TAG}-${name}: no undefined/null/NaN/Invalid Date on screen`);
  check(!/ETIMEDOUT|node_modules|Socket\.<anonymous>|Request failed \(\d{3}\)/.test(txt), `${TAG}-${name}: no raw error text`);
};

try {
  for (const [w, h] of SIZES) {
    const name = `${w}`, P = {};
    // ---------- home ----------
    const { ctx, page, calls, errors, bytes, idle } = await fresh(w, h);
    const t0 = Date.now();
    await page.goto(`${ORIGIN}/`);
    await page.waitForFunction(() => document.querySelector("canvas"), null, { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(6000);
    P.loadMs = Date.now() - t0;
    await shoot(page, `${name}-home`);
    await textOk(page, `${name}-home`);
    P.idle = await idle();
    bytes.length = 0;
    P.pollMutations10s = await mutations(page, 10_000);
    P.tasksPolls10s = bytes.length; P.tasksBytesPerPoll = bytes.length ? Math.round(bytes.reduce((a, b) => a + b, 0) / bytes.length) : 0;
    P.apiCallsAtLoad = calls.filter((c) => c.includes("/api/")).length;
    if (!AFTER) {
      // the tools view (what "Manual tools" opens)
      await page.locator("details summary", { hasText: "More" }).first().click().catch(() => {}); await page.waitForTimeout(300);
      await shoot(page, `${name}-more`);
      await page.getByRole("button", { name: /Manual tools|All tools/ }).first().click().catch(() => {}); await page.waitForTimeout(1500);
      await shoot(page, `${name}-tools`);
      await textOk(page, `${name}-tools`);
      // open the running task
      const s = Date.now();
      await page.getByText("Write this week's YouTube ideas").first().click().catch(() => {});
      await page.waitForTimeout(1500); P.openTaskMs = Date.now() - s;
      await shoot(page, `${name}-task`);
      await textOk(page, `${name}-task`);
      await page.getByText(/Back/).first().click().catch(() => {}); await page.waitForTimeout(800);
      // failed task
      await page.getByText("Check the pet sim shop prices").first().click().catch(() => {}); await page.waitForTimeout(1500);
      await shoot(page, `${name}-failed`);
      await textOk(page, `${name}-failed`);
      await page.getByText(/Back/).first().click().catch(() => {}); await page.waitForTimeout(800);
      for (const [label, file] of [["Automations", "automations"], ["Activity", "activity"]]) {
        await page.getByRole("tab", { name: label }).first().click().catch(() => {}); await page.waitForTimeout(1200);
        await shoot(page, `${name}-${file}`);
      }
      await page.locator("details summary", { hasText: /More/ }).first().click().catch(() => {}); await page.waitForTimeout(300);
      await page.getByRole("button", { name: /^Scout/ }).first().click().catch(() => {}); await page.waitForTimeout(1200);
      await shoot(page, `${name}-scout`);
    } else {
      await afterFlow(page, name, P, calls, idle, w);
    }
    check(!errors.length, `${TAG}-${name}: no page errors${errors.length ? ` (${errors.slice(0, 3).join(" | ")})` : ""}`);
    perf.sizes[name] = P;
    await ctx.close();
  }
  // ---------- reduced motion + Estonian at 1440 ----------
  {
    const { ctx, page, errors, idle } = await fresh(1440, 900, { reduced: true, lang: "et" });
    await page.goto(`${ORIGIN}/`); await page.waitForTimeout(6000);
    await shoot(page, "1440-reduced-et");
    perf.reducedIdle = await idle(4000);
    perf.reducedCanvasDraws3s = await page.evaluate(async () => {
      const c = document.querySelector("canvas"); if (!c) return null;
      const gl = c.getContext("webgl2") || c.getContext("webgl"); let draws = 0;
      if (gl) { const d = gl.drawArrays.bind(gl), e = gl.drawElements.bind(gl); gl.drawArrays = (...a) => { draws++; return d(...a); }; gl.drawElements = (...a) => { draws++; return e(...a); }; }
      await new Promise((r) => setTimeout(r, 3000)); return draws;
    });
    if (AFTER) {
      const txt = await page.locator(".pu-shell").innerText();
      check(/Operatsioonid|Töös|Vajab sind/.test(txt) && !/\bWorking on it\b|\bNeeds you\b|Scheduled\b/.test(txt), "Estonian: the shell speaks Estonian (no English section names)");
      const anim = await page.evaluate(() => [...document.querySelectorAll(".pu-shell *")].filter((el) => { const s = getComputedStyle(el); return s.animationName !== "none" && parseFloat(s.animationDuration) > 0 && parseFloat(s.animationDuration) < 2.4 && !el.classList.contains("pu-spin"); }).length);
      check(anim === 0, `reduced motion: no fast loops in the shell (${anim})`);
    }
    check(!errors.length, `${TAG}-reduced: no page errors${errors.length ? ` (${errors.slice(0, 3).join(" | ")})` : ""}`);
    await ctx.close();
  }
  // ---------- ORBIT_UI_MOTION=0 (html[data-motion=off]) ----------
  if (AFTER) {
    const { ctx, page } = await fresh(1440, 900, { motion: "off" });
    await page.goto(`${ORIGIN}/`); await page.waitForTimeout(5000);
    const moving = await page.evaluate(() => [...document.querySelectorAll(".pu-shell *")].filter((el) => { const s = getComputedStyle(el); return !el.classList.contains("pu-spin") && ((s.animationName !== "none" && parseFloat(s.animationDuration) > 0.001) || parseFloat(s.transitionDuration) > 0.001); }).length);
    check(moving === 0, `ORBIT_UI_MOTION=0: nothing in the shell animates (${moving})`);
    await ctx.close();
  }
  // ---------- sharp text at 2x ----------
  if (AFTER) {
    const { ctx, page } = await fresh(1440, 900, { dpr: 2 });
    await page.goto(`${ORIGIN}/`); await page.waitForTimeout(6000);
    { const bb = await page.locator(".pu-shell").boundingBox(); await page.screenshot({ path: `${OUT}/${TAG}-1440-shell-2x.png`, clip: bb, timeout: 60_000 }); }
    await ctx.close();
  }
} finally { await browser.close(); }
writeFileSync(`${OUT}/${TAG}-perf.json`, JSON.stringify(perf, null, 2));
console.log(JSON.stringify(perf, null, 2));
if (fails.length) { console.log(`${fails.length} check(s) failed`); if (AFTER) process.exitCode = 1; }

async function afterFlow(page, name, P, calls, idle, w) {
  const shell = page.locator(".pu-shell");
  const fit = await page.evaluate(() => { const s = document.querySelector(".pu-shell")?.getBoundingClientRect(); return s ? { top: s.top, bottom: s.bottom, h: innerHeight, right: s.right, w: innerWidth } : null; });
  check(!!fit && fit.bottom <= fit.h + 1 && fit.right <= fit.w + 1 && fit.top >= 0, `${TAG}-${name}: the shell fits the window (${JSON.stringify(fit)})`);
  check(calls.some((c) => c.startsWith("GET /api/tasks?lite=1")), `${TAG}-${name}: the list polls the slim list`);
  const txt = await shell.innerText();
  check(/Working on it/.test(txt) && /Needs you/.test(txt) && /Didn't work/.test(txt), `${TAG}-${name}: Now shows Needs you, Working on it, Didn't work`);
  check((txt.match(/Approve the video topics shortlist/g) ?? []).length <= 1, `${TAG}-${name}: a job waiting for him is listed once (was twice)`);
  check(await page.locator(".ops-steps li").count() >= 3, `${TAG}-${name}: the first working job shows its steps`);
  check(await page.locator(".ops-tl-bar").count() >= 3, `${TAG}-${name}: today's timeline has bars and a now line`);
  if (w !== 1440) return;
  if (process.env.OPS_ONLY === "sheet") return sheetPart(page, name, shell);
  // click feedback: opening a job shows its title in the same frame
  const fb = await page.evaluate(async () => {
    const b = [...document.querySelectorAll(".ops-work .ops-row-main")][0]; const s = performance.now(); b.click();
    for (let i = 0; i < 5 && !document.querySelector(".ops-detail"); i++) await Promise.resolve();
    return { ms: Math.round((performance.now() - s) * 10) / 10, shown: !!document.querySelector(".ops-detail") };
  });
  P.openFeedbackMs = fb.ms; check(fb.shown, `${TAG}: a click opens the job before the next frame (${fb.ms} ms)`);
  await page.waitForTimeout(1500);
  await shoot(page, `${name}-task`);
  await textOk(page, `${name}-task`);
  check(await page.locator(".ops-table tbody tr").count() >= 4 && await page.locator(".ops-log li").count() >= 3, "job: step table and live log");
  const before = await page.locator(".ops-log li").count(); await page.waitForTimeout(7000);
  check(await page.locator(".ops-log li").count() > before, "job: the live log grows while it runs");
  P.detailIdle = await idle(4000);
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);
  check(!(await page.locator(".ops-detail").count()) && !(await page.evaluate(() => window.__closed)), "Esc goes back to the list (the world stays open)");
  // approve flow: Review → the job's own card with the item → Approve
  await shell.getByRole("button", { name: "Review" }).first().click(); await page.waitForTimeout(1500);
  await shoot(page, `${name}-approve`);
  check(/Video topics shortlist/.test(await shell.innerText()), "approve: the exact item is shown before Approve");
  await shell.getByRole("button", { name: "Approve", exact: true }).click(); await page.waitForTimeout(1200);
  check(calls.some((c) => /^POST \/api\/tasks\/[^/]+$/.test(c)), "approve: goes to the job's own route");
  await shell.locator(".ops-back").click(); await page.waitForTimeout(800);
  // failed job: plain error, Try again → queued
  await shell.locator(".ops-row[data-kind=failed] .ops-row-main").first().click(); await page.waitForTimeout(1500);
  await shoot(page, `${name}-failed`); await textOk(page, `${name}-failed`);
  await shell.locator(".ops-back").click(); await page.waitForTimeout(600);
  const nRetry = calls.length;
  await shell.locator(".ops-row[data-kind=failed]").first().getByRole("button", { name: /Try again/ }).click(); await page.waitForTimeout(1200);
  check(calls.slice(nRetry).some((c) => c.startsWith("POST /api/tasks/")), "Try again re-queues the failed job");
  // Stop a running job
  const nStop = calls.length;
  await shell.locator(".ops-work").nth(1).getByRole("button", { name: /^Stop/ }).click(); await page.waitForTimeout(1200);
  check(calls.slice(nStop).some((c) => c.startsWith("POST /api/tasks/")), "Stop cancels a running job");
  // ask: start a job → toast + it shows in Now, then finishes with a done toast
  await shell.getByRole("textbox", { name: "Give ORBIT a job" }).fill("Make a list of 3 egg ideas for the pet sim");
  await page.keyboard.press("Enter"); await page.waitForTimeout(900);
  check(/Started/.test(await page.locator(".pu-toasts").innerText()), "ask: a Started toast with Open");
  await page.waitForTimeout(5000);
  check(/egg ideas/.test(await shell.innerText()), "ask: the new job is in Now");
  await shoot(page, `${name}-started`);
  // Scheduled
  await shell.getByRole("tab", { name: "Scheduled" }).click(); await page.waitForTimeout(1200);
  await shoot(page, `${name}-scheduled`);
  check(/Every day at 08:00/.test(await shell.innerText()) && /Next /.test(await shell.innerText()), "Scheduled: plain trigger and next run");
  const nTog = calls.length;
  await shell.getByRole("switch").first().click(); await page.waitForTimeout(800);
  check(calls.slice(nTog).some((c) => c === "PATCH /api/automations"), "routine switch PATCHes");
  await shell.locator(".ops-routine .ops-row-main").first().click(); await page.waitForTimeout(700);
  await shoot(page, `${name}-routine`);
  await page.locator(".pu-sheet").getByRole("button", { name: "Save changes" }).click(); await page.waitForTimeout(800);
  check(/Saved/.test(await page.locator(".pu-toasts").innerText()), "routine edit saves");
  // History
  await shell.getByRole("tab", { name: "History" }).click(); await page.waitForTimeout(800);
  await shoot(page, `${name}-history`);
  await shell.getByRole("searchbox").fill("podcast"); await page.waitForTimeout(400);
  check(/podcast/i.test(await shell.innerText()) && !/Morning brief/.test(await shell.innerText()), "History search filters");
  await shell.getByRole("searchbox").fill("");
  // keyboard: tabs move with arrows; the … menu opens with the keyboard
  await shell.getByRole("tab", { name: "History" }).focus(); await page.keyboard.press("ArrowLeft");
  check(await shell.getByRole("tab", { name: "Scheduled" }).getAttribute("aria-selected") === "true", "arrow keys move between tabs");
  await sheetPart(page, name, shell);
  await shell.getByRole("tab", { name: "Now" }).click(); await page.waitForTimeout(600);
  P.afterUseIdle = await idle(4000);
}
async function sheetPart(page, name, shell) {
  await shell.getByRole("button", { name: "More", exact: true }).focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(250);
  await shoot(page, `${name}-menu`);
  await page.getByRole("menuitem", { name: "New AI tools" }).click(); await page.waitForTimeout(1200);
  await page.locator(".ops-scout .ops-row-main").first().click(); await page.waitForTimeout(500);
  await shoot(page, `${name}-scout`);
  check(/MIT/.test(await page.locator(".pu-sheet").innerText()), "scout: a tool opens with its licence");
  await page.keyboard.press("Escape"); await page.waitForTimeout(1500);
  if (process.env.OPS_ONLY) console.log("active:", await page.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`));
  check(!(await page.locator(".pu-sheet").count()), "Esc closes the sheet");
}
