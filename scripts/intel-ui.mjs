// node --experimental-strip-types scripts/intel-ui.mjs — screenshots of the INTELLIGENCE planet (globe + panel) in headless Chrome.
// Bundles the real NewsGlobe + IntelligencePanel (esbuild) and the app's real CSS (Tailwind via PostCSS), serves them on a fake
// origin through Playwright routes, and answers the APIs with test data: a briefing run through the REAL fact check marks
// (factcheck-pure applyBriefing + briefingNote) and a job row with the real pulse detail line. No server, no sign-in, no network.
// Out: INTEL_OUT (default ./smoke-shots/intel-ui). INTEL_TAG names the files (e.g. before / after). Exits 1 on a failed check.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { applyBriefing, briefingClaims, briefingNote } from "../src/lib/factcheck-pure.ts";
import { hotspots } from "../src/lib/geo.ts";

const req = createRequire(import.meta.url);
const { chromium } = (() => { try { return req("playwright"); } catch { return req("playwright-core"); } })();
const OUT = resolve(process.env.INTEL_OUT || "smoke-shots/intel-ui"), TAG = process.env.INTEL_TAG || "shot";
mkdirSync(OUT, { recursive: true });
const ORIGIN = "http://orbit.test";
const fails = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails.push(what); };

// ---- CSS: the three sheets the root layout imports, through the app's own PostCSS (Tailwind 4) ----
const cssIn = ["globals.css", "observatory.css", "motion.css"].map((f) => readFileSync(resolve("src/app", f), "utf8")).join("\n");
const css = (await postcss([tailwind({ base: resolve(".") })]).process(cssIn, { from: resolve("src/app/globals.css") })).css;

// ---- JS: a minimal ORBIT shell around the real components ----
const js = (await build({
  stdin: { contents: `import { createRoot } from "react-dom/client";
import NewsGlobe from "@/components/NewsGlobe";
import { IntelligencePanel } from "@/components/IntelligencePanel";
const n = () => {};
createRoot(document.getElementById("root")).render(
  <main className="orbit-shell relative h-dvh w-full overflow-hidden" data-view="3d">
    <header className="absolute inset-x-0 top-0 z-30 flex h-14 items-center px-4"><span className="brand">Orbital</span></header>
    <NewsGlobe reduced onClose={n} quality="low" />
    <aside className="glass drawer" role="dialog" aria-label="Intelligence">
      <div className="drag-handle mb-3 flex items-center justify-between"><h2 className="brand world-header flex items-center gap-2 text-base">Intelligence</h2><button className="chip">Close</button></div>
      <div className="min-h-0 flex-1 overflow-y-auto"><IntelligencePanel /></div>
    </aside>
    <form className="cmdbar glass flex gap-2"><input className="field w-full" placeholder="Ask ORBIT…" aria-label="Ask ORBIT" /></form>
  </main>);`, loader: "tsx", resolveDir: resolve("src") },
  bundle: true, write: false, outdir: "/tmp/intel-ui-out", format: "esm", jsx: "automatic", logLevel: "error",
  define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_SUPABASE_URL": '""', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '""' },
  loader: { ".json": "json", ".css": "css", ".module.css": "local-css" },
})).outputFiles;
const appJs = js.find((f) => f.path.endsWith(".js")).text, moduleCss = js.find((f) => f.path.endsWith(".css"))?.text ?? "";

