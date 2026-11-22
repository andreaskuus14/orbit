// CODE SANDBOX, disk + process side (rules: sandbox-pure.ts). Each run gets its own folder under the OS temp dir, the files he
// attached in this chat or VAULT files he named are copied in (never journal/LIFE files), and the code runs in a child process:
// Python through tools/sandbox/run.py in the sandbox venv (tools/sandbox/setup.ps1), JavaScript through tools/sandbox/run.mjs
// under Node's permission model. The child gets an empty environment (no keys, no proxy), a time limit enforced from both
// sides, and its outputs stay in its folder until sandbox_save copies one into VAULT. Stop-all kills every run.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MAX_BYTES_IN, MAX_RUNNING, KEEP_MS, RUN_ID, codeOf, csvTable, endOf, fileRefusal, inName, langOf, limitsFrom, outputsOf, pickFiles, resultText, sandboxEnv, saveTarget, outName,
  type OutFile, type SbLang } from "./sandbox-pure";
import { stopAllOn } from "./stop-all";

const WIN = process.platform === "win32";
const ROOT = () => path.join(os.tmpdir(), "orbit-sandbox");
const TOOLS = () => path.join(process.cwd(), "tools", "sandbox");
const OUT_CAP = 400_000; // chars of stdout/stderr kept per run

type Live = { child: ChildProcess; stopped: boolean };
type Stash = { files: Map<string, Uint8Array>; at: number };
const G = globalThis as unknown as { __orbitSandbox?: { live: Map<string, Live>; stash: Map<string, Stash>; swept: number } };
const st = (G.__orbitSandbox ??= { live: new Map(), stash: new Map(), swept: 0 });

/** CORE keeps this chat's attached files (raw bytes) for 3 hours, so sandbox_run can copy them in by name. */
export function stashAttachments(chat: string, files: { name: string; data: Uint8Array }[]) {
  if (!chat || !files.length) return;
  const s = st.stash.get(chat) ?? { files: new Map(), at: 0 };
  for (const f of files) if (!fileRefusal(f.name)) s.files.set(f.name, f.data);
  s.at = Date.now();
  st.stash.set(chat, s);
  for (const [k, v] of st.stash) if (Date.now() - v.at > KEEP_MS) st.stash.delete(k);
}
const attachedIn = (chat?: string) => (chat ? st.stash.get(chat)?.files : undefined) ?? new Map<string, Uint8Array>();

/** The Python to use: ORBIT_SANDBOX_PYTHON, the sandbox venv, or (not on Windows) python3 when it has numpy. */
export function sandboxPython(): string | null {
  const env = process.env.ORBIT_SANDBOX_PYTHON?.trim();
  if (env && existsSync(env)) return env;
  const venv = WIN ? path.join(TOOLS(), ".venv", "Scripts", "python.exe") : path.join(TOOLS(), ".venv", "bin", "python");
  if (existsSync(venv)) return venv;
  if (!WIN) for (const p of ["/usr/bin/python3", "/usr/local/bin/python3"]) if (existsSync(p) && spawnSync(p, ["-I", "-c", "import numpy"], { timeout: 15_000 }).status === 0) return p;
  return null;
}
const permFlag = () => (process.allowedNodeEnvironmentFlags.has("--permission") ? "--permission" : "--experimental-permission");

/** Old run folders go after 3 hours (checked at most every 10 minutes). */
async function sweep() {
  if (Date.now() - st.swept < 10 * 60_000) return;
  st.swept = Date.now();
  const dirs = await readdir(ROOT()).catch(() => [] as string[]);
  await Promise.all(dirs.filter((d) => RUN_ID.test(d) && !st.live.has(d)).map(async (d) => {
    const s = await stat(path.join(ROOT(), d)).catch(() => null);
    if (s && Date.now() - s.mtimeMs > KEEP_MS) await rm(path.join(ROOT(), d), { recursive: true, force: true }).catch(() => {});
  }));
}

function kill(l: Live) {
  l.stopped = true;
  const pid = l.child.pid;
  if (WIN && pid) spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => {}); // the venv launcher's child too
  else l.child.kill("SIGKILL");
}
/** Stop-all: kill every running sandbox. */
export function stopAllSandboxes(): number { let n = 0; for (const l of st.live.values()) { kill(l); n++; } return n; }

