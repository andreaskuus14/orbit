import { guard } from "@/lib/api-route";
import { requireUser } from "@/lib/supabase/server";
import { str } from "@/lib/pure";

async function GET_() {
  const { sb, res } = await requireUser();
  if (res) return res;
  const { data, error } = await sb.from("projects").select("id, name, description, status, created_at, updated_at").order("created_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ projects: data });
}

async function POST_(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => ({}));
  const name = str(body.name, 120, 1);
  if (!name) return Response.json({ error: "Name the project" }, { status: 400 });
  const { data, error } = await sb.from("projects").insert({ user_id: user.id, name, description: str(body.description, 2000) || "" }).select("id, name, description, status, created_at, updated_at").single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ project: data }, { status: 201 });
}

async function PATCH_(req: Request) {
  const { sb, res } = await requireUser();
  if (res) return res;
  const { id, status } = await req.json().catch(() => ({}));
  if (typeof id !== "string" || !["active", "paused", "done"].includes(status)) return Response.json({ error: "Bad request" }, { status: 400 });
  const { data, error } = await sb.from("projects").update({ status }).eq("id", id).select("id");
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!data?.length) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}
export const GET = guard("projects", GET_);
export const POST = guard("projects", POST_);
export const PATCH = guard("projects", PATCH_);
