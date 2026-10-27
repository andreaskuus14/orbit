import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir.ts";
import { CONFIG_FILE, EXT, capsuleName, diffManifests, makeKeyring, manifest, openCapsule, packFiles, parseName, pickFiles, readHeader, rotate, seal, unpackFiles,
  type Entry, type Keyring, type Kind, type PackedFile } from "./capsule-pure.ts";

// Time capsule (rules: capsule-pure.ts): encrypted backups of the local data dir into a folder the owner picks (external drive,
// OneDrive folder, ...). Local filesystem only: ORBIT uploads nothing. Run nightly by the night shift (night.ts "backup"),
// or by Profile → Time capsule → Back up now. Config: <data dir>/time-capsule.json (folder, size limit, keyring = verifier only).

type Last = { at: string; ok: boolean; bytes?: number; file?: string; error?: string };
type Config = { dir: string; maxMB: number; ring: Keyring; last?: Last };
const cfgFile = () => path.join(orbitDataDir(), CONFIG_FILE);
const g = globalThis as unknown as { __orbitCapsule?: Promise<unknown> };
/** One backup/restore at a time (the night run, the button and a restore never overlap). */
const serial = <T>(fn: () => Promise<T>): Promise<T> => { const p = (g.__orbitCapsule ?? Promise.resolve()).catch(() => {}).then(fn); g.__orbitCapsule = p; return p; };

async function loadCfg(): Promise<Config | null> {
  const j = JSON.parse(await readFile(cfgFile(), "utf8").catch(() => "null")) as Config | null;
  return j?.dir && j.ring?.wrapped ? j : null;
}
async function atomicWrite(file: string, data: string | Buffer) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file + ".tmp", data);
  await rename(file + ".tmp", file);
}
const saveCfg = (c: Config) => atomicWrite(cfgFile(), JSON.stringify(c, null, 2));

/** Every regular file under the data dir (symlinks skipped), except the backup folder if it sits inside it. */
async function walk(root: string, skip: string, rel = ""): Promise<Entry[]> {
  const out: Entry[] = [];
  for (const d of await readdir(path.join(root, rel), { withFileTypes: true }).catch(() => [])) {
    const r = rel ? `${rel}/${d.name}` : d.name, abs = path.join(root, r);
    if (path.resolve(abs) === skip) continue;
    if (d.isDirectory()) out.push(...(await walk(root, skip, r)));
    else if (d.isFile()) out.push({ path: r, size: (await stat(abs).catch(() => ({ size: Infinity }))).size });
  }
  return out;
}

async function currentFiles(maxMB: number, backupDir: string) {
  const root = orbitDataDir(), { keep, skipped } = pickFiles(await walk(root, path.resolve(backupDir)), maxMB * 1024 * 1024);
  const files: PackedFile[] = [];
  for (const e of keep) { const data = await readFile(path.join(root, e.path)).catch(() => null); if (data) files.push({ path: e.path, data }); } // vanished mid-walk: skip
  return { files, skipped };
}

async function writeCapsule(c: Config, kind: Kind) {
  const { files, skipped } = await currentFiles(c.maxMB, c.dir);
  const at = new Date(), bytes = files.reduce((n, f) => n + f.data.length, 0);
  const buf = seal(c.ring, packFiles(files), { at: at.toISOString(), kind, files: files.length, bytes });
  const name = capsuleName(kind, at);
  await atomicWrite(path.join(c.dir, name), buf); // never leaves a half-written backup
  for (const n of rotate(await readdir(c.dir))) await rm(path.join(c.dir, n), { force: true });
  return { name, bytes: buf.length, files: files.length, skipped: skipped.map((s) => s.path) };
}

/** True when set up and no nightly backup was written in the last 20 hours (the night planner asks). */
export async function backupDue(now = Date.now()) {
  const c = await loadCfg();
  return !!c && !(c.last?.ok && now - Date.parse(c.last.at) < 20 * 3_600_000);
}

