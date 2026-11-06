import type { SupabaseClient } from "@supabase/supabase-js";
import { runCore, runCoreFor, CoreHandoff, CoreStopped } from "@/lib/core";
import { BACKGROUND_TURN_MS, BG_FAILED, handoffReply } from "@/lib/long-work-pure";
import { contextLine, safeLink } from "@/lib/voice-target-pure";
import { reflectOnTurn } from "@/lib/reflect";
import { learnFacts } from "@/lib/facts";
import { emit } from "@/lib/claude";
import { liveTracker, ndjsonStream, type StepDone } from "@/lib/core-live-pure";
import { MODULE_PRIVATE } from "@/lib/core-modules";
import { coreSessionStore, coreTaintStore } from "@/lib/durable";
import { doneSoFar, newBgTurn, stoppedNote } from "@/lib/bg-resume-pure";
import { str } from "@/lib/pure";
import type { NavTarget } from "@/lib/nav-pure";
import { parseAttachments, attachedSuffix, attachmentPrompt } from "@/lib/attach-pure";
import { retainedAttachments, type ContextTurn } from "@/lib/core-context-pure";
import { prepareAttachments } from "@/lib/core-attach";
import { chatProjectContext, updateChats } from "@/lib/core-chats";
import { describeFailure } from "@/lib/core-capability-pure";
import { MAX_MESSAGES, chatTitle, isId, moveChat } from "@/lib/core-chats-pure";
import { parseLang } from "@/lib/i18n-pure";
import { noteOwnerTurn, noteReceipts, projectRecordFor } from "@/lib/checkpoint";
import { checkpointPrompt, isContinue } from "@/lib/checkpoint-pure";
import { chatQueue, onceById } from "@/lib/session-bound-pure";
import { logActivity } from "@/lib/activity";
import { stopAllOn } from "@/lib/stop-all";
import { receiptLine, type Receipt } from "@/lib/receipt-pure";
import { evalMark, parseRunId } from "@/lib/eval-core-pure";
import { evalRunId, inEvalRun } from "@/lib/eval-run";

// Process-wide (one ORBIT server): shortcut: in-memory, so it holds for one Node process; a multi-instance deploy needs a shared lock.
const G = globalThis as unknown as { __orbitTurns?: { perChat: ReturnType<typeof chatQueue>; sameRequest: ReturnType<typeof onceById<{ status: number; body: Record<string, unknown> }>> } };
const { perChat, sameRequest } = (G.__orbitTurns ??= { perChat: chatQueue(), sameRequest: onceById() });

