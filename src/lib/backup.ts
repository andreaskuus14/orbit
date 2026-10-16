import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MEMORY_COLUMNS } from "./memory";

// Full export of one user's data. Used by /api/export (session client, RLS) and the weekly local backup
// (secret-key client, no RLS), so every query also filters by the owner column.

const PAGE = 1000; // PostgREST's default max rows per request
export const FILE_URL_TTL = 60 * 60; // signed file links last 1 hour

// Every user-owned table (supabase/migrations): [table, columns, stable order column for paging, owner column]
const TABLES: [string, string, string, string][] = [
  ["profiles", "*", "id", "id"],
  ["memories", MEMORY_COLUMNS, "id", "user_id"], // not "*": skips the embedding vector and full-text index
  ["memory_links", "*", "id", "user_id"],
  ["conversations", "*", "id", "user_id"],
  ["messages", "*", "id", "user_id"],
  ["tasks", "*", "id", "user_id"], // includes trace and pending (actions awaiting approval)
  ["proposals", "*", "id", "user_id"],
  ["core_playbook", "*", "user_id", "user_id"],
  ["automations", "*", "id", "user_id"],
  ["agents", "*", "id", "user_id"],
  ["projects", "*", "id", "user_id"],
  ["feeds", "*", "id", "user_id"],
  ["articles", "*", "id", "user_id"],
  ["briefings", "*", "id", "user_id"],
  ["game_saves", "*", "game", "user_id"],
  ["events", "*", "id", "user_id"],
  ["usage", "*", "id", "user_id"],
  ["job_runs", "*", "id", "user_id"],
  ["memory_facts", "*", "id", "user_id"], // migration 0008 (skipped until it is applied)
];

// Table not created yet (migration not applied): skip it instead of failing the whole export.
const isMissingTable = (e: { code?: string; message?: string }) =>
  e.code === "PGRST205" || e.code === "42P01" || /does not exist|schema cache/i.test(e.message ?? "");

type FileItem = { memory_id: string; title: string; storage_path: string; url?: string | null; error?: string };

/** Everything ORBIT stores about a user. signFiles adds 1-hour download links for the original uploads. */
export async function buildExport(sb: SupabaseClient, user: { id: string; email?: string }, signFiles: boolean) {
  const tables: Record<string, unknown[]> = {};
  const missing: string[] = [];
  for (const [name, cols, order, owner] of TABLES) {
    const rows: unknown[] = [];
    let skip = false;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from(name).select(cols).eq(owner, user.id).order(order).range(from, from + PAGE - 1);
      if (error) {
        if (isMissingTable(error)) { missing.push(name); skip = true; break; }
        throw new Error(`${name}: ${error.message}`);
      }
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    if (!skip) tables[name] = rows;
  }

  // Original uploads live in the private 'vault' bucket; linked, not inlined.
  const withFiles = ((tables.memories ?? []) as { id: string; title: string; storage_path: string | null }[]).filter((m) => m.storage_path);
  const files: FileItem[] = withFiles.map((m) => ({ memory_id: m.id, title: m.title, storage_path: m.storage_path! }));
  if (signFiles) {
    for (let i = 0; i < files.length; i += 100) {
      const chunk = files.slice(i, i + 100);
      const { data, error } = await sb.storage.from("vault").createSignedUrls(chunk.map((f) => f.storage_path), FILE_URL_TTL);
      chunk.forEach((f, j) => {
        f.url = data?.[j]?.signedUrl ?? null;
        const err = error?.message ?? data?.[j]?.error;
        if (err) f.error = err;
      });
    }
  }

  const now = new Date();
  return {
    version: 2,
    exported_at: now.toISOString(),
    user: { id: user.id, email: user.email ?? null },
    tables,
    missing_tables: missing,
    local: { life: await import("./life").then((m) => m.exportLife()).catch((e) => ({ error: `life.json could not be read: ${e instanceof Error ? e.message : e}` })) }, // LIFE lives in a local file, not Supabase
    files: {
      note: signFiles
        ? `Original uploaded files are not inside this JSON. Each url downloads one file and expires at ${new Date(now.getTime() + FILE_URL_TTL * 1000).toISOString()}; export again for fresh links.`
        : "Original uploaded files are copied next to this backup, in files/<storage_path>. VAULT planet files stay on this PC (ORBIT data folder\\vault) and are not included.",
      items: files,
    },
  };
}

