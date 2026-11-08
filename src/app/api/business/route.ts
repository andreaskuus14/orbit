import { requireUser } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crossSiteBlocked } from "@/lib/csrf";
import { BusyError, askClaude, emit } from "@/lib/claude";
import { pastBudget, usageHardHold } from "@/lib/usage-meter";
import { stopAllOn } from "@/lib/stop-all";
import { sendDraft } from "@/lib/business-send";
import { pushNotify } from "@/lib/remote-push";
import { crmOf, loadCrm, logEvent, updateCrm } from "@/lib/prospect-crm";
import { claimProblem, deliveryPlan, duplicateOf, EVENT_KINDS, LOST_REASONS, newCrm, touch, type EventKind, type LostReason } from "@/lib/prospect-crm-pure";
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
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const { data, error } = await sb.from("prospects").select(COLS).order("updated_at", { ascending: false }).limit(300);
  if (error) return fail(error.code === "42P01" ? "Run supabase/migrations/0011_business.sql first" : error.message, 500);
  const store = await loadCrm().catch(() => ({}));
  const prospects = (data ?? []).map((p) => { const crm = crmOf(store, p); return { ...p, fee: Number(p.fee), crm, touch: touch(crm.events) }; }) as Prospect[];
  const night = await import("@/lib/night").then((n) => n.getNightReport(sb, user.id)).catch(() => null); // a failure just hides the shortcut
  const { nightFollowupDraft } = await import("@/lib/night-pure");
  const nightDrafts = prospects.filter((p) => p.stage === "contacted" && nightFollowupDraft(night, p.id, p.draft ?? "")).map((p) => p.id); // ids only; the text stays server-side until used
  return Response.json({ prospects, funnel: funnel(prospects), nightDrafts, canSend: !!(process.env.RESEND_API_KEY && process.env.ORBIT_MAIL_FROM) });
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
    const held = stopAllOn() ? "Stop-all is on" : usageHardHold();
    if (held) return fail(`Not searching right now: ${held}`, 503);
    try {
      const r = await askClaude(findPrompt(query), FIND_SYSTEM, { lane: "foreground", purpose: "business.find", timeoutMs: 180_000, web: true, signal: req.signal });
      const finds = parseFinds(r.text);
      return finds.length ? Response.json({ finds, pastBudget: pastBudget() }) : fail("CORE found nothing usable; try other words", 502);
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
      const { data: all } = await sb.from("prospects").select("id,name,contact").limit(1000);
      const store = await loadCrm();
      const dup = duplicateOf(all ?? [], store, p.name, p.contact);
      if (dup) return Response.json({ error: "Already in your pipeline (same name, website, email or phone)", duplicate: dup }, { status: 409 });
      const r = await sb.from("prospects").insert(p).select(COLS).single();
      if (r.data) {
        await updateCrm((s) => { s[r.data.id] = newCrm(b.source === "web-find" ? "web-find" : "manual", p.name, p.contact); });
        await emit(sb, user.id, "business.stage", "business", { prospect: r.data.id, to: r.data.stage }); // a new prospect enters the pipeline
      }
      return one(Promise.resolve(r));
    }
    case "update": {
      const p = validatePatch(b);
      if (typeof p === "string") return fail(p);
      const before = p.stage ? (await sb.from("prospects").select("stage").eq("id", b.id as string).maybeSingle()).data : null;
      const r = await sb.from("prospects").update({ ...p, updated_at: new Date().toISOString() }).eq("id", b.id as string).select(COLS).maybeSingle();
      if (!r.error && r.data && p.stage && before?.stage !== p.stage) {
        await emit(sb, user.id, "business.stage", "business", { prospect: b.id, to: p.stage }); // the id, never the name
        await logEvent(r.data, "stage", p.stage);
        if (p.stage === "paying") await linkDelivery(sb, user.id, r.data);
      }
      if (!r.error && r.data && p.contact !== undefined) await updateCrm((s) => { const c = crmOf(s, r.data); s[r.data.id] = { ...c, key: newCrm(c.source, r.data.name, r.data.contact).key, verified: c.source === "manual", verifiedAt: undefined }; }); // a new contact must be checked again
      return one(Promise.resolve(r));
    }
    case "delete": {
      const { error } = await sb.from("prospects").delete().eq("id", b.id as string);
      if (!error) await updateCrm((s) => { delete s[b.id as string]; }).catch(() => {});
      return error ? fail(error.message, 500) : Response.json({ ok: true });
    }
    case "research": {
      const held = stopAllOn() ? "Stop-all is on" : usageHardHold();
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
      const fromNight = followup && b.use === "night"; // last night's draft: no model call, so no usage hold
      const held = stopAllOn() ? "Stop-all is on" : fromNight ? null : usageHardHold();
      if (held) return fail(`Not drafting right now: ${held}`, 503);
      const { data: p, error } = await sb.from("prospects").select("name,kind,notes,draft,stage,updated_at").eq("id", b.id as string).maybeSingle();
      if (error) return fail(error.message, 500);
      if (!p) return fail("Not found", 404);
      if (followup && (p.stage !== "contacted" || !p.draft?.trim())) return fail("A contacted business with a first draft is required");
      if (fromNight) { // the text comes from the night report on this server, never from the request
        const { nightFollowupDraft } = await import("@/lib/night-pure");
        const draft = nightFollowupDraft(await import("@/lib/night").then((n) => n.getNightReport(sb, user.id)).catch(() => null), b.id as string, p.draft);
        if (!draft) return fail("There's no new draft from last night for this client", 404);
        void logEvent({ id: b.id as string, name: p.name, contact: "" }, "draft", "follow-up");
        return one(sb.from("prospects").update({ draft, updated_at: new Date().toISOString() }).eq("id", b.id as string).select(COLS).maybeSingle());
      }
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
        void logEvent({ id: b.id as string, name: p.name, contact: "" }, "draft", followup ? "follow-up" : template ?? undefined);
        if (!template || p.stage !== "lead") return one(save(patch));
        const tagged = await save({ ...patch, template });
        return one(Promise.resolve(tagged.error?.code === "42703" ? save(patch) : tagged)); // no column before 0015: save untagged
      } catch (e) {
        if (e instanceof BusyError) return fail("CORE is busy; try again in a moment", 429);
        return fail(`Couldn't draft: ${e instanceof Error ? e.message : "unknown error"}`, 502);
      }
    }
    case "send": return sendDraft(sb, user.id, b.id as string, b.seen);
    case "verify": {
      const { data: p } = await sb.from("prospects").select("id,name,contact,notes").eq("id", b.id as string).maybeSingle();
      if (!p) return fail("Not found", 404);
      await updateCrm((s) => { s[p.id] = { ...crmOf(s, p), verified: true, verifiedAt: new Date().toISOString() }; });
      return Response.json({ ok: true });
    }
    case "log": { // the owner records what really happened: a follow-up he sent himself, their reply, a call, a note
      const kind = b.kind as EventKind;
      if (!EVENT_KINDS.includes(kind) || kind === "draft" || kind === "stage") return fail("kind must be sent, reply, call or note");
      const at = typeof b.at === "string" && !Number.isNaN(Date.parse(b.at)) && Date.parse(b.at) <= Date.now() ? new Date(b.at).toISOString() : new Date().toISOString();
      const { data: p } = await sb.from("prospects").select("id,name,contact,notes").eq("id", b.id as string).maybeSingle();
      if (!p) return fail("Not found", 404);
      await updateCrm((s) => { const c = crmOf(s, p); s[p.id] = { ...c, events: [...c.events, { at, kind, ...(typeof b.text === "string" && b.text.trim() && { text: b.text.trim().slice(0, 300) }) }].sort((x, y) => Date.parse(x.at) - Date.parse(y.at)).slice(-200) }; });
      return Response.json({ ok: true });
    }
    case "lost": { // BUS08: his reason a business said no (or went quiet); null clears it
      if (b.reason !== null && !LOST_REASONS.includes(b.reason as LostReason)) return fail(`reason must be one of ${LOST_REASONS.join(", ")}`);
      const { data: p } = await sb.from("prospects").select("id,name,contact,notes").eq("id", b.id as string).maybeSingle();
      if (!p) return fail("Not found", 404);
      await updateCrm((s) => { const c = crmOf(s, p); s[p.id] = { ...c, lost: b.reason ? { reason: b.reason as LostReason, at: new Date().toISOString() } : undefined }; });
      return Response.json({ ok: true });
    }
    default: return fail("action must be find, research, send, verify, log, lost, add, update, draft, followup or delete");
  }
}

/** BUS05: a client that starts paying gets an OPERATIONS project with a delivery plan, once (the id is kept in prospect-crm.json). */
async function linkDelivery(sb: SupabaseClient, userId: string, p: Prospect) {
  const has = crmOf(await loadCrm(), p).opsProject;
  if (has) return;
  const { agreedFor, agreedLine } = await import("@/lib/contracts-pure");
  const agreed = agreedFor(await (await import("@/lib/contracts")).listContracts().catch(() => []), p.id);
  const { data } = await sb.from("projects").insert({ user_id: userId, ...deliveryPlan(p, agreed ? agreedLine(agreed) : undefined) }).select("id").single();
  if (data?.id) await updateCrm((s) => { s[p.id] = { ...crmOf(s, p), opsProject: data.id }; });
}
