import { authorizeApproval } from "@/lib/authority";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emit } from "@/lib/claude";
import { stopAllOn } from "@/lib/stop-all";
import { mailOutcome, sendContent } from "@/lib/business-pure";
import { allows } from "@/lib/autonomy";
import { crmOf, loadCrm, logEvent } from "@/lib/prospect-crm";
import { claimProblem } from "@/lib/prospect-crm-pure";

const COLS = "*";
const fail = (error: string, status = 400) => Response.json({ error }, { status });
const one = (q: PromiseLike<{ data: unknown; error: { message: string } | null }>) =>
  Promise.resolve(q).then(({ data, error }) => (error ? fail(error.message, 500) : data ? Response.json(data) : fail("Not found", 404)));

/** BUSINESS "Approve & send": emails prospect `id`'s saved draft, only if it is still the exact content the owner read (`seen` =
 *  sendStamp of {to, subject, text}: approval-pure approvalGate) and still "To contact" (AGENTS.md rule 6). Used by /api/business and the phone remote's approve. */
export async function sendDraft(sb: SupabaseClient, userId: string, id: string, seen: unknown, via = "approved in ORBIT"): Promise<Response> {
  const key = process.env.RESEND_API_KEY, from = process.env.ORBIT_MAIL_FROM;
  if (!key || !from) return fail("Sending isn't set up: add RESEND_API_KEY and ORBIT_MAIL_FROM to .env.local", 503);
  if (stopAllOn()) return fail("Not sending: Stop-all is on", 503);
  const off = allows("business-send", "owner"); // Profile → Autonomy: Off refuses even his click; the auto runner checked "auto" itself
  if (!off.ok) return fail(`Not sending: ${off.why}`, 503);
  const { data: p, error } = await sb.from("prospects").select("name, contact, draft, stage, notes, updated_at").eq("id", id).maybeSingle();
  if (error) return fail(error.message, 500);
  if (!p) return fail("Not found", 404);
  const mail = sendContent(p), to = mail.to;
  if (!to) return fail("No single email address in Contact: add one (phone numbers can't be emailed)");
  if (!p.draft?.trim()) return fail("Draft a message first");
  // Only the first message is sent from here (stage "To contact"); follow-ups are copied and sent by him, then logged as sent.
  const who = { id, name: p.name, contact: p.contact, notes: p.notes }, crm = crmOf(await loadCrm(), who);
  if (!crm.verified) return fail("Check this contact first (found on the web): open their site, then click Verified", 409);
  const claim = claimProblem(p.draft, crm.events);
  if (claim) return fail(claim, 409);
  const stamp = new Date().toISOString();
  // Claim before sending: only a business still "To contact" is emailed, once.
  // seen: the hash of the exact email the owner read; any change since (draft, address, name) needs a fresh approval.
  const gate = await authorizeApproval("business.send", seen, mail);
  if (gate) return fail(gate, 409);
  const { data: claimed, error: claimErr } = await sb.from("prospects").update({ stage: "contacted", updated_at: stamp }).eq("id", id).eq("stage", "lead").eq("updated_at", p.updated_at).select("id");
  if (claimErr) return fail(claimErr.message, 500);
  if (!claimed?.length) return fail("Not sent: it was already contacted, or the draft changed since you read it. Reload and check it again.", 409);
  await emit(sb, userId, "business.stage", "business", { prospect: id, to: "contacted" });
  let r: Response;
  try {
    r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "Idempotency-Key": `orbit-${id}-${seen}` }, // Resend sends one email per key
      body: JSON.stringify({ from, to, subject: mail.subject, text: mail.text, ...(process.env.ORBIT_MAIL_REPLY_TO ? { reply_to: process.env.ORBIT_MAIL_REPLY_TO } : {}) }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    // No answer: it may have gone out. Stays "Contacted" so a second click can't email them twice.
    const notes = `${p.notes ? `${p.notes}\n` : ""}Email to ${to} on ${stamp.slice(0, 10)}: result unknown (no answer from Resend). Check your Resend log before sending again.`.slice(-2000);
    await sb.from("prospects").update({ notes }).eq("id", id);
    await logEvent(who, "sent", "first message: result unknown");
    return fail("No answer from the email service: it may or may not have been sent. Check your Resend log; it stays marked Contacted.", 504);
  }
  if (mailOutcome(r.status) === "unknown") { // server trouble or a 409 on this key: it may have gone out, same as no answer
    await sb.from("prospects").update({ notes: `${p.notes ? `${p.notes}\n` : ""}Email to ${to} on ${stamp.slice(0, 10)}: result unknown (Resend ${r.status}). Check your Resend log.`.slice(-2000) }).eq("id", id);
    await logEvent(who, "sent", "first message: result unknown");
    return fail(`The email service had a problem (${r.status}): it may or may not have been sent. Check your Resend log; it stays marked Contacted.`, 502);
  }
  if (!r.ok) { // a clear refusal (4xx): nothing was sent, so it goes back to "To contact"
    const { data: back } = await sb.from("prospects").update({ stage: "lead" }).eq("id", id).eq("stage", "contacted").select("id");
    if (back?.length) await emit(sb, userId, "business.stage", "business", { prospect: id, to: "lead" });
    return fail(`Not sent: Resend ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`, 502);
  }
  await logEvent(who, "sent", `first message to ${to} (${via})`, stamp);
  const notes = `${p.notes ? `${p.notes}\n` : ""}Emailed ${to} on ${stamp.slice(0, 10)} (${via}).`.slice(-2000);
  return one(sb.from("prospects").update({ notes }).eq("id", id).select(COLS).maybeSingle());
}

/** One email through Resend, the BUSINESS send path, for callers that already gated (Stop-all, autonomy) and claimed the send.
 *  "unknown": no answer or a server error, it may have gone out; "refused": a clear 4xx, nothing went out. */
export async function resendMail(m: { to: string; subject: string; text: string; idempotencyKey: string }): Promise<{ result: "sent" | "unknown" | "refused"; why?: string }> {
  const key = process.env.RESEND_API_KEY, from = process.env.ORBIT_MAIL_FROM;
  if (!key || !from) return { result: "refused", why: "Sending isn't set up" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "Idempotency-Key": m.idempotencyKey },
      body: JSON.stringify({ from, to: m.to, subject: m.subject, text: m.text, ...(process.env.ORBIT_MAIL_REPLY_TO ? { reply_to: process.env.ORBIT_MAIL_REPLY_TO } : {}) }),
      signal: AbortSignal.timeout(20_000),
    });
    const result = mailOutcome(r.status);
    return result === "sent" ? { result } : { result, why: `Resend ${r.status}` };
  } catch { return { result: "unknown", why: "no answer from Resend" }; }
}
