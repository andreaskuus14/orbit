// node --no-warnings --experimental-strip-types scripts/core-chat-ui.mjs — browser check + timing of the CORE chat in the real component.
// Bundles CorePanel (esbuild) and the real globals.css (Tailwind), serves them from a tiny local server that also fakes the APIs, and
// streams a scripted CORE answer (NDJSON, first token after FIRST_MS, then a delta every 15 ms with code, a table and a list).
// Measures: time to first token on screen (minus the fake server's delay = the UI's own overhead), frame times and layout shifts
// while streaming, whether scrolling up during the stream keeps its place, the jump when the final answer replaces the stream,
// and the minified + gzipped size of the chat bundle. Screenshots (desktop + phone) to CHAT_OUT. No sign-in, no network, no model.
// CHAT_ROOT: the ORBIT tree to bundle (default: this one), so the same script measures a before tree too. CHAT_CHECKS=0: measure only.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";
import { build } from "esbuild";

const ROOT = resolve(process.env.CHAT_ROOT || ".");
const OUT = resolve(process.env.CHAT_OUT || "smoke-shots/core-chat");
const CHECKS = process.env.CHAT_CHECKS !== "0";
const FIRST_MS = 600; // the fake server's time to first token
mkdirSync(OUT, { recursive: true });
const req = createRequire(import.meta.url);
const { chromium } = (() => { try { return req("playwright"); } catch { return req("playwright-core"); } })();
const fails = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (CHECKS && !ok) fails.push(what); };

const bundle = await build({
  stdin: { contents: `import { createRoot } from "react-dom/client";
import { CorePanel } from "@/components/${existsSync(resolve(ROOT, "src/components/CoreChat.tsx")) ? "CoreChat" : "panels"}";
// The real drawer markup from Orbit.tsx, so the chat gets the same height and scroll box as in ORBIT.
function H() { return <div className="orbit-shell"><aside className="glass drawer" role="dialog" aria-label="CORE"><div className="min-h-0 flex-1 overflow-y-auto">
  <CorePanel initial={null} onConsumed={() => {}} onOpenMemory={() => {}} /></div></aside></div>; }
createRoot(document.getElementById("root")).render(<H />);`, loader: "tsx", resolveDir: resolve(ROOT, "src") },
  banner: { js: 'globalThis.process ??= { env: { NODE_ENV: "production" } };' },
  bundle: true, write: false, format: "esm", jsx: "automatic", minify: true, metafile: true, logLevel: "error",
  define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_SUPABASE_URL": '""', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '""' },
  plugins: [{ name: "css-modules", setup(b) { b.onLoad({ filter: /\.module\.css$/ }, () => ({ contents: "export default new Proxy({}, { get: (_, k) => String(k) });", loader: "js" })); } }],
  alias: { "next/navigation": resolve(ROOT, "node_modules/next/dist/client/components/navigation.js") },
});
const js = bundle.outputFiles[0].text;
const size = { minKB: +(js.length / 1024).toFixed(1), gzKB: +(gzipSync(js).length / 1024).toFixed(1) };
console.log(`chat bundle: ${size.minKB} KB minified, ${size.gzKB} KB gzipped`);

// The real stylesheet, compiled the way Next does (Tailwind v4 through PostCSS, sources scanned from ROOT).
const rootReq = createRequire(resolve(ROOT, "package.json"));
const postcss = rootReq("postcss");
const tw = rootReq("@tailwindcss/postcss");
const cssPath = resolve(ROOT, "src/app/globals.css");
const css = (await postcss([tw({ base: ROOT })]).process(readFileSync(cssPath, "utf8"), { from: cssPath })).css
  + readFileSync(resolve(ROOT, "src/app/observatory.css"), "utf8");

const CHAT = "11111111-1111-4111-8111-111111111111";
const history = Array.from({ length: 24 }, (_, i) => i % 2 === 0
  ? { role: "user", content: `Question ${i / 2 + 1}: what should I do about the pet sim lag?` }
  : { role: "assistant", content: `Answer ${(i + 1) / 2}. Check the server heartbeat first, then the pet follow loop.\n\n- Profile with the MicroProfiler\n- Batch the remote events\n\nThat usually fixes it.`, citations: [], trace: [] });
