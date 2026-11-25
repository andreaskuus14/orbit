// Auth-free liveness check for the launcher and wake listener. Returns nothing sensitive.
import { releaseProblems, type BootCheck } from "@/lib/release-check-pure";

export const dynamic = "force-dynamic";

// The boot self-test's checks once it finished (null before), without waiting for it.
async function bootChecks(): Promise<BootCheck[] | null> {
  const boot = (globalThis as { __orbitBoot?: Promise<{ report: { checks: BootCheck[] } }> }).__orbitBoot;
  if (!boot) return null;
  const r = await Promise.race([boot.catch(() => null), Promise.resolve(null)]);
  return r?.report.checks ?? null;
}

export async function GET() {
  // Literal names: NEXT_PUBLIC_* are inlined at build time, so this reports what the running build was made with.
  const problems = releaseProblems({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  }, await bootChecks());
  return Response.json({
    ok: true,
    mode: process.env.NODE_ENV === "production" ? "production" : "development",
    uptimeSec: Math.round(process.uptime()),
    // The build this server was started from (set in instrumentation.ts); launch.ps1 restarts it when .next was rebuilt.
    buildId: (globalThis as { __orbitBuildId?: string | null }).__orbitBuildId ?? null,
    // The commit stamped into that build (next.config): a release check matches it to the tested SHA without signing in. null = unstamped.
    commit: process.env.ORBIT_BUILD_COMMIT || null,
    // "laptop" or "cloud" (ORBIT_ROLE, docs/CLOUD.md), so the phone and the laptop can tell which ORBIT answered.
    // Setting names / migration files only, never values. fatal: launch.ps1 rolls a fresh update back.
    problems,
    role: (process.env.ORBIT_ROLE ?? "").trim().toLowerCase() === "cloud" ? "cloud" : "laptop",
  });
}
