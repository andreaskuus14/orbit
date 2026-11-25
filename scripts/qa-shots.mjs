// node --no-warnings scripts/qa-shots.mjs — visual QA sweep: home + every planet (real Orbit.tsx, made-up data) at each size, with overlap / off-screen / console checks. QA_OUT, QA_TAG, QA_SIZES, QA_ONLY.
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
const OUT = resolve(process.env.QA_OUT || "smoke-shots/qa"), TAG = process.env.QA_TAG || "after";
const SIZES = (process.env.QA_SIZES || "1440x900,390x844").split(",").map((s) => s.split("x").map(Number));
const LANG = process.env.HOME_LANG || "en";
// QA_FAIL=/api/kaggle,/api/local-brain → those endpoints answer 500 { error }: the planet must still render (error-as-data check).
const FAIL = new Set((process.env.QA_FAIL || "").split(",").filter(Boolean));
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
// QA_THROW=NewsGlobe,PlanetWorld: those modules (imported from Orbit.tsx) are swapped for one that throws on render, to check the
// planet's error boundary keeps the top bar and home usable. QA_NOGL=1: every WebGL context fails (like a laptop with no GPU).
const THROW = (process.env.QA_THROW || "").split(",").filter(Boolean);
const throwStub = { name: "throw-stub", setup(b) {
  b.onResolve({ filter: /^\.\/[A-Za-z]+$/ }, (a) => (a.importer.endsWith("Orbit.tsx") && THROW.includes(a.path.slice(2)) ? { path: a.path.slice(2), namespace: "tstub" } : undefined));
  b.onLoad({ filter: /.*/, namespace: "tstub" }, (a) => ({ contents: `export default function Boom(){ throw new Error("qa forced throw in ${'${a.path}'}"); }`, loader: "js" }));
} };
async function bundle(stub, app = `import Orbit from "@/components/Orbit";\nconst App = () => <Orbit userId="u1" email="owner@example.test" />;`) {
  const out = (await build({
    stdin: { contents: `import { createRoot } from "react-dom/client";
import { LangCtx } from "@/components/i18n-boot";
${app}
createRoot(document.getElementById("root")).render(<LangCtx.Provider value={document.documentElement.lang === "et" ? "et" : "en"}><App /></LangCtx.Provider>);`, loader: "tsx", resolveDir: resolve("src") },
    bundle: true, write: false, outdir: "/tmp/home-ui-out", format: "esm", jsx: "automatic", logLevel: "error", minify: !process.env.HOME_NOMIN, sourcemap: process.env.HOME_NOMIN ? "inline" : false,
    splitting: true, chunkNames: "c-[hash]", tsconfig: resolve("tsconfig.json"),
    banner: { js: 'globalThis.process ??= { env: { NODE_ENV: "production" } };' },
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_SUPABASE_URL": '"http://x.test"', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"x"', "process.env.__NEXT_ROUTER_BASEPATH": '""' },
    alias: { "next/navigation": resolve("node_modules/next/dist/client/components/navigation.js") },
    plugins: [supaPlugin, ...(stub ? [galaxyStub] : []), ...(THROW.length ? [throwStub] : [])],
    loader: { ".json": "json", ".png": "dataurl", ".svg": "dataurl", ".glsl": "text", ".module.css": "local-css", ".css": "css", ".woff2": "dataurl", ".ttf": "dataurl" },
  })).outputFiles;
  return { files: new Map(out.map((f) => [`/${f.path.split("/").pop()}`, f])), css: out.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n"),
    entry: `/${out.find((f) => /\/stdin\.js$/.test(f.path)).path.split("/").pop()}`, kb: out.filter((f) => f.path.endsWith(".js")).reduce((a, f) => a + f.contents.length, 0) / 1024 };
}
const B = { full: null, ui: await bundle(true), phone: await bundle(false, `import { PhoneHome } from "@/components/PhoneHome";\nconst App = () => <PhoneHome />;`) };
console.log(`bundle ${B.ui.kb.toFixed(0)} KB js`);

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
// LIFE: made-up habits and reminders only (lite shape). No journal field at all, so no journal text can reach a picture.
const DAYMS = 86_400_000, dIso = (o) => new Date(NOW + o * DAYMS).toISOString().slice(0, 10), wk = (f) => Array.from({ length: 7 }, (_, i) => ({ date: dIso(i - 6), scheduled: true, done: f(i) }));
const LIFE_LITE = { today: dIso(0), focus: { today: 50, week: 215 }, work: [{ day: dIso(0), task: "Maths homework", min: 50 }], timer: null, journalDays: 3,
  habits: [{ id: "h1", name: "Walk 20 minutes", emoji: "", days: [0, 1, 2, 3, 4, 5, 6], created: dIso(-40), done: [], streak: 6, week: wk((i) => i !== 0), doneToday: true, scheduledToday: true, weekDone: 4 },
    { id: "h2", name: "Water", emoji: "", days: [0, 1, 2, 3, 4, 5, 6], created: dIso(-20), done: [], streak: 0, week: wk(() => false), doneToday: false, scheduledToday: true, unit: "glasses", goal: 8, amountToday: 3 }],
  reminders: [{ id: "r1", text: "Bring the sports kit", at: ago(-DAYMS), repeat: "weekdays", time: "07:30" }, { id: "r3", text: "Library book due", at: ago(DAYMS), last: { at: ago(DAYMS), missed: true } }],
  review: { unacked: [{ id: "r3", text: "Library book due", at: ago(DAYMS), missed: true }], overdue: [] } };
