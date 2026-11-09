import { statSync } from "node:fs";
import { readStore, readStoreSync, writeStore } from "./safe-file.ts";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
// .ts extensions: tests/plugins-io.test.ts loads this under node --experimental-strip-types (with a fake MCP server).
import { orbitDataDir } from "./data-dir.ts";
import { logActivity } from "./activity.ts";
import { stopAllOn } from "./stop-all.ts";
import { PAUSED_MSG } from "./stop-all-pure.ts";
import { UNTRUSTED } from "./policy-pure.ts";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { CLIP } from "./clip-store-pure.ts";
import { checkArgs, claimPending, cleanTool, connectError, gates, toolId, outsideIn, parsePending, parsePlugins, parseToolId, pluginAct, pluginPrompt, pluginSchemas, resultText, PENDING_MAX, type Pending, type Plugin } from "./plugins-pure.ts";

// MCP plugins: <ORBIT data dir>/plugins.json (his servers + trust settings + the tool list from the last Test connection) and
// plugin-pending.json (calls CORE queued for his Run click). CORE calls tools in-process through @modelcontextprotocol/sdk's client,
// behind policy-pure decide() like every other CORE tool; the CLI never runs plugin tools itself (that would skip decide()).
// shortcut: one short-lived connection per call (a fresh `uvx blender-mcp` costs ~1-2 s); pool connections if multi-step builds feel slow.

const file = () => path.join(orbitDataDir(), "plugins.json");
const pendingFile = () => path.join(orbitDataDir(), "plugin-pending.json");
const g = globalThis as unknown as { __orbitPlugins?: { list: Plugin[]; stamp: string }; __orbitPluginSave?: Promise<unknown>; __orbitPluginLive?: Set<{ close: () => Promise<void> }>; __orbitPluginRunning?: Set<string> };
const live = (g.__orbitPluginLive ??= new Set());
const stamp = () => { try { const s = statSync(file()); return `${s.mtimeMs}:${s.size}`; } catch { return "none"; } };

/** Sync and cached (re-read when the file changes), so CORE's prompt and decide() can use it on every turn. */
/** Full input schemas of the usable plugin tools (core-mcp.ts lists them natively). */
export const pluginSchemasNow = () => pluginSchemas(loadPlugins());

export function loadPlugins(): Plugin[] {
  const st = stamp();
  if (g.__orbitPlugins?.stamp !== st) {
    let raw: string | null = null;
    try { raw = readStoreSync(file()) || null; } catch { return []; } // locked/damaged: none usable for this read (not cached); updatePlugins refuses
    g.__orbitPlugins = { list: parsePlugins(raw), stamp: st };
  }
  return g.__orbitPlugins.list;
}

