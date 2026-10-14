import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isAllowedEmail } from "@/lib/allow";

/** Per-request Supabase client acting as the signed-in user (RLS applies). */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(list) {
          try {
            list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component; middleware refreshes the session instead.
          }
        },
      },
    },
  );
}

/** For API routes: the client plus the verified user, or a 401 response. */
export async function requireUser(): Promise<
  { sb: SupabaseClient; user: User; res?: undefined } | { res: Response; sb?: undefined; user?: undefined }
> {
  const sb = await createClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) return { res: Response.json({ error: "Not signed in" }, { status: 401 }) };
  // Also enforced here, not only in middleware (whose matcher skips some paths).
  if (!isAllowedEmail(data.user.email)) return { res: Response.json({ error: "Not allowed" }, { status: 403 }) };
  return { sb, user: data.user };
}
