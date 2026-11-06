// Restart recovery and approved actions interrupted mid-write (SIGKILL of the isolated test server only; README.md here).
// An approved create_project is held by a table lock after its attempt is recorded, the server is killed, then the write either
// lands after the crash ("landed") or never does ("not-landed"). Recovery must never create a second project.
const L = require("./lib.cjs");
const t = L.tag();
const projects = (since) => Number(L.sql(`select count(*) from projects where name='Isolation test project' and created_at > '${since}'`));
function lockProjects() { // blocks INSERTs into projects (reads still work) until release()
  const p = L.psqlSession();
  p.stdin.write("BEGIN; LOCK TABLE public.projects IN SHARE ROW EXCLUSIVE MODE;\n");
  return { release: () => { p.stdin.write("COMMIT;\n"); p.stdin.end(); } };
}
const blockedInsert = () => L.sql("select pid from pg_stat_activity where wait_event_type='Lock' and query ilike '%insert into \"public\".\"projects\"%' limit 1");
const text = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");

async function restartRecovery() {
  let { browser, page } = await L.session();
  const title = `Restart ${t}`, id = await L.makeTask(page, title, "[slow:120] restart recovery");
  await L.until(() => L.calls(title) >= 1 && L.task(id).status === "running", 20000);
  await browser.close();
  await L.restart(); // SIGKILL mid-task
  ({ browser, page } = await L.session());
  const s = await L.until(() => L.task(id).status !== "running" && L.task(id), 120000, 1000); // the scheduler's sweep
  L.ok("restart: a task running at the crash is marked interrupted, not left running", s?.status === "failed", `${s?.status}: ${(s?.error ?? "").slice(0, 80)}`);
  await L.openTask(page, id);
  L.ok("restart: the task view says ORBIT restarted", /restart/i.test(await text(page)));
  await L.press(page.getByRole("button", { name: "Retry", exact: true }));
  await L.until(() => L.task(id).status === "done", 150000, 1000);
  L.ok("restart: Retry re-runs it once", L.task(id).status === "done" && L.calls(title) === 2, `calls=${L.calls(title)}`);
  await browser.close();
}

async function interruptedAction(variant) {
  let { browser, page } = await L.session();
  const since = new Date(Date.now() - 1000).toISOString();
  const id = await L.makeTask(page, `Uncertain ${variant} ${t}`, "[propose:create_project] uncertain action");
  L.ok(`${variant}: the agent proposes create_project and waits for approval`, !!await L.until(() => L.task(id).status === "awaiting_approval", 30000));
  await L.openTask(page, id);
  const approve = page.getByRole("button", { name: "Approve", exact: true });
  await approve.waitFor({ timeout: 30000 });
  const lock = lockProjects(); await L.sleep(800);
  void approve.evaluate((b) => b.click()); // the real button; its request then waits on the lock
  const att = await L.until(() => L.task(id).pending[0]?.status === "attempting" && blockedInsert(), 20000, 200);
  L.ok(`${variant}: the attempt is on record before the write, and the write is in flight`, !!att);
  await browser.close().catch(() => {});
  L.stop(); await L.sleep(1000); // crash mid-action
  if (variant === "not-landed") L.sql(`select pg_cancel_backend(${blockedInsert()})`);
  lock.release(); // "landed": the in-flight insert commits after the crash
  await L.sleep(1500);
  L.ok(`${variant}: project rows right after the crash = ${variant === "landed" ? 1 : 0}`, projects(since) === (variant === "landed" ? 1 : 0), `${projects(since)}`);
  L.start(); await L.up(); ({ browser, page } = await L.session());
  const s = await L.until(() => L.task(id).status !== "running" && L.task(id), 120000, 1000);
  L.ok(`${variant}: after the restart it is neither running nor shown as done`, !!s && s.status !== "done" && s.pending[0]?.status === "uncertain", `${s?.status}, step=${s?.pending[0]?.status}: ${(s?.error ?? "").slice(0, 80)}`);
  await L.openTask(page, id);
  L.ok(`${variant}: the task view says it may or may not have happened`, /may or may not have happened/i.test(await text(page)));
  const whole = await L.api(page, `/api/tasks/${id}`, { action: "retry" });
  L.ok(`${variant}: re-running the whole agent task is refused`, whole.status >= 400, `→ ${whole.status}`);
  await L.press(page.getByRole("button", { name: /^Resume/ })); // approve this step again: same attempt id
  await L.until(() => !["running", "awaiting_approval"].includes(L.task(id).status), 30000);
  const again = await L.api(page, `/api/tasks/${id}`, { action: "resume" }); // a second recovery click (other tab)
  await L.sleep(2000);
  const f = L.task(id);
  L.ok(`${variant}: after recovery exactly ONE project exists`, projects(since) === 1 && f.status === "done", `projects=${projects(since)}, ${f.pending[0]?.status}: ${(f.pending[0]?.note ?? "").slice(0, 70)}; 2nd click → ${again.status}`);
  await browser.close();
}

(async () => {
  if (process.argv[2] !== "actions") await restartRecovery();
  await interruptedAction("landed");
  await interruptedAction("not-landed");
  process.exit(L.failures() ? 1 : 0);
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
