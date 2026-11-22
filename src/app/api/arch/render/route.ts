import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { renderJobs, startRender } from "@/lib/arch-render";
import { projectScope } from "@/lib/project-access";

export const dynamic = "force-dynamic";

// ARCH → Render in Blender: POST ?project= {quality: "preview"|"detail", lat?, lon?, at?} → {job}; GET → {jobs} for the card.
// Renders the SAVED model on this PC with Blender (free); the picture goes to VAULT. Nothing is uploaded anywhere.
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json({ jobs: renderJobs() });
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/arch/render", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") })) return fail("Cross-site request refused", 403);
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const project = await projectScope(req, sb, user.id); // same scope and access check as /api/arch/scene
  if (project instanceof Response) return project;
  const b = (await req.json().catch(() => null)) as { quality?: unknown; lat?: unknown; lon?: unknown; at?: unknown } | null;
  if (!b) return fail("Send JSON.");
  const quality = b.quality === "detail" ? "detail" : "preview";
  try { return Response.json({ job: await startRender({ userId: user.id, project, quality, lat: b.lat, lon: b.lon, at: b.at }) }); }
  catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
}
