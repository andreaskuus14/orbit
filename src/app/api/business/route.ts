import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { BusyError, askClaude, emit } from "@/lib/claude";
import { usageHold } from "@/lib/usage-meter";
import { stopAllOn } from "@/lib/stop-all";
import { FOLLOWUP_SYSTEM, followupPrompt, FIND_SYSTEM, LANGS, OUTREACH_SYSTEM, RESEARCH_SYSTEM, emailIn, findPrompt, funnel, isTemplate, outreachPrompt, parseDraft, parseFinds, researchPrompt, sendSubject, trimDossier, validatePatch, validateProspect, withDossier, type Lang, type Prospect } from "@/lib/business-pure";

export const dynamic = "force-dynamic";

// BUSINESS planet: client pipeline (Supabase public.prospects, RLS: own rows). Logic: src/lib/business-pure.ts.
// POST {action:"find", query} | {action:"add", name, kind?, contact?, notes?} | {action:"update", id, ...fields} | {action:"draft", id, lang} | {action:"delete", id}.
// "find" lets CORE search the web (read-only WebSearch/WebFetch only) and returns suggestions; nothing is saved until the owner adds one.
// "draft" asks CORE (Claude Code on the owner's plan) for an outreach message.
// {action:"send", id} emails that saved draft, only from the owner's own two clicks (AGENTS.md rule 6). Needs RESEND_API_KEY +
// ORBIT_MAIL_FROM. The stage lead → contacted is claimed first, so one business is emailed once even on a double click.
// {action:"research", id} lets CORE read the business's public pages (read-only web tools) and saves a short dossier in its notes.
// "draft" takes angle (speed | missed-leads | free-pilot | auto) and tags the prospect's `template` (0015_prospect_template.sql).
// "*" so `template` comes back when 0015 has run and reads still work before it.
const COLS = "*";
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET() {
  const { sb, res } = await requireUser();
  if (res) return res;
  const { data, error } = await sb.from("prospects").select(COLS).order("updated_at", { ascending: false }).limit(300);
  if (error) return fail(error.code === "42P01" ? "Run supabase/migrations/0011_business.sql first" : error.message, 500);
  const prospects = (data ?? []).map((p) => ({ ...p, fee: Number(p.fee) })) as Prospect[];
  return Response.json({ prospects, funnel: funnel(prospects), canSend: !!(process.env.RESEND_API_KEY && process.env.ORBIT_MAIL_FROM) });
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/business", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return fail("JSON body required");
  if (b.action === "find") {
    const query = typeof b.query === "string" ? b.query.trim() : "";
    if (!query) return fail("Say what to look for, e.g. cake shops in Tallinn");
    const held = stopAllOn() ? "Stop-all is on" : usageHold();
    if (held) return fail(`Not searching right now: ${held}`, 503);
    try {
      const r = await askClaude(findPrompt(query), FIND_SYSTEM, { lane: "foreground", purpose: "business.find", timeoutMs: 180_000, web: true, signal: req.signal });
      const finds = parseFinds(r.text);
      return finds.length ? Response.json({ finds }) : fail("CORE found nothing usable; try other words", 502);
    } catch (e) {
      if (e instanceof BusyError) return fail("CORE is busy; try again in a moment", 429);
      return fail(`Couldn't search: ${e instanceof Error ? e.message : "unknown error"}`, 502);
    }
  }
  if (b.action !== "add" && (typeof b.id !== "string" || !/^[0-9a-f-]{36}$/i.test(b.id))) return fail("id required");
  const one = (q: PromiseLike<{ data: unknown; error: { message: string } | null }>) =>
    Promise.resolve(q).then(({ data, error }) => (error ? fail(error.message, 500) : data ? Response.json(data) : fail("Not found", 404)));

  switch (b.action) {
    case "add": {
      const p = validateProspect(b);
      if (typeof p === "string") return fail(p);
      const r = await sb.from("prospects").insert(p).select(COLS).single();
      if (r.data) await emit(sb, user.id, "business.stage", "business", { prospect: r.data.id, to: r.data.stage }); // a new prospect enters the pipeline
      return one(Promise.resolve(r));
    }
    case "update": {
      const p = validatePatch(b);
      if (typeof p === "string") return fail(p);
      const before = p.stage ? (await sb.from("prospects").select("stage").eq("id", b.id as string).maybeSingle()).data : null;
      const r = await sb.from("prospects").update({ ...p, updated_at: new Date().toISOString() }).eq("id", b.id as string).select(COLS).maybeSingle();
      if (!r.error && r.data && p.stage && before?.stage !== p.stage) await emit(sb, user.id, "business.stage", "business", { prospect: b.id, to: p.stage }); // the id, never the name
      return one(Promise.resolve(r));
    }
    case "delete": {
      const { error } = await sb.from("prospects").delete().eq("id", b.id as string);
      return error ? fail(error.message, 500) : Response.json({ ok: true });
    }
    case "research": {
      const held = stopAllOn() ? "Stop-all is on" : usageHold();
      if (held) return fail(`Not researching right now: ${held}`, 503);
      const { data: p, error } = await sb.from("prospects").select("name,kind,contact,notes").eq("id", b.id as string).maybeSingle();
      if (error) return fail(error.message, 500);
      if (!p) return fail("Not found", 404);
      try {
        const r = await askClaude(researchPrompt(p), RESEARCH_SYSTEM, { lane: "foreground", purpose: "business.research", timeoutMs: 180_000, web: true, signal: req.signal });
        const dossier = trimDossier(r.text);
        if (!dossier) return fail("CORE found nothing usable about them", 502);
        const notes = withDossier(p.notes ?? "", dossier);
        if (notes === null) return fail("Notes are full: shorten them to make room for the research");
        return one(sb.from("prospects").update({ notes, updated_at: new Date().toISOString() }).eq("id", b.id as string).select(COLS).maybeSingle());
      } catch (e) {
        if (e instanceof BusyError) return fail("CORE is busy; try again in a moment", 429);
        return fail(`Couldn't research: ${e instanceof Error ? e.message : "unknown error"}`, 502);
      }
    }
    case "followup":
    case "draft": {
      const followup = b.action === "followup";
      const lang = (LANGS as readonly string[]).includes(b.lang as string) ? (b.lang as Lang) : "English";
      const held = stopAllOn() ? "Stop-all is on" : usageHold();
      if (held) return fail(`Not drafting right now: ${held}`, 503);
      const { data: p, error } = await sb.from("prospects").select("name,kind,notes,draft,stage,updated_at").eq("id", b.id as string).maybeSingle();
      if (error) return fail(error.message, 500);
      if (!p) return fail("Not found", 404);
      if (followup && (p.stage !== "contacted" || !p.draft?.trim())) return fail("A contacted business with a first draft is required");
      try {
        const angle = isTemplate(b.angle) ? b.angle : "auto";
        const r = await askClaude(followup ? followupPrompt(p, lang) : outreachPrompt(p, lang, angle), followup ? FOLLOWUP_SYSTEM : OUTREACH_SYSTEM, { lane: "foreground", purpose: followup ? "business.followup" : "business.outreach", timeoutMs: 90_000 });
        const { draft, template } = followup ? { draft: r.text.trim().slice(0, 4000), template: null } : parseDraft(r.text, angle);
        if (followup && draft === p.draft.trim()) return fail("CORE repeated the first draft; try again", 502);
        if (!draft) return fail("CORE returned an empty draft; try again", 502);
        const save = (patch: object) => sb.from("prospects").update(patch).eq("id", b.id as string).select(COLS).maybeSingle();
        const patch = { draft, updated_at: new Date().toISOString() };
        // Tag only drafts that haven't gone out yet, so a sent message keeps the angle it was sent with.
        if (!template || p.stage !== "lead") return one(save(patch));
        const tagged = await save({ ...patch, template });
        return one(Promise.resolve(tagged.error?.code === "42703" ? save(patch) : tagged)); // no column before 0015: save untagged
      } catch (e) {
        if (e instanceof BusyError) return fail("CORE is busy; try again in a moment", 429);
        return fail(`Couldn't draft: ${e instanceof Error ? e.message : "unknown error"}`, 502);
      }
    }
    case "send": {
      const key = process.env.RESEND_API_KEY, from = process.env.ORBIT_MAIL_FROM;
      if (!key || !from) return fail("Sending isn't set up: add RESEND_API_KEY and ORBIT_MAIL_FROM to .env.local", 503);
      if (stopAllOn()) return fail("Not sending: Stop-all is on", 503);
      const { data: p, error } = await sb.from("prospects").select("name, contact, draft, stage, notes").eq("id", b.id as string).maybeSingle();
      if (error) return fail(error.message, 500);
      if (!p) return fail("Not found", 404);
      const to = emailIn(p.contact ?? "");
      if (!to) return fail("No single email address in Contact: add one (phone numbers can't be emailed)");
      if (!p.draft?.trim()) return fail("Draft a message first");
      const stamp = new Date().toISOString();
      // Claim before sending: only a business still "To contact" is emailed, once.
      // seen: the updated_at of the draft the owner looked at; a redraft since then must be read again before it can go out.
      if (typeof b.seen !== "string") return fail("Reload and read the draft before sending");
      const { data: claimed, error: claimErr } = await sb.from("prospects").update({ stage: "contacted", updated_at: stamp }).eq("id", b.id as string).eq("stage", "lead").eq("updated_at", b.seen).select("id");
      if (claimErr) return fail(claimErr.message, 500);
      if (!claimed?.length) return fail("Not sent: it was already contacted, or the draft changed since you read it. Reload and check it again.", 409);
      await emit(sb, user.id, "business.stage", "business", { prospect: b.id, to: "contacted" });
      let r: Response;
      try {
        r = await fetch("https://api.resend.com/emails", {
          method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "Idempotency-Key": `orbit-${b.id}-${b.seen}` }, // Resend sends one email per key
          body: JSON.stringify({ from, to, subject: sendSubject(p.name, p.draft), text: p.draft, ...(process.env.ORBIT_MAIL_REPLY_TO ? { reply_to: process.env.ORBIT_MAIL_REPLY_TO } : {}) }),
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        // No answer: it may have gone out. Stays "Contacted" so a second click can't email them twice.
        const notes = `${p.notes ? `${p.notes}\n` : ""}Email to ${to} on ${stamp.slice(0, 10)}: result unknown (no answer from Resend). Check your Resend log before sending again.`.slice(-2000);
        await sb.from("prospects").update({ notes }).eq("id", b.id as string);
        return fail("No answer from the email service: it may or may not have been sent. Check your Resend log; it stays marked Contacted.", 504);
      }
      if (r.status >= 500 || r.status === 429) { // server trouble: it may have gone out, same as no answer
        await sb.from("prospects").update({ notes: `${p.notes ? `${p.notes}\n` : ""}Email to ${to} on ${stamp.slice(0, 10)}: result unknown (Resend ${r.status}). Check your Resend log.`.slice(-2000) }).eq("id", b.id as string);
        return fail(`The email service had a problem (${r.status}): it may or may not have been sent. Check your Resend log; it stays marked Contacted.`, 502);
      }
      if (!r.ok) { // a clear refusal (4xx): nothing was sent, so it goes back to "To contact"
        const { data: back } = await sb.from("prospects").update({ stage: "lead" }).eq("id", b.id as string).eq("stage", "contacted").select("id");
        if (back?.length) await emit(sb, user.id, "business.stage", "business", { prospect: b.id, to: "lead" });
        return fail(`Not sent: Resend ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`, 502);
      }
      const notes = `${p.notes ? `${p.notes}\n` : ""}Emailed ${to} on ${stamp.slice(0, 10)} (approved in ORBIT).`.slice(-2000);
      return one(sb.from("prospects").update({ notes }).eq("id", b.id as string).select(COLS).maybeSingle());
    }
    default: return fail("action must be find, research, send, add, update, draft, followup or delete");
  }
}
