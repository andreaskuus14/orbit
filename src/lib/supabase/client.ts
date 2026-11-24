import { createBrowserClient } from "@supabase/ssr";
import { supabaseTimeoutMs, timeoutSignal } from "../api-error-pure.ts";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    // A hung Supabase or lost network fails in seconds, so callers show their offline/empty state.
    { global: { fetch: (input, init) => fetch(input, { ...init, signal: timeoutSignal(supabaseTimeoutMs(String(input instanceof Request ? input.url : input), init?.method), init?.signal) }) } },
  );
}
