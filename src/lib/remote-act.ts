// Approve/reject one waiting item for the owner: shared by the phone's tap (/api/remote) and a voice call's spoken "yes"
// (/api/remote/talk), so both go through the same echo checks and the same functions the PC uses.
import type { SupabaseClient } from "@supabase/supabase-js";
import { stat } from "node:fs/promises";
import { echoProblem, GENERIC_ERROR, quoteStamp, type Echo } from "@/lib/remote-web-pure";
import { pendingApprovals } from "@/lib/remote";
import { clipsDir, getJob, startClipQueue, updateClip, withJobLock } from "@/lib/clips/factory";
import { resolveInside } from "@/lib/clips/pure";
import { approveStory, getStory } from "@/lib/clips/story";
import { sendDraft } from "@/lib/business-send";
import { approveNegotiation } from "@/lib/negotiator";
import { approveReminder } from "@/lib/invoices";

const fail = (error: string, status = 400) => Response.json({ error }, { status });
// Messages the owner can act on; anything else from the send path (Supabase/Resend text) stays in the server log.
const SEND_TEXT: Record<number, string> = {
  409: "Not sent: it was already contacted or the draft changed. Reload.",
  503: "Not sending right now: Stop-all is on or email isn't set up on the PC.",
  502: "The email service didn't confirm: it may or may not have gone out. Check on the PC before trying again.",
  504: "The email service didn't answer: it may or may not have gone out. Check on the PC before trying again.",
};

/** Acts only on an item listed as waiting right now whose echo (kind, version, credits) matches exactly. {ok, message} or {error}. */
export async function decideApproval(sb: SupabaseClient, userId: string, id: string, action: "approve" | "reject", echo: Echo | null): Promise<Response> {
  const item = (await pendingApprovals(sb)).find((a) => a.id === id);
  const why = echoProblem(item, echo, action);
  if (why || !item) return fail(why, 409);
  if (item.kind === "clip") {
    const [jobId, clipId] = item.key.slice(5).split("/");
    startClipQueue();
    return withJobLock(async () => {
      const job = await getJob(jobId);
      const clip = job?.clips.find((c) => c.id === clipId);
      if (!job || !clip || clip.status !== "ready" || clip.retryOf) return fail("That clip is no longer waiting: reload", 409);
      if (action === "approve") { // he must have been able to see it: no thumbnail file, no phone approval
        const abs = clip.thumb?.startsWith("clips/") ? resolveInside(clipsDir(), clip.thumb.slice(6)) : null;
        if (!abs || !/\.jpe?g$/i.test(abs) || !(await stat(abs).catch(() => null))?.isFile()) return fail("Open it on the PC to review: no preview for the phone", 409);
      }
      await updateClip(job, clip, { status: action === "approve" ? "approved" : "rejected" });
      return Response.json({ ok: true, message: action === "approve" ? "Approved" : "Rejected" });
    });
  }
  if (item.kind === "spend") {
    const job = await getStory(item.key.slice(6));
    if (!job) return fail("Story not found", 404);
    if (!job.quote || quoteStamp(job.quote) !== item.seen) return fail("The quote changed since you saw it: reload", 409); // re-read: bound to the script and quote he saw
    const out = await approveStory(job, item.credits); // re-checks the exact quote (approveProblem) before any credit is spent
    return typeof out === "string" ? fail(out, 409) : Response.json({ ok: true, message: `Approved ${item.credits} credits: generating` });
  }
  if (item.kind === "nego") {
    const r = await approveNegotiation(sb, userId, item.key.slice(5), item.seen); // re-checks the draft version and his limits
    const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
    return r.ok ? Response.json({ ok: true, message: j.message ?? "Approved" }) : fail(j.error ?? GENERIC_ERROR, r.status) // negotiator errors are owner-facing text, no Supabase/Resend bodies;
  }
  if (item.kind === "invoice") {
    const r = await approveReminder(sb, userId, item.key.slice(8), item.seen); // Stop-all, Autonomy business-send, claim-first, exact draft version
    const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string; text?: string };
    if (r.ok) return Response.json({ ok: true, message: j.text ? "Approved: copy the reminder and send it yourself." : `Reminder sent to ${item.to}` }); // fixed text: no Resend reasons on the phone
    if (r.status === 502) return fail(SEND_TEXT[502], 502);
    return fail(j.error ?? GENERIC_ERROR, r.status); // invoices.ts errors are owner-facing text
  }
  const sent = await sendDraft(sb, userId, item.key.slice(5), item.seen); // claims only the draft version the phone showed
  if (sent.ok) return Response.json({ ok: true, message: `Sent to ${item.to}` });
  console.error("[remote] send:", (await sent.text().catch(() => "")).slice(0, 300));
  return fail(SEND_TEXT[sent.status] ?? GENERIC_ERROR, sent.status);
}
