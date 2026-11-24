// What makes a fresh release unusable, checked without the network or the database. Used by /api/health (the
// supervisor in scripts/launch.ps1 rolls back a new build that reports a fatal problem) and by the middleware (a clear
// message instead of a blank app). Names only, never values.

export type ReleaseEnv = { NEXT_PUBLIC_SUPABASE_URL?: string; NEXT_PUBLIC_SUPABASE_ANON_KEY?: string; SUPABASE_SECRET_KEY?: string };
export type BootCheck = { id: string; status: string; detail?: string };
export type ReleaseProblems = { fatal: string[]; warn: string[] };

const blank = (v: string | undefined) => !v || !v.trim();

/** Settings the app can't run without. NEXT_PUBLIC_* are baked in at build time, so a build made without them stays broken. */
export function missingSettings(env: ReleaseEnv): string[] {
  return (["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const).filter((k) => blank(env[k]));
}

export function missingSettingsText(names: string[]): string {
  return `ORBIT can't start: ${names.join(", ")} ${names.length === 1 ? "is" : "are"} missing from .env.local. Add ${names.length === 1 ? "it" : "them"}, then run: npm run app:rebuild`;
}

/** fatal = roll the update back; warn = keep it running but say so loudly (log + doctor). */
export function releaseProblems(env: ReleaseEnv, boot: BootCheck[] | null): ReleaseProblems {
  const missing = missingSettings(env);
  const fatal = missing.length ? [missingSettingsText(missing)] : [];
  const warn: string[] = [];
  if (blank(env.SUPABASE_SECRET_KEY)) warn.push("SUPABASE_SECRET_KEY is missing from .env.local: background jobs (scheduler, backups) are off.");
  const mig = boot?.find((c) => c.id === "migrations" && c.status === "fail");
  if (mig) warn.push(`Database migrations missing: ${mig.detail ?? "see the doctor"}. Run them in the Supabase SQL editor (docs/MIGRATIONS.md).`);
  return { fatal, warn };
}
