// Nightly encrypted backups of ORBIT's own data with restic (BSD-2): the local data dir (life.json, VAULT, CRM, ...), the STUDIO
// folder's state files and a Supabase export of ORBIT's tables. Local repo by default; a cloud copy (restic's rclone backend,
// rclone is MIT) only when the owner put a remote in backup.json himself. Command lines are built here (tested in
// tests/restic.test.ts); scripts/backup-run.ts runs them; tools/backup/setup.ps1 sets everything up.
import path from "node:path";
import { check, type Check } from "./doctor-pure.ts";

export const CONFIG_NAME = "backup.json", STATUS_NAME = "backup-status.json", PASS_NAME = "restic.pass";
export type Keep = { daily: number; weekly: number; monthly: number };
export type BackupConfig = { repo: string; keep: Keep; cloud: string | null; paths: string[]; excludes: string[]; bin?: string };
export type BackupStatus = { lastRun: string; ok: boolean; lastOk?: string; snapshot?: string; error?: string; cloud?: "ok" | "failed" | "off" };

/** Never in a backup: secrets (.env files, the journal key and the restic password live in <data dir>/keys), temp files, and
 *  STUDIO's heavy re-creatable media (models, renders, downloads). */
export const BASE_EXCLUDES = [
  ".env", ".env.*", "keys", "*.tmp", "node_modules", ".next", "cache", ".cache",
  "*.mp4", "*.mov", "*.mkv", "*.webm", "*.wav", "*.mp3", "*.safetensors", "*.gguf", "*.ckpt", "*.onnx",
];

/** STUDIO subfolders that are big and can be made again (renders, downloads, models); its JSON state files are kept. */
export const STUDIO_HEAVY = ["models", "music", "tracks", "clips", "downloads", "jobs", "longform", "higgsfield", "inbox"];
export function defaultConfig(o: { dataDir: string; studioDir: string; repo: string; keepDaily?: number }): BackupConfig {
  return { repo: o.repo, keep: { daily: o.keepDaily ?? 14, weekly: 8, monthly: 12 }, cloud: null, paths: [o.dataDir, o.studioDir], excludes: STUDIO_HEAVY.map((d) => path.join(o.studioDir, d)) };
}

/** Problems with a config (empty = usable). */
export function configErrors(c: Partial<BackupConfig> | null): string[] {
  if (!c || typeof c !== "object") return ["backup.json is missing or not JSON: run tools\\backup\\setup.ps1"];
  const e: string[] = [];
  if (typeof c.repo !== "string" || !c.repo.trim()) e.push("repo is empty");
  if (!Array.isArray(c.paths) || !c.paths.length || c.paths.some((p) => typeof p !== "string" || !p.trim())) e.push("paths must list at least one folder");
  const k = c.keep;
  if (!k || ![k.daily, k.weekly, k.monthly].every((n) => Number.isInteger(n) && n >= 0) || k.daily + k.weekly + k.monthly < 1) e.push("keep needs whole numbers and at least one snapshot kept");
  if (c.cloud != null && (typeof c.cloud !== "string" || !/^[\w.-]+:.+/.test(c.cloud))) e.push('cloud must be an rclone "remote:path" or null');
  return e;
}

/** Environment for every restic call: repo + password file (never the password on a command line). */
export const resticEnv = (repo: string, passFile: string) => ({ RESTIC_REPOSITORY: repo, RESTIC_PASSWORD_FILE: passFile });

const inside = (child: string, parent: string) => { const r = path.relative(path.resolve(parent), path.resolve(child)); return r === "" || (!!r && !r.startsWith("..") && !path.isAbsolute(r)); };

export function backupArgs(c: BackupConfig, extraPaths: string[] = []): string[] {
  const ex = [...BASE_EXCLUDES, ...c.excludes];
  // A repo inside a backed-up folder would back itself up: exclude it.
  if (c.paths.some((p) => inside(c.repo, p))) ex.push(path.resolve(c.repo));
  return ["backup", "--json", "--tag", "orbit", "--exclude-caches", ...ex.flatMap((x) => ["--exclude", x]), ...c.paths, ...extraPaths];
}
export const forgetArgs = (c: BackupConfig) =>
  ["forget", "--tag", "orbit", "--keep-daily", String(c.keep.daily), "--keep-weekly", String(c.keep.weekly), "--keep-monthly", String(c.keep.monthly), "--prune"];
