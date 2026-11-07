// node --experimental-strip-types scripts/selfdev-ui.mjs — browser check of DEV → Doctor's Self-development card.
// Bundles the real SelfDevCard (esbuild), serves it on a fake origin through Playwright routes, and answers /api/selfdev with
// the REAL files a supervisor and builder wrote (SELFDEV_SUP_HOME, SELFDEV_BLD_HOME, e.g. from a drill), or "not installed".
// Checks: states and stage labels match the files, the diff opens, and the buttons send only pause/stop.
// No server, no sign-in. Exits 1 on any failed check. Screenshots: SD_OUT (default ./smoke-shots/selfdev).
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const req = createRequire(import.meta.url);
const { chromium } = (() => { try { return req("playwright"); } catch { return req("playwright-core"); } })();
const OUT = resolve(process.env.SD_OUT || "smoke-shots/selfdev");
mkdirSync(OUT, { recursive: true });
const SUP = process.env.SELFDEV_SUP_HOME, BLD = process.env.SELFDEV_BLD_HOME;
const ORIGIN = "http://orbit.test";
const fails = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails.push(what); };
const json = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };

const js = (await build({
  stdin: { contents: `import { createRoot } from "react-dom/client";
import { SelfDevCard } from "@/components/SelfDevCard";
createRoot(document.getElementById("root")).render(<SelfDevCard />);`, loader: "tsx", resolveDir: resolve("src") },
  bundle: true, write: false, format: "esm", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "error",
})).outputFiles[0].text;

const sup = SUP ? json(join(SUP, "public", "status.json")) : null;
const st = BLD ? json(join(BLD, "state.json")) : null;
const real = { installed: { supervisor: !!SUP, builder: !!BLD }, supervisor: sup,
  builder: st && { task: st.task, history: st.history.slice(0, 20), decisions: st.decisions.slice(0, 10), attempts: st.attempts, day: st.day } };

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
async function scene(name, body) {
  const page = await browser.newPage({ viewport: { width: 520, height: 1400 } });
  const posts = [];
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(`${ORIGIN}/**`, async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body style="background:#0b0d12;color:#e6e6e6;font:14px system-ui"><div id="root"></div><script type="module" src="/app.js"></script></body></html>` });
    if (u.pathname === "/app.js") return route.fulfill({ contentType: "text/javascript", body: js });
    if (u.pathname === "/api/selfdev" && route.request().method() === "POST") { posts.push(JSON.parse(route.request().postData() || "{}")); return route.fulfill({ json: { ok: true } }); }
    if (u.pathname === "/api/selfdev" && u.searchParams.get("diff")) {
      const f = join(SUP, "public", "diffs", `${u.searchParams.get("diff")}.patch`);
      try { return route.fulfill({ contentType: "text/plain", body: readFileSync(f, "utf8") }); } catch { return route.fulfill({ status: 404, body: "" }); }
    }
    if (u.pathname === "/api/selfdev" && u.searchParams.get("shot")) {
      try { return route.fulfill({ contentType: "image/png", body: readFileSync(join(BLD, "evidence", u.searchParams.get("task"), u.searchParams.get("shot"))) }); } catch { return route.fulfill({ status: 404, body: "" }); }
    }
    if (u.pathname === "/api/selfdev") return route.fulfill({ json: body });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto(ORIGIN + "/");
  await page.waitForSelector("section[aria-label='Self-development']", { timeout: 10_000 }).catch(() => {});
  return { page, posts, errors, shot: (n) => page.screenshot({ path: join(OUT, `${name}-${n}.png`), fullPage: true }) };
}

{ // not installed: says so plainly, no controls
  const s = await scene("not-installed", { installed: { supervisor: false, builder: false }, supervisor: null, builder: null });
  check(await s.page.getByText("aren't installed on this PC").isVisible(), "not installed: says so");
  check(!(await s.page.getByRole("button", { name: "Emergency stop" }).count()), "not installed: no controls");
  await s.shot("view"); await s.page.close();
}

if (sup) {
  const s = await scene("real", real);
  await s.page.waitForTimeout(300);
  const text = await s.page.locator("section").innerText();
  const want = sup.stopped ? "Emergency stop is on" : sup.halted ? "Halted:" : sup.paused ? "Paused" : sup.blocked ? "Waiting:" : "Running";
  check(text.includes(want), `state line shows "${want}"`);
  if (sup.released) check(text.includes(sup.released.commit.slice(0, 7)), "running release commit shown");
  const stages = { retained: "verified after deployment", rolledBack: "rolled back", rejected: "rejected", halted: "halted" };
  for (const r of sup.history.slice(0, 10)) if (stages[r.step]) check(text.includes(stages[r.step]), `release ${r.id}: "${stages[r.step]}"`);
  check(!text.includes("verified after deployment") || sup.history.some((r) => r.step === "retained"), "never claims verified without a kept release");
  check(text.includes(`${sup.audit.count} entries`) && text.includes(sup.audit.ok ? "chain intact" : "chain BROKEN"), "audit state shown");
  await s.shot("view");
  const diffBtn = s.page.getByRole("button", { name: "Show diff" }).first();
  if (await diffBtn.count()) { await diffBtn.click(); await s.page.waitForSelector("pre"); check((await s.page.locator("pre").first().innerText()).includes("diff --git"), "diff opens with the real patch"); await s.shot("diff"); }
  for (const name of ["Pause", "Emergency stop"]) { const b = s.page.getByRole("button", { name }); if (await b.isEnabled()) await b.click(); }
  await s.page.waitForTimeout(300);
  check(!(await s.page.getByRole("button", { name: /restore|approve/i }).count()), "no restore or approve button in the app (owner-only, on the PC)");
  check((s.posts.length > 0 || (sup.paused && sup.stopped)) && s.posts.every((p) => ["pause", "stop"].includes(p.action)), `controls send only pause/stop; disabled when already paused and stopped (${s.posts.map((p) => p.action).join(", ") || "none enabled"})`);
  check(!s.errors.length, `no page errors${s.errors.length ? `: ${s.errors.join(" | ")}` : ""}`);
  await s.page.close();
}
await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nall checks passed", `— screenshots in ${OUT}`);
process.exit(fails.length ? 1 : 0);