// One CORE chat turn (moved out of /api/core so the phone remote runs the exact same path). body: {message, attachments?, voice?,
// conversationId?, projectId?, lang?}; ?stream=1 on req answers as NDJSON. opts.remote marks a turn asked from the paired phone.
export async function coreTurn(req: Request, sb: SupabaseClient, userId: string, body: Record<string, any>, opts: { remote?: boolean; onConversation?: (id: string) => void } = {}): Promise<Response> {
  const files = parseAttachments(body.attachments); // up to 3, type checked by magic bytes, base64 in the JSON body
  if ("error" in files) return Response.json({ error: files.error }, { status: 400 });
  const typed = str(body.message ?? "", 8000); // null only when too long or not a string
  const message = typed === null ? null : typed || (files.files.length ? "Take a look at what I attached." : null);
  const voice = body.voice === true; // asked out loud: answer short enough to listen to
  const lang = parseLang(body.lang); // the UI language switch: "et" = CORE answers in Estonian
  if (!message) return Response.json({ error: "Message is required (max 8000 chars)" }, { status: 400 });
  const attach = await prepareAttachments(files.files);
  const content = files.files.length ? message + attachedSuffix(files.files.map((f) => f.name)) : message;

  // B05: one turn per chat at a time (phone + desktop), and a client retry with the same requestId gets the first turn's outcome.
  const evalRun = parseRunId(body.evalRun); // `npm run eval`: everything this turn creates carries the run id (eval-run.ts)
  const rid = typeof body.requestId === "string" && /^[\w-]{8,80}$/.test(body.requestId) ? `${userId}:${body.requestId}` : null;
  type Outcome = { status: number; body: Record<string, unknown> };
  let background: Promise<{ answer: string } | null> | null = null; // a handed-off turn still running (its stream follows it)
  const run = async (send: (ev: Record<string, unknown>) => void = () => {}, signal?: AbortSignal): Promise<Outcome> => {
    // Conversation: reuse if it belongs to the user (RLS enforces this), else start a new one.
    let conversationId: string | null = typeof body.conversationId === "string" ? body.conversationId : null;
    if (conversationId) {
      const { data } = await sb.from("conversations").select("id").eq("id", conversationId).maybeSingle();
      if (!data) conversationId = null;
    }
    if (!conversationId) {
      const { data, error } = await sb.from("conversations").insert({ user_id: userId, title: (opts.remote ? "Phone: " : "") + (evalRun ? `${evalMark(evalRun)} ` : "") + chatTitle(message) }).select("id").single();
      if (error) return { status: 500, body: { error: error.message } };
      const newId: string = data.id;
      conversationId = newId;
      // A new chat started inside a project (chosen before the first message); moveChat ignores unknown projects.
      if (isId(body.projectId)) await updateChats(userId, (s) => moveChat(s, newId, body.projectId)).catch(() => {});
    }
    const cid = conversationId as string;
    // Queued: this request's message is saved only after the chat's previous turn answered, so each answer sees its own question last.
    return perChat(cid, async (): Promise<Outcome> => {
      if (signal?.aborted) return { status: 499, body: { conversationId: cid, error: "Stopped before it started" } }; // client left while queued
      const { count } = await sb.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", cid);
      if ((count ?? 0) >= MAX_MESSAGES - 1) return { status: 400, body: { error: `This chat is full (${MAX_MESSAGES} messages). Start a new chat.` } };

      // Migration 0013 caps the combined extracted text at 20k per chat, including concurrent uploads.
      const { data: userMsg, error: userMsgErr } = await sb.from("messages").insert({ user_id: userId, conversation_id: cid, role: "user", content, attachment_text: attach?.text ?? "" }).select("id").single();
      if (userMsgErr) return { status: 500, body: { error: userMsgErr.message } };

      opts.onConversation?.(cid);
      if (body.screen === true && files.files.some((f) => f.kind === "image")) void emit(sb, userId, "screen.look", "core", { message: userMsg.id }); // ids only: never the image or question
      void emit(sb, userId, "core.started", "core", { conversationId: cid, ...(opts.remote ? { source: "remote" } : {}) }); // never throws; the answer needn't wait for the event row

      // Shared by both response styles: answer, then save it once at the end.
      const answer = async (onDelta?: (text: string) => void, signal?: AbortSignal, onReset?: () => void, onNavigate?: (to: NavTarget) => void, onStep?: (tool: string, input: Record<string, unknown>, done?: StepDone) => void) => {
        // Older turns supply a compact recap and their saved attachments; only the latest nine stay in full.
        // The chat's checkpoint (constraints from his own typed words, decisions, artifacts, next action) rides apart from the sampled history.
        const [{ data: prior, error: priorError }, project, checkpoint, record] = await Promise.all([
          sb.from("messages").select("id, role, content, attachment_text").eq("conversation_id", cid).order("created_at", { ascending: false }).limit(MAX_MESSAGES),
          chatProjectContext(userId, cid),
          noteOwnerTurn(userId, cid, message).catch((e) => { console.error("[orbit] checkpoint failed:", e instanceof Error ? e.message : e); return null; }),
          projectRecordFor(userId, cid).catch(() => ""), // the project's other chats: a new chat continues without retelling
        ]);
        if (priorError) throw priorError;
        const history = ((prior ?? []) as (ContextTurn & { id: string })[]).reverse();
        // "run skill weekly-niche-check": his typed words stay the question; the kept skill text rides as an untrusted context block
        // (passed like an attachment, so the turn is tainted and explicit-ask writes need his own typed words). skills.ts
        const skill = await import("@/lib/skills").then((m) => m.skillTurn(message), () => null);
        // Current files already have their full prompt block (and images); do not repeat their stored copy.
        const saved = retainedAttachments(history.filter((t) => t.id !== userMsg.id));
        const contextAttach = saved ? {
          block: attachmentPrompt([{ name: "Earlier attachments in this chat (retained text, up to 20k characters)", text: saved }], []) + (attach?.block ?? ""),
          images: attach?.images ?? [],
        } : attach;
        const withSkill = skill ? { block: skill + "\n\n" + (contextAttach?.block ?? ""), images: contextAttach?.images ?? [] } : contextAttach;
        const t0 = Date.now();
        const ctx = (checkpoint ? checkpointPrompt(checkpoint, isContinue(message)) : "") + record + project.text + contextLine(safeLink(body.here));
        let out: Awaited<ReturnType<typeof runCore>>;
        try { out = await runCore(sb, userId, history, onDelta, signal, onReset, voice, onNavigate, onStep, withSkill, ctx, project.tainted, project.memoryProject, cid, lang); }
        catch (e) {
          // Out of interactive time on a long step: the turn continues server-side; reply now, notify when done (never "timed out").
          if (!(e instanceof CoreHandoff) || signal?.aborted) throw e;
          const handoff = e; // carries the finished tool results: the background run resumes, not restarts
          onReset?.();
          // Not for the phone remote: its clients read "done" as the end. In-app, the open stream keeps showing the background work.
          const follow = !opts.remote;
          const bg = await inBackground(sb, userId, cid, message, handoff.carry?.trace ?? [], lang, (sig) => runCoreFor(BACKGROUND_TURN_MS, handoff, sb, userId, history, follow ? onDelta : undefined, sig, follow ? onReset : undefined, voice, undefined, follow ? onStep : undefined, withSkill, ctx, project.tainted, project.memoryProject, cid, lang));
          const taskId = bg.taskId;
          if (follow) { background = bg.finished; send({ type: "background", taskId }); }
          out = { text: handoffReply(taskId, lang), citations: [], trace: [{ step: "fallback", detail: "turn time limit → background task", ms: 0, ok: false }], model: "smart" };
        }
        await sb.from("messages").insert({ user_id: userId, conversation_id: cid, role: "assistant", content: out.text, citations: out.citations, trace: out.trace });
        void noteReceipts(userId, cid, out.trace).catch(() => {}); // artifact versions from ORBIT's own write receipts
        logReceipt(receiptOf(out.trace));
        await sb.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", cid); // Recents sort by last activity
        await emit(sb, userId, "core.completed", "core", { conversationId: cid });
        // counts only, never message text: tools = steps that ran a tool (not CORE's own memory search, thinking, review, fallbacks or reflexes)
        const tools = out.trace.filter((s) => !["search_memory", "think", "review", "fallback", "reflex"].includes(s.step)).length;
        await emit(sb, userId, "core.turn", "core", { model: out.model, tools, ms: Date.now() - t0 });
        void reflectOnTurn(sb, userId, cid); // learn in the background; never delays the answer, never throws
        void learnFacts(sb, userId, message, userMsg?.id ?? null, files.files.length > 0); // beliefs from the user's own words only (none on attachment turns); never throws
        // "no, I meant…" / "don't do that again": propose a lesson he can keep with one tap (lessons.ts); never throws
        const prevReply = [...history].reverse().find((t) => t.role === "assistant")?.content ?? "";
        const lesson = files.files.length ? null : (prevReply && await import("@/lib/persona").then((m) => m.captureReaction(userId, message), () => null)) // "too long" → a slider step (persona.ts)
          || await import("@/lib/lessons").then((m) => m.captureCorrection(userId, message, prevReply, userMsg.id), () => null);
        return { ...out, lesson };
      };
      const fail = async (e: unknown) => {
        const error = e instanceof Error ? describeFailure(e.message) : "CORE failed"; // login / usage limit / timeout named plainly
        await emit(sb, userId, "core.failed", "core", { conversationId: cid, error: error.slice(0, 300) });
        return error;
      };


      send({ type: "start", conversationId: cid });
      // Live work view: numbered, timed, redacted steps (core-live-pure.ts); private module reads show only "a private note".
      const live = liveTracker((tool, input) => MODULE_PRIVATE.includes(tool) || input.kind === "journal", coreTaintStore.has(cid));
      const sendAll = (evs: Record<string, unknown>[]) => evs.forEach(send);
      let shown = "";
      try {
        const { text, citations, trace, model, lesson } = await answer(
          (text) => { shown += text; send({ type: "delta", text }); }, signal,
          () => { if (shown) { shown = ""; send({ type: "reset" }); } },
          (to) => send({ type: "navigate", to }),
          (tool, input, done) => sendAll(done ? live.finish(tool, done) : live.start(tool, input)));
        sendAll(live.end());
        return { status: 200, body: { conversationId: cid, answer: text, citations, trace, model, ...(lesson && { lesson }) } };
      } catch (e) {
        // Stopped or out of time (CoreStopped from runCore's deadline): keep what was shown, plus what cancelled agent tasks had finished.
        const done = e instanceof CoreStopped ? e.completed : "";
        const late = e instanceof CoreStopped && !signal?.aborted;
        if ((signal?.aborted || late) && (shown || done)) await sb.from("messages").insert({ user_id: userId, conversation_id: cid, role: "assistant", content: [shown, done, late ? "_Stopped: time limit reached._" : "_Stopped._"].filter(Boolean).join("\n\n") });
        return { status: 502, body: { conversationId: cid, error: await fail(e) } };
      }
    });
  };
  // A failed outcome is not kept, so a retry after a failure runs again.
  const once = (send?: (ev: Record<string, unknown>) => void, signal?: AbortSignal) =>
    sameRequest(rid, () => inEvalRun(evalRun, () => run(send, signal)).then((o) => (o.status === 200 ? o : Promise.reject(o))))
      .catch((e): Outcome => (e && typeof e === "object" && "status" in e ? e as Outcome : { status: 500, body: { error: e instanceof Error ? e.message : "CORE failed" } }));

  if (new URL(req.url).searchParams.get("stream") === "1") {
    // NDJSON events: {type:"start",conversationId} {type:"step",id,label,key?,detail?,t}* {type:"step_done",id,ok,ms,result?,t}*
    // {type:"delta",text}* {type:"navigate",to}? then {type:"done",...} or {type:"error",error}. After a handoff: {type:"background",taskId},
    // then "done" (the handoff reply), the background turn's steps/deltas while the client stays, and {type:"bg_done",answer}.
    // A deduped retry gets only the final done/error line.
    const ac = new AbortController();
    req.signal.addEventListener("abort", () => ac.abort(), { once: true }); // client went away: kill the CLI (a background turn keeps going)
    const stream = ndjsonStream(async (send) => {
      const o = await once(send, ac.signal);
      send({ type: o.status === 200 ? "done" : "error", ...o.body });
      const bg = background && !ac.signal.aborted ? await background : null;
      if (bg) send({ type: "bg_done", ...bg });
    }, () => ac.abort());
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
  }

  const o = await once();
  return Response.json(o.body, { status: o.status === 499 ? 502 : o.status });
}

