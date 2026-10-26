import { randomInt } from "node:crypto";
import { GENERIC_ERROR, ledgerData, MAX_REMOTE_BODY, RATE, stopProblem } from "@/lib/remote-web-pure";
import { ownerClient, pendingApprovals, rateOk, remoteChat, remoteProblem, remoteSecret, S } from "@/lib/remote";
import { checkReply, challengeLine, findShortcut, makeChallenge, SHORTCUT_RATE, speakable, statusLine, watchApprovable } from "@/lib/remote-shortcut-pure";
import { listShortcuts, SC } from "@/lib/remote-shortcut";
import { decideApproval } from "@/lib/remote-act";
import { MAX_ASK_CHARS } from "@/lib/remote-pure";
import { stopAllState } from "@/lib/stop-all";
import { switchStopAll } from "@/lib/stop-all-run";
import { listJobs } from "@/lib/clips/factory";
import { callLive, ringNow } from "@/lib/call";
import { pushProblem } from "@/lib/remote-push";
import { coreTurn } from "@/lib/core-turn";
import { emit } from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Apple Watch / iPhone Shortcuts ("Get Contents of URL", POST, header Authorization: Bearer <token>). Each token does ONE action
// (status, call, stop, approve, ask) and is made/revoked in Profile → Phone remote. Answers are plain text for Siri to speak.
// Same rules as the phone remote: Stop-all ON only, approvals only for items waiting now with the exact echo (decideApproval),
// spends only at the credits he says back, never email sends. Recipes: docs/PHONE.md "Shortcuts & Watch".
const say = (text: string, status = 200) => new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  if (remoteProblem()) return say("ORBIT's phone remote is off on the PC.", 503);
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_REMOTE_BODY) return say("Request too large.", 413);
  const sc = findShortcut(await listShortcuts(), req.headers.get("authorization"), remoteSecret());
  if (!sc) return say("This shortcut isn't connected to ORBIT. Make a new token in Profile, Phone remote.", 401);
  if (!rateOk(`sc:${sc.id}`, SHORTCUT_RATE)) return say("Too many requests: wait a minute.", 429);
  S.seen.set(`sc:${sc.id}`, new Date().toISOString());

  let body: Record<string, unknown> = {};
  if (raw.trim()) {
    try { body = JSON.parse(raw); } catch { return say("Body must be JSON.", 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((k) => k !== "text" && k !== "reply")) return say("Body may only have text or reply.", 400);
  }
  let sb;
  try { sb = await ownerClient(sc.userId); } catch (e) {
    console.error("[shortcut] owner session:", e instanceof Error ? e.message : e);
    return say("The PC can't act for you right now. Check ORBIT on the PC.", 503);
  }
  const done = (res: Response) => { void emit(sb, sc.userId, "remote.command", "core", ledgerData({ type: `shortcut.${sc.action}` }, res.ok, `shortcut:${sc.id}`)); return res; };

  try {
    switch (sc.action) {
      case "status": {
        const [items, jobs] = await Promise.all([pendingApprovals(sb), listJobs().catch(() => [])]);
        return done(say(statusLine({ stopOn: stopAllState().on, kinds: items.map((i) => i.kind), running: jobs.filter((j) => !["done", "failed"].includes(j.status)).length })));
      }
      case "call": {
        if (pushProblem()) return done(say("Notifications aren't set up: enable them in Remote on the iPhone first.", 503));
        if (callLive()) return done(say("A call is already on.", 409));
        if (!rateOk(`ring:${sc.id}`, { limit: 1, windowMs: 120_000 })) return done(say("Already ringing: wait two minutes.", 429));
        const n = await ringNow(sb, sc.userId);
        return done(n ? say("Ringing your iPhone. Tap the notification, then Answer.") : say("Couldn't reach your iPhone: open Remote and enable notifications.", 502));
      }
      case "stop": {
        const why = stopProblem(stopAllState().on, { on: false }); // ON only: resuming stays on the PC
        if (why) return done(say(why, 409));
        const r = await switchStopAll(sb, sc.userId, true, " (from a Shortcut)");
        return done(say(`Stop-all is ON. ${r.cancelled} task${r.cancelled === 1 ? "" : "s"} cancelled.${r.warning ? " Not saved to disk: it resets if ORBIT restarts." : ""}`));
      }
      case "approve": {
        if (body.reply === undefined) { // step 1: name the next item and a fresh code
          const items = await pendingApprovals(sb);
          const next = items.find(watchApprovable);
          if (!next) {
            SC.challenges.delete(sc.id);
            const mails = items.filter((i) => i.kind === "send").length;
            return done(say(mails ? `Nothing to approve from the watch. ${mails} email draft${mails === 1 ? " is" : "s are"} waiting: approve in Remote, where you can read it.` : "Nothing waiting for approval."));
          }
          const ch = makeChallenge(sc.id, next, randomInt, Date.now());
          SC.challenges.set(sc.id, ch);
          return done(say(challengeLine(next, ch.code)));
        }
        const c = checkReply(SC.challenges.get(sc.id) ?? null, body.reply, Date.now()); // step 2: the code (and credits) he said
        if (!c.ok) {
          if (c.next) SC.challenges.set(sc.id, c.next); else SC.challenges.delete(sc.id);
          return done(say(c.error, 409));
        }
        SC.challenges.delete(sc.id); // single use, whatever happens next
        const res = await decideApproval(sb, sc.userId, c.id, "approve", c.echo); // the same echo checks as the phone's Approve button
        const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        return done(say(res.ok ? `${j.message ?? "Approved"}.` : `Not approved: ${j.error ?? GENERIC_ERROR}.`, res.status));
      }
      case "ask": {
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text || text.length > MAX_ASK_CHARS) return done(say("Say a question for CORE.", 400));
        if (!rateOk(`ask:sc:${sc.id}`, RATE.ask)) return done(say("Too many questions: wait a minute.", 429));
        const key = `sc:${sc.id}`;
        const res = await coreTurn(req, sb, sc.userId, { message: text, voice: true, conversationId: remoteChat(key) },
          { remote: true, onConversation: (id) => S.chat.set(key, { id, at: Date.now() }) });
        const j = (await res.json().catch(() => ({}))) as { answer?: string; error?: string };
        if (!res.ok || typeof j.answer !== "string") { console.error("[shortcut] ask:", j.error ?? res.status); return done(say("CORE couldn't answer. Try again or check ORBIT on the PC.", 502)); }
        return done(say(speakable(j.answer)));
      }
    }
  } catch (e) {
    console.error(`[shortcut] ${sc.action}:`, e instanceof Error ? e.message : e);
    return done(say(GENERIC_ERROR + ".", 500));
  }
}
