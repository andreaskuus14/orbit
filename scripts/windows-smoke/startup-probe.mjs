// Windows release smoke, startup part: start the built app with placeholder test values only (no real Supabase, keys or
// integrations) and a throwaway data dir, and check it serves and refuses unauthenticated API calls without crashing.
// Usage: node startup-probe.mjs <checkout> <results.json>. Exit 1 if any check failed.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = path.resolve(process.argv[2] ?? "."), out = process.argv[3];
const data = mkdtempSync(path.join(os.tmpdir(), "orbit-smoke-"));
const PORT = "3100";
const env = {
  SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP, USERPROFILE: process.env.USERPROFILE,
  LOCALAPPDATA: path.join(data, "LocalAppData"), ORBIT_DATA_DIR: path.join(data, "orbit"), NODE_ENV: "production", PORT,
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-placeholder-anon-key", NEXT_TELEMETRY_DISABLED: "1",
};
const log = [], checks = [];
const srv = spawn(process.execPath, [path.join(dir, "node_modules/next/dist/bin/next"), "start", "-p", PORT, "-H", "127.0.0.1"], { cwd: dir, env });
srv.stdout.on("data", (d) => log.push(String(d))); srv.stderr.on("data", (d) => log.push(String(d)));
const ok = (name, pass, detail = "") => { checks.push({ name, pass: !!pass, detail: String(detail).slice(0, 200) }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (p) => { try { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { redirect: "manual" }); return { status: r.status, body: await r.text() }; } catch (e) { return { status: 0, body: String(e) }; } };

let up = null; const t0 = Date.now();
while (Date.now() - t0 < 120_000 && srv.exitCode === null) { up = await get("/login"); if (up.status === 200) break; await sleep(1000); }
ok("/login served", up?.status === 200, `${up?.status} after ${Date.now() - t0} ms`);
ok("login page has the password sign-in", /Sign in/i.test(up?.body ?? ""));
const home = await get("/");
ok("/ without a session redirects to sign-in (no 500)", [302, 303, 307, 308].includes(home.status), `${home.status}`);
for (const p of ["/api/projects", "/api/tasks", "/api/projects/desk?project=x", "/api/vault"]) {
  const r = await get(p);
  ok(`${p} refuses an unauthenticated call (no 500)`, r.status === 401 || r.status === 403, `${r.status}`);
}
await sleep(1500);
ok("the server is still running", srv.exitCode === null, `exit ${srv.exitCode}`);
const text = log.join("");
ok("no uncaught exception in the server log", !/uncaughtException|unhandledRejection|FATAL/i.test(text), text.slice(-200));
const crash = path.join(env.ORBIT_DATA_DIR, "crash.log");
ok("no crash.log", !existsSync(crash) || !readFileSync(crash, "utf8").trim());
srv.kill();
if (out) writeFileSync(out, JSON.stringify({ dataDir: env.ORBIT_DATA_DIR, checks }, null, 1));
process.exit(checks.every((c) => c.pass) ? 0 : 1);