async function copyIn(work: string, files: { name: string; from: "attached" | "vault" }[], chat?: string): Promise<{ names: string[] } | { error: string }> {
  let total = 0;
  const names: string[] = [];
  for (const f of files) {
    const dest = path.join(work, inName(f.name));
    if (f.from === "attached") {
      const data = attachedIn(chat).get(f.name)!;
      total += data.byteLength;
      if (total > MAX_BYTES_IN) return { error: "the files are too big together (max 200 MB)" };
      const why = fileRefusal(f.name, Buffer.from(data.subarray(0, 4096)).toString("latin1"));
      if (why) return { error: why };
      await writeFile(dest, data);
    } else {
      const v = await import("./vault");
      const r = await v.readStream(f.name, null).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
      if ("error" in r) return { error: `couldn't read ${f.name} from VAULT: ${r.error}` };
      total += r.size;
      if (total > MAX_BYTES_IN) return { error: "the files are too big together (max 200 MB)" };
      if (!r.stream) return { error: `couldn't read ${f.name} from VAULT` };
      await pipeline(Readable.fromWeb(r.stream as import("node:stream/web").ReadableStream<Uint8Array>), createWriteStream(dest));
      const why = fileRefusal(f.name, (await readFile(dest)).subarray(0, 4096).toString("latin1"));
      if (why) { await rm(dest, { force: true }); return { error: why }; }
    }
    names.push(inName(f.name));
  }
  return { names };
}

