import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseTimeoutMs, timeoutSignal } from "../api-error-pure.ts";

/** Service-role client for server work with no session (scheduler, STUDIO background loops); null without SUPABASE_SECRET_KEY. */
export function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: timeoutSignal(supabaseTimeoutMs(String(input instanceof Request ? input.url : input), init?.method), init?.signal) }) } });
}