// The background turn runs in this Node process; a small record on disk (bg-resume.ts) lets the boot sweep resume it after a restart.
/** Run a handed-off CORE turn as an OPERATIONS task: its answer lands in the chat, and agent.completed/failed gives the one notice. */
async function inBackground(sb: SupabaseClient, userId: string, cid: string, message: string, trace: Parameters<typeof doneSoFar>[0], lang: string, run: (signal: AbortSignal) => ReturnType<typeof runCore>): Promise<{ taskId: string; finished: Promise<{ answer: string } | null> }> {
  const run0 = evalRunId(), title = `CORE: ${run0 ? `${evalMark(run0)} ` : ""}${message.replace(/\s+/g, " ").trim().slice(0, 80)}`;
  const { data, error } = await sb.from("tasks").insert({ user_id: userId, agent: "nova", title, request: message, status: "running", started_at: new Date().toISOString() }).select("id").single();
  if (error) throw error;
  const taskId: string = data.id;
  const rec = newBgTurn({ taskId, userId, chatId: cid, request: message, title, done: doneSoFar(trace), sessionId: coreSessionStore.get(cid)?.id, lang }, Date.now());
  const stop = await import("@/lib/bg-resume").then((m) => m.trackTurn(rec), () => undefined);
  return { taskId, finished: finishBackground(sb, userId, cid, taskId, title, run, stop, trace) };
}

