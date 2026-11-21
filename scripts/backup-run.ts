// ORBIT's nightly encrypted backup (restic). Set up by tools\backup\setup.ps1, run nightly by Task Scheduler (tools\backup\backup.ps1).
//   node --experimental-strip-types scripts/backup-run.ts run                         back up now (Supabase export + local folders)
//   node --experimental-strip-types scripts/backup-run.ts snapshots                   list snapshots
//   node --experimental-strip-types scripts/backup-run.ts restore [--snapshot latest] --target <empty folder>
//   node --experimental-strip-types scripts/backup-run.ts status                      last result
//   node --experimental-strip-types scripts/backup-run.ts setup --repo <folder> [--keep 14] [--cloud remote:path] [--bin restic.exe]
//       (used by setup.ps1) writes backup.json and makes the restic password file once
//   node --experimental-strip-types scripts/backup-run.ts paths                       data/studio/key paths as JSON (for setup.ps1)
// The restic repo is encrypted with the password in <data dir>\keys\restic.pass (never in the repo, never in Supabase).
// Nothing goes to the cloud unless backup.json has "cloud": "<rclone remote>:<path>", which only the owner sets.
// Journal text is already encrypted inside these files (journal-crypt-pure.ts); no model is called here.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { orbitDataDir } from "../src/lib/data-dir.ts";
import { TABLES } from "../src/lib/backup-tables-pure.ts";
import {
  CONFIG_NAME, PASS_NAME, STATUS_NAME, backupArgs, defaultConfig, cloudCopy, configErrors, forgetArgs, resticEnv, restoreArgs, snapshotFromJson, snapshotsArgs,
  type BackupConfig, type BackupStatus,
} from "../src/lib/restic-pure.ts";

try { process.loadEnvFile(".env.local"); } catch { /* no .env.local */ }
const args = process.argv.slice(2), cmd = args[0] ?? "run", arg = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const dataDir = orbitDataDir();
const cfgFile = path.join(dataDir, CONFIG_NAME), statusFile = path.join(dataDir, STATUS_NAME);
const passFile = path.resolve(process.env.ORBIT_RESTIC_PASSWORD_FILE?.trim() || path.join(dataDir, "keys", PASS_NAME));
const die = (m: string): never => { console.error(`✖ ${m}`); process.exit(1); };
const studioDir = path.resolve(process.env.ORBIT_STUDIO_DIR || path.join(process.cwd(), "..", "orbit-studio")); // = clips/factory.ts studioRoot

function restic(c: BackupConfig, a: string[], env: Record<string, string> = resticEnv(c.repo, passFile), inherit = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(c.bin || process.env.ORBIT_RESTIC || "restic", a, { env: { ...process.env, ...env }, windowsHide: true, stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout?.on("data", (d) => { out += d; });
    p.stderr?.on("data", (d) => { err += d; });
    p.on("error", reject);
    // restic exit 3 = snapshot made but some files couldn't be read (locked by another app): still a backup, reported as a warning.
    p.on("close", (code) => (code === 0 || (code === 3 && a[0] === "backup") ? resolve(out) : reject(new Error(`restic ${a[0]} exited ${code}: ${err.trim().split(/\r?\n/).slice(-2).join(" ").slice(0, 300)}`))));
  });
}

/** Every ORBIT table for the allowed users, one JSON file each, into dir (journal rows are already ciphertext). */
async function exportSupabase(dir: string): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) { console.warn("! No SUPABASE_SECRET_KEY in .env.local: backing up local files only"); return 0; }
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const allowed = (process.env.ORBIT_ALLOWED_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const { data, error } = await sb.auth.admin.listUsers({ perPage: 100 });
  if (error) throw new Error(`Supabase users: ${error.message}`);
  const users = data.users.filter((u) => !allowed.length || allowed.includes((u.email ?? "").toLowerCase()));
  for (const u of users) {
    const tables: Record<string, unknown[]> = {}, missing: string[] = [];
    for (const [name, cols, order, owner] of TABLES) {
      const rows: unknown[] = [];
      for (let from = 0; ; from += 1000) {
        const r = await sb.from(name).select(cols).eq(owner, u.id).order(order).range(from, from + 999);
        if (r.error) { if (/does not exist|schema cache|PGRST205|42P01/.test(`${r.error.code} ${r.error.message}`)) { missing.push(name); break; } throw new Error(`${name}: ${r.error.message}`); }
        rows.push(...(r.data ?? []));
        if (!r.data || r.data.length < 1000) break;
      }
      if (!missing.includes(name)) tables[name] = rows;
    }
    await writeFile(path.join(dir, `supabase-${u.id}.json`), JSON.stringify({ version: 2, exported_at: new Date().toISOString(), user: { id: u.id }, tables, missing_tables: missing }));
  }
  return users.length;
}