export const checkArgs = () => ["check"];
export const snapshotsArgs = () => ["snapshots", "--tag", "orbit"];

/** Restore into a NEW folder only: never over the live data (copy files back by hand after looking at them). */
export function restoreArgs(c: BackupConfig, snapshot: string, target: string): string[] | { error: string } {
  if (!/^(latest|[0-9a-f]{8,64})$/.test(snapshot)) return { error: "snapshot must be latest or a snapshot id" };
  if (c.paths.some((p) => inside(target, p) || inside(p, target))) return { error: "Restore target overlaps the live ORBIT folders: pick an empty folder elsewhere" };
  return ["restore", snapshot, "--target", target];
}

/** Cloud copy only when the owner configured one: env + args for `restic copy` into rclone:<remote>, else null. */
export function cloudCopy(c: BackupConfig, passFile: string): { env: Record<string, string>; args: string[] } | null {
  if (!c.cloud) return null;
  return { env: resticEnv(`rclone:${c.cloud}`, passFile), args: ["copy", "--from-repo", c.repo, "--from-password-file", passFile, "--tag", "orbit"] };
}

/** The snapshot id from `restic backup --json` output (last summary line). */
export function snapshotFromJson(out: string): string | null {
  for (const line of out.trim().split(/\r?\n/).reverse()) {
    try { const j = JSON.parse(line); if (j?.message_type === "summary" && typeof j.snapshot_id === "string") return j.snapshot_id; } catch { /* progress line */ }
  }
  return null;
}

// ---- Doctor ----
const H = 3600_000;
export function backupCheck(configured: boolean, s: BackupStatus | null, now: number): Check {
  const L = "Encrypted backups (restic)";
  if (!configured) return check("backup", L, "warn", "Not set up: ORBIT's data has no nightly encrypted backup", "Run in the ORBIT folder: powershell -ExecutionPolicy Bypass -File tools\\backup\\setup.ps1");
  const last = s?.lastOk ? Date.parse(s.lastOk) : NaN;
  const age = Number.isFinite(last) ? Math.max(0, Math.round((now - last) / H)) : null;
  const ago = age === null ? "never" : age < 1 ? "less than an hour ago" : age < 48 ? `${age} h ago` : `${Math.round(age / 24)} days ago`;
  if (s && !s.ok) return check("backup", L, "fail", `Last run failed (${String(s.error ?? "unknown").slice(0, 120)}); last good backup ${ago}`, "See %LOCALAPPDATA%\\orbit\\backup.log, then run: npm run backup:run");
  if (age === null) return check("backup", L, "warn", "Set up, but no backup has finished yet", "Run: npm run backup:run");
  if (age > 36) return check("backup", L, "warn", `Last good backup ${ago}`, "Is the PC off at 03:20? Run: npm run backup:run  (Task Scheduler → \"ORBIT nightly backup\")");
  return check("backup", L, "ok", `Last good backup ${ago}${s?.cloud === "ok" ? ", cloud copy too" : ""}`);
}

export function journalCheck(keyId: string | null, plainDays: number, plainRows: number | null): Check {
  const L = "Journal encryption";
  if (!keyId) return check("journal", L, "warn", "No journal key on this PC: the journal is stored in plain text", "Run: powershell -ExecutionPolicy Bypass -File tools\\backup\\setup.ps1 (it makes the key and shows the recovery key)");
  const left = plainDays + (plainRows ?? 0);
  if (left) return check("journal", L, "warn", `Key ${keyId} is set, but ${left} journal entr${left === 1 ? "y is" : "ies are"} still plain text`, "Stop ORBIT, then run: npm run journal:encrypt");
  return check("journal", L, "ok", `Encrypted with key ${keyId}${plainRows === null ? " (Supabase rows not checked)" : ""}`);
}