/** sandbox_run: the tool result text (never throws). */
export async function runSandbox(input: Record<string, unknown>, c: { chat?: string; signal?: AbortSignal; question?: string }): Promise<string> {
  if (stopAllOn()) return "Error: ORBIT is paused (Stop-all is on)";
  const lang = langOf(input.language);
  if (!lang) return 'Error: language must be "python" or "js"';
  const code = codeOf(input.code);
  if ("error" in code) return `Error: ${code.error}`;
  if (st.live.size >= MAX_RUNNING) return "Error: two sandbox runs are already going; wait for one to finish";
  const py = lang === "python" ? sandboxPython() : null;
  if (lang === "python" && !py) return "Error: the Python sandbox isn't set up on this PC yet. Tell him to run once: powershell -NoProfile -ExecutionPolicy Bypass -File tools\\sandbox\\setup.ps1";
  let vaultNames: string[] = [];
  if (Array.isArray(input.files) && input.files.length) vaultNames = (await (await import("./vault")).listVault().catch(() => [])).map((f) => f.name);
  const picked = pickFiles(input.files, [...attachedIn(c.chat).keys()], vaultNames, c.question ?? "");
  if ("error" in picked) return `Error: ${picked.error}`;
  const limits = limitsFrom(input);
  void sweep();

  const id = `sb${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const work = path.join(ROOT(), id);
  await mkdir(path.join(work, ".mpl"), { recursive: true });
  const copied = await copyIn(work, picked.files, c.chat);
  if ("error" in copied) { await rm(work, { recursive: true, force: true }).catch(() => {}); return `Error: ${copied.error}`; }
  await writeFile(path.join(work, lang === "python" ? "main.py" : "main.js"), code.code, "utf8");
  const limitsPath = path.join(work, ".limits.json");
  await writeFile(limitsPath, JSON.stringify(limits));

  const harness = path.join(TOOLS(), lang === "python" ? "run.py" : "run.mjs");
  const bin = lang === "python" ? py! : process.execPath;
  const args = lang === "python" ? ["-I", harness, limitsPath]
    : [permFlag(), `--allow-fs-read=${work}`, `--allow-fs-read=${harness}`, `--allow-fs-write=${work}`, `--max-old-space-size=${limits.memoryMb}`, "--disallow-code-generation-from-strings", harness, limitsPath];
  const started = Date.now();
  let stdout = "", stderr = "", timedOut = false;
  const child = spawn(bin, args, { cwd: work, env: sandboxEnv(process.env, work, WIN, path.dirname(bin)) as NodeJS.ProcessEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const live: Live = { child, stopped: false };
  st.live.set(id, live);
  child.stdout!.setEncoding("utf8").on("data", (d: string) => { if (stdout.length < OUT_CAP) stdout += d; });
  child.stderr!.setEncoding("utf8").on("data", (d: string) => { if (stderr.length < OUT_CAP) stderr += d; });
  const timer = setTimeout(() => { timedOut = true; kill(live); }, (limits.wallSec + 5) * 1000); // the harness stops itself at wallSec; this is the backstop
  const onAbort = () => kill(live);
  c.signal?.addEventListener("abort", onAbort, { once: true });
  const [codeN, sig] = await new Promise<[number | null, string | null]>((resolve) => {
    child.on("error", (e) => { stderr += `\n${e.message}`; resolve([null, null]); });
    child.on("close", (n, s) => resolve([n, s]));
  });
  clearTimeout(timer);
  c.signal?.removeEventListener("abort", onAbort);
  st.live.delete(id);
  const end = endOf(codeN, sig, timedOut, live.stopped && !timedOut, stderr, Date.now() - started);

  const listing: OutFile[] = [];
  for (const name of await readdir(work).catch(() => [] as string[])) {
    const s = await stat(path.join(work, name)).catch(() => null);
    if (s?.isFile()) listing.push({ name, size: s.size, mtimeMs: s.mtimeMs });
  }
  const outputs = outputsOf(listing, started, copied.names);
  const previews: Record<string, string> = {};
  for (const f of outputs.filter((o) => /\.(csv|tsv)$/i.test(o.name)).slice(0, 3)) {
    const head = (await readFile(path.join(work, f.name), "utf8").catch(() => "")).slice(0, 20_000);
    previews[f.name] = csvTable(head, 10, 8, /\.tsv$/i.test(f.name) ? "\t" : undefined);
  }
  return resultText({ id, lang: lang as SbLang, end, stdout, stderr: cleanTrace(stderr, work, harness), outputs, inputs: copied.names, previews, limits });
}

/** The error without the harness's own frames and folder paths (he and CORE only need main.py's lines). */
const cleanTrace = (err: string, work: string, harness: string) => err.split(work + path.sep).join("").split("\n")
  .filter((l) => !l.includes(harness) && !/^\s+at (?:Script\.runInThisContext|Object\.runInThisContext|ModuleJob\.run|async |file:)|\(node:internal|node:vm/.test(l)).join("\n");

/** One output of a run, for /api/sandbox/file and sandbox_save; null when it isn't there (or the run is gone). */
export async function readOutput(run: unknown, name: unknown): Promise<{ name: string; data: Buffer } | null> {
  const n = outName(name);
  if (typeof run !== "string" || !RUN_ID.test(run) || !n) return null;
  const p = path.join(ROOT(), run, n);
  if (path.dirname(p) !== path.join(ROOT(), run)) return null;
  const s = await stat(p).catch(() => null);
  if (!s?.isFile() || s.size > 25 * 1024 * 1024) return null;
  return { name: n, data: await readFile(p) };
}

/** sandbox_save: one run output → a new VAULT file (TIME MACHINE Undo moves it to the trash). */
export async function saveOutput(input: Record<string, unknown>): Promise<string> {
  const t = saveTarget(input);
  if ("error" in t) return `Error: ${t.error}`;
  const f = await readOutput(t.run, t.name);
  if (!f) return `Error: run ${t.run} has no file "${t.name}" (runs are kept for 3 hours)`;
  const { saveUpload } = await import("./vault");
  const saved = await saveUpload(new File([f.data as BlobPart], t.as), { made: "Made in the code sandbox" });
  return `Done: saved "${saved}" in VAULT.`;
}

export const SANDBOX_TOOLS = ["sandbox_run", "sandbox_save"] as const;
export async function runSandboxTool(tool: string, input: Record<string, unknown>, c: { chat?: string; signal?: AbortSignal; question?: string }): Promise<string> {
  try {
    return tool === "sandbox_save" ? await saveOutput(input) : await runSandbox(input, c);
  } catch (e) {
    return `Error: the sandbox failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}