async function loadCfg(): Promise<BackupConfig> {
  const c = JSON.parse(await readFile(cfgFile, "utf8").catch(() => "null")) as BackupConfig | null;
  const e = configErrors(c);
  if (e.length) die(`${cfgFile}: ${e.join("; ")}`);
  return c!;
}
async function writeStatus(s: BackupStatus) {
  await writeFile(statusFile + ".tmp", JSON.stringify(s, null, 2));
  await rename(statusFile + ".tmp", statusFile);
}
const readStatus = async (): Promise<BackupStatus | null> => JSON.parse(await readFile(statusFile, "utf8").catch(() => "null"));

async function run() {
  const c = await loadCfg(), prev = await readStatus(), at = new Date().toISOString();
  const stage = path.join(os.tmpdir(), "orbit-backup-supabase");
  try {
    await rm(stage, { recursive: true, force: true });
    await mkdir(stage, { recursive: true });
    const users = await exportSupabase(stage);
    const out = await restic(c, backupArgs(c, users ? [stage] : []));
    const snapshot = snapshotFromJson(out) ?? undefined;
    await restic(c, forgetArgs(c));
    let cloud: BackupStatus["cloud"] = "off";
    const cc = cloudCopy(c, passFile);
    if (cc) cloud = await restic(c, cc.args, cc.env).then(() => "ok" as const, (e) => { console.error(`! cloud copy failed: ${e.message}`); return "failed" as const; });
    await writeStatus({ lastRun: at, ok: true, lastOk: at, snapshot, cloud });
    console.log(`✔ ${at} backup ${snapshot ?? ""} done (${users} Supabase user export(s)); cloud: ${cloud}`);
  } catch (e) {
    await writeStatus({ ...(prev ?? {}), lastRun: at, ok: false, error: e instanceof Error ? e.message : String(e) });
    die(`${at} backup failed: ${e instanceof Error ? e.message : e}`);
  } finally {
    await rm(stage, { recursive: true, force: true }); // the plain export only ever lives in temp during the run
  }
}

async function restore() {
  const c = await loadCfg(), target = arg("--target");
  if (!target) die("--target <empty folder> is required (restores never overwrite the live ORBIT folders)");
  const t = path.resolve(target!);
  if ((await readdir(t).catch(() => [])).length) die(`${t} is not empty: pick an empty or new folder`);
  const a = restoreArgs(c, arg("--snapshot") ?? "latest", t);
  if ("error" in a) die(a.error);
  await restic(c, a as string[], undefined, true);
  console.log(`✔ Restored into ${t}. Look at the files, stop ORBIT, then copy back what you need (the journal key is not in backups: keep your recovery key).`);
}

async function setup() {
  const repo = arg("--repo"), keep = Number(arg("--keep") ?? 14), cloud = arg("--cloud") ?? null, bin = arg("--bin");
  if (!repo) die("--repo <folder> is required");
  const prev = JSON.parse(await readFile(cfgFile, "utf8").catch(() => "null")) as BackupConfig | null;
  const c: BackupConfig = { ...defaultConfig({ dataDir, studioDir, repo: path.resolve(repo!), keepDaily: keep }), ...(prev ? { excludes: prev.excludes, paths: prev.paths } : {}), cloud, ...(bin ? { bin } : {}) };
  const e = configErrors(c);
  if (e.length) die(e.join("; "));
  await mkdir(dataDir, { recursive: true });
  await writeFile(cfgFile + ".tmp", JSON.stringify(c, null, 2));
  await rename(cfgFile + ".tmp", cfgFile);
  let made = false;
  if (!(await readFile(passFile, "utf8").catch(() => ""))) {
    await mkdir(path.dirname(passFile), { recursive: true, mode: 0o700 });
    await writeFile(passFile, randomBytes(24).toString("base64url") + "\n", { mode: 0o600, flag: "wx" });
    made = true;
  }
  console.log(JSON.stringify({ config: cfgFile, passFile, newPassword: made ? (await readFile(passFile, "utf8")).trim() : null }));
}

if (cmd === "run") await run();
else if (cmd === "setup") await setup();
else if (cmd === "paths") console.log(JSON.stringify({ dataDir, studioDir, passFile, config: cfgFile, keys: path.join(dataDir, "keys") }));
else if (cmd === "restore") await restore();
else if (cmd === "snapshots") { const c = await loadCfg(); await restic(c, snapshotsArgs(), undefined, true); }
else if (cmd === "status") console.log(JSON.stringify(await readStatus(), null, 2) ?? "no backup has run yet");
else die(`Unknown command ${cmd}: run, restore, snapshots or status`);
