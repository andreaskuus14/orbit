import { requireUser } from "@/lib/supabase/server";
import { projectScope } from "@/lib/project-access";
import { updateChats } from "@/lib/core-chats";
import { addProject, MAX_PROJECT_NAME } from "@/lib/core-chats-pure";
import { logActivity } from "@/lib/activity";

/** Explicitly enable CORE chats for an OPERATIONS project, using the same ID. Never copy desk notes into prompts. */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const id = await projectScope(req, sb, user.id);
  if (id instanceof Response) return id;
  if (!id) return Response.json({ error: "Choose a project" }, { status: 400 });
  const { data, error } = await sb.from("projects").select("name").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (error || !data) return Response.json({ error: "Project could not be read" }, { status: 503 });
  try {
    const result = await updateChats(user.id, (s) => {
      const existing = s.projects.find((p) => p.id === id);
      if (existing) return { project: existing, created: false };
      const added = addProject(s, id, data.name.slice(0, MAX_PROJECT_NAME), "", new Date().toISOString());
      return "error" in added ? added : { ...added, created: true };
    });
    if ("error" in result) return Response.json(result, { status: 400 });
    if (result.created) logActivity({ area: "core", title: "Project connected to CORE", detail: "Shared project ID enabled; private desk notes were not copied", link: { panel: "core" } });
    return Response.json({ project: result.project });
  } catch { return Response.json({ error: "CORE project could not be saved; existing chats were kept" }, { status: 500 }); }
}
