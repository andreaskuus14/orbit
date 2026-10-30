import path from "node:path";

// Full-stack workspaces: a workspace with server.mjs runs as a local demo server (127.0.0.1 only, never public). Pure rules here,
// tested in tests/ws-server.test.ts; the process side is ws-server.ts. Template files: FULLSTACK_TEMPLATE below.

export const IDLE_MS = 30 * 60_000;
export const LOG_CAP = 256 * 1024;
export const HEAP_MB = 128;
export const NO_NET_NOTE = "outbound network is NOT blocked: this Node version has no --allow-net, so keep the server code offline";

/** The child's whole environment: nothing from ORBIT's own (no Supabase, API keys or tokens). */
export function minimalEnv(env: Record<string, string | undefined>, port: number): Record<string, string> {
  const keep: Record<string, string> = { PORT: String(port), HOST: "127.0.0.1", NODE_ENV: "development" };
  for (const k of ["SYSTEMROOT", "TZ", "LANG"]) if (env[k]) keep[k] = env[k]!; // SYSTEMROOT: Windows sockets need it
  return keep;
}

/** Node flags for the child. permission = the installed Node has --permission (fs limited to the workspace; no child processes,
 *  workers, addons or WASI since those aren't allowed). Without it the runner refuses to start (see startBlocked). */
export const nodeArgs = (dir: string, permission: boolean) => [
  ...(permission ? ["--permission", `--allow-fs-read=${dir}`, `--allow-fs-write=${dir}`] : []),
  `--max-old-space-size=${HEAP_MB}`, "--disable-warning=ExperimentalWarning", "server.mjs",
];

/** Is p (absolute) the workspace dir or inside it? */
export const inside = (dir: string, p: string) => { const r = path.relative(dir, p); return r === "" || (!!r && !r.startsWith("..") && !path.isAbsolute(r)); };

/** Why the server can't start, or "". */
export function startBlocked(o: { hasServer: boolean; permission: boolean; running: boolean; stopAll: boolean }): string {
  if (o.stopAll) return "ORBIT is paused (Stop-all is on)";
  if (!o.hasServer) return "this workspace has no server.mjs (create it with ws_create {\"name\", \"template\": \"fullstack\"})";
  if (!o.permission) return "this Node version has no --permission sandbox, so ORBIT won't run workspace servers on it (update Node to 22.13+)";
  return "";
}

