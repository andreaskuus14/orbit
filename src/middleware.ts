import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail } from "@/lib/allow";

const PUBLIC_PATHS = ["/login", "/auth/callback", "/manifest.webmanifest", "/api/health"];

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/health") return NextResponse.next(); // launcher polls it; no session work
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(list) {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Refreshes the session cookie; must run on every request.
  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  // Redirect while keeping any auth cookies Supabase just set (e.g. on sign-out).
  const redirectTo = (pathname: string, search = "") => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = search;
    const r = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));

  if (user && !isAllowedEmail(user.email)) {
    await supabase.auth.signOut();
    return redirectTo("/login", "?error=not_allowed");
  }

  if (!user && !isPublic) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    return redirectTo("/login");
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|webp)$).*)"],
};
