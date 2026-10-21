// Next.js calls this once when the server starts. The `if` block form lets Next drop the import from the
// edge build entirely (an early `return` doesn't), which matters because the scheduler uses Node-only APIs.
export async function register() {
  // Not in "next build" workers: launch.ps1 builds next to the live server, which already runs the scheduler.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    if (process.env.NODE_ENV === "production") {
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      try { (globalThis as { __orbitBuildId?: string | null }).__orbitBuildId = readFileSync(join(process.cwd(), process.env.ORBIT_DIST_DIR || ".next", "BUILD_ID"), "utf8").trim(); } catch { /* reported as null */ }
    }
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
    const { startClipQueue } = await import("./lib/clips/factory");
    startClipQueue(); // resume queued clip jobs without waiting for the STUDIO page to be opened
    const { startInboxWatch } = await import("./lib/clips/inbox-watch");
    startInboxWatch(); // auto-clips stream files dropped into the inbox
    // Own timer, not startScheduler(): that one is off without SUPABASE_SECRET_KEY, and the scout only needs local files + YOUTUBE_API_KEY.
    const { startScout } = await import("./lib/clips/scout");
    startScout();
    // Niche/trend alerts while no ORBIT tab is open: inbox for the Herald + Windows toasts. Own timer for the same reason as the scout.
    const { startHeraldWatch } = await import("./lib/herald-watch");
    startHeraldWatch();
    const { startResultsLoop } = await import("./lib/clips/learn");
    startResultsLoop(); // capture 48h outcomes even when the STUDIO drawer is closed
    // Self-test once the server answers requests; /api/doctor shares the same run (and starts it itself if asked first).
    setTimeout(() => { void import("./lib/doctor-boot").then((m) => m.bootSelfTest()).catch(() => {}); }, 15_000);
  }
}
