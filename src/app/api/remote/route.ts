import { parseCommand, type RemoteCommand } from "@/lib/remote-pure";
import { actionFor, echoProblem, GENERIC_ERROR, MAX_REMOTE_BODY, parseEcho, quoteStamp, RATE, stopProblem } from "@/lib/remote-web-pure";
import { deviceFromCookie, logCommand, ownerClient, pendingApprovals, rateOk, remoteChat, remoteProblem, S } from "@/lib/remote";
import { stopAllState } from "@/lib/stop-all";
import { switchStopAll } from "@/lib/stop-all-run";
import { clipsDir, getJob, listJobs, publishingKey, startClipQueue, updateClip, withJobLock } from "@/lib/clips/factory";
import { resolveInside } from "@/lib/clips/pure";
import { stat } from "node:fs/promises";
import { approveStory, getStory, runningStory } from "@/lib/clips/story";
import { sendDraft } from "@/lib/business-send";
import { coreTurn } from "@/lib/core-turn";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The phone remote's one command endpoint. Body: {cmd: "<remote-pure command JSON>", echo?}. Every request: device token
// (HttpOnly cookie) → rate limit → parseCommand (size, fields, nonce replay) → echo check → the same functions the PC uses.
// The phone never creates spends or sends: approve only acts on an item listed as waiting right now, with the exact echo.
const fail = (error: string, status = 400) => Response.json({ error }, { status });
/** Log the real reason here; the phone gets a fixed message. */
const hidden = (where: string, detail: unknown, status = 500, text = GENERIC_ERROR) => {
  console.error(`[remote] ${where}:`, detail instanceof Error ? detail.message : detail);
  return fail(text, status);
};
// Messages the owner can act on; anything else from the send path (Supabase/Resend text) stays in the server log.
const SEND_TEXT: Record<number, string> = {
  409: "Not sent: it was already contacted or the draft changed. Reload.",
  503: "Not sending right now: Stop-all is on or email isn't set up on the PC.",
  502: "The email service didn't confirm: it may or may not have gone out. Check on the PC before trying again.",
  504: "The email service didn't answer: it may or may not have gone out. Check on the PC before trying again.",
};

/** CORE's NDJSON stream with any error event's text replaced (it can carry raw CLI/DB messages). */
function sanitizeStream(res: Response): Response {
  if (!res.ok || !res.body) return res;
  let buf = "";
  const enc = new TextEncoder();
  const clean = (line: string) => {
    try {
      const ev = JSON.parse(line);
      if (ev?.type === "error") { console.error("[remote] core.ask:", ev.error); return JSON.stringify({ type: "error", error: "CORE couldn't answer: try again or check ORBIT on the PC" }); }
    } catch { /* pass through */ }
    return line;
  };
  const body = res.body.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream<string, Uint8Array>({
    transform(chunk, ctrl) {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) ctrl.enqueue(enc.encode(clean(l) + "\n"));
    },
    flush(ctrl) { if (buf) ctrl.enqueue(enc.encode(clean(buf))); },
  }));
  return new Response(body, { status: res.status, headers: res.headers });
}

