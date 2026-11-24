// Where this ORBIT runs (docs/CLOUD.md). "laptop" (default): everything, as before. "cloud" (ORBIT_ROLE=cloud): the always-on
// brain on a small Linux server. It has no GPU, no desktop and no Windows tools: GPU jobs only go into the gpu_jobs queue for
// the laptop worker, laptop-only routes and CORE tools answer "needs the laptop", and auth paths are rate limited.

export type OrbitRole = "laptop" | "cloud";
type Env = Record<string, string | undefined>;

export const orbitRole = (env: Env): OrbitRole => ((env.ORBIT_ROLE ?? "").trim().toLowerCase() === "cloud" ? "cloud" : "laptop");
export const isCloud = (env: Env) => orbitRole(env) === "cloud";

export const LAPTOP_ONLY_TEXT = "This runs on the laptop. The cloud ORBIT can't do it; open ORBIT on the laptop.";

/** API routes that drive the laptop itself (shell, PC helper, GPU servers, Blender, Roblox Studio, ffmpeg clips, self-update).
 *  On the cloud server they answer 503 instead of running anything on the server. */
export const LAPTOP_ONLY_API = [
  "/api/terminal", "/api/sandbox", "/api/devsession", "/api/devtools", "/api/devworld", "/api/git", "/api/luau", "/api/self-improve",
  "/api/pc", "/api/pc-permissions", "/api/local-ai", "/api/local-brain", "/api/kaggle", "/api/night", "/api/night-repair",
  "/api/rojo", "/api/roblox", "/api/system/update", "/api/voice/desk", "/api/voice/desk-settings",
  "/api/studio/clips", "/api/studio/dub", "/api/studio/longform", "/api/studio/busy", "/api/arch/render",
] as const;

const under = (path: string, p: string) => path === p || path.startsWith(p + "/");
export const laptopOnlyApi = (path: string) => LAPTOP_ONLY_API.some((p) => under(path, p));

/** CORE tools that need the laptop (PC helper, Roblox files, shell, code sandbox, local speech-to-text, the clip factory).
 *  The GPU tools (local_image …) are not here: on the cloud they go into the queue for the laptop. */
export const LAPTOP_ONLY_TOOLS = new Set([
  "pc_act", "pc_window", "roblox_export", "roblox_lint", "roblox_files", "roblox_read", "roblox_write", "roblox_undo",
  "terminal_run", "terminal_status", "terminal_stop", "sandbox_run", "sandbox_save", "local_transcribe", "plan_task", "run_scout",
]);
export const laptopOnlyTool = (tool: string) => LAPTOP_ONLY_TOOLS.has(tool);

/** Public paths that get a per-IP limit on the cloud server (sign-in callback, login page, phone pairing, signed links). */
export const RATE_LIMITED = [
  { prefix: "/auth", limit: 20, windowMs: 60_000 },
  { prefix: "/login", limit: 30, windowMs: 60_000 },
  { prefix: "/api/remote/pair", limit: 10, windowMs: 60_000 },
  { prefix: "/api/remote", limit: 240, windowMs: 60_000 },
  { prefix: "/p", limit: 60, windowMs: 60_000 },
] as const;
export const rateRule = (path: string) => RATE_LIMITED.find((r) => under(path, r.prefix)) ?? null;

export type Buckets = Map<string, { n: number; reset: number }>;
/** Fixed window counter. true = allowed. Keeps the map small (drops expired entries once it grows). */
export function allowHit(b: Buckets, key: string, now: number, limit: number, windowMs: number): boolean {
  if (b.size > 5000) for (const [k, v] of b) if (v.reset <= now) b.delete(k);
  const cur = b.get(key);
  if (!cur || cur.reset <= now) { b.set(key, { n: 1, reset: now + windowMs }); return true; }
  cur.n++;
  return cur.n <= limit;
}

/** Client IP behind Caddy: the first X-Forwarded-For entry (Caddy sets it), else X-Real-IP, else "?". */
export const clientIp = (xff: string | null, real: string | null) => (xff?.split(",")[0]?.trim() || real?.trim() || "?").slice(0, 64);

/** Journal writes on the cloud need the key there; without it a new entry would land in Supabase as plain text. */
export const journalWriteBlocked = (env: Env, hasKey: boolean) => isCloud(env) && !hasKey;
export const JOURNAL_CLOUD_TEXT = "The journal can only be written on the laptop (its key isn't on the cloud server).";

/** Briefings, automations and pushes run in one place only. ORBIT_SCHEDULER=0 turns them off (on the laptop, once the cloud
 *  brain runs them), so the phone never gets everything twice. */
export const schedulerOn = (env: Env) => (env.ORBIT_SCHEDULER ?? "").trim() !== "0";
