import { requireUser } from "@/lib/supabase/server";
import { cleanTags, str } from "@/lib/pure";
import { COMMUNICATION_STORED_MAX } from "@/lib/brief-mode-pure";
import { forgetProfile } from "@/lib/core";

const LISTS = ["interests", "projects", "goals", "news_topics", "research_priorities"] as const;

export async function GET() {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const { data, error } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ profile: data });
}

/** Only what the user types is stored; nothing is inferred into the profile. */
export async function PUT(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => ({}));
  const row: Record<string, unknown> = { id: user.id };
  for (const k of LISTS) if (k in body) row[k] = cleanTags(body[k]);
  if ("display_name" in body) row.display_name = str(body.display_name, 100) || null;
  if ("communication" in body) { const c = str(body.communication, COMMUNICATION_STORED_MAX); if (c === null) return Response.json({ error: "Bad communication" }, { status: 400 }); row.communication = c; }
  const { data, error } = await sb.from("profiles").upsert(row).select("*").single();
  forgetProfile(user.id); // CORE's next turn reads the new profile
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ profile: data });
}
