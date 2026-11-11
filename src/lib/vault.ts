import { createReadStream, createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import os from "node:os";
import path from "node:path";
// .ts extensions + lazy extract import so tests/vault-io.test.ts runs under node --experimental-strip-types.
import { DOCX } from "./attach-pure.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CLOUD_MAX, cloudDir, cloudFailure, cloudPath, mergeCloud, mimeOf, nameFromKey,
  INDEX_FILE, INDEX_TEXT_MAX, PREVIEW_BYTES, extractType, kindOf, parseRange, renameTarget, sanitizeName, snippet, uniqueName, uploadError, type VaultFile,
} from "./vault-pure.ts";
import {
  META_FILE, TRASH_DIR, byName, coverageOf, expired, expiresAt, fromTrash, newMeta, parseMeta, reconcile, recordSync, renamed, resolveRef, retryQueue,
  syncState, toTrash, typeMismatch, type Coverage, type Meta, type SyncState,
} from "./vault-meta-pure.ts";

// VAULT: the owner's personal files, stored flat in <ORBIT data dir>/vault (same data dir as follows.json).
// Every name from a request must already be a sanitized vault name; every path is resolved and checked to stay inside the folder.

export class VaultError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }

export function vaultDir(): string {
  const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "orbit") : path.join(os.homedir(), ".orbit");
  return path.resolve(process.env.ORBIT_DATA_DIR?.trim() || local, "vault");
}
const ensureDir = async () => { const d = vaultDir(); await mkdir(d, { recursive: true }); return d; };

/** Path of an existing regular vault file; throws 400/404 for anything else (traversal, index, symlink, dir). */
async function filePath(ref: unknown): Promise<string> {
  if (typeof ref !== "string" || !ref || sanitizeName(ref) !== ref) throw new VaultError("Invalid file name");
  const dir = vaultDir();
  // A name kept elsewhere (a contract's signed PDF, a chat) keeps working after a rename: a missing name falls back to its id / former names.
  const live = await lstat(path.resolve(dir, ref)).catch(() => null);
  const name = live ? ref : resolveRef(await readMeta(), ref) ?? ref;
  if (sanitizeName(name) !== name) throw new VaultError("Invalid file name");
  const p = path.resolve(dir, name);
  if (path.dirname(p) !== dir || path.basename(p) === INDEX_FILE) throw new VaultError("Invalid file name");
  const st = await lstat(p).catch(() => null);
  if (!st || !st.isFile() || st.isSymbolicLink()) throw new VaultError("File not found", 404);
  return p;
}

// Mutations run one at a time so uniqueness checks and renames can't race.
const g = globalThis as unknown as {
  __orbitVault?: Promise<unknown>; __orbitVaultIndex?: Promise<unknown>;
  __orbitVaultCloud?: { uid: string; at: number; items: Map<string, number> };
  __orbitVaultIdx?: { data: Index; checkedAt: number; stale: boolean }; // parsed .index.json, kept in memory
  __orbitVaultMeta?: Promise<unknown>;
};

// ---- metadata: <vault>/.meta.json (ids, versions, hashes, cloud state, trash). Own queue, so cloud uploads outside the vault lock can record results. ----
const metaPath = () => path.join(vaultDir(), META_FILE);
export async function readMeta(): Promise<Meta> {
  try { return parseMeta(JSON.parse(await readFile(metaPath(), "utf8"))); } catch { return parseMeta(null); }
}
function updateMeta<T>(fn: (m: Meta) => T): Promise<T> {
  const p = (g.__orbitVaultMeta ?? Promise.resolve()).catch(() => {}).then(async () => {
    const m = await readMeta();
    const out = fn(m);
    await ensureDir();
    await writeFile(metaPath() + ".tmp", JSON.stringify(m));
    await rename(metaPath() + ".tmp", metaPath());
    return out;
  });
  g.__orbitVaultMeta = p;
  return p;
}
const now = () => Date.now();
const mkId = () => crypto.randomUUID();
const sha256 = (p: string) => new Promise<string>((ok, bad) => {
  const h = createHash("sha256");
  createReadStream(p).on("data", (c) => h.update(c)).on("end", () => ok(h.digest("hex"))).on("error", bad);
});
/** Record a cloud result for one file ("ok" | "pending" | "failed: …"). Never throws: metadata must not fail the file work. */
export const markSync = (name: string, result: string) => updateMeta((m) => recordSync(byName(m, name), result, now())).catch(() => {});
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const p = (g.__orbitVault ?? Promise.resolve()).catch(() => {}).then(fn);
  g.__orbitVault = p;
  return p;
}

