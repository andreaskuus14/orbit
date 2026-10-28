import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/supabase/server";
import { getChats, updateChats } from "@/lib/core-chats";
import { coreSessionStore } from "@/lib/durable";
import {
  MAX_CHATS, MAX_MESSAGES, MAX_TITLE, addPin, emptyChats, addProject, cleanName, deleteProject, forgetChat, isId, moveChat, removePin, updateProject,
} from "@/lib/core-chats-pure";

export const dynamic = "force-dynamic";

// CORE chat list + Projects. GET → { chats, projects, map } (newest MAX_CHATS chats); GET ?id= → { messages } of one chat.
// POST { action: rename|delete|move|addProject|updateProject|deleteProject|pin|unpin, ... }. CSRF: src/middleware.ts guards all /api/*.

const bad = (error: string, status = 400) => Response.json({ error }, { status });
const out = (r: object) => ("error" in r ? bad(String(r.error)) : Response.json(r));

export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const id = new URL(req.url).searchParams.get("id");
  if (id !== null) {
    if (!isId(id)) return bad("Bad id");
    // Newest MAX_MESSAGES, shown oldest first; RLS keeps other users' chats invisible.
    const { data, error } = await sb.from("messages").select("role, content, citations, trace").eq("conversation_id", id).order("created_at", { ascending: false }).limit(MAX_MESSAGES);
    if (error) return bad(error.message, 500);
    return Response.json({ messages: (data ?? []).reverse() });
  }
  const [{ data, error }, store] = await Promise.all([
    sb.from("conversations").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(MAX_CHATS),
    getChats(user.id).catch(() => emptyChats()), // unreadable local file: still list the chats
  ]);
  if (error) return bad(error.message, 500);
  return Response.json({ chats: data ?? [], projects: store.projects, map: store.chats });
}

export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return bad("Invalid JSON body");
  const now = new Date().toISOString();
  // Chat ids are checked against Supabase (RLS = owner only) before the local map is touched.
  const ownChat = async (id: unknown) => isId(id) && !!(await sb.from("conversations").select("id").eq("id", id).maybeSingle()).data;
  switch (b.action) {
    case "rename": {
      const title = cleanName(b.title, MAX_TITLE);
      if (!isId(b.id) || !title) return bad(`Title must be 1–${MAX_TITLE} characters`);
      const { data, error } = await sb.from("conversations").update({ title }).eq("id", b.id).select("id");
      if (error) return bad(error.message, 500);
      return data?.length ? Response.json({ ok: true }) : bad("Chat not found", 404);
    }
    case "delete": {
      if (!isId(b.id)) return bad("Missing id");
      const { data, error } = await sb.from("conversations").delete().eq("id", b.id).select("id"); // messages cascade
      if (error) return bad(error.message, 500);
      if (!data?.length) return bad("Chat not found", 404);
      await updateChats(user.id, (s) => forgetChat(s, b.id)).catch(() => {}); // chat is gone either way; parseChats can't resurrect it in the list
      coreSessionStore.delete(b.id); // its Claude session mapping goes with it
      return Response.json({ ok: true });
    }
    case "move": {
      if (b.projectId !== null && !isId(b.projectId)) return bad("Bad project");
      if (!(await ownChat(b.id))) return bad("Chat not found", 404);
      return out(await updateChats(user.id, (s) => moveChat(s, b.id, b.projectId)));
    }
    case "addProject":
      return out(await updateChats(user.id, (s) => addProject(s, randomUUID(), b.name, b.instructions, now)));
    case "updateProject":
      if (!isId(b.id)) return bad("Missing id");
      return out(await updateChats(user.id, (s) => updateProject(s, b.id, b.name, b.instructions)));
    case "deleteProject":
      if (!isId(b.id)) return bad("Missing id");
      return Response.json({ removed: await updateChats(user.id, (s) => deleteProject(s, b.id)) });
    case "pin":
      if (!isId(b.projectId)) return bad("Missing project");
      return out(await updateChats(user.id, (s) => addPin(s, b.projectId, randomUUID(), b.title, b.text, now)));
    case "unpin":
      if (!isId(b.projectId) || !isId(b.id)) return bad("Missing id");
      return Response.json({ removed: await updateChats(user.id, (s) => removePin(s, b.projectId, b.id)) });
    default:
      return bad("Unknown action");
  }
}
