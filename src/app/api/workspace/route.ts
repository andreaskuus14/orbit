import { requireUser } from "@/lib/supabase/server";
import { createWorkspace, zipWorkspace, listFiles, listWorkspaces, previewUrl, readCheckFile, readWsFile, trashWsFile, writeWsFile } from "@/lib/workspace";
import { contentType, isSlug } from "@/lib/workspace-pure";
import { workspaceDir } from "@/lib/workspace";
import { serverStatus, startServer, stopServer } from "@/lib/ws-server";
import { NO_NET_NOTE, apiRoutes } from "@/lib/ws-server-pure";
import { stopAllOn } from "@/lib/stop-all";
import { logActivity } from "@/lib/activity";
import { attachment } from "@/lib/zip-pure";
import { VaultError, listVault, saveUpload } from "@/lib/vault";

export const dynamic = "force-dynamic";

// WORKSPACES (files CORE builds). GET → { workspaces }; ?ws=slug → { files, preview }; ?ws=slug&file=path → { text, size };
// ?ws=slug&check=result → the last site check (or { check: null }); ?ws=slug&check=desktop|phone → its screenshot (PNG).
// ?ws=slug&file=path&download=1 → the file as an attachment; ?ws=slug&zip=1 → the whole workspace as <slug>.zip.
// POST { action: create {name} | write {ws, path, content} | delete {ws, path} } (delete moves the file to the workspace's .trash).

async function serverInfo(uid: string, ws: string) {
  const s = serverStatus(`${uid}/${ws}`), src = await readWsFile(uid, ws, "server.mjs");
  return { ...s, routes: src ? apiRoutes(src.text) : [], note: NO_NET_NOTE };
}
const bad = (error: string, status = 400) => Response.json({ error }, { status });
const out = (r: object) => ("error" in r ? Response.json(r, { status: 400 }) : Response.json(r));

export async function GET(req: Request) {
  const { user, res } = await requireUser();
  if (res) return res;
  const q = new URL(req.url).searchParams;
  const ws = q.get("ws"), file = q.get("file");
  if (!ws) return Response.json({ workspaces: await listWorkspaces(user.id) });
  if (!isSlug(ws)) return bad("Invalid workspace");
  if (q.get("server") === "1") return Response.json(await serverInfo(user.id, ws));
  const check = q.get("check");
  if (check === "result") {
    const b = await readCheckFile(user.id, ws, "result.json");
    let parsed = null;
    try { parsed = b && JSON.parse(b.toString("utf8")); } catch { /* damaged file: no check shown */ }
    return Response.json({ check: parsed });
  }
  if (check === "desktop" || check === "phone") {
    const b = await readCheckFile(user.id, ws, `${check}.png`);
    return b ? new Response(new Uint8Array(b), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }) : bad("No screenshot", 404);
  }
  const dl = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (q.get("zip") === "1") {
    const z = await zipWorkspace(user.id, ws);
    return z ? new Response(new Uint8Array(z), { headers: { ...dl, "Content-Type": "application/zip", "Content-Disposition": attachment(`${ws}.zip`) } }) : bad("No such workspace", 404);
  }
  if (file) {
    const f = await readWsFile(user.id, ws, file);
    if (f && q.get("download") === "1") return new Response(new Uint8Array(f.bytes), { headers: { ...dl, "Content-Type": contentType(file), "Content-Disposition": attachment(file) } });
    const srv = q.get("open") === "1" && serverStatus(`${user.id}/${ws}`); // full-stack workspace: the preview is its running local server
    if (f && srv && srv.running) return new Response(null, { status: 302, headers: { Location: srv.url, "Cache-Control": "private, no-store" } });
    if (f && q.get("open") === "1") return new Response(null, { status: 302, headers: { Location: await previewUrl(user.id, ws, file), "Cache-Control": "private, no-store" } });
    return f ? Response.json(f) : bad("No such file", 404);
  }
  const files = await listFiles(user.id, ws);
  return files ? Response.json({ files, preview: await previewUrl(user.id, ws) }) : bad("No such workspace", 404);
}

export async function POST(req: Request) {
  const { user, res } = await requireUser();
  if (res) return res;
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return bad("Invalid JSON body");
  if (b.action === "create") return typeof b.name === "string" ? out(await createWorkspace(user.id, b.name.slice(0, 60))) : bad("Missing name");
  if (b.action === "server" && isSlug(b.ws)) { // the deliverable card's Start / Stop (a local demo server; Operator mode category A)
    const key = `${user.id}/${b.ws}`;
    if (b.op === "stop") stopServer(key);
    else if (b.op === "start") {
      const dir = await workspaceDir(user.id, b.ws);
      const r = dir ? await startServer(key, dir, { stopAll: stopAllOn() }) : { error: "No such workspace" };
      if ("error" in r) return bad(r.error);
      logActivity({ area: "system", title: `Workspace server started: ${b.ws} (local demo)` });
    } else return bad("Unknown op");
    return Response.json(await serverInfo(user.id, b.ws));
  }
  if (!isSlug(b.ws) || typeof b.path !== "string") return bad("Missing ws or path");
  if (b.action === "write") return typeof b.content === "string" ? out(await writeWsFile(user.id, b.ws, b.path, b.content)) : bad("Missing content");
  if (b.action === "vault") { // Save to VAULT under a stable name (<ws>-<path>), so a second click finds the same file instead of a copy
    const f = await readWsFile(user.id, b.ws, b.path);
    if (!f) return bad("No such file", 404);
    const name = `${b.ws}-${b.path.replace(/\//g, "-")}`;
    try { return Response.json({ name: await saveUpload(new File([new Uint8Array(f.bytes)], name), { exact: true, taken: (await listVault()).map((v) => v.name) }), created: true }); }
    catch (e) { return e instanceof VaultError && e.status === 409 ? Response.json({ name, created: false }) : bad(e instanceof VaultError ? e.message : "Could not save to VAULT", e instanceof VaultError ? e.status : 500); }
  }
  if (b.action === "delete") return out(await trashWsFile(user.id, b.ws, b.path));
  return bad("Unknown action");
}
