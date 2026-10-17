// Boot self-test + crash watcher: pure parts (log patterns, read ranges, the bell decision). No I/O; tested in tests/doctor-boot.test.ts.
// I/O lives in doctor-boot.ts. Log text never leaves this machine: only our own plain-English explanations go into results.
import type { Check, Report } from "./doctor-pure.ts";
import type { NotifyDetail } from "./notify-pure.ts";

export type Crash = { id: string; what: string; fix: string };
export type Scan = { crashes: Crash[]; exits: string[]; starts: number };
export type BootResult = { bootId: string; at: string; report: Report; scan: Scan; notice: NotifyDetail | null };
/** Where we stopped reading a log last time; id tells a rotated/recreated file apart (birth time). */
export type Mark = { offset: number; id: string };
export type Range = { rotated: boolean; start: number; end: number };

export const READ_CAP = 256 * 1024;

// First match per line wins, so specific patterns come before generic ones; generic ones are dropped when a specific one explains the crash.
const PATTERNS: (Crash & { re: RegExp; generic?: true })[] = [
  { id: "whisper-lock", re: /Entering the V8 API without proper locking/i, what: "Whisper (speech-to-text) crashed while loading two models at once",
    fix: "The update that loads one Whisper model at a time fixes this. If a clip job failed, start it again." },
  { id: "oom", re: /heap out of memory|Allocation failed|ENOMEM/i, what: "ORBIT ran out of memory",
    fix: "Close big programs (games, many browser tabs) and try again. If it keeps happening, ask Claude Code to look at orbit-server.log." },
  { id: "port", re: /EADDRINUSE/, what: "Another program was already using ORBIT's port (3000)",
    fix: "Run npm run app:stop, then start ORBIT from the desktop shortcut." },
  { id: "no-build", re: /Could not find a production build|ENOENT.{0,300}[\\/]\.next[\\/]/i, what: "ORBIT's built version was missing or half-written",
    fix: "Run npm run app:rebuild." },
  { id: "whisper", re: /onnxruntime|onnx-community|transformers.{0,300}(?:Error|abort)/i, what: "Whisper (speech-to-text) crashed",
    fix: "Usually a one-off; start the clip job again. If it repeats, ask Claude Code to look at orbit-server.log." },
  { id: "fatal", re: /FATAL ERROR|Segmentation fault|SIGSEGV|SIGABRT/, what: "Node.js crashed inside native code", generic: true,
    fix: "Usually a one-off. If it repeats, ask Claude Code to look at orbit-server.log." },
  { id: "unhandled", re: /Unhandled ?Rejection|unhandled ?(?:promise|error|exception)/i, what: "A background task threw an error nobody caught", generic: true,
    fix: "If it repeats, ask Claude Code to look at orbit-server.log." },
  { id: "uncaught", re: /uncaught ?exception|\buncaught\b/i, what: "The server hit an error it didn't catch", generic: true,
    fix: "If it repeats, ask Claude Code to look at orbit-server.log." },
  { id: "exit", re: /npm (?:ERR!|error) (?:code|command failed)|ELIFECYCLE|exited with code [1-9]|Process exited/i, what: "The server process stopped unexpectedly", generic: true,
    fix: "The supervisor restarted it. If it repeats, ask Claude Code to look at orbit-server.log." },
];
const LOOP = 3; // this many server starts between two self-tests = restart loop

/** Byte range of a log to read since `prev`; rotated = the file was replaced or shrank (then the old part is in "<log>.1").
 *  No previous mark (first run, or a lost/corrupt state file) starts at the end, so old crashes aren't reported as new. */
export function readRange(prev: Mark | null, size: number, id: string, cap = READ_CAP): Range {
  if (!prev) return { rotated: false, start: size, end: size };
  const rotated = prev.id !== id || size < prev.offset;
  return { rotated, start: Math.max(rotated ? 0 : prev.offset, size - cap), end: size };
}

/** Bytes of a chunk to consume: up to its last newline, so a line still being written is read whole next time.
 *  A full chunk without any newline is consumed anyway (else it would never advance). */
