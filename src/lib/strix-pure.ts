// Strix (AI pentest agents) against ORBIT's isolated test copy only: the target guard and the report summary.
// Used by scripts/isolated/strix.mjs. Tests: tests/strix-pure.test.ts.

export const ISOLATED_PORT = 3100; // scripts/isolated/lib.cjs BASE
const LOCAL = new Set(["127.0.0.1", "localhost"]);

/** "" if `url` is the isolated server; otherwise why it is refused. Never the live ORBIT, never another host. */
export function targetProblem(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return `not a URL: ${url}`; }
  if (u.protocol !== "http:") return "the isolated server speaks plain http on localhost";
  if (!LOCAL.has(u.hostname)) return `${u.hostname} is not this machine: Strix only tests the isolated copy on 127.0.0.1`;
  if (Number(u.port) !== ISOLATED_PORT) return `port ${u.port || "80"} is not the isolated server's ${ISOLATED_PORT} (the live ORBIT runs elsewhere)`;
  if (u.username || u.password) return "no credentials in the target URL";
  return "";
}

/** "" if the isolated stack's markers look right (env.json from setup.mjs: a local Supabase URL and the test account). */
export function envProblem(env: { apiUrl?: unknown; email?: unknown } | null): string {
  if (!env) return "no isolated env.json: run `node scripts/isolated/setup.mjs` first";
  let api: URL;
  try { api = new URL(String(env.apiUrl)); } catch { return "env.json has no Supabase URL"; }
  if (!LOCAL.has(api.hostname)) return `env.json points at ${api.hostname}, not the local Supabase: refusing`;
  if (!/@example\.test$/i.test(String(env.email ?? ""))) return "env.json's account is not the throwaway @example.test user: refusing";
  return "";
}

export type Summary = { critical: number; high: number; medium: number; low: number; info: number; titles: string[] };
/** Counts findings by severity in Strix report text (markdown or JSON). shortcut: matches "severity: X" lines and JSON
 *  "severity" fields, not a schema; adjust if Strix changes its report format. */
export function summarize(texts: string[]): Summary {
  const s: Summary = { critical: 0, high: 0, medium: 0, low: 0, info: 0, titles: [] };
  for (const t of texts) {
    for (const m of t.matchAll(/["']?severity["']?\s*[:=]\s*["'*_ ]*(critical|high|medium|low|info(?:rmational)?)\b/gi)) {
      const k = m[1].toLowerCase().startsWith("info") ? "info" : (m[1].toLowerCase() as keyof Omit<Summary, "titles">);
      s[k]++;
    }
    for (const m of t.matchAll(/^#{1,3}\s+(.{4,120})$/gm)) if (/vuln|injection|xss|ssrf|csrf|bypass|leak|exposure|auth/i.test(m[1])) s.titles.push(m[1].trim());
  }
  s.titles = [...new Set(s.titles)].slice(0, 20);
  return s;
}
