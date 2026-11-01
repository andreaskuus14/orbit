import { withYoutubeBudget } from "./youtube-quota";
import { quotaSummary } from "./youtube-quota-pure";
import { exec, execFile } from "node:child_process";
import { access, readdir, readFile, stat, statfs, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CLAUDE_BIN, MODEL, SMART_MODEL, FAST_MODEL, DEEP_MODEL } from "./claude";
import { checkTools, listDownloads, studioRoot } from "./clips/factory";
import { youtubePauseUntil } from "./clips/pure";
import { hyperframesCli } from "./clips/hyperframes";
import { HF_INSTALL } from "./clips/hyperframes-pure";
import { scoutView } from "./clips/scout";
import { isMissingTable } from "./proactive-pure";
import { usage, vaultDir } from "./vault";
import { rememberChecks } from "./capability";
import { MAX_FILES, MAX_TOTAL } from "./vault-pure";
import { api } from "./youtube";
import { oauthEnv, readStored, wasExpired } from "./yt-oauth";
import { YT_UPLOAD_SCOPE, hasScopes } from "./yt-analytics-pure";
import {
  buildCheck, check, diskCheck, envCheck, factsCheck, launcherCheck, lifeCheck, modelCheck, nightCheck, quotaCheck, summarize, vaultCheck, ytdlpCheck, type Check, type Report,
  latencyCheck,
} from "./doctor-pure";
import { coreTurns } from "./perf-log";
import { migrationCheck, versionCheck } from "./version-pure";

// ORBIT doctor: runs every check in parallel, each with its own timeout, and returns plain-English verdicts (see doctor-pure.ts).
// Nothing here returns a secret: env checks report names only, and error text from outside is never passed through raw.

const WIN = process.platform === "win32";
const root = () => process.cwd(); // the launcher starts the server in the ORBIT folder, where its logs live
const exists = (p: string) => access(p).then(() => true, () => false);
const tail = (f: string, bytes = 20_000) => readFile(f, "utf8").then((s) => s.slice(-bytes), () => "");

// Cached on globalThis (survives dev hot reloads): the CLI and yt-dlp take ~1 s to start, the API call costs quota.
const g = globalThis as unknown as { __orbitDoctor?: Map<string, { until: number; v: unknown }> };
const cache = (g.__orbitDoctor ??= new Map());
async function cached<T>(key: string, fn: () => Promise<T>, ttl: (v: T) => number): Promise<T> {
  const c = cache.get(key);
  if (c && c.until > Date.now()) return c.v as T;
  const v = await fn();
  cache.set(key, { until: Date.now() + ttl(v), v });
  return v;
}

/** `<bin> --version` (shell: Windows installs claude as claude.cmd); null when it can't run. The bin comes from env/our constants, never user input. */
const version = (bin: string) => new Promise<string | null>((resolve) => {
  exec(`"${bin}" --version`, { timeout: 5000, windowsHide: true }, (err, out) => resolve(err ? null : out.trim().split(/\r?\n/)[0].slice(0, 80) || null));
});

/** A check that throws becomes "fail", one that hangs becomes "warn"; neither holds up the report. */
function guard(id: string, label: string, run: () => Promise<Check | Check[]>, ms = 8000): Promise<Check | Check[]> {
  let t: NodeJS.Timeout | undefined;
  const late = new Promise<Check>((r) => { t = setTimeout(() => r(check(id, label, "warn", `Didn't answer within ${ms / 1000} s`, "Try again in a minute; if it stays slow, restart ORBIT.")), ms); });
  const real = run().catch((e) => check(id, label, "fail", `The check itself failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 150)}`, "Restart ORBIT and run the check again."));
  return Promise.race([real, late]).finally(() => clearTimeout(t));
}

const H = 3_600_000;

async function claudeCheck(): Promise<Check> {
  const v = await cached("claude", () => version(CLAUDE_BIN), (x) => (x ? 10 * 60_000 : 60_000));
  return v ? check("claude", "Claude (the AI behind CORE)", "ok", `Claude Code ${v}`)
    : check("claude", "Claude (the AI behind CORE)", "fail", `Couldn't start "${path.basename(CLAUDE_BIN)}", so CORE, agents and clips can't think`,
      "Install Claude Code, open a terminal and run: claude (sign in once). Then restart ORBIT.");
}

