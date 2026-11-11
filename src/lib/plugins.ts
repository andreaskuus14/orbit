import { statSync } from "node:fs";
import { readStore, readStoreSync, writeStore } from "./safe-file.ts";
import { mkdir, readdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
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
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { randomToken, sameSecret } from "./yt-analytics-pure.ts";
import { checkArgs, expiresAt, makeState, needsRefresh, SIGN_IN_FIRST, stateFresh, stateName, claimPending, cleanTool, connectError, gates, toolId, outsideIn, parsePending, parsePlugins, parseToolId, pluginAct, pluginPrompt, pluginSchemas, resultText, PENDING_MAX, type Pending, type Plugin } from "./plugins-pure.ts";

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
    : new (await import("@modelcontextprotocol/sdk/client/streamableHttp.js")).StreamableHTTPClientTransport(new URL(p.url!), p.oauth
      ? { authProvider: await freshProvider(p) }
      : p.headers ? { requestInit: { headers: p.headers } } : undefined);
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
  } catch (e) { error = connectError(e, p, await oauthSecrets(p)); }
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
    const why = connectError(e, p, await oauthSecrets(p));
    out = unknown ? `Error: plugin ${p.name} ${tool}: outcome unknown (${why}). It may or may not have run; check ${p.name} before trying again.` : `Error: plugin ${p.name} ${tool} failed: ${why}`;
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

// ---- OAuth sign-in (MCP authorization) for http plugins with "oauth": true ----
// Same at-rest pattern as gcal-oauth.json: one file per plugin in <data dir>/plugin-oauth/ (dir 0700, file 0600, tmp + rename),
// never in plugins.json, never in an API answer, a log, Activity or a prompt. The SDK runs discovery (protected-resource and
// authorization-server metadata), dynamic client registration, PKCE (S256) and the token/refresh requests through this provider.
type OAuthFile = { redirect?: string; client?: Record<string, unknown>; tokens?: Record<string, unknown> & { access_token: string; refresh_token?: string }; exp?: number; verifier?: string; state?: string; stateAt?: string };
const oauthFile = (name: string) => path.join(orbitDataDir(), "plugin-oauth", `${name}.json`);
const readOAuth = async (name: string): Promise<OAuthFile> => { try { return JSON.parse(await readFile(oauthFile(name), "utf8")) ?? {}; } catch { return {}; } };
const og = globalThis as unknown as { __orbitOAuthSave?: Map<string, Promise<unknown>>; __orbitOAuthRefresh?: Map<string, Promise<unknown>> };
const saves = (og.__orbitOAuthSave ??= new Map()), refreshing = (og.__orbitOAuthRefresh ??= new Map());
/** Serialized per plugin: the SDK saves client, verifier and tokens in quick succession. */
function editOAuth(name: string, fn: (f: OAuthFile) => OAuthFile | null): Promise<void> {
  const p = (saves.get(name) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const f = oauthFile(name), next = fn(await readOAuth(name));
    if (!next) return void (await rm(f, { force: true }));
    await mkdir(path.dirname(f), { recursive: true, mode: 0o700 });
    await writeFile(f + ".tmp", JSON.stringify(next), { mode: 0o600 });
    await rename(f + ".tmp", f);
  });
  saves.set(name, p);
  return p;
}
/** Token values to blank out of any error text (a server echoing them back). */
const oauthSecrets = async (p: Plugin) => {
  if (!p.oauth) return [];
  const t = (await readOAuth(p.name)).tokens;
  return [t?.access_token, t?.refresh_token].filter((x): x is string => typeof x === "string");
};

