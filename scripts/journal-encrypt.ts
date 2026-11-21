// One-time journal encryption (and its rollback). Run from the ORBIT folder with ORBIT stopped (npm run app:stop):
//   node --experimental-strip-types scripts/journal-encrypt.ts            encrypt (backup first, verify, then replace plain text)
//   node --experimental-strip-types scripts/journal-encrypt.ts --check    "no plain-text journal left?" (exit 1 if some is)
//   node --experimental-strip-types scripts/journal-encrypt.ts --rollback put plain text back (needs the key; backs up first)
//   node --experimental-strip-types scripts/journal-encrypt.ts --restore-backup <file.ojb>   write a backup's plain text back
// Flags: --local-only (life.json only, no Supabase), --force (run even though ORBIT answers on :3000).
// Idempotent: values already encrypted are skipped, so running it twice changes nothing the second time.
// Rules (tested): src/lib/journal-crypt-pure.ts. Nothing here calls a model or sends journal text anywhere but your own Supabase.
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "../src/lib/data-dir.ts";
import {
  BACKUP_AAD, keyId, lifeAad, open, parseKeyFile, plaintextLeft, planLife, planLifeOpen, planRows, planRowsOpen, seal, sealer, type JournalRow,
} from "../src/lib/journal-crypt-pure.ts";

try { process.loadEnvFile(".env.local"); } catch { /* no .env.local */ }
const args = process.argv.slice(2), has = (f: string) => args.includes(f), arg = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const die = (m: string): never => { console.error(`\n✖ ${m}`); process.exit(1); };

const dataDir = orbitDataDir();
const lifeFile = path.join(dataDir, "life.json");
const keyFile = path.resolve(process.env.ORBIT_JOURNAL_KEY_FILE?.trim() || path.join(dataDir, "keys", "journal.key"));
const backupDir = path.join(dataDir, "journal-backups");

