import { requireUser } from "@/lib/supabase/server";
import { runCore, CoreStopped } from "@/lib/core";
import { reflectOnTurn } from "@/lib/reflect";
import { learnFacts } from "@/lib/facts";
import { emit } from "@/lib/claude";
import { stepLabel } from "@/lib/core-ui";
import { str } from "@/lib/pure";
import type { NavTarget } from "@/lib/nav-pure";
import { parseAttachments, attachedSuffix } from "@/lib/attach-pure";
import { prepareAttachments } from "@/lib/core-attach";
import { chatProjectContext, updateChats } from "@/lib/core-chats";
import { MAX_MESSAGES, chatTitle, isId, moveChat } from "@/lib/core-chats-pure";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => ({}));
  const files = parseAttachments(body.attachments); // up to 3, type checked by magic bytes, base64 in the JSON body
  if ("error" in files) return Response.json({ error: files.error }, { status: 400 });
  const typed = str(body.message ?? "", 8000); // null only when too long or not a string
  const message = typed === null ? null : typed || (files.files.length ? "Take a look at what I attached." : null);
  const voice = body.voice === true; // asked out loud: answer short enough to listen to
  if (!message) return Response.json({ error: "Message is required (max 8000 chars)" }, { status: 400 });
  const attach = await prepareAttachments(files.files);
  // shortcut: only the names are saved, so later turns can't see the files again; store them in the vault if that's needed.
  const content = files.files.length ? message + attachedSuffix(files.files.map((f) => f.name)) : message;

  // Conversation: reuse if it belongs to the user (RLS enforces this), else start a new one.
  let conversationId: string | null = typeof body.conversationId === "string" ? body.conversationId : null;
  if (conversationId) {
    const { data } = await sb.from("conversations").select("id").eq("id", conversationId).maybeSingle();
    if (!data) conversationId = null;
  }
  if (!conversationId) {
    const { data, error } = await sb.from("conversations").insert({ user_id: user.id, title: chatTitle(message) }).select("id").single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const newId: string = data.id;
    conversationId = newId;
    // A new chat started inside a project (chosen before the first message); moveChat ignores unknown projects.
    if (isId(body.projectId)) await updateChats(user.id, (s) => moveChat(s, newId, body.projectId)).catch(() => {});
  } else {
    const { count } = await sb.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId);
    if ((count ?? 0) >= MAX_MESSAGES - 1) return Response.json({ error: `This chat is full (${MAX_MESSAGES} messages). Start a new chat.` }, { status: 400 });
  }

  const { data: userMsg, error: userMsgErr } = await sb.from("messages").insert({ user_id: user.id, conversation_id: conversationId, role: "user", content }).select("id").single();
  if (userMsgErr) return Response.json({ error: userMsgErr.message }, { status: 500 });

  await emit(sb, user.id, "core.started", "core", { conversationId });
  const cid = conversationId as string;

  // Shared by both response styles: answer, then save it once at the end.
  const answer = async (onDelta?: (text: string) => void, signal?: AbortSignal, onReset?: () => void, onNavigate?: (to: NavTarget) => void, onStep?: (tool: string, input: Record<string, unknown>) => void) => {
    // runCore only uses the last 9 turns (8 of transcript + the question), so long chats don't load all 400.
    const [{ data: prior }, project] = await Promise.all([
      sb.from("messages").select("role, content").eq("conversation_id", cid).order("created_at", { ascending: false }).limit(9),
      chatProjectContext(user.id, cid),
    ]);
    const out = await runCore(sb, user.id, ((prior ?? []) as { role: "user" | "assistant"; content: string }[]).reverse(), onDelta, signal, onReset, voice, onNavigate, onStep, attach, project.text, project.tainted, project.memoryProject);
    await sb.from("messages").insert({ user_id: user.id, conversation_id: cid, role: "assistant", content: out.text, citations: out.citations, trace: out.trace });
    await sb.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", cid); // Recents sort by last activity
    await emit(sb, user.id, "core.completed", "core", { conversationId: cid });
    void reflectOnTurn(sb, user.id, cid); // learn in the background; never delays the answer, never throws
    void learnFacts(sb, user.id, message, userMsg?.id ?? null, files.files.length > 0); // beliefs from the user's own words only (none on attachment turns); never throws
    return out;
  };
  const fail = async (e: unknown) => {
    const error = e instanceof Error ? e.message : "CORE failed";
    await emit(sb, user.id, "core.failed", "core", { conversationId: cid, error: error.slice(0, 300) });
    return error;
  };

  if (new URL(req.url).searchParams.get("stream") === "1") {
    // NDJSON events: {type:"start",conversationId} {type:"step",label}* {type:"delta",text}* {type:"navigate",to}? then {type:"done",...} or {type:"error",error}.
    const ac = new AbortController();
    req.signal.addEventListener("abort", () => ac.abort(), { once: true }); // client went away: kill the CLI
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(ctrl) {
        const send = (ev: Record<string, unknown>) => { try { ctrl.enqueue(enc.encode(JSON.stringify(ev) + "\n")); } catch { /* client gone */ } };
        send({ type: "start", conversationId: cid });
        let shown = "";
        try {
          const { text, citations, trace, model } = await answer(
            (text) => { shown += text; send({ type: "delta", text }); }, ac.signal,
            () => { if (shown) { shown = ""; send({ type: "reset" }); } },
            (to) => send({ type: "navigate", to }),
            (tool, input) => send({ type: "step", label: stepLabel(tool, input) }));
          send({ type: "done", conversationId: cid, answer: text, citations, trace, model });
        } catch (e) {
          // Stopped: keep what was already shown, plus what any agent task cancelled by the stop had finished.
          const done = e instanceof CoreStopped ? e.completed : "";
          if (ac.signal.aborted && (shown || done)) await sb.from("messages").insert({ user_id: user.id, conversation_id: cid, role: "assistant", content: [shown, done, "_Stopped._"].filter(Boolean).join("\n\n") });
          send({ type: "error", conversationId: cid, error: await fail(e) });
        }
        try { ctrl.close(); } catch { /* already cancelled */ }
      },
      cancel() { ac.abort(); },
    });
    return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
  }

  try {
    const { text, citations, trace, model } = await answer();
    return Response.json({ conversationId: cid, answer: text, citations, trace, model });
  } catch (e) {
    return Response.json({ conversationId: cid, error: await fail(e) }, { status: 502 });
  }
}
