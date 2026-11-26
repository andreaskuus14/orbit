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
  // Made-up data for panels translated in the i18n batches, so their real layout can be checked on screen (QA_EVAL opens them).
  "/api/people": { people: [
    { id: "pp1", name: "Mari Kask", relation: "client, Kask café", affinity: "business", notes: "", cares: "", next: "", importance: 4, remindDays: 14, prospectId: null, log: [], draft: "", created_at: ago(9e8), updated_at: ago(2e9), local: true, last: ago(2e9), overdue: true },
    { id: "pp2", name: "Tom", relation: "collaborator", affinity: "roblox", notes: "", cares: "", next: "", importance: 3, remindDays: 30, prospectId: null, log: [], draft: "", created_at: ago(9e8), updated_at: ago(3e8), local: true, last: ago(3e8), overdue: false }] },
  "/api/markets/deals": { wishes: [{ id: "w1", item: "RTX 4070", maxPrice: 400, targetPrice: 350, condition: "used", region: "Estonia / EU", deadline: null, notes: "12 GB", created: ago(9e8) }],
    offers: { w1: [{ id: "o1", title: "MSI RTX 4070 Ventus 12GB, lightly used", url: "https://example.com/o1", site: "osta.ee", seller: "kalle", price: 389, currency: "EUR", eur: 389, condition: "used", score: 82, great: true, why: ["under target median"], risks: ["no receipt"], seenAt: ago(4e6) }] },
    drafts: { o1: "Tere! Kas kaart on veel saadaval?" }, history: {}, hunted: { w1: ago(4e6) }, lastHunt: ago(4e6), lastError: null, busy: false, callsLeft: 12 },
  "/api/business/niches": { niches: [{ id: "n1", title: "Eco plant pots for cafés", product: "Self-watering pots", audience: "cafés in Tallinn", score: 74, demandScore: 4, demand: "steady searches", competitionScore: 3, competition: "a few shops",
    margin: { price: 29, cogs: 9, shipping: 4, feePct: 0.03, cac: 6 }, assumptions: "", risks: ["breakage in shipping"], fit: "you know café owners", evidence: [{ url: "https://example.com/e1", title: "Market note", opened: true }], status: "new" }],
    kits: { n1: { brand: "Potti", tagline: "Pots that water themselves", headline: "Green cafés", sub: "", cta: "Order", products: [{ name: "Self-watering pot", price: 29, description: "Holds a week of water.", bullets: [] }], sections: [], faq: [], hooks: ["Your basil, never dry"], checklist: ["Order samples"] } }, lastOk: ago(4e8), lastAttempt: ago(4e8), lastError: null, busy: null, dir: "C:\\Users\\you\\ORBIT" },
  "/api/rojo": { root: "C:\\Users\\you\\Documents\\RobloxProjects", projects: [{ name: "PetSim", dir: "C:\\Users\\you\\Documents\\RobloxProjects\\PetSim", at: ago(8e7), connected: true }],
    serve: { port: 34872, running: false, ours: null, log: "", state: "off", text: "Sync is off." } },
  "/api/economy": { table: "", voice: "", notesAt: "" },
  "/api/studio/clips/learn": { checkedAt: ago(3e6), warnings: [], published: 14, scored: 9, top: [{ videoId: "v1", title: "He found the secret egg", views72: 18200, score: 2.4, avgViewPct: 81 }], over: [], under: [],
    judged: 9, winners: [], flops: [], decided: 22, rejects: [{ reason: "boring start", n: 3 }], liked: [], disliked: [], versions: [], study: null, model: null },
  "/api/devtools": u.searchParams.get("trends") ? { source: "Roblox explore", at: Date.now(), tried: [], sorts: [{ id: "top", name: "Top playing", games: [{ universeId: 1, placeId: 1, name: "Pet Simulator 99", players: 182000, upvotePct: 91, icon: "", genre: "Simulation" }] }], risers: [], yt: { risers: [], topics: [], region: "US", hint: "Add a YouTube key to see YouTube risers." } }
    : u.searchParams.get("viral") ? { videos: [], queries: ["pet sim"], units: 101, at: Date.now() } : undefined,
  "/api/portfolio": { portfolio: { title: "Portfolio", name: "", projects: [{ id: "pr1", kind: "arch", title: "Lake sauna", year: "2026", text: "", shots: [] }] } },
  "/api/devworld": { world: { v: 1, games: [{ id: "pet-sim", name: "Pet Simulator", platform: "roblox", stage: "alpha", pitch: "Hatch and trade pets", notes: "" }], bugs: [] }, updatedAt: ago(9e6), seeded: false },
  "/api/usage-meter": { h5: { calls: 41, tokens: 182000 }, d7: { calls: 388, tokens: 2400000 }, settings: { calls5h: 200, tokens5h: 900000 }, level: { heavy: false }, limit: {} },
  "/api/proposals": { proposals: [{ id: "pr-1", title: "Nova: post the egg Short at 18:00", status: "pending" }] },
  "/api/negotiator": { recipients: { ng1: null }, negotiations: [{ id: "ng1", ref: "offer:o1", side: "buy", title: "MSI RTX 4070", state: "talking", created: ago(9e6), updated: ago(3e6),
    limits: { floor: 330, ceiling: 389, deadline: "2026-12-05", mustHaves: ["receipt", "pickup in Tallinn"], walkAway: "no receipt", stepPct: 5 },
    turns: [{ at: ago(5e6), from: "me", text: "Tere! Kas 340 € sobiks?", price: 340, via: "copy" }, { at: ago(4e6), from: "them", text: "370 is my lowest.", price: 370, intent: "counter" }],
    draft: { text: "Thanks! I can do 355 € with pickup today.", price: 355, intent: "counter", action: "offer", next: "talking", strategy: "Meet halfway, keep the step under 5%.", at: ago(3e6), outside: [] } }] },
  "/api/business/launch/n1": { launches: { shopify: { platform: "shopify", at: ago(2e6), brand: "Potti", files: ["products.csv", "policies.md", "launch-plan.md"],
    doc: { url: "https://help.shopify.com/en/manual/products/import-export/using-csv", at: ago(2e6), ok: false, missing: ["Variant Grams"] },
    products: [{ name: "Self-watering pot", price: 29, description: "", bullets: [], handle: "pot", sku: "P1", seo: { title: "Self-watering pot", description: "For cafés.", tags: ["pot", "café"] },
      variants: [{ option: "1 pot", qty: 1, price: 29, profit: 7.1, pct: 24, raised: false }, { option: "3 pots", qty: 3, price: 79, profit: 21.5, pct: 27, raised: true }] }],
    images: [{ label: "Hero", prompt: "A white pot with basil on a café table, morning light", aspect: "4:5" }],
    checklist: ["Import products.csv as draft", "Add photos"], plan: [{ day: 1, goal: "Say hello", channel: "Instagram", post: "Meet Potti: pots that water themselves." }] } } },
  "/api/capsule": { configured: true, dir: "E:\\ORBIT backups", maxMB: 25, last: { at: ago(3e7), ok: true, bytes: 4200000 }, backups: [{ name: "b1", at: ago(3e7), kind: "nightly", files: 42, size: 4200000 }, { name: "b0", at: ago(2e8), kind: "pre-restore", files: 41, size: 4100000 }] },
  "/api/authority": { policyVersion: "3", stopAll: false, modes: { "rule:morning-sort": "prepare" }, grants: [{ id: "g1", workflow: "rule:morning-sort", actions: ["rules.run"], limits: { count: 20 }, destinations: [], policyVersion: "3", revoked: false, paused: false, used: { count: 4, money: 0, calls: 0 }, createdAt: ago(9e8) }] },
  "/api/vault": { files: [["cover.png", "image", 2e5], ["trailer.mp4", "video", 9e6], ["theme.mp3", "audio", 3e6], ["brief.pdf", "pdf", 4e5], ["notes.txt", "text", 4e3], ["plan.docx", "doc", 6e4]].map(([name, type, size], i) => ({ name, type, size, mtime: NOW - i * 4e6 })) },
  "/api/activity": { items: ["agents", "goals", "clips", "core", "system", "agents", "core"].map((area, i) => ({ id: `act${i}`, area, at: ago(i * 3e7), title: `Made-up ${area} event`, kind: "done" })) },
  "/api/remote/talk": { ringing: null, live: false, checkin: "19:30", review: { on: true, day: 0, at: "18:00" } },
  "/api/studio/longform": { plans: [{ v: 1, id: "lf1", createdAt: ago(5e6), topic: "pet sim", minutes: 10, drafts: [], plan: { titles: ["How I built a pet sim in 30 days", "30 days, one Roblox game"], hook: "Day one, I had nothing.",
    chapters: [{ title: "The idea", script: "Why pets.", sec: 120, shots: [{ type: "b-roll", desc: "Old sketches" }, { type: "screen", desc: "Studio empty place" }] }, { title: "First egg", script: "Hatching logic.", sec: 180, shots: [{ type: "graphic", desc: "Odds table" }] }],
    thumbs: [{ concept: "Me holding a giant egg", text: "30 DAYS" }], shorts: [{ title: "The egg bug", chapter: 1, idea: "The egg that hatched twice" }] } }] },
  "/api/news/geo": (() => { const now = Date.now(), st = (title, src, h) => ({ title, url: `https://news.example/${encodeURIComponent(title)}`, source: src, published_at: new Date(now - h * 3600_000).toISOString() });
    const hs = [["Ukraine", 49, 32, 14, ["Talks on a ceasefire line resume", "Power cuts across the east after strikes"]], ["United States", 39, -98, 11, ["Budget deal passes the Senate"]], ["Germany", 51, 10, 7, ["Coalition agrees on a rail plan"]],
      ["Estonia", 58.6, 25, 6, ["Rail Baltica: Ülemiste station opens", "Tallinn to extend district heating"]], ["Japan", 36, 138, 5, ["Bank of Japan holds rates"]], ["Brazil", -10, -55, 4, ["Amazon fires down a third this year"]], ["India", 22, 79, 4, ["Monsoon floods in Assam"]]];
    return { hours: 72, total: 51, untagged: 3, hotspots: hs.map(([name, lat, lon, count, ts], i) => ({ name, lat, lon, count, stories: ts.map((t, j) => st(t, ["Reuters", "ERR", "BBC", "AP"][(i + j) % 4], 2 + i + j)) })) }; })(),
  "/api/personas": { context: "", report: null, calibration: null, running: false },
  "/api/study": { cards: [], queue: [], lessons: [], log: [], stats: { due: 0, total: 0, streak: 2, retention: null, learned: 0, reviewedToday: 0 } },
}[p]);

