import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CLAUDE_BIN, FAST_MODEL, MODEL, type createLaneLimiter } from "./claude";
import { parseStreamJsonLine, takeLines, type StreamResult } from "./streamjson";
import {
  STATUS_PROMPT, buildPrompt, createToolGuard, guardEvent, imageFromStreamLine, safeModel, safePath, mcpConfigJson, parseBuildResult, parseConfig, parsePlan, parseStatus, planExpired, planPrompt, toolFlags,
  type BuildResult, type Item, type Mode, type PlanResult,
} from "./roblox-pure";

// Roblox Studio bridge: a separate `claude -p` whose ONLY tools are an allowlist of the owner's Roblox Studio MCP server
// (no built-in tools, no other MCP servers, unlisted tools denied), checked again at runtime against the CLI's own tool list and every tool call. Mirrors claude.ts's Windows-safe spawn/kill without changing it.

const WIN = process.platform === "win32";
const TIMEOUT: Record<Mode, number> = { status: 40_000, plan: 120_000, build: 240_000 };
const SYSTEM = "You are ORBIT's Roblox Studio helper. You act only through the Roblox Studio tools you are given. Be brief and factual; never invent instance names or paths you did not see in tool results.";

export const robloxConfig = () => parseConfig(process.env);

type Run = { text: string; image: string | null };
const MAX_OUT = 2_000_000; // chars of stdout line buffer / stderr / streamed text before the run is stopped

/** Shares claude.ts's global CLI limiter (created when claude.ts loads) so this never exceeds ORBIT's process cap. */
const lanes = () => (globalThis as unknown as { __orbitClaudeLanes?: ReturnType<typeof createLaneLimiter> }).__orbitClaudeLanes;

async function runStudio(mode: Mode, prompt: string, item?: Item): Promise<Run> {
  const cfg = robloxConfig();
  if (!cfg.configured) throw new Error("Roblox Studio bridge is not set up");
  const go = () => spawnStudio(mode, prompt, cfg, item);
  const slot = lanes();
  return slot ? slot("foreground", go) : go();
}

async function spawnStudio(mode: Mode, prompt: string, cfg: { command: string; args: string[] }, item?: Item): Promise<Run> {
  const model = mode === "status" ? FAST_MODEL : MODEL;
  if (!safeModel(model)) throw new Error("ORBIT_MODEL / ORBIT_MODEL_FAST contains invalid characters");
  const { allowed, disallowed } = toolFlags(mode, item);
  const guard = createToolGuard(mode, item);
  // Per-run temp dir holds the system prompt and the mcp-config; removed after the run.
  const dir = await mkdtemp(path.join(os.tmpdir(), "orbit-rbx-"));
  try {
    const sysFile = path.join(dir, "system.txt"), mcpFile = path.join(dir, "mcp.json");
    if (!safePath(sysFile) || !safePath(mcpFile)) throw new Error(`ORBIT's temp folder path (${dir}) contains characters that can't be passed safely to Claude Code. Set TEMP to a plain path.`);
    await writeFile(sysFile, SYSTEM, "utf8");
    await writeFile(mcpFile, mcpConfigJson(cfg), "utf8");
    const q = (a: string) => (WIN ? `"${a}"` : a);
    // No user text on the command line: the prompt goes on stdin; tool names, model and paths are ours and validated.
    const args = ["-p", "--output-format", "stream-json", "--verbose", "--tools", q(""), "--no-session-persistence",
      "--setting-sources", "local", "--disable-slash-commands",
      "--mcp-config", q(mcpFile), "--strict-mcp-config", "--no-chrome",
      "--allowedTools", q(allowed.join(",")), "--disallowedTools", q(disallowed.join(",")),
      "--permission-mode", "dontAsk", // never prompt; hard blocks are --disallowedTools plus the runtime guard below
      "--model", model, "--system-prompt-file", q(sysFile)];
    const opts = { stdio: ["pipe", "pipe", "pipe"] as ("pipe")[], env: process.env, cwd: dir, windowsHide: true };
    const child = WIN ? spawn(`${q(CLAUDE_BIN)} ${args.join(" ")}`, { ...opts, shell: true }) : spawn(CLAUDE_BIN, args, opts);
    return await new Promise<Run>((resolve, reject) => {
      let buf = "", err = "", streamed = "", image: string | null = null, settled = false;
      let result: StreamResult | null = null, stopped: Error | null = null;
      const settle = (f: () => void) => { if (!settled) { settled = true; clearTimeout(timer); f(); } };
      // Kill and wait for the process to exit before rejecting (so the build lock is held until it is really gone); 10 s fallback.
      const stop = (msg: string) => {
        if (stopped) return;
        stopped = new Error(msg);
        killTree(child);
        setTimeout(() => settle(() => reject(stopped)), 10_000);
      };
      const ms = TIMEOUT[mode];
      const timer = setTimeout(() => stop(`Roblox Studio didn't answer within ${ms / 1000} seconds. Is Studio open and responsive?`), ms);
      const handle = (line: string) => {
        if (stopped) return;
        const gev = guardEvent(line);
        if (gev && "init" in gev) { const bad = guard.init(gev.init); if (bad) return stop(bad); }
        for (const u of gev?.toolUses ?? []) { const bad = guard.use(u.name, u.input); if (bad) return stop(bad); }
        const ev = parseStreamJsonLine(line);
        if (ev?.delta) streamed += ev.delta;
        if (ev?.result) result = ev.result;
        image = imageFromStreamLine(line) ?? image;
        if (streamed.length > MAX_OUT) stop("Studio's answer was too large. Stopped.");
      };
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (d: string) => {
        const { lines, rest } = takeLines(buf + d);
        buf = rest;
        lines.forEach(handle);
        if (buf.length > MAX_OUT) { buf = ""; stop("Studio's answer was too large. Stopped."); }
      });
      child.stderr.on("data", (d) => { err += d; if (err.length > MAX_OUT) { err = err.slice(0, 1000); stop("Claude Code wrote too much error output. Stopped."); } });
      child.on("error", (e) => settle(() => reject(new Error(`Could not start "${CLAUDE_BIN}": ${e.message}`))));
      child.on("close", (code) => settle(() => {
        if (stopped) return reject(stopped);
        if (buf.trim()) handle(buf);
        if (stopped) return reject(stopped);
        const r = result as StreamResult | null;
        if (!r) return reject(new Error(`Claude Code failed: ${err.slice(0, 300) || `exit ${code}`}`));
        if (r.isError || code !== 0) return reject(new Error((r.text || err || `claude exited ${code}`).slice(0, 500)));
        resolve({ text: (r.text || streamed).trim(), image });
      }));
      child.stdin.on("error", () => {});
      child.stdin.end(prompt);
    });
  } finally {
    rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
}

