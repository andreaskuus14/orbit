// B06: the different stops during a live CORE turn (README.md here). Stop before a handoff ends the turn and its model process;
// Stop after a handoff only stops watching (the task runs on); Cancel task ends the background task. Stop-all and a live answer:
// the Stop-all dialog says "CORE chat keeps answering", AGENTS.md says it halts everything — an open decision (#481), reported as INFO.
// (Stop listening needs a microphone; voice stops are covered by the unit tests in tests/voice-*.test.ts.)
const L = require("./lib.cjs");
const t = L.tag();
const openCore = async (p) => { await p.emulateMedia({ reducedMotion: "reduce" }); await p.goto(`${L.BASE}/#o=core`); for (let i = 0; i < 3 && !(await p.getByLabel("Message CORE").count()); i++) { await L.sleep(4000); await p.evaluate(() => { location.hash = ""; location.hash = "o=core"; }); } await L.sleep(2000); await p.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close())); };
const ask = async (p, q) => { const box = p.getByLabel("Message CORE").last(); await box.waitFor({ timeout: 60000 }); await box.fill(q); const send = p.getByRole("button", { name: "Send", exact: true }); await L.until(async () => !(await send.first().isDisabled().catch(() => true)), 30000); await L.press(send); };
const started = (marker) => { try { return require("node:fs").readFileSync(L.FAKE_LOG, "utf8").split("\n").filter((l) => l.includes(" start ") && l.includes(marker)).length; } catch { return 0; } };
const taskFor = (marker) => L.sql(`select id from tasks where request like '%${marker}%' order by created_at desc limit 1`);

(async () => {
  const { browser, page } = await L.session();
  await openCore(page);

  // A: Stop before a handoff: the turn ends, its model process with it, and no background task appears
  const a = `stopA-${t}`;
  await ask(page, `[slow:120] ${a}`);
  await L.until(() => started(a) >= 1, 30000);
  const before = L.fakeRunning();
  await L.press(page.getByRole("button", { name: "Stop", exact: true }));
  const ended = await L.until(() => L.fakeRunning() < before, 15000, 250);
  L.ok("stop before handoff: the model process ends", !!ended, `fake CLI ${before} → ${L.fakeRunning()}`);
  L.ok("stop before handoff: the chat says Stopped", !!await L.until(async () => (await page.getByText("Stopped.").count()) > 0, 10000));
  await L.sleep(3000);
  L.ok("stop before handoff: no background task was created", !taskFor(a), taskFor(a) || "none");

  // B: Stop after a handoff only stops watching; C: Cancel task then ends the background work
  const b = `stopB-${t}`;
  await ask(page, `[slowfor:600:${t}] ${b}`);
  const handed = await L.until(async () => (await page.getByText("Working on it in the background").count()) > 0, 360000, 2000);
  L.ok("handoff: the long turn moved to a background task", !!handed);
  const id = taskFor(b);
  await L.press(page.getByRole("button", { name: "Stop", exact: true })).catch(() => {}); // only shown while the chat still watches
  await L.sleep(8000);
  L.ok("stop after handoff: the task keeps running (Stop only stops watching)", L.task(id).status === "running", L.task(id).status);
  const runningBefore = L.fakeRunning();
  const c = await L.api(page, `/api/tasks/${id}`, { action: "cancel" });
  const cancelled = await L.until(() => L.task(id).status === "cancelled", 20000, 250);
  L.ok("cancel task: the background task is cancelled", !!cancelled, `→ ${c.status}, status ${L.task(id).status}`);
  await L.sleep(1500);
  L.ok("cancel task: its model process ends", L.fakeRunning() < runningBefore || L.fakeRunning() === 0, `fake CLI ${runningBefore} → ${L.fakeRunning()}`);

  // D: Stop-all ends a live (pre-handoff) turn and holds new work until Resume
  const d = `stopD-${t}`;
  await openCore(page);
  await ask(page, `[slow:120] ${d}`);
  await L.until(() => started(d) >= 1, 30000);
  const beforeD = L.fakeRunning();
  await L.press(page.getByRole("button", { name: /stop all|stop-all/i }));
  const endedD = await L.until(() => L.fakeRunning() < beforeD, 20000, 250);
  console.log(`INFO  stop-all and a live answer: ${endedD ? "the answer was stopped" : "the answer kept running (as the Stop-all dialog says)"}  (fake CLI ${beforeD} → ${L.fakeRunning()}; decision: #481)`);
  await L.press(page.getByRole("button", { name: "Stop-all is on. Resume ORBIT" })); // the Stop-all chip, not a task's own Resume button
  const off = await L.until(async () => (await L.api(page, "/api/stop-all")).json?.stop?.on === false, 15000);
  L.ok("stop-all: Resume turns it off again", !!off);
  if (!off) await L.api(page, "/api/stop-all", { on: false }); // never leave Stop-all on for the next check
  await browser.close();
  process.exit(L.failures() ? 1 : 0);
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
