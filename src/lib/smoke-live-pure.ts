// Pure parts of scripts/smoke-live.mjs (the after-update smoke run against his own running ORBIT). Tested in tests/smoke-live.test.ts.

export type Verdict = "pass" | "warn" | "fail";
export type CheckResult = { name: string; verdict: Verdict; status?: number; ms?: number; detail?: string };

/** A cookie file he exports: a raw "a=1; b=2" header (optionally starting with "Cookie:"), or a browser-extension JSON array
 *  of { name, value }. Returns name/value pairs; [] for anything else. */
export function parseCookieFile(text: string): { name: string; value: string }[] {
  const t = text.replace(/^﻿/, "").trim();
  if (!t) return [];
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      const j = JSON.parse(t) as unknown;
      const arr = Array.isArray(j) ? j : Array.isArray((j as { cookies?: unknown }).cookies) ? (j as { cookies: unknown[] }).cookies : [];
      return arr.flatMap((c) => {
        const o = c as { name?: unknown; value?: unknown };
        return typeof o?.name === "string" && typeof o.value === "string" && o.name ? [{ name: o.name, value: o.value }] : [];
      });
    } catch { return []; }
  }
  return t.replace(/^cookie:\s*/i, "").split(/;\s*|\r?\n/).flatMap((p) => {
    const i = p.indexOf("=");
    const name = i > 0 ? p.slice(0, i).trim() : "";
    return name ? [{ name, value: p.slice(i + 1).trim() }] : [];
  });
}

export const cookieHeader = (pairs: { name: string; value: string }[]) => pairs.map((c) => `${c.name}=${c.value}`).join("; ");

/** /api/health commit vs git HEAD. Either may be short; null commit = an unstamped build. */
export function commitCheck(served: string | null | undefined, head: string | null | undefined): CheckResult {
  const name = "/api/health commit = git HEAD";
  if (!head) return { name, verdict: "warn", detail: "could not read git HEAD" };
  if (!served) return { name, verdict: "fail", detail: "server build has no commit stamp" };
  const a = served.trim().toLowerCase(), b = head.trim().toLowerCase();
  const ok = a.length >= 7 && b.length >= 7 && (a.startsWith(b) || b.startsWith(a));
  return { name, verdict: ok ? "pass" : "fail", detail: ok ? a.slice(0, 7) : `server ${a.slice(0, 7)} ≠ HEAD ${b.slice(0, 7)} (old build still running?)` };
}

/** Keys in a LIFE lite answer that could carry journal or note text. journalDays (a count) is allowed. */
export function privateKeys(v: unknown, path = ""): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => privateKeys(x, `${path}[${i}]`));
  if (!v || typeof v !== "object") return [];
  return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => {
    const p = path ? `${path}.${k}` : k;
    const bad = /journal|entry|entries|diary|notes?$/i.test(k) && k !== "journalDays";
    return [...(bad ? [p] : []), ...privateKeys(x, p)];
  });
}

/** Default verdict for a plain route: 2xx pass; 401/403 fail (cookie expired); other 4xx warn; 5xx / no answer fail. */
export function httpVerdict(status: number): Verdict {
  if (status >= 200 && status < 300) return "pass";
  if (status === 401 || status === 403) return "fail";
  if (status >= 400 && status < 500) return "warn";
  return "fail";
}

/** Slippy-map tile for a point (the buildings route uses zoom 14). */
export function tileOf(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z, r = (lat * Math.PI) / 180;
  return { x: Math.floor(((lon + 180) / 360) * n), y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n) };
}

/** Folder name for one run's screenshots, local time: live-2026-11-24_0930. */
export function runFolder(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `live-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Console messages that are not ORBIT bugs: the requests this run blocked on purpose (writes) and favicon noise. */
export function realConsoleErrors(msgs: string[], blocked: string[]): string[] {
  return msgs.filter((m) => !/favicon\.ico/i.test(m) && !(/ERR_FAILED|Failed to fetch|NetworkError/i.test(m) && blocked.length > 0)
    && !blocked.some((u) => m.includes(u)));
}

/** Short fixed-width table + totals. exitCode 1 when anything failed. */
export function summarize(results: CheckResult[]): { table: string; pass: number; warn: number; fail: number; exitCode: 0 | 1 } {
  const w = Math.min(48, Math.max(5, ...results.map((r) => r.name.length)));
  const tag = { pass: "PASS", warn: "WARN", fail: "FAIL" } as const;
  const rows = results.map((r) => `${tag[r.verdict]}  ${r.name.slice(0, w).padEnd(w)}  ${r.status ? String(r.status).padStart(3) : "  -"}  ${(r.detail ?? "").replace(/\s+/g, " ").slice(0, 90)}`);
  const n = (v: Verdict) => results.filter((r) => r.verdict === v).length;
  const pass = n("pass"), warn = n("warn"), fail = n("fail");
  return { table: [...rows, "", `${pass} pass, ${warn} warn, ${fail} fail`].join("\n"), pass, warn, fail, exitCode: fail ? 1 : 0 };
}