/** Serialized read-modify-write (tmp + rename) of plugins.json. fn returns the new list, or a string = refused. */
export function updatePlugins(fn: (l: Plugin[]) => Plugin[] | string): Promise<string> {
  const p = (g.__orbitPluginSave ?? Promise.resolve()).catch(() => {}).then(async () => {
    const st = stamp(), raw = readStoreSync(file()) || null; // unreadable throws: never saved over as []
    const next = fn(g.__orbitPlugins?.stamp === st ? g.__orbitPlugins.list : parsePlugins(raw));
    if (typeof next === "string") return next;
    await writeStore(file(), JSON.stringify({ plugins: next }, null, 2));
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
    // shortcut: a static token in headers only; OAuth sign-in (servers like vidIQ that hand out tokens via a browser login) is next
    : new (await import("@modelcontextprotocol/sdk/client/streamableHttp.js")).StreamableHTTPClientTransport(new URL(p.url!), p.headers ? { requestInit: { headers: p.headers } } : undefined);
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
  } catch (e) { error = connectError(e, p); }
  await updatePlugins((l) => l.map((x) => (x.name === name ? { ...x, cache: { at: new Date().toISOString(), tools: error ? x.cache?.tools ?? [] : tools, ...(error ? { error } : {}) } } : x)));
  logActivity({ area: "system", title: `Plugin ${name}: test ${error ? "failed" : `ok, ${tools.length} tools`}`, ...(error ? { detail: error } : {}) });
  return error ? { ok: false, tools: 0, error } : { ok: true, tools: tools.length };
}

const RESULTS_KEEP = 50;
/** A large result, raw, in <data dir>/plugin-results/ (newest 50 kept): CORE's per-answer read_more store holds it for the turn; this
 *  copy is for him (CORE has no tool to read it). Local only, like plugins.json. */
async function keepResult(server: string, tool: string, r: unknown) {
  const d = path.join(orbitDataDir(), "plugin-results");
  await mkdir(d, { recursive: true });
  await writeFile(path.join(d, `${new Date().toISOString().replace(/[:.]/g, "-")}-${server}-${tool.replace(/[^\w.-]/g, "_")}.json`), JSON.stringify(r));
  const old = (await readdir(d)).filter((f) => f.endsWith(".json")).sort().slice(0, -RESULTS_KEEP);
  await Promise.all(old.map((f) => unlink(path.join(d, f)).catch(() => {})));
}

/** One tools/call with the plugin's timeout; every call is logged to Activity (tool name and outcome; never arguments or results).
 *  unknown: the request was sent and then the call broke (timeout, closed connection, Stop-all): it may have run on the server. */
async function callTool(p: Plugin, tool: string, args: Record<string, unknown>, by: "core" | "owner"): Promise<{ out: string; unknown: boolean }> {
  const t0 = Date.now();
  let out: string, sent = false, unknown = false;
  try {
    const r = await withClient(p, (c, timeout) => { sent = true; return c.callTool({ name: tool, arguments: args }, undefined, { timeout, maxTotalTimeout: timeout }); });
    out = resultText(p.name, r as { content?: unknown; isError?: unknown; structuredContent?: unknown });
    if (out.length > CLIP) await keepResult(p.name, tool, r).catch((e) => console.error("[plugins] keep result:", msg(e))); // the full result outlives the turn
  } catch (e) {
    // a JSON-RPC error answer from the server (bad params, unknown tool…) is definite; a timeout or a dropped connection after
    // the request went out is not: it may have run
    const code = e instanceof McpError ? e.code : null;
    unknown = sent && (code === null || code === ErrorCode.RequestTimeout || code === ErrorCode.ConnectionClosed);
    out = unknown ? `Error: plugin ${p.name} ${tool}: outcome unknown (${connectError(e, p)}). It may or may not have run; check ${p.name} before trying again.` : `Error: plugin ${p.name} ${tool} failed: ${connectError(e, p)}`;
  }
  const failed = out.startsWith("Error:");
  logActivity({ area: by === "owner" ? "system" : "core", title: `Plugin ${p.name} → ${tool}${by === "owner" ? " (your Run click)" : ""}: ${unknown ? "outcome unknown" : failed ? "failed" : "done"} in ${((Date.now() - t0) / 1000).toFixed(1)} s`, ...(failed ? { detail: out.slice(0, 300) } : {}) });
  return { out, unknown };
}

/** For display: a locked/damaged file shows none; savePending reads it strictly and refuses, so it is never saved over. */
export const listPending = async (): Promise<Pending[]> => parsePending((await readStore(pendingFile()).catch(() => "")) || null);
async function savePending(fn: (l: Pending[]) => Pending[]) {
  const p = (g.__orbitPluginSave ?? Promise.resolve()).catch(() => {}).then(async () => {
    const next = fn(parsePending((await readStore(pendingFile())) || null)).slice(-PENDING_MAX);
    await writeStore(pendingFile(), JSON.stringify(next));
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
  return (await callTool(p, ref.tool, input, "core")).out;
}

// Queued calls running in this process right now. Disk alone can't tell "running here now" from "a crash left it attempting",
// so Run again and Discard are refused while the id is here; after a restart the set is empty and only crash leftovers show unknown.
// Single-process by design: launch.ps1 runs one supervised server on :3000 (a second one fails on the port). Two processes on one
// data dir would each have their own set, and Run again in one could repeat a call the other is still running.
const running = (g.__orbitPluginRunning ??= new Set<string>());
export const isRunning = (id: string) => running.has(id);

/** His Run click on a queued call: runs exactly the stored arguments once. The claim (attempting, plus this process's running
 *  set) is saved before the call; the item leaves the queue only after a definite outcome, so a crash or a broken call shows
 *  "outcome unknown" instead of vanishing or re-running. */
export async function runPending(id: string, again: string | null = null): Promise<{ out?: string; error?: string }> {
  if (stopAllOn()) return { error: PAUSED_MSG };
  let claim = { error: "Not in the queue any more" } as ReturnType<typeof claimPending>; // set inside the save: TS can't see that
  try {
    await savePending((l) => {
      claim = running.has(id) ? { error: "It is running right now; wait for it to finish." } : claimPending(l, id, again, new Date().toISOString());
      if (!("list" in claim)) return l;
      running.add(id); // inside the same save step as the claim: two clicks can't both pass
      return claim.list;
    });
  } catch (e) { // the claim never reached disk: nothing ran, and the id mustn't stay "running" until a restart
    if ("list" in (claim as object)) running.delete(id);
    return { error: `Couldn't save the claim, so nothing ran: ${msg(e)}` };
  }
  const c = claim as ReturnType<typeof claimPending>;
  if ("error" in c) return { error: c.error };
  try {
    const item = c.item;
    const p = loadPlugins().find((x) => x.name === item.server);
    if (!p?.enabled) {
      await savePending((l) => l.map((x) => (x.id === id ? { ...x, attempting: undefined } : x))).catch((e) => console.error("[plugins] unclaim:", msg(e)));
      return { error: `Plugin ${item.server} is removed or disabled` };
    }
    // re-checked at his click: the tool may have been refused, turned off or re-tested since CORE queued it
    const t = p.cache?.tools.find((x) => x.name === item.tool);
    const why = !t ? "it's no longer in the plugin's tool list" : gates([p])[toolId(p.name, t.name)]?.mode === "off" ? "it's off now" : checkArgs(t, item.args);
    if (why) {
      await savePending((l) => l.map((x) => (x.id === id ? { ...x, attempting: undefined } : x))).catch((e) => console.error("[plugins] unclaim:", msg(e)));
      return { error: `Not run: ${item.server} ${item.tool}: ${why}. Discard it, or have CORE queue it again.` };
    }
    const { out, unknown } = await callTool(p, item.tool, item.args, "owner");
    // a definite outcome (done, or the server said it failed) leaves the queue; an unknown one stays attempting for his decision
    if (!unknown) await savePending((l) => l.filter((x) => x.id !== id)).catch((e) => { // the result still reaches him; the item would wrongly look unknown later
      logActivity({ area: "system", title: `Plugin ${item.server} → ${item.tool}: finished, but it couldn't be removed from the queue`, detail: msg(e) });
    });
    return { out };
  } finally { running.delete(id); }
}

/** Discard a queued call; refused while it is running here (it would look cancelled while it keeps going). */
export async function discardPending(id: string): Promise<string | undefined> {
  let refused = false; // checked inside the save step, after any Run claim queued before it
  await savePending((l) => (running.has(id) ? ((refused = true), l) : l.filter((x) => x.id !== id)));
  return refused ? "It is running right now; wait for it to finish." : undefined;
}