export async function listVault(): Promise<VaultFile[]> {
  const dir = await ensureDir();
  const out: VaultFile[] = [];
  for (const d of await readdir(dir, { withFileTypes: true })) {
    if (!d.isFile() || d.name.startsWith(".") || sanitizeName(d.name) !== d.name) continue; // skips symlinks, dirs, index, tmp files
    const st = await stat(path.join(dir, d.name)).catch(() => null);
    if (st) out.push({ name: d.name, size: st.size, mtime: st.mtimeMs, type: kindOf(d.name) });
  }
  return out;
}

export async function usage(files?: VaultFile[]) {
  const list = files ?? await listVault();
  return { bytes: list.reduce((a, f) => a + f.size, 0), count: list.length };
}

/** Store one uploaded file (tmp + rename). Returns the stored name. exact: keep the name or refuse (restore from cloud).
 *  taken: extra names to avoid (cloud-only files, so a new file never claims — and later overwrites — their cloud copy). */
/** restore: the file comes back from its own cloud copy, so it keeps the id its record already has (desk/contract links survive). */
export function saveUpload(file: File, opts: { exact?: boolean; taken?: string[]; restore?: boolean } = {}): Promise<string> {
  return locked(async () => {
    const dir = await ensureDir();
    const files = await listVault();
    const err = uploadError(file.size, await usage(files));
    if (err) throw new VaultError(err, 413);
    const clean = sanitizeName(file.name);
    // Names of cloud-backed records whose file isn't here are reserved too, even when the cloud list failed or the caller passed none.
    const cloudBacked = opts.restore ? [] : Object.values((await readMeta()).files).filter((f) => f.sync === "cloud" || f.sync === "restored").map((f) => f.name);
    const name = uniqueName(clean, [...files.map((f) => f.name), ...(opts.taken ?? []), ...cloudBacked]);
    if (opts.exact && name !== clean) throw new VaultError(`"${clean}" already exists on this PC`, 409);
    const tmp = path.join(dir, `.upload-${crypto.randomUUID()}.tmp`);
    try {
      await pipeline(Readable.fromWeb(file.stream() as import("node:stream/web").ReadableStream), createWriteStream(tmp, { flags: "wx" }));
      const bad = typeMismatch(name, await readHead(tmp, 1024)); // the original bytes are kept as-is; only a lying extension is refused
      if (bad) throw new VaultError(bad, 415);
      const hash = await sha256(tmp);
      const dest = path.join(dir, name);
      // Windows can match dest to another file by its 8.3 short name (REPORT~1.PDF), and rename would overwrite it.
      if (await lstat(dest).catch(() => null)) throw new VaultError(`"${name}" already exists`, 409);
      await rename(tmp, dest);
      await updateMeta((m) => {
        const prev = byName(m, name);
        if (opts.restore && prev) { prev.size = file.size; prev.hash = hash; return; }
        // A new upload never inherits a stale record that shares its name: drop it and mint a fresh id.
        for (const [id, f] of Object.entries(m.files)) if (f.name === name) delete m.files[id];
        const id = mkId(); m.files[id] = newMeta(id, name, file.size, hash, now());
      }).catch(() => {});
    } catch (e) { await unlink(tmp).catch(() => {}); throw e; }
    markStale();
    return name;
  });
}

/** taken: extra names that count as existing (cloud-only files). */
export function renameFile(from: unknown, to: unknown, taken: string[] = []): Promise<string> {
  return locked(async () => {
    const src = await filePath(from);
    if (path.basename(src) !== from) throw new VaultError("File not found", 404); // rename needs the current name, not an old one
    const target = renameTarget(from as string, to);
    if (target === from) return target;
    const all = await listVault();
    const others = [...all.filter((f) => f.name !== from).map((f) => f.name), ...taken];
    if (others.some((n) => n.toLowerCase() === target.toLowerCase())) throw new VaultError(`"${target}" already exists`, 409);
    const dest = path.resolve(vaultDir(), target);
    // Refuse any existing dest (incl. 8.3 short-name aliases); only a case-only rename of the same file may "exist".
    const [a, b] = await Promise.all([lstat(src), lstat(dest).catch(() => null)]);
    if (b && !(target.toLowerCase() === String(from).toLowerCase() && a.ino === b.ino && a.dev === b.dev)) throw new VaultError(`"${target}" already exists`, 409);
    await rename(src, dest);
    await updateMeta((m) => { reconcile(m, all, mkId, now()); renamed(m, from as string, target); }).catch(() => {});
    const idx = g.__orbitVaultIdx?.data;
    if (idx?.[from as string]) { idx[target] = idx[from as string]; delete idx[from as string]; } // same bytes, keep the extracted text
    markStale();
    return target;
  });
}