// INTELLIGENCE: one made-up briefing so the story cards, meta rows and trust popover render.
const A = (n) => `00000000-0000-4000-8000-00000000a00${n}`;
const CITES = [1, 2, 3, 4].map((n) => ({ id: A(n), url: `https://news${n}.example/story-${n}`, title: `Report ${n}`, source: ["ERR News", "LSM", "Delfi", "Postimees"][n - 1], published_at: ago(n * 3600000), evidence: n % 2 ? "fetched" : "snippet", passage: "Made-up passage." }));
const BRIEF = { id: "b1", kind: "world", title: "World brief", article_count: 12, created_at: ago(1800000), citations: CITES,
  content: ["## World", "### Riga opens the new Rail Baltica station in Latvia (confirmed)", `- The first trains stop at the new Riga hub this week [a:${A(1)}] [a:${A(2)}] [a:${A(3)}].`,
    "### Tallinn tram line to the port starts in Estonia (single source)", `- The new line runs every 10 minutes from Monday [a:${A(4)}].`,
    "### Tartu library gets longer opening hours", `- Open until 22:00 on weekdays from December [a:${A(2)}] [a:${A(4)}].`].join("\n") };
const API = (p, u) => ({
  "/api/agents": { agents: [{ slug: "nova", name: "Nova", role: "Writer", color: "#c084fc", builtin: true, stats: { running: 2 } }, { slug: "atlas", name: "Atlas", role: "Researcher", color: "#38bdf8", builtin: true, stats: { running: 1 } }] },
  "/api/briefings": { briefings: [BRIEF], articles: [], jobs: [], scheduled: true }, "/api/feeds": { feeds: [{ id: "f1", url: "https://news.example/rss", title: "News", topic: null, enabled: true, last_fetched_at: ago(600000), last_error: null }] },
  "/api/needs-you": { items: NEEDS }, "/api/doctor": { checks: CHECKS }, "/api/automations": { failing: false, automations: [] },
  "/api/life": u.searchParams.get("lite") === "1" ? LIFE_LITE : { habits: LIFE_LITE.habits }, // lite only: no journal, ever "/api/scout": { glowing: 2 },
  "/api/higgsfield": { used: 3, cap: 20 }, "/api/goals": { cards: [], goals: [] }, "/api/research": { cards: [] }, "/api/insights": { items: [] },
  "/api/presence": { ok: true }, "/api/health": { ok: true }, "/api/speak-first": { approvals: [], incidents: [], meetings: [], loops: [] }, "/api/stop-all": { stop: { on: false, at: null }, host: { busy: false } }, "/api/morning": {}, "/api/focus": { block: null },
  "/api/core/chats": u.searchParams.get("id") ? { messages: [{ role: "user", content: "Is a plant shop for cafés in Tallinn a good idea?" }, { role: "assistant", content: REPLY, citations: [{ id: "00000000-0000-4000-8000-0000000000c1", title: "Café list, Tallinn (saved note)", kind: "memory" }] }] } : { chats: [{ id: "c-0", title: "Plant shop ideas", updated_at: ago(86400000) }, { id: "c-00", title: "Pet sim egg odds", updated_at: ago(2 * 86400000) }], projects: [], map: {} },
  "/api/notifications": { items: [] }, "/api/studio/clips": { clips: [], jobs: [], root: "", tools: { ffmpeg: true, transcriber: true }, inbox: [], downloads: [] }, "/api/plans": { plans: [] }, "/api/playbook": { items: [] },
  // BUSINESS / Profile / OPERATIONS panels: made-up, mostly empty states so Money, Invoices, Contracts, Plugins and Local AI open (text-fit checks).
  "/api/business": { prospects: [], funnel: { counts: { lead: 0, contacted: 0, replied: 0, pilot: 0, paying: 0, lost: 0 }, monthly: 0, total: 0 }, nightDrafts: [], canSend: false },
  "/api/business/money": u.searchParams.get("split") ? undefined : { today: "2026-11-25", settings: { form: "FIE", vatRegistered: true, vatBasis: "invoice", eurPerUsd: 0, eurPerCredit: 0 },
    deadlines: [{ day: "2026-12-22", title: "KMD", note: "VAT return", source: "https://www.emta.ee", daysLeft: 27 }],
    expenses: [{ id: "e1", day: "2026-11-20", category: "Software", note: "Hosting", gross: 1240, vat: 240, receipt: false }],
    pnl: { period: "2026-11", margin: 40, byCategory: [{ category: "Software", cents: 1000 }],
      rows: [{ month: "2026-11", income: 50000, incomeVat: 12000, costs: 1000, orbitApi: 0, orbitHf: 0, profit: 49000, outVat: 12000, inVat: 240, vatOwed: 11760, vatPaid: 0 }],
      sum: { month: "2026-11", income: 50000, incomeVat: 12000, costs: 1000, orbitApi: 0, orbitHf: 0, profit: 49000, outVat: 12000, inVat: 240, vatOwed: 11760, vatPaid: 0 } } },
  "/api/business/invoices": { seller: null, invoices: [], today: "2026-11-25", dashboard: { open: 50000, overdue: 12000, paid30: 30000, refunds30: 0, byBuyer: [{ buyer: "Kask café", count: 1, open: 12000, overdue: 12000, oldestDue: "2026-11-01" }] } },
  "/api/business/contracts": { contracts: [], canSend: false },
  "/api/plugins": { plugins: [{ name: "files", command: "npx", args: ["-y", "server-filesystem"], env: {}, enabled: true, local: true, settings: {}, cache: null, tools: [] }], pending: [], suggested: [{ title: "Blender", about: "3D scenes", install: "Blender 4", plugin: {} }], vault: "", stopAll: false },
  "/api/kaggle": { on: false, setup: { ok: false, hint: "Run the setup script." }, quota: null, hoursLeft: 30, job: null, offers: [] }, "/api/gpu-jobs": { jobs: [] },
  "/api/local-brain": { brain: { state: "ok", text: "qwen3 is ready." }, autostart: { on: false, text: "ORBIT does not start with Windows.", command: "npm run autostart" } },
  "/api/local-ai": { ok: true, service: "local-ai", gpu: { name: "RTX 5060 Laptop", vramGb: 8 }, busy: false, tools: { image3d: true, removebg: true, tts: true, clone: false, captions: true, ifc: true, docs: true, dub: false, scan: false } },
}[p]);

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });

