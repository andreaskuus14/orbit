// Stop-all right after a cold start: with stop-all.json on, unreadable or damaged, a task queued before boot must not start.
// The last case (off) is the control: the same queued task does start, so the check can see a start when one happens.
const L = require("./lib.cjs");
const fs = require("node:fs");
const path = require("node:path");
const file = path.join(L.DIR, "data/stop-all.json");

async function boot(state) {
  L.stop(); await L.sleep(1000);
  const title = `Cold ${state} ${L.tag()}`, uid = L.sql(`select id from auth.users where email='${L.conf().email}'`);
  L.sql(`insert into tasks (user_id, agent, title, request, status) values ('${uid}','nova','${title}','due at boot','queued')`);
  fs.rmSync(file, { recursive: true, force: true });
  if (state === "on") fs.writeFileSync(file, JSON.stringify({ on: true, at: new Date().toISOString() }));
  if (state === "unreadable") fs.mkdirSync(file); // what a Windows lock at boot looks like to a read
  if (state === "damaged") fs.writeFileSync(file, "");
  L.start(); await L.up();
  await L.sleep(40_000); // scheduler first tick + kickQueue
  const r = { status: L.sql(`select status from tasks where title='${title}'`), calls: L.calls(title) };
  L.sql(`delete from tasks where title='${title}'`);
  return r;
}

(async () => {
  for (const state of ["on", "unreadable", "damaged"]) {
    const r = await boot(state);
    L.ok(`cold start, stop-all.json ${state}: the queued task doesn't start`, r.calls === 0 && r.status === "queued", `status=${r.status}, model calls=${r.calls}`);
  }
  const c = await boot("off");
  L.ok("cold start, stop-all.json off (control): the queued task starts", c.calls >= 1, `status=${c.status}, model calls=${c.calls}`);
  fs.rmSync(file, { recursive: true, force: true }); // leave it off for the other checks
  process.exit(L.failures() ? 1 : 0);
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
