import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Service-role client for server work with no session (scheduler, STUDIO background loops); null without SUPABASE_SECRET_KEY. */
export function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