// ---- Test data (made up for the harness; shaped like the real rows) ----
const NOW = Date.now(), ago = (h) => new Date(NOW - h * 3_600_000).toISOString();
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ART = [
  ["Roblox opens creator fund for small studios", "https://example.com/roblox-fund", "The Verge", "Roblox", 5, "Roblox said on Friday it will open a creator fund of 20 million dollars for studios with fewer than 10 people. Applications open in December."],
  ["Unity cuts runtime fee for indie games", "https://example.com/unity-fee", "GamesIndustry.biz", "game development", 9, "Unity said it will drop the runtime fee for games earning under 1 million dollars a year."],
  ["New open model tops coding benchmark", "https://example.com/open-model", "Ars Technica", "artificial intelligence", 7, "A new open-weight model scored first on a public coding test, its makers said."],
  ["Ceasefire talks resume in Cairo", "https://example.com/cairo-talks", "BBC World", "world", 3, "Negotiators returned to Cairo on Saturday for a new round of ceasefire talks, officials said."],
  ["Ceasefire talks restart with US mediators", "https://example.com/cairo-us", "Al Jazeera", "world", 4, "US mediators joined the Cairo talks, Egypt's foreign ministry said."],
  ["Ukraine says drones hit fuel depot", "https://example.com/ukraine-depot", "The Guardian World", "world", 6, "Ukraine's army said its drones struck a fuel depot in western Russia overnight."],
  ["ECB holds rates, signals cut in spring", "https://example.com/ecb", "DW World", "economy", 8, "The European Central Bank kept its main rate at 2.5% and said a cut could come in spring."],
  ["Oil falls as supply worries ease", "https://example.com/oil", "NPR Economy", "economy", 10, "Oil prices fell 2% on Friday as worries about supply eased."],
  ["Estonia's parliament passes new tech budget", "https://example.com/estonia-budget", "ERR News", "politics", 12, "Estonia's parliament approved a budget that adds money for digital services."],
  ["Japan election: ruling party loses seats", "https://example.com/japan-vote", "NPR World", "politics", 11, "Japan's ruling party lost seats in Sunday's election, results showed."],
].map(([title, url, source, topic, h, passage], i) => ({ id: id(i + 1), title, url, source, topic, published_at: ago(h), passage }));
const A = (i) => `[a:${ART[i].id}]`;
const raw = `## For you
### Roblox opens a creator fund for small studios — Single source
Roblox will open a 20 million dollar fund for studios with fewer than 10 people ${A(0)}. Applications open in December ${A(0)}. The fund will also pay for marketing help ${A(0)}. Why it matters: small Roblox teams like yours can apply.
### Unity drops its runtime fee for small games — Single source
Unity will drop the runtime fee for games that earn under 1 million dollars a year ${A(1)}. Why it matters: one less cost if you ship outside Roblox.
### Open model tops a coding test — Single source
A new open-weight model came first on a public coding test, its makers said ${A(2)}. It runs on a single 8 GB graphics card ${A(2)}.
## World & conflict
### Ceasefire talks resume in Cairo — Confirmed
Negotiators returned to Cairo on Saturday for a new round of talks ${A(3)} ${A(4)}. US mediators joined, Egypt's foreign ministry said ${A(4)}. Why it matters: the last round ended without a deal.
### Ukraine says its drones hit a fuel depot — Single source
Ukraine's army said its drones struck a fuel depot in western Russia overnight ${A(5)}. Russia has not commented ${A(5)}.
## Economy & markets
### ECB holds rates — Single source
The European Central Bank kept its main rate at 2.5% and said a cut could come in spring ${A(6)}. Oil prices fell 2% as supply worries eased ${A(7)}.
## Politics
### Estonia passes a tech budget — Single source
Estonia's parliament approved a budget with more money for digital services ${A(8)}.
## Suggested next steps
1. Check the Roblox fund rules when applications open ${A(0)}.`;
// The real fact check marks: "marketing help" and "8 GB" are not in the passages, the Russia line is contradicted.
const claims = briefingClaims(raw), verdict = new Map();
for (const c of claims) verdict.set(c.key, /marketing|8 GB/.test(c.sentence) ? "not_backed" : /not commented/.test(c.sentence) ? "contradicted" : "backed");
const srcs = new Map(ART.map((a) => [a.id, { id: a.id, text: `${a.title}.\n${a.passage}`, outlet: a.source, topic: a.topic }]));
const fc = applyBriefing(raw, claims, verdict, srcs), note = briefingNote(fc);
const content = fc.content + (note ? `\n\n${note}` : "");
const cited = [...new Set([...content.matchAll(/\[a:([0-9a-f-]{36})\]/g)].map((m) => m[1]))].map((x) => ART.find((a) => a.id === x));
const citations = cited.map((a, i) => ({ id: a.id, title: a.title, url: a.url, source: a.source, published_at: a.published_at,
  ...(i % 3 === 2 ? { evidence: "snippet", passage: a.passage.slice(0, 120) } : { evidence: "fetched", passage: a.passage, fetched_url: a.url }) }));
