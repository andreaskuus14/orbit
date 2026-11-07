import { requireUser } from "@/lib/supabase/server";
import { projectScope } from "@/lib/project-access";
import { deskInput } from "@/lib/project-desk-pure";
import { getDesk, saveDesk } from "@/lib/project-desk";
import { logActivity } from "@/lib/activity";

export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const project = await projectScope(req, sb, user.id);
  if (project instanceof Response) return project;
  if (!project) return Response.json({ error: "Choose a project" }, { status: 400 });
  try { return Response.json({ desk: await getDesk(user.id, project) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return Response.json({ error: "Project notes could not be read; existing data was kept" }, { status: 500 }); }
}
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const project = await projectScope(req, sb, user.id);
  if (project instanceof Response) return project;
  if (!project) return Response.json({ error: "Choose a project" }, { status: 400 });
  const text = await req.text();
  if (text.length > 256_000) return Response.json({ error: "Project notes too large" }, { status: 413 });
  let body; try { body = JSON.parse(text); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const input = deskInput(body);
  if (typeof input === "string" || !Number.isSafeInteger(body.rev) || body.rev < 0) return Response.json({ error: typeof input === "string" ? input : "Invalid revision" }, { status: 400 });
  try {
    const desk = await saveDesk(user.id, project, body.rev, input);
    if (!desk) return Response.json({ error: "Newer project notes exist. Reload them before saving." }, { status: 409 });
    logActivity({ area: "operator", title: "Project desk saved", detail: `${desk.references.length} references; revision ${desk.rev}`, link: { panel: "arch" } });
    return Response.json({ desk });
  } catch { return Response.json({ error: "Project notes could not be saved; retry without closing this view" }, { status: 500 }); }
}
