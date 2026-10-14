import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Completes the email magic-link / OAuth sign-in, then enters the galaxy.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const sb = await createClient();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/`);
  }
  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