export function consumed(buf: Uint8Array, cap = READ_CAP): number {
  const nl = buf.lastIndexOf(0x0a);
  return nl >= 0 ? nl + 1 : buf.length >= cap ? buf.length : 0;
}

type State = { server?: Mark; launcher?: Mark };
const isMark = (m: unknown): m is Mark => !!m && typeof m === "object" && Number.isSafeInteger((m as Mark).offset) && (m as Mark).offset >= 0 && typeof (m as Mark).id === "string";
/** doctor-boot.json text → state; anything malformed is dropped (that log then starts fresh at its end). */
export function parseState(raw: string | null): State {
  let v: unknown;
  try { v = JSON.parse(raw ?? "{}"); } catch { return {}; }
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return { ...(isMark(o.server) ? { server: o.server } : {}), ...(isMark(o.launcher) ? { launcher: o.launcher } : {}) };
}

/** Server log (crash causes, server starts) + launcher log (exit times "yyyy-MM-dd HH:mm:ss ... exited unexpectedly"). */
export function scanLogs(server: string, launcher: string): Scan {
  const found = new Map<string, Crash & { generic?: true }>();
  let starts = 0;
  for (const full of server.split(/\r?\n/)) {
    const line = full.slice(0, 2048); // bounded regex work on huge lines (stack dumps, minified source)
    if (/\bStarting\.\.\./.test(line)) starts++;
    const p = PATTERNS.find((x) => x.re.test(line));
    if (p && !found.has(p.id)) found.set(p.id, p);
  }
  let crashes = [...found.values()];
  if (crashes.some((c) => !c.generic)) crashes = crashes.filter((c) => !c.generic);
  if (found.has("whisper-lock")) crashes = crashes.filter((c) => c.id !== "whisper"); // its stack trace mentions onnxruntime too
  if (starts >= LOOP) crashes.push({ id: "loop", what: `The server started ${starts} times since the last check (a restart loop)`, fix: "If ORBIT feels flaky, ask Claude Code to look at orbit-server.log." });
  const exits = launcher.split(/\r?\n/).filter((l) => l.includes("exited unexpectedly"))
    .map((l) => /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => `${m[1]} ${m[2]}`);
  return { crashes: crashes.map(({ id, what, fix }) => ({ id, what, fix })), exits, starts };
}

/** The bell after boot: only for a crash since the last boot or a failing check (warnings are left to the Doctor panel). */
export function bootNotice(scan: Scan, checks: Check[], today: string): NotifyDetail | null {
  const nav = { panel: null, doctor: true } as const;
  const fails = checks.filter((c) => c.status === "fail");
  const more = fails.length ? ` Also: ${fails.length} problem${fails.length > 1 ? "s" : ""} found (${fails.slice(0, 2).map((c) => c.label).join(", ")}).` : "";
  if (scan.crashes.length || scan.exits.length) {
    const last = scan.exits.at(-1);
    const when = last ? ` at ${last.startsWith(today) ? last.slice(11) : last}` : "";
    const why = scan.crashes[0];
    return { kind: "system", nav, title: `ORBIT restarted after a crash${when}${why ? ` — ${why.what}.` : "."}`, body: `${why ? why.fix : "Cause not recognised; the Doctor panel has details."}${more}`.trim() };
  }
  if (!fails.length) return null;
  return { kind: "system", nav, title: `ORBIT self-test: ${fails.length} problem${fails.length > 1 ? "s" : ""} after restart`,
    body: fails.slice(0, 3).map((c) => `${c.label}: ${c.detail}`).join(" · ").slice(0, 480) };
}

/** --effort shows up in `claude --help` on CLIs that support it. */
export const effortCheck = (help: string | null, version: string | null): Check => {
  const L = "Claude effort setting (--effort)";
  if (help == null) return { id: "effort", label: L, status: "ok", detail: "Couldn't ask the Claude CLI (see the Claude check)" };
  return /--effort\b/.test(help) ? { id: "effort", label: L, status: "ok", detail: `Supported${version ? ` by ${version}` : ""}` }
    : { id: "effort", label: L, status: "warn", detail: "This Claude Code is too old for --effort, so deep answers fall back to the main model", fix: "Run: claude update (or npm i -g @anthropic-ai/claude-code), then restart ORBIT." };
};
