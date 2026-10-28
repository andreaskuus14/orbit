import { requireUser } from "@/lib/supabase/server";
import { getCheckpoint, updateCheckpoint } from "@/lib/checkpoint";
import { editLine, removeLine } from "@/lib/checkpoint-pure";
import { isId } from "@/lib/core-chats-pure";

export const dynamic = "force-dynamic";

// A CORE chat's work checkpoint. GET ?id=<chat> → { lines }; POST { action: "edit", id, line, text } | { action: "delete", id, line }.
// The chat id is checked against Supabase (RLS = owner only) first. CSRF: src/middleware.ts guards all /api/*.
const bad = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const id = new URL(req.url).searchParams.get("id");
  if (!isId(id) || !(await sb.from("conversations").select("id").eq("id", id).maybeSingle()).data) return bad("Chat not found", 404);
  return Response.json(await getCheckpoint(user.id, id));
}

export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = await req.json().catch(() => null);
  if (!b || !isId(b.id) || !isId(b.line) || !["edit", "delete"].includes(b.action)) return bad("Bad request");
  if (!(await sb.from("conversations").select("id").eq("id", b.id).maybeSingle()).data) return bad("Chat not found", 404);
  const { out, cp } = await updateCheckpoint(user.id, b.id, (c) => (b.action === "edit" ? editLine(c, b.line, b.text) : removeLine(c, b.line)));
  return out ? Response.json(cp) : bad(b.action === "edit" ? "Line not found, or text empty / over 200 characters" : "Line not found", 404);
}
