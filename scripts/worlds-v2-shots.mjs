// node --no-warnings scripts/worlds-v2-shots.mjs — stills of the planet worlds' 3D scenes (planet worlds v2), before/after.
// Bundles the real world component (esbuild) with a stub panel of the real size and the app's CSS, answers /api/* with
// made-up data, renders in headless Chrome (swiftshader software GL: stills only, fps here means nothing).
// WV_ROOT: source tree (default .), WV_TAG: file prefix, WV_IDS: comma list, WV_OUT: folder. Nothing leaves the machine.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const req = createRequire(import.meta.url);
const { chromium } = (() => { try { return req("playwright"); } catch { return req("playwright-core"); } })();
const ROOT = resolve(process.env.WV_ROOT || "."), TAG = process.env.WV_TAG || "after", OUT = resolve(process.env.WV_OUT || "smoke-shots/worlds-v2");
const IDS = (process.env.WV_IDS || "operations,vault,business,analytics,life,memory").split(",");
const WAIT = Number(process.env.WV_WAIT || 14000);
mkdirSync(OUT, { recursive: true });
const ORIGIN = "http://orbit.test";

const cssIn = ["globals.css", "observatory.css", "motion.css"].map((f) => readFileSync(resolve(ROOT, "src/app", f), "utf8")).join("\n");
const css = (await postcss([tailwind({ base: ROOT })]).process(cssIn, { from: resolve(ROOT, "src/app/globals.css") })).css;

const PANEL = `function Panel(){ return <div className="glass" style={{flex:1,height:"100%",padding:16,color:"#cbd5e1",fontSize:13}}>Workspace panel (stub)</div>; }`;
const entry = (id) => {
  const shell = `<main className="orbit-shell relative h-dvh w-full overflow-hidden" data-view="3d">`;
  if (id === "memory") return `import { createRoot } from "react-dom/client"; import MemoryWorld from "@/components/MemoryWorld"; ${PANEL}
createRoot(document.getElementById("root")).render(${shell}<MemoryWorld reduced={false} quality="high" onClose={() => {}} List={Panel} /></main>);`;
  if (id === "agents") return `import { createRoot } from "react-dom/client"; import AgentsStation from "@/components/AgentsStation";
createRoot(document.getElementById("root")).render(${shell}<AgentsStation reduced={false} quality="high" onClose={() => {}} /></main>);`;
  if (id === "studio") return `import { createRoot } from "react-dom/client"; import StudioWorld from "@/components/StudioWorld";
createRoot(document.getElementById("root")).render(${shell}<StudioWorld reduced={false} quality="high" onClose={() => {}} /></main>);`;
  if (id === "gamedev") return `import { createRoot } from "react-dom/client"; import DevWorld from "@/components/DevWorld";
createRoot(document.getElementById("root")).render(${shell}<DevWorld reduced={false} quality="high" onClose={() => {}} /></main>);`;
  if (id === "arch") return `import { createRoot } from "react-dom/client"; import ArchWorld from "@/components/ArchWorld";
createRoot(document.getElementById("root")).render(${shell}<ArchWorld reduced={false} quality="high" onClose={() => {}} /></main>);`;
  return `import { createRoot } from "react-dom/client"; import PlanetWorld from "@/components/PlanetWorld"; ${PANEL}
createRoot(document.getElementById("root")).render(${shell}<PlanetWorld id="${id}" reduced={false} quality="high" onClose={() => {}}><Panel /></PlanetWorld></main>);`;
};
async function bundle(id) {
  const out = (await build({ stdin: { contents: entry(id), loader: "tsx", resolveDir: resolve(ROOT, "src") }, bundle: true, write: false, outdir: "/tmp/wv2-out", format: "esm", jsx: "automatic", logLevel: "error", minify: true,
    alias: { "@": resolve(ROOT, "src") }, nodePaths: [resolve(ROOT, "node_modules")],
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_SUPABASE_URL": '"http://x.test"', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"x"', "process.env.__NEXT_ROUTER_BASEPATH": '""' },
    loader: { ".json": "json", ".png": "dataurl", ".svg": "dataurl", ".glsl": "text" } })).outputFiles;
  return { js: out.find((f) => f.path.endsWith(".js")).text, css: out.find((f) => f.path.endsWith(".css"))?.text ?? "" };
}