function killTree(child: { pid?: number; kill: (sig?: NodeJS.Signals) => boolean }) {
  if (WIN && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => child.kill("SIGKILL"));
  else child.kill("SIGKILL");
}

/* State lives on globalThis so dev hot reloads keep plans, the build lock and the status cache. */
type Plan = { id: string; userId: string; item: Item; plan: PlanResult; createdAt: number };
type Status = { open: boolean; place: string; notes: string };
type State = { plans: Map<string, Plan>; busy: boolean; status?: { at: number; p: Promise<Status> } };
const g = globalThis as unknown as { __orbitRbx?: State };
const st: State = (g.__orbitRbx ??= { plans: new Map(), busy: false });

export class RobloxBusyError extends Error {}

async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (st.busy) throw new RobloxBusyError("ORBIT is already working in Roblox Studio. Wait for it to finish.");
  st.busy = true;
  try { return await fn(); } finally { st.busy = false; }
}

/** Studio open? Cached 30 s (failures too, so a closed Studio isn't re-polled on every render). */
export function studioStatus(): Promise<Status> {
  const now = Date.now();
  if (st.status && now - st.status.at < 30_000) return st.status.p;
  const p = runStudio("status", STATUS_PROMPT).then(
    (r) => parseStatus(r.text) ?? { open: false, place: "", notes: "Couldn't read Studio's answer." },
    (e: unknown) => ({ open: false, place: "", notes: e instanceof Error ? e.message : String(e) }),
  );
  st.status = { at: now, p };
  return p;
}

export async function makePlan(userId: string, item: Item): Promise<{ planId: string; expiresAt: number } & PlanResult> {
  return exclusive(async () => {
    const r = await runStudio("plan", planPrompt(item));
    const plan = parsePlan(r.text);
    if (!plan) throw new Error("ORBIT couldn't read the plan from Studio. Try again.");
    const now = Date.now();
    for (const [k, v] of st.plans) if (planExpired(v.createdAt, now)) st.plans.delete(k);
    const id = randomUUID();
    if (plan.ready) st.plans.set(id, { id, userId, item, plan, createdAt: now });
    return { planId: plan.ready ? id : "", expiresAt: now + 10 * 60_000, ...plan };
  });
}

export class PlanError extends Error {}

export async function runBuild(userId: string, planId: string): Promise<BuildResult & { image: string | null }> {
  const p = st.plans.get(planId);
  if (!p || p.userId !== userId) throw new PlanError("That plan wasn't found. Make a new plan.");
  if (planExpired(p.createdAt, Date.now())) { st.plans.delete(planId); throw new PlanError("That plan expired (plans last 10 minutes). Make a new plan."); }
  return exclusive(async () => {
    st.plans.delete(planId); // single use
    st.status = undefined;
    const r = await runStudio("build", buildPrompt(p.item, p.plan.text), p.item);
    const out = parseBuildResult(r.text);
    return out ? { ...out, image: r.image } : { done: false, inserted: [], notes: `Studio finished but ORBIT couldn't read the result. Check Workspace. ${r.text.slice(-300)}`, image: r.image };
  });
}
