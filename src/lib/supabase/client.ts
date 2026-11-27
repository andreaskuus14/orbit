import { createBrowserClient } from "@supabase/ssr";
import { supabaseTimeoutMs, timeoutSignal } from "../api-error-pure.ts";

function makeBrowserClient(url: string, key: string) {
  return createBrowserClient(
    url,
    key,
    // A hung Supabase or lost network fails in seconds, so callers show their offline/empty state.
    { global: { fetch: (input, init) => fetch(input, { ...init, signal: timeoutSignal(supabaseTimeoutMs(String(input instanceof Request ? input.url : input), init?.method), init?.signal) }) } },
  );
}

type BrowserSupabaseClient = ReturnType<typeof makeBrowserClient>;

function localStubClient(): BrowserSupabaseClient {
  const resolved = Promise.resolve({ data: [], count: 0, error: null });
  const chain: Record<string, unknown> = {
    then: resolved.then.bind(resolved),
    catch: resolved.catch.bind(resolved),
    finally: resolved.finally.bind(resolved),
  };
  const self = () => chain;
  for (const m of ["select", "eq", "neq", "is", "in", "or", "gte", "lte", "order", "limit", "range", "single", "maybeSingle", "insert", "update", "delete"]) {
    chain[m] = self;
  }
  const ch = { on: () => ch, subscribe: (cb?: (status: string) => void) => { cb?.("SUBSCRIBED"); return ch; } };
  return {
    from: () => chain,
    channel: () => ch,
    removeChannel: () => Promise.resolve("ok"),
    auth: {
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
      signOut: () => Promise.resolve({ error: null }),
    },
  } as unknown as BrowserSupabaseClient;
}

export function createClient(): BrowserSupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return localStubClient();
  return makeBrowserClient(url, key);
}
