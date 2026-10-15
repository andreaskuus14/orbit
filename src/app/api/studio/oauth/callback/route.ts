import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { OAuthError, connect } from "@/lib/yt-oauth";
import { OAUTH_COOKIE, OAUTH_PATH, loopbackOrigin, sameSecret } from "@/lib/yt-analytics-pure";

const REASONS = new Set(["not_configured", "exchange", "no_refresh", "scope", "channel", "no_channel"]);

// Google redirects here. Only short reason codes go back in the URL: never Google's error text or a token.
export async function GET(req: NextRequest) {
  const { res } = await requireUser();
  if (res) return res;
  const origin = loopbackOrigin(req.headers.get("host"));
  if (!origin) return Response.json({ error: "Open ORBIT at http://localhost:3000 to connect YouTube" }, { status: 400 });
  const done = (reason?: string) => {
    const r = NextResponse.redirect(new URL(reason ? `/?studio=error&reason=${reason}` : "/?studio=connected", origin));
    r.cookies.set(OAUTH_COOKIE, "", { httpOnly: true, sameSite: "lax", path: OAUTH_PATH, maxAge: 0 });
    return r;
  };
  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return done(sp.get("error") === "access_denied" ? "denied" : "google");
  const [state, verifier] = (req.cookies.get(OAUTH_COOKIE)?.value ?? "").split(".");
  const code = sp.get("code");
  if (!state || !verifier || !code || !sameSecret(state, sp.get("state") ?? "")) return done("state");
  try {
    await connect(code, verifier, `${origin}${OAUTH_PATH}/callback`);
    return done();
  } catch (e) {
    return done(!(e instanceof OAuthError) ? "save" : REASONS.has(e.message) ? e.message : "exchange"); // non-OAuthError = token file write failed
  }
}
