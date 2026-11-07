// Isolated instances (self-development verification, drills): a second ORBIT must never act on live data.
// ORBIT_ISOLATED=1 skips every background loop at boot, and boot refuses when the env still points at live services.

/** Env keys whose presence in an isolated instance could reach live data or send something outside. */
export const LIVE_KEYS = ["SUPABASE_SECRET_KEY", "YOUTUBE_API_KEY", "VOYAGE_API_KEY", "NTFY_TOPIC", "RESEND_API_KEY", "TELEGRAM_BOT_TOKEN", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"] as const;

export function isolated(env: Record<string, string | undefined>): boolean {
  return env.ORBIT_ISOLATED === "1";
}

/** Why an isolated instance must not start with this env, or null when it is safe. */
export function isolationProblem(env: Record<string, string | undefined>): string | null {
  if (!isolated(env)) return null;
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  // Only a local address: a hosted project, or a custom domain in front of one, could be live data.
  if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/i.test(url)) return "ORBIT_ISOLATED=1 but NEXT_PUBLIC_SUPABASE_URL isn't a local address";
  const live = LIVE_KEYS.filter((k) => (env[k] ?? "") !== "");
  if (live.length) return `ORBIT_ISOLATED=1 but live keys are set: ${live.join(", ")}`;
  if (!env.ORBIT_DATA_DIR) return "ORBIT_ISOLATED=1 needs its own ORBIT_DATA_DIR";
  return null;
}
