// Fixture-only browser check of the real scripted runner.
// node scripts/perf-run-ui.mjs (Playwright Chromium or ORBIT_CHROMIUM).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";

const { chromium } = createRequire(import.meta.url)("playwright-core");
const origin = "http://orbit.test";
const js = (await build({
  stdin: { contents: `import { createRoot } from "react-dom/client";
import PerfRun from "@/components/PerfRun";
import { perfMark } from "@/components/PerfBeacon";
window.drawFixtureGalaxy = () => perfMark("galaxy-drawn");
createRoot(document.getElementById("root")).render(<PerfRun />);`,
    loader: "tsx", resolveDir: resolve("src") },
  bundle: true, write: false, format: "esm", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
})).outputFiles[0].text;

const browser = await chromium.launch({ executablePath: process.env.ORBIT_CHROMIUM });
try {
  for (const { view, hidden } of [{ view: "2d", hidden: false }, { view: "3d", hidden: false }, { view: "2d", hidden: true }]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 760 } });
    await page.clock.install();
    await page.addInitScript((hidden) => {
      Object.defineProperty(document, "hidden", { value: hidden });
    }, hidden);
    const posts = [];
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
      const { origin: requestOrigin, pathname } = new URL(route.request().url());
      if (requestOrigin !== origin) return route.abort();
      if (pathname === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><main class="orbit-shell" data-view="${view}"><div id="root"></div></main><script type="module" src="/app.js"></script>` });
      if (pathname === "/app.js") return route.fulfill({ contentType: "text/javascript", body: js });
      if (pathname === "/api/perf/run" && route.request().method() === "POST") {
        posts.push(route.request().postDataJSON());
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({ status: 404, json: { error: "No fixture" } });
    });
    await page.goto(origin + "/?perfrun=1");
    const status = page.getByRole("status");
    await status.waitFor();
    await page.clock.runFor(500);
    if (view === "3d") {
      assert.match(await status.textContent(), /waiting for the galaxy/);
      await page.evaluate(() => window.drawFixtureGalaxy());
      await page.clock.runFor(200);
    }
    assert.equal(await status.textContent(), "Perf run: intro", `${view} starts as soon as its view is ready`);
    const posted = page.waitForResponse((response) => response.url() === origin + "/api/perf/run");
    await page.clock.runFor(70_000);
    await posted;
    assert.equal(posts.length, 1);
    assert.equal(posts[0].hidden, hidden);
    assert.equal(posts[0].segments.some((segment) => segment.seg === "studio"), true);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS ${view} · initially ${hidden ? "hidden" : "visible"} · one complete run`);
  }
} finally {
  await browser.close();
}