// Earth tiles: the same upstreams as /api/earth/tile, cached in EARTH_TMP (shared with scripts/earth/*); offline → 404 (dark globe).
const TILE_DIR = `${process.env.EARTH_TMP || "/tmp/earth-h"}/tiles`; mkdirSync(TILE_DIR, { recursive: true });
const UP = { day: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`,
  night: (z, x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`,
  elev: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png` };
async function earthTile(u) {
  const k = u.searchParams.get("k"), z = +u.searchParams.get("z"), x = +u.searchParams.get("x"), y = +u.searchParams.get("y"), f = `${TILE_DIR}/${k}_${z}_${x}_${y}`;
  try {
    if (!UP[k]) throw 0;
    if (!existsSync(f)) { const r = await fetch(UP[k](z, x, y)); if (!r.ok) throw 0; writeFileSync(f, Buffer.from(await r.arrayBuffer())); }
    return { contentType: k === "day" ? "image/jpeg" : "image/png", body: readFileSync(f) };
  } catch { return { status: 404, body: "" }; }
}

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });

async function open(w, h, { reduced = false, galaxy = true, motion = "on", phone = false, stubGalaxy = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage(), calls = [], errors = [], bd = phone ? B.phone : galaxy && !stubGalaxy ? B.full : B.ui; // stubGalaxy: planet worlds keep WebGL, the home galaxy (slow in software GL) is off
  page.on("pageerror", (e) => { errors.push(e.message); if (process.env.HOME_NOMIN) console.log(e.stack?.split("\n").slice(0, 5).join("\n")); });
  page.on("console", (m) => { if (m.type() === "error" && !/WebGL|GPU stall|404|Failed to load resource|GL_|swiftshader/i.test(m.text())) errors.push(m.text().slice(0, 200)); else if (m.type() === "error" && /crashed/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  page.on("dialog", (d) => d.dismiss());
  await page.addInitScript(({ lang, galaxy }) => {
    try { sessionStorage.setItem("orbit.booted", "1"); sessionStorage.setItem("orbit.woke", "1"); localStorage.setItem("orbit.woke", "1"); localStorage.setItem("orbit.lang", lang); localStorage.setItem("orbit.view", "3d"); localStorage.setItem("orbit.boot.seen", "1"); localStorage.setItem("orbit.tour.v1", "done"); localStorage.setItem("orbit.home.fold.v2", "0");
      const d = new Date(); localStorage.setItem("orbit.evening.shown", `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`); } catch {} // no evening (journal) pop-up in a QA picture
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
    if (p === "/api/earth/tile") return route.fulfill(await earthTile(u)); // real imagery, cached on disk (the Earth looked empty without it)
    if (p.startsWith("/api/earth/")) return route.fulfill({ json: p === "/api/earth/local" ? { towns: [] } : {} });
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
    .map((el) => ({ el, t: el.textContent.trim().slice(0, 40), r: el.getBoundingClientRect() })).filter((x) => x.r.width > 2 && x.r.height > 2)
    .filter((x) => { for (let e = x.el.parentElement; e && e !== document.body; e = e.parentElement) { if (getComputedStyle(e).overflow === "visible") continue; // fully clipped away by a scrolling/clipping box: not seen
      const c = e.getBoundingClientRect(); if (x.r.top >= c.bottom - 1 || x.r.bottom <= c.top + 1 || x.r.left >= c.right - 1 || x.r.right <= c.left + 1) return false; } return true; });
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
// CORE over a planet: the planet stays behind (dimmed, inert); none of its panels may show over CORE's frame, nothing in CORE is cut off.
const CORE_OVER = ["intelligence", "studio", "creation", "agents", "arch", "memory", "operations", "life", "vault", "analytics", "business"].map((p) => `core@${p}`);
const coreOver = (page) => page.evaluate(() => {
  const d = document.querySelector(".drawer-core:not(.drawer-out)"); if (!d) return ["CORE frame not open"];
  for (const a of [...d.getAnimations(), ...(document.querySelector("[data-under-core]")?.getAnimations() ?? [])]) if (a.effect?.getTiming().iterations !== Infinity) a.finish(); // measure where the slide-in ends, not a busy box's mid-frame
  const r = d.getBoundingClientRect(), out = [];
  if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.push(`CORE frame off-screen (${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)} in ${innerWidth}x${innerHeight})`);
  const under = document.querySelector("[data-under-core]");
  if (!under) out.push("planet behind CORE is not marked under-core");
  else { const s = getComputedStyle(under); if (s.filter === "none" && +s.opacity > 0.6) out.push("planet behind CORE is not dimmed"); if (!under.inert) out.push("planet behind CORE still takes clicks"); }
  // Paint order: probe a grid inside the frame with hit-testing forced on everywhere; the top element must belong to CORE (or the top bar / a popover).
  const st = document.createElement("style"); st.textContent = "*{pointer-events:auto!important}"; document.head.append(st);
  const wasInert = under?.inert; if (under) under.inert = false;
  const bleed = new Set();
  for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) {
    const x = r.left + (r.width * i) / 12, y = r.top + (r.height * j) / 12;
    const seen = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e); if (c.visibility === "hidden" || c.display === "none" || +c.opacity < 0.05) return false; } return true; };
    const top = document.elementsFromPoint(x, y).find(seen); // the first element you can actually see there
    if (top && !d.contains(top) && !top.closest(".hud-top,[popover],.toaster,.pu-toasts,[role=dialog]:not(.drawer)")) bleed.add((top.className?.baseVal ?? top.className ?? top.tagName).toString().slice(0, 40) || top.tagName);
  }
  if (under) under.inert = wasInert; st.remove();
  for (const b of bleed) out.push(`planet UI over CORE: .${b}`);
  // Cut-off columns: a visible box inside the frame that runs past its right edge.
  for (const el of d.querySelectorAll("section,aside,form,.bubble,textarea,input,button")) { const b = el.getBoundingClientRect(); if (b.width > 2 && b.height > 2 && getComputedStyle(el).visibility !== "hidden" && b.right > r.right + 1 && !el.closest("[hidden]")) { out.push(`cut off in CORE: ${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`); break; } }
  return out;
});
// INTELLIGENCE, every map (QA_INTEL=1): the tab bar must be on screen with the right tab lit after every move (both directions
// between Earth, Estonia, Towns, Tallinn, News weather and Classic map, and Esc back), the fixed chrome (header, tab bar, left
// column, briefing panel, command bar + its pill, region chips) must not overlap, and the maps' own HUD must stay inside the stage.
const INTEL_STEPS = ["orbit", "country", "region", "town", "weather", "classic", "town", "weather", "orbit", "classic", "country", "classic", "region", "weather", "country",
  "esc:orbit", "classic", "esc:orbit", "weather", "esc:orbit"];
const intelCheck = (page) => page.evaluate(() => {
  const vis = (e) => { if (!e || !e.isConnected) return false; for (let x = e; x; x = x.parentElement) { const s = getComputedStyle(x); if (s.display === "none" || s.visibility === "hidden" || +s.opacity < 0.05) return false; } const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  const box = (name, sel) => [...document.querySelectorAll(sel)].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { name, r: [r.left, r.top, r.right, r.bottom] }; });
  const chrome = [box("header", ".hud-top"), box("tab bar", "[data-intel-bar]"), box("panel", ".drawer:not(.drawer-out)"), box("command bar", ".cmdbar"), box("hey-orbit pill", ".voice-wake"),
    box("search", ".earth-search, .globe-search"), box("left list", ".earth-side, .globe-side, .globe-country"), box("region chips", ".globe-regions")].flat();
  const out = [];
  for (let i = 0; i < chrome.length; i++) for (let j = i + 1; j < chrome.length; j++) {
    const a = chrome[i].r, b = chrome[j].r;
    if (chrome[i].name === "command bar" && chrome[j].name === "hey-orbit pill" || chrome[j].name === "command bar" && chrome[i].name === "hey-orbit pill") continue; // the pill belongs to the bar
    if (Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 1 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 1) out.push(`overlap: ${chrome[i].name} [${a.map(Math.round)}] × ${chrome[j].name} [${b.map(Math.round)}]`);
  }
  const st = document.querySelector(".intel-stage")?.getBoundingClientRect();
  if (!st) out.push("no stage"); else {
    for (const c of chrome) { const a = c.r; if (Math.min(a[2], st.right) - Math.max(a[0], st.left) > 1 && Math.min(a[3], st.bottom) - Math.max(a[1], st.top) > 1) out.push(`overlap: stage [${[st.left, st.top, st.right, st.bottom].map(Math.round)}] × ${c.name} [${a.map(Math.round)}]`); }
    const hud = [box("earth timeline", ".earth-timeline"), box("earth headline", ".earth-lower"), box("near you", ".earth-near"), box("credit", ".earth-credit"), box("story card", ".earth-card")].flat();
    for (let i = 0; i < hud.length; i++) for (let j = i + 1; j < hud.length; j++) { const a = hud[i].r, b = hud[j].r;
      if (Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 1 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 1) out.push(`overlap: ${hud[i].name} [${a.map(Math.round)}] × ${hud[j].name} [${b.map(Math.round)}]`); }
    for (const h of hud.filter((x) => x.name !== "story card"))
      if (h.r[0] < st.left - 2 || h.r[1] < st.top - 2 || h.r[2] > st.right + 2 || h.r[3] > st.bottom + 2) out.push(`outside stage: ${h.name} [${h.r.map(Math.round)}] stage [${[st.left, st.top, st.right, st.bottom].map(Math.round)}]`);
  }
  const bar = document.querySelector("[data-intel-bar]");
  const tabs = [...document.querySelectorAll("[data-intel-tab]")].filter(vis).map((e) => e.dataset.intelTab);
  const lit = document.querySelector("[data-intel-tab][aria-current=true]")?.dataset.intelTab ?? null;
  return { issues: out, bar: vis(bar), tabs, lit, weather: !!document.querySelector("[data-news-weather]"), earth: !!document.querySelector(".earth-host"), classic: !document.querySelector("[data-news-weather]") && !document.querySelector(".earth-host") };
});

const ONLY = process.env.QA_ONLY ? process.env.QA_ONLY.split(",") : null;
const SCREENS = ["home", "core", "memory", "intelligence", "creation", "operations", "agents", "life", "vault", "analytics", "studio", "business", "arch", "profile", "m", ...CORE_OVER].filter((s) => !ONLY || ONLY.includes(s));
const report = {};
try {
  for (const [w, h] of SIZES) for (const s of SCREENS) {
    if (s === "m" && w > 640) continue; // /m is the phone home
    const { ctx, page, errors, calls } = await open(w, h, { galaxy: !process.env.QA_NOGL, stubGalaxy: true, phone: s === "m" });
    const over = s.startsWith("core@") ? s.slice(5) : null;
    if (s !== "home" && s !== "m") { await page.evaluate(([s, v]) => { location.hash = `o=${s}${v ? `&v=${v}` : ""}`; dispatchEvent(new HashChangeEvent("hashchange")); }, [over ?? s, process.env.QA_V || ""]); }
    await page.waitForTimeout(s === "home" ? 3500 : 5000);
    if (over) { // then open CORE over it, the way the top-bar CORE button / "Ask CORE" does
      await page.evaluate(() => dispatchEvent(new CustomEvent("orbit:navigate", { detail: { panel: "core" } })));
      await page.waitForTimeout(2500);
      for (const i of await coreOver(page)) check(false, `${s} ${w}: ${i}`);
      if (!fails.some((f) => f.startsWith(`${s} ${w}:`))) check(true, `${s} ${w}: CORE owns the screen`);
    }
    // LIFE / journal: never in a picture. Blur anything marked private before the shot.
    await page.addStyleTag({ content: "[data-private],[data-private] *{filter:blur(14px)!important;color:transparent!important;text-shadow:0 0 12px #888!important}" });
    if (process.env.QA_EVAL) console.log("EVAL", await page.evaluate(process.env.QA_EVAL).catch((e) => String(e)));
    if (process.env.QA_SCROLL) await page.evaluate((y) => { for (const el of document.querySelectorAll(".drawer .overflow-y-auto, .pu-body, [data-intel-surface]")) el.scrollTop = y; }, +process.env.QA_SCROLL); // look below the fold
    if (process.env.QA_CLICK) await page.evaluate((sel) => { document.querySelector(sel)?.click(); }, process.env.QA_CLICK).catch(() => {}); // e.g. the first trust mark
    if (process.env.QA_CLICK) await page.waitForTimeout(400);
    if (process.env.QA_INTEL && s === "intelligence") {
      for (const [i, step] of INTEL_STEPS.entries()) {
        const esc = step.startsWith("esc:"), want = esc ? step.slice(4) : step;
        if (esc) await page.keyboard.press("Escape");
        else { // the tab must be the top element at its centre (nothing drawn over it), then a real click there
          const hit = await page.evaluate((id) => { const b = document.querySelector(`[data-intel-tab="${id}"]`); if (!b) return "missing"; const r = b.getBoundingClientRect();
            const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e === b || b.contains(e) ? "" : `covered by ${e?.className || e?.tagName}`; }, step);
          check(!hit, `intel ${w}: tab ${step} reachable${hit ? " — " + hit : ""}`);
          await page.click(`[data-intel-tab="${step}"]`, { timeout: 60_000, force: true, noWaitAfter: true }).catch(() => page.evaluate((id) => document.querySelector(`[data-intel-tab="${id}"]`)?.click(), step));
        }
        await page.waitForTimeout(want === "weather" || want === "classic" ? 2500 : 3500);
        const r = await intelCheck(page);
        const mode = want === "weather" ? r.weather && !r.earth : want === "classic" ? r.classic : r.earth;
        check(r.bar && r.tabs.length === 6, `intel ${w} step ${i} ${step}: tab bar with all 6 tabs (${r.tabs.join(",")})`);
        check(r.lit === want && mode, `intel ${w} step ${i} ${step}: lit ${r.lit}, right map shown`);
        check(!r.issues.length, `intel ${w} step ${i} ${step}: layout clean${r.issues.length ? " — " + r.issues.join("; ") : ""}`);
        if (["country", "town", "weather", "classic"].includes(step) && i < 6 || step === "esc:orbit" && i === 15) await page.screenshot({ path: `${OUT}/${TAG}-intel-${step.replace(":", "-")}-${w}.png`, timeout: 180_000 });
      }
      await page.click(`[data-intel-tab="orbit"]`).catch(() => {}); await page.waitForTimeout(3000);
    }
    const issues = await audit(page);
    await page.screenshot({ path: `${OUT}/${TAG}-${s}-${w}.png`, timeout: 180_000 });
    if ((THROW.length || process.env.QA_NOGL) && s !== "home" && s !== "m") { // a crash must stay inside the planet
      const st = await page.evaluate(() => { const h = document.querySelector(".hud-top"), r = h && h.getBoundingClientRect();
        return { bar: !!r && r.height > 10 && getComputedStyle(h).visibility !== "hidden", card: !!document.querySelector("[data-boundary]"), root: document.getElementById("root").childElementCount }; });
      check(st.bar && st.root > 0, `${s} ${w}: top bar still there after a crash`);
      if (THROW.length) check(st.card, `${s} ${w}: crash card shown`);
      else check(!st.card, `${s} ${w}: no WebGL only drops the 3D, no crash card`); // QA_NOGL: the panel must keep working
    }
    if (FAIL.size && s !== "home" && s !== "m") check(!(await page.evaluate(() => !!document.querySelector("[data-boundary]"))), `${s} ${w}: no crash card with QA_FAIL`);
    report[`${s}-${w}`] = { errors: [...new Set(errors)], issues, missingApi: [...unknown] };
    console.log(`\n## ${s} ${w}x${h}\n` + [...new Set(errors)].map((e) => "  ERR " + e).join("\n") + "\n" + issues.map((i) => "  " + i).join("\n"));
    unknown.clear(); await ctx.close();
  }
} finally { await browser.close(); writeFileSync(`${OUT}/${TAG}-report.json`, JSON.stringify(report, null, 1)); }
if (fails.length) { console.log(`\n${fails.length} FAIL:\n` + fails.join("\n")); process.exitCode = 1; }