// ---- made-up data ----
const T0 = Date.now(), H = 3_600_000, iso = (t) => new Date(t).toISOString();
const titles = ["Write this week's YouTube ideas", "Find 5 new clients in Tallinn", "Summarize the school brochure", "Pull analytics from YouTube", "Check pet sim shop prices", "Tidy the vault folders", "Draft a reply to the supplier", "Research Roblox egg odds"];
const st = ["running", "running", "queued", "queued", "awaiting_approval", "done", "done", "done", "done", "failed", "done", "done", "queued", "done", "cancelled", "done"];
const tasks = st.map((s, i) => ({ id: `t${i}`, title: titles[i % titles.length], agent: ["nova", "forge", "echo"][i % 3], status: s, created_at: iso(T0 - (i + 1) * 0.7 * H), finished_at: ["done", "failed", "cancelled"].includes(s) ? iso(T0 - i * 0.5 * H) : null, trace: [], pending: [] }));
const kinds = [["image", 46], ["video", 18], ["pdf", 22], ["text", 30], ["audio", 9], ["doc", 12]];
const files = kinds.flatMap(([k, n]) => Array.from({ length: n }, (_, i) => ({ name: `${k}/file-${i}.${k}`, type: k, size: Math.round(10 ** (3 + ((i * 37) % 50) / 10)), mtime: T0 - i * 7 * H })));
const stages = [["lead", 14], ["contacted", 9], ["replied", 5], ["pilot", 3], ["paying", 2], ["lost", 4]];
const prospects = stages.flatMap(([s, n]) => Array.from({ length: n }, (_, i) => ({ id: `${s}${i}`, name: ["Nordic Cafe", "Gym One", "Pixel Shop", "Tallinn Dental", "Old Town Bakery"][i % 5] + ` ${i}`, stage: s, fee: s === "paying" ? 350 + i * 200 : s === "pilot" ? 250 : 0, created_at: iso(T0 - i * 30 * H), updated_at: iso(T0 - i * 20 * H) })));
const summary = { cost: { projects: [["Pet simulator", 412], ["ORBIT", 296], ["YouTube", 168], ["School prep", 95], [null, 64], ["Business", 41]].map(([name, minutes]) => ({ name, minutes, untimed: 0, accepted: 3, units: 5 })) },
  daily: Array.from({ length: 7 }, (_, i) => ({ date: `d${i}`, done: 3 + (i % 3), failed: i % 2, tokens: 1000 })) };
