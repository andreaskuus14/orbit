import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { OAuthError } from "@/lib/yt-oauth";
import { calEnv, connectCal } from "@/lib/gcal";
import { CAL_COOKIE, CAL_OAUTH_PATH, calAuthUrl } from "@/lib/gcal-pure";
import { loopbackOrigin, pkceChallenge, randomToken, sameSecret } from "@/lib/yt-analytics-pure";

const REASONS = new Set(["not_configured", "exchange", "no_refresh", "scope"]);

// "Connect Google Calendar" (read-only). Navigate here: without ?code/?error it starts the PKCE loopback flow; Google redirects back
// here with them. Only short reason codes go back in the URL.
export async function GET(req: NextRequest) {
  const { res } = await requireUser();
  if (res) return res;
  // Behind a proxy the Host isn't the browser's: the loopback redirect (and our cookies) wouldn't come back here.
  const origin = req.headers.get("x-forwarded-host") ? null : loopbackOrigin(req.headers.get("host"));
  if (!origin) return Response.json({ error: "Open ORBIT at http://localhost:3000 to connect Google Calendar" }, { status: 400 });
  const redirectUri = `${origin}${CAL_OAUTH_PATH}`, sp = req.nextUrl.searchParams;
  if (!sp.get("code") && !sp.get("error")) {
    const cfg = calEnv();
    if (!cfg) return Response.json({ error: "Google sign-in isn't configured: add GCAL_OAUTH_CLIENT_ID/_SECRET (or the YOUTUBE_OAUTH_ ones) to .env.local" }, { status: 400 });
    const state = randomToken(), verifier = randomToken();
    const r = NextResponse.redirect(calAuthUrl({ clientId: cfg.id, redirectUri, state, challenge: pkceChallenge(verifier) }));
    r.cookies.set(CAL_COOKIE, `${state}.${verifier}`, { httpOnly: true, sameSite: "lax", path: CAL_OAUTH_PATH, maxAge: 600 });
    return r;
  }
  const done = (reason?: string) => {
    const r = NextResponse.redirect(new URL(reason ? `/?calendar=error&reason=${reason}` : "/?calendar=connected", origin));
    r.cookies.set(CAL_COOKIE, "", { httpOnly: true, sameSite: "lax", path: CAL_OAUTH_PATH, maxAge: 0 });
    return r;
  };
  if (sp.get("error")) return done(sp.get("error") === "access_denied" ? "denied" : "google");
  const [state, verifier] = (req.cookies.get(CAL_COOKIE)?.value ?? "").split(".");
  if (!state || !verifier || !sameSecret(state, sp.get("state") ?? "")) return done("state");
  try {
    await connectCal(sp.get("code")!, verifier, redirectUri);
    return done();
  } catch (e) {
    return done(!(e instanceof OAuthError) ? "save" : REASONS.has(e.message) ? e.message : "exchange");
  }
}