/** Delete = move to <vault>/.trash for TRASH_DAYS (restorable). Returns the trash id and the file's real name (ref may be an old name). The cloud copy is removed by the route. */
export function deleteFile(name: unknown): Promise<{ id: string; name: string }> {
  return locked(async () => {
    const src = await filePath(name);
    const real = path.basename(src), size = (await stat(src)).size;
    const tdir = path.join(vaultDir(), TRASH_DIR);
    await mkdir(tdir, { recursive: true });
    const item = await updateMeta((m) => toTrash(m, real, size, mkId, now()));
    try { await rename(src, path.join(tdir, item.id)); }
    catch (e) { await updateMeta((m) => { fromTrash(m, item.id, real); }); throw e; }
    markStale();
    return { id: item.id, name: real };
  });
}

/** Trash contents; items past retention are deleted for good first. */
export function listTrash() {
  return locked(async () => {
    const gone = expired(await readMeta(), now());
    if (gone.length) {
      for (const t of gone) await unlink(path.join(vaultDir(), TRASH_DIR, t.id)).catch(() => {});
      await updateMeta((m) => { const ids = new Set(gone.map((t) => t.id)); m.trash = m.trash.filter((t) => !ids.has(t.id)); });
    }
    return (await readMeta()).trash.map((t) => ({ id: t.id, name: t.name, size: t.size, trashedAt: t.trashedAt, expiresAt: expiresAt(t) }));
  });
}

/** Put a trashed file back (same id, so references keep working). Gets a "(2)" name if its name was taken meanwhile. */
export function restoreTrash(id: unknown, taken: string[] = []): Promise<string> {
  return locked(async () => {
    const t = (await readMeta()).trash.find((x) => x.id === id);
    if (!t) throw new VaultError("Not in the trash", 404);
    const files = await listVault();
    const err = uploadError(t.size, await usage(files));
    if (err) throw new VaultError(err, 413);
    const name = uniqueName(t.name, [...files.map((f) => f.name), ...taken]);
    const dest = path.join(vaultDir(), name);
    if (await lstat(dest).catch(() => null)) throw new VaultError(`"${name}" already exists`, 409);
    await rename(path.join(vaultDir(), TRASH_DIR, t.id), dest);
    await updateMeta((m) => { fromTrash(m, t.id, name); });
    markStale();
    return name;
  });
}

/** Delete permanently: the PC copy in the trash. (Its cloud copy was already removed when it was moved to the trash.) */
export function purgeTrash(id: unknown): Promise<void> {
  return locked(async () => {
    if (!(await readMeta()).trash.some((x) => x.id === id)) throw new VaultError("Not in the trash", 404);
    await unlink(path.join(vaultDir(), TRASH_DIR, id as string)).catch((e) => { if (e?.code !== "ENOENT") throw e; });
    await updateMeta((m) => { m.trash = m.trash.filter((x) => x.id !== id); });
  });
}

export type ListedFile = VaultFile & { id: string; version: number; hash: string | null; sync: SyncState; lastSync: number | null; syncError: string | null; cov: Coverage | null };
/** Listing with ids and cloud state. cloud null = cloud listing failed (state shown as last recorded). */
export async function listDetailed(cloud: Map<string, number> | null): Promise<ListedFile[]> {
  const files = await listVault();
  let m = await readMeta();
  if (reconcile(structuredClone(m), files, () => "x", 0)) m = await updateMeta((mm) => { reconcile(mm, files, mkId, now()); return mm; }).catch(() => m);
  const idx = g.__orbitVaultIdx?.data ?? {};
  return files.map((f) => {
    const r = byName(m, f.name);
    const cov = extractType(f.name, DOCX) ? idx[f.name]?.cov ?? (idx[f.name] ? "indexed" : null) : "unsupported";
    return { ...f, id: r?.id ?? "", version: r?.version ?? 1, hash: r?.hash ?? null, sync: syncState(r, cloud ? cloud.has(f.name) : undefined), lastSync: r?.lastSync ?? null, syncError: r?.syncError ?? null, cov };
  });
}

