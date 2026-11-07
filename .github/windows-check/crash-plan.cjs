// Test-only preload (NODE_OPTIONS --require), active only in the `next start` server process. Polls <data dir>/crash-plan.txt;
// "throw" raises an uncaught exception (ORBIT's controlled stop, exit 70), "exit1" exits with code 1 (a genuine startup failure).
const fs = require("fs"), path = require("path");
const a = process.argv.join(" ");
if (/next[\\/]dist[\\/]bin[\\/]next/.test(a) && / start\b/.test(a)) {
  const plan = path.join(process.env.ORBIT_DATA_DIR, "crash-plan.txt");
  setInterval(() => {
    let what; try { what = fs.readFileSync(plan, "utf8").trim(); fs.unlinkSync(plan); } catch { return; }
    if (what === "throw") setTimeout(() => { throw Object.assign(new Error("windows check: planned uncaught exception token=PLANSECRET123456"), { code: "PLANNED" }); }, 0);
    if (what === "exit1") process.exit(1);
  }, 500).unref();
}
