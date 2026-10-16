import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { publicOrigin } from "@/lib/origin-pure";

// Completes the email magic-link / OAuth sign-in, then enters the galaxy.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const { searchParams } = url;
  // Behind Tailscale Serve (docs/PHONE.md) request.url says localhost; go back to the address the browser actually used.
  const origin = publicOrigin({ host: request.headers.get("host"), forwardedHost: request.headers.get("x-forwarded-host"), forwardedProto: request.headers.get("x-forwarded-proto") }, url.href);
  const code = searchParams.get("code");
  if (code) {
    const sb = await createClient();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/`);
  }
  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