async function open(w, h, { reduced = false, galaxy = true, motion = "on", phone = false, stubGalaxy = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage(), calls = [], errors = [], bd = phone ? B.phone : galaxy && !stubGalaxy ? B.full : B.ui; // stubGalaxy: planet worlds keep WebGL, the home galaxy (slow in software GL) is off
  page.on("pageerror", (e) => { errors.push(e.message); if (process.env.HOME_NOMIN) console.log(e.stack?.split("\n").slice(0, 5).join("\n")); });
  page.on("console", (m) => { if (m.type() === "error" && !/WebGL|GPU stall|404|Failed to load resource|GL_|swiftshader/i.test(m.text())) errors.push(m.text().slice(0, 200)); else if (m.type() === "error" && /crashed/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  page.on("dialog", (d) => d.dismiss());
  await page.addInitScript(({ lang, galaxy }) => {
    try { sessionStorage.setItem("orbit.booted", "1"); sessionStorage.setItem("orbit.woke", "1"); localStorage.setItem("orbit.woke", "1"); localStorage.setItem("orbit.lang", lang); localStorage.setItem("orbit.view", "3d"); localStorage.setItem("orbit.boot.seen", "1"); localStorage.setItem("orbit.tour.v1", "done"); localStorage.setItem("orbit.home.fold.v2", "0"); } catch {}
    if (!galaxy) { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (k, o) { return /webgl/.test(k) && this.isConnected ? null : g.call(this, k, o); }; } // UI layer: the CSS orb (software GL would drown the numbers)
    window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: "longtask", buffered: true });
  }, { lang: LANG, galaxy });
  await ctx.route(`${ORIGIN}/**`, async (route) => {
    const r = route.request(), u = new URL(r.url()), p = u.pathname;
    calls.push(`${r.method()} ${p}${u.search}`);
    if (p === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="${LANG}" data-motion="${motion}"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><style>:root{--font-inter:"Inter";--font-jetbrains:"JetBrains Mono",monospace;--font-rajdhani:"Rajdhani","Inter",sans-serif;--font-serif:"Source Serif 4",serif}</style><body><div id="root"></div><script type="module" src="${bd.entry}"></script></body></html>` });
    if (p === "/app.css") return route.fulfill({ contentType: "text/css", body: css + "\n" + bd.css });
    if (bd.files.has(p)) return route.fulfill({ contentType: p.endsWith(".css") ? "text/css" : "text/javascript", body: bd.files.get(p).text });
    const pub = resolve("public" + decodeURIComponent(p));
    if (!p.startsWith("/api/") && pub.startsWith(resolve("public")) && existsSync(pub)) return route.fulfill({ body: readFileSync(pub) });
    if (p === "/api/core" && r.method() === "POST") { await new Promise((ok) => setTimeout(ok, 400)); return route.fulfill({ contentType: "application/x-ndjson", body: coreStream() }); }
    const j = API(p, u);
    if (FAIL.has(p)) return route.fulfill({ status: 500, json: { error: "forced 500 (QA_FAIL)" } });
    if (j !== undefined) return route.fulfill({ json: j ?? {} });
    if (p.startsWith("/api/")) { unknown.add(p); return route.fulfill({ status: 404, json: { error: "not in harness" } }); }
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto(`${ORIGIN}/`);
  try { if (!phone) await page.waitForSelector(".cmdbar input", { state: "attached", timeout: 60_000 }); }
  catch (e) { await page.screenshot({ path: `${OUT}/fail-${w}.png` }); console.log("LOAD FAIL", errors, (await page.content()).slice(0, 1500)); throw e; }
  return { ctx, page, calls, errors };
}
// Visible leaf text that overlaps other text, or is cut off by the viewport / by its own box (text-overflow without a title).
const audit = (page) => page.evaluate(() => {
  const vis = (el) => { for (let e = el, from = null; e; from = e, e = e.parentElement) { const s = getComputedStyle(e); if (s.visibility === "hidden" || s.display === "none" || +s.opacity < 0.05) return false;
    if (e.tagName === "DETAILS" && !e.open && from && from.tagName !== "SUMMARY") return false; } return true; }; // closed <details>: only the summary shows
  const leaves = [...document.querySelectorAll("body *")].filter((el) => !el.closest("canvas,svg,[aria-hidden=true]") && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && vis(el))
    .map((el) => ({ el, t: el.textContent.trim().slice(0, 40), r: el.getBoundingClientRect() })).filter((x) => x.r.width > 2 && x.r.height > 2);
  const hits = [];
  for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
    const A = leaves[i], Bx = leaves[j]; if (A.el.contains(Bx.el) || Bx.el.contains(A.el)) continue;
    const a = A.r, b = Bx.r, ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ix > 4 && iy > 4) hits.push(`overlap: "${A.t}" × "${Bx.t}"`);
  }
  const off = leaves.filter((x) => x.r.right > innerWidth + 1 || x.r.left < -1).map((x) => `off-screen x: "${x.t}"`);
  const clip = leaves.filter((x) => x.el.scrollWidth > x.el.clientWidth + 2 && getComputedStyle(x.el).overflow !== "visible" && !x.el.title).map((x) => `clipped: "${x.t}"`);
  const hscroll = document.documentElement.scrollWidth > innerWidth + 1 ? [`page scrolls sideways (${document.documentElement.scrollWidth}px)`] : [];
  return [...new Set([...hscroll, ...hits, ...off, ...clip])].slice(0, 40);
});
const ONLY = process.env.QA_ONLY ? process.env.QA_ONLY.split(",") : null;
const SCREENS = ["home", "core", "memory", "intelligence", "creation", "operations", "agents", "life", "vault", "analytics", "studio", "business", "arch", "profile", "m"].filter((s) => !ONLY || ONLY.includes(s));
const report = {};
try {
  for (const [w, h] of SIZES) for (const s of SCREENS) {
    if (s === "m" && w > 640) continue; // /m is the phone home
    const { ctx, page, errors, calls } = await open(w, h, { galaxy: !process.env.QA_NOGL, stubGalaxy: true, phone: s === "m" });
    if (s !== "home" && s !== "m") { await page.evaluate(([s, v]) => { location.hash = `o=${s}${v ? `&v=${v}` : ""}`; dispatchEvent(new HashChangeEvent("hashchange")); }, [s, process.env.QA_V || ""]); }
    await page.waitForTimeout(s === "home" ? 3500 : 5000);
    // LIFE / journal: never in a picture. Blur anything marked private before the shot.
    await page.addStyleTag({ content: "[data-private],[data-private] *{filter:blur(14px)!important;color:transparent!important;text-shadow:0 0 12px #888!important}" });
    if (process.env.QA_EVAL) console.log("EVAL", await page.evaluate(process.env.QA_EVAL).catch((e) => String(e)));
    if (process.env.QA_SCROLL) await page.evaluate((y) => { for (const el of document.querySelectorAll(".drawer .overflow-y-auto, .pu-body, [data-intel-surface]")) el.scrollTop = y; }, +process.env.QA_SCROLL); // look below the fold
    if (process.env.QA_CLICK) await page.evaluate((sel) => { document.querySelector(sel)?.click(); }, process.env.QA_CLICK).catch(() => {}); // e.g. the first trust mark
    if (process.env.QA_CLICK) await page.waitForTimeout(400);
    const issues = await audit(page);
    await page.screenshot({ path: `${OUT}/${TAG}-${s}-${w}.png`, timeout: 180_000 });
    if ((THROW.length || process.env.QA_NOGL) && s !== "home" && s !== "m") { // a crash must stay inside the planet
      const st = await page.evaluate(() => { const h = document.querySelector(".hud-top"), r = h && h.getBoundingClientRect();
        return { bar: !!r && r.height > 10 && getComputedStyle(h).visibility !== "hidden", card: !!document.querySelector("[data-boundary]"), root: document.getElementById("root").childElementCount }; });
      check(st.bar && st.root > 0, `${s} ${w}: top bar still there after a crash`);
      if (THROW.length) check(st.card, `${s} ${w}: crash card shown`);
    }
    if (FAIL.size && s !== "home" && s !== "m") check(!(await page.evaluate(() => !!document.querySelector("[data-boundary]"))), `${s} ${w}: no crash card with QA_FAIL`);
    report[`${s}-${w}`] = { errors: [...new Set(errors)], issues, missingApi: [...unknown] };
    console.log(`\n## ${s} ${w}x${h}\n` + [...new Set(errors)].map((e) => "  ERR " + e).join("\n") + "\n" + issues.map((i) => "  " + i).join("\n"));
    unknown.clear(); await ctx.close();
  }
} finally { await browser.close(); writeFileSync(`${OUT}/${TAG}-report.json`, JSON.stringify(report, null, 1)); }
if (fails.length) { console.log(`\n${fails.length} FAIL:\n` + fails.join("\n")); process.exitCode = 1; }