/** The end of a background turn (fresh or resumed after a restart): answer or failure into the chat, task row, one notice. */
/** trace: the turn's shared trace (a fresh handoff's carry), so a cancel can say which steps had already run. */
export function finishBackground(sb: SupabaseClient, userId: string, cid: string, taskId: string, title: string, run: (signal: AbortSignal) => ReturnType<typeof runCore>, stop?: (() => Promise<void>) & { lost?: AbortSignal; confirm?: () => Promise<boolean> }, trace: { step: string; ok?: boolean }[] = []): Promise<{ answer: string } | null> {
  return (async () => {
    let status = "done", result: string | null = null, err: string | null = null, rc: Receipt | undefined;
    const lost = stop?.lost ?? new AbortController().signal; // bg-resume trackTurn: aborts when another ORBIT owns the turn now
    const cancel = new AbortController(), untrack = (await import("@/lib/agents")).trackLive(taskId, cancel); // Cancel and Stop-all reach it
    if (stopAllOn()) cancel.abort(); // handed off or resumed while Stop-all is on: nothing runs
    try {
      const out = await run(AbortSignal.any([lost, cancel.signal]));
      if (lost.aborted || (stop?.confirm && !(await stop.confirm()))) throw lost.reason; // still ours right before writing
      if (cancel.signal.aborted) throw cancel.signal.reason;
      result = out.text; rc = receiptOf(out.trace);
      logReceipt(rc);
      await sb.from("messages").insert({ user_id: userId, conversation_id: cid, role: "assistant", content: out.text, citations: out.citations, trace: out.trace });
      void noteReceipts(userId, cid, out.trace).catch(() => {});
    } catch (e) {
      if (lost.aborted || (stop?.confirm && !(await stop.confirm()))) { untrack(); await stop?.(); return null; } // the new owner finishes it and writes the answer; nothing from here
      if (cancel.signal.aborted) { status = "cancelled"; err = stoppedNote(stopAllOn(), trace); } // Cancel or Stop-all
      else {
        status = "failed"; err = (e as { orbitReason?: string } | null)?.orbitReason ?? BG_FAILED; // a resume that gave up says why
        console.error("[orbit] background CORE turn failed:", e instanceof Error ? e.message : e);
      }
      await sb.from("messages").insert({ user_id: userId, conversation_id: cid, role: "assistant", content: `_${err}_` }).then(() => {}, () => {});
    }
    untrack();
    await sb.from("tasks").update({ status, result, error: err, finished_at: new Date().toISOString(), ...(rc && { trace: [{ step: "receipt", detail: receiptLine(rc), ms: 0, ok: rc.status === "verified", receipt: rc }] }) }).eq("id", taskId).then(() => {}, () => {});
    await emit(sb, userId, status === "failed" ? "agent.failed" : "agent.completed", "agents", { taskId, status, title });
    await stop?.();
    return { answer: result ?? `_${err ?? BG_FAILED}_` };
  })();
}

const receiptOf = (trace: { step: string; receipt?: Receipt }[]) => trace.findLast((s) => s.receipt)?.receipt;
/** A turn that changed something leaves its receipt in Activity: the status and what failed or wasn't checked (no question text). */
function logReceipt(rc: Receipt | undefined) {
  if (rc) logActivity({ area: "core", title: `CORE turn: ${receiptLine(rc)}`, ...(rc.failed.length + rc.claimed.length || rc.check ? { detail: [...rc.failed, ...rc.claimed, ...(rc.check ? [`verifier: ${rc.check.ok ? "verified" : "not verified"}: ${rc.check.reason}`] : [])].join(" · ") } : {}), receipt: rc.status });
}
