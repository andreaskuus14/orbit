// Windows startup smoke: start the built app with placeholder test values only (no real Supabase, keys or integrations),
// a throwaway data dir, and check it serves and refuses unauthenticated API calls without crashing. Usage: node startup-probe.mjs <checkout>
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2]);
const data = mkdtempSync("C:\\iso-orbit-start-");
const env = {
  SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP, USERPROFILE: process.env.USERPROFILE,
  LOCALAPPDATA: path.join(data, "LocalAppData"), ORBIT_DATA_DIR: path.join(data, "orbit"), NODE_ENV: "production", PORT: "3100",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-placeholder-anon-key",
};
const log = [];
const srv = spawn(process.execPath, [path.join(dir, "node_modules/next/dist/bin/next"), "start", "-p", "3100", "-H", "127.0.0.1"], { cwd: dir, env });
srv.stdout.on("data", (d) => log.push(String(d))); srv.stderr.on("data", (d) => log.push(String(d)));
let fails = 0;
const ok = (n, c, d = "") => { if (!c) fails++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (p) => { try { const r = await fetch(`http://127.0.0.1:3100${p}`, { redirect: "manual" }); return { status: r.status, body: await r.text() }; } catch (e) { return { status: 0, body: String(e) }; } };
let up = null; const t0 = Date.now();
while (Date.now() - t0 < 120_000) { up = await get("/login"); if (up.status === 200) break; await sleep(1000); }
ok("startup: /login served", up?.status === 200, `${up?.status} after ${Date.now() - t0} ms`);
ok("startup: login page has the password sign-in", /Sign in/i.test(up?.body ?? ""));
const home = await get("/");
ok("startup: / without a session redirects to sign-in (no 500)", [302, 303, 307, 308].includes(home.status) || home.status === 200, `${home.status}`);
for (const p of ["/api/projects", "/api/tasks", "/api/projects/desk?project=x", "/api/vault"]) {
  const r = await get(p);
  ok(`startup: ${p} refuses an unauthenticated call (no 500)`, r.status === 401 || r.status === 403, `${r.status}`);
}
await sleep(1500);
ok("startup: the server is still running", srv.exitCode === null);
const out = log.join("");
ok("startup: no uncaught exception in the server log", !/uncaughtException|unhandledRejection|FATAL/i.test(out), out.slice(-300));
const crash = path.join(env.ORBIT_DATA_DIR, "crash.log");
ok("startup: no crash.log", !existsSync(crash) || !readFileSync(crash, "utf8").trim());
console.log("data dir used:", env.ORBIT_DATA_DIR);
srv.kill();
process.exit(fails ? 1 : 0);