const ANSWER = [
  "Hello! Here is the fix for the pet follow loop.\n\n",
  "## What is slow\n\nEvery pet runs its own `Heartbeat` connection, so 40 pets mean 40 callbacks a frame.\n\n",
  "```lua\nlocal RunService = game:GetService(\"RunService\")\nlocal pets = {}\nRunService.Heartbeat:Connect(function(dt)\n  for _, pet in pets do\n    pet:Step(dt)\n  end\nend)\n```\n\n",
  "| Pets | Before | After |\n|---|---|---|\n| 10 | 4 ms | 1 ms |\n| 40 | 17 ms | 3 ms |\n| 100 | 44 ms | 7 ms |\n\n",
  "1. Move every pet into one loop\n2. Skip pets far from the camera\n3. Test with 100 pets\n\n",
  ...Array.from({ length: 14 }, (_, i) => `Step ${i + 1} explained: keep the loop small, cache the CFrame math and only touch parts that moved. `),
  "\n\nThat's it.",
].join("");
const tokens = ANSWER.match(/[\s\S]{1,6}/g);

const send = (res, type, body) => { res.writeHead(200, { "content-type": type }); res.end(body); };
const server = createServer((rq, res) => {
  const u = new URL(rq.url, "http://x");
  const json = (b) => send(res, "application/json", JSON.stringify(b));
  if (u.pathname === "/") return send(res, "text/html", `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><body style="background:#02040b;color:#e6f1ff;margin:0"><div id="root"></div><script type="module" src="/app.js"></script>`);
  if (u.pathname === "/app.js") return send(res, "text/javascript", js);
  if (u.pathname === "/app.css") return send(res, "text/css", css);
  if (u.pathname === "/api/core/chats" && u.searchParams.get("id")) return json({ messages: history });
  if (u.pathname === "/api/core/chats" && u.searchParams.get("q")) return json({ hits: [{ id: CHAT, title: "Pet sim lag", snippet: "…check the server heartbeat first…" }] });
  if (u.pathname === "/api/core/chats") return json({ chats: [{ id: CHAT, title: "Pet sim lag", updated_at: "2026-11-21T08:00:00Z" }, { id: "22222222-2222-4222-8222-222222222222", title: "Shorts ideas for the week", updated_at: "2026-11-20T08:00:00Z" }], projects: [], map: {} });
  if (u.pathname === "/api/core" && rq.method === "POST") {
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    const line = (o) => res.write(JSON.stringify(o) + "\n");
    line({ type: "start", conversationId: CHAT });
    setTimeout(() => line({ type: "step", id: 1, tool: "search_memory", label: "Searching memory…", key: "live.search_memory", t: 100 }), 100);
    setTimeout(() => line({ type: "step_done", id: 1, ok: true, ms: 300, result: "2 notes", t: 400 }), 400);
    let i = 0;
    const tick = () => {
      if (i < tokens.length) { line({ type: "delta", text: tokens[i++] }); return void setTimeout(tick, 15); }
      line({ type: "done", conversationId: CHAT, answer: ANSWER, citations: [], trace: [{ step: "search_memory", detail: "pet", ms: 300, ok: true }], model: "smart" });
      res.end();
    };
    setTimeout(tick, FIRST_MS);
    return;
  }
  if (u.pathname === "/api/insights") return json({ items: [] });
  if (u.pathname === "/api/plans") return json({ plans: [] });
  if (u.pathname === "/api/lessons") return json({ lessons: [] });
  if (u.pathname === "/api/missions") return json({ missions: [] });
  if (u.pathname === "/api/tasks") return json({ tasks: [] });
  return json({});
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch(process.env.CHAT_CHROME ? { executablePath: process.env.CHAT_CHROME } : {});
const results = { size };
async function run(name, viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => check(false, `${name}: no page error (${e.message.slice(0, 140)})`));
  await page.addInitScript((id) => {
    localStorage.setItem("orbit.core.chat", id);
    window.__shifts = 0; window.__frames = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__shifts += e.value; }).observe({ type: "layout-shift", buffered: true });
  }, CHAT);
  await page.goto(ORIGIN + "/");
  await page.getByText("Answer 12.").waitFor({ timeout: 15_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}-history.png` });
  const box = page.locator("[aria-busy]").first();
  const input = page.getByRole("textbox", { name: /message/i });
  await input.fill("Why is my pet sim lagging?");
  // Frame recorder + first-token watcher, started right before the send.
  await page.evaluate(() => {
    window.__t0 = performance.now(); window.__first = 0; window.__shifts = 0;
    const box = document.querySelector("[aria-busy]");
    const mo = new MutationObserver(() => { if (!window.__first && box.textContent.includes("Hello!")) { window.__first = performance.now() - window.__t0; mo.disconnect(); } });
    mo.observe(box, { subtree: true, childList: true, characterData: true });
    let last = performance.now();
    const f = (t) => { window.__frames.push(t - last); last = t; if (!window.__stopFrames) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  await input.press("Enter");
  await page.waitForFunction(() => window.__first > 0, null, { timeout: 15_000 });
  const ttft = await page.evaluate(() => window.__first);
  // Mid-stream: the reader scrolls up; the view must stay where they put it while the answer grows.
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}-streaming.png` });
  await box.evaluate((b) => { b.scrollTop = Math.max(0, b.scrollTop - 400); b.dispatchEvent(new Event("scroll")); });
  const heldAt = await box.evaluate((b) => b.scrollTop);
  await page.waitForTimeout(500);
  const heldAfter = await box.evaluate((b) => b.scrollTop);
  await page.screenshot({ path: `${OUT}/${name}-scrolled-up.png` });
  // Every box around the chat list (the page, the drawer's own scroller) must stay put: scrollIntoView moves them all.
  const outerScroll = await box.evaluate((b) => { let n = 0; for (let e = b.parentElement; e; e = e.parentElement) n += e.scrollTop; return n + document.scrollingElement.scrollTop; });
  // Back to the bottom before the end, so the final swap's jump can be seen.
  await box.evaluate((b) => { b.scrollTop = b.scrollHeight; b.dispatchEvent(new Event("scroll")); });
  await page.getByText("That's it.").last().waitFor({ timeout: 20_000 });
  const beforeDone = await box.evaluate((b) => ({ h: b.scrollHeight, bottom: b.scrollHeight - b.scrollTop - b.clientHeight }));
  await page.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 20_000 });
  await page.waitForTimeout(400);
  const afterDone = await box.evaluate((b) => ({ h: b.scrollHeight, bottom: b.scrollHeight - b.scrollTop - b.clientHeight }));
  const m = await page.evaluate(() => { window.__stopFrames = true; const f = window.__frames.slice(2).sort((a, b) => a - b); return { shifts: window.__shifts, n: f.length, p95: f[Math.floor(f.length * 0.95)] ?? 0, max: f.at(-1) ?? 0, long: f.filter((x) => x > 50).length }; });
  await page.screenshot({ path: `${OUT}/${name}-answer.png` });
  const r = { ttftMs: Math.round(ttft), uiOverheadMs: Math.round(ttft - FIRST_MS), cls: +m.shifts.toFixed(4), frameP95Ms: +m.p95.toFixed(1), frameMaxMs: +m.max.toFixed(1), longFrames: m.long, frames: m.n,
    scrollHeld: Math.abs(heldAfter - heldAt) <= 2, outerPageScrolled: outerScroll, endJumpPx: Math.round(afterDone.bottom - beforeDone.bottom) };
  console.log(name, JSON.stringify(r));
  results[name] = r;
  await page.close();
  return r;
}
const desk = await run("desktop", { width: 1280, height: 900 });
const phone = await run("phone", { width: 390, height: 844 });
check(desk.scrollHeld && phone.scrollHeld, "scrolling up while CORE streams keeps the reader's place");
check(phone.outerPageScrolled === 0 && desk.outerPageScrolled === 0, "streaming never scrolls the page itself (only the chat list)");

