import { parseCommand, type RemoteCommand } from "@/lib/remote-pure";
import { actionFor, GENERIC_ERROR, MAX_REMOTE_BODY, parseEcho, RATE, stopProblem } from "@/lib/remote-web-pure";
import { deviceFromCookie, logCommand, ownerClient, pendingApprovals, rateOk, remoteChat, remoteProblem, S } from "@/lib/remote";
import { decideApproval } from "@/lib/remote-act";
import { stopAllState } from "@/lib/stop-all";
import { switchStopAll } from "@/lib/stop-all-run";
import { listJobs, publishingKey } from "@/lib/clips/factory";
import { runningStory } from "@/lib/clips/story";
import { coreTurn } from "@/lib/core-turn";
import { deviceType, scopeAllows } from "@/lib/screen-pure";
import { getBrief } from "@/lib/brief";
import { allows } from "@/lib/autonomy";

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
  const device = await deviceFromCookie(true); // a screen gets through here, then only to its read-only allow-list below
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
  if (!scopeAllows(deviceType(device), actionFor(cmd))) { log(cmd, false); return fail("This screen is read-only", 403); }
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
      case "reject":
        return done(await decideApproval(sb, device.userId, (cmd as { id: string }).id, cmd.type === "approve" ? "approve" : "reject", e.echo));
      case "stopAll": {
        const why = stopProblem(stopAllState().on, e.echo); // ON only: resuming stays on the PC
        if (why) return done(fail(why, 409));
        const r = await switchStopAll(sb, device.userId, true, " (from the phone)");
        return done(Response.json({ stop: r.stop, cancelled: r.cancelled, goals: r.goals, ...(r.warning ? { warning: "On now, but not saved to disk: it resets if ORBIT restarts" } : {}) }));
      }
      case "ask": {
        if (!rateOk(`ask:${device.id}`, RATE.ask)) return done(fail("Too many questions: wait a minute", 429));
        const { text, lang } = cmd as { text: string; lang?: "et" };
        const res = await coreTurn(req, sb, device.userId, { message: text, conversationId: remoteChat(device.id), lang },
          { remote: true, onConversation: (id) => S.chat.set(device.id, { id, at: Date.now() }) });
        if (!res.ok) return done(hidden("core.ask", await res.text().catch(() => ""), res.status));
        return done(sanitizeStream(res));
      }
      case "brief": { // car mode reads it aloud: the same brief the PC shows (Profile → Autonomy: Off = none)
        if (!allows("brief", "background", { stopAll: false }).ok) return done(Response.json({ off: true }));
        const b = await getBrief(sb, device.userId);
        return done(Response.json({ greeting: b.greeting, spoken: b.spoken }));
      }
      default:
        return done(fail("Not available from the phone"));
    }
  } catch (err) {
    log(cmd, false);
    return hidden(cmd.type, err);
  }
}
