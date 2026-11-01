import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { LOG_CAP, apiEndpoints, apiRoutes, idleExpired, inside, minimalEnv, nodeArgs, smokePlan, smokeReport, startBlocked, type SmokeResult } from "./ws-server-pure.ts";

// Local demo servers for full-stack workspaces (ws-server-pure.ts has the rules). One per workspace key, 127.0.0.1 only, sandboxed by
// Node's permission model, stopped by ws_stop, Stop-all (stop-all-run.ts) or 30 min without log output (each request logs a line).

type Run = { child: ChildProcess; url: string; dir: string; last: number; logBytes: number; timer: NodeJS.Timeout };
const runs = ((globalThis as unknown as { __orbitWsRuns?: Map<string, Run> }).__orbitWsRuns ??= new Map());

export const hasPermission = () => process.allowedNodeEnvironmentFlags.has("--permission");

export function freePort(): Promise<number> {
  return new Promise((ok, no) => {
    const s = net.createServer().once("error", no);
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); });
  });
}

export const serverStatus = (key: string) => { const r = runs.get(key); if (r) r.last = Date.now(); return r ? { running: true, url: r.url } : { running: false as const }; };

export function stopServer(key: string): boolean {
  const r = runs.get(key);
  if (!r) return false;
  runs.delete(key);
  clearInterval(r.timer);
  r.child.kill();
  return true;
}
export const stopAllServers = () => [...runs.keys()].filter(stopServer).length;

const up = async (url: string, child: ChildProcess) => {
  for (let i = 0; i < 50 && child.exitCode === null; i++) {
    if (await fetch(url, { signal: AbortSignal.timeout(500) }).then(() => true, () => false)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};

/** Starts <dir>/server.mjs (dir absolute, already contained by the caller). Restarts it if it was running. */
export async function startServer(key: string, dir: string, o: { stopAll?: boolean; permission?: boolean } = {}): Promise<{ url: string; routes: string[]; endpoints: Record<string, string[]> } | { error: string }> {
  const src = await readFile(path.join(dir, "server.mjs"), "utf8").catch(() => null);
  const blocked = !path.isAbsolute(dir) ? "invalid workspace folder" : startBlocked({ hasServer: src !== null, permission: o.permission ?? hasPermission(), running: runs.has(key), stopAll: !!o.stopAll });
  if (blocked) return { error: blocked };
  stopServer(key);
  const port = await freePort(), url = `http://127.0.0.1:${port}/`, log = path.join(dir, "logs", "server.log");
  if (!inside(dir, log)) return { error: "invalid log path" };
  mkdirSync(path.dirname(log), { recursive: true });
  writeFileSync(log, `--- started ${new Date().toISOString()} on ${url}\n`);
  const child: ChildProcess = spawn(process.execPath, nodeArgs(dir, true), { cwd: dir, env: minimalEnv(process.env, port) as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const run: Run = { child, url, dir, last: Date.now(), logBytes: 0, timer: setInterval(() => { if (idleExpired(run.last, Date.now())) stopServer(key); }, 60_000) };
  run.timer.unref?.();
  const write = (b: Buffer) => {
    run.last = Date.now();
    run.logBytes += b.length;
    try {
      if (run.logBytes > LOG_CAP) { writeFileSync(log, `--- log restarted (over ${LOG_CAP / 1024} KB) ${new Date().toISOString()}\n`); run.logBytes = b.length; }
      appendFileSync(log, b);
    } catch { /* a full disk must not kill the server */ }
  };
  child.stdout!.on("data", write); child.stderr!.on("data", write);
  child.on("exit", (code: number | null) => { write(Buffer.from(`--- exited (${code ?? "killed"})\n`)); if (runs.get(key) === run) { clearInterval(run.timer); runs.delete(key); } });
  runs.set(key, run);
  if (!(await up(url, child))) { stopServer(key); return { error: `server.mjs didn't start listening on PORT within 5 s; see logs/server.log` }; }
  return { url, routes: apiRoutes(src!), endpoints: apiEndpoints(src!) };
}

/** GET / and every /api route, then one POST round-trip to the data store (the posted item is deleted again when the server
 *  returns its id). */
export async function smokeCheck(url: string, routes: string[], endpoints?: Record<string, string[]>): Promise<{ line: string; issues: string[] }> {
  const base = url.replace(/\/$/, "");
  const call = async (what: string, p: string, init?: RequestInit): Promise<SmokeResult & { body?: string; status?: number }> => {
    try {
      const r = await fetch(base + p, { ...init, signal: AbortSignal.timeout(3000) }), body = await r.text();
      return { what, ok: r.ok, status: r.status, detail: r.ok ? undefined : `HTTP ${r.status} ${body.slice(0, 120)}`, body };
    } catch (e) { return { what, ok: false, detail: e instanceof Error ? e.message : String(e) }; }
  };
  const plan = smokePlan(endpoints ?? Object.fromEntries(routes.map((r) => [r, ["ANY"]])));
  const rs: SmokeResult[] = [await call("GET /", "/")];
  for (const r of plan.gets) rs.push(await call(`GET ${r}`, r));
  const target = plan.post;
  if (!target) rs.push({ what: "POST round-trip", ok: false, detail: "no /api data route to POST to" });
  else {
    const mark = `orbit smoke check ${Date.now()}`;
    const p = await call(`POST ${target}`, target, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: mark }) });
    if (!plan.readBack) {
      // A validated route (bookings, contact) rightly refuses the generic test item: a 4xx with a reason proves it validates.
      const validated = !p.ok && p.status !== undefined && p.status >= 400 && p.status < 500 && p.status !== 404;
      rs.push({ what: `POST ${target}`, ok: p.ok || validated, detail: p.ok ? undefined : validated ? undefined : p.detail });
      if (validated) rs.push({ what: `POST ${target} with real fields`, ok: false, detail: `not tested: the check only sends {text}; post a real ${target} item and read it back to prove saving works` });
    } else {
      const back = p.ok ? await call(`GET ${target}`, target) : null;
      rs.push({ what: `POST ${target} round-trip`, ok: !!back?.body?.includes(mark), detail: p.ok ? "the posted item didn't come back from GET" : p.detail });
      let id: unknown; try { id = JSON.parse(p.body ?? "").id; } catch { /* no id: nothing to clean up */ }
      if (typeof id === "string" && /^[\w-]{1,80}$/.test(id)) await call("cleanup", `${target}/${id}`, { method: "DELETE" });
    }
  }
  return smokeReport(rs);
}