/** Streams a vault file, or the single byte range asked for, without buffering it. range "bad" → caller answers 416. */
export async function readStream(name: unknown, rangeHeader: string | null) {
  const p = await filePath(name);
  const size = (await stat(p)).size;
  const range = parseRange(rangeHeader, size);
  if (range === "bad") return { size, range, stream: null };
  const node = createReadStream(p, range ? { start: range[0], end: range[1] } : {});
  return { size, range, stream: Readable.toWeb(node) as unknown as ReadableStream<Uint8Array> };
}

/** First 20 KB of a text/code file. */
export async function previewText(name: unknown): Promise<{ text: string; truncated: boolean }> {
  const p = await filePath(name);
  if (kindOf(name as string) !== "text") throw new VaultError("No text preview for this type", 415);
  const fh = await open(p, "r");
  try {
    const buf = Buffer.alloc(PREVIEW_BYTES);
    const { bytesRead } = await fh.read(buf, 0, PREVIEW_BYTES, 0);
    const size = (await fh.stat()).size;
    return { text: buf.subarray(0, bytesRead).toString("utf8").replace(/�$/, ""), truncated: size > bytesRead };
  } finally { await fh.close(); }
}

// ---- content index: <vault>/.index.json, extracted text keyed by name + mtime + size ----
type Index = Record<string, { mtime: number; size: number; text: string; cov?: Coverage }>;
const INDEX_TOTAL_MAX = 50 * 1024 * 1024; // all cached text together; files past this are just not content-searchable
const RECHECK_MS = 60_000; // picks up files changed outside ORBIT (Explorer) within a minute
const SAVE_EVERY = 20;

const skipped = new Set<string>(); // over INDEX_TOTAL_MAX: listed as partially searchable
let gen = 0; // bumped on every change, so a rebuild that started before an upload/rename/delete still ends stale
function markStale() { gen++; if (g.__orbitVaultIdx) g.__orbitVaultIdx.stale = true; }

/** First n bytes of a file (text types never need the whole 40 MB). */
async function readHead(p: string, n: number): Promise<Buffer> {
  const fh = await open(p, "r");
  try { const buf = Buffer.alloc(n); const { bytesRead } = await fh.read(buf, 0, n, 0); return buf.subarray(0, bytesRead); }
  finally { await fh.close(); }
}

async function saveIndex(file: string, idx: Index) {
  await writeFile(file + ".tmp", JSON.stringify(idx));
  await rename(file + ".tmp", file);
}

/** Bring the index up to date for every searchable file (extraction failures are cached as empty text). */
function freshIndex(): Promise<Index> {
  const p = (g.__orbitVaultIndex ?? Promise.resolve()).catch(() => {}).then(async () => {
    const mem = g.__orbitVaultIdx;
    if (mem && !mem.stale && Date.now() - mem.checkedAt < RECHECK_MS) return mem.data;
    const startGen = gen;
    const dir = await ensureDir();
    const file = path.join(dir, INDEX_FILE);
    let idx: Index = mem?.data ?? {};
    if (!mem) {
      try { const j = JSON.parse(await readFile(file, "utf8")); if (j && typeof j === "object" && !Array.isArray(j)) idx = j; } catch { /* missing or corrupt: rebuild */ }
    }
    const files = (await listVault()).filter((f) => extractType(f.name, DOCX));
    const next: Index = {};
    let total = 0, pending = 0;
    skipped.clear();
    const fresh = (f: VaultFile) => { const o = idx[f.name]; return o && o.mtime === f.mtime && o.size === f.size && typeof o.text === "string" ? o : null; };
    for (const f of files) { const o = fresh(f); if (o) { next[f.name] = o; total += o.text.length; } }
    let changed = Object.keys(idx).length !== Object.keys(next).length;
    for (const f of files) {
      if (next[f.name]) continue;
      if (total >= INDEX_TOTAL_MAX) { skipped.add(f.name); continue; }
      const type = extractType(f.name, DOCX)!;
      let text = "", error = false;
      try {
        const fp = await filePath(f.name);
        const buf = type.startsWith("text/") ? await readHead(fp, INDEX_TEXT_MAX) : await readFile(fp);
        // Text is decoded here (same as extractText does); PDF/Word go through the limited parser worker.
        text = (type.startsWith("text/") ? buf.toString("utf8").replace(/\u0000/g, "").trim() : await (await import("./extract")).extractText(buf, type)).slice(0, INDEX_TEXT_MAX);
      } catch { error = true; /* unreadable or gone: cache as empty so it isn't retried until it changes */ }
      const truncated = type.startsWith("text/") ? f.size > INDEX_TEXT_MAX : text.length >= INDEX_TEXT_MAX;
      next[f.name] = { mtime: f.mtime, size: f.size, text, cov: coverageOf(true, { error, truncated }) };
      total += text.length;
      changed = true;
      if (++pending >= SAVE_EVERY) { pending = 0; await saveIndex(file, next).catch(() => {}); } // progress survives a crash or timeout
    }
    if (changed) await saveIndex(file, next).catch(() => {}); // read-only/full disk: the in-memory index still works
    g.__orbitVaultIdx = { data: next, checkedAt: Date.now(), stale: gen !== startGen };
    return next;
  });
  g.__orbitVaultIndex = p;
  return p;
}

