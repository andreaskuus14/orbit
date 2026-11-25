// What an update rollback must undo besides swapping .next-prev back. scripts/launch.ps1 has the same rules in
// Get-RollbackPlan (PowerShell can't import this); tests/rollback.test.ts and scripts/launch-update.test.ps1 check the
// same cases, so keep the two in step.

/** Written into every build as orbit-release.txt: the commit it was built from and the package-lock.json hash. */
export type ReleaseStamp = { commit: string; lock: string };

export type RollbackInput = {
  prev: ReleaseStamp | null; // the release going back into .next (null: built before stamps existed)
  head: string; // git HEAD now
  lockNow: string; // hash of package-lock.json now
  savedLock: string | null; // lock hash node_modules-prev was installed from (null: no node_modules-prev)
};

/** resetTo: git reset --keep to this commit (null: leave git alone).
 *  deps: keep = node_modules already fits; restore = put node_modules-prev back; reinstall = npm ci after the reset. */
export type RollbackPlan = { resetTo: string | null; deps: "keep" | "restore" | "reinstall" };

export function parseStamp(text: string | null | undefined): ReleaseStamp | null {
  const [commit, lock] = (text ?? "").split(/\r?\n/).map((s) => s.trim());
  return commit && lock ? { commit, lock } : null;
}

export function rollbackPlan({ prev, head, lockNow, savedLock }: RollbackInput): RollbackPlan {
  if (!prev) return { resetTo: null, deps: "keep" }; // unknown: same as before stamps
  const resetTo = prev.commit !== head ? prev.commit : null;
  if (prev.lock === lockNow) return { resetTo, deps: "keep" };
  return { resetTo, deps: savedLock === prev.lock ? "restore" : "reinstall" };
}

/** After a rollback, a plain update request that pulls the same bad commit again is undone instead of rebuilt. */
export function skipPulledCommit(pulled: string, old: string, rolledBack: string | null, forced: boolean): boolean {
  return !forced && !!rolledBack && pulled !== old && pulled === rolledBack;
}
