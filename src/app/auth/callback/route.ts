import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Completes the email magic-link / OAuth sign-in, then enters the galaxy.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const { searchParams } = url;
  // Behind Tailscale Serve (docs/PHONE.md) request.url says localhost; go back to the address the browser actually used.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = /\.ts\.net(?::\d+)?$/i.test(host ?? "") ? "https" : request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? url.protocol.replace(":", ""); // Serve is HTTPS-only
  const origin = host && /^[a-z0-9.-]+(?::\d+)?$/i.test(host) && /^https?$/.test(proto) ? `${proto}://${host}` : url.origin;
  const code = searchParams.get("code");
  if (code) {
    const sb = await createClient();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/`);
  }
  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
