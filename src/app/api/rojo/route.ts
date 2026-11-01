import { requireUser } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import { stopAllOn } from "@/lib/stop-all";
import { exportPlace, lintProject, listProjects, projectsRoot, serveStatus, startServe, stopServe } from "@/lib/rojo";

// GAME DEV → Build → Files (Rojo + Selene on this PC). Every action is the owner's own click; everything stays on his PC.
//   GET                                  → { root, projects, serve }
//   POST {action:"export", place}        → ExportResult (rojo syncback + git commit)
//   POST {action:"lint", project?}       → { name, dir, lint }  (read-only)
//   POST {action:"serve", project?}      → serve status        POST {action:"stop"} → serve status
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json({ root: projectsRoot(), projects: await listProjects(), serve: await serveStatus() });
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => ({}))) as { action?: string; place?: unknown; project?: unknown };
  try {
    if (b.action === "lint") return Response.json(await lintProject(b.project));
    if (b.action === "stop") { if (stopServe()) logActivity({ area: "system", title: "Rojo sync stopped" }); return Response.json(await serveStatus()); }
    if (b.action !== "export" && b.action !== "serve") return Response.json({ error: "Unknown action" }, { status: 400 });
    if (stopAllOn()) return Response.json({ error: "ORBIT is paused (Stop-all is on)" }, { status: 423 });
    if (b.action === "serve") {
      const s = await startServe(b.project);
      logActivity({ area: "system", title: `Rojo sync started for ${s.ours}`, detail: `rojo serve on 127.0.0.1:${s.port}` });
      return Response.json(s);
    }
    const r = await exportPlace(b.place);
    logActivity({ area: "system", title: `Exported Roblox scripts: ${r.name}`, detail: `${r.scripts} script file(s) in ${r.dir}${r.committed ? ", committed to git" : ", no changes"}` });
    return Response.json(r);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 502 });
  }
}
