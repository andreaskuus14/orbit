// Pure helper for local loopback ORBIT 2 mode when Supabase credentials are not configured in .env.local.

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopbackHost(hostHeader: string | null | undefined, env: Record<string, string | undefined> = {}): boolean {
  if ((env.ORBIT_ROLE ?? "").trim().toLowerCase() === "cloud") return false;
  if (!hostHeader) return false;
  const raw = hostHeader.trim().toLowerCase();
  const host = raw.startsWith("[") ? raw.slice(0, raw.indexOf("]") + 1) : raw.split(":")[0];
  return LOOPBACK_HOSTS.has(host);
}