/** Name and content search (for the panel's "Search inside" and for CORE). */
export async function searchVault(q: string, limit = 10): Promise<{ name: string; snippet: string }[]> {
  return (await searchVaultInfo(q, limit)).results;
}

/** Search plus the files whose contents it could not (fully) see, so "no match" and "not indexed" are told apart. */
export async function searchVaultInfo(q: string, limit = 10): Promise<{ results: { name: string; snippet: string }[]; notIndexed: string[] }> {
  const query = String(q ?? "").trim().slice(0, 200);
  if (!query) return { results: [], notIndexed: [] };
  const files = (await listVault()).sort((a, b) => b.mtime - a.mtime);
  const idx = await freshIndex();
  const out: { name: string; snippet: string }[] = [];
  for (const f of files) {
    const s = snippet(idx[f.name]?.text ?? "", query);
    if (s !== null || f.name.toLowerCase().includes(query.toLowerCase())) out.push({ name: f.name, snippet: s ?? "" });
    if (out.length >= limit) break;
  }
  const notIndexed = files.filter((f) => {
    if (!extractType(f.name, DOCX)) return f.type === "doc" || f.type === "other"; // media and code aren't documents; .doc/.xlsx etc. are
    if (skipped.has(f.name)) return true;
    const c = idx[f.name]?.cov;
    return c === "failed" || c === "partial";
  }).map((f) => f.name);
  return { results: out, notIndexed };
}

/** Readable text of a vault file for CORE; null when missing or not a text/document type. */
export async function readVaultText(name: string, maxChars = 8000): Promise<string | null> {
  try {
    name = path.basename(await filePath(name)); // a renamed file's old name still resolves
    if (extractType(name, DOCX)) return ((await freshIndex())[name]?.text ?? "").slice(0, maxChars) || null;
    if (kindOf(name) === "text") return (await previewText(name)).text.slice(0, maxChars);
    return null;
  } catch { return null; }
}

// ---- cloud copy (private Supabase 'vault' bucket, RLS as the signed-in user). Local stays the main copy; cloud errors never fail local work. ----
const CLOUD_TTL = 60_000;
const bucket = (sb: SupabaseClient) => sb.storage.from("vault");
const errText = (e: unknown) => cloudFailure(e && typeof e === "object" && "message" in e ? (e as { message: unknown }).message : e);

/** Cloud copies as name → size (cached 60 s per user). Throws the cloud error text on failure. */
export async function cloudList(sb: SupabaseClient, uid: string, fresh = false): Promise<Map<string, number>> {
  const c = g.__orbitVaultCloud;
  if (!fresh && c && c.uid === uid && Date.now() - c.at < CLOUD_TTL) return c.items;
  const items = new Map<string, number>();
  for (let offset = 0; offset < 5000; offset += 1000) {
    const { data, error } = await bucket(sb).list(cloudDir(uid), { limit: 1000, offset });
    if (error) throw new Error(errText(error));
    for (const o of data ?? []) { const n = nameFromKey(o.name); if (n && o.id) items.set(n, Number(o.metadata?.size) || 0); } // id null = folder
    if ((data ?? []).length < 1000) break;
  }
  g.__orbitVaultCloud = { uid, at: Date.now(), items };
  return items;
}
/** Cloud files with no local file; [] when the cloud can't be listed. */
export async function cloudOnlyNames(sb: SupabaseClient, uid: string): Promise<string[]> {
  try { return mergeCloud(await listVault(), await cloudList(sb, uid)).cloudOnly.map((c) => c.name); } catch { return []; }
}
const cached = (uid: string) => (g.__orbitVaultCloud?.uid === uid ? g.__orbitVaultCloud.items : null);

