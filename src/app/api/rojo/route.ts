import { safeMessage } from "@/lib/api-error-pure";
import { requireUser } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import { stopAllOn } from "@/lib/stop-all";
import { checkAfterExport } from "@/lib/selene";
import {
  CheckFailed, backupProject, checkProject, connectFolder, disconnectFolder, exportPlace, formatProject, lintProject, listProjects, projectsRoot,
  serveStatus, startServe, stopServe, undoEdit,
} from "@/lib/rojo";

// GAME DEV → Build → Files (Rojo + Selene + StyLua on this PC). Every action is the owner's own click; everything stays on his PC.
// Nothing here publishes to Roblox: that stays his own click in Studio (File → Publish to Roblox).
//   GET                                     → { root, projects, serve }
//   POST {action:"connect", dir}            → Connected (reads or makes default.project.json; git history)
//   POST {action:"disconnect", project}     → { ok }  (ORBIT forgets the folder; files stay)
//   POST {action:"export", place}           → ExportResult + selene (rojo syncback + git commit, then the automatic Selene check)
//   POST {action:"lint", project?}          → { name, dir, lint }  (read-only)
//   POST {action:"check", project?}         → Check (Selene + StyLua, read-only)
//   POST {action:"format", project?}        → { name, changed } (StyLua between two commits; Undo reverts it)
//   POST {action:"undo", project?}          → { name, undone } | { none: true }
//   POST {action:"backup", project?}        → { name, file }  (rojo build → backups/*.rbxl)
//   POST {action:"serve", project?, force?} → serve status, or 409 { error, check } when the check finds mistakes
//   POST {action:"stop"}                    → serve status
const WRITES = ["export", "serve", "format", "undo", "backup", "connect"];
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json({ root: projectsRoot(), projects: await listProjects(), serve: await serveStatus() });
}

export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => ({}))) as { action?: string; place?: unknown; project?: unknown; dir?: unknown; force?: unknown };
  try {
    if (b.action === "lint") return Response.json(await lintProject(b.project));
    if (b.action === "check") return Response.json(await checkProject(b.project));
    if (b.action === "stop") { if (stopServe()) logActivity({ area: "system", title: "Rojo sync stopped" }); return Response.json(await serveStatus()); }
    if (b.action === "disconnect") return Response.json({ ok: await disconnectFolder(b.project) });
    if (!WRITES.includes(String(b.action))) return Response.json({ error: "Unknown action" }, { status: 400 });
    if (stopAllOn()) return Response.json({ error: "ORBIT is paused (Stop-all is on)" }, { status: 423 });
    if (b.action === "connect") {
      const r = await connectFolder(b.dir);
      logActivity({ area: "system", title: `Connected Roblox project folder: ${r.name}`, detail: `${r.dir}${r.created.length ? `; made ${r.created.join(", ")}` : ""}` });
      return Response.json(r);
    }
    if (b.action === "serve") {
      try {
        const s = await startServe(b.project, b.force === true);
        logActivity({ area: "system", title: `Rojo sync started for ${s.ours}`, detail: `rojo serve on 127.0.0.1:${s.port}${b.force === true ? " (started anyway, past the code check)" : ""}` });
        return Response.json(s);
      } catch (e) {
        if (e instanceof CheckFailed) return Response.json({ error: e.message, check: e.check }, { status: 409 });
        throw e;
      }
    }
    if (b.action === "format") {
      const r = await formatProject(b.project);
      if (r.changed) logActivity({ area: "system", title: `Tidied Roblox code with StyLua: ${r.name}`, detail: "git commit; Undo in GAME DEV → Files" });
      return Response.json(r);
    }
    if (b.action === "undo") {
      const r = await undoEdit(b.project);
      if (r) logActivity({ area: "system", title: `Undid ORBIT's Roblox edit: ${r.undone}`, detail: r.name });
      return Response.json(r ?? { none: true });
    }
    if (b.action === "backup") {
      const r = await backupProject(b.project);
      logActivity({ area: "system", title: `Roblox scripts backup: ${r.name}`, detail: r.file });
      return Response.json(r);
    }
    const r = await exportPlace(b.place);
    logActivity({ area: "system", title: `Exported Roblox scripts: ${r.name}`, detail: `${r.scripts} script file(s) in ${r.dir}${r.committed ? ", committed to git" : ", no changes"}` });
    const selene = await checkAfterExport(sb, user.id, r); // Selene on the fresh files; never fails the export
    return Response.json({ ...r, selene });
  } catch (e) {
    return Response.json({ error: safeMessage(e, "Failed") }, { status: 502 });
  }
}
