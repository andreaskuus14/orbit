// node --no-warnings --experimental-strip-types scripts/memory-ui.mjs — the MEMORY planet in headless Chrome, used like the owner.
// Bundles the real MemoryWorld + MemoryPanel (esbuild) and the app's real CSS (Tailwind via PostCSS), serves them on a fake origin
// through Playwright routes and answers /api/* from an in-memory store of made-up memories (star positions from the REAL layout and
// similarity web: memory-map-pure + memory-edges-pure). Some rows miss fields on purpose (no tags, no date, no title, no kind) and
// two are journal entries (shown only as "Journal entry"). No server, no sign-in, no network, no model.
// MEM_TAG names the files (before / after). Out: MEM_OUT (default ./smoke-shots/memory-ui). Exits 1 on a failed check (after only).
// Numbers: idle fps and long tasks (> 50 ms) over 5 s on the map, the longest task while typing a search, click → visible feedback.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { layout } from "../src/lib/memory-map-pure.ts";
import { similarEdges } from "../src/lib/memory-edges-pure.ts";

const req = createRequire(import.meta.url);
const { chromium } = (() => { try { return req("playwright"); } catch { return req("playwright-core"); } })();
const OUT = resolve(process.env.MEM_OUT || "smoke-shots/memory-ui"), TAG = process.env.MEM_TAG || "after", AFTER = !TAG.startsWith("before");
const SIZES = (process.env.MEM_SIZES || "1440x900,1280x720").split(",").map((s) => s.split("x").map(Number));
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
import MemoryWorld from "@/components/MemoryWorld";
import { MemoryPanel } from "@/components/panels";
import { OPEN_MEMORY_EVENT } from "@/lib/palette-pure";
${AFTER ? `import { Toaster } from "@/components/ui";` : ""}
function App() {
  const [focus, setFocus] = useState(null);
  useEffect(() => { const f = (e) => setFocus(e.detail?.id ?? null); addEventListener(OPEN_MEMORY_EVENT, f); return () => removeEventListener(OPEN_MEMORY_EVENT, f); }, []);
  return <main className="orbit-shell relative h-dvh w-full overflow-hidden" data-view="3d">
    <div className="kept absolute inset-0"><MemoryWorld reduced={!!window.__reduced} quality="auto" onClose={() => { window.__closed = (window.__closed || 0) + 1; }} focusId={focus} onChanged={() => { window.__changed = (window.__changed || 0) + 1; }} List={MemoryPanel} /></div>
    ${AFTER ? `<Toaster dismissLabel="Dismiss" />` : ""}
  </main>;
}
createRoot(document.getElementById("root")).render(<App />);`, loader: "tsx", resolveDir: resolve("src") },
  bundle: true, write: false, outdir: "/tmp/memory-ui-out", format: "esm", jsx: "automatic", logLevel: "error", minify: !process.env.MEM_NOMIN, sourcemap: process.env.MEM_NOMIN ? "inline" : false,
  define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_SUPABASE_URL": '"http://x.test"', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"x"', "process.env.__NEXT_ROUTER_BASEPATH": '""' },
  loader: { ".json": "json", ".png": "dataurl", ".svg": "dataurl", ".glsl": "text" },
})).outputFiles;
const appJs = out.find((f) => f.path.endsWith(".js")).text, moduleCss = out.find((f) => f.path.endsWith(".css"))?.text ?? "";
console.log(`bundle ${(appJs.length / 1024).toFixed(0)} KB js, ${(moduleCss.length / 1024).toFixed(0)} KB css`);

// ---- Test data (made up; shaped like the real rows) ----
const NOW = Date.now(), DAYMS = 86_400_000;
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const KINDS = ["note", "idea", "decision", "research", "link", "project", "preference", "goal", "conversation", "document"];
const TOPICS = [["pet simulator", "roblox", "eggs", "shop"], ["orbit", "jarvis", "voice", "agents"], ["school", "architecture", "design"], ["youtube", "stickman", "video"], ["business", "webshop", "leads"]];
const TITLES = [["Shop prices stay in gems, not coins", "Egg hatch odds: 1 in 40 for legendary", "Pet sim: rebirth gives 1.5x coins", "Trading needs a confirm screen", "How other pet games pace eggs"],
  ["ORBIT could read my calendar first", "Voice: keep wake word short", "Agents report progress every minute", "JARVIS-style morning brief", "Use Haiku for small summaries"],
  ["Architecture entrance exam in May", "Sketch daily, 20 minutes", "Favourite architects: Zumthor, Aalto", "Model-making kit list", "Portfolio needs 12 pieces"],
  ["Stickman video: what if no military", "Thumbnail test: face vs no face", "Kokoro voice settings that sound calm", "Upload on Fridays", "Retention drops at 0:40"],
  ["Webshop idea: desk plants", "Lead list from Tallinn cafés", "AI writes product pages", "Price test: 19 vs 24 euro", "Supplier asks for 100 units"]];
const N = 260;
const mems = [];
for (let i = 0; i < N; i++) {
  const g = i % TOPICS.length, base = TITLES[g][i % 5];
  const created = new Date(NOW - Math.floor(rnd() * 120 * DAYMS) - (i < 6 ? 0 : DAYMS)).toISOString();
  const emb = Array.from({ length: 24 }, (_, d) => (d % TOPICS.length === g ? 1 : 0) + (rnd() - 0.5) * 0.9);
  mems.push({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, kind: KINDS[(i * 7 + g) % KINDS.length], title: i < 25 ? base : `${base} (${i})`,
    content: `${base}. Notes from ${["Monday", "Tuesday", "the weekend", "school", "a call"][i % 5]}: ${TOPICS[g].join(", ")}.`, url: null, storage_path: null,
    tags: [TOPICS[g][i % 4], ...(i % 9 === 0 ? [`scope:${["pet simulator", "orbit"][i % 2]}`] : [])], folder: null, created_at: created, updated_at: created,
    source: i % 6 === 0 ? "core-auto" : "capture", confirmation: i % 11 === 0 ? "suggested" : "confirmed", emb });
}
// rows with missing fields (the #719 class of crash) and journal entries
// (group 2 has three topics, so every 4th row there gets a null inside its tags array: text[] can hold NULL)
if (process.env.MEM_CLEAN) for (const m of mems) m.tags = m.tags.filter(Boolean);
else { Object.assign(mems[3], { tags: null }); Object.assign(mems[4], { created_at: null, updated_at: null }); Object.assign(mems[5], { title: null, kind: null, content: null }); }
mems.push({ id: "00000000-0000-4000-8000-0000000j0001", kind: "journal", title: "Journal entry · 2026-11-20", content: "This journal entry is private. Open it in LIFE → Journal.", locked: true, url: null, storage_path: null, tags: ["journal"], folder: null, created_at: new Date(NOW - 3 * DAYMS).toISOString(), updated_at: new Date(NOW - 3 * DAYMS).toISOString(), source: "life", emb: undefined });
mems.push({ id: "00000000-0000-4000-8000-0000000j0002", kind: "journal", title: "Journal entry · 2026-11-21", content: "This journal entry is private. Open it in LIFE → Journal.", locked: true, url: null, storage_path: null, tags: null, folder: null, created_at: new Date(NOW - 2 * DAYMS).toISOString(), updated_at: new Date(NOW - 2 * DAYMS).toISOString(), source: "life", emb: undefined });
const links = [{ id: "l1", from: mems[0].id, to: mems[5 * 1].id, status: "confirmed" }, { id: "l2", from: mems[1].id, to: mems[6].id, status: "suggested", score: 0.83 }, { id: "l3", from: mems[2].id, to: mems[12].id, status: "suggested", score: 0.79 }];
const REVIEW = [{ key: "merge:a", kind: "merge", target: "memory", ids: [mems[0].id, mems[25].id], score: 0.92,
  items: [{ id: mems[0].id, title: mems[0].title, text: mems[0].content }, { id: mems[25].id, title: mems[25].title, text: mems[25].content }] }];
const live = () => mems.filter((m) => !m.gone);
function mapBody() {
  const rows = live().sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  const ids = new Set(rows.map((r) => r.id));
  const ls = links.filter((l) => l.status !== "rejected" && ids.has(l.from) && ids.has(l.to)).map((l) => ({ from: l.from, to: l.to }));
  const pts = layout(rows.map((r) => ({ id: r.id, kind: r.kind ?? "note", tags: r.tags ?? [], embedding: r.emb })), ls);
  const edges = similarEdges(rows.map((r) => r.emb));
  const r2 = (n) => Math.round(n * 100) / 100;
  // the real route sends tags ?? []; here one row sends no tags at all and one no date, to prove the client survives either
  return { items: rows.map((r, i) => ({ id: r.id, title: r.kind === "journal" ? "Journal entry" : r.title, kind: r.kind, ...(r.tags ? { tags: r.tags } : {}), folder: r.folder,
    created_at: r.created_at, source: r.source, x: r2(pts[i].x), y: r2(pts[i].y), z: r2(pts[i].z) })), links: ls, edges, total: rows.length, graph: null };
}
const row = ({ emb, gone, ...m }) => m;
const linkRow = (l) => { const f = mems.find((m) => m.id === l.from), t = mems.find((m) => m.id === l.to); return { id: l.id, status: l.status, score: l.score ?? null, from: f && { id: f.id, title: f.title }, to: t && { id: t.id, title: t.title } }; };

async function shoot(page, name, clip) { await page.screenshot({ path: `${OUT}/${TAG}-${name}.png`, ...(clip ? { clip } : {}) }); }
const perf = { tag: TAG, sizes: {} };

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const [w, h] of SIZES) {
    const name = `${w}`, P = {};
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage(), calls = [], errors = [];
    page.on("pageerror", (e) => { errors.push(e.message); if (process.env.MEM_NOMIN) console.log(e.stack?.split("\n").slice(0, 6).join("\n")); });
    page.on("console", (m) => { if (m.type() === "error" && !/WebGL|GPU stall|404/.test(m.text())) errors.push(m.text().slice(0, 160)); });
    page.on("dialog", (d) => d.accept());
    await page.addInitScript(() => {
      try { localStorage.setItem("orbit.lang", "en"); } catch {}
      window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: "longtask", buffered: true });
    });
    await ctx.route(`${ORIGIN}/**`, async (route) => {
      const r = route.request(), u = new URL(r.url()), p = u.pathname, m = r.method();
      calls.push(`${m} ${p}${u.search}`);
      if (p === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html data-motion="on" class="dark"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><style>:root{--font-inter:"Inter";--font-jetbrains:monospace;--font-rajdhani:sans-serif}</style><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>` });
      if (p === "/app.css") return route.fulfill({ contentType: "text/css", body: css + "\n" + moduleCss });
      if (p === "/app.js") return route.fulfill({ contentType: "text/javascript", body: appJs });
      const body = r.postDataJSON?.() ?? null;
      if (p === "/api/memories/map") return route.fulfill({ json: mapBody() });
      if (p === "/api/memories" && m === "GET") {
        const q = (u.searchParams.get("q") ?? "").toLowerCase();
        const rows = live().filter((x) => !q || `${x.kind === "journal" ? "" : `${x.title} ${x.content}`} ${(x.tags ?? []).join(" ")}`.toLowerCase().includes(q)).map(row);
        return route.fulfill({ json: { results: rows.slice(0, q ? 30 : 200), mode: q ? "hybrid" : "list" } });
      }
      if (p === "/api/memories" && m === "POST") {
        const id = `00000000-0000-4000-8000-9${String(mems.length).padStart(11, "0")}`, at = new Date().toISOString();
        const t = body?.title || String(body?.content ?? "").split("\n")[0].slice(0, 80);
        mems.push({ id, kind: body?.kind || "note", title: t, content: body?.content ?? "", url: null, storage_path: null, tags: body?.tags ? String(body.tags).split(",").map((s) => s.trim()).filter(Boolean) : [], folder: null, created_at: at, updated_at: at, source: "capture", emb: Array.from({ length: 24 }, () => rnd() - 0.5) });
        return route.fulfill({ status: 201, json: { memory: row(mems.at(-1)), suggested: 0, embedded: true } });
      }
      const one = p.match(/^\/api\/memories\/([^/]+)$/);
      if (one && !["map", "hygiene", "episodes", "entities", "pack", "reembed", "upload"].includes(one[1])) {
        const x = mems.find((y) => y.id === one[1] && !y.gone);
        if (!x) return route.fulfill({ status: 404, json: { error: "Not found" } });
        if (m === "GET") return route.fulfill({ json: { memory: row(x), links: links.filter((l) => l.from === x.id || l.to === x.id) } });
        if (m === "PATCH") { if (x.kind === "journal" && ("title" in body || "content" in body)) return route.fulfill({ status: 409, json: { error: "Journal entries are private and edited in LIFE → Journal" } }); Object.assign(x, body, { updated_at: new Date().toISOString() }); return route.fulfill({ json: { memory: row(x) } }); }
        if (m === "DELETE") { x.gone = true; return route.fulfill({ json: { ok: true } }); }
      }
      if (/^\/api\/memories\/[^/]+\/control$/.test(p)) return route.fulfill({ json: body?.action === "why" ? { sources: [], linked: [] } : { ok: true, summariesUpdated: 0 } });
      if (p === "/api/links" && m === "GET") return route.fulfill({ json: { links: links.filter((l) => l.status !== "rejected").map(linkRow) } });
      if (p === "/api/links" && m === "PATCH") { const l = links.find((x) => x.id === body?.id); if (l) l.status = body.status; return route.fulfill({ json: { ok: true } }); }
      if (p === "/api/links" && m === "POST") { const l = { id: `l${links.length + 1}`, from: body?.from, to: body?.to, status: "confirmed" }; links.push(l); return route.fulfill({ status: 201, json: { link: linkRow(l) } }); }
      if (p === "/api/memories/hygiene") { if (m === "POST") REVIEW.splice(0); return route.fulfill({ json: { queue: REVIEW, proposals: [] } }); }
      const J = { "/api/needs-you": { items: [] }, "/api/memories/episodes": { episodes: [] }, "/api/people": { people: [] }, "/api/rewind": { items: [] }, "/api/study": { cards: [], due: 0 }, "/api/facts": { facts: [] } }[p];
      if (J) return route.fulfill({ json: J });
      return route.fulfill({ status: 404, json: { error: "not in harness" } });
    });

    const t0 = Date.now();
    await page.goto(`${ORIGIN}/`);
    await page.waitForFunction(() => document.querySelector("canvas"), null, { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(6000); // swiftshader: shaders compile slowly
    P.loadMs = Date.now() - t0;
    await shoot(page, `${name}-home`);
    // idle: fps + long tasks on the map with the panel open
    const cdp = await ctx.newCDPSession(page); await cdp.send("Performance.enable");
    const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
    const cost = (a, b, ms) => ({ scriptMsPerSec: Math.round(((b.ScriptDuration - a.ScriptDuration) * 1000) / (ms / 1000)), taskMsPerSec: Math.round(((b.TaskDuration - a.TaskDuration) * 1000) / (ms / 1000)),
      styleLayoutMsPerSec: Math.round((((b.RecalcStyleDuration - a.RecalcStyleDuration) + (b.LayoutDuration - a.LayoutDuration)) * 1000) / (ms / 1000)), domNodes: b.Nodes });
    const idle0 = async (ms) => page.evaluate(async (ms) => {
      window.__lt.length = 0; let n = 0; const s = performance.now();
      await new Promise((ok) => { const f = () => { n++; if (performance.now() - s < ms) requestAnimationFrame(f); else ok(); }; requestAnimationFrame(f); });
      const lt = window.__lt.slice(); return { fps: Math.round((n / ((performance.now() - s) / 1000)) * 10) / 10, longTasks: lt.length, longestMs: Math.round(Math.max(0, ...lt)) };
    }, ms);
    const idle = async (ms = 5000) => { const a = await metrics(); const r = await idle0(ms); return { ...r, ...cost(a, await metrics(), ms) }; };
    P.idle = await idle();
    const sweep = async () => { // hover sweep across the stars: script time per move (before: every hover re-rendered the whole panel)
      const m0 = await metrics(), s0 = Date.now(); let moves = 0;
      for (let y = 300; y <= 640; y += 34) for (let x = 120; x <= 860; x += 74) { await page.mouse.move(x, y); moves++; }
      const m1 = await metrics();
      await page.mouse.move(5, 5);
      return { moves, scriptMsPerMove: Math.round(((m1.ScriptDuration - m0.ScriptDuration) * 1000 / moves) * 10) / 10, wallMs: Date.now() - s0 };
    };
    if (!AFTER) P.hover = await sweep();
    // the panel's own text: no debug or raw error text, no literal "undefined"/"null"/"NaN"
    const panelText = await page.locator("body").innerText();
    check(!/undefined|\bnull\b|NaN|Invalid Date/.test(panelText), `${TAG}-${name}: no undefined/null/NaN/Invalid Date on screen`);
    check(!/stage: no data|Request failed|Failed \(\d{3}\)/.test(panelText), `${TAG}-${name}: no raw error text`);

    // search: type a word one key at a time and record the longest task
    const box = AFTER ? page.getByRole("textbox", { name: /search or remember/i }) : page.getByRole("textbox").first();
    await page.evaluate(() => { window.__lt.length = 0; });
    if (!AFTER) { await page.locator("details summary", { hasText: "More" }).first().click().catch(() => {}); await page.waitForTimeout(300); await page.getByRole("button", { name: /All tools/ }).first().click().catch(() => {}); await page.waitForTimeout(1500); }
    const sbox = AFTER ? box : page.getByRole("searchbox").first();
    if (await sbox.count()) {
      await sbox.click();
      const m0 = await metrics(), s0 = Date.now();
      await sbox.pressSequentially("pet", { delay: 60 });
      await page.waitForTimeout(1200);
      P.search = { ...(await page.evaluate(() => ({ longTasks: window.__lt.length, longestMs: Math.round(Math.max(0, ...window.__lt)) }))), ...cost(m0, await metrics(), Date.now() - s0) };
      await shoot(page, `${name}-search`);
    }
    if (AFTER && w === 1440) {
      const pane = page.locator(".mp-pane");
      // results: Enter runs the full search; the journal row says only "Journal entry"
      await box.fill("journal"); await box.press("Enter"); await page.waitForTimeout(900);
      const jt = await page.locator(".mp-list").innerText();
      check(/Journal entry/.test(jt), "journal rows are listed only as Journal entry");
      check(!/private\. Open it|#journal/.test(jt), "journal text and tags are not shown in the list");
      await page.locator(".mp-item", { hasText: "Journal entry" }).first().click(); await page.waitForTimeout(600);
      check(/private/.test(await pane.innerText()) && !(await pane.locator("textarea").count()), "a journal entry opens read-only with the privacy note");
      await box.fill(""); await page.waitForTimeout(400);
      await shoot(page, `${name}-notes`);
      await box.fill("pet"); await box.press("Enter"); await page.waitForTimeout(900);
      // open a result: the row is marked and the pane shows it in the same task as the click
      const first = page.locator(".mp-item").first();
      const fb = await first.evaluate(async (el) => {
        const s = performance.now(), t = el.querySelector(".mp-item-title")?.textContent; el.click();
        for (let i = 0; i < 5 && el.getAttribute("aria-selected") !== "true"; i++) await Promise.resolve(); // React flushes a click's update in a microtask
        return { ms: Math.round((performance.now() - s) * 10) / 10, current: el.getAttribute("aria-selected") === "true", t }; });
      P.openFeedbackMs = fb.ms; check(fb.current, `${TAG}: a click marks the row before the next frame (${fb.ms} ms)`);
      await page.waitForTimeout(700);
      check((await pane.locator("textarea").first().inputValue()).startsWith(fb.t.slice(0, 10)), "the pane opens the clicked memory");
      await shoot(page, `${name}-detail`);
      // edit + save
      const title = pane.getByRole("textbox", { name: "Title" });
      await title.fill("Shop prices stay in gems (edited)");
      await pane.getByRole("button", { name: "Save" }).click(); await page.waitForTimeout(800);
      check(mems.some((m) => m.title === "Shop prices stay in gems (edited)"), "edit saves through PATCH");
      check(/Saved/.test(await page.locator(".pu-toasts").innerText()), "save shows a Saved toast");
      check(/\(edited\)/.test(await page.locator(".mp-list").innerText()), "the list shows the new title at once");
      // link to another memory
      await pane.getByRole("button", { name: /^Link to/ }).click(); await page.waitForTimeout(300);
      await pane.getByRole("searchbox", { name: /find a memory to link/i }).fill("voice"); await page.waitForTimeout(400);
      await shoot(page, `${name}-link`);
      await pane.locator(".mp-link-pick button").first().click(); await page.waitForTimeout(700);
      check(links.length >= 4, "link: picking a memory creates a confirmed link");
      // delete with undo: nothing is deleted until the undo window ends; Undo keeps it
      const victim = mems.find((m) => m.title === "Shop prices stay in gems (edited)");
      const delVia = async () => { await pane.getByRole("button", { name: "Actions for this memory" }).click(); await page.waitForTimeout(200); await page.getByRole("menuitem", { name: "Delete" }).click(); };
      await delVia(); await page.waitForTimeout(500);
      check(!calls.some((c) => c.startsWith("DELETE")), "delete waits (undo window): no DELETE request yet");
      check(!/\(edited\)/.test(await page.locator(".mp-list").innerText()), "the deleted row leaves the list at once");
      await shoot(page, `${name}-undo`);
      await page.locator(".pu-toasts").getByRole("button", { name: "Undo" }).click(); await page.waitForTimeout(500);
      check(!victim.gone && /\(edited\)/.test(await page.locator(".mp-list").innerText()), "Undo keeps the memory");
      await page.locator(".mp-item", { hasText: "(edited)" }).first().click(); await page.waitForTimeout(600);
      await delVia();
      await page.waitForTimeout(7500);
      check(calls.filter((c) => c.startsWith("DELETE")).length === 1 && victim.gone, "delete goes out once after the undo window");
      // remember … from the search field
      await box.fill("Remember that the shop opens on Fridays"); await box.press("Enter"); await page.waitForTimeout(1200);
      check(mems.some((m) => /shop opens on Fridays/.test(m.content)), "remember … saves a memory");
      // nav: tags, then a tag filter
      await page.getByRole("button", { name: /^Tags/ }).click(); await page.waitForTimeout(300);
      await page.locator(".mp-tag").first().click(); await page.waitForTimeout(300);
      check(/^#/.test(await page.locator(".mp-list-head").innerText()), "a tag filters the list");
      await page.getByRole("button", { name: "Show all notes" }).click(); await page.waitForTimeout(300);
      // the add sheet (title, kind, tags, link)
      await page.getByRole("button", { name: "More", exact: true }).click(); await page.waitForTimeout(250);
      await shoot(page, `${name}-menu`);
      await page.getByRole("menuitem", { name: "Add with details" }).click(); await page.waitForTimeout(500);
      await page.locator(".pu-sheet").getByRole("textbox", { name: "What to remember" }).fill("Supplier wants 100 units minimum");
      await page.locator(".pu-sheet").getByRole("textbox", { name: "Tags" }).fill("business, supplier");
      await shoot(page, `${name}-add`);
      await page.locator(".pu-sheet").getByRole("button", { name: "Save" }).click(); await page.waitForTimeout(900);
      check(mems.some((m) => /100 units minimum/.test(m.content) && (m.tags ?? []).includes("supplier")), "add sheet saves with tags");
      check(await page.locator(".mp-needs").count() > 0, "Needs you shows the merge suggestion");
      // keyboard: the "…" menu opens with the keyboard; arrows move through the list
      await page.getByRole("button", { name: "More", exact: true }).focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(200);
      check(await page.getByRole("menuitem").first().evaluate((el) => el === document.activeElement), "menu opens from the keyboard and focuses its first item");
      await page.keyboard.press("Escape");
      const sel0 = await page.locator(".mp-item[aria-selected=true]").innerText();
      await page.locator(".mp-item[aria-selected=true]").focus(); await page.keyboard.press("ArrowDown"); await page.waitForTimeout(300);
      check(await page.locator(".mp-item[aria-selected=true]").innerText() !== sel0, "ArrowDown opens the next memory");
      P.notesIdle = await idle(4000);
      // map view: the stars with the open memory beside them, labels and connection lines
      await page.getByRole("button", { name: "Map", exact: true }).first().click(); await page.waitForTimeout(7000);
      await shoot(page, `${name}-map`);
      check(await page.locator(".memory-star-label").count() >= 1, "map: the open memory and its connections carry labels");
      check(/memories/.test(await page.locator(".mp-stats").innerText()), "map: the live strip shows counts");
      P.mapIdle = await idle(4000);
      P.hover = await sweep();
      await page.getByRole("button", { name: "Notes", exact: true }).first().click(); await page.waitForTimeout(500);
    }
    if (AFTER) { // reduced motion: the canvas renders on demand (no continuous frames)
      // nothing
    }
    // 1280: no clipping: the shell's last element is inside the viewport and the close button is reachable
    if (AFTER) {
      const fit = await page.evaluate(() => { const s = document.querySelector(".pu-shell")?.getBoundingClientRect(); return s ? { top: s.top, bottom: s.bottom, h: innerHeight, right: s.right, w: innerWidth } : null; });
      check(!!fit && fit.bottom <= fit.h + 1 && fit.right <= fit.w + 1 && fit.top >= 0, `${TAG}-${name}: the shell fits the window (${JSON.stringify(fit)})`);
    }
    check(!errors.length, `${TAG}-${name}: no page errors${errors.length ? ` (${errors.slice(0, 3).join(" | ")})` : ""}`);
    perf.sizes[name] = P;
    await ctx.close();
  }
  // reduced motion at 1440: frames per second while idle should drop to ~0 after (render on demand)
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.addInitScript(() => { window.__reduced = true; try { localStorage.setItem("orbit.lang", "en"); } catch {} });
    await ctx.route(`${ORIGIN}/**`, async (route) => {
      const u = new URL(route.request().url()), p = u.pathname;
      if (p === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html data-motion="on"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><style>:root{--font-inter:"Inter";--font-jetbrains:monospace;--font-rajdhani:sans-serif}</style><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>` });
      if (p === "/app.css") return route.fulfill({ contentType: "text/css", body: css + "\n" + moduleCss });
      if (p === "/app.js") return route.fulfill({ contentType: "text/javascript", body: appJs });
      if (p === "/api/memories/map") return route.fulfill({ json: mapBody() });
      if (p === "/api/memories") return route.fulfill({ json: { results: live().map(row), mode: "list" } });
      return route.fulfill({ json: {} });
    });
    await page.goto(`${ORIGIN}/`); await page.waitForTimeout(3000);
    if (AFTER) { await page.getByRole("button", { name: "Map", exact: true }).first().click(); await page.waitForTimeout(6000); }
    else await page.waitForTimeout(3000);
    perf.reducedCanvasFrames = await page.evaluate(async () => {
      const c = document.querySelector("canvas"); if (!c) return null;
      const gl = c.getContext("webgl2") || c.getContext("webgl"); let draws = 0;
      if (gl) { const d = gl.drawArrays.bind(gl), e = gl.drawElements.bind(gl); gl.drawArrays = (...a) => { draws++; return d(...a); }; gl.drawElements = (...a) => { draws++; return e(...a); }; }
      await new Promise((r) => setTimeout(r, 3000)); return draws;
    });
    await shoot(page, "1440-reduced");
    await ctx.close();
  }
} finally { await browser.close(); }
writeFileSync(`${OUT}/${TAG}-perf.json`, JSON.stringify(perf, null, 2));
console.log(JSON.stringify(perf, null, 2));
if (fails.length) { console.log(`${fails.length} check(s) failed`); if (AFTER) process.exitCode = 1; }
