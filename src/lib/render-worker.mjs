// The web ladder's browser rung (web-ladder.ts) in its own process: headless Chromium via browser.ts renderPage (cookie-less
// profile, every request and redirect host-checked against private/loopback addresses). A crash or hang here never takes the Next
// server down: the parent times out the request and forks a fresh worker. Messages: {id, url, ua} → {id, page} | {id, unavailable}.
import path from "node:path";
import { pathToFileURL } from "node:url";

const { renderPage, hasBrowser } = await import(pathToFileURL(path.join(process.cwd(), "src/lib/browser.ts")).href);
let ready = null; // one launch check for the worker's life (browser.ts keeps the browser warm and closes it when idle)

process.on("message", async (m) => {
  if (!m || typeof m.id !== "number" || typeof m.url !== "string") return;
  try {
    ready ??= hasBrowser();
    if (!(await ready)) { ready = null; process.send?.({ id: m.id, unavailable: "no Chrome, Edge or Playwright Chromium found" }); return; }
    process.send?.({ id: m.id, page: await renderPage(m.url, String(m.ua || "")) });
  } catch (e) {
    process.send?.({ id: m.id, page: null, error: String(e instanceof Error ? e.message : e).slice(0, 200) });
  }
});
process.on("disconnect", () => process.exit(0)); // the server went away: don't linger
