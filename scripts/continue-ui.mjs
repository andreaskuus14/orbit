// node --no-warnings --experimental-strip-types scripts/continue-ui.mjs — browser check of "Continue my work" in the real components.
// Bundles ContinueWork + OperationsPanel (esbuild), serves them on a fake origin through Playwright routes, and answers
// /api/continue with the REAL continueWork output (work-continuation-pure) for: a failed task with its reason and date, two
// scorecard evaluations (explicit origin and a legacy exact-case row), a "running" row with no live worker, a running task with
// a live worker, a queued task, and an older failed automation run superseded by a newer success. Then clicks "Review issue"
// and checks the real TaskView opened that task and shows its evidence. No server, no sign-in, no network. Exits 1 on any
// failed check. Screenshots: CW_OUT (default ./smoke-shots/continue-work).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { continueWork } from "../src/lib/work-continuation-pure.ts";
import { REPLAY_CASES } from "../evals/agent-replay-cases.ts";

const req = createRequire(import.meta.url);
const { chromium } = (() => { try { return req("playwright"); } catch { return req("playwright-core"); } })();
const OUT = resolve(process.env.CW_OUT || "smoke-shots/continue-work");
mkdirSync(OUT, { recursive: true });
const ORIGIN = "http://orbit.test";
const fails = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails.push(what); };

const js = (await build({
  stdin: { contents: `import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ContinueWork } from "@/components/ContinueWork";
import { OperationsPanel } from "@/components/AgentsPanels";
function H() {
  const [focus, setFocus] = useState(null);
  return <><ContinueWork onOpenTask={(id) => { window.__opened = id; setFocus(id); }} onOpenGoal={() => {}} />
    {focus && <div id="ops"><OperationsPanel focusTask={focus} openMemory={() => {}} /></div>}</>;
}
createRoot(document.getElementById("root")).render(<H />);`, loader: "tsx", resolveDir: resolve("src") },
  bundle: true, write: false, format: "esm", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "error",
})).outputFiles[0].text;

const sc = REPLAY_CASES[0];
const tasks = [
  { id: "f1", title: "Research Tallinn cafés", status: "failed", created_at: "2026-11-03T08:00:00Z", started_at: "2026-11-03T08:01:00Z", error: "Claude usage limit reached until 14:00" },
  { id: "e1", title: "Scorecard: anything", status: "failed", created_at: "2026-11-05T10:00:00Z", origin: "scorecard", error: "rubric failed" },
  { id: "e2", title: `Scorecard: ${sc.title}`, request: sc.request, agent: sc.agent, status: "failed", created_at: "2026-11-05T10:05:00Z", error: "rubric failed" },
  { id: "g1", title: "Draft newsletter", status: "running", created_at: "2026-11-02T09:00:00Z", started_at: "2026-11-02T09:00:00Z", exec: "unknown" },
  { id: "l1", title: "Build demo site", status: "running", created_at: "2026-11-01T09:00:00Z", started_at: "2026-11-01T09:00:00Z", exec: "active" },
  { id: "q1", title: "Summarise inbox", status: "queued", created_at: "2026-11-06T09:00:00Z" },
  { id: "b1", title: "⚙ Morning Brief", status: "failed", created_at: "2026-11-04T07:30:00Z", started_at: "2026-11-04T07:30:00Z", automation_id: "a1", error: "all feeds timed out" },
];
const summary = continueWork(tasks, [], [], REPLAY_CASES, { a1: "2026-11-06T07:30:00Z" });
// pending and trace are `not null default []` in the schema (0003), so never null here
const f1 = { id: "f1", parent_id: null, project_id: null, agent: "atlas", title: "Research Tallinn cafés", request: "Find five quiet cafés in Tallinn to work from", status: "failed",
  result: null, error: "Claude usage limit reached until 14:00", trace: [], pending: [], created_at: "2026-11-03T08:00:00Z", started_at: "2026-11-03T08:01:00Z", finished_at: "2026-11-03T08:03:00Z" };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
const asked = [];
page.on("pageerror", (e) => check(false, `no page error (${e.message.slice(0, 120)})`));
await page.route(`${ORIGIN}/**`, (route) => {
  const u = new URL(route.request().url());
  asked.push(u.pathname);
  const json = (b) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
  if (u.pathname === "/") return route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="/app.js"></script>` });
  if (u.pathname === "/app.js") return route.fulfill({ status: 200, contentType: "text/javascript", body: js });
  if (u.pathname === "/api/continue") return json(summary);
  if (u.pathname === "/api/tasks/f1") return json({ task: f1, children: [] });
  if (u.pathname === "/api/tasks") return json({ tasks: [f1] });
  if (u.pathname === "/api/projects") return json({ projects: [] });
  if (u.pathname === "/api/agents") return json({ agents: [], tools: [] });
  return json({});
});
await page.goto(`${ORIGIN}/`);
const card = page.locator("section.continue-work");
await card.locator("li").first().waitFor({ timeout: 10_000 });
const text = await card.innerText();
await page.screenshot({ path: `${OUT}/card.png`, fullPage: true });

check(/Failed Tue 3 Nov: Claude usage limit reached until 14:00/.test(text), "failed task shows its reason and attempt date");
check(/→ Wait until Claude's limit resets, then Retry/.test(text), "failed task shows a fitting next step");
check(!/Scorecard/.test(text), "evaluation tasks (explicit origin and legacy exact case) are not in the personal inbox");
const ghost = card.locator("li", { hasText: "Draft newsletter" });
const ghostText = await ghost.innerText();
check(/Needs attention/.test(ghostText) && !/In progress|Agent is working/.test(ghostText), "a running row with no live worker is not shown as active");
check(/no worker in ORBIT is running it now/.test(ghostText), "…and says why");
const live = await card.locator("li", { hasText: "Build demo site" }).innerText();
check(/In progress/.test(live) && /Agent is working on it now/.test(live), "a long task with a live worker is still shown as working (not failed by age)");
check(/Waiting for an agent slot/.test(await card.locator("li", { hasText: "Summarise inbox" }).innerText()), "queued task shown as queued");
const brief = await card.locator("li", { hasText: "Morning Brief" }).innerText();
check(/Earlier attempt \(Wed 4 Nov\): all feeds timed out\. A newer run succeeded Fri 6 Nov\./.test(brief), "older failed brief run reads as an earlier attempt next to the newer success");
check(/Nothing to redo/.test(brief), "…kept for inspection without asking for a redo");
check((await card.locator("li").count()) === 5, "five items: the two evaluations are excluded, nothing else");

await page.getByRole("button", { name: "Review issue: Research Tallinn cafés" }).click();
await page.locator("#ops").getByText("Claude usage limit reached until 14:00").first().waitFor({ timeout: 10_000 });
await page.locator("#ops summary", { hasText: "Request" }).click(); // the request sits in a collapsed section
const ops = await page.locator("#ops").innerText();
await page.screenshot({ path: `${OUT}/review-issue.png`, fullPage: true });
check(await page.evaluate(() => window.__opened) === "f1", "Review issue opens the right task id");
check(asked.includes("/api/tasks/f1"), "TaskView loaded that task's record");
check(/Research Tallinn cafés/.test(ops) && /Find five quiet cafés in Tallinn/.test(ops), "TaskView shows that task and its request");
check(/Unresolved[\s\S]*Claude usage limit reached until 14:00/.test(ops) && /Failure report/.test(ops), "…with its stored failure evidence and recovery options");

await browser.close();
console.log(fails.length ? `\n${fails.length} check(s) failed` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
