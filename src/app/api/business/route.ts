import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { BusyError, askClaude, emit } from "@/lib/claude";
import { usageHold } from "@/lib/usage-meter";
import { stopAllOn } from "@/lib/stop-all";
import { sendDraft } from "@/lib/business-send";
import { pushNotify } from "@/lib/remote-push";
import { FOLLOWUP_SYSTEM, followupPrompt, FIND_SYSTEM, LANGS, OUTREACH_SYSTEM, RESEARCH_SYSTEM, findPrompt, funnel, isTemplate, outreachPrompt, parseDraft, parseFinds, researchPrompt, trimDossier, validatePatch, validateProspect, withDossier, type Lang, type Prospect } from "@/lib/business-pure";

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
        // Research takes up to 3 min: build on the notes as they are NOW, so an edit made meanwhile isn't overwritten.
        const { data: fresh } = await sb.from("prospects").select("notes").eq("id", b.id as string).maybeSingle();
        const notes = withDossier(fresh?.notes ?? p.notes ?? "", dossier);
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
        if (!followup && p.stage === "lead") pushNotify("send"); // phone push (6.3): a label only, never the draft
        // Tag only drafts that haven't gone out yet, so a sent message keeps the angle it was sent with.
        if (!template || p.stage !== "lead") return one(save(patch));
        const tagged = await save({ ...patch, template });
        return one(Promise.resolve(tagged.error?.code === "42703" ? save(patch) : tagged)); // no column before 0015: save untagged
      } catch (e) {
        if (e instanceof BusyError) return fail("CORE is busy; try again in a moment", 429);
        return fail(`Couldn't draft: ${e instanceof Error ? e.message : "unknown error"}`, 502);
      }
    }
    case "send": return sendDraft(sb, user.id, b.id as string, b.seen);
    default: return fail("action must be find, research, send, add, update, draft, followup or delete");
  }
}
