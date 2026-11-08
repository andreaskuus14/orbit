// C08: Stop-all while a task waits for the owner's approval, then a server restart (README.md here). Approving while Stop-all is on
// must do nothing; Stop-all survives the restart; after Resume the same approval runs the action exactly once.
const L = require("./lib.cjs");
const t = L.tag();
const projects = (since) => Number(L.sql(`select count(*) from projects where name='Isolation test project' and created_at > '${since}'`));

(async () => {
  let { browser, page } = await L.session();
  const since = new Date(Date.now() - 1000).toISOString();
  const id = await L.makeTask(page, `StopAll wait ${t}`, "[propose:create_project] stop-all while waiting");
  L.ok("wait: the agent proposes create_project and waits for approval", !!await L.until(() => L.task(id).status === "awaiting_approval", 30000));

  await L.press(page.getByRole("button", { name: /stop all|stop-all/i }));
  L.ok("stop-all: the server reports it on", !!await L.until(async () => (await L.api(page, "/api/stop-all")).json?.stop?.on === true, 10000));
  const during = L.task(id).status;
  await browser.close();
  await L.restart(); // with Stop-all on
  ({ browser, page } = await L.session());
  L.ok("restart: Stop-all is still on after the restart", (await L.api(page, "/api/stop-all")).json?.stop?.on === true);
  L.ok("restart: the waiting task isn't silently resumed or approved", ["awaiting_approval", "cancelled"].includes(L.task(id).status), `before restart ${during}, now ${L.task(id).status}`);

  const blocked = await L.api(page, `/api/tasks/${id}`, { action: "approve" });
  await L.sleep(4000);
  L.ok("approve during Stop-all: refused, nothing created", blocked.status >= 400 && projects(since) === 0, `→ ${blocked.status} ${JSON.stringify(blocked.json).slice(0, 100)}, projects=${projects(since)}`);

  await L.press(page.getByRole("button", { name: "Resume" }));
  await L.until(async () => (await L.api(page, "/api/stop-all")).json?.stop?.on === false, 10000);
  if (L.task(id).status === "awaiting_approval") {
    const ok = await L.api(page, `/api/tasks/${id}`, { action: "approve" });
    const again = await L.api(page, `/api/tasks/${id}`, { action: "approve" }); // a second click
    await L.until(() => projects(since) >= 1, 30000);
    await L.sleep(3000);
    L.ok("after Resume: the approval runs the action exactly once", projects(since) === 1, `approve → ${ok.status}, again → ${again.status}, projects=${projects(since)}`);
  } else {
    L.ok("after Stop-all the waiting task was cancelled: no project was ever created", projects(since) === 0, `status=${L.task(id).status}`);
  }
  await browser.close();
  process.exit(L.failures() ? 1 : 0);
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
