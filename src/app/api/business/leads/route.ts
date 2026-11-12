import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { BusyError, askClaude, emit } from "@/lib/claude";
import { usageHardHold } from "@/lib/usage-meter";
import { stopAllOn } from "@/lib/stop-all";
import { fetchPage, safeFetch } from "@/lib/memory";
import { siteLint } from "@/lib/core-workspace";
import { siteFromIdea } from "@/lib/site-idea";
import { crmOf, loadCrm, logEvent, updateCrm } from "@/lib/prospect-crm";
import { duplicateOf, newCrm } from "@/lib/prospect-crm-pure";
import { validateProspect } from "@/lib/business-pure";
import { FIE_WARNING, LEAD_SOURCE, MAPS_MAX, mapsDupe, MAPS_SOURCE, mapsNotes, parseMapsCsv, PITCH_SYSTEM, SEARCH_SYSTEM, combineTries, demoIdea, domainGuesses, domainUrls, fetchErrorState, finishPitch, honestyIssues, isNaturalPerson, nextStep, pageNames, parseCandidates, parseSearch, pitchProblems, pitchPrompt, scoreNoWebsite, searchPrompt, toCandidate, type Candidate, type Dns, type DnsState, type LeadLoop, type Search, type PitchLang } from "@/lib/lead-loop-pure";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// B2 lead loop (rules: lead-loop-pure.ts). POST {action:"parse", text} → candidates (nothing saved) | {action:"check", candidate}
// → web search + {name}.ee/.com through safeFetch; a pass becomes a BUSINESS prospect (source lead-loop, unverified) | {action:"demo", id}
// → a demo site workspace | {action:"import", text} (B8) → his gosom CSV saved as draft prospects (source maps-import) | {action:"pitch", id, lang} → the prospect's draft. Nothing is sent here: the draft goes out only by his
// "Approve & send" click (business-send.ts), it is saved without drafted_at and Auto skips lead-loop leads (autonomy.ts).
const IMPORT_BYTES = 20_000_000;
const fail = (error: string, status = 400) => Response.json({ error }, { status });

async function dnsOf(c: Candidate): Promise<Dns[]> {
  return Promise.all(domainGuesses(c.name).slice(0, 4).map(async (domain): Promise<Dns> => {
    const tries = await Promise.all(domainUrls(domain).map(async (u): Promise<DnsState> => {
      try { const pg = await fetchPage(u); return pageNames(c.name, pg.text, pg.title) ? "own" : "other"; } // a parked page naming them counts as own: errs toward "has a site"
      catch (e) { const err = e as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException }; return fetchErrorState(err.code ?? err.cause?.code, String(err.message)); }
    }));
    return { domain, state: combineTries(tries) };
  }));
}

/** Only search links that really answer (GET through safeFetch, 64 KB cap: safeFetch has no HEAD) stay as evidence. */
async function realLinks(s: Search | null): Promise<Search | null> {
  if (!s) return s;
  const ok = await Promise.all(s.links.map((u) => safeFetch(u, "text/html,*/*", undefined, 65_536, 8_000).then(() => true, () => false)));
  return { ...s, links: s.links.filter((_, i) => ok[i]) };
}

