// Next.js calls this once when the server starts. The `if` block form lets Next drop the import from the
// edge build entirely (an early `return` doesn't), which matters because the scheduler uses Node-only APIs.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NODE_ENV === "production") {
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      try { (globalThis as { __orbitBuildId?: string | null }).__orbitBuildId = readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim(); } catch { /* reported as null */ }
    }
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
    const { startClipQueue } = await import("./lib/clips/factory");
    startClipQueue(); // resume queued clip jobs without waiting for the STUDIO page to be opened
  }
}
