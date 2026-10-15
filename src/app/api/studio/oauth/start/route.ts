import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { oauthEnv } from "@/lib/yt-oauth";
import { OAUTH_COOKIE, OAUTH_ENV, OAUTH_PATH, authUrl, loopbackOrigin, pkceChallenge, randomToken } from "@/lib/yt-analytics-pure";

// Starts the Google loopback OAuth flow (PKCE). Navigate here (not fetch): it redirects to Google.
export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const cfg = oauthEnv();
  if (!cfg) return Response.json({ error: "YouTube OAuth isn't configured", setupEnv: OAUTH_ENV }, { status: 400 });
  // The callback must come back to this exact host, or the session cookie (and our state cookie) won't be sent.
  const origin = loopbackOrigin(req.headers.get("host"));
  if (!origin) return Response.json({ error: "Open ORBIT at http://localhost:3000 to connect YouTube" }, { status: 400 });
  const state = randomToken(), verifier = randomToken();
  const r = NextResponse.redirect(authUrl({ clientId: cfg.id, redirectUri: `${origin}${OAUTH_PATH}/callback`, state, challenge: pkceChallenge(verifier) }));
  r.cookies.set(OAUTH_COOKIE, `${state}.${verifier}`, { httpOnly: true, sameSite: "lax", path: OAUTH_PATH, maxAge: 600 });
  return r;
}
