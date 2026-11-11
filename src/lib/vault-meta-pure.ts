// VAULT metadata rules (no node imports): stable ids, trash, per-file cloud state, extraction coverage, import checks.
// Stored by vault.ts in <vault>/.meta.json; the files themselves stay flat in the vault folder.

export const META_FILE = ".meta.json";
export const TRASH_DIR = ".trash";
export const TRASH_DAYS = 30;
const DAY = 86_400_000;

/** local = only on this PC (never "backed up"); pending = upload running; failed = last upload failed; restored = downloaded from its cloud copy. */
export type SyncState = "local" | "cloud" | "pending" | "failed" | "restored";
export type Coverage = "indexed" | "partial" | "unsupported" | "failed";
export type FileMeta = {
  id: string; name: string; version: number; hash: string | null; size: number; addedAt: number;
  formerNames: string[]; sync: SyncState; lastSync: number | null; syncError: string | null; attempts: number;
};
export type TrashItem = { id: string; name: string; trashedAt: number; size: number; meta: FileMeta };
export type Meta = { files: Record<string, FileMeta>; trash: TrashItem[] };

export const emptyMeta = (): Meta => ({ files: {}, trash: [] });

/** Parsed .meta.json, or empty when missing/corrupt (ids are then re-issued; nothing on disk is lost). */
export function parseMeta(raw: unknown): Meta {
  const m = raw as Meta | null;
  return m && typeof m === "object" && m.files && typeof m.files === "object" && Array.isArray(m.trash) ? m : emptyMeta();
}

export function newMeta(id: string, name: string, size: number, hash: string | null, now: number): FileMeta {
  return { id, name, version: 1, hash, size, addedAt: now, formerNames: [], sync: "local", lastSync: null, syncError: null, attempts: 0 };
}

export const byName = (m: Meta, name: string) => Object.values(m.files).find((f) => f.name === name);
/** name → record for many lookups at once (byName scans every record; per file that was O(n²): 1.5 s per listing at 2000 files). First record wins, like byName. */
export function nameIndex(m: Meta): Map<string, FileMeta> {
  const out = new Map<string, FileMeta>();
  for (const f of Object.values(m.files)) if (!out.has(f.name)) out.set(f.name, f);
  return out;
}

/** Give every file on disk a record and drop records whose file is gone (outside ORBIT), unless the file has a cloud copy. Returns whether anything changed. */
export function reconcile(m: Meta, onDisk: { name: string; size: number }[], mkId: () => string, now: number): boolean {
  let changed = false;
  const names = new Set(onDisk.map((f) => f.name));
  // A missing file with a cloud copy is cloud-only (e.g. a new PC after a restore), not deleted: keep its id for restoreFromCloud.
  for (const [id, f] of Object.entries(m.files)) if (!names.has(f.name) && f.sync !== "cloud" && f.sync !== "restored") { delete m.files[id]; changed = true; }
  const known = new Set(nameIndex(m).keys());
  for (const f of onDisk) if (!known.has(f.name)) { const id = mkId(); m.files[id] = newMeta(id, f.name, f.size, null, now); known.add(f.name); changed = true; }
  return changed;
}

/** A stored reference (id, current name or a name the file had before a rename) → current name, or null. */
export function resolveRef(m: Meta, ref: string): string | null {
  if (m.files[ref]) return m.files[ref].name;
  if (byName(m, ref)) return ref;
  return Object.values(m.files).find((f) => f.formerNames.includes(ref))?.name ?? null;
}

export function renamed(m: Meta, from: string, to: string) {
  const f = byName(m, from);
  if (f && from !== to) { f.formerNames = [...f.formerNames.filter((n) => n !== to), from].slice(-20); f.name = to; }
}

/** Move a file's record into the trash list; the file itself goes to .trash/<id>. */
export function toTrash(m: Meta, name: string, size: number, mkId: () => string, now: number): TrashItem {
  const f = byName(m, name) ?? newMeta(mkId(), name, size, null, now);
  delete m.files[f.id];
  const item = { id: f.id, name, trashedAt: now, size, meta: f };
  m.trash.push(item);
  return item;
}

