import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { addMistake, deleteMistake, listMistakes, setMistakeStatus, editMistakeFix } from "@/lib/mistake-memory";

export const dynamic = "force-dynamic";

function csrfBlock(req: Request, method: string) {
  const h = req.headers;
  return crossSiteBlocked(method, "/api/mistakes", {
    secFetchSite: h.get("sec-fetch-site"),
    origin: h.get("origin"),
    host: h.get("host"),
    forwardedHost: h.get("x-forwarded-host"),
  });
}

export async function GET() {
  const { user, res } = await requireUser();
  if (res) return res;
  const items = await listMistakes(user.id);
  return Response.json({ items });
}

export async function POST(req: Request) {
  if (csrfBlock(req, "POST")) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { user, res } = await requireUser();
  if (res) return res;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return Response.json({ error: "Invalid body" }, { status: 400 });
  const out = await addMistake(user.id, {
    area: typeof body.area === "string" ? body.area : undefined,
    trigger: String(body.trigger ?? ""),
    mistake: String(body.mistake ?? ""),
    fix: String(body.fix ?? ""),
    tool: typeof body.tool === "string" ? body.tool : undefined,
    tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : undefined,
  });
  if (!out.saved) return Response.json({ error: out.reason ?? "Refused" }, { status: 400 });
  return Response.json({ item: out.saved }, { status: 201 });
}

export async function PATCH(req: Request) {
  if (csrfBlock(req, "PATCH")) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { user, res } = await requireUser();
  if (res) return res;
  const body = (await req.json().catch(() => null)) as { id?: unknown; status?: unknown; fix?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (id && typeof body?.fix === "string") { // edit the fix text ("What ORBIT knows about you")
    const ok = await editMistakeFix(user.id, id, body.fix);
    return ok ? Response.json({ ok: true }) : Response.json({ error: "Not found or empty" }, { status: 404 });
  }
  const status = body?.status === "active" || body?.status === "archived" ? body.status : null;
  if (!id || !status) return Response.json({ error: "id and status (active|archived) required" }, { status: 400 });
  const ok = await setMistakeStatus(user.id, id, status);
  if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (csrfBlock(req, "DELETE")) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { user, res } = await requireUser();
  if (res) return res;
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  const ok = await deleteMistake(user.id, id);
  if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}
