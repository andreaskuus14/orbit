// Auth-free liveness check for the launcher and wake listener. Returns nothing sensitive.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    ok: true,
    mode: process.env.NODE_ENV === "production" ? "production" : "development",
    uptimeSec: Math.round(process.uptime()),
    // The build this server was started from (set in instrumentation.ts); launch.ps1 restarts it when .next was rebuilt.
    buildId: (globalThis as { __orbitBuildId?: string | null }).__orbitBuildId ?? null,
  });
}
