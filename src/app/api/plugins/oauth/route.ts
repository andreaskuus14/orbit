import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { finishOAuth, startOAuth } from "@/lib/plugins";
import { oauthRedirect } from "@/lib/plugins-pure";

export const dynamic = "force-dynamic";

// Profile → Plugins "Sign in" for an http plugin with "oauth": true. GET ?name=<plugin> starts it (opens the server's login page);
// the server sends the browser back here with ?code&state. Only on http://127.0.0.1:<port>; no token ever goes into a URL or answer.
export async function GET(req: NextRequest) {
  const { res } = await requireUser();
  if (res) return res;
  const redirect = req.headers.get("x-forwarded-host") ? null : oauthRedirect(req.headers.get("host"));
  if (!redirect) return Response.json({ error: "Open ORBIT at http://127.0.0.1:3000 to sign in to a plugin" }, { status: 400 });
  const sp = req.nextUrl.searchParams, back = (q: string) => NextResponse.redirect(new URL(`/?plugins=${q}`, redirect));
  if (sp.get("error")) return back("signin-cancelled");
  const code = sp.get("code"), state = sp.get("state");
  if (code || state) {
    const r = await finishOAuth(state ?? "", code ?? "");
    return back(r.error ? `signin-${r.error}` : "signed-in");
  }
  // start only from ORBIT's own page (his click) or a typed URL, never from a link on another site
  if (!["same-origin", "none"].includes(req.headers.get("sec-fetch-site") ?? "")) return Response.json({ error: "Start the sign-in from Profile → Plugins" }, { status: 403 });
  const r = await startOAuth(sp.get("name") ?? "", redirect);
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  return r.url ? NextResponse.redirect(r.url) : back("signed-in");
}