// Extras that only the new chat has: search in the chat list, rich blocks (copy button on code, a real table).
if (CHECKS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript((id) => localStorage.setItem("orbit.core.chat", id), CHAT);
  await page.goto(ORIGIN + "/");
  await page.getByText("Answer 12.").waitFor({ timeout: 15_000 });
  const input = page.getByRole("textbox", { name: /message/i });
  await input.fill("show me"); await input.press("Enter");
  await page.waitForFunction(() => !document.querySelector("[aria-busy=true]") && document.body.textContent.includes("That's it."), null, { timeout: 20_000 });
  check(await page.locator("table").count() >= 1, "a markdown table renders as a real table");
  await page.locator("figure.chat-code").last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/desktop-rich-blocks.png` });
  check(await page.getByRole("button", { name: /copy code/i }).count() >= 1, "code blocks have their own Copy button");
  check(await page.getByRole("button", { name: /edit/i }).count() >= 1, "the last question can be edited");
  await page.getByRole("button", { name: /chats/i }).first().click();
  const search = page.getByRole("searchbox");
  await search.fill("heartbeat");
  await page.getByText("check the server heartbeat first").first().waitFor({ timeout: 5000 }).then(() => check(true, "chat search finds text inside chats"), () => check(false, "chat search finds text inside chats"));
  await page.screenshot({ path: `${OUT}/desktop-search.png` });
  await page.close();
}
await browser.close();
server.close();
writeFileSync(`${OUT}/metrics.json`, JSON.stringify(results, null, 2));
console.log(fails.length ? `\n${fails.length} check(s) failed` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
