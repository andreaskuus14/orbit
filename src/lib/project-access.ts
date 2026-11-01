import type { SupabaseClient } from "@supabase/supabase-js";
import { projectId } from "./project-desk-pure";

/** Ownership comes from the existing OPERATIONS project; a query string grants no access. */
export async function projectScope(req: Request, sb: SupabaseClient, user: string): Promise<string | null | Response> {
  const id = new URL(req.url).searchParams.get("project");
  if (id === null) return null;
  if (!projectId(id)) return Response.json({ error: "Invalid project" }, { status: 400 });
  const { data, error } = await sb.from("projects").select("id").eq("id", id).eq("user_id", user).maybeSingle();
  if (error) return Response.json({ error: "Could not check project access" }, { status: 503 });
  return data ? id : Response.json({ error: "Project not found" }, { status: 404 });
}
