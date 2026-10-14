import { requireUser } from "@/lib/supabase/server";
import { runCore } from "@/lib/core";
import { emit } from "@/lib/claude";
import { str } from "@/lib/pure";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => ({}));
  const message = str(body.message, 8000, 1);
  if (!message) return Response.json({ error: "Message is required (max 8000 chars)" }, { status: 400 });

  // Conversation: reuse if it belongs to the user (RLS enforces this), else start a new one.
  let conversationId: string | null = typeof body.conversationId === "string" ? body.conversationId : null;
  if (conversationId) {
    const { data } = await sb.from("conversations").select("id").eq("id", conversationId).maybeSingle();
    if (!data) conversationId = null;
  }
  if (!conversationId) {
    const { data, error } = await sb.from("conversations").insert({ user_id: user.id, title: message.slice(0, 60) }).select("id").single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    conversationId = data.id;
  }

  const { error: userMsgErr } = await sb.from("messages").insert({ user_id: user.id, conversation_id: conversationId, role: "user", content: message });
  if (userMsgErr) return Response.json({ error: userMsgErr.message }, { status: 500 });

  await emit(sb, user.id, "core.started", "core", { conversationId });
  try {
    const { data: prior } = await sb.from("messages").select("role, content").eq("conversation_id", conversationId).order("created_at");
    const { text, citations, trace } = await runCore(sb, user.id, (prior ?? []) as { role: "user" | "assistant"; content: string }[]);
    await sb.from("messages").insert({ user_id: user.id, conversation_id: conversationId, role: "assistant", content: text, citations, trace });
    await emit(sb, user.id, "core.completed", "core", { conversationId });
    return Response.json({ conversationId, answer: text, citations, trace });
  } catch (e) {
    const error = e instanceof Error ? e.message : "CORE failed";
    await emit(sb, user.id, "core.failed", "core", { conversationId, error: error.slice(0, 300) });
    return Response.json({ conversationId, error }, { status: 502 });
  }
}
