// Shared helpers for the isolated signed-in checks (README.md here). Everything points at the throwaway stack that setup.mjs made:
// local Supabase (its demo keys), a test user, a scratch data folder, the fake Claude CLI, port 3100. Never the live ORBIT.
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const DIR = process.env.ORBIT_ISO_DIR || path.join(os.tmpdir(), "orbit-isolated");
const BASE = "http://127.0.0.1:3100";
const PROJECT = "orbit-isolated"; // supabase project_id: containers are supabase_*_orbit-isolated
const DB = `supabase_db_${PROJECT}`;
const FAKE_LOG = path.join(DIR, "fake-claude.log");
const conf = () => JSON.parse(fs.readFileSync(path.join(DIR, "env.json"), "utf8"));

const NET = ["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"];
/** The test server's environment: only test values (a clean env, not this shell's), so no real key can reach it. */
function serverEnv() {
  const c = conf();
  const net = Object.fromEntries(NET.filter((k) => process.env[k]).map((k) => [k, process.env[k]])); // proxy/CA only: the build fetches fonts
  return {
    ...net, PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "production", TZ: process.env.TZ ?? "",
    NEXT_PUBLIC_SUPABASE_URL: c.apiUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: c.anonKey, SUPABASE_SECRET_KEY: c.serviceKey, // local demo keys
    ORBIT_ALLOWED_EMAILS: c.email, ORBIT_DIST_DIR: ".next-isolated", ORBIT_DATA_DIR: path.join(DIR, "data"),
    ORBIT_STUDIO_DIR: path.join(DIR, "studio"), ORBIT_BACKUP_DIR: path.join(DIR, "backups"), ORBIT_DAILY_DIGEST: "off", ORBIT_EMBED: "local",
    ORBIT_CLAUDE_BIN: path.join(__dirname, "fake-claude.mjs"), FAKE_CLAUDE_LOG: FAKE_LOG, REMOTE_SECRET: c.remoteSecret,
  };
}

const sql = (q) => execFileSync("docker", ["exec", DB, "psql", "-U", "postgres", "-At", "-c", q], { encoding: "utf8" }).trim();
/** A psql session kept open (stdin), e.g. to hold a table lock; write statements, end() to close. */
const psqlSession = () => spawn("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-q"], { stdio: ["pipe", "ignore", "inherit"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 30000, step = 500) { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return null; await sleep(step); } }
const up = (ms = 90000) => until(async () => { try { return (await fetch(`${BASE}/login`)).ok; } catch { return false; } }, ms);

const pidFile = path.join(DIR, "server.pid");
/** Starts the test server in its own process group (so stop() can kill it and its CLI children, and nothing else). */
function start() {
  const log = fs.openSync(path.join(DIR, "server.log"), "a");
  fs.writeSync(log, `=== boot ${new Date().toISOString()}\n`);
  const p = spawn(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", "3100"],
    { cwd: ROOT, env: serverEnv(), detached: true, stdio: ["ignore", log, log] });
  fs.writeFileSync(pidFile, String(p.pid));
  p.unref();
}
/** SIGKILL of the test server's process group: a crash, as far as ORBIT can tell. Only the pid this harness started. */
function stop() {
  let pid; try { pid = Number(fs.readFileSync(pidFile, "utf8")); } catch { return; }
  try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ }
  fs.rmSync(pidFile, { force: true });
}
async function restart() { stop(); await sleep(1500); start(); if (!await up()) throw new Error("the test server didn't come back (see server.log)"); }

async function session() {
  const req = require("node:module").createRequire(path.join(ROOT, "package.json"));
  const { chromium } = (() => { try { return req("playwright"); } catch { return req("playwright-core"); } })();
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on("dialog", (d) => d.accept()); // Stop-all's confirm()
  const c = conf();
  await page.goto(`${BASE}/login`);
  await page.getByRole("button", { name: "Sign in with password" }).click();
  await page.getByLabel("Email").fill(c.email);
  await page.getByLabel("Password").fill(c.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  return { browser, page };
}
/** Same-origin call from the signed-in page (its cookies), like the UI's own fetches. */
const api = (page, p, body) => page.evaluate(async ([p, b]) => { const r = await fetch(p, b === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, json: await r.json().catch(() => null) }; }, [p, body]);
async function makeTask(page, title, request) {
  const r = await api(page, "/api/tasks", { agent: "nova", title, request });
  if (!r.json?.task) throw new Error(`creating "${title}": ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.task.id;
}
function task(id) {
  const r = sql(`select status||'|'||coalesce(error,'')||'|'||coalesce(pending::text,'[]') from tasks where id='${id}'`);
  const [status, error, ...p] = r.split("|");
  return { status, error, pending: JSON.parse(p.join("|") || "[]") };
}
/** Opens TaskView through the app's own "open this task" event (what a CORE week citation does). TaskView reads its task once,
 *  so an open one is closed first for a fresh view. */
async function openTask(page, id) {
  const back = page.getByRole("button", { name: "← All tasks" });
  if (await back.count()) { await back.click(); await sleep(400); }
  await page.evaluate((id) => dispatchEvent(new CustomEvent("orbit:open-source", { detail: { id: `t:${id}`, kind: "week:task" } })), id);
  await page.getByRole("button", { name: "← All tasks" }).waitFor({ timeout: 30000 });
  await sleep(800);
}
/** Clicks the real button once it's visible, without Playwright's wait for the page to settle afterwards (ORBIT's live panels
 *  keep re-rendering, which made that wait flaky). */
async function press(locator) { await locator.first().waitFor({ state: "visible", timeout: 30000 }); await locator.first().evaluate((b) => b.click()); }
const calls = (title) => { try { return fs.readFileSync(FAKE_LOG, "utf8").split("\n").filter((l) => l.includes(" start ") && l.includes(`TASK: ${title}`)).length; } catch { return 0; } };
const fakeRunning = () => { try { return execFileSync("pgrep", ["-fc", "scripts/isolated/fake-claude"], { encoding: "utf8" }).trim() | 0; } catch { return 0; } };
let failed = 0;
const ok = (name, cond, detail = "") => { if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); return cond; };
const failures = () => failed;
const tag = () => Date.now().toString(36);

module.exports = { press, ROOT, DIR, BASE, PROJECT, FAKE_LOG, conf, serverEnv, sql, psqlSession, sleep, until, up, start, stop, restart, session, api, makeTask, task, openTask, calls, fakeRunning, ok, failures, tag };
