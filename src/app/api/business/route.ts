import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { BusyError, askClaude } from "@/lib/claude";
import { usageHold } from "@/lib/usage-meter";
import { stopAllOn } from "@/lib/stop-all";
import { LANGS, OUTREACH_SYSTEM, funnel, outreachPrompt, validatePatch, validateProspect, type Lang, type Prospect } from "@/lib/business-pure";

export const dynamic = "force-dynamic";

// BUSINESS planet: client pipeline (Supabase public.prospects, RLS: own rows). Logic: src/lib/business-pure.ts.
// POST {action:"add", name, kind?, contact?, notes?} | {action:"update", id, ...fields} | {action:"draft", id, lang} | {action:"delete", id}.
// "draft" asks CORE (Claude Code on the owner's plan) for an outreach message; ORBIT never sends it.
const COLS = "id,name,kind,contact,stage,fee,notes,draft,created_at,updated_at";
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET() {
  const { sb, res } = await requireUser();
  if (res) return res;
  const { data, error } = await sb.from("prospects").select(COLS).order("updated_at", { ascending: false }).limit(300);
  if (error) return fail(error.code === "42P01" ? "Run supabase/migrations/0011_business.sql first" : error.message, 500);
  const prospects = (data ?? []).map((p) => ({ ...p, fee: Number(p.fee) })) as Prospect[];
  return Response.json({ prospects, funnel: funnel(prospects) });
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/business", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { sb, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return fail("JSON body required");
  if (b.action !== "add" && (typeof b.id !== "string" || !/^[0-9a-f-]{36}$/i.test(b.id))) return fail("id required");
  const one = (q: PromiseLike<{ data: unknown; error: { message: string } | null }>) =>
    Promise.resolve(q).then(({ data, error }) => (error ? fail(error.message, 500) : data ? Response.json(data) : fail("Not found", 404)));

  switch (b.action) {
    case "add": {
      const p = validateProspect(b);
      if (typeof p === "string") return fail(p);
      return one(sb.from("prospects").insert(p).select(COLS).single());
    }
    case "update": {
      const p = validatePatch(b);
      if (typeof p === "string") return fail(p);
      return one(sb.from("prospects").update({ ...p, updated_at: new Date().toISOString() }).eq("id", b.id as string).select(COLS).maybeSingle());
    }
    case "delete": {
      const { error } = await sb.from("prospects").delete().eq("id", b.id as string);
      return error ? fail(error.message, 500) : Response.json({ ok: true });
    }
    case "draft": {
      const lang = (LANGS as readonly string[]).includes(b.lang as string) ? (b.lang as Lang) : "English";
      const held = stopAllOn() ? "Stop-all is on" : usageHold();
      if (held) return fail(`Not drafting right now: ${held}`, 503);
      const { data: p, error } = await sb.from("prospects").select("name,kind,notes").eq("id", b.id as string).maybeSingle();
      if (error) return fail(error.message, 500);
      if (!p) return fail("Not found", 404);
      try {
        const r = await askClaude(outreachPrompt(p, lang), OUTREACH_SYSTEM, { lane: "foreground", purpose: "business.outreach", timeoutMs: 90_000 });
        const draft = r.text.trim().slice(0, 4000);
        if (!draft) return fail("CORE returned an empty draft; try again", 502);
        return one(sb.from("prospects").update({ draft, updated_at: new Date().toISOString() }).eq("id", b.id as string).select(COLS).maybeSingle());
      } catch (e) {
        if (e instanceof BusyError) return fail("CORE is busy; try again in a moment", 429);
        return fail(`Couldn't draft: ${e instanceof Error ? e.message : "unknown error"}`, 502);
      }
    }
    default: return fail("action must be add, update, draft or delete");
  }
}
