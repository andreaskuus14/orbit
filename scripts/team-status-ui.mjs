// node --experimental-strip-types scripts/team-status-ui.mjs — browser check of Mission Control (OPERATIONS → Team).
// Bundles the real TeamStatusView (esbuild) with the app's own CSS (globals.css through Tailwind), serves it on a fake origin
// through Playwright routes, and answers /api/team-status from the REAL teamBoard() over the sample board, in three states:
// live, sample (board not connected) and a failed load. Desktop and phone. No server, no sign-in, no network.
// Exits 1 on any failed check. Screenshots: TS_OUT (default ./smoke-shots/team-status).
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { teamBoard } from "../src/lib/team-status-pure.ts";
import { SAMPLE_BOARD } from "../src/lib/team-status-sample.ts";

const req = createRequire(import.meta.url);
const { chromium } = (() => { try { return req("playwright"); } catch { return req("playwright-core"); } })();
const OUT = resolve(process.env.TS_OUT || "smoke-shots/team-status");
mkdirSync(OUT, { recursive: true });
const ORIGIN = "http://orbit.test";
const fails = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails.push(what); };

const css = (await postcss([tailwind()]).process(readFileSync("src/app/globals.css", "utf8"), { from: resolve("src/app/globals.css") })).css;
const js = (await build({
  stdin: { contents: `import { createRoot } from "react-dom/client";
import { TeamStatusView } from "@/components/TeamStatusView";
createRoot(document.getElementById("root")).render(<div className="panel-body" style={{ padding: "1rem", maxWidth: "1280px", margin: "0 auto" }}><TeamStatusView /></div>);`,
    loader: "tsx", resolveDir: resolve("src") },
  bundle: true, write: false, format: "esm", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "error",
})).outputFiles[0].text;

const board = teamBoard(SAMPLE_BOARD, "andreaskuus14/orbit");
const SCENES = {
  live: { status: 200, body: { live: true, at: "2026-11-07T16:30:00.000Z", board } },
  sample: { status: 200, body: { live: false, reason: "not connected: set ORBIT_NOTION_TOKEN and ORBIT_TEAM_BOARD in .env.local", board } },
  failure: { status: 500, body: { error: "boom" } },
};
const SIZES = { desktop: { width: 1280, height: 900 }, phone: { width: 375, height: 812 } };

const browser = await chromium.launch();
try {
  for (const [name, sc] of Object.entries(SCENES)) for (const [size, viewport] of Object.entries(SIZES)) {
    if (name === "failure" && size === "phone") continue;
    const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
    const page = await ctx.newPage(), errors = [];
    let refreshed = 0;
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => { try { localStorage.setItem("orbit.lang", "en"); } catch {} });
    await ctx.route(`${ORIGIN}/**`, async (route) => {
      const u = new URL(route.request().url()), p = u.pathname;
      if (p === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"><body><div id="root"></div><script type="module" src="/app.js"></script>` });
      if (p === "/app.js") return route.fulfill({ contentType: "text/javascript", body: js });
      if (p === "/app.css") return route.fulfill({ contentType: "text/css", body: css });
      if (p === "/api/team-status") { if (u.searchParams.get("refresh") === "1") refreshed++; return route.fulfill({ status: sc.status, json: sc.body }); }
      return route.fulfill({ status: 404, json: { error: "not in harness" } });
    });
    const t0 = Date.now();
    await page.goto(`${ORIGIN}/`);
    await page.getByRole("heading", { name: "Mission Control" }).waitFor({ timeout: 10_000 });
    if (name !== "failure") await page.getByRole("region", { name: "Needs you" }).waitFor({ timeout: 10_000 });
    const ready = Date.now() - t0;
    await page.waitForTimeout(300);
    const text = await page.locator("body").innerText();
    await page.screenshot({ path: `${OUT}/${name}-${size}.png`, fullPage: true });
    const tag = `${name}/${size}`;
    check(!errors.length, `${tag}: no page errors ${errors.join(" | ")}`);
    if (name === "failure") { check(/Couldn't load the team board/.test(text), `${tag}: a failed load says so`); await ctx.close(); continue; }

    check(ready < 10_000, `${tag}: the four sections are on screen in ${ready} ms`);
    const heads = await page.locator("h4").allInnerTexts();
    const seen = (await page.locator("section[aria-label] > h4").evaluateAll((hs) => hs.map((h) => [h.getBoundingClientRect().top, h.getBoundingClientRect().left, h.textContent])))
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2].replace(/\s*·.*$/, "").toLowerCase());
    const want = size === "phone" ? ["needs you", "blocked", "working", "done"] : ["done", "working", "blocked", "needs you"];
    check(JSON.stringify(seen) === JSON.stringify(want), `${tag}: on screen in order ${want.join(", ")} (${seen.join(" / ")})`);
    if (size === "phone") { const box = await page.getByRole("region", { name: "Needs you" }).boundingBox(); check(box && box.y < viewport.height, `${tag}: Needs you starts on the first screen (y=${Math.round(box?.y ?? -1)})`); }
    for (const [s, label] of [["done", "Done"], ["working", "Working"], ["blocked", "Blocked"], ["needs", "Needs you"]])
      check(heads.some((h) => h.toLowerCase().startsWith(label.toLowerCase()) && h.endsWith(`· ${board[s].length}`)), `${tag}: ${label} shows its count (${board[s].length})`);
    const needs = page.getByRole("region", { name: "Needs you" });
    check(/Agent 7/.test(await needs.innerText()) && /Next: Andreas, merge decision on #426/.test(await needs.innerText()), `${tag}: Needs you names the agent and the decision`);
    check(/Blocked by: no GitHub API here/.test(await page.getByRole("region", { name: "Blocked" }).innerText()), `${tag}: Blocked says what blocks it`);
    const done = await page.getByRole("region", { name: "Done" }).innerText();
    check(/Merged/.test(done) && /Test passed/.test(done) && !/Deployed/.test(text), `${tag}: Merged and Test passed are told apart; nothing claims Deployed`);
    check(await page.locator('a[href="https://github.com/andreaskuus14/orbit/pull/427"]').count() === 1, `${tag}: PR link`);
    check(await page.locator('a[href^="https://github.com/andreaskuus14/orbit/actions/runs/"]').count() >= 1, `${tag}: test-run link`);
    check(/2 updates/.test(text), `${tag}: grouped updates are counted`);
    check(name === "live" ? /Live from the handoff board/.test(text) && !/Sample board/.test(text) : /Sample board: live status unavailable \(not connected: set ORBIT_NOTION_TOKEN/.test(text), `${tag}: ${name === "live" ? "live label" : "sample is labelled, with the reason"}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(overflow <= 0, `${tag}: no sideways scroll (${overflow}px)`);
    if (size === "desktop") {
      const tops = await page.locator("section[aria-label] > h4").evaluateAll((hs) => hs.map((h) => Math.round(h.getBoundingClientRect().top)));
      check(new Set(tops).size === 1, `${tag}: all four sections side by side (tops ${tops.join(",")})`);
    }
    await page.getByRole("button", { name: "Refresh" }).click();
    await page.waitForTimeout(200);
    check(refreshed === 1, `${tag}: Refresh re-reads the board`);
    await ctx.close();
  }
} finally { await browser.close(); }
console.log(fails.length ? `\n${fails.length} check(s) failed` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
