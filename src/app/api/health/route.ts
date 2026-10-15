// Auth-free liveness check for the launcher and wake listener. Returns nothing sensitive.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    ok: true,
    mode: process.env.NODE_ENV === "production" ? "production" : "development",
    uptimeSec: Math.round(process.uptime()),
  });
}
