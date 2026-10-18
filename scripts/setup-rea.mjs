// Explicit local installation. Never called by CORE, a web request or the scheduler.
import { spawn } from "node:child_process";
import { access, copyFile, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [major, minor] = process.versions.node.split(".").map(Number);
if (!((major === 22 && minor >= 19) || (major === 24 && minor >= 11) || major >= 26)) throw new Error("REA requires Node 22.19+, 24.11+ or 26+. Install a supported Node version first.");
const file = path.join(project, ".env.local");
let original = "";
try { original = await readFile(file, "utf8"); } catch (e) { if (e.code !== "ENOENT") throw e; }
function envValue(key) {
  const lines = original.split(/\r?\n/).filter((line) => line.startsWith(key + "="));
  const v = (lines.at(-1) ?? "").slice(key.length + 1).trim();
  return v.replace(/^(["'])(.*)\1$/, "$2");
}
let emails = envValue("ORBIT_ALLOWED_EMAILS") || process.env.ORBIT_ALLOWED_EMAILS || "";
if (!emails || /example\.com/i.test(emails)) {
  if (!process.stdin.isTTY) throw new Error("Set ORBIT_ALLOWED_EMAILS to your own account email in .env.local, then rerun npm run rea:setup.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { emails = (await rl.question("Your ORBIT sign-in email (restricts access to this PC's source analysis): ")).trim(); }
  finally { rl.close(); }
}
if (!emails.split(",").every((s) => /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(s.trim()) && !/example\.com$/i.test(s.trim()))) throw new Error("Enter a valid account email, or a comma-separated list of your allowed accounts.");
const tools = path.join(project, "vendor", "rea");
await access(path.join(tools, "package-lock.json"));
console.log("Building the bundled REA source. npm downloads locked build dependencies; no REA server or other AI client is configured.");
const npmCli = process.env.npm_execpath;
if (!npmCli || !/\.(?:js|cjs)$/.test(npmCli)) throw new Error("Run this installer through npm run rea:setup.");
async function npm(args) { await new Promise((resolve, reject) => {
  const env = { ...process.env, HUSKY: "0" };
  // npm run exports its allow-scripts policy as command-level config. A nested
  // project install must use that project's package.json policy instead.
  for (const key of Object.keys(env)) if (/^npm_config_allow[_-]?scripts$/i.test(key)) delete env[key];
  const child = spawn(process.execPath, [npmCli, ...args], { cwd: tools, env, shell: false, stdio: "inherit", windowsHide: true });
  child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`REA installation failed (${code}); .env.local has not been changed.`)));
}); }
await npm(["ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
// Compile the CLI directly: REA's exclusive build supervisor requires a
// Windows native addon omitted from source ZIPs, even for static analysis.
await npm(["run", "compile"]);
await access(path.join(tools, "dist", "cli-runtime", "cli.js"));
const updates = { ORBIT_ALLOWED_EMAILS: emails, ORBIT_REA_ENABLED: "true" };
let next = original;
for (const [key, value] of Object.entries(updates)) {
  const re = new RegExp(`^${key}=.*$`, "gm");
  next = re.test(next) ? next.replace(re, `${key}=${value}`) : next.replace(/\s*$/, "\n") + `${key}=${value}\n`;
}
if (next !== original) {
  if (original) await copyFile(file, `${file}.rea-backup-${Date.now()}`);
  const tmp = `${file}.rea-${process.pid}.tmp`;
  await writeFile(tmp, next, { mode: 0o600, flag: "wx" });
  await rename(tmp, file);
}
console.log("REA is installed and enabled. Restart/rebuild ORBIT, open /rea, or ask CORE: Analyze the ORBIT project with REA.");
