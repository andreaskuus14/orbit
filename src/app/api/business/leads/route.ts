import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { BusyError, askClaude, emit } from "@/lib/claude";
import { usageHardHold } from "@/lib/usage-meter";
import { stopAllOn } from "@/lib/stop-all";
import { fetchPage } from "@/lib/memory";
import { siteFromIdea } from "@/lib/site-idea";
import { crmOf, loadCrm, logEvent, updateCrm } from "@/lib/prospect-crm";
import { duplicateOf, newCrm } from "@/lib/prospect-crm-pure";
import { validateProspect } from "@/lib/business-pure";
import { PITCH_SYSTEM, SEARCH_SYSTEM, demoIdea, domainGuesses, finishPitch, pageNames, parseCandidates, parseSearch, pitchProblems, pitchPrompt, scoreNoWebsite, searchPrompt, toCandidate, type Candidate, type Dns, type DnsState, type LeadLoop, type PitchLang } from "@/lib/lead-loop-pure";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// B2 lead loop (rules: lead-loop-pure.ts). POST {action:"parse", text} → candidates (nothing saved) | {action:"check", candidate}
// → web search + {name}.ee/.com through safeFetch; a pass becomes a BUSINESS prospect (source lead-loop, unverified) | {action:"demo", id}
// → a demo site workspace | {action:"pitch", id, lang} → the prospect's draft. Nothing is sent here: the draft goes out only by his
// "Approve & send" click (business-send.ts), it is saved without drafted_at and Auto skips lead-loop leads (autonomy.ts).
const fail = (error: string, status = 400) => Response.json({ error }, { status });

async function dnsOf(c: Candidate): Promise<Dns[]> {
  return Promise.all(domainGuesses(c.name).slice(0, 4).map(async (domain): Promise<Dns> => {
    let state: DnsState;
    try { state = pageNames(c.name, (await fetchPage(`https://${domain}`)).text) ? "own" : "other"; } // a parked page naming them counts as own: errs toward "has a site"
    catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      state = code === "ENOTFOUND" ? "none" : code === "EAI_AGAIN" || /private|internal|not allowed/i.test(String((e as Error).message)) ? "error" : "dead";
    }
    return { domain, state };
  }));
}

const setLead = (p: { id: string; name: string; contact: string; notes?: string }, patch: Partial<LeadLoop>) =>
  updateCrm((s) => { const c = crmOf(s, p); s[p.id] = { ...c, lead: { ...(c.lead ?? { stage: "checked", confidence: 0, evidence: [] }), ...patch } }; });

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/business/leads", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return fail("JSON body required");
  if (b.action === "parse") {
    const candidates = parseCandidates(typeof b.text === "string" ? b.text.slice(0, 100_000) : "");
    return candidates.length ? Response.json({ candidates }) : fail("No candidates: one per line, name, city, category, optional Maps URL");
  }
  const held = stopAllOn() ? "Stop-all is on" : usageHardHold();
  if (held) return fail(`Not running the lead loop: ${held}`, 503);
  try {
    if (b.action === "check") {
      const c = toCandidate(b.candidate);
      if (!c) return fail("candidate needs a name");
      const { data: all } = await sb.from("prospects").select("id,name,contact").limit(1000);
      if (duplicateOf(all ?? [], await loadCrm(), c.name, "")) return fail("Already in your pipeline", 409);
      const [search, dns] = await Promise.all([
        askClaude(searchPrompt(c), SEARCH_SYSTEM, { lane: "foreground", purpose: "business.lead-check", timeoutMs: 180_000, web: true, signal: req.signal }).then((r) => parseSearch(r.text)),
        dnsOf(c),
      ]);
      const verdict = scoreNoWebsite(search, dns);
      if (!verdict.pass) return Response.json({ verdict });
      const notes = [`Lead loop: no website found (confidence ${verdict.confidence}%).`, c.city && `City: ${c.city}`, c.maps && `Maps: ${c.maps}`, "Evidence:", ...verdict.evidence.map((e) => `- ${e}`)].filter(Boolean).join("\n");
      const p = validateProspect({ name: c.name, kind: c.category, contact: "", notes });
      if (typeof p === "string") return fail(p);
      const { data, error } = await sb.from("prospects").insert(p).select("*").single();
      if (error || !data) return fail(error?.message ?? "Couldn't save the lead", 500);
      await updateCrm((s) => { s[data.id] = { ...newCrm("lead-loop", p.name, ""), lead: { stage: "checked", confidence: verdict.confidence, evidence: verdict.evidence } }; });
      await emit(sb, user.id, "business.stage", "business", { prospect: data.id, to: data.stage });
      return Response.json({ verdict, prospect: data });
    }
    if (typeof b.id !== "string" || !/^[0-9a-f-]{36}$/i.test(b.id)) return fail("id required");
    const { data: p } = await sb.from("prospects").select("id,name,kind,contact,notes,stage").eq("id", b.id).maybeSingle();
    if (!p) return fail("Not found", 404);
    const lead = crmOf(await loadCrm(), p).lead;
    if (!lead) return fail("Not a lead-loop lead");
    const city = /^City: (.+)$/m.exec(p.notes ?? "")?.[1] ?? "", c: Candidate = { name: p.name, city, category: p.kind ?? "" };
    if (b.action === "demo") {
      const site = await siteFromIdea(user.id, demoIdea(c), b.lang === "Estonian" ? "et" : "en", req.signal);
      if ("error" in site) return fail(`Couldn't build the demo: ${site.error}`, 502);
      await setLead(p, { stage: "demo", demo: { slug: site.slug, preview: site.preview } });
      return Response.json({ demo: site });
    }
    if (b.action === "pitch") {
      if (p.stage !== "lead") return fail("Only a lead still To contact gets a first pitch");
      if (!lead.demo) return fail("Build the demo first");
      const lang: PitchLang = b.lang === "Estonian" ? "Estonian" : "English";
      let body = "", problems: string[] = [];
      for (let i = 0; i < 2; i++) { // one repair round with the lint's own words
        const ask = pitchPrompt(c, lang) + (problems.length ? `\nYour last draft broke these rules, fix them:\n- ${problems.join("\n- ")}\nLast draft: ${body}` : "");
        body = (await askClaude(ask, PITCH_SYSTEM, { lane: "foreground", purpose: "business.lead-pitch", timeoutMs: 90_000, signal: req.signal })).text.trim();
        problems = pitchProblems(body);
        if (!problems.length) break;
      }
      if (problems.length) return fail(`The pitch broke the cold-email rules (${problems.join("; ")}); try again`, 502);
      // No drafted_at: Auto never sends a draft without it (autonomy.ts fireSend); his "Approve & send" is the only way out.
      const { data, error } = await sb.from("prospects").update({ draft: finishPitch(body, lang), updated_at: new Date().toISOString() }).eq("id", p.id).select("*").maybeSingle();
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