// ---- Weekly local backup (run by the server-side scheduler) ----

const KEEP = 8;
const EVERY_MS = 7 * 86400_000;
const RETRY_MS = 6 * 3600_000; // after a failure, don't retry every minute
const g = globalThis as unknown as { __orbitBackupTried?: number };

export const backupDir = () => path.resolve(process.env.ORBIT_BACKUP_DIR || path.join(process.cwd(), "..", "orbit-backups"));

async function newestBackupMs(dir: string): Promise<number> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => /^orbit-\d{4}-\d{2}-\d{2}.*\.json$/.test(n));
  let newest = 0;
  for (const n of names) newest = Math.max(newest, (await stat(path.join(dir, n))).mtimeMs);
  return newest;
}

/** Writes orbit-YYYY-MM-DD.json and mirrors new/changed vault files when the last backup is a week old. */
export async function maybeBackup(sb: SupabaseClient, userIds: string[]) {
  if (!userIds.length) return; // empty/reset project: never let the pruning below delete every backup
  const dir = backupDir();
  if (Date.now() - (await newestBackupMs(dir)) < EVERY_MS) return;
  if (g.__orbitBackupTried && Date.now() - g.__orbitBackupTried < RETRY_MS) return;
  g.__orbitBackupTried = Date.now();
  await mkdir(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  for (const id of userIds) {
    const { data } = await sb.auth.admin.getUserById(id).catch(() => ({ data: null }));
    const exp = await buildExport(sb, { id, email: data?.user?.email }, false);
    const copied = await mirrorFiles(sb, id, exp.files.items, path.join(dir, "files"));
    const name = `orbit-${day}${userIds.length > 1 ? "-" + id.slice(0, 8) : ""}.json`;
    await writeFile(path.join(dir, name + ".tmp"), JSON.stringify(exp, null, 2));
    await rename(path.join(dir, name + ".tmp"), path.join(dir, name)); // never leave a half-written backup
    console.log(`[orbit] backup written: ${path.join(dir, name)} (${copied} new file(s) copied)`);
  }
  // Keep the newest KEEP exports (names sort by date). shortcut: files/ is never pruned, so deleted uploads stay in it.
  const all = (await readdir(dir)).filter((n) => /^orbit-\d{4}-\d{2}-\d{2}.*\.json$/.test(n)).sort();
  for (const n of all.slice(0, Math.max(0, all.length - Math.max(KEEP, KEEP * userIds.length)))) await rm(path.join(dir, n), { force: true });
}

/** Downloads vault files not already backed up (same path and size). Returns how many were copied. */
async function mirrorFiles(sb: SupabaseClient, userId: string, items: FileItem[], filesDir: string): Promise<number> {
  const vault = sb.storage.from("vault");
  const sizes = new Map<string, number>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await vault.list(userId, { limit: 1000, offset });
    if (error) throw new Error(`vault list: ${error.message}`);
    for (const o of data ?? []) sizes.set(`${userId}/${o.name}`, Number(o.metadata?.size ?? -1));
    if (!data || data.length < 1000) break;
  }
  let copied = 0;
  for (const { storage_path } of items) {
    if (!storage_path.startsWith(`${userId}/`)) continue; // secret-key client bypasses RLS: only this user's own files
    const dest = path.resolve(filesDir, storage_path);
    if (!dest.startsWith(path.resolve(filesDir) + path.sep)) continue; // never write outside the backup folder
    const have = await stat(dest).then((s) => s.size, () => -1);
    if (have >= 0 && have === sizes.get(storage_path)) continue;
    const { data, error } = await vault.download(storage_path); // files are capped at 4 MB by the bucket
    if (error || !data) { console.error(`[orbit] backup: couldn't download ${storage_path}: ${error?.message}`); continue; }
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest + ".tmp", Buffer.from(await data.arrayBuffer()));
    await rename(dest + ".tmp", dest);
    copied++;
  }
  return copied;
}