const setLead = (p: { id: string; name: string; contact: string; notes?: string }, patch: Partial<LeadLoop>) =>
  updateCrm((s) => { const c = crmOf(s, p); s[p.id] = { ...c, lead: { ...(c.lead ?? { stage: "checked", confidence: 0, evidence: [] }), ...patch } }; });

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/business/leads", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { sb, user, res } = await requireUser();
  if (res) return res;
  if (Number(h.get("content-length") ?? 0) > IMPORT_BYTES) return fail("Too big: import at most about 20 MB", 413); // before reading the body
  const raw = await req.text().catch(() => "");
  if (raw.length > IMPORT_BYTES) return fail("Too big: import at most about 20 MB", 413);
  const b = (() => { try { return JSON.parse(raw) as unknown; } catch { return null; } })() as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return fail("JSON body required");
  if (b.action === "parse") {
    const candidates = parseCandidates(typeof b.text === "string" ? b.text.slice(0, 100_000) : "");
    return candidates.length ? Response.json({ candidates }) : fail("No candidates: one per line, name, city, category, optional Maps URL");
  }
  if (b.action === "import") { // B8: his own gosom CSV → draft prospects (source maps-import). Saves only; nothing is sent or contacted.
    const parsed = parseMapsCsv(typeof b.text === "string" ? b.text : "");
    if (!parsed) return fail("Not a google-maps-scraper CSV: it needs the title and link columns");
    const { data: all, error: e1 } = await sb.from("prospects").select("id,name,contact,notes").limit(5000);
    if (e1) return fail(e1.message, 500);
    const store = await loadCrm(), known = [...(all ?? [])], rows = [];
    let dupes = 0;
    for (const l of parsed.leads) {
      if (mapsDupe(known, l)) { dupes++; continue; }
      const p = validateProspect({ name: l.name, kind: l.category, contact: "", notes: mapsNotes(l) });
      if (typeof p === "string") continue;
      rows.push({ ...p, source: MAPS_SOURCE }); known.push({ id: "", name: p.name, contact: "", notes: p.notes });
    }
    if (!rows.length) return Response.json({ saved: 0, dupes, over: parsed.over });
    const { data, error } = await sb.from("prospects").insert(rows).select("id,name");
    if (error?.code === "42703" || error?.code === "PGRST204") return fail("Run supabase/migrations/0027_prospect_source.sql first", 500); // never save a lead Auto can't recognise
    if (error || !data) return fail(error?.message ?? "Couldn't save the leads", 500);
    try { await updateCrm((s) => { for (const d of data) s[d.id] = newCrm(MAPS_SOURCE, d.name, ""); }); }
    catch (e) { // without a CRM record legacy() would read them as verified manual rows: undo the insert
      await sb.from("prospects").delete().in("id", data.map((d) => d.id));
      return fail(`Couldn't save the leads: ${e instanceof Error ? e.message : "CRM store error"}`, 500);
    }
    return Response.json({ saved: data.length, dupes, over: parsed.over, max: MAPS_MAX });
  }
  const held = stopAllOn() ? "Stop-all is on" : usageHardHold();
  if (held) return fail(`Not running the lead loop: ${held}`, 503);
  try {
    if (b.action === "check") {
      const c = toCandidate(b.candidate);
      if (!c) return fail("candidate needs a name");
      const { data: all } = await sb.from("prospects").select("id,name,contact,notes,source").limit(1000);
      const store = await loadCrm(), dup = duplicateOf(all ?? [], store, c.name, "");
      if (dup) { // a re-run continues a lead-loop lead's unfinished demo/pitch instead of stopping
        const row = all!.find((x) => x.id === dup)!, lead = crmOf(store, row).lead;
        if (row.source !== LEAD_SOURCE || !lead || nextStep(lead) === "done") return fail("Already in your pipeline", 409);
        return Response.json({ resume: nextStep(lead), prospect: { id: dup }, verdict: { pass: true, confidence: lead.confidence, reasons: ["Resumed"], evidence: lead.evidence } });
      }
      const [search, dns] = await Promise.all([
        askClaude(searchPrompt(c), SEARCH_SYSTEM, { lane: "foreground", purpose: "business.lead-check", timeoutMs: 180_000, web: true, signal: req.signal }).then((r) => realLinks(parseSearch(r.text))),
        dnsOf(c),
      ]);
      const verdict = scoreNoWebsite(search, dns);
      if (!verdict.pass) return Response.json({ verdict });
      const person = isNaturalPerson(c.name);
      const notes = [`Lead loop: no website found (confidence ${verdict.confidence}%).`, person && `Warning: ${FIE_WARNING}`, c.city && `City: ${c.city}`, c.maps && `Maps: ${c.maps}`, "Evidence:", ...verdict.evidence.map((e) => `- ${e}`)].filter(Boolean).join("\n");
      const p = validateProspect({ name: c.name, kind: c.category, contact: "", notes });
      if (typeof p === "string") return fail(p);
      const { data, error } = await sb.from("prospects").insert({ ...p, source: LEAD_SOURCE }).select("*").single();
      if (error?.code === "42703" || error?.code === "PGRST204") return fail("Run supabase/migrations/0027_prospect_source.sql first", 500); // never save a lead Auto can't recognise
      if (error || !data) return fail(error?.message ?? "Couldn't save the lead", 500);
      await updateCrm((s) => { s[data.id] = { ...newCrm("lead-loop", p.name, ""), lead: { stage: "checked", confidence: verdict.confidence, evidence: verdict.evidence, ...(person && { person }) } }; });
      await emit(sb, user.id, "business.stage", "business", { prospect: data.id, to: data.stage });
      return Response.json({ verdict, prospect: data, ...(person && { warning: FIE_WARNING }) });
    }
    if (typeof b.id !== "string" || !/^[0-9a-f-]{36}$/i.test(b.id)) return fail("id required");
    const { data: p } = await sb.from("prospects").select("id,name,kind,contact,notes,stage").eq("id", b.id).maybeSingle();
    if (!p) return fail("Not found", 404);
    const lead = crmOf(await loadCrm(), p).lead;
    if (!lead) return fail("Not a lead-loop lead");
    const city = /^City: (.+)$/m.exec(p.notes ?? "")?.[1] ?? "", c: Candidate = { name: p.name, city, category: p.kind ?? "" };
    if (b.action === "demo") {
      const site = await siteFromIdea(user.id, demoIdea(c), b.lang === "Estonian" ? "et" : "en", req.signal, true);
      if ("error" in site) return fail(`Couldn't build the demo: ${site.error}`, 502);
      const issues = honestyIssues((await siteLint(user.id, site.slug)).issues);
      await setLead(p, { stage: "demo", demo: { slug: site.slug, preview: site.preview, assumed: site.assumed, issues } });
      if (issues.length) return fail(`The demo has invented proof or numbers; fix it before pitching: ${issues.slice(0, 3).join("; ")}`, 502);
      return Response.json({ demo: site });
    }
    if (b.action === "pitch") {
      if (p.stage !== "lead") return fail("Only a lead still To contact gets a first pitch");
      if (!lead.demo || lead.demo.issues?.length) return fail("Build a clean demo first");
      const lang: PitchLang = b.lang === "Estonian" ? "Estonian" : "English";
      let body = "", problems: string[] = [];
      for (let i = 0; i < 2; i++) { // one repair round with the lint's own words
        const ask = pitchPrompt(c, lang) + (problems.length ? `\nYour last draft broke these rules, fix them:\n- ${problems.join("\n- ")}\nLast draft: ${body}` : "");
        body = (await askClaude(ask, PITCH_SYSTEM, { lane: "foreground", purpose: "business.lead-pitch", timeoutMs: 90_000, signal: req.signal })).text.trim();
        problems = pitchProblems(body, p.name);
        if (!problems.length) break;
      }
      if (problems.length) return fail(`The pitch broke the cold-email rules (${problems.join("; ")}); try again`, 502);
      // drafted_at cleared: Auto never sends a draft without it (autonomy.ts fireSend); his "Approve & send" is the only way out.
      const { data, error } = await sb.from("prospects").update({ draft: finishPitch(body, lang), drafted_at: null, updated_at: new Date().toISOString() }).eq("id", p.id).select("*").maybeSingle();
      if (error || !data) return fail(error?.message ?? "Not found", error ? 500 : 404);
      await setLead(p, { stage: "pitched" });
      void logEvent(p, "draft", "lead-loop pitch");
      return Response.json({ prospect: data });
    }
    return fail("action must be parse, check, demo or pitch");
  } catch (e) {
    if (e instanceof BusyError) return fail("CORE is busy; try again in a moment", 429);
    return fail(`Lead loop failed: ${e instanceof Error ? e.message : "unknown error"}`, 502);
  }
}
