import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CLAUDE_BIN, FAST_MODEL, MODEL, type createLaneLimiter } from "./claude";
import { safeFetch } from "./memory";
import { allowedImage, urls } from "./refs-pure";
import { parseStreamJsonLine, takeLines, type StreamResult } from "./streamjson";
import {
  LAYOUT_CAPS, MAX_IMAGE_B64, createCaptureTap, historyId, historyLabel, isLayout, parseHistory, pushHistory, type HistoryEntry, PLAN_TTL_MS, POSITION_NOTE, STATUS_PROMPT, buildPrompt, hookSettingsJson, pinTarget, rawRiskLines, safeHookPath, consoleErrors, createToolTap, parsePlaytest, playtestPrompt, createToolGuard, denyFor, guardEvent, imageFromStreamLine, lastJsonLine, safeModel, safePath, mcpConfigJson, parseBuildResult, parseConfig, parsePlan,
  parseScanResult, parseScenePlan, parseStatus, planExpired, planPrompt, scanPrompt, toolFlags,
  type BuildResult, type Item, type Mode, type PlanResult, type PlaytestResult, type ScanResult, type ScenePlan,
} from "./roblox-pure";

// Roblox Studio bridge: a separate `claude -p` whose ONLY tools are an allowlist of the owner's Roblox Studio MCP server
// (no built-in tools, no other MCP servers, unlisted tools denied), checked again at runtime against the CLI's own tool list and every tool call. Mirrors claude.ts's Windows-safe spawn/kill without changing it.

const WIN = process.platform === "win32";
const TIMEOUT: Record<Mode, number> = { status: 40_000, plan: 120_000, build: 240_000, scan: 180_000, playtest: 240_000 };
const SYSTEM = "You are ORBIT's Roblox Studio helper. You act only through the Roblox Studio tools you are given. Be brief and factual; never invent instance names or paths you did not see in tool results.";

export const robloxConfig = () => parseConfig(process.env);

type Run = { text: string; image: string | null };
const MAX_OUT = 2_000_000; // chars of stderr / streamed text before the run is stopped
const MAX_LINE = MAX_IMAGE_B64 + 500_000; // one stdout line may carry a full screen_capture PNG

/** Shares claude.ts's global CLI limiter (created when claude.ts loads) so this never exceeds ORBIT's process cap. */
const lanes = () => (globalThis as unknown as { __orbitClaudeLanes?: ReturnType<typeof createLaneLimiter> }).__orbitClaudeLanes;

export type StudioRun = { mode: Mode; item?: Item; allowed: string[]; guard: ReturnType<typeof createToolGuard>; prompt: string; timeoutMs: number; onLine?: (line: string) => void };

/** One sandboxed `claude -p` against Studio: only `allowed` (full mcp__roblox__ names), every other known tool denied, `guard` checks the init list and each call. */
export async function runStudio(run: StudioRun): Promise<Run> {
  const cfg = robloxConfig();
  if (!cfg.configured) throw new Error("Roblox Studio bridge is not set up");
  const go = () => spawnStudio(run, cfg);
  const slot = lanes();
  return slot ? slot("foreground", go) : go();
}

/** Maps and packs search, insert and generate many things: they get longer than the other plans/builds. */
const timeoutFor = (mode: Mode, item?: Item) => ((item?.kind === "map" || item?.kind === "pack") && (mode === "plan" || mode === "build") ? 420_000 : TIMEOUT[mode]);
/** The standard run for a mode/item: its minimal allowlist and its guard. */
const studio = (mode: Mode, prompt: string, item?: Item, onLine?: (line: string) => void) =>
  runStudio({ mode, item, allowed: toolFlags(mode, item).allowed, guard: createToolGuard(mode, item), prompt, timeoutMs: timeoutFor(mode, item), onLine });

// First guard layer: a PreToolUse hook that judges each call before it reaches Studio (see scripts/roblox-hook.mjs).
const HOOK = path.join(process.cwd(), "scripts", "roblox-hook.mjs");
const [NODE_MAJOR, NODE_MINOR] = process.versions.node.split(".").map(Number);