const habits = [["Exercise", 12, true], ["Hydrate", 30, true], ["Read", 6, true], ["Meditate", 3, false], ["Sleep by 23:00", 0, false]].map(([name, streak, doneToday], i) => ({ id: `h${i}`, name, streak, doneToday, scheduledToday: true, week: [] }));
const memKinds = ["note", "idea", "project", "person", "learning", "link"];
const memItems = Array.from({ length: 260 }, (_, i) => { const k = memKinds[i % 6], a = (i % 6) * 1.05, r = 6 + (i % 13) * 0.6; return { id: `m${i}`, title: `Memory ${i}`, kind: k, tags: [], folder: null, created_at: iso(T0 - i * 5 * H), source: null, x: Math.cos(a) * 14 + Math.cos(i) * r * 0.5, y: Math.sin(i * 1.3) * 4, z: Math.sin(a) * 14 + Math.sin(i) * r * 0.5 }; });
const devGames = [["pet-sim", "Pet Simulator", "roblox", "beta"], ["tower-run", "Tower Run", "roblox", "prototype"], ["orbit-web", "Orbit Arcade", "web", "idea"]].map(([id, name, platform, stage]) => ({ id, name, platform, stage, pitch: "", notes: "" }));
const devBugs = [["crash", "open"], ["major", "open"], ["major", "fixing"], ["minor", "open"], ["minor", "open"], ["polish", "open"], ["minor", "fixed"]].map(([severity, status], i) => ({ id: `b${i}`, game: i < 5 ? "pet-sim" : "tower-run", title: `Bug ${i}`, detail: "", severity, status, created: iso(T0 - i * H) }));
const THUMBS = (process.env.WV_THUMBS || "").split(",").filter(Boolean);
const DATA = {
  "/api/tasks": { tasks }, "/api/vault": { files, usage: {} }, "/api/business": { prospects }, "/api/activity": { items: tasks.map((t) => ({ at: t.created_at, area: "agents", title: t.title })) },
  "/api/analytics/summary": summary, "/api/life": { habits, journal: [], reminders: [] }, "/api/memories/map": { items: memItems, links: [], total: memItems.length },
  "/api/agents": { agents: ["nova", "forge", "echo", "sentinel", "atlas"].map((s, i) => ({ slug: s, name: s[0].toUpperCase() + s.slice(1), role: ["Research", "Content", "Writing", "Watch", "Planning"][i], color: ["#a78bfa", "#f472b6", "#38bdf8", "#4ade80", "#fbbf24"][i], builtin: true, stats: { running: i < 2 ? 1 : 0, done: 10 + i, failed: i % 2 } })) },
  "/api/studio": { configured: true, fetchedAt: iso(T0), channel: { id: "c", title: "Andreas", subs: 12400, views: 980000, videos: 42 },
    videos: ["What if there was no military?", "Why ships avoid one strait", "The cheapest house in Europe", "Pet sim update", "Roblox egg odds explained", "A day building ORBIT", "Stickman history"].map((title, i) => ({ id: `v${i}`, title, publishedAt: iso(T0 - i * 50 * H), views: [182000, 64000, 41000, 22000, 15000, 9000, 6000][i], likes: 100, comments: 10, durationSec: i % 2 ? 40 : 480, thumb: THUMBS[i % THUMBS.length] })) },
  "/api/chains": { chains: [] }, "/api/devworld": { world: { v: 1, games: devGames, bugs: devBugs }, updatedAt: iso(T0) }, "/api/projects": { projects: [] }, "/api/goals": { goals: [] },
};

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
for (const id of IDS) {
  const b = await bundle(id).catch((e) => { console.log(`skip ${id}: ${e.message.split("\n")[0]}`); return null; });
  if (!b) continue;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.route(`${ORIGIN}/**`, (route) => {
    const u = new URL(route.request().url()), p = u.pathname;
    if (process.env.WV_DEBUG && p.startsWith("/ui/")) console.log(`  [req] ${p}`);
    if (p === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html class="dark" lang="en"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><style>:root{--font-inter:"Inter";--font-jetbrains:monospace}</style><body><div id="root"></div><script>window.process={env:{NODE_ENV:"production"}};window.__nofx=!!${JSON.stringify(!!process.env.WV_NOFX)};window.__m=${Number(process.env.WV_M || 63)}</script><script type="module" src="/app.js"></script></body></html>` });
    if (p === "/app.css") return route.fulfill({ contentType: "text/css", body: css + "\n" + b.css });
    if (p === "/app.js") return route.fulfill({ contentType: "text/javascript", body: b.js });
    const f = resolve(ROOT, "public" + p);
    if (!p.startsWith("/api/") && existsSync(f)) return route.fulfill({ body: readFileSync(f) });
    const mm = p.match(/^\/api\/memories\/(m\d+)$/); if (mm) { const m = memItems.find((x) => x.id === mm[1]); return route.fulfill({ contentType: "application/json", body: JSON.stringify({ memory: { ...m, content: "Made-up note.", updated_at: m.created_at } }) }); }
    const j = DATA[p];
    return j ? route.fulfill({ contentType: "application/json", body: JSON.stringify(j) }) : route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await ctx.route(/^https?:\/\/(?!orbit\.test)/, async (r) => { // fonts/textures only, fetched by Node (proxy-aware): the page's own net has no proxy
    const url = r.request().url();
    if (r.request().method() !== "GET" || !/\.(woff2?|ttf|otf|png|webp|jpe?g|json)(\?|$)/.test(url)) return r.abort();
    try { const res = await fetch(url); return r.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: { "content-type": res.headers.get("content-type") ?? "application/octet-stream", "access-control-allow-origin": "*" } }); } catch { return r.abort(); }
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  if (process.env.WV_DEBUG) page.on("requestfailed", (r) => console.log(`  [failed] ${r.url().slice(0, 140)} ${r.failure()?.errorText}`));
  if (process.env.WV_DEBUG) page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log(`  [${m.type()}] ${m.text().slice(0, 300)}`); });
  await page.goto(`${ORIGIN}/`);
  if (id === "memory") { await page.waitForTimeout(3000); await page.getByRole("button", { name: /^Map$/ }).first().click({ timeout: 10_000 }).catch(() => console.log("memory: no Map button")); await page.waitForTimeout(2500); await page.getByRole("button", { name: /back/i }).first().click({ timeout: 5000 }).catch(() => console.log("memory: no Back button")); }
  await page.waitForTimeout(WAIT);
  const chips = await page.evaluate(() => [...document.querySelectorAll(".wchip")].map((e) => getComputedStyle(e).opacity === "1").reduce((a, v) => [a[0] + (v ? 1 : 0), a[1] + 1], [0, 0]));
  console.log(`${id}: chips shown ${chips[0]}/${chips[1]}`);
  await page.screenshot({ path: `${OUT}/${TAG}-${id}.png`, timeout: 120_000 });
  console.log(`${id}: shot${errs.length ? ` (page errors: ${errs.slice(0, 2).join(" | ")})` : ""}`);
  await ctx.close();
}
await browser.close();