/** interactive: only his Sign in click may start a browser login; a tool call or Test without tokens fails with SIGN_IN_FIRST. */
function provider(p: Plugin, redirect: string | undefined, interactive: boolean, onRedirect: (u: URL) => void = () => {}): OAuthClientProvider {
  const redirectUrl = redirect ?? "http://127.0.0.1:3000/api/plugins/oauth"; // set at his Sign in click; this default only feeds refresh
  return {
    get redirectUrl() { return redirectUrl; },
    get clientMetadata() {
      return { client_name: "ORBIT", redirect_uris: [redirectUrl], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
    },
    state: async () => {
      if (!interactive) throw new Error(SIGN_IN_FIRST);
      const state = makeState(p.name, randomToken());
      await editOAuth(p.name, (f) => ({ ...f, redirect: redirectUrl, state, stateAt: new Date().toISOString() }));
      return state;
    },
    clientInformation: async () => (await readOAuth(p.name)).client as never,
    saveClientInformation: (client) => editOAuth(p.name, (f) => ({ ...f, client: client as Record<string, unknown> })),
    tokens: async () => (await readOAuth(p.name)).tokens as never,
    saveTokens: (tokens) => editOAuth(p.name, (f) => ({ ...f, tokens: tokens as OAuthFile["tokens"], exp: expiresAt(tokens.expires_in, Date.now()) })),
    redirectToAuthorization: (u) => { if (!interactive) throw new Error(SIGN_IN_FIRST); onRedirect(u); },
    saveCodeVerifier: (verifier) => editOAuth(p.name, (f) => ({ ...f, verifier })),
    codeVerifier: async () => { const v = (await readOAuth(p.name)).verifier; if (!v) throw new Error("no sign-in in progress"); return v; },
    invalidateCredentials: (scope) => editOAuth(p.name, (f) => {
      if (scope === "all") return null;
      const n = { ...f };
      if (scope === "client") delete n.client;
      if (scope === "tokens") { delete n.tokens; delete n.exp; }
      if (scope === "verifier") delete n.verifier;
      return n;
    }),
  };
}

/** Provider for a connection; refreshes first when the access token expires within 2 minutes (one refresh at a time per plugin). */
async function freshProvider(p: Plugin): Promise<OAuthClientProvider> {
  const f = await readOAuth(p.name), prov = provider(p, f.redirect, false);
  if (f.tokens?.refresh_token && needsRefresh(f.exp, Date.now())) {
    const { auth } = await import("@modelcontextprotocol/sdk/client/auth.js");
    const r = refreshing.get(p.name) ?? auth(prov, { serverUrl: p.url! }).finally(() => refreshing.delete(p.name));
    refreshing.set(p.name, r);
    await r.catch(() => {}); // a refused refresh drops the tokens (SDK invalidateCredentials); the connect then reports SIGN_IN_FIRST
  }
  return prov;
}

export const oauthSignedIn = async (name: string) => !!(await readOAuth(name)).tokens?.access_token;

/** His Sign in click: discovery + registration + PKCE; returns the authorization-server URL to open, or "" if already signed in. */
export async function startOAuth(name: string, redirect: string): Promise<{ url?: string; error?: string }> {
  const p = loadPlugins().find((x) => x.name === name);
  if (!p?.oauth || !p.url) return { error: "not an oauth plugin" };
  const { auth } = await import("@modelcontextprotocol/sdk/client/auth.js");
  let url: URL | undefined;
  await editOAuth(name, (f) => ({ ...f, redirect, ...(f.redirect && f.redirect !== redirect ? { client: undefined } : {}) })); // new port: register again
  try {
    const r = await auth(provider(p, redirect, true, (u) => { url = u; }), { serverUrl: p.url });
    if (r === "AUTHORIZED") return {}; // refresh worked: nothing to open
  } catch (e) { return { error: connectError(e, { url: p.url }, await oauthSecrets(p)) }; }
  return url ? { url: url.href } : { error: "the server gave no sign-in page" };
}

/** The browser coming back: the state must be the one saved at his click (constant time, 10 min, used once). */
export async function finishOAuth(state: string, code: string): Promise<{ name?: string; error?: string }> {
  const name = stateName(state), p = name ? loadPlugins().find((x) => x.name === name) : undefined;
  if (!name || !p?.oauth || !p.url) return { error: "state" };
  const f = await readOAuth(name);
  const ok = !!f.state && sameSecret(f.state, state) && stateFresh(f.stateAt, Date.now());
  await editOAuth(name, (x) => ({ ...x, state: undefined, stateAt: undefined })); // used once, also when wrong
  if (!ok) return { name, error: "state" };
  const { auth } = await import("@modelcontextprotocol/sdk/client/auth.js");
  try {
    await auth(provider(p, f.redirect, true), { serverUrl: p.url, authorizationCode: code });
  } catch { return { name, error: "exchange" }; } // the SDK's message may quote the server's answer: not shown
  await editOAuth(name, (x) => ({ ...x, verifier: undefined }));
  logActivity({ area: "system", title: `Plugin ${name}: signed in` });
  return { name };
}

/** Sign out: forget tokens and the registered client on this PC. shortcut: no RFC 7009 revoke call; add it if a server lists revocation_endpoint and he wants the grant killed server-side too. */
export async function signOutOAuth(name: string) {
  await editOAuth(name, () => null);
  logActivity({ area: "system", title: `Plugin ${name}: signed out` });
}