export async function POST(req: Request) {
  const problem = remoteProblem();
  if (problem) return fail(problem, 503);
  const device = await deviceFromCookie();
  if (!device) return fail("Not paired", 401);
  if (!rateOk(`cmd:${device.id}`, RATE.cmd)) return fail("Too many commands: wait a minute", 429);
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_REMOTE_BODY) return fail("Request too large", 413);
  let sb;
  try { sb = await ownerClient(device.userId); } catch (e) { return hidden("owner session", e, 503, "The PC can't act for you right now: check ORBIT's log on the PC"); }
  const log = (cmd: RemoteCommand | null, ok: boolean) => void logCommand(sb, device.userId, cmd, ok, device.id);

  let body: { cmd?: unknown; echo?: unknown } | null = null;
  try { body = JSON.parse(raw); } catch { /* below */ }
  if (!body || typeof body !== "object" || Object.keys(body).some((k) => k !== "cmd" && k !== "echo")) { log(null, false); return fail("Body must be {cmd, echo?}"); }
  const parsed = parseCommand(body.cmd, S.nonces);
  if (!parsed.ok) { log(null, false); return fail(parsed.error); }
  const cmd = parsed.cmd;
  const e = parseEcho(cmd, body.echo);
  if (!e.ok) { log(cmd, false); return fail(e.error); }
  const done = (res: Response) => { log(cmd, res.ok); return res; };

  try {
    switch (actionFor(cmd)) {
      case "status": {
        const jobs = await listJobs().catch(() => []);
        const clips = jobs.flatMap((j) => j.clips);
        return done(Response.json({
          stop: stopAllState(),
          queue: {
            active: jobs.filter((j) => !["done", "failed"].includes(j.status)).slice(0, 10).map((j) => ({ id: j.id, source: j.source, status: j.status, step: j.step, progress: j.progress })),
            ready: clips.filter((c) => c.status === "ready").length,
            approved: clips.filter((c) => c.status === "approved" && c.publish?.status !== "done").length,
            publishing: publishingKey(),
            story: runningStory(),
          },
        }));
      }
      case "approvals":
        return done(Response.json({ items: (await pendingApprovals(sb)).map(({ key: _key, ...a }) => a) }));
      case "approve":
      case "reject": {
        const id = (cmd as { id: string }).id;
        const action = cmd.type === "approve" ? "approve" : "reject";
        const item = (await pendingApprovals(sb)).find((a) => a.id === id);
        const why = echoProblem(item, e.echo, action);
        if (why || !item) return done(fail(why, 409));
        if (item.kind === "clip") {
          const [jobId, clipId] = item.key.slice(5).split("/");
          startClipQueue();
          return done(await withJobLock(async () => {
            const job = await getJob(jobId);
            const clip = job?.clips.find((c) => c.id === clipId);
            if (!job || !clip || clip.status !== "ready" || clip.retryOf) return fail("That clip is no longer waiting: reload", 409);
            if (action === "approve") { // he must have been able to see it: no thumbnail file, no phone approval
              const abs = clip.thumb?.startsWith("clips/") ? resolveInside(clipsDir(), clip.thumb.slice(6)) : null;
              if (!abs || !/\.jpe?g$/i.test(abs) || !(await stat(abs).catch(() => null))?.isFile()) return fail("Open it on the PC to review: no preview for the phone", 409);
            }
            await updateClip(job, clip, { status: action === "approve" ? "approved" : "rejected" });
            return Response.json({ ok: true, message: action === "approve" ? "Approved" : "Rejected" });
          }));
        }
        if (item.kind === "spend") {
          const job = await getStory(item.key.slice(6));
          if (!job) return done(fail("Story not found", 404));
          if (!job.quote || quoteStamp(job.quote) !== item.seen) return done(fail("The quote changed since you saw it: reload", 409)); // re-read: bound to the script and quote he saw
          const out = await approveStory(job, item.credits); // re-checks the exact quote (approveProblem) before any credit is spent
          return done(typeof out === "string" ? fail(out, 409) : Response.json({ ok: true, message: `Approved ${item.credits} credits: generating` }));
        }
        const sent = await sendDraft(sb, device.userId, item.key.slice(5), item.seen); // claims only the draft version the phone showed
        if (sent.ok) return done(Response.json({ ok: true, message: `Sent to ${item.to}` }));
        return done(hidden("send", await sent.text().catch(() => ""), sent.status, SEND_TEXT[sent.status] ?? GENERIC_ERROR));
      }
      case "stopAll": {
        const why = stopProblem(stopAllState().on, e.echo); // ON only: resuming stays on the PC
        if (why) return done(fail(why, 409));
        const r = await switchStopAll(sb, device.userId, true, " (from the phone)");
        return done(Response.json({ stop: r.stop, cancelled: r.cancelled, goals: r.goals, ...(r.warning ? { warning: "On now, but not saved to disk: it resets if ORBIT restarts" } : {}) }));
      }
      case "ask": {
        if (!rateOk(`ask:${device.id}`, RATE.ask)) return done(fail("Too many questions: wait a minute", 429));
        const text = (cmd as { text: string }).text;
        const res = await coreTurn(req, sb, device.userId, { message: text, conversationId: remoteChat(device.id) },
          { remote: true, onConversation: (id) => S.chat.set(device.id, { id, at: Date.now() }) });
        if (!res.ok) return done(hidden("core.ask", await res.text().catch(() => ""), res.status));
        return done(sanitizeStream(res));
      }
      default:
        return done(fail("Not available from the phone"));
    }
  } catch (err) {
    log(cmd, false);
    return hidden(cmd.type, err);
  }
}