const detail = `manual: ${ART.length} articles, 7 read in full, ${citations.length} cited, 12 new, 0 feed errors, fact check ${fc.backed} backed, ${fc.notBacked} not backed, ${fc.removed} removed, ${fc.oneSource} one-source, ${fc.unchecked} unchecked (6807 ms)`;
const BRIEFINGS = { briefings: [
  { id: id(100), kind: "manual", title: "Pulse briefing · Sun 22 Nov", content, citations, article_count: ART.length, created_at: ago(1) },
  { id: id(101), kind: "morning", title: "Morning Orbit · Sun 22 Nov", content: "## World & conflict\n### Talks planned — Single source\nTalks are planned for Saturday [a:" + ART[3].id + "].", citations: [citations.find((c) => c.id === ART[3].id)].filter(Boolean), article_count: 40, created_at: ago(9) },
], articles: ART.map(({ passage, ...a }) => a), jobs: [{ status: "ok", detail, started_at: ago(1.1), finished_at: ago(1) }], scheduled: true };
const FEEDS = { feeds: [
  { id: id(200), url: "https://feeds.bbci.co.uk/news/world/rss.xml", title: "BBC World", topic: "world", enabled: true, last_fetched_at: ago(1), last_error: null },
  { id: id(201), url: "https://www.bing.com/news/search?q=Roblox&format=rss", title: "News: Roblox", topic: "Roblox", enabled: true, last_fetched_at: ago(1), last_error: null },
  { id: id(202), url: "https://example.com/broken.xml", title: "Old blog", topic: null, enabled: true, last_fetched_at: ago(1), last_error: "Not an RSS or Atom feed" },
] };
const dev = (k, i, status, why) => ({ key: k, rev: "1", status, title: ART[i].title, why, independent: i === 3 ? 2 : 1, articles: i === 3 ? [ART[3], ART[4], ...[2, 5, 7, 11, 16].map((hh, k) => ({ ...ART[3], id: id(300 + k), url: `https://example.com/cairo-${k}`, source: ["Reuters", "AP", "DW World", "NPR World", "France 24"][k], published_at: ago(hh) }))] : [ART[i]] });
const INTEL = { prefs: { topics: ["Roblox", "game development", "artificial intelligence"], regions: ["Europe"], projects: ["pet simulator"], exclusions: [], length: "normal", less: [] },
  topics: [{ topic: "Roblox", items: [dev("k1", 0, "new", "Your topic: Roblox")], known: 4 }, { topic: "world", items: [dev("k2", 3, "new", "2 outlets"), dev("k3", 5, "corrected", "Updated story")], known: 9 }, { topic: "game development", items: [], known: 3 }],
  health: { [id(202)]: { kind: "parse", lastError: "Not an RSS or Atom feed" } }, done: [], votes: { k2: "useful" },
  gate: { votes: 3, held: 1, useful: 2, notUseful: 1, current: null, candidate: null, adopt: false, why: "intel.fb.whyFew", need: 20 } };
