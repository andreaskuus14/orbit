import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { stopAllOn } from "@/lib/stop-all";
import { peopleOf, pickMatch, registryState, runRefresh, running } from "@/lib/registry";
import { ATTRIBUTION, LICENCE_URL } from "@/lib/registry-pure";

export const dynamic = "force-dynamic";

// BUSINESS → e-Business Register enrichment (registry.ts). GET → run state for the progress card | GET ?people=<prospect id> → that
// lead's board members, for his lead card only (personal data: this is the only route that returns them, and nothing here calls a model).
// POST {action:"refresh"} → his click: download the free open data and match every lead (also turns the weekly refresh on)
// | {action:"pick", id, code} → his pick among close options | {action:"weekly", on}. Nothing is sent anywhere.
const fail = (error: string, status = 400) => Response.json({ error }, { status });
const ID = /^[0-9a-f-]{36}$/i;

export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const id = new URL(req.url).searchParams.get("people");
  if (id !== null) {
    if (!ID.test(id)) return fail("id required");
    return Response.json({ people: await peopleOf(id).catch(() => []) }, { headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ state: await registryState(), running: running(), attribution: ATTRIBUTION, licence: LICENCE_URL });
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/business/registry", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { sb, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return fail("JSON body required");
  if (b.action === "refresh") {
    if (stopAllOn()) return fail("Stop-all is on", 503);
    // His own pipeline only (RLS): loaded when the match step starts, so leads added meanwhile are included.
    void runRefresh(async () => ((await sb.from("prospects").select("id,name,notes").limit(1000)).data ?? []));
    return Response.json({ started: true });
  }
  if (b.action === "pick") {
    if (typeof b.id !== "string" || !ID.test(b.id) || typeof b.code !== "string" || !/^\d{8}$/.test(b.code)) return fail("id and an 8-digit registry code required");
    const { data } = await sb.from("prospects").select("id").eq("id", b.id).maybeSingle();
    if (!data) return fail("Not found", 404);
    const m = await pickMatch(b.id, b.code);
    return typeof m === "string" ? fail(m) : Response.json({ registry: m });
  }
  if (b.action === "weekly") {
    const { updateRegistryState } = await import("@/lib/registry");
    return Response.json({ state: await updateRegistryState({ on: b.on === true }) });
  }
  return fail("action must be refresh, pick or weekly");
}