async function supabaseCheck(sb: SupabaseClient): Promise<Check> {
  const { error } = await sb.from("memories").select("id", { head: true }).limit(1).abortSignal(AbortSignal.timeout(5000));
  // 42501 = permission denied: the database answered, the anon role (self-test at boot, no session) just can't read the table.
  return error && error.code !== "42501" ? check("supabase", "Database (Supabase)", "fail", "Couldn't reach the database",
    "Check your internet. If it lasts, open supabase.com: free projects pause after a week unused; click Restore project.")
    : check("supabase", "Database (Supabase)", "ok", "Reachable");
}

async function youtubeKeyCheck(): Promise<Check> {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  const L = "YouTube API key";
  if (!key) return check("ytkey", L, "warn", "Not set: STUDIO stats and the Video Scout are off", "Add YOUTUBE_API_KEY to .env.local (Google Cloud → APIs & Services → Credentials), then restart ORBIT.");
  // 1 quota unit; api() already strips the key from its error text.
  const err = await cached("ytkey", () => withYoutubeBudget("doctor", "scout", () => api("i18nLanguages", { part: "snippet", hl: "en" }, key)).then(() => "", (e: Error) => e.message.slice(0, 160)), (e) => (e ? 5 * 60_000 : H));
  if (!err) return check("ytkey", L, "ok", "Works");
  if (/(?:share|reserve) is used up/.test(err)) return check("ytkey", L, "warn", err, "ORBIT's local budget resets at midnight Pacific; this is not a rejected API key.");
  return /quota/i.test(err) ? check("ytkey", L, "warn", "Google's daily limit for this key is used up", "Nothing to fix: it resets at midnight Pacific time.")
    : check("ytkey", L, "fail", `Google refused it (${err})`, "Check YOUTUBE_API_KEY in .env.local and that \"YouTube Data API v3\" is enabled for it in Google Cloud, then restart ORBIT.");
}

async function scoutQuotaCheck(): Promise<Check> {
  const v = await scoutView();
  return quotaCheck(v.budget, v.usedToday, `${quotaSummary(v.quota)}. Shares left: ${Object.entries(v.quota.shares).map(([k, x]) => `${k} ${x.left}`).join(", ")}. ORBIT budget weights; Google search/upload buckets are separate.`);
}

async function oauthCheck(): Promise<Check> {
  const L = "YouTube channel connection";
  const s = await readStored();
  const connect = "Open STUDIO → Stats and click Connect YouTube.";
  if (wasExpired()) return check("oauth", L, "fail", "Google's sign-in expired, so stats and uploads stopped", connect);
  if (!s) return oauthEnv() ? check("oauth", L, "warn", "Not connected: no channel stats or uploads", connect)
    : check("oauth", L, "ok", "Not set up (optional)", "For channel stats and uploads, add YOUTUBE_OAUTH_CLIENT_ID and YOUTUBE_OAUTH_CLIENT_SECRET to .env.local.");
  if (!oauthEnv()) return check("oauth", L, "fail", `Connected to ${s.channelTitle || "your channel"}, but the Google client settings are missing`, "Add YOUTUBE_OAUTH_CLIENT_ID and YOUTUBE_OAUTH_CLIENT_SECRET back to .env.local, then restart ORBIT.");
  return hasScopes(s.scope, [YT_UPLOAD_SCOPE]) ? check("oauth", L, "ok", `Connected to ${s.channelTitle || "your channel"}; uploads allowed`)
    : check("oauth", L, "warn", `Connected to ${s.channelTitle || "your channel"}, but uploading isn't allowed`, "In STUDIO → Stats click Disconnect, then Connect again and tick the upload box.");
}

