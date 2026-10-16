// CSRF guard for /api/* (pure, tested in tests/csrf.test.ts; used by src/middleware.ts). Browsers send Sec-Fetch-Site / Origin on
// cross-site requests; a state-changing request from another site is refused. Requests with neither header (local tools, curl) pass.
export function crossSiteBlocked(method: string, path: string, h: { secFetchSite?: string | null; origin?: string | null; host?: string | null }): boolean {
  if (!path.startsWith("/api/") || ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return false;
  if (h.secFetchSite && h.secFetchSite !== "same-origin") return true;
  if (h.origin) {
    try { return new URL(h.origin).host !== (h.host ?? ""); } catch { return true; } // "null" or garbage origin
  }
  return false;
}