/** "/api/..." routes named in server.mjs, as string literals; ":id"-style and "*" parts are left out of the smoke check. */
export const apiRoutes = (src: string) => [...new Set([...src.matchAll(/["'`](?:[A-Z]+ )?(\/api\/[A-Za-z0-9_\-][A-Za-z0-9_\-/]*)["'`]/g)].map((m) => m[1].replace(/\/+$/, "")))];

export type SmokeResult = { what: string; ok: boolean; detail?: string };
/** The "Check:" line and the problems list (checkNote's shape in core-workspace.ts). */
export function smokeReport(rs: SmokeResult[]): { line: string; issues: string[] } {
  const bad = rs.filter((r) => !r.ok);
  return { line: `server smoke check: ${rs.length - bad.length}/${rs.length} passed (${rs.map((r) => `${r.what} ${r.ok ? "ok" : "FAIL"}`).join(", ")}); ${NO_NET_NOTE}`, issues: bad.map((r) => `${r.what}: ${r.detail ?? "failed"}`) };
}

export const idleExpired = (lastActive: number, now: number) => now - lastActive >= IDLE_MS;

/** .env.example may only name variables: every line blank, a # comment or NAME= with no value (never real secrets). */
export function envExampleError(content: string): string {
  const bad = content.split(/\r?\n/).find((l) => l.trim() && !/^\s*#/.test(l) && !/^\s*[A-Za-z_][A-Za-z0-9_]*=\s*$/.test(l));
  return bad ? `.env.example lines must be NAME= with an empty value (no secrets): "${bad.slice(0, 40)}"` : "";
}

const SERVER = `// Demo server: Node built-ins only. Runs on this PC at 127.0.0.1 (ORBIT starts it with ws_run; never public).
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addItem, deleteItem, listItems } from "./store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url)), pub = path.join(here, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
const json = (res, status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const body = (req) => new Promise((ok, no) => { let s = ""; req.on("data", (c) => { s += c; if (s.length > 1e5) no(new Error("too big")); }); req.on("end", () => ok(s)); });

const routes = {
  "GET /api/health": async () => [200, { ok: true }],
  "GET /api/items": async () => [200, await listItems()],
  "POST /api/items": async (req) => { const t = String(JSON.parse((await body(req)) || "{}").text ?? "").trim(); return t ? [201, await addItem(t)] : [400, { error: "text is required" }]; },
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  console.log(new Date().toISOString(), req.method, url.pathname);
  try {
    const del = req.method === "DELETE" && url.pathname.match(/^\\/api\\/items\\/([\\w-]+)$/);
    if (del) return json(res, (await deleteItem(del[1])) ? 200 : 404, { ok: true });
    const r = routes[\`\${req.method} \${url.pathname}\`];
    if (r) { const [s, b] = await r(req); return json(res, s, b); }
    if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "no such route" });
    const file = path.join(pub, url.pathname === "/" ? "index.html" : url.pathname);
    if (!file.startsWith(pub + path.sep)) return json(res, 403, { error: "forbidden" });
    const data = await readFile(file).catch(() => null);
    if (!data) return json(res, 404, { error: "not found" });
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" }); res.end(data);
  } catch (e) { console.error(e); json(res, 500, { error: "server error" }); }
}).listen(Number(process.env.PORT) || 3000, "127.0.0.1", () => console.log("listening on", process.env.PORT));
`;

const STORE = `// Data holder: a JSON file in data/ (written atomically). Seeded from data/seed.json on first run.
// (node:sqlite isn't used: in Node 22 it can open files outside the workspace sandbox.)
import { readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const DB = new URL("./data/db.json", import.meta.url), SEED = new URL("./data/seed.json", import.meta.url);
let q = Promise.resolve();
const load = async () => JSON.parse(await readFile(DB, "utf8").catch(() => readFile(SEED, "utf8")));
const save = async (items) => { const tmp = new URL("./data/db.json.tmp", import.meta.url); await writeFile(tmp, JSON.stringify(items, null, 2)); await rename(tmp, DB); };
const serial = (fn) => (q = q.then(fn, fn));
export const listItems = () => serial(load);
export const addItem = (text) => serial(async () => { const items = await load(), it = { id: randomUUID(), text, at: new Date().toISOString() }; await save([...items, it]); return it; });
export const deleteItem = (id) => serial(async () => { const items = await load(), left = items.filter((i) => i.id !== id); await save(left); return left.length < items.length; });
`;

const INDEX = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Demo app</title><link rel="stylesheet" href="style.css"></head>
<body><main><h1>Demo app</h1><form id="f"><input id="t" placeholder="New item" required><button>Add</button></form><ul id="list"></ul></main><script src="app.js"></script></body></html>
`;
const APP = `const list = document.getElementById("list");
async function load() {
  const items = await fetch("/api/items").then((r) => r.json());
  list.replaceChildren(...items.map((i) => { const li = document.createElement("li"); li.textContent = i.text; const b = document.createElement("button"); b.textContent = "×"; b.onclick = async () => { await fetch("/api/items/" + i.id, { method: "DELETE" }); load(); }; li.append(" ", b); return li; }));
}
document.getElementById("f").onsubmit = async (e) => { e.preventDefault(); const t = document.getElementById("t"); await fetch("/api/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t.value }) }); t.value = ""; load(); };
load();
`;
const CSS = `body{font-family:system-ui,sans-serif;margin:0;background:#f6f6f4;color:#222}main{max-width:560px;margin:40px auto;padding:0 16px}form{display:flex;gap:8px}input{flex:1;padding:8px}li{padding:6px 0}
`;
const README = `# Full-stack demo

What runs where:
- server.mjs: the back end (Node built-ins only). ORBIT starts it with ws_run on this PC at http://127.0.0.1:<port>, never public.
- /api routes: GET /api/health, GET /api/items, POST /api/items {"text"}, DELETE /api/items/<id>.
- store.mjs + data/: the data holder, a JSON file (data/db.json), seeded from data/seed.json.
- public/: the front end, served by server.mjs.
- logs/server.log: the server's output (capped).

Sandbox: Node's permission model limits file access to this folder, with no child processes or worker threads, a ${HEAP_MB} MB heap,
and an auto-stop after 30 minutes idle. Note: ${NO_NET_NOTE}.
Secrets never go in this folder; .env.example only names variables.
`;

/** ws_create {"template": "fullstack"} writes these. */
export const FULLSTACK_TEMPLATE: Record<string, string> = {
  "server.mjs": SERVER, "store.mjs": STORE, "data/seed.json": JSON.stringify([{ id: "seed-1", text: "First item from the seed data", at: "2026-01-01T00:00:00.000Z" }], null, 2) + "\n",
  "public/index.html": INDEX, "public/app.js": APP, "public/style.css": CSS, "README.md": README, ".env.example": "# Names only, never values\nPORT=\n",
};
