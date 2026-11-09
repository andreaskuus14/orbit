// Fixture-only check of the real brief component and its compiled styles.
// node scripts/mobile-brief-ui.mjs (Playwright Chromium or ORBIT_CHROMIUM).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import tailwind from "@tailwindcss/postcss";
import { build } from "esbuild";
import postcss from "postcss";

const { chromium } = createRequire(import.meta.url)("playwright-core");
const origin = "http://orbit.test";
const cssPath = resolve("src/app/globals.css");
const css = (await postcss([tailwind()]).process(await readFile(cssPath, "utf8"), { from: cssPath })).css;
const js = (await build({
  stdin: { contents: `import { createRoot } from "react-dom/client";
import { useState } from "react";
import MorningBriefBody from "@/components/MorningBriefBody";
function Fixture() {
  const [open, setOpen] = useState(false);
  const [task, setTask] = useState("");
  return <><button onClick={() => setOpen(true)}>Open fixture briefing</button>
    {open && <MorningBriefBody home onClose={() => setOpen(false)} onOpenTask={setTask} onOpenGoal={() => {}} />}
    {task && <p role="status">Opened task: {task}</p>}</>;
}
createRoot(document.getElementById("root")).render(<Fixture />);`,
    loader: "tsx", resolveDir: resolve("src") },
  bundle: true, write: false, format: "esm", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
})).outputFiles[0].text;

const title = "Review the synthetic project before the afternoon handoff";
const fixture = {
  day: "2026-11-09", greeting: "Good morning, here is your work", spoken: "", life: false,
  items: [{ id: "fixture-decision", kind: "decision", title, detail: "The full title stays readable.",
    open: { task: "fixture-task" }, approve: { task: "fixture-task" } }],
};
const browser = await chromium.launch({ executablePath: process.env.ORBIT_CHROMIUM });
try {
  for (const [width, textSize] of [[320, 100], [320, 200], [390, 200], [430, 200]]) {
    const page = await browser.newPage({ viewport: { width, height: 760 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
    const failures = [];
    page.on("pageerror", (err) => failures.push(err.message));
    await page.route("**/*", async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>' });
      if (url.pathname === "/app.css") return route.fulfill({ contentType: "text/css", body: css });
      if (url.pathname === "/app.js") return route.fulfill({ contentType: "text/javascript", body: js });
      if (url.pathname === "/api/brief") return route.fulfill({ json: req.method() === "GET" ? fixture : { ok: true } });
      return route.fulfill({ status: 404, json: { error: "No fixture" } });
    });
    await page.goto(origin);
    await page.addStyleTag({ content: `html { font-size: ${textSize}%; }` });
    await page.getByRole("button", { name: "Open fixture briefing" }).tap();
    const dialog = page.getByRole("dialog");
    const item = dialog.getByRole("listitem").filter({ hasText: title });
    await item.waitFor();
    const layout = await dialog.evaluate((sheet) => {
      const inner = sheet.querySelector(".mb-inner");
      const title = sheet.querySelector(".mb-item b");
      return {
        overflow: inner.scrollWidth - inner.clientWidth,
        titleClipped: title.scrollWidth > title.clientWidth || getComputedStyle(title).whiteSpace === "nowrap",
        small: [...sheet.querySelectorAll("button")].filter((button) => {
          const { width, height } = button.getBoundingClientRect();
          return width < 44 || height < 44;
        }).map((button) => button.textContent),
        animation: getComputedStyle(sheet).animationName,
      };
    });
    assert.deepEqual(layout, { overflow: 0, titleClipped: false, small: [], animation: "none" }, `${width}px at ${textSize}% text size`);
    const open = item.getByRole("button", { name: "Open", exact: true });
    if (width === 320) {
      await open.focus();
      await page.keyboard.press("Enter");
    } else await open.tap();
    assert.equal(await page.getByRole("status").filter({ hasText: "Opened task:" }).textContent(), "Opened task: fixture-task");
    assert.equal(await dialog.count(), 0);
    assert.deepEqual(failures, []);
    await page.close();
    console.log(`PASS ${width}px · ${textSize}% text · reduced motion · exact decision target`);
  }
} finally {
  await browser.close();
}
