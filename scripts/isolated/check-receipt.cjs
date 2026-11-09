// W04: Copy receipt on a task, through the real UI (README.md here). A finished task whose request carries a planted fake key;
// the copied text must name the job and its state and link back, and must hold neither the request nor the key. A running task
// copies as "not ready yet".
const L = require("./lib.cjs");

(async () => {
  const { browser, page } = await L.session();
  await page.emulateMedia({ reducedMotion: "reduce" }); // headless software GL starves the page otherwise
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: L.BASE });
  const t = L.tag(), KEY = "sk-ant-FAKEFAKEFAKE0123456789";
  const copied = async (id) => {
    await page.goto(`${L.BASE}/#o=operations&k=task&id=${id}`); // the deep link a CORE answer or Needs you uses
    await page.getByRole("button", { name: "← All tasks" }).waitFor({ timeout: 60000 });
    await L.sleep(1000);
    await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
    await L.press(page.getByRole("button", { name: "Copy receipt" }).first());
    await L.sleep(800);
    return page.evaluate(() => navigator.clipboard.readText());
  };

  const done = await L.makeTask(page, `Receipt ${t}`, `please remember my key ${KEY} for receipt ${t}`);
  await L.until(() => ["done", "failed"].includes(L.task(done).status), 60000);
  const a = await copied(done);
  L.ok("receipt: names the job, its state and links back", a.includes(`ORBIT job ${done.slice(0, 8)}`) && /· (finished|failed)/.test(a) && a.includes(`k=task&id=${done}`), a.split("\n")[0]);
  L.ok("receipt: no prompt and no planted key", !a.includes(KEY) && !a.includes("please remember my key"), `${a.length} chars`);

  const slow = await L.makeTask(page, `Receipt slow ${t}`, `[slow:60] receipt running ${t}`);
  await L.until(() => L.task(slow).status === "running", 30000);
  const b = await copied(slow);
  L.ok("receipt: a running job copies as running, result not ready", /· running/.test(b) && b.includes("not ready yet"), b.split("\n").slice(0, 2).join(" / "));
  await browser.close();
  process.exit(L.failures() ? 1 : 0);
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
