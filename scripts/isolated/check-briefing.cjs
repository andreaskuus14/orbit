// Briefings and the crash policy on the signed-in test server (README.md here):
// - the voice model (and its phonemizer) isn't loaded at boot; a PC call starts it as its own process and speaks;
// - a briefing with one broken feed still succeeds from the others, and a second briefing right after succeeds too;
// - the server keeps answering, crash.log holds nothing unexpected, and neither log contains a configured secret.
// The cut-off compressed response itself can't reach a briefing here (safeFetch refuses local addresses): tests/briefing-crash-policy
// and tests/fetch-gzip-crash reproduce it with the real fetcher and phonemizer.
const L = require("./lib.cjs");
const fs = require("node:fs");
const path = require("node:path");
const serverLog = () => fs.readFileSync(path.join(L.DIR, "server.log"), "utf8");
// Is the voice process (kokoro-worker.mjs) running inside the test server's process group? Linux /proc only.
const voiceLoaded = () => {
  const pg = Number(fs.readFileSync(path.join(L.DIR, "server.pid"), "utf8"));
  return fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d)).some((pid) => {
    try { return fs.readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ")[2] === String(pg) && fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("kokoro-worker.mjs"); } catch { return false; }
  });
};
const crashLog = () => { try { return fs.readFileSync(path.join(L.DIR, "data/crash.log"), "utf8"); } catch { return ""; } };

(async () => {
  const from = fs.existsSync(path.join(L.DIR, "server.log")) ? serverLog().length : 0, crashFrom = crashLog().length;
  await L.restart();
  const { browser, page } = await L.session();
  await L.sleep(5000); // Next has preloaded its routes by now
  L.ok("voice: kokoro-js (and phonemizer) isn't loaded at boot", !voiceLoaded());
  const call = await page.evaluate(async () => { const r = await fetch("/api/remote/talk?op=start", { method: "POST" }); const t = await r.text(); return { status: r.status, id: /"id":"([^"]+)"/.exec(t)?.[1] ?? null, audio: /"audio":"[A-Za-z0-9+/]{100,}/.test(t) }; });
  if (call.id) await page.evaluate((id) => fetch(`/api/remote/talk?op=end&call=${id}`, { method: "POST" }), call.id);
  L.ok("voice: a PC call speaks its opener (Kokoro in its own process)", call.status === 200 && call.audio && voiceLoaded(), `status=${call.status}, audio=${call.audio}`);

  // one broken feed (a public URL that fails) next to the default topic feeds
  const uid = L.sql(`select id from auth.users where email='${L.conf().email}'`);
  await L.api(page, "/api/pulse", { focus: "" }).catch(() => null); // first run creates his default feeds
  L.sql(`insert into feeds (user_id, url, title, topic, enabled) values ('${uid}', 'https://github.com/orbit-isolated-check/missing/releases.atom', 'Broken feed', 'test', true) on conflict do nothing`);
  const briefings = () => Number(L.sql(`select count(*) from briefings where user_id='${uid}'`));
  const results = [];
  for (const n of [1, 2]) {
    const before = briefings();
    const r = await L.api(page, "/api/pulse", { focus: "" });
    results.push(`#${n}: ${r.status} ${r.status === 200 ? `${r.json?.briefing?.article_count ?? "?"} articles` : JSON.stringify(r.json).slice(0, 100)}`);
    L.ok(`briefing #${n} succeeds with a broken feed among the others`, r.status === 200 && briefings() === before + 1, results.at(-1));
  }
  L.ok("briefing: the server still answers afterwards", await fetch(`${L.BASE}/login`).then((x) => x.ok, () => false));
  const crashes = crashLog().slice(crashFrom);
  console.log(`      crash.log entries during this check: ${crashes ? crashes.trim().split("\n").filter((l) => /^\S+ (uncaught|unhandled)/.test(l)).length : 0}`);
  L.ok("briefing: no fatal stop during the check", !/→ fatal/.test(crashes) && !/fatal: ORBIT stops now/.test(serverLog().slice(from)));
  const env = L.serverEnv(), secrets = Object.entries(env).filter(([k, v]) => /KEY|SECRET|TOKEN|PASSWORD/i.test(k) && v && v.length >= 8);
  const leaked = secrets.filter(([, v]) => serverLog().includes(v) || crashLog().includes(v)).map(([k]) => k);
  L.ok(`logs: none of the ${secrets.length} configured secrets appear in server.log or crash.log`, secrets.length >= 3 && !leaked.length, leaked.join(", ") || secrets.map(([k]) => k).join(", "));
  await browser.close();
  process.exit(L.failures() ? 1 : 0);
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
