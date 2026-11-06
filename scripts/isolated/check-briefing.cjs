// A briefing that fails can't end the server. The cut-off response itself is reproduced deterministically by
// tests/safe-fetch-body.test.ts and tests/crash-guard.test.ts (safeFetch refuses local addresses, so a feed can't point at a local
// broken server here). This runs a real briefing through the signed-in server (its feeds fail on a blocked or flaky network: 403s
// and cut-off bodies, as in the 2026-11-06 crash), checks phonemizer's exit-on-error handlers were dropped at boot, and that the
// server still answers, logged any escape with its job, and didn't retry.
const L = require("./lib.cjs");
const fs = require("node:fs");
const path = require("node:path");
const log = () => fs.readFileSync(path.join(L.DIR, "server.log"), "utf8");

(async () => {
  const from = fs.existsSync(path.join(L.DIR, "server.log")) ? log().length : 0;
  await L.restart(); // Next's entry preload loads kokoro-js → phonemizer at boot
  const { browser, page } = await L.session();
  const guarded = await L.until(() => /dropped a process uncaughtException handler that only re-throws/.test(log().slice(from)), 60000, 1000);
  L.ok("briefing: phonemizer loaded at boot, and its exit-on-error handlers were dropped", !!guarded);
  const runs = () => Number(L.sql("select count(*) from job_runs where job='pulse'"));
  const before = runs();
  const r = await L.api(page, "/api/pulse", { focus: "" }); // a manual briefing: fetches every feed through safeFetch
  console.log(`      briefing answered ${r.status}: ${JSON.stringify(r.json).slice(0, 120)}`);
  await L.sleep(5000);
  const after = log().slice(from);
  L.ok("briefing: the server still answers after the briefing", (await fetch(`${L.BASE}/login`).then((x) => x.ok, () => false)));
  L.ok("briefing: no exit in the server log", !/Failed to start server|phonemizer\.js:1/.test(after));
  const escaped = after.match(/\[orbit\] (uncaughtException|unhandledRejection) in [^\n]*/g) ?? [];
  console.log(`      errors that escaped a handler (logged, server kept serving): ${escaped.length ? escaped.join(" | ").slice(0, 300) : "none"}`);
  L.ok("briefing: one briefing request = at most one recorded run (no automatic retry)", runs() - before <= 1, `job_runs +${runs() - before}`);
  await browser.close();
  process.exit(L.failures() ? 1 : 0);
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
