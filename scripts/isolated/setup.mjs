// Isolated signed-in checks, step 1: a throwaway local Supabase (Docker) with every migration, a test user, and a build of this
// checkout that only ever sees test values. See README.md here. Run from a clean clone/worktree, never the live ORBIT folder.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const L = createRequire(import.meta.url)("./lib.cjs");
const SUPABASE_CLI = "supabase@2.120.0"; // pinned
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });
const die = (m) => { console.error(`setup: ${m}`); process.exit(1); };

// .env / .env.local hold real keys; next build/start would load them next to the test values. A separate clone has neither.
for (const f of [".env", ".env.local"]) if (existsSync(path.join(L.ROOT, f))) die(`${f} exists in ${L.ROOT}. Run this from a separate clone or \`git worktree add\` folder (no .env files), never the live ORBIT folder.`);
try { execFileSync("docker", ["info"], { stdio: "ignore" }); } catch { die("Docker isn't running (the local Supabase stack runs in Docker)."); }
if (!existsSync(path.join(L.ROOT, "node_modules/next"))) die("run `npm ci` in this checkout first.");

const sb = path.join(L.DIR, "supabase-project");
rmSync(sb, { recursive: true, force: true });
mkdirSync(sb, { recursive: true });
for (const d of ["data", "studio", "backups"]) mkdirSync(path.join(L.DIR, d), { recursive: true });
const cli = (...args) => run("npx", ["-y", SUPABASE_CLI, ...args], { cwd: sb });
cli("init", "--force");
cpSync(path.join(L.ROOT, "supabase/migrations"), path.join(sb, "supabase/migrations"), { recursive: true });
const cfg = path.join(sb, "supabase/config.toml");
writeFileSync(cfg, readFileSync(cfg, "utf8").replace(/^project_id = .*$/m, `project_id = "${L.PROJECT}"`));
cli("start", "-x", "studio,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor,postgres-meta"); // applies every migration
const st = JSON.parse(execFileSync("npx", ["-y", SUPABASE_CLI, "status", "-o", "json"], { cwd: sb, encoding: "utf8" }));
const apiUrl = st.API_URL, anonKey = st.ANON_KEY, serviceKey = st.SERVICE_ROLE_KEY; // the CLI's public local demo keys
if (!apiUrl?.startsWith("http://127.0.0.1") || !anonKey || !serviceKey) die("couldn't read the local stack's URL/keys from `supabase status`.");

const email = "orbit-test@example.test", password = randomBytes(12).toString("hex");
const r = await fetch(`${apiUrl}/auth/v1/admin/users`, { method: "POST", headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
  body: JSON.stringify({ email, password, email_confirm: true }) });
const user = await r.json();
if (!r.ok && !/already/i.test(JSON.stringify(user))) die(`creating the test user: ${r.status} ${JSON.stringify(user)}`);
writeFileSync(path.join(L.DIR, "env.json"), JSON.stringify({ apiUrl, anonKey, serviceKey, email, password, remoteSecret: randomBytes(32).toString("hex") }, null, 1));

console.log("setup: building this checkout into .next-isolated with test values only…");
run(process.execPath, [path.join(L.ROOT, "node_modules/next/dist/bin/next"), "build"], { cwd: L.ROOT, env: L.serverEnv() });
console.log(`setup: done. Stack + data in ${L.DIR}. Next: node scripts/isolated/run-all.mjs`);
