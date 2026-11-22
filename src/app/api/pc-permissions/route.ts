import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { stopAllOn } from "@/lib/stop-all";
import { disableAllPcPerms, getPcPerms, resetPcPerms, setPcPerms } from "@/lib/pc-permissions";

export const dynamic = "force-dynamic";

function csrfBlock(req: Request, method: string) {
  const h = req.headers;
  return crossSiteBlocked(method, "/api/pc-permissions", {
    secFetchSite: h.get("sec-fetch-site"),
    origin: h.get("origin"),
    host: h.get("host"),
    forwardedHost: h.get("x-forwarded-host"),
  });
}

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json({ perms: getPcPerms(), stopAll: stopAllOn() });
}

export async function POST(req: Request) {
  if (csrfBlock(req, "POST")) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { res } = await requireUser();
  if (res) return res;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return Response.json({ error: "Invalid body" }, { status: 400 });
  const perms =
    body.action === "disable_all"
      ? await disableAllPcPerms()
      : body.action === "reset"
        ? await resetPcPerms()
        : await setPcPerms(body);
  return Response.json({ perms, stopAll: stopAllOn() });
}
