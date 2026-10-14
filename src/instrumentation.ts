// Next.js calls this once when the server starts. The `if` block form lets Next drop the import from the
// edge build entirely (an early `return` doesn't), which matters because the scheduler uses Node-only APIs.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