async function toolChecks(): Promise<Check[]> {
  const t = await checkTools();
  const model = process.env.ORBIT_WHISPER_MODEL || "onnx-community/whisper-base_timestamped"; // same default as factory.ts
  const [ver, downloads, haveModel, hf] = await Promise.all([
    t.ytdlp ? cached("ytdlp", () => version(process.env.ORBIT_YTDLP || "yt-dlp"), () => 10 * 60_000) : null,
    listDownloads().catch(() => []),
    exists(path.join(studioRoot(), "models", model)),
    hyperframesCli(),
  ]);
  return [
    t.ffmpeg ? check("ffmpeg", "Video tool (ffmpeg)", "ok", "Found")
      : check("ffmpeg", "Video tool (ffmpeg)", "fail", "Not found, so clips can't be cut or rendered", "In the ORBIT folder run: npm install. Or set ORBIT_FFMPEG in .env.local to the full path of ffmpeg.exe."),
    ytdlpCheck(t.ytdlp, ver, youtubePauseUntil(downloads, "https://www.youtube.com/"), Date.now()),
    !t.transcriber ? check("whisper", "Speech-to-text (Whisper)", "fail", "The transcriber library is missing, so clips get no captions", "In the ORBIT folder run: npm install")
      : haveModel ? check("whisper", "Speech-to-text (Whisper)", "ok", `Model ${model.split("/").pop()} downloaded`)
      : check("whisper", "Speech-to-text (Whisper)", "warn", "Model not downloaded yet", "Nothing to do: it downloads by itself (about 200 MB) on the first clip job. Keep the internet on."),
    // Optional, so never a warning: Shorts render fine (plain captions) without it.
    hf ? check("hyperframes", "Hyperframes (optional)", "ok", "Installed: Shorts get animated captions, hook card and pop-ups")
      : check("hyperframes", "Hyperframes (optional)", "ok", "Not installed: Shorts use the plain burned captions", `In the ORBIT folder run: ${HF_INSTALL}`),
  ];
}

export async function disk(): Promise<Check> {
  const dir = (await exists(studioRoot())) ? studioRoot() : root();
  const s = await statfs(dir);
  return diskCheck(s.bavail * s.bsize, WIN ? `drive ${path.parse(dir).root.replace(/\\$/, "")}` : dir);
}

async function build(): Promise<Check> {
  const failed = await exists(path.join(root(), ".next-build", "BUILD_FAILED")); // written by scripts/launch.ps1
  return buildCheck(failed, failed ? await tail(path.join(root(), "orbit-build.log")) : "", process.env.NODE_ENV === "production");
}

async function night(): Promise<Check> {
  const s = await stat(path.join(root(), "orbit-night.log")).catch(() => null);
  return nightCheck(s ? s.mtimeMs : null, Date.now());
}

async function wake(): Promise<Check> {
  const L = "Voice wake-up (\"Orbital wake up\")";
  const lnk = path.join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "ORBIT wake.lnk");
  if (!(await exists(lnk))) return check("wake", L, "ok", "Not installed (optional)", "To wake ORBIT by voice, run: npm run wake:install");
  const last = (await tail(path.join(process.env.LOCALAPPDATA ?? "", "orbit-wake", "wake.log"), 2000)).trim().split(/\r?\n/).pop() ?? "";
  return /ERROR/.test(last) ? check("wake", L, "warn", `Installed, but its last log line is an error: ${last.slice(0, 160)}`, "Run: npm run wake:install (restarts the listener). Details are in %LOCALAPPDATA%\\orbit-wake\\wake.log")
    : check("wake", L, "ok", "Installed");
}

async function life(): Promise<Check> {
  const f = path.join(path.dirname(vaultDir()), "life.json"); // life.ts and vault.ts share the ORBIT data dir
  try { JSON.parse(await readFile(f, "utf8")); return lifeCheck("ok"); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return lifeCheck("missing");
    return lifeCheck("bad", e instanceof SyntaxError ? "broken JSON" : (e as NodeJS.ErrnoException).code ?? "unreadable");
  }
}

async function vault(): Promise<Check> {
  const dir = vaultDir();
  if (!(await exists(dir))) return vaultCheck(false, true, 0, 0, MAX_TOTAL, MAX_FILES); // checked first: usage() would create the folder
  // access(W_OK) ignores folder permissions on Windows, so really write (and remove) a tiny probe file.
  const probe = path.join(dir, ".doctor-probe");
  const writable = await writeFile(probe, "").then(() => unlink(probe).then(() => true, () => true), () => false);
  const u = await usage();
  return vaultCheck(true, writable, u.bytes, u.count, MAX_TOTAL, MAX_FILES);
}

async function facts(sb: SupabaseClient): Promise<Check> {
  const { error } = await sb.from("memory_facts").select("id", { head: true }).limit(1).abortSignal(AbortSignal.timeout(5000));
  return factsCheck(isMissingTable(error), error ? error.message || "unknown error" : null);
}