/** Upload a local vault file's bytes to its cloud copy. Returns "ok" or "failed: <reason>". */
export async function cloudPut(sb: SupabaseClient, uid: string, name: string): Promise<string> {
  const r = await cloudPutRaw(sb, uid, name);
  await markSync(name, r);
  return r;
}
async function cloudPutRaw(sb: SupabaseClient, uid: string, name: string): Promise<string> {
  try {
    const p = cloudPath(uid, name);
    const buf = await readFile(await filePath(name));
    if (buf.length > CLOUD_MAX) return "failed: larger than the 50 MB cloud limit";
    const opts = { contentType: mimeOf(name), cacheControl: "0" };
    // Never upsert: an object already at this key may be the only copy of a different file.
    const { error } = await bucket(sb).upload(p, buf, { ...opts, upsert: false });
    if (error && /exist|duplicate|409/i.test(`${error.message} ${(error as { statusCode?: unknown }).statusCode ?? ""}`))
      return `failed: a different "${name}" is already in the cloud; rename this file and sync again`;
    if (error) return `failed: ${errText(error)}`;
    cached(uid)?.set(name, buf.length);
    return "ok";
  } catch (e) { return `failed: ${e instanceof VaultError ? e.message : errText(e)}`; }
}

export async function cloudRemove(sb: SupabaseClient, uid: string, name: string): Promise<string> {
  try {
    const { error } = await bucket(sb).remove([cloudPath(uid, name)]); // a missing object is not an error here
    if (error) return `failed: ${errText(error)}`;
    cached(uid)?.delete(name);
    return "ok";
  } catch (e) { return `failed: ${errText(e)}`; }
}

export async function cloudMove(sb: SupabaseClient, uid: string, from: string, to: string): Promise<string> {
  try {
    const items = cached(uid);
    if (items && !items.has(from)) return cloudPut(sb, uid, to); // no old copy: just upload the renamed file
    const { error } = await bucket(sb).move(cloudPath(uid, from), cloudPath(uid, to));
    if (error && /not.?found|404/i.test(error.message)) return cloudPut(sb, uid, to);
    if (error) return `failed: ${errText(error)}`;
    if (items) { items.set(to, items.get(from) ?? 0); items.delete(from); }
    return "ok";
  } catch (e) { return `failed: ${errText(e)}`; }
}

/** Upload local files missing from the cloud, one at a time; stops after 200 files or before passing ~45 s. */
export async function syncToCloud(sb: SupabaseClient, uid: string) {
  const started = Date.now();
  const cloud = await cloudList(sb, uid, true);
  const files = await listVault();
  // Already in the cloud (e.g. an upload that timed out after it landed): mark it, never upload it again.
  await updateMeta((m) => { for (const f of files) { const r = byName(m, f.name); if (r && cloud.has(f.name) && r.sync !== "cloud" && r.sync !== "restored") { r.sync = "cloud"; r.syncError = null; } } }).catch(() => {});
  const size = new Map(files.map((f) => [f.name, f.size]));
  const missing = retryQueue(files, await readMeta(), cloud).filter((n) => size.get(n)! <= CLOUD_MAX).map((name) => ({ name, size: size.get(name)! }));
  let uploaded = 0, failed = 0, firstError: string | null = null, tried = 0;
  for (const f of missing) {
    if (tried >= 200) break;
    tried++;
    if (Date.now() - started + f.size / 1000 > 45_000) break; // ~1 MB/s estimate: never run into the 60 s route limit
    const r = await cloudPut(sb, uid, f.name);
    if (r === "ok") uploaded++; else { failed++; firstError ??= `${f.name}: ${r.replace(/^failed: /, "")}`; }
  }
  return { uploaded, failed, remaining: missing.length - tried, firstError };
}

/** Download a cloud-only file into the local vault under the same name (same checks and limits as an upload). */
export async function restoreFromCloud(sb: SupabaseClient, uid: string, name: unknown): Promise<string> {
  if (typeof name !== "string" || !name || sanitizeName(name) !== name) throw new VaultError("Invalid file name");
  const { data, error } = await bucket(sb).download(cloudPath(uid, name));
  if (error || !data) throw new VaultError(`Cloud download failed: ${errText(error)}`, 502);
  const saved = await saveUpload(new File([data], name), { exact: true, restore: true });
  await updateMeta((m) => { const r = byName(m, saved); if (r) { r.sync = "restored"; r.lastSync = now(); } }).catch(() => {});
  return saved;
}