const GEO_ARTS = [
  ...["Kyiv says drones hit fuel depot in Russia", "Ukraine and Russia trade overnight strikes", "Kyiv power cuts after attack"].map((t, i) => ({ title: t, url: `https://example.com/ua${i}`, source: "BBC World", published_at: ago(2 + i) })),
  ...["Ceasefire talks resume in Cairo, Egypt", "Egypt hosts US mediators", "Cairo talks: what is on the table"].map((t, i) => ({ title: t, url: `https://example.com/eg${i}`, source: "Al Jazeera", published_at: ago(3 + i) })),
  ...["Japan election: ruling party loses seats", "Tokyo markets calm after Japan vote"].map((t, i) => ({ title: t, url: `https://example.com/jp${i}`, source: "NPR World", published_at: ago(5 + i) })),
  ...["United States: Fed minutes show split", "US jobs report beats forecasts", "California wildfire contained"].map((t, i) => ({ title: t, url: `https://example.com/us${i}`, source: "NPR", published_at: ago(4 + i) })),
  ...["Estonia passes tech budget", "Estonia and Finland plan new power cable"].map((t, i) => ({ title: t, url: `https://example.com/ee${i}`, source: "ERR News", published_at: ago(6 + i) })),
  ...["Brazil hosts climate talks", "India launches weather satellite", "Kenya opens new rail line", "Australia bushfire season starts early", "Germany's coalition agrees budget"].map((t, i) => ({ title: t, url: `https://example.com/w${i}`, source: "DW World", published_at: ago(3 + i) })),
];
const GEO = { hours: 72, total: GEO_ARTS.length, ...hotspots(GEO_ARTS) };

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
try {
  const RUNS = [["desktop", { width: 1440, height: 900 }, true], ["laptop", { width: 1280, height: 760 }, true], ["phone", { width: 390, height: 844 }, true], ["desktop-simple", { width: 1440, height: 900 }, false]];
  if (TAG !== "before") RUNS.push(["desktop-weather", { width: 1440, height: 900 }, true], ["laptop-weather", { width: 1280, height: 720 }, true], ["phone-weather", { width: 390, height: 844 }, true], ["small-weather", { width: 800, height: 600 }, true]);
  for (const [name, vp, manual] of RUNS) {
    const weather = name.endsWith("-weather"); // the news weather layer (#746, ORBIT_UI_MOTION) vs the classic globe
    const ctx = await browser.newContext({ viewport: vp, reducedMotion: "reduce", deviceScaleFactor: 1 });
    const page = await ctx.newPage(), posts = [];
    page.setDefaultTimeout(120_000);
    await page.addInitScript((m) => { try { localStorage.setItem("orbit.lang", "en"); localStorage.setItem("orbit.manual.intelligence", m[0] ? "1" : "0"); localStorage.setItem("orbit.newsWeather.view", m[1] ? "weather" : "classic"); } catch {} }, [manual, weather]);
    page.on("pageerror", (e) => console.log("pageerror", e.message));
    await ctx.route(`${ORIGIN}/**`, async (route) => {
      const r = route.request(), u = new URL(r.url()), p = u.pathname;
      if (p === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html data-motion="on"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>` });
      if (p === "/app.css") return route.fulfill({ contentType: "text/css", body: css + "\n" + moduleCss });
      if (p === "/app.js") return route.fulfill({ contentType: "text/javascript", body: appJs });
      if (r.method() !== "GET") { posts.push({ p, body: r.postDataJSON?.() }); return route.fulfill({ json: { ok: true } }); }
      const J = { "/api/briefings": BRIEFINGS, "/api/feeds": FEEDS, "/api/news/intel": INTEL, "/api/news/geo": GEO, "/api/needs-you": { items: [] },
        "/api/news/follows": { topics: [{ name: "Estonia", at: NOW, items: [{ title: "Estonia passes tech budget", url: "https://example.com/ee0", source: "ERR News", published_at: ago(6), new: true }] }] },
        "/api/watches": { watches: [], changes: [] } }[p];
      if (J) return route.fulfill({ json: J });
      return route.fulfill({ status: 404, json: { error: "not in harness" } });
    });
    await page.goto(`${ORIGIN}/`);
    await page.waitForTimeout(9000); // swiftshader: the globe's first frames are slow
    await page.screenshot({ path: `${OUT}/${TAG}-${name}.png` });
    let text = await page.locator("aside.drawer").innerText();
    check(!/\d+\s*ms\)|fact check \d+ backed/i.test(text), `${TAG}-${name}: no debug numbers in the panel`);
    const research = page.getByRole("tab", { name: "Research" }); // before: the briefing text lives in the Research tab
    if (manual && await research.count()) { await research.click(); await page.waitForTimeout(600); text = await page.locator("aside.drawer").innerText(); }
    if (name === "desktop") await page.screenshot({ path: `${OUT}/${TAG}-briefing.png`, clip: await page.locator("aside.drawer").boundingBox() });
    check(!/\(not backed by the source\)|\(only one source\)/.test(text), `${TAG}-${name}: no inline trust marks in the briefing text`);
    if (TAG !== "before") { // after: the one surface: briefing first, trust in a popover, actions behind "…", the sheet
      check(await page.getByText("Back to the simple page").count() === 0, `${TAG}-${name}: one page (no simple/advanced switch)`);
      const firstH = await page.locator("aside.drawer h3").first().innerText().catch(() => "");
      check(/for you/i.test(firstH), `${TAG}-${name}: briefing starts with For you (${firstH})`);
      if (name === "desktop") {
        const mark = page.locator("aside.drawer article").filter({ hasText: "Roblox opens" }).getByRole("button", { name: /Show the evidence/ }).first();
        await mark.hover(); await page.waitForTimeout(300);
        check(/did not check out/i.test(await page.locator("aside.drawer").innerText()), `${TAG}: evidence shows on hover`);
        await page.screenshot({ path: `${OUT}/${TAG}-trust-hover.png`, clip: await page.locator("aside.drawer").boundingBox() });
        await page.mouse.move(5, 5);
        const dots = page.locator("aside.drawer article").first().getByRole("button", { name: /^Actions for/ });
        await dots.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(250);
        check(await page.getByRole("menuitem", { name: /^Useful/ }).first().isVisible(), `${TAG}: "…" menu opens from the keyboard`);
        await page.screenshot({ path: `${OUT}/${TAG}-menu.png`, clip: await page.locator("aside.drawer").boundingBox() });
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: /^More: following/ }).click(); await page.waitForTimeout(200);
        await page.getByRole("menuitem", { name: "Following" }).click(); await page.waitForTimeout(600);
        check(await page.getByRole("tab", { name: "Watches" }).isVisible(), `${TAG}: sheet shows Following / Watches / Research / Sources`);
        await page.screenshot({ path: `${OUT}/${TAG}-sheet.png` });
        await page.keyboard.press("Escape"); await page.waitForTimeout(300);
        check(await page.getByRole("button", { name: "New briefing" }).isVisible(), `${TAG}: Esc closes the sheet`);
      }
    }
    if (weather) { // the weather layer's play button, "Classic map" and its forecast stay clear of the panel (and the panel of them)
      const free = await page.evaluate(() => {
        const out = {};
        for (const [k, el] of [["play", [...document.querySelectorAll(".globe-in button")].find((b) => b.style.width && !b.textContent.trim())], ["classic", [...document.querySelectorAll(".globe-in button")].find((b) => /Classic map/.test(b.textContent))]]) {
          if (!el) { out[k] = "missing"; continue; }
          const r = el.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          out[k] = el.contains(top) ? "ok" : `covered by ${top?.className?.toString().slice(0, 40)}`;
        }
        return out;
      });
      check(free.play === "ok", `${TAG}-${name}: weather play button not under the panel (${free.play})`);
      check(free.classic === "ok", `${TAG}-${name}: "Classic map" not under the panel (${free.classic})`);
    } else if (manual || TAG !== "before") {
      const vis = await page.evaluate(() => {
        const free = (sel) => { // three points across the element (both ends and the middle) must be the element itself
          const el = document.querySelector(sel); if (!el) return "missing"; const b = el.getBoundingClientRect(), cy = b.top + b.height / 2;
          for (const x of [b.left + 6, b.left + b.width / 2, b.right - 6]) { const top = document.elementFromPoint(x, cy); if (!el.contains(top)) return `covered by ${top?.className?.toString().slice(0, 40)}`; }
          return b.right > innerWidth + 1 || b.left < -1 ? "off screen" : "ok"; };
        return { search: free(".globe-search"), regions: free(".globe-regions") };
      });
      check(vis.search === "ok", `${TAG}-${name}: search bar reachable (${vis.search})`);
      check(vis.regions === "ok", `${TAG}-${name}: region chips reachable (${vis.regions})`);
    }
    await ctx.close();
  }
} finally { await browser.close(); }
if (fails.length) { console.log(`${fails.length} check(s) failed`); process.exitCode = 1; }
