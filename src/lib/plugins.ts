import { readFileSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
// .ts extensions: tests/plugins-io.test.ts loads this under node --experimental-strip-types (with a fake MCP server).
import { orbitDataDir } from "./data-dir.ts";
import { logActivity } from "./activity.ts";
import { stopAllOn } from "./stop-all.ts";
import { PAUSED_MSG } from "./stop-all-pure.ts";
import { UNTRUSTED } from "./policy-pure.ts";
import { CLIP } from "./clip-store-pure.ts";
import { checkArgs, cleanTool, gates, outsideIn, parsePending, parsePlugins, parseToolId, pluginAct, pluginPrompt, pluginSchemas, resultText, PENDING_MAX, type Pending, type Plugin } from "./plugins-pure.ts";

// MCP plugins: <ORBIT data dir>/plugins.json (his servers + trust settings + the tool list from the last Test connection) and
// plugin-pending.json (calls CORE queued for his Run click). CORE calls tools in-process through @modelcontextprotocol/sdk's client,
// behind policy-pure decide() like every other CORE tool; the CLI never runs plugin tools itself (that would skip decide()).
// shortcut: one short-lived connection per call (a fresh `uvx blender-mcp` costs ~1-2 s); pool connections if multi-step builds feel slow.

const file = () => path.join(orbitDataDir(), "plugins.json");
const pendingFile = () => path.join(orbitDataDir(), "plugin-pending.json");
const g = globalThis as unknown as { __orbitPlugins?: { list: Plugin[]; stamp: string }; __orbitPluginSave?: Promise<unknown>; __orbitPluginLive?: Set<{ close: () => Promise<void> }> };
const live = (g.__orbitPluginLive ??= new Set());
const stamp = () => { try { const s = statSync(file()); return `${s.mtimeMs}:${s.size}`; } catch { return "none"; } };

/** Sync and cached (re-read when the file changes), so CORE's prompt and decide() can use it on every turn. */
/** Full input schemas of the usable plugin tools (core-mcp.ts lists them natively). */
export const pluginSchemasNow = () => pluginSchemas(loadPlugins());

export function loadPlugins(): Plugin[] {
  const st = stamp();
  if (g.__orbitPlugins?.stamp !== st) {
    let raw: string | null = null;
    try { raw = readFileSync(file(), "utf8"); } catch { /* none yet */ }
    g.__orbitPlugins = { list: parsePlugins(raw), stamp: st };
  }
  return g.__orbitPlugins.list;
}

/** Serialized read-modify-write (tmp + rename) of plugins.json. fn returns the new list, or a string = refused. */
export function updatePlugins(fn: (l: Plugin[]) => Plugin[] | string): Promise<string> {
  const p = (g.__orbitPluginSave ?? Promise.resolve()).catch(() => {}).then(async () => {
    const next = fn(loadPlugins());
    if (typeof next === "string") return next;
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify({ plugins: next }, null, 2));
    await rename(file() + ".tmp", file());
    g.__orbitPlugins = { list: next, stamp: stamp() };
    return "";
  });
  g.__orbitPluginSave = p;
  return p;
}

export const pluginGates = () => gates(loadPlugins());
export const pluginPromptNow = () => pluginPrompt(loadPlugins());
/** Callable plugin tool names (the SDK engine registers these next to the module tools). */
export const pluginToolNames = () => Object.entries(pluginGates()).filter(([, x]) => x.mode !== "off").map(([k]) => k);

type Client = InstanceType<typeof import("@modelcontextprotocol/sdk/client/index.js").Client>;
async function withClient<T>(p: Plugin, fn: (c: Client, timeout: number) => Promise<T>): Promise<T> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const transport = p.command
    // stderr ignored: an unread pipe could fill up and stall the server (uvx prints install progress there)
    ? new (await import("@modelcontextprotocol/sdk/client/stdio.js")).StdioClientTransport({ command: p.command, args: p.args, env: p.env, stderr: "ignore" })
    // shortcut: http servers get no auth headers or OAuth; add them if he needs a remote server that requires a login token
    : new (await import("@modelcontextprotocol/sdk/client/streamableHttp.js")).StreamableHTTPClientTransport(new URL(p.url!));
  const c = new Client({ name: "orbit", version: "1.0.0" });
  const handle = { close: () => c.close().catch(() => {}) };
  live.add(handle);
  const timeout = p.timeoutSec * 1000;
  try {
    await c.connect(transport, { timeout: Math.min(timeout, 30_000) });
    return await fn(c, timeout);
  } finally { live.delete(handle); await handle.close(); }
}

