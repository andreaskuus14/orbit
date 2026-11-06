// Retry, Cancel and Stop-all through the signed-in UI of the isolated test server (README.md here).
const L = require("./lib.cjs");

(async () => {
  const { browser, page } = await L.session();
  const t = L.tag();

  // Retry: a failed task runs once more per click; a second Retry while that run is going is refused
  const tR = `Retry check ${t}`, idR = await L.makeTask(page, tR, `[failonce:${t}] [slow:15] retry check`);
  L.ok("retry: the task fails first", !!await L.until(() => L.task(idR).status === "failed"), L.task(idR).error.slice(0, 60));
  await L.openTask(page, idR);
  const retry = page.getByRole("button", { name: "Retry", exact: true });
  await retry.click();
  await retry.click({ timeout: 1500 }).catch(() => {}); // a fast double click
  await L.until(() => L.task(idR).status === "running", 10000, 200);
  const second = await L.api(page, `/api/tasks/${idR}`, { action: "retry" }); // another tab, while the retry runs
  L.ok("retry: a second Retry while it runs is refused", second.status >= 400, `→ ${second.status} ${JSON.stringify(second.json).slice(0, 90)}`);
  await L.until(() => L.task(idR).status === "done", 40000);
  L.ok("retry: re-ran exactly once and finished (the failure + one retry = 2 model calls)", L.calls(tR) === 2 && L.task(idR).status === "done", `calls=${L.calls(tR)}, status=${L.task(idR).status}`);

  // Cancel: a running task stops and its model process ends
  const tC = `Cancel check ${t}`, idC = await L.makeTask(page, tC, "[slow:90] cancel check");
  await L.until(() => L.calls(tC) >= 1 && L.task(idC).status === "running", 20000);
  await L.openTask(page, idC);
  const cancel = page.getByRole("button", { name: "Cancel task" });
  await cancel.waitFor();
  const before = L.fakeRunning(), t0 = Date.now();
  await cancel.click();
  const done = await L.until(() => L.task(idC).status === "cancelled", 15000, 100);
  L.ok("cancel: the running task is cancelled", !!done, `${((Date.now() - t0) / 1000).toFixed(1)} s after the click`);
  await L.sleep(1000);
  L.ok("cancel: its model process was ended", L.fakeRunning() < before, `fake CLI processes ${before} → ${L.fakeRunning()}`);
  L.ok("cancel: nothing re-ran it", L.calls(tC) === 1, `calls=${L.calls(tC)}`);

  // Stop-all: running tasks stop, nothing new starts or re-runs, Resume lets queued work start
  const tA = `StopAll A ${t}`, tB = `StopAll B ${t}`;
  const idA = await L.makeTask(page, tA, "[slow:90] stop-all a"), idB = await L.makeTask(page, tB, "[slow:90] stop-all b");
  await L.until(() => L.calls(tA) && L.calls(tB), 20000);
  await page.getByRole("button", { name: /stop all|stop-all/i }).first().click(); // the 🛑 chip (its confirm is accepted)
  const stopped = await L.until(() => L.task(idA).status === "cancelled" && L.task(idB).status === "cancelled", 15000, 200);
  L.ok("stop-all: both running tasks are cancelled", !!stopped, `${L.task(idA).status}/${L.task(idB).status}`);
  const tN = `StopAll new ${t}`, idN = await L.makeTask(page, tN, "after stop-all");
  await L.sleep(5000);
  L.ok("stop-all: a new task doesn't start while it's on", L.calls(tN) === 0 && L.task(idN).status === "queued", `status=${L.task(idN).status}, calls=${L.calls(tN)}`);
  const ret = await L.api(page, `/api/tasks/${idA}`, { action: "retry" });
  await L.sleep(3000);
  L.ok("stop-all: Retry doesn't run anything while it's on (it only queues)", L.calls(tA) === 1, `retry → ${ret.status}, status=${L.task(idA).status}, calls=${L.calls(tA)}`);
  await page.getByRole("button", { name: "Resume" }).first().click();
  await L.until(() => L.calls(tN) >= 1, 90000);
  L.ok("stop-all: Resume starts the queued task", L.calls(tN) >= 1, `status=${L.task(idN).status}`);
  await browser.close();
  process.exit(L.failures() ? 1 : 0);
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
