// A long CORE turn through the real chat UI (README.md here). The fake model waits [slow:N] s, so the turn hits CORE's time limit
// and hands off to a background task. Page A keeps its live stream open the whole time; page B opens CORE fresh after the handoff
// (what a reload or a second device sees). Both must end on the background answer without a manual reload, and no request fails.
const L = require("./lib.cjs");

(async () => {
  const { browser, page } = await L.session();
  const t = L.tag(), q = `[slowfor:290:${t}] core long turn ${t}`;
  const s = () => Math.round((Date.now() - t0) / 1000);
  let t0 = Date.now();
  const failed = [];
  page.on("requestfailed", (r) => { if (r.url().includes("/api/core")) failed.push(`${r.failure()?.errorText} at ${s()} s`); });
  page.on("response", (r) => { if (r.url().includes("/api/core") && r.status() >= 400) failed.push(`HTTP ${r.status()} at ${s()} s`); });

  await page.emulateMedia({ reducedMotion: "reduce" }); // the 3D galaxy in headless software GL starves typing; CORE doesn't depend on it
  // Open CORE through its deep link; a hash-only change after sign-in can be missed, so set it again until the chat is there.
  const openCore = async (p) => { await p.goto(`${L.BASE}/#o=core`); for (let i = 0; i < 3 && !(await p.getByLabel("Message CORE").count()); i++) { await L.sleep(4000); await p.evaluate(() => { location.hash = ""; location.hash = "o=core"; }); } };
  await openCore(page);
  // time-of-day popups (the evening review) sit over the chat; this check is about CORE, so close them like the owner would
  const clear = (p) => p.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
  const box = page.getByLabel("Message CORE").last();
  await box.waitFor({ timeout: 60000 });
  await L.sleep(3000); await clear(page);
  await box.fill(q);
  const send = page.getByRole("button", { name: "Send", exact: true });
  await L.until(async () => !(await send.first().isDisabled().catch(() => true)), 60000);
  t0 = Date.now();
  await L.press(send);

  const handed = await L.until(async () => (await page.getByText("Working on it in the background").count()) > 0, 360000, 2000);
  L.ok("core: the long turn hands off to a background task", !!handed, `${s()} s after Send`);
  const id = L.sql(`select id from tasks where request like '%core long turn ${t}%' order by created_at desc limit 1`);
  L.ok("core: the handoff created its task", /^[0-9a-f-]{36}$/.test(id), id);

  // Page B: a fresh CORE (reload / phone) on the same chat, while the task still runs
  const b = await page.context().newPage();
  await b.emulateMedia({ reducedMotion: "reduce" });
  await openCore(b);
  await b.getByLabel("Message CORE").last().waitFor({ timeout: 60000 });
  await L.sleep(3000); await clear(b);
  await L.until(async () => (await b.getByText("Working on it in the background").count()) > 0, 30000);
  L.ok("reload: the reopened chat shows the running handoff", (await b.getByText("Working on it in the background").count()) > 0, `task ${L.task(id).status}`);

  const done = await L.until(() => ["done", "failed", "cancelled"].includes(L.task(id).status), 900000, 3000);
  L.ok("core: the background task finished", L.task(id).status === "done", `${L.task(id).status} at ${s()} s ${L.task(id).error.slice(0, 80)}`);
  const answer = done && L.sql(`select content from messages where role='assistant' order by created_at desc limit 1`);
  const snippet = (answer || "").replace(/[_*]/g, "").slice(0, 24);
  const shownA = await L.until(async () => (await page.getByText(snippet, { exact: false }).count()) > 0, 30000);
  L.ok("stream: page A, which never reloaded, shows the background answer", !!shownA, `answer "${snippet}"`);
  const shownB = await L.until(async () => (await b.getByText(snippet, { exact: false }).count()) > 0, 30000);
  L.ok("reload: page B shows the answer without a manual reload", !!shownB);
  L.ok("stream: no CORE request failed over the whole turn", failed.length === 0 && !(await page.getByText(/network error/i).count()), failed.join("; ") || `${s()} s in total`);
  await browser.close();
  process.exit(L.failures() ? 1 : 0);
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
