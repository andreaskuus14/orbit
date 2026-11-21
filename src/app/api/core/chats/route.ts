import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/supabase/server";
import { getChats, updateChats } from "@/lib/core-chats";
import { buildUsed } from "@/lib/core-used-pure";
import { MODULE_PRIVATE } from "@/lib/core-modules";
import { updateCheckpoint } from "@/lib/checkpoint";
import { coreSessionStore, coreTaintStore } from "@/lib/durable";
import { likePattern, searchQuery, snippet } from "@/lib/core-chat-pure";
import {
  MAX_CHATS, MAX_MESSAGES, MAX_TITLE, addPin, emptyChats, addProject, cleanName, deleteProject, forgetChat, isId, moveChat, removePin, updateProject,
} from "@/lib/core-chats-pure";

export const dynamic = "force-dynamic";

// CORE chat list + Projects. GET → { chats, projects, map } (newest MAX_CHATS chats); GET ?id= → { messages } of one chat.
// GET ?q= → { hits: [{ id, title, snippet, updated_at }] }: plain text search over his chat titles and messages (Postgres ilike under
// RLS; no model, no embeddings, nothing indexed anywhere else, so journal/LIFE text quoted in a chat never reaches a model this way).
// POST { action: rename|delete|move|addProject|updateProject|deleteProject|pin|unpin|rewind, ... }. CSRF: src/middleware.ts guards all /api/*.

const SEARCH_HITS = 20;
const bad = (error: string, status = 400) => Response.json({ error }, { status });
const out = (r: object) => ("error" in r ? bad(String(r.error)) : Response.json(r));

export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const params = new URL(req.url).searchParams;
  if (params.has("q")) {
    const q = searchQuery(params.get("q"));
    if (!q) return Response.json({ hits: [] });
    const like = likePattern(q);
    const [titles, msgs] = await Promise.all([
      sb.from("conversations").select("id, title, updated_at").ilike("title", like).order("updated_at", { ascending: false }).limit(SEARCH_HITS),
      sb.from("messages").select("conversation_id, content, created_at").ilike("content", like).order("created_at", { ascending: false }).limit(SEARCH_HITS * 4),
    ]);
    if (titles.error || msgs.error) return bad((titles.error ?? msgs.error)!.message, 500);
    const first = new Map<string, string>(); // chat → its newest matching message
    for (const m of msgs.data ?? []) if (!first.has(m.conversation_id)) first.set(m.conversation_id, m.content);
    const known = new Map((titles.data ?? []).map((c) => [c.id, c]));
    const missing = [...first.keys()].filter((k) => !known.has(k));
    if (missing.length) {
      const { data } = await sb.from("conversations").select("id, title, updated_at").in("id", missing.slice(0, SEARCH_HITS));
      for (const c of data ?? []) known.set(c.id, c);
    }
    const hits = [...known.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, SEARCH_HITS)
      .map((c) => ({ id: c.id, title: c.title, updated_at: c.updated_at, snippet: first.has(c.id) ? snippet(first.get(c.id)!, q) : "" }));
    return Response.json({ hits });
  }
  const id = params.get("id");
  if (id !== null) {
    if (!isId(id)) return bad("Bad id");
    // Newest MAX_MESSAGES, shown oldest first; RLS keeps other users' chats invisible.
    const { data, error } = await sb.from("messages").select("role, content, citations, trace").eq("conversation_id", id).order("created_at", { ascending: false }).limit(MAX_MESSAGES);
    if (error) return bad(error.message, 500);
    // "What I used" for a reopened chat: rebuilt from the saved citations + trace (private reads redacted)
    return Response.json({ messages: (data ?? []).reverse().map((m) => (m.role === "assistant" ? { ...m, used: buildUsed({ citations: m.citations ?? [], trace: m.trace ?? [], privateTools: MODULE_PRIVATE }) } : m)) });
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
      await updateCheckpoint(user.id, b.id, (cp) => { cp.lines = []; }).catch(() => {}); // its checkpoint goes with it
      coreSessionStore.delete(b.id); coreTaintStore.delete(b.id); // its Claude session mapping goes with it
      return Response.json({ ok: true });
    }
    case "rewind": {
      // Edit / Retry of the last question: his last message and everything after it go, then the client asks again. The Claude
      // session mapping goes too (it remembers the old turn), so the next turn starts from the saved history. Taint stays (safer).
      if (!(await ownChat(b.id))) return bad("Chat not found", 404);
      const { data: last, error } = await sb.from("messages").select("created_at").eq("conversation_id", b.id).eq("role", "user").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) return bad(error.message, 500);
      if (!last) return Response.json({ removed: 0 });
      const { data: gone, error: delErr } = await sb.from("messages").delete().eq("conversation_id", b.id).gte("created_at", last.created_at).select("id");
      if (delErr) return bad(delErr.message, 500);
      coreSessionStore.delete(b.id);
      return Response.json({ removed: gone?.length ?? 0 });
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