async function atomicWrite(file: string, data: string, mode?: number) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file + ".tmp", data, mode ? { mode } : undefined);
  await rename(file + ".tmp", file);
}
async function readLife(): Promise<Record<string, unknown> | null> {
  try { return JSON.parse(await readFile(lifeFile, "utf8")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error(`life.json can't be read (${(e as Error).message}): fix it before encrypting`); }
}
const journalOf = (life: Record<string, unknown> | null) => (life?.journal && typeof life.journal === "object" ? life.journal as Record<string, string> : {});

function admin(): SupabaseClient | null {
  if (has("--local-only")) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, k = process.env.SUPABASE_SECRET_KEY;
  if (!url || !k) die("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be in .env.local (or pass --local-only for life.json alone)");
  return createClient(url!, k!, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function journalRows(sb: SupabaseClient | null): Promise<JournalRow[]> {
  if (!sb) return [];
  const rows: JournalRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("memories").select("id, user_id, kind, title, content").eq("kind", "journal").order("id").range(from, from + 999);
    if (error) die(`Supabase: ${error.message}`);
    rows.push(...((data ?? []) as JournalRow[]));
    if (!data || data.length < 1000) break;
  }
  const emb = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("memories").select("id").eq("kind", "journal").not("embedding", "is", null).order("id").range(from, from + 999);
    if (error) die(`Supabase: ${error.message}`);
    for (const r of data ?? []) emb.add(r.id as string);
    if (!data || data.length < 1000) break;
  }
  return rows.map((r) => ({ ...r, content: r.content ?? "", has_embedding: emb.has(r.id) }));
}

/** Encrypted copy of the journal exactly as it is now (plain or sealed), verified by opening it again. */
async function backup(key: Buffer, life: Record<string, string>, rows: JournalRow[], tag: string): Promise<string> {
  const payload = JSON.stringify({ version: 1, at: new Date().toISOString(), keyId: keyId(key), life, rows });
  const file = path.join(backupDir, `journal-${tag}-${new Date().toISOString().replace(/[:.]/g, "-")}.ojb`);
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  await atomicWrite(file, seal(key, payload, BACKUP_AAD) + "\n", 0o600);
  const back = open(key, (await readFile(file, "utf8")).trim(), BACKUP_AAD);
  if (back !== payload) die(`Backup ${file} didn't read back the same: stopping, nothing was changed`);
  return file;
}

async function oldExports(): Promise<{ name: string; text: string }[]> {
  const dirs = [path.resolve(process.env.ORBIT_BACKUP_DIR || path.join(process.cwd(), "..", "orbit-backups"))];
  const out: { name: string; text: string }[] = [];
  for (const d of dirs) for (const n of (await readdir(d).catch(() => [] as string[])).filter((x) => /^orbit-.*\.json$/.test(x))) {
    out.push({ name: path.join(d, n), text: await readFile(path.join(d, n), "utf8").catch(() => "") });
  }
  return out;
}

async function serverRunning() {
  try { await fetch("http://127.0.0.1:3000/", { signal: AbortSignal.timeout(1500) }); return true; } catch { return false; }
}

async function main() {
  const check = has("--check"), rollback = has("--rollback"), restore = arg("--restore-backup");
  let key: Buffer | null = null;
  try { key = parseKeyFile(await readFile(keyFile, "utf8")); } catch { /* missing */ }
  if (!key && !check) die(`No journal key at ${keyFile}. Run tools\\backup\\setup.ps1 first (it makes the key and shows your recovery key).`);
  if (!check && !has("--force") && await serverRunning()) die("ORBIT is running (port 3000 answers). Stop it first: npm run app:stop  (or pass --force)");

  const sb = admin();
  const life = await readLife();
  const rows = await journalRows(sb);

  if (check) {
    const issues = plaintextLeft({ life: journalOf(life), rows, files: await oldExports() });
    console.log(`Key: ${key ? `${keyFile} (id ${keyId(key)})` : `MISSING (${keyFile})`}`);
    console.log(`life.json: ${Object.keys(journalOf(life)).length} journal day(s); Supabase: ${sb ? `${rows.length} journal row(s)` : "skipped (--local-only)"}`);
    if (!issues.length) { console.log("✔ No plain-text journal left."); return; }
    for (const i of issues) console.log(`✖ ${i}`);
    const live = issues.filter((i) => i.startsWith("life.json") || i.startsWith("Supabase"));
    if (!live.length) console.log("Only older exports/backups hold plain text. They are yours to keep or delete; ORBIT never deletes them.");
    process.exit(live.length ? 1 : 0);
  }
  const k = key!, s = sealer(k);

  if (restore) {
    const b = JSON.parse(open(k, (await readFile(path.resolve(restore), "utf8")).trim(), BACKUP_AAD)) as { life: Record<string, string>; rows: JournalRow[] };
    const safety = await backup(k, journalOf(life), rows, "before-restore");
    console.log(`Current state backed up to ${safety}`);
    if (life) { life.journal = { ...journalOf(life), ...b.life }; await atomicWrite(lifeFile, JSON.stringify(life, null, 2)); }
    for (const r of sb ? b.rows : []) {
      const { error } = await sb!.from("memories").update({ title: r.title, content: r.content }).eq("id", r.id);
      if (error) console.error(`  row ${r.id}: ${error.message}`);
    }
    console.log(`✔ Restored ${Object.keys(b.life).length} day(s) and ${sb ? b.rows.length : 0} row(s) from ${restore}`);
    return;
  }

  const file = await backup(k, journalOf(life), rows, rollback ? "before-rollback" : "before-encrypt");
  console.log(`✔ Encrypted backup of the journal as it is now: ${file}`);

  if (rollback) {
    const days = planLifeOpen(journalOf(life), s), back = planRowsOpen(rows, s);
    if (life && Object.keys(days).length) { life.journal = { ...journalOf(life), ...days }; await atomicWrite(lifeFile, JSON.stringify(life, null, 2)); }
    for (const r of back) {
      const { error } = await sb!.from("memories").update({ title: r.title, content: r.content }).eq("id", r.id);
      if (error) console.error(`  row ${r.id}: ${error.message}`);
    }
    console.log(`✔ Rolled back: ${Object.keys(days).length} life.json day(s), ${back.length} Supabase row(s) are plain text again. Journal embeddings are not recreated.`);
    console.log("  New journal entries will be encrypted again while the key file exists: move the key file away to stop that.");
    return;
  }

  // Plan first: every sealed value is opened again and compared before anything is written (planLife / planRows throw otherwise).
  const days = planLife(journalOf(life), s), updates = planRows(rows, s);
  console.log(`Plan: ${Object.keys(days).length} life.json day(s) and ${updates.length} Supabase row(s) to encrypt (the rest already are).`);

  if (Object.keys(days).length) {
    const now = await readLife(); // fresh read: only days still holding exactly the text we planned from are replaced
    const j = journalOf(now);
    const done: string[] = [];
    for (const [d, v] of Object.entries(days)) if (j[d] === journalOf(life)[d]) { j[d] = v; done.push(d); }
    now!.journal = j;
    await atomicWrite(lifeFile, JSON.stringify(now, null, 2));
    const verify = journalOf(await readLife());
    for (const d of done) if (verify[d] !== days[d] || open(k, verify[d], lifeAad(d)) !== journalOf(life)[d]) die(`life.json ${d} didn't verify after writing; restore with --restore-backup ${file}`);
    console.log(`✔ life.json: ${done.length} day(s) encrypted and verified${done.length < Object.keys(days).length ? " (others changed meanwhile: run again)" : ""}`);
  }
  let ok = 0, skipped = 0;
  for (const u of updates) {
    const { data, error } = await sb!.from("memories").update({ title: u.title, content: u.content, embedding: null }).eq("id", u.id).eq("title", u.old.title).select("id, user_id, title, content");
    if (error) { console.error(`  row ${u.id}: ${error.message}`); skipped++; continue; }
    const r = data?.[0] as JournalRow | undefined;
    if (!r) { skipped++; continue; } // changed meanwhile: the next run picks it up
    const plain = planRowsOpen([{ ...r, kind: "journal" }], s)[0];
    if (!plain || plain.title !== u.old.title || plain.content !== (u.old.content ?? "")) die(`row ${u.id} didn't verify after writing; restore with --restore-backup ${file}`);
    ok++;
  }
  if (updates.length) console.log(`✔ Supabase: ${ok} row(s) encrypted and verified, embeddings removed${skipped ? `; ${skipped} skipped (run again)` : ""}`);

  const issues = plaintextLeft({ life: journalOf(await readLife()), rows: await journalRows(sb), files: await oldExports() });
  for (const i of issues) console.log(`! ${i}`);
  if (!issues.length) console.log("✔ No plain-text journal left.");
  console.log(`Rollback: node --experimental-strip-types scripts/journal-encrypt.ts --rollback   (or --restore-backup ${file})`);
  if (isDeepStrictEqual(days, {}) && !updates.length) console.log("Nothing to do: already encrypted.");
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
