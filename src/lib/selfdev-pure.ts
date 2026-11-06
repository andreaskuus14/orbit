// Self-development view (DEV → Doctor), pure half. Maps the builder's and supervisor's real steps to the four claims
// the owner cares about, never upgrading one: "implemented" (code changed), "tested" (checks passed), "deployed"
// (installed and being watched), "verified after deployment" (monitoring passed and the release was kept).
// IO: src/app/api/selfdev/route.ts. The supervisor and builder are separate processes (supervisor/, selfdev/).

export type Stage = "selected" | "implemented" | "tested" | "ci" | "deployed" | "verified" | "rolledBack" | "rejected" | "halted" | "failed" | "noChange";

/** Builder task step → stage. Its "verified" means its own checks passed: that is "tested", not deployed. */
export function taskStage(step: string, outcome?: string): Stage {
  if (step === "done") {
    if (outcome?.startsWith("released")) return "verified";
    if (outcome?.startsWith("no change")) return "noChange";
    return "failed";
  }
  return ({ selected: "selected", prepared: "selected", edited: "implemented", verified: "tested", submitted: "tested" } as Record<string, Stage>)[step] ?? "selected";
}

/** Supervisor release step → stage. */
export function releaseStage(step: string): Stage {
  switch (step) {
    case "accepted": case "fetched": case "approved": case "pushed": return "tested";
    case "checked": case "merged": case "built": case "snapshotted": case "backedUp": return "ci";
    case "installed": return "deployed";
    case "retained": return "verified";
    case "rolledBack": return "rolledBack";
    case "rejected": return "rejected";
    case "halted": return "halted";
    default: return "failed"; // "failed" = installed, then a check failed; recovery runs next
  }
}

export type Control = { action: "pause" | "stop" | "restore"; releaseId?: string };

/** The app may only ask for safer states. Resume/clear exist only on the supervisor's own command line. */
export function parseControl(x: unknown): Control | null {
  const c = x as { action?: unknown; releaseId?: unknown };
  if (!c || typeof c !== "object") return null;
  if (c.action === "pause" || c.action === "stop") return { action: c.action };
  if (c.action === "restore") {
    if (c.releaseId === undefined) return { action: "restore" };
    return typeof c.releaseId === "string" && SAFE_ID.test(c.releaseId) ? { action: "restore", releaseId: c.releaseId } : null;
  }
  return null;
}

export const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,120}$/i;

/** Where the separately installed processes keep their public files; null = not installed on this machine. */
export function homes(env: Record<string, string | undefined>): { supervisor: string | null; builder: string | null } {
  return { supervisor: env.ORBIT_SUPERVISOR_HOME || null, builder: env.ORBIT_SELFDEV_HOME || null };
}
