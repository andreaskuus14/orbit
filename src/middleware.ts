import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail } from "@/lib/allow";
import { crossSiteBlocked } from "@/lib/csrf";
import { publicOrigin } from "@/lib/origin-pure";

// /w = workspace previews: the route checks the signed link + session itself (sandboxed pages' CSS/JS requests carry no cookies).
// /remote, /screen + /api/remote = the paired-phone remote and read-only screen: its routes check their own device token (or, for /api/remote/owner, the session).
const PUBLIC_PATHS = ["/login", "/auth/callback", "/manifest.webmanifest", "/api/health", "/w", "/remote", "/screen", "/api/remote"];

export async function middleware(request: NextRequest) {
  if (crossSiteBlocked(request.method, request.nextUrl.pathname, { secFetchSite: request.headers.get("sec-fetch-site"), origin: request.headers.get("origin"), host: request.headers.get("host"), forwardedHost: request.headers.get("x-forwarded-host") }))
  { console.warn(`[security] cross-site ${request.method} ${request.nextUrl.pathname} refused (origin ${request.headers.get("origin") ?? "none"})`);
    return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 }); }
  // Launcher / night run poll these; no session work. (busy checks its own Host header and returns only booleans.)
  if (request.nextUrl.pathname === "/api/health" || request.nextUrl.pathname === "/api/studio/busy") return NextResponse.next();
  // Public demo: static fixture page, no session work (it never calls /api; its fetch guard answers from fixtures).
  if (request.nextUrl.pathname === "/demo") return NextResponse.next();
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
    // Absolute URL on the address the browser used (phone via Tailscale), not the localhost the proxy talks to.
    const url = new URL(pathname + search, publicOrigin({ host: request.headers.get("host"), forwardedHost: request.headers.get("x-forwarded-host"), forwardedProto: request.headers.get("x-forwarded-proto") }, request.url));
    const r = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));

  if (user && !isAllowedEmail(user.email)) {
    console.warn(`[security] sign-in by an account that isn't allowed (${user.email?.split("@")[1] ?? "?"}) refused`); // domain only, no full address in logs
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