/** One nightly backup now; records the result for Profile. Throws with a readable reason (e.g. the drive is unplugged). */
export const runBackup = () => serial(async () => {
  const c = await loadCfg();
  if (!c) throw new Error("Time capsule isn't set up (Profile → Time capsule)");
  try {
    if (!(await stat(c.dir).then((s) => s.isDirectory(), () => false))) throw new Error(`Backup folder not found: ${c.dir} (is the drive plugged in?)`);
    const r = await writeCapsule(c, "nightly");
    await saveCfg({ ...c, last: { at: new Date().toISOString(), ok: true, bytes: r.bytes, file: r.name } });
    return r;
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await saveCfg({ ...c, last: { at: new Date().toISOString(), ok: false, error } }).catch(() => {});
    throw new Error(error);
  }
});

// ---- Profile API ----------------------------------------------------------------

export async function capsuleView() {
  const c = await loadCfg();
  if (!c) return { configured: false as const };
  const backups: { name: string; at: string; kind: Kind; files: number; size: number }[] = [];
  for (const name of (await readdir(c.dir).catch(() => [] as string[])).filter((n) => n.endsWith(EXT) && parseName(n)).sort().reverse()) {
    const p = path.join(c.dir, name), size = (await stat(p)).size;
    const head = await readFile(p).then((b) => readHeader(b).header, () => null); // shortcut: reads whole files for the header; fine at a few MB each, stream if they grow large
    if (head) backups.push({ name, at: head.at, kind: head.kind, files: head.files, size });
  }
  return { configured: true as const, dir: c.dir, maxMB: c.maxMB, last: c.last ?? null, backups };
}

/** Setup (passphrase once) or change of folder/limit. The passphrase is only turned into a keyring; it's never written. */
export async function setupCapsule(b: Record<string, unknown>): Promise<string | null> {
  const dir = typeof b.dir === "string" ? b.dir.trim() : "", maxMB = Number(b.maxMB ?? 25);
  if (!dir || !path.isAbsolute(dir)) return "Pick a full folder path, e.g. E:\\ORBIT backups or C:\\Users\\you\\OneDrive\\ORBIT";
  if (!Number.isFinite(maxMB) || maxMB < 1 || maxMB > 2000) return "Size limit must be 1-2000 MB";
  if (!(await stat(dir).then((s) => s.isDirectory(), () => false))) return "That folder doesn't exist (create it first)";
  if (path.resolve(dir) === path.resolve(orbitDataDir())) return "Pick a folder outside ORBIT's data folder";
  const c = await loadCfg();
  if (c) { await saveCfg({ ...c, dir: path.resolve(dir), maxMB: Math.round(maxMB) }); return null; }
  if (typeof b.passphrase !== "string") return "Set a passphrase";
  try { await saveCfg({ dir: path.resolve(dir), maxMB: Math.round(maxMB), ring: makeKeyring(b.passphrase) }); } catch (e) { return e instanceof Error ? e.message : "Couldn't set up"; }
  return null;
}

async function openNamed(name: unknown, pass: unknown) {
  const c = await loadCfg();
  if (!c) throw new Error("Time capsule isn't set up");
  if (typeof name !== "string" || !parseName(name)) throw new Error("Pick a backup");
  if (typeof pass !== "string" || !pass) throw new Error("Enter your passphrase");
  const { header, payload } = openCapsule(await readFile(path.join(c.dir, name)), pass);
  return { c, header, files: unpackFiles(payload) };
}

/** What restoring `name` would change (no writes). */
export async function previewRestore(name: unknown, pass: unknown) {
  const { c, header, files } = await openNamed(name, pass);
  const now = (await currentFiles(Infinity, c.dir)).files;
  return { at: header.at, ...diffManifests(manifest(now), manifest(files)) };
}

/** Restores `name` over the data dir after a pre-restore safety backup. Files not in the backup are left alone. */
export const restoreCapsule = (name: unknown, pass: unknown) => serial(async () => {
  const { c, files } = await openNamed(name, pass);
  const safety = await writeCapsule(c, "pre-restore");
  const root = path.resolve(orbitDataDir());
  for (const f of files) {
    const dest = path.resolve(root, f.path);
    if (!dest.startsWith(root + path.sep)) continue; // safeRel already refused these; belt and braces
    if (await lstat(dest).then((s) => s.isSymbolicLink(), () => false)) continue; // never write through a symlink
    await atomicWrite(dest, f.data);
  }
  return { restored: files.length, safety: safety.name };
});