/** Take an item out of the trash under `name` (may differ when the old name was taken meanwhile). Cloud copy was removed on delete. */
export function fromTrash(m: Meta, id: string, name: string): FileMeta | null {
  const i = m.trash.findIndex((t) => t.id === id);
  if (i < 0) return null;
  const [t] = m.trash.splice(i, 1);
  const f: FileMeta = { ...t.meta, sync: "local", lastSync: null, syncError: null, attempts: 0 };
  renamed({ files: { [f.id]: f }, trash: [] }, f.name, name);
  m.files[f.id] = f;
  return f;
}

export const expiresAt = (t: TrashItem) => t.trashedAt + TRASH_DAYS * DAY;
export const expired = (m: Meta, now: number) => m.trash.filter((t) => expiresAt(t) <= now);

/** Record the result of an upload attempt ("ok" | "pending" | "failed: …"). */
export function recordSync(f: FileMeta | undefined, result: string, now: number) {
  if (!f) return;
  if (result === "ok") { f.sync = f.sync === "restored" ? "restored" : "cloud"; f.lastSync = now; f.syncError = null; f.attempts = 0; }
  else if (result === "pending") f.sync = "pending";
  else { f.sync = "failed"; f.syncError = result.replace(/^failed: /, "").slice(0, 200); f.attempts++; }
}

/** State shown for a file. cloudHas undefined = cloud listing failed: keep the stored state, but never claim a copy we can't see. */
export function syncState(f: FileMeta | undefined, cloudHas: boolean | undefined): SyncState {
  const s = f?.sync ?? "local";
  if (cloudHas === true) return s === "restored" ? "restored" : "cloud";
  if (cloudHas === false) return s === "pending" || s === "failed" ? s : "local";
  return s;
}

/** Files that still need a cloud copy, failed ones first so a retry starts with them. Never includes one already in the cloud. */
export function retryQueue(files: { name: string; mtime: number }[], m: Meta, cloud: Map<string, number>): string[] {
  const idx = nameIndex(m), rank = (n: string) => (idx.get(n)?.sync === "failed" ? 0 : 1);
  return files.filter((f) => !cloud.has(f.name)).sort((a, b) => rank(a.name) - rank(b.name) || b.mtime - a.mtime).map((f) => f.name);
}

/** How much of a file's text search can see. */
export function coverageOf(supported: boolean, r: { error?: boolean; text?: string; truncated?: boolean; skipped?: boolean }): Coverage {
  if (!supported) return "unsupported";
  if (r.error) return "failed";
  if (r.skipped || r.truncated) return "partial";
  return "indexed";
}

/** Search outcome wording key: a hit, a real "no match", or "no match, but some files can't be searched inside". */
export function searchVerdict(hits: number, notIndexed: number): "hits" | "noMatch" | "notIndexed" {
  return hits ? "hits" : notIndexed ? "notIndexed" : "noMatch";
}

// ---- import checks: the bytes must be what the extension says for types ORBIT opens or parses ----
const SIG: Record<string, (b: Uint8Array) => boolean> = {
  png: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  gif: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46,
  webp: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45,
  pdf: (b) => new TextDecoder().decode(b.subarray(0, 1024)).includes("%PDF-"),
  docx: (b) => b[0] === 0x50 && b[1] === 0x4b,
};
SIG.jpeg = SIG.jpg;

/** Error text when the first bytes don't match the extension (renamed .exe as .pdf, broken file), else null. Empty files pass. */
export function typeMismatch(name: string, head: Uint8Array): string | null {
  const i = name.lastIndexOf(".");
  const ext = i > 0 ? name.slice(i + 1).toLowerCase() : "";
  const ok = SIG[ext];
  return !ok || head.length === 0 || ok(head) ? null : `"${name}" isn't a real .${ext} file (its contents don't match the extension)`;
}