const ENV_REQUIRED = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
const ENV_OPTIONAL = {
  YOUTUBE_API_KEY: "STUDIO stats and scout", YOUTUBE_CHANNEL: "your channel in STUDIO", YOUTUBE_OAUTH_CLIENT_ID: "channel connection",
  YOUTUBE_OAUTH_CLIENT_SECRET: "channel connection", SUPABASE_SECRET_KEY: "briefings while the browser is closed",
};

const git = (...args: string[]) => new Promise<string | null>((r) => execFile("git", args, { cwd: root(), timeout: 4000, windowsHide: true }, (e, out) => r(e ? null : out.trim())));

// Running = stamped into this build by next.config; checkout and origin/main are local git refs (no network fetch).
async function runningVersion(): Promise<Check> {
  const [head, main, status] = await Promise.all([git("rev-parse", "HEAD"), git("rev-parse", "origin/main"), git("status", "--porcelain", "--untracked-files=no")]);
  return versionCheck({ running: process.env.ORBIT_BUILD_COMMIT || "unknown", builtAt: process.env.ORBIT_BUILD_TIME || "unknown", head, main, dirty: status === null ? null : status !== "" }, process.env);
}

// Read-only probes (migration-guard): a "does not exist" error means that migration is missing.
async function migrations(sb: SupabaseClient): Promise<Check> {
  const files = await readdir(path.join(root(), "supabase", "migrations")).catch(() => [] as string[]);
  const applied = await (await import("./migration-guard")).probeMarkers(sb);
  return migrationCheck(files, applied);
}

/** All checks in parallel; worst case ~8 s (each guard's timeout). */
export async function runDoctor(sb: SupabaseClient): Promise<Report> {
  const t0 = Date.now();
  const results = await Promise.all([
    guard("claude", "Claude (the AI behind CORE)", claudeCheck),
    Promise.resolve(modelCheck(MODEL, SMART_MODEL, FAST_MODEL, DEEP_MODEL, process.env.ORBIT_DEEP_EFFORT ?? "")),
    guard("supabase", "Database (Supabase)", () => supabaseCheck(sb)),
    guard("ytkey", "YouTube API key", youtubeKeyCheck),
    guard("quota", "YouTube scout budget", scoutQuotaCheck),
    guard("oauth", "YouTube channel connection", oauthCheck),
    guard("tools", "Clip tools (ffmpeg, yt-dlp, Whisper)", toolChecks),
    guard("disk", "Free disk space", disk),
    guard("build", "Last update build", build),
    guard("version", "Running version", runningVersion),
    guard("migrations", "Database migrations", () => migrations(sb)),
    guard("launcher", "Server stability", async () => launcherCheck(await tail(path.join(root(), "orbit-launcher.log"), 50_000), new Date())),
    guard("night", "Overnight run", night),
    guard("life", "LIFE data (habits, reminders)", life),
    guard("vault", "VAULT (your files)", vault),
    guard("facts", "Belief memory", () => facts(sb)),
    guard("durable", "Saved state & events", async () => { const d = await import("./durable.ts"); return { id: "durable", label: "Saved state & events", ...(await import("./durable-pure.ts")).durableCheck(d.writeFailures(), d.deadEvents()) }; }),
    guard("drill", "Last recovery drill", async () => import("./drill-pure.ts").then(async (m) => m.drillCheck(await import("./drill.ts").then((d) => d.lastDrill()), Date.now()))),
    Promise.resolve(latencyCheck(coreTurns)),
    ...(WIN ? [guard("wake", "Voice wake-up", wake)] : []),
    Promise.resolve(envCheck(process.env, ENV_REQUIRED, ENV_OPTIONAL)),
    // Matters most once ORBIT is reachable from a phone (docs/PHONE.md): without it any account in the Supabase project gets in.
    Promise.resolve((process.env.ORBIT_ALLOWED_EMAILS ?? "").trim()
      ? check("allow", "Who can sign in", "ok", "Only the emails in ORBIT_ALLOWED_EMAILS")
      : check("allow", "Who can sign in", "warn", "ORBIT_ALLOWED_EMAILS is empty, so any account in your Supabase project can use ORBIT", "Add ORBIT_ALLOWED_EMAILS=your@email to .env.local and restart ORBIT")),
  ]);
  const r = summarize(results.flat(), Date.now() - t0);
  rememberChecks(r.checks); // capability check (capability.ts) reads these instead of probing again
  return r;
}
