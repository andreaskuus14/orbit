// node --experimental-strip-types scripts/watch-brief-ui.mjs — browser check of the page-watch evidence in the real UI components.
// Bundles MorningBriefBody + WatchesSection (esbuild), serves them on a fake origin through Playwright routes, and answers
// /api/brief with the REAL composeBrief output (brief-pure) for three states: populated, empty, and watcher failure/unreadable.
// No server, no sign-in, no network. Exits 1 on any failed check. Screenshots: WB_OUT (default ./smoke-shots/watch-brief).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { composeBrief } from "../src/lib/brief-pure.ts";

const req = createRequire(import.meta.url);
const { chromium } = (() => { try { return req("playwright"); } catch { return req("playwright-core"); } })();
const OUT = resolve(process.env.WB_OUT || "smoke-shots/watch-brief");
mkdirSync(OUT, { recursive: true });
const ORIGIN = "http://orbit.test";
const fails = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails.push(what); };

const js = (await build({
  stdin: { contents: `import { createRoot } from "react-dom/client";
import MorningBriefBody from "@/components/MorningBriefBody";
import { WatchesSection } from "@/components/WatchesSection";
const n = () => {};
createRoot(document.getElementById("root")).render(<><MorningBriefBody home onOpenTask={n} onOpenGoal={n} onClose={n} /><WatchesSection /></>);`,
    loader: "tsx", resolveDir: resolve("src") },
  bundle: true, write: false, format: "esm", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "error",
})).outputFiles[0].text;

const day = "2026-11-06", base = { day, hour: 7, life: false, morning: {}, decisions: [], replies: [], snoozed: [] };
const ago = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const SCENES = {
  populated: {
    brief: composeBrief({ ...base, watch: { more: 1,
      changes: [{ id: "c1", url: "https://jobs.example/roles", label: "Studio jobs page", at: ago(3), what: "+ Junior level designer (Tallinn) (+2 lines)", n: 2 }],
      failed: [{ id: "w3", label: "Uni deadlines", url: "https://uni.example/dates", error: "timed out" }] } }),
    watches: { status: 200, body: { week: { useful: 1, noise: 0, unmarked: 1, missed: 0, checks: 14, failedChecks: 3 },
      watches: [{ id: "w1", url: "https://jobs.example/roles", focus: "", everyH: 24, purpose: "Studio jobs page", important: false, created: ago(48), lastChecked: ago(3), lastChanged: ago(3), versions: 2 },
        { id: "w3", url: "https://uni.example/dates", focus: "", everyH: 24, purpose: "Uni deadlines", important: false, created: ago(48), lastChecked: ago(1), lastError: "timed out", failed: true, versions: 1 }],
      changes: [{ id: "c1", watch: "w1", at: ago(3), added: ["Junior level designer (Tallinn)"], removed: [], purpose: "Studio jobs page", url: "https://jobs.example/roles" },
        { id: "c0", watch: "w1", at: ago(20), added: ["Applications open"], removed: [], reverted: ago(44), purpose: "Studio jobs page", url: "https://jobs.example/roles" }] } },
  },
  empty: { brief: composeBrief(base), watches: { status: 200, body: { watches: [], changes: [], week: { useful: 0, noise: 0, unmarked: 0, missed: 0, checks: 0, failedChecks: 0 } } } },
  failure: { brief: composeBrief({ ...base, watch: { changes: [], more: 0, failed: [], unreadable: true } }), watches: { status: 500, body: { error: "Couldn't read the watches" } } },
};

const browser = await chromium.launch();
try {
  for (const [name, sc] of Object.entries(SCENES)) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: "reduce" });
    const page = await ctx.newPage(), posts = [], opened = [];
    await page.addInitScript(() => { window.open = (u) => { (window.__opened ??= []).push(u); return null; }; try { localStorage.setItem("orbit.lang", "en"); } catch {} });
    await ctx.route(`${ORIGIN}/**`, async (route) => {
      const r = route.request(), p = new URL(r.url()).pathname;
      if (p === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="/app.js"></script>` });
      if (p === "/app.js") return route.fulfill({ contentType: "text/javascript", body: js });
      if (p === "/api/brief" && r.method() === "GET") return route.fulfill({ json: { ...sc.brief, life: false } });
      if (p === "/api/watches" && r.method() === "GET") return route.fulfill({ status: sc.watches.status, json: sc.watches.body });
      if (r.method() === "POST") { posts.push({ p, body: r.postDataJSON() }); return route.fulfill({ json: { ok: true } }); }
      return route.fulfill({ status: 404, json: { error: "not in harness" } });
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${ORIGIN}/`);
    await page.waitForTimeout(800);
    const text = await page.locator("body").innerText();
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    check(!errors.length, `${name}: no page errors ${errors.join(" | ")}`);

    if (name === "populated") {
      check(/Page changed: Studio jobs page/.test(text), "populated: change card shown");
      check(/\+ Junior level designer \(Tallinn\) \(\+2 lines\) · detected \w{3},? \d\d:\d\d · jobs\.example · changed 2× today · \+1 more in Watches/.test(text), "populated: card has what changed, detection time, source host");
      check(/Watch check failed: Uni deadlines/.test(text) && /timed out · uni\.example/.test(text), "populated: failed watch says check failed");
      const card = page.locator("li", { hasText: "Page changed: Studio jobs page" });
      await card.getByRole("button", { name: /open/i }).click();
      opened.push(...await page.evaluate(() => window.__opened ?? []));
      check(opened.includes("https://jobs.example/roles"), "populated: Open goes to the source page");
      check(await page.locator('a[href="https://jobs.example/roles"]').count() > 0, "populated: Watches list links the source");
      check(/reverted to the version from /.test(text), "populated: a return to an earlier version is labelled, not hidden");
      check(/Last 7 days: 1 useful · 0 noise · 1 unmarked · 0 missed · 3\/14 checks failed/.test(text), "populated: weekly review counts shown");
      await page.locator("li", { hasText: "Junior level designer" }).getByRole("button", { name: "Useful", exact: true }).click();
      await page.waitForTimeout(200);
      check(posts.some((x) => x.p === "/api/watches" && x.body.action === "verdict" && x.body.id === "c1" && x.body.verdict === "useful"), "populated: Useful posts a verdict");
    }
    if (name === "empty") {
      check(!/Page changed|Watch check failed|couldn't be read/.test(text), "empty: no watch items invented");
      check(/No watches yet/.test(text), "empty: Watches says there are none");
    }
    if (name === "failure") {
      check(/Page watches couldn't be read/.test(text) && /Changes are unknown, not zero/.test(text), "failure: brief says watches unreadable, not 'nothing changed'");
      check(/Couldn't read the watches/.test(text), "failure: Watches panel shows the error");
    }
    await ctx.close();
  }
} finally { await browser.close(); }
console.log(fails.length ? `\n${fails.length} check(s) failed` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
