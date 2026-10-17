import { exec } from "node:child_process";
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { CLAUDE_BIN } from "./claude";
import { runDoctor } from "./doctor";
import { check, summarize, type Check } from "./doctor-pure";
import { bootNotice, consumed, effortCheck, parseState, readRange, scanLogs, type BootResult, type Mark } from "./doctor-boot-pure";

// Startup self-test: once per server boot (globalThis guard survives dev hot reloads and Next's separate module copies), runs the doctor
// plus a few local smoke checks and scans the server/launcher logs for crashes since the last boot. Result is kept for /api/doctor?boot=1.
// Logs are only read here (capped) and turned into our own explanations; their text is never returned or sent anywhere.

const dataDir = () => process.env.ORBIT_DATA_DIR?.trim() || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "orbit") : path.join(os.homedir(), ".orbit"));
const stateFile = () => path.join(dataDir(), "doctor-boot.json");
const g = globalThis as unknown as { __orbitBoot?: Promise<BootResult> };
const BOOT_ID = new Date(Date.now() - process.uptime() * 1000).toISOString();

async function readBytes(file: string, start: number, end: number): Promise<Buffer> {
  if (end <= start) return Buffer.alloc(0);
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(end - start);
    const { bytesRead } = await fh.read(buf, 0, buf.length, start);
    return buf.subarray(0, bytesRead);
  } finally { await fh.close(); }
}

/** New text in `file` since `prev` (and the tail of "<file>.1" when the launcher rotated it); returns the new mark. */
async function readSince(file: string, prev: Mark | null): Promise<{ text: string; mark: Mark | null }> {
  const s = await stat(file).catch(() => null);
  if (!s) return { text: "", mark: prev };
  const id = String(s.birthtimeMs);
  const r = readRange(prev, s.size, id);
  let old = "";
  if (r.rotated && prev) {
    const o = await stat(`${file}.1`).catch(() => null);
    if (o) { const ro = readRange({ offset: prev.offset, id: "x" }, o.size, "x"); old = (await readBytes(`${file}.1`, ro.start, ro.end).catch(() => Buffer.alloc(0))).toString("utf8"); }
  }
  const buf = await readBytes(file, r.start, r.end).catch(() => null);
  if (!buf) return { text: old, mark: prev };
  const n = consumed(buf);
  return { text: old + "\n" + buf.subarray(0, n).toString("utf8"), mark: { offset: r.start + n, id } };
}

const run = (cmd: string) => new Promise<string | null>((resolve) => {
  exec(cmd, { timeout: 8000, windowsHide: true, maxBuffer: 1 << 20 }, (err, out) => resolve(err ? null : out));
});

async function smokeChecks(): Promise<Check[]> {
  const dir = dataDir();
  const probe = path.join(dir, ".selftest-probe");
  const writable = await mkdir(dir, { recursive: true }).then(() => writeFile(probe, "")).then(() => unlink(probe).then(() => true, () => true), () => false);
  const ws = path.join(dir, "workspaces");
  const wsState = await readdir(ws).then(() => "ok", (e: NodeJS.ErrnoException) => (e.code === "ENOENT" ? "none" : e.code ?? "error"));
  const out: Check[] = [
    writable ? check("datadir", "ORBIT data folder", "ok", "Writable")
      : check("datadir", "ORBIT data folder", "fail", `ORBIT can't write to ${dir}, so chats, LIFE and settings can't be saved`, "Check the folder isn't read-only and no other program locks it, then restart ORBIT."),
    wsState === "ok" ? check("workspaces", "Workspaces folder", "ok", "Readable") : wsState === "none" ? check("workspaces", "Workspaces folder", "ok", "Not used yet")
      : check("workspaces", "Workspaces folder", "fail", `Can't read the workspaces folder (${wsState})`, `Check ${ws} isn't locked or read-only, then restart ORBIT.`),
    (process.env.ORBIT_ROBLOX_MCP_COMMAND ?? "").trim() ? check("roblox", "Roblox Studio connection", "ok", "Set up (ORBIT_ROBLOX_MCP_COMMAND)")
      : check("roblox", "Roblox Studio connection", "ok", "Not set up (optional)", "To build in Roblox Studio from ORBIT, set ORBIT_ROBLOX_MCP_COMMAND in .env.local."),
  ];
  if (process.platform === "win32") {
    const pid = Number((await readFile(path.join(process.env.LOCALAPPDATA ?? "", "orbit-wake", "pid"), "utf8").catch(() => "")).trim());
    let alive = false;
    if (pid > 0) try { process.kill(pid, 0); alive = true; } catch { /* not running */ }
    out.push(check("wakepid", "Wake listener", "ok", alive ? `Running (pid ${pid})` : "Not running (optional)", alive ? undefined : "To wake ORBIT by voice, run: npm run wake:install"));
  }
  return out;
}

async function saveState(server: Mark | null, launcher: Mark | null) {
  const f = stateFile(), tmp = `${f}.${process.pid}.tmp`;
  await mkdir(path.dirname(f), { recursive: true });
  await writeFile(tmp, JSON.stringify({ server, launcher }));
  await rename(tmp, f); // atomic: a crash mid-write never leaves a half file
}

async function selfTest(): Promise<BootResult> {
  const t0 = Date.now();
  const prev = parseState(await readFile(stateFile(), "utf8").catch(() => null));
  const [srv, lch] = await Promise.all([readSince(path.join(process.cwd(), "orbit-server.log"), prev.server ?? null), readSince(path.join(process.cwd(), "orbit-launcher.log"), prev.launcher ?? null)]);
  const scan = scanLogs(srv.text, lch.text);
  // No user session at boot: the anon client is enough to prove the database answers (RLS just returns nothing).
  // Missing settings still run the doctor (its env check names them); the placeholder URL just makes the database check fail.
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:9", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "missing", { auth: { persistSession: false, autoRefreshToken: false } });
  // CLAUDE_BIN comes from env/constants, never from a request. The version comes from the doctor's own claude check.
  const [doc, extra, help] = await Promise.all([runDoctor(sb).then((r) => r.checks), smokeChecks(), run(`"${CLAUDE_BIN}" --help`)]);
  const cl = doc.find((c) => c.id === "claude");
  const report = summarize([...doc, ...extra, effortCheck(help, cl?.status === "ok" ? cl.detail : null)], Date.now() - t0);
  // Only now: if the self-test failed above, the next try rescans the same log part instead of losing it.
  await saveState(srv.mark, lch.mark).catch(() => {}); // data dir unwritable: reported by the datadir check
  const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { bootId: BOOT_ID, at: report.at, report, scan, notice: bootNotice(scan, report.checks, today) };
}

/** The once-per-boot self-test (starts it on first call). */
export function bootSelfTest(): Promise<BootResult> {
  return (g.__orbitBoot ??= selfTest().catch((e) => {
    g.__orbitBoot = undefined; // let the next call retry
    throw e;
  }));
}