/** Stop-all: close every open plugin connection (kills stdio servers mid-call). */
export async function closeAllPlugins(): Promise<number> {
  const n = live.size;
  await Promise.all([...live].map((h) => h.close()));
  live.clear();
  return n;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Test connection: tools/list → cached in plugins.json (CORE's prompt and the trust settings use this list). */
export async function testPlugin(name: string): Promise<{ ok: boolean; tools: number; error?: string }> {
  const p = loadPlugins().find((x) => x.name === name);
  if (!p) return { ok: false, tools: 0, error: "no such plugin" };
  let tools: NonNullable<Plugin["cache"]>["tools"] = [], error: string | undefined;
  try {
    tools = await withClient(p, async (c, timeout) => {
      const out: unknown[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 5; i++) { // a server listing hundreds of tools would swamp CORE's prompt anyway
        const r = await c.listTools(cursor ? { cursor } : undefined, { timeout: Math.min(timeout, 30_000) });
        out.push(...r.tools);
        if (!(cursor = r.nextCursor)) break;
      }
      return out.flatMap((t) => cleanTool(t) ?? []).slice(0, 80);
    });
  } catch (e) { error = msg(e); }
  await updatePlugins((l) => l.map((x) => (x.name === name ? { ...x, cache: { at: new Date().toISOString(), tools: error ? x.cache?.tools ?? [] : tools, ...(error ? { error } : {}) } } : x)));
  logActivity({ area: "system", title: `Plugin ${name}: test ${error ? "failed" : `ok, ${tools.length} tools`}`, ...(error ? { detail: error } : {}) });
  return error ? { ok: false, tools: 0, error } : { ok: true, tools: tools.length };
}

const RESULTS_KEEP = 50;
/** A large result, raw, in <data dir>/plugin-results/ (newest 50 kept): CORE's per-answer read_more store holds it for the turn; this
 *  copy is for him and for later turns. Local only, like plugins.json. */
async function keepResult(server: string, tool: string, r: unknown) {
  const d = path.join(orbitDataDir(), "plugin-results");
  await mkdir(d, { recursive: true });
  await writeFile(path.join(d, `${new Date().toISOString().replace(/[:.]/g, "-")}-${server}-${tool.replace(/[^\w.-]/g, "_")}.json`), JSON.stringify(r));
  const old = (await readdir(d)).filter((f) => f.endsWith(".json")).sort().slice(0, -RESULTS_KEEP);
  await Promise.all(old.map((f) => unlink(path.join(d, f)).catch(() => {})));
}

/** One tools/call with the plugin's timeout; every call is logged to Activity (tool name and outcome; never arguments or results). */
async function callTool(p: Plugin, tool: string, args: Record<string, unknown>, by: "core" | "owner"): Promise<string> {
  const t0 = Date.now();
  let out: string;
  try {
    const r = await withClient(p, (c, timeout) => c.callTool({ name: tool, arguments: args }, undefined, { timeout, maxTotalTimeout: timeout }));
    out = resultText(p.name, r as { content?: unknown; isError?: unknown; structuredContent?: unknown });
    if (out.length > CLIP) await keepResult(p.name, tool, r).catch((e) => console.error("[plugins] keep result:", msg(e))); // the full result outlives the turn
  } catch (e) { out = `Error: plugin ${p.name} ${tool} failed: ${msg(e)}`; }
  const failed = out.startsWith("Error:");
  logActivity({ area: by === "owner" ? "system" : "core", title: `Plugin ${p.name} → ${tool}${by === "owner" ? " (your Run click)" : ""}: ${failed ? "failed" : "done"} in ${((Date.now() - t0) / 1000).toFixed(1)} s`, ...(failed ? { detail: out.slice(0, 300) } : {}) });
  return out;
}

export const listPending = async (): Promise<Pending[]> => parsePending(await readFile(pendingFile(), "utf8").catch(() => null));
async function savePending(fn: (l: Pending[]) => Pending[]) {
  const p = (g.__orbitPluginSave ?? Promise.resolve()).catch(() => {}).then(async () => {
    const next = fn(await listPending()).slice(-PENDING_MAX);
    await mkdir(path.dirname(pendingFile()), { recursive: true });
    await writeFile(pendingFile() + ".tmp", JSON.stringify(next));
    await rename(pendingFile() + ".tmp", pendingFile());
  });
  g.__orbitPluginSave = p;
  await p;
}

/** CORE's dispatch for plugin__<server>__<tool> (decide() already allowed it). ask-mode tools and auto writes after outside text
 *  are only queued: the exact arguments wait in Profile → Plugins for his Run click. */
export async function runPluginTool(id: string, input: Record<string, unknown>, c: { steps: string[]; pinned: boolean; chat?: string }): Promise<string> {
  const ref = parseToolId(id), plugins = loadPlugins(), all = gates(plugins), gate = all[id];
  const p = plugins.find((x) => x.name === ref?.server);
  if (!ref || !p || !gate || gate.mode === "off") return `Error: unknown or disabled plugin tool "${id.slice(0, 100)}"`;
  if (stopAllOn()) return `Error: ${PAUSED_MSG}`;
  const t = p.cache?.tools.find((x) => x.name === ref.tool);
  const bad = checkArgs(t, input); // before anything runs or queues: a queued call he approves must be callable as-is
  if (bad) return `Error: ${p.name} ${ref.tool}: ${bad}. Call it as: ${t?.schema ?? "{}"}`;
  if (pluginAct(gate, outsideIn(c.steps, UNTRUSTED, all, c.pinned)) === "queue") {
    const item: Pending = { id: randomUUID().slice(0, 8), server: ref.server, tool: ref.tool, args: input, at: new Date().toISOString(), ...(c.chat ? { chat: c.chat } : {}) };
    await savePending((l) => [...l, item]);
    logActivity({ area: "core", title: `Plugin ${p.name} → ${ref.tool}: queued for your Run click (Profile → Plugins)` });
    return `Queued, not run: ${p.name} ${ref.tool} (id ${item.id}) waits for his Run click in Profile → Plugins, where he sees the exact arguments. Tell him; nothing has happened yet.`;
  }
  return callTool(p, ref.tool, input, "core");
}

/** His Run click on a queued call: runs exactly the stored arguments once (then it leaves the queue). */
export async function runPending(id: string): Promise<{ out?: string; error?: string }> {
  if (stopAllOn()) return { error: PAUSED_MSG };
  const item = (await listPending()).find((x) => x.id === id);
  if (!item) return { error: "Not in the queue any more" };
  const p = loadPlugins().find((x) => x.name === item.server);
  if (!p?.enabled) return { error: `Plugin ${item.server} is removed or disabled` };
  await savePending((l) => l.filter((x) => x.id !== id)); // first: a double click can't run it twice
  return { out: await callTool(p, item.tool, item.args, "owner") };
}

export const discardPending = (id: string) => savePending((l) => l.filter((x) => x.id !== id));