async function spawnStudio({ mode, item, allowed, guard, prompt, timeoutMs: ms, onLine }: StudioRun, cfg: { command: string; args: string[] }): Promise<Run> {
  const model = mode === "status" ? FAST_MODEL : MODEL;
  if (!safeModel(model)) throw new Error("ORBIT_MODEL / ORBIT_MODEL_FAST contains invalid characters");
  const disallowed = denyFor(allowed);
  // Per-run temp dir holds the system prompt and the mcp-config; removed after the run.
  const dir = await mkdtemp(path.join(os.tmpdir(), "orbit-rbx-"));
  try {
    const sysFile = path.join(dir, "system.txt"), mcpFile = path.join(dir, "mcp.json"), setFile = path.join(dir, "settings.json"), stateFile = path.join(dir, "guard.json");
    // An older Node can't run the hook and Claude Code treats a crashed hook as "allow", so refuse to run at all.
    if (NODE_MAJOR < 22 || (NODE_MAJOR === 22 && NODE_MINOR < 7)) throw new Error(`ORBIT's Roblox bridge needs Node 22.7 or newer (this is ${process.versions.node}).`);
    await access(HOOK).catch(() => { throw new Error(`ORBIT's Roblox tool-call hook is missing (${HOOK}).`); });
    if (![process.execPath, HOOK, stateFile].every(safeHookPath)) throw new Error("The Node, ORBIT or temp folder path contains characters that can't be passed safely to Claude Code. Use plain paths.");
    await writeFile(stateFile, JSON.stringify({ mode, item, history: [] }), "utf8");
    await writeFile(setFile, hookSettingsJson(`"${process.execPath}" --experimental-strip-types --no-warnings "${HOOK}" "${stateFile}"`), "utf8");
    if (!safePath(sysFile) || !safePath(mcpFile) || !safePath(setFile)) throw new Error(`ORBIT's temp folder path (${dir}) contains characters that can't be passed safely to Claude Code. Set TEMP to a plain path.`);
    await writeFile(sysFile, SYSTEM, "utf8");
    await writeFile(mcpFile, mcpConfigJson(cfg), "utf8");
    const q = (a: string) => (WIN ? `"${a}"` : a);
    // No user text on the command line: the prompt goes on stdin; tool names, model and paths are ours and validated.
    const args = ["-p", "--output-format", "stream-json", "--verbose", "--tools", q(""), "--no-session-persistence",
      "--setting-sources", "local", "--settings", q(setFile), "--disable-slash-commands",
      "--mcp-config", q(mcpFile), "--strict-mcp-config", "--no-chrome",
      "--allowedTools", q(allowed.join(",")), "--disallowedTools", q(disallowed.join(",")),
      "--permission-mode", "dontAsk", // never prompt; hard blocks are --disallowedTools, the PreToolUse hook and the runtime guard below
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
      const timer = setTimeout(() => stop(`Roblox Studio didn't answer within ${ms / 1000} seconds. Is Studio open and responsive?`), ms);
      const handle = (line: string) => {
        if (stopped) return;
        const gev = guardEvent(line);
        if (gev && "init" in gev) { const bad = guard.init(gev.init); if (bad) return stop(bad); }
        for (const u of gev?.toolUses ?? []) { const bad = guard.use(u.name, u.input); if (bad) return stop(bad); }
        onLine?.(line);
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
        if (buf.length > MAX_LINE) { buf = ""; stop("Studio's answer was too large. Stopped."); }
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
type Plan = { id: string; userId: string; item: Item; plan: PlanResult; scene?: ScenePlan; createdAt: number };
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
  const p = studio("status", STATUS_PROMPT).then(
    (r) => parseStatus(r.text) ?? { open: false, place: "", notes: "Couldn't read Studio's answer." },
    (e: unknown) => ({ open: false, place: "", notes: e instanceof Error ? e.message : String(e) }),
  );
  st.status = { at: now, p };
  return p;
}

type PlanOut = { planId: string; expiresAt: number; scene?: ScenePlan; thumbs?: Record<string, string> } & PlanResult;
export async function makePlan(userId: string, item: Item): Promise<PlanOut> {
  const out = await exclusive(async (): Promise<PlanOut> => {
    const r = await studio("plan", planPrompt(item));
    const plan = parsePlan(r.text);
    if (!plan) throw new Error("ORBIT couldn't read the plan from Studio. Try again.");
    let scene: ScenePlan | undefined;
    if (isLayout(item) && plan.ready) {
      const s = parseScenePlan(lastJsonLine(r.text) ?? {}, LAYOUT_CAPS[item.kind]);
      if ("error" in s) throw new Error(`ORBIT couldn't use the scene plan: ${s.error} Try again.`);
      scene = s;
    }
    const now = Date.now();
    for (const [k, v] of st.plans) if (planExpired(v.createdAt, now)) st.plans.delete(k);
    const id = randomUUID();
    let stored = item;
    if (item.kind === "texture" && plan.ready) { // the guard compares generate_texture's instance_path against this exact target
      const pinned = pinTarget(item, r.text);
      if (pinned) stored = pinned;
      else { plan.ready = false; plan.notes = `${plan.notes} ORBIT couldn't find which object to re-texture. Select one MeshPart or Model in Workspace, or type its path.`.trim(); }
    }
    if (plan.ready) st.plans.set(id, { id, userId, item: stored, plan, scene, createdAt: now });
    return { planId: plan.ready ? id : "", expiresAt: now + PLAN_TTL_MS, ...plan, scene };
  });
  return out.scene?.objects.length ? { ...out, thumbs: await thumbs(out.scene.objects.map((o) => Number(o.assetId))) } : out;
}

/** Creator Store thumbnails (rbxcdn images only) for the scene table; best effort, {} on any failure. */
async function thumbs(ids: number[]): Promise<Record<string, string>> {
  try {
    const { res } = await safeFetch(urls.thumbnails(ids), "application/json", "web:orbit:0.2 (personal game-dev tool)", 500_000);
    const data = ((await res.json()) as { data?: unknown })?.data;
    const out: Record<string, string> = {};
    for (const t of Array.isArray(data) ? data : []) {
      const o = (t ?? {}) as { targetId?: unknown; state?: unknown; imageUrl?: unknown };
      const img = o.state === "Completed" ? allowedImage(o.imageUrl) : null;
      if (img && Number.isSafeInteger(o.targetId)) out[String(o.targetId)] = img;
    }
    return out;
  } catch { return {}; }
}

export class PlanError extends Error {}
export class InputError extends Error {}

/** `keep`: indexes the owner left ticked (scene/map/pack plans only; objects first, then generated items; others ignore it). */
export async function runBuild(userId: string, planId: string, keep?: number[]): Promise<BuildResult & { image: string | null; historyId?: string }> {
  const p = st.plans.get(planId);
  if (!p || p.userId !== userId) throw new PlanError("That plan wasn't found. Make a new plan.");
  if (planExpired(p.createdAt, Date.now())) { st.plans.delete(planId); throw new PlanError("That plan expired (plans last 10 minutes). Make a new plan."); }
  let item = p.item;
  if (isLayout(item)) {
    const all = p.scene?.objects ?? [], objects = all.filter((_, i) => keep?.includes(i));
    const generate = (p.scene?.generate ?? []).filter((_, i) => keep?.includes(all.length + i));
    if (!objects.length && !generate.length) throw new InputError("Tick at least one object to build.");
    item = { ...item, objects, generate, sceneName: p.scene?.scene };
  }
  if (item.kind === "texture" && !item.target) throw new PlanError("That plan has no object to re-texture. Make a new plan.");
  return exclusive(async () => {
    st.plans.delete(planId); // single use
    st.status = undefined;
    const tap = createCaptureTap();
    const r = await studio("build", buildPrompt(item, p.plan.text), item, tap.line);
    const out = parseBuildResult(r.text) ?? { done: false, inserted: [], notes: `Studio finished but ORBIT couldn't read the result. Check Workspace. ${r.text.slice(-300)}` };
    if (isLayout(item) && item.objects?.length) out.notes = `${out.notes} ${POSITION_NOTE}`.trim();
    const shots = tap.shots();
    const id = await saveHistory(userId, item, shots.before, shots.after).catch(() => undefined); // best effort: a full disk mustn't fail a finished build
    return id ? { ...out, image: null, historyId: id } : { ...out, image: r.image }; // with history, the UI loads the PNGs from there
  });
}

/** Read-only free-model scan of Workspace paths (already validated with scanPaths). */
export async function runScan(paths: string[]): Promise<ScanResult> {
  return exclusive(async () => {
    const tap = createToolTap(["script_grep", "script_read"]);
    const r = await runStudio({ mode: "scan", allowed: toolFlags("scan").allowed, guard: createToolGuard("scan"), prompt: scanPrompt(paths), timeoutMs: TIMEOUT.scan, onLine: tap.line });
    const out = parseScanResult(r.text, paths) ?? { done: false, parts: 0, meshes: 0, scripts: 0, findings: [], lag: "low", risk: "none", clean: false, notes: "ORBIT couldn't read the scan result. Try again." };
    return { ...out, raw: rawRiskLines(tap.text()) };
  });
}

/** Look-only playtest: start play, walk around, read the console, stop play. Console errors are extracted by ORBIT itself from get_console_output results. */
export async function runPlaytest(goal: string): Promise<PlaytestResult & { image: string | null }> {
  return exclusive(async () => {
    st.status = undefined;
    const tap = createToolTap(["get_console_output"]);
    const r = await runStudio({ mode: "playtest", allowed: toolFlags("playtest").allowed, guard: createToolGuard("playtest"), prompt: playtestPrompt(goal), timeoutMs: TIMEOUT.playtest, onLine: tap.line });
    const out = parsePlaytest(r.text) ?? { done: false, findings: [], notes: "ORBIT couldn't read the bot's findings. Check that play mode stopped in Studio." };
    return { ...out, consoleErrors: consoleErrors(tap.text()), image: r.image };
  });
}

/* ---------- Build history: before/after PNGs in ORBIT's local data folder (the dev-world game_saves row is capped at 256 KB, too small for screenshots) ---------- */

const histDir = () => {
  const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "orbit") : path.join(os.homedir(), ".orbit");
  return path.join(process.env.ORBIT_DATA_DIR?.trim() || local, "roblox-builds");
};
const histIndex = () => path.join(histDir(), "index.json");
const shotFile = (id: string, side: "before" | "after") => path.join(histDir(), `${id}-${side}.png`);
const hg = globalThis as unknown as { __orbitRbxHist?: Promise<unknown> };

/** Every stored row (all users), oldest first. A missing or corrupt index counts as empty (it only holds screenshots). */
async function readIndex(): Promise<HistoryEntry[]> {
  try { return parseHistory(JSON.parse(await readFile(histIndex(), "utf8"))); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT" || e instanceof SyntaxError) return []; throw e; }
}
/** This user's rows, oldest first. */
export const getHistory = async (userId: string) => (await readIndex()).filter((e) => e.userId === userId);

/** One build's screenshots (data URLs from imageFromStreamLine, already PNG-checked) → files + index row; the oldest beyond MAX_HISTORY are deleted. */
function saveHistory(userId: string, item: Item, before: string | null, after: string | null): Promise<string | undefined> {
  if (!before && !after) return Promise.resolve(undefined);
  const p = (hg.__orbitRbxHist ?? Promise.resolve()).catch(() => {}).then(async () => {
    const id = randomUUID();
    await mkdir(histDir(), { recursive: true });
    const png = (d: string) => Buffer.from(d.slice(d.indexOf(",") + 1), "base64");
    if (before) await writeFile(shotFile(id, "before"), png(before));
    if (after) await writeFile(shotFile(id, "after"), png(after));
    const { list, drop } = pushHistory(await readIndex(), { id, userId, at: new Date().toISOString(), kind: item.kind, label: historyLabel(item), before: !!before, after: !!after });
    await writeFile(`${histIndex()}.tmp`, JSON.stringify(list));
    await rename(`${histIndex()}.tmp`, histIndex());
    for (const d of drop) for (const side of ["before", "after"] as const) await rm(shotFile(d.id, side), { force: true });
    // Orphans (a crash between writing PNGs and the index, or a reset index) are swept too.
    const keep = new Set(list.map((e) => e.id));
    for (const f of await readdir(histDir())) {
      const m = /^(.+)-(before|after)\.png$/.exec(f);
      if (m && !keep.has(m[1])) await rm(path.join(histDir(), f), { force: true });
    }
    return id;
  });
  hg.__orbitRbxHist = p;
  return p;
}

/** One stored screenshot of this user's, or null. `id` and `side` are validated here (they come from the URL). */
export async function readShot(userId: string, id: unknown, side: unknown): Promise<Buffer | null> {
  if (!historyId(id) || (side !== "before" && side !== "after")) return null;
  if (!(await getHistory(userId).catch(() => [])).some((e) => e.id === id)) return null;
  try { return await readFile(shotFile(id, side)); } catch { return null; }
}
