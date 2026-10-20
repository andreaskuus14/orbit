import { requireUser } from "@/lib/supabase/server";
import { createWorkspace, listFiles, listWorkspaces, previewUrl, readCheckFile, readWsFile, trashWsFile, writeWsFile } from "@/lib/workspace";
import { isSlug } from "@/lib/workspace-pure";

export const dynamic = "force-dynamic";

// WORKSPACES (files CORE builds). GET → { workspaces }; ?ws=slug → { files, preview }; ?ws=slug&file=path → { text, size };
// ?ws=slug&check=result → the last site check (or { check: null }); ?ws=slug&check=desktop|phone → its screenshot (PNG).
// POST { action: create {name} | write {ws, path, content} | delete {ws, path} } (delete moves the file to the workspace's .trash).

const bad = (error: string, status = 400) => Response.json({ error }, { status });
const out = (r: object) => ("error" in r ? Response.json(r, { status: 400 }) : Response.json(r));

export async function GET(req: Request) {
  const { user, res } = await requireUser();
  if (res) return res;
  const q = new URL(req.url).searchParams;
  const ws = q.get("ws"), file = q.get("file");
  if (!ws) return Response.json({ workspaces: await listWorkspaces(user.id) });
  if (!isSlug(ws)) return bad("Invalid workspace");
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
  if (file) {
    const f = await readWsFile(user.id, ws, file);
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
  if (!isSlug(b.ws) || typeof b.path !== "string") return bad("Missing ws or path");
  if (b.action === "write") return typeof b.content === "string" ? out(await writeWsFile(user.id, b.ws, b.path, b.content)) : bad("Missing content");
  if (b.action === "delete") return out(await trashWsFile(user.id, b.ws, b.path));
  return bad("Unknown action");
}
